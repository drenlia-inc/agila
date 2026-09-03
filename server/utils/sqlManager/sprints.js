/**
 * Sprint Query Manager
 * 
 * Centralized PostgreSQL-native queries for sprint (planning_periods) operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 * 
 * @module sqlManager/sprints
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get all sprints ordered by start_date DESC
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Array>} Array of sprint objects
 */
export async function getAllSprints(db) {
  // Cast dates to text so JSON is always YYYY-MM-DD. Otherwise node-pg may return Date objects and
  // res.json() emits ISO datetimes — <input type="date"> ignores those and the admin form looks empty.
  const query = `
    SELECT 
      pp.id,
      pp.name,
      pp.start_date::text AS start_date,
      pp.end_date::text AS end_date,
      pp.is_active,
      pp.description,
      pp.goal,
      pp.created_at,
      pp.updated_at,
      (
        SELECT COUNT(*)::int
        FROM tasks t
        WHERE t.sprint_id = pp.id
          AND t.deleted_at IS NULL
      ) AS task_count
    FROM planning_periods pp
    ORDER BY pp.start_date DESC
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const rows = await stmt.all();
  return (rows || []).map((row) => ({
    ...row,
    is_active: row.is_active === true || row.is_active === 1 || row.is_active === 't',
    task_count: Number(row.task_count ?? row.taskCount) || 0
  }));
}

/**
 * Get active sprint
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<Object|null>} Active sprint or null
 */
export async function getActiveSprint(db) {
  const query = `
    SELECT
      id,
      name,
      start_date::text AS start_date,
      end_date::text AS end_date,
      is_active,
      description,
      goal,
      created_at
    FROM planning_periods
    WHERE is_active = true
    ORDER BY start_date DESC
    LIMIT 1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get();
}

/**
 * Get sprint by ID
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @returns {Promise<Object|null>} Sprint object or null
 */
export async function getSprintById(db, sprintId) {
  const query = `
    SELECT
      id,
      name,
      start_date::text AS start_date,
      end_date::text AS end_date,
      is_active,
      description,
      goal,
      planned_tasks,
      planned_effort,
      board_id,
      created_by,
      created_at,
      updated_at
    FROM planning_periods
    WHERE id = $1
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(sprintId);
}

/**
 * Get sprint usage count (tasks using this sprint)
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @returns {Promise<number>} Usage count
 */
export async function getSprintUsageCount(db, sprintId) {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE sprint_id = $1
      AND deleted_at IS NULL
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(sprintId);
  return Number(result?.count) || 0;
}

/**
 * Get tasks using a sprint (for reassignment)
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @returns {Promise<Array>} Array of task objects with id, ticket, title, boardId
 */
export async function getTasksUsingSprint(db, sprintId) {
  const query = `
    SELECT id, ticket, title, boardid as "boardId"
    FROM tasks 
    WHERE sprint_id = $1
    ORDER BY ticket
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(sprintId);
}

/**
 * Deactivate all sprints (set is_active = false for all)
 * 
 * @param {Database} db - Database connection
 * @returns {Promise<void>}
 */
export async function deactivateAllSprints(db) {
  const query = `
    UPDATE planning_periods 
    SET is_active = false 
    WHERE is_active = true
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  await stmt.run();
}

/**
 * Deactivate all sprints except one
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID to keep active
 * @returns {Promise<void>}
 */
export async function deactivateAllSprintsExcept(db, sprintId) {
  const query = `
    UPDATE planning_periods 
    SET is_active = false 
    WHERE is_active = true AND id != $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  await stmt.run(sprintId);
}

/**
 * Create a new sprint
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID (UUID)
 * @param {string} name - Sprint name
 * @param {string} startDate - Start date (ISO string)
 * @param {string} endDate - End date (ISO string)
 * @param {boolean} isActive - Whether sprint is active
 * @param {string|null} description - Sprint description
 * @returns {Promise<Object>} Created sprint object
 */
