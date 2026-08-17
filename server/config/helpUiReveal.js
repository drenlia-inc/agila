/**
 * Open/reveal steps for Help Go there. Harvested selectors alone cannot open
 * closed panels (Filter, column dropdown, trash, profile tabs).
 */
export const HELP_UI_REVEAL = {
  'help:kanban-column-filter': ['boardToolbar', 'searchFilters', 'columnFilter'],
  'tour:search-filter': ['boardToolbar', 'searchFilters'],
  'tour:board-trash-toggle': ['boardToolbar', 'trash'],
  'tour:column-visibility': ['boardToolbar', 'searchFilters', 'columnFilter']
};
