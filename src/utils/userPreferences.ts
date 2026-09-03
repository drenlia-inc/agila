import { Priority } from '../types';
import { updateUserSetting, getUserSettings } from '../api';

// Global state to track preference saving operations
let globalSavingCallbacks: Set<() => void> = new Set();
let isSavingGlobally = false;

// Register a callback to be notified when saving state changes
export const registerSavingStateCallback = (callback: () => void) => {
  globalSavingCallbacks.add(callback);
  return () => globalSavingCallbacks.delete(callback);
};

// Set global saving state and notify all callbacks
const setGlobalSavingState = (saving: boolean) => {
  if (isSavingGlobally !== saving) {
    isSavingGlobally = saving;
    globalSavingCallbacks.forEach(callback => callback());
  }
};

// Get current global saving state
export const isGloballySavingPreferences = () => isSavingGlobally;

export type TaskViewMode = 'compact' | 'shrink' | 'expand';
export type ViewMode = 'kanban' | 'list' | 'gantt' | 'calendar';
export type CalendarSubView = 'month' | 'week' | 'day';

const CALENDAR_SUB_VIEWS: readonly CalendarSubView[] = ['month', 'week', 'day'];

export function normalizeCalendarSubView(value: unknown): CalendarSubView {
  if (typeof value === 'string' && (CALENDAR_SUB_VIEWS as readonly string[]).includes(value)) {
    return value as CalendarSubView;
  }
  return 'month';
}

const TASK_VIEW_MODES: readonly TaskViewMode[] = ['expand', 'shrink', 'compact'];

/** Normalize admin/user density values (legacy `collapse` → `shrink`). */
export function normalizeTaskViewMode(value: unknown): TaskViewMode {
  if (value === 'collapse' || value === 'collapsed') return 'shrink';
  if (typeof value === 'string' && (TASK_VIEW_MODES as readonly string[]).includes(value)) {
    return value as TaskViewMode;
  }
  return 'expand';
}

export interface ColumnVisibility {
  [columnKey: string]: boolean;
}

/** Per-board list-view column widths in pixels (keyed by column key). */
export type ListViewColumnWidthsByBoard = {
  [boardId: string]: { [columnKey: string]: number };
};

export interface UserPreferences {
  taskViewMode: TaskViewMode;
  viewMode: ViewMode;
  /** Calendar month | week | day (prefs only — not in URL hash). */
  calendarSubView: CalendarSubView;
  /** YYYY-MM-DD focus date for calendar navigation. */
  calendarFocusDate: string | null;
  isSearchActive: boolean;
  isAdvancedSearchExpanded: boolean;
  selectedTaskId: string | null;
  lastSelectedBoard: string | null;
  selectedMembers: string[];
  currentFilterViewId: number | null;
  showSharedFilters: boolean;
  includeAssignees: boolean;
  /** When false, hide finished (Done/Completed) columns on every board. Default true. */
  showFinishedColumns: boolean;
  includeWatchers: boolean;
  includeCollaborators: boolean;
  includeRequesters: boolean;
  includeSystem: boolean;
  /** When false, hide tasks assigned to the AI Agent (does not change selectedMembers). Default true. */
  showAgentTasks: boolean;
  taskDetailsWidth: number;
  ganttTaskColumnWidth: number;
  /** Gantt timeline day column width in pixels (zoom). */
  ganttDayColumnWidth: number;
  kanbanColumnWidth: number; // User-adjustable width for Kanban columns (default: 300px)
  ganttScrollPositions: { [boardId: string]: { date: string; sessionId: string } }; // Per-board scroll positions
  listViewColumnVisibility: ColumnVisibility;
  /** Per-board list view column widths (px). */
  listViewColumnWidths: ListViewColumnWidthsByBoard;
  /** List view: show parent/child dependency tree in the ID column */
  listViewShowDependencies: boolean;
  selectedSprintId: string | null; // Selected sprint for filtering
  lastReportTab: string | null; // Last accessed report tab (persists across sessions)
  language: 'en' | 'fr'; // User's preferred language
  /** IANA timezone from the browser (e.g. America/Toronto) — used for email timestamps */
  timezone?: string | null;
  /** Per-board visible column IDs (includes Archive when the user unhides it). */
  boardColumnVisibility: { [boardId: string]: string[] };
  /** Calendar-only column visibility; does not change Kanban/List/Gantt filters. */
  calendarColumnVisibility: { [boardId: string]: string[] };

  /**
   * Preferred member chip / Meet-the-team order (people ids only).
   * Empty → me first, then A→Z; Agent then System always pinned last by the sort helper.
   */
  memberDisplayOrder: string[];

  searchFilters: {
    text: string;
    dateFrom: string;
    dateTo: string;
    dueDateFrom: string;
    dueDateTo: string;
    selectedMembers: string[];
    selectedPriorities: Priority[];
    selectedTags: string[];
    selectedProjectIds: string[];
    taskId: string;
    linkedTasksOnly: boolean;
    overdueOnly: boolean;
    blockedOnly: boolean;
    selectedSprintIds: string[];
    stalledDays: number | null;
  };
  appSettings: {
    taskDeleteConfirm?: boolean; // User override for system TASK_DELETE_CONFIRM setting
    showActivityFeed?: boolean; // User override for system SHOW_ACTIVITY_FEED setting
    autoRefreshEnabled?: boolean; // User preference for auto-refresh toggle
    showSystemPanel?: boolean; // User preference for system metrics panel visibility (default: true for admins)
    /** Tools + members + board progress row above the board (default: true / shown) */
    showBoardToolbar?: boolean;
  };
  notifications: {
    newTaskAssigned: boolean; // Notify when a new task is assigned to me
    myTaskUpdated: boolean; // Notify when my task is updated
    watchedTaskUpdated: boolean; // Notify when a task I'm watching is updated
    addedAsCollaborator: boolean; // Notify when I'm added as a collaborator on a task
    addedAsWatcher: boolean; // Notify when I'm added as a watcher on a task
    collaboratingTaskUpdated: boolean; // Notify when a task I'm collaborating in is updated
    commentAdded: boolean; // Notify when a comment is added to a task I'm involved in
    requesterTaskCreated: boolean; // Notify when a task is created and I'm the requester
    requesterTaskUpdated: boolean; // Notify when a task is updated where I'm the requester
  };
  taskPageCollapsed: {
    assignment: boolean;
    schedule: boolean;
    tags: boolean;
    associations: boolean;
    taskFlow: boolean;
    taskInfo: boolean;
  };
  activityFeed: {
    isMinimized: boolean;
    position: { x: number; y: number };
    width: number;
    height: number;
    lastSeenActivityId: number;
    clearActivityId: number;
    /** Activity IDs hidden individually (between clear watermark and newest). */
    dismissedActivityIds: number[];
    /** Activity IDs marked read individually (newer than lastSeen watermark). */
    readActivityIds: number[];
    filterText: string;
    /** When true (default), show short task-impact lines and hide non-task noise. */
    taskImpactView: boolean;
  };
}

/** Legacy cookie prefix, read once for migration then deleted. */
const COOKIE_NAME_PREFIX = 'easy-kanban-user-prefs';
const LOCAL_STORAGE_PREFIX = 'easy-kanban-user-prefs-local';
const PREFS_STORAGE_PREFIX = 'easy-kanban-user-prefs-store';

/**
 * Per-board maps that grow with usage. Stored in localStorage (+ DB) separately from the
 * main preference payload.
 */
type BulkyLocalPreferences = {
  listViewColumnWidths: ListViewColumnWidthsByBoard;
  boardColumnVisibility: { [boardId: string]: string[] };
  calendarColumnVisibility: { [boardId: string]: string[] };
  ganttScrollPositions: UserPreferences['ganttScrollPositions'];
};

// Legacy cookie name, kept only so existing cookies can be migrated and removed
const getUserCookieName = (userId: string | null): string => {
  if (!userId) {
    return `${COOKIE_NAME_PREFIX}-anonymous`;
  }
  return `${COOKIE_NAME_PREFIX}-${userId}`;
};

const getPrefsStorageKey = (userId: string | null): string =>
  `${PREFS_STORAGE_PREFIX}-${userId ?? 'anonymous'}`;

