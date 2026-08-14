import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  DndContext, 
  DragEndEvent, 
  DragStartEvent, 
  DragOverEvent, 
  closestCorners,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Task, Column, Board } from '../../types';
import { resetDndGlobalState } from '../../utils/globalDndState';
import { dndLog } from '../../utils/dndDebug';
import {
  TaskDropPlacement,
  resolvePreviewInsertIndex
} from '../../utils/taskReorderingUtils';

interface SimpleDragDropManagerProps {
  children: React.ReactNode;
  currentBoardId: string;
  columns: { [key: string]: Column };
  boards: Board[];
  isOnline?: boolean; // Network status - disable dragging when offline
  onTaskMove: (taskId: string, targetColumnId: string, placement: TaskDropPlacement) => Promise<void>;
  onTaskMoveToDifferentBoard: (taskId: string, targetBoardId: string) => Promise<void>;
  /** Same-board follower multi-drag commit. */
  onBulkTaskMove?: (
    taskIds: string[],
    targetColumnId: string,
    placement: TaskDropPlacement
  ) => Promise<void>;
  checkedTaskIds?: Set<string>;
  onClearChecked?: () => void;
  onDraggedTaskIdsChange?: (taskIds: string[]) => void;
  onColumnReorder: (columnId: string, newPosition: number) => Promise<void>;
  // Callbacks to sync with external state
  onDraggedTaskChange?: (task: Task | null) => void;
  onDraggedColumnChange?: (column: Column | null) => void;
  onBoardTabHover?: (isHovering: boolean) => void;
  onDragPreviewChange?: (preview: { targetColumnId: string; insertIndex: number; isCrossColumn?: boolean } | null) => void;
}

const parsePos = (pos: any): number => (typeof pos === 'number' ? pos : parseFloat(pos) || 0);

/** Before/after relative to an anchor, using order in the visible (filtered) column. */
function placementRelativeToTask(
  visibleTasks: Task[],
  draggedTask: Task,
  targetTask: Task
): TaskDropPlacement {
  const sorted = [...visibleTasks].sort((a, b) => parsePos(a.position) - parsePos(b.position));
  const draggedIndex = sorted.findIndex(t => t.id === draggedTask.id);
  const targetIndex = sorted.findIndex(t => t.id === targetTask.id);
  if (targetIndex < 0) {
    return { kind: 'end' };
  }
  // Cross-column or unknown dragged index: insert before target
  if (draggedIndex < 0 || draggedTask.columnId !== targetTask.columnId) {
    return { kind: 'before', taskId: targetTask.id };
  }
  // Same column: moving up → before; moving down → after
  if (draggedIndex > targetIndex) {
    return { kind: 'before', taskId: targetTask.id };
  }
  return { kind: 'after', taskId: targetTask.id };
}

function placementForColumnEnd(visibleTasks: Task[], draggedTaskId?: string): TaskDropPlacement {
  const sorted = [...visibleTasks]
    .filter(t => t.id !== draggedTaskId)
    .sort((a, b) => parsePos(a.position) - parsePos(b.position));
  const last = sorted[sorted.length - 1];
  if (last) {
    return { kind: 'after', taskId: last.id };
  }
  return { kind: 'end' };
}

