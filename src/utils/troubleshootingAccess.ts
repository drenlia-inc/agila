/**
 * Admin → App Settings → Troubleshooting visibility.
 * On MULTI_TENANT / DEMO hosts the tab is hidden until unlocked for the browser tab.
 */

export const TROUBLESHOOTING_UNLOCK_KEY = 'adminTroubleshootingUnlocked';

/** Type this in ALL CAPS while Admin → App Settings is focused (not in an input). */
export const TROUBLESHOOTING_UNLOCK_SEQUENCE = 'TROUBLE';

/** Sent on system-info when the session is unlocked (gated deployments). */
export const TROUBLESHOOTING_REQUEST_HEADER = 'X-Agila-Troubleshooting';

type SettingsLike = { [key: string]: string | undefined } | null | undefined;

function flagTrue(envVal: string | undefined, settingVal: string | undefined): boolean {
  return envVal === 'true' || settingVal === 'true';
}

export function isTroubleshootingGatedDeployment(siteSettings?: SettingsLike): boolean {
  return (
    flagTrue(process.env.MULTI_TENANT, siteSettings?.DEPLOY_MULTI_TENANT) ||
    flagTrue(process.env.DEMO_ENABLED, siteSettings?.DEPLOY_DEMO_ENABLED)
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
export function isTroubleshootingVisible(siteSettings?: SettingsLike): boolean {
  if (!isTroubleshootingGatedDeployment(siteSettings)) return true;
  return readTroubleshootingUnlocked();
}

/**
 * Host/pod metrics in the header: always on single-tenant (non-demo);
 * on MULTI_TENANT / DEMO only after TROUBLE unlock.
 * Until public settings include DEPLOY_* flags, stay hidden so k8s clients
 * built without MULTI_TENANT do not poll /admin/system-info (404).
 */
export function isSystemPanelAvailable(siteSettings?: SettingsLike): boolean {
  const deployKnown =
    siteSettings?.DEPLOY_MULTI_TENANT !== undefined ||
    siteSettings?.DEPLOY_DEMO_ENABLED !== undefined;
  if (
    !deployKnown &&
    process.env.MULTI_TENANT !== 'true' &&
    process.env.DEMO_ENABLED !== 'true'
  ) {
    return false;
  }
  return isTroubleshootingVisible(siteSettings);
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
