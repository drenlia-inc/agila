import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import http from 'http';
import os from 'os';
// Import our extracted modules
import { initializeDatabase } from './config/database.js';
import { authenticateToken, requireRole, generateToken, JWT_SECRET, JWT_EXPIRES_IN } from './middleware/auth.js';
import { attachmentUpload, avatarUpload, createAttachmentUpload } from './config/multer.js';
import { wrapQuery, getQueryLogs, clearQueryLogs } from './utils/queryLogger.js';
import { checkInstanceStatus, initializeInstanceStatus } from './middleware/instanceStatus.js';
import { loginLimiter, passwordResetLimiter, registrationLimiter, activationLimiter } from './middleware/rateLimiters.js';
import { getAppVersion } from './utils/appVersion.js';
import { getTenantDomain } from './utils/tenantDomain.js';

// Import generateRandomPassword function
const generateRandomPassword = (length = 12) => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
};
import { createDefaultAvatar, getRandomColor } from './utils/avatarGenerator.js';
import { initActivityLogger, logActivity, logCommentActivity } from './services/activityLogger.js';
import { initReportingLogger } from './services/reportingLogger.js';
import * as reportingLogger from './services/reportingLogger.js';
// Realtime pub/sub: notificationService.js — task emails: taskEmailNotificationService.js + throttler
import {
  initNotificationThrottler,
  startGlobalNotificationProcessor,
  stopGlobalNotificationProcessor,
  flushAllTenantNotifications,
} from './services/notificationThrottler.js';
import { initializeScheduler, manualTriggers } from './jobs/scheduler.js';
import { TAG_ACTIONS, COMMENT_ACTIONS } from './constants/activityActions.js';
import { clearTranslationCache } from './utils/i18n.js';

// Import route modules
import boardsRouter from './routes/boards.js';
import tasksRouter from './routes/tasks.js';
import membersRouter from './routes/members.js';
import columnsRouter from './routes/columns.js';
import authRouter from './routes/auth.js';
import passwordResetRouter from './routes/password-reset.js';
import viewsRouter from './routes/views.js';
// Lazy loaded routes (loaded on first request to reduce startup memory)
// import adminPortalRouter from './routes/adminPortal.js';
// import reportsRouter from './routes/reports.js';
// Lazy loaded admin/debug routes (loaded on first request to reduce startup memory)
// import sprintsRouter from './routes/sprints.js';
import commentsRouter from './routes/comments.js';
import usersRouter from './routes/users.js';
import filesRouter from './routes/files.js';
import uploadRouter from './routes/upload.js';
// import debugRouter from './routes/debug.js';
import healthRouter, { markServerReady, readyHandler } from './routes/health.js';
// import adminUsersRouter from './routes/adminUsers.js';
// Lazy loaded routes (loaded on first request to reduce startup memory)
// import tagsRouter from './routes/tags.js';
// import prioritiesRouter from './routes/priorities.js';
import settingsRouter from './routes/settings.js';
// import adminSystemRouter from './routes/adminSystem.js';
// import adminNotificationQueueRouter from './routes/adminNotificationQueue.js';
import taskRelationsRouter from './routes/taskRelations.js';
import taskWorkRouter from './routes/taskWork.js';
import agentRouter from './routes/agent.js';
import userDevRouter from './routes/userDev.js';
import activityRouter from './routes/activity.js';
import testNotificationsRouter from './routes/testNotifications.js';
import { cspIngestRouter, cspAdminRouter } from './routes/cspReport.js';

// Import real-time services
import redisService from './services/redisService.js';
import postgresNotificationService from './services/postgresNotificationService.js';
import notificationService from './services/notificationService.js';
import websocketService from './services/websocketService.js';

// Import storage utilities
import { updateStorageUsage, initializeStorageUsage, getStorageUsage, getStorageLimit, formatBytes } from './utils/storageUtils.js';

// Import license manager
import { getLicenseManager } from './config/license.js';

// Import tenant routing middleware
import { tenantRouting, isMultiTenant, closeAllTenantDatabases, getTenantDatabase, getRequestDatabase } from './middleware/tenantRouting.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize database based on mode (single-tenant or multi-tenant)
let defaultDb = null;
let versionInfo = { appVersion: null, versionChanged: false };

