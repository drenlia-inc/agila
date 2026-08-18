import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Columns, PriorityOption, TeamMember } from '../types';
import type { TaskDropPlacement } from '../utils/taskReorderingUtils';
import ReportModal from './ReportModal';
import { PerfOverlayHeader } from './PerfOverlayHeader';
import { getHistory, getLastRun, type PerfRunRecord } from './metrics';
import { memberDisplayName } from './lorem';
import {
  resolveDefaultPriority,
  runCleanupGenerated,
  runGenerateTasks,
} from './runners/generateTasks';
import { runMoveTasks } from './runners/moveTasks';

export interface PerfTestOverlayProps {
  boardId: string;
  columns: Columns;
  members: TeamMember[];
  availablePriorities: PriorityOption[];
  /** Column IDs currently shown on the board (Archive hidden unless user unhid it). */
  visibleColumnIds: string[];
  /** Same path as DnD */
  onMoveTask: (
    taskId: string,
    targetColumnId: string,
    placement: TaskDropPlacement
  ) => Promise<void>;
  /** Resync board + pill counts from the server after a scenario stops */
  onRefreshBoard?: () => Promise<void>;
}

type ActiveScenario = 'generate' | 'move' | 'cleanup' | null;
type ReportKind = 'last' | 'history' | null;

