/**
 * Kanban insert index from the drag ghost (overlay) edges.
 *
 * Use column bounding boxes (not elementsFromPoint) so the drag overlay cannot
 * steal hit-testing. Insert index is measured from visible `[data-kanban-task-row]`
 * slots in the layout list (dragged task already omitted from those rows).
 *
 * Geometry is visual: the in-flow Drop here hole shifts cards down. The ghost’s
 * leading edge (bottom when moving down, top when moving up) is tested against
 * card midlines. Pointer Y is a fallback when there is no overlay.
 *
 * Windowed columns only mount a slice of rows. Past the last *visible* card is
 * not the end of the column — map Y through registered virtual offsets instead.
 */

import { insertIndexFromColumnLayout } from './columnVirtualLayout';

/** Extra px past a card midline before the hole steps (avoids flicker). */
const INSERT_HYSTERESIS_PX = 6;
/** Ghost past the task-list edge by this much snaps to top/bottom. */
const COLUMN_EDGE_MAGNET_PX = 12;
/** Ignore midY jitter smaller than this when deciding up vs down. */
const DIRECTION_DEADZONE_PX = 2;
/** Overlay width in a second column that counts as “straddling”. */
const STRADDLE_COLUMN_MIN_WIDTH = 24;

type InsertHysteresis = {
  columnId: string;
  insertIndex: number;
  midY: number;
  movingDown: boolean;
};

/**
 * Ghost top edge at the first card’s top — slot 0.
 * Pointer below the first-card magnet must not force slot 0: a tall ghost on a
 * short card used to flip 0↔1 every frame as the 76px hole shoved the stack.
 */
function overlayAtFirstCardTop(
  overlay: DOMRectReadOnly,
  first: { index: number; top: number },
  pointerY?: number
): boolean {
  if (first.index !== 0) return false;
  if (
    pointerY != null &&
    Number.isFinite(pointerY) &&
    pointerY > first.top + COLUMN_EDGE_MAGNET_PX + 8
  ) {
    return false;
  }
  return overlay.top <= first.top + COLUMN_EDGE_MAGNET_PX;
}

/** Live card boxes include the Drop here hole; targeting must not. */
function unshiftRowsByHole<T extends { index: number; top: number }>(
  rows: T[],
  hole: { index: number; top: number; bottom: number } | null
): T[] {
  if (!hole || rows.length === 0) return rows;
  const holeH = Math.max(0, hole.bottom - hole.top);
  if (holeH < 8) return rows;
  return rows.map((row) => {
    if (row.index < hole.index) return row;
    const next = { ...row, top: row.top - holeH };
    if ('bottom' in row && typeof (row as { bottom?: number }).bottom === 'number') {
      (next as T & { bottom: number }).bottom =
        (row as T & { bottom: number }).bottom - holeH;
    }
    return next;
  });
}

function overlayProbeY(overlay: DOMRectReadOnly, pointerY?: number): number {
  if (pointerY != null && Number.isFinite(pointerY)) return pointerY;
  return overlay.top + Math.min(28, overlay.height / 2);
}

let insertHysteresis: InsertHysteresis | null = null;

export function resetInsertHysteresis(): void {
  insertHysteresis = null;
}

type ColumnOverlap = {
  id: string;
  area: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * Live board only. Trash stays mounted (even when collapsed) with the same
 * `data-kanban-column-id` values; an unscoped querySelector hits those first
 * and every insert resolves to 0 (top of an empty trash column).
 */
function liveBoardRoot(): ParentNode | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-kanban-scroll="board"]');
}

function columnRootById(columnId: string): HTMLElement | null {
  const scope = liveBoardRoot() ?? (typeof document !== 'undefined' ? document : null);
  if (!scope) return null;
  const root = scope.querySelector(
    `[data-kanban-column-id="${cssEscape(columnId)}"]`
  );
  return root instanceof HTMLElement ? root : null;
}

function eachKanbanColumn(
  visit: (id: string, rect: DOMRect, el: HTMLElement) => void
): void {
  const scope = liveBoardRoot();
  if (!scope) return;
  const roots = scope.querySelectorAll('[data-kanban-column-id]');
  for (const root of roots) {
    if (!(root instanceof HTMLElement)) continue;
    const id = root.getAttribute('data-kanban-column-id');
    if (!id) continue;
    visit(id, root.getBoundingClientRect(), root);
  }
}

