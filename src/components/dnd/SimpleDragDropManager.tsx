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
} from '../../utils/taskReorderingUtils';
import {
  getTaskDragOverlayRect,
  findPlaceholderHitByOverlay,
  readPaintedDropPlaceholder,
  resolveKanbanDropTarget,
  resolveColumnIdUnderPointer,
  resolveColumnIdUnderRect,
  OVERLAY_SIDEWAYS_PX,
  type OverlayDropHit,
} from '../../utils/dndInsertIndex';

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
  /** Always-current selection; drag-start must not depend on a memoized render. */
  checkedTaskIdsRef?: React.MutableRefObject<Set<string>>;
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

function excludeIdsForDrag(leaderId: string | null | undefined, bulkIds: string[]): string[] {
  if (bulkIds.length > 1) return bulkIds;
  return leaderId ? [leaderId] : [];
}

function asHit(
  preview: { targetColumnId: string; insertIndex: number } | null | undefined
): OverlayDropHit | null {
  if (!preview) return null;
  return { columnId: preview.targetColumnId, insertIndex: preview.insertIndex };
}

function firstDestHit(
  originColumnId: string | null | undefined,
  ...hits: Array<OverlayDropHit | null | undefined>
): OverlayDropHit | null {
  const origin = originColumnId || null;
  for (const hit of hits) {
    if (hit && hit.columnId !== origin) return hit;
  }
  return null;
}

type TaskDropLock = {
  taskId: string;
  originColumnId: string;
  dest: OverlayDropHit;
};

let taskDropLock: TaskDropLock | null = null;
let taskDropEpoch = 0;
let taskDropMovedEpoch = -1;

function setTaskDropLock(
  taskId: string | null | undefined,
  originColumnId: string | null | undefined,
  dest: OverlayDropHit | null | undefined
): void {
  if (!taskId || !originColumnId || !dest) return;
  if (dest.columnId === originColumnId) return;
  taskDropLock = { taskId, originColumnId, dest };
}

function peekTaskDropLock(taskId: string): TaskDropLock | null {
  if (taskDropLock && taskDropLock.taskId === taskId) return taskDropLock;
  return null;
}

function clearTaskDropLock(taskId?: string): void {
  if (!taskId || taskDropLock?.taskId === taskId) taskDropLock = null;
}

function freezeCommitAgainstOrigin(
  originColumnId: string | null | undefined,
  painted: OverlayDropHit | null,
  preview: { targetColumnId: string; insertIndex: number } | null,
  overlaySnap: OverlayDropHit | null,
  lastDest: OverlayDropHit | null
): OverlayDropHit | null {
  const dest = firstDestHit(
    originColumnId,
    lastDest,
    painted,
    asHit(preview),
    overlaySnap
  );
  if (dest) return dest;
  if (painted) return painted;
  if (preview) return asHit(preview);
  return overlaySnap;
}

