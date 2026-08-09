import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronDown, Search, X } from 'lucide-react';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

interface Task {
  id: string;
  sprintId?: string | null;
}

interface SprintSelectorProps {
  selectedSprintId: string | null;
  onSprintChange: (sprint: Sprint | null) => void;
  tasks?: Task[]; // All tasks for counting
  sprints?: Sprint[]; // Optional: sprints passed from parent (avoids duplicate API calls)
  /**
   * filter — board header (All Sprints + Backlog + sprints)
   * assign — task edit (Backlog + sprints only; null = backlog)
   */
  mode?: 'filter' | 'assign';
  /** Extra classes on the root (e.g. w-full for Task Page) */
  className?: string;
  disabled?: boolean;
}

const SprintSelector: React.FC<SprintSelectorProps> = ({
  selectedSprintId,
  onSprintChange,
  tasks = [],
  sprints: propSprints,
  mode = 'filter',
  className = '',
  disabled = false,
}) => {
  const { t } = useTranslation('tasks');
  const [sprints, setSprints] = useState<Sprint[]>(propSprints || []);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Use prop sprints if provided, otherwise fetch from API (fallback for backward compatibility)
  useEffect(() => {
    if (propSprints && propSprints.length > 0) {
      setSprints(propSprints);
      return;
    }
    
    // Only fetch if not provided via props
    const fetchSprints = async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/admin/sprints', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          // Handle both { sprints: [] } and direct array responses
          setSprints(data.sprints || data || []);
        }
      } catch (error) {
        console.error('Failed to fetch sprints:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSprints();
  }, [propSprints]);

  // Close dropdown when clicking outside
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

  // Reset highlighted index when search term changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchTerm]);

  // Auto-scroll to highlighted option
  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [highlightedIndex]);

  const selectedSprint = sprints.find(s => s.id === selectedSprintId);

  const filteredSprints = sprints.filter(sprint =>
    sprint.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate task counts for each sprint
  const getSprintTaskCount = (sprintId: string | null): number => {
    if (sprintId === null) {
      // Backlog: count tasks with sprintId = null or undefined
      return tasks.filter(task => !task.sprintId).length;
    }
    // Specific sprint: count tasks with matching sprintId
    return tasks.filter(task => task.sprintId === sprintId).length;
  };

  // Get total task count for "All Sprints"
  const totalTaskCount = tasks.length;

  const isAssign = mode === 'assign';

  // Check if "backlog" matches the search term
  const showBacklogOption = 'backlog'.includes(searchTerm.toLowerCase()) || searchTerm === '';

  // filter: All Sprints + optional Backlog + sprints
  // assign: optional Backlog + sprints (null = backlog)
  const allSprintsOffset = isAssign ? 0 : 1;
  const backlogOffset = showBacklogOption ? 1 : 0;
  const totalOptions = allSprintsOffset + backlogOffset + filteredSprints.length;

  const handleSelectSprint = (sprint: Sprint | null) => {
    onSprintChange(sprint);
    setIsOpen(false);
    setSearchTerm('');
    setHighlightedIndex(-1);
  };

  const handleSelectBacklog = () => {
    if (isAssign) {
      // Task assignment: clear sprintId
      handleSelectSprint(null);
      return;
    }
    onSprintChange({ id: 'backlog', name: 'Backlog', start_date: '', end_date: '' } as any);
    setIsOpen(false);
    setSearchTerm('');
    setHighlightedIndex(-1);
  };

  const isBacklogSelected = isAssign
    ? !selectedSprintId
    : selectedSprintId === 'backlog';

  const triggerLabel = isAssign
    ? selectedSprint
      ? selectedSprint.name
      : t('sprintSelector.backlog')
    : selectedSprintId === 'backlog'
      ? t('sprintSelector.backlog')
      : selectedSprint
        ? selectedSprint.name
        : t('sprintSelector.allSprints');

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < totalOptions - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : -1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex === -1) {
          return;
        }
        if (!isAssign && highlightedIndex === 0) {
          handleSelectSprint(null);
        } else if (
          (isAssign && highlightedIndex === 0 && showBacklogOption) ||
          (!isAssign && highlightedIndex === 1 && showBacklogOption)
        ) {
          handleSelectBacklog();
        } else {
          const sprintIndex = highlightedIndex - allSprintsOffset - backlogOffset;
          const picked = filteredSprints[sprintIndex];
          if (picked) handleSelectSprint(picked);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <KanbanChromeTooltip
        label={
          !isAssign && selectedSprintId !== null
            ? `${t('sprintSelector.selectSprint')} · ${t('sprintSelector.filterActive')}`
            : t('sprintSelector.selectSprint')
        }
      >
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setIsOpen(!isOpen);
          }}
          disabled={disabled}
          className={`flex items-center gap-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-200 rounded-md transition-colors border border-gray-300 dark:border-gray-600 relative ${
            disabled
              ? 'cursor-default opacity-100'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
          } ${
            isAssign
              ? 'w-full py-2 bg-white dark:bg-gray-700 shadow-sm justify-between'
              : 'py-1.5'
          } ${isOpen ? 'ring-2 ring-blue-500 border-blue-500' : ''}`}
          aria-label={t('sprintSelector.selectSprint')}
          aria-readonly={disabled || undefined}
          data-tour-id="sprint-selector"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className={`${isAssign ? 'truncate' : 'max-w-[150px] truncate'}`}>
              {triggerLabel}
            </span>
          </span>
          {/* Red dot indicator when a sprint filter is active (filter mode only) */}
          {!isAssign && selectedSprintId !== null && (
            <span
              className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 rounded-full border-2 border-white dark:border-gray-800"
              aria-hidden
            />
          )}
          {!disabled && (
            <ChevronDown className={`h-4 w-4 shrink-0 ${isOpen ? 'rotate-180' : ''} transition-transform`} />
          )}
        </button>
      </KanbanChromeTooltip>

      {isOpen && (
        <div className={`absolute left-0 top-full mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-hidden flex flex-col ${
          isAssign ? 'w-full' : 'w-72'
        }`}>
          {/* Search Input */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('sprintSelector.searchSprints')}
                className="w-full pl-9 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                >
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Sprint List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('sprintSelector.loadingSprints')}
              </div>
            ) : filteredSprints.length === 0 && !showBacklogOption ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {searchTerm ? t('sprintSelector.noSprintsFound') : t('sprintSelector.noSprintsAvailable')}
              </div>
            ) : (
              <>
                {/* All Sprints Option (filter mode only) */}
                {!isAssign && (
                  <button
                    ref={(el) => { optionRefs.current[0] = el; }}
                    onClick={() => handleSelectSprint(null)}
                    onMouseEnter={() => setHighlightedIndex(0)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                      highlightedIndex === 0 ? 'bg-gray-50 dark:bg-gray-700' : ''
                    } ${
                      !selectedSprintId && selectedSprintId !== 'backlog' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t('sprintSelector.allSprints')}</span>
                    <div className="flex items-center gap-2">
                      {totalTaskCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                          {totalTaskCount}
                        </span>
                      )}
                      {!selectedSprintId && selectedSprintId !== 'backlog' && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">{t('sprintSelector.noFilter')}</span>
                      )}
                    </div>
                  </button>
                )}

                {/* Backlog Option */}
                {showBacklogOption && (
                  <button
                    ref={(el) => { optionRefs.current[allSprintsOffset] = el; }}
                    onClick={handleSelectBacklog}
                    onMouseEnter={() => setHighlightedIndex(allSprintsOffset)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                      highlightedIndex === allSprintsOffset ? 'bg-gray-50 dark:bg-gray-700' : ''
                    } ${
                      isBacklogSelected ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t('sprintSelector.backlog')}</span>
                    <div className="flex items-center gap-2">
                      {getSprintTaskCount(null) > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                          {getSprintTaskCount(null)}
                        </span>
                      )}
                      {isBacklogSelected && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">{t('sprintSelector.unassigned')}</span>
                      )}
                    </div>
                  </button>
                )}

                <div className="border-t border-gray-200 dark:border-gray-700"></div>

                {/* Sprint Options */}
                {filteredSprints.map((sprint, index) => {
                  const optionIndex = allSprintsOffset + backlogOffset + index;
                  const taskCount = getSprintTaskCount(sprint.id);
                  return (
                    <button
                      key={sprint.id}
                      ref={(el) => { optionRefs.current[optionIndex] = el; }}
                      onClick={() => handleSelectSprint(sprint)}
                      onMouseEnter={() => setHighlightedIndex(optionIndex)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        highlightedIndex === optionIndex ? 'bg-gray-50 dark:bg-gray-700' : ''
                      } ${
                        selectedSprintId === sprint.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium truncate ${
                            selectedSprintId === sprint.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'
                          }`}>
                            {sprint.name}
                            {(sprint.is_active === 1 || sprint.is_active === true) && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                {t('sprintSelector.active')}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {new Date(sprint.start_date).toLocaleDateString()} - {new Date(sprint.end_date).toLocaleDateString()}
                          </div>
                        </div>
                        {taskCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 ml-2 flex-shrink-0">
                            {taskCount}
                          </span>
                        ) : null}
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
};

export default SprintSelector;

