/**
 * User Query Manager
 * 
 * Centralized PostgreSQL-native queries for user operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/users
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get user by ID
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserById(db, userId) {
  const query = `
    SELECT 
      id,
      email,
      first_name as "firstName",
      last_name as "lastName",
      bio,
      avatar_path as "avatarPath",
      auth_provider as "authProvider",
      google_avatar_url as "googleAvatarUrl",
      is_active as "isActive",
      force_logout as "forceLogout",
      activated_at as "activatedAt",
      deactivated_at as "deactivatedAt",
      deactivated_by as "deactivatedBy",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM users 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get user by email
 * 
 * @param {Database} db - Database connection
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserByEmail(db, email) {
  const query = `
    SELECT * FROM users 
    WHERE email = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(email);
}

/**
 * Get member by user_id
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Member object or null
 */
export async function getMemberByUserId(db, userId) {
  const query = `
    SELECT id FROM members 
    WHERE user_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Update user avatar path
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string|null} avatarPath - Avatar path or null
 * @returns {Promise<Object>} Result object
 */
export async function updateUserAvatar(db, userId, avatarPath) {
  const query = `
    UPDATE users 
    SET avatar_path = $1 
    WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(avatarPath, userId);
}

/**
 * Check if member name exists (case-insensitive, excluding specific user)
 * 
 * @param {Database} db - Database connection
 * @param {string} name - Member name
 * @param {string} excludeUserId - User ID to exclude from check
 * @returns {Promise<Object|null>} Existing member or null
 */
export async function checkMemberNameExists(db, name, excludeUserId) {
  const query = `
    SELECT id FROM members 
    WHERE LOWER(name) = LOWER($1) AND user_id != $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(name, excludeUserId);
}

/**
 * Update member name
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} name - New member name
 * @returns {Promise<Object>} Result object
 */
export async function updateMemberName(db, userId, name) {
  const query = `
    UPDATE members 
    SET name = $1 
    WHERE user_id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(name, userId);
}

/**
 * Update user bio (optional short memo for member tooltips)
 *
 * @param {Database} db
 * @param {string} userId
 * @param {string|null} bio
 */
export async function updateUserBio(db, userId, bio) {
  const query = `
    UPDATE users
    SET bio = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(bio, userId);
}

/**
 * Get user settings
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of setting objects
 */
export async function getUserSettings(db, userId) {
  const query = `
    SELECT setting_key, setting_value 
    FROM user_settings 
    WHERE userid = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(userId);
}

/**
 * Upsert user setting
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} settingKey - Setting key
 * @param {string} settingValue - Setting value
 * @returns {Promise<Object>} Result object
 */
export async function upsertUserSetting(db, userId, settingKey, settingValue) {
  const query = `
    INSERT INTO user_settings (userid, setting_key, setting_value, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (userid, setting_key) 
    DO UPDATE SET setting_value = $3, updated_at = CURRENT_TIMESTAMP
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(userId, settingKey, settingValue);
}

/**
 * Delete user setting
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} settingKey - Setting key
 * @returns {Promise<Object>} Result object
 */
export async function deleteUserSetting(db, userId, settingKey) {
  const query = `
    DELETE FROM user_settings 
    WHERE userid = $1 AND setting_key = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(userId, settingKey);
}

/**
 * Delete a setting key for all users (one-time layout / preference resets).
 *
 * @param {Database} db - Database connection
 * @param {string} settingKey - Setting key
 * @returns {Promise<Object>} Result object
 */
export async function deleteUserSettingsByKey(db, settingKey) {
  const query = `
    DELETE FROM user_settings
    WHERE setting_key = $1
  `;

  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(settingKey);
}

/**
 * Get tasks assigned to or requested by a member
 * 
 * @param {Database} db - Database connection
 * @param {string} memberId - Member ID
 * @returns {Promise<Array>} Array of task objects with id and boardid
 */
export async function getTasksForMember(db, memberId) {
  const query = `
    SELECT id, boardid as "boardId"
    FROM tasks 
    WHERE memberid = $1 OR requesterid = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(memberId);
}

/**
 * Get user with basic info (for deletion checks)
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object with id, email, first_name, last_name or null
 */
export async function getUserBasicInfo(db, userId) {
  const query = `
    SELECT id, email, first_name, last_name, avatar_path
    FROM users
    WHERE id = $1 AND is_active = true
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get all users with roles and member info (for admin)
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Array>} Array of user objects with roles and member info
 */
export async function getAllUsersWithRolesAndMembers(db) {
  const query = `
    SELECT 
      u.id, 
      u.email, 
      u.password_hash, 
      u.first_name, 
      u.last_name, 
      u.is_active, 
      u.created_at, 
      u.updated_at, 
      u.avatar_path, 
      u.auth_provider, 
      u.google_avatar_url,
      string_agg(r.name, ',') as roles,
      MAX(m.name) as member_name,
      MAX(m.color) as member_color
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    LEFT JOIN members m ON u.id = m.user_id
    GROUP BY u.id, u.email, u.password_hash, u.first_name, u.last_name, u.is_active, u.created_at, u.updated_at, u.avatar_path, u.auth_provider, u.google_avatar_url
    ORDER BY u.created_at DESC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all();
}

/**
 * Get member by ID with color
 * 
 * @param {Database} db - Database connection
 * @param {string} memberId - Member ID
 * @returns {Promise<Object|null>} Member object with id, name, color or null
 */
export async function getMemberById(db, memberId) {
  const query = `
    SELECT id, name, color 
    FROM members 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(memberId);
}