/** Overlay must move this far horizontally before a dest sliver counts (same-column vertical drags). */
export const OVERLAY_SIDEWAYS_PX = 40;

function overlayHasMovedSideways(
  overlay: DOMRectReadOnly | null | undefined,
  startLeft: number | null | undefined
): boolean {
  if (!overlay || startLeft == null || !Number.isFinite(startLeft)) return false;
  return Math.abs(overlay.left - startLeft) >= OVERLAY_SIDEWAYS_PX;
}

/**
 * Column under a point. The gutter between columns counts as the nearer
 * column so a sideways drop does not require the cursor to fully enter dest.
 * When the pointer sits just above/below a column (auto-scroll edge), keep
 * the column whose horizontal lane still contains X.
 */
export function resolveColumnIdUnderPointer(x: number, y: number): string | null {
  let insideId: string | null = null;
  let insideArea = Infinity;
  const gutter: { id: string; dx: number }[] = [];
  const lane: { id: string; dy: number }[] = [];
  eachKanbanColumn((id, r) => {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const area = r.width * r.height;
      if (area < insideArea) {
        insideId = id;
        insideArea = area;
      }
      return;
    }
    if (x >= r.left && x <= r.right) {
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dy > 0 && dy <= 96) lane.push({ id, dy });
    }
    if (y < r.top || y > r.bottom) return;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (dx > 0 && dx <= 28) gutter.push({ id, dx });
  });
  if (insideId) return insideId;
  if (gutter.length > 0) {
    gutter.sort((a, b) => a.dx - b.dx);
    return gutter[0].id;
  }
  if (lane.length === 0) return null;
  lane.sort((a, b) => a.dy - b.dy);
  return lane[0].id;
}

function collectColumnOverlaps(rect: DOMRectReadOnly): ColumnOverlap[] {
  const hits: ColumnOverlap[] = [];
  eachKanbanColumn((id, r) => {
    const width = Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left));
    const height = Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
    if (width <= 0 || height <= 0) return;
    hits.push({
      id,
      area: width * height,
      width,
      height,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    });
  });
  hits.sort((a, b) => b.area - a.area);
  return hits;
}

export type OverlayDropHit = {
  columnId: string;
  insertIndex: number;
};

/**
 * The Drop here the user can see right now. Prefer this over overlay/pointer
 * geometry: the ghost can sit on the source column while the hole is in dest.
 */
export function readPaintedDropPlaceholder(): OverlayDropHit | null {
  if (typeof document === 'undefined') return null;
  const holes = document.querySelectorAll('[data-kanban-drop-placeholder]');
  let best: { hit: OverlayDropHit; height: number } | null = null;
  for (const hole of holes) {
    if (!(hole instanceof HTMLElement)) continue;
    const hr = hole.getBoundingClientRect();
    if (hr.height < 8 || hr.width < 8) continue;
    const col = hole.closest('[data-kanban-column-id]');
    const columnId = col?.getAttribute('data-kanban-column-id');
    const insertIndex = Number(hole.dataset.insertIndex);
    if (!columnId || !Number.isFinite(insertIndex)) continue;
    if (!best || hr.height > best.height) {
      best = { hit: { columnId, insertIndex }, height: hr.height };
    }
  }
  return best?.hit ?? null;
}

export function overlayIntersectsColumn(
  overlay: DOMRectReadOnly,
  columnId: string
): boolean {
  if (typeof document === 'undefined') return false;
  const root = columnRootById(columnId);
  if (!root) return false;
  return rectIntersectionArea(overlay, root.getBoundingClientRect()) > 0;
}

function toExcludeSet(ids?: string | string[] | null): Set<string> {
  if (ids == null || ids === '') return new Set();
  return new Set(Array.isArray(ids) ? ids.filter(Boolean) : [ids]);
}

