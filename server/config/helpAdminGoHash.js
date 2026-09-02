/**
 * Deep-link hashes for Help “Go there”.
 * Keep aligned with src/utils/adminNavigation.ts (ADMIN_LEGACY_TAB_HASH / adminHashForTabId).
 */

const ADMIN_TOUR_HASH = {
  sso: '#admin#system-settings#sso',
  'mail-server': '#admin#notifications#mail-server',
  storage: '#admin#system-settings#storage',
  lifecycle: '#admin#project-settings#lifecycle',
  'lifecycle-content': '#admin#project-settings#lifecycle',
  'notification-queue': '#admin#notifications#queue',
  queue: '#admin#notifications#queue',
  'notification-settings': '#admin#notifications#notification-settings',
  notifications: '#admin#notifications#notification-settings',
  'sprint-settings': '#admin#project-settings#sprint-settings',
  reporting: '#admin#project-settings#reporting',
  ai: '#admin#system-settings#ai',
  'file-uploads': '#admin#system-settings#file-uploads',
  uploads: '#admin#system-settings#file-uploads',
  webhooks: '#admin#notifications#webhooks',
  'project-settings': '#admin#project-settings#project',
  'project-general': '#admin#project-settings#project',
  'system-settings': '#admin#system-settings#sso',
  'app-settings': '#admin#app-settings#user-interface',
  'features-panel': '#admin#project-settings#features',
  features: '#admin#project-settings#features',
  users: '#admin#users',
  'site-settings': '#admin#site-settings',
  tags: '#admin#tags',
  priorities: '#admin#priorities',
  licensing: '#admin#licensing'
};

const GENERIC_ADMIN_TOUR = new Set(['', 'tab', 'tabs']);

/** Hashes Admin actually mounts. Bare `#admin` only opens the Users tab. */
export const CANONICAL_ADMIN_HASHES = new Set([
  '#admin',
  '#admin#users',
  '#admin#site-settings',
  '#admin#tags',
  '#admin#priorities',
  '#admin#licensing',
  '#admin#system-settings#sso',
  '#admin#system-settings#storage',
  '#admin#system-settings#file-uploads',
  '#admin#system-settings#ai',
  '#admin#notifications#notification-settings',
  '#admin#notifications#mail-server',
  '#admin#notifications#webhooks',
  '#admin#notifications#queue',
  '#admin#app-settings#user-interface',
  '#admin#app-settings#troubleshooting',
  '#admin#project-settings#project',
  '#admin#project-settings#features',
  '#admin#project-settings#sprint-settings',
  '#admin#project-settings#reporting',
  '#admin#project-settings#lifecycle'
]);

const ALLOWED_SHALLOW_ADMIN_IDS = new Set(['tour:admin-tab', 'tour:admin-tabs']);

/** Map a data-tour-id like admin-sprint-settings to a Settings hash. */
export function hashFromAdminTourValue(value) {
  const raw = String(value || '');
  if (!raw.startsWith('admin-')) return null;
  const tabId = raw.slice('admin-'.length);
  if (GENERIC_ADMIN_TOUR.has(tabId)) return '#admin';
  if (ADMIN_TOUR_HASH[tabId]) return ADMIN_TOUR_HASH[tabId];
  return `#admin#${tabId}`;
}

/**
 * `#admin` only opens Settings on the Users tab. Nested tour / owner-setup
 * targets need the compound hash or the highlight never mounts.
 */
export function refineAdminGoHash(row, fallbackHash) {
  const current = row?.hash || fallbackHash || '#admin';
  if (current && current !== '#admin' && current !== 'admin') return current;
  const fromTour = hashFromAdminTourValue(row?.value);
  if (fromTour && fromTour !== '#admin') return fromTour;
  return current.startsWith('#') ? current : `#${current}`;
}

function normalizeHash(hash) {
  if (!hash) return '';
  return hash.startsWith('#') ? hash : `#${hash}`;
}

/** Fail the harvest/check if a Go There URL cannot open the highlighted panel. */
export function validateHelpGoEntries(entries, extraHashes = []) {
  const errors = [];
  for (const row of entries) {
    if (row.kind === 'admin') {
      const hash = normalizeHash(refineAdminGoHash(row, row.hash || '#admin'));
      if (!CANONICAL_ADMIN_HASHES.has(hash)) {
        errors.push(`${row.id} has unknown Settings hash ${hash} (${row.file})`);
      }
      if (hash === '#admin' && !ALLOWED_SHALLOW_ADMIN_IDS.has(row.id)) {
        errors.push(`${row.id} still uses #admin; nested Settings chrome will not mount (${row.file})`);
      }
      if (row.attr === 'setting' && !/^[A-Z][A-Z0-9_]*$/.test(row.value || '')) {
        errors.push(`${row.id} is not a real setting key`);
      }
    }
    if (row.attr === 'help' && /\/admin\//.test(row.file || '') && row.kind !== 'admin') {
      errors.push(`${row.id} is in Admin UI but Go There kind is ${row.kind} (${row.file})`);
    }
    if (row.id === 'tour:column-visibility' && row.mode !== 'list') {
      errors.push('tour:column-visibility must switch to list view');
    }
    if (row.id === 'help:calendar-column-filter' && row.mode !== 'calendar') {
      errors.push('help:calendar-column-filter must switch to calendar view');
    }
  }
  for (const raw of extraHashes) {
    const hash = normalizeHash(raw);
    if (!CANONICAL_ADMIN_HASHES.has(hash)) {
      errors.push(`HelpModal adminGo('${raw}') is not a canonical Settings hash`);
    }
  }
  return errors;
}