const getBulkyLocalStorageKey = (userId: string | null): string =>
  `${LOCAL_STORAGE_PREFIX}-${userId ?? 'anonymous'}`;

/**
 * Preferences used to live in a ~3 KB cookie that the server never reads, so every HTML,
 * module, API and avatar request carried it. Enough of them (one per user id seen on the
 * host) pushed the request header past what the proxy accepts. Delete on sight.
 */
const deleteLegacyPreferenceCookie = (cookieName: string): void => {
  try {
    if (!document.cookie.includes(`${cookieName}=`)) return;
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
  } catch {
    // ignore private-mode failures
  }
};

const readLegacyPreferenceCookie = (userId: string | null) => {
  try {
    const cookieName = getUserCookieName(userId);
    const prefsCookie = document.cookie
      .split(';')
      .find((cookie) => cookie.trim().startsWith(`${cookieName}=`));
    if (!prefsCookie) return null;

    const raw = prefsCookie.slice(prefsCookie.indexOf('=') + 1);
    const parsed = JSON.parse(decodeURIComponent(raw));
    deleteLegacyPreferenceCookie(cookieName);
    return parsed;
  } catch {
    return null;
  }
};

const writeBulkyPreferencesLocal = (
  userId: string | null,
  preferences: Pick<UserPreferences, keyof BulkyLocalPreferences>
): void => {
  try {
    const payload: BulkyLocalPreferences = {
      listViewColumnWidths: preferences.listViewColumnWidths || {},
      boardColumnVisibility: preferences.boardColumnVisibility || {},
      calendarColumnVisibility: preferences.calendarColumnVisibility || {},
      ganttScrollPositions: preferences.ganttScrollPositions || {},
    };
    localStorage.setItem(getBulkyLocalStorageKey(userId), JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save bulky preferences to localStorage:', error);
  }
};

const readBulkyPreferencesLocal = (userId: string | null): BulkyLocalPreferences => {
  const empty: BulkyLocalPreferences = {
    listViewColumnWidths: {},
    boardColumnVisibility: {},
    calendarColumnVisibility: {},
    ganttScrollPositions: {},
  };
  try {
    const raw = localStorage.getItem(getBulkyLocalStorageKey(userId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      listViewColumnWidths: parsed?.listViewColumnWidths || {},
      boardColumnVisibility: parsed?.boardColumnVisibility || {},
      calendarColumnVisibility: parsed?.calendarColumnVisibility || {},
      ganttScrollPositions: parsed?.ganttScrollPositions || {},
    };
  } catch {
    return empty;
  }
};

const clearBulkyPreferencesLocal = (keepUserId: string | null | undefined = undefined): void => {
  try {
    const keepKey =
      keepUserId === undefined ? null : getBulkyLocalStorageKey(keepUserId);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_STORAGE_PREFIX)) continue;
      if (keepKey !== null && key === keepKey) continue;
      localStorage.removeItem(key);
    }
  } catch {
    // ignore quota / private-mode failures
  }
};

const clearStoredPreferencesLocal = (keepUserId: string | null | undefined = undefined): void => {
  try {
    const keepKey = keepUserId === undefined ? null : getPrefsStorageKey(keepUserId);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFS_STORAGE_PREFIX)) continue;
      if (keepKey !== null && key === keepKey) continue;
      localStorage.removeItem(key);
    }
  } catch {
    // ignore quota / private-mode failures
  }
};

// Latest known preferences (cookie + localStorage merged with database), so components do not
// have to re-read storage to see database-backed values.
let cachedPreferences: { userId: string | null; preferences: UserPreferences } | null = null;

/**
 * Call sites that omit the user id would otherwise write to the "anonymous" cookie and skip the
 * database entirely, so their changes disappear on refresh.
 */
const resolvePreferencesUserId = (userId: string | null): string | null =>
  userId ?? cachedPreferences?.userId ?? null;

/** Drop every stored preference set (plus any legacy cookies) for this browser. */
export const clearAllUserPreferenceCookies = (): void => {
  cachedPreferences = null;
  clearBulkyPreferencesLocal();
  clearStoredPreferencesLocal();
  document.cookie.split(';').forEach((cookie) => {
    const cookieName = cookie.trim().split('=')[0];
    if (cookieName.startsWith(COOKIE_NAME_PREFIX)) {
      deleteLegacyPreferenceCookie(cookieName);
    }
  });
};

/** Keep only the signed-in user's preferences; discard other users' leftovers. */
export const clearOtherUserPreferenceCookies = (currentUserId: string | null): void => {
  if (cachedPreferences && cachedPreferences.userId !== currentUserId) {
    cachedPreferences = null;
  }
  clearBulkyPreferencesLocal(currentUserId);
  clearStoredPreferencesLocal(currentUserId);

  const currentUserCookieName = getUserCookieName(currentUserId);
  document.cookie.split(';').forEach((cookie) => {
    const cookieName = cookie.trim().split('=')[0];
    if (cookieName.startsWith(COOKIE_NAME_PREFIX) && cookieName !== currentUserCookieName) {
      deleteLegacyPreferenceCookie(cookieName);
    }
  });
};

// Base default preferences (fallback when no admin defaults are set)
const BASE_DEFAULT_PREFERENCES: UserPreferences = {
  taskViewMode: 'expand', // Default to expand
  viewMode: 'kanban', // Default to kanban view
  calendarSubView: 'month',
  calendarFocusDate: null,
  isSearchActive: false, // Search panel UI visibility only — filter criteria still apply when set
  isAdvancedSearchExpanded: false, // Default to collapsed (basic search)
  selectedTaskId: null, // Default to no task selected
  lastSelectedBoard: null, // Default to no board remembered
  selectedMembers: [], // Default to no members selected
  currentFilterViewId: null, // Default to no saved filter selected
  showSharedFilters: true, // Default to show shared filters from other users
  includeAssignees: true, // Default to include assignees (maintains current behavior)
  showFinishedColumns: true,
  includeWatchers: false, // Default to not include watchers
  includeCollaborators: false, // Default to not include collaborators
  includeRequesters: false, // Default to not include requesters
  includeSystem: false, // Default to not include system user
  showAgentTasks: true, // Default: show Agent-assigned tasks on the board
  taskDetailsWidth: 480, // Default width in pixels (30rem equivalent)
  ganttTaskColumnWidth: 320, // Default Gantt task column width in pixels
  ganttDayColumnWidth: 40, // Default Gantt day column width (100% zoom)
  kanbanColumnWidth: 300, // Default Kanban column width in pixels
  ganttScrollPositions: {}, // Per-board Gantt scroll positions (empty by default)
  selectedSprintId: null, // Default to "All Sprints" (no filter)
  lastReportTab: null, // Default to no last report (will use burndown)
  language: 'en', // Default to English
  timezone: null, // Detected from browser and synced to user_settings
  boardColumnVisibility: {}, // Default: no overrides (archived columns hidden by Kanban UI)
  calendarColumnVisibility: {},
  memberDisplayOrder: [], // Empty = A→Z default
  listViewColumnVisibility: {
    // Default column visibility - all columns visible except some less important ones
    ticket: true,
    title: true,
    priority: true,
    assignee: true,
    startDate: true,
    dueDate: true,
    tags: true,
    comments: true,
    createdAt: false // Hide created date by default
  },
  listViewColumnWidths: {},
  listViewShowDependencies: false,
  searchFilters: {
    text: '',
    dateFrom: '',
    dateTo: '',
    dueDateFrom: '',
    dueDateTo: '',
    selectedMembers: [],
    selectedPriorities: [],
    selectedTags: [],
    selectedProjectIds: [],
    taskId: '',
    linkedTasksOnly: false,
    overdueOnly: false,
    blockedOnly: false,
    selectedSprintIds: [],
    stalledDays: null,
  },
  appSettings: {
    // taskDeleteConfirm: undefined - let it inherit from system setting by default
    // showActivityFeed: undefined - let it inherit from system setting by default
    autoRefreshEnabled: true, // Default to auto-refresh enabled
    showBoardToolbar: true, // Tools / members / progress visible by default
  },
  notifications: {
    newTaskAssigned: true,
    myTaskUpdated: true,
    watchedTaskUpdated: true,
    addedAsCollaborator: true,
    addedAsWatcher: true,
    collaboratingTaskUpdated: true,
    commentAdded: true,
    requesterTaskCreated: true,
    requesterTaskUpdated: true
  },
  taskPageCollapsed: {
    assignment: false,
    schedule: false,
    tags: false,
    associations: false,
    taskFlow: false,
    taskInfo: false
  },
  activityFeed: {
    isMinimized: true, // New users start minimized; expanded state is saved when they open it
    position: { x: 10, y: 66 }, // Signed X: positive = inset from left (clear of TaskDetails)
    width: 160, // Default width (now supports 120-600px range)
    height: 400, // Default height (matches database default)
    lastSeenActivityId: 0,
    clearActivityId: 0,
    dismissedActivityIds: [],
    readActivityIds: [],
    filterText: '',
    taskImpactView: true,
  }
};

