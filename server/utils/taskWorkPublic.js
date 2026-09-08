/**
 * Client-safe views of task_work maps.
 * Secrets used by the runner/dispatcher must never leave user-facing HTTP/WS.
 */

const REDACTED_KEYS = new Set([
  'callback_token',
  'runner_job_id',
  'automation_pending_plan',
  'automation_plan_hash',
  'automation_apply_hash',
]);

/**
 * Keys users must never write (A-1). Agent/runner API uses a narrower forbid list.
 */
export const FORBIDDEN_CLIENT_WORK_WRITE_KEYS = new Set([
  'callback_token',
  'runner_job_id',
  'agent_owner_user_id',
  'automation_pending_plan',
  'automation_plan_hash',
  'automation_apply_hash',
  'awaiting_apply',
  'log',
  'pr_url',
  'agent_branch',
  'progress',
]);

/** Keys even the agent/runner HTTP API must not overwrite (dispatcher-owned / identity). */
export const FORBIDDEN_AGENT_WORK_WRITE_KEYS = new Set([
  'callback_token',
  'runner_job_id',
  'agent_owner_user_id',
]);

/** @deprecated use FORBIDDEN_CLIENT_WORK_WRITE_KEYS */
export const FORBIDDEN_WORK_WRITE_KEYS = FORBIDDEN_CLIENT_WORK_WRITE_KEYS;

/**
 * @param {Record<string, unknown>|null|undefined} work
 * @returns {Record<string, unknown>}
 */
export function redactWorkMapForClient(work) {
  if (!work || typeof work !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(work)) {
    if (REDACTED_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Strip forbidden keys from a free-form entries object.
 * @param {Record<string, unknown>|null|undefined} entries
 * @param {Iterable<string>} [forbidden]
 * @returns {Record<string, unknown>}
 */
export function sanitizeWorkEntries(entries, forbidden = FORBIDDEN_CLIENT_WORK_WRITE_KEYS) {
  if (!entries || typeof entries !== 'object') return {};
  const blocked = forbidden instanceof Set ? forbidden : new Set(forbidden);
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    if (blocked.has(key)) continue;
    out[key] = value;
  }
  return out;
}
