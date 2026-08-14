import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { TeamMember, Task, Column, Columns, Board, PriorityOption, Tag, QueryLog, DragPreview, ColumnVisibilityWarning } from './types';
import { SavedFilterView, getSavedFilterView } from './api';
import DebugPanel from './components/DebugPanel';
import { ThemeProvider } from './contexts/ThemeContext';
import { TourProvider } from './contexts/TourContext';
import TourNudge from './components/tour/TourNudge';
import { OwnerSetupProvider } from './contexts/OwnerSetupContext';
import OwnerSetupChecklist from './components/ownerSetup/OwnerSetupChecklist';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import Login from './components/Login';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import ResetPasswordSuccess from './components/ResetPasswordSuccess';
import ActivateAccount from './components/ActivateAccount';
import Header from './components/layout/Header';
import MainLayout from './components/layout/MainLayout';
import LoadingSpinner from './components/LoadingSpinner';
import AdminLeaveUnsavedDialog, {
  type AdminDraftGate,
} from './components/admin/AdminLeaveUnsavedDialog';

const EMPTY_ADMIN_DRAFT_GATE: AdminDraftGate = {
  hasSharedDirty: false,
  hasLocalDirty: false,
  saveShared: async () => ({ hasLocalDirtyStill: false }),
  discardAll: () => {},
};

import { lazyWithRetry } from './utils/lazyWithRetry';
import {
  clearChunkMismatchHardRefreshCount,
  tryHardRefreshForChunkMismatch,
} from './utils/chunkMismatchReload';

// Lazy load TaskPage to reduce initial bundle size with retry logic
const TaskPage = lazyWithRetry(() => import('./components/TaskPage'));

// Loading fallback component for lazy-loaded pages
const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <LoadingSpinner />
  </div>
);
// Lazy load ModalManager to reduce initial bundle size (only needed when authenticated) with retry logic
const ModalManager = lazyWithRetry(() => import('./components/layout/ModalManager'));
const PerfTestOverlay = lazyWithRetry(() =>
  import('./perfTests/PerfTestOverlay').then((m) => ({ default: m.default }))
);
const AdminSeedOverlay = lazyWithRetry(() =>
  import('./perfTests/AdminSeedOverlay').then((m) => ({ default: m.default }))
);
import { shouldShowPerfTests, subscribePerfTestsPreference, PERF_TESTS_USER_SETTING_KEY, isPerfTestsUserSettingEnabled } from './perfTests';
import TaskDeleteConfirmation from './components/TaskDeleteConfirmation';
import CrossBoardMoveConfirmation from './components/CrossBoardMoveConfirmation';
import ActivityFeed from './components/ActivityFeed';
import TaskLinkingOverlay from './components/TaskLinkingOverlay';
import NetworkStatusIndicator from './components/NetworkStatusIndicator';
import VersionUpdateBanner from './components/VersionUpdateBanner';
import { useTaskDeleteConfirmation } from './hooks/useTaskDeleteConfirmation';
import api, { getMembers, getBoards, deleteTask, updateTask, reorderTasks, reorderColumns, reorderBoards, updateColumn, updateBoard, createTaskAtTop, createTask, copyTask, createColumn, createBoard, deleteColumn, deleteBoard, getBoardTrashCount, purgeBoard, getUserSettings, createUser, getUserStatus, getActivityFeed, updateSavedFilterView, getCurrentUser, updateAppUrl, restoreTask, purgeTask } from './api';
import { toast, ToastContainer } from './utils/toast';
import { getWipStatus, hasWipLimit, getBoardWipTaskCount, getBoardWipTasks, isBoardWipActiveColumn } from './utils/kanbanFlowUtils';
import { isAgentMemberId } from './utils/agentMemberUi';
import { taskMatchesSelectedSprint } from './utils/columnFilters';
import { userCanMutate } from './utils/permissions';
import { isDemoModeClient } from './utils/demoReset';
import { useLoadingState } from './hooks/useLoadingState';
import { useDebug } from './hooks/useDebug';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAuth } from './hooks/useAuth';
import { useDataPolling, UserStatus } from './hooks/useDataPolling';
import { useActivityFeed } from './hooks/useActivityFeed';
import { useVersionStatus } from './hooks/useVersionStatus';
import { useModalState } from './hooks/useModalState';
import { useTaskLinking } from './hooks/useTaskLinking';
import { useTaskFilters } from './hooks/useTaskFilters';
import { useTaskWebSocket } from './hooks/useTaskWebSocket';
import { useCommentWebSocket } from './hooks/useCommentWebSocket';
import { useColumnWebSocket } from './hooks/useColumnWebSocket';
import { useBoardWebSocket } from './hooks/useBoardWebSocket';
import { useMemberWebSocket } from './hooks/useMemberWebSocket';
import { useSettingsWebSocket } from './hooks/useSettingsWebSocket';
import { useWebSocketConnection } from './hooks/useWebSocketConnection';
import { generateUUID } from './utils/uuid';
import { formatToYYYYMMDD } from './utils/dateUtils';
import websocketClient from './services/websocketClient';
import { resolveActivityFeedPosition } from './utils/activityFeedPosition';
import { loadUserPreferences, loadUserPreferencesAsync, mergeClearedKanbanVisibilityFilters, saveUserPreferences, updateUserPreference, updateActivityFeedPreference, loadAdminDefaults, TaskViewMode, ViewMode, isGloballySavingPreferences, registerSavingStateCallback, UserPreferences, clearAllUserPreferenceCookies } from './utils/userPreferences';
import { resolveGuestLanguage, normalizeAppLanguage, getExplicitGuestLanguage, setExplicitGuestLanguage } from './utils/guestLanguage';
import { versionDetection } from './utils/versionDetection';
import { getAllPriorities, getAllTags, getTags, getPriorities, getSettings, getTaskWatchers, getTaskCollaborators, addTagToTask, removeTagFromTask, getBoardTaskRelationships, getTaskRelationships, getAllSprints, getUserSettings, removeTaskRelationship } from './api';
import { 
  DEFAULT_COLUMNS, 
  DRAG_COOLDOWN_DURATION, 
  TASK_CREATION_PAUSE_DURATION, 
  BOARD_CREATION_PAUSE_DURATION,
  DND_ACTIVATION_DISTANCE 
} from './constants';
import { feDebug } from './utils/clientDebug';
import { dndLog } from './utils/dndDebug';
import {
  findBoardRelationshipEdge,
  getBoardRelationshipCounterpartIds,
  getBoardRelationshipType,
  normalizeBoardRelationshipEdge,
  pickBoardRelationshipEdgeToDelete,
} from './utils/taskRelationshipSummary';
import { 
  getInitialSelectedBoard, 
  getInitialPage,
  parseUrlHash,
  parseProjectRoute,
  parseTaskRoute,
  findBoardByProjectId,
  shouldSkipAutoBoardSelection
} from './utils/routingUtils';
import { 
  filterTasks,
  hasActiveFilters,
  hasConfiguredSearchFilters,
  wouldTaskBeFilteredOut,
  clearTaskSoftDelete,
  sumTaskEffort,
} from './utils/taskUtils';
import { dedupeTasksInColumns } from './utils/taskReorderingUtils';
import { moveTaskToBoard } from './api';
import { customCollisionDetection, calculateGridStyle } from './utils/dragDropUtils';
import { clearCustomCursor } from './utils/cursorUtils';
import { generateUniqueBoardName } from './utils/boardUtils';
import { renumberColumns, isArchivedColumnFlag } from './utils/columnUtils';
import { handleSameColumnReorder, handleCrossColumnMove, handleBulkMoveTasks, moveTaskToPosition, calculatePositionForIndex, renumberColumnAfterCopy, resolveDropIndex, TaskDropPlacement } from './utils/taskReorderingUtils';
import { getTaskColumnId, orderedCheckedTasksInColumn } from './utils/kanbanMultiSelect';
import { useKanbanMultiSelect } from './hooks/useKanbanMultiSelect';
import { hasEscapeConsumingOverlay, isEditableEscapeTarget } from './utils/escapeKeyUtils';
import { focusHeaderTaskSearch } from './utils/keyboardShortcutUtils';
import { handleInviteUser as handleInviteUserUtil } from './utils/userInvitationUtils';
import { notifyBoardTrashChanged, notifyLifecycleDataChanged } from './utils/boardTrashEvents';
import BoardLimitReachedDialog, { BoardLimitInfo } from './components/BoardLimitReachedDialog';
import { KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DndContext, DragOverlay } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { SimpleDragDropManager } from './components/dnd/SimpleDragDropManager';
import SimpleDragOverlay from './components/dnd/SimpleDragOverlay';
import { SYSTEM_MEMBER_ID, WEBSOCKET_THROTTLE_MS } from './constants/appConstants';
import { checkInstanceStatusOnError, getDefaultPriorityName } from './utils/appHelpers';

// Extend Window interface for WebSocket flags
declare global {
  interface Window {
    justUpdatedFromWebSocket?: boolean;
    setJustUpdatedFromWebSocket?: (value: boolean) => void;
    lastWebSocketUpdateTime?: number;
  }
}



