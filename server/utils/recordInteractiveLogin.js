import notificationService from '../services/notificationService.js';
import { auth as authQueries } from './sqlManager/index.js';

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Record last_login_at and notify Admin Users (and inspect) in realtime.
 */
export async function recordInteractiveLogin(db, userId, tenantId) {
  const lastLoginAt = await authQueries.recordLastLogin(db, userId);
  const iso = toIso(lastLoginAt);
  if (!iso || !userId) return iso;
  notificationService
    .publish(
      'user-updated',
      {
        user: { id: userId, lastLoginAt: iso },
        timestamp: iso,
      },
      tenantId
    )
    .catch((err) => console.error('Failed to publish last-login update:', err));
  return iso;
}
