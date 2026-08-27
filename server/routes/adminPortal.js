// Admin Portal API Routes
// These endpoints allow external admin portal access using INSTANCE_TOKEN

import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { authenticateAdminPortal, adminPortalRateLimit } from '../middleware/adminAuth.js';
import { wrapQuery } from '../utils/queryLogger.js';
import notificationService from '../services/notificationService.js';
import { getLicenseManager } from '../config/license.js';
import { getTranslator } from '../utils/i18n.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
import { getTenantDomain } from '../utils/tenantDomain.js';
import { clearSqlDebugSettingsCache } from '../utils/sqlDebugSettingsCache.js';
// MIGRATED: Import sqlManager modules
import { users as userQueries, settings as settingsQueries, licenseSettings as licenseSettingsQueries, auth as authQueries, adminUsers as adminUserQueries, helpers, health as healthQueries } from '../utils/sqlManager/index.js';
import { isSecretSettingKey, SECRET_SETTING_PLACEHOLDER } from '../constants/secretSettings.js';
import {
  projectSecretForAdminApi,
  upsertSecretSetting
} from '../utils/settingsSecrets.js';
import { deleteAvatarFileIfUnused } from '../utils/avatarCleanup.js';
import { getRequestStoragePaths } from '../services/storage/index.js';
import { getObject, filenameFromPublicUrl, purgeManagedTenantObjects } from '../services/storage/objectStorage.js';
import path from 'path';

const router = express.Router();

// Apply rate limiting to all admin portal routes
router.use(adminPortalRateLimit);

// OPTIONS requests are now handled by nginx - disable Express OPTIONS handler to avoid duplicate headers
// router.options('*', (req, res) => {
//   console.log('🔍 OPTIONS request received for:', req.path);
//   console.log('🔍 Origin:', req.headers.origin);
//   res.header('Access-Control-Allow-Origin', req.headers.origin);
//   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   res.status(200).end();
// });

// ================================
// INSTANCE INFORMATION
// ================================

// Get instance information
router.get('/info', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    
    // MIGRATED: Read APP_URL from database settings using sqlManager
    const appUrlSetting = await helpers.getSetting(db, 'APP_URL');
    
    // In multi-tenant mode, get tenant ID from hostname
    const hostname = req.get('host') || req.hostname;
    const tenantId = req.tenantId || null;
    
    const instanceInfo = {
      instanceName: process.env.INSTANCE_NAME || 'easy-kanban-app',
      instanceToken: process.env.INSTANCE_TOKEN ? 'configured' : 'not-configured',
      domain: appUrlSetting || 'not-configured',
      hostname: hostname,
      tenantId: tenantId, // Include tenant ID in multi-tenant mode
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: instanceInfo
    });
  } catch (error) {
    console.error('Error fetching instance info:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToFetchInstanceInformation') 
    });
  }
});


// ================================
// INSTANCE OWNER MANAGEMENT
// ================================

// Get instance owner information
router.get('/owner-info', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get OWNER setting using sqlManager
    const ownerSetting = await helpers.getSetting(db, 'OWNER');
    const ownerEmail = ownerSetting || null;
    
    res.json({
      success: true,
      data: {
        owner: ownerEmail,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching owner info:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToFetchOwnerInformation') 
    });
  }
});

// Set instance owner (admin portal only)
router.put('/owner', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { email } = req.body;
    const t = await getTranslator(db);
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.ownerEmailRequired') 
      });
    }
    
    // MIGRATED: Validate that the user exists using sqlManager
    const user = await userQueries.getUserByEmail(db, email);
    if (!user) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.userWithEmailDoesNotExist') 
      });
    }
    
    // MIGRATED: Set owner in settings using sqlManager
    await settingsQueries.upsertSettingWithTimestamp(db, 'OWNER', email, new Date().toISOString());
    
    console.log(`✅ Admin portal set instance owner to: ${email}`);

    const tenantIdOwner = getTenantId(req);
    await notificationService.publish(
      'settings-updated',
      { key: 'OWNER', value: email, timestamp: new Date().toISOString() },
      tenantIdOwner
    ).catch((err) => console.error('Failed to publish settings-updated (OWNER):', err));
    
    res.json({
      success: true,
      data: {
        owner: email,
        message: t('success.instanceOwnerSetSuccessfully'),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error setting instance owner:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToSetInstanceOwner') 
    });
  }
});

/**
 * Permanently delete all objects under this tenant's managed S3 prefix.
 * Used by the admin portal before DROP SCHEMA on instance destroy.
 * Skips when STORAGE_MANAGED is not true (custom buckets are left alone).
 */
router.post('/storage/purge-managed', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const tenantId = getTenantId(req) || req.tenantId || null;
    const result = await purgeManagedTenantObjects(db, { tenantId });
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error purging managed tenant storage:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to purge managed storage'
    });
  }
});

/**
 * Migrate local/NFS staged objects into S3 after managed storage is configured.
 * Used by agila-admin post-deploy so seed avatars (disk-only at DB init) land in the bucket.
 */
router.post('/storage/migrate-disk-to-s3', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { startStorageMigration, getRequestStoragePaths } = await import('../services/storage/index.js');
    const storagePaths = getRequestStoragePaths(req);
    const deleteSource = req.body?.deleteSource === true;
    const result = await startStorageMigration(db, storagePaths, 'disk-to-s3', { deleteSource });
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error starting disk-to-s3 migration:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start storage migration'
    });
  }
});

