import axios, { CancelTokenSource } from 'axios';
import { TeamMember, Board, Task, Column, Comment } from './types';
import { versionDetection } from './utils/versionDetection';
import { handleAuthError } from './utils/authErrorHandler';
import { feDebug } from './utils/clientDebug';
import { clearMediaSession } from './utils/mediaSession';
import {
  readTroubleshootingUnlocked,
  TROUBLESHOOTING_REQUEST_HEADER,
} from './utils/troubleshootingAccess';

function summarizeApiPayload(data: unknown, max = 400): string {
  if (data == null) return '';
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  } catch {
    return '[unserializable]';
  }
}

function redactAuthHeaders(h: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!h) return {};
  const out = { ...h };
  if (out.Authorization) out.Authorization = '[redacted]';
  if (out.authorization) out.authorization = '[redacted]';
  return out;
}

const api = axios.create({
  baseURL: '/api'
});

// Flag to prevent multiple redirects and API calls
let isRedirecting = false;
let hasInvalidToken = false;
let hadTokenBefore = false; // Track if we ever had a token

/** Call after a successful login / OAuth so axios accepts requests again. */
export function clearAuthInterceptorBlock(): void {
  isRedirecting = false;
  hasInvalidToken = false;
}

function hashHasOAuthToken(): boolean {
  try {
    const hash = window.location.hash || '';
    return (
      hash.includes('token=') &&
      !hash.includes('reset-password') &&
      !hash.includes('activate-account')
    );
  } catch {
    return false;
  }
}

/** Strip accidental "Bearer " prefix if a token was stored that way. */
export function normalizeAuthToken(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let t = String(raw).trim();
  if (!t || t === 'undefined' || t === 'null') return null;
  if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, '').trim();
  return t || null;
}

// Function to handle invalid token (only call when token WAS valid but is now invalid)
const handleInvalidToken = () => {
  if (isRedirecting) {
    if (feDebug('FE_DEBUG_AUTH')) console.log('🔑 handleInvalidToken called but already redirecting, skipping');
    return;
  }

  // OAuth callback in progress — do not wipe #login?token=… or reload
  if (hashHasOAuthToken()) {
    if (feDebug('FE_DEBUG_AUTH')) {
      console.log('🔑 handleInvalidToken skipped — OAuth token present in URL hash');
    }
    localStorage.removeItem('authToken');
    return;
  }

  const stackTrace = new Error().stack;
  if (feDebug('FE_DEBUG_AUTH')) {
    console.log('🔑 Token expired - redirecting to login');
    console.log('🔑 handleInvalidToken call stack:', stackTrace);
  }
  isRedirecting = true;
  hasInvalidToken = true;
  
  // Clear token
  localStorage.removeItem('authToken');
  void clearMediaSession();
  if (feDebug('FE_DEBUG_AUTH')) console.log('🔑 Token cleared by handleInvalidToken');
  
  // Set a flag to prevent reload loops
  sessionStorage.setItem('tokenExpiredRedirect', 'true');
  
  // Use location.hash for a clean redirect (no page reload)
  window.location.hash = '#kanban';
  
  // Trigger a page reload to clear all state
  setTimeout(() => {
    window.location.reload();
  }, 100);
};

