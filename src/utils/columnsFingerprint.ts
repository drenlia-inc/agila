import type { Columns, Task } from '../types';

/**
 * Compact fingerprint of column layout + task identity/order for skipping
 * redundant setColumns after refreshBoardData (avoids board flash when nothing
 * changed). Includes column `position` so pure column reorders are not treated
 * as identical (important for multi-pod WS misses / error rollback).
 */
export function columnsContentFingerprint(columns: Columns | null | undefined): string {
  if (!columns || Object.keys(columns).length === 0) return '';
  return Object.keys(columns)
    .sort()
    .map((columnId) => {
      const column = columns[columnId];
      const columnPos = column?.position ?? '';
      const tasks = column?.tasks || [];
      const parts = tasks.map((t: Task) => {
        const pos = t.position ?? '';
        const ticket = t.ticket ?? '';
        const title = t.title ?? '';
        const member = t.memberId ?? '';
        return `${t.id}:${pos}:${ticket}:${member}:${title}`;
      });
      return `${columnId}@${columnPos}=${parts.join(',')}`;
    })
    .join('|');
}
