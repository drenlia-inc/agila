import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authenticateToken, requireRole, JWT_SECRET, JWT_EXPIRES_IN, primaryRole } from '../middleware/auth.js';
import { getLicenseManager } from '../config/license.js';
import notificationService from '../services/notificationService.js';
import { loginLimiter, activationLimiter, invitationVerifyLimiter, registrationLimiter, oauthUrlLimiter, oauthCallbackLimiter } from '../middleware/rateLimiters.js';
import { createDefaultAvatar, getRandomColor } from '../utils/avatarGenerator.js';
import { getTranslator } from '../utils/i18n.js';
import { getTenantId, getRequestDatabase, getTenantDatabase, isMultiTenant } from '../middleware/tenantRouting.js';
import {
  getAuthHubCallbackUrl,
  isAuthHubHostname,
  isGoogleSsoManaged,
  isReservedTenantSubdomain,
  resolveHubCallbackReturnOrigin,
  resolveOAuthReturnOrigin,
  tenantPublicOrigin
} from '../utils/authHub.js';
import {
  isGoogleSsoLoginEnabled,
  normalizeGoogleSsoMode,
} from '../utils/googleSsoMode.js';
import { isDemoSsoDisabled } from '../constants/ssoSettings.js';
import { completeInvitedUserSso } from '../utils/ssoExternalAuth.js';
import { recordSsoLastSuccess } from '../utils/ssoLastSuccess.js';
import {
  getCachedOAuthEntry,
  invalidateOAuthConfigCache,
  setCachedOAuthSettings,
} from '../utils/oauthConfigCache.js';
// MIGRATED: Import sqlManager
import { auth as authQueries, users as userQueries, settings as settingsQueries } from '../utils/sqlManager/index.js';
import { parseBody, loginBodySchema, activateAccountBodySchema, registerBodySchema } from '../utils/requestValidation.js';
import { logMemberJoinedIfFirstTime } from '../services/activityLogger.js';
import { recordInteractiveLogin } from '../utils/recordInteractiveLogin.js';

const router = express.Router();

// Login endpoint
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = parseBody(loginBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { email, password } = parsed.data;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Find user by email using sqlManager
    const user = await authQueries.getUserByEmailForLogin(db, email);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      console.log('❌ Login failed - invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // MIGRATED: Get user roles using sqlManager
    const roles = await authQueries.getUserRoles(db, user.id);
    
    const userRoles = roles.map(r => r.name);
    
    // MIGRATED: Clear force_logout flag using sqlManager
    await authQueries.clearForceLogout(db, user.id);
    await recordInteractiveLogin(db, user.id, getTenantId(req));
    
    // Note: APP_URL is updated by the frontend after login, not here
    // The frontend knows the actual public-facing URL (window.location.origin)
    // and will call /settings/app-url endpoint if the user is the owner
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: primaryRole(userRoles),
        roles: userRoles
      }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Determine the correct avatar URL based on auth provider
    let avatarUrl = null;
    if (user.auth_provider === 'google' && user.google_avatar_url) {
      avatarUrl = user.google_avatar_url;
    } else if (user.avatar_path) {
      avatarUrl = user.avatar_path;
    }
    
    // Return user info and token
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        roles: userRoles,
        avatarUrl: avatarUrl,
        authProvider: user.auth_provider || 'local',
        googleAvatarUrl: user.google_avatar_url,
        bio: user.bio || ''
      },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Verify invitation token before showing the password form.
 * GET /api/auth/verify-invitation?token=&email=
 */
router.get('/verify-invitation', invitationVerifyLimiter, async (req, res) => {
  const token = String(req.query.token || '').trim();
  const email = String(req.query.email || '').trim().toLowerCase();
  const db = getRequestDatabase(req);

  if (!token || !email || !email.includes('@')) {
    return res.status(400).json({ valid: false, error: 'Token and email are required' });
  }

  try {
    const invitation = await authQueries.getInvitationByToken(db, token, email);

    if (!invitation) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired invitation token' });
    }

    const tokenExpiry = new Date(invitation.expires_at);
    if (Number.isNaN(tokenExpiry.getTime()) || tokenExpiry < new Date()) {
      return res.status(400).json({ valid: false, error: 'Invitation token has expired' });
    }

    const isActive = typeof invitation.is_active === 'boolean'
      ? invitation.is_active
      : (invitation.is_active === 1 || invitation.is_active === true);

    if (isActive) {
      return res.status(400).json({ valid: false, error: 'Account is already active' });
    }

    return res.json({
      valid: true,
      email: invitation.email,
      firstName: invitation.first_name || null,
      lastName: invitation.last_name || null
    });
  } catch (error) {
    console.error('Invitation verify error:', error);
    return res.status(500).json({ valid: false, error: 'Failed to verify invitation token' });
  }
});

