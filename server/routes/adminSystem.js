import express from 'express';
import os from 'os';
import axios from 'axios';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getStorageUsage, formatBytes } from '../utils/storageUtils.js';
import { getContainerMemoryInfo } from '../utils/containerMemory.js';
import { manualTriggers } from '../jobs/scheduler.js';
import { getTranslator } from '../utils/i18n.js';
import { getLicenseManager } from '../config/license.js';
import { getSystemDiskUsage } from '../utils/diskUsage.js';
import { getRequestDatabase, getTenantId, isMultiTenant } from '../middleware/tenantRouting.js';
import notificationService from '../services/notificationService.js';
// MIGRATED: Import sqlManager
import { helpers, settings as settingsQueries } from '../utils/sqlManager/index.js';
import {
  parseBody,
  jobsCleanupBodySchema,
  s3TestOverridesBodySchema,
  migrateStorageBodySchema,
  testEmailBodySchema,
  connectPortalBodySchema
} from '../utils/requestValidation.js';
import {
  isUndeliverableTestRecipient,
  getOwnerEmail,
  isPortalLinked
} from '../utils/instanceOwner.js';
import { upsertSecretSetting } from '../utils/settingsSecrets.js';
import { AGILA_ADMIN_PORTAL_URL, AGILA_MARKETING_ORIGIN } from '../constants/agilaPublicUrls.js';

const router = express.Router();

// Database migrations status endpoint
router.get('/migrations', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { getMigrationStatus } = await import('../migrations/index.js');
    const status = await getMigrationStatus(db);
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Error fetching migration status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch migration status',
      message: error.message 
    });
  }
});

// Admin endpoints for manual job triggers
router.post('/jobs/snapshot', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    console.log('🔧 Admin triggered: Task snapshot creation');
    const result = await manualTriggers.triggerSnapshot(db);
    res.json({
      success: true,
      message: 'Task snapshots created successfully',
      ...result
    });
  } catch (error) {
    console.error('Error triggering snapshot:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create snapshots',
      message: error.message 
    });
  }
});

router.post('/jobs/achievements', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = getTranslator(db);
    console.log('🔧 Admin triggered: Achievement check');
    const result = await manualTriggers.triggerAchievementCheck(db);
    res.json({
      success: true,
      message: t('system.achievementCheckCompleted'),
      ...result
    });
  } catch (error) {
    console.error('Error triggering achievement check:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check achievements',
      message: error.message 
    });
  }
});

router.post('/jobs/cleanup', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const t = getTranslator(db);
    const parsed = parseBody(jobsCleanupBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { retentionDays } = parsed.data;
    console.log(`🔧 Admin triggered: Snapshot cleanup (${retentionDays || 730} days)`);
    const result = await manualTriggers.triggerCleanup(db, retentionDays);
    res.json({
      success: true,
      message: t('system.cleanupCompletedSuccessfully'),
      ...result
    });
  } catch (error) {
    console.error('Error triggering cleanup:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to cleanup snapshots',
      message: error.message 
    });
  }
});

