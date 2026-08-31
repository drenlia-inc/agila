import axios from 'axios';
import { settings as settingsQueries } from './sqlManager/index.js';
import { getAuthHubCallbackUrl } from './authHub.js';
import { invalidateOAuthConfigCache } from './oauthConfigCache.js';
import {
  GOOGLE_SSO_MANAGED_ELIGIBLE_KEY,
  GOOGLE_SSO_MODE_KEY,
  GOOGLE_SSO_MODES,
  GOOGLE_SSO_RESUME_MODE_KEY,
} from '../constants/ssoSettings.js';
import {
  clearSecretSetting,
  getDecryptedSetting,
  upsertSecretSetting,
} from './settingsSecrets.js';

const ACTIVE_KEYS = {
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  callbackUrl: 'GOOGLE_CALLBACK_URL',
};

const SHADOW_KEYS = {
  clientId: 'PLATFORM_GOOGLE_CLIENT_ID',
  clientSecret: 'PLATFORM_GOOGLE_CLIENT_SECRET',
  callbackUrl: 'PLATFORM_GOOGLE_CALLBACK_URL',
};

async function getSettingValue(db, key) {
  const row = await settingsQueries.getSettingByKey(db, key);
  return String(row?.value ?? '').trim();
}

export function normalizeGoogleSsoMode(raw, { managedFlag = '', clientId = '' } = {}) {
  const mode = String(raw || '')
    .trim()
    .toLowerCase();
  if (GOOGLE_SSO_MODES.includes(mode)) return mode;
  if (String(managedFlag).trim().toLowerCase() === 'true') return 'managed';
  if (String(clientId || '').trim()) return 'byo';
  return 'off';
}

export async function resolveGoogleSsoMode(db) {
  const [modeRaw, managedFlag, clientId] = await Promise.all([
    getSettingValue(db, GOOGLE_SSO_MODE_KEY),
    getSettingValue(db, 'GOOGLE_SSO_MANAGED'),
    getSettingValue(db, ACTIVE_KEYS.clientId),
  ]);
  return normalizeGoogleSsoMode(modeRaw, { managedFlag, clientId });
}

export function isGoogleSsoLoginEnabled(mode) {
  return mode === 'managed' || mode === 'byo';
}

export async function readPlatformGoogleShadow(db) {
  const [clientId, callbackUrl, clientSecret] = await Promise.all([
    getSettingValue(db, SHADOW_KEYS.clientId),
    getSettingValue(db, SHADOW_KEYS.callbackUrl),
    getDecryptedSetting(db, SHADOW_KEYS.clientSecret),
  ]);
  return { clientId, clientSecret, callbackUrl };
}

export async function writePlatformGoogleShadow(db, { clientId, clientSecret, callbackUrl }) {
  if (clientId) {
    await settingsQueries.upsertSetting(db, SHADOW_KEYS.clientId, clientId);
  }
  if (callbackUrl) {
    await settingsQueries.upsertSetting(db, SHADOW_KEYS.callbackUrl, callbackUrl);
  }
  if (clientSecret) {
    await upsertSecretSetting(db, SHADOW_KEYS.clientSecret, clientSecret);
  }
}

export async function applyPlatformGoogleShadowToActive(db) {
  const shadow = await readPlatformGoogleShadow(db);
  if (!shadow.clientId || !shadow.clientSecret || !shadow.callbackUrl) {
    return { ok: false, reason: 'shadow_incomplete' };
  }
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.clientId, shadow.clientId);
  await upsertSecretSetting(db, ACTIVE_KEYS.clientSecret, shadow.clientSecret);
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.callbackUrl, shadow.callbackUrl);
  return { ok: true, source: 'shadow' };
}

export async function fetchPlatformGoogleDefaultsFromAdmin() {
  const base = String(process.env.ADMIN_SERVICE_URL || '').trim().replace(/\/+$/, '');
  const token = String(process.env.INSTANCE_TOKEN || '').trim();
  if (!base || !token) return null;
  try {
    const res = await axios.get(`${base}/api/instance-callback/google-sso-defaults`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000,
    });
    const clientId = String(res.data?.clientId || '').trim();
    const clientSecret = String(res.data?.clientSecret || '').trim();
    const callbackUrl = String(res.data?.callbackUrl || getAuthHubCallbackUrl()).trim();
    if (!clientId || !clientSecret || !callbackUrl) return null;
    return { clientId, clientSecret, callbackUrl };
  } catch (err) {
    console.error('Failed to fetch platform Google SSO defaults:', err.message);
    return null;
  }
}

