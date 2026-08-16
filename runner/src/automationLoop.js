/**
 * Automation agent loop: LLM tool calls against Easy Kanban automation API.
 * Phases: discover → dry_run plan → await apply → apply stored plan → finish.
 */

import { chat } from './llmClient.js';
import { stripModelReasoning } from './stripReasoning.js';
import { sendCallback } from './callback.js';
import { updateJob, removeJob } from './jobQueue.js';
import { AUTOMATION_MAX_TOOL_STEPS } from './automationConstants.js';
import { replyLanguageInstruction } from './replyLanguage.js';

const MAX_STEPS = AUTOMATION_MAX_TOOL_STEPS || 40;
const TOOL_RESULT_MAX = 20000;

/** Keep search/list payloads valid JSON; never cut mid-object (that hid remaining task ids). */
function toolResultContent(result) {
  let payload = result;
  let text = JSON.stringify(payload);
  if (text.length <= TOOL_RESULT_MAX) return text;

  if (payload && Array.isArray(payload.tasks)) {
    payload = {
      ...payload,
      truncatedForLlm: true,
      note: `${payload.note || ''} Rows compacted for size; use offset/hasMore if incomplete.`.trim(),
      tasks: payload.tasks.map((t) => ({
        id: t.id,
        ticket: t.ticket,
        memberId: t.memberId,
        boardTitle: t.boardTitle,
        columnTitle: t.columnTitle
      }))
    };
    text = JSON.stringify(payload);
  }
  if (text.length <= TOOL_RESULT_MAX) return text;

  if (payload && Array.isArray(payload.tasks) && payload.tasks.length > 60) {
    const kept = payload.tasks.slice(0, 60);
    payload = {
      ...payload,
      truncatedForLlm: true,
      hasMore: true,
      count: kept.length,
      note: `${payload.note || ''} Returning first ${kept.length} of ${payload.totalCount ?? payload.tasks.length} in this page; call search_tasks with offset.`.trim(),
      tasks: kept
    };
    text = JSON.stringify(payload);
  }
  if (text.length <= TOOL_RESULT_MAX) return text;
  return `${text.slice(0, TOOL_RESULT_MAX - 80)}\n[TRUNCATED — page with search_tasks offset; do not assume this is the full set]`;
}

