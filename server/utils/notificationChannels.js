import { wrapQuery } from './queryLogger.js';

export const TASK_NOTIFICATION_CHANNEL_MODES = ['email', 'webhooks', 'both'];

export function normalizeTaskNotificationChannels(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'webhooks' || v === 'webhook') return 'webhooks';
  if (v === 'both') return 'both';
  return 'email';
}

export function emailsChannelEnabled(mode) {
  return mode === 'email' || mode === 'both';
}

export function webhooksChannelEnabled(mode) {
  return mode === 'webhooks' || mode === 'both';
}

export async function getTaskNotificationChannels(db) {
  try {
    const row = await wrapQuery(
      db.prepare('SELECT value FROM settings WHERE key = ?'),
      'SELECT'
    ).get('TASK_NOTIFICATION_CHANNELS');
    return normalizeTaskNotificationChannels(row?.value);
  } catch {
    return 'email';
  }
}
