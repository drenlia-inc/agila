import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import { assertTaskBoardAccess } from '../middleware/boardAccess.js';
import { acceptanceCriteria as acQueries, tasks as taskQueries } from '../utils/sqlManager/index.js';
import notificationService from '../services/notificationService.js';
import {
  parseBody,
  createAcceptanceCriterionBodySchema,
  updateAcceptanceCriterionBodySchema,
  reorderAcceptanceCriteriaBodySchema,
} from '../utils/requestValidation.js';

const router = express.Router();

async function publishAcUpdated(req, taskId) {
  const db = getRequestDatabase(req);
  const items = await acQueries.listForTask(db, taskId);
  const boardId = await taskQueries.getTaskBoardId(db, taskId);
  await notificationService.publish(
    'acceptance-criteria-updated',
    { taskId, boardId, items, timestamp: new Date().toISOString() },
    getTenantId(req)
  );
  return items;
}

router.get('/:taskId/acceptance-criteria', authenticateToken, async (req, res) => {
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;
    const db = getRequestDatabase(req);
    const items = await acQueries.listForTask(db, req.params.taskId);
    res.json(items);
  } catch (error) {
    console.error('Error fetching acceptance criteria:', error);
    res.status(500).json({ error: 'Failed to fetch acceptance criteria' });
  }
});

router.post('/:taskId/acceptance-criteria', authenticateToken, async (req, res) => {
  const parsed = parseBody(createAcceptanceCriterionBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;
    const db = getRequestDatabase(req);
    const item = await acQueries.createItem(db, req.params.taskId, parsed.data.text);
    await publishAcUpdated(req, req.params.taskId);
    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating acceptance criterion:', error);
    res.status(500).json({ error: 'Failed to create acceptance criterion' });
  }
});

router.put('/:taskId/acceptance-criteria/reorder', authenticateToken, async (req, res) => {
  const parsed = parseBody(reorderAcceptanceCriteriaBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;
    const db = getRequestDatabase(req);
    const items = await acQueries.reorderItems(db, req.params.taskId, parsed.data.orderedIds);
    await publishAcUpdated(req, req.params.taskId);
    res.json(items);
  } catch (error) {
    console.error('Error reordering acceptance criteria:', error);
    res.status(500).json({ error: 'Failed to reorder acceptance criteria' });
  }
});

router.put('/:taskId/acceptance-criteria/:id', authenticateToken, async (req, res) => {
  const parsed = parseBody(updateAcceptanceCriterionBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;
    const db = getRequestDatabase(req);
    const item = await acQueries.updateItem(db, req.params.id, parsed.data);
    if (!item) {
      return res.status(404).json({ error: 'Acceptance criterion not found' });
    }
    await publishAcUpdated(req, req.params.taskId);
    res.json(item);
  } catch (error) {
    console.error('Error updating acceptance criterion:', error);
    res.status(500).json({ error: 'Failed to update acceptance criterion' });
  }
});

router.delete('/:taskId/acceptance-criteria/:id', authenticateToken, async (req, res) => {
  try {
    if (!(await assertTaskBoardAccess(req, res, req.params.taskId))) return;
    const db = getRequestDatabase(req);
    await acQueries.deleteItem(db, req.params.id);
    await publishAcUpdated(req, req.params.taskId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting acceptance criterion:', error);
    res.status(500).json({ error: 'Failed to delete acceptance criterion' });
  }
});

export default router;
