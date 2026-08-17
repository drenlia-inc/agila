import React, { useEffect, useLayoutEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

/**
 * Shared inverted chrome surface — high contrast in both themes:
 * light UI → dark bubble; dark UI → light bubble.
 */
export const CHROME_TOOLTIP_COLORS =
  'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900';

/** Subtle edge so the bubble stays crisp on matching backgrounds. */
export const CHROME_TOOLTIP_RING =
  'ring-1 ring-white/10 dark:ring-black/10';

/** Visual chrome only (positioning applied separately: absolute in-list or fixed + portal). */
export const CHROME_TOOLTIP_SURFACE_CLASS =
  `px-2 py-1 text-xs font-normal normal-case tracking-normal whitespace-nowrap rounded shadow-lg ${CHROME_TOOLTIP_COLORS} ${CHROME_TOOLTIP_RING} pointer-events-none`;

/** Same surface as {@link CHROME_TOOLTIP_SURFACE_CLASS} but vertical list / wrapped text (e.g. watchers & collaborators). */
export const CHROME_TOOLTIP_MULTILINE_SURFACE_CLASS =
  `px-2 py-1.5 text-xs font-normal normal-case tracking-normal whitespace-pre-line text-left max-w-[min(18rem,calc(100vw-2rem))] break-words leading-snug rounded shadow-lg ${CHROME_TOOLTIP_COLORS} ${CHROME_TOOLTIP_RING} pointer-events-none`;

/** Rich / multi-block hover content (Gantt bars, activity details). */
export const CHROME_TOOLTIP_RICH_SURFACE_CLASS =
  `px-3 py-2 text-xs font-normal normal-case tracking-normal text-left max-w-sm rounded-lg shadow-lg ${CHROME_TOOLTIP_COLORS} ${CHROME_TOOLTIP_RING} pointer-events-none`;

/**
 * Interactive preview panels (comment hover). Keep pointer events so users can scroll/click inside.
 * Pair with `.comment-tooltip` / `.comment-tooltip-active` DnD lock in index.css when needed.
 */
export const CHROME_TOOLTIP_PANEL_SURFACE_CLASS =
  `w-80 max-h-64 flex flex-col text-xs rounded-md shadow-lg border border-gray-700 dark:border-gray-300 ${CHROME_TOOLTIP_COLORS}`;

/**
 * Selectable chrome tooltip (Team Members email copy only). Pointer events enabled so text
 * can be selected / buttons clicked — do not use for ordinary hover hints.
 */
export const CHROME_TOOLTIP_SELECTABLE_SURFACE_CLASS =
  `px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-left max-w-[min(20rem,calc(100vw-2rem))] rounded-md shadow-lg select-text cursor-auto ${CHROME_TOOLTIP_COLORS} ${CHROME_TOOLTIP_RING} pointer-events-auto`;

/** Muted secondary text inside rich/panel tooltips. */
export const CHROME_TOOLTIP_MUTED_TEXT_CLASS =
  'text-gray-300 dark:text-gray-600';

/** Divider inside rich/panel tooltips. */
export const CHROME_TOOLTIP_DIVIDER_CLASS =
  'border-gray-700 dark:border-gray-300';

/** In-flow / list-view: positioned under anchor */
export const CHROME_TOOLTIP_POPOVER_CLASS =
  `absolute left-0 z-[70] ${CHROME_TOOLTIP_SURFACE_CLASS}`;

/** Above floating panels such as Activity Feed (z-9999). */
const CHROME_TOOLTIP_PORTAL_Z = 10050;

/** ~native `title` delay */
export const CHROME_TOOLTIP_DELAY_MS = 650;

/** Brief grace so the pointer can cross the gap into an interactive tooltip. */
const INTERACTIVE_HIDE_DELAY_MS = 120;

type KanbanChromeTooltipProps = {
  /** No tooltip when empty (ignored when `content` is set) */
  label?: string;
  /** Rich / interactive body. When set, takes precedence over `label`. */
  content?: ReactNode;
  /**
   * Allow selecting text / clicking inside the tooltip. Only for the Team Members
   * email-copy case — keeps the bubble open while the pointer is over it.
   */
  interactive?: boolean;
  children: ReactNode;
  /** `0` = show immediately (e.g. sprint). Default = delayed like browser `title`. */
  delayMs?: number;
  wrapperClassName?: string;
  /** `bottom` = below anchor (default), `top` = above */
  placement?: 'bottom' | 'top';
  /** Override portaled bubble z-index (e.g. above a high z-index modal). */
  portalZIndex?: number;
  /**
   * Force wrapped text and constrain bubble width (px).
   * Prefer {@link widthAnchorRef} when the tip should match a column/card width.
   */
  maxWidth?: number;
  /** Measure this element’s width and use it as the tip max-width (e.g. column root). */
  widthAnchorRef?: React.RefObject<HTMLElement | null>;
  /**
   * When false, keep an open tip if only `label`/`content` changes (live countdown).
   * Default true: board/column chrome swaps copy on select and must not stick.
   */
  dismissOnLabelChange?: boolean;
};

/** Wrapped label surface without a fixed rem max-width (width comes from style). */
const CHROME_TOOLTIP_WRAPPED_SURFACE_CLASS =
  `px-2 py-1.5 text-xs font-normal normal-case tracking-normal whitespace-pre-line text-left break-words leading-snug rounded shadow-lg ${CHROME_TOOLTIP_COLORS} ${CHROME_TOOLTIP_RING} pointer-events-none`;

/** HTML preview (lists, breaks, tables) sized by maxWidth / widthAnchorRef. */
const CHROME_TOOLTIP_HTML_SURFACE_CLASS =
  `px-2 py-1.5 text-xs font-normal normal-case tracking-normal whitespace-normal text-left break-words leading-snug rounded shadow-lg ${CHROME_TOOLTIP_COLORS} ${CHROME_TOOLTIP_RING} pointer-events-none`;

/**
 * App-wide chrome tooltips: inverted light/dark surface; optional delay (default ~native title).
 * Bubble is portaled to `document.body` so it is not trapped under sibling z-index.
 */
export function KanbanChromeTooltip({
  label = '',
  content,
  interactive = false,
  children,
  delayMs = CHROME_TOOLTIP_DELAY_MS,
  wrapperClassName = 'relative inline-flex',
  placement = 'bottom',
  portalZIndex = CHROME_TOOLTIP_PORTAL_Z,
  maxWidth,
  widthAnchorRef,
  dismissOnLabelChange = true,
}: KanbanChromeTooltipProps) {
  const isMobile = useIsMobileViewport();
  const [visible, setVisible] = useState(false);
  /** Positioned + ready to show (avoids off-screen → clamp jump). */
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const show = () => {
    clearHideTimer();
    clearTimer();
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    timerRef.current = setTimeout(() => setVisible(true), delayMs);
  };

  const hide = () => {
    clearTimer();
    clearHideTimer();
    setVisible(false);
  };

  const scheduleHide = () => {
    clearTimer();
    if (!interactive) {
      hide();
      return;
    }
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setVisible(false), INTERACTIVE_HIDE_DELAY_MS);
  };

  /** mouseleave on the wrapper can miss when crossing a pointer-events-none popover; mouseout/pointerout bubble and relatedTarget reflects the real exit. */
  const hideIfExitedContainer = (
    e: React.MouseEvent<HTMLSpanElement> | React.PointerEvent<HTMLSpanElement>
  ) => {
    const next = e.relatedTarget;
    if (next instanceof Node) {
      if (e.currentTarget.contains(next)) return;
      if (interactive && tooltipRef.current?.contains(next)) return;
    }
    scheduleHide();
  };

  const hasBody = Boolean(content) || Boolean(label);

  // Board/column chrome often swaps label on select; leave tips open and they stick on the wrong tab.
  // Live labels (demo countdown) pass dismissOnLabelChange={false} so the bubble stays while hovering.
  // Do not depend on `content`: callers often pass a new React node each render, which would
  // hide the tip immediately (shrink description preview).
  useEffect(() => {
    if (!dismissOnLabelChange) return;
    hide();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when string label changes
  }, [label, dismissOnLabelChange]);

  useEffect(() => {
    if (!hasBody) hide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBody]);

  // Clicking another control (e.g. a different board tab) can skip mouseout when React re-renders.
  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        hide();
        return;
      }
      // Keep interactive tips open when pressing inside the bubble (email copy, etc.)
      if (interactive && tooltipRef.current?.contains(target)) return;
      // Ignore presses still inside this tip's anchor
      if (anchorRef.current?.contains(target)) return;
      hide();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, interactive]);

  useLayoutEffect(() => {
    if (!visible || !hasBody) {
      setPortalStyle(null);
      return;
    }

    const margin = 8;

    const update = () => {
      const el = anchorRef.current;
      const tip = tooltipRef.current;
      if (!el || !tip) return;

      // Apply width constraint before measuring so wrap height is correct.
      const anchorWidth = widthAnchorRef?.current?.getBoundingClientRect().width;
      const resolvedMaxWidth =
        maxWidth ??
        (anchorWidth != null && anchorWidth > 0 ? Math.round(anchorWidth) : undefined);
      if (resolvedMaxWidth != null) {
        tip.style.maxWidth = `${resolvedMaxWidth}px`;
      } else {
        tip.style.maxWidth = '';
      }

      const rect = el.getBoundingClientRect();
      // Tip is mounted (possibly opacity 0) so measurements are real — no estimate → clamp jump
      const tipW = Math.max(1, tip.offsetWidth);
      const tipH = Math.max(1, tip.offsetHeight);

      let placeBottom = placement === 'bottom';
      if (placeBottom && rect.bottom + 4 + tipH > window.innerHeight - margin) {
        placeBottom = false;
      } else if (!placeBottom && rect.top - 4 - tipH < margin) {
        placeBottom = true;
      }

      let left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));

      const top = placeBottom
        ? rect.bottom + 4
        : Math.max(margin, rect.top - 4 - tipH);

      setPortalStyle({
        position: 'fixed',
        top,
        left,
        zIndex: portalZIndex,
      });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [visible, hasBody, placement, portalZIndex, label, content, maxWidth, widthAnchorRef]);

  useEffect(
    () => () => {
      clearTimer();
      clearHideTimer();
    },
    []
  );

  if (!hasBody) {
    return <>{children}</>;
  }

  const wrapToWidth = maxWidth != null || widthAnchorRef != null;
  const tooltipClassName = wrapToWidth
    ? content
      ? CHROME_TOOLTIP_HTML_SURFACE_CLASS
      : CHROME_TOOLTIP_WRAPPED_SURFACE_CLASS
    : content
      ? interactive
        ? CHROME_TOOLTIP_SELECTABLE_SURFACE_CLASS
        : CHROME_TOOLTIP_RICH_SURFACE_CLASS
      : label.includes('\n')
        ? CHROME_TOOLTIP_MULTILINE_SURFACE_CLASS
        : CHROME_TOOLTIP_SURFACE_CLASS;

  // Touch / narrow viewports: taps fire mouseenter and leave sticky tips on buttons and tabs.
  if (isMobile) {
    return <span className={wrapperClassName}>{children}</span>;
  }

  // Mount while visible so we can measure before revealing (opacity 0 until positioned)
  const portal =
    visible && typeof document !== 'undefined'
      ? createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            className={tooltipClassName}
            style={{
              position: 'fixed',
              top: portalStyle?.top ?? 0,
              left: portalStyle?.left ?? 0,
              zIndex: portalZIndex,
              opacity: portalStyle ? 1 : 0,
              pointerEvents: portalStyle && interactive ? 'auto' : 'none',
            }}
            onMouseEnter={interactive ? show : undefined}
            onMouseLeave={interactive ? scheduleHide : undefined}
          >
            {content ?? label}
          </span>,
          document.body
        )
      : null;

  return (
    <>
      <span
        ref={anchorRef}
        className={wrapperClassName}
        onMouseEnter={show}
        onMouseOut={hideIfExitedContainer}
        onPointerOut={hideIfExitedContainer}
      >
        {children}
      </span>
      {portal}
    </>
  );
}