/**
 * Ensure EN/FR welcome tasks exist and assign them to the owner member.
 * Body: { email?: string } — defaults to OWNER setting.
 */
router.post('/onboarding/welcome-tasks', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { seedWelcomeTasks, reassignWelcomeTasksToMember } = await import('../config/welcomeTasks.js');

    let ownerEmail = (req.body?.email || '').trim().toLowerCase();
    if (!ownerEmail) {
      ownerEmail = String((await helpers.getSetting(db, 'OWNER')) || '').trim().toLowerCase();
    }

    let assigneeMemberId = null;
    if (ownerEmail) {
      const ownerUser = await userQueries.getUserByEmail(db, ownerEmail);
      if (ownerUser) {
        const ownerMember = await userQueries.getMemberByUserId(db, ownerUser.id);
        assigneeMemberId = ownerMember?.id || null;
      }
    }

    const board = await wrapQuery(
      db.prepare('SELECT id FROM boards ORDER BY position ASC, created_at ASC LIMIT 1'),
      'SELECT'
    ).get();
    if (!board) {
      return res.status(404).json({
        success: false,
        error: 'No board found'
      });
    }

    const columns = await wrapQuery(
      db.prepare('SELECT id, title, position FROM columns WHERE boardid = ? ORDER BY position ASC'),
      'SELECT'
    ).all(board.id);

    const seedResult = await seedWelcomeTasks(db, board.id, columns, {
      assigneeMemberId: assigneeMemberId || undefined
    });

    let reassigned = 0;
    if (assigneeMemberId) {
      reassigned = await reassignWelcomeTasksToMember(db, assigneeMemberId);
    }

    res.json({
      success: true,
      data: {
        ...seedResult,
        reassigned,
        assigneeMemberId,
        ownerEmail: ownerEmail || null
      }
    });
  } catch (error) {
    console.error('Error seeding welcome tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to seed welcome tasks'
    });
  }
});

// Get all settings
router.get('/settings', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get all settings using sqlManager
    const settings = await settingsQueries.getAllSettings(db);
    const settingsObj = {};
    settings.forEach(setting => {
      if (isSecretSettingKey(setting.key)) {
        projectSecretForAdminApi(setting.key, setting.value, settingsObj);
      } else {
        settingsObj[setting.key] = setting.value;
      }
    });
    
    res.json({
      success: true,
      data: settingsObj
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToFetchSettings') 
    });
  }
});

// Update a single setting
router.put('/settings/:key', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { key } = req.params;
    const { value } = req.body;
    
    const t = await getTranslator(db);
    
    if (value === undefined || value === null) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.settingValueRequired') 
      });
    }
    
    // MIGRATED: Upsert setting using sqlManager (encrypt secrets at rest)
    let responseValue = value;
    let responseExtra = {};
    if (isSecretSettingKey(key)) {
      const upsert = await upsertSecretSetting(db, key, value);
      responseValue = upsert.hasValue ? SECRET_SETTING_PLACEHOLDER : '';
      responseExtra[`${key}_SET`] = upsert.hasValue;
    } else {
      await settingsQueries.upsertSetting(db, key, value);
    }
    if (key === 'SERVER_DEBUG_SQL') {
      clearSqlDebugSettingsCache();
    }

    console.log(`✅ Admin portal updated setting: ${key}`);

    const tenantIdSetting = getTenantId(req);
    await notificationService.publish(
      'settings-updated',
      {
        key,
        value: responseValue,
        ...responseExtra,
        timestamp: new Date().toISOString()
      },
      tenantIdSetting
    ).catch((err) => console.error('Failed to publish settings-updated:', err));
    
    res.json({
      success: true,
      message: t('success.settingUpdatedSuccessfully'),
      data: { key, value: responseValue, ...responseExtra }
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToUpdateSetting') 
    });
  }
});

// Update multiple settings
router.put('/settings', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const settings = req.body;
    
    const t = await getTranslator(db);
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ 
        success: false,
        error: t('errors.settingsObjectRequired') 
      });
    }
    
    const results = [];
    
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && value !== null) {
        let publishValue = value;
        const publishExtra = {};
        if (isSecretSettingKey(key)) {
          const upsert = await upsertSecretSetting(db, key, value);
          publishValue = upsert.hasValue ? SECRET_SETTING_PLACEHOLDER : '';
          publishExtra[`${key}_SET`] = upsert.hasValue;
        } else {
          await settingsQueries.upsertSetting(db, key, value);
        }
        if (key === 'SERVER_DEBUG_SQL') {
          clearSqlDebugSettingsCache();
        }

        results.push({ key, value: publishValue, ...publishExtra });
        console.log(`✅ Admin portal updated setting: ${key}`);
      }
    }

    const tenantIdBulk = getTenantId(req);
    for (const row of results) {
      await notificationService.publish(
        'settings-updated',
        { ...row, timestamp: new Date().toISOString() },
        tenantIdBulk
      ).catch((err) => console.error(`Failed to publish settings-updated (${row.key}):`, err));
    }
    
    res.json({
      success: true,
      message: t('success.settingsUpdatedSuccessfully', { count: results.length }),
      data: results
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToUpdateSettings') 
    });
  }
});

// ================================
// USER MANAGEMENT
// ================================

