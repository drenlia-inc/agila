import crypto from 'crypto';
import { adminPortalLimiter } from './rateLimiters.js';
import { getRequestDatabase } from './tenantRouting.js';
import { resolveInstanceToken } from '../utils/instanceToken.js';

// Admin Portal Authentication Middleware
// Validates INSTANCE_TOKEN from env (preferred) or encrypted settings (self-host Connect)

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    // Constant-time-ish reject without leaking which side differed in length via early return alone
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export const authenticateAdminPortal = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Admin portal access token required',
        message: 'Include Authorization header with Bearer token'
      });
    }

    let db = null;
    try {
      db = getRequestDatabase(req);
    } catch {
      db = null;
    }

    const instanceToken = await resolveInstanceToken(db);

    if (!instanceToken) {
      console.error('❌ INSTANCE_TOKEN not configured (env or settings)');
      return res.status(500).json({
        error: 'Instance configuration error',
        message: 'Instance token not configured'
      });
    }

    const trimmedToken = token.trim();
    if (!timingSafeEqualString(trimmedToken, instanceToken)) {
      console.warn(`⚠️ Invalid admin portal token attempt from ${req.ip}`);
      return res.status(403).json({
        error: 'Invalid admin portal token',
        message: 'The provided token does not match the instance token'
      });
    }

    // Token is valid — do not attach the secret to the request object
    req.adminPortal = {
      authenticated: true,
      instanceName: process.env.INSTANCE_NAME || 'easy-kanban-app',
      timestamp: new Date().toISOString()
    };

    console.log(
      `✅ Admin portal authenticated for instance: ${process.env.INSTANCE_NAME || 'easy-kanban-app'}`
    );
    next();
  } catch (error) {
    console.error('Admin portal auth error:', error);
    return res.status(500).json({
      error: 'Authentication failed',
      message: 'Unable to validate admin portal token'
    });
  }
};

/** Real rate limiter (express-rate-limit). Prefer this over the legacy no-op name. */
export const adminPortalRateLimit = adminPortalLimiter;
