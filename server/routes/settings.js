import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { getStorageUsage, getStorageLimit, formatBytes } from '../utils/storageUtils.js';
import notificationService from '../services/notificationService.js';
import { getTenantId, getRequestDatabase } from '../middleware/tenantRouting.js';
import { invalidateOAuthConfigCache } from '../utils/oauthConfigCache.js';
import { settings as settingsQueries, users as userQueries, members as memberQueries } from '../utils/sqlManager/index.js';
import { FE_PUBLIC_DEBUG_FLAG_KEYS, BULK_DEBUG_SETTING_KEYS } from '../constants/debugSettings.js';
import { AI_PUBLIC_SETTING_KEYS } from '../constants/aiSettings.js';
import { KANBAN_FEATURE_PUBLIC_KEYS } from '../constants/kanbanFeatureSettings.js';
import { isSecretSettingKey, SECRET_SETTING_PLACEHOLDER } from '../constants/secretSettings.js';
import { AGENT_MEMBER_ID } from '../constants/agentIdentity.js';
import { clearSqlDebugSettingsCache } from '../utils/sqlDebugSettingsCache.js';
import { serverDebug } from '../utils/serverDebug.js';
import { validateAiConnectivity, listAiModels } from '../utils/aiConnectivity.js';
import { applyEffectiveAiEnabledToSettings, isAiAllowedByPlan } from '../utils/aiEnabled.js';
import { AI_PROVIDER_PRESETS } from '../constants/aiProviders.js';
import { isMaskedOrEmptyApiKey } from '../utils/maskSecret.js';
import {
  getDecryptedSetting,
  projectSecretForAdminApi,
  upsertSecretSetting
} from '../utils/settingsSecrets.js';
import { avatarUpload } from '../config/multer.js';
import { STORAGE_MANAGED_HIDDEN_KEYS } from '../constants/storageSettings.js';
import {
  commitUploadedFile,
  deleteObject,
  getObject,
  getRequestStoragePaths,
  filenameFromPublicUrl
} from '../services/storage/index.js';
import {
  parseBody,
  updateSettingBodySchema,
  bulkUpdateSettingsBodySchema,
  updateAppUrlBodySchema,
  aiCredentialsDraftBodySchema,
  aiRunnerProbeBodySchema
} from '../utils/requestValidation.js';
import { validateUploadedFileMagic } from '../utils/fileMagicBytes.js';
import { resolveDefaultBrandLogoPath } from '../utils/brandAssets.js';

const router = express.Router();

async function getSettingValue(db, key) {
  if (isSecretSettingKey(key)) {
    return getDecryptedSetting(db, key);
  }
  const row = await settingsQueries.getSettingByKey(db, key);
  return row?.value ?? '';
}

/**
 * Publish Agent member create/update/delete so clients refresh assignee lists without a page reload.
 */
async function publishAgentMemberVisibility(db, tenantId, { enabled, nameUpdated = false }) {
  try {
    if (enabled) {
      const member = await memberQueries.getMemberById(db, AGENT_MEMBER_ID);
      if (member) {
        await notificationService.publish(
          'member-updated',
          { member, timestamp: new Date().toISOString() },
          tenantId
        );
      }
    } else {
      await notificationService.publish(
        'member-deleted',
        { memberId: AGENT_MEMBER_ID, timestamp: new Date().toISOString() },
        tenantId
      );
    }
  } catch (e) {
    console.error('Failed to publish Agent member visibility update:', e);
  }
}

async function resolveAiCredentials(db, overrides = {}) {
  const provider =
    overrides.provider !== undefined
      ? String(overrides.provider)
      : await getSettingValue(db, 'AI_PROVIDER');
  const baseUrl =
    overrides.baseUrl !== undefined
      ? String(overrides.baseUrl)
      : await getSettingValue(db, 'AI_API_BASE_URL');
  const model =
    overrides.model !== undefined
      ? String(overrides.model)
      : await getSettingValue(db, 'AI_MODEL');
  let apiKey =
    overrides.apiKey !== undefined &&
    String(overrides.apiKey).trim() !== '' &&
    !isMaskedOrEmptyApiKey(overrides.apiKey)
      ? String(overrides.apiKey).trim()
      : '';
  if (!apiKey) {
    apiKey = await getDecryptedSetting(db, 'AI_API_KEY');
  }
  return { provider, baseUrl, apiKey, model };
}

