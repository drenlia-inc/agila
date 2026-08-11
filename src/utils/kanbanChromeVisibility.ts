import { adminSettingIsEnabled } from '../components/admin/AdminToggle';

type SettingsMap = { [key: string]: string | undefined } | undefined;

/** Board tab task count / WIP meter (default on). */
export function showBoardTabTaskCounts(settings: SettingsMap): boolean {
  return adminSettingIsEnabled(settings?.SHOW_BOARD_TAB_TASK_COUNTS, true);
}

/** Board tab effort pill (default off). */
export function showBoardTabEffort(settings: SettingsMap): boolean {
  return adminSettingIsEnabled(settings?.SHOW_BOARD_TAB_EFFORT, false);
}

/** Column header task count / WIP meter (default on). */
export function showColumnTaskCounts(settings: SettingsMap): boolean {
  return adminSettingIsEnabled(settings?.SHOW_COLUMN_TASK_COUNTS, true);
}

/** Column header effort pill (default off). */
export function showColumnEffort(settings: SettingsMap): boolean {
  return adminSettingIsEnabled(settings?.SHOW_COLUMN_EFFORT, false);
}
