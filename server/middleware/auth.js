import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { getRequestDatabase } from './tenantRouting.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { userApiTokens as tokenQueries } from '../utils/sqlManager/index.js';
import { isAiEnabled } from '../utils/aiEnabled.js';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_EXPIRES_IN = '24h';

console.log('🔑 Auth middleware initialized (JWT_SECRET configured)');

function isUserActive(isActive) {
  if (isActive === false || isActive === 0 || isActive === '0' || isActive === 'false') {
    return false;
  }
  return true;
}

function isForceLogout(flag) {
  return flag === true || flag === 1 || flag === '1' || flag === 'true';
}

/** Session may proceed only when the DB user is active and not flagged for forced logout. */
function userMayUseSession(userRow) {
  if (!userRow) return false;
  if (!isUserActive(userRow.is_active)) return false;
  if (isForceLogout(userRow.force_logout)) return false;
  return true;
}

function primaryRole(roleNames) {
  const roles = Array.isArray(roleNames) ? roleNames : [];
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('user')) return 'user';
  if (roles.includes('viewer')) return 'viewer';
  return roles[0] || 'user';
}

/** True when the user may create/update/delete domain data (not read-only viewer). */
export function userCanMutate(user) {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.includes('admin') || roles.includes('user')) return true;
  if (user.role === 'admin' || user.role === 'user') return true;
  return false;
}

/**
 * Mutating routes viewers may still call.
 * Board/task/column edits remain blocked. Uses originalUrl when available (mount-safe).
 */
function isAllowedViewerMutation(req) {
  const raw = (req.originalUrl || `${req.baseUrl || ''}${req.path || ''}` || '').split('?')[0];
  const method = req.method;

  if (method === 'POST' && /\/api\/files\/media-session\/?$/.test(raw)) return true;
  if (method === 'DELETE' && /\/api\/files\/media-session\/?$/.test(raw)) return true;
  if (method === 'POST' && /\/api\/auth\/logout\/?$/.test(raw)) return true;
  // Own profile / avatar / personal settings
  if (method === 'PUT' && /\/api\/(users|user)\/profile\/?$/.test(raw)) return true;
  if (method === 'POST' && /\/api\/(users|user)\/avatar\/?$/.test(raw)) return true;
  if ((method === 'PUT' || method === 'POST') && /\/api\/(users|user)\/settings\/?$/.test(raw)) return true;
  // Comments (own edit/delete enforced in comments router)
  if (/\/api\/comments(\/|$)/.test(raw)) return true;
  // Personal saved views (shared=true rejected in views router)
  if (/\/api\/views(\/|$)/.test(raw)) return true;
  // Comment attachments (upload only; attachment DELETE stays blocked)
  if (method === 'POST' && /\/api\/upload\/?$/.test(raw)) return true;
  if (method === 'POST' && /\/api\/(users|user)\/upload\/?$/.test(raw)) return true;
  // Own watcher add/remove (self-check in the route)
  if (
    (method === 'POST' || method === 'DELETE') &&
    /\/api\/tasks\/[^/]+\/watchers\/[^/]+\/?$/.test(raw)
  ) {
    return true;
  }
  return false;
}

function enforceViewerWritePolicy(req, res) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null;
  if (!req.user || userCanMutate(req.user)) return null;
  if (isAllowedViewerMutation(req)) return null;
  return res.status(403).json({
    error: 'Read-only role cannot modify data',
    code: 'READ_ONLY'
  });
}

/**
 * Authenticate personal access tokens (ek_…). Used when JWT verification fails
 * or the bearer token looks like a PAT.
 */
async function authenticatePersonalAccessToken(req, rawToken) {
  if (!rawToken || !rawToken.startsWith('ek_')) {
    return null;
  }

  const db = getRequestDatabase(req);
  if (!db) {
    return null;
  }

  if (!(await isAiEnabled(db))) {
    return null;
  }

  // Prefix is ek_ + 8 hex chars for indexed lookup
  const prefix = rawToken.slice(0, 11);
  const candidates = await tokenQueries.getActiveTokensByPrefix(db, prefix);
  for (const row of candidates) {
    const ok = await bcrypt.compare(rawToken, row.token_hash);
    if (!ok) continue;

    const userRow = await wrapQuery(
      db.prepare('SELECT id, email, is_active, force_logout FROM users WHERE id = $1'),
      'SELECT'
    ).get(row.user_id);

    if (!userMayUseSession(userRow)) {
      return null;
    }

    const roles = await wrapQuery(
      db.prepare(`
        SELECT r.name FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = $1
      `),
      'SELECT'
    ).all(userRow.id);

    const roleNames = roles.map((r) => r.name);
    // Fire-and-forget last-used stamp
    tokenQueries.touchLastUsed(db, row.id).catch(() => {});

    return {
      id: userRow.id,
      email: userRow.email,
      role: primaryRole(roleNames),
      roles: roleNames,
      authType: 'pat',
      tokenId: row.id
    };
  }

  return null;
}

