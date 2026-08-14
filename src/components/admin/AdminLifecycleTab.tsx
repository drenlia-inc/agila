import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw, Trash2, RefreshCw } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';
import { toast } from '../../utils/toast';
import { ModernCheckbox } from '../ModernCheckbox';
import {
  getLifecycleDeletedTasks,
  getLifecycleDeletedBoards,
  restoreTasksBatch,
  purgeLifecycleTasksBatch,
  purgeLifecycleBoardsBatch,
  restoreBoard,
  purgeBoard,
  restoreTask,
  updateSetting,
} from '../../api';
import { Board, Task } from '../../types';
import { formatToYYYYMMDDHHmm } from '../../utils/dateUtils';
import {
  ADMIN_NUMERIC_INPUT_CLASS,
  ADMIN_TABLE_ROW_CLASS,
  LIFECYCLE_RETENTION_DAYS,
  clampIntToString,
  parseOptionalInt,
} from '../../utils/adminFieldLimits';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import { AdminSection, adminInputClass } from './AdminSection';
import websocketClient from '../../services/websocketClient';
import {
  LIFECYCLE_DATA_CHANGED_EVENT,
} from '../../utils/boardTrashEvents';

type LifecycleConfirmDialog = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
};

interface AdminLifecycleTabProps {
  onLocalDirtyChange?: (dirty: boolean) => void;
  onRegisterLocalSave?: (save: (() => Promise<void>) | null) => void;
  discardNonce?: number;
  onPendingChange?: () => void | Promise<void>;
  /** True when Lifecycle is the visible Admin sub-tab (refresh on re-entry). */
  isActive?: boolean;
}

