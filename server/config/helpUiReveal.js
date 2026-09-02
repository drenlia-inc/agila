/**
 * Open/reveal steps for Help Go there. Harvested selectors alone cannot open
 * closed panels (Filter, column dropdown, trash, profile tabs).
 */
export const HELP_UI_REVEAL = {
  'help:m365-sso': ['ssoAddMenu'],
  'help:github-sso': ['ssoAddMenu'],
  'help:sso-add-provider': ['ssoAddMenu'],
  'help:kanban-column-filter': ['boardToolbar', 'searchFilters', 'columnFilter'],
  'help:calendar-column-filter': ['boardToolbar', 'searchFilters', 'columnFilter'],
  'tour:search-filter': ['boardToolbar', 'searchFilters'],
  'tour:board-trash-toggle': ['boardToolbar', 'trash'],
  'tour:column-visibility': ['boardToolbar', 'searchFilters', 'columnFilter']
};
