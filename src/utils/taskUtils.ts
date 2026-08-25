import { Task, SearchFilters, Columns, Board, TeamMember, Column } from '../types';
import { getTaskWatchers, getTaskCollaborators } from '../api';
import { parseLocalDate } from './dateUtils';
import { getColumnAgeDays } from './kanbanFlowUtils';

/** Parse JSON/text array fields from saved filter views. */
export function parseSavedViewStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Stable project key for a board (PROJ-XXXXX or board id fallback). */
export function getBoardProjectKey(board: Pick<Board, 'id' | 'project'>): string {
  return (board.project?.trim() || board.id);
}

/** Whether a board is included in the project filter (empty selection = all). */
export function boardMatchesSelectedProjects(
  board: Pick<Board, 'id' | 'project'>,
  selectedProjectIds: string[]
): boolean {
  if (!selectedProjectIds.length) return true;
  return selectedProjectIds.includes(getBoardProjectKey(board));
}

/** Resolve saved-view project filters from JSON array or legacy substring field. */
export function resolveProjectFiltersFromSavedView(
  view: { projectFilters?: string[]; projectFilter?: string },
  boards: Pick<Board, 'id' | 'project'>[]
): string[] {
  if (Array.isArray(view.projectFilters) && view.projectFilters.length > 0) {
    return view.projectFilters;
  }
  const legacy = view.projectFilter?.trim();
  if (!legacy) return [];
  const q = legacy.toLowerCase();
  return boards
    .filter((b) => {
      const key = getBoardProjectKey(b);
      const proj = b.project?.toLowerCase() || '';
      return key.toLowerCase() === q || proj.includes(q);
    })
    .map(getBoardProjectKey);
}

/** Soft-delete markers from API / SQL (camelCase or snake_case). */
export const isTaskSoftDeleted = (task: Task | null | undefined): boolean => {
  if (!task) return false;
  const deletedAt = task.deletedAt ?? (task as any).deleted_at;
  return deletedAt != null && deletedAt !== '';
};

/** Copy snake_case / Date delete markers onto camelCase so every surface agrees. */
export const normalizeTaskSoftDelete = <T extends Task | Record<string, unknown>>(task: T): T => {
  const raw = task as T & {
    deletedAt?: unknown;
    deleted_at?: unknown;
    deletedBy?: unknown;
    deleted_by?: unknown;
  };
  const deletedAt = raw.deletedAt ?? raw.deleted_at ?? null;
  const deletedBy = raw.deletedBy ?? raw.deleted_by ?? null;
  return {
    ...task,
    deletedAt:
      deletedAt instanceof Date ? deletedAt.toISOString() : (deletedAt as string | null),
    deletedBy,
  } as T;
};

/** Clear soft-delete fields so TaskDetails cannot stay stuck in read-only after restore. */
export const clearTaskSoftDelete = <T extends Task | Record<string, unknown>>(task: T): T => {
  const next = { ...task } as T & {
    deletedAt?: string | null;
    deletedBy?: string | null;
    deleted_at?: string | null;
    deleted_by?: string | null;
  };
  next.deletedAt = null;
  next.deletedBy = null;
  next.deleted_at = null;
  next.deleted_by = null;
  return next;
};

/**
 * Strip HTML tags from a string for text search
 */
