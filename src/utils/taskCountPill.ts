/** Shared styles for board/column task-count pills. */

export const TASK_COUNT_PILL_BASE =
  'inline-flex h-5 items-center justify-center min-w-[1.25rem] rounded-full px-1.5 text-center text-[0.65rem] leading-none tabular-nums whitespace-nowrap';

/** Default count chrome (same whether filters are on or off). */
export const TASK_COUNT_PILL_DEFAULT =
  'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-100';

export const TASK_COUNT_PILL_WIP_AT =
  'bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-100';

export const TASK_COUNT_PILL_WIP_OVER =
  'bg-amber-500 text-white dark:bg-amber-600 dark:text-white';

export type TaskCountWipStatus = 'none' | 'under' | 'at' | 'over' | 'ok';

export function taskCountPillToneClass(wipStatus: TaskCountWipStatus = 'ok'): string {
  if (wipStatus === 'over') return TASK_COUNT_PILL_WIP_OVER;
  if (wipStatus === 'at') return TASK_COUNT_PILL_WIP_AT;
  return TASK_COUNT_PILL_DEFAULT;
}

/** Bold only while filters change what the count means (visible results). */
export function taskCountPillWeightClass(hasActiveFilters: boolean): string {
  return hasActiveFilters ? 'font-bold' : 'font-normal';
}

export function formatTaskCountPill(count: number): string {
  return count > 999 ? '999+' : String(count);
}