// Add auth token to requests
api.interceptors.request.use((config) => {
  // Don't make API calls if we're redirecting or have invalid token
  if (isRedirecting || hasInvalidToken) {
    return Promise.reject(new Error('Invalid token - redirecting to login'));
  }
  
  // Ensure config and url exist
  if (!config) {
    console.error('⚠️ Request interceptor: config is undefined');
    return Promise.reject(new Error('Invalid request configuration'));
  }
  
  const token = normalizeAuthToken(localStorage.getItem('authToken'));
  if (!token) {
    // No token available - this is OK if user hasn't logged in yet
    // Don't redirect, just reject the request
    // But don't reject for public endpoints
    const publicEndpoints = [
      '/api/auth/login',
      '/auth/login', // Also check without /api prefix
      '/api/auth/register',
      '/auth/register',
      '/api/auth/activate-account',
      '/auth/activate-account',
      '/api/auth/verify-invitation',
      '/auth/verify-invitation',
      '/api/auth/forgot-password',
      '/auth/forgot-password',
      '/api/auth/reset-password',
      '/auth/reset-password',
      '/api/auth/check-default-admin',
      '/auth/check-default-admin',
      '/api/auth/instance-status',
      '/auth/instance-status',
      // Do NOT list /auth/is-owner here — it requires JWT. Listing it as "public"
      // lets the client send unauthenticated requests and spams server AUTH logs.
      '/api/settings',
      '/settings',
      '/api/health',
      '/health',
      '/api/ready',
      '/ready',
      '/api/auth/google/url',
      '/auth/google/url',
      '/api/auth/google/callback',
      '/auth/google/callback',
      '/api/password-reset/request',
      '/password-reset/request',
      '/api/password-reset/reset',
      '/password-reset/reset',
      '/api/password-reset/validate-token',
      '/password-reset/validate-token',
      '/api/admin-portal/license-info',
      '/admin-portal/license-info'
    ];
    if (config.url && publicEndpoints.some(endpoint => config.url.startsWith(endpoint))) {
      // Public endpoint - allow request without token
      return config;
    }
    // Log more details for debugging
    console.warn(`⚠️ Request rejected - no token available for ${config.url || 'unknown endpoint'}`, {
      url: config.url,
      method: config.method,
      isRedirecting,
      hasInvalidToken,
      hadTokenBefore
    });
    return Promise.reject(new Error('No auth token available'));
  }
  
  // Track that we have/had a token
  hadTokenBefore = true;
  
  if (!config.headers) {
    config.headers = {};
  }
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// After auth: optional axios trace (FE_DEBUG_API)
api.interceptors.request.use((config) => {
  if (!feDebug('FE_DEBUG_API')) {
    return config;
  }
  (config as { __feDebugApiStart?: number }).__feDebugApiStart = performance.now();
  const base = config.baseURL ?? '';
  const path = config.url ?? '';
  const url = path.startsWith('http') ? path : `${base}${path}`;
  console.log('[FE_DEBUG_API] →', (config.method ?? 'get').toUpperCase(), url, {
    params: config.params,
    dataSummary: summarizeApiPayload(config.data),
    headers: redactAuthHeaders(config.headers as Record<string, unknown>)
  });
  return config;
});

// Handle auth errors and version detection
api.interceptors.response.use(
  (response) => {
    if (feDebug('FE_DEBUG_API')) {
      const cfg = response.config as { __feDebugApiStart?: number; baseURL?: string; url?: string; method?: string };
      const start = cfg.__feDebugApiStart;
      const ms = start != null ? Math.round(performance.now() - start) : '?';
      const base = cfg.baseURL ?? '';
      const path = cfg.url ?? '';
      const url = path.startsWith('http') ? path : `${base}${path}`;
      console.log(
        '[FE_DEBUG_API] ←',
        response.status,
        (cfg.method ?? 'get').toUpperCase(),
        url,
        `${ms}ms`,
        summarizeApiPayload(response.data, 500)
      );
    }
    // Check for version updates via X-App-Version header
    const appVersion = response.headers['x-app-version'];
    if (appVersion) {
      versionDetection.checkVersion(appVersion);
    }
    return response;
  },
  (error) => {
    if (feDebug('FE_DEBUG_API') && error.config) {
      const cfg = error.config as { __feDebugApiStart?: number; baseURL?: string; url?: string; method?: string };
      const start = cfg.__feDebugApiStart;
      const ms = start != null ? Math.round(performance.now() - start) : '?';
      const base = cfg.baseURL ?? '';
      const path = cfg.url ?? '';
      const url = path.startsWith('http') ? path : `${base}${path}`;
      const status = error.response?.status;
      console.log(
        '[FE_DEBUG_API] ✗',
        status ?? 'no-response',
        (cfg.method ?? 'get').toUpperCase(),
        url,
        `${ms}ms`,
        summarizeApiPayload(error.response?.data, 400),
        error.message
      );
    }
    // Only clear token for true auth failures:
    // - 401 unauthorized (invalid/expired token, or user no longer in DB)
    // - 404 on identity endpoints (legacy: /me returned 404 before middleware always checked DB)
    // 403 means insufficient permissions — stay logged in
    const status = error.response?.status;
    const url = String(error.config?.url || '');
    const isIdentity404 =
      status === 404 &&
      (url.includes('/auth/me') || url.includes('/user/status') || url.endsWith('/me'));

    if ((status === 401 || isIdentity404) && !isRedirecting) {
      // Check if this is a token expiration (we had a token before)
      // vs never having logged in (no token)
      const currentToken = normalizeAuthToken(localStorage.getItem('authToken'));
      const hadToken = hadTokenBefore || currentToken;
      
      if (hadToken && currentToken) {
        if (feDebug('FE_DEBUG_AUTH')) {
          console.log(`🔑 Auth error ${status} detected for ${error.config?.url} - clearing session, redirecting to login`);
          console.log(`🔑 Error details:`, {
            url: error.config?.url,
            method: error.config?.method,
            status: error.response?.status,
            message: error.response?.data?.error || error.message,
            hadTokenBefore,
            currentTokenExists: !!currentToken
          });
        }
        handleInvalidToken();
      } else if (feDebug('FE_DEBUG_AUTH')) {
        console.log(`🔑 Auth error ${status} detected - no token present (user not logged in)`);
      }
    } else if (error.message === 'No auth token available') {
      // This is a request rejection, not a response error - don't clear token
      // Just log it for debugging - this happens when token is missing, not when it's invalid
      const currentToken = localStorage.getItem('authToken');
      console.warn(`⚠️ Request rejected - no token available for ${error.config?.url || 'unknown'}. Token in storage: ${!!currentToken}`);
    } else if (error.response?.status === 503) {
      // Service unavailable - don't clear token, just log
      console.warn(`⚠️ Service unavailable (503) for ${error.config?.url} - keeping token`);
    }
    return Promise.reject(error);
  }
);

// Members
export const getMembers = async (includeSystem?: boolean) => {
  const params = includeSystem ? { includeSystem: 'true' } : {};
  const { data } = await api.get<TeamMember[]>('/members', { params });
  // Guard against non-array payloads (proxy/error bodies) that crash Column via members.find
  return Array.isArray(data) ? data : [];
};

export const createMember = async (member: TeamMember) => {
  const { data } = await api.post<TeamMember>('/members', member);
  return data;
};

export const deleteMember = async (id: string) => {
  const { data } = await api.delete(`/members/${id}`);
  return data;
};

// Boards
export const getBoards = async () => {
  const { data } = await api.get<Board[]>('/boards');
  return data;
};

// Get columns for a specific board
export const getBoardColumns = async (boardId: string) => {
  const { data } = await api.get<{id: string, title: string, boardId: string, position: number}[]>(`/boards/${boardId}/columns`);
  return data;
};

export const createBoard = async (board: Board) => {
  const { data } = await api.post<Board>('/boards', board);
  return data;
};

export const updateBoard = async (
  id: string,
  title: string,
  wipLimit?: number | null
) => {
  const body: { title: string; wip_limit?: number | null } = { title };
  if (wipLimit !== undefined) {
    body.wip_limit = wipLimit;
  }
  const { data } = await api.put<Board>(`/boards/${id}`, body);
  return data;
};

export const deleteBoard = async (id: string) => {
  const { data } = await api.delete(`/boards/${id}`);
  return data;
};

export const reorderBoards = async (boardId: string, newPosition: number) => {
  const { data } = await api.post('/boards/reorder', { boardId, newPosition });
  return data;
};

/** POST /columns — includes full `columns` list after server-side renumber (0..n-1). */
export type CreateColumnApiResponse = {
  id: string;
  title: string;
  boardId: string;
  position: number;
  is_finished?: boolean;
  is_archived?: boolean;
  columns?: Column[];
};

// Columns
export const createColumn = async (column: Column) => {
  const { data } = await api.post<CreateColumnApiResponse>('/columns', column);
  return data;
};

export const updateColumn = async (
  id: string,
  title: string,
  is_finished?: boolean,
  is_archived?: boolean,
  wip_limit?: number | null,
  policy_text?: string | null
) => {
  const { data } = await api.put<Column>(`/columns/${id}`, {
    title,
    is_finished,
    is_archived,
    wip_limit,
    policy_text,
  });
  return data;
};

export const deleteColumn = async (id: string) => {
  const { data } = await api.delete(`/columns/${id}`);
  return data;
};

export const reorderColumns = async (columnId: string, newPosition: number, boardId: string) => {
  const { data } = await api.post('/columns/reorder', { columnId, newPosition, boardId });
  return data;
};

export const renumberColumns = async (boardId: string) => {
  const { data } = await api.post('/columns/renumber', { boardId });
  return data;
};

// Move task to different board
export const moveTaskToBoard = async (
  taskId: string,
  targetBoardId: string,
  options?: { skipEmail?: boolean }
) => {
  const { data } = await api.post('/tasks/move-to-board', {
    taskId,
    targetBoardId,
    ...(options?.skipEmail ? { skipEmail: true } : {}),
  });
  return data;
};

export const reorderTasks = async (taskId: string, newPosition: number, columnId: string) => {
  const { data } = await api.post('/tasks/reorder', { taskId, newPosition, columnId });
  return data;
};

export const createTaskAtTop = async (task: Task) => {
  const { data } = await api.post<Task>('/tasks/add-at-top', task);
  return data;
};

export const copyTask = async (
  taskId: string,
  boardId: string,
  options?: { skipEmail?: boolean }
) => {
  const { data } = await api.post<Task>('/tasks/copy', {
    taskId,
    boardId,
    ...(options?.skipEmail ? { skipEmail: true } : {}),
  });
  return data;
};

// Tasks
export const getTaskById = async (id: string) => {
  const { data } = await api.get<Task>(`/tasks/${id}`);
  return data;
};

export const createTask = async (task: Task) => {
  const { data } = await api.post<Task>('/tasks', task);
  return data;
};

export const updateTask = async (task: Task, options?: { skipActivity?: boolean }) => {
  const payload = options?.skipActivity ? { ...task, skipActivity: true } : task;
  const { data } = await api.put<Task>(`/tasks/${task.id}`, payload);
  return data;
};

/** One activity-feed line for kanban multi-select field updates */
export const logBulkTaskFieldActivity = async (payload: {
  field:
    | 'memberId'
    | 'requesterId'
    | 'priorityId'
    | 'sprintId'
    | 'columnId'
    | 'delete'
    | 'moveBoard'
    | 'collaborator'
    | 'watcher'
    | 'tag'
    | 'copy';
  taskIds: string[];
  newValue?: string | null;
  oldValue?: string | null;
  newLabel?: string | null;
  boardId?: string | null;
  /** Undo restored mixed prior values */
  restoredPrevious?: boolean;
  /** columnId: forward archive/move vs undo */
  reason?: 'archive' | 'move' | 'undidArchive' | 'undidMove';
}) => {
  const { data } = await api.post('/tasks/bulk-field-activity', payload);
  return data;
};

export const batchUpdateTasks = async (tasks: Task[]) => {
  const { data } = await api.post<{ tasks: Task[]; updated: number }>('/tasks/batch-update', { tasks });
  return data.tasks;
};

export const deleteTask = async (id: string, options?: { skipEmail?: boolean }) => {
  const { data } = await api.delete(`/tasks/${id}`, {
    params: options?.skipEmail ? { skipEmail: true } : undefined,
  });
  return data;
};

/** Restore a soft-deleted task to its board (or fallback column). */
export const restoreTask = async (id: string) => {
  const { data } = await api.post<Task>(`/tasks/${id}/restore`);
  return data;
};

/** Permanently delete a task (admin only) — removes DB row and attachment files. */
export const purgeTask = async (id: string) => {
  const { data } = await api.delete(`/tasks/${id}/permanent`);
  return data;
};

/** Batch permanent delete (admin only). */
export const purgeTasksBatch = async (taskIds: string[]) => {
  const { data } = await api.post<{ purged: string[] }>('/tasks/permanent-batch', { taskIds });
  return data;
};

/** Soft-deleted tasks for a board (Trash view). */
export const getBoardTrash = async (boardId: string) => {
  const { data } = await api.get<{ tasks?: Task[] } | Task[]>(`/boards/${boardId}/trash`);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.tasks) ? data.tasks : [];
};

export const getBoardTrashCount = async (boardId: string) => {
  const { data } = await api.get<{ count: number }>(`/boards/${boardId}/trash/count`);
  return typeof data?.count === 'number' ? data.count : 0;
};

export const restoreBoard = async (id: string) => {
  const { data } = await api.post<Board>(`/boards/${id}/restore`);
  return data;
};

export const purgeBoard = async (id: string) => {
  const { data } = await api.delete(`/boards/${id}/permanent`);
  return data;
};

export type LifecycleSummary = {
  deletedTasks: number;
  deletedBoards: number;
};

export const getLifecycleSummary = async (): Promise<LifecycleSummary> => {
  const { data } = await api.get<LifecycleSummary>('/admin/lifecycle/summary');
  return {
    deletedTasks: typeof data?.deletedTasks === 'number' ? data.deletedTasks : 0,
    deletedBoards: typeof data?.deletedBoards === 'number' ? data.deletedBoards : 0,
  };
};

export const getLifecycleDeletedTasks = async (params?: { boardId?: string; q?: string }) => {
  const { data } = await api.get<{ tasks: Task[] }>('/admin/lifecycle/tasks', { params });
  return Array.isArray(data?.tasks) ? data.tasks : [];
};

export const getLifecycleDeletedBoards = async () => {
  const { data } = await api.get<{ boards: Board[] }>('/admin/lifecycle/boards');
  return Array.isArray(data?.boards) ? data.boards : [];
};

export const restoreTasksBatch = async (taskIds: string[]) => {
  const { data } = await api.post<{ restored: string[]; errors: unknown[] }>(
    '/admin/lifecycle/tasks/restore-batch',
    { taskIds }
  );
  return data;
};

export const purgeLifecycleTasksBatch = async (taskIds: string[]) => {
  const { data } = await api.post<{ purged: string[] }>(
    '/admin/lifecycle/tasks/purge-batch',
    { taskIds }
  );
  return data;
};

export const purgeLifecycleBoardsBatch = async (boardIds: string[]) => {
  const { data } = await api.post<{ purged: string[]; errors: unknown[] }>(
    '/admin/lifecycle/boards/purge-batch',
    { boardIds }
  );
  return data;
};

// Batch update task positions (optimized for drag-and-drop)
export const batchUpdateTaskPositions = async (
  updates: Array<{ taskId: string; position: number; columnId?: string }>
) => {
  // Last write wins: rapid DnD / WS can briefly leave the same task in two columns,
  // which produced duplicate taskIds and a false 404 from the server length check.
  const byTaskId = new Map<string, { taskId: string; position: number; columnId?: string }>();
  for (const update of updates) {
    if (!update?.taskId) continue;
    byTaskId.set(update.taskId, update);
  }
  const deduped = Array.from(byTaskId.values());
  if (deduped.length === 0) return;
  const { data } = await api.post('/tasks/batch-update-positions', { updates: deduped });
  return data;
};

// Comments
export const createComment = async (comment: Comment & { 
  taskId: string; 
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }> 
}) => {
  const { data } = await api.post<Comment>('/comments', comment);
  return data;
};

