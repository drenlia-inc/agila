import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, Cloud, GitCompareArrows, HardDrive } from 'lucide-react';
import api from '../../api';
import { toast } from '../../utils/toast';
import { isMaskedApiKeyDisplay } from '../../utils/maskSecret';
import {
  adminSettingsHaveChanges,
  revertAdminSettingField,
} from '../../utils/adminSettingsDirty';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import {
  AdminActionsBar,
  AdminSection,
  adminInputFullClass,
} from './AdminSection';
import { isMultiTenantDeploy } from '../../utils/ownerSetup';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';

interface Settings {
  STORAGE_BACKEND?: string;
  STORAGE_MANAGED?: string;
  STORAGE_TEST_OK?: string;
  STORAGE_MIGRATION_STATUS?: string;
  STORAGE_MIGRATION_DETAIL?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_SECRET_ACCESS_KEY_SET?: string;
  S3_FORCE_PATH_STYLE?: string;
  S3_KEY_PREFIX?: string;
  [key: string]: string | undefined;
}

interface MigrationCounts {
  copied: number;
  skipped: number;
  missing: number;
  failed: number;
}

interface MigrationDetail {
  direction?: string;
  phase?: string;
  total?: number;
  processed?: number;
  currentFile?: string | null;
  attachments?: MigrationCounts;
  avatars?: MigrationCounts;
  errors?: string[];
  startedAt?: string;
  finishedAt?: string;
  cutoverApplied?: boolean;
  cutoverBucket?: string;
  cutoverPrefix?: string;
}

const MIGRATE_RESULT_STORAGE_KEY = 'easyKanban.storageMigrateResult';

/** Default AWS endpoint suggested when switching to S3 with an empty endpoint. */
const DEFAULT_S3_ENDPOINT = 'https://s3.amazonaws.com';

interface DestDraft {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: string;
  S3_KEY_PREFIX: string;
}

const emptyDestDraft = (): DestDraft => ({
  S3_ENDPOINT: DEFAULT_S3_ENDPOINT,
  S3_REGION: '',
  S3_BUCKET: '',
  S3_ACCESS_KEY_ID: '',
  S3_SECRET_ACCESS_KEY: '',
  S3_FORCE_PATH_STYLE: 'false',
  S3_KEY_PREFIX: '',
});

interface MigrationProgress {
  status?: string;
  detail?: MigrationDetail | null;
  running?: boolean;
  finished?: boolean;
  ok?: boolean;
  warning?: boolean;
  message?: string | null;
}

interface CompareItem {
  path: string;
  filename: string;
  users?: { id: string; email: string; name: string }[];
  tasks?: { id: string; ticket: string; title: string }[];
}

interface CompareBucket {
  both: number;
  diskOnly: number;
  s3Only: number;
  missing: number;
  items: { diskOnly: CompareItem[]; s3Only: CompareItem[]; missing: CompareItem[] };
}

interface CompareResult {
  ok?: boolean;
  attachments?: CompareBucket;
  avatars?: CompareBucket;
  totals?: {
    scanned: number;
    both: number;
    diskOnly: number;
    s3Only: number;
    missing: number;
  };
  bucket?: string;
  prefix?: string;
}

const EMPTY_COUNTS: MigrationCounts = { copied: 0, skipped: 0, missing: 0, failed: 0 };

interface AdminStorageTabProps {
  settings: Settings;
  editingSettings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: () => void;
  onCancel: () => void;
  onSettingsReload?: (options?: { quiet?: boolean }) => Promise<void>;
  onApplySettingsPatch?: (patch: Record<string, string | undefined>) => void;
}

