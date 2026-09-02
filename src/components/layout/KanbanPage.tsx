import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKanbanModifierKeys } from '../../hooks/useKanbanModifierKeys';
import { useAppHeaderStickyTop } from '../../hooks/useAppHeaderStickyTop';
import { 
  CurrentUser, 
  TeamMember, 
  Board, 
  Task, 
  Columns, 
  PriorityOption,
  Tag,
  ColumnVisibilityWarning
} from '../../types';
import { TaskViewMode, ViewMode, loadUserPreferences, loadUserPreferencesAsync, updateAppSettingsPreference } from '../../utils/userPreferences';
import { hasConfiguredSearchFilters, hasNonLinkSearchFilters, clearTaskSoftDelete, boardMatchesSelectedProjects } from '../../utils/taskUtils';
import {
  allTasksCheckedInColumn,
  checkedIdsInColumn,
  type ToggleTaskCheckedOptions,
} from '../../utils/kanbanMultiSelect';
import { buildTaskRelationshipSummaryMap } from '../../utils/taskRelationshipSummary';
import { ModernCheckbox } from '../ModernCheckbox';
import TeamMembers from '../TeamMembers';
import Tools, { ToolsHeaderControls } from '../Tools';
import BoardMetrics from '../BoardMetrics';
import SearchInterface from '../SearchInterface';
import KanbanColumn from '../Column';
import TaskCard from '../TaskCard';
import BoardTabs from '../BoardTabs';
import BoardTrashView from '../BoardTrashView';
import BoardTrashCollapse from '../BoardTrashCollapse';
import LoadingSpinner from '../LoadingSpinner';
import ListView from '../ListView';
import ColumnResizeHandle from '../ColumnResizeHandle';
import {
  getBoardTrash,
  getBoardTrashCount,
  getTaskById,
  restoreTask,
  purgeTask,
  purgeTasksBatch,
} from '../../api';
import { toast } from '../../utils/toast';
import websocketClient from '../../services/websocketClient';
import {
  BOARD_TRASH_CHANGED_EVENT,
  CLOSE_BOARD_TRASH_EVENT,
  OPEN_BOARD_TRASH_EVENT,
  type BoardTrashChangedDetail,
  type CloseBoardTrashDetail,
  type OpenBoardTrashDetail,
  readBoardTrashOpenPreference,
  writeBoardTrashOpenPreference,
} from '../../utils/boardTrashEvents';
import { getTaskSprintId, taskMatchesSelectedSprint } from '../../utils/columnFilters';
import { isArchivedColumnFlag } from '../../utils/columnUtils';
import { isKanbanPageScrolledDown, scrollKanbanPageToTopFastSmooth } from '../../utils/kanbanScroll';
import { onHelpReveal, takeHelpReveal } from '../../utils/helpGoThere';

import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Lazy load GanttViewV2 / CalendarView to reduce initial bundle size
const GanttViewV2 = lazyWithRetry(() => import('../GanttViewV2'));
const CalendarView = lazyWithRetry(() => import('../CalendarView'));

interface KanbanPageProps {
  currentUser: CurrentUser | null;
  selectedTask: Task | null;
  loading: {
    general: boolean;
    tasks: boolean;
    boards: boolean;
    columns: boolean;
  };
  members: TeamMember[];
  boards: Board[];
  selectedBoard: string | null;
  columns: Columns;
  selectedMembers: string[];
  draggedTask: Task | null;
  draggedColumn: any;
  dragPreview: any;
  availablePriorities: PriorityOption[];
  availableTags: Tag[];
  availableSprints?: any[]; // Optional for backward compatibility
  taskViewMode: TaskViewMode;
  viewMode: ViewMode;
  isSearchActive: boolean;
  searchFilters: any;
  filteredColumns: Columns;
  activeFilters: boolean;
  gridStyle: React.CSSProperties;
  sensors: any;
  collisionDetection: any;
  siteSettings: { [key: string]: string };
  /** false for viewer (read-only) role — hide create/edit/DnD affordances */
  canMutate?: boolean;
  
  // Column filtering props
  boardColumnVisibility: {[boardId: string]: string[]};
  onBoardColumnVisibilityChange: (boardId: string, visibleColumns: string[]) => void;
  onBoardColumnVisibilityReset: (boardId: string) => void;

  
  // Event handlers
  onSelectMember: (memberId: string) => void;
  onClearMemberSelections: () => void;
  onSelectAllMembers: () => void;
  isAllModeActive: boolean;
  includeAssignees: boolean;
  includeWatchers: boolean;
  includeCollaborators: boolean;
  includeRequesters: boolean;
  includeSystem: boolean;
  onToggleAssignees: (include: boolean) => void;
  onToggleWatchers: (include: boolean) => void;
  onToggleCollaborators: (include: boolean) => void;
  onToggleRequesters: (include: boolean) => void;
  onToggleSystem: (include: boolean) => void;
  onEditOwnProfile?: (opts?: { focus?: 'displayName' | 'bio' }) => void;
  showAgentTasks?: boolean;
  onToggleShowAgentTasks?: (show: boolean) => void;
  onTaskViewModeChange: (mode: TaskViewMode) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleSearch: () => void;
  onSearchFiltersChange: (filters: any, options?: { preserveFilterView?: boolean }) => void;
  onApplySavedFilter?: (view: any) => Promise<any>;
  onUpdateSavedFilter?: (viewId: number, filters: any) => Promise<any>;
  onClearAllSearchFilters?: () => Promise<void>;
  currentFilterView?: any; // SavedFilterView | null
  sharedFilterViews?: any[]; // SavedFilterView[]
  onFilterViewChange?: (view: any) => void; // (view: SavedFilterView | null) => void
  onSelectBoard: (boardId: string) => void;
  onAddBoard: () => Promise<void>;
  onEditBoard: (boardId: string, title: string, wipLimit?: number | null) => Promise<void>;
  onRemoveBoard: (boardId: string) => Promise<void>;
  onReorderBoards: (boardId: string, newPosition: number) => Promise<void>;
  getTaskCountForBoard: (board: Board) => number;
  /** Active-work WIP count (excludes finished/archived columns). */
  getBoardWipTaskCountForBoard?: (board: Board) => number;
  /** Filtered active-work effort for board tab pills (hidden when 0). */
  getBoardWipEffortForBoard?: (board: Board) => number;
  /** Unfiltered board task total, used for destructive confirmations. */
  getTotalTaskCountForBoard?: (board: Board) => number;
  onDragStart: (event: any) => void;
  onDragOver: (event: any) => void;
  onDragEnd: (event: any) => void;
  onAddTask: (columnId: string) => Promise<void>;
  columnWarnings: Record<string, ColumnVisibilityWarning>;
  onDismissColumnWarning: (columnId: string) => void;
  onClearFiltersForHiddenTask?: () => void;
  onAssignCreatedTaskToSprint?: (columnId: string, taskId: string, sprintId: string) => Promise<void>;
  onRemoveTask: (taskId: string, event?: React.MouseEvent) => Promise<void>;
  onEditTask: (task: Task) => Promise<void>;
  onCopyTask: (task: Task) => Promise<void>;
  onTagAdd: (taskId: string) => (tagId: string) => Promise<void>;
  onTagRemove: (taskId: string) => (tagId: string) => Promise<void>;
  onMoveTaskToColumn: (taskId: string, targetColumnId: string) => Promise<void>;
  onGanttReorderTask?: (taskId: string, columnId: string, targetIndex: number) => Promise<void>;
  animateCopiedTaskId?: string | null;
  /** Brief highlight after create-at-top (kanban). */
  highlightedNewTaskId?: string | null;
  onEditColumn: (
    columnId: string,
    title: string,
    is_finished?: boolean,
    is_archived?: boolean,
    wip_limit?: number | null,
    policy_text?: string | null
  ) => Promise<void>;
  onRemoveColumn: (columnId: string) => Promise<void>;
  onAddColumn: (afterColumnId: string) => Promise<void>;
  showColumnDeleteConfirm?: string | null;
  onConfirmColumnDelete?: (columnId: string) => Promise<void>;
  onCancelColumnDelete?: () => void;
  getColumnTaskCount?: (columnId: string) => number;
  onTaskDragStart: (task: Task) => void;
  onTaskDragEnd: () => void;
  onClearDragState: () => void;
  onTaskDragOver: (e: React.DragEvent) => void;
  onRefreshBoardData: () => Promise<void>;
  onSetDragCooldown: (active: boolean, duration?: number) => void;
  onTaskDrop: () => Promise<void>;
  onSelectTask: (task: Task | null, options?: { scrollToComments?: boolean }) => void;
  onTaskDropOnBoard?: (taskId: string, targetBoardId: string) => Promise<void>;
  
  // Task linking props
  isLinkingMode?: boolean;
  linkingSourceTask?: Task | null;
  linkingLine?: {startX: number, startY: number, endX: number, endY: number} | null;
  onStartLinking?: (
    task: Task,
    startPosition: { x: number; y: number },
    options?: { shiftKey?: boolean }
  ) => void;
  onUpdateLinkingLine?: (endPosition: {x: number, y: number}) => void;
  onFinishLinking?: (targetTask: Task | null, relationshipType?: 'parent' | 'child' | 'related') => Promise<void>;
  onCancelLinking?: () => void;
  
  // Hover highlighting props
  hoveredLinkTask?: Task | null;
  onLinkToolHover?: (task: Task) => void;
  onLinkToolHoverEnd?: () => void;
  getTaskRelationshipType?: (taskId: string) => 'parent' | 'child' | 'related' | null;
  /** Shift+click a highlighted related card to remove the link */
  onUnlinkRelatedTask?: (targetTask: Task) => void | Promise<void>;
  
  // Auto-synced relationships
  boardRelationships?: any[];
  
  // Network status
  isOnline?: boolean;
  
  // Sprint filtering
  selectedSprintId?: string | null;
  
  // Column resizing
  kanbanColumnWidth?: number;
  onColumnWidthResize?: (deltaX: number) => void;

