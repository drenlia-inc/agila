import express from 'express';
import { wrapQuery } from '../utils/queryLogger.js';
import notificationService from '../services/notificationService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { checkBoardLimit } from '../middleware/licenseCheck.js';
import { getTranslator } from '../utils/i18n.js';
import { getDefaultBoardColumns } from '../utils/defaultBoardColumns.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
// MIGRATED: Import sqlManager
import { boards as boardQueries, tasks as taskQueries, helpers } from '../utils/sqlManager/index.js';
import { purgeBoardCompletely, purgeTaskCompletelyAndUpdateStorage } from '../services/taskPurgeService.js';
import { serverDebug } from '../utils/serverDebug.js';
import {
  parseBody,
  createBoardBodySchema,
  updateBoardBodySchema,
  reorderBoardBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

// Get all boards with columns and tasks (including tags)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Use sqlManager
    const boards = await boardQueries.getAllBoards(db);

    // OPTIMIZATION: Batch fetch all columns for all boards first
    const allBoardIds = boards.map(b => b.id);
    const allColumns = allBoardIds.length > 0 
      ? await helpers.getColumnsForAllBoards(db, allBoardIds)
      : [];
    
    // Group columns by boardid
    const columnsByBoardId = {};
    allColumns.forEach(column => {
      if (!columnsByBoardId[column.boardId]) {
        columnsByBoardId[column.boardId] = [];
      }
      columnsByBoardId[column.boardId].push(column);
    });
    
    // OPTIMIZATION: Batch fetch all tasks for all columns
    const allColumnIds = allColumns.map(c => c.id);
    const allTasks = allColumnIds.length > 0
      ? await taskQueries.getTasksForColumns(db, allColumnIds)
      : [];
    
    // Group tasks by columnid
    const tasksByColumnId = {};
    allTasks.forEach(task => {
      if (!tasksByColumnId[task.columnId]) {
        tasksByColumnId[task.columnId] = [];
      }
      tasksByColumnId[task.columnId].push(task);
    });
    
    // Collect all comment IDs for batch attachment fetch
    const allCommentIds = allTasks.flatMap(task => {
      const parseJsonField = (field) => {
        if (!field || field === '[]' || field === '[null]') return [];
        if (Array.isArray(field)) return field.filter(Boolean);
        if (typeof field === 'string') {
          try {
            const parsed = JSON.parse(field);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : (parsed ? [parsed] : []);
          } catch {
            return [];
          }
        }
        return [];
      };
      const comments = parseJsonField(task.comments);
      return comments.map(c => c.id).filter(Boolean);
    });
    
    // OPTIMIZATION: Batch fetch all attachments for all comments in one query
    const allAttachments = allCommentIds.length > 0
      ? await helpers.getAttachmentsForComments(db, allCommentIds)
      : [];
    
    // Group attachments by commentid
    const attachmentsByCommentId = {};
    allAttachments.forEach(att => {
      const commentId = att.commentId || att.commentid;
      if (!attachmentsByCommentId[commentId]) {
        attachmentsByCommentId[commentId] = [];
      }
      attachmentsByCommentId[commentId].push(att);
    });
    
    // Helper functions for processing
    const parseJsonField = (field) => {
      if (field === null || field === undefined || field === '' || field === '[null]' || field === 'null') {
        return [];
      }
      if (Array.isArray(field)) {
        return field.filter(Boolean);
      }
      if (typeof field === 'object') {
        return Array.isArray(field) ? field.filter(Boolean) : [field].filter(Boolean);
      }
      if (typeof field === 'string') {
        const trimmed = field.trim();
        if (!trimmed || trimmed === '[]' || trimmed === '[null]' || trimmed === 'null') {
          return [];
        }
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : (parsed ? [parsed] : []);
        } catch (e) {
          console.warn('Failed to parse JSON field:', e.message, 'Value:', field);
          return [];
        }
      }
      return [];
    };
    
    const deduplicateById = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        if (!item || !item.id) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    };
    
    // Process boards with pre-fetched data
    const boardsWithData = boards.map(board => {
      const columns = columnsByBoardId[board.id] || [];
      const columnsObj = {};
      
      columns.forEach(column => {
        const tasksRaw = tasksByColumnId[column.id] || [];
        
        const tasks = tasksRaw.map(task => ({
          ...task,
          priority: task.priorityName || null,
          priorityId: task.priorityId || null,
          priorityName: task.priorityName || null,
          priorityColor: task.priorityColor || null,
          sprintId: task.sprint_id || null,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          columnEnteredAt: task.columnEnteredAt || task.column_entered_at || null,
          isBlocked: Boolean(task.isBlocked ?? task.is_blocked),
          blockedReason: task.blockedReason || task.blocked_reason || null,
          comments: deduplicateById(parseJsonField(task.comments)).map(comment => ({
            ...comment,
            attachments: attachmentsByCommentId[comment.id] || []
          })),
          tags: deduplicateById(parseJsonField(task.tags)),
          watchers: deduplicateById(parseJsonField(task.watchers)),
          collaborators: deduplicateById(parseJsonField(task.collaborators))
        }));
        
        columnsObj[column.id] = {
          ...column,
          tasks: tasks
        };
      });
      
      return {
        ...board,
        columns: columnsObj
      };
    });


    res.json(boardsWithData);
  } catch (error) {
    console.error('Error fetching boards:', error);
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
    
    for (const [index, col] of defaultColumns.entries()) {
      const columnId = `${col.id}-${id}`;
      const isFinished = !!col.isFinished;
      const isArchived = !!col.isArchived;
      
      // Check if column already exists (in case of partial board creation from previous attempt)
      const existingColumn = await helpers.getColumnById(db, columnId);
      if (existingColumn) {
        console.warn(`Column ${columnId} already exists, skipping creation`);
        continue;
      }
      
      // MIGRATED: Create column using sqlManager
      try {
        await helpers.createColumn(db, columnId, col.title, id, index, isFinished, isArchived);
      } catch (error) {
        // Handle duplicate key errors gracefully (race condition or retry)
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
          console.warn(`Column ${columnId} already exists (duplicate key), skipping creation`);
          continue;
        }
        // Re-throw other errors
        throw error;
      }
      
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
    
    const newBoard = { id, title, project: projectIdentifier, position };
    
    // Publish to Redis for real-time updates
    notificationService.publish('board-created', {
      boardId: id,
      board: newBoard,
      timestamp: new Date().toISOString()
    }, tenantId);
    
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
