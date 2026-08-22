import { PAGE_IDENTIFIERS, ADMIN_TABS, AUTH_HASH_ROUTES, ROUTES } from '../constants';

export interface ParsedRoute {
  mainRoute: string;
  subRoute: string | null;
  queryParams: URLSearchParams;
  isPage: boolean;
  isAdminTab: boolean;
  isBoardId: boolean;
  isProjectRoute: boolean;
  isTaskRoute: boolean;
  projectId?: string;
  taskId?: string;
}

/**
 * Parse project route from full URL (handles /project/#PROJ-00001 format)
 */
export const parseProjectRoute = (url: string = window.location.href): { isProjectRoute: boolean; projectId?: string } => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    let hash = urlObj.hash;
    
    // Decode %23 back to # (email clients may encode # to %23)
    hash = hash.replace(/%23/g, '#');
    
    // Check if path is /project/ and hash contains project ID
    if (pathname === '/project/' && hash) {
      const projectId = hash.replace(/^#/, ''); // Remove leading #
      // Validate project ID format (PROJ-00000 or similar)
      if (/^[A-Z]+-\d+$/i.test(projectId)) {
        return { isProjectRoute: true, projectId };
      }
    }
    
    return { isProjectRoute: false };
  } catch (error) {
    return { isProjectRoute: false };
  }
};

/**
 * Parse task route from full URL (handles /task/#TASK-00001 and /project/#PROJ-00001/#TASK-00001 formats)
 */
export const parseTaskRoute = (url: string = window.location.href): { isTaskRoute: boolean; taskId?: string; projectId?: string } => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    let hash = urlObj.hash;
    
    if (!hash) return { isTaskRoute: false };
    
    // Decode %23 back to # (email clients may encode # to %23)
    hash = hash.replace(/%23/g, '#');
    
    const cleanHash = hash.replace(/^#/, '');
    const hashParts = cleanHash.split('#');
    
    // Handle /task/#TASK-00001 format
    if (pathname === '/task/' || pathname === '/task') {
      if (hashParts.length === 1) {
        const taskId = hashParts[0];
        if (/^[A-Z]+-\d+$/i.test(taskId)) {
          return { isTaskRoute: true, taskId };
        }
      }
    }
    
    // Handle /project/#PROJ-00001/#TASK-00001 format (with or without trailing slash)
    if ((pathname === '/project/' || pathname === '/project') && hashParts.length === 2) {
      const [projectId, taskId] = hashParts;
      // Validate both IDs
      if (/^[A-Z]+-\d+$/i.test(projectId) && /^[A-Z]+-\d+$/i.test(taskId)) {
        return { isTaskRoute: true, taskId, projectId };
      }
    }

    // Legacy email format: /#task#TASK-00001 (clients often encode as /#task%23TASK-00001)
    if ((pathname === '/' || pathname === '') && hashParts.length === 2 && hashParts[0].toLowerCase() === 'task') {
      const taskId = hashParts[1];
      if (/^[A-Z]+-\d+$/i.test(taskId)) {
        return { isTaskRoute: true, taskId };
      }
    }
    
    return { isTaskRoute: false };
  } catch (error) {
    return { isTaskRoute: false };
  }
};

/**
 * CENTRALIZED ROUTE PARSING - Single source of truth
 */