// Public settings endpoint for non-admin users
router.get('/', async (req, res, next) => {
  // Only handle when mounted at /api/settings (not /api/admin/settings)
  if (req.baseUrl === '/api/admin/settings') {
    return next(); // Let admin routes handle it
  }
  
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get settings using sqlManager
    const publicKeys = [
      'SITE_NAME',
      'SITE_URL',
      'SITE_LOGO',
      'SITE_LOGO_DARK',
      'HIDE_GITHUB_LINK',
      'HIDE_SITE_LOGO',
      'SITE_OPENS_NEW_TAB',
      'WEBSITE_URL',
      'MAIL_ENABLED',
      'GOOGLE_CLIENT_ID',
      'HIGHLIGHT_OVERDUE_TASKS',
      'EFFORT_UNIT',
      'DEFAULT_FINISHED_COLUMN_NAMES',
      // Bilingual workflow labels used to localize untouched seeded columns.
      'DEFAULT_BOARD_COLUMNS',
      // Preference defaults for all authenticated users (not admin-only secrets)
      'DEFAULT_VIEW_MODE',
      'DEFAULT_TASK_VIEW_MODE',
      'DEFAULT_PROJ_PREFIX',
      'DEFAULT_TASK_PREFIX',
      'DEFAULT_ACTIVITY_FEED_POSITION',
      'DEFAULT_ACTIVITY_FEED_WIDTH',
      'DEFAULT_ACTIVITY_FEED_HEIGHT',
      'DEMO_RESET_AT',
      'DEMO_BOARD_EN',
      'DEMO_BOARD_FR',
      'TASK_DELETE_CONFIRM',
      'ALLOW_USER_SELF_DELETE',
      'SHOW_ACTIVITY_FEED',
      'APP_LANGUAGE',
      'TASK_NOTIFICATION_CHANNELS',
      'TASK_EMAIL_NOTIFICATIONS_ENABLED',
      ...FE_PUBLIC_DEBUG_FLAG_KEYS,
      ...AI_PUBLIC_SETTING_KEYS,
      ...KANBAN_FEATURE_PUBLIC_KEYS
    ];
    const settings = await settingsQueries.getSettingsByKeys(db, publicKeys);
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });
    await applyEffectiveAiEnabledToSettings(db, settingsObj);
    settingsObj.DEPLOY_MULTI_TENANT = process.env.MULTI_TENANT === 'true' ? 'true' : 'false';
    settingsObj.DEPLOY_DEMO_ENABLED = process.env.DEMO_ENABLED === 'true' ? 'true' : 'false';
    // Per-tenant OAuth and site metadata must not be cached by browsers or intermediaries
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(settingsObj);
  } catch (error) {
    console.error('Get public settings error:', error);
    res.status(500).json({ error: 'Failed to get public settings' });
  }
});

/**
 * Public site logo for emails / unauthenticated branding.
 * Serves the configured SITE_LOGO (or SITE_LOGO_DARK) file when set;
 * otherwise falls back to the shipping Agila logo under public/.
 * User avatars remain auth-gated.
 */
router.get('/site-logo', async (req, res, next) => {
  if (req.baseUrl === '/api/admin/settings') {
    return next();
  }

  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const hide = await settingsQueries.getSettingByKey(db, 'HIDE_SITE_LOGO');
    if (hide?.value === 'true') {
      return res.status(404).json({ error: 'Logo hidden' });
    }

    const variant = String(req.query.variant || '').toLowerCase() === 'dark' ? 'dark' : 'light';
    const light = await settingsQueries.getSettingByKey(db, 'SITE_LOGO');
    const dark = await settingsQueries.getSettingByKey(db, 'SITE_LOGO_DARK');
    const logoPath =
      variant === 'dark'
        ? (dark?.value || light?.value || '').trim()
        : (light?.value || '').trim();

    const isBuiltinPath =
      !logoPath ||
      logoPath.startsWith('/agila') ||
      logoPath.startsWith('/kanban') ||
      logoPath.startsWith('/assets/');

    if (isBuiltinPath) {
      const defaultPath = resolveDefaultBrandLogoPath(variant);
      if (!defaultPath) {
        return res.status(404).json({ error: 'No site logo configured' });
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(defaultPath);
    }

    if (/^https?:\/\//i.test(logoPath)) {
      return res.redirect(302, logoPath);
    }

    const filename = filenameFromPublicUrl(logoPath, 'avatars');
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(404).json({ error: 'Invalid logo path' });
    }

    const storagePaths = getRequestStoragePaths(req);
    const obj = await getObject(db, storagePaths, 'avatars', filename);
    if (!obj?.buffer) {
      return res.status(404).json({ error: 'Logo file not found' });
    }

    res.setHeader('Content-Type', obj.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(obj.buffer);
  } catch (error) {
    console.error('Get public site logo error:', error);
    res.status(500).json({ error: 'Failed to get site logo' });
  }
});

