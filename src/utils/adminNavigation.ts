import { ADMIN_TABS } from '../constants';

/** Dispatched when Configuration guide / search needs a reliable Admin tab switch. */
export const ADMIN_NAVIGATE_EVENT = 'easy-kanban:admin-navigate';

export type AdminNavigateDetail = {
  /** Hash without leading #, e.g. admin#system-settings#mail-server */
  hash: string;
};

/** Legacy top-level tab ids → canonical compound hashes after Admin reorg. */
export const ADMIN_LEGACY_TAB_HASH: Record<string, string> = {
  sso: 'admin#system-settings#sso',
  'mail-server': 'admin#system-settings#mail-server',
  storage: 'admin#system-settings#storage',
  lifecycle: 'admin#project-settings#lifecycle',
  'notification-queue': 'admin#system-settings#notification-queue',
  'sprint-settings': 'admin#project-settings#sprint-settings',
  reporting: 'admin#project-settings#reporting',
  ai: 'admin#system-settings#ai',
  'file-uploads': 'admin#system-settings#file-uploads',
  uploads: 'admin#system-settings#file-uploads',
};

/** Map tour / owner-setup tab ids (and subtab data-tour-id suffixes) to hashes. */
export function adminHashForTabId(tabId: string): string {
  if (ADMIN_LEGACY_TAB_HASH[tabId]) return ADMIN_LEGACY_TAB_HASH[tabId];
  if (tabId === 'project-settings' || tabId === 'project-general') {
    return 'admin#project-settings#project';
  }
  if (tabId === 'system-settings') return 'admin#system-settings#sso';
  if (tabId === 'app-settings') return 'admin#app-settings#user-interface';
  if (tabId === 'notifications') return 'admin#system-settings#notifications';
  if (tabId === 'webhooks') return 'admin#system-settings#webhooks';
  return `admin#${tabId}`;
}

/**
 * Rewrite legacy Admin hashes to the new System / Project Settings structure.
 * Returns hash without leading #.
 */
export function canonicalizeAdminHash(hash: string): string {
  const full = hash.startsWith('#') ? hash : `#${hash}`;
  const bare = full.replace(/^#/, '');

  if (bare === 'admin#app-settings#notifications') {
    return 'admin#system-settings#notifications';
  }
  if (bare === 'admin#app-settings#notification-queue') {
    return 'admin#system-settings#notification-queue';
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

  // Bare #admin#project-settings → project subtab
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
