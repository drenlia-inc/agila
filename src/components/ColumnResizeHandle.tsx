import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_HEADER_STICKY_TOP_FALLBACK_PX } from '../hooks/useAppHeaderStickyTop';

interface ColumnResizeHandleProps {
  onResize: (deltaX: number) => void;
  isColumnBeingDragged?: boolean;
  /** Hide and disable while a task card is being dragged (avoids stealing DnD hover). */
  isTaskBeingDragged?: boolean;
  /** Viewport `top` floor when the guide sticks during vertical scroll. */
  stickyTopPx?: number;
}

type LineGeometry = {
  /** Column-local Y (not viewport) so horizontal scroll is CSS, not JS. */
  top: number;
  height: number;
  visible: boolean;
};

const MIN_LINE_HEIGHT_PX = 44;
const HIT_WIDTH_PX = 14;
/** Fade only in the last stretch of the column, not across the whole line. */
const FADE_LENGTH_PX = 300;

const LINE_FADE_MASK = `linear-gradient(to bottom, #000 0%, #000 max(0px, calc(100% - ${FADE_LENGTH_PX}px)), transparent 100%)`;

function measureLineGeometry(
  columnWrap: HTMLElement,
  stickyTopPx: number
): LineGeometry {
  const wrapRect = columnWrap.getBoundingClientRect();

  if (wrapRect.right < 0 || wrapRect.left > window.innerWidth) {
    return { top: 0, height: 0, visible: false };
  }

  const columnBox =
    columnWrap.querySelector<HTMLElement>('.column-container') ?? columnWrap;
  const columnRect = columnBox.getBoundingClientRect();

  const columnId = columnWrap.getAttribute('data-kanban-column-id');
  const header =
    (columnId
      ? document.querySelector<HTMLElement>(`[data-kanban-header-column-id="${columnId}"]`)
      : null) ?? columnWrap.querySelector<HTMLElement>('[data-kanban-column-title]');

  const pinBelowHeader =
    (header?.getBoundingClientRect().bottom ?? stickyTopPx) + 4;

  const topVp = Math.max(columnRect.top, pinBelowHeader);
  const height = Math.max(0, columnRect.bottom - topVp);

  return {
    top: topVp - wrapRect.top,
    height: Math.max(MIN_LINE_HEIGHT_PX, height),
    visible: height > 0,
  };
}

/**
 * Resize handle on the right edge of a Kanban column. Height follows this
 * column (not the shorter neighbor). Anchored in the column (`absolute`) so
 * horizontal board scroll stays in sync; Y starts below the sticky header.
 * Hidden while a task/column is dragged so it cannot steal DnD.
 */
const ColumnResizeHandle: React.FC<ColumnResizeHandleProps> = ({
  onResize,
  isColumnBeingDragged = false,
  isTaskBeingDragged = false,
  stickyTopPx = APP_HEADER_STICKY_TOP_FALLBACK_PX,
}) => {
  const { t } = useTranslation('tasks');
  const columnWrapRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const [line, setLine] = useState<LineGeometry>({
    top: 0,
    height: 0,
    visible: false,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const syncGeometry = useCallback(() => {
    const marker = columnWrapRef.current;
    const columnWrap = marker?.parentElement;
    if (!marker || !columnWrap) return;
    setLine(measureLineGeometry(columnWrap, stickyTopPx));
  }, [stickyTopPx]);

  useLayoutEffect(() => {
    syncGeometry();

    const columnWrap = columnWrapRef.current?.parentElement;
    const scrollers = [
      window,
      columnWrap?.closest('[data-kanban-scroll="board"]'),
      columnWrap?.closest('[data-kanban-scroll="trash"]'),
      document.querySelector('.kanban-scrollable-container'),
    ].filter(Boolean) as Array<EventTarget>;

    const onScrollOrResize = () => syncGeometry();
    scrollers.forEach((target) => {
      target.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
    });
    window.addEventListener('resize', onScrollOrResize);

    const ro = columnWrap ? new ResizeObserver(onScrollOrResize) : null;
    if (columnWrap && ro) {
      ro.observe(columnWrap);
      const columnBox = columnWrap.querySelector('.column-container');
      if (columnBox) ro.observe(columnBox);
      const taskList = columnWrap.querySelector('[data-kanban-task-list]');
      if (taskList) ro.observe(taskList);
    }

    return () => {
      scrollers.forEach((target) => {
        target.removeEventListener('scroll', onScrollOrResize, { capture: true });
      });
      window.removeEventListener('resize', onScrollOrResize);
      ro?.disconnect();
    };
  }, [syncGeometry]);

  useEffect(() => {
    const hit = hitRef.current;
    if (!hit) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (isColumnBeingDragged || isTaskBeingDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      setIsDragging(true);
      startXRef.current = e.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - startXRef.current;
      onResize(deltaX);
      startXRef.current = e.clientX;
      syncGeometry();
    };

    const handleUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    hit.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleUp);

    return () => {
      hit.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onResize, isColumnBeingDragged, isTaskBeingDragged, syncGeometry, line.visible]);

  const resizeDisabled = isColumnBeingDragged || isTaskBeingDragged;
  const active = !resizeDisabled && (isHovered || isDragging);
  const showLine = line.visible && !resizeDisabled;

  return (
    <>
      {/* Gap anchor — tracks horizontal column position; no pointer hit target */}
      <div
        ref={columnWrapRef}
        className="absolute top-0 h-px w-px opacity-0 pointer-events-none"
        style={{ right: '-12px', transform: 'translateX(-50%)' }}
        aria-hidden
      />

      {showLine && (
        <div
          ref={hitRef}
          className={`absolute z-30 ${
            resizeDisabled ? 'cursor-not-allowed opacity-30' : 'cursor-col-resize'
          }`}
          style={{
            right: '-12px',
            top: line.top,
            height: line.height,
            width: HIT_WIDTH_PX,
            transform: 'translateX(-50%)',
          }}
          title={t('kanban.resizeColumn')}
          aria-label={t('kanban.resizeColumn')}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div
            className={`absolute left-1/2 top-0 w-px -translate-x-1/2 transition-colors duration-150 ${
              active
                ? 'bg-blue-400 dark:bg-blue-500'
                : 'bg-gray-300/90 dark:bg-gray-500/90'
            }`}
            style={{
              height: '100%',
              WebkitMaskImage: LINE_FADE_MASK,
              maskImage: LINE_FADE_MASK,
            }}
          />
          <div
            className={`absolute left-1/2 top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-150 ${
              active
                ? 'bg-blue-500 shadow-sm dark:bg-blue-400'
                : 'bg-gray-300/90 dark:bg-gray-500/90'
            }`}
          />
        </div>
      )}
    </>
  );
};

export default ColumnResizeHandle;
