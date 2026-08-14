import { wrapQuery } from '../queryLogger.js';

/**
 * Get all boards ordered by position
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Array>} Array of board objects
 */
export async function getAllBoards(db) {
  const query = `
    SELECT * FROM boards 
    WHERE deleted_at IS NULL
    ORDER BY position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all();
}

/**
 * Get board by ID
 * 
 * @param {Database} db - Database connection
 * @param {string} boardId - Board ID
 * @returns {Promise<Object|null>} Board object or null
 */
export async function getBoardById(db, boardId) {
  const query = `
    SELECT 
      id,
      title,
      project,
      position,
      wip_limit,
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt",
      deleted_by as "deletedBy"
    FROM boards 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(boardId);
}

/**
 * Check if board with title exists (case-insensitive)
 * 
 * @param {Database} db - Database connection
 * @param {string} title - Board title
 * @param {string} excludeBoardId - Optional board ID to exclude from check
 * @returns {Promise<Object|null>} Existing board or null
 */
export async function getBoardByTitle(db, title, excludeBoardId = null) {
  // Trashed boards must not reserve their title, otherwise deleted names can never be reused
  if (excludeBoardId) {
    const query = `
      SELECT id FROM boards
      WHERE LOWER(title) = LOWER($1) AND id != $2 AND deleted_at IS NULL
    `;
    const stmt = wrapQuery(db.prepare(query), 'SELECT');
    return await stmt.get(title, excludeBoardId);
  } else {
    const query = `
      SELECT id FROM boards
      WHERE LOWER(title) = LOWER($1) AND deleted_at IS NULL
    `;
    const stmt = wrapQuery(db.prepare(query), 'SELECT');
    return await stmt.get(title);
  }
}

/**
 * First title not used by a live board: `title`, then `title (2)`, `title (3)`, …
 *
 * @param {Database} db - Database connection
 * @param {string} title - Desired title
 * @returns {Promise<string>} Available title
 */
export async function findAvailableBoardTitle(db, title) {
  let candidate = title;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const existing = await getBoardByTitle(db, candidate);
    if (!existing) return candidate;
    candidate = `${title} (${suffix})`;
  }
  return candidate;
}

/**
 * Get maximum position from boards
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<number>} Maximum position or -1
 */
export async function getMaxBoardPosition(db) {
  // position is NUMERIC, which node-pg returns as a string: coerce so callers can do maxPos + 1
  const query = `
    SELECT MAX(position) as "maxPos" FROM boards
    WHERE deleted_at IS NULL
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get();
  const maxPos = Number(result?.maxPos ?? result?.maxpos);
  return Number.isFinite(maxPos) ? maxPos : -1;
}

/**
 * Create a new board
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Board ID
 * @param {string} title - Board title
 * @param {string} project - Project identifier
 * @param {number} position - Board position
 * @returns {Promise<Object>} Created board object
 */
export async function createBoard(db, id, title, project, position) {
  const query = `
    INSERT INTO boards (id, title, project, position) 
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(id, title, project, position);
}

/**
 * Update board title and optional soft WIP limit
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Board ID
 * @param {string} title - New board title
 * @param {number|null|undefined} wipLimit - null clears; undefined leaves unchanged
 * @returns {Promise<Object>} Updated board object
 */