const TOOLS = [
  {
    name: 'list_capabilities',
    description: 'List allowed and denied automation capabilities',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_boards',
    description: 'List boards in scope (id + title). Use titles in human summaries.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_columns',
    description: 'List columns for a board (includes boardTitle). Use titles in human summaries.',
    parameters: {
      type: 'object',
      properties: { boardId: { type: 'string' } },
      required: ['boardId']
    }
  },
  {
    name: 'list_sprints',
    description: 'List sprints',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_members',
    description: 'List team members',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_tags',
    description: 'List tags',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_priorities',
    description: 'List priorities',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'search_tasks',
    description:
      'Search live tasks in scope (trash excluded by default). Excludes the launch task. Returns compact rows (id, ticket, titles, memberId) plus totalCount/hasMore/offset. Page with offset until hasMore is false before bulk updates. For “assigned to X”, use assigneeId from list_members — not text. Set includeDescription:true only when you need previews. trashOnly/includeTrash only for recovery, then restore_tasks.',
    parameters: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        sprintId: { type: 'string' },
        columnId: { type: 'string' },
        text: { type: 'string' },
        assigneeId: { type: 'string' },
        tagId: { type: 'string' },
        limit: { type: 'number' },
        offset: {
          type: 'number',
          description: 'Skip this many matches (use with hasMore / totalCount).'
        },
        includeDescription: { type: 'boolean' },
        includeTrash: {
          type: 'boolean',
          description: 'Include live and trashed tasks. Prefer trashOnly for recovery.'
        },
        trashOnly: {
          type: 'boolean',
          description: 'Search only tasks in trash (for recovery).'
        }
      }
    }
  },
  {
    name: 'get_task',
    description:
      'Get full details for one task by id. Prefer search_tasks (descriptionPreview) or get_tasks for bulk. Launch task is excluded.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId']
    }
  },
  {
    name: 'get_tasks',
    description:
      'Get details for many tasks in one call (prefer over many get_task). Launch task ids are skipped.',
    parameters: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['taskIds']
    }
  },
  {
    name: 'create_task',
    description: 'Create a task (dry-run first in plan phase)',
    parameters: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        columnId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['boardId', 'columnId', 'title']
    }
  },
  {
    name: 'update_tasks',
    description:
      'Bulk update task fields (e.g. memberId). Pass fields:{ memberId } (top-level memberId is also accepted). Use dryRun:true while planning.',
    parameters: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' } },
        fields: { type: 'object' },
        dryRun: { type: 'boolean' }
      },
      required: ['taskIds', 'fields']
    }
  },
  {
    name: 'restore_tasks',
    description:
      'Restore tasks from trash onto their board. Use only when the user asked to recover trashed work. Discover with search_tasks trashOnly:true first. Use dryRun:true while planning.',
    parameters: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' } },
        dryRun: { type: 'boolean' }
      },
      required: ['taskIds']
    }
  },
  {
    name: 'move_tasks',
    description: 'Move tasks to a column. Use dryRun:true while planning.',
    parameters: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' } },
        columnId: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['taskIds', 'columnId']
    }
  },
  {
    name: 'set_task_sprint',
    description: 'Assign tasks to a sprint. Use dryRun:true while planning.',
    parameters: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' } },
        sprintId: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['taskIds', 'sprintId']
    }
  },
  {
    name: 'create_sprint',
    description: 'Create a sprint',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        description: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['name']
    }
  },
  {
    name: 'update_sprint',
    description: 'Update a sprint',
    parameters: {
      type: 'object',
      properties: {
        sprintId: { type: 'string' },
        name: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        description: { type: 'string' },
        isActive: { type: 'boolean' },
        dryRun: { type: 'boolean' }
      },
      required: ['sprintId']
    }
  },
  {
    name: 'create_column',
    description: 'Create a column on a board',
    parameters: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        title: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['boardId', 'title']
    }
  },
  {
    name: 'rename_column',
    description: 'Rename a column',
    parameters: {
      type: 'object',
      properties: {
        columnId: { type: 'string' },
        title: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['columnId', 'title']
    }
  },
  {
    name: 'create_board',
    description: 'Create a board',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['title']
    }
  },
  {
    name: 'rename_board',
    description: 'Rename a board',
    parameters: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        title: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['boardId', 'title']
    }
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        text: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['taskId', 'text']
    }
  },
  {
    name: 'export_tasks_xlsx',
    description: 'Export tasks in scope to XLSX attached to the automation task',
    parameters: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        dryRun: { type: 'boolean' }
      }
    }
  },
  {
    name: 'export_tasks_csv',
    description: 'Export tasks in scope to CSV attached to the automation task',
    parameters: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        dryRun: { type: 'boolean' }
      }
    }
  },
  {
    name: 'submit_dry_run_plan',
    description:
      'Submit the planned mutations for admin preview. Call this when discovery is done and before waiting for Apply. summary must use board/column titles (not UUIDs). operations: [{name, arguments}]',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              arguments: { type: 'object' }
            }
          }
        }
      },
      required: ['summary', 'operations']
    }
  },
  {
    name: 'finish',
    description: 'Finish with a human summary of outcomes',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        matched: { type: 'number' },
        changed: { type: 'number' },
        skipped: { type: 'number' },
        errors: { type: 'array', items: { type: 'string' } }
      },
      required: ['summary']
    }
  }
];

function automationHeaders(automation, extra = {}) {
  const headers = {
    Authorization: `Bearer ${automation.token}`,
    Accept: 'application/json',
    ...extra
  };
  const tenantId = automation.tenantId;
  if (tenantId && tenantId !== 'default') {
    headers['X-Tenant-Id'] = String(tenantId);
  }
  return headers;
}

function toolCallLogStatus(result) {
  if (!result || typeof result !== 'object') return 'ok';
  if (result.denied === true) {
    return `denied${result.error ? `: ${String(result.error).slice(0, 180)}` : ''}`;
  }
  if (result.error) return `error: ${String(result.error).slice(0, 180)}`;
  return 'ok';
}

async function callToolApi(automation, name, args, dryRun = false) {
  const base = String(automation.apiBaseUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/agent/automation/tools`, {
    method: 'POST',
    headers: automationHeaders(automation, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ name, arguments: args || {}, dryRun })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: body.error || `HTTP ${res.status}` };
  }
  return body.result ?? body;
}

async function getStatus(automation) {
  const base = String(automation.apiBaseUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/agent/automation/status`, {
    headers: automationHeaders(automation)
  });
  if (!res.ok) return { control: 'none', status: 'unknown' };
  return res.json();
}

