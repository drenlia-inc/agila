import type { Column } from '../types';

export type KeyboardMoveSlot = {
  columnId: string;
  insertIndex: number;
};

const parsePos = (pos: unknown): number =>
  typeof pos === 'number' ? pos : parseFloat(String(pos)) || 0;

export function orderedKeyboardColumnIds(columns: {
  [key: string]: Column;
}): string[] {
  return Object.values(columns)
    .filter((col) => col && !col.is_archived)
    .sort((a, b) => parsePos(a.position) - parsePos(b.position))
    .map((col) => col.id);
}

export function keyboardLayoutCount(
  columns: { [key: string]: Column },
  columnId: string,
  excludeIds: string[]
): number {
  const exclude = new Set(excludeIds.filter(Boolean));
  const tasks = columns[columnId]?.tasks || [];
  return tasks.filter((t) => t?.id && !exclude.has(t.id)).length;
}

export function stepKeyboardMoveSlot(
  slot: KeyboardMoveSlot,
  code: string,
  columns: { [key: string]: Column },
  excludeIds: string[]
): KeyboardMoveSlot {
  const ids = orderedKeyboardColumnIds(columns);
  const count = keyboardLayoutCount(columns, slot.columnId, excludeIds);
  let { columnId, insertIndex } = slot;

  if (code === 'ArrowDown' || code === 'ArrowUp') {
    const next =
      code === 'ArrowDown'
        ? Math.min(count, insertIndex + 1)
        : Math.max(0, insertIndex - 1);
    return { columnId, insertIndex: next };
  }

  if (code === 'ArrowRight' || code === 'ArrowLeft') {
    const i = ids.indexOf(columnId);
    const destId =
      code === 'ArrowRight' ? ids[i + 1] : i > 0 ? ids[i - 1] : undefined;
    if (!destId) return slot;
    const destCount = keyboardLayoutCount(columns, destId, excludeIds);
    return {
      columnId: destId,
      insertIndex: Math.max(0, Math.min(insertIndex, destCount)),
    };
  }

  return slot;
}

export function coordinatesForKeyboardSlot(
  slot: KeyboardMoveSlot
): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  const scope = document.querySelector('[data-kanban-scroll="board"]') || document;
  const root = scope.querySelector(
    `[data-kanban-column-id="${cssEscape(slot.columnId)}"]`
  );
  if (!(root instanceof HTMLElement)) return null;

  const hole = root.querySelector('[data-kanban-drop-placeholder]');
  if (hole instanceof HTMLElement) {
    const r = hole.getBoundingClientRect();
    if (r.height > 4 && r.width > 4) {
      hole.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }

  const rows = Array.from(
    root.querySelectorAll<HTMLElement>('[data-kanban-task-row]')
  );
  const at = rows.find((row) => Number(row.dataset.layoutIndex) === slot.insertIndex);
  if (at) {
    const r = at.getBoundingClientRect();
    at.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return { x: r.left + r.width / 2, y: r.top + 8 };
  }

  const list = root.querySelector('[data-kanban-task-list]');
  if (list instanceof HTMLElement) {
    const r = list.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom - 8 };
  }

  const cr = root.getBoundingClientRect();
  return { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}