// Admin-configurable default preferences (loaded from system settings)
let ADMIN_DEFAULT_PREFERENCES: Partial<UserPreferences> | null = null;

function tokenHasAdminRole(): boolean {
  try {
    const token = localStorage.getItem('authToken');
    if (!token) return false;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Array.isArray(payload.roles) && payload.roles.includes('admin');
  } catch {
    return false;
  }
}

/** Load site preference defaults. Uses public settings for non-admins (no /admin/settings 403). */
export const loadAdminDefaults = async (): Promise<void> => {
  try {
    const { getSettings, getPublicSettings } = await import('../api');
    const settings = tokenHasAdminRole()
      ? await getSettings()
      : await getPublicSettings();
    
    ADMIN_DEFAULT_PREFERENCES = {};
    
    if (settings.DEFAULT_VIEW_MODE) {
      ADMIN_DEFAULT_PREFERENCES.viewMode = settings.DEFAULT_VIEW_MODE;
    }
    
    if (settings.DEFAULT_TASK_VIEW_MODE) {
      ADMIN_DEFAULT_PREFERENCES.taskViewMode = normalizeTaskViewMode(
        settings.DEFAULT_TASK_VIEW_MODE
      );
    }
    
    if (settings.DEFAULT_ACTIVITY_FEED_POSITION) {
      try {
        const { normalizeStoredActivityFeedPosition, DEFAULT_ACTIVITY_FEED_STORED_POSITION } =
          await import('./activityFeedPosition');
        ADMIN_DEFAULT_PREFERENCES.activityFeed = {
          ...BASE_DEFAULT_PREFERENCES.activityFeed,
          position: normalizeStoredActivityFeedPosition(
            JSON.parse(settings.DEFAULT_ACTIVITY_FEED_POSITION),
            DEFAULT_ACTIVITY_FEED_STORED_POSITION
          ),
        };
      } catch (e) {
        console.warn('Failed to parse DEFAULT_ACTIVITY_FEED_POSITION:', e);
      }
    }
    
    if (settings.DEFAULT_ACTIVITY_FEED_WIDTH || settings.DEFAULT_ACTIVITY_FEED_HEIGHT) {
      const widthRaw = settings.DEFAULT_ACTIVITY_FEED_WIDTH;
      const heightRaw = settings.DEFAULT_ACTIVITY_FEED_HEIGHT;
      ADMIN_DEFAULT_PREFERENCES.activityFeed = {
        ...(ADMIN_DEFAULT_PREFERENCES.activityFeed || BASE_DEFAULT_PREFERENCES.activityFeed),
        width: widthRaw != null && widthRaw !== ''
          ? Number(widthRaw)
          : (ADMIN_DEFAULT_PREFERENCES.activityFeed?.width ?? BASE_DEFAULT_PREFERENCES.activityFeed.width),
        height: heightRaw != null && heightRaw !== ''
          ? Number(heightRaw)
          : (ADMIN_DEFAULT_PREFERENCES.activityFeed?.height ?? BASE_DEFAULT_PREFERENCES.activityFeed.height),
      };
    }
    
  } catch (error) {
    console.warn('Failed to load admin defaults, using base defaults:', error);
    ADMIN_DEFAULT_PREFERENCES = {};
  }
};

// Get effective default preferences (base + admin overrides)
export const getDefaultPreferences = (): UserPreferences => {
  if (!ADMIN_DEFAULT_PREFERENCES) {
    return BASE_DEFAULT_PREFERENCES;
  }
  
  return {
    ...BASE_DEFAULT_PREFERENCES,
    ...ADMIN_DEFAULT_PREFERENCES,
    // Deep merge nested objects
    listViewColumnVisibility: {
      ...BASE_DEFAULT_PREFERENCES.listViewColumnVisibility,
      ...ADMIN_DEFAULT_PREFERENCES.listViewColumnVisibility
    },
    searchFilters: {
      ...BASE_DEFAULT_PREFERENCES.searchFilters,
      ...ADMIN_DEFAULT_PREFERENCES.searchFilters
    },
    appSettings: {
      ...BASE_DEFAULT_PREFERENCES.appSettings,
      ...ADMIN_DEFAULT_PREFERENCES.appSettings
    },
    notifications: {
      ...BASE_DEFAULT_PREFERENCES.notifications,
      ...ADMIN_DEFAULT_PREFERENCES.notifications
    },
    taskPageCollapsed: {
      ...BASE_DEFAULT_PREFERENCES.taskPageCollapsed,
      ...ADMIN_DEFAULT_PREFERENCES.taskPageCollapsed
    },
    activityFeed: {
      ...BASE_DEFAULT_PREFERENCES.activityFeed,
      ...ADMIN_DEFAULT_PREFERENCES.activityFeed
    }
  };
};

// Export for backward compatibility - will use admin defaults if loaded
export const DEFAULT_PREFERENCES = getDefaultPreferences();

/** Stored payload excludes the per-board maps (they get their own localStorage entry). */
const stripBulkyFromStoredPayload = (preferences: UserPreferences): UserPreferences => ({
  ...preferences,
  listViewColumnWidths: BASE_DEFAULT_PREFERENCES.listViewColumnWidths,
  boardColumnVisibility: BASE_DEFAULT_PREFERENCES.boardColumnVisibility,
  calendarColumnVisibility: BASE_DEFAULT_PREFERENCES.calendarColumnVisibility,
  ganttScrollPositions: BASE_DEFAULT_PREFERENCES.ganttScrollPositions,
});

const writeStoredPreferences = (userId: string | null, preferences: UserPreferences): void => {
  try {
    localStorage.setItem(
      getPrefsStorageKey(userId),
      JSON.stringify(stripBulkyFromStoredPayload(preferences))
    );
  } catch (error) {
    console.warn('Failed to save preferences to localStorage:', error);
  }
  deleteLegacyPreferenceCookie(getUserCookieName(userId));
};

/** Persist localStorage (payload + bulky maps) + in-memory cache. */
export const persistLocalPreferences = (
  userId: string | null,
  preferences: UserPreferences
): void => {
  writeStoredPreferences(userId, preferences);
  writeBulkyPreferencesLocal(userId, preferences);
  setCachedPreferences(userId, preferences);
};

const preferenceListeners = new Set<(preferences: UserPreferences, userId: string | null) => void>();

const setCachedPreferences = (userId: string | null, preferences: UserPreferences): void => {
  cachedPreferences = { userId, preferences };
  preferenceListeners.forEach(listener => {
    try {
      listener(preferences, userId);
    } catch (error) {
      console.warn('User preference listener failed:', error);
    }
  });
};

/** Notified whenever preferences are loaded from the database or updated locally. */
export const subscribeToUserPreferences = (
  listener: (preferences: UserPreferences, userId: string | null) => void
): (() => void) => {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
};

/**
 * Cookie + localStorage preferences, replaced by the database-merged set once it has been loaded.
 */
export const getEffectiveUserPreferences = (userId: string | null = null): UserPreferences => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  if (cachedPreferences && cachedPreferences.userId === resolvedUserId) {
    return cachedPreferences.preferences;
  }
  return readLocalPreferences(resolvedUserId);
};

// Initialize new user with admin defaults (call this when a new user first logs in)
export const initializeNewUserPreferences = async (userId: string): Promise<void> => {
  try {
    // Ensure admin defaults are loaded
    await loadAdminDefaults();
    
    // Get the effective defaults (base + admin overrides)
    const defaults = getDefaultPreferences();
    
    // Save the defaults as the user's initial preferences
    await saveUserPreferences(defaults, userId);
    
  } catch (error) {
    console.error('Failed to initialize new user preferences:', error);
    // Fallback to base defaults
    await saveUserPreferences(BASE_DEFAULT_PREFERENCES, userId);
  }
};

