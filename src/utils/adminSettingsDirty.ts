import { isMaskedApiKeyDisplay } from './maskSecret';

const SKIP_KEYS = new Set(['WEBSITE_URL', 'APP_URL']);
const SECRET_KEYS = new Set([
  'SMTP_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'AI_API_KEY',
  'AI_RUNNER_TOKEN',
  'S3_SECRET_ACCESS_KEY',
]);

/** Main Admin nav tab ids that can show an unsaved-changes dot. */
export type AdminSettingsTabId =
  | 'site-settings'
  | 'system-settings'
  | 'app-settings'
  | 'project-settings';

export type SystemSettingsSubTabId =
  | 'sso'
  | 'mail-server'
  | 'storage'
  | 'file-uploads'
  | 'ai'
  | 'notifications'
  | 'webhooks'
  | 'notification-queue';

export type ProjectHubSubTabId =
  | 'project'
  | 'features'
  | 'sprint-settings'
  | 'reporting'
  | 'lifecycle';

function isProjectGeneralKey(key: string): boolean {
  return (
    key === 'DEFAULT_PROJ_PREFIX' ||
    key === 'DEFAULT_TASK_PREFIX' ||
    key === 'DEFAULT_FINISHED_COLUMN_NAMES' ||
    key === 'DEFAULT_BOARD_COLUMNS'
  );
}

function isFeaturesKey(key: string): boolean {
  return (
    key === 'SHOW_BOARD_TAB_TASK_COUNTS' ||
    key === 'SHOW_BOARD_TAB_EFFORT' ||
    key === 'SHOW_COLUMN_TASK_COUNTS' ||
    key === 'SHOW_COLUMN_EFFORT' ||
    key === 'EFFORT_UNIT' ||
    key === 'HIGHLIGHT_OVERDUE_TASKS'
  );
}

function isSiteSettingsKey(key: string): boolean {
  return (
    key.startsWith('SITE_') ||
    key === 'HIDE_SITE_LOGO' ||
    key === 'HIDE_GITHUB_LINK' ||
    key === 'WEBSITE_URL'
  );
}

function isSsoKey(key: string): boolean {
  return key.startsWith('GOOGLE_');
}

function isMailKey(key: string): boolean {
  return key.startsWith('SMTP_') || key.startsWith('MAIL_');
}

function isStorageKey(key: string): boolean {
  return (
    key.startsWith('S3_') ||
    key === 'STORAGE_BACKEND' ||
    key === 'STORAGE_MANAGED' ||
    key === 'STORAGE_TEST_OK' ||
    key === 'STORAGE_MIGRATION_STATUS' ||
    key === 'STORAGE_MIGRATION_DETAIL'
  );
}

function isUploadKey(key: string): boolean {
  return key.startsWith('UPLOAD_');
}

function isAiKey(key: string): boolean {
  return key.startsWith('AI_');
}

function isLifecycleKey(key: string): boolean {
  return (
    key === 'LIFECYCLE_DELETED_RETENTION_DAYS' ||
    key === 'LIFECYCLE_ARCHIVED_RETENTION_DAYS'
  );
}

function isNotificationKey(key: string): boolean {
  return (
    key.startsWith('NOTIFICATION_') ||
    key === 'NOTIFICATION_DELAY' ||
    key === 'NOTIFICATION_DEFAULTS' ||
    key === 'TASK_NOTIFICATION_CHANNELS' ||
    key === 'TASK_EMAIL_NOTIFICATIONS_ENABLED'
  );
}

function isSystemSettingsKey(key: string): boolean {
  return (
    isSsoKey(key) ||
    isMailKey(key) ||
    isStorageKey(key) ||
    isUploadKey(key) ||
    isAiKey(key) ||
    isNotificationKey(key)
  );
}

function isProjectSettingsKey(key: string): boolean {
  return isProjectGeneralKey(key) || isFeaturesKey(key) || isLifecycleKey(key);
}

function isAppSettingsKey(key: string): boolean {
  if (
    isProjectSettingsKey(key) ||
    isSiteSettingsKey(key) ||
    isSystemSettingsKey(key)
  ) {
    return false;
  }
  return (
    key.startsWith('APP_') ||
    key.startsWith('DEFAULT_') ||
    key.startsWith('FE_DEBUG_') ||
    key.startsWith('SERVER_DEBUG_') ||
    key === 'SHOW_ACTIVITY_FEED' ||
    key === 'TASK_DELETE_CONFIRM' ||
    key === 'ALLOW_USER_SELF_DELETE'
  );
}

/** Map a settings key to its Admin tab (or null if not a draftable settings tab). */
export function adminTabForSettingKey(key: string): AdminSettingsTabId | null {
  if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) return null;
  if (isSiteSettingsKey(key)) return 'site-settings';
  if (isSystemSettingsKey(key)) return 'system-settings';
  if (isProjectSettingsKey(key)) return 'project-settings';
  if (isAppSettingsKey(key)) return 'app-settings';
  return null;
}

