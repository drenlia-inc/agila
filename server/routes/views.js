import express from 'express';
import { authenticateToken, userCanMutate } from '../middleware/auth.js';
import notificationService from '../services/notificationService.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
// MIGRATED: Import sqlManager
import { views as viewQueries } from '../utils/sqlManager/index.js';
import { parseBody, createViewBodySchema, updateViewBodySchema } from '../utils/requestValidation.js';

const router = express.Router();

/** Viewers may manage personal filters only — never share. */
function rejectViewerSharedView(req, res, shared) {
  if (userCanMutate(req.user)) return false;
  if (shared === true || shared === 1 || shared === '1' || shared === 'true') {
    res.status(403).json({
      error: 'Viewers can only save personal filter views',
      code: 'READ_ONLY'
    });
    return true;
  }
  return false;
}

// Helper function to validate filter data
const validateFilterData = (filters) => {
  const allowedFields = [
    'textFilter', 'dateFromFilter', 'dateToFilter', 'dueDateFromFilter', 
    'dueDateToFilter', 'memberFilters', 'priorityFilters', 'tagFilters',
    'projectFilter', 'projectFilters', 'taskFilter', 'boardColumnFilter',
    'linkedTasksOnlyFilter', 'overdueOnlyFilter', 'blockedOnlyFilter',
    'sprintFilters', 'stalledDaysFilter'
  ];
  
  const validatedFilters = {};
  
  for (const [key, value] of Object.entries(filters)) {
    if (allowedFields.includes(key)) {
      if (Array.isArray(value)) {
        validatedFilters[key] = JSON.stringify(value);
      } else if (typeof value === 'boolean') {
        validatedFilters[key] = value;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        validatedFilters[key] = value;
      } else if (typeof value === 'string' || value === null || value === undefined) {
        validatedFilters[key] = value || null;
      }
    }
  }
  
  return validatedFilters;
};

// Helper function to convert database row to API response format
const formatViewForResponse = (view) => {
  if (!view) return null;
  
  const formatted = { ...view };
  
  // Normalize field names (handle both camelCase and lowercase from database)
  // PostgreSQL returns camelCase when quoted, SQLite might return lowercase
  const fieldMappings = {
    filtername: 'filterName',
    userId: 'userId',
    textfilter: 'textFilter',
    datefromfilter: 'dateFromFilter',
    datetofilter: 'dateToFilter',
    duedatefromfilter: 'dueDateFromFilter',
    duedatetofilter: 'dueDateToFilter',
    memberfilters: 'memberFilters',
    priorityfilters: 'priorityFilters',
    tagfilters: 'tagFilters',
    projectfilter: 'projectFilter',
    projectfilters: 'projectFilters',
    taskfilter: 'taskFilter',
    boardcolumnfilter: 'boardColumnFilter',
    linkedtasksonlyfilter: 'linkedTasksOnlyFilter',
    overdueonlyfilter: 'overdueOnlyFilter',
    blockedonlyfilter: 'blockedOnlyFilter',
    sprintfilters: 'sprintFilters',
    stalleddaysfilter: 'stalledDaysFilter'
  };
  
  // Map lowercase fields to camelCase
  Object.entries(fieldMappings).forEach(([lower, camel]) => {
    if (formatted[lower] !== undefined && formatted[camel] === undefined) {
      formatted[camel] = formatted[lower];
      delete formatted[lower];
    }
  });
  
  // Convert boolean fields from SQLite (0/1) or PostgreSQL (true/false) to JavaScript booleans
  formatted.shared = Boolean(formatted.shared);
  const parseViewBoolean = (value) =>
    value === true || value === 1 || value === '1' || value === 'true';
  formatted.linkedTasksOnlyFilter = parseViewBoolean(formatted.linkedTasksOnlyFilter);
  formatted.overdueOnlyFilter = parseViewBoolean(formatted.overdueOnlyFilter);
  formatted.blockedOnlyFilter = parseViewBoolean(formatted.blockedOnlyFilter);
  
  // Parse JSON fields back to arrays
  const jsonFields = ['memberFilters', 'priorityFilters', 'tagFilters', 'sprintFilters', 'projectFilters'];
  jsonFields.forEach(field => {
    if (formatted[field]) {
      try {
        formatted[field] = typeof formatted[field] === 'string'
          ? JSON.parse(formatted[field])
          : formatted[field];
      } catch (e) {
        formatted[field] = [];
      }
    } else {
      formatted[field] = [];
    }
  });
  
  return formatted;
};

