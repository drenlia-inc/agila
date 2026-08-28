# Authorization roadmap (future work)

Planning notes for expanding Agila beyond today’s binary roles (`admin` | `user`).  
**Status:** Phase 1 (read-only / `viewer` role) **implemented**. Phases 2–3 remain future work.

**Related product context:** Hosted plans already differentiate seats (`USER_LIMIT`); finer ACL is independent of Basic/Pro marketing unless we later sell “advanced permissions” as a Pro feature.

---

## Current state (baseline)

| Layer | Behavior today |
|-------|----------------|
| Roles | `admin`, `user` only (`roles` / `user_roles`) |
| Admin | Settings, user management, sprints admin, permanent delete / trash purge, some structural UI |
| User | Full editor on boards/tasks/columns/comments/uploads/DnD for the whole instance |
| Members table | Card assignees — **not** access control |
| Reports | `REPORTS_VISIBLE_TO` (`all` \| `admin`) is largely **UI-gated**; APIs are mostly `authenticateToken` only |
| Realtime | Instance-scoped broadcasts; WS has a TODO for board-level access |
| Frontend | Widespread `isAdmin` checks; no shared `canMutate` / permission helper |

There is **no** authenticated `viewer` / guest role and **no** per-board ACL.

---

## Recommended sequencing

Implement in order. Each phase should ship useful value alone; later phases build on earlier primitives.

1. **Read-only role** (global) — fastest win; teaches write-deny + FE read-only mode  
2. **Groups** — principals for sharing (before or with board ACL; avoid only per-user grants at scale)  
3. **Full authorization (user or group × board)** — real ACL product  

Do **not** skip to (3) without (1)’s middleware patterns and (2)’s group model unless a customer forces it — rework cost is high.

---

## 1. Read-only role implementation

### Goal

Instance-wide **viewer**: read all boards, tasks, reports (subject to existing report visibility settings). Board/task mutations blocked; profile, comments, and personal saved views allowed; export denied.

### Product decisions

- [x] Count viewers toward `USER_LIMIT`? **Yes** (active users = licensed seats; revisit later if needed)
- [x] May viewers edit own profile / password / avatar? **Yes**
- [x] May viewers create **personal** saved views / filters? **Yes** (not shared)
- [x] May viewers post or edit **comments**? **Yes** (own comments; board/task fields still locked)
- [x] May viewers use AI agent / task-work / PATs? **No**
- [x] May viewers export CSV/XLSX? **No**

### Technical approach

**Backend**

- Seed role `viewer` (migration + `database.js` seed).
- Extend Zod / admin user role picker (`admin` \| `user` \| `viewer`).
- Add middleware opposite today’s admin allow-list, e.g. `requireMutationAccess` / `denyRoles(['viewer'])`.
- Apply to all authenticated **write** routes that are not explicitly allowed (profile exceptions if product allows).
- High-risk routers first: `tasks`, `columns`, `boards` (writes), `taskRelations`, `comments`, `files` / upload, `views`, `userDev`, `taskWork`, `agent*`.
- Enforce `REPORTS_VISIBLE_TO` on report **GET** routes (fix existing gap while touching auth).
- Extend status / role-refresh payloads with `canMutate` or full `roles[]` (not only `isAdmin`).

**Frontend**

- Introduce `usePermissions()` → `{ isAdmin, isViewer, canMutate }`.
- Thread `canMutate` through Kanban / List / Gantt / Calendar / TaskDetails / Column / BoardTabs / bulk bars / agent UI.
- Disable DnD, inline edit, create/delete affordances when `!canMutate`.
- Locales for role label + read-only empty/hint states (all locale files).

**Realtime**

- Viewers **should** receive board updates (read path).
- Mutations remain REST-only; API enforcement is sufficient if FE is buggy.

### Effort (order of magnitude)

~**1–1.5 weeks** for a solid v1 (backend-first, then FE).

### Primary touch points

- `server/middleware/auth.js`
- `server/config/database.js`, `server/migrations/`
- `server/utils/requestValidation.js`
- `server/routes/adminUsers.js` + write-heavy route files
- `src/hooks/useAuth.ts` (or new permissions hook)
- `src/App.tsx`, `KanbanPage`, `Column`, `TaskDetails`, `ListView`, `GanttViewV2`, `Header`

### Risks

| Risk | Mitigation |
|------|------------|
| FE-only gating | Always deny on API |
| Missed write endpoint | Checklist audit of all POST/PUT/PATCH/DELETE |
| Agent / PAT bypass | Deny those routers for viewers |
| Binary `isAdmin` leftovers | Prefer `canMutate` over `!isViewer` scatter |

---

## 2. Group membership implementation

### Goal

**Groups** as principals: named sets of users used for access grants (and later board ACL).  
Can ship after global viewer, or in parallel with board ACL design — **before** relying on large per-user board matrices.

### Product decisions

- [ ] Who can create/manage groups? (Recommendation: **instance admin** only in v1)
- [ ] Nested groups? (Recommendation: **no** in v1)
- [ ] Empty groups allowed?
- [ ] Sync from IdP / Google Workspace later? (Out of scope for v1; keep schema IdP-friendly)

### Technical approach

**Schema (sketch)**

```text
groups (id, name, description, created_at, updated_at)
group_members (group_id, user_id, UNIQUE(group_id, user_id))
```

**API**

- Admin CRUD: groups, add/remove members, list members.
- Resolve “groups for user” helper for later ACL evaluation.

**Admin UI**

- Admin → Groups (or under Users): create/rename/delete, member picker.
- Show group membership on user detail (read-only or editable).

**Not in this phase alone**

- Groups do not change data access until phase 3 attaches them to board (or other) grants.
- Optional: allow assigning the global `viewer` / `user` role via group later — **defer**; keep global role on the user for phase 1–2 simplicity.

