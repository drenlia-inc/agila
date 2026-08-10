import React, { useEffect, useRef, useState } from 'react';
import { Minimize2, Maximize2, Search, Minus, LayoutGrid, List, Calendar, ChevronUp, GitBranch, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskViewMode, ViewMode } from '../utils/userPreferences';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import { KbdBadge } from './ui/KbdBadge';

interface ToolsProps {
  taskViewMode: TaskViewMode;
  onTaskViewModeChange: (mode: TaskViewMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isSearchActive: boolean;
  onToggleSearch: () => void;
  /** True when any board filter is active (search fields, members, columns, Agent hidden, etc.) */
  hasActiveFilters?: boolean;
  /** Instant tooltip listing why the indicator is on (multiline OK) */
  activeFilterTooltip?: string;
  /** When set, shows a chevron in the title row to collapse Tools / members / progress */
  onHideToolbar?: () => void;
  /** Kanban-only: dim unlinked cards and highlight related cards on hover */
  highlightLinksMode?: boolean;
  onToggleHighlightLinks?: () => void;
  /** Hide the highlight-links control when the board has no relationships */
  hasBoardRelationships?: boolean;
}

type OpenMenu = 'view' | 'density' | null;

const ICON_SIZE = 16;
const ICON_STROKE = 2;

const buttonBaseClass =
  'w-10 h-10 shrink-0 flex items-center justify-center rounded-md transition-all relative border';
const buttonActiveClass =
  'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700';
const buttonIdleClass =
  'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600';

function ToolIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} absoluteStrokeWidth />;
}

function TooltipWithShortcut({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: string;
}) {
  if (!shortcut) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      <KbdBadge>{shortcut}</KbdBadge>
    </span>
  );
}