export const parseUrlHash = (hash: string): ParsedRoute => {
  // Decode %23 back to # (email clients may encode # to %23)
  hash = hash.replace(/%23/g, '#');
  
  const cleanHash = hash.replace(/^#/, ''); // Remove leading #
  
  // Split by # for route hierarchy  
  const routeParts = cleanHash.split('#');
  const mainPart = routeParts[0] || '';
  const subRoute = routeParts[1] || null;
  
  // Split main part by ? for query parameters
  const [mainRoute, queryString] = mainPart.split('?');
  const queryParams = new URLSearchParams(queryString || '');
  
  // Check for project and task routes
  const projectRoute = parseProjectRoute();
  const taskRoute = parseTaskRoute();
  
  // Determine route type
  const isPage = PAGE_IDENTIFIERS.includes(mainRoute);
  const isAdminTab = ADMIN_TABS.includes(mainRoute);
  const isAuthHash = AUTH_HASH_ROUTES.includes(mainRoute);
  // #login etc. must never be treated as a board UUID (causes select/clear flash loops)
  const isBoardId =
    !isPage &&
    !isAdminTab &&
    !isAuthHash &&
    mainRoute.length > 0 &&
    !projectRoute.isProjectRoute &&
    !taskRoute.isTaskRoute;
  
  return {
    mainRoute,
    subRoute,
    queryParams,
    isPage,
    isAdminTab,
    isBoardId,
    isProjectRoute: projectRoute.isProjectRoute,
    isTaskRoute: taskRoute.isTaskRoute,
    projectId: projectRoute.projectId || taskRoute.projectId,
    taskId: taskRoute.taskId
  };
};

/**
 * Check if a hash represents a page identifier or admin tab
 */
export const isPageOrAdminTab = (hash: string): boolean => {
  const parsed = parseUrlHash(hash);
  return parsed.isPage || parsed.isAdminTab;
};

/**
 * Get the initial selected board from URL hash
 * Note: This only checks URL hash. For user preference fallback, use getInitialSelectedBoardWithPreferences in App.tsx
 */
export const getInitialSelectedBoard = (): string | null => {
  const hash = window.location.hash;
  const parsed = parseUrlHash(hash);
  
  // Return board ID if:
  // 1. Main route is a board ID, OR
  // 2. Main route is 'kanban' and subRoute is a board ID
  if (parsed.isBoardId) {
    return parsed.mainRoute;
  } else if (
    (parsed.mainRoute === 'kanban' || parsed.mainRoute === 'calendar') &&
    parsed.subRoute
  ) {
    return parsed.subRoute;
  }
  
  return null;
};

/**
 * Get the initial page from URL hash
 */
export const getInitialPage = (): 'kanban' | 'admin' | 'reports' | 'task' | 'forgot-password' | 'reset-password' | 'reset-success' | 'activate-account' => {
  const hash = window.location.hash;
  const parsed = parseUrlHash(hash);
  const taskRoute = parseTaskRoute();
  
  // Handle task routes first
  if (taskRoute.isTaskRoute) {
    return 'task';
  }
  
  if (parsed.isPage) {
    // `#calendar` shares the kanban page shell
    if (parsed.mainRoute === 'calendar') {
      return 'kanban';
    }
    return parsed.mainRoute as 'kanban' | 'admin' | 'reports' | 'task' | 'forgot-password' | 'reset-password' | 'reset-success' | 'activate-account';
  }
  
  // If it's a board ID, default to kanban page
  if (parsed.isBoardId || parsed.mainRoute === 'kanban' || parsed.mainRoute === 'calendar') {
    return 'kanban';
  }
  
  return ROUTES.DEFAULT_PAGE as 'kanban';
};

/**
 * Check if a route is a valid admin tab
 */
export const isValidAdminTab = (tab: string): boolean => {
  return ADMIN_TABS.includes(tab);
};

/**
 * Check if current page should skip auto-board-selection
 */
export const shouldSkipAutoBoardSelection = (currentPage: string): boolean => {
  return ROUTES.NO_AUTO_BOARD.includes(currentPage as any);
};

/**
 * Find board by project identifier
 */
export const findBoardByProjectId = (boards: any[], projectId: string): any | null => {
  return boards.find(board => board.project === projectId) || null;
};

/**
 * Build URL hash from components
 */
export const buildHash = (mainRoute: string, subRoute?: string, queryParams?: Record<string, string>): string => {
  let hash = `#${mainRoute}`;
  
  if (subRoute) {
    hash += `#${subRoute}`;
  }
  
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams(queryParams);
    hash += `?${params.toString()}`;
  }
  
  return hash;
};

/**
 * STANDARDIZED TASK URL GENERATION
 * Single source of truth for generating task URLs
 * 
 * @param taskId - Task identifier (e.g., TASK-00023)
 * @param projectId - Optional project identifier (e.g., PROJ-00001)
 * @returns Properly formatted task URL
 */
export const generateTaskUrl = (taskId: string, projectId?: string): string => {
  if (!taskId) {
    return '#';
  }
  
  // If project ID is provided, use the project-task hierarchy format
  if (projectId) {
    return `/project/#${projectId}#${taskId}`;
  }
  
  // Path-based fallback (email clients encode # → %23; avoid bare /#task#…)
  return `/task/#${taskId}`;
};

/**
 * Generate project URL
 */
export const generateProjectUrl = (projectId: string): string => {
  if (!projectId) {
    return '#';
  }
  
  return `/project/#${projectId}`;
};
