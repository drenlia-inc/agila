import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskViewMode } from '../utils/userPreferences';

/** Below this count, render every card (virtualization overhead not worth it). */
export const COLUMN_VIRTUALIZE_THRESHOLD = 28;

/** Extra rows above/below the viewport. */
const OVERSCAN = 6;

/** Extra rows while a task drag is in progress (neighbor columns stay populated). */
export const DRAG_OVERSCAN = 20;

/** In-flow drop-preview slot (h-16 + mb-3). */
export const INSERTION_PREVIEW_HEIGHT_PX = 76;

const GAP_PX = 12; // mb-3

/** Row gap between cards (matches Tailwind `mb-3`). */
export const TASK_ROW_GAP_PX = GAP_PX;

/**
 * Estimated card height by density mode (includes bottom gap).
 * Slightly generous so absolute slots rarely clip real cards before measure.
 */
export function estimateTaskRowHeight(mode: TaskViewMode | undefined): number {
  switch (mode) {
    case 'compact':
      return 72 + GAP_PX;
    case 'shrink':
      return 120 + GAP_PX;
    case 'expand':
    default:
      return 188 + GAP_PX;
  }
}

/** Content-only estimate (no gap) — used when measuring absolute rows. */
export function estimateTaskContentHeight(mode: TaskViewMode | undefined): number {
  return estimateTaskRowHeight(mode) - GAP_PX;
}

export type ColumnVirtualRange = {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  /** Y offset for row index within the fixed-height list. */
  offsetForIndex: (index: number) => number;
  /** True when the list is windowed (not a full render). */
  windowed: boolean;
};

function sumRange(
  getSize: (index: number) => number,
  from: number,
  toExclusive: number
): number {
  let total = 0;
  for (let i = from; i < toExclusive; i++) total += getSize(i);
  return total;
}

/**
 * Window a column's task list against the browser viewport.
 * Outer height is always the sum of row sizes (absolute children) so mounting
 * cards cannot change column height and thrash neighboring columns.
 */
export function useColumnVirtualRange(options: {
  itemCount: number;
  getItemSize: (index: number) => number;
  containerRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  forceFullRender?: boolean;
  /** Extra rows to keep mounted (boosted during task drag). */
  overscan?: number;
  trailingHeight?: number;
  pinnedIndex?: number | null;
  layoutKey?: string | number;
}): ColumnVirtualRange {
  const {
    itemCount,
    getItemSize,
    containerRef,
    enabled,
    forceFullRender = false,
    overscan,
    trailingHeight = 0,
    pinnedIndex = null,
    layoutKey,
  } = options;

  const [range, setRange] = useState({ startIndex: 0, endIndex: Math.max(0, itemCount) });
  const lastRangeRef = useRef(range);
  const overscanCount = overscan ?? OVERSCAN;

  const totalHeight = useMemo(() => {
    if (itemCount <= 0) return trailingHeight;
    return sumRange(getItemSize, 0, itemCount) + trailingHeight;
  }, [getItemSize, itemCount, trailingHeight]);

  const offsetForIndex = useCallback(
    (index: number) => sumRange(getItemSize, 0, Math.max(0, index)),
    [getItemSize]
  );

  const shouldWindow =
    enabled &&
    !forceFullRender &&
    itemCount >= COLUMN_VIRTUALIZE_THRESHOLD;

  const recompute = useCallback(() => {
    if (!shouldWindow) {
      const next = { startIndex: 0, endIndex: itemCount };
      lastRangeRef.current = next;
      setRange(next);
      return;
    }

    const el = containerRef.current;
    if (!el) {
      const next = { startIndex: 0, endIndex: Math.min(itemCount, OVERSCAN * 2) };
      lastRangeRef.current = next;
      setRange(next);
      return;
    }

    const rect = el.getBoundingClientRect();
    const viewportTop = 0;
    const viewportBottom = window.innerHeight;

    if (rect.bottom < viewportTop) {
      // List is entirely above the viewport (shorter column, scrolled to the
      // bottom of a taller neighbor). Keep the last cards mounted so a drop
      // in the empty space below is not measured against the first window.
      const next = {
        startIndex: Math.max(0, itemCount - overscanCount),
        endIndex: itemCount,
      };
      lastRangeRef.current = next;
      setRange((prev) =>
        prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next
      );
      return;
    }
    if (rect.top > viewportBottom) {
      const next = { startIndex: 0, endIndex: Math.min(itemCount, overscanCount) };
      lastRangeRef.current = next;
      setRange((prev) =>
        prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next
      );
      return;
    }

    const visibleTop = Math.max(0, viewportTop - rect.top);
    const visibleBottom = Math.min(Math.max(rect.height, 1), viewportBottom - rect.top);

    let acc = 0;
    let start = 0;
    for (; start < itemCount; start++) {
      const size = getItemSize(start);
      if (acc + size > visibleTop) break;
      acc += size;
    }

    let end = start;
    for (; end < itemCount; end++) {
      if (acc >= visibleBottom) break;
      acc += getItemSize(end);
    }

    start = Math.max(0, start - overscanCount);
    end = Math.min(itemCount, end + overscanCount);

    if (pinnedIndex != null && pinnedIndex >= 0 && pinnedIndex < itemCount) {
      start = Math.min(start, Math.max(0, pinnedIndex - 1));
      end = Math.max(end, Math.min(itemCount, pinnedIndex + 2));
    }

    const next = { startIndex: start, endIndex: end };
    lastRangeRef.current = next;
    setRange((prev) =>
      prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next
    );
  }, [shouldWindow, itemCount, getItemSize, containerRef, pinnedIndex, overscanCount]);

  useEffect(() => {
    recompute();
  }, [recompute, layoutKey]);

  useEffect(() => {
    if (!shouldWindow) return;

    let raf = 0;
    const onScrollOrResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        recompute();
      });
    };

    // Bubble-phase only — capture was firing for every nested scroll and remounting all columns.
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [shouldWindow, recompute]);

  if (!shouldWindow) {
    return {
      startIndex: 0,
      endIndex: itemCount,
      totalHeight,
      offsetForIndex,
      windowed: false,
    };
  }

  const { startIndex, endIndex } = range;

  return {
    startIndex,
    endIndex,
    totalHeight,
    offsetForIndex,
    windowed: true,
  };
}