// Admin settings endpoints
// Handle GET /api/admin/settings (when mounted at /api/admin/settings)
router.get('/', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  // Only handle when mounted at /api/admin/settings
  if (req.baseUrl !== '/api/admin/settings') {
    return next(); // Let other routes handle it
  }
  
  try {
    const db = getRequestDatabase(req);
    // MIGRATED: Get all settings using sqlManager
    const settings = await settingsQueries.getAllSettings(db);
    const settingsObj = {};
    
    // Check if email / storage is managed
    const mailManaged = settings.find(s => s.key === 'MAIL_MANAGED')?.value === 'true';
    const storageManaged = settings.find(s => s.key === 'STORAGE_MANAGED')?.value === 'true';
    
    settings.forEach(setting => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(setting.key)) {
        return; // ignore corrupt keys (e.g. leftover React event props)
      }
      // Hide sensitive SMTP fields when email is managed (credentials and server details)
      // But allow SMTP_FROM_EMAIL and SMTP_FROM_NAME to be visible/editable
      if (mailManaged && ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_SECURE'].includes(setting.key)) {
        settingsObj[setting.key] = '';
        if (setting.key === 'SMTP_PASSWORD') {
          settingsObj.SMTP_PASSWORD_SET = 'false';
        }
      } else if (storageManaged && STORAGE_MANAGED_HIDDEN_KEYS.includes(setting.key)) {
        settingsObj[setting.key] = '';
        if (setting.key === 'S3_SECRET_ACCESS_KEY') {
          settingsObj.S3_SECRET_ACCESS_KEY_SET = 'false';
        }
      } else if (isSecretSettingKey(setting.key)) {
        projectSecretForAdminApi(setting.key, setting.value, settingsObj);
      } else {
        settingsObj[setting.key] = setting.value;
      }
    });

    // Multi-tenant: overlay platform runner env so Admin shows the shared runner (read-only in UI)
    if (process.env.MULTI_TENANT === 'true') {
      settingsObj.AI_RUNNER_PLATFORM_MANAGED = 'true';
      const platformUrl = String(
        process.env.AI_RUNNER_URL || process.env.RUNNER_URL || 'http://agila-runner:8080'
      ).trim();
      settingsObj.AI_RUNNER_URL = platformUrl.replace(/\/+$/, '');
      const platformToken = String(
        process.env.RUNNER_TOKEN || process.env.AI_RUNNER_TOKEN || ''
      ).trim();
      if (platformToken) {
        settingsObj.AI_RUNNER_TOKEN = SECRET_SETTING_PLACEHOLDER;
        settingsObj.AI_RUNNER_TOKEN_SET = 'true';
      } else {
        settingsObj.AI_RUNNER_TOKEN = '';
        settingsObj.AI_RUNNER_TOKEN_SET = 'false';
      }
    }

    await applyEffectiveAiEnabledToSettings(db, settingsObj);
    settingsObj.DEPLOY_MULTI_TENANT = process.env.MULTI_TENANT === 'true' ? 'true' : 'false';
    settingsObj.DEPLOY_DEMO_ENABLED = process.env.DEMO_ENABLED === 'true' ? 'true' : 'false';
    
    res.json(settingsObj);
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * Validate AI provider reachability (admin).
 * Body may include draft provider / baseUrl / apiKey / model; omitted fields use saved settings.
 */
router.post('/ai/validate', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return next();
  }
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(aiCredentialsDraftBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    const creds = await resolveAiCredentials(db, {
      provider: parsed.data.provider,
      baseUrl: parsed.data.baseUrl,
      apiKey: parsed.data.apiKey,
      model: parsed.data.model
    });
    const result = await validateAiConnectivity(creds);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, status: result.status });
    }
    return res.json({
      ok: true,
      detail: result.detail,
      provider: result.provider,
      models: result.models || []
    });
  } catch (error) {
    console.error('AI validate error:', error);
    return res.status(500).json({ ok: false, error: 'Failed to validate AI connectivity' });
  }
});

/** Static provider presets for the admin UI (suggested URLs / hints). */
router.get('/ai/providers', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return next();
  }
  return res.json({
    providers: AI_PROVIDER_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      suggestedBaseUrl: p.suggestedBaseUrl,
      apiKeyRequired: p.apiKeyRequired,
      hint: p.hint
    }))
  });
});

/** List models from the configured (or draft) provider. */
router.post('/ai/models', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return next();
  }
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(aiCredentialsDraftBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    const creds = await resolveAiCredentials(db, {
      provider: parsed.data.provider,
      baseUrl: parsed.data.baseUrl,
      apiKey: parsed.data.apiKey,
      model: parsed.data.model
    });
    const result = await listAiModels(creds);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, status: result.status });
    }
    return res.json({ ok: true, provider: result.provider, models: result.models });
  } catch (error) {
    console.error('AI models list error:', error);
    return res.status(500).json({ ok: false, error: 'Failed to list AI models' });
  }
});

