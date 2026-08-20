import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import { tasks as taskQueries, boards as boardQueries } from '../utils/sqlManager/index.js';
import {
  purgeTaskCompletelyAndUpdateStorage,
  purgeBoardCompletely,
} from '../services/taskPurgeService.js';
import notificationService from '../services/notificationService.js';
import {
  parseBody,
  taskIdsBatchBodySchema,
  boardIdsBatchBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

router.use(authenticateToken, requireRole(['admin']));

/** Lightweight counts for Admin tab badges (not capped by list LIMIT) */
router.get('/summary', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const [deletedTasks, deletedBoards] = await Promise.all([
      taskQueries.countLifecycleDeletedTasks(db),
      boardQueries.countDeletedBoards(db),
    ]);
    res.json({
      deletedTasks: Number(deletedTasks) || 0,
      deletedBoards: Number(deletedBoards) || 0,
    });
  } catch (error) {
    console.error('Lifecycle summary error:', error);
    res.status(500).json({ error: 'Failed to load lifecycle summary' });
  }
});

/** Soft-deleted tasks across boards */
router.get('/tasks', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const boardId = req.query.boardId || null;
    const q = req.query.q || null;
    const tasks = await taskQueries.getLifecycleDeletedTasks(db, boardId, q);
    res.json({ tasks });
  } catch (error) {
    console.error('Lifecycle tasks error:', error);
    res.status(500).json({ error: 'Failed to load deleted tasks' });
  }
});

/** Soft-deleted boards */
router.get('/boards', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const boards = await boardQueries.getDeletedBoards(db);
    res.json({ boards });
  } catch (error) {
    console.error('Lifecycle boards error:', error);
    res.status(500).json({ error: 'Failed to load deleted boards' });
  }
});

router.post('/tasks/restore-batch', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(taskIdsBatchBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { taskIds } = parsed.data;
    // Delegate to same restore logic by calling sql directly for each (client can also call /tasks/:id/restore)
    const restored = [];
    const errors = [];
    for (const taskId of taskIds) {
      try {
        // Use fetch-style internal: set req.params and call is heavy — inline minimal restore
        const task = await taskQueries.getTaskById(db, taskId);
        if (!task || !(task.deleted_at || task.deletedAt)) {
          errors.push({ taskId, code: 'not_found' });
          continue;
        }
        const boardId = task.boardid || task.boardId;
        const board = await boardQueries.getBoardById(db, boardId);
        if (!board) {
          errors.push({ taskId, code: 'board_gone' });
          continue;
        }
        if (board.deletedAt) {
          errors.push({ taskId, code: 'board_soft_deleted' });
          continue;
        }
        const { helpers } = await import('../utils/sqlManager/index.js');
        const boardColumns = await helpers.getColumnsForBoard(db, boardId);
        const originalColumnId = task.columnid || task.columnId;
        const originalPosition = Number(task.position);
        let columnId = originalColumnId;
        let usedOriginalColumn = true;
        if (!(boardColumns || []).some((c) => c.id === columnId)) {
          usedOriginalColumn = false;
          const nonArchived = (boardColumns || []).find(
            (c) => !(c.is_archived === true || c.is_archived === 1)
          );
          if (!nonArchived) {
            errors.push({ taskId, code: 'no_column' });
            continue;
          }
          columnId = nonArchived.id;
        }
        let position;
        let shifted = [];
        if (usedOriginalColumn && Number.isFinite(originalPosition) && originalPosition >= 0) {
          position = originalPosition;
          shifted = await taskQueries.shiftLiveTasksFromPosition(db, columnId, position);
        } else {
          const maxPos = await taskQueries.getMaxLivePositionInColumn(db, columnId);
          position = Number(maxPos) + 1;
        }
        await taskQueries.restoreTask(db, taskId, columnId, boardId, position);
        const fullRaw = await taskQueries.getTaskWithRelationships(db, taskId);
        const full = {
          ...fullRaw,
          columnId: fullRaw.columnId || fullRaw.columnid || columnId,
          boardId: fullRaw.boardId || fullRaw.boardid || boardId,
          memberId: fullRaw.memberId || fullRaw.memberid,
          requesterId: fullRaw.requesterId || fullRaw.requesterid,
          startDate: fullRaw.startDate || fullRaw.startdate,
          dueDate: fullRaw.dueDate || fullRaw.duedate,
          columnEnteredAt: fullRaw.columnEnteredAt || fullRaw.column_entered_at || null,
          isBlocked: Boolean(fullRaw.isBlocked ?? fullRaw.is_blocked),
          blockedReason: fullRaw.blockedReason || fullRaw.blocked_reason || null,
          position,
          deletedAt: null,
          deletedBy: null,
          deleted_at: null,
          deleted_by: null,
        };
        const tenantId = getTenantId(req);
        if (shifted.length > 0) {
          await notificationService.publish(
            'tasks-positions-updated',
            {
              boardId,
              updates: shifted.map((row) => ({
                taskId: row.id,
                position: typeof row.position === 'number' ? row.position : parseFloat(row.position) || 0,
                columnId: row.columnId || columnId,
              })),
              timestamp: new Date().toISOString(),
            },
            tenantId
          );
        }
        await notificationService.publish(
          'task-restored',
          { boardId, task: full, timestamp: new Date().toISOString() },
          tenantId
        );
        restored.push(taskId);
      } catch (e) {
        errors.push({ taskId, error: e.message });
      }
    }
    res.json({ restored, errors });
  } catch (error) {
    console.error('Lifecycle restore-batch error:', error);
    res.status(500).json({ error: 'Failed to restore tasks' });
  }
});

router.post('/tasks/purge-batch', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(taskIdsBatchBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { taskIds } = parsed.data;
    const storagePaths =
      req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths || null;
    const purged = [];
    for (const taskId of taskIds) {
      const task = await taskQueries.getTaskById(db, taskId);
      if (!task) continue;
      const boardId = task.boardid || task.boardId;
      await purgeTaskCompletelyAndUpdateStorage(db, taskId, storagePaths);
      await notificationService.publish(
        'task-purged',
        { boardId, taskId, timestamp: new Date().toISOString() },
        getTenantId(req)
      );
      purged.push(taskId);
    }
    res.json({ purged });
  } catch (error) {
    console.error('Lifecycle purge-batch error:', error);
    res.status(500).json({ error: 'Failed to purge tasks' });
  }
});

/** Permanently delete soft-deleted boards (and all their tasks) */
router.post('/boards/purge-batch', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(boardIdsBatchBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { boardIds } = parsed.data;
    const storagePaths =
      req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths || null;
    const purged = [];
    const errors = [];
    const tenantId = getTenantId(req);

    for (const boardId of boardIds) {
      try {
        const board = await boardQueries.getBoardById(db, boardId);
        if (!board) {
          errors.push({ boardId, code: 'not_found' });
          continue;
        }
        if (!board.deletedAt) {
          errors.push({ boardId, code: 'not_soft_deleted' });
          continue;
        }
        await purgeBoardCompletely(db, boardId, storagePaths);
        await notificationService.publish(
          'board-deleted',
          {
            boardId,
            boardTitle: board.title,
            permanent: true,
            timestamp: new Date().toISOString(),
          },
          tenantId
        );
        purged.push(boardId);
      } catch (err) {
        console.error(`Lifecycle board purge failed for ${boardId}:`, err);
        errors.push({ boardId, code: 'purge_failed' });
      }
    }

    res.json({ purged, errors });
  } catch (error) {
    console.error('Lifecycle boards purge-batch error:', error);
    res.status(500).json({ error: 'Failed to purge boards' });
  }
});

export default router;
