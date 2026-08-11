# Agila Delivery Playbook

**Audience:** Product Owners, Scrum Masters, and delivery leads  
**When to use:** After Agila is installed and you can sign in as an admin  
**Goal:** Get a team delivering on a clear board in the first day—not master every feature

## Introduction

This is an operating guide. The same walkthrough lives in-app under **Help (F1 / ?) → Delivery**. For field-by-field detail, use the other Help tabs or [Documentation.md](../Documentation.md).

Shape the board to how work actually moves; use soft WIP and optional sprints when they help. You keep the process—Agila gives shared visibility and flow aids.

---



## Roles


| Role       | What they can do for delivery                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| **Admin**  | Users, boards/columns, WIP & policy, Project/Features/Sprint settings, Reports config, Lifecycle/trash |
| **User**   | Work the board: create/move tasks, comments, filters, views (no Admin panel)                           |
| **Viewer** | Read-only boards; can comment and save personal views (no create/edit/drag of tasks)                   |


---



## First hour checklist

Do these in order. Skip branding/SSO/AI until the team can move cards.

1. **Invite the team** — header **Invite**, or Admin → Users (assign **User** or **Viewer** as needed).
2. **Create one board** — `+` on the board tabs. Prefer one board per team/value stream at first.
3. **Shape columns** to match how work actually flows (example: To Do → In Progress → Review → Done). Add/reorder from the board; click a column title (admin) for name, soft WIP, and short policy notes.
4. **Optional: define “finished”** — Admin → **Project Settings → Project** → finished column names (e.g. `Done`). Tasks in those columns are not treated as overdue.
5. **Tune Features** — Admin → **Project Settings → Features**:
  - Task counts on board tabs / columns: **on** (recommended)
  - Effort totals: optional (off by default)
  - Effort unit: hours or points (display only; values are not converted)
  - Highlight overdue: on if you want LATE badges
