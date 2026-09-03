import { getRequestDatabase } from './tenantRouting.js';
import { getTranslator } from '../utils/i18n.js';
import { boardParticipants as participantQueries, tasks as taskQueries } from '../utils/sqlManager/index.js';

export function userHasAdminRole(user) {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.includes('admin') || user.role === 'admin') return true;
  return false;
}

export async function userCanAccessBoard(db, user, boardId) {
  if (!db || !user?.id || !boardId) return false;
  if (userHasAdminRole(user)) return true;
  return participantQueries.isParticipant(db, boardId, user.id);
}

export async function sendBoardAccessDenied(res, db) {
  const t = await getTranslator(db);
  return res.status(403).json({
    error: t('errors.boardAccessDenied'),
    code: 'BOARD_ACCESS_DENIED',
  });
}

export async function assertBoardAccess(req, res, boardId) {
  const db = getRequestDatabase(req);
  const allowed = await userCanAccessBoard(db, req.user, boardId);
  if (allowed) return true;
  await sendBoardAccessDenied(res, db);
  return false;
}

export async function assertTaskBoardAccess(req, res, taskId) {
  const db = getRequestDatabase(req);
  if (!taskId) {
    await sendBoardAccessDenied(res, db);
    return false;
  }
  if (userHasAdminRole(req.user)) return true;
  const boardId = await taskQueries.getTaskBoardId(db, taskId);
  if (!boardId) {
    const t = await getTranslator(db);
    res.status(404).json({ error: t('errors.taskNotFound') });
    return false;
  }
  return assertBoardAccess(req, res, boardId);
}
