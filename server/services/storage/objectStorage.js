/**
 * Unified object storage: disk and/or S3 with dual-read fallback.
 */
import fs from 'fs';
import path from 'path';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import {
  loadStorageConfig,
  buildObjectKey,
  validateS3Config,
  storageConfigFromOverrides,
  filenameFromPublicUrl,
  normalizeKeyPrefix
} from './storageConfig.js';
import { explainS3TestError } from './s3ErrorExplain.js';
import { settings as settingsQueries } from '../../utils/sqlManager/index.js';
import { wrapQuery } from '../../utils/queryLogger.js';

/** Lazy S3 helpers — avoid loading @aws-sdk until an S3 operation runs. */
async function s3() {
  return import('./s3Client.js');
}

/**
 * @param {{ attachments?: string, avatars?: string } | null} storagePaths
 * @param {'attachments' | 'avatars'} category
 * @returns {string}
 */
export function localDirForCategory(storagePaths, category) {
  if (category === 'avatars') {
    return storagePaths?.avatars || path.join(process.cwd(), 'server', 'avatars');
  }
  return storagePaths?.attachments || path.join(process.cwd(), 'server', 'attachments');
}

/**
 * @param {string} dir
 * @param {string} filename
 */
function localPath(dir, filename) {
  const safe = path.basename(String(filename || '').replace(/\.\./g, ''));
  return path.join(dir, safe);
}

async function pathExists(p) {
  try {
    await access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function guessContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * After multer disk write: if backend is S3, upload and remove local copy.
 * @param {*} db
 * @param {{ attachments?: string, avatars?: string }} storagePaths
 * @param {'attachments' | 'avatars'} category
 * @param {{ filename: string, path: string, mimetype?: string }} file
 */
export async function commitUploadedFile(db, storagePaths, category, file) {
  if (!file?.filename || !file?.path) return;
  const config = await loadStorageConfig(db);
  if (config.backend !== 's3') return;

  const validation = validateS3Config(config);
  if (!validation.ok) {
    throw new Error(validation.error || 'Invalid S3 configuration');
  }

  const body = await readFile(file.path);
  const { createS3Client, s3Put } = await s3();
  const client = await createS3Client(config);
  const key = buildObjectKey(config, category, file.filename);
  await s3Put(client, config, key, body, file.mimetype || guessContentType(file.filename));

  try {
    await unlink(file.path);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn('⚠️ Could not remove local staging file after S3 put:', err.message);
    }
  }
}

/**
 * Write buffer/string to the active backend (and dual-write not required).
 * @param {*} db
 * @param {{ attachments?: string, avatars?: string }} storagePaths
 * @param {'attachments' | 'avatars'} category
 * @param {string} filename
 * @param {Buffer | string} data
 * @param {string} [contentType]
 */
export async function putObject(db, storagePaths, category, filename, data, contentType) {
  const config = await loadStorageConfig(db);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const ct = contentType || guessContentType(filename);

  if (config.backend === 's3') {
    const validation = validateS3Config(config);
    if (!validation.ok) throw new Error(validation.error || 'Invalid S3 configuration');
    const { createS3Client, s3Put } = await s3();
    const client = await createS3Client(config);
    const key = buildObjectKey(config, category, filename);
    await s3Put(client, config, key, buf, ct);
    return;
  }

  const dir = localDirForCategory(storagePaths, category);
  await mkdir(dir, { recursive: true });
  await writeFile(localPath(dir, filename), buf);
}

/**
 * Read object with dual-read: primary backend, then fallback.
 * @returns {Promise<{ buffer: Buffer, contentType: string, source: 'disk' | 's3' } | null>}
 */
export async function getObject(db, storagePaths, category, filename) {
  const config = await loadStorageConfig(db);
  const dir = localDirForCategory(storagePaths, category);
  const diskFile = localPath(dir, filename);
  const ct = guessContentType(filename);

  const tryDisk = async () => {
    if (await pathExists(diskFile)) {
      return { buffer: await readFile(diskFile), contentType: ct, source: 'disk' };
    }
    return null;
  };

  const tryS3 = async () => {
    if (!validateS3Config(config).ok) return null;
    try {
      const { createS3Client, s3Get, streamToBuffer } = await s3();
      const client = await createS3Client(config);
      const key = buildObjectKey(config, category, filename);
      const got = await s3Get(client, config, key);
      if (!got) return null;
      const buffer = await streamToBuffer(got.body);
      return {
        buffer,
        contentType: got.contentType || ct,
        source: 's3'
      };
    } catch (err) {
      console.warn('S3 get failed:', err.message);
      return null;
    }
  };

  if (config.backend === 's3') {
    return (await tryS3()) || (await tryDisk());
  }
  return (await tryDisk()) || (await tryS3());
}

/**
 * Delete from both backends when present (best-effort).
 */
export async function deleteObject(db, storagePaths, category, filename) {
  const config = await loadStorageConfig(db);
  const dir = localDirForCategory(storagePaths, category);
  const diskFile = localPath(dir, filename);

  try {
    await unlink(diskFile);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn('Disk delete failed:', err.message);
    }
  }

  if (validateS3Config(config).ok) {
    try {
      const { createS3Client, s3Delete } = await s3();
      const client = await createS3Client(config);
      const key = buildObjectKey(config, category, filename);
      await s3Delete(client, config, key);
    } catch (err) {
      console.warn('S3 delete failed:', err.message);
    }
  }
}

