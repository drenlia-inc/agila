import React, { useState, useMemo, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useAppHeaderStickyTop } from '../hooks/useAppHeaderStickyTop';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Eye, EyeOff, Menu, X, Check, Trash2, Copy, FileText, ChevronLeft, ChevronRight, MessageCircle, UserPlus, Plus, Paperclip, Calendar, GitBranch, Link2 } from 'lucide-react';
import { Task, TeamMember, Priority, PriorityOption, Tag, Columns, Board, CurrentUser } from '../types';
import { TaskViewMode, getEffectiveUserPreferences, subscribeToUserPreferences, updateUserPreference, ColumnVisibility } from '../utils/userPreferences';
import { formatToYYYYMMDD, formatToYYYYMMDDHHmmss, parseLocalDate } from '../utils/dateUtils';
import { formatMembersTooltip } from '../utils/taskUtils';
import { getBoardColumns, addTagToTask, removeTagFromTask, createComment } from '../api';
import DOMPurify from 'dompurify';
import { generateTaskUrl } from '../utils/routingUtils';
import { mergeTaskTagsWithLiveData, getTagDisplayStyle } from '../utils/tagUtils';
import { getAuthenticatedAttachmentUrl } from '../utils/authImageUrl';
import { getLinkTarget, shouldOpenLinkInNewTab } from '../utils/linkUtils';
import { truncateMemberName } from '../utils/memberUtils';
import { commentTextToHtml } from '../utils/commentContent';
import { generateUUID } from '../utils/uuid';
import { truncateHtmlByChars } from '../utils/plainTextPreview';
import MemberSearchList from './ui/MemberSearchList';
import MemberAvatar from './ui/MemberAvatar';
import { layoutMemberDropdownFromElement } from '../utils/memberDropdownLayout';
import { CHROME_TOOLTIP_POPOVER_CLASS, CHROME_TOOLTIP_PANEL_SURFACE_CLASS, KanbanChromeTooltip } from './KanbanChromeTooltip';
import AgentPanel from './AgentPanel';
import type { AgentPanelView } from './AgentPanel';
import ExportMenu from './ExportMenu';
import DateRangePicker from './DateRangePicker';
import TextEditor from './TextEditor';
import AddTagModal from './AddTagModal';
import AddCommentModal from './AddCommentModal';
import { putTaskWork, getTaskWork, setTaskWorkControl, type TaskWorkMap } from '../api';
import { AGENT_MEMBER_ID, TASK_TITLE_MAX_LENGTH, TASK_DESCRIPTION_MAX_LENGTH } from '../constants/appConstants';
import {
  isAgentMemberId,
  resolveTaskMember,
} from '../utils/agentMemberUi';
import { userCanExport } from '../utils/permissions';
import SprintAssignmentCurrentPill from './ui/SprintAssignmentCurrentPill';
import { ModernCheckbox } from './ModernCheckbox';
import TaskBulkActionGutter from './TaskBulkActionGutter';
import type { ToggleTaskCheckedOptions } from '../utils/kanbanMultiSelect';
import { useColumnDisplayTitle } from '../utils/columnDisplayTitle';

interface ListViewScrollControls {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollLeft: () => void;
  scrollRight: () => void;
}

interface ListViewProps {
  filteredColumns: Columns;
  selectedBoard: string | null; // Board ID to fetch columns for
  members: TeamMember[];
  availablePriorities: PriorityOption[]; // Array of priority options with id, priority, color, etc.
  availableTags: Tag[];
  availableSprints?: any[]; // Optional: sprints passed from parent (avoids duplicate API calls)
  taskViewMode: TaskViewMode;
  onSelectTask: (task: Task | null, options?: { scrollToComments?: boolean }) => void;
  selectedTask: Task | null;
  onRemoveTask: (taskId: string, event?: React.MouseEvent) => void;
  onEditTask: (task: Task) => void;
  onCopyTask: (task: Task) => void;
  onMoveTaskToColumn: (taskId: string, targetColumnId: string) => Promise<void>;
  animateCopiedTaskId?: string | null; // Task ID to animate (set by parent after copy)
  onScrollControlsChange?: (controls: ListViewScrollControls) => void; // Expose scroll controls to parent
  boards?: Board[]; // To get project identifier from board
  siteSettings?: { [key: string]: string }; // Site settings for badge system
  currentUser?: CurrentUser | null; // Current user for admin checks
  /** Parent/child/related links for the current board (tree uses parent edges; related is a mark only) */
  boardRelationships?: BoardTaskRelationship[];
  /** When set (specific sprint or `backlog`), Sprint column is hidden (redundant). `null` = all sprints, show column per prefs. */
  selectedSprintId?: string | null;
  /** false for viewer — disable inline edits / row mutation actions */
  canMutate?: boolean;
  checkedTaskIds?: Set<string>;
  onToggleTaskChecked?: (taskId: string, options?: ToggleTaskCheckedOptions) => void;
  onClearAllChecked?: () => void;
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
  onBulkUndo?: () => void;
  onClearBulkUndo?: () => void;
  hasArchiveColumn?: boolean;
}

/** Matches GET /boards/:boardId/relationships rows */
export interface BoardTaskRelationship {
  id: string;
  taskId: string;
  toTaskId: string;
  relationship: 'parent' | 'child' | 'related';
  createdAt?: string;
}

interface ListDependencyMeta {
  depth: number;
  /** Length depth - 1: draw vertical guide at column i when true */
  verticalMask: boolean[];
  isLastChild: boolean;
}

function buildListViewDependencyOrder(
  sortedTasks: Task[],
  relationships: BoardTaskRelationship[] | undefined
): { ordered: Task[]; metaById: Map<string, ListDependencyMeta> } {
  const metaById = new Map<string, ListDependencyMeta>();
  if (!sortedTasks.length) {
    return { ordered: [], metaById };
  }

  const taskIds = new Set(sortedTasks.map(t => t.id));
  const taskById = new Map(sortedTasks.map(t => [t.id, t]));
  const orderIndex = new Map(sortedTasks.map((t, i) => [t.id, i]));

  const children = new Map<string, string[]>();
  for (const rel of relationships || []) {
    if (rel.relationship !== 'parent') continue;
    const parent = rel.taskId;
    const child = rel.toTaskId;
    if (!taskIds.has(parent) || !taskIds.has(child)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(child);
  }
  for (const [p, arr] of children) {
    const uniq = [...new Set(arr)];
    uniq.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    children.set(p, uniq);
  }

  const isChild = new Set<string>();
  for (const rel of relationships || []) {
    if (rel.relationship !== 'parent') continue;
    if (taskIds.has(rel.taskId) && taskIds.has(rel.toTaskId)) {
      isChild.add(rel.toTaskId);
    }
  }

  let roots = sortedTasks.filter(t => !isChild.has(t.id));
  if (roots.length === 0) {
    roots = [...sortedTasks];
  }

  const ordered: Task[] = [];
  const placed = new Set<string>();

  function dfs(
    taskId: string,
    depth: number,
    ancestorHasNext: boolean[],
    isLastAmongSiblings: boolean,
    stack: Set<string>
  ) {
    if (placed.has(taskId)) return;
    if (stack.has(taskId)) return;
    stack.add(taskId);

    const task = taskById.get(taskId);
    if (!task) {
      stack.delete(taskId);
      return;
    }

    placed.add(taskId);
    ordered.push(task);
    metaById.set(taskId, {
      depth,
      verticalMask: [...ancestorHasNext],
      isLastChild: isLastAmongSiblings
    });

    const kids = children.get(taskId) || [];
    kids.forEach((cid, idx) => {
      const notLast = idx < kids.length - 1;
      dfs(cid, depth + 1, [...ancestorHasNext, notLast], idx === kids.length - 1, stack);
    });
    stack.delete(taskId);
  }

  roots.forEach((task, idx) => {
    dfs(task.id, 0, [], idx === roots.length - 1, new Set());
  });

  for (const t of sortedTasks) {
    if (!placed.has(t.id)) {
      ordered.push(t);
      placed.add(t.id);
      metaById.set(t.id, { depth: 0, verticalMask: [], isLastChild: true });
    }
  }

  return { ordered, metaById };
}

function buildRelatedPeerIdsByTask(
  relationships: BoardTaskRelationship[] | undefined,
  visibleTaskIds: Set<string>
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!sets.has(from)) sets.set(from, new Set());
    sets.get(from)!.add(to);
  };
  for (const rel of relationships || []) {
    if (rel.relationship !== 'related') continue;
    if (visibleTaskIds.has(rel.taskId)) add(rel.taskId, rel.toTaskId);
    if (visibleTaskIds.has(rel.toTaskId)) add(rel.toTaskId, rel.taskId);
  }
  const map = new Map<string, string[]>();
  for (const [id, peers] of sets) {
    map.set(id, [...peers]);
  }
  return map;
}

function ListDependencyGutter({
  depth,
  verticalMask,
  isLastChild
}: ListDependencyMeta) {
  if (depth === 0) {
    return <div className="shrink-0" aria-hidden />;
  }
  return (
    <div
      className="flex items-stretch shrink-0 text-gray-400 dark:text-gray-500 text-[11px] leading-none select-none"
      aria-hidden
    >
      {verticalMask.map((cont, i) => (
        <div key={i} className="w-3 flex justify-center shrink-0 self-stretch min-h-[1.25rem]">
          {cont ? (
            <span className="block w-px h-full min-h-[1.25rem] bg-gray-300 dark:bg-gray-600" />
          ) : null}
        </div>
      ))}
      <div className="flex items-center gap-0 pr-1 shrink-0 whitespace-nowrap font-mono">
        <span>{isLastChild ? '└' : '├'}</span>
        <span>─</span>
        <span className="text-[10px]">&gt;</span>
      </div>
    </div>
  );
}

type SortField = 'sprint' | 'ticket' | 'title' | 'priority' | 'assignee' | 'startDate' | 'dueDate' | 'createdAt' | 'column' | 'tags' | 'comments';
type SortDirection = 'asc' | 'desc';

interface ColumnConfig {
  key: SortField;
  label: string;
  visible: boolean;
  width: number;
}

// System / Agent member IDs: see appConstants

const LIST_VIEW_INSTANT_TOOLTIP_CLASS = `${CHROME_TOOLTIP_POPOVER_CLASS} top-full mt-1 z-[60]`;
const LIST_VIEW_COLUMN_SEPARATOR_CLASS = 'border-r border-gray-200 dark:border-gray-700';
const LIST_VIEW_ROW_NUM_WIDTH_PX = 96;
const LIST_VIEW_TABLE_CLASS =
  'min-w-full w-max border-separate border-spacing-0 table-fixed';

/** Blob fix + DOMPurify + anchor `target` / `rel` from `SITE_OPENS_NEW_TAB` (matches TaskCard). */
function buildListViewDescriptionHtml(
  description: string | undefined,
  siteSettings?: { [key: string]: string }
): string {
  let fixed = description || '';
  const blobPattern = /blob:[^"]*#(img-[^"]*)/g;
  fixed = fixed.replace(blobPattern, (_match, filename) => {
    const authenticatedUrl = getAuthenticatedAttachmentUrl(`/attachments/${filename}`);
    return authenticatedUrl || `/uploads/${filename}`;
  });
  if (fixed.includes('blob:')) {
    fixed = fixed.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/gi, '<!-- Image removed: blob URL expired -->');
    fixed = fixed.replace(/blob:[^\s"')]+/gi, '');
  }
  const html = DOMPurify.sanitize(fixed);
  if (typeof document === 'undefined') return html;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const opensNew = shouldOpenLinkInNewTab(siteSettings);
  wrap.querySelectorAll('a[href]').forEach(anchor => {
    if (opensNew) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    } else {
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');
    }
  });
  return wrap.innerHTML;
}

// Note: Column labels are now translated in the component using useTranslation
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'sprint', label: 'Sprint', visible: true, width: 150 },
  { key: 'ticket', label: 'ID', visible: true, width: 128 },
  { key: 'title', label: 'Task', visible: true, width: 300 },
  { key: 'assignee', label: 'Assignee', visible: true, width: 120 },
  { key: 'priority', label: 'Priority', visible: true, width: 120 },
  { key: 'column', label: 'Status', visible: true, width: 150 },
  { key: 'startDate', label: 'Start Date', visible: true, width: 140 },
  { key: 'dueDate', label: 'Due Date', visible: true, width: 140 },
  { key: 'tags', label: 'Tags', visible: true, width: 200 },
  { key: 'comments', label: 'Comments', visible: false, width: 100 },
  { key: 'createdAt', label: 'Created', visible: true, width: 120 }
];

const LIST_VIEW_MIN_COLUMN_WIDTH = 72;
const LIST_VIEW_MAX_COLUMN_WIDTH = 720;

function clampListColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return LIST_VIEW_MIN_COLUMN_WIDTH;
  return Math.min(LIST_VIEW_MAX_COLUMN_WIDTH, Math.max(LIST_VIEW_MIN_COLUMN_WIDTH, Math.round(width)));
}

function buildListViewColumns(
  userId: string | null,
  boardId: string | null | undefined
): ColumnConfig[] {
  const prefs = getEffectiveUserPreferences(userId);
  const boardWidths =
    boardId && prefs.listViewColumnWidths?.[boardId]
      ? prefs.listViewColumnWidths[boardId]
      : {};
  return DEFAULT_COLUMNS.map((col) => {
    const savedWidth = boardWidths?.[col.key];
    return {
      ...col,
      visible: prefs.listViewColumnVisibility[col.key] ?? col.visible,
      width:
        typeof savedWidth === 'number' ? clampListColumnWidth(savedWidth) : col.width,
    };
  });
}

