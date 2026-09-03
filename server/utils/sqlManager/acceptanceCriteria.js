import { randomUUID } from 'crypto';
import { wrapQuery } from '../queryLogger.js';

export async function listForTask(db, taskId) {
  const query = `
    SELECT id, task_id AS "taskId", text, is_done AS "isDone", position, created_at AS "createdAt"
    FROM acceptance_criteria
    WHERE task_id = $1
    ORDER BY position ASC, created_at ASC
  `;
  const rows = await wrapQuery(db.prepare(query), 'SELECT').all(taskId);
  return (rows || []).map((row) => ({
    ...row,
    isDone: row.isDone === true || row.isDone === 1 || row.isDone === 't',
    position: Number(row.position) || 0,
  }));
}

export async function getById(db, id) {
  const query = `
    SELECT id, task_id AS "taskId", text, is_done AS "isDone", position
    FROM acceptance_criteria
    WHERE id = $1
  `;
  return wrapQuery(db.prepare(query), 'SELECT').get(id);
}

export async function getNextPosition(db, taskId) {
  const row = await wrapQuery(
    db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM acceptance_criteria WHERE task_id = $1'),
    'SELECT'
  ).get(taskId);
  return Number(row?.next || 1);
}

export async function createItem(db, taskId, text) {
  const id = randomUUID();
  const position = await getNextPosition(db, taskId);
  const now = new Date().toISOString();
  await wrapQuery(
    db.prepare(`
      INSERT INTO acceptance_criteria (id, task_id, text, is_done, position, created_at, updated_at)
      VALUES ($1, $2, $3, false, $4, $5, $5)
    `),
    'INSERT'
  ).run(id, taskId, text.trim(), position, now);
  return getById(db, id);
}

export async function updateItem(db, id, updates) {
  const current = await getById(db, id);
  if (!current) return null;
  const text = updates.text != null ? String(updates.text).trim() : current.text;
  const isDone =
    updates.isDone !== undefined
      ? Boolean(updates.isDone)
      : current.isDone === true || current.isDone === 1 || current.isDone === 't';
  const position =
    updates.position != null ? Number(updates.position) : Number(current.position);
  await wrapQuery(
    db.prepare(`
      UPDATE acceptance_criteria
      SET text = $1, is_done = $2, position = $3, updated_at = $4
      WHERE id = $5
    `),
    'UPDATE'
  ).run(text, isDone, position, new Date().toISOString(), id);
  return getById(db, id);
}

export async function deleteItem(db, id) {
  return wrapQuery(db.prepare('DELETE FROM acceptance_criteria WHERE id = $1'), 'DELETE').run(id);
}

export async function reorderItems(db, taskId, orderedIds) {
  let position = 1;
  for (const id of orderedIds) {
    await wrapQuery(
      db.prepare(
        'UPDATE acceptance_criteria SET position = $1, updated_at = $2 WHERE id = $3 AND task_id = $4'
      ),
      'UPDATE'
    ).run(position, new Date().toISOString(), id, taskId);
    position += 1;
  }
  return listForTask(db, taskId);
}
