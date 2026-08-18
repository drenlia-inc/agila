import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GanttLegend } from './GanttLegend';

interface GanttHeaderLegendPortalProps {
  containerRef: React.RefObject<HTMLElement | null>;
  priorities: Array<{ id: string; priority: string; color: string }>;
}

/** Legend portaled into the sticky Gantt header so it moves with the header on scroll. */
export const GanttHeaderLegendPortal: React.FC<GanttHeaderLegendPortalProps> = ({
  containerRef,
  priorities,
}) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setContainer(containerRef.current);
  }, [containerRef]);

  if (!container) return null;

  return createPortal(
    <div
      className="absolute left-0 right-0 z-[1] pointer-events-none flex items-center justify-end px-4 h-3.5 bg-white dark:bg-gray-800"
      style={{ top: '5px' }}
    >
      <GanttLegend priorities={priorities} className="max-w-full overflow-x-auto" />
    </div>,
    container,
  );
};
