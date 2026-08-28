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
  left: number;
  top: number;
  height: number;
  visible: boolean;
};

const MIN_LINE_HEIGHT_PX = 44;
const EMPTY_COLUMN_LINE_PX = 88;
const HIT_WIDTH_PX = 14;

function visibleTaskRows(columnWrap: HTMLElement): HTMLElement[] {
  const taskList = columnWrap.querySelector('[data-kanban-task-list]');
  const rowNodes = taskList
    ? Array.from(taskList.querySelectorAll<HTMLElement>('[data-kanban-task-row]'))
    : Array.from(columnWrap.querySelectorAll<HTMLElement>('.task-card'));
  return rowNodes.filter((row) => row.getBoundingClientRect().height > 6);
}

function measureLineGeometry(
  columnWrap: HTMLElement,
  gapCenterX: number,
  stickyTopPx: number
): LineGeometry {
  const columnRect = columnWrap.getBoundingClientRect();

  if (columnRect.right < 0 || columnRect.left > window.innerWidth) {
    return { left: gapCenterX, top: 0, height: 0, visible: false };
  }

  const columnId = columnWrap.getAttribute('data-kanban-column-id');
  const header =
    (columnId
      ? document.querySelector<HTMLElement>(`[data-kanban-header-column-id="${columnId}"]`)
      : null) ?? columnWrap.querySelector<HTMLElement>('[data-kanban-column-title]');

  const pinBelowHeader =
    (header?.getBoundingClientRect().bottom ?? stickyTopPx) + 4;

  const rows = visibleTaskRows(columnWrap);
  let anchorTop: number;
  let naturalHeight: number;

  if (rows.length > 0) {
    const firstRect = rows[0].getBoundingClientRect();
    anchorTop = firstRect.top;
    const fadeEnd =
      rows.length >= 3
        ? rows[2].getBoundingClientRect().bottom
        : rows[rows.length - 1].getBoundingClientRect().bottom;
    naturalHeight = Math.max(MIN_LINE_HEIGHT_PX, fadeEnd - anchorTop);
  } else {
    const taskList = columnWrap.querySelector('[data-kanban-task-list]');
    const fallbackEl =
      taskList ??
      columnWrap.querySelector('[data-kanban-drop-placeholder]')?.parentElement ??
      columnWrap;
    const fallbackRect = fallbackEl.getBoundingClientRect();
    anchorTop = fallbackRect.top;
    naturalHeight = EMPTY_COLUMN_LINE_PX;
  }

  const top = Math.max(anchorTop, pinBelowHeader);
  const height = naturalHeight;

  return {
    left: gapCenterX,
    top,
    height,
    visible: height > 0,
  };
}

/**
 * Resize handle between Kanban columns — fine guide from the first card, fading
 * by ~the third card, sticky while scrolling, blue on hover / drag.
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
    left: 0,
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
    const gapCenterX = marker.getBoundingClientRect().left;
    setLine(measureLineGeometry(columnWrap, gapCenterX, stickyTopPx));
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
    if (columnWrap && ro) ro.observe(columnWrap);
    const taskList = columnWrap?.querySelector('[data-kanban-task-list]');
    if (taskList && ro) ro.observe(taskList);

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
          className={`fixed z-30 ${
            resizeDisabled ? 'cursor-not-allowed opacity-30' : 'cursor-col-resize'
          }`}
          style={{
            left: line.left,
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
                : 'bg-gradient-to-b from-gray-300/90 via-gray-300/45 to-transparent dark:from-gray-500/90 dark:via-gray-500/40 dark:to-transparent'
            }`}
            style={{ height: '100%' }}
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