// Account activation endpoint
router.post('/activate-account', activationLimiter, async (req, res) => {
  const parsed = parseBody(activateAccountBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { token, email, newPassword } = parsed.data;
  const db = getRequestDatabase(req);
  
  try {
    // MIGRATED: Find the invitation token using sqlManager
    const invitation = await authQueries.getInvitationByToken(db, token, email);
    
    if (!invitation) {
      return res.status(400).json({ error: 'Invalid or expired invitation token' });
    }
    
    // Check if token has expired
    const tokenExpiry = new Date(invitation.expires_at);
    if (Number.isNaN(tokenExpiry.getTime()) || tokenExpiry < new Date()) {
      return res.status(400).json({ error: 'Invitation token has expired' });
    }
    
    // Check if user is already active
    // Note: is_active might be boolean or integer depending on database
    const isActive = typeof invitation.is_active === 'boolean' 
      ? invitation.is_active 
      : (invitation.is_active === 1 || invitation.is_active === true);
    
    if (isActive) {
      return res.status(400).json({ error: 'Account is already active' });
    }
    
    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    // MIGRATED: Activate user and update password using sqlManager
    await authQueries.activateUser(db, invitation.user_id, passwordHash);
    
    // MIGRATED: Mark invitation as used using sqlManager
    await authQueries.markInvitationAsUsed(db, invitation.id);
    
    // First-time join only (skips re-activation); bilingual "joined the team"
    await logMemberJoinedIfFirstTime(invitation.user_id, {
      db,
      tenantId: getTenantId(req),
    });
    
    // MIGRATED: Get the updated user data using sqlManager
    const updatedUser = await authQueries.getUserBasicInfoForActivation(db, invitation.user_id);
    
    // Publish to Redis for real-time updates to admin panel
    const tenantId = getTenantId(req);
    console.log('📤 Publishing user-updated to Redis for account activation');
    notificationService.publish('user-updated', {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        isActive: Boolean(updatedUser.is_active),
        hasActivated: true,
        authProvider: updatedUser.auth_provider || null,
        googleAvatarUrl: updatedUser.google_avatar_url || null,
        createdAt: updatedUser.created_at,
        joined: updatedUser.created_at
      },
      timestamp: new Date().toISOString()
    }, tenantId).catch(err => {
      console.error('Failed to publish user-updated event:', err);
    });
    
    console.log('✅ Account activated successfully for:', invitation.email);
    
    res.json({ 
      message: 'Account activated successfully. You can now log in.',
      user: {
        id: invitation.user_id,
        email: invitation.email,
        firstName: invitation.first_name,
        lastName: invitation.last_name
      }
    });
    
  } catch (error) {
    console.error('Account activation error:', error);
    res.status(500).json({ error: 'Failed to activate account' });
  }
});

