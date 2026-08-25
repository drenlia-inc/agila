import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';
import {
  parseDefaultBoardColumns,
  type DefaultBoardColumnRow,
} from './defaultBoardColumns';

export interface ColumnTitleSource {
  id: string;
  title: string;
  boardId: string;
  is_archived?: boolean | number;
}

const normalizeTitle = (value: string): string => value.trim().toLocaleLowerCase();

const seedIdForColumn = (column: ColumnTitleSource): string | null => {
  const suffix = `-${column.boardId}`;
  return column.id.endsWith(suffix) ? column.id.slice(0, -suffix.length) : null;
};

/**
 * Localize untouched columns created from the tenant's bilingual defaults.
 * A title outside the English/French pair is an admin rename and remains
 * exactly as entered.
 */
export function getColumnDisplayTitle(
  column: ColumnTitleSource,
  defaultRows: DefaultBoardColumnRow[],
  language: string,
): string {
  const rawTitle = String(column.title || '').trim();
  const useFrench = language.toLowerCase().startsWith('fr');
  const seedId = seedIdForColumn(column);

  if (
    seedId === 'archive' &&
    ['archive', 'archives'].includes(normalizeTitle(rawTitle))
  ) {
    return useFrench ? 'Archives' : 'Archive';
  }

  if (!seedId) return rawTitle;
  const row = defaultRows.find((candidate) => candidate.id === seedId);
  if (!row) return rawTitle;

  const storedTitle = normalizeTitle(rawTitle);
  const remainsDefault =
    storedTitle === normalizeTitle(row.titleEn) ||
    storedTitle === normalizeTitle(row.titleFr) ||
    // Boards seeded before Testing's French default became "En test".
    (seedId === 'testing' && storedTitle === 'test');
  if (!remainsDefault) return rawTitle;

  return useFrench ? row.titleFr : row.titleEn;
}

export function useColumnDisplayTitle(): (column: ColumnTitleSource) => string {
  const { i18n } = useTranslation();
  const { siteSettings } = useSettings();
  const defaultRows = useMemo(
    () => parseDefaultBoardColumns(siteSettings.DEFAULT_BOARD_COLUMNS),
    [siteSettings.DEFAULT_BOARD_COLUMNS],
  );
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  return useCallback(
    (column: ColumnTitleSource) => getColumnDisplayTitle(column, defaultRows, language),
    [defaultRows, language],
  );
}
