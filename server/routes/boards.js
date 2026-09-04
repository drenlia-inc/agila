import express from 'express';
import notificationService from '../services/notificationService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { assertBoardAccess, userHasAdminRole } from '../middleware/boardAccess.js';
import { checkBoardLimit } from '../middleware/licenseCheck.js';
import { getTranslator } from '../utils/i18n.js';
import { getDefaultBoardColumns } from '../utils/defaultBoardColumns.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
// MIGRATED: Import sqlManager
import { boards as boardQueries, tasks as taskQueries, helpers, boardParticipants as participantQueries } from '../utils/sqlManager/index.js';
import { notifyBoardWebhook } from '../services/taskEmailNotificationService.js';
import { purgeBoardCompletely } from '../services/taskPurgeService.js';
import { serverDebug } from '../utils/serverDebug.js';
import { assembleBoardsPayload } from '../utils/assembleBoardsPayload.js';
import {
  parseBody,
  createBoardBodySchema,
  updateBoardBodySchema,
  reorderBoardBodySchema,
  updateBoardParticipantsBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

// Get all boards with columns. Default includes full task payloads (login / reports).
// ?tasks=summary returns empty task arrays + taskCount for cheap background reconcile.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const isAdmin = userHasAdminRole(req.user);
    const boards = await boardQueries.getAllBoards(db, { userId: req.user.id, isAdmin });
    const tasksMode = String(req.query.tasks || 'full').toLowerCase();
    const includeTasks = tasksMode !== 'summary' && tasksMode !== 'lite';
    const boardsWithData = await assembleBoardsPayload(db, boards, { includeTasks });
    res.json(boardsWithData);
  } catch (error) {
    console.error('Error fetching boards:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToFetch', { resource: 'boards' }) });
  }
});

// One board with full task payloads (visible board hydrate after a summary list fetch).
router.get('/:boardId/full', authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    if (!(await assertBoardAccess(req, res, boardId))) return;

    const isAdmin = userHasAdminRole(req.user);
    const boards = await boardQueries.getAllBoards(db, { userId: req.user.id, isAdmin });
    const board = boards.find((b) => b.id === boardId);
    if (!board) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }

    const [assembled] = await assembleBoardsPayload(db, [board], { includeTasks: true });
    res.json(assembled);
  } catch (error) {
    console.error('Error fetching board:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToFetch', { resource: 'boards' }) });
  }
});

// Get columns for a specific board
router.get('/:boardId/columns', authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  try {
    const db = getRequestDatabase(req);
    
    const t = await getTranslator(db);
    if (!(await assertBoardAccess(req, res, boardId))) return;

    // MIGRATED: Verify board exists using sqlManager
    const board = await boardQueries.getBoardById(db, boardId);
    if (!board) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }
    
    // MIGRATED: Get columns using sqlManager
    const columns = await helpers.getColumnsForBoard(db, boardId);
    
    res.json(columns);
  } catch (error) {
    console.error('Error fetching board columns:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToFetchBoardColumns') });
  }
});

router.get('/:boardId/participants', authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  try {
    const db = getRequestDatabase(req);
    const board = await boardQueries.getBoardById(db, boardId);
    if (!board) {
      const t = await getTranslator(db);
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }
    if (!(await assertBoardAccess(req, res, boardId))) return;
    const participants = await participantQueries.listParticipants(db, boardId);
    const payload = { participants, participantCount: participants.length };
    if (userHasAdminRole(req.user)) {
      payload.candidates = await participantQueries.listCandidateUsers(db);
    }
    res.json(payload);
  } catch (error) {
    console.error('Error fetching board participants:', error);
    res.status(500).json({ error: 'Failed to fetch board participants' });
  }
});

