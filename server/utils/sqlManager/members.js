/**
 * Members Query Manager
 * 
 * Centralized PostgreSQL-native queries for member operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/members
 */

import { wrapQuery } from '../queryLogger.js';
import { SYSTEM_MEMBER_ID, AGENT_MEMBER_ID } from '../../constants/agentIdentity.js';

/**
 * Get all members with user info
 *
 * @param {Database} db - Database connection
 * @param {boolean|object} includeSystemOrOpts - Whether to include System User, or opts `{ includeSystem, includeAgent }`
 * @returns {Promise<Array>} Array of member objects with user info
 */
export async function getAllMembers(db, includeSystemOrOpts = false) {
  const opts =
    typeof includeSystemOrOpts === 'object' && includeSystemOrOpts !== null
      ? includeSystemOrOpts
      : { includeSystem: !!includeSystemOrOpts, includeAgent: true };

  const { includeSystem = false, includeAgent = true } = opts;
  const exclusions = [];
  if (!includeSystem) exclusions.push(SYSTEM_MEMBER_ID);
  if (!includeAgent) exclusions.push(AGENT_MEMBER_ID);

  const whereClause = exclusions.length
    ? `WHERE m.id NOT IN (${exclusions.map((_, i) => `$${i + 1}`).join(', ')})`
    : '';

  const query = `
    SELECT 
      m.id, 
      m.name, 
      m.color, 
      m.user_id as "userId", 
      m.created_at as "createdAt",
      u.email as "email",
      u.is_active as "isActive",
      u.bio as "bio",
      u.avatar_path as "avatarPath", 
      u.auth_provider as "authProvider", 
      u.google_avatar_url as "googleAvatarUrl",
      COALESCE((
        SELECT bool_or(r.name = 'viewer') AND NOT bool_or(r.name IN ('admin', 'user'))
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
      ), false) AS "isViewer"
    FROM members m
    LEFT JOIN users u ON m.user_id = u.id
    ${whereClause}
    ORDER BY
      CASE m.id
        WHEN '${AGENT_MEMBER_ID}' THEN 2
        WHEN '${SYSTEM_MEMBER_ID}' THEN 3
        ELSE 1
      END,
      LOWER(m.name) ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const members = await stmt.all(...exclusions);
  
  // Transform to match expected format (camelCase)
  return members.map(member => ({
    id: member.id,
    name: member.name,
    color: member.color,
    user_id: member.userId,
    email: member.email || undefined,
    // No linked user (Agent/orphans) → treat as active for UI; inactive only when users.is_active is false
    isActive: member.isActive === false || member.isActive === 0 ? false : true,
    bio: member.bio || undefined,
    avatarUrl: member.avatarPath,
    authProvider: member.authProvider,
    googleAvatarUrl: member.googleAvatarUrl,
    isViewer: member.isViewer === true
  }));
}

/**
 * Check if member name exists (case-insensitive)
 * 
 * @param {Database} db - Database connection
 * @param {string} name - Member name to check
 * @returns {Promise<Object|null>} Existing member or null
 */
export async function checkMemberNameExists(db, name) {
  const query = `
    SELECT id 
    FROM members 
    WHERE LOWER(name) = LOWER($1)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(name);
}

/**
 * Get a member by id (with optional user join fields for WS payloads)
 *
 * @param {Database} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getMemberById(db, id) {
  const query = `
    SELECT 
      m.id, 
      m.name, 
      m.color, 
      m.user_id as "userId", 
      m.created_at as "createdAt",
      u.email as "email",
      u.is_active as "isActive",
      u.bio as "bio",
      u.avatar_path as "avatarPath", 
      u.auth_provider as "authProvider", 
      u.google_avatar_url as "googleAvatarUrl"
    FROM members m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.id = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const member = await stmt.get(id);
  if (!member) return null;
  return {
    id: member.id,
    name: member.name,
    color: member.color,
    user_id: member.userId,
    email: member.email || undefined,
    isActive: member.isActive === false || member.isActive === 0 ? false : true,
    bio: member.bio || undefined,
    avatarUrl: member.avatarPath,
    authProvider: member.authProvider,
    googleAvatarUrl: member.googleAvatarUrl
  };
}

/**
 * Get the member linked to a user id
 *
 * @param {Database} db
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getMemberByUserId(db, userId) {
  const query = `
    SELECT 
      m.id, 
      m.name, 
      m.color, 
      m.user_id as "userId", 
      m.created_at as "createdAt"
    FROM members m
    WHERE m.user_id = $1
    LIMIT 1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const member = await stmt.get(userId);
  if (!member) return null;
  return {
    id: member.id,
    name: member.name,
    color: member.color,
    user_id: member.userId
  };
}

/**
 * True when the member's linked user is a read-only viewer (no admin/user role).
 */
export async function isReadOnlyViewerMember(db, memberId) {
  if (!memberId) return false;
  const query = `
    SELECT COALESCE(
      bool_or(r.name = 'viewer') AND NOT bool_or(r.name IN ('admin', 'user')),
      false
    ) AS "isViewer"
    FROM members m
    JOIN user_roles ur ON ur.user_id = m.user_id
    JOIN roles r ON r.id = ur.role_id
    WHERE m.id = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(memberId);
  return row?.isViewer === true;
}

/**
 * Create a new member
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Member ID
 * @param {string} name - Member name
 * @param {string} color - Member color
 * @returns {Promise<Object>} Created member object
 */
export async function createMember(db, id, name, color) {
  const query = `
    INSERT INTO members (id, name, color) 
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(id, name, color);
}

/**
 * Delete a member
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Member ID
 * @returns {Promise<Object>} Result object with changes count
 */
export async function deleteMember(db, id) {
  const query = `
    DELETE FROM members 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(id);
}
