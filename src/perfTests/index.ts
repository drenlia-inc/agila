import { isPerfTestsUserSettingEnabled } from './preference';

export {
  PERF_TESTS_USER_SETTING_KEY,
  isPerfTestsUserSettingEnabled,
  notifyPerfTestsPreference,
  subscribePerfTestsPreference,
  setPerfTestsUserPreference,
} from './preference';

/** True when the Performance Test Overlay should mount (this admin’s preference + admin role). */
export function shouldShowPerfTests(
  userPerfTestsEnabled: boolean | string | null | undefined,
  user: { roles?: string[] } | null | undefined
): boolean {
  if (!isPerfTestsUserSettingEnabled(userPerfTestsEnabled)) return false;
  if (!user?.roles?.includes('admin')) return false;
  return true;
}

export { memberDisplayName } from './lorem';