// Get all users
router.get('/users', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const usersRaw = await userQueries.getAllUsersWithRolesAndMembers(db);

    const formattedUsers = usersRaw.map((user) => {
      const firstName = user.first_name || '';
      const lastName = user.last_name || '';
      const displayName =
        (user.member_name && String(user.member_name).trim()) ||
        `${firstName} ${lastName}`.trim() ||
        user.email;
      return {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        displayName,
        isActive: Boolean(user.is_active),
        roles: user.roles ? String(user.roles).split(',').filter(Boolean) : [],
        createdAt: user.created_at,
        authProvider: user.auth_provider || 'local',
        googleAvatarUrl: user.google_avatar_url || null,
        hasLocalAvatar: Boolean(user.avatar_path)
      };
    });

    res.json({
      success: true,
      data: formattedUsers
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    res.status(500).json({
      success: false,
      error: t('errors.failedToFetchUsers')
    });
  }
});

// Stream user avatar (INSTANCE_TOKEN auth — for admin portal cross-origin <img>)
router.get('/users/:userId/avatar', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { userId } = req.params;
    const user = await userQueries.getUserByIdForAdmin(db, userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (user.google_avatar_url) {
      return res.redirect(302, user.google_avatar_url);
    }

    const avatarPath = user.avatar_path || user.avatarPath;
    if (!avatarPath) {
      return res.status(404).json({ success: false, error: 'No avatar' });
    }

    const filename = filenameFromPublicUrl(avatarPath, 'avatars') || path.basename(String(avatarPath));
    const storagePaths = getRequestStoragePaths(req);
    const obj = await getObject(db, storagePaths, 'avatars', filename);
    if (!obj) {
      return res.status(404).json({ success: false, error: 'Avatar file not found' });
    }

    res.setHeader('Content-Type', obj.contentType || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(obj.buffer);
  } catch (error) {
    console.error('Error serving admin-portal user avatar:', error);
    res.status(500).json({ success: false, error: 'Failed to load avatar' });
  }
});

