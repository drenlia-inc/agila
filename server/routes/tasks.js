import express from 'express';
import crypto from 'crypto';
import { wrapQuery } from '../utils/queryLogger.js';
import { logTaskActivity, generateTaskUpdateDetails, logBulkTaskFieldActivity } from '../services/activityLogger.js';
import * as reportingLogger from '../services/reportingLogger.js';
import { TASK_ACTIONS } from '../constants/activityActions.js';
import { authenticateToken, requireRole, userCanMutate } from '../middleware/auth.js';
import { checkTaskLimit } from '../middleware/licenseCheck.js';
import notificationService from '../services/notificationService.js';
import { getTranslator, t } from '../utils/i18n.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { serverDebug } from '../utils/serverDebug.js';
import { dbTransaction } from '../utils/dbAsync.js';
// MIGRATED: Import sqlManager
import { tasks as taskQueries, boards as boardQueries, helpers, sprints as sprintQueries, taskWork as taskWorkQueries, members as memberQueries } from '../utils/sqlManager/index.js';
import { AUTOMATION_CONFIG_KEYS } from '../constants/automation.js';
import {
  purgeTaskCompletely,
} from '../services/taskPurgeService.js';
import { updateStorageUsage } from '../utils/storageUtils.js';
import { notifyCollaboratorAdded, notifyBulkColumnMove, notifyWatcherAdded } from '../services/taskEmailNotificationService.js';
import {
  classifyRelationshipConflict,
  relationshipConflictResponse,
} from '../utils/taskRelationshipValidation.js';
import {
  parseBody,
  createTaskBodySchema,
  updateTaskBodySchema,
  copyTaskBodySchema,
  bulkFieldActivityBodySchema,
  batchUpdateTasksBodySchema,
  batchUpdatePositionsBodySchema,
  reorderTaskBodySchema,
  moveTaskToBoardBodySchema,
  permanentBatchBodySchema,
  createTaskRelationshipBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

// Helper function to get tenantId from request (for Redis channel isolation)
const getTenantId = (req) => {
  return req.tenantId || null;
};

function resolveTenantStoragePaths(req) {
  if (req.locals?.tenantStoragePaths) return req.locals.tenantStoragePaths;
  if (req.app.locals?.tenantStoragePaths) return req.app.locals.tenantStoragePaths;
  return null;
}

/** console.log gated by SERVER_DEBUG_HTTP (pass result of serverDebug once per request). */
function taskHttpLog(dbgHttp, ...args) {
  if (dbgHttp) console.log(...args);
}


// Helper function to build minimal WebSocket payload with only changed fields
// This reduces payload size from 5-30KB to 500-1000 bytes (70-90% reduction)
// Includes essential fields for frontend display (title, boardId, memberId, ticket)
function buildMinimalTaskUpdatePayload(currentTask, updatedTask, changedFields, priorityChanged, priorityInfo) {
  const currentBoardId = updatedTask.boardId || currentTask.boardId || currentTask.boardid;
  const currentColumnId = updatedTask.columnId || currentTask.columnId || currentTask.columnid;

  // Always include essential fields for frontend display (required when task doesn't exist in target column)
  const minimalTask = {
    id: updatedTask.id || currentTask.id,
    title: updatedTask.title || currentTask.title, // Required for display
    boardId: currentBoardId, // Required for routing
    columnId: currentColumnId, // Required for WS merge into columns
    memberId: updatedTask.memberId || currentTask.memberId || currentTask.memberid || null,
    ticket: updatedTask.ticket || currentTask.ticket || null
  };
  
  // Always include boardId (required for frontend routing)
  const targetBoardId = currentBoardId;
  
  // Include only changed fields
  if (changedFields.includes('title') || currentTask.title !== updatedTask.title) {
    minimalTask.title = updatedTask.title;
  }
  if (changedFields.includes('description') || currentTask.description !== updatedTask.description) {
    minimalTask.description = updatedTask.description;
  }
  if (changedFields.includes('memberId') || currentTask.memberId !== updatedTask.memberId) {
    minimalTask.memberId = updatedTask.memberId;
  }
  if (changedFields.includes('requesterId') || currentTask.requesterId !== updatedTask.requesterId) {
    minimalTask.requesterId = updatedTask.requesterId;
  }
  if (changedFields.includes('startDate') || currentTask.startDate !== updatedTask.startDate) {
    minimalTask.startDate = updatedTask.startDate;
  }
  if (changedFields.includes('dueDate') || currentTask.dueDate !== updatedTask.dueDate) {
    minimalTask.dueDate = updatedTask.dueDate;
  }
  if (changedFields.includes('effort') || currentTask.effort !== updatedTask.effort) {
    minimalTask.effort = updatedTask.effort;
  }
  if (changedFields.includes('columnId') || currentTask.columnId !== updatedTask.columnId) {
    minimalTask.columnId = updatedTask.columnId;
    // Include position when column changes (usually changes together)
    minimalTask.position = updatedTask.position ?? currentTask.position;
    // Include previous location for cross-column moves
    minimalTask.previousColumnId = currentTask.columnId;
    minimalTask.columnEnteredAt = updatedTask.columnEnteredAt || new Date().toISOString();
  }
  if (changedFields.includes('position') || currentTask.position !== (updatedTask.position ?? 0)) {
    minimalTask.position = updatedTask.position ?? 0;
  }
  if (changedFields.includes('boardId') || currentTask.boardId !== updatedTask.boardId) {
    // Board change - include previous location for cross-board moves
    minimalTask.previousBoardId = currentTask.boardId;
    minimalTask.previousColumnId = currentTask.columnId;
  }
  if (changedFields.includes('sprintId')) {
    minimalTask.sprintId = updatedTask.sprintId || null;
  }
  // Include blocked flag + reason whenever either changes (reason-only edits must reach peers/cards)
  if (
    changedFields.includes('isBlocked') ||
    changedFields.includes('blockedReason') ||
    Boolean(currentTask.isBlocked ?? currentTask.is_blocked) !== Boolean(updatedTask.isBlocked)
  ) {
    minimalTask.isBlocked =
      updatedTask.isBlocked !== undefined
        ? Boolean(updatedTask.isBlocked)
        : Boolean(currentTask.isBlocked ?? currentTask.is_blocked);
    minimalTask.blockedReason =
      updatedTask.blockedReason !== undefined
        ? (updatedTask.blockedReason || null)
        : (currentTask.blockedReason || currentTask.blocked_reason || null);
  }
  
  // Handle priority changes
  if (priorityChanged && priorityInfo) {
    minimalTask.priority = priorityInfo.priorityName;
    minimalTask.priorityId = priorityInfo.priorityId;
    minimalTask.priorityName = priorityInfo.priorityName;
    minimalTask.priorityColor = priorityInfo.priorityColor;
  }
  
  return { minimalTask, targetBoardId };
}

// MIGRATED: Use sqlManager instead of inline SQL
// Helper function to fetch a task with all relationships (comments, watchers, collaborators, tags, attachmentCount)
async function fetchTaskWithRelationships(db, taskId) {
  const task = await taskQueries.getTaskWithRelationships(db, taskId);
  if (!task) return null;
  
  // Get attachments for all comments in one batch query (fixes N+1 problem)
  if (task.comments && task.comments.length > 0) {
    const commentIds = task.comments.map(c => c.id).filter(Boolean);
    if (commentIds.length > 0) {
      const allAttachments = await helpers.getAttachmentsForComments(db, commentIds);
      
      // Group attachments by commentid
      const attachmentsByCommentId = new Map();
      allAttachments.forEach(att => {
        const commentId = att.commentid || att.commentId;
        if (!attachmentsByCommentId.has(commentId)) {
          attachmentsByCommentId.set(commentId, []);
        }
        attachmentsByCommentId.get(commentId).push(att);
      });
      
      // Assign attachments to each comment
      task.comments.forEach(comment => {
        comment.attachments = attachmentsByCommentId.get(comment.id) || [];
      });
    }
  }

  if (Array.isArray(task.comments)) {
    task.comments = mapCommentsForClient(task.comments);
  }
  
  // Get priority information - prefer JOIN values over tasks.priority field (which can be stale)
  // CRITICAL: Use priorityId/priorityName/priorityColor from JOIN, not task.priority (text field can be outdated)
  let priorityId = task.priorityId || task.priority_id || null;
  let priorityName = task.priorityName || null; // Use JOIN value, not task.priority
  let priorityColor = task.priorityColor || null;
  
  // Fallback: If JOIN didn't return priority info, look it up by priority_id
  if (priorityId && !priorityName) {
    const priority = await helpers.getPriorityById(db, priorityId);
    if (priority) {
      priorityName = priority.priority;
      priorityColor = priority.color;
    }
  }
  // Last resort: If no priority_id but tasks.priority exists, look it up (backward compatibility)
  else if (!priorityId && task.priority) {
    const priority = await helpers.getPriorityByName(db, task.priority);
    if (priority) {
      priorityId = priority.id;
      priorityName = priority.priority;
      priorityColor = priority.color;
    } else {
      // Priority name doesn't exist in priorities table (was deleted), use null
      priorityName = null;
      priorityColor = null;
    }
  }
  
  // Convert snake_case to camelCase
  return {
    ...task,
    priority: priorityName,
    priorityId: priorityId,
    priorityName: priorityName,
    priorityColor: priorityColor,
    sprintId: task.sprint_id || null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    columnEnteredAt: task.column_entered_at || task.columnEnteredAt || null,
    isBlocked: Boolean(task.is_blocked ?? task.isBlocked),
    blockedReason: task.blocked_reason || task.blockedReason || null,
    // Ensure columnid and boardid are in camelCase (frontend expects these)
    deletedAt: task.deleted_at || task.deletedAt || null,
    deletedBy: task.deleted_by || task.deletedBy || null,
    columnId: task.columnid || task.columnId,
    boardId: task.boardid || task.boardId,
    memberId: task.memberid || task.memberId,
    requesterId: task.requesterid || task.requesterId
  };
}

/** Normalize comment rows for frontend (defensive camelCase). */
function mapCommentsForClient(comments = []) {
  return (comments || []).map((c) => ({
    ...c,
    id: c.id,
    taskId: c.taskId || c.taskid || c.task_id,
    text: c.text,
    authorId: c.authorId || c.authorid || c.author_id,
    createdAt: c.createdAt || c.createdat || c.created_at,
    updatedAt: c.updatedAt || c.updated_at,
    authorName: c.authorName || c.authorname || c.author_name,
    authorColor: c.authorColor || c.authorcolor || c.author_color,
    attachments: Array.isArray(c.attachments) ? c.attachments : []
  }));
}

/** Normalize member rows for WS / frontend TeamMember shape */
function mapMembersForClient(rows = []) {
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
    user_id: m.user_id || m.userId || null,
    avatarUrl: m.avatarUrl || m.avatar_path || null,
    googleAvatarUrl: m.googleAvatarUrl || m.google_avatar_url || null,
  }));
}

/**
 * Publish task-updated with current watchers/collaborators so cards refresh.
 * Specific task-watcher-* events alone do not update column task state on the client.
 */
async function publishTaskRelationshipUpdate(db, req, { boardId, taskId, userId, watchers, collaborators }) {
  const taskRow = await taskQueries.getTaskById(db, taskId);
  if (!taskRow) return;
  const columnId = taskRow.columnid || taskRow.columnId;
  const payload = {
    id: taskId,
    boardId: boardId || taskRow.boardid || taskRow.boardId,
    columnId,
    updatedBy: userId || null,
  };
  if (watchers !== undefined) payload.watchers = mapMembersForClient(watchers);
  if (collaborators !== undefined) payload.collaborators = mapMembersForClient(collaborators);

  await notificationService.publish('task-updated', {
    boardId: payload.boardId,
    task: payload,
    timestamp: new Date().toISOString()
  }, getTenantId(req));
}

// MIGRATED: Use sqlManager instead of inline SQL
// Batched version: Fetch multiple tasks with relationships in one query
// This is much faster than calling fetchTaskWithRelationships() for each task
async function fetchTasksWithRelationshipsBatch(db, taskIds) {
  if (!taskIds || taskIds.length === 0) {
    return [];
  }

  // Use sqlManager (Postgres-native queries + camelCase result mapping)
  return await taskQueries.getTasksByIds(db, taskIds);
}

// Helper function to check for circular dependencies in task relationships
async function checkForCycles(db, sourceTaskId, targetTaskId, relationship) {
  // Simple cycle detection:
  // If A wants to become parent of B, check if A is already a child of B
  // If A wants to become child of B, check if A is already a parent of B
  
  let oppositeRelationship;
  let checkTaskId, checkTargetId;
  
  if (relationship === 'parent') {
    // sourceTask wants to become parent of targetTask
    // Check if sourceTask is already a child of targetTask
    oppositeRelationship = 'child';
    checkTaskId = sourceTaskId;  // A
    checkTargetId = targetTaskId; // B
  } else if (relationship === 'child') {
    // sourceTask wants to become child of targetTask  
    // Check if sourceTask is already a parent of targetTask
    oppositeRelationship = 'parent';
    checkTaskId = sourceTaskId;  // A
    checkTargetId = targetTaskId; // B
  } else {
    // 'related' relationships don't create cycles
    return { hasCycle: false };
  }
  
  // MIGRATED: Use sqlManager instead of inline SQL
  // Check if the opposite relationship already exists
  const existingOppositeRel = await taskQueries.getOppositeRelationship(db, checkTaskId, oppositeRelationship, checkTargetId);
  
  if (existingOppositeRel) {
    const sourceTicket = await taskQueries.getTaskTicket(db, sourceTaskId) || 'Unknown';
    const targetTicket = await taskQueries.getTaskTicket(db, targetTaskId) || 'Unknown';
    
    return {
      hasCycle: true,
      reason: `${sourceTicket} is already ${oppositeRelationship} of ${targetTicket}`
    };
  }
  
  return { hasCycle: false };
}

// Helper function to get task ticket by ID
async function getTaskTicket(db, taskId) {
  const ticket = await taskQueries.getTaskTicket(db, taskId);
  return ticket || 'Unknown';
}

// MIGRATED: Use sqlManager instead of inline SQL
// Utility function to generate task ticket numbers
const generateTaskTicket = async (db, prefix = 'TASK-') => {
  return await taskQueries.generateTaskTicket(db, prefix);
};

// Helper function to log activity to reporting system
const logReportingActivity = async (db, eventType, userId, taskId, metadata = {}) => {
  try {
    // Get user info
    const userInfo = await reportingLogger.getUserInfo(db, userId);
    if (!userInfo) {
      console.warn(`User ${userId} not found for reporting activity log`);
      return;
    }

    // Get task info
    const task = await wrapQuery(db.prepare(`
      SELECT t.*, b.title as board_title, c.title as column_title, b.id as board_id
      FROM tasks t
      LEFT JOIN boards b ON t.boardid = b.id
      LEFT JOIN columns c ON t.columnid = c.id
      WHERE t.id = ?
    `), 'SELECT').get(taskId);

    if (!task) {
      console.warn(`Task ${taskId} not found for reporting activity log`);
      return;
    }

    // Get tags if any
    const taskTags = await wrapQuery(db.prepare(`
      SELECT t.tag as name FROM task_tags tt
      JOIN tags t ON tt.tagid = t.id
      WHERE tt.taskid = ?
    `), 'SELECT').all(taskId);

    // Prepare event data
    const eventData = {
      eventType,
      userId: userInfo.id,
      userName: userInfo.name,
      userEmail: userInfo.email,
      taskId: task.id,
      taskTitle: task.title,
      taskTicket: task.ticket,
      boardId: task.board_id || task.boardId || task.boardid,
      boardName: task.board_title,
      columnId: task.columnId || task.columnid,
      columnName: task.column_title,
      effortPoints: task.effort,
      priorityName: task.priority,
      tags: taskTags.length > 0 ? taskTags.map(t => t.name) : null,
      ...metadata
    };

    // Log the activity
    await reportingLogger.logActivity(db, eventData);
  } catch (error) {
    console.error('Failed to log reporting activity:', error);
    // Don't throw - reporting should never break main functionality
  }
};

