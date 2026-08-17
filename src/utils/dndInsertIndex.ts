/**
 * Pointer-Y insert index for Kanban task lists.
 *
 * Use column bounding boxes (not elementsFromPoint) so the drag overlay cannot
 * steal hit-testing. Insert index is measured from visible `[data-kanban-task-row]`
 * slots in the layout list (dragged task already omitted from those rows).
 *
 * Geometry is visual: the in-flow Drop here hole shifts cards down, and the
 * pointer is tested against those shifted rects. Subtracting the hole height
 * and then applying a 16px "into next card" split made most of the placeholder
 * resolve as insert N+1 (card landed one slot below the hole).
 */

export function resolveColumnIdUnderPointer(x: number, y: number): string | null {
  if (typeof document === 'undefined') return null;
  const roots = document.querySelectorAll('[data-kanban-column-id]');
  let best: { id: string; area: number } | null = null;
  for (const root of roots) {
    if (!(root instanceof HTMLElement)) continue;
    const r = root.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const id = root.getAttribute('data-kanban-column-id');
    if (!id) continue;
    const area = r.width * r.height;
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id ?? null;
}

export type OverlayDropHit = {
  columnId: string;
  insertIndex: number;
};

function rectIntersectionArea(a: DOMRectReadOnly, b: DOMRectReadOnly): number {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return w * h;
}

/** Visible dragged-task overlay (excludes dnd-kit wrapper chrome). */
export function getTaskDragOverlayRect(): DOMRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-kanban-drag-overlay]');
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return r;
}

function maxTaskRowOverlap(
  columnRoot: ParentNode,
  overlay: DOMRectReadOnly,
  draggedTaskId?: string
): number {
  let max = 0;
  const rows = columnRoot.querySelectorAll('[data-kanban-task-row]');
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (draggedTaskId && row.dataset.taskId === draggedTaskId) continue;
    const area = rectIntersectionArea(overlay, row.getBoundingClientRect());
    if (area > max) max = area;
  }
  return max;
}

/**
 * Snap to Drop here only when the ghost is more in the hole than on any card.
 * Otherwise a hole above card 1 (position 1) steals the slot between 1 and 2.
 */
export function findPlaceholderHitByOverlay(
  overlay: DOMRectReadOnly,
  draggedTaskId?: string
): OverlayDropHit | null {
  if (typeof document === 'undefined') return null;
  const holes = document.querySelectorAll('[data-kanban-drop-placeholder]');
  let best: { hit: OverlayDropHit; area: number } | null = null;
  for (const hole of holes) {
    if (!(hole instanceof HTMLElement)) continue;
    const hr = hole.getBoundingClientRect();
    if (hr.height <= 0 || hr.width <= 0) continue;
    const area = rectIntersectionArea(overlay, hr);
    if (area < 32) continue;
    const col = hole.closest('[data-kanban-column-id]');
    const columnId = col?.getAttribute('data-kanban-column-id');
    const insertIndex = Number(hole.dataset.insertIndex);
    if (!columnId || !Number.isFinite(insertIndex)) continue;
    const cardArea = maxTaskRowOverlap(col ?? hole, overlay, draggedTaskId);
    if (area <= cardArea) continue;
    if (!best || area > best.area) {
      best = { hit: { columnId, insertIndex }, area };
    }
  }
  return best?.hit ?? null;
}

/** Column whose box overlaps the overlay the most (where the card actually is). */
export function resolveColumnIdUnderRect(
  rect: DOMRectReadOnly,
  originColumnId?: string | null
): string | null {
  if (typeof document === 'undefined') return null;
  const roots = document.querySelectorAll('[data-kanban-column-id]');
  const overlayArea = Math.max(1, rect.width * rect.height);
  const hits: { id: string; area: number }[] = [];
  for (const root of roots) {
    if (!(root instanceof HTMLElement)) continue;
    const r = root.getBoundingClientRect();
    const area = rectIntersectionArea(rect, r);
    if (area <= 0) continue;
    const id = root.getAttribute('data-kanban-column-id');
    if (!id) continue;
    hits.push({ id, area });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.area - a.area);
  // Crossing into another column: a modest overlap is enough so a 320px
  // overlay still sitting mostly on the source column can target the dest.
  if (originColumnId) {
    const crossed = hits.filter(
      (h) => h.id !== originColumnId && h.area >= overlayArea * 0.12
    );
    if (crossed.length > 0) return crossed[0].id;
  }
  return hits[0].id;
}

