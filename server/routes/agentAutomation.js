/**
 * Automation API — job-scoped token auth (ea_…), not user JWT.
 * Mounted at /api/agent/automation
 */

import express from 'express';
import crypto from 'crypto';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import { requireAiEnabledMiddleware } from '../utils/aiEnabled.js';
import { validateAutomationToken } from '../utils/automationToken.js';
import {
  taskWork as taskWorkQueries,
  tasks as taskQueries,
  comments as commentQueries,
  automationJournal
} from '../utils/sqlManager/index.js';
import {
  executeTool,
  applyStoredPlan,
  undoJob,
  buildDryRunArtifactCsv
} from '../services/automationTools.js';
import { AGENT_MEMBER_ID, AGENT_USER_ID } from '../constants/agentIdentity.js';
import notificationService from '../services/notificationService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { COMMENT_ACTIONS } from '../constants/activityActions.js';
import { logCommentActivity } from '../services/activityLogger.js';
import { markdownToHtml } from '../utils/markdownToHtml.js';
import { parseBody, agentToolCallBodySchema } from '../utils/requestValidation.js';
import { redactWorkMapForClient } from '../utils/taskWorkPublic.js';

const router = express.Router();
const requireAi = requireAiEnabledMiddleware(getRequestDatabase);

async function publishWork(req, taskId) {
  const db = getRequestDatabase(req);
  const task = await taskQueries.getTaskById(db, taskId);
  const work = await taskWorkQueries.getWorkMapByTaskId(db, taskId);
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
  return work;
}

/**
 * Resolve Bearer ea_… automation token into ctx.
 */
async function requireAutomationToken(req, res, next) {
  try {
    const db = getRequestDatabase(req);
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    const raw = match?.[1]?.trim() || '';
    const auth = await validateAutomationToken(db, raw);
    if (!auth) {
      return res.status(401).json({ error: 'Invalid or expired automation token' });
    }
    req.automationAuth = auth;
    req.automationCtx = {
      db,
      tenantId: getTenantId(req),
      jobId: auth.jobId,
      launchTaskId: auth.taskId,
      ownerUserId: auth.ownerUserId,
      scopeType: auth.scopeType,
      boardIds: auth.boardIds,
      launchBoardId: Array.isArray(auth.boardIds) ? auth.boardIds[0] || '' : '',
      agentMemberId: AGENT_MEMBER_ID
    };
    next();
  } catch (error) {
    console.error('Automation token auth failed:', error);
    return res.status(500).json({ error: 'Failed to authenticate automation token' });
  }
}

router.use(requireAi);

