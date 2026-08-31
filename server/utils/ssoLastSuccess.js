import notificationService from '../services/notificationService.js';
import { SSO_LAST_SUCCESS_KEYS } from '../constants/ssoSettings.js';
import { settings as settingsQueries } from './sqlManager/index.js';

/**
 * Stamp last successful SSO login. Failures must not block the redirect.
 * @param {import('../config/postgresDatabase.js').default} db
 * @param {'google' | 'github' | 'm365'} provider
 * @param {string | null} tenantId
 */
export async function recordSsoLastSuccess(db, provider, tenantId) {
  const key = SSO_LAST_SUCCESS_KEYS[provider];
  if (!db || !key) return;
  const value = new Date().toISOString();
  try {
    await settingsQueries.upsertSetting(db, key, value);
    await notificationService.publish('settings-updated', { key, value }, tenantId);
  } catch (error) {
    console.error(`Failed to record ${provider} SSO last success:`, error);
  }
}