// Custom collision detection: prefer pointer hits; scope work to nearby droppables on large boards.
const customCollisionDetection = (args: any) => {
  const activeData = args.active?.data?.current;
  const isDraggingColumn = activeData?.type === 'column';
  const pointer = args.pointerCoordinates as { x: number; y: number } | null;
  const allContainers: any[] = args.droppableContainers || [];

  // Narrow candidates before pointerWithin / closestCorners (both are O(droppables)).
  let containers = allContainers;
  if (pointer && allContainers.length > 40) {
    const underPointer: any[] = [];
    const boardTabs: any[] = [];
    for (const container of allContainers) {
      const data = container.data?.current;
      if (data?.type === 'board' && data?.boardId) {
        boardTabs.push(container);
        continue;
      }
      const rect = container.rect?.current;
      if (!rect) continue;
      // Slight vertical padding so edges between cards still register
      if (
        pointer.x >= rect.left &&
        pointer.x <= rect.right &&
        pointer.y >= rect.top - 8 &&
        pointer.y <= rect.bottom + 8
      ) {
        underPointer.push(container);
      }
    }
    if (underPointer.length > 0) {
      containers = isDraggingColumn
        ? underPointer
        : underPointer.concat(boardTabs);
    }
  }

  const scopedArgs = { ...args, droppableContainers: containers };

  const columnIds = isDraggingColumn
    ? containers
        .filter((container: any) => {
          const data = container.data?.current;
          return (
            data?.type === 'column' ||
            (container.id &&
              !container.id.toString().includes('-middle') &&
              !container.id.toString().includes('-drop'))
          );
        })
        .map((container: any) => container.id)
    : [];

  const pointerCollisions = pointerWithin(scopedArgs);

  const columnCollisions = pointerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    const isColumnType =
      data?.type === 'column' ||
      data?.type === 'column-top' ||
      data?.type === 'board-area';
    const isColumnId = columnIds.length > 0 && columnIds.includes(collision.id);
    return isColumnType || isColumnId || data?.type === 'task';
  });

  if (columnCollisions.length > 0) {
    if (isDraggingColumn) {
      const columnOnlyCollisions = columnCollisions.filter((collision: any) => {
        const data = collision.data?.current;
        const isColumnType =
          data?.type === 'column' ||
          data?.type === 'column-top' ||
          data?.type === 'board-area';
        const isColumnId = columnIds.length > 0 && columnIds.includes(collision.id);
        return isColumnType || isColumnId;
      });
      return columnOnlyCollisions.length > 0 ? columnOnlyCollisions : [];
    }

    const taskCollisions = columnCollisions.filter(
      (collision: any) => collision.data?.current?.type === 'task'
    );
    if (taskCollisions.length > 0) return taskCollisions;
    return columnCollisions;
  }

  // Fallback: closestCorners only on the scoped set (avoid second full-board scan)
  const cornerCollisions = closestCorners(scopedArgs);
  const cornerColumnCollisions = cornerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    return (
      data?.type === 'column' ||
      data?.type === 'column-top' ||
      data?.type === 'board-area' ||
      data?.type === 'task'
    );
  });

  if (cornerColumnCollisions.length > 0) {
    if (isDraggingColumn) {
      const cornerColumnOnly = cornerColumnCollisions.filter((collision: any) => {
        const data = collision.data?.current;
        return (
          data?.type === 'column' ||
          data?.type === 'column-top' ||
          data?.type === 'board-area'
        );
      });
      return cornerColumnOnly.length > 0 ? cornerColumnOnly : [];
    }
    const cornerTaskCollisions = cornerColumnCollisions.filter(
      (collision: any) => collision.data?.current?.type === 'task'
    );
    if (cornerTaskCollisions.length > 0) return cornerTaskCollisions;
    return cornerColumnCollisions;
  }

  const strictBoardCollisions = pointerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    return data?.type === 'board' && data?.boardId;
  });

  const nonBoardCornerCollisions = cornerCollisions.filter((collision: any) => {
    const data = collision.data?.current;
    return data?.type !== 'board';
  });

  if (
    strictBoardCollisions.length === 1 &&
    pointerCollisions.length === 1 &&
    nonBoardCornerCollisions.length === 0
  ) {
    return strictBoardCollisions;
  }

  if (nonBoardCornerCollisions.length > 0) {
    if (isDraggingColumn) {
      const filteredNonBoard = nonBoardCornerCollisions.filter((collision: any) => {
        const data = collision.data?.current;
        return (
          data?.type === 'column' ||
          data?.type === 'column-top' ||
          data?.type === 'board-area'
        );
      });
      return filteredNonBoard.length > 0 ? filteredNonBoard : [];
    }
    return nonBoardCornerCollisions;
  }

  if (isDraggingColumn) {
    const filteredCorner = cornerCollisions.filter((collision: any) => {
      const data = collision.data?.current;
      return (
        data?.type === 'column' ||
        data?.type === 'column-top' ||
        data?.type === 'board-area'
      );
    });
    return filteredCorner.length > 0 ? filteredCorner : [];
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
  checkedTaskIdsRef,
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
  
  // Pointer / tab-hit geometry — refs only (never setState on mousemove; that re-rendered the whole app shell)
  const mouseYRef = useRef(0);
  const mouseXRef = useRef(0);
  const tabAreaBoundsRef = useRef({ top: 0, bottom: 80 });
  const isHoveringBoardTabRef = useRef(false);
  
  // Cache for drag preview to avoid recalculating on every drag over event
  const lastPreviewRef = useRef<{ targetColumnId: string; insertIndex: number; isCrossColumn: boolean } | null>(null);
  const dragOriginRef = useRef<{ columnId: string; insertIndex: number; y: number } | null>(null);
  const overlayRectRef = useRef<DOMRect | null>(null);
  const overlaySnapRef = useRef<{ columnId: string; insertIndex: number } | null>(null);
  // Frozen at pointerup while Drop here is still painted — handleDragEnd
  // must not recompute against the origin column after the overlay unmounts.
  const releaseDropRef = useRef<OverlayDropHit | null>(null);
  const pendingCommitRef = useRef<OverlayDropHit | null>(null);
  const lastDestPreviewRef = useRef<OverlayDropHit | null>(null);
  const taskDropConsumedRef = useRef(false);
  const overlayStartTopRef = useRef<number | null>(null);
  const overlayStartLeftRef = useRef<number | null>(null);
  const isDraggingTaskRef = useRef(false);
  const draggedTaskIdRef = useRef<string | null>(null);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const liveCheckedRef = useRef(checkedTaskIds);
  liveCheckedRef.current = checkedTaskIds;
  const liveCheckedIds = (): Set<string> | undefined =>
    checkedTaskIdsRef?.current ?? liveCheckedRef.current;
  const rafHandleRef = useRef<number | null>(null);
  const lastProcessTimeRef = useRef<number>(0);
  const THROTTLE_MS = 16; // ~60fps max

  const capturePendingCommit = () => {
    const origin = dragOriginRef.current;
    const originColumnId = origin?.columnId || null;
    const overlay = getTaskDragOverlayRect() || overlayRectRef.current;
    overlayRectRef.current = overlay;
    const excludeIds = excludeIdsForDrag(
      draggedTaskIdRef.current,
      activeBulkTaskIdsRef.current
    );
    overlaySnapRef.current = overlay
      ? findPlaceholderHitByOverlay(overlay, excludeIds)
      : overlaySnapRef.current;
    const live = resolveKanbanDropTarget({
      pointerX: mouseXRef.current,
      pointerY: mouseYRef.current,
      overlay,
      origin,
      excludeTaskIds: excludeIds,
      overlayStartLeft: overlayStartLeftRef.current,
    });
    const painted = readPaintedDropPlaceholder();
    const preview = lastPreviewRef.current;
    const sideways =
      overlay != null &&
      overlayStartLeftRef.current != null &&
      Math.abs(overlay.left - overlayStartLeftRef.current) >= OVERLAY_SIDEWAYS_PX;
    const pointerCol = resolveColumnIdUnderPointer(
      mouseXRef.current,
      mouseYRef.current
    );
    const liveDest =
      live && originColumnId && live.columnId !== originColumnId ? live : null;
    const keepStickyDest =
      !liveDest &&
      !!lastDestPreviewRef.current &&
      (sideways || (!!pointerCol && pointerCol !== originColumnId));
    const chosen =
      liveDest ||
      (keepStickyDest ? lastDestPreviewRef.current : null) ||
      live ||
      firstDestHit(originColumnId, painted, asHit(preview), overlaySnapRef.current);
    pendingCommitRef.current = chosen;
    releaseDropRef.current = chosen;
    if (chosen && originColumnId && chosen.columnId !== originColumnId) {
      lastDestPreviewRef.current = chosen;
      setTaskDropLock(draggedTaskIdRef.current, originColumnId, chosen);
    }
    return chosen;
  };
  const capturePendingCommitRef = useRef(capturePendingCommit);
  capturePendingCommitRef.current = capturePendingCommit;

  const commitTaskDrop = async (taskId: string, reason: string): Promise<boolean> => {
    if (taskDropConsumedRef.current) return false;
    const origin = dragOriginRef.current;
    const lock = peekTaskDropLock(taskId);
    const sourceColumnId =
      lock?.originColumnId || origin?.columnId || '';
    capturePendingCommit();
    const frozen = pendingCommitRef.current;
    if (!frozen) {
      return false;
    }
    taskDropConsumedRef.current = true;
    taskDropMovedEpoch = taskDropEpoch;
    pendingCommitRef.current = null;
    const placement: TaskDropPlacement = {
      kind: 'atIndex',
      index: frozen.insertIndex,
    };
    const bulkIds = activeBulkTaskIdsRef.current;
    dndLog('🎯 [commitTaskDrop] onTaskMove', {
      taskId,
      targetColumnId: frozen.columnId,
      placement,
      sourceColumnId,
      reason,
      bulkCount: bulkIds.length,
    });
    if (bulkIds.length > 1 && onBulkTaskMove) {
      await onBulkTaskMove(bulkIds, frozen.columnId, placement);
    } else {
      await onTaskMove(taskId, frozen.columnId, placement);
    }
    clearTaskDropLock(taskId);
    return true;
  };
  const commitTaskDropRef = useRef(commitTaskDrop);
  commitTaskDropRef.current = commitTaskDrop;
  
  // Debug: Track drag over call count
  const dragOverCallCountRef = useRef<number>(0);
  const dragOverSkippedCountRef = useRef<number>(0);
  const dragOverProcessedCountRef = useRef<number>(0);

  // Track pointer for board-tab / column-top drop recovery without React re-renders
  useEffect(() => {
    const handleMove = (e: MouseEvent | PointerEvent) => {
      mouseYRef.current = e.clientY;
      mouseXRef.current = e.clientX;
      if (!isDraggingTaskRef.current) return;
      const overlay = getTaskDragOverlayRect();
      if (overlay) overlayRectRef.current = overlay;
    };

    document.addEventListener('pointermove', handleMove, { passive: true });
    document.addEventListener('mousemove', handleMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('mousemove', handleMove);
    };
  }, []);

  // Window auto-scroll while dragging a task. dnd-kit's scroller latches onto
  // `overflow-x-auto` board chrome and never moves the page, so edge-drags stall.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!isDraggingTaskRef.current) return;
      const y = mouseYRef.current;
      const x = mouseXRef.current;
      const edge = 56;
      const maxStep = 24;
      if (y < edge) {
        const t = (edge - y) / edge;
        window.scrollBy(0, -Math.max(8, t * maxStep));
      } else if (y > window.innerHeight - edge) {
        const t = (y - (window.innerHeight - edge)) / edge;
        window.scrollBy(0, Math.max(8, t * maxStep));
      }
      const scroller = document.querySelector('.kanban-scrollable-container');
      if (scroller instanceof HTMLElement) {
        const r = scroller.getBoundingClientRect();
        if (x < r.left + 48) scroller.scrollLeft -= 18;
        else if (x > r.right - 48) scroller.scrollLeft += 18;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onRelease = (e: PointerEvent) => {
      mouseXRef.current = e.clientX;
      mouseYRef.current = e.clientY;
      const isLostCapture = e.type === 'lostpointercapture';
      if (isLostCapture && e.buttons !== 0) return;
      const taskId = draggedTaskIdRef.current;
      if (!isDraggingTaskRef.current && !pendingCommitRef.current && !taskId) return;
      if (isDraggingTaskRef.current) {
        capturePendingCommitRef.current();
        if (rafHandleRef.current !== null) {
          cancelAnimationFrame(rafHandleRef.current);
          rafHandleRef.current = null;
        }
      }
      if (!isLostCapture) {
        isDraggingTaskRef.current = false;
      }
      if (taskId) {
        void commitTaskDropRef.current(taskId, 'destAtRelease');
        draggedTaskIdRef.current = null;
      }
    };
    window.addEventListener('pointerup', onRelease, true);
    window.addEventListener('pointercancel', onRelease, true);
    window.addEventListener('lostpointercapture', onRelease, true);
    return () => {
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('pointercancel', onRelease, true);
      window.removeEventListener('lostpointercapture', onRelease, true);
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
    lastPreviewRef.current = null;
    dragOriginRef.current = null;
    overlayRectRef.current = null;
    overlaySnapRef.current = null;
    releaseDropRef.current = null;
    pendingCommitRef.current = null;
    lastDestPreviewRef.current = null;
    clearTaskDropLock();
    taskDropConsumedRef.current = false;
    taskDropEpoch += 1;
    taskDropMovedEpoch = -1;
    overlayStartTopRef.current = null;
    overlayStartLeftRef.current = null;
    isDraggingTaskRef.current = false;
    draggedTaskIdRef.current = null;
    
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
        tabAreaBoundsRef.current = bounds;
        return bounds;
      } else {
        // console.warn('⚠️ Could not find tab container, using fallback bounds');
        const fallback = { top: 0, bottom: 80 };
        tabAreaBoundsRef.current = fallback;
        return fallback;
      }
    };
    
    // Detect bounds at drag start
    detectTabBounds();
    
    // Reset all states at drag start to ensure clean state
    onBoardTabHover?.(false);
    onDragPreviewChange?.(null);
    
    // Reset tab area state
    isHoveringBoardTabRef.current = false;
    
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
      const checked = liveCheckedIds();
      const isChecked = !!checked?.has(task.id);

      if (checked && checked.size > 0 && !isChecked) {
        // Unchecked card drag clears multi-check and runs single-task drag
        onClearChecked?.();
        activeBulkTaskIdsRef.current = [];
        onDraggedTaskIdsChange?.([]);
      } else if (isChecked && checked && checked.size >= 1) {
        // Follower multi-drag only when all checked share one column
        const liveColumns = columnsRef.current;
        const sourceColumnId = task.columnId;
        const ordered = (liveColumns[sourceColumnId]?.tasks || [])
          .slice()
          .sort((a, b) => parsePos(a.position) - parsePos(b.position))
          .filter((t) => checked.has(t.id));
        const allSameColumn = Array.from(checked).every((id) => {
          for (const col of Object.values(liveColumns)) {
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
      isDraggingTaskRef.current = true;
      draggedTaskIdRef.current = task.id;
      const originTasks = columnsRef.current[task.columnId]?.tasks || [];
      const originSorted = [...originTasks].sort(
        (a, b) => parsePos(a.position) - parsePos(b.position)
      );
      const originIndex = originSorted.findIndex((t) => t.id === task.id);
      const blockIds =
        activeBulkTaskIdsRef.current.length > 1
          ? activeBulkTaskIdsRef.current
          : [task.id];
      const blockSet = new Set(blockIds);
      let remappedOrigin = 0;
      for (const t of originSorted) {
        if (t.id === task.id) break;
        if (!blockSet.has(t.id)) remappedOrigin++;
      }
      dragOriginRef.current = {
        columnId: task.columnId,
        insertIndex: Math.max(0, remappedOrigin),
        y: mouseYRef.current,
      };
    } else if (activeData?.type === 'column') {
      const column = activeData.column as Column;
      onDraggedColumnChange?.(column);
      // Reduced console noise
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active } = event;
    
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
      if (!isDraggingTaskRef.current && active.data?.current?.type === 'task') {
        return;
      }
      
      // FIRST: Check for mouse-based tab area detection (before any other logic)
      const isTaskDrag = active.data?.current?.type === 'task';
      
      if (isTaskDrag) {
        // Pure Y-coordinate based detection using dynamic tab bounds
        const bounds = tabAreaBoundsRef.current;
        const isInTabArea =
          mouseYRef.current >= bounds.top && mouseYRef.current <= bounds.bottom;
        
        if (isInTabArea && !isHoveringBoardTabRef.current) {
          isHoveringBoardTabRef.current = true;
          onBoardTabHover?.(true);
          lastPreviewRef.current = null;
          onDragPreviewChange?.(null);
        } else if (!isInTabArea && isHoveringBoardTabRef.current) {
          isHoveringBoardTabRef.current = false;
          onBoardTabHover?.(false);
        }
      }
      
      if (isTaskDrag && isHoveringBoardTabRef.current) {
        return;
      }

      const draggedTask = active.data?.current?.task as Task | undefined;
      if (isTaskDrag && draggedTask) {
        const origin = dragOriginRef.current;
        const excludeIds = excludeIdsForDrag(
          draggedTask.id,
          activeBulkTaskIdsRef.current
        );
        const overlay = getTaskDragOverlayRect();
        if (overlay) {
          overlayRectRef.current = overlay;
          if (overlayStartTopRef.current == null) {
            overlayStartTopRef.current = overlay.top;
            overlayStartLeftRef.current = overlay.left;
          }
        }
        const hit = resolveKanbanDropTarget({
          pointerX: mouseXRef.current,
          pointerY: mouseYRef.current,
          overlay,
          origin,
          excludeTaskIds: excludeIds,
          overlayStartLeft: overlayStartLeftRef.current,
        });
        const columnId = hit?.columnId || null;
        if (!columnId || !columnsRef.current[columnId] || hit == null) {
          return;
        }
        const insertIndex = hit.insertIndex;
        if (insertIndex == null) return;
        const originColumnId = origin?.columnId || draggedTask.columnId;
        let nextColumnId = columnId;
        let nextInsert = insertIndex;
        if (nextColumnId !== originColumnId) {
          lastDestPreviewRef.current = { columnId: nextColumnId, insertIndex: nextInsert };
          setTaskDropLock(draggedTask.id, originColumnId, lastDestPreviewRef.current);
        } else if (lastDestPreviewRef.current) {
          const last = lastDestPreviewRef.current;
          const pointerCol = resolveColumnIdUnderPointer(
            mouseXRef.current,
            mouseYRef.current
          );
          const overlayCol = overlay
            ? resolveColumnIdUnderRect(
                overlay,
                originColumnId,
                overlayStartLeftRef.current
              )
            : null;
          const sideways =
            overlay != null &&
            overlayStartLeftRef.current != null &&
            Math.abs(overlay.left - overlayStartLeftRef.current) >= OVERLAY_SIDEWAYS_PX;
          const pointerInOrigin = pointerCol === originColumnId;
          const pointerDest =
            pointerCol && pointerCol !== originColumnId ? pointerCol : null;
          const overlayDest =
            overlayCol && overlayCol !== originColumnId ? overlayCol : null;
          if (pointerInOrigin && !sideways) {
            lastDestPreviewRef.current = null;
          } else if (pointerDest && pointerDest !== last.columnId) {
            lastDestPreviewRef.current = {
              columnId: pointerDest,
              insertIndex: nextInsert,
            };
            nextColumnId = pointerDest;
            setTaskDropLock(
              draggedTask.id,
              originColumnId,
              lastDestPreviewRef.current
            );
          } else if (overlayDest && overlayDest !== last.columnId) {
            lastDestPreviewRef.current = {
              columnId: overlayDest,
              insertIndex: nextInsert,
            };
            nextColumnId = overlayDest;
            setTaskDropLock(
              draggedTask.id,
              originColumnId,
              lastDestPreviewRef.current
            );
          } else if (!overlay) {
            nextColumnId = last.columnId;
            nextInsert = last.insertIndex;
          } else if (pointerDest || overlayDest) {
            nextColumnId = last.columnId;
            nextInsert = last.insertIndex;
          } else {
            lastDestPreviewRef.current = null;
          }
        }
        const newPreview = {
          targetColumnId: nextColumnId,
          insertIndex: nextInsert,
          isCrossColumn: originColumnId !== nextColumnId,
        };
        if (
          !lastPreviewRef.current ||
          lastPreviewRef.current.targetColumnId !== newPreview.targetColumnId ||
          lastPreviewRef.current.insertIndex !== newPreview.insertIndex ||
          lastPreviewRef.current.isCrossColumn !== newPreview.isCrossColumn
        ) {
          lastPreviewRef.current = newPreview;
          onDragPreviewChange?.(newPreview);
        }
        return;
      }

      if (!isTaskDrag && lastPreviewRef.current !== null) {
        lastPreviewRef.current = null;
        onDragPreviewChange?.(null);
      }
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const bulkIds = activeBulkTaskIdsRef.current;
    const clearBulkDrag = () => {
      activeBulkTaskIdsRef.current = [];
      onDraggedTaskIdsChange?.([]);
    };

    // Freeze the painted Drop here: a pending dragOver frame must not
    // recompute insert after the user has already released.
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }

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
    const activeData = active.data?.current;
    const previewAtEnd = lastPreviewRef.current;

    try {
      // Task drops can commit from pointer Y even when dnd-kit `over` is null
      // (common after long virtualized scrolls). Column drags still need a target.
      if (!over && activeData?.type !== 'task') {
        return;
      }

      const overData = over?.data?.current;

      dndLog('🎯 Processing drag end:', {
        activeDataType: activeData?.type,
        overDataType: overData?.type,
        activeTaskId: activeData?.task?.id,
        overTaskId: overData?.task?.id,
        hasPreview: !!previewAtEnd,
        previewInsert: previewAtEnd?.insertIndex,
      });

      if (activeData?.type === 'task') {
        dndLog('🎯 Entering task move logic');
        const task = activeData.task as Task;
        dndLog('🎯 Task data:', { taskId: task.id, taskTitle: task.title, taskColumnId: task.columnId, taskPosition: task.position });
        
        if (overData?.type === 'board' && overData.boardId !== currentBoardId) {
          const bounds = tabAreaBoundsRef.current;
          const isInTabAreaAtDrop =
            mouseYRef.current >= bounds.top && mouseYRef.current <= bounds.bottom;
          
          if (!isInTabAreaAtDrop) {
            // Don't execute cross-board move if mouse is outside tab area
            return;
          }
          
          dndLog('🔄 Cross-board move (Y-coord approved):', task.id, '→', overData.boardId);
          if (bulkIds.length > 1) {
            dndLog('🎯 [handleDragEnd] Multi-drag board-tab drop deferred — no-op');
            return;
          }
          await onTaskMoveToDifferentBoard(task.id, overData.boardId);
          dndLog('✅ Cross-board move completed');
        } else {
          dndLog('🎯 Same board move — Drop here preview first');
          await commitTaskDrop(task.id, 'destAtRelease');
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
      dragOriginRef.current = null;
      releaseDropRef.current = null;
      pendingCommitRef.current = null;
      isDraggingTaskRef.current = false;
      onDraggedTaskChange?.(null);
      onDraggedColumnChange?.(null);
      onBoardTabHover?.(false);
      onDragPreviewChange?.(null);
      isHoveringBoardTabRef.current = false;
      clearBulkDrag();
      setKeyboardMoveLabel(null);
    }
  };

  const handleDragCancel = () => {
    const taskId = draggedTaskIdRef.current;
    if (taskId && !taskDropConsumedRef.current) {
      void commitTaskDropRef.current(taskId, 'destAtRelease');
    }
    lastPreviewRef.current = null;
    isDraggingTaskRef.current = false;
    onDraggedTaskChange?.(null);
    onDraggedColumnChange?.(null);
    onBoardTabHover?.(false);
    onDragPreviewChange?.(null);
    isHoveringBoardTabRef.current = false;
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
      autoScroll={false}
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
      const prevTasks = prevProps.columns[key]?.tasks || [];
      const nextTasks = nextProps.columns[key]?.tasks || [];
      if (prevTasks.length !== nextTasks.length) return true;
      return prevTasks.some(
        (t, i) =>
          t.id !== nextTasks[i]?.id ||
          String(t.position) !== String(nextTasks[i]?.position)
      );
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
