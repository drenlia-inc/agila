import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown, Check, ChevronUp, Save, Settings, RefreshCw, GitBranch, AlertCircle, Ban, Search } from 'lucide-react';
import { Priority, PriorityOption, Tag, Columns, SearchFilters, Board, SearchFiltersChangeOptions } from '../types';
import { getSavedFilterViews, getSharedFilterViews, createSavedFilterView, updateSavedFilterView, SavedFilterView } from '../api';
import { loadUserPreferences, updateUserPreference } from '../utils/userPreferences';
import ManageFiltersModal from './ManageFiltersModal';
import ColumnFilterDropdown from './ColumnFilterDropdown';
import SprintMultiFilterSelector from './SprintMultiFilterSelector';
import { getAgentAvatarSrc } from '../utils/agentMemberUi';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { FILTER_NAME_MAX_LENGTH } from '../constants/appConstants';
import { getBoardProjectKey } from '../utils/taskUtils';
import {
  EMPTY_SEARCH_FILTERS,
  searchFiltersMatchSavedView,
  searchFiltersToViewFilters,
} from '../utils/savedFilterViewUtils';

/** Save/apply filter dropdown — keep list scrollable before viewport edge. */
const FILTER_DROPDOWN_VIEWPORT_MARGIN_PX = 12;
const FILTER_DROPDOWN_MIN_HEIGHT_PX = 160;
const FILTER_DROPDOWN_MAX_HEIGHT_PX = 448; // 28rem
/** start-to / due-to date input width; Columns matches this slot. */
const FILTER_DATE_INPUT_WIDTH_CLASS = 'w-[140px]';
/** start-from (140) + start-to label gutter (60); with gap-2 before Columns, aligns at 208px. */
const FILTER_SEARCH_WIDTH_CLASS = 'w-[200px]';
/** gap-2 between filter row flex items (must match Tailwind gap-2). */
const FILTER_ROW_GAP_PX = 8;
/** Visible strip of each stacked filter pill when space is limited (tags + priorities). */
const FILTER_PILL_OVERLAP_PEEK_PX = 8;
/** gap-3 between pill stack and clear-all chip. */
const FILTER_PILL_CLEAR_ALL_GAP_PX = 12;
/** Shared width for Project input and tag/priority dropdown triggers. */
const FILTER_PROJECT_TAG_PRIORITY_WIDTH_CLASS = 'w-[85px]';

interface FilterDropdownWithClearProps {
  showClear: boolean;
  onClear: () => void;
  clearTitle: string;
  buttonClassName: string;
  buttonTitle?: string;
  onToggle: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
}

function FilterDropdownWithClear({
  showClear,
  onClear,
  clearTitle,
  buttonClassName,
  buttonTitle,
  onToggle,
  onKeyDown,
  children,
}: FilterDropdownWithClearProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={buttonClassName}
        title={buttonTitle}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 flex-1 truncate text-left">{children}</span>
        {!showClear && (
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 shrink-0"
          />
        )}
      </button>
      {showClear && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClear();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors z-10"
          title={clearTitle}
          aria-label={clearTitle}
        >
          <X size={10} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
        </button>
      )}
    </div>
  );
}

interface SprintOption {
  id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
}

interface SearchInterfaceProps {
  filters: SearchFilters;
  availablePriorities: PriorityOption[];
  availableTags?: Tag[];
  onFiltersChange: (filters: SearchFilters, options?: SearchFiltersChangeOptions) => void;
  /** Apply a saved view atomically (filters + view id + persistence). */
  onApplySavedFilter?: (view: SavedFilterView) => Promise<SavedFilterView>;
  /** Overwrite an existing saved view with the current filter fields. */
  onUpdateSavedFilter?: (viewId: number, filters: SearchFilters) => Promise<SavedFilterView>;
  /** Clear all search filters atomically (global X / None). */
  onClearAllSearchFilters?: () => Promise<void>;
  siteSettings?: { [key: string]: string };
  currentFilterView?: SavedFilterView | null;
  sharedFilterViews?: SavedFilterView[];
  onFilterViewChange?: (view: SavedFilterView | null) => void;
  // Column filtering props
  columns?: Columns;
  visibleColumns?: string[];
  onColumnsChange?: (visibleColumns: string[]) => void;
  selectedBoard?: string | null;
  /** Show tasks assigned to AI Agent (default true). Does not change member chip selection. */
  showAgentTasks?: boolean;
  onToggleShowAgentTasks?: (show: boolean) => void;
  /** When false, linked-tasks filter toggle is disabled (no relationships on this board). */
  hasBoardRelationships?: boolean;
  /** Sprints for multi-select sprint filter. */
  availableSprints?: SprintOption[];
  /** All board tasks for sprint filter counts (matches header sprint selector). */
  sprintFilterTasks?: Array<{ id: string; sprintId?: string | null }>;
  /** Boards for multi-select project filter (project id + name). */
  boards?: Pick<Board, 'id' | 'title' | 'project'>[];
  /** Reset column visibility to default (non-archived columns visible). */
  onResetColumnVisibility?: () => void;
}

