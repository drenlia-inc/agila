import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GANTT_DAY_COLUMN_PX } from './ganttLayout';

interface DateColumn {
  date: Date;
}

interface IndicatorTask {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
}

interface GanttOffscreenTaskIndicatorsProps {
  dateRange: DateColumn[];
  ganttTasks: IndicatorTask[];
  /** Horizontally scrolling timeline that holds the task rows. */
  timelineRef: React.RefObject<HTMLDivElement>;
  /** Sticky date header; its bottom edge is the top of the visible band. */
  headerRef: React.RefObject<HTMLDivElement>;
  /** Scrolls the clicked task's row back into view. */
  onJumpToTask: (taskId: string) => void;
  dayColumnWidth?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Both lanes hug the day-number row rather than the header's outer edges: the
 * top edge is the seam under the Gantt header, which sits in front of this one
 * (higher sticky layer), so a mark there is easy to lose against that border or
 * hidden outright whenever that header is a few pixels taller than its sticky
 * offset assumes. Matches `h-6` on the month row above the day numbers.
 */
const MONTH_ROW_HEIGHT = 24;
/** Visible mark height; the button around it stays taller to be clickable. */
const MARK_HEIGHT = 3;
const HIT_HEIGHT = 9;
/** A row straddling the edge by a couple of pixels still counts as visible. */
const EDGE_TOLERANCE = 2;
/** Denser stretches read darker, capped so the strip stays a hint. */
const LEVEL_OPACITY_CLASS = ['opacity-40', 'opacity-60', 'opacity-80'];

const startOfDayValue = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

type Lane = 'above' | 'below';

interface RowExtent {
  taskId: string;
  top: number;
  bottom: number;
  startIndex: number;
  span: number;
}

interface Segment {
  startIndex: number;
  span: number;
  level: number;
}

interface LaneSegments {
  above: Segment[];
  below: Segment[];
}

const EMPTY_LANES: LaneSegments = { above: [], below: [] };

const laneOf = (row: RowExtent, band: { top: number; bottom: number }): Lane | null => {
  if (row.bottom <= band.top + EDGE_TOLERANCE) return 'above';
  if (row.top >= band.bottom - EDGE_TOLERANCE) return 'below';
  return null;
};

/**
 * Walk a per-day delta array (+1 where a bar starts, -1 after it ends) and
 * merge days of equal density into as few spans as possible, so a busy board
 * still renders a handful of nodes.
 */
const buildSegments = (deltas: Int32Array, days: number): Segment[] => {
  const segments: Segment[] = [];
  let running = 0;
  let openIndex = -1;
  let openLevel = -1;

  const close = (endIndex: number) => {
    if (openIndex < 0) return;
    segments.push({ startIndex: openIndex, span: endIndex - openIndex, level: openLevel });
    openIndex = -1;
    openLevel = -1;
  };

  for (let index = 0; index < days; index += 1) {
    running += deltas[index];
    const level = running === 0 ? -1 : Math.min(running, LEVEL_OPACITY_CLASS.length) - 1;
    if (level === openLevel) continue;
    close(index);
    if (level >= 0) {
      openIndex = index;
      openLevel = level;
    }
  }
  close(days);
  return segments;
};

const signatureOf = (lanes: LaneSegments): string =>
  [lanes.above, lanes.below]
    .map((segments) => segments.map((s) => `${s.startIndex}-${s.span}-${s.level}`).join(','))
    .join('|');

/**
 * Faint marks hugging the date header for the days whose tasks sit above or
 * below the viewport, so a stretch of empty timeline still shows that there is
 * work to scroll to. Clicking a mark jumps to the nearest of those tasks.
 */
export const GanttOffscreenTaskIndicators: React.FC<GanttOffscreenTaskIndicatorsProps> = ({
  dateRange,
  ganttTasks,
  timelineRef,
  headerRef,
  onJumpToTask,
  dayColumnWidth = GANTT_DAY_COLUMN_PX,
}) => {
  const { t } = useTranslation('common');
  const [lanes, setLanes] = useState<LaneSegments>(EMPTY_LANES);
  const rowsRef = useRef<RowExtent[]>([]);
  const signatureRef = useRef(signatureOf(EMPTY_LANES));
  const frameRef = useRef<number | null>(null);

  const commit = useCallback((next: LaneSegments) => {
    const signature = signatureOf(next);
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setLanes(next);
  }, []);

  /** Document-space band between the sticky header and the bottom of the window. */
  const bandBounds = useCallback(() => {
    const header = headerRef.current;
    if (!header) return null;
    return {
      top: header.getBoundingClientRect().bottom + window.scrollY,
      bottom: window.scrollY + window.innerHeight,
    };
  }, [headerRef]);

  /**
   * Cache each row's document-space extent and the columns its bar covers, so
   * scrolling only has to compare numbers instead of re-reading layout.
   */
  const measure = useCallback(() => {
    const timeline = timelineRef.current;
    rowsRef.current = [];
    if (!timeline || dateRange.length === 0) return;

    const rangeStart = startOfDayValue(dateRange[0].date);
    const lastIndex = dateRange.length - 1;
    const spanByTask = new Map<string, { startIndex: number; span: number }>();

    for (const task of ganttTasks) {
      const start = task.startDate;
      const end = task.endDate || task.startDate;
      if (!start || !end) continue;
      const startIndex = Math.round((startOfDayValue(start) - rangeStart) / DAY_MS);
      const endIndex = Math.round((startOfDayValue(end) - rangeStart) / DAY_MS);
      if (endIndex < 0 || startIndex > lastIndex) continue;
      const clampedStart = Math.max(0, startIndex);
      const clampedEnd = Math.min(lastIndex, endIndex);
      spanByTask.set(task.id, {
        startIndex: clampedStart,
        span: clampedEnd - clampedStart + 1,
      });
    }

    const scrollY = window.scrollY;
    timeline.querySelectorAll<HTMLElement>('[data-task-id]').forEach((row) => {
      const taskId = row.dataset.taskId;
      const span = taskId ? spanByTask.get(taskId) : undefined;
      if (!taskId || !span) return;
      const rect = row.getBoundingClientRect();
      rowsRef.current.push({
        taskId,
        top: rect.top + scrollY,
        bottom: rect.bottom + scrollY,
        startIndex: span.startIndex,
        span: span.span,
      });
    });
  }, [dateRange, ganttTasks, timelineRef]);

  const update = useCallback(() => {
    const band = bandBounds();
    const rows = rowsRef.current;
    if (!band || rows.length === 0 || dateRange.length === 0) {
      commit(EMPTY_LANES);
      return;
    }

    const days = dateRange.length;
    const above = new Int32Array(days + 1);
    const below = new Int32Array(days + 1);

    for (const row of rows) {
      const lane = laneOf(row, band);
      if (!lane) continue;
      const deltas = lane === 'above' ? above : below;
      deltas[row.startIndex] += 1;
      deltas[row.startIndex + row.span] -= 1;
    }

    commit({
      above: buildSegments(above, days),
      below: buildSegments(below, days),
    });
  }, [bandBounds, commit, dateRange.length]);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      update();
    });
  }, [update]);

  useEffect(() => {
    measure();
    update();
  }, [measure, update]);

  useEffect(() => {
    const remeasure = () => {
      measure();
      scheduleUpdate();
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', remeasure);

    const timeline = timelineRef.current;
    let observer: ResizeObserver | null = null;
    if (timeline && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(remeasure);
      observer.observe(timeline);
    }

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', remeasure);
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [measure, scheduleUpdate, timelineRef]);

  /** Jump to the off-screen task closest to the viewport on the clicked day. */
  const handleMarkClick = useCallback(
    (segment: Segment, lane: Lane, event: React.MouseEvent<HTMLButtonElement>) => {
      const band = bandBounds();
      if (!band) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const offsetDays = Math.floor((event.clientX - rect.left) / dayColumnWidth);
      const dayIndex =
        segment.startIndex + Math.max(0, Math.min(segment.span - 1, offsetDays));

      let nearest: RowExtent | null = null;
      for (const row of rowsRef.current) {
        if (dayIndex < row.startIndex || dayIndex >= row.startIndex + row.span) continue;
        if (laneOf(row, band) !== lane) continue;
        if (
          !nearest ||
          (lane === 'above' ? row.bottom > nearest.bottom : row.top < nearest.top)
        ) {
          nearest = row;
        }
      }

      if (nearest) onJumpToTask(nearest.taskId);
    },
    [bandBounds, dayColumnWidth, onJumpToTask]
  );

  if (lanes.above.length === 0 && lanes.below.length === 0) return null;

  const renderLane = (segments: Segment[], lane: Lane) => {
    const edgeStyle =
      lane === 'above' ? { top: `${MONTH_ROW_HEIGHT}px` } : { bottom: 0 };
    const label = t(lane === 'above' ? 'gantt.jumpToTaskAbove' : 'gantt.jumpToTaskBelow');

    return segments.map((segment) => (
      <button
        type="button"
        key={`${lane}-${segment.startIndex}-${segment.span}`}
        tabIndex={-1}
        onClick={(event) => handleMarkClick(segment, lane, event)}
        className={`group pointer-events-auto absolute flex cursor-pointer ${
          lane === 'above' ? 'items-start' : 'items-end'
        }`}
        style={{
          left: `${segment.startIndex * dayColumnWidth}px`,
          width: `${segment.span * dayColumnWidth}px`,
          height: `${HIT_HEIGHT}px`,
          ...edgeStyle,
        }}
        title={label}
        aria-label={label}
      >
        <span
          className={`block w-full rounded-full bg-gray-600 transition-opacity group-hover:opacity-100 dark:bg-gray-300 ${
            LEVEL_OPACITY_CLASS[segment.level]
          }`}
          style={{ height: `${MARK_HEIGHT}px` }}
        />
      </button>
    ));
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      role="group"
      aria-label={t('gantt.offscreenTasksIndicator')}
    >
      {renderLane(lanes.above, 'above')}
      {renderLane(lanes.below, 'below')}
    </div>
  );
};

export default GanttOffscreenTaskIndicators;
