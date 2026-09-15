/**
 * Instance account ownership (OWNER setting) vs setup ownership (Configuration guide).
 *
 * - Multi-tenant SaaS: OWNER is set by admin-portal; setup owner === account owner.
 * - Self-host: any admin is a setup owner; OWNER is the billing/portal contact
 *   (seeded to bootstrap admin, transferred when that account is deleted).
 */

import { wrapQuery } from './queryLogger.js';
import { isMultiTenant } from '../middleware/tenantRouting.js';

export const BOOTSTRAP_ADMIN_EMAIL = 'admin@kanban.local';

const SYSTEM_EMAILS = new Set(['system@local', 'agent@local']);

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Stock / reserved addresses that cannot receive a real SMTP test
 * (self-host bootstrap admin@kanban.local, RFC example domains, *.local).
 */
export function isUndeliverableTestRecipient(email) {
  const v = normalizeEmail(email);
  if (!v) return true;
  const at = v.lastIndexOf('@');
  if (at < 1 || at === v.length - 1) return true;
  const domain = v.slice(at + 1);
  if (v === BOOTSTRAP_ADMIN_EMAIL || v === 'admin@example.com') return true;
  if (domain === 'local' || domain === 'localhost' || domain.endsWith('.local')) return true;
  if (domain === 'example.com' || domain === 'example.org' || domain === 'example.net') {
    return true;
  }
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function getOwnerEmail(db) {
  const row = await wrapQuery(
    db.prepare('SELECT value FROM settings WHERE key = ?'),
    'SELECT'
  ).get('OWNER');
  const v = row?.value ? String(row.value).trim() : '';
  return v || null;
}

export async function setOwnerEmail(db, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await wrapQuery(
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP'
    ),
    'INSERT'
  ).run('OWNER', normalized);
}

/** True when this instance is linked to the admin / customer portal. */
export async function isPortalLinked(db) {
  if (isMultiTenant()) return true;
  const instanceId = await wrapQuery(
    db.prepare('SELECT value FROM settings WHERE key = ?'),
    'SELECT'
  ).get('INSTANCE_ID');
  return Boolean(instanceId?.value && String(instanceId.value).trim());
}

/**
 * Count human admin accounts, optionally excluding a user id (e.g. about to delete).
 */
export async function countHumanAdmins(db, { excludeUserId = null } = {}) {
  const rows = await wrapQuery(
    db.prepare(`
      SELECT u.id, u.email
      FROM users u
      INNER JOIN user_roles ur ON ur.user_id = u.id
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE r.name = 'admin'
    `),
    'SELECT'
  ).all();

  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return list.filter((u) => {
    if (excludeUserId && u.id === excludeUserId) return false;
    const email = normalizeEmail(u.email);
    if (SYSTEM_EMAILS.has(email)) return false;
    return true;
  }).length;
}

export async function userHasAdminRole(db, userId) {
  const row = await wrapQuery(
    db.prepare(`
      SELECT 1 AS ok
      FROM user_roles ur
      INNER JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.name = 'admin'
      LIMIT 1
    `),
    'SELECT'
  ).get(userId);
  return Boolean(row?.ok);
}

/**
 * Before deleting a user: block last admin; transfer OWNER if deleting bootstrap or account owner.
 * @returns {{ transferredTo: string|null }}
 */
export async function prepareUserDeletionOwnership(db, {
  deletedUserId,
  deletedUserEmail,
  successorEmail,
}) {
  const deletedEmail = normalizeEmail(deletedUserEmail);
  const successor = normalizeEmail(successorEmail);
  const wasAdmin = await userHasAdminRole(db, deletedUserId);

  if (wasAdmin) {
    const remaining = await countHumanAdmins(db, { excludeUserId: deletedUserId });
    if (remaining < 1) {
      const err = new Error(
        'Cannot delete the last administrator. Promote another user to admin first.'
      );
      err.code = 'last_admin';
      err.status = 400;
      throw err;
    }
  }

  const currentOwner = normalizeEmail(await getOwnerEmail(db));
  const deletingBootstrap = deletedEmail === BOOTSTRAP_ADMIN_EMAIL;
  const deletingAccountOwner = Boolean(currentOwner) && currentOwner === deletedEmail;

  let transferredTo = null;
  if (successor && (deletingBootstrap || deletingAccountOwner)) {
    await setOwnerEmail(db, successor);
    transferredTo = successor;
    console.log(
      `✅ OWNER set to ${successor} (deleted ${deletedEmail || deletedUserId})`
    );
  }

  return { transferredTo };
}

/**
 * Before demoting an admin: block last admin or demoting the account OWNER.
 */
export async function prepareAdminDemotion(db, { userId, userEmail }) {
  const remaining = await countHumanAdmins(db, { excludeUserId: userId });
  if (remaining < 1) {
    const err = new Error(
      'Cannot demote the last administrator. Promote another user to admin first.'
    );
    err.code = 'last_admin';
    err.status = 400;
    throw err;
  }

  const owner = normalizeEmail(await getOwnerEmail(db));
  const email = normalizeEmail(userEmail);
  if (owner && owner === email) {
    const err = new Error(
      'Cannot demote the account owner. Another admin should become OWNER first (e.g. delete the bootstrap admin while logged in as the successor).'
    );
    err.code = 'owner_demotion';
    err.status = 400;
    throw err;
  }
}
