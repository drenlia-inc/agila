# AI Integration (Developer Guide)

Agila can assign tasks to an **Agent** pseudo-user that runs coding or assist jobs via a push-based **runner** and a configured **LLM provider**. This document covers architecture, settings, data model, APIs, and local setup for developers.

Related user-facing docs: [`Documentation.md`](../Documentation.md) (Admin AI Settings, Profile → Dev, Assign to Agent).

---

## Architecture overview

```
┌─────────────┐     assign / queue      ┌──────────────────┐
│  React UI   │ ───────────────────────►│  Agila API       │
│  (JWT)      │ ◄── task-work-updated ──│  (Express)       │
└─────────────┘      (WebSocket)        └────────┬─────────┘
                                                 │
                    POST /v1/jobs (Bearer RUNNER_TOKEN)
                                                 ▼
                                        ┌──────────────────┐
                                        │  Agent Runner    │
                                        │  (runner/)       │
                                        └────────┬─────────┘
                                                 │
                    POST /api/agent/runner/callback
                    (X-Agent-Callback-Token)
                                                 ▼
                                        ┌──────────────────┐
                                        │  task_work +     │
                                        │  comments / PRs  │
                                        └──────────────────┘
```

**Three job modes:**

| Mode | When | Runner needs | Outcome |
|------|------|--------------|---------|
| **assist** | Empty `repo_url`, `agent_mode`≠automation | Runner + LLM only | Comment / Q&A from task context |
| **code** | Task has `repo_url` | Runner + owner GitHub PAT and/or SSH key | Clone → tool loop → commit/push → optional PR |
| **automation** | `agent_mode=automation` (admins only) | Runner + short-lived `ea_…` job token | LLM tools call `/api/agent/automation`; dry-run → Apply → journal undo |

The app **pushes** jobs to the runner (`agentJobDispatcher` → `agentRunnerClient`).

---

## Key source files

| Area | Path |
|------|------|
| Settings keys / defaults | `server/constants/aiSettings.js` |
| Provider presets | `server/constants/aiProviders.js`, `src/constants/aiProviders.ts` |
| Agent fixed UUIDs | `server/constants/agentIdentity.js`, `src/constants/appConstants.ts` |
| AI gate middleware | `server/utils/aiEnabled.js` |
| LLM connectivity probes | `server/utils/aiConnectivity.js` |
| Dispatch / launch | `server/services/agentJobDispatcher.js` |
| Runner HTTP client | `server/services/agentRunnerClient.js` |
| Agent automation API | `server/routes/agent.js` → `/api/agent` |
| Runner callbacks | `server/routes/agentRunnerCallback.js` → `/api/agent/runner` |
| User task_work / control | `server/routes/taskWork.js` → `/api/tasks/…` |
| Profile Dev credentials | `server/routes/userDev.js` → `/api/user/dev` |
| Admin AI validate/probe | `server/routes/settings.js` (`/api/admin/settings/ai/…`) |
| `task_work` sqlManager | `server/utils/sqlManager/taskWork.js` |
| Runner service | `runner/src/` (`index.js`, `agentLoop.js`, `llmClient.js`, `git.js`, …) |
| Admin UI | `src/components/admin/AdminAISettingsTab.tsx` |
| Assign / activity UI | `AssignToAgentModal.tsx`, `AgentWorkingModal.tsx`, `TaskCard.tsx` |
| Profile Dev tab | `src/components/profile/ProfileDevTab.tsx` |

Migrations: **15** (`add_ai_agent_platform`), **16** (`AI_PROVIDER`), **17** (runner + max concurrent), **18** (`user_github_tokens`).

---

## Enablement & settings

### Master switch

- Tenant setting `AI_ENABLED` (`"true"` / `"false"`).
- When off: Agent assignee and Dev/agent APIs return **403**; UI hides agent affordances (public settings still expose `AI_ENABLED` so the client can gate UI before login-heavy flows).
- Gating helper: `isAiEnabled(db)` / `requireAiEnabledMiddleware(getRequestDatabase)`.

### Tenant settings (`settings` table)

