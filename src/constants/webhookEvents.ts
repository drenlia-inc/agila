export const WEBHOOK_EVENT_KEYS = [
  'taskCreated',
  'taskChanged',
  'taskDeleted',
  'boardCreated',
  'boardRenamed',
  'boardDeleted',
] as const;

export type WebhookEventKey = (typeof WEBHOOK_EVENT_KEYS)[number];

const LEGACY_EMAIL_EVENT_KEYS = [
  'newTaskAssigned',
  'myTaskUpdated',
  'watchedTaskUpdated',
  'addedAsCollaborator',
  'addedAsWatcher',
  'collaboratingTaskUpdated',
  'commentAdded',
  'requesterTaskCreated',
  'requesterTaskUpdated',
] as const;

export function defaultWebhookEventTypes(): Record<string, boolean> {
  return Object.fromEntries(WEBHOOK_EVENT_KEYS.map((k) => [k, true]));
}

function truthy(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function falsyExplicit(v: unknown): boolean {
  return v === false || v === 'false' || v === 0 || v === '0';
}

export function normalizeWebhookEventTypes(raw: unknown): Record<string, boolean> {
  let parsed: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw as Record<string, unknown>;
  }
  const hasNew = WEBHOOK_EVENT_KEYS.some((k) => Object.prototype.hasOwnProperty.call(parsed, k));
  if (hasNew) {
    return Object.fromEntries(
      WEBHOOK_EVENT_KEYS.map((k) => [k, parsed[k] === undefined ? true : truthy(parsed[k])])
    );
  }
  const legacyKeysPresent = LEGACY_EMAIL_EVENT_KEYS.some((k) =>
    Object.prototype.hasOwnProperty.call(parsed, k)
  );
  if (!legacyKeysPresent) {
    return defaultWebhookEventTypes();
  }
  const anyOn = LEGACY_EMAIL_EVENT_KEYS.some((k) => truthy(parsed[k]));
  const anyOff = LEGACY_EMAIL_EVENT_KEYS.some((k) => falsyExplicit(parsed[k]));
  const enable = anyOn || !anyOff;
  return Object.fromEntries(WEBHOOK_EVENT_KEYS.map((k) => [k, enable]));
}