router.put('/:boardId/participants', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { boardId } = req.params;
  const parsed = parseBody(updateBoardParticipantsBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  try {
    const db = getRequestDatabase(req);
    const board = await boardQueries.getBoardById(db, boardId);
    if (!board) {
      const t = await getTranslator(db);
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }
    const participants = await participantQueries.replaceParticipants(
      db,
      boardId,
      parsed.data.userIds
    );
    await notificationService.publish(
      'board-participants-updated',
      {
        boardId,
        participantCount: participants.length,
        userIds: participants.map((p) => p.id),
        timestamp: new Date().toISOString(),
      },
      getTenantId(req)
    );
    res.json({ participants, participantCount: participants.length });
  } catch (error) {
    console.error('Error updating board participants:', error);
    res.status(500).json({ error: 'Failed to update board participants' });
  }
});

// Get default column names for new boards (based on APP_LANGUAGE)
router.get('/default-columns', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const defaultColumns = await getDefaultBoardColumns(db);
    res.json(defaultColumns);
  } catch (error) {
    console.error('Error fetching default columns:', error);
    res.status(500).json({ error: 'Failed to fetch default columns' });
  }
});

// Create board
router.post('/', authenticateToken, checkBoardLimit, async (req, res) => {
  const parsed = parseBody(createBoardBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { id, title } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    
    // MIGRATED: Check for duplicate board name using sqlManager
    const existingBoard = await boardQueries.getBoardByTitle(db, title);
    
    if (existingBoard) {
      return res.status(400).json({ error: t('errors.boardNameExists') });
    }
    
    // MIGRATED: Generate project identifier using sqlManager
    const projectPrefix = await boardQueries.getProjectPrefix(db);
    const projectIdentifier = await boardQueries.generateProjectIdentifier(db, projectPrefix);
    
    // MIGRATED: Get max position and create board using sqlManager
    const maxPosition = await boardQueries.getMaxBoardPosition(db);
    // Always add 1 to max position (getMaxBoardPosition returns -1 if no boards exist, so -1 + 1 = 0)
    const position = maxPosition + 1;
    await boardQueries.createBoard(db, id, title, projectIdentifier, position);

    // Automatically create default columns based on APP_LANGUAGE
    const defaultColumns = await getDefaultBoardColumns(db);
    const tenantId = getTenantId(req);
    
    const columnsObj = {};
    for (const [index, col] of defaultColumns.entries()) {
      const columnId = `${col.id}-${id}`;
      const isFinished = !!col.isFinished;
      const isArchived = !!col.isArchived;
      
      // Check if column already exists (in case of partial board creation from previous attempt)
      const existingColumn = await helpers.getColumnById(db, columnId);
      if (existingColumn) {
        console.warn(`Column ${columnId} already exists, skipping creation`);
        columnsObj[columnId] = {
          id: columnId,
          title: existingColumn.title || col.title,
          boardId: id,
          position: existingColumn.position ?? index,
          is_finished: existingColumn.is_finished ?? isFinished,
          is_archived: existingColumn.is_archived ?? isArchived,
          tasks: [],
        };
        continue;
      }
      
      // MIGRATED: Create column using sqlManager
      try {
        await helpers.createColumn(db, columnId, col.title, id, index, isFinished, isArchived);
      } catch (error) {
        // Handle duplicate key errors gracefully (race condition or retry)
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
          console.warn(`Column ${columnId} already exists (duplicate key), skipping creation`);
          columnsObj[columnId] = {
            id: columnId,
            title: col.title,
            boardId: id,
            position: index,
            is_finished: isFinished,
            is_archived: isArchived,
            tasks: [],
          };
          continue;
        }
        // Re-throw other errors
        throw error;
      }

      columnsObj[columnId] = {
        id: columnId,
        title: col.title,
        boardId: id,
        position: index,
        is_finished: isFinished,
        is_archived: isArchived,
        tasks: [],
      };
      
      // Publish column creation to Redis for real-time updates
      notificationService.publish('column-created', {
        boardId: id,
        column: { 
          id: columnId, 
          title: col.title, 
          boardId: id, 
          position: index, 
          is_finished: isFinished,  // snake_case to match frontend
          is_archived: isArchived   // snake_case to match frontend
        },
        updatedBy: req.user?.id || 'system',
        timestamp: new Date().toISOString()
      }, tenantId);
    }
    
    const newBoard = {
      id,
      title,
      project: projectIdentifier,
      position,
      columns: columnsObj,
      tasksHydrated: true,
      taskCount: 0,
    };
    
    // Publish to Redis for real-time updates
    notificationService.publish('board-created', {
      boardId: id,
      board: { id, title, project: projectIdentifier, position },
      timestamp: new Date().toISOString()
    }, tenantId);

    notifyBoardWebhook(
      db,
      {
        event: 'boardCreated',
        board: { id, title, project: projectIdentifier },
        actorUserId: req.user?.id,
      },
      tenantId
    ).catch((err) => console.error('Board created webhook failed:', err));
    
    res.json(newBoard);
  } catch (error) {
    console.error('Error creating board:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToCreateBoard') });
  }
});

