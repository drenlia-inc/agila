/**
 * Utility functions for task reordering within and across columns
 *
 * APPROACH:
 * - MOVE: Frontend reorders to indices [0,1,2,3...], sends ALL positions
 * - COPY: Backend creates with originalPos - 0.5 (above original), frontend renumbers ALL
 * - Drop intent is anchor-relative (before/after/start/end), resolved against the FULL column
 * - Always use clean integer positions for reliability
 * - Optimistic writes always derive from setState `prev` and strip taskId from ALL columns
 *   before inserting into the target (prevents duplicate cards under concurrent moves / WS)
 */

import { Task, Columns } from '../types';
import { batchUpdateTaskPositions } from '../api';
import { DRAG_COOLDOWN_DURATION } from '../constants';
import { dndLog } from './dndDebug';
import type { Dispatch, SetStateAction } from 'react';

// Helper to parse position as number
const parsePos = (pos: any): number => typeof pos === 'number' ? pos : parseFloat(String(pos)) || 0;

/**
 * Drop intent from DnD / UI. Resolved against the full column via resolveDropIndex.
 */
export type TaskDropPlacement =
  | { kind: 'before'; taskId: string }
  | { kind: 'after'; taskId: string }
  | { kind: 'start' }
  | { kind: 'end' };

/**
 * Resolve a drop placement to an insert index in the full column
 * (index into the list with draggedTaskId removed, if present).
 */
export function resolveDropIndex(
  fullTasks: Task[],
  placement: TaskDropPlacement,
  draggedTaskId?: string,
  /** Extra ids to treat as part of the drag block (follower multi-drag). */
  additionalDraggedIds: string[] = []
): number {
  const excludeIds = new Set<string>(additionalDraggedIds);
  if (draggedTaskId) excludeIds.add(draggedTaskId);

  const sorted = [...fullTasks].sort((a, b) => parsePos(a.position) - parsePos(b.position));
  const originalIndex = draggedTaskId
    ? sorted.findIndex(t => t.id === draggedTaskId)
    : -1;
  const withoutDragged =
    excludeIds.size > 0 ? sorted.filter((t) => !excludeIds.has(t.id)) : sorted;

  if (placement.kind === 'start') {
    return 0;
  }
  if (placement.kind === 'end') {
    return withoutDragged.length;
  }

  // Dropping before/after yourself (common when returning to the original slot):
  // the anchor is removed with the dragged task, so findIndex fails and used to
  // fall through to "append at end". Restore the original index instead.
  if (draggedTaskId && placement.taskId === draggedTaskId) {
    return originalIndex >= 0
      ? Math.min(originalIndex, withoutDragged.length)
      : withoutDragged.length;
  }
  if (excludeIds.has(placement.taskId)) {
    return originalIndex >= 0
      ? Math.min(originalIndex, withoutDragged.length)
      : withoutDragged.length;
  }

  const anchorIdx = withoutDragged.findIndex(t => t.id === placement.taskId);
  if (anchorIdx < 0) {
    return withoutDragged.length;
  }
  if (placement.kind === 'before') {
    return anchorIdx;
  }
  // after
  return anchorIdx + 1;
}

/** Renumber tasks in a column to sequential integer positions. */
function renumberTasks(tasks: Task[]): Task[] {
  return [...tasks]
    .sort((a, b) => parsePos(a.position) - parsePos(b.position))
    .map((t, index) => ({ ...t, position: index }));
}

/** Minimum gap between fractional positions before falling back to full renumber. */
const MIN_POSITION_GAP = 0.1;

/**
 * Position between two neighbors (NUMERIC column). Returns null when a full
 * renumber is required (collision / gap too small).
 */
export function computeBetweenPosition(
  beforePos: number | null,
  afterPos: number | null
): number | null {
  if (beforePos == null && afterPos == null) return 0;
  if (beforePos == null) return afterPos! - 1;
  if (afterPos == null) return beforePos + 1;
  if (afterPos - beforePos < MIN_POSITION_GAP) return null;
  return (beforePos + afterPos) / 2;
}

function sortTasksByPosition(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => parsePos(a.position) - parsePos(b.position));
}

/**
 * Remove a task from every column (invariant: one task id → at most one column).
 * Optionally renumber columns that changed.
 */