// Create a new user
router.post('/users', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { email, password, firstName, lastName, role, sendInvitation = true, isActive = false } = req.body;
    
    // Validate required fields
    if (!email || !password || !firstName || !lastName || !role) {
      const t = await getTranslator(db);
      return res.status(400).json({ 
        success: false,
        error: t('errors.emailPasswordFirstNameLastNameRoleRequired') 
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const t = await getTranslator(db);
      return res.status(400).json({ 
        success: false,
        error: t('errors.invalidEmailAddressFormat') 
      });
    }
    
    // MIGRATED: Check if email already exists using sqlManager
    const existingUser = await userQueries.checkEmailExists(db, email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.userWithEmailAlreadyExists') 
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // MIGRATED: Create user using sqlManager
    const userId = crypto.randomUUID();
    await userQueries.createUser(db, userId, email, passwordHash, firstName, lastName, isActive, 'local');
    
    // MIGRATED: Assign role using sqlManager
    const roleObj = await userQueries.getRoleByName(db, role);
    if (roleObj) {
      await userQueries.addUserRole(db, userId, roleObj.id);
    }
    
    // Create member for the user
    const memberId = crypto.randomUUID();
    const memberColor = '#4ECDC4'; // Default color
    // Ensure member name doesn't exceed 30 characters
    let memberName = `${firstName} ${lastName}`.trim();
    if (memberName.length > 30) {
      memberName = memberName.substring(0, 30);
    }
    // MIGRATED: Create member using auth.createMemberForUser
    await authQueries.createMemberForUser(db, memberId, memberName, memberColor, userId);
    
    // Publish to Redis for real-time updates
    const tenantId = getTenantId(req);
    console.log('📤 Publishing user-created and member-created to Redis for admin portal');
    await notificationService.publish('user-created', {
      user: { 
        id: userId, 
        email, 
        firstName, 
        lastName, 
        role, 
        isActive: !!isActive,
        displayName: memberName,
        memberColor: memberColor,
        authProvider: 'local',
        createdAt: new Date().toISOString(),
        joined: new Date().toISOString()
      },
      member: { id: memberId, name: memberName, color: memberColor },
      timestamp: new Date().toISOString()
    }, tenantId).catch(err => {
      console.error('Failed to publish user-created event:', err);
    });
    
    await notificationService.publish('member-created', {
      member: {
        id: memberId,
        name: memberName,
        color: memberColor,
        userId: userId
      },
      timestamp: new Date().toISOString()
    }, tenantId).catch(err => {
      console.error('Failed to publish member-created event:', err);
    });
    
    console.log(`✅ Admin portal created user: ${email} (${firstName} ${lastName})`);
    
    const t = await getTranslator(db);
    res.json({
      success: true,
      message: t('success.userCreatedSuccessfully'),
      data: {
        id: userId,
        email,
        firstName,
        lastName,
        role,
        isActive: !!isActive
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    try {
      const db = getRequestDatabase(req);
      const t = await getTranslator(db);
      res.status(500).json({ 
        success: false,
        error: t('errors.failedToCreateUser') 
      });
    } catch (fallbackError) {
      res.status(500).json({ 
        success: false,
        error: 'Failed to create user' 
      });
    }
  }
});

// Update user (single handler — keeps member display name in sync and publishes realtime events)
router.put('/users/:userId', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { userId } = req.params;
    const { email, firstName, lastName, role, isActive, displayName: displayNameBody } = req.body;
    const t = await getTranslator(db);

    const existingUser = await userQueries.getUserByIdForAdmin(db, userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: t('errors.userNotFound')
      });
    }

    const effectiveEmail = email !== undefined ? email : existingUser.email;
    const effectiveFirst = firstName !== undefined ? firstName : existingUser.first_name;
    const effectiveLast = lastName !== undefined ? lastName : existingUser.last_name;
    const effectiveActive = isActive !== undefined ? isActive : Boolean(existingUser.is_active);

    if (!effectiveEmail || !effectiveFirst || !effectiveLast) {
      return res.status(400).json({
        success: false,
        error: t('errors.emailFirstNameLastNameRequired')
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(effectiveEmail))) {
      return res.status(400).json({
        success: false,
        error: t('errors.invalidEmailAddressFormat')
      });
    }

    const emailChanged = String(effectiveEmail).trim() !== String(existingUser.email || '').trim();
    if (emailChanged) {
      const emailTaken = await userQueries.checkEmailExists(db, effectiveEmail, userId);
      if (emailTaken) {
        return res.status(400).json({
          success: false,
          error: t('errors.emailAlreadyTakenByAnotherUser')
        });
      }
    }

    await userQueries.updateUser(db, userId, {
      email: effectiveEmail,
      firstName: effectiveFirst,
      lastName: effectiveLast,
      isActive: effectiveActive
    });

    let roleChanged = false;
    if (role !== undefined) {
      const currentRole = await userQueries.getUserRole(db, userId);
      if (currentRole !== role) {
        roleChanged = true;
        await userQueries.deleteUserRoles(db, userId);
        const roleObj = await userQueries.getRoleByName(db, role);
        if (roleObj) {
          await userQueries.addUserRole(db, userId, roleObj.id);
        }
      }
    }

    const memberRow = await userQueries.getMemberByUserIdWithColor(db, userId);
    let displayName =
      displayNameBody !== undefined && String(displayNameBody).trim()
        ? String(displayNameBody).trim()
        : `${effectiveFirst} ${effectiveLast}`.trim();
    if (displayName.length > 30) {
      displayName = displayName.substring(0, 30);
    }
    if (memberRow) {
      await userQueries.updateMemberName(db, userId, displayName);
    }

    const updatedUser = await userQueries.getUserByIdForAdmin(db, userId);
    const userRolesResult = await userQueries.getUserRole(db, userId);
    const rolesArray = userRolesResult ? [userRolesResult] : [];

    const tenantId = getTenantId(req);
    console.log('📤 Publishing user-updated for admin portal user update');
    await notificationService.publish('user-updated', {
      user: {
        id: updatedUser.id,
        email: updatedUser.email || effectiveEmail,
        firstName: updatedUser.first_name || effectiveFirst,
        lastName: updatedUser.last_name || effectiveLast,
        isActive: Boolean(updatedUser.is_active),
        authProvider: updatedUser.auth_provider || null,
        googleAvatarUrl: updatedUser.google_avatar_url || null,
        createdAt: updatedUser.created_at,
        joined: updatedUser.created_at
      },
      timestamp: new Date().toISOString()
    }, tenantId).catch((err) => {
      console.error('Failed to publish user-updated event:', err);
    });

    if (roleChanged && role !== undefined) {
      console.log('📤 Publishing user-role-updated for admin portal role change');
      await notificationService.publish('user-role-updated', {
        userId,
        role,
        timestamp: new Date().toISOString()
      }, tenantId).catch((err) => {
        console.error('Failed to publish user-role-updated event:', err);
      });
    }

    if (memberRow) {
      const memberAfter = await userQueries.getMemberByUserIdWithColor(db, userId);
      if (memberAfter) {
        await notificationService.publish('member-updated', {
          memberId: memberAfter.id,
          member: { id: memberAfter.id, name: memberAfter.name, color: memberAfter.color },
          timestamp: new Date().toISOString()
        }, tenantId).catch((err) => {
          console.error('Failed to publish member-updated event:', err);
        });
      }
    }

    console.log(`✅ Admin portal updated user: ${userId}`);

    res.json({
      success: true,
      message: t('success.userUpdatedSuccessfully'),
      data: {
        id: updatedUser.id,
        email: updatedUser.email || effectiveEmail,
        firstName: updatedUser.first_name || effectiveFirst,
        lastName: updatedUser.last_name || effectiveLast,
        displayName,
        roles: rolesArray,
        isActive: Boolean(updatedUser.is_active),
        authProvider: updatedUser.auth_provider || 'local',
        googleAvatarUrl: updatedUser.google_avatar_url || null,
        hasLocalAvatar: Boolean(updatedUser.avatar_path || updatedUser.avatarPath),
        createdAt: updatedUser.created_at
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    try {
      const db = getRequestDatabase(req);
      const tr = await getTranslator(db);
      res.status(500).json({
        success: false,
        error: tr('errors.failedToUpdateUser')
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: 'Failed to update user'
      });
    }
  }
});

// Delete user (reassign tasks to System first — same as /api/users delete)
router.delete('/users/:userId', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { userId } = req.params;
    const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
    const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001';

    const t = await getTranslator(db);

    const user = await userQueries.getUserByIdForAdmin(db, userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: t('errors.userNotFound')
      });
    }

    const userMember = await userQueries.getMemberByUserId(db, userId);

    const existingSystemMember = await userQueries.getMemberById(db, SYSTEM_MEMBER_ID);
    if (!existingSystemMember) {
      await adminUserQueries.createSystemMember(db, SYSTEM_MEMBER_ID, SYSTEM_USER_ID);
    }

    await adminUserQueries.deleteUserActivity(db, userId);
    await userQueries.deleteUserRoles(db, userId);
    await adminUserQueries.deleteUserInvitations(db, userId);

    if (userMember) {
      await adminUserQueries.reassignTasksToSystemMember(db, SYSTEM_MEMBER_ID, userMember.id);
      await adminUserQueries.reassignTaskRequestersToSystemMember(db, SYSTEM_MEMBER_ID, userMember.id);
      await adminUserQueries.deleteMemberByUserId(db, userId);
    }

    await adminUserQueries.deleteUser(db, userId);

    await deleteAvatarFileIfUnused(
      db,
      getRequestStoragePaths(req),
      user.avatar_path || user.avatarPath
    );

    console.log(`✅ Admin portal deleted user: ${userId} (${user.email})`);

    const tenantIdDel = getTenantId(req);
    if (userMember) {
      await notificationService.publish('member-deleted', {
        memberId: userMember.id,
        timestamp: new Date().toISOString()
      }, tenantIdDel).catch((err) => console.error('Failed to publish member-deleted:', err));
    }
    await notificationService.publish('user-deleted', {
      userId,
      user: {
        id: userId,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        isActive: !!user.is_active,
        authProvider: user.auth_provider
      },
      timestamp: new Date().toISOString()
    }, tenantIdDel).catch((err) => console.error('Failed to publish user-deleted:', err));

    res.json({
      success: true,
      message: t('success.userDeletedSuccessfully')
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    try {
      const dbErr = getRequestDatabase(req);
      const t = await getTranslator(dbErr);
      res.status(500).json({
        success: false,
        error: t('errors.failedToDeleteUser')
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete user'
      });
    }
  }
});

// ================================
// HEALTH CHECK
// ================================

// Health check endpoint
router.get('/health', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // Real connectivity check — do not infer from APP_URL (often unset on new tenants)
    const dbCheck = await healthQueries.checkDatabaseConnection(db);

    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      instanceToken: 'configured'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// ================================
// PLAN MANAGEMENT
// ================================

// Get plan information and limits
router.get('/plan', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // Get LicenseManager instance
    const licenseManager = getLicenseManager(db);
    
    console.log('🔍 LicenseManager created, checking license info...');
    
    // Get actual license information with current usage
    const licenseInfo = await licenseManager.getLicenseInfo();
    console.log('🔍 License info:', JSON.stringify(licenseInfo, null, 2));
    
    if (!licenseInfo.enabled) {
      const isDemoMode = process.env.DEMO_ENABLED === 'true';
      return res.json({
        success: true,
        data: {
          plan: 'unlimited',
          message: isDemoMode 
            ? 'Licensing disabled (demo mode - resets hourly)'
            : 'Licensing disabled (self-hosted mode)',
          features: []
        }
      });
    }

    if (!licenseInfo.limits) {
      return res.json({
        success: true,
        data: {
          plan: 'unlimited',
          message: 'No limits configured',
          features: []
        }
      });
    }

    const isMultiTenant = process.env.MULTI_TENANT === 'true';
    
    // Get database values from license_settings table
    const dbSettings = {};
    try {
      // MIGRATED: Get all license settings using sqlManager
      const licenseSettings = await licenseSettingsQueries.getAllLicenseSettings(db);
      licenseSettings.forEach(setting => {
        let key = setting.settingKey;
        if (key === 'SUPPORT_TYPE') key = 'SUPPORT_LEVEL';
        if (['USER_LIMIT', 'TASK_LIMIT', 'BOARD_LIMIT', 'STORAGE_LIMIT', 'WEBHOOK_LIMIT', 'SUPPORT_LEVEL', 'AI_TIER'].includes(key)) {
          // Parse numeric values, keep string values as-is
          if (key === 'SUPPORT_LEVEL' || key === 'AI_TIER') {
            dbSettings[key] = setting.settingValue;
          } else {
            dbSettings[key] = parseInt(setting.settingValue, 10);
          }
        }
      });
    } catch (error) {
      console.warn('License settings table not found or accessible:', error.message);
    }

    // Format storage size for display
    const formatBytes = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // In multi-tenant mode, database values are the source of truth
    // In single-tenant mode, licenseInfo.limits already merges db with env vars
    // For display purposes, prioritize database values when available
    const getDisplayValue = (key) => {
      if (isMultiTenant) {
        // In multi-tenant mode, always use database value if available
        return dbSettings[key] !== undefined ? dbSettings[key] : licenseInfo.limits[key];
      } else {
        // In single-tenant mode, licenseInfo.limits already has the merged value
        return licenseInfo.limits[key];
      }
    };

    const planInfo = {
      plan: getDisplayValue('SUPPORT_LEVEL') || 'basic',
      usage: licenseInfo.usage,
      limitsReached: licenseInfo.limitsReached,
      // For backward compatibility, also include the limits object with display values
      limits: {
        USER_LIMIT: getDisplayValue('USER_LIMIT'),
        TASK_LIMIT: getDisplayValue('TASK_LIMIT'),
        BOARD_LIMIT: getDisplayValue('BOARD_LIMIT'),
        STORAGE_LIMIT: getDisplayValue('STORAGE_LIMIT'),
        WEBHOOK_LIMIT: getDisplayValue('WEBHOOK_LIMIT'),
        SUPPORT_LEVEL: getDisplayValue('SUPPORT_LEVEL'),
        AI_TIER: getDisplayValue('AI_TIER')
      },
      features: [
        {
          key: 'USER_LIMIT',
          value: getDisplayValue('USER_LIMIT'),
          inMemory: isMultiTenant ? null : licenseInfo.limits.USER_LIMIT, // Only show in-memory in single-tenant
          database: dbSettings.USER_LIMIT !== undefined ? dbSettings.USER_LIMIT : null,
          currentUsage: licenseInfo.usage.users,
          limitReached: licenseInfo.limitsReached.users
        },
        {
          key: 'TASK_LIMIT',
          value: getDisplayValue('TASK_LIMIT'),
          inMemory: isMultiTenant ? null : licenseInfo.limits.TASK_LIMIT,
          database: dbSettings.TASK_LIMIT !== undefined ? dbSettings.TASK_LIMIT : null,
          currentUsage: licenseInfo.usage.totalTasks,
          limitReached: false // Task limit is per board, not global
        },
        {
          key: 'BOARD_LIMIT',
          value: getDisplayValue('BOARD_LIMIT'),
          inMemory: isMultiTenant ? null : licenseInfo.limits.BOARD_LIMIT,
          database: dbSettings.BOARD_LIMIT !== undefined ? dbSettings.BOARD_LIMIT : null,
          currentUsage: licenseInfo.usage.boards,
          limitReached: licenseInfo.limitsReached.boards
        },
        {
          key: 'STORAGE_LIMIT',
          value: getDisplayValue('STORAGE_LIMIT'),
          inMemory: isMultiTenant ? null : licenseInfo.limits.STORAGE_LIMIT,
          database: dbSettings.STORAGE_LIMIT !== undefined ? dbSettings.STORAGE_LIMIT : null,
          currentUsage: licenseInfo.usage.storage,
          currentUsageFormatted: formatBytes(licenseInfo.usage.storage),
          limitReached: licenseInfo.limitsReached.storage
        },
        {
          key: 'WEBHOOK_LIMIT',
          value: getDisplayValue('WEBHOOK_LIMIT'),
          inMemory: isMultiTenant ? null : licenseInfo.limits.WEBHOOK_LIMIT,
          database: dbSettings.WEBHOOK_LIMIT !== undefined ? dbSettings.WEBHOOK_LIMIT : null,
          currentUsage: licenseInfo.usage.webhooks,
          limitReached: licenseInfo.limitsReached.webhooks
        },
        {
          key: 'SUPPORT_LEVEL',
          value: getDisplayValue('SUPPORT_LEVEL'),
          inMemory: isMultiTenant ? null : licenseInfo.limits.SUPPORT_LEVEL,
          database: dbSettings.SUPPORT_LEVEL !== undefined ? dbSettings.SUPPORT_LEVEL : null
        },
        {
          key: 'AI_TIER',
          value: getDisplayValue('AI_TIER'),
          inMemory: isMultiTenant ? null : licenseInfo.limits?.AI_TIER,
          database: dbSettings.AI_TIER !== undefined ? dbSettings.AI_TIER : null
        }
      ],
      boardTaskCounts: licenseInfo.boardTaskCounts
    };

    res.json({
      success: true,
      data: planInfo
    });
  } catch (error) {
    console.error('Error fetching plan info:', error);
    
    const isMultiTenant = process.env.MULTI_TENANT === 'true';
    
    // In multi-tenant mode, never fallback to environment variables
    // Each tenant must have their license settings in the database
    if (isMultiTenant) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch license information. License settings must be configured in the database for this tenant.',
        message: 'In multi-tenant mode, license settings are tenant-specific and must be stored in the database.'
      });
    }
    
    // Fallback to environment variables only in single-tenant mode
    console.log('🔄 Falling back to environment variables (single-tenant mode)...');
    const fallbackLimits = {
      USER_LIMIT: parseInt(process.env.USER_LIMIT) || 5,
      TASK_LIMIT: parseInt(process.env.TASK_LIMIT) || 100,
      BOARD_LIMIT: parseInt(process.env.BOARD_LIMIT) || 10,
      STORAGE_LIMIT: parseInt(process.env.STORAGE_LIMIT) || 1073741824,
      SUPPORT_LEVEL: process.env.SUPPORT_LEVEL || 'basic'
    };

    const fallbackInfo = {
      plan: fallbackLimits.SUPPORT_LEVEL,
      features: [
        {
          key: 'USER_LIMIT',
          inMemory: fallbackLimits.USER_LIMIT,
          database: null,
          currentUsage: 'N/A',
          limitReached: false
        },
        {
          key: 'TASK_LIMIT',
          inMemory: fallbackLimits.TASK_LIMIT,
          database: null,
          currentUsage: 'N/A',
          limitReached: false
        },
        {
          key: 'BOARD_LIMIT',
          inMemory: fallbackLimits.BOARD_LIMIT,
          database: null,
          currentUsage: 'N/A',
          limitReached: false
        },
        {
          key: 'STORAGE_LIMIT',
          inMemory: fallbackLimits.STORAGE_LIMIT,
          database: null,
          currentUsage: 'N/A',
          currentUsageFormatted: 'N/A',
          limitReached: false
        },
        {
          key: 'SUPPORT_LEVEL',
          inMemory: fallbackLimits.SUPPORT_LEVEL,
          database: null
        }
      ]
    };

    res.json({
      success: true,
      data: fallbackInfo,
      warning: 'Using fallback data - LicenseManager failed'
    });
  }
});

