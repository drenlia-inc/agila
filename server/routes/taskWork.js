/**
 * User-facing task_work APIs (control, repo binding, status reads).
 * Mounted under /api/tasks
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import {
  assertTaskBoardAccess,
  userCanAccessBoard,
  userHasAdminRole
} from '../middleware/boardAccess.js';
import { isAiEnabled } from '../utils/aiEnabled.js';
import {
  tasks as taskQueries,
  taskWork as taskWorkQueries
} from '../utils/sqlManager/index.js';
import { AGENT_MEMBER_ID } from '../constants/agentIdentity.js';
import notificationService from '../services/notificationService.js';
import { tryLaunchQueuedTasks } from '../services/agentJobDispatcher.js';
import { cancelJob, getRunnerJob } from '../services/agentRunnerClient.js';
import {
  applyStoredPlan,
  buildUserAutomationCtx,
  markAutomationContextLost
} from '../services/automationTools.js';
import {
  parseBody,
  updateTaskWorkBodySchema,
  taskWorkControlBodySchema,
  workMapsBodySchema
} from '../utils/requestValidation.js';
import { redactWorkMapForClient } from '../utils/taskWorkPublic.js';

const router = express.Router();

async function publishWork(req, taskId, work) {
  const db = getRequestDatabase(req);
  const task = await taskQueries.getTaskById(db, taskId);
  await notificationService.publish(
    'task-work-updated',
    {
      taskId,
      boardId: task?.boardid || task?.boardId,
      work: redactWorkMapForClient(work),
      timestamp: new Date().toISOString()
    },
    getTenantId(req)
  );
}

function dispatchCtx(req) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return { reqHost: host, reqProtocol: proto };
}

async function reconcileAutomationRunner(db, taskId, work) {
  const pending = Boolean(work?.automation_pending_plan);
  const awaiting = work?.awaiting_apply === 'true';
  if (!pending && !awaiting) return work;
  if (work.automation_context_lost === 'true') return work;
  if (['done', 'undone'].includes(String(work.status || ''))) return work;

  const waitingLike = ['waiting', 'running', 'paused', 'queued'].includes(
    String(work.status || '')
  );
  let gone = false;
  if (awaiting && !waitingLike) {
    gone = true;
  } else if (awaiting || (pending && String(work.status) === 'waiting')) {
    if (!work.runner_job_id || !work.callback_token) {
      gone = true;
    } else {
      const job = await getRunnerJob(db, work.runner_job_id);
      if (job.missing) gone = true;
    }
  }
  if (!gone) return work;
  return markAutomationContextLost(
    db,
    taskId,
    work,
    'Automation runner is gone — Apply the last plan or Restart'
  );
}

router.get('/:taskId/work', authenticateToken, async (req, res) => {
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;
    const db = getRequestDatabase(req);
    const workRaw = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
    const work = await reconcileAutomationRunner(db, req.params.taskId, workRaw);
    if (work.automation_context_lost === 'true' && workRaw.automation_context_lost !== 'true') {
      await publishWork(req, req.params.taskId, work);
    }
    res.json({ work: redactWorkMapForClient(work) });
  } catch (error) {
    console.error('Get task work error:', error);
    res.status(500).json({ error: 'Failed to get task work' });
  }
});

/**
 * Bind repo / initialize agent work when assigning to Agent.
 * Body: { repoUrl, repoBranch?, status?, agentMode?, ... } — no free-form entries.
 */
