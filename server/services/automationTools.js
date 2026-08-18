/**
 * Allowlisted automation tools for Agent Automation mode (job-scoped token context).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  tasks as taskQueries,
  helpers,
  boards as boardQueries,
  comments as commentQueries,
  priorities as priorityQueries,
  sprints as sprintQueries,
  members as memberQueries,
  tags as tagQueries,
  files as fileQueries,
  taskWork as taskWorkQueries,
  automationJournal
} from '../utils/sqlManager/index.js';
import {
  AUTOMATION_SCOPE,
  AUTOMATION_MAX_TASKS_PER_APPLY,
  AUTOMATION_CAPABILITIES
} from '../constants/automation.js';
import { AGENT_MEMBER_ID } from '../constants/agentIdentity.js';
import { TASK_TITLE_MAX_LENGTH, TASK_DESCRIPTION_MAX_LENGTH } from '../constants/fieldLimits.js';
import notificationService from './notificationService.js';
import { getDefaultBoardColumns } from '../utils/defaultBoardColumns.js';
import { updateStorageUsage } from '../utils/storageUtils.js';
import { wrapQuery } from '../utils/queryLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAttachmentsDir(tenantId = null) {
  const basePath =
    process.env.DOCKER_ENV === 'true' ? '/app/server' : dirname(__dirname);
  if (tenantId && process.env.MULTI_TENANT === 'true') {
    return path.join(basePath, 'attachments', 'tenants', tenantId);
  }
  return path.join(basePath, 'attachments');
}

function stripHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function taskBoardId(task) {
  return task?.boardid || task?.boardId || null;
}

function taskColumnId(task) {
  return task?.columnid || task?.columnId || null;
}

function taskBoardTitle(task) {
  return task?.board_title || task?.boardTitle || null;
}

function taskColumnTitle(task) {
  return task?.column_title || task?.columnTitle || null;
}

function taskSnapshot(task) {
  if (!task) return null;
  return {
    id: task.id,
    ticket: task.ticket,
    title: task.title,
    description: task.description,
    columnId: taskColumnId(task),
    columnTitle: taskColumnTitle(task),
    boardId: taskBoardId(task),
    boardTitle: taskBoardTitle(task),
    sprintId: task.sprint_id || task.sprintId || null,
    priority: task.priority,
    priorityId: task.priority_id || task.priorityId || null,
    effort: task.effort,
    startDate: task.startdate || task.startDate || null,
    dueDate: task.duedate || task.dueDate || null,
    memberId: task.memberid || task.memberId || null,
    position: task.position
  };
}

function compactTask(task, { includeDescription = false } = {}) {
  const base = {
    id: task.id,
    ticket: task.ticket,
    title: task.title,
    boardId: taskBoardId(task),
    boardTitle: taskBoardTitle(task),
    columnId: taskColumnId(task),
    columnTitle: taskColumnTitle(task),
    sprintId: task.sprint_id || task.sprintId || null,
    memberId: task.memberid || task.memberId || null,
    priority: task.priority
  };
  if (includeDescription) {
    const plain = stripHtml(task.description);
    base.descriptionPreview = plain.slice(0, 500);
    base.descriptionLength = plain.length;
  }
  const deletedAt = task.deleted_at || task.deletedAt || null;
  if (deletedAt) {
    base.inTrash = true;
    base.deletedAt = deletedAt;
  }
  return base;
}

/** id → title map for boards in scope (cached on ctx for the tool request). */
async function getBoardTitleMap(ctx) {
  if (ctx._boardTitleMap) return ctx._boardTitleMap;
  const boards = await boardQueries.getAllBoards(ctx.db);
  const map = new Map();
  for (const b of boards || []) {
    if (b?.id) map.set(b.id, b.title || '');
  }
  ctx._boardTitleMap = map;
  return map;
}

async function getColumnTitleMap(ctx) {
  if (ctx._columnTitleMap) return ctx._columnTitleMap;
  const allowed = await resolveAllowedBoardIds(ctx);
  const cols = await helpers.getColumnsForAllBoards(ctx.db, allowed);
  const map = new Map();
  for (const c of cols || []) {
    if (c?.id) map.set(c.id, c.title || '');
  }
  ctx._columnTitleMap = map;
  return map;
}

async function enrichTaskTitles(ctx, task) {
  if (!task) return task;
  const boardId = taskBoardId(task);
  const columnId = taskColumnId(task);
  if (boardId && !taskBoardTitle(task)) {
    const boards = await getBoardTitleMap(ctx);
    task.boardTitle = boards.get(boardId) || null;
  }
  if (columnId && !taskColumnTitle(task)) {
    const columns = await getColumnTitleMap(ctx);
    task.columnTitle = columns.get(columnId) || null;
  }
  return task;
}

/** Never mutate/search the automation launch card itself (avoids self-matching the recipe text). */
function isLaunchTask(ctx, taskId) {
  return Boolean(ctx.launchTaskId && taskId && String(taskId) === String(ctx.launchTaskId));
}

function isTaskInTrash(task) {
  return Boolean(task && (task.deleted_at || task.deletedAt));
}

function filterOutLaunchTaskIds(ctx, taskIds) {
  const ids = Array.isArray(taskIds) ? taskIds.filter(Boolean) : [];
  const filtered = ids.filter((id) => !isLaunchTask(ctx, id));
  const skippedLaunchTask = filtered.length < ids.length;
  return { taskIds: filtered, skippedLaunchTask };
}

function hashPlan(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function isDeniedTool(name) {
  if (!name || typeof name !== 'string') return true;
  if (name.startsWith('delete_')) return true;
  return AUTOMATION_CAPABILITIES.denied.includes(name);
}

async function publishTaskUpdated(ctx, taskId, boardId, changedFields = null) {
  const row = await taskQueries.getTaskById(ctx.db, taskId);
  const resolvedBoardId = boardId || taskBoardId(row);
  if (!row || !resolvedBoardId) return;

  // Minimal camelCase payload (same idea as PUT /tasks) — full getTaskWithRelationships
  // often exceeds PostgreSQL NOTIFY's 8KB limit and the shrink stub is ignored by the client.
  const task = {
    id: row.id,
    title: row.title,
    boardId: taskBoardId(row),
    columnId: taskColumnId(row),
    memberId: row.memberid ?? row.memberId ?? null,
    ticket: row.ticket ?? null,
    position: row.position ?? 0,
    sprintId: row.sprint_id ?? row.sprintId ?? null,
    priority: row.priority ?? null,
    priorityId: row.priority_id ?? row.priorityId ?? null,
    effort: row.effort,
    startDate: row.startdate ?? row.startDate ?? null,
    dueDate: row.duedate ?? row.dueDate ?? null,
    requesterId: row.requesterid ?? row.requesterId ?? null
  };

  if (changedFields && typeof changedFields === 'object') {
    if (Object.prototype.hasOwnProperty.call(changedFields, 'description')) {
      const desc = changedFields.description ?? row.description ?? '';
      if (Buffer.byteLength(String(desc), 'utf8') < 3500) {
        task.description = desc;
      }
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'title')) {
      task.title = changedFields.title;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'memberId')) {
      task.memberId = changedFields.memberId;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'sprintId')) {
      task.sprintId = changedFields.sprintId;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'priority')) {
      task.priority = changedFields.priority;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'priorityId')) {
      task.priorityId = changedFields.priorityId;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'effort')) {
      task.effort = changedFields.effort;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'startDate')) {
      task.startDate = changedFields.startDate;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'dueDate')) {
      task.dueDate = changedFields.dueDate;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'columnId')) {
      task.columnId = changedFields.columnId;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'previousColumnId')) {
      task.previousColumnId = changedFields.previousColumnId;
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'previousBoardId')) {
      task.previousBoardId = changedFields.previousBoardId;
    }
  }

  await notificationService.publish(
    'task-updated',
    {
      boardId: resolvedBoardId,
      task,
      timestamp: new Date().toISOString()
    },
    ctx.tenantId || null
  );
}