/** Probe the push agent runner (admin). */
router.post('/ai/runner/probe', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return next();
  }
  try {
    const db = getRequestDatabase(req);
    const { probeRunner } = await import('../services/agentRunnerClient.js');
    const parsed = parseBody(aiRunnerProbeBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    // Multi-tenant: always probe the platform env runner (ignore draft body overrides)
    const overrides =
      process.env.MULTI_TENANT === 'true'
        ? {}
        : {
            runnerUrl: parsed.data.runnerUrl,
            runnerToken: parsed.data.runnerToken
          };
    const result = await probeRunner(db, overrides);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('AI runner probe error:', error);
    return res.status(500).json({ ok: false, error: 'Failed to probe agent runner' });
  }
});

// Bulk-update debug/troubleshooting flags in one transaction + one WS event
router.put('/bulk', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return next();
  }
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(bulkUpdateSettingsBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error || 'settings object is required' });
    }
    const incoming = parsed.data.settings;

    const allowed = new Set(BULK_DEBUG_SETTING_KEYS);
    const entries = [];
    const applied = {};

    for (const [key, value] of Object.entries(incoming)) {
      if (!allowed.has(key)) {
        return res.status(400).json({
          error: `Setting key is not allowed for bulk update: ${key}`
        });
      }
      const safeValue =
        typeof value === 'boolean' ? String(value) : value == null ? '' : String(value);
      entries.push([key, safeValue]);
      applied[key] = safeValue;
    }

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No settings provided' });
    }

    await settingsQueries.upsertSettings(db, entries);

    if (Object.prototype.hasOwnProperty.call(applied, 'SERVER_DEBUG_SQL')) {
      clearSqlDebugSettingsCache();
    }

    // Google SSO auth routes cache OAuth settings (including debug flag)
    if (Object.prototype.hasOwnProperty.call(applied, 'SERVER_DEBUG_GOOGLE_SSO')) {
      invalidateOAuthConfigCache(getTenantId(req));
    }

    const tenantId = getTenantId(req);
    await notificationService.publish(
      'settings-updated',
      {
        settings: applied,
        timestamp: new Date().toISOString()
      },
      tenantId
    );

    res.json({
      message: 'Settings updated successfully',
      settings: applied
    });
  } catch (error) {
    console.error('❌ Error bulk-updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings', details: error.message });
  }
});

