/**
 * Coding agent loop: clone → tools → commit/push/PR → callbacks.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { chat } from './llmClient.js';
import { stripModelReasoning } from './stripReasoning.js';
import { sendCallback } from './callback.js';
import {
  workspacePath,
  cloneRepo,
  createBranch,
  commitAll,
  pushBranch,
  openPullRequest,
  cleanupWorkspace
} from './git.js';
import { updateJob, removeJob } from './jobQueue.js';
import { runAutomationJob } from './automationLoop.js';
import { replyLanguageInstruction } from './replyLanguage.js';

const execFileAsync = promisify(execFile);
const MAX_STEPS = 40;

const TOOLS = [
  {
    name: 'list_dir',
    description: 'List files in a directory relative to the repo root',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path (default .)' }
      }
    }
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file relative to the repo root',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write/overwrite a UTF-8 text file relative to the repo root',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_command',
    description:
      'Run an allowlisted command in the repo (ls, pwd, git status/diff/log, npm test/run/ci, node -v, cat of relative files via read_file preferred)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      },
      required: ['command']
    }
  },
  {
    name: 'finish',
    description:
      'Finish the task with a short summary for task stakeholders (final outcome only; no reasoning diary or step-by-step analysis)',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        success: { type: 'boolean' }
      },
      required: ['summary']
    }
  }
];

function safeJoin(root, rel) {
  const resolved = path.resolve(root, rel || '.');
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error('Path escapes workspace');
  }
  return resolved;
}

function isAllowlistedCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!c || c.length > 400) return false;
  if (/[;&|`$<>]/.test(c) || c.includes('\n')) return false;
  const allowed = [
    /^ls(\s|$)/,
    /^pwd$/,
    /^git\s+(status|diff|log|show|branch)(\s|$)/,
    /^npm\s+(test|run|ci|install)(\s|$)/,
    /^node\s+-v$/,
    /^npx\s+[\w@/.-]+(\s|$)/,
    /^cat\s+[\w./-]+$/,
    /^find\s+\.\s+-maxdepth\s+[1-3](\s|$)/
  ];
  return allowed.some((re) => re.test(c));
}

async function runTool(workDir, name, args) {
  switch (name) {
    case 'list_dir': {
      const dir = safeJoin(workDir, args.path || '.');
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .slice(0, 200)
        .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
        .join('\n');
    }
    case 'read_file': {
      const file = safeJoin(workDir, args.path);
      const buf = await fs.readFile(file);
      if (buf.length > 200_000) return 'File too large (>200KB)';
      return buf.toString('utf8');
    }
    case 'write_file': {
      const file = safeJoin(workDir, args.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, String(args.content ?? ''), 'utf8');
      return `Wrote ${args.path}`;
    }
    case 'run_command': {
      if (!isAllowlistedCommand(args.command)) {
        return 'Command not allowlisted';
      }
      try {
        const { stdout, stderr } = await execFileAsync('sh', ['-c', args.command], {
          cwd: workDir,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 120_000
        });
        return `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.slice(0, 20_000);
      } catch (err) {
        return `Command failed: ${err?.message || err}\n${err?.stdout || ''}\n${err?.stderr || ''}`.slice(
          0,
          20_000
        );
      }
    }
    case 'finish':
      return JSON.stringify(args);
    default:
      return `Unknown tool: ${name}`;
  }
}

function buildTaskContext(payload) {
  return [
    `Task ticket: ${payload.ticket || '(none)'}`,
    `Title: ${payload.title || ''}`,
    `Description:\n${payload.description || '(none)'}`,
    payload.comments?.length
      ? `Recent comments:\n${payload.comments
          .map((c) => `- ${c.author || 'user'}: ${c.text}`)
          .join('\n')
          .slice(0, 8000)}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildSystemPrompt(payload, agentsMd) {
  return [
    'You are the Easy Kanban coding agent. Implement the assigned task in this git repository.',
    'Use tools to explore and edit files. Prefer small, focused changes.',
    'When done, call the finish tool with a short summary for stakeholders (outcome only; no chain-of-thought or step-by-step diary).',
    replyLanguageInstruction(payload),
    'Never include <think> or reasoning blocks in tool arguments or summaries.',
    'Do not print secrets. Do not access paths outside the repo.',
    agentsMd ? `Repository AGENTS.md:\n${agentsMd.slice(0, 12000)}` : '',
    buildTaskContext(payload)
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Assist-only: answer from task context, post as comment, no git.
 */
