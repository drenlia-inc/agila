/**
 * Seed EN + FR demo boards (shared users/tags). Called when DEMO_ENABLED and no boards exist.
 */
import crypto from 'crypto';
import { wrapQuery } from '../utils/queryLogger.js';
import { boards as boardQueries, boardParticipants } from '../utils/sqlManager/index.js';
import { getDefaultBoardColumns } from '../utils/defaultBoardColumns.js';
import {
  DEMO_ACCEPTANCE_CRITERIA,
  DEMO_ACTIVITY,
  DEMO_ADMIN_BIO,
  DEMO_BOARD_SETTING,
  DEMO_BOARD_TITLE,
  DEMO_COMMENTS,
  DEMO_RELATIONSHIPS,
  DEMO_SPRINT,
  DEMO_TAGS,
  DEMO_TAGS_BY_KEY,
  DEMO_TASK_COPY,
} from './demoCopy.js';

const TASK_META = [
  // To Do / À faire — five backlog (no sprint) tasks with no assignee (memberid NULL)
  { key: 'research_integrations', priority: 'low', effort: 1, columnIndex: 0, inSprint: false, assignedTo: null, dueOffset: null, start: 'today' },
  { key: 'dark_mode_polish', priority: 'low', effort: 2, columnIndex: 0, inSprint: false, assignedTo: null, dueOffset: null, start: 'today' },
  { key: 'api_versioning', priority: 'medium', effort: 2, columnIndex: 0, inSprint: false, assignedTo: null, dueOffset: 14, start: 'today' },
  { key: 'analytics_vendors', priority: 'low', effort: 1, columnIndex: 0, inSprint: false, assignedTo: null, dueOffset: null, start: 'today' },
  { key: 'keyboard_shortcuts', priority: 'low', effort: 1, columnIndex: 0, inSprint: false, assignedTo: null, dueOffset: 21, start: 'today' },
  { key: 'project_docs', priority: 'high', effort: 3, columnIndex: 0, inSprint: true, assignedTo: 3, dueOffset: 7, start: 'sprint' },
  { key: 'ui_mockups', priority: 'medium', effort: 2, columnIndex: 0, inSprint: true, assignedTo: 1, dueOffset: 5, start: 'sprint' },
  { key: 'onboarding_checklist', priority: 'medium', effort: 2, columnIndex: 0, inSprint: true, assignedTo: 3, dueOffset: 6, start: 'sprint' },
  { key: 'user_auth', priority: 'urgent', effort: 5, columnIndex: 1, inSprint: true, assignedTo: 2, dueOffset: 3, start: 'sprint' },
  { key: 'db_schema', priority: 'high', effort: 4, columnIndex: 1, inSprint: true, assignedTo: 3, dueOffset: 2, start: 'sprint' },
  { key: 'cicd', priority: 'medium', effort: 3, columnIndex: 1, inSprint: true, assignedTo: 1, dueOffset: 4, start: 'sprint' },
  { key: 'search_relevance', priority: 'high', effort: 3, columnIndex: 1, inSprint: true, assignedTo: 2, dueOffset: 4, start: 'sprint' },
  { key: 'socket_banner', priority: 'medium', effort: 2, columnIndex: 1, inSprint: true, assignedTo: 3, dueOffset: 5, start: 'sprint' },
  { key: 'api_unit_tests', priority: 'high', effort: 2, columnIndex: 2, inSprint: true, assignedTo: 1, dueOffset: 1, start: 'sprint' },
  { key: 'security_audit', priority: 'urgent', effort: 3, columnIndex: 2, inSprint: true, assignedTo: 3, dueOffset: 2, start: 'sprint' },
  { key: 'cross_browser', priority: 'medium', effort: 2, columnIndex: 2, inSprint: true, assignedTo: 0, dueOffset: 3, start: 'sprint' },
  { key: 'sprint_filter_qa', priority: 'high', effort: 2, columnIndex: 2, inSprint: true, assignedTo: 2, dueOffset: 2, start: 'sprint' },
  { key: 'project_planning', priority: 'medium', effort: 2, columnIndex: 3, inSprint: true, assignedTo: 0, startAgo: 12, dueAgo: 5, completedAgo: 6 },
  { key: 'dev_environment', priority: 'low', effort: 1, columnIndex: 3, inSprint: true, assignedTo: 1, startAgo: 10, dueAgo: 3, completedAgo: 4 },
  { key: 'project_structure', priority: 'medium', effort: 1, columnIndex: 3, inSprint: true, assignedTo: 2, startAgo: 9, dueAgo: 2, completedAgo: 3 },
  { key: 'sprint_filter_wire', priority: 'low', effort: 1, columnIndex: 3, inSprint: true, assignedTo: 3, startAgo: 11, dueAgo: 4, completedAgo: 5 },
  { key: 'legacy_removal', priority: 'low', effort: 1, columnIndex: 4, inSprint: true, assignedTo: 2, startAgo: 13, dueAgo: 10, completedAgo: 11 },
  { key: 'old_docs_cleanup', priority: 'low', effort: 1, columnIndex: 4, inSprint: true, assignedTo: 0, startAgo: 12, dueAgo: 8, completedAgo: 9 },
];

