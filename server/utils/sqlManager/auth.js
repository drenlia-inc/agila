/**
 * Authentication Query Manager
 * 
 * Centralized PostgreSQL-native queries for authentication operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/auth
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get user by email for login (active users only)
 * 
 * @param {Database} db - Database connection
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserByEmailForLogin(db, email) {
  const query = `
    SELECT * FROM users 
    WHERE LOWER(email) = LOWER($1) AND is_active = true
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(String(email || '').trim());
}

/**
 * Get all roles for a user
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of role objects with name property
 */
export async function getUserRoles(db, userId) {
  const query = `
    SELECT r.name 
    FROM roles r 
    JOIN user_roles ur ON r.id = ur.role_id 
    WHERE ur.user_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(userId);
}

/**
 * Clear force_logout flag for a user
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export async function clearForceLogout(db, userId) {
  const query = `
    UPDATE users 
    SET force_logout = false 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(userId);
}

/**
 * Get invitation by token with user info
 * 
 * @param {Database} db - Database connection
 * @param {string} token - Invitation token
 * @param {string} email - User email
 * @returns {Promise<Object|null>} Invitation object with user info or null
 */
export async function getInvitationByToken(db, token, email) {
  const query = `
    SELECT 
      ui.*, 
      u.id as user_id, 
      u.email, 
      u.first_name, 
      u.last_name, 
      u.is_active 
    FROM user_invitations ui
    JOIN users u ON ui.user_id = u.id
    WHERE ui.token = $1 AND u.email = $2 AND ui.used_at IS NULL
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(token, email);
}

/**
 * Activate user account and set password
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} passwordHash - Hashed password
 * @returns {Promise<Object>} Result object
 */
export async function activateUser(db, userId, passwordHash) {
  const query = `
    UPDATE users 
    SET is_active = true,
        password_hash = $1,
        activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP),
        deactivated_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(passwordHash, userId);
}

/**
 * Mark invitation as used
 * 
 * @param {Database} db - Database connection
 * @param {string} invitationId - Invitation ID
 * @returns {Promise<Object>} Result object
 */