// MIGRATED: generateProjectIdentifier is now in sqlManager/boards.js

// Update board
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const parsed = parseBody(updateBoardBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { title, wip_limit } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    if (!(await assertBoardAccess(req, res, id))) return;
    
    // MIGRATED: Check for duplicate board name using sqlManager
    const existingBoard = await boardQueries.getBoardByTitle(db, title, id);
    
    if (existingBoard) {
      return res.status(400).json({ error: t('errors.boardNameExists') });
    }

    // Soft WIP: null/empty = unlimited
    let finalWipLimit = wip_limit;
    if (finalWipLimit === undefined) {
      finalWipLimit = undefined;
    } else if (finalWipLimit === '' || finalWipLimit === null) {
      finalWipLimit = null;
    } else {
      const n = Number(finalWipLimit);
      finalWipLimit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    
    // MIGRATED: Update board using sqlManager
    const existingForRename = await boardQueries.getBoardById(db, id);
    await boardQueries.updateBoard(db, id, title, finalWipLimit);
    const updated = await boardQueries.getBoardById(db, id);
    
    // Publish to Redis for real-time updates
    const tenantId = getTenantId(req);
    const boardPayload = {
      id,
      title,
      wip_limit: updated?.wip_limit ?? null,
    };
    await notificationService.publish('board-updated', {
      boardId: id,
      board: boardPayload,
      timestamp: new Date().toISOString()
    }, tenantId);

    if (existingForRename && String(existingForRename.title || '') !== String(title || '')) {
      notifyBoardWebhook(
        db,
        {
          event: 'boardRenamed',
          board: { id, title, project: updated?.project || existingForRename.project },
          actorUserId: req.user?.id,
          oldTitle: existingForRename.title,
        },
        tenantId
      ).catch((err) => console.error('Board renamed webhook failed:', err));
    }
    
    res.json(boardPayload);
  } catch (error) {
    console.error('Error updating board:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToUpdateBoard') });
  }
});

// Soft-delete board (admin) — also soft-deletes live tasks on the board
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || 'system';
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    const liveCount = await boardQueries.countLiveBoards(db);
    if (liveCount <= 1) {
      return res.status(400).json({ error: t('errors.cannotDeleteLastBoard') || 'Cannot delete the last board' });
    }
    const board = await boardQueries.getBoardById(db, id);
    if (!board || board.deletedAt) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }

    const taskCount = Number(await boardQueries.countAllTasksForBoard(db, id)) || 0;
    const tenantId = getTenantId(req);

    // Empty boards have nothing to restore; skip trash and delete immediately.
    if (taskCount === 0) {
      const storagePaths =
        req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths || null;
      await purgeBoardCompletely(db, id, storagePaths);
      await notificationService.publish('board-deleted', {
        boardId: id,
        boardTitle: board.title,
        permanent: true,
        softDeleted: false,
        timestamp: new Date().toISOString(),
      }, tenantId);
      notifyBoardWebhook(
        db,
        {
          event: 'boardDeleted',
          board: { id, title: board.title, project: board.project },
          actorUserId: userId,
        },
        tenantId
      ).catch((err) => console.error('Board deleted webhook failed:', err));
      return res.json({ message: 'Board permanently deleted', permanent: true });
    }

    await boardQueries.softDeleteBoard(db, id, userId);
    await taskQueries.softDeleteTasksForBoard(db, id, userId);

    await notificationService.publish('board-deleted', {
      boardId: id,
      boardTitle: board.title,
      softDeleted: true,
      timestamp: new Date().toISOString(),
    }, tenantId);
    notifyBoardWebhook(
      db,
      {
        event: 'boardDeleted',
        board: { id, title: board.title, project: board.project },
        actorUserId: userId,
      },
      tenantId
    ).catch((err) => console.error('Board deleted webhook failed:', err));

    res.json({ message: 'Board moved to trash', softDeleted: true });
  } catch (error) {
    console.error('Error soft-deleting board:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToDeleteBoard') });
  }
});

