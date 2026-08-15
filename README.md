# Agila

**Agila**

A collaborative **Kanban workspace** for teams: multi-board drag-and-drop, List and Gantt views, real-time collaboration, optional sprint timeboxing with burndown, and an optional **AI Agent** that can assist on tasks, work linked Git repos, or (for admins) run board automations. Built with React/TypeScript, Node.js/Express, and PostgreSQL.

<img src="/screenshots/overview.png" alt="Screenshot of easy-kanban" width="100%">

*[View sample screenshots →](/screenshots/SCREENSHOTS.md)*

## Key Features

### Core Functionality
- **Multi-board Kanban system** with drag-and-drop functionality
- **Soft WIP limits** on columns (warn when at/over limit; moves still allowed)
- **Card aging** (days in column) and optional **blocked** flag
- **Column policy notes** for short entry/exit guidance
- **Multiple view modes**: Kanban (visual board), List (table format), and Gantt (timeline) views
- **Real-time collaboration** - see changes instantly as team members work
- **User authentication** with local accounts and Google OAuth support
- **Role-based access control** (Admin/User permissions)
- **Theme support** - Light and dark mode

### AI Agent (optional)
- **Assign tasks to an Agent** when an admin enables AI for the instance
- **Assist** — Agent comments on the task using a configured LLM (OpenAI, Anthropic, OpenRouter, Ollama, or custom OpenAI-compatible)
- **Code** — Agent works a linked Git repository via the push runner (users add Profile → Dev credentials: API token and/or SSH key)
- **Automation** (admins) — board automation with dry-run review, Apply, and Undo
- **Live activity** on the card (queued / running / waiting) with pause, stop, and resume
- Configure in **Admin → AI Settings** (enable AI, provider, model, runner URL/token). Details: [Documentation.md — AI Agent](/Documentation.md#ai-agent) and [`docs/AI_INTEGRATION.md`](/docs/AI_INTEGRATION.md)

### Task Management
- **Task management** with priorities, comments, and file attachments
- **Rich text editing** for task descriptions and comments with formatting, links, and embedded content
- **Task relationships** - Link tasks as parent-child or related relationships
- **Task view modes** - Full, Preview, and Minimal card density for optimal screen space
- **Task toolbar** - Quick actions on hover (assign members, change priority, add tags, copy tasks)
- **Quick edit** - Inline editing without opening full task details
- **Multi-select & bulk actions** - Select tasks (per card or Select all per column); bulk tag, copy, sprint, priority, archive, delete, and move to another board; drag multi-selected tasks between columns
- **Task watchers & collaborators** - Add team members to watch or collaborate on tasks
- **Requesters** - Track who requested each task
- **Sprint association** - Organize tasks by time-based planning periods
- **Soft delete & trash** - Deleted tasks go to board trash; restore or permanently purge
### Team & Collaboration
- **Team management** with color-coded member assignments
- **Activity feed** - Draggable panel showing real-time changes, comments, and team activity
- **Member filtering** - Filter tasks by assignees, watchers, collaborators, requesters, and system tasks

### Views & Navigation
- **Kanban View** - Visual board with drag-and-drop between columns (including cross-board drops onto board tabs)
- **List View** - Table format with sorting, filtering, column configuration, and horizontal scrolling
- **Gantt View** - Timeline view with task dependencies, visual arrows, and date move/resize
- **Advanced search & filtering** - Filter by text, dates, members, priorities, tags, project IDs, and sprints
- **Saved filters** - Save and share frequently used filter combinations
- **Sprint filtering** - Filter tasks by sprint or view backlog (unassigned tasks)
- **EN / FR localization** - Switch language from preferences

### Reporting & Analytics
- **Reports module** - Comprehensive analytics and insights (when enabled)
- **My Stats** - Personal performance dashboard with points, tasks completed, effort, and achievements
- **Leaderboard** - Team rankings based on performance metrics (when gamification enabled)
- **Burndown charts** - Track planned vs actual task completion over time
- **Team Performance** - Team-wide activity metrics and productivity analysis
- **Task List Report** - Detailed task listings with filtering and export capabilities

### Admin Features
- **User management** - Create, edit, invite, activate/deactivate users, assign roles
- **Board & column management** - Create, rename, reorder, and soft-delete boards and columns; set soft WIP and policy text per column
- **Lifecycle (trash)** - Restore or permanently purge soft-deleted tasks and boards; configure retention/auto-purge
- **Site settings** - Configure site name, URL, branding (logo light/dark), and global preferences- **SSO configuration** - Google OAuth Single Sign-On setup
- **Mail server** - SMTP configuration for email notifications and invitations
- **AI Settings** - Enable the AI Agent, choose LLM provider/model, and configure the agent runner
- **Tags management** - Create and manage custom tags with colors
- **Priorities management** - Customize priority levels with names and colors
- **App settings** - Configure default language, view modes, and application behavior
- **Project settings** - Manage project identifiers and board configurations
- **Sprint settings** - Create and manage sprints for time-based task organization
- **Reporting configuration** - Enable/disable reports, gamification, leaderboard, and achievements
- **Licensing** - View and manage license information, usage limits, and subscriptions
- **System monitoring** - Real-time resource monitoring (RAM, CPU, disk usage)

### Data & Export
- **Soft-delete restore** - Recover tasks and boards from trash (board trash + Admin → Lifecycle)
- **Export functionality** - Export tasks to CSV or Excel format (admin only)
- **Excel export** - Multi-sheet Excel files with proper formatting when exporting all boards
- **File uploads** - Task attachments and user avatars with size and type restrictions
- **Database backup** - PostgreSQL dump/restore scripts (see [Database Backup & Restore](#database-backup--restore))

### Additional Features
- **Email notifications** - Configurable email notifications for task activities
- **Gamification** - Points, achievements, and leaderboard (when enabled)
- **Keyboard shortcuts** - F1 for help, efficient keyboard navigation
- **Column persistence** - Column preferences saved between sessions
- **Multi-level sorting** - Sort by multiple columns in List View

## Getting Started

**Product Owners / Scrum Masters:** after the instance is up, follow the **[Delivery Playbook](docs/DELIVERY_PLAYBOOK.md)** (first-hour setup, board & WIP conventions, rituals, anti-patterns).

**Default Admin Account:**
- Email: `admin@kanban.local`
- Password: `generated` at initialization - look for it in the backend console log (or on the login page when demo mode is enabled)

1. Log in with the default admin account
2. Go to the admin panel and setup:
   1. The site name and URL in Site Settings
   2. In the App Settings, choose the default language (FR/EN)
   3. Review the Project Settings (and **Features** for board indicators / effort / overdue)
   4. Add sprints in the Sprint Settings
   5. Review Reports Settings
3. Create team members in the Users Tab
4. Go to Kanban View and set up your boards and columns
5. Start creating and managing tasks
6. Configure Google OAuth (optional) in Admin > SSO settings
7. Configure AI Agent (optional) in Admin > AI Settings — for coding jobs, users then add Profile → Dev credentials

## Permissions

| Action | Admin | User |
|--------|-------|------|
| View kanban boards | ✓ | ✓ |
| View List and Gantt views | ✓ | ✓ |
| Create/edit/delete tasks | ✓ | ✓ |
| Add comments and attachments | ✓ | ✓ |
| Move tasks between columns | ✓ | ✓ |
| Associate tasks with sprints | ✓ | ✓ |
| Assign tasks to AI Agent (when enabled) | ✓ | ✓ |
| Configure AI Agent / runner | ✓ | ✗ |
| Create/edit/delete boards | ✓ | ✗ |
| Soft-delete / restore boards (Lifecycle) | ✓ | ✗ |
| Reorder boards and columns | ✓ | ✗ |
| Manage columns (add/remove/reorder) | ✓ | ✗ |
| Access Admin panel | ✓ | ✗ |
| Manage users | ✓ | ✗ |
| Configure site settings | ✓ | ✗ |
| Configure Google OAuth | ✓ | ✗ |
| Configure mail server | ✓ | ✗ |
| Manage tags and priorities | ✓ | ✗ |
| Lifecycle retention & permanent purge | ✓ | ✗ |
| Export data (CSV/Excel) | ✓ | ✗ |
| Access Reports (when enabled) | ✓ | ✓* |
| View Leaderboard (when enabled) | ✓ | ✓* |
| Update own profile | ✓ | ✓ |
| Configure own notifications | ✓ | ✓ |
| Manage own Dev credentials (API token / SSH) | ✓ | ✓ |
| Multi-select / bulk task actions | ✓ | ✓ |
| Restore own trashed tasks (board trash) | ✓ | ✓ |
*Some reports may be restricted to admins only depending on settings

## Requirements

- Node.js v20.18+

## Installation

### Docker

**Step 1: Clone and setup**
```bash
# Clone the repo
git clone https://github.com/drenlia-inc/agila.git
cd agila
cp docker-compose-example.yml docker-compose.yml
```

**Step 2: Configure and run**
1. Edit `docker-compose.yml` and update the following environment variables:
   - `JWT_SECRET`: Set a strong secret key for authentication
   - `ALLOWED_ORIGINS`: Set your domain(s), e.g., `yourdomain.com`
   - `DEMO_ENABLED`: Set to `true` to try the demo with generated data, `false` for production
   - Optional AI runner (for Agent **Code** jobs): `AI_RUNNER_URL`, `AI_CALLBACK_BASE_URL`, `RUNNER_TOKEN` (see `docker-compose-example.yml` / `docker-compose-dev.yml`)

2. Start the application:
```bash
npm run docker:dev
```

**Access the application:**
- Frontend: http://localhost:3010
- Backend API: http://localhost:3222

*For more Docker information, see [DOCKER.md](/DOCKER.md)*

## Database Backup & Restore

**Breaking change:** Agila is **PostgreSQL-only**. SQLite (`kanban.db`) is no longer supported. All Docker editions (free, demo, basic, pro) run Postgres + Redis. Existing SQLite data must be migrated out-of-band or you must start with a fresh Postgres volume.

### Automated Backup Script

```bash
# Create a timestamped pg_dump (gzipped) under ./backups
./scripts/backup-postgres.sh

# Restore latest (or pass a specific .sql.gz)
./scripts/restore-postgres.sh
./scripts/restore-postgres.sh ./backups/kanban-backup-YYYYMMDD_HHMMSS.sql.gz
```

**Features:**
- Timestamped dumps (`kanban-backup-YYYYMMDD_HHMMSS.sql.gz`)
- Keeps the last 10 dumps
- Latest symlink (`kanban-latest.sql.gz`)

### Manual Backup

```bash
docker exec agila-postgres pg_dump -U kanban_user -d kanban --clean --if-exists \
  | gzip > ./backups/kanban-manual.sql.gz
```

### Restore Database

```bash
gunzip -c ./backups/kanban-latest.sql.gz \
  | docker exec -i agila-postgres psql -U kanban_user -d kanban
```

**Important:** Prefer restoring while the app is stopped or briefly unavailable to avoid concurrent writes during restore.

## Security

The application includes JWT-based authentication and role-based access control. For production deployments:

- Change the default admin password immediately
- Set a strong `JWT_SECRET` in production
- Keep `DEMO_ENABLED=false` (demo compose is the exception)
- Do not set `ALLOW_TEST_ENDPOINTS` on real production hosts
- Configure HTTPS/TLS at the reverse proxy
- Attachments/avatars use an HttpOnly media cookie (not the session JWT in `?token=`)
- Review **Admin → Troubleshooting → CSP reports** before enforcing Content-Security-Policy
- Consider additional network security measures

See also `AGENTS.md` (security checklist) and `audit/security-assessment-current-2026-08.md`.

## Authors and acknowledgment
Developed with AI assistance

## License

MIT License

Copyright (c) 2024–2026 Agila

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Project status

Improvements are always welcome.
