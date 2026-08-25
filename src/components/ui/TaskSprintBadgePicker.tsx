import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatToYYYYMMDD } from '../../utils/dateUtils';
import SprintAssignmentCurrentPill from './SprintAssignmentCurrentPill';
import { KanbanChromeTooltip } from '../KanbanChromeTooltip';

export type TaskSprintOption = {
  id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  is_active?: boolean | number;
};

export interface TaskSprintBadgePickerProps {
  task: { sprintId?: string | null };
  sprints?: TaskSprintOption[];
  /** When set (specific sprint or backlog), badge is hidden — same as Kanban task cards. */
  selectedSprintId?: string | null;
  disabled?: boolean;
  onSprintSelect: (sprint: TaskSprintOption | null) => void;
  variant?: 'card' | 'inline';
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const formatSprintDate = (dateStr: string) => {
  if (!dateStr) return '';
  return formatToYYYYMMDD(dateStr);
};

/**
 * Sprint name badge + portal dropdown (shared by Kanban task cards and Gantt task rows).
 */
export default function TaskSprintBadgePicker({
  task,
  sprints: propSprints = [],
  selectedSprintId = null,
  disabled = false,
  onSprintSelect,
  variant = 'card',
  onInteractionStart,
  onInteractionEnd,
}: TaskSprintBadgePickerProps) {
  const { t } = useTranslation('tasks');
  const [sprints, setSprints] = useState<TaskSprintOption[]>(propSprints);
  const [showSelector, setShowSelector] = useState(false);
  const [selectorCoords, setSelectorCoords] = useState<{ left: number; top: number } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (propSprints.length > 0) {
      setSprints(propSprints);
    }
  }, [propSprints]);

  const getSprintName = useCallback((): string => {
    if (!task.sprintId || sprints.length === 0) return '';
    return sprints.find((s) => s.id === task.sprintId)?.name || '';
  }, [task.sprintId, sprints]);

  const shouldShow =
    selectedSprintId === null &&
    task.sprintId != null &&
    getSprintName() !== '';

  useEffect(() => {
    if (propSprints.length > 0) return;
    const shouldFetch = showSelector || (task.sprintId && sprints.length === 0);
    if (!shouldFetch) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/admin/sprints', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && response.ok) {
          const data = await response.json();
          setSprints(data.sprints || data || []);
        }
      } catch (error) {
        console.error('Failed to fetch sprints:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [propSprints.length, showSelector, task.sprintId, sprints.length]);

  const closeSelector = useCallback(() => {
    setShowSelector(false);
    setSelectorCoords(null);
    setSearchTerm('');
    setHighlightedIndex(-1);
    onInteractionEnd?.();
  }, [onInteractionEnd]);

  const openSelector = useCallback(() => {
    if (disabled || !badgeRef.current) return;
    onInteractionStart?.();
    const rect = badgeRef.current.getBoundingClientRect();
    const dropdownWidth = 256;
    const dropdownHeight = 300;

    let left = rect.left;
    if (window.innerWidth - (left + dropdownWidth) < 10) {
      left = rect.right - dropdownWidth;
    }
    if (left < 10) left = 10;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const top =
      spaceBelow < dropdownHeight && spaceAbove > spaceBelow
        ? rect.top - Math.min(dropdownHeight, spaceAbove - 10)
        : rect.bottom + 4;

    setSelectorCoords({ left, top });
    setShowSelector(true);
  }, [disabled, onInteractionStart]);

  useEffect(() => {
    if (!showSelector) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (selectorRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-task-sprint-trigger]')) return;
      closeSelector();
    };

    // Capture phase so Gantt row / DnD stopPropagation cannot block dismiss.
    const timeoutId = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [showSelector, closeSelector]);

  useEffect(() => {
    if (!showSelector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSelector();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showSelector, closeSelector]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchTerm]);

  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightedIndex]);

  const handleSelect = (sprint: TaskSprintOption | null) => {
    onSprintSelect(sprint);
    closeSelector();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const filtered = sprints.filter((sprint) =>
      sprint.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelect(filtered[highlightedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSelector();
    }
  };

  if (!shouldShow) return null;

  const sprintName = getSprintName();
  const displayName = sprintName.length > 20 ? `${sprintName.substring(0, 17)}...` : sprintName;
  const badgeClass = `px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 max-w-full truncate transition-colors ${
    disabled ? 'cursor-default' : 'cursor-pointer hover:bg-indigo-200 dark:hover:bg-indigo-900/60'
  }`;

  const badge = (
    <span
      ref={badgeRef}
      data-sprint-badge="true"
      data-task-sprint-trigger="true"
      className={badgeClass}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        if (showSelector) {
          closeSelector();
        } else {
          openSelector();
        }
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!disabled) onInteractionStart?.();
      }}
    >
      {displayName}
    </span>
  );

  const filteredSprints = sprints.filter((sprint) =>
    sprint.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      {variant === 'card' ? (
        <div className="mb-2 flex justify-end">
          <KanbanChromeTooltip
            label={t('taskCard.clickToSelectSprint')}
            delayMs={0}
            wrapperClassName="inline-flex max-w-full shrink-0"
          >
            {badge}
          </KanbanChromeTooltip>
        </div>
      ) : (
        <KanbanChromeTooltip
          label={t('taskCard.clickToSelectSprint')}
          delayMs={0}
          wrapperClassName="inline-flex max-w-[8rem] shrink-0"
        >
          {badge}
        </KanbanChromeTooltip>
      )}

      {showSelector &&
        selectorCoords &&
        createPortal(
          <div
            ref={selectorRef}
            role="dialog"
            aria-modal="true"
            data-sprint-selector="true"
            className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[9999]"
            style={{
              left: `${selectorCoords.left}px`,
              top: `${selectorCoords.top}px`,
              width: '256px',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('taskCard.searchSprints')}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                autoFocus
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {t('taskCard.loadingSprints')}
                </div>
              ) : (
                <>
                  {'backlog'.includes(searchTerm.toLowerCase()) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(null);
                      }}
                      onMouseEnter={() => setHighlightedIndex(-1)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-200 dark:border-gray-600 ${
                        task.sprintId == null
                          ? 'bg-blue-100 dark:bg-blue-900/30 border-l-2 border-blue-500'
                          : highlightedIndex === -1
                            ? 'bg-blue-50 dark:bg-blue-900/20'
                            : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {t('taskCard.noneBacklog')}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {task.sprintId == null && <SprintAssignmentCurrentPill />}
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-400 dark:bg-gray-600 text-white">
                            {t('taskCard.unassigned')}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('taskCard.removeFromSprint')}
                      </div>
                    </button>
                  )}
                  {sprints.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {t('taskCard.noSprintsAvailable')}
                    </div>
                  ) : (
                    filteredSprints.map((sprint, index) => (
                      <button
                        key={sprint.id}
                        type="button"
                        ref={(el) => {
                          optionRefs.current[index] = el;
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(sprint);
                        }}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                          task.sprintId === sprint.id
                            ? 'bg-blue-100 dark:bg-blue-900/30 border-l-2 border-blue-500'
                            : highlightedIndex === index
                              ? 'bg-blue-50 dark:bg-blue-900/20'
                              : sprint.is_active === 1 || sprint.is_active === true
                                ? 'bg-green-50 dark:bg-green-900/10'
                                : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-gray-900 dark:text-white">{sprint.name}</div>
                          <div className="flex items-center gap-1 shrink-0">
                            {task.sprintId === sprint.id && <SprintAssignmentCurrentPill />}
                            {(sprint.is_active === 1 || sprint.is_active === true) && (
                              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-500 text-white">
                                {t('taskCard.active')}
                              </span>
                            )}
                          </div>
                        </div>
                        {(sprint.start_date || sprint.end_date) && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {formatSprintDate(sprint.start_date || '')} →{' '}
                            {formatSprintDate(sprint.end_date || '')}
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
