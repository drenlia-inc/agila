import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  layoutAnchoredDropdown,
  type AnchoredDropdownLayout,
} from '../../utils/anchoredDropdownLayout';

export interface AnchoredDropdownPortalProps {
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  preferredMaxHeight?: number;
  /** Match trigger width or fixed width in px. */
  width?: number | 'trigger';
  /** When width is `trigger`, enforce at least this many pixels. */
  minWidth?: number;
  panelRef?: React.RefObject<HTMLDivElement | null>;
}

export default function AnchoredDropdownPortal({
  open,
  triggerRef,
  children,
  className = '',
  preferredMaxHeight = 320,
  width = 'trigger',
  minWidth,
  panelRef,
}: AnchoredDropdownPortalProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? internalRef;
  const [layout, setLayout] = useState<AnchoredDropdownLayout | null>(null);

  const recompute = useCallback(() => {
    if (!open || !triggerRef.current) {
      setLayout(null);
      return;
    }
    const anchor = triggerRef.current.getBoundingClientRect();
    const panelWidth =
      width === 'trigger'
        ? Math.max(minWidth ?? 0, anchor.width)
        : width;
    setLayout(
      layoutAnchoredDropdown({
        anchor,
        width: panelWidth,
        preferredMaxHeight,
      })
    );
  }, [open, preferredMaxHeight, triggerRef, width, minWidth]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open, recompute]);

  if (!open || !layout) return null;

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{
        position: 'fixed',
        left: layout.left,
        ...(layout.placement === 'below'
          ? { top: layout.top }
          : { bottom: layout.bottom }),
        width: layout.width,
        maxHeight: layout.maxHeight,
        zIndex: 9999,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

/** Close when clicking outside trigger and panel. */
export function useAnchoredDropdownDismiss(
  open: boolean,
  onClose: () => void,
  triggerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onClose, panelRef, triggerRef]);
}