export function stripTaskFromAllColumns(
  columns: Columns,
  taskId: string,
  options?: { exceptColumnId?: string; renumber?: boolean }
): Columns {
  const except = options?.exceptColumnId;
  const renumber = options?.renumber !== false;
  let changed = false;
  const next: Columns = { ...columns };

  for (const columnId of Object.keys(next)) {
    if (except && columnId === except) continue;
    const col = next[columnId];
    if (!col?.tasks?.length) continue;
    if (!col.tasks.some((t) => t && t.id === taskId)) continue;
    changed = true;
    const filtered = col.tasks.filter((t) => t && t.id !== taskId);
    next[columnId] = {
      ...col,
      tasks: renumber ? renumberTasks(filtered) : filtered,
    };
  }

  return changed ? next : columns;
}

/**
 * If the same task id appears in multiple columns, keep only one copy:
 * prefer the column matching task.columnId, else the first seen.
 */
export function dedupeTasksInColumns(columns: Columns): Columns {
  const claimed = new Map<string, string>(); // taskId → keeper columnId
  // First pass: prefer placements that match task.columnId
  for (const columnId of Object.keys(columns)) {
    const col = columns[columnId];
    if (!col?.tasks) continue;
    for (const task of col.tasks) {
      if (!task?.id) continue;
      const preferred = task.columnId || (task as any).columnid;
      if (preferred === columnId && !claimed.has(task.id)) {
        claimed.set(task.id, columnId);
      }
    }
  }
  // Second pass: claim remaining first-seen
  for (const columnId of Object.keys(columns)) {
    const col = columns[columnId];
    if (!col?.tasks) continue;
    for (const task of col.tasks) {
      if (!task?.id) continue;
      if (!claimed.has(task.id)) claimed.set(task.id, columnId);
    }
  }

  let changed = false;
  const next: Columns = { ...columns };
  for (const columnId of Object.keys(next)) {
    const col = next[columnId];
    if (!col?.tasks?.length) continue;
    const filtered = col.tasks.filter((t) => t?.id && claimed.get(t.id) === columnId);
    if (filtered.length !== col.tasks.length) {
      changed = true;
      next[columnId] = { ...col, tasks: renumberTasks(filtered) };
    }
  }
  return changed ? next : columns;
}

function findTaskInColumns(columns: Columns, taskId: string): { task: Task; columnId: string } | null {
  for (const columnId of Object.keys(columns)) {
    const col = columns[columnId];
    const task = col?.tasks?.find((t) => t && t.id === taskId);
    if (task) return { task, columnId };
  }
  return null;
}

type CrossMoveResult = {
  next: Columns;
  sourceColumnId: string;
  targetColumnId: string;
  /** Rows to send to batch-update-positions (often a single fractional write). */
  positionUpdates: Array<{ taskId: string; position: number; columnId: string }>;
};

