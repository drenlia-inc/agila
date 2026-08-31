type AdminSettingsMap = Record<string, string | undefined>;

export type GoogleSsoMode = 'managed' | 'byo' | 'off';

export const SSO_MANAGED_HIDDEN_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
] as const;

export function resolveGoogleSsoModeFromSettings(
  settings: AdminSettingsMap
): GoogleSsoMode {
  const mode = String(settings.GOOGLE_SSO_MODE || '').trim().toLowerCase();
  if (mode === 'managed' || mode === 'byo' || mode === 'off') {
    return mode;
  }
  if (String(settings.GOOGLE_SSO_MANAGED || '').trim() === 'true') {
    return 'managed';
  }
  if (String(settings.GOOGLE_CLIENT_ID || '').trim()) {
    return 'byo';
  }
  return 'off';
}

export function isDemoSsoLocked(settings?: AdminSettingsMap): boolean {
  if (String(settings?.DEPLOY_DEMO_ENABLED || '').trim() === 'true') return true;
  try {
    return (
      (import.meta as { env?: { DEMO_ENABLED?: string } }).env?.DEMO_ENABLED === 'true' ||
      (typeof process !== 'undefined' && process.env?.DEMO_ENABLED === 'true')
    );
  } catch {
    return false;
  }
}

export function isGoogleSsoManagedEligible(settings: AdminSettingsMap): boolean {
  if (isDemoSsoLocked(settings)) return false;
  return String(settings.GOOGLE_SSO_MANAGED_ELIGIBLE || '').trim() === 'true';
}

export function googleSsoResumeMode(settings: AdminSettingsMap): 'managed' | 'byo' {
  const resume = String(settings.GOOGLE_SSO_RESUME_MODE || '').trim().toLowerCase();
  if (resume === 'managed' || resume === 'byo') return resume;
  return 'byo';
}

/** True when this instance has a Google SSO card (including disabled). Bare `off` with no creds is not a card. */
export function isGoogleSsoConfigured(settings: AdminSettingsMap): boolean {
  const raw = String(settings.GOOGLE_SSO_MODE || '').trim().toLowerCase();
  if (raw === 'managed' || raw === 'byo') return true;
  if (raw === 'off') {
    const resume = String(settings.GOOGLE_SSO_RESUME_MODE || '').trim().toLowerCase();
    if (resume === 'managed' || resume === 'byo') return true;
    return Boolean(String(settings.GOOGLE_CLIENT_ID || '').trim());
  }
  return Boolean(String(settings.GOOGLE_CLIENT_ID || '').trim());
}

export function isSimpleSsoConfigured(
  settings: AdminSettingsMap,
  modeKey: string,
  clientIdKey: string
): boolean {
  const raw = String(settings[modeKey] || '').trim().toLowerCase();
  if (raw === 'byo') return true;
  if (raw === 'off') {
    return Boolean(String(settings[clientIdKey] || '').trim());
  }
  return Boolean(String(settings[clientIdKey] || '').trim());
}

export function isGoogleSsoLoginEnabled(settings: AdminSettingsMap): boolean {
  if (isDemoSsoLocked(settings)) return false;
  const mode = resolveGoogleSsoModeFromSettings(settings);
  return mode === 'managed' || mode === 'byo';
}

export function isSimpleSsoLoginEnabled(
  settings: AdminSettingsMap,
  modeKey: string,
  clientIdKey: string
): boolean {
  if (isDemoSsoLocked(settings)) return false;
  return resolveSimpleSsoMode(settings, modeKey, clientIdKey) === 'byo';
}

export function loginSsoProviders(settings: AdminSettingsMap): {
  google: boolean;
  github: boolean;
  m365: boolean;
} {
  return {
    google: isGoogleSsoLoginEnabled(settings),
    github: isSimpleSsoLoginEnabled(settings, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID'),
    m365: isSimpleSsoLoginEnabled(settings, 'M365_SSO_MODE', 'M365_CLIENT_ID'),
  };
}

/** Strip platform OAuth credentials from WS/bulk patches while SSO stays managed. */
export function redactManagedSsoPatch(
  saved: AdminSettingsMap,
  patch: Record<string, string>
): Record<string, string> {
  if (resolveGoogleSsoModeFromSettings(saved) !== 'managed') {
    return patch;
  }
  const next = { ...patch };
  for (const key of SSO_MANAGED_HIDDEN_KEYS) {
    if (!(key in next)) continue;
    next[key] = '';
    if (key === 'GOOGLE_CLIENT_SECRET') {
      next.GOOGLE_CLIENT_SECRET_SET = 'false';
    }
  }
  return next;
}

/** Tenant BYO callback: current site origin + Google OAuth path. */
export function tenantGoogleCallbackUrl(): string {
  if (typeof window === 'undefined') {
    return '/api/auth/google/callback';
  }
  return `${window.location.origin}/api/auth/google/callback`;
}

/** Draft when leaving managed SSO — never carry platform credentials into the form. */
export function buildByoOAuthDraftFromManaged(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    GOOGLE_SSO_MODE: 'byo',
    GOOGLE_SSO_MANAGED: 'false',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_CLIENT_SECRET_SET: 'false',
    GOOGLE_CALLBACK_URL: tenantGoogleCallbackUrl(),
  };
}

