/**
 * Task Query Manager
 * 
 * Centralized PostgreSQL-native queries for task operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, json_agg, etc.)
 * 
 * @module sqlManager/tasks
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get task by ID with all relationships (comments, watchers, collaborators, tags, attachments)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID (UUID)
 * @returns {Promise<Object|null>} Task object with relationships or null if not found
 */
export async function getTaskWithRelationships(db, taskId) {
  const query = `
    SELECT t.*, 
           p.id as "priorityId",
           p.priority as "priorityName",
           p.color as "priorityColor",
           CASE WHEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) > 0 
                THEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) 
                ELSE NULL END as "attachmentCount",
           COALESCE(json_agg(json_build_object(
               'id', c.id,
               'text', c.text,
               'authorId', c.authorid,
               'createdAt', c.createdat,
               'updated_at', c.updated_at,
               'taskId', c.taskid,
               'authorName', comment_author.name,
               'authorColor', comment_author.color
           )) FILTER (WHERE c.id IS NOT NULL), '[]'::json) as comments,
           COALESCE(json_agg(json_build_object(
               'id', tag.id,
               'tag', tag.tag,
               'description', tag.description,
               'color', tag.color
           )) FILTER (WHERE tag.id IS NOT NULL), '[]'::json) as tags,
           COALESCE(json_agg(json_build_object(
               'id', watcher.id,
               'name', watcher.name,
               'color', watcher.color,
               'user_id', watcher.user_id,
               'email', watcher_user.email,
               'avatarUrl', watcher_user.avatar_path,
               'googleAvatarUrl', watcher_user.google_avatar_url
           )) FILTER (WHERE watcher.id IS NOT NULL), '[]'::json) as watchers,
           COALESCE(json_agg(json_build_object(
               'id', collaborator.id,
               'name', collaborator.name,
               'color', collaborator.color,
               'user_id', collaborator.user_id,
               'email', collaborator_user.email,
               'avatarUrl', collaborator_user.avatar_path,
               'googleAvatarUrl', collaborator_user.google_avatar_url
           )) FILTER (WHERE collaborator.id IS NOT NULL), '[]'::json) as collaborators
    FROM tasks t
    LEFT JOIN attachments a ON a.taskid = t.id AND a.commentid IS NULL
    LEFT JOIN comments c ON c.taskid = t.id
    LEFT JOIN members comment_author ON comment_author.id = c.authorid
    LEFT JOIN task_tags tt ON tt.taskid = t.id
    LEFT JOIN tags tag ON tag.id = tt.tagid
    LEFT JOIN watchers w ON w.taskid = t.id
    LEFT JOIN members watcher ON watcher.id = w.memberid
    LEFT JOIN users watcher_user ON watcher_user.id = watcher.user_id
    LEFT JOIN collaborators col ON col.taskid = t.id
    LEFT JOIN members collaborator ON collaborator.id = col.memberid
    LEFT JOIN users collaborator_user ON collaborator_user.id = collaborator.user_id
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    WHERE t.id = $1
    GROUP BY t.id, p.id
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const task = await stmt.get(taskId);
  
  if (!task) return null;
  
  // Parse JSON fields (PostgreSQL returns JSON as objects/arrays, but handle both)
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
  
  // Deduplicate arrays by id
  const deduplicateById = (arr) => {
    const seen = new Set();
    return arr.filter(item => {
      if (!item || !item.id) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
  
  // Parse and deduplicate JSON fields
  task.comments = deduplicateById(parseJsonField(task.comments));
  task.tags = deduplicateById(parseJsonField(task.tags));
  task.watchers = deduplicateById(parseJsonField(task.watchers));
  task.collaborators = deduplicateById(parseJsonField(task.collaborators));
  
  task.sprintId = task.sprint_id ?? task.sprintId ?? null;
  return task;
}

/**
 * Get task by ticket number (e.g., "TASK-00032")
 * 
 * @param {Database} db - Database connection
 * @param {string} ticket - Task ticket number
 * @returns {Promise<Object|null>} Task object or null if not found
 */
export async function getTaskByTicket(db, ticket) {
  const query = `
    SELECT t.*, 
           p.id as "priorityId",
           p.priority as "priorityName",
           p.color as "priorityColor",
           c.title as status,
           CASE WHEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) > 0 
                THEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) 
                ELSE NULL END as "attachmentCount"
    FROM tasks t
    LEFT JOIN attachments a ON a.taskid = t.id
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    LEFT JOIN columns c ON c.id = t.columnid
    WHERE t.ticket = $1
    GROUP BY t.id, p.id, c.id
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(ticket);
}

/**
 * Get task by ID (simple, without relationships)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID (UUID)
 * @returns {Promise<Object|null>} Task object or null if not found
 */