// GET /api/views - Get all saved filter views for the current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    const userId = req.user.id;
    
    // MIGRATED: Get all views for user using sqlManager
    const views = await viewQueries.getAllViewsForUser(db, userId);
    const formattedViews = views.map(formatViewForResponse);
    
    res.json(formattedViews);
  } catch (error) {
    console.error('Error fetching views:', error);
    res.status(500).json({ error: 'Failed to fetch saved filter views' });
  }
});

// GET /api/views/shared - Get shared filter views from other users
router.get('/shared', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    const userId = req.user.id;
    
    // MIGRATED: Get shared views using sqlManager
    const views = await viewQueries.getSharedViews(db, userId);
    
    const formattedViews = views.map(view => {
      const formatted = formatViewForResponse(view);
      // creatorName from query (quoted alias); PG may expose lowercase key
      if (view.creatorName) {
        formatted.creatorName = view.creatorName;
      } else if (view.creatorname) {
        formatted.creatorName = view.creatorname;
      }
      return formatted;
    });
    
    res.json(formattedViews);
  } catch (error) {
    console.error('❌ [GET /api/views/shared] Error fetching shared views:', error);
    res.status(500).json({ error: 'Failed to fetch shared filter views' });
  }
});

// GET /api/views/:id - Get a specific saved filter view
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    const userId = req.user.id;
    const viewId = req.params.id;
    
    // MIGRATED: Get view by ID using sqlManager
    const view = await viewQueries.getViewById(db, viewId, userId);
    
    if (!view) {
      return res.status(404).json({ error: 'Filter view not found' });
    }
    
    const formattedView = formatViewForResponse(view);
    res.json(formattedView);
  } catch (error) {
    console.error('Error fetching view:', error);
    res.status(500).json({ error: 'Failed to fetch filter view' });
  }
});