// Register endpoint (admin only)
router.post('/register', registrationLimiter, authenticateToken, requireRole(['admin']), async (req, res) => {
  const parsed = parseBody(registerBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const { email, password, firstName, lastName, role } = parsed.data;
  const db = getRequestDatabase(req);
  
  try {
    // Check user limit before creating new user
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
    
    // MIGRATED: Check if user already exists using sqlManager
    const existingUser = await authQueries.checkUserExists(db, email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // MIGRATED: Create user using sqlManager
    const userId = crypto.randomUUID();
    await authQueries.createUser(db, userId, email, passwordHash, firstName, lastName);
    
    // MIGRATED: Assign role using sqlManager
    const roleRecord = await userQueries.getRoleByName(db, role);
    if (roleRecord?.id) {
      await authQueries.assignRoleToUser(db, userId, roleRecord.id);
    }
    
    // MIGRATED: Create member for the user using sqlManager
    const memberId = crypto.randomUUID();
    const memberColor = getRandomColor(); // Random color from palette
    await authQueries.createMemberForUser(db, memberId, `${firstName} ${lastName}`, memberColor, userId);
    
    // MIGRATED: Update user avatar path using sqlManager
    const tenantId = getTenantId(req);
    const avatarPath = await createDefaultAvatar(`${firstName} ${lastName}`, userId, memberColor, tenantId, {
      db,
      storagePaths: req.locals?.tenantStoragePaths || req.app.locals?.tenantStoragePaths
    });
    if (avatarPath) {
      await authQueries.updateUserAvatarPath(db, userId, avatarPath);
    }
    
    res.json({ 
      message: 'User created successfully',
      user: { id: userId, email, firstName, lastName, role }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get current user endpoint
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get user using sqlManager
    const user = await userQueries.getUserById(db, req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // MIGRATED: Get user roles using sqlManager
    const roles = await authQueries.getUserRoles(db, user.id);
    
    const userRoles = roles.map(r => r.name);
    
    // Determine the correct avatar URL based on auth provider
    // Note: getUserById returns camelCase fields (avatarPath, googleAvatarUrl, authProvider)
    let avatarUrl = null;
    if (user.authProvider === 'google' && user.googleAvatarUrl) {
      avatarUrl = user.googleAvatarUrl;
    } else if (user.avatarPath) {
      avatarUrl = user.avatarPath;
    }
    
    // Generate a fresh JWT token with current roles (important for role changes)
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        role: primaryRole(userRoles),
        roles: userRoles
      }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: userRoles,
        avatarUrl: avatarUrl,
        authProvider: user.authProvider || 'local',
        googleAvatarUrl: user.googleAvatarUrl,
        bio: user.bio || ''
      },
      token: token // Include fresh token with updated roles
    });
    
  } catch (error) {
    console.error('Auth/me error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Check if default admin exists
router.get('/check-default-admin', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Check user exists using sqlManager
    const defaultAdmin = await authQueries.checkUserExistsByEmail(db, 'admin@kanban.local');
    res.json({ exists: !!defaultAdmin });
  } catch (error) {
    console.error('Error checking default admin:', error);
    res.status(500).json({ error: 'Failed to check default admin' });
  }
});

// Get demo admin credentials (demo deployments only)
router.get('/demo-credentials', async (req, res) => {
  try {
    if (process.env.DEMO_ENABLED !== 'true') {
      return res.status(404).json({ error: 'Not found' });
    }

    // Prevent browsers/proxies from caching passwords across demo resets
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0'
    });

    const db = getRequestDatabase(req);
    const adminPasswordSetting = await authQueries.getSetting(db, 'ADMIN_PASSWORD');
    const adminPassword = adminPasswordSetting?.value;

    // Do not invent a fake "admin" password — clients wait until seed finished.
    if (!adminPassword) {
      return res.status(503).json({
        ready: false,
        admin: null
      });
    }

    res.json({
      ready: true,
      admin: {
        email: 'admin@kanban.local',
        password: adminPassword
      }
    });
  } catch (error) {
    console.error('Error getting demo credentials:', error);
    res.status(500).json({ error: 'Failed to get demo credentials', ready: false });
  }
});

function isGoogleSsoDebugEnabled(settingsObj) {
  return settingsObj?.SERVER_DEBUG_GOOGLE_SSO === 'true' || settingsObj?.GOOGLE_SSO_DEBUG === 'true';
}

// Helper function for conditional debug logging
function debugLog(settingsObj, ...args) {
  if (isGoogleSsoDebugEnabled(settingsObj)) {
    console.log(...args);
  }
}

// Helper function to get OAuth settings with caching
async function getOAuthSettings(db, tenantId) {
  const cached = getCachedOAuthEntry(tenantId);
  if (cached && !cached.invalidated && cached.settings) {
    console.log(`🔄 [GOOGLE SSO] Using cached OAuth settings (tenant=${tenantId || 'default'})`);
    return cached.settings;
  }

  const settingsObj = await authQueries.getOAuthSettings(db);
  if (
    tenantId &&
    settingsObj.GOOGLE_CALLBACK_URL &&
    !isGoogleSsoManaged(settingsObj) &&
    !String(settingsObj.GOOGLE_CALLBACK_URL).includes(`${tenantId}.`)
  ) {
    console.error(
      `🔐 [GOOGLE SSO] Loaded callback URL does not match tenant "${tenantId}" (schema=${db?.schema || '?'}): ${settingsObj.GOOGLE_CALLBACK_URL}`
    );
  }
  setCachedOAuthSettings(tenantId, settingsObj);
  
  // Always log basic OAuth config status, detailed logs only if debug enabled
  const oauthKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'];
  console.log(
    '🔄 [GOOGLE SSO] OAuth settings loaded:',
    `tenant=${tenantId || 'default'}`,
    `schema=${db?.schema || '?'}`,
    oauthKeys.map((k) => `${k}: ${settingsObj[k] ? '✓' : '✗'}`).join(', '),
    `callback=${settingsObj.GOOGLE_CALLBACK_URL || 'NOT_SET'}`,
    `[DEBUG: ${isGoogleSsoDebugEnabled(settingsObj) ? 'ON' : 'OFF'}]`
  );
  debugLog(settingsObj, '🔄 [GOOGLE SSO] OAuth settings details:', {
    GOOGLE_CLIENT_ID: settingsObj.GOOGLE_CLIENT_ID ? `${settingsObj.GOOGLE_CLIENT_ID.substring(0, 20)}...` : 'NOT_SET',
    GOOGLE_CLIENT_SECRET: settingsObj.GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT_SET',
    GOOGLE_CALLBACK_URL: settingsObj.GOOGLE_CALLBACK_URL || 'NOT_SET',
    DEBUG_ENABLED: isGoogleSsoDebugEnabled(settingsObj)
  });
  
  return settingsObj;
}

// Google OAuth endpoints
const OAUTH_STATE_TTL = '10m';

function createOAuthState({
  tenantId = null,
  managed = false,
  returnOrigin = '',
  purpose = 'google_oauth',
} = {}) {
  return jwt.sign(
    {
      purpose,
      nonce: crypto.randomBytes(16).toString('hex'),
      ...(tenantId ? { tenantId } : {}),
      ...(managed ? { managed: true } : {}),
      ...(returnOrigin ? { returnOrigin } : {})
    },
    JWT_SECRET,
    { expiresIn: OAUTH_STATE_TTL }
  );
}

function verifyOAuthState(state, { requireTenant = false } = {}) {
  if (!state || typeof state !== 'string') {
    return null;
  }
  try {
    const payload = jwt.verify(state, JWT_SECRET);
    const purpose = String(payload?.purpose || '');
    if (!purpose.endsWith('_oauth') || typeof payload?.nonce !== 'string') {
      return null;
    }
    if (requireTenant) {
      const tenantId = String(payload.tenantId || '').trim().toLowerCase();
      if (!tenantId) return null;
      return { ...payload, tenantId };
    }
    return payload;
  } catch {
    return null;
  }
}

/** Managed SSO must use the tenant-stored hub callback (same URI Google authorized). */
function managedGoogleRedirectUri(settingsObj) {
  const fromSettings = String(settingsObj?.GOOGLE_CALLBACK_URL || '').trim();
  if (fromSettings) return fromSettings;
  return getAuthHubCallbackUrl();
}

function peekOAuthState(state) {
  if (!state || typeof state !== 'string') return null;
  try {
    const payload = jwt.decode(state);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function oauthRedirect(res, pathAndQuery, origin = '') {
  const dest = origin ? `${origin}${pathAndQuery}` : pathAndQuery;
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  return res.redirect(302, dest);
}

router.get('/google/url', oauthUrlLimiter, async (req, res) => {
  try {
    if (isDemoSsoDisabled()) {
      return res.status(404).json({ error: 'Not found' });
    }
    const db = getRequestDatabase(req);
    if (req.authHub) {
      return res.status(404).json({ error: 'Not found' });
    }

    const settingsObj = await getOAuthSettings(db, getTenantId(req));
    const ssoMode = normalizeGoogleSsoMode(settingsObj.GOOGLE_SSO_MODE, {
      managedFlag: settingsObj.GOOGLE_SSO_MANAGED,
      clientId: settingsObj.GOOGLE_CLIENT_ID,
    });
    if (!isGoogleSsoLoginEnabled(ssoMode)) {
      return res.status(400).json({ error: 'Google sign-in is disabled' });
    }
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Starting Google OAuth URL generation...');
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Request headers:', {
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer,
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...'
    });
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] OAuth settings validation:', {
      hasClientId: !!settingsObj.GOOGLE_CLIENT_ID,
      hasClientSecret: !!settingsObj.GOOGLE_CLIENT_SECRET,
      hasCallbackUrl: !!settingsObj.GOOGLE_CALLBACK_URL,
      callbackUrl: settingsObj.GOOGLE_CALLBACK_URL || 'NOT_SET',
      clientIdPrefix: settingsObj.GOOGLE_CLIENT_ID ? settingsObj.GOOGLE_CLIENT_ID.substring(0, 20) + '...' : 'NOT_SET'
    });
    
    const tenantId = getTenantId(req);
    const useHub =
      isGoogleSsoManaged(settingsObj) &&
      (isMultiTenant() ? Boolean(tenantId) : true);
    const redirectUri = useHub ? managedGoogleRedirectUri(settingsObj) : settingsObj.GOOGLE_CALLBACK_URL;

    if (!settingsObj.GOOGLE_CLIENT_ID || !settingsObj.GOOGLE_CLIENT_SECRET || !redirectUri) {
      console.error('🔐 [GOOGLE SSO] ❌ OAuth not fully configured');
      return res.status(400).json({ error: 'Google OAuth not fully configured. Please set Client ID, Client Secret, and Callback URL.' });
    }

    const returnOrigin =
      useHub && !isMultiTenant() ? resolveOAuthReturnOrigin(req) : '';
    const state = createOAuthState({
      tenantId: tenantId || (useHub ? tenantId : null),
      managed: useHub,
      returnOrigin
    });
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(settingsObj.GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&state=${encodeURIComponent(state)}` +
      `&access_type=offline`;
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] ✅ Generated OAuth URL successfully');
    debugLog(settingsObj, '🔐 [GOOGLE SSO] OAuth URL components:', {
      baseUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      clientId: settingsObj.GOOGLE_CLIENT_ID.substring(0, 20) + '...',
      redirectUri,
      scope: 'openid email profile'
    });
    
    res.json({ url: googleAuthUrl });
  } catch (error) {
    console.error('🔐 [GOOGLE SSO] ❌ Error generating OAuth URL:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

router.get('/google/callback', oauthCallbackLimiter, async (req, res) => {
  let redirectOrigin = '';
  try {
    if (isDemoSsoDisabled() && !req.authHub) {
      return oauthRedirect(res, '/?error=oauth_failed', '');
    }
    const { code, error, error_description, state } = req.query;
    const hubHost = Boolean(req.authHub) || isAuthHubHostname(
      String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0]
    );
    let tenantId = getTenantId(req);
    let db = getRequestDatabase(req);

    if (hubHost) {
      const needTenant = isMultiTenant();
      const payload = verifyOAuthState(state, { requireTenant: needTenant });
      if (!payload) {
        const peeked = peekOAuthState(state);
        const guessTenant = String(peeked?.tenantId || '').trim().toLowerCase();
        const origin =
          guessTenant && !isReservedTenantSubdomain(guessTenant)
            ? tenantPublicOrigin(guessTenant)
            : '';
        if (origin) {
          return oauthRedirect(res, '/?error=oauth_invalid_state', origin);
        }
        return res.status(400).type('text/plain').send('Invalid OAuth state');
      }
      if (needTenant) {
        tenantId = payload.tenantId;
        if (isReservedTenantSubdomain(tenantId)) {
          return res.status(400).type('text/plain').send('Unknown tenant');
        }
        redirectOrigin = tenantPublicOrigin(tenantId);
        if (!redirectOrigin) {
          return res.status(400).type('text/plain').send('Unknown tenant');
        }
        const dbInfo = await getTenantDatabase(tenantId);
        db = dbInfo.db;
        req.tenantId = tenantId;
      } else {
        const dbInfo = await getTenantDatabase(null);
        db = dbInfo.db;
        redirectOrigin = resolveHubCallbackReturnOrigin(payload);
        if (!redirectOrigin) {
          console.error(
            '🔐 [GOOGLE SSO] ❌ Hub callback missing return origin (set AUTH_HUB_RETURN_ORIGIN or ALLOWED_ORIGINS)'
          );
          return res.status(500).type('text/plain').send('OAuth return origin is not configured');
        }
      }
      if (!req.locals) req.locals = {};
      req.locals.db = db;
    }

    if (!db) {
      console.error('🔐 [GOOGLE SSO] ❌ No tenant database for Google callback');
      return oauthRedirect(res, '/?error=oauth_failed', redirectOrigin);
    }

    // Get OAuth settings first to check debug mode
    const settingsObj = await getOAuthSettings(db, tenantId);
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] ======== CALLBACK STARTED ========');
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Raw callback URL:', req.originalUrl);
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Callback request details:', {
      host: req.headers.host,
      url: req.url,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      query: req.query,
      hasCode: !!code,
      codeLength: code ? code.length : 0,
      hasState: !!state
    });
    
    // Check for OAuth errors from Google
    if (error) {
      console.error('🔐 [GOOGLE SSO] ❌ OAuth error from Google:', {
        error,
        error_description,
        query: req.query
      });
      return oauthRedirect(res, `/?error=oauth_${error}`, redirectOrigin);
    }
    
    if (!code) {
      console.error('🔐 [GOOGLE SSO] ❌ No authorization code received');
      return oauthRedirect(res, '/?error=oauth_failed', redirectOrigin);
    }

    if (!hubHost && !verifyOAuthState(state)) {
      console.error('🔐 [GOOGLE SSO] ❌ Invalid or missing OAuth state');
      return oauthRedirect(res, '/?error=oauth_invalid_state', redirectOrigin);
    }
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] ✅ Authorization code received successfully');
    
    const useHub =
      hubHost ||
      (isGoogleSsoManaged(settingsObj) && (isMultiTenant() ? Boolean(tenantId) : true));
    const redirectUri = useHub ? managedGoogleRedirectUri(settingsObj) : settingsObj.GOOGLE_CALLBACK_URL;

    if (!settingsObj.GOOGLE_CLIENT_ID || !settingsObj.GOOGLE_CLIENT_SECRET || !redirectUri) {
      console.error('🔐 [GOOGLE SSO] ❌ OAuth settings not configured in callback');
      return oauthRedirect(res, '/?error=oauth_not_configured', redirectOrigin);
    }
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Preparing token exchange with Google...');
    
    // Exchange code for access token
    const tokenPayload = {
      client_id: settingsObj.GOOGLE_CLIENT_ID,
      client_secret: settingsObj.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    };
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Token exchange payload:', {
      client_id: settingsObj.GOOGLE_CLIENT_ID.substring(0, 20) + '...',
      grant_type: tokenPayload.grant_type,
      redirect_uri: tokenPayload.redirect_uri,
      codeLength: code.length
    });
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenPayload)
    });
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Token exchange response:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      ok: tokenResponse.ok
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('🔐 [GOOGLE SSO] ❌ Google token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText,
        tenantId: tenantId || null,
        redirect_uri: redirectUri
      });
      return oauthRedirect(res, '/?error=oauth_token_failed', redirectOrigin);
    }
    
    const tokenData = await tokenResponse.json();
    debugLog(settingsObj, '🔐 [GOOGLE SSO] ✅ Token exchange successful:', {
      hasAccessToken: !!tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in
    });
    
    // Get user info from Google
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Fetching user info from Google...');
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] User info response:', {
      status: userInfoResponse.status,
      statusText: userInfoResponse.statusText,
      ok: userInfoResponse.ok
    });
    
    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      console.error('🔐 [GOOGLE SSO] ❌ Google user info failed:', {
        status: userInfoResponse.status,
        statusText: userInfoResponse.statusText,
        error: errorText
      });
      return oauthRedirect(res, '/?error=oauth_userinfo_failed', redirectOrigin);
    }
    
    const userInfo = await userInfoResponse.json();
    debugLog(settingsObj, '🔐 [GOOGLE SSO] ✅ User info received from Google:', {
      email: userInfo.email,
      name: userInfo.name,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      picture: userInfo.picture ? 'provided' : 'not_provided',
      verified_email: userInfo.verified_email
    });
    
    // MIGRATED: Check if user exists using sqlManager
    debugLog(settingsObj, '🔐 [GOOGLE SSO] Checking if user exists in database...');
    let user = await authQueries.getUserByEmail(db, userInfo.email);
    let isNewUser = false;
    
    debugLog(settingsObj, '🔐 [GOOGLE SSO] User lookup result:', {
      userExists: !!user,
      userEmail: userInfo.email
    });
    
    if (!user) {
      console.log('🔐 [GOOGLE SSO] ❌ User not found in system:', userInfo.email);
      debugLog(settingsObj, '🔐 [GOOGLE SSO] User must be invited first before using Google OAuth');
      return oauthRedirect(res, '/?error=user_not_invited', redirectOrigin);
    } else {
      console.log('🔐 [GOOGLE SSO] ✅ Existing user found, checking if active...');
      
      // Check if user is active
      if (!user.is_active) {
        // Special case: invited user (local auth, inactive) logging in with Google for the first time
        if (user.auth_provider === 'local') {
          console.log('🔐 [GOOGLE SSO] 🎯 Invited user activating via Google SSO:', userInfo.email);
          debugLog(settingsObj, '🔐 [GOOGLE SSO] Auto-activating invited user via Google OAuth');
          
          try {
            // MIGRATED: Activate the account and convert to Google auth using sqlManager
            await authQueries.updateUserAuthProvider(db, user.id, 'google', userInfo.picture, true);
            
            // MIGRATED: Clean up any pending invitation tokens using sqlManager
            await authQueries.deletePendingInvitations(db, user.id);
            
            console.log('🔐 [GOOGLE SSO] ✅ Invited user activated and converted to Google auth');
            
            // Update user object to reflect activation
            user.is_active = true;
            user.auth_provider = 'google';

            await logMemberJoinedIfFirstTime(user.id, {
              db,
              tenantId: getTenantId(req),
            });
            
            // MIGRATED: Get member info using sqlManager
            const memberInfo = await authQueries.getMemberByUserId(db, user.id);
            
            // Publish to Redis for real-time updates
            console.log('📤 Publishing user-updated and member-updated to Redis for Google OAuth activation');
            
            // Publish user-updated for admin panel
            const tenantId = getTenantId(req);
            notificationService.publish('user-updated', {
              user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                isActive: true,
                authProvider: 'google',
                googleAvatarUrl: userInfo.picture,
                createdAt: user.created_at,
                joined: user.created_at
              },
              timestamp: new Date().toISOString()
            }, tenantId).catch(err => {
              console.error('Failed to publish user-updated event:', err);
            });
            
            // Publish member-updated for Kanban board team members list
            if (memberInfo) {
              notificationService.publish('member-updated', {
                memberId: memberInfo.id,
                member: {
                  id: memberInfo.id,
                  name: memberInfo.name,
                  color: memberInfo.color,
                  userId: user.id
                },
                timestamp: new Date().toISOString()
              }, tenantId).catch(err => {
                console.error('Failed to publish member-updated event:', err);
              });
            }
          } catch (error) {
            console.error('🔐 [GOOGLE SSO] ❌ Failed to activate invited user:', error);
            return oauthRedirect(res, '/?error=activation_failed', redirectOrigin);
          }
        } else {
          // User was previously active but has been deactivated (not an invitation case)
          console.log('🔐 [GOOGLE SSO] ❌ User account is deactivated:', userInfo.email);
          debugLog(settingsObj, '🔐 [GOOGLE SSO] Deactivated user attempted to login via Google OAuth');
          return oauthRedirect(res, '/?error=account_deactivated', redirectOrigin);
        }
      } else {
        console.log('🔐 [GOOGLE SSO] ✅ User is active, proceeding with login');
        
        // MIGRATED: Update auth_provider to 'google' and store Google avatar using sqlManager
        if (user.auth_provider !== 'google') {
          console.log('🔐 [GOOGLE SSO] Converting user from local to Google auth...');
          try {
            await authQueries.updateUserAuthProvider(db, user.id, 'google', userInfo.picture, false);
            console.log('🔐 [GOOGLE SSO] ✅ User auth_provider updated to google');
          } catch (error) {
            console.error('🔐 [GOOGLE SSO] ❌ Failed to update auth_provider:', error);
          }
        } else {
          // MIGRATED: Just update the Google avatar using sqlManager
          try {
            await authQueries.updateGoogleAvatarUrl(db, user.id, userInfo.picture);
          } catch (error) {
            console.error('🔐 [GOOGLE SSO] ❌ Failed to update Google avatar:', error);
          }
        }
      }
    }
    
    // MIGRATED: Get user roles using sqlManager
    console.log('🔐 [GOOGLE SSO] Fetching user roles...');
    const roles = await authQueries.getUserRoles(db, user.id);
    
    const userRoles = roles.map(r => r.name);
    console.log('🔐 [GOOGLE SSO] User roles found:', userRoles);
    
    // MIGRATED: Clear force_logout flag using sqlManager
    await authQueries.clearForceLogout(db, user.id);
    await recordInteractiveLogin(db, user.id, getTenantId(req));
    
    // Note: APP_URL is updated by the frontend after login, not here
    // The frontend knows the actual public-facing URL (window.location.origin)
    // and will call /settings/app-url endpoint if the user is the owner
    
    // Generate JWT token - must match local login structure
    console.log('🔐 [GOOGLE SSO] Generating JWT token...');
    const jwtPayload = { 
      id: user.id, 
      email: user.email,
      role: primaryRole(userRoles),
      roles: userRoles,
      ...(tenantId ? { tenantId } : {})
    };
    
    const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    await recordSsoLastSuccess(db, 'google', getTenantId(req));
    console.log('🔐 [GOOGLE SSO] ✅ JWT token generated:', {
      userId: user.id,
      email: user.email,
      role: jwtPayload.role,
      roles: userRoles,
      tokenLength: token.length
    });
    
    // Redirect to login page with token and newUser flag
    console.log('🔐 [GOOGLE SSO] ======== AUTHENTICATION COMPLETE ========');
    if (isNewUser) {
      oauthRedirect(res, `/#login?token=${token}&newUser=true`, redirectOrigin);
    } else {
      oauthRedirect(res, `/#login?token=${token}`, redirectOrigin);
    }
    
  } catch (error) {
    console.error('🔐 [GOOGLE SSO] ❌ ======== AUTHENTICATION FAILED ========');
    console.error('🔐 [GOOGLE SSO] ❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    console.error('🔐 [GOOGLE SSO] ❌ Request context:', {
      url: req.url,
      query: req.query,
      headers: {
        host: req.headers.host,
        referer: req.headers.referer,
        userAgent: req.headers['user-agent']?.substring(0, 100)
      }
    });
    oauthRedirect(res, '/?error=oauth_failed', redirectOrigin);
  }
});

