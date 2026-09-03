import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronDown, Plus, Save, Search, Settings, X } from 'lucide-react';
import SprintInfoBadge from './sprints/SprintInfoBadge';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import SprintAssignmentCurrentPill from './ui/SprintAssignmentCurrentPill';
import SprintEditorFormFields, { type SprintEditorFormData } from './sprints/SprintEditorFormFields';
import { getDefaultNewSprintDates } from '../utils/dateUtils';
import { createSprint } from '../api';
import { toast } from '../utils/toast';
import {
  fetchSprintTransferOffer,
  notifySprintsUpdated,
  type SprintTransferOffer,
} from '../utils/sprintActiveWorkTransfer';
import SprintTransferConfirmDialog from './sprints/SprintTransferConfirmDialog';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import AnchoredDropdownPortal from './ui/AnchoredDropdownPortal';
import { formFieldClass, formInputEditableParts, formLockedSurfaceClass } from '../utils/formFieldClasses';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  goal?: string | null;
  description?: string | null;
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
  /** Header filter only: show create / Admin sprints actions */
  canCreateSprint?: boolean;
  onGoToSprints?: () => void;
  /** When false, a saved sprint id is not treated as "All Sprints" while the list is still loading. */
  sprintsReady?: boolean;
}

const SprintSelector: React.FC<SprintSelectorProps> = ({
  selectedSprintId,
  onSprintChange,
  tasks = [],
  sprints: propSprints,
  mode = 'filter',
  className = '',
  disabled = false,
  canCreateSprint = false,
  onGoToSprints,
  sprintsReady = true,
}) => {
  const { t } = useTranslation('tasks');
  const { t: ta } = useTranslation('admin');
  const [sprints, setSprints] = useState<Sprint[]>(propSprints || []);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [savingSprint, setSavingSprint] = useState(false);
  const [transferOffer, setTransferOffer] = useState<SprintTransferOffer | null>(null);
  const [createForm, setCreateForm] = useState<SprintEditorFormData>({
    name: '',
    start_date: '',
    end_date: '',
    is_active: false,
    description: '',
    goal: '',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const showCreateUi = canCreateSprint && mode === 'filter';

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setIsCreating(false);
    setTransferOffer(null);
    setSearchTerm('');
    setHighlightedIndex(-1);
  }, []);

  // Parent-controlled list (including []) — do not treat empty as "missing" or we fetch
  // while App still has [] and the trigger falls back to "All Sprints".
  useEffect(() => {
    if (propSprints !== undefined) {
      setSprints(propSprints);
      return;
    }
    
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

  // Close dropdown when clicking outside (skip while transfer confirm is open)
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (transferOffer) return;
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closeDropdown();
    };

    const timeoutId = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen, closeDropdown, transferOffer]);

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

  useEscapeDismiss(() => setIsCreating(false), {
    enabled: isOpen && isCreating && !transferOffer,
    disabled: savingSprint,
  });

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

  const openCreateForm = () => {
    const { start_date, end_date } = getDefaultNewSprintDates();
    setCreateForm({
      name: '',
      start_date,
      end_date,
      is_active: false,
      description: '',
    });
    setIsCreating(true);
    setHighlightedIndex(-1);
  };

  const handleGoToSprints = () => {
    closeDropdown();
    onGoToSprints?.();
  };

  const persistCreatedSprint = async (transferActiveWork: boolean, selectCreated: boolean) => {
    try {
      setSavingSprint(true);
      const created = await createSprint({
        ...createForm,
        transfer_active_work: transferActiveWork,
      });
      const moved = Number(created?.transferred_count) || 0;
      toast.success(ta('sprintSettings.sprintCreatedSuccessfully'), '');
      if (moved > 0) {
        toast.success(ta('sprintSettings.transferSuccess', { count: moved, toName: created.name }), '');
      }
      notifySprintsUpdated({
        selectSprintId: selectCreated && created?.id ? created.id : undefined,
        transferredFromSprintId: transferActiveWork ? transferOffer?.fromId : undefined,
        transferredToSprintId:
          transferActiveWork && transferOffer?.fromId && created?.id ? created.id : undefined,
      });
      setTransferOffer(null);
      if (created?.id) {
        setSprints((prev) => (prev.some((s) => s.id === created.id) ? prev : [...prev, created]));
        if (selectCreated) {
          handleSelectSprint(created);
        } else {
          closeDropdown();
        }
      } else {
        closeDropdown();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ta('sprintSettings.failedToSaveSprint'), '');
    } finally {
      setSavingSprint(false);
    }
  };

  const handleCreateSprint = async () => {
    if (savingSprint) return;
    if (!createForm.name.trim()) {
      toast.error(ta('sprintSettings.sprintNameRequired'), '');
      return;
    }
    if (!createForm.start_date) {
      toast.error(ta('sprintSettings.startDateRequired'), '');
      return;
    }
    if (!createForm.end_date) {
      toast.error(ta('sprintSettings.endDateRequired'), '');
      return;
    }
    if (new Date(createForm.end_date) < new Date(createForm.start_date)) {
      toast.error(ta('sprintSettings.endDateAfterStartDate'), '');
      return;
    }

    try {
      if (createForm.is_active) {
        const offer = await fetchSprintTransferOffer({ sprints });
        if (offer) {
          setTransferOffer(offer);
          return;
        }
      }
      await persistCreatedSprint(false, false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ta('sprintSettings.failedToSaveSprint'), '');
    }
  };

  const handleSelectSprint = (sprint: Sprint | null) => {
    onSprintChange(sprint);
    closeDropdown();
  };

  const handleSelectBacklog = () => {
    if (isAssign) {
      // Task assignment: clear sprintId
      handleSelectSprint(null);
      return;
    }
    onSprintChange({ id: 'backlog', name: 'Backlog', start_date: '', end_date: '' } as any);
    closeDropdown();
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
        : selectedSprintId
          ? sprintsReady
            ? t('sprintSelector.allSprints')
            : t('sprintSelector.loadingSprints')
          : t('sprintSelector.allSprints');

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (isCreating) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsCreating(false);
      }
      return;
    }

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
        closeDropdown();
        break;
    }
  };

  const panelWidth =
    isCreating && showCreateUi
      ? Math.min(576, typeof window !== 'undefined' ? window.innerWidth - 24 : 576)
      : isAssign
        ? 'trigger'
        : 288;
  const panelMaxHeight = isCreating && showCreateUi ? 640 : 384;

  const assignTriggerClass = disabled
    ? `w-full py-2 shadow-sm justify-between ${formLockedSurfaceClass}`
    : `w-full py-2 shadow-sm justify-between ${formInputEditableParts('panel')} text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50`;

  const filterTriggerClass = disabled
    ? `py-1.5 ${formLockedSurfaceClass}`
    :
        'py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700';

  return (
    <div className={`relative flex items-center gap-1 ${className}`}>
      <KanbanChromeTooltip
        label={
          !isAssign && selectedSprintId !== null
            ? `${t('sprintSelector.selectSprint')} · ${t('sprintSelector.filterActive')}`
            : t('sprintSelector.selectSprint')
        }
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (disabled) return;
            if (isOpen) {
              closeDropdown();
            } else {
              setIsOpen(true);
            }
          }}
          disabled={disabled}
          className={`flex items-center gap-2 px-3 text-sm font-medium rounded-md transition-colors relative ${
            isAssign ? assignTriggerClass : filterTriggerClass
          } ${isOpen && !disabled ? 'ring-2 ring-blue-500 border-blue-500' : ''}`}
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
      {selectedSprint && <SprintInfoBadge sprint={selectedSprint} />}

      <AnchoredDropdownPortal
        open={isOpen}
        triggerRef={triggerRef}
        panelRef={panelRef}
        width={panelWidth}
        minWidth={isAssign ? 360 : undefined}
        preferredMaxHeight={panelMaxHeight}
        className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
      >
        <div
          role={isCreating ? 'dialog' : undefined}
          aria-modal={isCreating ? true : undefined}
          aria-label={isCreating ? ta('sprintSettings.createNewSprint') : undefined}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {isCreating && showCreateUi ? (
            <div className="p-6 overflow-y-auto bg-blue-50 dark:bg-blue-900/20">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {ta('sprintSettings.createNewSprint')}
              </h4>
              <SprintEditorFormFields compact formData={createForm} onChange={setCreateForm} />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateSprint()}
                  disabled={savingSprint}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {ta('sprintSettings.create')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  disabled={savingSprint}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
                >
                  <X className="w-4 h-4" />
                  {ta('sprintSettings.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleGoToSprints}
                  disabled={savingSprint}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  {t('sprintSelector.goToSprints')}
                </button>
              </div>
            </div>
          ) : (
            <>
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
                className={formFieldClass(false, { widthClass: 'w-full pl-9 pr-8', py: '1.5' })}
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
                      {isAssign && isBacklogSelected && (
                        <SprintAssignmentCurrentPill />
                      )}
                      {!isAssign && isBacklogSelected && (
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
                          {sprint.goal && (
                            <div
                              className="text-xs text-slate-600 dark:text-gray-300 mt-0.5 break-words whitespace-normal"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {sprint.goal}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {taskCount > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                              {taskCount}
                            </span>
                          ) : null}
                          {isAssign && selectedSprintId === sprint.id && (
                            <SprintAssignmentCurrentPill />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
          {showCreateUi && (
            <div className="border-t border-gray-200 dark:border-gray-700 p-1.5 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={openCreateForm}
                className="w-full text-left px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t('sprintSelector.addSprint')}
              </button>
              <button
                type="button"
                onClick={handleGoToSprints}
                className="w-full text-left px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                {t('sprintSelector.goToSprints')}
              </button>
            </div>
          )}
            </>
          )}
        </div>
      </AnchoredDropdownPortal>
      <SprintTransferConfirmDialog
        offer={transferOffer}
        toName={createForm.name.trim() || createForm.name}
        busy={savingSprint}
        onMove={() => void persistCreatedSprint(true, true)}
        onKeep={() => void persistCreatedSprint(false, false)}
        onCancel={() => setTransferOffer(null)}
      />
    </div>
  );
};

export default SprintSelector;