/** Pure: move task into targetColumnId at targetIndex (fractional when possible). */
export function applyCrossColumnMove(
  prev: Columns,
  taskId: string,
  targetColumnId: string,
  targetIndex: number,
  taskFallback?: Task
): CrossMoveResult | null {
  if (!prev[targetColumnId]) return null;

  const found = findTaskInColumns(prev, taskId);
  const movedTaskBase = found?.task || taskFallback;
  if (!movedTaskBase) return null;

  const sourceColumnId = found?.columnId || movedTaskBase.columnId || '';

  // Keep neighbor positions intact so we can insert with a midpoint
  let next = stripTaskFromAllColumns(prev, taskId, { renumber: false });
  const targetCol = next[targetColumnId];
  if (!targetCol) return null;

  const targetSorted = sortTasksByPosition(targetCol.tasks || []);
  const clampedIndex = Math.max(0, Math.min(targetIndex, targetSorted.length));

  // Cross-column into top: densify target like add-at-top
  if (clampedIndex === 0) {
    const updatedTask: Task = {
      ...movedTaskBase,
      columnId: targetColumnId,
      position: 0,
    };
    const targetTasks = [
      updatedTask,
      ...targetSorted.map((t, index) => ({
        ...t,
        position: index + 1,
        columnId: targetColumnId,
      })),
    ];
    next = {
      ...next,
      [targetColumnId]: { ...targetCol, tasks: targetTasks },
    };
    return {
      next,
      sourceColumnId,
      targetColumnId,
      positionUpdates: targetTasks.map((t) => ({
        taskId: t.id,
        position: t.position as number,
        columnId: targetColumnId,
      })),
    };
  }

  const beforePos =
    clampedIndex > 0 ? parsePos(targetSorted[clampedIndex - 1].position) : null;
  const afterPos =
    clampedIndex < targetSorted.length
      ? parsePos(targetSorted[clampedIndex].position)
      : null;
  const between = computeBetweenPosition(beforePos, afterPos);

  if (between != null) {
    const updatedTask: Task = {
      ...movedTaskBase,
      columnId: targetColumnId,
      position: between,
    };
    const newTargetOrder = [...targetSorted];
    newTargetOrder.splice(clampedIndex, 0, updatedTask);
    next = {
      ...next,
      [targetColumnId]: { ...targetCol, tasks: newTargetOrder },
    };
    return {
      next,
      sourceColumnId,
      targetColumnId,
      positionUpdates: [
        { taskId: updatedTask.id, position: between, columnId: targetColumnId },
      ],
    };
  }

  // Gaps too tight — renumber target only (source can keep sparse positions)
  const updatedTask: Task = { ...movedTaskBase, columnId: targetColumnId };
  const newTargetOrder = [...targetSorted];
  newTargetOrder.splice(clampedIndex, 0, updatedTask);
  const targetTasks = newTargetOrder.map((t, index) => ({
    ...t,
    position: index,
    columnId: targetColumnId,
  }));
  next = {
    ...next,
    [targetColumnId]: { ...targetCol, tasks: targetTasks },
  };

  return {
    next,
    sourceColumnId,
    targetColumnId,
    positionUpdates: targetTasks.map((t) => ({
      taskId: t.id,
      position: t.position as number,
      columnId: targetColumnId,
    })),
  };
}

type SameColumnMoveResult = {
  next: Columns;
  columnId: string;
  renumberedTasks: Task[];
  noop: boolean;
};

/** Pure: apply same-column reorder against a columns snapshot (fractional when possible). */
export function applySameColumnMove(
  prev: Columns,
  taskId: string,
  columnId: string,
  targetIndex: number,
  taskFallback?: Task
): SameColumnMoveResult | null {
  if (!prev[columnId]) return null;

  const found = findTaskInColumns(prev, taskId);
  const movedTaskBase = found?.task || taskFallback;
  if (!movedTaskBase) return null;

  const priorSorted = sortTasksByPosition(
    (found?.columnId === columnId ? prev[columnId]?.tasks : prev[columnId]?.tasks) || []
  );
  const priorIndex = priorSorted.findIndex((t) => t.id === taskId);

  // Strip without renumbering so neighbors keep their fractional positions
  let next = stripTaskFromAllColumns(prev, taskId, { renumber: false });
  const column = next[columnId];
  if (!column) return null;

  const sortedTasks = sortTasksByPosition(column.tasks || []);
  const clampedIndex = Math.max(0, Math.min(targetIndex, sortedTasks.length));
  if (found?.columnId === columnId && priorIndex === clampedIndex) {
    return { next: prev, columnId, renumberedTasks: priorSorted, noop: true };
  }

  // Move to top: densify like POST /tasks/add-at-top (moved → 0, others → 1..n).
  // Fractional "min - 1" failed when drops missed the top hit target / first card.
  if (clampedIndex === 0) {
    const moved: Task = { ...movedTaskBase, columnId, position: 0 };
    const renumberedTasks = [
      moved,
      ...sortedTasks.map((t, index) => ({ ...t, position: index + 1, columnId })),
    ];
    next = {
      ...next,
      [columnId]: { ...column, tasks: renumberedTasks },
    };
    return { next, columnId, renumberedTasks, noop: false };
  }

  const beforePos =
    clampedIndex > 0 ? parsePos(sortedTasks[clampedIndex - 1].position) : null;
  const afterPos =
    clampedIndex < sortedTasks.length
      ? parsePos(sortedTasks[clampedIndex].position)
      : null;
  const between = computeBetweenPosition(beforePos, afterPos);

  if (between != null) {
    const moved: Task = { ...movedTaskBase, columnId, position: between };
    const newOrder = [...sortedTasks];
    newOrder.splice(clampedIndex, 0, moved);
    next = {
      ...next,
      [columnId]: { ...column, tasks: newOrder },
    };
    return { next, columnId, renumberedTasks: [moved], noop: false };
  }

  const newOrder = [...sortedTasks];
  newOrder.splice(clampedIndex, 0, { ...movedTaskBase, columnId });
  const renumberedTasks = newOrder.map((t, index) => ({
    ...t,
    position: index,
    columnId,
  }));

  next = {
    ...next,
    [columnId]: { ...column, tasks: renumberedTasks },
  };

  return { next, columnId, renumberedTasks, noop: false };
}

