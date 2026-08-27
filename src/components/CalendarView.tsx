import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
  CheckSquare,
  X,
  CalendarDays,
  Calendar,
  ArrowUpDown,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import type {
  Task,
  Columns,
  TeamMember,
  PriorityOption,
  Comment,
  CurrentUser,
  Board,
  Tag,
} from '../types';
import type { TaskViewMode, CalendarSubView } from '../utils/userPreferences';
import { useColumnDisplayTitle } from '../utils/columnDisplayTitle';
import { loadUserPreferences, updateUserPreference } from '../utils/userPreferences';
import { GanttLegend } from './gantt/GanttLegend';
import { TaskJumpDropdown } from './gantt/TaskJumpDropdown';
import { TaskBarTooltip } from './gantt/TaskBarTooltip';
import ColumnFilterDropdown from './ColumnFilterDropdown';
import MemberAvatar from './ui/MemberAvatar';
import MemberSearchList from './ui/MemberSearchList';
import { layoutMemberDropdownFromElement, type MemberDropdownLayout } from '../utils/memberDropdownLayout';
import AddCommentModal from './AddCommentModal';
import {
  CHROME_TOOLTIP_PANEL_SURFACE_CLASS,
  KanbanChromeTooltip,
} from './KanbanChromeTooltip';
import { createComment, batchUpdateTasks } from '../api';
import { parseLocalDate } from '../utils/dateUtils';
import { getTagDisplayStyle, getTextColorForBackground } from '../utils/tagUtils';
import { memberIsViewer } from '../utils/memberUtils';
import { commentTextToHtml } from '../utils/commentContent';
import { getAuthenticatedAttachmentUrl } from '../utils/authImageUrl';
import { completeTaskJump, subscribeTaskJump } from '../utils/taskJumpEvents';
import {
  formatLocalYmd,
  addDaysLocal,
  isSameDayLocal,
  getTaskDateSpan,
  shiftTaskDates,
  buildMonthCells,
  buildWeekCells,
  placeBarsForDays,
  type PlacedBar,
} from '../utils/calendarDateUtils';
import TaskBulkActionGutter from './TaskBulkActionGutter';
import {
  defaultVisibleColumnIds,
  isArchivedColumnFlag,
  reconcileVisibleColumnIds,
} from '../utils/columnUtils';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** App header height the page sticks under (matches the Gantt view's `top-16`). */
const PAGE_HEADER_OFFSET = 64;
const CALENDAR_DAY_DENSITY = {
  expand: { barHeight: 112, laneGap: 8 },
  shrink: { barHeight: 64, laneGap: 8 },
  compact: { barHeight: 36, laneGap: 4 },
} satisfies Record<TaskViewMode, { barHeight: number; laneGap: number }>;
/** Plus cursor on day numbers so create is distinct from the Day-view arrow. */
const CREATE_TASK_CURSOR: React.CSSProperties = {
  cursor: `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.25" fill="white" stroke="#111827" stroke-width="1.5"/><path d="M12 7v10M7 12h10" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg>'
  )}") 12 12, cell`,
};
/** Bars are tinted by assignee; unassigned work falls back to a neutral gray. */
const UNASSIGNED_BAR_COLOR = '#6B7280';

const CALENDAR_DENSITY = {
  expand: { barHeight: 26, laneGap: 2, monthMinHeight: 88 },
  shrink: { barHeight: 16, laneGap: 2, monthMinHeight: 72 },
  compact: { barHeight: 10, laneGap: 0, monthMinHeight: 52 },
} satisfies Record<
  TaskViewMode,
  { barHeight: number; laneGap: number; monthMinHeight: number }
>;

const selectionSignatureOf = (ids: Iterable<string>): string =>
  Array.from(ids).sort().join('\u0000');

type TaskUpdateHandler = (
  task: Task,
  options?: { skipActivity?: boolean; localOnly?: boolean; skipLoading?: boolean }
) => void | Promise<void>;

export interface CalendarViewProps {
  columns: Columns;
  onSelectTask: (task: Task | null, options?: { scrollToComments?: boolean }) => void;
  selectedTask?: Task | null;
  taskViewMode?: TaskViewMode;
  onUpdateTask?: TaskUpdateHandler;
  boardId?: string | null;
  onAddTask?: (columnId: string, startDate?: string, dueDate?: string) => Promise<void>;
  currentUser?: CurrentUser | null;
  members?: TeamMember[];
  canMutate?: boolean;
  availablePriorities?: PriorityOption[];
  bulkBusy?: boolean;
  onBulkDelete?: (taskIds: string[]) => void | Promise<void>;
  onBulkPermanentDelete?: (taskIds: string[]) => void | Promise<void>;
  availableTags?: Tag[];
  availableSprints?: Array<{ id: string; name: string }>;
  boards?: Board[];
  checkedTaskIds?: Set<string>;
  onReplaceCheckedTaskIds?: (taskIds: string[]) => void;
  onBulkAddTag?: (taskIds: string[], tagId: string) => void;
  onBulkCopy?: (taskIds: string[]) => void;
  onBulkArchive?: (taskIds: string[]) => void;
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
  siteSettings?: { [key: string]: string };
}

type DragMode = 'move' | 'resize-start' | 'resize-end';
type DaySort = 'kanban' | 'priority' | 'status' | 'assignee' | 'title';

interface DragState {
  mode: DragMode;
  taskId: string;
  originStart: string;
  originEnd: string;
  previewStart: string;
  previewEnd: string;
  /** Lane the bar occupied when the drag started; held for the whole drag. */
  lane: number;
  /** Days between the grabbed day and the task start, so `move` keeps the grab point. */
  grabOffsetDays: number;
  /** Day the bar was grabbed on; only that row keeps the pinned lane. */
  grabYmd: string | null;
}

interface TaskCreationState {
  anchorYmd: string;
  currentYmd: string;
}

/** Pointer travel before a press on a bar becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 4;

interface FixedPopoverPosition {
  left: number;
  top: number;
}

function sanitizedCommentHtml(text: string): string {
  let html = commentTextToHtml(text);
  html = html.replace(/blob:[^"]*#(img-[^"]*)/g, (_match, filename) => {
    return getAuthenticatedAttachmentUrl(`/attachments/${filename}`) || '';
  });
  html = html.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/gi, '');
  html = html.replace(/blob:[^\s"')]+/gi, '');
  return DOMPurify.sanitize(html);
}

function flattenTasks(columns: Columns): Task[] {
  return Object.values(columns).flatMap((col) => col.tasks || []);
}

function calendarBarStatus(
  task: Task,
  column: { is_finished?: boolean; is_archived?: boolean | number } | undefined,
  highlightOverdue: boolean
): 'done' | 'late' | null {
  if (!column || isArchivedColumnFlag(column)) return null;
  if (column.is_finished) return 'done';
  if (!highlightOverdue || !task.dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseLocalDate(task.dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today ? 'late' : null;
}

function defaultColumnId(columns: Columns, allowedIds?: string[]): string | null {
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const cols = Object.values(columns)
    .filter((column) => (allowed ? allowed.has(column.id) : true))
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const live = cols.find((c) => !isArchivedColumnFlag(c) && !c.is_finished);
  return (live || cols[0])?.id ?? null;
}

function priorityColor(task: Task, priorities: PriorityOption[]): string {
  if (task.priorityColor) return task.priorityColor;
  const match = priorities.find(
    (p) =>
      String(p.id) === String(task.priorityId) ||
      p.priority === task.priority ||
      p.priority === task.priorityName
  );
  return match?.color || '#64748b';
}

function memberFor(task: Task, members: TeamMember[]): TeamMember | undefined {
  if (!task.memberId) return undefined;
  return members.find((m) => m.id === task.memberId);
}

function dayDiff(fromYmd: string, toYmd: string): number {
  const from = parseLocalDate(fromYmd);
  const to = parseLocalDate(toYmd);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function isoWeekValue(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function dateFromIsoWeek(value: string): Date | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(year, 0, 4);
  const mondayOffset = (januaryFourth.getDay() + 6) % 7;
  return addDaysLocal(januaryFourth, (week - 1) * 7 - mondayOffset);
}

/**
 * Day under the pointer, resolved against whichever row the cursor is over.
 * Dragging vertically onto another week keeps extending the date range instead
 * of clamping to the row where the drag started.
 */
function ymdFromPoint(clientX: number, clientY: number, root: HTMLElement | null): string | null {
  if (!root) return null;
  // The date-number strip sits above each row's bar layer. Resolve its actual
  // day cell first so a press there cannot snap to the previous week's layer.
  const hitDay = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-calendar-day]');
  if (hitDay && root.contains(hitDay) && hitDay.dataset.calendarDay) {
    return hitDay.dataset.calendarDay;
  }

  const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-calendar-days]'));
  let bestLayer: HTMLElement | null = null;
  let bestRect: DOMRect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const layer of layers) {
    const rect = layer.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) continue;
    const distance =
      clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLayer = layer;
      bestRect = rect;
      if (distance === 0) break;
    }
  }

  if (!bestLayer || !bestRect) return null;
  const days = (bestLayer.dataset.calendarDays || '').split(',').filter(Boolean);
  if (days.length === 0) return null;
  const colW = bestRect.width / days.length;
  const idx = Math.max(
    0,
    Math.min(days.length - 1, Math.floor((clientX - bestRect.left) / colW))
  );
  return days[idx];
}

