import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticateToken } from '../middleware/auth.js';
import { avatarUpload, createAttachmentUploadMiddleware } from '../config/multer.js';
import { createDefaultAvatar } from '../utils/avatarGenerator.js';
import { dbTransaction, dbExec } from '../utils/dbAsync.js';
import notificationService from '../services/notificationService.js';
import { getTranslator } from '../utils/i18n.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
import { users as userQueries, tasks as taskQueries, adminUsers as adminUserQueries, settings as settingsQueries } from '../utils/sqlManager/index.js';
import { commitUploadedFile, getRequestStoragePaths } from '../services/storage/index.js';
import { deleteAvatarFileIfUnused } from '../utils/avatarCleanup.js';
import { validateUploadedFileMagic } from '../utils/fileMagicBytes.js';
import { getAdminFileSettings } from '../utils/fileValidation.js';
import { getLicenseManager } from '../config/license.js';
import {
  parseBody,
  updateProfileBodySchema,
  updateUserSettingBodySchema
} from '../utils/requestValidation.js';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001';

const router = express.Router();

// Middleware factory: creates multer middleware dynamically based on admin settings
// This must run BEFORE the route handler so multer can process the multipart stream
const createUploadMiddleware = async (req, res, next) => {
  try {
    const db = getRequestDatabase(req);
    // Create multer instance with admin settings (pre-loaded for synchronous filter)
    const attachmentUploadWithValidation = await createAttachmentUploadMiddleware(db);
    
    // Use multer as middleware - this processes the multipart stream
    attachmentUploadWithValidation.single('file')(req, res, (err) => {
      if (err) {
        console.error('File upload validation error:', err.message);
        // Handle multer errors (file too large, invalid type, etc.)
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: err.message });
      }
      // File processed successfully, continue to route handler
      next();
    });
  } catch (error) {
    console.error('File upload middleware error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
};

// File upload endpoint
// Note: Multer middleware must run BEFORE the route handler to process multipart stream
router.post('/upload', authenticateToken, createUploadMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const db = getRequestDatabase(req);
    const licenseManager = getLicenseManager(db);
    if (licenseManager.isEnabled()) {
      try {
        await licenseManager.checkStorageLimit(req.file.size || 0);
      } catch (limitErr) {
        return res.status(403).json({
          error: 'License limit exceeded',
          details: limitErr.message,
          limit: 'STORAGE_LIMIT'
        });
      }
    }

    const settings = await getAdminFileSettings(db);
    const magic = await validateUploadedFileMagic(req.file, {
      mode: 'attachment',
      limitsEnforced: settings.limitsEnforced,
      allowedTypes: settings.allowedTypes
    });
    if (!magic.valid) {
      return res.status(400).json({ error: magic.error });
    }

    await commitUploadedFile(db, getRequestStoragePaths(req), 'attachments', req.file);

    // Cookie-authenticated files URL (no session JWT in query string)
    const authenticatedUrl = `/api/files/attachments/${req.file.filename}`;
    
    res.json({
      id: crypto.randomUUID(),
      name: req.file.originalname,
      url: authenticatedUrl,
      type: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Avatar upload endpoint
router.post('/avatar', authenticateToken, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No avatar file uploaded' });
  }

  try {
    const magic = await validateUploadedFileMagic(req.file, { mode: 'avatar' });
    if (!magic.valid) {
      return res.status(400).json({ error: magic.error });
    }

    const db = getRequestDatabase(req);
    const previous = await userQueries.getUserByIdForAdmin(db, req.user.id);
    const previousPath = previous?.avatar_path || previous?.avatarPath || null;

    await commitUploadedFile(db, getRequestStoragePaths(req), 'avatars', req.file);
    const avatarPath = `/avatars/${req.file.filename}`;
    // MIGRATED: Update user avatar using sqlManager
    await userQueries.updateUserAvatar(db, req.user.id, avatarPath);

    await deleteAvatarFileIfUnused(db, getRequestStoragePaths(req), previousPath);
    
    // MIGRATED: Get the member ID using sqlManager
    const member = await userQueries.getMemberByUserId(db, req.user.id);
    
    // Publish to Redis for real-time updates
    if (member) {
      const tenantId = getTenantId(req);
      console.log('📤 Publishing user-profile-updated to Redis for user:', req.user.id);
      await notificationService.publish('user-profile-updated', {
        userId: req.user.id,
        memberId: member.id,
        avatarPath: avatarPath,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ User-profile-updated published to Redis');
    }
    
    // Cookie-authenticated files URL (no session JWT in query string)
    const authenticatedUrl = `/api/files/avatars/${req.file.filename}`;
    
    res.json({
      message: 'Avatar uploaded successfully',
      avatarUrl: authenticatedUrl
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Delete avatar endpoint
router.delete('/avatar', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const previous = await userQueries.getUserByIdForAdmin(db, req.user.id);
    const previousPath = previous?.avatar_path || previous?.avatarPath || null;

    // MIGRATED: Update user avatar using sqlManager
    await userQueries.updateUserAvatar(db, req.user.id, null);

    await deleteAvatarFileIfUnused(db, getRequestStoragePaths(req), previousPath);
    
    // MIGRATED: Get the member ID using sqlManager
    const member = await userQueries.getMemberByUserId(db, req.user.id);
    
    // Publish to Redis for real-time updates
    if (member) {
      const tenantId = getTenantId(req);
      console.log('📤 Publishing user-profile-updated to Redis for user:', req.user.id);
      await notificationService.publish('user-profile-updated', {
        userId: req.user.id,
        memberId: member.id,
        avatarPath: null,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ User-profile-updated published to Redis');
    }
    
    res.json({ message: 'Avatar removed successfully' });
  } catch (error) {
    console.error('Error removing avatar:', error);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

// Update user profile (display name + optional bio)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    const parsed = parseBody(updateProfileBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: t('errors.displayNameRequired') });
    }
    const trimmedDisplayName = parsed.data.displayName;
    const bioRaw = parsed.data.bio;
    const bio =
      bioRaw === undefined
        ? undefined
        : String(bioRaw).trim() === ''
          ? null
          : String(bioRaw).trim();
    const userId = req.user.id;
    
    // MIGRATED: Check for duplicate display name using sqlManager
    const existingMember = await userQueries.checkMemberNameExists(db, trimmedDisplayName, userId);
    
    if (existingMember) {
      return res.status(400).json({ error: t('errors.displayNameTaken') });
    }
    
    // MIGRATED: Update the member's name using sqlManager
    await userQueries.updateMemberName(db, userId, trimmedDisplayName);

    if (bio !== undefined) {
      await userQueries.updateUserBio(db, userId, bio);
    }
    
    // MIGRATED: Get the member ID using sqlManager
    const member = await userQueries.getMemberByUserId(db, userId);
    
    // Publish to Redis for real-time updates
    if (member) {
      const tenantId = getTenantId(req);
      console.log('📤 Publishing user-profile-updated to Redis for user:', userId);
      await notificationService.publish('user-profile-updated', {
        userId: userId,
        memberId: member.id,
        displayName: trimmedDisplayName,
        bio: bio === undefined ? undefined : bio,
        timestamp: new Date().toISOString()
      }, tenantId);
      console.log('✅ User-profile-updated published to Redis');
    }
    
    res.json({ 
      message: 'Profile updated successfully',
      displayName: trimmedDisplayName,
      ...(bio !== undefined ? { bio } : {})
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Delete user account
router.delete("/account", authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const userId = req.user.id;
    const tenantId = getTenantId(req);

    const allowSelfDelete = await settingsQueries.getSettingByKey(db, 'ALLOW_USER_SELF_DELETE');
    if (allowSelfDelete?.value === 'false') {
      return res.status(403).json({
        error: 'Self-service account deletion is disabled. Contact an administrator.',
        code: 'self_delete_disabled',
      });
    }

    const user = await userQueries.getUserBasicInfo(db, userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found or already inactive' });
    }

    const ownerSetting = await settingsQueries.getSettingByKey(db, 'OWNER');
    const ownerEmail = ownerSetting?.value ? String(ownerSetting.value).trim().toLowerCase() : '';
    if (ownerEmail && String(user.email || '').trim().toLowerCase() === ownerEmail) {
      return res.status(403).json({
        error: 'The instance owner cannot delete their own account. Transfer ownership first or ask another admin.',
        code: 'owner_cannot_self_delete',
      });
    }

    const userMember = await userQueries.getMemberByUserId(db, userId);
    let tasksToReassign = [];
    if (userMember) {
      tasksToReassign = await userQueries.getTasksForMember(db, userMember.id);
      console.log(`📋 Self-delete: ${tasksToReassign.length} task(s) to reassign from ${userId} to SYSTEM`);
    }

    await dbTransaction(db, async () => {
      const existingSystemMember = await userQueries.getMemberById(db, SYSTEM_MEMBER_ID);
      if (!existingSystemMember) {
        console.log('⚠️  SYSTEM account not found, creating it...');
        const existingSystemUser = await userQueries.getUserByIdForAdmin(db, SYSTEM_USER_ID);
        if (!existingSystemUser) {
          const systemPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
          const systemAvatarPath = await createDefaultAvatar('System', SYSTEM_USER_ID, '#1E40AF', tenantId, {
            db,
            storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths,
          });
          await userQueries.createUser(
            db,
            SYSTEM_USER_ID,
            'system@local',
            systemPasswordHash,
            'System',
            'User',
            false,
            'local'
          );
          if (systemAvatarPath) {
            await userQueries.updateUserAvatar(db, SYSTEM_USER_ID, systemAvatarPath);
          }
          const userRole = await userQueries.getRoleByName(db, 'user');
          if (userRole) {
            await userQueries.addUserRole(db, SYSTEM_USER_ID, userRole.id);
          }
        }
        await adminUserQueries.createSystemMember(db, SYSTEM_MEMBER_ID, SYSTEM_USER_ID);
        console.log('✅ SYSTEM account created successfully');
      }

      await adminUserQueries.deleteUserActivity(db, userId);

      if (userMember) {
        await adminUserQueries.deleteCommentsByMember(db, userMember.id);
        await adminUserQueries.deleteWatchersByMember(db, userMember.id);
        await adminUserQueries.deleteCollaboratorsByMember(db, userMember.id);
      }

      await adminUserQueries.clearPlanningPeriodsCreatedBy(db, userId);
      await userQueries.deleteUserRoles(db, userId);
      await adminUserQueries.deleteAllUserSettings(db, userId);
      await adminUserQueries.deleteViewsByUser(db, userId);
      await adminUserQueries.deletePasswordResetTokensByUser(db, userId);
      await adminUserQueries.deleteUserInvitations(db, userId);

      if (userMember) {
        await adminUserQueries.reassignTasksToSystemMember(db, SYSTEM_MEMBER_ID, userMember.id);
        await adminUserQueries.reassignTaskRequestersToSystemMember(db, SYSTEM_MEMBER_ID, userMember.id);
        await adminUserQueries.deleteMemberByUserId(db, userId);
      }

      await adminUserQueries.deleteUser(db, userId);
      console.log(`🗑️ Account deleted successfully for user: ${user.email}`);
    });

    await deleteAvatarFileIfUnused(
      db,
      getRequestStoragePaths(req),
      user.avatar_path || user.avatarPath
    );

    if (tasksToReassign.length > 0) {
      const systemMember = await userQueries.getMemberById(db, SYSTEM_MEMBER_ID);
      if (systemMember) {
        console.log(`📤 Publishing ${tasksToReassign.length} task-updated events after self-delete`);
        for (const task of tasksToReassign) {
          const updatedTask = await taskQueries.getTaskWithRelationships(db, task.id);
          if (updatedTask) {
            notificationService.publish('task-updated', {
              boardId: task.boardId,
              task: updatedTask,
              timestamp: new Date().toISOString(),
            }, tenantId).catch((err) => {
              console.error('Failed to publish task-updated event:', err);
            });
          }
        }
      }
    }

    notificationService.publish('member-deleted', {
      userId,
      memberId: userMember?.id || null,
      userName: `${user.first_name} ${user.last_name}`,
      userEmail: user.email,
      timestamp: new Date().toISOString(),
    }, tenantId).catch((err) => {
      console.error('Failed to publish member-deleted event:', err);
    });

    notificationService.publish('user-deleted', {
      userId,
      user: {
        id: userId,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
      },
      timestamp: new Date().toISOString(),
    }, tenantId).catch((err) => {
      console.error('Failed to publish user-deleted event:', err);
    });

    res.json({
      message: 'Account deleted successfully',
      deletedUser: {
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
      },
      tasksReassigned: tasksToReassign.length,
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// User Settings endpoints
router.get('/settings', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const db = getRequestDatabase(req);
  
  try {
    // Create user_settings table if it doesn't exist
    await dbExec(db, `
      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        userid TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userid, setting_key)
      )
    `);
    
    // MIGRATED: Get user settings using sqlManager
    const settings = await userQueries.getUserSettings(db, userId);
    
    // Convert to object format
    const settingsObj = settings.reduce((acc, setting) => {
      let value = setting.setting_value;
      
      // Convert booleans
      if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (!isNaN(value) && !isNaN(parseFloat(value))) {
        // Convert numbers (but only if it's actually a pure number)
        value = parseFloat(value);
      }
      // Leave strings (including JSON strings) as strings
      
      acc[setting.setting_key] = value;
      return acc;
    }, {});
    
    // Don't set defaults here - let the client handle smart merging
    // This allows the client to properly merge cookie vs database values
    res.json(settingsObj);
  } catch (error) {
    console.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Failed to fetch user settings' });
  }
});

router.put('/settings', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const parsed = parseBody(updateUserSettingBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { setting_key, setting_value } = parsed.data;
  const db = getRequestDatabase(req);
  
  try {
    // Perf overlay preference is admin-only (UI also gates on role)
    if (setting_key === 'FE_PERF_TESTS') {
      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      if (!roles.includes('admin')) {
        return res.status(403).json({ error: 'Only admins can change performance test preferences' });
      }
    }

    // Handle undefined values (skip them)
    if (setting_value === undefined) {
      console.warn(`Skipping save for ${setting_key}: value is undefined`);
      return res.json({ message: 'Setting skipped (undefined value)' });
    }
    
    // Null clears specific keys (delete row) — same pattern as selectedSprintId ("All Sprints")
    if (setting_value === null) {
      if (setting_key === 'selectedSprintId' || setting_key === 'currentFilterViewId') {
        await userQueries.deleteUserSetting(db, userId, setting_key);
        return res.json({ message: 'Setting cleared successfully (null value stored as deletion)' });
      }
      console.warn(`Skipping save for ${setting_key}: value is null`);
      return res.json({ message: 'Setting skipped (null value)' });
    }
    
    // Convert value to string safely (objects/arrays as JSON)
    const valueString =
      typeof setting_value === 'string'
        ? setting_value
        : typeof setting_value === 'object'
          ? JSON.stringify(setting_value)
          : String(setting_value);
    
    // MIGRATED: Upsert user setting using sqlManager
    await userQueries.upsertUserSetting(db, userId, setting_key, valueString);
    
    res.json({ message: 'Setting updated successfully' });
  } catch (error) {
    console.error('Error updating user setting:', error);
    res.status(500).json({ error: 'Failed to update user setting' });
  }
});

export default router;