const EMPTY_SEARCH_FILTERS_FOR_CLEAR: UserPreferences['searchFilters'] = {
  text: '',
  dateFrom: '',
  dateTo: '',
  dueDateFrom: '',
  dueDateTo: '',
  selectedMembers: [],
  selectedPriorities: [],
  selectedTags: [],
  selectedProjectIds: [],
  taskId: '',
  linkedTasksOnly: false,
  overdueOnly: false,
  blockedOnly: false,
  selectedSprintIds: [],
  stalledDays: null,
};

/**
 * Apply the same filter reset as "Clear filters" on the hidden-task warning (does not change sprint).
 * Use with saveUserPreferences() for one atomic cookie + DB sync (avoids many racing PUTs).
 */
export const mergeClearedKanbanVisibilityFilters = (base: UserPreferences): UserPreferences => ({
  ...base,
  searchFilters: { ...EMPTY_SEARCH_FILTERS_FOR_CLEAR },
  isSearchActive: false,
  selectedMembers: [],
  includeAssignees: true,
  includeWatchers: false,
  includeCollaborators: false,
  includeRequesters: false,
  currentFilterViewId: null,
});

// Save preferences to cookie and database
export const saveUserPreferences = async (preferences: UserPreferences, userId: string | null = null): Promise<void> => {
  // Set global saving state to block user status polling
  setGlobalSavingState(true);
  const resolvedUserId = resolvePreferencesUserId(userId);
  
  try {
    // Cookie for small prefs; localStorage for per-board maps; then DB when authenticated
    persistLocalPreferences(resolvedUserId, preferences);
    
    // Also save ALL preferences to database if user is authenticated
    if (resolvedUserId) {
      try {
        // Helper function to only save non-undefined values
        // Special case: allow null for selectedSprintId (represents "All Sprints")
        const saveIfDefined = (key: string, value: any) => {
          if (value !== undefined) {
            // Null deletes row on server for these keys
            if (value === null && (key === 'selectedSprintId' || key === 'currentFilterViewId')) {
              return updateUserSetting(key, value);
            }
            if (value !== null) {
              return updateUserSetting(key, value);
            }
          }
          return Promise.resolve(); // Skip undefined values
        };
        
        await Promise.all([
          // Core UI Preferences
          saveIfDefined('taskViewMode', preferences.taskViewMode),
          saveIfDefined('viewMode', preferences.viewMode),
          saveIfDefined('calendarSubView', preferences.calendarSubView),
          saveIfDefined('calendarFocusDate', preferences.calendarFocusDate),
          saveIfDefined('taskDetailsWidth', preferences.taskDetailsWidth),
          saveIfDefined('ganttTaskColumnWidth', preferences.ganttTaskColumnWidth),
          saveIfDefined('ganttDayColumnWidth', preferences.ganttDayColumnWidth),
          saveIfDefined('kanbanColumnWidth', preferences.kanbanColumnWidth),
          
          // App Settings (only save if explicitly set)
          saveIfDefined('taskDeleteConfirm', preferences.appSettings.taskDeleteConfirm),
          saveIfDefined('showActivityFeed', preferences.appSettings.showActivityFeed),
          saveIfDefined('autoRefreshEnabled', preferences.appSettings.autoRefreshEnabled),
          saveIfDefined('showSystemPanel', preferences.appSettings.showSystemPanel),
          saveIfDefined('showBoardToolbar', preferences.appSettings.showBoardToolbar),
          
          // Activity Feed Settings
          saveIfDefined('activityFeedMinimized', preferences.activityFeed.isMinimized),
          saveIfDefined('activityFeedPosition', JSON.stringify(preferences.activityFeed.position)),
          saveIfDefined('activityFeedWidth', preferences.activityFeed.width),
          saveIfDefined('activityFeedHeight', preferences.activityFeed.height),
          saveIfDefined('lastSeenActivityId', preferences.activityFeed.lastSeenActivityId),
          saveIfDefined('clearActivityId', preferences.activityFeed.clearActivityId),
          saveIfDefined('dismissedActivityIds', JSON.stringify(preferences.activityFeed.dismissedActivityIds)),
          saveIfDefined('readActivityIds', JSON.stringify(preferences.activityFeed.readActivityIds)),
          saveIfDefined('activityFilterText', preferences.activityFeed.filterText),
          saveIfDefined('activityFeedTaskImpactView', preferences.activityFeed.taskImpactView),
          
          // List View Column Visibility
          saveIfDefined('listViewColumnVisibility', JSON.stringify(preferences.listViewColumnVisibility)),
          saveIfDefined('listViewColumnWidths', JSON.stringify(preferences.listViewColumnWidths)),
          saveIfDefined('listViewShowDependencies', preferences.listViewShowDependencies),
          saveIfDefined('boardColumnVisibility', JSON.stringify(preferences.boardColumnVisibility)),
          saveIfDefined('calendarColumnVisibility', JSON.stringify(preferences.calendarColumnVisibility)),
          
          // Member Filter Preferences
          saveIfDefined('includeAssignees', preferences.includeAssignees),
          saveIfDefined('showFinishedColumns', preferences.showFinishedColumns),
          saveIfDefined('includeWatchers', preferences.includeWatchers),
          saveIfDefined('includeCollaborators', preferences.includeCollaborators),
          saveIfDefined('includeRequesters', preferences.includeRequesters),
          saveIfDefined('includeSystem', preferences.includeSystem),
          saveIfDefined('showAgentTasks', preferences.showAgentTasks),
          
          // Search State (for cross-device consistency)
          saveIfDefined('isSearchActive', preferences.isSearchActive),
          saveIfDefined('searchFilters', JSON.stringify(preferences.searchFilters)),
          saveIfDefined('isAdvancedSearchExpanded', preferences.isAdvancedSearchExpanded),
          saveIfDefined('lastSelectedBoard', preferences.lastSelectedBoard),
          saveIfDefined('currentFilterViewId', preferences.currentFilterViewId),
          
          // Selected Members (persistent filter)
          saveIfDefined('selectedMembers', JSON.stringify(preferences.selectedMembers)),
          // Personal member chip / Meet-the-team order
          saveIfDefined('memberDisplayOrder', JSON.stringify(preferences.memberDisplayOrder || [])),
          
          // Sprint Selection
          saveIfDefined('selectedSprintId', preferences.selectedSprintId),
          
          // Last Report Tab
          saveIfDefined('lastReportTab', preferences.lastReportTab),
          
          // Gantt Scroll Positions
          saveIfDefined('ganttScrollPositions', JSON.stringify(preferences.ganttScrollPositions)),
          
          // Language Preference
          saveIfDefined('language', preferences.language),
          // Browser IANA timezone for email timestamps
          saveIfDefined('timezone', preferences.timezone),
          // Email notification toggles (server reads these for task emails)
          saveIfDefined(
            'notifications',
            preferences.notifications
              ? JSON.stringify(preferences.notifications)
              : undefined
          ),
        ]);
      } catch (dbError) {
        console.warn('Failed to save preferences to database:', dbError);
        // Don't fail the whole operation if database save fails
      }
    }
  } catch (error) {
    console.error('Failed to save user preferences:', error);
  } finally {
    // Clear global saving state after save completes (success or failure)
    setGlobalSavingState(false);
  }
};

/** Stored payload for this user, migrating (and deleting) a legacy cookie when present. */
const readStoredPreferences = (userId: string | null) => {
  try {
    const raw = localStorage.getItem(getPrefsStorageKey(userId));
    if (raw) {
      // A stale cookie may still exist from before the move to localStorage
      deleteLegacyPreferenceCookie(getUserCookieName(userId));
      return JSON.parse(raw);
    }
  } catch {
    // fall through to the legacy cookie
  }

  const legacy = readLegacyPreferenceCookie(userId);
  if (legacy && typeof legacy === 'object') {
    try {
      localStorage.setItem(getPrefsStorageKey(userId), JSON.stringify(legacy));
    } catch {
      // ignore quota / private-mode failures
    }
    return legacy;
  }
  return null;
};