export default function Tools({
  taskViewMode,
  onTaskViewModeChange,
  viewMode,
  onViewModeChange,
  isSearchActive,
  onToggleSearch,
  hasActiveFilters = false,
  activeFilterTooltip = '',
  onHideToolbar,
  highlightLinksMode = false,
  onToggleHighlightLinks,
  hasBoardRelationships = false,
}: ToolsProps) {
  const { t } = useTranslation('common');
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenu]);

  const viewModeOptions: {
    mode: ViewMode;
    icon: LucideIcon;
    label: string;
    tooltip: string;
    shortcut: string;
  }[] = [
    { mode: 'kanban', icon: LayoutGrid, label: t('tools.shortKanban'), tooltip: t('tools.currentKanbanView'), shortcut: '1' },
    { mode: 'list', icon: List, label: t('tools.shortList'), tooltip: t('tools.currentListView'), shortcut: '2' },
    { mode: 'gantt', icon: Calendar, label: t('tools.shortGantt'), tooltip: t('tools.currentGanttView'), shortcut: '3' },
  ];

  const densityOptions: {
    mode: TaskViewMode;
    icon: LucideIcon;
    label: string;
    tooltip: string;
    shortcut: string;
  }[] = [
    { mode: 'expand', icon: Maximize2, label: t('tools.shortExpand'), tooltip: t('tools.currentExpandView'), shortcut: 'F' },
    { mode: 'shrink', icon: Minimize2, label: t('tools.shortShrink'), tooltip: t('tools.currentShrinkView'), shortcut: 'P' },
    {
      mode: 'compact',
      icon: Minus,
      label: t('tools.shortCompact'),
      tooltip: t('tools.currentCompactViewHiddenDescriptions'),
      shortcut: 'M',
    },
  ];

  const currentViewOption = viewModeOptions.find((o) => o.mode === viewMode) || viewModeOptions[0];
  const currentDensityOption = densityOptions.find((o) => o.mode === taskViewMode) || densityOptions[0];
  const isCompact = taskViewMode === 'compact';

  const viewTooltip =
    viewMode === 'kanban' ? t('tools.currentKanbanView') :
    viewMode === 'list' ? t('tools.currentListView') :
    t('tools.currentGanttView');

  const densityTooltip = isCompact
    ? t('tools.currentCompactViewHiddenDescriptions')
    : taskViewMode === 'shrink'
      ? t('tools.currentShrinkView')
      : t('tools.currentExpandView');

  const renderMenuItem = (
    key: string,
    selected: boolean,
    icon: LucideIcon,
    label: string,
    shortcut: string,
    onSelect: () => void
  ) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`w-full flex items-center gap-0 text-left text-sm transition-colors ${
        selected
          ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      {/* Same footprint as the toolbar button so icons line up under the trigger */}
      <span
        className={`${buttonBaseClass} border-transparent bg-transparent rounded-none ${
          selected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'
        }`}
        aria-hidden="true"
      >
        <ToolIcon icon={icon} />
      </span>
      <span className="flex-1 py-2 whitespace-nowrap">{label}</span>
      <span className="pr-3 pl-2">
        <KbdBadge>{shortcut}</KbdBadge>
      </span>
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="p-3 bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-100 dark:border-gray-700 w-full flex-1 flex flex-col"
      data-tour-id="view-modes"
    >
      <div className="flex items-center justify-between mb-3 gap-1 min-h-5 shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide leading-5">{t('tools.title')}</h2>
        <div className="flex items-center gap-0.5 shrink-0 -mr-1">
          {viewMode === 'kanban' &&
            onToggleHighlightLinks &&
            hasBoardRelationships && (
            <KanbanChromeTooltip
              label={
                highlightLinksMode
                  ? t('tools.highlightLinksOn')
                  : t('tools.highlightLinksOff')
              }
            >
              <button
                type="button"
                onClick={onToggleHighlightLinks}
                className={`p-0.5 rounded transition-colors ${
                  highlightLinksMode
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40'
                    : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                aria-label={
                  highlightLinksMode
                    ? t('tools.highlightLinksOn')
                    : t('tools.highlightLinksOff')
                }
                aria-pressed={highlightLinksMode}
              >
                <GitBranch size={16} strokeWidth={ICON_STROKE} absoluteStrokeWidth />
              </button>
            </KanbanChromeTooltip>
          )}
          {onHideToolbar && (
            <KanbanChromeTooltip label={t('tools.hideBoardToolbar')}>
              <button
                type="button"
                onClick={onHideToolbar}
                className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label={t('tools.hideBoardToolbar')}
                aria-expanded={true}
              >
                <ChevronUp size={16} />
              </button>
            </KanbanChromeTooltip>
          )}
        </div>
      </div>

      <div className="flex gap-2 justify-center items-center flex-1 min-h-[2.5rem]">
        {/* Board view dropdown */}
        <div className="relative shrink-0">
          <KanbanChromeTooltip label={viewTooltip}>
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
              className={`${buttonBaseClass} ${
                viewMode !== 'kanban' ? buttonActiveClass : buttonIdleClass
              }`}
              aria-haspopup="menu"
              aria-expanded={openMenu === 'view'}
              data-tour-id="view-mode-toggle"
            >
              <ToolIcon icon={currentViewOption.icon} />
            </button>
          </KanbanChromeTooltip>
          {openMenu === 'view' && (
            <div
              role="menu"
              className="absolute left-0 top-full z-[60] mt-1 min-w-[9.5rem] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg overflow-hidden"
            >
              {viewModeOptions.map((option) =>
                renderMenuItem(
                  option.mode,
                  viewMode === option.mode,
                  option.icon,
                  option.label,
                  option.shortcut,
                  () => {
                    onViewModeChange(option.mode);
                    setOpenMenu(null);
                  }
                )
              )}
            </div>
          )}
        </div>

        {/* Search Toggle — no dropdown; show S in tooltip */}
        {(() => {
          const searchLabel =
            hasActiveFilters && activeFilterTooltip
              ? activeFilterTooltip
              : isSearchActive
                ? t('tools.hideSearchFilters')
                : t('tools.showSearchFilters');
          const searchButton = (
            <button
              type="button"
              onClick={onToggleSearch}
              className={`${buttonBaseClass} ${
                isSearchActive ? buttonActiveClass : buttonIdleClass
              }`}
              aria-label={`${
                hasActiveFilters && activeFilterTooltip
                  ? activeFilterTooltip.replace(/\n/g, '. ')
                  : isSearchActive
                    ? t('tools.hideSearchFilters')
                    : t('tools.showSearchFilters')
              } (S)`}
              data-tour-id="search-filter"
            >
              <ToolIcon icon={Search} />
              {hasActiveFilters && (
                <span
                  className={`absolute rounded-full bg-red-500 ring-1 ring-white dark:ring-gray-800 ${
                    isSearchActive
                      ? 'top-1 right-1 w-2 h-2'
                      : 'top-1.5 right-1.5 w-1.5 h-1.5'
                  }`}
                  aria-hidden="true"
                />
              )}
            </button>
          );

          return (
            <KanbanChromeTooltip
              content={
                hasActiveFilters && activeFilterTooltip ? (
                  searchLabel
                ) : (
                  <TooltipWithShortcut label={searchLabel} shortcut="S" />
                )
              }
              delayMs={hasActiveFilters && activeFilterTooltip ? 0 : undefined}
              placement="bottom"
              wrapperClassName="relative shrink-0 inline-flex"
            >
              {searchButton}
            </KanbanChromeTooltip>
          );
        })()}

        {/* Task density dropdown */}
        {(viewMode === 'kanban' || viewMode === 'list' || viewMode === 'gantt') && (
          <div className="relative shrink-0">
            <KanbanChromeTooltip label={densityTooltip}>
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'density' ? null : 'density')}
                className={`${buttonBaseClass} ${
                  taskViewMode !== 'expand' ? buttonActiveClass : buttonIdleClass
                }`}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'density'}
                data-tour-id="task-view-mode-toggle"
              >
                <ToolIcon icon={currentDensityOption.icon} />
                {isCompact && (
                  <span
                    className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-1 ring-white dark:ring-gray-800"
                    aria-hidden="true"
                  />
                )}
              </button>
            </KanbanChromeTooltip>
            {openMenu === 'density' && (
              <div
                role="menu"
                className="absolute left-0 top-full z-[60] mt-1 min-w-[9.5rem] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg overflow-hidden"
              >
                {densityOptions.map((option) =>
                  renderMenuItem(
                    option.mode,
                    taskViewMode === option.mode,
                    option.icon,
                    option.label,
                    option.shortcut,
                    () => {
                      onTaskViewModeChange(option.mode);
                      setOpenMenu(null);
                    }
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
