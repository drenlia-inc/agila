import { settings as settingsQueries } from './sqlManager/index.js';
import {
  STORAGE_MANAGED_ELIGIBLE_KEY,
  STORAGE_MODE_KEY,
  STORAGE_MODES,
} from '../constants/storageSettings.js';
import {
  getDecryptedSetting,
  upsertSecretSetting,
} from './settingsSecrets.js';

const ACTIVE_KEYS = {
  endpoint: 'S3_ENDPOINT',
  region: 'S3_REGION',
  bucket: 'S3_BUCKET',
  accessKeyId: 'S3_ACCESS_KEY_ID',
  secretAccessKey: 'S3_SECRET_ACCESS_KEY',
  forcePathStyle: 'S3_FORCE_PATH_STYLE',
  keyPrefix: 'S3_KEY_PREFIX',
};

const SHADOW_KEYS = {
  endpoint: 'PLATFORM_S3_ENDPOINT',
  region: 'PLATFORM_S3_REGION',
  bucket: 'PLATFORM_S3_BUCKET',
  accessKeyId: 'PLATFORM_S3_ACCESS_KEY_ID',
  secretAccessKey: 'PLATFORM_S3_SECRET_ACCESS_KEY',
  forcePathStyle: 'PLATFORM_S3_FORCE_PATH_STYLE',
  keyPrefix: 'PLATFORM_S3_KEY_PREFIX',
};

async function getSettingValue(db, key) {
  const row = await settingsQueries.getSettingByKey(db, key);
  return String(row?.value ?? '').trim();
}

export function normalizeStorageMode(raw, { managedFlag = '', bucket = '' } = {}) {
  const mode = String(raw || '')
    .trim()
    .toLowerCase();
  if (STORAGE_MODES.includes(mode)) return mode;
  if (String(managedFlag).trim().toLowerCase() === 'true') return 'managed';
  if (String(bucket || '').trim()) return 'byo';
  return '';
}

export async function resolveStorageMode(db) {
  const [modeRaw, managedFlag, bucket] = await Promise.all([
    getSettingValue(db, STORAGE_MODE_KEY),
    getSettingValue(db, 'STORAGE_MANAGED'),
    getSettingValue(db, ACTIVE_KEYS.bucket),
  ]);
  return normalizeStorageMode(modeRaw, { managedFlag, bucket });
}

export async function setStorageModeState(db, mode) {
  await settingsQueries.upsertSetting(db, STORAGE_MODE_KEY, mode);
  await settingsQueries.upsertSetting(db, 'STORAGE_MANAGED', mode === 'managed' ? 'true' : 'false');
}

export async function writePlatformS3Shadow(db, creds) {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, keyPrefix } =
    creds;
  if (endpoint != null) await settingsQueries.upsertSetting(db, SHADOW_KEYS.endpoint, endpoint);
  if (region != null) await settingsQueries.upsertSetting(db, SHADOW_KEYS.region, region);
  if (bucket) await settingsQueries.upsertSetting(db, SHADOW_KEYS.bucket, bucket);
  if (accessKeyId) await settingsQueries.upsertSetting(db, SHADOW_KEYS.accessKeyId, accessKeyId);
  if (forcePathStyle != null) {
    await settingsQueries.upsertSetting(db, SHADOW_KEYS.forcePathStyle, forcePathStyle);
  }
  if (keyPrefix != null) await settingsQueries.upsertSetting(db, SHADOW_KEYS.keyPrefix, keyPrefix);
  if (secretAccessKey) {
    await upsertSecretSetting(db, SHADOW_KEYS.secretAccessKey, secretAccessKey);
  }
}

export async function mirrorActiveS3ToPlatformShadow(db) {
  const [endpoint, region, bucket, accessKeyId, forcePathStyle, keyPrefix, secretAccessKey] =
    await Promise.all([
      getSettingValue(db, ACTIVE_KEYS.endpoint),
      getSettingValue(db, ACTIVE_KEYS.region),
      getSettingValue(db, ACTIVE_KEYS.bucket),
      getSettingValue(db, ACTIVE_KEYS.accessKeyId),
      getSettingValue(db, ACTIVE_KEYS.forcePathStyle),
      getSettingValue(db, ACTIVE_KEYS.keyPrefix),
      getDecryptedSetting(db, ACTIVE_KEYS.secretAccessKey),
    ]);
  if (!bucket || !accessKeyId || !secretAccessKey) return;
  await writePlatformS3Shadow(db, {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: forcePathStyle || 'false',
    keyPrefix,
  });
}

export async function markStorageManagedEligible(db) {
  await settingsQueries.upsertSetting(db, STORAGE_MANAGED_ELIGIBLE_KEY, 'true');
}

/** Mark BYO after S3→S3 cutover. Live dest creds are already persisted. */
export async function markStorageByoAfterCutover(db) {
  const current = await resolveStorageMode(db);
  if (current === 'managed') {
    await mirrorActiveS3ToPlatformShadow(db);
  }
  await setStorageModeState(db, 'byo');
}

/** Switch off platform ownership without wiping live S3 (files still on the platform bucket). */
export async function switchToByoStorage(db) {
  const current = await resolveStorageMode(db);
  if (current === 'managed') {
    await mirrorActiveS3ToPlatformShadow(db);
  }
  await setStorageModeState(db, 'byo');
  await settingsQueries.upsertSetting(db, 'STORAGE_TEST_OK', 'false');
  return { ok: true, mode: 'byo' };
}

export function storageClientPatch(mode) {
  if (mode === 'managed') {
    return {
      STORAGE_MODE: 'managed',
      STORAGE_MANAGED: 'true',
      STORAGE_BACKEND: 's3',
      S3_ENDPOINT: '',
      S3_REGION: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      S3_SECRET_ACCESS_KEY_SET: 'false',
      S3_FORCE_PATH_STYLE: '',
      S3_KEY_PREFIX: '',
    };
  }
  if (mode === 'byo') {
    return {
      STORAGE_MODE: 'byo',
      STORAGE_MANAGED: 'false',
    };
  }
  return {};
}
