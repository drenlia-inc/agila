import React, { useLayoutEffect, useRef, useState, ReactNode } from 'react';

type FirstLineEndAnchorProps = {
  children: ReactNode;
  anchor: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Extra px subtracted from anchor top (positive values move the anchor up). */
  anchorOffsetY?: number;
};

/**
 * Positions `anchor` at the end of the first line of `children` without growing layout.
 */
export function FirstLineEndAnchor({
  children,
  anchor,
  className = '',
  contentClassName = '',
  anchorOffsetY = 3,
}: FirstLineEndAnchorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const el = contentRef.current;
    if (!wrap || !el || !anchor) {
      setPos(null);
      return;
    }

    const update = () => {
      // Selecting the wrapper's contents can include a child block's full-width
      // rectangle. Measure text nodes individually so `right` is the final glyph,
      // not the right edge of the h3/div.
      const rects: DOMRect[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          Array.from(range.getClientRects()).forEach((rect) => {
            if (rect.width > 0 && rect.height > 0) rects.push(rect);
          });
          range.detach();
        }
        textNode = walker.nextNode();
      }
      if (!rects.length) {
        setPos(null);
        return;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const first = rects[0];
      const lineTolerance = Math.max(2, first.height * 0.35);
      const firstLine = rects.filter(
        (rect) => Math.abs(rect.top - first.top) <= lineTolerance
      );
      const last = firstLine.reduce(
        (rightmost, rect) => (rect.right > rightmost.right ? rect : rightmost),
        first
      );
      setPos({
        left: last.right - wrapRect.left,
        top: last.top - wrapRect.top + Math.max(0, (last.height - 16) / 2) - anchorOffsetY,
      });
    };

    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [children, anchor, anchorOffsetY]);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
      {anchor && pos && (
        <div
          className="absolute z-10"
          style={{ left: pos.left, top: Math.max(0, pos.top) }}
        >
          {anchor}
        </div>
      )}
    </div>
  );
}
