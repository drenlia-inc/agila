import jwt from 'jsonwebtoken';
import notificationService from '../services/notificationService.js';
import { JWT_SECRET, JWT_EXPIRES_IN, primaryRole } from '../middleware/auth.js';
import { getTenantId } from '../middleware/tenantRouting.js';
import { auth as authQueries } from './sqlManager/index.js';
import { logMemberJoinedIfFirstTime } from '../services/activityLogger.js';
import { recordInteractiveLogin } from './recordInteractiveLogin.js';

/**
 * Finish SSO for an already-invited user (same rules as Google).
 */
export async function completeInvitedUserSso(db, req, {
  email,
  avatarUrl = '',
  provider,
}) {
  const user = await authQueries.getUserByEmail(db, email);
  if (!user) {
    return { ok: false, error: 'user_not_invited' };
  }

  if (!user.is_active) {
    if (user.auth_provider === 'local') {
      await authQueries.updateUserAuthProvider(db, user.id, provider, avatarUrl || null, true);
      await authQueries.deletePendingInvitations(db, user.id);
      user.is_active = true;
      user.auth_provider = provider;
      await logMemberJoinedIfFirstTime(user.id, {
        db,
        tenantId: getTenantId(req),
      });
      const memberInfo = await authQueries.getMemberByUserId(db, user.id);
      const tenantId = getTenantId(req);
      notificationService.publish('user-updated', {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          isActive: true,
          authProvider: provider,
          googleAvatarUrl: avatarUrl || null,
          createdAt: user.created_at,
          joined: user.created_at,
        },
        timestamp: new Date().toISOString(),
      }, tenantId).catch((err) => console.error('Failed to publish user-updated:', err));
      if (memberInfo) {
        notificationService.publish('member-updated', {
          memberId: memberInfo.id,
          member: {
            id: memberInfo.id,
            name: memberInfo.name,
            color: memberInfo.color,
            userId: user.id,
          },
          timestamp: new Date().toISOString(),
        }, tenantId).catch((err) => console.error('Failed to publish member-updated:', err));
      }
    } else {
      return { ok: false, error: 'account_deactivated' };
    }
  } else if (user.auth_provider !== provider) {
    try {
      await authQueries.updateUserAuthProvider(db, user.id, provider, avatarUrl || null, false);
    } catch (error) {
      console.error(`Failed to update auth_provider to ${provider}:`, error);
    }
  } else if (avatarUrl) {
    try {
      await authQueries.updateGoogleAvatarUrl(db, user.id, avatarUrl);
    } catch (error) {
      console.error('Failed to update SSO avatar:', error);
    }
  }

  const roles = await authQueries.getUserRoles(db, user.id);
  const userRoles = roles.map((r) => r.name);
  await authQueries.clearForceLogout(db, user.id);
  await recordInteractiveLogin(db, user.id, getTenantId(req));
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: primaryRole(userRoles),
      roles: userRoles,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return { ok: true, token };
}