router.get('/system-info', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    // Host/container metrics are not tenant-scoped. Hidden in multi-tenant and demo
    // unless the admin session sent the troubleshooting unlock header (TROUBLE).
    if (process.env.MULTI_TENANT === 'true' || process.env.DEMO_ENABLED === 'true') {
      if (String(req.get('x-agila-troubleshooting') || '') !== '1') {
        return res.status(404).json({ error: 'System metrics are not available in this deployment mode' });
      }
    }

    const db = getRequestDatabase(req);
    // Memory usage (container-aware)
    const memoryInfo = getContainerMemoryInfo();
    
    // CPU usage (simplified - just load average)
    const loadAvg = os.loadavg();
    const cpuCores = os.cpus().length;
    const cpuPercent = Math.round((loadAvg[0] / cpuCores) * 100);
    
    // Disk usage (storage info)
    const licenseManager = getLicenseManager(db);
    const isLicensingEnabled = licenseManager.isEnabled();
    const isDemoMode = process.env.DEMO_ENABLED === 'true';
    
    let diskUsed, diskTotal, diskPercent;
    
    if (isLicensingEnabled || isDemoMode) {
      // When licensing is enabled OR in demo mode, use instance storage usage (STORAGE_USED from settings)
      const storageUsage = await getStorageUsage(db);
      let storageLimit;
      
      if (isLicensingEnabled) {
        // Get limit from license manager
        const limits = await licenseManager.getLimits();
        storageLimit = limits ? limits.STORAGE_LIMIT : 5368709120; // Fallback to 5GB
      } else {
        // Demo mode: use default limit or get from settings
        // MIGRATED: Get STORAGE_LIMIT setting using sqlManager
        const limitSetting = await helpers.getSetting(db, 'STORAGE_LIMIT');
        storageLimit = limitSetting != null && limitSetting !== ''
          ? parseInt(String(limitSetting), 10)
          : 5368709120; // Default 5GB
      }
      
      diskUsed = storageUsage;
      diskTotal = storageLimit;
      diskPercent = storageLimit > 0 ? Math.round((storageUsage / storageLimit) * 100) : 0;
    } else {
      // When licensing is disabled and not in demo mode, try to get actual system disk usage
      const systemDiskInfo = getSystemDiskUsage();
      if (systemDiskInfo) {
        // Use actual system disk usage
        diskUsed = systemDiskInfo.used;
        diskTotal = systemDiskInfo.total;
        diskPercent = systemDiskInfo.percent;
      } else {
        // Fallback: use attachment storage usage with a reasonable default limit
        const storageUsage = await getStorageUsage(db);
        diskUsed = storageUsage;
        diskTotal = 5368709120; // 5GB default
        diskPercent = diskTotal > 0 ? Math.round((storageUsage / diskTotal) * 100) : 0;
      }
    }
    
    res.json({
      memory: {
        used: memoryInfo.used,
        total: memoryInfo.total,
        free: memoryInfo.free,
        percent: memoryInfo.percent,
        usedFormatted: formatBytes(memoryInfo.used),
        totalFormatted: formatBytes(memoryInfo.total),
        freeFormatted: formatBytes(memoryInfo.free)
      },
      cpu: {
        percent: cpuPercent,
        loadAverage: loadAvg[0],
        cores: cpuCores
      },
      disk: {
        used: diskUsed,
        total: diskTotal,
        percent: diskPercent,
        usedFormatted: formatBytes(diskUsed),
        totalFormatted: formatBytes(diskTotal)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting system info:', error);
    res.status(500).json({ error: 'Failed to get system information' });
  }
});

// Get instance owner
router.get('/owner', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get OWNER setting using sqlManager
    // helpers.getSetting returns the value string (not { value }), same as sqlManager contract
    const ownerEmail = await helpers.getSetting(db, 'OWNER');
    res.json({ owner: ownerEmail || null });
  } catch (error) {
    console.error('Error fetching owner:', error);
    res.status(500).json({ error: 'Failed to fetch owner' });
  }
});

// Get admin portal configuration
router.get('/portal-config', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    res.json({
      adminPortalUrl: AGILA_ADMIN_PORTAL_URL
    });
  } catch (error) {
    console.error('Error fetching portal config:', error);
    res.status(500).json({ error: 'Failed to fetch portal configuration' });
  }
});

/**
 * POST /api/admin/connect-portal
 * Account owner redeems a pairing code and stores INSTANCE_ID + INSTANCE_TOKEN.
 */
