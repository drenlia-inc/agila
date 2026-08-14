# AGENTS.md

## Core Principles
- Prioritize security, maintainability, and least-privilege by default.
- Never ship code that violates these rules unless explicitly instructed otherwise.

## UI / UX (forms & screens)

When designing or changing any screen, treat **density, alignment, and input affordances** as first-class requirements—not polish after the fact.

### Density & vertical rhythm
- Prefer a **medium-compact** layout: enough breathing room to scan and click, without tall empty bands, oversized section padding, or stacked whitespace that forces unnecessary scrolling.
- Tighten vertical spacing where content is related (label → control → hint); keep clearer separation between distinct sections.
- Avoid one-off “spacious” blocks that break the density of surrounding Admin / app chrome.

### Alignment & field width
- Align labels and controls consistently within a form or grid (shared columns, matching baselines, predictable gutters).
- Size inputs to the **expected content length**—short values (ports, days, codes, prefixes, ticket IDs) should use compact widths, not full-bleed `w-full` when that wastes space or weakens the visual hierarchy.
- Prefer grids or fixed/`max-w-*` controls for short fields; reserve full width for prose, descriptions, URLs that may be long, and rich text.

### Dates
- Calendar dates are always **`YYYY-MM-DD`** in the UI and when bound to form controls.
- Use a native **date picker** (`<input type="date">`) so users can pick from a calendar **or type freely**; do not force spinner-style increment/decrement UX.
- Do **not** use `type="number"` (or other spinbutton controls) for calendar dates.
- Follow the project date pipeline (API `YYYY-MM-DD` / `::text`, normalize before binding, local-date display)—see `.cursor/rules/easy-kanban-dates.mdc` and `src/utils/dateUtils.ts`.

### Numeric fields (non-date)
- For quantities and settings that are numbers, allow free typing; hide browser spinner arrows where the project already does (e.g. `ADMIN_NUMERIC_INPUT_CLASS` in `src/utils/adminFieldLimits.ts`) so users are not nudged into click-to-increment behavior.

## Documentation Policy
- **DO NOT create new .md documentation files** unless explicitly requested by the user
- **ESPECIALLY for QA/testing work**: Do NOT create README files, CHANGES files, or summary documents
- Update existing documentation when making changes to related code
- Use code comments for explaining implementation details
- Reserve documentation files for:
  - Major architectural decisions (when requested)
  - Setup/configuration guides (when requested)
  - API reference documentation (when requested)
- Exception: README.md updates are acceptable for significant feature additions

## Package Management (npm)
- Always choose secure, actively maintained packages.
- Packages currently used in this project:
 - **Backend**: `express`, `pg`, `redis`, `socket.io`, `bcrypt`, `jsonwebtoken`, `multer`, `nodemailer`, `node-cron`, `express-rate-limit`, `cors`, `axios`, `zod`, `exceljs`
 - **Frontend**: `react`, `react-dom`, `react-i18next`, `i18next`, `i18next-browser-languagedetector`, `@tiptap/*` (rich text editor), `@dnd-kit/*` (drag-and-drop), `lucide-react`, `react-joyride`, `react-window`, `recharts`, `exceljs`, `dompurify`, `socket.io-client`
  - **Real-time**: `socket.io`, `socket.io-client`, `@socket.io/redis-adapter`, `redis`
  - **Build/Dev**: `vite`, `typescript`, `tailwindcss`, `eslint`, `concurrently`
- Avoid packages with known vulnerabilities, >1 year without updates, or <1k weekly downloads unless there is a very specific reason.
- Use exact versions or caret ranges (^) for dependencies; versions are pinned via package-lock.json for reproducible builds.

## API Routes & Endpoints
- EVERY route must be authenticated by default using `authenticateToken` middleware.
- Only make a route public if it is explicitly listed as public:
  - **Authentication**: `/api/auth/login`, `/api/auth/activate-account`, `/api/auth/verify-invitation`, `/api/auth/google/*`, `/api/auth/demo-credentials`, `/api/auth/check-*`
  - **Password Reset**: `/api/password-reset/request`, `/api/password-reset/reset`, `/api/password-reset/verify/:token`
  - **Health Checks**: `/health`, `/ready`, `/api/ready`, `/api/version`
  - **Public Settings**: `/api/settings` (GET only, for site name, mail status, OAuth config)
  - **CSP reports**: `/api/csp-report` (POST only — browser Content-Security-Policy violation beacons; rate-limited)
  - **Admin Portal**: `/api/admin-portal/*` (uses `INSTANCE_TOKEN` auth, not user JWT)
