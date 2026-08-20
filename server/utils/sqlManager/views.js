/**
 * Views Query Manager
 *
 * Centralized PostgreSQL-native queries for saved filter view operations.
 * All queries use PostgreSQL syntax ($1, $2, $3 placeholders, etc.)
 *
 * Column names use lowercase (userId, filtername, …) to match PostgreSQL
 * tables created from SQLite DDL (unquoted camelCase → lowercase). Quoted
 * "userId" would look for a case-sensitive column that does not exist.
 *
 * @module sqlManager/views
 */

import { wrapQuery } from '../queryLogger.js';

/**
 * Get all views for a user
 *
 * @param {Database} db - Database connection
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of view objects
 */
export async function getAllViewsForUser(db, userId) {
  const query = `
    SELECT * FROM views 
    WHERE userid = $1 
    ORDER BY filtername ASC
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(userId);
}

/**
 * Get shared views from other users
 *
 * @param {Database} db - Database connection
 * @param {string} userId - User ID (to exclude)
 * @returns {Promise<Array>} Array of view objects with creatorName
 */
export async function getSharedViews(db, userId) {
  const query = `
    SELECT v.*, 
           CASE 
             WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
             THEN u.first_name || ' ' || u.last_name
             WHEN u.first_name IS NOT NULL 
             THEN u.first_name
             ELSE u.email
           END AS "creatorName"
    FROM views v
    LEFT JOIN users u ON v.userid = u.id
    WHERE v.shared = true AND v.userid != $1
    ORDER BY v.filtername ASC
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.all(userId);
}

/**
 * Get view by ID and user ID
 *
 * @param {Database} db - Database connection
 * @param {number} viewId - View ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} View object or null
 */
export async function getViewById(db, viewId, userId) {
  const query = `
    SELECT * FROM views 
    WHERE id = $1 AND userid = $2
  `;

  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(viewId, userId);
}

/**
 * Check if a view name already exists for a user
 *
 * @param {Database} db - Database connection
 * @param {string} filterName - Filter name
 * @param {string} userId - User ID
 * @param {number|null} excludeViewId - View ID to exclude (for updates)
 * @returns {Promise<Object|null>} View object with id or null
 */
export async function checkViewNameExists(db, filterName, userId, excludeViewId = null) {
  if (excludeViewId) {
    const query = `
      SELECT id FROM views 
      WHERE filtername = $1 AND userid = $2 AND id != $3
    `;
    const stmt = wrapQuery(db.prepare(query), 'SELECT');
    return await stmt.get(filterName, userId, excludeViewId);
  }
  const query = `
      SELECT id FROM views 
      WHERE filtername = $1 AND userid = $2
    `;
  const stmt = wrapQuery(db.prepare(query), 'SELECT');
  return await stmt.get(filterName, userId);
}

/** Map JS / API camelCase filter keys to PostgreSQL column names on views */
const FILTER_FIELD_PG = {
  textFilter: 'textfilter',
  dateFromFilter: 'datefromfilter',
  dateToFilter: 'datetofilter',
  dueDateFromFilter: 'duedatefromfilter',
  dueDateToFilter: 'duedatetofilter',
  memberFilters: 'memberfilters',
  priorityFilters: 'priorityfilters',
  tagFilters: 'tagfilters',
  projectFilter: 'projectfilter',
  projectFilters: 'projectfilters',
  taskFilter: 'taskfilter',
  boardColumnFilter: 'boardcolumnfilter',
  linkedTasksOnlyFilter: 'linkedtasksonlyfilter',
  overdueOnlyFilter: 'overdueonlyfilter',
  blockedOnlyFilter: 'blockedonlyfilter',
  sprintFilters: 'sprintfilters',
  stalledDaysFilter: 'stalleddaysfilter',
};

/**
 * Create a new view
 *
 * @param {Database} db - Database connection
 * @param {string} filterName - Filter name
 * @param {string} userId - User ID
 * @param {boolean} shared - Whether the view is shared
 * @param {Object} filters - Filter data object
 * @returns {Promise<Object>} Result object with lastInsertRowid (SQLite) or returning (PostgreSQL)
 */
export async function createView(db, filterName, userId, shared, filters) {
  const query = `
    INSERT INTO views (
      filtername, userid, shared, textfilter, datefromfilter, datetofilter,
      duedatefromfilter, duedatetofilter, memberfilters, priorityfilters,
      tagfilters, projectfilter, projectfilters, taskfilter, boardcolumnfilter,
      linkedtasksonlyfilter, overdueonlyfilter, blockedonlyfilter,
      sprintfilters, stalleddaysfilter
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *
  `;

  const stmt = wrapQuery(db.prepare(query), 'INSERT');
  return await stmt.run(
    filterName,
    userId,
    Boolean(shared),
    filters.textFilter || null,
    filters.dateFromFilter || null,
    filters.dateToFilter || null,
    filters.dueDateFromFilter || null,
    filters.dueDateToFilter || null,
    filters.memberFilters || null,
    filters.priorityFilters || null,
    filters.tagFilters || null,
    filters.projectFilter || null,
    filters.projectFilters || null,
    filters.taskFilter || null,
    filters.boardColumnFilter || null,
    filters.linkedTasksOnlyFilter ? true : false,
    filters.overdueOnlyFilter ? true : false,
    filters.blockedOnlyFilter ? true : false,
    filters.sprintFilters || null,
    filters.stalledDaysFilter != null ? filters.stalledDaysFilter : null
  );
}

/**
 * Update a view
 *
 * @param {Database} db - Database connection
 * @param {number} viewId - View ID
 * @param {string} userId - User ID
 * @param {Object} updates - Object with fields to update
 * @returns {Promise<Object>} Result object
 */
export async function updateView(db, viewId, userId, updates) {
  const setClause = [];
  const params = [];
  let paramIndex = 1;

  if (updates.filterName !== undefined) {
    setClause.push(`filtername = $${paramIndex++}`);
    params.push(updates.filterName);
  }

  if (updates.shared !== undefined) {
    setClause.push(`shared = $${paramIndex++}`);
    params.push(updates.shared ? true : false);
  }

  Object.entries(FILTER_FIELD_PG).forEach(([camel, pgCol]) => {
    if (updates[camel] !== undefined) {
      setClause.push(`${pgCol} = $${paramIndex++}`);
      params.push(updates[camel]);
    }
  });

  setClause.push('updated_at = CURRENT_TIMESTAMP');

  params.push(viewId, userId);

  const query = `
    UPDATE views 
    SET ${setClause.join(', ')}
    WHERE id = $${paramIndex} AND userid = $${paramIndex + 1}
  `;

  const stmt = wrapQuery(db.prepare(query), 'UPDATE');
  return await stmt.run(...params);
}

/**
 * Delete a view
 *
 * @param {Database} db - Database connection
 * @param {number} viewId - View ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object with changes count
 */
export async function deleteView(db, viewId, userId) {
  const query = `
    DELETE FROM views 
    WHERE id = $1 AND userid = $2
  `;

  const stmt = wrapQuery(db.prepare(query), 'DELETE');
  return await stmt.run(viewId, userId);
}
