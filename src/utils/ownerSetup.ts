import { getUserSettings, updateUserSetting } from '../api';
import type { Board, SiteSettings } from '../types';

export const OWNER_SETUP_STEP_IDS = [
  'welcome',
  'siteIdentity',
  'language',
  'mail',
  'users',
  'boards',
  'tagsPriorities',
  'sprints',
  'sso',
  'storage',
  'licensing',
  'reporting',
  'finish',
] as const;

export type OwnerSetupStepId = (typeof OWNER_SETUP_STEP_IDS)[number];

export type OwnerSetupManualStatus = 'todo' | 'done' | 'skipped';

/** Intro/outro are bookends — not counted in setup progress. */
export type OwnerSetupStepKind = 'task' | 'intro' | 'outro';

/** When to include a Guide me field (default: always). */
export type OwnerSetupGuideWhen =
  | 'always'
  | 'multiTenant'
  | 'singleTenant'
  /** MULTI_TENANT and still on platform-managed mail (Switch to Custom SMTP). */
  | 'multiTenantManagedMail'
  /** MULTI_TENANT and still on platform-managed S3 (Switch to Custom S3). */
  | 'multiTenantManagedStorage';

export interface OwnerSetupGuideField {
  /** CSS selector for the control to highlight during Guide me (omit for text-only tips) */
  selector?: string;
  /** i18n key under ownerSetup.steps.<stepId>.fields.<fieldKey> */
  fieldKey: string;
  /** Optional group header: ownerSetup.steps.<stepId>.sections.<sectionKey> */
  sectionKey?: string;
  /** Optional admin tab associated with this field */
  adminTab?: string;
  /** Switch to kanban for this field */
  goKanban?: boolean;
  /** Environment / mail-mode gate for this substep */
  when?: OwnerSetupGuideWhen;
}

export function isMultiTenantDeploy(): boolean {
  return process.env.MULTI_TENANT === 'true';
}

export type OwnerSetupGuideFieldContext = {
  multiTenant?: boolean;
  /**
   * Platform-managed mail (`MAIL_MANAGED === 'true'`).
   * `undefined` = unknown / not loaded yet (treat as possibly managed on MULTI_TENANT).
   */
  mailManaged?: boolean;
  /**
   * Platform-managed object storage (`STORAGE_MODE === 'managed'`).
   * `undefined` = unknown / not loaded yet (treat as possibly managed on MULTI_TENANT).
   */
  storageManaged?: boolean;
};

/** Whether a guide field applies for the current deployment / mail mode. */
export function isOwnerSetupGuideFieldApplicable(
  field: OwnerSetupGuideField,
  ctx: OwnerSetupGuideFieldContext = {}
): boolean {
  const multiTenant = ctx.multiTenant ?? isMultiTenantDeploy();
  switch (field.when ?? 'always') {
    case 'multiTenant':
      return multiTenant;
    case 'singleTenant':
      return !multiTenant;
    case 'multiTenantManagedMail':
      // Show on tenant installs until we know custom SMTP is already active
      if (!multiTenant) return false;
      if (ctx.mailManaged === false) return false;
      return true;
    case 'multiTenantManagedStorage':
      if (!multiTenant) return false;
      if (ctx.storageManaged === false) return false;
      return true;
    default:
      return true;
  }
}

export function filterOwnerSetupGuideFields(
  fields: OwnerSetupGuideField[] | undefined,
  ctx?: OwnerSetupGuideFieldContext
): OwnerSetupGuideField[] {
  if (!fields?.length) return [];
  return fields.filter((f) => isOwnerSetupGuideFieldApplicable(f, ctx));
}

/** Selectors to spotlight (skips text-only tips). */
export function ownerSetupGuideSelectors(
  fields: OwnerSetupGuideField[] | undefined,
  ctx?: OwnerSetupGuideFieldContext
): string[] {
  return filterOwnerSetupGuideFields(fields, ctx)
    .map((f) => f.selector)
    .filter((s): s is string => Boolean(s));
}