export default function SearchInterface({
  filters,
  availablePriorities,
  availableTags = [],
  onFiltersChange,
  onApplySavedFilter,
  onUpdateSavedFilter,
  onClearAllSearchFilters,
  siteSettings,
  currentFilterView,
  sharedFilterViews,
  onFilterViewChange,
  columns,
  visibleColumns,
  onColumnsChange,
  selectedBoard,
  showAgentTasks = true,
  onToggleShowAgentTasks,
  hasBoardRelationships = false,
  availableSprints = [],
  sprintFilterTasks = [],
  boards = [],
  onResetColumnVisibility,
}: SearchInterfaceProps) {
  const { t, i18n } = useTranslation('common');
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
  const [showTagsDropdown, setShowTagsDropdown] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const prefs = loadUserPreferences();
    return !prefs.isAdvancedSearchExpanded;
  });
  const [savedFilterViews, setSavedFilterViews] = useState<SavedFilterView[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [savedFilterSearchTerm, setSavedFilterSearchTerm] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');
  const [isLoadingFilters, setIsLoadingFilters] = useState(false);
  const [isSavingFilter, setIsSavingFilter] = useState(false);

  const isOwnCurrentFilter = Boolean(
    currentFilterView && savedFilterViews.some((view) => view.id === currentFilterView.id),
  );

  const filtersDifferFromCurrentView = Boolean(
    currentFilterView &&
      !searchFiltersMatchSavedView(filters, currentFilterView, boards),
  );

  const canUpdateCurrentFilter = isOwnCurrentFilter && filtersDifferFromCurrentView;

  const isSaveDialogUpdateMode = Boolean(
    isOwnCurrentFilter &&
      currentFilterView &&
      newFilterName.trim() === currentFilterView.filterName.trim(),
  );

  const canSaveAsNewFilter = Boolean(
    newFilterName.trim() &&
      (!currentFilterView ||
        newFilterName.trim() !== currentFilterView.filterName.trim() ||
        !isOwnCurrentFilter),
  );

  const savedFilterSearchQuery = savedFilterSearchTerm.trim().toLowerCase();

  const filterMatchesSavedFilterSearch = useCallback(
    (view: SavedFilterView) => {
      if (!savedFilterSearchQuery) return true;
      if (view.filterName.toLowerCase().includes(savedFilterSearchQuery)) return true;
      if (view.creatorName?.toLowerCase().includes(savedFilterSearchQuery)) return true;
      return false;
    },
    [savedFilterSearchQuery],
  );

  const filteredSavedFilterViews = useMemo(
    () => savedFilterViews.filter(filterMatchesSavedFilterSearch),
    [savedFilterViews, filterMatchesSavedFilterSearch],
  );

  const filteredSharedFilterViews = useMemo(
    () => (sharedFilterViews ?? []).filter(filterMatchesSavedFilterSearch),
    [sharedFilterViews, filterMatchesSavedFilterSearch],
  );

  const totalSavedFilterViews =
    savedFilterViews.length + (sharedFilterViews?.length ?? 0);
  const hasSavedFilterSearchResults =
    filteredSavedFilterViews.length > 0 || filteredSharedFilterViews.length > 0;
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const tagsDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  /** Row-1 content column — used to align trailing controls with Save / apply dropdown. */
  const saveApplyAlignRef = useRef<HTMLDivElement>(null);
  const projectFieldRef = useRef<HTMLDivElement>(null);
  const datesPairRef = useRef<HTMLDivElement>(null);
  const tagPillsContainerRef = useRef<HTMLDivElement>(null);
  const priorityPillsContainerRef = useRef<HTMLDivElement>(null);
  const [saveApplyRightInset, setSaveApplyRightInset] = useState(72);
  /** Width of gutter between date pair and tag/priority; centers overdue/blocked toggles. */
  const [flowToggleSlotWidth, setFlowToggleSlotWidth] = useState(0);
  const [tagPillsUseOverlap, setTagPillsUseOverlap] = useState(false);
  const [tagPillWidths, setTagPillWidths] = useState<number[]>([]);
  const [hoveredTagIndex, setHoveredTagIndex] = useState<number | null>(null);
  const [priorityPillsUseOverlap, setPriorityPillsUseOverlap] = useState(false);
  const [priorityPillWidths, setPriorityPillWidths] = useState<number[]>([]);
  const [hoveredPriorityIndex, setHoveredPriorityIndex] = useState<number | null>(null);
  const [filterDropdownMaxHeight, setFilterDropdownMaxHeight] = useState<number | null>(null);

  useEscapeDismiss(
    () => {
      if (isSavingFilter) return;
      setShowSaveDialog(false);
      setNewFilterName('');
    },
    { enabled: showSaveDialog }
  );

  // Helper function to determine text color based on background color
  const getTextColor = (backgroundColor: string): string => {
    if (!backgroundColor) return '#ffffff';
    
    // Handle white and very light colors
    const normalizedColor = backgroundColor.toLowerCase();
    if (normalizedColor === '#ffffff' || normalizedColor === '#fff' || normalizedColor === 'white') {
      return '#374151'; // gray-700 for good contrast on white
    }
    
    // For hex colors, calculate luminance to determine if we need light or dark text
    if (backgroundColor.startsWith('#')) {
      const hex = backgroundColor.replace('#', '');
      if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        
        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Use dark text for light backgrounds, white text for dark backgrounds
        return luminance > 0.6 ? '#374151' : '#ffffff';
      }
    }
    
    // Default to white text
    return '#ffffff';
  };

  const updateFilter = (key: keyof SearchFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const handleToggleCollapse = () => {
    const newIsCollapsed = !isCollapsed;
    setIsCollapsed(newIsCollapsed);
    // Save the expanded state to user preferences
    updateUserPreference('isAdvancedSearchExpanded', !newIsCollapsed);
  };

  const togglePriority = (priority: Priority) => {
    const newSelectedPriorities = filters.selectedPriorities.includes(priority)
      ? filters.selectedPriorities.filter(p => p !== priority)
      : [...filters.selectedPriorities, priority];
    updateFilter('selectedPriorities', newSelectedPriorities);
  };

  const toggleTag = (tagId: string) => {
    const newSelectedTags = filters.selectedTags.includes(tagId)
      ? filters.selectedTags.filter(id => id !== tagId)
      : [...filters.selectedTags, tagId];
    updateFilter('selectedTags', newSelectedTags);
  };

  const toggleProjectFilter = (projectKey: string) => {
    const next = filters.selectedProjectIds.includes(projectKey)
      ? filters.selectedProjectIds.filter((id) => id !== projectKey)
      : [...filters.selectedProjectIds, projectKey];
    updateFilter('selectedProjectIds', next);
  };

  const projectBoardOptions = useMemo(
    () =>
      [...boards]
        .map((board) => ({ board, key: getBoardProjectKey(board) }))
        .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    [boards],
  );

  const handleStalledDaysChange = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      updateFilter('stalledDays', null);
      return;
    }
    const n = parseInt(trimmed, 10);
    updateFilter('stalledDays', Number.isFinite(n) && n > 0 ? n : null);
  };

  const flowToggleClass = (active: boolean) =>
    `rounded p-1 transition-colors shrink-0 ${
      active
        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
        : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200'
    }`;

  /**
   * Stacked pill under pointer. Foreground pill stays locked while the cursor
   * remains on it (so × is clickable); otherwise scrub via peek strips only.
   */
  const getStackedPillHoverIndex = (
    e: MouseEvent<HTMLDivElement>,
    pillSelector: string,
    currentForeground: number | null,
  ): number | null => {
    const pills = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(pillSelector));
    if (pills.length <= 1) return null;
    const { clientX, clientY } = e;

    if (currentForeground !== null && currentForeground < pills.length) {
      const fg = pills[currentForeground].getBoundingClientRect();
      if (clientX >= fg.left && clientX <= fg.right && clientY >= fg.top && clientY <= fg.bottom) {
        return currentForeground;
      }
    }

    let hitIndex = -1;
    pills.forEach((pill, i) => {
      const r = pill.getBoundingClientRect();
      if (clientY < r.top || clientY > r.bottom) return;
      const isLast = i === pills.length - 1;
      if (isLast) {
        if (clientX >= r.left && clientX <= r.right) hitIndex = i;
      } else {
        const peekRight = r.left + Math.min(FILTER_PILL_OVERLAP_PEEK_PX, r.width);
        if (clientX >= r.left && clientX <= peekRight) hitIndex = i;
      }
    });
    return hitIndex >= 0 ? hitIndex : null;
  };

  const handleTagStackMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!tagPillsUseOverlap) return;
    const index = getStackedPillHoverIndex(e, '[data-tag-pill]', hoveredTagIndex);
    if (index !== null) {
      setHoveredTagIndex((prev) => (prev === index ? prev : index));
    }
  };

  const handlePriorityStackMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!priorityPillsUseOverlap) return;
    const index = getStackedPillHoverIndex(e, '[data-priority-pill]', hoveredPriorityIndex);
    if (index !== null) {
      setHoveredPriorityIndex((prev) => (prev === index ? prev : index));
    }
  };

  const measureFilterPillStack = (
    stackEl: HTMLDivElement,
    pillSelector: string,
    clearAllSelector: string,
  ): { useOverlap: boolean; widths: number[] } => {
    const pills = Array.from(stackEl.querySelectorAll<HTMLElement>(pillSelector));
    if (pills.length <= 1) {
      return { useOverlap: false, widths: [] };
    }
    // Measure at natural pill widths — inline stack width would clip and under-report.
    const prevWidth = stackEl.style.width;
    stackEl.style.width = '';
    const widths = pills.map((pill) => pill.getBoundingClientRect().width);
    stackEl.style.width = prevWidth;

    const totalWithGap = widths.reduce(
      (sum, width, index) => sum + width + (index > 0 ? FILTER_ROW_GAP_PX : 0),
      0,
    );
    const listGroup = stackEl.parentElement;
    const clearAll = listGroup?.querySelector<HTMLElement>(clearAllSelector);
    const clearAllExtra = clearAll ? FILTER_PILL_CLEAR_ALL_GAP_PX + clearAll.offsetWidth : 0;
    const filterArea = listGroup?.parentElement;
    let listGroupBudget = stackEl.clientWidth + clearAllExtra;
    if (filterArea && listGroup) {
      const dropdownEl = filterArea.firstElementChild as HTMLElement | null;
      const dropdownWidth = dropdownEl?.offsetWidth ?? 0;
      listGroupBudget = Math.max(0, filterArea.clientWidth - dropdownWidth - FILTER_ROW_GAP_PX);
    }
    return { useOverlap: totalWithGap + clearAllExtra > listGroupBudget, widths };
  };

  /** Visual width of overlapped pills; wide foreground pills must not be clipped. */
  const stackedPillRowWidth = (pillWidths: number[]) => {
    if (pillWidths.length === 0) return undefined;
    if (pillWidths.length === 1) return pillWidths[0];
    return pillWidths.reduce(
      (maxWidth, width, index) =>
        Math.max(maxWidth, index * FILTER_PILL_OVERLAP_PEEK_PX + width),
      0,
    );
  };

  /** Right inset so trailing dropdowns line up with the Save / apply dropdown (not panel edge). */
  useLayoutEffect(() => {
    const measure = () => {
      const col = saveApplyAlignRef.current;
      const dropdown = filterDropdownRef.current;
      if (!col || !dropdown) return;
      const colRect = col.getBoundingClientRect();
      const dropRect = dropdown.getBoundingClientRect();
      setSaveApplyRightInset(Math.max(0, Math.round(colRect.right - dropRect.right)));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (saveApplyAlignRef.current && ro) ro.observe(saveApplyAlignRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    isCollapsed,
    currentFilterView?.filterName,
    filters.text,
    filters.selectedProjectIds,
    filters.taskId,
    showAgentTasks,
    siteSettings?.AI_ENABLED,
  ]);

  /** Size gutter so tag/priority align with Project input; toggles stay centered in gutter. */
  useLayoutEffect(() => {
    if (isCollapsed) return;
    const measure = () => {
      const project = projectFieldRef.current;
      const datesPair = datesPairRef.current;
      if (!project || !datesPair) return;
      const slotWidth = Math.round(
        project.getBoundingClientRect().left -
          datesPair.getBoundingClientRect().right -
          FILTER_ROW_GAP_PX * 2
      );
      setFlowToggleSlotWidth(Math.max(0, slotWidth));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (saveApplyAlignRef.current && ro) ro.observe(saveApplyAlignRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    isCollapsed,
    columns,
    visibleColumns,
    selectedBoard,
    currentFilterView?.filterName,
    filters.text,
    filters.selectedProjectIds,
    filters.taskId,
    showAgentTasks,
    siteSettings?.AI_ENABLED,
    i18n.language,
  ]);

  const trailingFilterAlignStyle = { marginRight: saveApplyRightInset };
  const flowToggleSlotStyle =
    flowToggleSlotWidth > 0
      ? { width: flowToggleSlotWidth, minWidth: flowToggleSlotWidth }
      : undefined;

  /** Stack tag pills with 8px peek when the row runs out of horizontal space. */
  useLayoutEffect(() => {
    if (isCollapsed || filters.selectedTags.length <= 1) {
      setTagPillsUseOverlap(false);
      setTagPillWidths([]);
      return;
    }
    const container = tagPillsContainerRef.current;
    if (!container) return;
    const listGroup = container.parentElement;
    const filterArea = listGroup?.parentElement;

    const measure = () => {
      if (hoveredTagIndex !== null) return;
      const { useOverlap, widths } = measureFilterPillStack(
        container,
        '[data-tag-pill]',
        '[data-tag-clear-all]',
      );
      setTagPillWidths(widths);
      setTagPillsUseOverlap(useOverlap);
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(container);
    if (listGroup) ro?.observe(listGroup);
    if (filterArea) ro?.observe(filterArea);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    isCollapsed,
    filters.selectedTags,
    availableTags,
    flowToggleSlotWidth,
    saveApplyRightInset,
    hoveredTagIndex,
  ]);

  useEffect(() => {
    setHoveredTagIndex(null);
  }, [filters.selectedTags]);

  /** Stack priority pills with 8px peek when the row runs out of horizontal space. */
  useLayoutEffect(() => {
    if (isCollapsed || filters.selectedPriorities.length <= 1) {
      setPriorityPillsUseOverlap(false);
      setPriorityPillWidths([]);
      return;
    }
    const container = priorityPillsContainerRef.current;
    if (!container) return;
    const listGroup = container.parentElement;
    const filterArea = listGroup?.parentElement;

    const measure = () => {
      if (hoveredPriorityIndex !== null) return;
      const { useOverlap, widths } = measureFilterPillStack(
        container,
        '[data-priority-pill]',
        '[data-priority-clear-all]',
      );
      setPriorityPillWidths(widths);
      setPriorityPillsUseOverlap(useOverlap);
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(container);
    if (listGroup) ro?.observe(listGroup);
    if (filterArea) ro?.observe(filterArea);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    isCollapsed,
    filters.selectedPriorities,
    availablePriorities,
    flowToggleSlotWidth,
    saveApplyRightInset,
    hoveredPriorityIndex,
  ]);

  useEffect(() => {
    setHoveredPriorityIndex(null);
  }, [filters.selectedPriorities]);

  // Helper function to get input field styling based on whether it's active
  const getInputClassName = (isActive: boolean) => {
    const baseClasses = "px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent";
    const activeClasses = isActive ? "border-blue-400 bg-blue-50 dark:bg-blue-900" : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100";
    return `${baseClasses} ${activeClasses}`;
  };

  // Helper function to get dropdown button styling based on whether it's active
  const getDropdownButtonClassName = (isActive: boolean) => {
    const baseClasses = `relative bg-white dark:bg-gray-700 border rounded px-2 py-1 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent ${FILTER_PROJECT_TAG_PRIORITY_WIDTH_CLASS} flex items-center text-gray-900 dark:text-gray-100`;
    const activeClasses = isActive ? "border-blue-400 bg-blue-50 dark:bg-blue-900" : "border-gray-300 dark:border-gray-600";
    return `${baseClasses} ${activeClasses}`;
  };

  // Load saved filter views function (only user's own - shared filters come from props)
  const loadSavedFilters = async () => {
    setIsLoadingFilters(true);
    try {
      
      // Load user's own filters
      const myViews = await getSavedFilterViews();
      setSavedFilterViews(myViews);
    } catch (error) {
      console.error('❌ [SearchInterface] Failed to load saved filter views:', error);
    } finally {
      setIsLoadingFilters(false);
    }
  };

  // Load saved filter views on mount
  useEffect(() => {
    loadSavedFilters();
  }, []);

  useEffect(() => {
    if (!showFilterDropdown) {
      setSavedFilterSearchTerm('');
    }
  }, [showFilterDropdown]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(event.target as Node)) {
        setShowPriorityDropdown(false);
      }
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(event.target as Node)) {
        setShowTagsDropdown(false);
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false);
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper function to convert SearchFilters to API format
  const convertFiltersForAPI = (searchFilters: SearchFilters) =>
    searchFiltersToViewFilters(searchFilters);

  // Handle applying a saved filter
  const handleApplyFilter = async (view: SavedFilterView | null) => {
    if (view) {
      if (onApplySavedFilter) {
        const applied = await onApplySavedFilter(view);
        setSavedFilterViews((prev) =>
          prev.map((v) => (v.id === applied.id ? applied : v)),
        );
      }
    } else {
      await handleClearAllFilters();
    }
    setShowFilterDropdown(false);
  };

  // Centralized clear all filters function
  const handleClearAllFilters = async () => {
    if (onClearAllSearchFilters) {
      await onClearAllSearchFilters();
    } else {
      onFiltersChange({ ...EMPTY_SEARCH_FILTERS });
      onFilterViewChange?.(null);
    }
    // Re-show Agent tasks — treated as an active filter when hidden
    if (siteSettings?.AI_ENABLED === 'true' && onToggleShowAgentTasks && !showAgentTasks) {
      onToggleShowAgentTasks(true);
    }
    
    // DON'T clear column filters - preserve user's column visibility preferences
  };

  // Handle saving current filters as a new view
  const handleSaveFilter = async () => {
    if (!newFilterName.trim()) return;

    setIsSavingFilter(true);
    try {
      const apiFilters = convertFiltersForAPI(filters);
      const newView = await createSavedFilterView({
        filterName: newFilterName.trim(),
        filters: apiFilters,
        shared: false
      });
      
      setSavedFilterViews(prev => [...prev, newView]);
      setNewFilterName('');
      setShowSaveDialog(false);
      if (onApplySavedFilter) {
        const applied = await onApplySavedFilter(newView);
        setSavedFilterViews((prev) =>
          prev.map((v) => (v.id === applied.id ? applied : v)),
        );
      } else {
        onFilterViewChange?.(newView);
      }
    } catch (error) {
      console.error('Failed to save filter view:', error);
      // Could add a toast notification here
    } finally {
      setIsSavingFilter(false);
    }
  };

  // Handle updating an existing filter with current filter values
  const handleUpdateFilter = async (view: SavedFilterView) => {
    setIsSavingFilter(true);
    try {
      const updatedView = onUpdateSavedFilter
        ? await onUpdateSavedFilter(view.id, filters)
        : await updateSavedFilterView(view.id, {
            filters: convertFiltersForAPI(filters),
          });

      setSavedFilterViews((prev) =>
        prev.map((v) => (v.id === view.id ? updatedView : v)),
      );

      if (currentFilterView?.id === view.id) {
        onFilterViewChange?.(updatedView);
      }

      setShowFilterDropdown(false);
      setShowSaveDialog(false);
      setNewFilterName('');
    } catch (error) {
      console.error('Failed to update filter view:', error);
    } finally {
      setIsSavingFilter(false);
    }
  };

  const openSaveFilterDialog = () => {
    setNewFilterName(currentFilterView?.filterName ?? '');
    setShowFilterDropdown(false);
    setShowSaveDialog(true);
  };

  // Check if current filters have any active filters
  const hasActiveFilters = () => {
    return !!(
      filters.text || 
      filters.dateFrom || 
      filters.dateTo || 
      filters.dueDateFrom || 
      filters.dueDateTo || 
      filters.selectedPriorities.length > 0 || 
      filters.selectedTags.length > 0 || 
      filters.selectedProjectIds.length > 0 ||
      filters.taskId ||
      filters.linkedTasksOnly ||
      filters.overdueOnly ||
      filters.blockedOnly ||
      filters.selectedSprintIds.length > 0 ||
      (filters.stalledDays != null && filters.stalledDays > 0)
    );
  };

  // Clamp Save/apply dropdown height to remaining viewport space
  useLayoutEffect(() => {
    if (!showFilterDropdown) {
      setFilterDropdownMaxHeight(null);
      return;
    }

    const updateMaxHeight = () => {
      const anchor = filterDropdownRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - FILTER_DROPDOWN_VIEWPORT_MARGIN_PX;
      const capped = Math.min(
        spaceBelow,
        Math.min(window.innerHeight * 0.55, FILTER_DROPDOWN_MAX_HEIGHT_PX),
      );
      setFilterDropdownMaxHeight(Math.max(FILTER_DROPDOWN_MIN_HEIGHT_PX, capped));
    };

    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    window.addEventListener('scroll', updateMaxHeight, true);
    return () => {
      window.removeEventListener('resize', updateMaxHeight);
      window.removeEventListener('scroll', updateMaxHeight, true);
    };
  }, [
    showFilterDropdown,
    savedFilterViews.length,
    sharedFilterViews?.length,
    canUpdateCurrentFilter,
    hasActiveFilters(),
  ]);

  /** Same visibility rules as the Clear All (X) button. */
  const canClearAllFilters = () => {
    if (hasActiveFilters()) return true;
    const hasColumnFilters = columns && visibleColumns && (() => {
      const allColumns = Object.values(columns);
      const nonArchivedColumns = allColumns.filter(col => !col.is_archived);
      const visibleNonArchivedColumns = visibleColumns.filter(colId => {
        const col = columns[colId];
        return col && !col.is_archived;
      });
      return visibleNonArchivedColumns.length < nonArchivedColumns.length;
    })();
    const hasAgentHidden =
      siteSettings?.AI_ENABLED === 'true' &&
      !!onToggleShowAgentTasks &&
      !showAgentTasks;
    const hasLinkedFilter = filters.linkedTasksOnly;
    const hasFlowFilters =
      filters.overdueOnly ||
      filters.blockedOnly ||
      filters.selectedSprintIds.length > 0 ||
      (filters.stalledDays != null && filters.stalledDays > 0);
    return !!(hasColumnFilters || hasAgentHidden || hasLinkedFilter || hasFlowFilters);
  };

  /**
   * Escape in search/filter: close dropdowns → clear focused field (field X) →
   * clear all filters (Clear All X) → blur.
   */
  const handleFilterEscape = (
    e: KeyboardEvent,
    fieldKey?: keyof SearchFilters
  ) => {
    if (e.key !== 'Escape') return;
    if (showSaveDialog || showManageModal) return;

    if (showPriorityDropdown || showTagsDropdown || showFilterDropdown || showProjectDropdown) {
      e.preventDefault();
      e.stopPropagation();
      setShowPriorityDropdown(false);
      setShowTagsDropdown(false);
      setShowFilterDropdown(false);
      setShowProjectDropdown(false);
      return;
    }

    if (fieldKey) {
      const val = filters[fieldKey];
      const hasFieldValue =
        fieldKey === 'stalledDays'
          ? filters.stalledDays != null && filters.stalledDays > 0
          : Array.isArray(val)
            ? val.length > 0
            : Boolean(val);
      if (hasFieldValue) {
        e.preventDefault();
        e.stopPropagation();
        if (fieldKey === 'stalledDays') {
          updateFilter('stalledDays', null);
        } else {
          updateFilter(fieldKey, Array.isArray(val) ? [] : '');
        }
        return;
      }
    }

    if (canClearAllFilters()) {
      e.preventDefault();
      e.stopPropagation();
      handleClearAllFilters();
      return;
    }

    if (e.currentTarget instanceof HTMLElement) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 rounded-lg p-3 mb-4"
      onKeyDown={(e) => {
        // Panel-level Escape when focus is on buttons/chips (inputs handle their own).
        if (e.key !== 'Escape') return;
        if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName === 'INPUT') {
          return;
        }
        handleFilterEscape(e);
      }}
    >
      {/* Title | fields — shared column so search / start-from / due-from inputs stay left-aligned */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 items-center">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide leading-5 self-center shrink-0">
          {t('searchInterface.title')}
        </h2>
        <div ref={saveApplyAlignRef} className="flex items-center justify-between min-w-0 gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <div className={`relative shrink-0 ${FILTER_SEARCH_WIDTH_CLASS}`}>
              <input
                type="text"
                name="kanban-text-filter"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                placeholder={t('searchInterface.searchPlaceholder')}
                value={filters.text}
                onChange={(e) => updateFilter('text', e.target.value)}
                onKeyDown={(e) => handleFilterEscape(e, 'text')}
                className={`w-full pr-6 ${getInputClassName(!!filters.text)}`}
              />
              {filters.text && (
                <button
                  onClick={() => updateFilter('text', '')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title={t('searchInterface.clearSearch')}
                >
                  <X size={10} className="text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>

            {/* Column Filter — left edge aligns with start-to / due-to below */}
            {columns && onColumnsChange && visibleColumns && selectedBoard && (
              <div className={`${FILTER_DATE_INPUT_WIDTH_CLASS} shrink-0`}>
                <ColumnFilterDropdown
                  columns={columns}
                  visibleColumns={visibleColumns}
                  onColumnsChange={onColumnsChange}
                  selectedBoard={selectedBoard}
                  fullWidth
                  onResetToDefault={onResetColumnVisibility}
                />
              </div>
            )}
          </div>

          {/* Project multi-select — pill counter trigger (matches Columns / Sprints) */}
          <div className="flex items-center gap-1 shrink-0">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('searchInterface.projectId')}:</label>
            <div className="relative overflow-visible" ref={projectFieldRef}>
              <div className="relative" ref={projectDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                  onKeyDown={(e) => handleFilterEscape(e, 'selectedProjectIds')}
                  className={`relative flex items-center gap-1.5 px-2 py-1 pr-6 text-xs font-medium rounded transition-colors ${FILTER_PROJECT_TAG_PRIORITY_WIDTH_CLASS} ${
                    filters.selectedProjectIds.length > 0
                      ? 'border border-blue-400 bg-blue-50 dark:bg-blue-900 text-gray-700 dark:text-gray-300'
                      : 'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                  title={t('searchInterface.projectFilterHint')}
                  aria-label={t('searchInterface.projectFilterHint')}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {filters.selectedProjectIds.length === 0
                      ? t('searchInterface.projectFilterAll')
                      : t('searchInterface.projectFilterShort')}
                  </span>
                  {filters.selectedProjectIds.length > 0 && (
                    <span className="shrink-0 px-1.5 py-0.5 text-xs leading-none bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
                      {filters.selectedProjectIds.length}
                    </span>
                  )}
                  {filters.selectedProjectIds.length === 0 && (
                    <ChevronDown
                      size={12}
                      className={`pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 transition-transform ${
                        showProjectDropdown ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>
                {filters.selectedProjectIds.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      updateFilter('selectedProjectIds', []);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors z-10"
                    title={t('searchInterface.clearProjectFilter')}
                    aria-label={t('searchInterface.clearProjectFilter')}
                  >
                    <X size={10} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                  </button>
                )}
                {showProjectDropdown && (
                  <div className="absolute top-full left-0 mt-2 w-max min-w-[16rem] max-w-[min(24rem,90vw)] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-[60] max-h-64 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {t('searchInterface.projectFilterPanelTitle')}
                      </span>
                    </div>
                    <div className="overflow-y-auto flex-1 py-1">
                      {projectBoardOptions.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {t('searchInterface.noProjectsAvailable')}
                        </div>
                      ) : (
                        projectBoardOptions.map(({ board, key }) => {
                          const isSelected = filters.selectedProjectIds.includes(key);
                          return (
                            <button
                              key={board.id}
                              type="button"
                              onClick={() => toggleProjectFilter(key)}
                              className={`w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center gap-3 ${
                                isSelected
                                  ? 'bg-blue-50 dark:bg-blue-900/20'
                                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="min-w-0 flex-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
                                <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  {key}
                                </span>
                                <span
                                  className={`truncate font-medium ${
                                    isSelected
                                      ? 'text-blue-600 dark:text-blue-400'
                                      : 'text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  {board.title}
                                </span>
                              </div>
                              {isSelected && (
                                <Check size={14} className="shrink-0 text-blue-600 dark:text-blue-400" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('searchInterface.taskId')}:</label>
            <div className="relative">
              <input
                type="text"
                placeholder={t('searchInterface.taskIdPlaceholder')}
                value={filters.taskId}
                onChange={(e) => updateFilter('taskId', e.target.value)}
                onKeyDown={(e) => handleFilterEscape(e, 'taskId')}
                className={`w-[85px] pr-6 ${getInputClassName(!!filters.taskId)}`}
              />
              {filters.taskId && (
                <button
                  onClick={() => updateFilter('taskId', '')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                  title={t('searchInterface.clearTaskId')}
                >
                  <X size={10} className="text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              disabled={!hasBoardRelationships}
              onClick={() => updateFilter('linkedTasksOnly', !filters.linkedTasksOnly)}
              className={`rounded p-1 transition-colors ${
                !hasBoardRelationships
                  ? 'cursor-not-allowed text-gray-400 opacity-40'
                  : filters.linkedTasksOnly
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200'
              }`}
              title={
                !hasBoardRelationships
                  ? t('searchInterface.linkedTasksOnlyDisabled')
                  : filters.linkedTasksOnly
                    ? t('searchInterface.linkedTasksOnlyOn')
                    : t('searchInterface.linkedTasksOnlyOff')
              }
              aria-label={
                !hasBoardRelationships
                  ? t('searchInterface.linkedTasksOnlyDisabled')
                  : filters.linkedTasksOnly
                    ? t('searchInterface.linkedTasksOnlyOn')
                    : t('searchInterface.linkedTasksOnlyOff')
              }
              aria-pressed={filters.linkedTasksOnly}
            >
              <GitBranch size={14} />
            </button>
          </div>
          
          {/* Saved Filters Section */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('searchInterface.saveApply')}:</span>
            
            {/* Filter Dropdown */}
            <div className="relative" ref={filterDropdownRef}>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  title={currentFilterView?.filterName}
                  className={`relative flex items-center gap-0.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent min-w-[120px] max-w-[140px] overflow-hidden${
                    currentFilterView ? ' pr-7' : ' pr-6'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-left text-gray-600 dark:text-gray-300">
                    {currentFilterView ? currentFilterView.filterName : t('searchInterface.none')}
                  </span>
                  {currentFilterView && canUpdateCurrentFilter && (
                    <span
                      className="shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    >
                      •
                    </span>
                  )}
                  {!currentFilterView && (
                    <ChevronDown
                      size={12}
                      className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 shrink-0"
                    />
                  )}
                </button>
                {currentFilterView && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleApplyFilter(null);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors z-10"
                    title={t('searchInterface.clearSavedFilter')}
                    aria-label={t('searchInterface.clearSavedFilter')}
                  >
                    <X size={10} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                  </button>
                )}
              </div>
              
              {showFilterDropdown && (
                <div
                  className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 min-w-[220px] max-h-[min(28rem,55vh)] overflow-hidden flex flex-col overscroll-contain"
                  style={
                    filterDropdownMaxHeight != null
                      ? { maxHeight: filterDropdownMaxHeight }
                      : undefined
                  }
                >
                  <div className="shrink-0">
                    {/* None option */}
                    <button
                      onClick={() => handleApplyFilter(null)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                    >
                      <span>{t('searchInterface.none')}</span>
                      {!currentFilterView && <Check size={12} className="text-blue-500" />}
                    </button>

                    {/* Update current filter (when applied and modified) */}
                    {canUpdateCurrentFilter && currentFilterView && (
                      <>
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <button
                          onClick={() => handleUpdateFilter(currentFilterView)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 flex items-center gap-2"
                          disabled={isSavingFilter}
                        >
                          <RefreshCw size={12} className={isSavingFilter ? 'animate-spin' : ''} />
                          {t('searchInterface.updateCurrentFilter', { name: currentFilterView.filterName })}
                        </button>
                      </>
                    )}

                    {/* Save current filters option */}
                    {hasActiveFilters() && (
                      <>
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <button
                          onClick={openSaveFilterDialog}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 flex items-center"
                        >
                          <Save size={12} className="mr-2" />
                          {t('searchInterface.saveCurrentFilters')}
                        </button>
                      </>
                    )}

                    {totalSavedFilterViews > 0 && (
                      <>
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <div className="p-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={savedFilterSearchTerm}
                              onChange={(e) => setSavedFilterSearchTerm(e.target.value)}
                              placeholder={t('searchInterface.searchSavedFilters')}
                              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-1.5 pl-7 pr-7 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-transparent focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                            {savedFilterSearchTerm && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSavedFilterSearchTerm('');
                                }}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                                title={t('searchInterface.clearSavedFilterSearch')}
                                aria-label={t('searchInterface.clearSavedFilterSearch')}
                              >
                                <X size={10} className="text-gray-400" />
                              </button>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {/* My Filters Section */}
                    {filteredSavedFilterViews.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                          {t('searchInterface.myFilters')}:
                        </div>
                        {filteredSavedFilterViews.map((view) => (
                          <div key={view.id} className="flex items-center group">
                            <button
                              onClick={() => handleApplyFilter(view)}
                              className="flex-1 text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                            >
                              <span className="truncate">{view.filterName}</span>
                              {currentFilterView?.id === view.id && (
                                <Check size={12} className="text-blue-500 shrink-0" />
                              )}
                            </button>
                            {hasActiveFilters() && savedFilterViews.some((v) => v.id === view.id) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateFilter(view);
                                }}
                                className="px-2 py-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors opacity-0 group-hover:opacity-100"
                                title={t('searchInterface.updateFilter', { name: view.filterName })}
                                disabled={isSavingFilter}
                              >
                                <RefreshCw size={12} className={isSavingFilter ? 'animate-spin' : ''} />
                              </button>
                            )}
                          </div>
                        ))}
                      </>
                    )}

                    {/* Shared Filters Section */}
                    {filteredSharedFilterViews.length > 0 && (
                      <>
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <div className="px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                          {t('searchInterface.sharedFilters')}:
                        </div>
                        {filteredSharedFilterViews.map((view) => (
                          <div key={`shared-${view.id}`} className="flex items-center">
                            <button
                              onClick={() => handleApplyFilter(view)}
                              className="flex-1 text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-blue-500 shrink-0">🌐</span>
                                <span className="truncate">{view.filterName}</span>
                                {view.creatorName && (
                                  <span className="text-gray-400 text-xs truncate">
                                    ({t('searchInterface.by', { name: view.creatorName })})
                                  </span>
                                )}
                              </div>
                              {currentFilterView?.id === view.id && (
                                <Check size={12} className="text-blue-500 shrink-0" />
                              )}
                            </button>
                          </div>
                        ))}
                      </>
                    )}

                    {savedFilterSearchQuery && !hasSavedFilterSearchResults && totalSavedFilterViews > 0 && (
                      <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
                        {t('searchInterface.noSavedFiltersMatch')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Manage Filters Button */}
            <button
              onClick={() => setShowManageModal(true)}
              className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title={t('searchInterface.manageSavedFilters')}
            >
              <Settings size={14} />
            </button>
          </div>
          
          {/* Clear All Filters Button */}
          {(() => {
            const hasSearchFilters = filters.text || filters.dateFrom || filters.dateTo || filters.dueDateFrom || filters.dueDateTo || filters.selectedPriorities.length > 0 || filters.selectedTags.length > 0 || filters.selectedProjectIds.length > 0 || filters.taskId || filters.linkedTasksOnly || filters.overdueOnly || filters.blockedOnly || filters.selectedSprintIds.length > 0 || (filters.stalledDays != null && filters.stalledDays > 0);
            
            // Check if any non-archived columns are hidden (archived columns are hidden by default)
            const hasColumnFilters = columns && visibleColumns && (() => {
              const allColumns = Object.values(columns);
              const nonArchivedColumns = allColumns.filter(col => !col.is_archived);
              const visibleNonArchivedColumns = visibleColumns.filter(colId => {
                const col = columns[colId];
                return col && !col.is_archived;
              });
              return visibleNonArchivedColumns.length < nonArchivedColumns.length;
            })();

            const hasAgentHidden =
              siteSettings?.AI_ENABLED === 'true' &&
              !!onToggleShowAgentTasks &&
              !showAgentTasks;
            
            return hasSearchFilters || hasColumnFilters || hasAgentHidden;
          })() && (
            <button
              onClick={handleClearAllFilters}
              className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full border border-gray-300 dark:border-gray-600 transition-colors"
              title={t('searchInterface.clearAllFilters')}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {siteSettings?.AI_ENABLED === 'true' && onToggleShowAgentTasks && (
            <button
              type="button"
              onClick={() => onToggleShowAgentTasks(!showAgentTasks)}
              className={`
                shrink-0 rounded-full p-0.5 transition-all
                focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1
                ${showAgentTasks
                  ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-800'
                  : 'opacity-45 grayscale hover:opacity-70'
                }
              `}
              title={
                showAgentTasks
                  ? t('searchInterface.hideAgentTasks')
                  : t('searchInterface.showAgentTasks')
              }
              aria-label={
                showAgentTasks
                  ? t('searchInterface.hideAgentTasks')
                  : t('searchInterface.showAgentTasks')
              }
              aria-pressed={showAgentTasks}
            >
              <img
                src={getAgentAvatarSrc()}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
                draggable={false}
              />
            </button>
          )}
          <button
            onClick={handleToggleCollapse}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title={isCollapsed ? t('searchInterface.expandAdvanced') : t('searchInterface.collapseBasic')}
          >
            {isCollapsed ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronUp size={14} className="text-gray-500" />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Row 1: Start Dates — inputs share the same column as the search field */}
          <label
            htmlFor="filter-start-from"
            className="text-xs font-medium text-gray-700 dark:text-gray-300 justify-self-end whitespace-nowrap leading-5"
          >
            {t('searchInterface.startFrom')}:
          </label>
          <div className="flex items-center gap-2 min-w-0 w-full">
            <div ref={datesPairRef} className="flex items-center gap-2 shrink-0">
              <div className="relative shrink-0">
                <input
                  id="filter-start-from"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => updateFilter('dateFrom', e.target.value)}
                  onKeyDown={(e) => handleFilterEscape(e, 'dateFrom')}
                  className={`w-[140px] ${getInputClassName(!!filters.dateFrom)}`}
                />
                {filters.dateFrom && (
                  <button
                    onClick={() => updateFilter('dateFrom', '')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                    title={t('searchInterface.clearStartFrom')}
                  >
                    <X size={8} className="text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>

              <div className="relative shrink-0">
                <label
                  htmlFor="filter-start-to"
                  className="pointer-events-none absolute left-0 top-1/2 z-[1] w-[56px] -translate-y-1/2 text-right text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap"
                >
                  {t('searchInterface.startTo')}:
                </label>
                <input
                  id="filter-start-to"
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => updateFilter('dateTo', e.target.value)}
                  onKeyDown={(e) => handleFilterEscape(e, 'dateTo')}
                  className={`w-[140px] ml-[60px] ${getInputClassName(!!filters.dateTo)}`}
                />
                {filters.dateTo && (
                  <button
                    onClick={() => updateFilter('dateTo', '')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                    title={t('searchInterface.clearStartTo')}
                  >
                    <X size={8} className="text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            <div
              className="flex items-center justify-center shrink-0"
              style={flowToggleSlotStyle}
            >
              <button
                type="button"
                onClick={() => updateFilter('overdueOnly', !filters.overdueOnly)}
                className={flowToggleClass(filters.overdueOnly)}
                title={
                  filters.overdueOnly
                    ? t('searchInterface.overdueOnlyOn')
                    : t('searchInterface.overdueOnlyOff')
                }
                aria-label={
                  filters.overdueOnly
                    ? t('searchInterface.overdueOnlyOn')
                    : t('searchInterface.overdueOnlyOff')
                }
                aria-pressed={filters.overdueOnly}
              >
                <AlertCircle size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Tags Dropdown — no overflow-hidden here; it clips the menu */}
            <div className="relative shrink-0" ref={tagsDropdownRef}>
                <FilterDropdownWithClear
                  showClear={filters.selectedTags.length > 0}
                  onClear={() => updateFilter('selectedTags', [])}
                  clearTitle={t('searchInterface.clearAllTags')}
                  buttonClassName={getDropdownButtonClassName(filters.selectedTags.length > 0)}
                  onToggle={() => setShowTagsDropdown(!showTagsDropdown)}
                  onKeyDown={(e) => handleFilterEscape(e, 'selectedTags')}
                >
                  <span className="text-gray-700 dark:text-gray-300 text-xs">{t('searchInterface.tag')}</span>
                </FilterDropdownWithClear>

                {showTagsDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-[60] min-w-[180px] max-h-[400px] overflow-y-auto">
                    {availableTags.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {t('searchInterface.noTagsAvailable')}
                      </div>
                    ) : (
                    availableTags.map(tag => {
                      const isSelected = filters.selectedTags.includes(tag.id.toString());
                      return (
                        <div
                          key={tag.id}
                          onClick={() => toggleTag(tag.id.toString())}
                          className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-sm"
                        >
                          <div className="w-4 h-4 flex items-center justify-center shrink-0">
                            {isSelected && <Check size={12} className="text-blue-600 dark:text-blue-400" />}
                          </div>
                          <div
                            className="w-3 h-3 rounded shrink-0"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="text-gray-700 dark:text-gray-300">{tag.tag}</span>
                        </div>
                      );
                    })
                    )}
                  </div>
                )}
              </div>

              {filters.selectedTags.length > 0 && (
              <div className="flex items-center gap-3 shrink-0">
                <div
                  ref={tagPillsContainerRef}
                  className={`flex items-center ${tagPillsUseOverlap ? 'shrink-0 overflow-hidden' : 'min-w-0 shrink gap-2'}`}
                  style={
                    tagPillsUseOverlap
                      ? { width: stackedPillRowWidth(tagPillWidths) }
                      : undefined
                  }
                  onMouseMove={handleTagStackMouseMove}
                  onMouseLeave={() => setHoveredTagIndex(null)}
                  title={
                    tagPillsUseOverlap
                      ? undefined
                      : filters.selectedTags
                          .map((tagId) => availableTags.find((t) => t.id.toString() === tagId)?.tag)
                          .filter(Boolean)
                          .join(', ')
                  }
                >
                  {filters.selectedTags.map((tagId, index) => {
                    const tag = availableTags.find(t => t.id.toString() === tagId);
                    if (!tag) return null;
                    const isForeground =
                      tagPillsUseOverlap && hoveredTagIndex !== null && hoveredTagIndex === index;
                    const isBackground =
                      tagPillsUseOverlap && hoveredTagIndex !== null && hoveredTagIndex !== index;
                    const overlapMargin =
                      tagPillsUseOverlap && index > 0
                        ? -Math.max(0, (tagPillWidths[index - 1] ?? 0) - FILTER_PILL_OVERLAP_PEEK_PX)
                        : 0;
                    return (
                      <div
                        key={tagId}
                        data-tag-pill
                        data-tag-index={index}
                        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold border shrink-0 max-w-[120px] relative transition-opacity duration-200 ease-out"
                        style={{
                          backgroundColor: tag.color || '#4ECDC4',
                          color: getTextColor(tag.color || '#4ECDC4'),
                          borderColor: getTextColor(tag.color || '#4ECDC4') === '#374151' ? '#d1d5db' : 'rgba(255, 255, 255, 0.3)',
                          marginLeft: overlapMargin,
                          zIndex: isForeground ? 100 : index,
                          opacity: isBackground ? 0.45 : 1,
                        }}
                      >
                        <span className="truncate">{tag.tag}</span>
                        <button
                          type="button"
                          onClick={() => toggleTag(tagId)}
                          className="ml-1 hover:bg-black hover:bg-opacity-10 rounded-full p-0.5 transition-colors shrink-0"
                          title={t('searchInterface.removeTag', { tag: tag.tag })}
                        >
                          <X size={10} className="text-red-600" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {filters.selectedTags.length > 1 && (
                  <div
                    data-tag-clear-all
                    className="flex items-center bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 px-2 py-1 rounded-full text-xs border border-red-300 dark:border-red-700 shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => updateFilter('selectedTags', [])}
                      className="p-0.5 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-full transition-colors"
                      title={t('searchInterface.clearAllTags')}
                    >
                      <X size={10} className="text-red-600 dark:text-red-300" />
                    </button>
                  </div>
                )}
              </div>
              )}

            </div>

            {/* Sprints — trailing; right edge aligned with Save / apply dropdown above */}
            <div
              className="flex items-center gap-1.5 shrink-0"
              style={trailingFilterAlignStyle}
            >
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {t('searchInterface.sprintFilter')}:
              </label>
              <SprintMultiFilterSelector
                selectedSprintIds={filters.selectedSprintIds}
                onSelectedSprintIdsChange={(ids) => updateFilter('selectedSprintIds', ids)}
                sprints={availableSprints.map((sprint) => ({
                  id: sprint.id,
                  name: sprint.name,
                  start_date: sprint.start_date ?? '',
                  end_date: sprint.end_date ?? '',
                  is_active: sprint.is_active,
                }))}
                tasks={sprintFilterTasks}
              />
            </div>
          </div>

          <label
            htmlFor="filter-due-from"
            className="text-xs font-medium text-gray-700 dark:text-gray-300 justify-self-end whitespace-nowrap leading-5"
          >
            {t('searchInterface.dueFrom')}:
          </label>
          <div className="flex items-center gap-2 min-w-0 w-full">
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative shrink-0">
                <input
                  id="filter-due-from"
                  type="date"
                  value={filters.dueDateFrom}
                  onChange={(e) => updateFilter('dueDateFrom', e.target.value)}
                  onKeyDown={(e) => handleFilterEscape(e, 'dueDateFrom')}
                  className={`w-[140px] ${getInputClassName(!!filters.dueDateFrom)}`}
                />
                {filters.dueDateFrom && (
                  <button
                    onClick={() => updateFilter('dueDateFrom', '')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                    title={t('searchInterface.clearDueFrom')}
                  >
                    <X size={8} className="text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>

              <div className="relative shrink-0">
                <label
                  htmlFor="filter-due-to"
                  className="pointer-events-none absolute left-0 top-1/2 z-[1] w-[56px] -translate-y-1/2 text-right text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap"
                >
                  {t('searchInterface.dueTo')}:
                </label>
                <input
                  id="filter-due-to"
                  type="date"
                  value={filters.dueDateTo}
                  onChange={(e) => updateFilter('dueDateTo', e.target.value)}
                  onKeyDown={(e) => handleFilterEscape(e, 'dueDateTo')}
                  className={`w-[140px] ml-[60px] ${getInputClassName(!!filters.dueDateTo)}`}
                />
                {filters.dueDateTo && (
                  <button
                    onClick={() => updateFilter('dueDateTo', '')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                    title={t('searchInterface.clearDueTo')}
                  >
                    <X size={8} className="text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            <div
              className="flex items-center justify-center shrink-0"
              style={flowToggleSlotStyle}
            >
              <button
                type="button"
                onClick={() => updateFilter('blockedOnly', !filters.blockedOnly)}
                className={flowToggleClass(filters.blockedOnly)}
                title={
                  filters.blockedOnly
                    ? t('searchInterface.blockedOnlyOn')
                    : t('searchInterface.blockedOnlyOff')
                }
                aria-label={
                  filters.blockedOnly
                    ? t('searchInterface.blockedOnlyOn')
                    : t('searchInterface.blockedOnlyOff')
                }
                aria-pressed={filters.blockedOnly}
              >
                <Ban size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Priority Dropdown — no overflow-hidden here; it clips the menu */}
            <div className="relative shrink-0" ref={priorityDropdownRef}>
              <FilterDropdownWithClear
                showClear={filters.selectedPriorities.length > 0}
                onClear={() => updateFilter('selectedPriorities', [])}
                clearTitle={t('searchInterface.clearAllPriorities')}
                buttonClassName={getDropdownButtonClassName(filters.selectedPriorities.length > 0)}
                onToggle={() => setShowPriorityDropdown(!showPriorityDropdown)}
                onKeyDown={(e) => handleFilterEscape(e, 'selectedPriorities')}
              >
                <span className="text-gray-700 dark:text-gray-300 text-xs">{t('searchInterface.priority')}</span>
              </FilterDropdownWithClear>

              {showPriorityDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-[60] min-w-[150px] max-h-60 overflow-y-auto">
                  {availablePriorities.map(priorityOption => {
                    const isSelected = filters.selectedPriorities.includes(priorityOption.priority);
                    return (
                      <div
                        key={priorityOption.id}
                        onClick={() => togglePriority(priorityOption.priority)}
                        className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-sm"
                      >
                        <div className="w-4 h-4 flex items-center justify-center shrink-0">
                          {isSelected && <Check size={12} className="text-blue-600 dark:text-blue-400" />}
                        </div>
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: priorityOption.color }}
                        />
                        <span className="text-gray-700 dark:text-gray-300">{priorityOption.priority}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {filters.selectedPriorities.length > 0 && (
              <div className="flex items-center gap-3 shrink-0">
                <div
                  ref={priorityPillsContainerRef}
                  className={`flex items-center ${priorityPillsUseOverlap ? 'shrink-0 overflow-hidden' : 'min-w-0 shrink gap-2'}`}
                  style={
                    priorityPillsUseOverlap
                      ? { width: stackedPillRowWidth(priorityPillWidths) }
                      : undefined
                  }
                  onMouseMove={handlePriorityStackMouseMove}
                  onMouseLeave={() => setHoveredPriorityIndex(null)}
                  title={
                    priorityPillsUseOverlap
                      ? undefined
                      : filters.selectedPriorities.join(', ')
                  }
                >
                  {filters.selectedPriorities.map((priorityName, index) => {
                    const priority = availablePriorities.find(p => p.priority === priorityName);
                    if (!priority) return null;
                    const isForeground =
                      priorityPillsUseOverlap && hoveredPriorityIndex !== null && hoveredPriorityIndex === index;
                    const isBackground =
                      priorityPillsUseOverlap && hoveredPriorityIndex !== null && hoveredPriorityIndex !== index;
                    const overlapMargin =
                      priorityPillsUseOverlap && index > 0
                        ? -Math.max(0, (priorityPillWidths[index - 1] ?? 0) - FILTER_PILL_OVERLAP_PEEK_PX)
                        : 0;
                    return (
                      <div
                        key={priorityName}
                        data-priority-pill
                        data-priority-index={index}
                        className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded-full text-xs border border-gray-300 dark:border-gray-600 shrink-0 max-w-[120px] relative transition-opacity duration-200 ease-out"
                        style={{
                          marginLeft: overlapMargin,
                          zIndex: isForeground ? 100 : index,
                          opacity: isBackground ? 0.45 : 1,
                        }}
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: priority.color }}
                        />
                        <span className="font-medium truncate">{priority.priority}</span>
                        <button
                          type="button"
                          onClick={() => togglePriority(priorityName)}
                          className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors shrink-0"
                          title={t('searchInterface.removePriority')}
                        >
                          <X size={10} className="text-gray-600 dark:text-gray-300" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {filters.selectedPriorities.length > 1 && (
                  <div
                    data-priority-clear-all
                    className="flex items-center bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 px-2 py-1 rounded-full text-xs border border-red-300 dark:border-red-700 shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => updateFilter('selectedPriorities', [])}
                      className="p-0.5 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-full transition-colors"
                      title={t('searchInterface.clearAllPriorities')}
                    >
                      <X size={10} className="text-red-600 dark:text-red-300" />
                    </button>
                  </div>
                )}
              </div>
            )}

            </div>

            {/* Stalled — trailing; aligned with Sprints / Save / apply dropdown above */}
            <div
              className="flex items-center gap-1.5 shrink-0"
              style={trailingFilterAlignStyle}
            >
              <label
                htmlFor="filter-stalled-days"
                className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap"
              >
                {t('searchInterface.stalledDays')}:
              </label>
              <div className="relative">
                <input
                  id="filter-stalled-days"
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  placeholder={t('searchInterface.stalledDaysPlaceholder')}
                  value={filters.stalledDays != null && filters.stalledDays > 0 ? String(filters.stalledDays) : ''}
                  onChange={(e) => handleStalledDaysChange(e.target.value)}
                  onKeyDown={(e) => handleFilterEscape(e, 'stalledDays')}
                  className={`w-[52px] ${
                    filters.stalledDays != null && filters.stalledDays > 0 ? 'pr-5' : ''
                  } ${getInputClassName(filters.stalledDays != null && filters.stalledDays > 0)} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  title={t('searchInterface.stalledDaysHint')}
                />
                {filters.stalledDays != null && filters.stalledDays > 0 && (
                  <button
                    type="button"
                    onClick={() => updateFilter('stalledDays', null)}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                    title={t('searchInterface.clearStalledDays')}
                    aria-label={t('searchInterface.clearStalledDays')}
                  >
                    <X size={10} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      </div>

      {/* Save Filter Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] overflow-y-auto">
          <div className="h-screen flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96 max-w-[90vw] shadow-xl">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                {isSaveDialogUpdateMode
                  ? t('searchInterface.updateFilterTitle', { name: currentFilterView!.filterName })
                  : t('searchInterface.saveFilterTitle')}
              </h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('searchInterface.filterName')}
                </label>
                <input
                  type="text"
                  value={newFilterName}
                  onChange={(e) => setNewFilterName(e.target.value)}
                  placeholder={t('searchInterface.enterFilterName')}
                  maxLength={FILTER_NAME_MAX_LENGTH}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (isSaveDialogUpdateMode && !isSavingFilter) {
                        handleUpdateFilter(currentFilterView!);
                      } else if (canSaveAsNewFilter && !isSavingFilter) {
                        handleSaveFilter();
                      }
                    } else if (e.key === 'Escape') {
                      setShowSaveDialog(false);
                      setNewFilterName('');
                    }
                  }}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowSaveDialog(false);
                    setNewFilterName('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                  disabled={isSavingFilter}
                >
                  {t('buttons.cancel', { ns: 'common' })}
                </button>
                {isSaveDialogUpdateMode && (
                  <button
                    onClick={() => handleUpdateFilter(currentFilterView!)}
                    disabled={isSavingFilter}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                  >
                    {isSavingFilter ? t('searchInterface.saving') : t('searchInterface.updateFilterButton')}
                  </button>
                )}
                {canSaveAsNewFilter && (
                  <button
                    onClick={handleSaveFilter}
                    disabled={isSavingFilter}
                    className={`px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed ${
                      isSaveDialogUpdateMode
                        ? 'text-blue-700 dark:text-blue-200 bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-gray-600'
                        : 'text-white bg-blue-600 border border-transparent hover:bg-blue-700'
                    }`}
                  >
                    {isSavingFilter
                      ? t('searchInterface.saving')
                      : isSaveDialogUpdateMode
                        ? t('searchInterface.saveAsNewFilter')
                        : t('searchInterface.saveFilter')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Filters Modal */}
      <ManageFiltersModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
        savedFilterViews={savedFilterViews}
        onViewsUpdated={setSavedFilterViews}
        currentFilterView={currentFilterView}
        onCurrentFilterViewChange={onFilterViewChange}
        onRefreshFilters={loadSavedFilters}
      />
    </div>
  );
}
