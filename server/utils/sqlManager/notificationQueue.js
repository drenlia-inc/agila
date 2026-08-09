/**
 * Notification Queue Query Manager
 * 
 * Centralized PostgreSQL-native queries for notification queue operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/notificationQueue
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get all notification queue items with human-readable data
 * 
 * @param {Database} db - Database connection
 * @param {number} limit - Maximum number of notifications to return (default: 500)
 * @returns {Promise<Array>} Array of notification objects with joined data
 */
export async function getAllNotificationQueueItems(db, limit = 500) {
  const query = `
    SELECT 
      nq.id,
      nq.user_id as "userId",
      nq.task_id as "taskId",
      nq.notification_type as "notificationType",
      nq.action,
      nq.details,
      nq.old_value as "oldValue",
      nq.new_value as "newValue",
      nq.status,
      nq.scheduled_send_time as "scheduledSendTime",
      nq.first_change_time as "firstChangeTime",
      nq.last_change_time as "lastChangeTime",
      nq.change_count as "changeCount",
      nq.error_message as "errorMessage",
      nq.retry_count as "retryCount",
      nq.created_at as "createdAt",
      nq.updated_at as "updatedAt",
      nq.sent_at as "sentAt",
      -- User info
      u.email as "recipientEmail",
      m.name as "recipientName",
      -- Task info
      t.title as "taskTitle",
      t.ticket as "taskTicket",
      -- Column info
      c.title as "columnTitle",
      -- Board info
      b.title as "boardTitle",
      -- Actor info (from JSON)
      nq.actor_data as "actorData"
    FROM notification_queue nq
    LEFT JOIN users u ON nq.user_id = u.id
    LEFT JOIN members m ON u.id = m.user_id
    LEFT JOIN tasks t ON nq.task_id = t.id
    LEFT JOIN columns c ON t.columnid = c.id
    LEFT JOIN boards b ON t.boardid = b.id
    ORDER BY nq.updated_at DESC
    LIMIT $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(limit);
}

/**
 * Get notification queue item by ID with status filter
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Notification ID
 * @param {string} status - Optional status filter (e.g., 'pending')
 * @returns {Promise<Object|null>} Notification object or null
 */
export async function getNotificationQueueItemById(db, id, status = null) {
  let query = `
    SELECT *
    FROM notification_queue
    WHERE id = $1
  `;
  
  const params = [id];
  
  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(...params);
}

/**
 * Update notification queue item status
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Notification ID
 * @param {string} status - New status (e.g., 'sent')
 * @returns {Promise<Object>} Result object
 */
export async function updateNotificationQueueStatus(db, id, status) {
  const query = `
    UPDATE notification_queue
    SET status = $1,
        sent_at = CASE WHEN $1 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
        error_message = CASE WHEN $1 = 'sent' THEN NULL ELSE error_message END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(status, id);
}

/**
 * Delete notification queue items by IDs
 * 
 * @param {Database} db - Database connection
 * @param {Array<string>} ids - Array of notification IDs
 * @returns {Promise<Object>} Result object with changes count
 */
export async function deleteNotificationQueueItems(db, ids) {
  if (!ids || ids.length === 0) {
    return { changes: 0 };
  }
  
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const query = `
    DELETE FROM notification_queue
    WHERE id IN (${placeholders})
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(...ids);
}
