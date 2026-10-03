import { getLicenseManager } from '../config/license.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';

/**
 * Agila API (ek_ tokens and /api/v1) is available when:
 * - DEMO_ENABLED is not set (demo is always off, even though licensing is off)
 * - LICENSE_ENABLED is not true (self-hosted): allowed
 * - Licensed: API_TIER is on, or a missing key is inferred from the hosted plan
 *
 * The web app's session on /api is not gated.
 */

const OFF_TIERS = new Set(['off', 'false', 'none', '0']);

export function apiTierIsOn(tier) {
  const value = String(tier || '').trim().toLowerCase();
  if (!value) return false;
  return !OFF_TIERS.has(value);
}

/**
 * Hosted plan when license_settings has no API_TIER yet.
 * Basic / essential support is off. Pro / priority is on.
 * @param {object|null} limits
 * @returns {'off'|'full'}
 */
export function inferApiTier(limits) {
  const named = String(limits?.PLAN_NAME || '').trim().toLowerCase();
  if (named === 'pro') return 'full';
  if (named === 'basic') return 'off';
  const support = String(limits?.SUPPORT_LEVEL || '').trim().toLowerCase();
  if (support === 'pro' || support === 'priority') return 'full';
  if (support === 'basic' || support === 'essential') return 'off';
  return 'off';
}

/**
 * @param {object} db
 * @returns {Promise<boolean>}
 */
export async function isApiAllowedByPlan(db) {
  if (process.env.DEMO_ENABLED === 'true') return false;
  try {
    const licenseManager = getLicenseManager(db);
    if (!licenseManager.isEnabled()) return true;
    const limits = await licenseManager.getLimits();
    const raw = limits?.API_TIER;
    const tier = raw !== undefined && raw !== null && String(raw).trim() !== ''
      ? raw
      : inferApiTier(limits);
    return apiTierIsOn(tier);
  } catch (error) {
    console.error('API plan check failed:', error);
    return false;
  }
}

export function apiPlanDenied(res) {
  return res.status(403).json({
    error: 'Agila API is not available on this plan',
    code: 'API_NOT_IN_PLAN'
  });
}

/**
 * Reject every /api/v1 call when the plan does not include the API.
 * Browser traffic stays on /api.
 */
export function requireApiPlanMiddleware(req, res, next) {
  const db = getRequestDatabase(req);
  if (!db) {
    return res.status(500).json({ error: 'Failed to verify API plan' });
  }
  isApiAllowedByPlan(db)
    .then((allowed) => {
      if (!allowed) return apiPlanDenied(res);
      return next();
    })
    .catch((error) => {
      console.error('API plan check failed:', error);
      return res.status(500).json({ error: 'Failed to verify API plan' });
    });
}
