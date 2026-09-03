import express from 'express';
import crypto from 'crypto';
import { wrapQuery } from '../utils/queryLogger.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import notificationService from '../services/notificationService.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import { dbTransaction } from '../utils/dbAsync.js';
import { sprints as sprintQueries, tasks as taskQueries } from '../utils/sqlManager/index.js';
import {
  parseBody,
  createSprintBodySchema,
  updateSprintBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();

async function publishTransferredTaskUpdates(db, req, transferredTasks) {
  if (!transferredTasks?.length) return;
  const tenantId = getTenantId(req);
  const byBoard = transferredTasks.reduce((acc, task) => {
    if (!acc[task.boardId]) acc[task.boardId] = [];
    acc[task.boardId].push(task);
    return acc;
  }, {});
  for (const [boardId, boardTasks] of Object.entries(byBoard)) {
    for (const task of boardTasks) {
      const updatedTask = await taskQueries.getTaskWithRelationships(db, task.id);
      if (updatedTask) {
        await notificationService.publish(
          'task-updated',
          { boardId, task: updatedTask, timestamp: new Date().toISOString() },
          tenantId
        );
      }
    }
  }
}

// GET /api/admin/sprints - Get all planning periods/sprints (accessible to all authenticated users for filtering)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    
    // MIGRATED: Use sqlManager to get all sprints
    const sprints = await sprintQueries.getAllSprints(db);

    res.json({
      sprints: (sprints || []).map((sprint) => ({
        ...sprint,
        is_active: sprint.is_active === true,
        task_count: Number(sprint.task_count) || 0
      }))
    });
  } catch (error) {
    console.error('Failed to fetch sprints:', error);
    res.status(500).json({ error: 'Failed to fetch sprints' });
  }
});

// GET /api/admin/sprints/active - Get currently active sprint (must come before /:id routes)
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    
    // MIGRATED: Use sqlManager to get active sprint
    const activeSprint = await sprintQueries.getActiveSprint(db);
    
    if (!activeSprint) {
      return res.status(404).json({ error: 'No active sprint found' });
    }
    
    res.json(activeSprint);
  } catch (error) {
    console.error('Failed to fetch active sprint:', error);
    res.status(500).json({ error: 'Failed to fetch active sprint' });
  }
});

// GET /api/admin/sprints/:id/usage - Get sprint usage count (for deletion confirmation)
// This route must come before the PUT /:id and DELETE /:id routes
router.get("/:id/usage", authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { id } = req.params;
    
    // MIGRATED: Check if sprint exists using sqlManager
    const sprint = await sprintQueries.getSprintById(db, id);
    
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    
    // MIGRATED: Get usage count using sqlManager
    const count = await sprintQueries.getSprintUsageCount(db, id);
    res.json({ count });
  } catch (error) {
    console.error('Error fetching sprint usage:', error);
    res.status(500).json({ error: 'Failed to fetch sprint usage' });
  }
});

// GET /api/admin/sprints/:id/active-work-count — unfinished live tasks (for activate transfer prompt)
router.get('/:id/active-work-count', authenticateToken, async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { id } = req.params;
    const sprint = await sprintQueries.getSprintById(db, id);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    const counts = await sprintQueries.getSprintWorkCountsForTransfer(db, id);
    res.json({
      count: counts.active,
      active: counts.active,
      total: counts.total
    });
  } catch (error) {
    console.error('Error fetching sprint active-work count:', error);
    res.status(500).json({ error: 'Failed to fetch sprint active-work count' });
  }
});

// POST /api/admin/sprints - Create a new sprint
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const parsed = parseBody(createSprintBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { name, start_date, end_date, is_active, description, goal, transfer_active_work } = parsed.data;

    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }
    
    const sprintId = crypto.randomUUID();
    const previousActive = is_active ? await sprintQueries.getActiveSprint(db) : null;
    let transferredTasks = [];

    await dbTransaction(db, async () => {
      if (is_active) {
        await sprintQueries.deactivateAllSprints(db);
      }
      await sprintQueries.createSprint(
        db,
        sprintId,
        name,
        start_date,
        end_date,
        is_active,
        description,
        goal
      );
      if (is_active && transfer_active_work && previousActive?.id) {
        transferredTasks = await sprintQueries.transferActiveWorkToSprint(
          db,
          previousActive.id,
          sprintId
        );
      }
    });

    const newSprint = await sprintQueries.getSprintById(db, sprintId);
    
    console.log('📤 Publishing sprint-created');
    await notificationService.publish(
      'sprint-created',
      { sprint: newSprint, timestamp: new Date().toISOString() },
      getTenantId(req)
    );
    console.log('✅ Sprint-created published');

    await publishTransferredTaskUpdates(db, req, transferredTasks);
    
    res.status(201).json({
      ...newSprint,
      transferred_count: transferredTasks.length
    });
  } catch (error) {
    console.error('Failed to create sprint:', error);
    res.status(500).json({ error: 'Failed to create sprint' });
  }
});

