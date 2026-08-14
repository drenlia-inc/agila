import { loadHelpUiIndex } from '../config/helpUiIndex.js';

const STOP = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'how', 'can', 'i', 'do',
  'je', 'le', 'la', 'les', 'de', 'des', 'un', 'une', 'et', 'ou', 'comment', 'peux', 'voir',
  'my', 'me', 'is', 'are', 'with'
]);

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokens(s) {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function expandQuestion(question) {
  const f = fold(question);
  const extra = [];
  if (/supprim|deleted|corbeille|\btrash\b/.test(f)) extra.push('trash', 'corbeille', 'board-trash-toggle', 'deleted');
  if (/archiv/.test(f)) extra.push('archive', 'archived', 'kanban-column-filter');
  if (/\bwip\b|en cours/.test(f)) extra.push('wip', 'column-management-menu');
  if (/activity\s*feed|\bfeed\b|fil d/.test(f)) extra.push('activity-feed', 'profile-activity-feed');
  if (/delete|supprimer/.test(f) && /card|task|tache|carte/.test(f)) extra.push('task-card-delete');
  if (/full.?page|task.?page|entire task|whole task|page view|page tache|vue page/.test(f)) {
    extra.push('task-page-link', 'direct link', 'ticket');
  }
  return extra.length ? `${question} ${extra.join(' ')}` : question;
}

/**
 * Return scored UI rows. Never send the full index to the model.
 * @returns {{ row: object, score: number, hits: number }[]}
 */
export function retrieveHelpUiScored(question, isAdmin, limit = 14) {
  const qTokens = tokens(expandQuestion(question));
  if (qTokens.length === 0) return [];
  const wantsAdmin = qTokens.some((t) => t === 'admin' || t === 'default' || t === 'nouveau' || t === 'nouveaux');

  const scored = [];
  for (const row of loadHelpUiIndex()) {
    if (row.adminOnly && !isAdmin) continue;
    const hay = fold(`${row.searchEn || ''} ${row.searchFr || ''} ${row.id} ${row.value || ''}`);
    let score = 0;
    let hits = 0;
    for (const t of qTokens) {
      if (hay.includes(t)) {
        hits += 1;
        score += hay.split(t).length - 1;
      }
    }
    if (hits === 0) continue;
    if (hits === 1 && qTokens.length > 2) score -= 2;
    if (hits === qTokens.length) score += 8;
    if (!row.adminOnly && !wantsAdmin) score += 3;
    if (row.adminOnly && wantsAdmin) score += 2;
    scored.push({ row, score, hits });
  }

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  return scored.slice(0, limit);
}

export function retrieveHelpUiRows(question, isAdmin, limit = 14) {
  return retrieveHelpUiScored(question, isAdmin, limit).map((s) => s.row);
}

/** True when lexical retrieval is too thin to ground an answer. */
export function isWeakHelpUiRetrieval(scored) {
  if (!scored.length) return true;
  const top = scored[0];
  return top.hits < 2 || top.score < 4;
}