const AdminStorageTab: React.FC<AdminStorageTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onSettingsReload,
  onApplySettingsPatch,
}) => {
  const { t } = useTranslation('admin');
  const hasChanges = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );

  const [isTesting, setIsTesting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState('');
  const [testErrorTechnical, setTestErrorTechnical] = useState('');
  const [showTestModal, setShowTestModal] = useState(false);
  const [showTestErrorModal, setShowTestErrorModal] = useState(false);
  const [showFirstConfirm, setShowFirstConfirm] = useState(false);
  const [showSecondConfirm, setShowSecondConfirm] = useState(false);
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<MigrationProgress | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  /** Configure destination for S3→S3 without clearing live/source credentials. */
  const [configuringDest, setConfiguringDest] = useState(false);
  const [destDraft, setDestDraft] = useState<DestDraft>(() => emptyDestDraft());
  const [destTestOk, setDestTestOk] = useState(false);
  const [isTestingDest, setIsTestingDest] = useState(false);
  const migratePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const migrateStartedAtRef = useRef<string | null>(null);
  const migrateFinishedHandledRef = useRef(false);

  // Restore result modal if Admin remounted before the user dismissed it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MIGRATE_RESULT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as MigrationProgress;
      if (!saved?.finished) return;
      setMigrateProgress(saved);
      setShowMigrateModal(true);
      setIsMigrating(false);
      migrateFinishedHandledRef.current = true;
    } catch {
      sessionStorage.removeItem(MIGRATE_RESULT_STORAGE_KEY);
    }
  }, []);

  const isManaged = editingSettings.STORAGE_MANAGED === 'true';
  const backend = (editingSettings.STORAGE_BACKEND || 'disk').toLowerCase();
  const savedBackend = (settings.STORAGE_BACKEND || 'disk').toLowerCase();
  const isS3 = backend === 's3';
  const backendPending = backend !== savedBackend;
  const testOk =
    editingSettings.STORAGE_TEST_OK === 'true' || settings.STORAGE_TEST_OK === 'true';
  const multiTenant = isMultiTenantDeploy();

  const inputClass = adminInputFullClass;

  const handleCompare = async () => {
    setIsComparing(true);
    try {
      const { data } = await api.post<CompareResult>('/admin/compare-storage');
      setCompareResult(data);
      setShowCompareModal(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || t('storage.compareFailed'));
    } finally {
      setIsComparing(false);
    }
  };

  const closeCompareModal = () => setShowCompareModal(false);

  const str = (value: unknown) => (value == null ? '' : String(value)).trim();

  const secretSet =
    editingSettings.S3_SECRET_ACCESS_KEY_SET === 'true' ||
    Boolean(
      str(editingSettings.S3_SECRET_ACCESS_KEY) &&
        isMaskedApiKeyDisplay(str(editingSettings.S3_SECRET_ACCESS_KEY))
    );
  const secretDraft = str(editingSettings.S3_SECRET_ACCESS_KEY);
  const secretReady =
    secretSet ||
    (Boolean(secretDraft) && !isMaskedApiKeyDisplay(secretDraft));

  const canTestS3 = () =>
    Boolean(
      str(editingSettings.S3_BUCKET) &&
        (str(editingSettings.S3_REGION) || str(editingSettings.S3_ENDPOINT)) &&
        str(editingSettings.S3_ACCESS_KEY_ID) &&
        secretReady
    );

  /** Switching disk → S3 requires credentials + a successful Test (managed S3 is already live). */
  const s3ActivationBlocked =
    backendPending && isS3 && !isManaged && !(canTestS3() && testOk);
  const canSaveStorage =
    hasChanges && !isManaged && !configuringDest && !s3ActivationBlocked;

  /** Managed env, or complete credentials + a successful Test connection. */
  const canMigrateS3 = isManaged || (canTestS3() && testOk);

  const canTestDest = () =>
    Boolean(
      str(destDraft.S3_BUCKET) &&
        (str(destDraft.S3_REGION) || str(destDraft.S3_ENDPOINT)) &&
        str(destDraft.S3_ACCESS_KEY_ID) &&
        str(destDraft.S3_SECRET_ACCESS_KEY) &&
        !isMaskedApiKeyDisplay(str(destDraft.S3_SECRET_ACCESS_KEY))
    );

  const canMigrateS3ToS3 = isS3 && canTestDest() && destTestOk;

  const beginDestConfig = () => {
    setDestDraft(emptyDestDraft());
    setDestTestOk(false);
    setConfiguringDest(true);
    setShowSecondConfirm(false);
    setShowFirstConfirm(false);
    toast.success(t('storage.destConfigStarted'));
  };

  const cancelDestConfig = () => {
    setConfiguringDest(false);
    setDestDraft(emptyDestDraft());
    setDestTestOk(false);
    setShowTestModal(false);
    setTestResult(null);
    setShowTestErrorModal(false);
    setTestError('');
    setTestErrorTechnical('');
  };

  /** Footer Cancel must also exit destination-config mode (local React state). */
  const handleCancelAll = () => {
    cancelDestConfig();
    onCancel();
  };

  const handleDestChange = (key: keyof DestDraft, value: string) => {
    setDestDraft((prev) => ({ ...prev, [key]: value }));
    setDestTestOk(false);
  };

  const handleInputChange = (key: string, value: string) => {
    const next: Settings = { ...editingSettings, [key]: value };
    // Credential/endpoint edits invalidate a prior successful S3 test
    if (
      key === 'S3_ACCESS_KEY_ID' ||
      key === 'S3_SECRET_ACCESS_KEY' ||
      key === 'S3_BUCKET' ||
      key === 'S3_ENDPOINT' ||
      key === 'S3_REGION' ||
      key === 'S3_FORCE_PATH_STYLE' ||
      key === 'S3_KEY_PREFIX'
    ) {
      next.STORAGE_TEST_OK = 'false';
    }
    onSettingsChange(next);
  };

  const handleBackendChange = (value: string) => {
    const next: Settings = { ...editingSettings, STORAGE_BACKEND: value };
    if (value === 's3' && !str(editingSettings.S3_ENDPOINT)) {
      next.S3_ENDPOINT = DEFAULT_S3_ENDPOINT;
    }
    onSettingsChange(next);
  };

  const revertField = (key: string) => {
    onSettingsChange(revertAdminSettingField(key, settings, editingSettings));
  };

  const fieldLabel = (key: string, label: string, opts?: { optional?: boolean }) => (
    <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      <span>
        {label}
        {opts?.optional && (
          <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
            ({t('storage.optional')})
          </span>
        )}
      </span>
      {!isManaged && (
        <AdminFieldDraftControls
          settingKey={key}
          saved={settings}
          draft={editingSettings}
          onRevert={() => revertField(key)}
        />
      )}
    </label>
  );

  const explainTestFailure = (data: {
    errorCode?: string;
    error?: string;
    technicalDetail?: string;
    details?: string;
  }) => {
    const code = data.errorCode || '';
    const codeKey = code ? `storage.testErrors.${code}` : '';
    const translated = codeKey && t(codeKey) !== codeKey ? t(codeKey) : '';
    const message = translated || data.error || data.details || t('storage.testFailed');
    const technical = data.technicalDetail || '';
    return { message, technical };
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestError('');
    setTestErrorTechnical('');
    setShowTestModal(false);
    setShowTestErrorModal(false);
    try {
      // Probe with typed draft values — no Save required. Saved secret is used when draft is masked/empty.
      const payload: Record<string, string> = {
        S3_ENDPOINT: str(editingSettings.S3_ENDPOINT),
        S3_REGION: str(editingSettings.S3_REGION),
        S3_BUCKET: str(editingSettings.S3_BUCKET),
        S3_ACCESS_KEY_ID: str(editingSettings.S3_ACCESS_KEY_ID),
        S3_FORCE_PATH_STYLE: str(editingSettings.S3_FORCE_PATH_STYLE) || 'false',
        S3_KEY_PREFIX: str(editingSettings.S3_KEY_PREFIX),
      };
      if (secretDraft && !isMaskedApiKeyDisplay(secretDraft)) {
        payload.S3_SECRET_ACCESS_KEY = secretDraft;
      }

      const { data } = await api.post('/admin/test-storage', payload);
      setTestResult(data);
      setShowTestModal(true);

      // Persist the draft S3 fields that just worked — skip a separate Save click
      try {
        const patch: Record<string, string | undefined> = {
          STORAGE_TEST_OK: 'true',
        };
        const persistKeys = [
          'S3_ENDPOINT',
          'S3_REGION',
          'S3_BUCKET',
          'S3_ACCESS_KEY_ID',
          'S3_FORCE_PATH_STYLE',
          'S3_KEY_PREFIX',
        ] as const;
        for (const key of persistKeys) {
          let value = str(editingSettings[key]);
          if (key === 'S3_FORCE_PATH_STYLE' && !value) value = 'false';
          if (value !== str(settings[key])) {
            await api.put('/admin/settings', { key, value });
          }
          patch[key] = value;
        }
        if (secretDraft && !isMaskedApiKeyDisplay(secretDraft)) {
          await api.put('/admin/settings', {
            key: 'S3_SECRET_ACCESS_KEY',
            value: secretDraft,
          });
          patch.S3_SECRET_ACCESS_KEY = '';
          patch.S3_SECRET_ACCESS_KEY_SET = 'true';
        }

        if (onApplySettingsPatch) {
          onApplySettingsPatch(patch);
        } else {
          onSettingsChange({ ...editingSettings, ...patch });
        }

        toast.success(t('storage.testSuccessSaved'));
      } catch (saveErr) {
        console.error('S3 settings persist after successful test failed:', saveErr);
        onSettingsChange({ ...editingSettings, STORAGE_TEST_OK: 'true' });
        toast.error(t('storage.testSucceededButSaveFailed'));
      }
    } catch (err: any) {
      const { message, technical } = explainTestFailure(err.response?.data || {});
      const fallback =
        message || err.message || t('storage.testFailed');
      setTestError(fallback);
      setTestErrorTechnical(technical);
      setShowTestErrorModal(true);
      onSettingsChange({ ...editingSettings, STORAGE_TEST_OK: 'false' });
      toast.error(t('storage.testFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestDest = async () => {
    if (!canTestDest()) {
      toast.error(t('storage.migrateNeedsCredentials'));
      return;
    }
    setIsTestingDest(true);
    setTestError('');
    setTestErrorTechnical('');
    setShowTestModal(false);
    setShowTestErrorModal(false);
    try {
      // Destination-only probe: never merge/persist into live managed or custom source settings.
      const payload = {
        asDestination: true as const,
        S3_ENDPOINT: str(destDraft.S3_ENDPOINT) || DEFAULT_S3_ENDPOINT,
        S3_REGION: str(destDraft.S3_REGION),
        S3_BUCKET: str(destDraft.S3_BUCKET),
        S3_ACCESS_KEY_ID: str(destDraft.S3_ACCESS_KEY_ID),
        S3_SECRET_ACCESS_KEY: str(destDraft.S3_SECRET_ACCESS_KEY),
        S3_FORCE_PATH_STYLE: str(destDraft.S3_FORCE_PATH_STYLE) || 'false',
        S3_KEY_PREFIX: str(destDraft.S3_KEY_PREFIX),
      };
      if (!payload.S3_BUCKET || !payload.S3_ACCESS_KEY_ID || !payload.S3_SECRET_ACCESS_KEY) {
        toast.error(t('storage.migrateNeedsCredentials'));
        return;
      }
      const { data } = await api.post('/admin/test-storage', payload);
      setTestResult(data);
      setShowTestModal(true);
      setDestTestOk(true);
      toast.success(t('storage.destTestSuccess'));
    } catch (err: any) {
      const { message, technical } = explainTestFailure(err.response?.data || {});
      setTestError(message || err.message || t('storage.testFailed'));
      setTestErrorTechnical(technical);
      setShowTestErrorModal(true);
      setDestTestOk(false);
      toast.error(t('storage.testFailed'));
    } finally {
      setIsTestingDest(false);
    }
  };

  const stopMigratePolling = () => {
    if (migratePollRef.current) {
      clearInterval(migratePollRef.current);
      migratePollRef.current = null;
    }
  };

  useEffect(() => () => stopMigratePolling(), []);

  // Any finished result stays until Close — warnings/errors must remain readable.
  const migrateNeedsAck =
    Boolean(showMigrateModal) && !isMigrating && Boolean(migrateProgress?.finished);

  const finishMigrateFromProgress = async (data: MigrationProgress) => {
    if (migrateFinishedHandledRef.current) return;
    migrateFinishedHandledRef.current = true;
    stopMigratePolling();
    setIsMigrating(false);
    setMigrateProgress(data);
    setShowMigrateModal(true);
    try {
      sessionStorage.setItem(MIGRATE_RESULT_STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }

    // Patch STORAGE_* locally — never call onSettingsReload here (even quiet refresh
    // used to re-trigger Admin loadData via systemSettings and unmount this modal).
    const patch: Record<string, string | undefined> = {
      STORAGE_MIGRATION_STATUS: data.status || '',
      STORAGE_MIGRATION_DETAIL: data.detail ? JSON.stringify(data.detail) : '',
    };
    if (data.ok && data.detail?.direction === 'disk-to-s3') {
      patch.STORAGE_BACKEND = 's3';
    } else if (data.ok && data.detail?.direction === 's3-to-disk') {
      patch.STORAGE_BACKEND = 'disk';
    } else if (data.ok && data.detail?.direction === 's3-to-s3' && data.detail?.cutoverApplied) {
      patch.STORAGE_BACKEND = 's3';
      patch.STORAGE_MANAGED = 'false';
      patch.STORAGE_TEST_OK = 'true';
      patch.S3_ENDPOINT = destDraft.S3_ENDPOINT;
      patch.S3_REGION = destDraft.S3_REGION;
      patch.S3_BUCKET = destDraft.S3_BUCKET;
      patch.S3_ACCESS_KEY_ID = destDraft.S3_ACCESS_KEY_ID;
      patch.S3_FORCE_PATH_STYLE = destDraft.S3_FORCE_PATH_STYLE || 'false';
      patch.S3_KEY_PREFIX = destDraft.S3_KEY_PREFIX;
      patch.S3_SECRET_ACCESS_KEY = '';
      patch.S3_SECRET_ACCESS_KEY_SET = 'true';
      setConfiguringDest(false);
      setDestTestOk(false);
      setDestDraft(emptyDestDraft());
    }
    if (onApplySettingsPatch) {
      onApplySettingsPatch(patch);
    } else {
      onSettingsChange({ ...editingSettings, ...patch });
    }

    if (data.ok && data.detail?.direction === 's3-to-s3' && onSettingsReload) {
      try {
        await onSettingsReload({ quiet: true });
      } catch {
        /* local patch already applied */
      }
    }
  };

  const pollMigrateStatus = async () => {
    try {
      const { data } = await api.get<MigrationProgress>('/admin/migrate-storage/status');
      const startedAt = migrateStartedAtRef.current;
      if (
        startedAt &&
        data.detail?.startedAt &&
        data.detail.startedAt !== startedAt &&
        data.finished
      ) {
        // Ignore a previous migration's terminal status until this run updates.
        return;
      }
      setMigrateProgress(data);
      if (data.finished && (!startedAt || data.detail?.startedAt === startedAt)) {
        await finishMigrateFromProgress(data);
      }
    } catch {
      /* keep polling; transient blips shouldn't close the modal */
    }
  };

  const handleMigrate = async (direction: 'disk-to-s3' | 's3-to-disk' | 's3-to-s3') => {
    if (direction === 's3-to-s3') {
      if (!canMigrateS3ToS3) {
        toast.error(t('storage.migrateS3ToS3NeedsTest'));
        return;
      }
    } else if (!canMigrateS3) {
      toast.error(t('storage.migrateNeedsCredentials'));
      return;
    }
    if (direction === 's3-to-disk' && multiTenant) {
      toast.error(t('storage.migrateToDiskBlockedMultiTenant'));
      return;
    }

    closeCompareModal();
    stopMigratePolling();
    migrateFinishedHandledRef.current = false;
    migrateStartedAtRef.current = null;
    setIsMigrating(true);
    setShowMigrateModal(true);
    setMigrateProgress({
      status: 'running',
      running: true,
      finished: false,
      detail: {
        phase: 'scanning',
        processed: 0,
        total: 0,
        attachments: { ...EMPTY_COUNTS },
        avatars: { ...EMPTY_COUNTS },
        errors: [],
      },
    });

    try {
      const body: Record<string, unknown> = {
        direction,
        deleteSource: false,
      };
      if (direction === 's3-to-s3') {
        body.destination = {
          S3_ENDPOINT: str(destDraft.S3_ENDPOINT),
          S3_REGION: str(destDraft.S3_REGION),
          S3_BUCKET: str(destDraft.S3_BUCKET),
          S3_ACCESS_KEY_ID: str(destDraft.S3_ACCESS_KEY_ID),
          S3_SECRET_ACCESS_KEY: str(destDraft.S3_SECRET_ACCESS_KEY),
          S3_FORCE_PATH_STYLE: str(destDraft.S3_FORCE_PATH_STYLE) || 'false',
          S3_KEY_PREFIX: str(destDraft.S3_KEY_PREFIX),
        };
      }
      const { data } = await api.post('/admin/migrate-storage', body);
      migrateStartedAtRef.current = data?.detail?.startedAt || null;
      if (data?.detail) {
        setMigrateProgress((prev) => ({
          ...prev,
          status: 'running',
          running: true,
          finished: false,
          detail: { ...prev?.detail, ...data.detail },
        }));
      }
      await pollMigrateStatus();
      if (!migrateFinishedHandledRef.current) {
        stopMigratePolling();
        migratePollRef.current = setInterval(() => {
          void pollMigrateStatus();
        }, 400);
      }
    } catch (err: any) {
      stopMigratePolling();
      setIsMigrating(false);
      const message = err.response?.data?.error || err.message || t('storage.migrateFailed');
      setMigrateProgress({
        status: 'failed',
        finished: true,
        ok: false,
        warning: false,
        message,
        detail: {
          phase: 'failed',
          processed: 0,
          total: 0,
          attachments: { ...EMPTY_COUNTS },
          avatars: { ...EMPTY_COUNTS },
          errors: [message],
        },
      });
      // Keep the modal open with the error; no toast (auto-dismisses).
    }
  };

  const closeMigrateModal = () => {
    if (isMigrating) return;
    setShowMigrateModal(false);
    try {
      sessionStorage.removeItem(MIGRATE_RESULT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  useEscapeDismiss(
    () => {
      if (showSecondConfirm) {
        setShowSecondConfirm(false);
        return;
      }
      if (showFirstConfirm) {
        setShowFirstConfirm(false);
        return;
      }
      if (showTestModal) {
        setShowTestModal(false);
        return;
      }
      if (showTestErrorModal) {
        setShowTestErrorModal(false);
        return;
      }
      if (showCompareModal) {
        closeCompareModal();
        return;
      }
      if (showMigrateModal) {
        closeMigrateModal();
      }
    },
    {
      enabled:
        showFirstConfirm ||
        showSecondConfirm ||
        showTestModal ||
        showTestErrorModal ||
        showCompareModal ||
        (showMigrateModal && !isMigrating),
    }
  );

  const migrateResultMessage =
    migrateProgress?.message ||
    (migrateProgress?.ok
      ? migrateProgress.warning
        ? t('storage.migratePartial')
        : t('storage.migrateDone')
      : t('storage.migrateFailed'));

  const detail = migrateProgress?.detail;
  const processed = detail?.processed ?? 0;
  const total = detail?.total ?? 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const att = detail?.attachments || EMPTY_COUNTS;
  const ava = detail?.avatars || EMPTY_COUNTS;
  const missingCount = (att.missing || 0) + (ava.missing || 0);
  const issueLines = detail?.errors?.length
    ? detail.errors
    : missingCount > 0
      ? [t('storage.migrateModalMissingNoDetail', { count: missingCount })]
      : [];

  const switchToCustom = () => {
    // Keep platform/live S3 credentials until Migrate S3 → S3 cutover succeeds.
    beginDestConfig();
  };

  return (
    <>
      <div data-setting-key="STORAGE_SECTION">
        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('storage.description')}</p>

          {isManaged && (
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                {t('storage.managedTitle')}
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                {t('storage.managedDescription')}
              </p>
              {!configuringDest ? (
                <button
                  type="button"
                  onClick={() => setShowFirstConfirm(true)}
                  data-owner-setup="switch-custom-storage"
                  className="mt-3 text-sm bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-3 py-1 rounded-md hover:bg-blue-200 dark:hover:bg-blue-700"
                >
                  {t('storage.switchToCustom')}
                </button>
              ) : (
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-2">
                  {t('storage.destConfigInProgress')}
                </p>
              )}
            </div>
          )}

          {!isManaged && isS3 && !configuringDest && (
            <div className="mt-4">
              <button
                type="button"
                onClick={beginDestConfig}
                className="text-sm border border-indigo-300 dark:border-indigo-600 text-indigo-800 dark:text-indigo-200 px-3 py-1.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              >
                {t('storage.migrateToAnotherBucket')}
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('storage.migrateToAnotherBucketHint')}
              </p>
            </div>
          )}
        </div>

        <div className="max-w-3xl space-y-3">
          {/* Backend picker — large cards so Disk vs S3 is unmistakable */}
          <div data-setting-key="STORAGE_BACKEND">
            {fieldLabel('STORAGE_BACKEND', t('storage.backend'))}
            <div
              role="radiogroup"
              aria-label={t('storage.backend')}
              className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
              {(
                [
                  {
                    value: 'disk' as const,
                    label: t('storage.backendDisk'),
                    hint: t('storage.backendDiskHint'),
                    Icon: HardDrive,
                    selectedClass:
                      'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/80 ring-2 ring-slate-300 dark:ring-slate-600',
                    iconWrap: 'bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
                  },
                  {
                    value: 's3' as const,
                    label: t('storage.backendS3'),
                    hint: t('storage.backendS3Hint'),
                    Icon: Cloud,
                    selectedClass:
                      'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 ring-2 ring-indigo-300 dark:ring-indigo-700',
                    iconWrap: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300',
                  },
                ]
              ).map(({ value, label, hint, Icon, selectedClass, iconWrap }) => {
                const selected = backend === value;
                const isSaved = savedBackend === value;
                // Multi-tenant: disk is never available across pods, but custom S3 must stay selectable
                // (e.g. tenants that still have STORAGE_BACKEND=disk when platform S3 was not provisioned).
                // Managed S3 locks both cards — use "Use your own S3 bucket" instead.
                const disabled =
                  configuringDest ||
                  isManaged ||
                  (value === 'disk' && multiTenant);
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled && !selected) handleBackendChange(value);
                    }}
                    className={`relative text-left rounded-lg border-2 p-3 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected
                        ? selectedClass
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                          selected ? iconWrap : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                        }`}
                      >
                        <Icon size={18} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-sm font-semibold ${
                              selected
                                ? 'text-gray-900 dark:text-gray-50'
                                : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {label}
                          </span>
                          {selected && isSaved && !backendPending && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:text-green-300">
                              <CheckCircle2 size={12} aria-hidden />
                              {t('storage.backendActive')}
                            </span>
                          )}
                          {selected && backendPending && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                              {t('storage.backendPendingSave')}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                          {hint}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {multiTenant && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {!isManaged && backend === 'disk'
                  ? t('storage.multiTenantDiskStuckHint')
                  : t('storage.multiTenantHint')}
              </p>
            )}
            {s3ActivationBlocked && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                {t('storage.saveS3NeedsTest')}
              </p>
            )}
          </div>

          {/* Mode summary */}
          {!isManaged && !configuringDest && (
            <div
              className={`rounded-xl border px-4 py-3 ${
                isS3
                  ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {isS3 ? (
                  <Cloud size={18} className="mt-0.5 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
                ) : (
                  <HardDrive size={18} className="mt-0.5 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {isS3 ? t('storage.s3ModeTitle') : t('storage.diskModeTitle')}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {isS3 ? t('storage.s3ModeDescription') : t('storage.diskModeDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* S3 configuration */}
          {!isManaged && !configuringDest && (
            <section
              className={`rounded-xl border ${
                isS3
                  ? 'border-indigo-200 dark:border-indigo-800'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <div
                className={`px-4 py-3 border-b ${
                  isS3
                    ? 'border-indigo-100 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20'
                    : 'border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/50'
                }`}
              >
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t('storage.s3ConfigTitle')}
                </h3>
                {!isS3 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t('storage.s3ConfigWhenDisk')}
                  </p>
                )}
              </div>

              <div className="p-4 space-y-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('storage.connectionSection')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div data-setting-key="S3_ENDPOINT">
                      {fieldLabel('S3_ENDPOINT', t('storage.endpoint'), { optional: true })}
                      <input
                        type="text"
                        value={editingSettings.S3_ENDPOINT || ''}
                        onChange={(e) => handleInputChange('S3_ENDPOINT', e.target.value)}
                        placeholder={DEFAULT_S3_ENDPOINT}
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('storage.endpointHint')}
                      </p>
                    </div>
                    <div data-setting-key="S3_REGION">
                      {fieldLabel('S3_REGION', t('storage.region'))}
                      <input
                        type="text"
                        value={editingSettings.S3_REGION || ''}
                        onChange={(e) => handleInputChange('S3_REGION', e.target.value)}
                        placeholder="ca-central-1"
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('storage.regionHint')}
                      </p>
                    </div>
                    <div data-setting-key="S3_BUCKET">
                      {fieldLabel('S3_BUCKET', t('storage.bucket'))}
                      <input
                        type="text"
                        value={editingSettings.S3_BUCKET || ''}
                        onChange={(e) => handleInputChange('S3_BUCKET', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div data-setting-key="S3_KEY_PREFIX">
                      {fieldLabel('S3_KEY_PREFIX', t('storage.keyPrefix'), { optional: true })}
                      <input
                        type="text"
                        value={editingSettings.S3_KEY_PREFIX || ''}
                        onChange={(e) => handleInputChange('S3_KEY_PREFIX', e.target.value)}
                        placeholder="tenants/my-company/"
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('storage.keyPrefixHint')}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('storage.credentialsSection')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div data-setting-key="S3_ACCESS_KEY_ID">
                      {fieldLabel('S3_ACCESS_KEY_ID', t('storage.accessKey'))}
                      <input
                        type="text"
                        value={editingSettings.S3_ACCESS_KEY_ID || ''}
                        onChange={(e) => handleInputChange('S3_ACCESS_KEY_ID', e.target.value)}
                        autoComplete="off"
                        className={inputClass}
                      />
                    </div>
                    <div data-setting-key="S3_SECRET_ACCESS_KEY">
                      {fieldLabel('S3_SECRET_ACCESS_KEY', t('storage.secretKey'))}
                      <input
                        type="password"
                        value={editingSettings.S3_SECRET_ACCESS_KEY || ''}
                        onChange={(e) => handleInputChange('S3_SECRET_ACCESS_KEY', e.target.value)}
                        placeholder={secretSet ? t('storage.secretLeaveBlank') : ''}
                        autoComplete="new-password"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                <div data-setting-key="S3_FORCE_PATH_STYLE">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('storage.optionsSection')}
                  </p>
                  <label
                    htmlFor="s3-path-style"
                    className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  >
                    <input
                      id="s3-path-style"
                      type="checkbox"
                      checked={editingSettings.S3_FORCE_PATH_STYLE === 'true'}
                      onChange={(e) =>
                        handleInputChange('S3_FORCE_PATH_STYLE', e.target.checked ? 'true' : 'false')
                      }
                      className="h-4 w-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {t('storage.forcePathStyle')}
                        <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
                          ({t('storage.optional')})
                        </span>
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('storage.forcePathStyleHint')}
                      </span>
                    </span>
                  </label>
                </div>

                <div
                  className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-800"
                  data-owner-setup="storage-test-connection"
                >
                  <button
                    type="button"
                    disabled={!canTestS3() || isTesting}
                    onClick={() => void handleTest()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isTesting ? t('storage.testing') : t('storage.testConnection')}
                  </button>
                  {testOk && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle2 size={16} aria-hidden />
                      {t('storage.testOk')}
                    </span>
                  )}
                  <p className="w-full text-xs text-gray-500 dark:text-gray-400">
                    {t('storage.testUsesDraftHint')}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Destination S3 (managed → custom or custom old → new) */}
          {configuringDest && (
            <section className="rounded-xl border border-indigo-200 dark:border-indigo-800">
              <div className="px-4 py-3 border-b border-indigo-100 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {t('storage.destConfigTitle')}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {isManaged
                        ? t('storage.destConfigManagedHint')
                        : t('storage.destConfigCustomHint')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={cancelDestConfig}
                    className="text-xs text-gray-600 dark:text-gray-300 underline"
                  >
                    {t('storage.cancelDestConfig')}
                  </button>
                </div>
              </div>
              <div className="p-4 space-y-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('storage.connectionSection')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div data-setting-key="S3_ENDPOINT">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('storage.endpoint')}
                        <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
                          ({t('storage.optional')})
                        </span>
                      </label>
                      <input
                        type="text"
                        value={destDraft.S3_ENDPOINT}
                        onChange={(e) => handleDestChange('S3_ENDPOINT', e.target.value)}
                        placeholder={DEFAULT_S3_ENDPOINT}
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('storage.endpointHint')}
                      </p>
                    </div>
                    <div data-setting-key="S3_REGION">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('storage.region')}
                      </label>
                      <input
                        type="text"
                        value={destDraft.S3_REGION}
                        onChange={(e) => handleDestChange('S3_REGION', e.target.value)}
                        placeholder="ca-central-1"
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('storage.regionHint')}
                      </p>
                    </div>
                    <div data-setting-key="S3_BUCKET">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('storage.bucket')}
                      </label>
                      <input
                        type="text"
                        value={destDraft.S3_BUCKET}
                        onChange={(e) => handleDestChange('S3_BUCKET', e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div data-setting-key="S3_KEY_PREFIX">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('storage.keyPrefix')}
                        <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
                          ({t('storage.optional')})
                        </span>
                      </label>
                      <input
                        type="text"
                        value={destDraft.S3_KEY_PREFIX}
                        onChange={(e) => handleDestChange('S3_KEY_PREFIX', e.target.value)}
                        placeholder="tenants/my-company/"
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('storage.keyPrefixHint')}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('storage.credentialsSection')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div data-setting-key="S3_ACCESS_KEY_ID">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('storage.accessKey')}
                      </label>
                      <input
                        type="text"
                        value={destDraft.S3_ACCESS_KEY_ID}
                        onChange={(e) => handleDestChange('S3_ACCESS_KEY_ID', e.target.value)}
                        className={inputClass}
                        autoComplete="off"
                      />
                    </div>
                    <div data-setting-key="S3_SECRET_ACCESS_KEY">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('storage.secretKey')}
                      </label>
                      <input
                        type="password"
                        value={destDraft.S3_SECRET_ACCESS_KEY}
                        onChange={(e) => handleDestChange('S3_SECRET_ACCESS_KEY', e.target.value)}
                        className={inputClass}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('storage.optionsSection')}
                  </p>
                  <label className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <input
                      type="checkbox"
                      checked={destDraft.S3_FORCE_PATH_STYLE === 'true'}
                      onChange={(e) =>
                        handleDestChange('S3_FORCE_PATH_STYLE', e.target.checked ? 'true' : 'false')
                      }
                      className="h-4 w-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {t('storage.forcePathStyle')}
                        <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
                          ({t('storage.optional')})
                        </span>
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('storage.forcePathStyleHint')}
                      </span>
                    </span>
                  </label>
                </div>

                <div
                  className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-800"
                  data-owner-setup="storage-test-connection"
                >
                  <button
                    type="button"
                    disabled={!canTestDest() || isTestingDest}
                    onClick={() => void handleTestDest()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isTestingDest ? t('storage.testing') : t('storage.testDestination')}
                  </button>
                  {destTestOk && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle2 size={16} aria-hidden />
                      {t('storage.destTestOk')}
                    </span>
                  )}
                  <p className="w-full text-xs text-gray-500 dark:text-gray-400">
                    {t('storage.destTestHint')}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Migrate + compare (compare/disk↔s3 hidden while configuring another bucket) */}
          <AdminSection
            title={t('storage.migrateTitle')}
            description={
              configuringDest
                ? t('storage.migrateS3ToS3Description')
                : t('storage.migrateDescription')
            }
            dense
          >
            <div className="flex flex-wrap gap-2">
              {configuringDest ? (
                <button
                  type="button"
                  disabled={isMigrating || !canMigrateS3ToS3}
                  onClick={() => handleMigrate('s3-to-s3')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  title={!canMigrateS3ToS3 ? t('storage.migrateS3ToS3NeedsTest') : undefined}
                >
                  <Cloud size={14} aria-hidden />
                  <ArrowRight size={12} aria-hidden />
                  <Cloud size={14} aria-hidden />
                  <span>{isMigrating ? t('storage.migrating') : t('storage.migrateS3ToS3')}</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isMigrating || !canMigrateS3}
                    onClick={() => handleMigrate('disk-to-s3')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    title={!canMigrateS3 ? t('storage.migrateNeedsCredentials') : undefined}
                  >
                    <HardDrive size={14} aria-hidden />
                    <ArrowRight size={12} aria-hidden />
                    <Cloud size={14} aria-hidden />
                    <span>{isMigrating ? t('storage.migrating') : t('storage.migrateToS3')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isMigrating || multiTenant || !canMigrateS3}
                    onClick={() => handleMigrate('s3-to-disk')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white text-sm font-medium rounded-md hover:bg-slate-700 disabled:opacity-50"
                    title={
                      multiTenant
                        ? t('storage.migrateToDiskBlockedMultiTenant')
                        : !canMigrateS3
                          ? t('storage.migrateNeedsCredentials')
                          : undefined
                    }
                  >
                    <Cloud size={14} aria-hidden />
                    <ArrowRight size={12} aria-hidden />
                    <HardDrive size={14} aria-hidden />
                    <span>{t('storage.migrateToDisk')}</span>
                  </button>
                </>
              )}
            </div>
            {configuringDest && !canMigrateS3ToS3 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                {t('storage.migrateS3ToS3NeedsTest')}
              </p>
            ) : !canMigrateS3 && !isManaged && !configuringDest ? (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                {t('storage.migrateNeedsCredentials')}
              </p>
            ) : null}
            {!configuringDest && (
              <div className="pt-2 mt-1 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {t('storage.compareDescription')}
                </p>
                <button
                  type="button"
                  disabled={isComparing || (!canTestS3() && !isManaged)}
                  onClick={() => void handleCompare()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <GitCompareArrows size={14} aria-hidden />
                  {isComparing ? t('storage.comparing') : t('storage.compareRun')}
                </button>
              </div>
            )}
            {settings.STORAGE_MIGRATION_STATUS &&
              settings.STORAGE_MIGRATION_STATUS !== 'idle' &&
              !showMigrateModal && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('storage.lastMigrationStatus')}:{' '}
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {settings.STORAGE_MIGRATION_STATUS}
                  </span>
                </p>
              )}
          </AdminSection>

          <AdminActionsBar>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!canSaveStorage}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              title={s3ActivationBlocked ? t('storage.saveS3NeedsTest') : undefined}
            >
              {t('storage.save')}
            </button>
            <button
              type="button"
              onClick={() => handleCancelAll()}
              disabled={!hasChanges && !configuringDest}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {t('storage.cancel')}
            </button>
            <AdminUnsavedHint show={hasChanges || configuringDest} />
          </AdminActionsBar>
        </div>
      </div>

      {showFirstConfirm &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl">
              <p className="text-sm text-gray-700 dark:text-gray-300">{t('storage.switchConfirm1')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="px-3 py-1.5 text-sm" onClick={() => setShowFirstConfirm(false)}>
                  {t('storage.cancel')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
                  onClick={() => {
                    setShowFirstConfirm(false);
                    setShowSecondConfirm(true);
                  }}
                >
                  {t('storage.continue')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showSecondConfirm &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl">
              <p className="text-sm text-gray-700 dark:text-gray-300">{t('storage.switchConfirm2')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="px-3 py-1.5 text-sm" onClick={() => setShowSecondConfirm(false)}>
                  {t('storage.cancel')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded"
                  onClick={switchToCustom}
                >
                  {t('storage.confirmSwitch')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showTestModal && testResult &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl">
              <h3 className="font-semibold text-green-700 dark:text-green-300 mb-2">
                {t('storage.testSuccess')}
              </h3>
              <pre className="text-xs overflow-auto max-h-40 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                {JSON.stringify(testResult, null, 2)}
              </pre>
              <button
                type="button"
                className="mt-4 px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
                onClick={() => setShowTestModal(false)}
              >
                {t('storage.close')}
              </button>
            </div>
          </div>,
          document.body
        )}

      {showTestErrorModal &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full shadow-xl">
              <h3 className="font-semibold text-red-700 dark:text-red-300 mb-2">
                {t('storage.testFailed')}
              </h3>
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                {testError}
              </p>
              {testErrorTechnical && testErrorTechnical !== testError && (
                <details className="mt-3">
                  <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                    {t('storage.technicalDetails')}
                  </summary>
                  <pre className="mt-2 text-xs overflow-auto max-h-32 bg-gray-50 dark:bg-gray-900 p-2 rounded text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                    {testErrorTechnical}
                  </pre>
                </details>
              )}
              <button
                type="button"
                className="mt-4 px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
                onClick={() => setShowTestErrorModal(false)}
              >
                {t('storage.close')}
              </button>
            </div>
          </div>,
          document.body
        )}

      {showMigrateModal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
              // Finished results require explicit Close so warnings stay readable.
              if (!isMigrating && !migrateNeedsAck && e.target === e.currentTarget) {
                closeMigrateModal();
              }
            }}
          >
            <div
              role="dialog"
              aria-modal
              aria-labelledby="storage-migrate-title"
              className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full shadow-xl"
            >
              <h3
                id="storage-migrate-title"
                className="font-semibold text-gray-900 dark:text-gray-100 mb-1"
              >
                {t('storage.migrateModalTitle')}
              </h3>

              {isMigrating ? (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                    {detail?.phase === 'scanning' || !total
                      ? t('storage.migrateModalScanning')
                      : detail?.phase === 'avatars'
                        ? t('storage.migrateModalPhaseAvatars')
                        : detail?.phase === 'attachments'
                          ? t('storage.migrateModalPhaseAttachments')
                          : t('storage.migrateModalInProgress')}
                  </p>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-300 ease-out"
                      style={{
                        width: total > 0 ? `${progressPct}%` : '15%',
                        ...(total === 0
                          ? { animation: 'pulse 1.2s ease-in-out infinite' }
                          : {}),
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    {total > 0
                      ? t('storage.migrateModalFilesProgress', { processed, total })
                      : t('storage.migrateModalScanning')}
                    {total > 0 ? ` (${progressPct}%)` : ''}
                  </p>
                  {detail?.currentFile && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-4">
                      {t('storage.migrateModalCurrent')}: {detail.currentFile}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded border border-gray-200 dark:border-gray-600 p-2">
                      <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                        {t('storage.migrateModalAttachments')}
                      </div>
                      <div className="text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div>{t('storage.migrateModalCopied')}: {att.copied}</div>
                        <div>{t('storage.migrateModalSkipped')}: {att.skipped}</div>
                        <div>{t('storage.migrateModalMissing')}: {att.missing}</div>
                        <div>{t('storage.migrateModalFailedCount')}: {att.failed}</div>
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-600 p-2">
                      <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                        {t('storage.migrateModalAvatars')}
                      </div>
                      <div className="text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div>{t('storage.migrateModalCopied')}: {ava.copied}</div>
                        <div>{t('storage.migrateModalSkipped')}: {ava.skipped}</div>
                        <div>{t('storage.migrateModalMissing')}: {ava.missing}</div>
                        <div>{t('storage.migrateModalFailedCount')}: {ava.failed}</div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p
                    className={`text-sm font-medium mb-1 ${
                      migrateProgress?.ok
                        ? migrateProgress.warning
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-green-700 dark:text-green-300'
                        : 'text-red-700 dark:text-red-300'
                    }`}
                  >
                    {migrateProgress?.ok
                      ? migrateProgress.warning
                        ? t('storage.migrateModalStatusWarnings')
                        : t('storage.migrateModalStatusCompleted')
                      : t('storage.migrateModalStatusFailed')}
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap mb-4">
                    {migrateResultMessage}
                  </p>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                    {t('storage.migrateModalSummary')}
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                    <div className="rounded border border-gray-200 dark:border-gray-600 p-2">
                      <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                        {t('storage.migrateModalAttachments')}
                      </div>
                      <div className="text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div>{t('storage.migrateModalCopied')}: {att.copied}</div>
                        <div>{t('storage.migrateModalSkipped')}: {att.skipped}</div>
                        <div>{t('storage.migrateModalMissing')}: {att.missing}</div>
                        <div>{t('storage.migrateModalFailedCount')}: {att.failed}</div>
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-600 p-2">
                      <div className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                        {t('storage.migrateModalAvatars')}
                      </div>
                      <div className="text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div>{t('storage.migrateModalCopied')}: {ava.copied}</div>
                        <div>{t('storage.migrateModalSkipped')}: {ava.skipped}</div>
                        <div>{t('storage.migrateModalMissing')}: {ava.missing}</div>
                        <div>{t('storage.migrateModalFailedCount')}: {ava.failed}</div>
                      </div>
                    </div>
                  </div>
                  {issueLines.length > 0 && (
                    <div className="mb-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
                      <div className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
                        {missingCount > 0
                          ? t('storage.migrateModalMissingExplain', { count: missingCount })
                          : t('storage.migrateModalErrors')}
                      </div>
                      <ul className="text-xs text-amber-900 dark:text-amber-100 max-h-40 overflow-auto space-y-1 list-disc pl-4">
                        {issueLines.map((err) => (
                          <li key={err} className="break-all">
                            {err}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
                      onClick={closeMigrateModal}
                    >
                      {t('storage.close')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}

      {showCompareModal &&
        compareResult &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeCompareModal();
            }}
          >
            <div
              role="dialog"
              aria-modal
              aria-labelledby="storage-compare-title"
              className="bg-white dark:bg-gray-800 rounded-lg p-5 max-w-xl w-full shadow-xl max-h-[85vh] overflow-y-auto"
            >
              <h3
                id="storage-compare-title"
                className="font-semibold text-gray-900 dark:text-gray-100 mb-1"
              >
                {t('storage.compareModalTitle')}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {t('storage.compareScanned', {
                  count: compareResult.totals?.scanned ?? 0,
                })}
                {compareResult.bucket
                  ? ` · ${compareResult.bucket}${
                      compareResult.prefix ? ` / ${compareResult.prefix}` : ''
                    }`
                  : ''}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs mb-3">
                {(
                  [
                    ['both', 'compareBoth', 'compareBothHint', compareResult.totals?.both, 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/20'],
                    ['diskOnly', 'compareDiskOnly', 'compareDiskOnlyHint', compareResult.totals?.diskOnly, 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20'],
                    ['s3Only', 'compareS3Only', 'compareS3OnlyHint', compareResult.totals?.s3Only, 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20'],
                    ['missing', 'compareMissingBoth', 'compareMissingBothHint', compareResult.totals?.missing, 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20'],
                  ] as const
                ).map(([key, labelKey, hintKey, count, toneClass]) => (
                  <div
                    key={key}
                    className={`rounded-md border px-2 py-2 ${toneClass}`}
                  >
                    <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {count ?? 0}
                    </div>
                    <div className="font-medium text-gray-800 dark:text-gray-200">
                      {t(`storage.${labelKey}`)}
                    </div>
                    <div className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 mt-0.5">
                      {t(`storage.${hintKey}`)}
                    </div>
                  </div>
                ))}
              </div>

              {(compareResult.totals?.diskOnly || 0) +
                (compareResult.totals?.s3Only || 0) +
                (compareResult.totals?.missing || 0) ===
              0 ? (
                <p className="text-sm text-green-700 dark:text-green-400 mb-3">
                  {t('storage.compareInSync')}
                </p>
              ) : (
                <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
                  {t('storage.compareAttention', {
                    count:
                      (compareResult.totals?.diskOnly || 0) +
                      (compareResult.totals?.s3Only || 0) +
                      (compareResult.totals?.missing || 0),
                  })}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                {(
                  [
                    ['attachments', compareResult.attachments],
                    ['avatars', compareResult.avatars],
                  ] as const
                ).map(([label, bucket]) => (
                  <div
                    key={label}
                    className="rounded border border-gray-200 dark:border-gray-600 p-2"
                  >
                    <div className="font-medium text-gray-800 dark:text-gray-200 mb-1 capitalize">
                      {label === 'attachments'
                        ? t('storage.migrateModalAttachments')
                        : t('storage.migrateModalAvatars')}
                    </div>
                    <div className="text-gray-600 dark:text-gray-400 space-y-0.5">
                      <div>
                        {t('storage.compareBoth')}: {bucket?.both ?? 0}
                      </div>
                      <div>
                        {t('storage.compareDiskOnly')}: {bucket?.diskOnly ?? 0}
                      </div>
                      <div>
                        {t('storage.compareS3Only')}: {bucket?.s3Only ?? 0}
                      </div>
                      <div>
                        {t('storage.compareMissingBoth')}: {bucket?.missing ?? 0}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {(['diskOnly', 's3Only', 'missing'] as const).map((kind) => {
                const items = [
                  ...(compareResult.attachments?.items?.[kind] || []),
                  ...(compareResult.avatars?.items?.[kind] || []),
                ];
                if (!items.length) return null;
                const labelKey =
                  kind === 'diskOnly'
                    ? 'compareDiskOnly'
                    : kind === 's3Only'
                      ? 'compareS3Only'
                      : 'compareMissingBoth';
                return (
                  <div key={kind} className="mb-3">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-1">
                      {t(`storage.${labelKey}`)} — {t('storage.compareDetails')} ({items.length})
                    </div>
                    <ul className="text-xs text-gray-600 dark:text-gray-400 max-h-48 overflow-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-md">
                      {items.map((item) => (
                        <li key={item.path} className="px-2 py-1.5 break-all">
                          {item.users?.length ? (
                            <div className="space-y-0.5">
                              {item.users.map((u) => (
                                <div key={u.id}>
                                  <span className="font-medium text-gray-800 dark:text-gray-200">
                                    {u.email || u.name}
                                  </span>
                                  {u.name && u.email && u.name !== u.email ? (
                                    <span className="text-gray-500 dark:text-gray-400">
                                      {' '}
                                      ({u.name})
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                              <div className="text-gray-500 dark:text-gray-400">{item.path}</div>
                            </div>
                          ) : item.tasks?.length ? (
                            <div className="space-y-0.5">
                              {item.tasks.map((task) => (
                                <div key={task.id}>
                                  <a
                                    href={`/task/#${encodeURIComponent(task.ticket || task.id)}`}
                                    className="font-medium text-blue-700 dark:text-blue-300 hover:underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {task.ticket || task.id}
                                  </a>
                                  {task.title ? (
                                    <span className="text-gray-500 dark:text-gray-400">
                                      {' '}
                                      — {task.title}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                              <div className="text-gray-500 dark:text-gray-400">{item.path}</div>
                            </div>
                          ) : item.path.startsWith('avatars/') ? (
                            <div>
                              <div className="text-gray-500 dark:text-gray-400 italic">
                                {t('storage.compareOrphanFile')}
                              </div>
                              <div>{item.path}</div>
                            </div>
                          ) : item.path.startsWith('attachments/') ? (
                            <div>
                              <div className="text-gray-500 dark:text-gray-400 italic">
                                {t('storage.compareOrphanAttachment')}
                              </div>
                              <div>{item.path}</div>
                            </div>
                          ) : (
                            item.path
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="flex flex-wrap gap-2">
                  {(compareResult.totals?.diskOnly || 0) +
                    (compareResult.totals?.s3Only || 0) +
                    (compareResult.totals?.missing || 0) >
                  0 ? (
                    <>
                      <button
                        type="button"
                        disabled={isMigrating || !canMigrateS3}
                        onClick={() => void handleMigrate('disk-to-s3')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        title={!canMigrateS3 ? t('storage.migrateNeedsCredentials') : undefined}
                      >
                        <HardDrive size={14} aria-hidden />
                        <ArrowRight size={12} aria-hidden />
                        <Cloud size={14} aria-hidden />
                        <span>{t('storage.migrateToS3')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isMigrating || multiTenant || !canMigrateS3}
                        onClick={() => void handleMigrate('s3-to-disk')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white text-sm font-medium rounded-md hover:bg-slate-700 disabled:opacity-50"
                        title={
                          multiTenant
                            ? t('storage.migrateToDiskBlockedMultiTenant')
                            : !canMigrateS3
                              ? t('storage.migrateNeedsCredentials')
                              : undefined
                        }
                      >
                        <Cloud size={14} aria-hidden />
                        <ArrowRight size={12} aria-hidden />
                        <HardDrive size={14} aria-hidden />
                        <span>{t('storage.migrateToDisk')}</span>
                      </button>
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
                  onClick={closeCompareModal}
                >
                  {t('storage.close')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default AdminStorageTab;
