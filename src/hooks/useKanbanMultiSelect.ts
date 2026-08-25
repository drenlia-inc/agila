import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addCollaboratorToTask,
  addTagToTask,
  addWatcherToTask,
  logBulkTaskFieldActivity,
  removeCollaboratorFromTask,
  removeWatcherFromTask,
} from '../api';
import { Columns, Task } from '../types';
import { toast } from '../utils/toast';
import { getWipStatus, hasWipLimit } from '../utils/kanbanFlowUtils';
import {
  getCheckedColumnIds,
  getTaskColumnId,
  pruneCheckedTaskIds,
  readKanbanMultiSelectSession,
  selectionSpansMultipleColumns as spansMultipleColumns,
  taskIdsInColumnRange,
  writeKanbanMultiSelectSession,
  type ToggleTaskCheckedOptions,
} from '../utils/kanbanMultiSelect';
import { hasEscapeConsumingOverlay, isEditableEscapeTarget } from '../utils/escapeKeyUtils';

type EditTaskOptions = { skipActivity?: boolean };

export type BulkUndoRelation = {
  type: 'watcher' | 'collaborator' | 'tag';
  /** The forward action that was performed (undo applies the inverse). */
  op: 'add' | 'remove';
  memberId?: string;
  tagId?: string;
};

/** Enough context to post one reverse bulk activity line after undo. */
export type BulkUndoActivity =
  | {
      type: 'field';
      field: 'memberId' | 'requesterId' | 'priorityId' | 'sprintId';
      /** Value applied by the forward bulk action */
      forwardNewValue: string | null;
      forwardNewLabel?: string | null;
    }
  | {
      type: 'column';
      reason: 'archive' | 'move';
    };

/** One-shot undo after a bulk change — restore prior state and reselect. */
export type BulkUndoSnapshot = {
  taskIds: string[];
  previousByTaskId: Record<string, Partial<Task>>;
  labelKey: string;
  kind?: 'fields' | 'relation' | 'restore' | 'moveBoard';
  relation?: BulkUndoRelation;
  /** Columns that should show the Undo FAB even if tasks left the board. */
  anchorColumnIds?: string[];
  /** Optional feed / email digest for the reverse operation */
  activity?: BulkUndoActivity;
  /** Full column id/position snapshots for bulk-move undo (source + dest). */
  previousColumnOrders?: Record<string, Array<{ id: string; position: number }>>;
};

type UseKanbanMultiSelectArgs = {
  columns: Columns;
  selectedBoard: string | null;
  isLinkingMode?: boolean;
  /** When TaskDetails is open, Escape closes details first (does not clear checks). */
  detailsOpen?: boolean;
  /** Open TaskDetails card — Shift+click range-selects from this card when in the same column. */
  detailsTaskId?: string | null;
  findTask: (taskId: string) => Task | null;
  onEditTask: (task: Task, options?: EditTaskOptions) => Promise<void>;
  onCopyTask: (task: Task, options?: { skipEmail?: boolean }) => Promise<Task | void | null>;
  onTagAdd: (taskId: string) => (tagId: string) => Promise<void>;
  onTagRemove: (taskId: string) => (tagId: string) => Promise<void>;
  onSoftDelete: (taskId: string, options?: { skipEmail?: boolean }) => Promise<void>;
  /** Soft-delete undo: restore tasks then refresh board. */
  onRestoreTasks: (taskIds: string[]) => Promise<void>;
  /** Admin hard-delete (Shift+click on bulk delete). */
  onPermanentDelete?: (taskId: string) => Promise<void>;
  onMoveToBoard: (
    taskId: string,
    boardId: string,
    options?: { skipEmail?: boolean }
  ) => Promise<void>;
  /** Restore source+dest column orders after a multi-select drag. */
  onUndoColumnMove?: (
    previousColumnOrders: Record<string, Array<{ id: string; position: number }>>
  ) => Promise<void>;
  getArchiveColumnId: () => string | null;
  availablePriorities: Array<{ id: number; priority: string; color: string }>;
  availableSprints?: Array<{ id: string; name: string }>;
  availableTags?: Array<{ id: number; tag: string }>;
};