router.post('/connect-portal', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    if (isMultiTenant()) {
      return res.status(400).json({
        error: 'Portal Connect is only available on self-hosted instances',
        code: 'not_self_hosted'
      });
    }

    const db = getRequestDatabase(req);
    const ownerEmail = await getOwnerEmail(db);
    if (
      !ownerEmail ||
      String(ownerEmail).trim().toLowerCase() !== String(req.user.email || '').trim().toLowerCase()
    ) {
      return res.status(403).json({ error: 'Only the instance owner can connect to Agila support' });
    }

    if (await isPortalLinked(db)) {
      return res.status(409).json({
        error: 'This instance is already linked to the Agila portal',
        code: 'already_linked'
      });
    }

    const parsed = parseBody(connectPortalBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    // Redeem always hits production admin.agila.dev (not TENANT_DOMAIN / app FQDN).
    const portalBase = AGILA_ADMIN_PORTAL_URL;

    let redeemResponse;
    try {
      redeemResponse = await axios.post(
        `${portalBase}/api/public/instance-pair/redeem`,
        { code: parsed.data.pairingCode },
        {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true
        }
      );
    } catch (error) {
      console.error('Connect portal redeem network error:', portalBase, error.message);
      return res.status(502).json({
        error: 'Unable to reach the Agila portal. Try again later.',
        code: 'portal_unreachable'
      });
    }

    if (redeemResponse.status < 200 || redeemResponse.status >= 300) {
      return res.status(redeemResponse.status === 400 ? 400 : 502).json({
        error: redeemResponse.data?.error || 'Failed to redeem pairing code',
        code: redeemResponse.data?.code || 'redeem_failed'
      });
    }

    const instanceId = String(redeemResponse.data?.instanceId || '').trim();
    const instanceToken = String(redeemResponse.data?.instanceToken || '').trim();

    if (!instanceId || !instanceToken) {
      return res.status(502).json({
        error: 'Portal returned an incomplete pairing response',
        code: 'invalid_redeem_response'
      });
    }

    await settingsQueries.upsertSetting(db, 'INSTANCE_ID', instanceId);
    // Bookkeeping only — Connect / billing CTAs use AGILA_* constants, not these settings.
    await settingsQueries.upsertSetting(db, 'ADMIN_PORTAL_URL', AGILA_ADMIN_PORTAL_URL);
    await settingsQueries.upsertSetting(db, 'WEBSITE_URL', AGILA_MARKETING_ORIGIN);
    await upsertSecretSetting(db, 'INSTANCE_TOKEN', instanceToken);

    res.json({
      linked: true,
      instanceId,
      adminPortalUrl: AGILA_ADMIN_PORTAL_URL
    });
  } catch (error) {
    console.error('Error connecting portal:', error);
    res.status(500).json({ error: 'Failed to connect to Agila portal' });
  }
});