export async function getTaskById(db, taskId) {
  const query = `
    SELECT * FROM tasks WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId);
}

/**
 * Get all tasks for a column with relationships
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @returns {Promise<Array>} Array of task objects with relationships
 */
export async function getTasksForColumn(db, columnId) {
  const query = `
    SELECT t.id, t.position, t.title, t.description, t.ticket, 
           t.memberid as "memberId", t.requesterid as "requesterId", 
           t.startdate as "startDate", t.duedate as "dueDate", 
           t.effort, t.priority, t.priority_id as "priority_id", 
           t.columnid as "columnId", t.boardid as "boardId", 
           t.sprint_id as "sprint_id", t.created_at, t.updated_at,
           t.column_entered_at as "columnEnteredAt",
           t.is_blocked as "isBlocked",
           t.blocked_reason as "blockedReason",
           p.id as "priorityId", p.priority as "priorityName", 
           p.color as "priorityColor",
           CASE WHEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) > 0 
                THEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) 
                ELSE NULL END as "attachmentCount",
           COALESCE(json_agg(json_build_object(
               'id', c.id,
               'text', c.text,
               'authorId', c.authorid,
               'createdAt', c.createdat
           )) FILTER (WHERE c.id IS NOT NULL), '[]'::json) as comments,
           COALESCE(json_agg(json_build_object(
               'id', tag.id,
               'tag', tag.tag,
               'description', tag.description,
               'color', tag.color
           )) FILTER (WHERE tag.id IS NOT NULL), '[]'::json) as tags,
           COALESCE(json_agg(json_build_object(
               'id', watcher.id,
               'name', watcher.name,
               'color', watcher.color
           )) FILTER (WHERE watcher.id IS NOT NULL), '[]'::json) as watchers,
           COALESCE(json_agg(json_build_object(
               'id', collaborator.id,
               'name', collaborator.name,
               'color', collaborator.color
           )) FILTER (WHERE collaborator.id IS NOT NULL), '[]'::json) as collaborators
    FROM tasks t
    LEFT JOIN comments c ON c.taskid = t.id
    LEFT JOIN task_tags tt ON tt.taskid = t.id
    LEFT JOIN tags tag ON tag.id = tt.tagid
    LEFT JOIN watchers w ON w.taskid = t.id
    LEFT JOIN members watcher ON watcher.id = w.memberid
    LEFT JOIN collaborators col ON col.taskid = t.id
    LEFT JOIN members collaborator ON collaborator.id = col.memberid
    LEFT JOIN attachments a ON a.taskid = t.id
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    WHERE t.columnid = $1 AND t.deleted_at IS NULL
    GROUP BY t.id, p.id
    ORDER BY t.position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const tasks = await stmt.all(columnId);
  
  // Parse JSON fields for each task
  return tasks.map(task => {
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
    
    const deduplicateById = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        if (!item || !item.id) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    };
    
    task.comments = deduplicateById(parseJsonField(task.comments));
    task.tags = deduplicateById(parseJsonField(task.tags));
    task.watchers = deduplicateById(parseJsonField(task.watchers));
    task.collaborators = deduplicateById(parseJsonField(task.collaborators));
    
    return task;
  });
}

/**
 * Get all tasks for multiple columns (batch query for performance)
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} columnIds - Array of column IDs
 * @returns {Promise<Array>} Array of task objects with relationships
 */
export async function getTasksForColumns(db, columnIds) {
  if (!columnIds || columnIds.length === 0) {
    return [];
  }
  
  const placeholders = columnIds.map((_, index) => `$${index + 1}`).join(', ');
  const query = `
    SELECT t.id, t.position, t.title, t.description, t.ticket, 
           t.memberid as "memberId", t.requesterid as "requesterId", 
           t.startdate as "startDate", t.duedate as "dueDate", 
           t.effort, t.priority, t.priority_id as "priority_id", 
           t.columnid as "columnId", t.boardid as "boardId", 
           t.sprint_id as "sprint_id", t.created_at, t.updated_at,
           t.column_entered_at as "columnEnteredAt",
           t.is_blocked as "isBlocked",
           t.blocked_reason as "blockedReason",
           p.id as "priorityId", p.priority as "priorityName", 
           p.color as "priorityColor",
           CASE WHEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) > 0 
                THEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) 
                ELSE NULL END as "attachmentCount",
           COALESCE(json_agg(json_build_object(
               'id', c.id,
               'text', c.text,
               'authorId', c.authorid,
               'createdAt', c.createdat
           )) FILTER (WHERE c.id IS NOT NULL), '[]'::json) as comments,
           COALESCE(json_agg(json_build_object(
               'id', tag.id,
               'tag', tag.tag,
               'description', tag.description,
               'color', tag.color
           )) FILTER (WHERE tag.id IS NOT NULL), '[]'::json) as tags,
           COALESCE(json_agg(json_build_object(
               'id', watcher.id,
               'name', watcher.name,
               'color', watcher.color
           )) FILTER (WHERE watcher.id IS NOT NULL), '[]'::json) as watchers,
           COALESCE(json_agg(json_build_object(
               'id', collaborator.id,
               'name', collaborator.name,
               'color', collaborator.color
           )) FILTER (WHERE collaborator.id IS NOT NULL), '[]'::json) as collaborators
    FROM tasks t
    LEFT JOIN comments c ON c.taskid = t.id
    LEFT JOIN task_tags tt ON tt.taskid = t.id
    LEFT JOIN tags tag ON tag.id = tt.tagid
    LEFT JOIN watchers w ON w.taskid = t.id
    LEFT JOIN members watcher ON watcher.id = w.memberid
    LEFT JOIN collaborators col ON col.taskid = t.id
    LEFT JOIN members collaborator ON collaborator.id = col.memberid
    LEFT JOIN attachments a ON a.taskid = t.id
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    WHERE t.columnid IN (${placeholders}) AND t.deleted_at IS NULL
    GROUP BY t.id, p.id
    ORDER BY t.columnid, t.position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const tasks = await stmt.all(...columnIds);
  
  // Parse JSON fields for each task
  return tasks.map(task => {
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
    
    const deduplicateById = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        if (!item || !item.id) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    };
    
    task.comments = deduplicateById(parseJsonField(task.comments));
    task.tags = deduplicateById(parseJsonField(task.tags));
    task.watchers = deduplicateById(parseJsonField(task.watchers));
    task.collaborators = deduplicateById(parseJsonField(task.collaborators));
    
    return task;
  });
}

/**
 * Get all tasks (simple list)
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Array>} Array of all tasks
 */
export async function getAllTasks(db) {
  const query = `
    SELECT t.*, 
           CASE WHEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) > 0 
                THEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) 
                ELSE NULL END as "attachmentCount"
    FROM tasks t
    LEFT JOIN attachments a ON a.taskid = t.id
    WHERE t.deleted_at IS NULL
    GROUP BY t.id
    ORDER BY t.position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all();
}

