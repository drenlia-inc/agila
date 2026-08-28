import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Plus, MoreVertical, X, GripVertical, Archive, AlertTriangle, ScrollText, Trash2, HelpCircle } from 'lucide-react';
import { Board, Column, Task, TeamMember, PriorityOption, CurrentUser, Tag, ColumnVisibilityWarning } from '../types';
import { TaskViewMode } from '../utils/userPreferences';
import TaskCard from './TaskCard';
import ColumnBulkActionBar from './ColumnBulkActionBar';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { parseFinishedColumnNames, isArchivedColumnFlag } from '../utils/columnUtils';
import { getWipStatus, hasWipLimit } from '../utils/kanbanFlowUtils';
import { TASK_COUNT_PILL_BASE, taskCountPillToneClass, taskCountPillWeightClass } from '../utils/taskCountPill';
import { sumTaskEffort, formatEffortDisplay, parseEffortUnit } from '../utils/taskUtils';
import { showColumnEffort, showColumnTaskCounts } from '../utils/kanbanChromeVisibility';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import { COLUMN_TITLE_MAX_LENGTH, COLUMN_POLICY_MAX_LENGTH } from '../constants/appConstants';
import { resolveTaskMember } from '../utils/agentMemberUi';
import {
  shouldShowColumnBulkFab,
  shouldShowColumnBulkUndo,
  type ToggleTaskCheckedOptions,
} from '../utils/kanbanMultiSelect';
import ColumnBulkUndoFab from './ColumnBulkUndoFab';
import type { TaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import { getTaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import {
  estimateTaskContentHeight,
  DRAG_OVERSCAN,
  INSERTION_PREVIEW_HEIGHT_PX,
  TASK_ROW_GAP_PX,
  useColumnVirtualRange,
} from '../hooks/useColumnVirtualRange';
import {
  KANBAN_COLUMN_HEADER_PORTAL_STYLE,
  useStickyKanbanColumnHeader,
} from '../hooks/useStickyKanbanColumnHeader';
import { useColumnDisplayTitle } from '../utils/columnDisplayTitle';
import { formFieldClass } from '../utils/formFieldClasses';

interface KanbanColumnProps {
  column: Column;
  filteredTasks: Task[];
  members: TeamMember[];
  currentUser?: CurrentUser | null;
  selectedMembers: string[];
  selectedTask: Task | null;
  draggedTask: Task | null;
  draggedColumn: Column | null;
  dragPreview?: {
    targetColumnId: string;
    insertIndex: number;
    isCrossColumn?: boolean;
  } | null;
  onAddTask: (columnId: string) => void;
  columnWarnings?: Record<string, ColumnVisibilityWarning>;
  onDismissColumnWarning?: (columnId: string) => void;
  onClearFiltersForHiddenTask?: () => void;
  onAssignCreatedTaskToSprint?: (columnId: string, taskId: string, sprintId: string) => Promise<void>;
  onRemoveTask: (taskId: string, event?: React.MouseEvent) => void;
  onEditTask: (task: Task) => void;
  onCopyTask: (task: Task) => void;
  onEditColumn: (
    columnId: string,
    title: string,
    is_finished?: boolean,
    is_archived?: boolean,
    wip_limit?: number | null,
    policy_text?: string | null
  ) => void;
  siteSettings?: { [key: string]: string };
  onRemoveColumn: (columnId: string) => Promise<void>;
  onAddColumn: (afterColumnId: string) => void;
  showColumnDeleteConfirm?: string | null;
  onConfirmColumnDelete?: (columnId: string) => Promise<void>;
  onCancelColumnDelete?: () => void;
  getColumnTaskCount?: (columnId: string) => number;
  onTaskDragStart: (task: Task) => void;
  onTaskDragEnd: () => void;
  onTaskDragOver: (e: React.DragEvent, columnId: string, index: number) => void;
  onSelectTask: (task: Task | null, options?: { scrollToComments?: boolean }) => void;
  onTaskDrop: (columnId: string, index: number) => void;
  isAdmin?: boolean;
  /** false for viewer role — hide add/edit/DnD controls */
  canMutate?: boolean;
  taskViewMode?: TaskViewMode;
  availablePriorities?: PriorityOption[];
  availableTags?: Tag[];
  onTagAdd?: (taskId: string) => (tagId: string) => Promise<void>;
  onTagRemove?: (taskId: string) => (tagId: string) => Promise<void>;
  onTaskEnterMiniMode?: () => void;
  onTaskExitMiniMode?: () => void;
  boards?: any[]; // To get project identifier from board
  columns?: { [key: string]: { id: string; title: string; is_archived?: boolean; is_finished?: boolean } };
  
  // Task linking props
  isLinkingMode?: boolean;
  linkingSourceTask?: Task | null;
  onStartLinking?: (
    task: Task,
    startPosition: { x: number; y: number },
    options?: { shiftKey?: boolean }
  ) => void;
  onFinishLinking?: (targetTask: Task | null, relationshipType?: 'parent' | 'child' | 'related') => Promise<void>;
  
  // Hover highlighting props
  hoveredLinkTask?: Task | null;
  onLinkToolHover?: (task: Task) => void;
  onLinkToolHoverEnd?: () => void;
  getTaskRelationshipType?: (taskId: string) => 'parent' | 'child' | 'related' | null;
  onUnlinkRelatedTask?: (targetTask: Task) => void | Promise<void>;
  relationSummaryByTaskId?: Map<string, TaskRelationshipSummary>;
  
  // Network status
  isOnline?: boolean;
  
  // Sprint filtering
  selectedSprintId?: string | null;
  availableSprints?: any[]; // Optional: sprints passed from parent (avoids duplicate API calls)

  /** When true, task count pill uses the blue “filtered” style (same as board tabs). */
  hasActiveFilters?: boolean;

  /** Task id briefly highlighted after create-at-top. */
  highlightedNewTaskId?: string | null;

  /** Multi-check set for this board. */
  checkedTaskIds?: Set<string>;
  onToggleTaskChecked?: (taskId: string, options?: ToggleTaskCheckedOptions) => void;
  onToggleColumnChecked?: (columnId: string, taskIds: string[], selectAll: boolean) => void;
  onClearAllChecked?: () => void;
  isMultiSelectDragLocked?: boolean;
  bulkBusy?: boolean;
  onBulkAddTag?: (taskIds: string[], tagId: string) => void;
  onBulkCopy?: (taskIds: string[]) => void;
  onBulkArchive?: (taskIds: string[]) => void;
  onBulkDelete?: (taskIds: string[]) => void;
  /** Admin Shift+click permanent delete for multi-select. */
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
  selectedBoardId?: string | null;
  /** Task ids currently in a follower multi-drag (fade placeholders). */
  draggedTaskIds?: string[];

  /** When set, the real column header pins under the logo bar while the page scrolls. */
  columnHeaderStickyTopPx?: number;
}

function KanbanColumn({
  column,
  filteredTasks,
  members,
  currentUser,
  selectedMembers,
  selectedTask,
  draggedTask,
  draggedColumn,
  dragPreview,
  onAddTask,
  columnWarnings,
  onDismissColumnWarning,
  onClearFiltersForHiddenTask,
  onAssignCreatedTaskToSprint,
  onRemoveTask,
  onEditTask,
  onCopyTask,
  onEditColumn,
  siteSettings,
  onRemoveColumn,
  onAddColumn,
  showColumnDeleteConfirm,
  onConfirmColumnDelete,
  onCancelColumnDelete,
  getColumnTaskCount,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskDragOver,
  onSelectTask,
  onTaskDrop,
  isAdmin = false,
  canMutate = true,
  taskViewMode = 'expand',
  availablePriorities = [],
  availableTags = [],
  onTagAdd,
  onTagRemove,
  onTaskEnterMiniMode,
  onTaskExitMiniMode,
  boards,
  columns,
  
  // Task linking props
  isLinkingMode,
  linkingSourceTask,
  onStartLinking,
  onFinishLinking,
  
  // Hover highlighting props
  hoveredLinkTask,
  onLinkToolHover,
  onLinkToolHoverEnd,
  getTaskRelationshipType,
  onUnlinkRelatedTask,
  relationSummaryByTaskId,
  
  // Network status
  isOnline = true, // Default to true if not provided
  
  // Sprint filtering
  selectedSprintId = null,
  availableSprints,
  hasActiveFilters = false,
  highlightedNewTaskId = null,
  checkedTaskIds,
  onToggleTaskChecked,
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
  selectedBoardId = null,
  draggedTaskIds,
  columnHeaderStickyTopPx,
}: KanbanColumnProps) {
  const { t, i18n } = useTranslation(['tasks', 'common']);
  const columnDisplayTitle = useColumnDisplayTitle();
  const displayTitle = columnDisplayTitle(column);
  const [isEditing, setIsEditing] = useState(false);
  const [sprintAssignBusy, setSprintAssignBusy] = useState(false);
  const [title, setTitle] = useState(displayTitle);
  const [isFinished, setIsFinished] = useState(column.is_finished || false);
  const [isArchived, setIsArchived] = useState(column.is_archived || false);
  const [wipLimitInput, setWipLimitInput] = useState(
    column.wip_limit != null ? String(column.wip_limit) : ''
  );
  const [policyText, setPolicyText] = useState(column.policy_text || '');
  const [showMenu, setShowMenu] = useState(false);
  const columnMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [columnMenuPosition, setColumnMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const visibilityWarning = columnWarnings?.[column.id];
  const taskListRef = useRef<HTMLDivElement | null>(null);
  const hiddenTaskFilterList = useMemo(() => {
    if (!visibilityWarning) return '';
    const w = visibilityWarning;
    const parts: string[] = [];
    if (w.reasons.search) parts.push(t('column.filterTypes.searchFilters'));
    if (w.reasons.linked) parts.push(t('column.filterTypes.linkedTasks'));
    if (w.reasons.sprint) parts.push(t('column.filterTypes.sprintSelection'));
    if (w.reasons.members) parts.push(t('column.filterTypes.memberFilters'));
    const andW = t('column.and');
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} ${andW} ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, ${andW} ${parts[parts.length - 1]}`;
  }, [visibilityWarning, t, i18n.language]);

  const selectedSprintName = useMemo(() => {
    if (!visibilityWarning?.selectedSprintId || !availableSprints?.length) {
      return visibilityWarning?.selectedSprintId || '';
    }
    const sp = availableSprints.find((s: { id: string; name?: string }) => s.id === visibilityWarning.selectedSprintId);
    return sp?.name || visibilityWarning.selectedSprintId;
  }, [visibilityWarning?.selectedSprintId, availableSprints]);

  // Initialize state when editing starts (but only once per edit session)
  useEffect(() => {
    if (isEditing && !editingStartedRef.current) {
      // Mark that we've started editing
      editingStartedRef.current = true;
      
      setTitle(displayTitle);
      setIsFinished(column.is_finished || false);
      setIsArchived(column.is_archived || false);
      setWipLimitInput(column.wip_limit != null ? String(column.wip_limit) : '');
      setPolicyText(column.policy_text || '');
      
      // Run auto-detection immediately when editing starts
      if (siteSettings?.DEFAULT_FINISHED_COLUMN_NAMES) {
        const finishedColumnNames = parseFinishedColumnNames(siteSettings.DEFAULT_FINISHED_COLUMN_NAMES);
        const shouldBeFinished = finishedColumnNames.some(finishedName => 
          finishedName.toLowerCase() === column.title.toLowerCase()
        );
        if (shouldBeFinished) {
          setIsFinished(true);
          setIsArchived(false);
        }
      }
    } else if (!isEditing) {
      // Reset the flag when we exit editing mode
      editingStartedRef.current = false;
    }
  }, [isEditing, displayTitle, column.title, column.is_finished, column.is_archived, column.wip_limit, column.policy_text, siteSettings]);
  
  // Sync state with props when NOT editing
  useEffect(() => {
    if (!isEditing) {
      setTitle(displayTitle);
      setIsFinished(column.is_finished || false);
      setIsArchived(column.is_archived || false);
      setWipLimitInput(column.wip_limit != null ? String(column.wip_limit) : '');
      setPolicyText(column.policy_text || '');
    }
  }, [displayTitle, column.is_finished, column.is_archived, column.wip_limit, column.policy_text, isEditing]);

  // Auto-detect finished column names when title changes during editing
  useEffect(() => {
    if (isEditing && siteSettings?.DEFAULT_FINISHED_COLUMN_NAMES) {
      const finishedColumnNames = parseFinishedColumnNames(siteSettings.DEFAULT_FINISHED_COLUMN_NAMES);
      const shouldBeFinished = finishedColumnNames.some(finishedName => 
        finishedName.toLowerCase() === title.toLowerCase()
      );
      if (shouldBeFinished) {
        setIsFinished(true);
        setIsArchived(false); // Cannot be both finished and archived
      }
    }
  }, [title, isEditing, siteSettings?.DEFAULT_FINISHED_COLUMN_NAMES]);

  // Auto-detect archived column when title changes
  useEffect(() => {
    if (isEditing && title.toLowerCase() === 'archive') {
      setIsArchived(true);
      setIsFinished(false); // Cannot be both finished and archived
    }
  }, [title, isEditing]);

  // Handle mutual exclusivity between finished and archived
  useEffect(() => {
    if (isFinished && isArchived) {
      setIsArchived(false);
    }
  }, [isFinished]);

  useEffect(() => {
    if (isArchived && isFinished) {
      setIsFinished(false);
    }
  }, [isArchived]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [deleteButtonRef, setDeleteButtonRef] = useState<HTMLButtonElement | null>(null);
  const [shouldSelectAll, setShouldSelectAll] = useState(false);
  const columnHeaderRef = useRef<HTMLDivElement>(null);
  const columnElRef = useRef<HTMLElement | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const lastSaveTimestampRef = useRef<number>(0);
  const editingStartedRef = useRef<boolean>(false);
  const columnEffort = useMemo(() => sumTaskEffort(filteredTasks), [filteredTasks]);
  const effortDisplay = useMemo(
    () => formatEffortDisplay(columnEffort, parseEffortUnit(siteSettings)),
    [columnEffort, siteSettings]
  );
  
  // Refs to track latest state values for click-outside handler
  const titleRef = useRef(title);
  const isFinishedRef = useRef(isFinished);
  const isArchivedRef = useRef(isArchived);
  const wipLimitInputRef = useRef(wipLimitInput);
  const policyTextRef = useRef(policyText);
  
  // Keep refs in sync with state
  useEffect(() => {
    titleRef.current = title;
    isFinishedRef.current = isFinished;
    isArchivedRef.current = isArchived;
    wipLimitInputRef.current = wipLimitInput;
    policyTextRef.current = policyText;
  }, [title, isFinished, isArchived, wipLimitInput, policyText]);

  const parseWipLimitValue = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  const saveColumnEdits = async (
    nextTitle: string,
    nextFinished: boolean,
    nextArchived: boolean,
    nextWipRaw?: string,
    nextPolicy?: string
  ) => {
    const wip = parseWipLimitValue(nextWipRaw ?? wipLimitInputRef.current);
    const policy = (nextPolicy ?? policyTextRef.current).trim() || null;
    await onEditColumn(
      column.id,
      nextTitle.trim(),
      nextFinished,
      nextArchived,
      nextFinished || nextArchived ? null : wip,
      policy
    );
  };

  const openColumnMenu = () => {
    const button = columnMenuButtonRef.current;
    if (!button) {
      setShowMenu(true);
      return;
    }
    const rect = button.getBoundingClientRect();
    const menuWidth = 192; // w-48
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    setColumnMenuPosition({
      top: rect.bottom + 4,
      left,
    });
    setShowMenu(true);
  };

  // Auto-close menu when clicking outside; keep portaled menu aligned on scroll/resize
  React.useEffect(() => {
    if (!showMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        !target.closest('.column-menu-container') &&
        !target.closest('.column-management-menu-portal')
      ) {
        setShowMenu(false);
        setColumnMenuPosition(null);
      }
    };

    const reposition = () => {
      const button = columnMenuButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 192;
      setColumnMenuPosition({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      });
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [showMenu]);

  // Auto-save and close when clicking outside the edit form
  React.useEffect(() => {
    const handleClickOutside = async (event: MouseEvent) => {
      if (isEditing && columnHeaderRef.current) {
        const target = event.target as HTMLElement;
        // Check if click is outside the column header (edit form)
        if (!columnHeaderRef.current.contains(target)) {
          // Skip save if we just did an immediate save (within last 500ms)
          const now = Date.now();
          if (now - lastSaveTimestampRef.current < 500) {
            setIsEditing(false);
            return;
          }
          
          // Save the changes using latest values from refs
          const currentTitle = titleRef.current;
          const currentIsFinished = isFinishedRef.current;
          const currentIsArchived = isArchivedRef.current;
          
          if (currentTitle.trim() && !isSubmitting) {
            setIsSubmitting(true);
            await saveColumnEdits(
              currentTitle.trim(),
              currentIsFinished,
              currentIsArchived,
              wipLimitInputRef.current,
              policyTextRef.current
            );
            setIsEditing(false);
            setIsSubmitting(false);
          }
        }
      }
    };

    // Add event listener when editing
    if (isEditing) {
      // Small delay to prevent immediate trigger from the click that started editing
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    // Cleanup event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditing, isSubmitting, column.id, onEditColumn]);

  // Handle text selection when editing starts via click
  React.useEffect(() => {
    if (isEditing && shouldSelectAll) {
      // Multiple attempts to ensure input is ready and focused
      const selectText = () => {
        if (editInputRef.current) {
          editInputRef.current.focus();
          editInputRef.current.select();
          setShouldSelectAll(false); // Reset flag
          return true;
        }
        return false;
      };

      // Try immediately
      if (!selectText()) {
        // If failed, try with small delay
        setTimeout(() => {
          if (!selectText()) {
            // If still failed, try one more time with longer delay
            setTimeout(selectText, 50);
          }
        }, 10);
      }
    }
  }, [isEditing, shouldSelectAll]);

  // Use @dnd-kit sortable hook for columns (Admin only)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: column.id, 
    disabled: !isAdmin || isEditing,  // Disable drag when editing THIS column
    data: {
      type: 'column',
      column: column
    }
  });

  // Use droppable hook for the column container itself - for column-to-column drops
  const { setNodeRef: setColumnDroppableRef, isOver: isColumnOver } = useDroppable({
    id: column.id, // Use column ID directly for column-to-column drops
    data: {
      type: 'column',
      column: column,
      columnId: column.id
    },
    // Only disable when dragging a task (not when dragging a column - we need column drops to work!)
    disabled: !!draggedTask && !draggedColumn
  });

  // Use droppable hook for the top drop zone - shows "Drop here" above column header
  const { setNodeRef: setTopDropZoneRef, isOver: isTopDropZoneOver } = useDroppable({
    id: `${column.id}-top-drop`,
    data: {
      type: 'column-top',
      column: column,
      columnId: column.id
    },
    // Only active when dragging a column (not the same column)
    disabled: !draggedColumn || draggedColumn.id === column.id
  });

  // Use droppable hook for middle task area - only for cross-column task moves
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `${column.id}-middle`,
    data: {
      type: 'column-middle',
      columnId: column.id
    },
    // Keep the column body droppable during same-column task drags so dnd-kit
    // still has a target after long scrolls. Insert index comes from pointer Y.
    disabled: !!draggedColumn
  });

  // Simplified: Only one main droppable area per column
  // The precise positioning will be handled by task-to-task collision detection

  const style = {
    // CRITICAL: Prevent ALL columns from shifting during drag
    // Only the dragged column should move (via DragOverlay), all others stay in place
    // When dragging a column, rectSortingStrategy tries to shift other columns - we prevent this
    transform: (draggedColumn && draggedColumn.id !== column.id) 
      ? 'none'  // Other columns: no transform (stay in place)
      : (isDragging 
        ? 'none'  // Dragged column: no transform (shown in DragOverlay instead)
        : (transform &&
          (transform.x ||
            transform.y ||
            (transform.scaleX != null && transform.scaleX !== 1) ||
            (transform.scaleY != null && transform.scaleY !== 1))
          ? CSS.Transform.toString(transform)
          : undefined)),
    // CRITICAL: Disable transition during drag for smooth mouse following
    transition: (draggedColumn && draggedColumn.id !== column.id) || isDragging 
      ? 'none' 
      : transition,
    // Ensure smooth rendering during drag
    ...(isDragging || draggedColumn
      ? {
          backfaceVisibility: 'hidden' as const,
          WebkitBackfaceVisibility: 'hidden' as const,
        }
      : {}),
  };

  const stickyColumnHeaderEnabled = columnHeaderStickyTopPx != null && !isDragging;
  const {
    placeholderRef: columnHeaderPlaceholderRef,
    placeholderHeightPx: columnHeaderPlaceholderHeightPx,
    isStuck: isColumnHeaderStuck,
  } = useStickyKanbanColumnHeader(
    columnHeaderRef,
    columnElRef,
    columnHeaderStickyTopPx ?? 0,
    stickyColumnHeaderEnabled
  );
  const portalColumnHeader = stickyColumnHeaderEnabled && isColumnHeaderStuck;

  // Note: Now using filteredTasks prop instead of calculating here

  const handleTitleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Use refs to get latest values (in case auto-detection just ran)
    const currentTitle = titleRef.current;
    const currentIsFinished = isFinishedRef.current;
    const currentIsArchived = isArchivedRef.current;
    
    if (!currentTitle.trim() || isSubmitting) return;

    setIsSubmitting(true);
    await saveColumnEdits(
      currentTitle.trim(),
      currentIsFinished,
      currentIsArchived,
      wipLimitInputRef.current,
      policyTextRef.current
    );
    setIsEditing(false);
    setIsSubmitting(false);
  };

  // Handle immediate save when toggling checkboxes
  const handleFinishedToggle = async (checked: boolean) => {
    if (isSubmitting) return;
    
    setIsFinished(checked);
    if (checked) {
      setIsArchived(false); // Cannot be both
    }
    
    setIsSubmitting(true);
    lastSaveTimestampRef.current = Date.now(); // Mark that we just saved
    await saveColumnEdits(title.trim(), checked, checked ? false : isArchived);
    setIsSubmitting(false);
  };

  const handleArchivedToggle = async (checked: boolean) => {
    if (isSubmitting) return;
    
    setIsArchived(checked);
    if (checked) {
      setIsFinished(false); // Cannot be both
    }
    
    setIsSubmitting(true);
    lastSaveTimestampRef.current = Date.now(); // Mark that we just saved
    await saveColumnEdits(title.trim(), checked ? false : isFinished, checked);
    setIsSubmitting(false);
  };

  // Old HTML5 drag handlers removed - using @dnd-kit instead

  // Task drag handling moved to App level for cross-column support

  const handleAddTask = async () => {
    if (isSubmitting) return;
    const count = column.tasks?.length || 0;
    if (hasWipLimit(column.wip_limit)) {
      const status = getWipStatus(count + 1, column.wip_limit);
      if (status === 'at' || status === 'over') {
        // Soft warn only — still create the task
        const { toast } = await import('../utils/toast');
        toast.warning(
          t('column.wipSoftWarningTitle'),
          t('column.wipSoftWarningBody', {
            count: count + 1,
            limit: column.wip_limit,
            column: displayTitle,
          })
        );
      }
    }
    setIsSubmitting(true);
    await onAddTask(column.id);
    setIsSubmitting(false);
  };



  const tasksToRender = useMemo(
    () =>
      [...filteredTasks]
        .filter((task) => task && task.id)
        .sort((a, b) => {
          const pa = typeof a.position === 'number' ? a.position : parseFloat(String(a.position)) || 0;
          const pb = typeof b.position === 'number' ? b.position : parseFloat(String(b.position)) || 0;
          if (pa !== pb) return pa - pb;
          return String(a.id).localeCompare(String(b.id));
        }),
    [filteredTasks]
  );

  const originIndex = useMemo(() => {
    if (!draggedTask || draggedTask.columnId !== column.id) return -1;
    return tasksToRender.findIndex((t) => t.id === draggedTask.id);
  }, [tasksToRender, draggedTask, column.id]);

  const draggedLayoutIndices = useMemo(() => {
    const set = new Set<number>();
    if (!draggedTask || draggedTask.columnId !== column.id) return set;
    const ids =
      draggedTaskIds && draggedTaskIds.length > 0
        ? draggedTaskIds
        : [draggedTask.id];
    const idSet = new Set(ids);
    tasksToRender.forEach((t, i) => {
      if (idSet.has(t.id)) set.add(i);
    });
    return set;
  }, [tasksToRender, draggedTask, draggedTaskIds, column.id]);

  const remappedOriginInsert = useMemo(() => {
    if (originIndex < 0) return -1;
    let n = 0;
    for (let i = 0; i < originIndex; i++) {
      if (!draggedLayoutIndices.has(i)) n++;
    }
    return n;
  }, [originIndex, draggedLayoutIndices]);

  const orderedVisibleTaskIds = useMemo(
    () => tasksToRender.map((t) => t.id),
    [tasksToRender]
  );

  // Keep the dragged sortable mounted (unmounting it cancels dnd-kit after a few moves).
  const tasksForLayout = tasksToRender;

  const rawInsertIndex =
    draggedTask && dragPreview && dragPreview.targetColumnId === column.id
      ? dragPreview.insertIndex
      : -1;

  // No list hole while the pointer is still in the original slot — pickup overlay only.
  const showDestPlaceholder =
    rawInsertIndex >= 0 &&
    (draggedTask?.columnId !== column.id || rawInsertIndex !== remappedOriginInsert);

  const insertIndex = showDestPlaceholder ? rawInsertIndex : -1;

  const heightCacheRef = useRef<Map<string, number>>(new Map());
  const [heightVersion, setHeightVersion] = useState(0);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draggedTaskRef = useRef(draggedTask);
  draggedTaskRef.current = draggedTask;

  const MIN_CACHED_ROW_HEIGHT = 24;

  const reportRowHeight = useCallback((taskId: string, height: number) => {
    if (draggedTaskRef.current) return;
    if (!taskId || height < MIN_CACHED_ROW_HEIGHT) return;
    const prev = heightCacheRef.current.get(taskId);
    if (prev != null && Math.abs(prev - height) < 4) return;
    heightCacheRef.current.set(taskId, height);
    if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
    // Coalesce measure updates so we don't remount every ResizeObserver tick
    measureTimerRef.current = setTimeout(() => {
      measureTimerRef.current = null;
      setHeightVersion((v) => v + 1);
    }, 50);
  }, []);

  useEffect(() => {
    if (draggedTask) return;
    let changed = false;
    heightCacheRef.current.forEach((h, id) => {
      if (h < MIN_CACHED_ROW_HEIGHT) {
        heightCacheRef.current.delete(id);
        changed = true;
      }
    });
    if (changed) setHeightVersion((v) => v + 1);
  }, [draggedTask]);

  useEffect(() => {
    heightCacheRef.current.clear();
    setHeightVersion((v) => v + 1);
  }, [taskViewMode, column.id]);

  const remapLayoutIndex = useCallback(
    (index: number) => {
      if (draggedLayoutIndices.size === 0) return index;
      if (draggedLayoutIndices.has(index)) return -1;
      let subtracted = 0;
      draggedLayoutIndices.forEach((di) => {
        if (di < index) subtracted++;
      });
      return index - subtracted;
    },
    [draggedLayoutIndices]
  );

  const withoutDraggedCount =
    draggedLayoutIndices.size > 0
      ? Math.max(0, tasksForLayout.length - draggedLayoutIndices.size)
      : tasksForLayout.length;

  const collapseOrigin =
    draggedLayoutIndices.size > 0 &&
    !!draggedTask &&
    (showDestPlaceholder ||
      (!!dragPreview && dragPreview.targetColumnId !== column.id));

  const getItemSize = useCallback(
    (index: number) => {
      if (collapseOrigin && draggedLayoutIndices.has(index)) return 1;
      const task = tasksForLayout[index];
      const cached = task?.id ? heightCacheRef.current.get(task.id) : undefined;
      let height =
        (cached ?? estimateTaskContentHeight(taskViewMode)) + TASK_ROW_GAP_PX;
      const remapped = remapLayoutIndex(index);
      if (insertIndex >= 0 && remapped === insertIndex) {
        height += INSERTION_PREVIEW_HEIGHT_PX;
      }
      return height;
    },
    // heightVersion intentionally invalidates when measurements land
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      taskViewMode,
      insertIndex,
      tasksForLayout,
      heightVersion,
      collapseOrigin,
      draggedLayoutIndices,
      remapLayoutIndex,
    ]
  );

  const trailingHeight =
    insertIndex >= 0 && insertIndex >= withoutDraggedCount
      ? INSERTION_PREVIEW_HEIGHT_PX
      : 0;

  // Extra overscan during drag keeps neighbor columns populated as the page scrolls.
  const dragOverscan = draggedTask ? DRAG_OVERSCAN : undefined;

  const pinnedTaskIndex = useMemo(() => {
    if (!selectedTask?.id) return null;
    const idx = tasksForLayout.findIndex((t) => t.id === selectedTask.id);
    return idx >= 0 ? idx : null;
  }, [tasksForLayout, selectedTask?.id]);

  const virtualRange = useColumnVirtualRange({
    itemCount: tasksForLayout.length,
    getItemSize,
    containerRef: taskListRef,
    enabled: !(isDragging && draggedColumn?.id === column.id),
    forceFullRender: false,
    overscan: dragOverscan,
    trailingHeight,
    pinnedIndex: pinnedTaskIndex,
    layoutKey: `${column.id}:${tasksForLayout.length}:${taskViewMode}:${insertIndex}:${collapseOrigin ? 1 : 0}:${draggedLayoutIndices.size}:${pinnedTaskIndex ?? ''}:${heightVersion}`,
  });

  const renderTaskList = React.useCallback(() => {
    const taskElements: React.ReactNode[] = [];
    
    // PERFORMANCE OPTIMIZATION: When dragging a column, render a simplified placeholder
    // instead of all tasks to prevent rendering 100+ task cards during drag
    // NOTE: The column container itself will follow the mouse via transform,
    // this placeholder just reduces rendering cost
    // CRITICAL: Only show placeholder for the column being dragged, not others
    // Other columns need to render normally so rectSortingStrategy can transform them
    if (isDragging && draggedColumn && draggedColumn.id === column.id) {
      const taskCount = filteredTasks.length;
      return [
        <div
          key="column-drag-placeholder"
          className="flex flex-col items-center justify-center py-8 text-gray-500 dark:text-gray-400 pointer-events-none"
          style={{
            // Prevent blur/distortion
            imageRendering: 'crisp-edges',
            WebkitFontSmoothing: 'antialiased',
          }}
        >
          <div className="text-2xl mb-2">📋</div>
          <div className="text-sm font-medium">{displayTitle}</div>
          <div className="text-xs mt-1">{taskCount} {taskCount === 1 ? t('column.task') : t('column.tasks')}</div>
        </div>
      ];
    }

    const { startIndex, endIndex, totalHeight, offsetForIndex, windowed } = virtualRange;

    const pushTaskRow = (index: number, top: number | null) => {
      const task = tasksForLayout[index];
      if (!task) return;

      const memberList = Array.isArray(members) ? members : [];
      const member = resolveTaskMember(memberList, task.memberId) ?? null;

      const isBeingDragged =
        draggedTask?.id === task.id ||
        (!!draggedTaskIds && draggedTaskIds.includes(task.id));

      const rowStyle: React.CSSProperties | undefined =
        windowed && top != null
          ? {
              position: 'absolute',
              top,
              left: 0,
              right: 0,
            }
          : undefined;

      const skipYRow = draggedLayoutIndices.has(index);
      const layoutIndex = remapLayoutIndex(index);
      const showPlaceholderHere =
        insertIndex >= 0 && layoutIndex === insertIndex && !skipYRow;

      if (showPlaceholderHere) {
        taskElements.push(
          <div
            key={`insertion-preview-${index}`}
            data-kanban-drop-placeholder
            data-insert-index={insertIndex}
            className={`${windowed ? '' : 'mb-3'} pointer-events-none`}
            style={
              windowed && top != null
                ? {
                    position: 'absolute',
                    top,
                    left: 0,
                    right: 0,
                    height: INSERTION_PREVIEW_HEIGHT_PX,
                  }
                : undefined
            }
          >
            <ColumnDropHerePlaceholder label={t('column.dropHere')} />
          </div>
        );
      }

      const cardTop =
        windowed && top != null
          ? top + (showPlaceholderHere ? INSERTION_PREVIEW_HEIGHT_PX : 0)
          : null;

      const collapseThis = collapseOrigin && skipYRow;

      taskElements.push(
        <div
          key={task.id}
          {...(!skipYRow
            ? {
                'data-kanban-task-row': true,
                'data-task-id': task.id,
                'data-layout-index': layoutIndex,
              }
            : {})}
          className={`${windowed || collapseThis ? '' : 'mb-3'} ${isBeingDragged ? 'opacity-0' : 'opacity-100'}`}
          style={
            collapseThis
              ? {
                  position: windowed ? 'absolute' : 'relative',
                  top: windowed && top != null ? top : undefined,
                  left: 0,
                  right: 0,
                  height: 1,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  margin: 0,
                  padding: 0,
                }
              : windowed && cardTop != null
                ? {
                    position: 'absolute',
                    top: cardTop,
                    left: 0,
                    right: 0,
                    marginBottom: 0,
                    paddingBottom: TASK_ROW_GAP_PX,
                    boxSizing: 'content-box',
                  }
                : rowStyle
          }
          ref={(node) => {
            if (!node) return;
            // Measure content only (exclude our paddingBottom gap)
            const h = node.offsetHeight - (windowed ? TASK_ROW_GAP_PX : 0);
            if (h > 0) reportRowHeight(task.id, h);
          }}
        >
          <TaskCard
            task={task}
            member={member}
            members={members}
            currentUser={currentUser}
            onRemove={onRemoveTask}
            onEdit={onEditTask}
            onCopy={onCopyTask}
            onDragStart={onTaskDragStart}
            onDragEnd={onTaskDragEnd}
            onSelect={onSelectTask}
            siteSettings={siteSettings}
            columnIsFinished={column.is_finished || false}
            columnIsArchived={column.is_archived || false}
            isDragDisabled={!!draggedColumn || !canMutate}
            isColumnBeingDragged={!!draggedColumn}
            taskViewMode={taskViewMode}
            availablePriorities={availablePriorities}
            selectedTask={selectedTask}
            availableTags={availableTags}
            onTagAdd={onTagAdd ? onTagAdd(task.id) : undefined}
            onTagRemove={onTagRemove ? onTagRemove(task.id) : undefined}
            boards={boards}
            columns={columns}
            selectedSprintId={selectedSprintId}
            availableSprints={availableSprints}
            isChecked={!!checkedTaskIds?.has(task.id)}
            isNewlyCreatedHighlight={highlightedNewTaskId === task.id}
            onToggleChecked={
              canMutate && onToggleTaskChecked
                ? (options) =>
                    onToggleTaskChecked(task.id, {
                      range: options?.range,
                      orderedIds: orderedVisibleTaskIds,
                    })
                : undefined
            }
            isMultiSelectDragLocked={isMultiSelectDragLocked}
            canMutate={canMutate}
            isLinkingMode={isLinkingMode}
            linkingSourceTask={linkingSourceTask}
            onStartLinking={onStartLinking}
            onFinishLinking={onFinishLinking}
            hoveredLinkTask={hoveredLinkTask}
            onLinkToolHover={onLinkToolHover}
            onLinkToolHoverEnd={onLinkToolHoverEnd}
            getTaskRelationshipType={getTaskRelationshipType}
            onUnlinkRelatedTask={onUnlinkRelatedTask}
            relationSummary={getTaskRelationshipSummary(relationSummaryByTaskId, task.id)}
          />
        </div>
      );
    };

    for (let index = startIndex; index < endIndex; index++) {
      pushTaskRow(index, windowed ? offsetForIndex(index) : null);
    }

    if (insertIndex >= withoutDraggedCount) {
      const top = windowed ? offsetForIndex(tasksForLayout.length) : null;
      if (!windowed || (endIndex >= tasksForLayout.length && top != null)) {
        taskElements.push(
          <div
            key="insertion-preview-end"
            data-kanban-drop-placeholder
            data-insert-index={insertIndex}
            className={`${windowed ? '' : 'mb-3'} pointer-events-none`}
            style={
              windowed && top != null
                ? {
                    position: 'absolute',
                    top,
                    left: 0,
                    right: 0,
                    height: INSERTION_PREVIEW_HEIGHT_PX,
                  }
                : undefined
            }
          >
            <ColumnDropHerePlaceholder label={t('column.dropHere')} />
          </div>
        );
      }
    }

    if (windowed) {
      return [
        <div
          key="virtual-list-root"
          style={{ position: 'relative', height: totalHeight, width: '100%' }}
        >
          {taskElements}
        </div>,
      ];
    }

    return taskElements;
    }, [filteredTasks, members, onRemoveTask, onEditTask, onCopyTask, onTaskDragStart, onTaskDragEnd, onSelectTask, draggedTask, dragPreview, column.id, displayTitle, isDragging, t, taskViewMode, currentUser, siteSettings, column.is_finished, column.is_archived, draggedColumn, availablePriorities, selectedTask, availableTags, onTagAdd, onTagRemove, boards, columns, selectedSprintId, availableSprints, isLinkingMode, linkingSourceTask, onStartLinking, onFinishLinking, hoveredLinkTask, onLinkToolHover, onLinkToolHoverEnd, getTaskRelationshipType, onUnlinkRelatedTask, relationSummaryByTaskId, checkedTaskIds, onToggleTaskChecked, isMultiSelectDragLocked, draggedTaskIds, tasksForLayout, insertIndex, originIndex, draggedLayoutIndices, collapseOrigin, remapLayoutIndex, withoutDraggedCount, virtualRange, canMutate, reportRowHeight, orderedVisibleTaskIds]);

  const setColumnRef = (node: HTMLElement | null) => {
    columnElRef.current = node;
    setNodeRef(node);
    setColumnDroppableRef(node);
  };

  const unfilteredTaskCount = column.tasks?.length || 0;
  // Always match visible cards (includes sprint filter even when search filters are off)
  const displayedTaskCount = filteredTasks.length;
  const columnWipStatus = getWipStatus(unfilteredTaskCount, column.wip_limit);
  const showWipMeter = hasWipLimit(column.wip_limit);
  const showTaskCountChrome = showColumnTaskCounts(siteSettings);
  const showEffortChrome = showColumnEffort(siteSettings);
  const showTaskCount = showTaskCountChrome && (displayedTaskCount > 0 || showWipMeter);
  const taskCountPillClass = `${taskCountPillToneClass(columnWipStatus)} ${taskCountPillWeightClass(hasActiveFilters)}`;
  const taskCountLabel = showWipMeter
    ? t('column.wipMeterTooltip', {
        count: hasActiveFilters ? displayedTaskCount : unfilteredTaskCount,
        limit: column.wip_limit,
      })
    : t('column.taskCount');
  // WIP meter: when filters (incl. sprint) are active, show visible count vs limit;
  // capacity coloring still uses unfiltered WIP above.
  const taskCountDisplay = showWipMeter
    ? `${hasActiveFilters ? displayedTaskCount : unfilteredTaskCount} / ${column.wip_limit}`
    : displayedTaskCount;
  const taskCountBadge = showTaskCount ? (
    <span
      className={`${TASK_COUNT_PILL_BASE} ${taskCountPillClass}`}
      aria-label={taskCountLabel}
    >
      {taskCountDisplay}
    </span>
  ) : null;

  return (
    <div 
      ref={setColumnRef}
      style={{
        ...style,
        // CRITICAL: Ensure column container can receive pointer events even when tasks cover it
        // This is essential for column-to-column drops when there are many tasks
        position: 'relative',
        zIndex: isDragging ? 1000 : 'auto',
        // CRITICAL: When dragging, hide the original column (it's shown in DragOverlay)
        // Other columns stay visible and in place - no shifting
        opacity: isDragging ? 0.3 : 1,
        // Ensure the column can be transformed (not fixed position)
        willChange: isDragging ? 'transform' : 'auto',
        // Prevent blur/distortion during drag
        imageRendering: isDragging ? 'crisp-edges' : 'auto',
        WebkitFontSmoothing: isDragging ? 'antialiased' : 'auto',
      }}
      className={`sortable-item column-container rounded-lg p-4 flex flex-col min-h-[200px] ${
        isDragging ? 'cursor-grabbing' : 'transition-all duration-200 ease-in-out'
      } ${
        (isOver && draggedTask && draggedTask.columnId !== column.id) || 
        (isColumnOver && draggedColumn && draggedColumn.id !== column.id)
          ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900 border-2 border-blue-400' 
          : 'border border-transparent'
      }`}
      {...attributes}
    >
      {/* Column warning: new task hidden by sprint / filters — strings from i18n so language switches apply */}
      {visibilityWarning && (
        <div className="mb-3 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-600 text-yellow-800 dark:text-yellow-200 px-3 py-2 rounded-md text-sm flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <span className="text-yellow-600 flex-shrink-0">⚠️</span>
              <p className="font-medium leading-snug">
                {t('column.taskHiddenByFilters', { filterList: hiddenTaskFilterList })}
              </p>
            </div>
            {onDismissColumnWarning && (
              <KanbanChromeTooltip label={t('column.dismissWarning')} wrapperClassName="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onDismissColumnWarning(column.id)}
                  className="text-yellow-600 hover:text-yellow-800 transition-colors"
                >
                  <X size={16} />
                </button>
              </KanbanChromeTooltip>
            )}
          </div>
          {visibilityWarning.showSprintPrompt && visibilityWarning.selectedSprintId && (
            <div className="pl-7 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
              <p className="text-sm flex-1 min-w-0">
                {t('column.sprintAssignPrompt', { sprintName: selectedSprintName })}
              </p>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  type="button"
                  disabled={sprintAssignBusy}
                  onClick={async () => {
                    if (!onAssignCreatedTaskToSprint || !visibilityWarning.selectedSprintId) return;
                    setSprintAssignBusy(true);
                    try {
                      await onAssignCreatedTaskToSprint(
                        column.id,
                        visibilityWarning.taskId,
                        visibilityWarning.selectedSprintId
                      );
                    } finally {
                      setSprintAssignBusy(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-yellow-700 text-white text-xs font-medium hover:bg-yellow-800 disabled:opacity-50"
                >
                  {t('column.yesAssignToSprint')}
                </button>
                <button
                  type="button"
                  disabled={sprintAssignBusy}
                  onClick={() => onDismissColumnWarning?.(column.id)}
                  className="px-2.5 py-1 rounded-md border border-yellow-600 text-yellow-900 dark:text-yellow-100 text-xs font-medium hover:bg-yellow-200/50 dark:hover:bg-yellow-800/50"
                >
                  {t('column.noKeepUnassigned')}
                </button>
              </div>
            </div>
          )}
          {visibilityWarning.showClearFilters && onClearFiltersForHiddenTask && (
            <div className="pl-7">
              <button
                type="button"
                onClick={() => onClearFiltersForHiddenTask()}
                className="px-2.5 py-1 rounded-md bg-white/80 dark:bg-yellow-950/40 border border-yellow-500 text-yellow-900 dark:text-yellow-100 text-xs font-medium hover:bg-yellow-50 dark:hover:bg-yellow-900/60"
              >
                {t('column.clearFiltersButton')}
              </button>
            </div>
          )}
        </div>
      )}
      
      {(() => {
        const columnHeaderNode = (
      <div
        ref={columnHeaderRef}
        className="relative z-20 flex flex-col overflow-visible"
        style={
          portalColumnHeader
            ? { ...KANBAN_COLUMN_HEADER_PORTAL_STYLE, zIndex: isEditing ? 40 : 30 }
            : undefined
        }
        data-column-header
        data-kanban-column-title
        data-kanban-header-column-id={column.id}
      >
        <div className={`flex justify-between ${isEditing ? 'items-start' : 'items-center'}`}>
        <div className={`flex gap-2 flex-1 min-w-0 ${isEditing ? 'items-start' : 'items-center h-6'}`}>
          {/* Task count pill (same chrome for all roles). Admins: hover reveals drag handle. */}
          {isAdmin ? (
            <KanbanChromeTooltip
              label={t('column.clickToEditDragToReorder')}
              wrapperClassName={`relative inline-flex shrink-0 items-center ${isEditing ? 'mt-2' : ''}`}
            >
              <div
                {...listeners}
                className={`group/column-handle relative flex h-5 min-w-[1.25rem] cursor-grab items-center justify-center rounded px-0.5 transition-colors hover:bg-gray-200 active:cursor-grabbing dark:hover:bg-gray-700 ${
                  !isEditing && taskCountBadge ? '' : 'w-5 p-1 opacity-50 hover:opacity-100'
                }`}
              >
                {!isEditing && taskCountBadge ? (
                  <>
                    <div className="transition-opacity group-hover/column-handle:invisible group-hover/column-handle:opacity-0">
                      {taskCountBadge}
                    </div>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/column-handle:opacity-100">
                      <GripVertical size={12} className="text-gray-400" aria-hidden />
                    </div>
                  </>
                ) : (
                  <GripVertical size={12} className="text-gray-400" aria-hidden />
                )}
              </div>
            </KanbanChromeTooltip>
          ) : (
            !isEditing &&
            taskCountBadge && (
              <KanbanChromeTooltip
                label={taskCountLabel}
                wrapperClassName="relative inline-flex shrink-0 items-center"
              >
                {taskCountBadge}
              </KanbanChromeTooltip>
            )
          )}
          {isEditing ? (
            <form
              onSubmit={handleTitleSubmit}
              className="flex-1 min-w-0 space-y-3 rounded-lg border border-gray-200 bg-white p-2.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={editInputRef}
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={COLUMN_TITLE_MAX_LENGTH}
                className={formFieldClass(false, { widthClass: 'w-full' })}
                autoFocus
                disabled={isSubmitting}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTitle(displayTitle);
                    setIsFinished(column.is_finished || false);
                    setIsArchived(column.is_archived || false);
                    setWipLimitInput(column.wip_limit != null ? String(column.wip_limit) : '');
                    setPolicyText(column.policy_text || '');
                    setIsEditing(false);
                  }
                }}
              />
              
              {/* Finished Column Toggle */}
              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border dark:border-gray-600">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('column.markAsFinishedColumn')}</span>
                  {isFinished && siteSettings?.DEFAULT_FINISHED_COLUMN_NAMES && (() => {
                    const finishedColumnNames = parseFinishedColumnNames(siteSettings.DEFAULT_FINISHED_COLUMN_NAMES);
                    const isAutoDetected = finishedColumnNames.some(finishedName => 
                      finishedName.toLowerCase() === title.toLowerCase()
                    );
                    return isAutoDetected ? (
                      <span className="text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-2 py-1 rounded-full">
                        {t('column.autoDetected')}
                      </span>
                    ) : null;
                  })()}
                  {isSubmitting && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('column.saving')}</span>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFinished}
                    onChange={(e) => handleFinishedToggle(e.target.checked)}
                    className="sr-only peer"
                    disabled={isSubmitting}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                </label>
              </div>
              
              {/* Archived Column Toggle */}
              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border dark:border-gray-600">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('column.markAsArchivedColumn')}</span>
                  {isArchived && title.toLowerCase() === 'archive' && (
                    <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
                      {t('column.autoDetected')}
                    </span>
                  )}
                  {isSubmitting && (
                    <span className="text-xs text-gray-500">{t('column.saving')}</span>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isArchived}
                    onChange={(e) => handleArchivedToggle(e.target.checked)}
                    className="sr-only peer"
                    disabled={isSubmitting}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
                </label>
              </div>

              {/* Soft WIP limit — label wraps; input + clear stay together */}
              {!isFinished && !isArchived && (
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border dark:border-gray-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor={`column-wip-${column.id}`}
                      className="text-sm font-medium text-gray-700 dark:text-gray-200 min-w-0 basis-[min(100%,11rem)] grow inline-flex items-center gap-1"
                    >
                      <span className="min-w-0 break-words">{t('column.wipLimit')}</span>
                      <KanbanChromeTooltip label={t('column.wipLimitHint')}>
                        <span
                          className="inline-flex shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help"
                          aria-label={t('column.wipLimitHint')}
                        >
                          <HelpCircle size={14} />
                        </span>
                      </KanbanChromeTooltip>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      <input
                        id={`column-wip-${column.id}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={wipLimitInput}
                        onChange={(e) => setWipLimitInput(e.target.value)}
                        className={formFieldClass(false, {
                          widthClass: 'w-[2.75rem] shrink-0 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                        })}
                        disabled={isSubmitting}
                      />
                      {!!String(wipLimitInput).trim() && (
                        <KanbanChromeTooltip label={t('column.clearWipLimit')}>
                          <button
                            type="button"
                            onClick={() => setWipLimitInput('')}
                            disabled={isSubmitting}
                            className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            aria-label={t('column.clearWipLimit')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </KanbanChromeTooltip>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Column policy */}
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border dark:border-gray-600 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`column-policy-${column.id}`}
                    className="text-sm font-medium text-gray-700 dark:text-gray-200"
                  >
                    {t('column.policyText')}
                  </label>
                  {!!policyText.trim() && (
                    <KanbanChromeTooltip label={t('column.clearPolicy')}>
                      <button
                        type="button"
                        onClick={() => setPolicyText('')}
                        disabled={isSubmitting}
                        className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        aria-label={t('column.clearPolicy')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </KanbanChromeTooltip>
                  )}
                </div>
                <textarea
                  id={`column-policy-${column.id}`}
                  value={policyText}
                  onChange={(e) => setPolicyText(e.target.value)}
                  rows={2}
                  maxLength={COLUMN_POLICY_MAX_LENGTH}
                  placeholder={t('column.policyTextPlaceholder')}
                  className={formFieldClass(false, { widthClass: 'w-full', extra: 'text-sm resize-y' })}
                  disabled={isSubmitting}
                />
              </div>
              
              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setTitle(displayTitle);
                    setIsFinished(column.is_finished || false);
                    setIsArchived(column.is_archived || false);
                    setWipLimitInput(column.wip_limit != null ? String(column.wip_limit) : '');
                    setPolicyText(column.policy_text || '');
                    setIsEditing(false);
                  }}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                >
                  {t('buttons.cancel', { ns: 'common' })}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !title.trim()}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors"
                >
                  {isSubmitting ? t('column.saving') : t('buttons.save', { ns: 'common' })}
                </button>
              </div>
            </form>
          ) : (
            <>
              {(() => {
                const titleEl = (
                  <h3
                    data-column-title
                    className={`text-lg font-semibold leading-6 text-gray-700 dark:text-gray-100 select-none truncate ${
                      isAdmin && showColumnDeleteConfirm === null
                        ? 'cursor-pointer hover:text-gray-900 dark:hover:text-white'
                        : 'cursor-default'
                    }`}
                    onClick={() => {
                      if (isAdmin) {
                        setShouldSelectAll(true);
                        setIsEditing(true);
                      }
                    }}
                  >
                    {displayTitle}
                  </h3>
                );
                if (!isAdmin) return <div className="min-w-0">{titleEl}</div>;
                return (
                  <KanbanChromeTooltip
                    label={
                      showColumnDeleteConfirm !== null
                        ? t('column.draggingDisabledDuringConfirmation')
                        : t('column.clickToEditDragToReorder')
                    }
                    wrapperClassName="min-w-0"
                  >
                    {titleEl}
                  </KanbanChromeTooltip>
                );
              })()}
              {(['at', 'over'] as const).includes(
                getWipStatus(column.tasks?.length || 0, column.wip_limit) as 'at' | 'over'
              ) && (
                <KanbanChromeTooltip label={t('column.wipOverLimit')} wrapperClassName="shrink-0">
                  <span className="inline-flex text-amber-500 dark:text-amber-400" aria-label={t('column.wipOverLimit')}>
                    <AlertTriangle size={16} />
                  </span>
                </KanbanChromeTooltip>
              )}
              {showEffortChrome && columnEffort > 0 && (
                <KanbanChromeTooltip
                  label={t('column.totalEffortTooltip', { display: effortDisplay })}
                  wrapperClassName="relative inline-flex shrink-0 items-center"
                >
                  <span
                    className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-violet-100 px-1.5 text-center text-[0.65rem] font-medium leading-none tabular-nums text-violet-700 select-none pointer-events-none dark:bg-violet-900/50 dark:text-violet-200"
                    aria-label={t('column.totalEffortTooltip', { display: effortDisplay })}
                  >
                    {effortDisplay}
                  </span>
                </KanbanChromeTooltip>
              )}
              {canMutate && (
              <KanbanChromeTooltip label={!isOnline ? t('column.networkOffline') : t('column.addTask')}>
                <button
                  data-column-header
                  onClick={handleAddTask}
                  disabled={isSubmitting || !isOnline}
                  className={`p-1 rounded-full transition-colors ${
                    !isSubmitting && isOnline
                      ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                  data-tour-id="add-task-button"
                >
                  <Plus size={18} />
                </button>
              </KanbanChromeTooltip>
              )}
            </>
          )}
        </div>
        
        {/* Right chrome: archive · policy · admin menu — top-aligned when editing */}
        <div className={`flex shrink-0 gap-0.5 ${isEditing ? 'items-start mt-1.5' : 'items-center'}`}>
          {!!column.is_archived && (
            <KanbanChromeTooltip label={t('column.archivedColumn')}>
              <span className="inline-flex p-1">
                <Archive size={16} className="text-orange-500 dark:text-orange-400" />
              </span>
            </KanbanChromeTooltip>
          )}

          {!isEditing && !!column.policy_text?.trim() && (
            <KanbanChromeTooltip
              label={column.policy_text.trim()}
              widthAnchorRef={columnElRef}
            >
              <span
                className="inline-flex p-1 text-gray-500 dark:text-gray-400"
                aria-label={t('column.policyText')}
              >
                <ScrollText size={16} />
              </span>
            </KanbanChromeTooltip>
          )}
        
          {/* Column Management Menu - Admin Only (menu portaled so Select-all strip cannot clip it) */}
          {isAdmin && (
            <div className="relative column-menu-container flex items-center">
              <KanbanChromeTooltip label={t('column.columnManagementOptions')}>
                <button
                  ref={columnMenuButtonRef}
                  type="button"
                  onClick={() => {
                    if (showMenu) {
                      setShowMenu(false);
                      setColumnMenuPosition(null);
                    } else {
                      openColumnMenu();
                    }
                  }}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  disabled={isSubmitting}
                  data-tour-id="column-management-menu"
                  aria-expanded={showMenu}
                  aria-haspopup="menu"
                >
                  <MoreVertical size={18} className="text-gray-500 dark:text-gray-400" />
                </button>
              </KanbanChromeTooltip>

              {showMenu &&
                columnMenuPosition &&
                createPortal(
                  <div
                    className="column-management-menu-portal fixed w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg z-[10000] border border-gray-100 dark:border-gray-700"
                    style={{ top: columnMenuPosition.top, left: columnMenuPosition.left }}
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShouldSelectAll(true);
                        setIsEditing(true);
                        setShowMenu(false);
                        setColumnMenuPosition(null);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={isSubmitting}
                    >
                      {t('column.editColumn')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onAddColumn(column.id);
                        setShowMenu(false);
                        setColumnMenuPosition(null);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={isSubmitting}
                    >
                      {t('column.addColumn')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      ref={setDeleteButtonRef}
                      onClick={() => {
                        const liveCount = getColumnTaskCount
                          ? getColumnTaskCount(column.id)
                          : column.tasks?.length || 0;
                        if (liveCount > 0) return;
                        onRemoveColumn(column.id);
                        setShowMenu(false);
                        setColumnMenuPosition(null);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        (getColumnTaskCount
                          ? getColumnTaskCount(column.id)
                          : column.tasks?.length || 0) > 0
                          ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                          : 'text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      disabled={
                        isSubmitting ||
                        (getColumnTaskCount
                          ? getColumnTaskCount(column.id)
                          : column.tasks?.length || 0) > 0
                      }
                      title={
                        (getColumnTaskCount
                          ? getColumnTaskCount(column.id)
                          : column.tasks?.length || 0) > 0
                          ? t('column.deleteColumnMustBeEmpty')
                          : undefined
                      }
                    >
                      {t('column.deleteColumn')}
                    </button>
                  </div>,
                  document.body
                )}
            </div>
          )}
        </div>
        </div>
        {draggedColumn && draggedColumn.id !== column.id && (
          <div
            ref={setTopDropZoneRef}
            className={`mt-2 transition-all duration-200 min-h-[48px] ${
              isTopDropZoneOver ? 'opacity-100' : 'opacity-40'
            }`}
          >
            <div
              className={`bg-blue-100 dark:bg-blue-900 border-2 border-dashed rounded-lg flex items-center justify-center py-2 px-4 transition-all duration-200 ${
                isTopDropZoneOver
                  ? 'border-blue-500 dark:border-blue-400 shadow-lg scale-105'
                  : 'border-blue-300 dark:border-blue-700'
              }`}
            >
              <div
                className={`text-sm font-medium flex items-center gap-2 transition-colors ${
                  isTopDropZoneOver
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                <div className={`w-2 h-2 bg-blue-500 rounded-full ${isTopDropZoneOver ? 'animate-pulse' : ''}`} />
                {t('column.dropColumnHere', { ns: 'tasks' })}
                <div className={`w-2 h-2 bg-blue-500 rounded-full ${isTopDropZoneOver ? 'animate-pulse' : ''}`} />
              </div>
            </div>
          </div>
        )}
        {canMutate &&
          checkedTaskIds &&
          shouldShowColumnBulkFab(checkedTaskIds, filteredTasks) &&
          onBulkCopy &&
          onBulkDelete && (
            <ColumnBulkActionBar
              columnId={column.id}
              selectedCount={checkedTaskIds.size}
              selectedTasks={Array.from(checkedTaskIds)
                .map((id) => {
                  const inFiltered = filteredTasks.find((t) => t.id === id);
                  if (inFiltered) return inFiltered;
                  if (columns) {
                    for (const col of Object.values(columns)) {
                      const found = col.tasks?.find((t) => t.id === id);
                      if (found) return found;
                    }
                  }
                  return undefined;
                })
                .filter((t): t is Task => Boolean(t))}
              members={members}
              showUnselectAll={checkedTaskIds.size > 1}
              isAdmin={isAdmin}
              hasArchiveColumn={
                !!columns &&
                Object.values(columns).some((col) => isArchivedColumnFlag(col)) &&
                !isArchivedColumnFlag(column)
              }
              availableTags={availableTags}
              availablePriorities={availablePriorities}
              availableSprints={availableSprints}
              boards={(boards as Board[]) || []}
              currentBoardId={selectedBoardId}
              busy={bulkBusy}
              onUnselectAll={() => onClearAllChecked?.()}
              onAddTag={(tagId) =>
                onBulkAddTag?.(Array.from(checkedTaskIds), tagId)
              }
              onCopy={() => onBulkCopy(Array.from(checkedTaskIds))}
              onArchive={() => onBulkArchive?.(Array.from(checkedTaskIds))}
              onDelete={() => onBulkDelete(Array.from(checkedTaskIds))}
              onPermanentDelete={
                onBulkPermanentDelete
                  ? () => onBulkPermanentDelete(Array.from(checkedTaskIds))
                  : undefined
              }
              onSprint={(sprintId) =>
                onBulkSprint?.(Array.from(checkedTaskIds), sprintId)
              }
              onPriority={(priorityId) =>
                onBulkPriority?.(Array.from(checkedTaskIds), priorityId)
              }
              onMoveToBoard={(boardId) =>
                onBulkMoveToBoard?.(Array.from(checkedTaskIds), boardId)
              }
              onAssignee={
                onBulkAssignee
                  ? (memberId) => onBulkAssignee(Array.from(checkedTaskIds), memberId)
                  : undefined
              }
              onRequester={
                onBulkRequester
                  ? (memberId) => onBulkRequester(Array.from(checkedTaskIds), memberId)
                  : undefined
              }
              onAddWatcher={
                onBulkAddWatcher
                  ? (memberId) => onBulkAddWatcher(Array.from(checkedTaskIds), memberId)
                  : undefined
              }
              onRemoveWatcher={
                onBulkRemoveWatcher
                  ? (memberId) => onBulkRemoveWatcher(Array.from(checkedTaskIds), memberId)
                  : undefined
              }
              onAddCollaborator={
                onBulkAddCollaborator
                  ? (memberId) => onBulkAddCollaborator(Array.from(checkedTaskIds), memberId)
                  : undefined
              }
              onRemoveCollaborator={
                onBulkRemoveCollaborator
                  ? (memberId) =>
                      onBulkRemoveCollaborator(Array.from(checkedTaskIds), memberId)
                  : undefined
              }
            />
          )}
        {checkedTaskIds &&
          onBulkUndo &&
          shouldShowColumnBulkUndo(
            bulkUndoTaskIds,
            filteredTasks,
            checkedTaskIds.size,
            bulkUndoAnchorColumnIds,
            column.id
          ) && (
            <ColumnBulkUndoFab
              columnId={column.id}
              count={bulkUndoTaskIds?.length || 0}
              busy={bulkBusy}
              labelKey={bulkUndoLabelKey}
              onUndo={onBulkUndo}
              onDismiss={() => onClearBulkUndo?.()}
            />
          )}
      </div>
        );
        return (
          <>
            <div
              ref={columnHeaderPlaceholderRef}
              className="mb-4"
              style={
                portalColumnHeader
                  ? { height: columnHeaderPlaceholderHeightPx || undefined }
                  : undefined
              }
            >
              {portalColumnHeader ? null : columnHeaderNode}
            </div>
            {portalColumnHeader ? createPortal(columnHeaderNode, document.body) : null}
          </>
        );
      })()}

      <div className="flex-1 min-h-[150px]">
        {/* Calculate if this column is truly empty (excluding dragged task) */}
        {(() => {
          const originalTaskCount = draggedTask 
            ? filteredTasks.filter(task => task.id !== draggedTask.id).length
            : filteredTasks.length;
          // CRITICAL FIX: Don't switch to empty mode if the dragged task is from THIS column
          // This prevents losing the SortableContext and activeData.type
          const isDraggingFromThisColumn = draggedTask?.columnId === column.id;
          return originalTaskCount === 0 && !isDraggingFromThisColumn ? true : false;
        })() ? (
          /* Empty column - no SortableContext to avoid interference */
          <div className="min-h-[100px] pb-4">
            <div 
              ref={setDroppableRef}
              className={`h-full w-full min-h-[200px] flex flex-col items-center justify-center transition-all duration-200 ${
              draggedTask && draggedTask.columnId !== column.id 
                ? `border-4 border-dashed rounded-lg ${
                    isOver ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-500 scale-105 shadow-lg' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500'
                  }` 
                : 'border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}>
                              {draggedTask && draggedTask.columnId !== column.id ? (
                  <div className={`text-center transition-all duration-200 ${
                    isOver ? 'text-blue-800 dark:text-blue-200 scale-110' : 'text-blue-600 dark:text-blue-400'
                  }`}>
                    <div className={`text-4xl mb-2 ${isOver ? 'animate-bounce' : ''}`}>📋</div>
                    <div className="font-semibold text-lg">
                      {isOver ? t('column.dropTaskHere') : t('column.dropZone')}
                    </div>
                    {isOver && <div className="text-sm opacity-75 mt-1">{t('column.releaseToPlace')}</div>}
                  </div>
                ) : (
                  <div className="text-gray-400 dark:text-gray-500 text-center px-3 py-4 space-y-2">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {t('column.emptyColumnTitle')}
                    </p>
                    {canMutate && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleAddTask();
                      }}
                      disabled={isSubmitting || !isOnline}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                        !isSubmitting && isOnline
                          ? 'text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-500 hover:text-white dark:hover:text-white hover:bg-blue-600 hover:border-solid hover:border-blue-600 dark:hover:bg-blue-600 dark:hover:border-blue-600'
                          : 'text-gray-400 cursor-not-allowed border border-dashed border-gray-200 dark:border-gray-600'
                      }`}
                      data-tour-id="empty-column-add-task"
                    >
                      <Plus size={12} />
                      {t('column.addTask')}
                    </button>
                    )}
                  </div>
                )}
            </div>
          </div>
        ) : (
          /* Column with tasks - use SortableContext */
          <SortableContext
            items={[...filteredTasks]
              .filter(task => task && task.id) // Filter out null/undefined tasks
              .sort((a, b) => (a.position || 0) - (b.position || 0))
              .map(task => task.id) // Use filtered tasks to match what's actually rendered
            }
            strategy={verticalListSortingStrategy}
          >
            {/* Simplified main task area - single droppable zone */}
            <div 
              ref={setDroppableRef}
              className={`min-h-[200px] pb-4 flex-1 transition-colors duration-200 ${
                isOver ? 'bg-blue-50 dark:bg-blue-900/20 rounded-lg' : ''
              }`}
              style={{
                // CRITICAL: Ensure column droppable can receive pointer events even when tasks cover it
                // This allows column-to-column drops to work when there are many tasks
                pointerEvents: draggedColumn ? 'auto' : 'auto',
                position: 'relative',
                zIndex: draggedColumn ? 1 : 'auto',
              }}
            >
              {/* Top/bottom hit targets only while dragging a task — fixed h-16 in flow caused a permanent gap under headers */}
              {draggedTask && !draggedColumn && (
                <>
                  <TaskTopDropZone columnId={column.id} />
                  <BottomDropZone columnId={column.id} />
                </>
              )}
              <div
                ref={taskListRef}
                data-kanban-task-list
                data-layout-count={withoutDraggedCount}
              >
                {renderTaskList()}
              </div>
            </div>
          </SortableContext>
        )}
      </div>

    </div>
  );
}

