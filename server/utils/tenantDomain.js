/**
 * Shared tenant base domain for multi-tenant host routing only
 * (`{tenantId}.{TENANT_DOMAIN}`). Override with TENANT_DOMAIN.
 *
 * Not used for Customer Portal (https://agila.dev) or Admin Portal
 * (https://admin.agila.dev) — see server/constants/agilaPublicUrls.js.
 */

export const DEFAULT_TENANT_DOMAIN = 'agila.dev';

export function getTenantDomain() {
  const fromEnv = String(process.env.TENANT_DOMAIN || '').trim();
  return fromEnv || DEFAULT_TENANT_DOMAIN;
}

/** Defaults for new licensed-tenant managed SMTP seeds (never hardcode a legacy domain). */
export function getManagedSmtpSeedDefaults() {
  const domain = getTenantDomain();
  return {
    host: String(process.env.MANAGED_SMTP_HOST || '').trim() || `smtp.${domain}`,
    username: String(process.env.MANAGED_SMTP_USERNAME || '').trim() || `noreply@${domain}`,
    fromEmail: String(process.env.MANAGED_SMTP_FROM_EMAIL || '').trim() || `noreply@${domain}`,
    fromName: String(process.env.MANAGED_SMTP_FROM_NAME || '').trim() || 'Agila',
  };
}
