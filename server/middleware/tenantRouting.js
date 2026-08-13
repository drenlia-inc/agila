/**
 * Tenant Routing Middleware
 * 
 * Extracts tenant ID from hostname and loads the appropriate database.
 * Supports both multi-tenant (Kubernetes) and single-tenant (Docker) modes.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from '../config/database.js';
import notificationService from '../services/notificationService.js';
import { getTenantDomain } from '../utils/tenantDomain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Database connection cache (tenantId -> Database instance)
const dbCache = new Map();

// Check if multi-tenant mode is enabled
const isMultiTenant = () => {
  return process.env.MULTI_TENANT === 'true';
};

/**
 * Hostname used for tenant extraction (must match {tenantId}.{TENANT_DOMAIN}).
 * - Prefer X-Forwarded-Host / X-Original-Host / Host in that order (ingress usually sets these).
 * - If a header lists multiple hosts (comma-separated proxy chain), use the first hop (client-facing host).
 * - Strip port so tenant.agila.dev:443 still resolves.
 */
function pickHostnameForTenant(req) {
  const forwardedHost = req.get('x-forwarded-host');
  const originalHost = req.get('x-original-host');
  const hostHeader = req.get('host');
  const raw = forwardedHost || originalHost || hostHeader || req.hostname || '';
  const firstHop = String(raw).split(',')[0].trim();
  return firstHop.split(':')[0].trim() || '';
}

// Extract tenant ID from hostname
// Examples:
//   customer1.agila.dev -> customer1
//   customer2.agila.dev -> customer2
//   localhost -> null (single-tenant mode)
const extractTenantId = (hostname) => {
  if (!hostname) return null;
  
  // Skip if not in multi-tenant mode
  if (!isMultiTenant()) {
    return null;
  }
  
  const hostnameWithoutPort = hostname.split(':')[0].trim();
  
  const domain = getTenantDomain();
  
  // Check if hostname matches tenant pattern: {tenantId}.{domain}
  // Note: only a single DNS label is supported as tenantId (subdomain), not nested names.
  if (hostnameWithoutPort.endsWith(`.${domain}`)) {
    const parts = hostnameWithoutPort.split('.');
    if (parts.length >= 2) {
      const tenantId = parts[0];
      // Validate tenant ID (alphanumeric and hyphens only)
      if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(tenantId)) {
        return tenantId;
      }
    }
  }
  
  // For localhost or direct IP access, return null (single-tenant)
  return null;
};

// Get tenant storage paths (attachments, avatars)
const getTenantStoragePaths = (tenantId) => {
  const basePath = process.env.DOCKER_ENV === 'true'
    ? '/app/server'
    : join(dirname(__dirname), '..');
  
  if (tenantId && isMultiTenant()) {
    return {
      attachments: join(basePath, 'attachments', 'tenants', tenantId),
      avatars: join(basePath, 'avatars', 'tenants', tenantId)
    };
  }
  
  // Single-tenant: backward compatible paths
  return {
    attachments: join(basePath, 'attachments'),
    avatars: join(basePath, 'avatars')
  };
};

// Initialize database for a tenant
// This uses initializeDatabase from database.js which handles:
// - Creating directory if needed
// - Creating database file if needed
// - Creating tables
// - Running migrations
// - Initializing default data
const initializeDatabaseForTenant = async (tenantId) => {
  // Use the refactored initializeDatabase from database.js
  return await initializeDatabase(tenantId);
};

// Get or create database connection for tenant
// In-flight map prevents concurrent first-hit requests from double-running migrations/init
const dbInitInFlight = new Map();

