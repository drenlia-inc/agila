import express from 'express';
import { wrapQuery } from '../utils/queryLogger.js';
import redisService from '../services/redisService.js';
import postgresNotificationService from '../services/postgresNotificationService.js';
import websocketService from '../services/websocketService.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { health as healthQueries } from '../utils/sqlManager/index.js';

const router = express.Router();

// Track server initialization state
let isServerReady = false;
let servicesInitialized = false;

// Mark server as ready (called after services are initialized)
export const markServerReady = () => {
  isServerReady = true;
  servicesInitialized = true;
  console.log('✅ Server marked as ready');
};

// Readiness check handler - exported for use in multiple routes
export const readyHandler = async (req, res) => {
  try {
    // Check if services are initialized first (before database check)
    if (!servicesInitialized) {
      console.log('⏳ Readiness check: services not initialized yet');
      return res.status(503).json({ 
        status: 'not ready', 
        reason: 'services_initializing',
        timestamp: new Date().toISOString()
      });
    }
    
    // Check database (if available - in multi-tenant mode, db might not be set per-request)
    // In multi-tenant mode, databases are created per-tenant on first request,
    // so we can't check a specific database here. The server is ready if services are initialized.
    const db = req.app.locals?.db;
    let databaseStatus = 'not_checked';
    
    if (db) {
      try {
        // MIGRATED: Check database connection using sqlManager
        const dbCheck = await healthQueries.checkDatabaseConnection(db);
        if (!dbCheck) {
          console.warn('⚠️ Readiness check: database query returned no result');
          // Still consider ready if services are initialized - database might be in transition
          databaseStatus = 'query_failed';
        } else {
          databaseStatus = 'connected';
        }
      } catch (dbError) {
        // Database check failed, but in multi-tenant mode this might be expected
        // if no tenant context is available. Still mark as ready if services are initialized.
        console.warn('⚠️ Readiness check: database check failed (may be expected in multi-tenant mode):', dbError.message);
        databaseStatus = 'check_failed';
      }
    } else {
      // No database at app level - this is normal in multi-tenant mode
      databaseStatus = 'multi_tenant';
    }
    
    // Check Redis (optional - app can work without it)
    const redisConnected = redisService.isRedisConnected();
    
    // Server is ready if services are initialized
    // Database status is informational - in multi-tenant mode, databases are created on-demand
    console.log('✅ Readiness check: server is ready', {
      database: databaseStatus,
      redis: redisConnected ? 'connected' : 'optional',
      servicesInitialized: true
    });
    
    res.status(200).json({ 
      status: 'ready', 
      timestamp: new Date().toISOString(),
      database: databaseStatus,
      redis: redisConnected ? 'connected' : 'optional',
      websocket: 'initialized',
      servicesInitialized: true
    });
  } catch (error) {
    console.error('❌ Readiness check error:', error);
    res.status(503).json({ 
      status: 'not ready', 
      reason: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Readiness check endpoint - checks if all services are initialized and ready
router.get("/ready", readyHandler);

// Health check endpoint (liveness probe - checks if server is running)
router.get('/', async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'skipped',
        ready: isServerReady
      });
    }
    // MIGRATED: Check database connection using sqlManager
    await healthQueries.checkDatabaseConnection(db);

    let emailServicePayload = {
      implemented: true,
      available: false,
      message: 'No database on request (cannot read SMTP settings)'
    };
    if (db) {
      try {
        const EmailService = (await import('../services/emailService.js')).default;
        const emailSvc = new EmailService(db);
        const v = await emailSvc.validateEmailConfig();
        emailServicePayload = {
          implemented: true,
          available: v.valid,
          message: v.valid
            ? 'MAIL_ENABLED and required SMTP settings are present'
            : (v.error || 'Email not configured')
        };
      } catch (emailErr) {
        emailServicePayload = {
          implemented: true,
          available: false,
          message: 'Failed to evaluate email configuration',
          error: emailErr.message
        };
      }
    }

    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      database: 'connected',
      dbType: 'postgresql',
      redis: redisService.isRedisConnected(),
      postgresNotifications: postgresNotificationService.isServiceConnected(),
      websocket: websocketService.getClientCount(),
      emailService: emailServicePayload,
      ready: isServerReady
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;

