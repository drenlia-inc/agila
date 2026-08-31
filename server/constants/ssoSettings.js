/** OAuth credential keys hidden from tenant admins while mode is managed. */
export const SSO_MANAGED_HIDDEN_KEYS = Object.freeze([
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
]);

/** Platform shadow copy — never exposed on tenant admin GET. */
export const PLATFORM_GOOGLE_SSO_KEYS = Object.freeze([
  'PLATFORM_GOOGLE_CLIENT_ID',
  'PLATFORM_GOOGLE_CLIENT_SECRET',
  'PLATFORM_GOOGLE_CALLBACK_URL',
]);

/** Settings keys tenant admin API must never return. */
export const SSO_ADMIN_INTERNAL_KEYS = Object.freeze([
  ...PLATFORM_GOOGLE_SSO_KEYS,
]);

export const GOOGLE_SSO_MODE_KEY = 'GOOGLE_SSO_MODE';
export const GOOGLE_SSO_MANAGED_ELIGIBLE_KEY = 'GOOGLE_SSO_MANAGED_ELIGIBLE';
export const GOOGLE_SSO_RESUME_MODE_KEY = 'GOOGLE_SSO_RESUME_MODE';

export const GOOGLE_SSO_MODES = Object.freeze(['managed', 'byo', 'off']);

/** Written only after a successful OAuth callback — not admin-editable. */
export const SSO_LAST_SUCCESS_KEYS = Object.freeze({
  google: 'GOOGLE_SSO_LAST_SUCCESS_AT',
  github: 'GITHUB_SSO_LAST_SUCCESS_AT',
  m365: 'M365_SSO_LAST_SUCCESS_AT',
});

export function isSsoLastSuccessKey(key) {
  return Object.values(SSO_LAST_SUCCESS_KEYS).includes(String(key || ''));
}

export const PUBLIC_SSO_SETTING_KEYS = Object.freeze([
  'GOOGLE_CLIENT_ID',
  'GOOGLE_SSO_MANAGED',
  'GOOGLE_SSO_MODE',
  'GITHUB_CLIENT_ID',
  'GITHUB_SSO_MODE',
  'M365_CLIENT_ID',
  'M365_SSO_MODE',
]);

export function isDemoSsoDisabled() {
  return process.env.DEMO_ENABLED === 'true';
}

/** Public GET /api/settings — never expose secrets; demo never advertises SSO. */
export function applyPublicSsoSettings(settingsObj) {
  const next = settingsObj && typeof settingsObj === 'object' ? settingsObj : {};
  if (isDemoSsoDisabled()) {
    next.GOOGLE_SSO_MODE = 'off';
    next.GOOGLE_SSO_MANAGED = 'false';
    next.GOOGLE_CLIENT_ID = '';
    next.GITHUB_SSO_MODE = 'off';
    next.GITHUB_CLIENT_ID = '';
    next.M365_SSO_MODE = 'off';
    next.M365_CLIENT_ID = '';
  }
  return next;
}

/** Synthetic admin-API field (not stored) — hub callback shown in managed SSO UI. */
export const SSO_HUB_CALLBACK_DISPLAY_KEY = 'GOOGLE_SSO_HUB_CALLBACK_URL';
