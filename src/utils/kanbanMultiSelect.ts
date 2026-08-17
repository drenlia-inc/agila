import { Columns, Task } from '../types';

/** Stable column order for a task id from board columns. */
export function getTaskColumnId(taskId: string, columns: Columns): string | null {
  for (const column of Object.values(columns)) {
    if (!column?.tasks?.some((t) => t && t.id === taskId)) continue;
    return column.id;
  }
  return null;
}

export function getCheckedColumnIds(
  checkedTaskIds: Set<string>,
  columns: Columns
): string[] {
  const colIds = new Set<string>();
  checkedTaskIds.forEach((taskId) => {
    const columnId = getTaskColumnId(taskId, columns);
    if (columnId) colIds.add(columnId);
  });
  return Array.from(colIds);
}

export function selectionSpansMultipleColumns(
  checkedTaskIds: Set<string>,
  columns: Columns
): boolean {
  return getCheckedColumnIds(checkedTaskIds, columns).length > 1;
}

export function checkedIdsInColumn(
  checkedTaskIds: Set<string>,
  columnTasks: Task[]
): string[] {
  return columnTasks.filter((t) => checkedTaskIds.has(t.id)).map((t) => t.id);
}

export function allTasksCheckedInColumn(
  checkedTaskIds: Set<string>,
  columnTasks: Task[]
): boolean {
  return columnTasks.length > 0 && columnTasks.every((t) => checkedTaskIds.has(t.id));
}

/**
 * FAB when this column has ≥1 checked task and overall selection is 2+.
 * (One card alone does not show the side menu.)
 */
export function shouldShowColumnBulkFab(
  checkedTaskIds: Set<string>,
  columnTasks: Task[]
): boolean {
  if (checkedTaskIds.size < 2) return false;
  return checkedIdsInColumn(checkedTaskIds, columnTasks).length > 0;
}

/** Undo FAB when selection is empty and this column still holds (or anchored) last bulk-changed tasks. */
export function shouldShowColumnBulkUndo(
  undoTaskIds: string[] | null | undefined,
  columnTasks: Task[],
  checkedCount: number,
  anchorColumnIds?: string[] | null,
  columnId?: string
): boolean {
  if (!undoTaskIds || undoTaskIds.length === 0 || checkedCount > 0) return false;
  const idSet = new Set(undoTaskIds);
  if (columnTasks.some((t) => idSet.has(t.id))) return true;
  if (columnId && anchorColumnIds?.includes(columnId)) return true;
  return false;
}

export type ToggleTaskCheckedOptions = {
  /** Shift+click: select every visible card from the last anchor through this one. */
  range?: boolean;
  /** Visible task ids in column order (same list the user sees). */
  orderedIds?: string[];
};

/** Inclusive slice of `orderedIds` between two task ids, or null if either is missing. */
export function taskIdsInColumnRange(
  orderedIds: string[],
  fromId: string,
  toId: string
): string[] | null {
  const a = orderedIds.indexOf(fromId);
  const b = orderedIds.indexOf(toId);
  if (a < 0 || b < 0) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return orderedIds.slice(lo, hi + 1);
}

/** Checked tasks in a column, sorted by position. */
export function orderedCheckedTasksInColumn(
  checkedTaskIds: Set<string>,
  columnTasks: Task[]
): Task[] {
  return columnTasks
    .filter((t) => checkedTaskIds.has(t.id))
    .slice()
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
}

/** sessionStorage: survive refresh in this tab; cleared on tab close. */
export const KANBAN_MULTISELECT_SESSION_KEY = 'agila:kanbanMultiSelect';

export type KanbanMultiSelectSession = {
  boardId: string;
  taskIds: string[];
};

export function readKanbanMultiSelectSession(): KanbanMultiSelectSession | null {
  try {
    const raw = sessionStorage.getItem(KANBAN_MULTISELECT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const boardId = typeof parsed?.boardId === 'string' ? parsed.boardId : '';
    const taskIds = Array.isArray(parsed?.taskIds)
      ? parsed.taskIds.filter((id: unknown) => typeof id === 'string' && id)
      : [];
    if (!boardId || taskIds.length === 0) return null;
    return { boardId, taskIds };
  } catch {
    return null;
  }
}

export function writeKanbanMultiSelectSession(
  boardId: string | null | undefined,
  taskIds: Set<string>
): void {
  try {
    if (!boardId || taskIds.size === 0) {
      sessionStorage.removeItem(KANBAN_MULTISELECT_SESSION_KEY);
      return;
    }
    const payload: KanbanMultiSelectSession = {
      boardId,
      taskIds: Array.from(taskIds),
    };
    sessionStorage.setItem(KANBAN_MULTISELECT_SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

export function pruneCheckedTaskIds(
  checkedTaskIds: Set<string>,
  columns: Columns
): Set<string> {
  const living = new Set<string>();
  Object.values(columns).forEach((col) => {
    col?.tasks?.forEach((t) => {
      if (t?.id && checkedTaskIds.has(t.id)) living.add(t.id);
    });
  });
  if (living.size === checkedTaskIds.size) {
    let same = true;
    checkedTaskIds.forEach((id) => {
      if (!living.has(id)) same = false;
    });
    if (same) return checkedTaskIds;
  }
  return living;
}