  /** Called after a successful restore with the restored task payload for optimistic insert. */
  onTaskRestoredLocally?: (task: Task) => void;

  // Kanban multi-select / bulk actions
  checkedTaskIds?: Set<string>;
  onReplaceCheckedTaskIds?: (taskIds: string[]) => void;
  onToggleTaskChecked?: (taskId: string, options?: ToggleTaskCheckedOptions) => void;
  onToggleColumnChecked?: (columnId: string, taskIds: string[], selectAll: boolean) => void;
  onClearAllChecked?: () => void;
  isMultiSelectDragLocked?: boolean;
  bulkBusy?: boolean;
  onBulkAddTag?: (taskIds: string[], tagId: string) => void;
  onBulkCopy?: (taskIds: string[]) => void;
  onBulkArchive?: (taskIds: string[]) => void;
  onBulkDelete?: (taskIds: string[]) => void;
  onBulkPermanentDelete?: (taskIds: string[]) => void;
  onBulkSprint?: (taskIds: string[], sprintId: string | null) => void;
  onBulkPriority?: (taskIds: string[], priorityId: string) => void;
  onBulkMoveToBoard?: (taskIds: string[], boardId: string) => void;
  onBulkAssignee?: (taskIds: string[], memberId: string | null) => void;
  onBulkRequester?: (taskIds: string[], memberId: string | null) => void;
  onBulkAddWatcher?: (taskIds: string[], memberId: string) => void;
  onBulkRemoveWatcher?: (taskIds: string[], memberId: string) => void;
  onBulkAddCollaborator?: (taskIds: string[], memberId: string) => void;
  onBulkRemoveCollaborator?: (taskIds: string[], memberId: string) => void;
  bulkUndoTaskIds?: string[] | null;
  bulkUndoLabelKey?: string;
  bulkUndoAnchorColumnIds?: string[] | null;
  onBulkUndo?: () => void;
  onClearBulkUndo?: () => void;
  draggedTaskIds?: string[];
}

