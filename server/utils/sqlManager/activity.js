/**
 * Activity Query Manager
 * 
 * Centralized PostgreSQL-native queries for activity log operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/activity
 */

import { wrapQuery } from '../queryLogger.js';
import { t } from '../i18n.js';

const SECURITY_FEED_ACTIONS = new Set(['impersonate', 'impersonate_mint_token']);

function parseDetailsJson(details) {
  if (!details) return null;
  if (typeof details === 'object') return details;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

async function displayNamesForTargets(db, targets) {
  const ids = [...new Set(targets.map((target) => target.id).filter(Boolean).map(String))];
  const emails = [...new Set(targets.map((target) => String(target.email || '').trim().toLowerCase()).filter(Boolean))];
  const byId = new Map();
  const byEmail = new Map();
  if (!ids.length && !emails.length) return { byId, byEmail };
  const rows = await wrapQuery(
    db.prepare(`
      SELECT u.id::text AS id,
             lower(u.email) AS email,
             COALESCE(
               NULLIF(m.name, ''),
               NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
               u.email
             ) AS "displayName"
      FROM users u
      LEFT JOIN members m ON m.user_id = u.id
      WHERE u.id::text = ANY($1::text[])
         OR lower(u.email) = ANY($2::text[])
    `),
    'SELECT'
  ).all(ids, emails);
  for (const row of rows || []) {
    if (row.id) byId.set(row.id, row.displayName);
    if (row.email) byEmail.set(row.email, row.displayName);
  }
  return { byId, byEmail };
}

function emailInText(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function securityFeedText(action, name, lang) {
  const who = name || t('activity.anotherUser', {}, lang);
  const key = action === 'impersonate_mint_token'
    ? 'activity.impersonatedMintToken'
    : 'activity.impersonatedUser';
  return t(key, { name: who }, lang);
}

/**
 * Get activity feed
 *
 * @param {Database} db - Database connection
 * @param {Object} [options]
 * @param {number} [options.limit=20] - Maximum rows to return
 * @param {string} [options.userLanguage='en'] - Locale for bilingual details
 * @param {number} [options.beforeId] - Return rows older than this activity id (load more)
 * @param {number} [options.sinceId] - Return rows newer than this activity id (delta sync)
 * @returns {Promise<Array>} Array of activity objects with details in user's language
 */
export async function getActivityFeed(db, options = {}) {
  const {
    limit = 20,
    userLanguage = 'en',
    beforeId,
    sinceId,
    includeImpersonation = false,
  } = options;

  const params = [limit];
  const clauses = [];
  if (sinceId != null) {
    params.push(sinceId);
    clauses.push(`a.id > $${params.length}`);
  } else if (beforeId != null) {
    params.push(beforeId);
    clauses.push(`a.id < $${params.length}`);
  }
  if (!includeImpersonation) {
    clauses.push(`a.action NOT IN ('impersonate', 'impersonate_mint_token')`);
    clauses.push(`COALESCE(a.details, '') NOT LIKE '%"impersonated":true%'`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

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
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const activities = await stmt.all(...params);
  
  // Parse bilingual JSON details and return user's language
  const normalizedLang = userLanguage?.toLowerCase() === 'fr' ? 'fr' : 'en';
  const securityLookups = [];

  const activitiesForFeed = activities.map(activity => {
    if (activity.details) {
      const parsed = parseDetailsJson(activity.details);
      if (SECURITY_FEED_ACTIONS.has(activity.action)) {
        securityLookups.push({ activity, parsed: parsed || {} });
      } else if (parsed && (typeof parsed.en === 'string' || typeof parsed.fr === 'string')) {
        activity.details = parsed[normalizedLang] || parsed.en || parsed.fr || '';
        activity.viaApi = Boolean(parsed.viaApi);
      }
    }
    return activity;
  });

  if (securityLookups.length) {
    const targets = securityLookups.map(({ parsed }) => ({
      id: parsed.targetUserId || null,
      email: parsed.targetEmail || emailInText(parsed.en) || emailInText(parsed.fr)
    }));
    const names = await displayNamesForTargets(db, targets);
    securityLookups.forEach(({ activity, parsed }, index) => {
      const target = targets[index];
      const name = (target.id && names.byId.get(String(target.id)))
        || (target.email && names.byEmail.get(target.email.toLowerCase()))
        || target.email
        || '';
      activity.details = securityFeedText(activity.action, name, normalizedLang);
      activity.viaApi = Boolean(parsed.viaApi);
    });
  }

  return activitiesForFeed;
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
 * Task tickets for bulk activity copy, in the same order as taskIds.
 *
 * @param {Database} db
 * @param {string[]} taskIds
 * @returns {Promise<string[]>}
 */
export async function getTaskTicketsForActivity(db, taskIds) {
  if (!taskIds?.length) return [];
  const placeholders = taskIds.map((_, index) => `$${index + 1}`).join(', ');
  const query = `
    SELECT id, ticket
    FROM tasks
    WHERE id IN (${placeholders})
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const rows = await stmt.all(...taskIds);
  const byId = new Map(rows.map((row) => [row.id, row.ticket]));
  return taskIds.map((id) => byId.get(id)).filter(Boolean);
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

/**
 * True if this user already has a first-join / legacy activation activity.
 * Used so password re-set / re-invite does not spam the feed.
 */
export async function hasUserJoinActivity(db, userId) {
  const query = `
    SELECT 1 AS present
    FROM activity
    WHERE userid = $1
      AND action IN ('member_joined', 'account_activated')
    LIMIT 1
  `;
  const row = await wrapQuery(db.prepare(query), 'SELECT').get(userId);
  return Boolean(row);
}

/** Audit row for impersonation and token mint. taskid is unused. */
export async function insertSecurityActivity(db, userId, action, details) {
  const stmt = wrapQuery(
    db.prepare(`
      INSERT INTO activity (userid, action, details)
      VALUES ($1, $2, $3)
    `),
    'INSERT'
  );
  await stmt.run(userId, action, details);
}

