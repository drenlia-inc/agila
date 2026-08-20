import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Columns, Task, TeamMember, Board, SearchFilters, SearchFiltersChangeOptions } from '../types';
import { SavedFilterView, getSavedFilterView, updateSavedFilterView } from '../api';
import { TaskViewMode, ViewMode, loadUserPreferences, patchSearchFilterApplyState } from '../utils/userPreferences';
import { hasConfiguredSearchFilters, filterTasks } from '../utils/taskUtils';
import {
  EMPTY_SEARCH_FILTERS,
  searchFiltersToViewFilters,
  viewToSearchFilters,
} from '../utils/savedFilterViewUtils';
import { SYSTEM_MEMBER_ID } from '../constants/appConstants';
import { isAgentMemberId } from '../utils/agentMemberUi';
import { onHelpReveal, takeHelpReveal } from '../utils/helpGoThere';
import {
  applyActiveColumnFilters,
  taskMatchesSelectedSprint,
} from '../utils/columnFilters';

// Extend Window interface for justUpdatedFromWebSocket flag
declare global {
  interface Window {
    justUpdatedFromWebSocket?: boolean;
  }
}

interface UseTaskFiltersProps {
  columns: Columns;
  members: TeamMember[];
  boards: Board[];
  /** Used so header/text search can match sprint names. */
  sprints?: Array<{ id: string; name: string }>;
  /** Task ids with same-board links; omit on boards without relationship data. */
  linkedTaskIds?: Set<string>;
  userId?: string | null;
  updateCurrentUserPreference: <K extends keyof import('../utils/userPreferences').UserPreferences>(
    key: K,
    value: import('../utils/userPreferences').UserPreferences[K]
  ) => void;
}

