# Agila

A collaborative **Kanban workspace** for teams: multi-board drag-and-drop, List, Gantt, and Calendar views, real-time collaboration, optional sprint timeboxing with burndown, and an optional **AI Agent** that can assist on tasks, work linked Git repos, or (for admins) run board automations. Built with React/TypeScript, Node.js/Express, and PostgreSQL.

<img src="/screenshots/overview.png" alt="Screenshot of easy-kanban" width="100%">

*[View sample screenshots →](/screenshots/SCREENSHOTS.md)*

**Quick start (Docker):** `git clone https://github.com/drenlia-inc/agila.git && cd agila && cp docker-compose-example.yml docker-compose.yml && docker compose up --build -d` — then open http://localhost:3010. Default admin is created on first boot; see [Installation](#installation).

## Key Features

### Core Functionality
- **Multi-board Kanban system** with drag-and-drop functionality
- **Soft WIP limits** on columns (warn when at/over limit; moves still allowed)
- **Card aging** (days in column) and optional **blocked** flag
- **Column policy notes** for short entry/exit guidance
- **Multiple view modes**: Kanban (visual board), List (table format), Gantt (timeline), and Calendar (month/week/day) views
- **Real-time collaboration** - see changes instantly as team members work
- **User authentication** with local accounts and Google OAuth support
- **Role-based access control** (Admin/User/Viewer permissions)
- **Theme support** - Light and dark mode