async function publishTaskCreated(ctx, taskId, boardId) {
  const row = await taskQueries.getTaskById(ctx.db, taskId);
  const resolvedBoardId = boardId || taskBoardId(row);
  if (!row || !resolvedBoardId) return;
  const task = {
    id: row.id,
    title: row.title,
    boardId: taskBoardId(row),
    columnId: taskColumnId(row),
    memberId: row.memberid ?? row.memberId ?? null,
    ticket: row.ticket ?? null,
    position: row.position ?? 0,
    sprintId: row.sprint_id ?? row.sprintId ?? null,
    priority: row.priority ?? null,
    priorityId: row.priority_id ?? row.priorityId ?? null,
    effort: row.effort,
    startDate: row.startdate ?? row.startDate ?? null,
    dueDate: row.duedate ?? row.dueDate ?? null,
    requesterId: row.requesterid ?? row.requesterId ?? null,
    description: Buffer.byteLength(String(row.description || ''), 'utf8') < 3500
      ? row.description || ''
      : undefined,
    comments: [],
    tags: [],
    watchers: [],
    collaborators: [],
    attachmentCount: 0
  };
  await notificationService.publish(
    'task-created',
    {
      boardId: resolvedBoardId,
      task,
      timestamp: new Date().toISOString()
    },
    ctx.tenantId || null
  );
}

export async function resolveAllowedBoardIds(ctx) {
  if (ctx.scopeType === AUTOMATION_SCOPE.ALL_BOARDS) {
    const all = await boardQueries.getAllBoards(ctx.db);
    return all.map((b) => b.id).filter(Boolean);
  }
  return Array.isArray(ctx.boardIds) ? ctx.boardIds.filter(Boolean) : [];
}

export function assertTaskInScope(ctx, task, allowedBoardIds) {
  const boardId = taskBoardId(task);
  if (!boardId || !allowedBoardIds.includes(boardId)) {
    throw new Error('Task is outside automation scope');
  }
}

function assertBoardInScope(boardId, allowedBoardIds) {
  if (!boardId || !allowedBoardIds.includes(boardId)) {
    throw new Error('Board is outside automation scope');
  }
}

async function journal(ctx, op, entityType, entityId, before, after) {
  const seq = await automationJournal.getNextSeq(ctx.db, ctx.jobId);
  await automationJournal.appendEntry(ctx.db, {
    id: crypto.randomUUID(),
    jobId: ctx.jobId,
    taskId: ctx.launchTaskId,
    seq,
    op,
    entityType,
    entityId,
    beforeJson: before ? JSON.stringify(before) : null,
    afterJson: after ? JSON.stringify(after) : null
  });
}

async function resolvePriority(ctx, fields) {
  let priorityId = fields.priorityId || null;
  let priorityName = fields.priority || null;

  if (!priorityId && priorityName) {
    const row = await helpers.getPriorityByName(ctx.db, priorityName);
    if (row) priorityId = row.id;
  }
  if (!priorityId) {
    const def = await helpers.getDefaultPriority(ctx.db);
    if (def) {
      priorityId = def.id;
      if (!priorityName) priorityName = def.priority;
    }
  } else if (!priorityName) {
    priorityName = await helpers.getPriorityNameById(ctx.db, priorityId);
  }

  return { priorityId, priorityName };
}