const stripHtmlTags = (html: string): string => {
  if (!html) return '';
  
  // IMPORTANT: Remove blob URLs BEFORE setting innerHTML to prevent ERR_FILE_NOT_FOUND errors
  // The browser tries to fetch blob URLs as soon as they appear in the DOM
  let cleanedHtml = html;
  if (cleanedHtml.includes('blob:')) {
    // Remove img tags with blob URLs
    cleanedHtml = cleanedHtml.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/gi, '');
    // Remove any remaining blob URLs from other contexts
    cleanedHtml = cleanedHtml.replace(/blob:[^\s"')]+/gi, '');
  }
  
  // Remove HTML tags and decode HTML entities
  const tmp = document.createElement('div');
  tmp.innerHTML = cleanedHtml;
  return tmp.textContent || tmp.innerText || '';
};

/**
 * True when search/filter fields have values (independent of whether the Search panel is open).
 */
export const hasConfiguredSearchFilters = (searchFilters: SearchFilters): boolean => {
  return !!(
    searchFilters.text ||
    searchFilters.dateFrom ||
    searchFilters.dateTo ||
    searchFilters.dueDateFrom ||
    searchFilters.dueDateTo ||
    searchFilters.selectedMembers.length > 0 ||
    searchFilters.selectedPriorities.length > 0 ||
    searchFilters.selectedTags.length > 0 ||
    (searchFilters.selectedProjectIds?.length ?? 0) > 0 ||
    searchFilters.taskId ||
    searchFilters.linkedTasksOnly ||
    searchFilters.overdueOnly ||
    searchFilters.blockedOnly ||
    (searchFilters.selectedSprintIds?.length ?? 0) > 0 ||
    (searchFilters.stalledDays != null && searchFilters.stalledDays > 0)
  );
};

/** Past due or missing due date; finished/archived columns never match. */
export function isTaskOverdueForFilter(
  task: Pick<Task, 'dueDate'>,
  column?: Pick<Column, 'is_finished' | 'is_archived'> | null
): boolean {
  if (column?.is_finished || column?.is_archived) return false;
  if (!task.dueDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = parseLocalDate(task.dueDate);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
}

/** Stalled = at least minDays in the current column; finished/archived columns never match. */
export function isTaskStalledForFilter(
  task: Pick<Task, 'columnEnteredAt'>,
  minDays: number,
  column?: Pick<Column, 'is_finished' | 'is_archived'> | null
): boolean {
  if (minDays <= 0) return true;
  if (column?.is_finished || column?.is_archived) return false;
  return getColumnAgeDays(task.columnEnteredAt) >= minDays;
}

function getTaskSprintIdLocal(task: Task | Record<string, unknown>): string | null {
  const sprintId = (task as Task).sprintId ?? (task as { sprint_id?: string | null }).sprint_id;
  return sprintId ?? null;
}

function taskMatchesSprintIds(task: Task, selectedSprintIds: string[]): boolean {
  if (!selectedSprintIds.length) return true;
  const sprintId = getTaskSprintIdLocal(task);
  const matchBacklog = selectedSprintIds.includes('backlog') && !sprintId;
  const matchSprint = sprintId != null && selectedSprintIds.includes(sprintId);
  return matchBacklog || matchSprint;
}

/** Search criteria excluding the linked-tasks-only toggle (handled with board relationship data). */
export const hasNonLinkSearchFilters = (searchFilters: SearchFilters): boolean => {
  return hasConfiguredSearchFilters({ ...searchFilters, linkedTasksOnly: false });
};

/** Minimal sprint shape for text search by sprint name. */
export type SprintSearchInfo = { id: string; name: string };

/**
 * Filter tasks based on search criteria.
 * Criteria always apply when set — Search panel visibility (`isSearchActive`) does not gate filtering.
 * The `isSearchActive` argument is kept for call-site compatibility and ignored.
 */
export const filterTasks = (
  tasks: Task[],
  searchFilters: SearchFilters,
  _isSearchActive?: boolean,
  members?: TeamMember[],
  boards?: any[],
  sprints?: SprintSearchInfo[],
  column?: Pick<Column, 'is_finished' | 'is_archived'> | null
): Task[] => {
  if (!hasConfiguredSearchFilters(searchFilters)) return tasks;

  return tasks.filter(task => {
    // Text search: title, description, comments, ticket, assignee, requester, sprint name
    if (searchFilters.text) {
      const searchText = searchFilters.text.toLowerCase();
      const titleMatch = task.title.toLowerCase().includes(searchText);
      // Strip HTML tags from description before searching
      const descriptionText = stripHtmlTags(task.description);
      const descriptionMatch = descriptionText.toLowerCase().includes(searchText);
      
      // Search in comments (strip HTML from comment text)
      const commentsMatch = task.comments?.some(comment => {
        const commentText = stripHtmlTags(comment.text || '');
        return commentText.toLowerCase().includes(searchText);
      }) || false;

      const ticketMatch = Boolean(
        task.ticket && task.ticket.toLowerCase().includes(searchText)
      );
      
      // Search in requester / assignee names
      let requesterMatch = false;
      let assigneeMatch = false;
      if (members) {
        if (task.requesterId) {
          const requester = members.find(m => m.id === task.requesterId);
          if (requester) {
            requesterMatch = requester.name.toLowerCase().includes(searchText);
          }
        }
        if (task.memberId) {
          const assignee = members.find(m => m.id === task.memberId);
          if (assignee) {
            assigneeMatch = assignee.name.toLowerCase().includes(searchText);
          }
        }
      }

      let sprintMatch = false;
      if (sprints?.length) {
        const sprintId = task.sprintId ?? (task as { sprint_id?: string | null }).sprint_id;
        if (sprintId) {
          const sprint = sprints.find((s) => s.id === sprintId);
          if (sprint?.name?.toLowerCase().includes(searchText)) {
            sprintMatch = true;
          }
        }
      }
      
      if (
        !titleMatch &&
        !descriptionMatch &&
        !commentsMatch &&
        !ticketMatch &&
        !requesterMatch &&
        !assigneeMatch &&
        !sprintMatch
      ) {
        return false;
      }
    }

    // Date range filter (start date)
    if (searchFilters.dateFrom || searchFilters.dateTo) {
      const taskDate = parseLocalDate(task.startDate);
      if (searchFilters.dateFrom) {
        const fromDate = parseLocalDate(searchFilters.dateFrom);
        if (taskDate < fromDate) return false;
      }
      if (searchFilters.dateTo) {
        const toDate = parseLocalDate(searchFilters.dateTo);
        if (taskDate > toDate) return false;
      }
    }

    // Due date range filter
    if (searchFilters.dueDateFrom || searchFilters.dueDateTo) {
      if (!task.dueDate) return false; // No due date set
      const taskDueDate = parseLocalDate(task.dueDate);
      if (searchFilters.dueDateFrom) {
        const fromDate = parseLocalDate(searchFilters.dueDateFrom);
        if (taskDueDate < fromDate) return false;
      }
      if (searchFilters.dueDateTo) {
        const toDate = parseLocalDate(searchFilters.dueDateTo);
        if (taskDueDate > toDate) return false;
      }
    }

    // Members filter
    if (searchFilters.selectedMembers.length > 0) {
      if (!searchFilters.selectedMembers.includes(task.memberId || '') && 
          !searchFilters.selectedMembers.includes(task.requesterId || '')) {
        return false;
      }
    }

    // Priority filter
    if (searchFilters.selectedPriorities.length > 0) {
      if (!searchFilters.selectedPriorities.includes(task.priority)) {
        return false;
      }
    }

    // Tags filter
    if (searchFilters.selectedTags.length > 0) {
      if (!task.tags || task.tags.length === 0) {
        return false; // Task has no tags but filter requires tags
      }
      const taskTagIds = task.tags.map(tag => tag.id.toString());
      const hasMatchingTag = searchFilters.selectedTags.some(selectedTagId => 
        taskTagIds.includes(selectedTagId)
      );
      if (!hasMatchingTag) {
        return false;
      }
    }

    // Project filter (multi-select by board project key)
    if ((searchFilters.selectedProjectIds?.length ?? 0) > 0) {
      if (!boards || !task.boardId) return false;
      const board = boards.find(b => b.id === task.boardId);
      if (!board || !boardMatchesSelectedProjects(board, searchFilters.selectedProjectIds)) {
        return false;
      }
    }

    // Task identifier filter
    if (searchFilters.taskId) {
      if (!task.ticket || !task.ticket.toLowerCase().includes(searchFilters.taskId.toLowerCase())) {
        return false;
      }
    }

    if (searchFilters.overdueOnly && !isTaskOverdueForFilter(task, column)) {
      return false;
    }

    if (searchFilters.blockedOnly && !task.isBlocked) {
      return false;
    }

    if ((searchFilters.selectedSprintIds?.length ?? 0) > 0) {
      if (!taskMatchesSprintIds(task, searchFilters.selectedSprintIds)) {
        return false;
      }
    }

    if (searchFilters.stalledDays != null && searchFilters.stalledDays > 0) {
      if (!isTaskStalledForFilter(task, searchFilters.stalledDays, column)) {
        return false;
      }
    }

    return true;
  });
};

/**
 * Get filtered columns for display.
 * Panel visibility does not gate filtering — only whether criteria are set.
 */
export const getFilteredColumns = (
  columns: Columns,
  searchFilters: SearchFilters,
  _isSearchActive?: boolean,
  members?: TeamMember[],
  boards?: any[],
  sprints?: SprintSearchInfo[]
): Columns => {
  if (!hasConfiguredSearchFilters(searchFilters)) return columns;

  const filteredColumns: Columns = {};
  Object.entries(columns).forEach(([columnId, column]) => {
    filteredColumns[columnId] = {
      ...column,
      tasks: filterTasks(column.tasks, searchFilters, true, members, boards, sprints, column)
    };
  });
  return filteredColumns;
};

/**
 * Get filtered task count for a board (for tab pills)
 */
export const getFilteredTaskCountForBoard = (
  board: Board,
  searchFilters: SearchFilters,
  _isSearchActive?: boolean,
  members?: TeamMember[],
  boards?: any[],
  sprints?: SprintSearchInfo[]
): number => {
  if (!hasConfiguredSearchFilters(searchFilters)) {
    // Return total task count when no filters are active (excluding archived columns)
    let totalCount = 0;
    Object.values(board.columns || {}).forEach(column => {
      // Convert to boolean to handle SQLite integer values (0/1)
      const isArchived = Boolean(column.is_archived);
      if (!isArchived) {
        totalCount += column.tasks.length;
      }
    });
    return totalCount;
  }
  
  let totalCount = 0;
  Object.values(board.columns || {}).forEach(column => {
    // Convert to boolean to handle SQLite integer values (0/1)
    const isArchived = Boolean(column.is_archived);
    if (!isArchived) {
      totalCount += filterTasks(column.tasks, searchFilters, true, members, boards, sprints, column).length;
    }
  });
  return totalCount;
};

/**
 * Check if search filter criteria are set (and thus applied to the board).
 * `isSearchActive` is ignored — kept for call-site compatibility.
 */
export const hasActiveFilters = (searchFilters: SearchFilters, _isSearchActive?: boolean): boolean => {
  return hasConfiguredSearchFilters(searchFilters);
};

/**
 * Check if a single task would be filtered out by current filters
 */
export const wouldTaskBeFilteredOut = (
  task: Task,
  searchFilters: SearchFilters,
  _isSearchActive?: boolean,
  members?: TeamMember[],
  boards?: any[],
  sprints?: SprintSearchInfo[],
  linkedTaskIds?: Set<string>,
  column?: Pick<Column, 'is_finished' | 'is_archived'> | null
): boolean => {
  if (searchFilters.linkedTasksOnly && linkedTaskIds !== undefined && !linkedTaskIds.has(task.id)) {
    return true;
  }
  if (!hasNonLinkSearchFilters(searchFilters)) return false;

  const filtered = filterTasks([task], searchFilters, true, members, boards, sprints, column);
  return filtered.length === 0;
};

/**
 * Sum task effort (unit-agnostic integer). Non-finite / missing values count as 0.
 */
export const sumTaskEffort = (tasks: Task[] | undefined | null): number => {
  if (!tasks || tasks.length === 0) return 0;
  return tasks.reduce((sum, task) => {
    const effort = Number(task.effort);
    return sum + (Number.isFinite(effort) ? effort : 0);
  }, 0);
};

export type EffortUnit = 'hours' | 'points';

/** Tenant setting EFFORT_UNIT: hours (default) | points */
export const parseEffortUnit = (settings?: { [key: string]: string } | null): EffortUnit =>
  settings?.EFFORT_UNIT === 'points' ? 'points' : 'hours';

/** Display effort: `10h` for hours, bare `10` for points. */
export const formatEffortDisplay = (value: number, unit: EffortUnit): string => {
  const n = Number.isFinite(value) ? value : 0;
  return unit === 'hours' ? `${n}h` : String(n);
};

/**
 * Format member names for tooltips: full list, one name per line (use with multiline tooltip chrome).
 */
export const formatMembersTooltip = (members: TeamMember[], type: 'watcher' | 'collaborator'): string => {
  if (!members || members.length === 0) return '';

  const typeLabel = type === 'watcher' ? 'Watcher' : 'Collaborator';
  const typeLabelPlural = type === 'watcher' ? 'Watchers' : 'Collaborators';
  const header = members.length === 1 ? typeLabel : `${typeLabelPlural} (${members.length})`;

  return [header, ...members.map(m => m.name || m.id)].join('\n');
};