/**
 * Insert index from the dragged card overlapping in-column cards.
 * The ghost's box displaces the card it overlaps most — not the 12px gap
 * between cards, and not a single Y point on the overlay.
 */
export function resolveInsertIndexFromOverlay(
  columnId: string,
  overlay: DOMRectReadOnly,
  draggedTaskId?: string,
  origin?: { columnId: string; insertIndex: number } | null
): number | null {
  if (typeof document === 'undefined') return null;

  const root = document.querySelector(
    `[data-kanban-column-id="${cssEscape(columnId)}"]`
  );
  if (!(root instanceof HTMLElement)) return null;

  const outside = insertOutsideTaskList(root, overlay.top, overlay.bottom);
  if (outside != null) return outside;

  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-kanban-task-row]'))
    .filter((row) => !draggedTaskId || row.dataset.taskId !== draggedTaskId)
    .map((row) => {
      const index = Number(row.dataset.layoutIndex);
      const rect = row.getBoundingClientRect();
      return { index, top: rect.top, height: rect.height };
    })
    .filter((r) => Number.isFinite(r.index) && r.index >= 0 && r.height > 0)
    .sort((a, b) => a.index - b.index);

  const list = columnTaskList(root);
  const layoutCount = list ? layoutCountForList(list) : null;

  if (rows.length === 0) return layoutCount ?? 0;

  const first = rows[0];
  const last = rows[rows.length - 1];
  if (overlay.bottom <= first.top + 2) {
    return first.index === 0 ? 0 : first.index;
  }
  if (overlay.top >= last.top + last.height - 2) {
    return layoutCount != null ? layoutCount : last.index + 1;
  }

  let best: { index: number; top: number; height: number; overlap: number } | null =
    null;
  for (const row of rows) {
    const overlap = Math.max(
      0,
      Math.min(overlay.bottom, row.top + row.height) - Math.max(overlay.top, row.top)
    );
    if (overlap <= 0) continue;
    if (!best || overlap > best.overlap) best = { ...row, overlap };
  }

  if (!best) {
    const midY = overlay.top + overlay.height / 2;
    for (const row of rows) {
      if (midY < row.top) return row.index;
    }
    return last.index + 1;
  }

  // Same-column moving down: overlapping a card at/after the origin slot
  // pushes it (insert after). Makes card 1 → position 2 a single overlap of
  // the next card, without the 62% / hole-snap rules that blocked 1–2 from
  // elsewhere (those still use the midpoint below).
  const sameCol = !!origin && origin.columnId === columnId;
  if (sameCol && best.index >= origin.insertIndex) {
    return best.index + 1;
  }

  // Upper half of a card → hole before it (card 1 = position 1).
  // Lower half → hole after it (card 1 = between position 1 and 2).
  const split = best.top + best.height * 0.45;
  const cy = overlay.top + overlay.height * 0.5;
  return cy < split ? best.index : best.index + 1;
}

/**
 * Drop target from the dragged card: overlapping Drop here first, else the
 * column under the overlay using card-vs-ghost overlap.
 */
export function resolveDropFromOverlay(
  overlay: DOMRectReadOnly,
  draggedTaskId?: string,
  origin?: { columnId: string; insertIndex: number } | null
): OverlayDropHit | null {
  const snap = findPlaceholderHitByOverlay(overlay, draggedTaskId);
  if (snap) return snap;

  const columnId =
    resolveColumnIdUnderRect(overlay, origin?.columnId) ||
    resolveColumnIdUnderPointer(
      overlay.left + overlay.width / 2,
      overlay.top + overlay.height / 2
    );
  if (!columnId) return null;

  const insertIndex = resolveInsertIndexFromOverlay(
    columnId,
    overlay,
    draggedTaskId,
    origin
  );
  if (insertIndex == null) return null;
  return { columnId, insertIndex };
}

