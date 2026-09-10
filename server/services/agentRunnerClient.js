/**
 * HTTP client for the push-based agent runner service.
 */

import crypto from 'crypto';
import { settings as settingsQueries } from '../utils/sqlManager/index.js';
import { clampAiMaxConcurrent } from '../constants/aiSettings.js';
import { isMaskedOrEmptyApiKey } from '../utils/maskSecret.js';

async function getSetting(db, key) {
  const { getDecryptedSetting } = await import('../utils/settingsSecrets.js');
  const { isSecretSettingKey } = await import('../constants/secretSettings.js');
  if (isSecretSettingKey(key)) {
    return getDecryptedSetting(db, key);
  }
  const row = await settingsQueries.getSettingByKey(db, key);
  return row?.value ?? '';
}

function isMultiTenant() {
  return process.env.MULTI_TENANT === 'true';
}

/**
 * Resolve runner URL/token.
 * Multi-tenant (shared platform runner): always from env — tenant Admin cannot override.
 * Single-tenant: tenant setting, optional probe overrides, else platform env.
 * @param {object} db
 * @param {{ runnerUrl?: string, runnerToken?: string }} [overrides]
 */
export async function resolveRunnerConfig(db, overrides = {}) {
  if (isMultiTenant()) {
    let url = String(process.env.AI_RUNNER_URL || process.env.RUNNER_URL || '').trim();
    if (!url) {
      url = 'http://agila-runner:8080';
    }
    const token = String(process.env.RUNNER_TOKEN || process.env.AI_RUNNER_TOKEN || '').trim();
    return { url: url.replace(/\/+$/, ''), token };
  }

  let url =
    overrides.runnerUrl !== undefined
      ? String(overrides.runnerUrl || '').trim()
      : (await getSetting(db, 'AI_RUNNER_URL')).trim();
  if (!url) {
    url = String(process.env.AI_RUNNER_URL || process.env.RUNNER_URL || '').trim();
  }
  if (!url) {
    url = 'http://agila-runner:8080';
  }
  url = url.replace(/\/+$/, '');

  let token =
    overrides.runnerToken !== undefined &&
    !isMaskedOrEmptyApiKey(overrides.runnerToken)
      ? String(overrides.runnerToken).trim()
      : (await getSetting(db, 'AI_RUNNER_TOKEN')).trim();
  if (!token) {
    token = String(process.env.RUNNER_TOKEN || process.env.AI_RUNNER_TOKEN || '').trim();
  }

  return { url, token };
}

/**
 * @param {object} db
 * @param {{ runnerUrl?: string, runnerToken?: string }} [overrides]
 */
export async function probeRunner(db, overrides = {}) {
  const { url, token } = await resolveRunnerConfig(db, overrides);
  if (!token) {
    if (process.env.MULTI_TENANT !== 'true') {
      const { inspectSecretSetting } = await import('../utils/settingsSecrets.js');
      const inspect = await inspectSecretSetting(db, 'AI_RUNNER_TOKEN');
      if (inspect.hasValue && !inspect.readable) {
        return {
          ok: false,
          errorCode: 'secret_unreadable',
          error:
            'Saved runner token cannot be decrypted. Paste the same token again in Settings → AI and save.'
        };
      }
    }
    return {
      ok: false,
      error:
        'Runner token is not configured. Set AI_RUNNER_TOKEN in admin settings or RUNNER_TOKEN in the environment.'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/v1/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        error: `Runner returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`
      };
    }
    const body = await res.json().catch(() => ({}));
    return {
      ok: true,
      detail: `Runner reachable (${url}) — running ${body.running ?? '?'}/${body.maxConcurrent ?? '?'}`,
      status: body
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: `Timed out reaching runner at ${url}` };
    }
    return {
      ok: false,
      error: `Could not reach runner at ${url}: ${err?.message || String(err)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build absolute callback URL for the tenant.
 * Prefer AI_CALLBACK_BASE_URL for in-cluster/Docker runner→app calls
 * (multi-tenant: shared internal service; runner must send X-Tenant-Id).
 * @param {{ siteUrl?: string, tenantId?: string|null, reqHost?: string, reqProtocol?: string }} opts
 */
export function buildCallbackUrl(opts = {}) {
  const internal = String(process.env.AI_CALLBACK_BASE_URL || '').trim().replace(/\/+$/, '');
  if (internal) {
    return `${internal}/api/agent/runner/callback`;
  }

  let base = String(opts.siteUrl || '').trim().replace(/\/+$/, '');
  if (!base && opts.reqHost) {
    const proto = opts.reqProtocol || 'http';
    base = `${proto}://${opts.reqHost}`.replace(/\/+$/, '');
  }
  if (!base && process.env.SITE_URL) {
    base = String(process.env.SITE_URL).replace(/\/+$/, '');
  }
  if (!base && opts.tenantId && process.env.TENANT_DOMAIN) {
    base = `https://${opts.tenantId}.${process.env.TENANT_DOMAIN}`;
  }
  if (!base) {
    base = 'http://agila-app:3222';
  }
  return `${base}/api/agent/runner/callback`;
}

export function mintCallbackToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function mintJobId() {
  return crypto.randomUUID();
}

/**
 * POST a new job to the runner.
 * @returns {Promise<{ ok: true, jobId: string, status?: number } | { ok: false, error: string, status?: number, busy?: boolean }>}
 */
export async function launchJob(db, payload) {
  const { url, token } = await resolveRunnerConfig(db);
  if (!token) {
    return { ok: false, error: 'Runner token is not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${url}/v1/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (res.status === 429) {
      return {
        ok: false,
        busy: true,
        status: 429,
        error: body?.error || 'Runner at capacity'
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body?.error || `Runner launch failed (HTTP ${res.status})`
      };
    }
    return {
      ok: true,
      jobId: body?.jobId || payload.jobId,
      status: res.status
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Timed out launching job on runner' };
    }
    return { ok: false, error: `Launch failed: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cancel a running job on the runner.
 */
export async function cancelJob(db, jobId, reason = 'cancelled') {
  if (!jobId) return { ok: false, error: 'No job id' };
  const { url, token } = await resolveRunnerConfig(db);
  if (!token) {
    return { ok: false, error: 'Runner token is not configured' };
  }

  try {
    const res = await fetch(`${url}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ reason })
    });
    if (res.status === 404) {
      return { ok: true, missing: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text.slice(0, 200) || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {object} db
 * @param {string} jobId
 * @returns {Promise<{ ok: boolean, missing?: boolean, status?: string, error?: string }>}
 */
export async function getRunnerJob(db, jobId) {
  if (!jobId) return { ok: false, missing: true };
  const { url, token } = await resolveRunnerConfig(db);
  if (!token || !url) {
    return { ok: false, error: 'Runner is not configured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (res.status === 404) {
      return { ok: false, missing: true };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, status: body?.status || 'unknown' };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Timed out reaching runner' };
    }
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getTenantMaxConcurrent(db) {
  const raw = await getSetting(db, 'AI_MAX_CONCURRENT');
  return clampAiMaxConcurrent(raw || '1');
}