const AdminLifecycleTab: React.FC<AdminLifecycleTabProps> = ({
  onLocalDirtyChange,
  onRegisterLocalSave,
  discardNonce = 0,
  onPendingChange,
  isActive = true,
}) => {
  const { t } = useTranslation('admin', { keyPrefix: 'lifecycle' });
  const { t: tAdmin } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const { systemSettings, refreshSettings } = useSettings();

  const [deletedDays, setDeletedDays] = useState('0');
  const [archivedDays, setArchivedDays] = useState('0');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [tasks, setTasks] = useState<(Task & { boardTitle?: string })[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [selectedDeletedBoardIds, setSelectedDeletedBoardIds] = useState<Set<string>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<LifecycleConfirmDialog | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const wasActiveRef = useRef(isActive);

  useEffect(() => {
    if (!systemSettings) return;
    setDeletedDays(systemSettings.LIFECYCLE_DELETED_RETENTION_DAYS || '0');
    setArchivedDays(systemSettings.LIFECYCLE_ARCHIVED_RETENTION_DAYS || '0');
  }, [systemSettings, discardNonce]);

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const [taskList, boardList] = await Promise.all([
        getLifecycleDeletedTasks(search.trim() ? { q: search.trim() } : undefined),
        getLifecycleDeletedBoards(),
      ]);
      setTasks(taskList as (Task & { boardTitle?: string })[]);
      setBoards(boardList);
      setSelectedDeletedBoardIds((prev) => {
        const next = new Set<string>();
        const ids = new Set(boardList.map((b) => b.id));
        prev.forEach((id) => {
          if (ids.has(id)) next.add(id);
        });
        return next;
      });
      setSelectedTaskIds((prev) => {
        const next = new Set<string>();
        const ids = new Set(taskList.map((task) => task.id));
        prev.forEach((id) => {
          if (ids.has(id)) next.add(id);
        });
        return next;
      });
      void onPendingChange?.();
    } catch (error) {
      console.error(error);
      if (!silent) toast.error(t('loadFailed'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, t, onPendingChange]);

  // Initial load + when search changes
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Re-fetch when returning to this tab (Admin stays mounted while visiting Kanban)
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      void loadData({ silent: true });
    }
    wasActiveRef.current = isActive;
  }, [isActive, loadData]);

  // Keep list in sync with soft-delete / restore / purge elsewhere in the app
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadData({ silent: true });
      }, 200);
    };
    websocketClient.onTaskDeleted(scheduleRefresh);
    websocketClient.onTaskRestored(scheduleRefresh);
    websocketClient.onTaskPurged(scheduleRefresh);
    websocketClient.onBoardDeleted(scheduleRefresh);
    websocketClient.onBoardRestored(scheduleRefresh);
    window.addEventListener(LIFECYCLE_DATA_CHANGED_EVENT, scheduleRefresh);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      websocketClient.offTaskDeleted(scheduleRefresh);
      websocketClient.offTaskRestored(scheduleRefresh);
      websocketClient.offTaskPurged(scheduleRefresh);
      websocketClient.offBoardDeleted(scheduleRefresh);
      websocketClient.offBoardRestored(scheduleRefresh);
      window.removeEventListener(LIFECYCLE_DATA_CHANGED_EVENT, scheduleRefresh);
    };
  }, [loadData]);

  const boardChips = useMemo(() => {
    const map = new Map<string, { title: string; count: number }>();
    tasks.forEach((task) => {
      if (!task.boardId) return;
      const existing = map.get(task.boardId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(task.boardId, {
          title: (task as { boardTitle?: string }).boardTitle || task.boardId,
          count: 1,
        });
      }
    });
    return Array.from(map.entries())
      .map(([id, { title, count }]) => ({ id, title, count }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [tasks]);

  // Drop board filters that no longer have deleted tasks (chips hide; selection would empty the table)
  useEffect(() => {
    setSelectedBoardIds((prev) => {
      if (prev.length === 0) return prev;
      const valid = new Set(boardChips.map((chip) => chip.id));
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [boardChips]);

  const discreetCountClass =
    'inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none';

  const filteredTasks = useMemo(() => {
    if (selectedBoardIds.length === 0) return tasks;
    return tasks.filter((task) => task.boardId && selectedBoardIds.includes(task.boardId));
  }, [tasks, selectedBoardIds]);

  const toggleBoardChip = (boardId: string) => {
    setSelectedBoardIds((prev) =>
      prev.includes(boardId) ? prev.filter((id) => id !== boardId) : [...prev, boardId]
    );
  };

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const ids = filteredTasks.map((task) => task.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedTaskIds.has(id));
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const deletedRetentionDays = useMemo(() => {
    const raw = systemSettings?.LIFECYCLE_DELETED_RETENTION_DAYS ?? '0';
    return Math.max(0, parseInt(String(raw), 10) || 0);
  }, [systemSettings?.LIFECYCLE_DELETED_RETENTION_DAYS]);

  const autoDeleteEnabled = deletedRetentionDays > 0;

  const formatDaysUntilPurge = useCallback(
    (deletedAt?: string | null) => {
      if (!autoDeleteEnabled || !deletedAt) return '—';
      const deletedMs = new Date(deletedAt).getTime();
      if (!Number.isFinite(deletedMs)) return '—';
      const purgeAtMs = deletedMs + deletedRetentionDays * 24 * 60 * 60 * 1000;
      const daysLeft = Math.ceil((purgeAtMs - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 0) return t('daysUntilPurgeDue');
      return t('daysUntilPurge', { count: daysLeft });
    },
    [autoDeleteEnabled, deletedRetentionDays, t]
  );

  const savedDeletedDays = systemSettings?.LIFECYCLE_DELETED_RETENTION_DAYS || '0';
  const savedArchivedDays = systemSettings?.LIFECYCLE_ARCHIVED_RETENTION_DAYS || '0';
  const retentionDirty =
    deletedDays.trim() !== savedDeletedDays.trim() ||
    archivedDays.trim() !== savedArchivedDays.trim();

  useEffect(() => {
    onLocalDirtyChange?.(retentionDirty);
  }, [retentionDirty, onLocalDirtyChange]);

  const saveRetention = async (key: string, value: string) => {
    const parsed = parseOptionalInt(value);
    if (
      parsed === null ||
      parsed < LIFECYCLE_RETENTION_DAYS.min ||
      parsed > LIFECYCLE_RETENTION_DAYS.max
    ) {
      toast.error(
        tAdmin('numberOutOfRange', {
          label: t(
            key === 'LIFECYCLE_DELETED_RETENTION_DAYS' ? 'deletedRetention' : 'archivedRetention'
          ),
          min: LIFECYCLE_RETENTION_DAYS.min,
          max: LIFECYCLE_RETENTION_DAYS.max,
        })
      );
      const clamped = clampIntToString(
        value,
        LIFECYCLE_RETENTION_DAYS.min,
        LIFECYCLE_RETENTION_DAYS.max,
        0
      );
      if (key === 'LIFECYCLE_DELETED_RETENTION_DAYS') setDeletedDays(clamped);
      if (key === 'LIFECYCLE_ARCHIVED_RETENTION_DAYS') setArchivedDays(clamped);
      return;
    }
    const normalized = String(parsed);
    setSavingKey(key);
    try {
      await updateSetting(key, normalized);
      await refreshSettings?.();
      toast.success(t('settingsSaved'));
      if (key === 'LIFECYCLE_DELETED_RETENTION_DAYS') setDeletedDays(normalized);
      if (key === 'LIFECYCLE_ARCHIVED_RETENTION_DAYS') setArchivedDays(normalized);
    } catch (error) {
      console.error(error);
      toast.error(t('settingsSaveFailed'));
    } finally {
      setSavingKey(null);
    }
  };

  const saveLocalDraftsRef = useRef<() => Promise<void>>(async () => {});
  saveLocalDraftsRef.current = async () => {
    if (deletedDays.trim() !== savedDeletedDays.trim()) {
      await saveRetention('LIFECYCLE_DELETED_RETENTION_DAYS', deletedDays);
    }
    if (archivedDays.trim() !== savedArchivedDays.trim()) {
      await saveRetention('LIFECYCLE_ARCHIVED_RETENTION_DAYS', archivedDays);
    }
  };

  useEffect(() => {
    if (!onRegisterLocalSave) return;
    onRegisterLocalSave(() => saveLocalDraftsRef.current());
    return () => onRegisterLocalSave(null);
  }, [onRegisterLocalSave]);

  const resolveBoardName = (boardId: string) => {
    const deletedBoard = boards.find((b) => b.id === boardId);
    const taskOnBoard = tasks.find((task) => task.boardId === boardId);
    return deletedBoard?.title || taskOnBoard?.boardTitle || boardId;
  };

  const finishRestoreBatch = async (restoredCount: number, hadOtherErrors: boolean) => {
    if (restoredCount > 0) {
      toast.success(t('restoredCount', { count: restoredCount }));
      // Avoid a stale board chip filter hiding newly deleted tasks after restore
      setSelectedBoardIds([]);
    } else if (hadOtherErrors) {
      toast.error(t('restoreFailed'));
    }
    setSelectedTaskIds(new Set());
    await loadData();
  };

  const openRestoreBoardThenTasksConfirm = (
    boardIds: string[],
    blockedTaskIds: string[],
    alreadyRestored: number
  ) => {
    const boardNames = boardIds.map(resolveBoardName);
    setConfirmDialog({
      title: t('restoreBoardThenTitle'),
      message: t('restoreBoardThenTasksConfirm', {
        boards: boardNames.join(', '),
        count: blockedTaskIds.length,
      }),
      confirmLabel: t('restoreBoardThenConfirmAction'),
      onConfirm: async () => {
        let restoredCount = alreadyRestored;
        for (const boardId of boardIds) {
          await restoreBoard(boardId);
        }
        const retry = await restoreTasksBatch(blockedTaskIds);
        restoredCount += retry?.restored?.length || 0;
        await finishRestoreBatch(restoredCount, false);
      },
    });
  };

  const handleRestoreSelected = async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const result = await restoreTasksBatch(ids);
      const restoredCount = result?.restored?.length || 0;
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      const boardBlocked = errors.filter(
        (e: any) => e?.code === 'board_soft_deleted' && e?.taskId
      ) as Array<{ taskId: string; code: string }>;
      const otherErrors = errors.filter((e: any) => e?.code !== 'board_soft_deleted');

      if (boardBlocked.length > 0) {
        const blockedTaskIds = boardBlocked.map((e) => e.taskId);
        const boardIds = Array.from(
          new Set(
            blockedTaskIds
              .map((id) => tasks.find((task) => task.id === id)?.boardId)
              .filter((id): id is string => !!id)
          )
        );
        if (boardIds.length === 0) {
          await finishRestoreBatch(restoredCount, true);
          return;
        }
        // Keep UI in sync if some tasks already restored before the board prompt.
        if (restoredCount > 0) {
          toast.success(t('restoredCount', { count: restoredCount }));
          setSelectedTaskIds(new Set(blockedTaskIds));
          await loadData();
        }
        openRestoreBoardThenTasksConfirm(boardIds, blockedTaskIds, 0);
        return;
      }

      await finishRestoreBatch(restoredCount, otherErrors.length > 0 || restoredCount === 0);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('restoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handlePurgeSelected = () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    setConfirmDialog({
      title: t('purgeSelectedTitle'),
      message: t('purgeSelectedConfirm', { count: ids.length }),
      confirmLabel: t('purge'),
      danger: true,
      onConfirm: async () => {
        const result = await purgeLifecycleTasksBatch(ids);
        toast.success(t('purgedCount', { count: result?.purged?.length || 0 }));
        setSelectedTaskIds(new Set());
        setSelectedBoardIds([]);
        await loadData();
      },
    });
  };

  const handleRestoreOne = async (taskId: string) => {
    setBusy(true);
    try {
      await restoreTask(taskId);
      toast.success(t('taskRestored'));
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      setSelectedBoardIds([]);
      await loadData();
    } catch (error: any) {
      const code = error?.response?.data?.code;
      if (code !== 'board_soft_deleted') {
        toast.error(error?.response?.data?.error || t('restoreFailed'));
        return;
      }

      const task = tasks.find((item) => item.id === taskId);
      const boardId = task?.boardId;
      if (!boardId) {
        toast.error(t('restoreBoardFirst'));
        return;
      }

      setConfirmDialog({
        title: t('restoreBoardThenTitle'),
        message: t('restoreBoardThenTaskConfirm', {
          board: resolveBoardName(boardId),
        }),
        confirmLabel: t('restoreBoardThenConfirmAction'),
        onConfirm: async () => {
          await restoreBoard(boardId);
          await restoreTask(taskId);
          toast.success(t('taskRestored'));
          setSelectedTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
          setSelectedBoardIds([]);
          await loadData();
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleDeletedBoard = (boardId: string) => {
    setSelectedDeletedBoardIds((prev) => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const toggleAllDeletedBoards = () => {
    const ids = boards.map((board) => board.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedDeletedBoardIds.has(id));
    setSelectedDeletedBoardIds((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleRestoreSelectedBoards = async () => {
    const ids = Array.from(selectedDeletedBoardIds);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      let restored = 0;
      for (const boardId of ids) {
        await restoreBoard(boardId);
        restored += 1;
      }
      toast.success(t('boardsRestoredCount', { count: restored }), '');
      setSelectedDeletedBoardIds(new Set());
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('boardRestoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  const runPurgeSelectedBoards = async (ids: string[]) => {
    const result = await purgeLifecycleBoardsBatch(ids);
    toast.success(t('boardsPurgedCount', { count: result?.purged?.length || 0 }));
    setSelectedDeletedBoardIds(new Set());
    await loadData();
  };

  const handlePurgeSelectedBoards = () => {
    const ids = Array.from(selectedDeletedBoardIds);
    if (ids.length === 0) return;
    const associatedTasks = boards
      .filter((b) => ids.includes(b.id))
      .reduce((sum, b) => sum + (b.taskCount ?? b.trashTaskCount ?? 0), 0);
    if (associatedTasks === 0) {
      void (async () => {
        setBusy(true);
        try {
          await runPurgeSelectedBoards(ids);
        } catch (error: any) {
          toast.error(error?.response?.data?.error || t('purgeFailed'));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    setConfirmDialog({
      title: t('purgeSelectedBoardsTitle'),
      message: t('purgeSelectedBoardsConfirm', { count: ids.length }),
      confirmLabel: t('purge'),
      danger: true,
      onConfirm: async () => {
        await runPurgeSelectedBoards(ids);
      },
    });
  };

  const handleRestoreBoard = async (boardId: string) => {
    setBusy(true);
    try {
      await restoreBoard(boardId);
      toast.success(t('boardRestored'), '');
      setSelectedDeletedBoardIds((prev) => {
        const next = new Set(prev);
        next.delete(boardId);
        return next;
      });
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('boardRestoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  const runPurgeBoard = async (boardId: string) => {
    await purgeBoard(boardId);
    toast.success(t('boardPurged'));
    setSelectedDeletedBoardIds((prev) => {
      const next = new Set(prev);
      next.delete(boardId);
      return next;
    });
    await loadData();
  };

  const handlePurgeBoard = (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    const taskCount = board?.taskCount ?? board?.trashTaskCount ?? 0;
    if (taskCount === 0) {
      void (async () => {
        setBusy(true);
        try {
          await runPurgeBoard(boardId);
        } catch (error: any) {
          toast.error(error?.response?.data?.error || t('purgeFailed'));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    setConfirmDialog({
      title: t('purgeBoardTitle'),
      message: t('purgeBoardConfirm', {
        title: board?.title || boardId,
        count: taskCount,
      }),
      confirmLabel: t('purge'),
      danger: true,
      onConfirm: async () => {
        await runPurgeBoard(boardId);
      },
    });
  };

  const closeConfirmDialog = () => {
    if (confirmBusy) return;
    setConfirmDialog(null);
  };

  useEffect(() => {
    if (!confirmDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || confirmBusy) return;
      e.preventDefault();
      e.stopPropagation();
      setConfirmDialog(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDialog, confirmBusy]);

  const runConfirmDialog = async () => {
    if (!confirmDialog) return;
    setConfirmBusy(true);
    setBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
          (confirmDialog.danger ? t('purgeFailed') : t('restoreFailed'))
      );
    } finally {
      setConfirmBusy(false);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-tour-id="admin-lifecycle-content">
      <div data-setting-key="LIFECYCLE_DELETED_RETENTION_DAYS">
      <AdminSection
        title={t('retentionTitle')}
        description={t('retentionDescription')}
        dense
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">
              {t('deletedRetention')}
            </span>
            <span className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400 leading-snug">
              {t('deletedRetentionHint')}
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={deletedDays}
                onChange={(e) => setDeletedDays(e.target.value)}
                onBlur={() =>
                  setDeletedDays(
                    clampIntToString(
                      deletedDays,
                      LIFECYCLE_RETENTION_DAYS.min,
                      LIFECYCLE_RETENTION_DAYS.max,
                      0
                    )
                  )
                }
                className={`w-28 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
              />
              <button
                type="button"
                disabled={savingKey === 'LIFECYCLE_DELETED_RETENTION_DAYS'}
                onClick={() => void saveRetention('LIFECYCLE_DELETED_RETENTION_DAYS', deletedDays)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('save')}
              </button>
            </div>
          </label>
          <label className="block text-sm" data-setting-key="LIFECYCLE_ARCHIVED_RETENTION_DAYS">
            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">
              {t('archivedRetention')}
            </span>
            <span className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400 leading-snug">
              {t('archivedRetentionHint')}
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={archivedDays}
                onChange={(e) => setArchivedDays(e.target.value)}
                onBlur={() =>
                  setArchivedDays(
                    clampIntToString(
                      archivedDays,
                      LIFECYCLE_RETENTION_DAYS.min,
                      LIFECYCLE_RETENTION_DAYS.max,
                      0
                    )
                  )
                }
                className={`w-28 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
              />
              <button
                type="button"
                disabled={savingKey === 'LIFECYCLE_ARCHIVED_RETENTION_DAYS'}
                onClick={() => void saveRetention('LIFECYCLE_ARCHIVED_RETENTION_DAYS', archivedDays)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('save')}
              </button>
            </div>
          </label>
        </div>
        <AdminUnsavedHint show={retentionDirty} />
      </AdminSection>
      </div>

      <AdminSection
        title={
          <span className="inline-flex items-center gap-2">
            {t('deletedTasksTitle')}
            {tasks.length > 0 && (
              <span
                className={`${discreetCountClass} bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-100`}
                aria-label={t('deletedTasksCount', { count: tasks.length })}
              >
                {tasks.length > 99 ? '99+' : tasks.length}
              </span>
            )}
            {!autoDeleteEnabled && (
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                {t('noAutoDeleteSet')}
              </span>
            )}
          </span>
        }
        description={t('deletedTasksDescription')}
        dense
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className={`flex-1 min-w-[12rem] ${adminInputClass}`}
            />
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm dark:border-gray-600"
              title={t('refresh')}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={busy || selectedTaskIds.size === 0}
              onClick={() => void handleRestoreSelected()}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <RotateCcw size={14} />
              {t('restoreSelected')}
            </button>
            <button
              type="button"
              disabled={busy || selectedTaskIds.size === 0}
              onClick={() => void handlePurgeSelected()}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {t('purgeSelected')}
            </button>
        </div>

        {boardChips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {boardChips.map((chip) => {
              const active = selectedBoardIds.includes(chip.id);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => toggleBoardChip(chip.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span>{chip.title}</span>
                  <span
                    className={`${discreetCountClass} ${
                      active
                        ? 'bg-white/25 text-white'
                        : 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-100'
                    }`}
                    aria-hidden="true"
                  >
                    {chip.count > 99 ? '99+' : chip.count}
                  </span>
                </button>
              );
            })}
            {selectedBoardIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedBoardIds([])}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('clearBoardFilter')}
              </button>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-3 py-2 text-left">
                  <ModernCheckbox
                    checked={
                      filteredTasks.length > 0 &&
                      filteredTasks.every((task) => selectedTaskIds.has(task.id))
                    }
                    indeterminate={
                      filteredTasks.some((task) => selectedTaskIds.has(task.id)) &&
                      !filteredTasks.every((task) => selectedTaskIds.has(task.id))
                    }
                    onChange={toggleAllVisible}
                    aria-label={t('selectAll')}
                    size="sm"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">{t('colActions')}</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">{t('colTicket')}</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">{t('colTitle')}</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">{t('colBoard')}</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">{t('colDeleted')}</th>
                {autoDeleteEnabled && (
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                    {t('colDaysUntilPurge')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={autoDeleteEnabled ? 7 : 6}
                    className="px-3 py-8 text-center text-gray-500 dark:text-gray-400"
                  >
                    {loading ? t('loading') : t('noDeletedTasks')}
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => (
                  <tr key={task.id} className={ADMIN_TABLE_ROW_CLASS}>
                    <td className="px-3 py-2">
                      <ModernCheckbox
                        checked={selectedTaskIds.has(task.id)}
                        onChange={() => toggleTask(task.id)}
                        size="sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-left">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRestoreOne(task.id)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                      >
                        <RotateCcw size={14} />
                        {t('restore')}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                      {task.ticket || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{task.title}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {(task as any).boardTitle || task.boardId || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {task.deletedAt ? formatToYYYYMMDDHHmm(task.deletedAt) : '—'}
                    </td>
                    {autoDeleteEnabled && (
                      <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-300">
                        {formatDaysUntilPurge(task.deletedAt)}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <AdminSection
        title={
          <span className="inline-flex items-center gap-2">
            {t('deletedBoardsTitle')}
            {boards.length > 0 && (
              <span
                className={`${discreetCountClass} bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-100`}
                aria-label={t('deletedBoardsCount', { count: boards.length })}
              >
                {boards.length > 99 ? '99+' : boards.length}
              </span>
            )}
            {!autoDeleteEnabled && (
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                {t('noAutoDeleteSet')}
              </span>
            )}
          </span>
        }
        description={t('deletedBoardsDescription')}
        headerRight={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || selectedDeletedBoardIds.size === 0}
              onClick={() => void handleRestoreSelectedBoards()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <RotateCcw size={14} />
              {t('restoreSelectedBoards')}
              {selectedDeletedBoardIds.size > 0 ? ` (${selectedDeletedBoardIds.size})` : ''}
            </button>
            <button
              type="button"
              disabled={busy || selectedDeletedBoardIds.size === 0}
              onClick={handlePurgeSelectedBoards}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {t('purgeSelectedBoards')}
              {selectedDeletedBoardIds.size > 0 ? ` (${selectedDeletedBoardIds.size})` : ''}
            </button>
          </div>
        }
        dense
      >
        {boards.length > 0 && (
          <div
            role="note"
            className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p className="leading-snug font-medium">{t('boardRestoreTasksWarning')}</p>
          </div>
        )}
        {boards.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('noDeletedBoards')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <ModernCheckbox
                      checked={
                        boards.length > 0 &&
                        boards.every((board) => selectedDeletedBoardIds.has(board.id))
                      }
                      indeterminate={
                        boards.some((board) => selectedDeletedBoardIds.has(board.id)) &&
                        !boards.every((board) => selectedDeletedBoardIds.has(board.id))
                      }
                      onChange={toggleAllDeletedBoards}
                      aria-label={t('selectAll')}
                      size="sm"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                    {t('colActions')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                    {t('colTitle')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                    {t('colTasks')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                    {t('colDeleted')}
                  </th>
                  {autoDeleteEnabled && (
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                      {t('colDaysUntilPurge')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {boards.map((board) => {
                  const taskCount = board.trashTaskCount ?? board.taskCount ?? 0;
                  return (
                    <tr key={board.id} className={ADMIN_TABLE_ROW_CLASS}>
                      <td className="px-3 py-2">
                        <ModernCheckbox
                          checked={selectedDeletedBoardIds.has(board.id)}
                          onChange={() => toggleDeletedBoard(board.id)}
                          size="sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-left">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRestoreBoard(board.id)}
                          className="mr-2 inline-flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                        >
                          <RotateCcw size={14} />
                          {t('restore')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handlePurgeBoard(board.id)}
                          className="inline-flex items-center gap-1 text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                        >
                          <Trash2 size={14} />
                          {t('purge')}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                        {board.title}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        <span
                          className={`${discreetCountClass} bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-100`}
                          title={t('boardDeletedTasksCount', { count: taskCount })}
                        >
                          {taskCount > 99 ? '99+' : taskCount}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        {board.deletedAt ? formatToYYYYMMDDHHmm(board.deletedAt) : '—'}
                      </td>
                      {autoDeleteEnabled && (
                        <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-300">
                          {formatDaysUntilPurge(board.deletedAt)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      {confirmDialog &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
            role="presentation"
            onClick={closeConfirmDialog}
          >
            <div
              className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lifecycle-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start gap-3">
                <div className="flex-shrink-0">
                  <AlertTriangle
                    className={`h-6 w-6 ${
                      confirmDialog.danger ? 'text-red-500' : 'text-amber-500'
                    }`}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3
                    id="lifecycle-confirm-title"
                    className="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100"
                  >
                    {confirmDialog.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {confirmDialog.message}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeConfirmDialog}
                  disabled={confirmBusy}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  {tCommon('buttons.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void runConfirmDialog()}
                  disabled={confirmBusy}
                  className={`rounded-md px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
                    confirmDialog.danger
                      ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                      : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                  }`}
                >
                  {confirmBusy ? t('working') : confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default AdminLifecycleTab;