/**
 * True when a key prefix is scoped to a specific tenant (safety guard for bulk delete).
 * @param {string} prefix
 * @param {string} tenantId
 */
function prefixBelongsToTenant(prefix, tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) return false;
  const p = normalizeKeyPrefix(prefix);
  if (!p) return false;
  return (
    p === normalizeKeyPrefix(`tenants/${id}`) ||
    p.includes(`/${id}/`) ||
    p.startsWith(`${id}/`)
  );
}

/**
 * Permanently delete all objects under the tenant's S3_KEY_PREFIX when STORAGE_MODE=managed.
 * No-op (skipped) for custom / unmanaged storage so we never touch a customer bucket from destroy.
 *
 * @param {*} db
 * @param {{ tenantId?: string | null }} [options]
 * @returns {Promise<{
 *   skipped?: boolean,
 *   reason?: string,
 *   deleted?: number,
 *   prefix?: string,
 *   bucket?: string
 * }>}
 */
export async function purgeManagedTenantObjects(db, options = {}) {
  const config = await loadStorageConfig(db);
  if (!config.managed) {
    return { skipped: true, reason: 'STORAGE_MODE is not managed' };
  }

  const validation = validateS3Config(config);
  if (!validation.ok) {
    return { skipped: true, reason: validation.error || 'Invalid S3 configuration' };
  }

  const prefix = normalizeKeyPrefix(config.keyPrefix);
  if (!prefix) {
    throw new Error('Refusing managed S3 purge: empty S3_KEY_PREFIX');
  }

  const tenantId = options.tenantId != null ? String(options.tenantId).trim() : '';
  if (tenantId && !prefixBelongsToTenant(prefix, tenantId)) {
    throw new Error(
      `Refusing managed S3 purge: prefix "${prefix}" is not scoped to tenant "${tenantId}"`
    );
  }

  const { createS3Client, s3DeleteByPrefix } = await s3();
  const client = await createS3Client(config);
  const result = await s3DeleteByPrefix(client, config, prefix);
  console.log(
    `🗑️ Purged ${result.deleted} managed S3 object(s) under s3://${config.bucket}/${result.prefix}`
  );
  return {
    deleted: result.deleted,
    prefix: result.prefix,
    bucket: config.bucket
  };
}

const EMPTY_S3_BASE = Object.freeze({
  backend: 's3',
  managed: false,
  endpoint: '',
  region: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: false,
  keyPrefix: '',
  testOk: false
});

/**
 * @param {import('./storageConfig.js').StorageConfig} a
 * @param {import('./storageConfig.js').StorageConfig} b
 */
function sameS3Target(a, b) {
  const normEp = (v) => String(v || '').trim().replace(/\/+$/, '').toLowerCase();
  return (
    String(a.bucket || '').trim() === String(b.bucket || '').trim() &&
    String(a.keyPrefix || '') === String(b.keyPrefix || '') &&
    normEp(a.endpoint) === normEp(b.endpoint) &&
    String(a.region || '').trim() === String(b.region || '').trim()
  );
}

/**
 * Write destination config as the live tenant S3 settings (cutover after s3-to-s3).
 * @param {*} db
 * @param {import('./storageConfig.js').StorageConfig} config
 */
