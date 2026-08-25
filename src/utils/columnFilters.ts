import { Board, Columns, Task, TeamMember } from '../types';
import { filterTasks, hasConfiguredSearchFilters, SprintSearchInfo } from './taskUtils';
import { dedupeTasksInColumns } from './taskReorderingUtils';
import { isAgentMemberId } from './agentMemberUi';
import { UNASSIGNED_MEMBER_FILTER_ID } from '../constants/appConstants';

export type ColumnFilterState = {
  selectedSprintId: string | null;
  searchFilters: Parameters<typeof filterTasks>[1];
  selectedMembers: string[];
  includeAssignees: boolean;
  includeWatchers: boolean;
  includeCollaborators: boolean;
  includeRequesters: boolean;
  showAgentTasks: boolean;
  /** When set, linked-tasks-only filter applies; omit for boards without relationship data. */
  linkedTaskIds?: Set<string>;
};

/** Resolve sprint id from either camelCase or snake_case API shapes. */
export function getTaskSprintId(task: Task | Record<string, unknown>): string | null {
  const sprintId = (task as Task).sprintId ?? (task as { sprint_id?: string | null }).sprint_id;
  return sprintId ?? null;
}

/** Prefer payload sprint fields when present (`sprintId` or `sprint_id`), else keep fallback. */
export function sprintIdFromTaskPayload(
  payload: Record<string, unknown> | null | undefined,
  fallback?: string | null
): string | null {
  if (!payload) return fallback ?? null;
  const hasCamel = Object.prototype.hasOwnProperty.call(payload, 'sprintId');
  const hasSnake = Object.prototype.hasOwnProperty.call(payload, 'sprint_id');
  if (!hasCamel && !hasSnake) return fallback ?? null;
  const value =
    (payload as { sprintId?: string | null }).sprintId ??
    (payload as { sprint_id?: string | null }).sprint_id;
  return value ?? null;
}

export function taskMatchesSelectedSprint(
  task: Task | Record<string, unknown>,
  selectedSprintId: string | null
): boolean {
  if (selectedSprintId === null) return true;
  const sprintId = getTaskSprintId(task);
  if (selectedSprintId === 'backlog') {
    return !sprintId;
  }
  return sprintId === selectedSprintId;
}

/** True when selectedMembers includes the unassigned-assignee sentinel. */
export function selectionIncludesUnassigned(selectedMembers: string[]): boolean {
  return selectedMembers.includes(UNASSIGNED_MEMBER_FILTER_ID);
}

/** Real member ids in a selection (excludes the unassigned sentinel). */
export function realSelectedMemberIds(selectedMembers: string[]): string[] {
  return selectedMembers.filter((id) => id !== UNASSIGNED_MEMBER_FILTER_ID);
}

/**
 * Whether member-avatar selection is “show everyone” (no people and not
 * filtering to unassigned-only).
 */
export function isShowAllMembersSelection(selectedMembers: string[]): boolean {
  return realSelectedMemberIds(selectedMembers).length === 0 && !selectionIncludesUnassigned(selectedMembers);
}

/** Assignee filter match for a task given selected member ids (may include unassigned sentinel). */
export function taskMatchesAssigneeSelection(
  task: Task,
  selectedMembers: string[],
  showAllMembers: boolean
): boolean {
  if (showAllMembers) {
    // Include assigned and unassigned work when no people are selected
    return true;
  }
  if (!task.memberId) {
    return selectionIncludesUnassigned(selectedMembers);
  }
  return realSelectedMemberIds(selectedMembers).includes(task.memberId);
}

/**
 * Apply the same sprint / search / member / agent filters used on the live board.
 * Pure — safe to call when seeding filteredColumns on board switch (avoids unfiltered flash).
 */
