import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import {
  CHROME_TOOLTIP_DIVIDER_CLASS,
  CHROME_TOOLTIP_MUTED_TEXT_CLASS,
  CHROME_TOOLTIP_RICH_INTERACTIVE_SURFACE_CLASS,
} from '../KanbanChromeTooltip';

interface TaskBarTooltipProps {
  task: any;
  formatDate: (date: string | Date) => string;
  children: React.ReactNode;
  /** Hide the preview (e.g. while dragging or showing a comment popover). */
  disabled?: boolean;
  wrapperClassName?: string;
  /** Extra line under the dates, for detail the bar itself has no room to show. */
  meta?: React.ReactNode;
}

/** Long enough to move the pointer off the bar and onto the preview. */
const HIDE_GRACE_MS = 180;

export const TaskBarTooltip: React.FC<TaskBarTooltipProps> = ({
  task,
  formatDate,
  children,
  disabled = false,
  wrapperClassName = 'w-full h-full',
  meta,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [placement, setPlacement] = useState({ left: 0, top: 0, maxHeight: 0 });
  const targetRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInPreviewRef = useRef(false);

  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (!pointerInPreviewRef.current) setIsVisible(false);
    }, HIDE_GRACE_MS);
  };

  useEffect(() => {
    if (disabled) {
      cancelHide();
      pointerInPreviewRef.current = false;
      setIsVisible(false);
    }
  }, [disabled]);

  useEffect(() => () => cancelHide(), []);

  // Measure before paint: a bar near the right or bottom edge would otherwise
  // push the preview off screen, where it is clipped or unreadable.
  useLayoutEffect(() => {
    if (!isVisible) return;
    const el = tooltipRef.current;
    if (!el) return;

    const MARGIN = 8;
    const CURSOR_GAP = 15;
    const { width, height } = el.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = cursor.x + CURSOR_GAP;
    if (left + width + MARGIN > viewportW) {
      left = cursor.x - CURSOR_GAP - width;
    }
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, viewportW - width - MARGIN));

    let top = cursor.y + CURSOR_GAP;
    if (top + height + MARGIN > viewportH) {
      top = cursor.y - CURSOR_GAP - height;
    }
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewportH - height - MARGIN));

    const maxHeight = viewportH - MARGIN * 2;
    setPlacement((prev) =>
      prev.left === left && prev.top === top && prev.maxHeight === maxHeight
        ? prev
        : { left, top, maxHeight }
    );
  }, [cursor, isVisible]);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (disabled) return;
    cancelHide();
    setIsVisible(true);
    updatePosition(e);
  };

  // Keep the preview alive briefly so the pointer can reach it; text and links
  // inside are then selectable and clickable, like the comments popover.
  const handleMouseLeave = () => {
    scheduleHide();
  };

  const updatePosition = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
  };

  const startDate = task.startDate;
  const endDate = task.endDate ?? task.dueDate ?? task.startDate;
  const heading = [task.ticket, task.title].filter(Boolean).join(': ');

  const tooltipContent = (
    <div
      ref={tooltipRef}
      className={`fixed z-[9999] overflow-y-auto ${CHROME_TOOLTIP_RICH_INTERACTIVE_SURFACE_CLASS}`}
      style={{
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        maxHeight: placement.maxHeight ? `${placement.maxHeight}px` : undefined,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.05s ease-in-out',
      }}
      onMouseEnter={() => {
        pointerInPreviewRef.current = true;
        cancelHide();
      }}
      onMouseLeave={() => {
        pointerInPreviewRef.current = false;
        scheduleHide();
      }}
      // The portal still bubbles through the React tree, so selecting text or
      // following a link here must not also click the bar underneath.
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="font-semibold mb-1">{heading}</div>
      {startDate && endDate && (
        <div className={`${CHROME_TOOLTIP_MUTED_TEXT_CLASS} mb-1`}>
          {formatDate(startDate)} - {formatDate(endDate)}
        </div>
      )}
      {meta && (
        <div className={`${CHROME_TOOLTIP_MUTED_TEXT_CLASS} mb-1 flex items-center gap-1.5`}>
          {meta}
        </div>
      )}
      {task.description && (
        <div
          className={`${CHROME_TOOLTIP_MUTED_TEXT_CLASS} mt-2 border-t ${CHROME_TOOLTIP_DIVIDER_CLASS} pt-2 max-h-32 overflow-y-auto prose prose-sm prose-invert dark:prose-neutral max-w-none`}
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(task.description),
          }}
        />
      )}
    </div>
  );

  return (
    <>
      <div
        ref={targetRef}
        // Placement is taken once on entry and then held: a preview that keeps
        // following the cursor slides out from under the pointer that is
        // reaching for it, and covers the bars it is describing.
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // Pressing the bar means acting on it (click, drag, resize) — drop the
        // preview so it cannot sit under the pointer mid-gesture.
        onMouseDown={() => {
          cancelHide();
          pointerInPreviewRef.current = false;
          setIsVisible(false);
        }}
        className={wrapperClassName}
      >
        {children}
      </div>
      {isVisible && !disabled && createPortal(tooltipContent, document.body)}
    </>
  );
};