async function persistLiveS3Config(db, config) {
  const { upsertSecretSetting } = await import('../../utils/settingsSecrets.js');
  await settingsQueries.upsertSetting(db, 'STORAGE_BACKEND', 's3');
  const { markStorageByoAfterCutover } = await import('../../utils/storageMode.js');
  await markStorageByoAfterCutover(db);
  await settingsQueries.upsertSetting(db, 'S3_ENDPOINT', config.endpoint || '');
  await settingsQueries.upsertSetting(db, 'S3_REGION', config.region || '');
  await settingsQueries.upsertSetting(db, 'S3_BUCKET', config.bucket || '');
  await settingsQueries.upsertSetting(db, 'S3_ACCESS_KEY_ID', config.accessKeyId || '');
  await upsertSecretSetting(db, 'S3_SECRET_ACCESS_KEY', config.secretAccessKey || '');
  await settingsQueries.upsertSetting(
    db,
    'S3_FORCE_PATH_STYLE',
    config.forcePathStyle ? 'true' : 'false'
  );
  await settingsQueries.upsertSetting(db, 'S3_KEY_PREFIX', config.keyPrefix || '');
  await settingsQueries.upsertSetting(db, 'STORAGE_TEST_OK', 'true');
}

/**
 * Probe put/get/delete on S3. Optionally use draft overrides from admin UI.
 * @param {*} db
 * @param {Record<string, string | boolean | undefined>} [overrides]
 */
export async function testS3Connection(db, overrides = {}) {
  const asDestination =
    overrides.asDestination === true ||
    overrides.asDestination === 'true' ||
    overrides.asDestination === 1 ||
    overrides.asDestination === '1';

  const base = asDestination ? { ...EMPTY_S3_BASE } : await loadStorageConfig(db);
  const config = storageConfigFromOverrides(overrides, base);
  const validation = validateS3Config(config);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const { createS3Client, s3Put, s3Get, s3Delete, streamToBuffer } = await s3();
  const client = await createS3Client(config);
  const probeKey = `${config.keyPrefix}.easy-kanban-storage-probe`;
  const payload = Buffer.from(`easy-kanban-probe-${Date.now()}`, 'utf8');

  try {
    await s3Put(client, config, probeKey, payload, 'text/plain');
    const got = await s3Get(client, config, probeKey);
    if (!got) {
      return { ok: false, error: 'Put succeeded but Get returned nothing' };
    }
    const buf = await streamToBuffer(got.body);
    if (buf.toString('utf8') !== payload.toString('utf8')) {
      return { ok: false, error: 'Get returned unexpected content' };
    }
    await s3Delete(client, config, probeKey);

    // Destination probes must not flip live STORAGE_TEST_OK (source stays authoritative).
    if (!asDestination) {
      await settingsQueries.upsertSetting(db, 'STORAGE_TEST_OK', 'true');
    }

    return {
      ok: true,
      message: 'S3 read/write test succeeded',
      bucket: config.bucket,
      region: config.region || null,
      endpoint: config.endpoint || null,
      prefix: config.keyPrefix || '(none)',
      asDestination: Boolean(asDestination)
    };
  } catch (err) {
    if (!asDestination) {
      await settingsQueries.upsertSetting(db, 'STORAGE_TEST_OK', 'false');
    }
    const explained = explainS3TestError(err);
    return {
      ok: false,
      error: explained.message,
      errorCode: explained.code,
      technicalDetail: explained.technical,
      asDestination: Boolean(asDestination)
    };
  }
}

/** Reclaim a migration lock left behind by a crashed/restarted process. */
const STALE_MIGRATION_MS = 15 * 60 * 1000;

/**
 * @param {*} db
 * @returns {Promise<boolean>} true if a stale lock was cleared
 */
async function reclaimStaleMigrationLock(db) {
  const status = await settingsQueries.getSettingByKey(db, 'STORAGE_MIGRATION_STATUS');
  if (status?.value !== 'running') return false;

  const detailRow = await settingsQueries.getSettingByKey(db, 'STORAGE_MIGRATION_DETAIL');
  let startedAt = NaN;
  try {
    const parsed = JSON.parse(detailRow?.value || '{}');
    startedAt = Date.parse(parsed.startedAt || '');
  } catch {
    /* treat as stale */
  }

  const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Infinity;
  if (ageMs < STALE_MIGRATION_MS) {
    return false;
  }

  const detail = {
    direction: null,
    startedAt: Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : null,
    finishedAt: new Date().toISOString(),
    errors: ['Previous migration lock was stale (process likely interrupted); cleared automatically'],
    attachments: { copied: 0, skipped: 0, missing: 0, failed: 0 },
    avatars: { copied: 0, skipped: 0, missing: 0, failed: 0 }
  };
  await settingsQueries.upsertSetting(db, 'STORAGE_MIGRATION_STATUS', 'failed');
  await settingsQueries.upsertSetting(db, 'STORAGE_MIGRATION_DETAIL', JSON.stringify(detail));
  return true;
}

