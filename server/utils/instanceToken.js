/**
 * Resolve INSTANCE_TOKEN for admin-portal auth and outbound portal callbacks.
 * Environment wins when set; otherwise encrypted settings.INSTANCE_TOKEN (self-host Connect).
 */

import { getDecryptedSetting } from './settingsSecrets.js';

/**
 * @param {object|null|undefined} db - tenant DB; optional when only env is expected
 * @returns {Promise<string>}
 */
export async function resolveInstanceToken(db) {
  const fromEnv = String(process.env.INSTANCE_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  if (!db) return '';
  try {
    return String((await getDecryptedSetting(db, 'INSTANCE_TOKEN')) || '').trim();
  } catch (error) {
    console.error('Failed to resolve INSTANCE_TOKEN from settings:', error.message);
    return '';
  }
}
