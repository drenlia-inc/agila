import { ADMIN_TABS } from '../constants';

/** Dispatched when Configuration guide / search needs a reliable Admin tab switch. */
export const ADMIN_NAVIGATE_EVENT = 'easy-kanban:admin-navigate';

export type AdminNavigateDetail = {
  /** Hash without leading #, e.g. admin#system-settings#sso */
  hash: string;
};

/** Legacy top-level tab ids → canonical compound hashes after Admin reorg. */
export const ADMIN_LEGACY_TAB_HASH: Record<string, string> = {
  sso: 'admin#system-settings#sso',
  'mail-server': 'admin#notifications#mail-server',
  storage: 'admin#system-settings#storage',
  lifecycle: 'admin#project-settings#lifecycle',
  'notification-queue': 'admin#notifications#queue',
  queue: 'admin#notifications#queue',
  'notification-settings': 'admin#notifications#notification-settings',
  'sprint-settings': 'admin#project-settings#sprint-settings',
  reporting: 'admin#project-settings#reporting',
  ai: 'admin#system-settings#ai',
  'file-uploads': 'admin#system-settings#file-uploads',
  uploads: 'admin#system-settings#file-uploads',
  webhooks: 'admin#notifications#webhooks',
};

const NOTIFICATIONS_HASH_REWRITES: Record<string, string> = {
  'admin#system-settings#mail-server': 'admin#notifications#mail-server',
  'admin#system-settings#notifications': 'admin#notifications#notification-settings',
  'admin#system-settings#webhooks': 'admin#notifications#webhooks',
  'admin#system-settings#notification-queue': 'admin#notifications#queue',
  'admin#app-settings#notifications': 'admin#notifications#notification-settings',
  'admin#app-settings#notification-queue': 'admin#notifications#queue',
  'admin#notifications': 'admin#notifications#notification-settings',
  'admin#notifications#notifications': 'admin#notifications#notification-settings',
  'admin#notifications#notification-queue': 'admin#notifications#queue',
};

/** Map tour / owner-setup tab ids (and subtab data-tour-id suffixes) to hashes. */
export function adminHashForTabId(tabId: string): string {
  if (ADMIN_LEGACY_TAB_HASH[tabId]) return ADMIN_LEGACY_TAB_HASH[tabId];
  if (tabId === 'project-settings' || tabId === 'project-general') {
    return 'admin#project-settings#project';
  }
  if (tabId === 'system-settings') return 'admin#system-settings#sso';
  if (tabId === 'app-settings') return 'admin#app-settings#user-interface';
  if (tabId === 'notifications') return 'admin#notifications#notification-settings';
  return `admin#${tabId}`;
}

/**
 * Rewrite legacy Admin hashes to the current System / Notifications / Project structure.
 * Returns hash without leading #.
 */
export function canonicalizeAdminHash(hash: string): string {
  const full = hash.startsWith('#') ? hash : `#${hash}`;
  const bare = full.replace(/^#/, '');

  if (NOTIFICATIONS_HASH_REWRITES[bare]) {
    return NOTIFICATIONS_HASH_REWRITES[bare];
  }

  if (bare === 'admin#app-settings#file-uploads') {
    return 'admin#system-settings#file-uploads';
  }
  if (bare === 'admin#app-settings#ai') {
    return 'admin#system-settings#ai';
  }
  if (bare === 'admin#system-settings#lifecycle') {
    return 'admin#project-settings#lifecycle';
  }

  // Exact legacy top-level tabs
  const parts = bare.split('#');
  if (parts[0] === 'admin' && parts.length === 2 && ADMIN_LEGACY_TAB_HASH[parts[1]]) {
    return ADMIN_LEGACY_TAB_HASH[parts[1]];
  }

  if (bare === 'admin#project-settings') {
    return 'admin#project-settings#project';
  }
  if (bare === 'admin#system-settings') {
    return 'admin#system-settings#sso';
  }

  return bare;
}

/** Resolve main Admin nav tab id from a compound admin hash. */
export function adminTabFromHash(hash: string): string | null {
  const bare = canonicalizeAdminHash(hash);
  const full = `#${bare}`;

  if (full.startsWith('#admin#notifications')) return 'notifications';
  if (full.startsWith('#admin#system-settings')) return 'system-settings';
  if (full.startsWith('#admin#project-settings')) return 'project-settings';
  if (full.startsWith('#admin#app-settings')) return 'app-settings';
  if (full.startsWith('#admin#licensing')) return 'licensing';

  const parts = bare.split('#');
  const tab = parts.length >= 2 ? parts[1] : parts[0];

  // Legacy ids that still appear briefly before canonicalize runs
  if (tab && ADMIN_LEGACY_TAB_HASH[tab]) {
    return adminTabFromHash(ADMIN_LEGACY_TAB_HASH[tab]);
  }

  if (tab && ADMIN_TABS.includes(tab)) return tab;
  return null;
}

/**
 * Set the Admin deep-link hash and notify Admin to switch tabs immediately.
 * Avoids races where hashchange is missed or App Settings fights the URL.
 */
export function requestAdminNavigation(hash: string): void {
  const normalized = canonicalizeAdminHash(hash);
  const detail: AdminNavigateDetail = { hash: normalized };
  window.location.hash = normalized;
  window.dispatchEvent(new CustomEvent(ADMIN_NAVIGATE_EVENT, { detail }));
}
