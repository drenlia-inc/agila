import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  APP_HEADER_STICKY_SELECTOR,
  APP_HEADER_STICKY_TOP_FALLBACK_PX,
} from './useAppHeaderStickyTop';

export const KANBAN_COLUMN_HEADER_PORTAL_STYLE: CSSProperties = {
  position: 'fixed',
  top: 'var(--kanban-col-header-top, 0px)',
  left: 'var(--kanban-col-header-left, 0px)',
  width: 'var(--kanban-col-header-width, auto)',
  margin: 0,
  boxSizing: 'border-box',
  backgroundColor: 'var(--column-bg)',
  visibility: 'var(--kanban-col-header-visibility, hidden)',
  // Cover a peek strip if the sticky logo rubber-bands a frame ahead of us.
  boxShadow: '0 -24px 0 0 var(--column-bg)',
};

export type StickyKanbanColumnHeader = {
  placeholderRef: RefObject<HTMLDivElement | null>;
  placeholderHeightPx: number;
  isStuck: boolean;
};

function columnContentBox(column: HTMLElement): { left: number; width: number } {
  const rect = column.getBoundingClientRect();
  const cs = getComputedStyle(column);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  return {
    left: rect.left + padL,
    width: Math.max(0, rect.width - padL - padR),
  };
}

function boardExtentBottom(column: HTMLElement | null): number {
  const board = column?.closest('.board-drop-area, [data-tour-id="kanban-columns"]');
  if (board instanceof HTMLElement) {
    return board.getBoundingClientRect().bottom;
  }
  return column?.getBoundingClientRect().bottom ?? Infinity;
}

/** Live bottom of the sticky logo bar (moves during trackpad rubber-band). */
function readAppHeaderBottom(fallbackPx: number): number {
  const header = document.querySelector(APP_HEADER_STICKY_SELECTOR);
  if (header instanceof HTMLElement) {
    return header.getBoundingClientRect().bottom;
  }
  return fallbackPx > 0 ? fallbackPx : APP_HEADER_STICKY_TOP_FALLBACK_PX;
}

function pinStuckHeader(
  header: HTMLElement,
  top: number,
  left: number,
  width: number
): void {
  header.style.setProperty('--kanban-col-header-top', `${top}px`);
  header.style.setProperty('--kanban-col-header-left', `${left}px`);
  header.style.setProperty('--kanban-col-header-width', `${width}px`);
  header.style.setProperty('--kanban-col-header-visibility', 'visible');
}

/**
 * Keep the title in document flow until it reaches the logo bar.
 * Only then portal + position:fixed — in-flow headers rubber-band with the
 * cards on trackpad overscroll, so they never stretch away.
 * While stuck, top tracks the logo bar's live bottom so rubber-band cannot
 * open a peek strip between logo and titles.
 */
export function useStickyKanbanColumnHeader(
  headerRef: RefObject<HTMLElement | null>,
  columnRef: RefObject<HTMLElement | null>,
  stickyTopPx: number,
  enabled: boolean
): StickyKanbanColumnHeader {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);
  const [placeholderHeightPx, setPlaceholderHeightPx] = useState(0);
  const lastHeightRef = useRef(0);

  useLayoutEffect(() => {
    if (!enabled) {
      setIsStuck(false);
      return;
    }

    const readStuck = (): boolean => {
      const placeholder = placeholderRef.current;
      const column = columnRef.current;
      if (!placeholder) return false;
      const stickyTop = readAppHeaderBottom(stickyTopPx);
      const placeholderTop = placeholder.getBoundingClientRect().top;
      // Use the board row, not this column — short columns must stay titled.
      return placeholderTop <= stickyTop && boardExtentBottom(column) > stickyTop;
    };

    const syncStuck = () => {
      const next = readStuck();
      setIsStuck((prev) => (prev === next ? prev : next));
    };

    syncStuck();

    const placeholder = placeholderRef.current;
    const observer =
      typeof IntersectionObserver !== 'undefined' && placeholder
        ? new IntersectionObserver(syncStuck, {
            root: null,
            rootMargin: `-${Math.max(0, stickyTopPx)}px 0px 0px 0px`,
            threshold: 0,
          })
        : null;
    if (placeholder) observer?.observe(placeholder);

    window.addEventListener('scroll', syncStuck, { capture: true, passive: true });
    window.addEventListener('resize', syncStuck);

    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', syncStuck, true);
      window.removeEventListener('resize', syncStuck);
    };
  }, [columnRef, enabled, stickyTopPx]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const measure = () => {
      const height = header.offsetHeight;
      if (height > 0 && height !== lastHeightRef.current) {
        lastHeightRef.current = height;
        setPlaceholderHeightPx(height);
      }
    };

    measure();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(header);
    return () => resizeObserver?.disconnect();
  }, [enabled, headerRef, isStuck]);

  useLayoutEffect(() => {
    if (!enabled || !isStuck) return;

    let rafId = 0;
    let lastTop = Number.NaN;
    let lastLeft = Number.NaN;
    let lastWidth = Number.NaN;

    const apply = () => {
      const header = headerRef.current;
      const column = columnRef.current;
      if (!header || !column) return;
      const box = columnContentBox(column);
      // Follow the logo bar live — static stickyTopPx leaves a gap on overscroll.
      const top = readAppHeaderBottom(stickyTopPx);
      if (top === lastTop && box.left === lastLeft && box.width === lastWidth) return;
      lastTop = top;
      lastLeft = box.left;
      lastWidth = box.width;
      pinStuckHeader(header, top, box.left, box.width);
    };

    const tick = () => {
      apply();
      // Rubber-band can move sticky chrome without scroll events; keep flush while stuck.
      rafId = window.requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener('scroll', apply, { capture: true, passive: true });
    window.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    const column = columnRef.current;
    const board = column?.closest('.board-drop-area, [data-tour-id="kanban-columns"]');
    const appHeader = document.querySelector(APP_HEADER_STICKY_SELECTOR);
    if (column) resizeObserver?.observe(column);
    if (board instanceof HTMLElement) resizeObserver?.observe(board);
    if (appHeader instanceof HTMLElement) resizeObserver?.observe(appHeader);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', apply, true);
      window.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('scroll', apply);
      resizeObserver?.disconnect();
    };
  }, [columnRef, enabled, headerRef, isStuck, stickyTopPx]);

  return { placeholderRef, placeholderHeightPx, isStuck };
}
