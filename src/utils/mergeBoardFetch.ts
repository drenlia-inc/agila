import type { Board, Columns, Task } from '../types';
import { columnsContentFingerprint } from './columnsFingerprint';

/**
 * Server board snapshots can lag a cross-board move on multi-pod / high-latency
 * clusters (in-flight GET started before COMMIT, or a later GET overwriting
 * optimistic state). Keep the mover's local membership until the snapshot agrees.
 */
export function mergeBoardFetchWithLocalMoves(
  server: Board[],
  local: Board[],
  movedFromByTaskId: Map<string, string>,
  recentlyDeletedIds: Set<string>
): Board[] {
  if (movedFromByTaskId.size === 0 && recentlyDeletedIds.size === 0) {
    return server;
  }

  const localPlacement = new Map<string, { boardId: string; task: Task }>();
  for (const board of local) {
    for (const column of Object.values(board.columns || {})) {
      for (const task of column.tasks || []) {
        if (!task?.id) continue;
        localPlacement.set(task.id, { boardId: board.id, task });
      }
    }
  }

  return server.map((board) => {
    const columns: Columns = { ...(board.columns || {}) };
    let changed = false;

    Object.keys(columns).forEach((columnId) => {
      const column = columns[columnId];
      if (!column?.tasks?.length) return;
      const tasks = column.tasks.filter((task) => {
        if (!task?.id) return true;
        if (recentlyDeletedIds.has(task.id) && !movedFromByTaskId.has(task.id)) {
          changed = true;
          return false;
        }
        const sourceBoardId = movedFromByTaskId.get(task.id);
        if (sourceBoardId && sourceBoardId === board.id) {
          changed = true;
          return false;
        }
        return true;
      });
      if (tasks.length !== column.tasks.length) {
        columns[columnId] = { ...column, tasks };
      }
    });

    for (const [taskId, sourceBoardId] of movedFromByTaskId) {
      const placed = localPlacement.get(taskId);
      if (!placed || placed.boardId !== board.id || placed.boardId === sourceBoardId) {
        continue;
      }
      const columnId = placed.task.columnId;
      if (!columnId) continue;
      const column = columns[columnId] || {
        id: columnId,
        boardId: board.id,
        title: '',
        tasks: [],
        position: 0,
        is_finished: false,
        is_archived: false,
      };
      if (column.tasks.some((t) => t.id === taskId)) continue;
      changed = true;
      columns[columnId] = {
        ...column,
        tasks: [...column.tasks, placed.task].sort(
          (a, b) => (a.position || 0) - (b.position || 0)
        ),
      };
    }

    return changed ? { ...board, columns } : board;
  });
}

export function stripMovedOffTasksFromColumns(
  columns: Columns,
  boardId: string,
  movedFromByTaskId: Map<string, string>,
  recentlyDeletedIds: Set<string>
): Columns {
  if (movedFromByTaskId.size === 0 && recentlyDeletedIds.size === 0) {
    return columns;
  }
  let changed = false;
  const next: Columns = { ...columns };
  Object.keys(next).forEach((columnId) => {
    const column = next[columnId];
    if (!column?.tasks?.length) return;
    const tasks = column.tasks.filter((task) => {
      if (!task?.id) return true;
      if (recentlyDeletedIds.has(task.id) && !movedFromByTaskId.has(task.id)) {
        return false;
      }
      const sourceBoardId = movedFromByTaskId.get(task.id);
      if (sourceBoardId && sourceBoardId === boardId) return false;
      return true;
    });
    if (tasks.length !== column.tasks.length) {
      changed = true;
      next[columnId] = { ...column, tasks };
    }
  });
  return changed ? next : columns;
}

const LOCAL_COLUMN_MOVE_TTL_MS = 10000;

/**
 * Same-board DnD updates `columns` immediately, but a GET /full that started
 * before COMMIT (or hit a lagging replica) can put the card back. Prefer the
 * actor's cached columns for boards touched in the last few seconds.
 */
export function preferLocalColumnsForRecentlyTouchedBoards(
  server: Board[],
  local: Board[],
  touchedAtByBoardId: Map<string, number>,
  now = Date.now()
): Board[] {
  if (touchedAtByBoardId.size === 0) return server;
  const localById = new Map(local.map((board) => [board.id, board]));
  return server.map((board) => {
    const touchedAt = touchedAtByBoardId.get(board.id);
    if (touchedAt == null || now - touchedAt > LOCAL_COLUMN_MOVE_TTL_MS) {
      return board;
    }
    const loc = localById.get(board.id);
    if (!loc?.columns || !boardTasksAreHydrated(loc)) return board;
    return { ...board, columns: loc.columns, tasksHydrated: true };
  });
}

export function boardTasksAreHydrated(board?: Board | null): boolean {
  if (!board) return false;
  if (board.tasksHydrated === false) return false;
  if (board.tasksHydrated === true) return true;
  return Object.keys(board.columns || {}).length > 0;
}

/**
 * Summary GET overwrites titles, positions, WIP, and taskCount, but must not
 * replace cached `columns.tasks` with empty arrays.
 */
export function overlayBoardListKeepingTaskCache(summary: Board[], local: Board[]): Board[] {
  const localById = new Map(local.map((board) => [board.id, board]));
  return summary.map((remote) => {
    const loc = localById.get(remote.id);
    if (!loc || !boardTasksAreHydrated(loc)) {
      return remote;
    }
    const remoteCols = remote.columns || {};
    const localCols = loc.columns || {};
    const columns: Columns = {};
    Object.keys(remoteCols).forEach((columnId) => {
      const remoteCol = remoteCols[columnId];
      const localCol = localCols[columnId];
      columns[columnId] = localCol
        ? { ...remoteCol, tasks: localCol.tasks || [] }
        : { ...remoteCol, tasks: [] };
    });
    return {
      ...remote,
      tasksHydrated: true,
      columns,
    };
  });
}

export function boardsCacheFingerprint(boards: Board[]): string {
  return boards
    .map((board) => {
      const chrome = [
        board.id,
        board.title,
        board.position ?? '',
        board.wip_limit ?? '',
        board.participantCount ?? '',
        board.taskCount ?? '',
        board.tasksHydrated ? '1' : '0',
        Object.keys(board.columns || {}).sort().join(','),
      ].join(':');
      return `${chrome}#${columnsContentFingerprint(board.columns)}`;
    })
    .join(';;');
}