/**
 * Create a new task
 * 
 * @param {Database} db - Database connection
 * @param {Object} taskData - Task data object
 * @param {string} taskData.id - Task ID (UUID)
 * @param {string} taskData.title - Task title
 * @param {string} [taskData.description] - Task description
 * @param {string} [taskData.ticket] - Task ticket number
 * @param {string} [taskData.memberId] - Assigned member ID
 * @param {string} [taskData.requesterId] - Requester member ID
 * @param {string} [taskData.startDate] - Start date (ISO string)
 * @param {string} [taskData.dueDate] - Due date (ISO string)
 * @param {number} [taskData.effort] - Effort estimate
 * @param {string} [taskData.priority] - Priority name
 * @param {string} [taskData.priorityId] - Priority ID
 * @param {string} taskData.columnId - Column ID
 * @param {string} taskData.boardId - Board ID
 * @param {number} [taskData.position] - Position in column
 * @param {string} [taskData.sprintId] - Sprint ID
 * @returns {Promise<Object>} Result object with changes and lastInsertRowid
 */
export async function createTask(db, taskData) {
  const now = new Date().toISOString();
  
  const query = `
    INSERT INTO tasks (
      id, title, description, ticket, memberid, requesterid,
      startdate, duedate, effort, priority, priority_id,
      columnid, boardid, position, sprint_id,
      column_entered_at, is_blocked, blocked_reason,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
    ) RETURNING *
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  // Handle effort: default to 0 if not provided, but allow 0 as a valid value
  // Use nullish coalescing to only default when effort is null/undefined, not when it's 0
  const effort = taskData.effort != null ? taskData.effort : 0;
  
  return await stmt.run(
    taskData.id,
    taskData.title,
    taskData.description || '',
    taskData.ticket || null,
    taskData.memberId || null,
    taskData.requesterId || null,
    taskData.startDate || null,
    taskData.dueDate || null,
    effort,
    taskData.priority || null,
    taskData.priorityId || null,
    taskData.columnId,
    taskData.boardId,
    taskData.position != null ? taskData.position : 0,
    taskData.sprintId || null,
    now,
    Boolean(taskData.isBlocked),
    taskData.blockedReason || null,
    now,
    now
  );
}

/**
 * Update a task
 * 
 * @param {Database} db - Database connection
 * @param {string} taskid - Task ID to update
 * @param {Object} updates - Fields to update (only include fields that changed)
 * @returns {Promise<Object>} Result object with changes count
 */
export async function updateTask(db, taskId, updates) {
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  // API keys (camelCase or snake) → physical Postgres column names (lowercase)
  const fieldToColumn = {
    title: 'title',
    description: 'description',
    memberId: 'memberid',
    memberid: 'memberid',
    requesterId: 'requesterid',
    requesterid: 'requesterid',
    startDate: 'startdate',
    startdate: 'startdate',
    dueDate: 'duedate',
    duedate: 'duedate',
    effort: 'effort',
    priority: 'priority',
    priorityId: 'priority_id',
    priority_id: 'priority_id',
    columnId: 'columnid',
    columnid: 'columnid',
    boardId: 'boardid',
    boardid: 'boardid',
    position: 'position',
    sprintId: 'sprint_id',
    sprint_id: 'sprint_id',
    pre_boardId: 'pre_boardid',
    pre_boardid: 'pre_boardid',
    pre_columnId: 'pre_columnid',
    pre_columnid: 'pre_columnid',
    columnEnteredAt: 'column_entered_at',
    column_entered_at: 'column_entered_at',
    isBlocked: 'is_blocked',
    is_blocked: 'is_blocked',
    blockedReason: 'blocked_reason',
    blocked_reason: 'blocked_reason',
  };

  Object.entries(updates).forEach(([key, value]) => {
    const columnName = fieldToColumn[key];
    if (!columnName) return;
    setClauses.push(`${columnName} = $${paramIndex++}`);
    if (columnName === 'is_blocked') {
      values.push(Boolean(value));
    } else {
      values.push(value);
    }
  });

  // Reset dwell clock when moving columns unless caller set column_entered_at explicitly
  const movingColumn =
    Object.prototype.hasOwnProperty.call(updates, 'columnId') ||
    Object.prototype.hasOwnProperty.call(updates, 'columnid');
  const hasEnteredAt =
    Object.prototype.hasOwnProperty.call(updates, 'columnEnteredAt') ||
    Object.prototype.hasOwnProperty.call(updates, 'column_entered_at');
  if (movingColumn && !hasEnteredAt) {
    setClauses.push(`column_entered_at = $${paramIndex++}`);
    values.push(new Date().toISOString());
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  setClauses.push(`updated_at = $${paramIndex++}`);
  values.push(new Date().toISOString());
  values.push(taskId);

  const query = `
    UPDATE tasks 
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(...values);
}

/**
 * Delete a task
 * 
 * @param {Database} db - Database connection
 * @param {string} taskid - Task ID to delete
 * @returns {Promise<Object>} Result object with changes count
 */
export async function deleteTask(db, taskId) {
  const query = `
    DELETE FROM tasks WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(taskId);
}

/**
 * Get task ticket by task ID
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<string|null>} Ticket number or null
 */
export async function getTaskTicket(db, taskId) {
  const query = `
    SELECT ticket FROM tasks WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(taskId);
  return result ? result.ticket : null;
}

