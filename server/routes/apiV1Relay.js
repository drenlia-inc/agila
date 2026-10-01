/**
 * Agila API Relay — column-by-title, external keys, claim, and plans.
 * Mounted at /api/v1 ahead of the shared product routers. Web-shaped bodies fall through.
 */

import express from 'express';
import crypto from 'crypto';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getRequestDatabase, getTenantId } from '../middleware/tenantRouting.js';
import { userCanAccessBoard, userHasAdminRole, sendBoardAccessDenied } from '../middleware/boardAccess.js';
import { dbTransaction } from '../utils/dbAsync.js';
import { getAppLanguage } from '../utils/i18n.js';
import notificationService from '../services/notificationService.js';
import {
  boards as boardQueries,
  helpers,
  tasks as taskQueries,
  sprints as sprintQueries,
  priorities as priorityQueries,
  users as userQueries,
  acceptanceCriteria as acQueries,
  boardParticipants as participantQueries,
  relay as relayQueries
} from '../utils/sqlManager/index.js';
import {
  parseBody,
  relayBoardBodySchema,
  relaySprintBodySchema,
  relayTaskBodySchema,
  relayMoveBodySchema,
  relayClaimBodySchema,
  relayCriterionBodySchema,
  relayPlanBodySchema
} from '../utils/requestValidation.js';

const router = express.Router();
const PLAN_TASK_CAP = 500;

