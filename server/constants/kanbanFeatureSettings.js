/**
 * Kanban chrome visibility (board tabs + column headers).
 * Values are strings in the settings table ("true" / "false").
 */

export const KANBAN_FEATURE_SETTING_DEFAULTS = Object.freeze([
  ['SHOW_BOARD_TAB_TASK_COUNTS', 'true'],
  ['SHOW_BOARD_TAB_EFFORT', 'false'],
  ['SHOW_COLUMN_TASK_COUNTS', 'true'],
  ['SHOW_COLUMN_EFFORT', 'false'],
]);

/** Exposed on public GET /api/settings so all roles respect the same chrome. */
export const KANBAN_FEATURE_PUBLIC_KEYS = Object.freeze(
  KANBAN_FEATURE_SETTING_DEFAULTS.map(([key]) => key)
);
