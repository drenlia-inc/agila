import { parseLocalDate } from './dateUtils';
import type { Task } from '../types';

export function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeekSunday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function isSameDayLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Resolve display start/end for a task; null if undated. */
export function getTaskDateSpan(
  task: Task
): { start: Date; end: Date; startYmd: string; endYmd: string } | null {
  const startRaw = task.startDate?.trim();
  const dueRaw = task.dueDate?.trim();
  if (!startRaw && !dueRaw) return null;

  if (startRaw && dueRaw) {
    const start = parseLocalDate(startRaw);
    const end = parseLocalDate(dueRaw);
    if (end < start) {
      return {
        start: end,
        end: start,
        startYmd: formatLocalYmd(end),
        endYmd: formatLocalYmd(start),
      };
    }
    return {
      start,
      end,
      startYmd: formatLocalYmd(start),
      endYmd: formatLocalYmd(end),
    };
  }

  if (startRaw) {
    const start = parseLocalDate(startRaw);
    const ymd = formatLocalYmd(start);
    return { start, end: start, startYmd: ymd, endYmd: ymd };
  }

  const end = parseLocalDate(dueRaw!);
  const ymd = formatLocalYmd(end);
  return { start: end, end, startYmd: ymd, endYmd: ymd };
}

export function shiftTaskDates(
  task: Task,
  dayDelta: number
): { startDate: string; dueDate?: string } | null {
  const span = getTaskDateSpan(task);
  if (!span) return null;
  const newStart = addDaysLocal(span.start, dayDelta);
  const newEnd = addDaysLocal(span.end, dayDelta);
  const startDate = formatLocalYmd(newStart);
  const dueDate = formatLocalYmd(newEnd);
  if (task.startDate?.trim() && !task.dueDate?.trim()) {
    return { startDate };
  }
  if (!task.startDate?.trim() && task.dueDate?.trim()) {
    return { startDate: dueDate, dueDate };
  }
  return { startDate, dueDate };
}

/** Month grid: 6 weeks × 7 days starting Sunday covering the month of `focus`. */
export function buildMonthCells(focus: Date): Date[] {
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = startOfWeekSunday(first);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(addDaysLocal(gridStart, i));
  }
  return cells;
}

export function buildWeekCells(focus: Date): Date[] {
  const start = startOfWeekSunday(focus);
  return Array.from({ length: 7 }, (_, i) => addDaysLocal(start, i));
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export interface PlacedBar {
  task: Task;
  start: Date;
  end: Date;
  startYmd: string;
  endYmd: string;
  startIndex: number;
  endIndex: number;
  lane: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

export function placeBarsForDays(
  tasks: Task[],
  days: Date[],
  compareTasks?: (a: Task, b: Task) => number
): PlacedBar[] {
  if (days.length === 0) return [];
  const dayYmids = days.map(formatLocalYmd);
  const dayIndex = new Map(dayYmids.map((ymd, i) => [ymd, i]));
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];

  const candidates: Omit<PlacedBar, 'lane'>[] = [];
  for (const task of tasks) {
    const span = getTaskDateSpan(task);
    if (!span) continue;
    if (!rangesOverlap(span.start, span.end, rangeStart, rangeEnd)) continue;

    const clippedStart = span.start < rangeStart;
    const clippedEnd = span.end > rangeEnd;
    const visibleStart = clippedStart ? rangeStart : span.start;
    const visibleEnd = clippedEnd ? rangeEnd : span.end;
    const startYmd = formatLocalYmd(visibleStart);
    const endYmd = formatLocalYmd(visibleEnd);
    const startIndex = dayIndex.get(startYmd);
    const endIndex = dayIndex.get(endYmd);
    if (startIndex == null || endIndex == null) continue;

    candidates.push({
      task,
      start: span.start,
      end: span.end,
      startYmd: span.startYmd,
      endYmd: span.endYmd,
      startIndex,
      endIndex,
      clippedStart,
      clippedEnd,
    });
  }

  candidates.sort((a, b) => {
    const taskOrder = compareTasks?.(a.task, b.task) ?? 0;
    if (taskOrder !== 0) return taskOrder;
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return b.endIndex - a.endIndex;
  });

  const laneEnds: number[] = [];
  const placed: PlacedBar[] = [];
  for (const c of candidates) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= c.startIndex) {
      lane++;
    }
    if (lane === laneEnds.length) laneEnds.push(-1);
    laneEnds[lane] = c.endIndex;
    placed.push({ ...c, lane });
  }
  return placed;
}