export const updateComment = async (id: string, text: string) => {
  const { data } = await api.put(`/comments/${id}`, { text });
  return data;
};

export const deleteComment = async (id: string) => {
  const { data } = await api.delete(`/comments/${id}`);
  return data;
};

// Authentication
export const login = async (email: string, password: string) => {
  // Create a separate axios instance for login to avoid token interceptor issues
  const loginApi = axios.create({
    baseURL: '/api'
  });
  
  const { data } = await loginApi.post('/auth/login', { email, password });
  return data;
};

export const register = async (userData: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
}) => {
  const { data } = await api.post('/auth/register', userData);
  return data;
};

export const getCurrentUser = async () => {
  const { data } = await api.get('/auth/me');
  return data;
};

export const updateAppUrl = async (appUrl: string) => {
  const { data } = await api.put('/settings/app-url', { appUrl });
  return data;
};

// Debug - DISABLED
// export const getQueryLogs = async () => {
//   const { data } = await api.get('/debug/logs');
//   return data;
// };

// Add a new function to handle file uploads
export const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  // Don't set Content-Type manually - browser will set it with boundary for FormData
  const { data } = await api.post<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }>('/upload', formData);
  return data;
};

export const fetchCommentAttachments = async (commentId: string) => {
  // Don't make API calls if no token is available
  if (!localStorage.getItem('authToken')) {
    // If user was previously authenticated, this is an auth error
    handleAuthError('Missing auth token for fetchCommentAttachments');
    return [];
  }
  
  const { data } = await api.get(`/comments/${commentId}/attachments`);
  return data;
};

