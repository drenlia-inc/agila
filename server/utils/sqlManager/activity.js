/**
 * Activity Query Manager
 * 
 * Centralized PostgreSQL-native queries for activity log operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/activity
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get activity feed
 * 
 * @param {Database} db - Database connection
 * @param {number} limit - Maximum number of activities to return
 * @param {string} userLanguage - User's language preference ('en' or 'fr'), defaults to 'en'
 * @returns {Promise<Array>} Array of activity objects with details in user's language
 */
export async function getActivityFeed(db, limit = 20, userLanguage = 'en') {
  const query = `
    SELECT 
      a.id, 
      a.userid as "userId", 
      a.roleid as "roleId", 
      a.action, 
      a.taskid as "taskId", 
      a.columnid as "columnId", 
      a.boardid as "boardId", 
      a.tagid as "tagId", 
      a.details,
      a.created_at as "createdAt",
      a.updated_at as "updatedAt",
      m.name as "memberName",
      r.name as "roleName",
      b.title as "boardTitle",
      b.project as "projectId",
      c.title as "columnTitle",
      t.ticket as "taskTicket"
    FROM activity a
    LEFT JOIN users u ON a.userid = u.id
    LEFT JOIN members m ON u.id = m.user_id
    LEFT JOIN roles r ON a.roleid = r.id
    LEFT JOIN boards b ON a.boardid = b.id
    LEFT JOIN columns c ON a.columnid = c.id
    LEFT JOIN tasks t ON a.taskid = t.id
    ORDER BY a.created_at DESC
    LIMIT $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const activities = await stmt.all(limit);
  
  // Parse bilingual JSON details and return user's language
  const normalizedLang = userLanguage?.toLowerCase() === 'fr' ? 'fr' : 'en';
  
  return activities.map(activity => {
    if (activity.details) {
      try {
        const parsed = JSON.parse(activity.details);
        if (parsed.en && parsed.fr) {
          // Bilingual JSON - return user's language
          activity.details = parsed[normalizedLang] || parsed.en;
          activity.viaApi = Boolean(parsed.viaApi);
        }
        // If not valid bilingual JSON, keep as-is (backward compatibility)
      } catch {
        // Not JSON, keep as-is (backward compatibility with old format)
      }
    }
    return activity;
  });
}

/**
 * Get user status and permissions
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User status object or null
 */
export async function getUserStatus(db, userId) {
  const userQuery = `
    SELECT 
      u.is_active as "isActive", 
      u.force_logout as "forceLogout"
    FROM users u
    WHERE u.id = $1
  `;
  const user = await wrapQuery(db.prepare(userQuery), 'SELECT').get(userId);
  if (!user) return null;

  const roles = await wrapQuery(
    db.prepare(`
      SELECT r.name FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = $1
    `),
    'SELECT'
  ).all(userId);

  const roleNames = (roles || []).map((r) => r.name);
  const role = roleNames.includes('admin')
    ? 'admin'
    : roleNames.includes('user')
      ? 'user'
      : roleNames.includes('viewer')
        ? 'viewer'
        : (roleNames[0] || 'user');

  return {
    isActive: user.isActive,
    forceLogout: user.forceLogout,
    role,
    roles: roleNames
  };
}

/**
 * Get task and board information for activity logging
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Object|null>} Task info with board title
 */
export async function getTaskInfoForActivity(db, taskId) {
  const query = `
    SELECT 
      t.title, 
      t.boardid as "boardId", 
      t.columnid as "columnId", 
      b.title as "boardTitle"
    FROM tasks t 
    LEFT JOIN boards b ON t.boardid = b.id 
    WHERE t.id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId);
}

/**
 * Get task details (ticket, project) for activity logging
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Object|null>} Task details with ticket and project
 */
export async function getTaskDetailsForActivity(db, taskId) {
  const query = `
    SELECT 
      t.ticket, 
      b.project 
    FROM tasks t 
    LEFT JOIN boards b ON t.boardid = b.id 
    WHERE t.id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId);
}

/**
 * Get user role for activity logging
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Role ID
 */
export async function getUserRoleForActivity(db, userId) {
  const query = `
    SELECT r.id as "roleId" 
    FROM user_roles ur 
    JOIN roles r ON ur.role_id = r.id 
    WHERE ur.user_id = $1 
    ORDER BY r.name DESC 
    LIMIT 1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get fallback role (first role in database)
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Object|null>} Role ID
 */
export async function getFallbackRole(db) {
  const query = `
    SELECT id 
    FROM roles 
    ORDER BY id ASC 
    LIMIT 1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get();
}

/**
 * Check if user exists
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User ID if exists
 */
export async function checkUserExists(db, userId) {
  const query = `
    SELECT id 
    FROM users 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get member name by member ID
 * 
 * @param {Database} db - Database connection
 * @param {string} memberId - Member ID
 * @returns {Promise<Object|null>} Member name
 */
export async function getMemberName(db, memberId) {
  const query = `
    SELECT name 
    FROM members 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(memberId);
}

/**
 * Resolve a member id to a display name (null if unassigned / unknown).
 */
export async function resolveMemberDisplayName(db, memberId) {
  if (memberId == null || memberId === '') return null;
  const row = await getMemberName(db, memberId);
  return row?.name || null;
}

/**
 * Resolve member id → linked user id (for notification routing).
 */
export async function getUserIdForMember(db, memberId) {
  if (memberId == null || memberId === '') return null;
  const query = `
    SELECT user_id AS "userId"
    FROM members
    WHERE id = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(memberId);
  return row?.userId || null;
}

/**
 * Get task ticket for activity logging
 * 
 * @param {Database} db - Database connection
 * @param {string} taskId - Task ID
 * @returns {Promise<Object|null>} Task ticket
 */
export async function getTaskTicket(db, taskId) {
  const query = `
    SELECT ticket 
    FROM tasks 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(taskId);
}

/**
 * Insert activity record
 * 
 * @param {Database} db - Database connection
 * @param {Object} activityData - Activity data
 * @returns {Promise<Object>} Insert result
 */
export async function insertActivity(db, activityData) {
  const query = `
    INSERT INTO activity (
      userid, roleid, action, taskid, columnid, boardid, tagid, commentid, details, 
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(
    activityData.userId,
    activityData.roleId,
    activityData.action,
    activityData.taskId || null,
    activityData.columnId || null,
    activityData.boardId || null,
    activityData.tagId || null,
    activityData.commentId || null,
    activityData.details
  );
}

