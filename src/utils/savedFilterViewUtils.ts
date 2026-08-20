import type { Board, SearchFilters } from '../types';
import type { SavedFilterView } from '../api';
import {
  parseSavedViewStringArray,
  resolveProjectFiltersFromSavedView,
} from './taskUtils';

/** Default empty search filter state (matches userPreferences / clear-all). */
export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  text: '',
  dateFrom: '',
  dateTo: '',
  dueDateFrom: '',
  dueDateTo: '',
  selectedMembers: [],
  selectedPriorities: [],
  selectedTags: [],
  selectedProjectIds: [],
  taskId: '',
  linkedTasksOnly: false,
  overdueOnly: false,
  blockedOnly: false,
  selectedSprintIds: [],
  stalledDays: null,
};

/** Parse boolean fields from saved views (Postgres/SQLite variants). */
export function parseSavedViewBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** API / DB filter fields on saved views. */
export interface SavedViewFilterFields {
  textFilter?: string;
  dateFromFilter?: string;
  dateToFilter?: string;
  dueDateFromFilter?: string;
  dueDateToFilter?: string;
  memberFilters?: string[];
  priorityFilters?: string[];
  tagFilters?: string[];
  projectFilters?: string[];
  taskFilter?: string;
  linkedTasksOnlyFilter?: boolean;
  overdueOnlyFilter?: boolean;
  blockedOnlyFilter?: boolean;
  sprintFilters?: string[];
  stalledDaysFilter?: number;
}

/** Convert live SearchInterface filters → API / DB view filter fields. */
export function searchFiltersToViewFilters(searchFilters: SearchFilters): SavedViewFilterFields {
  return {
    textFilter: searchFilters.text || undefined,
    dateFromFilter: searchFilters.dateFrom || undefined,
    dateToFilter: searchFilters.dateTo || undefined,
    dueDateFromFilter: searchFilters.dueDateFrom || undefined,
    dueDateToFilter: searchFilters.dueDateTo || undefined,
    memberFilters:
      searchFilters.selectedMembers.length > 0 ? searchFilters.selectedMembers : undefined,
    priorityFilters:
      searchFilters.selectedPriorities.length > 0 ? searchFilters.selectedPriorities : undefined,
    tagFilters: searchFilters.selectedTags.length > 0 ? searchFilters.selectedTags : undefined,
    projectFilters:
      searchFilters.selectedProjectIds.length > 0 ? searchFilters.selectedProjectIds : undefined,
    taskFilter: searchFilters.taskId || undefined,
    linkedTasksOnlyFilter: searchFilters.linkedTasksOnly ? true : undefined,
    overdueOnlyFilter: searchFilters.overdueOnly ? true : undefined,
    blockedOnlyFilter: searchFilters.blockedOnly ? true : undefined,
    sprintFilters:
      searchFilters.selectedSprintIds.length > 0 ? searchFilters.selectedSprintIds : undefined,
    stalledDaysFilter:
      searchFilters.stalledDays != null && searchFilters.stalledDays > 0
        ? searchFilters.stalledDays
        : undefined,
  };
}

/** Stable snapshot for comparing live filters with a saved view. */
function normalizeSearchFiltersForCompare(filters: SearchFilters): string {
  const stalled =
    filters.stalledDays != null && filters.stalledDays > 0 ? filters.stalledDays : null;
  return JSON.stringify({
    text: filters.text || '',
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    dueDateFrom: filters.dueDateFrom || '',
    dueDateTo: filters.dueDateTo || '',
    selectedMembers: [...filters.selectedMembers].sort(),
    selectedPriorities: [...filters.selectedPriorities].sort(),
    selectedTags: [...filters.selectedTags].sort(),
    selectedProjectIds: [...filters.selectedProjectIds].sort(),
    taskId: filters.taskId || '',
    linkedTasksOnly: filters.linkedTasksOnly,
    overdueOnly: filters.overdueOnly,
    blockedOnly: filters.blockedOnly,
    selectedSprintIds: [...filters.selectedSprintIds].sort(),
    stalledDays: stalled,
  });
}

/** True when live filters match the criteria stored on a saved view. */
export function searchFiltersMatchSavedView(
  filters: SearchFilters,
  view: SavedFilterView,
  boards: Pick<Board, 'id' | 'project'>[] = [],
): boolean {
  const fromView = viewToSearchFilters(view, boards);
  return (
    normalizeSearchFiltersForCompare(filters) === normalizeSearchFiltersForCompare(fromView)
  );
}

/** Convert a saved view row → live SearchInterface filters. */
export function viewToSearchFilters(
  view: SavedFilterView,
  boards: Pick<Board, 'id' | 'project'>[] = [],
): SearchFilters {
  return {
    text: view.textFilter || '',
    dateFrom: view.dateFromFilter || '',
    dateTo: view.dateToFilter || '',
    dueDateFrom: view.dueDateFromFilter || '',
    dueDateTo: view.dueDateToFilter || '',
    selectedMembers: parseSavedViewStringArray(view.memberFilters),
    selectedPriorities: parseSavedViewStringArray(
      view.priorityFilters,
    ) as SearchFilters['selectedPriorities'],
    selectedTags: parseSavedViewStringArray(view.tagFilters),
    selectedProjectIds: resolveProjectFiltersFromSavedView(view, boards),
    taskId: view.taskFilter || '',
    linkedTasksOnly: parseSavedViewBoolean(view.linkedTasksOnlyFilter),
    overdueOnly: parseSavedViewBoolean(view.overdueOnlyFilter),
    blockedOnly: parseSavedViewBoolean(view.blockedOnlyFilter),
    selectedSprintIds: parseSavedViewStringArray(view.sprintFilters),
    stalledDays:
      view.stalledDaysFilter != null && view.stalledDaysFilter !== ''
        ? Number(view.stalledDaysFilter)
        : null,
  };
}
