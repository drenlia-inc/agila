import rateLimit from 'express-rate-limit';
import redisService from '../services/redisService.js';

// Determine if we should trust proxy based on environment
// This MUST match the Express 'trust proxy' setting in server/index.js
// In Docker without reverse proxy, set TRUST_PROXY=false
// In K8s with ingress, set TRUST_PROXY=1 (or number of proxies)
// Default to false for Docker, true for K8s (multi-tenant mode)
let shouldTrustProxy = false;
if (process.env.TRUST_PROXY === 'false') {
  shouldTrustProxy = false;
} else if (process.env.TRUST_PROXY) {
  const proxyCount = parseInt(process.env.TRUST_PROXY);
  shouldTrustProxy = isNaN(proxyCount) ? true : proxyCount;
} else {
  // Default: trust proxy only in multi-tenant mode (K8s with ingress)
  shouldTrustProxy = process.env.MULTI_TENANT === 'true';
}

const useRedisRateLimitStore = () =>
  process.env.MULTI_TENANT === 'true' || process.env.USE_REDIS_RATE_LIMIT === 'true';

/**
 * Cluster-safe rate limit store when Redis is available; falls back to process-local Map.
 * Used in multi-tenant / multi-pod so limits are not multiplied by replica count.
 */
class RedisOrMemoryStore {
  constructor({ windowMs, prefix }) {
    this.windowMs = windowMs;
    this.prefix = prefix;
    /** @type {Map<string, { count: number, resetTime: number }>} */
    this.local = new Map();
  }

  redisKey(key) {
    return `rl:${this.prefix}:${key}`;
  }

  incrementLocal(key) {
    const now = Date.now();
    let entry = this.local.get(key);
    if (!entry || entry.resetTime <= now) {
      entry = { count: 0, resetTime: now + this.windowMs };
    }
    entry.count += 1;
    this.local.set(key, entry);
    return {
      totalHits: entry.count,
      resetTime: new Date(entry.resetTime)
    };
  }

  async increment(key) {
    const client = useRedisRateLimitStore() ? redisService.getPublisherClient() : null;
    if (!client) {
      return this.incrementLocal(key);
    }

    try {
      const redisKey = this.redisKey(key);
      const count = await client.incr(redisKey);
      if (count === 1) {
        await client.pExpire(redisKey, this.windowMs);
      }
      let ttl = await client.pTTL(redisKey);
      if (ttl < 0) {
        await client.pExpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }
      return {
        totalHits: count,
        resetTime: new Date(Date.now() + ttl)
      };
    } catch (error) {
      console.warn(`⚠️ Rate limit Redis increment failed (${this.prefix}), using memory:`, error.message);
      return this.incrementLocal(key);
    }
  }

  async decrement(key) {
    const client = useRedisRateLimitStore() ? redisService.getPublisherClient() : null;
    if (!client) {
      const entry = this.local.get(key);
      if (entry) {
        entry.count = Math.max(0, entry.count - 1);
        this.local.set(key, entry);
      }
      return;
    }
    try {
      await client.decr(this.redisKey(key));
    } catch {
      /* ignore */
    }
  }

  async resetKey(key) {
    this.local.delete(key);
    const client = useRedisRateLimitStore() ? redisService.getPublisherClient() : null;
    if (!client) return;
    try {
      await client.del(this.redisKey(key));
    } catch {
      /* ignore */
    }
  }
}

function createLimiter({ windowMs, max, message, prefix, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    trustProxy: shouldTrustProxy,
    validate: false,
    store: new RedisOrMemoryStore({ windowMs, prefix })
  });
}

// Login rate limiter: 5 attempts per 15 minutes
export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again in 15 minutes' },
  prefix: 'login',
  skipSuccessfulRequests: true
});

// Password reset request: 3 per hour
export const passwordResetRequestLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many password reset requests, please try again in 1 hour' },
  prefix: 'pw-reset-req'
});

/** @deprecated Prefer passwordResetRequestLimiter */
export const passwordResetLimiter = passwordResetRequestLimiter;

// Password reset completion: 6 per hour
export const passwordResetCompletionLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: { error: 'Too many password reset attempts, please try again in 1 hour' },
  prefix: 'pw-reset-done'
});

// Registration rate limiter: 3 attempts per hour
export const registrationLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many registration attempts, please try again in 1 hour' },
  prefix: 'register'
});

// Invitation token pre-check (read-only): higher budget — page loads / Strict Mode remounts hit this
export const invitationVerifyLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Too many invitation checks, please try again in 1 hour' },
  prefix: 'invite-verify'
});

// Account activation (password set): 10 attempts per hour — POST only
export const activationLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many activation attempts, please try again in 1 hour' },
  prefix: 'activate'
});

// Dev credential minting (API tokens / SSH keys): 20 per hour
export const tokenMintLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many credential requests, please try again later' },
  prefix: 'token-mint'
});

// Agent task claim: 120 per 15 minutes
export const agentClaimLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many claim requests, please try again later' },
  prefix: 'agent-claim'
});

// GitHub repo probe (PAT → API): 30 per 15 minutes
export const githubRepoProbeLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many repository checks, please try again later' },
  prefix: 'gh-probe'
});

// Admin portal (INSTANCE_TOKEN): 120 requests per 15 minutes per IP
export const adminPortalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many admin portal requests, please try again later' },
  prefix: 'admin-portal'
});

// Google OAuth URL generation: 30 per 15 minutes
export const oauthUrlLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many OAuth requests, please try again later' },
  prefix: 'oauth-url'
});

// Google OAuth callback: 60 per 15 minutes
export const oauthCallbackLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many OAuth callback attempts, please try again later' },
  prefix: 'oauth-cb'
});

// CSP violation reports (public browser beacon): 60 per minute per IP
// Help Assistant chat: 30 per 15 minutes per IP
export const helpAssistantLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many help assistant requests, please try again later' },
  prefix: 'help-assistant'
});

export const cspReportLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many CSP reports' },
  prefix: 'csp-report'
});