- Use existing auth middleware from `server/middleware/auth.js`:
  - `authenticateToken` - JWT token validation (required for all protected routes)
  - `requireRole(['admin'])` - Role-based access control for admin-only endpoints
- Apply rate limiting for sensitive public endpoints (see `server/middleware/rateLimiters.js`):
 - `loginLimiter` for login attempts
 - `passwordResetRequestLimiter` (3/hour) and `passwordResetCompletionLimiter` (6/hour)
 - `registrationLimiter`, `invitationVerifyLimiter` (GET verify), and `activationLimiter` (POST activate) for account creation
- **File media auth (I3):** same-origin `<img>` / attachment loads use HttpOnly cookie `ek_media` (`purpose: media` JWT) set by `POST /api/files/media-session` after login. Default lifetime `MEDIA_TOKEN_EXPIRES_IN` = **8h** (override via env); client refreshes hourly / on tab focus. Do **not** embed the session JWT in `?token=`. File GETs prefer cookie, then Bearer; query `?token=` is accepted only for `purpose: media` tokens (session JWTs in query are rejected). Media tokens must not authorize API routes (`authenticateToken` rejects `purpose: media`). Inactive / `force_logout` users are rejected on media and WebSocket paths (`userMayUseSession`); deactivate/delete kicks live sockets.
- **CSP:** `Content-Security-Policy-Report-Only` with `report-uri` / `Report-To` → public `POST /api/csp-report` (rate-limited). Admins review/clear via `GET`/`DELETE /api/admin/csp-reports` and **Admin → Troubleshooting → CSP reports**. Stay Report-Only until that list is quiet, then enforce.
- **Request validation:** Zod `parseBody` from `server/utils/requestValidation.js` on tenant + agent JSON write routes. Multipart uploads use multer + magic-byte checks instead.
- **Help Assistant index:** locatable UI is harvested (`data-setting-key`, `data-tour-id`, `data-help-target`, `data-owner-setup`) via `npm run help:ui-index`. Commit `server/config/helpUiIndex.generated.json`. CI runs `help:ui-index:check`. Chat sends a retrieved slice only; facts live in `server/config/helpAssistantFacts.js`.
- Use sqlManager queries from `server/utils/sqlManager/index.js` (never write raw SQL in routes)
- Handle multi-tenant database access via `getRequestDatabase(req)` from `server/middleware/tenantRouting.js`
- Never expose error stack traces to clients (log errors server-side only)

## General Best Practices
- Backend is JavaScript (ES modules), frontend is TypeScript + React
- Follow existing patterns:
  - Routes: `server/routes/*.js` (Express.js router pattern)
  - Database queries: `server/utils/sqlManager/*.js` (PostgreSQL parameterized queries)
  - Auth flow: `server/middleware/auth.js` (JWT with 24h expiration)
  - **Real-time (WebSockets / cross-pod)**: `server/services/notificationService.js` — `publish()` / `subscribe()` only; PostgreSQL `LISTEN/NOTIFY` for app events. Redis remains required for the Socket.IO adapter across pods. **Not for SMTP.**
  - **Outbound email (SMTP)**: `server/services/emailService.js` — Nodemailer, tenant `settings` (`MAIL_ENABLED`, `SMTP_*`). Used for test email, password reset, user invitations, admin portal invites. Do not send mail through `notificationService`.
- Use database transactions for multi-step operations (see `server/utils/dbAsync.js`)
- Publish real-time events via `notificationService.publish()` for WebSocket updates
- Support both single-tenant (Docker) and multi-tenant (Kubernetes) modes
- Run migrations via `server/migrations/index.js` for schema changes

## Debug logging flags (`settings` table)

Tenant-scoped boolean strings (`"true"` / `"false"`). Use to gate verbose diagnostics without rebuilding the client.

| Prefix | Where logs appear | Exposed on public `GET /api/settings`? |
|--------|-------------------|----------------------------------------|
| **`FE_DEBUG_*`** | Browser DevTools console | **Yes** — listed in `server/constants/debugSettings.js` (`FE_PUBLIC_DEBUG_FLAG_KEYS`) so flags load before login where needed |
| **`SERVER_DEBUG_*`** | Node.js server stdout/stderr only | **No** — admins still see/edit them via `GET/PUT /api/admin/settings` |

Defined defaults: `server/constants/debugSettings.js` (`DEBUG_SETTING_DEFAULTS`), seeded on new DBs in `database.js` and for existing DBs via **migration 12** (`add_debug_logging_settings`) and **migration 13** (`add_fe_debug_api_dnd_settings` for tenants that already applied 12).

