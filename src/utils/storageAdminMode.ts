type AdminSettingsMap = Record<string, string | undefined>;

export type StorageMode = 'managed' | 'byo' | '';

export function resolveStorageModeFromSettings(settings: AdminSettingsMap): StorageMode {
  const mode = String(settings.STORAGE_MODE || '').trim().toLowerCase();
  if (mode === 'managed' || mode === 'byo') return mode;
  if (String(settings.STORAGE_MANAGED || '').trim() === 'true') return 'managed';
  if (String(settings.S3_BUCKET || '').trim()) return 'byo';
  return '';
}

/** `undefined` when mode flags have not loaded yet. */
export function storageManagedFromSettings(
  settings: AdminSettingsMap
): boolean | undefined {
  const modeRaw = settings.STORAGE_MODE;
  const flagRaw = settings.STORAGE_MANAGED;
  if (
    (modeRaw === undefined || modeRaw === '') &&
    (flagRaw === undefined || flagRaw === '')
  ) {
    return undefined;
  }
  return resolveStorageModeFromSettings(settings) === 'managed';
}