// MIGRATED: Get all tasks
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tasks = await taskQueries.getAllTasks(db);
    
    // Convert snake_case to camelCase for frontend
    const tasksWithCamelCase = tasks.map(task => ({
      ...task,
      sprintId: task.sprint_id || null,
      createdAt: task.created_at,
      updatedAt: task.updated_at
    }));
    
    res.json(tasksWithCamelCase);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToFetchTasks') });
  }
});

/**
 * Search soft-deleted tasks for the header search dropdown. Trashed work is not
 * part of the board payload the client already holds, so it needs a lookup to
 * stay findable. Declared before `/:id` so the literal path wins.
 */
router.get('/trash/search', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2) {
      return res.json({ tasks: [] });
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 20;

    const tasks = await taskQueries.searchTrashedTasks(db, query, limit);
    res.json({ tasks });
  } catch (error) {
    console.error('Error searching trashed tasks:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToFetchTasks') });
  }
});

// Get task by ID or ticket
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const { id } = req.params;
    
    taskHttpLog(dbgHttp, '🔍 [TASK API] Getting task by ID:', { id, url: req.url });
    
    // Check if the ID looks like a ticket (e.g., TASK-00032) or a UUID
    const isTicket = /^[A-Z]+-\d+$/i.test(id);
    taskHttpLog(dbgHttp, '🔍 [TASK API] ID type detection:', { id, isTicket });
    
    // MIGRATED: Use sqlManager instead of inline SQL
    const task = isTicket 
      ? await taskQueries.getTaskByTicket(db, id)
      : await fetchTaskWithRelationships(db, id);
    
    if (!task) {
      taskHttpLog(dbgHttp, '❌ [TASK API] Task not found for ID:', id);
      const tTranslator = await getTranslator(db);
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    taskHttpLog(dbgHttp, '✅ [TASK API] Found task:', { 
      id: task.id, 
      title: task.title, 
      priorityId: task.priorityId,
      status: task.status 
    });
    
    // MIGRATED: If task doesn't have relationships (from getTaskByTicket), fetch them
    if (!task.comments || !task.watchers || !task.collaborators || !task.tags) {
      // Get comments for the task
      const comments = await helpers.getCommentsForTask(db, task.id);
      taskHttpLog(dbgHttp, '📝 [TASK API] Found comments:', comments.length);
      
      // Get attachments for all comments in one batch query (fixes N+1 problem)
      if (comments.length > 0) {
        const commentIds = comments.map(c => c.id).filter(Boolean);
        if (commentIds.length > 0) {
          const allAttachments = await helpers.getAttachmentsForComments(db, commentIds);
          
          // Group attachments by commentid
          const attachmentsByCommentId = new Map();
          allAttachments.forEach(att => {
            const commentId = att.commentid || att.commentId;
            if (!attachmentsByCommentId.has(commentId)) {
              attachmentsByCommentId.set(commentId, []);
            }
            attachmentsByCommentId.get(commentId).push(att);
          });
          
          // Assign attachments to each comment
          comments.forEach(comment => {
            comment.attachments = attachmentsByCommentId.get(comment.id) || [];
          });
        }
      }
      
      // Get watchers for the task
      const watchers = await helpers.getWatchersForTask(db, task.id);
      taskHttpLog(dbgHttp, '👀 [TASK API] Found watchers:', watchers.length);
      
      // Get collaborators for the task
      const collaborators = await helpers.getCollaboratorsForTask(db, task.id);
      taskHttpLog(dbgHttp, '🤝 [TASK API] Found collaborators:', collaborators.length);
      
      // Get tags for the task
      const tags = await taskQueries.getTaskTags(db, task.id);
      taskHttpLog(dbgHttp, '🏷️ [TASK API] Found tags:', tags.length);
      
      // Add all related data to task
      task.comments = mapCommentsForClient(comments || []);
      task.watchers = watchers || [];
      task.collaborators = collaborators || [];
      task.tags = tags || [];
    } else if (Array.isArray(task.comments)) {
      task.comments = mapCommentsForClient(task.comments);
    }
    
    // Convert snake_case to camelCase for frontend
    // getTaskByTicket uses SELECT t.* (Postgres lowercase columns); always normalize.
    // CRITICAL: Use priorityName from JOIN only - never use task.priority (text field can be stale)
    const rawStart = task.startdate || task.startDate || null;
    const rawDue = task.duedate || task.dueDate || null;
    const toDateString = (value) => {
      if (!value) return null;
      if (value instanceof Date) return value.toISOString().split('T')[0];
      const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : String(value);
    };
    const taskResponse = {
      ...task,
      priority: task.priorityName || null,
      priorityId: task.priorityId || null,
      priorityName: task.priorityName || null,
      priorityColor: task.priorityColor || null,
      sprintId: task.sprint_id || task.sprintId || null,
      createdAt: task.created_at || task.createdAt,
      updatedAt: task.updated_at || task.updatedAt,
      columnEnteredAt: task.column_entered_at || task.columnEnteredAt || null,
      isBlocked: Boolean(task.is_blocked ?? task.isBlocked),
      blockedReason: task.blocked_reason || task.blockedReason || null,
      columnId: task.columnid || task.columnId || null,
      boardId: task.boardid || task.boardId || null,
      memberId: task.memberid || task.memberId || null,
      requesterId: task.requesterid || task.requesterId || null,
      startDate: toDateString(rawStart),
      dueDate: toDateString(rawDue),
      deletedAt: task.deleted_at || task.deletedAt || null,
      deletedBy: task.deleted_by || task.deletedBy || null,
    };
    
    taskHttpLog(dbgHttp, '📦 [TASK API] Final task data:', {
      id: taskResponse.id,
      title: taskResponse.title,
      commentsCount: taskResponse.comments.length,
      watchersCount: taskResponse.watchers.length,
      collaboratorsCount: taskResponse.collaborators.length,
      tagsCount: taskResponse.tags.length,
      priority: taskResponse.priority,
      priorityId: taskResponse.priorityId,
      status: taskResponse.status,
      sprintId: taskResponse.sprintId
    });
    
    res.json(taskResponse);
  } catch (error) {
    console.error('Error fetching task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToFetchTask') });
  }
});

// Create task
router.post('/', authenticateToken, checkTaskLimit, async (req, res) => {
  const parsed = parseBody(createTaskBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const task = parsed.data;
  const userId = req.user?.id || 'system'; // Fallback for now
  
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const now = new Date().toISOString();
    
    // Generate task ticket number
    // MIGRATED: Use sqlManager instead of inline SQL
    const taskPrefix = await helpers.getSetting(db, 'DEFAULT_TASK_PREFIX') || 'TASK-';
    const ticket = await generateTaskTicket(db, taskPrefix);
    
    // Ensure dueDate defaults to startDate if not provided
    const dueDate = task.dueDate || task.startDate;
    
    // Handle priority: prefer priority_id, but support priority name for backward compatibility
    let priorityId = task.priorityId || null;
    let priorityName = task.priority || null;
    
    // If priority_id is not provided but priority name is, look up the ID
    if (!priorityId && priorityName) {
    // MIGRATED: Use sqlManager instead of inline SQL
    const priority = await helpers.getPriorityByName(db, priorityName);
    if (priority) {
      priorityId = priority.id;
    } else {
      // Fallback to default priority if name not found
      const defaultPriority = await helpers.getDefaultPriority(db);
      priorityId = defaultPriority ? defaultPriority.id : null;
    }
    }
    
    // If still no priority_id, use default
    if (!priorityId) {
      const defaultPriority = await helpers.getDefaultPriority(db);
      priorityId = defaultPriority ? defaultPriority.id : null;
      if (priorityId && !priorityName) {
        // Get the name for the default priority
        priorityName = await helpers.getPriorityNameById(db, priorityId);
      }
    }

    const tTranslator = await getTranslator(db);
    if (task.memberId && (await memberQueries.isReadOnlyViewerMember(db, task.memberId))) {
      return res.status(400).json({ error: tTranslator('errors.cannotAssignViewer') });
    }
    
    // MIGRATED: Create the task using sqlManager
    await taskQueries.createTask(db, {
      id: task.id,
      title: task.title,
      description: task.description || '',
      ticket: ticket,
      memberId: task.memberId,
      requesterId: task.requesterId,
      startDate: task.startDate,
      dueDate: dueDate,
      effort: task.effort != null ? task.effort : 0,
      priority: priorityName,
      priorityId: priorityId,
      columnId: task.columnId,
      boardId: task.boardId,
      position: task.position || 0,
      sprintId: task.sprintId || null
    });
    
    // Log the activity (console only for now)
    const board = await helpers.getBoardById(db, task.boardId);
    const boardTitle = board ? board.title : 'Unknown Board';
    const taskRef = ticket ? ` (${ticket})` : '';
    // Fire-and-forget: Don't await activity logging to avoid blocking API response
    const createDetails = JSON.stringify({
      en: t('activity.createdTask', { taskRef, boardTitle }, 'en'),
      fr: t('activity.createdTask', { taskRef, boardTitle }, 'fr')
    });
    logTaskActivity(
      userId,
      TASK_ACTIONS.CREATE,
      task.id,
      createDetails,
      { 
        columnId: task.columnId,
        boardId: task.boardId,
        tenantId: getTenantId(req),
        authType: req.user?.authType,
        db: db
      }
    ).catch(error => {
      console.error('Background activity logging failed:', error);
    });
    
    // Log to reporting system (fire-and-forget: Don't await to avoid blocking API response)
    logReportingActivity(db, 'task_created', userId, task.id).catch(error => {
      console.error('Background reporting activity logging failed:', error);
    });
    
    // Add the generated ticket to the task object before publishing
    task.ticket = ticket;
    
    // Fetch the created task with all relationships (including priority info from JOIN)
    // This ensures the WebSocket event includes complete task data with current priority name
    const taskResponse = await fetchTaskWithRelationships(db, task.id);
    
    // Ensure taskResponse has required fields for WebSocket event (frontend expects columnid and boardid in camelCase)
    const taskForWebSocket = taskResponse || task;
    if (!taskForWebSocket.columnId && task.columnId) {
      taskForWebSocket.columnId = task.columnId;
    }
    if (!taskForWebSocket.boardId && task.boardId) {
      taskForWebSocket.boardId = task.boardId;
    }
    
    // Publish to Redis for real-time updates
    const publishTimestamp = new Date().toISOString();
    taskHttpLog(dbgHttp, `📤 [${publishTimestamp}] Publishing task-created to Redis:`, {
      taskId: task.id,
      ticket: task.ticket,
      title: task.title,
      boardId: task.boardId,
      columnId: task.columnId,
      hasTaskResponse: !!taskResponse,
      taskResponseColumnId: taskResponse?.columnId,
      taskResponseBoardId: taskResponse?.boardId
    });
    
    await notificationService.publish('task-created', {
      boardId: task.boardId,
      task: taskForWebSocket, // Use taskResponse with ensured columnId/boardId, fallback to task
      timestamp: publishTimestamp
    }, getTenantId(req));
    
    taskHttpLog(dbgHttp, `✅ [${publishTimestamp}] task-created published to Redis successfully`);
    
    res.json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToCreateTask') });
  }
});

// Create task at top
router.post('/add-at-top', authenticateToken, checkTaskLimit, async (req, res) => {
  const parsed = parseBody(createTaskBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const task = parsed.data;
  const userId = req.user?.id || 'system';
  
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const now = new Date().toISOString();
    
    // Generate task ticket number
    // MIGRATED: Use sqlManager instead of inline SQL
    const taskPrefix = await helpers.getSetting(db, 'DEFAULT_TASK_PREFIX') || 'TASK-';
    const ticket = await generateTaskTicket(db, taskPrefix);
    
    // Ensure dueDate defaults to startDate if not provided
    const dueDate = task.dueDate || task.startDate;
    
    // Handle priority: prefer priority_id, but support priority name for backward compatibility
    let priorityId = task.priorityId || null;
    let priorityName = task.priority || null;
    
    // If priority_id is not provided but priority name is, look up the ID
    if (!priorityId && priorityName) {
    // MIGRATED: Use sqlManager instead of inline SQL
    const priority = await helpers.getPriorityByName(db, priorityName);
    if (priority) {
      priorityId = priority.id;
    } else {
      // Fallback to default priority if name not found
      const defaultPriority = await helpers.getDefaultPriority(db);
      priorityId = defaultPriority ? defaultPriority.id : null;
    }
    }
    
    // If still no priority_id, use default
    if (!priorityId) {
      const defaultPriority = await helpers.getDefaultPriority(db);
      priorityId = defaultPriority ? defaultPriority.id : null;
      if (priorityId && !priorityName) {
        // Get the name for the default priority
        priorityName = await helpers.getPriorityNameById(db, priorityId);
      }
    }
    
    const tTranslator = await getTranslator(db);
    if (task.memberId && (await memberQueries.isReadOnlyViewerMember(db, task.memberId))) {
      return res.status(400).json({ error: tTranslator('errors.cannotAssignViewer') });
    }

    await dbTransaction(db, async () => {
      await taskQueries.incrementTaskPositions(db, task.columnId);
      await taskQueries.createTask(db, {
        id: task.id,
        title: task.title,
        description: task.description || '',
        ticket: ticket,
        memberId: task.memberId,
        requesterId: task.requesterId,
        startDate: task.startDate,
        dueDate: dueDate,
        effort: task.effort != null ? task.effort : 0,
        priority: priorityName,
        priorityId: priorityId,
        columnId: task.columnId,
        boardId: task.boardId,
        position: 0,
        sprintId: task.sprintId || null
      });
    });
    
    // Log task creation activity (fire-and-forget: Don't await to avoid blocking API response)
    // Create bilingual message for "create at top" (use imported t function with language parameter)
    const board = await helpers.getBoardById(db, task.boardId);
    const boardTitle = board ? board.title : 'Unknown Board';
    const taskRef = ticket ? ` (${ticket})` : '';
    const createAtTopDetails = JSON.stringify({
      en: t('activity.createdTaskAtTop', { taskRef, boardTitle }, 'en'),
      fr: t('activity.createdTaskAtTop', { taskRef, boardTitle }, 'fr')
    });
    logTaskActivity(
      userId,
      TASK_ACTIONS.CREATE,
      task.id,
      createAtTopDetails,
      { 
        columnId: task.columnId,
        boardId: task.boardId,
        tenantId: getTenantId(req),
        authType: req.user?.authType,
        db: db
      }
    ).catch(error => {
      console.error('Background activity logging failed:', error);
    });
    
    // Log to reporting system (fire-and-forget: Don't await to avoid blocking API response)
    logReportingActivity(db, 'task_created', userId, task.id).catch(error => {
      console.error('Background reporting activity logging failed:', error);
    });
    
    // Add the generated ticket to the task object
    task.ticket = ticket;
    
    // Fetch the created task with all relationships (including priority info from JOIN)
    // This ensures the WebSocket event includes complete task data with current priority name
    const taskResponse = await fetchTaskWithRelationships(db, task.id);
    
    // Ensure taskResponse has required fields for WebSocket event (frontend expects columnid and boardid in camelCase)
    const taskForWebSocket = taskResponse || task;
    if (!taskForWebSocket.columnId && task.columnId) {
      taskForWebSocket.columnId = task.columnId;
    }
    if (!taskForWebSocket.boardId && task.boardId) {
      taskForWebSocket.boardId = task.boardId;
    }
    
    // Publish to Redis for real-time updates
    const publishTimestamp = new Date().toISOString();
    taskHttpLog(dbgHttp, `📤 [${publishTimestamp}] Publishing task-created (at top) to Redis:`, {
      taskId: task.id,
      ticket: task.ticket,
      title: task.title,
      boardId: task.boardId,
      columnId: task.columnId,
      hasTaskResponse: !!taskResponse,
      taskResponseColumnId: taskResponse?.columnId,
      taskResponseBoardId: taskResponse?.boardId
    });
    
    await notificationService.publish('task-created', {
      boardId: task.boardId,
      task: taskForWebSocket, // Use taskResponse with ensured columnId/boardId, fallback to task
      timestamp: publishTimestamp
    }, getTenantId(req));
    
    taskHttpLog(dbgHttp, `✅ [${publishTimestamp}] task-created (at top) published to Redis successfully`);

    // Broadcast full-column positions so all clients bump siblings (increment + insert at 0)
    try {
      const columnTasks = await taskQueries.getTasksForColumnBasic(db, task.columnId);
      const positionUpdates = columnTasks.map((t) => ({
        taskId: t.id,
        position: typeof t.position === 'number' ? t.position : parseFloat(t.position) || 0,
        columnId: task.columnId
      }));
      if (positionUpdates.length > 0) {
        await notificationService.publish('tasks-positions-updated', {
          boardId: task.boardId,
          updates: positionUpdates,
          timestamp: publishTimestamp
        }, getTenantId(req));
      }
    } catch (posErr) {
      console.warn('Failed to publish tasks-positions-updated after add-at-top:', posErr.message);
    }
    
    res.json(task);
  } catch (error) {
    console.error('Error creating task at top:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToCreateTaskAtTop') });
  }
});