// Handle PUT /api/admin/settings (when mounted at /api/admin/settings)
router.put('/', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  // Only handle when mounted at /api/admin/settings
  if (req.baseUrl !== '/api/admin/settings') {
    return next(); // Let other routes handle it
  }
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(updateSettingBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { key, value } = parsed.data;
    
    // Prevent updates to WEBSITE_URL - it's read-only and set during instance purchase
    if (key === 'WEBSITE_URL') {
      return res.status(403).json({ error: 'WEBSITE_URL is read-only and cannot be updated' });
    }

    // Shared platform runner in multi-tenant: URL/token come from ConfigMap/Secret only
    if (
      process.env.MULTI_TENANT === 'true' &&
      (key === 'AI_RUNNER_URL' || key === 'AI_RUNNER_TOKEN')
    ) {
      return res.status(403).json({
        error:
          'AI_RUNNER_URL and AI_RUNNER_TOKEN are managed by the platform in multi-tenant mode and cannot be updated'
      });
    }

    // Managed mail: tenant cannot overwrite platform SMTP credentials
    if (['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_SECURE'].includes(key)) {
      const mailManaged = (await getSettingValue(db, 'MAIL_MANAGED')) === 'true';
      if (mailManaged) {
        return res.status(403).json({
          error: 'SMTP server settings are managed by the platform and cannot be updated'
        });
      }
    }

    // Managed storage: tenant cannot overwrite platform S3 credentials
    if (STORAGE_MANAGED_HIDDEN_KEYS.includes(key)) {
      const storageManaged = (await getSettingValue(db, 'STORAGE_MANAGED')) === 'true';
      if (storageManaged) {
        return res.status(403).json({
          error: 'S3 storage settings are managed by the platform and cannot be updated'
        });
      }
    }
    
    // Prevent updates to APP_URL through general settings endpoint - it's owner-only
    // Use the dedicated /api/settings/app-url endpoint which enforces owner check
    if (key === 'APP_URL') {
      return res.status(403).json({ error: 'APP_URL can only be updated by the owner using the dedicated endpoint' });
    }
    
    // Convert value to string for SQLite (SQLite only accepts strings, numbers, bigints, buffers, and null)
    // Booleans, undefined, and objects need to be converted
    let safeValue = value;
    if (typeof value === 'boolean') {
      safeValue = String(value); // Convert true/false to "true"/"false"
    } else if (value === undefined) {
      safeValue = '';
    } else if (typeof value === 'object' && value !== null) {
      // This shouldn't happen with proper client code, but handle it gracefully
      safeValue = JSON.stringify(value);
    }

    // Multi-tenant: do not allow switching to local disk (no shared FS across pods)
    if (
      key === 'STORAGE_BACKEND' &&
      String(safeValue).toLowerCase() === 'disk' &&
      process.env.MULTI_TENANT === 'true'
    ) {
      return res.status(400).json({
        error: 'Local disk storage is not available in multi-tenant mode. Use S3 (platform or custom).'
      });
    }

    // Do not activate S3 without a successful connection test (platform-managed is exempt)
    if (key === 'STORAGE_BACKEND' && String(safeValue).toLowerCase() === 's3') {
      const currentBackend = String(
        (await getSettingValue(db, 'STORAGE_BACKEND')) || 'disk'
      ).toLowerCase();
      if (currentBackend !== 's3') {
        const storageManaged = (await getSettingValue(db, 'STORAGE_MANAGED')) === 'true';
        const testOk = (await getSettingValue(db, 'STORAGE_TEST_OK')) === 'true';
        if (!storageManaged) {
          if (!testOk) {
            return res.status(400).json({
              error:
                'S3 storage cannot be activated until Test S3 connection succeeds. Configure credentials and run the test first.',
              code: 'STORAGE_TEST_REQUIRED'
            });
          }
          const { loadStorageConfig, validateS3Config } = await import(
            '../services/storage/storageConfig.js'
          );
          const config = await loadStorageConfig(db);
          const validation = validateS3Config(config);
          if (!validation.ok) {
            return res.status(400).json({
              error:
                validation.error ||
                'S3 storage cannot be activated until credentials are configured and Test S3 connection succeeds.',
              code: 'STORAGE_CONFIG_INCOMPLETE'
            });
          }
        }
      }
    }
    
    // Do not clear / overwrite masked secrets when admin leaves the display value
    if (isSecretSettingKey(key)) {
      const upsert = await upsertSecretSetting(db, key, safeValue);
      if (upsert.unchanged) {
        return res.json({
          message: 'Setting unchanged',
          key,
          value: upsert.hasValue ? SECRET_SETTING_PLACEHOLDER : '',
          [`${key}_SET`]: upsert.hasValue ? 'true' : 'false'
        });
      }
      safeValue = upsert.hasValue ? SECRET_SETTING_PLACEHOLDER : '';
      // Already stored encrypted — skip generic upsert below
      const dbgSettingsEarly = await serverDebug(db, 'SERVER_DEBUG_SETTINGS');
      if (key === 'GOOGLE_CLIENT_SECRET') {
        invalidateOAuthConfigCache(getTenantId(req));
        if (dbgSettingsEarly) {
          console.log('✅ OAuth configuration cache invalidated after secret update');
        }
      }
      const tenantIdEarly = getTenantId(req);
      await notificationService.publish(
        'settings-updated',
        {
          key,
          value: upsert.hasValue ? SECRET_SETTING_PLACEHOLDER : '',
          [`${key}_SET`]: upsert.hasValue ? 'true' : 'false',
          timestamp: new Date().toISOString()
        },
        tenantIdEarly
      );
      return res.json({
        message: 'Setting updated successfully',
        key,
        value: upsert.hasValue ? SECRET_SETTING_PLACEHOLDER : '',
        // Always string for admin settings maps (avoid boolean crashing FE .trim())
        [`${key}_SET`]: upsert.hasValue ? 'true' : 'false'
      });
    }

    if (key === 'AI_MAX_CONCURRENT') {
      const { clampAiMaxConcurrent } = await import('../constants/aiSettings.js');
      safeValue = String(clampAiMaxConcurrent(safeValue));
    }

    // Enabling AI requires a reachable configured provider (+ runner when configured)
    if (key === 'AI_ENABLED' && String(safeValue) === 'true') {
      if (!(await isAiAllowedByPlan(db))) {
        return res.status(403).json({ error: 'AI features are not available on this plan' });
      }
      const creds = await resolveAiCredentials(db, {});
      const probe = await validateAiConnectivity(creds);
      if (!probe.ok) {
        return res.status(400).json({
          error: probe.error || 'AI provider is not reachable',
          code: 'AI_CONNECTIVITY_FAILED'
        });
      }
      try {
        const { probeRunner } = await import('../services/agentRunnerClient.js');
        const runnerProbe = await probeRunner(db);
        if (!runnerProbe.ok) {
          return res.status(400).json({
            error: runnerProbe.error || 'Agent runner is not reachable',
            code: 'AI_RUNNER_UNREACHABLE'
          });
        }
      } catch (e) {
        return res.status(400).json({
          error: e?.message || 'Agent runner is not reachable',
          code: 'AI_RUNNER_UNREACHABLE'
        });
      }
    }

    // MIGRATED: Upsert setting using sqlManager
    const result = await settingsQueries.upsertSetting(db, key, safeValue);
    if (key === 'SERVER_DEBUG_SQL') {
      clearSqlDebugSettingsCache();
    }

    // Keep Agent member display name in sync with AI_AGENT_NAME
    if (key === 'AI_AGENT_NAME' && safeValue) {
      try {
        await wrapQuery(
          db.prepare('UPDATE members SET name = $1 WHERE id = $2'),
          'UPDATE'
        ).run(String(safeValue).slice(0, 100), AGENT_MEMBER_ID);
      } catch (e) {
        console.error('Failed to sync Agent member name:', e);
      }
    }

    const dbgSettings = await serverDebug(db, 'SERVER_DEBUG_SETTINGS');

    // If this is a Google OAuth setting, reload the OAuth configuration
    if (key === 'GOOGLE_CLIENT_ID' || key === 'GOOGLE_CALLBACK_URL' || key === 'GOOGLE_CLIENT_SECRET') {
      if (dbgSettings) console.log(`Google OAuth setting updated: ${key} - Hot reloading OAuth config...`);
      invalidateOAuthConfigCache(getTenantId(req));
      if (dbgSettings) console.log('✅ OAuth configuration cache invalidated - new settings will be loaded on next OAuth request');
    }

    // Publish to Redis for real-time updates
    const tenantId = getTenantId(req);
    if (dbgSettings) {
      console.log('📤 Publishing settings-updated to Redis');
      console.log('📤 Broadcasting key:', key);
    }
    await notificationService.publish('settings-updated', {
      key: key,
      value: safeValue,
      timestamp: new Date().toISOString()
    }, tenantId);
    if (dbgSettings) console.log('✅ Settings-updated published to Redis');

    // Agent assignee visibility follows AI_ENABLED; name follows AI_AGENT_NAME
    if (key === 'AI_ENABLED') {
      if (String(safeValue) === 'true') {
        try {
          const { syncAgentUserAvatar } = await import('../utils/agentBotAvatar.js');
          await syncAgentUserAvatar(db, tenantId, getRequestStoragePaths(req));
        } catch (e) {
          console.warn('Agent avatar sync on AI enable failed:', e?.message || e);
        }
      }
      await publishAgentMemberVisibility(db, tenantId, {
        enabled: String(safeValue) === 'true'
      });
    } else if (key === 'AI_AGENT_NAME' && safeValue) {
      const aiOn = (await getSettingValue(db, 'AI_ENABLED')) === 'true';
      if (aiOn) {
        await publishAgentMemberVisibility(db, tenantId, {
          enabled: true,
          nameUpdated: true
        });
      }
    }
    
    res.json({
      message: 'Setting updated successfully',
      key,
      value: safeValue
    });
  } catch (error) {
    console.error('❌ Error updating settings:', error);
    console.error('❌ Error details:', { key: req.body.key, value: req.body.value, error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to update setting', details: error.message });
  }
});

// Upload site logo (light or dark). Stores under avatars/ and upserts SITE_LOGO or SITE_LOGO_DARK.
router.post('/logo', authenticateToken, requireRole(['admin']), (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return res.status(404).json({ error: 'Not Found' });
  }
  avatarUpload.single('logo')(req, res, async (err) => {
    if (err) {
      console.error('Site logo upload error:', err);
      return res.status(400).json({ error: err.message || 'Failed to upload logo' });
    }
    try {
      const db = getRequestDatabase(req);
      if (!req.file) {
        return res.status(400).json({ error: 'No logo file uploaded' });
      }

      const magic = await validateUploadedFileMagic(req.file, { mode: 'avatar' });
      if (!magic.valid) {
        return res.status(400).json({ error: magic.error });
      }

      const variant = (req.query.variant === 'dark' || req.body?.variant === 'dark') ? 'dark' : 'light';
      const settingKey = variant === 'dark' ? 'SITE_LOGO_DARK' : 'SITE_LOGO';
      const storagePaths = getRequestStoragePaths(req);
      await commitUploadedFile(db, storagePaths, 'avatars', req.file);
      const logoPath = `/avatars/${req.file.filename}`;

      // Best-effort: remove previous uploaded logo
      try {
        const previous = await settingsQueries.getSettingByKey(db, settingKey);
        const prevValue = previous?.value || '';
        if (prevValue.startsWith('/avatars/') && prevValue !== logoPath) {
          const prevName = filenameFromPublicUrl(prevValue, 'avatars');
          if (prevName) {
            await deleteObject(db, storagePaths, 'avatars', prevName);
          }
        }
      } catch (cleanupErr) {
        console.warn('Could not remove previous site logo file:', cleanupErr.message);
      }

      await settingsQueries.upsertSetting(db, settingKey, logoPath);

      const tenantId = getTenantId(req);
      await notificationService.publish('settings-updated', {
        key: settingKey,
        value: logoPath,
        timestamp: new Date().toISOString()
      }, tenantId);

      res.json({
        message: 'Logo uploaded successfully',
        key: settingKey,
        value: logoPath
      });
    } catch (error) {
      console.error('Error saving site logo:', error);
      res.status(500).json({ error: 'Failed to save logo' });
    }
  });
});