### Effort (order of magnitude)

~**1–2 weeks** (schema + admin API + Admin UI + i18n), if scoped to admin-managed flat groups only.

### Primary touch points

- New sqlManager module + migration
- `server/routes/adminUsers.js` or new `adminGroups.js`
- `src/components/admin/` new Groups tab
- Locales

### Risks

| Risk | Mitigation |
|------|------------|
| Premature nesting / IdP sync | Flat groups only |
| Orphan memberships on user delete | Cascade or cleanup job |
| Confusion with `members` (assignees) | Naming: **Groups** in UI; table `groups` / `group_members` |

---

## 3. Full authorization — user or group × board

### Goal

Per-board access for **users and groups**, replacing “every logged-in user sees and edits everything.”

Prefer a **role ladder per board**, not arbitrary per-field CRUD checkboxes:

| Board role | Capabilities (sketch) |
|------------|------------------------|
| **none** | Board hidden; APIs 403/404 |
| **view** | Read board/tasks/comments/attachments; no mutations |
| **edit** | Create/update/move tasks & comments; no board settings / column destroy (tune) |
| **manage** | Edit + columns/board settings + share ACL for that board |

Instance **`admin`** remains break-glass (all boards) unless product says otherwise.

### Product decisions (critical)

- [ ] Default for existing tenants after migrate: all current `user`s → **edit** on all existing boards? admins → **manage**?
- [ ] Who may create boards? (admin only vs any editor)
- [ ] Private by default vs open by default for new boards
- [ ] Cross-board reports / search: only boards with ≥ view?
- [ ] Trash / permanent delete: manage vs instance admin?
- [ ] AI agent acting as user: inherit that user’s board roles
- [ ] Seat model unchanged (login seat ≠ board grant)

### Technical approach

**Schema (sketch)**

```text
board_grants (
  id,
  board_id,
  principal_type,  -- 'user' | 'group'
  principal_id,
  board_role,      -- 'view' | 'edit' | 'manage'
  UNIQUE (board_id, principal_type, principal_id)
)
```

**Authz core**

- `getEffectiveBoardRole(userId, boardId)` → max role from direct user grants ∪ group grants.
- `assertBoardAccess(req, boardId, minRole)` on **reads and writes** that are board-scoped.
- Board list endpoints filter by effective role ≥ view.
- Deep links (task by id / ticket): resolve board, then assert.

**Realtime**

- Subscribe / emit only for boards the socket user can view (replace instance-wide fanout where needed).
- See existing TODO in `server/services/websocketService.js`.

**Frontend**

- Board switcher only lists accessible boards.
- `canMutate` becomes **per-board** (context from current board).
- Board settings → Sharing: grant user/group + role.
- Clear 403 UX when opening a forbidden link.

**Admin / support**

- “Effective access” debug view for a user (which boards, via which group).

### Effort (order of magnitude)

~**4–8 weeks** for board roles + enforcement + sharing UI + realtime filtering, **plus** ~**2–4 weeks** if groups are built in the same program (phase 2).  
End-to-end **~2–3 months** for a production-quality B+C, including migration and hardening — not a spike.

### Primary touch points

- New ACL tables + sqlManager
- Nearly all board-scoped routes (`tasks`, `columns`, `boards`, `comments`, `files`, `views`, reports filters, search)
- `server/services/websocketService.js` / notification fanout
- Board tabs, sharing UI, permission context provider
- Migration + backfill script for existing instances

### Risks

| Risk | Severity | Notes |
|------|----------|--------|
| Missed API → cross-board data leak | Critical | Worse than global viewer bugs |
| WS / reports / export / search forget ACL | High | Explicit checklist |
| N+1 group resolution per request | Medium | Cache effective roles (short TTL) |
| Ambiguous admin vs board manage | Medium | Document matrix |
| Migration surprises | High | Default-open backfill + feature flag |

---

## Out of scope (for this roadmap)

- Custom domain / SSO group sync (IdP → Agila groups)
- Per-column or per-task ACLs
- Field-level CRUD matrices in the UI
- Selling “advanced permissions” as a plan_feature (can revisit when phase 3 ships)
- Changing hosted Basic/Pro seat math beyond “does viewer count?”

---

## Suggested milestone checklist (when prioritized)

### Milestone A — Global viewer
- [x] Role seeded; admin can assign
- [x] Mutation middleware on all write routes (via `authenticateToken`)
- [x] FE `canMutate`; DnD/add-task disabled for viewers; TaskDetails fields locked, comments allowed
- [x] Viewer allowlist: profile, comments, personal views, comment upload; export hidden
- [x] Reports API respects visibility setting
- [ ] QA: curl as viewer cannot PATCH task; can POST comment / personal view

### Milestone B — Groups
- [ ] Tables + admin CRUD UI
- [ ] Membership APIs; cascade on user delete
- [ ] No access-behavior change yet (or only used by milestone C)

### Milestone C — Board ACL
- [ ] `board_grants` + effective role helper
- [ ] Enforce on list/get/write paths
- [ ] Sharing UI (user + group)
- [ ] Realtime board isolation
- [ ] Backfill + feature flag for existing tenants
- [ ] Security review pass (API + WS + exports)

---

## References (codebase)

- Auth middleware: `server/middleware/auth.js` (`authenticateToken`, `requireRole`, `primaryRole`)
- Role admin: `server/routes/adminUsers.js`
- Schema seed: `server/config/database.js` (`roles`, `user_roles`, `members`, `boards`)
- Reports visibility setting: Admin app settings + `src` Reports / Header (enforce in `server/routes/reports.js` when touching this work)
- WS TODO: `server/services/websocketService.js` (board access control)