// Copy task
router.post('/copy', authenticateToken, checkTaskLimit, async (req, res) => {
  const parsed = parseBody(copyTaskBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { taskId } = parsed.data;
  const userId = req.user?.id || 'system';
  const skipEmail = parsed.data.skipEmail === true;
  
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    
    // Get the original task with all relationships
    const originalTask = await taskQueries.getTaskWithRelationships(db, taskId);
    
    if (!originalTask) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    // Generate new task ID and ticket number
    const newTaskId = crypto.randomUUID();
    const taskPrefix = await helpers.getSetting(db, 'DEFAULT_TASK_PREFIX') || 'TASK-';
    const newTicket = await generateTaskTicket(db, taskPrefix);
    
    // Get original task position
    const originalPosition = originalTask.position || 0;
    const columnId = originalTask.columnid || originalTask.columnId;
    const boardId = originalTask.boardid || originalTask.boardId;
    
    // Parse JSON fields from original task
    const parseJsonField = (field) => {
      if (field === null || field === undefined || field === '' || field === '[null]' || field === 'null') {
        return [];
      }
      if (Array.isArray(field)) {
        return field.filter(Boolean);
      }
      if (typeof field === 'string') {
        try {
          const parsed = JSON.parse(field);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : (parsed ? [parsed] : []);
        } catch (e) {
          return [];
        }
      }
      return [];
    };
    
    const originalTags = parseJsonField(originalTask.tags);
    const originalWatchers = parseJsonField(originalTask.watchers);
    const originalCollaborators = parseJsonField(originalTask.collaborators);
    
    // Create new task with copied data (excluding id, ticket, timestamps, and relationships)
    // Ensure startDate is not null (PostgreSQL NOT NULL constraint)
    const originalStartDate = originalTask.startdate || originalTask.startDate;
    const defaultStartDate = new Date().toISOString().split('T')[0]; // Today's date as default
    
    const newTaskData = {
      id: newTaskId,
      title: `${originalTask.title} (Copy)`,
      description: originalTask.description || '',
      ticket: newTicket,
      memberId: originalTask.memberid || originalTask.memberId || null,
      requesterId: originalTask.requesterid || originalTask.requesterId || null,
      startDate: originalStartDate || defaultStartDate,
      dueDate: originalTask.duedate || originalTask.dueDate || originalStartDate || defaultStartDate,
      effort: originalTask.effort != null ? originalTask.effort : 0,
      priority: originalTask.priority || null,
      priorityId: originalTask.priorityId || originalTask.priority_id || null,
      columnId: columnId,
      boardId: boardId,
      position: originalPosition, // Will be inserted at original position
      sprintId: originalTask.sprint_id || originalTask.sprintId || null
    };
    
    // FRACTIONAL POSITIONING + BACKGROUND RENUMBERING
    // 1. Insert copy with position = originalPosition - 0.5 (immediately above original)
    // 2. Renumber all tasks in background to clean integers (0, 1, 2, 3...)
    // 3. WebSocket updates keep frontend in sync
    
    // Calculate fractional position: originalPosition - 0.5 (above original)
    const originalPos = typeof originalPosition === 'number' ? originalPosition : parseFloat(originalPosition) || 0;
    let copyPosition = originalPos - 0.5;
    
    await dbTransaction(db, async () => {
      // Create the copy with fractional position (places it right above original)
      newTaskData.position = copyPosition;
      await taskQueries.createTask(db, newTaskData);
      
      // Copy tags
      for (const tag of originalTags) {
        if (tag && tag.id) {
          await helpers.addTagToTask(db, newTaskId, tag.id);
        }
      }
      
      // Copy watchers
      for (const watcher of originalWatchers) {
        if (watcher && watcher.id) {
          const memberId = watcher.id;
          await helpers.addWatcher(db, newTaskId, memberId);
        }
      }
      
      // Copy collaborators
      for (const collaborator of originalCollaborators) {
        if (collaborator && collaborator.id) {
          const memberId = collaborator.id;
          await helpers.addCollaborator(db, newTaskId, memberId);
        }
      }

      // Copy Agent Automation config keys only (reset runtime on new card)
      const originalWork = await taskWorkQueries.getWorkMapByTaskId(db, taskId);
      if (originalWork?.agent_mode === 'automation') {
        const configEntries = {};
        for (const key of AUTOMATION_CONFIG_KEYS) {
          if (originalWork[key] != null && originalWork[key] !== '') {
            configEntries[key] = originalWork[key];
          }
        }
        if (Object.keys(configEntries).length) {
          await taskWorkQueries.upsertWorkEntries(db, newTaskId, configEntries);
        }
      }
    });
    
    // NOTE: Frontend handles renumbering after receiving the copy via WebSocket
    // Backend just creates the copy with +0.5 position, frontend renumbers and sends back
    
    // Log task copy activity
    const board = await helpers.getBoardById(db, boardId);
    const boardTitle = board ? board.title : 'Unknown Board';
    const copyDetails = JSON.stringify({
      en: t('activity.copiedTask', { 
        taskTitle: originalTask.title, 
        boardTitle 
      }, 'en'),
      fr: t('activity.copiedTask', { 
        taskTitle: originalTask.title, 
        boardTitle 
      }, 'fr')
    });
    logTaskActivity(
      userId,
      TASK_ACTIONS.COPY,
      newTaskId,
      copyDetails,
      { 
        columnId: columnId,
        boardId: boardId,
        tenantId: getTenantId(req),
        authType: req.user?.authType,
        db: db,
        skipEmail: skipEmail === true,
      }
    ).catch(error => {
      console.error('Background activity logging failed:', error);
    });
    
    // Log to reporting system
    logReportingActivity(db, 'task_created', userId, newTaskId).catch(error => {
      console.error('Background reporting activity logging failed:', error);
    });
    
    // Fetch the created task with all relationships
    const taskResponse = await fetchTaskWithRelationships(db, newTaskId);
    
    // Ensure taskResponse has required fields for WebSocket event
    const taskForWebSocket = taskResponse || newTaskData;
    if (!taskForWebSocket.columnId && columnId) {
      taskForWebSocket.columnId = columnId;
    }
    if (!taskForWebSocket.boardId && boardId) {
      taskForWebSocket.boardId = boardId;
    }
    // CRITICAL: Always use the calculated copyPosition for WebSocket event
    // This ensures the copy appears at the correct position (right above original)
    // fetchTaskWithRelationships might return position in a different format or missing
    taskForWebSocket.position = copyPosition;
    
    // Publish to Redis/PostgreSQL for real-time updates
    const publishTimestamp = new Date().toISOString();
    await notificationService.publish('task-created', {
      boardId: boardId,
      task: taskForWebSocket,
      timestamp: publishTimestamp
    }, getTenantId(req));
    
    res.json(taskResponse || newTaskData);
  } catch (error) {
    console.error('Error copying task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToCopyTask') || 'Failed to copy task' });
  }
});

