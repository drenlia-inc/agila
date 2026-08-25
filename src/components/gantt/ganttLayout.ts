import type { CSSProperties } from 'react';

/** Shared task-row sizing for Gantt list + timeline alignment. */
export type GanttTaskViewMode = 'compact' | 'shrink' | 'expand';

const GANTT_ROW_HEIGHT_PX: Record<GanttTaskViewMode, number> = {
  compact: 48,
  shrink: 64,
  expand: 88,
};

export const ganttRowHeightPx = (taskViewMode: string): number => {
  if (taskViewMode === 'compact') return GANTT_ROW_HEIGHT_PX.compact;
  if (taskViewMode === 'shrink') return GANTT_ROW_HEIGHT_PX.shrink;
  return GANTT_ROW_HEIGHT_PX.expand;
};

/** Fixed outer row box — list + timeline must share identical pixel height. */
export const ganttRowBoxStyle = (taskViewMode: string): CSSProperties => {
  const height = ganttRowHeightPx(taskViewMode);
  return {
    height,
    minHeight: height,
    maxHeight: height,
    boxSizing: 'border-box',
  };
};

export const ganttRowPaddingClass = (taskViewMode: string): string =>
  taskViewMode === 'compact' ? 'px-2 py-1' : 'px-2 py-0.5';

/** Left task column — keep wide enough for header nav + resize handle without overlapping day headers. */
export const GANTT_TASK_COLUMN_MIN_WIDTH = 250;
export const GANTT_TASK_COLUMN_MAX_WIDTH = 600;
export const GANTT_TASK_COLUMN_DEFAULT_WIDTH = 320;
/** Default day column width (100% zoom). */
export const GANTT_DAY_COLUMN_PX = 40;
export const GANTT_DAY_ZOOM_STEPS = [24, 32, 40, 56, 72] as const;

export const ganttDayZoomPercent = (dayColumnPx: number): number =>
  Math.round((dayColumnPx / GANTT_DAY_COLUMN_PX) * 100);

export const normalizeGanttDayColumnWidth = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return GANTT_DAY_COLUMN_PX;
  let nearest = GANTT_DAY_ZOOM_STEPS[0];
  let best = Math.abs(n - nearest);
  for (const step of GANTT_DAY_ZOOM_STEPS) {
    const delta = Math.abs(n - step);
    if (delta < best) {
      nearest = step;
      best = delta;
    }
  }
  return nearest;
};

export const stepGanttDayColumnWidth = (current: number, dir: -1 | 1): number => {
  const width = normalizeGanttDayColumnWidth(current);
  const index = GANTT_DAY_ZOOM_STEPS.indexOf(
    width as (typeof GANTT_DAY_ZOOM_STEPS)[number]
  );
  const next = Math.max(0, Math.min(GANTT_DAY_ZOOM_STEPS.length - 1, index + dir));
  return GANTT_DAY_ZOOM_STEPS[next];
};

export const ganttDayGridTemplate = (dayCount: number, dayColumnPx: number): string =>
  `repeat(${dayCount}, ${dayColumnPx}px)`;

const localYmd = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfLocalDayMs = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Bar box in the loaded Gantt window. Tasks outside the window keep a
 * zero-width anchor on the left or right edge so dependency/related lines
 * still meet that row instead of disappearing.
 */
export const ganttBarBoxInDateRange = (
  startDate: Date,
  endDate: Date,
  dateRange: { date: Date }[],
  dateToIndex: Map<string, number>,
  dayColumnPx: number = GANTT_DAY_COLUMN_PX
): { x: number; width: number } | null => {
  if (dateRange.length === 0) return null;
  const last = dateRange.length - 1;
  const rangeStartMs = startOfLocalDayMs(dateRange[0].date);
  const rangeEndMs = startOfLocalDayMs(dateRange[last].date);
  const startMs = startOfLocalDayMs(startDate);
  const endMs = startOfLocalDayMs(endDate);

  if (endMs < rangeStartMs) {
    return { x: 0, width: 0 };
  }
  if (startMs > rangeEndMs) {
    return { x: dateRange.length * dayColumnPx, width: 0 };
  }

  const startIndex = dateToIndex.get(localYmd(startDate)) ?? 0;
  const endIndex = dateToIndex.get(localYmd(endDate)) ?? last;
  const lo = Math.min(startIndex, endIndex);
  const hi = Math.max(startIndex, endIndex);
  return {
    x: lo * dayColumnPx,
    width: Math.max(dayColumnPx, (hi - lo + 1) * dayColumnPx),
  };
};

export const clampGanttTaskColumnWidth = (width: number): number =>
  Math.min(
    GANTT_TASK_COLUMN_MAX_WIDTH,
    Math.max(GANTT_TASK_COLUMN_MIN_WIDTH, Math.round(width))
  );
