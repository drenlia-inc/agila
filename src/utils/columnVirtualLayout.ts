/**
 * Live virtual-list geometry for a kanban column.
 *
 * Windowed columns only mount cards in the viewport. Insert targeting must
 * still map a pointer Y onto the full remapped layout (not only visible rows).
 * Column registers offsets here; dnd insert reads them during drag.
 */

export type ColumnDragLayout = {
  layoutCount: number;
  windowed: boolean;
  listEl: HTMLElement;
  /** px from list top to the painted card at this remapped layout index. */
  offsetOfLayoutIndex: (layoutIndex: number) => number;
  /** Card + gap height (no insert hole) at this remapped layout index. */
  heightOfLayoutIndex: (layoutIndex: number) => number;
};

const layouts = new Map<string, ColumnDragLayout>();

export function setColumnDragLayout(
  columnId: string,
  layout: ColumnDragLayout | null
): void {
  if (layout && layout.layoutCount > 0) {
    layouts.set(columnId, layout);
    return;
  }
  layouts.delete(columnId);
}

export function clearColumnDragLayout(columnId: string): void {
  layouts.delete(columnId);
}

export function getColumnDragLayout(columnId: string): ColumnDragLayout | null {
  return layouts.get(columnId) ?? null;
}

/**
 * Insert index from a viewport Y using registered virtual offsets.
 * Midline walk: above a card’s midpoint → that slot; past the last midpoint → end.
 */
export function insertIndexFromColumnLayout(
  columnId: string,
  viewportY: number
): number | null {
  const layout = layouts.get(columnId);
  if (!layout || layout.layoutCount <= 0 || !layout.listEl.isConnected) {
    return null;
  }
  const listTop = layout.listEl.getBoundingClientRect().top;
  const yIn = viewportY - listTop;
  if (yIn < 0) return 0;
  for (let i = 0; i < layout.layoutCount; i++) {
    const top = layout.offsetOfLayoutIndex(i);
    const h = Math.max(1, layout.heightOfLayoutIndex(i));
    if (yIn < top + h / 2) return i;
  }
  return layout.layoutCount;
}