export type BulkMoveResult = {
  next: Columns;
  /** Columns whose live task positions need a batch API write. */
  touchedColumnIds: string[];
};

/**
 * Move multiple tasks as one contiguous block into targetColumnId at targetIndex.
 * Preserves relative order of taskIds (caller should pass position-sorted ids).
 */
export function applyBulkMove(
  prev: Columns,
  taskIds: string[],
  targetColumnId: string,
  targetIndex: number
): BulkMoveResult | null {
  if (!prev[targetColumnId] || taskIds.length === 0) return null;

  const moved: Task[] = [];
  for (const taskId of taskIds) {
    const found = findTaskInColumns(prev, taskId);
    if (found?.task) moved.push(found.task);
  }
  if (moved.length === 0) return null;

  let next = prev;
  const touched = new Set<string>([targetColumnId]);
  for (const task of moved) {
    const found = findTaskInColumns(next, task.id);
    if (found?.columnId) touched.add(found.columnId);
    next = stripTaskFromAllColumns(next, task.id, { renumber: true });
  }

  const targetCol = next[targetColumnId];
  if (!targetCol) return null;
  const targetSorted = renumberTasks(targetCol.tasks || []);
  const clampedIndex = Math.max(0, Math.min(targetIndex, targetSorted.length));
  const block = moved.map((t) => ({ ...t, columnId: targetColumnId }));
  const newOrder = [
    ...targetSorted.slice(0, clampedIndex),
    ...block,
    ...targetSorted.slice(clampedIndex),
  ];
  const targetTasks = newOrder.map((t, index) => ({
    ...t,
    position: index,
    columnId: targetColumnId,
  }));

  next = {
    ...next,
    [targetColumnId]: { ...targetCol, tasks: targetTasks },
  };

  return { next, touchedColumnIds: Array.from(touched) };
}

/** Keep filtered board list in lockstep with optimistic reorder (avoids post-drop flash). */
function syncFilteredAfterCrossMove(
  setFilteredColumns: Dispatch<SetStateAction<Columns>> | undefined,
  taskId: string,
  targetColumnId: string,
  targetIndex: number,
  movedTask: Task
) {
  if (!setFilteredColumns) return;
  setFilteredColumns((prev) => {
    const applied = applyCrossColumnMove(prev, taskId, targetColumnId, targetIndex, movedTask);
    if (!applied) {
      // Still strip duplicates from filtered view
      return stripTaskFromAllColumns(prev, taskId, { exceptColumnId: targetColumnId });
    }
    return applied.next;
  });
}

function syncFilteredAfterSameColumnMove(
  setFilteredColumns: Dispatch<SetStateAction<Columns>> | undefined,
  taskId: string,
  columnId: string,
  targetIndex: number,
  movedTask: Task
) {
  if (!setFilteredColumns) return;
  setFilteredColumns((prev) => {
    const applied = applySameColumnMove(prev, taskId, columnId, targetIndex, movedTask);
    if (!applied || applied.noop) return prev;
    return applied.next;
  });
}

/**
 * Preview insert index among a visible (filtered) task list for the pink line.
 */
export function resolvePreviewInsertIndex(
  visibleTasks: Task[],
  placement: TaskDropPlacement,
  draggedTaskId?: string
): number {
  return resolveDropIndex(visibleTasks, placement, draggedTaskId);
}

/**
 * Moves a task to a specific index within its column.
 * Prefer a single fractional position write; renumber the column only when gaps are too small.
 */
