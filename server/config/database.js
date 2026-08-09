import PostgresDatabase from './postgresDatabase.js';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { runMigrations } from '../migrations/index.js';
import { DEBUG_SETTING_DEFAULTS } from '../constants/debugSettings.js';
import { AI_SETTING_DEFAULTS } from '../constants/aiSettings.js';
import {
  AGENT_USER_ID,
  AGENT_MEMBER_ID,
  AGENT_DEFAULT_NAME,
  AGENT_DEFAULT_COLOR
} from '../constants/agentIdentity.js';
import { initializeDemoData, installDemoSeedAvatar } from './demoData.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { dbExec, dbGet, dbAll, dbRun } from '../utils/dbAsync.js';
import { getTenantDomain, getManagedSmtpSeedDefaults } from '../utils/tenantDomain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Utility function to generate project identifiers
const generateProjectIdentifier = async (db, prefix = 'PROJ-') => {
  // Use consistent async approach for both proxy and direct DB
  const stmt = db.prepare(`
    SELECT project FROM boards 
    WHERE project IS NOT NULL AND project LIKE ?
    ORDER BY CAST(SUBSTR(project, ?) AS INTEGER) DESC 
    LIMIT 1
  `);
  const result = await dbGet(stmt, `${prefix}%`, prefix.length + 1);
  
  let nextNumber = 1;
  if (result && result.project) {
    const currentNumber = parseInt(result.project.substring(prefix.length));
    nextNumber = currentNumber + 1;
  }
  
  return `${prefix}${nextNumber.toString().padStart(5, '0')}`;
};

// Utility function to generate random passwords
const generateRandomPassword = (length = 12) => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
};

// Function to create default letter-based avatars
// tenantId: optional tenant identifier (for multi-tenant mode)
function createLetterAvatar(letter, userId, role = 'user', tenantId = null) {
  try {
    const colors = {
      admin: '#FF6B6B',
      demo: '#4ECDC4',
      user: '#6366F1'
    };
    
    const backgroundColor = colors[role] || colors.user;
    const size = 100;
    
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${backgroundColor}"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.6}" 
            fill="white" text-anchor="middle" dominant-baseline="central" font-weight="bold">${letter}</text>
    </svg>`;
    
    const filename = `default-${role}-${letter.toLowerCase()}-${Date.now()}.svg`;
    
    // Get tenant-specific avatar directory if in multi-tenant mode
    let avatarsDir;
    if (tenantId && isMultiTenant()) {
      const basePath = process.env.DOCKER_ENV === 'true'
        ? '/app/server'
        : join(dirname(__dirname), '..');
      avatarsDir = join(basePath, 'avatars', 'tenants', tenantId);
    } else {
      // Single-tenant: backward compatible path
      avatarsDir = join(dirname(__dirname), 'avatars');
    }
    
    // Ensure avatars directory exists
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
      if (tenantId) {
        console.log(`📁 Created tenant avatar directory: ${avatarsDir}`);
      }
    }
    
    const filePath = join(avatarsDir, filename);
    fs.writeFileSync(filePath, svg);
    
    console.log(`✅ Created default ${role} avatar: ${filename}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
    return `/avatars/${filename}`;
  } catch (error) {
    console.error(`❌ Error creating ${role} avatar:`, error);
    return null;
  }
}

// Check if multi-tenant mode is enabled
const isMultiTenant = () => {
  return process.env.MULTI_TENANT === 'true';
};


/** node-pg returns COUNT(*) as a string; coerce so empty-DB seed checks work. */
const asCount = (value) => Number(value ?? 0);

// Initialize default priorities (called before migrations to ensure they exist)
const initializeDefaultPriorities = async (db) => {
  const prioritiesCountResult = await wrapQuery(db.prepare('SELECT COUNT(*) as count FROM priorities'), 'SELECT').get();
  const prioritiesCount = asCount(prioritiesCountResult.count);
  if (prioritiesCount === 0) {
    const defaultPriorities = [
      { priority: 'low', color: '#10B981', position: 0, initial: 0 },
      { priority: 'medium', color: '#F59E0B', position: 1, initial: 1 },
      { priority: 'high', color: '#EF4444', position: 2, initial: 0 },
      { priority: 'urgent', color: '#DC2626', position: 3, initial: 0 }
    ];

    const priorityStmt = db.prepare('INSERT INTO priorities (priority, color, position, initial) VALUES (?, ?, ?, ?)');
    for (const p of defaultPriorities) {
      await wrapQuery(priorityStmt, 'INSERT').run(p.priority, p.color, p.position, p.initial || 0);
    }

    console.log('✅ Initialized default priorities (low, medium, high, urgent)');
    console.log('   Default priority: medium');
  } else {
    const defaultPriorityCountResult = await wrapQuery(db.prepare('SELECT COUNT(*) as count FROM priorities WHERE initial = 1'), 'SELECT').get();
    const defaultPriorityCount = asCount(defaultPriorityCountResult.count);
    if (defaultPriorityCount === 0) {
      const mediumPriority = await wrapQuery(db.prepare('SELECT id FROM priorities WHERE priority = ?'), 'SELECT').get('medium');
      if (mediumPriority) {
        await wrapQuery(db.prepare('UPDATE priorities SET initial = 1 WHERE id = ?'), 'UPDATE').run(mediumPriority.id);
        console.log('✅ Set "medium" as default priority');
      } else {
        const firstPriority = await wrapQuery(db.prepare('SELECT id FROM priorities ORDER BY position ASC LIMIT 1'), 'SELECT').get();
        if (firstPriority) {
          await wrapQuery(db.prepare('UPDATE priorities SET initial = 1 WHERE id = ?'), 'UPDATE').run(firstPriority.id);
          const priorityNameResult = await wrapQuery(db.prepare('SELECT priority FROM priorities WHERE id = ?'), 'SELECT').get(firstPriority.id);
          const priorityName = priorityNameResult?.priority;
          console.log(`✅ Set "${priorityName || 'first priority'}" as default priority`);
        }
      }
    }
  }
};