/**
 * Copy one file between disk and S3, or between two S3 configs.
 * @param {'disk-to-s3' | 's3-to-disk' | 's3-to-s3'} direction
 * @param {*} [sharedClient] single client for disk↔S3; ignored for s3-to-s3
 * @param {*} [sourceClient]
 * @param {*} [destClient]
 * @param {import('./storageConfig.js').StorageConfig | null} [destConfig]
 */
async function copyOne(
  config,
  storagePaths,
  category,
  filename,
  direction,
  sharedClient,
  sourceClient = null,
  destClient = null,
  destConfig = null
) {
  const dir = localDirForCategory(storagePaths, category);
  const diskFile = localPath(dir, filename);
  const { createS3Client, s3Put, s3Get, s3Exists, streamToBuffer } = await s3();
  const ct = guessContentType(filename);

  if (direction === 's3-to-s3') {
    const srcClient = sourceClient || (await createS3Client(config));
    const dstClient = destClient || (await createS3Client(destConfig));
    const srcKey = buildObjectKey(config, category, filename);
    const dstKey = buildObjectKey(destConfig, category, filename);
    const onSrc = await s3Exists(srcClient, config, srcKey);
    const onDst = await s3Exists(dstClient, destConfig, dstKey);

    if (!onSrc) {
      return onDst ? 'skipped' : 'missing';
    }
    if (onDst) {
      return 'skipped';
    }
    const got = await s3Get(srcClient, config, srcKey);
    if (!got) return 'missing';
    const buffer = await streamToBuffer(got.body);
    await s3Put(dstClient, destConfig, dstKey, buffer, ct);
    return 'copied';
  }

  const client = sharedClient || (await createS3Client(config));
  const key = buildObjectKey(config, category, filename);

  if (direction === 'disk-to-s3') {
    const onDisk = await pathExists(diskFile);
    const onS3 = await s3Exists(client, config, key);

    if (!onDisk) {
      // Referenced in DB but gone from disk — count as already migrated if on S3
      return onS3 ? 'skipped' : 'missing';
    }
    // Source kept on disk after migrate (deleteSource=false) — don't re-upload
    if (onS3) {
      return 'skipped';
    }
    const body = await readFile(diskFile);
    await s3Put(client, config, key, body, ct);
    return 'copied';
  }

  // s3-to-disk
  if (await pathExists(diskFile)) {
    return 'skipped';
  }
  const got = await s3Get(client, config, key);
  if (!got) return 'missing';
  const buffer = await streamToBuffer(got.body);
  await mkdir(dir, { recursive: true });
  await writeFile(diskFile, buffer);
  return 'copied';
}

/**
 * @param {*} db
 * @param {object} detail
 */
async function persistMigrationDetail(db, detail) {
  await settingsQueries.upsertSetting(db, 'STORAGE_MIGRATION_DETAIL', JSON.stringify(detail));
}

/**
 * Validate config and acquire the migration lock. Throws on conflict / bad config.
 * @param {*} db
 * @param {'disk-to-s3' | 's3-to-disk' | 's3-to-s3'} direction
 * @param {{ destination?: Record<string, string> }} [options]
 * @returns {Promise<{ config: object, destConfig: object | null, startedAt: string, detail: object }>}
 */
async function acquireMigrationLock(db, direction, options = {}) {
  if (direction === 's3-to-disk' && process.env.MULTI_TENANT === 'true') {
    throw new Error('Migrating to disk is not supported in multi-tenant mode (no shared local disk across pods)');
  }

  const config = await loadStorageConfig(db);
  let destConfig = null;

  if (direction === 's3-to-s3') {
    if (config.backend !== 's3') {
      throw new Error('Current storage backend must be S3 before migrating S3 → S3');
    }
    const sourceValidation = validateS3Config(config);
    if (!sourceValidation.ok) {
      throw new Error(sourceValidation.error || 'Source S3 is not configured');
    }
    if (!options.destination || typeof options.destination !== 'object') {
      throw new Error('destination S3 configuration is required for s3-to-s3');
    }
    destConfig = storageConfigFromOverrides(options.destination, { ...EMPTY_S3_BASE });
    const destValidation = validateS3Config(destConfig);
    if (!destValidation.ok) {
      throw new Error(destValidation.error || 'Destination S3 is not configured');
    }
    if (sameS3Target(config, destConfig)) {
      throw new Error('Source and destination resolve to the same bucket, endpoint, region, and prefix');
    }
  } else {
    const validation = validateS3Config(config);
    if (!validation.ok) {
      throw new Error(validation.error || 'S3 is not configured');
    }
    if (direction === 'disk-to-s3' && !config.testOk && !config.managed) {
      throw new Error('Run a successful S3 connection test before migrating to S3');
    }
  }

  await reclaimStaleMigrationLock(db);

  const status = await settingsQueries.getSettingByKey(db, 'STORAGE_MIGRATION_STATUS');
  if (status?.value === 'running') {
    const err = new Error('A storage migration is already running');
    err.statusCode = 409;
    throw err;
  }

  const startedAt = new Date().toISOString();
  const detail = {
    direction,
    startedAt,
    phase: 'scanning',
    total: 0,
    processed: 0,
    currentFile: null,
    attachments: { copied: 0, skipped: 0, missing: 0, failed: 0 },
    avatars: { copied: 0, skipped: 0, missing: 0, failed: 0 },
    errors: [],
    cutoverApplied: false
  };

  await settingsQueries.upsertSetting(db, 'STORAGE_MIGRATION_STATUS', 'running');
  await persistMigrationDetail(db, detail);

  return { config, destConfig, startedAt, detail };
}

