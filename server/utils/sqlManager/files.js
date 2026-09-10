/**
 * Files Query Manager
 * 
 * Centralized PostgreSQL-native queries for file/attachment operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/files
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get attachment by ID
 * 
 * @param {Database} db - Database connection
 * @param {string} attachmentId - Attachment ID
 * @returns {Promise<Object|null>} Attachment object or null
 */
export async function getAttachmentById(db, attachmentId) {
  const query = `
    SELECT a.id,
           a.taskid as "taskId",
           a.commentid as "commentId",
           a.name,
           a.url,
           a.type,
           a.size,
           a.created_at as "createdAt",
           COALESCE(a.taskid, c.taskid) as "resolvedTaskId"
    FROM attachments a
    LEFT JOIN comments c ON c.id = a.commentid
    WHERE a.id = $1
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(attachmentId);
}

/**
 * Resolve an attachment row by stored public URL ending with the given filename.
 * Used to authorize authenticated file downloads by board membership.
 */
export async function getAttachmentByFilename(db, filename) {
  const safe = String(filename || '').replace(/\\/g, '/').split('/').pop();
  if (!safe) return null;
  const query = `
    SELECT a.id,
           a.taskid as "taskId",
           a.commentid as "commentId",
           a.url,
           COALESCE(a.taskid, c.taskid) as "resolvedTaskId"
    FROM attachments a
    LEFT JOIN comments c ON c.id = a.commentid
    WHERE a.url LIKE $1
       OR a.url LIKE $2
       OR a.url LIKE $3
    LIMIT 1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(
    `%/attachments/${safe}`,
    `%/api/files/attachments/${safe}`,
    `%/${safe}`
  );
}

/**
 * Get user by ID (for file access verification)
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object with id or null
 */
export async function getUserByIdForFileAccess(db, userId) {
  const query = `
    SELECT u.id, u.email, u.is_active, u.force_logout,
           COALESCE(string_agg(r.name, ','), '') as roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    WHERE u.id = $1
    GROUP BY u.id, u.email, u.is_active, u.force_logout
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get task by ID (for attachment operations)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Object|null>} Task object with boardid or null
 */
export async function getTaskByIdForFiles(db, taskId) {
  const query = `
    SELECT boardid as "boardId" 
    FROM tasks 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId);
}

/**
 * Delete attachment by ID
 * 
 * @param {Database} db - Database connection
 * @param {string} attachmentId - Attachment ID
 * @returns {Promise<Object>} Result object with changes count
 */
export async function deleteAttachment(db, attachmentId) {
  const query = `
    DELETE FROM attachments 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(attachmentId);
}

/**
 * Get all attachments for a task (full details)
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Array>} Array of attachment objects
 */
export async function getAttachmentsForTask(db, taskId) {
  const query = `
    SELECT 
      id, 
      name, 
      url, 
      type, 
      size, 
      created_at as "createdAt"
    FROM attachments 
    WHERE taskid = $1 AND commentid IS NULL
    ORDER BY created_at DESC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(taskId);
}

/**
 * Create attachment for a task
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Attachment ID
 * @param {string} taskId - Task ID
 * @param {string} name - Attachment name
 * @param {string} url - Attachment URL
 * @param {string} type - Attachment type
 * @param {number} size - Attachment size in bytes
 * @returns {Promise<Object>} Result object
 */
export async function createAttachmentForTask(db, id, taskId, name, url, type, size) {
  const query = `
    INSERT INTO attachments (id, taskid, name, url, type, size)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(id, taskId, name, url, type, size);
}

/**
 * Create attachment for a comment
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Attachment ID
 * @param {string} commentId - Comment ID
 * @param {string} name - Attachment name
 * @param {string} url - Attachment URL
 * @param {string} type - Attachment type
 * @param {number} size - Attachment size in bytes
 * @returns {Promise<Object>} Result object
 */
export async function createAttachmentForComment(db, id, commentId, name, url, type, size) {
  const query = `
    INSERT INTO attachments (id, commentid, name, url, type, size)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(id, commentId, name, url, type, size);
}

/**
 * Get attachments for multiple comments
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} commentIds - Array of comment IDs
 * @returns {Promise<Array>} Array of attachment objects with commentId
 */
export async function getAttachmentsForComments(db, commentIds) {
  if (!commentIds || commentIds.length === 0) {
    return [];
  }
  
  const placeholders = commentIds.map((_, i) => `$${i + 1}`).join(', ');
  const query = `
    SELECT 
      commentid as "commentId", 
      id, 
      name, 
      url, 
      type, 
      size, 
      created_at as "createdAt"
    FROM attachments
    WHERE commentid IN (${placeholders})
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(...commentIds);
}