export interface OwnerSetupStepDef {
  id: OwnerSetupStepId;
  optional: boolean;
  /** Intro/outro bookends vs real configuration tasks (default: task). */
  kind?: OwnerSetupStepKind;
  /** Admin tab / subtab id for navigation (legacy ids map via adminHashForTabId) */
  adminTab?: string;
  /** Switch to kanban before spotlight */
  goKanban?: boolean;
  /** After navigate / Guide me, scroll the window to the top (e.g. boards with tall columns). */
  scrollToTop?: boolean;
  /** Fallback single target (tab / button) when no guideFields */
  tourTarget?: string;
  /** Fields for Guide me: one instruction list + simultaneous highlights */
  guideFields?: OwnerSetupGuideField[];
}

export function getOwnerSetupStepKind(step: OwnerSetupStepDef | OwnerSetupStepId): OwnerSetupStepKind {
  if (typeof step === 'string') {
    const def = OWNER_SETUP_STEPS.find((s) => s.id === step);
    return def?.kind ?? 'task';
  }
  return step.kind ?? 'task';
}

/** Real setup steps counted in progress (excludes welcome intro / finish outro). */
export function isOwnerSetupProgressStep(step: OwnerSetupStepDef): boolean {
  return getOwnerSetupStepKind(step) === 'task';
}

export function ownerSetupProgressStats(progress: OwnerSetupProgress): {
  done: number;
  total: number;
} {
  const counted = OWNER_SETUP_STEPS.filter(isOwnerSetupProgressStep);
  const done = counted.filter((s) => isStepResolved(progress, s.id)).length;
  return { done, total: counted.length };
}

const OWNER_SETUP_HIGHLIGHT_CLASS = 'owner-setup-field-highlight';