async function searchTasksInternal(ctx, args = {}, allowedBoardIds) {
  const limit = Math.min(
    Math.max(1, Number(args.limit) || AUTOMATION_MAX_TASKS_PER_APPLY),
    AUTOMATION_MAX_TASKS_PER_APPLY
  );
  const offset = Math.max(0, Number(args.offset) || 0);

  const conditions = [];
  const params = [];
  let idx = 1;

  const scopeIds =
    args.boardId && allowedBoardIds.includes(args.boardId)
      ? [args.boardId]
      : allowedBoardIds;

  if (!scopeIds.length) {
    return {
      tasks: [],
      count: 0,
      totalCount: 0,
      offset,
      limit,
      hasMore: false,
      excludedLaunchTask: false
    };
  }

  // Always exclude the automation recipe/launch task from discovery
  if (ctx.launchTaskId) {
    conditions.push(`t.id <> $${idx++}`);
    params.push(ctx.launchTaskId);
  }

  const scopePlaceholders = scopeIds.map(() => `$${idx++}`).join(', ');
  conditions.push(`t.boardid IN (${scopePlaceholders})`);
  params.push(...scopeIds);

  const trashOnly = args.trashOnly === true;
  const includeTrash = trashOnly || args.includeTrash === true;
  if (trashOnly) {
    conditions.push('t.deleted_at IS NOT NULL');
  } else if (!includeTrash) {
    conditions.push('t.deleted_at IS NULL');
  }

  if (args.sprintId) {
    conditions.push(`t.sprint_id = $${idx++}`);
    params.push(args.sprintId);
  }
  if (args.columnId) {
    conditions.push(`t.columnid = $${idx++}`);
    params.push(args.columnId);
  }
  if (args.assigneeId) {
    conditions.push(`t.memberid = $${idx++}`);
    params.push(args.assigneeId);
  }
  if (args.tagId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM task_tags tt WHERE tt.taskid = t.id AND tt.tagid = $${idx++})`
    );
    params.push(args.tagId);
  }
  if (args.text) {
    const pattern = `%${String(args.text).trim()}%`;
    conditions.push(
      `(LOWER(t.title) LIKE LOWER($${idx}) OR LOWER(REGEXP_REPLACE(COALESCE(t.description, ''), '<[^>]+>', '', 'g')) LIKE LOWER($${idx}))`
    );
    params.push(pattern);
    idx += 1;
  }

  const whereSql = conditions.join(' AND ');
  const countStmt = wrapQuery(
    ctx.db.prepare(`SELECT COUNT(*)::int AS n FROM tasks t WHERE ${whereSql}`),
    'SELECT'
  );
  const countRow = await countStmt.get(...params);
  const totalCount = countRow?.n || 0;

  const listParams = [...params, limit, offset];
  const query = `
    SELECT t.id, t.ticket, t.title, t.boardid, t.columnid, t.sprint_id, t.memberid, t.priority, t.description,
           t.deleted_at, b.title AS board_title, c.title AS column_title
    FROM tasks t
    LEFT JOIN boards b ON b.id = t.boardid
    LEFT JOIN columns c ON c.id = t.columnid
    WHERE ${whereSql}
    ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `;

  const stmt = wrapQuery(ctx.db.prepare(query), 'SELECT');
  const rows = await stmt.all(...listParams);

  // Previews are opt-in: default off so bulk assignee searches fit in the runner tool payload.
  const includeDescription = args.includeDescription === true;
  const tasks = rows.map((row) => compactTask(row, { includeDescription }));
  const hasMore = offset + tasks.length < totalCount;
  return {
    tasks,
    count: tasks.length,
    totalCount,
    offset,
    limit,
    hasMore,
    excludedLaunchTask: Boolean(ctx.launchTaskId),
    note: [
      hasMore
        ? `Paged results: ${offset + 1}–${offset + tasks.length} of ${totalCount}. Call search_tasks again with offset=${offset + tasks.length} until hasMore is false before planning bulk updates.`
        : `Complete result set (${totalCount} match${totalCount === 1 ? '' : 'es'}).`,
      ctx.launchTaskId
        ? 'The automation launch task itself is excluded from search results.'
        : null,
      'Use assigneeId (from list_members) for “assigned to X”, not text search on the name.',
      'Prefer boardTitle/columnTitle in human summaries; use boardId/columnId only in tool arguments.'
    ]
      .filter(Boolean)
      .join(' '),
    trash: trashOnly ? 'only' : includeTrash ? 'include' : 'exclude'
  };
}

async function toolListBoards(ctx, allowedBoardIds) {
  const boards = await boardQueries.getAllBoards(ctx.db);
  return boards
    .filter((b) => allowedBoardIds.includes(b.id))
    .map((b) => ({ id: b.id, title: b.title }));
}

async function toolListColumns(ctx, args, allowedBoardIds) {
  const { boardId } = args || {};
  if (!boardId) return { error: 'boardId is required' };
  assertBoardInScope(boardId, allowedBoardIds);
  const boards = await getBoardTitleMap(ctx);
  const boardTitle = boards.get(boardId) || null;
  const cols = await helpers.getColumnsForBoard(ctx.db, boardId);
  return cols.map((c) => ({
    id: c.id,
    title: c.title,
    boardId,
    boardTitle,
    is_finished: c.is_finished,
    is_archived: c.is_archived,
    position: c.position
  }));
}

async function toolGetTask(ctx, args, allowedBoardIds) {
  const { taskId } = args || {};
  if (!taskId) return { error: 'taskId is required' };
  if (isLaunchTask(ctx, taskId)) {
    return {
      error: 'Cannot inspect the automation launch task via get_task; it is excluded from automation targets',
      excludedLaunchTask: true
    };
  }
  const task = await taskQueries.getTaskById(ctx.db, taskId);
  if (!task) return { error: 'Task not found' };
  assertTaskInScope(ctx, task, allowedBoardIds);
  await enrichTaskTitles(ctx, task);
  return taskSnapshot(task);
}

async function toolGetTasks(ctx, args, allowedBoardIds) {
  const rawIds = Array.isArray(args?.taskIds) ? args.taskIds : [];
  if (!rawIds.length) return { error: 'taskIds array is required' };
  const { taskIds, skippedLaunchTask } = filterOutLaunchTaskIds(ctx, rawIds);
  if (!taskIds.length) {
    return {
      tasks: [],
      skippedLaunchTask: true,
      note: 'All requested ids were the automation launch task (excluded).'
    };
  }

  const tasks = [];
  const missing = [];
  for (const taskId of taskIds.slice(0, AUTOMATION_MAX_TASKS_PER_APPLY)) {
    const task = await taskQueries.getTaskById(ctx.db, taskId);
    if (!task) {
      missing.push(taskId);
      continue;
    }
    try {
      assertTaskInScope(ctx, task, allowedBoardIds);
      await enrichTaskTitles(ctx, task);
      tasks.push({
        ...taskSnapshot(task),
        descriptionPreview: stripHtml(task.description).slice(0, 500)
      });
    } catch {
      missing.push(taskId);
    }
  }
  return {
    tasks,
    missing,
    skippedLaunchTask: skippedLaunchTask || undefined,
    note: 'Prefer search_tasks (includes descriptionPreview + boardTitle) over many get_task calls.'
  };
}

async function toolCreateTask(ctx, args, { dryRun }, allowedBoardIds) {
  const {
    title,
    description,
    boardId,
    columnId,
    memberId,
    sprintId,
    priority,
    priorityId,
    effort,
    startDate,
    dueDate
  } = args || {};

  if (!title || !boardId || !columnId) {
    return { error: 'title, boardId, and columnId are required' };
  }
  if (String(title).length > TASK_TITLE_MAX_LENGTH) {
    return { error: `title must be at most ${TASK_TITLE_MAX_LENGTH} characters` };
  }
  if (description != null && String(description).length > TASK_DESCRIPTION_MAX_LENGTH) {
    return { error: `description must be at most ${TASK_DESCRIPTION_MAX_LENGTH} characters` };
  }
  assertBoardInScope(boardId, allowedBoardIds);

  const column = await helpers.getColumnById(ctx.db, columnId);
  if (!column || column.boardId !== boardId) {
    return { error: 'columnId does not belong to boardId' };
  }

  const taskId = crypto.randomUUID();
  const preview = {
    id: taskId,
    title,
    boardId,
    columnId,
    memberId: memberId || null,
    sprintId: sprintId || null
  };

  if (dryRun) {
    return { wouldAffect: [preview], dryRun: true };
  }

  const taskPrefix = (await helpers.getSetting(ctx.db, 'DEFAULT_TASK_PREFIX')) || 'TASK-';
  const ticket = await taskQueries.generateTaskTicket(ctx.db, taskPrefix);
  const { priorityId: resolvedPriorityId, priorityName } = await resolvePriority(ctx, {
    priority,
    priorityId
  });

  await taskQueries.incrementTaskPositions(ctx.db, columnId);
  await taskQueries.createTask(ctx.db, {
    id: taskId,
    title,
    description: description || '',
    ticket,
    memberId: memberId || null,
    startDate: startDate || null,
    dueDate: dueDate || startDate || null,
    effort: effort != null ? effort : 0,
    priority: priorityName,
    priorityId: resolvedPriorityId,
    columnId,
    boardId,
    position: 0,
    sprintId: sprintId || null
  });

  const created = await taskQueries.getTaskById(ctx.db, taskId);
  await journal(ctx, 'create_task', 'task', taskId, null, taskSnapshot(created));
  await publishTaskCreated(ctx, taskId, boardId);

  return { created: taskSnapshot(created) };
}

async function toolUpdateTasks(ctx, args, { dryRun }, allowedBoardIds) {
  const rawIds = args?.taskIds;
  if (!Array.isArray(rawIds) || !rawIds.length) {
    return { error: 'taskIds array is required' };
  }
  const { taskIds, skippedLaunchTask } = filterOutLaunchTaskIds(ctx, rawIds);
  if (!taskIds.length) {
    return {
      error: 'No mutable tasks after excluding the automation launch task',
      skippedLaunchTask: true
    };
  }
  const rawFields =
    args?.fields && typeof args.fields === 'object' && !Array.isArray(args.fields)
      ? args.fields
      : {};
  const fields = { ...rawFields };
  for (const key of [
    'memberId',
    'title',
    'description',
    'effort',
    'startDate',
    'dueDate',
    'sprintId',
    'priority',
    'priorityId'
  ]) {
    if (args[key] !== undefined && fields[key] === undefined) fields[key] = args[key];
  }
  if (!Object.keys(fields).length) {
    return { error: 'fields object is required (e.g. fields.memberId)' };
  }

  const updates = {};
  if (fields.title !== undefined) {
    if (String(fields.title).length > TASK_TITLE_MAX_LENGTH) {
      return { error: `title must be at most ${TASK_TITLE_MAX_LENGTH} characters` };
    }
    updates.title = fields.title;
  }
  if (fields.description !== undefined) {
    if (fields.description != null && String(fields.description).length > TASK_DESCRIPTION_MAX_LENGTH) {
      return { error: `description must be at most ${TASK_DESCRIPTION_MAX_LENGTH} characters` };
    }
    updates.description = fields.description;
  }
  if (fields.effort !== undefined) updates.effort = fields.effort;
  if (fields.startDate !== undefined) updates.startDate = fields.startDate;
  if (fields.dueDate !== undefined) updates.dueDate = fields.dueDate;
  if (fields.memberId !== undefined) updates.memberId = fields.memberId;
  if (fields.sprintId !== undefined) updates.sprintId = fields.sprintId;

  if (fields.priority !== undefined || fields.priorityId !== undefined) {
    const resolved = await resolvePriority(ctx, fields);
    if (resolved.priorityName) updates.priority = resolved.priorityName;
    if (resolved.priorityId) updates.priorityId = resolved.priorityId;
  }

  if (!Object.keys(updates).length) {
    return { error: 'No supported fields to update' };
  }

  const wouldAffect = [];
  const snapshots = [];
  for (const taskId of taskIds) {
    const before = await taskQueries.getTaskById(ctx.db, taskId);
    if (!before) return { error: `Task not found: ${taskId}` };
    assertTaskInScope(ctx, before, allowedBoardIds);
    if (isTaskInTrash(before)) {
      return {
        error: `Task ${taskId} is in trash — use restore_tasks first (or search with trashOnly:true)`,
        inTrash: true
      };
    }
    snapshots.push({ taskId, before: taskSnapshot(before) });
    wouldAffect.push({
      taskId,
      ticket: before.ticket,
      fields: updates
    });
  }

  if (dryRun) {
    return {
      wouldAffect,
      count: wouldAffect.length,
      dryRun: true,
      skippedLaunchTask: skippedLaunchTask || undefined
    };
  }

  const updatedIds = [];
  for (const item of snapshots) {
    await taskQueries.updateTask(ctx.db, item.taskId, updates);
    const after = await taskQueries.getTaskById(ctx.db, item.taskId);
    await journal(ctx, 'update_task', 'task', item.taskId, item.before, taskSnapshot(after));
    await publishTaskUpdated(ctx, item.taskId, taskBoardId(after), updates);
    updatedIds.push(item.taskId);
  }

  return { updated: updatedIds, skippedLaunchTask: skippedLaunchTask || undefined };
}

async function toolMoveTasks(ctx, args, { dryRun }, allowedBoardIds) {
  const rawIds = args?.taskIds;
  const { columnId, boardId: targetBoardIdArg } = args || {};
  if (!Array.isArray(rawIds) || !rawIds.length) {
    return { error: 'taskIds array is required' };
  }
  const { taskIds, skippedLaunchTask } = filterOutLaunchTaskIds(ctx, rawIds);
  if (!taskIds.length) {
    return {
      error: 'No mutable tasks after excluding the automation launch task',
      skippedLaunchTask: true
    };
  }
  if (!columnId) return { error: 'columnId is required' };

  const column = await helpers.getColumnById(ctx.db, columnId);
  if (!column) return { error: 'Column not found' };

  const targetBoardId = targetBoardIdArg || column.boardId;
  assertBoardInScope(targetBoardId, allowedBoardIds);

  if (column.boardId !== targetBoardId) {
    return { error: 'columnId does not belong to target board' };
  }

  const wouldAffect = [];
  for (const taskId of taskIds) {
    const task = await taskQueries.getTaskById(ctx.db, taskId);
    if (!task) return { error: `Task not found: ${taskId}` };
    assertTaskInScope(ctx, task, allowedBoardIds);
    if (isTaskInTrash(task)) {
      return {
        error: `Task ${taskId} is in trash — use restore_tasks first (or search with trashOnly:true)`,
        inTrash: true
      };
    }

    const taskBoard = taskBoardId(task);
    if (taskBoard !== targetBoardId && taskBoard !== column.boardId) {
      return { error: `Task ${taskId} board does not match target column board` };
    }

    wouldAffect.push({
      taskId,
      before: taskSnapshot(task),
      columnId,
      boardId: targetBoardId
    });
  }

  if (dryRun) {
    return { wouldAffect, dryRun: true, skippedLaunchTask: skippedLaunchTask || undefined };
  }

  const columnTasks = await taskQueries.getTasksForColumnBasic(ctx.db, columnId);
  let nextPos = columnTasks.length;

  for (const item of wouldAffect) {
    const before = item.before;
    const prevBoard = before.boardId;
    const prevColumn = before.columnId;
    const crossBoard = prevBoard !== targetBoardId;

    if (crossBoard) {
      await taskQueries.deleteAllRelationshipsInvolvingTask(ctx.db, item.taskId);
    }

    await taskQueries.updateTaskPositionAndColumn(
      ctx.db,
      item.taskId,
      nextPos++,
      columnId,
      prevBoard,
      prevColumn,
      crossBoard ? targetBoardId : null
    );

    const after = await taskQueries.getTaskById(ctx.db, item.taskId);
    await journal(ctx, 'move_task', 'task', item.taskId, before, taskSnapshot(after));
    await publishTaskUpdated(ctx, item.taskId, targetBoardId, {
      columnId,
      previousColumnId: prevColumn,
      previousBoardId: crossBoard ? prevBoard : undefined,
      position: after?.position
    });
  }

  return { moved: wouldAffect.map((w) => w.taskId), skippedLaunchTask: skippedLaunchTask || undefined };
}

async function toolRestoreTasks(ctx, args, { dryRun }, allowedBoardIds) {
  const rawIds = args?.taskIds;
  if (!Array.isArray(rawIds) || !rawIds.length) {
    return { error: 'taskIds array is required' };
  }
  const { taskIds, skippedLaunchTask } = filterOutLaunchTaskIds(ctx, rawIds);
  if (!taskIds.length) {
    return {
      error: 'No restorable tasks after excluding the automation launch task',
      skippedLaunchTask: true
    };
  }

  const wouldAffect = [];
  const skippedLive = [];
  for (const taskId of taskIds) {
    const task = await taskQueries.getTaskById(ctx.db, taskId);
    if (!task) return { error: `Task not found: ${taskId}` };
    assertTaskInScope(ctx, task, allowedBoardIds);
    if (!isTaskInTrash(task)) {
      skippedLive.push(taskId);
      continue;
    }

    const boardId = taskBoardId(task);
    const board = await boardQueries.getBoardById(ctx.db, boardId);
    if (!board || board.deleted_at || board.deletedAt) {
      return {
        error: `Restore the board before restoring task ${taskId}`,
        code: 'board_soft_deleted'
      };
    }

    const originalColumnId = taskColumnId(task);
    const boardColumns = await helpers.getColumnsForBoard(ctx.db, boardId);
    let columnId = originalColumnId;
    const colOnBoard = (boardColumns || []).find((c) => c.id === columnId);
    if (!colOnBoard) {
      const fallback = (boardColumns || []).find(
        (c) => !(c.is_archived === true || c.is_archived === 1)
      );
      if (!fallback) {
        return { error: `No column available to restore task ${taskId}` };
      }
      columnId = fallback.id;
    }

    wouldAffect.push({
      taskId,
      boardId,
      columnId,
      originalPosition: Number(task.position),
      before: taskSnapshot(task)
    });
  }

  if (!wouldAffect.length) {
    return {
      restored: [],
      skippedLive,
      skippedLaunchTask: skippedLaunchTask || undefined,
      note: 'No tasks were in trash'
    };
  }

  if (dryRun) {
    return {
      wouldAffect: wouldAffect.map((w) => ({
        taskId: w.taskId,
        boardId: w.boardId,
        columnId: w.columnId
      })),
      skippedLive,
      dryRun: true,
      skippedLaunchTask: skippedLaunchTask || undefined
    };
  }

  const restoredIds = [];
  for (const item of wouldAffect) {
    const origPos = Number.isFinite(item.originalPosition) ? item.originalPosition : NaN;
    let position = origPos;
    if (Number.isFinite(origPos) && origPos >= 0) {
      await taskQueries.shiftLiveTasksFromPosition(ctx.db, item.columnId, origPos);
    } else {
      const maxPos = await taskQueries.getMaxLivePositionInColumn(ctx.db, item.columnId);
      position = maxPos + 1;
    }
    const restored = await taskQueries.restoreTask(
      ctx.db,
      item.taskId,
      item.columnId,
      item.boardId,
      position
    );
    if (!restored) continue;
    await enrichTaskTitles(ctx, restored);
    await journal(ctx, 'restore_task', 'task', item.taskId, item.before, taskSnapshot(restored));
    await notificationService.publish(
      'task-restored',
      {
        boardId: item.boardId,
        task: restored,
        timestamp: new Date().toISOString()
      },
      ctx.tenantId || null
    );
    restoredIds.push(item.taskId);
  }

  return {
    restored: restoredIds,
    skippedLive,
    skippedLaunchTask: skippedLaunchTask || undefined
  };
}

async function toolCreateSprint(ctx, args, { dryRun }) {
  const { name, startDate, endDate, isActive, description } = args || {};
  if (!name || !startDate || !endDate) {
    return { error: 'name, startDate, and endDate are required' };
  }

  const sprintId = crypto.randomUUID();
  const preview = { id: sprintId, name, startDate, endDate, isActive: !!isActive, description };

  if (dryRun) {
    return { wouldAffect: [preview], dryRun: true };
  }

  if (isActive) {
    await sprintQueries.deactivateAllSprints(ctx.db);
  }

  const created = await sprintQueries.createSprint(
    ctx.db,
    sprintId,
    name,
    startDate,
    endDate,
    !!isActive,
    description || null
  );

  await journal(ctx, 'create_sprint', 'sprint', sprintId, null, created);
  return { sprint: created };
}

async function toolUpdateSprint(ctx, args, { dryRun }) {
  const { sprintId, name, startDate, endDate, isActive, description } = args || {};
  if (!sprintId) return { error: 'sprintId is required' };

  const before = await sprintQueries.getSprintById(ctx.db, sprintId);
  if (!before) return { error: 'Sprint not found' };

  if (dryRun) {
    return {
      wouldAffect: [{ sprintId, before, after: { name, startDate, endDate, isActive, description } }],
      dryRun: true
    };
  }

  if (isActive) {
    await sprintQueries.deactivateAllSprintsExcept(ctx.db, sprintId);
  }

  const updated = await sprintQueries.updateSprint(
    ctx.db,
    sprintId,
    name ?? before.name,
    startDate ?? before.start_date,
    endDate ?? before.end_date,
    isActive != null ? !!isActive : before.is_active,
    description !== undefined ? description : before.description
  );

  await journal(ctx, 'update_sprint', 'sprint', sprintId, before, updated);
  return { sprint: updated };
}

async function toolSetTaskSprint(ctx, args, { dryRun }, allowedBoardIds) {
  const rawIds = args?.taskIds;
  const { sprintId } = args || {};
  if (!Array.isArray(rawIds) || !rawIds.length) {
    return { error: 'taskIds array is required' };
  }
  const { taskIds, skippedLaunchTask } = filterOutLaunchTaskIds(ctx, rawIds);
  if (!taskIds.length) {
    return {
      error: 'No mutable tasks after excluding the automation launch task',
      skippedLaunchTask: true
    };
  }

  if (sprintId) {
    const sprint = await sprintQueries.getSprintById(ctx.db, sprintId);
    if (!sprint) return { error: 'Sprint not found' };
  }

  const wouldAffect = [];
  for (const taskId of taskIds) {
    const before = await taskQueries.getTaskById(ctx.db, taskId);
    if (!before) return { error: `Task not found: ${taskId}` };
    assertTaskInScope(ctx, before, allowedBoardIds);
    wouldAffect.push({ taskId, before: taskSnapshot(before), sprintId: sprintId || null });
  }

  if (dryRun) {
    return { wouldAffect, dryRun: true, skippedLaunchTask: skippedLaunchTask || undefined };
  }

  for (const item of wouldAffect) {
    await taskQueries.updateTask(ctx.db, item.taskId, { sprintId: item.sprintId });
    const after = await taskQueries.getTaskById(ctx.db, item.taskId);
    await journal(ctx, 'set_task_sprint', 'task', item.taskId, item.before, taskSnapshot(after));
    await publishTaskUpdated(ctx, item.taskId, taskBoardId(after));
  }

  return { updated: wouldAffect.map((w) => w.taskId), skippedLaunchTask: skippedLaunchTask || undefined };
}

async function toolCreateColumn(ctx, args, { dryRun }, allowedBoardIds) {
  const { boardId, title, position, isFinished, isArchived } = args || {};
  if (!boardId || !title) return { error: 'boardId and title are required' };
  assertBoardInScope(boardId, allowedBoardIds);

  const columnId = crypto.randomUUID();
  const maxPos = await helpers.getMaxColumnPosition(ctx.db, boardId);
  const insertPosition =
    position != null && !Number.isNaN(Number(position))
      ? Math.max(0, Math.ceil(Number(position)))
      : maxPos + 1;

  if (dryRun) {
    return {
      wouldAffect: [{ id: columnId, boardId, title, position: insertPosition }],
      dryRun: true
    };
  }

  if (maxPos >= insertPosition) {
    await helpers.shiftColumnPositions(ctx.db, boardId, insertPosition, maxPos, 1, null);
  }

  await helpers.createColumn(
    ctx.db,
    columnId,
    title,
    boardId,
    insertPosition,
    !!isFinished,
    !!isArchived
  );
  const allColumns = await helpers.renumberBoardColumnPositions(ctx.db, boardId);
  const created = allColumns.find((c) => c.id === columnId);

  await journal(ctx, 'create_column', 'column', columnId, null, created);
  await notificationService.publish(
    'column-created',
    { boardId, column: created, columns: allColumns, timestamp: new Date().toISOString() },
    ctx.tenantId || null
  );

  return { column: created };
}

async function toolRenameColumn(ctx, args, { dryRun }, allowedBoardIds) {
  const { columnId, title } = args || {};
  if (!columnId || !title) return { error: 'columnId and title are required' };

  const before = await helpers.getColumnById(ctx.db, columnId);
  if (!before) return { error: 'Column not found' };
  assertBoardInScope(before.boardId, allowedBoardIds);

  if (dryRun) {
    return { wouldAffect: [{ columnId, before, after: { title } }], dryRun: true };
  }

  await helpers.updateColumn(
    ctx.db,
    columnId,
    title,
    before.is_finished,
    before.is_archived
  );
  const after = await helpers.getColumnById(ctx.db, columnId);
  await journal(ctx, 'rename_column', 'column', columnId, before, after);

  await notificationService.publish(
    'column-updated',
    { boardId: before.boardId, column: after, timestamp: new Date().toISOString() },
    ctx.tenantId || null
  );

  return { column: after };
}

async function toolReorderColumns(ctx, args, { dryRun }, allowedBoardIds) {
  const { boardId, columnIds } = args || {};
  if (!boardId || !Array.isArray(columnIds) || !columnIds.length) {
    return { error: 'boardId and columnIds array are required' };
  }
  assertBoardInScope(boardId, allowedBoardIds);

  const existing = await helpers.getAllColumnsForBoard(ctx.db, boardId);
  const existingIds = new Set(existing.map((c) => c.id));
  if (columnIds.some((id) => !existingIds.has(id))) {
    return { error: 'columnIds must all belong to boardId' };
  }

  if (dryRun) {
    return { wouldAffect: [{ boardId, columnIds }], dryRun: true };
  }

  const before = existing;
  for (let i = 0; i < columnIds.length; i += 1) {
    await helpers.updateColumnPosition(ctx.db, columnIds[i], i);
  }
  const after = await helpers.renumberBoardColumnPositions(ctx.db, boardId);

  await journal(ctx, 'reorder_columns', 'board', boardId, before, after);
  await notificationService.publish(
    'column-reordered',
    { boardId, columns: after, timestamp: new Date().toISOString() },
    ctx.tenantId || null
  );

  return { columns: after };
}

async function toolCreateBoard(ctx, args, { dryRun }) {
  const { title } = args || {};
  if (!title) return { error: 'title is required' };

  const boardId = crypto.randomUUID();
  if (dryRun) {
    return { wouldAffect: [{ id: boardId, title }], dryRun: true };
  }

  const existing = await boardQueries.getBoardByTitle(ctx.db, title);
  if (existing) return { error: 'Board title already exists' };

  const projectPrefix = await boardQueries.getProjectPrefix(ctx.db);
  const project = await boardQueries.generateProjectIdentifier(ctx.db, projectPrefix);
  const maxPosition = await boardQueries.getMaxBoardPosition(ctx.db);
  await boardQueries.createBoard(ctx.db, boardId, title, project, maxPosition + 1);

  const defaultColumns = await getDefaultBoardColumns(ctx.db);
  for (let i = 0; i < defaultColumns.length; i += 1) {
    const col = defaultColumns[i];
    const colId = `${col.id}-${boardId}`;
    await helpers.createColumn(
      ctx.db,
      colId,
      col.title,
      boardId,
      i,
      !!col.isFinished,
      !!col.isArchived
    );
  }

  const board = await boardQueries.getBoardById(ctx.db, boardId);
  await journal(ctx, 'create_board', 'board', boardId, null, board);

  await notificationService.publish(
    'board-created',
    { boardId, board, timestamp: new Date().toISOString() },
    ctx.tenantId || null
  );

  return { board };
}

async function toolRenameBoard(ctx, args, { dryRun }, allowedBoardIds) {
  const { boardId, title } = args || {};
  if (!boardId || !title) return { error: 'boardId and title are required' };
  assertBoardInScope(boardId, allowedBoardIds);

  const before = await boardQueries.getBoardById(ctx.db, boardId);
  if (!before) return { error: 'Board not found' };

  if (dryRun) {
    return { wouldAffect: [{ boardId, before, after: { title } }], dryRun: true };
  }

  const dup = await boardQueries.getBoardByTitle(ctx.db, title, boardId);
  if (dup) return { error: 'Board title already exists' };

  await boardQueries.updateBoard(ctx.db, boardId, title);
  const after = await boardQueries.getBoardById(ctx.db, boardId);
  await journal(ctx, 'rename_board', 'board', boardId, before, after);

  await notificationService.publish(
    'board-updated',
    { boardId, board: after, timestamp: new Date().toISOString() },
    ctx.tenantId || null
  );

  return { board: after };
}

async function toolAddComment(ctx, args, { dryRun }, allowedBoardIds) {
  const { taskId, text } = args || {};
  if (!taskId || !text) return { error: 'taskId and text are required' };
  if (isLaunchTask(ctx, taskId)) {
    return {
      error: 'Cannot comment on the automation launch task via tools; use finish for the summary',
      skippedLaunchTask: true
    };
  }

  const task = await taskQueries.getTaskById(ctx.db, taskId);
  if (!task) return { error: 'Task not found' };
  assertTaskInScope(ctx, task, allowedBoardIds);

  const commentId = crypto.randomUUID();
  if (dryRun) {
    return { wouldAffect: [{ commentId, taskId, text }], dryRun: true };
  }

  const createdAt = new Date().toISOString();
  await commentQueries.createComment(
    ctx.db,
    commentId,
    taskId,
    String(text),
    AGENT_MEMBER_ID,
    createdAt
  );

  const comment = await commentQueries.getCommentById(ctx.db, commentId);
  await journal(ctx, 'add_comment', 'comment', commentId, null, comment);

  await notificationService.publish(
    'comment-created',
    {
      comment,
      taskId,
      boardId: taskBoardId(task),
      timestamp: createdAt
    },
    ctx.tenantId || null
  );

  return { comment };
}

async function toolLinkTasks(ctx, args, { dryRun }, allowedBoardIds) {
  const { taskId, toTaskId, relationship } = args || {};
  if (!taskId || !toTaskId || !relationship) {
    return { error: 'taskId, toTaskId, and relationship are required' };
  }
  if (isLaunchTask(ctx, taskId) || isLaunchTask(ctx, toTaskId)) {
    return {
      error: 'Cannot link the automation launch task',
      skippedLaunchTask: true
    };
  }
  if (!['child', 'parent', 'related'].includes(relationship)) {
    return { error: 'Invalid relationship type' };
  }
  if (taskId === toTaskId) return { error: 'Cannot link task to itself' };

  const source = await taskQueries.getTaskById(ctx.db, taskId);
  const target = await taskQueries.getTaskById(ctx.db, toTaskId);
  if (!source || !target) return { error: 'Task not found' };
  assertTaskInScope(ctx, source, allowedBoardIds);
  assertTaskInScope(ctx, target, allowedBoardIds);

  const existing = await taskQueries.getTaskRelationship(ctx.db, taskId, relationship, toTaskId);
  if (existing) return { error: 'Relationship already exists' };

  if (dryRun) {
    return { wouldAffect: [{ taskId, toTaskId, relationship }], dryRun: true };
  }

  const result = await taskQueries.createTaskRelationship(ctx.db, taskId, relationship, toTaskId);
  const relId = result?.id || result?.lastInsertRowid;

  if (relationship === 'parent') {
    const inverse = await taskQueries.getTaskRelationship(ctx.db, toTaskId, 'child', taskId);
    if (!inverse) {
      await taskQueries.createTaskRelationship(ctx.db, toTaskId, 'child', taskId);
    }
  } else if (relationship === 'child') {
    const inverse = await taskQueries.getTaskRelationship(ctx.db, toTaskId, 'parent', taskId);
    if (!inverse) {
      await taskQueries.createTaskRelationship(ctx.db, toTaskId, 'parent', taskId);
    }
  } else if (relationship === 'related') {
    const inverse = await taskQueries.getTaskRelationship(ctx.db, toTaskId, 'related', taskId);
    if (!inverse) {
      await taskQueries.createTaskRelationship(ctx.db, toTaskId, 'related', taskId);
    }
  }

  await journal(ctx, 'link_task', 'task_rel', String(relId || `${taskId}:${relationship}:${toTaskId}`), null, {
    taskId,
    toTaskId,
    relationship
  });

  await notificationService.publish(
    'task-relationship-created',
    { taskId, toTaskId, relationship, timestamp: new Date().toISOString() },
    ctx.tenantId || null
  );

  return { ok: true, taskId, toTaskId, relationship };
}

async function toolUnlinkTasks(ctx, args, { dryRun }, allowedBoardIds) {
  const { taskId, toTaskId, relationship } = args || {};
  if (!taskId || !toTaskId || !relationship) {
    return { error: 'taskId, toTaskId, and relationship are required' };
  }
  if (isLaunchTask(ctx, taskId) || isLaunchTask(ctx, toTaskId)) {
    return {
      error: 'Cannot unlink involving the automation launch task',
      skippedLaunchTask: true
    };
  }

  const source = await taskQueries.getTaskById(ctx.db, taskId);
  if (!source) return { error: 'Task not found' };
  assertTaskInScope(ctx, source, allowedBoardIds);

  const rel = await taskQueries.getTaskRelationship(ctx.db, taskId, relationship, toTaskId);
  if (!rel) return { error: 'Relationship not found' };

  if (dryRun) {
    return { wouldAffect: [{ relationshipId: rel.id, taskId, toTaskId, relationship }], dryRun: true };
  }

  const before = { id: rel.id, taskId, toTaskId, relationship };
  await taskQueries.deleteTaskRelationship(ctx.db, rel.id);

  if (relationship === 'parent') {
    const inverse = await taskQueries.getTaskRelationship(ctx.db, toTaskId, 'child', taskId);
    if (inverse) await taskQueries.deleteTaskRelationship(ctx.db, inverse.id);
  } else if (relationship === 'child') {
    const inverse = await taskQueries.getTaskRelationship(ctx.db, toTaskId, 'parent', taskId);
    if (inverse) await taskQueries.deleteTaskRelationship(ctx.db, inverse.id);
  }

  await journal(ctx, 'unlink_task', 'task_rel', rel.id, before, null);
  return { ok: true, removed: rel.id };
}

async function toolCreateTag(ctx, args, { dryRun }) {
  const { tag, description, color } = args || {};
  if (!tag) return { error: 'tag name is required' };

  if (dryRun) {
    return { wouldAffect: [{ tag, description, color }], dryRun: true };
  }

  const result = await tagQueries.createTag(ctx.db, tag, description || '', color || '#4F46E5');
  const created = result?.rows?.[0] || (await tagQueries.getTagById(ctx.db, result?.lastInsertRowid));
  const row = created || { tag, description, color };
  const tagId = row.id || result?.lastInsertRowid;
  await journal(ctx, 'create_tag', 'tag', String(tagId), null, row);
  return { tag: row };
}

async function toolAssignTags(ctx, args, { dryRun }, allowedBoardIds) {
  const { taskId, tagIds, removeTagIds } = args || {};
  if (!taskId || (!Array.isArray(tagIds) && !Array.isArray(removeTagIds))) {
    return { error: 'taskId and tagIds or removeTagIds are required' };
  }
  if (isLaunchTask(ctx, taskId)) {
    return {
      error: 'Cannot tag the automation launch task',
      skippedLaunchTask: true
    };
  }

  const task = await taskQueries.getTaskById(ctx.db, taskId);
  if (!task) return { error: 'Task not found' };
  assertTaskInScope(ctx, task, allowedBoardIds);

  const beforeTags = await helpers.getTagsForTask(ctx.db, taskId);
  if (dryRun) {
    return {
      wouldAffect: [{ taskId, add: tagIds || [], remove: removeTagIds || [] }],
      dryRun: true
    };
  }

  if (Array.isArray(removeTagIds)) {
    for (const tagId of removeTagIds) {
      await helpers.removeTagFromTask(ctx.db, taskId, tagId);
    }
  }
  if (Array.isArray(tagIds)) {
    for (const tagId of tagIds) {
      const exists = await helpers.checkTagAssociation(ctx.db, taskId, tagId);
      if (!exists) {
        await helpers.addTagToTask(ctx.db, taskId, tagId);
      }
    }
  }

  const afterTags = await helpers.getTagsForTask(ctx.db, taskId);
  await journal(ctx, 'assign_tag', 'task', taskId, beforeTags, afterTags);
  await publishTaskUpdated(ctx, taskId, taskBoardId(task));
  return { tags: afterTags };
}

async function toolCreatePriority(ctx, args, { dryRun }) {
  const { priority, color } = args || {};
  if (!priority) return { error: 'priority name is required' };

  if (dryRun) {
    return { wouldAffect: [{ priority, color }], dryRun: true };
  }

  const maxPos = await priorityQueries.getMaxPriorityPosition(ctx.db);
  const created = await priorityQueries.createPriority(
    ctx.db,
    priority,
    color || '#6B7280',
    maxPos + 1
  );
  await journal(ctx, 'create_priority', 'priority', String(created.id), null, created);
  return { priority: created };
}

async function buildExportRows(ctx, args, allowedBoardIds) {
  const search = await searchTasksInternal(
    ctx,
    { ...args, limit: AUTOMATION_MAX_TASKS_PER_APPLY },
    allowedBoardIds
  );
  const tasks = search.tasks || [];
  const rows = [];
  for (const t of tasks) {
    const full = await taskQueries.getTaskById(ctx.db, t.id);
    rows.push({
      ticket: full?.ticket || '',
      title: full?.title || '',
      boardId: taskBoardId(full),
      columnId: taskColumnId(full),
      sprintId: full?.sprint_id || full?.sprintId || '',
      memberId: full?.memberid || full?.memberId || '',
      priority: full?.priority || '',
      effort: full?.effort ?? '',
      startDate: full?.startdate || full?.startDate || '',
      dueDate: full?.duedate || full?.dueDate || '',
      description: stripHtml(full?.description || '')
    });
  }
  return rows;
}

async function toolExportTasks(ctx, args, { dryRun }, allowedBoardIds, format) {
  const rows = await buildExportRows(ctx, args, allowedBoardIds);
  if (dryRun) {
    return { wouldExport: rows.length, format, dryRun: true };
  }

  const attachmentsDir = getAttachmentsDir(ctx.tenantId || null);
  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'xlsx' ? 'xlsx' : 'csv';
  const filename = `automation-export-${ctx.jobId.slice(0, 8)}-${stamp}.${ext}`;
  const filePath = path.join(attachmentsDir, filename);

  let buffer;
  let mimeType;
  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tasks');
    const keys = Object.keys(rows[0] || { ticket: '' });
    ws.columns = keys.map((key) => ({ header: key, key, width: 18 }));
    for (const row of rows) {
      ws.addRow(row);
    }
    buffer = Buffer.from(await wb.xlsx.writeBuffer());
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    const header = Object.keys(rows[0] || { ticket: '' }).join(',');
    const body = rows
      .map((row) =>
        Object.values(row)
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    buffer = Buffer.from(`${header}\n${body}`, 'utf8');
    mimeType = 'text/csv';
  }

  fs.writeFileSync(filePath, buffer);

  try {
    const { commitUploadedFile } = await import('./storage/index.js');
    await commitUploadedFile(
      ctx.db,
      { attachments: attachmentsDir, avatars: null },
      'attachments',
      { filename, path: filePath, mimetype: mimeType }
    );
  } catch (err) {
    console.warn('⚠️ Automation export S3 commit failed (file kept on disk):', err.message);
  }

  const attachmentId = crypto.randomUUID();
  const url = `/attachments/${filename}`;
  await fileQueries.createAttachmentForTask(
    ctx.db,
    attachmentId,
    ctx.launchTaskId,
    filename,
    url,
    mimeType,
    buffer.length
  );
  await updateStorageUsage(ctx.db);

  const attachment = { id: attachmentId, name: filename, url, type: mimeType, size: buffer.length };
  await journal(ctx, 'attach_file', 'attachment', attachmentId, null, attachment);
  await publishTaskUpdated(ctx, ctx.launchTaskId, taskBoardId(await taskQueries.getTaskById(ctx.db, ctx.launchTaskId)));

  return { attachment, rowCount: rows.length, format };
}

async function toolSubmitDryRunPlan(ctx, args) {
  const { summary, operations } = args || {};
  if (!summary || !Array.isArray(operations)) {
    return { error: 'summary and operations array are required' };
  }

  const ops = operations.filter((op) => op && (op.name || op.tool));
  const plan = {
    summary,
    operations: ops,
    submittedAt: new Date().toISOString(),
    empty: ops.length === 0
  };

  // Nothing to mutate — store summary for audit, skip Apply gate
  if (ops.length === 0) {
    await taskWorkQueries.upsertWorkEntries(ctx.db, ctx.launchTaskId, {
      automation_pending_plan: JSON.stringify(plan),
      automation_plan_hash: hashPlan(plan),
      awaiting_apply: '',
      control: 'none'
      // leave status as-is (runner will finish)
    });
    return {
      ok: true,
      awaitingApply: false,
      emptyPlan: true,
      message: 'No operations to apply — call finish with this summary.'
    };
  }

  await taskWorkQueries.upsertWorkEntries(ctx.db, ctx.launchTaskId, {
    automation_pending_plan: JSON.stringify(plan),
    automation_plan_hash: hashPlan(plan),
    awaiting_apply: 'true',
    status: 'waiting'
  });

  return { ok: true, awaitingApply: true, emptyPlan: false };
}

async function toolFinish(ctx, args) {
  const { summary, matched, changed, skipped, errors } = args || {};
  if (!summary) return { error: 'summary is required' };

  const result = { summary, matched, changed, skipped, errors, finishedAt: new Date().toISOString() };
  await taskWorkQueries.upsertWorkEntries(ctx.db, ctx.launchTaskId, {
    automation_result: JSON.stringify(result),
    awaiting_apply: 'false'
  });

  return { summary };
}

export async function executeTool(ctx, name, args = {}, { dryRun = false } = {}) {
  if (isDeniedTool(name)) {
    return {
      error: `Cannot ${name.replace(/_/g, ' ')} for security reasons`,
      denied: true
    };
  }

  if (!AUTOMATION_CAPABILITIES.allowed.includes(name)) {
    return { error: 'Unknown tool' };
  }

  try {
    const allowedBoardIds = await resolveAllowedBoardIds(ctx);
    const opts = { dryRun };

    switch (name) {
      case 'list_capabilities':
        return AUTOMATION_CAPABILITIES;
      case 'list_boards':
        return await toolListBoards(ctx, allowedBoardIds);
      case 'list_columns':
        return await toolListColumns(ctx, args, allowedBoardIds);
      case 'list_sprints': {
        const sprints = await sprintQueries.getAllSprints(ctx.db);
        return sprints.map((s) => ({
          id: s.id,
          name: s.name,
          start_date: s.start_date,
          end_date: s.end_date,
          is_active: s.is_active,
          description: s.description
        }));
      }
      case 'list_members': {
        const members = await memberQueries.getAllMembers(ctx.db, {
          includeSystem: false,
          includeAgent: false
        });
        return members.map((m) => ({ id: m.id, name: m.name, color: m.color }));
      }
      case 'list_tags': {
        const tags = await tagQueries.getAllTags(ctx.db);
        return tags.map((t) => ({ id: t.id, tag: t.tag, color: t.color }));
      }
      case 'list_priorities': {
        const priorities = await priorityQueries.getAllPriorities(ctx.db);
        return priorities.map((p) => ({ id: p.id, priority: p.priority, color: p.color }));
      }
      case 'get_task':
        return await toolGetTask(ctx, args, allowedBoardIds);
      case 'get_tasks':
        return await toolGetTasks(ctx, args, allowedBoardIds);
      case 'search_tasks':
        return await searchTasksInternal(ctx, args, allowedBoardIds);
      case 'create_task':
        return await toolCreateTask(ctx, args, opts, allowedBoardIds);
      case 'update_tasks':
        return await toolUpdateTasks(ctx, args, opts, allowedBoardIds);
      case 'move_tasks':
        return await toolMoveTasks(ctx, args, opts, allowedBoardIds);
      case 'restore_tasks':
        return await toolRestoreTasks(ctx, args, opts, allowedBoardIds);
      case 'create_sprint':
        return await toolCreateSprint(ctx, args, opts);
      case 'update_sprint':
        return await toolUpdateSprint(ctx, args, opts);
      case 'set_task_sprint':
        return await toolSetTaskSprint(ctx, args, opts, allowedBoardIds);
      case 'create_column':
        return await toolCreateColumn(ctx, args, opts, allowedBoardIds);
      case 'rename_column':
        return await toolRenameColumn(ctx, args, opts, allowedBoardIds);
      case 'reorder_columns':
        return await toolReorderColumns(ctx, args, opts, allowedBoardIds);
      case 'create_board':
        return await toolCreateBoard(ctx, args, opts);
      case 'rename_board':
        return await toolRenameBoard(ctx, args, opts, allowedBoardIds);
      case 'add_comment':
        return await toolAddComment(ctx, args, opts, allowedBoardIds);
      case 'link_tasks':
        return await toolLinkTasks(ctx, args, opts, allowedBoardIds);
      case 'unlink_tasks':
        return await toolUnlinkTasks(ctx, args, opts, allowedBoardIds);
      case 'create_tag':
        return await toolCreateTag(ctx, args, opts);
      case 'assign_tags':
        return await toolAssignTags(ctx, args, opts, allowedBoardIds);
      case 'create_priority':
        return await toolCreatePriority(ctx, args, opts);
      case 'export_tasks_xlsx':
        return await toolExportTasks(ctx, args, opts, allowedBoardIds, 'xlsx');
      case 'export_tasks_csv':
        return await toolExportTasks(ctx, args, opts, allowedBoardIds, 'csv');
      case 'submit_dry_run_plan':
        return await toolSubmitDryRunPlan(ctx, args);
      case 'finish':
        return await toolFinish(ctx, args);
      default:
        return { error: 'Unknown tool' };
    }
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

async function reverseJournalEntry(ctx, entry) {
  const op = entry.op;
  const entityId = entry.entity_id;
  let before = null;
  let after = null;
  try {
    before = entry.before_json ? JSON.parse(entry.before_json) : null;
    after = entry.after_json ? JSON.parse(entry.after_json) : null;
  } catch {
    /* ignore parse errors */
  }

  switch (op) {
    case 'update_task':
    case 'set_task_sprint':
      if (before) {
        const updates = {};
        for (const key of [
          'title',
          'description',
          'effort',
          'startDate',
          'dueDate',
          'memberId',
          'sprintId',
          'priority',
          'priorityId'
        ]) {
          if (before[key] !== undefined) updates[key] = before[key];
        }
        if (Object.keys(updates).length) {
          await taskQueries.updateTask(ctx.db, entityId, updates);
          await publishTaskUpdated(ctx, entityId, before.boardId);
        }
      }
      break;
    case 'move_task':
      if (before) {
        await taskQueries.updateTaskPositionAndColumn(
          ctx.db,
          entityId,
          before.position ?? 0,
          before.columnId,
          before.boardId,
          after?.columnId || before.columnId,
          before.boardId !== (after?.boardId || before.boardId) ? before.boardId : null
        );
        await publishTaskUpdated(ctx, entityId, before.boardId);
      }
      break;
    case 'restore_task':
      await taskQueries.softDeleteTask(ctx.db, entityId, ctx.userId || 'system');
      break;
    case 'create_task':
      await taskQueries.deleteTask(ctx.db, entityId);
      break;
    case 'create_sprint':
      await sprintQueries.deleteSprint(ctx.db, entityId);
      break;
    case 'create_column':
      await helpers.deleteColumn(ctx.db, entityId);
      break;
    case 'create_board':
      await boardQueries.deleteBoard(ctx.db, entityId);
      break;
    case 'create_tag':
      await tagQueries.deleteTagAssociations(ctx.db, entityId);
      await tagQueries.deleteTag(ctx.db, entityId);
      break;
    case 'create_priority':
      await priorityQueries.deletePriority(ctx.db, entityId);
      break;
    case 'add_comment':
      await commentQueries.deleteComment(ctx.db, entityId);
      break;
    case 'rename_column':
      if (before?.title != null) {
        await helpers.updateColumn(
          ctx.db,
          entityId,
          before.title,
          before.is_finished,
          before.is_archived
        );
      }
      break;
    case 'rename_board':
      if (before?.title) {
        await boardQueries.updateBoard(ctx.db, entityId, before.title);
      }
      break;
    case 'reorder_columns':
      if (Array.isArray(before)) {
        for (let i = 0; i < before.length; i += 1) {
          await helpers.updateColumnPosition(ctx.db, before[i].id, before[i].position ?? i);
        }
      }
      break;
    case 'update_sprint':
      if (before) {
        await sprintQueries.updateSprint(
          ctx.db,
          entityId,
          before.name,
          before.start_date,
          before.end_date,
          before.is_active,
          before.description
        );
      }
      break;
    case 'assign_tag':
      if (Array.isArray(before)) {
        const current = await helpers.getTagsForTask(ctx.db, entityId);
        for (const tag of current) {
          await helpers.removeTagFromTask(ctx.db, entityId, tag.id);
        }
        for (const tag of before) {
          await helpers.addTagToTask(ctx.db, entityId, tag.id);
        }
        await publishTaskUpdated(ctx, entityId, taskBoardId(await taskQueries.getTaskById(ctx.db, entityId)));
      }
      break;
    case 'link_task':
      if (after?.taskId && after?.toTaskId && after?.relationship) {
        const rel = await taskQueries.getTaskRelationship(
          ctx.db,
          after.taskId,
          after.relationship,
          after.toTaskId
        );
        if (rel) await taskQueries.deleteTaskRelationship(ctx.db, rel.id);
      }
      break;
    case 'unlink_task':
      if (before?.taskId && before?.toTaskId && before?.relationship) {
        await taskQueries.createTaskRelationship(
          ctx.db,
          before.taskId,
          before.relationship,
          before.toTaskId
        );
      }
      break;
    case 'attach_file': {
      const attachment = await fileQueries.getAttachmentById(ctx.db, entityId);
      if (attachment) {
        const filename = String(attachment.url || '')
          .replace('/attachments/', '')
          .replace('/api/files/attachments/', '');
        if (filename) {
          try {
            const { deleteObject } = await import('./storage/index.js');
            await deleteObject(
              ctx.db,
              { attachments: getAttachmentsDir(ctx.tenantId || null), avatars: null },
              'attachments',
              filename
            );
          } catch {
            /* ignore file delete errors */
          }
        }
        await fileQueries.deleteAttachment(ctx.db, entityId);
        await updateStorageUsage(ctx.db);
      }
      break;
    }
    default:
      break;
  }

  await automationJournal.markUndone(ctx.db, entry.id);
}

export async function undoJob(ctx) {
  const entries = await automationJournal.listUndoableByJobId(ctx.db, ctx.jobId);
  let undone = 0;
  for (const entry of entries) {
    try {
      await reverseJournalEntry(ctx, entry);
      undone += 1;
    } catch (error) {
      console.error(`automation undo failed for journal ${entry.id}:`, error);
    }
  }
  return { undone };
}

export async function applyStoredPlan(ctx) {
  const work = await taskWorkQueries.getWorkMapByTaskId(ctx.db, ctx.launchTaskId);
  const rawPlan = work.automation_pending_plan;
  if (!rawPlan) {
    return { error: 'No automation_pending_plan stored' };
  }

  let plan;
  try {
    plan = JSON.parse(rawPlan);
  } catch {
    return { error: 'Invalid automation_pending_plan JSON' };
  }

  const planHash = hashPlan(plan);
  if (work.automation_apply_hash === planHash) {
    return { ok: true, idempotent: true };
  }

  const operations = plan.operations || [];
  if (!operations.length || plan.empty) {
    await taskWorkQueries.upsertWorkEntries(ctx.db, ctx.launchTaskId, {
      automation_apply_hash: planHash,
      control: 'none',
      awaiting_apply: '',
      status: 'done'
    });
    return { ok: true, applied: 0, emptyPlan: true };
  }

  const results = [];

  try {
    await taskWorkQueries.upsertWorkEntry(ctx.db, ctx.launchTaskId, 'status', 'running');
    await taskWorkQueries.upsertWorkEntry(ctx.db, ctx.launchTaskId, 'awaiting_apply', 'false');

    for (const op of operations) {
      const opName = op?.name || op?.tool;
      const opArgs = op?.arguments || op?.args || {};
      const result = await executeTool(ctx, opName, opArgs, { dryRun: false });
      results.push({ name: opName, result });
      if (result?.error) {
        throw new Error(result.error);
      }
    }

    await taskWorkQueries.upsertWorkEntries(ctx.db, ctx.launchTaskId, {
      automation_apply_hash: planHash,
      control: 'none',
      awaiting_apply: '',
      automation_undoable: 'true',
      automation_undone_at: '',
      automation_undo_summary: ''
    });

    return { ok: true, applied: operations.length, results };
  } catch (error) {
    await undoJob(ctx);
    await taskWorkQueries.upsertWorkEntries(ctx.db, ctx.launchTaskId, {
      status: 'failed',
      automation_undoable: 'false',
      automation_undone_at: '',
      automation_undo_summary: ''
    });
    return { error: error.message || String(error), results, undone: true };
  }
}

export async function buildDryRunArtifactCsv(ctx, plan) {
  const operations = plan?.operations || [];
  const header = 'seq,tool,summary,arguments';
  const lines = operations.map((op, index) => {
    const name = op?.name || op?.tool || '';
    const summary = (op?.summary || '').replace(/"/g, '""');
    const args = JSON.stringify(op?.arguments || op?.args || {}).replace(/"/g, '""');
    return `${index + 1},"${name}","${summary}","${args}"`;
  });
  const planSummary = (plan?.summary || '').replace(/"/g, '""');
  return `# Plan: "${planSummary}"\n${header}\n${lines.join('\n')}\n`;
}