async function setGoogleSsoModeState(db, mode, tenantId) {
  await settingsQueries.upsertSetting(db, GOOGLE_SSO_MODE_KEY, mode);
  await settingsQueries.upsertSetting(
    db,
    'GOOGLE_SSO_MANAGED',
    mode === 'managed' ? 'true' : 'false'
  );
  invalidateOAuthConfigCache(tenantId);
}

export async function disableGoogleSso(db, tenantId) {
  const current = await resolveGoogleSsoMode(db);
  if (current !== 'off') {
    await settingsQueries.upsertSetting(
      db,
      GOOGLE_SSO_RESUME_MODE_KEY,
      current === 'managed' ? 'managed' : 'byo'
    );
  }
  await setGoogleSsoModeState(db, 'off', tenantId);
  return { ok: true, resume: current === 'managed' ? 'managed' : 'byo' };
}

/** Remove the Google card. Leaves platform eligibility and shadow credentials. */
export async function removeGoogleSso(db, tenantId) {
  const current = await resolveGoogleSsoMode(db);
  if (current === 'managed' || current === 'byo') {
    await settingsQueries.upsertSetting(
      db,
      GOOGLE_SSO_RESUME_MODE_KEY,
      current === 'managed' ? 'managed' : 'byo'
    );
  }
  await settingsQueries.upsertSetting(db, GOOGLE_SSO_MODE_KEY, '');
  await settingsQueries.upsertSetting(db, 'GOOGLE_SSO_MANAGED', 'false');
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.clientId, '');
  await clearSecretSetting(db, ACTIVE_KEYS.clientSecret);
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.callbackUrl, '');
  invalidateOAuthConfigCache(tenantId);
  return { ok: true };
}

const SIMPLE_SSO_KEYS = {
  github: [
    'GITHUB_SSO_MODE',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_CALLBACK_URL',
  ],
  m365: [
    'M365_SSO_MODE',
    'M365_CLIENT_ID',
    'M365_CLIENT_SECRET',
    'M365_TENANT_ID',
    'M365_CALLBACK_URL',
  ],
};

export async function removeSimpleSso(db, tenantId, provider) {
  const keys = SIMPLE_SSO_KEYS[provider];
  if (!keys) return { ok: false };
  for (const key of keys) {
    if (key.endsWith('_SECRET')) {
      await clearSecretSetting(db, key);
    } else {
      await settingsQueries.upsertSetting(db, key, '');
    }
  }
  invalidateOAuthConfigCache(tenantId);
  return { ok: true, settings: Object.fromEntries(keys.map((key) => [key, ''])) };
}

export async function enableGoogleSso(db, tenantId) {
  const current = await resolveGoogleSsoMode(db);
  if (current === 'managed' || current === 'byo') {
    return { ok: true, mode: current };
  }
  const resume = await getSettingValue(db, GOOGLE_SSO_RESUME_MODE_KEY);
  if (resume === 'managed') {
    return restoreManagedGoogleSso(db, tenantId);
  }
  await setGoogleSsoModeState(db, 'byo', tenantId);
  return { ok: true, mode: 'byo' };
}

export async function restoreManagedGoogleSso(db, tenantId) {
  const eligible = await getSettingValue(db, GOOGLE_SSO_MANAGED_ELIGIBLE_KEY);
  if (eligible !== 'true') {
    return { ok: false, error: 'not_eligible' };
  }

  let applied = await applyPlatformGoogleShadowToActive(db);
  if (!applied.ok) {
    const fromAdmin = await fetchPlatformGoogleDefaultsFromAdmin();
    if (!fromAdmin) {
      return { ok: false, error: 'platform_unavailable' };
    }
    await writePlatformGoogleShadow(db, fromAdmin);
    applied = await applyPlatformGoogleShadowToActive(db);
    if (!applied.ok) {
      return { ok: false, error: 'platform_unavailable' };
    }
    applied.source = 'admin_service';
  }

  await setGoogleSsoModeState(db, 'managed', tenantId);
  return { ok: true, mode: 'managed', source: applied.source };
}

/** Keep shadow copy in sync when platform pushes managed credentials. */
export async function mirrorActiveGoogleSsoToPlatformShadow(db) {
  const [clientId, callbackUrl, clientSecret] = await Promise.all([
    getSettingValue(db, ACTIVE_KEYS.clientId),
    getSettingValue(db, ACTIVE_KEYS.callbackUrl),
    getDecryptedSetting(db, ACTIVE_KEYS.clientSecret),
  ]);
  if (!clientId || !clientSecret || !callbackUrl) return;
  await writePlatformGoogleShadow(db, { clientId, clientSecret, callbackUrl });
}

export async function markGoogleSsoManagedEligible(db) {
  await settingsQueries.upsertSetting(db, GOOGLE_SSO_MANAGED_ELIGIBLE_KEY, 'true');
}