export const moveTaskToIndex = async (
  task: Task,
  columnId: string,
  targetIndex: number,
  columns: Columns,
  setColumns: Dispatch<SetStateAction<Columns>>,
  setDragCooldown: (value: boolean) => void,
  refreshBoardData: () => Promise<void>,
  setFilteredColumns?: Dispatch<SetStateAction<Columns>>
): Promise<void> => {
  // Pre-check against current snapshot (fast fail); authoritative apply uses prev
  const preview = applySameColumnMove(columns, task.id, columnId, targetIndex, task);
  if (!preview) {
    console.error('❌ [moveTaskToIndex] Column/task not found:', columnId, task.id);
    return;
  }
  if (preview.noop) {
    return;
  }

  dndLog('🎯 [moveTaskToIndex]', {
    taskId: task.id,
    columnId,
    targetIndex,
  });

  let applied: SameColumnMoveResult | null = null;
  const rollbackSnapshot = columns;

  window.justUpdatedFromWebSocket = true;
  (window as any).lastOptimisticUpdateTime = Date.now();
  (window as any).reorderingInProgress = true;

  setColumns((prev) => {
    applied = applySameColumnMove(prev, task.id, columnId, targetIndex, task);
    if (!applied || applied.noop) return prev;
    return applied.next;
  });

  if (!applied || applied.noop) {
    window.justUpdatedFromWebSocket = false;
    (window as any).reorderingInProgress = false;
    return;
  }

  syncFilteredAfterSameColumnMove(setFilteredColumns, task.id, columnId, targetIndex, task);

  try {
    const updates = applied.renumberedTasks.map((t) => ({
      taskId: t.id,
      position: t.position as number,
      columnId,
    }));

    await batchUpdateTaskPositions(updates);

    setTimeout(() => {
      window.justUpdatedFromWebSocket = false;
      (window as any).reorderingInProgress = false;
    }, 2000);

    setDragCooldown(true);
    setTimeout(() => {
      setDragCooldown(false);
    }, DRAG_COOLDOWN_DURATION);
  } catch (error) {
    console.error('❌ [moveTaskToIndex] Failed to update positions:', error);
    setColumns(rollbackSnapshot);
    if (setFilteredColumns) {
      // Let filter effect rebuild from rolled-back columns via refresh
    }
    window.justUpdatedFromWebSocket = false;
    (window as any).reorderingInProgress = false;
    refreshBoardData().catch(() => {});
    throw error;
  }
};

// Aliases for backward compatibility
export const moveTaskToPosition = moveTaskToIndex;
export const handleSameColumnReorder = moveTaskToIndex;

/**
 * Handles moving a task from one column to another.
 * Prefer a single fractional write on the moved task; renumber target only when needed.
 */
export const handleCrossColumnMove = async (
  task: Task,
  sourceColumnId: string,
  targetColumnId: string,
  targetIndex: number,
  columns: Columns,
  setColumns: Dispatch<SetStateAction<Columns>>,
  setDragCooldown: (value: boolean) => void,
  refreshBoardData: () => Promise<void>,
  setFilteredColumns?: Dispatch<SetStateAction<Columns>>
): Promise<void> => {
  const preview = applyCrossColumnMove(columns, task.id, targetColumnId, targetIndex, task);
  if (!preview) {
    console.error('❌ [handleCrossColumnMove] Column/task not found');
    return;
  }

  dndLog('🎯 [handleCrossColumnMove]', {
    taskId: task.id,
    sourceColumnId,
    targetColumnId,
    targetIndex,
  });

  let applied: CrossMoveResult | null = null;
  const rollbackSnapshot = columns;

  window.justUpdatedFromWebSocket = true;
  (window as any).lastOptimisticUpdateTime = Date.now();
  (window as any).reorderingInProgress = true;

  setColumns((prev) => {
    applied = applyCrossColumnMove(prev, task.id, targetColumnId, targetIndex, task);
    return applied ? applied.next : prev;
  });

  if (!applied) {
    window.justUpdatedFromWebSocket = false;
    (window as any).reorderingInProgress = false;
    return;
  }

  syncFilteredAfterCrossMove(setFilteredColumns, task.id, targetColumnId, targetIndex, task);

  try {
    const updates = applied.positionUpdates;

    // If source was unknown (task only in fallback), still send target renumbers
    const dedupedUpdates = updates.filter((u) => u.columnId);

    await batchUpdateTaskPositions(dedupedUpdates);

    setTimeout(() => {
      window.justUpdatedFromWebSocket = false;
      (window as any).reorderingInProgress = false;
    }, 2000);

    setDragCooldown(true);
    setTimeout(() => {
      setDragCooldown(false);
    }, DRAG_COOLDOWN_DURATION);
  } catch (error) {
    console.error('❌ [handleCrossColumnMove] Failed to move task:', error);
    setColumns(rollbackSnapshot);
    window.justUpdatedFromWebSocket = false;
    (window as any).reorderingInProgress = false;
    refreshBoardData().catch(() => {});
    throw error;
  }
};

