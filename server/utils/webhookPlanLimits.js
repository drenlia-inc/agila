import { getLicenseManager } from '../config/license.js';

/**
 * Max webhooks the tenant may create.
 * - Self-hosted / licensing off / single-tenant: unlimited (-1)
 * - Multi-tenant SaaS Basic: 1
 * - Pro (and other hosted plans): unlimited (-1)
 */
export async function getWebhookCreateLimit(db) {
  const licenseManager = getLicenseManager(db);
  if (!licenseManager.isEnabled() || process.env.MULTI_TENANT !== 'true') {
    return -1;
  }
  const limits = await licenseManager.getLimits();
  if (!limits) return -1;
  const plan = String(limits.SUPPORT_LEVEL || '').toLowerCase();
  if (plan === 'basic') return 1;
  return -1;
}
