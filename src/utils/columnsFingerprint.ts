import type { Columns, Task } from '../types';

/**
 * Compact fingerprint of column task identity/order for skipping redundant
 * setColumns after refreshBoardData (avoids board flash when nothing changed).
 */
export function columnsContentFingerprint(columns: Columns | null | undefined): string {
  if (!columns || Object.keys(columns).length === 0) return '';
  return Object.keys(columns)
    .sort()
    .map((columnId) => {
      const tasks = columns[columnId]?.tasks || [];
      const parts = tasks.map((t: Task) => {
        const pos = t.position ?? '';
        const ticket = t.ticket ?? '';
        const title = t.title ?? '';
        const member = t.memberId ?? '';
        return `${t.id}:${pos}:${ticket}:${member}:${title}`;
      });
      return `${columnId}=${parts.join(',')}`;
    })
    .join('|');
}
