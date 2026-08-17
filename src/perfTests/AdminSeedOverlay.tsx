import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReportModal from './ReportModal';
import { PerfOverlayHeader } from './PerfOverlayHeader';
import { getHistory, getLastRun, type PerfRunRecord } from './metrics';
import { requestAdminNavigation } from '../utils/adminNavigation';
import {
  PERF_SEED_USER_PASSWORD,
  runSeedAll,
  runSeedCleanup,
  runSeedSprints,
  runSeedTags,
  runSeedUsers,
} from './runners/seedAdmin';

type ActiveScenario =
  | 'users'
  | 'tags'
  | 'sprints'
  | 'all'
  | 'cleanup'
  | null;
type ReportKind = 'last' | 'history' | null;

const COLLAPSED_KEY = 'perfTests.overlayCollapsed';

const SEED_TAB_HASH = {
  users: 'admin#users',
  tags: 'admin#tags',
  sprints: 'admin#project-settings#sprint-settings',
} as const;

function navigateToSeedTab(kind: keyof typeof SEED_TAB_HASH) {
  requestAdminNavigation(SEED_TAB_HASH[kind]);
}

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
    // ignore
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const inputClass =
  'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5';

/**
 * Admin-context PERF TESTS panel: seed users (@local, active, no invite),
 * tags, and sprints — plus cleanup by naming convention.
 */