// Load preferences from localStorage (payload + bulky per-board maps)
const readLocalPreferences = (userId: string | null = null): UserPreferences => {
  try {
    const bulkyLocal = readBulkyPreferencesLocal(userId);
    const loadedPrefs = readStoredPreferences(userId);

    if (loadedPrefs) {
      // Merge with defaults to handle missing properties in older payloads.
      // Ignore stored copies of bulky maps — their own entry is the source.
      const defaults = getDefaultPreferences();
      return {
        ...defaults,
        ...loadedPrefs,
        taskViewMode: normalizeTaskViewMode(loadedPrefs.taskViewMode ?? defaults.taskViewMode),
        calendarSubView: normalizeCalendarSubView(
          loadedPrefs.calendarSubView ?? defaults.calendarSubView
        ),
        boardColumnVisibility: {
          ...defaults.boardColumnVisibility,
          ...bulkyLocal.boardColumnVisibility
        },
        calendarColumnVisibility: {
          ...defaults.calendarColumnVisibility,
          ...bulkyLocal.calendarColumnVisibility
        },
        listViewColumnVisibility: {
          ...defaults.listViewColumnVisibility,
          ...loadedPrefs.listViewColumnVisibility
        },
        listViewColumnWidths: {
          ...defaults.listViewColumnWidths,
          ...bulkyLocal.listViewColumnWidths
        },
        ganttScrollPositions: {
          ...defaults.ganttScrollPositions,
          ...bulkyLocal.ganttScrollPositions
        },
        searchFilters: (() => {
          const merged = {
            ...defaults.searchFilters,
            ...loadedPrefs.searchFilters,
            text: loadedPrefs.searchFilters?.text || '',
            selectedProjectIds: Array.isArray(loadedPrefs.searchFilters?.selectedProjectIds)
              ? loadedPrefs.searchFilters.selectedProjectIds
              : loadedPrefs.searchFilters?.projectId?.trim()
                ? [loadedPrefs.searchFilters.projectId.trim()]
                : [],
            taskId: loadedPrefs.searchFilters?.taskId || '',
            linkedTasksOnly: loadedPrefs.searchFilters?.linkedTasksOnly === true,
            overdueOnly: loadedPrefs.searchFilters?.overdueOnly === true,
            blockedOnly: loadedPrefs.searchFilters?.blockedOnly === true,
            selectedSprintIds: Array.isArray(loadedPrefs.searchFilters?.selectedSprintIds)
              ? loadedPrefs.searchFilters.selectedSprintIds
              : [],
            stalledDays:
              loadedPrefs.searchFilters?.stalledDays != null &&
              loadedPrefs.searchFilters.stalledDays !== '' &&
              Number(loadedPrefs.searchFilters.stalledDays) > 0
                ? Number(loadedPrefs.searchFilters.stalledDays)
                : null,
          };
          try {
            if (
              merged.linkedTasksOnly !== true &&
              localStorage.getItem('ek_highlight_links_mode') === 'true'
            ) {
              merged.linkedTasksOnly = true;
              localStorage.removeItem('ek_highlight_links_mode');
            }
          } catch {
            // ignore private mode / quota
          }
          return merged;
        })(),
        appSettings: {
          ...defaults.appSettings,
          ...loadedPrefs.appSettings
        },
        notifications: {
          ...defaults.notifications,
          ...loadedPrefs.notifications
        },
        taskPageCollapsed: {
          ...defaults.taskPageCollapsed,
          ...loadedPrefs.taskPageCollapsed
        },
        activityFeed: {
          ...defaults.activityFeed,
          ...loadedPrefs.activityFeed
        }
      };
    }

    // Nothing stored yet — still apply localStorage bulky maps over defaults
    const defaults = getDefaultPreferences();
    return {
      ...defaults,
      boardColumnVisibility: {
        ...defaults.boardColumnVisibility,
        ...bulkyLocal.boardColumnVisibility
      },
      calendarColumnVisibility: {
        ...defaults.calendarColumnVisibility,
        ...bulkyLocal.calendarColumnVisibility
      },
      listViewColumnWidths: {
        ...defaults.listViewColumnWidths,
        ...bulkyLocal.listViewColumnWidths
      },
      ganttScrollPositions: {
        ...defaults.ganttScrollPositions,
        ...bulkyLocal.ganttScrollPositions
      }
    };
  } catch (error) {
    console.error('Failed to load user preferences:', error);
  }
  
  return getDefaultPreferences();
};

/** Preferences for a user: database-merged values when available, cookie values otherwise. */
export const loadUserPreferences = (userId: string | null = null): UserPreferences =>
  getEffectiveUserPreferences(userId);

// Helper function to check if a cookie preference is "default" (not customized by user)
const isDefaultValue = (cookieValue: any, defaultValue: any): boolean => {
  // For objects, do deep comparison
  if (typeof cookieValue === 'object' && typeof defaultValue === 'object') {
    return JSON.stringify(cookieValue) === JSON.stringify(defaultValue);
  }
  // For primitives, direct comparison
  return cookieValue === defaultValue;
};

