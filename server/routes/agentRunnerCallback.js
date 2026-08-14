/**
 * Runner → Easy Kanban callbacks (auth via per-job callback_token, not user JWT).
 */

import express from 'express';
import crypto from 'crypto';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import {
  tasks as taskQueries,
  taskWork as taskWorkQueries,
  comments as commentQueries
} from '../utils/sqlManager/index.js';
import { AGENT_MEMBER_ID, AGENT_USER_ID } from '../constants/agentIdentity.js';
import { AGENT_ACTIONS, COMMENT_ACTIONS } from '../constants/activityActions.js';
import { logCommentActivity, logTaskActivity } from '../services/activityLogger.js';
import notificationService from '../services/notificationService.js';
import { tryLaunchQueuedTasks } from '../services/agentJobDispatcher.js';
import { requireAiEnabledMiddleware } from '../utils/aiEnabled.js';
import { markdownToHtml } from '../utils/markdownToHtml.js';
import { stripModelReasoning } from '../utils/stripModelReasoning.js';
import { parseBody, agentRunnerCallbackBodySchema } from '../utils/requestValidation.js';

const router = express.Router();
const requireAi = requireAiEnabledMiddleware(getRequestDatabase);

router.use(requireAi);

async function publishWork(req, taskId) {
  const db = getRequestDatabase(req);
  const task = await taskQueries.getTaskById(db, taskId);
  const work = await taskWorkQueries.getWorkMapByTaskId(db, taskId);
  await notificationService.publish(
    'task-work-updated',
    {
      taskId,
      boardId: task?.boardid || task?.boardId,
      work,
      timestamp: new Date().toISOString()
    },
    getTenantId(req)
  );
  return work;
}

/**
 * POST /callback
 * Headers: X-Agent-Callback-Token: <token>
 * Body: { jobId, taskId, event, progress?, log?, comment?, status?, prUrl?, branch? }
 */
router.post('/callback', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(agentRunnerCallbackBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const body = parsed.data;
    const token =
      req.get('x-agent-callback-token') ||
      body.callbackToken ||
      '';
    const taskId = String(body.taskId || '').trim();
    const jobId = String(body.jobId || '').trim();
    const event = String(body.event || '').trim().toLowerCase();

    if (!taskId || !token || !event) {
      return res.status(400).json({ error: 'taskId, callbackToken, and event are required' });
    }

    const work = await taskWorkQueries.getWorkMapByTaskId(db, taskId);
    if (!work.callback_token || work.callback_token !== token) {
      return res.status(401).json({ error: 'Invalid callback token' });
    }
    if (work.runner_job_id && jobId && work.runner_job_id !== jobId) {
      return res.status(409).json({ error: 'jobId does not match this task' });
    }

    const task = await taskQueries.getTaskById(db, taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updates = {};
    const terminal = ['done', 'failed', 'stopped', 'cancelled'].includes(event);
    const alreadyUndone = work.status === 'undone';

    if (body.progress !== undefined && body.progress !== null && !alreadyUndone) {
      updates.progress = String(body.progress);
    }
    if (body.prUrl) {
      updates.pr_url = String(body.prUrl);
    }
    if (body.branch) {
      updates.agent_branch = String(body.branch);
    }

    if (body.log) {
      await taskWorkQueries.appendWorkLog(db, taskId, String(body.log));
    }

    if (body.comment) {
      try {
        const commentId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        // Agent replies are Markdown; TipTap UI expects HTML
        const cleaned = stripModelReasoning(String(body.comment));
        const htmlBody = markdownToHtml(cleaned || String(body.comment));
        const normalizeComment = (s) =>
          String(s || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const existingComments = await commentQueries.getCommentsForTask(db, taskId);
        const lastAgent = [...existingComments].reverse().find((c) => c.authorId === AGENT_MEMBER_ID);
        if (lastAgent && normalizeComment(lastAgent.text) === normalizeComment(htmlBody)) {
          // Same summary posted twice (empty-plan progress + done)
        } else {
          await commentQueries.createComment(
          db,
          commentId,
          taskId,
          htmlBody,
          AGENT_MEMBER_ID,
          createdAt
        );
        const created = await commentQueries.getCommentById(db, commentId);
        const tenantId = getTenantId(req);
        await notificationService.publish(
          'comment-created',
          {
            taskId,
            comment: created,
            boardId: task.boardid || task.boardId,
            timestamp: new Date().toISOString()
          },
          tenantId
        );
        logCommentActivity(
          AGENT_USER_ID,
          COMMENT_ACTIONS.CREATE,
          commentId,
          taskId,
          'agent comment',
          { db, tenantId, commentContent: htmlBody }
        ).catch((err) => console.error('Agent comment activity log failed:', err));
        }
      } catch (e) {
        console.error('Runner callback comment error:', e);
      }
    }

    // Do not overwrite an admin Undo outcome with a late runner terminal event
    if (alreadyUndone) {
      if (terminal) {
        updates.callback_token = '';
        updates.waiting_for_slot = '';
        updates.control = 'none';
        updates.awaiting_apply = '';
      }
      if (Object.keys(updates).length) {
        await taskWorkQueries.upsertWorkEntries(db, taskId, updates);
      }
      await publishWork(req, taskId);
      if (terminal) {
        const tenantId = getTenantId(req);
        setImmediate(() => {
          tryLaunchQueuedTasks(db, tenantId).catch((e) =>
            console.error('Dispatcher after callback failed:', e)
          );
        });
      }
      return res.json({ ok: true, preservedStatus: 'undone' });
    }

    if (event === 'progress' || event === 'log') {
      if (body.status) {
        updates.status = String(body.status);
      }
    } else if (event === 'done') {
      updates.status = 'done';
      updates.control = 'none';
      updates.awaiting_apply = '';
    } else if (event === 'failed') {
      updates.status = 'failed';
      updates.control = 'none';
      updates.awaiting_apply = '';
    } else if (event === 'stopped' || event === 'cancelled') {
      updates.status = 'stopped';
      updates.control = 'stop';
      updates.awaiting_apply = '';
    } else if (body.status) {
      updates.status = String(body.status);
    }

    if (terminal) {
      updates.callback_token = '';
      updates.waiting_for_slot = '';
    }

    if (Object.keys(updates).length) {
      await taskWorkQueries.upsertWorkEntries(db, taskId, updates);
    }

    await publishWork(req, taskId);

    if (terminal) {
      const tenantId = getTenantId(req);
      const prUrl =
        updates.pr_url ||
        body.prUrl ||
        work.pr_url ||
        '';
      if (event === 'done') {
        logTaskActivity(
          AGENT_USER_ID,
          AGENT_ACTIONS.JOB_DONE,
          taskId,
          'agent job done',
          {
            db,
            tenantId,
            boardId: task.boardid || task.boardId,
            columnId: task.columnid || task.columnId,
            prUrl: prUrl || undefined
          }
        ).catch((err) => console.error('Agent done activity log failed:', err));
      } else if (event === 'failed') {
        logTaskActivity(
          AGENT_USER_ID,
          AGENT_ACTIONS.JOB_FAILED,
          taskId,
          'agent job failed',
          {
            db,
            tenantId,
            boardId: task.boardid || task.boardId,
            columnId: task.columnid || task.columnId
          }
        ).catch((err) => console.error('Agent failed activity log failed:', err));
      }
      setImmediate(() => {
        tryLaunchQueuedTasks(db, tenantId).catch((e) =>
          console.error('Dispatcher after callback failed:', e)
        );
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Runner callback error:', error);
    res.status(500).json({ error: 'Callback failed' });
  }
});

export default router;
