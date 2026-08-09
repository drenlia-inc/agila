import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { wrapQuery } from '../utils/queryLogger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = dirname(__dirname);

const DEMO_AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Directory of optional local demo photos (not committed).
 * Override with DEMO_AVATAR_DIR.
 */
function getDemoAvatarSeedDir() {
  const fromEnv = String(process.env.DEMO_AVATAR_DIR || '').trim();
  if (fromEnv) return fromEnv;
  return join(SERVER_ROOT, 'demo-assets', 'avatars');
}

function getAvatarsOutputDir(tenantId = null) {
  if (tenantId && process.env.MULTI_TENANT === 'true') {
    const basePath =
      process.env.DOCKER_ENV === 'true' ? '/app/server' : join(SERVER_ROOT, '..');
    return join(basePath, 'avatars', 'tenants', tenantId);
  }
  return join(SERVER_ROOT, 'avatars');
}

/**
 * If a seed image exists for `slug` (e.g. john.jpg), copy into runtime avatars dir.
 * @returns {string|null} Public path `/avatars/...` or null if no seed file
 */
export function installDemoSeedAvatar(slug, userId, tenantId = null) {
  const safeSlug = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!safeSlug) return null;

  const seedDir = getDemoAvatarSeedDir();
  let sourcePath = null;
  let ext = null;
  for (const candidateExt of DEMO_AVATAR_EXTENSIONS) {
    const candidate = join(seedDir, `${safeSlug}${candidateExt}`);
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      ext = candidateExt;
      break;
    }
  }
  if (!sourcePath) return null;

  try {
    const avatarsDir = getAvatarsOutputDir(tenantId);
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    const filename = `demo-${safeSlug}-${userId}${ext}`;
    const destPath = join(avatarsDir, filename);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✅ Installed demo photo avatar: ${safeSlug}${ext} → ${filename}`);
    return `/avatars/${filename}`;
  } catch (error) {
    console.error(`Failed to install demo seed avatar for ${safeSlug}:`, error.message);
    return null;
  }
}

/**
 * Prefer optional seed photo; fall back to generated letter SVG.
 */
function resolveDemoUserAvatar(slug, letter, userId, color) {
  const fromSeed = installDemoSeedAvatar(slug, userId);
  if (fromSeed) return fromSeed;
  return createLetterAvatar(letter, userId, color);
}

/**
 * Utility function to create letter avatars
 */
function createLetterAvatar(letter, userId, color) {
  try {
    const size = 100;
    
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${color}"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.6}" 
            fill="white" text-anchor="middle" dominant-baseline="central" font-weight="bold">${letter}</text>
    </svg>`;
    
    const filename = `demo-${letter.toLowerCase()}-${Date.now()}.svg`;
    const avatarsDir = join(SERVER_ROOT, 'avatars');
    
    // Ensure avatars directory exists
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    
    const filePath = join(avatarsDir, filename);
    fs.writeFileSync(filePath, svg);
    
    console.log(`✅ Created demo letter avatar: ${filename}`);
    return `/avatars/${filename}`;
  } catch (error) {
    console.error('Error creating demo avatar:', error);
    return null;
  }
}

/**
 * Utility function to generate random passwords
 */
function generateRandomPassword(length = 12) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

/**
 * Create demo users (only called when DEMO_ENABLED=true)
 * @param {Object} db - Database instance
 * @returns {Array} Array of demo user objects with credentials
 */
