import express from 'express';
import { wrapQuery } from '../utils/queryLogger.js';
import notificationService from '../services/notificationService.js';
import { authenticateToken } from '../middleware/auth.js';
import { assertBoardAccess } from '../middleware/boardAccess.js';
import { getTranslator } from '../utils/i18n.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
import { dbTransaction } from '../utils/dbAsync.js';
// MIGRATED: Import sqlManager
import { helpers, tasks as taskQueries } from '../utils/sqlManager/index.js';
import {
  parseBody,
  createColumnBodySchema,
  updateColumnBodySchema,
  reorderColumnBodySchema,
  renumberColumnsBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

// Create column
router.post('/', authenticateToken, async (req, res) => {
  const parsed = parseBody(createColumnBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { id, title, boardId, position } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    if (!(await assertBoardAccess(req, res, boardId))) return;
    const t = await getTranslator(db);
    
    // MIGRATED: Check for duplicate column name using sqlManager
    const existingColumn = await helpers.getColumnByTitleInBoard(db, boardId, title);
    
    if (existingColumn) {
      return res.status(400).json({ error: t('errors.columnNameExists') });
    }
    
    // MIGRATED: Get finished column names from settings using sqlManager
    const finishedColumnNamesSetting = await helpers.getSetting(db, 'DEFAULT_FINISHED_COLUMN_NAMES');
    
    let finishedColumnNames = ['Done', 'Terminé', 'Completed', 'Complété', 'Finished', 'Fini']; // Default values
    if (finishedColumnNamesSetting) {
      try {
        finishedColumnNames = JSON.parse(finishedColumnNamesSetting);
      } catch (error) {
        console.error('Error parsing finished column names:', error);
      }
    }
    
    // Check if this column should be marked as finished
    const isFinished = finishedColumnNames.some(finishedName => 
      finishedName.toLowerCase() === title.toLowerCase()
    );
    
    // Check if this column should be marked as archived (auto-detect "Archive" column)
    const isArchived = title.toLowerCase() === 'archive';

    // Client sends (afterColumn.position + 0.5) or (afterColumn.position + 1) to insert to the RIGHT
    // of that column. Using Math.floor (old code) turned 1.5 into 1 — same slot as the anchor column.
    // Use ceil so 1.5 -> 2, then shift existing columns at >= insertAt to make room.
    let allColumns;
    await dbTransaction(db, async () => {
      let insertPosition;
      if (position !== undefined && position !== null) {
        const num = Number(position);
        if (Number.isNaN(num)) {
          const maxPos = await helpers.getMaxColumnPosition(db, boardId);
          insertPosition = maxPos + 1;
        } else {
          insertPosition = Math.max(0, Math.ceil(num));
          const maxPos = await helpers.getMaxColumnPosition(db, boardId);
          if (maxPos >= insertPosition) {
            await helpers.shiftColumnPositions(db, boardId, insertPosition, maxPos, 1, null);
          }
        }
      } else {
        const maxPos = await helpers.getMaxColumnPosition(db, boardId);
        insertPosition = maxPos + 1;
      }

      await helpers.createColumn(db, id, title, boardId, insertPosition, isFinished, isArchived);
      // Immediate 0..n-1 renumber so DB, API, and realtime always agree on order
      allColumns = await helpers.renumberBoardColumnPositions(db, boardId);
    });

    const self = allColumns.find((c) => c.id === id);
    const finalPosition = self?.position ?? 0;

    // Publish full layout so clients rebuild columns state (same pattern as column-reordered)
    const tenantId = getTenantId(req);
    await notificationService.publish('column-created', {
      boardId: boardId,
      column: {
        id,
        title,
        boardId,
        position: finalPosition,
        is_finished: isFinished,
        is_archived: isArchived,
      },
      columns: allColumns,
      updatedBy: req.user?.id || 'system',
      timestamp: new Date().toISOString(),
    }, tenantId);

    res.json({
      id,
      title,
      boardId,
      position: finalPosition,
      is_finished: isFinished,
      is_archived: isArchived,
      columns: allColumns,
    });
  } catch (error) {
    console.error('Error creating column:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToCreateColumn') });
  }
});