// Update APP_URL endpoint (owner only)
router.put('/app-url', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const dbgHttp = await serverDebug(db, 'SERVER_DEBUG_HTTP');
    if (dbgHttp) console.log('📞 APP_URL update endpoint called');
    const parsed = parseBody(updateAppUrlBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { appUrl } = parsed.data;
    const userId = req.user.id;

    if (dbgHttp) console.log('📞 Request data:', { userId, appUrl });
    
    // MIGRATED: Get user email using sqlManager
    const user = await userQueries.getUserByIdForAdmin(db, userId);
    
    if (!user) {
      if (dbgHttp) console.log('❌ User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    if (dbgHttp) console.log('📞 User email:', user.email);
    
    // MIGRATED: Check if user is the owner using sqlManager
    const ownerSetting = await settingsQueries.getSettingByKey(db, 'OWNER');
    
    const isOwner = ownerSetting && ownerSetting.value === user.email;
    const isDefaultAdmin = user.email === 'admin@kanban.local';
    
    if (dbgHttp) {
      console.log('📞 Owner setting:', ownerSetting?.value);
      console.log('📞 User email:', user.email);
      console.log('📞 Is owner:', isOwner, 'Is default admin:', isDefaultAdmin);
    }

    if (!isOwner && !isDefaultAdmin) {
      if (dbgHttp) console.log('❌ User is not owner or default admin. Owner:', ownerSetting?.value, 'User:', user.email);
      return res.status(403).json({ error: 'Only the owner or default admin can update APP_URL' });
    }
    
    // Validate URL scheme (shape already checked by Zod)
    const trimmedUrl = appUrl.trim();
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      if (dbgHttp) console.log('❌ Invalid URL format:', trimmedUrl);
      return res.status(400).json({ error: 'appUrl must be a valid URL starting with http:// or https://' });
    }
    
    // Remove trailing slash if present
    const normalizedUrl = trimmedUrl.replace(/\/$/, '');
    
    // MIGRATED: Get current APP_URL using sqlManager
    const currentAppUrl = await settingsQueries.getSettingByKey(db, 'APP_URL');
    
    if (dbgHttp) {
      console.log('📞 Current APP_URL:', currentAppUrl?.value);
      console.log('📞 New APP_URL:', normalizedUrl);
      console.log('📞 Are they different?', !currentAppUrl || currentAppUrl.value !== normalizedUrl);
    }

    // MIGRATED: Update APP_URL only if it's different using sqlManager
    if (!currentAppUrl || currentAppUrl.value !== normalizedUrl) {
      await settingsQueries.upsertSettingWithTimestamp(db, 'APP_URL', normalizedUrl, new Date().toISOString());
      if (dbgHttp) console.log(`✅ APP_URL updated from "${currentAppUrl?.value || 'null'}" to "${normalizedUrl}"`);
      
      res.json({ 
        message: 'APP_URL updated successfully',
        appUrl: normalizedUrl
      });
    } else {
      if (dbgHttp) console.log('ℹ️ APP_URL unchanged, already set to:', normalizedUrl);
      res.json({ 
        message: 'APP_URL unchanged',
        appUrl: normalizedUrl
      });
    }
  } catch (error) {
    console.error('❌ Error updating APP_URL:', error);
    res.status(500).json({ error: 'Failed to update APP_URL' });
  }
});

