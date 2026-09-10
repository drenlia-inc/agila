import { useEffect, useRef } from 'react';

/**
 * Portaled card chrome (menus, pickers) is `position: fixed`, so board scroll
 * leaves it stranded. Apps like Linear / GitHub / Trello dismiss these on
 * scroll instead of trying to keep them glued to the trigger.
 *
 * Opening one overlay announces itself so others close (one at a time).
 * Scroll inside the overlay itself (long lists) does not dismiss.
 */
export const FLOATING_OVERLAY_OPEN_EVENT = 'easykanban:floating-overlay-open';

export const FLOATING_OVERLAY_ATTR = 'data-floating-overlay';

export function useFloatingOverlayDismiss(
  enabled: boolean,
  overlayId: string,
  onDismiss: () => void
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled || !overlayId) return;

    window.dispatchEvent(
      new CustomEvent(FLOATING_OVERLAY_OPEN_EVENT, { detail: { id: overlayId } })
    );

    const onOtherOpened = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id && id !== overlayId) onDismissRef.current();
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[${FLOATING_OVERLAY_ATTR}]`)) {
        return;
      }
      onDismissRef.current();
    };

    window.addEventListener(FLOATING_OVERLAY_OPEN_EVENT, onOtherOpened);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener(FLOATING_OVERLAY_OPEN_EVENT, onOtherOpened);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [enabled, overlayId]);
}
