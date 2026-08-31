/** Live SMTP fields hidden from tenant admins while mail is platform-managed. */
export const MAIL_MANAGED_HIDDEN_KEYS = Object.freeze([
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'SMTP_SECURE',
]);

/** Platform shadow copy — never exposed on tenant admin GET. */
export const PLATFORM_SMTP_KEYS = Object.freeze([
  'PLATFORM_SMTP_HOST',
  'PLATFORM_SMTP_PORT',
  'PLATFORM_SMTP_USERNAME',
  'PLATFORM_SMTP_PASSWORD',
  'PLATFORM_SMTP_FROM_EMAIL',
  'PLATFORM_SMTP_FROM_NAME',
  'PLATFORM_SMTP_SECURE',
]);

export const MAIL_ADMIN_INTERNAL_KEYS = Object.freeze([...PLATFORM_SMTP_KEYS]);

export const SMTP_MODE_KEY = 'SMTP_MODE';
export const SMTP_MANAGED_ELIGIBLE_KEY = 'SMTP_MANAGED_ELIGIBLE';

/** `off` is not a stored mode — use MAIL_ENABLED and empty SMTP_MODE when unset. */
export const SMTP_MODES = Object.freeze(['managed', 'byo']);

export function isDemoMailLocked() {
  return process.env.DEMO_ENABLED === 'true';
}
