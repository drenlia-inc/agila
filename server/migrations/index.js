import { dbExec, dbAll, dbRun } from '../utils/dbAsync.js';

// Migration definitions
// Note: Migrations 1-10 have been integrated into CREATE_SCHEMA_SQL in database.js
// They are automatically marked as applied for new databases and existing databases
// that don't have them yet. Only migrations 11+ are defined here.

const migrations = [
  {
    version: 11,
    name: 'convert_position_to_numeric',
    description: 'Convert position fields from INTEGER to NUMERIC for tasks, columns, and boards to support fractional positions',
    up: async (db) => {
      // information_schema ignores search_path — always scope to this tenant's schema
      const schema = (db.schema && typeof db.schema === 'string') ? db.schema : 'public';
      const checkTasksSql = `
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = 'tasks' AND column_name = 'position'
      `;
      const checkColumnsSql = `
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = 'columns' AND column_name = 'position'
      `;
      const checkBoardsSql = `
        SELECT data_type 
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = 'boards' AND column_name = 'position'
      `;

      const tasksType = await dbAll(db.prepare(checkTasksSql), schema);
      const columnsType = await dbAll(db.prepare(checkColumnsSql), schema);
      const boardsType = await dbAll(db.prepare(checkBoardsSql), schema);

      if (tasksType.length > 0 && tasksType[0].data_type !== 'numeric') {
        await dbExec(db, 'ALTER TABLE tasks ALTER COLUMN position TYPE NUMERIC(10,2) USING position::NUMERIC(10,2)');
        console.log('✅ Converted tasks.position to NUMERIC(10,2)');
      }

      if (columnsType.length > 0 && columnsType[0].data_type !== 'numeric') {
        await dbExec(db, 'ALTER TABLE columns ALTER COLUMN position TYPE NUMERIC(10,2) USING position::NUMERIC(10,2)');
        console.log('✅ Converted columns.position to NUMERIC(10,2)');
      }

      if (boardsType.length > 0 && boardsType[0].data_type !== 'numeric') {
        await dbExec(db, 'ALTER TABLE boards ALTER COLUMN position TYPE NUMERIC(10,2) USING position::NUMERIC(10,2)');
        console.log('✅ Converted boards.position to NUMERIC(10,2)');
      }
    }
  },
  {
    version: 12,
    name: 'add_debug_logging_settings',
    description: 'Insert default FE_DEBUG_* and SERVER_DEBUG_* settings for gated console logs',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { DEBUG_SETTING_DEFAULTS } = await import('../constants/debugSettings.js');
      for (const [key, value] of DEBUG_SETTING_DEFAULTS) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }
    }
  },
  {
    version: 13,
    name: 'add_fe_debug_api_dnd_settings',
    description: 'Insert FE_DEBUG_API and FE_DEBUG_DND if missing (new public debug flags)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const extra = [
        ['FE_DEBUG_API', 'false'],
        ['FE_DEBUG_DND', 'false']
      ];
      for (const [key, value] of extra) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }
    }
  },
  {
    version: 14,
    name: 'add_fe_perf_tests_setting',
    description: 'Insert FE_PERF_TESTS feature flag (default false) for Performance Test Overlay',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'FE_PERF_TESTS');
      if (!existing) {
        await settingsQueries.createSetting(db, 'FE_PERF_TESTS', 'false');
      }
    }
  },
  {
    version: 15,
    name: 'add_ai_agent_platform',
    description: 'task_work KV store, user API tokens, SSH keys, AI settings, and Agent pseudo-user',
    up: async (db) => {
      await dbExec(db, `
        CREATE TABLE IF NOT EXISTS task_work (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (task_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_task_work_task_id ON task_work(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_work_status_value ON task_work (value) WHERE key = 'status';

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
      `);

      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { AI_SETTING_DEFAULTS } = await import('../constants/aiSettings.js');
      for (const [key, value] of AI_SETTING_DEFAULTS) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }

      const {
        AGENT_USER_ID,
        AGENT_MEMBER_ID,
        AGENT_DEFAULT_NAME,
        AGENT_DEFAULT_COLOR
      } = await import('../constants/agentIdentity.js');
      const crypto = await import('crypto');
      const bcrypt = (await import('bcrypt')).default;

      const existingAgent = await dbAll(
        db.prepare('SELECT id FROM users WHERE id = $1'),
        AGENT_USER_ID
      );
      if (!existingAgent.length) {
        const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
        await dbRun(
          db.prepare(`
            INSERT INTO users (id, email, password_hash, first_name, last_name, avatar_path, auth_provider, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `),
          AGENT_USER_ID,
          'agent@local',
          passwordHash,
          'AI',
          'Agent',
          null,
          'local',
          false
        );

        const roles = await dbAll(db.prepare("SELECT id FROM roles WHERE name = 'user'"));
        if (roles.length) {
          await dbRun(
            db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING'),
            AGENT_USER_ID,
            roles[0].id
          );
        }

        await dbRun(
          db.prepare('INSERT INTO members (id, name, color, user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING'),
          AGENT_MEMBER_ID,
          AGENT_DEFAULT_NAME,
          AGENT_DEFAULT_COLOR,
          AGENT_USER_ID
        );
        console.log('✅ Migration 15: AI Agent account seeded');
      }

      console.log('✅ Migration 15: AI agent platform tables and settings ready');
    }
  },
  {
    version: 16,
    name: 'add_ai_provider_setting',
    description: 'Add AI_PROVIDER for multi-provider LLM configuration (OpenAI, Anthropic, Ollama, …)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'AI_PROVIDER');
      if (!existing) {
        await settingsQueries.createSetting(db, 'AI_PROVIDER', 'openai');
      }
      console.log('✅ Migration 16: AI_PROVIDER setting ready');
    }
  },
  {
    version: 17,
    name: 'add_ai_runner_settings',
    description: 'Add push-runner settings: concurrency, runner URL/token, GitHub token',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const defaults = [
        ['AI_MAX_CONCURRENT', '1'],
        ['AI_RUNNER_URL', process.env.AI_RUNNER_URL || ''],
        ['AI_RUNNER_TOKEN', '']
      ];
      for (const [key, value] of defaults) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }
      console.log('✅ Migration 17: AI runner settings ready');
    }
  },
  {
    version: 18,
    name: 'user_github_tokens_remove_admin_pat',
    description:
      'Per-user GitHub PATs for agent git auth; clear tenant AI_GITHUB_TOKEN (moved out of admin scope)',
    up: async (db) => {
      await dbExec(
        db,
        `
        CREATE TABLE IF NOT EXISTS user_github_tokens (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          token_encrypted TEXT NOT NULL,
          token_hint TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `
      );

      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      try {
        await settingsQueries.updateSetting(db, 'AI_GITHUB_TOKEN', '');
      } catch {
        /* setting may not exist on all tenants */
      }

      console.log('✅ Migration 18: user_github_tokens ready; AI_GITHUB_TOKEN cleared');
    }
  },
  {
    version: 19,
    name: 'agent_automation_journal_tokens',
    description: 'Automation job tokens and mutation journal for preview/apply/undo',
    up: async (db) => {
      await dbExec(
        db,
        `
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
      `
      );
      console.log('✅ Migration 19: agent automation tokens + journal ready');
    }
  },
  {
    version: 20,
    name: 'agent_bot_avatar',
    description: 'Install canonical AI Agent bot avatar for agent@local',
    up: async (db) => {
      const { syncAgentUserAvatar } = await import('../utils/agentBotAvatar.js');
      const path = await syncAgentUserAvatar(db, null);
      if (path) {
        console.log(`✅ Migration 20: Agent avatar set to ${path}`);
      } else {
        console.warn('⚠️ Migration 20: Agent bot avatar asset not found; skipped');
      }
    }
  },
  {
    version: 21,
    name: 'add_kanban_flow_basics',
    description:
      'Soft WIP limits and policy text on columns; column_entered_at, is_blocked, blocked_reason on tasks',
    up: async (db) => {
      const schema = db.schema && typeof db.schema === 'string' ? db.schema : 'public';
      const existing = await dbAll(
        db.prepare(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
        `),
        schema,
        'columns'
      );
      const colNames = new Set(existing.map((r) => r.column_name));

      if (!colNames.has('wip_limit')) {
        await dbExec(db, 'ALTER TABLE columns ADD COLUMN wip_limit INTEGER');
      }
      if (!colNames.has('policy_text')) {
        await dbExec(db, 'ALTER TABLE columns ADD COLUMN policy_text TEXT');
      }

      const taskCols = await dbAll(
        db.prepare(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
        `),
        schema,
        'tasks'
      );
      const taskNames = new Set(taskCols.map((r) => r.column_name));

      if (!taskNames.has('column_entered_at')) {
        await dbExec(db, 'ALTER TABLE tasks ADD COLUMN column_entered_at TIMESTAMPTZ');
        await dbExec(
          db,
          `UPDATE tasks SET column_entered_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
           WHERE column_entered_at IS NULL`
        );
      }
      if (!taskNames.has('is_blocked')) {
        await dbExec(db, 'ALTER TABLE tasks ADD COLUMN is_blocked BOOLEAN DEFAULT false');
      }
      if (!taskNames.has('blocked_reason')) {
        await dbExec(db, 'ALTER TABLE tasks ADD COLUMN blocked_reason TEXT');
      }

      console.log('✅ Migration 21: Kanban flow basics (WIP, policy, aging, blocked) ready');
    }
  },
  {
    version: 22,
    name: 'add_effort_unit_setting',
    description: 'Insert EFFORT_UNIT setting (hours | points) for task effort display',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'EFFORT_UNIT');
      if (!existing) {
        await settingsQueries.createSetting(db, 'EFFORT_UNIT', 'hours');
      }
      console.log('✅ Migration 22: EFFORT_UNIT setting ready');
    }
  },
  {
    version: 23,
    name: 'add_lifecycle_soft_delete',
    description: 'Soft-delete columns on tasks/boards plus Lifecycle retention settings',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const schema = db.schema && typeof db.schema === 'string' ? db.schema : 'public';

      const boardCols = await dbAll(
        db.prepare(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
        `),
        schema,
        'boards'
      );
      const boardNames = new Set(boardCols.map((r) => r.column_name));
      if (!boardNames.has('deleted_at')) {
        await dbExec(db, 'ALTER TABLE boards ADD COLUMN deleted_at TIMESTAMPTZ');
      }
      if (!boardNames.has('deleted_by')) {
        await dbExec(db, 'ALTER TABLE boards ADD COLUMN deleted_by TEXT');
      }

      const taskCols = await dbAll(
        db.prepare(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
        `),
        schema,
        'tasks'
      );
      const taskNames = new Set(taskCols.map((r) => r.column_name));
      if (!taskNames.has('deleted_at')) {
        await dbExec(db, 'ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMPTZ');
      }
      if (!taskNames.has('deleted_by')) {
        await dbExec(db, 'ALTER TABLE tasks ADD COLUMN deleted_by TEXT');
      }

      await dbExec(
        db,
        `CREATE INDEX IF NOT EXISTS idx_tasks_board_deleted
         ON tasks (boardid) WHERE deleted_at IS NOT NULL`
      );
      await dbExec(
        db,
        `CREATE INDEX IF NOT EXISTS idx_boards_deleted
         ON boards (id) WHERE deleted_at IS NOT NULL`
      );

      for (const [key, value] of [
        ['LIFECYCLE_DELETED_RETENTION_DAYS', '0'],
        ['LIFECYCLE_ARCHIVED_RETENTION_DAYS', '0'],
      ]) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }

      console.log('✅ Migration 23: Lifecycle soft-delete ready');
    }
  },
  {
    version: 24,
    name: 'normalize_board_positions',
    description:
      'Renumber live boards to sequential positions (migration 11 made position NUMERIC, and string concatenation of MAX(position) left duplicates)',
    up: async (db) => {
      await dbExec(
        db,
        `UPDATE boards b
         SET position = ranked.rn
         FROM (
           SELECT id, (ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC, id ASC) - 1) AS rn
           FROM boards
           WHERE deleted_at IS NULL
         ) ranked
         WHERE b.id = ranked.id AND b.position IS DISTINCT FROM ranked.rn`
      );

      console.log('✅ Migration 24: Board positions normalized');
    }
  },
  {
    version: 25,
    name: 'add_server_debug_google_sso',
    description:
      'Add SERVER_DEBUG_GOOGLE_SSO (Troubleshooting) and copy value from legacy GOOGLE_SSO_DEBUG',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');

      const existing = await settingsQueries.getSettingByKey(db, 'SERVER_DEBUG_GOOGLE_SSO');
      const legacy = await settingsQueries.getSettingByKey(db, 'GOOGLE_SSO_DEBUG');
      const initialValue = legacy?.value === 'true' ? 'true' : 'false';

      if (!existing) {
        await settingsQueries.createSetting(db, 'SERVER_DEBUG_GOOGLE_SSO', initialValue);
      } else if (legacy?.value === 'true' && existing.value !== 'true') {
        await settingsQueries.updateSetting(db, 'SERVER_DEBUG_GOOGLE_SSO', 'true');
      }

      console.log('✅ Migration 25: SERVER_DEBUG_GOOGLE_SSO ready');
    }
  },
  {
    version: 26,
    name: 'add_storage_backend_settings',
    description: 'Add disk/S3 object storage settings (STORAGE_BACKEND, S3_*, migration status)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { STORAGE_SETTING_DEFAULTS } = await import('../constants/storageSettings.js');

      for (const [key, value] of STORAGE_SETTING_DEFAULTS) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }

      console.log('✅ Migration 26: Storage backend settings ready');
    }
  },
  {
    version: 27,
    name: 'add_allow_user_self_delete_setting',
    description: 'Insert ALLOW_USER_SELF_DELETE (default true) for org-controlled account self-deletion',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'ALLOW_USER_SELF_DELETE');
      if (!existing) {
        await settingsQueries.createSetting(db, 'ALLOW_USER_SELF_DELETE', 'true');
      }
      // Ensure TASK_DELETE_CONFIRM exists for older tenants (used beside the new setting in App UI)
      const taskDelete = await settingsQueries.getSettingByKey(db, 'TASK_DELETE_CONFIRM');
      if (!taskDelete) {
        await settingsQueries.createSetting(db, 'TASK_DELETE_CONFIRM', 'true');
      }
      console.log('✅ Migration 27: ALLOW_USER_SELF_DELETE ready');
    }
  },
  {
    version: 28,
    name: 'add_csp_reports_table',
    description: 'Store Content-Security-Policy violation reports for Admin Troubleshooting review',
    up: async (db) => {
      await dbExec(
        db,
        `
          CREATE TABLE IF NOT EXISTS csp_reports (
            id SERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            document_uri TEXT,
            violated_directive TEXT,
            blocked_uri TEXT,
            source_file TEXT,
            line_number INTEGER,
            user_agent TEXT,
            raw JSONB
          )
        `
      );

      await dbExec(
        db,
        `
          CREATE INDEX IF NOT EXISTS idx_csp_reports_created_at
          ON csp_reports (created_at DESC)
        `
      );

      console.log('✅ Migration 28: csp_reports table ready');
    }
  },
  {
    version: 29,
    name: 'rename_default_admin_display_name',
    description:
      'Rename bootstrap admin display from Admin User → Alex Morgan when still the stock name (admin@kanban.local)',
    up: async (db) => {
      await dbExec(
        db,
        `
          UPDATE users
          SET first_name = 'Alex',
              last_name = 'Morgan',
              updated_at = CURRENT_TIMESTAMP
          WHERE email = 'admin@kanban.local'
            AND first_name = 'Admin'
            AND last_name = 'User'
        `
      );

      await dbExec(
        db,
        `
          UPDATE members m
          SET name = 'Alex Morgan',
              updated_at = CURRENT_TIMESTAMP
          FROM users u
          WHERE m.user_id = u.id
            AND u.email = 'admin@kanban.local'
            AND m.name = 'Admin User'
        `
      );

      console.log('✅ Migration 29: default admin display → Alex Morgan (when still stock name)');
    }
  },
  {
    version: 30,
    name: 'add_user_bio',
    description: 'Optional short bio / memo on users, shown in member tooltips',
    up: async (db) => {
      const schema = db.schema && typeof db.schema === 'string' ? db.schema : 'public';
      const cols = await dbAll(
        db.prepare(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = 'users' AND column_name = 'bio'
        `),
        schema
      );
      if (!cols.length) {
        await dbExec(db, 'ALTER TABLE users ADD COLUMN bio TEXT');
        console.log('✅ Migration 30: users.bio column added');
      } else {
        console.log('✅ Migration 30: users.bio already present');
      }
    }
  },
  {
    version: 31,
    name: 'clear_default_site_name',
    description:
      'Clear SITE_NAME when still the stock product name (logo wordmark replaces header text)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'SITE_NAME');
      const current = String(existing?.value ?? '').trim();
      if (current === 'Agila') {
        await settingsQueries.updateSetting(db, 'SITE_NAME', '');
        console.log('✅ Migration 31: SITE_NAME cleared (was Agila)');
      } else if (!existing) {
        await settingsQueries.createSetting(db, 'SITE_NAME', '');
        console.log('✅ Migration 31: SITE_NAME created as empty');
      } else {
        console.log(`✅ Migration 31: SITE_NAME left unchanged (${current || 'empty'})`);
      }
    }
  },
  {
    version: 32,
    name: 'rename_system_member_display_name',
    description: 'Rename System member display from SYSTEM → System when still the stock name',
    up: async (db) => {
      const { SYSTEM_MEMBER_ID } = await import('../constants/agentIdentity.js');
      await dbExec(
        db,
        `
          UPDATE members
          SET name = 'System',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = '${SYSTEM_MEMBER_ID}'
            AND name = 'SYSTEM'
        `
      );
      console.log('✅ Migration 32: System member display SYSTEM → System (when still stock name)');
    }
  },
  {
    version: 33,
    name: 'add_task_email_notifications_enabled',
    description:
      'Add TASK_EMAIL_NOTIFICATIONS_ENABLED (pause task emails while keeping them queued)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'TASK_EMAIL_NOTIFICATIONS_ENABLED');
      if (!existing) {
        await settingsQueries.createSetting(db, 'TASK_EMAIL_NOTIFICATIONS_ENABLED', 'true');
        console.log('✅ Migration 33: TASK_EMAIL_NOTIFICATIONS_ENABLED=true');
      }
    }
  },
  {
    version: 34,
    name: 'add_viewer_role',
    description: 'Add viewer (read-only) role for instance-wide view-only users',
    up: async (db) => {
      await dbRun(
        db.prepare(
          `INSERT INTO roles (name, description)
           VALUES ('viewer', 'Read-only role')
           ON CONFLICT (name) DO NOTHING`
        )
      );
      console.log('✅ Migration 34: viewer role ensured');
    }
  },
  {
    version: 35,
    name: 'remove_spurious_bootstrap_admin',
    description:
      'Remove stock Alex Morgan (admin@kanban.local) when another admin already exists (accidental seed on existing tenants)',
    up: async (db) => {
      // Only remove the stock bootstrap identity when it is clearly surplus:
      // another human admin exists, stock display name, and no task ownership.
      const bootstrap = await dbAll(
        db.prepare(`
          SELECT u.id
          FROM users u
          WHERE u.email = 'admin@kanban.local'
            AND u.first_name = 'Alex'
            AND u.last_name = 'Morgan'
            AND EXISTS (
              SELECT 1
              FROM users ou
              JOIN user_roles ur ON ur.user_id = ou.id
              JOIN roles r ON r.id = ur.role_id
              WHERE r.name = 'admin'
                AND ou.id <> u.id
                AND ou.email NOT IN ('system@local', 'agent@local')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM members m
              WHERE m.user_id = u.id
                AND (
                  EXISTS (SELECT 1 FROM tasks t WHERE t.memberid = m.id)
                  OR EXISTS (SELECT 1 FROM tasks t WHERE t.requesterid = m.id)
                )
            )
        `)
      );

      if (!bootstrap.length) {
        console.log('✅ Migration 35: no spurious bootstrap admin to remove');
        return;
      }

      for (const row of bootstrap) {
        const userId = row.id;

        await dbRun(
          db.prepare(`
            DELETE FROM comments
            WHERE authorid IN (SELECT id FROM members WHERE user_id = ?)
          `),
          userId
        );
        await dbRun(
          db.prepare(`
            DELETE FROM watchers
            WHERE memberid IN (SELECT id FROM members WHERE user_id = ?)
          `),
          userId
        );
        await dbRun(
          db.prepare(`
            DELETE FROM collaborators
            WHERE memberid IN (SELECT id FROM members WHERE user_id = ?)
          `),
          userId
        );
        await dbRun(db.prepare('DELETE FROM activity WHERE userid = ?'), userId);
        await dbRun(db.prepare('DELETE FROM user_settings WHERE userid = ?'), userId);
        await dbRun(db.prepare('DELETE FROM user_roles WHERE user_id = ?'), userId);
        await dbRun(db.prepare('DELETE FROM user_invitations WHERE user_id = ?'), userId);
        await dbRun(db.prepare('DELETE FROM members WHERE user_id = ?'), userId);
        await dbRun(db.prepare('DELETE FROM users WHERE id = ?'), userId);

        console.log(`✅ Migration 35: removed spurious bootstrap admin ${userId}`);
      }
    }
  },
  {
    version: 36,
    name: 'add_board_wip_limit',
    description: 'Soft WIP limit on boards (active work; excludes finished/archived columns)',
    up: async (db) => {
      const cols = await dbAll(
        db.prepare(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'boards'
        `)
      );
      const colNames = new Set(cols.map((c) => c.column_name));
      if (!colNames.has('wip_limit')) {
        await dbExec(db, 'ALTER TABLE boards ADD COLUMN wip_limit INTEGER');
      }
      console.log('✅ Migration 36: boards.wip_limit ready');
    }
  },
  {
    version: 37,
    name: 'add_kanban_chrome_visibility_settings',
    description:
      'Board tab / column header task-count and effort visibility toggles (counts on, effort off by default)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { KANBAN_FEATURE_SETTING_DEFAULTS } = await import(
        '../constants/kanbanFeatureSettings.js'
      );
      for (const [key, value] of KANBAN_FEATURE_SETTING_DEFAULTS) {
        const existing = await settingsQueries.getSettingByKey(db, key);
        if (!existing) {
          await settingsQueries.createSetting(db, key, value);
        }
      }
      console.log('✅ Migration 37: kanban chrome visibility settings ready');
    }
  },
  {
    version: 38,
    name: 'add_default_board_columns_setting',
    description: 'Bilingual default column titles for new boards (Archive always appended)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { DEFAULT_BOARD_COLUMNS_JSON, DEFAULT_BOARD_COLUMNS_SETTING_KEY } = await import(
        '../utils/defaultBoardColumns.js'
      );
      const existing = await settingsQueries.getSettingByKey(db, DEFAULT_BOARD_COLUMNS_SETTING_KEY);
      if (!existing) {
        await settingsQueries.createSetting(db, DEFAULT_BOARD_COLUMNS_SETTING_KEY, DEFAULT_BOARD_COLUMNS_JSON);
      }
      console.log('✅ Migration 38: DEFAULT_BOARD_COLUMNS ready');
    }
  },
  {
    version: 39,
    name: 'unique_pending_notification_per_user_task',
    description:
      'One pending notification_queue row per user+task so delayed emails consolidate',
    up: async (db) => {
      await dbExec(
        db,
        `
          DELETE FROM notification_queue a
          USING notification_queue b
          WHERE a.status = 'pending'
            AND b.status = 'pending'
            AND a.user_id = b.user_id
            AND a.task_id = b.task_id
            AND a.created_at < b.created_at
        `
      );
      await dbExec(
        db,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_pending_user_task
          ON notification_queue (user_id, task_id)
          WHERE status = 'pending'
        `
      );
      console.log('✅ Migration 39: unique pending notification per user+task');
    }
  },
  {
    version: 40,
    name: 'task_work_drop_value_btree',
    description:
      'Stop btree-indexing task_work.value (plans/logs exceed 2704-byte index rows)',
    up: async (db) => {
      await dbExec(db, 'DROP INDEX IF EXISTS idx_task_work_key_value');
      await dbExec(
        db,
        `
          CREATE INDEX IF NOT EXISTS idx_task_work_status_value
          ON task_work (value)
          WHERE key = 'status'
        `
      );
      console.log('✅ Migration 40: task_work status partial index (no value btree)');
    }
  },
  {
    version: 41,
    name: 'webhooks_and_notification_channels',
    description: 'Outgoing webhooks table and notification_queue delivery channel',
    up: async (db) => {
      await dbExec(
        db,
        `
          CREATE TABLE IF NOT EXISTS webhooks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            platform TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            event_types TEXT NOT NULL DEFAULT '{}',
            project_ids TEXT NOT NULL DEFAULT '[]',
            min_priority_id TEXT,
            locale TEXT,
            endpoint_url TEXT,
            telegram_bot_token TEXT,
            telegram_chat_id TEXT,
            whatsapp_access_token TEXT,
            whatsapp_phone_number_id TEXT,
            whatsapp_to TEXT,
            whatsapp_graph_version TEXT DEFAULT 'v21.0',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await dbExec(db, `ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS webhook_id TEXT`);
      await dbExec(
        db,
        `ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'email'`
      );
      await dbExec(db, `ALTER TABLE notification_queue ALTER COLUMN user_id DROP NOT NULL`);
      await dbExec(db, `DROP INDEX IF EXISTS idx_notification_queue_pending_user_task`);
      await dbExec(
        db,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_pending_email
          ON notification_queue (user_id, task_id)
          WHERE status = 'pending' AND delivery_channel = 'email'
        `
      );
      await dbExec(
        db,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_pending_webhook
          ON notification_queue (webhook_id, task_id)
          WHERE status = 'pending' AND delivery_channel = 'webhook'
        `
      );
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'TASK_NOTIFICATION_CHANNELS');
      if (!existing) {
        await settingsQueries.createSetting(db, 'TASK_NOTIFICATION_CHANNELS', 'email');
      }
      console.log('✅ Migration 41: webhooks + notification delivery channel');
    }
  },
  {
    version: 42,
    name: 'views_extended_search_filters',
    description: 'Add overdue, blocked, sprint, stalled, and linked columns to saved filter views',
    up: async (db) => {
      const schema = db.schema && typeof db.schema === 'string' ? db.schema : 'public';
      const columnExists = async (columnName) => {
        const rows = await dbAll(
          db.prepare(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = 'views' AND column_name = ?
          `),
          schema,
          columnName
        );
        return rows.length > 0;
      };
      if (!(await columnExists('linkedtasksonlyfilter'))) {
        await dbExec(db, 'ALTER TABLE views ADD COLUMN linkedtasksonlyfilter BOOLEAN DEFAULT false');
      }
      if (!(await columnExists('overdueonlyfilter'))) {
        await dbExec(db, 'ALTER TABLE views ADD COLUMN overdueonlyfilter BOOLEAN DEFAULT false');
      }
      if (!(await columnExists('blockedonlyfilter'))) {
        await dbExec(db, 'ALTER TABLE views ADD COLUMN blockedonlyfilter BOOLEAN DEFAULT false');
      }
      if (!(await columnExists('sprintfilters'))) {
        await dbExec(db, 'ALTER TABLE views ADD COLUMN sprintfilters TEXT');
      }
      if (!(await columnExists('stalleddaysfilter'))) {
        await dbExec(db, 'ALTER TABLE views ADD COLUMN stalleddaysfilter INTEGER');
      }
      console.log('✅ Migration 42: extended search filter columns on views');
    }
  },
  {
    version: 43,
    name: 'views_project_filters_array',
    description: 'Add projectfilters JSON column for multi-select project filter on saved views',
    up: async (db) => {
      const schema = db.schema && typeof db.schema === 'string' ? db.schema : 'public';
      const columnExists = async (columnName) => {
        const rows = await dbAll(
          db.prepare(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = 'views' AND column_name = ?
          `),
          schema,
          columnName
        );
        return rows.length > 0;
      };
      if (!(await columnExists('projectfilters'))) {
        await dbExec(db, 'ALTER TABLE views ADD COLUMN projectfilters TEXT');
      }
      console.log('✅ Migration 43: projectfilters column on views');
    }
  },
  {
    version: 44,
    name: 'tasks_memberid_nullable',
    description: 'Allow unassigned tasks (null memberid / assignee)',
    up: async (db) => {
      await dbExec(db, `ALTER TABLE tasks ALTER COLUMN memberid DROP NOT NULL`);
      console.log('✅ Migration 44: tasks.memberid nullable');
    }
  },
  {
    version: 45,
    name: 'default_testing_column_title_fr_en_test',
    description: 'Rename the builtin Testing column French title from Test to En test',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { DEFAULT_BOARD_COLUMNS_SETTING_KEY, parseDefaultBoardColumns } = await import(
        '../utils/defaultBoardColumns.js'
      );
      const existing = await settingsQueries.getSettingByKey(db, DEFAULT_BOARD_COLUMNS_SETTING_KEY);
      if (!existing?.value) {
        console.log('✅ Migration 45: no DEFAULT_BOARD_COLUMNS to update');
        return;
      }
      const rows = parseDefaultBoardColumns(existing.value);
      let changed = false;
      const next = rows.map((row) => {
        if (row.id !== 'testing') return row;
        if (String(row.titleFr || '').trim() !== 'Test') return row;
        changed = true;
        return { ...row, titleFr: 'En test' };
      });
      if (changed) {
        await settingsQueries.updateSetting(db, DEFAULT_BOARD_COLUMNS_SETTING_KEY, JSON.stringify(next));
      }
      console.log(
        changed
          ? '✅ Migration 45: Testing French default is now En test'
          : '✅ Migration 45: Testing French title already customized or updated'
      );
    }
  },
  {
    version: 46,
    name: 'add_google_sso_managed',
    description: 'Add GOOGLE_SSO_MANAGED (default false so existing BYO tenants stay on their callback)',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const existing = await settingsQueries.getSettingByKey(db, 'GOOGLE_SSO_MANAGED');
      if (!existing) {
        await settingsQueries.createSetting(db, 'GOOGLE_SSO_MANAGED', 'false');
      }
      console.log('✅ Migration 46: GOOGLE_SSO_MANAGED present');
    }
  },
  {
    version: 47,
    name: 'add_google_sso_mode_and_platform_shadow',
    description:
      'Add GOOGLE_SSO_MODE, managed-eligible flag, and platform shadow OAuth keys for restore',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { getDecryptedSetting } = await import('../utils/settingsSecrets.js');
      const { getAuthHubCallbackUrl } = await import('../utils/authHub.js');
      const {
        GOOGLE_SSO_MODE_KEY,
        GOOGLE_SSO_MANAGED_ELIGIBLE_KEY,
      } = await import('../constants/ssoSettings.js');

      const read = async (key) => {
        const row = await settingsQueries.getSettingByKey(db, key);
        return String(row?.value ?? '').trim();
      };

      const managedFlag = await read('GOOGLE_SSO_MANAGED');
      const clientId = await read('GOOGLE_CLIENT_ID');
      const callbackUrl = await read('GOOGLE_CALLBACK_URL');
      const clientSecret = await getDecryptedSetting(db, 'GOOGLE_CLIENT_SECRET');

      let mode = await read(GOOGLE_SSO_MODE_KEY);
      if (!mode) {
        if (managedFlag === 'true') mode = 'managed';
        else if (clientId) mode = 'byo';
        else mode = '';
        await settingsQueries.upsertSetting(db, GOOGLE_SSO_MODE_KEY, mode);
      }

      const eligibleExisting = await read(GOOGLE_SSO_MANAGED_ELIGIBLE_KEY);
      if (!eligibleExisting) {
        const eligible = managedFlag === 'true' ? 'true' : 'false';
        await settingsQueries.upsertSetting(db, GOOGLE_SSO_MANAGED_ELIGIBLE_KEY, eligible);
      }

      const shadowClientId = await read('PLATFORM_GOOGLE_CLIENT_ID');
      if (!shadowClientId && managedFlag === 'true' && clientId && clientSecret) {
        const hubCallback = callbackUrl || getAuthHubCallbackUrl();
        await settingsQueries.upsertSetting(db, 'PLATFORM_GOOGLE_CLIENT_ID', clientId);
        await settingsQueries.upsertSetting(db, 'PLATFORM_GOOGLE_CALLBACK_URL', hubCallback);
        const { upsertSecretSetting } = await import('../utils/settingsSecrets.js');
        await upsertSecretSetting(db, 'PLATFORM_GOOGLE_CLIENT_SECRET', clientSecret);
      }

      console.log(`✅ Migration 47: GOOGLE_SSO_MODE=${mode}, platform shadow backfilled when applicable`);
    }
  },
  {
    version: 48,
    name: 'add_users_activated_at',
    description: 'Track first activation so TEAM chips hide pending invites',
    up: async (db) => {
      await dbExec(db, 'ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL');
      await dbExec(
        db,
        `UPDATE users
         SET activated_at = COALESCE(updated_at, created_at)
         WHERE is_active = true AND activated_at IS NULL`
      );
      await dbExec(
        db,
        `UPDATE users u
         SET activated_at = COALESCE(u.updated_at, u.created_at)
         WHERE u.activated_at IS NULL
           AND EXISTS (
             SELECT 1 FROM user_invitations ui
             WHERE ui.user_id = u.id AND ui.used_at IS NOT NULL
           )`
      );
      await dbExec(
        db,
        `UPDATE users u
         SET activated_at = COALESCE(u.updated_at, u.created_at)
         WHERE u.is_active = false
           AND u.activated_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM user_invitations ui
             WHERE ui.user_id = u.id AND ui.used_at IS NULL
           )`
      );
      console.log('✅ Migration 48: users.activated_at present and backfilled');
    }
  },
  {
    version: 49,
    name: 'clear_empty_google_sso_off',
    description:
      'Treat never-configured Google SSO as unset (empty mode), not Disabled with no credentials',
    up: async (db) => {
      const { settings: settingsQueries } = await import('../utils/sqlManager/index.js');
      const { GOOGLE_SSO_MODE_KEY, GOOGLE_SSO_RESUME_MODE_KEY } = await import(
        '../constants/ssoSettings.js'
      );
      const read = async (key) => {
        const row = await settingsQueries.getSettingByKey(db, key);
        return String(row?.value ?? '').trim();
      };
      const mode = await read(GOOGLE_SSO_MODE_KEY);
      const resume = await read(GOOGLE_SSO_RESUME_MODE_KEY);
      const clientId = await read('GOOGLE_CLIENT_ID');
      if (mode === 'off' && !resume && !clientId) {
        await settingsQueries.upsertSetting(db, GOOGLE_SSO_MODE_KEY, '');
      }
      console.log('✅ Migration 49: empty Google SSO off-state cleared when never configured');
    }
  }
];

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
`;

const INSERT_MIGRATION_SQL =
  'INSERT INTO schema_migrations (version, name, description) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING';

/**
 * Run all pending database migrations
 * @param {import('../config/postgresDatabase.js').default} db
 */
export const runMigrations = async (db) => {
  try {
    console.log('\n🔄 Checking for pending database migrations...');

    await dbExec(db, SCHEMA_MIGRATIONS_DDL);

    const appliedMigrations = await dbAll(db.prepare('SELECT version FROM schema_migrations ORDER BY version'));
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));

    // Migrations 1-10 have been integrated into CREATE_TABLES_SQL in database.js
    const integratedMigrationNames = [
      { version: 1, name: 'add_reporting_tables', description: 'Add tables for activity tracking, achievements, and reporting' },
      { version: 2, name: 'add_sprint_columns', description: 'Add is_active, description, and updated_at columns to planning_periods table' },
      { version: 3, name: 'add_task_snapshots_columns', description: 'Add missing columns to task_snapshots table for reporting' },
      { version: 4, name: 'add_badges_table', description: 'Create badges master table with predefined achievements' },
      { version: 5, name: 'add_watchers_added_column', description: 'Add watchers_added column to user_points table' },
      { version: 6, name: 'add_badge_id_column', description: 'Add badge_id column to user_achievements table' },
      { version: 7, name: 'add_notification_queue', description: 'Add persistent notification queue table to survive server restarts' },
      { version: 8, name: 'add_performance_indexes', description: 'Add indexes on frequently queried columns for better performance with large datasets' },
      { version: 9, name: 'add_sprint_id_to_tasks', description: 'Add sprint_id column to tasks for direct sprint association (agile workflow support)' },
      { version: 10, name: 'add_priority_id_to_tasks', description: 'Add priority_id column to tasks table and migrate from priority name to priority ID' }
    ];

    const missingIntegratedMigrations = integratedMigrationNames.filter(m => !appliedVersions.has(m.version));

    if (missingIntegratedMigrations.length > 0) {
      console.log(`📦 Marking ${missingIntegratedMigrations.length} integrated migration(s) as applied (already in CREATE_TABLES_SQL)...`);

      const insertStmt = db.prepare(INSERT_MIGRATION_SQL);
      for (const migration of missingIntegratedMigrations) {
        await dbRun(insertStmt, migration.version, migration.name, migration.description || '');
      }

      console.log(`✅ Marked ${missingIntegratedMigrations.length} integrated migration(s) as applied\n`);
    }

    const updatedAppliedMigrations = await dbAll(db.prepare('SELECT version FROM schema_migrations ORDER BY version'));
    const updatedAppliedVersions = new Set(updatedAppliedMigrations.map(m => m.version));

    const pendingMigrations = migrations.filter(m => !updatedAppliedVersions.has(m.version));

    if (pendingMigrations.length === 0) {
      console.log('✅ Database is up to date (no pending migrations)\n');
      return { success: true, applied: 0 };
    }

    console.log(`📋 Found ${pendingMigrations.length} pending migration(s):\n`);
    pendingMigrations.forEach(m => {
      console.log(`   • Version ${m.version}: ${m.name}`);
    });
    console.log('');

    let appliedCount = 0;

    for (const migration of pendingMigrations) {
      console.log(`⚙️  Applying migration ${migration.version}: ${migration.name}`);

      try {
        const migrationResult = migration.up(db);
        if (migrationResult && typeof migrationResult.then === 'function') {
          await migrationResult;
        }

        const insertStmt = db.prepare(INSERT_MIGRATION_SQL);
        await dbRun(insertStmt, migration.version, migration.name, migration.description || '');

        appliedCount++;
        console.log(`✅ Migration ${migration.version} applied successfully\n`);
      } catch (error) {
        console.error(`❌ Migration ${migration.version} failed:`, error.message);
        console.error('   Migration rolled back. Database state is unchanged.\n');
        throw error;
      }
    }

    console.log(`🎉 All ${appliedCount} migration(s) completed successfully!\n`);

    return { success: true, applied: appliedCount };
  } catch (error) {
    console.error('❌ Migration system failed:', error);
    throw error;
  }
};

/**
 * Get migration status (for admin API)
 * @param {import('../config/postgresDatabase.js').default} db
 */
export const getMigrationStatus = async (db) => {
  try {
    await dbExec(db, SCHEMA_MIGRATIONS_DDL);

    const appliedMigrations = await dbAll(db.prepare(`
      SELECT version, name, description, applied_at 
      FROM schema_migrations 
      ORDER BY version DESC
    `));

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    const pendingMigrations = migrations.filter(m => !appliedVersions.has(m.version));

    const latestMigrationVersion = migrations.length > 0
      ? Math.max(...migrations.map(m => m.version))
      : 10;

    return {
      current_version: appliedMigrations[0]?.version || 0,
      latest_version: latestMigrationVersion,
      applied: appliedMigrations,
      pending: pendingMigrations.map(m => ({
        version: m.version,
        name: m.name,
        description: m.description
      })),
      status: pendingMigrations.length === 0 ? 'up-to-date' : 'pending'
    };
  } catch (error) {
    console.error('Error getting migration status:', error);
    throw error;
  }
};

export default { runMigrations, getMigrationStatus };