// Update plan setting
router.put('/plan/:key', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { key } = req.params;
    const { value } = req.body;

    const t = await getTranslator(db);
    
    // Validate key
    const allowedKeys = ['USER_LIMIT', 'TASK_LIMIT', 'BOARD_LIMIT', 'STORAGE_LIMIT', 'WEBHOOK_LIMIT', 'SUPPORT_LEVEL', 'AI_TIER'];
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.invalidPlanSettingKey') 
      });
    }

    // Validate value based on key type
    if (key !== 'SUPPORT_LEVEL' && key !== 'AI_TIER' && value !== null) {
      const numValue = parseInt(value);
      if (isNaN(numValue) || numValue < -1) {
        return res.status(400).json({ 
          success: false,
          error: t('errors.valueMustBePositiveNumber') 
        });
      }
    }

    // MIGRATED: Update or insert license setting using sqlManager
    await licenseSettingsQueries.upsertLicenseSetting(db, key, value);

    console.log(`✅ Admin portal updated plan setting: ${key} = ${value}`);

    res.json({
      success: true,
      message: t('success.planSettingUpdatedSuccessfully'),
      data: { key, value }
    });
  } catch (error) {
    console.error('Error updating plan setting:', error);
    try {
      const db = getRequestDatabase(req);
      const t = await getTranslator(db);
      res.status(500).json({ 
        success: false,
        error: t('errors.failedToUpdatePlanSetting') 
      });
    } catch (fallbackError) {
      res.status(500).json({ 
        success: false,
        error: 'Failed to update plan setting' 
      });
    }
  }
});

