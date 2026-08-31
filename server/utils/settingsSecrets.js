/**
 * Read/write helpers for encrypted admin settings secrets.
 */

import { settings as settingsQueries } from './sqlManager/index.js';
import {
  decryptSettingValue,
  encryptSettingValue,
  isEncryptedSettingValue
} from './secretCrypto.js';
import { isSecretSettingKey, SECRET_SETTING_PLACEHOLDER } from '../constants/secretSettings.js';
import { isMaskedOrEmptyApiKey } from './maskSecret.js';

/**
 * Load a setting and decrypt if it is a known secret (or any enc:v1: value).
 * @param {object} db
 * @param {string} key
 * @returns {Promise<string>}
 */
export async function getDecryptedSetting(db, key) {
  const row = await settingsQueries.getSettingByKey(db, key);
  const raw = row?.value ?? '';
  if (!raw) return '';
  if (isSecretSettingKey(key) || isEncryptedSettingValue(raw)) {
    try {
      return decryptSettingValue(raw);
    } catch (err) {
      console.error(`Failed to decrypt setting ${key}:`, err.message);
      return '';
    }
  }
  return String(raw);
}

/**
 * True when a non-empty secret is stored (encrypted or legacy plaintext).
 * @param {string|null|undefined} storedValue
 */
export function hasSecretValue(storedValue) {
  return Boolean(storedValue && String(storedValue).trim());
}

/**
 * Admin GET projection for a secret setting — never plaintext.
 * @param {string} key
 * @param {string|null|undefined} storedValue
 * @param {Record<string, string>} target
 */
export function projectSecretForAdminApi(key, storedValue, target) {
  if (!hasSecretValue(storedValue)) {
    target[key] = '';
    target[`${key}_SET`] = 'false';
    return;
  }
  target[key] = SECRET_SETTING_PLACEHOLDER;
  target[`${key}_SET`] = 'true';
}

/**
 * Resolve value to persist for a secret key.
 * @returns {{ skip: true } | { skip: false, valueToStore: string }}
 */
export async function resolveSecretUpsertValue(db, key, incomingValue) {
  const existingRow = await settingsQueries.getSettingByKey(db, key);
  const existingRaw = existingRow?.value ?? '';

  if (isMaskedOrEmptyApiKey(incomingValue, SECRET_SETTING_PLACEHOLDER)) {
    if (hasSecretValue(existingRaw)) {
      return { skip: true, existingRaw };
    }
    // Clearing when empty incoming and nothing stored — store empty
    if (!String(incomingValue ?? '').trim()) {
      return { skip: false, valueToStore: '' };
    }
    return { skip: true, existingRaw };
  }

  const plaintext = String(incomingValue);
  if (!plaintext.trim()) {
    return { skip: false, valueToStore: '' };
  }
  return { skip: false, valueToStore: encryptSettingValue(plaintext) };
}

/**
 * Encrypt and upsert a secret setting (or skip if masked/unchanged).
 * @returns {Promise<{ unchanged: boolean, stored: boolean, hasValue: boolean }>}
 */
export async function upsertSecretSetting(db, key, incomingValue) {
  if (!isSecretSettingKey(key)) {
    await settingsQueries.upsertSetting(db, key, String(incomingValue ?? ''));
    return { unchanged: false, stored: true, hasValue: Boolean(String(incomingValue ?? '').trim()) };
  }

  const resolved = await resolveSecretUpsertValue(db, key, incomingValue);
  if (resolved.skip) {
    return {
      unchanged: true,
      stored: false,
      hasValue: hasSecretValue(resolved.existingRaw)
    };
  }

  await settingsQueries.upsertSetting(db, key, resolved.valueToStore);
  return {
    unchanged: false,
    stored: true,
    hasValue: hasSecretValue(resolved.valueToStore)
  };
}

/** Wipe a secret even when the admin payload is empty (remove provider). */
export async function clearSecretSetting(db, key) {
  await settingsQueries.upsertSetting(db, key, '');
}