// Update task
router.put('/:id', authenticateToken, async (req, res) => {
  const { id: idParam } = req.params;
  const parsed = parseBody(updateTaskBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const task = { ...parsed.data };
  const skipActivity = task.skipActivity === true;
  delete task.skipActivity;
  const userId = req.user?.id || 'system';
  
  const endpointStartTime = Date.now();
  
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const tTranslator = await getTranslator(db);
    const now = new Date().toISOString();
    
    // Resolve ticket (TASK-123) or UUID — Task Page routes use tickets
    const isTicket = /^[A-Z]+-\d+$/i.test(idParam);
    let currentTask = isTicket
      ? await taskQueries.getTaskByTicket(db, idParam)
      : await taskQueries.getTaskById(db, idParam);
    if (!currentTask && task?.id && task.id !== idParam) {
      currentTask = await taskQueries.getTaskById(db, task.id);
    }
    if (!currentTask) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    if (currentTask.deleted_at || currentTask.deletedAt) {
      return res.status(409).json({
        error: tTranslator('errors.taskInTrash'),
        code: 'task_in_trash',
      });
    }
    const id = currentTask.id;
    const validationStartTime = Date.now();
    
    const previousColumnId = currentTask.columnid || currentTask.columnId;
    const previousBoardId = currentTask.boardid || currentTask.boardId;
    
    // Handle priority: prefer priority_id, but support priority name for backward compatibility
    let priorityId = task.priorityId || null;
    let priorityName = task.priority || null;
    
    // Get current task's priority info for comparison
    let currentPriorityId = currentTask.priority_id;
    let currentPriorityName = currentTask.priority;
    
    // MIGRATED: Use sqlManager instead of inline SQL
    // If current task has priority_id but not priority name, look it up
    if (currentPriorityId && !currentPriorityName) {
      currentPriorityName = await helpers.getPriorityNameById(db, currentPriorityId);
    }
    
    // If priority_id is not provided but priority name is, look up the ID
    if (!priorityId && priorityName) {
      const priority = await helpers.getPriorityByName(db, priorityName);
      if (priority) {
        priorityId = priority.id;
      } else {
        // Priority name not found, keep existing priority_id
        priorityId = currentTask.priority_id;
        // Get the name for the existing priority_id
        if (priorityId) {
          priorityName = await helpers.getPriorityNameById(db, priorityId) || priorityName;
        }
      }
    }
    
    // If priority_id is provided, get the name for change tracking
    if (priorityId && !priorityName) {
      priorityName = await helpers.getPriorityNameById(db, priorityId);
    }
    
    // If neither is provided, keep existing values
    if (!priorityId && !priorityName) {
      priorityId = currentTask.priority_id;
      priorityName = currentTask.priority || currentPriorityName;
    }
    
    // Normalize currentTask field names (database returns snake_case, frontend uses camelCase)
    const normalizedCurrentTask = {
      title: currentTask.title || null,
      description: currentTask.description || null,
      memberId: currentTask.memberid || currentTask.memberId || null,
      requesterId: currentTask.requesterid || currentTask.requesterId || null,
      startDate: currentTask.startdate || currentTask.startDate || null,
      dueDate: currentTask.duedate || currentTask.dueDate || null,
      effort: currentTask.effort !== null && currentTask.effort !== undefined ? currentTask.effort : null,
      columnId: currentTask.columnid || currentTask.columnId || null,
      boardId: currentTask.boardid || currentTask.boardId || null,
      isBlocked: Boolean(currentTask.is_blocked ?? currentTask.isBlocked),
      blockedReason: currentTask.blocked_reason || currentTask.blockedReason || null,
    };
    
    // Helper function to normalize values for comparison (treat null, undefined, empty string as equivalent)
    const normalizeValue = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      // For dates, normalize to ISO string format for comparison (handle both Date objects and date strings)
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]; // YYYY-MM-DD format
      }
      // For date strings, normalize format (YYYY-MM-DD)
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.split('T')[0]; // Extract date part if it's a datetime string
      }
      // For strings, trim whitespace
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
      }
      return value;
    };
    
    // Helper function to check if two values are actually different
    const hasChanged = (oldValue, newValue) => {
      const normalizedOld = normalizeValue(oldValue);
      const normalizedNew = normalizeValue(newValue);
      
      // Both null/empty - no change
      if (normalizedOld === null && normalizedNew === null) {
        return false;
      }
      
      // One is null, other is not - change
      if (normalizedOld === null || normalizedNew === null) {
        return normalizedOld !== normalizedNew;
      }
      
      // Both have values - compare
      return normalizedOld !== normalizedNew;
    };
    
    // Generate change details
    const changes = [];
    // Note: blockedReason is tracked for WebSocket below, but not activity-logged (too noisy while typing)
    const fieldsToTrack = ['title', 'description', 'memberId', 'requesterId', 'startDate', 'dueDate', 'effort', 'columnId', 'isBlocked'];
    
    // Check if priority changed. Coerce IDs to string — client often sends "5" while PG returns 5,
    // which previously logged bogus "normal" → "normal" activities (e.g. on comment-triggered PUTs).
    const normalizePriorityId = (value) => {
      if (value === null || value === undefined || value === '') return null;
      return String(value);
    };
    const normalizePriorityLabel = (value) =>
      String(value ?? '')
        .trim()
        .toLowerCase();
    const priorityIdChanged =
      normalizePriorityId(priorityId) !== normalizePriorityId(currentPriorityId);
    const oldPriorityLabel = currentPriorityName || t('activity.unknownPriority', {}, 'en');
    const newPriorityLabel = priorityName || t('activity.unknownPriority', {}, 'en');
    const priorityLabelChanged =
      normalizePriorityLabel(oldPriorityLabel) !== normalizePriorityLabel(newPriorityLabel);
    // ID coercion alone ("5" vs 5) must never create activity; require a real label change.
    const priorityChanged = priorityIdChanged && priorityLabelChanged;
    
    if (priorityChanged) {
      // Priority names are user content (same in both langs); only missing-name fallbacks differ.
      if (currentPriorityName && priorityName) {
        changes.push(
          await generateTaskUpdateDetails('priorityId', currentPriorityName, priorityName, '', db)
        );
      } else {
        const detailEn = JSON.parse(
          await generateTaskUpdateDetails(
            'priorityId',
            currentPriorityName || t('activity.unknownPriority', {}, 'en'),
            priorityName || t('activity.unknownPriority', {}, 'en'),
            '',
            db
          )
        );
        const detailFr = JSON.parse(
          await generateTaskUpdateDetails(
            'priorityId',
            currentPriorityName || t('activity.unknownPriority', {}, 'fr'),
            priorityName || t('activity.unknownPriority', {}, 'fr'),
            '',
            db
          )
        );
        changes.push(JSON.stringify({ en: detailEn.en, fr: detailFr.fr }));
      }
    }
    
    // Check if sprint changed - handle separately like priority
    const currentSprintId = currentTask.sprint_id || currentTask.sprintId || null;
    const newSprintId = task.sprintId || null;
    let oldSprintName = null;
    let newSprintName = null;
    if (hasChanged(currentSprintId, newSprintId)) {
      
      if (currentSprintId) {
        try {
          const oldSprint = await sprintQueries.getSprintById(db, currentSprintId);
          oldSprintName = oldSprint?.name || null;
        } catch (error) {
          console.warn('Failed to get old sprint name:', error.message);
        }
      }
      
      if (newSprintId) {
        try {
          const newSprint = await sprintQueries.getSprintById(db, newSprintId);
          newSprintName = newSprint?.name || null;
        } catch (error) {
          console.warn('Failed to get new sprint name:', error.message);
        }
      }
      
      // Get task and board info for context
      const taskInfo = await taskQueries.getTaskWithBoardColumnInfo(db, id);
      const taskDetails = await taskQueries.getTaskById(db, id);
      const taskTicket = taskDetails?.ticket || null;
      const taskRef = taskTicket ? ` (${taskTicket})` : '';
      const taskTitle = taskInfo?.title || task.title;
      const boardTitle = taskInfo?.board_title || 'Unknown Board';
      
      // Get bilingual translations
      const unknownBoardEn = t('activity.unknownBoard', {}, 'en');
      const unknownBoardFr = t('activity.unknownBoard', {}, 'fr');
      
      const translatedBoardTitle = {
        en: boardTitle === 'Unknown Board' ? unknownBoardEn : boardTitle,
        fr: boardTitle === 'Unknown Board' ? unknownBoardFr : boardTitle
      };
      
      // Generate bilingual message
      let sprintChangeText;
      if (oldSprintName && newSprintName) {
        // Changed from one sprint to another
        sprintChangeText = JSON.stringify({
          en: t('activity.removedSprint', {
            sprintName: oldSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.en
          }, 'en') + ', ' + t('activity.associatedSprint', {
            sprintName: newSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.en
          }, 'en'),
          fr: t('activity.removedSprint', {
            sprintName: oldSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.fr
          }, 'fr') + ', ' + t('activity.associatedSprint', {
            sprintName: newSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.fr
          }, 'fr')
        });
      } else if (oldSprintName && !newSprintName) {
        // Removed from sprint
        sprintChangeText = JSON.stringify({
          en: t('activity.removedSprint', {
            sprintName: oldSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.en
          }, 'en'),
          fr: t('activity.removedSprint', {
            sprintName: oldSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.fr
          }, 'fr')
        });
      } else if (!oldSprintName && newSprintName) {
        // Associated with sprint
        sprintChangeText = JSON.stringify({
          en: t('activity.associatedSprint', {
            sprintName: newSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.en
          }, 'en'),
          fr: t('activity.associatedSprint', {
            sprintName: newSprintName,
            taskTitle: taskTitle,
            taskRef: taskRef,
            boardTitle: translatedBoardTitle.fr
          }, 'fr')
        });
      }
      
      if (sprintChangeText) {
        changes.push(sprintChangeText);
      }
    }
    
    // Process fields sequentially to handle async operations
    let columnMoveDisplayOld = null;
    let columnMoveDisplayNew = null;
    for (const field of fieldsToTrack) {
      const oldValue = normalizedCurrentTask[field];
      const newValue = task[field];
      
      if (hasChanged(oldValue, newValue)) {
        if (field === 'columnId') {
          // MIGRATED: Special handling for column moves - get column titles for better readability
          const oldColumn = await helpers.getColumnById(db, oldValue);
          const newColumn = await helpers.getColumnById(db, newValue);
          const taskRef = task.ticket ? ` (${task.ticket})` : '';
          const fromColumnEn = oldColumn?.title || t('activity.unknownColumn', {}, 'en');
          const toColumnEn = newColumn?.title || t('activity.unknownColumn', {}, 'en');
          const fromColumnFr = oldColumn?.title || t('activity.unknownColumn', {}, 'fr');
          const toColumnFr = newColumn?.title || t('activity.unknownColumn', {}, 'fr');
          // Email "Changed" card must use titles, not column IDs
          columnMoveDisplayOld = fromColumnEn;
          columnMoveDisplayNew = toColumnEn;
          // Create bilingual message for column move
          const movedTaskText = JSON.stringify({
            en: t('activity.movedTaskFromTo', {
              taskTitle: task.title,
              taskRef,
              fromColumn: fromColumnEn,
              toColumn: toColumnEn
            }, 'en'),
            fr: t('activity.movedTaskFromTo', {
              taskTitle: task.title,
              taskRef,
              fromColumn: fromColumnFr,
              toColumn: toColumnFr
            }, 'fr')
          });
          changes.push(movedTaskText);
        } else {
          // Always use normalized camelCase fields — raw currentTask is snake_case from PG
          const oldVal =
            field === 'isBlocked'
              ? normalizedCurrentTask.isBlocked
              : normalizedCurrentTask[field];
          const newVal =
            field === 'isBlocked' ? Boolean(task.isBlocked) : task[field];
          const changeDetails = await generateTaskUpdateDetails(field, oldVal, newVal, '', db);
          try {
            const parsed = JSON.parse(changeDetails);
            if (parsed.skip) continue;
          } catch {
            /* use as-is */
          }
          changes.push(changeDetails);
        }
      }
    }
    
    const validationTime = Date.now() - validationStartTime;
    taskHttpLog(dbgHttp, `⏱️  [PUT /tasks/:id] Task validation took ${validationTime}ms`);
    
    // MIGRATED: Use sqlManager instead of inline SQL
    const dbUpdateStartTime = Date.now();
    // Preserve existing startDate if new one is null/undefined (PostgreSQL NOT NULL constraint)
    const startDate = task.startDate != null ? task.startDate : (normalizedCurrentTask.startDate || new Date().toISOString().split('T')[0]);
    // Task Page loads by ticket and historically omitted camelCase location fields — never wipe them.
    const nextColumnId = task.columnId ?? task.columnid ?? normalizedCurrentTask.columnId;
    const nextBoardId = task.boardId ?? task.boardid ?? normalizedCurrentTask.boardId;
    // Explicit null clears assignee/requester; omit keeps current (?? cannot clear).
    const nextMemberId =
      'memberId' in task || 'memberid' in task
        ? (task.memberId !== undefined ? task.memberId : task.memberid) || null
        : (normalizedCurrentTask.memberId || null);
    const nextRequesterId =
      'requesterId' in task || 'requesterid' in task
        ? (task.requesterId !== undefined ? task.requesterId : task.requesterid) || null
        : (normalizedCurrentTask.requesterId || null);
    if (
      nextMemberId &&
      nextMemberId !== (normalizedCurrentTask.memberId || null) &&
      (await memberQueries.isReadOnlyViewerMember(db, nextMemberId))
    ) {
      return res.status(400).json({ error: tTranslator('errors.cannotAssignViewer') });
    }
    await taskQueries.updateTask(db, id, {
      title: task.title !== undefined ? task.title : currentTask.title,
      description: task.description !== undefined ? task.description : normalizedCurrentTask.description,
      memberId: nextMemberId,
      requesterId: nextRequesterId,
      startDate: startDate,
      dueDate: task.dueDate !== undefined ? task.dueDate : normalizedCurrentTask.dueDate,
      effort: task.effort != null ? task.effort : (normalizedCurrentTask.effort ?? 0),
      priority: priorityName,
      priority_id: priorityId,
      columnId: nextColumnId,
      boardId: nextBoardId,
      position: task.position != null ? task.position : (currentTask.position || 0),
      sprint_id: task.sprintId !== undefined ? (task.sprintId || null) : (currentTask.sprint_id || currentTask.sprintId || null),
      pre_boardId: previousBoardId,
      pre_columnId: previousColumnId,
      isBlocked: task.isBlocked !== undefined ? Boolean(task.isBlocked) : Boolean(currentTask.is_blocked ?? currentTask.isBlocked),
      blockedReason:
        task.blockedReason !== undefined
          ? (task.blockedReason || null)
          : (currentTask.blocked_reason || currentTask.blockedReason || null),
    });
    const dbUpdateTime = Date.now() - dbUpdateStartTime;
    taskHttpLog(dbgHttp, `⏱️  [PUT /tasks/:id] Database updates took ${dbUpdateTime}ms`);
    
    // Log activity if there were changes (skipped for multi-select bulk; one summary is logged separately)
    if (changes.length > 0 && !skipActivity) {
      const activityStartTime = Date.now();
      
      // Parse bilingual JSON from changes and combine them properly
      // Note: We pass partial details (just the changes) and let logTaskActivity add task/board context
      let details;
      if (changes.length === 1) {
        // Single change - use as-is (already bilingual JSON)
        details = changes[0];
      } else {
        // Multiple changes - parse each JSON and combine
        const messagesEn = [];
        const messagesFr = [];
        
        for (const change of changes) {
          try {
            const parsed = JSON.parse(change);
            if (parsed.en && parsed.fr) {
              // Bilingual JSON
              messagesEn.push(parsed.en);
              messagesFr.push(parsed.fr);
            } else {
              // Not valid bilingual JSON, use as-is for both languages
              messagesEn.push(change);
              messagesFr.push(change);
            }
          } catch {
            // Not JSON, use as-is for both languages (backward compatibility)
            messagesEn.push(change);
            messagesFr.push(change);
          }
        }
        
        // Create combined bilingual message (without prefix - logTaskActivity will add context)
        details = JSON.stringify({
          en: messagesEn.join(', '),
          fr: messagesFr.join(', ')
        });
      }
      
      // For single field changes, pass old/new + field for email templates
      let oldValue;
      let newValue;
      let changedField;
      const emailItems = [];
      if (priorityChanged) {
        let oldPriorityColor = null;
        let newPriorityColor = null;
        try {
          if (currentPriorityId) {
            const oldPri = await helpers.getPriorityById(db, currentPriorityId);
            oldPriorityColor = oldPri?.color || null;
          }
          if (priorityId) {
            const newPri = await helpers.getPriorityById(db, priorityId);
            newPriorityColor = newPri?.color || null;
          }
        } catch {
          /* keep names without colors */
        }
        emailItems.push({
          field: 'priorityId',
          oldName: oldPriorityLabel,
          newName: newPriorityLabel,
          oldColor: oldPriorityColor,
          newColor: newPriorityColor,
        });
      }
      if (hasChanged(currentSprintId, newSprintId)) {
        emailItems.push({
          field: 'sprintId',
          oldName: oldSprintName,
          newName: newSprintName,
        });
      }
      for (const field of fieldsToTrack) {
        if (field === 'effort') continue;
        if (!hasChanged(normalizedCurrentTask[field], task[field])) continue;
        if (field === 'columnId' && columnMoveDisplayOld != null && columnMoveDisplayNew != null) {
          emailItems.push({
            field: 'columnId',
            oldValue: columnMoveDisplayOld,
            newValue: columnMoveDisplayNew,
          });
          continue;
        }
        emailItems.push({
          field,
          oldValue: normalizedCurrentTask[field],
          newValue: task[field],
        });
      }

      const skipEmailEffortOnly = emailItems.length === 0 && hasChanged(normalizedCurrentTask.effort, task.effort);

      if (changes.length === 1) {
        changedField = fieldsToTrack.find((field) =>
          hasChanged(normalizedCurrentTask[field], task[field])
        );
        if (!changedField && priorityChanged) changedField = 'priorityId';
        if (!changedField && hasChanged(currentSprintId, newSprintId)) changedField = 'sprintId';
        if (changedField) {
          if (
            changedField === 'columnId' &&
            columnMoveDisplayOld != null &&
            columnMoveDisplayNew != null
          ) {
            oldValue = columnMoveDisplayOld;
            newValue = columnMoveDisplayNew;
          } else if (changedField === 'priorityId') {
            oldValue = oldPriorityLabel;
            newValue = newPriorityLabel;
          } else if (changedField === 'sprintId') {
            oldValue = oldSprintName;
            newValue = newSprintName;
          } else {
            oldValue = normalizedCurrentTask[changedField];
            newValue = task[changedField];
          }
        }
      } else if (emailItems.some((i) => i.field === 'memberId')) {
        changedField = 'memberId';
        oldValue = normalizedCurrentTask.memberId;
        newValue = task.memberId;
      }

      logTaskActivity(
        userId,
        TASK_ACTIONS.UPDATE,
        id,
        details,
        {
          columnId: task.columnId,
          boardId: task.boardId,
          oldValue,
          newValue,
          changedField,
          emailChange: { items: emailItems },
          skipEmail: skipEmailEffortOnly,
          tenantId: getTenantId(req),
          authType: req.user?.authType,
          db: db
        }
      ).catch(error => {
        console.error('Background activity logging failed:', error);
        // Don't throw - activity logging should never break main flow
      });
      const activityTime = Date.now() - activityStartTime;
      taskHttpLog(dbgHttp, `⏱️  [PUT /tasks/:id] Activity logging took ${activityTime}ms`);
      
      // Log to reporting system (fire-and-forget: Don't await to avoid blocking API response)
      // Check if this is a column move (use normalized values)
      if (hasChanged(normalizedCurrentTask.columnId, task.columnId)) {
        // MIGRATED: Get column info to check if task is completed
        const newColumn = await helpers.getColumnWithStatus(db, task.columnId);
        const oldColumn = await helpers.getColumnById(db, currentTask.columnId);
        
        const eventType = newColumn?.isFinished ? 'task_completed' : 'task_moved';
        logReportingActivity(db, eventType, userId, id, {
          fromColumnId: currentTask.columnId,
          fromColumnName: oldColumn?.title,
          toColumnId: task.columnId,
          toColumnName: newColumn?.title
        }).catch(error => {
          console.error('Background reporting activity logging failed:', error);
        });
      } else {
        // Regular update
        logReportingActivity(db, 'task_updated', userId, id).catch(error => {
          console.error('Background reporting activity logging failed:', error);
        });
      }
    }
    
    // Build minimal WebSocket payload with only changed fields (optimization: reduce payload size by 80-95%)
    const wsStartTime = Date.now();
    
    // MIGRATED: Get priority info only if priority changed (avoid unnecessary query)
    let priorityInfo = null;
    if (priorityChanged) {
      if (priorityId) {
        const priority = await helpers.getPriorityById(db, priorityId);
        if (priority) {
          priorityInfo = {
            priorityId: priorityId,
            priorityName: priority.priority,
            priorityColor: priority.color
          };
        }
      }
    }
    
    // Determine which fields changed (already tracked in changes array, but build explicit list)
    const changedFields = [];
    for (const field of fieldsToTrack) {
      const oldValue = normalizedCurrentTask[field];
      const newValue = task[field];
      if (hasChanged(oldValue, newValue)) {
        changedFields.push(field);
      }
    }
    const currentBoardId = normalizedCurrentTask.boardId;
    if (hasChanged(currentBoardId, task.boardId)) changedFields.push('boardId');
    const currentPosition = currentTask.position || 0;
    const newPosition = task.position ?? 0;
    if (currentPosition !== newPosition) changedFields.push('position');
    // Sprint change detection is handled earlier in the function (around line 1028)
    // where we also generate the bilingual activity log message
    // Reuse the same variables declared earlier for WebSocket tracking
    if (hasChanged(currentSprintId, newSprintId)) changedFields.push('sprintId');
    // Reason-only edits must still publish so board cards / peers refresh the tooltip text
    const newBlockedReason =
      task.blockedReason !== undefined ? (task.blockedReason || null) : normalizedCurrentTask.blockedReason;
    if (hasChanged(normalizedCurrentTask.blockedReason, newBlockedReason)) {
      changedFields.push('blockedReason');
    }
    
    // Build minimal payload (only changed fields + required fields)
    const { minimalTask, targetBoardId } = buildMinimalTaskUpdatePayload(
      currentTask,
      task,
      changedFields,
      priorityChanged,
      priorityInfo
    );
    
    // Add updatedBy (always include for tracking)
    minimalTask.updatedBy = userId;
    
    const webSocketData = {
      boardId: targetBoardId,
      task: minimalTask,
      timestamp: new Date().toISOString()
    };
    
    await notificationService.publish('task-updated', webSocketData, getTenantId(req));
    const wsTime = Date.now() - wsStartTime;
    const payloadSize = JSON.stringify(webSocketData).length;
    taskHttpLog(dbgHttp, `⏱️  [PUT /tasks/:id] WebSocket publishing took ${wsTime}ms (payload: ${payloadSize} bytes, ${changedFields.length} fields changed)`);
    
    // Still fetch full task for API response (frontend that made the request needs full data)
    const fetchStartTime = Date.now();
    const taskResponse = await fetchTaskWithRelationships(db, id);
    const fetchTime = Date.now() - fetchStartTime;
    taskHttpLog(dbgHttp, `⏱️  [PUT /tasks/:id] Fetching task with relationships for API response took ${fetchTime}ms`);
    
    const totalTime = Date.now() - endpointStartTime;
    taskHttpLog(dbgHttp, `⏱️  [PUT /tasks/:id] Total endpoint time: ${totalTime}ms`);
    
    res.json(taskResponse);
  } catch (error) {
    console.error('Error updating task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToUpdateTask') });
  }
});

