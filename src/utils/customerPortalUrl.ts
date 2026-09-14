/** agila.dev i18next query param (`lng`). */
export function portalLngFromAppLanguage(language?: string | null): 'en' | 'fr' {
  return String(language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** Fixed marketing origin for self-hosted support CTA (not tenant WEBSITE_URL). */
export const AGILA_MARKETING_ORIGIN = 'https://agila.dev';

/**
 * Build a marketing-site URL that opens the customer-portal sign-in modal
 * (and optionally prefills email), then returns to the portal dashboard.
 */
export function buildCustomerPortalUrl(
  websiteUrl: string,
  email?: string | null,
  language?: string | null
): string {
  const base = String(websiteUrl || '').trim();
  if (!base) return '';

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    try {
      url = new URL(`https://${base}`);
    } catch {
      return base;
    }
  }

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
 * Always uses agila.dev — tenant WEBSITE_URL is the customer's own FQDN.
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