// POST /api/views - Create a new saved filter view
router.post('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    const userId = req.user.id;
    const parsed = parseBody(createViewBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { filterName, filters, shared = false } = parsed.data;
    if (rejectViewerSharedView(req, res, shared)) return;
    
    // MIGRATED: Check if view name exists using sqlManager
    const existingView = await viewQueries.checkViewNameExists(db, filterName.trim(), userId);
    
    if (existingView) {
      return res.status(409).json({ error: 'A filter with this name already exists' });
    }
    
    const validatedFilters = validateFilterData(filters);
    
    // MIGRATED: Create view using sqlManager
    const result = await viewQueries.createView(
      db,
      filterName.trim(),
      userId,
      shared,
      validatedFilters
    );
    
    // Get the created view - PostgreSQL returns it in result, SQLite needs separate query
    let createdView;
    if (result.lastInsertRowid) {
      // SQLite: use lastInsertRowid
      createdView = await viewQueries.getViewById(db, result.lastInsertRowid, userId);
    } else if (result.id) {
      // PostgreSQL: view is in result
      createdView = result;
    } else {
      // Fallback: query by filter name
      const allViews = await viewQueries.getAllViewsForUser(db, userId);
      createdView = allViews.find(v => v.filterName === filterName.trim() || v.filtername === filterName.trim());
    }
    
    const formattedView = formatViewForResponse(createdView);
    
    // Publish to Redis for real-time updates if the filter is shared
    if (shared) {
      console.log('📤 Publishing filter-created for shared filter:', formattedView.filterName);
      await notificationService.publish('filter-created', {
        filter: formattedView,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
      console.log('✅ Filter-created published');
    }
    
    res.status(201).json(formattedView);
  } catch (error) {
    console.error('Error creating view:', error);
    res.status(500).json({ error: 'Failed to create filter view' });
  }
});

// PUT /api/views/:id - Update an existing saved filter view
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    const userId = req.user.id;
    const viewId = req.params.id;
    const parsed = parseBody(updateViewBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { filterName, filters, shared } = parsed.data;
    if (shared !== undefined && rejectViewerSharedView(req, res, shared)) return;
    
    // MIGRATED: Check if view exists using sqlManager
    const existingView = await viewQueries.getViewById(db, viewId, userId);
    
    if (!existingView) {
      return res.status(404).json({ error: 'Filter view not found' });
    }
    
    // Validate filter name if provided
    if (filterName !== undefined) {
      if (!filterName || !filterName.trim()) {
        return res.status(400).json({ error: 'Filter name cannot be empty' });
      }
      
      // MIGRATED: Check if name conflict exists using sqlManager
      const nameConflict = await viewQueries.checkViewNameExists(db, filterName.trim(), userId, viewId);
      
      if (nameConflict) {
        return res.status(409).json({ error: 'A filter with this name already exists' });
      }
    }
    
    // Build updates object
    const updates = {};
    
    if (filterName !== undefined) {
      updates.filterName = filterName.trim();
    }
    
    if (filters !== undefined) {
      const validatedFilters = validateFilterData(filters);
      Object.assign(updates, validatedFilters);
    }
    
    if (shared !== undefined) {
      updates.shared = shared;
    }
    
    // Check if there are any updates (excluding updated_at which is always set)
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    
    // MIGRATED: Update view using sqlManager
    await viewQueries.updateView(db, viewId, userId, updates);
    
    // MIGRATED: Fetch updated view using sqlManager
    const updatedView = await viewQueries.getViewById(db, viewId, userId);
    const formattedView = formatViewForResponse(updatedView);
    
    // Publish to Redis for real-time updates if shared status changed or filter is shared
    // We need to check if the shared status changed by comparing with the original view
    const originalShared = Boolean(existingView.shared);
    const newShared = formattedView.shared;
    
    
    if (originalShared !== newShared || newShared) {
      console.log('📤 Publishing filter-updated for filter:', formattedView.filterName, 'shared:', newShared);
      await notificationService.publish('filter-updated', {
        filter: formattedView,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
      console.log('✅ Filter-updated published');
    } else {
      console.log('⏭️ Skipping publish - no shared status change and filter not shared');
    }
    
    res.json(formattedView);
  } catch (error) {
    console.error('Error updating view:', error);
    res.status(500).json({ error: 'Failed to update filter view' });
  }
});

// DELETE /api/views/:id - Delete a saved filter view
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    const userId = req.user.id;
    const viewId = req.params.id;
    
    // MIGRATED: Get the view before deleting using sqlManager
    const viewToDelete = await viewQueries.getViewById(db, viewId, userId);
    
    if (!viewToDelete) {
      return res.status(404).json({ error: 'Filter view not found' });
    }
    
    // MIGRATED: Delete view using sqlManager
    const result = await viewQueries.deleteView(db, viewId, userId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Filter view not found' });
    }
    
    // Publish to Redis for real-time updates if the filter was shared
    if (viewToDelete.shared) {
      console.log('📤 Publishing filter-deleted for shared filter:', viewToDelete.filterName);
      await notificationService.publish('filter-deleted', {
        filterId: viewId,
        filterName: viewToDelete.filterName,
        timestamp: new Date().toISOString()
      }, getTenantId(req));
      console.log('✅ Filter-deleted published');
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting view:', error);
    res.status(500).json({ error: 'Failed to delete filter view' });
  }
});

export default router;
