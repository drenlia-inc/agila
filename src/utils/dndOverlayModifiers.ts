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

/**
 * Keep the pointer on the painted ghost.
 *
 * dnd-kit lines the overlay up with the source card. A tall card (or the
 * last card in a multi-select) is much taller than the compact preview, so
 * the click offset can land below the ghost. Clamp the hold point to the
 * overlay’s own size — not `activeNodeRect`.
 */
export const snapPointerInsideOverlay: Modifier = ({
  activatorEvent,
  activeNodeRect,
  transform,
}) => {
  if (!activeNodeRect || !activatorEvent) return transform;
  const activator = getEventCoordinates(activatorEvent);
  if (!activator) return transform;

  const box = overlayLayoutSize();
  const overlayW = box?.width ?? 320;
  const overlayH = box?.height ?? 120;

  const grabX = activator.x - activeNodeRect.left;
  const grabY = activator.y - activeNodeRect.top;
  const padX = Math.min(12, overlayW / 2);
  const padY = Math.min(16, overlayH / 2);
  const holdX = Math.min(Math.max(padX, grabX), Math.max(padX, overlayW - padX));
  const holdY = Math.min(Math.max(padY, grabY), Math.max(padY, overlayH - padY));

  return {
    ...transform,
    x: transform.x + grabX - holdX,
    y: transform.y + grabY - holdY,
  };
};