const AdminSeedOverlay: React.FC<{
  currentUserId?: string | null;
  currentUserEmail?: string | null;
}> = ({ currentUserId, currentUserEmail }) => {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [usersInput, setUsersInput] = useState('5');
  const [tagsInput, setTagsInput] = useState('10');
  const [sprintsInput, setSprintsInput] = useState('3');
  const [concurrencyInput, setConcurrencyInput] = useState('3');
  const [active, setActive] = useState<ActiveScenario>(null);
  const [status, setStatus] = useState('');
  const [reportKind, setReportKind] = useState<ReportKind>(null);
  const [reportRuns, setReportRuns] = useState<PerfRunRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const users = clampInt(usersInput, 1, 200, 5);
  const tags = clampInt(tagsInput, 1, 200, 10);
  const sprints = clampInt(sprintsInput, 1, 50, 3);
  const concurrency = clampInt(concurrencyInput, 1, 20, 3);

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

  const summarize = (run: PerfRunRecord) =>
    run.cancelled
      ? `${run.scenario} cancelled (${run.succeeded}/${run.attempted})`
      : `${run.scenario}: ${run.succeeded} ok, ${run.failed} fail`;

  const startUsers = async () => {
    if (active) return;
    navigateToSeedTab('users');
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('users');
    setStatus(`Seeding ${users} users (×${concurrency})…`);
    try {
      const run = await runSeedUsers({
        count: users,
        concurrency,
        signal: ac.signal,
        onProgress: (d, t) => setStatus(`Users ${d}/${t}…`),
      });
      setStatus(
        `${summarize(run)} · login ${PERF_SEED_USER_PASSWORD} · emails *@local`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Seed users failed');
    } finally {
      abortRef.current = null;
      setActive(null);
    }
  };

  const startTags = async () => {
    if (active) return;
    navigateToSeedTab('tags');
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('tags');
    setStatus(`Seeding ${tags} tags…`);
    try {
      const run = await runSeedTags({
        count: tags,
        concurrency,
        signal: ac.signal,
        onProgress: (d, t) => setStatus(`Tags ${d}/${t}…`),
      });
      setStatus(summarize(run));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Seed tags failed');
    } finally {
      abortRef.current = null;
      setActive(null);
    }
  };

  const startSprints = async () => {
    if (active) return;
    navigateToSeedTab('sprints');
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('sprints');
    setStatus(`Seeding ${sprints} sprints…`);
    try {
      const run = await runSeedSprints({
        count: sprints,
        signal: ac.signal,
        onProgress: (d, t) => setStatus(`Sprints ${d}/${t}…`),
      });
      setStatus(summarize(run));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Seed sprints failed');
    } finally {
      abortRef.current = null;
      setActive(null);
    }
  };

  const startAll = async () => {
    if (active) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('all');
    setStatus('Seeding sample data…');
    try {
      const runs = await runSeedAll({
        users,
        tags,
        sprints,
        concurrency,
        signal: ac.signal,
        onStatus: setStatus,
      });
      const ok = runs.reduce((s, r) => s + r.succeeded, 0);
      const fail = runs.reduce((s, r) => s + r.failed, 0);
      const cancelled = runs.some((r) => r.cancelled);
      setStatus(
        cancelled
          ? `Seed all cancelled (${ok} ok, ${fail} fail)`
          : `Seed all done: ${ok} ok, ${fail} fail`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Seed all failed');
    } finally {
      abortRef.current = null;
      setActive(null);
    }
  };

  const startCleanup = async () => {
    if (active) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setActive('cleanup');
    setStatus('Cleaning seed data…');
    try {
      const run = await runSeedCleanup({
        signal: ac.signal,
        excludeUserId: currentUserId,
        excludeUserEmail: currentUserEmail,
        onProgress: setStatus,
      });
      setStatus(summarize(run));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      abortRef.current = null;
      setActive(null);
    }
  };

  const busy = active !== null;

  const actionBtn = (
    scenario: ActiveScenario,
    label: string,
    onStart: () => void,
    color: string
  ) => (
    <button
      type="button"
      disabled={busy && active !== scenario}
      onClick={() => (active === scenario ? stopActive() : onStart())}
      className={`px-2.5 py-1.5 rounded font-medium ${
        active === scenario
          ? 'bg-red-600 text-white hover:bg-red-700'
          : `${color} text-white disabled:opacity-40`
      }`}
    >
      {active === scenario ? 'Cancel' : label}
    </button>
  );

  const setCollapsedPreference = useCallback((next: boolean) => {
    setCollapsed(next);
    writeCollapsedPreference(next);
  }, []);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[10050] w-80 max-w-[calc(100vw-2rem)] shadow-lg rounded-lg border border-amber-500/60 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <PerfOverlayHeader
          title={`PERF TESTS · ADMIN${active ? ` · ${active.toUpperCase()}` : ''}`}
          collapsed={collapsed}
          onCollapsedChange={setCollapsedPreference}
        />

        {!collapsed && (
          <div className="p-3 space-y-3 text-xs">
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              Sample data only. Users are active local accounts (
              <code className="text-[10px]">*@local</code>, no invite). Password:{' '}
              <code className="text-[10px]">{PERF_SEED_USER_PASSWORD}</code>
            </p>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium mb-1">Users</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={usersInput}
                  disabled={busy}
                  onChange={(e) => setUsersInput(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Tags</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={tagsInput}
                  disabled={busy}
                  onChange={(e) => setTagsInput(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Sprints</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={sprintsInput}
                  disabled={busy}
                  onChange={(e) =>
                    setSprintsInput(e.target.value.replace(/[^0-9]/g, ''))
                  }
                />
              </div>
            </div>

            <div>
              <label className="block font-medium mb-1" title="Parallel workers for users/tags">
                Concurrency
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
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {actionBtn('users', 'Users', startUsers, 'bg-blue-600 hover:bg-blue-700')}
              {actionBtn('tags', 'Tags', startTags, 'bg-teal-600 hover:bg-teal-700')}
              {actionBtn(
                'sprints',
                'Sprints',
                startSprints,
                'bg-violet-600 hover:bg-violet-700'
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy && active !== 'all'}
                onClick={() => (active === 'all' ? stopActive() : startAll())}
                className={`flex-1 px-2.5 py-1.5 rounded font-medium ${
                  active === 'all'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40'
                }`}
              >
                {active === 'all' ? 'Cancel' : 'Seed all'}
              </button>
              <button
                type="button"
                disabled={busy && active !== 'cleanup'}
                onClick={() => (active === 'cleanup' ? stopActive() : startCleanup())}
                className={`flex-1 px-2.5 py-1.5 rounded font-medium ${
                  active === 'cleanup'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40'
                }`}
              >
                {active === 'cleanup' ? 'Cancel' : 'Cleanup seed'}
              </button>
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
              <p className="text-[11px] text-gray-600 dark:text-gray-400 break-words">
                {status}
              </p>
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

export default AdminSeedOverlay;