/**
 * Generate next task ticket number
 * 
 * @param {Database} db - Database connection
 * @param {string} prefix - Ticket prefix (e.g., "TASK-")
 * @returns {Promise<string>} Next ticket number (e.g., "TASK-00033")
 */
export async function generateTaskTicket(db, prefix) {
  // Use PostgreSQL regex pattern for ordering (similar to generateProjectIdentifier)
  // Extract the numeric part in JavaScript for reliability
  const query = `
    SELECT ticket FROM tasks
    WHERE ticket IS NOT NULL AND ticket LIKE $1
    ORDER BY 
      CAST(
        SUBSTRING(ticket FROM '\\d+$') AS INTEGER
      ) DESC
    LIMIT 1
  `;
  
  const pattern = `${prefix}%`;
  
  try {
    const stmt = wrapQuery(db.prepare(query), 'SELECT');
    const result = await stmt.get(pattern);
    
    if (!result || !result.ticket) {
      console.log(`📝 [generateTaskTicket] No existing tickets found, starting with ${prefix}00001`);
      return `${prefix}00001`;
    }
    
    // Extract the number part from the ticket (everything after the prefix and dash)
    // This matches the approach used in generateProjectIdentifier
    const ticketStr = result.ticket;
    const numberPart = ticketStr.substring(prefix.length + 1); // Skip prefix and dash
    const lastNumber = parseInt(numberPart, 10);
    
    // Handle case where parsing fails
    if (isNaN(lastNumber)) {
      console.warn(`⚠️ [generateTaskTicket] Failed to parse ticket number from: ${ticketStr}, numberPart: ${numberPart}, using 1`);
      return `${prefix}00001`;
    }
    
    const nextNumber = lastNumber + 1;
    const paddedNumber = String(nextNumber).padStart(5, '0');
    const newTicket = `${prefix}${paddedNumber}`;
    
    console.log(`📝 [generateTaskTicket] Last ticket: ${ticketStr}, Next ticket: ${newTicket}`);
    return newTicket;
  } catch (error) {
    console.error(`❌ [generateTaskTicket] Error generating ticket:`, error);
    // Fallback to 00001 on error
    return `${prefix}00001`;
  }
}

/**
 * Update task positions in a column (increment positions for tasks after a certain position)
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @returns {Promise<Object>} Result object with changes count
 */
export async function incrementTaskPositions(db, columnId) {
  const query = `
    UPDATE tasks SET position = position + 1 WHERE columnid = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(columnId);
}

/**
 * Get tasks by multiple IDs with relationships
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} taskIds - Array of task IDs
 * @returns {Promise<Array>} Array of task objects with relationships
 */
export async function getTasksByIds(db, taskIds) {
  if (!taskIds || taskIds.length === 0) {
    return [];
  }
  
  // Build parameterized query with $1, $2, $3, etc.
  const placeholders = taskIds.map((_, index) => `$${index + 1}`).join(', ');
  
  const query = `
    SELECT t.*, 
           p.id as "priorityId",
           p.priority as "priorityName",
           p.color as "priorityColor",
           CASE WHEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) > 0 
                THEN COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.id END) 
                ELSE NULL END as "attachmentCount"
    FROM tasks t
    LEFT JOIN attachments a ON a.taskid = t.id
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    WHERE t.id IN (${placeholders})
    GROUP BY t.id, p.id
    ORDER BY t.position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(...taskIds);
}

/**
 * Get tasks by board ID
 * 
 * @param {Database} db - Database connection
 * @param {string} boardId - Board ID
 * @returns {Promise<Array>} Array of tasks
 */
export async function getTasksByBoard(db, boardId) {
  const query = `
    SELECT * FROM tasks WHERE boardid = $1 AND deleted_at IS NULL ORDER BY position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(boardId);
}

/**
 * Get tasks by sprint ID
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @returns {Promise<Array>} Array of tasks
 */
export async function getTasksBySprint(db, sprintId) {
  const query = `
    SELECT * FROM tasks WHERE sprint_id = $1 AND deleted_at IS NULL ORDER BY position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(sprintId);
}

/**
 * Get tasks by member ID
 * 
 * @param {Database} db - Database connection
 * @param {string} memberId - Member ID
 * @returns {Promise<Array>} Array of tasks
 */
export async function getTasksByMember(db, memberId) {
  const query = `
    SELECT * FROM tasks WHERE memberid = $1 AND deleted_at IS NULL ORDER BY position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(memberId);
}

/**
 * Get task with board and column info
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Object|null>} Task with board and column info
 */
export async function getTaskWithBoardColumnInfo(db, taskId) {
  const query = `
    SELECT t.*, b.title as board_title, c.title as column_title, b.id as board_id
    FROM tasks t
    LEFT JOIN boards b ON t.boardid = b.id
    LEFT JOIN columns c ON t.columnid = c.id
    WHERE t.id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId);
}

/**
 * Get task tags
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Array>} Array of tags
 */
export async function getTaskTags(db, taskId) {
  const query = `
    SELECT t.tag as name FROM task_tags tt
    JOIN tags t ON tt.tagid = t.id
    WHERE tt.taskid = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(taskId);
}

/**
 * Get remaining tasks in column (for renumbering after delete)
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @param {string} boardId - Board ID
 * @returns {Promise<Array>} Array of tasks with id and position
 */
export async function getRemainingTasksInColumn(db, columnId, boardId) {
  const query = `
    SELECT id, position FROM tasks 
    WHERE columnid = $1 AND boardid = $2 AND deleted_at IS NULL
    ORDER BY position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(columnId, boardId);
}

/**
 * Update task position
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @param {number} position - New position
 * @returns {Promise<Object>} Result object
 */