// Delete plan setting (remove database override)
router.delete('/plan/:key', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { key } = req.params;

    const t = await getTranslator(db);
    
    // Validate key
    const allowedKeys = ['USER_LIMIT', 'TASK_LIMIT', 'BOARD_LIMIT', 'STORAGE_LIMIT', 'WEBHOOK_LIMIT', 'SUPPORT_LEVEL', 'AI_TIER'];
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.invalidPlanSettingKey') 
      });
    }

    // MIGRATED: Delete the license setting using sqlManager
    const result = await licenseSettingsQueries.deleteLicenseSetting(db, key);

    if (result.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: t('errors.planSettingNotFound') 
      });
    }

    console.log(`✅ Admin portal deleted plan setting override: ${key}`);

    res.json({
      success: true,
      message: t('success.planSettingOverrideDeletedSuccessfully'),
      data: { key }
    });
  } catch (error) {
    console.error('Error deleting plan setting:', error);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToDeletePlanSetting') 
    });
  }
});

// ================================
// ENHANCED SETTINGS MANAGEMENT
// ================================

// Delete a setting
router.delete('/settings/:key', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { key } = req.params;

    const t = await getTranslator(db);
    // MIGRATED: Delete setting using sqlManager
    const result = await settingsQueries.deleteSetting(db, key);
    
    if (result.changes === 0) {
      return res.status(404).json({ 
        success: false,
        error: t('errors.settingNotFound') 
      });
    }

    console.log(`✅ Admin portal deleted setting: ${key}`);

    const tenantIdDelSetting = getTenantId(req);
    await notificationService.publish(
      'settings-updated',
      { key, value: null, timestamp: new Date().toISOString() },
      tenantIdDelSetting
    ).catch((err) => console.error('Failed to publish settings-updated (delete):', err));

    res.json({
      success: true,
      message: t('success.settingDeletedSuccessfully')
    });
  } catch (error) {
    console.error('Error deleting setting:', error);
    try {
      const db = getRequestDatabase(req);
      const t = await getTranslator(db);
      res.status(500).json({ 
        success: false,
        error: t('errors.failedToDeleteSetting') 
      });
    } catch (fallbackError) {
      res.status(500).json({ 
        success: false,
        error: 'Failed to delete setting' 
      });
    }
  }
});