function rowIsExcluded(row: HTMLElement, exclude: Set<string>): boolean {
  const id = row.dataset.taskId;
  return !!id && exclude.has(id);
}

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
  excludeTaskIds?: string | string[] | null
): number {
  const exclude = toExcludeSet(excludeTaskIds);
  let max = 0;
  const rows = columnRoot.querySelectorAll('[data-kanban-task-row]');
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (rowIsExcluded(row, exclude)) continue;
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
  excludeTaskIds?: string | string[] | null
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
    // Ghost already past this hole — don't freeze insert on a stale Drop here.
    if (overlay.top >= hr.bottom - 4 || overlay.bottom <= hr.top + 4) continue;
    const col = hole.closest('[data-kanban-column-id]');
    const columnId = col?.getAttribute('data-kanban-column-id');
    const insertIndex = Number(hole.dataset.insertIndex);
    if (!columnId || !Number.isFinite(insertIndex)) continue;
    const cardArea = maxTaskRowOverlap(col ?? hole, overlay, excludeTaskIds);
    if (area <= cardArea) continue;
    if (!best || area > best.area) {
      best = { hit: { columnId, insertIndex }, area };
    }
  }
  return best?.hit ?? null;
}

/**
 * Column the ghost is targeting. A sliver over dest is enough — sideways
 * moves must not wait until the pointer is fully inside that column.
 */
export function resolveColumnIdUnderRect(
  rect: DOMRectReadOnly,
  originColumnId?: string | null,
  overlayStartLeft?: number | null
): string | null {
  const hits = collectColumnOverlaps(rect);
  if (hits.length === 0) return null;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const centerCol = resolveColumnIdUnderPointer(cx, cy);
  // Overlay center in a dest column wins. A 12px sliver on the adjacent
  // column used to return first and trapped every later column.
  if (centerCol && originColumnId && centerCol !== originColumnId) {
    return centerCol;
  }

  // Dest sliver is only for a real sideways drag. Vertical scroll in origin
  // often overlaps the next column by a few pixels and must stay in origin.
  if (originColumnId && overlayHasMovedSideways(rect, overlayStartLeft)) {
    const crossed = hits.filter(
      (h) =>
        h.id !== originColumnId &&
        (h.width >= 12 || h.area >= 200)
    );
    if (crossed.length > 0) return crossed[0].id;
  }

  if (centerCol) return centerCol;

  if (originColumnId) {
    const originHit = hits.find((h) => h.id === originColumnId);
    if (originHit) {
      if (rect.right > originHit.right + 4) {
        const right = hits.find((h) => h.id !== originColumnId && h.left >= originHit.right - 8);
        if (right) return right.id;
      }
      if (rect.left < originHit.left - 4) {
        const left = hits.find((h) => h.id !== originColumnId && h.right <= originHit.left + 8);
        if (left) return left.id;
      }
    }
  }

  return hits[0].id;
}

/** Ghost covers two columns enough that the pointer should pick which one. */
export function overlayStraddlesKanbanColumns(overlay: DOMRectReadOnly): boolean {
  const hits = collectColumnOverlaps(overlay);
  return hits.filter((h) => h.width >= STRADDLE_COLUMN_MIN_WIDTH && h.height >= 16)
    .length >= 2;
}

type DragOrigin = { columnId: string; insertIndex: number };

type LayoutRow = { index: number; top: number; height: number };

function rowMidline(row: LayoutRow): number {
  return row.top + row.height / 2;
}

function lastVisibleIsColumnEnd(
  lastIndex: number,
  layoutCount: number | null
): boolean {
  if (layoutCount == null) return true;
  return lastIndex >= layoutCount - 1;
}

function yInVisibleRowCluster(
  y: number,
  rows: LayoutRow[],
  overlay?: DOMRectReadOnly | null
): boolean {
  if (rows.length === 0) return false;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const clusterTop = first.top;
  const clusterBottom = last.top + last.height;
  if (y >= clusterTop - 4 && y <= clusterBottom + 4) return true;
  if (
    overlay &&
    overlay.bottom >= clusterTop &&
    overlay.top <= clusterBottom
  ) {
    return true;
  }
  return false;
}

function insertFromVirtualOrVisible(
  columnId: string,
  y: number,
  rows: LayoutRow[],
  layoutCount: number | null
): number {
  const virt = insertIndexFromColumnLayout(columnId, y);
  if (virt != null) return virt;
  if (rows.length === 0) return layoutCount ?? 0;
  if (y < rows[0].top) return rows[0].index;
  return rows[rows.length - 1].index + 1;
}

type CardBox = { index: number; top: number; bottom: number };