// Update column
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const parsed = parseBody(updateColumnBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { title, is_finished, is_archived, wip_limit, policy_text } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    
    // MIGRATED: Get the column's board ID using sqlManager
    const column = await helpers.getColumnById(db, id);
    if (!column) {
      return res.status(404).json({ error: t('errors.columnNotFound') });
    }
    const updateColumnBoardId = column.boardId || column.boardid || column.board_id;
    if (updateColumnBoardId && !(await assertBoardAccess(req, res, updateColumnBoardId))) return;
    
    // MIGRATED: Get full column info including boardid and position using sqlManager
    // CRITICAL: Fetch AFTER any potential position changes to get the current position
    const fullColumn = await helpers.getColumnFullInfo(db, id);
    
    if (!fullColumn) {
      return res.status(404).json({ error: t('errors.columnNotFound') });
    }
    
    // MIGRATED: Check for duplicate column name using sqlManager (case-insensitive)
    const existingColumn = await helpers.checkColumnNameDuplicate(db, fullColumn.boardId, title, id);
    
    if (existingColumn) {
      return res.status(400).json({ error: t('errors.columnNameExists') });
    }
    
    // MIGRATED: Get finished column names from settings using sqlManager
    const finishedColumnNamesSetting = await helpers.getSetting(db, 'DEFAULT_FINISHED_COLUMN_NAMES');
    
    let finishedColumnNames = ['Done', 'Completed', 'Finished']; // Default values
    if (finishedColumnNamesSetting) {
      try {
        finishedColumnNames = JSON.parse(finishedColumnNamesSetting);
      } catch (error) {
        console.error('Error parsing finished column names:', error);
      }
    }
    
    // Check if this column should be marked as finished
    const isFinished = finishedColumnNames.some(finishedName => 
      finishedName.toLowerCase() === title.toLowerCase()
    );
    
    // Check if this column should be marked as archived
    const isArchived = title.toLowerCase() === 'archive';
    
    // If is_finished is provided, use it; otherwise, auto-detect based on title
    const finalIsFinished = is_finished !== undefined ? is_finished : isFinished;
    
    // If is_archived is provided, use it; otherwise, auto-detect based on title
    const finalIsArchived = is_archived !== undefined ? is_archived : isArchived;
    
    // Ensure a column cannot be both finished and archived
    const finalIsFinishedValue = finalIsArchived ? false : finalIsFinished;

    // Soft WIP: null/empty = unlimited; ignore for finished/archived columns
    let finalWipLimit = wip_limit !== undefined ? wip_limit : fullColumn.wip_limit;
    if (finalWipLimit === '' || finalWipLimit === undefined) {
      finalWipLimit = null;
    } else if (finalWipLimit !== null) {
      const n = Number(finalWipLimit);
      finalWipLimit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    if (finalIsFinishedValue || finalIsArchived) {
      finalWipLimit = null;
    }

    const finalPolicyText = policy_text !== undefined ? policy_text : fullColumn.policy_text;
    
    // MIGRATED: Use sqlManager to update column
    // CRITICAL: Only update title, flags, WIP, policy - DO NOT touch position
    await helpers.updateColumn(
      db,
      id,
      title,
      finalIsFinishedValue,
      finalIsArchived,
      finalWipLimit,
      finalPolicyText
    );
    
    // CRITICAL: Re-fetch column AFTER update to ensure we have the latest position
    // (in case position was changed by another operation, though it shouldn't be)
    // MIGRATED: Use sqlManager to get full column info
    const updatedColumn = await helpers.getColumnFullInfo(db, id);
    
    // Publish to Redis for real-time updates
    // CRITICAL: Use snake_case for WebSocket event (frontend expects snake_case)
    // CRITICAL: Include position to prevent frontend from reordering
    const tenantId = getTenantId(req);
    await notificationService.publish('column-updated', {
      boardId: updatedColumn.boardId,
      column: { 
        id, 
        title, 
        boardId: updatedColumn.boardId,  // Include boardId for frontend
        position: updatedColumn.position,  // CRITICAL: Include current position to prevent reordering
        is_finished: finalIsFinishedValue,  // snake_case to match frontend
        is_archived: finalIsArchived,  // snake_case to match frontend
        wip_limit: updatedColumn.wip_limit ?? null,
        policy_text: updatedColumn.policy_text ?? null,
      },
      updatedBy: req.user?.id || 'system',
      timestamp: new Date().toISOString()
    }, tenantId);
    
    res.json({
      id,
      title,
      is_finished: finalIsFinishedValue,
      is_archived: finalIsArchived,
      wip_limit: updatedColumn.wip_limit ?? null,
      policy_text: updatedColumn.policy_text ?? null,
    });  // snake_case to match frontend
  } catch (error) {
    console.error('Error updating column:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToUpdateColumn') });
  }
});