// Authentication middleware
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      console.log(`❌ [AUTH] No token provided for ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Access token required' });
    }

    // Personal access tokens for agent automation
    if (token.startsWith('ek_')) {
      const patUser = await authenticatePersonalAccessToken(req, token);
      if (!patUser) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.user = patUser;
      const denied = enforceViewerWritePolicy(req, res);
      if (denied) return denied;
      return next();
    }

    // Verify JWT token
    const user = await new Promise((resolve, reject) => {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
          console.log(`❌ [AUTH] JWT verification failed for ${req.method} ${req.path}:`, err.message);
          reject(err);
        } else {
          resolve(decoded);
        }
      });
    });

    // Media-only tokens (HttpOnly cookie / file URLs) must not authorize API routes
    if (user?.purpose === 'media') {
      console.log(`❌ [AUTH] Media token rejected for API ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Verify user still exists in the tenant DB (demo resets, deleted accounts, tenant switches).
    // Previously this ran only when MULTI_TENANT=true; single-tenant demo wipe left valid JWTs
    // for deleted user IDs and the UI got stuck off the login page.
    const db = getRequestDatabase(req);
    if (db) {
      try {
        const userInDb = await wrapQuery(
          db.prepare('SELECT id, email, is_active, force_logout FROM users WHERE id = ?'),
          'SELECT'
        ).get(user.id);
        
        if (!userInDb) {
          console.log(`❌ [AUTH] Token validation failed: User ${user.email} (${user.id}) does not exist in database`);
          return res.status(401).json({ error: 'Invalid or expired token' });
        }

        if (!userMayUseSession(userInDb)) {
          const reason = !isUserActive(userInDb.is_active) ? 'inactive' : 'force_logout';
          console.log(`❌ [AUTH] Token validation failed: User ${userInDb.email} (${userInDb.id}) is ${reason}`);
          return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const roles = await wrapQuery(
          db.prepare(`
            SELECT r.name FROM roles r
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
          `),
          'SELECT'
        ).all(userInDb.id);
        const roleNames = roles.map((r) => r.name);

        req.user = {
          id: userInDb.id,
          email: userInDb.email,
          role: primaryRole(roleNames),
          roles: roleNames,
          authType: 'jwt'
        };
        const denied = enforceViewerWritePolicy(req, res);
        if (denied) return denied;
        return next();
      } catch (dbError) {
        // Transient DB errors (pool exhaustion, lock timeouts during bulk admin
        // deletes, etc.) must not look like an invalid session — the axios
        // interceptor clears authToken on 401 and logs the user out.
        console.error('❌ [AUTH] Error checking user in database:', dbError);
        return res.status(503).json({ error: 'Authentication temporarily unavailable' });
      }
    }
    
    // No DB available (should be rare) — fall back to JWT claims only
    req.user = { ...user, authType: 'jwt' };
    const denied = enforceViewerWritePolicy(req, res);
    if (denied) return denied;
    next();
  } catch (err) {
    // Return 401 for authentication errors (invalid/expired token)
    // This distinguishes from 403 which should be used for authorization errors (insufficient permissions)
    console.error(`❌ [AUTH] Authentication error for ${req.method} ${req.path}:`, err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Role-based access control middleware
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];
    const allowed =
      roles.includes(req.user.role) ||
      userRoles.some((r) => roles.includes(r));

    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

// JWT utilities
export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

/**
 * Middleware for routes that already ran authenticateToken (or set req.user).
 * Prefer relying on authenticateToken's built-in check; export for explicit use.
 */
export const requireMutationAccess = (req, res, next) => {
  const denied = enforceViewerWritePolicy(req, res);
  if (denied) return denied;
  next();
};

export { JWT_SECRET, JWT_EXPIRES_IN, isUserActive, isForceLogout, userMayUseSession, primaryRole };
