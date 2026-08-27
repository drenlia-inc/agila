import { getLicenseManager } from '../config/license.js';

function isUnlimited(value) {
  if (value === undefined || value === null || value === '') return true;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isNaN(n) || n === -1;
}

/**
 * Max outbound webhooks the tenant may create (Admin → Webhooks).
 * Reads WEBHOOK_LIMIT from license_settings (via LicenseManager); unset or -1 = unlimited.
 * Enforced when LICENSE_ENABLED=true — same gate as USER_LIMIT, BOARD_LIMIT, etc.
 * MULTI_TENANT only affects where limits are seeded (portal vs compose env), not enforcement.
 */
export async function getWebhookCreateLimit(db) {
  const licenseManager = getLicenseManager(db);
  if (!licenseManager.isEnabled()) {
    return -1;
  }
  const limits = await licenseManager.getLimits();
  if (!limits || isUnlimited(limits.WEBHOOK_LIMIT)) {
    return -1;
  }
  const n = parseInt(String(limits.WEBHOOK_LIMIT), 10);
  return Number.isNaN(n) || n < 0 ? -1 : n;
}
