import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronLeft, ChevronRight, Trash2, GripVertical, HelpCircle } from 'lucide-react';
import { Board, Task } from '../types';
import { useSortable, SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DndContext, DragEndEvent, useDroppable } from '@dnd-kit/core';
import { 
  BoardDropState, 
  shouldShowDropReady, 
  canMoveTaskToBoard, 
  getBoardTabDropClasses 
} from '../utils/crossBoardDragUtils';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import { BOARD_TITLE_MAX_LENGTH } from '../constants/appConstants';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import {
  TASK_COUNT_PILL_BASE,
  formatTaskCountPill,
  taskCountPillToneClass,
  taskCountPillWeightClass,
} from '../utils/taskCountPill';
import { getWipStatus, hasWipLimit } from '../utils/kanbanFlowUtils';
import { formatEffortDisplay, parseEffortUnit } from '../utils/taskUtils';
import {
  showBoardTabEffort,
  showBoardTabTaskCounts,
} from '../utils/kanbanChromeVisibility';
import { getBoardTrashCount } from '../api';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

function parseBoardWipLimitValue(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function renderBoardTaskCountPill({
  displayCount,
  wipCount,
  wipLimit,
  hasActiveFilters,
  compact = false,
}: {
  displayCount: number;
  wipCount: number;
  wipLimit?: number | null;
  hasActiveFilters: boolean;
  compact?: boolean;
}) {
  const showMeter = hasWipLimit(wipLimit);
  if (!showMeter && displayCount <= 0) return null;
  const status = getWipStatus(wipCount, wipLimit);
  const meterCount = hasActiveFilters ? displayCount : wipCount;
  const label = showMeter
    ? `${formatTaskCountPill(meterCount)} / ${wipLimit}`
    : formatTaskCountPill(displayCount);
  const sizerLabel = showMeter
    ? `${formatTaskCountPill(Math.max(displayCount, wipCount, 99))} / ${wipLimit}`
    : formatTaskCountPill(displayCount);
  const pillClass = `${
    compact
      ? 'rounded-full px-1 py-0.5 text-center text-[0.65rem] leading-none tabular-nums whitespace-nowrap'
      : `${TASK_COUNT_PILL_BASE}`
  } ${taskCountPillToneClass(status)} ${taskCountPillWeightClass(hasActiveFilters)}`;
  return { label, sizerLabel, pillClass, showMeter, meterCount };
}

function boardTaskCountTooltip(
  t: (key: string, options?: Record<string, unknown>) => string,
  pill: { showMeter: boolean; meterCount: number },
  wipLimit?: number | null
): string {
  if (pill.showMeter) {
    return t('boardTabs.wipMeterTooltip', {
      count: pill.meterCount,
      limit: wipLimit,
    });
  }
  return t('boardTabs.taskCount');
}

const BOARD_TAB_ADMIN_CHROME_DELAY_MS = 1000;

/** Delay drag handle + trash on board tabs so quick clicks select the tab. */
function useBoardTabAdminChromeReveal(
  stripHovered: boolean,
  isEditing: boolean,
  delayMs = BOARD_TAB_ADMIN_CHROME_DELAY_MS
) {
  const [tabHovered, setTabHovered] = useState(false);
  const [delayedReveal, setDelayedReveal] = useState(false);
  const [pinnedReveal, setPinnedReveal] = useState(false);

  const dismissChrome = () => {
    setTabHovered(false);
    setDelayedReveal(false);
    setPinnedReveal(false);
  };

  const dismissChromeUnlessEditing = () => {
    if (isEditing) return;
    dismissChrome();
  };

  useEffect(() => {
    if (!stripHovered && !isEditing) {
      dismissChrome();
    }
  }, [stripHovered, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    setPinnedReveal(true);
  }, [isEditing]);

  useEffect(() => {
    if (isEditing) return;
    if (!stripHovered || !tabHovered) {
      setDelayedReveal(false);
      setPinnedReveal(false);
      if (!stripHovered) {
        setTabHovered(false);
      }
    }
  }, [isEditing, stripHovered, tabHovered]);

  useEffect(() => {
    if (!stripHovered || !tabHovered || pinnedReveal || isEditing) {
      if (!pinnedReveal && !isEditing) {
        setDelayedReveal(false);
      }
      return;
    }
    const timer = window.setTimeout(() => setDelayedReveal(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [stripHovered, tabHovered, pinnedReveal, isEditing, delayMs]);

  const adminChromeVisible =
    isEditing || (stripHovered && tabHovered && (delayedReveal || pinnedReveal));

  return {
    showDragHandle: adminChromeVisible,
    showTrash: adminChromeVisible,
    revealChrome: () => setPinnedReveal(true),
    tabSurfaceProps: {
      onMouseEnter: () => setTabHovered(true),
      onMouseLeave: dismissChromeUnlessEditing,
    },
  };
}

function renderBoardEffortPill(effort: number, siteSettings?: { [key: string]: string }, tooltipLabel?: string) {
  if (!(effort > 0)) return null;
  const display = formatEffortDisplay(effort, parseEffortUnit(siteSettings));
  const label = tooltipLabel || display;
  return (
    <KanbanChromeTooltip label={label} wrapperClassName="relative inline-flex shrink-0 items-center">
      <span
        className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-violet-100 px-1.5 py-0.5 text-center text-[0.65rem] font-medium leading-none tabular-nums text-violet-700 dark:bg-violet-900/50 dark:text-violet-200"
        aria-label={label}
      >
        {display}
      </span>
    </KanbanChromeTooltip>
  );
}

/** Inactive tab — sits on the track */
const tabTrackInactive =
  'rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors duration-150 hover:bg-white/70 dark:hover:bg-gray-700/60 hover:text-gray-900 dark:hover:text-gray-100';
/** Selected tab — raised chip */
const tabTrackActive =
  'rounded-lg px-2 py-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 shadow-sm ring-1 ring-gray-200/90 dark:ring-gray-600/90 transition-shadow duration-150';

function AddBoardInTrackButton({ onAddBoard }: { onAddBoard: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex shrink-0 items-stretch border-l border-gray-200/90 py-1 pl-0.5 pr-1 dark:border-gray-700/90">
      <KanbanChromeTooltip label={t('boardTabs.addNewBoard')}>
        <button
          type="button"
          onClick={onAddBoard}
          aria-label={t('boardTabs.addNewBoard')}
          data-tour-id="add-board-button"
          className="flex min-h-[2.125rem] w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-blue-300"
        >
          <Plus size={16} strokeWidth={2.25} />
        </button>
      </KanbanChromeTooltip>
    </div>
  );
}

interface BoardTabsProps {
  boards: Board[];
  selectedBoard: string | null;
  onSelectBoard: (boardId: string) => void;
  onAddBoard: () => void;
  onEditBoard: (boardId: string, newName: string, wipLimit?: number | null) => void | Promise<void>;
  onRemoveBoard: (boardId: string) => void;
  onReorderBoards: (boardId: string, newPosition: number) => void;
  isAdmin?: boolean;
  getFilteredTaskCount?: (board: Board) => number;
  /** Active-work count for board WIP (excludes finished/archived). */
  getBoardWipTaskCount?: (board: Board) => number;
  /** Filtered active-work effort (excludes finished/archived); pill hidden when 0. */
  getBoardWipEffort?: (board: Board) => number;
  /** Unfiltered board total; delete confirmations must not report only visible tasks. */
  getTotalTaskCount?: (board: Board) => number;
  hasActiveFilters?: boolean;
  // Cross-board drag props
  draggedTask?: Task | null;
  onTaskDropOnBoard?: (taskId: string, targetBoardId: string) => Promise<void>;
  // Site settings for prefix display
  siteSettings?: { [key: string]: string };
  /** Soft-deleted task count for the selected board (Trash badge). */
  trashCount?: number;
  trashOpen?: boolean;
  onToggleTrash?: () => void;
}

// Droppable Board Tab Component for cross-board task drops
const DroppableBoardTab: React.FC<{
  board: Board;
  isSelected: boolean;
  onSelect: () => void;
  taskCount?: number;
  wipCount?: number;
  effort?: number;
  effortTooltip?: string;
  siteSettings?: { [key: string]: string };
  hasActiveFilters: boolean;
  draggedTask: Task | null;
  selectedBoardId: string | null;
  boardDropState: BoardDropState;
  onHoverStart: (boardId: string) => void;
  onHoverEnd: () => void;
}> = ({ 
  board, 
  isSelected, 
  onSelect, 
  taskCount, 
  wipCount,
  effort = 0,
  effortTooltip,
  siteSettings,
  hasActiveFilters, 
  draggedTask,
  selectedBoardId,
  boardDropState,
  onHoverStart,
  onHoverEnd
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `board-${board.id}`,
    data: {
      type: 'board',
      boardId: board.id,
    },
  });

  const isDragActive = draggedTask !== null;
  
  // Get current mouse position to check if we're in the actual tab area
  const [currentMouseY, setCurrentMouseY] = React.useState(0);
  
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCurrentMouseY(e.clientY);
    };
    
    if (isDragActive) {
      document.addEventListener('mousemove', handleMouseMove);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragActive]);
  
  // Check if mouse is actually in tab area (get tab bounds dynamically)
  const isMouseInTabArea = React.useMemo(() => {
    if (!isDragActive) return true; // Allow normal behavior when not dragging
    
    // Find the tab container to get bounds
    const tabContainer =
      document.querySelector('.board-tabs-scroll') ||
      document.querySelector('[data-board-tabs-scroll]') ||
      document.querySelector('.flex.items-center.space-x-1.overflow-x-auto') ||
      document.querySelector('[class*="board-tabs"]') ||
      document.querySelector('button[id^="board-"]')?.parentElement;
    
    if (tabContainer) {
      const rect = tabContainer.getBoundingClientRect();
      const tabTop = rect.top - 30; // Same 30px extension as in SimpleDragDropManager
      const tabBottom = rect.bottom;
      return currentMouseY >= tabTop && currentMouseY <= tabBottom;
    }
    
    return false; // If we can't find tab container, don't allow hover
  }, [isDragActive, currentMouseY]);
  
  // Only allow hovering if mouse is actually in tab area
  const isHovering = isOver && isDragActive && isMouseInTabArea;
  const isDropReady = shouldShowDropReady(
    board.id,
    boardDropState.hoveredBoardId,
    boardDropState.hoverStartTime,
    Date.now()
  );

  // Removed CSS hover state to prevent re-rendering issues

  const canDrop = draggedTask && canMoveTaskToBoard(draggedTask, board, selectedBoardId || '');

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    if (isHovering && canDrop) {
      // Only call if we're not already hovering this board
      if (boardDropState.hoveredBoardId !== board.id) {
        onHoverStart(board.id);
      }
    } else if (!isHovering) {
      // Only call if we were hovering this board
      if (boardDropState.hoveredBoardId === board.id) {
        // Short delay to prevent rapid switching between adjacent tabs
        timeoutId = setTimeout(() => {
          onHoverEnd();
        }, 100);
      }
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isHovering, canDrop, board.id, boardDropState.hoveredBoardId, onHoverStart, onHoverEnd]);

  // Handle click during drop-ready state
  const handleClick = (e: React.MouseEvent) => {
    if (isDragActive && canDrop) {
      // Completely disable click interactions during task drag
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onSelect();
  };

  const { t } = useTranslation('common');
  const tabClasses = getBoardTabDropClasses(isDropReady && canDrop, isHovering && canDrop, isDragActive);

  return (
    <KanbanChromeTooltip
      label={`${board.title}${isDragActive && canDrop ? ` (${t('boardTabs.dropTaskHere')})` : ''}`}
      wrapperClassName="relative inline-flex"
      delayMs={isDragActive ? 0 : undefined}
    >
      <div
        onClick={handleClick}
        style={{
          userSelect: isDragActive && canDrop ? 'none' : 'auto'
        }}
        className={`
          cursor-pointer flex items-center gap-1 whitespace-nowrap min-w-[5.5rem] justify-center
          ${isSelected ? tabTrackActive : tabTrackInactive}
          ${isDragActive && canDrop && (isHovering || isDropReady) ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-950/45 scale-[1.02] shadow-md' : ''}
          ${tabClasses}
          transition-all duration-200
          relative
        `}
      >
        {/* VERY SMALL droppable area - only the inner content */}
        <div
          ref={setNodeRef}
          className="absolute inset-2 pointer-events-none"
          style={{ pointerEvents: isDragActive && canDrop ? 'auto' : 'none' }}
        />

        {/* Always show normal tab content - visual feedback comes from border/glow effects */}
        <div className={`flex items-center gap-1 ${isDragActive && canDrop ? 'pointer-events-none' : ''}`}>
          {(() => {
            const pill = renderBoardTaskCountPill({
              displayCount: taskCount ?? 0,
              wipCount: wipCount ?? taskCount ?? 0,
              wipLimit: board.wip_limit,
              hasActiveFilters,
            });
            if (!pill) return null;
            const tip = boardTaskCountTooltip(t, pill, board.wip_limit);
            return (
              <KanbanChromeTooltip label={tip} wrapperClassName="relative inline-flex shrink-0">
                <span className={pill.pillClass} aria-label={tip}>{pill.label}</span>
              </KanbanChromeTooltip>
            );
          })()}
          {renderBoardEffortPill(effort, siteSettings, effortTooltip)}
          <span className="truncate max-w-[150px] pointer-events-none">{board.title}</span>
        </div>
      </div>
    </KanbanChromeTooltip>
  );
};

// Sortable Board Tab Component (Admin only)
const SortableBoardTab: React.FC<{
  board: Board;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  canDelete: boolean;
  showDeleteConfirm: string | null;
  onConfirmDelete: (boardId: string) => void;
  onCancelDelete: () => void;
  taskCount?: number;
  /** Unfiltered active-work count for WIP coloring (excludes finished/archived). */
  wipCount?: number;
  /** Active-work effort (excludes finished/archived), same scope as board WIP. */
  effort?: number;
  effortTooltip?: string;
  siteSettings?: { [key: string]: string };
  /** Unfiltered live total shown on the tab (filters can hide cards). */
  totalTaskCount?: number;
  /** Live + trash tasks that board delete will take with it. */
  deleteConfirmTaskCount?: number;
  showTaskCount?: boolean;
  hasActiveFilters?: boolean;
  /** Visual cue while the edit dropdown is open for this tab. */
  isEditing?: boolean;
  boardTabsStripHovered?: boolean;
}> = ({ board, isSelected, onSelect, onEdit, onRemove, canDelete, showDeleteConfirm, onConfirmDelete, onCancelDelete, taskCount, wipCount, effort = 0, effortTooltip, siteSettings, totalTaskCount, deleteConfirmTaskCount, showTaskCount, hasActiveFilters = false, isEditing = false, boardTabsStripHovered = false }) => {
  const [deleteButtonRef, setDeleteButtonRef] = useState<HTMLButtonElement | null>(null);
  const {
    showDragHandle,
    showTrash,
    revealChrome,
    tabSurfaceProps,
  } = useBoardTabAdminChromeReveal(boardTabsStripHovered, isEditing);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });

  const { t } = useTranslation('common');
  const dragHandleActive = showDragHandle || isDragging;
  const taskCountPill = showTaskCount
    ? renderBoardTaskCountPill({
        displayCount: taskCount ?? 0,
        wipCount: wipCount ?? taskCount ?? 0,
        wipLimit: board.wip_limit,
        hasActiveFilters,
        compact: true,
      })
    : null;
  const handleTooltip =
    dragHandleActive
      ? t('boardTabs.dragToReorder')
      : taskCountPill
        ? boardTaskCountTooltip(t, taskCountPill, board.wip_limit)
        : t('boardTabs.dragToReorder');
  // Translate only: CSS.Transform also applies dnd-kit's scaleX/scaleY, which stretches
  // the label because board tabs have different widths
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        role="button"
        tabIndex={0}
        data-board-tab-id={board.id}
        onClick={onSelect}
        onDoubleClick={() => {
          revealChrome();
          onEdit();
        }}
        onMouseDown={(e) => {
          // Selecting a tab must not leave keyboard focus stuck on it (that kept admin chrome visible).
          if (e.button === 0) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        {...tabSurfaceProps}
        className={`
          relative inline-flex shrink-0 cursor-pointer items-center gap-1 !px-1.5
          ${isSelected ? tabTrackActive : tabTrackInactive}
          ${isEditing ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}
          ${isDragging ? 'opacity-60 shadow-lg ring-2 ring-gray-300/50 dark:ring-gray-500/40' : ''}
        `}
      >
        {/* Task count pill until 1s tab hover reveals drag handle + trash. */}
        <KanbanChromeTooltip label={handleTooltip} wrapperClassName="relative z-[2] shrink-0">
          <div
            className={`relative flex h-6 min-w-6 items-center justify-center rounded-md px-0 text-gray-400 transition-colors ${
              dragHandleActive
                ? 'cursor-grab touch-none hover:bg-gray-200/80 hover:text-gray-600 active:cursor-grabbing dark:hover:bg-gray-600/50 dark:hover:text-gray-300'
                : 'pointer-events-none'
            }`}
            {...(dragHandleActive ? attributes : {})}
            {...(dragHandleActive ? listeners : {})}
            onClick={(e) => {
              if (dragHandleActive) e.stopPropagation();
            }}
          >
            {taskCountPill ? (
              <>
                <span
                  className="invisible px-1 py-0.5 text-[0.65rem] leading-none tabular-nums font-bold whitespace-nowrap"
                  aria-hidden
                >
                  {taskCountPill.sizerLabel}
                </span>
                <span
                  className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity ${
                    dragHandleActive ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <span className={taskCountPill.pillClass} aria-label={boardTaskCountTooltip(t, taskCountPill, board.wip_limit)}>
                    {taskCountPill.label}
                  </span>
                </span>
                <GripVertical
                  className={`pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 transition-opacity ${
                    dragHandleActive ? 'opacity-100' : 'opacity-0'
                  }`}
                  aria-hidden
                />
              </>
            ) : (
              <GripVertical
                className={`h-3.5 w-3.5 transition-opacity ${
                  dragHandleActive ? 'opacity-100' : 'opacity-0'
                }`}
                aria-hidden
              />
            )}
          </div>
        </KanbanChromeTooltip>

        {/* Title-only select/edit tip — avoids showing it over pills, drag handle, or when already selected */}
        <KanbanChromeTooltip
          label={
            isSelected
              ? t('boardTabs.doubleClickToEdit')
              : t('boardTabs.clickToSelectDoubleClickToEdit')
          }
          wrapperClassName="min-w-0"
        >
          <span className="truncate max-w-[10rem]">{board.title}</span>
        </KanbanChromeTooltip>

        {/* Effort + trash share a tight cluster (column-style density) */}
        <div className="flex shrink-0 items-center gap-0.5">
          {renderBoardEffortPill(effort, siteSettings, effortTooltip)}
          {canDelete && (
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                showTrash ? '' : 'pointer-events-none'
              }`}
            >
              <div
                className={`flex items-center justify-center transition-opacity duration-200 ease-out ${
                  showTrash ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <KanbanChromeTooltip label={t('boardTabs.deleteBoard')}>
                  <button
                    type="button"
                    ref={setDeleteButtonRef}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove();
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md p-0 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </KanbanChromeTooltip>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Menu - Using portal to escape stacking context */}
      {canDelete && showDeleteConfirm === board.id && deleteButtonRef && createPortal(
        <div 
          className="delete-confirmation fixed z-[9999] min-w-[160px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-600 dark:bg-gray-800"
          role="dialog"
          aria-modal="true"
          style={{
            top: `${deleteButtonRef.getBoundingClientRect().bottom + 5}px`,
            left: `${deleteButtonRef.getBoundingClientRect().left - 120}px`,
          }}
        >
          <div className="mb-2 text-sm text-gray-700 dark:text-gray-200">
            <div className="mb-1 truncate font-semibold text-gray-900 dark:text-gray-100">
              {board.title}
            </div>
            {(() => {
              const deletedTaskCount = deleteConfirmTaskCount ?? totalTaskCount ?? taskCount ?? 0;
              return deletedTaskCount > 0
                ? t('boardTabs.moveBoardToTrashAndTasks', { count: deletedTaskCount })
                : t('boardTabs.moveBoardToTrash');
            })()}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onConfirmDelete(board.id)}
              className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              {t('buttons.yes')}
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded-md bg-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-100 dark:hover:bg-gray-500"
            >
              {t('buttons.no')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// Regular Board Tab Component (Non-admin users)
const RegularBoardTab: React.FC<{
  board: Board;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  canDelete: boolean;
  taskCount?: number;
  wipCount?: number;
  effort?: number;
  effortTooltip?: string;
  siteSettings?: { [key: string]: string };
  showTaskCount?: boolean;
  hasActiveFilters?: boolean;
}> = ({ board, isSelected, onSelect, onEdit, onRemove, canDelete, taskCount, wipCount, effort = 0, effortTooltip, siteSettings, showTaskCount, hasActiveFilters = false }) => {
  const { t } = useTranslation('common');
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onSelect}
        className={`${isSelected ? tabTrackActive : tabTrackInactive} w-full text-left`}
      >
        <div className="flex items-center gap-1">
          {showTaskCount && (() => {
            const pill = renderBoardTaskCountPill({
              displayCount: taskCount ?? 0,
              wipCount: wipCount ?? taskCount ?? 0,
              wipLimit: board.wip_limit,
              hasActiveFilters,
            });
            if (!pill) return null;
            const tip = boardTaskCountTooltip(t, pill, board.wip_limit);
            return (
              <KanbanChromeTooltip label={tip} wrapperClassName="relative inline-flex shrink-0">
                <span className={`shrink-0 ${pill.pillClass}`} aria-label={tip}>{pill.label}</span>
              </KanbanChromeTooltip>
            );
          })()}
          <KanbanChromeTooltip
            label={isSelected ? '' : t('boardTabs.clickToSelectBoard')}
            wrapperClassName="min-w-0"
          >
            <span className="truncate max-w-[11rem]">{board.title}</span>
          </KanbanChromeTooltip>
          {renderBoardEffortPill(effort, siteSettings, effortTooltip)}
        </div>
      </button>
      
      {/* Delete Button - Admin Only */}
      {/* Regular users cannot delete boards */}
    </div>
  );
};

export default function BoardTabs({
  boards,
  selectedBoard,
  onSelectBoard,
  onAddBoard,
  onEditBoard,
  onRemoveBoard,
  onReorderBoards,
  isAdmin = false,
  getFilteredTaskCount,
  getBoardWipTaskCount,
  getBoardWipEffort,
  getTotalTaskCount,
  hasActiveFilters = false,
  draggedTask,
  onTaskDropOnBoard,
  siteSettings,
  trashCount = 0,
  trashOpen = false,
  onToggleTrash,
}: BoardTabsProps) {
  const { t } = useTranslation('common');
  const { t: tTasks } = useTranslation('tasks');
  const isMobile = useIsMobileViewport();
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [editingWipLimit, setEditingWipLimit] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editFormRef = useRef<HTMLFormElement>(null);
  const editingBoardIdRef = useRef<string | null>(null);
  const editingTitleRef = useRef('');
  const editingWipLimitRef = useRef('');
  const isSubmittingRef = useRef(false);
  const [editMenuPosition, setEditMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deleteConfirmTaskCount, setDeleteConfirmTaskCount] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  /** When true, both chevron slots stay mounted so show/hide never resizes the track. */
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const [boardTabsStripHovered, setBoardTabsStripHovered] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  
  // Cross-board drag state
  const [boardDropState, setBoardDropState] = useState<BoardDropState>({
    hoveredBoardId: null,
    hoverStartTime: null,
    isDropReady: false
  });

  // Handle board hover for cross-board drops
  const handleBoardHoverStart = useCallback((boardId: string) => {
    setBoardDropState(prev => {
      // Prevent unnecessary state updates
      if (prev.hoveredBoardId === boardId) {
        return prev;
      }
      return {
        hoveredBoardId: boardId,
        hoverStartTime: Date.now(),
        isDropReady: false
      };
    });
  }, []);

  const handleBoardHoverEnd = useCallback(() => {
    setBoardDropState(prev => {
      // Prevent unnecessary state updates
      if (prev.hoveredBoardId === null) {
        return prev;
      }
      return {
        hoveredBoardId: null,
        hoverStartTime: null,
        isDropReady: false
      };
    });
  }, []);

  // Check scroll state
  const checkScrollState = () => {
    if (!tabsContainerRef.current) return;
    
    const container = tabsContainerRef.current;
    const maxScroll = container.scrollWidth - container.clientWidth;
    const overflowing = maxScroll > 1;
    setTabsOverflow(overflowing);
    setCanScrollLeft(overflowing && container.scrollLeft > 1);
    setCanScrollRight(overflowing && container.scrollLeft < maxScroll - 1);
  };

  // Scroll functions
  const scrollLeft = () => {
    if (!tabsContainerRef.current) return;
    tabsContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' });
  };

  const scrollRight = () => {
    if (!tabsContainerRef.current) return;
    tabsContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' });
  };

  // Update scroll state on mount and when boards change or container resizes
  useEffect(() => {
    // Check scroll state after a short delay to ensure layout is complete
    const timeoutId = setTimeout(() => {
      checkScrollState();
    }, 100);
    
    const container = tabsContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScrollState);
      const resizeObserver = new ResizeObserver(() => {
        // Also delay the resize check
        setTimeout(checkScrollState, 50);
      });
      resizeObserver.observe(container);
      
      return () => {
        clearTimeout(timeoutId);
        container.removeEventListener('scroll', checkScrollState);
        resizeObserver.disconnect();
      };
    }
    
    return () => clearTimeout(timeoutId);
  }, [boards]);

  // Handle drag end for board reordering (Admin only)
  const handleDragEnd = (event: DragEndEvent) => {
    if (!isAdmin) return;
    
    const { active, over } = event;
    
    if (active.id !== over?.id) {
      const oldIndex = boards.findIndex(board => board.id === active.id);
      const newIndex = boards.findIndex(board => board.id === over?.id);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorderBoards(active.id as string, newIndex);
      }
    }
  };

  // Board selection is now handled by the main App.tsx logic
  // This effect has been removed to prevent automatic board selection

  if (boards.length === 0) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50/80 px-4 py-3 dark:border-gray-600 dark:bg-gray-800/40">
        <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('boardTabs.noBoards')}</h2>
        {isAdmin && (
          <KanbanChromeTooltip label={t('boardTabs.addBoard')}>
            <button
              type="button"
              onClick={onAddBoard}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-400 dark:hover:text-blue-300"
              data-tour-id="add-board-button"
            >
              <Plus size={16} strokeWidth={2} />
              <span className="hidden sm:inline">{t('boardTabs.newBoard')}</span>
            </button>
          </KanbanChromeTooltip>
        )}
      </div>
    );
  }

  const handleEditClick = (boardId: string) => {
    // Only admins can edit board title / WIP
    if (!isAdmin) return;
    
    const board = boards.find(b => b.id === boardId);
    if (board) {
      if (selectedBoard !== boardId) {
        onSelectBoard(boardId);
      }
      const nextTitle = board.title;
      const nextWip =
        board.wip_limit != null && Number(board.wip_limit) > 0
          ? String(board.wip_limit)
          : '';
      setEditingBoardId(boardId);
      setEditingTitle(nextTitle);
      setEditingWipLimit(nextWip);
      editingBoardIdRef.current = boardId;
      editingTitleRef.current = nextTitle;
      editingWipLimitRef.current = nextWip;
    }
  };

  const cancelBoardEdit = () => {
    setEditingBoardId(null);
    setEditingTitle('');
    setEditingWipLimit('');
    setEditMenuPosition(null);
    editingBoardIdRef.current = null;
    editingTitleRef.current = '';
    editingWipLimitRef.current = '';
  };

  const saveBoardEdit = async () => {
    const boardId = editingBoardIdRef.current;
    const title = editingTitleRef.current.trim();
    if (!boardId || !title || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await onEditBoard(boardId, title, parseBoardWipLimitValue(editingWipLimitRef.current));
      cancelBoardEdit();
    } catch (error) {
      console.error('Failed to edit board:', error);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void saveBoardEdit();
  };

  // Keep edit dropdown under the tab without growing the tab bar
  useLayoutEffect(() => {
    if (!editingBoardId) {
      setEditMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = document.querySelector(
        `[data-board-tab-id="${editingBoardId}"]`
      ) as HTMLElement | null;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 220;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - menuWidth - 8)
      );
      setEditMenuPosition({ top: rect.bottom + 4, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [editingBoardId, boards, selectedBoard]);

  // Enter accepts; click outside saves (same as column edit).
  useEffect(() => {
    if (!editingBoardId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (editFormRef.current?.contains(target)) return;
      const anchor = document.querySelector(
        `[data-board-tab-id="${editingBoardId}"]`
      );
      // Double-click that opened the menu, or interacting with the same tab, should not auto-save yet
      if (anchor?.contains(target)) return;
      void saveBoardEdit();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [editingBoardId, onEditBoard]);

  const handleRemoveClick = (boardId: string) => {
    if (boards.length <= 1) return;
    const board = boards.find(b => b.id === boardId);
    const liveCount = board
      ? (getTotalTaskCount
          ? getTotalTaskCount(board)
          : Object.values(board.columns || {}).reduce(
              (sum, column) => sum + (column.tasks?.length || 0),
              0
            ))
      : 0;

    void (async () => {
      let trashCountForBoard = 0;
      try {
        trashCountForBoard = await getBoardTrashCount(boardId);
      } catch {
        trashCountForBoard = 0;
      }
      const total = liveCount + trashCountForBoard;
      if (total === 0) {
        confirmDeleteBoard(boardId);
        return;
      }
      setDeleteConfirmTaskCount(total);
      setShowDeleteConfirm(boardId);
    })();
  };

  const confirmDeleteBoard = async (boardId: string) => {
    try {
      onRemoveBoard(boardId);
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Failed to delete board:', error);
    }
  };

  const cancelDeleteBoard = () => {
    setShowDeleteConfirm(null);
  };

  // Close confirmation menu when clicking outside
  useEffect(() => {
    if (!showDeleteConfirm) {
      // If no confirmation is showing, don't add listeners but still call useEffect properly
      return;
    }
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Don't close if clicking on the delete confirmation menu or its children
      if (target.closest('.delete-confirmation')) {
        return;
      }
      setShowDeleteConfirm(null);
    };

    // Use a small delay to avoid interfering with the initial click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDeleteConfirm]);

  useEscapeDismiss(cancelDeleteBoard, { enabled: showDeleteConfirm != null });

  useEscapeDismiss(cancelBoardEdit, { enabled: editingBoardId != null });

  const boardEffortTooltip = (effort: number) =>
    t('boardTabs.totalEffortTooltip', {
      display: formatEffortDisplay(effort, parseEffortUnit(siteSettings)),
    });

  const allowBoardTabTaskCounts = showBoardTabTaskCounts(siteSettings);
  const allowBoardTabEffort = showBoardTabEffort(siteSettings);

  const effortPropsFor = (board: Board) => {
    if (!allowBoardTabEffort) {
      return { effort: 0, effortTooltip: undefined, siteSettings };
    }
    const effort = getBoardWipEffort ? getBoardWipEffort(board) : 0;
    return {
      effort,
      effortTooltip: boardEffortTooltip(effort),
      siteSettings,
    };
  };

  const renderBoardEditDropdown = () => {
    if (!editingBoardId || !editMenuPosition) return null;
    return createPortal(
      <form
        ref={editFormRef}
        onSubmit={handleTitleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={t('boardTabs.editBoard')}
        className="fixed z-[9999] w-[13.75rem] space-y-2 rounded-lg border border-gray-200 bg-white p-2.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
        style={{ top: editMenuPosition.top, left: editMenuPosition.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelBoardEdit();
          }
        }}
      >
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('buttons.save')}
        </button>
        <input
          type="text"
          value={editingTitle}
          onChange={(e) => {
            setEditingTitle(e.target.value);
            editingTitleRef.current = e.target.value;
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          maxLength={BOARD_TITLE_MAX_LENGTH}
          autoFocus
          disabled={isSubmitting}
          aria-label={t('boardTabs.boardTitle')}
        />
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={`board-wip-${editingBoardId}`}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300"
          >
            {tTasks('column.wipLimit')}
            <KanbanChromeTooltip label={t('boardTabs.wipLimitHint')}>
              <span
                className="inline-flex cursor-help text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label={t('boardTabs.wipLimitHint')}
              >
                <HelpCircle size={12} />
              </span>
            </KanbanChromeTooltip>
          </label>
          <input
            id={`board-wip-${editingBoardId}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={editingWipLimit}
            onChange={(e) => {
              setEditingWipLimit(e.target.value);
              editingWipLimitRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveBoardEdit();
              }
            }}
            className="w-[2.75rem] shrink-0 rounded-md border border-gray-300 bg-white px-1.5 py-1 text-center text-xs text-gray-900 [appearance:textfield] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            disabled={isSubmitting}
          />
          {!!String(editingWipLimit).trim() && (
            <KanbanChromeTooltip label={tTasks('column.clearWipLimit')}>
              <button
                type="button"
                onClick={() => {
                  setEditingWipLimit('');
                  editingWipLimitRef.current = '';
                }}
                disabled={isSubmitting}
                className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-red-600 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-red-400"
                aria-label={tTasks('column.clearWipLimit')}
              >
                <Trash2 size={12} />
              </button>
            </KanbanChromeTooltip>
          )}
        </div>
      </form>,
      document.body
    );
  };

  // Get the current board's project identifier
  const currentBoard = boards.find(board => board.id === selectedBoard);
  const currentProject = currentBoard?.project;
  const showTrashButton = trashCount > 0 && Boolean(onToggleTrash);
  // Desktop: keep the Progression-width slot so the tab strip does not jump when trash appears.
  // Mobile: use the full strip; only reserve space when the trash control is actually shown.
  const showActionColumn = isMobile ? showTrashButton : Boolean(onToggleTrash);

  return (
    <div className="mb-6">
      {/* Match Kanban toolbar columns: tab strip = Tools + Team Members; actions = Progression width */}
      <div className="flex items-center gap-4">
        <div
          className="flex min-w-0 flex-1 items-center gap-1"
          data-tour-id="board-tabs"
          onMouseEnter={() => setBoardTabsStripHovered(true)}
          onMouseLeave={() => setBoardTabsStripHovered(false)}
        >
          {/* Reserve both chevron slots whenever tabs overflow — toggling arrows must not change track width */}
          {tabsOverflow && (
            <KanbanChromeTooltip label={t('boardTabs.scrollLeft')}>
              <button
                type="button"
                onClick={scrollLeft}
                disabled={!canScrollLeft}
                aria-hidden={!canScrollLeft}
                tabIndex={canScrollLeft ? 0 : -1}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-transparent text-gray-500 transition-opacity hover:border-gray-200 hover:bg-white hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-100 ${
                  canScrollLeft ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <ChevronLeft size={18} strokeWidth={2} />
              </button>
            </KanbanChromeTooltip>
          )}

          <div className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-xl border border-gray-200/90 bg-gray-100/55 dark:border-gray-700/90 dark:bg-gray-800/45">
          <div
            ref={tabsContainerRef}
            data-board-tabs-scroll
            className="board-tabs-scroll min-w-0 flex-1 overflow-x-auto scroll-smooth px-1 py-1 hide-scrollbar"
          >
            {isAdmin ? (
              // Admin view with drag and drop (only when not dragging tasks)
              draggedTask ? (
                // When dragging a task, render tabs without board DndContext to allow cross-board drops
                <div className="flex w-max flex-shrink-0 items-center gap-1">
                  {boards.map(board => (
                    <div key={board.id} className="shrink-0">
                      <DroppableBoardTab
                          board={board}
                          isSelected={selectedBoard === board.id}
                          onSelect={() => onSelectBoard(board.id)}
                          taskCount={allowBoardTabTaskCounts && getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
                          wipCount={allowBoardTabTaskCounts && getBoardWipTaskCount ? getBoardWipTaskCount(board) : 0}
                          {...effortPropsFor(board)}
                          hasActiveFilters={hasActiveFilters}
                          draggedTask={draggedTask}
                          selectedBoardId={selectedBoard}
                          boardDropState={boardDropState}
                          onHoverStart={handleBoardHoverStart}
                          onHoverEnd={handleBoardHoverEnd}
                        />
                    </div>
                  ))}
                </div>
              ) : !draggedTask ? (
                // Normal board management with DndContext (only when not dragging a task)
                <DndContext onDragEnd={handleDragEnd}>
                  <SortableContext items={boards.filter(board => board && board.id).map(board => board.id)} strategy={horizontalListSortingStrategy}>
                    <div className="flex w-max flex-shrink-0 items-center gap-1">
                  {boards.map(board => (
                  <div key={board.id} className="shrink-0">
                    {draggedTask ? (
                      // When dragging a task, use droppable tab for cross-board drops
                      <DroppableBoardTab
                        board={board}
                        isSelected={selectedBoard === board.id}
                        onSelect={() => onSelectBoard(board.id)}
                        taskCount={allowBoardTabTaskCounts && getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
                        wipCount={allowBoardTabTaskCounts && getBoardWipTaskCount ? getBoardWipTaskCount(board) : 0}
                        {...effortPropsFor(board)}
                        hasActiveFilters={hasActiveFilters}
                        draggedTask={draggedTask}
                        selectedBoardId={selectedBoard}
                        boardDropState={boardDropState}
                        onHoverStart={handleBoardHoverStart}
                        onHoverEnd={handleBoardHoverEnd}
                      />
                    ) : (
                      // Normal sortable tab button
                      <SortableBoardTab
                        board={board}
                        isSelected={selectedBoard === board.id}
                        onSelect={() => onSelectBoard(board.id)}
                        onEdit={() => handleEditClick(board.id)}
                        onRemove={() => handleRemoveClick(board.id)}
                        canDelete={boards.length > 1}
                        showDeleteConfirm={showDeleteConfirm}
                        onConfirmDelete={confirmDeleteBoard}
                        onCancelDelete={cancelDeleteBoard}
                        taskCount={allowBoardTabTaskCounts && getFilteredTaskCount ? getFilteredTaskCount(board) : undefined}
                        wipCount={allowBoardTabTaskCounts && getBoardWipTaskCount ? getBoardWipTaskCount(board) : undefined}
                        {...effortPropsFor(board)}
                        totalTaskCount={getTotalTaskCount ? getTotalTaskCount(board) : undefined}
                        deleteConfirmTaskCount={deleteConfirmTaskCount}
                        showTaskCount={allowBoardTabTaskCounts}
                        hasActiveFilters={hasActiveFilters}
                        isEditing={editingBoardId === board.id}
                        boardTabsStripHovered={boardTabsStripHovered}
                      />
                    )}
                  </div>
                ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="flex w-max flex-shrink-0 items-center gap-1">
                  {boards.map(board => (
                    <div key={board.id} className="shrink-0">
                      <DroppableBoardTab
                          board={board}
                          isSelected={selectedBoard === board.id}
                          taskCount={allowBoardTabTaskCounts && getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
                          wipCount={allowBoardTabTaskCounts && getBoardWipTaskCount ? getBoardWipTaskCount(board) : 0}
                          {...effortPropsFor(board)}
                          hasActiveFilters={hasActiveFilters}
                          draggedTask={draggedTask}
                          selectedBoardId={selectedBoard}
                          boardDropState={boardDropState}
                          onSelect={() => onSelectBoard(board.id)}
                          onHoverStart={handleBoardHoverStart}
                          onHoverEnd={handleBoardHoverEnd}
                        />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="flex w-max flex-shrink-0 items-center gap-1">
                {boards.map(board => (
                  <div key={board.id} className="shrink-0">
                    {draggedTask ? (
                      // When dragging a task, use droppable tab for cross-board drops
                      <DroppableBoardTab
                        board={board}
                        isSelected={selectedBoard === board.id}
                        onSelect={() => onSelectBoard(board.id)}
                        taskCount={allowBoardTabTaskCounts && getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
                        wipCount={allowBoardTabTaskCounts && getBoardWipTaskCount ? getBoardWipTaskCount(board) : 0}
                        {...effortPropsFor(board)}
                        hasActiveFilters={hasActiveFilters}
                        draggedTask={draggedTask}
                        selectedBoardId={selectedBoard}
                        boardDropState={boardDropState}
                        onHoverStart={handleBoardHoverStart}
                        onHoverEnd={handleBoardHoverEnd}
                      />
                    ) : (
                      // Regular tab button
                      <RegularBoardTab
                        board={board}
                        isSelected={selectedBoard === board.id}
                        onSelect={() => onSelectBoard(board.id)}
                        onEdit={() => handleEditClick(board.id)}
                        onRemove={() => handleRemoveClick(board.id)}
                        canDelete={boards.length > 1}
                        taskCount={allowBoardTabTaskCounts && getFilteredTaskCount ? getFilteredTaskCount(board) : undefined}
                        wipCount={allowBoardTabTaskCounts && getBoardWipTaskCount ? getBoardWipTaskCount(board) : undefined}
                        {...effortPropsFor(board)}
                        showTaskCount={allowBoardTabTaskCounts}
                        hasActiveFilters={hasActiveFilters}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {isAdmin && <AddBoardInTrackButton onAddBoard={onAddBoard} />}
          </div>

          {tabsOverflow && (
            <KanbanChromeTooltip label={t('boardTabs.scrollRight')}>
              <button
                type="button"
                onClick={scrollRight}
                disabled={!canScrollRight}
                aria-hidden={!canScrollRight}
                tabIndex={canScrollRight ? 0 : -1}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-transparent text-gray-500 transition-opacity hover:border-gray-200 hover:bg-white hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-100 ${
                  canScrollRight ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <ChevronRight size={18} strokeWidth={2} />
              </button>
            </KanbanChromeTooltip>
          )}
        </div>

        {/* Same width as BoardMetrics (Progression) so trash sits under that column */}
        {showActionColumn && (
          <div
            className={`flex shrink-0 items-center justify-end gap-2 ${
              isMobile ? '' : 'w-[168px]'
            }`}
          >
            {showTrashButton && (
              <KanbanChromeTooltip label={trashOpen ? t('boardTabs.hideTrash') : t('boardTabs.showTrash')}>
                <button
                  type="button"
                  onClick={onToggleTrash}
                  className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
                    trashOpen
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-white hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                  }`}
                  aria-label={trashOpen ? t('boardTabs.hideTrash') : t('boardTabs.showTrash')}
                  aria-pressed={trashOpen}
                  data-tour-id="board-trash-toggle"
                >
                  <Trash2 size={18} strokeWidth={2} />
                  <span
                    className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-1 ring-white dark:ring-gray-900"
                    aria-hidden="true"
                  >
                    {trashCount > 99 ? '99+' : trashCount}
                  </span>
                </button>
              </KanbanChromeTooltip>
            )}
          </div>
        )}
      </div>
      {renderBoardEditDropdown()}
    </div>
  );
};