async function runAssistJob(job, payload) {
  console.log(`[runner] Assist job ${job.jobId} task=${job.taskId} model=${payload.llm?.model || '?'}`);
  updateJob(job.jobId, { status: 'running', progress: 20 });
  await sendCallback(job, {
    event: 'progress',
    progress: 20,
    log: `[runner] Assist mode (no repo) — answering from task context`
  });

  const context = buildTaskContext(payload);
  const messages = [
    {
      role: 'system',
      content:
        'You are a helpful engineering assistant for Easy Kanban. ' +
        'Answer based on the task title, description, and comments. Use Markdown. ' +
        replyLanguageInstruction(payload) +
        ' Do not invent repo file contents you have not seen. ' +
        'Reply with the final answer only — no chain-of-thought, <think> blocks, or hidden reasoning. ' +
        'Match the user\'s requested brevity: if they ask for a short or literal reply (e.g. "say hello"), ' +
        'output only that. Do not add Summary, Guidance, Questions, Next steps, or similar meta sections unless asked.'
    },
    {
      role: 'user',
      content: `${context}\n\nPlease answer the question or provide guidance for this task.`
    }
  ];

  console.log(`[runner] Assist job ${job.jobId} calling LLM…`);
  const reply = await chat(payload.llm, messages, []);
  const answer =
    stripModelReasoning(reply.content || '').trim() ||
    'No response from the model.';
  console.log(`[runner] Assist job ${job.jobId} LLM done (${answer.length} chars)`);

  updateJob(job.jobId, {
    status: 'done',
    progress: 100,
    result: { summary: answer, mode: 'assist' }
  });
  await sendCallback(job, {
    event: 'done',
    progress: 100,
    status: 'done',
    comment: answer,
    log: `[runner] Assist finished`
  });
}

/**
 * @param {object} job from jobQueue
 */