// Log one activity-feed entry for a kanban multi-select field change
router.post('/bulk-field-activity', authenticateToken, async (req, res) => {
  try {
    const parsed = parseBody(bulkFieldActivityBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error || 'Invalid bulk activity payload' });
    }
    const db = getRequestDatabase(req);
    const userId = req.user?.id || 'system';
    const {
      field,
      taskIds,
      newValue = null,
      oldValue = null,
      newLabel = null,
      boardId = null,
      restoredPrevious = false,
      reason = null,
    } = parsed.data;

    await logBulkTaskFieldActivity(
      userId,
      field,
      {
        taskIds,
        newValue,
        oldValue,
        newLabel,
        boardId,
        restoredPrevious: restoredPrevious === true,
        reason: reason || null,
      },
      {
        db,
        tenantId: getTenantId(req),
        authType: req.user?.authType,
      }
    );

    res.json({ success: true, count: taskIds.length });
  } catch (error) {
    console.error('Bulk field activity error:', error);
    res.status(500).json({ error: 'Failed to log bulk activity' });
  }
});

// Batch update tasks (for timeline arrow key movements and other bulk updates)
router.post('/batch-update', authenticateToken, async (req, res) => {
  const parsed = parseBody(batchUpdateTasksBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error || 'Invalid tasks array' });
  }
  const { tasks } = parsed.data;
  const userId = req.user?.id || 'system';
  
  try {
    const endpointStartTime = Date.now();
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const tTranslator = await getTranslator(db);
    const now = new Date().toISOString();
    
    // MIGRATED: Validate all tasks exist
    const taskIds = tasks.map(t => t.id);
    const existingTasks = await taskQueries.getTasksByIdsBasic(db, taskIds);
    
    const existingTaskMap = new Map(existingTasks.map(t => [t.id, t]));
    const missingTasks = taskIds.filter(id => !existingTaskMap.has(id));
    
    if (missingTasks.length > 0) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') + `: ${missingTasks.join(', ')}` });
    }

    for (const task of tasks) {
      if (!task.memberId) continue;
      const current = existingTaskMap.get(task.id);
      const currentMemberId = current?.memberId || current?.memberid || null;
      if (task.memberId === currentMemberId) continue;
      if (await memberQueries.isReadOnlyViewerMember(db, task.memberId)) {
        return res.status(400).json({ error: tTranslator('errors.cannotAssignViewer') });
      }
    }
    
    // MIGRATED: Get all priorities for lookup
    const allPriorities = await helpers.getAllPriorities(db);
    const priorityMap = new Map(allPriorities.map(p => [p.priority, p.id]));
    const priorityIdMap = new Map(allPriorities.map(p => [p.id, p.priority]));
    
    
    // Collect queries and send as a batched transaction
    const batchQueries = [];
    const updateQuerySameColumn = `
      UPDATE tasks SET 
        title = ?, description = ?, memberid = ?, requesterid = ?, startdate = ?, 
        duedate = ?, effort = ?, priority = ?, priority_id = ?, columnid = ?, boardid = ?, position = ?, 
        sprint_id = ?, pre_boardid = ?, pre_columnid = ?, updated_at = ? 
      WHERE id = ?
    `;
    const updateQueryCrossColumn = `
      UPDATE tasks SET 
        title = ?, description = ?, memberid = ?, requesterid = ?, startdate = ?, 
        duedate = ?, effort = ?, priority = ?, priority_id = ?, columnid = ?, boardid = ?, position = ?, 
        sprint_id = ?, pre_boardid = ?, pre_columnid = ?, column_entered_at = ?, updated_at = ? 
      WHERE id = ?
    `;
    
    for (const task of tasks) {
      const currentTask = existingTaskMap.get(task.id);
      if (!currentTask) continue;
      
      const previousColumnId = currentTask.columnId;
      const previousBoardId = currentTask.boardId;
      
      // Handle priority: prefer priority_id, but support priority name for backward compatibility
      let priorityId = task.priorityId || null;
      let priorityName = task.priority || null;
      
      // If priority_id is not provided but priority name is, look it up
      if (!priorityId && priorityName) {
        priorityId = priorityMap.get(priorityName) || null;
      }
      
      // If priority_id is provided, get the name
      if (priorityId && !priorityName) {
        priorityName = priorityIdMap.get(priorityId) || null;
      }
      
      // If neither is provided, keep existing values
      if (!priorityId && !priorityName) {
        priorityId = currentTask.priority_id;
        priorityName = currentTask.priority;
      }

      const columnChanged = task.columnId && task.columnId !== previousColumnId;
      if (columnChanged) {
        batchQueries.push({
          query: updateQueryCrossColumn,
          params: [
            task.title, task.description, task.memberId, task.requesterId, task.startDate,
            task.dueDate, task.effort, priorityName, priorityId, task.columnId, task.boardId, task.position || 0,
            task.sprintId || null, previousBoardId, previousColumnId, now, now, task.id
          ]
        });
      } else {
        batchQueries.push({
          query: updateQuerySameColumn,
          params: [
            task.title, task.description, task.memberId, task.requesterId, task.startDate,
            task.dueDate, task.effort, priorityName, priorityId, task.columnId, task.boardId, task.position || 0,
            task.sprintId || null, previousBoardId, previousColumnId, now, task.id
          ]
        });
      }
    }
    
    // Execute all updates in a single batched transaction
    taskHttpLog(dbgHttp, `🚀 [batch-update] Using batched transaction for ${batchQueries.length} updates `);
    await db.executeBatchTransaction(batchQueries);
    taskHttpLog(dbgHttp, `✅ [batch-update] Batched transaction completed in ${Date.now() - endpointStartTime}ms for ${batchQueries.length} updates`);

    
    // Fetch all updated tasks with relationships (batched)
    const fetchStartTime = Date.now();
    const taskResponses = await fetchTasksWithRelationshipsBatch(db, taskIds);
    taskHttpLog(dbgHttp, `⏱️  [batch-update] Fetching ${taskIds.length} tasks with relationships (batched) took ${Date.now() - fetchStartTime}ms`);
    
    // Publish WebSocket updates for all changed tasks in the background (non-blocking)
    // JSON.stringify() on large task objects can be slow, so we don't block the response
    const publishPromises = taskResponses.map(task =>
      notificationService.publish('task-updated', {
        boardId: task.boardId,
        task: {
          ...task,
          updatedBy: userId
        },
        timestamp: new Date().toISOString()
      }, getTenantId(req)).catch(error => {
        console.error('❌ Background WebSocket publish failed:', error);
      })
    );
    
    // Start publishing in background (fire-and-forget)
    Promise.all(publishPromises).catch(error => {
      console.error('❌ Background WebSocket publish batch failed:', error);
    });
    
    taskHttpLog(dbgHttp, `⏱️  [batch-update] Total endpoint time: ${Date.now() - endpointStartTime}ms for ${tasks.length} updates (WebSocket publishing in background)`);
    
    res.json({ tasks: taskResponses, updated: taskResponses.length });
  } catch (error) {
    console.error('Error batch updating tasks:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToUpdateTask') });
  }
});

// Soft-delete task (move to trash)
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || 'system';
  const skipEmail =
    req.query.skipEmail === 'true' ||
    req.query.skipEmail === '1' ||
    req.body?.skipEmail === true;
  
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const task = await taskQueries.getTaskById(db, id);
    if (!task || task.deleted_at || task.deletedAt) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    const board = await helpers.getBoardById(db, task.boardid || task.boardId);
    const boardTitle = board ? board.title : 'Unknown Board';
    const projectIdentifier = board?.project || null;
    const taskTicket = task.ticket || null;
    const columnId = task.columnid || task.columnId;
    const boardId = task.boardid || task.boardId;

    logReportingActivity(db, 'task_deleted', userId, id).catch((error) => {
      console.error('Background reporting activity logging failed:', error);
    });

    const softDeleted = await taskQueries.softDeleteTask(db, id, userId);
    if (!softDeleted) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }

    const taskRef = taskTicket ? ` (${taskTicket})` : '';
    const deleteDetails = JSON.stringify({
      en: t('activity.deletedTask', { taskTitle: task.title, taskRef, boardTitle }, 'en'),
      fr: t('activity.deletedTask', { taskTitle: task.title, taskRef, boardTitle }, 'fr'),
    });
    logTaskActivity(userId, TASK_ACTIONS.DELETE, id, deleteDetails, {
      columnId,
      boardId,
      tenantId: getTenantId(req),
      authType: req.user?.authType,
      db,
      taskTicket,
      projectIdentifier,
      skipEmail: skipEmail === true,
    }).catch((error) => {
      console.error('Background activity logging failed:', error);
    });

    // Positions keep their gaps; dense 0..n renumber is unnecessary and slow on large columns.
    notificationService.publish('task-deleted', {
      boardId,
      taskId: id,
      softDeleted: true,
      timestamp: new Date().toISOString(),
    }, getTenantId(req)).catch((error) => {
      console.error('Background WebSocket publish failed:', error);
    });

    res.json({ message: 'Task moved to trash', softDeleted: true });
  } catch (error) {
    console.error('Error soft-deleting task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToDeleteTask') });
  }
});

// Restore soft-deleted task
router.post('/:id/restore', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const task = await taskQueries.getTaskById(db, id);
    if (!task || !(task.deleted_at || task.deletedAt)) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }

    const boardId = task.boardid || task.boardId;
    const board = await boardQueries.getBoardById(db, boardId);
    if (!board) {
      return res.status(409).json({
        error: 'Board no longer exists',
        code: 'board_gone',
      });
    }
    if (board.deleted_at || board.deletedAt) {
      return res.status(409).json({
        error: 'Restore the board before restoring this task',
        code: 'board_soft_deleted',
      });
    }

    const originalColumnId = task.columnid || task.columnId;
    const originalPosition = Number(task.position);
    let columnId = originalColumnId;
    const boardColumns = await helpers.getColumnsForBoard(db, boardId);
    const colOnBoard = (boardColumns || []).find((c) => c.id === columnId);
    let usedOriginalColumn = true;
    if (!colOnBoard) {
      usedOriginalColumn = false;
      const nonArchived = (boardColumns || []).find(
        (c) => !(c.is_archived === true || c.is_archived === 1)
      );
      if (!nonArchived) {
        return res.status(409).json({
          error: 'No column available to restore this task',
          code: 'no_column',
        });
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

    await taskQueries.restoreTask(db, id, columnId, boardId, position);

    // Use the same normalizer as GET/POST task responses (isBlocked, blockedReason, columnEnteredAt, …)
    const restored = await fetchTaskWithRelationships(db, id);
    if (!restored) {
      return res.status(500).json({ error: tTranslator('errors.failedToUpdateTask') || 'Failed to restore task' });
    }
    restored.deletedAt = null;
    restored.deletedBy = null;
    restored.deleted_at = null;
    restored.deleted_by = null;
    restored.position = position;
    restored.columnId = columnId;
    restored.boardId = boardId;

    const tenantId = getTenantId(req);

    // Only publish shifted siblings (usually small). Full-column snapshots blow past
    // PostgreSQL NOTIFY's 8KB limit on large boards and the event becomes a useless stub.
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

    const boardTitle = board.title || 'Unknown Board';
    const projectIdentifier = board?.project || null;
    const taskTicket = task.ticket || restored.ticket || null;
    const taskRef = taskTicket ? ` (${taskTicket})` : '';
    const userId = req.user?.id || 'system';
    const restoreDetails = JSON.stringify({
      en: t('activity.restoredTask', {
        taskTitle: task.title || restored.title,
        taskRef,
        boardTitle,
      }, 'en'),
      fr: t('activity.restoredTask', {
        taskTitle: task.title || restored.title,
        taskRef,
        boardTitle,
      }, 'fr'),
    });
    logTaskActivity(userId, TASK_ACTIONS.RESTORE, id, restoreDetails, {
      columnId,
      boardId,
      tenantId,
      authType: req.user?.authType,
      db,
      taskTicket,
      projectIdentifier,
    }).catch((error) => {
      console.error('Background activity logging failed:', error);
    });

    // Keep NOTIFY lean: no positionUpdates array (8KB limit). Peers bump locally / apply shifted WS.
    await notificationService.publish(
      'task-restored',
      {
        boardId,
        task: restored,
        timestamp: new Date().toISOString(),
      },
      tenantId
    );

    res.json(restored);
  } catch (error) {
    console.error('Error restoring task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToUpdateTask') || 'Failed to restore task' });
  }
});