/** Coerce admin setting values to strings before trim/compare/save (WS may send booleans). */
export function settingValueAsString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  // Functions / symbols / toJSON→undefined must never yield undefined (breaks .trim())
  if (typeof value === 'function' || typeof value === 'symbol') return '';
  try {
    const json = JSON.stringify(value);
    return json == null ? '' : json;
  } catch {
    return '';
  }
}

/** True when a click/handler mistakenly passed a DOM/React event as the settings map. */
export function isLikelyDomEvent(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.preventDefault === 'function' ||
    typeof v.stopPropagation === 'function' ||
    typeof (v as { nativeEvent?: unknown }).nativeEvent === 'object'
  );
}

/** Admin setting keys are SCREAMING_SNAKE (reject SyntheticEvent props etc.). */
export function isValidAdminSettingKey(key: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(key);
}

function valuesDiffer(
  key: string,
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>
): boolean {
  let draftVal = settingValueAsString(draft[key]).trim();
  let savedVal = settingValueAsString(saved[key]).trim();

  if (SECRET_KEYS.has(key) && isMaskedApiKeyDisplay(draftVal)) {
    return false;
  }

  if (key === 'SMTP_SECURE') {
    if (!draftVal) draftVal = 'tls';
    if (!savedVal) savedVal = 'tls';
  }

  return draftVal !== savedVal;
}

/**
 * True when draft admin settings differ from saved values in a way that
 * handleSaveSettings would persist (aligned with Admin.tsx save rules).
 */
export function adminSettingsHaveChanges(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>
): boolean {
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);

  for (const key of keys) {
    if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) continue;
    if (valuesDiffer(key, saved, draft)) return true;
  }

  return false;
}

/** Which main Admin tabs have unsaved shared-settings edits. */
export function getDirtyAdminSettingsTabs(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>
): Set<AdminSettingsTabId> {
  const dirty = new Set<AdminSettingsTabId>();
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);

  for (const key of keys) {
    if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) continue;
    if (!valuesDiffer(key, saved, draft)) continue;
    const tab = adminTabForSettingKey(key);
    if (tab) dirty.add(tab);
  }

  return dirty;
}

/** App Settings sub-tab ids that can show a dirty dot. */
export type AppSettingsSubTabId = 'ui' | 'troubleshooting';

export function appSettingsSubTabForKey(key: string): AppSettingsSubTabId | null {
  if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) return null;
  if (!isAppSettingsKey(key)) return null;
  if (
    key.startsWith('FE_DEBUG_') ||
    key.startsWith('SERVER_DEBUG_')
  ) {
    return 'troubleshooting';
  }
  return 'ui';
}

/** Dirty App Settings subtabs from shared editingSettings. */
export function getDirtyAppSettingsSubTabs(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>
): Set<AppSettingsSubTabId> {
  const dirty = new Set<AppSettingsSubTabId>();
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);

  for (const key of keys) {
    if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) continue;
    if (!valuesDiffer(key, saved, draft)) continue;
    const sub = appSettingsSubTabForKey(key);
    if (sub) dirty.add(sub);
  }

  return dirty;
}

export function systemSettingsSubTabForKey(key: string): SystemSettingsSubTabId | null {
  if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) return null;
  if (isSsoKey(key)) return 'sso';
  if (isMailKey(key)) return 'mail-server';
  if (isStorageKey(key)) return 'storage';
  if (isUploadKey(key)) return 'file-uploads';
  if (isAiKey(key)) return 'ai';
  if (isNotificationKey(key)) return 'notifications';
  return null;
}

export function getDirtySystemSettingsSubTabs(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>,
  options?: { aiLocalDirty?: boolean; queueRetentionLocalDirty?: boolean }
): Set<SystemSettingsSubTabId> {
  const dirty = new Set<SystemSettingsSubTabId>();
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);

  for (const key of keys) {
    if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) continue;
    if (!valuesDiffer(key, saved, draft)) continue;
    const sub = systemSettingsSubTabForKey(key);
    if (sub) dirty.add(sub);
  }

  if (options?.aiLocalDirty) dirty.add('ai');
  if (options?.queueRetentionLocalDirty) dirty.add('notification-queue');
  return dirty;
}

export function getDirtyProjectHubSubTabs(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>,
  options?: { reportingLocalDirty?: boolean; lifecycleLocalDirty?: boolean }
): Set<ProjectHubSubTabId> {
  const dirty = new Set<ProjectHubSubTabId>();
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);

  for (const key of keys) {
    if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) continue;
    if (!valuesDiffer(key, saved, draft)) continue;
    if (isProjectGeneralKey(key)) dirty.add('project');
    if (isFeaturesKey(key)) dirty.add('features');
    if (isLifecycleKey(key)) dirty.add('lifecycle');
  }

  if (options?.reportingLocalDirty) dirty.add('reporting');
  if (options?.lifecycleLocalDirty) dirty.add('lifecycle');
  return dirty;
}