export async function runAgentJob(job) {
  const payload = job.payload;
  const workDir = workspacePath(payload.tenantId, job.jobId);
  const branchName = `agent/${(payload.ticket || job.taskId || 'task')
    .toString()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 60)}`;

  updateJob(job.jobId, { status: 'running', progress: 5 });
  await sendCallback(job, {
    event: 'progress',
    progress: 5,
    log: `[runner] Starting job ${job.jobId}`
  });

  try {
    if (!payload.llm?.apiKey) {
      throw new Error('LLM apiKey is required');
    }

    const assistOnly =
      payload.mode === 'assist' || !String(payload.repoUrl || '').trim();

    if (payload.mode === 'automation') {
      await runAutomationJob(job);
      return;
    }

    if (assistOnly) {
      await runAssistJob(job, payload);
      return;
    }

    await sendCallback(job, {
      event: 'progress',
      progress: 10,
      log: `[runner] Cloning ${payload.repoUrl}`
    });
    await cloneRepo({
      repoUrl: payload.repoUrl,
      branch: payload.repoBranch || undefined,
      token: payload.githubToken,
      sshPrivateKey: payload.sshPrivateKey,
      workDir
    });
    await createBranch(workDir, branchName);

    let agentsMd = '';
    try {
      agentsMd = await fs.readFile(path.join(workDir, 'AGENTS.md'), 'utf8');
    } catch {
      /* optional */
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt(payload, agentsMd) },
      {
        role: 'user',
        content:
          'Please implement this task. Explore the repo, make the necessary changes, then finish with a summary.'
      }
    ];

    let finished = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (job.cancelRequested) {
        throw Object.assign(new Error('Cancelled by user'), { cancelled: true });
      }

      const progress = Math.min(85, 15 + Math.floor((step / MAX_STEPS) * 70));
      updateJob(job.jobId, { progress });

      const reply = await chat(payload.llm, messages, TOOLS);

      if (!reply.toolCalls.length) {
        messages.push({ role: 'assistant', content: reply.content || '' });
        messages.push({
          role: 'user',
          content: 'Continue using tools, or call finish when the work is complete.'
        });
        continue;
      }

      // OpenAI-style assistant message with tool_calls for next round
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
        const result = await runTool(workDir, tc.name, tc.arguments || {});
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: String(result).slice(0, 20000)
        });
        if (step % 5 === 0) {
          await sendCallback(job, {
            event: 'log',
            progress,
            log: `[runner] step ${step + 1}: ${tc.name}`
          });
        }
      }
      if (finished) break;
    }

    if (job.cancelRequested) {
      throw Object.assign(new Error('Cancelled by user'), { cancelled: true });
    }

    const commitMsg = `agent: ${payload.title || payload.ticket || job.taskId}`.slice(0, 72);
    const { committed } = await commitAll(workDir, commitMsg);

    let prUrl = null;
    if (committed && (payload.githubToken || payload.sshPrivateKey)) {
      try {
        await pushBranch(workDir, branchName, {
          token: payload.githubToken,
          sshPrivateKey: payload.sshPrivateKey,
          repoUrl: payload.repoUrl
        });
        prUrl = await openPullRequest({
          repoUrl: payload.repoUrl,
          token: payload.githubToken,
          head: branchName,
          base: payload.repoBranch || 'main',
          title: `[Agent] ${payload.title || payload.ticket || job.taskId}`,
          body: finished?.summary || 'Automated changes from Easy Kanban Agent.'
        });
        if (!prUrl && !payload.githubToken) {
          await sendCallback(job, {
            event: 'log',
            log: `[runner] Pushed via SSH; add a GitHub PAT under Profile → Dev to open PRs automatically`
          });
        }
      } catch (err) {
        await sendCallback(job, {
          event: 'log',
          log: `[runner] Push/PR warning: ${err?.message || err}`
        });
      }
    }

    const summary = stripModelReasoning(
      finished?.summary ||
        (committed
          ? `Committed changes on branch ${branchName}.`
          : 'No file changes were committed.')
    ).trim() || (committed
      ? `Committed changes on branch ${branchName}.`
      : 'No file changes were committed.');
    const success = finished?.success !== false;

    updateJob(job.jobId, {
      status: success ? 'done' : 'failed',
      progress: 100,
      result: { summary, prUrl, branch: branchName, committed }
    });

    await sendCallback(job, {
      event: success ? 'done' : 'failed',
      progress: 100,
      status: success ? 'done' : 'failed',
      comment: summary,
      log: `[runner] Finished (${success ? 'done' : 'failed'})`,
      prUrl: prUrl || undefined,
      branch: branchName
    });
  } catch (err) {
    const cancelled = Boolean(err?.cancelled || job.cancelRequested);
    updateJob(job.jobId, {
      status: cancelled ? 'cancelled' : 'failed',
      error: err?.message || String(err)
    });
    await sendCallback(job, {
      event: cancelled ? 'cancelled' : 'failed',
      status: cancelled ? 'stopped' : 'failed',
      log: `[runner] ${cancelled ? 'Cancelled' : 'Failed'}: ${err?.message || err}`,
      comment: cancelled
        ? 'Agent job was cancelled.'
        : `Agent job failed: ${err?.message || err}`
    });
  } finally {
    await cleanupWorkspace(workDir);
    // Keep job record briefly then drop
    setTimeout(() => removeJob(job.jobId), 60_000);
  }
}