// Add a new setting
router.post('/settings', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { key, value } = req.body;

    const t = await getTranslator(db);
    
    if (!key || value === undefined) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.keyAndValueRequired') 
      });
    }

    // MIGRATED: Check if setting already exists using sqlManager
    const existingSetting = await settingsQueries.checkSettingExists(db, key);
    if (existingSetting) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.settingWithKeyAlreadyExists') 
      });
    }

    // MIGRATED: Insert new setting using sqlManager
    await settingsQueries.createSetting(db, key, value);

    console.log(`✅ Admin portal created setting: ${key} = ${value}`);

    const tenantIdCreateSetting = getTenantId(req);
    await notificationService.publish(
      'settings-updated',
      { key, value, timestamp: new Date().toISOString() },
      tenantIdCreateSetting
    ).catch((err) => console.error('Failed to publish settings-updated (create):', err));

    res.json({
      success: true,
      message: t('success.settingCreatedSuccessfully'),
      data: { key, value }
    });
  } catch (error) {
    console.error('Error creating setting:', error);
    try {
      const db = getRequestDatabase(req);
      const t = await getTranslator(db);
      res.status(500).json({ 
        success: false,
        error: t('errors.failedToCreateSetting') 
      });
    } catch (fallbackError) {
      res.status(500).json({ 
        success: false,
        error: 'Failed to create setting' 
      });
    }
  }
});

