/** Per-tenant in-memory OAuth settings cache (Google SSO). */

import { getTenantDomain } from './tenantDomain.js';

function tenantKey(tenantId) {
  return tenantId || 'default';
}

function cacheMap() {
  if (!global.oauthConfigCacheByTenant) {
    global.oauthConfigCacheByTenant = Object.create(null);
  }
  return global.oauthConfigCacheByTenant;
}

/**
 * True when GOOGLE_CALLBACK_URL (if set) matches this tenant's host.
 * Rejects cross-tenant cache pollution (wrong redirect_uri after SSO).
 */
export function oauthSettingsMatchTenant(tenantId, settings) {
  if (!tenantId || !settings) return true;
  const callback = String(settings.GOOGLE_CALLBACK_URL || '').trim();
  if (!callback) return true;
  try {
    const host = new URL(callback).hostname.toLowerCase();
    const expected = `${String(tenantId).toLowerCase()}.${getTenantDomain().toLowerCase()}`;
    return host === expected;
  } catch {
    return false;
  }
}

export function getCachedOAuthEntry(tenantId) {
  const entry = cacheMap()[tenantKey(tenantId)] || null;
  if (!entry || entry.invalidated || !entry.settings) {
    return entry;
  }
  if (!oauthSettingsMatchTenant(tenantId, entry.settings)) {
    console.error(
      `🔐 [GOOGLE SSO] Rejecting cached OAuth settings for tenant "${tenantId}" — callback URL does not match tenant (got ${entry.settings.GOOGLE_CALLBACK_URL})`
    );
    entry.invalidated = true;
    entry.settings = null;
  }
  return entry;
}

export function setCachedOAuthSettings(tenantId, settings) {
  if (!oauthSettingsMatchTenant(tenantId, settings)) {
    console.error(
      `🔐 [GOOGLE SSO] Refusing to cache OAuth settings for tenant "${tenantId}" — callback URL does not match tenant (got ${settings?.GOOGLE_CALLBACK_URL})`
    );
    return;
  }
  // Clone so later decrypt/mutation cannot cross tenants via shared object refs.
  cacheMap()[tenantKey(tenantId)] = {
    settings: { ...settings },
    tenantId: tenantId || null,
    invalidated: false,
    timestamp: Date.now(),
  };
}

/** Mark this tenant's OAuth cache stale so the next Google request reloads from the DB. */
export function invalidateOAuthConfigCache(tenantId) {
  const map = cacheMap();
  const key = tenantKey(tenantId);
  if (map[key]) {
    map[key].invalidated = true;
    map[key].settings = null;
  } else {
    map[key] = { settings: null, invalidated: true, timestamp: Date.now() };
  }
  if (global.oauthConfigCache) {
    global.oauthConfigCache.invalidated = true;
  }
}