// Permanently purge a soft-deleted (or any) task — admin only
router.delete('/:id/permanent', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const task = await taskQueries.getTaskById(db, id);
    if (!task) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    const boardId = task.boardid || task.boardId;
    const wasSoftDeleted = !!(task.deleted_at || task.deletedAt);

    await purgeTaskCompletely(db, id, resolveTenantStoragePaths(req));
    updateStorageUsage(db).catch((error) => {
      console.error('Background storage usage update failed:', error);
    });

    notificationService.publish(
      wasSoftDeleted ? 'task-purged' : 'task-deleted',
      {
        boardId,
        taskId: id,
        timestamp: new Date().toISOString(),
      },
      getTenantId(req)
    ).catch((error) => {
      console.error('Background WebSocket publish failed:', error);
    });

    res.json({ message: 'Task permanently deleted' });
  } catch (error) {
    console.error('Error permanently deleting task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToDeleteTask') });
  }
});

// Batch permanent purge — admin only
router.post('/permanent-batch', authenticateToken, requireRole(['admin']), async (req, res) => {
  const parsed = parseBody(permanentBatchBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error || 'taskIds array required' });
  }
  const { taskIds } = parsed.data;
  try {
    const db = getRequestDatabase(req);
    const storagePaths = resolveTenantStoragePaths(req);
    const purged = [];
    for (const taskId of taskIds) {
      const task = await taskQueries.getTaskById(db, taskId);
      if (!task) continue;
      const boardId = task.boardid || task.boardId;
      const wasSoftDeleted = !!(task.deleted_at || task.deletedAt);
      await purgeTaskCompletely(db, taskId, storagePaths);
      notificationService.publish(
        wasSoftDeleted ? 'task-purged' : 'task-deleted',
        {
          boardId,
          taskId,
          timestamp: new Date().toISOString(),
        },
        getTenantId(req)
      ).catch((error) => {
        console.error('Background WebSocket publish failed:', error);
      });
      purged.push(taskId);
    }
    if (purged.length > 0) {
      updateStorageUsage(db).catch((error) => {
        console.error('Background storage usage update failed:', error);
      });
    }
    res.json({ purged });
  } catch (error) {
    console.error('Error batch purging tasks:', error);
    res.status(500).json({ error: 'Failed to permanently delete tasks' });
  }
});

// Batch update task positions (optimized for drag-and-drop reordering)
router.post('/batch-update-positions', authenticateToken, async (req, res) => {
  const parsed = parseBody(batchUpdatePositionsBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error || 'Invalid updates array' });
  }
  const { updates } = parsed.data;
  const userId = req.user?.id || 'system';
  
  try {
    const endpointStartTime = Date.now();
    const timestamp = new Date().toISOString();
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    taskHttpLog(dbgHttp, `[${timestamp}] 🔄 [batch-update-positions] Received ${updates.length} updates`);
    
    const tTranslator = await getTranslator(db); // Use different name to avoid shadowing imported t
    const now = new Date().toISOString();
    
    // MIGRATED: Validate all tasks exist and get their current data
    const validateStartTime = Date.now();
    // Last write wins for duplicate taskIds (rapid DnD can send the same id twice when
    // local columns briefly contain ghost duplicates). Unique ids for the DB length check.
    const updatesByTaskId = new Map();
    for (const update of updates) {
      if (!update?.taskId) continue;
      updatesByTaskId.set(update.taskId, update);
    }
    const uniqueUpdates = Array.from(updatesByTaskId.values());
    const taskIds = Array.from(updatesByTaskId.keys());
    const currentTasks = await taskQueries.getTasksByIdsBasic(db, taskIds);
    taskHttpLog(dbgHttp, `⏱️  [batch-update-positions] Task validation took ${Date.now() - validateStartTime}ms`);
    
    if (currentTasks.length !== taskIds.length) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    const taskMap = new Map(currentTasks.map(t => [t.id, t]));
    
    // Group updates by column for efficient batch processing
    const updatesByColumn = new Map();
    uniqueUpdates.forEach(update => {
      const currentTask = taskMap.get(update.taskId);
      if (!currentTask) return;
      
      const currentColumnId = currentTask.columnId || currentTask.columnid;
      const columnId = update.columnId || currentColumnId;
      if (!updatesByColumn.has(columnId)) {
        updatesByColumn.set(columnId, []);
      }
      // Ensure position is a number (handle string conversion from JSON)
      const position = typeof update.position === 'number' 
        ? update.position 
        : parseFloat(update.position) || 0;
      
      updatesByColumn.get(columnId).push({
        taskId: update.taskId,
        position: position, // Use parsed numeric position
        columnId: columnId,
        previousColumnId: currentColumnId,
        previousBoardId: currentTask.boardId,
        previousPosition: currentTask.position,
        title: currentTask.title
      });
    });
    
    // Execute all updates in a single batched transaction
    const batchQueries = [];
    const sameColumnQuery = `
      UPDATE tasks SET 
        position = $1, 
        columnid = $2,
        pre_boardid = $3, 
        pre_columnid = $4,
        updated_at = $5
      WHERE id = $6
    `;
    const crossColumnQuery = `
      UPDATE tasks SET 
        position = $1, 
        columnid = $2,
        pre_boardid = $3, 
        pre_columnid = $4,
        column_entered_at = $5,
        updated_at = $6
      WHERE id = $7
    `;
    
    for (const columnUpdates of updatesByColumn.values()) {
      for (const update of columnUpdates) {
        const columnChanged = String(update.previousColumnId || '') !== String(update.columnId || '');
        if (columnChanged) {
          batchQueries.push({
            query: crossColumnQuery,
            params: [
              update.position,
              update.columnId,
              update.previousBoardId,
              update.previousColumnId,
              now,
              now,
              update.taskId
            ]
          });
        } else {
          batchQueries.push({
            query: sameColumnQuery,
            params: [
              update.position,
              update.columnId,
              update.previousBoardId,
              update.previousColumnId,
              now,
              update.taskId
            ]
          });
        }
      }
    }
    
    taskHttpLog(dbgHttp, `🚀 [batch-update-positions] Using batched transaction for ${batchQueries.length} updates `);
    const startTime = Date.now();
    
    // Execute all updates in a single batched transaction
    await db.executeBatchTransaction(batchQueries);
    
    const duration = Date.now() - startTime;
    taskHttpLog(dbgHttp, `✅ [batch-update-positions] Batched transaction completed in ${duration}ms for ${batchQueries.length} updates`);
    
    // Log each task update with ticket and position
    for (const columnUpdates of updatesByColumn.values()) {
      for (const update of columnUpdates) {
        const task = taskMap.get(update.taskId);
        const ticket = task?.ticket || 'N/A';
        taskHttpLog(dbgHttp, `[${timestamp}] ✅ [batch-update-positions] ticket: ${ticket}, position: ${update.position}`);
      }
    }
    
    // NOTE: Frontend already sends renumbered positions (0, 1, 2, 3...)
    // No need to renumber again on backend - just apply the positions as received

    
    // Log activity for tasks that changed columns (batch these too if possible)
    const columnMoves = [];
    updatesByColumn.forEach((columnUpdates, columnId) => {
      columnUpdates.forEach(update => {
        if (String(update.previousColumnId || '') !== String(update.columnId || '')) {
          columnMoves.push(update);
        }
      });
    });
    
    // Batch fetch column info for activity logging
    if (columnMoves.length > 0) {
      const activityStartTime = Date.now();
      // Moves use camelCase columnId (not columnid) — undefined IDs made toColumn resolve as "Unknown"
      const columnIds = [...new Set(
        columnMoves
          .flatMap(m => [m.columnId, m.previousColumnId])
          .filter(Boolean)
      )];
      // MIGRATED: Use sqlManager to get columns (getColumnWithStatus now includes id)
      const columns = await Promise.all(columnIds.map(columnId => helpers.getColumnWithStatus(db, columnId)));
      const columnMap = new Map(columns.filter(c => c).map(c => [c.id, c]));
      taskHttpLog(dbgHttp, `⏱️  [batch-update-positions] Column fetch took ${Date.now() - activityStartTime}ms`);
      
      // Log activities (fire-and-forget).
      // 2+ column moves → skip per-task emails and send one digest; single move uses normal email.
      const useBulkDigest = columnMoves.length >= 2;
      const movesForEmail = [];
      columnMoves.forEach((move) => {
        const oldColumn = columnMap.get(move.previousColumnId);
        const newColumn = columnMap.get(move.columnId);
        const currentTask = taskMap.get(move.taskId);
        const taskTicket = currentTask?.ticket || '';
        const taskRef = taskTicket ? ` (${taskTicket})` : '';
        
        // Create bilingual message for column move (same pattern as regular update route)
        const movedTaskText = JSON.stringify({
          en: t('activity.movedTaskFromTo', {
            taskTitle: move.title,
            taskRef,
            fromColumn: oldColumn?.title || t('activity.unknownColumn', {}, 'en'),
            toColumn: newColumn?.title || t('activity.unknownColumn', {}, 'en')
          }, 'en'),
          fr: t('activity.movedTaskFromTo', {
            taskTitle: move.title,
            taskRef,
            fromColumn: oldColumn?.title || t('activity.unknownColumn', {}, 'fr'),
            toColumn: newColumn?.title || t('activity.unknownColumn', {}, 'fr')
          }, 'fr')
        });
        
        const fromColumnName = oldColumn?.title || t('activity.unknownColumn', {}, 'en');
        const toColumnName = newColumn?.title || t('activity.unknownColumn', {}, 'en');
        logTaskActivity(
          userId,
          TASK_ACTIONS.UPDATE,
          move.taskId,
          movedTaskText,
          {
            columnId: move.columnId,
            boardId: move.previousBoardId,
            tenantId: getTenantId(req),
            authType: req.user?.authType,
            db: db,
            skipEmail: useBulkDigest,
            changedField: 'columnId',
            oldValue: fromColumnName,
            newValue: toColumnName,
            emailChange: {
              items: [
                {
                  field: 'columnId',
                  oldValue: fromColumnName,
                  newValue: toColumnName,
                  oldName: fromColumnName,
                  newName: toColumnName,
                },
              ],
            },
          }
        ).catch(error => {
          console.error('Background activity logging failed:', error);
        });
        
        // Log to reporting system (also fire-and-forget)
        const eventType = newColumn?.isFinished ? 'task_completed' : 'task_moved';
        logReportingActivity(db, eventType, userId, move.taskId, {
          fromColumnId: move.previousColumnId,
          fromColumnName: oldColumn?.title,
          toColumnId: move.columnId,
          toColumnName: newColumn?.title
        }).catch(error => {
          console.error('Background reporting activity logging failed:', error);
        });

        if (useBulkDigest) {
          movesForEmail.push({
            taskId: move.taskId,
            title: move.title,
            ticket: taskTicket || null,
            boardId: move.previousBoardId || currentTask?.boardId || currentTask?.boardid,
            fromColumnName: oldColumn?.title || t('activity.unknownColumn', {}, 'en'),
            toColumnName: newColumn?.title || t('activity.unknownColumn', {}, 'en'),
          });
        }
      });

      if (movesForEmail.length >= 2) {
        notifyBulkColumnMove(
          db,
          { userId, moves: movesForEmail },
          getTenantId(req)
        ).catch((err) => {
          console.error('Failed to send bulk column-move email:', err);
        });
      }
      // Note: Activity logging is now fire-and-forget, so timing measurement removed
    }
    
    // Publish WebSocket updates for all changed tasks (optimized: send only position/columnId changes)
    // Build minimal payloads with only changed fields (80-95% payload reduction)
    const wsStartTime = Date.now();
    const tenantId = getTenantId(req);
    
    // Build minimal payloads for each task (only position and columnid changes)
    // Include essential fields for frontend display (title, boardId, memberId, ticket)
    const publishPromises = uniqueUpdates.map(update => {
      const currentTask = taskMap.get(update.taskId);
      if (!currentTask) return Promise.resolve();
      
      // Get target columnid (from update or keep current)
      // getTasksByIdsBasic now returns camelCase, but keep fallback for safety
      const currentBoardId = currentTask.boardId || currentTask.boardid;
      const currentColumnId = currentTask.columnId || currentTask.columnid;
      const targetColumnId = update.columnId || currentColumnId;
      const columnChanged = targetColumnId !== currentColumnId;
      
      // Build minimal task payload with essential fields for frontend display
      // Frontend needs these fields when task doesn't exist in target column yet
      const minimalTask = {
        id: update.taskId,
        title: currentTask.title, // Required for display
        boardId: currentBoardId, // Required for routing
        columnId: targetColumnId,
        position: update.position,
        memberId: currentTask.memberId || currentTask.memberid || null, // For assignee display
        ticket: currentTask.ticket || null, // For task reference display
        updatedBy: userId
      };
      
      // Cross-column moves: include card display fields so peer sessions don't blank
      // description/priority/effort when local merge can't find the source task.
      // Same-column renumbers stay tiny (peers merge onto existing local cards).
      if (columnChanged && currentColumnId !== targetColumnId) {
        minimalTask.previousColumnId = currentColumnId;
        minimalTask.columnEnteredAt = now;
        minimalTask.description = currentTask.description ?? '';
        minimalTask.effort = currentTask.effort ?? 0;
        minimalTask.priority = currentTask.priority ?? null;
        minimalTask.priorityId = currentTask.priorityId ?? null;
        minimalTask.requesterId = currentTask.requesterId || currentTask.requesterid || null;
        minimalTask.startDate = currentTask.startDate ?? null;
        minimalTask.dueDate = currentTask.dueDate ?? null;
        if (currentTask.sprintId !== undefined) {
          minimalTask.sprintId = currentTask.sprintId;
        }
      }
      
      // Use current task's boardId (batch position updates don't change board)
      const targetBoardId = currentBoardId;
      
      return notificationService.publish('task-updated', {
        boardId: targetBoardId,
        task: minimalTask,
        timestamp: now
      }, tenantId).catch(error => {
        console.error('❌ Background WebSocket publish failed:', error);
      });
    });
    
    const wsTime = Date.now() - wsStartTime;
    const totalPayloadSize = uniqueUpdates.length * 200; // Estimate ~200 bytes per minimal task
    taskHttpLog(dbgHttp, `⏱️  [batch-update-positions] WebSocket payload preparation took ${wsTime}ms (estimated ${totalPayloadSize} bytes total, ${uniqueUpdates.length} tasks)`);
    
    // Start publishing in background (fire-and-forget)
    Promise.all(publishPromises).then(() => {
      // Optional: log success in background
    }).catch(error => {
      console.error('❌ Background WebSocket publish batch failed:', error);
    });
    
    const totalTime = Date.now() - endpointStartTime;
    taskHttpLog(dbgHttp, `⏱️  [batch-update-positions] Total endpoint time: ${totalTime}ms for ${uniqueUpdates.length} updates (WebSocket publishing in background)`);
    
    res.json({ message: `Updated ${uniqueUpdates.length} task positions successfully` });
  } catch (error) {
    console.error('Error batch updating task positions:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToUpdateTask') });
  }
});

