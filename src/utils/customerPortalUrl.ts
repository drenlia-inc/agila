/**
 * Build a marketing-site URL that opens the customer-portal sign-in modal
 * (and optionally prefills email), then returns to the portal dashboard.
 */
export function buildCustomerPortalUrl(
  websiteUrl: string,
  email?: string | null
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

  const trimmed = String(email || '')
    .trim()
    .toLowerCase();
  if (trimmed && trimmed.includes('@')) {
    url.searchParams.set('email', trimmed);
  }

  return url.toString();
}