export async function updateBoard(db, id, title, wipLimit = undefined) {
  if (wipLimit === undefined) {
    const query = `
      UPDATE boards 
      SET title = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const stmt = wrapQuery(db.prepare(query), 'UPDATE');
    return await stmt.run(title, id);
  }

  const query = `
    UPDATE boards 
    SET title = $1, wip_limit = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(title, wipLimit, id);
}

/**
 * Delete board
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Board ID
 * @returns {Promise<void>}
 */
export async function deleteBoard(db, id) {
  const query = `
    DELETE FROM boards 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(id);
}

/**
 * Get all boards with their positions
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Array>} Array of boards with id and position
 */
export async function getAllBoardsWithPositions(db) {
  const query = `
    SELECT id, position FROM boards 
    WHERE deleted_at IS NULL
    ORDER BY position ASC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all();
}

/**
 * Update board position
 * 
 * @param {Database} db - Database connection
 * @param {string} id - Board ID
 * @param {number} position - New position
 * @returns {Promise<void>}
 */
export async function updateBoardPosition(db, id, position) {
  const query = `
    UPDATE boards 
    SET position = $1 
    WHERE id = $2
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(position, id);
}

/**
 * Get project identifier prefix from settings
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<string>} Project prefix (default: 'PROJ-')
 */
export async function getProjectPrefix(db) {
  const query = `
    SELECT value FROM settings 
    WHERE key = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get('DEFAULT_PROJ_PREFIX');
  return result?.value || 'PROJ-';
}

/**
 * Generate next project identifier
 * 
 * @param {Database} db - Database connection
 * @param {string} prefix - Project prefix (e.g., 'PROJ-')
 * @returns {Promise<string>} Next project identifier (e.g., 'PROJ-00001')
 */
export async function generateProjectIdentifier(db, prefix = 'PROJ-') {
  // PostgreSQL: Use SUBSTRING and CAST for numeric extraction
  const query = `
    SELECT project FROM boards 
    WHERE project IS NOT NULL AND project LIKE $1
    ORDER BY CAST(SUBSTRING(project FROM '\\d+$') AS INTEGER) DESC 
    LIMIT 1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(`${prefix}%`);
  
  let nextNumber = 1;
  if (result && result.project) {
    const currentNumber = parseInt(result.project.substring(prefix.length));
    if (!isNaN(currentNumber)) {
      nextNumber = currentNumber + 1;
    }
  }
  
  return `${prefix}${nextNumber.toString().padStart(5, '0')}`;
}

/**
 * Get all task relationships for a board
 * 
 * @param {Database} db - Database connection
 * @param {string} boardId - Board ID
 * @returns {Promise<Array>} Array of task relationships
 */
export async function getBoardTaskRelationships(db, boardId) {
  // PostgreSQL converts unquoted identifiers to lowercase
  // The tasks table has boardid (lowercase); alias to "boardId" for API consumers
  const query = `
    SELECT 
      tr.id,
      tr.task_id as "taskId",
      tr.relationship,
      tr.to_task_id as "toTaskId",
      tr.created_at as "createdAt"
    FROM task_rels tr
    JOIN tasks t1 ON tr.task_id = t1.id AND t1.deleted_at IS NULL
    JOIN tasks t2 ON tr.to_task_id = t2.id AND t2.deleted_at IS NULL
    WHERE t1.boardid = $1 AND t2.boardid = $1
    ORDER BY tr.created_at DESC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(boardId);
}

/**
 * Soft-delete a board
 */
export async function softDeleteBoard(db, boardId, deletedBy) {
  const query = `
    UPDATE boards
    SET deleted_at = CURRENT_TIMESTAMP,
        deleted_by = $2,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.get(boardId, deletedBy || null);
}

/**
 * Restore a soft-deleted board (tasks stay soft-deleted)
 */
export async function restoreBoard(db, boardId, { title = null, position = null } = {}) {
  const query = `
    UPDATE boards
    SET deleted_at = NULL,
        deleted_by = NULL,
        title = COALESCE($2::text, title),
        position = COALESCE($3::numeric, position),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NOT NULL
    RETURNING *
  `;
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.get(boardId, title, position);
}

/**
 * Count live (non-soft-deleted) boards
 */
export async function countLiveBoards(db) {
  const query = `
    SELECT COUNT(*)::int AS count FROM boards WHERE deleted_at IS NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get();
  return row?.count || 0;
}

/**
 * Count soft-deleted boards (Admin Lifecycle badge / summary)
 */
export async function countDeletedBoards(db) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM boards
    WHERE deleted_at IS NOT NULL
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get();
  return row?.count || 0;
}

/**
 * Soft-deleted boards for Admin Lifecycle
 */
export async function getDeletedBoards(db) {
  const query = `
    SELECT id, title, project, position,
           created_at as "createdAt",
           updated_at as "updatedAt",
           deleted_at as "deletedAt",
           deleted_by as "deletedBy",
           (SELECT COUNT(*)::int FROM tasks t WHERE t.boardid = boards.id) as "taskCount",
           (SELECT COUNT(*)::int FROM tasks t WHERE t.boardid = boards.id AND t.deleted_at IS NOT NULL) as "trashTaskCount"
    FROM boards
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all();
}

/**
 * Soft-deleted boards past retention
 */
export async function getExpiredSoftDeletedBoards(db, retentionDays) {
  const query = `
    SELECT id
    FROM boards
    WHERE deleted_at IS NOT NULL
      AND deleted_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(String(retentionDays));
}

/**
 * All tasks on a board (live + trash). Empty boards can be hard-deleted.
 */
export async function countAllTasksForBoard(db, boardId) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE boardid = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const row = await stmt.get(boardId);
  return Number(row?.count) || 0;
}

/**
 * Task IDs on a board (including soft-deleted) for permanent board purge
 */
export async function getAllTaskIdsForBoard(db, boardId) {
  const query = `SELECT id FROM tasks WHERE boardid = $1`;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(boardId);
}