/** Backlog (no sprint) demo tasks that must have memberid NULL on EN + FR boards. */
export const DEMO_BACKLOG_UNASSIGNED_KEYS = [
  'research_integrations',
  'dark_mode_polish',
  'api_versioning',
  'analytics_vendors',
  'keyboard_shortcuts',
];

function daysFromNow(d) {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}
function daysAgoDate(d) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function seedOneBoard(db, { lang, members, tagIds, position, writeLeaderboard }) {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const sprintStartForTasks = daysAgoDate(14);
  const sprintStartDate = sprintStartForTasks;
  const sprintEndDate = daysFromNow(7);

  const boardId = crypto.randomUUID();
  const projectIdentifier = await boardQueries.generateProjectIdentifier(db);
  const boardTitle = DEMO_BOARD_TITLE[lang];

  await wrapQuery(
    db.prepare('INSERT INTO boards (id, title, project, position) VALUES (?, ?, ?, ?)'),
    'INSERT'
  ).run(boardId, boardTitle, projectIdentifier, position);

  const templateColumns = await getDefaultBoardColumns(db, lang);
  const columnStmt = db.prepare(
    'INSERT INTO columns (id, boardid, title, position, is_finished, is_archived) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const columns = [];
  for (const [index, col] of templateColumns.entries()) {
    const columnId = `${col.id}-${boardId}`;
    await wrapQuery(columnStmt, 'INSERT').run(
      columnId,
      boardId,
      col.title,
      index,
      !!col.isFinished,
      !!col.isArchived
    );
    columns.push({ id: columnId, title: col.title, position: index });
  }

  await wrapQuery(
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'),
    'INSERT'
  ).run(DEMO_BOARD_SETTING[lang], boardId);

  await boardParticipants.addActiveUsersAsParticipants(db, boardId);

  const sprintId = crypto.randomUUID();
  await wrapQuery(
    db.prepare(`
      INSERT INTO planning_periods (id, name, start_date, end_date, description, goal, is_active, board_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `),
    'INSERT'
  ).run(
    sprintId,
    DEMO_SPRINT.name[lang],
    sprintStartDate,
    sprintEndDate,
    DEMO_SPRINT.description[lang],
    DEMO_SPRINT.goal[lang],
    1,
    boardId,
    now,
    now
  );

  const taskStmt = db.prepare(`
    INSERT INTO tasks (id, title, description, ticket, memberid, requesterid, startdate, duedate, effort, priority, columnid, boardid, position, sprint_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `);

  const createdByKey = {};
  const positionsByColumn = {};

  for (let index = 0; index < TASK_META.length; index++) {
    const meta = TASK_META[index];
    const copy = DEMO_TASK_COPY[meta.key]?.[lang];
    if (!copy) continue;
    const colIdx = meta.columnIndex;
    if (positionsByColumn[colIdx] === undefined) positionsByColumn[colIdx] = 0;
    const positionInCol = positionsByColumn[colIdx]++;
    const taskId = crypto.randomUUID();
    const assigneeIndex = meta.assignedTo;
    const hasAssignee = Number.isInteger(assigneeIndex);
    const assignedMember = hasAssignee
      ? members[assigneeIndex % members.length]
      : null;
    // Unassigned tasks still need a requester (demo admin / first teammate)
    const requester =
      members[(hasAssignee ? assigneeIndex + 1 : 0) % members.length];
    if (!requester?.id) {
      throw new Error(`Demo seed: missing requester for task ${meta.key}`);
    }
    const startDate =
      meta.start === 'sprint'
        ? sprintStartForTasks
        : meta.startAgo != null
          ? daysAgoDate(meta.startAgo)
          : today;
    const dueDate =
      meta.dueAgo != null
        ? daysAgoDate(meta.dueAgo)
        : meta.dueOffset != null
          ? daysFromNow(meta.dueOffset)
          : null;
    const completedDate = meta.completedAgo != null ? daysAgoDate(meta.completedAgo) : null;

    await wrapQuery(taskStmt, 'INSERT').run(
      taskId,
      copy.title,
      copy.description,
      `TASK-${String(index + 1).padStart(5, '0')}`,
      assignedMember?.id ?? null,
      requester.id,
      startDate,
      dueDate,
      meta.effort,
      meta.priority,
      columns[colIdx].id,
      boardId,
      positionInCol,
      meta.inSprint ? sprintId : null,
      now,
      now
    );

    createdByKey[meta.key] = {
      id: taskId,
      title: copy.title,
      ticket: `TASK-${String(index + 1).padStart(5, '0')}`,
      columnIndex: colIdx,
      memberId: assignedMember?.id ?? null,
      completedDate,
      effort: meta.effort,
      startDate,
      inSprint: !!meta.inSprint,
      priority: meta.priority,
      description: copy.description,
    };
  }

  const acStmt = db.prepare(`
    INSERT INTO acceptance_criteria (id, task_id, text, is_done, position, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $6)
  `);
  for (const [key, byLang] of Object.entries(DEMO_ACCEPTANCE_CRITERIA)) {
    const task = createdByKey[key];
    const items = byLang?.[lang];
    if (!task || !Array.isArray(items)) continue;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item?.text) continue;
      await wrapQuery(acStmt, 'INSERT').run(
        crypto.randomUUID(),
        task.id,
        item.text,
        item.done === true,
        i + 1,
        now
      );
    }
  }

  const taskTagStmt = db.prepare('INSERT INTO task_tags (taskid, tagid) VALUES ($1, $2)');
  for (const [key, names] of Object.entries(DEMO_TAGS_BY_KEY)) {
    const task = createdByKey[key];
    if (!task) continue;
    for (const tagName of names) {
      if (tagIds[tagName]) {
        await wrapQuery(taskTagStmt, 'INSERT').run(task.id, tagIds[tagName]);
      }
    }
  }

  const relationshipStmt = db.prepare(`
    INSERT INTO task_rels (task_id, relationship, to_task_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
  `);
  for (const rel of DEMO_RELATIONSHIPS) {
    if (rel.type === 'parent') {
      const parent = createdByKey[rel.parentKey];
      const child = createdByKey[rel.childKey];
      if (!parent || !child) continue;
      await wrapQuery(relationshipStmt, 'INSERT').run(parent.id, 'parent', child.id, now, now);
      await wrapQuery(relationshipStmt, 'INSERT').run(child.id, 'child', parent.id, now, now);
    } else if (rel.type === 'related') {
      const a = createdByKey[rel.task1Key];
      const b = createdByKey[rel.task2Key];
      if (!a || !b) continue;
      await wrapQuery(relationshipStmt, 'INSERT').run(a.id, 'related', b.id, now, now);
      await wrapQuery(relationshipStmt, 'INSERT').run(b.id, 'related', a.id, now, now);
    }
  }

  const commentStmt = db.prepare(`
    INSERT INTO comments (id, taskid, authorid, text, createdat, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `);
  for (const comment of DEMO_COMMENTS) {
    const task = createdByKey[comment.key];
    const member = members[comment.memberIndex % members.length];
    if (!task || !member) continue;
    const commentDate = new Date(Date.now() - comment.createdDaysAgo * 24 * 60 * 60 * 1000).toISOString();
    await wrapQuery(commentStmt, 'INSERT').run(
      crypto.randomUUID(),
      task.id,
      member.id,
      comment[lang],
      commentDate,
      commentDate
    );
  }

  const activityStmt = db.prepare(`
    INSERT INTO activity_events (
      id, event_type, user_id, user_name, user_email,
      task_id, task_title, task_ticket, board_id, board_name,
      effort_points, priority_name, created_at,
      period_year, period_month, period_week
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `);

  for (const event of DEMO_ACTIVITY) {
    const task = createdByKey[event.key];
    const member = members[Math.min(event.memberIndex, members.length - 1)];
    if (!task || !member) continue;
    const user = await wrapQuery(db.prepare('SELECT id, email FROM users WHERE id = $1'), 'SELECT').get(member.userId);
    if (!user) continue;
    const eventTimestamp = new Date(Date.now() - event.daysAgo * 24 * 60 * 60 * 1000);
    let eventType = event.action;
    if (event.action === 'completed') eventType = 'task_completed';
    else if (event.action === 'created') eventType = 'task_created';
    else if (event.action === 'commented') eventType = 'comment_added';
    const periodWeek = Math.ceil(
      (eventTimestamp.getDate() + new Date(eventTimestamp.getFullYear(), eventTimestamp.getMonth(), 1).getDay()) / 7
    );
    await wrapQuery(activityStmt, 'INSERT').run(
      crypto.randomUUID(),
      eventType,
      user.id,
      member.name,
      user.email,
      task.id,
      task.title,
      task.ticket,
      boardId,
      boardTitle,
      event.action === 'completed' ? task.effort : null,
      task.priority,
      eventTimestamp.toISOString(),
      eventTimestamp.getFullYear(),
      eventTimestamp.getMonth() + 1,
      periodWeek
    );
  }

  if (writeLeaderboard) {
    const POINTS = { TASK_CREATED: 5, TASK_COMPLETED: 10, EFFORT_MULTIPLIER: 2, COMMENT_ADDED: 2 };
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const userPointsStmt = db.prepare(`
      INSERT INTO user_points (
        id, user_id, user_name, total_points, tasks_completed,
        total_effort_completed, comments_added, tasks_created, collaborations,
        period_year, period_month, last_updated
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `);
    for (const member of members) {
      const user = await wrapQuery(db.prepare('SELECT id FROM users WHERE id = $1'), 'SELECT').get(member.userId);
      if (!user) continue;
      const userEvents = DEMO_ACTIVITY.filter((e) => members[Math.min(e.memberIndex, members.length - 1)]?.id === member.id);
      let totalPoints = 0;
      let tasksCreated = 0;
      let tasksCompleted = 0;
      let totalEffortCompleted = 0;
      let commentsAdded = 0;
      for (const event of userEvents) {
        const task = createdByKey[event.key];
        if (!task) continue;
        if (event.action === 'created') {
          tasksCreated += 1;
          totalPoints += POINTS.TASK_CREATED;
        } else if (event.action === 'completed') {
          tasksCompleted += 1;
          totalEffortCompleted += task.effort || 0;
          totalPoints += POINTS.TASK_COMPLETED + (task.effort || 0) * POINTS.EFFORT_MULTIPLIER;
        } else if (event.action === 'commented') {
          commentsAdded += 1;
          totalPoints += POINTS.COMMENT_ADDED;
        }
      }
      if (totalPoints > 0 || tasksCreated > 0 || tasksCompleted > 0) {
        await wrapQuery(userPointsStmt, 'INSERT').run(
          crypto.randomUUID(),
          user.id,
          member.name,
          totalPoints,
          tasksCompleted,
          totalEffortCompleted,
          commentsAdded,
          tasksCreated,
          0,
          currentYear,
          currentMonth,
          now
        );
      }
    }
  }

  const sprintStart = new Date(sprintStartDate);
  const sprintEnd = new Date(sprintEndDate);
  const todayDate = new Date();
  const snapshotEndDate = todayDate < sprintEnd ? todayDate : sprintEnd;
  let currentDate = new Date(sprintStart);
  while (currentDate <= snapshotEndDate) {
    const snapshotDateStr = currentDate.toISOString().split('T')[0];
    for (const task of Object.values(createdByKey)) {
      if (!task.inSprint) continue;
      const taskStartDate = new Date(task.startDate || sprintStartDate);
      if (taskStartDate > currentDate) continue;
      const taskCompletedDate = task.completedDate ? new Date(task.completedDate) : null;
      const isCompleted = taskCompletedDate && taskCompletedDate <= currentDate ? 1 : 0;
      const column = columns[task.columnIndex];
      const taskTagsResult = await wrapQuery(
        db.prepare('SELECT tagid FROM task_tags WHERE taskid = $1'),
        'SELECT'
      ).all(task.id);
      const taskTagsList = [];
      for (const tt of taskTagsResult) {
        const tag = await wrapQuery(db.prepare('SELECT tag, color FROM tags WHERE id = $1'), 'SELECT').get(tt.tagid);
        if (tag) taskTagsList.push(tag.tag);
      }
      const assigneeMember = members.find((m) => m.id === task.memberId);
      await wrapQuery(
        db.prepare(`
          INSERT INTO task_snapshots (
            id, snapshot_date, task_id, task_title, task_ticket, task_description,
            board_id, board_name, column_id, column_name,
            assignee_id, assignee_name, requester_id, requester_name,
            effort_points, priority_name, tags, status, is_completed, is_deleted, created_at, completed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          ON CONFLICT DO NOTHING
        `),
        'INSERT'
      ).run(
        crypto.randomUUID(),
        snapshotDateStr,
        task.id,
        task.title,
        task.ticket,
        task.description,
        boardId,
        boardTitle,
        column.id,
        column.title,
        task.memberId,
        assigneeMember ? assigneeMember.name : 'Unknown',
        task.memberId,
        assigneeMember ? assigneeMember.name : 'Unknown',
        task.effort || 0,
        task.priority,
        taskTagsList.length > 0 ? JSON.stringify(taskTagsList) : null,
        isCompleted ? 'completed' : 'in_progress',
        isCompleted,
        0,
        taskStartDate.toISOString(),
        taskCompletedDate ? taskCompletedDate.toISOString() : null
      );
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log(`✅ Demo board seeded (${lang}): ${boardTitle} ${projectIdentifier}`);
  return boardId;
}

export async function seedBilingualDemoBoards(db, members) {
  const tagIds = {};
  for (const tagData of DEMO_TAGS) {
    const row = await wrapQuery(
      db.prepare('INSERT INTO tags (tag, color) VALUES ($1, $2) RETURNING id'),
      'INSERT'
    ).get(tagData.name, tagData.color);
    tagIds[tagData.name] = row?.id;
  }

  await seedOneBoard(db, { lang: 'en', members, tagIds, position: 0, writeLeaderboard: true });
  await seedOneBoard(db, { lang: 'fr', members, tagIds, position: 1, writeLeaderboard: false });
}

/**
 * Demo DBs persist across deploys. Force the five backlog titles (EN+FR) to memberid NULL
 * so claimable work appears even when boards were seeded before unassigned assignees existed.
 */
export async function ensureDemoBacklogTasksUnassigned(db) {
  if (process.env.DEMO_ENABLED !== 'true') return;

  const titles = [];
  for (const key of DEMO_BACKLOG_UNASSIGNED_KEYS) {
    const copy = DEMO_TASK_COPY[key];
    if (copy?.en?.title) titles.push(copy.en.title);
    if (copy?.fr?.title) titles.push(copy.fr.title);
  }
  if (titles.length === 0) return;

  const result = await wrapQuery(
    db.prepare(`
      UPDATE tasks
      SET memberid = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE deleted_at IS NULL
        AND sprint_id IS NULL
        AND memberid IS NOT NULL
        AND title = ANY($1::text[])
    `),
    'UPDATE'
  ).run(titles);

  const cleared = Number(result?.rowCount ?? result?.changes ?? 0);
  if (cleared > 0) {
    console.log(`✅ Demo backlog: cleared assignee on ${cleared} task(s) (EN+FR claimable work)`);
  }
}

async function demoBoardIds(db) {
  const ids = [];
  for (const key of Object.values(DEMO_BOARD_SETTING)) {
    const row = await wrapQuery(
      db.prepare('SELECT value FROM settings WHERE key = $1'),
      'SELECT'
    ).get(key);
    if (row?.value) ids.push(row.value);
  }
  return ids;
}

/** Existing demo volumes: add all active users if a demo board has no (or incomplete) members. */
export async function ensureDemoBoardParticipants(db) {
  if (process.env.DEMO_ENABLED !== 'true') return;
  const boardIds = await demoBoardIds(db);
  for (const boardId of boardIds) {
    await boardParticipants.addActiveUsersAsParticipants(db, boardId);
  }
  if (boardIds.length > 0) {
    console.log(`✅ Demo boards: ensured participants on ${boardIds.length} board(s)`);
  }
}

/** Existing demo volumes: fill sprint goal when the seeded sprint has none. */
export async function ensureDemoSprintGoals(db) {
  if (process.env.DEMO_ENABLED !== 'true') return;
  for (const lang of ['en', 'fr']) {
    const result = await wrapQuery(
      db.prepare(`
        UPDATE planning_periods
        SET goal = $1, updated_at = CURRENT_TIMESTAMP
        WHERE name = $2
          AND (goal IS NULL OR TRIM(goal) = '')
      `),
      'UPDATE'
    ).run(DEMO_SPRINT.goal[lang], DEMO_SPRINT.name[lang]);
    const n = Number(result?.rowCount ?? result?.changes ?? 0);
    if (n > 0) {
      console.log(`✅ Demo sprint: set goal on ${n} ${lang} sprint(s)`);
    }
  }
}

/** Existing demo volumes: add sample acceptance criteria when a showcase task has none. */
export async function ensureDemoAcceptanceCriteria(db) {
  if (process.env.DEMO_ENABLED !== 'true') return;
  const now = new Date().toISOString();
  const acStmt = db.prepare(`
    INSERT INTO acceptance_criteria (id, task_id, text, is_done, position, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $6)
  `);
  let added = 0;
  for (const [key, byLang] of Object.entries(DEMO_ACCEPTANCE_CRITERIA)) {
    for (const lang of ['en', 'fr']) {
      const title = DEMO_TASK_COPY[key]?.[lang]?.title;
      const items = byLang?.[lang];
      if (!title || !Array.isArray(items) || items.length === 0) continue;
      const tasks = await wrapQuery(
        db.prepare(`
          SELECT id FROM tasks
          WHERE deleted_at IS NULL AND title = $1
        `),
        'SELECT'
      ).all(title);
      for (const task of tasks || []) {
        const existing = await wrapQuery(
          db.prepare('SELECT COUNT(*)::int AS count FROM acceptance_criteria WHERE task_id = $1'),
          'SELECT'
        ).get(task.id);
        if (Number(existing?.count || 0) > 0) continue;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item?.text) continue;
          await wrapQuery(acStmt, 'INSERT').run(
            crypto.randomUUID(),
            task.id,
            item.text,
            item.done === true,
            i + 1,
            now
          );
          added += 1;
        }
      }
    }
  }
  if (added > 0) {
    console.log(`✅ Demo tasks: added ${added} acceptance criterion row(s)`);
  }
}

export { DEMO_ADMIN_BIO };
