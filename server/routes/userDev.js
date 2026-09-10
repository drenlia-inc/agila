/**
 * User Dev credentials: personal access tokens + dedicated SSH keypair (AI-gated).
 */

import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticateToken } from '../middleware/auth.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { requireAiEnabledMiddleware } from '../utils/aiEnabled.js';
import {
  userApiTokens as tokenQueries,
  userSshKeys as sshQueries,
  userGithubTokens as githubTokenQueries,
  settings as settingsQueries
} from '../utils/sqlManager/index.js';
import {
  generateEd25519SshKeyPair,
  encryptSecret,
  decryptSecret,
  canDecryptSecret
} from '../utils/sshKeyCrypto.js';
import { tokenMintLimiter, githubRepoProbeLimiter } from '../middleware/rateLimiters.js';
import { maskApiKey, isMaskedOrEmptyApiKey } from '../utils/maskSecret.js';
import { probeGithubRepoWithPat } from '../utils/githubRepoProbe.js';
import {
  parseBody,
  createDevTokenBodySchema,
  githubTokenBodySchema,
  githubRepoProbeBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();
const requireAi = requireAiEnabledMiddleware(getRequestDatabase);

/**
 * Tenant LLM model name for display (no secrets).
 * Used so non-admins can see which model a task will use (read-only in the UI).
 */
router.get('/agent-llm', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const row = await settingsQueries.getSettingByKey(db, 'AI_MODEL');
    const tenantModel = String(row?.value || '').trim();
    res.json({ tenantModel });
  } catch (error) {
    console.error('Get agent LLM info error:', error);
    res.status(500).json({ error: 'Failed to load agent LLM info' });
  }
});

function serializeToken(row) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at
  };
}

// List tokens
router.get('/tokens', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const rows = await tokenQueries.listTokensForUser(db, req.user.id);
    res.json(rows.map(serializeToken));
  } catch (error) {
    console.error('List API tokens error:', error);
    res.status(500).json({ error: 'Failed to list API tokens' });
  }
});

// Create token (raw value returned once)
router.post('/tokens', authenticateToken, requireAi, tokenMintLimiter, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(createDevTokenBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const name = (parsed.data.name || 'Agent API token').toString().slice(0, 100);
    const rawToken = `ek_${crypto.randomBytes(32).toString('hex')}`;
    const tokenPrefix = rawToken.slice(0, 11);
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const id = crypto.randomUUID();

    const row = await tokenQueries.createToken(db, {
      id,
      userId: req.user.id,
      name,
      tokenPrefix,
      tokenHash
    });

    res.status(201).json({
      token: serializeToken(row),
      rawToken
    });
  } catch (error) {
    console.error('Create API token error:', error);
    res.status(500).json({ error: 'Failed to create API token' });
  }
});

// Revoke token
router.delete('/tokens/:id', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const revoked = await tokenQueries.revokeToken(db, req.params.id, req.user.id);
    if (!revoked) {
      return res.status(404).json({ error: 'Token not found or already revoked' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke API token error:', error);
    res.status(500).json({ error: 'Failed to revoke API token' });
  }
});

// SSH key metadata (public only)
router.get('/ssh-key', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const row = await sshQueries.getSshKeyMeta(db, req.user.id);
    if (!row) {
      return res.json({ key: null, needsReenter: false });
    }
    const full = await sshQueries.getSshKeyWithPrivate(db, req.user.id);
    const needsReenter = Boolean(
      full?.private_key_encrypted && !canDecryptSecret(full.private_key_encrypted)
    );
    res.json({
      key: {
        publicKey: row.public_key,
        fingerprint: row.fingerprint,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      needsReenter
    });
  } catch (error) {
    console.error('Get SSH key error:', error);
    res.status(500).json({ error: 'Failed to get SSH key' });
  }
});

// Generate or regenerate SSH keypair
router.post('/ssh-key', authenticateToken, requireAi, tokenMintLimiter, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { publicKey, privateKey, fingerprint } = generateEd25519SshKeyPair(
      `easy-kanban-agent-${req.user.id.slice(0, 8)}`
    );
    const privateKeyEncrypted = encryptSecret(privateKey);
    const row = await sshQueries.upsertSshKey(db, {
      userId: req.user.id,
      publicKey,
      privateKeyEncrypted,
      fingerprint
    });

    res.status(201).json({
      key: {
        publicKey: row.public_key,
        fingerprint: row.fingerprint,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      // Private key returned once on generate for immediate download
      privateKey
    });
  } catch (error) {
    console.error('Generate SSH key error:', error);
    res.status(500).json({ error: 'Failed to generate SSH key' });
  }
});

