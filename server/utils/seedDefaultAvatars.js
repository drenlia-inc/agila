/**
 * Write seed letter / bot avatars to the live storage backend.
 * Schema init often writes them to a single pod's disk; EKS has no shared volume,
 * so disk→S3 migrate misses them after STORAGE_BACKEND flips to s3.
 */

import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { wrapQuery } from './queryLogger.js';
import { filenameFromPublicUrl } from '../services/storage/storageConfig.js';
import { getTenantStoragePaths } from '../middleware/tenantRouting.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LETTER_COLORS = {
  admin: '#FF6B6B',
  demo: '#4ECDC4',
  user: '#6366F1',
  system: '#1E40AF',
  agent: '#6366F1'
};

const DEFAULT_AVATAR_RE = /^default-([a-z]+)-([a-z0-9])-\d+\.svg$/i;

function letterSvg(letter, role) {
  const backgroundColor = LETTER_COLORS[role] || LETTER_COLORS.user;
  const size = 100;
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${backgroundColor}"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.6}" 
            fill="white" text-anchor="middle" dominant-baseline="central" font-weight="bold">${letter}</text>
    </svg>`;
}

function bundledAgentBotPath() {
  const candidates = [
    join(__dirname, '..', 'assets', 'agent-bot.jpg'),
    join(__dirname, '..', '..', 'public', 'agent-bot.jpg')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * @param {*} db
 * @param {string | null} tenantId
 * @returns {Promise<{ written: string[], skipped: string[], errors: string[] }>}
 */
export async function seedDefaultAvatarsToLiveStorage(db, tenantId) {
  const { putObject } = await import('../services/storage/index.js');
  const storagePaths = getTenantStoragePaths(tenantId);
  const written = [];
  const skipped = [];
  const errors = [];

  const users = await wrapQuery(
    db.prepare(
      `SELECT id, avatar_path FROM users
       WHERE avatar_path IS NOT NULL AND avatar_path <> '' AND avatar_path NOT LIKE 'http%'`
    ),
    'SELECT'
  ).all();

  const logoRows = await wrapQuery(
    db.prepare(
      `SELECT value FROM settings
       WHERE key IN ('SITE_LOGO', 'SITE_LOGO_DARK')
         AND value IS NOT NULL AND value <> '' AND value NOT LIKE 'http%'`
    ),
    'SELECT'
  ).all();

  const names = new Set();
  for (const row of users || []) {
    const name = filenameFromPublicUrl(row.avatar_path, 'avatars');
    if (name) names.add(name);
  }
  for (const row of logoRows || []) {
    const name = filenameFromPublicUrl(row.value, 'avatars');
    if (name) names.add(name);
  }

  for (const filename of names) {
    try {
      // System account uses an in-app letter mark — do not write a phantom S3 object.
      if (/^default-system-/i.test(filename)) {
        skipped.push(filename);
        continue;
      }
      const letterMatch = filename.match(DEFAULT_AVATAR_RE);
      if (letterMatch) {
        const role = letterMatch[1].toLowerCase();
        const letter = letterMatch[2].toUpperCase();
        await putObject(
          db,
          storagePaths,
          'avatars',
          filename,
          letterSvg(letter, role),
          'image/svg+xml'
        );
        written.push(filename);
        continue;
      }
      if (filename === 'agent-bot.jpg') {
        const src = bundledAgentBotPath();
        if (!src) {
          skipped.push(filename);
          continue;
        }
        await putObject(db, storagePaths, 'avatars', filename, fs.readFileSync(src), 'image/jpeg');
        written.push(filename);
        continue;
      }
      skipped.push(filename);
    } catch (err) {
      errors.push(`${filename}: ${err.message}`);
    }
  }

  return { written, skipped, errors };
}
