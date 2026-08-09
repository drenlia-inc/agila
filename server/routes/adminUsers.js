import express from 'express';
import { dbTransaction } from '../utils/dbAsync.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { avatarUpload } from '../config/multer.js';
import { getLicenseManager } from '../config/license.js';
import { createDefaultAvatar, getRandomColor } from '../utils/avatarGenerator.js';
// Note: Email notification service (getNotificationService) is not yet implemented
// import { getNotificationService } from '../services/notificationService.js';
import notificationService from '../services/notificationService.js';
import { getTranslator } from '../utils/i18n.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
import { getTenantDomain } from '../utils/tenantDomain.js';
// MIGRATED: Import sqlManager modules
import { users as userQueries, tasks as taskQueries, adminUsers as adminUserQueries, auth as authQueries, helpers, settings as settingsQueries } from '../utils/sqlManager/index.js';
import { commitUploadedFile, getRequestStoragePaths } from '../services/storage/index.js';
import { validateUploadedFileMagic } from '../utils/fileMagicBytes.js';
import { deleteAvatarFileIfUnused } from '../utils/avatarCleanup.js';
import { AGENT_USER_ID } from '../constants/agentIdentity.js';
import { AI_SETTING_KEYS } from '../constants/aiSettings.js';
import {
  parseBody,
  adminCreateUserBodySchema,
  adminUpdateUserBodySchema,
  adminUpdateUserRoleBodySchema,
  updateMemberNameBodySchema,
  updateMemberColorBodySchema,
  resendInvitationBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

// Helper to get the actual notification system being used (for accurate logging)
const getNotificationSystem = () => {
  return 'PostgreSQL';
};

// Get all users (admin only)
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // Prevent browser caching of admin user data
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    // MIGRATED: Get all users with roles and member info using sqlManager
    const users = await userQueries.getAllUsersWithRolesAndMembers(db);
    const aiEnabled = (await helpers.getSetting(db, 'AI_ENABLED')) === 'true';

    const transformedUsers = users
      // Agent pseudo-user is only meaningful while AI is enabled
      .filter((user) => aiEnabled || user.email !== 'agent@local')
      .map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName: user.member_name || `${user.first_name} ${user.last_name}`,
      roles: user.roles ? user.roles.split(',') : [],
      isActive: !!user.is_active,
      createdAt: user.created_at,
      joined: user.created_at,
      avatarUrl: user.avatar_path,
      authProvider: user.auth_provider || 'local',
      googleAvatarUrl: user.google_avatar_url,
      memberName: user.member_name,
      memberColor: user.member_color
    }));

    res.json(transformedUsers);
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin member name update endpoint (MUST come before /:userid route)
router.put('/:userId/member-name', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    const { userId } = req.params;
    const parsed = parseBody(updateMemberNameBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: t('errors.displayNameRequired') });
    }
    const trimmedDisplayName = parsed.data.displayName;
    
    // MIGRATED: Check for duplicate display name using sqlManager
    const existingMember = await userQueries.checkMemberNameExists(db, trimmedDisplayName, userId);
    
    if (existingMember) {
      return res.status(400).json({ error: t('errors.displayNameTaken') });
    }
    
    console.log('🏷️ Updating member name for user:', userId, 'to:', trimmedDisplayName);
    
    // MIGRATED: Get member info before update using sqlManager
    const member = await userQueries.getMemberByUserIdWithColor(db, userId);
    
    if (!member) {
      console.log('❌ No member found for user:', userId);
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // MIGRATED: Update the member's name using sqlManager
    const result = await userQueries.updateMemberName(db, userId, trimmedDisplayName);
    
    if (result.changes === 0) {
      console.log('❌ No member found for user:', userId);
      return res.status(404).json({ error: 'Member not found' });
    }

    // Keep AI_AGENT_NAME in sync when Agent display name changes from Users admin
    if (userId === AGENT_USER_ID) {
      try {
        await settingsQueries.upsertSetting(db, AI_SETTING_KEYS.AI_AGENT_NAME, trimmedDisplayName);
        await notificationService.publish(
          'settings-updated',
          {
            key: AI_SETTING_KEYS.AI_AGENT_NAME,
            value: trimmedDisplayName,
            timestamp: new Date().toISOString(),
          },
          getTenantId(req)
        );
      } catch (syncErr) {
        console.warn('Failed to sync AI_AGENT_NAME from Agent display name:', syncErr?.message || syncErr);
      }
    }
    
    // Publish notification for real-time updates (uses PostgreSQL or Redis based on DB_TYPE)
    console.log(`📤 Publishing member-updated via ${getNotificationSystem()} for name change`);
    await notificationService.publish('member-updated', {
      memberId: member.id,
      member: { id: member.id, name: trimmedDisplayName, color: member.color },
      timestamp: new Date().toISOString()
    }, getTenantId(req));
    console.log(`✅ Member-updated published via ${getNotificationSystem()}`);
    
    console.log('✅ Member name updated successfully');
    res.json({ 
      message: 'Member name updated successfully',
      displayName: trimmedDisplayName
    });
  } catch (error) {
    console.error('Member name update error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      userId: req.params.userId,
      displayName: req.body.displayName
    });
    res.status(500).json({ 
      error: 'Failed to update member name',
      details: error.message 
    });
  }
});