// Inner App component that uses hooks (must be inside SettingsProvider)
function AppContent() {
  const { t } = useTranslation('tasks');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const selectedBoardRef = useRef<string | null>(null); // Initialize as null, will be set after auth
  
  // Debug: Log when selectedBoard changes and update ref
  useEffect(() => {
    selectedBoardRef.current = selectedBoard;
  }, [selectedBoard]);
  const [columns, setColumns] = useState<Columns>({});
  // Use SettingsContext instead of local state
  const { systemSettings, siteSettings, isLoading: settingsLoading, refreshSettings: refreshContextSettings } = useSettings();
  const [kanbanColumnWidth, setKanbanColumnWidth] = useState<number>(300); // Default 300px
  
  // User Status for permission refresh
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null);
  const userStatusRef = useRef<UserStatus | null>(null);
  
  // Track if language has been loaded (to ensure activity feed uses correct language)
  const [languageLoaded, setLanguageLoaded] = useState<boolean>(false);
  
  // Initialize extracted hooks
  const versionStatus = useVersionStatus();
  const taskLinking = useTaskLinking();
  
  // Log when boardRelationships changes
  useEffect(() => {
    if (!feDebug('FE_DEBUG_TASK_LINKING')) return;
    console.log('🔗 [App] taskLinking.boardRelationships changed:', {
      count: taskLinking.boardRelationships.length,
      relationships: taskLinking.boardRelationships.map(r => ({
        id: r.id,
        taskId: r.taskId || r.task_id,
        toTaskId: r.toTaskId || r.to_task_id,
        relationship: r.relationship
      }))
    });
  }, [taskLinking.boardRelationships]);
  
  // Activity Feed hook - initialized after currentUser is available (will be done after useAuth)
  
  // Utility function to check instance status on API failures
  // Wrapped to pass setInstanceStatus to the extracted helper function
  const handleInstanceStatusError = async (error: any) => {
    return checkInstanceStatusOnError(error, versionStatus.setInstanceStatus);
  };
  
  // Drag states for BoardTabs integration
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const draggedTaskRef = useRef<Task | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<Column | null>(null);
  const draggedColumnRef = useRef<Column | null>(null);
  const [isHoveringBoardTab, setIsHoveringBoardTab] = useState<boolean>(false);
  const boardTabHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringBoardTabRef = useRef<boolean>(false);
  const [boardLimitDialog, setBoardLimitDialog] = useState<BoardLimitInfo | null>(null);

  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const [isTaskMiniMode, setIsTaskMiniMode] = useState(false);
  const dragStartedRef = useRef<boolean>(false);
  
  // Throttle WebSocket updates to prevent performance issues
  const lastWebSocketUpdateRef = useRef<number>(0);
  const dragCooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskDetailsOptions, setTaskDetailsOptions] = useState<{ scrollToComments?: boolean }>({});
  const [draggedTaskIds, setDraggedTaskIds] = useState<string[]>([]);

  // Helper function to update user preferences with current user ID
  const updateCurrentUserPreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    // Global saving state is now handled automatically in saveUserPreferences
    updateUserPreference(key, value, currentUser?.id || null);
  };

  // Helper function to get initial selected board with user preference fallback
  const getInitialSelectedBoardWithPreferences = (userId: string | null): string | null => {
    // First, check URL hash
    const boardFromUrl = getInitialSelectedBoard();
    if (boardFromUrl) {
      return boardFromUrl;
    }

    // If no URL hash, check user preferences
    const userPrefs = loadUserPreferences(userId);
    return userPrefs.lastSelectedBoard;
  };

  // Enhanced setSelectedTask that also updates user preferences
  const handleSelectTask = useCallback((task: Task | null, options?: { scrollToComments?: boolean }) => {
    setSelectedTask(task);
    updateCurrentUserPreference('selectedTaskId', task?.id || null);
    
    // Store scroll options for TaskDetails
    if (task && options?.scrollToComments) {
      setTaskDetailsOptions({ scrollToComments: true });
    } else {
      setTaskDetailsOptions({});
    }
  }, []);

  // Board selection with URL hash persistence and user preference saving
  const handleBoardSelection = useCallback((boardId: string) => {
    setSelectedBoard(boardId);
    window.location.hash = boardId;
    updateCurrentUserPreference('lastSelectedBoard', boardId);
  }, []);

  // Escape: menus/confirms first → close TaskDetails → (multi-check cleared by useKanbanMultiSelect).
  useEffect(() => {
    if (!selectedTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (isEditableEscapeTarget(e.target)) return;
      if (hasEscapeConsumingOverlay()) return;
      e.preventDefault();
      handleSelectTask(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedTask, handleSelectTask]);

  // Task deletion handler with confirmation
  const removeTaskFromLocalColumns = (taskId: string) => {
    setColumns(prev => {
      const updatedColumns = { ...prev };
      Object.keys(updatedColumns).forEach(columnId => {
        const column = updatedColumns[columnId];
        if (column) {
          const remainingTasks = column.tasks.filter(task => task.id !== taskId);
          const renumberedTasks = remainingTasks
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((task, index) => ({
              ...task,
              position: index
            }));
          updatedColumns[columnId] = {
            ...column,
            tasks: renumberedTasks
          };
        }
      });
      return updatedColumns;
    });

    taskFilters.setFilteredColumns(prevFilteredColumns => {
      const updatedFilteredColumns = { ...prevFilteredColumns };
      Object.keys(updatedFilteredColumns).forEach(columnId => {
        const column = updatedFilteredColumns[columnId];
        if (column) {
          const remainingTasks = column.tasks.filter(task => task.id !== taskId);
          const renumberedTasks = remainingTasks
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((task, index) => ({
              ...task,
              position: index
            }));
          updatedFilteredColumns[columnId] = {
            ...column,
            tasks: renumberedTasks
          };
        }
      });
      return updatedFilteredColumns;
    });
  };

  const handleTaskDelete = async (
    taskId: string,
    options?: { skipEmail?: boolean }
  ) => {
    try {
      recentlyDeletedTasksRef.current.add(taskId);
      setTimeout(() => {
        recentlyDeletedTasksRef.current.delete(taskId);
      }, 10000);

      let boardIdForTrash = selectedBoardRef.current;
      for (const column of Object.values(columns)) {
        const found = column?.tasks?.find((task) => task.id === taskId);
        if (found) {
          boardIdForTrash = found.boardId || boardIdForTrash;
          break;
        }
      }

      await deleteTask(taskId, options);
      removeTaskFromLocalColumns(taskId);

      // NOTE: Backend already renumbers tasks after deletion and sends a WebSocket event
      await refreshBoardData();
      await fetchQueryLogs();

      // Do not rely only on WebSocket for the trash badge — refresh after HTTP success
      notifyBoardTrashChanged(boardIdForTrash);
    } catch (error) {
      throw error;
    }
  };

  /** Admin hard-delete (Shift+click) — bypasses trash. */
  const handleTaskPermanentDelete = async (taskId: string) => {
    try {
      recentlyDeletedTasksRef.current.add(taskId);
      setTimeout(() => {
        recentlyDeletedTasksRef.current.delete(taskId);
      }, 10000);

      await purgeTask(taskId);
      removeTaskFromLocalColumns(taskId);

      await refreshBoardData();
      await fetchQueryLogs();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('trash.purgeFailed'));
      throw error;
    }
  };

  const handleTaskRestoredLocally = useCallback((task: Task) => {
    recentlyDeletedTasksRef.current.delete(task.id);
    const boardId = task.boardId || (task as any).boardid;
    if (boardId) {
      taskWebSocketRef.current?.handleTaskRestored?.({
        boardId,
        task: clearTaskSoftDelete({
          ...task,
        }),
      });
    }
  }, []);

  const handleRestoreSelectedTask = useCallback(async () => {
    if (!selectedTask?.id) return;
    try {
      const restored = await restoreTask(selectedTask.id);
      const normalized = clearTaskSoftDelete({
        ...restored,
        columnId: restored.columnId || (restored as any).columnid,
        boardId: restored.boardId || (restored as any).boardid,
        memberId: restored.memberId || (restored as any).memberid,
        requesterId: restored.requesterId || (restored as any).requesterid,
      } as Task);
      recentlyDeletedTasksRef.current.delete(selectedTask.id);
      taskWebSocketRef.current?.handleTaskRestored?.({
        boardId: normalized.boardId,
        task: normalized,
      });
      // Keep TaskDetails open, but switch from read-only lifecycle mode to editable
      handleSelectTask(normalized);
      const ticket = normalized.ticket || selectedTask.ticket;
      toast.success(
        ticket
          ? t('trash.restored', { ticket })
          : t('trash.restoredNoTicket')
      );
    } catch (error: any) {
      const code = error?.response?.data?.code;
      if (code === 'board_soft_deleted') {
        toast.error(t('trash.restoreBoardFirst'));
      } else {
        toast.error(error?.response?.data?.error || t('trash.restoreFailed'));
      }
    }
  }, [selectedTask, t, handleSelectTask]);

  const handlePurgeSelectedTask = useCallback(async () => {
    if (!selectedTask?.id) return;
    try {
      await purgeTask(selectedTask.id);
      toast.success(t('trash.purged'));
      handleSelectTask(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('trash.purgeFailed'));
    }
  }, [selectedTask?.id, t]);

  // This will be defined later after the hooks are initialized
  let handleRemoveTask: (taskId: string, clickEvent?: React.MouseEvent) => Promise<void>;
  const [queryLogs, setQueryLogs] = useState<QueryLog[]>([]);
  const [dragCooldown, setDragCooldown] = useState(false);
  const [taskCreationPause, setTaskCreationPause] = useState(false);
  const [boardCreationPause, setBoardCreationPause] = useState(false);
  const [animateCopiedTaskId, setAnimateCopiedTaskId] = useState<string | null>(null);
  const [pendingCopyAnimation, setPendingCopyAnimation] = useState<{
    title: string;
    columnId: string;
    originalPosition: number;
    originalTaskId: string;
  } | null>(null);
  // Load user preferences from cookies (will be updated when user is authenticated)
  const [userPrefs] = useState(() => loadUserPreferences());
  
  // Filter state will be initialized via useTaskFilters hook after updateCurrentUserPreference is defined
  // const [boardTaskCounts, setBoardTaskCounts] = useState<{[boardId: string]: number}>({});
  const [availablePriorities, setAvailablePriorities] = useState<PriorityOption[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [availableSprints, setAvailableSprints] = useState<any[]>([]);
  
  // Column visibility state for each board
  const [boardColumnVisibility, setBoardColumnVisibility] = useState<{[boardId: string]: string[]}>({});

  // Handle column visibility changes
  const handleBoardColumnVisibilityChange = (boardId: string, visibleColumns: string[]) => {
    const newVisibility = {
      ...boardColumnVisibility,
      [boardId]: visibleColumns
    };
    
    setBoardColumnVisibility(newVisibility);
    
    // Save to user settings for persistence across page reloads
    updateCurrentUserPreference('boardColumnVisibility', newVisibility);
    
    // Save to current filter view if it exists
    if (taskFilters.currentFilterView) {
      // Update the view in the database
      updateSavedFilterView(taskFilters.currentFilterView.id, {
        filters: {
          ...taskFilters.currentFilterView,
          boardColumnFilter: JSON.stringify(newVisibility)
        }
      }).catch(error => {
        console.error('Failed to save column filter to view:', error);
      });
    }
  };

  // Load column filter from current filter view or user settings
  // Note: This useEffect will be moved after taskFilters hook initialization
  // Modal state extracted to useModalState hook (modalState)
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [currentPage, setCurrentPage] = useState<'kanban' | 'admin' | 'reports' | 'test' | 'forgot-password' | 'reset-password' | 'reset-success' | 'activate-account'>(getInitialPage);
  
  // Also log the current value whenever KanbanPage would receive it
  useEffect(() => {
    if (currentPage === 'kanban' && selectedBoard && feDebug('FE_DEBUG_TASK_LINKING')) {
      console.log('🔗 [App] Current boardRelationships value (what KanbanPage would receive):', {
        count: taskLinking.boardRelationships.length,
        selectedBoard,
        currentPage
      });
    }
  }, [currentPage, selectedBoard, taskLinking.boardRelationships]);

  // Sync local state with global preference saving state
  useEffect(() => {
    const updateSavingState = () => {
      setIsSavingPreferences(isGloballySavingPreferences());
    };
    
    // Initial sync
    updateSavingState();
    
    // Register for updates
    const unregister = registerSavingStateCallback(updateSavingState);
    
    return unregister;
  }, []);
  const [resetToken, setResetToken] = useState<string>('');
  const [activationToken, setActivationToken] = useState<string>('');
  const [activationEmail, setActivationEmail] = useState<string>('');
  const [activationParsed, setActivationParsed] = useState<boolean>(false);
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [columnWarnings, setColumnWarnings] = useState<Record<string, ColumnVisibilityWarning>>({});
  const columnWarningsRef = useRef<Record<string, ColumnVisibilityWarning>>({});
  useEffect(() => {
    columnWarningsRef.current = columnWarnings;
  }, [columnWarnings]);

  const [showColumnDeleteConfirm, setShowColumnDeleteConfirm] = useState<string | null>(null);

  const [crossBoardMovePending, setCrossBoardMovePending] = useState<{
    taskId: string;
    targetBoardId: string;
    relationshipCount: number;
  } | null>(null);
  const [crossBoardMoveBusy, setCrossBoardMoveBusy] = useState(false);
  
  // Task linking state extracted to useTaskLinking hook (taskLinking)
  
  // Debug showColumnDeleteConfirm changes
  useEffect(() => {
    if (showColumnDeleteConfirm) {
      // console.log(`📋 showColumnDeleteConfirm changed to: ${showColumnDeleteConfirm}`);
    } else {
      // console.log(`📋 showColumnDeleteConfirm cleared`);
    }
  }, [showColumnDeleteConfirm]);

  // Sync selectedMembers when members list changes (e.g., user deletion)
  // Note: This useEffect will be moved after taskFilters hook initialization

  // Helper function to get default priority name
  // Get default priority name using extracted helper function
  const getDefaultPriority = (): string => {
    return getDefaultPriorityName(availablePriorities);
  };

  // Authentication hook
  const {
    isAuthenticated,
    authChecked,
    currentUser,
    hasDefaultAdmin,
    intendedDestination,
    justRedirected,
    handleLogin,
    handleLogout,
    handleProfileUpdated,
    setCurrentUser,
  } = useAuth({
    onDataClear: () => {
    setMembers([]);
    setBoards([]);
    setColumns({});
    setSelectedBoard(null);
    // Note: selectedMembers will be cleared via taskFilters hook
    },
    onAdminRefresh: () => {
      setAdminRefreshKey(prev => prev + 1);
    },
    onPageChange: setCurrentPage,
    onMembersRefresh: async () => {
      const loadedMembers = await getMembers(taskFilters.includeSystem);
      setMembers(loadedMembers);
    },
  });
  const modalState = useModalState(currentUser?.id ?? null);
  const { loading, withLoading } = useLoadingState();

  // Per-admin Performance Test Overlay preference (user_settings.FE_PERF_TESTS)
  const isAdminUser = Boolean(currentUser?.roles?.includes('admin'));
  const canMutate = userCanMutate(currentUser);
  const [userPerfTestsEnabled, setUserPerfTestsEnabled] = useState(false);
  useEffect(() => {
    if (!currentUser?.id || !isAdminUser) {
      setUserPerfTestsEnabled(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await getUserSettings();
        if (cancelled) return;
        setUserPerfTestsEnabled(
          isPerfTestsUserSettingEnabled(settings?.[PERF_TESTS_USER_SETTING_KEY])
        );
      } catch {
        if (!cancelled) setUserPerfTestsEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, isAdminUser]);

  useEffect(() => subscribePerfTestsPreference(setUserPerfTestsEnabled), []);
  
  // Initialize Task Filters hook (requires columns, members, boards, and updateCurrentUserPreference)
  const taskFilters = useTaskFilters({
    columns,
    members,
    boards,
    sprints: availableSprints,
    updateCurrentUserPreference,
  });

  // Hide column banner when the task appears in filtered Kanban data (filters/sprint assignment changed).
  useEffect(() => {
    const snap = columnWarningsRef.current;
    const colIds = Object.keys(snap);
    if (colIds.length === 0) return;
    const fc = taskFilters.filteredColumns;
    if (!fc || Object.keys(fc).length === 0) return;
    const toRemove: string[] = [];
    for (const colId of colIds) {
      const w = snap[colId];
      if (!w) continue;
      const visible = Object.values(fc).some(
        col => col?.tasks?.some(t => t.id === w.taskId)
      );
      if (visible) toRemove.push(colId);
    }
    if (toRemove.length === 0) return;
    setColumnWarnings(prev => {
      const next = { ...prev };
      for (const c of toRemove) delete next[c];
      return next;
    });
  }, [taskFilters.filteredColumns]);

  /** After creating a task or updating sprint, recompute whether it is still hidden by filters. */
  const buildColumnVisibilityWarningForTask = useCallback(
    (task: Task): ColumnVisibilityWarning | null => {
      const wouldBeFilteredBySearch = wouldTaskBeFilteredOut(
        task,
        taskFilters.searchFilters,
        taskFilters.isSearchActive,
        members,
        boards,
        availableSprints
      );
      const wouldBeFilteredBySprint = (() => {
        if (taskFilters.selectedSprintId === null) return false;
        if (taskFilters.selectedSprintId === 'backlog') return false;
        return task.sprintId !== taskFilters.selectedSprintId;
      })();
      const wouldBeFilteredByMembers = (() => {
        if (
          !taskFilters.includeAssignees &&
          !taskFilters.includeWatchers &&
          !taskFilters.includeCollaborators &&
          !taskFilters.includeRequesters
        ) {
          return false;
        }
        const showAllMembers = taskFilters.selectedMembers.length === 0;
        const memberIds = new Set(taskFilters.selectedMembers);
        let hasMatchingMember = false;
        if (taskFilters.includeAssignees) {
          if (showAllMembers) {
            if (task.memberId) hasMatchingMember = true;
          } else if (task.memberId && memberIds.has(task.memberId)) {
            hasMatchingMember = true;
          }
        }
        if (!hasMatchingMember && taskFilters.includeRequesters) {
          if (showAllMembers) {
            if (task.requesterId) hasMatchingMember = true;
          } else if (task.requesterId && memberIds.has(task.requesterId)) {
            hasMatchingMember = true;
          }
        }
        if (!hasMatchingMember && taskFilters.includeWatchers && task.watchers && Array.isArray(task.watchers)) {
          if (showAllMembers) {
            if (task.watchers.length > 0) hasMatchingMember = true;
          } else if (task.watchers.some(w => w && memberIds.has(w.id))) {
            hasMatchingMember = true;
          }
        }
        if (!hasMatchingMember && taskFilters.includeCollaborators && task.collaborators && Array.isArray(task.collaborators)) {
          if (showAllMembers) {
            if (task.collaborators.length > 0) hasMatchingMember = true;
          } else if (task.collaborators.some(c => c && memberIds.has(c.id))) {
            hasMatchingMember = true;
          }
        }
        return !hasMatchingMember;
      })();

      if (!wouldBeFilteredBySearch && !wouldBeFilteredBySprint && !wouldBeFilteredByMembers) {
        return null;
      }
      const sprintId = taskFilters.selectedSprintId;
      const showSprintPrompt =
        wouldBeFilteredBySprint && sprintId !== null && sprintId !== 'backlog';
      return {
        taskId: task.id,
        showSprintPrompt,
        selectedSprintId: showSprintPrompt ? sprintId : undefined,
        showClearFilters: wouldBeFilteredBySearch || wouldBeFilteredByMembers,
        reasons: {
          search: wouldBeFilteredBySearch,
          sprint: wouldBeFilteredBySprint,
          members: wouldBeFilteredByMembers,
        },
      };
    },
    [
      taskFilters.searchFilters,
      taskFilters.isSearchActive,
      taskFilters.selectedSprintId,
      taskFilters.includeAssignees,
      taskFilters.includeWatchers,
      taskFilters.includeCollaborators,
      taskFilters.includeRequesters,
      taskFilters.selectedMembers,
    ]
  );
  
  // Initialize Activity Feed hook now that currentUser is available
  const activityFeed = useActivityFeed(currentUser?.id || null);
  /** Session-only: we auto-minimized because TaskDetails overlapped the feed. */
  const activityFeedAutoMinForTaskRef = useRef(false);

  // When TaskDetails would cover the feed, auto-minimize (do not persist). Restore on close.
  useEffect(() => {
    if (!activityFeed.showActivityFeed || typeof window === 'undefined') return;

    if (!selectedTask) {
      if (activityFeedAutoMinForTaskRef.current) {
        activityFeedAutoMinForTaskRef.current = false;
        activityFeed.setActivityFeedMinimized(false);
      }
      return;
    }

    if (activityFeed.activityFeedMinimized) return;

    // Already auto-minimized for this TaskDetails session — if the user expands
    // while the panel is still open, do not immediately collapse again.
    if (activityFeedAutoMinForTaskRef.current) return;

    const prefs = loadUserPreferences(currentUser?.id || null);
    const prefWidth = Number(prefs.taskDetailsWidth) || 480;
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    const detailsWidth = Math.min(
      window.innerWidth,
      mobile ? Math.max(prefWidth, Math.round(window.innerWidth * 0.88)) : prefWidth
    );
    const taskLeft = window.innerWidth - detailsWidth;
    const feedW = activityFeed.activityFeedDimensions.width;
    const feedH = activityFeed.activityFeedDimensions.height;
    const abs = resolveActivityFeedPosition(
      activityFeed.activityFeedPosition,
      feedW,
      window.innerWidth
    );
    const overlapsHorizontally = abs.x + feedW > taskLeft + 8 && abs.x < window.innerWidth - 8;
    const overlapsVertically = abs.y < window.innerHeight - 8 && abs.y + feedH > 66;

    if (overlapsHorizontally && overlapsVertically) {
      activityFeedAutoMinForTaskRef.current = true;
      activityFeed.setActivityFeedMinimized(true);
    }
  }, [
    selectedTask,
    activityFeed.showActivityFeed,
    activityFeed.activityFeedMinimized,
    activityFeed.activityFeedPosition,
    activityFeed.activityFeedDimensions.width,
    activityFeed.activityFeedDimensions.height,
    currentUser?.id,
  ]);

  // User status update handler with force logout functionality
  const handleUserStatusUpdate = (newUserStatus: UserStatus) => {
    const previousStatus = userStatusRef.current;
    // Reduced logging to avoid performance violations
    if (process.env.NODE_ENV === 'development') {
      // console.log('🔍 [UserStatus] Update handler called');
    }
    
    // Handle force logout scenarios - only for actual deactivation/deletion
    if (newUserStatus.forceLogout) {
      // console.log('🔐 Force logout detected. Logging out...');
      
      // Clear all local storage and session data
      localStorage.clear();
      sessionStorage.clear();
      
      // Force logout
      handleLogout();
      return;
    }
    
    // Handle permission changes (soft updates) - only if we have a previous status to compare
    const prevCanMutate = previousStatus?.canMutate ?? previousStatus?.isAdmin;
    const nextCanMutate = newUserStatus.canMutate ?? !newUserStatus.isViewer;
    if (
      previousStatus !== null &&
      (previousStatus.isAdmin !== newUserStatus.isAdmin || prevCanMutate !== nextCanMutate)
    ) {
      handleProfileUpdated().catch((error) => {
        console.error('Failed to refresh user profile after permission change:', error);
      });
    }
    
    // Update both state and ref - but only update state if values actually changed
    userStatusRef.current = newUserStatus;
    
    // Only trigger state update if the values actually changed to prevent unnecessary re-renders
    if (previousStatus === null || 
        previousStatus.isActive !== newUserStatus.isActive ||
        previousStatus.isAdmin !== newUserStatus.isAdmin ||
        previousStatus.canMutate !== newUserStatus.canMutate ||
        previousStatus.isViewer !== newUserStatus.isViewer ||
        previousStatus.forceLogout !== newUserStatus.forceLogout) {
      setUserStatus(newUserStatus);
    }
  };

  
  // Custom hooks
  const showDebug = useDebug();

  const keyboardShortcutApiRef = useRef<{
    openHelp: () => void;
    focusSearch: () => void;
    newTask: () => void;
    setViewMode: (mode: ViewMode) => void;
    setTaskViewMode: (mode: TaskViewMode) => void;
    toggleSearchPanel: () => void;
  }>({
    openHelp: () => {},
    focusSearch: () => {},
    newTask: () => {},
    setViewMode: () => {},
    setTaskViewMode: () => {},
    toggleSearchPanel: () => {},
  });

  const openHelpShortcut = useCallback(() => {
    keyboardShortcutApiRef.current.openHelp();
  }, []);
  const focusSearchShortcut = useCallback(() => {
    keyboardShortcutApiRef.current.focusSearch();
  }, []);
  const newTaskShortcut = useCallback(() => {
    keyboardShortcutApiRef.current.newTask();
  }, []);
  const viewModeShortcut = useCallback((mode: ViewMode) => {
    keyboardShortcutApiRef.current.setViewMode(mode);
  }, []);
  const taskViewModeShortcut = useCallback((mode: TaskViewMode) => {
    keyboardShortcutApiRef.current.setTaskViewMode(mode);
  }, []);
  const toggleSearchPanelShortcut = useCallback(() => {
    keyboardShortcutApiRef.current.toggleSearchPanel();
  }, []);

  useKeyboardShortcuts({
    onHelp: openHelpShortcut,
    onFocusSearch: focusSearchShortcut,
    onNewTask: newTaskShortcut,
    onViewMode: viewModeShortcut,
    onTaskViewMode: taskViewModeShortcut,
    onToggleSearchPanel: toggleSearchPanelShortcut,
    boardShortcutsEnabled: isAuthenticated && currentPage === 'kanban',
  });
  
  // Initialize task deletion confirmation hook
  const taskDeleteConfirmation = useTaskDeleteConfirmation({
    currentUser,
    systemSettings,
    onDelete: handleTaskDelete,
    onPurge: currentUser?.roles?.includes('admin') ? handleTaskPermanentDelete : undefined
  });

  // Now define the handleRemoveTask function
  handleRemoveTask = async (taskId: string, clickEvent?: React.MouseEvent) => {
    if (!canMutate) {
      toast.error(t('messages.readOnlyMode', { ns: 'common' }), '');
      return;
    }
    // If the task being deleted is currently open in TaskDetails, close it first
    if (selectedTask && selectedTask.id === taskId) {
      handleSelectTask(null);
    }

    // Find the full task object from the columns
    let taskToDelete: Task | null = null;
    Object.values(columns).forEach(column => {
      const foundTask = column.tasks.find(task => task.id === taskId);
      if (foundTask) {
        taskToDelete = foundTask;
      }
    });

    if (taskToDelete) {
      await taskDeleteConfirmation.deleteTask(taskToDelete, clickEvent);
    } else {
      // If task not found in local state, create minimal object and delete
      await taskDeleteConfirmation.deleteTask({ id: taskId } as Task, clickEvent);
    }
  };
  
  // Close task delete confirmation when clicking outside
  useEffect(() => {
    if (!taskDeleteConfirmation.confirmationTask) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Don't close if clicking on the delete confirmation popup or its children
      if (target.closest('.delete-confirmation')) {
        return;
      }
      taskDeleteConfirmation.cancelDelete();
    };

    // Use a small delay to avoid interfering with the initial click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [taskDeleteConfirmation.confirmationTask, taskDeleteConfirmation.cancelDelete]);

  // Note: Activity feed settings are now loaded together with other user preferences
  // in the consolidated useEffect below to avoid duplicate API calls

  // Load admin defaults for new user preferences (all authenticated users)
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const initializeAdminDefaults = async () => {
      try {
        await loadAdminDefaults();
      } catch (error) {
        // console.warn('Failed to load admin defaults:', error);
      }
    };
    
    initializeAdminDefaults();
  }, [isAuthenticated]); // Run when authentication status changes

  // Initialize i18n and change language based on user preferences or browser language
  const { i18n } = useTranslation();
  
  // Load auto-refresh setting and sprint selection from user preferences
  useEffect(() => {
    if (currentUser) {
      const restorePreferences = async () => {
        try {
          // Load preferences from database (not just cookies)
          const prefs = await loadUserPreferencesAsync(currentUser.id);
          
          // Language sync (login ↔ app):
          // 1) Explicit choice made on login/guest screens wins and is saved as user pref
          // 2) Else existing user pref from DB
          // 3) Else seed from browser → APP_LANGUAGE and save once
          const dbSettings = await getUserSettings();
          const dbLang = normalizeAppLanguage(dbSettings?.language);
          const explicitGuest = getExplicitGuestLanguage();
          let languageToUse: 'en' | 'fr';

          if (explicitGuest) {
            languageToUse = explicitGuest;
            if (dbLang !== explicitGuest) {
              await updateUserPreference('language', explicitGuest, currentUser.id);
            }
          } else if (dbLang) {
            languageToUse = dbLang;
            // Keep login screen aligned after logout
            setExplicitGuestLanguage(dbLang);
          } else {
            languageToUse = resolveGuestLanguage({
              appLanguage: siteSettings?.APP_LANGUAGE || systemSettings?.APP_LANGUAGE,
              browserLanguage: navigator.language || (navigator as any).userLanguage,
            });
            await updateUserPreference('language', languageToUse, currentUser.id);
            setExplicitGuestLanguage(languageToUse);
          }
          
          // Change i18n language if needed
          if (i18n.language !== languageToUse) {
            await i18n.changeLanguage(languageToUse);
          }
          
          // Refetch activity feed with new language
          try {
            const loadedActivities = await getActivityFeed(20, languageToUse);
            activityFeed.setActivities(loadedActivities || []);
          } catch (error) {
            console.warn('Failed to refetch activity feed after language change:', error);
          }
          
          // setIsAutoRefreshEnabled(prefs.appSettings.autoRefreshEnabled ?? true); // Disabled - using real-time updates
          
          // Restore sprint selection and apply date filters
          const savedSprintId = prefs.selectedSprintId;
          
          if (savedSprintId) {
            // Simply restore the sprint selection (no date filter manipulation)
            taskFilters.setSelectedSprintId(savedSprintId);
          } else {
            // No saved sprint, make sure state is cleared
            taskFilters.setSelectedSprintId(null);
          }

          // Restore per-board column visibility (e.g. Archive shown until user hides it)
          if (prefs.boardColumnVisibility && typeof prefs.boardColumnVisibility === 'object') {
            setBoardColumnVisibility(prefs.boardColumnVisibility);
          }
        } catch (error) {
          console.error('Failed to restore preferences:', error);
        } finally {
          setLanguageLoaded(true);
        }
      };
      
      restorePreferences();
    } else {
      if (settingsLoading) return;

      if (isDemoModeClient()) {
        let sessionLang: string | null = null;
        try {
          sessionLang = sessionStorage.getItem('ekDemoSessionLang');
        } catch {
          sessionLang = null;
        }
        const demoLang = normalizeAppLanguage(sessionLang);
        if (demoLang && i18n.language !== demoLang) {
          void i18n.changeLanguage(demoLang);
        }
        setLanguageLoaded(true);
        return;
      }

      const guestLang = resolveGuestLanguage({
        appLanguage: siteSettings?.APP_LANGUAGE || systemSettings?.APP_LANGUAGE,
        browserLanguage: navigator.language || (navigator as any).userLanguage,
      });
      if (i18n.language !== guestLang) {
        void i18n.changeLanguage(guestLang);
      }
      setLanguageLoaded(true);
    }
  }, [currentUser, i18n, settingsLoading, siteSettings?.APP_LANGUAGE, systemSettings?.APP_LANGUAGE]);

  // Refetch activity feed when language changes
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) return;
    
    const refetchActivities = async () => {
      try {
        const currentLang = i18n.language || 'en';
        const normalizedLang = currentLang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
        const loadedActivities = await getActivityFeed(20, normalizedLang);
        activityFeed.setActivities(loadedActivities || []);
      } catch (error) {
        console.warn('Failed to refetch activity feed after language change:', error);
      }
    };
    
    refetchActivities();
  }, [i18n.language, isAuthenticated, currentUser?.id]);

  // Auto-refresh toggle handler - DISABLED (using real-time updates)
  // const handleToggleAutoRefresh = useCallback(async () => {
  //   const newValue = !isAutoRefreshEnabled;
  //   setIsAutoRefreshEnabled(newValue);
  //   
  //   // Save to user preferences
  //   if (currentUser) {
  //     try {
  //       await updateUserPreference('appSettings', {
  //         ...loadUserPreferences(currentUser.id).appSettings,
  //         autoRefreshEnabled: newValue
  //       }, currentUser.id);
  //     } catch (error) {
  //       // console.error('Failed to save auto-refresh preference:', error);
  //     }
  //   }
  // }, [isAutoRefreshEnabled, currentUser]);

  // Activity feed handlers extracted to useActivityFeed hook (activityFeed)
  
  const handleRelationshipsUpdate = useCallback((newRelationships: any[]) => {
    // console.log('🔗 [App] handleRelationshipsUpdate called with:', newRelationships.length, 'relationships');
    taskLinking.setBoardRelationships(Array.isArray(newRelationships) ? newRelationships : []);
    taskLinking.setTaskRelationships({}); // Clear Kanban hover cache to force fresh data
  }, [taskLinking]);

  // Relationships are now loaded in the board selection effect below to avoid duplicate calls

  // Stable callback functions to prevent infinite useEffect loops in useDataPolling
  const handleMembersUpdate = useCallback((newMembers: TeamMember[]) => {
    if (!modalState.isProfileBeingEdited) {
      setMembers(Array.isArray(newMembers) ? newMembers : []);
    }
  }, [modalState.isProfileBeingEdited]);

  const handleActivitiesUpdate = useCallback((newActivities: any[]) => {
    activityFeed.setActivities(newActivities);
  }, [activityFeed]);

  const handleSharedFilterViewsUpdate = useCallback((newFilters: SavedFilterView[]) => {
    taskFilters.setSharedFilterViews(prev => {
      // Merge new filters with existing ones, avoiding duplicates
      const existingIds = new Set(prev.map(f => f.id));
      const newFiltersToAdd = newFilters.filter(f => !existingIds.has(f.id));
      return [...prev, ...newFiltersToAdd];
    });
  }, [taskFilters.setSharedFilterViews]);

  // Data polling for backup/fallback only (WebSocket handles real-time updates)
  // Disable polling when help modal is open or auto-refresh is disabled
  // Only poll every 60 seconds as backup when WebSocket might be unavailable
  const shouldPoll = false; // Temporarily disable polling to test WebSocket updates
  
  
  const { isPolling, lastPollTime, updateLastPollTime } = useDataPolling({
    enabled: shouldPoll,
    selectedBoard,
    currentBoards: boards,
    currentMembers: members,
    currentColumns: columns,
    // currentSiteSettings removed - SettingsContext handles all settings
    currentPriorities: availablePriorities,
    currentActivities: activityFeed.activities,
    currentSharedFilters: taskFilters.sharedFilterViews,
    currentRelationships: taskLinking.boardRelationships,
    includeSystem: taskFilters.includeSystem,
    onBoardsUpdate: setBoards,
    onMembersUpdate: handleMembersUpdate,
    onColumnsUpdate: setColumns,
    // onSiteSettingsUpdate removed - SettingsContext handles all settings updates
    onPrioritiesUpdate: setAvailablePriorities,
    onActivitiesUpdate: handleActivitiesUpdate,
    onSharedFiltersUpdate: taskFilters.setSharedFilterViews,
    onRelationshipsUpdate: handleRelationshipsUpdate,
  });

  // Separate lightweight polling for user status on all pages
  useEffect(() => {
    if (!isAuthenticated) return;

    let statusInterval: NodeJS.Timeout | null = null;
    let isPolling = false;

    const pollUserStatus = async () => {
      // Skip polling if we're currently saving preferences to avoid conflicts
      if (isSavingPreferences) {
        if (process.env.NODE_ENV === 'development') {
          // console.log('⏸️ [UserStatus] Skipping poll - preferences being saved');
        }
        return;
      }

      // Prevent overlapping polls
      if (isPolling) return;
      isPolling = true;

      try {
        const startTime = performance.now();
        const [newUserStatus] = await Promise.all([
          getUserStatus()
        ]);
        const apiTime = performance.now() - startTime;
        
        // Reduced logging to avoid performance violations
        if (process.env.NODE_ENV === 'development') {
          // console.log(`🔍 [UserStatus] Polled status (API: ${apiTime.toFixed(1)}ms)`);
        }
        
        const updateStartTime = performance.now();
        handleUserStatusUpdate(newUserStatus);
        
        const updateTime = performance.now() - updateStartTime;
        
        if (process.env.NODE_ENV === 'development' && updateTime > 50) {
          // console.log(`⚠️ [UserStatus] Update handler took ${updateTime.toFixed(1)}ms`);
        }
      } catch (error: any) {
        // Handle user account deletion (404 error)
        if (error?.response?.status === 404) {
          if (feDebug('FE_DEBUG_AUTH')) console.log('🔐 User account no longer exists - forcing logout');
          
          // Clear all local storage and session data
          localStorage.clear();
          sessionStorage.clear();
          
          // Force logout
          handleLogout();
          return;
        }
        
        // For other errors (network issues, etc.), just log
        // console.error('❌ [UserStatus] Polling failed:', error);
      } finally {
        isPolling = false;
      }
    };

    // Initial check
    pollUserStatus();

    // Poll every 30 seconds for user status updates (reduced frequency to improve performance)
    statusInterval = setInterval(pollUserStatus, 30000);

    return () => {
      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
      }
    };
  }, [isAuthenticated, isSavingPreferences]);


  // Check instance status on page load
  useEffect(() => {
    const checkInitialInstanceStatus = async () => {
      try {
        const response = await api.get('/auth/instance-status');
        if (!response.data.isActive) {
          versionStatus.setInstanceStatus({
            status: response.data.status,
            message: response.data.message,
            isDismissed: false
          });
        }
      } catch (error) {
        // If we can't check status, assume it's active
        console.warn('Failed to check initial instance status:', error);
      }
    };

    if (isAuthenticated) {
      checkInitialInstanceStatus();
    }
  }, [isAuthenticated]);
  // Track if we've had our first successful connection and if we were offline
  const hasConnectedOnceRef = useRef(false);
  const wasOfflineRef = useRef(false);
  
  // Track network online/offline state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Store the latest refreshBoardData function in a ref so we always call the current version
  const refreshBoardDataRef = useRef<
    ((options?: { force?: boolean; forBoardId?: string }) => Promise<void>) | null
  >(null);
  
  // Track pending task refreshes (to cancel fallback if WebSocket event arrives)
  const pendingTaskRefreshesRef = useRef<Set<string>>(new Set());
  
  // Track recently deleted tasks to prevent them from reappearing via WebSocket updates or refreshBoardData
  const recentlyDeletedTasksRef = useRef<Set<string>>(new Set());
  const taskWebSocketRef = useRef<{
    handleTaskRestored?: (data: any) => void;
  } | null>(null);

  // Initialize WebSocket hooks after all dependencies are available
  const taskWebSocket = useTaskWebSocket({
    setBoards,
    setColumns,
    setSelectedTask,
    selectedBoardRef,
    pendingTaskRefreshesRef,
    refreshBoardDataRef,
    recentlyDeletedTasksRef,
    taskFilters: {
      setFilteredColumns: taskFilters.setFilteredColumns,
      viewModeRef: taskFilters.viewModeRef,
      shouldIncludeTaskRef: taskFilters.shouldIncludeTaskRef,
    },
    taskLinking,
    currentUser,
    selectedTask,
  });
  taskWebSocketRef.current = taskWebSocket;

  const commentWebSocket = useCommentWebSocket({
    setBoards,
    setColumns,
    setSelectedTask,
    selectedBoardRef,
    selectedTask,
  });

  const columnWebSocket = useColumnWebSocket({
    setBoards,
    setColumns,
    selectedBoardRef,
    currentUser,
  });

  const boardWebSocket = useBoardWebSocket({
    setSelectedBoard,
    setColumns,
    setBoards,
    setSelectedTask,
    onSelectBoard: handleBoardSelection,
    onClearSelectedTask: () => handleSelectTask(null),
    selectedBoardRef,
    refreshBoardDataRef,
  });

  const memberWebSocket = useMemberWebSocket({
    setMembers,
    setCurrentUser,
    handleMembersUpdate,
    handleActivitiesUpdate,
    handleSharedFilterViewsUpdate,
    taskFilters: {
      includeSystem: taskFilters.includeSystem,
      setSharedFilterViews: taskFilters.setSharedFilterViews,
    },
    currentUser,
  });

  const settingsWebSocket = useSettingsWebSocket({
    setAvailableTags,
    setAvailablePriorities,
    setAvailableSprints,
    // setSiteSettings removed - use refreshContextSettings from SettingsContext instead
    refreshMembers: async () => {
      const loadedMembers = await getMembers(taskFilters.includeSystem);
      setMembers(Array.isArray(loadedMembers) ? loadedMembers : []);
    },
    versionStatus,
  });

  const websocketConnection = useWebSocketConnection({
    setIsOnline,
    selectedBoardRef,
    refreshBoardDataRef,
    hasConnectedOnceRef,
    wasOfflineRef,
    activityFeed,
  });
  
  // Memoize WebSocket event handlers to prevent duplicate registrations
  // NOTE: Handlers are now provided by the hooks above

  // ============================================================================
  // WEBSOCKET CONNECTION EFFECT
  // ============================================================================
  // Register all memoized handlers and connect
  
  useEffect(() => {
    if (!isAuthenticated || !localStorage.getItem('authToken')) {
      return;
    }

    // Register handlers BEFORE connecting
    websocketClient.onWebSocketReady(websocketConnection.handleWebSocketReady);
    websocketClient.onConnect(websocketConnection.handleReconnect);
    websocketClient.onDisconnect(websocketConnection.handleDisconnect);

    // Listen to browser online/offline events
    window.addEventListener('online', websocketConnection.handleBrowserOnline);
    window.addEventListener('offline', websocketConnection.handleBrowserOffline);

    // Connect to WebSocket only when we have a valid token
    websocketClient.connect();
    
    // Register all event listeners
    websocketClient.onTaskCreated(taskWebSocket.handleTaskCreated);
    websocketClient.onTaskUpdated(taskWebSocket.handleTaskUpdated);
    websocketClient.onTaskDeleted(taskWebSocket.handleTaskDeleted);
    websocketClient.onTaskRestored(taskWebSocket.handleTaskRestored);
    websocketClient.onTaskPurged(taskWebSocket.handleTaskPurged);
    websocketClient.onTasksPositionsUpdated(taskWebSocket.handleTasksPositionsUpdated);
    websocketClient.onTaskRelationshipCreated(taskWebSocket.handleTaskRelationshipCreated);
    websocketClient.onTaskRelationshipDeleted(taskWebSocket.handleTaskRelationshipDeleted);
    websocketClient.onColumnUpdated(columnWebSocket.handleColumnUpdated);
    websocketClient.onColumnDeleted(columnWebSocket.handleColumnDeleted);
    websocketClient.onColumnReordered(columnWebSocket.handleColumnReordered);
    websocketClient.onBoardCreated(boardWebSocket.handleBoardCreated);
    websocketClient.onBoardUpdated(boardWebSocket.handleBoardUpdated);
    websocketClient.onBoardDeleted(boardWebSocket.handleBoardDeleted);
    websocketClient.onBoardRestored(boardWebSocket.handleBoardRestored);
    websocketClient.onBoardReordered(boardWebSocket.handleBoardReordered);
    websocketClient.onColumnCreated(columnWebSocket.handleColumnCreated);
    websocketClient.onTaskWatcherAdded(taskWebSocket.handleTaskWatcherAdded);
    websocketClient.onTaskWatcherRemoved(taskWebSocket.handleTaskWatcherRemoved);
    websocketClient.onTaskCollaboratorAdded(taskWebSocket.handleTaskCollaboratorAdded);
    websocketClient.onTaskCollaboratorRemoved(taskWebSocket.handleTaskCollaboratorRemoved);
    websocketClient.onMemberUpdated(memberWebSocket.handleMemberUpdated);
    websocketClient.onMemberCreated(memberWebSocket.handleMemberCreated);
    websocketClient.onMemberDeleted(memberWebSocket.handleMemberDeleted);
    websocketClient.onUserDeleted(memberWebSocket.handleUserDeleted);
    websocketClient.onUserProfileUpdated(memberWebSocket.handleUserProfileUpdated);
    websocketClient.onActivityUpdated(memberWebSocket.handleActivityUpdated);
    websocketClient.onFilterCreated(memberWebSocket.handleFilterCreated);
    websocketClient.onFilterUpdated(memberWebSocket.handleFilterUpdated);
    websocketClient.onFilterDeleted(memberWebSocket.handleFilterDeleted);
    websocketClient.onTagCreated(settingsWebSocket.handleTagCreated);
    websocketClient.onTagUpdated(settingsWebSocket.handleTagUpdated);
    websocketClient.onTagDeleted(settingsWebSocket.handleTagDeleted);
    websocketClient.onTagDeleted(taskWebSocket.handleTagDeleted);
    websocketClient.onPriorityCreated(settingsWebSocket.handlePriorityCreated);
    websocketClient.onPriorityUpdated(settingsWebSocket.handlePriorityUpdated);
    websocketClient.onPriorityDeleted(settingsWebSocket.handlePriorityDeleted);
    websocketClient.onPriorityReordered(settingsWebSocket.handlePriorityReordered);
    websocketClient.onSprintCreated(settingsWebSocket.handleSprintCreated);
    websocketClient.onSprintUpdated(settingsWebSocket.handleSprintUpdated);
    websocketClient.onSprintDeleted(settingsWebSocket.handleSprintDeleted);
    websocketClient.onSettingsUpdated(settingsWebSocket.handleSettingsUpdated);
    websocketClient.onTaskTagAdded(taskWebSocket.handleTaskTagAdded);
    websocketClient.onTaskTagRemoved(taskWebSocket.handleTaskTagRemoved);
    websocketClient.onInstanceStatusUpdated(settingsWebSocket.handleInstanceStatusUpdated);
    websocketClient.onVersionUpdated(settingsWebSocket.handleVersionUpdated);
    websocketClient.onCommentCreated(commentWebSocket.handleCommentCreated);
    websocketClient.onCommentUpdated(commentWebSocket.handleCommentUpdated);
    websocketClient.onCommentDeleted(commentWebSocket.handleCommentDeleted);

    return () => {
      // Clean up event listeners
      websocketClient.offTaskCreated(taskWebSocket.handleTaskCreated);
      websocketClient.offTaskUpdated(taskWebSocket.handleTaskUpdated);
      websocketClient.offTaskDeleted(taskWebSocket.handleTaskDeleted);
      websocketClient.offTaskRestored(taskWebSocket.handleTaskRestored);
      websocketClient.offTaskPurged(taskWebSocket.handleTaskPurged);
      websocketClient.offTasksPositionsUpdated(taskWebSocket.handleTasksPositionsUpdated);
      websocketClient.offTaskRelationshipCreated(taskWebSocket.handleTaskRelationshipCreated);
      websocketClient.offTaskRelationshipDeleted(taskWebSocket.handleTaskRelationshipDeleted);
      websocketClient.offColumnUpdated(columnWebSocket.handleColumnUpdated);
      websocketClient.offColumnDeleted(columnWebSocket.handleColumnDeleted);
      websocketClient.offColumnReordered(columnWebSocket.handleColumnReordered);
      websocketClient.offBoardCreated(boardWebSocket.handleBoardCreated);
      websocketClient.offBoardUpdated(boardWebSocket.handleBoardUpdated);
      websocketClient.offBoardDeleted(boardWebSocket.handleBoardDeleted);
      websocketClient.offBoardRestored(boardWebSocket.handleBoardRestored);
      websocketClient.offBoardReordered(boardWebSocket.handleBoardReordered);
      websocketClient.offColumnCreated(columnWebSocket.handleColumnCreated);
      websocketClient.offTaskWatcherAdded(taskWebSocket.handleTaskWatcherAdded);
      websocketClient.offTaskWatcherRemoved(taskWebSocket.handleTaskWatcherRemoved);
      websocketClient.offTaskCollaboratorAdded(taskWebSocket.handleTaskCollaboratorAdded);
      websocketClient.offTaskCollaboratorRemoved(taskWebSocket.handleTaskCollaboratorRemoved);
      websocketClient.offMemberUpdated(memberWebSocket.handleMemberUpdated);
      websocketClient.offMemberCreated(memberWebSocket.handleMemberCreated);
      websocketClient.offMemberDeleted(memberWebSocket.handleMemberDeleted);
      websocketClient.offUserDeleted(memberWebSocket.handleUserDeleted);
      websocketClient.offUserProfileUpdated(memberWebSocket.handleUserProfileUpdated);
      websocketClient.offActivityUpdated(memberWebSocket.handleActivityUpdated);
      websocketClient.offFilterCreated(memberWebSocket.handleFilterCreated);
      websocketClient.offFilterUpdated(memberWebSocket.handleFilterUpdated);
      websocketClient.offFilterDeleted(memberWebSocket.handleFilterDeleted);
      websocketClient.offTagCreated(settingsWebSocket.handleTagCreated);
      websocketClient.offTagUpdated(settingsWebSocket.handleTagUpdated);
      websocketClient.offTagDeleted(settingsWebSocket.handleTagDeleted);
      websocketClient.offTagDeleted(taskWebSocket.handleTagDeleted);
      websocketClient.offPriorityCreated(settingsWebSocket.handlePriorityCreated);
      websocketClient.offPriorityUpdated(settingsWebSocket.handlePriorityUpdated);
      websocketClient.offPriorityDeleted(settingsWebSocket.handlePriorityDeleted);
      websocketClient.offPriorityReordered(settingsWebSocket.handlePriorityReordered);
      websocketClient.offSprintCreated(settingsWebSocket.handleSprintCreated);
      websocketClient.offSprintUpdated(settingsWebSocket.handleSprintUpdated);
      websocketClient.offSprintDeleted(settingsWebSocket.handleSprintDeleted);
      websocketClient.offSettingsUpdated(settingsWebSocket.handleSettingsUpdated);
      websocketClient.offTaskTagAdded(taskWebSocket.handleTaskTagAdded);
      websocketClient.offTaskTagRemoved(taskWebSocket.handleTaskTagRemoved);
      websocketClient.offInstanceStatusUpdated(settingsWebSocket.handleInstanceStatusUpdated);
      websocketClient.offVersionUpdated(settingsWebSocket.handleVersionUpdated);
      websocketClient.offCommentCreated(commentWebSocket.handleCommentCreated);
      websocketClient.offCommentUpdated(commentWebSocket.handleCommentUpdated);
      websocketClient.offCommentDeleted(commentWebSocket.handleCommentDeleted);
      websocketClient.offWebSocketReady(websocketConnection.handleWebSocketReady);
      websocketClient.offConnect(websocketConnection.handleReconnect);
      websocketClient.offDisconnect(websocketConnection.handleDisconnect);
      window.removeEventListener('online', websocketConnection.handleBrowserOnline);
      window.removeEventListener('offline', websocketConnection.handleBrowserOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]); // Only depend on isAuthenticated - handlers are memoized with useCallback in hooks

  // Join board when selectedBoard changes
  useEffect(() => {
    if (selectedBoard) {
      websocketClient.joinBoardWhenReady(selectedBoard);
    }
  }, [selectedBoard]);

  // Restore selected task from preferences when tasks are loaded
  useEffect(() => {
    // Load fresh preferences to get the most up-to-date selectedTaskId
    const freshPrefs = loadUserPreferences();
    const savedTaskId = freshPrefs.selectedTaskId;
    
    if (savedTaskId && !selectedTask && Object.keys(columns).length > 0) {
      // Find the task in all columns
      for (const column of Object.values(columns)) {
        const foundTask = column.tasks.find(task => task.id === savedTaskId);
        if (foundTask) {
          setSelectedTask(foundTask);
          break;
        }
      }
    }
  }, [columns, selectedTask]);

  // Join board when selectedBoard changes
  useEffect(() => {
    if (selectedBoard) {
      websocketClient.joinBoardWhenReady(selectedBoard);
    }
  }, [selectedBoard]);

  // Restore selected task from preferences when tasks are loaded
  useEffect(() => {
    // Load fresh preferences to get the most up-to-date selectedTaskId
    const freshPrefs = loadUserPreferences();
    const savedTaskId = freshPrefs.selectedTaskId;
    
    if (savedTaskId && !selectedTask && Object.keys(columns).length > 0) {
      // Find the task in all columns
      for (const column of Object.values(columns)) {
        const foundTask = column.tasks.find(task => task.id === savedTaskId);
        if (foundTask) {
          setSelectedTask(foundTask);
          break;
        }
      }
    }
  }, [columns, selectedTask]);

  // Update selectedTask when columns data is refreshed (for auto-refresh comments)
  useEffect(() => {
    if (selectedTask && Object.keys(columns).length > 0) {
      // Find the updated version of the selected task in the refreshed data
      for (const column of Object.values(columns)) {
        const updatedTask = column.tasks.find(task => task.id === selectedTask.id);
        if (updatedTask) {
          // Live board tasks are never soft-deleted; clear markers so a stale
          // snake_case deleted_at from TaskDetails open cannot re-lock the UI.
          const normalizedLive = clearTaskSoftDelete(updatedTask);
          if (JSON.stringify(normalizedLive) !== JSON.stringify(selectedTask)) {
            setSelectedTask(normalizedLive);
          }
          break;
        }
      }
    }
  }, [columns]); // Remove selectedTask from deps to avoid infinite loops

  // Invite user handler
  const handleInviteUser = async (email: string) => {
    return handleInviteUserUtil(email, handleRefreshData);
  };



  // Mock socket object for compatibility with existing UI (removed unused variable)

  // Header event handlers
  const adminDraftGateRef = useRef<AdminDraftGate>(EMPTY_ADMIN_DRAFT_GATE);
  const [adminDraftGate, setAdminDraftGate] = useState<AdminDraftGate>(EMPTY_ADMIN_DRAFT_GATE);
  const adminLeaveBypassRef = useRef(false);
  const adminHashRef = useRef('admin');
  const [adminLeavePrompt, setAdminLeavePrompt] = useState<{
    page: 'kanban' | 'admin' | 'reports' | 'test';
    options?: { hash?: string };
  } | null>(null);

  const handleAdminDraftGateChange = useCallback((gate: AdminDraftGate | null) => {
    const next = gate ?? EMPTY_ADMIN_DRAFT_GATE;
    adminDraftGateRef.current = next;
    setAdminDraftGate(next);
  }, []);

  useEffect(() => {
    if (currentPage !== 'admin') return;
    const h = window.location.hash.replace(/^#/, '') || 'admin';
    if (h === 'admin' || h.startsWith('admin#')) {
      adminHashRef.current = h;
    }
  });

  const adminHasUnsavedDrafts = () =>
    adminDraftGateRef.current.hasSharedDirty || adminDraftGateRef.current.hasLocalDirty;

  /** Optional `hash` avoids clobbering Admin tab deep-links (e.g. admin#tags). */
  const applyPageChange = (
    page: 'kanban' | 'admin' | 'reports' | 'test',
    options?: { hash?: string }
  ) => {
    setCurrentPage(page);
    if (options?.hash) {
      // Keep leading-hash-free form; Admin also listens for easy-kanban:admin-navigate
      window.location.hash = options.hash.replace(/^#/, '');
      return;
    }
    if (page === 'kanban') {
      // If there was a previously selected board, restore it
      if (selectedBoard) {
        window.location.hash = `kanban#${selectedBoard}`;
      } else {
        window.location.hash = 'kanban';
      }
    } else if (page === 'reports') {
      window.location.hash = 'reports';
    } else if (page === 'admin') {
      window.location.hash = 'admin';
    } else {
      window.location.hash = page;
    }
  };

  const handlePageChange = (
    page: 'kanban' | 'admin' | 'reports' | 'test',
    options?: { hash?: string }
  ) => {
    if (
      currentPage === 'admin' &&
      page !== 'admin' &&
      adminHasUnsavedDrafts() &&
      !adminLeaveBypassRef.current
    ) {
      setAdminLeavePrompt({ page, options });
      return;
    }
    applyPageChange(page, options);
  };

  const handleAdminLeaveStay = useCallback(() => {
    setAdminLeavePrompt(null);
  }, []);

  const handleAdminLeaveConfirm = useCallback(() => {
    const pending = adminLeavePrompt;
    setAdminLeavePrompt(null);
    if (!pending) return;
    adminLeaveBypassRef.current = true;
    applyPageChange(pending.page, pending.options);
    window.setTimeout(() => {
      adminLeaveBypassRef.current = false;
    }, 0);
  }, [adminLeavePrompt, selectedBoard]);

  const handleRefreshData = async () => {
    try {
      // Refresh all data in parallel for better performance
      const [loadedMembers, loadedPriorities, loadedTags, loadedSprints] = await Promise.all([
        getMembers(taskFilters.includeSystem),
        getAllPriorities(),
        getAllTags(),
        getAllSprints()
      ]);

      // Update all state
      setMembers(loadedMembers);
      setAvailablePriorities(loadedPriorities || []);
      setAvailableTags(loadedTags || []);
      setAvailableSprints(loadedSprints || []);
      // Settings are now loaded by SettingsContext - no need to fetch here

      // Refresh board data (includes all boards, columns, and tasks)
      await refreshBoardData();
    } catch (error) {
      console.error('Failed to refresh data:', error);
      // Still try to refresh board data even if other data fails
      await refreshBoardData();
    }
    // updateLastPollTime(); // Removed - no longer using polling system
  };

  // Task linking handlers
  const handleStartLinking = (task: Task, startPosition: {x: number, y: number}) => {
    if (feDebug('FE_DEBUG_TASK_LINKING')) console.log('🔗 handleStartLinking called:', {
      taskTicket: task.ticket,
      taskId: task.id,
      startPosition
    });
    taskLinking.setIsLinkingMode(true);
    taskLinking.setLinkingSourceTask(task);
    // For fixed overlay, coordinates should be viewport-relative (clientX/clientY)
    // The overlay uses getBoundingClientRect() which for fixed elements returns viewport coordinates
    taskLinking.setLinkingLine({
      startX: startPosition.x,
      startY: startPosition.y,
      endX: startPosition.x,
      endY: startPosition.y
    });
    if (feDebug('FE_DEBUG_TASK_LINKING')) {
      console.log('✅ Linking mode activated, linkingLine set:', {
        startX: startPosition.x,
        startY: startPosition.y,
        endX: startPosition.x,
        endY: startPosition.y
      });
    }
  };

  const handleUpdateLinkingLine = (endPosition: {x: number, y: number}) => {
    if (taskLinking.linkingLine) {
      if (feDebug('FE_DEBUG_TASK_LINKING')) console.log('🔗 handleUpdateLinkingLine called:', { endPosition, currentLine: taskLinking.linkingLine });
      taskLinking.setLinkingLine({
        ...taskLinking.linkingLine,
        endX: endPosition.x,
        endY: endPosition.y
      });
    } else {
      console.warn('🔗 handleUpdateLinkingLine called but linkingLine is null');
    }
  };

  const linkingFinishInFlightRef = useRef(false);

  const resetLinkingUi = () => {
    taskLinking.setIsLinkingMode(false);
    taskLinking.setLinkingSourceTask(null);
    taskLinking.setLinkingLine(null);
  };

  const handleFinishLinking = async (
    targetTask: Task | null,
    relationshipType: 'parent' | 'child' | 'related' = 'parent'
  ) => {
    if (linkingFinishInFlightRef.current) return;
    linkingFinishInFlightRef.current = true;

    const sourceTask = taskLinking.linkingSourceTask;
    const relationshipLabel =
      relationshipType === 'parent'
        ? t('relationships.relationshipParent')
        : relationshipType === 'child'
          ? t('relationships.relationshipChild')
          : t('relationships.relationshipRelated');

    try {
      if (sourceTask && targetTask && sourceTask.id !== targetTask.id) {
        try {
          const token = localStorage.getItem('authToken');
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }

          const response = await fetch(`/api/tasks/${sourceTask.id}/relationships`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              relationship: relationshipType,
              toTaskId: targetTask.id,
            }),
          });

          if (!response.ok) {
            let errorMessage = t('relationships.linkFailedTitle');
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorMessage;
            } catch {
              try {
                const errorText = await response.text();
                errorMessage = errorText || errorMessage;
              } catch {
                // keep default
              }
            }
            const err = new Error(errorMessage) as Error & { status?: number };
            err.status = response.status;
            throw err;
          }

          await response.json();
          toast.success(
            t('relationships.linkCreatedTitle'),
            t('relationships.linkCreatedMessage', {
              from: sourceTask.ticket,
              to: targetTask.ticket,
              relationship: relationshipLabel,
            })
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : t('relationships.linkFailedTitle');
          const status = (error as Error & { status?: number })?.status;
          const alreadyExists =
            status === 409 ||
            /already exists|existe déjà/i.test(errorMessage);
          if (alreadyExists) {
            toast.warning(t('relationships.linkAlreadyExistsTitle'), errorMessage);
          } else {
            toast.error(t('relationships.linkFailedTitle'), errorMessage);
          }
        }
      } else {
        toast.info(t('relationships.linkCancelledTitle'), t('relationships.linkCancelledMessage'));
      }
    } finally {
      resetLinkingUi();
      linkingFinishInFlightRef.current = false;
    }
  };

  const handleCancelLinking = () => {
    if (linkingFinishInFlightRef.current) return;
    resetLinkingUi();
    toast.info(t('relationships.linkCancelledTitle'), t('relationships.linkCancelledMessage'));
  };

  // Hover highlighting handlers
  // When user hovers over a link tool button, highlight all related tasks with color-coded borders:
  // - Green: Parent tasks (tasks that this one depends on)
  // - Purple: Child tasks (tasks that depend on this one)  
  // - Yellow: Related tasks (loosely connected tasks)
  const linkHoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlinkInFlightRef = useRef(false);
  /** Sync focus for Shift+click unlink (state can lag / clear before click). */
  const highlightFocusTaskRef = useRef<Task | null>(null);
  /** Previous focus — when you move onto a related card, Shift+click its link still unlinks the pair. */
  const previousHighlightFocusTaskRef = useRef<Task | null>(null);
  const boardRelationshipsRef = useRef(taskLinking.boardRelationships);
  boardRelationshipsRef.current = taskLinking.boardRelationships;

  const handleLinkToolHover = async (task: Task) => {
    // Cancel pending clear so moving onto a related card keeps highlights for Shift+click
    if (linkHoverClearTimerRef.current) {
      clearTimeout(linkHoverClearTimerRef.current);
      linkHoverClearTimerRef.current = null;
    }
    const prev = highlightFocusTaskRef.current;
    if (prev && prev.id !== task.id) {
      previousHighlightFocusTaskRef.current = prev;
    }
    highlightFocusTaskRef.current = task;
    // Highlight immediately from boardRelationships; warm per-task cache in background
    taskLinking.setHoveredLinkTask(task);
    if (!taskLinking.taskRelationships[task.id]) {
      try {
        const relationships = await api.get(`/tasks/${task.id}/relationships`);
        const rows = Array.isArray(relationships.data) ? relationships.data : [];
        taskLinking.setTaskRelationships((prevRels: { [taskId: string]: any[] }) => ({
          ...prevRels,
          [task.id]: rows
        }));
      } catch {
        // Board relationships still drive same-board highlight
      }
    }
  };

  const handleLinkToolHoverEnd = () => {
    if (linkHoverClearTimerRef.current) {
      clearTimeout(linkHoverClearTimerRef.current);
    }
    // Longer delay so DnD / pointer travel to a related card still sees focus
    linkHoverClearTimerRef.current = setTimeout(() => {
      highlightFocusTaskRef.current = null;
      previousHighlightFocusTaskRef.current = null;
      taskLinking.setHoveredLinkTask(null);
      linkHoverClearTimerRef.current = null;
    }, 800);
  };

  // Helper function to check if a task is related to the hovered task
  const getTaskRelationshipType = useCallback((taskId: string): 'parent' | 'child' | 'related' | null => {
    const focus = highlightFocusTaskRef.current ?? taskLinking.hoveredLinkTask;
    if (!focus) return null;
    const hoveredId = focus.id;

    const fromBoard = getBoardRelationshipType(
      boardRelationshipsRef.current,
      hoveredId,
      taskId
    );
    if (fromBoard) return fromBoard;

    const relationships = taskLinking.taskRelationships[hoveredId];
    if (!Array.isArray(relationships)) return null;

    const parentRel = relationships.find(rel =>
      rel.relationship === 'child' &&
      rel.task_id === hoveredId &&
      rel.to_task_id === taskId
    );
    if (parentRel) return 'parent';

    const childRel = relationships.find(rel =>
      rel.relationship === 'parent' &&
      rel.task_id === hoveredId &&
      rel.to_task_id === taskId
    );
    if (childRel) return 'child';

    const relatedRel = relationships.find(rel =>
      rel.relationship === 'related' &&
      ((rel.task_id === hoveredId && rel.to_task_id === taskId) ||
       (rel.task_id === taskId && rel.to_task_id === hoveredId))
    );
    if (relatedRel) return 'related';

    return null;
  }, [taskLinking.hoveredLinkTask, taskLinking.taskRelationships, taskLinking.boardRelationships]);

  /** Shift+click the link icon to remove a relationship involving this card. */
  const handleUnlinkRelatedTask = useCallback(async (clickedTask: Task) => {
    if (unlinkInFlightRef.current) return;

    const focus = highlightFocusTaskRef.current ?? taskLinking.hoveredLinkTask;
    const previous = previousHighlightFocusTaskRef.current;
    const edges = boardRelationshipsRef.current;

    let otherTaskId: string | null = null;

    // 1) Clicked a counterpart of the current focus
    if (focus && focus.id !== clickedTask.id && findBoardRelationshipEdge(edges, focus.id, clickedTask.id)) {
      otherTaskId = focus.id;
    } else if (
      // 2) Clicked the focus card after moving from a related card
      focus &&
      focus.id === clickedTask.id &&
      previous &&
      previous.id !== clickedTask.id &&
      findBoardRelationshipEdge(edges, previous.id, clickedTask.id)
    ) {
      otherTaskId = previous.id;
    } else if (
      previous &&
      previous.id !== clickedTask.id &&
      findBoardRelationshipEdge(edges, previous.id, clickedTask.id)
    ) {
      otherTaskId = previous.id;
    } else {
      // 3) Fallback: resolve from this card's on-board edges (e.g. child with one parent)
      const counterparts = getBoardRelationshipCounterpartIds(edges, clickedTask.id);
      if (counterparts.length === 1) {
        otherTaskId = counterparts[0];
      } else if (previous && counterparts.includes(previous.id)) {
        otherTaskId = previous.id;
      } else if (focus && focus.id !== clickedTask.id && counterparts.includes(focus.id)) {
        otherTaskId = focus.id;
      } else if (counterparts.length > 1) {
        toast.warning(
          t('relationships.linkRemoveFailedTitle'),
          t('relationships.linkRemovePickRelated')
        );
        return;
      }
    }

    if (!otherTaskId) {
      toast.warning(
        t('relationships.linkRemoveFailedTitle'),
        t('relationships.linkRemoveNotFound')
      );
      return;
    }

    const edge = pickBoardRelationshipEdgeToDelete(edges, clickedTask.id, otherTaskId);
    if (!edge?.id) {
      toast.warning(
        t('relationships.linkRemoveFailedTitle'),
        t('relationships.linkRemoveNotFound')
      );
      return;
    }

    const findTaskOnBoard = (id: string): Task | null => {
      for (const col of Object.values(columns)) {
        const found = (col.tasks || []).find((tk: Task) => tk.id === id);
        if (found) return found;
      }
      return null;
    };
    const otherTask = findTaskOnBoard(otherTaskId);
    const otherLabel = otherTask?.ticket || otherTaskId;

    unlinkInFlightRef.current = true;
    const idA = clickedTask.id;
    const idB = otherTaskId;
    const nextEdges = edges.filter((raw) => {
      const e = normalizeBoardRelationshipEdge(raw);
      if (!e) return true;
      const pair =
        (e.taskId === idA && e.toTaskId === idB) || (e.taskId === idB && e.toTaskId === idA);
      return !pair;
    });
    boardRelationshipsRef.current = nextEdges;
    taskLinking.setBoardRelationships(nextEdges);

    try {
      await removeTaskRelationship(edge.taskId, String(edge.id));
      if (linkHoverClearTimerRef.current) {
        clearTimeout(linkHoverClearTimerRef.current);
        linkHoverClearTimerRef.current = null;
      }
      highlightFocusTaskRef.current = null;
      previousHighlightFocusTaskRef.current = null;
      taskLinking.setHoveredLinkTask(null);
      taskLinking.setTaskRelationships((prevRels: { [taskId: string]: any[] }) => {
        const next = { ...prevRels };
        delete next[idA];
        delete next[idB];
        return next;
      });
      toast.success(
        t('relationships.linkRemovedTitle'),
        t('relationships.linkRemovedMessage', {
          from: clickedTask.ticket,
          to: otherLabel,
        })
      );
    } catch (error: unknown) {
      boardRelationshipsRef.current = edges;
      taskLinking.setBoardRelationships(edges);
      const ax = error as { response?: { data?: { error?: string } }; message?: string };
      const message =
        ax?.response?.data?.error ||
        (error instanceof Error ? error.message : t('relationships.linkRemoveFailedTitle'));
      toast.error(t('relationships.linkRemoveFailedTitle'), message);
    } finally {
      unlinkInFlightRef.current = false;
    }
  }, [t, taskLinking, columns]);

  // Use the extracted collision detection function
  const collisionDetection = (args: any) => customCollisionDetection(args, draggedColumn, draggedTask, columns);

  // DnD sensors for both columns and tasks - optimized for smooth UX
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Make drag activation very permissive for better UX (disabled for viewers)
      activationConstraint: {
        distance: canMutate ? 1 : 100000,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );



  // Handle authentication state changes
  useEffect(() => {
    // Only change page if we're definitely not authenticated (not during auth check)
    // Don't change page during the initial auth check when isAuthenticated is false
    if (!isAuthenticated && (currentPage === 'admin' || currentPage === 'test') && !localStorage.getItem('authToken')) {
      setCurrentPage('kanban');
    }
  }, [isAuthenticated, currentPage]);

  // CONSOLIDATED: Load all user-specific preferences when authenticated (ONE API CALL)
  useEffect(() => {
    if (isAuthenticated && currentUser?.id) {
      const loadPreferences = async () => {
        // Load from both cookie and database (database takes precedence for stored values)
        // This makes ONE call to getUserSettings() internally and merges with cookies
        const userSpecificPrefs = await loadUserPreferencesAsync(currentUser.id);
        
        // Update all preference-based state with user-specific values
        taskFilters.setSelectedMembers(userSpecificPrefs.selectedMembers);
        taskFilters.setIncludeAssignees(userSpecificPrefs.includeAssignees);
        taskFilters.setIncludeWatchers(userSpecificPrefs.includeWatchers);
        taskFilters.setIncludeCollaborators(userSpecificPrefs.includeCollaborators);
        taskFilters.setIncludeRequesters(userSpecificPrefs.includeRequesters);
        taskFilters.setIncludeSystem(userSpecificPrefs.includeSystem);
        if (typeof userSpecificPrefs.showAgentTasks === 'boolean') {
          taskFilters.setShowAgentTasks(userSpecificPrefs.showAgentTasks);
        }
        taskFilters.setTaskViewMode(userSpecificPrefs.taskViewMode);
        taskFilters.setViewMode(userSpecificPrefs.viewMode);
        taskFilters.viewModeRef.current = userSpecificPrefs.viewMode;
        taskFilters.setIsSearchActive(userSpecificPrefs.isSearchActive);
        taskFilters.setIsAdvancedSearchExpanded(userSpecificPrefs.isAdvancedSearchExpanded);
        taskFilters.setSearchFilters(userSpecificPrefs.searchFilters);
        taskFilters.setSelectedSprintId(userSpecificPrefs.selectedSprintId); // Load sprint selection from DB
        
        // Per-board column visibility (Archive shown stays until user hides it)
        if (userSpecificPrefs.boardColumnVisibility && typeof userSpecificPrefs.boardColumnVisibility === 'object') {
          setBoardColumnVisibility(userSpecificPrefs.boardColumnVisibility);
        }
        
        // Activity Feed Settings (from the same getUserSettings call above)
        const defaultFromSystem = systemSettings.SHOW_ACTIVITY_FEED !== 'false';
        activityFeed.setShowActivityFeed(userSpecificPrefs.appSettings.showActivityFeed !== undefined 
          ? userSpecificPrefs.appSettings.showActivityFeed 
          : defaultFromSystem);
        activityFeed.setActivityFeedMinimized(
          userSpecificPrefs.activityFeed.isMinimized === true
        );
        activityFeed.setLastSeenActivityId(userSpecificPrefs.activityFeed.lastSeenActivityId);
        activityFeed.setClearActivityId(userSpecificPrefs.activityFeed.clearActivityId);
        activityFeed.setActivityFeedPosition(userSpecificPrefs.activityFeed.position);
        // Validate width to prevent corrupted values (120-600px range)
        const validatedWidth = Math.max(120, Math.min(600, userSpecificPrefs.activityFeed.width));
        activityFeed.setActivityFeedDimensions({
          width: validatedWidth,
          height: userSpecificPrefs.activityFeed.height
        });
        
        // Load Kanban column width preference
        setKanbanColumnWidth(userSpecificPrefs.kanbanColumnWidth || 300);
        
        // Load saved filter view if one is remembered
        if (userSpecificPrefs.currentFilterViewId) {
          taskFilters.loadSavedFilterView(userSpecificPrefs.currentFilterViewId);
        }
        
        // Do NOT setSelectedBoard here. Prefs can run before loadInitialData finishes, which
        // triggers the board-selection effect → refreshBoardData (columns only) while members
        // are still []. Column then skips every card until members arrive. Board selection is
        // handled in loadInitialData once members + boards are available together.
        
        // Update APP_URL if user is the owner (part of initialization process)
        try {
          // /auth/is-owner requires JWT — skip when token isn't in storage yet (race during login/HMR)
          if (localStorage.getItem('authToken')) {
            const ownerCheck = await api.get('/auth/is-owner');
            if (ownerCheck.data.isOwner) {
              if (feDebug('FE_DEBUG_APP_CORE')) {
                console.log('🔄 User is owner, updating APP_URL during initialization...');
                const baseUrl = window.location.origin;
                console.log('🔄 Calling updateAppUrl with:', baseUrl);
                const result = await updateAppUrl(baseUrl);
                console.log('✅ APP_URL updated successfully:', result);
              } else {
                const baseUrl = window.location.origin;
                await updateAppUrl(baseUrl);
              }
            } else if (feDebug('FE_DEBUG_APP_CORE')) {
              console.log('ℹ️ User is not owner, skipping APP_URL update');
            }
          }
        } catch (error: any) {
          // Don't fail initialization if owner check or APP_URL update fails
          if (error.response?.status === 403 || error.response?.status === 401) {
            if (feDebug('FE_DEBUG_APP_CORE')) console.log('ℹ️ User is not owner or not authorized, skipping APP_URL update');
          } else {
            console.warn('⚠️ Failed to check ownership or update APP_URL during initialization:', error.message);
          }
        }
      };
      
      loadPreferences();
    }
  }, [isAuthenticated, currentUser?.id]); // Only run when auth state or user changes

  // CENTRALIZED ROUTING HANDLER - Single source of truth
  useEffect(() => {
    const fallbackBoardId = (): string | null => {
      if (!boards.length) return null;
      if (currentUser?.id) {
        try {
          const last = loadUserPreferences(currentUser.id).lastSelectedBoard;
          if (last && boards.some((b) => b.id === last)) return last;
        } catch {
          /* ignore */
        }
      }
      return boards[0]?.id ?? null;
    };

    // Invalid hash → select a real board. Bare #kanban clears selection and often stays blank
    // because auto-select can miss the same-tick update after replaceState.
    const recoverInvalidBoardHash = () => {
      setCurrentPage('kanban');
      const id = fallbackBoardId();
      if (id) {
        setSelectedBoard(id);
        window.history.replaceState(null, '', `#kanban#${id}`);
      } else {
        setSelectedBoard(null);
        window.history.replaceState(null, '', '#kanban');
      }
    };

    const handleRouting = () => {
      // Check for task route first (handles /task/#TASK-00001 and /project/#PROJ-00001/#TASK-00001)
      const taskRoute = parseTaskRoute();
      
      if (taskRoute.isTaskRoute && taskRoute.taskId) {
        if (currentPage !== 'task') {
          setCurrentPage('task');
        }
        return;
      }
      
      // Check for project route (handles /project/#PROJ-00001)
      const projectRoute = parseProjectRoute();
      if (projectRoute.isProjectRoute && projectRoute.projectId && boards.length > 0) {
        const board = findBoardByProjectId(boards, projectRoute.projectId);
        if (board) {
          // Redirect to the board using standard routing
          const newHash = `#kanban#${board.id}`;
          if (window.location.hash !== newHash) {
            window.location.hash = newHash;
            return; // Let the hash change trigger the next routing cycle
          }
        } else {
          recoverInvalidBoardHash();
          return;
        }
      }
      
      // Standard hash-based routing
      const route = parseUrlHash(window.location.hash);

      // #login is for the signed-out Login screen only. If we're authenticated, open a real board.
      if (route.mainRoute === 'login') {
        if (isAuthenticated) {
          recoverInvalidBoardHash();
        }
        return;
      }
      
      // Debug to server console - DISABLED
      // fetch('/api/debug/log', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ 
      //     message: '🔍 Route parsing', 
      //     data: { hash: window.location.hash, route } 
      //   })
      // }).catch(() => {}); // Silent fail
      
      // 1. Handle page routing
      if (route.isPage) {
        if (route.mainRoute !== currentPage) {
          const nextPage = route.mainRoute as
            | 'kanban'
            | 'admin'
            | 'reports'
            | 'task'
            | 'test'
            | 'forgot-password'
            | 'reset-password'
            | 'reset-success'
            | 'activate-account';
          // Leaving Admin via hash/back with unsaved drafts → confirm first
          if (
            currentPage === 'admin' &&
            nextPage !== 'admin' &&
            (nextPage === 'kanban' || nextPage === 'reports' || nextPage === 'test') &&
            adminHasUnsavedDrafts() &&
            !adminLeaveBypassRef.current
          ) {
            const intendedHash = window.location.hash.replace(/^#/, '');
            window.history.replaceState(null, '', `#${adminHashRef.current}`);
            setAdminLeavePrompt({
              page: nextPage,
              options: { hash: intendedHash },
            });
            return;
          }
          setCurrentPage(nextPage);
        }
        
        // Handle password reset token
        if (route.mainRoute === 'reset-password') {
          const token = route.queryParams.get('token');
          if (token) {
            setResetToken(token);
          }
        }
        
        // Handle account activation token and email
        if (route.mainRoute === 'activate-account') {
          const token = route.queryParams.get('token');
          const email = route.queryParams.get('email');
          
          // Debug to server console - DISABLED
          // fetch('/api/debug/log', {
          //   method: 'POST',
          //   headers: { 'Content-Type': 'application/json' },
          //   body: JSON.stringify({ 
          //     message: '🔍 Activation route detected', 
          //     data: { token: token ? token.substring(0, 10) + '...' : null, email, queryParams: Object.fromEntries(route.queryParams) } 
          //   })
          // }).catch(() => {});
          
          if (token && email) {
            setActivationToken(token);
            setActivationEmail(email);
            
            // Debug success to server console - DISABLED
            // fetch('/api/debug/log', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ 
            //     message: '✅ Activation token and email set', 
            //     data: { token: token.substring(0, 10) + '...', email } 
            //   })
            // }).catch(() => {});
          } else {
            // Debug failure to server console - DISABLED
            // fetch('/api/debug/log', {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ 
            //     message: '❌ Missing activation token or email', 
            //     data: { hasToken: !!token, hasEmail: !!email } 
            //   })
            // }).catch(() => {});
          }
          
          // Mark activation parsing as complete
          setActivationParsed(true);
        }
        
        // Handle kanban board sub-routes
        if (route.mainRoute === 'kanban' && route.subRoute && boards.length > 0) {
          const board = boards.find(b => b.id === route.subRoute);
          if (board) {
            setSelectedBoard(board.id);
          } else {
            recoverInvalidBoardHash();
          }
        }
        
      } else if (route.isBoardId && boards.length > 0) {
        // 2. Handle direct board access (legacy format)
        const board = boards.find(b => b.id === route.mainRoute);
        if (
          currentPage === 'admin' &&
          adminHasUnsavedDrafts() &&
          !adminLeaveBypassRef.current
        ) {
          const intendedHash = window.location.hash.replace(/^#/, '');
          window.history.replaceState(null, '', `#${adminHashRef.current}`);
          setAdminLeavePrompt({
            page: 'kanban',
            options: { hash: board ? `kanban#${board.id}` : intendedHash || 'kanban' },
          });
          return;
        }
        if (board) {
          setCurrentPage('kanban');
          setSelectedBoard(board.id);
        } else {
          recoverInvalidBoardHash();
        }
        
      } else if (route.mainRoute) {
        // 3. Handle unknown routes
        if (
          currentPage === 'admin' &&
          adminHasUnsavedDrafts() &&
          !adminLeaveBypassRef.current
        ) {
          window.history.replaceState(null, '', `#${adminHashRef.current}`);
          setAdminLeavePrompt({ page: 'kanban', options: { hash: 'kanban' } });
          return;
        }
        recoverInvalidBoardHash();
      }
    };

    // Handle both hash changes and initial load
    handleRouting();
    window.addEventListener('hashchange', handleRouting);
    return () => window.removeEventListener('hashchange', handleRouting);
  }, [currentPage, boards, isAuthenticated, currentUser?.id]);

  // AUTO-BOARD-SELECTION LOGIC - Clean and predictable with user preference support
  useEffect(() => {
    // Only auto-select if:
    // 1. We're on kanban page
    // 2. No board is currently selected
    // 3. We have boards available
    // 4. We're not on pages that should skip auto-selection
    // 5. Not during board creation (to avoid race conditions)
    // 6. User is authenticated (so we can access preferences)
    // 7. No intended destination (don't override redirect after login)
    // 8. Not just redirected (prevent overriding intended destination redirect)
    if (
      currentPage === 'kanban' && 
      !selectedBoard && 
      boards.length > 0 && 
      !boardCreationPause &&
      !shouldSkipAutoBoardSelection(currentPage) &&
      isAuthenticated && currentUser?.id &&
      !intendedDestination &&
      !justRedirected
    ) {
      // Try to use the user's last selected board if it exists in current boards
      const userPrefs = loadUserPreferences(currentUser.id);
      const lastBoard = userPrefs.lastSelectedBoard;
      
      let boardToSelect: string | null = null;
      
      if (lastBoard && boards.some(board => board.id === lastBoard)) {
        // User's preferred board exists, use it
        boardToSelect = lastBoard;
      } else {
        // Fall back to first board
        boardToSelect = boards[0]?.id || null;
      }
      
      if (boardToSelect) {
        setSelectedBoard(boardToSelect);
        // CRITICAL FIX: Save to preferences so it's remembered on next refresh
        updateCurrentUserPreference('lastSelectedBoard', boardToSelect);
        // Normalize empty / bare kanban hashes (incl. after invalid URL recovery)
        const hash = window.location.hash || '';
        if (!hash || hash === '#' || hash === '#kanban') {
          window.location.hash = `#kanban#${boardToSelect}`;
        }
      }
    }
  }, [currentPage, boards, selectedBoard, boardCreationPause, isAuthenticated, currentUser?.id, intendedDestination, justRedirected, languageLoaded]);

  // Load initial data once auth + language preference are ready.
  // Do NOT re-run on i18n.language — that reloaded every board/task on EN↔FR toggle.
  // Activity feed is language-specific and refetched in the effect above.
  useEffect(() => {
    // Only load data if authenticated and user preferences have been loaded (currentUser.id exists)
    // Also wait for language to be loaded to ensure activity feed uses correct language
    if (!isAuthenticated || !currentUser?.id || !languageLoaded) return;
    
    const loadInitialData = async () => {
      if (feDebug('FE_DEBUG_APP_CORE')) console.log('🔄 Loading initial data...');
      await withLoading('general', async () => {
        try {
          // console.log(`🔄 Loading initial data with includeSystem: ${includeSystem}`);
          // Get current language for activity feed
          const currentLang = i18n.language || localStorage.getItem('i18nextLng') || 'en';
          const normalizedLang = currentLang.toLowerCase().startsWith('fr') ? 'fr' : 'en';

          // Members can briefly return [] during demo settle (HTML/proxy). Retry a few times
          // before painting so Team Members + card avatars hydrate together.
          const loadMembersWithRetry = async () => {
            const maxAttempts = isDemoModeClient() ? 6 : 2;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                const loaded = await getMembers(taskFilters.includeSystem);
                if (Array.isArray(loaded) && loaded.length > 0) return loaded;
              } catch {
                /* retry */
              }
              if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, Math.min(400 * attempt, 2000)));
              }
            }
            return [] as TeamMember[];
          };
          
          const [loadedMembers, loadedBoards, loadedPriorities, loadedTags, loadedSprints, loadedActivities] = await Promise.all([
            loadMembersWithRetry(),
          getBoards(),
          getAllPriorities(),
          getAllTags(),
          getAllSprints(),
          getActivityFeed(20, normalizedLang)
        ]);
          

          
          // console.log(`📋 Loaded ${loadedMembers.length} members with includeSystem=${includeSystem}`);
          setMembers(loadedMembers);
          setBoards(loadedBoards);
          setAvailablePriorities(loadedPriorities || []);
          setAvailableTags(loadedTags || []);
          setAvailableSprints(loadedSprints || []);
          // Settings are now loaded by SettingsContext - no need to fetch here
          activityFeed.setActivities(loadedActivities || []);
          
          // CRITICAL FIX: If no board is selected yet, immediately select one and load its columns
          // This prevents the blank board race condition on initial load/refresh
          if (loadedBoards.length > 0 && !selectedBoard) {
            // Prefer cookie / stored preference (same helper prefs used to call early — that raced members)
            const preferredBoardId = getInitialSelectedBoardWithPreferences(currentUser.id);
            
            // Try to find the preferred board, fallback to first board
            const boardToSelect = preferredBoardId 
              ? loadedBoards.find(b => b.id === preferredBoardId) || loadedBoards[0]
              : loadedBoards[0];
            
            if (boardToSelect) {
              if (feDebug('FE_DEBUG_APP_CORE')) console.log(`🎯 [INITIAL LOAD] Auto-selecting board: ${boardToSelect.title} (${boardToSelect.id})`);

              // Set board, columns, AND members already set above — avoid blank-card race
              setSelectedBoard(boardToSelect.id);
              setColumns(boardToSelect.columns || {});
              
              // Save to preferences
              updateCurrentUserPreference('lastSelectedBoard', boardToSelect.id);
              
              // Update URL
              if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#kanban') {
                window.location.hash = `#kanban#${boardToSelect.id}`;
              }
            }
          } else if (selectedBoard && loadedBoards.length > 0) {
            // Board already selected, just update its columns
            // CRITICAL: Skip if we just updated from WebSocket to prevent overwriting batch updates
            if (window.justUpdatedFromWebSocket) {
              if (feDebug('FE_DEBUG_APP_CORE')) console.log('⏭️ [Initial Load] Skipping columns update - WebSocket update in progress');
              return;
            }
            
            const boardToUse = loadedBoards.find(b => b.id === selectedBoard);
            if (boardToUse) {
              setColumns(boardToUse.columns || {});
            }
          }

          // Member selection is now handled by a separate useEffect
        } catch (error) {
          // console.error('Failed to load initial data:', error);
        }
      });
      await fetchQueryLogs();
    };

    loadInitialData();
  }, [isAuthenticated, currentUser?.id, languageLoaded]);

  // Reload members only when includeSystem changes (without flashing the entire screen)
  const isInitialSystemMount = useRef(true);
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) return;
    
    // Skip on initial mount - members are already loaded by loadInitialData
    if (isInitialSystemMount.current) {
      isInitialSystemMount.current = false;
      return;
    }
    
    const reloadMembers = async () => {
      try {
        const loadedMembers = await getMembers(taskFilters.includeSystem);
        setMembers(loadedMembers);
      } catch (error) {
        console.error('Failed to reload members:', error);
      }
    };
    
    reloadMembers();
  }, [taskFilters.includeSystem, isAuthenticated, currentUser?.id]);

  // Demo-only: if boards loaded but members stayed empty (HTML/error during settle), retry.
  useEffect(() => {
    if (!isDemoModeClient()) return;
    if (!isAuthenticated || !currentUser?.id) return;
    if (boards.length === 0 || members.length > 0) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Prefs cookies from pre-wipe sessions can linger when DEMO_RESET_AT was first
    // recorded without a clear — drop them so filters/board IDs don't stay stale.
    clearAllUserPreferenceCookies();

    const retry = async (attempt: number) => {
      if (cancelled || attempt > 8) return;
      const delay = attempt === 1 ? 300 : Math.min(1000 * (attempt - 1), 5000);
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        try {
          const loadedMembers = await getMembers(taskFilters.includeSystem);
          if (cancelled) return;
          if (Array.isArray(loadedMembers) && loadedMembers.length > 0) {
            setMembers(loadedMembers);
            return;
          }
        } catch {
          /* keep retrying */
        }
        void retry(attempt + 1);
      }, delay);
    };

    void retry(1);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    isAuthenticated,
    currentUser?.id,
    boards.length,
    members.length,
    taskFilters.includeSystem,
  ]);

  // Listen for sprint updates from admin panel
  useEffect(() => {
    const handleSprintsUpdated = async () => {
      try {
        const loadedSprints = await getAllSprints();
        setAvailableSprints(loadedSprints || []);
      } catch (error) {
        console.error('Failed to refresh sprints after admin update:', error);
      }
    };

    window.addEventListener('sprints-updated', handleSprintsUpdated);
    return () => {
      window.removeEventListener('sprints-updated', handleSprintsUpdated);
    };
  }, []);

  // Track board switching state to prevent task count flashing
  const [isSwitchingBoard, setIsSwitchingBoard] = useState(false);
  const lastTaskCountsRef = useRef<Record<string, number>>({});

  // Hydrate columns before paint when the selected board changes.
  // Previously a separate effect cleared filteredColumns to {} first, which painted an empty
  // board for a frame; columns and filteredColumns must update together.
  useLayoutEffect(() => {
    if (feDebug('FE_DEBUG_APP_CORE')) {
      console.log('🔗 [App] board layout effect:', {
        selectedBoard,
        currentPage,
        hasBoards: boards.length > 0,
      });
    }

    if (selectedBoard) {
      setIsSwitchingBoard(true);
      const boardIdBeingOpened = selectedBoard;
      const boardInState = boards.find((b) => b.id === selectedBoard);

      if (boardInState && boardInState.columns && Object.keys(boardInState.columns).length > 0) {
        const newColumns: Columns = {};
        Object.keys(boardInState.columns || {}).forEach((columnId) => {
          const column = boardInState.columns[columnId];
          if (column) {
            newColumns[columnId] = {
              ...column,
              tasks: [...(column.tasks || [])],
            };
          }
        });
        setColumns(newColumns);
        // Seed with active filters applied (sprint/search/etc.) so board switch does not
        // briefly paint every card before useTaskFilters re-runs.
        taskFilters.setFilteredColumns(taskFilters.applyFiltersToColumns(newColumns));
        setIsSwitchingBoard(false);

        refreshBoardData({ force: true, forBoardId: boardIdBeingOpened })
          .then(() => {
            if (selectedBoardRef.current !== boardIdBeingOpened) return;
          })
          .catch(() => {
            /* refreshBoardData already logs */
          });
      } else {
        setColumns({});
        taskFilters.setFilteredColumns({});
        refreshBoardData({ force: true, forBoardId: boardIdBeingOpened }).finally(() => {
          if (selectedBoardRef.current === boardIdBeingOpened) {
            setIsSwitchingBoard(false);
          }
        });
      }

      if (currentPage === 'kanban') {
        getBoardTaskRelationships(selectedBoard)
          .then((relationships) => {
            if (selectedBoardRef.current !== boardIdBeingOpened) return;
            taskLinking.setBoardRelationships(relationships);
          })
          .catch((error) => {
            console.error('⚠️ [App] Failed to load relationships:', error);
            if (selectedBoardRef.current === boardIdBeingOpened) {
              taskLinking.setBoardRelationships([]);
            }
          });
      }
    } else {
      setColumns({});
      taskFilters.setFilteredColumns({});
      taskLinking.setBoardRelationships([]);
      setIsSwitchingBoard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoard, currentPage]);

  // Watch for copied task to trigger animation
  useEffect(() => {
    if (pendingCopyAnimation && columns[pendingCopyAnimation.columnId]) {
      const columnTasks = columns[pendingCopyAnimation.columnId]?.tasks || [];
      const copiedTask = columnTasks.find(t => 
        t.title === pendingCopyAnimation.title && 
        t.id !== pendingCopyAnimation.originalTaskId && // Not the original task
        Math.abs((t.position || 0) - pendingCopyAnimation.originalPosition) <= 1 // Within 1 position of original
      );
      
      if (copiedTask) {
        setAnimateCopiedTaskId(copiedTask.id);
        setPendingCopyAnimation(null); // Clear pending animation
        // Clear the animation trigger after a brief delay
        setTimeout(() => setAnimateCopiedTaskId(null), 100);
      }
    }
  }, [columns, pendingCopyAnimation]);

  // Real-time events - DISABLED (Socket.IO removed)
  // TODO: Implement simpler real-time solution (polling or SSE)

  const refreshBoardData = useCallback(async (options?: { force?: boolean; forBoardId?: string }) => {
    // CRITICAL: Skip refresh if we just updated from WebSocket to prevent overwriting real-time updates
    // This is especially important for batch position updates (259 tasks) where WebSocket updates
    // are processed together and should not be overwritten by a refresh
    if (!options?.force && window.justUpdatedFromWebSocket) {
      if (feDebug('FE_DEBUG_APP_CORE')) console.log('⏭️ [refreshBoardData] Skipping refresh - WebSocket update in progress');
      return;
    }
    
    try {
      const loadedBoards = await getBoards();
      setBoards(loadedBoards);
      
      // Hydrate columns for a specific board (e.g. newly created) before selectedBoard state updates,
      // or for the current selectedBoard when forBoardId is omitted.
      const boardIdToHydrate = options?.forBoardId !== undefined ? options.forBoardId : selectedBoard;

      // If this refresh was for a specific board and the user has already switched away, still
      // update boards[] (above) but do not clobber the currently visible columns.
      if (
        options?.forBoardId !== undefined &&
        selectedBoardRef.current &&
        selectedBoardRef.current !== options.forBoardId
      ) {
        return;
      }
      
      if (loadedBoards.length > 0) {
        if (boardIdToHydrate) {
          const board = loadedBoards.find(b => b.id === boardIdToHydrate);
          if (board) {
            // Force a deep clone to ensure React detects the change at all levels
            // OPTIMIZED: Use shallow copy instead of expensive JSON.parse(JSON.stringify())
            // Also filter out recently deleted tasks to prevent them from reappearing
            const newColumns: Columns = {};
            if (board.columns) {
              Object.keys(board.columns).forEach(columnId => {
                const column = board.columns[columnId];
                if (column) {
                  // Filter out recently deleted tasks
                  const filteredTasks = (column.tasks || []).filter(
                    task => !recentlyDeletedTasksRef.current.has(task.id)
                  );
                  newColumns[columnId] = {
                    ...column,
                    tasks: filteredTasks
                  };
                }
              });
            }
            setColumns(newColumns);
            
            // Relationships are loaded by the board selection effect above, no need to load here
          } else if (options?.forBoardId === undefined) {
            // Selected board no longer exists, clear selection (normal navigation only)
            setSelectedBoard(null);
            setColumns({});
            taskLinking.setBoardRelationships([]);
          } else {
            setColumns({});
          }
        }
      }
    } catch (error) {
      console.error('Failed to refresh board data:', error);
    }
  }, [selectedBoard]);

  // Update the ref whenever refreshBoardData changes
  useEffect(() => {
    refreshBoardDataRef.current = refreshBoardData;
  }, [refreshBoardData]);

  // Track when we've just updated from WebSocket to prevent polling from overriding
  const [justUpdatedFromWebSocket, setJustUpdatedFromWebSocket] = useState(false);
  
  // Expose the flag to window for WebSocket handlers
  useEffect(() => {
    window.setJustUpdatedFromWebSocket = setJustUpdatedFromWebSocket;
    window.justUpdatedFromWebSocket = justUpdatedFromWebSocket;
    return () => {
      delete window.setJustUpdatedFromWebSocket;
      delete window.justUpdatedFromWebSocket;
    };
  }, [justUpdatedFromWebSocket]);

  const fetchQueryLogs = async () => {
    // DISABLED: Debug query logs fetching
    // try {
    //   const logs = await getQueryLogs();
    //   setQueryLogs(logs);
    // } catch (error) {
    //   // console.error('Failed to fetch query logs:', error);
    // }
  };



  const handleAddBoard = async () => {
    try {
      // Pause polling to prevent race conditions
      setBoardCreationPause(true);
      
      const boardId = generateUUID();
      const newBoard: Board = {
        id: boardId,
        title: generateUniqueBoardName(
          boards,
          isDemoModeClient()
            ? i18n.language
            : siteSettings?.APP_LANGUAGE || systemSettings?.APP_LANGUAGE
        ),
        columns: {}
      };

      // Create the board first (backend automatically creates default columns)
      await createBoard(newBoard);

      // Refresh and hydrate columns for the NEW board (forBoardId: selectedBoard is still the previous board).
      // force: true avoids skipping while justUpdatedFromWebSocket is set after a WS batch.
      await refreshBoardData({ force: true, forBoardId: boardId });

      setSelectedBoard(boardId);
      updateCurrentUserPreference('lastSelectedBoard', boardId);
      // Defer hash update until after React applies setBoards/setColumns from refresh (avoids hashchange
      // seeing a stale boards list and clearing selection).
      queueMicrotask(() => {
        window.location.hash = `#kanban#${boardId}`;
      });
      
      await fetchQueryLogs();
      
      // Resume polling after brief delay
      setTimeout(() => {
        setBoardCreationPause(false);
      }, BOARD_CREATION_PAUSE_DURATION);
      
    } catch (error: any) {
      console.error('Failed to add board:', error);
      setBoardCreationPause(false); // Resume polling even on error
      
      // Check if it's a license limit error
      if (error?.response?.status === 403 && error?.response?.data?.error === 'License limit exceeded') {
        const limitType = error.response.data.limit;
        const details = error.response.data.details;
        const softDeletedCount = Number(error.response.data.softDeletedCount) || 0;
        const liveCount = Number(error.response.data.liveCount);
        const boardLimit = Number(error.response.data.boardLimit);

        if (limitType === 'BOARD_LIMIT') {
          setBoardLimitDialog({
            liveCount: Number.isFinite(liveCount) ? liveCount : boards.length,
            softDeletedCount,
            boardLimit: Number.isFinite(boardLimit) ? boardLimit : liveCount + softDeletedCount,
            details,
          });
        } else {
          let title = '';
          let message = '';
          switch (limitType) {
            case 'USER_LIMIT':
              title = 'User Limit Reached';
              message = `You've reached the maximum number of users. ${details}`;
              break;
            case 'TASK_LIMIT':
              title = 'Task Limit Reached';
              message = `You've reached the maximum number of tasks for this board. ${details}`;
              break;
            case 'STORAGE_LIMIT':
              title = 'Storage Limit Reached';
              message = `You've reached the maximum storage limit. ${details}`;
              break;
            default:
              title = 'License Limit Exceeded';
              message = details;
          }
          toast.error(title, message, 5000);
        }
      } else if (await handleInstanceStatusError(error)) {
        // Instance status error handled by utility function
      }
    }
  };

  const handleEditBoard = async (
    boardId: string,
    title: string,
    wipLimit?: number | null
  ) => {
    try {
      const updated = await updateBoard(boardId, title, wipLimit);
      setBoards(prev => prev.map(b =>
        b.id === boardId
          ? {
              ...b,
              title: updated?.title ?? title,
              wip_limit:
                updated?.wip_limit !== undefined
                  ? updated.wip_limit
                  : wipLimit !== undefined
                    ? wipLimit
                    : b.wip_limit,
            }
          : b
      ));
      await fetchQueryLogs();
    } catch (error) {
      // console.error('Failed to update board:', error);
    }
  };

  const handleBoardReorder = async (boardId: string, newPosition: number) => {
    try {
      // Optimistic update - reorder boards immediately in frontend
      const oldIndex = boards.findIndex(board => board.id === boardId);

      
      if (oldIndex !== -1 && oldIndex !== newPosition) {
        const newBoards = [...boards];
        const [movedBoard] = newBoards.splice(oldIndex, 1);
        newBoards.splice(newPosition, 0, movedBoard);
        
        // Update positions to match new order
        const updatedBoards = newBoards.map((board, index) => ({
          ...board,
          position: index
        }));
        

        setBoards(updatedBoards);
      }
      
      // Update backend
      await reorderBoards(boardId, newPosition);
      await fetchQueryLogs();
    } catch (error) {
      // console.error('Failed to reorder boards:', error);
      // Rollback by refreshing on error
      await refreshBoardData();
    }
  };

  const handleRemoveBoard = async (boardId: string) => {
    if (boards.length <= 1) {
      alert('Cannot delete the last board');
      return;
    }

    try {
      const board = boards.find((b) => b.id === boardId);
      const liveCount = board ? getTotalTaskCountForBoard(board) : 0;
      let trashCount = 0;
      try {
        trashCount = await getBoardTrashCount(boardId);
      } catch {
        trashCount = 0;
      }
      if (liveCount === 0 && trashCount === 0) {
        await purgeBoard(boardId);
      } else {
        await deleteBoard(boardId);
      }
      const newBoards = boards.filter(b => b.id !== boardId);
      setBoards(newBoards);
      
      if (selectedBoard === boardId) {
        const firstBoard = newBoards[0];
        handleBoardSelection(firstBoard.id);
        setColumns(firstBoard.columns);
      }
      notifyLifecycleDataChanged();
      await fetchQueryLogs();
    } catch (error) {
      // console.error('Failed to remove board:', error);
    }
  };

  const handleAddTask = async (columnId: string, startDate?: string, dueDate?: string): Promise<boolean> => {
    if (!canMutate) {
      toast.error(t('messages.readOnlyMode', { ns: 'common' }), '');
      return false;
    }
    if (!selectedBoard || !currentUser) return false;
    
    // Prevent task creation when network is offline
    if (!isOnline) {
      console.warn('⚠️ Task creation blocked - network is offline');
      return false;
    }

    const targetColumnForWip = columns[columnId];
    if (targetColumnForWip && isBoardWipActiveColumn(targetColumnForWip)) {
      const currentBoard = boards.find((b) => b.id === selectedBoard);
      warnIfBoardWipSoftLimit(
        currentBoard,
        getBoardWipTaskCountForBoard(currentBoard || ({ id: selectedBoard, columns } as Board)) + 1
      );
    }
    
    // Always assign new tasks to the logged-in user, not the filtered selection
    const currentUserMember = members.find(m => m.user_id === currentUser.id);
    if (!currentUserMember) {
      // console.error('Current user not found in members list');
      return false;
    }

    // Auto-assign the header sprint filter when a concrete sprint is selected
    // (not "All" / null, and not Backlog).
    const filterSprintId = taskFilters.selectedSprintId;
    const autoSprintId =
      filterSprintId && filterSprintId !== 'backlog' ? filterSprintId : null;
    const autoSprint = autoSprintId
      ? availableSprints.find((s: any) => s.id === autoSprintId)
      : null;

    // Prefer caller dates (e.g. Gantt drag); otherwise sprint window, else today.
    const taskStartDate =
      startDate ||
      (autoSprint?.start_date
        ? formatToYYYYMMDD(autoSprint.start_date)
        : new Date().toISOString().split('T')[0]);
    const taskDueDate =
      dueDate ||
      (autoSprint?.end_date
        ? formatToYYYYMMDD(autoSprint.end_date)
        : taskStartDate);

    const newTask: Task = {
      id: generateUUID(),
      title: 'New Task',
      description: '',
      memberId: currentUserMember.id,
      startDate: taskStartDate,
      dueDate: taskDueDate,
      effort: 1,
      columnId,
      position: 0, // Backend will handle positioning
      priority: getDefaultPriority(), // Use frontend default priority
      requesterId: currentUserMember.id,
      boardId: selectedBoard,
      comments: [],
      sprintId: autoSprintId,
    };

    // OPTIMISTIC UPDATE: Add task to UI immediately for instant feedback
    setColumns(prev => {
      const targetColumn = prev[columnId];
      if (!targetColumn) return prev;
      
      // Insert at top (position 0) and bump siblings so local positions match server
      const bumpedTasks = targetColumn.tasks.map(t => ({
        ...t,
        position: (typeof t.position === 'number' ? t.position : parseFloat(String(t.position)) || 0) + 1
      }));
      const updatedTasks = [newTask, ...bumpedTasks];
      
      return {
        ...prev,
        [columnId]: {
          ...targetColumn,
          tasks: updatedTasks
        }
      };
    });
    
    // ALSO update boards state for tab counters
    setBoards(prev => {
      return prev.map(board => {
        if (board.id === selectedBoard) {
          const updatedBoard = { ...board };
          const updatedColumns = { ...updatedBoard.columns };
          const targetColumnId = newTask.columnId;
          
          if (updatedColumns[targetColumnId]) {
            const existingTasks = updatedColumns[targetColumnId].tasks || [];
            const bumpedTasks = existingTasks.map(t => ({
              ...t,
              position: (typeof t.position === 'number' ? t.position : parseFloat(String(t.position)) || 0) + 1
            }));
            updatedColumns[targetColumnId] = {
              ...updatedColumns[targetColumnId],
              tasks: [newTask, ...bumpedTasks]
            };
            
            updatedBoard.columns = updatedColumns;
          }
          
          return updatedBoard;
        }
        return board;
      });
    });

    // PAUSE POLLING to prevent race condition
    setTaskCreationPause(true);

    const createTimestamp = new Date().toISOString();
    if (feDebug('FE_DEBUG_APP_CORE')) {
      console.log(`🆕 [${createTimestamp}] Creating task:`, {
        taskId: newTask.id,
        title: newTask.title,
        columnId: newTask.columnId,
        boardId: newTask.boardId
      });
    }

    try {
      await withLoading('tasks', async () => {
        // Let backend handle positioning and shifting
        await createTaskAtTop(newTask);
        
        // Task already visible via optimistic update - WebSocket will confirm/sync
      });
      
      // ALWAYS schedule a fallback refresh to fetch ticket if WebSocket event doesn't arrive
      // This handles WebSocket reconnection flapping after sleep/wake
      pendingTaskRefreshesRef.current.add(newTask.id);
      
      setTimeout(() => {
        const fallbackTimestamp = new Date().toISOString();
        // Check if WebSocket event already updated the task
        if (pendingTaskRefreshesRef.current.has(newTask.id)) {
          // WebSocket event never arrived, force refresh to get ticket
          if (feDebug('FE_DEBUG_APP_CORE')) console.log(`⏱️ [${fallbackTimestamp}] Fallback triggered - WebSocket event never arrived for task ${newTask.id}`);
          pendingTaskRefreshesRef.current.delete(newTask.id);
          if (refreshBoardDataRef.current) {
            refreshBoardDataRef.current();
          }
        } else if (feDebug('FE_DEBUG_APP_CORE')) {
          console.log(`✅ [${fallbackTimestamp}] Fallback skipped - WebSocket event already handled task ${newTask.id}`);
        }
      }, 1000);
      
      const warn = buildColumnVisibilityWarningForTask(newTask);
      if (warn) {
        setColumnWarnings(prev => ({
          ...prev,
          [columnId]: warn,
        }));
      }
      
      // Resume polling after delay to ensure server processing is complete
      setTimeout(() => {
        setTaskCreationPause(false);
      }, TASK_CREATION_PAUSE_DURATION);

      return true;
      
    } catch (error: any) {
      console.error('Failed to create task at top:', error);
      setTaskCreationPause(false);
      
      // Check if it's a license limit error
      if (error?.response?.status === 403 && error?.response?.data?.error === 'License limit exceeded') {
        const limitType = error.response.data.limit;
        const details = error.response.data.details;
        
        let title = '';
        let message = '';
        switch (limitType) {
          case 'BOARD_LIMIT':
            title = 'Board Limit Reached';
            message = `You've reached the maximum number of boards. ${details}`;
            break;
          case 'USER_LIMIT':
            title = 'User Limit Reached';
            message = `You've reached the maximum number of users. ${details}`;
            break;
          case 'TASK_LIMIT':
            title = 'Task Limit Reached';
            message = `You've reached the maximum number of tasks for this board. ${details}`;
            break;
          case 'STORAGE_LIMIT':
            title = 'Storage Limit Reached';
            message = `You've reached the maximum storage limit. ${details}`;
            break;
          default:
            title = 'License Limit Exceeded';
            message = details;
        }
        
        toast.error(title, message, 5000);
      } else if (await handleInstanceStatusError(error)) {
        // Instance status error handled by utility function
      } else {
        toast.error(t('errors.createTaskTitle'), t('errors.createTaskMessage'));
        await refreshBoardData();
      }
      return false;
    }
  };

  const handleEditTask = useCallback(async (task: Task, options?: { skipActivity?: boolean; localOnly?: boolean }) => {
    // Optimistic update
    const previousColumns = { ...columns };
    const previousFilteredColumns = { ...(taskFilters.filteredColumns || {}) };
    const previousSelectedTask = selectedTask;

    const patchTaskInColumns = (prev: Columns): Columns => {
      // Find where the card currently lives (source), independent of the requested target.
      // Looking only in task.columnId breaks archive/move: the card isn't in the archive yet,
      // so the old path appended a duplicate and only cleaned up after the server/WS sync.
      let sourceColumnId: string | undefined;
      let existingTask: Task | undefined;
      for (const columnId of Object.keys(prev)) {
        const found = prev[columnId]?.tasks?.find((t) => t.id === task.id);
        if (found) {
          sourceColumnId = columnId;
          existingTask = found;
          break;
        }
      }

      const targetColumnId = task.columnId || sourceColumnId;
      if (!targetColumnId || !prev[targetColumnId]) {
        console.warn('Column not found for task update:', task.columnId, 'Available columns:', Object.keys(prev));
        return prev;
      }

      const mergedTask: Task = {
        ...(existingTask || {}),
        ...task,
        columnId: targetColumnId,
        boardId: task.boardId || existingTask?.boardId || '',
      };

      const updatedColumns: Columns = { ...prev };
      const isSameColumn = !sourceColumnId || sourceColumnId === targetColumnId;

      // Same-column in-place update (preserves order; avoids remove/re-add flicker)
      if (isSameColumn) {
        const column = updatedColumns[targetColumnId];
        const taskIndex = column.tasks.findIndex((t) => t.id === task.id);
        if (taskIndex !== -1) {
          updatedColumns[targetColumnId] = {
            ...column,
            tasks: [
              ...column.tasks.slice(0, taskIndex),
              mergedTask,
              ...column.tasks.slice(taskIndex + 1),
            ],
          };
          return updatedColumns;
        }
        updatedColumns[targetColumnId] = {
          ...column,
          tasks: [...column.tasks, mergedTask],
        };
        return updatedColumns;
      }

      // Cross-column move (archive, status change, etc.): remove from source, insert into target
      Object.keys(updatedColumns).forEach((columnId) => {
        const column = updatedColumns[columnId];
        const taskIndex = column.tasks.findIndex((t) => t.id === task.id);
        if (taskIndex !== -1) {
          updatedColumns[columnId] = {
            ...column,
            tasks: [
              ...column.tasks.slice(0, taskIndex),
              ...column.tasks.slice(taskIndex + 1),
            ],
          };
        }
      });

      const targetColumn = updatedColumns[targetColumnId];
      if (targetColumn) {
        updatedColumns[targetColumnId] = {
          ...targetColumn,
          tasks: [...targetColumn.tasks, { ...mergedTask, columnId: targetColumnId }],
        };
      }
      return updatedColumns;
    };

    // Update both columns and filteredColumns so the visible card refreshes immediately
    setColumns(patchTaskInColumns);
    taskFilters.setFilteredColumns(patchTaskInColumns);

    // Update selectedTask if this is the selected task
    if (selectedTask && selectedTask.id === task.id) {
      setSelectedTask({ ...selectedTask, ...task, columnId: task.columnId || selectedTask.columnId });
    }

    // Viewers / comment·relationship refreshes: update local board state only (no task PATCH).
    if (!canMutate || options?.localOnly) {
      return;
    }

    try {
      await withLoading('tasks', async () => {
        await updateTask(task, options?.skipActivity ? { skipActivity: true } : undefined);
        await fetchQueryLogs();
      });
    } catch (error: any) {
      console.error('❌ [App] Failed to update task:', error);

      if (await handleInstanceStatusError(error)) {
        return;
      }

      setColumns(previousColumns);
      taskFilters.setFilteredColumns(previousFilteredColumns);
      if (previousSelectedTask) {
        setSelectedTask(previousSelectedTask);
      }
      toast.error(t('errors.updateTaskTitle'), t('errors.updateTaskMessage'));
    }
  }, [withLoading, fetchQueryLogs, columns, selectedTask, taskFilters, t, canMutate]);

  const handleCopyTask = async (task: Task, options?: { skipEmail?: boolean }) => {
    if (!canMutate) {
      toast.error(t('messages.readOnlyMode', { ns: 'common' }), '');
      return;
    }
    const originalPosition = task.position || 0;
    const copyTitle = `${task.title} (Copy)`;

    // PAUSE POLLING to prevent race condition
    setTaskCreationPause(true);

    try {
      let copiedTask: Task | null = null;
      
      await withLoading('tasks', async () => {
        // Use the dedicated copy endpoint which handles:
        // - Generating new ticket number (incrementing)
        // - Copying all task fields
        // - Placing copy at originalPos - 0.5 (above original)
        // - Copying tags, watchers, and collaborators
        copiedTask = await copyTask(task.id, task.boardId, options);
      });
      
      // After copy is created, renumber the column and send to backend
      // This ensures clean integer positions (0, 1, 2, 3...)
      if (copiedTask && task.columnId) {
        const targetColumnId = task.columnId;
        // Wait a brief moment for WebSocket to add the task, then renumber
        // NOTE: renumberColumnAfterCopy gets CURRENT state internally (no stale closure issue)
        setTimeout(async () => {
          try {
            await renumberColumnAfterCopy(targetColumnId, setColumns);
            if (feDebug('FE_DEBUG_APP_CORE')) console.log('✅ Column renumbered after copy');
          } catch (err) {
            console.error('Failed to renumber after copy:', err);
          }
        }, 500); // Give WebSocket time to add the task first
      }
      
      // SAFETY FALLBACK: If WebSocket was offline/reconnecting, manually refresh after delay
      if (wasOfflineRef.current) {
        if (feDebug('FE_DEBUG_APP_CORE')) console.log('⚠️ Copying task while WebSocket is reconnecting - will refresh board in 2s to ensure it appears');
        setTimeout(() => {
          if (refreshBoardDataRef.current) {
            if (feDebug('FE_DEBUG_APP_CORE')) console.log('🔄 Safety fallback: Refreshing board after task copy (was offline)');
            refreshBoardDataRef.current();
          }
        }, 2000);
      }
      
      // Set up pending animation - useEffect will trigger when columns update
      setPendingCopyAnimation({
        title: copyTitle,
        columnId: task.columnId,
        originalPosition,
        originalTaskId: task.id
      });
      
      // Resume polling after brief delay
      setTimeout(() => {
        setTaskCreationPause(false);
      }, TASK_CREATION_PAUSE_DURATION);

      if (!options?.skipEmail) {
        toast.success(t('errors.copyTaskSuccessTitle'), t('errors.copyTaskSuccessMessage'));
      }
      return copiedTask;
      
    } catch (error) {
      console.error('Failed to copy task:', error);
      setTaskCreationPause(false);
      
      // Check if it's an instance unavailable error
      if (await handleInstanceStatusError(error)) {
        // Instance status error handled by utility function
      } else if (!options?.skipEmail) {
        toast.error(t('errors.copyTaskTitle'), t('errors.copyTaskMessage'));
      } else {
        throw error;
      }
    }
  };

  const handleTagAdd = (taskId: string) => async (tagId: string) => {
    if (!canMutate) return;
    try {
      const numericTagId = parseInt(tagId);
      await addTagToTask(taskId, numericTagId);
      // Don't refresh - WebSocket event will handle the update in real-time
      // This ensures other users also see the tag immediately
    } catch (error) {
      // console.error('Failed to add tag to task:', error);
    }
  };

  const handleTagRemove = (taskId: string) => async (tagId: string) => {
    if (!canMutate) return;
    try {
      const numericTagId = parseInt(tagId);
      await removeTagFromTask(taskId, numericTagId);
      // Refresh the task data to remove the tag
      await refreshBoardData();
    } catch (error) {
      // console.error('Failed to remove tag from task:', error);
    }
  };

  const handleTaskDragStart = useCallback((task: Task) => {
    if (!canMutate) return;
    // console.log('🎯 [App] handleTaskDragStart called with task:', task.id);
    setDraggedTask(task);
    // Pause polling during drag to prevent state conflicts
  }, [canMutate]);

  // Clear drag state (for Gantt drag end)
  const handleTaskDragEnd = useCallback(() => {
    // console.log('🎯 [App] handleTaskDragEnd called - clearing draggedTask');
    setDraggedTask(null);
    setDragCooldown(true);
    setTimeout(() => {
      setDragCooldown(false);
    }, DRAG_COOLDOWN_DURATION);
  }, []);

  // Clear drag state without cooldown (for multi-select exit)
  const handleClearDragState = useCallback(() => {
    // console.log('🎯 [App] handleClearDragState called - clearing draggedTask without cooldown');
    setDraggedTask(null);
    setDragCooldown(false);
  }, []);
  
  // Failsafe: Clear drag state on any click if drag is stuck
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      // Use ref to get current draggedTask value without recreating listener
      if (draggedTaskRef.current) {
        // Check if clicking on a board tab
        const target = e.target as HTMLElement;
        const isTabClick = target.closest('[class*="board-tab"]') || 
                          target.closest('button')?.id?.startsWith('board-');
        
        if (isTabClick) {
          // console.log('🚨 [App] Failsafe: Clearing stuck drag state on tab click');
          setDraggedTask(null);
        }
      }
    };
    
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []); // Remove draggedTask dependency to prevent listener recreation

  // Set drag cooldown (for Gantt operations)
  const handleSetDragCooldown = (active: boolean, duration?: number) => {
    setDragCooldown(active);
    
    // Clear any existing timeout
    if (dragCooldownTimeoutRef.current) {
      clearTimeout(dragCooldownTimeoutRef.current);
      dragCooldownTimeoutRef.current = null;
    }
    
    if (active) {
      const timeoutDuration = duration || DRAG_COOLDOWN_DURATION;
      dragCooldownTimeoutRef.current = setTimeout(() => {
        setDragCooldown(false);
        dragCooldownTimeoutRef.current = null;
      }, timeoutDuration);
    }
  };

  // Update draggedTaskRef when draggedTask changes
  useEffect(() => {
    draggedTaskRef.current = draggedTask;
  }, [draggedTask]);

  // Cleanup drag cooldown timeout on unmount
  useEffect(() => {
    return () => {
      if (dragCooldownTimeoutRef.current) {
        clearTimeout(dragCooldownTimeoutRef.current);
        dragCooldownTimeoutRef.current = null;
      }
    };
  }, []);

  // Old handleTaskDragEnd removed - replaced with unified version below

  const handleTaskDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Legacy wrapper for old HTML5 drag (still used by some components)
  const handleTaskDrop = async () => {
  };


  // Unified task drag handler for both vertical and horizontal moves
  const handleUnifiedTaskDragEnd = (event: DragEndEvent) => {
    if (!canMutate) return;
    // Clean up hover timeout and reset state
    if (boardTabHoverTimeoutRef.current) {
      clearTimeout(boardTabHoverTimeoutRef.current);
      boardTabHoverTimeoutRef.current = null;
    }
    setIsHoveringBoardTab(false);
    
    // Clear drag preview
    setDragPreview(null);
    
    // Set cooldown and clear dragged task state
    setDraggedTask(null);
    setDragCooldown(true);
    
    setTimeout(() => {
      setDragCooldown(false);
        }, DRAG_COOLDOWN_DURATION);
    const { active, over } = event;
    
    
    if (!over) {
        return;
    }

    // Check if dropping on a board tab for cross-board move
    if (over.data?.current?.type === 'board') {
      const targetBoardId = over.data.current.boardId;
      // console.log('🎯 Board drop detected:', { targetBoardId, selectedBoard, overData: over.data.current });
      if (targetBoardId && targetBoardId !== selectedBoard) {
        // console.log('🚀 Cross-board move initiated:', active.id, '→', targetBoardId);
        handleTaskDropOnBoard(active.id as string, targetBoardId);
        return;
      } else {
        // console.log('❌ Cross-board move blocked:', { targetBoardId, selectedBoard, same: targetBoardId === selectedBoard });
      }
    }

    // Find the dragged task
    const draggedTaskId = active.id as string;
    let draggedTask: Task | null = null;
    let sourceColumnId: string | null = null;
    
    // Find the task in all columns
    Object.entries(columns).forEach(([colId, column]) => {
      const task = column.tasks.find(t => t.id === draggedTaskId);
      if (task) {
        draggedTask = task;
        sourceColumnId = colId;
      }
    });

    if (!draggedTask || !sourceColumnId) {
        return;
    }

    // Determine target column and position
    let targetColumnId: string | undefined;
    let targetIndex: number | undefined;

    // Check if dropping on another task (reordering within column or moving to specific position)
    if (over.data?.current?.type === 'task') {
      // Find which column the target task is in
      Object.entries(columns).forEach(([colId, column]) => {
        const targetTask = column.tasks.find(t => t.id === over.id);
        if (targetTask) {
          targetColumnId = colId;
          
          if (sourceColumnId !== colId) {
            // Cross-column move: insert at target task position
            const targetColumnTasks = [...column.tasks].sort((a, b) => (a.position || 0) - (b.position || 0));
            const targetTaskIndex = targetColumnTasks.findIndex(t => t.id === over.id);
            targetIndex = targetTaskIndex;
          } else {
            // Same column: use array-based reordering like Test page
            const sourceTasks = [...column.tasks].sort((a, b) => (a.position || 0) - (b.position || 0));
            const oldIndex = sourceTasks.findIndex(t => t.id === draggedTaskId);
            const newIndex = sourceTasks.findIndex(t => t.id === over.id);
            
            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
              // Use simple array move logic for same-column reordering
              handleSameColumnReorderWrapper(draggedTask, sourceColumnId, newIndex);
            }
            return; // Exit early for same-column moves
          }
        }
      });
    } else if (over.data?.current?.type === 'column' || over.data?.current?.type === 'column-top' || over.data?.current?.type === 'column-bottom') {
      // Dropping on column area
      targetColumnId = over.data.current.columnId as string;
      const columnTasks = columns[targetColumnId]?.tasks || [];
      
      if (over.data?.current?.type === 'column-top') {
        // Drop at position 0 (very top)
        targetIndex = 0;
      } else {
        // Drop at end for regular column or column-bottom
        targetIndex = columnTasks.length > 0 ? Math.max(...columnTasks.map(t => t.position || 0)) + 1 : 0;
      }
      
      } else {
      // Fallback: try using over.id as column ID
      targetColumnId = over.id as string;
      const columnTasks = columns[targetColumnId]?.tasks || [];
      targetIndex = columnTasks.length > 0 ? Math.max(...columnTasks.map(t => t.position || 0)) + 1 : 0;
      
      }

    // Validate we found valid targets
    if (!targetColumnId || targetIndex === undefined) {
        return;
    }

    // For cross-column moves, use the drag preview position if available
    if (sourceColumnId !== targetColumnId && dragPreview?.targetColumnId) {
      // Extract the real column ID from both dragPreview and targetColumnId for comparison
      let previewColumnId = dragPreview.targetColumnId;
      let currentTargetId = targetColumnId;
      
      // Remove -bottom suffix from both if present
      if (previewColumnId.endsWith('-bottom')) {
        previewColumnId = previewColumnId.replace('-bottom', '');
      }
      if (currentTargetId.endsWith('-bottom')) {
        currentTargetId = currentTargetId.replace('-bottom', '');
      }
      
      if (previewColumnId === currentTargetId) {
        targetColumnId = previewColumnId;  // Use the clean column ID
        targetIndex = dragPreview.insertIndex;
          }
    }




    // Handle the move
    if (sourceColumnId === targetColumnId) {
      // Same column - reorder
        handleSameColumnReorderWrapper(draggedTask, sourceColumnId, targetIndex);
    } else {
      // Different column - move
        handleCrossColumnMoveWrapper(draggedTask, sourceColumnId, targetColumnId, targetIndex);
    }
  };

  // Wrapper for handleSameColumnReorder that provides current state
  const handleSameColumnReorderWrapper = async (task: Task, columnId: string, newIndex: number) => {
    try {
      await handleSameColumnReorder(
        task,
        columnId,
        newIndex,
        columns,
        setColumns,
        setDragCooldown,
        refreshBoardData,
        taskFilters.setFilteredColumns
      );
    } catch {
      toast.error(t('errors.moveTaskTitle'), t('errors.moveTaskMessage'));
    }
  };

  // Wrapper for moveTaskToPosition that provides current state (for position-based moves)
  const moveTaskToPositionWrapper = async (task: Task, columnId: string, newPosition: number) => {
    try {
      await moveTaskToPosition(
        task,
        columnId,
        newPosition,
        columns,
        setColumns,
        setDragCooldown,
        refreshBoardData,
        taskFilters.setFilteredColumns
      );
    } catch {
      toast.error(t('errors.moveTaskTitle'), t('errors.moveTaskMessage'));
    }
  };

  // Handle moving task to different column via ListView dropdown or drag & drop
  const handleMoveTaskToColumn = useCallback(async (
    taskId: string,
    targetColumnId: string,
    placement?: TaskDropPlacement
  ) => {
    dndLog('🎯 handleMoveTaskToColumn called:', {
      taskId,
      targetColumnId,
      placement,
      columnsCount: Object.keys(columns).length
    });

    // Find the task and its current column
    let sourceTask: Task | null = null;
    let sourceColumnId: string | null = null;
    
    Object.entries(columns).forEach(([colId, column]) => {
      const task = column.tasks.find(t => t.id === taskId);
      if (task) {
        sourceTask = task;
        sourceColumnId = colId;
      }
    });

    dndLog('🎯 Task lookup result:', {
      sourceTask: sourceTask ? { id: sourceTask.id, title: sourceTask.title, position: sourceTask.position } : null,
      sourceColumnId
    });

    if (!sourceTask || !sourceColumnId) {
      dndLog('🎯 Task not found, returning early');
      return; // Task not found
    }

    const targetColumn = columns[targetColumnId];
    if (!targetColumn) {
      dndLog('🎯 Target column not found:', targetColumnId);
      return;
    }

    // Resolve placement against FULL column (not filtered). Default: append to end (ListView).
    const resolvedPlacement: TaskDropPlacement = placement || { kind: 'end' };
    const targetIndex = resolveDropIndex(targetColumn.tasks, resolvedPlacement, taskId);

    dndLog('🎯 Resolved drop index:', { resolvedPlacement, targetIndex });

    // Soft WIP warning when crossing into a limited column at/over capacity
    if (sourceColumnId !== targetColumnId && hasWipLimit(targetColumn.wip_limit)) {
      const destCount = targetColumn.tasks.length;
      const status = getWipStatus(destCount + 1, targetColumn.wip_limit);
      if (status === 'at' || status === 'over') {
        toast.warning(
          t('column.wipSoftWarningTitle', { ns: 'tasks' }),
          t('column.wipSoftWarningBody', {
            ns: 'tasks',
            count: destCount + 1,
            limit: targetColumn.wip_limit,
            column: targetColumn.title,
          })
        );
      }
    }

    // Check if this is a same-column reorder or cross-column move
    if (sourceColumnId === targetColumnId) {
      await moveTaskToPositionWrapper(sourceTask, sourceColumnId, targetIndex);
    } else {
      await handleCrossColumnMoveWrapper(sourceTask, sourceColumnId, targetColumnId, targetIndex);
    }
  }, [columns, t]);

  // Wrapper for handleCrossColumnMove that provides current state
  const handleCrossColumnMoveWrapper = async (task: Task, sourceColumnId: string, targetColumnId: string, targetIndex: number) => {
    try {
      await handleCrossColumnMove(
        task,
        sourceColumnId,
        targetColumnId,
        targetIndex,
        columns,
        setColumns,
        setDragCooldown,
        refreshBoardData,
        taskFilters.setFilteredColumns
      );
    } catch {
      toast.error(t('errors.moveTaskTitle'), t('errors.moveTaskMessage'));
    }
  };


  const handleEditColumn = async (
    columnId: string,
    title: string,
    is_finished?: boolean,
    is_archived?: boolean,
    wip_limit?: number | null,
    policy_text?: string | null
  ) => {
    try {
      await updateColumn(columnId, title, is_finished, is_archived, wip_limit, policy_text);
      setColumns(prev => ({
        ...prev,
        [columnId]: {
          ...prev[columnId],
          title,
          is_finished,
          is_archived,
          wip_limit: wip_limit !== undefined ? wip_limit : prev[columnId]?.wip_limit,
          policy_text: policy_text !== undefined ? policy_text : prev[columnId]?.policy_text,
        }
      }));
      
      // If column becomes archived, remove it from an explicit visibility list (default already hides archives)
      if (is_archived && selectedBoard && boardColumnVisibility[selectedBoard]) {
        const updatedVisibleColumns = boardColumnVisibility[selectedBoard].filter(
          (id) => id !== columnId
        );
        handleBoardColumnVisibilityChange(selectedBoard, updatedVisibleColumns);
      }
      
      await fetchQueryLogs();
    } catch (error) {
      toast.error(t('errors.updateColumnTitle'), t('errors.updateColumnMessage'));
    }
  };

  // Helper function to count live tasks in a column
  const getColumnTaskCount = (columnId: string): number => {
    return columns[columnId]?.tasks?.length || 0;
  };

  // Delete column only when empty of live tasks (server also enforces this)
  const handleRemoveColumn = async (columnId: string) => {
    const taskCount = getColumnTaskCount(columnId);
    if (taskCount > 0) {
      toast.error(
        t('errors.deleteColumnTitle'),
        t('errors.columnNotEmpty', { count: taskCount })
      );
      return;
    }
    await handleConfirmColumnDelete(columnId);
  };

  // Confirm column deletion
  const handleConfirmColumnDelete = async (columnId: string) => {
    try {
      await deleteColumn(columnId);
      setColumns((prev) => {
        const { [columnId]: _removed, ...remainingColumns } = prev;
        return remainingColumns;
      });
      setBoards((prev) =>
        prev.map((board) => {
          if (!board.columns?.[columnId]) return board;
          const { [columnId]: _removed, ...remainingColumns } = board.columns;
          return { ...board, columns: remainingColumns };
        })
      );
      setShowColumnDeleteConfirm(null);
      await fetchQueryLogs();
    } catch (error: any) {
      const code = error?.response?.data?.code;
      const apiMessage = error?.response?.data?.error;
      if (code === 'column_not_empty') {
        toast.error(
          t('errors.deleteColumnTitle'),
          apiMessage || t('errors.columnNotEmpty', { count: error?.response?.data?.taskCount || 0 })
        );
      } else if (code === 'column_trash_needs_fallback') {
        toast.error(
          t('errors.deleteColumnTitle'),
          apiMessage || t('errors.columnTrashNeedsFallback')
        );
      } else {
        toast.error(
          t('errors.deleteColumnTitle'),
          apiMessage || t('errors.deleteColumnMessage')
        );
      }
    }
  };

  // Cancel column deletion
  const handleCancelColumnDelete = () => {
    // console.log(`❌ Cancelling column deletion`);
    setShowColumnDeleteConfirm(null);
  };

  const performCrossBoardMove = useCallback(async (
    taskId: string,
    targetBoardId: string,
    options?: { skipEmail?: boolean }
  ) => {
    const targetBoard = boards.find((b) => b.id === targetBoardId);
    if (targetBoard && hasWipLimit(targetBoard.wip_limit)) {
      const nextCount =
        getBoardWipTaskCount(dedupeTasksInColumns(targetBoard.columns || {})) + 1;
      const status = getWipStatus(nextCount, targetBoard.wip_limit);
      if (status === 'at' || status === 'over') {
        toast.warning(
          t('board.wipSoftWarningTitle', { ns: 'tasks' }),
          t('board.wipSoftWarningBody', {
            ns: 'tasks',
            count: nextCount,
            limit: targetBoard.wip_limit,
            board: targetBoard.title,
          })
        );
      }
    }
    await moveTaskToBoard(taskId, targetBoardId, options);
    // Force refresh: cross-board move often coincides with justUpdatedFromWebSocket; a skipped
    // refresh leaves boards[] stale for the target board until the user switches tabs again.
    await refreshBoardData({ force: true });
  }, [refreshBoardData, boards, t]);

  // Handle cross-board task drop (confirms when task has parent/child/related links — server removes them on move)
  const handleTaskDropOnBoard = useCallback(
    async (taskId: string, targetBoardId: string) => {
      try {
        let relationshipCount = 0;
        try {
          const rels = await getTaskRelationships(taskId);
          if (Array.isArray(rels)) relationshipCount = rels.length;
        } catch (err) {
          console.error('Could not load task relationships before cross-board move:', err);
        }
        if (relationshipCount > 0) {
          setCrossBoardMovePending({ taskId, targetBoardId, relationshipCount });
          return;
        }
        await performCrossBoardMove(taskId, targetBoardId);
      } catch (error) {
        console.error('Failed to move task to board:', error);
        toast.error(t('errors.moveTaskToBoardTitle'), t('errors.moveTaskToBoardMessage'));
      }
    },
    [performCrossBoardMove, t]
  );

  const handleConfirmCrossBoardMove = useCallback(async () => {
    const pending = crossBoardMovePending;
    if (!pending) return;
    setCrossBoardMoveBusy(true);
    try {
      await performCrossBoardMove(pending.taskId, pending.targetBoardId);
      setCrossBoardMovePending(null);
    } catch (error) {
      console.error('Failed to move task to board:', error);
      toast.error(t('errors.moveTaskToBoardTitle'), t('errors.moveTaskToBoardMessage'));
    } finally {
      setCrossBoardMoveBusy(false);
    }
  }, [crossBoardMovePending, performCrossBoardMove, t]);

  const handleCancelCrossBoardMove = useCallback(() => {
    if (!crossBoardMoveBusy) setCrossBoardMovePending(null);
  }, [crossBoardMoveBusy]);

  const findTaskInColumns = useCallback(
    (taskId: string): Task | null => {
      for (const column of Object.values(columns)) {
        const found = column?.tasks?.find((t) => t.id === taskId);
        if (found) return found;
      }
      return null;
    },
    [columns]
  );

  const kanbanMultiSelect = useKanbanMultiSelect({
    columns,
    selectedBoard,
    isLinkingMode: taskLinking.isLinkingMode,
    detailsOpen: !!selectedTask,
    findTask: findTaskInColumns,
    onEditTask: handleEditTask,
    onCopyTask: handleCopyTask,
    onTagAdd: handleTagAdd,
    onTagRemove: handleTagRemove,
    onSoftDelete: handleTaskDelete,
    onRestoreTasks: async (taskIds) => {
      for (const id of taskIds) {
        await restoreTask(id);
      }
      await refreshBoardData({ force: true });
      notifyBoardTrashChanged(selectedBoardRef.current);
    },
    onPermanentDelete: currentUser?.roles?.includes('admin')
      ? handleTaskPermanentDelete
      : undefined,
    onMoveToBoard: performCrossBoardMove,
    getArchiveColumnId: () => {
      const archive = Object.values(columns).find((col) => isArchivedColumnFlag(col));
      return archive?.id || null;
    },
    availablePriorities,
    availableSprints,
    availableTags,
  });

  const {
    clearAllChecked,
    warnWipOnce,
    checkedTaskIds,
    toggleTaskChecked,
    toggleColumnChecked,
    isMultiSelectDragLocked,
    bulkBusy,
    onBulkAddTag,
    onBulkCopy,
    onBulkArchive,
    onBulkDelete,
    onBulkPermanentDelete,
    onBulkSprint,
    onBulkPriority,
    onBulkMoveToBoard,
    onBulkAssignee,
    onBulkRequester,
    onBulkAddWatcher,
    onBulkRemoveWatcher,
    onBulkAddCollaborator,
    onBulkRemoveCollaborator,
    bulkUndo,
    clearBulkUndo,
    onBulkUndo,
    recordColumnMoveUndo,
  } = kanbanMultiSelect;

  const handleBulkMoveTaskIds = useCallback(
    async (taskIds: string[], targetColumnId: string, placement: TaskDropPlacement) => {
      if (taskIds.length === 0) return;
      const targetColumn = columns[targetColumnId];
      if (!targetColumn) return;

      const sourceColumnId = getTaskColumnId(taskIds[0], columns);
      const followers = taskIds.slice(1);
      const targetIndex = resolveDropIndex(
        targetColumn.tasks,
        placement,
        taskIds[0],
        followers
      );

      if (sourceColumnId) {
        warnWipOnce(sourceColumnId, targetColumnId, taskIds.length);
      }

      // Preserve relative column order for the block
      const orderedIds =
        sourceColumnId && columns[sourceColumnId]
          ? orderedCheckedTasksInColumn(new Set(taskIds), columns[sourceColumnId].tasks).map(
              (t) => t.id
            )
          : taskIds;

      const previousByTaskId: Record<string, Partial<Task>> = {};
      for (const id of orderedIds) {
        const task = findTaskInColumns(id);
        if (!task) continue;
        previousByTaskId[id] = {
          columnId: task.columnId,
          position: task.position,
        };
      }

      await handleBulkMoveTasks(
        orderedIds,
        targetColumnId,
        targetIndex,
        columns,
        setColumns,
        setDragCooldown,
        refreshBoardData,
        taskFilters.setFilteredColumns
      );
      if (orderedIds.length >= 2 && Object.keys(previousByTaskId).length > 0) {
        const movedAcross =
          sourceColumnId != null && sourceColumnId !== targetColumnId;
        if (movedAcross) {
          recordColumnMoveUndo(orderedIds, previousByTaskId);
        }
      }
      clearAllChecked();
      setDraggedTaskIds([]);
    },
    [
      columns,
      clearAllChecked,
      findTaskInColumns,
      recordColumnMoveUndo,
      warnWipOnce,
      refreshBoardData,
      taskFilters.setFilteredColumns,
    ]
  );

  const handleColumnReorder = useCallback(async (columnId: string, newPosition: number) => {
    try {
      await reorderColumns(columnId, newPosition, selectedBoard || '');
      await renumberColumns(selectedBoard || ''); // Ensure clean positions
      
      // Defer non-critical updates to avoid forced reflows during drag end
      // Use requestAnimationFrame to batch DOM reads/writes
      // NOTE: WebSocket update will handle the state sync completely
      // We don't call refreshBoardData here to avoid overwriting the WebSocket update
      requestAnimationFrame(() => {
        // Defer query logs to next frame
        // This prevents forced reflows during the drag end handler
        setTimeout(() => {
          fetchQueryLogs();
          // WebSocket update handles state sync, so we don't refresh here
          // If WebSocket fails, we'll refresh on error
        }, 0);
      });
    } catch (error) {
      // console.error('Failed to reorder column:', error);
      // Only refresh on error - WebSocket should handle success case
      await refreshBoardData();
    }
  }, [selectedBoard, fetchQueryLogs]);
  
  // Stable callbacks for drag state - use refs to avoid triggering re-renders during drag
  const handleDraggedTaskChange = useCallback((task: Task | null) => {
    draggedTaskRef.current = task;
    setDraggedTask(task);
  }, []);
  
  const handleDraggedColumnChange = useCallback((column: Column | null) => {
    draggedColumnRef.current = column;
    setDraggedColumn(column);
  }, []);
  
  const handleBoardTabHover = useCallback((isHovering: boolean) => {
    isHoveringBoardTabRef.current = isHovering;
    setIsHoveringBoardTab(isHovering);
  }, []);
  
  const handleDragPreviewChange = useCallback((preview: DragPreview | null) => {
    dragPreviewRef.current = preview;
    setDragPreview(preview);
  }, []);
  
  // Memoize filteredColumns to prevent unnecessary re-renders during drag
  // Use state that only updates when the data signature actually changes
  const filteredColumnsSignatureRef = useRef<string>('');
  const [stableFilteredColumns, setStableFilteredColumns] = useState<Columns>(taskFilters.filteredColumns || {});
  
  // Update state only when data actually changes (using useEffect to avoid recalculating on every render)
  useEffect(() => {
    const current = taskFilters.filteredColumns || {};
    
    // Signature must include order AND display fields. Task id lists alone miss title/description/
    // effort/watchers/etc., so side-panel edits never refreshed Kanban (columns={stableFilteredColumns}).
    // Structure-only signatures also hid intra-column reorder until position was included.
    const taskContentKey = (t: Task) => {
      const desc = t.description || '';
      const watchers = (t.watchers || []).map((w: any) => w?.id ?? w).join(',');
      const collaborators = (t.collaborators || []).map((c: any) => c?.id ?? c).join(',');
      return [
        t.id,
        t.position ?? '',
        t.title ?? '',
        desc.length,
        // Sample ends so long HTML edits still invalidate without hashing the whole body
        desc.slice(0, 48),
        desc.slice(-48),
        t.effort ?? '',
        t.memberId ?? '',
        t.requesterId ?? '',
        t.priorityId ?? t.priority ?? '',
        t.attachmentCount ?? '',
        t.dueDate ?? '',
        t.startDate ?? '',
        t.sprintId ?? '',
        watchers,
        collaborators,
      ].join('~');
    };

    const signature = Object.keys(current).sort().map(columnId => {
      const column = current[columnId];
      const taskKeys = [...(column?.tasks || [])]
        .sort((a, b) => {
          const pa = typeof a.position === 'number' ? a.position : parseFloat(String(a.position)) || 0;
          const pb = typeof b.position === 'number' ? b.position : parseFloat(String(b.position)) || 0;
          if (pa !== pb) return pa - pb;
          return String(a.id).localeCompare(String(b.id));
        })
        .map(taskContentKey)
        .join(',');
      const position = column?.position ?? 0;
      return `${columnId}:${position}:${taskKeys}`;
    }).join('|');
    
    // Only update state if signature changed (actual data changed)
    if (signature !== filteredColumnsSignatureRef.current) {
      filteredColumnsSignatureRef.current = signature;
      setStableFilteredColumns(current);
    }
  }, [taskFilters.filteredColumns]);

  // Mini mode handlers (now unused - keeping for compatibility)
  const handleTaskEnterMiniMode = () => {
    // No-op - mini mode is now automatic
  };

  const handleTaskExitMiniMode = () => {
    // No-op - mini mode is now automatic
  };

  // Always use mini mode when dragging tasks for simplicity
  useEffect(() => {
    // Set mini mode whenever we have a dragged task
    setIsTaskMiniMode(!!draggedTask);
    
    // Only clear cursor if drag ends (draggedTask becomes null)
    if (!draggedTask && dragStartedRef.current) {
      clearCustomCursor(dragStartedRef);
    }
  }, [draggedTask]);

  const handleAddColumn = async (afterColumnId: string) => {
    if (!selectedBoard) return;

    // Generate auto-numbered column name
    const baseColumnName = i18n.t('column.newColumn', { ns: 'tasks' });
    const existingColumnTitles = Object.values(columns).map(col => col.title);
    let columnNumber = 1;
    let newTitle = `${baseColumnName} ${columnNumber}`;
    while (existingColumnTitles.includes(newTitle)) {
      columnNumber++;
      newTitle = `${baseColumnName} ${columnNumber}`;
    }

    // Server interprets position as insert index: ceil(n) with shift of columns >= that index.
    // afterPosition + 1 places the new column immediately to the right of the anchor column.
    const afterColumn = columns[afterColumnId];
    const afterPosition = afterColumn?.position ?? 0;

    const columnId = generateUUID();
    const newColumn: Column = {
      id: columnId,
      title: newTitle,
      tasks: [],
      boardId: selectedBoard,
      position: afterPosition + 1,
    };

    try {
      const created = await createColumn(newColumn);

      if (
        Array.isArray(created.columns) &&
        created.columns.length > 0 &&
        selectedBoard
      ) {
        const sorted = [...created.columns].sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0)
        );

        window.justUpdatedFromWebSocket = true;
        setBoards(prev =>
          prev.map(board => {
            if (board.id !== selectedBoard) return board;
            const nextCols: Columns = {};
            sorted.forEach(col => {
              nextCols[col.id] = {
                ...col,
                tasks: board.columns[col.id]?.tasks ?? [],
              };
            });
            return { ...board, columns: nextCols };
          })
        );
        setColumns(prev => {
          const nextCols: Columns = {};
          sorted.forEach(col => {
            nextCols[col.id] = {
              ...col,
              tasks: prev[col.id]?.tasks ?? [],
            };
          });
          return nextCols;
        });
        setTimeout(() => {
          window.justUpdatedFromWebSocket = false;
        }, 1000);

        // Only touch saved visibility when the user already customized it.
        // Otherwise default visibility hides Archive and includes the new column automatically.
        if (boardColumnVisibility[selectedBoard]) {
          const currentVisibleColumns = boardColumnVisibility[selectedBoard];
          const visibleSet = new Set([...currentVisibleColumns, columnId]);
          const newVisible = sorted.map((c) => c.id).filter((id) => visibleSet.has(id));
          handleBoardColumnVisibilityChange(selectedBoard, newVisible);
        }
      } else {
        if (boardColumnVisibility[selectedBoard]) {
          handleBoardColumnVisibilityChange(selectedBoard, [
            ...boardColumnVisibility[selectedBoard],
            columnId,
          ]);
        }
        await refreshBoardData();
        if (selectedBoard) await renumberColumns(selectedBoard);
      }

      await fetchQueryLogs();
    } catch (error) {
      toast.error(t('errors.createColumnTitle'), t('errors.createColumnMessage'));
    }
  };

  const handleColumnDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedColumn = Object.values(columns).find(col => col.id === active.id);
    if (draggedColumn) {
      setDraggedColumn(draggedColumn);
    }
  };

  const handleColumnDragEnd = async (event: DragEndEvent) => {
    if (!canMutate) return;
    const { active, over } = event;
    
    setDraggedColumn(null);
    
    if (!over || active.id === over.id || !selectedBoard) return;
    
    try {
      const columnArray = Object.values(columns).sort((a, b) => (a.position || 0) - (b.position || 0));
      const oldIndex = columnArray.findIndex(col => col.id === active.id);
      const newIndex = columnArray.findIndex(col => col.id === over.id);
      
      if (oldIndex === -1 || newIndex === -1) return;
      
      // Get target column to determine the correct position
      const targetColumn = columnArray[newIndex];
      const sourceColumn = columnArray[oldIndex];
      const sourcePosition = Math.floor(sourceColumn.position || 0);
      const targetPosition = Math.floor(targetColumn.position || 0);
      
      // Determine if we're moving left (to lower position) or right (to higher position)
      const movingLeft = sourcePosition > targetPosition;
      const movingRight = sourcePosition < targetPosition;
      
      // For edge cases: when dropping on first or last column
      const isFirstColumn = newIndex === 0;
      const isLastColumn = newIndex === columnArray.length - 1;
      
      let finalTargetPosition = targetPosition;
      
      if (movingLeft && isFirstColumn) {
        // Moving left to first position (position 0): dropped column takes position 0
        finalTargetPosition = 0;
      } else if (movingRight && isLastColumn) {
        // Moving right to last position: dropped column takes the last position
        finalTargetPosition = targetPosition;
      } else {
        // Normal case: use target's position
        finalTargetPosition = targetPosition;
      }
      
      // Update database - use handleColumnReorder which handles refresh and renumbering
      await handleColumnReorder(active.id as string, finalTargetPosition);
      await fetchQueryLogs();
    } catch (error) {
      // console.error('Failed to reorder columns:', error);
      // Revert on error
      await refreshBoardData();
    }
  };

  // Calculate grid columns based on number of columns and user's preferred width
  const columnCount = Object.keys(columns).length;
  const gridStyle = calculateGridStyle(columnCount, kanbanColumnWidth);
  
  // Handle column width resize
  const handleColumnWidthResize = (deltaX: number) => {
    const newWidth = Math.max(280, Math.min(600, kanbanColumnWidth + deltaX)); // Min 200px, max 600px
    setKanbanColumnWidth(newWidth);
    updateCurrentUserPreference('kanbanColumnWidth', newWidth);
  };

  const clearQueryLogs = async () => {
    setQueryLogs([]);
  };



  const handleTaskViewModeChange = (mode: TaskViewMode) => {
    taskFilters.setTaskViewMode(mode);
    updateCurrentUserPreference('taskViewMode', mode);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    taskFilters.setViewMode(mode);
    taskFilters.viewModeRef.current = mode;
    updateCurrentUserPreference('viewMode', mode);
  };

  // Filter handlers are now in useTaskFilters hook (taskFilters.*)

  // Handle selecting all members
  const handleDismissColumnWarning = useCallback((columnId: string) => {
    setColumnWarnings(prev => {
      const { [columnId]: removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleClearFiltersForHiddenTask = useCallback(async () => {
    taskFilters.clearVisibilityObstructingFilters();
    setColumnWarnings({});
    const uid = currentUser?.id;
    if (!uid) return;
    const prefs = mergeClearedKanbanVisibilityFilters(loadUserPreferences(uid));
    await saveUserPreferences(prefs, uid);
  }, [taskFilters.clearVisibilityObstructingFilters, currentUser?.id]);

  const handleAssignCreatedTaskToSprint = useCallback(
    async (columnId: string, taskId: string, sprintId: string) => {
      const task = Object.values(columns).flatMap(c => c.tasks).find(tk => tk.id === taskId);
      if (!task) {
        handleDismissColumnWarning(columnId);
        return;
      }
      try {
        const sprint = availableSprints.find((s: any) => s.id === sprintId);
        const updated: Task = {
          ...task,
          sprintId,
          ...(sprint?.start_date
            ? { startDate: formatToYYYYMMDD(sprint.start_date) }
            : {}),
          ...(sprint?.end_date
            ? { dueDate: formatToYYYYMMDD(sprint.end_date) }
            : {}),
        };
        await updateTask(updated);
        setColumns(prev => ({
          ...prev,
          [task.columnId]: {
            ...prev[task.columnId],
            tasks: prev[task.columnId].tasks.map(tk => (tk.id === taskId ? updated : tk)),
          },
        }));
        if (selectedBoard) {
          setBoards(prev =>
            prev.map(board => {
              if (board.id !== selectedBoard) return board;
              const cols = { ...board.columns };
              for (const cid of Object.keys(cols)) {
                const col = cols[cid];
                if (!col?.tasks?.some(tk => tk.id === taskId)) continue;
                cols[cid] = {
                  ...col,
                  tasks: col.tasks.map(tk => (tk.id === taskId ? updated : tk)),
                };
              }
              return { ...board, columns: cols };
            })
          );
        }
        const nextWarn = buildColumnVisibilityWarningForTask(updated);
        if (nextWarn) {
          setColumnWarnings(prev => ({ ...prev, [columnId]: nextWarn }));
        } else {
          handleDismissColumnWarning(columnId);
        }
      } catch (err) {
        console.error('Failed to assign sprint to new task:', err);
        toast.error(
          t('column.sprintAssignFailedTitle'),
          t('column.sprintAssignFailedBody'),
          4000
        );
      }
    },
    [
      columns,
      selectedBoard,
      availableSprints,
      handleDismissColumnWarning,
      t,
      buildColumnVisibilityWarningForTask,
    ]
  );

  // Filter handlers, shouldIncludeTask, and filtering useEffect are now in useTaskFilters hook (taskFilters.*)

  // Use filtered columns state — only count hidden *non-archived* columns (archived are hidden by default)
  const hasColumnFilters = (() => {
    if (!selectedBoard || !boardColumnVisibility[selectedBoard]) return false;
    const visibleIds = boardColumnVisibility[selectedBoard];
    const allColumns = Object.values(columns);
    if (allColumns.length === 0) return false;
    const isArchived = (col: { is_archived?: boolean | number }) =>
      col.is_archived === true || col.is_archived === 1;
    const nonArchived = allColumns.filter((col) => !isArchived(col));
    const visibleNonArchived = visibleIds.filter((colId) => {
      const col = columns[colId];
      return col && !isArchived(col);
    });
    // Visibility list not synced with columns yet — don't treat as filtered
    if (visibleNonArchived.length === 0 && visibleIds.length > 0) return false;
    return visibleNonArchived.length < nonArchived.length;
  })();
  // Role chips: default is Assignees-only (includeAssignees true, others false).
  // Do not treat that default as an "active filter" or the Search indicator never clears.
  const hasNonDefaultRoleFilters =
    !taskFilters.includeAssignees ||
    taskFilters.includeWatchers ||
    taskFilters.includeCollaborators ||
    taskFilters.includeRequesters;
  const activeFilters =
    hasActiveFilters(taskFilters.searchFilters, taskFilters.isSearchActive) ||
    taskFilters.selectedMembers.length > 0 ||
    hasNonDefaultRoleFilters ||
    hasColumnFilters ||
    taskFilters.selectedSprintId !== null ||
    (siteSettings?.AI_ENABLED === 'true' && !taskFilters.showAgentTasks);
  const getTaskCountForBoard = (board: Board) => {
    // During board switching, return the last calculated count to prevent flashing
    if (isSwitchingBoard && lastTaskCountsRef.current[board.id] !== undefined) {
      return lastTaskCountsRef.current[board.id];
    }

    // Prefer live columns for the selected board; otherwise use board snapshot
    const boardColumnsRaw: Columns =
      board.id === selectedBoard ? columns : (board.columns || {});
    const boardColumns = dedupeTasksInColumns(boardColumnsRaw);

    // Explicit visibility list (user toggled columns). Default: all non-archived.
    const explicitVisibility = boardColumnVisibility[board.id];
    const visibleColumnIds = explicitVisibility
      ? explicitVisibility
      : Object.values(boardColumns)
          .filter((col) => col && !Boolean(col.is_archived))
          .map((col) => col.id);

    const visibleSet = new Set(visibleColumnIds);

    // Selected board: filteredColumns already has search/member/sprint/agent applied — count visible cols only
    if (board.id === selectedBoard && taskFilters.filteredColumns && Object.keys(taskFilters.filteredColumns).length > 0) {
      const currentBoardData = boards.find((b) => b.id === selectedBoard);
      const currentBoardColumnIds = currentBoardData ? Object.keys(currentBoardData.columns || {}) : [];
      const filteredColumnIds = Object.keys(taskFilters.filteredColumns);
      const isValidForCurrentBoard =
        currentBoardColumnIds.length > 0 &&
        filteredColumnIds.every((id) => currentBoardColumnIds.includes(id)) &&
        currentBoardColumnIds.every((id) => filteredColumnIds.includes(id));

      if (isValidForCurrentBoard) {
        const dedupedFiltered = dedupeTasksInColumns(taskFilters.filteredColumns);
        let totalCount = 0;
        Object.values(dedupedFiltered).forEach((column) => {
          if (visibleSet.has(column.id)) {
            totalCount += column.tasks?.length || 0;
          }
        });
        lastTaskCountsRef.current[board.id] = totalCount;
        return totalCount;
      }
    }

    // Other boards (or fallback): apply same search/sprint/agent/member filters as the selected board
    const applyMemberFilter = taskFilters.selectedMembers.length > 0;

    let totalCount = 0;
    Object.values(boardColumns).forEach((column) => {
      if (!column?.tasks || !Array.isArray(column.tasks)) return;
      if (!visibleSet.has(column.id)) return;

      const filteredTasks = column.tasks.filter((task) => {
        if (!task) return false;

        // Agent visibility applies to every board’s tab counts, not only the selected board
        if (
          siteSettings?.AI_ENABLED === 'true' &&
          !taskFilters.showAgentTasks &&
          isAgentMemberId(task.memberId)
        ) {
          return false;
        }

        if (!taskMatchesSelectedSprint(task, taskFilters.selectedSprintId)) {
          return false;
        }

        if (hasConfiguredSearchFilters(taskFilters.searchFilters)) {
          const searchFiltered = filterTasks(
            [task],
            taskFilters.searchFilters,
            true,
            members,
            boards,
            availableSprints
          );
          if (searchFiltered.length === 0) return false;
        }

        if (!applyMemberFilter) return true;

        const memberIds = new Set(taskFilters.selectedMembers);
        let hasMatchingMember = false;

        if (taskFilters.includeAssignees && task.memberId && memberIds.has(task.memberId)) {
          hasMatchingMember = true;
        }
        if (!hasMatchingMember && taskFilters.includeRequesters && task.requesterId && memberIds.has(task.requesterId)) {
          hasMatchingMember = true;
        }
        if (
          !hasMatchingMember &&
          taskFilters.includeWatchers &&
          task.watchers?.some((w) => w && memberIds.has(w.id))
        ) {
          hasMatchingMember = true;
        }
        if (
          !hasMatchingMember &&
          taskFilters.includeCollaborators &&
          task.collaborators?.some((c) => c && memberIds.has(c.id))
        ) {
          hasMatchingMember = true;
        }

        return hasMatchingMember;
      });

      totalCount += filteredTasks.length;
    });

    lastTaskCountsRef.current[board.id] = totalCount;
    return totalCount;
  };

  // Every live task on the board, ignoring search/member/sprint filters. Deleting a board
  // removes tasks that the current filters hide, so confirmations must count all of them.
  const getTotalTaskCountForBoard = (board: Board) => {
    const boardColumnsRaw: Columns =
      board.id === selectedBoard ? columns : (board.columns || {});
    const boardColumns = dedupeTasksInColumns(boardColumnsRaw);

    return Object.values(boardColumns).reduce(
      (total, column) => total + (column?.tasks?.length || 0),
      0
    );
  };

  /** Active-work WIP count: excludes finished/archived columns (and thus done/archive tasks). */
  const getBoardWipTaskCountForBoard = (board: Board) => {
    const boardColumnsRaw: Columns =
      board.id === selectedBoard ? columns : (board.columns || {});
    return getBoardWipTaskCount(dedupeTasksInColumns(boardColumnsRaw));
  };

  /** Active-work effort: same column scope as board WIP (excludes finished/archived). */
  const getBoardWipEffortForBoard = (board: Board) => {
    const boardColumnsRaw: Columns =
      board.id === selectedBoard ? columns : (board.columns || {});
    return sumTaskEffort(getBoardWipTasks(dedupeTasksInColumns(boardColumnsRaw)) as Task[]);
  };

  const warnIfBoardWipSoftLimit = (board: Board | undefined, nextActiveCount: number) => {
    if (!board || !hasWipLimit(board.wip_limit)) return;
    const status = getWipStatus(nextActiveCount, board.wip_limit);
    if (status !== 'at' && status !== 'over') return;
    toast.warning(
      t('board.wipSoftWarningTitle', { ns: 'tasks' }),
      t('board.wipSoftWarningBody', {
        ns: 'tasks',
        count: nextActiveCount,
        limit: board.wip_limit,
        board: board.title,
      })
    );
  };


  // Keep shortcut handlers current without reordering hooks past early returns below.
  keyboardShortcutApiRef.current = {
    openHelp: () => modalState.openHelpModal(),
    focusSearch: () => {
      focusHeaderTaskSearch();
    },
    newTask: () => {
      if (taskLinking.isLinkingMode) return;
      if (!selectedBoard || !currentUser || !isOnline) return;
      const sorted = Object.values(columns).sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );
      const firstColumn = sorted[0];
      if (!firstColumn) return;
      void (async () => {
        const created = await handleAddTask(firstColumn.id);
        if (!created) return;
        toast.info(
          t('errors.createTaskShortcutTitle'),
          t('errors.createTaskShortcutMessage', { column: firstColumn.title })
        );
      })();
    },
    setViewMode: handleViewModeChange,
    setTaskViewMode: handleTaskViewModeChange,
    toggleSearchPanel: taskFilters.handleToggleSearch,
  };

  // Handle password reset pages (accessible without authentication)
  if (currentPage === 'forgot-password') {
    return <ForgotPassword onBackToLogin={() => window.location.hash = '#kanban'} />;
  }
  
  if (currentPage === 'reset-password') {
  return (
      <ResetPassword 
        token={resetToken}
        onBackToLogin={() => window.location.hash = '#kanban'}
        onResetSuccess={() => window.location.hash = '#reset-success'}
        onAutoLogin={async (user, token) => {
          // Automatically log the user in
          await handleLogin(user, token);
          // Small delay to allow auth state to propagate, then navigate
          setTimeout(() => {
            window.location.hash = '#kanban';
          }, 100);
        }}
      />
    );
  }
  
  if (currentPage === 'reset-success') {
    return <ResetPasswordSuccess onBackToLogin={() => window.location.hash = '#kanban'} />;
  }
  
  if (currentPage === 'activate-account') {
    return (
      <ActivateAccount 
        token={activationToken}
        email={activationEmail}
        onBackToLogin={() => window.location.hash = '#kanban'}
        isLoading={!activationParsed}
        onAutoLogin={async (user, token) => {
          // Automatically log the user in
          await handleLogin(user, token);
          // Small delay to allow auth state to propagate, then navigate
          setTimeout(() => {
            window.location.hash = '#kanban';
          }, 100);
        }}
      />
    );
  }

  // Handle task page (requires authentication)
  if (currentPage === 'task') {
    if (!isAuthenticated && authChecked) {
      return (
        <Login
          siteSettings={siteSettings}
          onLogin={handleLogin}
          hasDefaultAdmin={hasDefaultAdmin ?? undefined}
          intendedDestination={intendedDestination}
          onForgotPassword={() => {
            localStorage.removeItem('authToken');
            window.location.hash = '#forgot-password';
          }}
        />
      );
    }
    
    return (
      <ThemeProvider>
        <TourProvider currentUser={currentUser} onViewModeChange={handleViewModeChange} onPageChange={handlePageChange}>
          <Suspense fallback={<PageLoader />}>
            <TaskPage 
              currentUser={currentUser}
              siteSettings={siteSettings}
              members={members}
              isPolling={isPolling}
              lastPollTime={lastPollTime}
              onLogout={handleLogout}
              onPageChange={handlePageChange}
              onRefresh={handleRefreshData}
              onInviteUser={handleInviteUser}
              // isAutoRefreshEnabled={isAutoRefreshEnabled} // Disabled - using real-time updates
              // onToggleAutoRefresh={handleToggleAutoRefresh} // Disabled - using real-time updates
            />
          </Suspense>
        </TourProvider>
      </ThemeProvider>
    );
  }

  // Show loading state while checking authentication
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated (but only after auth check is complete)
  if (!isAuthenticated) {
    return (
      <Login 
        onLogin={handleLogin} 
        siteSettings={siteSettings}
        hasDefaultAdmin={hasDefaultAdmin ?? undefined}
        intendedDestination={intendedDestination}
        onForgotPassword={() => {
          // Clear auth token to prevent conflicts during password reset
          localStorage.removeItem('authToken');
          window.location.hash = '#forgot-password';
          // setCurrentPage will be called by the routing handler
        }}
      />
    );
  }

  // Ghost session: token/auth flag without a user (e.g. mid demo-reset). Don't mount KanbanPage.
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Restoring session…</p>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
    <OwnerSetupProvider
      currentUser={currentUser}
      boards={boards}
      memberCount={members.length}
      sprintCount={availableSprints.length}
      tagCount={availableTags.length}
      priorityCount={availablePriorities.length}
      onPageChange={handlePageChange}
    >
    <TourProvider currentUser={currentUser} onViewModeChange={handleViewModeChange} onPageChange={handlePageChange}>
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--main-bg)' }}>
      {/* Demo Reset Counter is now rendered in Header component */}
      
      {/* New Enhanced Drag & Drop System */}
      <SimpleDragDropManager
        currentBoardId={selectedBoard || ''}
        columns={stableFilteredColumns}
        boards={boards}
        isOnline={isOnline}
        onTaskMove={handleMoveTaskToColumn}
        onTaskMoveToDifferentBoard={handleTaskDropOnBoard}
        onBulkTaskMove={handleBulkMoveTaskIds}
        checkedTaskIds={checkedTaskIds}
        onClearChecked={clearAllChecked}
        onDraggedTaskIdsChange={setDraggedTaskIds}
        onColumnReorder={handleColumnReorder}
        onDraggedTaskChange={handleDraggedTaskChange}
        onDraggedColumnChange={handleDraggedColumnChange}
        onBoardTabHover={handleBoardTabHover}
        onDragPreviewChange={handleDragPreviewChange}
      >
      <Header
        currentUser={currentUser}
        siteSettings={siteSettings}
        currentPage={currentPage}
        // isPolling={isPolling} // Removed - using real-time WebSocket updates
        // lastPollTime={lastPollTime} // Removed - using real-time WebSocket updates
        members={members}
        onProfileClick={() => modalState.openProfileModal()}
        onLogout={handleLogout}
        onPageChange={handlePageChange}
          onRefresh={handleRefreshData}
          // isAutoRefreshEnabled={isAutoRefreshEnabled} // Disabled - using real-time updates
          // onToggleAutoRefresh={handleToggleAutoRefresh} // Disabled - using real-time updates
        onHelpClick={() => modalState.openHelpModal()}
        onInviteUser={handleInviteUser}
        selectedSprintId={taskFilters.selectedSprintId}
        onSprintChange={taskFilters.handleSprintChange}
        taskSearchText={taskFilters.searchFilters.text || ''}
        onTaskSearchTextChange={(text) =>
          taskFilters.handleSearchFiltersChange({
            ...taskFilters.searchFilters,
            text,
          })
        }
        boards={boards}
        sprints={availableSprints}
      />

      {/* Network Status Indicator */}
      <NetworkStatusIndicator isOnline={isOnline} />

      <div className={versionStatus.instanceStatus.status !== 'active' && !versionStatus.instanceStatus.isDismissed ? 'pt-20' : ''}>
        <MainLayout
        currentPage={currentPage}
        currentUser={currentUser} 
        selectedTask={selectedTask}
        adminRefreshKey={adminRefreshKey}
        siteSettings={siteSettings}
        isOnline={isOnline}
        selectedSprintId={taskFilters.selectedSprintId}
              onUsersChanged={async () => {
                try {
                  const loadedMembers = await getMembers(taskFilters.includeSystem);
                  setMembers(loadedMembers);
                } catch (error) {
                  // console.error('❌ Failed to refresh members:', error);
                }
              }}
              onSettingsChanged={refreshContextSettings} // Use context refresh instead
              onAdminDraftGateChange={handleAdminDraftGateChange}
        loading={loading}
        canMutate={canMutate}
                    members={members}
        boards={boards}
        selectedBoard={selectedBoard}
        columns={columns}
                    selectedMembers={taskFilters.selectedMembers}
        draggedTask={draggedTask}
        draggedColumn={draggedColumn}
        dragPreview={dragPreview}
                      availablePriorities={availablePriorities}
        availableTags={availableTags}
        availableSprints={availableSprints}
        taskViewMode={taskFilters.taskViewMode}
        isSearchActive={taskFilters.isSearchActive}
        searchFilters={taskFilters.searchFilters}
        filteredColumns={taskFilters.filteredColumns}
        activeFilters={activeFilters}
        gridStyle={gridStyle}
        sensors={sensors}
        collisionDetection={collisionDetection}
        boardColumnVisibility={boardColumnVisibility}
        onBoardColumnVisibilityChange={handleBoardColumnVisibilityChange}
        kanbanColumnWidth={kanbanColumnWidth}
        onColumnWidthResize={handleColumnWidthResize}

        onSelectMember={taskFilters.handleMemberToggle}
        onClearMemberSelections={taskFilters.handleClearMemberSelections}
        onSelectAllMembers={taskFilters.handleSelectAllMembers}
        isAllModeActive={taskFilters.isAllModeActive}
        includeAssignees={taskFilters.includeAssignees}
        includeWatchers={taskFilters.includeWatchers}
        includeCollaborators={taskFilters.includeCollaborators}
        includeRequesters={taskFilters.includeRequesters}
        includeSystem={taskFilters.includeSystem}
        onToggleAssignees={taskFilters.handleToggleAssignees}
        onToggleWatchers={taskFilters.handleToggleWatchers}
        onToggleCollaborators={taskFilters.handleToggleCollaborators}
        onToggleRequesters={taskFilters.handleToggleRequesters}
        onToggleSystem={taskFilters.handleToggleSystem}
        onEditOwnProfile={(opts) => modalState.openProfileModal(opts?.focus)}
        showAgentTasks={taskFilters.showAgentTasks}
        onToggleShowAgentTasks={taskFilters.handleToggleShowAgentTasks}
        onTaskViewModeChange={handleTaskViewModeChange}
        viewMode={taskFilters.viewMode}
        onViewModeChange={handleViewModeChange}
        onToggleSearch={taskFilters.handleToggleSearch}
        onSearchFiltersChange={taskFilters.handleSearchFiltersChange}
        currentFilterView={taskFilters.currentFilterView}
        sharedFilterViews={taskFilters.sharedFilterViews}
        onFilterViewChange={taskFilters.handleFilterViewChange}
                    onSelectBoard={handleBoardSelection}
                    onAddBoard={handleAddBoard}
                    onEditBoard={handleEditBoard}
                    onRemoveBoard={handleRemoveBoard}
                    onReorderBoards={handleBoardReorder}
        getTaskCountForBoard={getTaskCountForBoard}
        getBoardWipTaskCountForBoard={getBoardWipTaskCountForBoard}
        getBoardWipEffortForBoard={getBoardWipEffortForBoard}
        getTotalTaskCountForBoard={getTotalTaskCountForBoard}
                        // NOTE: onDragStart and onDragEnd are handled by SimpleDragDropManager
                        // Pass no-op functions to satisfy interface - SimpleDragDropManager handles all drags
                        onDragStart={() => {}}
                        onDragEnd={() => {}}
                                    onAddTask={handleAddTask}
                                    columnWarnings={columnWarnings}
                                    onDismissColumnWarning={handleDismissColumnWarning}
                                    onClearFiltersForHiddenTask={handleClearFiltersForHiddenTask}
                                    onAssignCreatedTaskToSprint={handleAssignCreatedTaskToSprint}
                                    onEditTask={handleEditTask}
                                    onCopyTask={handleCopyTask}
                                    onRemoveTask={handleRemoveTask}
                                    onTagAdd={handleTagAdd}
                                    onTagRemove={handleTagRemove}
                                    onMoveTaskToColumn={handleMoveTaskToColumn}
                                    animateCopiedTaskId={animateCopiedTaskId}
                                    onEditColumn={handleEditColumn}
                                    onRemoveColumn={handleRemoveColumn}
                                    onAddColumn={handleAddColumn}
                                    showColumnDeleteConfirm={showColumnDeleteConfirm}
                                    onConfirmColumnDelete={handleConfirmColumnDelete}
                                    onCancelColumnDelete={handleCancelColumnDelete}
                                    getColumnTaskCount={getColumnTaskCount}
                                    onTaskDragStart={handleTaskDragStart}
                                    onTaskDragEnd={handleTaskDragEnd}
                                    onClearDragState={handleClearDragState}
                                    onTaskDragOver={handleTaskDragOver}
                                    onRefreshBoardData={refreshBoardData}
                                    onSetDragCooldown={handleSetDragCooldown}
                                    onTaskDrop={handleTaskDrop}
                                    onSelectTask={handleSelectTask}
                                    onTaskDropOnBoard={handleTaskDropOnBoard}
                                    isTaskMiniMode={isTaskMiniMode}
                                    onTaskEnterMiniMode={handleTaskEnterMiniMode}
                                    onTaskExitMiniMode={handleTaskExitMiniMode}
                                    
                                    // Task linking props
                                    isLinkingMode={taskLinking.isLinkingMode}
                                    linkingSourceTask={taskLinking.linkingSourceTask}
                                    linkingLine={taskLinking.linkingLine}
                                    onStartLinking={handleStartLinking}
                                    onUpdateLinkingLine={handleUpdateLinkingLine}
                                    onFinishLinking={handleFinishLinking}
                                    onCancelLinking={handleCancelLinking}
                                    
                                    // Hover highlighting props
                                    hoveredLinkTask={taskLinking.hoveredLinkTask}
                                    onLinkToolHover={handleLinkToolHover}
                                    onLinkToolHoverEnd={handleLinkToolHoverEnd}
                                    getTaskRelationshipType={getTaskRelationshipType}
                                    onUnlinkRelatedTask={handleUnlinkRelatedTask}
                                    
                                    // Auto-synced relationships
                                    boardRelationships={taskLinking.boardRelationships}
                                    onTaskRestoredLocally={handleTaskRestoredLocally}
                                    checkedTaskIds={checkedTaskIds}
                                    onToggleTaskChecked={toggleTaskChecked}
                                    onToggleColumnChecked={toggleColumnChecked}
                                    onClearAllChecked={clearAllChecked}
                                    isMultiSelectDragLocked={isMultiSelectDragLocked}
                                    bulkBusy={bulkBusy}
                                    onBulkAddTag={onBulkAddTag}
                                    onBulkCopy={onBulkCopy}
                                    onBulkArchive={onBulkArchive}
                                    onBulkDelete={onBulkDelete}
                                    onBulkPermanentDelete={onBulkPermanentDelete}
                                    onBulkSprint={onBulkSprint}
                                    onBulkPriority={onBulkPriority}
                                    onBulkMoveToBoard={onBulkMoveToBoard}
                                    onBulkAssignee={onBulkAssignee}
                                    onBulkRequester={onBulkRequester}
                                    onBulkAddWatcher={onBulkAddWatcher}
                                    onBulkRemoveWatcher={onBulkRemoveWatcher}
                                    onBulkAddCollaborator={onBulkAddCollaborator}
                                    onBulkRemoveCollaborator={onBulkRemoveCollaborator}
                                    bulkUndoTaskIds={bulkUndo?.taskIds ?? null}
                                    bulkUndoLabelKey={bulkUndo?.labelKey}
                                    bulkUndoAnchorColumnIds={bulkUndo?.anchorColumnIds ?? null}
                                    onBulkUndo={onBulkUndo}
                                    onClearBulkUndo={clearBulkUndo}
                                    draggedTaskIds={draggedTaskIds}
        />
      </div>

      {versionStatus.InstanceStatusBanner()}
      
      {/* Version Update Banner */}
      {versionStatus.showVersionBanner && (
        <VersionUpdateBanner
          currentVersion={versionStatus.versionInfo.currentVersion}
          newVersion={versionStatus.versionInfo.newVersion}
          onRefresh={versionStatus.handleRefreshVersion}
          onDismiss={versionStatus.handleDismissVersionBanner}
        />
      )}

      <Suspense fallback={null}>
        <ModalManager
          selectedTask={selectedTask}
          taskDetailsOptions={taskDetailsOptions}
                                  members={members}
          onTaskClose={() => handleSelectTask(null)}
          onTaskUpdate={handleEditTask}
          onRestoreTask={handleRestoreSelectedTask}
          onPurgeTask={handlePurgeSelectedTask}
          showHelpModal={modalState.showHelpModal}
          helpExpandToken={modalState.helpExpandToken}
          onHelpClose={() => modalState.closeHelpModal()}
          onPageChange={handlePageChange}
          onViewModeChange={handleViewModeChange}
          showProfileModal={modalState.showProfileModal}
          currentUser={currentUser}
          onProfileClose={() => {
            modalState.closeProfileModal();
            modalState.setIsProfileBeingEdited(false); // Reset editing state when modal closes
          }}
          onProfileUpdated={handleProfileUpdated}
          isProfileBeingEdited={modalState.isProfileBeingEdited}
          onProfileEditingChange={modalState.setIsProfileBeingEdited}
          profileInitialFocus={modalState.profileInitialFocus}
          onActivityFeedToggle={activityFeed.handleActivityFeedToggle}
          onAccountDeleted={() => {
            // Account deleted successfully - handle logout and redirect
            handleLogout();
          }}
          siteSettings={siteSettings}
          boards={boards}
          canMutate={canMutate}
        />
      </Suspense>

      {/* Task Delete Confirmation Popup */}
      <TaskDeleteConfirmation
        isOpen={!!taskDeleteConfirmation.confirmationTask}
        task={taskDeleteConfirmation.confirmationTask}
        onConfirm={taskDeleteConfirmation.confirmDelete}
        onCancel={taskDeleteConfirmation.cancelDelete}
        isDeleting={taskDeleteConfirmation.isDeleting}
        permanent={taskDeleteConfirmation.isPermanent}
        position={taskDeleteConfirmation.confirmationPosition}
      />

      <CrossBoardMoveConfirmation
        isOpen={!!crossBoardMovePending}
        relationshipCount={crossBoardMovePending?.relationshipCount ?? 0}
        targetBoardTitle={
          crossBoardMovePending
            ? boards.find(b => b.id === crossBoardMovePending.targetBoardId)?.title
            : undefined
        }
        onConfirm={handleConfirmCrossBoardMove}
        onCancel={handleCancelCrossBoardMove}
        isBusy={crossBoardMoveBusy}
      />

      {boardLimitDialog && (
        <BoardLimitReachedDialog
          info={boardLimitDialog}
          isAdmin={!!currentUser?.roles?.includes('admin')}
          onClose={() => setBoardLimitDialog(null)}
          onOpenLifecycle={() => {
            setBoardLimitDialog(null);
            window.location.hash = '#admin#project-settings#lifecycle';
          }}
        />
      )}

      {showDebug && (
        <DebugPanel
          logs={queryLogs}
          onClear={clearQueryLogs}
        />
      )}

      {/* Enhanced Drag Overlay */}
      <SimpleDragOverlay 
        draggedTask={draggedTask}
        draggedColumn={draggedColumn}
        members={members}
        isHoveringBoardTab={isHoveringBoardTab}
        draggedTaskIds={draggedTaskIds}
      />
      </SimpleDragDropManager>

      {/* Activity Feed */}
      <ActivityFeed
        isVisible={activityFeed.showActivityFeed}
        onClose={() => activityFeed.setShowActivityFeed(false)}
        isMinimized={activityFeed.activityFeedMinimized}
        onMinimizedChange={(minimized) => {
          // User expanded while TaskDetails open → don't force-restore later
          if (!minimized) {
            activityFeedAutoMinForTaskRef.current = false;
          }
          activityFeed.handleActivityFeedMinimizedChange(minimized);
        }}
        activities={activityFeed.activities}
        lastSeenActivityId={activityFeed.lastSeenActivityId}
        clearActivityId={activityFeed.clearActivityId}
        onMarkAsRead={activityFeed.handleActivityFeedMarkAsRead}
        onClearAll={activityFeed.handleActivityFeedClearAll}
        position={activityFeed.activityFeedPosition}
        onPositionChange={activityFeed.setActivityFeedPosition}
        dimensions={activityFeed.activityFeedDimensions}
        onDimensionsChange={activityFeed.setActivityFeedDimensions}
        userId={currentUser?.id || null}
      />

      {shouldShowPerfTests(userPerfTestsEnabled, currentUser) &&
        currentPage === 'kanban' &&
        selectedBoard && (
          <Suspense fallback={null}>
            <PerfTestOverlay
              boardId={selectedBoard}
              columns={columns}
              members={members}
              availablePriorities={availablePriorities}
              visibleColumnIds={
                boardColumnVisibility[selectedBoard] ||
                Object.keys(columns).filter((id) => !Boolean(columns[id]?.is_archived))
              }
              onMoveTask={handleMoveTaskToColumn}
              onRefreshBoard={() => refreshBoardData({ force: true })}
            />
          </Suspense>
        )}

      {shouldShowPerfTests(userPerfTestsEnabled, currentUser) &&
        currentPage === 'admin' && (
          <Suspense fallback={null}>
            <AdminSeedOverlay
              currentUserId={currentUser?.id}
              currentUserEmail={currentUser?.email}
            />
          </Suspense>
        )}

      {/* Task Linking Overlay */}
      <TaskLinkingOverlay
        isLinkingMode={taskLinking.isLinkingMode}
        linkingSourceTask={taskLinking.linkingSourceTask}
        linkingLine={taskLinking.linkingLine}
        onUpdateLinkingLine={handleUpdateLinkingLine}
        onCancelLinking={handleCancelLinking}
      />
      </div>
      
      <AdminLeaveUnsavedDialog
        open={adminLeavePrompt !== null}
        gate={adminDraftGate}
        onStay={handleAdminLeaveStay}
        onLeave={handleAdminLeaveConfirm}
      />

      {/* Toast Notifications */}
      <ToastContainer />
      <OwnerSetupChecklist />
      <TourNudge />

      {/* Debug: Log admin status */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-2 left-2 text-xs bg-black/50 text-white p-1 rounded z-50">
          Admin: {currentUser?.roles?.includes('admin') ? 'Yes' : 'No'} | 
          User: {currentUser?.email || 'Not logged in'}
        </div>
      )}
    </TourProvider>
    </OwnerSetupProvider>
    </ThemeProvider>
  );
}

