import { getTenantDomain } from './tenantDomain.js';

const RESERVED_SUBDOMAINS = new Set(['auth', 'admin', 'www', 'api', 'mail']);

function isMultiTenantMode() {
  return process.env.MULTI_TENANT === 'true';
}

function allowedOAuthReturnHosts() {
  return new Set(
    String(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Hostnames unsuitable for browser OAuth return (proxy/upstream internals). */
export function isInternalOAuthHostname(hostname) {
  const host = String(hostname || '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
  }
  // Docker / k8s service names (no dot, not an IP)
  if (!host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}

function pickPublicRequestHost(req) {
  const candidates = [
    req.get('x-forwarded-host'),
    req.get('x-original-host'),
    req.get('host'),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const host = String(raw).split(',')[0].trim();
    const hostname = host.split(':')[0].trim().toLowerCase();
    if (isInternalOAuthHostname(hostname)) continue;
    if (isAuthHubHostname(hostname)) continue;
    return host;
  }
  return '';
}

export function getAuthHubPublicUrl() {
  const fromEnv = String(process.env.AUTH_HUB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  return `https://auth.${getTenantDomain()}`;
}

export function getAuthHubCallbackUrl() {
  return `${getAuthHubPublicUrl()}/api/auth/google/callback`;
}

export function getAuthHubHostname() {
  try {
    return new URL(getAuthHubPublicUrl()).hostname.toLowerCase();
  } catch {
    return `auth.${getTenantDomain()}`;
  }
}

export function isAuthHubHostname(hostname) {
  const host = String(hostname || '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();
  return Boolean(host) && host === getAuthHubHostname();
}

export function isReservedTenantSubdomain(label) {
  return RESERVED_SUBDOMAINS.has(String(label || '').trim().toLowerCase());
}

export function tenantPublicOrigin(tenantId) {
  const id = String(tenantId || '').trim().toLowerCase();
  if (!id || isReservedTenantSubdomain(id)) return '';
  return `https://${id}.${getTenantDomain()}`;
}

export function isGoogleSsoManaged(settings) {
  const mode = String(settings?.GOOGLE_SSO_MODE || '')
    .trim()
    .toLowerCase();
  if (mode === 'managed') return true;
  if (mode === 'byo' || mode === 'off') return false;
  return String(settings?.GOOGLE_SSO_MANAGED || '').toLowerCase() === 'true';
}

/** After hub callback on a single-tenant (Docker) app, send the browser back here. */
export function getAuthHubReturnOrigin() {
  return String(process.env.AUTH_HUB_RETURN_ORIGIN || '').trim().replace(/\/+$/, '');
}

/** Public origin for the incoming OAuth start request (behind nginx / ingress). */
export function requestPublicOrigin(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = pickPublicRequestHost(req);
  if (!host) return '';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/** Guard OAuth post-login redirects — never send users to arbitrary third-party sites. */
export function isAllowedOAuthReturnOrigin(origin) {
  const normalized = String(origin || '').trim().replace(/\/+$/, '');
  if (!normalized) return false;

  let url;
  try {
    url = new URL(normalized);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.pathname && url.pathname !== '/') return false;

  const host = url.hostname.toLowerCase();
  if (isInternalOAuthHostname(host)) return false;
  if (isAuthHubHostname(host)) return false;

  const allowed = allowedOAuthReturnHosts();
  if (allowed.has(host)) return true;

  if (isMultiTenantMode()) {
    const domain = getTenantDomain().toLowerCase();
    if (host === domain) return true;
    const suffix = `.${domain}`;
    if (host.endsWith(suffix)) {
      const subdomain = host.slice(0, -suffix.length).split('.').pop();
      if (subdomain && !isReservedTenantSubdomain(subdomain)) return true;
    }
  }

  return false;
}

/** Prefer the site that started Google sign-in; fall back to env for single-tenant hub apps. */
export function resolveOAuthReturnOrigin(req) {
  const fromRequest = requestPublicOrigin(req);
  if (isAllowedOAuthReturnOrigin(fromRequest)) {
    return fromRequest;
  }
  const fromEnv = getAuthHubReturnOrigin();
  if (isAllowedOAuthReturnOrigin(fromEnv)) {
    return fromEnv;
  }
  return '';
}

export function resolveHubCallbackReturnOrigin(payload) {
  const fromState = String(payload?.returnOrigin || '').trim().replace(/\/+$/, '');
  if (isAllowedOAuthReturnOrigin(fromState)) {
    return fromState;
  }
  const fromEnv = getAuthHubReturnOrigin();
  if (isAllowedOAuthReturnOrigin(fromEnv)) {
    return fromEnv;
  }
  return '';
}