router.put('/:taskId/work', authenticateToken, async (req, res) => {
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;

    const db = getRequestDatabase(req);
    if (!(await isAiEnabled(db))) {
      return res.status(403).json({ error: 'AI features are disabled for this instance' });
    }

    const task = await taskQueries.getTaskById(db, req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const existing = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
    const isAdmin =
      req.user?.role === 'admin' ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes('admin'));

    const parsed = parseBody(updateTaskWorkBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const body = parsed.data;

    // Only typed top-level fields — never accept arbitrary task_work keys from clients.
    const entries = {};
    if (body.repoUrl !== undefined) {
      // Empty string = assist-only (no code repo)
      entries.repo_url = String(body.repoUrl).trim();
    }
    if (body.repoBranch !== undefined) {
      entries.repo_branch = String(body.repoBranch || '').trim();
    }
    if (body.status !== undefined) {
      entries.status = String(body.status);
    }
    if (body.agentMode !== undefined) {
      entries.agent_mode = String(body.agentMode || '').trim();
    }
    if (body.automationScope !== undefined) {
      entries.automation_scope = String(body.automationScope || '').trim();
    }
    if (body.automationBoardIds !== undefined) {
      const ids = Array.isArray(body.automationBoardIds)
        ? body.automationBoardIds
        : [];
      entries.automation_board_ids = JSON.stringify(ids.filter(Boolean));
    }

    // Per-task LLM model override — admins only
    if (isAdmin && body.llmModel !== undefined) {
      entries.llm_model = String(body.llmModel || '').trim();
    }

    if (!isAdmin && entries.agent_mode === 'automation') {
      return res.status(403).json({ error: 'Only admins can run Automation jobs' });
    }

    if (entries.agent_mode === 'automation' && entries.status === 'queued') {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Only admins can run Automation jobs' });
      }
      entries.repo_url = '';
      entries.repo_branch = '';
      if (!entries.automation_scope) {
        entries.automation_scope = 'this_board';
      }
    }

    // Only auto-queue when status is explicitly queued (initial assign).
    // Repo-only config updates must not relaunch the agent.
    if (entries.status === 'queued' && entries.control === undefined) {
      entries.control = 'none';
    }

    // Hard stop: cannot queue agent work without a real description
    if (entries.status === 'queued') {
      const plain = String(task.description || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!plain) {
        return res.status(400).json({
          error: 'Task description is required before assigning the agent'
        });
      }
    }

    // Always bind credentials to the caller when queuing — never client-supplied owner.
    if (entries.status === 'queued' && req.user?.id) {
      entries.agent_owner_user_id = req.user.id;
    }

    // Clear stale PR/branch outcomes when the linked repo changes
    const repoChanged =
      entries.repo_url !== undefined && entries.repo_url !== (existing.repo_url || '');
    if (repoChanged) {
      entries.pr_url = '';
      entries.agent_branch = '';
    }

    if (
      entries.agent_mode &&
      entries.agent_mode !== 'automation' &&
      existing.agent_mode === 'automation' &&
      existing.automation_pending_plan
    ) {
      entries.automation_context_lost = 'true';
    }

    if (!Object.keys(entries).length) {
      return res.status(400).json({ error: 'No work entries provided' });
    }

    const isConfigOnly =
      entries.status === undefined &&
      (entries.repo_url !== undefined ||
        entries.repo_branch !== undefined ||
        entries.llm_model !== undefined);

    await taskWorkQueries.upsertWorkEntries(db, req.params.taskId, entries);

    if (isConfigOnly) {
      const repoLabel = entries.repo_url !== undefined
        ? (entries.repo_url || '(assist / no repo)')
        : existing.repo_url || '(unchanged)';
      const branchLabel =
        entries.repo_branch !== undefined
          ? entries.repo_branch || '(default)'
          : existing.repo_branch || '(unchanged)';
      const modelLabel =
        entries.llm_model !== undefined
          ? entries.llm_model || '(tenant default)'
          : existing.llm_model || '(unchanged)';
      await taskWorkQueries.appendWorkLog(
        db,
        req.params.taskId,
        `[${new Date().toISOString()}] User updated agent configuration: ${repoLabel} @ ${branchLabel}; model=${modelLabel}`
      );
    }

    let work = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
    await publishWork(req, req.params.taskId, work);

    // Push-launch when newly queued
    if (work.status === 'queued') {
      const tenantId = getTenantId(req);
      try {
        await tryLaunchQueuedTasks(db, tenantId, dispatchCtx(req));
        work = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
      } catch (e) {
        console.error('Agent dispatch after assign failed:', e);
      }
    }

    res.json({ work: redactWorkMapForClient(work) });
  } catch (error) {
    console.error('Put task work error:', error);
    res.status(500).json({ error: 'Failed to update task work' });
  }
});

/**
 * User control: pause | stop | resume | none
 * Resume from waiting/paused/stopped → sets control=resume and status=queued
 */
