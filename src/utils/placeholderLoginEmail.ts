/** Bootstrap self-host login; not a deliverable mailbox. */
export const BOOTSTRAP_ADMIN_EMAIL = 'admin@kanban.local';

/**
 * True when a test / notification should not be sent to this address
 * (stock admin, reserved *.local, RFC example domains).
 */
export function isUndeliverableTestRecipient(email: string | null | undefined): boolean {
  const v = String(email || '').trim().toLowerCase();
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
