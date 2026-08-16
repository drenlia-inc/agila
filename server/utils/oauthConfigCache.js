/** Per-tenant in-memory OAuth settings cache (Google SSO). */

function tenantKey(tenantId) {
  return tenantId || 'default';
}

function cacheMap() {
  if (!global.oauthConfigCacheByTenant) {
    global.oauthConfigCacheByTenant = Object.create(null);
  }
  return global.oauthConfigCacheByTenant;
}

export function getCachedOAuthEntry(tenantId) {
  return cacheMap()[tenantKey(tenantId)] || null;
}

export function setCachedOAuthSettings(tenantId, settings) {
  cacheMap()[tenantKey(tenantId)] = {
    settings,
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
  } else {
    map[key] = { settings: null, invalidated: true, timestamp: Date.now() };
  }
  if (global.oauthConfigCache) {
    global.oauthConfigCache.invalidated = true;
  }
}