export const useTaskFilters = ({
  columns,
  members,
  boards,
  sprints = [],
  linkedTaskIds,
  userId = null,
  updateCurrentUserPreference,
}: UseTaskFiltersProps) => {
  // Load user preferences from cookies
  const [userPrefs] = useState(() => loadUserPreferences());
  
  // Filter state
  const [selectedMembers, setSelectedMembers] = useState<string[]>(userPrefs.selectedMembers);
  const [includeAssignees, setIncludeAssignees] = useState(userPrefs.includeAssignees);
  const [includeWatchers, setIncludeWatchers] = useState(userPrefs.includeWatchers);
  const [includeCollaborators, setIncludeCollaborators] = useState(userPrefs.includeCollaborators);
  const [includeRequesters, setIncludeRequesters] = useState(userPrefs.includeRequesters);
  const [includeSystem, setIncludeSystem] = useState(userPrefs.includeSystem || false);
  const [showAgentTasks, setShowAgentTasks] = useState(userPrefs.showAgentTasks !== false);
  
  // Computed: Check if we're in "All Roles" mode (all main role checkboxes checked)
  const isAllModeActive = useMemo(() => {
    const allMainCheckboxesChecked = includeAssignees && includeWatchers && 
      includeCollaborators && includeRequesters;
    
    return allMainCheckboxesChecked;
  }, [includeAssignees, includeWatchers, includeCollaborators, includeRequesters]);
  
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>(userPrefs.taskViewMode);
  const [viewMode, setViewMode] = useState<ViewMode>(userPrefs.viewMode);
  const viewModeRef = useRef<ViewMode>(userPrefs.viewMode);
  
  const [isSearchActive, setIsSearchActive] = useState(userPrefs.isSearchActive);
  const [isAdvancedSearchExpanded, setIsAdvancedSearchExpanded] = useState(userPrefs.isAdvancedSearchExpanded);
  const [searchFilters, setSearchFilters] = useState(userPrefs.searchFilters);
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(userPrefs.selectedSprintId);
  const [currentFilterView, setCurrentFilterView] = useState<SavedFilterView | null>(null);
  const [sharedFilterViews, setSharedFilterViews] = useState<SavedFilterView[]>([]);
  const [filteredColumns, setFilteredColumns] = useState<Columns>({});
  
  // CRITICAL: Use a ref to always access the latest columns value
  // This prevents stale closure issues when filtering is delayed
  const columnsRef = useRef<Columns>(columns);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  // Update viewModeRef when viewMode changes
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const getFilterState = useCallback(
    () => ({
      selectedSprintId,
      searchFilters,
      selectedMembers,
      includeAssignees,
      includeWatchers,
      includeCollaborators,
      includeRequesters,
      showAgentTasks,
      linkedTaskIds,
    }),
    [
      selectedSprintId,
      searchFilters,
      selectedMembers,
      includeAssignees,
      includeWatchers,
      includeCollaborators,
      includeRequesters,
      showAgentTasks,
      linkedTaskIds,
    ]
  );

  /** Synchronous filter apply — used when seeding columns on board switch to avoid unfiltered flash. */
  const applyFiltersToColumns = useCallback(
    (columnsToFilter: Columns): Columns =>
      applyActiveColumnFilters(columnsToFilter, getFilterState(), members, boards, sprints),
    [getFilterState, members, boards, sprints]
  );

  // Enhanced filtering effect with watchers/collaborators/requesters support
  useEffect(() => {
    // Delay filtering only when WebSocket/optimistic batch paths set justUpdatedFromWebSocket.
    // Do NOT infer batches from task-count deltas — board switches (e.g. 73→3 tasks) look the
    // same and wrongly blanked the board for ~400ms.
    let timeoutId: NodeJS.Timeout | null = null;

    const performFiltering = (columnsToFilter: Columns = columns) => {
      if (!columnsToFilter || Object.keys(columnsToFilter).length === 0) {
        return;
      }
      setFilteredColumns(applyFiltersToColumns(columnsToFilter));
    };

    if (window.justUpdatedFromWebSocket) {
      // Delay filtering to let batch update complete
      timeoutId = setTimeout(() => {
        const columnsToUse = columnsRef.current;
        if (!columnsToUse || Object.keys(columnsToUse).length === 0) {
          return;
        }
        performFiltering(columnsToUse);
      }, 400); // 400ms delay - enough for batch update to complete and React state to settle

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
      };
    } else {
      performFiltering();
    }
  }, [
    columns,
    searchFilters.text,
    searchFilters.dateFrom,
    searchFilters.dateTo,
    searchFilters.dueDateFrom,
    searchFilters.dueDateTo,
    searchFilters.selectedPriorities,
    searchFilters.selectedTags,
    searchFilters.selectedProjectIds,
    searchFilters.taskId,
    searchFilters.linkedTasksOnly,
    searchFilters.overdueOnly,
    searchFilters.blockedOnly,
    searchFilters.selectedSprintIds,
    searchFilters.stalledDays,
    selectedMembers,
    includeAssignees,
    includeWatchers,
    includeCollaborators,
    includeRequesters,
    selectedSprintId,
    members,
    boards,
    showAgentTasks,
    applyFiltersToColumns,
    linkedTaskIds,
  ]);

  // Helper function to quickly check if a task should be included (synchronous checks only for WebSocket updates)
  const shouldIncludeTask = useCallback((task: Task): boolean => {
    if (!taskMatchesSelectedSprint(task, selectedSprintId)) {
      return false;
    }
    // If selectedSprintId is null, show all tasks (no sprint filtering)

    // Hide Agent-assigned tasks when the Search & Filter Agent toggle is off
    if (!showAgentTasks && isAgentMemberId(task.memberId)) {
      return false;
    }

    if (searchFilters.linkedTasksOnly && linkedTaskIds !== undefined && !linkedTaskIds.has(task.id)) {
      return false;
    }

    // Search panel visibility does not gate search criteria
    const searchConfigured = hasConfiguredSearchFilters(searchFilters);
    const isFiltering = searchConfigured || selectedMembers.length > 0 || includeAssignees || includeWatchers || includeCollaborators || includeRequesters;
    if (!isFiltering) return true;

    // Apply search filters (text, dates, priorities, tags, etc.)
    if (searchConfigured) {
      const effectiveFilters = {
        ...searchFilters,
        selectedMembers: selectedMembers.length > 0 ? selectedMembers : searchFilters.selectedMembers
      };
      
      // Create filters without member filtering if we have checkboxes enabled
      const searchOnlyFilters = (includeAssignees || includeWatchers || includeCollaborators || includeRequesters) ? {
        ...effectiveFilters,
        selectedMembers: [] // Skip member filtering in search, we'll handle it separately
      } : effectiveFilters;
      
      // Use the filterTasks utility with a single task
      const filtered = filterTasks([task], searchOnlyFilters, true, members, boards, sprints, columnsRef.current?.[task.columnId]);
      if (filtered.length === 0) return false; // Task didn't pass search filters
    }

    // Apply member filtering (synchronous checks only: assignees and requesters)
    // Note: Watchers/collaborators are async and will be handled by the useEffect
    if (selectedMembers.length > 0) {
      let includeTask = false;
      
      // Check assignees
      if (includeAssignees && selectedMembers.includes(task.memberId || '')) {
        includeTask = true;
      }
      
      // Check requesters
      if (!includeTask && includeRequesters && task.requesterId && selectedMembers.includes(task.requesterId)) {
        includeTask = true;
      }
      
      // Check watchers (synchronous using cached data)
      if (!includeTask && includeWatchers) {
        const watchers = task.watchers || [];
        if (watchers.some((watcher: any) => selectedMembers.includes(watcher.id))) {
          includeTask = true;
        }
      }
      
      // Check collaborators (synchronous using cached data)
      if (!includeTask && includeCollaborators) {
        const collaborators = task.collaborators || [];
        if (collaborators.some((collaborator: any) => selectedMembers.includes(collaborator.id))) {
          includeTask = true;
        }
      }
      
      return includeTask;
    }

    return true;
  }, [searchFilters, selectedMembers, includeAssignees, includeWatchers, includeCollaborators, includeRequesters, members, boards, sprints, selectedSprintId, showAgentTasks, linkedTaskIds]);

  // Keep shouldIncludeTaskRef in sync for WebSocket handlers

  // Store shouldIncludeTask in a ref to avoid stale closures in WebSocket handlers
  const shouldIncludeTaskRef = useRef(shouldIncludeTask);
  useEffect(() => {
    shouldIncludeTaskRef.current = shouldIncludeTask;
  }, [shouldIncludeTask]);

  // Handlers
  const handleToggleSearch = () => {
    const newValue = !isSearchActive;
    setIsSearchActive(newValue);
    updateCurrentUserPreference('isSearchActive', newValue);
  };

  useEffect(() => {
    const openSearch = () => {
      if (!takeHelpReveal('searchFilters')) return;
      setIsSearchActive(true);
      updateCurrentUserPreference('isSearchActive', true);
    };
    openSearch();
    return onHelpReveal(openSearch);
  }, [updateCurrentUserPreference]);

  const handleSearchFiltersChange = (
    newFilters: SearchFilters,
    _options?: SearchFiltersChangeOptions,
  ) => {
    setSearchFilters(newFilters);
    updateCurrentUserPreference('searchFilters', newFilters);
    
    // Note: Sprint selection is now independent of date filters - it will not be reset when filters change
    // This allows users to combine sprint filtering with other search filters
    
    // Keep the applied saved filter selected while the user tweaks criteria so they can update it in place.
  };

  const handleSprintChange = (sprint: { id: string; name: string; start_date: string; end_date: string } | null) => {
    const newSprintId = sprint?.id || null;
    setSelectedSprintId(newSprintId);
    updateCurrentUserPreference('selectedSprintId', newSprintId);
    
    // Clear current filter view when sprint changes
    if (currentFilterView) {
      setCurrentFilterView(null);
      updateCurrentUserPreference('currentFilterViewId', null);
    }
  };

  const applySavedFilterView = useCallback(
    async (view: SavedFilterView): Promise<SavedFilterView> => {
      let viewToApply = view;
      try {
        viewToApply = await getSavedFilterView(view.id);
      } catch (error) {
        console.error('Failed to refresh saved filter view before apply:', error);
      }
      const newFilters = viewToSearchFilters(viewToApply, boards);
      setCurrentFilterView(viewToApply);
      setSearchFilters(newFilters);
      await patchSearchFilterApplyState(newFilters, viewToApply.id, userId);
      return viewToApply;
    },
    [boards, userId],
  );

  const clearAllSearchFilters = useCallback(async () => {
    const emptyFilters = { ...EMPTY_SEARCH_FILTERS };
    setCurrentFilterView(null);
    setSearchFilters(emptyFilters);
    await patchSearchFilterApplyState(emptyFilters, null, userId);
  }, [userId]);

  const loadSavedFilterView = useCallback(
    async (viewId: number) => {
      try {
        const view = await getSavedFilterView(viewId);
        await applySavedFilterView(view);
      } catch (error) {
        updateCurrentUserPreference('currentFilterViewId', null);
      }
    },
    [applySavedFilterView, updateCurrentUserPreference],
  );

  const handleFilterViewChange = (view: SavedFilterView | null) => {
    setCurrentFilterView(view);
    // Save the current filter view ID to user preferences
    updateCurrentUserPreference('currentFilterViewId', view?.id || null);
  };

  /** Persist current filter fields onto an existing saved view (same name). */
  const updateAppliedSavedFilterView = useCallback(
    async (viewId: number, filtersToSave: SearchFilters): Promise<SavedFilterView> => {
      const apiFilters = searchFiltersToViewFilters(filtersToSave);
      const updatedView = await updateSavedFilterView(viewId, { filters: apiFilters });
      setCurrentFilterView(updatedView);
      await patchSearchFilterApplyState(filtersToSave, viewId, userId);
      return updatedView;
    },
    [userId],
  );

  /**
   * Clear search + member selections so a newly created task can appear (does not change sprint selection).
   * Resets role chips to the same defaults as new users (assignees on) so TeamMembers does not show
   * "no filter options selected".
   */
  const clearVisibilityObstructingFilters = useCallback(() => {
    const emptyFilters = { ...EMPTY_SEARCH_FILTERS };
    setSearchFilters(emptyFilters);
    setIsSearchActive(false);
    setSelectedMembers([]);
    setIncludeAssignees(true);
    setIncludeWatchers(false);
    setIncludeCollaborators(false);
    setIncludeRequesters(false);
    setCurrentFilterView(null);
    // Cookie + DB: caller must await saveUserPreferences(mergeClearedKanbanVisibilityFilters(...))
    // so one atomic write wins over smart-merge-on-load (many racing updateUserPreference PUTs used to lose).
  }, []);

  const handleMemberToggle = (memberId: string) => {
    const newSelectedMembers = selectedMembers.includes(memberId) 
      ? selectedMembers.filter(id => id !== memberId)
      : [...selectedMembers, memberId];
    
    setSelectedMembers(newSelectedMembers);
    updateCurrentUserPreference('selectedMembers', newSelectedMembers);
  };

  const handleClearMemberSelections = () => {
    // Clear to empty array = show all members
    setSelectedMembers([]);
    updateCurrentUserPreference('selectedMembers', []);
  };

  const handleSelectAllMembers = () => {
    if (isAllModeActive) {
      // Currently in "All Roles" mode, switch to "Assignees Only" mode
      setIncludeAssignees(true);
      setIncludeWatchers(false);
      setIncludeCollaborators(false);
      setIncludeRequesters(false);
      setIncludeSystem(false);
      
      updateCurrentUserPreference('includeAssignees', true);
      updateCurrentUserPreference('includeWatchers', false);
      updateCurrentUserPreference('includeCollaborators', false);
      updateCurrentUserPreference('includeRequesters', false);
      updateCurrentUserPreference('includeSystem', false);
    } else {
      // Not in "All Roles" mode, switch to "All Roles" mode
      setIncludeAssignees(true);
      setIncludeWatchers(true);
      setIncludeCollaborators(true);
      setIncludeRequesters(true);
      // Note: System checkbox is left unchanged (admin-only)
      
      updateCurrentUserPreference('includeAssignees', true);
      updateCurrentUserPreference('includeWatchers', true);
      updateCurrentUserPreference('includeCollaborators', true);
      updateCurrentUserPreference('includeRequesters', true);
    }
  };

  const handleToggleAssignees = (include: boolean) => {
    setIncludeAssignees(include);
    updateCurrentUserPreference('includeAssignees', include);
  };

  const handleToggleWatchers = (include: boolean) => {
    setIncludeWatchers(include);
    updateCurrentUserPreference('includeWatchers', include);
  };

  const handleToggleCollaborators = (include: boolean) => {
    setIncludeCollaborators(include);
    updateCurrentUserPreference('includeCollaborators', include);
  };

  const handleToggleRequesters = (include: boolean) => {
    setIncludeRequesters(include);
    updateCurrentUserPreference('includeRequesters', include);
  };

  const handleToggleSystem = async (include: boolean) => {
    setIncludeSystem(include);
    updateCurrentUserPreference('includeSystem', include);
    
    // Handle SYSTEM user selection logic without reloading members
    if (include) {
      // Checkbox ON: Auto-select SYSTEM user if not already selected
      setSelectedMembers(prev => {
        if (!prev.includes(SYSTEM_MEMBER_ID)) {
          const newSelection = [...prev, SYSTEM_MEMBER_ID];
          updateCurrentUserPreference('selectedMembers', newSelection);
          return newSelection;
        }
        return prev;
      });
    } else {
      // Checkbox OFF: Auto-deselect SYSTEM user
      setSelectedMembers(prev => {
        const newSelection = prev.filter(id => id !== SYSTEM_MEMBER_ID);
        updateCurrentUserPreference('selectedMembers', newSelection);
        return newSelection;
      });
    }
  };

  const handleToggleShowAgentTasks = (show: boolean) => {
    setShowAgentTasks(show);
    updateCurrentUserPreference('showAgentTasks', show);
    // Keep Team Members strip in sync: hide Agent chip and drop any Agent selection
    if (!show) {
      setSelectedMembers((prev) => {
        if (!prev.some((id) => isAgentMemberId(id))) return prev;
        const newSelection = prev.filter((id) => !isAgentMemberId(id));
        updateCurrentUserPreference('selectedMembers', newSelection);
        return newSelection;
      });
    }
  };

  return {
    // State
    selectedMembers,
    includeAssignees,
    includeWatchers,
    includeCollaborators,
    includeRequesters,
    includeSystem,
    showAgentTasks,
    isAllModeActive,
    taskViewMode,
    viewMode,
    viewModeRef,
    isSearchActive,
    isAdvancedSearchExpanded,
    searchFilters,
    selectedSprintId,
    currentFilterView,
    sharedFilterViews,
    filteredColumns,
    shouldIncludeTask,
    shouldIncludeTaskRef,
    
    // Setters (for direct state updates when needed)
    setSelectedMembers,
    setIncludeAssignees,
    setIncludeWatchers,
    setIncludeCollaborators,
    setIncludeRequesters,
    setIncludeSystem,
    setShowAgentTasks,
    setTaskViewMode,
    setViewMode,
    setIsSearchActive,
    setIsAdvancedSearchExpanded,
    setSearchFilters,
    setSelectedSprintId,
    setCurrentFilterView,
    setSharedFilterViews,
    setFilteredColumns,
    applyFiltersToColumns,
    
    // Handlers
    handleToggleSearch,
    handleSearchFiltersChange,
    handleSprintChange,
    loadSavedFilterView,
    applySavedFilterView,
    updateAppliedSavedFilterView,
    clearAllSearchFilters,
    handleFilterViewChange,
    handleMemberToggle,
    handleClearMemberSelections,
    handleSelectAllMembers,
    handleToggleAssignees,
    handleToggleWatchers,
    handleToggleCollaborators,
    handleToggleRequesters,
    handleToggleSystem,
    handleToggleShowAgentTasks,
    clearVisibilityObstructingFilters,
  };
};

