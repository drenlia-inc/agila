import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare2, RotateCcw, Square, Trash2 } from 'lucide-react';
import { Column, Columns, Task, TeamMember } from '../types';
import { formatToYYYYMMDDHHmm } from '../utils/dateUtils';
import { TaskViewMode } from '../utils/userPreferences';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import { ModernCheckbox } from './ModernCheckbox';
import { useColumnDisplayTitle } from '../utils/columnDisplayTitle';
import MemberAvatar from './ui/MemberAvatar';
import ColumnResizeHandle from './ColumnResizeHandle';

interface BoardTrashViewProps {
  tasks: Task[];
  /** Same visible columns (ordered) as the live board beneath. */
  displayColumns: Column[];
  columns: Columns;
  members?: TeamMember[];
  isAdmin: boolean;
  /** When false, hide select/restore/purge actions (viewers). */
  canMutate?: boolean;
  /** Currently open in TaskDetails (amber ring). Distinct from bulk checkboxes. */
  detailsTaskId?: string | null;
  /** Same grid style as the live Kanban board for width/alignment. */
  gridStyle: React.CSSProperties;
  /** Same column resize handle as the live board (shared width preference). */
  onColumnWidthResize?: (deltaX: number) => void;
  /** Paired with the live Kanban scroller by KanbanPage. */
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  loading?: boolean;
  onSelectTask: (task: Task) => void;
  onRestore: (taskId: string) => Promise<void>;
  onPurge: (taskId: string) => Promise<void>;
  onRestoreSelected: (taskIds: string[]) => Promise<void>;
  onPurgeSelected: (taskIds: string[]) => Promise<void>;
  /** Hide the trash panel (same as toggling trash off in BoardTabs). */
  onClose?: () => void;
  /** Same Full / Preview / Minimal density as the live board. */
  taskViewMode?: TaskViewMode;
}