/** Visual task card, not the row (row can include gap / stretch). */
function visibleCardBoxes(
  root: HTMLElement,
  excludeTaskIds?: string | string[] | null
): CardBox[] {
  const exclude = toExcludeSet(excludeTaskIds);
  return Array.from(root.querySelectorAll<HTMLElement>('[data-kanban-task-row]'))
    .filter((row) => !rowIsExcluded(row, exclude))
    .map((row) => {
      const index = Number(row.dataset.layoutIndex);
      const card =
        row.firstElementChild instanceof HTMLElement
          ? row.firstElementChild
          : row;
      const rect = card.getBoundingClientRect();
      return { index, top: rect.top, bottom: rect.bottom };
    })
    .filter((r) => Number.isFinite(r.index) && r.index >= 0 && r.bottom > r.top)
    .sort((a, b) => a.index - b.index);
}

function stackEndIndex(root: HTMLElement, cards: CardBox[]): number {
  const list = columnTaskList(root);
  const count = list ? layoutCountForList(list) : null;
  if (count != null) return count;
  if (cards.length === 0) return 0;
  return cards[cards.length - 1].index + 1;
}

function paintedHoleInColumn(root: HTMLElement): { index: number; top: number; bottom: number } | null {
  const hole = root.querySelector('[data-kanban-drop-placeholder]');
  if (!(hole instanceof HTMLElement)) return null;
  const index = Number(hole.dataset.insertIndex);
  if (!Number.isFinite(index)) return null;
  const r = hole.getBoundingClientRect();
  if (r.height < 8) return null;
  return { index, top: r.top, bottom: r.bottom };
}

/**
 * Slot 0 above the first card, or last+1 below the last card.
 *
 * The in-flow hole above the last card pushes that card down, so a slow drag
 * never “gets past” last.bottom. Use the hole’s bottom / the last card’s
 * unshifted box instead — once you cross that line, insert is last+1.
 */
export function resolveInsertAtColumnStackEnds(
  columnId: string,
  pointerY: number,
  overlay?: DOMRectReadOnly | null,
  excludeTaskIds?: string | string[] | null
): number | null {
  const root = columnRootById(columnId);
  if (!root) return null;
  const rawCards = visibleCardBoxes(root, excludeTaskIds);
  const end = stackEndIndex(root, rawCards);
  if (rawCards.length === 0) return end;

  const hole = paintedHoleInColumn(root);
  const cards = unshiftRowsByHole(rawCards, hole);
  const first = cards[0];
  const last = cards[cards.length - 1];
  const lastIsColumnEnd = lastVisibleIsColumnEnd(last.index, end);
  const firstIsColumnStart = first.index === 0;
  const lastNaturalBottom = last.bottom;

  const bottomZone = root.querySelector('[data-kanban-column-bottom]');
  if (bottomZone instanceof HTMLElement) {
    const br = bottomZone.getBoundingClientRect();
    if (pointerY >= br.top - 2 && pointerY <= br.bottom + 8) return end;
  }

  // Only the real last card (not the last *visible* virtual row) is a stack end.
  if (lastIsColumnEnd) {
    // Hole is already before the last card — that card is shifted down by the
    // hole. Crossing the hole’s bottom (onto the last card) is last+1.
    if (hole && hole.index === last.index) {
      if (
        pointerY >= hole.bottom - 6 ||
        (overlay != null && overlay.top >= hole.bottom - 4)
      ) {
        return end;
      }
    }
    if (pointerY >= lastNaturalBottom - 4) return end;
    if (overlay && overlay.top >= lastNaturalBottom - 8) return end;
  }

  const topZone = document.getElementById(`${columnId}-task-top`);
  if (topZone) {
    const tr = topZone.getBoundingClientRect();
    if (pointerY >= tr.top && pointerY <= tr.bottom + 4) return 0;
  }
  const header = root.querySelector('[data-column-header]');
  if (header instanceof HTMLElement) {
    const hr = header.getBoundingClientRect();
    if (pointerY >= hr.top - 4 && pointerY <= hr.bottom + 8) return 0;
    if (overlay && overlay.top <= hr.bottom + 8 && overlay.top + 24 >= hr.top) {
      return 0;
    }
  }
  if (firstIsColumnStart) {
    if (overlay && overlayAtFirstCardTop(overlay, first, pointerY)) return 0;
    if (pointerY <= first.top + 4) return 0;
    if (overlay && overlay.bottom <= first.top + 8) return 0;
  }

  return null;
}