| Key | Purpose | Secret? | Public GET `/api/settings`? |
|-----|---------|---------|------------------------------|
| `AI_ENABLED` | Master switch | No | Yes |
| `AI_PROVIDER` | `openai` \| `anthropic` \| `openrouter` \| `ollama` \| `custom` | No | Yes |
| `AI_API_BASE_URL` | Provider base URL (often `…/v1`) | No | No |
| `AI_API_KEY` | Provider API key | Yes (masked) | No |
| `AI_MODEL` | Default model id | No | No |
| `AI_AGENT_NAME` | Display name for Agent member | No | Yes |
| `AI_MAX_CONCURRENT` | Max running agent jobs per tenant (1–10) | No | Yes |
| `AI_RUNNER_URL` | Runner base URL | No | No |
| `AI_RUNNER_TOKEN` | Shared Bearer token with runner | Yes (masked) | No |

Defaults: `server/constants/aiSettings.js` (`AI_SETTING_DEFAULTS`).

### Platform environment variables

Used when tenant settings are empty, or for Docker networking:

| Env | Role |
|-----|------|
| `AI_RUNNER_URL` / `RUNNER_URL` | Default runner URL (compose: `http://agila-runner:8080`) |
| `AI_RUNNER_TOKEN` / `RUNNER_TOKEN` | Shared secret; must match runner `RUNNER_TOKEN` |
| `AI_CALLBACK_BASE_URL` | Absolute base for runner→app callbacks (compose: `http://agila-app:3222`) |
| Runner `PORT`, `MAX_CONCURRENT` | Runner listen port and local job pool size |

See `docker-compose-example.yml` or `docker-compose-dev.yml` (`kanban-app` + `kanban-runner`). Demo compose omits the runner by default.

### Admin API helpers

All require admin JWT:

- `POST /api/admin/settings/ai/validate` — probe LLM connectivity (optional body overrides)
- `GET /api/admin/settings/ai/providers` — provider presets
- `POST /api/admin/settings/ai/models` — list models from provider
- `POST /api/admin/settings/ai/runner/probe` — `GET {runner}/v1/status` with Bearer token

---

## Agent identity

Fixed IDs (not a licensed seat; `is_active = false`, cannot log in):

| Constant | UUID |
|----------|------|
| `AGENT_USER_ID` | `00000000-0000-0000-0000-000000000010` |
| `AGENT_MEMBER_ID` | `00000000-0000-0000-0000-000000000011` |

Seeded in migration 15 / `database.js`. Assignable when AI is enabled. Display name follows `AI_AGENT_NAME`.

---

## Data model: `task_work`

Flexible KV store per task (`task_id`, `key`, `value`). No migration per new key.

### Common keys

| Key | Meaning |
|-----|---------|
| `status` | `queued` \| `running` \| `paused` \| `waiting` \| `stopped` \| `done` \| `failed` |
| `control` | User intent: `none` \| `pause` \| `stop` \| `resume` |
| `repo_url` | Git remote; empty = assist mode |
| `repo_branch` | Base branch hint |
| `llm_model` | Per-task model override (admins only via API) |
| `agent_owner_user_id` | User whose GitHub PAT / SSH key is used for code jobs |
| `log` | Append-only activity log (newline-separated) |
| `progress` | Runner progress string |
| `pr_url` / `agent_branch` | Outcome links |
| `callback_token` / `runner_job_id` | In-flight job binding |
| `claimed_by` / `claimed_at` | Claim metadata |
| `waiting_for_slot` | Runner pool busy |

Atomic claim for pull-style runners: `claimAgentTask` updates `status` `queued` → `running` with conditional `UPDATE … RETURNING` (safe across pods).

Frontend status constants: `AGENT_WORK_STATUSES` in `src/constants/appConstants.ts`.

---

## User credentials (Profile → Dev)

All under `/api/user/dev`, require auth + `AI_ENABLED`.

| Resource | Storage | Notes |
|----------|---------|-------|
| **API tokens (PAT)** | `user_api_tokens` | Prefix `ek_…`; bcrypt hash; raw value shown once. Authenticates like JWT via `authenticateToken`. |
| **SSH keypair** | `user_ssh_keys` | Ed25519; private key encrypted at rest (`sshKeyCrypto.js`). |
| **GitHub PAT** | `user_github_tokens` | Encrypted; used for clone/push/PR API. Not a tenant admin secret. |
| **Repo probe** | `POST /user/dev/github-repo-probe` | Rate-limited check that PAT can see a repo. |
| **Agent LLM (read)** | `GET /user/dev/agent-llm` | Tenant `AI_MODEL` for UI (no secrets). |

Coding jobs load credentials for `agent_owner_user_id` (the assigning user). Missing creds → launch skipped / `failed` with a log line.

---

## Job lifecycle