/** True when a single settings key’s draft differs from saved (for field chrome). */
export function isAdminSettingFieldDirty(
  key: string,
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>
): boolean {
  if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) return false;
  return valuesDiffer(key, saved, draft);
}

export function revertAdminSettingsWhere(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>,
  predicate: (key: string) => boolean
): Record<string, string | undefined> {
  const next = { ...draft };
  const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
  for (const key of keys) {
    if (SKIP_KEYS.has(key) || key.endsWith('_SET') || !isValidAdminSettingKey(key)) continue;
    if (!predicate(key)) continue;
    next[key] = saved[key] ?? '';
  }
  return next;
}

function systemSubTabKeyPredicate(sub: SystemSettingsSubTabId): (key: string) => boolean {
  if (sub === 'sso') return isSsoKey;
  if (sub === 'mail-server') return isMailKey;
  if (sub === 'storage') return isStorageKey;
  if (sub === 'file-uploads') return isUploadKey;
  if (sub === 'ai') return isAiKey;
  if (sub === 'notifications' || sub === 'webhooks') return isNotificationKey;
  if (sub === 'notification-queue') {
    return (key) => key === 'NOTIFICATION_QUEUE_RETENTION_DAYS';
  }
  return () => false;
}

function projectSubTabKeyPredicate(sub: ProjectHubSubTabId): (key: string) => boolean {
  if (sub === 'project') return isProjectGeneralKey;
  if (sub === 'features') return isFeaturesKey;
  if (sub === 'lifecycle') return isLifecycleKey;
  return () => false;
}

/** Revert only the Admin panel currently on screen (main tab / subtab). */
export function revertAdminSettingsForHash(
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>,
  hash: string
): Record<string, string | undefined> {
  const bare = hash.replace(/^#/, '');
  if (bare.startsWith('admin#site-settings')) {
    return revertAdminSettingsWhere(saved, draft, isSiteSettingsKey);
  }
  if (bare.startsWith('admin#system-settings')) {
    const sub = systemSettingsSubTabFromBare(bare);
    return revertAdminSettingsWhere(saved, draft, systemSubTabKeyPredicate(sub));
  }
  if (bare.startsWith('admin#app-settings')) {
    const sub: AppSettingsSubTabId = bare.endsWith('#troubleshooting') ? 'troubleshooting' : 'ui';
    return revertAdminSettingsWhere(
      saved,
      draft,
      (key) => appSettingsSubTabForKey(key) === sub
    );
  }
  if (bare.startsWith('admin#project-settings')) {
    const sub = projectHubSubTabFromBare(bare);
    return revertAdminSettingsWhere(saved, draft, projectSubTabKeyPredicate(sub));
  }
  return draft;
}

export function adminHashUsesLocalDiscard(hash: string): boolean {
  const bare = hash.replace(/^#/, '');
  return (
    bare.endsWith('#ai') ||
    bare.endsWith('#file-uploads') ||
    bare.endsWith('#notifications') ||
    bare.endsWith('#notification-queue') ||
    bare.endsWith('#reporting') ||
    bare.endsWith('#lifecycle')
  );
}

function systemSettingsSubTabFromBare(bare: string): SystemSettingsSubTabId {
  if (bare.endsWith('#mail-server')) return 'mail-server';
  if (bare.endsWith('#storage')) return 'storage';
  if (bare.endsWith('#file-uploads')) return 'file-uploads';
  if (bare.endsWith('#ai')) return 'ai';
  if (bare.endsWith('#notifications')) return 'notifications';
  if (bare.endsWith('#webhooks')) return 'webhooks';
  if (bare.endsWith('#notification-queue')) return 'notification-queue';
  return 'sso';
}

function projectHubSubTabFromBare(bare: string): ProjectHubSubTabId {
  if (bare.endsWith('#features')) return 'features';
  if (bare.endsWith('#sprint-settings')) return 'sprint-settings';
  if (bare.endsWith('#reporting')) return 'reporting';
  if (bare.endsWith('#lifecycle')) return 'lifecycle';
  return 'project';
}
export function revertAdminSettingField(
  key: string,
  saved: Record<string, string | undefined>,
  draft: Record<string, string | undefined>
): Record<string, string | undefined> {
  return {
    ...draft,
    [key]: saved[key] ?? '',
  };
}

/** Short display of the previous saved value for “Was: …”. */
export function formatSavedSettingDisplay(value: string | undefined, maxLen = 48): string {
  const v = settingValueAsString(value).trim();
  if (!v) return '—';
  if (v.length <= maxLen) return v;
  return `${v.slice(0, maxLen - 1)}…`;
}
