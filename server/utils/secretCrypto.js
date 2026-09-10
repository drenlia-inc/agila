/**
 * Shared AES-256-GCM helpers for secrets at rest (settings, SSH/GitHub user secrets).
 */

import crypto from 'crypto';

const SSH_SALT = 'easy-kanban-agent-ssh-v1';
const SETTINGS_SALT = 'easy-kanban-settings-v1';
export const SETTINGS_ENC_PREFIX = 'enc:v1:';

function resolveMasterSecret(requireFor) {
  if (requireFor === 'settings') {
    const settingsKey = String(process.env.SETTINGS_ENCRYPTION_KEY || '').trim();
    if (settingsKey) return settingsKey;
    const jwt = process.env.JWT_SECRET;
    if (!jwt) {
      throw new Error('SETTINGS_ENCRYPTION_KEY or JWT_SECRET is required for settings encryption');
    }
    return jwt;
  }
  const jwt = process.env.JWT_SECRET;
  if (!jwt) {
    throw new Error('JWT_SECRET environment variable is required for SSH key encryption');
  }
  return jwt;
}

function deriveKey(salt, requireFor) {
  return crypto.scryptSync(resolveMasterSecret(requireFor), salt, 32);
}

/**
 * Encrypt plaintext (SSH / GitHub PAT path — JWT_SECRET + SSH salt).
 * @param {string} plaintext
 * @returns {string} base64(iv + tag + ciphertext)
 */
export function encryptSecret(plaintext) {
  const key = deriveKey(SSH_SALT, 'ssh');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt SSH / GitHub PAT ciphertext.
 * @param {string} payload
 * @returns {string}
 */
export function decryptSecret(payload) {
  const key = deriveKey(SSH_SALT, 'ssh');
  const buf = Buffer.from(String(payload), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** True when ciphertext decrypts with the current JWT_SECRET. */
export function canDecryptSecret(payload) {
  if (!payload) return false;
  try {
    decryptSecret(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export function isEncryptedSettingValue(value) {
  return typeof value === 'string' && value.startsWith(SETTINGS_ENC_PREFIX);
}

/**
 * Encrypt a settings-table secret for storage.
 * @param {string} plaintext
 * @returns {string} enc:v1:… ciphertext
 */
export function encryptSettingValue(plaintext) {
  const key = deriveKey(SETTINGS_SALT, 'settings');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return `${SETTINGS_ENC_PREFIX}${body}`;
}

/**
 * Decrypt a settings value, or return legacy plaintext as-is.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function decryptSettingValue(value) {
  if (value == null || value === '') return '';
  const s = String(value);
  if (!isEncryptedSettingValue(s)) {
    return s;
  }
  const key = deriveKey(SETTINGS_SALT, 'settings');
  const buf = Buffer.from(s.slice(SETTINGS_ENC_PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * @param {string|null|undefined} value
 * @returns {{ value: string, hasValue: boolean, unreadable: boolean }}
 */
export function decryptSettingValueSafe(value) {
  const raw = String(value ?? '');
  if (!raw.trim()) {
    return { value: '', hasValue: false, unreadable: false };
  }
  try {
    return { value: decryptSettingValue(raw), hasValue: true, unreadable: false };
  } catch {
    return { value: '', hasValue: true, unreadable: true };
  }
}

/** True when an enc:v1: blob decrypts with the current SETTINGS_ENCRYPTION_KEY / JWT fallback. */
export function canDecryptSettingValue(value) {
  return !decryptSettingValueSafe(value).unreadable;
}
