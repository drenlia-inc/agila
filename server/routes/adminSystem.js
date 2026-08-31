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
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import notificationService from '../services/notificationService.js';
// MIGRATED: Import sqlManager
import { helpers } from '../utils/sqlManager/index.js';
import {
  parseBody,
  jobsCleanupBodySchema,
  s3TestOverridesBodySchema,
  migrateStorageBodySchema
} from '../utils/requestValidation.js';

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
    const db = getRequestDatabase(req);
    // MIGRATED: Get ADMIN_PORTAL_URL setting using sqlManager
    const adminPortalUrl = await helpers.getSetting(db, 'ADMIN_PORTAL_URL');
    res.json({
      adminPortalUrl: adminPortalUrl || null
    });
  } catch (error) {
    console.error('Error fetching portal config:', error);
    res.status(500).json({ error: 'Failed to fetch portal configuration' });
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
    
    const adminPortalUrl = await helpers.getSetting(db, 'ADMIN_PORTAL_URL');
    if (!adminPortalUrl || !String(adminPortalUrl).trim()) {
      return res.status(404).json({ error: 'Admin portal URL not configured' });
    }
    
    const instanceId = await helpers.getSetting(db, 'INSTANCE_ID');
    
    const response = await axios.get(
      `${String(adminPortalUrl).replace(/\/$/, '')}/api/instance-portal/billing-history`,
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
    
    const adminPortalUrl = await helpers.getSetting(db, 'ADMIN_PORTAL_URL');
    if (!adminPortalUrl || !String(adminPortalUrl).trim()) {
      return res.status(404).json({ error: 'Admin portal URL not configured' });
    }
    
    const instanceId = await helpers.getSetting(db, 'INSTANCE_ID');
    
    const response = await axios.post(
      `${String(adminPortalUrl).replace(/\/$/, '')}/api/instance-portal/subscription/change-plan`,
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
    
    const adminPortalUrl = await helpers.getSetting(db, 'ADMIN_PORTAL_URL');
    if (!adminPortalUrl || !String(adminPortalUrl).trim()) {
      return res.status(404).json({ error: 'Admin portal URL not configured' });
    }
    
    const instanceId = await helpers.getSetting(db, 'INSTANCE_ID');
    
    const response = await axios.post(
      `${String(adminPortalUrl).replace(/\/$/, '')}/api/instance-portal/subscription/cancel`,
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
        destination: parsed.data.destination || undefined
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
    const { compareStorageObjects, getRequestStoragePaths } = await import('../services/storage/index.js');
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
      const draft = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await emailService.sendTestEmail(req.user.email || 'admin@example.com', draft);
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