function TrashedTaskCard({
  task,
  members,
  isAdmin,
  canMutate,
  checked,
  isDetailsOpen,
  taskViewMode,
  restoring,
  purging,
  bulkBusy,
  onOpen,
  onToggleCheck,
  onRestore,
  onPurge,
}: {
  task: Task;
  members: TeamMember[];
  isAdmin: boolean;
  canMutate: boolean;
  checked: boolean;
  isDetailsOpen: boolean;
  taskViewMode: TaskViewMode;
  restoring: boolean;
  purging: boolean;
  bulkBusy: boolean;
  onOpen: () => void;
  onToggleCheck: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const deletedLabel = task.deletedAt ? formatToYYYYMMDDHHmm(task.deletedAt) : '';
  const deletedByName = (task as any).deletedByName || t('trash.unknownUser');
  const isMinimal = taskViewMode === 'compact';
  const isFull = taskViewMode === 'expand';
  const titleText = task.title || t('trash.untitled');
  const deletionSummary = [
    task.ticket,
    titleText,
    `${t('trash.deletedBy')}: ${deletedByName}`,
    deletedLabel ? `${t('trash.deletedOn')}: ${deletedLabel}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const showActions = canMutate && (!bulkBusy || restoring || purging);
  const assigneeTooltip =
    members.find((member) => member.id === task.memberId)?.name || t('taskCard.noAssignee');

  const restoreButton = !bulkBusy && !purging && (
    <button
      type="button"
      disabled={restoring}
      onClick={() => void onRestore()}
      className={
        isMinimal
          ? 'inline-flex h-6 w-6 items-center justify-center rounded bg-blue-700 text-white transition-colors hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600'
          : 'inline-flex items-center gap-1 rounded-md bg-blue-700 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600'
      }
      aria-label={t('trash.restore')}
    >
      <RotateCcw size={isMinimal ? 11 : 12} className={restoring ? 'animate-spin' : ''} />
      {!isMinimal && t('trash.restore')}
    </button>
  );

  const purgeButton = isAdmin && !bulkBusy && !restoring && (
    <button
      type="button"
      disabled={purging}
      onClick={() => void onPurge()}
      className={
        isMinimal
          ? 'inline-flex h-6 w-6 items-center justify-center rounded bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500'
          : 'inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500'
      }
      aria-label={t('trash.purge')}
    >
      <Trash2 size={isMinimal ? 11 : 12} />
      {!isMinimal && t('trash.purge')}
    </button>
  );

  const actionCluster = showActions && (
    <div
      className={`flex items-center ${isMinimal ? 'shrink-0 gap-0.5' : 'mt-2 flex-wrap gap-1.5'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {isMinimal && restoreButton ? (
        <KanbanChromeTooltip label={t('trash.restore')} delayMs={0}>
          {restoreButton}
        </KanbanChromeTooltip>
      ) : (
        restoreButton
      )}
      {isMinimal && purgeButton ? (
        <KanbanChromeTooltip label={t('trash.purge')} delayMs={0}>
          {purgeButton}
        </KanbanChromeTooltip>
      ) : (
        purgeButton
      )}
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group relative rounded-lg bg-[var(--task-card-bg,#fff)] shadow-sm transition-shadow hover:shadow-md dark:bg-gray-800 ${
        isMinimal ? 'px-1.5 py-1' : 'p-2.5'
      } ${isDetailsOpen ? 'ring-1 ring-amber-400 dark:ring-amber-500' : ''}`}
      data-tour-id={`trash-task-${task.id}`}
      data-task-id={task.id}
    >
      <div className={`flex gap-2 ${isMinimal ? 'items-center' : 'items-start'}`}>
        {canMutate && (
          <label
            className={`relative flex shrink-0 cursor-pointer ${
              isMinimal ? '-m-1 items-center p-1' : '-m-2 items-start p-2'
            }`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ModernCheckbox
              checked={checked}
              disabled={bulkBusy}
              onChange={onToggleCheck}
              size="sm"
              aria-label={t('trash.selectTask')}
              data-tour-id={`trash-task-select-${task.id}`}
            />
          </label>
        )}
        {isMinimal ? (
          <KanbanChromeTooltip label={deletionSummary} delayMs={0} wrapperClassName="relative min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {task.ticket && (
                <span className="shrink-0 font-mono text-[10px] text-blue-600 dark:text-blue-400">
                  {task.ticket}
                </span>
              )}
              <h3 className="min-w-0 truncate text-xs font-medium text-gray-800 dark:text-gray-100">
                {titleText}
              </h3>
            </div>
          </KanbanChromeTooltip>
        ) : (
          <div className="min-w-0 flex-1">
            {task.ticket && (
              <div className="mb-0.5 font-mono text-xs text-blue-600 dark:text-blue-400">
                {task.ticket}
              </div>
            )}
            <h3 className="line-clamp-2 text-sm font-medium text-gray-800 dark:text-gray-100">
              {titleText}
            </h3>
          </div>
        )}
        <KanbanChromeTooltip label={assigneeTooltip} delayMs={0}>
          <div className="shrink-0">
            <MemberAvatar
              memberId={task.memberId}
              members={members}
              size={isMinimal ? 'xs' : 'sm'}
              nativeTitle={false}
            />
          </div>
        </KanbanChromeTooltip>
        {isMinimal && actionCluster}
      </div>

      {isFull && (
        <div className="space-y-0.5 pt-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          <div>
            {t('trash.deletedBy')}:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">{deletedByName}</span>
          </div>
          {deletedLabel && (
            <div>
              {t('trash.deletedOn')}:{' '}
              <span className="font-medium text-gray-700 dark:text-gray-200">{deletedLabel}</span>
            </div>
          )}
        </div>
      )}

      {!isMinimal && actionCluster}
    </div>
  );
}

export default function BoardTrashView({
  tasks,
  displayColumns,
  columns,
  members = [],
  isAdmin,
  canMutate = true,
  detailsTaskId = null,
  gridStyle,
  onColumnWidthResize,
  scrollContainerRef,
  loading,
  onSelectTask,
  onRestore,
  onPurge,
  onRestoreSelected,
  onPurgeSelected,
  onClose,
  taskViewMode = 'expand',
}: BoardTrashViewProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const columnDisplayTitle = useColumnDisplayTitle();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'restore' | 'purge' | null>(null);
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<'purgeSelected' | 'emptyTrash' | null>(null);
  const bulkConfirmRef = useRef<HTMLDivElement>(null);
  const cardPurgeConfirmRef = useRef<HTMLDivElement>(null);

  const dismissConfirms = () => {
    setBulkConfirm(null);
    setPurgeConfirmId(null);
  };

  // ESC / click-outside dismiss confirmation overlays (same as Cancel).
  useEffect(() => {
    if (!bulkConfirm && !purgeConfirmId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissConfirms();
      }
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (bulkConfirmRef.current?.contains(target)) return;
      if (cardPurgeConfirmRef.current?.contains(target)) return;
      dismissConfirms();
    };

    document.addEventListener('keydown', onKeyDown);
    // Defer so the click that opened the confirm does not immediately close it.
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [bulkConfirm, purgeConfirmId]);

  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  // Drop selection for tasks that left trash; never keep stale ids.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      taskIds.forEach((id) => {
        if (prev.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [taskIds]);

  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length;
  const selectionCount = selectedIds.size;

  const closeButton = onClose ? (
    <button
      type="button"
      onClick={onClose}
      className="inline-flex items-center rounded-full border border-amber-400 px-3 py-1 text-xs font-semibold text-gray-700 transition-colors hover:border-amber-500 hover:bg-amber-100/80 hover:text-gray-900 dark:border-amber-600 dark:text-gray-200 dark:hover:border-amber-500 dark:hover:bg-amber-900/40 dark:hover:text-white"
      aria-label={t('buttons.close', { ns: 'common' })}
      data-tour-id="board-trash-close"
    >
      {t('buttons.close', { ns: 'common' })}
    </button>
  ) : null;

  const headerActionClass =
    'inline-flex items-center rounded-md border border-amber-300/80 bg-white/80 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-amber-100/80 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-gray-900/40 dark:text-gray-200 dark:hover:bg-amber-900/40';

  const dangerActionClass =
    'inline-flex items-center rounded-md border border-red-300 bg-white/80 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-gray-900/40 dark:text-red-300 dark:hover:bg-red-950/40';

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    displayColumns.forEach((col) => map.set(col.id, []));

    tasks.forEach((task) => {
      const columnId = task.columnId || (task as any).columnid;
      if (columnId && map.has(columnId)) {
        map.get(columnId)!.push(task);
      } else if (columnId && columns[columnId]) {
        // Column exists but is filtered from display — skip to keep alignment with live
      } else {
        // Orphan: park under first display column so nothing is lost, or a virtual bucket
        const orphanKey = '__orphan__';
        if (!map.has(orphanKey)) map.set(orphanKey, []);
        map.get(orphanKey)!.push(task);
      }
    });

    map.forEach((list, key) => {
      map.set(
        key,
        list.slice().sort((a, b) => (a.position || 0) - (b.position || 0))
      );
    });
    return map;
  }, [tasks, displayColumns, columns]);

  const orphanTasks = tasksByColumn.get('__orphan__') || [];

  const trashGridStyle = useMemo(
    () => ({
      ...gridStyle,
      // Content-height columns — do not stretch to the tallest sibling
      alignItems: 'start' as const,
    }),
    [gridStyle]
  );

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleColumnSelected = (columnTasks: Task[]) => {
    const columnAllSelected =
      columnTasks.length > 0 && columnTasks.every((task) => selectedIds.has(task.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      columnTasks.forEach((task) => {
        if (columnAllSelected) next.delete(task.id);
        else next.add(task.id);
      });
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(taskIds));
    }
  };

  const handleRestore = async (taskId: string) => {
    setBusyId(taskId);
    setBusyAction('restore');
    try {
      await onRestore(taskId);
      setSelectedIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const confirmPurge = async (taskId: string) => {
    setPurgeConfirmId(null);
    setBusyId(taskId);
    setBusyAction('purge');
    try {
      await onPurge(taskId);
      setSelectedIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const runRestoreSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onRestoreSelected(ids);
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const runConfirmedBulkPurge = async () => {
    if (!bulkConfirm || bulkBusy) return;
    const ids =
      bulkConfirm === 'emptyTrash' ? [...taskIds] : Array.from(selectedIds);
    setBulkConfirm(null);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await onPurgeSelected(ids);
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  if (tasks.length === 0 && !loading) {
    return (
      <div
        className="relative mb-3 rounded-xl border border-amber-200/80 bg-amber-50/40 py-2 dark:border-amber-900/50 dark:bg-amber-950/20"
        data-tour-id="board-trash-view"
      >
        <div className="relative z-10 mb-2 flex min-h-[1.75rem] items-center gap-1.5 px-1">
          <h3 className="shrink-0 whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('trash.title')}
          </h3>
          {closeButton}
        </div>
        <div className="px-4 pb-3 text-center">
          <Trash2 className="mx-auto mb-2 text-gray-400" size={22} />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('trash.emptyTitle')}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('trash.emptyHint')}</p>
        </div>
      </div>
    );
  }

  const renderColumnCards = (columnTasks: Task[]) => (
    <div className={taskViewMode === 'compact' ? 'space-y-1' : 'space-y-2'}>
      {columnTasks.map((task) => (
        <div key={task.id} className="relative">
          <TrashedTaskCard
            task={task}
            members={members}
            isAdmin={isAdmin}
            canMutate={canMutate}
            checked={selectedIds.has(task.id)}
            isDetailsOpen={detailsTaskId === task.id}
            taskViewMode={taskViewMode}
            restoring={busyId === task.id && busyAction === 'restore'}
            purging={busyId === task.id && busyAction === 'purge'}
            bulkBusy={bulkBusy}
            onOpen={() => onSelectTask(task)}
            onToggleCheck={() => toggleSelect(task.id)}
            onRestore={() => handleRestore(task.id)}
            onPurge={() => {
              setBulkConfirm(null);
              setPurgeConfirmId(task.id);
            }}
          />
          {purgeConfirmId === task.id && (
            <div
              ref={cardPurgeConfirmRef}
              role="dialog"
              aria-modal="true"
              className="absolute inset-x-1 top-1 z-10 rounded-lg border border-red-200 bg-white p-3 shadow-lg dark:border-red-800 dark:bg-gray-900"
            >
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-800 leading-snug dark:text-gray-100">
                  {t('trash.purgeConfirmTitle')}
                </p>
                <p className="mt-0.5 text-xs text-gray-600 leading-snug dark:text-gray-400">
                  {t('trash.purgeConfirmBody')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  onClick={dismissConfirms}
                >
                  {t('buttons.cancel', { ns: 'common' })}
                </button>
                <button
                  type="button"
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                  onClick={() => void confirmPurge(task.id)}
                >
                  {t('trash.purge')}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderColumnHeader = (title: string, columnTasks: Task[]) => {
    const columnAllSelected =
      columnTasks.length > 0 && columnTasks.every((task) => selectedIds.has(task.id));
    const selectLabel = columnAllSelected ? t('trash.unselectColumn') : t('trash.selectColumn');

    return (
      <div className="mb-1.5 flex min-h-4 items-center gap-1 px-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <div className="min-w-0 flex-1 truncate">
          {title}
          <span className="ml-1 font-normal normal-case text-gray-400">
            ({columnTasks.length})
          </span>
        </div>
        {columnTasks.length > 0 && canMutate && !bulkBusy && (
          <KanbanChromeTooltip label={selectLabel} delayMs={0} placement="top">
            <button
              type="button"
              onClick={() => toggleColumnSelected(columnTasks)}
              className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-blue-600 dark:hover:bg-gray-700 dark:hover:text-blue-400"
              aria-label={selectLabel}
            >
              {columnAllSelected ? <CheckSquare2 size={13} /> : <Square size={13} />}
            </button>
          </KanbanChromeTooltip>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative mb-3 rounded-xl border border-amber-200/80 bg-amber-50/40 py-2 dark:border-amber-900/50 dark:bg-amber-950/20"
      data-tour-id="board-trash-view"
    >
      <div className="relative z-10 mb-2 flex min-h-[1.75rem] items-center gap-1.5 overflow-x-auto hide-scrollbar px-1 pb-0.5">
        <h3 className="shrink-0 whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-100">
          {t('trash.title')}
          <span className="ml-2 rounded-full bg-amber-200/80 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
            {tasks.length}
          </span>
        </h3>
        {closeButton}
        <div className="flex shrink-0 items-center gap-1.5">
          {canMutate && !bulkBusy && (
            <button
              type="button"
              onClick={handleSelectAllToggle}
              className={headerActionClass}
              data-tour-id="board-trash-select-all"
            >
              {allSelected ? t('trash.unselectAll') : t('trash.selectAll')}
            </button>
          )}
          {canMutate && !bulkBusy && selectionCount > 0 && (
            <button
              type="button"
              onClick={() => void runRestoreSelected()}
              className={headerActionClass}
              data-tour-id="board-trash-restore-selected"
            >
              {t('trash.restoreSelected')}
            </button>
          )}
          {canMutate && isAdmin && !bulkBusy && selectionCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setPurgeConfirmId(null);
                setBulkConfirm('purgeSelected');
              }}
              className={dangerActionClass}
              data-tour-id="board-trash-delete-selected"
            >
              {t('trash.deleteSelected')}
            </button>
          )}
          {canMutate && isAdmin && !bulkBusy && (
            <button
              type="button"
              onClick={() => {
                setPurgeConfirmId(null);
                setBulkConfirm('emptyTrash');
              }}
              className={dangerActionClass}
              data-tour-id="board-trash-empty"
            >
              {t('trash.emptyTrash')}
            </button>
          )}
          {canMutate && selectionCount > 0 && (
            <span className="text-xs font-medium text-amber-900 dark:text-amber-100">
              {t('trash.selectedCount', { count: selectionCount })}
            </span>
          )}
        </div>
        <p className="min-w-[12rem] flex-1 truncate text-center text-xs font-semibold text-gray-700 dark:text-gray-200">
          {t('trash.instruction')}
        </p>
        <p className="shrink-0 whitespace-nowrap text-right text-xs text-gray-500 dark:text-gray-400">
          {t('trash.subtitle')}
        </p>
      </div>

      {bulkConfirm && (
        <div
          ref={bulkConfirmRef}
          role="dialog"
          aria-modal="true"
          className="absolute right-2 top-10 z-20 w-96 rounded-lg border border-red-200 bg-white p-3 shadow-lg dark:border-red-800 dark:bg-gray-900"
          style={{ maxWidth: 'calc(100% - 1rem)' }}
        >
          <p className="mb-2 text-xs text-gray-700 dark:text-gray-200">
            {bulkConfirm === 'emptyTrash'
              ? t('trash.emptyTrashConfirm', { count: tasks.length })
              : t('trash.purgeSelectedConfirm', { count: selectionCount })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={dismissConfirms}
            >
              {t('buttons.cancel', { ns: 'common' })}
            </button>
            <button
              type="button"
              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
              onClick={() => void runConfirmedBulkPurge()}
              data-tour-id="board-trash-bulk-purge-confirm"
            >
              {bulkConfirm === 'emptyTrash' ? t('trash.emptyTrash') : t('trash.deleteSelected')}
            </button>
          </div>
        </div>
      )}

      {/* Same grid as live board (shared left gutter for the first-column bulk
          menu). Scrollbar hidden: stay synced with the board scroller. */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-x-auto w-full hide-scrollbar"
        data-kanban-scroll="trash"
      >
        {loading && tasks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('trash.loading')}
          </p>
        ) : (
          <>
        <div style={trashGridStyle}>
          {displayColumns.map((column, index, array) => {
            const columnTasks = tasksByColumn.get(column.id) || [];
            return (
              <React.Fragment key={column.id}>
                <div className="relative min-w-0 self-start">
                  {renderColumnHeader(columnDisplayTitle(column), columnTasks)}
                  {columnTasks.length > 0 ? (
                    renderColumnCards(columnTasks)
                  ) : (
                    <div className="rounded-md border border-dashed border-gray-200/80 px-2 py-1.5 text-[11px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
                      —
                    </div>
                  )}
                  {index < array.length - 1 && onColumnWidthResize && (
                    <ColumnResizeHandle onResize={onColumnWidthResize} />
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {orphanTasks.length > 0 && (
          <div className="mt-2 px-1">
            {renderColumnHeader(t('trash.unknownColumn'), orphanTasks)}
            <div className="grid gap-2" style={{ gridTemplateColumns: trashGridStyle.gridTemplateColumns }}>
              {renderColumnCards(orphanTasks)}
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