/** Remove Guide me field highlights from the DOM. */
export function clearOwnerSetupFieldHighlights(): void {
  document.querySelectorAll(`.${OWNER_SETUP_HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(OWNER_SETUP_HIGHLIGHT_CLASS);
  });
}

function stickyChromeBottom(): number {
  const adminTabs = document.querySelector('[data-tour-id="admin-tabs"]') as HTMLElement | null;
  if (adminTabs) {
    return adminTabs.getBoundingClientRect().bottom + 12;
  }
  const header = document.querySelector('header') as HTMLElement | null;
  return (header?.getBoundingClientRect().bottom ?? 56) + 12;
}

/** Scroll so the element sits just below sticky Admin / app chrome. */
export function scrollOwnerSetupTargetIntoView(el: HTMLElement): void {
  const top = el.getBoundingClientRect().top + window.scrollY - stickyChromeBottom();
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/**
 * Highlight all Guide me targets that are currently mounted.
 * Retries briefly so Admin tab content can mount after navigation.
 * Returns a cancel function.
 */
export function applyOwnerSetupFieldHighlights(
  selectors: string[],
  options?: {
    attempts?: number;
    intervalMs?: number;
    scrollToTop?: boolean;
    /** Auto-remove highlights after this many ms (e.g. Help → Go there). */
    clearAfterMs?: number;
  }
): () => void {
  const attempts = options?.attempts ?? 20;
  const intervalMs = options?.intervalMs ?? 75;
  const scrollToTop = Boolean(options?.scrollToTop);
  const clearAfterMs =
    typeof options?.clearAfterMs === 'number' && options.clearAfterMs > 0
      ? options.clearAfterMs
      : 0;
  let cancelled = false;
  let tries = 0;
  let clearTimer: number | null = null;

  const scheduleAutoClear = () => {
    if (!clearAfterMs || cancelled) return;
    if (clearTimer != null) window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => {
      if (cancelled) return;
      clearOwnerSetupFieldHighlights();
    }, clearAfterMs);
  };

  const run = () => {
    if (cancelled) return;
    clearOwnerSetupFieldHighlights();

    const found: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const selector of selectors) {
      if (!selector) continue;
      try {
        // querySelectorAll: some controls exist twice (e.g. header Invite desktop/mobile)
        document.querySelectorAll(selector).forEach((node) => {
          const el = node as HTMLElement;
          if (seen.has(el)) return;
          // Skip hidden duplicates so highlight/scroll targets visible UI
          if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
          seen.add(el);
          found.push(el);
        });
      } catch {
        // ignore invalid selectors
      }
    }

    if (found.length > 0) {
      found.forEach((el) => el.classList.add(OWNER_SETUP_HIGHLIGHT_CLASS));
      if (scrollToTop) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        scrollOwnerSetupTargetIntoView(found[0]);
      }
      scheduleAutoClear();
      return;
    }

    tries += 1;
    if (tries < attempts) {
      window.setTimeout(run, intervalMs);
    }
  };

  requestAnimationFrame(run);
  return () => {
    cancelled = true;
    if (clearTimer != null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
  };
}

export const OWNER_SETUP_STEPS: OwnerSetupStepDef[] = [
  { id: 'welcome', optional: false, kind: 'intro' },
  {
    id: 'siteIdentity',
    optional: false,
    adminTab: 'site-settings',
    tourTarget: '[data-tour-id="admin-site-settings"]',
    guideFields: [
      { selector: '[data-setting-key="SITE_NAME"]', fieldKey: 'SITE_NAME' },
      { selector: '[data-setting-key="SITE_URL"]', fieldKey: 'SITE_URL' },
      { selector: '[data-setting-key="SITE_LOGO"]', fieldKey: 'SITE_LOGO' },
    ],
  },
  {
    id: 'language',
    optional: false,
    adminTab: 'app-settings',
    tourTarget: '[data-tour-id="admin-app-settings"]',
    guideFields: [
      { selector: '[data-setting-key="APP_LANGUAGE"]', fieldKey: 'APP_LANGUAGE' },
    ],
  },
  {
    id: 'mail',
    optional: true,
    adminTab: 'mail-server',
    tourTarget: '[data-tour-id="admin-mail-server"]',
    guideFields: [
      {
        selector: '[data-owner-setup="switch-custom-smtp"]',
        fieldKey: 'switchToCustomSmtp',
        when: 'multiTenantManagedMail',
      },
      { selector: '[data-setting-key="SMTP_HOST"]', fieldKey: 'SMTP_HOST' },
      { selector: '[data-setting-key="SMTP_PORT"]', fieldKey: 'SMTP_PORT' },
      { selector: '[data-setting-key="SMTP_USERNAME"]', fieldKey: 'SMTP_USERNAME' },
      { selector: '[data-setting-key="SMTP_PASSWORD"]', fieldKey: 'SMTP_PASSWORD' },
      { selector: '[data-setting-key="SMTP_FROM_EMAIL"]', fieldKey: 'SMTP_FROM_EMAIL' },
      { selector: '[data-setting-key="MAIL_TEST_EMAIL"]', fieldKey: 'MAIL_TEST_EMAIL' },
      { selector: '[data-setting-key="MAIL_ENABLED"]', fieldKey: 'MAIL_ENABLED' },
    ],
  },
  {
    id: 'users',
    optional: false,
    adminTab: 'users',
    tourTarget: '[data-tour-id="admin-users"]',
    guideFields: [
      // Add User first so scroll lands on Admin → Users; header Invite is also highlighted
      { selector: '[data-owner-setup="add-user"]', fieldKey: 'addUser' },
      { selector: '[data-tour-id="invite-user-button"]', fieldKey: 'headerInvite' },
    ],
  },
  {
    id: 'boards',
    optional: false,
    goKanban: true,
    /** Kanban can leave the viewport mid-board when tasks exist — always show tabs first. */
    scrollToTop: true,
    tourTarget: '[data-tour-id="add-board-button"]',
    guideFields: [
      {
        selector: '[data-tour-id="add-board-button"]',
        fieldKey: 'addBoard',
        sectionKey: 'topOfScreen',
        goKanban: true,
      },
      {
        selector: '[data-tour-id="board-tabs"]',
        fieldKey: 'boardTitle',
        sectionKey: 'topOfScreen',
        goKanban: true,
      },
      {
        fieldKey: 'boardMembers',
        sectionKey: 'topOfScreen',
        goKanban: true,
      },
      {
        selector: '[data-column-title]',
        fieldKey: 'columnTitle',
        sectionKey: 'tasksBoard',
        goKanban: true,
      },
      {
        selector: '[data-tour-id="column-management-menu"]',
        fieldKey: 'columnMenu',
        sectionKey: 'tasksBoard',
        goKanban: true,
      },
    ],
  },
  {
    id: 'tagsPriorities',
    optional: false,
    adminTab: 'tags',
    tourTarget: '[data-tour-id="admin-tags"]',
    guideFields: [
      { selector: '[data-owner-setup="add-tag"]', fieldKey: 'addTag', adminTab: 'tags' },
      // Text-only: Priorities tab stays in the Admin nav always, so spotlighting it
      // while on Tags looked like a bug and Guide me never opens Priorities for you.
      { fieldKey: 'prioritiesHint', adminTab: 'tags' },
    ],
  },
  {
    id: 'sprints',
    optional: true,
    adminTab: 'sprint-settings',
    tourTarget: '[data-tour-id="admin-sprint-settings"]',
    guideFields: [
      { selector: '[data-owner-setup="create-sprint"]', fieldKey: 'createSprint' },
      { fieldKey: 'sprintGoal' },
    ],
  },
  {
    id: 'sso',
    optional: true,
    adminTab: 'sso',
    tourTarget: '[data-tour-id="admin-sso"]',
    guideFields: [
      { fieldKey: 'providersOverview' },
      { selector: '[data-setting-key="GOOGLE_CLIENT_ID"]', fieldKey: 'GOOGLE_CLIENT_ID' },
      { selector: '[data-setting-key="GITHUB_CLIENT_ID"]', fieldKey: 'GITHUB_CLIENT_ID' },
      { selector: '[data-setting-key="M365_CLIENT_ID"]', fieldKey: 'M365_CLIENT_ID' },
    ],
  },
  {
    id: 'storage',
    optional: true,
    adminTab: 'storage',
    tourTarget: '[data-tour-id="admin-storage"]',
    guideFields: [
      {
        selector: '[data-owner-setup="switch-custom-storage"]',
        fieldKey: 'switchToCustomStorage',
        when: 'multiTenantManagedStorage',
      },
      { selector: '[data-setting-key="STORAGE_BACKEND"]', fieldKey: 'STORAGE_BACKEND', when: 'singleTenant' },
      { selector: '[data-setting-key="S3_BUCKET"]', fieldKey: 'S3_BUCKET' },
      { selector: '[data-setting-key="S3_REGION"]', fieldKey: 'S3_REGION' },
      { selector: '[data-setting-key="S3_ACCESS_KEY_ID"]', fieldKey: 'S3_ACCESS_KEY_ID' },
      { selector: '[data-setting-key="S3_SECRET_ACCESS_KEY"]', fieldKey: 'S3_SECRET_ACCESS_KEY' },
      { selector: '[data-owner-setup="storage-test-connection"]', fieldKey: 'testConnection' },
    ],
  },
  {
    id: 'licensing',
    optional: true,
    adminTab: 'licensing',
    tourTarget: '[data-tour-id="admin-licensing"]',
    guideFields: [
      { selector: '[data-owner-setup="licensing-panel"]', fieldKey: 'panel' },
    ],
  },
  {
    id: 'reporting',
    optional: true,
    adminTab: 'reporting',
    tourTarget: '[data-tour-id="admin-reporting"]',
    guideFields: [
      { selector: '[data-setting-key="REPORTS_ENABLED"]', fieldKey: 'REPORTS_ENABLED' },
    ],
  },
  { id: 'finish', optional: false, kind: 'outro' },
];

export interface OwnerSetupProgress {
  version: 1;
  /** Checklist visible (false after dismiss until Help recall) */
  visible: boolean;
  minimized: boolean;
  activeStepId: OwnerSetupStepId;
  steps: Partial<Record<OwnerSetupStepId, OwnerSetupManualStatus>>;
  /**
   * Horizontal position as CSS `left` in px.
   * `null` = default docked to the bottom-right with 1rem margin.
   */
  positionX: number | null;
}

export const DEFAULT_OWNER_SETUP_PROGRESS: OwnerSetupProgress = {
  version: 1,
  visible: true,
  minimized: false,
  activeStepId: 'welcome',
  steps: {},
  positionX: null,
};

export interface OwnerSetupHints {
  siteIdentity: boolean;
  language: boolean;
  mail: boolean;
  users: boolean;
  boards: boolean;
  tagsPriorities: boolean;
  sprints: boolean;
  sso: boolean;
  storage: boolean;
  licensing: boolean;
  reporting: boolean;
}

export const EMPTY_OWNER_SETUP_HINTS: OwnerSetupHints = {
  siteIdentity: false,
  language: false,
  mail: false,
  users: false,
  boards: false,
  tagsPriorities: false,
  sprints: false,
  sso: false,
  storage: false,
  licensing: false,
  reporting: false,
};

const storageKey = (userId: string) => `easy-kanban-owner-setup-${userId}`;

function normalizeProgress(raw: unknown): OwnerSetupProgress {
  const base = { ...DEFAULT_OWNER_SETUP_PROGRESS, steps: {} as OwnerSetupProgress['steps'] };
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<OwnerSetupProgress>;
  const active =
    p.activeStepId && OWNER_SETUP_STEP_IDS.includes(p.activeStepId)
      ? p.activeStepId
      : base.activeStepId;
  const steps: OwnerSetupProgress['steps'] = {};
  if (p.steps && typeof p.steps === 'object') {
    for (const id of OWNER_SETUP_STEP_IDS) {
      const status = p.steps[id];
      if (status === 'done' || status === 'skipped' || status === 'todo') {
        steps[id] = status;
      }
    }
  }
  return {
    version: 1,
    visible: p.visible !== false,
    minimized: Boolean(p.minimized),
    activeStepId: active,
    steps,
    positionX:
      typeof p.positionX === 'number' && Number.isFinite(p.positionX) ? p.positionX : null,
  };
}

export function loadOwnerSetupProgressLocal(userId: string): OwnerSetupProgress {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_OWNER_SETUP_PROGRESS, steps: {} };
    return normalizeProgress(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_OWNER_SETUP_PROGRESS, steps: {} };
  }
}

export function saveOwnerSetupProgressLocal(userId: string, progress: OwnerSetupProgress): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(progress));
  } catch {
    // ignore quota / private mode
  }
}

export async function persistOwnerSetupProgress(
  userId: string,
  progress: OwnerSetupProgress
): Promise<void> {
  saveOwnerSetupProgressLocal(userId, progress);
  try {
    await updateUserSetting('ownerSetup', JSON.stringify(progress));
  } catch (err) {
    console.warn('Failed to persist owner setup progress to server:', err);
  }
}

export async function loadOwnerSetupProgress(userId: string): Promise<OwnerSetupProgress> {
  const local = loadOwnerSetupProgressLocal(userId);
  try {
    const settings = await getUserSettings();
    const raw = settings?.ownerSetup;
    if (!raw) return local;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const fromDb = normalizeProgress(parsed);
    // Prefer whichever has more completed steps; otherwise prefer DB if local is default-ish
    const localDone = countResolved(local);
    const dbDone = countResolved(fromDb);
    if (dbDone > localDone) {
      saveOwnerSetupProgressLocal(userId, fromDb);
      return fromDb;
    }
    if (localDone > 0) return local;
    saveOwnerSetupProgressLocal(userId, fromDb);
    return fromDb;
  } catch {
    return local;
  }
}

function countResolved(progress: OwnerSetupProgress): number {
  return OWNER_SETUP_STEP_IDS.filter((id) => {
    const s = progress.steps[id];
    return s === 'done' || s === 'skipped';
  }).length;
}

export function getStepManualStatus(
  progress: OwnerSetupProgress,
  stepId: OwnerSetupStepId
): OwnerSetupManualStatus {
  return progress.steps[stepId] || 'todo';
}

export function isStepResolved(
  progress: OwnerSetupProgress,
  stepId: OwnerSetupStepId
): boolean {
  const s = getStepManualStatus(progress, stepId);
  return s === 'done' || s === 'skipped';
}

export function getEffectiveDisplayStatus(
  progress: OwnerSetupProgress,
  stepId: OwnerSetupStepId,
  hints: OwnerSetupHints
): 'todo' | 'done' | 'skipped' | 'suggested' {
  const manual = getStepManualStatus(progress, stepId);
  if (manual === 'done' || manual === 'skipped') return manual;
  if (stepId === 'welcome' || stepId === 'finish') return 'todo';
  if (stepId in hints && hints[stepId as keyof OwnerSetupHints]) return 'suggested';
  return 'todo';
}

export function computeOwnerSetupHints(input: {
  siteSettings: SiteSettings | Record<string, string>;
  memberCount: number;
  boards: Board[];
  sprintCount: number;
  tagCount: number;
  priorityCount: number;
}): OwnerSetupHints {
  const s = input.siteSettings || {};
  const siteName = String(s.SITE_NAME || '').trim();
  // Blank is the stock default (logo carries the name). Only the legacy "Agila"
  // text default still needs attention in the owner checklist.
  const siteIdentity = siteName !== 'Agila';

  const mailEnabled = String(s.MAIL_ENABLED || '').toLowerCase() === 'true';
  const smtpHost = String(s.SMTP_HOST || '').trim();
  const mail = mailEnabled && smtpHost.length > 0;

  // Language always has a default — never auto-suggest; owner marks done after visiting
  const language = false;

  const users = input.memberCount > 1;

  const boards =
    input.boards.length > 1 ||
    input.boards.some((b) => {
      const title = (b.title || '').trim().toLowerCase();
      return title.length > 0 && title !== 'new board' && !title.startsWith('board ');
    });

  const tagsPriorities = false; // personal taxonomy — owner marks done

  const sprints = input.sprintCount > 0;

  const sso = String(s.GOOGLE_CLIENT_ID || '').trim().length > 0;

  const storageManaged =
    String(s.STORAGE_MODE || '').trim().toLowerCase() === 'managed' ||
    (String(s.STORAGE_MODE || '').trim() === '' &&
      String(s.STORAGE_MANAGED || '').toLowerCase() === 'true');
  const storageBackend = String(s.STORAGE_BACKEND || '').toLowerCase();
  const storage =
    !storageManaged &&
    storageBackend === 's3' &&
    String(s.S3_BUCKET || '').trim().length > 0;

  const licensing =
    String(s.LICENSE_KEY || s.LICENSE || '').trim().length > 0 ||
    String(s.LICENSE_STATUS || '').toLowerCase() === 'valid';

  const reporting = String(s.REPORTS_ENABLED || '').toLowerCase() === 'true';

  return {
    siteIdentity,
    language,
    mail,
    users,
    boards,
    tagsPriorities,
    sprints,
    sso,
    storage,
    licensing,
    reporting,
  };
}

export function firstIncompleteStepId(progress: OwnerSetupProgress): OwnerSetupStepId {
  for (const id of OWNER_SETUP_STEP_IDS) {
    if (!isStepResolved(progress, id)) return id;
  }
  return 'finish';
}

/** 1-based number among task steps (welcome / finish return null). */
export function ownerSetupTaskStepNumber(stepId: OwnerSetupStepId): number | null {
  const tasks = OWNER_SETUP_STEPS.filter(isOwnerSetupProgressStep);
  const idx = tasks.findIndex((s) => s.id === stepId);
  return idx >= 0 ? idx + 1 : null;
}

export function ownerSetupAdjacentStepId(
  stepId: OwnerSetupStepId,
  direction: -1 | 1
): OwnerSetupStepId | null {
  const idx = OWNER_SETUP_STEPS.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  return OWNER_SETUP_STEPS[idx + direction]?.id ?? null;
}

/** Reset window / admin scroll so the next settings screen starts at the top. */
export function scrollOwnerSetupPageToTop(): void {
  if (typeof window === 'undefined') return;
  const run = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.querySelectorAll<HTMLElement>('main, [data-admin-scroll]').forEach((el) => {
      if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };
  run();
  window.setTimeout(run, 80);
  window.setTimeout(run, 250);
}

export function coreStepsComplete(progress: OwnerSetupProgress): boolean {
  return OWNER_SETUP_STEPS.filter((s) => !s.optional && isOwnerSetupProgressStep(s)).every((s) =>
    isStepResolved(progress, s.id)
  );
}

export function getStepDef(stepId: OwnerSetupStepId): OwnerSetupStepDef {
  return OWNER_SETUP_STEPS.find((s) => s.id === stepId) || OWNER_SETUP_STEPS[0];
}

/** Wait until a selector exists in the DOM (after admin tab navigation). */
export async function waitForOwnerSetupTarget(
  selector: string,
  timeoutMs = 4000,
  options?: { scroll?: boolean }
): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) {
      if (options?.scroll !== false) {
        try {
          (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
        } catch {
          (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      }
      return el;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}

/** Default left offset so the panel sits on the bottom-right with margin. */
export function defaultOwnerSetupPositionX(panelWidth: number, margin = 16): number {
  if (typeof window === 'undefined') return margin;
  return Math.max(margin, window.innerWidth - panelWidth - margin);
}

export function constrainOwnerSetupPositionX(
  x: number,
  panelWidth: number,
  margin = 16
): number {
  if (typeof window === 'undefined') return x;
  const maxX = Math.max(margin, window.innerWidth - panelWidth - margin);
  return Math.min(maxX, Math.max(margin, x));
}

const DEFAULT_POSITION_SLOP_PX = 8;

/** True when the guide is still docked bottom-right (not user-dragged). */
export function isOwnerSetupAtDefaultPosition(
  positionX: number | null | undefined,
  currentLeft: number,
  panelWidth: number,
  margin = 16
): boolean {
  const docked = defaultOwnerSetupPositionX(panelWidth, margin);
  if (typeof positionX === 'number' && Number.isFinite(positionX)) {
    return Math.abs(positionX - docked) <= DEFAULT_POSITION_SLOP_PX;
  }
  return Math.abs(currentLeft - docked) <= DEFAULT_POSITION_SLOP_PX;
}

/** CSS `left` so the panel sits just left of `element` without overlapping it. */
export function ownerSetupLeftBesideElement(
  element: Element,
  panelWidth: number,
  gap = 16,
  margin = 16
): number | null {
  const leftEdge = ownerSetupNudgeAnchorLeft(element);
  if (leftEdge == null) return null;
  return constrainOwnerSetupPositionX(leftEdge - gap - panelWidth, panelWidth, margin);
}

/**
 * Viewport X of a nudge anchor. Valid when the control is laid out — including
 * below the fold — but not when a hidden Admin tab reports a zero box.
 */
export function ownerSetupNudgeAnchorLeft(element: Element): number | null {
  const el = element as HTMLElement;
  const rect = el.getBoundingClientRect();
  if (rect.width >= 8 && rect.height >= 8 && rect.right > 8) {
    return rect.left;
  }
  if (el.offsetWidth < 8) return null;
  let x = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  const viewportLeft = x - window.scrollX;
  if (viewportLeft + el.offsetWidth <= 8) return null;
  return viewportLeft;
}

/** Wait until the Site Settings Cancel control is laid out (may be below the fold). */
export async function waitForOwnerSetupNudgeAnchor(
  selector: string,
  timeoutMs = 4000
): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el && ownerSetupNudgeAnchorLeft(el) != null) return el;
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}