/**
 * Get member by user_id with color
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Member object with id, name, color or null
 */
export async function getMemberByUserIdWithColor(db, userId) {
  const query = `
    SELECT id, name, color 
    FROM members 
    WHERE user_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Update member color
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} color - New color (hex format)
 * @returns {Promise<Object>} Result object
 */
export async function updateMemberColor(db, userId, color) {
  const query = `
    UPDATE members 
    SET color = $1 
    WHERE user_id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(color, userId);
}

/**
 * Get user with roles
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object with role info or null
 */
export async function getUserWithRoles(db, userId) {
  const query = `
    SELECT 
      u.id, 
      u.email, 
      u.first_name, 
      u.last_name, 
      u.is_active, 
      u.created_at, 
      u.auth_provider, 
      u.google_avatar_url,
      r.name as role
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    WHERE u.id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get user by ID with all fields (for admin)
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object with all fields or null
 */
export async function getUserByIdForAdmin(db, userId) {
  const query = `
    SELECT
      id, email, first_name, last_name, is_active, auth_provider, google_avatar_url, avatar_path
    FROM users
    WHERE id = $1
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Check if email exists (excluding specific user)
 * 
 * @param {Database} db - Database connection
 * @param {string} email - Email address
 * @param {string} excludeUserId - User ID to exclude from check
 * @returns {Promise<Object|null>} Existing user or null
 */
export async function checkEmailExists(db, email, excludeUserId = null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (excludeUserId) {
    const query = `
      SELECT id FROM users 
      WHERE LOWER(email) = $1 AND id != $2
    `;
    const stmt = wrapQuery(db.prepare(query), 'SELECT');
    return await stmt.get(normalized, excludeUserId);
  } else {
    const query = `
      SELECT id FROM users 
      WHERE LOWER(email) = $1
    `;
    const stmt = wrapQuery(db.prepare(query), 'SELECT');
    return await stmt.get(normalized);
  }
}

/**
 * Create user
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID (UUID)
 * @param {string} email - Email address
 * @param {string} passwordHash - Hashed password
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @param {boolean} isActive - Whether user is active
 * @param {string} authProvider - Auth provider (default: 'local')
 * @returns {Promise<Object>} Created user object
 */
export async function createUser(db, userId, email, passwordHash, firstName, lastName, isActive, authProvider = 'local') {
  const query = `
    INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, auth_provider, activated_at) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE NULL END)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  await stmt.run(userId, email, passwordHash, firstName, lastName, Boolean(isActive), authProvider);
  
  // Return created user
  return await getUserByIdForAdmin(db, userId);
}

/**
 * Update user fields
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {Object} updates - Object with fields to update (email, firstName, lastName, isActive)
 * @returns {Promise<Object>} Updated user object
 */
export async function updateUser(db, userId, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;
  
  if (updates.email !== undefined) {
    fields.push(`email = $${paramIndex++}`);
    values.push(updates.email);
  }
  if (updates.firstName !== undefined) {
    fields.push(`first_name = $${paramIndex++}`);
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    fields.push(`last_name = $${paramIndex++}`);
    values.push(updates.lastName);
  }
  if (updates.isActive !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(updates.isActive ? true : false);
    if (updates.isActive) {
      fields.push('activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP)');
      fields.push('deactivated_at = NULL');
      fields.push('deactivated_by = NULL');
    } else {
      fields.push('deactivated_at = COALESCE(deactivated_at, CURRENT_TIMESTAMP)');
    }
  }
  
  if (fields.length === 0) {
    // No updates, just return current user
    return await getUserByIdForAdmin(db, userId);
  }
  
  values.push(userId);
  const query = `
    UPDATE users 
    SET ${fields.join(', ')} 
    WHERE id = $${paramIndex}
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  await stmt.run(...values);
  
  // Return updated user
  return await getUserByIdForAdmin(db, userId);
}

/**
 * Get user's current role
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Role name or null
 */
export async function getUserRole(db, userId) {
  const query = `
    SELECT r.name 
    FROM roles r 
    JOIN user_roles ur ON r.id = ur.role_id 
    WHERE ur.user_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(userId);
  return result?.name || null;
}

/**
 * Get role ID by name
 * 
 * @param {Database} db - Database connection
 * @param {string} roleName - Role name
 * @returns {Promise<Object|null>} Role object with id or null
 */
export async function getRoleByName(db, roleName) {
  const query = `
    SELECT id FROM roles 
    WHERE name = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(roleName);
}

/**
 * Delete user roles
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export async function deleteUserRoles(db, userId) {
  const query = `
    DELETE FROM user_roles 
    WHERE user_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(userId);
}

/**
 * Add user role
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {number} roleId - Role ID
 * @returns {Promise<Object>} Result object
 */
export async function addUserRole(db, userId, roleId) {
  const query = `
    INSERT INTO user_roles (user_id, role_id) 
    VALUES ($1, $2)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(userId, roleId);
}

/**
 * Distinct tasks linked as assignee or requester (for delete-user confirmation).
 * Do not sum separate COUNT queries — a task can match both roles.
 *
 * @param {Database} db - Database connection
 * @param {string} memberId - Member ID
 * @returns {Promise<number>} Task count
 */
export async function getTaskCountForMember(db, memberId) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE memberid = $1 OR requesterid = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(memberId);
  return Number(result?.count) || 0;
}

/**
 * Update user's updated_at timestamp
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export async function updateUserTimestamp(db, userId) {
  const query = `
    UPDATE users 
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(userId);
}

