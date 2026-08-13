/**
 * Seed welcome tasks for new non-demo tenants (empty board onboarding).
 */
import crypto from 'crypto';
import { wrapQuery } from '../utils/queryLogger.js';
import { tasks as taskQueries } from '../utils/sqlManager/index.js';

export const WELCOME_TASK_TITLE_EN = 'Welcome to Agila!';
export const WELCOME_TASK_TITLE_FR = 'Bienvenue sur Agila !';

/**
 * Keep these short — cards are a glance surface.
 * TipTap/HTML; light emphasis only (Configuration guide / Help).
 */
export const WELCOME_TASK_DESCRIPTION_EN =
  '<p>Use the <strong>Configuration guide</strong> to personalize your instance. Reopen it from <strong>Help</strong>.</p>';

export const WELCOME_TASK_DESCRIPTION_FR =
  '<p>Utilisez le <strong>Guide de configuration</strong> pour personnaliser votre instance. Rouvrez-le depuis <strong>Aide</strong>.</p>';

const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001';

function pickColumnId(columns, { titleMatch, fallbackIndex }) {
  if (!Array.isArray(columns) || columns.length === 0) return null;
  const byTitle = columns.find((c) => {
    const t = String(c.title || '').toLowerCase();
    return titleMatch.some((m) => t === m || t.includes(m));
  });
  if (byTitle?.id) return byTitle.id;
  return columns[fallbackIndex]?.id || columns[0]?.id || null;
}

/**
 * @param {object} db
 * @param {string} boardId
 * @param {Array<{ id: string, title?: string }>} columns - default columns
 * @param {{ assigneeMemberId?: string|null }} [options]
 * @returns {Promise<{ created: number, skipped: number }>}
 */
export async function seedWelcomeTasks(db, boardId, columns, options = {}) {
  const todoColumnId = pickColumnId(columns, {
    titleMatch: ['to do', 'todo', 'à faire', 'a faire'],
    fallbackIndex: 0
  });
  const inProgressColumnId = pickColumnId(columns, {
    titleMatch: ['in progress', 'progress', 'en cours'],
    fallbackIndex: 1
  });

  if (!boardId || !todoColumnId) {
    console.warn('⚠️ seedWelcomeTasks: missing board or To Do column — skipped');
    return { created: 0, skipped: 0 };
  }

  const assigneeMemberId = options.assigneeMemberId || SYSTEM_MEMBER_ID;
  const today = new Date().toISOString().split('T')[0];
  const defs = [
    {
      title: WELCOME_TASK_TITLE_EN,
      description: WELCOME_TASK_DESCRIPTION_EN,
      ticket: 'TASK-00001',
      columnId: todoColumnId,
      position: 0
    },
    {
      title: WELCOME_TASK_TITLE_FR,
      description: WELCOME_TASK_DESCRIPTION_FR,
      ticket: 'TASK-00002',
      // Prefer In Progress so both cards aren't stacked in the first viewport column
      columnId: inProgressColumnId || todoColumnId,
      position: 0
    }
  ];

  let created = 0;
  let skipped = 0;

  for (const def of defs) {
    const existing = await wrapQuery(
      db.prepare('SELECT id FROM tasks WHERE boardid = ? AND title = ? LIMIT 1'),
      'SELECT'
    ).get(boardId, def.title);

    if (existing) {
      skipped += 1;
      continue;
    }

    await taskQueries.createTask(db, {
      id: crypto.randomUUID(),
      title: def.title,
      description: def.description,
      ticket: def.ticket,
      memberId: assigneeMemberId,
      requesterId: assigneeMemberId,
      startDate: today,
      effort: 1,
      priority: 'medium',
      columnId: def.columnId,
      boardId,
      position: def.position
    });
    created += 1;
  }

  if (created > 0) {
    console.log(`✅ Seeded ${created} welcome task(s) on board ${boardId}`);
  }

  return { created, skipped };
}

/**
 * Reassign existing welcome tasks on the default board to a member (e.g. new owner).
 * @param {object} db
 * @param {string} memberId
 * @returns {Promise<number>} rows updated
 */
export async function reassignWelcomeTasksToMember(db, memberId) {
  if (!memberId) return 0;

  const result = await wrapQuery(
    db.prepare(`
      UPDATE tasks
      SET memberid = ?, requesterid = ?, updated_at = CURRENT_TIMESTAMP
      WHERE title IN (?, ?)
    `),
    'UPDATE'
  ).run(memberId, memberId, WELCOME_TASK_TITLE_EN, WELCOME_TASK_TITLE_FR);

  return result?.changes || 0;
}