function simpleSsoEnabled(settingsObj, modeKey, clientIdKey, secretKey, callbackKey) {
  const mode = String(settingsObj[modeKey] || '').trim().toLowerCase();
  const enabled = mode === 'byo' || (!mode && String(settingsObj[clientIdKey] || '').trim());
  return Boolean(
    enabled &&
      settingsObj[clientIdKey] &&
      settingsObj[secretKey] &&
      settingsObj[callbackKey]
  );
}

router.get('/github/url', oauthUrlLimiter, async (req, res) => {
  try {
    if (isDemoSsoDisabled() || req.authHub) {
      return res.status(404).json({ error: 'Not found' });
    }
    const db = getRequestDatabase(req);
    const settingsObj = await getOAuthSettings(db, getTenantId(req));
    if (!simpleSsoEnabled(settingsObj, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL')) {
      return res.status(400).json({ error: 'GitHub sign-in is disabled' });
    }
    const state = createOAuthState({ purpose: 'github_oauth' });
    const url =
      `https://github.com/login/oauth/authorize?` +
      `client_id=${encodeURIComponent(settingsObj.GITHUB_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(settingsObj.GITHUB_CALLBACK_URL)}` +
      `&scope=${encodeURIComponent('read:user user:email')}` +
      `&state=${encodeURIComponent(state)}`;
    res.json({ url });
  } catch (error) {
    console.error('GitHub OAuth URL error:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

router.get('/github/callback', oauthCallbackLimiter, async (req, res) => {
  try {
    if (isDemoSsoDisabled()) {
      return oauthRedirect(res, '/?error=oauth_failed');
    }
    const { code, error, state } = req.query;
    if (error || !code || !verifyOAuthState(state)) {
      return oauthRedirect(res, '/?error=oauth_failed');
    }
    const db = getRequestDatabase(req);
    const settingsObj = await getOAuthSettings(db, getTenantId(req));
    if (!simpleSsoEnabled(settingsObj, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL')) {
      return oauthRedirect(res, '/?error=oauth_not_configured');
    }
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: settingsObj.GITHUB_CLIENT_ID,
        client_secret: settingsObj.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: settingsObj.GITHUB_CALLBACK_URL,
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return oauthRedirect(res, '/?error=oauth_token_failed');
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'Agila' },
    });
    const ghUser = await userRes.json();
    let email = String(ghUser.email || '').trim();
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'Agila' },
      });
      const emails = await emailsRes.json();
      const primary = Array.isArray(emails)
        ? emails.find((row) => row.primary && row.verified) || emails.find((row) => row.verified)
        : null;
      email = String(primary?.email || '').trim();
    }
    if (!email) {
      return oauthRedirect(res, '/?error=oauth_userinfo_failed');
    }
    const finished = await completeInvitedUserSso(db, req, {
      email,
      avatarUrl: ghUser.avatar_url || '',
      provider: 'github',
    });
    if (!finished.ok) {
      return oauthRedirect(res, `/?error=${finished.error}`);
    }
    await recordSsoLastSuccess(db, 'github', getTenantId(req));
    return oauthRedirect(res, `/#login?token=${finished.token}`);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    return oauthRedirect(res, '/?error=oauth_failed');
  }
});

