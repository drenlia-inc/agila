import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripHorizontal } from 'lucide-react';
import {
  constrainOwnerSetupPositionX,
  defaultOwnerSetupPositionX,
} from '../utils/ownerSetup';

const MARGIN = 16;
export const HELP_ASSISTANT_PANEL_WIDTH = 320;
export const HELP_ASSISTANT_OVERLAY_HEIGHT = 420;
/** Dock: header + composer + a slice of the thread (composer must stay visible). */
const MIN_HEIGHT = 280;
const MAX_HEIGHT_RATIO = 0.7;

type Bounds = { left: number; width: number };

function constrainX(x: number, panelWidth: number, bounds?: Bounds | null): number {
  if (bounds && bounds.width > 0) {
    const maxX = Math.max(MARGIN, bounds.width - panelWidth - MARGIN);
    return Math.min(maxX, Math.max(MARGIN, x));
  }
  return constrainOwnerSetupPositionX(x, panelWidth, MARGIN);
}

function defaultX(panelWidth: number, bounds?: Bounds | null): number {
  if (bounds && bounds.width > 0) {
    return Math.max(MARGIN, bounds.width - panelWidth - MARGIN);
  }
  return defaultOwnerSetupPositionX(panelWidth, MARGIN);
}

function clampHeight(h: number): number {
  const max =
    typeof window !== 'undefined'
      ? Math.max(MIN_HEIGHT, Math.round(window.innerHeight * MAX_HEIGHT_RATIO))
      : 480;
  return Math.min(max, Math.max(MIN_HEIGHT, Math.round(h)));
}

type Props = {
  /** `dock` = fixed on the board; `overlay` = inside the Help dialog. */
  variant: 'dock' | 'overlay';
  /** Overlay: constrain X to this element (Help modal). */
  boundsEl?: HTMLElement | null;
  positionX: number | null;
  height: number;
  onPositionXChange: (x: number) => void;
  onHeightChange: (h: number) => void;
  header: React.ReactNode;
  children: React.ReactNode;
  /** Dock: click header to expand Help (ignored after a drag). */
  onHeaderActivate?: () => void;
};

export default function HelpAssistantShell({
  variant,
  boundsEl,
  positionX,
  height,
  onPositionXChange,
  onHeightChange,
  header,
  children,
  onHeaderActivate,
}: Props) {
  const { t } = useTranslation('common');
  const panelWidth = Math.min(
    HELP_ASSISTANT_PANEL_WIDTH,
    typeof window !== 'undefined' ? Math.round(window.innerWidth / 3) : HELP_ASSISTANT_PANEL_WIDTH
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [parentWidth, setParentWidth] = useState(0);

  useLayoutEffect(() => {
    if (variant !== 'overlay') return;
    const measure = () => {
      const parent = (boundsEl || rootRef.current?.offsetParent) as HTMLElement | null;
      if (parent) setParentWidth(parent.clientWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [variant, boundsEl]);

  const bounds: Bounds | null =
    variant === 'overlay' && parentWidth > 0
      ? { left: 0, width: parentWidth }
      : boundsEl
        ? { left: boundsEl.getBoundingClientRect().left, width: boundsEl.getBoundingClientRect().width }
        : null;

  const dragRef = useRef<{
    startClientX: number;
    startLeft: number;
    currentLeft: number;
    moved: boolean;
  } | null>(null);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [liveHeight, setLiveHeight] = useState<number | null>(null);

  const resolvedLeft = useMemo(() => {
    if (typeof dragLeft === 'number') return dragLeft;
    if (typeof positionX === 'number') return constrainX(positionX, panelWidth, bounds);
    return defaultX(panelWidth, bounds);
  }, [dragLeft, positionX, panelWidth, bounds?.left, bounds?.width]);

  const resolvedHeight = clampHeight(liveHeight ?? height);

  const endDrag = useCallback(() => {
    const session = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    setDragLeft(null);
    if (session?.moved) {
      suppressClickRef.current = true;
      onPositionXChange(constrainX(session.currentLeft, panelWidth, bounds));
    }
  }, [bounds, onPositionXChange, panelWidth]);

  const onDragMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startClientX;
      if (Math.abs(dx) > 3) dragRef.current.moved = true;
      const next = constrainX(dragRef.current.startLeft + dx, panelWidth, bounds);
      dragRef.current.currentLeft = next;
      setDragLeft(next);
    },
    [bounds, panelWidth]
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    endDrag();
  }, [endDrag, onDragMove]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (variant !== 'dock') return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select, [data-resize-handle]')) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        startClientX: e.clientX,
        startLeft: resolvedLeft,
        currentLeft: resolvedLeft,
        moved: false,
      };
      setIsDragging(true);
      setDragLeft(resolvedLeft);
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    },
    [onDragEnd, onDragMove, resolvedLeft, variant]
  );

  const liveHeightRef = useRef<number | null>(null);

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizeRef.current) return;
    const dy = e.clientY - resizeRef.current.startY;
    // Top-edge resize: drag up grows, drag down shrinks (bottom stays put).
    const next = clampHeight(resizeRef.current.startH - dy);
    liveHeightRef.current = next;
    setLiveHeight(next);
  }, []);

  const onResizeEnd = useCallback(() => {
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeEnd);
    const h = liveHeightRef.current;
    resizeRef.current = null;
    liveHeightRef.current = null;
    setLiveHeight(null);
    if (typeof h === 'number') onHeightChange(clampHeight(h));
  }, [onHeightChange, onResizeMove]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startY: e.clientY, startH: resolvedHeight };
      setLiveHeight(resolvedHeight);
      window.addEventListener('mousemove', onResizeMove);
      window.addEventListener('mouseup', onResizeEnd);
    },
    [onResizeEnd, onResizeMove, resolvedHeight]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      window.removeEventListener('mousemove', onResizeMove);
      window.removeEventListener('mouseup', onResizeEnd);
    };
  }, [onDragEnd, onDragMove, onResizeEnd, onResizeMove]);

  const style: React.CSSProperties =
    variant === 'dock'
      ? {
          left: resolvedLeft,
          right: 'auto',
          bottom: MARGIN,
          width: panelWidth,
          height: resolvedHeight,
        }
      : {
          left: resolvedLeft,
          right: 'auto',
          top: 56,
          width: panelWidth,
          height: resolvedHeight,
        };

  return (
    <div
      ref={rootRef}
      className={`flex flex-col min-h-0 rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden ${
        variant === 'dock' ? 'fixed z-[10040]' : 'absolute z-20'
      } ${isDragging ? 'cursor-grabbing select-none' : ''}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {variant === 'dock' && (
        <button
          type="button"
          data-resize-handle
          className="h-2 shrink-0 cursor-ns-resize bg-transparent hover:bg-blue-200/50 dark:hover:bg-blue-800/40"
          aria-label={t('help.assistant.resizeHint')}
          title={t('help.assistant.resizeHint')}
          onMouseDown={startResize}
        />
      )}
      <div
        onMouseDown={variant === 'dock' ? startDrag : undefined}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onHeaderActivate?.();
        }}
        className={`shrink-0 ${
          variant === 'dock' ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        title={variant === 'dock' ? t('help.assistant.dragHint') : undefined}
      >
        {variant === 'dock' && (
          <div className="flex justify-center pt-0.5 text-slate-400" aria-hidden>
            <GripHorizontal size={16} />
          </div>
        )}
        {header}
      </div>
      <div className="flex-1 min-h-0 px-3 pb-2">{children}</div>
    </div>
  );
}