export function applyActiveColumnFilters(
  columnsToFilter: Columns,
  state: ColumnFilterState,
  members: TeamMember[],
  boards: Board[],
  sprints: SprintSearchInfo[] = []
): Columns {
  if (!columnsToFilter || Object.keys(columnsToFilter).length === 0) {
    return columnsToFilter || {};
  }

  const uniqueColumns = dedupeTasksInColumns(columnsToFilter);
  const {
    selectedSprintId,
    searchFilters,
    selectedMembers,
    includeAssignees,
    includeWatchers,
    includeCollaborators,
    includeRequesters,
    showAgentTasks,
    linkedTaskIds,
  } = state;

  const searchConfigured = hasConfiguredSearchFilters(searchFilters);
  const wantsUnassigned = selectionIncludesUnassigned(selectedMembers);
  // Unassigned sentinel is a first-class filter (does not require Assignees role chip)
  const memberRoleFiltering =
    includeAssignees ||
    includeWatchers ||
    includeCollaborators ||
    includeRequesters ||
    wantsUnassigned;

  const stripAgentIfNeeded = (tasks: Task[]) =>
    showAgentTasks ? tasks : tasks.filter((task) => !isAgentMemberId(task.memberId));

  const customFilterTasks = (tasks: Task[]) => {
    if (!memberRoleFiltering) return tasks;

    const showAllMembers = isShowAllMembersSelection(selectedMembers);
    const realMemberIds = realSelectedMemberIds(selectedMembers);
    const filteredTasks: Task[] = [];

    for (const task of tasks) {
      let includeTask = false;

      // Assignees role and/or Unassigned chip
      if (includeAssignees || wantsUnassigned) {
        if (taskMatchesAssigneeSelection(task, selectedMembers, showAllMembers)) {
          includeTask = true;
        }
      }

      if (!includeTask && includeWatchers) {
        const watchers = task.watchers || [];
        if (watchers.length > 0) {
          if (showAllMembers) {
            includeTask = true;
          } else if (watchers.some((watcher) => realMemberIds.includes(watcher.id))) {
            includeTask = true;
          }
        }
      }

      if (!includeTask && includeCollaborators) {
        const collaborators = task.collaborators || [];
        if (collaborators.length > 0) {
          if (showAllMembers) {
            includeTask = true;
          } else if (collaborators.some((c) => realMemberIds.includes(c.id))) {
            includeTask = true;
          }
        }
      }

      if (!includeTask && includeRequesters) {
        if (showAllMembers) {
          if (task.requesterId) includeTask = true;
        } else if (task.requesterId && realMemberIds.includes(task.requesterId)) {
          includeTask = true;
        }
      }

      if (includeTask) filteredTasks.push(task);
    }

    return filteredTasks;
  };

  const effectiveFilters = {
    ...searchFilters,
    selectedMembers: selectedMembers.length > 0 ? selectedMembers : searchFilters.selectedMembers,
  };

  const filteredColumns: Columns = {};

  for (const [columnId, column] of Object.entries(uniqueColumns)) {
    let columnTasks = column.tasks || [];

    if (selectedSprintId !== null) {
      columnTasks = columnTasks.filter((task) =>
        taskMatchesSelectedSprint(task, selectedSprintId)
      );
    }

    if (searchConfigured) {
      const searchOnlyFilters = memberRoleFiltering
        ? { ...effectiveFilters, selectedMembers: [] }
        : effectiveFilters;
      columnTasks = filterTasks(columnTasks, searchOnlyFilters, true, members, boards, sprints, column);
    }

    if (memberRoleFiltering) {
      columnTasks = customFilterTasks(columnTasks);
    }

    columnTasks = stripAgentIfNeeded(columnTasks);

    if (searchFilters.linkedTasksOnly && linkedTaskIds !== undefined) {
      columnTasks = columnTasks.filter((task) => linkedTaskIds.has(task.id));
    }

    filteredColumns[columnId] = {
      ...column,
      tasks: columnTasks,
    };
  }

  return filteredColumns;
}