const CREATE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      bio TEXT,
      avatar_path TEXT,
      auth_provider TEXT DEFAULT 'local',
      google_avatar_url TEXT,
      is_active BOOLEAN DEFAULT true,
      force_logout BOOLEAN DEFAULT false,
      deactivated_at TIMESTAMPTZ NULL,
      deactivated_by TEXT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_invitations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      UNIQUE(user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project TEXT,
      position NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    );

    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      boardid TEXT NOT NULL,
      title TEXT NOT NULL,
      position NUMERIC(10,2) DEFAULT 0,
      is_finished BOOLEAN DEFAULT false,
      is_archived BOOLEAN DEFAULT false,
      wip_limit INTEGER,
      policy_text TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (boardid) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      position NUMERIC(10,2) DEFAULT 0,
      title TEXT NOT NULL,
      description TEXT,
      ticket TEXT,
      memberid TEXT NOT NULL,
      requesterid TEXT,
      startdate TEXT NOT NULL,
      duedate TEXT,
      effort INTEGER NOT NULL,
      priority TEXT NOT NULL,
      priority_id INTEGER,
      sprint_id TEXT NULL,
      columnid TEXT NOT NULL,
      boardid TEXT,
      pre_boardid TEXT,
      pre_columnid TEXT,
      column_entered_at TIMESTAMPTZ,
      is_blocked BOOLEAN DEFAULT false,
      blocked_reason TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memberid) REFERENCES members(id),
      FOREIGN KEY (requesterid) REFERENCES members(id),
      FOREIGN KEY (columnid) REFERENCES columns(id) ON DELETE CASCADE,
      FOREIGN KEY (boardid) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      taskid TEXT NOT NULL,
      text TEXT NOT NULL,
      authorid TEXT NOT NULL,
      createdat TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskid) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (authorid) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      taskid TEXT,
      commentid TEXT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskid) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (commentid) REFERENCES comments(id) ON DELETE CASCADE,
      CHECK ((taskid IS NOT NULL AND commentid IS NULL) OR (taskid IS NULL AND commentid IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_work (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_task_work_task_id ON task_work(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_work_key_value ON task_work(key, value);

    CREATE TABLE IF NOT EXISTS user_api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'default',
      token_prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_user_api_tokens_user_id ON user_api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_api_tokens_prefix ON user_api_tokens(token_prefix);

    CREATE TABLE IF NOT EXISTS user_ssh_keys (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      private_key_encrypted TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_github_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_encrypted TEXT NOT NULL,
      token_hint TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_automation_tokens (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'this_board',
      scope_board_ids TEXT NOT NULL DEFAULT '[]',
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      apply_plan_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_auto_tokens_hash ON agent_automation_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_agent_auto_tokens_task ON agent_automation_tokens(task_id);

    CREATE TABLE IF NOT EXISTS agent_automation_journal (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      op TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      undone_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_agent_auto_journal_job ON agent_automation_journal(job_id);
    CREATE INDEX IF NOT EXISTS idx_agent_auto_journal_task ON agent_automation_journal(task_id);

    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      tag TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS priorities (
      id SERIAL PRIMARY KEY,
      priority TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      initial INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS views (
      id SERIAL PRIMARY KEY,
      filtername TEXT NOT NULL,
      userid TEXT NOT NULL,
      shared BOOLEAN DEFAULT false,
      textfilter TEXT,
      datefromfilter TEXT,
      datetofilter TEXT,
      duedatefromfilter TEXT,
      duedatetofilter TEXT,
      memberfilters TEXT,
      priorityfilters TEXT,
      tagfilters TEXT,
      projectfilter TEXT,
      taskfilter TEXT,
      boardcolumnfilter TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userid) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      id SERIAL PRIMARY KEY,
      taskid TEXT NOT NULL,
      tagid INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskid) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (tagid) REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(taskid, tagid)
    );

    CREATE TABLE IF NOT EXISTS watchers (
      id SERIAL PRIMARY KEY,
      taskid TEXT NOT NULL,
      memberid TEXT NOT NULL,
      createdat TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskid) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (memberid) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(taskid, memberid)
    );

    CREATE TABLE IF NOT EXISTS collaborators (
      id SERIAL PRIMARY KEY,
      taskid TEXT NOT NULL,
      memberid TEXT NOT NULL,
      createdat TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskid) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (memberid) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(taskid, memberid)
    );

    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      userid TEXT NOT NULL,
      roleid INTEGER,
      action TEXT NOT NULL,
      taskid TEXT,
      columnid TEXT,
      boardid TEXT,
      tagid INTEGER,
      commentid TEXT,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id SERIAL PRIMARY KEY,
      userid TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userid) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userid, setting_key)
    );

    CREATE TABLE IF NOT EXISTS task_rels (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK(relationship IN ('child', 'parent', 'related')),
      to_task_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (to_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(task_id, relationship, to_task_id)
    );

    CREATE TABLE IF NOT EXISTS license_settings (
      id SERIAL PRIMARY KEY,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for better query performance
    CREATE INDEX IF NOT EXISTS idx_watchers_taskid ON watchers(taskid);
    CREATE INDEX IF NOT EXISTS idx_watchers_memberid ON watchers(memberid);
    CREATE INDEX IF NOT EXISTS idx_collaborators_taskid ON collaborators(taskid);
    CREATE INDEX IF NOT EXISTS idx_collaborators_memberid ON collaborators(memberid);
    CREATE INDEX IF NOT EXISTS idx_user_settings_userid ON user_settings(userid);
    CREATE INDEX IF NOT EXISTS idx_task_rels_task_id ON task_rels(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_rels_to_task_id ON task_rels(to_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_rels_relationship ON task_rels(relationship);
    
    -- Additional indexes for frequently queried columns
    -- task_tags table (used in JOINs and WHERE clauses)
    CREATE INDEX IF NOT EXISTS idx_task_tags_taskid ON task_tags(taskid);
    CREATE INDEX IF NOT EXISTS idx_task_tags_tagid ON task_tags(tagid);
    
    -- comments table (used in JOINs and WHERE clauses)
    CREATE INDEX IF NOT EXISTS idx_comments_taskid ON comments(taskid);
    CREATE INDEX IF NOT EXISTS idx_comments_authorid ON comments(authorid);
    
    -- attachments table (used in WHERE clauses)
    CREATE INDEX IF NOT EXISTS idx_attachments_taskid ON attachments(taskid);
    CREATE INDEX IF NOT EXISTS idx_attachments_commentid ON attachments(commentid);
    
    -- tasks table (used in WHERE clauses and JOINs)
    CREATE INDEX IF NOT EXISTS idx_tasks_columnid ON tasks(columnid);
    CREATE INDEX IF NOT EXISTS idx_tasks_boardid ON tasks(boardid);
    CREATE INDEX IF NOT EXISTS idx_tasks_memberid ON tasks(memberid);
    CREATE INDEX IF NOT EXISTS idx_tasks_requesterid ON tasks(requesterid);
    -- Note: idx_tasks_priority_id is created by migration 10 (add_priority_id_to_tasks)
    
    -- columns table (used in WHERE clauses)
    CREATE INDEX IF NOT EXISTS idx_columns_boardid ON columns(boardid);
    CREATE INDEX IF NOT EXISTS idx_columns_is_archived ON columns(is_archived);
    CREATE INDEX IF NOT EXISTS idx_columns_is_finished ON columns(is_finished);
    
    -- activity table (used in WHERE clauses)
    CREATE INDEX IF NOT EXISTS idx_activity_userid ON activity(userid);
    CREATE INDEX IF NOT EXISTS idx_activity_taskid ON activity(taskid);
    CREATE INDEX IF NOT EXISTS idx_activity_boardid ON activity(boardid);
    
    -- members table (used in JOINs)
    CREATE INDEX IF NOT EXISTS idx_members_user_id ON members(user_id);
    
    -- user_roles table (used in JOINs)
    CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
    
    -- views table (used in WHERE clauses)
    CREATE INDEX IF NOT EXISTS idx_views_userid ON views(userid);
    
    -- Migration 1: Reporting tables (integrated into base schema)
    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      user_email TEXT,
      task_id TEXT,
      task_title TEXT,
      task_ticket TEXT,
      board_id TEXT,
      board_name TEXT,
      column_id TEXT,
      column_name TEXT,
      from_column_id TEXT,
      from_column_name TEXT,
      to_column_id TEXT,
      to_column_name TEXT,
      effort_points INTEGER,
      priority_name TEXT,
      tags TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      period_year INTEGER,
      period_month INTEGER,
      period_week INTEGER
    );

    CREATE TABLE IF NOT EXISTS task_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_date DATE NOT NULL,
      task_id TEXT NOT NULL,
      task_title TEXT,
      task_ticket TEXT,
      task_description TEXT,
      board_id TEXT,
      board_name TEXT,
      column_id TEXT,
      column_name TEXT,
      assignee_id TEXT,
      assignee_name TEXT,
      requester_id TEXT,
      requester_name TEXT,
      effort_points INTEGER,
      priority_name TEXT,
      tags TEXT,
      watchers TEXT,
      collaborators TEXT,
      status TEXT,
      is_deleted BOOLEAN DEFAULT false,
      is_completed BOOLEAN DEFAULT false,
      start_date DATE,
      due_date DATE,
      watchers_count INTEGER DEFAULT 0,
      collaborators_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(task_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      achievement_type TEXT NOT NULL,
      badge_name TEXT NOT NULL,
      badge_id TEXT,
      badge_icon TEXT,
      badge_color TEXT,
      points_earned INTEGER DEFAULT 0,
      earned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      period_year INTEGER,
      period_month INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_points (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      total_points INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      total_effort_completed INTEGER DEFAULT 0,
      comments_added INTEGER DEFAULT 0,
      tasks_created INTEGER DEFAULT 0,
      collaborations INTEGER DEFAULT 0,
      watchers_added INTEGER DEFAULT 0,
      period_year INTEGER,
      period_month INTEGER,
      last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_year, period_month)
    );

    CREATE TABLE IF NOT EXISTS planning_periods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_active BOOLEAN DEFAULT false,
      description TEXT,
      planned_tasks INTEGER DEFAULT 0,
      planned_effort INTEGER DEFAULT 0,
      board_id TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Migration 4: Badges table
    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      tier TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      condition_value INTEGER NOT NULL,
      points_reward INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Migration 7: Notification queue
    CREATE TABLE IF NOT EXISTS notification_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      old_value TEXT,
      new_value TEXT,
      task_data TEXT,
      participants_data TEXT,
      actor_data TEXT,
      status TEXT DEFAULT 'pending',
      scheduled_send_time TIMESTAMPTZ NOT NULL,
      first_change_time TIMESTAMPTZ NOT NULL,
      last_change_time TIMESTAMPTZ NOT NULL,
      change_count INTEGER DEFAULT 1,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMPTZ,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Migration 1: Indexes for reporting tables
    CREATE INDEX IF NOT EXISTS idx_activity_events_user_id ON activity_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_events_task_id ON activity_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_activity_events_event_type ON activity_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_activity_events_period ON activity_events(period_year, period_month);
    CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at);
    
    CREATE INDEX IF NOT EXISTS idx_task_snapshots_task_id ON task_snapshots(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_snapshots_date ON task_snapshots(snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_task_snapshots_board ON task_snapshots(board_id);
    CREATE INDEX IF NOT EXISTS idx_task_snapshots_status ON task_snapshots(status);
    
    CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_achievements_period ON user_achievements(period_year, period_month);
    CREATE INDEX IF NOT EXISTS idx_user_achievements_type ON user_achievements(achievement_type);
    CREATE INDEX IF NOT EXISTS idx_user_achievements_badge_id ON user_achievements(badge_id);
    
    CREATE INDEX IF NOT EXISTS idx_user_points_user_id ON user_points(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_points_period ON user_points(period_year, period_month);
    
    CREATE INDEX IF NOT EXISTS idx_planning_periods_dates ON planning_periods(start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_planning_periods_board ON planning_periods(board_id);
    
    CREATE INDEX IF NOT EXISTS idx_badges_tier ON badges(tier);
    CREATE INDEX IF NOT EXISTS idx_badges_condition_type ON badges(condition_type);
    
    CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_scheduled_send ON notification_queue(scheduled_send_time, status);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_user_task ON notification_queue(user_id, task_id, status);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_created_at ON notification_queue(created_at);
    
    -- Migration 8: Performance indexes on tasks
    CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks(startdate);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(duedate);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_dates_board ON tasks(startdate, duedate, boardid);
    CREATE INDEX IF NOT EXISTS idx_tasks_board_column ON tasks(boardid, columnid);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority_id ON tasks(priority_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_sprint_id ON tasks(sprint_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_board_sprint ON tasks(boardid, sprint_id);
    
    -- Migration tracking table
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
`;



// Create database tables (async for proxy support and PostgreSQL)
const createTables = async (db) => {
  await dbExec(db, CREATE_SCHEMA_SQL);
};


// Initialize default data
// tenantId: optional tenant identifier (for multi-tenant mode)
const initializeDefaultData = async (db, tenantId = null) => {
  // Always ensure UPLOAD_FILETYPES is initialized (even if roles already exist)
  // This is important for multi-tenant databases that may have been created before this setting was added
  const uploadFileTypes = await wrapQuery(db.prepare('SELECT value FROM settings WHERE key = ?'), 'SELECT').get('UPLOAD_FILETYPES');
  if (!uploadFileTypes || !uploadFileTypes.value || uploadFileTypes.value === '{}') {
    // Initialize UPLOAD_FILETYPES with default file types
    const defaultFileTypes = JSON.stringify({
      // Images
      'image/jpeg': true,
      'image/png': true,
      'image/gif': true,
      'image/webp': true,
      'image/svg+xml': true,
      'image/bmp': true,
      'image/tiff': true,
      'image/ico': true,
      'image/vnd.microsoft.icon': true, // .ico files (alternative MIME type)
      'image/heic': true,
      'image/heif': true,
      'image/avif': true,
      // Videos
      'video/mp4': true,
      'video/webm': true,
      'video/ogg': true,
      'video/quicktime': true,
      'video/x-msvideo': true,
      'video/x-ms-wmv': true,
      'video/x-matroska': true,
      'video/mpeg': true,
      'video/3gpp': true,
      // Documents
      'application/pdf': true,
      'text/plain': true,
      'text/csv': true,
      // Office Documents
      'application/msword': true,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
      'application/vnd.ms-excel': true,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
      'application/vnd.ms-powerpoint': true,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': true,
      // Archives
      'application/zip': true,
      'application/x-rar-compressed': true,
      'application/x-7z-compressed': true,
      // Code Files
      'text/javascript': true,
      'text/css': true,
      'text/html': true,
      'application/json': true
    });
    const uploadFileTypesStmt = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP');
    await dbRun(uploadFileTypesStmt, 'UPLOAD_FILETYPES', defaultFileTypes);
    console.log('✅ Initialized UPLOAD_FILETYPES with default file types (including GIF)');
  }
  
  // Initialize authentication data if no roles exist
  const rolesCountResult = await wrapQuery(db.prepare('SELECT COUNT(*) as count FROM roles'), 'SELECT').get();
  const rolesCount = asCount(rolesCountResult.count);
  if (rolesCount === 0) {
    // Generate random password for admin user (only when creating users)
    const adminPassword = generateRandomPassword(12);
    
    // Store password in settings
    await wrapQuery(db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'), 'INSERT').run('ADMIN_PASSWORD', adminPassword);
    
    // Insert default roles
    await wrapQuery(db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)'), 'INSERT').run('admin', 'Administrator role');
    await wrapQuery(db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)'), 'INSERT').run('user', 'Regular user role');

    // Create default admin user with random password
    const adminId = crypto.randomUUID();
    const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
    
    // Create admin avatar (optional demo photo, else letter SVG)
    let adminAvatarPath = null;
    if (process.env.DEMO_ENABLED === 'true') {
      adminAvatarPath = installDemoSeedAvatar('admin', adminId, tenantId);
    }
    if (!adminAvatarPath) {
      adminAvatarPath = createLetterAvatar('A', adminId, 'admin', tenantId);
    }
    
    await wrapQuery(db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, avatar_path) 
      VALUES (?, ?, ?, ?, ?, ?)
    `), 'INSERT').run(adminId, 'admin@kanban.local', adminPasswordHash, 'Alex', 'Morgan', adminAvatarPath);

    // Assign admin role to default user
    const adminRoleResult = await wrapQuery(db.prepare('SELECT id FROM roles WHERE name = ?'), 'SELECT').get('admin');
    const adminRoleId = adminRoleResult.id;
    await wrapQuery(db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)'), 'INSERT').run(adminId, adminRoleId);

    // Log admin credentials for easy access
    console.log('');
    console.log('🔐 ===========================================');
    console.log('   ADMIN ACCOUNT CREDENTIALS');
    console.log('===========================================');
    console.log(`   Email: admin@kanban.local`);
    console.log(`   Password: ${adminPassword}`);
    console.log('===========================================');
    console.log('');

    // Initialize default settings
    const tenantDomain = getTenantDomain();
    const defaultSettings = [
      ['APP_VERSION', '0'],
      ['ADMIN_PORTAL_URL', `https://admin.${tenantDomain}`],
      ['WEBSITE_URL', `https://${tenantDomain}`],
      ['SITE_NAME', ''], // blank by default — wordmark logo carries the product name
      ['SITE_URL', '/'],
      ['MAIL_ENABLED', 'false'],
      ['MAIL_MANAGED', 'false'], // Default to false, will be set to true for licensed instances
      // SMTP settings (replaces old MAIL_* settings)
      ['SMTP_HOST', ''],
      ['SMTP_PORT', '587'],
      ['SMTP_USERNAME', ''],
      ['SMTP_PASSWORD', ''],
      ['SMTP_FROM_EMAIL', ''],
      ['SMTP_FROM_NAME', 'Agila'],
      ['SMTP_SECURE', 'tls'],
      ['GOOGLE_CLIENT_ID', ''],
      ['GOOGLE_CLIENT_SECRET', ''],
      ['GOOGLE_SSO_DEBUG', 'false'],
      ...DEBUG_SETTING_DEFAULTS,
      ...AI_SETTING_DEFAULTS,
      // Admin-configurable user preference defaults
      ['DEFAULT_VIEW_MODE', 'kanban'], // Default view mode for new users
      ['DEFAULT_TASK_VIEW_MODE', 'expand'], // Default task view mode for new users
      ['DEFAULT_ACTIVITY_FEED_POSITION', '{"x": 10, "y": 66}'], // Signed X: inset from left (clear of TaskDetails)
      ['DEFAULT_ACTIVITY_FEED_WIDTH', '160'], // Default activity feed width
      ['DEFAULT_ACTIVITY_FEED_HEIGHT', '400'], // Default activity feed height
      // Project and task identification settings
      ['DEFAULT_PROJ_PREFIX', 'PROJ-'], // Default project prefix
      ['DEFAULT_TASK_PREFIX', 'TASK-'], // Default task prefix
      ['DEFAULT_FINISHED_COLUMN_NAMES', '["Done","Terminé","Completed","Complété", "Finished","Fini"]'], // Default finished column names
      ['APP_LANGUAGE', 'EN'], // Default application language (EN or FR)
      ['TASK_DELETE_CONFIRM', 'true'], // Confirm before deleting tasks (system default)
      ['ALLOW_USER_SELF_DELETE', 'true'], // Users may delete their own account (tasks reassigned to SYSTEM)
      ['SITE_OPENS_NEW_TAB', 'true'], // Default to opening links in new tab (matches current behavior)
      ['HIGHLIGHT_OVERDUE_TASKS', 'true'], // Highlight overdue tasks in light red
      ['EFFORT_UNIT', 'hours'], // Task effort display unit: hours | points
      ['LIFECYCLE_DELETED_RETENTION_DAYS', '0'], // Soft-deleted tasks/boards; 0 = keep until manual purge
      ['LIFECYCLE_ARCHIVED_RETENTION_DAYS', '0'], // Tasks in archived columns; 0 = keep forever
      ['STORAGE_LIMIT', '5368709120'], // 5GB storage limit in bytes (5 * 1024^3)
      ['STORAGE_USED', '0'], // Current storage usage in bytes
      ['STORAGE_BACKEND', 'disk'], // disk | s3
      ['STORAGE_MANAGED', 'false'],
      ['S3_ENDPOINT', ''],
      ['S3_REGION', ''],
      ['S3_BUCKET', ''],
      ['S3_ACCESS_KEY_ID', ''],
      ['S3_SECRET_ACCESS_KEY', ''],
      ['S3_FORCE_PATH_STYLE', 'false'],
      ['S3_KEY_PREFIX', ''],
      ['STORAGE_MIGRATION_STATUS', 'idle'],
      ['STORAGE_MIGRATION_DETAIL', ''],
      ['STORAGE_TEST_OK', 'false'],
      ['UPLOAD_MAX_FILESIZE', '10485760'], // 10MB max file size in bytes (10 * 1024^2)
      ['UPLOAD_LIMITS_ENFORCED', 'true'], // Enable/disable file upload restrictions (default true)
      ['NOTIFICATION_DELAY', '30'], // Email notification delay in minutes (default 30)
      ['NOTIFICATION_QUEUE_RETENTION_DAYS', '0'], // Sent/failed queue rows; 0 = keep forever
      // When false, task emails stay pending in the queue (SMTP / invites still use MAIL_ENABLED)
      ['TASK_EMAIL_NOTIFICATIONS_ENABLED', 'true'],
      ['NOTIFICATION_DEFAULTS', JSON.stringify({
        newTaskAssigned: true,
        myTaskUpdated: true,
        watchedTaskUpdated: true,
        addedAsCollaborator: true,
        collaboratingTaskUpdated: true,
        commentAdded: true,
        requesterTaskCreated: true,
        requesterTaskUpdated: true
      })], // Global notification defaults
      // Reporting & Analytics Settings
      ['REPORTS_ENABLED', 'true'], // Enable/disable Reports module
      ['REPORTS_GAMIFICATION_ENABLED', 'true'], // Enable points and gamification
      ['REPORTS_LEADERBOARD_ENABLED', 'true'], // Enable leaderboard rankings
      ['REPORTS_ACHIEVEMENTS_ENABLED', 'true'], // Enable achievement badges
      ['REPORTS_SNAPSHOT_FREQUENCY', 'daily'], // Snapshot frequency: daily, weekly, or manual
      ['REPORTS_RETENTION_DAYS', '730'], // Data retention in days (2 years default)
      ['REPORTS_VISIBLE_TO', 'all'], // Who can see reports: all, admin, members
      ['REPORTS_POINTS_TASK_CREATED', '5'], // Points for creating a task
      ['REPORTS_POINTS_TASK_COMPLETED', '10'], // Points for completing a task
      ['REPORTS_POINTS_TASK_MOVED', '2'], // Points for moving a task
      ['REPORTS_POINTS_TASK_UPDATED', '1'], // Points for updating a task
      ['REPORTS_POINTS_COMMENT_ADDED', '3'], // Points for adding a comment
      ['REPORTS_POINTS_WATCHER_ADDED', '1'], // Points for adding a watcher
      ['REPORTS_POINTS_COLLABORATOR_ADDED', '2'], // Points for adding a collaborator
      ['REPORTS_POINTS_TAG_ADDED', '1'], // Points for adding a tag
      ['REPORTS_POINTS_EFFORT_MULTIPLIER', '2'], // Multiplier for effort points
      ['UPLOAD_FILETYPES', JSON.stringify({
        // Images
        'image/jpeg': true,
        'image/png': true,
        'image/gif': true,
        'image/webp': true,
        'image/svg+xml': true,
        'image/bmp': true,
        'image/tiff': true,
        'image/ico': true,
        'image/heic': true,
        'image/heif': true,
        'image/avif': true,
        // Videos
        'video/mp4': true,
        'video/webm': true,
        'video/ogg': true,
        'video/quicktime': true,
        'video/x-msvideo': true,
        'video/x-ms-wmv': true,
        'video/x-matroska': true,
        'video/mpeg': true,
        'video/3gpp': true,
        // Documents
        'application/pdf': true,
        'text/plain': true,
        'text/csv': true,
        // Office Documents
        'application/msword': true,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
        'application/vnd.ms-excel': true,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
        'application/vnd.ms-powerpoint': true,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': true,
        // Archives
        'application/zip': true,
        'application/x-rar-compressed': true,
        'application/x-7z-compressed': true,
        // Code Files
        'text/javascript': true,
        'text/css': true,
        'text/html': true,
        'application/json': true
      })] // Allowed file types as JSON object
    ];

    // Use INSERT OR IGNORE for most settings, but ensure UPLOAD_FILETYPES is always initialized
    // If UPLOAD_FILETYPES is missing or empty, initialize it with defaults
    const settingsStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING');
    const uploadFileTypesStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value');
    
    for (const [key, value] of defaultSettings) {
      if (key === 'UPLOAD_FILETYPES') {
        // Check if UPLOAD_FILETYPES exists and is not empty
        const existing = await wrapQuery(db.prepare('SELECT value FROM settings WHERE key = ?'), 'SELECT').get('UPLOAD_FILETYPES');
        if (!existing || !existing.value || existing.value === '{}') {
          // Initialize or update with default file types
          await wrapQuery(uploadFileTypesStmt, 'INSERT').run(key, value);
          console.log('✅ Initialized UPLOAD_FILETYPES with default file types');
        } else {
          // Already exists with a value, keep it (admin may have configured it)
          console.log('ℹ️  UPLOAD_FILETYPES already configured, keeping existing value');
        }
      } else {
        await dbRun(settingsStmt, key, value);
      }
    }

    // Override APP_VERSION from environment variable if present (during initial setup)
    if (process.env.APP_VERSION) {
      await wrapQuery(db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP'), 'INSERT')
        .run('APP_VERSION', process.env.APP_VERSION);
      console.log(`✅ Set APP_VERSION=${process.env.APP_VERSION} from environment variable`);
    }

    // Set MAIL_MANAGED=true for licensed instances (basic/pro plans)
    if (process.env.LICENSE_ENABLED === 'true') {
      const supportType = process.env.SUPPORT_TYPE || 'basic';
      if (supportType === 'basic' || supportType === 'pro') {
        await wrapQuery(db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP'), 'INSERT')
          .run('MAIL_MANAGED', 'true');
        console.log('✅ Set MAIL_MANAGED=true for licensed instance');
        
        // Configure managed SMTP settings (encrypt password at rest when non-empty)
        const { encryptSettingValue } = await import('../utils/secretCrypto.js');
        const managedSmtpPasswordPlain =
          process.env.MANAGED_SMTP_PASSWORD || 'managed-password';
        const managedSmtpPasswordStored = managedSmtpPasswordPlain
          ? encryptSettingValue(managedSmtpPasswordPlain)
          : '';
        const managedSmtp = getManagedSmtpSeedDefaults();
        const managedSmtpSettings = [
          ['SMTP_HOST', managedSmtp.host],
          ['SMTP_PORT', '587'],
          ['SMTP_USERNAME', managedSmtp.username],
          ['SMTP_PASSWORD', managedSmtpPasswordStored],
          ['SMTP_FROM_EMAIL', managedSmtp.fromEmail],
          ['SMTP_FROM_NAME', managedSmtp.fromName],
          ['SMTP_SECURE', 'tls'],
          ['MAIL_ENABLED', 'true']
        ];
        
        const managedSmtpStmt = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP');
        for (const [key, value] of managedSmtpSettings) {
          await wrapQuery(managedSmtpStmt, 'INSERT').run(key, value);
        }
        console.log('✅ Configured managed SMTP settings');

        // Managed S3 (optional — only when MANAGED_S3_BUCKET is set)
        if (process.env.MANAGED_S3_BUCKET) {
          const { encryptSettingValue: encryptS3Secret } = await import('../utils/secretCrypto.js');
          const managedS3SecretPlain = process.env.MANAGED_S3_SECRET_ACCESS_KEY || '';
          const managedS3SecretStored = managedS3SecretPlain
            ? encryptS3Secret(managedS3SecretPlain)
            : '';
          const tenantPrefix =
            tenantId && process.env.MULTI_TENANT === 'true'
              ? `tenants/${tenantId}/`
              : (process.env.MANAGED_S3_KEY_PREFIX || '');
          const managedS3Settings = [
            ['STORAGE_BACKEND', 's3'],
            ['STORAGE_MANAGED', 'true'],
            ['S3_ENDPOINT', process.env.MANAGED_S3_ENDPOINT || ''],
            ['S3_REGION', process.env.MANAGED_S3_REGION || ''],
            ['S3_BUCKET', process.env.MANAGED_S3_BUCKET],
            ['S3_ACCESS_KEY_ID', process.env.MANAGED_S3_ACCESS_KEY_ID || ''],
            ['S3_SECRET_ACCESS_KEY', managedS3SecretStored],
            ['S3_FORCE_PATH_STYLE', process.env.MANAGED_S3_FORCE_PATH_STYLE || 'false'],
            ['S3_KEY_PREFIX', tenantPrefix],
            ['STORAGE_TEST_OK', 'false']
          ];
          for (const [key, value] of managedS3Settings) {
            await wrapQuery(managedSmtpStmt, 'INSERT').run(key, value);
          }
          console.log('✅ Configured managed S3 storage settings');
        }
      }
    }

    // Create admin member (human display name; login remains admin@kanban.local)
    const adminMemberId = crypto.randomUUID();
    await wrapQuery(db.prepare('INSERT INTO members (id, name, color, user_id) VALUES (?, ?, ?, ?)'), 'INSERT').run(
      adminMemberId, 
      'Alex Morgan', 
      '#FF6B6B', 
      adminId
    );

    // Create system user account (for orphaned tasks when users are deleted)
    const systemUserId = '00000000-0000-0000-0000-000000000000';
    const systemMemberId = '00000000-0000-0000-0000-000000000001';
    const systemPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10); // Random unguessable password
    
    // Create system avatar (with tenant-specific path if in multi-tenant mode)
    const systemAvatarPath = createLetterAvatar('S', systemUserId, 'system', tenantId);
    
    // Check if system user already exists
    const existingSystemUser = await wrapQuery(db.prepare('SELECT id FROM users WHERE id = ?'), 'SELECT').get(systemUserId);
    if (!existingSystemUser) {
      await wrapQuery(db.prepare(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, avatar_path, auth_provider, is_active) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `), 'INSERT').run(systemUserId, 'system@local', systemPasswordHash, 'System', 'User', systemAvatarPath, 'local', false);

      // Assign user role to system account
      const userRoleResult = await wrapQuery(db.prepare('SELECT id FROM roles WHERE name = ?'), 'SELECT').get('user');
      const userRoleId = userRoleResult.id;
      const userRoleStmt = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
      await dbRun(userRoleStmt, systemUserId, userRoleId);

      // Create system member record
      const systemMemberStmt = db.prepare('INSERT INTO members (id, name, color, user_id) VALUES (?, ?, ?, ?)');
      await dbRun(systemMemberStmt, systemMemberId, 'System', '#1E40AF', systemUserId);
      
      console.log('🤖 System account created for orphaned task management');
    }

    // Create AI Agent pseudo-user (assignable when AI_ENABLED; cannot log in)
    const agentPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
    let agentAvatarPath = null;
    try {
      const { ensureAgentBotAvatarFile } = await import('../utils/agentBotAvatar.js');
      agentAvatarPath = ensureAgentBotAvatarFile(tenantId);
    } catch (e) {
      console.warn('Agent bot avatar install skipped:', e?.message || e);
    }
    if (!agentAvatarPath) {
      agentAvatarPath = createLetterAvatar('A', AGENT_USER_ID, 'agent', tenantId);
    }
    const existingAgentUser = await wrapQuery(db.prepare('SELECT id FROM users WHERE id = ?'), 'SELECT').get(AGENT_USER_ID);
    if (!existingAgentUser) {
      await wrapQuery(db.prepare(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, avatar_path, auth_provider, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `), 'INSERT').run(
        AGENT_USER_ID,
        'agent@local',
        agentPasswordHash,
        'AI',
        'Agent',
        agentAvatarPath,
        'local',
        false
      );

      const userRoleResult = await wrapQuery(db.prepare('SELECT id FROM roles WHERE name = ?'), 'SELECT').get('user');
      if (userRoleResult?.id) {
        await dbRun(
          db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)'),
          AGENT_USER_ID,
          userRoleResult.id
        );
      }

      await dbRun(
        db.prepare('INSERT INTO members (id, name, color, user_id) VALUES (?, ?, ?, ?)'),
        AGENT_MEMBER_ID,
        AGENT_DEFAULT_NAME,
        AGENT_DEFAULT_COLOR,
        AGENT_USER_ID
      );

      console.log('🤖 AI Agent account created for task automation');
    } else if (agentAvatarPath) {
      const agentRow = await wrapQuery(
        db.prepare('SELECT avatar_path FROM users WHERE id = ?'),
        'SELECT'
      ).get(AGENT_USER_ID);
      const current = String(agentRow?.avatar_path || '');
      if (
        !current ||
        current.includes('default-') ||
        current.endsWith('/agent-bot.jpg') ||
        current.endsWith('agent-bot.jpg')
      ) {
        await wrapQuery(
          db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?'),
          'UPDATE'
        ).run(agentAvatarPath, AGENT_USER_ID);
      }
    }
  }

  // Ensure default priorities exist (in case they were deleted)
  await initializeDefaultPriorities(db);

  // Initialize default data if no boards exist
  const boardsCountStmt = db.prepare('SELECT COUNT(*) as count FROM boards');
  const boardsCountResult = await dbGet(boardsCountStmt);
  const boardsCount = asCount(boardsCountResult.count);
  if (boardsCount === 0) {
    // Always create a default board with columns
    const boardId = crypto.randomUUID();
    const projectIdentifier = await generateProjectIdentifier(db);
    await wrapQuery(db.prepare('INSERT INTO boards (id, title, project, position) VALUES (?, ?, ?, ?)'), 'INSERT').run(
      boardId, 
      'Project Board', 
      projectIdentifier,
      0
    );

    // Create default columns
    const defaultColumns = [
      { id: `todo-${boardId}`, title: 'To Do', position: 0, is_finished: false, is_archived: false },
      { id: `progress-${boardId}`, title: 'In Progress', position: 1, is_finished: false, is_archived: false },
      { id: `testing-${boardId}`, title: 'Testing', position: 2, is_finished: false, is_archived: false },
      { id: `completed-${boardId}`, title: 'Completed', position: 3, is_finished: true, is_archived: false },
      { id: `archive-${boardId}`, title: 'Archive', position: 4, is_finished: false, is_archived: true }
    ];

    const columnStmt = db.prepare('INSERT INTO columns (id, boardid, title, position, is_finished, is_archived) VALUES (?, ?, ?, ?, ?, ?)');
    for (const col of defaultColumns) {
      await wrapQuery(columnStmt, 'INSERT').run(col.id, boardId, col.title, col.position, col.is_finished, col.is_archived);
    }

    console.log(`✅ Created default board: ${projectIdentifier} with ${defaultColumns.length} columns`);

    // Initialize demo data if DEMO_ENABLED=true
    // This will create demo users and tasks for the board
    try {
      await initializeDemoData(db, boardId, defaultColumns);
    } catch (error) {
      // Demo seed must not prevent the server from starting (admin/board already created)
      console.error('❌ Demo data initialization failed (continuing startup):', error);
    }

    // Stamp each fresh demo DB so browsers can detect wipe vs stale cookies/localStorage.
    // No migration needed — settings is a key/value table.
    if (process.env.DEMO_ENABLED === 'true') {
      const demoResetAt = new Date().toISOString();
      await wrapQuery(
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'),
        'INSERT'
      ).run('DEMO_RESET_AT', demoResetAt);
      console.log(`✅ DEMO_RESET_AT=${demoResetAt}`);
    }
  }



  // Clean up orphaned members (members without corresponding users)
  try {
    const orphanedMembers = await wrapQuery(db.prepare(`
      SELECT m.id 
      FROM members m 
      LEFT JOIN users u ON m.user_id = u.id 
      WHERE u.id IS NULL AND m.user_id IS NOT NULL
    `), 'SELECT').all();

    if (orphanedMembers.length > 0) {
      const deleteMemberStmt = db.prepare('DELETE FROM members WHERE id = ?');
      for (const member of orphanedMembers) {
        await dbRun(deleteMemberStmt, member.id);
      }
    }
  } catch (error) {
    console.error('Error cleaning up orphaned members:', error);
  }

  // Update APP_VERSION on every startup (from version.json or environment variable)
  // Priority: 1) version.json (build-time), 2) ENV variable (runtime)
  let appVersion = null;
  let versionChanged = false;
  
  // Try to read from version.json (build-time version, works in K8s)
  try {
    const versionUrl = new URL('../version.json', import.meta.url);
    const versionPath = fileURLToPath(versionUrl);
    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    appVersion = versionData.version;
    console.log(`📦 Read version from build-time version.json: ${appVersion}`);
    console.log(`   Git commit: ${versionData.gitCommit} | Branch: ${versionData.gitBranch}`);
    console.log(`   Built at: ${versionData.buildTime}`);
  } catch (error) {
    // Fallback to environment variable (Docker Compose, legacy)
    if (process.env.APP_VERSION) {
      appVersion = process.env.APP_VERSION;
      console.log(`📦 Read version from environment variable: ${appVersion}`);
    }
  }
  
  // Update database if version is available
  if (appVersion) {
    const currentVersion = await wrapQuery(db.prepare('SELECT value FROM settings WHERE key = ?'), 'SELECT').get('APP_VERSION');
    
    if (!currentVersion) {
      // APP_VERSION doesn't exist in settings, insert it
      const insertVersionStmt = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
      await dbRun(insertVersionStmt, 'APP_VERSION', appVersion);
      console.log(`✅ Initialized APP_VERSION=${appVersion}`);
      versionChanged = true;
    } else if (currentVersion.value !== appVersion) {
      // APP_VERSION has changed, update it
      const updateVersionStmt = db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?');
      await dbRun(updateVersionStmt, appVersion, 'APP_VERSION');
      console.log(`✅ Updated APP_VERSION from ${currentVersion.value} to ${appVersion}`);
      console.log(`   🔄 Users will be notified to refresh their browsers`);
      versionChanged = true;
    }
  }
  
  // Return version info for broadcasting
  return { appVersion, versionChanged };
};

// Initialize database connection (PostgreSQL-only; single-tenant or multi-tenant)
export const initializeDatabase = async (tenantId = null) => {
  if (!process.env.POSTGRES_HOST) {
    throw new Error('POSTGRES_HOST is required. Agila is PostgreSQL-only.');
  }

  console.log(`🐘 Using PostgreSQL for tenant: ${tenantId || 'default'}`);
  const db = new PostgresDatabase(tenantId);

  await db.ensureSchema();
  await createTables(db);
  await initializeDefaultPriorities(db);

  try {
    await runMigrations(db);
  } catch (error) {
    console.error('❌ Failed to run migrations:', error);
    throw error;
  }

  const versionInfo = await initializeDefaultData(db, tenantId);

  return {
    db,
    appVersion: versionInfo?.appVersion || null,
    versionChanged: versionInfo?.versionChanged || false,
    tenantId: tenantId || null
  };
};

// Export utility function for tenant routing
export { isMultiTenant };

// SQL for creating all tables (shared between proxy and direct DB)