// Clear managed S3 settings (switch from platform storage to custom)
router.post('/clear-storage', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  if (req.baseUrl !== '/api/admin/settings') {
    return next();
  }

  try {
    const db = getRequestDatabase(req);
    const keysToClear = [...STORAGE_MANAGED_HIDDEN_KEYS];
    const batchQueries = keysToClear.map((key) => ({
      query: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      params: [key, '']
    }));

    batchQueries.push({
      query: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      params: ['STORAGE_MANAGED', 'false']
    });
    batchQueries.push({
      query: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      params: ['STORAGE_TEST_OK', 'false']
    });
    // Keep STORAGE_BACKEND as-is until admin configures custom S3 and migrates

    await db.executeBatchTransaction(batchQueries);

    const tenantId = getTenantId(req);
    await notificationService.publish('settings-updated', {
      key: 'STORAGE_SETTINGS_CLEARED',
      value: 'all',
      timestamp: new Date().toISOString(),
      clearedSettings: [...keysToClear, 'STORAGE_MANAGED', 'STORAGE_TEST_OK']
    }, tenantId);

    res.json({
      message: 'Storage settings cleared successfully',
      clearedSettings: [...keysToClear, 'STORAGE_MANAGED', 'STORAGE_TEST_OK']
    });
  } catch (error) {
    console.error('❌ Error clearing storage settings:', error);
    res.status(500).json({ error: 'Failed to clear storage settings', details: error.message });
  }
});

