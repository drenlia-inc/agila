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
