/**
 * Public storage service exports.
 */
import path from 'path';
import { fileURLToPath } from 'url';

export {
  loadStorageConfig,
  buildObjectKey,
  validateS3Config,
  storageConfigFromOverrides,
  filenameFromPublicUrl,
  defaultTenantKeyPrefix,
  normalizeKeyPrefix
} from './storageConfig.js';

export {
  commitUploadedFile,
  putObject,
  getObject,
  deleteObject,
  purgeManagedTenantObjects,
  testS3Connection,
  migrateStorageObjects,
  startStorageMigration,
  getStorageMigrationStatus,
  compareStorageObjects,
  compareDiskToS3,
  compareS3ToS3,
  localDirForCategory,
  guessContentType
} from './objectStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve tenant storage paths from an Express request.
 * @param {import('express').Request} req
 */
export function getRequestStoragePaths(req) {
  if (req?.locals?.tenantStoragePaths) return req.locals.tenantStoragePaths;
  if (req?.app?.locals?.tenantStoragePaths) return req.app.locals.tenantStoragePaths;

  const basePath =
    process.env.DOCKER_ENV === 'true' ? '/app/server' : path.join(__dirname, '../..');

  return {
    attachments: path.join(basePath, 'attachments'),
    avatars: path.join(basePath, 'avatars')
  };
}
