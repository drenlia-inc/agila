/**
 * Days since the task entered its current column (local calendar days).
 * Returns 0 for missing/invalid timestamps.
 */
export function getColumnAgeDays(columnEnteredAt?: string | null): number {
  if (!columnEnteredAt) return 0;
  const entered = new Date(columnEnteredAt);
  if (Number.isNaN(entered.getTime())) return 0;
  const ms = Date.now() - entered.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** True when column has a positive WIP limit. */
export function hasWipLimit(wipLimit?: number | null): boolean {
  return wipLimit != null && Number(wipLimit) > 0;
}

/**
 * Soft WIP status for a column using unfiltered task count.
 * - under: below limit
 * - at: exactly at limit
 * - over: above limit
 * - none: no limit configured
 */
export function getWipStatus(
  taskCount: number,
  wipLimit?: number | null
): 'none' | 'under' | 'at' | 'over' {
  if (!hasWipLimit(wipLimit)) return 'none';
  const limit = Number(wipLimit);
  if (taskCount > limit) return 'over';
  if (taskCount === limit) return 'at';
  return 'under';
}

/**
 * Board soft WIP counts only “active” work: live tasks in columns that are
 * neither finished (done) nor archived. Soft-deleted tasks are never in column.tasks.
 */
export function isBoardWipActiveColumn(column: {
  is_finished?: boolean | null;
  is_archived?: boolean | null;
} | null | undefined): boolean {
  if (!column) return false;
  return !Boolean(column.is_finished) && !Boolean(column.is_archived);
}

export function getBoardWipTaskCount(
  columns: Record<string, { tasks?: unknown[]; is_finished?: boolean | null; is_archived?: boolean | null } | undefined> | null | undefined
): number {
  if (!columns) return 0;
  let total = 0;
  for (const column of Object.values(columns)) {
    if (!isBoardWipActiveColumn(column)) continue;
    total += Array.isArray(column?.tasks) ? column.tasks.length : 0;
  }
  return total;
}

/** Tasks in active (non-finished, non-archived) columns — for board WIP effort pills. */
export function getBoardWipTasks(
  columns: Record<
    string,
    {
      tasks?: Array<{ effort?: number | null }>;
      is_finished?: boolean | null;
      is_archived?: boolean | null;
    } | undefined
  > | null | undefined
): Array<{ effort?: number | null }> {
  if (!columns) return [];
  const tasks: Array<{ effort?: number | null }> = [];
  for (const column of Object.values(columns)) {
    if (!isBoardWipActiveColumn(column) || !Array.isArray(column?.tasks)) continue;
    for (const task of column.tasks) {
      if (task) tasks.push(task);
    }
  }
  return tasks;
}