// For single-tenant mode (Docker), initialize database immediately
// For multi-tenant mode (Kubernetes), database will be initialized per-request via middleware
// Optionally, can pre-initialize a tenant at startup using STARTUP_TENANT_ID env var
if (!isMultiTenant()) {
  const dbInit = await initializeDatabase();
  defaultDb = dbInit.db;
  versionInfo = { appVersion: dbInit.appVersion, versionChanged: dbInit.versionChanged };
  
  // Initialize services with default database (single-tenant mode)
  await initializeInstanceStatus(defaultDb);
  initActivityLogger(defaultDb);
  initReportingLogger(defaultDb);
  // Task email queue: bind default DB + start global 60s processor
  initNotificationThrottler(defaultDb);
  initializeScheduler(defaultDb);
  
  console.log('✅ Single-tenant mode: Database initialized');
} else {
  console.log('✅ Multi-tenant mode: Database will be initialized per-request');
  
  // Optionally pre-initialize a tenant at startup (useful for first tenant or testing)
  const startupTenantId = process.env.STARTUP_TENANT_ID;
  if (startupTenantId) {
    console.log(`🔧 Pre-initializing tenant database for: ${startupTenantId}`);
    try {
      const dbInfo = await getTenantDatabase(startupTenantId);
      console.log(`✅ Tenant '${startupTenantId}' database pre-initialized at startup`);
    } catch (error) {
      console.warn(`⚠️ Failed to pre-initialize tenant '${startupTenantId}':`, error.message);
    }
  }
  
  // Queue processor walks getAllTenantDatabases() each tick (pods share DB; claim is atomic)
  startGlobalNotificationProcessor();

  // Initialize scheduler for multi-tenant mode (will run jobs for all tenants)
  // Pass null as db parameter - scheduler will use getAllTenantDatabases() instead
  initializeScheduler(null);
}

// Clear translation cache on startup to ensure fresh translations are loaded
clearTranslationCache();
console.log('🔄 Translation cache cleared on startup');

const app = express();

// Trust proxy - required when running behind reverse proxy (K8s ingress, nginx, etc.)
// This allows Express to correctly identify client IPs from X-Forwarded-For headers
// Set TRUST_PROXY env var to 'false' to disable, a number (e.g., '1') to trust N proxies, or leave unset
// Default behavior:
//   - Docker (MULTI_TENANT=false): trust proxy = false (no reverse proxy by default)
//   - K8s (MULTI_TENANT=true): trust proxy = true (behind ingress)
if (process.env.TRUST_PROXY === 'false') {
  app.set('trust proxy', false);
} else if (process.env.TRUST_PROXY) {
  const proxyCount = parseInt(process.env.TRUST_PROXY);
  app.set('trust proxy', isNaN(proxyCount) ? true : proxyCount);
} else {
  // Default: trust proxy only in multi-tenant mode (K8s with ingress)
  // For Docker deployments without reverse proxy, set TRUST_PROXY=false explicitly
  app.set('trust proxy', process.env.MULTI_TENANT === 'true');
}

// Make default database available to routes (for single-tenant mode)
// In multi-tenant mode, this will be overridden by tenantRouting middleware
app.locals.db = defaultDb;

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Report-Only CSP: observe violations without breaking TipTap / Socket.IO / Vite.
  // Reports land in tenant DB via /api/csp-report; review in Admin → Troubleshooting.
  // Tighten and switch to enforcing Content-Security-Policy after the list stays quiet.
  const tenantDomain = getTenantDomain();
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  res.setHeader(
    'Content-Security-Policy-Report-Only',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' ws: wss: https: http://localhost:* https://*.${tenantDomain}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'report-uri /api/csp-report',
      'report-to csp-endpoint'
    ].join('; ')
  );
  if (host) {
    res.setHeader(
      'Report-To',
      JSON.stringify({
        group: 'csp-endpoint',
        max_age: 10886400,
        endpoints: [{ url: `${proto}://${host}/api/csp-report` }]
      })
    );
  }
  next();
});