const CalendarView: React.FC<CalendarViewProps> = ({
  columns,
  onSelectTask,
  selectedTask,
  taskViewMode = 'expand',
  onUpdateTask,
  onAddTask,
  boardId,
  currentUser,
  members = [],
  canMutate = true,
  availablePriorities = [],
  bulkBusy = false,
  onBulkDelete,
  onBulkPermanentDelete,
  availableTags = [],
  availableSprints = [],
  boards = [],
  checkedTaskIds,
  onReplaceCheckedTaskIds,
  onBulkAddTag,
  onBulkCopy,
  onBulkArchive,
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
  siteSettings,
}) => {
  const { t, i18n } = useTranslation('common');
  const columnDisplayTitle = useColumnDisplayTitle();
  const prefs = useMemo(() => loadUserPreferences(), []);
  const hydratedColumnBoardRef = useRef<string | null | undefined>(undefined);
  const orderedColumnIds = useMemo(
    () =>
      Object.values(columns)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((column) => column.id),
    [columns]
  );
  const defaultCalendarColumnIds = useMemo(
    () => defaultVisibleColumnIds(columns),
    [columns]
  );
  /**
   * `null` means "no saved choice" so the calendar tracks the default (every
   * active status), the same way Kanban does when a board has no override.
   */
  const [calendarVisibleColumnIds, setCalendarVisibleColumnIds] = useState<string[] | null>(
    () => {
      const saved = boardId
        ? loadUserPreferences(currentUser?.id).calendarColumnVisibility?.[boardId]
        : undefined;
      return reconcileVisibleColumnIds(saved, columns);
    }
  );
  const knownColumnIdsRef = useRef<Set<string>>(new Set());

  const effectiveCalendarColumnIds = useMemo(
    () => calendarVisibleColumnIds ?? defaultCalendarColumnIds,
    [calendarVisibleColumnIds, defaultCalendarColumnIds]
  );

  const persistCalendarColumns = useCallback(
    (ids: string[] | null) => {
      setCalendarVisibleColumnIds(ids);
      if (!boardId) return;
      const current = {
        ...(loadUserPreferences(currentUser?.id).calendarColumnVisibility || {}),
      };
      if (ids) current[boardId] = ids;
      else delete current[boardId];
      void updateUserPreference(
        'calendarColumnVisibility',
        current,
        currentUser?.id ?? null
      );
    },
    [boardId, currentUser?.id]
  );

  useEffect(() => {
    if (orderedColumnIds.length === 0) return;

    // Columns arrive after mount and lag a beat behind a board switch, so a set
    // sharing no id with the previous one means "different board" — read the
    // saved choice for it instead of diffing against the other board's columns.
    const known = knownColumnIdsRef.current;
    const isDifferentColumnSet =
      known.size === 0 || !orderedColumnIds.some((id) => known.has(id));
    if (hydratedColumnBoardRef.current !== boardId || isDifferentColumnSet) {
      hydratedColumnBoardRef.current = boardId;
      knownColumnIdsRef.current = new Set(orderedColumnIds);
      const saved = boardId
        ? loadUserPreferences(currentUser?.id).calendarColumnVisibility?.[boardId]
        : undefined;
      setCalendarVisibleColumnIds(reconcileVisibleColumnIds(saved, columns));
      return;
    }

    // A status created while the calendar is open starts visible, so a new
    // column never lands silently in the hidden set.
    const created = orderedColumnIds.filter(
      (id) => !known.has(id) && !isArchivedColumnFlag(columns[id])
    );
    knownColumnIdsRef.current = new Set(orderedColumnIds);

    const prev = calendarVisibleColumnIds;
    if (!prev) return;

    const next = reconcileVisibleColumnIds([...prev, ...created], columns);
    if (next === null) {
      persistCalendarColumns(null);
      return;
    }
    if (next.length === prev.length && next.every((id, index) => id === prev[index])) return;
    persistCalendarColumns(next);
  }, [
    boardId,
    columns,
    currentUser?.id,
    orderedColumnIds,
    calendarVisibleColumnIds,
    persistCalendarColumns,
  ]);

  const visibleColumns = useMemo(() => {
    const next: Columns = {};
    effectiveCalendarColumnIds.forEach((id) => {
      if (columns[id]) next[id] = columns[id];
    });
    return Object.keys(next).length > 0 ? next : columns;
  }, [effectiveCalendarColumnIds, columns]);

  const [subView, setSubView] = useState<CalendarSubView>(
    () => prefs.calendarSubView || 'month'
  );
  const [focusDate, setFocusDate] = useState<Date>(() => {
    if (prefs.calendarFocusDate) {
      try {
        return parseLocalDate(prefs.calendarFocusDate);
      } catch {
        /* fall through */
      }
    }
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  });

  const [multiSelectMode, setMultiSelectMode] = useState(
    () => Boolean(checkedTaskIds?.size)
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => Array.from(checkedTaskIds || [])
  );
  const calendarRootRef = useRef<HTMLDivElement>(null);
  const sharedSelectionSignature = selectionSignatureOf(checkedTaskIds || []);
  const sharedSelectionSignatureRef = useRef(sharedSelectionSignature);
  const pullingSharedSelectionRef = useRef(false);

  // Keep the board-level selection consistent when moving among Kanban, List,
  // Gantt, and Calendar. A non-empty incoming selection engages Select mode.
  useEffect(() => {
    if (!checkedTaskIds) return;
    if (sharedSelectionSignatureRef.current === sharedSelectionSignature) return;
    sharedSelectionSignatureRef.current = sharedSelectionSignature;
    const shared = Array.from(checkedTaskIds);
    pullingSharedSelectionRef.current = true;
    setSelectedIds(shared);
    if (shared.length > 0) setMultiSelectMode(true);
  }, [checkedTaskIds, sharedSelectionSignature]);

  useEffect(() => {
    if (!onReplaceCheckedTaskIds) return;
    if (pullingSharedSelectionRef.current) {
      pullingSharedSelectionRef.current = false;
      return;
    }
    const shared = checkedTaskIds || new Set<string>();
    const same =
      shared.size === selectedIds.length && selectedIds.every((id) => shared.has(id));
    if (!same) {
      sharedSelectionSignatureRef.current = selectionSignatureOf(selectedIds);
      onReplaceCheckedTaskIds(selectedIds);
    }
  }, [checkedTaskIds, onReplaceCheckedTaskIds, selectedIds]);

  useEffect(() => {
    if (selectedIds.length > 0) onClearBulkUndo?.();
  }, [onClearBulkUndo, selectedIds.length]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [commentTaskId, setCommentTaskId] = useState<string | null>(null);
  const [hoverCommentId, setHoverCommentId] = useState<string | null>(null);
  const [commentPreviewPosition, setCommentPreviewPosition] =
    useState<FixedPopoverPosition | null>(null);
  const [assigneeMenuPosition, setAssigneeMenuPosition] =
    useState<MemberDropdownLayout | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [assigneeMenuTaskId, setAssigneeMenuTaskId] = useState<string | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [daySort, setDaySort] = useState<DaySort>('kanban');
  const [deleteConfirmMode, setDeleteConfirmMode] = useState<'soft' | 'permanent' | null>(
    null
  );
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [taskCreation, setTaskCreation] = useState<TaskCreationState | null>(null);
  const [nudgeDates, setNudgeDates] = useState<
    Record<string, { startDate: string; dueDate?: string }>
  >({});

  /** Toolbar height, so the weekday row can stick directly beneath it. */
  const [toolbarHeight, setToolbarHeight] = useState(80);

  const suppressBarClickRef = useRef(false);
  const selectedTaskRef = useRef(selectedTask);
  const selectionAnchorRef = useRef<string | null>(null);
  const arrowLockRef = useRef(false);
  const nudgeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeDatesRef = useRef(nudgeDates);
  const dragRef = useRef<DragState | null>(null);
  const taskCreationRef = useRef<TaskCreationState | null>(null);
  const taskCreationPendingRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const weekdayRowRef = useRef<HTMLDivElement | null>(null);
  const periodPickerRef = useRef<HTMLInputElement | null>(null);
  const assigneeMenuRef = useRef<HTMLDivElement | null>(null);
  const commentPreviewRef = useRef<HTMLDivElement | null>(null);
  const commentAnchorRectRef = useRef<DOMRect | null>(null);
  const commentShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    nudgeDatesRef.current = nudgeDates;
  }, [nudgeDates]);

  useEffect(() => setPeriodPickerOpen(false), [subView]);

  useEffect(() => {
    if (!periodPickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-calendar-period-picker="true"]')) return;
      setPeriodPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPeriodPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [periodPickerOpen]);

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const measure = () => setToolbarHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (commentShowTimerRef.current) clearTimeout(commentShowTimerRef.current);
      if (commentHideTimerRef.current) clearTimeout(commentHideTimerRef.current);
      if (nudgeCommitTimerRef.current) clearTimeout(nudgeCommitTimerRef.current);
    },
    []
  );

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const tasks = useMemo(() => flattenTasks(visibleColumns), [visibleColumns]);

  /**
   * The selection survives bulk actions, so actions that remove bars (delete,
   * archive, move to another board) must not leave phantom ids behind —
   * keyboard nudges would target tasks that are no longer on the board.
   */
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.length === 0) return prev;
      const live = new Set(tasks.map((task) => task.id));
      const next = prev.filter((id) => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [tasks]);

  const datedTasks = useMemo(
    () => tasks.filter((task) => getTaskDateSpan(task)),
    [tasks]
  );
  const displayedDatedTasks = useMemo(
    () =>
      datedTasks.map((task) => {
        const overlay = nudgeDates[task.id];
        if (!overlay) return task;
        return {
          ...task,
          startDate: overlay.startDate,
          dueDate: overlay.dueDate ?? overlay.startDate,
        };
      }),
    [datedTasks, nudgeDates]
  );

  useEffect(() => {
    if (Object.keys(nudgeDatesRef.current).length === 0) return;
    setNudgeDates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const task = tasks.find((candidate) => candidate.id === id);
        if (!task) {
          delete next[id];
          changed = true;
          continue;
        }
        const overlay = next[id];
        const sameStart = task.startDate === overlay.startDate;
        const sameDue = (task.dueDate || overlay.startDate) === (overlay.dueDate || overlay.startDate);
        if (sameStart && sameDue) {
          delete next[id];
          changed = true;
        }
      }
      if (!changed) return prev;
      nudgeDatesRef.current = next;
      return next;
    });
  }, [tasks]);

  const persistChrome = useCallback(
    (nextSub: CalendarSubView, nextFocus: Date) => {
      const userId = currentUser?.id ?? null;
      void updateUserPreference('calendarSubView', nextSub, userId);
      void updateUserPreference('calendarFocusDate', formatLocalYmd(nextFocus), userId);
    },
    [currentUser?.id]
  );

  const setSubViewPersist = useCallback(
    (next: CalendarSubView) => {
      setSubView(next);
      persistChrome(next, focusDate);
    },
    [focusDate, persistChrome]
  );

  const setFocusPersist = useCallback(
    (next: Date) => {
      setFocusDate(next);
      persistChrome(subView, next);
    },
    [persistChrome, subView]
  );

  const openDayView = useCallback(
    (day: Date) => {
      const focus = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      setSubView('day');
      setFocusDate(focus);
      persistChrome('day', focus);
    },
    [persistChrome]
  );

  const monthCells = useMemo(() => buildMonthCells(focusDate), [focusDate]);
  const weekCells = useMemo(() => buildWeekCells(focusDate), [focusDate]);
  const dayCells = useMemo(
    () => [new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate())],
    [focusDate]
  );

  const kanbanTaskRank = useMemo(() => {
    const rank = new Map<string, number>();
    let next = 0;
    Object.values(columns)
      .map((column, index) => ({ column, index }))
      .sort(
        (a, b) =>
          (a.column.position ?? a.index) - (b.column.position ?? b.index)
      )
      .forEach(({ column }) => {
        (column.tasks || [])
          .map((task, index) => ({ task, index }))
          .sort(
            (a, b) =>
              (a.task.position ?? a.index) - (b.task.position ?? b.index)
          )
          .forEach(({ task }) => rank.set(task.id, next++));
      });
    return rank;
  }, [columns]);

  const compareCalendarTasks = useCallback(
    (a: Task, b: Task): number => {
      const kanbanOrder =
        (kanbanTaskRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (kanbanTaskRank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (subView !== 'day' || daySort === 'kanban') return kanbanOrder;

      const textCompare = (left: string, right: string) =>
        left.localeCompare(right, i18n.language, { sensitivity: 'base' });
      let selectedOrder = 0;
      if (daySort === 'title') {
        selectedOrder = textCompare(a.title || '', b.title || '');
      } else if (daySort === 'assignee') {
        selectedOrder = textCompare(
          memberFor(a, members)?.name || '',
          memberFor(b, members)?.name || ''
        );
      } else if (daySort === 'status') {
        selectedOrder = textCompare(
          Object.values(columns).find((column) => column.id === a.columnId)?.title ||
            a.status ||
            '',
          Object.values(columns).find((column) => column.id === b.columnId)?.title ||
            b.status ||
            ''
        );
      } else if (daySort === 'priority') {
        const priorityRank = (task: Task) => {
          const optionIndex = availablePriorities.findIndex(
            (priority) =>
              String(priority.id) === String(task.priorityId) ||
              priority.priority === task.priority ||
              priority.priority === task.priorityName
          );
          return optionIndex < 0 ? Number.MAX_SAFE_INTEGER : optionIndex;
        };
        selectedOrder = priorityRank(a) - priorityRank(b);
      }
      return selectedOrder || kanbanOrder;
    },
    [
      availablePriorities,
      columns,
      daySort,
      i18n.language,
      kanbanTaskRank,
      members,
      subView,
    ]
  );

  /**
   * Stable range order for Shift+click. Calendar has no single column order, so
   * follow the timeline from left to right and use Kanban order for ties.
   */
  const selectionOrderedIds = useMemo(
    () => {
      const visibleDays =
        subView === 'month' ? monthCells : subView === 'week' ? weekCells : dayCells;
      const visibleStart = visibleDays[0]?.getTime() ?? Number.NEGATIVE_INFINITY;
      const visibleEnd =
        visibleDays[visibleDays.length - 1]?.getTime() ?? Number.POSITIVE_INFINITY;

      return displayedDatedTasks
        .filter((task) => {
          const span = getTaskDateSpan(task);
          return Boolean(
            span && span.end.getTime() >= visibleStart && span.start.getTime() <= visibleEnd
          );
        })
        .sort((a, b) => {
          const aSpan = getTaskDateSpan(a);
          const bSpan = getTaskDateSpan(b);
          const startOrder =
            (aSpan?.start.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (bSpan?.start.getTime() ?? Number.MAX_SAFE_INTEGER);
          if (startOrder !== 0) return startOrder;
          const endOrder =
            (aSpan?.end.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (bSpan?.end.getTime() ?? Number.MAX_SAFE_INTEGER);
          if (endOrder !== 0) return endOrder;
          return compareCalendarTasks(a, b);
        })
        .map((task) => task.id);
    },
    [
      compareCalendarTasks,
      dayCells,
      displayedDatedTasks,
      monthCells,
      subView,
      weekCells,
    ]
  );

  /**
   * Bars for one row. Lanes are always packed from the stored dates, so a drag
   * never reshuffles neighbours; the dragged bar keeps the lane it started in.
   */
  const barsForDays = useCallback(
    (days: Date[]): PlacedBar[] => {
      const placed = placeBarsForDays(displayedDatedTasks, days, compareCalendarTasks);
      const hasNudge = Object.keys(nudgeDates).length > 0;
      const frozenLanes = hasNudge
        ? new Map(
            placeBarsForDays(datedTasks, days, compareCalendarTasks).map((bar) => [
              bar.task.id,
              bar.lane,
            ])
          )
        : null;
      const withFrozenLanes = frozenLanes
        ? placed.map((bar) => ({
            ...bar,
            lane: frozenLanes.get(bar.task.id) ?? bar.lane,
          }))
        : placed;
      if (!drag) return withFrozenLanes;

      const others = withFrozenLanes.filter((bar) => bar.task.id !== drag.taskId);
      const dragged = displayedDatedTasks.find((task) => task.id === drag.taskId);
      if (!dragged) return others;

      const [previewBar] = placeBarsForDays(
        [{ ...dragged, startDate: drag.previewStart, dueDate: drag.previewEnd }],
        days,
        compareCalendarTasks
      );
      if (!previewBar) return others;
      // Only the row the bar was grabbed in keeps the pinned lane; other rows of a
      // multi-week task keep their own lane instead of jumping to the grabbed one.
      const grabbedHere =
        !!drag.grabYmd && days.some((day) => formatLocalYmd(day) === drag.grabYmd);
      return [
        ...others,
        { ...previewBar, lane: grabbedHere ? drag.lane : previewBar.lane },
      ];
    },
    [compareCalendarTasks, datedTasks, displayedDatedTasks, drag, nudgeDates]
  );

  /** Viewers are read-only, so they never appear as assignee choices. */
  const assignableMembers = useMemo(
    () => members.filter((member) => !memberIsViewer(member)),
    [members]
  );

  const closeBarMenus = useCallback(() => {
    setMenuTaskId(null);
    setAssigneeMenuTaskId(null);
    setAssigneeMenuPosition(null);
    setHoverCommentId(null);
  }, []);

  /**
   * Same placement rule as the Kanban card comment tooltip: centred on the icon,
   * above it when there is room, so the panel stays next to the bubble it belongs to.
   */
  const commentPreviewPositionFor = useCallback(
    (anchor: DOMRect, width: number, height: number, gap = 8): FixedPopoverPosition => {
      const viewportGap = 8;
      let left = anchor.left + anchor.width / 2 - width / 2;
      left = Math.max(viewportGap, Math.min(left, window.innerWidth - width - viewportGap));

      const spaceAbove = anchor.top;
      const spaceBelow = window.innerHeight - anchor.bottom;
      let top =
        spaceAbove >= height + gap || spaceAbove > spaceBelow
          ? anchor.top - height - gap
          : anchor.bottom + gap;
      top = Math.max(viewportGap, Math.min(top, window.innerHeight - height - viewportGap));
      return { left, top };
    },
    []
  );

  const showCommentPreview = useCallback(
    (taskId: string, anchor: HTMLElement) => {
      if (commentHideTimerRef.current) {
        clearTimeout(commentHideTimerRef.current);
        commentHideTimerRef.current = null;
      }
      if (commentShowTimerRef.current) clearTimeout(commentShowTimerRef.current);
      const rect = anchor.getBoundingClientRect();
      commentAnchorRectRef.current = rect;
      setHoverCommentId(taskId);
      commentShowTimerRef.current = setTimeout(() => {
        setCommentPreviewPosition(commentPreviewPositionFor(rect, 320, 256));
        commentShowTimerRef.current = null;
      }, 350);
    },
    [commentPreviewPositionFor]
  );

  const keepCommentPreviewOpen = useCallback(() => {
    if (commentHideTimerRef.current) {
      clearTimeout(commentHideTimerRef.current);
      commentHideTimerRef.current = null;
    }
  }, []);

  const hideCommentPreview = useCallback(() => {
    if (commentShowTimerRef.current) {
      clearTimeout(commentShowTimerRef.current);
      commentShowTimerRef.current = null;
    }
    if (commentHideTimerRef.current) clearTimeout(commentHideTimerRef.current);
    commentHideTimerRef.current = setTimeout(() => {
      setHoverCommentId(null);
      setCommentPreviewPosition(null);
      commentHideTimerRef.current = null;
    }, 120);
  }, []);

  useEffect(() => {
    if (!menuTaskId && !assigneeMenuTaskId && !hoverCommentId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeBarMenus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuTaskId, assigneeMenuTaskId, hoverCommentId, closeBarMenus]);

  // Keyed on the panel being mounted, not on hover: the hover flag is set well
  // before the panel opens, so keying on it would measure a ref that is still null.
  const commentPreviewOpen = Boolean(commentPreviewPosition);
  useLayoutEffect(() => {
    if (
      !commentPreviewOpen ||
      !commentPreviewRef.current ||
      !commentAnchorRectRef.current
    ) {
      return;
    }
    const panel = commentPreviewRef.current;
    setCommentPreviewPosition(
      commentPreviewPositionFor(
        commentAnchorRectRef.current,
        panel.offsetWidth,
        panel.offsetHeight
      )
    );
  }, [commentPreviewOpen, commentPreviewPositionFor]);

  useEffect(() => {
    if (!assigneeMenuTaskId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (assigneeMenuRef.current?.contains(target as Node)) return;
      // The avatar toggles the menu itself; closing here would fight that click.
      if (target?.closest('[data-calendar-assignee-trigger]')) return;
      setAssigneeMenuTaskId(null);
      setAssigneeMenuPosition(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [assigneeMenuTaskId]);

  const prioritiesForLegend = useMemo(
    () =>
      availablePriorities.map((p) => ({
        id: String(p.id),
        priority: p.priority,
        color: p.color,
      })),
    [availablePriorities]
  );

  const calendarSearchTasks = useMemo(
    () =>
      datedTasks.flatMap((task) => {
        const span = getTaskDateSpan(task);
        if (!span) return [];
        const column = Object.values(columns).find((candidate) => candidate.id === task.columnId);
        return [{
          id: task.id,
          ticket: task.ticket || '',
          title: task.title,
          startDate: span.start,
          endDate: span.end,
          status: column ? columnDisplayTitle(column) : task.status || '',
          priority: task.priorityName || task.priority || '',
          columnId: task.columnId,
          columnPosition: column?.position || 0,
          taskPosition: task.position || 0,
        }];
      }),
    [columns, datedTasks, columnDisplayTitle]
  );

  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-US';

  const openDayLabelFor = useCallback(
    (day: Date) =>
      t('calendar.openDay', {
        date: new Intl.DateTimeFormat(locale, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }).format(day),
      }),
    [locale, t]
  );

  const formatBarTooltipDate = useCallback(
    (date: string | Date) => {
      const parsed = date instanceof Date ? date : parseLocalDate(date);
      return parsed.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    },
    [locale]
  );

  /** Live dates while dragging: a bar clipped by the grid edge otherwise looks stretched. */
  const dragRangeLabel = useMemo(() => {
    if (!drag) return '';
    const format = (ymd: string) =>
      parseLocalDate(ymd).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    return drag.previewStart === drag.previewEnd
      ? format(drag.previewStart)
      : `${format(drag.previewStart)} → ${format(drag.previewEnd)}`;
  }, [drag, locale]);

  const headerLabel = useMemo(() => {
    if (subView === 'month') {
      return focusDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    }
    if (subView === 'week') {
      const start = weekCells[0];
      const end = weekCells[6];
      return `${start.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return focusDate.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [focusDate, locale, subView, weekCells]);

  const periodPickerType = subView === 'month' ? 'month' : subView === 'week' ? 'week' : 'date';
  const periodPickerValue =
    subView === 'month'
      ? formatLocalYmd(focusDate).slice(0, 7)
      : subView === 'week'
        ? isoWeekValue(focusDate)
        : formatLocalYmd(focusDate);

  const openPeriodPicker = () => setPeriodPickerOpen((open) => !open);

  const handlePeriodPickerChange = (value: string) => {
    if (!value) return;
    if (subView === 'month') {
      const match = /^(\d{4})-(\d{2})$/.exec(value);
      if (match) setFocusPersist(new Date(Number(match[1]), Number(match[2]) - 1, 1));
      return;
    }
    if (subView === 'week') {
      const monday = dateFromIsoWeek(value);
      if (monday) setFocusPersist(monday);
      return;
    }
    setFocusPersist(parseLocalDate(value));
  };

  const shiftFocusYear = (delta: number) => {
    setFocusPersist(
      new Date(focusDate.getFullYear() + delta, focusDate.getMonth(), focusDate.getDate())
    );
  };

  const applyDatesOnly = useCallback(
    (task: Task, startDate: string, dueDate: string) => {
      if (!canMutate || !onUpdateTask) return;
      const updated: Task = { ...task, startDate, dueDate };
      if (task.startDate?.trim() && !task.dueDate?.trim() && startDate === dueDate) {
        updated.dueDate = undefined;
      }
      onUpdateTask(updated, { skipLoading: true, skipActivity: true });
    },
    [canMutate, onUpdateTask]
  );

  const navigate = (dir: -1 | 1) => {
    if (subView === 'month') {
      setFocusPersist(new Date(focusDate.getFullYear(), focusDate.getMonth() + dir, 1));
    } else if (subView === 'week') {
      setFocusPersist(addDaysLocal(focusDate, dir * 7));
    } else {
      setFocusPersist(addDaysLocal(focusDate, dir));
    }
  };

  /**
   * Jumping to today only changes the focus date, which is invisible when the
   * page is scrolled away from today's cell. Bring it back into view, staying
   * clear of the sticky app header, toolbar, and weekday row.
   */
  const scrollTodayIntoView = useCallback(() => {
    const cell = gridRef.current?.querySelector<HTMLElement>('[data-calendar-today="true"]');
    if (!cell) return;

    const stickyBottom =
      PAGE_HEADER_OFFSET + toolbarHeight + (weekdayRowRef.current?.offsetHeight ?? 0);
    const rect = cell.getBoundingClientRect();
    if (rect.top >= stickyBottom && rect.bottom <= window.innerHeight) return;

    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - stickyBottom - 8),
      behavior: 'smooth',
    });
  }, [toolbarHeight]);

  const goToToday = useCallback(() => {
    setFocusPersist(today);
    // The cell for today may not exist until the new focus date renders.
    requestAnimationFrame(scrollTodayIntoView);
  }, [scrollTodayIntoView, setFocusPersist, today]);

  const periodStartFor = useCallback((date: Date, view: CalendarSubView): Date => {
    if (view === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
    if (view === 'week') return buildWeekCells(date)[0];
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }, []);

  const nextPeriodStart = useCallback(
    (date: Date, view: CalendarSubView, dir: -1 | 1): Date => {
      if (view === 'month') return new Date(date.getFullYear(), date.getMonth() + dir, 1);
      return addDaysLocal(date, dir * (view === 'week' ? 7 : 1));
    },
    []
  );

  const periodHasTasks = useCallback(
    (periodStart: Date, view: CalendarSubView): boolean => {
      const periodEnd =
        view === 'month'
          ? new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0)
          : addDaysLocal(periodStart, view === 'week' ? 6 : 0);
      return datedTasks.some((task) => {
        const span = getTaskDateSpan(task);
        return !!span && span.start <= periodEnd && span.end >= periodStart;
      });
    },
    [datedTasks]
  );

  const navigateToTaskPeriod = useCallback(
    (dir: -1 | 1) => {
      if (datedTasks.length === 0) return;
      const spans = datedTasks
        .map(getTaskDateSpan)
        .filter((span): span is NonNullable<ReturnType<typeof getTaskDateSpan>> => !!span);
      if (spans.length === 0) return;

      const current = periodStartFor(focusDate, subView);
      const boundary =
        dir < 0
          ? periodStartFor(
              spans.reduce((earliest, span) => (span.start < earliest ? span.start : earliest), spans[0].start),
              subView
            )
          : periodStartFor(
              spans.reduce((latest, span) => (span.end > latest ? span.end : latest), spans[0].end),
              subView
            );

      for (
        let candidate = nextPeriodStart(current, subView, dir);
        dir < 0 ? candidate >= boundary : candidate <= boundary;
        candidate = nextPeriodStart(candidate, subView, dir)
      ) {
        if (periodHasTasks(candidate, subView)) {
          setFocusPersist(candidate);
          return;
        }
      }
    },
    [
      datedTasks,
      focusDate,
      nextPeriodStart,
      periodHasTasks,
      periodStartFor,
      setFocusPersist,
      subView,
    ]
  );

  const jumpToCalendarTask = useCallback(
    (searchTask: { id: string }) => {
      // Reports failure so a jump requested before the board finished loading
      // stays pending and replays once the task shows up.
      const original = datedTasks.find((task) => task.id === searchTask.id);
      const span = original ? getTaskDateSpan(original) : null;
      if (!span) return false;
      setFocusPersist(span.start);
      setHighlightedTaskId(searchTask.id);
      window.setTimeout(() => {
        const bar = document.querySelector<HTMLElement>(
          `[data-calendar-task-id="${CSS.escape(searchTask.id)}"]`
        );
        bar?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }, 80);
      window.setTimeout(
        () => setHighlightedTaskId((id) => (id === searchTask.id ? null : id)),
        2200
      );
      return true;
    },
    [datedTasks, setFocusPersist]
  );

  useEffect(
    () =>
      subscribeTaskJump(({ task }) => {
        if (jumpToCalendarTask(task)) {
          completeTaskJump(task.id);
        }
      }),
    [jumpToCalendarTask]
  );

  const beginDrag = (mode: DragMode, task: Task, e: React.MouseEvent, lane: number) => {
    if (!canMutate) return;
    // Modifiers are reserved for range/additive selection, not movement:
    // block the native text range instead of starting a drag.
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (multiSelectMode) return;
    // The second press of a double-click must stay a double-click, not a drag.
    if (e.detail >= 2) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const span = getTaskDateSpan(task);
    if (!span) return;

    const pressX = e.clientX;
    const pressY = e.clientY;
    const grabYmd = ymdFromPoint(pressX, pressY, gridRef.current);
    const initial: DragState = {
      mode,
      taskId: task.id,
      originStart: span.startYmd,
      originEnd: span.endYmd,
      previewStart: span.startYmd,
      previewEnd: span.endYmd,
      lane,
      grabOffsetDays: grabYmd ? dayDiff(span.startYmd, grabYmd) : 0,
      grabYmd,
    };
    // A press alone stays a click: dragging only starts once the pointer travels,
    // so bars never re-render (or change lanes) underneath a plain click.
    let dragging = false;

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (
          Math.abs(ev.clientX - pressX) < DRAG_THRESHOLD_PX &&
          Math.abs(ev.clientY - pressY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        dragging = true;
        setDrag(initial);
        dragRef.current = initial;
      }
      const ymd = ymdFromPoint(ev.clientX, ev.clientY, gridRef.current);
      if (!ymd) return;
      setDrag((prev) => {
        if (!prev) return prev;
        let next = prev;
        if (prev.mode === 'move') {
          const duration = dayDiff(prev.originStart, prev.originEnd);
          const newStart = addDaysLocal(parseLocalDate(ymd), -prev.grabOffsetDays);
          const newEnd = addDaysLocal(newStart, duration);
          next = {
            ...prev,
            previewStart: formatLocalYmd(newStart),
            previewEnd: formatLocalYmd(newEnd),
          };
        } else if (prev.mode === 'resize-start') {
          const end = parseLocalDate(prev.originEnd);
          let start = parseLocalDate(ymd);
          if (start > end) start = end;
          next = { ...prev, previewStart: formatLocalYmd(start), previewEnd: prev.originEnd };
        } else {
          const start = parseLocalDate(prev.originStart);
          let end = parseLocalDate(ymd);
          if (end < start) end = start;
          next = { ...prev, previewStart: prev.originStart, previewEnd: formatLocalYmd(end) };
        }
        dragRef.current = next;
        return next;
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragging) return;
      // Any real drag swallows the click that follows, even when the dates land unchanged.
      suppressBarClickRef.current = true;
      window.setTimeout(() => {
        suppressBarClickRef.current = false;
      }, 0);
      const finalDrag = dragRef.current;
      if (finalDrag) {
        const datesChanged =
          finalDrag.previewStart !== finalDrag.originStart ||
          finalDrag.previewEnd !== finalDrag.originEnd;
        const taskObj = tasks.find((tk) => tk.id === finalDrag.taskId);
        if (taskObj && datesChanged) {
          applyDatesOnly(taskObj, finalDrag.previewStart, finalDrag.previewEnd);
        }
      }
      setDrag(null);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleBarClick = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressBarClickRef.current) {
      suppressBarClickRef.current = false;
      return;
    }
    const liveTask = tasks.find((candidate) => candidate.id === task.id) ?? task;
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;

    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();

      const baseIds =
        selectedIds.length > 0
          ? selectedIds
          : selectedTaskRef.current
            ? [selectedTaskRef.current.id]
            : [];
      const next = new Set(baseIds);

      if (range) {
        const anchor =
          selectionAnchorRef.current ||
          selectedTaskRef.current?.id ||
          baseIds[baseIds.length - 1] ||
          task.id;
        const anchorIndex = selectionOrderedIds.indexOf(anchor);
        const taskIndex = selectionOrderedIds.indexOf(task.id);
        if (anchorIndex >= 0 && taskIndex >= 0) {
          const start = Math.min(anchorIndex, taskIndex);
          const end = Math.max(anchorIndex, taskIndex);
          selectionOrderedIds.slice(start, end + 1).forEach((id) => next.add(id));
        } else {
          next.add(task.id);
        }
      } else if (next.has(task.id)) {
        next.delete(task.id);
      } else {
        next.add(task.id);
      }

      const nextIds = [...next];
      selectionAnchorRef.current = task.id;
      setSelectedIds(nextIds);
      if (nextIds.length > 1) {
        setMultiSelectMode(true);
        onSelectTask(null);
      } else if (nextIds.length === 1) {
        const remaining = tasks.find((candidate) => candidate.id === nextIds[0]) ?? liveTask;
        onSelectTask(remaining);
      } else {
        onSelectTask(null);
      }
      return;
    }

    if (multiSelectMode) {
      selectionAnchorRef.current = task.id;
      setSelectedIds((prev) =>
        prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]
      );
      return;
    }
    selectionAnchorRef.current = task.id;
    setSelectedIds([]);
    // A second click in a double-click would otherwise toggle the panel closed.
    if (e.detail >= 2) {
      onSelectTask(liveTask);
      return;
    }
    // Toggle straight away, reading the live selection: a deferred toggle let the
    // panel open under the pointer later, which made the next click land elsewhere.
    if (selectedTaskRef.current?.id === task.id) onSelectTask(null);
    else onSelectTask(liveTask);
  };

  const handleEmptyDay = async (day: Date) => {
    if (!canMutate || !onAddTask || multiSelectMode) return;
    const colId = defaultColumnId(columns, effectiveCalendarColumnIds);
    if (!colId) return;
    const ymd = formatLocalYmd(day);
    await onAddTask(colId, ymd, ymd);
  };

  const beginTaskCreation = useCallback(
    (event: React.MouseEvent, anchorYmd: string) => {
      if (
        event.button !== 0 ||
        subView === 'day' ||
        !canMutate ||
        !onAddTask ||
        multiSelectMode ||
        taskCreationPendingRef.current
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeBarMenus();
      const initial = { anchorYmd, currentYmd: anchorYmd };
      taskCreationRef.current = initial;
      setTaskCreation(initial);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = CREATE_TASK_CURSOR.cursor as string;
      document.body.style.userSelect = 'none';

      const restorePointer = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };

      const onMove = (moveEvent: MouseEvent) => {
        const currentYmd = ymdFromPoint(moveEvent.clientX, moveEvent.clientY, gridRef.current);
        if (!currentYmd) return;
        const previous = taskCreationRef.current;
        if (!previous || previous.currentYmd === currentYmd) return;
        const next = { ...previous, currentYmd };
        taskCreationRef.current = next;
        setTaskCreation(next);
      };

      const onUp = async (upEvent: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        restorePointer();

        const finalCreation = taskCreationRef.current;
        taskCreationRef.current = null;
        setTaskCreation(null);
        if (!finalCreation) return;

        upEvent.preventDefault();
        const startYmd =
          finalCreation.anchorYmd <= finalCreation.currentYmd
            ? finalCreation.anchorYmd
            : finalCreation.currentYmd;
        const dueYmd =
          finalCreation.anchorYmd <= finalCreation.currentYmd
            ? finalCreation.currentYmd
            : finalCreation.anchorYmd;
        const colId = defaultColumnId(columns, effectiveCalendarColumnIds);
        if (!colId) return;

        taskCreationPendingRef.current = true;
        try {
          await onAddTask(colId, startYmd, dueYmd);
        } catch (error) {
          console.error('Failed to create calendar task:', error);
        } finally {
          taskCreationPendingRef.current = false;
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [
      canMutate,
      closeBarMenus,
      columns,
      effectiveCalendarColumnIds,
      multiSelectMode,
      onAddTask,
      subView,
    ]
  );

  useEffect(() => {
    if (!multiSelectMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (deleteConfirmMode) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        setMultiSelectMode(false);
        setSelectedIds([]);
        selectionAnchorRef.current = null;
        return;
      }
      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        selectedIds.length > 0 &&
        canMutate
      ) {
        event.preventDefault();
        if (arrowLockRef.current) return;
        arrowLockRef.current = true;
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        const nextOverlay: Record<string, { startDate: string; dueDate?: string }> = {
          ...nudgeDatesRef.current,
        };
        selectedIds.forEach((id) => {
          const task = tasks.find((tk) => tk.id === id);
          if (!task) return;
          const current = nextOverlay[id]
            ? {
                ...task,
                startDate: nextOverlay[id].startDate,
                dueDate: nextOverlay[id].dueDate ?? nextOverlay[id].startDate,
              }
            : task;
          const shifted = shiftTaskDates(current, delta);
          if (!shifted) return;
          nextOverlay[id] = shifted;
        });
        nudgeDatesRef.current = nextOverlay;
        setNudgeDates(nextOverlay);
        if (nudgeCommitTimerRef.current) clearTimeout(nudgeCommitTimerRef.current);
        nudgeCommitTimerRef.current = setTimeout(() => {
          const pending = nudgeDatesRef.current;
          const updates = Object.keys(pending).flatMap((id) => {
            const task = tasks.find((tk) => tk.id === id);
            const overlay = pending[id];
            if (!task || !overlay) return [];
            return [
              {
                ...task,
                startDate: overlay.startDate,
                dueDate: overlay.dueDate ?? task.dueDate,
              },
            ];
          });
          if (updates.length === 0) return;
          void batchUpdateTasks(updates).catch(() => {
            setNudgeDates({});
            nudgeDatesRef.current = {};
          });
        }, 180);
        setTimeout(() => {
          arrowLockRef.current = false;
        }, 80);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multiSelectMode, selectedIds, canMutate, tasks, deleteConfirmMode]);

  useEffect(() => {
    if (!deleteConfirmMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || deleteSubmitting) return;
      event.preventDefault();
      event.stopPropagation();
      setDeleteConfirmMode(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteConfirmMode, deleteSubmitting]);

  const actionSelectedIds = useMemo(
    () =>
      selectedIds.length > 0
        ? selectedIds
        : selectedTask
          ? [selectedTask.id]
          : [],
    [selectedIds, selectedTask]
  );

  const confirmSelectedTaskDelete = useCallback(async () => {
    if (!deleteConfirmMode || actionSelectedIds.length === 0 || deleteSubmitting) return;
    const taskIds = [...actionSelectedIds];
    const handler =
      deleteConfirmMode === 'permanent' ? onBulkPermanentDelete : onBulkDelete;
    if (!handler) return;
    setDeleteSubmitting(true);
    try {
      await handler(taskIds);
      // Selection empties because the bars are gone, but Select mode is the
      // user's to leave — matches taking the same action from the gutter.
      setSelectedIds([]);
      selectionAnchorRef.current = null;
      onSelectTask(null);
      setDeleteConfirmMode(null);
    } finally {
      setDeleteSubmitting(false);
    }
  }, [
    deleteConfirmMode,
    deleteSubmitting,
    onBulkDelete,
    onBulkPermanentDelete,
    actionSelectedIds,
    onSelectTask,
  ]);

  const submitComment = async (task: Task, text: string) => {
    if (!text.trim() || !currentUser?.id) return;
    const authorId =
      members.find((member) => member.user_id === currentUser.id)?.id ||
      String(currentUser.id);
    const newComment = await createComment({
      id: crypto.randomUUID(),
      text: text.trim(),
      authorId,
      taskId: task.id,
      createdAt: new Date().toISOString(),
      attachments: [],
    } as Comment & { taskId: string });
    onUpdateTask?.({
      ...task,
      comments: [...(task.comments || []), newComment],
    });
  };

  const assignMember = (task: Task, memberId: string | null) => {
    onUpdateTask?.({ ...task, memberId });
    setAssigneeMenuTaskId(null);
    setAssigneeMenuPosition(null);
  };

  /** Avatar that doubles as the assignee picker trigger (read-only users get a plain avatar). */
  const renderAssigneeControl = (
    task: Task,
    member: TeamMember | undefined,
    size: 'xs' | 'sm' | 'lg'
  ) => {
    if (!canMutate || multiSelectMode) {
      return member ? (
        <MemberAvatar
          member={member}
          size={size}
          className="relative z-[1] shrink-0 ring-1 ring-white/60"
        />
      ) : null;
    }

    const label = member
      ? t('calendar.changeAssigneeFor', { name: member.name })
      : t('calendar.assignTask');

    return (
      <button
        type="button"
        className="relative z-[10] shrink-0 rounded-full ring-1 ring-white/70 transition hover:ring-2 hover:ring-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={assigneeMenuTaskId === task.id}
        data-calendar-assignee-trigger="true"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setMenuTaskId(null);
          setHoverCommentId(null);
          if (assigneeMenuTaskId === task.id) {
            setAssigneeMenuTaskId(null);
            setAssigneeMenuPosition(null);
            return;
          }
          const el = e.currentTarget as HTMLElement;
          setAssigneeMenuPosition(
            layoutMemberDropdownFromElement(el, members, {
              showAgent: true,
              excludeViewers: true,
              selectedId: task.memberId ?? null,
              placement: 'below',
            })
          );
          setAssigneeMenuTaskId(task.id);
        }}
      >
        <MemberAvatar member={member ?? null} size={size} showViewerBadge={false} />
      </button>
    );
  };

  /** Native tooltip only when the text is actually clipped, so full titles stay quiet. */
  const applyClippedTitleTooltip = (
    event: React.MouseEvent<HTMLElement>,
    text: string
  ) => {
    const el = event.currentTarget;
    if (el.scrollWidth > el.clientWidth + 1) {
      el.setAttribute('title', text);
    } else {
      el.removeAttribute('title');
    }
  };

  const renderBar = (bar: PlacedBar, dayCount: number) => {
    const task = bar.task;
    const color = priorityColor(task, availablePriorities);
    const member = memberFor(task, members);
    const barFill = member?.color || UNASSIGNED_BAR_COLOR;
    const barText = getTextColorForBackground(barFill);
    const isDayBar = subView === 'day' && dayCount === 1;
    const column = columns[task.columnId] || Object.values(columns).find((candidate) => candidate.id === task.columnId);
    const statusLabel = column ? columnDisplayTitle(column) : task.status || '';
    const barStatus = calendarBarStatus(
      task,
      column,
      siteSettings?.HIGHLIGHT_OVERDUE_TASKS === 'true'
    );
    const statusStampLabel =
      barStatus === 'done' ? t('gantt.done') : barStatus === 'late' ? t('gantt.late') : null;
    const priorityLabel =
      availablePriorities.find(
        (priority) =>
          String(priority.id) === String(task.priorityId) ||
          priority.priority === task.priority ||
          priority.priority === task.priorityName
      )?.priority ||
      task.priorityName ||
      task.priority;
    const selected = selectedIds.includes(task.id) || selectedTask?.id === task.id;
    const highlighted = highlightedTaskId === task.id;
    const leftPct = (bar.startIndex / dayCount) * 100;
    const widthPct = ((bar.endIndex - bar.startIndex + 1) / dayCount) * 100;
    const density = CALENDAR_DENSITY[taskViewMode];
    const dayDensity = CALENDAR_DAY_DENSITY[taskViewMode];
    const barHeight = isDayBar ? dayDensity.barHeight : density.barHeight;
    const laneGap = isDayBar ? dayDensity.laneGap : density.laneGap;
    const top = bar.lane * (barHeight + laneGap);
    const hasComments = (task.comments?.length || 0) > 0;
    const isPreviewBar = !isDayBar && taskViewMode === 'shrink';
    const isMinimalBar = !isDayBar && taskViewMode === 'compact';
    const isDayFull = isDayBar && taskViewMode === 'expand';
    const isDayMinimal = isDayBar && taskViewMode === 'compact';
    const showInlineBarMeta = !isMinimalBar;
    const dayTagLimit = isDayMinimal ? 1 : 3;
    const dayDescriptionPlain = isDayFull
      ? String(task.description || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    const dayDescriptionHtml =
      isDayFull && dayDescriptionPlain ? DOMPurify.sanitize(task.description || '') : '';
    const statusStamp = statusStampLabel ? (
      <span
        className={`shrink-0 font-bold uppercase tracking-wide text-white ${
          barStatus === 'done' ? 'bg-green-500' : 'bg-red-500'
        } ${
          isDayBar
            ? 'rounded-full px-1.5 py-0.5 text-[10px]'
            : isPreviewBar
              ? 'rounded px-1 py-px text-[8px] leading-none'
              : 'rounded-full px-1 py-px text-[9px] leading-none'
        }`}
      >
        {statusStampLabel}
      </span>
    ) : null;
    // Day view is a read-only list of the day's work: no move, no resize.
    const barDraggable = canMutate && !multiSelectMode && !isDayBar;
    const menuOpen = menuTaskId === task.id || assigneeMenuTaskId === task.id;
    // A task crossing rows repeats on each one; avatar and comments belong to the
    // segment that carries the due date, not to every slice of the same task.
    const showBarMeta = isDayBar || !bar.clippedEnd;
    const commentBubble =
      hasComments && showInlineBarMeta && showBarMeta ? (
        <button
          type="button"
          className="relative z-[1] flex shrink-0 items-center gap-px rounded-full p-px hover:bg-black/20"
          onClick={(e) => {
            e.preventDefault();
            handleBarClick(task, e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => showCommentPreview(task.id, e.currentTarget)}
          onMouseLeave={hideCommentPreview}
          aria-label={t('taskCard.hoverToViewComments', { ns: 'tasks' })}
        >
          <MessageCircle size={isPreviewBar || isDayMinimal ? 10 : 12} />
          <span className={`${isPreviewBar || isDayMinimal ? 'text-[8px]' : 'text-[9px]'} font-semibold`}>
            {task.comments.length}
          </span>
        </button>
      ) : null;
    const showStartHandle = barDraggable && !bar.clippedStart;
    const showEndHandle = barDraggable && !bar.clippedEnd;
    // Fill carries the assignee. Minimal repeats a tiny priority pill on every
    // visible row segment, so multi-week tasks retain the legend cue even when
    // their true start is outside the current row or period.
    const priorityDot = (
      <span
        className={`shrink-0 rounded-full ${
          isDayMinimal
            ? 'h-2 w-2'
            : isDayBar
              ? 'h-3 w-3'
              : isMinimalBar
              ? 'absolute left-0.5 top-1/2 z-[2] h-1 w-2 -translate-y-1/2'
              : 'mr-1 inline-block h-2.5 w-2.5 align-[-1px]'
        }`}
        style={{
          backgroundColor: color,
          boxShadow: `0 0 0 1px ${
            isDayBar || barText === '#374151' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.75)'
          }`,
        }}
        title={priorityLabel || undefined}
        aria-hidden
      />
    );

    return (
      <div
        key={task.id}
        data-calendar-task-id={task.id}
        className={`group absolute flex rounded cursor-pointer select-none overflow-visible ${
          isDayFull ? 'items-start' : 'items-center'
        } ${
          isDayBar
            ? `${isDayMinimal ? 'px-2' : 'px-3'} ${isDayFull ? 'py-2' : ''} text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm`
            : isMinimalBar
              ? ''
              : `px-1 leading-tight shadow-sm ${isPreviewBar ? 'text-[10px]' : 'text-[11px]'}`
        } ${
          selected ? 'ring-2 ring-offset-1 ring-blue-500 dark:ring-offset-gray-900' : ''
        } ${
          highlighted
            ? 'ring-4 ring-amber-300 dark:ring-amber-400 shadow-[0_0_0_5px_rgba(251,191,36,0.22)] animate-pulse'
            : ''
        } ${bar.clippedStart ? 'rounded-l-none' : ''} ${bar.clippedEnd ? 'rounded-r-none' : ''}`}
        style={{
          left: `calc(${leftPct}% + 2px)`,
          width: `calc(${widthPct}% - 4px)`,
          top,
          height: barHeight,
          ...(!isDayBar
            ? {
                backgroundColor: isMinimalBar ? 'transparent' : barFill,
                color: barText,
                // Keep title, avatar, and comment count clear of the resize grips.
                paddingLeft: isMinimalBar ? 0 : showStartHandle ? 14 : 4,
                paddingRight: isMinimalBar ? 0 : showEndHandle ? 14 : 4,
              }
            : {}),
          // Bars stack in DOM order, so a bar with an open menu has to outrank the
          // ones after it or its dropdown renders behind them.
          zIndex: menuOpen ? 40 : drag?.taskId === task.id ? 20 : 5,
          transition:
            drag?.taskId === task.id || !nudgeDates[task.id]
              ? undefined
              : 'left 140ms ease-out, width 140ms ease-out',
        }}
        onClick={(e) => handleBarClick(task, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!canMutate) return;
          setAssigneeMenuTaskId(null);
          setMenuTaskId(task.id === menuTaskId ? null : task.id);
        }}
      >
        <TaskBarTooltip
          task={task}
          formatDate={formatBarTooltipDate}
          disabled={isDayBar || Boolean(drag) || menuOpen || hoverCommentId === task.id}
          wrapperClassName={`flex h-full w-full min-w-0 gap-0.5 ${
            isDayFull ? 'items-start' : 'items-center'
          }`}
          meta={
            // Always identify the assignee in the popup. This is especially
            // important when a multi-week task's avatar is on another segment.
            <>
              <MemberAvatar member={member ?? null} size="xs" showViewerBadge={false} />
              <span className="truncate">{member?.name || t('calendar.unassigned')}</span>
              {statusStampLabel && (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold text-white ${
                    barStatus === 'done' ? 'bg-green-500' : 'bg-red-500'
                  }`}
                >
                  {statusStampLabel}
                </span>
              )}
            </>
          }
        >
        {isMinimalBar && (
          <span
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full shadow-sm"
            style={{ backgroundColor: barFill }}
            aria-hidden
          />
        )}
        {isMinimalBar && barStatus && (
          <span
            className={`pointer-events-none absolute right-0 top-1/2 z-[3] h-1.5 w-2.5 -translate-y-1/2 rounded-full shadow-sm ${
              barStatus === 'done' ? 'bg-green-500' : 'bg-red-500'
            }`}
            title={statusStampLabel || undefined}
            aria-hidden
          />
        )}
        {isDayBar && (
          <span
            className="absolute inset-y-0 left-0 w-1 rounded-l"
            style={{ backgroundColor: barFill }}
            aria-hidden
          />
        )}
        {/* Faded edges mark work that carries on past this row, so a bar whose
            visible end is pinned to the grid edge does not read as the due date. */}
        {!isDayBar && bar.clippedStart && (
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/40 to-transparent"
            aria-hidden
          />
        )}
        {!isDayBar && bar.clippedEnd && (
          <span
            className="pointer-events-none absolute inset-y-0 right-0 w-2 bg-gradient-to-l from-black/40 to-transparent"
            aria-hidden
          />
        )}
        {drag?.taskId === task.id && dragRangeLabel && (
          <span className="pointer-events-none absolute -top-6 left-0 z-10 whitespace-nowrap rounded bg-gray-900/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow dark:bg-gray-100 dark:text-gray-900">
            {dragRangeLabel}
          </span>
        )}
        {/* Only the segment holding the real start/end can resize it; the edges a
            multi-row task gets from the grid are not dates. */}
        {showStartHandle && (
          <span
            className={`absolute left-0 top-0 z-30 flex h-full cursor-w-resize items-center justify-center rounded-l transition-all hover:opacity-90 ${
              isMinimalBar || isPreviewBar
                ? 'w-2 opacity-0 group-hover:opacity-75'
                : 'w-3 opacity-60'
            }`}
            style={{ backgroundColor: barFill }}
            onMouseDown={(e) => beginDrag('resize-start', task, e, bar.lane)}
          >
            <span
              className={`${isMinimalBar ? 'h-1.5' : 'h-3'} w-0.5 rounded bg-white opacity-80`}
              aria-hidden
            />
          </span>
        )}
        <span
          className={`flex-1 min-w-0 relative z-[1] ${
            isDayBar
              ? `flex h-full min-h-0 ${isDayFull ? 'items-start' : 'items-center'} ${
                  isDayMinimal ? 'gap-2 pl-0.5 pr-1' : 'gap-3 pl-1 pr-3'
                }`
              : 'truncate px-1'
          }`}
          onMouseDown={(e) => {
            if (barDraggable && e.button === 0) {
              beginDrag('move', task, e, bar.lane);
            }
          }}
        >
          {isDayBar ? (
            <>
              {priorityDot}
              {renderAssigneeControl(task, member, isDayMinimal ? 'xs' : 'lg')}
              <span className="min-w-0 flex-1">
                {isDayMinimal ? (
                  <span className="block truncate text-xs font-medium">
                    {task.title}
                    <span className="ml-1.5 font-normal text-[11px] text-gray-500 dark:text-gray-400">
                      {[task.ticket, `${bar.startYmd} → ${bar.endYmd}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="block truncate text-sm font-semibold">
                      {task.title}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {[task.ticket, `${bar.startYmd} → ${bar.endYmd}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {dayDescriptionHtml ? (
                      <div
                        className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-gray-600 dark:text-gray-300 [&_img]:hidden [&_p]:my-0 [&_ul]:my-0 [&_ol]:my-0"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a')) {
                            e.stopPropagation();
                          }
                        }}
                        dangerouslySetInnerHTML={{ __html: dayDescriptionHtml }}
                      />
                    ) : null}
                  </>
                )}
              </span>
              {statusStamp}
            </>
          ) : isMinimalBar ? (
            <>
              {priorityDot}
            </>
          ) : (
            <>
              {!bar.clippedStart && priorityDot}
              {task.title}
            </>
          )}
        </span>
        {!isDayBar && !isMinimalBar && statusStamp}
        {isDayBar && (
          <span
            className={`relative z-[1] flex max-w-[55%] shrink-0 justify-end gap-1.5 ${
              isDayFull ? 'items-start pt-0.5' : 'items-center'
            }`}
          >
            {(task.tags || []).slice(0, dayTagLimit).map((tag) => (
              <span
                key={tag.id}
                className={`max-w-28 truncate rounded font-medium ${
                  isDayMinimal ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
                }`}
                style={getTagDisplayStyle(tag)}
                onMouseEnter={(e) => applyClippedTitleTooltip(e, tag.tag)}
              >
                {tag.tag}
              </span>
            ))}
            {(task.tags?.length || 0) > dayTagLimit && (
              <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                +{(task.tags?.length || 0) - dayTagLimit}
              </span>
            )}
            {commentBubble}
            {statusLabel && (
              <span
                className={`max-w-32 shrink-0 truncate rounded bg-gray-100 font-medium text-gray-700 ring-1 ring-inset ring-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600 ${
                  isDayMinimal ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
                }`}
              >
                {statusLabel}
              </span>
            )}
          </span>
        )}
        {!isDayBar && showInlineBarMeta && showBarMeta &&
          renderAssigneeControl(task, member, isPreviewBar ? 'xs' : 'sm')}
        {!isDayBar && commentBubble}
        {showEndHandle && (
          <span
            className={`absolute right-0 top-0 z-30 flex h-full cursor-e-resize items-center justify-center rounded-r transition-all hover:opacity-90 ${
              isMinimalBar || isPreviewBar
                ? 'w-2 opacity-0 group-hover:opacity-75'
                : 'w-3 opacity-60'
            }`}
            style={{ backgroundColor: barFill }}
            onMouseDown={(e) => beginDrag('resize-end', task, e, bar.lane)}
          >
            <span
              className={`${isMinimalBar ? 'h-1.5' : 'h-3'} w-0.5 rounded bg-white opacity-80`}
              aria-hidden
            />
          </span>
        )}
        </TaskBarTooltip>

        {menuTaskId === task.id && canMutate && (
          <div
            className="absolute left-0 top-full mt-1 z-50 min-w-[10rem] max-h-64 overflow-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-lg p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] uppercase text-gray-500 dark:text-gray-400">
              {t('gantt.priority')}
            </div>
            {availablePriorities.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                onClick={() => {
                  onUpdateTask?.({
                    ...task,
                    priority: p.priority,
                    priorityId: p.id,
                    priorityColor: p.color,
                    priorityName: p.priority,
                  });
                  setMenuTaskId(null);
                }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                {p.priority}
              </button>
            ))}
            <div className="px-2 py-1 text-[10px] uppercase text-gray-500 dark:text-gray-400 mt-1">
              {t('calendar.assignee')}
            </div>
            <button
              type="button"
              className="w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => {
                onUpdateTask?.({ ...task, memberId: null });
                setMenuTaskId(null);
              }}
            >
              {t('calendar.unassigned')}
            </button>
            {assignableMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                className="w-full flex items-center gap-2 text-left px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => {
                  onUpdateTask?.({ ...task, memberId: m.id });
                  setMenuTaskId(null);
                }}
              >
                <MemberAvatar member={m} size="xs" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderWeekRow = (days: Date[], key: string, minHeight: number) => {
    // Every dated task is shown; the row grows so the real workload is visible.
    const placed = barsForDays(days);
    const dayYmds = days.map(formatLocalYmd);
    const maxLane = placed.reduce((m, b) => Math.max(m, b.lane), -1);
    const density = CALENDAR_DENSITY[taskViewMode];
    const contentH = Math.max(
      minHeight,
      (maxLane + 1) * (density.barHeight + density.laneGap) + 36
    );
    // Later rows paint over earlier ones, so the row holding an open menu comes first.
    const rowHasOpenMenu = placed.some(
      (b) => b.task.id === menuTaskId || b.task.id === assigneeMenuTaskId
    );
    const creationPreview = (() => {
      if (!taskCreation) return null;
      const rangeStart =
        taskCreation.anchorYmd <= taskCreation.currentYmd
          ? taskCreation.anchorYmd
          : taskCreation.currentYmd;
      const rangeEnd =
        taskCreation.anchorYmd <= taskCreation.currentYmd
          ? taskCreation.currentYmd
          : taskCreation.anchorYmd;
      const visibleStart = rangeStart < dayYmds[0] ? dayYmds[0] : rangeStart;
      const visibleEnd =
        rangeEnd > dayYmds[dayYmds.length - 1] ? dayYmds[dayYmds.length - 1] : rangeEnd;
      if (visibleStart > visibleEnd) return null;
      return {
        startIndex: dayYmds.indexOf(visibleStart),
        endIndex: dayYmds.indexOf(visibleEnd),
      };
    })();

    return (
      <div
        key={key}
        className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 relative"
        style={{ minHeight: contentH, zIndex: rowHasOpenMenu ? 10 : undefined }}
      >
        {days.map((day) => {
          const isToday = isSameDayLocal(day, today);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const inMonth = day.getMonth() === focusDate.getMonth();
          const muted = subView === 'month' && !inMonth;
              const canCreateFromDayNumber = Boolean(
                canMutate && onAddTask && !multiSelectMode
              );
              const dayNumberClass = `transition-transform duration-150 group-hover:translate-x-0.5 ${
                isToday
                  ? 'inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-600 px-1 font-semibold text-white dark:bg-blue-500'
                  : 'inline-flex h-6 min-w-6 items-center justify-center px-1'
              }`;
              return (
            <div
              key={formatLocalYmd(day)}
              data-calendar-day={formatLocalYmd(day)}
              data-calendar-today={isToday ? 'true' : undefined}
              className={`border-r border-gray-200 dark:border-gray-700 last:border-r-0 p-1 relative ${
                isToday
                  ? 'bg-blue-50 dark:bg-blue-900/40'
                  : isWeekend
                    ? 'bg-gray-50 dark:bg-gray-800/60'
                    : 'bg-white dark:bg-gray-900'
              } ${muted ? 'opacity-50' : ''}`}
            >
              <div
                className={`relative z-20 text-xs mb-1 ${
                  isToday
                    ? 'text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                <span className="group inline-flex items-center gap-0.5 rounded">
                  {canCreateFromDayNumber ? (
                    <KanbanChromeTooltip
                      label={t('calendar.createTaskDrag')}
                      placement="bottom"
                      wrapperClassName="relative inline-flex"
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        className={`${dayNumberClass} select-none`}
                        style={CREATE_TASK_CURSOR}
                        aria-label={t('calendar.createTaskDrag')}
                        onMouseDown={(e) =>
                          beginTaskCreation(e, formatLocalYmd(day))
                        }
                      >
                        {day.getDate()}
                      </span>
                    </KanbanChromeTooltip>
                  ) : (
                    <button
                      type="button"
                      className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDayView(day);
                      }}
                      aria-label={openDayLabelFor(day)}
                    >
                      <span className={dayNumberClass}>{day.getDate()}</span>
                    </button>
                  )}
                  <KanbanChromeTooltip
                    label={openDayLabelFor(day)}
                    placement="bottom"
                    wrapperClassName="relative inline-flex pointer-events-none group-hover:pointer-events-auto"
                  >
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center rounded p-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDayView(day);
                      }}
                      aria-label={openDayLabelFor(day)}
                    >
                      <ArrowRight size={12} aria-hidden />
                    </button>
                  </KanbanChromeTooltip>
                </span>
              </div>
            </div>
          );
        })}
        <div
          className="absolute left-0 right-0 bottom-0 pointer-events-none"
          style={{ top: 32 }}
        >
          <div
            className="relative h-full w-full pointer-events-auto"
            data-calendar-days={days.map(formatLocalYmd).join(',')}
          >
            {placed.map((b) => renderBar(b, 7))}
          </div>
        </div>
        {/* Drawn across the date-number strip, above the bars, so the range being
            created stays readable no matter how full or dense the row is. */}
        {creationPreview &&
          creationPreview.startIndex >= 0 &&
          creationPreview.endIndex >= 0 && (
            <div
              className="pointer-events-none absolute z-30 flex items-center justify-end overflow-hidden rounded border border-blue-500 bg-blue-400/70 px-1 text-[10px] font-medium text-white shadow-sm dark:border-blue-300 dark:bg-blue-500/70"
              style={{
                left: `calc(${(creationPreview.startIndex / 7) * 100}% + 3px)`,
                width: `calc(${
                  ((creationPreview.endIndex - creationPreview.startIndex + 1) / 7) * 100
                }% - 6px)`,
                top: 4,
                height: 22,
              }}
            >
              <span className="truncate">{t('gantt.newTask')}</span>
            </div>
          )}
      </div>
    );
  };

  const commentTask = commentTaskId ? tasks.find((tk) => tk.id === commentTaskId) : null;
  const hoverCommentTask = hoverCommentId
    ? tasks.find((task) => task.id === hoverCommentId)
    : null;
  const assigneeMenuTask = assigneeMenuTaskId
    ? tasks.find((task) => task.id === assigneeMenuTaskId)
    : null;

  return (
    <div
      ref={calendarRootRef}
      className="relative flex min-h-96 flex-col overflow-visible rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    >
      <TaskBulkActionGutter
        anchorRef={calendarRootRef}
        controlId="calendar-view"
        selectedTaskIds={selectedIds}
        tasks={tasks}
        retainSelectionAfterAction
        onRetainSelection={onReplaceCheckedTaskIds}
        onClearSelection={() => {
          // Unselecting from the gutter means "done selecting": leave the mode too.
          setSelectedIds([]);
          setMultiSelectMode(false);
          selectionAnchorRef.current = null;
        }}
        canMutate={canMutate}
        busy={bulkBusy}
        currentUser={currentUser}
        members={members}
        availableTags={availableTags}
        availablePriorities={availablePriorities}
        availableSprints={availableSprints}
        boards={boards}
        currentBoardId={boardId}
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
        onBulkUndo={async () => {
          const restored = bulkUndoTaskIds || [];
          await onBulkUndo?.();
          // Restored bars are worth keeping actionable, so re-arm the mode.
          if (restored.length > 0) setMultiSelectMode(true);
          setSelectedIds(restored);
        }}
        onClearBulkUndo={onClearBulkUndo}
      />
      <div
        ref={toolbarRef}
        className="sticky z-40 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1.5"
        style={{ top: PAGE_HEADER_OFFSET }}
      >
        <GanttLegend
          priorities={prioritiesForLegend}
          prioritySwatchShape={taskViewMode === 'compact' ? 'pill' : 'circle'}
          className="max-w-full overflow-x-auto"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="w-28 shrink-0 truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('calendar.title')}
          </h2>

          <div className="flex shrink-0 items-center gap-1">
            {(['month', 'week', 'day'] as CalendarSubView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setSubViewPersist(v)}
                className={`inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium ${
                  subView === v
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                }`}
              >
                {t(`calendar.subView.${v}`)}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!canMutate}
            onClick={() => {
              if (!canMutate) return;
              if (multiSelectMode) {
                setMultiSelectMode(false);
                setSelectedIds([]);
                selectionAnchorRef.current = null;
              } else {
                setMultiSelectMode(true);
                const currentId = selectedTaskRef.current?.id;
                setSelectedIds(currentId ? [currentId] : []);
                selectionAnchorRef.current = currentId || null;
                onSelectTask(null);
              }
            }}
            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-medium disabled:opacity-50 ${
              multiSelectMode
                ? 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}
            title={
              multiSelectMode
                ? t('gantt.exitMultiSelectMode')
                : t('gantt.selectMultipleTasks')
            }
          >
            {multiSelectMode ? <X size={14} /> : <CheckSquare size={14} />}
            {multiSelectMode ? t('gantt.exit') : t('gantt.select')}
            {selectedIds.length > 0 && (
              <span className="ml-0.5 px-1 rounded-full bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100 text-[10px]">
                {selectedIds.length}
              </span>
            )}
          </button>
          {canMutate &&
            actionSelectedIds.length > 0 &&
            onBulkDelete &&
            (selectedIds.length === 0 || !onBulkAddTag) && (
            <button
              type="button"
              disabled={bulkBusy || deleteSubmitting}
              onClick={(event) => {
                const permanent =
                  event.shiftKey &&
                  currentUser?.roles?.includes('admin') &&
                  Boolean(onBulkPermanentDelete);
                setDeleteConfirmMode(permanent ? 'permanent' : 'soft');
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-red-900/70 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-950/40"
              title={
                currentUser?.roles?.includes('admin') && onBulkPermanentDelete
                  ? t('kanbanSelect.deleteAdminHint', { ns: 'tasks' })
                  : t('kanbanSelect.delete', { ns: 'tasks' })
              }
              aria-label={
                currentUser?.roles?.includes('admin') && onBulkPermanentDelete
                  ? t('kanbanSelect.deleteAdminHint', { ns: 'tasks' })
                  : t('kanbanSelect.delete', { ns: 'tasks' })
              }
            >
              <Trash2 size={15} aria-hidden />
            </button>
          )}

          <div className="flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-1 dark:border-gray-600">
            <button
              type="button"
              disabled={datedTasks.length === 0}
              className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => navigateToTaskPeriod(-1)}
              title={t('calendar.previousTaskPeriod')}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('gantt.task')}
            </span>
            <button
              type="button"
              disabled={datedTasks.length === 0}
              className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => navigateToTaskPeriod(1)}
              title={t('calendar.nextTaskPeriod')}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => navigate(-1)}
              aria-label={t('calendar.previous')}
            >
              <ChevronLeft size={16} />
            </button>
            <div
              data-calendar-period-picker="true"
              className="relative flex w-56 shrink-0 items-center justify-center gap-1.5"
            >
              <span className="truncate text-center text-sm font-semibold text-gray-800 dark:text-gray-100">
                {headerLabel}
              </span>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-400"
                onClick={openPeriodPicker}
                aria-label={t(`calendar.pickPeriod.${subView}`)}
                title={t(`calendar.pickPeriod.${subView}`)}
              >
                <CalendarDays size={14} />
              </button>
              {periodPickerOpen && (
                <div className="absolute left-1/2 top-full z-50 mt-1 flex -translate-x-1/2 items-center gap-1 rounded-md border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    onClick={() => shiftFocusYear(-1)}
                    aria-label={t('calendar.previousYear')}
                    title={t('calendar.previousYear')}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <input
                    ref={periodPickerRef}
                    type={periodPickerType}
                    value={periodPickerValue}
                    onChange={(event) => handlePeriodPickerChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' || event.key === 'Enter') {
                        setPeriodPickerOpen(false);
                      }
                    }}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    aria-label={t(`calendar.pickPeriod.${subView}`)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    onClick={() => shiftFocusYear(1)}
                    aria-label={t('calendar.nextYear')}
                    title={t('calendar.nextYear')}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => navigate(1)}
              aria-label={t('calendar.next')}
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              className="ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-blue-500 px-2.5 text-xs font-medium text-white hover:bg-blue-600"
              onClick={goToToday}
              title={t('gantt.today')}
            >
              <Calendar size={14} aria-hidden />
              {t('gantt.today')}
            </button>
          </div>

          <ColumnFilterDropdown
            columns={columns}
            visibleColumns={effectiveCalendarColumnIds}
            onColumnsChange={persistCalendarColumns}
            selectedBoard={boardId || null}
            compact
            enableHelpReveal={false}
            triggerTitle={t('calendar.filterStatuses')}
            onResetToDefault={() => persistCalendarColumns(null)}
          />

          {subView === 'day' && (
            <label
              className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              title={t('calendar.daySort.label')}
            >
              <ArrowUpDown size={14} className="pointer-events-none" aria-hidden />
              <span className="sr-only">{t('calendar.daySort.label')}</span>
              <select
                value={daySort}
                onChange={(event) => setDaySort(event.target.value as DaySort)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={t('calendar.daySort.label')}
              >
                {(['kanban', 'priority', 'status', 'assignee', 'title'] as DaySort[]).map(
                  (sort) => (
                    <option key={sort} value={sort}>
                      {t(`calendar.daySort.${sort}`)}
                    </option>
                  )
                )}
              </select>
            </label>
          )}

          <TaskJumpDropdown
            tasks={calendarSearchTasks}
            onTaskSelect={jumpToCalendarTask}
            className="ml-auto w-52"
          />
        </div>

        {multiSelectMode && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('calendar.multiSelectHint')}
          </p>
        )}
      </div>

      {subView !== 'day' && (
        <div
          ref={weekdayRowRef}
          className="sticky z-30 grid grid-cols-7 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
          style={{ top: PAGE_HEADER_OFFSET + toolbarHeight }}
        >
          {WEEKDAY_KEYS.map((k, index) => {
            const label = t(`calendar.weekdays.${k}`, k.toUpperCase());
            // Month headers name a weekday in general; week headers name a real date.
            const headerDay = subView === 'week' ? weekCells[index] : null;
            return (
              <div
                key={k}
                className="px-2 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 text-center border-r border-gray-200 dark:border-gray-700 last:border-r-0"
              >
                {headerDay ? (
                  <button
                    type="button"
                    className="group inline-flex items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    onClick={() => openDayView(headerDay)}
                    title={openDayLabelFor(headerDay)}
                    aria-label={openDayLabelFor(headerDay)}
                  >
                    <span className="transition-transform duration-150 group-hover:translate-x-0.5">
                      {label}
                    </span>
                    <ArrowRight
                      size={11}
                      className="-translate-x-1 opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                ) : (
                  label
                )}
              </div>
            );
          })}
        </div>
      )}

      <div ref={gridRef} className="flex-1" onClick={closeBarMenus}>
        {subView === 'month' &&
          Array.from({ length: 6 }, (_, week) => {
            const days = monthCells.slice(week * 7, week * 7 + 7);
            return renderWeekRow(
              days,
              `m-${week}`,
              CALENDAR_DENSITY[taskViewMode].monthMinHeight
            );
          })}

        {subView === 'week' && renderWeekRow(weekCells, 'week', 320)}

        {subView === 'day' &&
          (() => {
            const days = dayCells;
            // Day cards all overlap the same single-day slot. Assign lanes directly
            // from the chosen order so changing the selector always reorders the list.
            const placed = [...barsForDays(days)]
              .sort((a, b) => compareCalendarTasks(a.task, b.task))
              .map((bar, lane) => ({ ...bar, lane }));
            const maxLane = placed.reduce((m, b) => Math.max(m, b.lane), -1);
            const dayDensity = CALENDAR_DAY_DENSITY[taskViewMode];
            const h = Math.max(
              360,
              (maxLane + 1) * (dayDensity.barHeight + dayDensity.laneGap) + 64
            );
            const isToday = isSameDayLocal(days[0], today);
            return (
              <div
                data-calendar-today={isToday ? 'true' : undefined}
                className={`relative border-b border-gray-200 dark:border-gray-700 ${
                  isToday ? 'bg-blue-50 dark:bg-blue-900/40' : 'bg-white dark:bg-gray-900'
                }`}
                style={{ minHeight: h }}
              >
                <div className="flex items-center gap-1 p-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  <span className="min-w-0">
                    {new Intl.DateTimeFormat(locale, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })
                      .formatToParts(days[0])
                      .map((part, index) =>
                        part.type === 'day' && isToday ? (
                          <span
                            key={`${part.type}-${index}`}
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-blue-600 px-1 font-semibold text-white dark:bg-blue-500"
                          >
                            {part.value}
                          </span>
                        ) : (
                          <React.Fragment key={`${part.type}-${index}`}>
                            {part.value}
                          </React.Fragment>
                        )
                      )}
                  </span>
                  {canMutate && onAddTask && !multiSelectMode && (
                    <button
                      type="button"
                      className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                      onClick={() => void handleEmptyDay(days[0])}
                      title={t('column.addTask', { ns: 'tasks' })}
                      aria-label={t('column.addTask', { ns: 'tasks' })}
                    >
                      <Plus size={16} aria-hidden />
                    </button>
                  )}
                </div>
                <div className="relative px-2" style={{ minHeight: h - 40 }}>
                  <div
                    className="relative w-full"
                    style={{ minHeight: h - 48 }}
                    data-calendar-days={days.map(formatLocalYmd).join(',')}
                  >
                    {placed.map((b) => renderBar(b, 1))}
                  </div>
                  {placed.length === 0 && (
                    <p className="text-sm text-gray-400 dark:text-gray-500 px-2 py-6">
                      {t('calendar.emptyDay')}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
      </div>

      {deleteConfirmMode &&
        createPortal(
          <div
            className="fixed inset-0 z-[9991] flex items-center justify-center bg-black/45 p-4"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && !deleteSubmitting) {
                setDeleteConfirmMode(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="calendar-bulk-delete-title"
              className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="mb-4 flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                  <Trash2 size={18} aria-hidden />
                </span>
                <div>
                  <h2
                    id="calendar-bulk-delete-title"
                    className="text-base font-semibold text-gray-900 dark:text-gray-100"
                  >
                    {deleteConfirmMode === 'permanent'
                      ? t('kanbanSelect.deleteConfirmPermanentTitle', { ns: 'tasks' })
                      : t('kanbanSelect.deleteConfirmTitle', { ns: 'tasks' })}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {deleteConfirmMode === 'permanent'
                      ? t('kanbanSelect.deleteConfirmPermanent', {
                          ns: 'tasks',
                          count: actionSelectedIds.length,
                        })
                      : t('kanbanSelect.deleteConfirm', {
                          ns: 'tasks',
                          count: actionSelectedIds.length,
                        })}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={deleteSubmitting}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
                  onClick={() => setDeleteConfirmMode(null)}
                >
                  {t('buttons.cancel')}
                </button>
                <button
                  type="button"
                  disabled={deleteSubmitting || bulkBusy}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={() => void confirmSelectedTaskDelete()}
                >
                  {deleteConfirmMode === 'permanent'
                    ? t('kanbanSelect.deleteForever', { ns: 'tasks' })
                    : t('kanbanSelect.delete', { ns: 'tasks' })}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {assigneeMenuTask &&
        canMutate &&
        assigneeMenuPosition &&
        createPortal(
          <div
            ref={assigneeMenuRef}
            className="fixed z-[9999] overflow-hidden flex flex-col rounded-lg border-2 border-gray-300 bg-white shadow-2xl dark:border-gray-600 dark:bg-gray-800"
            role="menu"
            style={{
              left: assigneeMenuPosition.left,
              top: assigneeMenuPosition.top,
              width: assigneeMenuPosition.width,
              height: assigneeMenuPosition.height,
              maxHeight: assigneeMenuPosition.height,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <MemberSearchList
              members={members}
              selectedId={assigneeMenuTask.memberId ?? null}
              showAgentSection
              excludeViewers
              allowClear
              columns={assigneeMenuPosition.columns}
              onSelect={(memberId) => assignMember(assigneeMenuTask, memberId)}
              onEscape={() => {
                setAssigneeMenuTaskId(null);
                setAssigneeMenuPosition(null);
              }}
              maxHeightClassName="max-h-none"
              className="min-h-0 flex-1"
            />
          </div>,
          document.body
        )}

      {hoverCommentTask &&
        commentPreviewPosition &&
        createPortal(
          <div
            ref={commentPreviewRef}
            className={`comment-tooltip fixed z-[9999] ${CHROME_TOOLTIP_PANEL_SURFACE_CLASS}`}
            style={{
              left: commentPreviewPosition.left,
              top: commentPreviewPosition.top,
            }}
            onMouseEnter={keepCommentPreviewOpen}
            onMouseLeave={hideCommentPreview}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto p-3">
              {[...(hoverCommentTask.comments || [])]
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )
                .map((comment, index) => {
                  const author = members.find((member) => member.id === comment.authorId);
                  return (
                    <div
                      key={comment.id}
                      className={`mb-3 ${
                        index > 0
                          ? 'border-t border-gray-700 pt-2 dark:border-gray-300'
                          : ''
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: author?.color || '#6B7280' }}
                          aria-hidden
                        />
                        <span className="font-medium text-gray-200 dark:text-gray-800">
                          {author?.name || t('calendar.unknownAuthor')}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-600">
                          {new Date(comment.createdAt).toLocaleString(locale)}
                        </span>
                      </div>
                      <div
                        className="comment-md select-text text-xs leading-relaxed text-gray-300 dark:text-gray-700"
                        dangerouslySetInnerHTML={{
                          __html: sanitizedCommentHtml(comment.text),
                        }}
                      />
                    </div>
                  );
                })}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-b-md border-t border-gray-700 bg-gray-900 p-3 dark:border-gray-300 dark:bg-gray-100">
              <span className="font-medium text-gray-300 dark:text-gray-800">
                {t('calendar.comments', {
                  count: hoverCommentTask.comments?.length || 0,
                })}
              </span>
              <div className="flex items-center gap-1.5">
                {canMutate && (
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded bg-gray-700 text-gray-100 transition-colors hover:bg-gray-600 dark:bg-gray-300 dark:text-gray-900 dark:hover:bg-gray-400"
                    aria-label={t('taskCard.addComment', { ns: 'tasks' })}
                    title={t('taskCard.addComment', { ns: 'tasks' })}
                    onClick={() => {
                      setHoverCommentId(null);
                      setCommentTaskId(hoverCommentTask.id);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                  onClick={() => {
                    setHoverCommentId(null);
                    onSelectTask(hoverCommentTask, { scrollToComments: true });
                  }}
                >
                  {t('taskCard.open', { ns: 'tasks' })}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <AddCommentModal
        isOpen={Boolean(commentTask && canMutate)}
        taskTitle={commentTask?.title || ''}
        onClose={() => setCommentTaskId(null)}
        onSubmit={async (text) => {
          if (commentTask) await submitComment(commentTask, text);
        }}
      />
    </div>
  );
};

export default CalendarView;