// Delete column (only when empty of live tasks — prevents CASCADE permanent deletes)
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    
    // MIGRATED: Get the column's board ID before deleting using sqlManager
    const column = await helpers.getColumnFullInfo(db, id);
    if (!column) {
      return res.status(404).json({ error: t('errors.columnNotFound') });
    }
    const deleteColumnBoardId = column.boardId || column.boardid || column.board_id;
    if (deleteColumnBoardId && !(await assertBoardAccess(req, res, deleteColumnBoardId))) return;

    const liveCount = await taskQueries.countLiveTasksInColumn(db, id);
    if (liveCount > 0) {
      return res.status(409).json({
        error: t('errors.columnNotEmpty'),
        code: 'column_not_empty',
        taskCount: liveCount,
      });
    }

    // Reassign soft-deleted tasks off this column so CASCADE does not wipe Trash
    const boardColumnIds = await helpers.getColumnIdsForBoard(db, column.boardId);
    const fallbackId = (boardColumnIds || []).find((cid) => cid !== id);
    const trashCount = await taskQueries.countTrashTasksInColumn(db, id);
    if (trashCount > 0 && !fallbackId) {
      return res.status(409).json({
        error: t('errors.columnTrashNeedsFallback'),
        code: 'column_trash_needs_fallback',
        trashCount,
      });
    }
    if (fallbackId) {
      await taskQueries.reassignTrashTasksFromColumn(db, id, fallbackId);
    }
    
    // MIGRATED: Use sqlManager to delete column
    await helpers.deleteColumn(db, id);
    
    // Publish to Redis for real-time updates
    // CRITICAL: Use camelCase boardId to match frontend expectations
    const tenantId = getTenantId(req);
    await notificationService.publish('column-deleted', {
      boardId: column.boardId,  // camelCase
      columnId: id,
      updatedBy: req.user?.id || 'system',
      timestamp: new Date().toISOString()
    }, tenantId);
    
    res.json({ message: 'Column deleted successfully' });
  } catch (error) {
    console.error('Error deleting column:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToDeleteColumn') });
  }
});

// Reorder columns
router.post('/reorder', authenticateToken, async (req, res) => {
  const parsed = parseBody(reorderColumnBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { columnId, newPosition, boardId } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    
    // MIGRATED: Get column position using sqlManager
    const currentColumn = await helpers.getColumnPosition(db, columnId);
    if (!currentColumn) {
      return res.status(404).json({ error: t('errors.columnNotFound') });
    }

    const currentPosition = currentColumn.position;

    await dbTransaction(db, async () => {
      // Get all columns to determine max position for edge case handling
      const allColumns = await helpers.getAllColumnsForBoard(db, boardId);
      const maxPosition = allColumns.length > 0 
        ? Math.max(...allColumns.map(col => col.position || 0))
        : 0;

      if (newPosition > currentPosition) {
        // Moving right (to higher position): shift columns between current and new position left by 1
        // This makes room for the moved column at the new position
        // Special handling for edge case: moving to last position
        if (newPosition === maxPosition) {
          // When moving to the last position, shift all columns from currentPosition+1 to maxPosition left by 1
          // This includes the column currently at the last position, which will move left
          if (currentPosition < maxPosition) {
            await helpers.shiftColumnPositions(db, boardId, currentPosition + 1, maxPosition, -1, columnId);
          }
        } else if (currentPosition + 1 <= newPosition) {
          // Normal case: shift columns in the range
          await helpers.shiftColumnPositions(db, boardId, currentPosition + 1, newPosition, -1, columnId);
        }
      } else if (newPosition < currentPosition) {
        // Moving left (to lower position): shift columns between new and current position right by 1
        // This makes room for the moved column at the new position
        // Special handling for edge case: moving to position 0
        if (newPosition === 0) {
          // When moving to position 0: add +1 to all columns from 0 to currentPosition-1
          // Then set the moved column to 0 (this is the only edge case)
          if (currentPosition > 0) {
            await helpers.shiftColumnPositions(db, boardId, 0, currentPosition - 1, 1, columnId);
          }
        } else if (newPosition <= currentPosition - 1) {
          // Normal case: shift columns in the range
          await helpers.shiftColumnPositions(db, boardId, newPosition, currentPosition - 1, 1, columnId);
        }
      }
      // If newPosition === currentPosition, no shift needed (column stays in place)

      // MIGRATED: Update the moved column to its new position using sqlManager
      // This happens after the shift to ensure the moved column gets the correct position
      await helpers.updateColumnPosition(db, columnId, newPosition);
    });

    // MIGRATED: Fetch all updated columns using sqlManager
    const updatedColumns = await helpers.getAllColumnsForBoard(db, boardId);

    // Publish to Redis for real-time updates - include all columns
    const tenantId = getTenantId(req);
    await notificationService.publish('column-reordered', {
      boardId: boardId,
      columnId: columnId,
      newPosition: newPosition,
      columns: updatedColumns, // Send all updated columns
      updatedBy: req.user?.id || 'system',
      timestamp: new Date().toISOString()
    }, tenantId);

    res.json({ message: 'Column reordered successfully' });
  } catch (error) {
    console.error('Error reordering column:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToReorderColumn') });
  }
});

// Renumber all columns in a board to ensure clean integer positions
router.post('/renumber', authenticateToken, async (req, res) => {
  const parsed = parseBody(renumberColumnsBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { boardId } = parsed.data;
  try {
    const db = getRequestDatabase(req);

    let allColumns;
    await dbTransaction(db, async () => {
      allColumns = await helpers.renumberBoardColumnPositions(db, boardId);
    });

    res.json({ message: 'Columns renumbered successfully', columns: allColumns });
  } catch (error) {
    console.error('Error renumbering columns:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ error: t('errors.failedToRenumberColumns') });
  }
});

export default router;
