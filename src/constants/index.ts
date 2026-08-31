export {
  AGILA_GITHUB_CLONE_URL,
  AGILA_GITHUB_IDEAS_URL,
  AGILA_GITHUB_ISSUES_URL,
  AGILA_GITHUB_OWNER,
  AGILA_GITHUB_REPO,
  AGILA_GITHUB_URL,
  agilaGithubFeedbackUrls,
} from './brand';

// Application constants
export const DEFAULT_COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'progress', title: 'In Progress' },
  { id: 'testing', title: 'Testing' },
  { id: 'completed', title: 'Completed' },
  { id: 'archive', title: 'Archive' }
];

// Page and navigation constants
export const PAGE_IDENTIFIERS = ['kanban', 'calendar', 'admin', 'reports', 'task', 'forgot-password', 'reset-password', 'reset-success', 'activate-account'];
/** Hash routes used only while signed out — never treat as board IDs. */
export const AUTH_HASH_ROUTES = ['login'];
export const ADMIN_TABS = [
  'users',
  'site-settings',
  'system-settings',
  'notifications',
  'tags',
  'priorities',
  'app-settings',
  'project-settings',
  'licensing',
];
export const REPORT_TABS = ['stats', 'leaderboard', 'burndown', 'team', 'tasks'];

// Routing configuration
export const ROUTES = {
  // Pages that don't require authentication
  PUBLIC_PAGES: ['forgot-password', 'reset-password', 'reset-success', 'activate-account'],
  // Pages that require authentication
  PROTECTED_PAGES: ['kanban', 'calendar', 'admin', 'reports', 'task'],
  // Pages that should skip auto-board-selection
  NO_AUTO_BOARD: ['forgot-password', 'reset-password', 'reset-success', 'activate-account', 'admin', 'reports', 'task'],
  // Default routes
  DEFAULT_PAGE: 'kanban',
  DEFAULT_ADMIN_TAB: 'users',
  DEFAULT_REPORT_TAB: 'burndown'
} as const;

// Default site settings
export const DEFAULT_SITE_SETTINGS = {
  SITE_NAME: '',
  SITE_URL: '/'
};

/** Built-in brand mark when SITE_LOGO is empty / cleared */
export const DEFAULT_SITE_LOGO = '/agila-logo.png';
/** Built-in brand mark for dark UI when SITE_LOGO_DARK is empty / cleared */
export const DEFAULT_SITE_LOGO_DARK = '/agila-logo-dark.png';
/** Browser tab icon (index.html + any runtime favicon updates). Dev server uses a teal DEV badge. */
export const DEFAULT_FAVICON = import.meta.env.DEV
  ? '/agila-favicon-dev.png'
  : '/agila-favicon.png';

/** Public static brand paths — do not rewrite through avatar media auth */
export function isPublicBrandAssetPath(value: string): boolean {
  return (
    value.startsWith('/agila') ||
    value.startsWith('/kanban') || // legacy default (kanban.ico)
    value.startsWith('/assets/')
  );
}

// Polling configuration
export const POLLING_INTERVAL = 15000; // 15 seconds (backup only, WebSocket handles real-time)
export const DRAG_COOLDOWN_DURATION = 5000; // 5 seconds
export const TASK_CREATION_PAUSE_DURATION = 3000; // 3 seconds - increased to prevent race conditions
export const BOARD_CREATION_PAUSE_DURATION = 1000; // 1 second

// JWT configuration
export const JWT_EXPIRES_IN = '24h';

// Drag and drop configuration
export const DND_ACTIVATION_DISTANCE = 3; // 3px for responsive drag start

// Grid layout configuration
export const MAX_GRID_COLUMNS = 6;
export const MIN_COLUMN_WIDTH = 300; // pixels
export const GRID_GAP = '1.5rem';
