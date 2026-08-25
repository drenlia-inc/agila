import { getActiveSprint, getSprintTransferWorkCounts } from '../api';
import type { Board, Columns, Task } from '../types';
import { getTaskSprintId } from './columnFilters';

export type SprintTransferOffer = {
  fromId: string;
  fromName: string;
  count: number;
  total: number;
};

export type SprintsUpdatedDetail = {
  selectSprintId?: string;
  transferredFromSprintId?: string;
  transferredToSprintId?: string;
};

function isSprintActive(sprint: { is_active?: boolean | number }): boolean {
  return sprint.is_active === true || sprint.is_active === 1;
}

/** Preview whether activating a sprint should offer to move unfinished work. */
export async function fetchSprintTransferOffer(options?: {
  excludeSprintId?: string;
  sprints?: Array<{ id: string; name: string; is_active?: boolean | number }>;
}): Promise<SprintTransferOffer | null> {
  let active: { id: string; name: string } | null = null;
  if (options?.sprints?.length) {
    const found = options.sprints.find(
      (s) => isSprintActive(s) && s.id !== options.excludeSprintId
    );
    if (found) active = { id: found.id, name: found.name };
  }
  if (!active) {
    const fromApi = await getActiveSprint();
    if (fromApi?.id && fromApi.id !== options?.excludeSprintId) {
      active = { id: fromApi.id, name: fromApi.name };
    }
  }
  if (!active?.id) return null;
  const { active: unfinishedCount, total } = await getSprintTransferWorkCounts(active.id);
  if (unfinishedCount <= 0) return null;
  return { fromId: active.id, fromName: active.name, count: unfinishedCount, total };
}

export function notifySprintsUpdated(detail?: string | SprintsUpdatedDetail): void {
  const payload: SprintsUpdatedDetail =
    typeof detail === 'string' || detail === undefined
      ? { selectSprintId: detail }
      : detail;
  window.dispatchEvent(new CustomEvent('sprints-updated', { detail: payload }));
}

export function taskAfterSprintTransfer<T extends Task | Record<string, unknown>>(
  task: T,
  fromSprintId: string,
  toSprintId: string
): T {
  if (getTaskSprintId(task) !== fromSprintId) return task;
  return { ...task, sprintId: toSprintId, sprint_id: toSprintId };
}

export function columnsAfterSprintTransfer(
  columns: Columns,
  fromSprintId: string,
  toSprintId: string
): Columns {
  const next: Columns = {};
  Object.entries(columns || {}).forEach(([columnId, column]) => {
    next[columnId] = {
      ...column,
      tasks: (column.tasks || []).map((task) =>
        taskAfterSprintTransfer(task, fromSprintId, toSprintId)
      ),
    };
  });
  return next;
}

export function boardsAfterSprintTransfer(
  boards: Board[],
  fromSprintId: string,
  toSprintId: string
): Board[] {
  return (boards || []).map((board) => ({
    ...board,
    columns: columnsAfterSprintTransfer(board.columns || {}, fromSprintId, toSprintId),
  }));
}
