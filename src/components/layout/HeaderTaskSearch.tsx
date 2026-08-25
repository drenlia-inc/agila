import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../types';

export interface HeaderSearchTask extends Pick<
  Task,
  'id' | 'title' | 'ticket' | 'status' | 'priority' | 'priorityName' | 'priorityColor' | 'boardId' | 'startDate' | 'dueDate' | 'columnId'
> {
  /** Plain-text search fields, pre-extracted so the matcher stays cheap per keystroke. */
  descriptionText?: string;
  commentsText?: string;
  assigneeName?: string;
  requesterName?: string;
  /** Lives in a column flagged as archived — hidden on the board by default. */
  archived?: boolean;
  /** Set for soft-deleted tasks, which only exist in the board's Trash. */
  deletedAt?: string | null;
}

/** Which field produced the hit shown on the row. */
type MatchReason = 'ticket' | 'title' | 'description' | 'comment' | 'assignee' | 'requester';

/** Active work first, then the two easy-to-lose states. */
type ResultGroup = 'live' | 'archived' | 'trash';

interface ResultRow {
  task: HeaderSearchTask;
  score: number;
  reason: MatchReason;
  group: ResultGroup;
}

interface HeaderTaskSearchProps {
  value: string;
  onChange: (text: string) => void;
  tasks?: HeaderSearchTask[];
  onJumpToTask?: (task: HeaderSearchTask) => void;
  /** Looks up soft-deleted tasks, which are not part of the board payload. */
  onSearchTrashed?: (query: string, signal: AbortSignal) => Promise<HeaderSearchTask[]>;
}

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 40;
const TRASH_MIN_QUERY = 2;

/** Rank a task against the query, mirroring the fields the board filter uses. */
function scoreTask(
  task: HeaderSearchTask,
  query: string
): { score: number; reason: MatchReason } | null {
  const ticket = (task.ticket || '').toLowerCase();
  const title = (task.title || '').toLowerCase();
  const ticketHit = ticket.includes(query);
  const titleHit = title.includes(query);
  if (ticketHit || titleHit) {
    const exact = ticket === query || title === query;
    const prefix = ticket.startsWith(query) || title.startsWith(query);
    return {
      score: exact ? 0 : prefix ? 1 : 2,
      reason: ticketHit ? 'ticket' : 'title',
    };
  }
  if ((task.assigneeName || '').toLowerCase().includes(query)) {
    return { score: 3, reason: 'assignee' };
  }
  if ((task.requesterName || '').toLowerCase().includes(query)) {
    return { score: 4, reason: 'requester' };
  }
  if ((task.descriptionText || '').toLowerCase().includes(query)) {
    return { score: 5, reason: 'description' };
  }
  if ((task.commentsText || '').toLowerCase().includes(query)) {
    return { score: 6, reason: 'comment' };
  }
  return null;
}

const byScoreThenLabel = (a: ResultRow, b: ResultRow) => {
  if (a.score !== b.score) return a.score - b.score;
  return (a.task.ticket || a.task.title).localeCompare(
    b.task.ticket || b.task.title,
    undefined,
    { numeric: true, sensitivity: 'base' }
  );
};

/**
 * Compact board search bound to searchFilters.text (same pipeline as Tools filter).
 * Local state updates immediately; parent filter updates are debounced.
 * Matching tickets/titles appear in a dropdown; choosing one jumps to that task.
 */
