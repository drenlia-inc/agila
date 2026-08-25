/**
 * Utility functions for column management
 */

import api from '../api';
import type { Columns } from '../types';

/** True when a column is the Archive lane (`is_archived`). */
export function isArchivedColumnFlag(
  column?: { is_archived?: boolean | number } | null
): boolean {
  return column?.is_archived === true || column?.is_archived === 1;
}

export function sameColumnIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

/** Active (non-archive) column ids in board order — the default Status selection. */
export function defaultVisibleColumnIds(columns: Columns): string[] {
  return Object.values(columns)
    .filter((column) => !isArchivedColumnFlag(column))
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((column) => column.id);
}

/**
 * Drop ids that no longer exist. If nothing remains, or the remainder is just
 * the default (every active status), return null so callers clear the override.
 */
export function reconcileVisibleColumnIds(
  selected: string[] | null | undefined,
  columns: Columns
): string[] | null {
  if (!selected) return null;
  const known = new Set(selected.filter((id) => columns[id]));
  if (known.size === 0) return null;
  const defaults = defaultVisibleColumnIds(columns);
  if (sameColumnIdSet([...known], defaults)) return null;
  return Object.values(columns)
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((column) => column.id)
    .filter((id) => known.has(id));
}

/** Id of the Archive column on a board, or null when none exists. */
export function getArchivedColumnId(
  columns?: Record<string, { id: string; is_archived?: boolean | number }> | null
): string | null {
  if (!columns) return null;
  const archive = Object.values(columns).find((col) => isArchivedColumnFlag(col));
  return archive?.id ?? null;
}

export const isColumnFinished = (columnName: string, finishedColumnNames: string[]): boolean => {
  if (!columnName || !finishedColumnNames || finishedColumnNames.length === 0) {
    return false;
  }
  
  return finishedColumnNames.some(finishedName => 
    finishedName.toLowerCase() === columnName.toLowerCase()
  );
};

/**
 * Parses the finished column names from the settings JSON string
 * @param finishedColumnNamesJson - JSON string containing the finished column names
 * @returns Array of finished column names, or default values if parsing fails
 */
export const parseFinishedColumnNames = (finishedColumnNamesJson?: string): string[] => {
  if (!finishedColumnNamesJson) {
    return ['Done', 'Terminé', 'Completed', 'Complété', 'Finished', 'Fini'];
  }
  
  try {
    const parsed = JSON.parse(finishedColumnNamesJson);
    return Array.isArray(parsed) ? parsed : ['Done', 'Terminé', 'Completed', 'Complété', 'Finished', 'Fini'];
  } catch (error) {
    console.error('Error parsing finished column names:', error);
    return ['Done', 'Terminé', 'Completed', 'Complété', 'Finished', 'Fini'];
  }
};

/**
 * Renumbers columns for a board to ensure clean position values
 * @param boardId - The ID of the board whose columns should be renumbered
 * @returns Promise that resolves when renumbering is complete
 */
export const renumberColumns = async (boardId: string): Promise<void> => {
  try {
    const { data } = await api.post('/columns/renumber', { boardId });
    return data;
  } catch (error) {
    console.error('Failed to renumber columns:', error);
    throw error;
  }
};
