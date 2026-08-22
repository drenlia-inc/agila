import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import {
  CHROME_TOOLTIP_DIVIDER_CLASS,
  CHROME_TOOLTIP_MUTED_TEXT_CLASS,
  CHROME_TOOLTIP_RICH_SURFACE_CLASS,
} from '../KanbanChromeTooltip';

interface TaskBarTooltipProps {
  task: any;
  formatDate: (date: string | Date) => string;
  children: React.ReactNode;
  /** Hide the preview (e.g. while dragging or showing a comment popover). */
  disabled?: boolean;
  wrapperClassName?: string;
}

export const TaskBarTooltip: React.FC<TaskBarTooltipProps> = ({
  task,
  formatDate,
  children,
  disabled = false,
  wrapperClassName = 'w-full h-full',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [placement, setPlacement] = useState({ left: 0, top: 0, maxHeight: 0 });
  const targetRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setIsVisible(false);
  }, [disabled]);

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
    setIsVisible(true);
    updatePosition(e);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isVisible && !disabled) {
      updatePosition(e);
    }
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
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
      className={`fixed z-[9999] overflow-y-auto ${CHROME_TOOLTIP_RICH_SURFACE_CLASS}`}
      style={{
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        maxHeight: placement.maxHeight ? `${placement.maxHeight}px` : undefined,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.05s ease-in-out',
      }}
    >
      <div className="font-semibold mb-1">{heading}</div>
      {startDate && endDate && (
        <div className={`${CHROME_TOOLTIP_MUTED_TEXT_CLASS} mb-1`}>
          {formatDate(startDate)} - {formatDate(endDate)}
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
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={wrapperClassName}
      >
        {children}
      </div>
      {isVisible && !disabled && createPortal(tooltipContent, document.body)}
    </>
  );
};
