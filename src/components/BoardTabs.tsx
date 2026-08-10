import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronLeft, ChevronRight, Trash2, GripVertical } from 'lucide-react';
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
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import {
  TASK_COUNT_PILL_DEFAULT,
  formatTaskCountPill,
  taskCountPillWeightClass,
} from '../utils/taskCountPill';

/** Inactive tab — sits on the track */
const tabTrackInactive =
  'rounded-lg px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors duration-150 hover:bg-white/70 dark:hover:bg-gray-700/60 hover:text-gray-900 dark:hover:text-gray-100';
/** Selected tab — raised chip */
const tabTrackActive =
  'rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 shadow-sm ring-1 ring-gray-200/90 dark:ring-gray-600/90 transition-shadow duration-150';

interface BoardTabsProps {
  boards: Board[];
  selectedBoard: string | null;
  onSelectBoard: (boardId: string) => void;
  onAddBoard: () => void;
  onEditBoard: (boardId: string, newName: string) => void;
  onRemoveBoard: (boardId: string) => void;
  onReorderBoards: (boardId: string, newPosition: number) => void;
  isAdmin?: boolean;
  getFilteredTaskCount?: (board: Board) => number;
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
          cursor-pointer flex items-center gap-2 whitespace-nowrap min-w-[5.5rem] justify-center
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
        <div className={`flex items-center gap-2 ${isDragActive && canDrop ? 'pointer-events-none' : ''}`}>
          {taskCount !== undefined && taskCount > 0 && (
            <span
              className={`
              px-1.5 py-0.5 text-[0.65rem] leading-none rounded-full min-w-[1.25rem] text-center pointer-events-none tabular-nums
              ${TASK_COUNT_PILL_DEFAULT} ${taskCountPillWeightClass(hasActiveFilters)}
            `}
            >
              {formatTaskCountPill(taskCount)}
            </span>
          )}
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
  /** Unfiltered total shown in the delete confirmation. */
  totalTaskCount?: number;
  showTaskCount?: boolean;
  hasActiveFilters?: boolean;
}> = ({ board, isSelected, onSelect, onEdit, onRemove, canDelete, showDeleteConfirm, onConfirmDelete, onCancelDelete, taskCount, totalTaskCount, showTaskCount, hasActiveFilters = false }) => {
  const [deleteButtonRef, setDeleteButtonRef] = useState<HTMLButtonElement | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });

  const { t } = useTranslation('common');
  // Translate only: CSS.Transform also applies dnd-kit's scaleX/scaleY, which stretches
  // the label because board tabs have different widths
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <>
      <KanbanChromeTooltip
        label={t('boardTabs.clickToSelectDoubleClickToRename')}
        wrapperClassName="relative group inline-flex shrink-0"
      >
        <div
          ref={setNodeRef}
          style={style}
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onDoubleClick={onEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect();
            }
          }}
          className={`
            relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 !px-2
            ${isSelected ? tabTrackActive : tabTrackInactive}
            ${isDragging ? 'opacity-60 shadow-lg ring-2 ring-gray-300/50 dark:ring-gray-500/40' : ''}
          `}
        >
        {/* Task count covers the drag handle until hover reveals it. */}
        <KanbanChromeTooltip
          label={t('boardTabs.dragToReorder')}
          wrapperClassName="relative z-[2] shrink-0"
        >
          <div
            className="group/board-handle relative flex h-7 min-w-7 cursor-grab touch-none items-center justify-center rounded-md px-0.5 text-gray-400 transition-colors hover:bg-gray-200/80 hover:text-gray-600 active:cursor-grabbing dark:hover:bg-gray-600/50 dark:hover:text-gray-300"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            {showTaskCount && taskCount !== undefined && taskCount > 0 ? (
              <>
                {/* Invisible sizer so 3–4 character counts set width without extra tab padding */}
                <span
                  className="invisible px-1 py-0.5 text-[0.65rem] leading-none tabular-nums font-bold"
                  aria-hidden
                >
                  {formatTaskCountPill(taskCount)}
                </span>
                <span
                  className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover/board-handle:opacity-0`}
                >
                  <span
                    className={`rounded-full px-1 py-0.5 text-center text-[0.65rem] leading-none tabular-nums ${TASK_COUNT_PILL_DEFAULT} ${taskCountPillWeightClass(hasActiveFilters)}`}
                  >
                    {formatTaskCountPill(taskCount)}
                  </span>
                </span>
                <GripVertical
                  className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/board-handle:opacity-100"
                  aria-hidden
                />
              </>
            ) : (
              <GripVertical className="h-4 w-4 opacity-60" aria-hidden />
            )}
          </div>
        </KanbanChromeTooltip>

        <div className="flex min-w-0 items-center">
          <span className="truncate max-w-[10rem]">{board.title}</span>
        </div>

          {/* Space is always reserved: revealing the trash on hover must not resize the tab,
              or neighbouring tabs shift under the cursor and the wrong board gets deleted. */}
          {canDelete && (
            <div
              className="flex w-7 shrink-0 items-center justify-center opacity-0 transition-opacity duration-200 ease-out pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
            >
              <KanbanChromeTooltip label={t('boardTabs.deleteBoard')}>
                <button
                  type="button"
                  ref={setDeleteButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md p-0 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </KanbanChromeTooltip>
            </div>
          )}
        </div>
      </KanbanChromeTooltip>

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
              // Filters hide tasks that deletion still removes, so always report the board total.
              const deletedTaskCount = totalTaskCount ?? taskCount ?? 0;
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
  showTaskCount?: boolean;
  hasActiveFilters?: boolean;
}> = ({ board, isSelected, onSelect, onEdit, onRemove, canDelete, taskCount, showTaskCount, hasActiveFilters = false }) => {
  const { t } = useTranslation('common');
  return (
    <div className="relative group">
      <KanbanChromeTooltip label={t('boardTabs.clickToSelectBoard')}>
        <button
          type="button"
          onClick={onSelect}
          className={`${isSelected ? tabTrackActive : tabTrackInactive} w-full text-left`}
        >
          <div className="flex items-center gap-2">
            {showTaskCount && taskCount !== undefined && taskCount > 0 && (
              <span
                className={`shrink-0 px-1.5 py-0.5 text-[0.65rem] leading-none rounded-full tabular-nums ${TASK_COUNT_PILL_DEFAULT} ${taskCountPillWeightClass(hasActiveFilters)}`}
              >
                {formatTaskCountPill(taskCount)}
              </span>
            )}
            <span className="truncate max-w-[11rem]">{board.title}</span>
          </div>
        </button>
      </KanbanChromeTooltip>
      
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
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  /** When true, both chevron slots stay mounted so show/hide never resizes the track. */
  const [tabsOverflow, setTabsOverflow] = useState(false);
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
    // Only admins can edit board titles
    if (!isAdmin) return;
    
    const board = boards.find(b => b.id === boardId);
    if (board) {
      setEditingBoardId(boardId);
      setEditingTitle(board.title);
    }
  };

  const handleTitleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTitle.trim() || isSubmitting || !editingBoardId) return;

    setIsSubmitting(true);
    try {
      await onEditBoard(editingBoardId, editingTitle.trim());
      setEditingBoardId(null);
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to edit board:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveClick = (boardId: string) => {
    if (boards.length > 1) {
      // Check if board has any tasks. Use the unfiltered total when available so an active
      // filter can never make a populated board look empty and skip the confirmation.
      const board = boards.find(b => b.id === boardId);
      const hasAnyTasks = board
        ? (getTotalTaskCount
            ? getTotalTaskCount(board) > 0
            : Object.values(board.columns || {}).some(
                column => column.tasks && column.tasks.length > 0
              ))
        : false;
      
      if (hasAnyTasks) {
        // Board has tasks, show confirmation
        setShowDeleteConfirm(boardId);
      } else {
        // Board is empty, delete immediately
        confirmDeleteBoard(boardId);
      }
    }
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

  // Get the current board's project identifier
  const currentBoard = boards.find(board => board.id === selectedBoard);
  const currentProject = currentBoard?.project;
  // Always reserve the Progression-aligned slot when trash can appear; only inner
  // buttons toggle. Otherwise non-admins jump ~168px when trashCount resolves
  // after a board switch (admins already keep this column via the + button).
  const showActionColumn = isAdmin || Boolean(onToggleTrash);

  return (
    <div className="mb-6">
      {/* Match Kanban toolbar columns: tab strip = Tools + Team Members; actions = Progression width */}
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-1" data-tour-id="board-tabs">
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

          <div
            ref={tabsContainerRef}
            data-board-tabs-scroll
            className="board-tabs-scroll min-w-0 flex-1 overflow-x-auto scroll-smooth rounded-xl border border-gray-200/90 bg-gray-100/55 px-1 py-1 dark:border-gray-700/90 dark:bg-gray-800/45 hide-scrollbar"
          >
            {isAdmin ? (
              // Admin view with drag and drop (only when not dragging tasks)
              draggedTask ? (
                // When dragging a task, render tabs without board DndContext to allow cross-board drops
                <div className="flex w-max flex-shrink-0 items-center gap-1">
                  {boards.map(board => (
                    <div key={board.id} className="shrink-0">
                      {editingBoardId === board.id ? (
                        <form
                          onSubmit={handleTitleSubmit}
                          className="min-w-[10rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="w-full rounded-md border-0 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                            autoFocus
                            onBlur={handleTitleSubmit}
                            disabled={isSubmitting}
                          />
                        </form>
                      ) : (
                        <DroppableBoardTab
                          board={board}
                          isSelected={selectedBoard === board.id}
                          onSelect={() => onSelectBoard(board.id)}
                          taskCount={getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
                          hasActiveFilters={hasActiveFilters}
                          draggedTask={draggedTask}
                          selectedBoardId={selectedBoard}
                          boardDropState={boardDropState}
                          onHoverStart={handleBoardHoverStart}
                          onHoverEnd={handleBoardHoverEnd}
                        />
                      )}
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
                    {editingBoardId === board.id ? (
                      <form
                        onSubmit={handleTitleSubmit}
                        className="min-w-[10rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                      >
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className="w-full rounded-md border-0 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                          autoFocus
                          onBlur={handleTitleSubmit}
                          disabled={isSubmitting}
                        />
                      </form>
                    ) : draggedTask ? (
                      // When dragging a task, use droppable tab for cross-board drops
                      <DroppableBoardTab
                        board={board}
                        isSelected={selectedBoard === board.id}
                        onSelect={() => onSelectBoard(board.id)}
                        taskCount={getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
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
                        taskCount={getFilteredTaskCount ? getFilteredTaskCount(board) : undefined}
                        totalTaskCount={getTotalTaskCount ? getTotalTaskCount(board) : undefined}
                        showTaskCount={true}
                        hasActiveFilters={hasActiveFilters}
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
                      {editingBoardId === board.id ? (
                        <form
                          onSubmit={handleTitleSubmit}
                          className="min-w-[10rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="w-full rounded-md border-0 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                            autoFocus
                            onBlur={handleTitleSubmit}
                            disabled={isSubmitting}
                          />
                        </form>
                      ) : (
                        <DroppableBoardTab
                          board={board}
                          isSelected={selectedBoard === board.id}
                          taskCount={getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
                          hasActiveFilters={hasActiveFilters}
                          draggedTask={draggedTask}
                          selectedBoardId={selectedBoard}
                          boardDropState={boardDropState}
                          onSelect={() => onSelectBoard(board.id)}
                          onHoverStart={handleBoardHoverStart}
                          onHoverEnd={handleBoardHoverEnd}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="flex w-max flex-shrink-0 items-center gap-1">
                {boards.map(board => (
                  <div key={board.id} className="shrink-0">
                    {editingBoardId === board.id ? (
                      <form
                        onSubmit={handleTitleSubmit}
                        className="min-w-[10rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                      >
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className="w-full rounded-md border-0 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                          autoFocus
                          onBlur={handleTitleSubmit}
                          disabled={isSubmitting}
                        />
                      </form>
                    ) : draggedTask ? (
                      // When dragging a task, use droppable tab for cross-board drops
                      <DroppableBoardTab
                        board={board}
                        isSelected={selectedBoard === board.id}
                        onSelect={() => onSelectBoard(board.id)}
                        taskCount={getFilteredTaskCount ? getFilteredTaskCount(board) : 0}
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
                        taskCount={getFilteredTaskCount ? getFilteredTaskCount(board) : undefined}
                        showTaskCount={true}
                        hasActiveFilters={hasActiveFilters}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
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

        {/* Same width as BoardMetrics (Progression) so + / trash sit under that column */}
        {showActionColumn && (
          <div className="flex w-[168px] shrink-0 items-center justify-end gap-2">
            {isAdmin && (
              <KanbanChromeTooltip label={t('boardTabs.addNewBoard')}>
                <button
                  type="button"
                  onClick={onAddBoard}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-500 transition-colors hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-400 dark:hover:bg-blue-950/50 dark:hover:text-blue-300"
                  data-tour-id="add-board-button"
                >
                  <Plus size={18} strokeWidth={2} />
                </button>
              </KanbanChromeTooltip>
            )}

            {trashCount > 0 && onToggleTrash && (
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
    </div>
  );
};
