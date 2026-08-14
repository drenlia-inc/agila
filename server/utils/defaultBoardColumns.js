/**
 * Default columns created on new boards (Archive is always appended, not stored).
 */

import { wrapQuery } from './queryLogger.js';
import { getAppLanguage } from './i18n.js';

export const DEFAULT_BOARD_COLUMNS_SETTING_KEY = 'DEFAULT_BOARD_COLUMNS';

export const BUILTIN_DEFAULT_BOARD_COLUMNS = [
  { id: 'todo', titleEn: 'To Do', titleFr: 'À faire', isFinished: false },
  { id: 'progress', titleEn: 'In Progress', titleFr: 'En cours', isFinished: false },
  { id: 'testing', titleEn: 'Testing', titleFr: 'Test', isFinished: false },
  { id: 'completed', titleEn: 'Completed', titleFr: 'Terminé', isFinished: true },
];

export const DEFAULT_BOARD_COLUMNS_JSON = JSON.stringify(BUILTIN_DEFAULT_BOARD_COLUMNS);

function isArchiveTitle(title) {
  return String(title || '').trim().toLowerCase() === 'archive';
}

function normalizeRow(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim() || `col-${index + 1}`;
  const titleEn = String(raw.titleEn ?? raw.title_en ?? '').trim();
  const titleFr = String(raw.titleFr ?? raw.title_fr ?? '').trim();
  const isFinished = raw.isFinished === true || raw.is_finished === true;
  if (isArchiveTitle(titleEn) || isArchiveTitle(titleFr)) return null;
  if (!titleEn || !titleFr) return null;
  return { id, titleEn, titleFr, isFinished };
}

export function parseDefaultBoardColumns(json) {
  if (!json) return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(parsed)) {
      return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
    }
    const rows = parsed.map(normalizeRow).filter(Boolean);
    const finishedCount = rows.filter((r) => r.isFinished).length;
    const activeCount = rows.filter((r) => !r.isFinished).length;
    if (rows.length < 2 || finishedCount !== 1 || activeCount < 1) {
      return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
    }
    return rows;
  } catch {
    return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
  }
}

/**
 * Columns to insert for a new board, including a trailing Archive column.
 * @returns {Promise<Array<{ id: string, title: string, isFinished: boolean, isArchived: boolean }>>}
 */
export async function getDefaultBoardColumns(db) {
  const lang = await getAppLanguage(db);
  let raw = '';
  try {
    const setting = await wrapQuery(
      db.prepare('SELECT value FROM settings WHERE key = ?'),
      'SELECT'
    ).get(DEFAULT_BOARD_COLUMNS_SETTING_KEY);
    raw = setting?.value || '';
  } catch (error) {
    console.error('Failed to read DEFAULT_BOARD_COLUMNS:', error);
  }

  const rows = parseDefaultBoardColumns(raw);
  const useFr = lang === 'fr';
  const workflow = rows.map((row) => ({
    id: row.id,
    title: useFr ? row.titleFr : row.titleEn,
    isFinished: !!row.isFinished,
    isArchived: false,
  }));

  workflow.push({
    id: 'archive',
    title: 'Archive',
    isFinished: false,
    isArchived: true,
  });

  return workflow;
}