export async function createDemoUsers(db) {
  if (process.env.DEMO_ENABLED !== 'true') {
    return [];
  }

  console.log('👥 Creating demo users...');

  const demoUsers = [
    {
      firstName: 'John',
      lastName: 'Smith',
      email: 'john.smith@demo.local',
      color: '#3B82F6', // Blue - distinctive and professional
      letter: 'J',
      avatarSlug: 'john',
      bio: 'Frontend lead · React & design systems. Coffee-powered. Ask me about accessibility or CSS that actually works.',
    },
    {
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@demo.local',
      color: '#10B981', // Green - fresh and vibrant
      letter: 'S',
      avatarSlug: 'sarah',
      bio: 'Product & UX. I turn fuzzy ideas into clear tickets. Usually in standups with a notebook and too many stickies.',
    },
    {
      firstName: 'Mike',
      lastName: 'Davis',
      email: 'mike.davis@demo.local',
      color: '#F59E0B', // Amber/Orange - warm and energetic
      letter: 'M',
      avatarSlug: 'mike',
      bio: 'Backend & APIs. PostgreSQL enthusiast. If it involves queues, auth, or “why is this slow?”, ping me.',
    },
  ];

  const userRoleResult = await wrapQuery(db.prepare('SELECT id FROM roles WHERE name = $1'), 'SELECT').get('user');
  const userRoleId = userRoleResult.id;
  const createdUsers = [];

  for (const user of demoUsers) {
    const userId = crypto.randomUUID();
    const password = generateRandomPassword(12);
    const passwordHash = bcrypt.hashSync(password, 10);
    const avatarPath = resolveDemoUserAvatar(
      user.avatarSlug,
      user.letter,
      userId,
      user.color
    );

    // Create user
    await wrapQuery(db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, avatar_path, bio) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `), 'INSERT').run(
      userId,
      user.email,
      passwordHash,
      user.firstName,
      user.lastName,
      avatarPath,
      user.bio
    );

    // Assign user role
    await wrapQuery(db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)'), 'INSERT').run(userId, userRoleId);

    // Store password in settings for easy retrieval
    await wrapQuery(db.prepare('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'), 'INSERT').run(
      `DEMO_PASSWORD_${user.email}`,
      password
    );

    createdUsers.push({
      id: userId,
      email: user.email,
      password,
      firstName: user.firstName,
      lastName: user.lastName,
      color: user.color
    });

    console.log(`✅ Created demo user: ${user.firstName} ${user.lastName} (${user.email})`);
  }

  return createdUsers;
}

/**
 * Initialize demo data for the application
 * Creates demo users and tasks for an existing board
 * @param {Object} db - Database instance
 * @param {string} boardId - Existing board ID to add demo data to
 * @param {Array} columns - Array of existing column objects
 */
export async function initializeDemoData(db, boardId, columns) {
  if (process.env.DEMO_ENABLED !== 'true') {
    console.log('⏭️  Demo data initialization skipped (DEMO_ENABLED is not true)');
    return;
  }

  console.log('🎭 Initializing demo data...');
  
  // Initialize demo settings
  await wrapQuery(db.prepare('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'), 'INSERT').run('STORAGE_USED', '0');
  console.log('✅ Set STORAGE_USED=0 for demo');
  
  // Create demo users first
  const demoUsers = await createDemoUsers(db);
  if (demoUsers.length === 0) {
    console.log('⚠️  No demo users created, skipping demo data');
    return;
  }

  // Create members for demo users
  const members = [];
  for (const user of demoUsers) {
    const memberId = crypto.randomUUID();
    await wrapQuery(db.prepare('INSERT INTO members (id, name, color, user_id) VALUES ($1, $2, $3, $4)'), 'INSERT').run(
      memberId,
      `${user.firstName} ${user.lastName}`,
      user.color,
      user.id
    );
    members.push({ id: memberId, name: `${user.firstName} ${user.lastName}`, userId: user.id });
  }

  // Include bootstrap admin so the demo board has cards for the signed-in admin account
  const adminMember = await wrapQuery(
    db.prepare(`
      SELECT m.id, m.name, m.user_id AS "userId"
      FROM members m
      JOIN users u ON u.id = m.user_id
      WHERE u.email = 'admin@kanban.local'
      LIMIT 1
    `),
    'SELECT'
  ).get();
  if (adminMember?.id) {
    members.push({
      id: adminMember.id,
      name: adminMember.name,
      userId: adminMember.userId
    });
    await wrapQuery(
      db.prepare(`
        UPDATE users
        SET bio = $1, updated_at = CURRENT_TIMESTAMP
        WHERE email = 'admin@kanban.local'
          AND (bio IS NULL OR TRIM(bio) = '')
      `),
      'UPDATE'
    ).run(
      'Demo admin · Keeps the board humming. Happy to help with roles, settings, or “where did that task go?”'
    );
    console.log(`✅ Included admin member in demo assignments: ${adminMember.name}`);
  }

  console.log(`✅ Created ${members.length} team members`);

  // Get the project identifier for the board
  const board = await wrapQuery(db.prepare('SELECT project FROM boards WHERE id = $1'), 'SELECT').get(boardId);
  const projectIdentifier = board?.project || 'PROJ-0001';

  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];
  
  // Calculate sprint start date for task timing (14 days ago)
  const sprintStartForTasks = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Create sprint first so tasks can be inserted with sprint_id (or null = backlog).
  // Realistic rule: backlog = not committed → To Do only; active sprint work flows across columns.
  const sprintStartDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sprintEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sprintId = crypto.randomUUID();

  await wrapQuery(db.prepare(`
    INSERT INTO planning_periods (id, name, start_date, end_date, description, is_active, board_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `), 'INSERT').run(
    sprintId,
    'Sprint 1 - Demo Sprint',
    sprintStartDate,
    sprintEndDate,
    'Complete initial project setup and core features',
    1,
    boardId,
    now,
    now
  );
  console.log(`✅ Created demo sprint: Sprint 1 (${sprintStartDate} to ${sprintEndDate})`);

  const daysFromNow = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const daysAgoDate = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // columnIndex: 0 To Do, 1 In Progress, 2 Testing, 3 Completed, 4 Archive
  // inSprint: false → backlog (To Do only); true → Sprint 1
  const demoTasks = [
    // —— Backlog (To Do only) ——
    {
      title: 'Research third-party integrations',
      description: 'Investigate available APIs and services for payment processing and analytics.',
      priority: 'low',
      effort: 1,
      startDate: today,
      dueDate: null,
      columnIndex: 0,
      inSprint: false,
      assignedTo: 2
    },
    {
      title: 'Explore dark-mode polish',
      description: 'Audit contrast and charts in dark theme; list follow-ups for a future sprint.',
      priority: 'low',
      effort: 2,
      startDate: today,
      dueDate: null,
      columnIndex: 0,
      inSprint: false,
      assignedTo: 0
    },
    {
      title: 'Document API versioning policy',
      description: 'Draft how we version public REST endpoints and communicate breaking changes.',
      priority: 'medium',
      effort: 2,
      startDate: today,
      dueDate: daysFromNow(14),
      columnIndex: 0,
      inSprint: false,
      assignedTo: 3
    },
    {
      title: 'Evaluate analytics vendors',
      description: 'Compare product analytics options (privacy, cost, SDK size) before committing.',
      priority: 'low',
      effort: 1,
      startDate: today,
      dueDate: null,
      columnIndex: 0,
      inSprint: false,
      assignedTo: 1
    },
    {
      title: 'Add keyboard shortcuts help',
      description: 'Document and surface common board shortcuts for power users.',
      priority: 'low',
      effort: 1,
      startDate: today,
      dueDate: daysFromNow(21),
      columnIndex: 0,
      inSprint: false,
      assignedTo: 0
    },

    // —— Sprint 1 · To Do ——
    {
      title: 'Set up project documentation',
      description: 'Create comprehensive project documentation including README, API docs, and user guides.',
      priority: 'high',
      effort: 3,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(7),
      columnIndex: 0,
      inSprint: true,
      assignedTo: 3
    },
    {
      title: 'Design user interface mockups',
      description: 'Create wireframes and mockups for the new dashboard interface.',
      priority: 'medium',
      effort: 2,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(5),
      columnIndex: 0,
      inSprint: true,
      assignedTo: 1
    },
    {
      title: 'Polish onboarding checklist',
      description: 'Add empty-state tips and a short checklist for first-time board setup.',
      priority: 'medium',
      effort: 2,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(6),
      columnIndex: 0,
      inSprint: true,
      assignedTo: 3
    },

    // —— Sprint 1 · In Progress ——
    {
      title: 'Implement user authentication',
      description: 'Build secure login system with JWT tokens and password hashing.',
      priority: 'urgent',
      effort: 5,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(3),
      columnIndex: 1,
      inSprint: true,
      assignedTo: 2
    },
    {
      title: 'Create database schema',
      description: 'Design and implement the database structure with proper relationships and indexes.',
      priority: 'high',
      effort: 4,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(2),
      columnIndex: 1,
      inSprint: true,
      assignedTo: 3
    },
    {
      title: 'Set up CI/CD pipeline',
      description: 'Configure automated testing and deployment workflows using GitHub Actions.',
      priority: 'medium',
      effort: 3,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(4),
      columnIndex: 1,
      inSprint: true,
      assignedTo: 1
    },
    {
      title: 'Improve task search relevance',
      description: 'Rank ticket IDs and titles ahead of description matches in header search.',
      priority: 'high',
      effort: 3,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(4),
      columnIndex: 1,
      inSprint: true,
      assignedTo: 2
    },
    {
      title: 'Socket reconnect banner',
      description: 'Show a non-blocking banner when the realtime connection drops and recovers.',
      priority: 'medium',
      effort: 2,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(5),
      columnIndex: 1,
      inSprint: true,
      assignedTo: 3
    },

    // —— Sprint 1 · Testing ——
    {
      title: 'Write unit tests for API endpoints',
      description: 'Create comprehensive test coverage for all REST API endpoints.',
      priority: 'high',
      effort: 2,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(1),
      columnIndex: 2,
      inSprint: true,
      assignedTo: 1
    },
    {
      title: 'Perform security audit',
      description: 'Review code for security vulnerabilities and implement necessary fixes.',
      priority: 'urgent',
      effort: 3,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(2),
      columnIndex: 2,
      inSprint: true,
      assignedTo: 3
    },
    {
      title: 'Test cross-browser compatibility',
      description: 'Ensure the application works correctly across different browsers and devices.',
      priority: 'medium',
      effort: 2,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(3),
      columnIndex: 2,
      inSprint: true,
      assignedTo: 0
    },
    {
      title: 'Verify sprint filter edge cases',
      description: 'QA backlog vs sprint views, including tasks moved between sprints mid-cycle.',
      priority: 'high',
      effort: 2,
      startDate: sprintStartForTasks,
      dueDate: daysFromNow(2),
      columnIndex: 2,
      inSprint: true,
      assignedTo: 2
    },

    // —— Sprint 1 · Completed ——
    {
      title: 'Project planning and requirements gathering',
      description: 'Conducted stakeholder interviews and documented all project requirements.',
      priority: 'medium',
      effort: 2,
      startDate: daysAgoDate(12),
      dueDate: daysAgoDate(5),
      completedDate: daysAgoDate(6),
      columnIndex: 3,
      inSprint: true,
      assignedTo: 0
    },
    {
      title: 'Set up development environment',
      description: 'Configured local development setup with all necessary tools and dependencies.',
      priority: 'low',
      effort: 1,
      startDate: daysAgoDate(10),
      dueDate: daysAgoDate(3),
      completedDate: daysAgoDate(4),
      columnIndex: 3,
      inSprint: true,
      assignedTo: 1
    },
    {
      title: 'Create initial project structure',
      description: 'Set up the basic project architecture and folder structure.',
      priority: 'medium',
      effort: 1,
      startDate: daysAgoDate(9),
      dueDate: daysAgoDate(2),
      completedDate: daysAgoDate(3),
      columnIndex: 3,
      inSprint: true,
      assignedTo: 2
    },
    {
      title: 'Wire sprint filter on board view',
      description: 'Let the board show backlog vs an active sprint without losing column layout.',
      priority: 'low',
      effort: 1,
      startDate: daysAgoDate(11),
      dueDate: daysAgoDate(4),
      completedDate: daysAgoDate(5),
      columnIndex: 3,
      inSprint: true,
      assignedTo: 3
    },

    // —— Sprint 1 · Archive (finished earlier this sprint, then archived) ——
    {
      title: 'Legacy feature removal',
      description: 'Removed deprecated features that are no longer needed in the current version.',
      priority: 'low',
      effort: 1,
      startDate: daysAgoDate(13),
      dueDate: daysAgoDate(10),
      completedDate: daysAgoDate(11),
      columnIndex: 4,
      inSprint: true,
      assignedTo: 2
    },
    {
      title: 'Old documentation cleanup',
      description: 'Archived outdated documentation and updated references to current versions.',
      priority: 'low',
      effort: 1,
      startDate: daysAgoDate(12),
      dueDate: daysAgoDate(8),
      completedDate: daysAgoDate(9),
      columnIndex: 4,
      inSprint: true,
      assignedTo: 0
    }
  ];

  const taskStmt = db.prepare(`
    INSERT INTO tasks (id, title, description, ticket, memberid, requesterid, startdate, duedate, effort, priority, columnid, boardid, position, sprint_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `);

  const createdTasks = [];
  const positionsByColumn = {};
  let sprintTaskCount = 0;
  let backlogTaskCount = 0;

  for (let index = 0; index < demoTasks.length; index++) {
    const task = demoTasks[index];
    const colIdx = task.columnIndex;
    if (positionsByColumn[colIdx] === undefined) positionsByColumn[colIdx] = 0;
    const position = positionsByColumn[colIdx]++;
    const taskId = crypto.randomUUID();
    const ticketNumber = String(index + 1).padStart(5, '0');
    const assignedMember = members[task.assignedTo % members.length];
    // Slight realism: requester is often a teammate, not always the assignee
    const requester = members[(task.assignedTo + 1) % members.length];
    const taskSprintId = task.inSprint ? sprintId : null;
    if (task.inSprint) sprintTaskCount += 1;
    else backlogTaskCount += 1;

    await wrapQuery(taskStmt, 'INSERT').run(
      taskId,
      task.title,
      task.description,
      `TASK-${ticketNumber}`,
      assignedMember.id,
      requester.id,
      task.startDate || today,
      task.dueDate || null,
      task.effort,
      task.priority,
      columns[colIdx].id,
      boardId,
      position,
      taskSprintId,
      now,
      now
    );

    createdTasks.push({
      id: taskId,
      title: task.title,
      ticket: `TASK-${ticketNumber}`,
      columnIndex: colIdx,
      memberId: assignedMember.id,
      completedDate: task.completedDate || null,
      effort: task.effort,
      startDate: task.startDate || today,
      inSprint: !!task.inSprint,
      priority: task.priority
    });
  }

  console.log(
    `✅ Created ${demoTasks.length} demo tasks (${backlogTaskCount} backlog in To Do, ${sprintTaskCount} on Sprint 1)`
  );

  const taskByTitle = (title) => createdTasks.find((t) => t.title === title);

  // Create tags
  const tags = [
    { name: 'frontend', color: '#3B82F6' },
    { name: 'backend', color: '#10B981' },
    { name: 'database', color: '#8B5CF6' },
    { name: 'security', color: '#EF4444' },
    { name: 'documentation', color: '#F59E0B' },
    { name: 'testing', color: '#EC4899' }
  ];

  const tagIds = {};
  for (const tagData of tags) {
    const result = await wrapQuery(db.prepare('INSERT INTO tags (tag, color) VALUES ($1, $2) RETURNING id'), 'INSERT').run(tagData.name, tagData.color);
    tagIds[tagData.name] = result.lastInsertRowid;
  }

  console.log(`✅ Created ${tags.length} tags`);

  // Tag / comment / relationship helpers keyed by title (stable across reordering)
  const tagsByTitle = {
    'Set up project documentation': ['documentation'],
    'Design user interface mockups': ['frontend'],
    'Research third-party integrations': ['backend'],
    'Implement user authentication': ['backend', 'security'],
    'Create database schema': ['database', 'backend'],
    'Set up CI/CD pipeline': ['backend'],
    'Write unit tests for API endpoints': ['backend', 'testing'],
    'Perform security audit': ['security', 'backend'],
    'Test cross-browser compatibility': ['frontend', 'testing'],
    'Project planning and requirements gathering': ['documentation'],
    'Document API versioning policy': ['documentation'],
    'Legacy feature removal': ['backend']
  };

  const taskTagStmt = db.prepare('INSERT INTO task_tags (taskid, tagid) VALUES ($1, $2)');
  for (const task of createdTasks) {
    const names = tagsByTitle[task.title];
    if (!names) continue;
    for (const tagName of names) {
      await wrapQuery(taskTagStmt, 'INSERT').run(task.id, tagIds[tagName]);
    }
  }

  console.log(`✅ Assigned tags to tasks`);

  const relationships = [
    { parentTitle: 'Create database schema', childTitle: 'Implement user authentication', type: 'parent' },
    { parentTitle: 'Implement user authentication', childTitle: 'Write unit tests for API endpoints', type: 'parent' },
    { parentTitle: 'Project planning and requirements gathering', childTitle: 'Set up project documentation', type: 'parent' },
    { task1Title: 'Design user interface mockups', task2Title: 'Test cross-browser compatibility', type: 'related' },
  ];

  const relationshipStmt = db.prepare(`
    INSERT INTO task_rels (task_id, relationship, to_task_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
  `);

  let relationshipCount = 0;
  for (const rel of relationships) {
    if (rel.type === 'parent') {
      const parent = taskByTitle(rel.parentTitle);
      const child = taskByTitle(rel.childTitle);
      if (!parent || !child) continue;
      await wrapQuery(relationshipStmt, 'INSERT').run(parent.id, 'parent', child.id, now, now);
      await wrapQuery(relationshipStmt, 'INSERT').run(child.id, 'child', parent.id, now, now);
      relationshipCount += 2;
    } else if (rel.type === 'related') {
      const a = taskByTitle(rel.task1Title);
      const b = taskByTitle(rel.task2Title);
      if (!a || !b) continue;
      await wrapQuery(relationshipStmt, 'INSERT').run(a.id, 'related', b.id, now, now);
      await wrapQuery(relationshipStmt, 'INSERT').run(b.id, 'related', a.id, now, now);
      relationshipCount += 2;
    }
  }

  console.log(`✅ Created ${relationshipCount} task relationships (${relationships.length} logical relationships)`);

  const comments = [
    {
      title: 'Implement user authentication',
      memberId: members[1].id,
      text: 'Started implementing JWT token authentication. Should be ready by EOD tomorrow.',
      createdDaysAgo: 2
    },
    {
      title: 'Implement user authentication',
      memberId: members[0].id,
      text: 'Great! Make sure to add refresh token functionality as well.',
      createdDaysAgo: 2
    },
    {
      title: 'Create database schema',
      memberId: members[0].id,
      text: 'Database schema design is complete. Moving to implementation phase.',
      createdDaysAgo: 5
    },
    {
      title: 'Write unit tests for API endpoints',
      memberId: members[1].id,
      text: 'Added test coverage for all authentication endpoints. Coverage is now at 85%.',
      createdDaysAgo: 1
    },
    {
      title: 'Perform security audit',
      memberId: members[2].id,
      text: 'Found a few SQL injection vulnerabilities. Creating tasks to fix them.',
      createdDaysAgo: 3
    },
    {
      title: 'Perform security audit',
      memberId: members[0].id,
      text: 'Thanks for catching those! Let\'s prioritize the fixes.',
      createdDaysAgo: 3
    },
    {
      title: 'Set up project documentation',
      memberId: members[0].id,
      text: 'Working on API documentation. Will use OpenAPI/Swagger format.',
      createdDaysAgo: 1
    },
  ];

  const commentStmt = db.prepare(`
    INSERT INTO comments (id, taskid, authorid, text, createdat, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `);

  let commentCount = 0;
  for (const comment of comments) {
    const task = taskByTitle(comment.title);
    if (!task) continue;
    const commentDate = new Date(Date.now() - comment.createdDaysAgo * 24 * 60 * 60 * 1000).toISOString();
    await wrapQuery(commentStmt, 'INSERT').run(
      crypto.randomUUID(),
      task.id,
      comment.memberId,
      comment.text,
      commentDate,
      commentDate
    );
    commentCount += 1;
  }

  console.log(`✅ Created ${commentCount} comments on tasks`);

  const activityEvents = [
    { title: 'Project planning and requirements gathering', memberId: members[0].id, action: 'completed', daysAgo: 6 },
    { title: 'Set up development environment', memberId: members[1].id, action: 'completed', daysAgo: 4 },
    { title: 'Create initial project structure', memberId: members[2].id, action: 'completed', daysAgo: 3 },
    { title: 'Legacy feature removal', memberId: members[2].id, action: 'completed', daysAgo: 11 },
    { title: 'Old documentation cleanup', memberId: members[0].id, action: 'completed', daysAgo: 8 },
    { title: 'Wire sprint filter on board view', memberId: members[3]?.id || members[0].id, action: 'completed', daysAgo: 5 },
    { title: 'Set up project documentation', memberId: members[3]?.id || members[0].id, action: 'created', daysAgo: 12 },
    { title: 'Design user interface mockups', memberId: members[1].id, action: 'created', daysAgo: 11 },
    { title: 'Implement user authentication', memberId: members[2].id, action: 'created', daysAgo: 9 },
    { title: 'Create database schema', memberId: members[3]?.id || members[0].id, action: 'created', daysAgo: 8 },
    { title: 'Set up CI/CD pipeline', memberId: members[1].id, action: 'created', daysAgo: 7 },
    { title: 'Design user interface mockups', memberId: members[0].id, action: 'commented', daysAgo: 5 },
    { title: 'Implement user authentication', memberId: members[1].id, action: 'commented', daysAgo: 4 },
    { title: 'Perform security audit', memberId: members[2].id, action: 'commented', daysAgo: 3 },
    { title: 'Set up project documentation', memberId: members[0].id, action: 'commented', daysAgo: 1 },
  ];

  const activityStmt = db.prepare(`
    INSERT INTO activity_events (
      id, event_type, user_id, user_name, user_email,
      task_id, task_title, task_ticket, board_id, board_name,
      effort_points, priority_name, created_at,
      period_year, period_month, period_week
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `);

  let activityCount = 0;
  for (const event of activityEvents) {
    const task = taskByTitle(event.title);
    if (!task) continue;
    const member = members.find((m) => m.id === event.memberId);
    if (!member) continue;

    const user = await wrapQuery(db.prepare('SELECT id, email FROM users WHERE id = $1'), 'SELECT').get(member.userId);
    if (!user) continue;

    const eventTimestamp = new Date(Date.now() - event.daysAgo * 24 * 60 * 60 * 1000);
    const eventDate = eventTimestamp.toISOString();

    const periodYear = eventTimestamp.getFullYear();
    const periodMonth = eventTimestamp.getMonth() + 1;
    const periodWeek = Math.ceil(
      (eventTimestamp.getDate() + new Date(eventTimestamp.getFullYear(), eventTimestamp.getMonth(), 1).getDay()) / 7
    );

    let eventType = event.action;
    if (event.action === 'completed') eventType = 'task_completed';
    else if (event.action === 'created') eventType = 'task_created';
    else if (event.action === 'commented') eventType = 'comment_added';

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
      board?.name || 'Main Board',
      event.action === 'completed' ? task.effort : null,
      task.priority,
      eventDate,
      periodYear,
      periodMonth,
      periodWeek
    );

    activityCount++;
  }

  console.log(`✅ Created ${activityCount} activity events for leaderboard`);

  // Populate user_points table for leaderboard
  console.log('📊 Populating user_points for leaderboard...');
  
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  // Get point values from settings (using defaults)
  const POINTS = {
    TASK_CREATED: 5,
    TASK_COMPLETED: 10,
    EFFORT_MULTIPLIER: 2,
    COMMENT_ADDED: 2
  };
  
  // Calculate points for each demo user
  const userPointsData = [];
  
  for (const member of members) {
    const user = await wrapQuery(db.prepare('SELECT id FROM users WHERE id = $1'), 'SELECT').get(member.userId);
    if (!user) continue;

    const userEvents = activityEvents.filter((e) => e.memberId === member.id);

    let totalPoints = 0;
    let tasksCreated = 0;
    let tasksCompleted = 0;
    let totalEffortCompleted = 0;
    let commentsAdded = 0;

    userEvents.forEach((event) => {
      const task = taskByTitle(event.title);
      if (!task) return;

      if (event.action === 'created') {
        tasksCreated++;
        totalPoints += POINTS.TASK_CREATED;
      } else if (event.action === 'completed') {
        tasksCompleted++;
        const effort = task.effort || 0;
        totalEffortCompleted += effort;
        totalPoints += POINTS.TASK_COMPLETED + (effort * POINTS.EFFORT_MULTIPLIER);
      } else if (event.action === 'commented') {
        commentsAdded++;
        totalPoints += POINTS.COMMENT_ADDED;
      }
    });
    
    if (totalPoints > 0 || tasksCreated > 0 || tasksCompleted > 0) {
      userPointsData.push({
        userId: user.id,
        userName: member.name,
        totalPoints,
        tasksCreated,
        tasksCompleted,
        totalEffortCompleted,
        commentsAdded
      });
    }
  }
  
  // Insert user_points records
  const userPointsStmt = db.prepare(`
    INSERT INTO user_points (
      id, user_id, user_name, total_points, tasks_completed, 
      total_effort_completed, comments_added, tasks_created, collaborations,
      period_year, period_month, last_updated
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `);
  
  for (const data of userPointsData) {
    await wrapQuery(userPointsStmt, 'INSERT').run(
      crypto.randomUUID(),
      data.userId,
      data.userName,
      data.totalPoints,
      data.tasksCompleted,
      data.totalEffortCompleted,
      data.commentsAdded,
      data.tasksCreated,
      0, // collaborations
      currentYear,
      currentMonth,
      now
    );
  }
  
  console.log(`✅ Created ${userPointsData.length} user_points records for leaderboard`);
  
  // Populate task_snapshots for burndown chart
  console.log('📸 Creating task snapshots for burndown chart...');
  
  // Create snapshots for each day of the sprint
  const sprintStart = new Date(sprintStartDate);
  const sprintEnd = new Date(sprintEndDate);
  const todayDate = new Date();
  
  // Calculate how many days to create snapshots for (from sprint start to today or sprint end, whichever is earlier)
  const snapshotEndDate = todayDate < sprintEnd ? todayDate : sprintEnd;
  
  let snapshotCount = 0;
  let currentDate = new Date(sprintStart);
  
  while (currentDate <= snapshotEndDate) {
    const snapshotDateStr = currentDate.toISOString().split('T')[0];
    
    // Burndown should reflect committed sprint scope only (not backlog)
    for (const task of createdTasks) {
      if (!task.inSprint) continue;

      const taskStartDate = new Date(task.startDate || sprintStartDate);
      if (taskStartDate > currentDate) continue;

      const taskCompletedDate = task.completedDate ? new Date(task.completedDate) : null;
      const isCompleted = taskCompletedDate && taskCompletedDate <= currentDate ? 1 : 0;
      const column = columns[task.columnIndex];

      const taskTagsResult = await wrapQuery(db.prepare('SELECT tagid FROM task_tags WHERE taskid = $1'), 'SELECT').all(task.id);
      const taskTagsList = [];
      for (const tt of taskTagsResult) {
        const tag = await wrapQuery(db.prepare('SELECT tag, color FROM tags WHERE id = $1'), 'SELECT').get(tt.tagid);
        if (tag) taskTagsList.push(tag.tag);
      }

      const assigneeMember = members.find((m) => m.id === task.memberId);
      const assigneeName = assigneeMember ? assigneeMember.name : 'Unknown';
      const seedTask = demoTasks.find((t) => t.title === task.title);
      const description = seedTask?.description || '';

      await wrapQuery(db.prepare(`
        INSERT INTO task_snapshots (
          id, snapshot_date, task_id, task_title, task_ticket, task_description,
          board_id, board_name, column_id, column_name,
          assignee_id, assignee_name, requester_id, requester_name,
          effort_points, priority_name, tags, status, is_completed, is_deleted, created_at, completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT DO NOTHING
      `), 'INSERT').run(
        crypto.randomUUID(),
        snapshotDateStr,
        task.id,
        task.title,
        task.ticket,
        description,
        boardId,
        board?.name || 'Main Board',
        column.id,
        column.title,
        task.memberId,
        assigneeName,
        task.memberId,
        assigneeName,
        task.effort || 0,
        task.priority,
        taskTagsList.length > 0 ? JSON.stringify(taskTagsList) : null,
        isCompleted ? 'completed' : 'in_progress',
        isCompleted,
        0,
        taskStartDate.toISOString(),
        taskCompletedDate ? taskCompletedDate.toISOString() : null
      );

      snapshotCount++;
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log(`✅ Created ${snapshotCount} task snapshots for burndown chart`);

  console.log('');
  console.log('🎉 Demo data initialization complete!');
  console.log(`   📊 Sprint: ${sprintStartDate} to ${sprintEndDate}`);
  console.log(`   📝 ${demoTasks.length} tasks with historical completion data`);
  console.log(`   💬 ${comments.length} comments showing collaboration`);
  console.log(`   🏷️  ${tags.length} tags for organization`);
  console.log(`   🔗 ${relationships.length} task dependencies/blockers`);
  console.log(`   📈 ${activityCount} activity events for reporting`);
  console.log(`   🏆 ${userPointsData.length} user leaderboard entries`);
  console.log(`   📸 ${snapshotCount} task snapshots for burndown`);
}