// Add app version header to all responses
app.use(async (req, res, next) => {
  // Use database from request (set by tenantRouting in multi-tenant mode)
  const db = getRequestDatabase(req, defaultDb);
  let version = '0';
  
  try {
    if (db) {
      // Database available - use getAppVersion which can read from version.json, ENV, or database
      version = await getAppVersion(db);
    } else {
      // No database available - try version.json or ENV (getAppVersion would throw if db is null)
      try {
        const versionPath = new URL('./version.json', import.meta.url);
        const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
        version = versionData.version;
      } catch {
        version = process.env.APP_VERSION || '0';
      }
    }
  } catch (error) {
    // Final fallback if anything fails
    version = process.env.APP_VERSION || '0';
  }
  
  res.setHeader('X-App-Version', version);
  next();
});

// OPTIONS requests are now handled by nginx - disable Express OPTIONS handler to avoid duplicate headers
// app.options('*', (req, res) => {
//   const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
//   const origin = req.headers.origin;
//   
//   if (origin) {
//     const originHostname = new URL(origin).hostname;
//     const isAllowed = allowedOrigins.some(allowedHost => {
//       const allowedHostname = allowedHost.includes('://') 
//         ? new URL(allowedHost).hostname 
//         : allowedHost;
//       return originHostname === allowedHostname;
//     });
//     
//     if (isAllowed) {
//       res.header('Access-Control-Allow-Origin', origin);
//       res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//       res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//       res.header('Access-Control-Allow-Credentials', 'true');
//     }
//   }
//   
//   res.status(200).end();
// });

// CORS is now handled by nginx - disable Express CORS to avoid duplicate headers
// app.use(cors({
//   origin: (origin, callback) => {
//     const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
//     
//     // If no origin (e.g., mobile apps, Postman), allow it
//     if (!origin) {
//       return callback(null, true);
//     }
//     
//     // Check if the origin's hostname matches any allowed hostname
//     const originHostname = new URL(origin).hostname;
//     const isAllowed = allowedOrigins.some(allowedHost => {
//       // Handle both hostnames and full URLs
//       const allowedHostname = allowedHost.includes('://') 
//         ? new URL(allowedHost).hostname 
//         : allowedHost;
//       return originHostname === allowedHostname;
//     });
//     
//     if (isAllowed) {
//       callback(null, origin); // Return the exact origin for proper CORS headers
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   optionsSuccessStatus: 200 // Some legacy browsers choke on 204
// }));
// Body parser limits (for JSON/URL-encoded, not multipart/form-data)
// Note: multipart/form-data is handled by Multer, which has its own limits
// For larger uploads, also configure nginx: client_max_body_size 100m;
app.use(express.json({
  limit: '100mb',
  type: ['application/json', 'application/csp-report', 'application/reports+json']
}));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Note: In production, Vite preview serves static files from dist and proxies API requests
// Express no longer needs to serve static files when Vite preview is running
// This code is kept for backward compatibility but won't be used when vite preview is active
if (process.env.NODE_ENV === 'production' && !process.env.VITE_PREVIEW_RUNNING) {
  const distPath = path.join(__dirname, '../dist');
  const assetsPath = path.join(distPath, 'assets');
  // Hashed JS/CSS chunks live under /assets — safe to cache long-term (filename changes each build).
  if (fs.existsSync(assetsPath)) {
    app.use(
      '/assets',
      express.static(assetsPath, {
        maxAge: '1y',
        immutable: true,
        etag: true,
        lastModified: true
      })
    );
  }
  // Other dist files (favicon, etc.). Do NOT long-cache any HTML: stale HTML references removed
  // chunks after deploy → 404 on /assets/*.js or failed dynamic import(). SPA shell uses catch-all below.
  app.use(
    express.static(distPath, {
      maxAge: 0,
      etag: true,
      lastModified: true,
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
      }
    })
  );
  console.log(`📦 Serving static files from: ${distPath} (/assets immutable 1y, HTML revalidated)`);
}

// Tenant routing middleware (must be before routes that need database)
// In multi-tenant mode, this extracts tenant ID from hostname and loads the appropriate database
// In single-tenant mode, this is a no-op (database already initialized)
if (isMultiTenant()) {
  app.use(tenantRouting);
  console.log('✅ Tenant routing middleware enabled');
}

