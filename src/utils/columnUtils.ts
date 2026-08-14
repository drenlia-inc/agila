/**
 * Utility functions for column management
 */

import api from '../api';

/** True when a column is the Archive lane (`is_archived`). */
export function isArchivedColumnFlag(
  column?: { is_archived?: boolean | number } | null
): boolean {
  return column?.is_archived === true || column?.is_archived === 1;
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