/** Draft when re-enabling BYO from the off state. */
export function buildByoOAuthDraftFromOff(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    GOOGLE_SSO_MODE: 'byo',
    GOOGLE_SSO_MANAGED: 'false',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_CLIENT_SECRET_SET: 'false',
    GOOGLE_CALLBACK_URL: tenantGoogleCallbackUrl(),
  };
}

function isTruthySetting(value: string | undefined): boolean {
  return String(value || '').trim() === 'true';
}

/** Validate BYO OAuth before save when Google SSO settings changed. */
export function validateByoOAuthSave(
  saved: AdminSettingsMap,
  draft: AdminSettingsMap,
  oauthKeysChanged: boolean
): 'ok' | 'missing_credentials' {
  if (!oauthKeysChanged) return 'ok';

  const draftMode = resolveGoogleSsoModeFromSettings(draft);
  if (draftMode === 'managed' || draftMode === 'off') return 'ok';

  const clientId = String(draft.GOOGLE_CLIENT_ID || '').trim();
  const callbackUrl = String(draft.GOOGLE_CALLBACK_URL || '').trim();
  if (!clientId || !callbackUrl) return 'missing_credentials';

  const secretDraft = String(draft.GOOGLE_CLIENT_SECRET || '').trim();
  const secretSet =
    isTruthySetting(draft.GOOGLE_CLIENT_SECRET_SET) ||
    isTruthySetting(saved.GOOGLE_CLIENT_SECRET_SET);

  const savedMode = resolveGoogleSsoModeFromSettings(saved);
  if (savedMode === 'managed' || savedMode === 'off') {
    if (!secretDraft) return 'missing_credentials';
    return 'ok';
  }

  if (!secretSet && !secretDraft) return 'missing_credentials';
  return 'ok';
}

/** Persist mode flag before other OAuth keys (server blocks cred edits while managed). */
export function sortAdminSettingsSaveEntries(
  entries: [string, string | undefined][]
): [string, string | undefined][] {
  return [...entries].sort(([keyA], [keyB]) => {
    const rank = (key: string) => {
      if (key === 'GOOGLE_SSO_MODE') return 0;
      if (key === 'GOOGLE_SSO_MANAGED') return 1;
      return 2;
    };
    return rank(keyA) - rank(keyB);
  });
}

export const SSO_LAST_SUCCESS_KEYS = {
  google: 'GOOGLE_SSO_LAST_SUCCESS_AT',
  github: 'GITHUB_SSO_LAST_SUCCESS_AT',
  m365: 'M365_SSO_LAST_SUCCESS_AT',
} as const;