/** Skip re-renders when drag preview targets another column (large boards). */
function areKanbanColumnPropsEqual(
  prev: KanbanColumnProps,
  next: KanbanColumnProps
): boolean {
  if (prev.filteredTasks !== next.filteredTasks) return false;
  if (prev.column !== next.column) {
    if (
      prev.column.id !== next.column.id ||
      prev.column.position !== next.column.position ||
      prev.column.title !== next.column.title ||
      prev.column.wip_limit !== next.column.wip_limit ||
      prev.column.policy_text !== next.column.policy_text ||
      prev.column.is_finished !== next.column.is_finished ||
      prev.column.is_archived !== next.column.is_archived
    ) {
      return false;
    }
  }
  if (prev.draggedTask?.id !== next.draggedTask?.id) return false;
  if (prev.draggedColumn?.id !== next.draggedColumn?.id) return false;

  const prevPreview =
    prev.dragPreview?.targetColumnId === prev.column.id ? prev.dragPreview : null;
  const nextPreview =
    next.dragPreview?.targetColumnId === next.column.id ? next.dragPreview : null;
  if (
    prevPreview?.insertIndex !== nextPreview?.insertIndex ||
    !!prevPreview !== !!nextPreview
  ) {
    return false;
  }

  if (prev.selectedTask?.id !== next.selectedTask?.id) return false;
  if (prev.checkedTaskIds !== next.checkedTaskIds) return false;
  if (prev.draggedTaskIds !== next.draggedTaskIds) return false;
  if (prev.members !== next.members) return false;
  if (prev.columns !== next.columns) return false;
  if (prev.taskViewMode !== next.taskViewMode) return false;
  if (prev.canMutate !== next.canMutate) return false;
  if (prev.isAdmin !== next.isAdmin) return false;
  if (prev.isMultiSelectDragLocked !== next.isMultiSelectDragLocked) return false;
  if (prev.selectedSprintId !== next.selectedSprintId) return false;
  if (prev.isLinkingMode !== next.isLinkingMode) return false;
  if (prev.linkingSourceTask?.id !== next.linkingSourceTask?.id) return false;
  if (prev.hoveredLinkTask?.id !== next.hoveredLinkTask?.id) return false;
  if (prev.relationSummaryByTaskId !== next.relationSummaryByTaskId) return false;
  if (prev.availablePriorities !== next.availablePriorities) return false;
  if (prev.availableTags !== next.availableTags) return false;
  if (prev.availableSprints !== next.availableSprints) return false;
  if (prev.boards !== next.boards) return false;
  if (prev.siteSettings !== next.siteSettings) return false;
  if (prev.columnWarnings !== next.columnWarnings) return false;
  if (prev.showColumnDeleteConfirm !== next.showColumnDeleteConfirm) return false;
  if (prev.bulkUndoTaskIds !== next.bulkUndoTaskIds) return false;
  if (prev.bulkUndoLabelKey !== next.bulkUndoLabelKey) return false;
  if (prev.bulkUndoAnchorColumnIds !== next.bulkUndoAnchorColumnIds) return false;
  if (prev.bulkBusy !== next.bulkBusy) return false;
  if (prev.currentUser !== next.currentUser) return false;
  if (prev.selectedMembers !== next.selectedMembers) return false;
  if (prev.selectedBoardId !== next.selectedBoardId) return false;
  if (prev.columnHeaderStickyTopPx !== next.columnHeaderStickyTopPx) return false;

  return true;
}

export default React.memo(KanbanColumn, areKanbanColumnPropsEqual);

function ColumnDropHerePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-16 items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-blue-100 dark:border-blue-500 dark:bg-blue-900/40">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300">
        <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        {label}
        <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      </div>
    </div>
  );
}

// Top drop zone: absolute so it does not push the first card down; only mounted during task drag
const TaskTopDropZone: React.FC<{ columnId: string }> = ({ columnId }) => {
  const { setNodeRef } = useDroppable({
    id: `${columnId}-task-top`,
    data: {
      type: 'column-top',
      columnId
    }
  });

  return (
    <div
      ref={setNodeRef}
      id={`${columnId}-task-top`}
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3 w-full"
      aria-hidden
    />
  );
};

// Bottom drop zone: absolute at bottom of column body — no extra spacer when idle
const BottomDropZone: React.FC<{ columnId: string }> = ({ columnId }) => {
  const { setNodeRef } = useDroppable({
    id: `${columnId}-bottom`,
    data: {
      type: 'column-bottom',
      columnId: columnId
    }
  });

  return (
    <div
      ref={setNodeRef}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 h-16 w-full"
      aria-hidden
    />
  );
};