const getTenantDatabase = async (tenantId) => {
  // Normalize tenantId for cache key (null for single-tenant)
  const cacheKey = tenantId || 'default';
  
  // Check cache first
  if (dbCache.has(cacheKey)) {
    const cached = dbCache.get(cacheKey);
    // Verify database is still open AND tenant schema still exists.
    // SELECT 1 alone is not enough: after destroy (DROP SCHEMA), search_path
    // used to fall through to public and the cache looked healthy forever.
    try {
      const { wrapQuery } = await import('../utils/queryLogger.js');
      await wrapQuery(cached.db.prepare('SELECT 1'), 'SELECT').get();
      if (
        tenantId &&
        cached.db &&
        typeof cached.db.tenantSchemaIsReady === 'function' &&
        !(await cached.db.tenantSchemaIsReady())
      ) {
        throw new Error(`tenant schema missing or incomplete for ${tenantId}`);
      }
      return cached;
    } catch (error) {
      const msg = error?.message || String(error);
      // Never discard a live pool because Postgres is saturated — that leaks more clients.
      if (/too many clients already|remaining connection slots|Connection terminated/i.test(msg)) {
        console.warn(
          `⚠️ Database cache verification failed for tenant ${tenantId} (keeping cached pool):`,
          msg
        );
        return cached;
      }
      // Database closed / broken / schema dropped — remove from cache and re-init
      console.warn(`⚠️ Database cache verification failed for tenant ${tenantId}, reinitializing:`, msg);
      try {
        if (cached.db && typeof cached.db.close === 'function') {
          await cached.db.close();
        }
      } catch (_) {
        /* ignore */
      }
      dbCache.delete(cacheKey);
    }
  }

  if (dbInitInFlight.has(cacheKey)) {
    return dbInitInFlight.get(cacheKey);
  }

  const initPromise = (async () => {
    // Initialize database (creates tables, runs migrations, etc.)
    const dbInfo = await initializeDatabaseForTenant(tenantId);

    // If version changed, broadcast to this tenant
    if (dbInfo.versionChanged && dbInfo.appVersion) {
      notificationService.publish('version-updated', { version: dbInfo.appVersion }, tenantId);
      console.log(`📦 Broadcasting version update to tenant ${tenantId || 'default'}: ${dbInfo.appVersion}`);
    }

    // Initialize storage usage for this tenant (only on first database creation, not on cache hits)
    // This ensures STORAGE_USED is accurate from the start
    // Initialize asynchronously to avoid blocking the request
    import('../utils/storageUtils.js').then(({ initializeStorageUsage }) => {
      initializeStorageUsage(dbInfo.db);
    }).catch(err => {
      console.warn(`⚠️ Failed to initialize storage usage for tenant ${tenantId || 'default'}:`, err.message);
    });

    // Cache the connection
    dbCache.set(cacheKey, dbInfo);

    return dbInfo;
  })().finally(() => {
    dbInitInFlight.delete(cacheKey);
  });

  dbInitInFlight.set(cacheKey, initPromise);
  return initPromise;
};