/**
 * Move many tasks as one block into targetColumnId at targetIndex (position-sorted caller order).
 */
export const handleBulkMoveTasks = async (
  taskIds: string[],
  targetColumnId: string,
  targetIndex: number,
  columns: Columns,
  setColumns: Dispatch<SetStateAction<Columns>>,
  setDragCooldown: (value: boolean) => void,
  refreshBoardData: () => Promise<void>,
  setFilteredColumns?: Dispatch<SetStateAction<Columns>>
): Promise<void> => {
  if (taskIds.length === 0) return;
  const preview = applyBulkMove(columns, taskIds, targetColumnId, targetIndex);
  if (!preview) return;

  let applied: BulkMoveResult | null = null;
  const rollbackSnapshot = columns;

  window.justUpdatedFromWebSocket = true;
  (window as any).lastOptimisticUpdateTime = Date.now();
  (window as any).reorderingInProgress = true;

  setColumns((prev) => {
    applied = applyBulkMove(prev, taskIds, targetColumnId, targetIndex);
    return applied ? applied.next : prev;
  });

  if (!applied) {
    window.justUpdatedFromWebSocket = false;
    (window as any).reorderingInProgress = false;
    return;
  }

  if (setFilteredColumns) {
    setFilteredColumns((prev) => {
      const next = applyBulkMove(prev, taskIds, targetColumnId, targetIndex);
      return next ? next.next : prev;
    });
  }

  try {
    const updates: Array<{ taskId: string; position: number; columnId: string }> = [];
    for (const columnId of applied.touchedColumnIds) {
      const tasks = applied.next[columnId]?.tasks || [];
      tasks.forEach((t) => {
        updates.push({
          taskId: t.id,
          position: Number(t.position) || 0,
          columnId,
        });
      });
    }
    await batchUpdateTaskPositions(updates);
    setTimeout(() => {
      window.justUpdatedFromWebSocket = false;
      (window as any).reorderingInProgress = false;
    }, 2000);
    setDragCooldown(true);
    setTimeout(() => setDragCooldown(false), DRAG_COOLDOWN_DURATION);
  } catch (error) {
    console.error('❌ [handleBulkMoveTasks] Failed:', error);
    setColumns(rollbackSnapshot);
    window.justUpdatedFromWebSocket = false;
    (window as any).reorderingInProgress = false;
    refreshBoardData().catch(() => {});
    throw error;
  }
};

/**
 * Renumbers all tasks in a column after a copy operation.
 * Gets CURRENT state to avoid stale closure issues.
 */
export const renumberColumnAfterCopy = async (
  columnId: string,
  setColumns: Dispatch<SetStateAction<Columns>>
): Promise<void> => {
  let columnTasks: Task[] | null = null;

  setColumns((prev) => {
    columnTasks = prev[columnId]?.tasks ? [...prev[columnId].tasks] : null;
    return prev;
  });

  if (!columnTasks) {
    console.error('❌ [renumberColumnAfterCopy] Column not found:', columnId);
    return;
  }

  const tasksSnapshot = columnTasks as Task[];
  const sortedTasks = [...tasksSnapshot].sort((a, b) => parsePos(a.position) - parsePos(b.position));
  const renumberedTasks = sortedTasks.map((t, index) => ({
    ...t,
    position: index,
  }));

  dndLog('🔄 [renumberColumnAfterCopy] Renumbering', renumberedTasks.length, 'tasks');

  setColumns((prev) => ({
    ...prev,
    [columnId]: {
      ...prev[columnId],
      tasks: renumberedTasks,
    },
  }));

  try {
    const updates = renumberedTasks.map((t) => ({
      taskId: t.id,
      position: t.position as number,
      columnId,
    }));
    await batchUpdateTaskPositions(updates);
  } catch (error) {
    console.error('❌ [renumberColumnAfterCopy] Failed:', error);
  }
};