const KanbanPage: React.FC<KanbanPageProps> = ({
  currentUser,
  selectedTask,
  loading,
  members,
  boards,
  selectedBoard,
  columns,
  selectedMembers,
  draggedTask,
  draggedColumn,
  dragPreview,
  availablePriorities,
  availableTags,
  taskViewMode,
  isSearchActive,
  searchFilters,
  filteredColumns,
  activeFilters,
  gridStyle,
  sensors,
  collisionDetection,
  canMutate = true,
  onSelectMember,
  onClearMemberSelections,
  onSelectAllMembers,
  isAllModeActive,
  kanbanColumnWidth,
  onColumnWidthResize,
  includeAssignees,
  includeWatchers,
  includeCollaborators,
  includeRequesters,
  includeSystem,
  onToggleAssignees,
  onToggleWatchers,
  onToggleCollaborators,
  onToggleRequesters,
  onToggleSystem,
  onEditOwnProfile,
  showAgentTasks = true,
  onToggleShowAgentTasks,
  onTaskViewModeChange,
  viewMode,
  onViewModeChange,
  onToggleSearch,
  onSearchFiltersChange,
  onApplySavedFilter,
  onUpdateSavedFilter,
  onClearAllSearchFilters,
  currentFilterView,
  sharedFilterViews,
  onFilterViewChange,
  onSelectBoard,
  onAddBoard,
  onEditBoard,
  onRemoveBoard,
  onReorderBoards,
  getTaskCountForBoard,
  getBoardWipTaskCountForBoard,
  getBoardWipEffortForBoard,
  getTotalTaskCountForBoard,
  onDragStart,
  onDragOver,
  onDragEnd,
  onAddTask,
  columnWarnings,
  onDismissColumnWarning,
  onClearFiltersForHiddenTask,
  onAssignCreatedTaskToSprint,
  onRemoveTask,
  onEditTask,
  onCopyTask,
  onTagAdd,
  onTagRemove,
  onMoveTaskToColumn,
  onGanttReorderTask,
  animateCopiedTaskId,
  highlightedNewTaskId,
  onEditColumn,
  onRemoveColumn,
  onAddColumn,
  showColumnDeleteConfirm,
  onConfirmColumnDelete,
  onCancelColumnDelete,
  getColumnTaskCount,
  onTaskDragStart,
  onTaskDragEnd,
  onClearDragState,
  onTaskDragOver,
  onRefreshBoardData,
  onSetDragCooldown,
  onTaskDrop,
  onSelectTask,
  onTaskDropOnBoard,
  siteSettings,
  boardColumnVisibility,
  onBoardColumnVisibilityChange,
  onBoardColumnVisibilityReset,
  
  // Task linking props
  isLinkingMode,
  linkingSourceTask,
  linkingLine,
  onStartLinking,
  onUpdateLinkingLine,
  onFinishLinking,
  onCancelLinking,
  
  // Hover highlighting props
  hoveredLinkTask,
  onLinkToolHover,
  onLinkToolHoverEnd,
  getTaskRelationshipType,
  onUnlinkRelatedTask,
  
  // Auto-synced relationships
  boardRelationships = [],
  
  // Network status
  isOnline = true, // Default to true if not provided
  
  // Sprint filtering
  selectedSprintId = null,
  availableSprints = [],
  onTaskRestoredLocally,
  checkedTaskIds,
  onReplaceCheckedTaskIds,
  onToggleTaskChecked,
  onToggleColumnChecked,
  onClearAllChecked,
  isMultiSelectDragLocked = false,
  bulkBusy = false,
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
  bulkUndoTaskIds = null,
  bulkUndoLabelKey,
  bulkUndoAnchorColumnIds = null,
  onBulkUndo,
  onClearBulkUndo,
  draggedTaskIds,
}: KanbanPageProps) => {
  const { t, i18n } = useTranslation(['tasks', 'common']);
  useKanbanModifierKeys();
  const [showBoardToolbar, setShowBoardToolbar] = useState(() => {
    const prefs = loadUserPreferences(currentUser?.id ?? null);
    return prefs.appSettings.showBoardToolbar !== false;
  });
  const [trashOpen, setTrashOpen] = useState(() =>
    readBoardTrashOpenPreference(selectedBoard)
  );
  const [trashCount, setTrashCount] = useState(0);
  const [trashTasks, setTrashTasks] = useState<Task[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const isAdmin = !!currentUser?.roles?.includes('admin');

  const setTrashOpenPersisted = useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      setTrashOpen((prev) => {
        const next = typeof open === 'function' ? open(prev) : open;
        writeBoardTrashOpenPreference(selectedBoard, next);
        return next;
      });
    },
    [selectedBoard]
  );

  const trashCountRequestRef = useRef(0);
  const trashTasksRef = useRef(trashTasks);
  trashTasksRef.current = trashTasks;

  const normalizeTrashTasks = useCallback((tasks: Task[]): Task[] => {
    return tasks.map((task) => ({
      ...task,
      sprintId: getTaskSprintId(task),
    }));
  }, []);

  const countTrashForSprint = useCallback(
    (tasks: Task[]) =>
      tasks.filter((task) => taskMatchesSelectedSprint(task, selectedSprintId)).length,
    [selectedSprintId]
  );

  const refreshTrashCount = useCallback(async (boardId: string | null) => {
    if (!boardId) {
      setTrashCount(0);
      return;
    }
    const requestId = ++trashCountRequestRef.current;
    try {
      // When a sprint is selected, badge must match sprint-filtered trash (needs task list).
      if (selectedSprintId !== null) {
        const tasks = normalizeTrashTasks(await getBoardTrash(boardId));
        if (requestId !== trashCountRequestRef.current) return;
        setTrashTasks(tasks);
        setTrashCount(countTrashForSprint(tasks));
        // Close only when the board has no trash at all (not merely none for this sprint).
        if (tasks.length === 0) {
          setTrashOpen(false);
          writeBoardTrashOpenPreference(boardId, false);
        }
        return;
      }

      const count = await getBoardTrashCount(boardId);
      if (requestId !== trashCountRequestRef.current) return;
      setTrashCount(count);
      if (count === 0) {
        setTrashOpen(false);
        writeBoardTrashOpenPreference(boardId, false);
        setTrashTasks([]);
      }
    } catch {
      // ignore — trash badge is best-effort
    }
  }, [selectedSprintId, normalizeTrashTasks, countTrashForSprint]);

  /**
   * `silent` keeps the panel mounted while refetching — the loading placeholder
   * would otherwise collapse the Trash grid and shift the whole board.
   */
  const loadTrashTasks = useCallback(
    async (boardId: string | null, options?: { silent?: boolean }) => {
      if (!boardId) {
        setTrashTasks([]);
        return;
      }
      if (!options?.silent) setTrashLoading(true);
      try {
        const tasks = normalizeTrashTasks(await getBoardTrash(boardId));
        setTrashTasks(tasks);
        setTrashCount(countTrashForSprint(tasks));
        if (tasks.length === 0) {
          setTrashOpen(false);
          writeBoardTrashOpenPreference(boardId, false);
        }
      } catch (error) {
        console.error('Failed to load trash:', error);
        toast.error(i18n.t('trash.loadFailed', { ns: 'tasks' }));
      } finally {
        if (!options?.silent) setTrashLoading(false);
      }
    },
    [i18n, normalizeTrashTasks, countTrashForSprint]
  );

  useEffect(() => {
    setTrashTasks([]);
    // Clear immediately so the previous board's badge does not flash on the new board.
    setTrashCount(0);
    const shouldOpen = readBoardTrashOpenPreference(selectedBoard);
    setTrashOpen(shouldOpen);
    void refreshTrashCount(selectedBoard);
  }, [selectedBoard, refreshTrashCount]);

  useEffect(() => {
    const onCloseTrash = (event: Event) => {
      const boardId = (event as CustomEvent<CloseBoardTrashDetail>).detail?.boardId;
      if (!boardId || boardId !== selectedBoard) return;
      setTrashOpen(false);
    };
    const onOpenTrash = (event: Event) => {
      const boardId = (event as CustomEvent<OpenBoardTrashDetail>).detail?.boardId;
      if (!boardId || boardId !== selectedBoard) return;
      setTrashOpen(true);
    };
    window.addEventListener(CLOSE_BOARD_TRASH_EVENT, onCloseTrash);
    window.addEventListener(OPEN_BOARD_TRASH_EVENT, onOpenTrash);
    return () => {
      window.removeEventListener(CLOSE_BOARD_TRASH_EVENT, onCloseTrash);
      window.removeEventListener(OPEN_BOARD_TRASH_EVENT, onOpenTrash);
    };
  }, [selectedBoard]);

  // Recompute badge when sprint filter changes (trash list may already be loaded).
  useEffect(() => {
    if (!selectedBoard) return;
    if (trashTasks.length > 0) {
      setTrashCount(countTrashForSprint(trashTasks));
      return;
    }
    void refreshTrashCount(selectedBoard);
  }, [selectedSprintId]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to sprint changes

  useEffect(() => {
    if (trashOpen && selectedBoard) {
      void loadTrashTasks(selectedBoard, {
        silent: trashTasksRef.current.length > 0,
      });
    }
    // Intentionally omit loadTrashTasks: it used to change with `t` on EN↔FR
    // and flashed the trash loading placeholder.
  }, [trashOpen, selectedBoard]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch trash while closed so opening does not swap in a loading shell.
  useEffect(() => {
    if (!selectedBoard || trashOpen || trashCount <= 0 || trashTasks.length > 0) return;
    void loadTrashTasks(selectedBoard, { silent: true });
  }, [selectedBoard, trashOpen, trashCount, trashTasks.length, loadTrashTasks]);

  // Keep trash count/list in sync with soft-delete / restore / purge events
  useEffect(() => {
    const syncTrashForBoard = (boardId: string | undefined) => {
      if (!boardId || boardId !== selectedBoard) return;
      if (trashOpen) {
        void loadTrashTasks(selectedBoard, { silent: true });
      } else {
        void refreshTrashCount(selectedBoard);
      }
    };
    const onDeleted = (data: any) => {
      syncTrashForBoard(data?.boardId);
    };
    const onRestoredOrPurged = (data: any) => {
      syncTrashForBoard(data?.boardId);
    };
    const onLocalTrashChanged = (event: Event) => {
      const boardId = (event as CustomEvent<BoardTrashChangedDetail>).detail?.boardId;
      syncTrashForBoard(boardId);
    };
    websocketClient.onTaskDeleted(onDeleted);
    websocketClient.onTaskRestored(onRestoredOrPurged);
    websocketClient.onTaskPurged(onRestoredOrPurged);
    window.addEventListener(BOARD_TRASH_CHANGED_EVENT, onLocalTrashChanged);
    return () => {
      websocketClient.offTaskDeleted(onDeleted);
      websocketClient.offTaskRestored(onRestoredOrPurged);
      websocketClient.offTaskPurged(onRestoredOrPurged);
      window.removeEventListener(BOARD_TRASH_CHANGED_EVENT, onLocalTrashChanged);
    };
  }, [selectedBoard, trashOpen, loadTrashTasks, refreshTrashCount]);

  const handleToggleTrash = useCallback(() => {
    setTrashOpenPersisted((prev) => !prev);
  }, [setTrashOpenPersisted]);

  const handleSelectBoardWithTrashExit = useCallback(
    (boardId: string) => {
      // Each board restores its own trash-open preference in the selectedBoard effect
      onSelectBoard(boardId);
    },
    [onSelectBoard]
  );

  /** Boards visible on the tab bar when a project filter is active. */
  const tabBoards = useMemo(() => {
    const selected = searchFilters.selectedProjectIds;
    if (!selected.length) return boards;
    return boards.filter((board) => boardMatchesSelectedProjects(board, selected));
  }, [boards, searchFilters.selectedProjectIds]);

  useEffect(() => {
    const selected = searchFilters.selectedProjectIds;
    if (!selected.length || !selectedBoard) return;
    if (!tabBoards.some((board) => board.id === selectedBoard)) {
      const next = tabBoards[0]?.id;
      if (next) handleSelectBoardWithTrashExit(next);
    }
  }, [searchFilters.selectedProjectIds, tabBoards, selectedBoard, handleSelectBoardWithTrashExit]);

  const handleRestoreTrashTask = useCallback(
    async (taskId: string) => {
      try {
        const restored = await restoreTask(taskId);
        const normalized = clearTaskSoftDelete({
          ...restored,
          columnId: restored.columnId || (restored as any).columnid,
          boardId: restored.boardId || (restored as any).boardid,
          memberId: restored.memberId || (restored as any).memberid,
          requesterId: restored.requesterId || (restored as any).requesterid,
        } as Task);
        onTaskRestoredLocally?.(normalized);
        if (selectedTask?.id === taskId) {
          onSelectTask(normalized);
        }
        const ticket = normalized.ticket;
        toast.success(
          ticket
            ? t('trash.restored', { ticket })
            : t('trash.restoredNoTicket')
        );
        setTrashTasks((prev) => {
          const next = prev.filter((task) => task.id !== taskId);
          if (next.length === 0) {
            setTrashOpen(false);
            writeBoardTrashOpenPreference(selectedBoard, false);
            setTrashCount(0);
          } else {
            setTrashCount(countTrashForSprint(next));
          }
          return next;
        });
      } catch (error: any) {
        const code = error?.response?.data?.code;
        if (code === 'board_soft_deleted') {
          toast.error(t('trash.restoreBoardFirst'));
        } else {
          toast.error(error?.response?.data?.error || t('trash.restoreFailed'));
        }
        throw error;
      }
    },
    [onTaskRestoredLocally, onSelectTask, selectedTask?.id, t, selectedBoard, countTrashForSprint]
  );

  const handlePurgeTrashTask = useCallback(
    async (taskId: string) => {
      try {
        await purgeTask(taskId);
        toast.success(t('trash.purged'));
        setTrashTasks((prev) => {
          const next = prev.filter((task) => task.id !== taskId);
          if (next.length === 0) {
            setTrashOpen(false);
            writeBoardTrashOpenPreference(selectedBoard, false);
            setTrashCount(0);
          } else {
            setTrashCount(countTrashForSprint(next));
          }
          return next;
        });
        if (selectedTask?.id === taskId) {
          onSelectTask(null);
        }
      } catch (error: any) {
        toast.error(error?.response?.data?.error || t('trash.purgeFailed'));
        throw error;
      }
    },
    [selectedTask?.id, onSelectTask, t, selectedBoard, countTrashForSprint]
  );

  const removeTasksFromTrashList = useCallback(
    (removedIds: string[], options?: { clearSelectedIfRemoved?: boolean }) => {
      if (removedIds.length === 0) return;
      const removed = new Set(removedIds);
      const clearSelectedIfRemoved = options?.clearSelectedIfRemoved ?? false;
      setTrashTasks((prev) => {
        const next = prev.filter((task) => !removed.has(task.id));
        if (next.length === 0) {
          setTrashOpen(false);
          writeBoardTrashOpenPreference(selectedBoard, false);
          setTrashCount(0);
        } else {
          setTrashCount(countTrashForSprint(next));
        }
        return next;
      });
      if (
        clearSelectedIfRemoved &&
        selectedTask?.id &&
        removed.has(selectedTask.id)
      ) {
        onSelectTask(null);
      }
    },
    [selectedBoard, selectedTask?.id, onSelectTask, countTrashForSprint]
  );

  const handleRestoreTrashSelected = useCallback(
    async (taskIds: string[]) => {
      if (taskIds.length === 0) return;
      let restoredCount = 0;
      let failedCount = 0;
      let sawBoardSoftDeleted = false;
      const restoredIds: string[] = [];

      for (const taskId of taskIds) {
        try {
          const restored = await restoreTask(taskId);
          const normalized = clearTaskSoftDelete({
            ...restored,
            columnId: restored.columnId || (restored as any).columnid,
            boardId: restored.boardId || (restored as any).boardid,
            memberId: restored.memberId || (restored as any).memberid,
            requesterId: restored.requesterId || (restored as any).requesterid,
          } as Task);
          onTaskRestoredLocally?.(normalized);
          if (selectedTask?.id === taskId) {
            onSelectTask(normalized);
          }
          restoredIds.push(taskId);
          restoredCount += 1;
        } catch (error: any) {
          failedCount += 1;
          if (error?.response?.data?.code === 'board_soft_deleted') {
            sawBoardSoftDeleted = true;
          }
        }
      }

      removeTasksFromTrashList(restoredIds);

      if (restoredCount > 0 && failedCount === 0) {
        toast.success(t('trash.restoredCount', { count: restoredCount }));
      } else if (restoredCount > 0 && failedCount > 0) {
        toast.error(
          t('trash.restorePartialFailed', {
            restored: restoredCount,
            failed: failedCount,
          })
        );
      } else if (sawBoardSoftDeleted) {
        toast.error(t('trash.restoreBoardFirst'));
      } else {
        toast.error(t('trash.restoreFailed'));
      }
    },
    [
      onTaskRestoredLocally,
      onSelectTask,
      selectedTask?.id,
      removeTasksFromTrashList,
      t,
    ]
  );

  const handlePurgeTrashSelected = useCallback(
    async (taskIds: string[]) => {
      if (taskIds.length === 0) return;
      try {
        const result = await purgeTasksBatch(taskIds);
        const purged = Array.isArray(result?.purged) ? result.purged : [];
        const purgedCount = purged.length;
        const failedCount = Math.max(0, taskIds.length - purgedCount);
        removeTasksFromTrashList(purged, { clearSelectedIfRemoved: true });
        if (purgedCount > 0 && failedCount === 0) {
          toast.success(t('trash.purgedCount', { count: purgedCount }));
        } else if (purgedCount > 0 && failedCount > 0) {
          toast.error(
            t('trash.purgePartialFailed', {
              purged: purgedCount,
              failed: failedCount,
            })
          );
        } else {
          toast.error(t('trash.purgeFailed'));
        }
      } catch (error: any) {
        toast.error(error?.response?.data?.error || t('trash.purgeFailed'));
        throw error;
      }
    },
    [removeTasksFromTrashList, t]
  );

  const handleSelectTrashedTask = useCallback(
    async (task: Task) => {
      // Same as live board: click again closes TaskDetails
      if (selectedTask?.id === task.id) {
        onSelectTask(null);
        return;
      }
      try {
        const full = await getTaskById(task.id);
        const normalized: Task = {
          ...full,
          deletedAt: full.deletedAt || (full as any).deleted_at || task.deletedAt || null,
          deletedBy: full.deletedBy || (full as any).deleted_by || task.deletedBy || null,
          deletedBy: full.deletedBy || (full as any).deleted_by || task.deletedBy || null,
          columnId: full.columnId || (full as any).columnid,
          boardId: full.boardId || (full as any).boardid,
          memberId: full.memberId || (full as any).memberid,
          requesterId: full.requesterId || (full as any).requesterid,
        };
        onSelectTask(normalized);
      } catch {
        onSelectTask({
          ...task,
          deletedAt: task.deletedAt || null,
        });
      }
    },
    [onSelectTask, selectedTask?.id]
  );
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!currentUser?.id) return;
      try {
        const prefs = await loadUserPreferencesAsync(currentUser.id);
        if (!cancelled) {
          setShowBoardToolbar(prefs.appSettings.showBoardToolbar !== false);
        }
      } catch {
        // Keep cookie / default
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const handleToggleBoardToolbar = async () => {
    const next = !showBoardToolbar;
    setShowBoardToolbar(next);
    try {
      await updateAppSettingsPreference('showBoardToolbar', next, currentUser?.id ?? null);
    } catch (error) {
      console.error('Failed to save board toolbar preference:', error);
    }
  };

  useEffect(() => {
    const applyHelpReveal = () => {
      if (takeHelpReveal('boardToolbar')) {
        setShowBoardToolbar(true);
        void updateAppSettingsPreference('showBoardToolbar', true, currentUser?.id ?? null);
      }
      if (takeHelpReveal('trash')) {
        setTrashOpenPersisted(true);
      }
    };
    applyHelpReveal();
    return onHelpReveal(applyHelpReveal);
  }, [currentUser?.id, setTrashOpenPersisted]);

  const relationSummaryByTaskId = useMemo(
    () => buildTaskRelationshipSummaryMap(boardRelationships),
    [boardRelationships]
  );
  const hasBoardRelationships = boardRelationships.length > 0;

  // Column filtering logic - memoized to prevent unnecessary re-renders
  const visibleColumnsForCurrentBoard = useMemo(() => {
    if (!selectedBoard) return [];
    // If there's saved visibility preference, use it
    if (boardColumnVisibility[selectedBoard]) {
      return boardColumnVisibility[selectedBoard];
    }
    // Otherwise, default to all columns EXCEPT archived ones
    return Object.keys(columns).filter(columnId => {
      const column = columns[columnId];
      // Hide archived columns by default (is_archived can be boolean true or number 1)
      return !(column.is_archived === true || column.is_archived === 1);
    });
  }, [selectedBoard, columns, boardColumnVisibility]);

  const activeFilterTooltip = useMemo(() => {
    const hasSearchCriteria = hasNonLinkSearchFilters(searchFilters);

    let hasHiddenColumns = false;
    const allColumns = Object.values(columns);
    if (allColumns.length > 0 && visibleColumnsForCurrentBoard.length > 0) {
      const isArchived = (col: { is_archived?: boolean | number }) =>
        col.is_archived === true || col.is_archived === 1;
      const nonArchived = allColumns.filter((col) => !isArchived(col));
      const visibleNonArchived = visibleColumnsForCurrentBoard.filter((colId) => {
        const col = columns[colId];
        return col && !isArchived(col);
      });
      hasHiddenColumns =
        visibleNonArchived.length > 0 &&
        visibleNonArchived.length < nonArchived.length;
    }

    const agentHidden =
      siteSettings?.AI_ENABLED === 'true' && !showAgentTasks;

    const linkedTasksOnly = !!searchFilters.linkedTasksOnly;

    // Member selection + role chips live in Team Members — do not badge Search for them.
    const badgeActive =
      hasSearchCriteria ||
      hasHiddenColumns ||
      agentHidden ||
      linkedTasksOnly;

    if (!badgeActive) return '';

    const reasons: string[] = [];
    if (hasSearchCriteria) {
      reasons.push(t('tools.filterReasonSearch', { ns: 'common' }));
    }
    if (hasHiddenColumns) {
      reasons.push(t('tools.filterReasonColumns', { ns: 'common' }));
    }
    if (agentHidden) {
      reasons.push(t('tools.filterReasonAgentHidden', { ns: 'common' }));
    }
    if (linkedTasksOnly) {
      reasons.push(t('tools.filterReasonLinkedTasks', { ns: 'common' }));
    }

    if (reasons.length === 0) {
      return t('tools.filtersActiveHeading', { ns: 'common' });
    }
    return `${t('tools.filtersActiveHeading', { ns: 'common' })}\n• ${reasons.join('\n• ')}`;
  }, [
    searchFilters,
    columns,
    visibleColumnsForCurrentBoard,
    siteSettings?.AI_ENABLED,
    showAgentTasks,
    t,
  ]);

  const showSearchFilterBadge = !!activeFilterTooltip;

  const getVisibleColumns = (boardId: string | null) => {
    if (boardId === selectedBoard) {
      return visibleColumnsForCurrentBoard;
    }
    // For other boards (shouldn't happen in normal flow)
    if (!boardId) return [];
    if (boardColumnVisibility[boardId]) {
      return boardColumnVisibility[boardId];
    }
    return Object.keys(columns).filter(columnId => {
      const column = columns[columnId];
      return !(column.is_archived === true || column.is_archived === 1);
    });
  };

  const pendingArchiveScrollRef = useRef<
    | { kind: 'show'; columnId: string; restoreLeft: number }
    | { kind: 'hide' }
    | null
  >(null);
  const archiveScrollRestoreRef = useRef<number | null>(null);
  const columnsContainerRef = useRef<HTMLDivElement>(null);

  const handleColumnVisibilityChange = (boardId: string, visibleColumns: string[]) => {
    if (viewMode === 'kanban') {
      const prev = visibleColumnsForCurrentBoard;
      const addedArchive = visibleColumns.filter(
        (id) => !prev.includes(id) && isArchivedColumnFlag(columns[id])
      );
      const removedArchive = prev.filter(
        (id) => !visibleColumns.includes(id) && isArchivedColumnFlag(columns[id])
      );
      if (addedArchive.length > 0) {
        const lastAdded = [...addedArchive].sort(
          (a, b) => (columns[a]?.position || 0) - (columns[b]?.position || 0)
        )[addedArchive.length - 1];
        pendingArchiveScrollRef.current = {
          kind: 'show',
          columnId: lastAdded,
          restoreLeft: columnsContainerRef.current?.scrollLeft ?? 0,
        };
      } else if (removedArchive.length > 0) {
        pendingArchiveScrollRef.current = { kind: 'hide' };
      }
    }
    onBoardColumnVisibilityChange(boardId, visibleColumns);
  };

  // Get filtered columns based on visibility (respecting user's column filter choices)
  const getFilteredColumnsForDisplay = useMemo(() => {
    const filtered: Columns = {};
    
    visibleColumnsForCurrentBoard.forEach(columnId => {
      if (columns[columnId]) {
        filtered[columnId] = columns[columnId];
      }
    });
    
    return filtered;
  }, [visibleColumnsForCurrentBoard, columns]);

  // Get fully filtered columns (search filters + column visibility)
  const getFullyFilteredColumns = useMemo(() => {
    const visibleColumnIds = getVisibleColumns(selectedBoard);
    const fullyFiltered: Columns = {};
    
    
    visibleColumnIds.forEach(columnId => {
      if (filteredColumns[columnId]) {
        fullyFiltered[columnId] = filteredColumns[columnId];
      }
    });
    
    
    return fullyFiltered;
  }, [filteredColumns, selectedBoard, boardColumnVisibility]);

  // Count tasks assigned to system user across ALL boards
  const getSystemTaskCount = useMemo(() => {
    const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001';
    let count = 0;
    
    // Count system tasks across all boards (not just the selected one)
    boards.forEach(board => {
      if (board.columns) {
        Object.values(board.columns).forEach((column: any) => {
          if (column.tasks) {
            count += column.tasks.filter((task: any) => task.memberId === SYSTEM_MEMBER_ID).length;
          }
        });
      }
    });
    
    return count;
  }, [boards]);

  const sprintFilterTasks = useMemo(() => {
    const taskRows: Array<{ id: string; sprintId?: string | null }> = [];
    boards.forEach((board) => {
      if (board.columns) {
        Object.values(board.columns).forEach((column) => {
          if (column.tasks) {
            taskRows.push(
              ...column.tasks.map((task) => ({
                id: task.id,
                sprintId: task.sprintId,
              })),
            );
          }
        });
      }
    });
    return taskRows;
  }, [boards]);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [scrollToTopRightPx, setScrollToTopRightPx] = useState(48);
  
  // ListView scroll controls
  const [listViewScrollControls, setListViewScrollControls] = useState<{
    canScrollLeft: boolean;
    canScrollRight: boolean;
    scrollLeft: () => void;
    scrollRight: () => void;
  } | null>(null);
  const appHeaderStickyTopPx = useAppHeaderStickyTop();
  const toolsPanelRef = useRef<HTMLDivElement>(null);
  const boardViewContentRef = useRef<HTMLDivElement>(null);
  const trashScrollContainerRef = useRef<HTMLDivElement>(null);
  const syncingHorizontalScrollRef = useRef(false);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = useRef(false);

  // Check scroll state for columns
  const checkColumnsScrollState = () => {
    if (!columnsContainerRef.current) return;
    
    const container = columnsContainerRef.current;
    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth);
  };

  // Align “back to top” with the horizontal right-chevron gutter (-right-12).
  // Prefer this over a fixed viewport `right-6`: same board chrome lane, stays clear of cards.
  // Anchored to the shared view wrapper so Kanban, List, Gantt and Calendar all match.
  const syncScrollToTopGutter = useCallback(() => {
    const container = boardViewContentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Match Tailwind `-right-12` (3rem): button right edge sits 48px past the content.
    setScrollToTopRightPx(Math.max(8, window.innerWidth - rect.right - 48));
  }, []);

  useEffect(() => {
    const onWindowScroll = () => {
      setShowScrollToTop(isKanbanPageScrolledDown());
    };
    onWindowScroll();
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', onWindowScroll);
  }, []);

  useEffect(() => {
    syncScrollToTopGutter();
    window.addEventListener('resize', syncScrollToTopGutter);
    const container = boardViewContentRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncScrollToTopGutter()) : null;
    if (container && resizeObserver) resizeObserver.observe(container);
    return () => {
      window.removeEventListener('resize', syncScrollToTopGutter);
      resizeObserver?.disconnect();
    };
  }, [syncScrollToTopGutter, viewMode, selectedBoard]);

  // Column scroll functions
  const scrollColumnsLeft = () => {
    if (!columnsContainerRef.current) return;
    const container = columnsContainerRef.current;
    
    // Calculate actual column width including gap (300px min + 1.5rem gap)
    const gap = 24; // 1.5rem = 24px
    const columnMinWidth = 300;
    const columnFullWidth = columnMinWidth + gap;
    
    container.scrollBy({ left: -columnFullWidth, behavior: 'smooth' });
  };

  const scrollColumnsRight = () => {
    if (!columnsContainerRef.current) return;
    const container = columnsContainerRef.current;
    
    // Calculate actual column width including gap (300px min + 1.5rem gap)
    const gap = 24; // 1.5rem = 24px
    const columnMinWidth = 300;
    const columnFullWidth = columnMinWidth + gap;
    
    container.scrollBy({ left: columnFullWidth, behavior: 'smooth' });
  };

  // Continuous scroll functions
  const startContinuousScroll = (direction: 'left' | 'right') => {
    if (isScrollingRef.current) return;
    
    isScrollingRef.current = true;
    const container = columnsContainerRef.current;
    if (!container) return;

    const gap = 24; // 1.5rem = 24px
    const columnMinWidth = 300;
    const columnFullWidth = columnMinWidth + gap;
    const scrollAmount = direction === 'left' ? -columnFullWidth : columnFullWidth;

    // Initial scroll
    container.scrollBy({ left: scrollAmount, behavior: 'smooth' });

    // Continuous scroll with interval
    scrollIntervalRef.current = setInterval(() => {
      if (!columnsContainerRef.current) {
        stopContinuousScroll();
        return;
      }

      const currentContainer = columnsContainerRef.current;
      const canContinue = direction === 'left' 
        ? currentContainer.scrollLeft > 0
        : currentContainer.scrollLeft < currentContainer.scrollWidth - currentContainer.clientWidth;

      if (!canContinue) {
        stopContinuousScroll();
        return;
      }

      currentContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }, 300); // Scroll every 300ms for smooth continuous movement
  };

  const stopContinuousScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    isScrollingRef.current = false;
  };

  // Update scroll state when columns change
  useEffect(() => {
    // Check scroll state after a short delay to ensure layout is complete
    const timeoutId = setTimeout(() => {
      checkColumnsScrollState();
    }, 100);
    
    const container = columnsContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkColumnsScrollState);
      const resizeObserver = new ResizeObserver(() => {
        // Also delay the resize check
        setTimeout(checkColumnsScrollState, 50);
      });
      resizeObserver.observe(container);
      
      return () => {
        clearTimeout(timeoutId);
        container.removeEventListener('scroll', checkColumnsScrollState);
        resizeObserver.disconnect();
      };
    }
    
    return () => clearTimeout(timeoutId);
  }, [columns, viewMode]);

  useEffect(() => {
    const pending = pendingArchiveScrollRef.current;
    if (!pending) return;

    const timeoutId = window.setTimeout(() => {
      const action = pendingArchiveScrollRef.current;
      pendingArchiveScrollRef.current = null;
      const container = columnsContainerRef.current;
      if (!action || !container || viewMode !== 'kanban') return;

      if (action.kind === 'show') {
        const el = container.querySelector(
          `[data-kanban-column-id="${CSS.escape(action.columnId)}"]`
        ) as HTMLElement | null;
        if (!el) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const fullyVisible = eRect.left >= cRect.left - 2 && eRect.right <= cRect.right + 2;
        if (fullyVisible) {
          archiveScrollRestoreRef.current = null;
          return;
        }
        archiveScrollRestoreRef.current = action.restoreLeft;
        const overflowRight = eRect.right - cRect.right;
        const overflowLeft = cRect.left - eRect.left;
        const delta = overflowRight > 2 ? overflowRight + 8 : overflowLeft > 2 ? -(overflowLeft + 8) : 0;
        if (delta !== 0) {
          container.scrollBy({ left: delta, behavior: 'smooth' });
        }
        return;
      }

      const restoreLeft = archiveScrollRestoreRef.current;
      archiveScrollRestoreRef.current = null;
      if (restoreLeft == null) return;
      container.scrollTo({ left: restoreLeft, behavior: 'smooth' });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [visibleColumnsForCurrentBoard, viewMode]);

  // Stretch a short board to the viewport so leftover space matches page bg
  // and a Windows-style horizontal scrollbar sits at the bottom, not mid-screen.
  useLayoutEffect(() => {
    if (viewMode !== 'kanban') return;
    const el = columnsContainerRef.current;
    if (!el) return;

    const MAIN_LAYOUT_BOTTOM_PAD_PX = 24; // MainLayout py-6
    let lastApplied = -1;

    const applyMinHeight = () => {
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      const viewportH = window.visualViewport?.height ?? window.innerHeight;
      const next = Math.max(0, Math.round(viewportH - docTop - MAIN_LAYOUT_BOTTOM_PAD_PX));
      if (Math.abs(next - lastApplied) < 1) return;
      lastApplied = next;
      el.style.minHeight = `${next}px`;
    };

    applyMinHeight();
    window.addEventListener('resize', applyMinHeight);
    window.visualViewport?.addEventListener('resize', applyMinHeight);

    const resizeObserver = new ResizeObserver(applyMinHeight);
    const header = document.querySelector('header[data-tour-id="navigation"]');
    if (header) resizeObserver.observe(header);
    const pageChrome = el.closest('.main-layout-container');
    if (pageChrome) resizeObserver.observe(pageChrome);

    return () => {
      window.removeEventListener('resize', applyMinHeight);
      window.visualViewport?.removeEventListener('resize', applyMinHeight);
      resizeObserver.disconnect();
      el.style.minHeight = '';
    };
  }, [viewMode, selectedBoard, trashOpen, appHeaderStickyTopPx, canMutate]);

  // Ensure scroll state is checked when switching to Kanban view
  useEffect(() => {
    if (viewMode === 'kanban') {
      // Small delay to ensure the Kanban columns are rendered
      const timeoutId = setTimeout(() => {
        checkColumnsScrollState();
      }, 150);
      
      return () => clearTimeout(timeoutId);
    }
  }, [viewMode]);

  // Keep the trash grid and live Kanban grid on the same horizontal position.
  useEffect(() => {
    if (!trashOpen || viewMode !== 'kanban' || trashLoading) return;

    const boardScroller = columnsContainerRef.current;
    const trashScroller = trashScrollContainerRef.current;
    if (!boardScroller || !trashScroller) return;

    const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
      if (syncingHorizontalScrollRef.current) return;
      if (Math.abs(target.scrollLeft - source.scrollLeft) < 1) return;

      syncingHorizontalScrollRef.current = true;
      target.scrollLeft = source.scrollLeft;
      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
      }
      scrollSyncFrameRef.current = requestAnimationFrame(() => {
        syncingHorizontalScrollRef.current = false;
        scrollSyncFrameRef.current = null;
      });
    };

    const syncFromBoard = () => syncScroll(boardScroller, trashScroller);
    const syncFromTrash = () => syncScroll(trashScroller, boardScroller);

    // Opening Trash adopts the board's current position.
    trashScroller.scrollLeft = boardScroller.scrollLeft;
    boardScroller.addEventListener('scroll', syncFromBoard, { passive: true });
    trashScroller.addEventListener('scroll', syncFromTrash, { passive: true });

    const resizeObserver = new ResizeObserver(syncFromBoard);
    resizeObserver.observe(boardScroller);
    resizeObserver.observe(trashScroller);

    return () => {
      boardScroller.removeEventListener('scroll', syncFromBoard);
      trashScroller.removeEventListener('scroll', syncFromTrash);
      resizeObserver.disconnect();
      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      syncingHorizontalScrollRef.current = false;
    };
  }, [trashOpen, trashLoading, viewMode, selectedBoard, gridStyle]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if user is editing text - includes input, textarea, and contenteditable elements
      const target = event.target as HTMLElement;
      const isTextEditing = target instanceof HTMLInputElement || 
                           target instanceof HTMLTextAreaElement ||
                           target.isContentEditable ||
                           target.closest('[contenteditable="true"]') ||
                           target.closest('.ProseMirror') ||
                           target.closest('.tiptap');
      
      if (isTextEditing) {
        return; // Don't interfere with text editing
      }
      
      // Don't handle arrow keys in Gantt/Calendar — those views own left/right
      if (viewMode === 'gantt' || viewMode === 'calendar') {
        return;
      }
      
      // Only handle arrow keys without modifiers for board navigation
      // Let cmd/ctrl + arrow keys work normally for text editing
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && 
          (event.metaKey || event.ctrlKey)) {
        return; // Let text editing handle cmd/ctrl + arrow keys
      }
      
      if (event.key === 'ArrowLeft' && canScrollLeft) {
        event.preventDefault();
        scrollColumnsLeft();
      } else if (event.key === 'ArrowRight' && canScrollRight) {
        event.preventDefault();
        scrollColumnsRight();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [canScrollLeft, canScrollRight, viewMode]);

  // Cleanup scroll intervals on unmount and handle global mouse events
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      stopContinuousScroll();
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      stopContinuousScroll();
    };
  }, []);

  if (loading.general) {
    return <LoadingSpinner size="large" className="mt-20" />;
  }

  return (
    <>
      <ToolsHeaderControls
        toolsPanelRef={toolsPanelRef}
        headerTopPx={appHeaderStickyTopPx}
        enabled={showBoardToolbar}
        taskViewMode={taskViewMode}
        onTaskViewModeChange={onTaskViewModeChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />
      {showBoardToolbar ? (
        <div className="flex items-stretch gap-4 mb-1">
          <div ref={toolsPanelRef} className="hidden md:flex w-[160px] shrink-0">
            <Tools 
              taskViewMode={taskViewMode}
              onTaskViewModeChange={onTaskViewModeChange}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              isSearchActive={isSearchActive}
              onToggleSearch={onToggleSearch}
              hasActiveFilters={showSearchFilterBadge}
              activeFilterTooltip={activeFilterTooltip}
              onHideToolbar={() => void handleToggleBoardToolbar()}
            />
          </div>
          <div className="min-w-0 flex-1 flex">
            <TeamMembers
              members={members}
              selectedMembers={selectedMembers}
              onSelectMember={onSelectMember}
              onClearSelections={onClearMemberSelections}
              onSelectAll={onSelectAllMembers}
              isAllModeActive={isAllModeActive}
              includeAssignees={includeAssignees}
              includeWatchers={includeWatchers}
              includeCollaborators={includeCollaborators}
              includeRequesters={includeRequesters}
              includeSystem={includeSystem}
              onToggleAssignees={onToggleAssignees}
              onToggleWatchers={onToggleWatchers}
              onToggleCollaborators={onToggleCollaborators}
              onToggleRequesters={onToggleRequesters}
              onToggleSystem={onToggleSystem}
              showAgentTasks={showAgentTasks}
              currentUserId={currentUser?.id}
              currentUser={currentUser}
              systemTaskCount={getSystemTaskCount}
              onEditOwnProfile={onEditOwnProfile}
            />
          </div>
          <div className="hidden md:flex w-[168px] shrink-0">
            <BoardMetrics
              columns={columns}
              filteredColumns={getFullyFilteredColumns}
              siteSettings={siteSettings}
            />
          </div>
        </div>
      ) : (
        <div className="hidden md:flex items-center mb-1">
          <button
            type="button"
            onClick={() => void handleToggleBoardToolbar()}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 border border-dashed border-gray-300 dark:border-gray-600 transition-colors"
            title={t('tools.showBoardToolbar', { ns: 'common' })}
            aria-label={t('tools.showBoardToolbar', { ns: 'common' })}
            aria-expanded={false}
          >
            <ChevronDown size={14} />
            {t('tools.showBoardToolbar', { ns: 'common' })}
          </button>
        </div>
      )}

      {/* Search Interface — desktop/tablet; mobile uses header search */}
      {isSearchActive && (
        <div className="hidden md:block">
          <SearchInterface
            filters={searchFilters}
            availablePriorities={availablePriorities}
            availableTags={availableTags}
            onFiltersChange={onSearchFiltersChange}
            onApplySavedFilter={onApplySavedFilter}
            onUpdateSavedFilter={onUpdateSavedFilter}
            onClearAllSearchFilters={onClearAllSearchFilters}
            siteSettings={siteSettings}
            currentFilterView={currentFilterView}
            sharedFilterViews={sharedFilterViews}
            onFilterViewChange={onFilterViewChange}
            columns={columns}
            visibleColumns={visibleColumnsForCurrentBoard}
            onColumnsChange={(visibleColumns) => selectedBoard && handleColumnVisibilityChange(selectedBoard, visibleColumns)}
            selectedBoard={selectedBoard}
            showAgentTasks={showAgentTasks}
            onToggleShowAgentTasks={onToggleShowAgentTasks}
            hasBoardRelationships={hasBoardRelationships}
            availableSprints={availableSprints}
            sprintFilterTasks={sprintFilterTasks}
            boards={boards}
            onResetColumnVisibility={
              selectedBoard ? () => onBoardColumnVisibilityReset(selectedBoard) : undefined
            }
          />
        </div>
      )}

      {/* Board Tabs */}
      <div className="relative">
        <BoardTabs
          boards={tabBoards}
          selectedBoard={selectedBoard}
          onSelectBoard={handleSelectBoardWithTrashExit}
          onAddBoard={onAddBoard}
          onEditBoard={onEditBoard}
          onRemoveBoard={onRemoveBoard}
          onReorderBoards={onReorderBoards}
          isAdmin={isAdmin && canMutate}
          getFilteredTaskCount={getTaskCountForBoard}
          getBoardWipTaskCount={getBoardWipTaskCountForBoard}
          getBoardWipEffort={getBoardWipEffortForBoard}
          getTotalTaskCount={getTotalTaskCountForBoard}
          hasActiveFilters={activeFilters}
          draggedTask={canMutate ? draggedTask : null}
          onTaskDropOnBoard={onTaskDropOnBoard}
          siteSettings={siteSettings}
          trashCount={trashCount}
          trashOpen={trashOpen}
          onToggleTrash={handleToggleTrash}
        />
      </div>

      {selectedBoard && trashCount > 0 && (
        <BoardTrashCollapse open={trashOpen}>
          <BoardTrashView
              tasks={trashTasks.filter((task) =>
                taskMatchesSelectedSprint(task, selectedSprintId)
              )}
              displayColumns={Object.values(getFilteredColumnsForDisplay)
                .filter((column) => column && column.id)
                .sort((a, b) => (a.position || 0) - (b.position || 0))}
              columns={columns}
              members={members}
              isAdmin={isAdmin && canMutate}
              canMutate={canMutate}
              detailsTaskId={selectedTask?.id ?? null}
              gridStyle={gridStyle}
              onColumnWidthResize={onColumnWidthResize}
              stickyTopPx={appHeaderStickyTopPx}
              isTaskBeingDragged={!!draggedTask}
              scrollContainerRef={trashScrollContainerRef}
              loading={trashLoading}
              onSelectTask={(task) => void handleSelectTrashedTask(task)}
              onRestore={handleRestoreTrashTask}
              onPurge={handlePurgeTrashTask}
              onRestoreSelected={handleRestoreTrashSelected}
              onPurgeSelected={handlePurgeTrashSelected}
              onClose={() => setTrashOpenPersisted(false)}
              taskViewMode={taskViewMode}
          />
        </BoardTrashCollapse>
      )}

      {selectedBoard && (
        <div className="relative" ref={boardViewContentRef}>
          {(loading.tasks || loading.boards || loading.columns) && (
            <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 z-10 flex items-center justify-center">
              <LoadingSpinner size="medium" />
            </div>
          )}

          {/* Back to top — same chrome lane in every board view */}
          {showScrollToTop && (
            <button
              type="button"
              onClick={() => {
                void scrollKanbanPageToTopFastSmooth();
              }}
              className="fixed z-40 bottom-6 p-2 bg-white/60 dark:bg-gray-800/70 hover:bg-white/95 dark:hover:bg-gray-800/95 rounded-full shadow-sm hover:shadow-lg transition-all duration-200 opacity-50 hover:opacity-100 hover:scale-110"
              style={{ right: scrollToTopRightPx }}
              title={t('boardTabs.scrollToTop', { ns: 'common' })}
              aria-label={t('boardTabs.scrollToTop', { ns: 'common' })}
            >
              <ChevronUp size={18} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100" />
            </button>
          )}
          
          {/* Conditional View Rendering */}
          {viewMode === 'list' ? (
            <div className="relative">
              {(listViewScrollControls?.canScrollLeft ||
                listViewScrollControls?.canScrollRight) && (
                <div
                  className="sticky z-40 h-0 w-full overflow-visible pointer-events-none"
                  style={{ top: appHeaderStickyTopPx + 16 }}
                >
                  {listViewScrollControls?.canScrollLeft && (
                    <button
                      type="button"
                      onClick={listViewScrollControls.scrollLeft}
                      className="pointer-events-auto absolute -left-12 top-0 p-2 bg-white/60 dark:bg-gray-800/70 hover:bg-white/95 dark:hover:bg-gray-800/95 rounded-full shadow-sm hover:shadow-lg transition-all duration-200 opacity-70 hover:opacity-100 hover:scale-110"
                      title={t('boardTabs.scrollListLeft', { ns: 'common' })}
                      aria-label={t('boardTabs.scrollListLeft', { ns: 'common' })}
                    >
                      <ChevronLeft size={18} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100" />
                    </button>
                  )}

                  {listViewScrollControls?.canScrollRight && (
                    <button
                      type="button"
                      onClick={listViewScrollControls.scrollRight}
                      className="pointer-events-auto absolute -right-12 top-0 p-2 bg-white/60 dark:bg-gray-800/70 hover:bg-white/95 dark:hover:bg-gray-800/95 rounded-full shadow-sm hover:shadow-lg transition-all duration-200 opacity-70 hover:opacity-100 hover:scale-110"
                      title={t('boardTabs.scrollListRight', { ns: 'common' })}
                      aria-label={t('boardTabs.scrollListRight', { ns: 'common' })}
                    >
                      <ChevronRight size={18} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100" />
                    </button>
                  )}
                </div>
              )}

              <ListView
                filteredColumns={getFullyFilteredColumns}
                selectedBoard={selectedBoard}
                members={members}
                availablePriorities={availablePriorities}
                availableTags={availableTags}
                availableSprints={availableSprints}
                taskViewMode={taskViewMode}
                onSelectTask={onSelectTask}
                selectedTask={selectedTask}
                onRemoveTask={onRemoveTask}
                onEditTask={onEditTask}
                onCopyTask={onCopyTask}
                onMoveTaskToColumn={onMoveTaskToColumn}
                animateCopiedTaskId={animateCopiedTaskId}
                onScrollControlsChange={setListViewScrollControls}
                boards={boards}
                siteSettings={siteSettings}
                currentUser={currentUser}
                boardRelationships={boardRelationships}
                selectedSprintId={selectedSprintId}
                canMutate={canMutate}
                checkedTaskIds={checkedTaskIds}
                onToggleTaskChecked={onToggleTaskChecked}
                onClearAllChecked={onClearAllChecked}
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
                bulkUndoTaskIds={bulkUndoTaskIds}
                bulkUndoLabelKey={bulkUndoLabelKey}
                onBulkUndo={onBulkUndo}
                onClearBulkUndo={onClearBulkUndo}
                hasArchiveColumn={Object.values(columns).some((column) =>
                  isArchivedColumnFlag(column)
                )}
              />
            </div>
          ) : viewMode === 'gantt' ? (
            <Suspense fallback={<div className="flex items-center justify-center h-64"><LoadingSpinner /></div>}>
              <GanttViewV2
                columns={getFullyFilteredColumns}
                onSelectTask={onSelectTask}
                selectedTask={selectedTask}
                taskViewMode={taskViewMode}
                onUpdateTask={onEditTask}
                onTaskDragStart={onTaskDragStart}
                onTaskDragEnd={onTaskDragEnd}
                onClearDragState={onClearDragState}
                boardId={selectedBoard}
                onAddTask={onAddTask}
                currentUser={currentUser}
                members={members}
                onRefreshData={onRefreshBoardData}
                relationships={boardRelationships}
                onCopyTask={onCopyTask}
                onRemoveTask={onRemoveTask}
                siteSettings={siteSettings}
                canMutate={canMutate}
                onMoveTaskToColumn={onMoveTaskToColumn}
                onReorderTaskInColumn={onGanttReorderTask}
                availablePriorities={availablePriorities}
                availableTags={availableTags}
                availableSprints={availableSprints}
                selectedSprintId={selectedSprintId}
                boards={boards}
                checkedTaskIds={checkedTaskIds}
                onReplaceCheckedTaskIds={onReplaceCheckedTaskIds}
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
                bulkUndoTaskIds={bulkUndoTaskIds}
                bulkUndoLabelKey={bulkUndoLabelKey}
                onBulkUndo={onBulkUndo}
                onClearBulkUndo={onClearBulkUndo}
                hasArchiveColumn={Object.values(columns).some((column) =>
                  isArchivedColumnFlag(column)
                )}
              />
            </Suspense>
          ) : viewMode === 'calendar' ? (
            <Suspense fallback={<div className="flex items-center justify-center h-64"><LoadingSpinner /></div>}>
              <CalendarView
                columns={filteredColumns}
                onSelectTask={onSelectTask}
                selectedTask={selectedTask}
                taskViewMode={taskViewMode}
                onUpdateTask={onEditTask}
                boardId={selectedBoard}
                onAddTask={onAddTask}
                currentUser={currentUser}
                members={members}
                canMutate={canMutate}
                availablePriorities={availablePriorities}
                availableTags={availableTags}
                availableSprints={availableSprints}
                boards={boards}
                checkedTaskIds={checkedTaskIds}
                onReplaceCheckedTaskIds={onReplaceCheckedTaskIds}
                bulkBusy={bulkBusy}
                onBulkDelete={onBulkDelete}
                onBulkPermanentDelete={onBulkPermanentDelete}
                onBulkAddTag={onBulkAddTag}
                onBulkCopy={onBulkCopy}
                onBulkArchive={onBulkArchive}
                onBulkSprint={onBulkSprint}
                onBulkPriority={onBulkPriority}
                onBulkMoveToBoard={onBulkMoveToBoard}
                onBulkAssignee={onBulkAssignee}
                onBulkRequester={onBulkRequester}
                onBulkAddWatcher={onBulkAddWatcher}
                onBulkRemoveWatcher={onBulkRemoveWatcher}
                onBulkAddCollaborator={onBulkAddCollaborator}
                onBulkRemoveCollaborator={onBulkRemoveCollaborator}
                bulkUndoTaskIds={bulkUndoTaskIds}
                bulkUndoLabelKey={bulkUndoLabelKey}
                onBulkUndo={onBulkUndo}
                onClearBulkUndo={onClearBulkUndo}
                hasArchiveColumn={Object.values(columns).some((column) =>
                  isArchivedColumnFlag(column)
                )}
                siteSettings={siteSettings}
              />
            </Suspense>
          ) : (
            <>
              {Object.values(getFilteredColumnsForDisplay).length > 0 &&
                Object.values(getFilteredColumnsForDisplay).every(
                  (col) => !(col.tasks && col.tasks.length > 0)
                ) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 px-1">
                  {t('column.emptyBoardHint')}
                </p>
              )}
              {/* Columns Navigation Container */}
          <div className="relative kanban-columns-container">
            {(canScrollLeft || canScrollRight) && (
              <div
                className="sticky z-40 h-0 w-full overflow-visible pointer-events-none"
                style={{ top: appHeaderStickyTopPx + 16 }}
              >
                {canScrollLeft && (
                  <button
                    type="button"
                    onClick={scrollColumnsLeft}
                    onMouseDown={() => startContinuousScroll('left')}
                    onMouseUp={stopContinuousScroll}
                    onMouseLeave={stopContinuousScroll}
                    className="pointer-events-auto absolute -left-12 top-0 p-2 bg-white/60 dark:bg-gray-800/70 hover:bg-white/95 dark:hover:bg-gray-800/95 rounded-full shadow-sm hover:shadow-lg transition-all duration-200 opacity-70 hover:opacity-100 hover:scale-110"
                    title={t('boardTabs.scrollColumnsLeft', { ns: 'common' })}
                    aria-label={t('boardTabs.scrollColumnsLeft', { ns: 'common' })}
                  >
                    <ChevronLeft size={18} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100" />
                  </button>
                )}
                {canScrollRight && (
                  <button
                    type="button"
                    onClick={scrollColumnsRight}
                    onMouseDown={() => startContinuousScroll('right')}
                    onMouseUp={stopContinuousScroll}
                    onMouseLeave={stopContinuousScroll}
                    className="pointer-events-auto absolute -right-12 top-0 p-2 bg-white/60 dark:bg-gray-800/70 hover:bg-white/95 dark:hover:bg-gray-800/95 rounded-full shadow-sm hover:shadow-lg transition-all duration-200 opacity-70 hover:opacity-100 hover:scale-110"
                    title={t('boardTabs.scrollColumnsRight', { ns: 'common' })}
                    aria-label={t('boardTabs.scrollColumnsRight', { ns: 'common' })}
                  >
                    <ChevronRight size={18} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100" />
                  </button>
                )}
              </div>
            )}

            {/* Scrollable columns container */}
            <div
              ref={columnsContainerRef}
              className="overflow-x-auto w-full kanban-scrollable-container"
              style={{ 
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--scrollbar-thumb) var(--scrollbar-track)'
                // Background handled by CSS class to prevent flash
              }}
              data-tour-id="kanban-columns"
              data-kanban-scroll="board"
            >
              {/* Board-level selection controls align to the same grid as the columns.
                  They intentionally live outside each column header/count slot. */}
              {canMutate && (
              <div
                style={gridStyle}
                className="h-5 items-center"
                data-kanban-selection-strip
              >
                {Object.values(getFilteredColumnsForDisplay)
                  .filter((column) => column && column.id)
                  .sort((a, b) => (a.position || 0) - (b.position || 0))
                  .map((column) => (
                    <div
                      key={`select-${column.id}`}
                      className="flex h-5 items-center justify-center"
                    >
                      <ColumnSelectionControl
                        columnId={column.id}
                        tasks={filteredColumns[column.id]?.tasks || []}
                        checkedTaskIds={checkedTaskIds || new Set<string>()}
                        onToggleColumnChecked={onToggleColumnChecked}
                      />
                    </div>
                  ))}
              </div>
              )}
                             {/* DndContext handled at App level for global cross-board functionality */}
            {/* Admin view with column drag and drop */}
            {currentUser?.roles?.includes('admin') ? (
              // Re-enabled SortableContext for column reordering
              <SortableContext
                items={Object.values(getFilteredColumnsForDisplay)
                  .filter(column => column && column.id) // Filter out null/undefined columns
                  .sort((a, b) => (a.position || 0) - (b.position || 0))
                  .map(column => column.id)
                }
                strategy={rectSortingStrategy}
              >
                <BoardDropArea selectedBoard={selectedBoard} style={gridStyle}>
                  {Object.values(getFilteredColumnsForDisplay)
                    .filter(column => column && column.id) // Filter out null/undefined columns
                    .sort((a, b) => (a.position || 0) - (b.position || 0))
                    .map((column, index, array) => (
                      <React.Fragment key={column.id}>
                        <div className="relative" data-kanban-column-id={column.id}>
                          <KanbanColumn
                            column={column}
                            filteredTasks={filteredColumns[column.id]?.tasks || []}
                            members={members}
                            currentUser={currentUser}
                            selectedMembers={selectedMembers}
                            selectedTask={selectedTask}
                            draggedTask={draggedTask}
                            draggedColumn={draggedColumn}
                            dragPreview={dragPreview}
                            onAddTask={onAddTask}
                            columnWarnings={columnWarnings}
                            onDismissColumnWarning={onDismissColumnWarning}
                            onClearFiltersForHiddenTask={onClearFiltersForHiddenTask}
                            onAssignCreatedTaskToSprint={onAssignCreatedTaskToSprint}
                            onRemoveTask={onRemoveTask}
                            onEditTask={onEditTask}
                            onCopyTask={onCopyTask}
                            onEditColumn={onEditColumn}
                            siteSettings={siteSettings}
                            onRemoveColumn={onRemoveColumn}
                            onAddColumn={onAddColumn}
                            showColumnDeleteConfirm={showColumnDeleteConfirm}
                            onConfirmColumnDelete={onConfirmColumnDelete}
                            onCancelColumnDelete={onCancelColumnDelete}
                            getColumnTaskCount={getColumnTaskCount}
                            onTaskDragStart={onTaskDragStart}
                            onTaskDragEnd={() => {}}
                            onTaskDragOver={onTaskDragOver}
                            onTaskDrop={onTaskDrop}
                            onSelectTask={onSelectTask}
                            isAdmin={isAdmin && canMutate}
                            canMutate={canMutate}
                            taskViewMode={taskViewMode}
                            availablePriorities={availablePriorities}
                            availableTags={availableTags}
                            onTagAdd={onTagAdd}
                            onTagRemove={onTagRemove}
                            boards={boards}
                            columns={columns}
                            
                            // Task linking props
                            isLinkingMode={isLinkingMode}
                            linkingSourceTask={linkingSourceTask}
                            onStartLinking={onStartLinking}
                            onFinishLinking={onFinishLinking}
                            
                            // Hover highlighting props
                            hoveredLinkTask={hoveredLinkTask}
                            onLinkToolHover={onLinkToolHover}
                            onLinkToolHoverEnd={onLinkToolHoverEnd}
                            getTaskRelationshipType={getTaskRelationshipType}
                            onUnlinkRelatedTask={onUnlinkRelatedTask}
                            relationSummaryByTaskId={relationSummaryByTaskId}
                            
                            // Network status
                            isOnline={isOnline}
                            
                            // Sprint filtering
                            selectedSprintId={selectedSprintId}
                            availableSprints={availableSprints}
                            hasActiveFilters={activeFilters}
                            highlightedNewTaskId={highlightedNewTaskId}
                            checkedTaskIds={checkedTaskIds}
                            onToggleTaskChecked={onToggleTaskChecked}
                            onToggleColumnChecked={onToggleColumnChecked}
                            onClearAllChecked={onClearAllChecked}
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
                            bulkUndoTaskIds={bulkUndoTaskIds}
                            bulkUndoLabelKey={bulkUndoLabelKey}
                            bulkUndoAnchorColumnIds={bulkUndoAnchorColumnIds}
                            onBulkUndo={onBulkUndo}
                            onClearBulkUndo={onClearBulkUndo}
                            selectedBoardId={selectedBoard}
                            draggedTaskIds={draggedTaskIds}
                            columnHeaderStickyTopPx={appHeaderStickyTopPx}
                          />
                          {/* Resize handle between columns (not after the last one) */}
                          {index < array.length - 1 && onColumnWidthResize && (
                            <ColumnResizeHandle
                              onResize={onColumnWidthResize}
                              isColumnBeingDragged={!!draggedColumn}
                              isTaskBeingDragged={!!draggedTask}
                              stickyTopPx={appHeaderStickyTopPx}
                            />
                          )}
                        </div>
                      </React.Fragment>
                    ))}
                </BoardDropArea>
              </SortableContext>
            ) : (
              /* Regular user view */
              <BoardDropArea selectedBoard={selectedBoard} style={gridStyle}>
                {Object.values(getFilteredColumnsForDisplay)
                  .filter(column => column && column.id) // Filter out null/undefined columns
                  .sort((a, b) => (a.position || 0) - (b.position || 0))
                  .map((column, index, array) => (
                    <React.Fragment key={column.id}>
                      <div className="relative" data-kanban-column-id={column.id}>
                        <KanbanColumn
                          column={column}
                      filteredTasks={filteredColumns[column.id]?.tasks || []}
                      members={members}
                      currentUser={currentUser}
                      selectedMembers={selectedMembers}
                      selectedTask={selectedTask}
                      draggedTask={draggedTask}
                      draggedColumn={draggedColumn}
                      dragPreview={dragPreview}
                      onAddTask={onAddTask}
                      columnWarnings={columnWarnings}
                      onDismissColumnWarning={onDismissColumnWarning}
                      onClearFiltersForHiddenTask={onClearFiltersForHiddenTask}
                      onAssignCreatedTaskToSprint={onAssignCreatedTaskToSprint}
                      onRemoveTask={onRemoveTask}
                      onEditTask={onEditTask}
                      onCopyTask={onCopyTask}
                      onEditColumn={onEditColumn}
                      siteSettings={siteSettings}
                      onRemoveColumn={onRemoveColumn}
                      onAddColumn={onAddColumn}
                      showColumnDeleteConfirm={showColumnDeleteConfirm}
                      onConfirmColumnDelete={onConfirmColumnDelete}
                      onCancelColumnDelete={onCancelColumnDelete}
                      getColumnTaskCount={getColumnTaskCount}
                      onTaskDragStart={onTaskDragStart}
                      onTaskDragEnd={() => {}}
                      onTaskDragOver={onTaskDragOver}
                      onTaskDrop={onTaskDrop}
                      onSelectTask={onSelectTask}
                      isAdmin={false}
                      canMutate={canMutate}
                      taskViewMode={taskViewMode}
                      availablePriorities={availablePriorities}
                      availableTags={availableTags}
                      onTagAdd={onTagAdd}
                      onTagRemove={onTagRemove}
                      boards={boards}
                      columns={columns}
                      
                      // Task linking props
                      isLinkingMode={isLinkingMode}
                      linkingSourceTask={linkingSourceTask}
                      onStartLinking={onStartLinking}
                      onFinishLinking={onFinishLinking}
                      
                      // Hover highlighting props
                      hoveredLinkTask={hoveredLinkTask}
                      onLinkToolHover={onLinkToolHover}
                      onLinkToolHoverEnd={onLinkToolHoverEnd}
                      getTaskRelationshipType={getTaskRelationshipType}
                      onUnlinkRelatedTask={onUnlinkRelatedTask}
                      relationSummaryByTaskId={relationSummaryByTaskId}
                      
                      // Network status
                      isOnline={isOnline}
                      
                      // Sprint filtering
                      selectedSprintId={selectedSprintId}
                      availableSprints={availableSprints}
                      hasActiveFilters={activeFilters}
                      highlightedNewTaskId={highlightedNewTaskId}
                      checkedTaskIds={checkedTaskIds}
                      onToggleTaskChecked={onToggleTaskChecked}
                      onToggleColumnChecked={onToggleColumnChecked}
                      onClearAllChecked={onClearAllChecked}
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
                      bulkUndoTaskIds={bulkUndoTaskIds}
                      bulkUndoLabelKey={bulkUndoLabelKey}
                      bulkUndoAnchorColumnIds={bulkUndoAnchorColumnIds}
                      onBulkUndo={onBulkUndo}
                      onClearBulkUndo={onClearBulkUndo}
                      selectedBoardId={selectedBoard}
                      draggedTaskIds={draggedTaskIds}
                      columnHeaderStickyTopPx={appHeaderStickyTopPx}
                        />
                        {/* Resize handle between columns (not after the last one) */}
                        {index < array.length - 1 && onColumnWidthResize && (
                          <ColumnResizeHandle
                            onResize={onColumnWidthResize}
                            isColumnBeingDragged={!!draggedColumn}
                            isTaskBeingDragged={!!draggedTask}
                            stickyTopPx={appHeaderStickyTopPx}
                          />
                        )}
                      </div>
                    </React.Fragment>
                  ))}
              </BoardDropArea>
            )}
            </div>
          </div>
            </>
          )}
        </div>
      )}


    </>
  );
};