router.get('/microsoft/url', oauthUrlLimiter, async (req, res) => {
  try {
    if (isDemoSsoDisabled() || req.authHub) {
      return res.status(404).json({ error: 'Not found' });
    }
    const db = getRequestDatabase(req);
    const settingsObj = await getOAuthSettings(db, getTenantId(req));
    if (!simpleSsoEnabled(settingsObj, 'M365_SSO_MODE', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET', 'M365_CALLBACK_URL')) {
      return res.status(400).json({ error: 'Microsoft sign-in is disabled' });
    }
    const tenant = String(settingsObj.M365_TENANT_ID || 'common').trim() || 'common';
    const state = createOAuthState({ purpose: 'm365_oauth' });
    const url =
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(settingsObj.M365_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(settingsObj.M365_CALLBACK_URL)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('openid profile email User.Read')}` +
      `&state=${encodeURIComponent(state)}`;
    res.json({ url });
  } catch (error) {
    console.error('Microsoft OAuth URL error:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

router.get('/microsoft/callback', oauthCallbackLimiter, async (req, res) => {
  try {
    if (isDemoSsoDisabled()) {
      return oauthRedirect(res, '/?error=oauth_failed');
    }
    const { code, error, state } = req.query;
    if (error || !code || !verifyOAuthState(state)) {
      return oauthRedirect(res, '/?error=oauth_failed');
    }
    const db = getRequestDatabase(req);
    const settingsObj = await getOAuthSettings(db, getTenantId(req));
    if (!simpleSsoEnabled(settingsObj, 'M365_SSO_MODE', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET', 'M365_CALLBACK_URL')) {
      return oauthRedirect(res, '/?error=oauth_not_configured');
    }
    const tenant = String(settingsObj.M365_TENANT_ID || 'common').trim() || 'common';
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settingsObj.M365_CLIENT_ID,
          client_secret: settingsObj.M365_CLIENT_SECRET,
          code: String(code),
          grant_type: 'authorization_code',
          redirect_uri: settingsObj.M365_CALLBACK_URL,
          scope: 'openid profile email User.Read',
        }),
      }
    );
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return oauthRedirect(res, '/?error=oauth_token_failed');
    }
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();
    const email = String(me.mail || me.userPrincipalName || '').trim();
    if (!email) {
      return oauthRedirect(res, '/?error=oauth_userinfo_failed');
    }
    const finished = await completeInvitedUserSso(db, req, {
      email,
      avatarUrl: '',
      provider: 'microsoft',
    });
    if (!finished.ok) {
      return oauthRedirect(res, `/?error=${finished.error}`);
    }
    await recordSsoLastSuccess(db, 'm365', getTenantId(req));
    return oauthRedirect(res, `/#login?token=${finished.token}`);
  } catch (error) {
    console.error('Microsoft OAuth callback error:', error);
    return oauthRedirect(res, '/?error=oauth_failed');
  }
});

// Manual OAuth config reload endpoint (for testing)
router.post('/reload-oauth', authenticateToken, requireRole(['admin']), (req, res) => {
  try {
    invalidateOAuthConfigCache(getTenantId(req));
    console.log('🔄 Manual OAuth config reload triggered by admin');
    res.json({ message: 'OAuth configuration reloaded successfully' });
  } catch (error) {
    console.error('Reload OAuth error:', error);
    res.status(500).json({ error: 'Failed to reload OAuth configuration' });
  }
});

// Test endpoint to verify callback routing — disabled in production unless ALLOW_TEST_ENDPOINTS=true
router.get('/test/callback', async (req, res) => {
  const allowed =
    process.env.NODE_ENV !== 'production' ||
    process.env.ALLOW_TEST_ENDPOINTS === 'true';
  if (!allowed) {
    return res.status(404).json({ error: 'Not Found' });
  }

  console.log('🧪 [TEST] Callback test endpoint hit!', {
    url: req.url,
    query: req.query,
    headers: {
      host: req.headers.host,
      'x-forwarded-host': req.headers['x-forwarded-host'],
      'x-forwarded-proto': req.headers['x-forwarded-proto'],
      origin: req.headers.origin,
      referer: req.headers.referer
    }
  });
  res.json({ 
    message: 'Callback routing test successful!', 
    timestamp: new Date().toISOString(),
    receivedAt: `${req.protocol}://${req.get('host')}${req.originalUrl}`
  });
});

// Debug endpoint to check OAuth configuration (Admin only)
router.get('/debug/oauth', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    console.log('🔍 [DEBUG] OAuth configuration debug requested by admin');
    const db = getRequestDatabase(req);
    const settingsObj = await getOAuthSettings(db, getTenantId(req));
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      server: {
        nodeVersion: process.version,
        platform: process.platform,
        host: req.headers.host,
        protocol: req.protocol,
        baseUrl: `${req.protocol}://${req.get('host')}`
      },
      oauth: {
        hasClientId: !!settingsObj.GOOGLE_CLIENT_ID,
        hasClientSecret: !!settingsObj.GOOGLE_CLIENT_SECRET,
        hasCallbackUrl: !!settingsObj.GOOGLE_CALLBACK_URL,
        clientIdPrefix: settingsObj.GOOGLE_CLIENT_ID ? settingsObj.GOOGLE_CLIENT_ID.substring(0, 20) + '...' : 'NOT_SET',
        callbackUrl: settingsObj.GOOGLE_CALLBACK_URL || 'NOT_SET'
      },
      environment: {
        JWT_SECRET_LENGTH: JWT_SECRET ? JWT_SECRET.length : 0,
        JWT_EXPIRES_IN,
        cacheStatus: getCachedOAuthEntry(getTenantId(req))?.invalidated === false ? 'ACTIVE' : 'STALE_OR_EMPTY'
      }
    };
    
    console.log('🔍 [DEBUG] OAuth debug info:', debugInfo);
    res.json(debugInfo);
  } catch (error) {
    console.error('🔍 [DEBUG] OAuth debug error:', error);
    res.status(500).json({ error: 'Failed to get OAuth debug info' });
  }
});