// Task Attachments API
export const fetchTaskAttachments = async (taskId: string) => {
  // Don't make API calls if no token is available
  if (!localStorage.getItem('authToken')) {
    // If user was previously authenticated, this is an auth error
    handleAuthError('Missing auth token for fetchTaskAttachments');
    return [];
  }
  
  const { data } = await api.get(`/tasks/${taskId}/attachments`);
  return data;
};

export const addTaskAttachments = async (taskId: string, attachments: Array<{
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}>) => {
  const { data } = await api.post(`/tasks/${taskId}/attachments`, { attachments });
  return data;
};

export const deleteAttachment = async (attachmentId: string) => {
  const { data } = await api.delete(`/attachments/${attachmentId}`);
  return data;
};

// Admin API
export const getUsers = async () => {
  const { data } = await api.get('/admin/users');
  return data;
};

export const createUser = async (userData: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  role: string;
  isActive?: boolean;
}) => {
  const { data } = await api.post('/admin/users', {
    ...userData,
    baseUrl: window.location.origin // Send the current browser origin
  });
  return data;
};

export const updateUser = async (userId: string, userData: {
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  displayName?: string; // Optional since it's handled separately
}) => {
  try {
    // Only send fields that the backend endpoint expects
    const { firstName, lastName, email, isActive } = userData;
    const { data } = await api.put(`/admin/users/${userId}`, { 
      firstName, 
      lastName, 
      email, 
      isActive 
    });
    return data;
  } catch (error: any) {
    // Re-throw the error so it can be caught by the calling function
    throw error;
  }
};

export const updateUserRole = async (userId: string, action: 'promote' | 'demote') => {
  const { data } = await api.put(`/admin/users/${userId}/role`, { action });
  return data;
};

export const deleteUser = async (userId: string, reassignToUserId?: string | null) => {
  const { data } = await api.delete(`/admin/users/${userId}`, {
    data: reassignToUserId ? { reassignToUserId } : {},
  });
  return data;
};

export const resendUserInvitation = async (userId: string) => {
  const { data } = await api.post(`/admin/users/${userId}/resend-invitation`, {
    baseUrl: window.location.origin // Send the current browser origin
  });
  return data;
};


export const getUserTaskCount = async (userId: string) => {
  const { data } = await api.get(`/admin/users/${userId}/task-count`);
  return data;
};

export const updateMemberColor = async (userId: string, color: string) => {
  const { data } = await api.put(`/admin/users/${userId}/color`, { color });
  return data;
};

