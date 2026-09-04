/**
 * Assemble boards with columns (and optionally full task payloads).
 * Shared by GET /api/boards and GET /api/boards/:boardId/full.
 */
import { tasks as taskQueries, helpers } from './sqlManager/index.js';

function parseJsonField(field) {
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
}

function deduplicateById(arr) {
  const seen = new Set();
  return arr.filter((item) => {
    if (!item || !item.id) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isArchivedColumn(column) {
  return Boolean(column.is_archived ?? column.isArchived);
}

/**
 * @param {object} db
 * @param {Array} boards
 * @param {{ includeTasks: boolean }} options
 */
export async function assembleBoardsPayload(db, boards, { includeTasks }) {
  const allBoardIds = boards.map((b) => b.id);
  const allColumns = allBoardIds.length > 0
    ? await helpers.getColumnsForAllBoards(db, allBoardIds)
    : [];

  const columnsByBoardId = {};
  allColumns.forEach((column) => {
    if (!columnsByBoardId[column.boardId]) {
      columnsByBoardId[column.boardId] = [];
    }
    columnsByBoardId[column.boardId].push(column);
  });

  const allColumnIds = allColumns.map((c) => c.id);

  let tasksByColumnId = {};
  let attachmentsByCommentId = {};

  if (includeTasks) {
    const allTasks = allColumnIds.length > 0
      ? await taskQueries.getTasksForColumns(db, allColumnIds)
      : [];

    allTasks.forEach((task) => {
      if (!tasksByColumnId[task.columnId]) {
        tasksByColumnId[task.columnId] = [];
      }
      tasksByColumnId[task.columnId].push(task);
    });

    const allCommentIds = allTasks.flatMap((task) => {
      const comments = parseJsonField(task.comments);
      return comments.map((c) => c.id).filter(Boolean);
    });

    const allAttachments = allCommentIds.length > 0
      ? await helpers.getAttachmentsForComments(db, allCommentIds)
      : [];

    allAttachments.forEach((att) => {
      const commentId = att.commentId || att.commentid;
      if (!attachmentsByCommentId[commentId]) {
        attachmentsByCommentId[commentId] = [];
      }
      attachmentsByCommentId[commentId].push(att);
    });
  }

  const countsByColumnId = {};
  if (!includeTasks) {
    const rows = allColumnIds.length > 0
      ? await taskQueries.countLiveTasksByColumnIds(db, allColumnIds)
      : [];
    rows.forEach((row) => {
      countsByColumnId[row.columnId] = row.count;
    });
  }

  return boards.map((board) => {
    const columns = columnsByBoardId[board.id] || [];
    const columnsObj = {};
    let taskCount = 0;

    columns.forEach((column) => {
      if (includeTasks) {
        const tasksRaw = tasksByColumnId[column.id] || [];
        const tasks = tasksRaw.map((task) => ({
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
          comments: deduplicateById(parseJsonField(task.comments)).map((comment) => ({
            ...comment,
            attachments: attachmentsByCommentId[comment.id] || []
          })),
          tags: deduplicateById(parseJsonField(task.tags)),
          watchers: deduplicateById(parseJsonField(task.watchers)),
          collaborators: deduplicateById(parseJsonField(task.collaborators))
        }));

        if (!isArchivedColumn(column)) {
          taskCount += tasks.length;
        }

        columnsObj[column.id] = {
          ...column,
          tasks
        };
      } else {
        const count = countsByColumnId[column.id] || 0;
        if (!isArchivedColumn(column)) {
          taskCount += count;
        }
        columnsObj[column.id] = {
          ...column,
          tasks: []
        };
      }
    });

    return {
      ...board,
      participantCount: Number(board.participant_count ?? board.participantCount ?? 0),
      taskCount,
      tasksHydrated: includeTasks,
      columns: columnsObj
    };
  });
}