/**
 * Collect attachment/avatar filenames to migrate / compare.
 * Google SSO users with a live google_avatar_url keep avatar_path only as a UI
 * fallback — those paths are not part of disk↔S3 inventory (avoids "missing both" noise).
 */
async function collectMigrationFilenames(db, storagePaths) {
  const attRows = await wrapQuery(
    db.prepare(`SELECT url FROM attachments WHERE url IS NOT NULL AND url <> ''`),
    'SELECT'
  ).all();
  const attNames = new Set();
  for (const row of attRows || []) {
    const name = filenameFromPublicUrl(row.url, 'attachments');
    if (name) attNames.add(name);
  }

  const attDir = localDirForCategory(storagePaths, 'attachments');
  try {
    const files = await fs.promises.readdir(attDir);
    for (const f of files) {
      if (!f.startsWith('.')) attNames.add(f);
    }
  } catch {
    /* dir may not exist */
  }

  const userRows = await wrapQuery(
    db.prepare(
      `SELECT avatar_path, auth_provider, google_avatar_url
       FROM users
       WHERE avatar_path IS NOT NULL AND avatar_path <> '' AND avatar_path NOT LIKE 'http%'`
    ),
    'SELECT'
  ).all();
  const avatarNames = new Set();
  /** Filenames that exist only as Google SSO display fallbacks — keep on disk, ignore in sync/compare */
  const googleFallbackNames = new Set();
  for (const row of userRows || []) {
    const name = filenameFromPublicUrl(row.avatar_path, 'avatars');
    if (!name) continue;
    if (isGoogleSsoFallbackAvatar(row)) {
      googleFallbackNames.add(name);
      continue;
    }
    avatarNames.add(name);
  }

  // Site logos live under /avatars/ and should participate in sync/compare
  const logoRows = await wrapQuery(
    db.prepare(
      `SELECT value FROM settings
       WHERE key IN ('SITE_LOGO', 'SITE_LOGO_DARK')
         AND value IS NOT NULL AND value <> '' AND value NOT LIKE 'http%'`
    ),
    'SELECT'
  ).all();
  for (const row of logoRows || []) {
    const name = filenameFromPublicUrl(row.value, 'avatars');
    if (name) avatarNames.add(name);
  }

  const avDir = localDirForCategory(storagePaths, 'avatars');
  try {
    const files = await fs.promises.readdir(avDir);
    for (const f of files) {
      if (f.startsWith('.')) continue;
      // On-disk Google fallbacks would otherwise look like "orphan file on disk"
      if (googleFallbackNames.has(f) && !avatarNames.has(f)) continue;
      avatarNames.add(f);
    }
  } catch {
    /* ignore */
  }

  return { attNames, avatarNames, attDir, avDir };
}

/**
 * Run migration work after the lock is held. Updates STORAGE_MIGRATION_DETAIL as it goes.
 * @param {*} db
 * @param {{ attachments?: string, avatars?: string }} storagePaths
 * @param {'disk-to-s3' | 's3-to-disk' | 's3-to-s3'} direction
 * @param {{ deleteSource?: boolean }} options
 * @param {import('./storageConfig.js').StorageConfig} config source (or sole) S3/disk config
 * @param {object} detail
 * @param {import('./storageConfig.js').StorageConfig | null} [destConfig]
 */
