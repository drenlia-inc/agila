/**
 * Fixed public Agila origins for Customer Portal + Admin Portal.
 *
 * These are not derived from TENANT_DOMAIN (that env is only for multi-tenant
 * hostname routing: `{tenantId}.{TENANT_DOMAIN}`). Self-hosted installs on any
 * FQDN (e.g. agila.prod.ca), SaaS, and local Docker all talk to production
 * agila.dev / admin.agila.dev.
 */

export const AGILA_MARKETING_ORIGIN = 'https://agila.dev';
export const AGILA_ADMIN_PORTAL_URL = 'https://admin.agila.dev';