// Self-service account deletion
export const deleteAccount = async () => {
  const { data } = await api.delete('/users/account');
  return data;
};

// Admin Settings with caching to prevent duplicate calls
let lastAdminSettingsCall = 0;
let cachedAdminSettings: any = null;
const ADMIN_SETTINGS_CACHE_MS = 500; // Cache for 500ms to prevent duplicate calls

export const getSettings = async () => {
  const now = Date.now();
  
  // If we called this very recently, return cached data
  if (cachedAdminSettings && (now - lastAdminSettingsCall) < ADMIN_SETTINGS_CACHE_MS) {
    return cachedAdminSettings;
  }
  
  lastAdminSettingsCall = now;
  const { data } = await api.get('/admin/settings');
  cachedAdminSettings = data;
  return data;
};

// Public Settings with caching to prevent duplicate calls
let lastPublicSettingsCall = 0;
let cachedPublicSettings: any = null;
let pendingPublicSettingsPromise: Promise<any> | null = null;
const PUBLIC_SETTINGS_CACHE_MS = 2000; // Cache for 2 seconds to prevent duplicate calls

export const getPublicSettings = async () => {
  const now = Date.now();
  
  // If we called this very recently, return cached data
  if (cachedPublicSettings && (now - lastPublicSettingsCall) < PUBLIC_SETTINGS_CACHE_MS) {
    return cachedPublicSettings;
  }
  
  // If a request is already in flight, return the same promise
  if (pendingPublicSettingsPromise) {
    return pendingPublicSettingsPromise;
  }
  
  // Start new request
  lastPublicSettingsCall = now;
  // Create a separate axios instance for public settings (no auth required)
  const publicApi = axios.create({
    baseURL: '/api'
  });
  
  pendingPublicSettingsPromise = publicApi
    .get('/settings', { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } })
    .then(response => {
    cachedPublicSettings = response.data;
    pendingPublicSettingsPromise = null; // Clear pending promise
    return response.data;
  }).catch(error => {
    pendingPublicSettingsPromise = null; // Clear pending promise on error
    throw error;
  });
  
  return pendingPublicSettingsPromise;
};

// Activity Feed
export const getActivityFeed = async (limit: number = 20, lang?: string) => {
  // Get current language from localStorage (where i18next stores it) or use provided lang
  const currentLang = lang || localStorage.getItem('i18nextLng') || 'en';
  // Normalize to 'en' or 'fr'
  const normalizedLang = currentLang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const { data } = await api.get(`/activity/feed?limit=${limit}&lang=${normalizedLang}`);
  return data;
};

// User Settings with rate limiting to prevent infinite loops
let lastUserSettingsCall = 0;
let cachedUserSettings: any = null;
let pendingUserSettingsPromise: Promise<any> | null = null;
const USER_SETTINGS_CACHE_MS = 2000; // Cache for 2 seconds to prevent duplicate calls from multiple components

export const getUserSettings = async () => {
  const now = Date.now();
  
  // If we called this very recently, return cached data
  if (cachedUserSettings && (now - lastUserSettingsCall) < USER_SETTINGS_CACHE_MS) {
    return cachedUserSettings;
  }
  
  // If a request is already in flight, return the same promise
  if (pendingUserSettingsPromise) {
    return pendingUserSettingsPromise;
  }
  
  // Start new request
  lastUserSettingsCall = now;
  pendingUserSettingsPromise = api.get('/user/settings').then(response => {
    cachedUserSettings = response.data;
    pendingUserSettingsPromise = null; // Clear pending promise
    return response.data;
  }).catch(error => {
    pendingUserSettingsPromise = null; // Clear pending promise on error
    throw error;
  });
  
  return pendingUserSettingsPromise;
};

// Reports Settings with caching to prevent duplicate calls
let lastReportsSettingsCall = 0;
let cachedReportsSettings: any = null;
let pendingReportsSettingsPromise: Promise<any> | null = null;
const REPORTS_SETTINGS_CACHE_MS = 2000; // Cache for 2 seconds to prevent duplicate calls from Header and Reports

export const getReportsSettings = async () => {
  const now = Date.now();
  
  // If we called this very recently, return cached data
  if (cachedReportsSettings && (now - lastReportsSettingsCall) < REPORTS_SETTINGS_CACHE_MS) {
    return cachedReportsSettings;
  }
  
  // If a request is already in flight, return the same promise
  if (pendingReportsSettingsPromise) {
    return pendingReportsSettingsPromise;
  }
  
  // Start new request
  lastReportsSettingsCall = now;
  pendingReportsSettingsPromise = api.get('/reports/settings').then(response => {
    cachedReportsSettings = response.data;
    pendingReportsSettingsPromise = null; // Clear pending promise
    return response.data;
  }).catch(error => {
    pendingReportsSettingsPromise = null; // Clear pending promise on error
    throw error;
  });
  
  return pendingReportsSettingsPromise;
};

export const updateUserSetting = async (setting_key: string, setting_value: any) => {
  const { data } = await api.put('/user/settings', { setting_key, setting_value });
  // Clear cache when settings are updated
  cachedUserSettings = null;
  return data;
};

export type CspReportRow = {
  id: number;
  createdAt: string;
  documentUri: string | null;
  violatedDirective: string | null;
  blockedUri: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  userAgent: string | null;
  raw?: unknown;
};

export const getCspReports = async (): Promise<{ reports: CspReportRow[]; count: number }> => {
  const { data } = await api.get('/admin/csp-reports');
  return data;
};

export const clearCspReports = async (): Promise<{ ok: boolean }> => {
  const { data } = await api.delete('/admin/csp-reports');
  return data;
};

export const updateSetting = async (key: string, value: string) => {
  const { data } = await api.put('/admin/settings', { key, value });
  return data;
};

// Storage information
export const getStorageInfo = async () => {
  const { data } = await api.get('/storage/info');
  return data;
};