export async function updateTaskPosition(db, taskId, position) {
  const query = `
    UPDATE tasks SET position = $1 WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(position, taskId);
}

/**
 * Renumber tasks in column sequentially from 0
 * 
 * @param {Database} db - Database connection
 * @param {Array} tasks - Array of {id, position} objects
 * @returns {Promise<void>}
 */
export async function renumberTasksInColumn(db, tasks) {
  const updateStmt = wrapQuery(db.prepare('UPDATE tasks SET position = $1 WHERE id = $2'), 'UPDATE');
  
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    if (task.position !== index) {
      await updateStmt.run(index, task.id);
    }
  }
}

/**
 * Get tasks for a column (simplified version - for renumbering)
 * This is a minimal implementation to support renumbering functions
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @returns {Promise<Array>} Array of tasks with id, position, columnId, boardId
 */
export async function getTasksForColumnBasic(db, columnId) {
  const query = `
    SELECT id, position, columnid as "columnId", boardid as "boardId"
    FROM tasks
    WHERE columnid = $1 AND deleted_at IS NULL
    ORDER BY position ASC
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(columnId);
}

/**
 * Renumber tasks in a column to sequential integers (0, 1, 2, 3...)
 * This is called when positions get too close together or collide
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @returns {Promise<number>} Number of tasks renumbered
 */
export async function renumberTasksInColumnByColumnId(db, columnId) {
  // Get all tasks in the column, sorted by current position
  const tasks = await getTasksForColumnBasic(db, columnId);
  
  if (tasks.length === 0) {
    return 0;
  }
  
  // Build batch update queries
  const batchQueries = [];
  const updateQuery = `
    UPDATE tasks SET position = $1, updated_at = $2 WHERE id = $3
  `;

  const now = new Date().toISOString();

  // Renumber to sequential integers: 0, 1, 2, 3...
  tasks.forEach((task, index) => {
    const newPosition = index;
    batchQueries.push({
      query: updateQuery,
      params: [newPosition, now, task.id]
    });
  });

  await db.executeBatchTransaction(batchQueries);

  return tasks.length;
}

/**
 * Check if tasks in a column need renumbering
 * Returns true if positions are too close together (< 0.1) or have collisions
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @returns {Promise<boolean>} True if renumbering is needed
 */
