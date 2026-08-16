import i18n from 'i18next';
import {
  ADMIN_SEARCH_INDEX,
  type AdminSearchEntry,
} from '../constants/adminSearchIndex';

export function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function labelIn(lang: 'en' | 'fr', labelKey: string): string {
  try {
    const t = i18n.getFixedT(lang, 'admin');
    const v = t(labelKey);
    // Missing keys often return the key itself
    if (!v || v === labelKey) return '';
    return String(v);
  } catch {
    return '';
  }
}

/** Haystack used for matching (EN + FR labels + aliases). */
export function buildSearchHaystack(entry: AdminSearchEntry): string {
  const extra = (entry.extraLabelKeys || []).flatMap((key) => [
    labelIn('en', key),
    labelIn('fr', key),
  ]);
  const parts = [
    labelIn('en', entry.labelKey),
    labelIn('fr', entry.labelKey),
    ...extra,
    ...(entry.aliases || []),
    entry.settingKey || '',
    entry.tab,
  ];
  return normalizeSearchText(parts.filter(Boolean).join(' '));
}

export type AdminSearchHit = AdminSearchEntry & {
  score: number;
  displayLabel: string;
  /** Optional secondary line (e.g. matched setting value, user email). */
  detail?: string;
};

export type AdminContentKind = 'user' | 'tag' | 'priority' | 'settingValue';

export type AdminContentHit = {
  id: string;
  kind: AdminContentKind;
  tab: string;
  hash: string;
  displayLabel: string;
  detail?: string;
  /** Scroll target entity id (user / tag / priority). */
  entityId?: string;
  settingKey?: string;
  score: number;
};

export type AdminUnifiedSearchHit = AdminSearchHit | AdminContentHit;

export type AdminSearchContentSources = {
  users?: Array<{
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
  }>;
  tags?: Array<{
    id: string;
    tag?: string;
    description?: string;
  }>;
  priorities?: Array<{
    id: string;
    priority?: string;
  }>;
  /** Current admin settings map (values searched for non-secret indexed keys). */
  settings?: Record<string, string | undefined | null>;
};

