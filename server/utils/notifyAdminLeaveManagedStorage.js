import axios from 'axios';
import { resolveInstanceToken } from './instanceToken.js';
import { AGILA_ADMIN_PORTAL_URL } from '../constants/agilaPublicUrls.js';
import { settings as settingsQueries } from './sqlManager/index.js';

export async function notifyAdminLeaveManagedStorage(db) {
  const token = await resolveInstanceToken(db);
  if (!token) return;
  let base = String(process.env.ADMIN_SERVICE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    const row = await settingsQueries.getSettingByKey(db, 'ADMIN_PORTAL_URL');
    base = String(row?.value || AGILA_ADMIN_PORTAL_URL || '').trim().replace(/\/+$/, '');
  }
  if (!base) return;
  await axios.post(
    `${base}/api/instance-portal/storage/leave-managed`,
    {},
    {
      timeout: 15000,
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500
    }
  );
}
