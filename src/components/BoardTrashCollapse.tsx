import React, { useLayoutEffect, useRef, useState } from 'react';

interface BoardTrashCollapseProps {
  open: boolean;
  children: React.ReactNode;
}

/**
 * Vertical expand/retract for the board trash panel — pushes live board content
 * smoothly without opacity fades or layout swaps.
 */
export default function BoardTrashCollapse({ open, children }: BoardTrashCollapseProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [heightPx, setHeightPx] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(false);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const targetHeight = open ? el.scrollHeight : 0;

    if (open) {
      setTransitionEnabled(true);
      setHeightPx(0);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeightPx(el.scrollHeight);
        });
      });
      return () => cancelAnimationFrame(frame);
    }

    setTransitionEnabled(true);
    setHeightPx(el.scrollHeight);
    const frame = requestAnimationFrame(() => {
      setHeightPx(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || !open) return;

    const syncContentHeight = () => {
      setTransitionEnabled(false);
      setHeightPx(el.scrollHeight);
    };

    const resizeObserver = new ResizeObserver(syncContentHeight);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [open, children]);

  return (
    <div
      className="overflow-hidden motion-reduce:transition-none"
      style={{
        height: heightPx,
        transition: transitionEnabled ? 'height 300ms ease-in-out' : 'none',
      }}
      aria-hidden={!open}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