const HeaderTaskSearch: React.FC<HeaderTaskSearchProps> = ({
  value,
  onChange,
  tasks = [],
  onJumpToTask,
  onSearchTrashed,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  // -1 means "no row picked": Enter then applies the text filter instead of
  // jumping. Arrow keys opt into a row; hovering only highlights.
  const [keyboardIndex, setKeyboardIndex] = useState(-1);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [trashedTasks, setTrashedTasks] = useState<HeaderSearchTask[]>([]);
  const lastEmittedRef = useRef(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const query = draft.trim().toLowerCase();

  // Same fields the board filter searches, so the dropdown lines up with the
  // column counters instead of showing a narrower ticket/title subset. Archived
  // and trashed hits are kept but pushed below active work.
  const matches = useMemo(() => {
    if (!query) return [];
    const live: ResultRow[] = [];
    const archived: ResultRow[] = [];
    for (const task of tasks) {
      const hit = scoreTask(task, query);
      if (!hit) continue;
      (task.archived ? archived : live).push({ task, ...hit, group: task.archived ? 'archived' : 'live' });
    }

    const trash: ResultRow[] = [];
    for (const task of trashedTasks) {
      const hit = scoreTask(task, query);
      if (!hit) continue;
      trash.push({ task, ...hit, group: 'trash' });
    }

    live.sort(byScoreThenLabel);
    archived.sort(byScoreThenLabel);
    trash.sort(byScoreThenLabel);
    return [...live, ...archived, ...trash].slice(0, MAX_RESULTS);
  }, [query, tasks, trashedTasks]);

  // Sync from parent (e.g. SearchInterface / clear filters)
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    setKeyboardIndex(-1);
    setHoverIndex(-1);
  }, [query]);

  // Trash lives outside the board payload, so it needs a lookup. Debounced and
  // aborted per keystroke so typing does not queue up requests.
  useEffect(() => {
    if (!onSearchTrashed || !open || query.length < TRASH_MIN_QUERY) {
      setTrashedTasks([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      onSearchTrashed(query, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) setTrashedTasks(found);
        })
        .catch(() => {
          if (!controller.signal.aborted) setTrashedTasks([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [onSearchTrashed, open, query]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useLayoutEffect(() => {
    if (!open || !query) {
      setMenuPos(null);
      return;
    }
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const width = Math.max(rect.width, 280);
    const margin = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const placeBelow = below >= 160 || below >= above;
    const maxHeight = Math.max(120, Math.min(320, placeBelow ? below : above));
    const top = placeBelow ? rect.bottom + 4 : Math.max(margin, rect.top - maxHeight - 4);
    setMenuPos({ left, top, width, maxHeight });
  }, [open, query, matches.length]);

  const emit = (next: string) => {
    lastEmittedRef.current = next;
    onChange(next);
  };

  /**
   * Typing only drives the dropdown — the board filter waits for Enter. Filtering
   * per keystroke emptied whichever board you happened to be on, even when the
   * match lived somewhere else. Emptying the box does clear an applied filter,
   * so the board can never stay filtered by text that is no longer there.
   */
  const handleChange = (next: string) => {
    setDraft(next);
    setOpen(true);
    if (!next && lastEmittedRef.current) emit('');
  };

  const handleClear = () => {
    setDraft('');
    emit('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const jumpTo = (task: HeaderSearchTask) => {
    if (!onJumpToTask) return;
    setDraft('');
    emit('');
    setOpen(false);
    onJumpToTask(task);
  };

  /** Enter with no row picked: commit the typed text as the board filter. */
  const applyFilterNow = () => {
    if (draft !== lastEmittedRef.current) emit(draft);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && open && matches.length > 0) {
      e.preventDefault();
      setHoverIndex(-1);
      setKeyboardIndex((index) => Math.min(index + 1, matches.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && open && matches.length > 0) {
      e.preventDefault();
      setHoverIndex(-1);
      setKeyboardIndex((index) => Math.max(index - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = open && keyboardIndex >= 0 ? matches[keyboardIndex] : null;
      if (picked) {
        jumpTo(picked.task);
      } else {
        applyFilterNow();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (open) {
        setOpen(false);
        return;
      }
      if (draft) {
        handleClear();
      } else {
        e.currentTarget.blur();
      }
    }
  };

  const showMenu = open && Boolean(query) && Boolean(menuPos);

  return (
    <div ref={rootRef} className="relative w-full min-w-0 md:w-64">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={t('searchInterface.headerSearchPlaceholder')}
        aria-label={t('searchInterface.headerSearchPlaceholder')}
        aria-autocomplete="list"
        aria-expanded={showMenu}
        aria-controls="header-task-search-results"
        role="combobox"
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 pl-7 pr-7 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        data-tour-id="header-task-search"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
      />
      {draft ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          title={t('searchInterface.clearSearch')}
          aria-label={t('searchInterface.clearSearch')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {showMenu &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            id="header-task-search-results"
            role="listbox"
            className="fixed z-[80] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
            style={{
              left: menuPos.left,
              top: menuPos.top,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {matches.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <span>{t('searchInterface.headerTasksFound', { count: matches.length })}</span>
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">
                    {t('searchInterface.headerEnterToFilter')}
                  </span>
                </div>
                {matches.map(({ task, reason, group }, index) => {
                  const ticket = task.ticket || task.id;
                  const active =
                    keyboardIndex >= 0 ? index === keyboardIndex : index === hoverIndex;
                  const startsGroup = group !== 'live' && matches[index - 1]?.group !== group;
                  const reasonLabel =
                    reason === 'ticket'
                      ? t('searchInterface.headerMatchTicket')
                      : reason === 'title'
                        ? t('searchInterface.headerMatchTitle')
                        : reason === 'assignee'
                          ? t('searchInterface.headerMatchAssignee', { name: task.assigneeName })
                          : reason === 'requester'
                            ? t('searchInterface.headerMatchRequester', {
                                name: task.requesterName,
                              })
                            : reason === 'description'
                              ? t('searchInterface.headerMatchDescription')
                              : t('searchInterface.headerMatchComment');
                  return (
                    <React.Fragment key={task.id}>
                      {startsGroup ? (
                        <div className="border-y border-gray-100 bg-gray-50/70 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-400">
                          {group === 'archived'
                            ? t('searchInterface.headerGroupArchived')
                            : t('searchInterface.headerGroupTrash')}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                          active
                            ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                            : 'text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-700'
                        }`}
                        onMouseEnter={() => setHoverIndex(index)}
                        onMouseLeave={() => setHoverIndex((prev) => (prev === index ? -1 : prev))}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => jumpTo(task)}
                      >
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: task.priorityColor || '#6B7280' }}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate">
                            <span className="font-medium">{ticket}</span>
                            <span
                              className={`text-gray-600 dark:text-gray-300 ${
                                group === 'trash' ? 'line-through' : ''
                              }`}
                            >
                              {': '}
                              {task.title}
                            </span>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            {group === 'archived' ? (
                              <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                                {t('searchInterface.headerBadgeArchived')}
                              </span>
                            ) : null}
                            {group === 'trash' ? (
                              <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/60 dark:text-red-200">
                                {t('searchInterface.headerBadgeTrash')}
                              </span>
                            ) : null}
                            {task.status ? (
                              <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                {task.status}
                              </span>
                            ) : null}
                            {reasonLabel ? (
                              <span className="inline-block truncate text-[10px] text-gray-500 dark:text-gray-400">
                                {reasonLabel}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </>
            ) : (
              <div className="px-3 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('searchInterface.headerNoTasksFound')}
                <span className="mt-1 block text-[11px] text-gray-400 dark:text-gray-500">
                  {t('searchInterface.headerEnterToFilter')}
                </span>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

export default HeaderTaskSearch;