// Check instance status for logged-in users
router.get('/instance-status', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = await getTranslator(db);
    // MIGRATED: Get setting using sqlManager
    const statusSetting = await authQueries.getSetting(db, 'INSTANCE_STATUS');
    const status = statusSetting?.value || 'active';
    
    const getStatusMessage = (status) => {
      switch (status) {
        case 'active':
          return 'This instance is running normally.'; // Active status doesn't need translation as it's not shown
        case 'suspended':
          return t('instanceStatus.suspended');
        case 'terminated':
          return t('instanceStatus.terminated');
        case 'failed':
          return t('instanceStatus.failed');
        case 'deploying':
          return t('instanceStatus.deploying');
        default:
          return t('instanceStatus.unavailable');
      }
    };
    
    res.json({
      status: status,
      isActive: status === 'active',
      message: getStatusMessage(status),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error checking instance status:', error);
    res.status(500).json({ error: 'Failed to check instance status' });
  }
});

// Check if current user is instance owner
router.get('/is-owner', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get setting using sqlManager
    const ownerSetting = await authQueries.getSetting(db, 'OWNER');
    const ownerEmail = ownerSetting?.value || null;
    
    const isOwner = ownerEmail === req.user.email;
    
    res.json({
      isOwner: isOwner,
      ownerEmail: ownerEmail,
      currentUser: req.user.email
    });
  } catch (error) {
    console.error('Error checking owner status:', error);
    res.status(500).json({ error: 'Failed to check owner status' });
  }
});

// License info endpoint (Admin only)
router.get('/license-info', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const licenseManager = getLicenseManager(getRequestDatabase(req));
    const licenseInfo = await licenseManager.getLicenseInfo();
    
    res.json(licenseInfo);
  } catch (error) {
    console.error('Error fetching license info:', error);
    res.status(500).json({ error: 'Failed to fetch license info' });
  }
});

export default router;