### AI Agent (optional)
- **Assign tasks to an Agent** when an admin enables AI for the instance
- **Assist** — Agent comments on the task using a configured LLM (OpenAI, Anthropic, OpenRouter, Ollama, or custom OpenAI-compatible)
- **Code** — Agent works a linked Git repository via the push runner (users add Profile → Dev credentials: API token and/or SSH key)
- **Automation** (admins) — board automation with dry-run review, Apply, and Undo
- **Live activity** on the card (queued / running / waiting) with pause, stop, and resume
- Configure in **Settings → System Settings → AI** (enable AI, provider, model, runner URL/token). Details: [Documentation.md — AI Agent](/Documentation.md#ai-agent) and [`docs/AI_INTEGRATION.md`](/docs/AI_INTEGRATION.md)

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
- **Calendar View** - Month, week, and day grids with date-only move/resize, comments, and multi-select date nudge
- **Advanced search & filtering** - Filter by text, dates, members, priorities, tags, project IDs, overdue, blocked, multi-sprint, stalled days, and linked tasks
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
- **Soft-delete restore** - Recover tasks and boards from trash (board trash + Settings → Lifecycle)
- **Export functionality** - Export tasks to CSV or Excel format (admin only)
- **Excel export** - Multi-sheet Excel files with proper formatting when exporting all boards
- **File uploads** - Task attachments and user avatars with size and type restrictions
- **Database backup** - PostgreSQL dump/restore scripts (see [Database Backup & Restore](#database-backup--restore))

### Additional Features
- **Email notifications** - Configurable email notifications for task activities
- **Gamification** - Points, achievements, and leaderboard (when enabled)
- **Keyboard shortcuts** - F1 for help, efficient keyboard navigation
- **Column persistence** - Column preferences saved between sessions

## Getting Started

**Product Owners / Scrum Masters:** after the instance is up, follow the **[Delivery Playbook](docs/DELIVERY_PLAYBOOK.md)** (first-hour setup, board & WIP conventions, rituals, anti-patterns).

1. Log in with the default admin account (see [Installation](#installation))
2. Open Settings from your profile menu and setup:
   1. The site name and URL in Site Settings
   2. In the App Settings, choose the default language (FR/EN)
   3. Review the Project Settings (and **Features** for board indicators / effort / overdue)
   4. Add sprints in **Project Settings → Sprints**
   5. Review Reports Settings
3. Create team members in the Users Tab
4. Go to Kanban View and set up your boards and columns
5. Start creating and managing tasks
6. Configure Google OAuth (optional) in Settings → System Settings → SSO
7. Configure AI Agent (optional) in Settings → System Settings → AI — for coding jobs, users then add Profile → Dev credentials

## Permissions

| Action | Admin | User | Viewer |
|--------|-------|------|--------|
| View kanban boards | ✓ | ✓ | ✓ |
| View List, Gantt, and Calendar views | ✓ | ✓ | ✓ |
| Create/edit/delete tasks | ✓ | ✓ | ✗ |
| Add comments and attachments | ✓ | ✓ | ✓ |
| Move tasks between columns | ✓ | ✓ | ✗ |
| Associate tasks with sprints | ✓ | ✓ | ✗ |
| Assign tasks to AI Agent (when enabled) | ✓ | ✓ | ✗ |
| Configure AI Agent / runner | ✓ | ✗ | ✗ |
| Create/edit/delete boards | ✓ | ✗ | ✗ |
| Soft-delete / restore boards (Lifecycle) | ✓ | ✗ | ✗ |
| Reorder boards and columns | ✓ | ✗ | ✗ |
| Manage columns (add/remove/reorder) | ✓ | ✗ | ✗ |
| Access Settings (profile menu) | ✓ | ✗ | ✗ |
| Manage users | ✓ | ✗ | ✗ |
| Configure site settings | ✓ | ✗ | ✗ |
| Configure Google OAuth | ✓ | ✗ | ✗ |
| Configure mail server | ✓ | ✗ | ✗ |
| Manage tags and priorities | ✓ | ✗ | ✗ |
| Lifecycle retention & permanent purge | ✓ | ✗ | ✗ |
| Export data (CSV/Excel) | ✓ | ✗ | ✗ |
| Access Reports (when enabled) | ✓ | ✓* | ✓* |
| View Leaderboard (when enabled) | ✓ | ✓* | ✓* |
| Update own profile | ✓ | ✓ | ✓ |
| Configure own notifications | ✓ | ✓ | ✓ |
| Manage own Dev credentials (API token / SSH) | ✓ | ✓ | ✗ |
| Multi-select / bulk task actions | ✓ | ✓ | ✗ |
| Restore own trashed tasks (board trash) | ✓ | ✓ | ✗ |
*Some reports may be restricted to admins only depending on settings. Viewers are read-only for board/task data; they can still comment, watch themselves, and save personal (non-shared) views.

## Requirements

- Node.js v20.18+

## Installation

### Docker (recommended)

```bash
git clone https://github.com/drenlia-inc/agila.git
cd agila
cp docker-compose-example.yml docker-compose.yml
docker compose up --build -d
```

Containers start in the background. For a foreground session with live logs (typical local development), use `npm run docker:dev` (`docker compose up --build`, no `-d`).

Before the first production run, edit `docker-compose.yml`:
- `JWT_SECRET`: strong secret for authentication
- `ALLOWED_ORIGINS`: your domain(s), e.g. `yourdomain.com`
- `DEMO_ENABLED`: `false` for a real instance; `true` only for a generated demo dataset
- Optional AI runner (Agent **Code** jobs): `AI_RUNNER_URL`, `AI_CALLBACK_BASE_URL`, `RUNNER_TOKEN`

**Access:** frontend http://localhost:3010 · API http://localhost:3222

More detail: [DOCKER.md](/DOCKER.md)

### Default admin (first boot)

On a **new empty database**, Agila creates `admin@kanban.local` with a **random password** and prints it **once** in the app container logs (banner `ADMIN ACCOUNT CREDENTIALS`). After `docker compose up --build -d`, wait a few seconds for Postgres and first boot, then:

```bash
docker compose logs | grep -A5 'ADMIN ACCOUNT CREDENTIALS'
```

You should see:

```text
   ADMIN ACCOUNT CREDENTIALS
===========================================
   Email: admin@kanban.local
   Password: <generated>
===========================================
```

If grep prints nothing, wait and run it again (or `docker compose logs -f` and watch for that banner).

- **`DEMO_ENABLED=true`:** the login page also shows this password (and a one-click sign-in on the public demo).
- **`DEMO_ENABLED=false`:** the password is **not** shown on the login page — only in those first-boot logs.
- Later restarts **do not** print the password again. If you lose it, reset it from another admin account; it will not reappear in logs.

## Database Backup & Restore

Agila uses **PostgreSQL** for application data (and Redis for real-time). Docker Compose starts both with the app. Use the scripts below for dump/restore.

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

Stop the **app** first (leave Postgres running). If the app is still writing while you load a dump, you can get mixed old/new rows or a failed restore.

```bash
docker compose stop agila-app

gunzip -c ./backups/kanban-latest.sql.gz \
  | docker exec -i agila-postgres psql -U kanban_user -d kanban
# or: ./scripts/restore-postgres.sh

docker compose start agila-app
```

The site is down only for those few commands. Do not `docker compose down` unless you intend to remove containers; the Postgres volume must stay so the restore has a database to load into.

## Security

The application includes JWT-based authentication and role-based access control. For production deployments:

- Change the default admin password immediately
- Set a strong `JWT_SECRET` in production
- Keep `DEMO_ENABLED=false` (demo compose is the exception)
- Configure HTTPS/TLS at the reverse proxy
- Attachments/avatars use an HttpOnly media cookie (not the session JWT in `?token=`)
- Review **Settings → App Settings → Troubleshooting → CSP reports** before enforcing Content-Security-Policy
- Consider additional network security measures

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
