import { wrapQuery } from '../queryLogger.js';

const USER_SELECT = `
      u.id,
      u.email,
      u.first_name AS "firstName",
      u.last_name AS "lastName",
      u.is_active AS "isActive",
      u.avatar_path AS "avatarPath",
      u.google_avatar_url AS "googleAvatarUrl",
      m.name AS "displayName",
      m.id AS "memberId",
      m.color,
      (
        SELECT COALESCE(array_agg(r.name), ARRAY[]::text[])
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
      ) AS roles
`;

function mapUserRow(row) {
  const roles = Array.isArray(row.roles)
    ? row.roles.filter(Boolean)
    : typeof row.roles === 'string'
      ? row.roles.split(',').filter(Boolean)
      : [];
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    isActive: row.isActive,
    displayName: row.displayName,
    memberId: row.memberId,
    color: row.color,
    avatarUrl: row.avatarPath || null,
    googleAvatarUrl: row.googleAvatarUrl || null,
    roles,
    isViewer: roles.includes('viewer') && !roles.includes('admin') && !roles.includes('user'),
  };
}

export async function isParticipant(db, boardId, userId) {
  const row = await wrapQuery(
    db.prepare(
      'SELECT 1 AS ok FROM board_participants WHERE board_id = $1 AND user_id = $2 LIMIT 1'
    ),
    'SELECT'
  ).get(boardId, userId);
  return Boolean(row);
}

export async function countParticipants(db, boardId) {
  const row = await wrapQuery(
    db.prepare('SELECT COUNT(*)::int AS count FROM board_participants WHERE board_id = $1'),
    'SELECT'
  ).get(boardId);
  return Number(row?.count || 0);
}

export async function listParticipantUserIds(db, boardId) {
  const rows = await wrapQuery(
    db.prepare('SELECT user_id FROM board_participants WHERE board_id = $1'),
    'SELECT'
  ).all(boardId);
  return (rows || []).map((r) => r.user_id);
}

export async function listParticipants(db, boardId) {
  const query = `
    SELECT ${USER_SELECT}
    FROM board_participants bp
    JOIN users u ON u.id = bp.user_id
    LEFT JOIN members m ON m.user_id = u.id
    WHERE bp.board_id = $1
    ORDER BY COALESCE(NULLIF(m.name, ''), u.first_name, u.email)
  `;
  const rows = await wrapQuery(db.prepare(query), 'SELECT').all(boardId);
  return (rows || []).map(mapUserRow);
}

export async function listCandidateUsers(db) {
  const query = `
    SELECT ${USER_SELECT}
    FROM users u
    LEFT JOIN members m ON m.user_id = u.id
    WHERE u.is_active = true
      AND u.email NOT IN ('agent@local', 'system@local')
    ORDER BY COALESCE(NULLIF(m.name, ''), u.first_name, u.email)
  `;
  const rows = await wrapQuery(db.prepare(query), 'SELECT').all();
  return (rows || []).map(mapUserRow);
}

export async function replaceParticipants(db, boardId, userIds) {
  const unique = [...new Set((userIds || []).map((id) => String(id)).filter(Boolean))];
  await wrapQuery(
    db.prepare('DELETE FROM board_participants WHERE board_id = $1'),
    'DELETE'
  ).run(boardId);
  if (unique.length === 0) return [];
  for (const userId of unique) {
    await wrapQuery(
      db.prepare(
        'INSERT INTO board_participants (board_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
      ),
      'INSERT'
    ).run(boardId, userId);
  }
  return listParticipants(db, boardId);
}

/** Add every active human user to a board without dropping existing members. */
export async function addActiveUsersAsParticipants(db, boardId) {
  const rows = await wrapQuery(
    db.prepare(`
      SELECT id FROM users
      WHERE is_active = true
        AND COALESCE(email, '') NOT IN ('agent@local', 'system@local')
    `),
    'SELECT'
  ).all();
  const userIds = (rows || []).map((row) => row.id).filter(Boolean);
  if (userIds.length === 0) return [];
  const existing = await listParticipantUserIds(db, boardId);
  return replaceParticipants(db, boardId, [...existing, ...userIds]);
}

export async function getAccessibleBoardIds(db, userId) {
  const rows = await wrapQuery(
    db.prepare('SELECT board_id FROM board_participants WHERE user_id = $1'),
    'SELECT'
  ).all(userId);
  return (rows || []).map((r) => r.board_id);
}
