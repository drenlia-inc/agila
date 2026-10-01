/**
 * Per-user personal access tokens (hashed) for agent / API automation.
 */

import { wrapQuery } from '../queryLogger.js';

export async function listTokensForUser(db, userId) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, user_id, name, token_prefix, description, created_at, last_used_at, revoked_at, expires_at
      FROM user_api_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC
    `),
    'SELECT'
  );
  return await stmt.all(userId);
}

export async function createToken(db, { id, userId, name, tokenPrefix, tokenHash, description, expiresAt }) {
  const stmt = wrapQuery(
    db.prepare(`
      INSERT INTO user_api_tokens (id, user_id, name, token_prefix, token_hash, description, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    `),
    'INSERT'
  );
  await stmt.run(id, userId, name, tokenPrefix, tokenHash, description || '', expiresAt);
  return await getTokenByIdForUser(db, id, userId);
}

export async function getActiveTokensByPrefix(db, prefix) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, user_id, name, token_prefix, token_hash, created_at, last_used_at, revoked_at, expires_at
      FROM user_api_tokens
      WHERE token_prefix = $1
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
    `),
    'SELECT'
  );
  return await stmt.all(prefix);
}

export async function touchLastUsed(db, tokenId) {
  const stmt = wrapQuery(
    db.prepare(`
      UPDATE user_api_tokens
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `),
    'UPDATE'
  );
  return await stmt.run(tokenId);
}

export async function revokeToken(db, tokenId, userId) {
  const existing = await getTokenByIdForUser(db, tokenId, userId);
  if (!existing || existing.revoked_at) {
    return null;
  }
  const stmt = wrapQuery(
    db.prepare(`
      UPDATE user_api_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
    `),
    'UPDATE'
  );
  await stmt.run(tokenId, userId);
  return { id: tokenId };
}

export async function getTokenByIdForUser(db, tokenId, userId) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, user_id, name, token_prefix, description, created_at, last_used_at, revoked_at, expires_at
      FROM user_api_tokens
      WHERE id = $1 AND user_id = $2
    `),
    'SELECT'
  );
  return await stmt.get(tokenId, userId);
}

export async function updateTokenMeta(db, tokenId, userId, { name, description }) {
  const existing = await getTokenByIdForUser(db, tokenId, userId);
  if (!existing || existing.revoked_at) return null;
  const stmt = wrapQuery(
    db.prepare(`
      UPDATE user_api_tokens
      SET name = $1, description = $2
      WHERE id = $3 AND user_id = $4 AND revoked_at IS NULL
    `),
    'UPDATE'
  );
  await stmt.run(name, description ?? '', tokenId, userId);
  return await getTokenByIdForUser(db, tokenId, userId);
}