const COLLAPSED_KEY = 'perfTests.overlayCollapsed';

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const PerfTestOverlay: React.FC<PerfTestOverlayProps> = ({
  boardId,
  columns,
  members,
  availablePriorities,
  visibleColumnIds,
  onMoveTask,
  onRefreshBoard,
}) => {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [memberId, setMemberId] = useState(members[0]?.id || '');
  const [countInput, setCountInput] = useState('20');
  const [concurrencyInput, setConcurrencyInput] = useState('1');
  const [moveIntervalInput, setMoveIntervalInput] = useState('200');
  const [maxMovesInput, setMaxMovesInput] = useState('50');
  const [active, setActive] = useState<ActiveScenario>(null);
  const [status, setStatus] = useState('');
  const [reportKind, setReportKind] = useState<ReportKind>(null);
  const [reportRuns, setReportRuns] = useState<PerfRunRecord[]>([]);
  const createdIdsRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const visibleColumnIdsRef = useRef(visibleColumnIds);
  visibleColumnIdsRef.current = visibleColumnIds;

  const resyncBoard = useCallback(async () => {
    if (!onRefreshBoard) return;
    try {
      // Clear move-race flags so a forced refresh isn't fighting stale optimistic state
      window.justUpdatedFromWebSocket = false;
      (window as any).reorderingInProgress = false;
      await onRefreshBoard();
    } catch {
      // non-fatal — metrics/status already recorded
    }
  }, [onRefreshBoard]);

  useEffect(() => {
    if (!memberId && members[0]) setMemberId(members[0].id);
  }, [members, memberId]);

  const selectedMember = useMemo(
    () => members.find((m) => m.id === memberId) || members[0],
    [members, memberId]
  );

  // Fields stay free-form; clamp only when a run starts
  const count = clampInt(countInput, 1, 500, 20);
  const concurrency = clampInt(concurrencyInput, 1, 20, 1);
  const moveIntervalMs = clampInt(moveIntervalInput, 0, 10000, 200);
  /** Empty max-moves = unlimited until Cancel */
  const maxMoves =
    maxMovesInput.trim() === '' ? null : clampInt(maxMovesInput, 1, 5000, 50);

  const stopActive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => () => stopActive(), [stopActive]);

  const openReport = (kind: ReportKind) => {
    if (kind === 'last') {
      const last = getLastRun();
      setReportRuns(last ? [last] : []);
    } else if (kind === 'history') {
      setReportRuns(getHistory());
    }
    setReportKind(kind);
  };

  const startGenerate = async () => {
    if (!selectedMember || active) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('generate');
    setStatus(
      concurrency > 1
        ? `Burst generating ${count} tasks (×${concurrency})…`
        : `Generating ${count} tasks…`
    );
    createdIdsRef.current = [];
    try {
      const run = await runGenerateTasks({
        boardId,
        columns: columnsRef.current,
        visibleColumnIds: visibleColumnIdsRef.current,
        member: selectedMember,
        count,
        concurrency,
        defaultPriority: resolveDefaultPriority(availablePriorities),
        signal: ac.signal,
        onCreated: (id) => {
          createdIdsRef.current.push(id);
        },
        onProgress: (done, total) => {
          setStatus(
            concurrency > 1
              ? `Burst ${done}/${total} (×${concurrency})…`
              : `Generated ${done}/${total}…`
          );
        },
      });
      setStatus(
        run.cancelled
          ? `Generate cancelled (${run.succeeded}/${run.attempted})`
          : `Generate done: ${run.succeeded} ok, ${run.failed} fail` +
              (concurrency > 1 ? ` · ×${concurrency}` : '')
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      abortRef.current = null;
      setActive(null);
      await resyncBoard();
    }
  };

  const startMove = async () => {
    if (active) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('move');
    setStatus(
      maxMoves != null
        ? `Move storm: 0/${maxMoves} @ ${moveIntervalMs}ms…`
        : `Move storm @ ${moveIntervalMs}ms (until cancel)…`
    );
    try {
      const run = await runMoveTasks({
        boardId,
        getColumns: () => columnsRef.current,
        getVisibleColumnIds: () => visibleColumnIdsRef.current,
        moveTask: async (taskId, targetColumnId, placement) => {
          await onMoveTask(taskId, targetColumnId, placement);
        },
        signal: ac.signal,
        minIntervalMs: moveIntervalMs,
        maxIntervalMs: moveIntervalMs,
        maxMoves: maxMoves ?? undefined,
        onProgress: (attempted, max) => {
          setStatus(
            max != null
              ? `Move storm: ${attempted}/${max} @ ${moveIntervalMs}ms…`
              : `Move storm: ${attempted} @ ${moveIntervalMs}ms…`
          );
        },
      });
      setStatus(
        run.cancelled
          ? `Move cancelled (${run.succeeded} moves)`
          : `Move finished (${run.succeeded} moves)`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Move failed');
    } finally {
      abortRef.current = null;
      setActive(null);
      await resyncBoard();
    }
  };

  const startCleanup = async () => {
    if (active) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('cleanup');
    setStatus('Cleaning up generated tasks…');
    try {
      const run = await runCleanupGenerated({
        boardId,
        columns: columnsRef.current,
        taskIds: createdIdsRef.current.length > 0 ? createdIdsRef.current : undefined,
        signal: ac.signal,
      });
      if (!run.cancelled) createdIdsRef.current = [];
      setStatus(
        run.cancelled
          ? `Cleanup cancelled (${run.succeeded} deleted)`
          : `Cleanup done: ${run.succeeded} deleted`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      abortRef.current = null;
      setActive(null);
      await resyncBoard();
    }
  };

  const busy = active !== null;
  const inputClass =
    'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5';

  const setCollapsedPreference = useCallback((next: boolean) => {
    setCollapsed(next);
    writeCollapsedPreference(next);
  }, []);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[10050] w-80 max-w-[calc(100vw-2rem)] shadow-lg rounded-lg border border-amber-500/60 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <PerfOverlayHeader
          title={`PERF TESTS${active ? ` · ${active.toUpperCase()}` : ''}`}
          collapsed={collapsed}
          onCollapsedChange={setCollapsedPreference}
        />

        {!collapsed && (
          <div className="p-3 space-y-3 text-xs">
            <div>
              <label className="block font-medium mb-1">Assignee</label>
              <select
                className={inputClass}
                value={selectedMember?.id || ''}
                disabled={busy}
                onChange={(e) => setMemberId(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberDisplayName(m)}
                  </option>
                ))}
              </select>
            </div>

            {/* Burst create */}
            <div className="space-y-2 rounded border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-2">
              <div className="font-semibold text-blue-900 dark:text-blue-200">
                Burst create
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block font-medium mb-1">Tasks</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={inputClass}
                    value={countInput}
                    disabled={busy}
                    onChange={(e) => setCountInput(e.target.value.replace(/[^0-9]/g, ''))}
                  />
                </div>
                <div className="w-20">
                  <label className="block font-medium mb-1" title="Parallel create workers (1–20)">
                    Conc.
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={inputClass}
                    value={concurrencyInput}
                    disabled={busy}
                    onChange={(e) =>
                      setConcurrencyInput(e.target.value.replace(/[^0-9]/g, ''))
                    }
                    title="Parallel workers (1–20). Use &gt;1 for burst stress."
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={busy && active !== 'generate'}
                onClick={() => (active === 'generate' ? stopActive() : startGenerate())}
                className={`w-full px-3 py-1.5 rounded font-medium ${
                  active === 'generate'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40'
                }`}
              >
                {active === 'generate'
                  ? 'Cancel'
                  : concurrency > 1
                    ? `Burst generate (×${concurrency})`
                    : 'Generate'}
              </button>
            </div>

            {/* Move storm */}
            <div className="space-y-2 rounded border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-2">
              <div className="font-semibold text-indigo-900 dark:text-indigo-200">
                Move storm
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block font-medium mb-1" title="Delay between moves (ms)">
                    Interval ms
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={inputClass}
                    value={moveIntervalInput}
                    disabled={busy}
                    onChange={(e) =>
                      setMoveIntervalInput(e.target.value.replace(/[^0-9]/g, ''))
                    }
                  />
                </div>
                <div className="flex-1">
                  <label
                    className="block font-medium mb-1"
                    title="Stop after N moves. Leave empty to run until Cancel."
                  >
                    Max moves
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={inputClass}
                    value={maxMovesInput}
                    disabled={busy}
                    placeholder="∞"
                    onChange={(e) =>
                      setMaxMovesInput(e.target.value.replace(/[^0-9]/g, ''))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy && active !== 'move'}
                  onClick={() => (active === 'move' ? stopActive() : startMove())}
                  className={`flex-1 px-3 py-1.5 rounded font-medium ${
                    active === 'move'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40'
                  }`}
                >
                  {active === 'move' ? 'Cancel' : 'Start storm'}
                </button>
                <button
                  type="button"
                  disabled={busy && active !== 'cleanup'}
                  onClick={() => (active === 'cleanup' ? stopActive() : startCleanup())}
                  className={`px-3 py-1.5 rounded font-medium ${
                    active === 'cleanup'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40'
                  }`}
                >
                  {active === 'cleanup' ? 'Cancel' : 'Cleanup'}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openReport('last')}
                className="flex-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Last run
              </button>
              <button
                type="button"
                onClick={() => openReport('history')}
                className="flex-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Session history
              </button>
            </div>

            {status && (
              <p className="text-[11px] text-gray-600 dark:text-gray-400 break-words">{status}</p>
            )}
          </div>
        )}
      </div>

      {reportKind && (
        <ReportModal
          title={reportKind === 'last' ? 'Last perf run' : 'Session perf history'}
          runs={reportRuns}
          onClose={() => setReportKind(null)}
        />
      )}
    </>
  );
};

export default PerfTestOverlay;