// Clear all mail-related settings (for switching from managed to custom SMTP)
// Handle POST /api/admin/settings/clear-mail (when mounted at /api/admin/settings)
router.post('/clear-mail', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  // Only handle when mounted at /api/admin/settings
  if (req.baseUrl !== '/api/admin/settings') {
    return next(); // Let other routes handle it
  }
  
  try {
    const db = getRequestDatabase(req);
    
    // Define all mail-related settings to clear (empty strings)
    const mailSettingsToClear = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'SMTP_FROM_EMAIL',
      'SMTP_FROM_NAME',
      'SMTP_SECURE' // Clear SMTP_SECURE so admin can set their own preference
    ];
    
    // MIGRATED: Clear all mail-related settings using sqlManager
    
    // Collect queries and send as a batched transaction
    const batchQueries = [];
    
    // Clear SMTP fields (set to empty strings)
    for (const key of mailSettingsToClear) {
      batchQueries.push({
        query: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
        params: [key, '']
      });
    }
    
    // Set MAIL_MANAGED to false and MAIL_ENABLED to false
    batchQueries.push({
      query: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      params: ['MAIL_MANAGED', 'false']
    });
    batchQueries.push({
      query: `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      params: ['MAIL_ENABLED', 'false']
    });
    
    // Execute all inserts in a single batched transaction
    await db.executeBatchTransaction(batchQueries);

    
    // Publish to Redis for real-time updates (single message for all changes)
    const tenantId = getTenantId(req);
    if (await serverDebug(db, 'SERVER_DEBUG_SETTINGS')) {
      console.log('📤 Publishing mail-settings-cleared to Redis');
    }
    await notificationService.publish('settings-updated', {
      key: 'MAIL_SETTINGS_CLEARED',
      value: 'all',
      timestamp: new Date().toISOString(),
      clearedSettings: [...mailSettingsToClear, 'MAIL_MANAGED', 'MAIL_ENABLED']
    }, tenantId);
    if (await serverDebug(db, 'SERVER_DEBUG_SETTINGS')) {
      console.log('✅ Mail settings cleared and published to Redis');
    }

    res.json({ 
      message: 'Mail settings cleared successfully',
      clearedSettings: [...mailSettingsToClear, 'MAIL_MANAGED', 'MAIL_ENABLED']
    });
  } catch (error) {
    console.error('❌ Error clearing mail settings:', error);
    res.status(500).json({ error: 'Failed to clear mail settings', details: error.message });
  }
});

// Storage information endpoint
// Handle GET /api/storage/info (when mounted at /api/storage)
router.get('/info', authenticateToken, async (req, res, next) => {
  // Only handle when mounted at /api/storage
  if (req.baseUrl !== '/api/storage') {
    return next(); // Let other routes handle it
  }
  try {
    const db = getRequestDatabase(req);
    const usage = await getStorageUsage(db);
    const limit = await getStorageLimit(db);
    const remaining = limit - usage;
    const usagePercent = limit > 0 ? Math.round((usage / limit) * 100) : 0;
    
    res.json({
      usage: usage,
      limit: limit,
      remaining: remaining,
      usagePercent: usagePercent,
      usageFormatted: formatBytes(usage),
      limitFormatted: formatBytes(limit),
      remainingFormatted: formatBytes(remaining)
    });
  } catch (error) {
    console.error('Error getting storage info:', error);
    res.status(500).json({ error: 'Failed to get storage information' });
  }
});

export default router;