// Tenant routing middleware
export const tenantRouting = async (req, res, next) => {
  try {
    // Extract tenant ID from hostname
    // Priority order:
    // 1. X-Forwarded-Host (set by ingress/nginx) - most reliable for multi-tenant
    // 2. X-Original-Host (some proxies set this)
    // 3. Host header
    // 4. req.hostname
    const forwardedHost = req.get('x-forwarded-host');
    const originalHost = req.get('x-original-host');
    const hostHeader = req.get('host');
    const hostname = pickHostnameForTenant(req);
    
    // Debug: log all hostname sources for troubleshooting (raw vs normalized)
    if (isMultiTenant()) {
      const pathLabel = `${req.method} ${req.originalUrl || req.url}`;
      console.log(
        `🔍 Tenant routing ${pathLabel} — X-Forwarded-Host: ${forwardedHost || 'none'}, X-Original-Host: ${originalHost || 'none'}, Host: ${hostHeader || 'none'}, req.hostname: ${req.hostname || 'none'} → normalized: "${hostname}"`
      );
    }
    
    let tenantId = extractTenantId(hostname);
    
    if (isMultiTenant()) {
      const domain = getTenantDomain();
      const schemaHint = tenantId ? `tenant_${tenantId}` : 'public (no tenant subdomain — check Host / TENANT_DOMAIN=${domain})';
      console.log(`🔍 Tenant routing → tenantId: ${tenantId || 'null'}, schema: ${schemaHint}`);
    }
    
    // Allow tenant override via query/header when Host is the shared in-cluster service
    // (admin portal; shared agent runner callbacks + automation tool calls).
    if (
      isMultiTenant() &&
      (req.path.startsWith('/api/admin-portal') ||
        req.path.startsWith('/api/agent/runner') ||
        req.path.startsWith('/api/agent/automation'))
    ) {
      const queryTenantId = req.query.tenantId || req.headers['x-tenant-id'];
      if (queryTenantId && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(queryTenantId)) {
        tenantId = queryTenantId;
        console.log(`🔑 Tenant override via parameter/header: ${tenantId} (${req.path})`);
      }
    }
    
    // Store tenant ID in request for use in routes
    req.tenantId = tenantId;
    
    // Get or create tenant database
    const dbInfo = await getTenantDatabase(tenantId);
    
    // Log schema for debugging
    if (isMultiTenant() && tenantId) {
      console.log(`📊 Using tenant database schema: tenant_${tenantId}`);
    }
    
    // Make database available to routes
    // CRITICAL: Use req.locals for per-request data to avoid race conditions
    // req.app.locals is SHARED across all requests, causing database mix-ups in multi-tenant mode
    if (!req.locals) {
      req.locals = {};
    }
    req.locals.db = dbInfo.db;
    req.locals.tenantStoragePaths = getTenantStoragePaths(tenantId);
    if (isMultiTenant() && tenantId) {
      req.locals.currentTenant = tenantId;
    }
    
    // DO NOT set req.app.locals.db in multi-tenant mode - it's shared and causes race conditions!
    // Only set it in single-tenant mode for backward compatibility
    if (!isMultiTenant()) {
      req.app.locals.db = dbInfo.db;
      req.app.locals.tenantStoragePaths = getTenantStoragePaths(tenantId);
    }
    
    next();
  } catch (error) {
    console.error('❌ Tenant routing error:', error);
    
    // If tenant database initialization fails, return 500
    res.status(500).json({
      success: false,
      error: 'Failed to initialize tenant database',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get tenant ID from request (utility function)
export const getTenantId = (req) => {
  return req.tenantId || null;
};

// Get tenant storage paths (utility function)
export const getTenantPaths = (req) => {
  return req.app.locals.tenantStoragePaths || {
    attachments: process.env.DOCKER_ENV === 'true' 
      ? '/app/server/attachments' 
      : join(dirname(__dirname), '..', 'attachments'),
    avatars: process.env.DOCKER_ENV === 'true'
      ? '/app/server/avatars'
      : join(dirname(__dirname), '..', 'avatars')
  };
};

// Cleanup: Close all database connections (for graceful shutdown)
export const closeAllTenantDatabases = () => {
  console.log('🔄 Closing all tenant database connections...');
  for (const [tenantId, dbInfo] of dbCache.entries()) {
    try {
      dbInfo.db.close();
      console.log(`✅ Closed database for tenant: ${tenantId}`);
    } catch (error) {
      console.error(`❌ Error closing database for tenant ${tenantId}:`, error);
    }
  }
  dbCache.clear();
};

// Get all tenant databases for scheduled jobs (multi-tenant + single-tenant).
// Multi-tenant: discover schemas from Postgres (tenant_*), then open/cache each —
// does not rely only on this pod's request cache (new tenants are still processed).
export const getAllTenantDatabases = async () => {
  const { wrapQuery } = await import('../utils/queryLogger.js');
  const databases = [];

  if (!isMultiTenant()) {
    for (const [tenantId, dbInfo] of dbCache.entries()) {
      try {
        await wrapQuery(dbInfo.db.prepare('SELECT 1'), 'SELECT').get();
        databases.push({ tenantId: tenantId === 'default' ? null : tenantId, db: dbInfo.db });
      } catch (error) {
        console.warn(`⚠️ Skipping closed database for tenant: ${tenantId}`);
      }
    }
    return databases;
  }

  let tenantIds = [];
  try {
    // Bootstrap connection (public schema) to list tenant schemas
    const bootstrap = await getTenantDatabase(null);
    const rows = await wrapQuery(
      bootstrap.db.prepare(`
        SELECT schema_name AS "schemaName"
        FROM information_schema.schemata
        WHERE schema_name LIKE 'tenant\\_%' ESCAPE '\\'
        ORDER BY schema_name
      `),
      'SELECT'
    ).all();
    tenantIds = rows
      .map((r) => String(r.schemaName || r.schema_name || '').replace(/^tenant_/, ''))
      .filter((id) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id));
  } catch (error) {
    console.warn('⚠️ Failed to list tenant schemas; falling back to dbCache:', error.message);
    tenantIds = [...dbCache.keys()].filter((k) => k !== 'default');
  }

  // Ensure cached tenants are included even if schema listing missed one
  for (const key of dbCache.keys()) {
    if (key !== 'default' && !tenantIds.includes(key)) {
      tenantIds.push(key);
    }
  }

  for (const tenantId of tenantIds) {
    try {
      const dbInfo = await getTenantDatabase(tenantId);
      await wrapQuery(dbInfo.db.prepare('SELECT 1'), 'SELECT').get();
      databases.push({ tenantId, db: dbInfo.db });
    } catch (error) {
      console.warn(`⚠️ Skipping tenant database ${tenantId}:`, error.message);
    }
  }

  return databases;
};

// Helper function to get database from request (avoids race conditions)
// Prefers req.locals.db (per-request) over req.app.locals.db (shared)
export const getRequestDatabase = (req, defaultDb = null) => {
  return req.locals?.db || req.app.locals?.db || defaultDb;
};

// Export utility functions
export { getTenantStoragePaths, isMultiTenant, extractTenantId, getTenantDatabase };

