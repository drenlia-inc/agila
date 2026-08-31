import axios from 'axios';
import { settings as settingsQueries } from './sqlManager/index.js';
import {
  SMTP_MANAGED_ELIGIBLE_KEY,
  SMTP_MODE_KEY,
  SMTP_MODES,
  isDemoMailLocked,
} from '../constants/mailSettings.js';
import {
  clearSecretSetting,
  getDecryptedSetting,
  upsertSecretSetting,
} from './settingsSecrets.js';

const ACTIVE_KEYS = {
  host: 'SMTP_HOST',
  port: 'SMTP_PORT',
  username: 'SMTP_USERNAME',
  password: 'SMTP_PASSWORD',
  fromEmail: 'SMTP_FROM_EMAIL',
  fromName: 'SMTP_FROM_NAME',
  secure: 'SMTP_SECURE',
};

const SHADOW_KEYS = {
  host: 'PLATFORM_SMTP_HOST',
  port: 'PLATFORM_SMTP_PORT',
  username: 'PLATFORM_SMTP_USERNAME',
  password: 'PLATFORM_SMTP_PASSWORD',
  fromEmail: 'PLATFORM_SMTP_FROM_EMAIL',
  fromName: 'PLATFORM_SMTP_FROM_NAME',
  secure: 'PLATFORM_SMTP_SECURE',
};

async function getSettingValue(db, key) {
  const row = await settingsQueries.getSettingByKey(db, key);
  return String(row?.value ?? '').trim();
}

export function normalizeMailMode(raw, { managedFlag = '', host = '' } = {}) {
  const mode = String(raw || '')
    .trim()
    .toLowerCase();
  if (SMTP_MODES.includes(mode)) return mode;
  if (String(managedFlag).trim().toLowerCase() === 'true') return 'managed';
  if (String(host || '').trim()) return 'byo';
  return '';
}

export async function resolveMailMode(db) {
  const [modeRaw, managedFlag, host] = await Promise.all([
    getSettingValue(db, SMTP_MODE_KEY),
    getSettingValue(db, 'MAIL_MANAGED'),
    getSettingValue(db, ACTIVE_KEYS.host),
  ]);
  return normalizeMailMode(modeRaw, { managedFlag, host });
}

export async function readPlatformSmtpShadow(db) {
  const [host, port, username, fromEmail, fromName, secure, password] = await Promise.all([
    getSettingValue(db, SHADOW_KEYS.host),
    getSettingValue(db, SHADOW_KEYS.port),
    getSettingValue(db, SHADOW_KEYS.username),
    getSettingValue(db, SHADOW_KEYS.fromEmail),
    getSettingValue(db, SHADOW_KEYS.fromName),
    getSettingValue(db, SHADOW_KEYS.secure),
    getDecryptedSetting(db, SHADOW_KEYS.password),
  ]);
  return { host, port, username, password, fromEmail, fromName, secure };
}

export async function writePlatformSmtpShadow(db, creds) {
  const { host, port, username, password, fromEmail, fromName, secure } = creds;
  if (host) await settingsQueries.upsertSetting(db, SHADOW_KEYS.host, host);
  if (port) await settingsQueries.upsertSetting(db, SHADOW_KEYS.port, port);
  if (username) await settingsQueries.upsertSetting(db, SHADOW_KEYS.username, username);
  if (fromEmail) await settingsQueries.upsertSetting(db, SHADOW_KEYS.fromEmail, fromEmail);
  if (fromName) await settingsQueries.upsertSetting(db, SHADOW_KEYS.fromName, fromName);
  if (secure) await settingsQueries.upsertSetting(db, SHADOW_KEYS.secure, secure);
  if (password) await upsertSecretSetting(db, SHADOW_KEYS.password, password);
}

export async function applyPlatformSmtpShadowToActive(db) {
  const shadow = await readPlatformSmtpShadow(db);
  if (!shadow.host || !shadow.username || !shadow.password || !shadow.fromEmail) {
    return { ok: false, reason: 'shadow_incomplete' };
  }
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.host, shadow.host);
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.port, shadow.port || '587');
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.username, shadow.username);
  await upsertSecretSetting(db, ACTIVE_KEYS.password, shadow.password);
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.fromEmail, shadow.fromEmail);
  if (shadow.fromName) {
    await settingsQueries.upsertSetting(db, ACTIVE_KEYS.fromName, shadow.fromName);
  }
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.secure, shadow.secure || 'tls');
  return { ok: true, source: 'shadow' };
}