export async function shouldRenumberTasksInColumn(db, columnId) {
  const tasks = await getTasksForColumnBasic(db, columnId);
  
  if (tasks.length <= 1) {
    return false; // No need to renumber if 0 or 1 task
  }
  
  // Sort by position
  const sortedTasks = tasks.sort((a, b) => {
    const posA = typeof a.position === 'number' ? a.position : parseFloat(a.position) || 0;
    const posB = typeof b.position === 'number' ? b.position : parseFloat(b.position) || 0;
    return posA - posB;
  });
  
  // Check for collisions (same position) or gaps that are too small (< 0.1)
  const MIN_GAP = 0.1;
  for (let i = 0; i < sortedTasks.length - 1; i++) {
    const currentPos = typeof sortedTasks[i].position === 'number' 
      ? sortedTasks[i].position 
      : parseFloat(sortedTasks[i].position) || 0;
    const nextPos = typeof sortedTasks[i + 1].position === 'number' 
      ? sortedTasks[i + 1].position 
      : parseFloat(sortedTasks[i + 1].position) || 0;
    
    const gap = nextPos - currentPos;
    
    // If gap is too small or positions are equal (collision), renumber
    if (gap < MIN_GAP) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get tasks by IDs with basic info (for validation)
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} taskIds - Array of task IDs
 * @returns {Promise<Array>} Array of tasks with basic fields
 */
export async function getTasksByIdsBasic(db, taskIds) {
  if (!taskIds || taskIds.length === 0) {
    return [];
  }
  
  const placeholders = taskIds.map((_, index) => `$${index + 1}`).join(', ');
  
  const query = `
    SELECT 
      id, 
      columnid as "columnId", 
      boardid as "boardId", 
      priority_id as "priorityId", 
      priority, 
      position, 
      title,
      description,
      effort,
      startdate as "startDate",
      duedate as "dueDate",
      memberid as "memberId",
      requesterid as "requesterId",
      ticket,
      sprint_id as "sprintId"
    FROM tasks 
    WHERE id IN (${placeholders})
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(...taskIds);
}

/**
 * Check if task exists
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<boolean>} True if task exists
 */
export async function taskExists(db, taskId) {
  const query = `
    SELECT id FROM tasks WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(taskId);
  return !!result;
}

/**
 * Get task board ID
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<string|null>} Board ID or null
 */
export async function getTaskBoardId(db, taskId) {
  const query = `
    SELECT boardid as "boardId" FROM tasks WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(taskId);
  return result ? result.boardId : null;
}

/**
 * Update task positions in column (shift positions)
 * 
 * @param {Database} db - Database connection
 * @param {string} columnId - Column ID
 * @param {number} minPosition - Minimum position (exclusive)
 * @param {number} maxPosition - Maximum position (inclusive)
 * @param {number} shiftBy - Amount to shift (positive or negative)
 * @returns {Promise<Object>} Result object
 */
export async function shiftTaskPositions(db, columnId, minPosition, maxPosition, shiftBy) {
  if (shiftBy > 0) {
    const query = `
      UPDATE tasks SET position = position + $1 
      WHERE columnid = $2 AND position > $3 AND position <= $4
    `;
    const stmt = wrapQuery(db.prepare(query), 'UPDATE');
    return await stmt.run(shiftBy, columnId, minPosition, maxPosition);
  } else {
    const query = `
      UPDATE tasks SET position = position - $1 
      WHERE columnid = $2 AND position >= $3 AND position < $4
    `;
    const stmt = wrapQuery(db.prepare(query), 'UPDATE');
    return await stmt.run(Math.abs(shiftBy), columnId, maxPosition, minPosition);
  }
}

/**
 * Update task position and column (for reordering)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @param {number} position - New position
 * @param {string} columnId - New column ID
 * @param {string} previousBoardId - Previous board ID
 * @param {string} previousColumnId - Previous column ID
 * @returns {Promise<Object>} Result object
 */
export async function updateTaskPositionAndColumn(
  db,
  taskId,
  position,
  columnId,
  previousBoardId,
  previousColumnId,
  newBoardId = null
) {
  const now = new Date().toISOString();
  if (newBoardId) {
    const query = `
      UPDATE tasks SET 
        position = $1, 
        columnid = $2,
        boardid = $3,
        pre_boardid = $4, 
        pre_columnid = $5,
        column_entered_at = $6,
        updated_at = $7
      WHERE id = $8
    `;
    const stmt = wrapQuery(db.prepare(query), 'UPDATE');
    return await stmt.run(
      position,
      columnId,
      newBoardId,
      previousBoardId,
      previousColumnId,
      now,
      now,
      taskId
    );
  }
  const query = `
    UPDATE tasks SET 
      position = $1, 
      columnid = $2,
      pre_boardid = $3, 
      pre_columnid = $4,
      column_entered_at = $5,
      updated_at = $6
    WHERE id = $7
  `;

  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(position, columnId, previousBoardId, previousColumnId, now, now, taskId);
}

/**
 * Remove every task_rels row involving this task (both directions).
 * Used when moving a task to another board so links stay within-board for flow chart / list / gantt.
 */
export async function deleteAllRelationshipsInvolvingTask(db, taskId) {
  const query = `DELETE FROM task_rels WHERE task_id = $1 OR to_task_id = $1`;
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(taskId);
}

/**
 * Get task relationships
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Array>} Array of relationships
 */
export async function getTaskRelationships(db, taskId) {
  const query = `
    SELECT 
      tr.*,
      t1.title as task_title,
      t1.ticket as task_ticket,
      t1.boardid as task_board_id,
      t2.title as related_task_title,
      t2.ticket as related_task_ticket,
      t2.boardid as related_task_board_id,
      b1.project as task_project_id,
      b2.project as related_task_project_id
    FROM task_rels tr
    JOIN tasks t1 ON tr.task_id = t1.id
    JOIN tasks t2 ON tr.to_task_id = t2.id
    LEFT JOIN boards b1 ON t1.boardid = b1.id
    LEFT JOIN boards b2 ON t2.boardid = b2.id
    WHERE tr.task_id = $1 OR tr.to_task_id = $1
    ORDER BY tr.created_at DESC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(taskId);
}

/**
 * Check if relationship exists
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @param {string} relationship - Relationship type
 * @param {string} toTaskId - Target task ID
 * @returns {Promise<Object|null>} Relationship object or null
 */
export async function getTaskRelationship(db, taskId, relationship, toTaskId) {
  const query = `
    SELECT id FROM task_rels 
    WHERE task_id = $1 AND relationship = $2 AND to_task_id = $3
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId, relationship, toTaskId);
}

/**
 * All relationship rows between two tasks (either direction).
 *
 * @param {Database} db - Database connection
 * @param {string} taskIdA - First task ID
 * @param {string} taskIdB - Second task ID
 * @returns {Promise<Array>} Matching relationship rows
 */
export async function getRelationshipsBetweenTasks(db, taskIdA, taskIdB) {
  const query = `
    SELECT id, task_id, relationship, to_task_id
    FROM task_rels
    WHERE (task_id = $1 AND to_task_id = $2)
       OR (task_id = $2 AND to_task_id = $1)
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(taskIdA, taskIdB);
}

/**
 * Check for opposite relationship (for cycle detection)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @param {string} relationship - Relationship type
 * @param {string} toTaskId - Target task ID
 * @returns {Promise<Object|null>} Opposite relationship or null
 */
export async function getOppositeRelationship(db, taskId, relationship, toTaskId) {
  const oppositeMap = {
    'parent': 'child',
    'child': 'parent',
    'related': 'related'
  };
  
  const oppositeRelationship = oppositeMap[relationship] || relationship;
  
  const query = `
    SELECT id FROM task_rels 
    WHERE task_id = $1 AND relationship = $2 AND to_task_id = $3
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(toTaskId, oppositeRelationship, taskId);
}

/**
 * Create task relationship
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @param {string} relationship - Relationship type
 * @param {string} toTaskId - Target task ID
 * @returns {Promise<Object>} Result object
 */
export async function createTaskRelationship(db, taskId, relationship, toTaskId) {
  const query = `
    INSERT INTO task_rels (task_id, relationship, to_task_id)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(taskId, relationship, toTaskId);
}

/**
 * Get task relationship by ID
 * 
 * @param {Database} db - Database connection
 * @param {string} relationshipId - Relationship ID
 * @param {string} taskId - Task ID (for validation)
 * @returns {Promise<Object|null>} Relationship object or null
 */
export async function getTaskRelationshipById(db, relationshipId, taskId) {
  const query = `
    SELECT * FROM task_rels 
    WHERE id = $1 AND task_id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(relationshipId, taskId);
}

/**
 * Delete task relationship
 * 
 * @param {Database} db - Database connection
 * @param {string} relationshipId - Relationship ID
 * @returns {Promise<Object>} Result object
 */
export async function deleteTaskRelationship(db, relationshipId) {
  const query = `DELETE FROM task_rels WHERE id = $1`;
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(relationshipId);
}

/**
 * Get available tasks for relationship (excludes current task and already related tasks)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Array>} Array of available tasks
 */
export async function getAvailableTasksForRelationship(db, taskId) {
  const query = `
    SELECT t.id, t.title, t.ticket, c.title as status, b.project as projectid
    FROM tasks t
    LEFT JOIN columns c ON t.columnid = c.id
    LEFT JOIN boards b ON t.boardid = b.id
    WHERE t.id != $1
    AND t.id NOT IN (
      SELECT to_task_id FROM task_rels WHERE task_id = $1
      UNION
      SELECT task_id FROM task_rels WHERE to_task_id = $1
    )
    ORDER BY t.ticket ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(taskId);
}

/**
 * Get connected task IDs (for flow chart)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Array>} Array of connected task IDs
 */
export async function getConnectedTaskIds(db, taskId) {
  const query = `
    SELECT DISTINCT 
      CASE 
        WHEN task_id = $1 THEN to_task_id 
        ELSE task_id 
      END as "connectedId"
    FROM task_rels 
    WHERE task_id = $1 OR to_task_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const results = await stmt.all(taskId);
  return results.map(r => r.connectedId ?? r.connected_id).filter(Boolean);
}

/**
 * Get tasks for flow chart
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} taskIds - Array of task IDs
 * @returns {Promise<Array>} Array of tasks with flow chart data
 */
export async function getTasksForFlowChart(db, taskIds) {
  if (!taskIds || taskIds.length === 0) {
    return [];
  }
  
  const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
  const query = `
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
    WHERE t.id IN (${placeholders})
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(...taskIds);
}

/**
 * Get relationships for flow chart
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} taskIds - Array of task IDs
 * @returns {Promise<Array>} Array of relationships
 */
export async function getRelationshipsForFlowChart(db, taskIds) {
  if (!taskIds || taskIds.length === 0) {
    return [];
  }
  
  const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
  const query = `
    SELECT 
      tr.id as "id",
      tr.task_id as "taskId",
      tr.relationship as "relationship",
      tr.to_task_id as "relatedTaskId",
      t1.ticket as "taskTicket",
      t2.ticket as "relatedTaskTicket"
    FROM task_rels tr
    JOIN tasks t1 ON tr.task_id = t1.id
    JOIN tasks t2 ON tr.to_task_id = t2.id
    WHERE tr.task_id IN (${placeholders}) AND tr.to_task_id IN (${placeholders})
  `;
  
  // Same $1..$n placeholders are reused in both IN lists — bind each id only once (PG errors if you pass 2n params).
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(...taskIds);
}

/**
 * Soft-delete a task (move to trash)
 */
export async function softDeleteTask(db, taskId, deletedBy) {
  const query = `
    UPDATE tasks
    SET deleted_at = CURRENT_TIMESTAMP,
        deleted_by = $2,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.get(taskId, deletedBy || null);
}

/**
 * Soft-delete all live tasks on a board
 */
export async function softDeleteTasksForBoard(db, boardId, deletedBy) {
  const query = `
    UPDATE tasks
    SET deleted_at = CURRENT_TIMESTAMP,
        deleted_by = $2,
        updated_at = CURRENT_TIMESTAMP
    WHERE boardid = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.all(boardId, deletedBy || null);
}

/**
 * Restore a soft-deleted task into a column
 */
export async function restoreTask(db, taskId, columnId, boardId, position) {
  const query = `
    UPDATE tasks
    SET deleted_at = NULL,
        deleted_by = NULL,
        columnid = $2,
        boardid = $3,
        position = $4,
        column_entered_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NOT NULL
    RETURNING *
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.get(taskId, columnId, boardId, position);
}

/**
 * Shift live tasks down so a restored task can reclaim its original position.
 * All live tasks with position >= insertPosition get position + 1.
 */
export async function shiftLiveTasksFromPosition(db, columnId, insertPosition) {
  const query = `
    UPDATE tasks
    SET position = position + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE columnid = $1
      AND deleted_at IS NULL
      AND position >= $2
    RETURNING id, position, columnid as "columnId"
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.all(columnId, insertPosition);
}

/**
 * Count soft-deleted tasks for a board
 */
export async function countTrashTasksForBoard(db, boardId) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE boardid = $1 AND deleted_at IS NOT NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(boardId);
  return row?.count || 0;
}

