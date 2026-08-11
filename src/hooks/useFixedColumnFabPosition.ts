import { useEffect, useState, type RefObject } from 'react';

export type FixedColumnFabPos = {
  top: number;
  left: number;
  visible: boolean;
};

const INITIAL: FixedColumnFabPos = { top: 0, left: 0, visible: false };

function measureFabPos(anchor: HTMLElement | null): FixedColumnFabPos {
  const column = anchor?.closest('.column-container') as HTMLElement | null;
  if (!anchor || !column) {
    return { ...INITIAL, visible: false };
  }

  const columnRect = column.getBoundingClientRect();
  const headerRect = anchor.getBoundingClientRect();
  const visible =
    columnRect.right > 0 &&
    columnRect.left < window.innerWidth &&
    columnRect.bottom > 0 &&
    columnRect.top < window.innerHeight;

  return {
    top: Math.max(96, headerRect.bottom + 4),
    left: Math.max(16, columnRect.left + 2),
    visible,
  };
}

function posEqual(a: FixedColumnFabPos, b: FixedColumnFabPos): boolean {
  return a.top === b.top && a.left === b.left && a.visible === b.visible;
}

/**
 * Keeps a fixed-position column FAB aligned with its header when the board
 * reflows (Search & Filter, Trash, resize, horizontal scroll, etc.).
 */
export function useFixedColumnFabPosition(
  anchorRef: RefObject<HTMLElement | null>
): FixedColumnFabPos {
  const [rootPos, setRootPos] = useState<FixedColumnFabPos>(INITIAL);

  useEffect(() => {
    let rafId = 0;
    let running = true;

    const apply = () => {
      const next = measureFabPos(anchorRef.current);
      setRootPos((prev) => (posEqual(prev, next) ? prev : next));
    };

    const loop = () => {
      if (!running) return;
      apply();
      rafId = window.requestAnimationFrame(loop);
    };

    apply();
    rafId = window.requestAnimationFrame(loop);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    const anchor = anchorRef.current;
    const column = anchor?.closest('.column-container') as HTMLElement | null;
    if (anchor) resizeObserver?.observe(anchor);
    if (column) resizeObserver?.observe(column);
    // Board chrome above columns (search / trash) changes parent layout size
    const boardRoot = column?.parentElement;
    if (boardRoot) resizeObserver?.observe(boardRoot);

    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);

    return () => {
      running = false;
      window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
      window.visualViewport?.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('scroll', apply);
    };
  }, [anchorRef]);

  return rootPos;
}