// Main App component that wraps everything with SettingsProvider
export default function App() {
  // Global error handler for dynamic import failures (version mismatches).
  // Hard-refreshes (cache-bust) up to 3 times per session, then stops.
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (
        !(event.error instanceof TypeError) ||
        !event.error.message?.includes('Failed to fetch dynamically imported module')
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target || !('src' in target)) return;

      const scriptSrc = (target as HTMLScriptElement).src;
      if (!scriptSrc?.includes('/assets/') || scriptSrc.includes('/src/')) return;

      event.preventDefault();
      tryHardRefreshForChunkMismatch('Dynamic import failure (missing asset chunk)');
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (
        !(event.reason instanceof TypeError) ||
        !event.reason.message?.includes('Failed to fetch dynamically imported module')
      ) {
        return;
      }

      const errorMsg = event.reason.message || '';
      if (errorMsg.includes('/src/') || errorMsg.includes('500')) return;

      event.preventDefault();
      tryHardRefreshForChunkMismatch('Unhandled dynamic import rejection (missing chunk)');
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // If the app stays up, allow future deploys to hard-refresh again.
    const clearTimer = window.setTimeout(() => {
      clearChunkMismatchHardRefreshCount();
    }, 30_000);

    return () => {
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.clearTimeout(clearTimer);
    };
  }, []);

  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}