6. **Optional: soft board WIP** — double-click the board tab → set a team-capacity limit for **active** work (see [WIP](#soft-wip-column-and-board)).
7. **Optional: first sprint** — only if you timebox:
  - Create the sprint in Admin → **Project Settings → Sprint Settings** (do this before you need to assign work to it).
  - In the header sprint dropdown, pick that sprint: **new tasks you add are placed in that sprint** (and dates follow the sprint window when applicable).
  - With **All sprints** selected, new tasks are not auto-assigned; use the **calendar icon on each card** (or bulk sprint) to send tasks into a sprint.
8. **Create a few real tasks** and walk the flow once with the team.

Press **F1** anytime for the in-app guide; offer the short product tour if teammates are new.

---



## Shape the board



### Columns that match the work

- Name columns for **states of work**, not people (“In Review”, not “Sarah”).
- Keep the path short enough to scan in one meeting.
- Use **policy notes** (column menu) for entry/exit rules in one or two lines—e.g. “Ready for Review: tests green, PR linked.”
- Mark **Finished** / **Archived** columns intentionally (column settings). Finished = completed work; archived = out of active flow but retained on the board structure.



### One board or many?


| Prefer **one board** when… | Prefer **another board** when…            |
| -------------------------- | ----------------------------------------- |
| Same team, same workflow   | Different WIP / cadence / audience        |
| Shared standup             | Separate product or client stream         |
| You still learn the tool   | Cross-team handoff needs a clear boundary |


You can move tasks across boards later (including drag onto another board tab). Start simple.

---



## Soft WIP (column and board)

WIP in Agila is **soft**: at or over the limit, the UI **warns**; moves and creates are **still allowed**. Treat amber meters as a coaching signal, not a lock.

### Column WIP

- Set from the column menu (admin): soft limit or empty = unlimited.
- Counts tasks **in that column** (capacity coloring uses the real column load; filters may change what you *see* on the meter).
- Use for bottlenecks (e.g. Review = 3) so the team stops starting and finishes.



### Board WIP (team capacity)

- Set by **double-clicking the board tab** (admin): title + soft WIP in a dropdown (tab bar height stays compact).
- Counts **active work only**: live tasks in columns that are **not** finished, archived, or trash.
- Soft warnings when creating a task or dropping onto a board that is at/over limit.
- Amber chrome matches column WIP meters when counts are shown (Features).

**Practical defaults**

- Column WIP on the scarcest stage first (often Review or In Progress).
- Board WIP ≈ team “active slots” you can honestly finish soon—not backlog size.
- Empty limit = unlimited; that is fine while you learn.

**Do not** expect WIP to block the board. If the team ignores warnings every day, fix the habit or the limit—not the product.

---



## Day-to-day rituals



### Standup / board walk (Kanban view)

1. Open the right **board** and sprint filter (All / Active sprint / Backlog) if you use sprints.
2. Scan **right-to-left** (Done ← … ← To Do) or bottleneck-first—finish before pull.
3. Use **card aging** (days in column) and **blocked** flags to surface stuck work.
4. Member filters (assignees, watchers, etc.) for “my work” without leaving the board.
5. Soft WIP amber = discuss pull vs finish, then decide consciously.



### Planning / refinement

- Capture work as tasks with clear titles; use description, priority, tags, effort as your team agrees.
- **List** view for bulk scan/sort; **Gantt** when dates and dependencies matter.
- Parent/child or related links when useful—optional, not required.
- Multi-select + bulk actions for sprint, tag, priority, move board, archive, delete.



### If you run sprints

1. Admin creates sprints (**name, start, end**; mark one **Active**).
2. Header **sprint dropdown**:
  - A **specific sprint** selected → new tasks land in that sprint.
  - **All sprints** → new tasks stay unassigned; click the **calendar icon on cards** (or use bulk sprint) to send them into a sprint.
  - **Backlog** filters to unassigned work.
3. Enable **Reports** when you want burndown and team views (Admin → Project Settings → Reporting).
4. Create the next sprint before the current one ends so assignment never blocks planning.

Sprints are **timeboxes for filtering and reporting**. The board remains the source of flow truth.

---



## Visibility and Features

**Admin → Project Settings → Features** controls board chrome, not permissions:

- Board tab / column **task counts** (and WIP meters when a limit is set)
- Board tab / column **effort totals**
- **Effort unit** (hours vs points—label only)
- **Highlight overdue** (LATE badge; finished columns still exempt)

Turn counts **on** for search, filters, and WIP coaching. Leave effort off until the team estimates consistently.

**Saved filters** in search help repeating views (e.g. “Blocked”, “This sprint”, “Unassigned”).

**Reports / My Stats / Leaderboard** are optional. Turn gamification on only if it helps the culture; it is easy to distract a new team.

---



## Hygiene


| Topic               | Practice                                                                          |
| ------------------- | --------------------------------------------------------------------------------- |
| **Done**            | Land in a finished-named column; keep finished names in Project settings          |
| **Delete**          | Soft-delete → board trash; restore from trash or Admin → **Lifecycle**            |
| **Purge**           | Admins can permanently purge (e.g. Shift+click delete with confirm)—use sparingly |
| **Archive columns** | For work you want off the active path without deleting                            |
| **Retention**       | Set Lifecycle retention/auto-purge with an admin, and tell the team first—soft-deleted boards and tasks can be permanently removed after the retention period |


---



## Anti-patterns

- Treating soft WIP as a hard gate (or ignoring amber forever).
- Expecting board WIP to include Done/trash (it counts **active** work only).
- Many near-empty boards before one board works.
- Creating sprints in the UI after assigning tasks—create sprints first.
- Using columns as permanent personal swimlanes.
- Assuming Agila enforces Scrum/SAFe ceremony—it won’t; facilitate that yourself.

---



## One-page team conventions (fill in)

Copy this into a wiki or pin it next to the board:


| Convention                      | Our choice |
| ------------------------------- | ---------- |
| Board name                      |            |
| Column path                     |            |
| Finished column name(s)         |            |
| Column WIP (which columns & soft limits) |            |
| Board WIP (active work)         |            |
| Effort: hours / points / unused |            |
| Sprints: yes / no; length       |            |
| Definition of Ready (policy)    |            |
| Definition of Done (policy)     |            |
| Who is Admin for board changes  |            |


---



## Where to go next


| Need                   | Where                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| In-product playbook    | **Help (F1 / ?) → Delivery**                                                                          |
| Full feature reference | [Documentation.md](../Documentation.md)                                                               |
| Install / ops          | [README.md](../README.md)                                                                             |
| Optional AI Agent      | [Documentation.md — AI Agent](../Documentation.md#ai-agent), [AI_INTEGRATION.md](./AI_INTEGRATION.md) |


Revisit this playbook after the first sprint or two weeks of flow: tighten WIP, retire unused columns, and only then add Reports or a second board.