const ColumnSelectionControl: React.FC<{
  columnId: string;
  tasks: Task[];
  checkedTaskIds: Set<string>;
  onToggleColumnChecked?: (
    columnId: string,
    taskIds: string[],
    selectAll: boolean
  ) => void;
}> = ({ columnId, tasks, checkedTaskIds, onToggleColumnChecked }) => {
  const { t } = useTranslation('tasks');
  const selectedCount = checkedIdsInColumn(checkedTaskIds, tasks).length;
  const allChecked = allTasksCheckedInColumn(checkedTaskIds, tasks);
  const indeterminate = selectedCount > 0 && selectedCount < tasks.length;

  // Always show Select all for columns that have tasks.
  if (tasks.length === 0 || !onToggleColumnChecked) return null;

  const ariaLabel = allChecked
    ? t('kanbanSelect.unselectAllInColumn')
    : t('kanbanSelect.selectAllInColumn');

  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-gray-200/70 dark:hover:bg-gray-700/70"
      title={ariaLabel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ModernCheckbox
        checked={allChecked}
        indeterminate={indeterminate}
        onChange={() =>
          onToggleColumnChecked(
            columnId,
            tasks.map((task) => task.id),
            !allChecked
          )
        }
        size="sm"
        aria-label={ariaLabel}
        data-testid={`column-select-all-${columnId}`}
      />
      <span className="whitespace-nowrap text-[11px] font-medium leading-none text-gray-500 dark:text-gray-400">
        {t('kanbanSelect.selectAllLabel')}
      </span>
    </label>
  );
};

// Board-level droppable area to detect when entering board area from tabs
const BoardDropArea: React.FC<{ selectedBoard: string | null; style: React.CSSProperties; children: React.ReactNode }> = ({ selectedBoard, style, children }) => {
  const { setNodeRef } = useDroppable({
    id: `board-area-${selectedBoard}`,
    data: {
      type: 'board-area',
      boardId: selectedBoard
    }
  });

  return (
    <div 
      ref={setNodeRef} 
      className="board-drop-area"
      data-tour-id="kanban-columns-grid"
      style={{
        ...style
        // Background handled by CSS class to prevent flash
      }}
    >
      {children}
    </div>
  );
};

export default KanbanPage;