/**
 * List soft-deleted tasks for a board (column order, then original position)
 */
export async function getTrashTasksForBoard(db, boardId) {
  const query = `
    SELECT t.id, t.position, t.title, t.description, t.ticket,
           t.memberid as "memberId", t.requesterid as "requesterId",
           t.startdate as "startDate", t.duedate as "dueDate",
           t.effort, t.priority, t.priority_id as "priority_id",
           t.columnid as "columnId", t.boardid as "boardId",
           t.sprint_id as "sprintId",
           t.created_at, t.updated_at,
           t.deleted_at as "deletedAt",
           t.deleted_by as "deletedBy",
           t.column_entered_at as "columnEnteredAt",
           t.is_blocked as "isBlocked",
           t.blocked_reason as "blockedReason",
           p.id as "priorityId", p.priority as "priorityName",
           p.color as "priorityColor",
           c.title as "columnTitle",
           c.position as "columnPosition",
           COALESCE(deleter_member.name, deleter_user.email, t.deleted_by) as "deletedByName"
    FROM tasks t
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    LEFT JOIN columns c ON c.id = t.columnid
    LEFT JOIN users deleter_user ON deleter_user.id = t.deleted_by
    LEFT JOIN members deleter_member ON deleter_member.user_id = t.deleted_by
    WHERE t.boardid = $1 AND t.deleted_at IS NOT NULL
    ORDER BY COALESCE(c.position, 999999) ASC, t.position ASC, t.deleted_at DESC
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(boardId);
}

/**
 * Count soft-deleted tasks tenant-wide (Admin Lifecycle badge / summary)
 */
export async function countLifecycleDeletedTasks(db) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE deleted_at IS NOT NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get();
  return row?.count || 0;
}

/**
 * Soft-deleted tasks across boards for Admin Lifecycle
 */
export async function getLifecycleDeletedTasks(db, boardId = null, search = null) {
  const params = [];
  let where = 't.deleted_at IS NOT NULL';
  if (boardId) {
    params.push(boardId);
    where += ` AND t.boardid = $${params.length}`;
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    where += ` AND (LOWER(t.title) LIKE $${params.length} OR LOWER(COALESCE(t.ticket, '')) LIKE $${params.length})`;
  }
  const query = `
    SELECT t.id, t.title, t.ticket, t.description,
           t.memberid as "memberId", t.requesterid as "requesterId",
           t.startdate as "startDate", t.duedate as "dueDate",
           t.effort, t.priority,
           t.columnid as "columnId", t.boardid as "boardId",
           t.deleted_at as "deletedAt", t.deleted_by as "deletedBy",
           b.title as "boardTitle",
           c.title as "columnTitle"
    FROM tasks t
    LEFT JOIN boards b ON b.id = t.boardid
    LEFT JOIN columns c ON c.id = t.columnid
    WHERE ${where}
    ORDER BY t.deleted_at DESC
    LIMIT 500
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(...params);
}