// Update user details (MUST come after more specific routes)
router.put('/:userId', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { userId } = req.params;
  const parsed = parseBody(adminUpdateUserBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { email, firstName, lastName, isActive } = parsed.data;
  const db = getRequestDatabase(req);
  const { getTranslator } = await import('../utils/i18n.js');
  const t = getTranslator(db);
  
  try {
    // MIGRATED: Get current user status using sqlManager
    const currentUser = await userQueries.getUserByIdForAdmin(db, userId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentEmail = String(currentUser.email || '').toLowerCase();
    const isPseudoAccount =
      currentEmail === 'agent@local' || currentEmail === 'system@local';

    // Pseudo accounts: allow name edits only — never change email or activation
    const nextEmail = isPseudoAccount ? currentUser.email : email;
    const nextIsActive = isPseudoAccount ? !!currentUser.is_active : !!isActive;

    // Check if user is being activated (changing from inactive to active)
    const isBeingActivated = !currentUser.is_active && nextIsActive;
    
    if (isBeingActivated) {
      // Check user limit before allowing activation (only if licensing is enabled)
      const licenseEnabled = process.env.LICENSE_ENABLED === 'true';
      if (licenseEnabled) {
        const licenseManager = getLicenseManager(db);
        try {
          await licenseManager.checkUserLimit();
        } catch (limitError) {
          console.warn('User limit check failed during activation:', limitError.message);
          return res.status(403).json({ 
            error: 'User limit reached',
            message: limitError.message,
            details: 'Your current plan does not allow activating more users. Please upgrade your plan or contact support.'
          });
        }
      }
    }

    // MIGRATED: Check if email already exists using sqlManager (case-insensitive)
    const existingUser = await userQueries.checkEmailExists(db, nextEmail, userId);
    if (existingUser) {
      return res.status(400).json({ error: `User with email ${nextEmail} already exists` });
    }

    // MIGRATED: Update user using sqlManager
    await userQueries.updateUser(db, userId, {
      email: nextEmail,
      firstName,
      lastName,
      isActive: nextIsActive,
    });

    // Note: Member name is updated separately via /api/admin/users/:userId/member-name
    // This allows for custom display names that differ from firstName + lastName

    // Publish notification for real-time updates (uses PostgreSQL or Redis based on DB_TYPE)
    console.log(`📤 Publishing user-updated via ${getNotificationSystem()}`);
    await notificationService.publish('user-updated', {
      user: { 
        id: userId, 
        email: nextEmail, 
        firstName, 
        lastName, 
        isActive: nextIsActive,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    }, getTenantId(req));

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Update user role
router.put('/:userId/role', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { userId } = req.params;
  const parsed = parseBody(adminUpdateUserRoleBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { role } = parsed.data;
  const db = getRequestDatabase(req);

  try {
    // Prevent users from demoting themselves
    if (userId === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot change your own admin role' });
    }

    // MIGRATED: Get current role using sqlManager
    const currentRole = await userQueries.getUserRole(db, userId);

    if (currentRole !== role) {
      // MIGRATED: Remove current role using sqlManager
      await userQueries.deleteUserRoles(db, userId);
      
      // MIGRATED: Assign new role using sqlManager
      const roleObj = await userQueries.getRoleByName(db, role);
      if (roleObj) {
        await userQueries.addUserRole(db, userId, roleObj.id);
      }

      // MIGRATED: Update the user's updated_at timestamp using sqlManager
      await userQueries.updateUserTimestamp(db, userId);

      console.log(`🔄 User ${userId} role changed to ${role} - no logout required`);
      
      // Publish notification for real-time updates
      console.log(`📤 Publishing user-role-updated via ${getNotificationSystem()}`);
      await notificationService.publish('user-role-updated', {
        userId: userId,
        role: role,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
    }

    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Check if user can be created (for pre-validation)
router.get('/can-create', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    
    // Check if licensing is enabled first (before creating license manager)
    // If LICENSE_ENABLED is not set or is 'false', treat as disabled
    const licenseEnabled = process.env.LICENSE_ENABLED === 'true';
    if (!licenseEnabled) {
      return res.json({ canCreate: true, reason: null });
    }
    
    // Only check limits if licensing is enabled
    // Safely get license manager - if db is not available, allow creation
    if (!db) {
      console.warn('Database not available for license check, allowing user creation');
      return res.json({ canCreate: true, reason: null });
    }
    
    const licenseManager = getLicenseManager(db);
    if (!licenseManager.isEnabled()) {
      return res.json({ canCreate: true, reason: null });
    }
    
    try {
      await licenseManager.checkUserLimit();
      res.json({ canCreate: true, reason: null });
    } catch (limitError) {
      // This is expected when limit is reached - return success response with canCreate: false
      try {
        const limits = await licenseManager.getLimits();
        const userCount = await licenseManager.getUserCount();
        res.json({ 
          canCreate: false, 
          reason: 'User limit reached',
          message: `Your current plan allows ${limits.USER_LIMIT} active users. You currently have ${userCount}. Please upgrade your plan or contact support.`,
          current: userCount,
          limit: limits.USER_LIMIT
        });
      } catch (detailsError) {
        // If we can't get details, still return the limit error
        res.json({ 
          canCreate: false, 
          reason: 'User limit reached',
          message: limitError.message
        });
      }
    }
  } catch (error) {
    console.error('Error checking user limit:', error);
    // If licensing is disabled, allow user creation even if there's an error
    const licenseEnabled = process.env.LICENSE_ENABLED === 'true';
    if (!licenseEnabled) {
      return res.json({ canCreate: true, reason: null });
    }
    // For any other error when licensing is enabled, return error
    res.status(500).json({ error: 'Failed to check user limit' });
  }
});

// Create new user
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  const parsed = parseBody(adminCreateUserBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { email, password, firstName, lastName, role, displayName, baseUrl: baseUrlFromBody } = parsed.data;
  // Demo mode cannot send invite emails — always create users as active locally
  const isActive = process.env.DEMO_ENABLED === 'true' ? true : !!parsed.data.isActive;
  const db = getRequestDatabase(req);
  const t = getTranslator(db);

  if (String(email || '').toLowerCase().endsWith('@local')) {
    return res.status(400).json({ error: 'Cannot create users with @local email addresses' });
  }

  // Password is optional: invites and admin-created actives use a random hash until
  // the user activates via invite link, password reset, or Google SSO.
  
  // Get baseUrl for invitation emails - use APP_URL from database (tenant-specific)
  // Priority: 1) APP_URL from database, 2) baseUrl from request body, 3) Construct from tenantId, 4) Fallback
  let baseUrl = baseUrlFromBody;
  if (!baseUrl) {
    // MIGRATED: Get APP_URL setting using sqlManager
    const appUrlSetting = await helpers.getSetting(db, 'APP_URL');
    
    if (appUrlSetting && String(appUrlSetting).trim()) {
      baseUrl = String(appUrlSetting).replace(/\/$/, '');
    } else {
      // Construct from tenantId if available (multi-tenant mode)
      const tenantId = req.tenantId;
      if (tenantId) {
        const domain = getTenantDomain();
        baseUrl = `https://${tenantId}.${domain}`;
      } else {
        // Fallback to request origin
        baseUrl = req.get('origin') || 'http://localhost:3000';
      }
    }
  }
  
  try {
    // Check user limit before creating new user (only if licensing is enabled)
    const licenseEnabled = process.env.LICENSE_ENABLED === 'true';
    if (licenseEnabled) {
      const licenseManager = getLicenseManager(db);
      try {
        await licenseManager.checkUserLimit();
      } catch (limitError) {
        console.warn('User limit check failed:', limitError.message);
        return res.status(403).json({ 
          error: 'User limit reached',
          message: limitError.message,
          details: 'Your current plan does not allow creating more users. Please upgrade your plan or contact support.'
        });
      }
    }
    
    // MIGRATED: Check if email already exists using sqlManager
    const existingUser = await userQueries.checkEmailExists(db, email);
    if (existingUser) {
      return res.status(400).json({ error: `User with email ${email} already exists` });
    }
    
    // Generate user ID
    const userId = crypto.randomUUID();
    
    // Hash password (invite/inactive may omit — use unguessable placeholder until activation)
    const passwordHash = await bcrypt.hash(
      password || crypto.randomBytes(32).toString('hex'),
      10
    );
    
    // MIGRATED: Create user using sqlManager
    await userQueries.createUser(db, userId, email, passwordHash, firstName, lastName, isActive, 'local');
    
    // MIGRATED: Assign role using sqlManager
    const roleObj = await userQueries.getRoleByName(db, role);
    if (roleObj) {
      await userQueries.addUserRole(db, userId, roleObj.id);
    }
    
    // Create team member automatically with custom display name if provided and random color
    const memberId = crypto.randomUUID();
    let memberName = displayName || `${firstName} ${lastName}`;
    
    // Validate display name length (max 30 characters) if provided
    if (displayName) {
      const trimmedDisplayName = displayName.trim();
      if (trimmedDisplayName.length > 30) {
        return res.status(400).json({ error: t('errors.displayNameTooLong') });
      }
      memberName = trimmedDisplayName;
    } else {
      // If no display name provided, use firstName + lastName, but truncate if needed
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName.length > 30) {
        memberName = fullName.substring(0, 30);
      } else {
        memberName = fullName;
      }
    }
    
    const memberColor = getRandomColor(); // Random color from palette
    // MIGRATED: Create member using auth.createMemberForUser (includes user_id)
    await authQueries.createMemberForUser(db, memberId, memberName, memberColor, userId);
    
    // Generate default avatar SVG for new local users with matching background color
    // Use tenant-specific path if in multi-tenant mode
    const tenantId = getTenantId(req);
    const avatarPath = await createDefaultAvatar(memberName, userId, memberColor, tenantId, {
      db,
      storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths
    });
    if (avatarPath) {
      // MIGRATED: Update user with default avatar path using sqlManager
      await userQueries.updateUserAvatar(db, userId, avatarPath);
    }
    
    // Only generate invitation token and send email if user is not active
    let emailSent = false;
    let emailError = null;
    
    if (!isActive) {
      // Generate invitation token for email verification
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      // MIGRATED: Store invitation token using sqlManager
      await adminUserQueries.createUserInvitation(
        db,
        crypto.randomUUID(),
        userId,
        inviteToken,
        tokenExpiry.toISOString()
      );
      
      // MIGRATED: Get admin user info using sqlManager
      const adminUser = await userQueries.getUserByIdForAdmin(db, req.user.id);
      const adminName =
        (adminUser?.first_name && String(adminUser.first_name).trim()) ||
        (adminUser?.email && String(adminUser.email).split('@')[0]) ||
        'Administrator';
      
      try {
        const EmailService = (await import('../services/emailService.js')).default;
        const emailService = new EmailService(db);
        const inviteUser = {
          email,
          first_name: firstName,
          last_name: lastName
        };
        const emailResult = await emailService.sendUserInvitation(
          inviteUser,
          inviteToken,
          adminName,
          baseUrl,
          {
            storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths,
            tenantId: getTenantId(req),
          }
        );
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Invitation email sent for new user:', email);
        } else {
          emailError = emailResult.reason || 'Email service unavailable';
          console.warn('⚠️ Failed to send invitation email:', emailError);
        }
      } catch (emailErr) {
        console.warn('⚠️ Failed to send invitation email:', emailErr.message);
        emailError = emailErr.message;
      }
    }
    
    // Publish notification for real-time updates
    console.log(`📤 Publishing user-created via ${getNotificationSystem()}`);
    await notificationService.publish('user-created', {
      user: { 
        id: userId, 
        email, 
        firstName, 
        lastName, 
        role, 
        isActive: isActive || false,
        displayName: memberName,
        memberColor: memberColor,
        authProvider: 'local',
        createdAt: new Date().toISOString(),
        joined: new Date().toISOString()
      },
      member: { id: memberId, name: memberName, color: memberColor },
      timestamp: new Date().toISOString()
    }, getTenantId(req));
    
    // Publish member-created event for real-time member list updates
    console.log(`📤 Publishing member-created via ${getNotificationSystem()}`);
    await notificationService.publish('member-created', {
      member: {
        id: memberId,
        name: memberName,
        color: memberColor,
        userId: userId
      },
      timestamp: new Date().toISOString()
    }, getTenantId(req));
    
    // Prepare response message based on creation mode
    let message = 'User created successfully.';
    if (isActive) {
      message += ' User is active and can log in immediately.';
    } else if (emailSent) {
      message += ' An invitation email has been sent.';
    } else {
      message += ` Note: Invitation email could not be sent (${emailError || 'Email service unavailable'}). The user will need to be manually activated or you can resend the invitation once email is configured.`;
    }

    res.json({ 
      message,
      user: { id: userId, email, firstName, lastName, role, isActive: isActive || false },
      emailSent,
      emailError: emailError || null
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === '23505' || String(error.message || '').toLowerCase().includes('unique')) {
      return res.status(400).json({ error: `User with email ${email} already exists` });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Resend user invitation
router.post('/:userId/resend-invitation', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { userId } = req.params;
  const parsed = parseBody(resendInvitationBodySchema, req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { baseUrl: baseUrlFromBody } = parsed.data;
  const db = getRequestDatabase(req);
  
  // Get baseUrl for invitation emails - use APP_URL from database (tenant-specific)
  // Priority: 1) APP_URL from database, 2) baseUrl from request body, 3) Construct from tenantId, 4) Fallback
  let baseUrl = baseUrlFromBody;
  if (!baseUrl) {
    // MIGRATED: Get APP_URL setting using sqlManager
    const appUrlSetting = await helpers.getSetting(db, 'APP_URL');
    
    if (appUrlSetting && String(appUrlSetting).trim()) {
      baseUrl = String(appUrlSetting).replace(/\/$/, '');
    } else {
      // Construct from tenantId if available (multi-tenant mode)
      const tenantId = req.tenantId;
      if (tenantId) {
        const domain = getTenantDomain();
        baseUrl = `https://${tenantId}.${domain}`;
      } else {
        // Fallback to request origin
        baseUrl = req.get('origin') || 'http://localhost:3000';
      }
    }
  }
  
  try {
    // MIGRATED: Get user details using sqlManager
    const user = await userQueries.getUserByIdForAdmin(db, userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow resending for inactive local users (never for @local pseudo accounts)
    if (user.auth_provider !== 'local') {
      return res.status(400).json({ error: 'Cannot resend invitation for non-local accounts' });
    }

    const email = String(user.email || '').toLowerCase();
    if (email.endsWith('@local')) {
      return res.status(400).json({ error: 'Cannot send invitations to @local accounts' });
    }

    const isActive =
      user.is_active === true ||
      user.is_active === 1 ||
      user.isActive === true ||
      user.isActive === 1;
    if (isActive) {
      return res.status(400).json({ error: 'User account is already active' });
    }

    // MIGRATED: Delete any existing invitation tokens for this user using sqlManager
    await adminUserQueries.deleteUserInvitations(db, userId);

    // Generate new invitation token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    // MIGRATED: Store new invitation token using sqlManager
    await adminUserQueries.createUserInvitation(
      db,
      crypto.randomUUID(),
      userId,
      inviteToken,
      tokenExpiry.toISOString()
    );
    
      // MIGRATED: Get admin user info using sqlManager
      const adminUser = await userQueries.getUserByIdForAdmin(db, req.user.id);
      const adminName =
        (adminUser?.first_name && String(adminUser.first_name).trim()) ||
        (adminUser?.email && String(adminUser.email).split('@')[0]) ||
        'Administrator';
    
    try {
      const EmailService = (await import('../services/emailService.js')).default;
      const emailService = new EmailService(db);
      const emailResult = await emailService.sendUserInvitation(
        user,
        inviteToken,
        adminName,
        baseUrl,
        {
          storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths,
          tenantId: getTenantId(req),
        }
      );

      if (emailResult.success) {
        console.log('✅ Invitation resent successfully for user:', user.email);
        return res.json({
          success: true,
          message: 'Invitation email sent successfully',
          email: user.email
        });
      }

      const errorMessage = emailResult.reason || 'Failed to send invitation email';
      console.error('⚠️ Failed to send invitation email:', errorMessage);
      return res.status(500).json({
        success: false,
        error: errorMessage,
        details: emailResult.details || null
      });
    } catch (emailError) {
      console.error('⚠️ Failed to send invitation email:', emailError.message);
      return res.status(500).json({
        success: false,
        error: emailError.message || 'Failed to send invitation email'
      });
    }
    
  } catch (error) {
    console.error('Resend invitation error:', error);
    res.status(500).json({ error: 'Failed to resend invitation' });
  }
});

// Get task count for a user (for deletion confirmation)
router.get('/:userId/task-count', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { userId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Get member ID using sqlManager
    const member = await userQueries.getMemberByUserId(db, userId);
    
    let taskCount = 0;
    if (member) {
      // MIGRATED: Get task count using sqlManager
      taskCount = await userQueries.getTaskCountForMember(db, member.id);
    }
    
    res.json({ count: taskCount });
  } catch (error) {
    console.error('Error getting user task count:', error);
    res.status(500).json({ error: 'Failed to get task count' });
  }
});

// Delete user
router.delete("/:userId", authenticateToken, requireRole(["admin"]), async (req, res) => {
  const { userId } = req.params;
  const reassignToUserId =
    (req.body && req.body.reassignToUserId) ||
    (typeof req.query?.reassignToUserId === 'string' ? req.query.reassignToUserId : null) ||
    null;
  const db = getRequestDatabase(req);
  
  try {
    // Check if user is trying to delete themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // MIGRATED: Get user details before deletion using sqlManager
    const user = await userQueries.getUserByIdForAdmin(db, userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get the SYSTEM user ID (00000000-0000-0000-0000-000000000000)
    const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
    const systemMemberId = '00000000-0000-0000-0000-000000000001';
    const tenantId = getTenantId(req);
    
    // MIGRATED: Get the member ID using sqlManager
    const userMember = await userQueries.getMemberByUserId(db, userId);

    // Resolve reassignment target (default: System). Must be a different user with a member row.
    let reassignMemberId = systemMemberId;
    let reassignLabel = 'System';
    if (reassignToUserId && reassignToUserId !== userId && reassignToUserId !== SYSTEM_USER_ID) {
      const targetMember = await userQueries.getMemberByUserId(db, reassignToUserId);
      if (!targetMember?.id) {
        return res.status(400).json({ error: 'Reassignment target user has no member profile' });
      }
      if (userMember && targetMember.id === userMember.id) {
        return res.status(400).json({ error: 'Cannot reassign tasks to the user being deleted' });
      }
      reassignMemberId = targetMember.id;
      reassignLabel = targetMember.name || reassignToUserId;
    }
    
    // MIGRATED: Get all tasks that will be reassigned using sqlManager
    let tasksToReassign = [];
    if (userMember) {
      tasksToReassign = await userQueries.getTasksForMember(db, userMember.id);
      console.log(`📋 Found ${tasksToReassign.length} tasks to reassign from user ${userId} to ${reassignLabel}`);
    }
    
    // Begin transaction for cascading deletion
    await dbTransaction(db, async () => {
      // 0. MIGRATED: Ensure SYSTEM account exists using sqlManager
      const existingSystemMember = await userQueries.getMemberById(db, systemMemberId);
      if (!existingSystemMember) {
        console.log('⚠️  SYSTEM account not found, creating it...');
        
        // MIGRATED: Check if SYSTEM user exists using sqlManager
        const existingSystemUser = await userQueries.getUserByIdForAdmin(db, SYSTEM_USER_ID);
        
        if (!existingSystemUser) {
          // Create SYSTEM user account
          const systemPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10); // Random unguessable password
          const systemAvatarPath = await createDefaultAvatar('System', SYSTEM_USER_ID, '#1E40AF', tenantId, {
            db,
            storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths
          });
          
          // MIGRATED: Create SYSTEM user using sqlManager
          await userQueries.createUser(db, SYSTEM_USER_ID, 'system@local', systemPasswordHash, 'System', 'User', false, 'local');
          
          // MIGRATED: Update avatar using sqlManager
          if (systemAvatarPath) {
            await userQueries.updateUserAvatar(db, SYSTEM_USER_ID, systemAvatarPath);
          }
          
          // MIGRATED: Assign user role using sqlManager
          const userRole = await userQueries.getRoleByName(db, 'user');
          if (userRole) {
            await userQueries.addUserRole(db, SYSTEM_USER_ID, userRole.id);
          }
        }
        
        // MIGRATED: Create system member record using sqlManager
        await adminUserQueries.createSystemMember(db, systemMemberId, SYSTEM_USER_ID);
        
        console.log('✅ SYSTEM account created successfully');
      }
      
      // MIGRATED: Delete activity records using sqlManager
      await adminUserQueries.deleteUserActivity(db, userId);
        
        // MIGRATED: Delete comments made by the user using sqlManager
        if (userMember) {
          await adminUserQueries.deleteCommentsByMember(db, userMember.id);
        }
        
        // MIGRATED: Delete watchers using sqlManager
        if (userMember) {
          await adminUserQueries.deleteWatchersByMember(db, userMember.id);
        }
        
        // MIGRATED: Delete collaborators using sqlManager
        if (userMember) {
          await adminUserQueries.deleteCollaboratorsByMember(db, userMember.id);
        }
        
        // MIGRATED: Update planning_periods using sqlManager
        await adminUserQueries.clearPlanningPeriodsCreatedBy(db, userId);
        
        // MIGRATED: Delete user roles using sqlManager
        await userQueries.deleteUserRoles(db, userId);
        
        // MIGRATED: Delete user settings using sqlManager
        await adminUserQueries.deleteAllUserSettings(db, userId);
        
        // MIGRATED: Delete views using sqlManager
        await adminUserQueries.deleteViewsByUser(db, userId);
        
        // MIGRATED: Delete password reset tokens using sqlManager
        await adminUserQueries.deletePasswordResetTokensByUser(db, userId);
        
        // MIGRATED: Delete user invitations using sqlManager
        await adminUserQueries.deleteUserInvitations(db, userId);
        
        // Reassign assignee + requester to chosen member (defaults to System)
        if (userMember) {
          await adminUserQueries.reassignTasksToSystemMember(db, reassignMemberId, userMember.id);
          await adminUserQueries.reassignTaskRequestersToSystemMember(db, reassignMemberId, userMember.id);
        }
        
        // MIGRATED: Delete the member record using sqlManager
        if (userMember) {
          await adminUserQueries.deleteMemberByUserId(db, userId);
        }
        
        // MIGRATED: Finally, delete the user account using sqlManager
        await adminUserQueries.deleteUser(db, userId);
        
        console.log(`🗑️ User deleted successfully: ${user.email}`);
    });

    // Remove avatar object after the user row is gone (so ref-check sees no owner)
    await deleteAvatarFileIfUnused(
      db,
      getRequestStoragePaths(req),
      user.avatar_path || user.avatarPath
    );
    
    // Publish task-updated events for all reassigned tasks (for real-time updates)
    if (tasksToReassign.length > 0) {
      const targetMember = await userQueries.getMemberById(db, reassignMemberId);
      
      if (targetMember) {
        console.log(`📤 Publishing ${tasksToReassign.length} task-updated events via ${getNotificationSystem()}`);
        for (const task of tasksToReassign) {
          // MIGRATED: Get the full updated task details using sqlManager
          const updatedTask = await taskQueries.getTaskWithRelationships(db, task.id);
          
          if (updatedTask) {
            notificationService.publish('task-updated', {
              boardId: task.boardId,
              task: updatedTask,
              timestamp: new Date().toISOString()
            }, getTenantId(req)).catch(err => {
              console.error('Failed to publish task-updated event:', err);
            });
          }
        }
        
        console.log(`✅ Published ${tasksToReassign.length} task-updated events via ${getNotificationSystem()}`);
      }
    }
    
    // Publish member-deleted event for real-time updates
    if (userMember) {
      console.log(`📤 Publishing member-deleted via ${getNotificationSystem()} for user deletion`);
      await notificationService.publish('member-deleted', {
        memberId: userMember.id,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
      console.log(`✅ Member-deleted published via ${getNotificationSystem()}`);
    }
    
    // Publish user-deleted event for real-time updates
    console.log(`📤 Publishing user-deleted via ${getNotificationSystem()}`);
    await notificationService.publish('user-deleted', {
      userId: userId,
      user: {
        id: userId,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        isActive: !!user.is_active,
        authProvider: user.auth_provider
      },
      timestamp: new Date().toISOString()
    }, getTenantId(req));
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Update member color
router.put('/:userId/color', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { userId } = req.params;
  const parsed = parseBody(updateMemberColorBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { color } = parsed.data;
  const db = getRequestDatabase(req);

  try {
    // MIGRATED: Get member info before update using sqlManager
    const member = await userQueries.getMemberByUserIdWithColor(db, userId);
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found for this user' });
    }
    
    // MIGRATED: Update member color using sqlManager
    const result = await userQueries.updateMemberColor(db, userId, color);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Member not found for this user' });
    }
    
    // Publish notification for real-time updates
    console.log(`📤 Publishing member-updated via ${getNotificationSystem()} for color change`);
    await notificationService.publish('member-updated', {
      memberId: member.id,
      member: { id: member.id, name: member.name, color: color },
      timestamp: new Date().toISOString()
    }, getTenantId(req));
    console.log(`✅ Member-updated published via ${getNotificationSystem()}`);
    
    res.json({ message: 'Member color updated successfully' });
  } catch (error) {
    console.error('Error updating member color:', error);
    res.status(500).json({ error: 'Failed to update member color' });
  }
});

// Admin avatar upload endpoint
router.post('/:userId/avatar', authenticateToken, requireRole(['admin']), avatarUpload.single('avatar'), async (req, res) => {
  const { userId } = req.params;
  const db = getRequestDatabase(req);
  
  if (!req.file) {
    return res.status(400).json({ error: 'No avatar file uploaded' });
  }

  try {
    const magic = await validateUploadedFileMagic(req.file, { mode: 'avatar' });
    if (!magic.valid) {
      return res.status(400).json({ error: magic.error });
    }

    const previous = await userQueries.getUserByIdForAdmin(db, userId);
    const previousPath = previous?.avatar_path || previous?.avatarPath || null;

    await commitUploadedFile(db, getRequestStoragePaths(req), 'avatars', req.file);
    const avatarPath = `/avatars/${req.file.filename}`;
    // MIGRATED: Update user's avatar_path using sqlManager
    await userQueries.updateUserAvatar(db, userId, avatarPath);

    await deleteAvatarFileIfUnused(db, getRequestStoragePaths(req), previousPath);
    
    // MIGRATED: Get the member ID using sqlManager
    const member = await userQueries.getMemberByUserId(db, userId);
    
    // Publish notification for real-time updates
    if (member) {
      console.log(`📤 Publishing user-profile-updated via ${getNotificationSystem()} for user:`, userId);
      await notificationService.publish('user-profile-updated', {
        userId: userId,
        memberId: member.id,
        avatarPath: avatarPath,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
      console.log(`✅ User-profile-updated published via ${getNotificationSystem()}`);
    }
    
    res.json({
      message: 'Avatar uploaded successfully',
      avatarUrl: avatarPath
    });
  } catch (error) {
    console.error('Error uploading admin avatar:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Admin avatar removal endpoint
router.delete("/:userId/avatar", authenticateToken, requireRole(["admin"]), async (req, res) => {
  const { userId } = req.params;
  const db = getRequestDatabase(req);
  
  try {
    const previous = await userQueries.getUserByIdForAdmin(db, userId);
    const previousPath = previous?.avatar_path || previous?.avatarPath || null;

    // MIGRATED: Clear avatar_path using sqlManager
    await userQueries.updateUserAvatar(db, userId, null);

    await deleteAvatarFileIfUnused(db, getRequestStoragePaths(req), previousPath);
    
    // MIGRATED: Get the member ID using sqlManager
    const member = await userQueries.getMemberByUserId(db, userId);
    
    // Publish notification for real-time updates
    if (member) {
      console.log(`📤 Publishing user-profile-updated via ${getNotificationSystem()} for user:`, userId);
      await notificationService.publish('user-profile-updated', {
        userId: userId,
        memberId: member.id,
        avatarPath: null,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
      console.log(`✅ User-profile-updated published via ${getNotificationSystem()}`);
    }
    
    res.json({ message: 'Avatar removed successfully' });
  } catch (error) {
    console.error('Error removing admin avatar:', error);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

export default router;