export default function ListView({
  filteredColumns,
  selectedBoard,
  members,
  availablePriorities,
  availableTags,
  availableSprints: propSprints,
  taskViewMode,
  onSelectTask,
  selectedTask,
  onRemoveTask,
  onEditTask: onEditTaskProp,
  onCopyTask,
  onMoveTaskToColumn,
  animateCopiedTaskId,
  onScrollControlsChange,
  boards,
  siteSettings,
  currentUser,
  boardRelationships = [],
  selectedSprintId = null,
  canMutate = true,
  checkedTaskIds = new Set<string>(),
  onToggleTaskChecked,
  onClearAllChecked,
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
  onBulkUndo,
  onClearBulkUndo,
  hasArchiveColumn = false,
}: ListViewProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const columnDisplayTitle = useColumnDisplayTitle();
  const onEditTask = async (task: Task) => {
    if (!canMutate) return;
    return onEditTaskProp(task);
  };
  
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [agentAssignTask, setAgentAssignTask] = useState<Task | null>(null);
  const [agentAssignWork, setAgentAssignWork] = useState<TaskWorkMap>({});
  const [agentAssignBusy, setAgentAssignBusy] = useState(false);
  const [agentPanelView, setAgentPanelView] = useState<AgentPanelView>('configure');
  const [agentPanelRestoreToken, setAgentPanelRestoreToken] = useState(0);
  
  // Get project identifier from the board
  const getProjectIdentifier = (boardId: string) => {
    if (!boards || !boardId) return null;
    const board = boards.find(b => b.id === boardId);
    return board?.project || null;
  };
  
  // Initialize columns from user preferences (visibility + per-board widths)
  const [columns, setColumns] = useState<ColumnConfig[]>(() =>
    buildListViewColumns(currentUser?.id ?? null, selectedBoard)
  );
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const [resizingColumnKey, setResizingColumnKey] = useState<SortField | null>(null);
  const resizingRef = useRef<{ key: SortField; startX: number; startWidth: number } | null>(
    null
  );
  const widthsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper function to parse date string as local date (avoiding timezone issues)
  // Must be defined before useMemo hooks that use it
  const parseLocalDate = (dateString: string): Date => {
    if (!dateString) return new Date();
    
    // Handle both YYYY-MM-DD and full datetime strings
    const dateOnly = dateString.split('T')[0]; // Get just the date part
    const [year, month, day] = dateOnly.split('-').map(Number);
    
    // Create date in local timezone
    return new Date(year, month - 1, day); // month is 0-indexed
  };
  const [showColumnMenu, setShowColumnMenu] = useState<string | null>(null);
  const [columnMenuPosition, setColumnMenuPosition] = useState<{top: number, left: number} | null>(null);
  const columnMenuButtonRef = useRef<HTMLButtonElement>(null);
  
  // State for board columns fetched from API
  const [boardColumns, setBoardColumns] = useState<{id: string, title: string}[]>([]);
  
  // Animation state for task moves and copies
  const [animatingTask, setAnimatingTask] = useState<string | null>(null);
  const [animationPhase, setAnimationPhase] = useState<'highlight' | 'slide' | 'fade' | null>(null);
  
  // Track copied tasks for animation (triggered manually after copy action)
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);

  // Comment tooltip state
  const [showCommentTooltip, setShowCommentTooltip] = useState<string | null>(null); // taskId of tooltip being shown
  const [tooltipPosition, setTooltipPosition] = useState<{vertical: 'above' | 'below', left: number, top: number}>({vertical: 'above', left: 0, top: 0});
  const commentTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commentTooltipShowTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commentContainerRefs = useRef<{[taskId: string]: HTMLDivElement | null}>({});
  const [addCommentTaskId, setAddCommentTaskId] = useState<string | null>(null);
  
  // Add Tag Modal state
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [tagModalTaskId, setTagModalTaskId] = useState<string | null>(null);

  // Sprint selector state
  const [showSprintSelector, setShowSprintSelector] = useState<string | null>(null); // taskId of sprint selector being shown
  const [sprints, setSprints] = useState<any[]>([]);
  const [sprintSearchTerm, setSprintSearchTerm] = useState('');
  const [highlightedSprintIndex, setHighlightedSprintIndex] = useState<number>(-1);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintSelectorCoords, setSprintSelectorCoords] = useState<{left: number, top: number, height?: number} | null>(null);
  const sprintSelectorRef = useRef<HTMLDivElement | null>(null);
  const sprintOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Horizontal scroll navigation state
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stickyHeaderTopPx = useAppHeaderStickyTop();
  const [showListDependencyTree, setShowListDependencyTree] = useState(false);
  const [rowActionTooltip, setRowActionTooltip] = useState<{
    taskId: string;
    action: 'copy' | 'delete';
  } | null>(null);
  const [sprintCalTooltipTaskId, setSprintCalTooltipTaskId] = useState<string | null>(null);

  useEffect(() => {
    const prefs = getEffectiveUserPreferences(currentUser?.id ?? null);
    setShowListDependencyTree(Boolean(prefs.listViewShowDependencies));
  }, [currentUser?.id]);

  // Reload visibility + per-board widths when board or user changes
  useEffect(() => {
    setColumns(buildListViewColumns(currentUser?.id ?? null, selectedBoard));
  }, [selectedBoard, currentUser?.id]);

  // Preferences finish loading from the database after this component mounts, so re-apply
  // them instead of staying on whatever the (possibly trimmed) cookie held.
  useEffect(() => {
    const userId = currentUser?.id ?? null;
    return subscribeToUserPreferences((prefs, prefsUserId) => {
      if (prefsUserId !== userId || resizingRef.current) return;
      const next = buildListViewColumns(userId, selectedBoard);
      setColumns(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setShowListDependencyTree(Boolean(prefs.listViewShowDependencies));
    });
  }, [selectedBoard, currentUser?.id]);

  const persistColumnWidths = useCallback(() => {
    if (!selectedBoard) return;
    const widths: { [columnKey: string]: number } = {};
    for (const col of columnsRef.current) {
      widths[col.key] = col.width;
    }
    const prefs = getEffectiveUserPreferences(currentUser?.id ?? null);
    void updateUserPreference(
      'listViewColumnWidths',
      {
        ...prefs.listViewColumnWidths,
        [selectedBoard]: widths,
      },
      currentUser?.id ?? null
    );
  }, [selectedBoard, currentUser?.id]);

  const schedulePersistColumnWidths = useCallback(() => {
    if (widthsSaveTimeoutRef.current) {
      clearTimeout(widthsSaveTimeoutRef.current);
    }
    widthsSaveTimeoutRef.current = setTimeout(() => {
      widthsSaveTimeoutRef.current = null;
      persistColumnWidths();
    }, 400);
  }, [persistColumnWidths]);

  const handleColumnResizeStart = useCallback(
    (e: React.MouseEvent, key: SortField) => {
      e.preventDefault();
      e.stopPropagation();
      const col = columnsRef.current.find((c) => c.key === key);
      if (!col) return;
      resizingRef.current = {
        key,
        startX: e.clientX,
        startWidth: col.width,
      };
      setResizingColumnKey(key);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    []
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const active = resizingRef.current;
      if (!active) return;
      const nextWidth = clampListColumnWidth(active.startWidth + (e.clientX - active.startX));
      setColumns((prev) =>
        prev.map((col) => (col.key === active.key ? { ...col, width: nextWidth } : col))
      );
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      setResizingColumnKey(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      schedulePersistColumnWidths();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (widthsSaveTimeoutRef.current) {
        clearTimeout(widthsSaveTimeoutRef.current);
      }
    };
  }, [schedulePersistColumnWidths]);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const listRootRef = useRef<HTMLDivElement>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingHorizontalScrollRef = useRef(false);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Function to trigger animation for a copied task
  const animateCopiedTask = useCallback((taskId: string) => {
    setCopiedTaskId(taskId);
    setAnimatingTask(taskId);
    setAnimationPhase('highlight');
    
    // Scroll to the copied task
    setTimeout(() => {
      const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
      if (taskElement) {
        const rect = taskElement.getBoundingClientRect();
        const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
        
        if (!isVisible) {
          taskElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }
      }
    }, 100);
    
    // Fade out after 2 seconds
    setTimeout(() => {
      setAnimationPhase('fade');
      setTimeout(() => {
        setAnimatingTask(null);
        setAnimationPhase(null);
        setCopiedTaskId(null);
      }, 1000);
    }, 2000);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  // Handler for when a new tag is created
  const handleTagCreated = async (newTag: Tag) => {
    // Add the tag to the task that was being edited
    if (tagModalTaskId) {
      try {
        await addTagToTask(tagModalTaskId, newTag.id);
        
        // Find the task and update it with the new tag
        const task = allTasks.find(t => t.id === tagModalTaskId);
        if (task) {
          const updatedTask = { 
            ...task, 
            tags: [...(task.tags || []), newTag]
          };
          await onEditTask(updatedTask);
        }
      } catch (error) {
        console.error('Failed to add new tag to task:', error);
      }
    }
    
    setTagModalTaskId(null);
  };

  // Check scroll state for table
  const checkTableScrollState = () => {
    if (!tableContainerRef.current) return;

    const container = tableContainerRef.current;
    const newCanScrollLeft = container.scrollLeft > 0;
    const newCanScrollRight = container.scrollLeft < container.scrollWidth - container.clientWidth;

    setCanScrollLeft(newCanScrollLeft);
    setCanScrollRight(newCanScrollRight);

    // Notify parent of scroll control changes
    if (onScrollControlsChange) {
      onScrollControlsChange({
        canScrollLeft: newCanScrollLeft,
        canScrollRight: newCanScrollRight,
        scrollLeft: scrollTableLeft,
        scrollRight: scrollTableRight,
      });
    }
  };

  const syncHeaderScrollLeft = useCallback((scrollLeft: number) => {
    const headerScroll = tableHeaderScrollRef.current;
    if (!headerScroll || headerScroll.scrollLeft === scrollLeft) return;
    isSyncingHorizontalScrollRef.current = true;
    headerScroll.scrollLeft = scrollLeft;
    isSyncingHorizontalScrollRef.current = false;
  }, []);

  const handleTableBodyScroll = useCallback(() => {
    if (isSyncingHorizontalScrollRef.current) return;
    const body = tableContainerRef.current;
    if (!body) return;
    syncHeaderScrollLeft(body.scrollLeft);
    checkTableScrollState();
  }, [syncHeaderScrollLeft]);

  // Table scroll functions
  const scrollTableLeft = () => {
    if (!tableContainerRef.current) return;
    tableContainerRef.current.scrollBy({ left: -300, behavior: 'smooth' });
  };

  const scrollTableRight = () => {
    if (!tableContainerRef.current) return;
    tableContainerRef.current.scrollBy({ left: 300, behavior: 'smooth' });
  };

  // Continuous scroll for holding down
  const startContinuousScroll = (direction: 'left' | 'right') => {
    const scrollFn = direction === 'left' ? scrollTableLeft : scrollTableRight;
    scrollFn(); // Initial scroll
    scrollIntervalRef.current = setInterval(scrollFn, 150);
  };

  const stopContinuousScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };


  // Cleanup scroll intervals
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  // Trigger animation when parent sets animateCopiedTaskId
  useEffect(() => {
    if (animateCopiedTaskId && !animatingTask) {
      animateCopiedTask(animateCopiedTaskId);
    }
  }, [animateCopiedTaskId, animatingTask, animateCopiedTask]);
  
  // Reset animation state when changing boards
  useEffect(() => {
    setAnimatingTask(null);
    setAnimationPhase(null);
    setCopiedTaskId(null);
    setSortField(null);
    setSortDirection('asc');
  }, [selectedBoard]);

  // Fetch board columns when selectedBoard changes
  useEffect(() => {
    const fetchBoardColumns = async () => {
      if (selectedBoard) {
        try {
          const columns = await getBoardColumns(selectedBoard);
          setBoardColumns(columns);
        } catch (error) {
          console.error('Failed to fetch board columns:', error);
          setBoardColumns([]);
        }
      } else {
        setBoardColumns([]);
      }
    };
    
    fetchBoardColumns();
  }, [selectedBoard]);
  
  // Inline editing state
  const [editingCell, setEditingCell] = useState<{taskId: string, field: string} | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showDropdown, setShowDropdown] = useState<{taskId: string, field: string} | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'above' | 'below'>('below');
  const [assigneeDropdownCoords, setAssigneeDropdownCoords] = useState<{
    left: number;
    top: number;
    height?: number;
    width?: number;
    columns?: 1 | 2;
  } | null>(null);
  const [priorityDropdownCoords, setPriorityDropdownCoords] = useState<{left: number; top: number} | null>(null);
  const [statusDropdownCoords, setStatusDropdownCoords] = useState<{left: number; top: number} | null>(null);
  const [tagsDropdownCoords, setTagsDropdownCoords] = useState<{left: number; top: number} | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Date range picker state
  const [showDateRangePicker, setShowDateRangePicker] = useState<string | null>(null); // taskId of date picker being shown
  const [dateRangePickerPosition, setDateRangePickerPosition] = useState<{ left: number; top: number } | null>(null);
  
  // Date validation tooltip state
  const [dateTooltipInfo, setDateTooltipInfo] = useState<{
    taskId: string;
    dateType: 'start' | 'due';
    message: string;
    position: { left: number; top: number };
  } | null>(null);

  // Flatten all tasks from all columns
  const allTasks = useMemo(() => {
    const tasks: (Task & { columnTitle: string; columnPosition: number })[] = [];
    const columnCounts: {[key: string]: number} = {};
    if (filteredColumns && typeof filteredColumns === 'object') {
      Object.values(filteredColumns).forEach(column => {
        if (column && column.tasks && Array.isArray(column.tasks)) {
          const displayTitle = columnDisplayTitle(column);
          columnCounts[displayTitle] = column.tasks.length;
          column.tasks.forEach(task => {
            tasks.push({ 
              ...task, 
              columnTitle: displayTitle,
              columnPosition: column.position || 0
            });
          });
        }
      });
    }
    return tasks;
  }, [filteredColumns, columnDisplayTitle]);

  // Sort tasks with multi-level sorting
  const sortedTasks = useMemo(() => {
    return [...allTasks].sort((a, b) => {
      // Default multi-level sort: column position → task position → ticket
      if (sortField === null) {
        // 1. By column position (ascending)
        if (a.columnPosition !== b.columnPosition) {
          return a.columnPosition - b.columnPosition;
        }
        
        // 2. By task position within column (ascending)
        const aTaskPosition = a.position || 0;
        const bTaskPosition = b.position || 0;
        if (aTaskPosition !== bTaskPosition) {
          return aTaskPosition - bTaskPosition;
        }
        
        // 3. By ticket as fallback
        return (a.ticket || '').localeCompare(b.ticket || '');
      } else {
        // Single-field sorting when user clicks on a column header
        let aValue: any, bValue: any;

        switch (sortField) {
          case 'ticket':
            // Extract last 5 digits for numeric sorting (e.g., TASK-00023 → 23, PROJ-00001 → 1)
            const aTicketMatch = a.ticket?.match(/(\d{1,5})$/);
            const bTicketMatch = b.ticket?.match(/(\d{1,5})$/);
            aValue = aTicketMatch ? parseInt(aTicketMatch[1], 10) : 0;
            bValue = bTicketMatch ? parseInt(bTicketMatch[1], 10) : 0;
            break;
          case 'title':
            aValue = a.title.toLowerCase();
            bValue = b.title.toLowerCase();
            break;
          case 'priority':
            const aPriority = availablePriorities?.find(p => p.id === a.priorityId);
            const bPriority = availablePriorities?.find(p => p.id === b.priorityId);
            aValue = aPriority?.order || 999;
            bValue = bPriority?.order || 999;
            break;
          case 'assignee':
            const aMember = members?.find(m => m.id === a.memberId);
            const bMember = members?.find(m => m.id === b.memberId);
            aValue = aMember ? `${aMember.firstName} ${aMember.lastName}`.toLowerCase() : '';
            bValue = bMember ? `${bMember.firstName} ${bMember.lastName}`.toLowerCase() : '';
            break;
          case 'dueDate':
            const aDate = a.dueDate ? parseLocalDate(a.dueDate) : null;
            const bDate = b.dueDate ? parseLocalDate(b.dueDate) : null;
            aValue = aDate && !isNaN(aDate.getTime()) ? aDate.getTime() : 0;
            bValue = bDate && !isNaN(bDate.getTime()) ? bDate.getTime() : 0;
            break;
          case 'startDate':
            const aStart = parseLocalDate(a.startDate);
            const bStart = parseLocalDate(b.startDate);
            aValue = !isNaN(aStart.getTime()) ? aStart.getTime() : 0;
            bValue = !isNaN(bStart.getTime()) ? bStart.getTime() : 0;
            break;
          case 'createdAt':
            const aCreated = new Date(a.createdAt);
            const bCreated = new Date(b.createdAt);
            aValue = !isNaN(aCreated.getTime()) ? aCreated.getTime() : 0;
            bValue = !isNaN(bCreated.getTime()) ? bCreated.getTime() : 0;
            break;
          case 'column':
            aValue = a.columnTitle.toLowerCase();
            bValue = b.columnTitle.toLowerCase();
            break;
          case 'sprint':
            const aSprint = sprints.find(s => s.id === a.sprintId);
            const bSprint = sprints.find(s => s.id === b.sprintId);
            aValue = aSprint?.name?.toLowerCase() || '';
            bValue = bSprint?.name?.toLowerCase() || '';
            break;
          case 'tags':
            aValue = a.tags?.length || 0;
            bValue = b.tags?.length || 0;
            break;
          case 'comments':
            aValue = a.comments?.length || 0;
            bValue = b.comments?.length || 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      }
    });
  }, [allTasks, sortField, sortDirection, availablePriorities, members, sprints]);

  const { tableTasks, listDepMetaById } = useMemo(() => {
    if (!showListDependencyTree) {
      return { tableTasks: sortedTasks, listDepMetaById: new Map<string, ListDependencyMeta>() };
    }
    const { ordered, metaById } = buildListViewDependencyOrder(sortedTasks, boardRelationships);
    return { tableTasks: ordered, listDepMetaById: metaById };
  }, [sortedTasks, boardRelationships, showListDependencyTree]);

  const relatedPeerIdsByTask = useMemo(() => {
    if (!showListDependencyTree) return new Map<string, string[]>();
    return buildRelatedPeerIdsByTask(
      boardRelationships,
      new Set(sortedTasks.map((task) => task.id))
    );
  }, [boardRelationships, showListDependencyTree, sortedTasks]);

  const taskById = useMemo(
    () => new Map(allTasks.map((task) => [task.id, task])),
    [allTasks]
  );

  const tableTaskIds = useMemo(() => tableTasks.map((task) => task.id), [tableTasks]);

  const handleTaskContentClick = useCallback(
    (task: Task, event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('a')) return;
      event.stopPropagation();
      const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
      if (modifier && canMutate && onToggleTaskChecked) {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        onToggleTaskChecked(
          task.id,
          event.shiftKey ? { range: true, orderedIds: tableTaskIds } : undefined
        );
        return;
      }

      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        onSelectTask(selectedTask?.id === task.id ? null : task);
        clickTimerRef.current = null;
      }, 250);
    },
    [canMutate, onSelectTask, onToggleTaskChecked, selectedTask?.id, tableTaskIds]
  );

  const ticketColumnWidthBoost = showListDependencyTree ? 140 : 0;

  const columnSizeStyle = (column: ColumnConfig, isLastColumn = false) => {
    const width =
      column.key === 'ticket' ? column.width + ticketColumnWidthBoost : column.width;
    if (isLastColumn) {
      // Last column: honor saved min width but grow with content / remaining space (no max cap).
      return { minWidth: width, width: 'auto' as const };
    }
    return { width, minWidth: width, maxWidth: width } as const;
  };

  // Update scroll state when table content changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkTableScrollState();
      const body = tableContainerRef.current;
      if (body) syncHeaderScrollLeft(body.scrollLeft);
    }, 100);

    const container = tableContainerRef.current;
    if (container) {
      const resizeObserver = new ResizeObserver(() => {
        setTimeout(() => {
          checkTableScrollState();
          syncHeaderScrollLeft(container.scrollLeft);
        }, 50);
      });
      resizeObserver.observe(container);

      return () => {
        clearTimeout(timeoutId);
        resizeObserver.disconnect();
      };
    }

    return () => clearTimeout(timeoutId);
  }, [tableTasks, columns, syncHeaderScrollLeft]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null);
        setSortDirection('asc');
      }
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  };

  /** Hide Sprint column when not in “all sprints” mode (single sprint or backlog — no useful variation in that column). */
  const isSingleSprintListFilter = selectedSprintId != null;

  const countEffectiveVisibleColumns = (cols: ColumnConfig[]) =>
    cols.filter(col => {
      if (!col.visible) return false;
      if (col.key === 'sprint' && isSingleSprintListFilter) return false;
      return true;
    }).length;

  const toggleColumnVisibility = (key: SortField) => {
    if (key === 'sprint' && isSingleSprintListFilter) {
      return;
    }
    const newColumns = columns.map(col => 
      col.key === key ? { ...col, visible: !col.visible } : col
    );
    
    // Prevent hiding all columns (count columns that actually appear in the table)
    if (countEffectiveVisibleColumns(newColumns) === 0) {
      return;
    }
    
    setColumns(newColumns);
    
    // Save column visibility to user preferences
    const columnVisibility: ColumnVisibility = {};
    newColumns.forEach(col => {
      columnVisibility[col.key] = col.visible;
    });
    updateUserPreference('listViewColumnVisibility', columnVisibility, currentUser?.id ?? null);
  };

  const handleColumnMenuToggle = () => {
    if (showColumnMenu === 'rowNumber') {
      // Close menu
      setShowColumnMenu(null);
      setColumnMenuPosition(null);
    } else {
      // Open menu and calculate position
      const button = columnMenuButtonRef.current;
      if (button) {
        const rect = button.getBoundingClientRect();
        setColumnMenuPosition({
          top: rect.bottom + 4,
          left: rect.left,
        });
        setShowColumnMenu('rowNumber');
      }
    }
  };

  const getPriorityDisplay = (priorityString: string) => {
    const priority = availablePriorities?.find(p => p.priority === priorityString);
    if (!priority) return null;
    
    return (
      <span 
        className="px-1.5 py-0.5 rounded text-xs font-medium"
        style={{ 
          backgroundColor: priority.color + '20',
          color: priority.color,
          border: `1px solid ${priority.color}40`
        }}
      >
        {priority.priority}
      </span>
    );
  };

  // Helper function to check if a task is overdue
  const isTaskOverdue = (task: Task) => {
    if (!task.dueDate) return false;
    const today = new Date();
    const dueDate = parseLocalDate(task.dueDate);
    // Set time to beginning of day for fair comparison
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  // Helper function to check if a column is finished
  const isColumnFinished = (columnId: string) => {
    const column = filteredColumns[columnId];
    return column?.is_finished || false;
  };

  // Helper function to check if a column is archived
  const isColumnArchived = (columnId: string) => {
    const column = filteredColumns[columnId];
    return column?.is_archived || false;
  };

  const getTagsDisplay = (tags: Tag[]) => {
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      return (
        <div className="px-2 py-1 border border-dashed border-gray-300 dark:border-gray-600 rounded text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-500 dark:hover:text-gray-400">
          {t('tags.clickToAdd')}
        </div>
      );
    }

    // Merge task tags with live tag data to get updated colors
    const liveTags = mergeTaskTagsWithLiveData(tags, availableTags);

    return (
      <div className="flex flex-wrap gap-1">
        {liveTags.slice(0, 2).map(tag => (
          <span
            key={tag.id}
            className="px-1.5 py-0.5 rounded text-xs font-medium"
            style={getTagDisplayStyle(tag)}
          >
            {tag.tag}
          </span>
        ))}
        {liveTags.length > 2 && (
          <span className="text-xs text-gray-500">+{liveTags.length - 2}</span>
        )}
      </div>
    );
  };

  const getSprintName = (sprintId: string | null | undefined): string => {
    if (!sprintId) return '';
    const sprint = sprints.find(s => s.id === sprintId);
    return sprint?.name || '';
  };

  const getMemberDisplay = (memberId: string | null | undefined) => {
    const member = memberId ? resolveTaskMember(members, memberId) : undefined;
    if (!member) {
      return (
        <div className="flex items-center gap-1">
          <MemberAvatar member={null} size="sm" />
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {t('taskCard.noAssignee')}
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <MemberAvatar member={member} members={members} size="sm" />
        <span className="text-xs text-gray-900 truncate">{truncateMemberName(member.name)}</span>
      </div>
    );
  };

  const renderWatchersCollaborators = (task: Task) => {
    const watchers = task.watchers || [];
    const collaborators = task.collaborators || [];
    if (watchers.length === 0 && collaborators.length === 0) return null;

    return (
      <div
        className="flex cursor-default gap-1"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {watchers.length > 0 && (
          <KanbanChromeTooltip
            label={formatMembersTooltip(watchers, 'watcher')}
            delayMs={0}
            wrapperClassName="flex items-center"
          >
            <span className="flex items-center">
              <Eye size={10} className="text-blue-500" />
              <span className="ml-0.5 text-[9px] font-medium text-blue-600">{watchers.length}</span>
            </span>
          </KanbanChromeTooltip>
        )}
        {collaborators.length > 0 && (
          <KanbanChromeTooltip
            label={formatMembersTooltip(collaborators, 'collaborator')}
            delayMs={0}
            wrapperClassName="flex items-center"
          >
            <span className="flex items-center">
              <UserPlus size={10} className="text-blue-500" />
              <span className="ml-0.5 text-[9px] font-medium text-blue-600">
                {collaborators.length}
              </span>
            </span>
          </KanbanChromeTooltip>
        )}
      </div>
    );
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    try {
      return formatToYYYYMMDD(dateString);
    } catch (error) {
      console.warn('Date formatting error:', error, 'for date:', dateString);
      return dateString; // Fallback to original string
    }
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    try {
      return formatToYYYYMMDDHHmmss(dateString);
    } catch (error) {
      console.warn('DateTime formatting error:', error, 'for date:', dateString);
      return dateString; // Fallback to original string
    }
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Close dropdown when clicking outside (not on the field trigger — that toggles).
  useEffect(() => {
    if (!showDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (dropdownRef.current?.contains(target)) return;
      if (target.closest('[data-list-dropdown-trigger]')) return;
      setShowDropdown(null);
      setAssigneeDropdownCoords(null);
      setPriorityDropdownCoords(null);
      setStatusDropdownCoords(null);
      setTagsDropdownCoords(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  // Close column menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showColumnMenu && columnMenuButtonRef.current && !columnMenuButtonRef.current.contains(event.target as Node)) {
        // Check if the click is on the portal menu itself
        const target = event.target as HTMLElement;
        const isPortalClick = target.closest('[data-column-menu-portal]');
        if (!isPortalClick) {
          setShowColumnMenu(null);
          setColumnMenuPosition(null);
        }
      }
    };

    if (showColumnMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showColumnMenu]);

  useEffect(() => {
    if (showColumnMenu !== 'rowNumber') return;
    const updatePosition = () => {
      const button = columnMenuButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setColumnMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    };
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [showColumnMenu]);

  // Inline editing functions
  const startEditing = (taskId: string, field: string, currentValue: string) => {
    if (!canMutate) return;
    setEditingCell({ taskId, field });
    setEditValue(currentValue);
    setShowDropdown(null);
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingCell) return;

    const task = allTasks.find(t => t.id === editingCell.taskId);
    if (!task) return;

    // Don't save date fields via inline editing - they use DateRangePicker
    if (editingCell.field === 'startDate' || editingCell.field === 'dueDate') {
      setEditingCell(null);
      setEditValue('');
      return;
    }

    const updatedTask = {
      ...task,
      [editingCell.field]: editValue
    };

    try {
      await onEditTask(updatedTask);
      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      console.error('Failed to save edit:', error);
    }
  };

  // Date range picker handlers
  const handleDateRangeClick = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canMutate) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    setDateRangePickerPosition({
      left: rect.left,
      top: rect.bottom + 4
    });
    setShowDateRangePicker(taskId);
    // Close any inline editing for this task
    if (editingCell?.taskId === taskId && (editingCell.field === 'startDate' || editingCell.field === 'dueDate')) {
      setEditingCell(null);
      setEditValue('');
    }
  };

  const handleDateRangeChange = (taskId: string, startDate: string, endDate: string) => {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;
    
    const updatedTask = {
      ...task,
      startDate,
      dueDate: endDate || undefined
    };
    
    onEditTask(updatedTask);
  };

  const handleDateRangePickerClose = () => {
    setShowDateRangePicker(null);
    setDateRangePickerPosition(null);
  };

  // Validate task dates against sprint dates
  const getDateValidation = (task: Task) => {
    if (!task.sprintId || sprints.length === 0) {
      return { startDateValid: true, dueDateValid: true, sprint: null };
    }

    const sprint = sprints.find(s => s.id === task.sprintId);
    if (!sprint || !sprint.start_date || !sprint.end_date) {
      return { startDateValid: true, dueDateValid: true, sprint: null };
    }

    const sprintStart = parseLocalDate(sprint.start_date);
    const sprintEnd = parseLocalDate(sprint.end_date);
    sprintStart.setHours(0, 0, 0, 0);
    sprintEnd.setHours(0, 0, 0, 0);

    let startDateValid = true;
    let dueDateValid = true;
    let startDateError = '';
    let dueDateError = '';

    if (task.startDate) {
      const taskStart = parseLocalDate(task.startDate);
      taskStart.setHours(0, 0, 0, 0);
      
      if (taskStart < sprintStart) {
        startDateValid = false;
        startDateError = `Start date is before sprint start (${formatDate(sprint.start_date)})`;
      } else if (taskStart > sprintEnd) {
        startDateValid = false;
        startDateError = `Start date is after sprint end (${formatDate(sprint.end_date)})`;
      }
    }

    if (task.dueDate) {
      const taskDue = parseLocalDate(task.dueDate);
      taskDue.setHours(0, 0, 0, 0);
      
      if (taskDue < sprintStart) {
        dueDateValid = false;
        dueDateError = `Due date is before sprint start (${formatDate(sprint.start_date)})`;
      } else if (taskDue > sprintEnd) {
        dueDateValid = false;
        dueDateError = `Due date is after sprint end (${formatDate(sprint.end_date)})`;
      }
    }

    return {
      startDateValid,
      dueDateValid,
      sprint,
      startDateError,
      dueDateError
    };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  // Sprint selector handlers
  const handleSprintSelectorOpen = (taskId: string, event: React.SyntheticEvent<HTMLDivElement>) => {
    if (!canMutate) return;
    const target = event.currentTarget;
    const coords = calculateDropdownCoords(target, 'sprint');
    setSprintSelectorCoords(coords);
    setShowSprintSelector(taskId);
  };

  const handleSprintSelect = (taskId: string, sprint: any | null) => {
    if (!canMutate) return;
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    let updatedTask;
    if (sprint === null) {
      // "None (Backlog)" selected - clear sprint association (keep existing dates)
      updatedTask = {
        ...task,
        sprintId: null
      };
    } else {
      // Align task dates with the selected sprint's date range
      updatedTask = {
        ...task,
        sprintId: sprint.id,
        startDate: sprint.start_date ? formatToYYYYMMDD(sprint.start_date) : task.startDate,
        dueDate: sprint.end_date ? formatToYYYYMMDD(sprint.end_date) : task.dueDate
      };
    }

    onEditTask(updatedTask);
    setShowSprintSelector(null);
    setSprintSelectorCoords(null);
    setSprintSearchTerm('');
    setHighlightedSprintIndex(-1);
  };

  const handleSprintKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, taskId: string) => {
    const filteredSprints = sprints.filter(sprint =>
      sprint.name.toLowerCase().includes(sprintSearchTerm.toLowerCase())
    );

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedSprintIndex(prev =>
        prev < filteredSprints.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedSprintIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedSprintIndex >= 0) {
      e.preventDefault();
      handleSprintSelect(taskId, filteredSprints[highlightedSprintIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSprintSelector(null);
      setSprintSearchTerm('');
      setHighlightedSprintIndex(-1);
    }
  };

  // Use prop sprints if provided, otherwise fetch when needed (fallback for backward compatibility)
  useEffect(() => {
    if (propSprints && propSprints.length > 0) {
      setSprints(propSprints);
      return;
    }
    
    // Only fetch if not provided via props and needed
    const fetchSprints = async () => {
      // Check if any task has a sprintId and we don't have sprints yet
      const hasTasksWithSprints = allTasks.some(task => task.sprintId);
      const shouldFetch =
        showSprintSelector ||
        !!showDateRangePicker ||
        (hasTasksWithSprints && sprints.length === 0);
      if (!shouldFetch) return;
      
      try {
        setSprintsLoading(true);
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/admin/sprints', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSprints(data.sprints || []);
        }
      } catch (error) {
        console.error('Failed to fetch sprints:', error);
      } finally {
        setSprintsLoading(false);
      }
    };

    fetchSprints();
  }, [propSprints, showSprintSelector, showDateRangePicker, sprints.length, allTasks]);

  // Close sprint selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sprintSelectorRef.current && !sprintSelectorRef.current.contains(event.target as Node)) {
        setShowSprintSelector(null);
        setSprintSelectorCoords(null);
        setSprintSearchTerm('');
        setHighlightedSprintIndex(-1);
      }
    };

    if (showSprintSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSprintSelector]);

  // Reset highlighted index when search term changes
  useEffect(() => {
    setHighlightedSprintIndex(-1);
  }, [sprintSearchTerm]);

  // Auto-scroll to highlighted sprint option
  useEffect(() => {
    if (highlightedSprintIndex >= 0 && sprintOptionRefs.current[highlightedSprintIndex]) {
      sprintOptionRefs.current[highlightedSprintIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [highlightedSprintIndex]);

  const calculateDropdownPosition = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    // If there's more space above and below is tight, show above
    return spaceBelow < 200 && spaceAbove > spaceBelow ? 'above' : 'below';
  };

  const calculateDropdownCoords = (element: HTMLElement, dropdownType: 'assignee' | 'priority' | 'status' | 'tags' | 'sprint') => {
    const rect = element.getBoundingClientRect();
    
    // Set dimensions based on dropdown type
    let dropdownWidth = 180;
    let dropdownHeight = 150;
    
    switch (dropdownType) {
      case 'assignee':
        {
          const layout = layoutMemberDropdownFromElement(element, members || [], {
            showAgent: true,
            excludeViewers: true,
            selectedId: allTasks.find((t) => t.id === showDropdown?.taskId)?.memberId || null,
            placement: 'below',
            extraChrome: 44,
          });
          return layout;
        }
      case 'priority':
        dropdownWidth = 120;
        dropdownHeight = 120;
        break;
      case 'status':
        dropdownWidth = 150;
        dropdownHeight = 200;
        break;
      case 'tags':
        dropdownWidth = 200;
        dropdownHeight = 180;
        break;
      case 'sprint':
        dropdownWidth = 256; // w-64 = 16rem = 256px
        dropdownHeight = 300; // Max height for sprint list with search
        break;
    }
    
    // Calculate horizontal position
    let left = rect.left;
    const spaceRight = window.innerWidth - (left + dropdownWidth);
    
    // If dropdown would go beyond right edge, position it to the left of the trigger
    if (spaceRight < 10) {
      left = rect.right - dropdownWidth;
    }
    
    // If still beyond left edge, align to viewport edge
    if (left < 10) {
      left = 10;
    }
    
    // Calculate vertical position
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    let top;
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      // Show above
      top = rect.top - dropdownHeight - 4;
    } else {
      // Show below
      top = rect.bottom + 4;
    }
    
    // Ensure dropdown stays within viewport
    top = Math.max(10, Math.min(top, window.innerHeight - dropdownHeight - 10));
    
    return { left, top, height: dropdownHeight };
  };

  const openAddCommentForTask = (taskId: string) => {
    setShowCommentTooltip(null);
    setAddCommentTaskId(taskId);
  };

  const handleListCommentSubmit = async (commentText: string) => {
    if (!addCommentTaskId) return;
    if (!currentUser) {
      throw new Error('You must be logged in to add comments');
    }
    const currentMember = members.find((m) => m.user_id === currentUser.id);
    if (!currentMember) {
      throw new Error('Unable to identify user for comment');
    }
    const task = allTasks.find((t) => t.id === addCommentTaskId);
    if (!task) return;

    const newComment = {
      id: generateUUID(),
      text: commentText,
      authorId: currentMember.id,
      createdAt: new Date().toISOString(),
      taskId: task.id,
      attachments: [] as never[],
    };
    await createComment(newComment);
    // Bypass canMutate gate: comments are allowed for viewers; parent skips task PATCH when locked.
    await onEditTaskProp({
      ...task,
      comments: [...(task.comments || []), newComment],
    });
  };

  const toggleDropdown = (taskId: string, field: string, event?: React.MouseEvent) => {
    if (!canMutate) return;
    if (showDropdown?.taskId === taskId && showDropdown?.field === field) {
      setShowDropdown(null);
      setAssigneeDropdownCoords(null);
      setPriorityDropdownCoords(null);
      setStatusDropdownCoords(null);
      setTagsDropdownCoords(null);
    } else {
      if (event?.currentTarget) {
        const element = event.currentTarget as HTMLElement;
        const position = calculateDropdownPosition(element);
        setDropdownPosition(position);
        
        // Calculate Portal coordinates for each dropdown type
        setAssigneeDropdownCoords(null);
        setPriorityDropdownCoords(null);
        setStatusDropdownCoords(null);
        setTagsDropdownCoords(null);
        
        if (field === 'assignee') {
          const coords = calculateDropdownCoords(element, 'assignee');
          setAssigneeDropdownCoords(coords);
        } else if (field === 'priority') {
          const coords = calculateDropdownCoords(element, 'priority');
          setPriorityDropdownCoords(coords);
        } else if (field === 'column') {
          const coords = calculateDropdownCoords(element, 'status');
          setStatusDropdownCoords(coords);
        } else if (field === 'tags') {
          const coords = calculateDropdownCoords(element, 'tags');
          setTagsDropdownCoords(coords);
        }
      }
      setShowDropdown({ taskId, field });
      setEditingCell(null);
    }
  };

  const handleDropdownSelect = async (taskId: string, field: string, value: string | Tag[] | null) => {
    if (!canMutate) return;
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    if (field === 'memberId' && value != null && isAgentMemberId(String(value))) {
      if (siteSettings?.AI_ENABLED !== 'true') {
        setShowDropdown(null);
        setAssigneeDropdownCoords(null);
        return;
      }
      setShowDropdown(null);
      setAssigneeDropdownCoords(null);
      const alreadyAssigned = isAgentMemberId(task.memberId);
      setAgentAssignTask(task);
      setAgentPanelView(alreadyAssigned ? 'activity' : 'configure');
      setAgentPanelRestoreToken((n) => n + 1);
      if (alreadyAssigned) {
        getTaskWork(task.id)
          .then(({ work }) => setAgentAssignWork(work || {}))
          .catch(() => setAgentAssignWork({}));
      } else {
        setAgentAssignWork({});
      }
      return;
    }

    const updatedTask: any = {
      ...task
    };

    // Handle priority specially - use priorityId instead of priority name
    if (field === 'priority') {
      const priorityOption = availablePriorities.find(p => p.priority === value);
      if (priorityOption) {
        updatedTask.priorityId = priorityOption.id;
        updatedTask.priority = priorityOption.priority;
      } else {
        updatedTask[field] = value;
      }
    } else {
      updatedTask[field] = value;
    }

    try {
      await onEditTask(updatedTask);
      setShowDropdown(null);
      setAssigneeDropdownCoords(null);
      setPriorityDropdownCoords(null);
      setStatusDropdownCoords(null);
      setTagsDropdownCoords(null);
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleListAssignAgentConfirm = async (
    repoUrl: string,
    repoBranch: string,
    options?: {
      restart?: boolean;
      llmModel?: string;
      launch?: boolean;
      agentMode?: 'assist' | 'code' | 'automation';
      automationScope?: 'this_board' | 'selected' | 'all_boards';
      automationBoardIds?: string[];
      description?: string;
    }
  ) => {
    if (!agentAssignTask) return;
    setAgentAssignBusy(true);
    try {
      const agentMode = options?.agentMode || (repoUrl.trim() ? 'code' : 'assist');
      const isFirstAssign = !isAgentMemberId(agentAssignTask.memberId);
      const withDescription =
        options?.description !== undefined
          ? {
              ...agentAssignTask,
              description: options.description,
              ...(isFirstAssign ? { memberId: AGENT_MEMBER_ID } : {}),
            }
          : isFirstAssign
            ? { ...agentAssignTask, memberId: AGENT_MEMBER_ID }
            : agentAssignTask;

      if (isFirstAssign || options?.description !== undefined) {
        await onEditTask(withDescription);
      }

      const shouldLaunch = isFirstAssign && options?.launch !== false;
      const { work } = await putTaskWork(agentAssignTask.id, {
        repoUrl: agentMode === 'automation' ? '' : repoUrl,
        repoBranch: agentMode === 'automation' ? '' : repoBranch,
        agentMode,
        ...(agentMode === 'automation'
          ? {
              automationScope: options?.automationScope || 'this_board',
              automationBoardIds: options?.automationBoardIds || [],
            }
          : {}),
        ...(shouldLaunch ? { status: 'queued', entries: { control: 'none' } } : {}),
        ...(options?.llmModel !== undefined ? { llmModel: options.llmModel } : {}),
      });
      setAgentAssignWork(work || {});
      setAgentAssignTask(withDescription);
      if (options?.restart) {
        const { work: resumed } = await setTaskWorkControl(agentAssignTask.id, 'resume');
        setAgentAssignWork(resumed || work || {});
      }
      setAgentPanelView('activity');
    } catch (error) {
      console.error('List view assign to agent failed:', error);
      throw error;
    } finally {
      setAgentAssignBusy(false);
    }
  };

  const handleListAgentControl = async (
    control: 'pause' | 'stop' | 'resume' | 'apply'
  ) => {
    if (!agentAssignTask) return;
    setAgentAssignBusy(true);
    try {
      const { work } = await setTaskWorkControl(agentAssignTask.id, control);
      setAgentAssignWork(work || {});
    } catch (error) {
      console.error('List view agent control failed:', error);
    } finally {
      setAgentAssignBusy(false);
    }
  };

  // Comment tooltip handlers
  const handleCommentTooltipShow = (taskId: string) => {
    // Clear any pending hide timeout
    if (commentTooltipTimeoutRef.current) {
      clearTimeout(commentTooltipTimeoutRef.current);
      commentTooltipTimeoutRef.current = null;
    }
    
    // Clear any existing show timeout
    if (commentTooltipShowTimeoutRef.current) {
      clearTimeout(commentTooltipShowTimeoutRef.current);
    }
    
    // Wait 0.5 seconds before showing tooltip
    commentTooltipShowTimeoutRef.current = setTimeout(() => {
      // Calculate best position for tooltip
      const position = calculateTooltipPosition(taskId);
      setTooltipPosition(position);
      setShowCommentTooltip(taskId);
      commentTooltipShowTimeoutRef.current = null;
    }, 500);
  };

  const handleCommentTooltipHide = () => {
    // Cancel any pending show timeout when leaving
    if (commentTooltipShowTimeoutRef.current) {
      clearTimeout(commentTooltipShowTimeoutRef.current);
      commentTooltipShowTimeoutRef.current = null;
    }
    
    // Only hide after a delay to allow mouse movement into tooltip
    commentTooltipTimeoutRef.current = setTimeout(() => {
      setShowCommentTooltip(null);
    }, 500); // Generous delay
  };

  const handleCommentTooltipClose = () => {
    // Immediately close tooltip without delay
    if (commentTooltipTimeoutRef.current) {
      clearTimeout(commentTooltipTimeoutRef.current);
      commentTooltipTimeoutRef.current = null;
    }
    if (commentTooltipShowTimeoutRef.current) {
      clearTimeout(commentTooltipShowTimeoutRef.current);
      commentTooltipShowTimeoutRef.current = null;
    }
    setShowCommentTooltip(null);
  };

  const calculateTooltipPosition = (taskId: string) => {
    const containerRef = commentContainerRefs.current[taskId];
    if (containerRef) {
      const commentRect = containerRef.getBoundingClientRect();
      const tooltipWidth = 320; // w-80 = 320px
      const tooltipHeight = 256; // max-h-64 = 256px
      
      // Find the table row element that contains this comment
      let rowElement = containerRef.closest('tr');
      if (!rowElement) {
        // Fallback to comment container if row not found
        rowElement = containerRef;
      }
      
      const rowRect = rowElement.getBoundingClientRect();
      
      // Calculate vertical position based on the row
      const spaceAbove = rowRect.top;
      const spaceBelow = window.innerHeight - rowRect.bottom;
      const vertical: 'above' | 'below' = spaceAbove >= tooltipHeight ? 'above' : spaceBelow >= tooltipHeight ? 'below' : 'above';
      
      // Calculate horizontal position - center tooltip on the comment icon
      let left = commentRect.left + (commentRect.width / 2) - (tooltipWidth / 2);
      const spaceRight = window.innerWidth - (left + tooltipWidth);
      
      // If tooltip would go beyond right edge, align to right edge of viewport
      if (spaceRight < 20) {
        left = window.innerWidth - tooltipWidth - 20; // 20px padding from edge
      }
      
      // If tooltip would go beyond left edge, align to left edge
      if (left < 20) {
        left = 20;
      }
      
      // Position tooltip close to the comment icon
      let top;
      if (vertical === 'above') {
        top = commentRect.top - 20; // Just 20px above the comment icon
      } else {
        top = commentRect.bottom + 20; // Just 20px below the comment icon
      }
      
      return {
        vertical,
        left,
        top
      };
    }
    return { vertical: 'above', left: 0, top: 0 };
  };

  let visibleColumns = columns.filter(col => {
    if (!col.visible) return false;
    if (col.key === 'sprint' && isSingleSprintListFilter) return false;
    return true;
  });
  if (visibleColumns.length === 0 && isSingleSprintListFilter) {
    visibleColumns = columns.filter(col => col.visible);
  }

  const listViewRowNumColumnStyle = {
    width: LIST_VIEW_ROW_NUM_WIDTH_PX,
    minWidth: LIST_VIEW_ROW_NUM_WIDTH_PX,
    maxWidth: LIST_VIEW_ROW_NUM_WIDTH_PX,
  } as const;

  const listViewTableMinWidthPx = (() => {
    let total = LIST_VIEW_ROW_NUM_WIDTH_PX;
    for (const column of visibleColumns) {
      total +=
        column.key === 'ticket'
          ? column.width + ticketColumnWidthBoost
          : column.width;
    }
    return total;
  })();

  const listViewTableWidthStyle = {
    minWidth: listViewTableMinWidthPx,
    width: listViewTableMinWidthPx,
  } as const;

  const listViewColGroup = (
    <colgroup>
      <col style={listViewRowNumColumnStyle} />
      {visibleColumns.map((column, columnIndex) => {
        const isLastColumn = columnIndex === visibleColumns.length - 1;
        const colWidth =
          column.key === 'ticket'
            ? column.width + ticketColumnWidthBoost
            : column.width;
        return (
          <col
            key={column.key}
            style={
              isLastColumn
                ? { minWidth: colWidth, width: colWidth }
                : { width: colWidth, minWidth: colWidth, maxWidth: colWidth }
            }
          />
        );
      })}
    </colgroup>
  );

  const selectedBulkIds = Array.from(checkedTaskIds);

  return (
    <>
      <TaskBulkActionGutter
        anchorRef={listRootRef}
        controlId="list-view"
        selectedTaskIds={selectedBulkIds}
        tasks={allTasks}
        onClearSelection={() => onClearAllChecked?.()}
        canMutate={canMutate}
        busy={bulkBusy}
        currentUser={currentUser}
        members={members}
        availableTags={availableTags}
        availablePriorities={availablePriorities}
        availableSprints={propSprints || []}
        boards={boards || []}
        currentBoardId={selectedBoard}
        hasArchiveColumn={hasArchiveColumn}
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
      />
    <div
      ref={listRootRef}
      className="rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
    >
        {/* Viewport sticky — must stay outside overflow-hidden/auto ancestors. */}
        <div
          className="sticky z-40 overflow-visible bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 shadow-sm"
          style={{ top: stickyHeaderTopPx }}
        >
          <div ref={tableHeaderScrollRef} className="overflow-x-hidden overflow-y-visible w-full">
            <table
              className={`${LIST_VIEW_TABLE_CLASS} ${resizingColumnKey ? 'select-none' : ''}`}
              style={listViewTableWidthStyle}
            >
              {listViewColGroup}
              <thead>
            <tr>
              {/* Row number column with column management dropdown */}
              <th
                className={`px-4 py-3 align-middle text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider relative group bg-gray-50 dark:bg-gray-700 ${LIST_VIEW_COLUMN_SEPARATOR_CLASS}`}
                style={listViewRowNumColumnStyle}
              >
                <div className="flex items-center justify-between">
                  <span>#</span>
                  <div className="flex items-center gap-1">
                    {userCanExport(currentUser) && (
                    <ExportMenu
                      boards={boards || []}
                      selectedBoard={boards?.find(b => b.id === selectedBoard) || boards?.[0] || { id: '', title: '', columns: {} }}
                      members={members}
                      availableTags={availableTags}
                      availablePriorities={availablePriorities}
                      isAdmin={currentUser?.roles?.includes('admin') || false}
                    />
                    )}
                    <KanbanChromeTooltip label={t('listView.showHideColumns')} delayMs={0}>
                      <button
                        ref={columnMenuButtonRef}
                        type="button"
                        onClick={handleColumnMenuToggle}
                        className="opacity-60 hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-opacity"
                        aria-label={t('listView.showHideColumns')}
                        data-tour-id="column-visibility"
                      >
                        <Menu size={14} />
                      </button>
                    </KanbanChromeTooltip>
                  </div>
                </div>

              </th>
              {visibleColumns.map((column, columnIndex) => {
                const effCount = countEffectiveVisibleColumns(columns);
                const cannotHideLast = effCount === 1;
                const columnLabel =
                  t(`columnLabels.${column.key}`, { ns: 'tasks' }) || column.label;
                const showColumnSeparator = columnIndex < visibleColumns.length - 1;
                const isLastColumn = columnIndex === visibleColumns.length - 1;
                return (
                <th
                  key={column.key}
                  className={`px-4 py-3 align-middle text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 relative group bg-gray-50 dark:bg-gray-700 ${
                    showColumnSeparator ? LIST_VIEW_COLUMN_SEPARATOR_CLASS : ''
                  } ${isLastColumn ? 'pr-5' : ''} ${
                    resizingColumnKey === column.key ? 'bg-gray-100 dark:bg-gray-600' : ''
                  }`}
                  style={columnSizeStyle(column, isLastColumn)}
                  onClick={() => handleSort(column.key)}
                >
                  <div className="flex items-center justify-between gap-1 pr-1">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      {column.key === 'ticket' && (
                        <span
                          className="relative shrink-0 flex items-center"
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                        >
                          <KanbanChromeTooltip label={t('listView.showHideDependencies')} delayMs={0}>
                            <button
                              type="button"
                              aria-label={t('listView.showHideDependencies')}
                              aria-pressed={showListDependencyTree}
                              onClick={() => {
                                const next = !showListDependencyTree;
                                setShowListDependencyTree(next);
                                void updateUserPreference(
                                  'listViewShowDependencies',
                                  next,
                                  currentUser?.id ?? null
                                );
                              }}
                              className={`p-1 rounded transition-colors ${
                                showListDependencyTree
                                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                            >
                              <GitBranch size={14} />
                            </button>
                          </KanbanChromeTooltip>
                        </span>
                      )}
                      <span className="truncate">
                        {columnLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {sortField === column.key && (
                        sortDirection === 'asc' ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />
                      )}
                      {!cannotHideLast && (
                        <KanbanChromeTooltip
                          label={t('listView.hideColumn', { column: columnLabel })}
                          delayMs={0}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleColumnVisibility(column.key);
                            }}
                            className="opacity-50 hover:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-opacity"
                            aria-label={t('listView.hideColumn', { column: columnLabel })}
                          >
                            <X size={12} />
                          </button>
                        </KanbanChromeTooltip>
                      )}
                    </div>
                  </div>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t('listView.resizeColumn')}
                    title={t('listView.resizeColumn')}
                    className={`absolute right-0 top-0 z-[1] h-full w-1.5 cursor-col-resize touch-none ${
                      resizingColumnKey === column.key
                        ? 'bg-blue-500/70'
                        : 'bg-transparent hover:bg-blue-400/50'
                    }`}
                    onMouseDown={(e) => handleColumnResizeStart(e, column.key)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                );
              })}
            </tr>
              </thead>
            </table>
          </div>
        </div>

        {/* Body scrolls horizontally; header scrollLeft stays in sync. */}
        <div
          ref={tableContainerRef}
          className="relative z-0 overflow-x-auto w-full scroll-pr-4"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#CBD5E1 #F1F5F9',
          }}
          onScroll={handleTableBodyScroll}
        >
        <table
          className={`${LIST_VIEW_TABLE_CLASS} divide-y divide-gray-200 dark:divide-gray-700 ${
            resizingColumnKey ? 'select-none' : ''
          }`}
          style={listViewTableWidthStyle}
        >
          {listViewColGroup}
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {tableTasks.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {t('listView.noTasksFound')}
                </td>
              </tr>
            ) : (
              tableTasks.map((task, index) => {
                const taskChecked = checkedTaskIds.has(task.id);
                const relatedPeerIds = relatedPeerIdsByTask.get(task.id) || [];
                // Animation classes based on phase
                const getAnimationClasses = () => {
                  if (animatingTask !== task.id) return '';
                  
                  switch (animationPhase) {
                    case 'highlight':
                      return 'bg-yellow-200 border-l-4 border-yellow-500 transform scale-105 transition-all duration-500';
                    case 'slide':
                      return 'bg-blue-200 border-l-4 border-blue-500 transform translate-y-4 transition-all duration-800';
                    case 'fade':
                      return 'bg-green-100 border-l-4 border-green-500 transition-all duration-1000';
                    default:
                      return '';
                  }
                };
                
                return (
                <React.Fragment key={task.id}>
                  {/* Main task row */}
                  <tr
                    data-task-id={task.id}
                    className={`group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-300 ${
                      taskChecked
                        ? 'bg-green-50 dark:bg-green-950/40'
                        : selectedTask?.id === task.id
                          ? 'bg-blue-50 dark:bg-blue-900'
                          : ''
                    } ${getAnimationClasses()}`}
                    onMouseDown={(event) => {
                      if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => handleTaskContentClick(task, event)}
                  >
                  {/* Row number and actions cell */}
                  <td
                    className={`px-4 py-2 align-middle whitespace-nowrap text-xs text-gray-500 ${LIST_VIEW_COLUMN_SEPARATOR_CLASS}`}
                    style={listViewRowNumColumnStyle}
                  >
                    <div className="flex items-center gap-1 min-h-[1.75rem]">
                      <span className="text-xs text-gray-500 mr-1">{index + 1}</span>
                      {canMutate && (
                      <div
                        className={`flex items-center gap-0.5 transition-opacity ${
                          taskChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                        onMouseLeave={() => setRowActionTooltip(null)}
                      >
                        {/* Copy / Delete — hover; selection checkbox when checked */}
                        <span className="relative inline-flex">
                          <button
                            type="button"
                            aria-label={t('listView.copyTask')}
                            onMouseEnter={() =>
                              setRowActionTooltip({ taskId: task.id, action: 'copy' })
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              onCopyTask(task);
                            }}
                            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
                          >
                            <Copy size={12} />
                          </button>
                          {rowActionTooltip?.taskId === task.id &&
                          rowActionTooltip?.action === 'copy' ? (
                            <span className={LIST_VIEW_INSTANT_TOOLTIP_CLASS}>
                              {t('listView.copyTask')}
                            </span>
                          ) : null}
                        </span>
                        <span className="relative inline-flex">
                          <button
                            type="button"
                            aria-label={
                              currentUser?.roles?.includes('admin')
                                ? t('listView.deleteTaskAdminHint')
                                : t('listView.deleteTask')
                            }
                            onMouseEnter={() =>
                              setRowActionTooltip({ taskId: task.id, action: 'delete' })
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveTask(task.id, e);
                            }}
                            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </button>
                          {rowActionTooltip?.taskId === task.id &&
                          rowActionTooltip?.action === 'delete' ? (
                            <span className={LIST_VIEW_INSTANT_TOOLTIP_CLASS}>
                              {currentUser?.roles?.includes('admin')
                                ? t('listView.deleteTaskAdminHint')
                                : t('listView.deleteTask')}
                            </span>
                          ) : null}
                        </span>
                        {taskChecked && onToggleTaskChecked && (
                          <span
                            className="inline-flex shrink-0 pl-0.5"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ModernCheckbox
                              checked
                              onChange={() => onToggleTaskChecked(task.id)}
                              size="sm"
                              aria-label={t('kanbanSelect.selectTask', { ns: 'tasks' })}
                            />
                          </span>
                        )}
                      </div>
                      )}
                    </div>
                  </td>
                  {visibleColumns.map((column, columnIndex) => {
                    const isLastColumn = columnIndex === visibleColumns.length - 1;
                    return (
                    <td 
                      key={column.key} 
                      className={`px-4 py-2 align-middle ${isLastColumn ? 'overflow-visible pr-5' : 'overflow-hidden'} ${column.key !== 'title' ? 'whitespace-nowrap' : ''} ${
                        columnIndex < visibleColumns.length - 1 ? LIST_VIEW_COLUMN_SEPARATOR_CLASS : ''
                      }`}
                      style={columnSizeStyle(column, isLastColumn)}
                    >
                      {column.key === 'title' && (
                        <div
                          className="max-w-full -mx-4 -my-2 px-4 py-2 flex flex-col justify-center min-h-[2.75rem]"
                          onDoubleClick={(event) => {
                            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                            if (clickTimerRef.current) {
                              clearTimeout(clickTimerRef.current);
                              clickTimerRef.current = null;
                            }
                            startEditing(task.id, 'title', task.title);
                          }}
                        >
                          {editingCell?.taskId === task.id && editingCell?.field === 'title' ? (
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={saveEdit}
                              onKeyDown={handleKeyDown}
                              className="text-sm font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 outline-none focus:border-blue-500 w-full"
                              onClick={(e) => e.stopPropagation()}
                              maxLength={TASK_TITLE_MAX_LENGTH}
                            />
                          ) : (
                            <div 
                              className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 py-0.5" 
                              title={task.title}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                                // Cancel pending single-click timer to prevent TaskDetails from opening
                                if (clickTimerRef.current) {
                                  clearTimeout(clickTimerRef.current);
                                  clickTimerRef.current = null;
                                }
                                // Double click enters edit mode
                                startEditing(task.id, 'title', task.title);
                              }}
                            >
                              {task.title}
                            </div>
                          )}
                          {task.description && taskViewMode !== 'compact' && (
                            editingCell?.taskId === task.id && editingCell?.field === 'description' ? (
                              <div onClick={(e) => e.stopPropagation()}>
                                <TextEditor
                                  onSubmit={async (content) => {
                                    setEditValue(content);
                                    const task = allTasks.find(t => t.id === editingCell.taskId);
                                    if (task) {
                                      await onEditTask({ ...task, description: content });
                                    }
                                    setEditingCell(null);
                                  }}
                                  onCancel={cancelEditing}
                                  onChange={(content) => setEditValue(content)}
                                  initialContent={editValue}
                                  placeholder={t('listView.enterTaskDescription')}
                                  maxLength={TASK_DESCRIPTION_MAX_LENGTH}
                                  compact={true}
                                  showSubmitButtons={false}
                                  resizable={false}
                                  toolbarOptions={{
                                    bold: true,
                                    italic: true,
                                    underline: false,
                                    link: true,
                                    lists: true,
                                    alignment: false,
                                    attachments: false
                                  }}
                                  allowImagePaste={false}
                                  allowImageDelete={false}
                                  allowImageResize={true}
                                  imageDisplayMode="compact"
                                  className="w-full"
                                />
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  <span>Press Enter to save (or add list items), Shift+Enter for new line, Escape to cancel, or click outside to save</span>
                                </div>
                              </div>
                            ) : (
                              <KanbanChromeTooltip
                                content={
                                  taskViewMode === 'shrink' && task.description ? (
                                    <div
                                      className="chrome-tooltip-html-preview"
                                      dangerouslySetInnerHTML={{
                                        __html: truncateHtmlByChars(
                                          buildListViewDescriptionHtml(task.description, siteSettings)
                                        ),
                                      }}
                                    />
                                  ) : undefined
                                }
                                maxWidth={280}
                                wrapperClassName="block min-w-0"
                              >
                              <div 
                                className={`text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600/60 rounded px-1 py-0.5 prose prose-sm dark:prose-invert max-w-none ${
                                  taskViewMode === 'shrink' ? 'task-description-shrink line-clamp-2 overflow-hidden' : 'break-words'
                                }`} 
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  if ((e.target as HTMLElement).closest('a')) {
                                    return;
                                  }
                                  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                                  // Cancel pending single-click timer to prevent TaskDetails from opening
                                  if (clickTimerRef.current) {
                                    clearTimeout(clickTimerRef.current);
                                    clickTimerRef.current = null;
                                  }
                                  // Double click enters edit mode
                                  startEditing(task.id, 'description', task.description);
                                }}
                                dangerouslySetInnerHTML={{
                                  __html: buildListViewDescriptionHtml(task.description, siteSettings),
                                }}
                              />
                              </KanbanChromeTooltip>
                            )
                          )}
                        </div>
                      )}
                      {column.key === 'sprint' && (
                        <div className="flex items-center gap-1 min-h-[1.75rem]">
                          <div className="relative inline-flex shrink-0">
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label={t('listView.clickToSelectSprint')}
                              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full p-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleSprintSelectorOpen(task.id, e);
                                }
                              }}
                              onMouseEnter={() => setSprintCalTooltipTaskId(task.id)}
                              onMouseLeave={() =>
                                setSprintCalTooltipTaskId(prev =>
                                  prev === task.id ? null : prev
                                )
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSprintSelectorOpen(task.id, e);
                              }}
                            >
                              <Calendar
                                size={12}
                                className="text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                              />
                            </div>
                            {sprintCalTooltipTaskId === task.id ? (
                              <span className={LIST_VIEW_INSTANT_TOOLTIP_CLASS}>
                                {t('listView.clickToSelectSprint')}
                              </span>
                            ) : null}
                          </div>
                          {task.sprintId ? (
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                              {getSprintName(task.sprintId) || '-'}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </div>
                      )}
                      {column.key === 'ticket' && (
                        <div className="flex items-center gap-1 text-sm text-gray-600 font-mono">
                          {showListDependencyTree && (
                            <ListDependencyGutter {...(listDepMetaById.get(task.id) ?? { depth: 0, verticalMask: [], isLastChild: true })} />
                          )}
                          <div className="shrink-0 whitespace-nowrap">
                            {task.ticket ? (
                              <a
                                href={generateTaskUrl(task.ticket, getProjectIdentifier(task.boardId || ''))}
                                {...(getLinkTarget(siteSettings)
                                  ? { target: '_blank', rel: 'noopener noreferrer' }
                                  : {})}
                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline transition-colors cursor-pointer"
                                data-help-target="task-page-link"
                                title={`Go to task ${task.ticket}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {task.ticket}
                              </a>
                            ) : (
                              '-'
                            )}
                          </div>
                          {showListDependencyTree && relatedPeerIds.length > 0 && (
                              <KanbanChromeTooltip
                                label={[
                                  t('relationships.relatedTasks'),
                                  ...relatedPeerIds.map((peerId) => {
                                    const peer = taskById.get(peerId);
                                    if (!peer) return peerId;
                                    const ticket = peer.ticket?.trim();
                                    const title = peer.title?.trim() || t('trash.untitled');
                                    return ticket ? `${ticket} · ${title}` : title;
                                  }),
                                ].join('\n')}
                                delayMs={0}
                              >
                                <span
                                  className="inline-flex shrink-0 cursor-default items-center gap-0.5 text-amber-500 dark:text-amber-400"
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={t('relationships.relatedTasks')}
                                >
                                  <Link2 size={12} strokeWidth={2.25} />
                                  {relatedPeerIds.length > 1 && (
                                    <span className="text-[9px] font-medium">
                                      {relatedPeerIds.length}
                                    </span>
                                  )}
                                </span>
                              </KanbanChromeTooltip>
                            )}
                        </div>
                      )}
                      {column.key === 'assignee' && (
                        <div className="relative flex min-h-[1.75rem] items-center gap-2">
                          <div
                            className="cursor-pointer"
                            data-list-dropdown-trigger
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDropdown(task.id, 'assignee', e);
                            }}
                          >
                            {getMemberDisplay(task.memberId)}
                          </div>
                          {renderWatchersCollaborators(task)}
                        </div>
                      )}
                      {column.key === 'priority' && (
                        <div className="relative flex items-center min-h-[1.75rem]">
                          <div 
                            className="cursor-pointer inline-flex items-center"
                            data-list-dropdown-trigger
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDropdown(task.id, 'priority', e);
                            }}
                          >
                            {(() => {
                              // Always use priorityId to look up current priority name (handles renamed priorities)
                              if (task.priorityId) {
                                const priorityOption = availablePriorities.find(p => p.id === task.priorityId);
                                if (priorityOption) {
                                  return getPriorityDisplay(priorityOption.priority);
                                }
                              }
                              // Fallback: use priorityName from API (from JOIN), or stored priority name
                              return getPriorityDisplay(task.priorityName || task.priority || '');
                            })()}
                          </div>
                          
                          {/* Completed Column Banner Overlay - positioned over priority */}
                          {isColumnFinished(task.columnId) && !isColumnArchived(task.columnId) && (
                            <div className="absolute inset-0 pointer-events-none z-30">
                              {/* Diagonal banner background */}
                              <div className="absolute top-0 right-0 w-full h-full">
                                <div 
                                  className="absolute top-0 right-0 w-0 h-0"
                                  style={{
                                    borderLeft: '60px solid transparent',
                                    borderBottom: '100% solid rgba(34, 197, 94, 0.2)',
                                    transform: 'translateX(0)'
                                  }}
                                />
                              </div>
                              {/* "DONE" stamp */}
                              <div className="absolute top-0.5 right-0.5">
                                <div className="bg-green-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-lg opacity-95 transform -rotate-12">
                                  {t('taskCard.done')}
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Overdue Task Banner Overlay - positioned over priority */}
                          {!isColumnFinished(task.columnId) && !isColumnArchived(task.columnId) && isTaskOverdue(task) && siteSettings?.HIGHLIGHT_OVERDUE_TASKS === 'true' && (
                            <div className="absolute inset-0 pointer-events-none z-30">
                              {/* Diagonal banner background */}
                              <div className="absolute top-0 right-0 w-full h-full">
                                <div 
                                  className="absolute top-0 right-0 w-0 h-0"
                                  style={{
                                    borderLeft: '60px solid transparent',
                                    borderBottom: '100% solid rgba(239, 68, 68, 0.2)',
                                    transform: 'translateX(0)'
                                  }}
                                />
                              </div>
                              {/* "LATE" stamp */}
                              <div className="absolute top-0.5 right-0.5">
                                <div className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-lg opacity-95 transform -rotate-12">
                                  {t('taskCard.late')}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {column.key === 'column' && (
                        <div className="relative flex items-center min-h-[1.75rem]">
                          <span 
                            className="inline-flex items-center px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded text-xs cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600"
                            data-list-dropdown-trigger
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDropdown(task.id, 'column', e);
                            }}
                          >
                            {task.columnTitle}
                          </span>
                        </div>
                      )}
                      {column.key === 'startDate' && (
                        <div className="flex items-center min-h-[1.75rem]">
                          {(() => {
                            const validation = getDateValidation(task);
                            return (
                              <span 
                                className={`text-xs font-mono cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600/60 rounded px-1 py-0.5 text-gray-700 dark:text-gray-300 ${
                                  !validation.startDateValid ? 'font-semibold ring-1 ring-red-400' : ''
                                }`}
                                onClick={(e) => handleDateRangeClick(task.id, e)}
                                onMouseEnter={(e) => {
                                  if (!validation.startDateValid) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setDateTooltipInfo({
                                      taskId: task.id,
                                      dateType: 'start',
                                      message: validation.startDateError,
                                      position: {
                                        left: rect.left + rect.width / 2,
                                        top: rect.top - 4
                                      }
                                    });
                                  }
                                }}
                                onMouseLeave={() => setDateTooltipInfo(null)}
                                title={!validation.startDateValid ? validation.startDateError : 'Click to change dates'}
                              >
                                {formatDate(task.startDate)}
                              </span>
                            );
                          })()}
                        </div>
                      )}
                      {column.key === 'dueDate' && (
                        <div className="flex items-center min-h-[1.75rem]">
                        {task.dueDate ? (
                          (() => {
                            const validation = getDateValidation(task);
                            const isOverdue = (() => {
                              // Don't show red for tasks in finished columns (due date is irrelevant)
                              if (isColumnFinished(task.columnId)) {
                                return false;
                              }
                              
                              const dueDate = parseLocalDate(task.dueDate);
                              const today = new Date();
                              today.setHours(0, 0, 0, 0);
                              dueDate.setHours(0, 0, 0, 0);
                              return !isNaN(dueDate.getTime()) && dueDate < today;
                            })();
                            
                            const hasValidationError = !validation.dueDateValid;
                            const className = `inline-flex items-center text-xs font-mono cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600/60 rounded px-1 py-0.5 ${
                              hasValidationError 
                                ? 'font-semibold ring-1 ring-red-400'
                                : ''
                            } ${
                              isOverdue 
                                ? 'text-red-600 dark:text-red-400' 
                                : 'text-gray-700 dark:text-gray-300'
                            }`;
                            
                            return (
                              <span 
                                className={className}
                                onClick={(e) => handleDateRangeClick(task.id, e)}
                                onMouseEnter={(e) => {
                                  if (hasValidationError) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setDateTooltipInfo({
                                      taskId: task.id,
                                      dateType: 'due',
                                      message: validation.dueDateError,
                                      position: {
                                        left: rect.left + rect.width / 2,
                                        top: rect.top - 4
                                      }
                                    });
                                  }
                                }}
                                onMouseLeave={() => setDateTooltipInfo(null)}
                                title={hasValidationError ? validation.dueDateError : (isOverdue ? 'Overdue' : 'Click to change dates')}
                              >
                                {formatDate(task.dueDate)}
                              </span>
                            );
                          })()
                        ) : (
                          <span 
                            className="inline-flex items-center text-gray-400 dark:text-gray-500 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600/60 rounded px-1 py-0.5 border border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
                            onClick={(e) => handleDateRangeClick(task.id, e)}
                            title={t('listView.clickToSetDate')}
                          >
                            {t('listView.clickToSetDate')}
                          </span>
                        )}
                        </div>
                      )}
                      {column.key === 'tags' && (
                        <div className="relative flex items-center min-h-[1.75rem]">
                          <div 
                            className="cursor-pointer inline-flex items-center"
                            data-list-dropdown-trigger
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDropdown(task.id, 'tags', e);
                            }}
                          >
                            {getTagsDisplay(task.tags || [])}
                          </div>
                        </div>
                      )}
                      {column.key === 'comments' && (() => {
                        const commentCount = task.comments?.length || 0;
                        return (
                          <div
                            ref={(el) => { commentContainerRefs.current[task.id] = el; }}
                            className="relative"
                            onMouseEnter={() => {
                              if (commentCount > 0) handleCommentTooltipShow(task.id);
                            }}
                            onMouseLeave={handleCommentTooltipHide}
                          >
                            {(() => {
                              const commentButton = (
                                <button
                                  type="button"
                                  className={`flex items-center gap-0.5 rounded-full px-1 py-1 transition-colors ${
                                    commentCount > 0
                                      ? 'text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900'
                                      : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (commentCount === 0) {
                                      openAddCommentForTask(task.id);
                                    }
                                  }}
                                  aria-label={
                                    commentCount > 0
                                      ? t('listView.hoverToViewComments')
                                      : t('listView.addComment')
                                  }
                                >
                                  <MessageCircle size={12} />
                                  {commentCount > 0 && (
                                    <span className="font-medium text-xs">{commentCount}</span>
                                  )}
                                </button>
                              );
                              // Preview panel already opens on hover when comments exist — skip chrome tip.
                              if (commentCount > 0) return commentButton;
                              return (
                                <KanbanChromeTooltip
                                  label={t('listView.addComment')}
                                  wrapperClassName="inline-flex"
                                >
                                  {commentButton}
                                </KanbanChromeTooltip>
                              );
                            })()}
                          </div>
                        );
                      })()}
                      {column.key === 'createdAt' && (
                        <span className="text-xs text-gray-500 font-mono">
                          {formatToYYYYMMDDHHmmss(task.createdAt)}
                        </span>
                      )}
                    </td>
                    );
                  })}
                </tr>
                </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
        </div>

      {/* Click outside to close column menu */}
      {showColumnMenu && (
        <div
          className="fixed inset-0 z-5"
          onClick={() => setShowColumnMenu(null)}
        />
      )}

      {/* Portal-rendered comment tooltip */}
      {showCommentTooltip && createPortal(
        <div 
          className={`comment-tooltip fixed z-[9999] ${CHROME_TOOLTIP_PANEL_SURFACE_CLASS}`}
          style={{
            left: `${tooltipPosition.left}px`,
            top: `${tooltipPosition.top}px`
          }}
          onMouseEnter={() => handleCommentTooltipShow(showCommentTooltip)}
          onMouseLeave={handleCommentTooltipHide}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const task = allTasks.find(t => t.id === showCommentTooltip);
            if (!task || !task.comments) return null;

            return (
              <>
                {/* Scrollable comments area */}
                <div className="p-3 overflow-y-auto flex-1">
                  {task.comments
                    .filter(comment => 
                      comment && 
                      comment.id && 
                      comment.text && 
                      comment.authorId && 
                      comment.createdAt
                    )
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((comment, index) => {
                      const author = members.find(m => m.id === comment.authorId);
                      
                      // Function to render HTML content with safe link handling and blob URL fixing
                      const renderCommentHTML = (htmlText: string) => {
                        // First, fix blob URLs by replacing them with authenticated server URLs
                        let fixedContent = commentTextToHtml(htmlText);
                        const blobPattern = /blob:[^"]*#(img-[^"]*)/g;
                        fixedContent = fixedContent.replace(blobPattern, (_match, filename) => {
                          // Convert blob URL to authenticated server URL
                          const authenticatedUrl = getAuthenticatedAttachmentUrl(`/attachments/${filename}`);
                          return authenticatedUrl || `/uploads/${filename}`;
                        });
                        
                        // Fallback: Remove ANY remaining blob URLs that couldn't be matched
                        if (fixedContent.includes('blob:')) {
                          // Replace remaining blob URLs in img tags
                          fixedContent = fixedContent.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/gi, '<!-- Image removed: blob URL expired -->');
                          // Also replace any blob URLs in other contexts
                          fixedContent = fixedContent.replace(/blob:[^\s"')]+/gi, '');
                        }

                        fixedContent = DOMPurify.sanitize(fixedContent);

                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = fixedContent;
                        
                        const links = tempDiv.querySelectorAll('a');
                        const opensInNewTab = siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true';
                        
                        links.forEach(link => {
                          if (opensInNewTab) {
                            link.setAttribute('target', '_blank');
                            link.setAttribute('rel', 'noopener noreferrer');
                          } else {
                            link.removeAttribute('target');
                          }
                          link.style.color = '#60a5fa';
                          link.style.textDecoration = 'underline';
                          link.style.wordBreak = 'break-all';
                          link.style.cursor = 'pointer';
                          
                          link.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (opensInNewTab) {
                              window.open(link.href, '_blank', 'noopener,noreferrer');
                            } else {
                              window.location.href = link.href;
                            }
                          });
                        });
                        
                        return { __html: tempDiv.innerHTML };
                      };
                      
                      return (
                        <div key={comment.id} className={`${index > 0 ? 'mt-3 pt-3 border-t border-gray-600' : ''}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <div 
                              className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                              style={{ backgroundColor: author?.color || '#6B7280' }} 
                            />
                            <span className="font-medium text-gray-200">{author?.name || 'Unknown'}</span>
                            <span className="text-gray-400 text-xs">
                              {formatToYYYYMMDDHHmmss(comment.createdAt)}
                            </span>
                            {comment.attachments && comment.attachments.length > 0 && (
                              <Paperclip size={12} className="text-gray-400" title={`${comment.attachments.length} attachment(s)`} />
                            )}
                          </div>
                          <div className="text-gray-300 text-xs leading-relaxed select-text comment-md">
                            <div dangerouslySetInnerHTML={renderCommentHTML(comment.text)} />
                          </div>
                        </div>
                      );
                    })}
                </div>
                
                {/* Sticky footer */}
                <div className="border-t border-gray-600 p-3 bg-gray-800 rounded-b-md flex items-center justify-between gap-2">
                  <span className="text-gray-300 font-medium">
                    {t('taskCard.comments', { count: task.comments.length })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <KanbanChromeTooltip label={t('listView.addComment')} wrapperClassName="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddCommentForTask(task.id);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded bg-gray-700 hover:bg-gray-600 text-gray-100 transition-colors"
                        aria-label={t('listView.addComment')}
                      >
                        <Plus size={14} />
                      </button>
                    </KanbanChromeTooltip>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCommentTooltipClose();
                        onSelectTask(task, { scrollToComments: true });
                      }}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                    >
                      {t('taskCard.open')}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {/* Portal-rendered Assignee Dropdown */}
      {showDropdown?.field === 'assignee' && assigneeDropdownCoords && createPortal(
        <div 
          ref={dropdownRef}
          className="fixed bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg shadow-2xl z-[9999] overflow-hidden flex flex-col"
          style={{
            left: `${assigneeDropdownCoords.left}px`,
            top: `${assigneeDropdownCoords.top}px`,
            width: `${assigneeDropdownCoords.width || 280}px`,
            height: `${assigneeDropdownCoords.height || 280}px`,
            maxHeight: `${assigneeDropdownCoords.height || 280}px`,
          }}
        >
          <MemberSearchList
            members={members || []}
            selectedId={
              allTasks.find((t) => t.id === showDropdown.taskId)?.memberId || null
            }
            showAgentSection
            excludeViewers
            allowClear
            columns={assigneeDropdownCoords.columns || 1}
            onSelect={(memberId) => {
              handleDropdownSelect(showDropdown.taskId, 'memberId', memberId);
            }}
            onEscape={() => {
              setShowDropdown(null);
              setAssigneeDropdownCoords(null);
            }}
            maxHeightClassName="max-h-none"
            className="min-h-0 flex-1"
          />
        </div>,
        document.body
      )}

      {agentAssignTask && (
        <AgentPanel
          panelId={agentAssignTask.id}
          taskTitle={agentAssignTask.title}
          taskTicket={agentAssignTask.ticket}
          taskDescription={agentAssignTask.description}
          work={agentAssignWork}
          comments={agentAssignTask.comments || []}
          members={members}
          busy={agentAssignBusy}
          isAdmin={!!currentUser?.roles?.includes('admin')}
          boards={(boards || []).map((b) => ({
            id: b.id,
            title: b.title || (b as { name?: string }).name || b.id,
          }))}
          view={agentPanelView}
          onViewChange={setAgentPanelView}
          restoreToken={agentPanelRestoreToken}
          onClose={() => {
            setAgentAssignTask(null);
            setAgentAssignWork({});
            setAgentPanelView('configure');
          }}
          onControl={handleListAgentControl}
          onSaveConfig={handleListAssignAgentConfirm}
          aiEnabled={siteSettings?.AI_ENABLED === 'true'}
          isAssigned={isAgentMemberId(agentAssignTask.memberId)}
        />
      )}

      {/* Portal-rendered Priority Dropdown */}
      {showDropdown?.field === 'priority' && priorityDropdownCoords && createPortal(
        <div 
          ref={dropdownRef}
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999] min-w-[120px]"
          style={{
            left: `${priorityDropdownCoords.left}px`,
            top: `${priorityDropdownCoords.top}px`,
          }}
        >
          <div className="py-1">
            {availablePriorities?.map(priority => (
              <button
                key={priority.id}
                onClick={() => handleDropdownSelect(showDropdown.taskId, 'priority', priority.priority)}
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center"
              >
                <span 
                  className="px-1.5 py-0.5 rounded text-xs font-medium mr-2"
                  style={{ 
                    backgroundColor: priority.color + '20',
                    color: priority.color,
                    border: `1px solid ${priority.color}40`
                  }}
                >
                  {priority.priority}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* Portal-rendered Status Dropdown */}
      {showDropdown?.field === 'column' && statusDropdownCoords && createPortal(
        <div 
          ref={dropdownRef}
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999] min-w-[150px]"
          style={{
            left: `${statusDropdownCoords.left}px`,
            top: `${statusDropdownCoords.top}px`,
          }}
        >
          <div className="py-1 flex flex-col">
            {boardColumns && boardColumns.length > 0 ? (
              boardColumns.map((col) => {
                const task = allTasks.find(t => t.id === showDropdown.taskId);
                return (
                  <button
                    key={col.id}
                    onClick={async () => {
                      try {
                        if (!task) return;
                        
                        // Find current column title
                        const currentColumn = boardColumns.find(c => c.id === task.columnId);
                        const targetColumn = col;
                        
                        // Only animate if actually moving to a different column
                        if (currentColumn && currentColumn.id !== targetColumn.id) {
                          // Start animation sequence
                          setAnimatingTask(task.id);
                          setAnimationPhase('highlight');
                          
                          // Phase 1: Highlight (500ms)
                          setTimeout(() => {
                            setAnimationPhase('slide');
                          }, 500);
                          
                          // Phase 2: Slide and move task (800ms)
                          setTimeout(async () => {
                            await onMoveTaskToColumn(task.id, col.id);
                            setAnimationPhase('fade');
                            
                            // After task moves, check if we need to scroll to follow it
                            setTimeout(() => {
                              const newTaskRowElement = document.querySelector(`tr[data-task-id="${task.id}"]`);
                              if (newTaskRowElement) {
                                const rect = newTaskRowElement.getBoundingClientRect();
                                const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
                                
                                if (!isVisible) {
                                  newTaskRowElement.scrollIntoView({ 
                                    behavior: 'smooth', 
                                    block: 'center' 
                                  });
                                }
                              }
                            }, 100);
                          }, 800);
                          
                          // Phase 3: Fade back to normal (1200ms)
                          setTimeout(() => {
                            setAnimatingTask(null);
                            setAnimationPhase(null);
                          }, 2000);
                        } else {
                          // No animation needed, just move
                          await onMoveTaskToColumn(task.id, col.id);
                        }
                        
                        setShowDropdown(null);
                        setStatusDropdownCoords(null);
                      } catch (error) {
                        console.error('Failed to move task to column:', error);
                        setAnimatingTask(null);
                        setAnimationPhase(null);
                      }
                    }}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 block text-gray-900 dark:text-gray-100 ${
                      task?.columnId === col.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''
                    }`}
                  >
                    {columnDisplayTitle({
                      ...col,
                      boardId: selectedBoard || '',
                    })}
                    {task?.columnId === col.id && (
                      <span className="ml-auto text-blue-600 dark:text-blue-400">✓</span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No columns available</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Portal-rendered Tags Dropdown */}
      {showDropdown?.field === 'tags' && tagsDropdownCoords && createPortal(
        <div 
          ref={dropdownRef}
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999] min-w-[180px]"
          style={{
            left: `${tagsDropdownCoords.left}px`,
            top: `${tagsDropdownCoords.top}px`,
          }}
        >
          <div className="py-1 max-h-[400px] overflow-y-auto">
            {/* Add Tag Button */}
            <div 
              onClick={() => {
                setTagModalTaskId(showDropdown.taskId);
                setShowAddTagModal(true);
                setShowDropdown(null);
                setTagsDropdownCoords(null);
              }}
              className="px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer flex items-center gap-2 text-sm border-b border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 font-medium sticky top-0 bg-white dark:bg-gray-800"
            >
              <Plus size={14} />
              <span>Add New Tag</span>
            </div>
            
            <div className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700">
              Click to toggle tags
            </div>
            {availableTags?.map(tag => {
              const task = allTasks.find(t => t.id === showDropdown.taskId);
              const isSelected = task?.tags?.some(t => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={async () => {
                    try {
                      if (!task) return;
                      
                      // Create updated task with modified tags
                      let updatedTask;
                      
                      if (isSelected) {
                        // Remove tag using proper API
                        await removeTagFromTask(task.id, tag.id);
                        // Update local task object
                        updatedTask = { 
                          ...task, 
                          tags: task.tags?.filter(t => t.id !== tag.id) || []
                        };
                      } else {
                        // Add tag using proper API
                        await addTagToTask(task.id, tag.id);
                        // Update local task object
                        updatedTask = { 
                          ...task, 
                          tags: [...(task.tags || []), tag]
                        };
                      }
                      
                      // Close dropdown
                      setShowDropdown(null);
                      setTagsDropdownCoords(null);
                      
                      // Trigger parent refresh with updated task
                      await onEditTask(updatedTask);
                    } catch (error) {
                      console.error('Failed to toggle tag:', error);
                    }
                  }}
                  className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 ${
                    isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                  }`}
                >
                  <span 
                    className="px-1.5 py-0.5 rounded text-xs font-medium"
                    style={(() => {
                      if (!tag.color) {
                        return { backgroundColor: '#6b7280', color: 'white' };
                      }
                      
                      // Calculate luminance to determine text color
                      const hex = tag.color.replace('#', '');
                      if (hex.length === 6) {
                        const r = parseInt(hex.substring(0, 2), 16);
                        const g = parseInt(hex.substring(2, 4), 16);
                        const b = parseInt(hex.substring(4, 6), 16);
                        
                        // Calculate relative luminance
                        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                        
                        // Use dark text for light backgrounds, white text for dark backgrounds
                        const textColor = luminance > 0.6 ? '#374151' : '#ffffff';
                        const borderStyle = textColor === '#374151' ? { border: '1px solid #d1d5db' } : {};
                        
                        return { backgroundColor: tag.color, color: textColor, ...borderStyle };
                      }
                      
                      // Fallback for invalid hex colors
                      return { backgroundColor: tag.color, color: 'white' };
                    })()}
                  >
                    {tag.tag}
                  </span>
                  {isSelected && <span className="ml-auto text-blue-600">✓</span>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {/* Column Management Menu Portal */}
      {showColumnMenu === 'rowNumber' && columnMenuPosition && createPortal(
        <div 
          data-column-menu-portal
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg min-w-[160px] z-[10050]"
          style={{
            top: columnMenuPosition.top,
            left: columnMenuPosition.left,
          }}
        >
          <div className="py-1">
            <div className="px-3 py-2 text-xs font-medium text-gray-700 border-b border-gray-100">
              {t('listView.showHideColumns')}
            </div>
            {columns.map(col => {
              const sprintSuppressed = col.key === 'sprint' && isSingleSprintListFilter;
              const effectiveVisible =
                col.visible && !sprintSuppressed;
              const effCount = countEffectiveVisibleColumns(columns);
              const cannotHideLast = effectiveVisible && effCount === 1;
              return (
                <button
                  key={col.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleColumnVisibility(col.key);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={sprintSuppressed || cannotHideLast}
                  title={
                    sprintSuppressed
                      ? t('listView.sprintColumnUnavailableSingleSprint')
                      : undefined
                  }
                >
                  {effectiveVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span className={cannotHideLast ? 'text-gray-400 dark:text-gray-500' : ''}>
                    {t(`columnLabels.${col.key}`, { ns: 'tasks' }) || col.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {/* Portal-rendered Sprint Selector Dropdown */}
      {showSprintSelector && sprintSelectorCoords && createPortal(
        (() => {
          const sprintSelectorTask = allTasks.find((t) => t.id === showSprintSelector);
          const currentSprintId = sprintSelectorTask?.sprintId ?? null;
          return (
        <div 
          ref={sprintSelectorRef}
          className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[9999]"
          style={{
            left: `${sprintSelectorCoords.left}px`,
            top: `${sprintSelectorCoords.top}px`,
            width: '256px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2">
            <input
              type="text"
              value={sprintSearchTerm}
              onChange={(e) => setSprintSearchTerm(e.target.value)}
              onKeyDown={(e) => handleSprintKeyDown(e, showSprintSelector)}
              placeholder={t('listView.searchSprints')}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              autoFocus
            />
          </div>
          
          <div className="max-h-60 overflow-y-auto">
            {sprintsLoading ? (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                Loading sprints...
              </div>
            ) : (
              <>
                {/* "None (Backlog)" option */}
                {'backlog'.includes(sprintSearchTerm.toLowerCase()) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSprintSelect(showSprintSelector, null);
                    }}
                    onMouseEnter={() => setHighlightedSprintIndex(-1)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-200 dark:border-gray-600 ${
                      currentSprintId == null
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-l-2 border-blue-500'
                        : highlightedSprintIndex === -1
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {t('taskCard.noneBacklog', { ns: 'tasks' })}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {currentSprintId == null && <SprintAssignmentCurrentPill />}
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-400 dark:bg-gray-600 text-white">
                          {t('taskCard.unassigned', { ns: 'tasks' })}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('taskCard.removeFromSprint', { ns: 'tasks' })}
                    </div>
                  </button>
                )}
                
                {sprints.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    No sprints available. Create one in Admin settings.
                  </div>
                ) : (
                  sprints
                    .filter(sprint =>
                      sprint.name.toLowerCase().includes(sprintSearchTerm.toLowerCase())
                    )
                    .map((sprint, index) => (
                      <button
                        key={sprint.id}
                        ref={(el) => (sprintOptionRefs.current[index] = el)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSprintSelect(showSprintSelector, sprint);
                        }}
                        onMouseEnter={() => setHighlightedSprintIndex(index)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                          currentSprintId === sprint.id
                            ? 'bg-blue-100 dark:bg-blue-900/30 border-l-2 border-blue-500'
                            : highlightedSprintIndex === index
                            ? 'bg-blue-50 dark:bg-blue-900/20'
                            : sprint.is_active === 1 || sprint.is_active === true
                            ? 'bg-green-50 dark:bg-green-900/10'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {sprint.name}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {currentSprintId === sprint.id && <SprintAssignmentCurrentPill />}
                            {(sprint.is_active === 1 || sprint.is_active === true) && (
                              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-500 text-white">
                                {t('taskCard.active', { ns: 'tasks' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {formatDate(sprint.start_date)} → {formatDate(sprint.end_date)}
                        </div>
                      </button>
                    ))
                )}
              </>
            )}
          </div>
        </div>
          );
        })(),
        document.body
      )}

      {/* Date Range Picker */}
      {showDateRangePicker && dateRangePickerPosition && createPortal(
        (() => {
          const task = allTasks.find(t => t.id === showDateRangePicker);
          if (!task) return null;
          const sprint = task.sprintId && sprints.length > 0 ? sprints.find(s => s.id === task.sprintId) : null;
          return (
            <DateRangePicker
              startDate={task.startDate || ''}
              endDate={task.dueDate}
              onDateChange={(startDate, endDate) => handleDateRangeChange(showDateRangePicker, startDate, endDate)}
              onClose={handleDateRangePickerClose}
              position={dateRangePickerPosition}
              sprint={sprint}
              availableSprints={sprints}
              sprintsLoading={sprintsLoading}
              onSprintSelect={(chosen) => {
                handleSprintSelect(showDateRangePicker, chosen);
              }}
            />
          );
        })(),
        document.body
      )}

      {/* Date Validation Tooltip */}
      {dateTooltipInfo && createPortal(
        <div
          className="fixed bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg z-[10000] pointer-events-none whitespace-nowrap"
          style={{
            left: `${dateTooltipInfo.position.left}px`,
            top: `${dateTooltipInfo.position.top}px`,
            transform: 'translate(-50%, -100%)',
            marginBottom: '4px'
          }}
        >
          {dateTooltipInfo.message}
          <div 
            className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-600"
          />
        </div>,
        document.body
      )}
      
      {/* Add Tag Modal */}
      {showAddTagModal && createPortal(
        <AddTagModal
          onClose={() => {
            setShowAddTagModal(false);
            setTagModalTaskId(null);
          }}
          onTagCreated={handleTagCreated}
        />,
        document.body
      )}

      <AddCommentModal
        isOpen={Boolean(addCommentTaskId)}
        taskTitle={allTasks.find((t) => t.id === addCommentTaskId)?.title || ''}
        onClose={() => setAddCommentTaskId(null)}
        onSubmit={handleListCommentSubmit}
      />
    </div>
    </>
  );
}