/**
 * Soft-deleted tasks matching a text query, for the header search dropdown.
 * Board-agnostic like the live corpus the client already holds, so trashed work
 * stays findable; capped because this runs per keystroke batch.
 */
export async function searchTrashedTasks(db, search, limit = 20) {
  const needle = `%${String(search).trim().toLowerCase()}%`;
  const query = `
    SELECT t.id, t.title, t.ticket, t.description,
           t.memberid as "memberId", t.requesterid as "requesterId",
           t.startdate as "startDate", t.duedate as "dueDate",
           t.priority, t.priority_id as "priorityId",
           t.columnid as "columnId", t.boardid as "boardId",
           t.deleted_at as "deletedAt",
           p.priority as "priorityName", p.color as "priorityColor",
           b.title as "boardTitle",
           c.title as "columnTitle"
    FROM tasks t
    LEFT JOIN priorities p ON (p.id = t.priority_id OR (t.priority_id IS NULL AND p.priority = t.priority))
    LEFT JOIN boards b ON b.id = t.boardid
    LEFT JOIN columns c ON c.id = t.columnid
    WHERE t.deleted_at IS NOT NULL
      AND (
        LOWER(COALESCE(t.ticket, '')) LIKE $1
        OR LOWER(t.title) LIKE $1
        OR LOWER(COALESCE(t.description, '')) LIKE $1
      )
    ORDER BY t.deleted_at DESC
    LIMIT $2
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(needle, limit);
}

/**
 * Reassign soft-deleted tasks off a column before hard-deleting the column
 */
export async function reassignTrashTasksFromColumn(db, columnId, fallbackColumnId) {
  const query = `
    UPDATE tasks
    SET columnid = $2, updated_at = CURRENT_TIMESTAMP
    WHERE columnid = $1 AND deleted_at IS NOT NULL
    RETURNING id
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.all(columnId, fallbackColumnId);
}

/**
 * Count live (non-trashed) tasks in a column
 */
export async function countLiveTasksInColumn(db, columnId) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE columnid = $1 AND deleted_at IS NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(columnId);
  return Number(row?.count) || 0;
}

/**
 * Count soft-deleted (trash) tasks still pointing at a column
 */
export async function countTrashTasksInColumn(db, columnId) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE columnid = $1 AND deleted_at IS NOT NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(columnId);
  return Number(row?.count) || 0;
}

/**
 * Soft-deleted task IDs past retention (for cron)
 */
export async function getExpiredSoftDeletedTasks(db, retentionDays) {
  const query = `
    SELECT id, boardid as "boardId"
    FROM tasks
    WHERE deleted_at IS NOT NULL
      AND deleted_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(String(retentionDays));
}

/**
 * Tasks in archived columns past retention (for cron)
 */
export async function getExpiredArchivedColumnTasks(db, retentionDays) {
  const query = `
    SELECT t.id, t.boardid as "boardId"
    FROM tasks t
    JOIN columns c ON c.id = t.columnid
    WHERE t.deleted_at IS NULL
      AND (c.is_archived = true OR c.is_archived = 1)
      AND t.column_entered_at IS NOT NULL
      AND t.column_entered_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(String(retentionDays));
}

/**
 * Attachment URLs for a task (direct + via comments) for purge
 */
export async function getAllAttachmentUrlsForTask(db, taskId) {
  const query = `
    SELECT url FROM attachments
    WHERE taskid = $1
    UNION
    SELECT a.url FROM attachments a
    JOIN comments c ON c.id = a.commentid
    WHERE c.taskid = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(taskId);
}

/**
 * Mark task_snapshots as deleted for a task
 */
export async function markTaskSnapshotsDeleted(db, taskId) {
  const query = `
    UPDATE task_snapshots
    SET is_deleted = true, updated_at = CURRENT_TIMESTAMP
    WHERE task_id = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  try {
    return await stmt.run(taskId);
  } catch {
    return { changes: 0 };
  }
}

/**
 * Max position among live tasks in a column
 */
export async function getMaxLivePositionInColumn(db, columnId) {
  const query = `
    SELECT COALESCE(MAX(position), -1) as "maxPos"
    FROM tasks
    WHERE columnid = $1 AND deleted_at IS NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(columnId);
  const maxPos = Number(row?.maxPos ?? row?.maxpos);
  return Number.isFinite(maxPos) ? maxPos : -1;
}