async function executeMigrationWork(db, storagePaths, direction, options, config, detail, destConfig = null) {
  const { deleteSource = false } = options;

  try {
    const { createS3Client, s3Delete } = await s3();
    const isS3ToS3 = direction === 's3-to-s3';
    const client = isS3ToS3 ? null : await createS3Client(config);
    const sourceClient = isS3ToS3 ? await createS3Client(config) : null;
    const destClient = isS3ToS3 ? await createS3Client(destConfig) : null;

    const { attNames, avatarNames, attDir, avDir } = await collectMigrationFilenames(
      db,
      storagePaths
    );

    detail.total = attNames.size + avatarNames.size;
    detail.processed = 0;
    detail.phase = attNames.size > 0 ? 'attachments' : avatarNames.size > 0 ? 'avatars' : 'done';
    await persistMigrationDetail(db, detail);

    const sourceLabel =
      direction === 'disk-to-s3' ? 'disk' : direction === 's3-to-disk' ? 'S3' : 'source S3';

    for (const filename of attNames) {
      detail.currentFile = `attachments/${filename}`;
      try {
        const result = await copyOne(
          config,
          storagePaths,
          'attachments',
          filename,
          direction,
          client,
          sourceClient,
          destClient,
          destConfig
        );
        detail.attachments[result] = (detail.attachments[result] || 0) + 1;
        if (result === 'missing' && detail.errors.length < 20) {
          detail.errors.push(`attachments/${filename}: referenced but not found on ${sourceLabel}`);
        }
        if (result === 'copied' && deleteSource) {
          if (direction === 'disk-to-s3') {
            try {
              await unlink(localPath(attDir, filename));
            } catch {
              /* ignore */
            }
          } else if (direction === 's3-to-disk') {
            await s3Delete(client, config, buildObjectKey(config, 'attachments', filename));
          } else if (direction === 's3-to-s3') {
            await s3Delete(sourceClient, config, buildObjectKey(config, 'attachments', filename));
          }
        }
      } catch (err) {
        detail.attachments.failed += 1;
        if (detail.errors.length < 20) {
          detail.errors.push(`attachments/${filename}: ${err.message}`);
        }
      }
      detail.processed += 1;
      await persistMigrationDetail(db, detail);
    }

    detail.phase = 'avatars';
    await persistMigrationDetail(db, detail);

    for (const filename of avatarNames) {
      detail.currentFile = `avatars/${filename}`;
      try {
        const result = await copyOne(
          config,
          storagePaths,
          'avatars',
          filename,
          direction,
          client,
          sourceClient,
          destClient,
          destConfig
        );
        detail.avatars[result] = (detail.avatars[result] || 0) + 1;
        if (result === 'missing' && detail.errors.length < 20) {
          detail.errors.push(`avatars/${filename}: referenced but not found on ${sourceLabel}`);
        }
        if (result === 'copied' && deleteSource) {
          if (direction === 'disk-to-s3') {
            try {
              await unlink(localPath(avDir, filename));
            } catch {
              /* ignore */
            }
          } else if (direction === 's3-to-disk') {
            await s3Delete(client, config, buildObjectKey(config, 'avatars', filename));
          } else if (direction === 's3-to-s3') {
            await s3Delete(sourceClient, config, buildObjectKey(config, 'avatars', filename));
          }
        }
      } catch (err) {
        detail.avatars.failed += 1;
        if (detail.errors.length < 20) {
          detail.errors.push(`avatars/${filename}: ${err.message}`);
        }
      }
      detail.processed += 1;
      await persistMigrationDetail(db, detail);
    }

    detail.phase = 'done';
    detail.currentFile = null;
    detail.finishedAt = new Date().toISOString();
    const hardFail = detail.attachments.failed + detail.avatars.failed > 0;
    const missing = detail.attachments.missing + detail.avatars.missing;
    const statusValue = hardFail ? 'failed' : missing > 0 ? 'completed_with_warnings' : 'completed';

    if (!hardFail) {
      if (direction === 's3-to-s3') {
        await persistLiveS3Config(db, destConfig);
        detail.cutoverApplied = true;
        detail.cutoverBucket = destConfig.bucket;
        detail.cutoverPrefix = destConfig.keyPrefix || '';
      } else {
        await settingsQueries.upsertSetting(
          db,
          'STORAGE_BACKEND',
          direction === 'disk-to-s3' ? 's3' : 'disk'
        );
      }
    }

    await settingsQueries.upsertSetting(db, 'STORAGE_MIGRATION_STATUS', statusValue);
    await persistMigrationDetail(db, detail);

    return {
      ok: !hardFail,
      warning: !hardFail && missing > 0,
      detail
    };
  } catch (err) {
    detail.phase = 'failed';
    detail.currentFile = null;
    detail.finishedAt = new Date().toISOString();
    detail.errors.push(err.message);
    await settingsQueries.upsertSetting(db, 'STORAGE_MIGRATION_STATUS', 'failed');
    await persistMigrationDetail(db, detail);
    throw err;
  }
}