/**
 * Leading-edge vs card midlines. Down: ghost bottom crosses next midline →
 * increment. Up: ghost top crosses previous midline → decrement.
 *
 * A title-only stack can be shorter than the ghost. overlay.bottom past the
 * last card is then true even when the ghost still sits on the first card —
 * that must not snap to the end (the hole would vanish at the top).
 */
function insertIndexFromOverlayEdges(
  rows: LayoutRow[],
  overlay: DOMRectReadOnly,
  probeY: number,
  layoutCount: number | null,
  pointerY?: number
): number {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (overlay.bottom <= first.top + COLUMN_EDGE_MAGNET_PX) {
    return first.index;
  }

  // Top of column: ghost top vs first card top. Do not require “moving up”
  // — slow drags otherwise sit on the first card with midY ticking down and
  // never open slot 0.
  if (overlayAtFirstCardTop(overlay, first, pointerY)) {
    return 0;
  }

  const topOnFirstCard = overlay.top < rowMidline(first);

  // Past the last *mounted* card only when the probe has actually moved down
  // off the first card (not merely because the ghost is taller than the stack).
  if (!topOnFirstCard && probeY >= last.top + last.height - 4) {
    if (lastVisibleIsColumnEnd(last.index, layoutCount)) {
      return layoutCount != null ? layoutCount : last.index + 1;
    }
    return last.index + 1;
  }

  let insert = last.index + 1;
  for (const row of rows) {
    if (probeY < rowMidline(row)) {
      insert = row.index;
      break;
    }
    insert = row.index + 1;
  }
  return insert;
}

function applyInsertHysteresis(
  columnId: string,
  rows: LayoutRow[],
  overlay: DOMRectReadOnly,
  raw: number,
  movingDown: boolean,
  probeY: number,
  pointerY?: number
): number {
  const midY = overlay.top + overlay.height / 2;
  const remember = (insertIndex: number) => {
    insertHysteresis = { columnId, insertIndex, midY, movingDown };
    return insertIndex;
  };
  const first = rows[0];
  if (first && overlayAtFirstCardTop(overlay, first, pointerY)) {
    return remember(0);
  }
  if (
    first &&
    insertHysteresis?.columnId === columnId &&
    insertHysteresis.insertIndex === 0 &&
    overlay.top <= first.top + COLUMN_EDGE_MAGNET_PX + INSERT_HYSTERESIS_PX &&
    (pointerY == null || pointerY <= first.top + COLUMN_EDGE_MAGNET_PX + INSERT_HYSTERESIS_PX + 8)
  ) {
    return remember(0);
  }
  const last = insertHysteresis?.columnId === columnId ? insertHysteresis : null;
  if (!last) {
    return remember(raw);
  }
  if (raw === last.insertIndex) {
    return remember(raw);
  }
  if (raw > last.insertIndex) {
    const crossed = rows.find((r) => r.index === last.insertIndex);
    if (crossed && probeY < rowMidline(crossed) + INSERT_HYSTERESIS_PX) {
      return remember(last.insertIndex);
    }
  } else {
    const prev = rows.find((r) => r.index === last.insertIndex - 1);
    if (prev && probeY > rowMidline(prev) - INSERT_HYSTERESIS_PX) {
      return remember(last.insertIndex);
    }
  }
  return remember(raw);
}

/**
 * Same-column: the vacated slot stays targetable. The card that slid into it
 * uses an upper-half “put back” zone; the card immediately above uses a
 * lower-half put-back zone. Other cards keep before/after. Cross-column:
 * wide top zone on the first card (~60%), otherwise the 45% split.
 */
function insertIndexOnCard(
  card: { index: number; top: number; height: number },
  y: number,
  columnId: string,
  origin?: DragOrigin | null
): number {
  const sameCol = !!origin && origin.columnId === columnId;
  if (sameCol && origin) {
    const originIdx = origin.insertIndex;
    const frac = (y - card.top) / Math.max(1, card.height);
    // Card that filled the hole: upper half returns to origin.
    if (card.index === originIdx) {
      return frac < 0.55 ? originIdx : card.index + 1;
    }
    // Card immediately above the hole: lower half returns to origin.
    if (card.index === originIdx - 1) {
      return frac < 0.45 ? card.index : originIdx;
    }
    if (card.index < originIdx) return card.index;
    return card.index + 1;
  }
  const split = card.index === 0 ? 0.6 : 0.45;
  return y < card.top + card.height * split ? card.index : card.index + 1;
}