// Custom collision detection that prioritizes column areas over board tabs
const customCollisionDetection = (args: any) => {
  // Check if we're dragging a column - if so, ignore task collisions
  const activeData = args.active?.data?.current;
  const isDraggingColumn = activeData?.type === 'column';
  
  // Get column IDs for direct ID matching (not just data.type)
  const columnIds = isDraggingColumn && args.droppableContainers 
    ? args.droppableContainers
        .filter((container: any) => {
          const data = container.data?.current;
          return data?.type === 'column' || container.id && !container.id.toString().includes('-middle') && !container.id.toString().includes('-drop');
        })
        .map((container: any) => container.id)
    : [];
  
  // Get all possible collisions
  const pointerCollisions = pointerWithin(args);
  const cornerCollisions = closestCorners(args);
  
  // CRITICAL FIX: Prioritize pointer collisions over corner collisions
  // This prevents distant empty columns from interfering with intended targets
  const columnCollisions = pointerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    // Check both data.type AND collision.id against column IDs
    // Note: column-bottom is for tasks only, not columns
    const isColumnType = data?.type === 'column' || 
           data?.type === 'column-top' || 
           data?.type === 'board-area';
    const isColumnId = columnIds.length > 0 && columnIds.includes(collision.id);
    return isColumnType || isColumnId || data?.type === 'task';
  });
  
  // If we have pointer-based column collisions, use only those (most precise)
  if (columnCollisions.length > 0) {
    // CRITICAL FIX: When dragging a column, filter out task collisions
    // Tasks should not interfere with column-to-column drag operations
    if (isDraggingColumn) {
      // Only allow column-type collisions when dragging a column
      // Check both data.type AND collision.id against column IDs
      // Note: column-bottom and column-middle are for tasks only, not columns
      const columnOnlyCollisions = columnCollisions.filter((collision: any) => {
        const data = collision.data?.current;
        const isColumnType = data?.type === 'column' || 
               data?.type === 'column-top' || 
               data?.type === 'board-area';
        const isColumnId = columnIds.length > 0 && columnIds.includes(collision.id);
        // Explicitly exclude 'task', 'column-middle', and 'column-bottom' type collisions
        return isColumnType || isColumnId;
      });
      
      // If we found column collisions, use them
      if (columnOnlyCollisions.length > 0) {
        return columnOnlyCollisions;
      }
      // CRITICAL: If dragging a column and no column collisions found, return empty array
      // This prevents tasks from being detected as drop targets
      return [];
    } else {
      // When dragging a task, prioritize task collisions over empty columns
      const taskCollisions = columnCollisions.filter((collision: any) => {
        return collision.data?.current?.type === 'task';
      });
      
      // If we have task collisions, use only those (most specific)
      if (taskCollisions.length > 0) {
        return taskCollisions;
      }
    }
    
    // Otherwise use all pointer-based collisions (only for task drags)
    return columnCollisions;
  }
  
  // Fallback to corner-based collisions only if no pointer collisions
  // Note: column-bottom is for tasks only, not columns
  const cornerColumnCollisions = cornerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    return data?.type === 'column' || 
           data?.type === 'column-top' || 
           data?.type === 'board-area' || 
           data?.type === 'task';
  });
  
  if (cornerColumnCollisions.length > 0) {
    // When dragging a column, filter out task collisions from corner collisions too
    if (isDraggingColumn) {
      const cornerColumnOnlyCollisions = cornerColumnCollisions.filter((collision: any) => {
        const data = collision.data?.current;
        // Note: column-bottom and column-middle are for tasks only, not columns
        return data?.type === 'column' || 
               data?.type === 'column-top' || 
               data?.type === 'board-area';
        // Explicitly exclude 'task', 'column-middle', and 'column-bottom' type collisions
      });
      
      if (cornerColumnOnlyCollisions.length > 0) {
        return cornerColumnOnlyCollisions;
      }
      // CRITICAL: If dragging a column and no column collisions found, return empty array
      // This prevents tasks from being detected as drop targets
      return [];
    } else {
      // When dragging a task, prioritize task collisions
      const cornerTaskCollisions = cornerColumnCollisions.filter((collision: any) => {
        return collision.data?.current?.type === 'task';
      });
      
      if (cornerTaskCollisions.length > 0) {
        return cornerTaskCollisions;
      }
    }
    
    return cornerColumnCollisions;
  }
  
  // Only consider board tabs if there are absolutely NO column collisions
  // AND we're clearly over the board tab area (not just near it)
  const strictBoardCollisions = pointerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    return data?.type === 'board' && data?.boardId; // Board tabs only
  });
  
  // Be EXTREMELY strict about board tab detection
  // Only allow board tabs if:
  // 1. It's the ONLY pointer collision AND
  // 2. There are NO corner collisions with columns/tasks
  const nonBoardCornerCollisions = cornerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    return data?.type !== 'board';
  });
  
  // Be EXTREMELY restrictive - require exactly ONE board collision
  if (strictBoardCollisions.length === 1 && 
      pointerCollisions.length === 1 &&
      nonBoardCornerCollisions.length === 0) {
    return strictBoardCollisions;
  }
  
  // Always prefer non-board collisions
  if (nonBoardCornerCollisions.length > 0) {
    // If dragging a column, filter out tasks from non-board collisions too
    if (isDraggingColumn) {
      const filteredNonBoard = nonBoardCornerCollisions.filter((collision: any) => {
        const data = collision.data?.current;
        // Note: column-bottom and column-middle are for tasks only, not columns
        return data?.type === 'column' || 
               data?.type === 'column-top' || 
               data?.type === 'board-area';
      });
      if (filteredNonBoard.length > 0) {
        return filteredNonBoard;
      }
      return [];
    }
    return nonBoardCornerCollisions;
  }
  
  // Last resort - return original collisions (but filter tasks if dragging column)
  if (isDraggingColumn) {
    const filteredCorner = cornerCollisions.filter((collision: any) => {
      const data = collision.data?.current;
      // Note: column-bottom and column-middle are for tasks only, not columns
      return data?.type === 'column' || 
             data?.type === 'column-top' || 
             data?.type === 'board-area';
    });
    if (filteredCorner.length > 0) {
      return filteredCorner;
    }
    return [];
  }
  return cornerCollisions;
};

