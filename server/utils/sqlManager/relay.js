/**
 * Agila API Relay lookups: external keys and atomic claim / move.
 */

import { wrapQuery } from '../queryLogger.js';

export async function getBoardByExternalKey(db, externalKey) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, title, project, external_key AS "externalKey", deleted_at AS "deletedAt"
      FROM boards
      WHERE external_key = $1
    `),
    'SELECT'
  );
  return stmt.get(externalKey);
}

export async function setBoardExternalKey(db, boardId, externalKey) {
  const stmt = wrapQuery(
    db.prepare(`UPDATE boards SET external_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`),
    'UPDATE'
  );
  await stmt.run(externalKey, boardId);
}

export async function clearBoardExternalKey(db, boardId) {
  const stmt = wrapQuery(
    db.prepare(`UPDATE boards SET external_key = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`),
    'UPDATE'
  );
  await stmt.run(boardId);
}

export async function getSprintByExternalKey(db, externalKey) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, name, external_key AS "externalKey"
      FROM planning_periods
      WHERE external_key = $1
    `),
    'SELECT'
  );
  return stmt.get(externalKey);
}

export async function setSprintExternalKey(db, sprintId, externalKey) {
  const stmt = wrapQuery(
    db.prepare(`UPDATE planning_periods SET external_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`),
    'UPDATE'
  );
  await stmt.run(externalKey, sprintId);
}

export async function getTaskByExternalKey(db, externalKey) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, title, boardid AS "boardId", columnid AS "columnId",
             memberid AS "memberId", sprint_id AS "sprintId",
             claim_token_hash AS "claimTokenHash", deleted_at AS "deletedAt"
      FROM tasks
      WHERE external_key = $1
    `),
    'SELECT'
  );
  return stmt.get(externalKey);
}

export async function setTaskExternalKey(db, taskId, externalKey) {
  const stmt = wrapQuery(
    db.prepare(`UPDATE tasks SET external_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`),
    'UPDATE'
  );
  await stmt.run(externalKey, taskId);
}

export async function clearTaskExternalKey(db, taskId) {
  const stmt = wrapQuery(
    db.prepare(`UPDATE tasks SET external_key = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`),
    'UPDATE'
  );
  await stmt.run(taskId);
}

export async function getTaskClaimRow(db, taskId) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT id, title, boardid AS "boardId", columnid AS "columnId",
             memberid AS "memberId", claim_token_hash AS "claimTokenHash",
             deleted_at AS "deletedAt"
      FROM tasks
      WHERE id = $1
    `),
    'SELECT'
  );
  return stmt.get(taskId);
}

/**
 * Assign the oldest unassigned card in a column to memberId and move it.
 * Returns the updated row, or null when the lane is empty.
 */
export async function claimNextTask(db, { boardId, fromColumnId, toColumnId, memberId, sprintId, claimHash }) {
  const stmt = wrapQuery(
    db.prepare(`
      WITH picked AS (
        SELECT id
        FROM tasks
        WHERE boardid = $1
          AND columnid = $2
          AND deleted_at IS NULL
          AND (memberid IS NULL OR memberid = '')
          AND ($3::text IS NULL OR sprint_id = $3)
        ORDER BY position ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE tasks t
      SET memberid = $4,
          columnid = $5,
          claim_token_hash = $6,
          column_entered_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      FROM picked
      WHERE t.id = picked.id
      RETURNING t.id, t.title, t.boardid AS "boardId", t.columnid AS "columnId",
                t.memberid AS "memberId", t.ticket, t.sprint_id AS "sprintId"
    `),
    'UPDATE'
  );
  return stmt.get(boardId, fromColumnId, sprintId || null, memberId, toColumnId, claimHash);
}

/**
 * Move a claimed card only while assignee, column, and claim hash still match.
 */
export async function moveClaimedTask(db, { taskId, memberId, fromColumnId, toColumnId, expectedHash, nextHash }) {
  const stmt = wrapQuery(
    db.prepare(`
      UPDATE tasks
      SET columnid = $4,
          claim_token_hash = $5,
          column_entered_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND deleted_at IS NULL
        AND memberid = $2
        AND columnid = $3
        AND claim_token_hash = $6
      RETURNING id, title, boardid AS "boardId", columnid AS "columnId",
                memberid AS "memberId", ticket, sprint_id AS "sprintId"
    `),
    'UPDATE'
  );
  return stmt.get(taskId, memberId, fromColumnId, toColumnId, nextHash, expectedHash);
}

/**
 * Cards a bot still holds: claim set, and the column is not finished or archived.
 * Admins see every board. Other users see boards they participate on.
 */
export async function listActiveBotWork(db, { userId, isAdmin }) {
  const stmt = wrapQuery(
    db.prepare(`
      SELECT
        t.id AS "taskId",
        t.ticket,
        t.title AS "taskTitle",
        t.boardid AS "boardId",
        b.title AS "boardTitle",
        COALESCE(
          NULLIF(m.name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
          u.email
        ) AS "workerName"
      FROM tasks t
      JOIN boards b ON b.id = t.boardid AND b.deleted_at IS NULL
      JOIN columns c ON c.id = t.columnid
      LEFT JOIN members m ON m.id = t.memberid
      LEFT JOIN users u ON u.id = m.user_id
      WHERE t.deleted_at IS NULL
        AND t.claim_token_hash IS NOT NULL
        AND c.is_finished IS NOT TRUE
        AND c.is_archived IS NOT TRUE
        AND (
          $1::boolean = true
          OR EXISTS (
            SELECT 1 FROM board_participants bp
            WHERE bp.board_id = t.boardid AND bp.user_id = $2
          )
        )
      ORDER BY t.updated_at DESC
      LIMIT 50
    `),
    'SELECT'
  );
  return stmt.all(Boolean(isAdmin), userId);
}
