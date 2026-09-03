# Easy-Kanban Application Documentation

## Table of Contents

1. [Application Overview](#application-overview)
2. [Getting Started](#getting-started)
3. [Header & Navigation](#header--navigation)
4. [Tools Panel](#tools-panel)
5. [Board Management](#board-management)
6. [Views](#views)
   - [Kanban View](#kanban-view)
   - [List View](#list-view)
   - [Gantt View](#gantt-view)
   - [Calendar View](#calendar-view)
7. [Task Management](#task-management)
8. [User Profile & Settings](#user-profile--settings)
9. [Admin Section](#admin-section-admin-only)
   - [Lifecycle](#lifecycle-admin-only)
10. [Advanced Features](#advanced-features)
   - [Soft delete & trash](#soft-delete--trash)
11. [AI Agent](#ai-agent)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Troubleshooting](#troubleshooting)

---

## Application Overview

Agila is a comprehensive agile project management platform that combines Kanban boards, Gantt charts, and list views for complete project visibility. It features real-time collaboration, advanced task management, and team coordination tools.

**Platform:** PostgreSQL-backed (single-tenant Docker or multi-tenant Kubernetes). Real-time updates use PostgreSQL `LISTEN/NOTIFY` with Socket.IO (Redis adapter for multi-pod deployments).

### Key Features
- **Multi-board Kanban system** with drag-and-drop (including cross-board drops)
- **Soft WIP limits** (column and board), card aging, blocked flags, and column policy notes
- **Multiple views**: Kanban, List, Gantt, and Calendar
- **Real-time collaboration** - see changes instantly as team members work
- **User authentication** with local accounts and Google OAuth support
- **Role-based access control** (Admin/User/Viewer) and **board membership** — users and viewers only see boards they have been added to; admins see all boards and assign members (double-click a board tab)
- **Team management** with color-coded member assignments
- **Task management** with priorities, comments, attachments, relationships, and an **acceptance criteria** checklist
- **Multi-select & bulk actions** - tag, copy, sprint, priority, archive, delete, move board; multi-drag between columns
- **Soft delete & trash** - restore or permanently purge tasks and boards (board trash + Settings → Lifecycle); admins can Shift+click delete to purge without trash
- **AI Agent** (optional) — assign tasks to an Agent that can comment (**Assist**), work a linked Git repo (**Code**), or (admins) run board **Automation** with dry-run Apply/Undo (see [AI Agent](#ai-agent))
- **Settings** (Profile → Settings, admins only) for users, branding, mail, SSO, sprints, reporting, licensing, and lifecycle
- **File uploads** for task attachments and user avatars
- **Site branding** - custom logo (light/dark), optional hide logo / GitHub link
- **EN / FR localization**

### User Roles
- **Admin**: Full access to all features including user management and system configuration
- **User**: Access to boards they belong to, tasks, and collaboration features (no admin privileges)
- **Viewer**: Read-only on boards they belong to (can still comment)

---

## Getting Started

**New team leads (PO / Scrum Master):** after install, use the [Delivery Playbook](docs/DELIVERY_PLAYBOOK.md) for a first-hour setup, board/WIP conventions, rituals, and anti-patterns. This section remains the product reference for auth and initial admin setup.

### Authentication & Demo Mode

#### Demo Mode (Recommended for Testing)
When running in **demo mode** (`DEMO_ENABLED=true`), the application seeds an admin account and sample team members with randomly generated passwords:

**Admin Account:**
- **Email**: `admin@kanban.local`
- **Password**: Randomly generated (shown on the login page; copy/fill from there)

**Sample team accounts** (created with the demo board data):
- `john.smith@demo.local`
- `sarah.johnson@demo.local`
- `mike.davis@demo.local`

Passwords for sample users are stored as `DEMO_PASSWORD_<email>` settings (not shown on the login page by default). The login page surfaces the admin credentials when demo mode is enabled.

#### Production Mode
In production mode, you'll need to create your own user accounts through Settings after initial setup.

### Initial Setup
1. **Demo Mode**: Use the admin credentials displayed on the login page
2. **Production Mode**: Create your first admin account through the setup process
3. Create team members in Settings → Users
4. Set up your boards and columns, then add **board members** (double-click the tab) so users and viewers can see each board
5. Start creating and managing tasks; add **acceptance criteria** on the task details panel when a card needs a checklist definition of done
6. Optional: create sprints with a **sprint goal** (header dropdown or Settings → Project Settings → Sprints)
7. Configure Google OAuth (optional) in Settings → System Settings → SSO
8. Configure branding (optional) in Settings → Site Settings (logo, site name)
9. Configure AI Agent (optional) in Settings → System Settings → AI — then users add Profile → Dev credentials for coding jobs

---

## Header & Navigation

[Screenshot: Header with all buttons visible]

The sticky header contains branding, sprint context, app navigation, and utilities.

### Left Side
- **Site brand**: Logo and/or site name (from Settings → Site Settings). Click to follow the configured site URL.
  - Default logo is `/agila-logo.png` when no custom logo is set
  - Empty site name hides the text (no fallback to a default product name)
  - **Hide Site Logo** (admin setting) removes the logo entirely
- **Sprint selector** (Boards page): Filter by sprint or backlog. Each sprint can have an optional **goal** (shown in the dropdown). Admins can create a sprint from the dropdown or open Settings → Project Settings → Sprints. Making a sprint Active can move unfinished work from the previous active sprint (dates unchanged); the prompt shows unfinished/total task counts. **Move** transfers unfinished work; **Keep** activates without transferring; **Cancel**, Escape, or click outside abandons the change (no transfer, sprint is not made Active). The board filter switches to the new sprint only if work was moved. Deleting a sprint that is selected in the header returns the filter to All sprints. Deleting the **Active** sprint warns you to activate another first, but still allows deletion.
- **Demo countdown** (when demo mode is enabled)

### Right Side (left → right)

1. **App navigation**: Boards · Reports (if enabled) · Admin (admins)
2. **Invite** (admins): Invite a user by email
3. **Preferences**: Theme (light/dark) · Language (EN/FR)
4. **Utilities**: Refresh · System panel toggle (admins) · Help (F1 or ?)
5. **GitHub** link (opens in a new tab; can be hidden in Site Settings)
6. **User avatar** (always last): Profile · Logout

---

## Tools Panel

The **Tools** card on the Boards page controls board layout and card density.

- **Board view** (dropdown): Kanban · List · Gantt · Calendar — same icon size as the toolbar button; short labels in the menu, full description on hover
- **Search**: Toggle advanced search/filters
- **Card density** (dropdown): Full · Preview · Minimal
  - **Compact** (tickets only) hides descriptions on cards and shows a **red dot** on the density button as a reminder
  - Tooltips describe the current mode (including that compact hides descriptions)
- **Scrolled header controls**: After Tools scrolls under the page header, compact view and card-density buttons fade into the empty header margin left of the logo — the logo and the rest of the header stay put, and nothing covers board content or the column navigators. They fade back out when the Tools panel scrolls into view, and are skipped entirely when the window is too narrow to leave a margin

---

## Board Management

[Screenshot: Board tabs and board creation interface]

### Creating Boards (Admin Only)
1. Click the `+` button in the board tabs area
2. Enter board name and description
3. Click "Create Board" to confirm

### Board Operations (Admin Only)
- **Edit Board**: Double-click board tab to rename, set board WIP, and **Add/remove members**
- **Board members**: Users and viewers only see boards they belong to. Admins always see every board. A new board stays hidden from non-admins until at least one member is saved.
- **Delete Board**: Soft-delete to trash (confirms with total task count); peers are notified and switched off the board
- **Reorder Boards**: Drag board tabs using the handle
- **Restore Board**: Settings → Lifecycle (or restore board when restoring its tasks)

### Board Settings
- **Board Title**: Displayed in the tab
- **Column Management**: Add, edit, delete, and reorder columns; soft WIP limits and policy text
- **Task Management**: Create, edit, delete, and move tasks
- **Board trash**: Toggle trash on the board tabs to restore or permanently purge soft-deleted tasks for that board

---

## Views

The application offers three different views for managing tasks (switch via the Tools panel):

- **Back to top**: Once the page is scrolled down, a chevron button appears in the right chrome lane (level with the horizontal scroll arrows) in every board view — Kanban, List, Gantt and Calendar — and jumps back to the top of the page

### Kanban View

[Screenshot: Kanban board with columns and tasks]

The Kanban view displays tasks as cards in columns, representing different stages of work.

#### Column Management
- **Column Headers**: Show column name and task count
- **Localized default names**: Untouched columns created from the bilingual project defaults follow each user's English/French UI language. Once an admin renames a column, that custom name is shown unchanged in every language
- **Soft WIP limits**: Warn when at/over limit (moves still allowed)
- **Policy notes**: Short entry/exit guidance on the column
- **Add Column Button** (Admin Only): `+` button at the end of columns
- **Column Settings** (Admin Only): click column header for options:
  - Edit column name
  - Mark as "Finished" (completed tasks). A toolbar toggle labeled with that column name (next to All Roles) shows or hides finished columns on every board. It is on by default; the choice is saved in your user preferences.
  - Mark as "Archived" (archived tasks)
  - Delete column

#### Board tabs & board WIP
- **Soft board WIP**: Admin double-click a board tab to rename and set a soft WIP limit (dropdown; tab bar height unchanged)
- **Active-work count**: Board WIP counts exclude Done (finished), archived, and trash; amber chrome matches column WIP meters
- **Features** (Settings → Project Settings → Features): board/column indicator visibility (counts on, effort off by default), effort unit (hours vs points), and highlight overdue tasks
- **Trash**: Admins still get the board trash control in the actions column
- **Soft warnings**: Creating a task or dropping onto a board at/over board WIP shows a warning; the action is still allowed

#### Task Cards
- **Task Title**: Click to open task details
- **Card surface**: Clicking empty space on the card also opens task details, including the space beside the tags — only the tag chips themselves stay reserved for tag actions
- **Task Description**: Shown in expand/shrink modes (hidden in compact)
- **Priority Indicator**: Color-coded priority level
- **Assignee**: User avatar and name (including the **Agent** when AI is enabled)
- **Agent activity** (when AI is on): spinner while the Agent is queued/running/waiting; open the activity modal from the card toolbar for live logs, pause/stop/resume
- **Tags**: Color-coded tags
- **Dates**: Start and due date
- **Card aging**: Days spent in the current column
- **Blocked**: Optional blocked flag/reason
- **Watchers / collaborators / attachments**: Reflected on the card; side-panel edits update the board in real time
- **Checkbox**: Multi-select for bulk actions

#### Multi-select & bulk actions
- **Shared selection**: The current board selection follows you across Kanban, List, Gantt, and Calendar. Opening Gantt or Calendar with selected tasks automatically engages its selection mode; exiting that mode clears the shared selection in every view
- **Select all** (per column): Checkbox strip above columns
- **Bulk action bar**: Tag, copy, sprint, priority, move to board (admin), archive, delete; unselect all. Admins: **Shift+click** delete to permanently purge selected tasks (skips trash; always confirms)
- **Bulk move**: Drag one selected card to move all checked cards in that column together

#### Drag & Drop Operations
- **Move Tasks**: Drag task cards between columns
- **Reorder Tasks**: Drag tasks within the same column
- **Cross-board move**: Drop a task onto another board tab
- **Move Columns** (Admin Only): Drag column headers to reorder

#### Task Creation
- **Quick Add**: Click `+` button in any column to create a new task
- **Task Form**: Enter title, description, assignee, priority, due date, and tags

### List View

[Screenshot: List view with table format]

The List view displays tasks in a table format for detailed data management.

#### Table Columns
- **Row Number**: Sequential numbering
- **Actions**: Selection checkmark, Copy, and Delete buttons. Copy/Delete appear on hover; checked rows keep their controls visible. Admins: **Shift+click** Delete to permanently purge (skips trash; always confirms)
- **Task Title**: Double-click to edit; a normal click on any inactive part of the row opens task details
- **Assignee**: User avatar and name
- **Priority**: Color-coded priority level
- **Tags**: Color-coded tags
- **Start Date**: Task start date
- **Due Date**: Task due date
- **Status**: Current column/status
- **Time**: Time since last update

#### Dependencies
- **Show/hide**: The branch control in the ID column header nests parent–child tasks as a tree
- **Related**: Tasks with related links get a small yellow link mark beside the ticket (hover to see those tickets). Related tasks are not nested in the tree

#### Inline Editing
- **Assignee**: Click to change assignee via dropdown
- **Priority**: Click to change priority via dropdown
- **Status**: Click to change status/column via dropdown
- **Dates**: Click to edit start and due dates

#### Sorting & Filtering
- **Column Headers**: Click to sort by that column
- **Search**: Use the search bar to filter tasks
- **Advanced Filters**: Use the filter panel for detailed filtering

#### Multi-select & bulk actions
- **Modifier selection**: **Ctrl/Cmd+click** an inactive part of a row to toggle it. **Shift+click** selects the visible sorted range from the last selected task
- **Selection feedback**: Checked rows are highlighted and show a checkmark beside the row actions
- **Bulk action gutter**: A fixed control bar stays visible in the page's left gutter while scrolling. It provides the same tag, copy, sprint, priority, member, move-board, archive, and delete actions as Kanban multi-select
- **Undo**: Supported bulk actions replace the action bar with a one-shot Undo control for 60 seconds
- **Clear selection**: Use the unselect control in the gutter or press **Escape**

### Gantt View

[Screenshot: Gantt chart with timeline and task bars]

The Gantt view displays tasks on a timeline showing project schedules and dependencies.

#### Timeline Features
- **Date Range**: Horizontal timeline showing days, weeks, months
- **Task Bars**: Horizontal bars representing task duration
- **Dependencies**: Arrows showing task relationships
- **Milestones**: Special markers for important dates

#### Task Management
- **Create Tasks**: Click on timeline to create new tasks
- **Edit Tasks**: Click on task bars to edit
- **Move Tasks**: Drag task bars to change dates
- **Resize Tasks**: Drag ends of task bars to change duration
- **Select tasks**: **Ctrl/Cmd+click** or **Shift+click** in the left task list to add or range-select without pressing Select first. After **Select** is on, the same clicks work on the timeline bars
- **Bulk action gutter**: Selected tasks expose the fixed action bar 3px left of the task list, with tag, copy, sprint, priority, member, move-board, archive, and delete actions
- **Selection persists**: Applying an action keeps the same bars selected and stays in selection mode, so **←** / **→** nudges and follow-up actions keep working. Actions that remove the bars (delete, archive, move to another board) drop them from the selection
- **Undo**: Supported bulk actions offer a one-shot Undo for 60 seconds — inside the action bar while tasks stay selected, or in place of the bar once the selection is empty
- **Leave selection mode**: The gutter's unselect control clears the selection *and* exits selection mode; **Escape** or **Enter** does the same
- **Delete Task**: Clicking one bar opens Task Details and reveals a trash button between **Link** and **Task** in the Gantt header; selected groups use the gutter trash action. Admins can **Shift+click** either delete control to permanently purge (skips trash; always confirms)

#### View Modes (Tools → card density)
- **Expand**: Full task details with titles
- **Shrink**: Reduced height with titles
- **Compact**: Minimal height, titles/descriptions minimized

#### Navigation
- **Scroll**: Horizontal scrolling through timeline
- **Zoom**: **−** / **+** (and the percent control) change how wide each day is. 100% is the default 40px day; the date at the center of the view stays put. Full / Preview / Minimal still only change row height
- **Jump to Task**: Navigate to specific dates
- **Today Button**: Jump to current date
- **Later Button**: Jump to the next timeline
- **Earlier Button**: Jump to the previous timeline
- **Task &gt; Button**: Jump to the nearest task that starts after the visible timeline window
- **Task &lt; Button**: Jump to the nearest task that ends before the visible timeline window
- **Earliest / latest task**: The double-chevron buttons in the Tasks column header still jump to the first and last dated task on the board
- **Off-screen task hints**: Faint gray marks just above and below the day numbers mark the days whose tasks sit above or below the visible rows; denser stretches read darker, and the marks disappear once everything is in view. Click a mark to scroll to the nearest off-screen task on that day

#### Dependencies
- **Create Links**: Connect tasks to show relationships
- **Parent-Child**: Hierarchical task relationships (solid arrows)
- **Related**: Dotted lines. If the other task is outside the loaded date window, the line still meets that row at the left or right edge of the timeline

### Calendar View

[Screenshot: Calendar with month grid and task bars]

The Calendar view displays dated tasks on Month, Week, or Day grids for schedule-focused work.

#### Sub-views
- **Month**: Full-month grid with task bars spanning start–due dates; every dated task is shown, so busy weeks grow taller rather than hiding work
- **Week**: Seven-day strip centered on the focus date
- **Day**: Single-day list; Tools density applies. Preview is the standard read-only row (title, dates, avatar, tags, comments). Minimal compresses the same data onto one line. Full adds the task description under the dates. Cards cannot be moved or resized

#### URL / routing
- **`#calendar`**: Open Calendar view for the current board
- **`#calendar#boardId`**: Open Calendar view for a specific board tab

#### Navigation
- **Period arrows**: Arrows around the displayed month, week range, or day move exactly one period
- **Period picker**: The calendar icon beside the period opens a small picker — a month/year field in Month view, a week field in Week view, or a date field in Day view — with **‹ ›** buttons on either side that step a full year at a time
- **Open a day**: Hover a day number in Month view — or a weekday name in the Week view header — and click the arrow that slides in to open Day view for that date. The day number is used to create tasks, not to open Day view.
- **Task arrows**: Arrows around **Task** jump to the nearest earlier or later period containing dated work
- **Today**: Return to the current date; the current day keeps its tinted background and circled date. If today's cell is scrolled out of sight, the page scrolls it back into view below the sticky header
- **Status filter**: The Status control between Today and Jump to task opens the same picker as Tools. Choices apply only to Calendar; other views keep their own status visibility. Newly created statuses start visible, and Reset restores the default (archive hidden)
- **Task search**: Search by ticket, title, or status to open the task's period and briefly highlight its calendar bar

#### Task bars
- **Dated tasks only**: Tasks without a start date and without a due date are omitted
- **Ordering**: Month and Week bars follow their Kanban column/task position; Day view can sort by Kanban order, priority, status, assignee, or title
- **Move / resize** (Month and Week): Drag a bar to shift dates, or drag its edges to change start or due date — **dates only**; column and position on the Kanban board are unchanged. Day view is a read-only list of that day's work, so its cards cannot be moved or resized
- **Continues past the edge**: A bar that runs beyond the row or the visible period has a faded edge and a square corner; while dragging, a badge shows the live start and due dates so a clipped bar is not mistaken for a resize
- **Colors**: Month and Week bars are filled with the assignee's team color (gray when unassigned); Day view shows that color as a left stripe. Priority appears as a small colored dot at the start of Full and Preview bars; Minimal repeats a tiny priority pill on every visible segment so multi-week tasks keep their priority cue
- **Done / Late**: Full, Preview, and Day bars use the same DONE / LATE stamps as Gantt, placed after the title so they do not cover avatars or comments (Late follows the admin overdue-highlight setting). Month and Week Minimal is too thin for the words, so it uses a green or red cap on the hairline instead; hover preview still names Done or Late
- **Priority legend**: Color key at the top of the sticky header (same priority colors as Gantt); its markers change from dots to tiny pills in Minimal view to match the bars

#### Interaction
- **Create by date range**: In Month or Week view, hover a day number (the pointer becomes a plus) and click and drag to the end date. A light-blue preview follows the selected range across the date-number strip; release to create the task with the board's default priority. Clicking empty space in a day does not create a task.
- **Comments**: Hover the comment bubble on a Full or Preview bar — and on Day rows in every density — to preview recent comments; reply inline, or choose **Open** to show Task Details scrolled to its comments
- **Task preview**: In Month or Week view, hover a bar to see ticket, title, dates, assignee, and description (same preview as Gantt). Move the pointer onto the preview to keep it open and select or copy its text and links; it closes when the pointer leaves, and pressing the bar dismisses it. Day cards do not show this hover preview; click a card to open Task Details
- **Task Details**: Click a bar to open or toggle the Task Details side panel and edit the task there
- **Day task**: In Day view, use the **+** button beside the date to create a task for that day
- **Assignee**: Click the avatar on a bar to pick a different assignee (or unassign)
- **Priority / assignee**: Open the bar context menu to change priority or assignee

#### Multi-select
- **Single selection**: A normal click opens Task Details and shows the trash button beside **Select**, allowing that task to be deleted without entering multi-select
- **Modifier selection**: **Ctrl/Cmd+click** toggles individual bars. **Shift+click** selects the visible dated range from the last selected task, following start date and Kanban order
- **Select mode**: The toolbar **Select** button enters selection mode explicitly; if Task Details is open, that task becomes the first selection. Once several tasks are selected, **Select** becomes **Exit**
- **Bulk action gutter**: Selected tasks expose the fixed action bar 3px left of the calendar, with tag, copy, sprint, priority, member, move-board, archive, and delete actions
- **Selection persists**: Applying an action keeps the same bars selected and stays in selection mode, so date nudges and follow-up actions keep working. Actions that remove the bars (delete, archive, move to another board) drop them from the selection
- **Undo**: Supported bulk actions offer a one-shot Undo for 60 seconds — inside the action bar while tasks stay selected, or in place of the bar once the selection is empty
- **Date nudge**: With tasks selected, **←** / **→** shifts all selected tasks by one day
- **Delete**: The gutter trash action soft-deletes selected tasks. Admins can **Shift+click** it to permanently purge the selection; both actions require confirmation
- **Exit**: The gutter's unselect control clears the selection *and* exits multi-select mode; **Escape** or **Enter** does the same

#### View Modes (Tools → card density)
- **Full**: Month and Week show the complete assignee-colored bar with priority dot, title, avatar, comments, and resize handles. Day shows the standard card plus the task description
- **Preview**: Month and Week use thinner titled bars with a compact avatar and comment bubble; resize handles appear on hover. Day uses the standard read-only card (title, dates, avatar, tags, comments)
- **Minimal**: Month and Week reduce tasks to member-colored timeline lines with a tiny priority pill on every visible row segment; hover still opens the task preview. Done/Late show as a green or red cap rather than the stamp text. Day compresses the same card data onto one line
- **Assignee on hover**: Every density shows the assignee in the hover preview (avatar and name, or *Unassigned*), so multi-week tasks remain identifiable even when the on-bar avatar is on another segment
- **Day** remains a read-only list: cards cannot be moved or resized in any density

---

## Task Management

### Creating Tasks
1. **Kanban View**: Click `+` button in any column
2. **List View**: There are no "Add Task" buttons.. Use other views to create them
3. **Gantt View**: Click on timeline at desired date
4. **Calendar View**: In Day view, click **Add task** on an empty day (or create tasks in Kanban/Gantt and assign dates)

### Task Details Page

[Screenshot: Task details page with all sections]

When you click on a task, the Task Details page opens with comprehensive task management.

#### Task Information
- **Title**: Task name (editable)
- **Description**: Rich text description (editable)
- **Assignee**: Assigned team member (dropdown)
- **Priority**: Priority level (dropdown)
- **Tags**: Assigned tags (add/remove)
- **Dates**: Start date and due date (date pickers)
- **Effort**: Estimated effort (type freely; commits on blur)
- **Status**: Column on the task's board (dropdown next to Effort; follows the user's English/French UI language for untouched default names)
- **Acceptance criteria**: Checklist of what “done” means. Drag to reorder; pencil or double-click to edit; Enter saves, Escape cancels; check items off as they are met.

#### Comments Section
- **Add Comments**: Rich text editor for comments
- **Comment History**: Chronological list of all comments
- **File Attachments**: Attach files to comments
- **Mention Users**: @username to notify team members

#### Task Actions
- **Jump to task**: Locate and highlight the task in the active Kanban, List, Gantt, or Calendar view. If the task belongs to another board, that board opens first; the active view is preserved
- **Save Changes**: Save all modifications
- **Delete Task**: Soft-delete to board trash (restore from trash or Settings → Lifecycle). Admins: **Shift+click** delete on the card/toolbar to permanently purge (skips trash; always confirms)
- **Copy Task**: Duplicate task
- **Link Tasks**: Create relationships with other tasks
- **Assign to Agent** (when AI is enabled): Open the assign modal from the card toolbar or assignee control — see [AI Agent](#ai-agent)

#### Task Linking
- **Parent Tasks**: Tasks that depend on this one
- **Child Tasks**: Tasks that this one depends on
- **Dependency Arrows**: Visual representation of relationships

Side-panel edits (description, watchers, collaborators, attachments, effort, etc.) update the board card without requiring a full page reload when real-time updates are connected.

---

## User Profile & Settings

[Screenshot: User profile modal]

### Profile Management
- **Display Name**: Your name as shown to other users
- **Avatar**: Upload profile picture

### Preferences
- **Theme**: Light/Dark mode preference is auto-saved
- **Language**: English / French (header toggle)
- **Activity Feed**: Enable/disable activity notifications
- **Default View**: Preferred view mode (Kanban/List/Gantt/Calendar) is auto-saved

### Account Settings
- **Change Password**: Use the forgot password link at login
- **Account Deletion**: Delete your account

### Dev credentials (when AI is enabled)

[Screenshot: Profile → Dev tab]

When an administrator has enabled AI for the instance, Profile includes a **Dev** tab:

- **API tokens**: Personal access tokens (`ek_…`) for agent/API automation (shown once at creation)
- **SSH key**: Generate a dedicated keypair for agent git access (public key to add on GitHub/GitLab)
- **GitHub PAT**: Store your own GitHub personal access token for clone, push, and pull requests (not shared with other users)
- **Repo check**: Probe whether your PAT can access a given repository URL

These credentials are used when **you** assign a coding job to the Agent. Assist-only jobs (no repo) do not require Git credentials.

---

## Settings (admins only)

[Screenshot: Settings interface]

Open **Settings** from the profile menu (admins only). Settings provides instance management: users, branding, mail, SSO, project options, reporting, licensing, and lifecycle.

### User Management

[Screenshot: Admin users tab]

#### User List
- **All Users**: Complete list of system users
- **User Details**: Name, email, role, status
- **Account Status**: Active, inactive, pending
- **Last Login**: When user last accessed system

#### User Operations
- **Create User**: Add new team members
- **Edit User**: Modify user details and permissions
- **Delete User**: Remove user accounts
- **Reset Password**: Generate new passwords
- **Activate/Deactivate**: Control user access

#### User Creation Form
- **Name**: User's full name
- **Email**: Email address (must be unique)
- **Role**: Admin or User
- **Send Invitation**: Email invitation to new user
- **Temporary Password**: Auto-generated password

### Site Settings

[Screenshot: Admin site settings tab]

#### General
- **Site Name**: Shown in the header (leave blank to hide the name; does not fall back to a default product name)
- **Site URL**: Destination when clicking the brand in the header
- **Website URL**: Customer portal URL (read-only; set at instance purchase)
- **Open Links in New Tab**: Global link behavior in rich text

#### Branding
- **Site Logo**: Upload an image or paste a URL (light mode). Empty → default `/agila-logo.png`
- **Site Logo (Dark Mode)**: Optional; falls back to light logo, then default
- **Hide Site Logo**: When enabled, no logo is shown (including the default). Missing setting = logo visible
- **Hide GitHub Link**: When enabled, hides the header GitHub icon. Missing setting = link visible

### SSO Configuration (Admin Only)

[Screenshot: Google OAuth setup]

#### Google OAuth Setup
- **Client ID**: Google OAuth client ID
- **Client Secret**: Google OAuth client secret
- **Callback URL**: OAuth redirect URL

#### OAuth Features
- **Single Sign-On**: Login with Google account
- **Account Linking**: Link Google to existing accounts
- **Profile Sync**: Sync Google profile information
- **Avatar Import**: Use Google profile picture

### Mail Server Settings (Admin Only)

[Screenshot: Mail server configuration]

#### SMTP Configuration
- **Server**: SMTP server address
- **Port**: SMTP port number
- **Security**: SSL/TLS encryption
- **Authentication**: Username and password
- **From Address**: Sender email address

#### Email Features
- **User Invitations**: Send account invitations
- **Password Resets**: Email password reset links
- **Notifications**: Task and system notifications
- **Test Email**: Send test email to verify setup

### Lifecycle (Admin Only)

[Screenshot: Admin Lifecycle tab]

Soft-deleted work stays recoverable until retention expires or an admin purges it.

#### Deleted tasks
- **Browse trash**: Filter soft-deleted tasks across boards
- **Restore**: Return tasks to their board/column (prompts to restore the board first if it is still deleted)
- **Permanent purge**: Delete forever (cannot be undone)
- **Batch actions**: Restore or purge multiple selected tasks

#### Deleted boards
- **Restore board**: Brings the board back to the tab bar (tasks stay in trash until restored)
- **Restore board then tasks**: When restoring tasks whose board is deleted, confirm to restore the board first, then the selected tasks
- **Permanent purge**: Removes the board and related trash

#### Retention
- **Auto-purge settings**: Configure how long soft-deleted items are kept before automatic permanent deletion

### Priorities Management (Admin Only)

[Screenshot: Priorities management interface]

#### Priority Levels
- **Create Priority**: Add new priority levels
- **Edit Priority**: Modify existing priorities
- **Delete Priority**: Remove priority levels
- **Reorder Priorities**: Change priority order
- **Color Coding**: Assign colors to priorities

#### Priority Properties
- **Name**: Priority level name
- **Description**: Priority description
- **Color**: Visual color indicator
- **Order**: Priority sequence
- **Default**: Set default priority

### Tags Management (Admin Only)

[Screenshot: Tags management interface]

#### Tag System
- **Create Tags**: Add new tags
- **Edit Tags**: Modify existing tags
- **Delete Tags**: Remove tags
- **Tag Categories**: Organize tags by category
- **Color Coding**: Assign colors to tags

#### Tag Properties
- **Name**: Tag name
- **Description**: Tag description
- **Color**: Visual color indicator
- **Category**: Tag grouping
- **Usage Count**: How many tasks use this tag

### AI Settings (Admin Only)

[Screenshot: Admin AI Settings tab]

Configure the optional AI Agent platform (also toggled from App Settings where available).

#### Enablement
- **Enable AI**: Master switch — turns on the Agent assignee, Profile → Dev, and agent APIs
- **Agent display name**: Name shown for the Agent member on the board

#### LLM provider
- **Provider**: OpenAI, Anthropic (Claude), OpenRouter, Ollama (local), or Custom (OpenAI-compatible)
- **Base URL / API key / Model**: Provider endpoint, credentials, and default model
- **Validate connection**: Test that the app can reach the LLM with the saved (or draft) settings
- **List models**: Fetch available models from the provider when supported

#### Agent runner (coding jobs)
- **Runner URL** and **Runner token**: Push jobs to the agent runner service (required for repo/coding work; assist/comment jobs use the LLM path configured above)
- **Max concurrent agent jobs**: Cap how many Agent jobs run at once for this instance (1–10)
- **Probe runner**: Verify the runner is reachable and authenticated

GitHub PATs are **not** stored in admin settings — each user manages credentials under Profile → Dev.

Developer details (APIs, `task_work`, runner): [`docs/AI_INTEGRATION.md`](docs/AI_INTEGRATION.md).

---

## Advanced Features

### Filtering System

[Screenshot: Advanced filter interface]

#### Filter Types
- **Text Search**: Search in task titles, descriptions, comments, tickets, assignee names, and sprint names
- **Date Range**: Filter by start date or due date
- **Member Filter**: Filter by assigned team members (Team strip) or saved-view member lists
- **Priority Filter**: Filter by priority levels (multi-select)
- **Tag Filter**: Filter by assigned tags (multi-select)
- **Project / Task ID**: Filter by board project identifier or task ticket
- **Linked tasks**: Show only tasks with parent/child/related links on the current board
- **Overdue**: Toggle to show tasks past due or without a due date (finished/archived columns excluded)
- **Blocked**: Toggle to show only tasks marked blocked
- **Sprint filter**: Multi-select sprints (and backlog) in Search & Filter — works across boards; combine with header sprint filter by setting header to **All sprints**
- **Stalled**: Minimum days in the current column (card aging)
- **Status visibility**: Show/hide workflow statuses on the current view. **All** selects every active status and leaves Archive off; tick Archive separately when you want it

#### Header Search (jump to a task)
The search box in the app header does two things, and typing does neither on its own — it only fills the dropdown, leaving the board untouched. From there, press **Enter** to apply the text as a board filter, or pick a task from the dropdown to jump straight to it (which clears the text). Each row shows which field matched — ticket, title, description, comments, assignee, or requester.

Because the dropdown searches every board while the filter only applies to the one you are on, filtering as you type used to empty the current board while the match you wanted sat elsewhere. Emptying the box (or the **X** / **Escape**) clears an applied filter right away, so the board is never left filtered by text that is no longer in the box.

The dropdown deliberately reaches past what the board is currently showing, so work you archived or deleted is still findable:

- **Active tasks** come first.
- **Archived columns**: tasks living in a column flagged as Archive are grouped under an *Archived columns* heading with an amber **Archived** badge. Jumping to one reveals that column for the current visit only — your saved column layout and the hidden-by-default rule for Archive are untouched, and a notice tells you which column was revealed. Toggling column visibility yourself (or using the reset button) clears the temporary reveal.
- **Trash**: soft-deleted tasks are looked up across boards, grouped under a *Trash* heading with a red **In trash** badge and a struck-through title. Jumping to one switches to that board, opens its Trash panel, and highlights the card so you can Restore or Delete forever from there.

Board tab counters keep counting only what the board actually shows, so a dropdown hit badged Archived or In trash will not be reflected in those numbers.

#### Saved Filters
- **Save Filter**: Save frequently used filter combinations (includes overdue, blocked, sprint, stalled, and linked toggles)
- **Load Filter**: Apply saved filter configurations
- **Share Filters**: Share filter views with team members
- **Default Filters**: Set default filter for each board

#### Filter Operations
- **Combine Filters**: Use multiple filters simultaneously
- **Clear Filters**: Reset all active filters
- **Filter History**: Recent filter combinations
- **Export Filters**: Export filter configurations

### Archive Functionality

[Screenshot: Archive column and archived tasks]

#### Archive Column
- **Archive Tasks**: Move completed tasks to archive
- **Archive Column**: Special column for archived tasks
- **Archive Settings**: Configure archive behavior

#### Archived Tasks
- **View Archived**: Browse archived tasks
- **Restore Tasks**: Move tasks back to active columns

### Soft delete & trash

Soft delete is separate from the Archive column: deleted items leave the active board and can be restored or purged.

#### Soft-delete vs permanent purge
- **Normal delete** (trash icon / bulk delete): Soft-deletes the task into board trash (recoverable)
- **Admin Shift+click delete**: Permanently purges the task immediately (Kanban card, multi-select bulk bar, List view, Gantt task list, and Calendar selection). Skips trash; always asks for confirmation. Non-admins: Shift is ignored

#### Board trash
- **Open trash**: Toggle from the board tabs area
- **Restore / purge**: Per task or in bulk for the current board
- **Assignee**: Each trash card shows the assignee avatar, matching live Kanban cards
- **Density**: Trash cards follow Full / Preview / Minimal. Full shows who deleted the task and when; Preview is the compact card; Minimal is a single-line row (hover the title for deletion details)
- **Empty trash**: Permanently delete all trashed tasks on the board (admin)

#### Admin Lifecycle
- Cross-board restore and permanent purge for tasks and boards
- Retention / auto-purge configuration (see [Lifecycle](#lifecycle-admin-only))

### Completed Tasks

[Screenshot: Completed column and finished tasks]

#### Completion Tracking
- **Finished Column**: Special column for completed tasks
- **Completion Status**: Mark tasks as finished

### Real-Time Collaboration

[Screenshot: Real-time updates and collaboration features]

#### Live Updates
- **WebSocket Connection**: Real-time data synchronization across clients
- **PostgreSQL NOTIFY**: Server events fan out to connected pods/clients
- **Instant Updates**: Board cards and panels update as others edit (including side-panel changes), including Agent **task work** status and logs when AI is enabled
- **Conflict Resolution**: Handle simultaneous edits

---

## AI Agent

Optional feature. Requires an administrator to enable AI and configure an LLM (and usually an agent runner for coding jobs).

### What it does
- Adds an **Agent** assignee (system member — not a licensed login seat)
- Lets you **queue work** on a task: coding against a Git repo, **assist** (comment-oriented, no repo), or **Automation** (admins — board-wide tool ops with preview)
- Shows **live progress** on the card and in an activity screen (logs, pause / stop / resume)
- For coding jobs, can commit, push a branch, and open a **pull request** when GitHub credentials allow
- For Automation: dry-run plan → admin **Apply** → optional **Undo**; copy the task to reuse the recipe, or edit and Re-run

### Assigning work
1. Ensure the task has a **description** (required before the Agent can be queued)
2. Open **Assign to Agent** from the task card toolbar (or assignee flow when AI is on)
3. Choose:
   - **Assist** — no repository
   - **Code** — repository URL + optional branch
   - **Automation** (admins) — scope: this board / selected boards / all boards
   - Optional model override (admins) when allowed
4. Confirm — the task is assigned to the Agent and status becomes **queued**, then **running** when a runner slot is available
5. For Automation, review the dry-run on the activity screen and click **Apply** before changes run

### Controlling a running job
- Open the **Agent activity** screen from the card
- **Pause** / **Stop** — requests the runner to cancel; status updates on the card
- **Resume** / **Re-run** — re-queues work after pause, wait, stop, or failure (as allowed by status)
- **Apply** / **Undo** (Automation, admins) — execute or reverse the dry-run plan
- While the Agent is actively working, dragging the card may be blocked

### Waiting for your reply
- The Agent may post a comment and enter a **waiting** state
- Reply in comments, then **resume** when you want work to continue
- Automation waiting for Apply is a separate admin confirmation step (not a comment reply)

### Prerequisites checklist
| Who | Need |
|-----|------|
| Admin | AI enabled; LLM provider/key/model; runner URL/token for coding/automation jobs |
| Admin (automation) | Use Automation mode; review dry-run; Apply/Undo |
| User (coding) | Profile → Dev: GitHub PAT and/or SSH key with access to the repo |
| User (assist) | AI enabled; no Git credentials required |

---

## Keyboard Shortcuts

In the app, open **Help → Shortcuts** (F1 or **?**) for the same reference.

### Global Shortcuts
- **F1** or **?**: Open help modal (`?` ignored while typing in a field)
- **Escape**: Close modals, confirmation dialogs, and exit edit modes (layered: overlays first, then task details, then multi-select)
- **Enter**: Confirm actions, save changes

### Boards page (when not typing / no dialog open)
- **/** or **Ctrl/Cmd+K**: Focus header task search
- **S**: Open or close the Filter panel
- **+**: Create a new task in the first column (Shift+= on US / FR-CA keyboards)
- **1 / 2 / 3 / 4**: Switch Kanban / List / Gantt / Calendar view
- **F / P / M**: Card density — Full / Preview / Minimal
- **Escape** (in search/filter panel): Clear the focused field, then clear all filters (same as the X controls)

### Admin
- **/** or **Ctrl/Cmd+K**: Focus settings search

### List View
- **Ctrl/Cmd + click** on an inactive part of a row: Add or remove one task from the selection
- **Shift + click** on an inactive part of a row: Select the visible sorted range from the last selected task
- **Escape**: Clear the current multi-selection or dismiss the available bulk undo

### Gantt View
- **Escape**: Exit relationship mode, exit multi-select mode
- **Enter**: Exit relationship mode, exit multi-select mode
- **Arrow Keys**: Move task selection (in multi-select mode)

### Calendar View
- **Escape**: Exit multi-select mode
- **Enter**: Exit multi-select mode
- **Ctrl/Cmd + click**: Add or remove one task from the selection
- **Shift + click**: Select the visible dated range from the last selected task
- **← / →**: In multi-select mode, shift selected task dates by one day

### Text Editor
- **Escape**: Cancel editing / close link dialog
- **Enter**: Save changes
- **Ctrl/Cmd + Arrow Keys**: Normal text navigation
- **Backspace/Delete**: Delete text (respects image deletion settings)

### Task Management
- **Click**: Select task
- **Drag**: Move tasks between columns using the handle
- **Ctrl/Cmd + click** on a card: Toggle multi-select

---

## Troubleshooting

### Common Issues

#### WebSocket Connection Problems
- **Symptoms**: No real-time updates, manual refresh needed
- **Solution**: Use the refresh button to force data sync
- **Prevention**: Check internet connection and browser compatibility; in multi-pod K8s, ensure Redis is healthy for the Socket.IO adapter

#### Task Not Updating on the Board
- **Symptoms**: Side-panel edits save but the card looks unchanged
- **Solution**: Confirm you are not in **compact** card density (red dot on Tools); switch to expand/shrink to see descriptions. Use refresh if the WebSocket disconnected
- **Prevention**: Keep Tools density on expand/shrink when reviewing descriptions

#### Permission Errors
- **Symptoms**: Cannot perform certain actions
- **Solution**: Check user role and permissions
- **Prevention**: Ensure proper user role assignment

#### Performance Test Overlay (admin troubleshooting)
- **Enable**: Settings → App Settings → Troubleshooting → **Performance Test Overlay** (type `TROUBLE` first on multi-tenant/demo). Saves to **your** `user_settings.FE_PERF_TESTS` via `PUT /api/user/settings`
- **Use**:
  - **Kanban**: floating **PERF TESTS** — Burst create, Move storm, Cleanup, reports
  - **Admin**: floating **PERF TESTS · ADMIN** — seed users (`perf.user…@local`, active, no invite), tags (`perf-tag-…`), sprints (`Perf Sprint …`), Seed all, Cleanup seed
- **Disable**: Turn the same toggle off when finished; other admins never see the overlay from your preference
- **Multi-user load**: Each participating admin enables the overlay on their own account; each tab runs its own client-driven scenarios

#### CSP reports (security hardening)
- **Where**: Settings → App Settings → Troubleshooting → **CSP reports**
- **What**: Browser Content-Security-Policy (Report-Only) violations collected at `POST /api/csp-report` and stored per tenant
- **Use**: Review the list after normal usage; Clear when done. Keep CSP Report-Only until the list stays quiet, then enforce
- **Details**: See `DEBUGGING.md` (CSP reports section) and `audit/security-assessment-current-2026-08.md` (S4)

#### Performance Issues
- **Symptoms**: Slow loading, laggy interface
- **Solution**: Clear browser cache, check internet connection
- **Prevention**: Regular browser maintenance, stable internet

#### AI Agent / runner problems
- **Symptoms**: Assign to Agent fails, job stays queued, or coding jobs fail immediately
- **Checks**:
  - Settings → AI Settings: AI enabled; **Validate** LLM; **Probe** runner (for coding jobs)
  - Task has a non-empty description
  - Coding jobs: Profile → Dev has a GitHub PAT and/or SSH key; use **Repo check** for the URL
  - Assist jobs do not need a runner for LLM chat alone in the same way as coding — if coding is intended, confirm runner URL/token and that `AI_CALLBACK_BASE_URL` / networking allows the runner to reach the app (Docker/K8s)
- **Developer reference**: [`docs/AI_INTEGRATION.md`](docs/AI_INTEGRATION.md)

### Getting Help
- **Help Modal**: Press F1 or ? (or click help button)
- **Documentation**: This comprehensive guide
- **Support**: Contact system administrator
- **GitHub**: Project repository link in the header (unless hidden by admin)

---

*This documentation covers the current Easy-Kanban application (PostgreSQL edition). For deployment and operations details, see README.md and DOCKER.md. For AI Agent internals, see docs/AI_INTEGRATION.md.*