async function applyPlan(automation) {
  const base = String(automation.apiBaseUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/agent/automation/apply`, {
    method: 'POST',
    headers: automationHeaders(automation)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  return body;
}

const AGENT_MEMBER_ID = '00000000-0000-0000-0000-000000000011';

function commentPlainText(c) {
  return String(c?.text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAgentComment(c) {
  const authorId = String(c?.authorId || '').trim();
  if (authorId && authorId === AGENT_MEMBER_ID) return true;
  const author = String(c?.author || '').trim().toLowerCase();
  return author === 'agent' || author.endsWith(' agent');
}

/** Human comments posted after the last Agent reply — this run's instruction. */
function thisTurnHumanComments(payload) {
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  let lastAgent = -1;
  for (let i = comments.length - 1; i >= 0; i--) {
    if (isAgentComment(comments[i])) {
      lastAgent = i;
      break;
    }
  }
  return comments.slice(lastAgent + 1).filter((c) => !isAgentComment(c) && commentPlainText(c));
}

function buildContext(payload) {
  const boards = payload.automation?.boards;
  const boardLines =
    Array.isArray(boards) && boards.length
      ? `Boards in scope:\n${boards
          .map((b) => `- ${b.title || '(untitled)'} (id: ${b.id})`)
          .join('\n')}`
      : payload.automation?.boardIds?.length
        ? `Board IDs: ${payload.automation.boardIds.join(', ')}`
        : '';

  const thisTurn = thisTurnHumanComments(payload);
  const thisTurnBlock = thisTurn.length
    ? `This run's human messages (since last Agent reply) — this is the current instruction:\n${thisTurn
        .map((c) => `- ${c.author || 'user'}: ${commentPlainText(c)}`)
        .join('\n')}`
    : 'This run has no new human comments since the last Agent reply. Execute the standing recipe.';

  return [
    `Task ticket: ${payload.ticket || '(none)'}`,
    `Title: ${payload.title || ''}`,
    `Standing recipe (task description):\n${payload.description || '(none)'}`,
    thisTurnBlock,
    `Scope: ${payload.automation?.scopeType || 'this_board'}`,
    boardLines,
    payload.comments?.length
      ? `Full thread (context only — do not re-do already completed Agent work unless this run asks):\n${payload.comments
          .map((c) => `- ${c.author || 'user'}: ${commentPlainText(c)}`)
          .join('\n')
          .slice(0, 6000)}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * @param {object} job
 */
export async function runAutomationJob(job) {
  const payload = job.payload;
  const automation = {
    ...(payload.automation || {}),
    tenantId: payload.automation?.tenantId || payload.tenantId || job.tenantId
  };
  if (!automation?.apiBaseUrl || !automation?.token) {
    throw new Error('Automation apiBaseUrl and token are required');
  }
  if (!payload.llm?.apiKey) {
    throw new Error('LLM apiKey is required');
  }

  updateJob(job.jobId, { status: 'running', progress: 5 });
  await sendCallback(job, {
    event: 'progress',
    progress: 5,
    log: `[runner] Automation mode — discovering board data`
  });

  const system = [
    'You are the Easy Kanban Automation agent (admin-only board operations).',
    'Discover data with list/search tools, then plan mutations with dryRun:true.',
    'Never delete tasks, boards, or columns — those are denied.',
    'search_tasks excludes trash by default. Only use trashOnly/includeTrash when the user asked to find or recover trashed tasks; then restore_tasks (not update/move).',
    'The automation launch task (this recipe card) is NEVER a target: search/get/move/update skip it automatically. Do not try to move or edit it.',
    'Prefer search_tasks for discovery. Rows are compact (no descriptionPreview unless includeDescription:true). Always read totalCount and hasMore; if hasMore, call search_tasks again with offset until complete, then plan. For “all tasks assigned to X”, list_members then search_tasks assigneeId — never match the name via text. After applying a bulk assignee change, search that assigneeId again; if any remain, continue or report the remainder — do not claim “all” unless a verify search returns totalCount 0.',
    'When names are ambiguous, prefer IDs from list tools; refuse to guess.',
    'In human-facing text (submit_dry_run_plan summary, finish, comments), always use board titles and column titles — never raw board/column UUIDs. Keep using IDs only in tool arguments.',
    replyLanguageInstruction(payload),
    'When the plan is ready, call submit_dry_run_plan with a clear summary and operations array',
    '(operations should use dryRun:false arguments — the server applies them only after admin Apply).',
    'If there is nothing to change, submit_dry_run_plan with an empty operations array, then call finish immediately (no Apply).',
    'After submit_dry_run_plan with non-empty operations you will wait; do not mutate further until told Apply succeeded.',
    'Finally call finish with a human summary.',
    'The standing recipe is the default job when this run has no new human comments.',
    'If this run has new human comments, that is the current instruction. Use the full thread as context (follow-ups like "those", "also", questions). Do not also execute the recipe in the same run unless they asked. If the new instruction conflicts with the recipe, follow this run.',
    'Reply with tool calls only when acting; keep summaries concise.',
    buildContext(payload)
  ].join('\n\n');

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content:
        'Follow the current instruction in context (this run vs standing recipe). Discover with tools first. For trash/recovery, use search_tasks with trashOnly:true then restore_tasks. Then submit_dry_run_plan.'
    }
  ];

  let submittedPlan = false;
  let emptyPlan = false;
  let finished = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (job.cancelRequested) {
      throw Object.assign(new Error('Cancelled by user'), { cancelled: true });
    }

    const progress = Math.min(70, 10 + Math.floor((step / MAX_STEPS) * 60));
    updateJob(job.jobId, { progress });

    const reply = await chat(payload.llm, messages, TOOLS);

    if (!reply.toolCalls.length) {
      messages.push({ role: 'assistant', content: reply.content || '' });
      messages.push({
        role: 'user',
        content: emptyPlan
          ? 'There was nothing to apply. Call finish with the summary now.'
          : submittedPlan
            ? 'Wait for admin Apply — call finish only after apply is confirmed in the next message.'
            : 'Continue with tools, or submit_dry_run_plan when ready.'
      });
      continue;
    }

    messages.push({
      role: 'assistant',
      content: reply.content || '',
      tool_calls: reply.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) }
      }))
    });

    for (const tc of reply.toolCalls) {
      if (tc.name === 'finish') {
        finished = tc.arguments || {};
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: 'ok'
        });
        break;
      }

      const args = { ...(tc.arguments || {}) };
      // Force dry-run for mutating tools before plan submit
      const mutating = [
        'create_task',
        'update_tasks',
        'move_tasks',
        'set_task_sprint',
        'create_sprint',
        'update_sprint',
        'create_column',
        'rename_column',
        'create_board',
        'rename_board',
        'restore_tasks',
        'add_comment',
        'export_tasks_xlsx',
        'export_tasks_csv'
      ];
      let dryRun = Boolean(args.dryRun);
      if (!submittedPlan && !emptyPlan && mutating.includes(tc.name)) {
        dryRun = true;
        args.dryRun = true;
      }

      let result;
      if (tc.name === 'submit_dry_run_plan') {
        result = await callToolApi(automation, tc.name, args, false);
        if (!result.error) {
          if (result.emptyPlan || result.awaitingApply === false) {
            emptyPlan = true;
            submittedPlan = false;
            const summaryText = stripModelReasoning(
              args.summary || 'Nothing to change.'
            );
            await sendCallback(job, {
              event: 'progress',
              progress: 90,
              log: `[runner] Empty plan — nothing to apply; finishing`
            });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: toolResultContent(result)
            });
            // Prefer finishing immediately with the plan summary
            finished = {
              summary: summaryText,
              matched: 0,
              changed: 0,
              skipped: 0
            };
            break;
          }

          submittedPlan = true;
          emptyPlan = false;
          await sendCallback(job, {
            event: 'progress',
            progress: 75,
            status: 'waiting',
            log: `[runner] Dry-run plan submitted — awaiting admin Apply`,
            comment: stripModelReasoning(args.summary || 'Automation plan ready for review.')
          });
        }
      } else {
        result = await callToolApi(automation, tc.name, args, dryRun);
      }

      if (!finished) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResultContent(result)
        });
      }

      await sendCallback(job, {
        event: 'log',
        log: `[runner] tool ${tc.name}${dryRun ? ' (dry-run)' : ''}: ${toolCallLogStatus(result)}`
      });
    }

    if (finished) break;

    if (submittedPlan) {
      // Poll until apply / stop / pause
      await sendCallback(job, {
        event: 'progress',
        progress: 80,
        log: `[runner] Waiting for admin Apply…`
      });
      let applied = false;
      for (let i = 0; i < 3600; i++) {
        if (job.cancelRequested) {
          throw Object.assign(new Error('Cancelled by user'), { cancelled: true });
        }
        await new Promise((r) => setTimeout(r, 2000));
        const st = await getStatus(automation);
        if (st.control === 'stop' || st.status === 'stopped') {
          throw Object.assign(new Error('Stopped by user'), { cancelled: true });
        }
        if (st.control === 'pause' || st.status === 'paused') {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (st.control === 'apply') {
          const applyResult = await applyPlan(automation);
          await sendCallback(job, {
            event: 'progress',
            progress: 90,
            log: `[runner] Apply ${applyResult.ok ? 'succeeded' : 'failed'}: ${
              applyResult.error || applyResult.idempotent ? 'idempotent' : 'ok'
            }`
          });
          messages.push({
            role: 'user',
            content: `Admin Apply result: ${JSON.stringify(applyResult).slice(0, 8000)}. Call finish with a summary.`
          });
          applied = true;
          break;
        }
      }
      if (!applied && !finished) {
        throw new Error('Timed out waiting for admin Apply');
      }
      submittedPlan = false; // allow finish loop
    }
  }

  const summary =
    stripModelReasoning(finished?.summary || '').trim() ||
    'Automation finished.';

  updateJob(job.jobId, {
    status: 'done',
    progress: 100,
    result: { summary, mode: 'automation', ...(finished || {}) }
  });
  await sendCallback(job, {
    event: 'done',
    progress: 100,
    status: 'done',
    comment: summary,
    log: `[runner] Automation finished`
  });
  removeJob(job.jobId);
}