function hashClaim(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function newClaimToken() {
  return crypto.randomBytes(32).toString('hex');
}

function publicTask(row, claimToken) {
  if (!row) return null;
  const task = {
    id: row.id,
    title: row.title,
    ticket: row.ticket || null,
    boardId: row.boardId || row.boardid,
    columnId: row.columnId || row.columnid,
    memberId: row.memberId || row.memberid || null,
    sprintId: row.sprintId || row.sprint_id || null
  };
  if (claimToken) task.claimToken = claimToken;
  return task;
}

function taskForClient(row) {
  if (!row?.id) return null;
  const clientTask = { ...row };
  delete clientTask.claim_token_hash;
  delete clientTask.claimTokenHash;
  clientTask.columnId = row.columnId || row.columnid;
  clientTask.boardId = row.boardId || row.boardid;
  clientTask.memberId = row.memberId !== undefined ? row.memberId : row.memberid ?? null;
  clientTask.requesterId = row.requesterId !== undefined ? row.requesterId : row.requesterid ?? null;
  clientTask.sprintId = row.sprintId !== undefined ? row.sprintId : row.sprint_id ?? null;
  if (row.description !== undefined) clientTask.description = row.description ?? '';
  return clientTask;
}

async function publishTaskEvent(req, task, created) {
  try {
    const db = getRequestDatabase(req);
    const full = task?.id ? await taskQueries.getTaskWithRelationships(db, task.id) : null;
    const clientTask = taskForClient(full || task);
    if (!clientTask?.boardId) return;
    await notificationService.publish(
      created ? 'task-created' : 'task-updated',
      {
        boardId: clientTask.boardId,
        task: clientTask,
        timestamp: new Date().toISOString()
      },
      getTenantId(req)
    );
  } catch (error) {
    console.error('Relay task realtime publish failed:', error);
  }
}

async function publishWrittenTask(req, written) {
  await publishTaskEvent(req, written.task, written.created);
  if (written.criteriaChanged && written.task?.id) {
    const boardId = written.task.boardId || written.task.boardid;
    await publishAcceptanceCriteria(req, written.task.id, boardId);
  }
}

async function publishAcceptanceCriteria(req, taskId, boardId) {
  try {
    const db = getRequestDatabase(req);
    const items = await acQueries.listForTask(db, taskId);
    await notificationService.publish(
      'acceptance-criteria-updated',
      { taskId, boardId, items, timestamp: new Date().toISOString() },
      getTenantId(req)
    );
  } catch (error) {
    console.error('Relay acceptance criteria realtime publish failed:', error);
  }
}

async function publishBoardCreated(req, db, board) {
  try {
    const columns = await helpers.getColumnsForBoard(db, board.id);
    const userIds = await participantQueries.listParticipantUserIds(db, board.id);
    const tenantId = getTenantId(req);
    await notificationService.publish(
      'board-participants-updated',
      { boardId: board.id, participantCount: userIds.length, userIds },
      tenantId
    );
    await notificationService.publish(
      'board-created',
      {
        boardId: board.id,
        board: {
          id: board.id,
          title: board.title,
          project: board.project,
          position: board.position,
          participantCount: userIds.length
        },
        userIds,
        timestamp: new Date().toISOString()
      },
      tenantId
    );
    for (const column of columns) {
      await notificationService.publish(
        'column-created',
        {
          boardId: board.id,
          column: {
            id: column.id,
            title: column.title,
            boardId: board.id,
            position: column.position,
            is_finished: column.is_finished,
            is_archived: column.is_archived
          },
          updatedBy: req.user?.id || 'system',
          timestamp: new Date().toISOString()
        },
        tenantId
      );
    }
  } catch (error) {
    console.error('Relay board realtime publish failed:', error);
  }
}

async function publishSprintCreated(req, db, sprintId) {
  try {
    const sprint = await sprintQueries.getSprintById(db, sprintId);
    if (!sprint) return;
    await notificationService.publish(
      'sprint-created',
      { sprint, timestamp: new Date().toISOString() },
      getTenantId(req)
    );
  } catch (error) {
    console.error('Relay sprint realtime publish failed:', error);
  }
}

async function callerMemberId(db, userId) {
  const member = await userQueries.getMemberByUserId(db, userId);
  return member?.id || null;
}

function conflictBody(row) {
  return {
    error: 'Claim is no longer valid',
    code: 'CLAIM_CONFLICT',
    task: publicTask(row)
  };
}

async function createBoardWithColumns(db, req, body) {
  if (body.externalKey) {
    const existing = await relayQueries.getBoardByExternalKey(db, body.externalKey);
    if (existing) {
      if (!(await userCanAccessBoard(db, req.user, existing.id))) {
        const err = new Error('You do not have access to this board');
        err.status = 403;
        err.code = 'BOARD_ACCESS_DENIED';
        throw err;
      }
      if (!existing.deletedAt) {
        return { board: await boardQueries.getBoardById(db, existing.id), created: false };
      }
      await relayQueries.clearBoardExternalKey(db, existing.id);
    }
  }
  if (!userHasAdminRole(req.user)) {
    const err = new Error('Insufficient permissions');
    err.status = 403;
    throw err;
  }
  const duplicate = await boardQueries.getBoardByTitle(db, body.title);
  if (duplicate) {
    const err = new Error('A board with that name already exists');
    err.status = 400;
    throw err;
  }
  const id = crypto.randomUUID();
  const projectPrefix = await boardQueries.getProjectPrefix(db);
  const projectIdentifier = await boardQueries.generateProjectIdentifier(db, projectPrefix);
  const maxPosition = await boardQueries.getMaxBoardPosition(db);
  await boardQueries.createBoard(db, id, body.title, projectIdentifier, maxPosition + 1);
  if (body.externalKey) await relayQueries.setBoardExternalKey(db, id, body.externalKey);

  const lang = await getAppLanguage(db);
  const archiveTitle = lang === 'fr' ? 'Archives' : 'Archive';
  const columns = Array.isArray(body.columns) ? body.columns : [];
  if (columns.length) {
    const finishedFlags = columns.map((col) => col.finished === true);
    const finishedCount = finishedFlags.filter(Boolean).length;
    if (finishedCount > 1) {
      const err = new Error('Mark at most one column as finished');
      err.status = 400;
      throw err;
    }
    const finishedIndex = finishedCount === 1 ? finishedFlags.indexOf(true) : columns.length - 1;
    for (let i = 0; i < columns.length; i += 1) {
      await helpers.createColumn(
        db,
        crypto.randomUUID(),
        columns[i].title,
        id,
        i,
        i === finishedIndex,
        false
      );
    }
    await helpers.createColumn(db, crypto.randomUUID(), archiveTitle, id, columns.length, false, true);
  }
  const participantIds = Array.isArray(body.participantUserIds) ? body.participantUserIds : [];
  await participantQueries.ensureAdminsOnBoard(db, id, [req.user.id, ...participantIds]);
  return { board: await boardQueries.getBoardById(db, id), created: true };
}

async function createSprintRecord(db, userId, body) {
  if (body.externalKey) {
    const existing = await relayQueries.getSprintByExternalKey(db, body.externalKey);
    if (existing) return { sprintId: existing.id, created: false };
  }
  if (new Date(body.endDate) < new Date(body.startDate)) {
    const err = new Error('End date must be after start date');
    err.status = 400;
    throw err;
  }
  const sprintId = crypto.randomUUID();
  if (body.active) await sprintQueries.deactivateAllSprints(db);
  await sprintQueries.createSprint(
    db,
    sprintId,
    body.name,
    body.startDate,
    body.endDate,
    Boolean(body.active),
    body.description || null,
    body.goal || null
  );
  if (body.externalKey) await relayQueries.setSprintExternalKey(db, sprintId, body.externalKey);
  return { sprintId, created: true };
}

async function loadColumnOrThrow(db, boardId, ref) {
  const columns = await helpers.getColumnsForBoard(db, boardId);
  const byId = columns.find((col) => col.id === ref);
  if (byId) return byId;
  const title = String(ref || '').trim().toLowerCase();
  const matches = columns.filter((col) => String(col.title || '').trim().toLowerCase() === title);
  if (matches.length > 1) {
    const err = new Error('More than one column has that title');
    err.status = 409;
    err.code = 'COLUMN_AMBIGUOUS';
    throw err;
  }
  if (matches.length === 0) {
    const err = new Error('Column not found');
    err.status = 404;
    throw err;
  }
  return matches[0];
}

async function loadBoardOrThrow(db, user, idOrKey) {
  let board = await boardQueries.getBoardById(db, idOrKey);
  if (!board || board.deletedAt) {
    const byKey = await relayQueries.getBoardByExternalKey(db, idOrKey);
    if (byKey && !byKey.deletedAt) board = await boardQueries.getBoardById(db, byKey.id);
  }
  if (!board || board.deletedAt) {
    const err = new Error('Board not found');
    err.status = 404;
    throw err;
  }
  if (!(await userCanAccessBoard(db, user, board.id))) {
    const err = new Error('You do not have access to this board');
    err.status = 403;
    err.code = 'BOARD_ACCESS_DENIED';
    throw err;
  }
  return board;
}

async function writeTask(db, req, body, fallbackBoardId) {
  const board = await loadBoardOrThrow(db, req.user, body.boardId || body.boardExternalKey || fallbackBoardId);
  const column = await loadColumnOrThrow(db, board.id, body.column);
  const priority = await priorityQueries.getDefaultPriority(db);
  let existing = null;
  if (body.externalKey) {
    existing = await relayQueries.getTaskByExternalKey(db, body.externalKey);
    if (existing) {
      if (!(await userCanAccessBoard(db, req.user, existing.boardId))) {
        const err = new Error('You do not have access to this board');
        err.status = 403;
        err.code = 'BOARD_ACCESS_DENIED';
        throw err;
      }
      if (existing.deletedAt) {
        await relayQueries.clearTaskExternalKey(db, existing.id);
      } else {
        const updates = {
          title: body.title,
          description: body.description || ''
        };
        if (existing.columnId !== column.id) updates.columnId = column.id;
        if (existing.boardId !== board.id) updates.boardId = board.id;
        if ((existing.sprintId || null) !== (body.sprintId || null)) updates.sprintId = body.sprintId || null;
        await taskQueries.updateTask(db, existing.id, updates);
        if (Array.isArray(body.acceptanceCriteria)) {
          await acQueries.deleteForTask(db, existing.id);
          for (const text of body.acceptanceCriteria) {
            await acQueries.createItem(db, existing.id, text);
          }
        }
        const updated = await taskQueries.getTaskById(db, existing.id);
        return {
          task: updated,
          created: false,
          criteriaChanged: Array.isArray(body.acceptanceCriteria)
        };
      }
    }
  }
  const ticket = await taskQueries.generateTaskTicket(db, 'TASK-');
  const today = new Date().toISOString().slice(0, 10);
  const id = crypto.randomUUID();
  await taskQueries.createTask(db, {
    id,
    title: body.title,
    description: body.description || '',
    ticket,
    columnId: column.id,
    boardId: board.id,
    sprintId: body.sprintId || null,
    startDate: today,
    effort: 0,
    priority: priority?.name || 'Medium',
    priorityId: priority?.id || null,
    position: 0
  });
  if (body.externalKey) await relayQueries.setTaskExternalKey(db, id, body.externalKey);
  if (Array.isArray(body.acceptanceCriteria)) {
    for (const text of body.acceptanceCriteria) {
      await acQueries.createItem(db, id, text);
    }
  }
  const created = await taskQueries.getTaskById(db, id);
  return {
    task: created,
    created: true,
    criteriaChanged: Array.isArray(body.acceptanceCriteria)
  };
}

router.use(authenticateToken);

router.post('/boards', async (req, res, next) => {
  if (!req.body || !Array.isArray(req.body.columns)) return next('router');
  const parsed = parseBody(relayBoardBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  try {
    const db = getRequestDatabase(req);
    const result = await dbTransaction(db, () => createBoardWithColumns(db, req, parsed.data));
    if (result.created) await publishBoardCreated(req, db, result.board);
    res.status(result.created ? 201 : 200).json({ board: result.board, created: result.created });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Relay create board error:', error);
    res.status(status).json({ error: error.status ? error.message : 'Failed to create board' });
  }
});

router.post('/sprints', requireRole(['admin']), async (req, res) => {
  const parsed = parseBody(relaySprintBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  try {
    const db = getRequestDatabase(req);
    const result = await dbTransaction(db, () => createSprintRecord(db, req.user.id, parsed.data));
    const sprint = await sprintQueries.getSprintById(db, result.sprintId);
    if (result.created) await publishSprintCreated(req, db, result.sprintId);
    res.status(result.created ? 201 : 200).json({ sprint, created: result.created });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Relay create sprint error:', error);
    res.status(status).json({ error: error.status ? error.message : 'Failed to create sprint' });
  }
});

router.post('/tasks', async (req, res, next) => {
  if (!req.body || typeof req.body.column !== 'string') return next('router');
  const parsed = parseBody(relayTaskBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  try {
    const db = getRequestDatabase(req);
    const result = await writeTask(db, req, parsed.data);
    await publishWrittenTask(req, result);
    res.status(result.created ? 201 : 200).json({
      task: publicTask(result.task),
      created: result.created
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Relay upsert task error:', error);
    res.status(status).json({ error: error.status ? error.message : 'Failed to save task', code: error.code });
  }
});

router.post('/tasks/:id/move', async (req, res) => {
  const parsed = parseBody(relayMoveBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  try {
    const db = getRequestDatabase(req);
    const current = await relayQueries.getTaskClaimRow(db, req.params.id);
    if (!current || current.deletedAt) return res.status(404).json({ error: 'Task not found' });
    if (!(await userCanAccessBoard(db, req.user, current.boardId))) {
      return sendBoardAccessDenied(res, db);
    }
    const memberId = await callerMemberId(db, req.user.id);
    const column = await loadColumnOrThrow(db, current.boardId, parsed.data.column);
    const expected = hashClaim(parsed.data.claimToken);
    const nextRaw = newClaimToken();
    const moved = await relayQueries.moveClaimedTask(db, {
      taskId: current.id,
      memberId,
      fromColumnId: current.columnId,
      toColumnId: column.id,
      expectedHash: expected,
      nextHash: hashClaim(nextRaw)
    });
    if (!moved) return res.status(409).json(conflictBody(current));
    await publishTaskEvent(req, moved, false);
    res.json({ task: publicTask(moved, nextRaw) });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Relay move error:', error);
    res.status(status).json({ error: error.status ? error.message : 'Failed to move task', code: error.code });
  }
});

router.post('/boards/:id/claim', async (req, res) => {
  const parsed = parseBody(relayClaimBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  try {
    const db = getRequestDatabase(req);
    const board = await loadBoardOrThrow(db, req.user, req.params.id);
    const fromColumn = await loadColumnOrThrow(db, board.id, parsed.data.fromColumn);
    const toColumn = await loadColumnOrThrow(db, board.id, parsed.data.toColumn);
    const memberId = await callerMemberId(db, req.user.id);
    if (!memberId) return res.status(400).json({ error: 'Your user has no member profile' });
    const raw = newClaimToken();
    const claimed = await relayQueries.claimNextTask(db, {
      boardId: board.id,
      fromColumnId: fromColumn.id,
      toColumnId: toColumn.id,
      memberId,
      sprintId: parsed.data.sprintId || null,
      claimHash: hashClaim(raw)
    });
    if (!claimed) {
      return res.status(409).json({ error: 'No card available to claim', code: 'CLAIM_EMPTY' });
    }
    await publishTaskEvent(req, claimed, false);
    res.json({ task: publicTask(claimed, raw) });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Relay claim error:', error);
    res.status(status).json({ error: error.status ? error.message : 'Failed to claim task', code: error.code });
  }
});

router.patch('/tasks/:taskId/acceptance-criteria/:criterionId', async (req, res) => {
  const parsed = parseBody(relayCriterionBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  try {
    const db = getRequestDatabase(req);
    const current = await relayQueries.getTaskClaimRow(db, req.params.taskId);
    if (!current || current.deletedAt) return res.status(404).json({ error: 'Task not found' });
    if (!(await userCanAccessBoard(db, req.user, current.boardId))) {
      return sendBoardAccessDenied(res, db);
    }
    const memberId = await callerMemberId(db, req.user.id);
    const expected = hashClaim(parsed.data.claimToken);
    if (current.memberId !== memberId || current.claimTokenHash !== expected) {
      return res.status(409).json(conflictBody(current));
    }
    const item = await acQueries.getById(db, req.params.criterionId);
    if (!item || item.taskId !== current.id) return res.status(404).json({ error: 'Acceptance criterion not found' });
    const updated = await acQueries.updateItem(db, item.id, { isDone: parsed.data.done });
    await publishAcceptanceCriteria(req, current.id, current.boardId);
    res.json({ item: updated });
  } catch (error) {
    console.error('Relay criterion error:', error);
    res.status(500).json({ error: 'Failed to update acceptance criterion' });
  }
});

router.post('/plans', async (req, res) => {
  const parsed = parseBody(relayPlanBodySchema, req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  if (parsed.data.tasks.length > PLAN_TASK_CAP) {
    return res.status(400).json({ error: `A plan can include at most ${PLAN_TASK_CAP} cards` });
  }
  if (parsed.data.sprint && !userHasAdminRole(req.user)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  if (!parsed.data.board.columns?.length) {
    return res.status(400).json({ error: 'columns are required for a Relay board' });
  }
  try {
    const db = getRequestDatabase(req);
    const result = await dbTransaction(db, async () => {
      let sprint = null;
      let sprintCreated = false;
      if (parsed.data.sprint) {
        const created = await createSprintRecord(db, req.user.id, parsed.data.sprint);
        sprintCreated = created.created;
        sprint = await sprintQueries.getSprintById(db, created.sprintId);
      }
      const boardResult = await createBoardWithColumns(db, req, parsed.data.board);
      const tasks = [];
      const writtenTasks = [];
      for (const taskBody of parsed.data.tasks) {
        const written = await writeTask(db, req, {
          ...taskBody,
          boardId: boardResult.board.id,
          sprintId: taskBody.sprintId || sprint?.id || null
        }, boardResult.board.id);
        writtenTasks.push(written);
        tasks.push(publicTask(written.task));
      }
      return {
        sprint,
        sprintCreated,
        board: boardResult.board,
        boardCreated: boardResult.created,
        tasks,
        writtenTasks
      };
    });
    if (result.sprintCreated && result.sprint?.id) {
      await publishSprintCreated(req, db, result.sprint.id);
    }
    if (result.boardCreated) await publishBoardCreated(req, db, result.board);
    for (const written of result.writtenTasks) {
      await publishWrittenTask(req, written);
    }
    res.status(201).json({ sprint: result.sprint, board: result.board, tasks: result.tasks });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Relay plan error:', error);
    res.status(status).json({ error: error.status ? error.message : 'Failed to apply plan', code: error.code });
  }
});

export default router;
