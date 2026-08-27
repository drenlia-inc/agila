import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronDown, Search, X, Check } from 'lucide-react';
import { parseLocalDate } from '../utils/dateUtils';
import { formFilterTriggerClass, formDropdownSearchClass } from '../utils/formFieldClasses';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active?: boolean | number;
}

interface SprintTask {
  id: string;
  sprintId?: string | null;
}

interface SprintMultiFilterSelectorProps {
  selectedSprintIds: string[];
  onSelectedSprintIdsChange: (ids: string[]) => void;
  sprints: Sprint[];
  tasks?: SprintTask[];
  className?: string;
}

export default function SprintMultiFilterSelector({
  selectedSprintIds,
  onSelectedSprintIdsChange,
  sprints,
  tasks = [],
  className = '',
}: SprintMultiFilterSelectorProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const hasSelection = selectedSprintIds.length > 0;

  const filteredSprints = useMemo(
    () => sprints.filter((sprint) => sprint.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [sprints, searchTerm],
  );

  const showBacklogOption = 'backlog'.includes(searchTerm.toLowerCase()) || searchTerm === '';
  const totalOptions = (showBacklogOption ? 1 : 0) + filteredSprints.length;

  const getSprintTaskCount = (sprintId: string | null): number => {
    if (sprintId === null) {
      return tasks.filter((task) => !task.sprintId).length;
    }
    return tasks.filter((task) => task.sprintId === sprintId).length;
  };

  const triggerLabel = useMemo(() => {
    if (selectedSprintIds.length === 0) {
      return t('searchInterface.sprintFilterAll', { ns: 'common' });
    }
    if (selectedSprintIds.length === 1) {
      const onlyId = selectedSprintIds[0];
      if (onlyId === 'backlog') {
        return t('sprintSelector.backlog', { ns: 'tasks' });
      }
      return sprints.find((s) => s.id === onlyId)?.name ?? t('searchInterface.sprintFilter', { ns: 'common' });
    }
    return t('searchInterface.sprintFilter', { ns: 'common' });
  }, [selectedSprintIds, sprints, t]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchTerm]);

  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [highlightedIndex]);

  const toggleSprintId = (sprintId: string) => {
    const next = selectedSprintIds.includes(sprintId)
      ? selectedSprintIds.filter((id) => id !== sprintId)
      : [...selectedSprintIds, sprintId];
    onSelectedSprintIdsChange(next);
  };

  const handleClear = () => {
    onSelectedSprintIdsChange([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter': {
        e.preventDefault();
        if (highlightedIndex === -1) return;
        if (showBacklogOption && highlightedIndex === 0) {
          toggleSprintId('backlog');
        } else {
          const sprintIndex = highlightedIndex - (showBacklogOption ? 1 : 0);
          const picked = filteredSprints[sprintIndex];
          if (picked) toggleSprintId(picked.id);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
        break;
    }
  };

  const formatSprintDateRange = (start: string, end: string) => {
    if (!start || !end) return '';
    const startDate = parseLocalDate(start);
    const endDate = parseLocalDate(end);
    return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={formFilterTriggerClass(hasSelection)}
        title={t('searchInterface.sprintFilterHint', { ns: 'common' })}
        aria-label={t('sprintSelector.selectSprint', { ns: 'tasks' })}
      >
        <Calendar size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        {hasSelection && (
          <span className="shrink-0 px-1.5 py-0.5 text-xs leading-none bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
            {selectedSprintIds.length}
          </span>
        )}
        {!hasSelection && (
          <ChevronDown
            size={12}
            className={`pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>
      {hasSelection && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleClear();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors z-10"
          title={t('searchInterface.clearSprintFilter', { ns: 'common' })}
          aria-label={t('searchInterface.clearSprintFilter', { ns: 'common' })}
        >
          <X size={10} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
        </button>
      )}

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-[60] max-h-96 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('sprintSelector.searchSprints', { ns: 'tasks' })}
                className={`${formDropdownSearchClass('w-full')} pl-9 pr-8 py-2 text-sm`}
                autoFocus
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  <X className="h-3 w-3 text-gray-400" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {filteredSprints.length === 0 && !showBacklogOption ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {searchTerm
                  ? t('sprintSelector.noSprintsFound', { ns: 'tasks' })
                  : t('sprintSelector.noSprintsAvailable', { ns: 'tasks' })}
              </div>
            ) : (
              <>
                {showBacklogOption && (
                  <button
                    ref={(el) => {
                      optionRefs.current[0] = el;
                    }}
                    type="button"
                    onClick={() => toggleSprintId('backlog')}
                    onMouseEnter={() => setHighlightedIndex(0)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                      highlightedIndex === 0 ? 'bg-gray-50 dark:bg-gray-700' : ''
                    } ${
                      selectedSprintIds.includes('backlog')
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t('sprintSelector.backlog', { ns: 'tasks' })}</span>
                    <div className="flex items-center gap-2">
                      {getSprintTaskCount(null) > 0 && (
                        <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                          {getSprintTaskCount(null)}
                        </span>
                      )}
                      {selectedSprintIds.includes('backlog') && (
                        <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                      )}
                    </div>
                  </button>
                )}

                {filteredSprints.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700" />
                )}

                {filteredSprints.map((sprint, index) => {
                  const optionIndex = (showBacklogOption ? 1 : 0) + index;
                  const isSelected = selectedSprintIds.includes(sprint.id);
                  const taskCount = getSprintTaskCount(sprint.id);
                  return (
                    <button
                      key={sprint.id}
                      ref={(el) => {
                        optionRefs.current[optionIndex] = el;
                      }}
                      type="button"
                      onClick={() => toggleSprintId(sprint.id)}
                      onMouseEnter={() => setHighlightedIndex(optionIndex)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        highlightedIndex === optionIndex ? 'bg-gray-50 dark:bg-gray-700' : ''
                      } ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div
                            className={`truncate font-medium ${
                              isSelected
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            {sprint.name}
                            {(sprint.is_active === 1 || sprint.is_active === true) && (
                              <span className="ml-2 inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                {t('sprintSelector.active', { ns: 'tasks' })}
                              </span>
                            )}
                          </div>
                          {sprint.start_date && sprint.end_date && (
                            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              {formatSprintDateRange(sprint.start_date, sprint.end_date)}
                            </div>
                          )}
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-1">
                          {taskCount > 0 && (
                            <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                              {taskCount}
                            </span>
                          )}
                          {isSelected && (
                            <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
