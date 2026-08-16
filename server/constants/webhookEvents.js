export const WEBHOOK_EVENT_KEYS = [
  'taskCreated',
  'taskChanged',
  'taskDeleted',
  'boardCreated',
  'boardRenamed',
  'boardDeleted',
];

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
];

export function defaultWebhookEventTypes() {
  return Object.fromEntries(WEBHOOK_EVENT_KEYS.map((k) => [k, true]));
}

function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function falsyExplicit(v) {
  return v === false || v === 'false' || v === 0 || v === '0';
}

export function normalizeWebhookEventTypes(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultWebhookEventTypes();
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

export function webhookEventEnabled(eventTypes, key) {
  const n = normalizeWebhookEventTypes(eventTypes);
  return n[key] === true;
}

export function webhookEventFromTaskAction(action) {
  if (action === 'create_task' || action === 'copy_task' || action === 'restore_task') {
    return 'taskCreated';
  }
  if (action === 'delete_task') return 'taskDeleted';
  return 'taskChanged';
}