// Add instance status middleware (uses database from request)
app.use(async (req, res, next) => {
  try {
    const db = getRequestDatabase(req, defaultDb);
    if (db) {
      return await checkInstanceStatus(db)(req, res, next);
    }
    next();
  } catch (error) {
    console.error('❌ [INSTANCE_STATUS] Error in middleware:', error);
    // Fail open - allow request to continue if status check fails
    next();
  }
});

// Rate limiters are now imported from middleware/rateLimiters.js

// ================================
// DEBUG ENDPOINTS
// ================================


// ================================
// AUTHENTICATION ENDPOINTS
// ================================
// Auth routes have been moved to routes/auth.js

// ================================
// API ROUTES
// ================================

// Lazy loading helper for routes (reduces startup memory)
const lazyRouteLoader = (modulePath) => {
  let router = null;
  let loadingPromise = null;
  
  return async (req, res, next) => {
    try {
      // If router is already loaded, use it immediately
      if (router) {
        return router(req, res, next);
      }
      
      // If currently loading, wait for it
      if (loadingPromise) {
        await loadingPromise;
        if (router) {
          return router(req, res, next);
        }
        // If loading failed, router will be null, fall through to error
      }
      
      // Start loading the module
      loadingPromise = (async () => {
        try {
          console.log(`📦 Lazy loading route module: ${modulePath}`);
          const module = await import(modulePath);
          router = module.default;
          console.log(`✅ Route module loaded: ${modulePath}`);
        } catch (error) {
          console.error(`❌ Failed to load route module ${modulePath}:`, error);
          throw error; // Re-throw to be caught by outer try-catch
        }
      })();
      
      await loadingPromise;
      
      // Router should be loaded now, use it
      if (router) {
        return router(req, res, next);
      } else {
        throw new Error('Router is null after loading');
      }
    } catch (error) {
      console.error(`❌ Error in lazy route loader for ${modulePath}:`, error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Route module failed to load', details: error.message });
      }
      return next(error);
    }
  };
};

