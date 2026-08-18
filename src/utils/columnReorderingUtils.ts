import type { Column, Columns } from '../types';

/**
 * Optimistically reorder columns to match POST /columns/reorder + renumber semantics.
 * `newPosition` is the destination position index in the current 0..n-1 order
 * (same value the DnD layer sends to the API).
 */
export function applyLocalColumnReorder(
  columns: Columns,
  columnId: string,
  newPosition: number
): Columns | null {
  const sorted = Object.values(columns).sort(
    (a, b) => (a.position || 0) - (b.position || 0)
  );
  const fromIndex = sorted.findIndex((col) => col.id === columnId);
  if (fromIndex === -1) return null;

  const maxPosition = Math.max(0, sorted.length - 1);
  const toIndex = Math.max(0, Math.min(Math.floor(newPosition), maxPosition));
  if (fromIndex === toIndex) return null;

  const next = [...sorted];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  const updated: Columns = {};
  next.forEach((col: Column, index) => {
    updated[col.id] = { ...col, position: index };
  });
  return updated;
}
