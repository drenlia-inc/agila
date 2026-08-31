/**
 * Admin-entered settings secrets encrypted at rest.
 */

export const SECRET_SETTING_KEYS = Object.freeze([
  'SMTP_PASSWORD',
  'PLATFORM_SMTP_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'PLATFORM_GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'M365_CLIENT_SECRET',
  'AI_API_KEY',
  'AI_RUNNER_TOKEN',
  'S3_SECRET_ACCESS_KEY',
  'PLATFORM_S3_SECRET_ACCESS_KEY'
]);

/** Placeholder returned on admin GET — never the raw secret */
export const SECRET_SETTING_PLACEHOLDER = '••••••••';

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretSettingKey(key) {
  return SECRET_SETTING_KEYS.includes(key);
}
