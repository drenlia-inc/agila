/**
 * Tell the admin portal that this instance changed so an open Inspect modal can rescan.
 */
import axios from 'axios';
import notificationService from '../services/notificationService.js';

const CHANNELS = [
  'settings-updated',
  'user-updated',
  'user-created',
  'user-deleted',
  'user-role-updated'
];

let debounceTimer = null;
let started = false;

function adminPortalBase() {
  return String(process.env.ADMIN_SERVICE_URL || '').trim().replace(/\/+$/, '');
}

function instanceToken() {
  return String(process.env.INSTANCE_TOKEN || '').trim();
}

async function flushNotify() {
  const base = adminPortalBase();
  const token = instanceToken();
  if (!base || !token) return;
  try {
    await axios.post(
      `${base}/api/instance-callback/tenant-changed`,
      { reason: 'inspect' },
      {
        timeout: 8000,
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true
      }
    );
  } catch {
    /* portal unreachable — Inspect still has a fallback poll */
  }
}

function scheduleNotify() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushNotify();
  }, 2000);
}

export function startAdminPortalInspectNotify() {
  if (started) return;
  if (!adminPortalBase() || !instanceToken()) return;
  started = true;
  for (const channel of CHANNELS) {
    notificationService.subscribeToAllTenants(channel, () => {
      scheduleNotify();
    });
  }
}
