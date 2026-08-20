import { Board, Columns, Task, TeamMember } from '../types';
import { filterTasks, hasConfiguredSearchFilters, SprintSearchInfo } from './taskUtils';
import { dedupeTasksInColumns } from './taskReorderingUtils';
import { isAgentMemberId } from './agentMemberUi';

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
  const memberRoleFiltering =
    includeAssignees || includeWatchers || includeCollaborators || includeRequesters;

  const stripAgentIfNeeded = (tasks: Task[]) =>
    showAgentTasks ? tasks : tasks.filter((task) => !isAgentMemberId(task.memberId));

  const customFilterTasks = (tasks: Task[]) => {
    if (!memberRoleFiltering) return tasks;

    const showAllMembers = selectedMembers.length === 0;
    const filteredTasks: Task[] = [];

    for (const task of tasks) {
      let includeTask = false;

      if (includeAssignees) {
        if (showAllMembers) {
          if (task.memberId) includeTask = true;
        } else if (task.memberId && selectedMembers.includes(task.memberId)) {
          includeTask = true;
        }
      }

      if (!includeTask && includeWatchers) {
        const watchers = task.watchers || [];
        if (watchers.length > 0) {
          if (showAllMembers) {
            includeTask = true;
          } else if (watchers.some((watcher) => selectedMembers.includes(watcher.id))) {
            includeTask = true;
          }
        }
      }

      if (!includeTask && includeCollaborators) {
        const collaborators = task.collaborators || [];
        if (collaborators.length > 0) {
          if (showAllMembers) {
            includeTask = true;
          } else if (collaborators.some((c) => selectedMembers.includes(c.id))) {
            includeTask = true;
          }
        }
      }

      if (!includeTask && includeRequesters) {
        if (showAllMembers) {
          if (task.requesterId) includeTask = true;
        } else if (task.requesterId && selectedMembers.includes(task.requesterId)) {
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