// PUT /api/admin/sprints/:id - Update a sprint
router.put("/:id", authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { id } = req.params;
    const parsed = parseBody(updateSprintBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { name, start_date, end_date, is_active, description, goal, transfer_active_work } = parsed.data;

    // MIGRATED: Check if sprint exists using sqlManager
    const existing = await sprintQueries.getSprintById(db, id);

    if (!existing) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const becomingActive = Boolean(is_active) && !Boolean(existing.is_active);
    const previousActive = becomingActive ? await sprintQueries.getActiveSprint(db) : null;
    let transferredTasks = [];

    await dbTransaction(db, async () => {
      if (is_active) {
        await sprintQueries.deactivateAllSprintsExcept(db, id);
      }
      await sprintQueries.updateSprint(
        db,
        id,
        name,
        start_date,
        end_date,
        is_active,
        description,
        goal
      );
      if (
        becomingActive &&
        transfer_active_work &&
        previousActive?.id &&
        previousActive.id !== id
      ) {
        transferredTasks = await sprintQueries.transferActiveWorkToSprint(
          db,
          previousActive.id,
          id
        );
      }
    });

    const updated = await sprintQueries.getSprintById(db, id);
    
    console.log('📤 Publishing sprint-updated');
    await notificationService.publish(
      'sprint-updated',
      { sprint: updated, timestamp: new Date().toISOString() },
      getTenantId(req)
    );
    console.log('✅ Sprint-updated published');

    await publishTransferredTaskUpdates(db, req, transferredTasks);
    
    res.json({
      ...updated,
      transferred_count: transferredTasks.length
    });
  } catch (error) {
    console.error('Failed to update sprint:', error);
    res.status(500).json({ error: 'Failed to update sprint' });
  }
});

// DELETE /api/admin/sprints/:id - Delete a sprint
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const { id } = req.params;
    
    // MIGRATED: Check if sprint exists using sqlManager
    const existing = await sprintQueries.getSprintById(db, id);
    
    if (!existing) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    
    // MIGRATED: Get tasks using this sprint using sqlManager
    const tasksUsingSprint = await sprintQueries.getTasksUsingSprint(db, id);
    
    // Use transaction to ensure atomicity
    await dbTransaction(db, async () => {
      // MIGRATED: If sprint is in use, unassign tasks using sqlManager
      if (tasksUsingSprint.length > 0) {
        console.log(`📋 Removing sprint assignment from ${tasksUsingSprint.length} tasks`);
        
        await sprintQueries.unassignTasksFromSprint(db, id);
        
        console.log(`✅ Removed sprint assignment from ${tasksUsingSprint.length} tasks`);
      }
      
      // MIGRATED: Delete the sprint using sqlManager
      await sprintQueries.deleteSprint(db, id);
    });
    
    console.log('📤 Publishing sprint-deleted');
    await notificationService.publish(
      'sprint-deleted',
      { sprintId: id, sprint: existing, timestamp: new Date().toISOString() },
      getTenantId(req)
    );
    console.log('✅ Sprint-deleted published');
    
    // If tasks were updated, publish task updates for each affected board
    if (tasksUsingSprint.length > 0) {
      // Group tasks by board for efficient updates
      const tasksByBoard = tasksUsingSprint.reduce((acc, task) => {
        if (!acc[task.boardId]) acc[task.boardId] = [];
        acc[task.boardId].push(task);
        return acc;
      }, {});
      
      // Publish updates for each board
      for (const [boardId, tasks] of Object.entries(tasksByBoard)) {
        console.log(`📤 Publishing ${tasks.length} task updates for board ${boardId}`);
        
        for (const task of tasks) {
          // MIGRATED: Fetch updated task data using sqlManager
          const updatedTask = await taskQueries.getTaskWithRelationships(db, task.id);
          
          if (updatedTask) {
            await notificationService.publish('task-updated', {
              boardId: boardId,
              task: updatedTask,
              timestamp: new Date().toISOString()
            }, getTenantId(req));
          }
        }
      }
      
      console.log(`✅ Published task updates for ${tasksUsingSprint.length} tasks`);
    }
    
    res.json({ 
      success: true, 
      message: 'Sprint deleted successfully',
      unassignedTasks: tasksUsingSprint.length
    });
  } catch (error) {
    console.error('Failed to delete sprint:', error);
    res.status(500).json({ error: 'Failed to delete sprint' });
  }
});

export default router;