export function formatSsoLastUsed(
  iso: string | undefined,
  locale: string
): string | null {
  const raw = String(iso || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export const GOOGLE_SSO_SAVE_KEYS = [
  'GOOGLE_SSO_MODE',
  'GOOGLE_SSO_MANAGED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
] as const;

export const GITHUB_SSO_SAVE_KEYS = [
  'GITHUB_SSO_MODE',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_CALLBACK_URL',
] as const;

export const M365_SSO_SAVE_KEYS = [
  'M365_SSO_MODE',
  'M365_CLIENT_ID',
  'M365_CLIENT_SECRET',
  'M365_TENANT_ID',
  'M365_CALLBACK_URL',
] as const;

export type SsoProviderId = 'google' | 'github' | 'm365';

export function pickSettingsKeys(
  settings: AdminSettingsMap,
  keys: readonly string[]
): AdminSettingsMap {
  const next: AdminSettingsMap = {};
  for (const key of keys) {
    next[key] = settings[key];
  }
  return next;
}

function keysDirty(
  saved: AdminSettingsMap,
  draft: AdminSettingsMap,
  keys: readonly string[]
): boolean {
  return keys.some((key) => {
    const draftVal = String(draft[key] ?? '').trim();
    const savedVal = String(saved[key] ?? '').trim();
    return draftVal !== savedVal;
  });
}

export function oauthSettingKeysDirty(
  saved: AdminSettingsMap,
  draft: AdminSettingsMap
): boolean {
  return keysDirty(saved, draft, GOOGLE_SSO_SAVE_KEYS);
}

export function githubSsoKeysDirty(
  saved: AdminSettingsMap,
  draft: AdminSettingsMap
): boolean {
  return keysDirty(saved, draft, GITHUB_SSO_SAVE_KEYS);
}

export function m365SsoKeysDirty(
  saved: AdminSettingsMap,
  draft: AdminSettingsMap
): boolean {
  return keysDirty(saved, draft, M365_SSO_SAVE_KEYS);
}

export function resolveSimpleSsoMode(
  settings: AdminSettingsMap,
  modeKey: string,
  clientIdKey: string
): 'byo' | 'off' | '' {
  const mode = String(settings[modeKey] || '').trim().toLowerCase();
  if (mode === 'byo' || mode === 'off') return mode;
  if (String(settings[clientIdKey] || '').trim()) return 'byo';
  return '';
}

export function tenantOAuthCallbackUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export function tenantGithubCallbackUrl(): string {
  return tenantOAuthCallbackUrl('/api/auth/github/callback');
}

export function tenantM365CallbackUrl(): string {
  return tenantOAuthCallbackUrl('/api/auth/microsoft/callback');
}

export function buildGithubByoDraft(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    GITHUB_SSO_MODE: 'byo',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    GITHUB_CLIENT_SECRET_SET: 'false',
    GITHUB_CALLBACK_URL: tenantGithubCallbackUrl(),
  };
}

export function buildM365ByoDraft(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    M365_SSO_MODE: 'byo',
    M365_CLIENT_ID: '',
    M365_CLIENT_SECRET: '',
    M365_CLIENT_SECRET_SET: 'false',
    M365_TENANT_ID: '',
    M365_CALLBACK_URL: tenantM365CallbackUrl(),
  };
}

/** Drop the Google card (not disable). Platform eligibility and shadow creds stay. */
export function buildGoogleSsoRemoveDraft(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    GOOGLE_SSO_MODE: '',
    GOOGLE_SSO_MANAGED: 'false',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_CLIENT_SECRET_SET: 'false',
    GOOGLE_CALLBACK_URL: '',
  };
}

export function buildGithubSsoRemoveDraft(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    GITHUB_SSO_MODE: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    GITHUB_CLIENT_SECRET_SET: 'false',
    GITHUB_CALLBACK_URL: '',
  };
}

export function buildM365SsoRemoveDraft(draft: AdminSettingsMap): AdminSettingsMap {
  return {
    ...draft,
    M365_SSO_MODE: '',
    M365_CLIENT_ID: '',
    M365_CLIENT_SECRET: '',
    M365_CLIENT_SECRET_SET: 'false',
    M365_TENANT_ID: '',
    M365_CALLBACK_URL: '',
  };
}

export function revertSettingsKeys(
  keys: readonly string[],
  saved: AdminSettingsMap,
  draft: AdminSettingsMap
): AdminSettingsMap {
  const next = { ...draft };
  for (const key of keys) {
    if (saved[key] === undefined) {
      delete next[key];
    } else {
      next[key] = saved[key];
    }
  }
  return next;
}

export function validateSimpleByoSave(
  saved: AdminSettingsMap,
  draft: AdminSettingsMap,
  options: {
    modeKey: string;
    clientIdKey: string;
    secretKey: string;
    callbackKey: string;
    dirty: boolean;
  }
): 'ok' | 'missing_credentials' {
  if (!options.dirty) return 'ok';
  const mode = resolveSimpleSsoMode(draft, options.modeKey, options.clientIdKey);
  if (mode === 'off') return 'ok';
  const clientId = String(draft[options.clientIdKey] ?? saved[options.clientIdKey] ?? '').trim();
  const callbackUrl = String(draft[options.callbackKey] ?? saved[options.callbackKey] ?? '').trim();
  if (!clientId || !callbackUrl) return 'missing_credentials';
  const secretDraft = String(draft[options.secretKey] || '').trim();
  const secretSet =
    isTruthySetting(draft[`${options.secretKey}_SET`]) ||
    isTruthySetting(saved[`${options.secretKey}_SET`]);
  if (!secretSet && !secretDraft) return 'missing_credentials';
  return 'ok';
}