/**
 * Insert index from the ghost rect: leading edge vs card midlines, with a
 * few px of hysteresis so the Drop here hole does not flicker.
 */
export function resolveInsertIndexFromOverlay(
  columnId: string,
  overlay: DOMRectReadOnly,
  excludeTaskIds?: string | string[] | null,
  _origin?: { columnId: string; insertIndex: number } | null,
  pointerY?: number
): number | null {
  if (typeof document === 'undefined') return null;

  const root = columnRootById(columnId);
  if (!root) return null;

  const midY = overlay.top + overlay.height / 2;
  const remember = (insertIndex: number, movingDown = false) => {
    insertHysteresis = { columnId, insertIndex, midY, movingDown };
    return insertIndex;
  };

  const outside = insertOutsideTaskList(root, overlay.top, overlay.bottom);
  if (outside != null) return remember(outside);

  const exclude = toExcludeSet(excludeTaskIds);
  const hole = paintedHoleInColumn(root);
  const rows = unshiftRowsByHole(
    Array.from(root.querySelectorAll<HTMLElement>('[data-kanban-task-row]'))
      .filter((row) => !rowIsExcluded(row, exclude))
      .map((row) => {
        const index = Number(row.dataset.layoutIndex);
        const card =
          row.firstElementChild instanceof HTMLElement
            ? row.firstElementChild
            : row;
        const rect = card.getBoundingClientRect();
        return { index, top: rect.top, height: rect.height };
      })
      .filter((r) => Number.isFinite(r.index) && r.index >= 0 && r.height > 8)
      .sort((a, b) => a.index - b.index),
    hole
  );

  const list = columnTaskList(root);
  const layoutCount = list ? layoutCountForList(list) : null;
  const probeY = overlayProbeY(overlay, pointerY);

  if (rows.length === 0) {
    return remember(
      insertFromVirtualOrVisible(columnId, probeY, rows, layoutCount)
    );
  }

  const lastRow = rows[rows.length - 1];
  const lastIsColumnEnd = lastVisibleIsColumnEnd(lastRow.index, layoutCount);
  const topOnFirstCard = overlay.top < rowMidline(rows[0]);

  if (
    lastIsColumnEnd &&
    !topOnFirstCard &&
    probeY >= lastRow.top + lastRow.height - 8
  ) {
    return remember(layoutCount != null ? layoutCount : lastRow.index + 1);
  }

  if (!yInVisibleRowCluster(probeY, rows, overlay)) {
    return remember(insertFromVirtualOrVisible(columnId, probeY, rows, layoutCount));
  }

  const last = insertHysteresis?.columnId === columnId ? insertHysteresis : null;
  let movingDown = last?.movingDown ?? !topOnFirstCard;
  if (last) {
    if (midY > last.midY + DIRECTION_DEADZONE_PX) movingDown = true;
    else if (midY < last.midY - DIRECTION_DEADZONE_PX) movingDown = false;
  }
  const raw = insertIndexFromOverlayEdges(
    rows,
    overlay,
    probeY,
    layoutCount,
    pointerY
  );
  return applyInsertHysteresis(
    columnId,
    rows,
    overlay,
    raw,
    movingDown,
    probeY,
    pointerY
  );
}

/**
 * Drop target from the dragged card: overlapping Drop here first, else the
 * column under the overlay using card-vs-ghost overlap.
 */
export function resolveDropFromOverlay(
  overlay: DOMRectReadOnly,
  excludeTaskIds?: string | string[] | null,
  origin?: { columnId: string; insertIndex: number } | null
): OverlayDropHit | null {
  const snap = findPlaceholderHitByOverlay(overlay, excludeTaskIds);
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
    excludeTaskIds,
    origin
  );
  if (insertIndex == null) return null;
  return { columnId, insertIndex };
}

/**
 * Live drop target. Slot comes from the ghost edges. Pointer only picks the
 * column when the ghost straddles two columns (or when there is no overlay).
 */