export const SimpleDragDropManager: React.FC<SimpleDragDropManagerProps> = React.memo(({
  children,
  currentBoardId,
  columns,
  boards,
  isOnline = true,
  onTaskMove,
  onTaskMoveToDifferentBoard,
  onBulkTaskMove,
  checkedTaskIds,
  onClearChecked,
  onDraggedTaskIdsChange,
  onColumnReorder,
  onDraggedTaskChange,
  onDraggedColumnChange,
  onBoardTabHover,
  onDragPreviewChange
}) => {
  const { t } = useTranslation('tasks');
  const activeBulkTaskIdsRef = useRef<string[]>([]);
  const [keyboardMoveLabel, setKeyboardMoveLabel] = useState<string | null>(null);
  
  // Y-coordinate based tab area detection
  const [isHoveringBoardTabDelayed, setIsHoveringBoardTabDelayed] = useState(false);
  const [currentMouseY, setCurrentMouseY] = useState(0);
  const [tabAreaBounds, setTabAreaBounds] = useState({ top: 0, bottom: 80 }); // Dynamic tab bounds
  const [usingYCoordinateDetection, setUsingYCoordinateDetection] = useState(false); // Flag to prioritize Y-detection
  
  // Cache for drag preview to avoid recalculating on every drag over event
  const lastPreviewRef = useRef<{ targetColumnId: string; insertIndex: number; isCrossColumn: boolean } | null>(null);
  const lastOverIdRef = useRef<string | number | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const lastProcessTimeRef = useRef<number>(0);
  const THROTTLE_MS = 16; // ~60fps max
  
  // Debug: Track drag over call count
  const dragOverCallCountRef = useRef<number>(0);
  const dragOverSkippedCountRef = useRef<number>(0);
  const dragOverProcessedCountRef = useRef<number>(0);

  // Track mouse Y position for tab area detection
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCurrentMouseY(e.clientY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Safety: Clear dragged column state on mount in case it got stuck
  useEffect(() => {
    onDraggedColumnChange?.(null);
    onDraggedTaskChange?.(null);
  }, []);

  // Small distance so a click/Cmd+click does not start a drag (avoids opacity-50 “disabled” flash).
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  
  // Removed console.log to reduce noise

  const handleDragStart = (event: DragStartEvent) => {
    // Reset preview cache on drag start
    lastPreviewRef.current = null;
    lastOverIdRef.current = null;
    
    // Reset counters
    dragOverCallCountRef.current = 0;
    dragOverSkippedCountRef.current = 0;
    dragOverProcessedCountRef.current = 0;
    
    // Block dragging when offline
    if (!isOnline) {
      return;
    }
    
    const activeData = event.active.data?.current;
    
    // Detect tab container bounds dynamically
    const detectTabBounds = () => {
      // Look for board tabs container - try multiple selectors
      const tabSelectors = [
        '[class*="board-tabs"]',
        '[class*="BoardTabs"]', 
        '.flex.items-center.space-x-1.overflow-x-auto',
        'div:has(> button[id^="board-"])',
        // Fallback: find any element containing board tabs
        'button[id^="board-"]'
      ];
      
      let tabContainer = null;
      for (const selector of tabSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          tabContainer = element.tagName === 'BUTTON' ? element.parentElement : element;
          break;
        }
      }
      
      if (tabContainer) {
        const rect = tabContainer.getBoundingClientRect();
        const bounds = { 
          top: rect.top - 30, // Extend 30px above the tabs for more room
          bottom: rect.bottom 
        };
        setTabAreaBounds(bounds);
        return bounds;
      } else {
        // console.warn('⚠️ Could not find tab container, using fallback bounds');
        const fallback = { top: 0, bottom: 80 };
        setTabAreaBounds(fallback);
        return fallback;
      }
    };
    
    // Detect bounds at drag start
    const bounds = detectTabBounds();
    
    // Reset all states at drag start to ensure clean state
    onBoardTabHover?.(false);
    onDragPreviewChange?.(null);
    
    // Reset tab area state
    setIsHoveringBoardTabDelayed(false);
    
    // Safety: Force reset global DND state in case it got stuck
    resetDndGlobalState();
    
    
    if (activeData?.type === 'task') {
      const task = activeData.task as Task;
      const isKeyboard =
        typeof KeyboardEvent !== 'undefined' &&
        event.activatorEvent instanceof KeyboardEvent;
      if (isKeyboard) {
        setKeyboardMoveLabel(task.ticket || task.title || '');
      } else {
        setKeyboardMoveLabel(null);
      }
      const checked = checkedTaskIds;
      const isChecked = !!checked?.has(task.id);

      if (checked && checked.size > 0 && !isChecked) {
        // Unchecked card drag clears multi-check and runs single-task drag
        onClearChecked?.();
        activeBulkTaskIdsRef.current = [];
        onDraggedTaskIdsChange?.([]);
      } else if (isChecked && checked && checked.size >= 1) {
        // Follower multi-drag only when all checked share one column
        const sourceColumnId = task.columnId;
        const ordered = (columns[sourceColumnId]?.tasks || [])
          .slice()
          .sort((a, b) => parsePos(a.position) - parsePos(b.position))
          .filter((t) => checked.has(t.id));
        const allSameColumn = Array.from(checked).every((id) => {
          for (const col of Object.values(columns)) {
            if (col.tasks?.some((t) => t.id === id)) {
              return col.id === sourceColumnId;
            }
          }
          return false;
        });
        if (allSameColumn && ordered.length >= 1) {
          const ids = ordered.map((t) => t.id);
          activeBulkTaskIdsRef.current = ids;
          onDraggedTaskIdsChange?.(ids);
        } else {
          activeBulkTaskIdsRef.current = [];
          onDraggedTaskIdsChange?.([]);
        }
      } else {
        activeBulkTaskIdsRef.current = [];
        onDraggedTaskIdsChange?.([]);
      }

      onDraggedTaskChange?.(task);
    } else if (activeData?.type === 'column') {
      const column = activeData.column as Column;
      onDraggedColumnChange?.(column);
      // Reduced console noise
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    
    dragOverCallCountRef.current++;
    
    // PERFORMANCE: Throttle to max 60fps (16ms between updates)
    const now = performance.now();
    if (now - lastProcessTimeRef.current < THROTTLE_MS) {
      // Skip this update - too soon since last one
      dragOverSkippedCountRef.current++;
      return;
    }
    
    dragOverProcessedCountRef.current++;
    
    // PERFORMANCE: Cancel any pending RAF to avoid queuing multiple updates
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
    }
    
    // PERFORMANCE: Defer expensive operations to next animation frame
    rafHandleRef.current = requestAnimationFrame(() => {
      rafHandleRef.current = null;
      lastProcessTimeRef.current = performance.now();
      
      // FIRST: Check for mouse-based tab area detection (before any other logic)
      const isTaskDrag = active.data?.current?.type === 'task';
      
      if (isTaskDrag) {
        // Pure Y-coordinate based detection using dynamic tab bounds
        const isInTabArea = currentMouseY >= tabAreaBounds.top && currentMouseY <= tabAreaBounds.bottom;
        
        // Set flag to indicate Y-coordinate detection is active
        setUsingYCoordinateDetection(true);
        
        if (isInTabArea && !isHoveringBoardTabDelayed) {
          setIsHoveringBoardTabDelayed(true);
          onBoardTabHover?.(true);
          onDragPreviewChange?.(null);
        } else if (!isInTabArea && isHoveringBoardTabDelayed) {
          setIsHoveringBoardTabDelayed(false);
          onBoardTabHover?.(false);
        }
      } else {
        // Reset flag when not dragging tasks
        setUsingYCoordinateDetection(false);
      }
      
      // If no over target, clear all states
      if (!over) {
        onBoardTabHover?.(false);
        onDragPreviewChange?.(null);
        return;
      }
      
      // Only detect board tab hover if we're actually dragging a task (not a column)
      const activeData = active?.data?.current;
      
      // DEBUG: Only log when we detect board type (should only be tabs)
      if (isTaskDrag && over.data?.current?.type === 'board') {
        // NEVER process collision-based board tab detection - Y-coordinates only
        return;
      }
      
      // Update drag preview for visual feedback (only for task drags)
      // PERFORMANCE: Skip preview calculations for column drags (they don't need preview)
      if (isTaskDrag && over) {
        // PERFORMANCE: Only recalculate if the over target actually changed
        if (lastOverIdRef.current === over.id) {
          // Same target - skip expensive calculations
          return;
        }
        lastOverIdRef.current = over.id;
        
        const overData = over.data?.current;
        const draggedTask = active.data?.current?.task;
        
        if (overData?.type === 'task') {
          // Hovering over another task - before/after based on drag direction in visible list
          const targetTask = overData.task;
          if (targetTask && draggedTask) {
            const targetColumn = columns[targetTask.columnId];
            if (targetColumn) {
              const placement = placementRelativeToTask(targetColumn.tasks, draggedTask, targetTask);
              const insertIndex = resolvePreviewInsertIndex(
                targetColumn.tasks,
                placement,
                draggedTask.id
              );
              const isCrossColumn = draggedTask.columnId !== targetTask.columnId;
              const newPreview = {
                targetColumnId: targetTask.columnId,
                insertIndex,
                isCrossColumn
              };
              if (!lastPreviewRef.current || 
                  lastPreviewRef.current.targetColumnId !== newPreview.targetColumnId ||
                  lastPreviewRef.current.insertIndex !== newPreview.insertIndex ||
                  lastPreviewRef.current.isCrossColumn !== newPreview.isCrossColumn) {
                lastPreviewRef.current = newPreview;
                onDragPreviewChange?.(newPreview);
              }
            }
          }
        } else if (overData?.type === 'column-top') {
          // Hovering over column top - insert at position 0
          const isCrossColumn = draggedTask && draggedTask.columnId !== overData.columnId;
          const newPreview = {
            targetColumnId: overData.columnId,
            insertIndex: 0,
            isCrossColumn
          };
          if (!lastPreviewRef.current || 
              lastPreviewRef.current.targetColumnId !== newPreview.targetColumnId ||
              lastPreviewRef.current.insertIndex !== newPreview.insertIndex) {
            lastPreviewRef.current = newPreview;
            onDragPreviewChange?.(newPreview);
          }
        } else if (overData?.type === 'column-bottom' || overData?.type === 'column' || 
                   overData?.type === 'column-middle' || over.id.toString().includes('-middle')) {
          // All column drop zones - insert after last visible (or end)
          const targetColumnId = overData?.columnId || 
                                (over.id.toString().includes('-middle') ? over.id.toString().replace('-middle', '') : over.id as string);
          const targetColumn = columns[targetColumnId];
          const isCrossColumn = !!(draggedTask && draggedTask.columnId !== targetColumnId);
          const placement = placementForColumnEnd(targetColumn?.tasks || [], draggedTask?.id);
          const insertIndex = resolvePreviewInsertIndex(
            targetColumn?.tasks || [],
            placement,
            draggedTask?.id
          );
          
          const newPreview = {
            targetColumnId,
            insertIndex,
            isCrossColumn
          };
          if (!lastPreviewRef.current || 
              lastPreviewRef.current.targetColumnId !== newPreview.targetColumnId ||
              lastPreviewRef.current.insertIndex !== newPreview.insertIndex) {
            lastPreviewRef.current = newPreview;
            onDragPreviewChange?.(newPreview);
          }
        } else {
          if (lastPreviewRef.current !== null) {
            lastPreviewRef.current = null;
            onDragPreviewChange?.(null);
          }
        }
      } else {
        // Column drag or no drag - clear preview
        if (lastPreviewRef.current !== null) {
          lastPreviewRef.current = null;
          onDragPreviewChange?.(null);
        }
      }
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const bulkIds = activeBulkTaskIdsRef.current;
    const clearBulkDrag = () => {
      activeBulkTaskIdsRef.current = [];
      onDraggedTaskIdsChange?.([]);
    };

    // Block drag completion when offline
    if (!isOnline) {
      onDraggedTaskChange?.(null);
      onDraggedColumnChange?.(null);
      onBoardTabHover?.(false);
      onDragPreviewChange?.(null);
      clearBulkDrag();
      setKeyboardMoveLabel(null);
      return;
    }
    
    const { active, over } = event;

    try {
      if (!over) {
        return;
      }

      const activeData = active.data?.current;
      const overData = over.data?.current;

      dndLog('🎯 Processing drag end:', {
        activeDataType: activeData?.type,
        overDataType: overData?.type,
        activeTaskId: activeData?.task?.id,
        overTaskId: overData?.task?.id
      });

      if (activeData?.type === 'task') {
        dndLog('🎯 Entering task move logic');
        // Handle task moves
        const task = activeData.task as Task;
        dndLog('🎯 Task data:', { taskId: task.id, taskTitle: task.title, taskColumnId: task.columnId, taskPosition: task.position });
        
        if (overData?.type === 'board' && overData.boardId !== currentBoardId) {
          // Check if Y-coordinate detection should override collision detection
          const isInTabAreaAtDrop = currentMouseY >= tabAreaBounds.top && currentMouseY <= tabAreaBounds.bottom;
          
          if (!isInTabAreaAtDrop) {
            // console.log('🚫 BOARD DROP REJECTED - Y-coordinate outside tab area:', {
            // mouseY: currentMouseY,
            // tabTop: tabAreaBounds.top,
            // tabBottom: tabAreaBounds.bottom,
            // boardId: overData.boardId
            // });
            // Don't execute cross-board move if mouse is outside tab area
            return;
          }
          
          // Cross-board move (only if mouse is actually in tab area)
          dndLog('🔄 Cross-board move (Y-coord approved):', task.id, '→', overData.boardId);
          dndLog('🔄 Cross-board details:', {
            taskId: task.id,
            targetBoardId: overData.boardId,
            currentBoardId,
            overDataType: overData.type,
            mouseY: currentMouseY,
            inTabArea: isInTabAreaAtDrop
          });
          // Phase C deferred: multi-select does not drag onto board tabs
          if (bulkIds.length > 1) {
            dndLog('🎯 [handleDragEnd] Multi-drag board-tab drop deferred — no-op');
            return;
          }
          await onTaskMoveToDifferentBoard(task.id, overData.boardId);
          dndLog('✅ Cross-board move completed');
        } else {
          dndLog('🎯 Same board move - anchor-relative placement');
          let targetColumnId = task.columnId;
          let placement: TaskDropPlacement | null = null;
          const bulkSet = new Set(bulkIds);
          
          // Check if we're dropping on a task - either via overData.type or by checking if over.id is a task ID
          let targetTask: Task | null = null;
          if (overData?.type === 'task' && overData.task) {
            targetTask = overData.task;
          } else if (over.id) {
            // Fallback: over.id might be a task ID when using SortableContext
            for (const column of Object.values(columns)) {
              const foundTask = column.tasks.find(t => t.id === over.id);
              if (foundTask) {
                targetTask = foundTask;
                break;
              }
            }
          }
          
          if (targetTask) {
            // Dropping on yourself / another follower in the block = cancel
            if (targetTask.id === task.id || bulkSet.has(targetTask.id)) {
              dndLog('🎯 [handleDragEnd] Drop on self — no-op');
              return;
            }
            targetColumnId = targetTask.columnId;
            const targetColumn = columns[targetColumnId];
            if (targetColumn) {
              placement = placementRelativeToTask(targetColumn.tasks, task, targetTask);
            } else {
              placement = { kind: 'before', taskId: targetTask.id };
            }
          } else if (overData?.type === 'column-top') {
            targetColumnId = overData.columnId;
            placement = { kind: 'start' };
          } else if (overData?.type === 'column-bottom') {
            // Same-column bottom zone while already last → no-op; otherwise append
            targetColumnId = overData.columnId;
            if (targetColumnId === task.columnId) {
              const sourceCol = columns[task.columnId];
              const sorted = [...(sourceCol?.tasks || [])].sort(
                (a, b) => parsePos(a.position) - parsePos(b.position)
              );
              if (sorted[sorted.length - 1]?.id === task.id) {
                dndLog('🎯 [handleDragEnd] Same-column bottom while already last — no-op');
                return;
              }
            }
            const targetColumn = columns[targetColumnId];
            placement = placementForColumnEnd(targetColumn?.tasks || [], task.id);
          } else if (overData?.type === 'column') {
            targetColumnId = overData.columnId || over.id as string;
            // Same column generic column hit often means cancel / ambiguous — treat as no-op
            if (targetColumnId === task.columnId) {
              dndLog('🎯 [handleDragEnd] Same-column drop on column body — no-op');
              return;
            }
            const targetColumn = columns[targetColumnId];
            placement = placementForColumnEnd(targetColumn?.tasks || [], task.id);
          } else if (overData?.type === 'column-middle' || over.id.toString().includes('-middle')) {
            targetColumnId = overData?.columnId || over.id.toString().replace('-middle', '');
            if (targetColumnId === task.columnId) {
              dndLog('🎯 [handleDragEnd] Same-column middle drop — no-op');
              return;
            }
            const targetColumn = columns[targetColumnId];
            placement = placementForColumnEnd(targetColumn?.tasks || [], task.id);
          } else if (columns[over.id as string]) {
            targetColumnId = over.id as string;
            if (targetColumnId === task.columnId) {
              dndLog('🎯 [handleDragEnd] Same-column drop on column id — no-op');
              return;
            }
            const targetColumn = columns[targetColumnId];
            placement = placementForColumnEnd(targetColumn?.tasks || [], task.id);
          } else {
            dndLog('⚠️ [handleDragEnd] No valid drop target found:', {
              overId: over.id,
              overDataType: overData?.type,
              activeTaskId: task.id,
              activeTaskColumnId: task.columnId
            });
            return;
          }

          if (!placement) {
            return;
          }

          // Skip no-op: same column start when already first, etc. — App/moveTaskToIndex also guards
          dndLog('🎯 [handleDragEnd] onTaskMove', {
            taskId: task.id,
            targetColumnId,
            placement,
            sourceColumnId: task.columnId,
            bulkCount: bulkIds.length,
          });
          if (bulkIds.length > 1 && onBulkTaskMove) {
            await onBulkTaskMove(bulkIds, targetColumnId, placement);
          } else {
            await onTaskMove(task.id, targetColumnId, placement);
          }
        }
      } else if (activeData?.type === 'column') {
        // Handle column reordering
        const column = activeData.column as Column;
        
        // Get all columns sorted by position to determine drag direction and edge cases
        const columnArray = Object.values(columns).sort((a, b) => (a.position || 0) - (b.position || 0));
        const sourceIndex = columnArray.findIndex(col => col.id === column.id);
        const sourcePosition = Math.floor(column.position || 0);
        
        // Helper function to calculate target position based on drag direction and edge cases
        const calculateTargetPosition = (targetColumn: Column): number => {
          // CRITICAL: Re-sort columns array to ensure we have the latest positions
          // This is important because the columns prop might be stale after a recent reorder
          const sortedColumns = [...columnArray].sort((a, b) => (a.position || 0) - (b.position || 0));
          const targetPosition = Math.floor(targetColumn.position || 0);
          const sourceIndex = sortedColumns.findIndex(col => col.id === column.id);
          const targetIndex = sortedColumns.findIndex(col => col.id === targetColumn.id);
          
          // Recalculate source position from sorted array to ensure accuracy
          const actualSourcePosition = Math.floor(sortedColumns[sourceIndex]?.position || 0);
          
          // Determine if we're moving left (to lower position) or right (to higher position)
          const movingLeft = actualSourcePosition > targetPosition;
          const movingRight = actualSourcePosition < targetPosition;
          
          // For edge cases: when dropping on first or last column
          const isFirstColumn = targetIndex === 0;
          const isLastColumn = targetIndex === sortedColumns.length - 1;
          
          if (movingLeft && isFirstColumn) {
            // Moving left to first position (position 0): dropped column takes position 0
            // The first column will be shifted to position 1 by the backend
            return 0;
          } else if (movingRight && isLastColumn) {
            // Moving right to last position: dropped column takes the last position
            // The last column will be shifted left by the backend
            return targetPosition;
          } else {
            // Normal case: use target's position
            // The backend will shift columns appropriately
            return targetPosition;
          }
        };
        
        // CRITICAL FIX: Check if over.id directly matches a column ID
        // This handles cases where collision detection returns tasks but we can find the column
        const overId = over?.id as string;
        const isOverColumnId = overId && columns[overId];
        
        // If over.id is a column ID, use it directly
        if (isOverColumnId && overId !== column.id) {
          const targetColumn = columns[overId];
          if (targetColumn) {
            const targetPosition = calculateTargetPosition(targetColumn);
            await onColumnReorder(column.id, targetPosition);
            return;
          }
        }
        
        // Handle column-top drop zone
        if (overData?.type === 'column-top' || (overId && overId.toString().endsWith('-top-drop'))) {
          const targetColumnId = overData?.columnId || overId?.toString().replace('-top-drop', '');
          if (targetColumnId && targetColumnId !== column.id && columns[targetColumnId]) {
            const targetColumn = columns[targetColumnId];
            const targetPosition = calculateTargetPosition(targetColumn);
            await onColumnReorder(column.id, targetPosition);
            return;
          }
        }
        
        // CRITICAL FIX: If we're dragging a column but ended on a task, find the parent column
        // This happens when collision detection fails to filter out tasks, but we can recover
        if (overData?.type === 'task') {
          const taskColumnId = overData.task?.columnId || overData.columnId;
          if (taskColumnId && taskColumnId !== column.id) {
            const targetColumn = columns[taskColumnId];
            if (targetColumn) {
              const targetPosition = calculateTargetPosition(targetColumn);
              await onColumnReorder(column.id, targetPosition);
            }
          }
          return;
        }
        
        // Only process if we dropped on another column (fallback for direct column drops)
        if (overData?.type === 'column' && overData.column?.id !== column.id) {
          // Calculate target position based on drag direction and edge cases
          const targetPosition = calculateTargetPosition(overData.column);
          // console.log('🔄 Column reorder:', column.id, '→ position', targetPosition);
          await onColumnReorder(column.id, targetPosition);
        }
        // Note: column-middle is for tasks only, not columns, so we don't handle it here
      }
    } catch (error) {
      // console.error('❌ Drag operation failed:', error);
    } finally {
      // Always clear drag UI state (preview, dragged task) — including when `over` was null
      // or when the user cancelled; otherwise insertion placeholders stay mounted and shift columns.
      lastPreviewRef.current = null;
      lastOverIdRef.current = null;
      onDraggedTaskChange?.(null);
      onDraggedColumnChange?.(null);
      onBoardTabHover?.(false);
      onDragPreviewChange?.(null);
      setIsHoveringBoardTabDelayed(false);
      clearBulkDrag();
      setKeyboardMoveLabel(null);
    }
  };

  const handleDragCancel = () => {
    lastPreviewRef.current = null;
    lastOverIdRef.current = null;
    onDraggedTaskChange?.(null);
    onDraggedColumnChange?.(null);
    onBoardTabHover?.(false);
    onDragPreviewChange?.(null);
    setIsHoveringBoardTabDelayed(false);
    activeBulkTaskIdsRef.current = [];
    onDraggedTaskIdsChange?.([]);
    setKeyboardMoveLabel(null);
  };

  return (
    <DndContext
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={customCollisionDetection}
      sensors={sensors}
    >
      {children}
      {keyboardMoveLabel != null && (
        <div
          className="pointer-events-none fixed top-4 left-1/2 z-[10000] -translate-x-1/2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
          role="status"
        >
          <div className="flex items-center space-x-2">
            <span aria-hidden="true">↕️</span>
            <span>
              {t('dnd.keyboardMoveHint', { label: keyboardMoveLabel })}
            </span>
          </div>
        </div>
      )}
    </DndContext>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Only re-render if meaningful props change (ignore children as it's recreated on every render)
  const shouldSkip = (() => {
    // Compare primitive props
    if (prevProps.currentBoardId !== nextProps.currentBoardId) return false; // Re-render
    if (prevProps.isOnline !== nextProps.isOnline) return false; // Re-render
  
  // Compare columns by reference (they should be stable now)
  if (prevProps.columns !== nextProps.columns) {
    // If reference changed, check if structure actually changed
    const prevKeys = Object.keys(prevProps.columns || {}).sort();
    const nextKeys = Object.keys(nextProps.columns || {}).sort();
    if (prevKeys.length !== nextKeys.length || prevKeys.some((k, i) => k !== nextKeys[i])) {
      return false; // Structure changed - re-render
    }
    // Check task counts per column
    const structureChanged = prevKeys.some(key => {
      const prevCount = prevProps.columns[key]?.tasks?.length || 0;
      const nextCount = nextProps.columns[key]?.tasks?.length || 0;
      return prevCount !== nextCount;
    });
    if (structureChanged) return false; // Re-render
  }
  
  // Compare boards by reference and length
  if (prevProps.boards !== nextProps.boards) {
    if (prevProps.boards.length !== nextProps.boards.length) return false; // Re-render
    // Check if board IDs changed
    const prevBoardIds = prevProps.boards.map(b => b.id).sort();
    const nextBoardIds = nextProps.boards.map(b => b.id).sort();
    if (prevBoardIds.some((id, i) => id !== nextBoardIds[i])) return false; // Re-render
  }
  
  // Compare callbacks by reference (they should be stable with useCallback)
  if (prevProps.onTaskMove !== nextProps.onTaskMove) return false; // Re-render
  if (prevProps.onTaskMoveToDifferentBoard !== nextProps.onTaskMoveToDifferentBoard) return false; // Re-render
  if (prevProps.onBulkTaskMove !== nextProps.onBulkTaskMove) return false; // Re-render
  if (prevProps.onClearChecked !== nextProps.onClearChecked) return false; // Re-render
  if (prevProps.onDraggedTaskIdsChange !== nextProps.onDraggedTaskIdsChange) return false; // Re-render
  if (prevProps.checkedTaskIds !== nextProps.checkedTaskIds) return false; // Re-render
  if (prevProps.onColumnReorder !== nextProps.onColumnReorder) return false; // Re-render
  if (prevProps.onDraggedTaskChange !== nextProps.onDraggedTaskChange) return false; // Re-render
  if (prevProps.onDraggedColumnChange !== nextProps.onDraggedColumnChange) return false; // Re-render
  if (prevProps.onBoardTabHover !== nextProps.onBoardTabHover) return false; // Re-render
  if (prevProps.onDragPreviewChange !== nextProps.onDragPreviewChange) return false; // Re-render
  
    // Ignore children prop - it's recreated on every render but doesn't affect our logic
    // Return true to skip re-render
    return true; // Props are equal - skip re-render
  })();
  
  return shouldSkip;
});

// Add displayName for better debugging
SimpleDragDropManager.displayName = 'SimpleDragDropManager';

export default SimpleDragDropManager;