export async function markInvitationAsUsed(db, invitationId) {
  // Use CURRENT_TIMESTAMP for PostgreSQL compatibility
  // For SQLite proxy, this will be converted automatically
  const query = `
    UPDATE user_invitations 
    SET used_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(invitationId);
}

/**
 * Log activity
 * 
 * @param {Database} db - Database connection
 * @param {string} action - Action name
 * @param {string} details - Action details
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export async function logActivity(db, action, details, userId) {
  const query = `
    INSERT INTO activity (action, details, userid, created_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(action, details, userId);
}

/**
 * Get user by ID with basic info (for activation)
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserBasicInfoForActivation(db, userId) {
  const query = `
    SELECT 
      u.id, 
      u.email, 
      u.first_name, 
      u.last_name, 
      u.is_active, 
      u.created_at, 
      u.auth_provider, 
      u.google_avatar_url
    FROM users u
    WHERE u.id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Check if user exists by email
 * 
 * @param {Database} db - Database connection
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object with id or null
 */
export async function checkUserExists(db, email) {
  const query = `
    SELECT id FROM users 
    WHERE LOWER(email) = LOWER($1)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(String(email || '').trim());
}

/**
 * Create a new user
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} passwordHash - Hashed password
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @returns {Promise<Object>} Result object
 */
export async function createUser(db, userId, email, passwordHash, firstName, lastName) {
  const query = `
    INSERT INTO users (id, email, password_hash, first_name, last_name) 
    VALUES ($1, $2, $3, $4, $5)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(userId, email, passwordHash, firstName, lastName);
}

/**
 * Assign role to user
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {number} roleId - Role ID
 * @returns {Promise<Object>} Result object
 */
export async function assignRoleToUser(db, userId, roleId) {
  const query = `
    INSERT INTO user_roles (user_id, role_id) 
    VALUES ($1, $2)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(userId, roleId);
}

/**
 * Create member for user
 * 
 * @param {Database} db - Database connection
 * @param {string} memberId - Member ID
 * @param {string} name - Member name
 * @param {string} color - Member color
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export async function createMemberForUser(db, memberId, name, color, userId) {
  const query = `
    INSERT INTO members (id, name, color, user_id) 
    VALUES ($1, $2, $3, $4)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(memberId, name, color, userId);
}

/**
 * Update user avatar path
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} avatarPath - Avatar path
 * @returns {Promise<Object>} Result object
 */
export async function updateUserAvatarPath(db, userId, avatarPath) {
  const query = `
    UPDATE users 
    SET avatar_path = $1 
    WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(avatarPath, userId);
}

/**
 * Get user by email (for OAuth)
 * 
 * @param {Database} db - Database connection
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserByEmail(db, email) {
  const query = `
    SELECT * FROM users 
    WHERE LOWER(email) = LOWER($1)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(String(email || '').trim());
}

/**
 * Update user auth provider and Google avatar
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} authProvider - Auth provider ('google' or 'local')
 * @param {string|null} googleAvatarUrl - Google avatar URL or null
 * @param {boolean} activate - Whether to activate the user
 * @returns {Promise<Object>} Result object
 */
export async function updateUserAuthProvider(db, userId, authProvider, googleAvatarUrl = null, activate = false) {
  let query;
  let params;
  
  if (activate) {
    query = `
      UPDATE users 
      SET is_active = true,
          auth_provider = $1, 
          google_avatar_url = $2,
          activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP),
          deactivated_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `;
    params = [authProvider, googleAvatarUrl, userId];
  } else {
    query = `
      UPDATE users 
      SET auth_provider = $1, 
          google_avatar_url = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `;
    params = [authProvider, googleAvatarUrl, userId];
  }
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(...params);
}

/**
 * Update only Google avatar URL
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @param {string} googleAvatarUrl - Google avatar URL
 * @returns {Promise<Object>} Result object
 */
export async function updateGoogleAvatarUrl(db, userId, googleAvatarUrl) {
  const query = `
    UPDATE users 
    SET google_avatar_url = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(googleAvatarUrl, userId);
}

/**
 * Delete pending invitations for a user
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export async function deletePendingInvitations(db, userId) {
  const query = `
    DELETE FROM user_invitations 
    WHERE user_id = $1 AND used_at IS NULL
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(userId);
}

/**
 * Get member info by user ID
 * 
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Member object or null
 */
export async function getMemberByUserId(db, userId) {
  const query = `
    SELECT id, name, color 
    FROM members 
    WHERE user_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(userId);
}

/**
 * Get setting value by key
 * 
 * @param {Database} db - Database connection
 * @param {string} key - Setting key
 * @returns {Promise<Object|null>} Setting object with value or null
 */
export async function getSetting(db, key) {
  const query = `
    SELECT value FROM settings 
    WHERE key = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(key);
}

/**
 * Get OAuth settings (Google SSO configuration)
 *
 * @param {Database} db - Database connection
 * @returns {Promise<Object>} Settings with GOOGLE_CLIENT_*, SERVER_DEBUG_GOOGLE_SSO (legacy GOOGLE_SSO_DEBUG merged in)
 */
export async function getOAuthSettings(db) {
  // Schema-qualify settings: unqualified FROM settings + pooled search_path has
  // leaked another tenant's GOOGLE_CALLBACK_URL into the OAuth cache (SSO redirect
  // to the wrong host, e.g. drenlia → qa1).
  const table =
    db?.schema && typeof db.schema === 'string' && db.schema !== 'public'
      ? `"${db.schema.replace(/"/g, '""')}".settings`
      : 'settings';
  const query = `
    SELECT key, value 
    FROM ${table}
    WHERE key IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const results = await stmt.all(
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'GOOGLE_SSO_MANAGED',
    'GOOGLE_SSO_MODE',
    'GOOGLE_SSO_MANAGED_ELIGIBLE',
    'SERVER_DEBUG_GOOGLE_SSO',
    'GOOGLE_SSO_DEBUG',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_CALLBACK_URL',
    'GITHUB_SSO_MODE',
    'M365_CLIENT_ID',
    'M365_CLIENT_SECRET',
    'M365_TENANT_ID',
    'M365_CALLBACK_URL',
    'M365_SSO_MODE'
  );
  
  const settingsObj = {};
  results.forEach(setting => {
    settingsObj[setting.key] = setting.value;
  });

  // Prefer SERVER_DEBUG_GOOGLE_SSO; fall back to legacy GOOGLE_SSO_DEBUG until migrated away
  const debugOn =
    settingsObj.SERVER_DEBUG_GOOGLE_SSO === 'true' || settingsObj.GOOGLE_SSO_DEBUG === 'true';
  settingsObj.SERVER_DEBUG_GOOGLE_SSO = debugOn ? 'true' : 'false';

  const secretKeys = ['GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'M365_CLIENT_SECRET'];
  for (const secretKey of secretKeys) {
    if (!settingsObj[secretKey]) continue;
    try {
      const { decryptSettingValue } = await import('../../utils/secretCrypto.js');
      settingsObj[secretKey] = decryptSettingValue(settingsObj[secretKey]);
    } catch (err) {
      console.error(`Failed to decrypt ${secretKey}:`, err.message);
      settingsObj[secretKey] = '';
    }
  }
  
  return settingsObj;
}

/**
 * Check if user exists by email (simple check)
 * 
 * @param {Database} db - Database connection
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object with id or null
 */
export async function checkUserExistsByEmail(db, email) {
  const query = `
    SELECT id FROM users 
    WHERE LOWER(email) = LOWER($1)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(String(email || '').trim());
}
