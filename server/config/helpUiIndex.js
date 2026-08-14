import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HELP_UI_REVEAL } from './helpUiReveal.js';

const INDEX_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpUiIndex.generated.json'
);

let cached = null;

export function loadHelpUiIndex() {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  cached = Array.isArray(raw.entries) ? raw.entries : [];
  return cached;
}

export function findHelpUiTarget(id, isAdmin) {
  if (!id) return null;
  const row = loadHelpUiIndex().find((r) => r.id === id);
  if (!row) return null;
  if (row.adminOnly && !isAdmin) return null;
  return row;
}

export function targetToGoThere(row) {
  if (!row) return null;
  const highlights = Array.isArray(row.highlights) ? row.highlights : [];
  const reveal = HELP_UI_REVEAL[row.id] || [];
  const extra = reveal.length ? { reveal } : {};
  if (row.kind === 'admin') {
    return { kind: 'admin', hash: row.hash || '#admin', highlights, ...extra };
  }
  if (row.kind === 'page') {
    return { kind: 'page', page: row.page || 'reports', highlights, ...extra };
  }
  if (row.kind === 'profile') {
    return { kind: 'profile', profileFocus: row.profileFocus || 'displayName', highlights, ...extra };
  }
  return { kind: 'view', mode: row.mode || 'kanban', highlights, ...extra };
}

export function formatRetrievedLines(rows) {
  return rows
    .map((r) => {
      const loc =
        r.kind === 'admin'
          ? r.hash
          : r.kind === 'page'
            ? r.page
            : r.kind === 'profile'
              ? 'profile'
              : `view:${r.mode || 'kanban'}`;
      return `${r.id} | ${r.en} / ${r.fr} | ${loc} | ${r.audience || (r.adminOnly ? 'admin' : 'user')}`;
    })
    .join('\n');
}