// System information (admin only)
export const getSystemInfo = async () => {
  const headers: Record<string, string> = {};
  if (readTroubleshootingUnlocked()) {
    headers[TROUBLESHOOTING_REQUEST_HEADER] = '1';
  }
  const { data } = await api.get('/admin/system-info', { headers });
  return data;
};

// Tags (public endpoint for all users)
export const getAllTags = async () => {
  const { data } = await api.get('/tags');
  return data;
};

// Tags management (admin only)
export const getTags = async () => {
  const { data } = await api.get('/admin/tags');
  return data;
};

export const createTag = async (tag: { tag: string; description?: string; color?: string }) => {
  const { data } = await api.post('/admin/tags', tag);
  return data;
};

export const updateTag = async (tagId: number, tag: { tag: string; description?: string; color?: string }) => {
  const { data } = await api.put(`/admin/tags/${tagId}`, tag);
  return data;
};

export const deleteTag = async (tagId: number) => {
  const { data } = await api.delete(`/admin/tags/${tagId}`);
  return data;
};

export const getTagUsage = async (tagId: number) => {
  const { data } = await api.get(`/admin/tags/${tagId}/usage`);
  return data;
};

// Batch fetch tag usage counts (fixes N+1 problem)
export const getBatchTagUsage = async (tagIds: number[]) => {
  if (tagIds.length === 0) return {};
  const { data } = await api.get(`/admin/tags/usage/batch`, {
    params: { tagIds }
  });
  return data;
};

export const getPriorityUsage = async (priorityId: string) => {
  const { data } = await api.get(`/admin/priorities/${priorityId}/usage`);
  return data;
};

// Batch fetch priority usage counts (fixes N+1 problem)
export const getBatchPriorityUsage = async (priorityIds: string[]) => {
  if (priorityIds.length === 0) return {};
  const { data } = await api.get(`/admin/priorities/usage/batch`, {
    params: { priorityIds }
  });
  return data;
};

// Task-Tag associations
export const getTaskTags = async (taskId: string) => {
  const { data } = await api.get(`/tasks/${taskId}/tags`);
  return data;
};

export const addTagToTask = async (
  taskId: string,
  tagId: number,
  options?: { skipEmail?: boolean }
) => {
  const { data } = await api.post(
    `/tasks/${taskId}/tags/${tagId}`,
    options?.skipEmail ? { skipEmail: true } : undefined,
    options?.skipEmail ? { params: { skipEmail: true } } : undefined
  );
  return data;
};

export const removeTagFromTask = async (taskId: string, tagId: number) => {
  const { data } = await api.delete(`/tasks/${taskId}/tags/${tagId}`);
  return data;
};

// Task-Watchers associations
export const getTaskWatchers = async (taskId: string) => {
  const { data } = await api.get(`/tasks/${taskId}/watchers`);
  return data;
};

export const addWatcherToTask = async (
  taskId: string,
  memberId: string,
  options?: { skipEmail?: boolean }
) => {
  const { data } = await api.post(
    `/tasks/${taskId}/watchers/${memberId}`,
    options?.skipEmail ? { skipEmail: true } : undefined,
    options?.skipEmail ? { params: { skipEmail: true } } : undefined
  );
  return data;
};

export const removeWatcherFromTask = async (taskId: string, memberId: string) => {
  const { data } = await api.delete(`/tasks/${taskId}/watchers/${memberId}`);
  return data;
};

// Task-Collaborators associations
export const getTaskCollaborators = async (taskId: string) => {
  const { data } = await api.get(`/tasks/${taskId}/collaborators`);
  return data;
};

export const addCollaboratorToTask = async (
  taskId: string,
  memberId: string,
  options?: { skipEmail?: boolean }
) => {
  const { data } = await api.post(
    `/tasks/${taskId}/collaborators/${memberId}`,
    {},
    options?.skipEmail ? { params: { skipEmail: true } } : undefined
  );
  return data;
};

export const removeCollaboratorFromTask = async (taskId: string, memberId: string) => {
  const { data } = await api.delete(`/tasks/${taskId}/collaborators/${memberId}`);
  return data;
};

// Priorities management
export const getAllPriorities = async () => {
  const { data } = await api.get('/priorities');
  return data;
};

// Sprints management
export const getAllSprints = async () => {
  const { data } = await api.get('/admin/sprints');
  return data.sprints || data || [];
};

export const createSprint = async (sprint: {
  name: string;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  description?: string;
}) => {
  const { data } = await api.post('/admin/sprints', sprint);
  return data;
};

export const getSprintUsage = async (sprintId: string) => {
  const { data } = await api.get(`/admin/sprints/${sprintId}/usage`);
  return data;
};

export const deleteSprint = async (sprintId: string) => {
  const { data } = await api.delete(`/admin/sprints/${sprintId}`);
  return data;
};

export const getPriorities = async () => {
  const { data } = await api.get('/admin/priorities');
  return data;
};

export const createPriority = async (priority: { priority: string; color: string }) => {
  const { data } = await api.post('/admin/priorities', priority);
  return data;
};

export const updatePriority = async (priorityId: number, priority: { priority: string; color: string }) => {
  const { data } = await api.put(`/admin/priorities/${priorityId}`, priority);
  return data;
};

export const deletePriority = async (priorityId: number) => {
  const { data } = await api.delete(`/admin/priorities/${priorityId}`);
  return data;
};

export const reorderPriorities = async (priorities: any[]) => {
  const { data } = await api.put('/admin/priorities/reorder', { priorities });
  return data;
};

export const setDefaultPriority = async (priorityId: number) => {
  const { data } = await api.put(`/admin/priorities/${priorityId}/set-default`);
  return data;
};

// Views (saved filters) management
export interface SavedFilterView {
  id: number;
  filterName: string;
  userId: string;
  shared: boolean;
  textFilter?: string;
  dateFromFilter?: string;
  dateToFilter?: string;
  dueDateFromFilter?: string;
  dueDateToFilter?: string;
  memberFilters?: string[];
  priorityFilters?: string[];
  tagFilters?: string[];
  projectFilter?: string;
  taskFilter?: string;
  boardColumnFilter?: string;
  created_at: string;
  updated_at: string;
  creatorName?: string; // Available for shared filters
}