// Proxy billing history request to admin portal
router.get('/instance-portal/billing-history', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Check if user is the owner using sqlManager
    const ownerEmail = await helpers.getSetting(db, 'OWNER');
    if (!ownerEmail || String(ownerEmail).trim().toLowerCase() !== String(req.user.email || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Only the instance owner can access billing history' });
    }
    
    const instanceId = await helpers.getSetting(db, 'INSTANCE_ID');
    
    const response = await axios.get(
      `${AGILA_ADMIN_PORTAL_URL}/api/instance-portal/billing-history`,
      {
        params: { instanceId: instanceId || undefined },
        headers: {
          'Authorization': `Bearer ${req.header('Authorization')?.replace('Bearer ', '')}`
        },
        timeout: 10000
      }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching billing history:', error);
    
    if (error.response) {
      return res.status(error.response.status).json({ 
        error: error.response.data?.error || 'Failed to fetch billing history from admin portal' 
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch billing history' });
  }
});

// Proxy change plan request to admin portal
router.post('/instance-portal/change-plan', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Check if user is the owner using sqlManager
    const ownerEmail = await helpers.getSetting(db, 'OWNER');
    if (!ownerEmail || String(ownerEmail).trim().toLowerCase() !== String(req.user.email || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Only the instance owner can change the subscription plan' });
    }
    
    const instanceId = await helpers.getSetting(db, 'INSTANCE_ID');
    
    const response = await axios.post(
      `${AGILA_ADMIN_PORTAL_URL}/api/instance-portal/subscription/change-plan`,
      {
        instanceId: instanceId || undefined,
        ...req.body
      },
      {
        headers: {
          'Authorization': `Bearer ${req.header('Authorization')?.replace('Bearer ', '')}`
        },
        timeout: 10000
      }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('Error changing plan:', error);
    
    if (error.response) {
      return res.status(error.response.status).json({ 
        error: error.response.data?.error || 'Failed to change plan' 
      });
    }
    
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

// Proxy cancel subscription request to admin portal
router.post('/instance-portal/cancel-subscription', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Check if user is the owner using sqlManager
    const ownerEmail = await helpers.getSetting(db, 'OWNER');
    if (!ownerEmail || String(ownerEmail).trim().toLowerCase() !== String(req.user.email || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Only the instance owner can cancel the subscription' });
    }
    
    const instanceId = await helpers.getSetting(db, 'INSTANCE_ID');
    
    const response = await axios.post(
      `${AGILA_ADMIN_PORTAL_URL}/api/instance-portal/subscription/cancel`,
      {
        instanceId: instanceId || undefined,
        ...req.body
      },
      {
        headers: {
          'Authorization': `Bearer ${req.header('Authorization')?.replace('Bearer ', '')}`
        },
        timeout: 10000
      }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    
    if (error.response) {
      return res.status(error.response.status).json({ 
        error: error.response.data?.error || 'Failed to cancel subscription' 
      });
    }
    
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Check email server status
router.get('/email-status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const EmailService = (await import('../services/emailService.js')).default;
    const emailService = new EmailService(db);
    const emailValidation = await emailService.validateEmailConfig();
    const s = emailValidation.settings || {};
    const hasSettings = !!(s.SMTP_HOST || s.MAIL_ENABLED);

    console.log('🔍 Email status check:', {
      valid: emailValidation.valid,
      error: emailValidation.error,
      mailEnabled: s.MAIL_ENABLED,
      available: emailValidation.valid
    });

    res.json({
      available: emailValidation.valid,
      implemented: true,
      hasSettings,
      demoMode: emailValidation.demoMode === true || process.env.DEMO_ENABLED === 'true',
      error: emailValidation.valid ? null : (emailValidation.error || null),
      message: emailValidation.valid
        ? 'Email service is ready for sending'
        : (emailValidation.error || 'Email is not configured'),
      details: emailValidation.details || null,
      settings: emailValidation.valid
        ? {
            mailEnabled: s.MAIL_ENABLED === 'true',
            host: s.SMTP_HOST || null,
            port: s.SMTP_PORT || null,
            from: s.SMTP_FROM_EMAIL || null
          }
        : null
    });
  } catch (error) {
    console.error('Email status check error:', error);
    res.status(500).json({ 
      available: false, 
      error: 'Failed to check email status',
      details: error.message 
    });
  }
});

// Test S3 storage configuration (put/get/delete probe)
router.post('/test-storage', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(s3TestOverridesBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { testS3Connection } = await import('../services/storage/index.js');
    const result = await testS3Connection(db, parsed.data);

    // Sync STORAGE_TEST_OK to clients (live probes only — not destination drafts)
    if (!result.asDestination) {
      try {
        await notificationService.publish(
          'settings-updated',
          {
            key: 'STORAGE_TEST_OK',
            value: result.ok ? 'true' : 'false',
            timestamp: new Date().toISOString()
          },
          getTenantId(req)
        );
      } catch (publishErr) {
        console.warn('Failed to publish STORAGE_TEST_OK after storage test:', publishErr?.message);
      }
    }

    if (!result.ok) {
      return res.status(400).json({
        error: result.error || 'S3 storage test failed',
        errorCode: result.errorCode || 'unknown',
        technicalDetail: result.technicalDetail || result.error || '',
        ok: false
      });
    }
    res.json(result);
  } catch (error) {
    console.error('❌ Test storage error:', error);
    res.status(500).json({
      error: 'Failed to test storage configuration',
      details: error.message
    });
  }
});

// Start migrate objects between disk and S3 (runs in background; poll status)
router.post('/migrate-storage', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(migrateStorageBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.includes('direction')
          ? 'direction must be disk-to-s3, s3-to-disk, or s3-to-s3'
          : parsed.error
      });
    }
    const direction = parsed.data.direction;

    if (direction === 's3-to-disk' && process.env.MULTI_TENANT === 'true') {
      return res.status(400).json({
        error: 'Migrating to disk is not supported in multi-tenant mode'
      });
    }

    const { startStorageMigration, getRequestStoragePaths } = await import('../services/storage/index.js');
    const deleteSource = parsed.data.deleteSource === true;
    const result = await startStorageMigration(
      db,
      getRequestStoragePaths(req),
      direction,
      {
        deleteSource,
        destination: parsed.data.destination || undefined,
        cutoverMode: parsed.data.cutoverMode || 'byo',
        cutoverEligible: parsed.data.cutoverEligible
      }
    );

    res.status(202).json({
      message: 'Storage migration started',
      ...result
    });
  } catch (error) {
    console.error('❌ Storage migration error:', error);
    const status = error.statusCode === 409 ? 409 : 500;
    res.status(status).json({
      error: error.message || 'Failed to migrate storage',
      details: error.message
    });
  }
});

// Poll storage migration progress
router.get('/migrate-storage/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { getStorageMigrationStatus } = await import('../services/storage/index.js');
    const progress = await getStorageMigrationStatus(db);
    res.json(progress);
  } catch (error) {
    console.error('❌ Storage migration status error:', error);
    res.status(500).json({
      error: error.message || 'Failed to read migration status'
    });
  }
});