// Reorder tasks
router.post('/reorder', authenticateToken, async (req, res) => {
  const parsed = parseBody(reorderTaskBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { taskId, newPosition, columnId } = parsed.data;
  const userId = req.user?.id || 'system';
  
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    // MIGRATED: Get current task using sqlManager
    const currentTask = await taskQueries.getTaskById(db, taskId);

    if (!currentTask) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }

    // Ensure positions are numbers for comparison
    const currentPosition = typeof currentTask.position === 'number' 
      ? currentTask.position 
      : parseFloat(currentTask.position) || 0;
    const newPos = typeof newPosition === 'number' 
      ? newPosition 
      : parseFloat(newPosition) || 0;
    const previousColumnId = currentTask.columnId;
    const previousBoardId = currentTask.boardId;

    
    // Collect queries and send as a batched transaction
    const batchQueries = [];
    const now = new Date().toISOString();
    
    if (newPos > currentPosition) {
      // Moving down: shift tasks between current and new position down by 1
      // Tasks with position > currentPosition and <= newPosition need to shift up (position - 1)
      batchQueries.push({
        query: `
          UPDATE tasks SET position = position - 1 
          WHERE columnid = ? AND position > ? AND position <= ?
        `,
        params: [columnId, currentPosition, newPos]
      });
    } else if (newPos < currentPosition) {
      // Moving up: shift tasks between new and current position up by 1
      // Tasks with position >= newPosition and < currentPosition need to shift down (position + 1)
      batchQueries.push({
        query: `
          UPDATE tasks SET position = position + 1 
          WHERE columnid = ? AND position >= ? AND position < ?
        `,
        params: [columnId, newPos, currentPosition]
      });
    }
    // If newPos === currentPosition, no shift needed

    // Update the moved task to its new position and track previous location
    // Only update if position actually changed
    if (newPos !== currentPosition) {
      batchQueries.push({
        query: `
          UPDATE tasks SET 
            position = ?, 
            columnid = ?,
            pre_boardid = ?, 
            pre_columnid = ?,
            updated_at = ?
          WHERE id = ?
        `,
        params: [newPos, columnId, previousBoardId, previousColumnId, now, taskId]
      });
    }
    
    // Execute all updates in a single batched transaction
    await db.executeBatchTransaction(batchQueries);


    // Log reorder activity (fire-and-forget: Don't await to avoid blocking API response)
    // Create bilingual message for reorder
    const reorderDetails = JSON.stringify({
      en: t('activity.reorderedTask', { 
        taskTitle: currentTask.title, 
        fromPosition: currentPosition, 
        toPosition: newPos 
      }, 'en'),
      fr: t('activity.reorderedTask', { 
        taskTitle: currentTask.title, 
        fromPosition: currentPosition, 
        toPosition: newPos 
      }, 'fr')
    });
    logTaskActivity(
      userId,
      TASK_ACTIONS.UPDATE, // Reorder is a type of update
      taskId,
      reorderDetails,
      {
        columnId: columnId,
        boardId: currentTask.boardId,
        tenantId: getTenantId(req),
        authType: req.user?.authType,
        db: db,
        // Position-only reorder is noisy for participants — keep feed, skip email
        skipEmail: true,
      }
    ).catch(error => {
      console.error('Background activity logging failed:', error);
    });
    
    // Log to reporting system - check if column changed
    if (previousColumnId !== columnId) {
      // This is a column move
      // MIGRATED: Use sqlManager instead of inline SQL
      const newColumn = await helpers.getColumnWithStatus(db, columnId);
      const oldColumn = await helpers.getColumnById(db, previousColumnId);
      
      const eventType = newColumn?.isFinished ? 'task_completed' : 'task_moved';
      // Fire-and-forget: Don't await to avoid blocking API response
      logReportingActivity(db, eventType, userId, taskId, {
        fromColumnId: previousColumnId,
        fromColumnName: oldColumn?.title,
        toColumnId: columnId,
        toColumnName: newColumn?.title
      }).catch(error => {
        console.error('Background reporting activity logging failed:', error);
      });
    }

    // Publish to Redis for real-time updates (optimized: send only position change)
    // Include essential fields for frontend display (title, boardId, memberId, ticket)
    const minimalTask = {
      id: taskId,
      title: currentTask.title, // Required for display
      boardId: currentTask.boardId, // Required for routing
      columnId: columnId,
      position: newPos,
      memberId: currentTask.memberId || null, // For assignee display
      ticket: currentTask.ticket || null, // For task reference display
      updatedBy: userId
    };
    
    // Include previous columnId if column changed (helps frontend with cleanup)
    if (previousColumnId !== columnId) {
      minimalTask.previousColumnId = previousColumnId;
    }
    
    await notificationService.publish('task-updated', {
      boardId: currentTask.boardId,
      task: minimalTask,
      timestamp: new Date().toISOString()
    }, getTenantId(req));
    
    // Still fetch full task for API response (frontend that made the request needs full data)
    const taskResponse = await fetchTaskWithRelationships(db, taskId);

    res.json({ message: 'Task reordered successfully' });
  } catch (error) {
    console.error('Error reordering task:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToReorderTask') });
  }
});

// Move task to different board
router.post('/move-to-board', authenticateToken, async (req, res) => {
  const parsed = parseBody(moveTaskToBoardBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error || 'taskid and targetBoardId are required' });
  }
  const { taskId, targetBoardId, targetColumnId: requestedColumnId, position: requestedPosition } = parsed.data;
  const userId = req.user?.id || 'system';
  
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    taskHttpLog(dbgHttp, '🔄 Cross-board move endpoint hit:', { taskId, targetBoardId });
    const tTranslator = await getTranslator(db);
    
    // Get the task to move
    const task = await taskQueries.getTaskById(db, taskId);
    
    if (!task) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    // MIGRATED: Get source column title for intelligent placement
    const sourceColumn = await helpers.getColumnById(db, task.columnid || task.columnId);
    
    let targetColumn = null;
    let columnMatched = false;
    let restorePosition = 0;

    if (requestedColumnId) {
      const requested = await helpers.getColumnById(db, requestedColumnId);
      const requestedBoardId =
        requested?.boardId || requested?.boardid || requested?.board_id;
      if (requested && String(requestedBoardId) === String(targetBoardId)) {
        targetColumn = requested;
        columnMatched = true;
        if (typeof requestedPosition === 'number' && Number.isFinite(requestedPosition)) {
          restorePosition = Math.max(0, Math.floor(requestedPosition));
        }
      }
    }
    
    // Try to find a column with the same title in the target board
    if (!targetColumn && sourceColumn) {
      targetColumn = await helpers.getColumnByTitleInBoard(db, targetBoardId, sourceColumn.title);
      
      if (targetColumn) {
        columnMatched = true;
        taskHttpLog(dbgHttp, `🎯 Smart placement: Found matching column "${sourceColumn.title}" in target board`);
      }
    }
    
    // Fallback to first column if no matching column found
    if (!targetColumn) {
      targetColumn = await helpers.getFirstColumnInBoard(db, targetBoardId);
    }
    
    if (!targetColumn) {
      return res.status(404).json({ error: tTranslator('errors.targetBoardHasNoColumns') });
    }
    
    // Store original location for tracking
    const originalBoardId = task.boardId || task.boardid;
    const originalColumnId = task.columnId || task.columnid;
    
    // Start transaction for atomic operation
    
    // Collect queries and send as a batched transaction
    const batchQueries = [];
    const now = new Date().toISOString();

    // Cross-board move: relationships are board-scoped in UI; strip all links involving this task
    batchQueries.push({
      query: 'DELETE FROM task_rels WHERE task_id = ? OR to_task_id = ?',
      params: [taskId, taskId]
    });
    
    // Shift existing tasks in target column to make room at the restore slot
    batchQueries.push({
      query: 'UPDATE tasks SET position = position + 1 WHERE columnid = ? AND position >= ?',
      params: [targetColumn.id, restorePosition]
    });
    
    // Update the existing task to move it to the new location
    batchQueries.push({
      query: `
        UPDATE tasks SET 
          columnid = ?, 
          boardid = ?, 
          position = ?,
          pre_boardid = ?, 
          pre_columnid = ?,
          column_entered_at = ?,
          updated_at = ?
        WHERE id = ?
      `,
      params: [targetColumn.id, targetBoardId, restorePosition, originalBoardId, originalColumnId, now, now, taskId]
    });
    
    // Execute all updates in a single batched transaction
    await db.executeBatchTransaction(batchQueries);

    
    // MIGRATED: Log move activity using sqlManager
    const originalBoard = await boardQueries.getBoardById(db, originalBoardId);
    const targetBoard = await boardQueries.getBoardById(db, targetBoardId);
    // Create bilingual message for board move
    const moveDetails = JSON.stringify({
      en: t('activity.movedTaskBoard', {
        taskTitle: task.title,
        fromBoard: originalBoard?.title || t('activity.unknownBoard', {}, 'en'),
        toBoard: targetBoard?.title || t('activity.unknownBoard', {}, 'en')
      }, 'en'),
      fr: t('activity.movedTaskBoard', {
        taskTitle: task.title,
        fromBoard: originalBoard?.title || t('activity.unknownBoard', {}, 'fr'),
        toBoard: targetBoard?.title || t('activity.unknownBoard', {}, 'fr')
      }, 'fr')
    });
    
    // Fire-and-forget: Don't await activity logging to avoid blocking API response
    const skipEmail = parsed.data.skipEmail === true;
    logTaskActivity(
      userId,
      TASK_ACTIONS.MOVE,
      taskId,
      moveDetails,
      {
        columnId: targetColumn.id,
        boardId: targetBoardId,
        tenantId: getTenantId(req),
        authType: req.user?.authType,
        db: db,
        skipEmail,
      }
    ).catch(error => {
      console.error('Background activity logging failed:', error);
    });
    
    // Log to reporting system
    // MIGRATED: Use sqlManager
    const newColumn = await helpers.getColumnWithStatus(db, targetColumn.id);
    const oldColumn = await helpers.getColumnById(db, originalColumnId);
    
    const eventType = newColumn?.isFinished ? 'task_completed' : 'task_moved';
    // Fire-and-forget: Don't await to avoid blocking API response
    logReportingActivity(db, eventType, userId, taskId, {
      fromColumnId: originalColumnId,
      fromColumnName: oldColumn?.title,
      toColumnId: targetColumn.id,
      toColumnName: newColumn?.title
    }).catch(error => {
      console.error('Background reporting activity logging failed:', error);
    });
    
    // Get the updated task data with all relationships for WebSocket
    const taskResponse = await fetchTaskWithRelationships(db, taskId);
    
    // Publish to Redis for real-time updates (both boards need to be notified)
    // Includes complete task data with relationships
    const tenantId = getTenantId(req);
    await notificationService.publish('task-updated', {
      boardId: originalBoardId,
      task: {
        ...taskResponse,
        updatedBy: userId
      },
      timestamp: new Date().toISOString()
    }, tenantId);
    
    await notificationService.publish('task-updated', {
      boardId: targetBoardId,
      task: {
        ...taskResponse,
        updatedBy: userId
      },
      timestamp: new Date().toISOString()
    }, tenantId);
    
    res.json({ 
      success: true, 
      newTaskId: taskId, // Return original taskId since we're not changing it
      targetColumnId: targetColumn.id,
      targetColumnTitle: targetColumn.title || '',
      columnMatched,
      position: restorePosition,
      targetBoardId,
      message: 'Task moved successfully' 
    });
    
  } catch (error) {
    console.error('Error moving task to board:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToMoveTaskToBoard') });
  }
});

// MIGRATED: Get tasks by board
router.get('/by-board/:boardId', authenticateToken, async (req, res) => {
  const { boardId } = req.params;
  try {
    const db = getRequestDatabase(req);
    const tasks = await taskQueries.getTasksByBoard(db, boardId);
    res.json(tasks);
  } catch (error) {
    console.error('Error getting tasks by board:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToGetTasks') });
  }
});

// Add watcher to task
router.post('/:taskId/watchers/:memberId', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { taskId, memberId } = req.params;
    const userId = req.user?.id || 'system';
    const skipEmail =
      req.query.skipEmail === 'true' ||
      req.query.skipEmail === '1' ||
      req.body?.skipEmail === true;
    
    const tTranslator = await getTranslator(db);
    if (!userCanMutate(req.user)) {
      const ownMember = await memberQueries.getMemberByUserId(db, userId);
      if (!ownMember || ownMember.id !== memberId) {
        return res.status(403).json({ error: tTranslator('errors.readOnly'), code: 'READ_ONLY' });
      }
    }
    // MIGRATED: Get task's board ID for Redis publishing
    const boardId = await taskQueries.getTaskBoardId(db, taskId);
    if (!boardId) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    // MIGRATED: Add watcher using sqlManager
    await helpers.addWatcher(db, taskId, memberId);

    if (!skipEmail) {
      notifyWatcherAdded(
        db,
        { actorUserId: userId, taskId, memberId },
        getTenantId(req)
      ).catch((err) => {
        console.error('Failed to send watcher-added email:', err);
      });
    }
    
    // Log to reporting system (fire-and-forget: Don't await to avoid blocking API response)
    logReportingActivity(db, 'watcher_added', userId, taskId).catch(error => {
      console.error('Background reporting activity logging failed:', error);
    });
    
    // Publish to Redis for real-time updates
    await notificationService.publish('task-watcher-added', {
      boardId: boardId,
      taskId: taskId,
      memberId: memberId,
      timestamp: new Date().toISOString()
    }, getTenantId(req));

    const watchers = await helpers.getWatchersForTask(db, taskId);
    await publishTaskRelationshipUpdate(db, req, {
      boardId,
      taskId,
      userId,
      watchers,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding watcher:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToAddWatcher') });
  }
});

// Remove watcher from task
router.delete('/:taskId/watchers/:memberId', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const { taskId, memberId } = req.params;
    const userId = req.user?.id || 'system';
    if (!userCanMutate(req.user)) {
      const ownMember = await memberQueries.getMemberByUserId(db, userId);
      if (!ownMember || ownMember.id !== memberId) {
        return res.status(403).json({ error: tTranslator('errors.readOnly'), code: 'READ_ONLY' });
      }
    }
    
    // MIGRATED: Get task's board ID for Redis publishing
    const boardId = await taskQueries.getTaskBoardId(db, taskId);
    if (!boardId) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    // MIGRATED: Remove watcher using sqlManager
    await helpers.removeWatcher(db, taskId, memberId);
    
    // Publish to Redis for real-time updates
    await notificationService.publish('task-watcher-removed', {
      boardId: boardId,
      taskId: taskId,
      memberId: memberId,
      timestamp: new Date().toISOString()
    }, getTenantId(req));

    const watchers = await helpers.getWatchersForTask(db, taskId);
    await publishTaskRelationshipUpdate(db, req, {
      boardId,
      taskId,
      userId: req.user?.id || 'system',
      watchers,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing watcher:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToRemoveWatcher') });
  }
});

// Add collaborator to task
router.post('/:taskId/collaborators/:memberId', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const { taskId, memberId } = req.params;
    const userId = req.user?.id || 'system';
    const skipEmail =
      req.query.skipEmail === 'true' ||
      req.query.skipEmail === '1' ||
      req.body?.skipEmail === true;
    
    // MIGRATED: Get task's board ID for Redis publishing
    const boardId = await taskQueries.getTaskBoardId(db, taskId);
    if (!boardId) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    // MIGRATED: Add collaborator using sqlManager
    await helpers.addCollaborator(db, taskId, memberId);

    if (!skipEmail) {
      notifyCollaboratorAdded(
        db,
        { actorUserId: userId, taskId, memberId },
        getTenantId(req)
      ).catch((err) => {
        console.error('Failed to send collaborator-added email:', err);
      });
    }
    
    // Log to reporting system (fire-and-forget: Don't await to avoid blocking API response)
    logReportingActivity(db, 'collaborator_added', userId, taskId).catch(error => {
      console.error('Background reporting activity logging failed:', error);
    });
    
    // Publish to Redis for real-time updates
    await notificationService.publish('task-collaborator-added', {
      boardId: boardId,
      taskId: taskId,
      memberId: memberId,
      timestamp: new Date().toISOString()
    }, getTenantId(req));

    const collaborators = await helpers.getCollaboratorsForTask(db, taskId);
    await publishTaskRelationshipUpdate(db, req, {
      boardId,
      taskId,
      userId,
      collaborators,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding collaborator:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToAddCollaborator') });
  }
});