const SECRET_SETTING_KEY_RE =
  /(PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i;

function scoreHaystack(hay: string, q: string): number {
  if (!hay || !q) return 0;
  if (hay === q) return 100;
  if (hay.startsWith(q)) return 80;
  if (hay.includes(` ${q}`) || hay.includes(q)) return 50;
  return 0;
}

/**
 * Match query against EN+FR labels/aliases. Higher score = better.
 */
export function searchAdminIndex(
  query: string,
  displayT: (key: string) => string,
  limit = 12
): AdminSearchHit[] {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const hits: AdminSearchHit[] = [];

  for (const entry of ADMIN_SEARCH_INDEX) {
    const hay = buildSearchHaystack(entry);
    if (!hay) continue;

    let score = scoreHaystack(hay, q);
    if (!score) continue;

    // Prefer settings slightly when query looks like a field token
    if (entry.kind === 'setting' && entry.settingKey) {
      const keyNorm = normalizeSearchText(entry.settingKey.replace(/_/g, ' '));
      if (keyNorm.includes(q) || normalizeSearchText(entry.settingKey).includes(q)) {
        score += 10;
      }
    }

    hits.push({
      ...entry,
      score,
      displayLabel: displayT(entry.labelKey),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.displayLabel.localeCompare(b.displayLabel));
  return hits.slice(0, limit);
}

/**
 * Match query against live Admin content (users, tags, priorities, setting values).
 */
export function searchAdminContent(
  query: string,
  sources: AdminSearchContentSources,
  displayT: (key: string) => string,
  limit = 12
): AdminContentHit[] {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const hits: AdminContentHit[] = [];

  for (const user of sources.users || []) {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const displayName = (user.displayName || fullName || user.email || '').trim();
    const hay = normalizeSearchText(
      [displayName, fullName, user.email, user.firstName, user.lastName].filter(Boolean).join(' ')
    );
    const score = scoreHaystack(hay, q);
    if (!score) continue;
    hits.push({
      id: `user-${user.id}`,
      kind: 'user',
      tab: 'users',
      hash: '#admin#users',
      displayLabel: displayName || user.email || user.id,
      detail: user.email && user.email !== displayName ? user.email : undefined,
      entityId: user.id,
      score: score + 5,
    });
  }

  for (const tag of sources.tags || []) {
    const name = String(tag.tag || '').trim();
    const hay = normalizeSearchText([name, tag.description].filter(Boolean).join(' '));
    const score = scoreHaystack(hay, q);
    if (!score) continue;
    hits.push({
      id: `tag-${tag.id}`,
      kind: 'tag',
      tab: 'tags',
      hash: '#admin#tags',
      displayLabel: name || tag.id,
      detail: tag.description || undefined,
      entityId: tag.id,
      score: score + 5,
    });
  }

  for (const priority of sources.priorities || []) {
    const name = String(priority.priority || '').trim();
    const hay = normalizeSearchText(name);
    const score = scoreHaystack(hay, q);
    if (!score) continue;
    hits.push({
      id: `priority-${priority.id}`,
      kind: 'priority',
      tab: 'priorities',
      hash: '#admin#priorities',
      displayLabel: name || priority.id,
      entityId: priority.id,
      score: score + 5,
    });
  }

  const settings = sources.settings || {};
  for (const entry of ADMIN_SEARCH_INDEX) {
    if (entry.kind !== 'setting' || !entry.settingKey) continue;
    if (SECRET_SETTING_KEY_RE.test(entry.settingKey)) continue;
    const raw = settings[entry.settingKey];
    if (raw == null || String(raw).trim() === '') continue;
    const value = String(raw).trim();
    const hay = normalizeSearchText(value);
    const score = scoreHaystack(hay, q);
    if (!score) continue;
    // Avoid duplicating pure key/label matches already covered by index search
    const labelHay = buildSearchHaystack(entry);
    if (scoreHaystack(labelHay, q) >= score) continue;
    hits.push({
      id: `setting-value-${entry.settingKey}`,
      kind: 'settingValue',
      tab: entry.tab,
      hash: entry.hash,
      displayLabel: displayT(entry.labelKey),
      detail: value.length > 64 ? `${value.slice(0, 61)}…` : value,
      settingKey: entry.settingKey,
      score,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.displayLabel.localeCompare(b.displayLabel));
  return hits.slice(0, limit);
}

/** Combined catalog + content search. */
export function searchAdminAll(
  query: string,
  displayT: (key: string) => string,
  sources: AdminSearchContentSources,
  limit = 12
): AdminUnifiedSearchHit[] {
  const catalog = searchAdminIndex(query, displayT, limit);
  const content = searchAdminContent(query, sources, displayT, limit);
  return [...catalog, ...content]
    .sort((a, b) => b.score - a.score || a.displayLabel.localeCompare(b.displayLabel))
    .slice(0, limit);
}

const HIGHLIGHT_CLASS = 'admin-setting-search-highlight';
const HIGHLIGHT_MS = 2000;

function highlightAndScroll(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}

function querySafeAttr(value: string): string {
  return String(value).replace(/\\/g, '').replace(/"/g, '');
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.closest('.hidden')) return false;
  return el.getClientRects().length > 0;
}

/** Scroll to [data-setting-key] after the target tab has mounted. */
export function scrollToAdminSetting(settingKey: string, attempts = 12): void {
  const tryScroll = (left: number) => {
    const safeKey = querySafeAttr(settingKey);
    const nodes = document.querySelectorAll(
      `[data-setting-key="${safeKey}"]`
    ) as NodeListOf<HTMLElement>;
    const el =
      Array.from(nodes).find((n) => isElementVisible(n)) || nodes[0] || null;
    if (el) {
      highlightAndScroll(el);
      return;
    }
    if (left > 0) {
      window.setTimeout(() => tryScroll(left - 1), 50);
    }
  };
  requestAnimationFrame(() => tryScroll(attempts));
}

/** Scroll to a content row: data-user-id / data-tag-id / data-priority-id. */
export function scrollToAdminEntity(
  attr: 'data-user-id' | 'data-tag-id' | 'data-priority-id',
  id: string,
  attempts = 16
): void {
  const tryScroll = (left: number) => {
    const safeId = querySafeAttr(id);
    const el = document.querySelector(`[${attr}="${safeId}"]`) as HTMLElement | null;
    if (el) {
      highlightAndScroll(el);
      return;
    }
    if (left > 0) {
      window.setTimeout(() => tryScroll(left - 1), 50);
    }
  };
  requestAnimationFrame(() => tryScroll(attempts));
}
