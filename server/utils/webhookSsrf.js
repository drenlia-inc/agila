import { lookup } from 'dns/promises';
import net from 'net';

function ipv4ToInt(ip) {
  const p = ip.split('.').map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function isBlockedIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n == null) return true;
  if (n === 0) return true;
  if ((n >>> 24) === 127) return true;
  if ((n >>> 24) === 10) return true;
  if ((n >>> 24) === 0) return true;
  if ((n >>> 16) === ((192 << 8) | 168)) return true;
  if ((n >>> 16) === ((169 << 8) | 254)) return true;
  const second = (n >>> 16) & 0xff;
  if ((n >>> 24) === 172 && second >= 16 && second <= 31) return true;
  return false;
}

function isBlockedIp(address, family) {
  if (family === 4 || net.isIPv4(address)) return isBlockedIpv4(address);
  const a = String(address).toLowerCase();
  if (a === '::1' || a === '::') return true;
  if (a.startsWith('fe80:')) return true;
  if (a.startsWith('fc') || a.startsWith('fd')) return true;
  if (a.startsWith('::ffff:')) {
    const v4 = a.slice('::ffff:'.length);
    return isBlockedIpv4(v4);
  }
  return false;
}

export function sanitizeWebhookUrlInput(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\s\u0000-\u001F\u007F]+/g, '');
}

/** True when a value is a UI mask (bullets), not a real webhook URL. */
export function looksLikeMaskedWebhookUrl(value) {
  const raw = String(value || '');
  if (!raw.trim()) return true;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (/%E2%80%A2/i.test(raw)) return true;
  if (/[•\u2022\u25CF]/.test(raw) || /[•\u2022\u25CF]/.test(decoded)) return true;
  if (/\/\u2022+|\/•+/.test(decoded)) return true;
  return false;
}

export async function assertSafeHttpsUrl(urlString) {
  let url;
  try {
    url = new URL(String(urlString || ''));
  } catch {
    throw new Error('Invalid webhook URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }
  const hostname = url.hostname;
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Webhook URL host is not allowed');
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname, net.isIPv6(hostname) ? 6 : 4)) {
      throw new Error('Webhook URL host is not allowed');
    }
    return url;
  }
  const resolved = await lookup(hostname, { all: true });
  if (!resolved?.length) {
    throw new Error('Webhook URL host could not be resolved');
  }
  for (const rec of resolved) {
    if (isBlockedIp(rec.address, rec.family)) {
      throw new Error('Webhook URL host is not allowed');
    }
  }
  return url;
}

export async function postJsonHttps(urlString, body, { headers = {}, timeoutMs = 5000 } = {}) {
  const url = await assertSafeHttpsUrl(urlString);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: ac.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`Webhook POST HTTP ${res.status} ${url.hostname}`, text.slice(0, 500));
      throw new Error(`HTTP ${res.status}`);
    }
    return { status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

export async function postAllowlistedJson(urlString, body, { headers = {}, timeoutMs = 5000 } = {}) {
  const url = new URL(String(urlString || ''));
  if (url.protocol !== 'https:') {
    throw new Error('URL must use HTTPS');
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'api.telegram.org' ||
    host === 'graph.facebook.com' ||
    host.endsWith('.facebook.com') ||
    host.endsWith('.telegram.org');
  if (!allowed) {
    throw new Error('Host is not allowlisted');
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: ac.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`Webhook POST HTTP ${res.status} ${url.hostname}`, text.slice(0, 500));
      throw new Error(`HTTP ${res.status}`);
    }
    return { status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}