// Load preferences from cookie and database (for authenticated users)
export const loadUserPreferencesAsync = async (userId: string | null = null): Promise<UserPreferences> => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  // Tenant admin defaults must be available before merge (all users)
  try {
    await loadAdminDefaults();
  } catch {
    // keep base defaults
  }
  // Start with cookie + localStorage preferences
  let preferences = loadUserPreferences(resolvedUserId);
  let needsStoredPrefsUpdate = false;
  let needsLocalStorageUpdate = false;
  
  // If user is authenticated, also load database settings and merge them intelligently
  if (resolvedUserId) {
    try {
      const dbSettings = await getUserSettings();
      
      // Smart merge: Only use database value if local is at default value AND database has a non-default value
      const smartMerge = (localValue: any, dbValue: any, defaultValue: any, allowNull: boolean = false) => {
        // If local is customized (not default), keep local value
        if (!isDefaultValue(localValue, defaultValue)) {
          return localValue;
        }
        // If local is default but database has a value, use database value
        // Special case: allow null for sprint selection (represents "All Sprints")
        if (dbValue !== undefined && ((allowNull && dbValue === null) || (dbValue !== null && !isDefaultValue(dbValue, defaultValue)))) {
          needsStoredPrefsUpdate = true;
          return dbValue;
        }
        // Otherwise keep local value
        return localValue;
      };

      /** Same as smartMerge, but DB wins write back to localStorage (not the cookie). */
      const smartMergeBulky = (localValue: any, dbValue: any, defaultValue: any) => {
        if (!isDefaultValue(localValue, defaultValue)) {
          return localValue;
        }
        if (dbValue !== undefined && dbValue !== null && !isDefaultValue(dbValue, defaultValue)) {
          needsLocalStorageUpdate = true;
          return { ...defaultValue, ...dbValue };
        }
        return localValue;
      };
      
      // Apply smart merging to all preferences
      const defaults = getDefaultPreferences();
      preferences = {
        ...preferences,
        
        // Core UI Preferences
        taskViewMode: normalizeTaskViewMode(
          smartMerge(preferences.taskViewMode, dbSettings.taskViewMode, defaults.taskViewMode)
        ),
        viewMode: smartMerge(preferences.viewMode, dbSettings.viewMode, defaults.viewMode),
        calendarSubView: normalizeCalendarSubView(
          smartMerge(
            preferences.calendarSubView,
            dbSettings.calendarSubView,
            defaults.calendarSubView
          )
        ),
        calendarFocusDate: smartMerge(
          preferences.calendarFocusDate,
          dbSettings.calendarFocusDate,
          defaults.calendarFocusDate
        ),
        taskDetailsWidth: smartMerge(preferences.taskDetailsWidth, dbSettings.taskDetailsWidth, defaults.taskDetailsWidth),
        ganttTaskColumnWidth: smartMerge(preferences.ganttTaskColumnWidth, dbSettings.ganttTaskColumnWidth, defaults.ganttTaskColumnWidth),
        ganttDayColumnWidth: smartMerge(preferences.ganttDayColumnWidth, dbSettings.ganttDayColumnWidth, defaults.ganttDayColumnWidth),
        kanbanColumnWidth: smartMerge(preferences.kanbanColumnWidth, dbSettings.kanbanColumnWidth, defaults.kanbanColumnWidth),
        
        // Member Filter Preferences  
        includeAssignees: smartMerge(preferences.includeAssignees, dbSettings.includeAssignees, defaults.includeAssignees),
        showFinishedColumns: smartMerge(preferences.showFinishedColumns, dbSettings.showFinishedColumns, defaults.showFinishedColumns),
        includeWatchers: smartMerge(preferences.includeWatchers, dbSettings.includeWatchers, defaults.includeWatchers),
        includeCollaborators: smartMerge(preferences.includeCollaborators, dbSettings.includeCollaborators, defaults.includeCollaborators),
        includeRequesters: smartMerge(preferences.includeRequesters, dbSettings.includeRequesters, defaults.includeRequesters),
        includeSystem: smartMerge(preferences.includeSystem, dbSettings.includeSystem, defaults.includeSystem),
        showAgentTasks: smartMerge(preferences.showAgentTasks, dbSettings.showAgentTasks, defaults.showAgentTasks),
        
        // Search State
        isAdvancedSearchExpanded: smartMerge(preferences.isAdvancedSearchExpanded, dbSettings.isAdvancedSearchExpanded, defaults.isAdvancedSearchExpanded),
        lastSelectedBoard: smartMerge(preferences.lastSelectedBoard, dbSettings.lastSelectedBoard, defaults.lastSelectedBoard),
        selectedMembers: smartMerge(preferences.selectedMembers, dbSettings.selectedMembers ? JSON.parse(dbSettings.selectedMembers) : undefined, defaults.selectedMembers),

        memberDisplayOrder: (() => {
          let dbOrder: string[] | undefined;
          try {
            const raw = dbSettings.memberDisplayOrder;
            if (raw == null || raw === '') dbOrder = undefined;
            else if (Array.isArray(raw)) dbOrder = raw as string[];
            else dbOrder = JSON.parse(String(raw));
          } catch {
            dbOrder = undefined;
          }
          return smartMerge(
            preferences.memberDisplayOrder || [],
            dbOrder,
            defaults.memberDisplayOrder
          );
        })(),
        
        // Sprint Selection (allow null to represent "All Sprints")
        selectedSprintId: smartMerge(preferences.selectedSprintId, dbSettings.selectedSprintId, defaults.selectedSprintId, true),
        
        // Last Report Tab
        lastReportTab: smartMerge(preferences.lastReportTab, dbSettings.lastReportTab, defaults.lastReportTab),
        
        // Language Preference — DB is source of truth when set (incl. explicit "en")
        language: (() => {
          const dbLang = typeof dbSettings.language === 'string'
            ? dbSettings.language
            : undefined;
          if (dbLang === 'en' || dbLang === 'fr') {
            if (preferences.language !== dbLang) {
              needsStoredPrefsUpdate = true;
            }
            return dbLang;
          }
          return preferences.language || defaults.language;
        })(),
        timezone: smartMerge(preferences.timezone, dbSettings.timezone, defaults.timezone),

        // Email notification prefs (must round-trip to DB — server uses these for mail)
        notifications: (() => {
          let dbNotifs: UserPreferences['notifications'] | undefined;
          try {
            const raw = dbSettings.notifications;
            if (raw == null || raw === '') {
              dbNotifs = undefined;
            } else if (typeof raw === 'object') {
              dbNotifs = raw as UserPreferences['notifications'];
            } else {
              dbNotifs = JSON.parse(String(raw));
            }
          } catch {
            dbNotifs = undefined;
          }

          const local = preferences.notifications || defaults.notifications;
          const localCustomized = Object.keys(defaults.notifications).some(
            (k) =>
              local[k as keyof typeof local] !==
              defaults.notifications[k as keyof typeof defaults.notifications]
          );
          if (localCustomized) {
            const merged = { ...defaults.notifications, ...local };
            // Cookie had prefs that never reached the server — sync once
            if (!dbNotifs) {
              void updateUserSetting('notifications', JSON.stringify(merged)).catch(() => {});
            }
            return merged;
          }
          if (dbNotifs && typeof dbNotifs === 'object') {
            needsStoredPrefsUpdate = true;
            return { ...defaults.notifications, ...dbNotifs };
          }
          return { ...defaults.notifications, ...local };
        })(),
        
        // List View Column Visibility (special handling for object)
        listViewColumnVisibility: (() => {
          const cookieColumns = preferences.listViewColumnVisibility;
          const dbColumns = dbSettings.listViewColumnVisibility ? JSON.parse(dbSettings.listViewColumnVisibility) : undefined;
          
          if (!isDefaultValue(cookieColumns, defaults.listViewColumnVisibility)) {
            return cookieColumns; // Cookie is customized, keep it
          }
          if (dbColumns && !isDefaultValue(dbColumns, defaults.listViewColumnVisibility)) {
            needsStoredPrefsUpdate = true;
            return { ...defaults.listViewColumnVisibility, ...dbColumns }; // Use database
          }
          return cookieColumns; // Keep cookie
        })(),

        listViewShowDependencies: smartMerge(
          preferences.listViewShowDependencies,
          dbSettings.listViewShowDependencies,
          defaults.listViewShowDependencies
        ),

        listViewColumnWidths: (() => {
          let dbWidths: ListViewColumnWidthsByBoard | undefined;
          try {
            dbWidths = dbSettings.listViewColumnWidths
              ? JSON.parse(dbSettings.listViewColumnWidths)
              : undefined;
          } catch {
            dbWidths = undefined;
          }
          return smartMergeBulky(
            preferences.listViewColumnWidths || {},
            dbWidths,
            defaults.listViewColumnWidths
          );
        })(),

        boardColumnVisibility: (() => {
          let dbVis: { [boardId: string]: string[] } | undefined;
          try {
            dbVis = dbSettings.boardColumnVisibility
              ? JSON.parse(dbSettings.boardColumnVisibility)
              : undefined;
          } catch {
            dbVis = undefined;
          }
          return smartMergeBulky(
            preferences.boardColumnVisibility || {},
            dbVis,
            defaults.boardColumnVisibility
          );
        })(),

        calendarColumnVisibility: (() => {
          let dbVis: { [boardId: string]: string[] } | undefined;
          try {
            dbVis = dbSettings.calendarColumnVisibility
              ? JSON.parse(dbSettings.calendarColumnVisibility)
              : undefined;
          } catch {
            dbVis = undefined;
          }
          return smartMergeBulky(
            preferences.calendarColumnVisibility || {},
            dbVis,
            defaults.calendarColumnVisibility
          );
        })(),
        
        // App Settings
        appSettings: {
          ...preferences.appSettings,
          taskDeleteConfirm: smartMerge(preferences.appSettings.taskDeleteConfirm, dbSettings.taskDeleteConfirm, defaults.appSettings.taskDeleteConfirm),
          showActivityFeed: smartMerge(preferences.appSettings.showActivityFeed, dbSettings.showActivityFeed, defaults.appSettings.showActivityFeed),
          autoRefreshEnabled: smartMerge(preferences.appSettings.autoRefreshEnabled, dbSettings.autoRefreshEnabled, defaults.appSettings.autoRefreshEnabled),
          showSystemPanel: smartMerge(preferences.appSettings.showSystemPanel, dbSettings.showSystemPanel, defaults.appSettings.showSystemPanel),
          showBoardToolbar: smartMerge(preferences.appSettings.showBoardToolbar, dbSettings.showBoardToolbar, defaults.appSettings.showBoardToolbar)
        },
        
        // Activity Feed Settings
        activityFeed: {
          ...preferences.activityFeed,
          isMinimized: (() => {
            const coerceBool = (v: unknown): boolean | undefined => {
              if (v === undefined || v === null) return undefined;
              if (v === true || v === 'true' || v === 1 || v === '1') return true;
              if (v === false || v === 'false' || v === 0 || v === '0') return false;
              return undefined;
            };
            // Prefer DB when present so refresh restores minimized chrome correctly
            const fromDb = coerceBool(dbSettings.activityFeedMinimized);
            if (fromDb !== undefined) {
              if (fromDb !== preferences.activityFeed.isMinimized) {
                needsStoredPrefsUpdate = true;
              }
              return fromDb;
            }
            return preferences.activityFeed.isMinimized === true;
          })(),
          position: (() => {
            let dbPos: { x: number; y: number } | undefined;
            try {
              dbPos = dbSettings.activityFeedPosition
                ? JSON.parse(dbSettings.activityFeedPosition)
                : undefined;
            } catch {
              dbPos = undefined;
            }
            return smartMerge(
              preferences.activityFeed.position,
              dbPos,
              defaults.activityFeed.position
            );
          })(),
          // Validate and clamp width to valid range (120-600px) to prevent corrupted values
          width: (() => {
            const mergedWidth = smartMerge(preferences.activityFeed.width, dbSettings.activityFeedWidth, defaults.activityFeed.width);
            return Math.max(120, Math.min(600, Number(mergedWidth) || defaults.activityFeed.width));
          })(),
          height: (() => {
            const mergedHeight = smartMerge(preferences.activityFeed.height, dbSettings.activityFeedHeight, defaults.activityFeed.height);
            return Math.max(200, Math.min(800, Number(mergedHeight) || defaults.activityFeed.height));
          })(),
          lastSeenActivityId: smartMerge(preferences.activityFeed.lastSeenActivityId, dbSettings.lastSeenActivityId, defaults.activityFeed.lastSeenActivityId),
          clearActivityId: smartMerge(preferences.activityFeed.clearActivityId, dbSettings.clearActivityId, defaults.activityFeed.clearActivityId),
          dismissedActivityIds: (() => {
            const parseIds = (raw: unknown): number[] => {
              if (Array.isArray(raw)) {
                return raw.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
              }
              if (typeof raw === 'string' && raw.trim()) {
                try {
                  return parseIds(JSON.parse(raw));
                } catch {
                  return [];
                }
              }
              return [];
            };
            const fromDb = parseIds(dbSettings.dismissedActivityIds);
            const fromLocal = parseIds(preferences.activityFeed.dismissedActivityIds);
            const merged = fromDb.length > 0 ? fromDb : fromLocal.length > 0 ? fromLocal : defaults.activityFeed.dismissedActivityIds;
            const clearId = Number(smartMerge(preferences.activityFeed.clearActivityId, dbSettings.clearActivityId, defaults.activityFeed.clearActivityId)) || 0;
            return merged.filter((id) => id > clearId);
          })(),
          readActivityIds: (() => {
            const parseIds = (raw: unknown): number[] => {
              if (Array.isArray(raw)) {
                return raw.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
              }
              if (typeof raw === 'string' && raw.trim()) {
                try {
                  return parseIds(JSON.parse(raw));
                } catch {
                  return [];
                }
              }
              return [];
            };
            const fromDb = parseIds(dbSettings.readActivityIds);
            const fromLocal = parseIds(preferences.activityFeed.readActivityIds);
            const merged = fromDb.length > 0 ? fromDb : fromLocal.length > 0 ? fromLocal : defaults.activityFeed.readActivityIds;
            const lastSeen = Number(smartMerge(preferences.activityFeed.lastSeenActivityId, dbSettings.lastSeenActivityId, defaults.activityFeed.lastSeenActivityId)) || 0;
            const clearId = Number(smartMerge(preferences.activityFeed.clearActivityId, dbSettings.clearActivityId, defaults.activityFeed.clearActivityId)) || 0;
            return merged.filter((id) => id > lastSeen && id > clearId);
          })(),
          filterText: smartMerge(preferences.activityFeed.filterText, dbSettings.activityFilterText, defaults.activityFeed.filterText),
          taskImpactView: (() => {
            const fromDb = dbSettings.activityFeedTaskImpactView;
            const localValue = preferences.activityFeed.taskImpactView;
            if (fromDb === 'true' || fromDb === true) {
              if (localValue !== true) needsStoredPrefsUpdate = true;
              return true;
            }
            if (fromDb === 'false' || fromDb === false) {
              if (localValue !== false) needsStoredPrefsUpdate = true;
              return false;
            }
            if (localValue !== undefined) {
              return localValue !== false;
            }
            return defaults.activityFeed.taskImpactView !== false;
          })(),
        },
        
        // Gantt Scroll Positions (localStorage + DB)
        ganttScrollPositions: (() => {
          let dbScrollPositions: UserPreferences['ganttScrollPositions'] | undefined;
          try {
            dbScrollPositions = dbSettings.ganttScrollPositions
              ? JSON.parse(dbSettings.ganttScrollPositions)
              : undefined;
          } catch {
            dbScrollPositions = undefined;
          }
          return smartMergeBulky(
            preferences.ganttScrollPositions || {},
            dbScrollPositions,
            defaults.ganttScrollPositions
          );
        })()
      };

      // One-time layout migration: right-edge signed X (v2). Resets stored positions
      // after server clears activityFeedPosition and updates defaults.
      try {
        const {
          ACTIVITY_FEED_LAYOUT_VERSION,
          activityFeedLayoutVersionKey,
          normalizeStoredActivityFeedPosition,
          DEFAULT_ACTIVITY_FEED_STORED_POSITION,
        } = await import('./activityFeedPosition');
        const layoutKey = activityFeedLayoutVersionKey(resolvedUserId);
        const currentLayout = Number(localStorage.getItem(layoutKey) || '1');
        if (currentLayout < ACTIVITY_FEED_LAYOUT_VERSION) {
          preferences.activityFeed = {
            ...preferences.activityFeed,
            position: normalizeStoredActivityFeedPosition(
              defaults.activityFeed.position,
              DEFAULT_ACTIVITY_FEED_STORED_POSITION
            ),
          };
          localStorage.setItem(layoutKey, String(ACTIVITY_FEED_LAYOUT_VERSION));
          needsStoredPrefsUpdate = true;
          try {
            const { updateUserSetting } = await import('../api');
            await updateUserSetting(
              'activityFeedPosition',
              JSON.stringify(preferences.activityFeed.position)
            );
          } catch (e) {
            console.warn('Failed to persist migrated activity feed position:', e);
          }
        }
      } catch (e) {
        console.warn('Activity feed layout migration skipped:', e);
      }
      
      // Persist merged values back to the appropriate client stores
      if (needsStoredPrefsUpdate) {
        writeStoredPreferences(resolvedUserId, preferences);
      }
      if (needsLocalStorageUpdate) {
        writeBulkyPreferencesLocal(resolvedUserId, preferences);
      }
      
    } catch (error) {
      console.warn('Failed to load database settings, using cookie preferences only:', error);
    }
  }
  
  setCachedPreferences(resolvedUserId, preferences);

  // Keep email timestamps accurate: sync browser IANA timezone when it changes
  if (resolvedUserId) {
    void syncBrowserTimeZone(resolvedUserId, preferences);
  }

  return preferences;
};