export async function fetchPlatformSmtpDefaultsFromAdmin() {
  const base = String(process.env.ADMIN_SERVICE_URL || '').trim().replace(/\/+$/, '');
  const token = String(process.env.INSTANCE_TOKEN || '').trim();
  if (!base || !token) return null;
  try {
    const res = await axios.get(`${base}/api/instance-callback/mail-defaults`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000,
    });
    const host = String(res.data?.host || '').trim();
    const username = String(res.data?.username || '').trim();
    const password = String(res.data?.password || '').trim();
    const fromEmail = String(res.data?.fromEmail || '').trim();
    if (!host || !username || !password || !fromEmail) return null;
    return {
      host,
      port: String(res.data?.port || '587').trim() || '587',
      username,
      password,
      fromEmail,
      fromName: String(res.data?.fromName || '').trim(),
      secure: String(res.data?.secure || 'tls').trim() || 'tls',
    };
  } catch (err) {
    console.error('Failed to fetch platform SMTP defaults:', err.message);
    return null;
  }
}

async function setMailModeState(db, mode) {
  await settingsQueries.upsertSetting(db, SMTP_MODE_KEY, mode);
  await settingsQueries.upsertSetting(db, 'MAIL_MANAGED', mode === 'managed' ? 'true' : 'false');
}

export async function switchToByoMail(db) {
  const current = await resolveMailMode(db);
  if (current === 'managed') {
    await mirrorActiveMailToPlatformShadow(db);
  }
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.host, '');
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.port, '');
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.username, '');
  await clearSecretSetting(db, ACTIVE_KEYS.password);
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.fromEmail, '');
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.fromName, '');
  await settingsQueries.upsertSetting(db, ACTIVE_KEYS.secure, '');
  await settingsQueries.upsertSetting(db, 'MAIL_ENABLED', 'false');
  await setMailModeState(db, 'byo');
  return { ok: true, mode: 'byo' };
}

export async function restoreManagedMail(db) {
  if (isDemoMailLocked()) {
    return { ok: false, error: 'not_eligible' };
  }
  const eligible = await getSettingValue(db, SMTP_MANAGED_ELIGIBLE_KEY);
  if (eligible !== 'true') {
    return { ok: false, error: 'not_eligible' };
  }

  let applied = await applyPlatformSmtpShadowToActive(db);
  if (!applied.ok) {
    const fromAdmin = await fetchPlatformSmtpDefaultsFromAdmin();
    if (!fromAdmin) {
      return { ok: false, error: 'platform_unavailable' };
    }
    await writePlatformSmtpShadow(db, fromAdmin);
    applied = await applyPlatformSmtpShadowToActive(db);
    if (!applied.ok) {
      return { ok: false, error: 'platform_unavailable' };
    }
    applied.source = 'admin_service';
  }

  await settingsQueries.upsertSetting(db, 'MAIL_ENABLED', 'true');
  await setMailModeState(db, 'managed');
  return { ok: true, mode: 'managed', source: applied.source };
}

export async function mirrorActiveMailToPlatformShadow(db) {
  const [host, port, username, fromEmail, fromName, secure, password] = await Promise.all([
    getSettingValue(db, ACTIVE_KEYS.host),
    getSettingValue(db, ACTIVE_KEYS.port),
    getSettingValue(db, ACTIVE_KEYS.username),
    getSettingValue(db, ACTIVE_KEYS.fromEmail),
    getSettingValue(db, ACTIVE_KEYS.fromName),
    getSettingValue(db, ACTIVE_KEYS.secure),
    getDecryptedSetting(db, ACTIVE_KEYS.password),
  ]);
  if (!host || !username || !password || !fromEmail) return;
  await writePlatformSmtpShadow(db, {
    host,
    port,
    username,
    password,
    fromEmail,
    fromName,
    secure,
  });
}

export async function markMailManagedEligible(db) {
  await settingsQueries.upsertSetting(db, SMTP_MANAGED_ELIGIBLE_KEY, 'true');
}

/** Client/WS patch after mode changes — never include live SMTP secrets. */
export function mailClientPatch(mode) {
  if (mode === 'managed') {
    return {
      SMTP_MODE: 'managed',
      MAIL_MANAGED: 'true',
      MAIL_ENABLED: 'true',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USERNAME: '',
      SMTP_PASSWORD: '',
      SMTP_PASSWORD_SET: 'false',
      SMTP_SECURE: '',
    };
  }
  if (mode === 'byo') {
    return {
      SMTP_MODE: 'byo',
      MAIL_MANAGED: 'false',
      MAIL_ENABLED: 'false',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USERNAME: '',
      SMTP_PASSWORD: '',
      SMTP_PASSWORD_SET: 'false',
      SMTP_FROM_EMAIL: '',
      SMTP_FROM_NAME: '',
      SMTP_SECURE: 'tls',
    };
  }
  return {};
}