1. User assigns task to Agent and sets work (`PUT /api/tasks/:taskId/work` with `status: queued`, optional `repoUrl` / `repoBranch`). **Non-empty task description required** to queue.
2. `tryLaunchQueuedTasks` respects `AI_MAX_CONCURRENT` and launches until capacity.
3. Dispatcher builds payload (task, comments, LLM config, git secrets, callback URL/token) and `POST`s to runner `/v1/jobs`.
4. On accept, `task_work.status` → `running`; WebSocket `task-work-updated`.
5. Runner runs `agentLoop` (tools: list/read/write file, allowlisted commands, finish) and callbacks progress/logs/comments/terminal events.
6. Callback auth: header `X-Agent-Callback-Token` must match `task_work.callback_token`.
7. Terminal events (`done` / `failed` / `stopped` / `cancelled`) clear callback token and may re-dispatch queued work.
8. User **pause/stop/resume** via `PUT /api/tasks/:taskId/work/control` (cancels remote job on pause/stop; resume re-queues and dispatches).

Periodic re-dispatch: `server/jobs/scheduler.js` calls `tryLaunchQueuedTasks` for known tenant DBs (same multi-tenant cache caveat as other cron jobs — see AGENTS.md).

Real-time: `notificationService.publish('task-work-updated', …)` (and comment/task events as usual).

---

## HTTP APIs (summary)

### `/api/agent` (JWT or `ek_` PAT, AI required)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tasks/pending` | Queued agent tasks |
| POST | `/tasks/:id/claim` | Atomic claim (rate-limited) |
| GET | `/tasks/:id` | Task + work + attachments |
| POST | `/tasks/:id/move` | Move column |
| POST | `/tasks/:id/comments` | Agent comment; optional `markWaiting` |
| POST | `/tasks/:id/attachments` | Attach metadata rows |
| PATCH | `/tasks/:id` | Limited fields (**not** title/description) |
| GET/PUT | `/tasks/:id/work` | Read/update work map (+ `appendLog`) |
| GET | `/control/:id` | Poll `status` / `control` |

### `/api/agent/runner`

| Method | Path | Auth |
|--------|------|------|
| POST | `/callback` | Per-job `callback_token` (not user JWT) |

### `/api/tasks` (task_work, user JWT)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/:taskId/work` | Work map |
| PUT | `/:taskId/work` | Bind repo / queue / config (incl. `agentMode`, automation scope) |
| PUT | `/:taskId/work/control` | pause \| stop \| resume \| apply \| none |
| POST | `/work-maps` | Batch work maps for board UI |

### `/api/agent/automation` (job token `ea_…` or admin JWT for undo)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/tools` | Automation Bearer | Execute allowlisted tool (`dryRun` supported) |
| GET | `/status` | Automation Bearer | Poll status/control (`apply` signal) |
| POST | `/apply` | Automation Bearer | Apply stored dry-run plan (journaled, idempotent) |
| POST | `/undo/:taskId` | Admin JWT | Reverse journal for last Apply; sets status `undone`, Agent comment, hides further Undo |

Automation tools wrap sqlManager (tasks, boards, columns, sprints, tags, comments, exports). Deletes of tasks/boards/columns are denied. See `server/constants/automation.js` and `server/services/automationTools.js`.

**Launch-task exclusion:** the recipe/launch card that started the job is never a search or mutation target (so recipe text like “move tasks containing …” does not match itself). **Discovery performance:** `search_tasks` returns `descriptionPreview` by default; prefer that (or bulk `get_tasks`) over many `get_task` calls. **Human summaries:** `search_tasks` / `get_task(s)` include `boardTitle` and `columnTitle`; dry-run and finish text should use titles, not raw board UUIDs (IDs remain for tool arguments).

### Runner (`runner/`, Bearer `RUNNER_TOKEN`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Unauthenticated liveness |
| GET | `/v1/status` | Pool status |
| POST | `/v1/jobs` | Accept job (202) |
| GET | `/v1/jobs/:jobId` | Job snapshot |
| POST | `/v1/jobs/:jobId/cancel` | Request cancel |

Automation jobs run `runner/src/automationLoop.js` (discover → `submit_dry_run_plan` → wait for `control=apply` → `/apply` → `finish`).

---

## Auth notes