router.put('/:taskId/work/control', authenticateToken, async (req, res) => {
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;

    const db = getRequestDatabase(req);
    if (!(await isAiEnabled(db))) {
      return res.status(403).json({ error: 'AI features are disabled for this instance' });
    }

    const task = await taskQueries.getTaskById(db, req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const memberId = task.memberid || task.memberId;
    if (memberId !== AGENT_MEMBER_ID) {
      return res.status(400).json({ error: 'Task is not assigned to the Agent' });
    }

    const controlParsed = parseBody(taskWorkControlBodySchema, req.body || {});
    if (!controlParsed.success) {
      return res.status(400).json({
        error: 'control must be pause, stop, resume, apply, or none'
      });
    }
    const control = controlParsed.data.control;

    const workBeforeRaw = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
    const workBefore = await reconcileAutomationRunner(
      db,
      req.params.taskId,
      workBeforeRaw
    );
    const updates = { control };
    const contextLost = workBefore.automation_context_lost === 'true';

    if (control === 'apply') {
      const isAdmin =
        req.user?.role === 'admin' ||
        (Array.isArray(req.user?.roles) && req.user.roles.includes('admin'));
      if (!isAdmin) {
        return res.status(403).json({ error: 'Only admins can apply automations' });
      }
      if (!workBefore.automation_pending_plan) {
        return res.status(400).json({ error: 'No automation dry-run plan to apply' });
      }
      const ctx = buildUserAutomationCtx(db, task, workBefore, {
        tenantId: getTenantId(req),
        ownerUserId: req.user?.id
      });
      const result = await applyStoredPlan(ctx);
      if (result.error) {
        const failed = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
        await publishWork(req, req.params.taskId, failed);
        return res.status(400).json({
          error: result.error,
          work: redactWorkMapForClient(failed)
        });
      }
      await taskWorkQueries.appendWorkLog(
        db,
        req.params.taskId,
        `[${new Date().toISOString()}] Admin applied dry-run (${result.idempotent ? 'already applied' : `${result.applied || 0} ops`})`
      );
      if (contextLost) {
        updates.control = 'none';
        updates.status = 'done';
        updates.awaiting_apply = '';
        updates.automation_context_lost = '';
      } else {
        // Runner is still polling — signal it so it can post the finish summary.
        updates.control = 'apply';
        updates.status = 'running';
      }
    } else if (control === 'resume') {
      // Hard stop: cannot start/resume agent work without a real description
      const plain = String(task.description || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!plain) {
        return res.status(400).json({
          error: 'Task description is required before starting the agent'
        });
      }
      // On resume/re-queue, credentials belong to the caller if no owner yet.
      // Never accept a client-supplied owner; do not overwrite an existing owner
      // (original assigner's PAT/SSH) unless missing.
      if (!workBefore.agent_owner_user_id && req.user?.id) {
        updates.agent_owner_user_id = req.user.id;
      }
      // Stale dry-run: runner is gone — Restart launches a new job instead of fake-waiting.
      if (
        workBefore.agent_mode === 'automation' &&
        workBefore.automation_pending_plan &&
        !contextLost &&
        workBefore.callback_token &&
        ['waiting', 'running'].includes(String(workBefore.status || ''))
      ) {
        updates.status = 'waiting';
        updates.control = 'none';
        updates.awaiting_apply = 'true';
      } else {
        updates.status = 'queued';
        updates.control = 'resume';
        if (workBefore.agent_mode === 'automation' || workBefore.automation_pending_plan) {
          updates.awaiting_apply = '';
          updates.automation_pending_plan = '';
          updates.automation_plan_summary = '';
          updates.automation_plan_hash = '';
          updates.automation_apply_hash = '';
          updates.automation_context_lost = '';
        }
      }
    } else if (control === 'stop') {
      updates.status = 'stopped';
      updates.control = 'stop';
      if (workBefore.automation_pending_plan) {
        updates.automation_context_lost = 'true';
      }
    } else if (control === 'pause') {
      updates.control = 'pause';
      if (workBefore.status === 'running' || workBefore.status === 'queued') {
        updates.status = 'paused';
      }
    }

    await taskWorkQueries.upsertWorkEntries(db, req.params.taskId, updates);
    await taskWorkQueries.appendWorkLog(
      db,
      req.params.taskId,
      `[${new Date().toISOString()}] User control: ${control}`
    );

    // Cancel remote job on pause/stop
    if (
      (control === 'pause' || control === 'stop') &&
      workBefore.runner_job_id
    ) {
      const cancel = await cancelJob(db, workBefore.runner_job_id, control);
      if (!cancel.ok && !cancel.missing) {
        await taskWorkQueries.appendWorkLog(
          db,
          req.params.taskId,
          `[${new Date().toISOString()}] Runner cancel warning: ${cancel.error}`
        );
      }
    }

    let work = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
    await publishWork(req, req.params.taskId, work);

    if (control === 'resume' && work.status === 'queued') {
      const tenantId = getTenantId(req);
      try {
        await tryLaunchQueuedTasks(db, tenantId, dispatchCtx(req));
        work = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
      } catch (e) {
        console.error('Agent dispatch after resume failed:', e);
      }
    }

    res.json({ work: redactWorkMapForClient(work) });
  } catch (error) {
    console.error('Task work control error:', error);
    res.status(500).json({ error: 'Failed to update control' });
  }
});

/**
 * Batch-fetch work maps for many tasks (board UI).
 * Body: { taskIds: string[] }
 * Path avoids clashing with /:taskId routes on the tasks router.
 */
router.post('/work-maps', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(workMapsBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const taskIds = parsed.data.taskIds.slice(0, 500);
    const result = {};
    const isAdmin = userHasAdminRole(req.user);
    for (const taskId of taskIds) {
      // Skip inaccessible / unknown tasks rather than failing the whole batch.
      if (!isAdmin) {
        const boardId = await taskQueries.getTaskBoardId(db, taskId);
        if (!boardId || !(await userCanAccessBoard(db, req.user, boardId))) {
          continue;
        }
      } else {
        const boardId = await taskQueries.getTaskBoardId(db, taskId);
        if (!boardId) continue;
      }
      const work = await taskWorkQueries.getWorkMapByTaskId(db, taskId);
      result[taskId] = redactWorkMapForClient(work);
    }
    res.json({ workByTaskId: result });
  } catch (error) {
    console.error('Batch task work error:', error);
    res.status(500).json({ error: 'Failed to load task work' });
  }
});

export default router;