// Compare objects on local disk vs S3 (read-only inventory)
router.post('/compare-storage', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { compareStorageObjects, getRequestStoragePaths, loadStorageConfig } = await import('../services/storage/index.js');
    const config = await loadStorageConfig(db);
    if (config.managed) {
      return res.status(400).json({
        error: 'Disk ↔ S3 compare is not available while using managed platform storage'
      });
    }
    const result = await compareStorageObjects(db, getRequestStoragePaths(req));
    res.json(result);
  } catch (error) {
    console.error('❌ Storage compare error:', error);
    res.status(500).json({
      error: error.message || 'Failed to compare storage'
    });
  }
});

// Test email configuration endpoint
router.post('/test-email', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    console.log('🧪 Test email endpoint called');
    
    // Check if demo mode is enabled
    if (process.env.DEMO_ENABLED === 'true') {
      const t = getTranslator(db);
      return res.status(400).json({ 
        error: t('system.emailTestingDisabledDemoMode'),
        details: 'Email functionality is disabled in demo environments to prevent sending emails',
        demoMode: true
      });
    }
    
    // Use EmailService for clean, reusable email functionality
    const EmailService = await import('../services/emailService.js');
    const emailService = new EmailService.default(db);
    
    try {
      const parsed = parseBody(testEmailBodySchema, req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error });
      }
      const { to, ...draft } = parsed.data;
      const recipient = String(to || req.user.email || '').trim();
      if (isUndeliverableTestRecipient(recipient)) {
        return res.status(400).json({
          error: 'A deliverable recipient email is required for the test',
          code: 'recipient_required'
        });
      }
      const result = await emailService.sendTestEmail(recipient, draft);
      res.json(result);
    } catch (error) {
      console.error('❌ Email test failed:', error);
      
      // If it's a validation error, return the validation details
      if (error.valid === false) {
        return res.status(400).json(error);
      }
      
      // Return detailed error information for SMTP failures
      return res.status(500).json({ 
        error: 'Failed to send test email',
        details: error.message,
        errorCode: error.code,
        command: error.command,
        troubleshooting: {
          common_issues: [
            'Check SMTP credentials (username/password)',
            'Verify SMTP host and port',
            'Check if less secure app access is enabled (Gmail)',
            'Verify firewall/network settings',
            'Check if 2FA requires app password (Gmail)'
          ]
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Test email error:', error);
    res.status(500).json({ 
      error: 'Failed to test email configuration',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export default router;