// Use route modules
app.use('/api/csp-report', cspIngestRouter);
app.use('/api/admin/csp-reports', cspAdminRouter);
app.use('/api/members', membersRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/columns', columnsRouter);
app.use('/api/tasks', authenticateToken, tasksRouter);
app.use('/api/views', viewsRouter);
app.use('/api/auth', authRouter);
app.use('/api/password-reset', passwordResetRouter);
// Lazy loaded routes (loaded on first request to reduce startup memory)
app.use('/api/reports', lazyRouteLoader('./routes/reports.js'));
app.use('/api/admin/sprints', lazyRouteLoader('./routes/sprints.js'));
app.use('/api/comments', commentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadRouter); // File upload endpoint (for backward compatibility)
app.use('/api/files', filesRouter);
app.use('/api/attachments', filesRouter);
app.use('/api/debug', lazyRouteLoader('./routes/debug.js'));
app.use('/health', healthRouter);
// Alias for probes and scripts that expect /api/health (same handler as /health)
app.use('/api/health', healthRouter);
// Mount ready endpoint at both /ready and /api/ready for flexibility
app.get('/ready', readyHandler);
app.get('/api/ready', readyHandler);
app.use('/api/admin/users', lazyRouteLoader('./routes/adminUsers.js'));
// Lazy loaded routes (loaded on first request to reduce startup memory)
app.use('/api/tags', lazyRouteLoader('./routes/tags.js'));
app.use('/api/admin/tags', lazyRouteLoader('./routes/tags.js'));
app.use('/api/admin/priorities', lazyRouteLoader('./routes/priorities.js'));
app.use('/api/priorities', lazyRouteLoader('./routes/priorities.js'));
// Settings endpoints (eager loaded - required immediately for frontend)
app.use('/api/settings', settingsRouter);
app.use('/api/admin/settings', settingsRouter);
app.use('/api/storage', settingsRouter);
app.use('/api/admin', lazyRouteLoader('./routes/adminSystem.js'));
app.use('/api/admin/notification-queue', lazyRouteLoader('./routes/adminNotificationQueue.js'));
app.use('/api/admin/webhooks', lazyRouteLoader('./routes/adminWebhooks.js'));
app.use('/api/admin/lifecycle', lazyRouteLoader('./routes/adminLifecycle.js'));
app.use('/api/tasks', taskWorkRouter); // task_work KV + control (before param-heavy routers where possible)
app.use('/api/tasks', taskRelationsRouter);
app.use('/api/agent/runner', lazyRouteLoader('./routes/agentRunnerCallback.js'));
app.use('/api/agent/automation', lazyRouteLoader('./routes/agentAutomation.js'));
app.use('/api/agent', agentRouter);
app.use('/api/help-assistant', lazyRouteLoader('./routes/helpAssistant.js'));
app.use('/api/user/dev', userDevRouter);
app.use('/api/activity', activityRouter);
app.use('/api/user', activityRouter);
app.use('/api/user', usersRouter); // User settings routes
app.use('/api/test', testNotificationsRouter); // Test endpoints for notifications

// Admin Portal API routes (external access using INSTANCE_TOKEN) - Lazy loaded
app.use('/api/admin-portal', lazyRouteLoader('./routes/adminPortal.js'));

// ================================
// ADDITIONAL ENDPOINTS
// ================================

// Version info endpoint (public, useful for debugging and K8s readiness checks)
app.get('/api/version', async (req, res) => {
  try {
    // Try to read full version info from version.json
    const versionPath = new URL('./version.json', import.meta.url);
    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    res.json(versionData);
  } catch (error) {
    // Fallback to basic version info
    const version = await getAppVersion(defaultDb);
    res.json({
      version,
      source: 'environment',
      environment: process.env.NODE_ENV || 'production'
    });
  }
});

// Comments routes have been moved to routes/comments.js

// File upload and user routes have been moved to routes/users.js

// Admin user routes have been moved to routes/adminUsers.js

// Tags routes have been moved to routes/tags.js

// Priorities routes have been moved to routes/priorities.js

// Settings routes have been moved to routes/settings.js

// getContainerMemoryInfo has been moved to utils/containerMemory.js
// Admin system routes have been moved to routes/adminSystem.js

// Test email route has been moved to routes/adminSystem.js


// Public priorities endpoint - moved to routes/priorities.js

// Tags endpoints
// GET /api/tags moved to routes/tags.js

// Task relations routes (tags, watchers, collaborators, attachments) have been moved to routes/taskRelations.js
// Activity and user status routes have been moved to routes/activity.js
// User settings routes have been moved to routes/users.js

// Attachment routes have been moved to routes/files.js
// File serving routes have been moved to routes/files.js
// Debug routes have been moved to routes/debug.js
// Health route has been moved to routes/health.js

// ================================
// SPA FALLBACK FOR CLIENT-SIDE ROUTING
// ================================

// Serve the React app for all non-API routes
// Express 5: catch-all route requires named wildcard parameter
app.get('/*splat', (req, res) => {
  // Skip API routes, file serving routes, and source file requests
  // NOTE: /assets/ should NOT be blocked - it's served by express.static middleware above
  // Missing hashed chunks must 404 — never fall through to index.html (breaks debugging and confuses import()).
  if (req.path.startsWith('/assets/')) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/attachments/') ||
      req.path.startsWith('/avatars/') ||
      req.path.startsWith('/src/') ||
      req.path.startsWith('/node_modules/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  
  // For all other routes (including /project/, /task/, etc.), serve the React app
  const htmlPath = path.join(__dirname, '../dist/index.html');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(htmlPath);
});

// ================================
// START SERVER
// ================================

const PORT = process.env.PORT || 3222;

// Create HTTP server
const server = http.createServer(app);

// Initialize real-time services BEFORE server starts listening
// This ensures the Redis adapter is configured before any connections are accepted
async function initializeServices() {
  try {
    // Initialize Redis (still needed for Socket.IO adapter in multi-pod deployments)
    await redisService.connect();
    
    // Initialize PostgreSQL Notification Service (LISTEN/NOTIFY for realtime events)
    let pool = null;
    if (defaultDb && defaultDb.constructor.name === 'PostgresDatabase' && defaultDb.pool) {
      pool = defaultDb.pool;
    }
    await postgresNotificationService.connect(pool);
    console.log('✅ PostgreSQL Notification Service initialized');
    
    // Initialize WebSocket (now async due to Redis adapter setup)
    // CRITICAL: This must happen BEFORE server.listen() to ensure adapter is ready
    await websocketService.initialize(server);
    
    console.log('✅ Real-time services initialized');
    
    // Broadcast app version to all connected clients
    // If version changed, broadcast immediately; otherwise wait briefly for WebSocket connections
    const broadcastVersion = async () => {
      // In single-tenant mode, broadcast version from default database
      if (defaultDb) {
        const appVersion = await getAppVersion(defaultDb);
        notificationService.publish('version-updated', { version: appVersion }, null);
        console.log(`📦 Broadcasting app version: ${appVersion}${versionInfo.versionChanged ? ' (version changed - notifying users)' : ''}`);
      }
      // In multi-tenant mode, version updates are broadcast per-tenant when databases are initialized
      // (handled in tenantRouting middleware)
    };
    
    if (versionInfo.versionChanged && versionInfo.appVersion) {
      // Version changed - broadcast immediately to notify users
      await broadcastVersion();
    } else {
      // Normal startup - wait briefly for WebSocket connections
      setTimeout(broadcastVersion, 1000);
    }
  } catch (error) {
    console.error('❌ Failed to initialize real-time services:', error);
    // Continue without real-time features
  }
}

// Initialize services BEFORE starting the server
// This ensures the Redis adapter is configured before any Socket.IO connections are accepted
await initializeServices();

// Start server AFTER services are initialized
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Readiness check: http://localhost:${PORT}/ready`);
  console.log(`🔧 Debug logs: http://localhost:${PORT}/api/debug/logs`);
  console.log(`✨ Refactored server with modular architecture`);
  
  // Mark server as ready after services are initialized
  markServerReady();
  
  // Defer storage usage calculation to reduce startup memory
  // Initialize after 30 seconds to allow server to stabilize
  // Only initialize for single-tenant mode (multi-tenant databases are created per-request)
  if (!isMultiTenant() && defaultDb) {
    setTimeout(async () => {
      await initializeStorageUsage(defaultDb);
    }, 30000);
  } else {
    console.log('📊 Multi-tenant mode: Storage usage will be calculated per-tenant on first request');
  }
});