// Board trash: list soft-deleted tasks
router.get('/:id/trash', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!(await assertBoardAccess(req, res, req.params.id))) return;
    const tasks = await taskQueries.getTrashTasksForBoard(db, req.params.id);
    const count = tasks.length;
    res.json({ tasks, count });
  } catch (error) {
    console.error('Error fetching board trash:', error);
    res.status(500).json({ error: 'Failed to fetch trash' });
  }
});

router.get('/:id/trash/count', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!(await assertBoardAccess(req, res, req.params.id))) return;
    const count = await taskQueries.countTrashTasksForBoard(db, req.params.id);
    res.json({ count });
  } catch (error) {
    console.error('Error fetching trash count:', error);
    res.status(500).json({ error: 'Failed to fetch trash count' });
  }
});

// Restore soft-deleted board (admin) — tasks remain in trash
router.post('/:id/restore', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    const trashed = await boardQueries.getBoardById(db, req.params.id);
    if (!trashed || !trashed.deletedAt) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }

    // Restore to the end of the tab bar with a title no live board is using
    const title = await boardQueries.findAvailableBoardTitle(db, trashed.title);
    const position = (await boardQueries.getMaxBoardPosition(db)) + 1;
    const restored = await boardQueries.restoreBoard(db, req.params.id, { title, position });
    if (!restored) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }
    // Include column shells (no live tasks yet — they may still be in trash and restored next).
    // Peers need the board+columns in local state so subsequent task-restored events aren't dropped.
    const columnRows = await helpers.getColumnsForBoard(db, req.params.id);
    const columns = {};
    for (const col of columnRows) {
      columns[col.id] = {
        id: col.id,
        title: col.title,
        boardId: col.boardId || req.params.id,
        position: col.position,
        is_finished: col.is_finished,
        is_archived: col.is_archived,
        wip_limit: col.wip_limit,
        policy_text: col.policy_text,
        tasks: [],
      };
    }
    const boardPayload = {
      id: restored.id,
      title: restored.title,
      project: restored.project,
      position: restored.position,
      createdAt: restored.created_at || restored.createdAt,
      updatedAt: restored.updated_at || restored.updatedAt,
      deletedAt: null,
      deletedBy: null,
      columns,
    };
    await notificationService.publish('board-restored', {
      boardId: req.params.id,
      board: boardPayload,
      timestamp: new Date().toISOString(),
    }, getTenantId(req));
    res.json(boardPayload);
  } catch (error) {
    console.error('Error restoring board:', error);
    res.status(500).json({ error: 'Failed to restore board' });
  }
});

// Permanently delete board (admin)
router.delete('/:id/permanent', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    const board = await boardQueries.getBoardById(db, req.params.id);
    if (!board) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }
    if (!board.deletedAt) {
      const liveCount = await boardQueries.countLiveBoards(db);
      if (liveCount <= 1) {
        return res.status(400).json({ error: 'Cannot permanently delete the last live board' });
      }
    }
    const storagePaths =
      req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths || null;
    await purgeBoardCompletely(db, req.params.id, storagePaths);
    await notificationService.publish('board-deleted', {
      boardId: req.params.id,
      boardTitle: board.title,
      permanent: true,
      timestamp: new Date().toISOString(),
    }, getTenantId(req));
    notifyBoardWebhook(
      db,
      {
        event: 'boardDeleted',
        board: { id: req.params.id, title: board.title, project: board.project },
        actorUserId: req.user?.id,
      },
      getTenantId(req)
    ).catch((err) => console.error('Board deleted webhook failed:', err));
    res.json({ message: 'Board permanently deleted' });
  } catch (error) {
    console.error('Error permanently deleting board:', error);
    res.status(500).json({ error: 'Failed to permanently delete board' });
  }
});

