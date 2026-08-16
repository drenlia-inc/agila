export interface TeamMember {
  id: string;
  name: string;
  color: string;
  user_id?: string;
  email?: string;
  /** Optional short bio from the linked user (shown via (i) in member tooltip). */
  bio?: string;
  /** false when linked user is inactive; omitted/true otherwise (Agent stubs, etc.) */
  isActive?: boolean;
  /** Linked user is a read-only viewer (no admin/user role). */
  isViewer?: boolean;
  avatarUrl?: string;
  authProvider?: 'local' | 'google';
  googleAvatarUrl?: string;
}

export type Priority = string; // Now dynamic from database

export interface PriorityOption {
  id: number;
  priority: string;
  color: string;
  position: number;
  created_at: string;
  initial?: boolean | number; // SQLite returns 0/1, but could be boolean
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface Comment {
  id: string;
  text: string;
  authorId: string;
  authorName?: string;
  authorColor?: string;
  createdAt: string;
  taskId: string;
  attachments: Attachment[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  ticket?: string;
  columnId: string;
  memberId?: string;
  requesterId?: string;
  startDate: string;
  dueDate?: string;
  effort: number;
  priority: Priority;
  priorityId?: number;
  priorityName?: string;
  priorityColor?: string;
  status?: string;
  comments: Comment[];
  position?: number;
  boardId?: string;
  sprintId?: string | null; // Sprint assignment (NULL = backlog/unassigned)
  tags?: Tag[];
  watchers?: TeamMember[];
  collaborators?: TeamMember[];
  attachmentCount?: number;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
  /** When the task entered its current column (for aging). */
  columnEnteredAt?: string | null;
  /** Soft blocked flag — does not prevent moves. */
  isBlocked?: boolean;
  blockedReason?: string | null;
  /** Soft-delete timestamp (ISO). Present when task is in Trash. */
  deletedAt?: string | null;
  deletedBy?: string | null;
}

/** Options for parent task refresh handlers (e.g. App.handleEditTask). */
export type TaskUpdateOptions = {
  /** Persist the task but skip activity-feed logging for this write. */
  skipActivity?: boolean;
  /**
   * Refresh local/parent UI only — do not PATCH /tasks/:id.
   * Use after comment/tag/watcher/collaborator APIs that already persisted the change.
   */
  localOnly?: boolean;
};

export interface Tag {
  id: number;
  tag: string;
  description?: string;
  color?: string;
  created_at: string;
}

export interface Column {
  id: string;
  title: string;
  tasks: Task[];
  boardId: string;
  position?: number;
  is_finished?: boolean;
  is_archived?: boolean;
  /** Soft WIP limit (task count). null/undefined = unlimited. */
  wip_limit?: number | null;
  /** Short entry/exit policy note shown under the column header. */
  policy_text?: string | null;
}

export interface Columns {
  [key: string]: Column;
}

export interface Board {
  id: string;
  title: string;
  project?: string;
  columns: Columns;
  position?: number;
  /** Soft WIP limit for active work (excludes finished/archived). null = unlimited. */
  wip_limit?: number | null;
  /** Soft-delete timestamp (ISO). Soft-deleted boards are hidden from tabs. */
  deletedAt?: string | null;
  deletedBy?: string | null;
  /** Total tasks on board (lifecycle deleted-boards list). */
  taskCount?: number;
  /** Soft-deleted tasks on board (lifecycle deleted-boards list). */
  trashTaskCount?: number;
}

export interface QueryLog {
  id: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE' | 'ERROR';
  query: string;
  timestamp: string;
  error?: string;
}

export interface DragPreview {
  targetColumnId: string;
  insertIndex: number;
}

/** Kanban column banner when a newly created task is hidden by sprint / search / member filters. */
export interface ColumnVisibilityWarning {
  taskId: string;
  /** True when a specific sprint is selected (not backlog) and the task has no matching sprintId. */
  showSprintPrompt: boolean;
  selectedSprintId?: string;
  /** True when search or member filters hide the task (offer “Clear filters”). */
  showClearFilters: boolean;
  reasons: {
    search: boolean;
    sprint: boolean;
    members: boolean;
  };
}

export interface SearchFilters {
  text: string;
  dateFrom: string;
  dateTo: string;
  dueDateFrom: string;
  dueDateTo: string;
  selectedMembers: string[];
  selectedPriorities: string[];
  selectedTags: string[];
}


export interface SiteSettings {
  SITE_NAME: string;
  SITE_URL: string;
  [key: string]: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  avatarUrl?: string;
  authProvider?: 'local' | 'google';
  googleAvatarUrl?: string;
  displayName?: string;
  /** Optional short bio / memo */
  bio?: string;
}