// Download private key (owner only)
router.get('/ssh-key/private', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const row = await sshQueries.getSshKeyWithPrivate(db, req.user.id);
    if (!row) {
      return res.status(404).json({ error: 'No SSH key found. Generate one first.' });
    }
    if (!canDecryptSecret(row.private_key_encrypted)) {
      return res.status(400).json({
        error: 'Saved SSH key cannot be decrypted. Generate a new key under Profile → Dev.',
        code: 'secret_unreadable'
      });
    }
    const privateKey = decryptSecret(row.private_key_encrypted);
    res.json({ privateKey, fingerprint: row.fingerprint });
  } catch (error) {
    console.error('Download SSH private key error:', error);
    res.status(500).json({ error: 'Failed to download private key' });
  }
});

// GitHub PAT metadata (never returns raw token)
router.get('/github-token', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const row = await githubTokenQueries.getGithubTokenMeta(db, req.user.id);
    if (!row) {
      return res.json({ configured: false, token: null, needsReenter: false });
    }
    const enc = await githubTokenQueries.getGithubTokenEncrypted(db, req.user.id);
    const readable = canDecryptSecret(enc?.token_encrypted);
    res.json({
      configured: true,
      needsReenter: !readable,
      token: {
        hint: row.token_hint || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    console.error('Get GitHub token error:', error);
    res.status(500).json({ error: 'Failed to get GitHub token' });
  }
});

// Save / replace GitHub PAT
router.put('/github-token', authenticateToken, requireAi, tokenMintLimiter, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(githubTokenBodySchema, req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const raw = parsed.data.token;
    const existing = await githubTokenQueries.getGithubTokenMeta(db, req.user.id);
    if (isMaskedOrEmptyApiKey(raw, existing?.token_hint || '')) {
      return res.status(400).json({ error: 'Provide a new GitHub personal access token' });
    }
    const hint = maskApiKey(raw);
    const row = await githubTokenQueries.upsertGithubToken(db, {
      userId: req.user.id,
      tokenEncrypted: encryptSecret(raw),
      tokenHint: hint
    });
    res.json({
      configured: true,
      token: {
        hint: row.token_hint || hint,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    console.error('Save GitHub token error:', error);
    res.status(500).json({ error: 'Failed to save GitHub token' });
  }
});

// Delete GitHub PAT
router.delete('/github-token', authenticateToken, requireAi, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    await githubTokenQueries.deleteGithubToken(db, req.user.id);
    res.json({ success: true, configured: false });
  } catch (error) {
    console.error('Delete GitHub token error:', error);
    res.status(500).json({ error: 'Failed to delete GitHub token' });
  }
});

/**
 * Probe GitHub repo access with the current user's PAT (no runner).
 * Body: { repoUrl: string }
 * Used for Connected/Failed badge + branch suggestions in assign/config UI.
 */
router.post(
  '/github-repo-probe',
  authenticateToken,
  requireAi,
  githubRepoProbeLimiter,
  async (req, res) => {
    try {
      const db = getRequestDatabase(req);
      const parsed = parseBody(githubRepoProbeBodySchema, req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          reason: 'invalid_url',
          error: parsed.error
        });
      }
      const repoUrl = parsed.data.repoUrl;

      let githubToken = '';
      const patRow = await githubTokenQueries.getGithubTokenEncrypted(db, req.user.id);
      if (patRow?.token_encrypted) {
        if (!canDecryptSecret(patRow.token_encrypted)) {
          console.warn(
            'GitHub PAT ciphertext cannot be decrypted (JWT_SECRET changed or data is corrupt) — re-paste the PAT under Profile → Dev'
          );
          return res.json({
            ok: false,
            reason: 'pat_unreadable',
            error:
              'Saved GitHub token cannot be decrypted. Paste the same PAT again under Profile → Dev.'
          });
        }
        githubToken = decryptSecret(patRow.token_encrypted);
      }

      const result = await probeGithubRepoWithPat(githubToken, repoUrl);
      res.json(result);
    } catch (error) {
      console.error('GitHub repo probe error:', error);
      res.status(500).json({
        ok: false,
        reason: 'server_error',
        error: 'Failed to probe repository'
      });
    }
  }
);

export default router;