// ================================
// INSTANCE STATUS MANAGEMENT
// ================================

// Update instance status in settings
router.put('/instance-status', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { status } = req.body;

    const t = await getTranslator(db);
    
    // Validate status
    const validStatuses = ['deploying', 'active', 'suspended', 'terminated', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.invalidStatus') 
      });
    }

    // Update or insert INSTANCE_STATUS setting
    // MIGRATED: Upsert instance status using sqlManager
    await settingsQueries.upsertSetting(db, 'INSTANCE_STATUS', status);

    console.log(`✅ Admin portal updated instance status to: ${status}`);

    const tenantId = getTenantId(req);
    await notificationService.publish('instance-status-updated', {
      status,
      timestamp: new Date().toISOString()
    }, tenantId).catch((err) => console.error('Failed to publish instance-status-updated:', err));

    await notificationService.publish(
      'settings-updated',
      { key: 'INSTANCE_STATUS', value: status, timestamp: new Date().toISOString() },
      tenantId
    ).catch((err) => console.error('Failed to publish settings-updated (INSTANCE_STATUS):', err));

    res.json({
      success: true,
      message: t('success.instanceStatusUpdatedSuccessfully'),
      data: { status }
    });
  } catch (error) {
    console.error('Error updating instance status:', error);
    try {
      const dbErr = getRequestDatabase(req);
      const tr = await getTranslator(dbErr);
      res.status(500).json({
        success: false,
        error: tr('errors.failedToUpdateInstanceStatus')
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: 'Failed to update instance status'
      });
    }
  }
});

// Get current instance status
router.get('/instance-status', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get instance status using sqlManager
    const statusSetting = await helpers.getSetting(db, 'INSTANCE_STATUS');
    const status = statusSetting || 'active';

    res.json({
      success: true,
      data: { status }
    });
  } catch (error) {
    console.error('Error fetching instance status:', error);
    try {
      const dbErr = getRequestDatabase(req);
      const tr = await getTranslator(dbErr);
      res.status(500).json({
        success: false,
        error: tr('errors.failedToFetchInstanceStatus')
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch instance status'
      });
    }
  }
});

// Send invitation email to user
router.post('/send-invitation', authenticateAdminPortal, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { email, adminName } = req.body;
    
    const t = await getTranslator(db);
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.emailRequired') 
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail.endsWith('@local')) {
      return res.status(400).json({
        success: false,
        error: t('errors.cannotInviteLocalAccount')
      });
    }
    
    // Find user by email
    // MIGRATED: Get user by email using sqlManager
    const user = await userQueries.getUserByEmail(db, email);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: t('errors.userNotFound') 
      });
    }
    
    // Check if user is already active
    if (user.is_active) {
      return res.status(400).json({ 
        success: false,
        error: t('errors.userAlreadyActive') 
      });
    }
    
    // Generate invitation token
    const inviteToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    // Store invitation token
    // MIGRATED: Create user invitation using sqlManager
    const invitationId = crypto.randomUUID();
    await adminUserQueries.createUserInvitation(db, invitationId, user.id, inviteToken, expiresAt.toISOString());
    
    // Priority: BASE_URL env, APP_URL in DB, tenant hostname, instance fallback
    const appUrlSetting = await helpers.getSetting(db, 'APP_URL');
    let baseUrl = process.env.BASE_URL;

    if (!baseUrl) {
      if (appUrlSetting && String(appUrlSetting).trim()) {
        baseUrl = String(appUrlSetting).replace(/\/$/, '');
      } else {
        const tenantId = req.tenantId;
        if (tenantId) {
          const domain = getTenantDomain();
          baseUrl = `https://${tenantId}.${domain}`;
        } else {
          const instanceName = process.env.INSTANCE_NAME || 'easy-kanban-app';
          const domain = getTenantDomain();
          baseUrl = `https://${instanceName}.${domain}`;
        }
      }
    }

    baseUrl = String(baseUrl).replace(/\/$/, '');
    const inviteUrl = `${baseUrl}/#activate-account?token=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(user.email)}`;

    const EmailService = (await import('../services/emailService.js')).default;
    const emailService = new EmailService(db);
    const emailResult = await emailService.sendUserInvitation(
      user,
      inviteToken,
      adminName || 'Admin',
      baseUrl,
      {
        storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths,
        tenantId: getTenantId(req),
      }
    );

    if (!emailResult.success) {
      const errMsg = emailResult.reason || 'Failed to send invitation email';
      console.error('⚠️ Admin portal invitation email failed:', errMsg);
      return res.status(500).json({
        success: false,
        error: errMsg
      });
    }

    console.log(`✅ Invitation sent to user: ${email}`);
    
    res.json({
      success: true,
      message: t('success.invitationSentSuccessfully'),
      data: {
        email: user.email,
        inviteUrl: inviteUrl,
        expiresAt: expiresAt.toISOString()
      }
    });
  } catch (error) {
    console.error('Error sending invitation:', error);
    const t = await getTranslator(db);
    res.status(500).json({ 
      success: false,
      error: t('errors.failedToSendInvitation') 
    });
  }
});

export default router;
