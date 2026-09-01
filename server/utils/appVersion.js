import fs from 'fs';
import * as settingsQueries from './sqlManager/settings.js';

// Helper function to get app version (from version.json or ENV or database)
export const getAppVersion = async (db) => {
  // Try version.json first (build-time, works in K8s)
  try {
    const versionPath = new URL('../version.json', import.meta.url);
    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    return versionData.version;
  } catch (error) {
    // Fallback to ENV variable or database
    if (process.env.APP_VERSION) {
      return process.env.APP_VERSION;
    }
    if (db) {
      const result = await settingsQueries.getSettingByKey(db, 'APP_VERSION');
      return result?.value || '0';
    }
    return '0';
  }
};