**Client usage:** `src/utils/clientDebug.ts` — `syncClientDebugFromSettings()` is called from `SettingsContext` after fetch; use `feDebug('FE_DEBUG_…')` before `console.log`.

**Server usage:** `server/utils/serverDebug.js` — `await serverDebug(db, 'SERVER_DEBUG_SETTINGS')` etc.

Suggested flags (all default `false`): `FE_DEBUG_AUTH`, `FE_DEBUG_WEBSOCKET`, `FE_DEBUG_APP_CORE`, `FE_DEBUG_TASK_LINKING`, `FE_DEBUG_REPORTS_UI`, `FE_DEBUG_FLOWCHART`, `FE_DEBUG_TASK_CARD`, `FE_DEBUG_TASK_PAGE`, `FE_DEBUG_TASK_DETAILS`, `FE_DEBUG_SETTINGS_CONTEXT`, `FE_DEBUG_API` (axios request/response summaries; `Authorization` redacted), `FE_DEBUG_DND` (drag/reorder `console.log` via `src/utils/dndDebug.ts`); `SERVER_DEBUG_SETTINGS`, `SERVER_DEBUG_HTTP`, `SERVER_DEBUG_SQL` (per-query `wrapQuery` stdout lines when enabled; setting read is cached ~15s in `server/utils/sqlDebugSettingsCache.js`, cleared when `SERVER_DEBUG_SQL` is updated via settings API), `SERVER_DEBUG_GOOGLE_SSO` (Google OAuth auth route logs; Admin → Troubleshooting; replaces legacy `GOOGLE_SSO_DEBUG`).

Task **drag / reorder** debug lines were **removed** (not gated): same-column, cross-column, and cross-board move noise should stay off in production.

## Task activity email notifications (queue) — implementation notes

When restoring **task/comment email** notifications (throttled queue in `notification_queue`, processed by `notificationThrottler.js`, sent via `EmailService`), design for **multi-tenant** and **multiple K8s pods** as follows.

### One shared queue per tenant (not per pod)

- Use the **tenant database’s** `notification_queue` table as the **single** queue for that tenant. **All pods** share the same DB and thus the **same** queue.
- Do **not** introduce a separate queue per pod; that fragments work and does not fix duplication.

### Avoid duplicate emails with multiple replicas

- With **more than one pod**, two workers can otherwise read the same `pending` rows and **send the same email twice**.
- **Require atomic claiming** before send: e.g. PostgreSQL `SELECT … FOR UPDATE SKIP LOCKED`, or an `UPDATE … WHERE status = 'pending' … RETURNING` that flips to a `processing` / `claimed` state in one statement, then send SMTP, then mark `sent` or `failed`.
- Alternatives: run the queue consumer as a **single** replica (Deployment replicas=1 for a worker) or an external work queue with consumer-group semantics—only if DB-level claiming is not used.

### Multi-tenant processing

- **Enqueue** using the **request-scoped tenant DB** (`getRequestDatabase(req)` / `additionalData.db` from activity logging), same as today’s activity logger pattern.
- **Process** by iterating **each tenant database** that the instance knows about (same idea as `getAllTenantDatabases()` in `tenantRouting.js` for cron), not only `defaultDb`.

### New tenants must be visible on every pod (onboarding)

- Multi-tenant `getAllTenantDatabases()` lists `tenant_*` schemas from PostgreSQL `information_schema`, then opens each DB (cache used as a fast path). Prefer that registry path for cron/queue so new tenants are not skipped just because a pod never served their Host yet.
- When changing onboarding, keep the schema-registry iteration working so scheduled jobs cover every tenant.

## Security Checklist (agent must verify)
- No hardcoded secrets (use environment variables: `JWT_SECRET`, `INSTANCE_TOKEN`, `SMTP_*`)
- All database queries go through sqlManager (PostgreSQL parameterized queries)
- JWT tokens validated via `authenticateToken` middleware before accessing protected routes
- Multi-tenant isolation: users can only access data from their tenant's database
- Security headers set globally in `server/index.js` (X-Content-Type-Options, X-Frame-Options, HSTS, CSP Report-Only, etc.)
- CORS handled by nginx (Express CORS middleware disabled to avoid duplicate headers)
- File uploads validated via `server/utils/fileValidation.js` (size / MIME / extensions) and `server/utils/fileMagicBytes.js` (content signatures for avatars, logos, attachments)
- Test/debug endpoints (`/api/test/*`, `/api/auth/test/callback`) return 404 in production unless `ALLOW_TEST_ENDPOINTS=true`; `demo-credentials` requires `DEMO_ENABLED=true`
- Instance status checks prevent actions on suspended/terminated instances (`server/middleware/instanceStatus.js`)