export interface CreateFilterViewRequest {
  filterName: string;
  filters: {
    text?: string;
    dateFrom?: string;
    dateTo?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
    selectedMembers?: string[];
    selectedPriorities?: string[];
    selectedTags?: string[];
    projectId?: string;
    taskId?: string;
    boardColumnFilter?: string;
  };
  shared?: boolean;
}

export interface UpdateFilterViewRequest {
  filterName?: string;
  filters?: {
    text?: string;
    dateFrom?: string;
    dateTo?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
    selectedMembers?: string[];
    selectedPriorities?: string[];
    selectedTags?: string[];
    projectId?: string;
    taskId?: string;
    boardColumnFilter?: string;
  };
  shared?: boolean;
}

export const getSavedFilterViews = async (): Promise<SavedFilterView[]> => {
  const { data } = await api.get('/views');
  return data;
};

export const getSharedFilterViews = async (): Promise<SavedFilterView[]> => {
  const { data } = await api.get('/views/shared');
  return data;
};

export const getSavedFilterView = async (viewId: number): Promise<SavedFilterView> => {
  const { data } = await api.get(`/views/${viewId}`);
  return data;
};

export const createSavedFilterView = async (request: CreateFilterViewRequest): Promise<SavedFilterView> => {
  const { data } = await api.post('/views', request);
  return data;
};

export const updateSavedFilterView = async (viewId: number, request: UpdateFilterViewRequest): Promise<SavedFilterView> => {
  const { data } = await api.put(`/views/${viewId}`, request);
  return data;
};

export const deleteSavedFilterView = async (viewId: number): Promise<void> => {
  await api.delete(`/views/${viewId}`);
};

// Avatar management
export const uploadAvatar = async (file: File) => {
  const formData = new FormData();
  formData.append('avatar', file);

  // Don't set Content-Type manually - browser will set it with boundary for FormData
  const { data } = await api.post<{
    message: string;
    avatarUrl: string;
  }>('/users/avatar', formData);
  return data;
};

// Task Relationships
export const getTaskRelationships = async (taskId: string) => {
  const response = await api.get(`/tasks/${taskId}/relationships`);
  return Array.isArray(response.data) ? response.data : [];
};

export const getAvailableTasksForRelationship = async (taskId: string) => {
  const response = await api.get(`/tasks/${taskId}/available-for-relationship`);
  return Array.isArray(response.data) ? response.data : [];
};

export const addTaskRelationship = async (taskId: string, relationship: 'parent' | 'child' | 'related', toTaskId: string) => {
  const response = await api.post(`/tasks/${taskId}/relationships`, {
    relationship,
    toTaskId
  });
  return response.data;
};

export const removeTaskRelationship = async (taskId: string, relationshipId: string) => {
  const response = await api.delete(`/tasks/${taskId}/relationships/${relationshipId}`);
  return response.data;
};

export const getBoardTaskRelationships = async (boardId: string) => {
  const response = await api.get(`/boards/${boardId}/relationships`);
  // Guard against HTML/error bodies during demo reset / proxy failures
  return Array.isArray(response.data) ? response.data : [];
};

// Get complete task flow chart data (optimized)
export const getTaskFlowChart = async (taskId: string): Promise<{
  rootTaskId: string;
  tasks: Array<{
    id: string;
    ticket: string;
    title: string;
    description?: string;
    memberId: string;
    memberName: string;
    memberColor: string;
    status: string;
    priority: string;
    startDate: string;
    dueDate: string;
    projectId: string;
  }>;
  relationships: Array<{
    id: string;
    taskId: string;
    relationship: string;
    relatedTaskId: string;
    taskTicket: string;
    relatedTaskTicket: string;
  }>;
}> => {
  const response = await api.get(`/tasks/${taskId}/flow-chart`);
  return response.data;
};

// Instance Status
export const getInstanceStatus = async (): Promise<{
  status: string;
  isActive: boolean;
  message: string;
  timestamp: string;
}> => {
  const { data } = await api.get('/auth/instance-status');
  return data;
};

// User Status
export const getUserStatus = async (): Promise<{
  isActive: boolean;
  isAdmin: boolean;
  forceLogout: boolean;
}> => {
  const response = await api.get('/user/status');
  return response.data;
};

// Notification Queue
export const getNotificationQueue = async () => {
  const response = await api.get('/admin/notification-queue');
  return response.data;
};

export const sendNotificationsImmediately = async (notificationIds: string[]) => {
  const response = await api.post('/admin/notification-queue/send', {
    notificationIds
  });
  return response.data;
};

export const deleteNotifications = async (notificationIds: string[]) => {
  const response = await api.delete('/admin/notification-queue', {
    data: { notificationIds }
  });
  return response.data;
};

export type WebhookPlatform = 'slack' | 'mattermost' | 'teams' | 'whatsapp' | 'telegram';

export type AdminWebhook = {
  id: string;
  name: string;
  platform: WebhookPlatform;
  enabled: boolean;
  eventTypes: Record<string, boolean>;
  projectIds: string[];
  minPriorityId: string | null;
  locale: string;
  endpointUrl: string;
  hasEndpointUrl?: boolean;
  telegramChatId: string;
  telegramBotToken: string;
  hasTelegramBotToken?: boolean;
  whatsappPhoneNumberId: string;
  whatsappTo: string;
  whatsappGraphVersion: string;
  whatsappAccessToken: string;
  hasWhatsappAccessToken?: boolean;
};

export const getAdminWebhooks = async (): Promise<AdminWebhook[]> => {
  const response = await api.get('/admin/webhooks');
  return response.data;
};

export const createAdminWebhook = async (body: Record<string, unknown>): Promise<AdminWebhook> => {
  const response = await api.post('/admin/webhooks', body);
  return response.data;
};

