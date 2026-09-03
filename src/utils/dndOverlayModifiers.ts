import type { Modifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

function overlayLayoutSize(): { width: number; height: number } | null {
  const el = document.querySelector('[data-kanban-drag-overlay]');
  if (!(el instanceof HTMLElement)) return null;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Grab offset from the first overlay frame. Live source rects move on scroll. */
let frozenGrab: { x: number; y: number } | null = null;

export function resetOverlayGrabOffset(): void {
  frozenGrab = null;
}

/**
 * Keep the pointer on the painted ghost.
 *
 * dnd-kit lines the overlay up with the source card. A tall card (or the
 * last card in a multi-select) is much taller than the compact preview, so
 * the click offset can land below the ghost. Clamp the hold point to the
 * overlay’s own size — not `activeNodeRect`.
 *
 * Freeze the grab against the first source rect. `activeNodeRect` is live:
 * auto-scroll / virtualization moves the collapsed origin, and recomputing
 * grab from that rect throws the ghost off-screen on a fast downward drag.
 */
export const snapPointerInsideOverlay: Modifier = ({
  activatorEvent,
  activeNodeRect,
  transform,
}) => {
  if (!activatorEvent) return transform;
  const activator = getEventCoordinates(activatorEvent);
  if (!activator) return transform;

  if (frozenGrab == null && activeNodeRect) {
    frozenGrab = {
      x: activator.x - activeNodeRect.left,
      y: activator.y - activeNodeRect.top,
    };
  }
  if (frozenGrab == null) return transform;

  const box = overlayLayoutSize();
  const overlayW = box?.width ?? 320;
  const overlayH = box?.height ?? 120;

  const padX = Math.min(12, overlayW / 2);
  const padY = Math.min(16, overlayH / 2);
  const holdX = Math.min(
    Math.max(padX, frozenGrab.x),
    Math.max(padX, overlayW - padX)
  );
  const holdY = Math.min(
    Math.max(padY, frozenGrab.y),
    Math.max(padY, overlayH - padY)
  );

  return {
    ...transform,
    x: transform.x + frozenGrab.x - holdX,
    y: transform.y + frozenGrab.y - holdY,
  };
};
