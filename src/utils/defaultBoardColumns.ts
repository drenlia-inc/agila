export type DefaultBoardColumnRow = {
  id: string;
  titleEn: string;
  titleFr: string;
  isFinished: boolean;
};

export const BUILTIN_DEFAULT_BOARD_COLUMNS: DefaultBoardColumnRow[] = [
  { id: 'todo', titleEn: 'To Do', titleFr: 'À faire', isFinished: false },
  { id: 'progress', titleEn: 'In Progress', titleFr: 'En cours', isFinished: false },
  { id: 'testing', titleEn: 'Testing', titleFr: 'Test', isFinished: false },
  { id: 'completed', titleEn: 'Completed', titleFr: 'Terminé', isFinished: true },
];

export function isArchiveColumnTitle(title: string): boolean {
  return String(title || '').trim().toLowerCase() === 'archive';
}

export function parseFinishedKeywordList(json?: string): string[] {
  const fallback = ['Done', 'Terminé', 'Completed', 'Complété', 'Finished', 'Fini'];
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((n) => String(n)) : fallback;
  } catch {
    return fallback;
  }
}

export function uniqueNewFinishedKeywords(candidates: string[], existing: string[]): string[] {
  const seen = new Set(existing.map((k) => String(k).trim().toLowerCase()).filter(Boolean));
  const out: string[] = [];
  for (const raw of candidates) {
    const name = String(raw || '').trim();
    if (!name || isArchiveColumnTitle(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function rowMatchesFinishedKeywords(
  row: Pick<DefaultBoardColumnRow, 'titleEn' | 'titleFr'>,
  keywords: string[]
): boolean {
  const names = [row.titleEn, row.titleFr].map((t) => t.trim().toLowerCase()).filter(Boolean);
  return keywords.some((k) => names.includes(String(k).trim().toLowerCase()));
}

export function parseDefaultBoardColumns(json?: string): DefaultBoardColumnRow[] {
  if (!json) return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
    }
    const rows: DefaultBoardColumnRow[] = [];
    parsed.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const id = String((raw as DefaultBoardColumnRow).id || '').trim() || `col-${index + 1}`;
      const titleEn = String((raw as DefaultBoardColumnRow).titleEn || '').trim();
      const titleFr = String((raw as DefaultBoardColumnRow).titleFr || '').trim();
      const isFinished = (raw as DefaultBoardColumnRow).isFinished === true;
      if (isArchiveColumnTitle(titleEn) || isArchiveColumnTitle(titleFr)) return;
      rows.push({ id, titleEn, titleFr, isFinished });
    });
    return rows.length > 0 ? rows : BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
  } catch {
    return BUILTIN_DEFAULT_BOARD_COLUMNS.map((r) => ({ ...r }));
  }
}

export function serializeDefaultBoardColumns(rows: DefaultBoardColumnRow[]): string {
  return JSON.stringify(
    rows
      .filter((r) => !isArchiveColumnTitle(r.titleEn) && !isArchiveColumnTitle(r.titleFr))
      .map((r) => ({
        id: r.id,
        titleEn: r.titleEn.trim(),
        titleFr: r.titleFr.trim(),
        isFinished: !!r.isFinished,
      }))
  );
}

export function duplicateTitleInLanguage(
  rows: DefaultBoardColumnRow[],
  field: 'titleEn' | 'titleFr',
  value: string,
  exceptId?: string
): boolean {
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  return rows.some(
    (r) => r.id !== exceptId && r[field].trim().toLowerCase() === needle
  );
}