export const updateAdminWebhook = async (
  id: string,
  body: Record<string, unknown>
): Promise<AdminWebhook> => {
  const response = await api.put(`/admin/webhooks/${id}`, body);
  return response.data;
};

export const patchAdminWebhookEnabled = async (
  id: string,
  enabled: boolean
): Promise<AdminWebhook> => {
  const response = await api.patch(`/admin/webhooks/${id}`, { enabled });
  return response.data;
};

export const deleteAdminWebhook = async (id: string): Promise<void> => {
  await api.delete(`/admin/webhooks/${id}`);
};

export const testAdminWebhook = async (id: string): Promise<void> => {
  await api.post(`/admin/webhooks/${id}/test`);
};

// ─── AI Agent / Dev credentials ─────────────────────────────────────────────

export type TaskWorkMap = Record<string, string | null | undefined>;

export const getTaskWork = async (taskId: string): Promise<{ work: TaskWorkMap }> => {
  const { data } = await api.get(`/tasks/${taskId}/work`);
  return data;
};

export const putTaskWork = async (
  taskId: string,
  body: {
    repoUrl?: string;
    repoBranch?: string;
    status?: string;
    llmModel?: string;
    agentMode?: 'assist' | 'code' | 'automation';
    automationScope?: 'this_board' | 'selected' | 'all_boards';
    automationBoardIds?: string[];
    entries?: TaskWorkMap;
  }
): Promise<{ work: TaskWorkMap }> => {
  const { data } = await api.put(`/tasks/${taskId}/work`, body);
  return data;
};

export const setTaskWorkControl = async (
  taskId: string,
  control: 'pause' | 'stop' | 'resume' | 'none' | 'apply'
): Promise<{ work: TaskWorkMap }> => {
  const { data } = await api.put(`/tasks/${taskId}/work/control`, { control });
  return data;
};

export const undoAutomationJob = async (
  taskId: string
): Promise<{
  ok?: boolean;
  undone?: number;
  summary?: string;
  work?: TaskWorkMap;
  error?: string;
  alreadyUndone?: boolean;
}> => {
  const { data } = await api.post(`/agent/automation/undo/${taskId}`);
  return data;
};

export const getTaskWorkMaps = async (
  taskIds: string[]
): Promise<{ workByTaskId: Record<string, TaskWorkMap> }> => {
  const { data } = await api.post('/tasks/work-maps', { taskIds });
  return data;
};

export interface UserApiTokenMeta {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

export const listUserApiTokens = async (): Promise<UserApiTokenMeta[]> => {
  const { data } = await api.get('/user/dev/tokens');
  return data;
};

export const createUserApiToken = async (
  name?: string
): Promise<{ token: UserApiTokenMeta; rawToken: string }> => {
  const { data } = await api.post('/user/dev/tokens', { name });
  return data;
};

export const revokeUserApiToken = async (id: string): Promise<void> => {
  await api.delete(`/user/dev/tokens/${id}`);
};

export interface UserSshKeyMeta {
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  updatedAt?: string;
}

export const getUserSshKey = async (): Promise<{ key: UserSshKeyMeta | null }> => {
  const { data } = await api.get('/user/dev/ssh-key');
  return data;
};

export const generateUserSshKey = async (): Promise<{
  key: UserSshKeyMeta;
  privateKey: string;
}> => {
  const { data } = await api.post('/user/dev/ssh-key');
  return data;
};

export const downloadUserSshPrivateKey = async (): Promise<{
  privateKey: string;
  fingerprint: string;
}> => {
  const { data } = await api.get('/user/dev/ssh-key/private');
  return data;
};

export interface UserGithubTokenMeta {
  hint: string;
  createdAt: string;
  updatedAt?: string;
}

export const getUserGithubToken = async (): Promise<{
  configured: boolean;
  token: UserGithubTokenMeta | null;
}> => {
  const { data } = await api.get('/user/dev/github-token');
  return data;
};

export const saveUserGithubToken = async (
  token: string
): Promise<{ configured: boolean; token: UserGithubTokenMeta }> => {
  const { data } = await api.put('/user/dev/github-token', { token });
  return data;
};

export const deleteUserGithubToken = async (): Promise<void> => {
  await api.delete('/user/dev/github-token');
};

export interface GithubRepoProbeResult {
  ok: boolean;
  reason?: string;
  authMethod?: 'pat';
  defaultBranch?: string;
  branches?: string[];
  error?: string;
  httpStatus?: number;
}

export const probeGithubRepo = async (
  repoUrl: string
): Promise<GithubRepoProbeResult> => {
  const { data } = await api.post('/user/dev/github-repo-probe', { repoUrl });
  return data;
};

export interface AiModelOption {
  id: string;
  name?: string;
}

/** List models from the tenant's configured AI provider (admin only). */
export const listAdminAiModels = async (): Promise<{
  ok: boolean;
  models?: AiModelOption[];
  error?: string;
  provider?: string;
}> => {
  const { data } = await api.post('/admin/settings/ai/models', {});
  return data;
};

/** Tenant default model name (authenticated; no API key). */
export const getAgentLlmInfo = async (): Promise<{ tenantModel: string }> => {
  const { data } = await api.get('/user/dev/agent-llm');
  return data;
};

export type HelpAssistantTarget = {
  kind: 'admin' | 'view' | 'page' | 'profile';
  hash?: string;
  mode?: 'kanban' | 'list' | 'gantt';
  page?: 'kanban' | 'reports';
  profileFocus?: string;
  highlights?: string[];
  /** Open closed chrome before highlighting (search panel, dropdowns, trash). */
  reveal?: string[];
};

export const postHelpAssistantChat = async (payload: {
  language: 'en' | 'fr';
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  answer: string;
  targetId: string | null;
  target: HelpAssistantTarget | null;
}> => {
  const { data } = await api.post('/help-assistant/chat', payload);
  return data;
};

export default api;