/**
 * Migrate all known attachment/avatar objects between backends (awaits completion).
 * @param {*} db
 * @param {{ attachments?: string, avatars?: string }} storagePaths
 * @param {'disk-to-s3' | 's3-to-disk' | 's3-to-s3'} direction
 * @param {{ deleteSource?: boolean, destination?: Record<string, string> }} [options]
 */
export async function migrateStorageObjects(db, storagePaths, direction, options = {}) {
  const { config, destConfig, detail } = await acquireMigrationLock(db, direction, options);
  return executeMigrationWork(db, storagePaths, direction, options, config, detail, destConfig);
}

/**
 * Start migration in the background (returns after lock is acquired).
 * Progress is written to STORAGE_MIGRATION_STATUS / STORAGE_MIGRATION_DETAIL.
 */
export async function startStorageMigration(db, storagePaths, direction, options = {}) {
  const { config, destConfig, detail } = await acquireMigrationLock(db, direction, options);

  setImmediate(() => {
    executeMigrationWork(db, storagePaths, direction, options, config, detail, destConfig).catch(
      (err) => {
        console.error('❌ Background storage migration failed:', err?.message || err);
      }
    );
  });

  return { started: true, direction, detail };
}

/**
 * Pollable migration progress for the admin UI.
 */
export async function getStorageMigrationStatus(db) {
  const statusRow = await settingsQueries.getSettingByKey(db, 'STORAGE_MIGRATION_STATUS');
  const detailRow = await settingsQueries.getSettingByKey(db, 'STORAGE_MIGRATION_DETAIL');
  const status = statusRow?.value || 'idle';

  let detail = null;
  if (detailRow?.value) {
    try {
      detail = JSON.parse(detailRow.value);
    } catch {
      detail = null;
    }
  }

  const finished =
    status === 'completed' ||
    status === 'completed_with_warnings' ||
    status === 'failed';
  const ok = status === 'completed' || status === 'completed_with_warnings';
  const warning = status === 'completed_with_warnings';

  let message = null;
  if (status === 'running') {
    message = 'Storage migration in progress';
  } else if (status === 'completed') {
    message = 'Storage migration completed';
  } else if (status === 'completed_with_warnings') {
    message = 'Storage migration completed with warnings (some files were missing on the source)';
  } else if (status === 'failed') {
    message = 'Storage migration finished with errors';
  }

  return {
    status,
    detail,
    running: status === 'running',
    finished,
    ok,
    warning,
    message
  };
}

/**
 * @typedef {{ id: string, email: string, name: string }} CompareUser
 * @typedef {{ id: string, ticket: string, title: string }} CompareTask
 * @typedef {{ path: string, filename: string, users?: CompareUser[], tasks?: CompareTask[] }} CompareItem
 */

/**
 * @returns {{ both: number, diskOnly: number, s3Only: number, missing: number, items: { diskOnly: CompareItem[], s3Only: CompareItem[], missing: CompareItem[] } }}
 */
function emptyCompareBucket() {
  return {
    both: 0,
    diskOnly: 0,
    s3Only: 0,
    missing: 0,
    items: { diskOnly: [], s3Only: [], missing: [] }
  };
}

/**
 * Local avatar_path for Google users who already have google_avatar_url is a
 * display fallback only — not something admins should sync or compare.
 * @param {{ auth_provider?: string, authProvider?: string, google_avatar_url?: string, googleAvatarUrl?: string }} row
 */
function isGoogleSsoFallbackAvatar(row) {
  const provider = String(row?.auth_provider || row?.authProvider || '').toLowerCase();
  const googleUrl = row?.google_avatar_url || row?.googleAvatarUrl || '';
  return provider === 'google' && Boolean(String(googleUrl).trim());
}

/**
 * Map avatar filenames → users that reference them (for compare UI details).
 * Skips Google SSO fallback paths (same rule as collectMigrationFilenames).
 * @param {*} db
 * @returns {Promise<Map<string, { id: string, email: string, name: string }[]>>}
 */
