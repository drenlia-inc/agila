/**
 * Tell the admin portal that this instance changed so an open Inspect modal can rescan.
 */
import axios from 'axios';
import notificationService from '../services/notificationService.js';
import { resolveInstanceToken } from './instanceToken.js';

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

async function flushNotify() {
  const base = adminPortalBase();
  const token = await resolveInstanceToken(null);
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
  // Env token only at boot; settings-based tokens still auth inbound admin-portal calls
  if (!adminPortalBase() || !String(process.env.INSTANCE_TOKEN || '').trim()) return;
  started = true;
  for (const channel of CHANNELS) {
    notificationService.subscribeToAllTenants(channel, () => {
      scheduleNotify();
    });
  }
}