const BULK_UNDO_TTL_MS = 60_000;

export function useKanbanMultiSelect({
  columns,
  selectedBoard,
  isLinkingMode = false,
  detailsOpen = false,
  detailsTaskId = null,
  findTask,
  onEditTask,
  onCopyTask,
  onTagAdd,
  onTagRemove,
  onSoftDelete,
  onRestoreTasks,
  onPermanentDelete,
  onMoveToBoard,
  onUndoColumnMove,
  getArchiveColumnId,
  availablePriorities,
  availableSprints = [],
  availableTags = [],
}: UseKanbanMultiSelectArgs) {
  const { t } = useTranslation('tasks');
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(() => {
    const saved = readKanbanMultiSelectSession();
    return saved?.taskIds.length ? new Set(saved.taskIds) : new Set();
  });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkUndo, setBulkUndo] = useState<BulkUndoSnapshot | null>(null);
  const lastAnchorIdRef = useRef<string | null>(null);
  const detailsTaskIdRef = useRef<string | null>(detailsTaskId);
  detailsTaskIdRef.current = detailsTaskId;
  const previousBoardRef = useRef<string | null>(null);
  const allowPersistRef = useRef(false);

  const clearAllChecked = useCallback(() => {
    lastAnchorIdRef.current = null;
    setCheckedTaskIds(new Set());
  }, []);

  const replaceCheckedTaskIds = useCallback((taskIds: string[]) => {
    lastAnchorIdRef.current = taskIds[taskIds.length - 1] || null;
    setCheckedTaskIds(new Set(taskIds));
  }, []);

  const clearBulkUndo = useCallback(() => {
    setBulkUndo(null);
  }, []);

  const offerBulkUndo = useCallback((snapshot: BulkUndoSnapshot) => {
    if (snapshot.taskIds.length === 0) return;
    setBulkUndo(snapshot);
  }, []);

  // Restore checks after refresh (same tab). Real board switches drop selection.
  // Do not treat "board still loading" (null → id) as a switch — that wiped sessionStorage.
  useEffect(() => {
    if (!selectedBoard) return;

    const saved = readKanbanMultiSelectSession();
    const prev = previousBoardRef.current;

    if (prev && prev !== selectedBoard) {
      previousBoardRef.current = selectedBoard;
      lastAnchorIdRef.current = null;
      setCheckedTaskIds(new Set());
      setBulkUndo(null);
      writeKanbanMultiSelectSession(null, new Set());
      allowPersistRef.current = true;
      return;
    }

    if (saved?.boardId === selectedBoard && saved.taskIds.length > 0) {
      setCheckedTaskIds((curr) => {
        const same =
          curr.size === saved.taskIds.length && saved.taskIds.every((id) => curr.has(id));
        return same ? curr : new Set(saved.taskIds);
      });
    } else if (saved && saved.boardId !== selectedBoard) {
      setCheckedTaskIds(new Set());
    }

    previousBoardRef.current = selectedBoard;
    allowPersistRef.current = true;
  }, [selectedBoard]);

  useEffect(() => {
    if (!allowPersistRef.current || !selectedBoard) return;
    writeKanbanMultiSelectSession(selectedBoard, checkedTaskIds);
  }, [selectedBoard, checkedTaskIds]);

  // Clear while linking
  useEffect(() => {
    if (isLinkingMode) {
      lastAnchorIdRef.current = null;
      setCheckedTaskIds(new Set());
      setBulkUndo(null);
    }
  }, [isLinkingMode]);

  // Auto-dismiss undo after a short window
  useEffect(() => {
    if (!bulkUndo) return;
    const timer = window.setTimeout(() => setBulkUndo(null), BULK_UNDO_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [bulkUndo]);

  // Prune ids that left the board (wait until tasks are loaded so refresh restore is not wiped)
  useEffect(() => {
    const columnList = Object.values(columns);
    if (columnList.length === 0) return;
    const loadedTaskCount = columnList.reduce(
      (n, col) => n + (col?.tasks?.length || 0),
      0
    );
    if (loadedTaskCount === 0) return;
    setCheckedTaskIds((prev) => pruneCheckedTaskIds(prev, columns));
  }, [columns]);

  // ESC clears multi-check only when TaskDetails is closed (details takes precedence).
  useEffect(() => {
    if (checkedTaskIds.size === 0 || detailsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (isEditableEscapeTarget(e.target)) return;
      if (hasEscapeConsumingOverlay()) return;
      e.preventDefault();
      lastAnchorIdRef.current = null;
      setCheckedTaskIds(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkedTaskIds.size, detailsOpen]);

  const selectionSpansMultipleColumns = useMemo(
    () => spansMultipleColumns(checkedTaskIds, columns),
    [checkedTaskIds, columns]
  );

  const isMultiSelectDragLocked = selectionSpansMultipleColumns;

  const toggleTaskChecked = useCallback((
    taskId: string,
    options?: ToggleTaskCheckedOptions
  ) => {
    setBulkUndo(null);
    if (options?.range && options.orderedIds && options.orderedIds.length > 0) {
      const ids = options.orderedIds;
      const last = lastAnchorIdRef.current;
      const detailsId = detailsTaskIdRef.current;
      const anchorFromDetails =
        detailsId && ids.includes(detailsId) ? detailsId : null;
      const anchorFromLast = last && ids.includes(last) ? last : null;
      const anchor = anchorFromDetails || anchorFromLast;
      const range =
        anchor && anchor !== taskId
          ? taskIdsInColumnRange(ids, anchor, taskId)
          : null;
      if (range && range.length > 0) {
        setCheckedTaskIds((prev) => {
          const next = new Set(prev);
          range.forEach((id) => next.add(id));
          return next;
        });
        return;
      }
    }
    lastAnchorIdRef.current = taskId;
    setCheckedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleColumnChecked = useCallback(
    (_columnId: string, taskIds: string[], selectAll: boolean) => {
      setBulkUndo(null);
      if (selectAll && taskIds.length > 0) {
        lastAnchorIdRef.current = taskIds[taskIds.length - 1];
      }
      setCheckedTaskIds((prev) => {
        const next = new Set(prev);
        if (selectAll) {
          taskIds.forEach((id) => next.add(id));
        } else {
          taskIds.forEach((id) => next.delete(id));
        }
        return next;
      });
    },
    []
  );

  const runBulk = useCallback(
    async (
      taskIds: string[],
      action: (taskId: string) => Promise<void | false>,
      successKey: string,
      options?: { clearSelection?: boolean }
    ) => {
      if (taskIds.length === 0 || bulkBusy) return;
      const clearSelection = options?.clearSelection !== false;
      setBulkBusy(true);
      let ok = 0;
      let failed = 0;
      let skipped = 0;
      try {
        for (const id of taskIds) {
          try {
            const result = await action(id);
            // Actions may return false to mean "already applied / no-op"
            if (result === false) {
              skipped += 1;
            } else {
              ok += 1;
            }
          } catch {
            failed += 1;
          }
        }
        if (failed === 0 && ok === 0 && skipped > 0) {
          // Nothing changed; avoid a misleading success toast
        } else if (failed === 0) {
          toast.success(t(successKey, { count: ok || skipped }), '');
        } else {
          toast.warning(t('kanbanSelect.partialFailed', { ok, failed }), '');
        }
        if (clearSelection) {
          setCheckedTaskIds(new Set());
        }
      } finally {
        setBulkBusy(false);
      }
    },
    [bulkBusy, t]
  );

  const onBulkAddTag = useCallback(
    async (taskIds: string[], tagId: string) => {
      const changedIds: string[] = [];
      const tagLabel =
        availableTags.find((tg) => String(tg.id) === String(tagId))?.tag || tagId;
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if (task.tags?.some((tg) => tg && String(tg.id) === String(tagId))) return false;
          await addTagToTask(id, parseInt(tagId, 10), { skipEmail: true });
          changedIds.push(id);
        },
        'kanbanSelect.taggedCount'
      );
      if (changedIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'tag',
          taskIds: changedIds,
          newValue: tagId,
          newLabel: tagLabel,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk tag activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId: {},
          labelKey: 'kanbanSelect.undoTag',
          kind: 'relation',
          relation: { type: 'tag', op: 'add', tagId },
        });
      }
    },
    [availableTags, findTask, offerBulkUndo, runBulk, selectedBoard]
  );

  const onBulkCopy = useCallback(
    async (taskIds: string[]) => {
      const newIds: string[] = [];
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          const copied = await onCopyTask(task, { skipEmail: true });
          if (copied?.id) newIds.push(copied.id);
        },
        'kanbanSelect.copiedCount'
      );
      if (newIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'copy',
          taskIds: newIds,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk copy activity failed:', err));
      }
    },
    [findTask, onCopyTask, runBulk, selectedBoard]
  );

  const onBulkArchive = useCallback(
    async (taskIds: string[]) => {
      const archiveId = getArchiveColumnId();
      if (!archiveId) return;
      const previousByTaskId: Record<string, Partial<Task>> = {};
      const changedIds: string[] = [];
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if (task.columnId === archiveId) return false;
          previousByTaskId[id] = { columnId: task.columnId, position: task.position };
          await onEditTask({ ...task, columnId: archiveId }, { skipActivity: true });
          changedIds.push(id);
        },
        'kanbanSelect.archivedCount'
      );
      if (changedIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'columnId',
          taskIds: changedIds,
          boardId: selectedBoard,
          reason: 'archive',
        }).catch((err) => console.error('Bulk archive activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoArchive',
          kind: 'fields',
          activity: { type: 'column', reason: 'archive' },
        });
      }
    },
    [findTask, getArchiveColumnId, offerBulkUndo, onEditTask, runBulk, selectedBoard]
  );

  const onBulkDelete = useCallback(
    async (taskIds: string[]) => {
      const previousByTaskId: Record<string, Partial<Task>> = {};
      const anchorColumnIds = new Set<string>();
      const changedIds: string[] = [];
      for (const id of taskIds) {
        const task = findTask(id);
        if (!task) continue;
        previousByTaskId[id] = {
          columnId: task.columnId,
          position: task.position,
          boardId: task.boardId,
        };
        const colId = getTaskColumnId(id, columns) || task.columnId;
        if (colId) anchorColumnIds.add(colId);
      }
      await runBulk(taskIds, async (id) => {
        await onSoftDelete(id, { skipEmail: true });
        changedIds.push(id);
      }, 'kanbanSelect.deletedCount');
      if (changedIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'delete',
          taskIds: changedIds,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk delete activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoDelete',
          kind: 'restore',
          anchorColumnIds: Array.from(anchorColumnIds),
        });
      }
    },
    [columns, findTask, offerBulkUndo, onSoftDelete, runBulk, selectedBoard]
  );

  const onBulkPermanentDelete = useCallback(
    async (taskIds: string[]) => {
      if (!onPermanentDelete) return;
      await runBulk(taskIds, onPermanentDelete, 'kanbanSelect.purgedCount');
    },
    [onPermanentDelete, runBulk]
  );

  const onBulkSprint = useCallback(
    async (taskIds: string[], sprintId: string | null) => {
      const changedIds: string[] = [];
      const oldValues = new Set<string | null>();
      const previousByTaskId: Record<string, Partial<Task>> = {};
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          const prev = task.sprintId ?? null;
          if (prev === sprintId) return false;
          oldValues.add(prev);
          previousByTaskId[id] = { sprintId: prev };
          await onEditTask({ ...task, sprintId }, { skipActivity: true });
          changedIds.push(id);
        },
        'kanbanSelect.sprintUpdatedCount'
      );
      if (changedIds.length > 0) {
        const olds = Array.from(oldValues);
        const sprintName =
          sprintId == null
            ? null
            : availableSprints.find((s) => s.id === sprintId)?.name || sprintId;
        logBulkTaskFieldActivity({
          field: 'sprintId',
          taskIds: changedIds,
          newValue: sprintId,
          oldValue: olds.length === 1 ? olds[0] : null,
          newLabel: sprintName,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk sprint activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoSprint',
          kind: 'fields',
          activity: {
            type: 'field',
            field: 'sprintId',
            forwardNewValue: sprintId,
            forwardNewLabel: sprintName,
          },
        });
      }
    },
    [availableSprints, findTask, offerBulkUndo, onEditTask, runBulk, selectedBoard]
  );

  const onBulkPriority = useCallback(
    async (taskIds: string[], priorityId: string) => {
      const numericId = parseInt(priorityId, 10);
      const changedIds: string[] = [];
      const oldValues = new Set<string | null>();
      const previousByTaskId: Record<string, Partial<Task>> = {};
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          const prev = task.priorityId;
          if (prev === numericId) return false;
          oldValues.add(prev == null ? null : String(prev));
          previousByTaskId[id] = { priorityId: prev };
          await onEditTask({ ...task, priorityId: numericId }, { skipActivity: true });
          changedIds.push(id);
        },
        'kanbanSelect.priorityUpdatedCount'
      );
      if (changedIds.length > 0) {
        const olds = Array.from(oldValues);
        const priorityName =
          availablePriorities.find((p) => p.id === numericId)?.priority || priorityId;
        logBulkTaskFieldActivity({
          field: 'priorityId',
          taskIds: changedIds,
          newValue: String(numericId),
          oldValue: olds.length === 1 ? olds[0] : null,
          newLabel: priorityName,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk priority activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoPriority',
          kind: 'fields',
          activity: {
            type: 'field',
            field: 'priorityId',
            forwardNewValue: String(numericId),
            forwardNewLabel: priorityName,
          },
        });
      }
    },
    [availablePriorities, findTask, offerBulkUndo, onEditTask, runBulk, selectedBoard]
  );

  const onBulkMoveToBoard = useCallback(
    async (taskIds: string[], boardId: string) => {
      const previousByTaskId: Record<string, Partial<Task>> = {};
      const anchorColumnIds = new Set<string>();
      const changedIds: string[] = [];
      for (const id of taskIds) {
        const task = findTask(id);
        if (!task) continue;
        previousByTaskId[id] = {
          boardId: task.boardId || selectedBoard || undefined,
          columnId: task.columnId,
          position: task.position,
        };
        const colId = getTaskColumnId(id, columns) || task.columnId;
        if (colId) anchorColumnIds.add(colId);
      }
      await runBulk(
        taskIds,
        async (id) => {
          await onMoveToBoard(id, boardId, { skipEmail: true });
          changedIds.push(id);
        },
        'kanbanSelect.movedToBoardCount'
      );
      if (changedIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'moveBoard',
          taskIds: changedIds,
          newValue: boardId,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk move-board activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoMoveBoard',
          kind: 'moveBoard',
          anchorColumnIds: Array.from(anchorColumnIds),
        });
      }
    },
    [columns, findTask, offerBulkUndo, onMoveToBoard, runBulk, selectedBoard]
  );

  const onBulkAssignee = useCallback(
    async (taskIds: string[], memberId: string | null) => {
      const changedIds: string[] = [];
      const oldValues = new Set<string | null>();
      const previousByTaskId: Record<string, Partial<Task>> = {};
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if ((task.memberId || null) === memberId) return false;
          oldValues.add(task.memberId || null);
          previousByTaskId[id] = { memberId: task.memberId ?? null };
          await onEditTask({ ...task, memberId }, { skipActivity: true });
          changedIds.push(id);
        },
        'kanbanSelect.assigneeUpdatedCount'
      );
      if (changedIds.length > 0) {
        const olds = Array.from(oldValues);
        logBulkTaskFieldActivity({
          field: 'memberId',
          taskIds: changedIds,
          newValue: memberId,
          oldValue: olds.length === 1 ? olds[0] : null,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk assignee activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoAssignee',
          kind: 'fields',
          activity: {
            type: 'field',
            field: 'memberId',
            forwardNewValue: memberId,
          },
        });
      }
    },
    [findTask, offerBulkUndo, onEditTask, runBulk, selectedBoard]
  );

  const onBulkRequester = useCallback(
    async (taskIds: string[], memberId: string | null) => {
      const changedIds: string[] = [];
      const oldValues = new Set<string | null>();
      const previousByTaskId: Record<string, Partial<Task>> = {};
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if ((task.requesterId || null) === memberId) return false;
          oldValues.add(task.requesterId || null);
          previousByTaskId[id] = { requesterId: task.requesterId ?? null };
          await onEditTask({ ...task, requesterId: memberId }, { skipActivity: true });
          changedIds.push(id);
        },
        'kanbanSelect.requesterUpdatedCount'
      );
      if (changedIds.length > 0) {
        const olds = Array.from(oldValues);
        logBulkTaskFieldActivity({
          field: 'requesterId',
          taskIds: changedIds,
          newValue: memberId,
          oldValue: olds.length === 1 ? olds[0] : null,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk requester activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId,
          labelKey: 'kanbanSelect.undoRequester',
          kind: 'fields',
          activity: {
            type: 'field',
            field: 'requesterId',
            forwardNewValue: memberId,
          },
        });
      }
    },
    [findTask, offerBulkUndo, onEditTask, runBulk, selectedBoard]
  );

  const onBulkAddWatcher = useCallback(
    async (taskIds: string[], memberId: string) => {
      const changedIds: string[] = [];
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if (task.watchers?.some((w) => w && w.id === memberId)) return false;
          await addWatcherToTask(id, memberId, { skipEmail: true });
          changedIds.push(id);
        },
        'kanbanSelect.watcherAddedCount'
      );
      if (changedIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'watcher',
          taskIds: changedIds,
          newValue: memberId,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk watcher activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId: {},
          labelKey: 'kanbanSelect.undoWatcher',
          kind: 'relation',
          relation: { type: 'watcher', op: 'add', memberId },
        });
      }
    },
    [findTask, offerBulkUndo, runBulk, selectedBoard]
  );

  const onBulkRemoveWatcher = useCallback(
    async (taskIds: string[], memberId: string) => {
      const changedIds: string[] = [];
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if (!task.watchers?.some((w) => w && w.id === memberId)) return false;
          await removeWatcherFromTask(id, memberId);
          changedIds.push(id);
        },
        'kanbanSelect.watcherRemovedCount'
      );
      if (changedIds.length > 0) {
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId: {},
          labelKey: 'kanbanSelect.undoWatcher',
          kind: 'relation',
          relation: { type: 'watcher', op: 'remove', memberId },
        });
      }
    },
    [findTask, offerBulkUndo, runBulk]
  );

  const onBulkAddCollaborator = useCallback(
    async (taskIds: string[], memberId: string) => {
      const changedIds: string[] = [];
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if (task.collaborators?.some((c) => c && c.id === memberId)) return false;
          await addCollaboratorToTask(id, memberId, { skipEmail: true });
          changedIds.push(id);
        },
        'kanbanSelect.collaboratorAddedCount'
      );
      if (changedIds.length > 0) {
        logBulkTaskFieldActivity({
          field: 'collaborator',
          taskIds: changedIds,
          newValue: memberId,
          boardId: selectedBoard,
        }).catch((err) => console.error('Bulk collaborator activity failed:', err));
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId: {},
          labelKey: 'kanbanSelect.undoCollaborator',
          kind: 'relation',
          relation: { type: 'collaborator', op: 'add', memberId },
        });
      }
    },
    [findTask, offerBulkUndo, runBulk, selectedBoard]
  );

  const onBulkRemoveCollaborator = useCallback(
    async (taskIds: string[], memberId: string) => {
      const changedIds: string[] = [];
      await runBulk(
        taskIds,
        async (id) => {
          const task = findTask(id);
          if (!task) throw new Error('missing');
          if (!task.collaborators?.some((c) => c && c.id === memberId)) return false;
          await removeCollaboratorFromTask(id, memberId);
          changedIds.push(id);
        },
        'kanbanSelect.collaboratorRemovedCount'
      );
      if (changedIds.length > 0) {
        offerBulkUndo({
          taskIds: changedIds,
          previousByTaskId: {},
          labelKey: 'kanbanSelect.undoCollaborator',
          kind: 'relation',
          relation: { type: 'collaborator', op: 'remove', memberId },
        });
      }
    },
    [findTask, offerBulkUndo, runBulk]
  );

  /** Record undo after a kanban drag (single or multi) that actually moved. */
  const recordColumnMoveUndo = useCallback(
    (
      taskIds: string[],
      previousByTaskId: Record<string, Partial<Task>>,
      previousColumnOrders?: Record<string, Array<{ id: string; position: number }>>
    ) => {
      if (taskIds.length < 1) return;
      offerBulkUndo({
        taskIds,
        previousByTaskId,
        previousColumnOrders,
        labelKey:
          taskIds.length === 1 ? 'kanbanSelect.undoMoveSingle' : 'kanbanSelect.undoMove',
        kind: 'fields',
        activity: { type: 'column', reason: 'move' },
      });
    },
    [offerBulkUndo]
  );

  const logReverseBulkActivity = useCallback(
    (snapshot: BulkUndoSnapshot, succeededIds: string[]) => {
      if (succeededIds.length === 0 || !snapshot.activity) return;
      const act = snapshot.activity;

      if (act.type === 'column') {
        logBulkTaskFieldActivity({
          field: 'columnId',
          taskIds: succeededIds,
          boardId: selectedBoard,
          reason: act.reason === 'archive' ? 'undidArchive' : 'undidMove',
        }).catch((err) => console.error('Bulk undo column activity failed:', err));
        return;
      }

      const field = act.field;
      const prevValues = succeededIds.map((id) => {
        const prev = snapshot.previousByTaskId[id];
        if (!prev) return null;
        if (field === 'priorityId') {
          const v = prev.priorityId;
          return v == null ? null : String(v);
        }
        if (field === 'sprintId') {
          return prev.sprintId ?? null;
        }
        if (field === 'memberId') {
          return prev.memberId ?? null;
        }
        return prev.requesterId ?? null;
      });
      const unique = new Set(prevValues);
      const uniform = unique.size === 1;
      const restoreValue = uniform ? prevValues[0] : null;

      let newLabel: string | null = null;
      if (uniform) {
        if (field === 'priorityId' && restoreValue != null) {
          const idNum = parseInt(restoreValue, 10);
          newLabel =
            availablePriorities.find((p) => p.id === idNum)?.priority || restoreValue;
        } else if (field === 'sprintId') {
          newLabel =
            restoreValue == null
              ? null
              : availableSprints.find((s) => s.id === restoreValue)?.name || restoreValue;
        }
      }

      logBulkTaskFieldActivity({
        field,
        taskIds: succeededIds,
        newValue: uniform ? restoreValue : null,
        oldValue: act.forwardNewValue,
        newLabel,
        boardId: selectedBoard,
        restoredPrevious: !uniform,
      }).catch((err) => console.error('Bulk undo field activity failed:', err));
    },
    [availablePriorities, availableSprints, selectedBoard]
  );

  const onBulkUndo = useCallback(async () => {
    const snapshot = bulkUndo;
    if (!snapshot || bulkBusy) return;
    setBulkUndo(null);
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    const succeededIds: string[] = [];
    try {
      const kind = snapshot.kind || 'fields';

      if (kind === 'restore') {
        try {
          await onRestoreTasks(snapshot.taskIds);
          ok = snapshot.taskIds.length;
          succeededIds.push(...snapshot.taskIds);
        } catch {
          failed = snapshot.taskIds.length;
        }
      } else if (kind === 'moveBoard') {
        for (const id of snapshot.taskIds) {
          try {
            const prevBoard = snapshot.previousByTaskId[id]?.boardId;
            if (!prevBoard) {
              failed += 1;
              continue;
            }
            await onMoveToBoard(id, prevBoard);
            ok += 1;
            succeededIds.push(id);
          } catch {
            failed += 1;
          }
        }
      } else if (kind === 'relation' && snapshot.relation) {
        const { type, op, memberId, tagId } = snapshot.relation;
        for (const id of snapshot.taskIds) {
          try {
            if (type === 'tag' && tagId) {
              if (op === 'add') await onTagRemove(id)(tagId);
              else await onTagAdd(id)(tagId);
            } else if (type === 'watcher' && memberId) {
              if (op === 'add') await removeWatcherFromTask(id, memberId);
              else await addWatcherToTask(id, memberId);
            } else if (type === 'collaborator' && memberId) {
              if (op === 'add') await removeCollaboratorFromTask(id, memberId);
              else await addCollaboratorToTask(id, memberId);
            } else {
              failed += 1;
              continue;
            }
            ok += 1;
            succeededIds.push(id);
          } catch {
            failed += 1;
          }
        }
      } else if (
        snapshot.activity?.type === 'column' &&
        snapshot.activity.reason === 'move' &&
        snapshot.previousColumnOrders &&
        onUndoColumnMove
      ) {
        try {
          await onUndoColumnMove(snapshot.previousColumnOrders);
          ok = snapshot.taskIds.length;
          succeededIds.push(...snapshot.taskIds);
        } catch {
          failed = snapshot.taskIds.length;
        }
      } else {
        for (const id of snapshot.taskIds) {
          try {
            const task = findTask(id);
            const prev = snapshot.previousByTaskId[id];
            if (!task || !prev) {
              failed += 1;
              continue;
            }
            await onEditTask({ ...task, ...prev }, { skipActivity: true });
            ok += 1;
            succeededIds.push(id);
          } catch {
            failed += 1;
          }
        }
      }

      if (succeededIds.length > 0) {
        logReverseBulkActivity(snapshot, succeededIds);
      }

      if (failed === 0) {
        toast.success(t('kanbanSelect.undoRestoredCount', { count: ok }), '');
      } else {
        toast.warning(t('kanbanSelect.partialFailed', { ok, failed }), '');
      }
      if (kind !== 'moveBoard' || ok > 0) {
        const skipReselect =
          snapshot.taskIds.length === 1 &&
          snapshot.activity?.type === 'column' &&
          snapshot.activity.reason === 'move';
        setCheckedTaskIds(skipReselect ? new Set() : new Set(snapshot.taskIds));
      }
    } finally {
      setBulkBusy(false);
    }
  }, [
    bulkBusy,
    bulkUndo,
    findTask,
    logReverseBulkActivity,
    onEditTask,
    onMoveToBoard,
    onRestoreTasks,
    onTagAdd,
    onTagRemove,
    onUndoColumnMove,
    t,
  ]);

  const warnWipOnce = useCallback(
    (sourceColumnId: string, targetColumnId: string, moveCount: number) => {
      if (sourceColumnId === targetColumnId) return;
      const targetColumn = columns[targetColumnId];
      if (!targetColumn || !hasWipLimit(targetColumn.wip_limit)) return;
      const destCount = (targetColumn.tasks?.length || 0) + moveCount;
      const status = getWipStatus(destCount, targetColumn.wip_limit);
      if (status === 'at' || status === 'over') {
        toast.warning(
          t('column.wipSoftWarningTitle'),
          t('column.wipSoftWarningBody', {
            count: destCount,
            limit: targetColumn.wip_limit,
            column: targetColumn.title,
          })
        );
      }
    },
    [columns, t]
  );

  return {
    checkedTaskIds,
    setCheckedTaskIds,
    replaceCheckedTaskIds,
    clearAllChecked,
    toggleTaskChecked,
    toggleColumnChecked,
    selectionSpansMultipleColumns,
    isMultiSelectDragLocked,
    bulkBusy,
    bulkUndo,
    clearBulkUndo,
    onBulkUndo,
    recordColumnMoveUndo,
    checkedColumnIds: getCheckedColumnIds(checkedTaskIds, columns),
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
    warnWipOnce,
  };
}
