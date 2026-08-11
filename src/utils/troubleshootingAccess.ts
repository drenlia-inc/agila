/**
 * Admin → App Settings → Troubleshooting visibility.
 * On MULTI_TENANT / DEMO hosts the tab is hidden until unlocked for the browser tab.
 */

export const TROUBLESHOOTING_UNLOCK_KEY = 'adminTroubleshootingUnlocked';

/** Type this in ALL CAPS while Admin → App Settings is focused (not in an input). */
export const TROUBLESHOOTING_UNLOCK_SEQUENCE = 'TROUBLE';

export function isTroubleshootingGatedDeployment(): boolean {
  return (
    process.env.MULTI_TENANT === 'true' || process.env.DEMO_ENABLED === 'true'
  );
}

export function readTroubleshootingUnlocked(): boolean {
  try {
    return sessionStorage.getItem(TROUBLESHOOTING_UNLOCK_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Whether the Troubleshooting Admin tab (and matching Help section) should show. */
export function isTroubleshootingVisible(): boolean {
  if (!isTroubleshootingGatedDeployment()) return true;
  return readTroubleshootingUnlocked();
}

/** Same-tab listeners (sessionStorage does not fire `storage` in the writing tab). */
export const TROUBLESHOOTING_VISIBILITY_EVENT = 'agila:troubleshooting-visibility';

export function notifyTroubleshootingVisibilityChanged(): void {
  try {
    window.dispatchEvent(new Event(TROUBLESHOOTING_VISIBILITY_EVENT));
  } catch {
    /* ignore */
  }
}