/** Runner: execute a single tool */
router.post('/tools', requireAutomationToken, async (req, res) => {
  try {
    const parsed = parseBody(agentToolCallBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const name = String(parsed.data.name || '').trim();
    const args = parsed.data.arguments || parsed.data.args || {};
    const dryRun = Boolean(parsed.data.dryRun);
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await executeTool(req.automationCtx, name, args, { dryRun });
    if (name === 'submit_dry_run_plan') {
      await publishWork(req, req.automationCtx.launchTaskId);
    }
    res.json({ ok: !result?.error, result });
  } catch (error) {
    console.error('Automation tool error:', error);
    res.status(500).json({ error: 'Tool execution failed' });
  }
});

/** Runner / status poll */
router.get('/status', requireAutomationToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const work = await taskWorkQueries.getWorkMapByTaskId(
      db,
      req.automationCtx.launchTaskId
    );
    res.json({
      status: work.status || null,
      control: work.control || 'none',
      awaitingApply: work.awaiting_apply === 'true',
      progress: work.progress || null
    });
  } catch (error) {
    console.error('Automation status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/** Execute stored dry-run plan (called by runner after Apply) */
router.post('/apply', requireAutomationToken, async (req, res) => {
  try {
    const result = await applyStoredPlan(req.automationCtx);
    await publishWork(req, req.automationCtx.launchTaskId);
    res.json(result);
  } catch (error) {
    console.error('Automation apply error:', error);
    res.status(500).json({ error: 'Apply failed' });
  }
});

/** Admin undo via JWT (activity screen) */
router.post(
  '/undo/:taskId',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const db = getRequestDatabase(req);
      const taskId = req.params.taskId;
      const work = await taskWorkQueries.getWorkMapByTaskId(db, taskId);
      const jobId = work.runner_job_id || work.automation_token_id;
      if (!jobId) {
        return res.status(400).json({ error: 'No automation job to undo' });
      }
      const undoable = await automationJournal.countUndoable(db, jobId);
      if (!undoable) {
        return res.status(400).json({
          error: 'Nothing to undo',
          alreadyUndone: work.status === 'undone' || work.automation_undoable === 'false'
        });
      }
      const ctx = {
        db,
        tenantId: getTenantId(req),
        jobId,
        launchTaskId: taskId,
        ownerUserId: req.user.id,
        scopeType: work.automation_scope || 'this_board',
        boardIds: [],
        agentMemberId: AGENT_MEMBER_ID
      };
      try {
        ctx.boardIds = JSON.parse(work.automation_board_ids || '[]');
      } catch {
        ctx.boardIds = [];
      }
      const result = await undoJob(ctx);
      const undoneCount = result.undone || 0;
      const undoneAt = new Date().toISOString();
      const summary =
        undoneCount === 1
          ? 'Undid the last Apply (1 operation restored).'
          : `Undid the last Apply (${undoneCount} operations restored).`;

      await taskWorkQueries.appendWorkLog(
        db,
        taskId,
        `[${undoneAt}] Admin undid automation (${undoneCount} ops)`
      );
      await taskWorkQueries.upsertWorkEntries(db, taskId, {
        status: 'undone',
        control: 'none',
        automation_undoable: 'false',
        automation_undone_at: undoneAt,
        automation_undo_summary: summary
      });

      // Visible audit trail on the recipe task
      try {
        const commentId = crypto.randomUUID();
        const htmlBody = markdownToHtml(summary);
        await commentQueries.createComment(
          db,
          commentId,
          taskId,
          htmlBody,
          AGENT_MEMBER_ID,
          undoneAt
        );
        const created = await commentQueries.getCommentById(db, commentId);
        const task = await taskQueries.getTaskById(db, taskId);
        const tenantId = getTenantId(req);
        await notificationService.publish(
          'comment-created',
          {
            taskId,
            comment: created,
            boardId: task?.boardid || task?.boardId,
            timestamp: undoneAt
          },
          tenantId
        );
        logCommentActivity(
          AGENT_USER_ID,
          COMMENT_ACTIONS.CREATE,
          commentId,
          taskId,
          'automation undo',
          { db, tenantId, commentContent: htmlBody }
        ).catch((err) => console.error('Automation undo comment activity failed:', err));
      } catch (commentErr) {
        console.error('Automation undo comment failed:', commentErr);
      }

      const updatedWork = await publishWork(req, taskId);
      res.json({
        ok: true,
        undone: undoneCount,
        summary,
        work: updatedWork
      });
    } catch (error) {
      console.error('Automation undo error:', error);
      res.status(500).json({ error: 'Undo failed' });
    }
  }
);

/** Admin: attach dry-run CSV artifact (optional helper) */
router.post(
  '/dry-run-artifact/:taskId',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const db = getRequestDatabase(req);
      const work = await taskWorkQueries.getWorkMapByTaskId(db, req.params.taskId);
      let plan = null;
      try {
        plan = JSON.parse(work.automation_pending_plan || 'null');
      } catch {
        plan = null;
      }
      if (!plan) {
        return res.status(400).json({ error: 'No pending plan' });
      }
      const csv = buildDryRunArtifactCsv(
        { db, launchTaskId: req.params.taskId },
        plan
      );
      res.type('text/csv').send(csv);
    } catch (error) {
      console.error('Dry-run artifact error:', error);
      res.status(500).json({ error: 'Failed to build artifact' });
    }
  }
);

export default router;