// Remove collaborator from task
router.delete('/:taskId/collaborators/:memberId', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const { taskId, memberId } = req.params;
    
    // MIGRATED: Get task's board ID for Redis publishing
    const boardId = await taskQueries.getTaskBoardId(db, taskId);
    if (!boardId) {
      return res.status(404).json({ error: tTranslator('errors.taskNotFound') });
    }
    
    // MIGRATED: Remove collaborator using sqlManager
    await helpers.removeCollaborator(db, taskId, memberId);
    
    // Publish to Redis for real-time updates
    await notificationService.publish('task-collaborator-removed', {
      boardId: boardId,
      taskId: taskId,
      memberId: memberId,
      timestamp: new Date().toISOString()
    }, getTenantId(req));

    const collaborators = await helpers.getCollaboratorsForTask(db, taskId);
    await publishTaskRelationshipUpdate(db, req, {
      boardId,
      taskId,
      userId: req.user?.id || 'system',
      collaborators,
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing collaborator:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToRemoveCollaborator') });
  }
});

// Task Relationships endpoints

// Get all relationships for a task
router.get('/:taskId/relationships', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { taskId } = req.params;
    
    // MIGRATED: Get all relationships where this task is involved
    const relationships = await taskQueries.getTaskRelationships(db, taskId);
    
    res.json(relationships);
  } catch (error) {
    console.error('Error fetching task relationships:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToFetchTaskRelationships') });
  }
});

// Create a task relationship
router.post('/:taskId/relationships', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const tTranslator = await getTranslator(db);
    const { taskId } = req.params;
    const parsed = parseBody(createTaskRelationshipBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { relationship, toTaskId } = parsed.data;
    
    // Prevent self-relationships
    if (taskId === toTaskId) {
      return res.status(400).json({ error: tTranslator('errors.cannotCreateRelationshipWithSelf') });
    }
    
    // MIGRATED: Verify both tasks exist
    const taskExistsResult = await taskQueries.taskExists(db, taskId);
    const toTaskExistsResult = await taskQueries.taskExists(db, toTaskId);
    
    if (!taskExistsResult || !toTaskExistsResult) {
      return res.status(404).json({ error: tTranslator('errors.oneOrBothTasksNotFound') });
    }
    
    // MIGRATED: Check if relationship already exists
    const existingRelationship = await taskQueries.getTaskRelationship(db, taskId, relationship, toTaskId);
    
    if (existingRelationship) {
      const conflict = relationshipConflictResponse(tTranslator, 'RELATIONSHIP_ALREADY_EXISTS');
      return res.status(conflict.status).json(conflict.body);
    }

    const existingBetween = await taskQueries.getRelationshipsBetweenTasks(db, taskId, toTaskId);
    if (existingBetween.length > 0) {
      const code = classifyRelationshipConflict(existingBetween, relationship);
      const conflict = relationshipConflictResponse(tTranslator, code);
      return res.status(conflict.status).json(conflict.body);
    }
    
    // Check for circular relationships (prevent cycles in parent/child hierarchies)
    if (relationship === 'parent' || relationship === 'child') {
      const wouldCreateCycle = await checkForCycles(db, taskId, toTaskId, relationship);
      if (wouldCreateCycle.hasCycle) {
        return res.status(409).json({ 
          error: `Cannot create relationship: This would create a circular dependency. ${wouldCreateCycle.reason}` 
        });
      }
    }
    
    // MIGRATED: Use a transaction to ensure atomicity
    let insertResult;
    await dbTransaction(db, async () => {
      // MIGRATED: Insert the relationship using sqlManager
      insertResult = await taskQueries.createTaskRelationship(db, taskId, relationship, toTaskId);
      
      // For parent/child relationships, also create the inverse relationship
      // Check if inverse already exists to avoid UNIQUE constraint violations
      if (relationship === 'parent') {
        const inverseExists = await taskQueries.getTaskRelationship(db, toTaskId, 'child', taskId);
        
        if (!inverseExists) {
          await taskQueries.createTaskRelationship(db, toTaskId, 'child', taskId);
        }
      } else if (relationship === 'child') {
        const inverseExists = await taskQueries.getTaskRelationship(db, toTaskId, 'parent', taskId);
        
        if (!inverseExists) {
          await taskQueries.createTaskRelationship(db, toTaskId, 'parent', taskId);
        }
      } else if (relationship === 'related') {
        const inverseExists = await taskQueries.getTaskRelationship(db, toTaskId, 'related', taskId);

        if (!inverseExists) {
          await taskQueries.createTaskRelationship(db, toTaskId, 'related', taskId);
        }
      }
    });
    
    taskHttpLog(dbgHttp, `✅ Created relationship: ${taskId} (${relationship}) → ${toTaskId}`);
    
    // Verify the insertion was successful
    if (!insertResult || insertResult.changes === 0) {
      return res.status(500).json({ error: tTranslator('errors.failedToCreateRelationship') });
    }
    
    // MIGRATED: Get the board ID for the source task to publish the update
    const sourceBoardId = await taskQueries.getTaskBoardId(db, taskId);
    const targetBoardId = await taskQueries.getTaskBoardId(db, toTaskId);
    
    // Publish to Redis for real-time updates (both boards need to be notified)
    const tenantId = getTenantId(req);
    if (sourceBoardId) {
      await notificationService.publish('task-relationship-created', {
        boardId: sourceBoardId,
        taskId: taskId,
        relationship: relationship,
        toTaskId: toTaskId,
        timestamp: new Date().toISOString()
      }, tenantId);
    }
    
    if (targetBoardId && targetBoardId !== sourceBoardId) {
      await notificationService.publish('task-relationship-created', {
        boardId: targetBoardId,
        taskId: taskId,
        relationship: relationship,
        toTaskId: toTaskId,
        timestamp: new Date().toISOString()
      }, tenantId);
    }
    
    res.json({ success: true, message: 'Task relationship created successfully' });
  } catch (error) {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    if (
      error.code === '23505' ||
      error.message?.includes('duplicate key') ||
      error.message?.includes('UNIQUE constraint')
    ) {
      return res.status(409).json({
        code: 'RELATIONSHIP_ALREADY_EXISTS',
        error: tTranslator('errors.relationshipAlreadyExists'),
      });
    }
    console.error('Error creating task relationship:', error);
    res.status(500).json({ error: tTranslator('errors.failedToCreateTaskRelationship') });
  }
});

// Delete a task relationship
router.delete('/:taskId/relationships/:relationshipId', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const { taskId, relationshipId } = req.params;
    
    // MIGRATED: Get the relationship details before deleting
    // MIGRATED: Get relationship by ID using sqlManager
    const relationship = await taskQueries.getTaskRelationshipById(db, relationshipId, taskId);
    
    if (!relationship) {
      return res.status(404).json({ error: tTranslator('errors.relationshipNotFound') });
    }
    
    // MIGRATED: Delete the main relationship
    await taskQueries.deleteTaskRelationship(db, relationshipId);
    
    // For parent/child relationships, also delete the inverse relationship
    if (relationship.relationship === 'parent') {
      const inverseRel = await taskQueries.getTaskRelationship(db, relationship.to_task_id, 'child', relationship.task_id);
      if (inverseRel) {
        await taskQueries.deleteTaskRelationship(db, inverseRel.id);
      }
    } else if (relationship.relationship === 'child') {
      const inverseRel = await taskQueries.getTaskRelationship(db, relationship.to_task_id, 'parent', relationship.task_id);
      if (inverseRel) {
        await taskQueries.deleteTaskRelationship(db, inverseRel.id);
      }
    } else if (relationship.relationship === 'related') {
      const inverseRel = await taskQueries.getTaskRelationship(db, relationship.to_task_id, 'related', relationship.task_id);
      if (inverseRel) {
        await taskQueries.deleteTaskRelationship(db, inverseRel.id);
      }
    }
    
    // MIGRATED: Get the board ID for the source task to publish the update
    const sourceBoardId = await taskQueries.getTaskBoardId(db, taskId);
    const targetBoardId = await taskQueries.getTaskBoardId(db, relationship.to_task_id);
    
    // Publish to Redis for real-time updates (both boards need to be notified)
    const tenantId = getTenantId(req);
    if (sourceBoardId) {
      await notificationService.publish('task-relationship-deleted', {
        boardId: sourceBoardId,
        taskId: taskId,
        relationship: relationship.relationship,
        toTaskId: relationship.to_task_id,
        timestamp: new Date().toISOString()
      }, tenantId);
    }
    
    if (targetBoardId && targetBoardId !== sourceBoardId) {
      await notificationService.publish('task-relationship-deleted', {
        boardId: targetBoardId,
        taskId: taskId,
        relationship: relationship.relationship,
        toTaskId: relationship.to_task_id,
        timestamp: new Date().toISOString()
      }, tenantId);
    }
    
    res.json({ success: true, message: 'Task relationship deleted successfully' });
  } catch (error) {
    console.error('Error deleting task relationship:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToDeleteTaskRelationship') });
  }
});

// Get tasks available for creating relationships (excludes current task and already related tasks)
router.get('/:taskId/available-for-relationship', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    const { taskId } = req.params;
    
    // MIGRATED: Get all tasks except the current one and already related ones
    const availableTasks = await taskQueries.getAvailableTasksForRelationship(db, taskId);
    
    res.json(availableTasks);
  } catch (error) {
    console.error('Error fetching available tasks for relationship:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToFetchAvailableTasks') });
  }
});

// Get complete task flow chart data (optimized for visualization)
router.get('/:taskId/flow-chart', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    const tTranslator = await getTranslator(db);
    
    taskHttpLog(dbgHttp, `🌳 FlowChart API: Building flow chart for task: ${taskId}`);
    
    // Step 1: Get all connected tasks using a simpler approach
    // First, collect all task IDs that are connected through relationships
    const connectedTaskIds = new Set([taskId]);
    const processedIds = new Set();
    const toProcess = [taskId];
    
    // Iteratively find all connected tasks (avoiding recursion issues)
    while (toProcess.length > 0 && connectedTaskIds.size < 50) { // Limit to prevent infinite loops
      const currentId = toProcess.shift();
      if (processedIds.has(currentId)) continue;
      
      processedIds.add(currentId);
      
      // MIGRATED: Find all tasks connected to current task
      const connectedIds = await taskQueries.getConnectedTaskIds(db, currentId);
      
      connectedIds.forEach(connectedId => {
        if (!connectedTaskIds.has(connectedId)) {
          connectedTaskIds.add(connectedId);
          toProcess.push(connectedId);
        }
      });
    }
    
    taskHttpLog(dbgHttp, `🔍 FlowChart API: Found ${connectedTaskIds.size} connected tasks`);
    
    // MIGRATED: Step 2: Get full task data for all connected tasks
    if (connectedTaskIds.size > 0) {
      const taskIdsArray = Array.from(connectedTaskIds);
      const tasks = await taskQueries.getTasksForFlowChart(db, taskIdsArray);
      
      // MIGRATED: Step 3: Get all relationships between these tasks
      const relationships = await taskQueries.getRelationshipsForFlowChart(db, taskIdsArray);
      
      taskHttpLog(dbgHttp, `✅ FlowChart API: Found ${tasks.length} tasks and ${relationships.length} relationships`);

      const jsonSafeId = (v) => (typeof v === 'bigint' ? v.toString() : v);
      
      // Step 4: Build the response (normalize row keys: PG may return lowercase without quoted aliases)
      const response = {
        rootTaskId: taskId,
        tasks: tasks.map(task => ({
          id: task.id,
          ticket: task.ticket,
          title: task.title,
          description: task.description ?? '',
          memberId: task.memberId ?? task.memberid,
          memberName: task.memberName ?? task.membername ?? 'Unknown',
          memberColor: task.memberColor ?? task.membercolor ?? '#6366F1',
          status: task.status ?? 'Unknown',
          priority: task.priorityName ?? task.priority_name ?? task.priority ?? 'medium',
          startDate: task.startDate ?? task.startdate,
          dueDate: task.dueDate ?? task.duedate,
          projectId: task.projectId ?? task.projectid
        })),
        relationships: relationships.map(rel => ({
          id: jsonSafeId(rel.id),
          taskId: rel.taskId ?? rel.task_id,
          relationship: rel.relationship,
          relatedTaskId: rel.relatedTaskId ?? rel.to_task_id,
          taskTicket: rel.taskTicket ?? rel.task_ticket,
          relatedTaskTicket: rel.relatedTaskTicket ?? rel.related_task_ticket
        }))
      };
      
      res.json(response);
    } else {
      // No connected tasks, return just the root task (lowercase cols + quoted aliases for PG/SQLite)
      const rootTaskQuery = `
        SELECT 
          t.id as "id",
          t.ticket as "ticket",
          t.title as "title",
          t.description as "description",
          t.memberid as "memberId",
          mem.name as "memberName",
          mem.color as "memberColor",
          c.title as "status",
          t.priority as "priority",
          t.priority_id as "priority_id",
          p.priority as "priorityName",
          t.startdate as "startDate",
          t.duedate as "dueDate",
          b.project as "projectId"
        FROM tasks t
        LEFT JOIN members mem ON t.memberid = mem.id
        LEFT JOIN columns c ON t.columnid = c.id
        LEFT JOIN boards b ON t.boardid = b.id
        LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
        WHERE t.id = $1
      `;
      
      const rootTask = await wrapQuery(db.prepare(rootTaskQuery), 'SELECT').get(taskId);
      
      if (rootTask) {
        const response = {
          rootTaskId: taskId,
          tasks: [{
            id: rootTask.id,
            ticket: rootTask.ticket,
            title: rootTask.title,
            description: rootTask.description ?? '',
            memberId: rootTask.memberId ?? rootTask.memberid,
            memberName: rootTask.memberName ?? rootTask.membername ?? 'Unknown',
            memberColor: rootTask.memberColor ?? rootTask.membercolor ?? '#6366F1',
            status: rootTask.status ?? 'Unknown',
            priority: rootTask.priorityName ?? rootTask.priority_name ?? rootTask.priority ?? 'medium',
            startDate: rootTask.startDate ?? rootTask.startdate,
            dueDate: rootTask.dueDate ?? rootTask.duedate,
            projectId: rootTask.projectId ?? rootTask.projectid
          }],
          relationships: []
        };
        
        res.json(response);
      } else {
        res.status(404).json({ error: tTranslator('errors.taskNotFound') });
      }
    }
    
  } catch (error) {
    console.error('❌ FlowChart API: Error getting flow chart data:', error);
    const db = getRequestDatabase(req);
    const tTranslator = await getTranslator(db);
    res.status(500).json({ error: tTranslator('errors.failedToGetFlowChartData') });
  }
});


export default router;