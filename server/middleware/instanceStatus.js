import { wrapQuery } from '../utils/queryLogger.js';
import { getTranslator } from '../utils/i18n.js';

/**
 * Blocks API/app access unless INSTANCE_STATUS is `active`.
 * Admin portal (INSTANCE_TOKEN) and a few public probes stay reachable so
 * operators can restore the workspace and the login page can explain why.
 */
function isInstanceStatusExempt(req) {
  const path = req.path || '';
  if (
    path === '/health' ||
    path === '/ready' ||
    path === '/api/health' ||
    path === '/api/ready' ||
    path === '/api/version'
  ) {
    return true;
  }
  if (path === '/api/auth/instance-status') return true;
  if (path === '/api/auth/check-default-admin' && req.method === 'GET') return true;
  if (path === '/api/settings' && req.method === 'GET') return true;
  if (path === '/api/csp-report' && req.method === 'POST') return true;
  if (path.startsWith('/api/admin-portal/')) return true;
  return false;
}

export const checkInstanceStatus = (db) => {
  return async (req, res, next) => {
    try {
      if (isInstanceStatusExempt(req)) {
        return next();
      }

      const statusSetting = await wrapQuery(
        db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('INSTANCE_STATUS');
      const status = statusSetting ? statusSetting.value : 'active';

      if (status !== 'active') {
        const t = await getTranslator(db);
        const statusMessage = getStatusMessage(status, t);

        if (req.path.startsWith('/api/')) {
          return res.status(503).json({
            error: 'Instance unavailable',
            status: status,
            message: statusMessage,
            code: 'INSTANCE_UNAVAILABLE',
          });
        }

        // Let the SPA load so the login page can explain the lockout.
        return next();
      }

      next();
    } catch (error) {
      console.error('Error checking instance status:', error);
      next();
    }
  };
};

const getStatusMessage = (_status, t = (key) => key) => t('instanceStatus.unavailable');

/**
 * Initialize instance status setting if it doesn't exist.
 * Preserves existing status values on restart.
 */
export const initializeInstanceStatus = async (db) => {
  try {
    const existingSetting = await wrapQuery(
      db.prepare('SELECT value FROM settings WHERE key = ?'),
      'SELECT'
    ).get('INSTANCE_STATUS');

    if (!existingSetting) {
      await wrapQuery(
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)'),
        'INSERT'
      ).run('INSTANCE_STATUS', 'active');
      console.log('✅ Initialized INSTANCE_STATUS setting to active');
    } else {
      console.log(`ℹ️ Instance status preserved: ${existingSetting.value}`);
    }
  } catch (error) {
    console.error('Error initializing instance status:', error);
  }
};
