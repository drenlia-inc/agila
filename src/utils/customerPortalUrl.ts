/** Fixed marketing / customer-portal origin (not TENANT_DOMAIN, not the app FQDN). */
export const AGILA_MARKETING_ORIGIN = 'https://agila.dev';

/** Fixed admin portal origin for Connect + billing proxy. */
export const AGILA_ADMIN_PORTAL_URL = 'https://admin.agila.dev';

/** agila.dev i18next query param (`lng`). */
export function portalLngFromAppLanguage(language?: string | null): 'en' | 'fr' {
  return String(language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/**
 * Customer-portal sign-in on agila.dev (subscription management).
 * Always production agila.dev — independent of tenant WEBSITE_URL / app FQDN.
 */
export function buildCustomerPortalUrl(
  email?: string | null,
  language?: string | null
): string {
  const url = new URL(AGILA_MARKETING_ORIGIN);
  url.searchParams.set('login', '1');
  url.searchParams.set('returnTo', '/portal/dashboard');
  url.searchParams.set('lng', portalLngFromAppLanguage(language));

  const trimmed = String(email || '')
    .trim()
    .toLowerCase();
  if (trimmed && trimmed.includes('@')) {
    url.searchParams.set('email', trimmed);
  }

  return url.toString();
}

/**
 * Self-hosted support interest form on the marketing site.
 * Always production agila.dev.
 */
export function buildSelfHostSupportUrl(
  language?: string | null,
  email?: string | null
): string {
  const url = new URL('/getsupport', AGILA_MARKETING_ORIGIN);
  url.searchParams.set('lng', portalLngFromAppLanguage(language));

  const trimmed = String(email || '')
    .trim()
    .toLowerCase();
  if (trimmed && trimmed.includes('@')) {
    url.searchParams.set('email', trimmed);
  }

  return url.toString();
}