export function pointerInColumnTopZone(
  columnId: string,
  x: number,
  y: number
): boolean {
  if (typeof document === 'undefined') return false;
  const topEl = document.getElementById(`${columnId}-task-top`);
  if (!topEl) return false;
  const r = topEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function placeholderInsertAtPointer(
  root: HTMLElement,
  pointerY: number
): number | null {
  const hole = root.querySelector('[data-kanban-drop-placeholder]');
  if (!(hole instanceof HTMLElement)) return null;
  const r = hole.getBoundingClientRect();
  if (r.height <= 0) return null;
  if (pointerY < r.top || pointerY > r.bottom) return null;
  const idx = Number(hole.dataset.insertIndex);
  return Number.isFinite(idx) ? idx : null;
}

/**
 * Insert index into the column's layout list (tasks without the dragged card).
 * Returns null if the column root is not in the DOM.
 *
 * Hovering the Drop here placeholder wins only when the pointer is in the hole.
 * Card splits are visual: upper ~45% of a card is the slot before it, the rest
 * is the slot after (so covering card 1 opens the hole between 1 and 2).
 */
export function resolveInsertIndexUnderPointer(
  columnId: string,
  pointerY: number,
  draggedTaskId?: string,
  _pointerX?: number,
  _currentInsert?: number | null,
  _origin?: { columnId: string; insertIndex: number } | null
): number | null {
  if (typeof document === 'undefined') return null;

  const root = document.querySelector(
    `[data-kanban-column-id="${cssEscape(columnId)}"]`
  );
  if (!(root instanceof HTMLElement)) return null;

  const holeInsert = placeholderInsertAtPointer(root, pointerY);
  if (holeInsert != null) return holeInsert;

  const outside = insertOutsideTaskList(root, pointerY, pointerY);
  if (outside != null) return outside;

  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-kanban-task-row]'))
    .filter((row) => !draggedTaskId || row.dataset.taskId !== draggedTaskId)
    .map((row) => {
      const index = Number(row.dataset.layoutIndex);
      const rect = row.getBoundingClientRect();
      return {
        index,
        top: rect.top,
        height: rect.height,
      };
    })
    .filter((r) => Number.isFinite(r.index) && r.index >= 0 && r.height > 0)
    .sort((a, b) => a.index - b.index);

  const list = columnTaskList(root);
  const layoutCount = list ? layoutCountForList(list) : null;

  if (rows.length === 0) return layoutCount ?? 0;

  const first = rows[0];
  const last = rows[rows.length - 1];

  // Header / Drop here gap above the first card → that card's insert index.
  if (pointerY < first.top) {
    return first.index;
  }
  if (pointerY >= last.top + last.height) {
    return layoutCount != null ? layoutCount : last.index + 1;
  }

  // Split on the card itself (not the gap between cards).
  let insert = last.index + 1;
  for (const row of rows) {
    const split = row.top + row.height * 0.45;
    if (pointerY < split) {
      insert = row.index;
      break;
    }
    insert = row.index + 1;
  }

  return insert;
}

function columnTaskList(root: HTMLElement): HTMLElement | null {
  const list = root.querySelector('[data-kanban-task-list]');
  return list instanceof HTMLElement ? list : null;
}

function layoutCountForList(list: HTMLElement): number | null {
  const n = Number(list.dataset.layoutCount);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Empty space above the card stack → 0; empty space below it (including the
 * stretched gutter of a short column next to a tall one) → end of column.
 * Returns null when the pointer/overlay is vertically inside the stack.
 */
function insertOutsideTaskList(
  root: HTMLElement,
  top: number,
  bottom: number
): number | null {
  const list = columnTaskList(root);
  if (!list) return null;
  const lr = list.getBoundingClientRect();
  const count = layoutCountForList(list);
  if (top >= lr.bottom - 2) return count ?? null;
  if (bottom <= lr.top + 2) return 0;
  return null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}