- Standard routes: `Authorization: Bearer <JWT>`.
- PATs (`ek_…`) are accepted by `authenticateToken` when JWT verify fails / token looks like a PAT (`server/middleware/auth.js`). Use PATs for JSON `/api/agent` (and other API) calls from tools/runners — not for browser `<img>` loads.
- **Browser media** (avatars, attachment previews): HttpOnly `ek_media` cookie (`purpose: media` JWT) from `POST /api/files/media-session`. Session JWTs must not appear in `?token=` on file URLs. Media tokens cannot authorize normal API routes.
- **Automation job tokens** (`ea_…`): short-lived, sha256-hashed in `agent_automation_tokens`, scoped to boards; not user Profile Dev PATs.
- Runner ↔ app: shared `RUNNER_TOKEN` for job APIs; **per-job** callback token for callbacks (do not reuse runner token as callback auth).
- Never log raw API keys, PATs, or SSH private keys. Admin GETs mask `AI_API_KEY` / `AI_RUNNER_TOKEN` like SMTP secrets.

---

## Frontend surfaces

- **Admin → AI Settings**: enable AI, provider/model, runner URL/token, max concurrent, validate LLM + probe runner.
- **Profile → Dev** (when AI on): mint API tokens, SSH key, GitHub PAT, repo probe.
- **Assign to Agent**: Assist | Code | **Automation** (admins); automation scope this board / selected / all boards.
- **Task cards**: Agent-assigned cards use the bot avatar and a soft teal wash while work is active; activity screen with live log; pause/stop/resume; for automation **Apply** / **Undo**. Agent is pinned last in team/assignee lists.
- Copy of an automation task clones config keys (`agent_mode`, scope, board ids) and resets runtime; edit + Re-run starts a new job.
- Public settings sync includes `AI_ENABLED`, `AI_AGENT_NAME`, `AI_PROVIDER`, `AI_MAX_CONCURRENT` for UI gating.

---

## Local development (Docker Compose Pro)

1. Use compose that includes `kanban-runner` (e.g. `docker-compose-example.yml` or `docker-compose-dev.yml`).
2. Align `RUNNER_TOKEN` on app and runner; set `AI_RUNNER_URL` and `AI_CALLBACK_BASE_URL` for in-network callbacks.
3. In Admin → AI Settings: enable AI, configure provider/key/model, set runner URL/token (or rely on env defaults), **Validate** LLM and **Probe** runner.
4. In Profile → Dev: add GitHub PAT (and/or SSH) for private repos / PRs.
5. Assign a task with a description to Agent; watch `task_work` / Agent activity screen / runner logs.
6. For Automation: admin assigns with scope → review dry-run → **Apply** → optional **Undo**.

**Ollama from Docker:** use `host.docker.internal` (or host LAN IP), not `localhost` inside the container — see provider hint in `aiProviders.js`.

---

## Security & multi-tenant checklist

- All agent/user-dev routes authenticated; AI routes also check `AI_ENABLED`.
- Automation assign/apply/undo are **admin-only**; job token is board-scoped with blast-radius caps.
- Mutation journal (`agent_automation_journal`) enables undo of the last Apply; successful Apply sets `automation_undoable`; Undo sets status `undone` with a summary comment and disables further Undo until the next Apply.
- Secrets encrypted or hashed at rest; masked in admin responses.
- Git credentials are **per assigning user**, not a shared tenant admin PAT.
- Concurrent launches capped per tenant (`AI_MAX_CONCURRENT`); automation also uses a simple concurrency lock across active automation jobs.
- Rate limiters: agent claim, token mint, GitHub repo probe (`server/middleware/rateLimiters.js`).
- Agent must not rewrite task title/description via PATCH (comments only); automation may update titles via allowlisted tools after Apply.
- Callback token is single-job scoped and cleared on terminal events.

---

## Extending the platform

- **New `task_work` keys**: write via sqlManager upsert; no schema migration.
- **New automation tool**: add to `AUTOMATION_CAPABILITIES`, implement in `automationTools.js`, expose schema in `runner/src/automationLoop.js`.
- **New LLM provider**: add preset in `server/constants/aiProviders.js` + FE mirror; extend `aiConnectivity.js` / runner `llmClient.js` if auth/style differs.
- **Alternate runner**: implement push consumer of `/v1/jobs` or poll `/api/agent` claim APIs with a user PAT; always callback with the minted token.
- **New activity events**: use `AGENT_ACTIONS` in `activityActions.js` and bilingual locale keys.

When changing enqueue/dispatch, re-read AGENTS.md notes on multi-tenant cron and pod DB cache so new tenants are not skipped by background launchers.