export function resolveKanbanDropTarget(args: {
  pointerX: number;
  pointerY: number;
  overlay: DOMRectReadOnly | null;
  origin: DragOrigin | null;
  excludeTaskIds?: string | string[] | null;
  overlayStartLeft?: number | null;
}): OverlayDropHit | null {
  const { pointerX, pointerY, overlay, origin, excludeTaskIds, overlayStartLeft } = args;
  const painted = readPaintedDropPlaceholder();
  const pointerCol = resolveColumnIdUnderPointer(pointerX, pointerY);
  const overlayCol = overlay
    ? resolveColumnIdUnderRect(overlay, origin?.columnId, overlayStartLeft)
    : null;
  const snap = overlay
    ? findPlaceholderHitByOverlay(overlay, excludeTaskIds)
    : null;
  const straddling = overlay ? overlayStraddlesKanbanColumns(overlay) : false;

  let columnId: string | null = null;
  if (overlay && !straddling && overlayCol) {
    columnId = overlayCol;
  } else if (straddling && pointerCol) {
    columnId = pointerCol;
  } else if (pointerCol) {
    columnId = pointerCol;
  } else {
    columnId = overlayCol || origin?.columnId || null;
  }
  if (!columnId) return null;

  const endSlot = resolveInsertAtColumnStackEnds(
    columnId,
    pointerY,
    overlay,
    excludeTaskIds
  );
  if (endSlot != null) return { columnId, insertIndex: endSlot };

  if (overlay) {
    if (snap?.columnId === columnId) return snap;
    const insertIndex = resolveInsertIndexFromOverlay(
      columnId,
      overlay,
      excludeTaskIds,
      origin,
      pointerY
    );
    if (insertIndex != null) return { columnId, insertIndex };
  }

  if (pointerCol === columnId) {
    const root = columnRootById(columnId);
    if (root) {
      const holeInsert = placeholderInsertAtPointer(root, pointerY);
      if (holeInsert != null) return { columnId, insertIndex: holeInsert };
    }
    const insertIndex = resolveInsertIndexUnderPointer(
      columnId,
      pointerY,
      excludeTaskIds,
      pointerX,
      null,
      origin
    );
    if (insertIndex != null) return { columnId, insertIndex };
  }
  if (painted?.columnId === columnId) return painted;
  return { columnId, insertIndex: 0 };
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
  excludeTaskIds?: string | string[] | null,
  _pointerX?: number,
  _currentInsert?: number | null,
  origin?: { columnId: string; insertIndex: number } | null
): number | null {
  if (typeof document === 'undefined') return null;

  const root = columnRootById(columnId);
  if (!root) return null;

  const holeInsert = placeholderInsertAtPointer(root, pointerY);
  if (holeInsert != null) return holeInsert;

  const outside = insertOutsideTaskList(root, pointerY, pointerY);
  if (outside != null) return outside;

  const exclude = toExcludeSet(excludeTaskIds);
  const hole = paintedHoleInColumn(root);
  const rows = unshiftRowsByHole(
    Array.from(root.querySelectorAll<HTMLElement>('[data-kanban-task-row]'))
      .filter((row) => !rowIsExcluded(row, exclude))
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
      .sort((a, b) => a.index - b.index),
    hole
  );

  const list = columnTaskList(root);
  const layoutCount = list ? layoutCountForList(list) : null;

  if (rows.length === 0) {
    return insertFromVirtualOrVisible(columnId, pointerY, rows, layoutCount);
  }

  const first = rows[0];
  const last = rows[rows.length - 1];

  if (pointerY < first.top) {
    if (first.index === 0) return first.index;
    return insertFromVirtualOrVisible(columnId, pointerY, rows, layoutCount);
  }
  if (pointerY >= last.top + last.height) {
    if (lastVisibleIsColumnEnd(last.index, layoutCount)) {
      return layoutCount != null ? layoutCount : last.index + 1;
    }
    return insertFromVirtualOrVisible(columnId, pointerY, rows, layoutCount);
  }

  for (const row of rows) {
    const rowBottom = row.top + row.height;
    if (pointerY >= row.top && pointerY < rowBottom) {
      return insertIndexOnCard(row, pointerY, columnId, origin);
    }
  }

  let insert = last.index + 1;
  for (const row of rows) {
    if (pointerY < row.top) {
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
  if (top >= lr.bottom - COLUMN_EDGE_MAGNET_PX) return count ?? null;
  if (bottom <= lr.top + COLUMN_EDGE_MAGNET_PX) return 0;
  return null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}