/** Detect the browser's IANA timezone (e.g. America/Toronto). */
export const detectBrowserTimeZone = (): string | null => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && typeof tz === 'string' ? tz : null;
  } catch {
    return null;
  }
};

/**
 * Persist browser timezone to user_settings when missing or changed.
 * Used so notification emails can format Date/Time in the recipient's local zone.
 */
export const syncBrowserTimeZone = async (
  userId: string | null,
  currentPrefs?: UserPreferences
): Promise<void> => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  if (!resolvedUserId) return;

  const detected = detectBrowserTimeZone();
  if (!detected) return;

  const prefs = currentPrefs || getEffectiveUserPreferences(resolvedUserId);
  if (prefs.timezone === detected) return;

  try {
    await updateUserPreference('timezone', detected, resolvedUserId);
  } catch (error) {
    console.warn('Failed to sync browser timezone:', error);
  }
};

// Update specific preference
export const updateUserPreference = async <K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
  userId: string | null = null
): Promise<void> => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  const currentPrefs = getEffectiveUserPreferences(resolvedUserId);
  const updatedPrefs = { ...currentPrefs, [key]: value };
  
  // Update cookie + localStorage immediately (synchronous, fast)
  persistLocalPreferences(resolvedUserId, updatedPrefs);
  
  // Save ONLY this specific preference to database (single API call instead of 30+)
  if (resolvedUserId) {
    try {
      // Map preference keys to database setting keys
      // For nested keys like appSettings, we need to handle them specially
      let dbKey: string | undefined;
      let dbValue: any = value;
      
      // Handle top-level keys
      const topLevelKeyMap: Record<string, string> = {
        'taskViewMode': 'taskViewMode',
        'viewMode': 'viewMode',
        'calendarSubView': 'calendarSubView',
        'calendarFocusDate': 'calendarFocusDate',
        'taskDetailsWidth': 'taskDetailsWidth',
        'ganttTaskColumnWidth': 'ganttTaskColumnWidth',
        'ganttDayColumnWidth': 'ganttDayColumnWidth',
        'kanbanColumnWidth': 'kanbanColumnWidth',
        'isSearchActive': 'isSearchActive',
        'isAdvancedSearchExpanded': 'isAdvancedSearchExpanded',
        'lastSelectedBoard': 'lastSelectedBoard',
        'selectedMembers': 'selectedMembers',
        'memberDisplayOrder': 'memberDisplayOrder',
        'selectedSprintId': 'selectedSprintId',
        'currentFilterViewId': 'currentFilterViewId',
        'lastReportTab': 'lastReportTab',
        'includeAssignees': 'includeAssignees',
        'showFinishedColumns': 'showFinishedColumns',
        'includeWatchers': 'includeWatchers',
        'includeCollaborators': 'includeCollaborators',
        'includeRequesters': 'includeRequesters',
        'includeSystem': 'includeSystem',
        'showAgentTasks': 'showAgentTasks',
        'searchFilters': 'searchFilters',
        'listViewColumnVisibility': 'listViewColumnVisibility',
        'listViewColumnWidths': 'listViewColumnWidths',
        'listViewShowDependencies': 'listViewShowDependencies',
        'boardColumnVisibility': 'boardColumnVisibility',
        'calendarColumnVisibility': 'calendarColumnVisibility',
        'ganttScrollPositions': 'ganttScrollPositions',
        'language': 'language',
        'timezone': 'timezone',
        'notifications': 'notifications',
      };
      
      dbKey = topLevelKeyMap[key as string];
      
      // Note: appSettings keys are handled separately via updateActivityFeedPreference pattern
      // If we need to support appSettings here, we'd need to check the key structure differently
      
      if (!dbKey) {
        // If no mapping found, fall back to saving all preferences (for backwards compatibility)
        await saveUserPreferences(updatedPrefs, resolvedUserId);
        return;
      }
      
      // Special handling for JSON-serialized values
      if (
        dbKey === 'selectedMembers' ||
        dbKey === 'memberDisplayOrder' ||
        dbKey === 'listViewColumnVisibility' ||
        dbKey === 'listViewColumnWidths' ||
        dbKey === 'boardColumnVisibility' ||
        dbKey === 'calendarColumnVisibility' ||
        dbKey === 'ganttScrollPositions' ||
        dbKey === 'searchFilters' ||
        dbKey === 'notifications'
      ) {
        dbValue = typeof value === 'string' ? value : JSON.stringify(value);
      }
      
      // Null deletes row on server for these keys
      if ((dbKey === 'selectedSprintId' || dbKey === 'currentFilterViewId') && value === null) {
        await updateUserSetting(dbKey, null);
      } else if (value !== null && value !== undefined) {
        await updateUserSetting(dbKey, dbValue);
      }
    } catch (error) {
      console.warn('Failed to save single preference to database, falling back to full save:', error);
      // Fallback to saving all preferences if single save fails
      await saveUserPreferences(updatedPrefs, resolvedUserId);
    }
  }
};