// Reorder boards
router.post('/reorder', authenticateToken, async (req, res) => {
  const parsed = parseBody(reorderBoardBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { boardId, newPosition } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    console.log(`[Board Reorder] boardId: ${boardId}, newPosition: ${newPosition}`);
    // MIGRATED: Get board using sqlManager
    const currentBoard = await boardQueries.getBoardById(db, boardId);
    if (!currentBoard) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }

    // MIGRATED: Get all boards with positions using sqlManager
    const allBoards = await boardQueries.getAllBoardsWithPositions(db);

    // Find the current index of the board being moved
    const currentIndex = allBoards.findIndex(b => b.id === boardId);
    
    if (currentIndex === -1) {
      return res.status(404).json({ error: t('errors.boardNotFound') });
    }
    
    // Only proceed if the position is actually changing
    if (currentIndex === newPosition) {
      return res.json({ message: 'Board position unchanged' });
    }
    
    // Normalize positions to ensure they're sequential (0, 1, 2, 3, etc.)
    // This handles any gaps or inconsistencies in positions
    const normalizedBoards = allBoards.map((board, index) => ({ ...board, position: index }));
    const normalizedCurrentIndex = normalizedBoards.findIndex(b => b.id === boardId);
    
    
    // Collect queries and send as a batched transaction
    const batchQueries = [];
    const updateQuery = 'UPDATE boards SET position = ? WHERE id = ?';
    
    // Only reset positions if there are gaps or inconsistencies
    // Check if positions need normalization
    const needsNormalization = allBoards.some((board, index) => {
      const pos = typeof board.position === 'number' ? board.position : parseInt(board.position) || 0;
      return pos !== index;
    });
    
    if (needsNormalization) {
      // Reset all positions to sequential integers
      for (let index = 0; index < allBoards.length; index++) {
        batchQueries.push({
          query: updateQuery,
          params: [index, allBoards[index].id]
        });
      }
    }
    
    // Swap positions if needed
    if (normalizedCurrentIndex !== -1 && normalizedCurrentIndex !== newPosition) {
      const targetBoard = normalizedBoards[newPosition];
      if (targetBoard) {
        // If we didn't normalize, we need to update the specific positions
        if (!needsNormalization) {
          batchQueries.push({
            query: updateQuery,
            params: [newPosition, boardId]
          });
          batchQueries.push({
            query: updateQuery,
            params: [normalizedCurrentIndex, targetBoard.id]
          });
        } else {
          // Positions were already reset, just swap the two
          batchQueries.push({
            query: updateQuery,
            params: [newPosition, boardId]
          });
          batchQueries.push({
            query: updateQuery,
            params: [normalizedCurrentIndex, targetBoard.id]
          });
        }
      }
    }
    
    // Execute all updates in a single batched transaction
    await db.executeBatchTransaction(batchQueries);


    // Publish to Redis for real-time updates
    const tenantId = getTenantId(req);
    await notificationService.publish('board-reordered', {
      boardId: boardId,
      newPosition: newPosition,
      timestamp: new Date().toISOString()
    }, tenantId);

    res.json({ message: 'Board reordered successfully' });
  } catch (error) {
    console.error('Error reordering board:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToReorderBoard') });
  }
});

// Get all task relationships for a board
router.get('/:boardId/relationships', authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  try {
    const db = getRequestDatabase(req);
    if (!(await assertBoardAccess(req, res, boardId))) return;

    // MIGRATED: Get all relationships for tasks in this board using sqlManager
    const relationships = await boardQueries.getBoardTaskRelationships(db, boardId);

    if (await serverDebug(db, 'SERVER_DEBUG_HTTP')) {
      console.log(`🔗 [getBoardTaskRelationships] Found ${relationships.length} relationships for board ${boardId}`, relationships);
    }
    
    res.json(relationships);
  } catch (error) {
    console.error('Error fetching board relationships:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToFetchBoardRelationships') });
  }
});

export default router;