async function loadAvatarUserIndex(db) {
  const rows = await wrapQuery(
    db.prepare(
      `SELECT id, email, first_name, last_name, avatar_path, auth_provider, google_avatar_url
       FROM users
       WHERE avatar_path IS NOT NULL AND avatar_path <> '' AND avatar_path NOT LIKE 'http%'`
    ),
    'SELECT'
  ).all();

  /** @type {Map<string, { id: string, email: string, name: string }[]>} */
  const byFilename = new Map();
  for (const row of rows || []) {
    if (isGoogleSsoFallbackAvatar(row)) continue;
    const filename = filenameFromPublicUrl(row.avatar_path, 'avatars');
    if (!filename) continue;
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    const entry = {
      id: row.id,
      email: row.email || '',
      name: name || row.email || row.id
    };
    const list = byFilename.get(filename) || [];
    list.push(entry);
    byFilename.set(filename, list);
  }
  return byFilename;
}

/**
 * Map attachment filenames → tasks (direct task attachments + comment attachments).
 * @param {*} db
 * @returns {Promise<Map<string, { id: string, ticket: string, title: string }[]>>}
 */
async function loadAttachmentTaskIndex(db) {
  const rows = await wrapQuery(
    db.prepare(
      `SELECT
         a.url,
         COALESCE(a.taskid, c.taskid) AS task_id,
         t.ticket,
         t.title
       FROM attachments a
       LEFT JOIN comments c ON c.id = a.commentid
       LEFT JOIN tasks t ON t.id = COALESCE(a.taskid, c.taskid)
       WHERE a.url IS NOT NULL AND a.url <> ''`
    ),
    'SELECT'
  ).all();

  /** @type {Map<string, { id: string, ticket: string, title: string }[]>} */
  const byFilename = new Map();
  for (const row of rows || []) {
    const filename = filenameFromPublicUrl(row.url, 'attachments');
    if (!filename || !row.task_id) continue;
    const entry = {
      id: row.task_id,
      ticket: row.ticket || row.task_id,
      title: row.title || ''
    };
    const list = byFilename.get(filename) || [];
    if (!list.some((t) => t.id === entry.id)) {
      list.push(entry);
    }
    byFilename.set(filename, list);
  }
  return byFilename;
}

/**
 * Compare known attachment/avatar objects between local disk and S3 (read-only).
 */
export async function compareStorageObjects(db, storagePaths) {
  const config = await loadStorageConfig(db);
  const validation = validateS3Config(config);
  if (!validation.ok) {
    throw new Error(validation.error || 'S3 is not configured');
  }

  const { createS3Client, s3Exists } = await s3();
  const client = await createS3Client(config);
  const { attNames, avatarNames, attDir, avDir } = await collectMigrationFilenames(
    db,
    storagePaths
  );
  const avatarUsers = await loadAvatarUserIndex(db);
  const attachmentTasks = await loadAttachmentTaskIndex(db);

  /**
   * @param {'attachments' | 'avatars'} category
   * @param {Set<string>} names
   * @param {string} dir
   */
  async function compareCategory(category, names, dir) {
    const bucket = emptyCompareBucket();
    for (const filename of names) {
      const diskFile = localPath(dir, filename);
      const onDisk = await pathExists(diskFile);
      const key = buildObjectKey(config, category, filename);
      let onS3 = false;
      try {
        onS3 = await s3Exists(client, config, key);
      } catch (err) {
        throw new Error(`S3 check failed for ${category}/${filename}: ${err.message}`);
      }

      /** @type {'both' | 'diskOnly' | 's3Only' | 'missing'} */
      let kind;
      if (onDisk && onS3) kind = 'both';
      else if (onDisk) kind = 'diskOnly';
      else if (onS3) kind = 's3Only';
      else kind = 'missing';

      bucket[kind] += 1;
      if (kind !== 'both') {
        /** @type {CompareItem} */
        const item = {
          path: `${category}/${filename}`,
          filename
        };
        if (category === 'avatars') {
          const users = avatarUsers.get(filename);
          if (users?.length) item.users = users;
        }
        if (category === 'attachments') {
          const tasks = attachmentTasks.get(filename);
          if (tasks?.length) item.tasks = tasks;
        }
        bucket.items[kind].push(item);
      }
    }
    return bucket;
  }

  const attachments = await compareCategory('attachments', attNames, attDir);
  const avatars = await compareCategory('avatars', avatarNames, avDir);

  const sum = (key) => attachments[key] + avatars[key];

  return {
    ok: true,
    attachments,
    avatars,
    totals: {
      scanned: attNames.size + avatarNames.size,
      both: sum('both'),
      diskOnly: sum('diskOnly'),
      s3Only: sum('s3Only'),
      missing: sum('missing')
    },
    bucket: config.bucket,
    prefix: config.keyPrefix || ''
  };
}

export { filenameFromPublicUrl, loadStorageConfig, guessContentType };