/** Atomically persist search filter state + active saved view id (avoids apply/clear races). */
export const patchSearchFilterApplyState = async (
  searchFilters: UserPreferences['searchFilters'],
  currentFilterViewId: number | null,
  userId: string | null = null,
): Promise<void> => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  const currentPrefs = getEffectiveUserPreferences(resolvedUserId);
  const updatedPrefs: UserPreferences = {
    ...currentPrefs,
    searchFilters,
    currentFilterViewId,
  };
  persistLocalPreferences(resolvedUserId, updatedPrefs);

  if (!resolvedUserId) return;

  try {
    await updateUserSetting('searchFilters', JSON.stringify(searchFilters));
    if (currentFilterViewId == null) {
      await updateUserSetting('currentFilterViewId', null);
    } else {
      await updateUserSetting('currentFilterViewId', currentFilterViewId);
    }
  } catch (error) {
    console.warn('Failed to patch saved filter apply state, falling back to full save:', error);
    await saveUserPreferences(updatedPrefs, resolvedUserId);
  }
};

// Helper function to update activity feed specific settings
export const updateActivityFeedPreference = async <K extends keyof UserPreferences['activityFeed']>(
  key: K,
  value: UserPreferences['activityFeed'][K],
  userId: string | null = null
): Promise<void> => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  const currentPrefs = getEffectiveUserPreferences(resolvedUserId);
  const updatedPrefs = {
    ...currentPrefs,
    activityFeed: {
      ...currentPrefs.activityFeed,
      [key]: value
    }
  };
  
  // Update cookie + localStorage immediately (synchronous, fast)
  persistLocalPreferences(resolvedUserId, updatedPrefs);
  
  // Map activity feed keys to database setting keys
  const dbKeyMap: Record<string, string> = {
    'isMinimized': 'activityFeedMinimized',
    'position': 'activityFeedPosition',
    'width': 'activityFeedWidth',
    'height': 'activityFeedHeight',
    'lastSeenActivityId': 'lastSeenActivityId',
    'clearActivityId': 'clearActivityId',
    'dismissedActivityIds': 'dismissedActivityIds',
    'readActivityIds': 'readActivityIds',
    'filterText': 'activityFilterText',
    'taskImpactView': 'activityFeedTaskImpactView'
  };
  
  const dbKey = dbKeyMap[key];
  if (!dbKey) {
    console.error(`Unknown activity feed preference key: ${String(key)}`);
    return;
  }
  
  // Save ONLY this specific setting to database (single API call instead of 30+)
  let dbValue: any = value;
  if (key === 'position' || key === 'dismissedActivityIds' || key === 'readActivityIds') {
    dbValue = JSON.stringify(value);
  } else if (key === 'taskImpactView') {
    dbValue = value ? 'true' : 'false';
  }
  
  await updateUserSetting(dbKey, dbValue);
};

// Helper function to update appSettings specific settings
export const updateAppSettingsPreference = async <K extends keyof UserPreferences['appSettings']>(
  key: K,
  value: UserPreferences['appSettings'][K],
  userId: string | null = null
): Promise<void> => {
  const resolvedUserId = resolvePreferencesUserId(userId);
  const currentPrefs = getEffectiveUserPreferences(resolvedUserId);
  const updatedPrefs = {
    ...currentPrefs,
    appSettings: {
      ...currentPrefs.appSettings,
      [key]: value
    }
  };
  
  // Update cookie + localStorage immediately (synchronous, fast)
  persistLocalPreferences(resolvedUserId, updatedPrefs);
  
  // Map appSettings keys to database setting keys
  const dbKeyMap: Record<string, string> = {
    'taskDeleteConfirm': 'taskDeleteConfirm',
    'showActivityFeed': 'showActivityFeed',
    'autoRefreshEnabled': 'autoRefreshEnabled',
    'showSystemPanel': 'showSystemPanel',
    'showBoardToolbar': 'showBoardToolbar',
  };
  
  const dbKey = dbKeyMap[key];
  if (!dbKey) {
    console.error(`Unknown appSettings preference key: ${String(key)}`);
    return;
  }
  
  // Save ONLY this specific setting to database (single API call instead of 30+)
  await updateUserSetting(dbKey, value);
};

// Get effective task delete confirmation setting (user preference with system fallback)
export const getTaskDeleteConfirmSetting = (
  userPreferences: UserPreferences,
  systemSettings: { TASK_DELETE_CONFIRM?: string }
): boolean => {
  // If user has explicitly set a preference, use that
  if (userPreferences.appSettings.taskDeleteConfirm !== undefined) {
    return userPreferences.appSettings.taskDeleteConfirm;
  }
  
  // Otherwise, use system default (true if not set or if set to 'true')
  return systemSettings.TASK_DELETE_CONFIRM !== 'false';
};
