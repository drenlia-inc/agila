type AdminSettingsMap = Record<string, string | undefined>;

export type MailMode = 'managed' | 'byo' | '';

export function isDemoMailLocked(settings?: AdminSettingsMap): boolean {
  if (String(settings?.DEPLOY_DEMO_ENABLED || '').trim() === 'true') return true;
  try {
    return (
      (import.meta as { env?: { DEMO_ENABLED?: string } }).env?.DEMO_ENABLED === 'true' ||
      (typeof process !== 'undefined' && process.env?.DEMO_ENABLED === 'true')
    );
  } catch {
    return false;
  }
}

export function resolveMailModeFromSettings(settings: AdminSettingsMap): MailMode {
  const mode = String(settings.SMTP_MODE || '').trim().toLowerCase();
  if (mode === 'managed' || mode === 'byo') return mode;
  if (String(settings.MAIL_MANAGED || '').trim() === 'true') return 'managed';
  if (String(settings.SMTP_HOST || '').trim()) return 'byo';
  return '';
}

export function isMailManagedEligible(settings: AdminSettingsMap): boolean {
  return String(settings.SMTP_MANAGED_ELIGIBLE || '').trim().toLowerCase() === 'true';
}
