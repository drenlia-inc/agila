import { settings as settingsQueries, helpers } from './sqlManager/index.js';
import { getLicenseManager } from '../config/license.js';

/**
 * AI is available when:
 * - LICENSE_ENABLED=false (self-host): AI_ENABLED setting only
 * - Licensed: AI_TIER is not off/absent-as-off, AND AI_ENABLED is true for agent routes
 *
 * Plan gating (Basic): AI_TIER=off → features unavailable even if someone toggles AI_ENABLED.
 */

/**
 * @param {object} db
 * @returns {Promise<'off'|'limited'|'full'|string>}
 */
export async function getAiTier(db) {
  try {
    const licenseManager = getLicenseManager(db);
    if (licenseManager.isEnabled()) {
      const limits = await licenseManager.getLimits();
      const tier = limits?.AI_TIER;
      if (tier) return String(tier).toLowerCase();
      // Legacy: no AI_TIER — infer from SUPPORT_LEVEL
      const support = String(limits?.SUPPORT_LEVEL || '').toLowerCase();
      if (support === 'pro') return 'full';
      if (support === 'basic') return 'off';
    }
    const row = await helpers.getSetting(db, 'AI_TIER');
    if (row) return String(row).toLowerCase();
  } catch {
    /* fall through */
  }
  // Self-host / unset: allow (tier full) — AI_ENABLED still gates
  return 'full';
}

/**
 * Whether the plan allows AI at all (Admin tab visible, can enable BYO key).
 * @param {object} db
 */
export async function isAiAllowedByPlan(db) {
  const tier = await getAiTier(db);
  return tier !== 'off' && tier !== 'false' && tier !== 'none';
}

/**
 * Whether AI agent APIs may run (plan allows + AI_ENABLED).
 * @param {object} db
 */
export async function isAiEnabled(db) {
  try {
    if (!(await isAiAllowedByPlan(db))) {
      return false;
    }
    const row = await settingsQueries.getSettingByKey(db, 'AI_ENABLED');
    return row?.value === 'true';
  } catch {
    return false;
  }
}

/**
 * Present AI_ENABLED as off when the plan does not include AI, even if a leftover
 * settings row is still "true" from before plan gating existed.
 * @param {object} db
 * @param {Record<string, string>} settingsObj
 */
export async function applyEffectiveAiEnabledToSettings(db, settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return settingsObj;
  if (!(await isAiAllowedByPlan(db))) {
    settingsObj.AI_ENABLED = 'false';
  }
  return settingsObj;
}

/**
 * Factory that loads tenant DB and gates on plan + AI_ENABLED.
 * @param {Function} getRequestDatabase
 */
export function requireAiEnabledMiddleware(getRequestDatabase) {
  return async (req, res, next) => {
    try {
      const db = getRequestDatabase(req);
      if (!(await isAiAllowedByPlan(db))) {
        return res.status(403).json({ error: 'AI features are not available on this plan' });
      }
      if (!(await isAiEnabled(db))) {
        return res.status(403).json({ error: 'AI features are disabled for this instance' });
      }
      next();
    } catch (error) {
      console.error('AI enabled check failed:', error);
      return res.status(500).json({ error: 'Failed to verify AI settings' });
    }
  };
}
