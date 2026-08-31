/**
 * Object / file storage admin settings (disk vs S3).
 */

export const STORAGE_MODE_KEY = 'STORAGE_MODE';
export const STORAGE_MANAGED_ELIGIBLE_KEY = 'STORAGE_MANAGED_ELIGIBLE';

/** `off` is not a stored mode — empty STORAGE_MODE means disk / not using platform S3. */
export const STORAGE_MODES = Object.freeze(['managed', 'byo']);

export const STORAGE_SETTING_DEFAULTS = Object.freeze([
  ['STORAGE_BACKEND', 'disk'], // disk | s3
  ['STORAGE_MODE', ''],
  ['STORAGE_MANAGED', 'false'],
  ['STORAGE_MANAGED_ELIGIBLE', 'false'],
  ['S3_ENDPOINT', ''],
  ['S3_REGION', ''],
  ['S3_BUCKET', ''],
  ['S3_ACCESS_KEY_ID', ''],
  ['S3_SECRET_ACCESS_KEY', ''],
  ['S3_FORCE_PATH_STYLE', 'false'],
  ['S3_KEY_PREFIX', ''],
  ['STORAGE_MIGRATION_STATUS', 'idle'], // idle | running | completed | failed
  ['STORAGE_MIGRATION_DETAIL', ''],
  ['STORAGE_TEST_OK', 'false']
]);

/** Live S3 fields hidden from tenant admins while storage is platform-managed. */
export const STORAGE_MANAGED_HIDDEN_KEYS = Object.freeze([
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'S3_KEY_PREFIX'
]);

export const STORAGE_S3_CONFIG_KEYS = Object.freeze([...STORAGE_MANAGED_HIDDEN_KEYS]);

/** Platform shadow copy — never exposed on tenant admin GET. */
export const PLATFORM_S3_KEYS = Object.freeze([
  'PLATFORM_S3_ENDPOINT',
  'PLATFORM_S3_REGION',
  'PLATFORM_S3_BUCKET',
  'PLATFORM_S3_ACCESS_KEY_ID',
  'PLATFORM_S3_SECRET_ACCESS_KEY',
  'PLATFORM_S3_FORCE_PATH_STYLE',
  'PLATFORM_S3_KEY_PREFIX'
]);

export const STORAGE_ADMIN_INTERNAL_KEYS = Object.freeze([...PLATFORM_S3_KEYS]);