export async function createSprint(db, sprintId, name, startDate, endDate, isActive, description, goal) {
  const now = new Date().toISOString();
  const query = `
    INSERT INTO planning_periods (
      id, name, start_date, end_date, is_active, description, goal, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  await stmt.run(
    sprintId,
    name.trim(),
    startDate,
    endDate,
    Boolean(isActive),
    description?.trim() || null,
    goal?.trim() || null,
    now,
    now
  );
  
  // Return created sprint
  return await getSprintById(db, sprintId);
}

/**
 * Update sprint
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @param {string} name - Sprint name
 * @param {string} startDate - Start date (ISO string)
 * @param {string} endDate - End date (ISO string)
 * @param {boolean} isActive - Whether sprint is active
 * @param {string|null} description - Sprint description
 * @returns {Promise<Object>} Updated sprint object
 */
export async function updateSprint(db, sprintId, name, startDate, endDate, isActive, description, goal) {
  const query = `
    UPDATE planning_periods
    SET name = $1, start_date = $2, end_date = $3, is_active = $4, description = $5, goal = $6, updated_at = $7
    WHERE id = $8
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  await stmt.run(
    name.trim(),
    startDate,
    endDate,
    Boolean(isActive),
    description?.trim() || null,
    goal?.trim() || null,
    new Date().toISOString(),
    sprintId
  );
  
  // Return updated sprint
  return await getSprintById(db, sprintId);
}

/**
 * Delete sprint
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @returns {Promise<Object>} Result object with changes count
 */
export async function deleteSprint(db, sprintId) {
  const query = `
    DELETE FROM planning_periods 
    WHERE id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(sprintId);
}

/**
 * Remove sprint assignment from tasks (set sprint_id to NULL)
 * 
 * @param {Database} db - Database connection
 * @param {string} sprintId - Sprint ID
 * @returns {Promise<number>} Number of tasks updated
 */
export async function unassignTasksFromSprint(db, sprintId) {
  const query = `
    UPDATE tasks 
    SET sprint_id = NULL
    WHERE sprint_id = $1
  `;
  
  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  const result = await stmt.run(sprintId);
  return result.changes || 0;
}

const ACTIVE_WORK_FROM_SPRINT = `
  FROM tasks t
  INNER JOIN columns c ON c.id = t.columnid
  WHERE t.sprint_id = $1
    AND t.deleted_at IS NULL
    AND c.is_finished IS NOT TRUE
    AND c.is_archived IS NOT TRUE
`;

/**
 * Non-deleted task totals on a sprint, plus unfinished live work (same set as transfer).
 * @returns {Promise<{ active: number, total: number }>}
 */
export async function getSprintWorkCountsForTransfer(db, sprintId) {
  const query = `
    SELECT
      COUNT(*) FILTER (WHERE t.deleted_at IS NULL)::int AS total,
      COUNT(*) FILTER (
        WHERE t.deleted_at IS NULL
          AND c.id IS NOT NULL
          AND c.is_finished IS NOT TRUE
          AND c.is_archived IS NOT TRUE
      )::int AS active
    FROM tasks t
    LEFT JOIN columns c ON c.id = t.columnid
    WHERE t.sprint_id = $1
  `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  const result = await stmt.get(sprintId);
  return {
    active: Number(result?.active) || 0,
    total: Number(result?.total) || 0
  };
}

/**
 * Live unfinished (non-finished, non-archived) tasks on a sprint, all boards.
 */
export async function getActiveWorkCountForSprint(db, sprintId) {
  const { active } = await getSprintWorkCountsForTransfer(db, sprintId);
  return active;
}

/**
 * Reassign unfinished live tasks from one sprint to another. Does not change dates.
 * @returns {Promise<Array<{id: string, boardId: string}>>}
 */
export async function transferActiveWorkToSprint(db, fromSprintId, toSprintId) {
  const selectStmt = wrapQuery(
    db.prepare(`SELECT t.id, t.boardid AS "boardId" ${ACTIVE_WORK_FROM_SPRINT}`),
    'SELECT'
  );
  const tasks = await selectStmt.all(fromSprintId);
  if (!tasks?.length) return [];

  const updateStmt = wrapQuery(
    db.prepare(`
      UPDATE tasks t
      SET sprint_id = $2, updated_at = $3
      FROM columns c
      WHERE t.columnid = c.id
        AND t.sprint_id = $1
        AND t.deleted_at IS NULL
        AND c.is_finished IS NOT TRUE
        AND c.is_archived IS NOT TRUE
    `),
    'UPDATE'
  );
  await updateStmt.run(fromSprintId, toSprintId, new Date().toISOString());
  return tasks;
}