// Graceful shutdown handler
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30000;

const gracefulShutdown = async (signal = 'signal') => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`\n🔄 Received ${signal}, shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    console.error('❌ Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  if (typeof forceTimer.unref === 'function') {
    forceTimer.unref();
  }

  // Stop accepting new HTTP / Socket.IO connections
  await new Promise((resolve) => {
    server.close((err) => {
      if (err) {
        console.error('❌ Error closing HTTP server:', err);
      } else {
        console.log('✅ HTTP server closed');
      }
      resolve();
    });
  });

  // Close all tenant database connections (multi-tenant mode)
  if (isMultiTenant()) {
    closeAllTenantDatabases();
  }
  
  // Close default database (single-tenant mode)
  if (defaultDb) {
    try {
      defaultDb.close();
      console.log('✅ Closed default database');
    } catch (error) {
      console.error('❌ Error closing default database:', error);
    }
  }
  
  // Stop queue processor and flush pending notifications for all known tenants
  stopGlobalNotificationProcessor();
  try {
    await flushAllTenantNotifications();
  } catch (error) {
    console.error('❌ Error flushing notification queues:', error);
  }
  
  // Disconnect WebSocket service (closes Socket.IO server and Redis adapter clients)
  await websocketService.disconnect();

  // Disconnect PostgreSQL LISTEN/NOTIFY
  try {
    await postgresNotificationService.disconnect();
  } catch (error) {
    console.error('❌ Error disconnecting PostgreSQL notification service:', error);
  }
  
  // Disconnect Redis service
  await redisService.disconnect();
  
  clearTimeout(forceTimer);
  console.log('✅ Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGINT', async () => {
  await gracefulShutdown('SIGINT');
});

process.on('SIGTERM', async () => {
  await gracefulShutdown('SIGTERM');
});
