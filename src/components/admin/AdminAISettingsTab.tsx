import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import api from '../../api';
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset,
  isAiBaseUrlDirty,
  isSuggestedOrEmptyBaseUrl,
} from '../../constants/aiProviders';
import { isMaskedApiKeyDisplay, maskApiKey } from '../../utils/maskSecret';
import {
  ADMIN_NUMERIC_INPUT_CLASS,
  AI_MAX_CONCURRENT,
  clampIntToString,
  parseOptionalInt,
} from '../../utils/adminFieldLimits';
import { useSettings } from '../../contexts/SettingsContext';
import { toast } from '../../utils/toast';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import { adminFieldClass, adminFocusToEditFieldClass } from './AdminSection';

interface AdminAISettingsTabProps {
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  /** Patch saved + draft together so the Admin unsaved banner clears after AI save. */
  onApplySettingsPatch?: (patch: Record<string, string | undefined>) => void;
  onAutoSave: (key: string, value: string) => Promise<void>;
  onLocalDirtyChange?: (dirty: boolean) => void;
  /** Register a save callback for the Admin header / leave-dialog Save. */
  onRegisterLocalSave?: (save: (() => Promise<void>) | null) => void;
  discardNonce?: number;
}

interface AiModelOption {
  id: string;
  name?: string;
}

const CUSTOM_MODEL = '__custom__';

function isEnabled(value: string | undefined): boolean {
  return value === 'true';
}

function initialBaseUrl(settings: { [key: string]: string | undefined }): string {
  const saved = (settings.AI_API_BASE_URL || '').trim();
  if (saved) return saved;
  return getAiProviderPreset(settings.AI_PROVIDER || 'openai').suggestedBaseUrl;
}

const AdminAISettingsTab: React.FC<AdminAISettingsTabProps> = ({
  editingSettings,
  onSettingsChange,
  onApplySettingsPatch,
  onLocalDirtyChange,
  onRegisterLocalSave,
  discardNonce = 0,
}) => {
  const { t } = useTranslation('admin');
  const { updateSiteSetting } = useSettings();
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingAgentName, setSavingAgentName] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(editingSettings.AI_API_KEY || '');
  const [runnerTokenDraft, setRunnerTokenDraft] = useState(
    editingSettings.AI_RUNNER_TOKEN || ''
  );
  const [agentName, setAgentName] = useState(editingSettings.AI_AGENT_NAME || 'Agent');
  const [provider, setProvider] = useState(editingSettings.AI_PROVIDER || 'openai');
  const [baseUrl, setBaseUrl] = useState(() => initialBaseUrl(editingSettings));
  const [model, setModel] = useState(editingSettings.AI_MODEL || '');
  const [maxConcurrent, setMaxConcurrent] = useState(
    editingSettings.AI_MAX_CONCURRENT || '1'
  );
  const [runnerUrl, setRunnerUrl] = useState(
    editingSettings.AI_RUNNER_URL || 'http://agila-runner:8080'
  );
  const [modelMode, setModelMode] = useState<'list' | 'custom'>('custom');
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationOk, setValidationOk] = useState<string | null>(null);
  const [testingRunner, setTestingRunner] = useState(false);
  /** Unlock credential-adjacent fields only after user focus (blocks browser autofill). */
  const [baseUrlEditable, setBaseUrlEditable] = useState(false);
  const [apiKeyEditable, setApiKeyEditable] = useState(false);

  const selectedPreset = useMemo(() => getAiProviderPreset(provider), [provider]);
  const savedKeyMask = editingSettings.AI_API_KEY || '';
  const savedRunnerTokenMask = editingSettings.AI_RUNNER_TOKEN || '';

  const hydrateFromEditing = () => {
    setAgentName(editingSettings.AI_AGENT_NAME || 'Agent');
    setProvider(editingSettings.AI_PROVIDER || 'openai');
    setBaseUrl(initialBaseUrl(editingSettings));
    setModel(editingSettings.AI_MODEL || '');
    setApiKeyDraft(editingSettings.AI_API_KEY || '');
    setMaxConcurrent(editingSettings.AI_MAX_CONCURRENT || '1');
    setRunnerUrl(editingSettings.AI_RUNNER_URL || 'http://agila-runner:8080');
    setRunnerTokenDraft(editingSettings.AI_RUNNER_TOKEN || '');
    setBaseUrlEditable(false);
    setApiKeyEditable(false);
    setValidationError(null);
    setValidationOk(null);
  };

  useEffect(() => {
    setAgentName(editingSettings.AI_AGENT_NAME || 'Agent');
  }, [editingSettings.AI_AGENT_NAME]);

  useEffect(() => {
    setProvider(editingSettings.AI_PROVIDER || 'openai');
    setBaseUrl(initialBaseUrl(editingSettings));
    setModel(editingSettings.AI_MODEL || '');
    setApiKeyDraft(editingSettings.AI_API_KEY || '');
    setMaxConcurrent(editingSettings.AI_MAX_CONCURRENT || '1');
    setRunnerUrl(editingSettings.AI_RUNNER_URL || 'http://agila-runner:8080');
    setRunnerTokenDraft(editingSettings.AI_RUNNER_TOKEN || '');
    setBaseUrlEditable(false);
    setApiKeyEditable(false);
  }, [
    editingSettings.AI_PROVIDER,
    editingSettings.AI_API_BASE_URL,
    editingSettings.AI_MODEL,
    editingSettings.AI_API_KEY,
    editingSettings.AI_MAX_CONCURRENT,
    editingSettings.AI_RUNNER_URL,
    editingSettings.AI_RUNNER_TOKEN,
  ]);

  // Discard often leaves editingSettings AI keys unchanged (local-only drafts) — force re-hydrate.
  useEffect(() => {
    if (discardNonce === 0) return;
    hydrateFromEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on discard
  }, [discardNonce]);

  useEffect(() => {
    if (models.length === 0) {
      setModelMode('custom');
      return;
    }
    if (model && models.some((m) => m.id === model)) {
      setModelMode('list');
    } else if (model) {
      setModelMode('custom');
    }
  }, [models, model]);

  const enabled = isEnabled(editingSettings.AI_ENABLED);
  const platformRunnerManaged =
    process.env.MULTI_TENANT === 'true' ||
    editingSettings.AI_RUNNER_PLATFORM_MANAGED === 'true';
  const keySet = editingSettings.AI_API_KEY_SET === 'true' || Boolean(savedKeyMask);
  const runnerTokenSet =
    editingSettings.AI_RUNNER_TOKEN_SET === 'true' || Boolean(savedRunnerTokenMask);
  const trimmedKey = apiKeyDraft.trim();
  const keyReplaced =
    trimmedKey !== '' &&
    trimmedKey !== savedKeyMask &&
    !isMaskedApiKeyDisplay(trimmedKey);
  const trimmedRunnerToken = runnerTokenDraft.trim();
  const runnerTokenReplaced =
    !platformRunnerManaged &&
    trimmedRunnerToken !== '' &&
    trimmedRunnerToken !== savedRunnerTokenMask &&
    !isMaskedApiKeyDisplay(trimmedRunnerToken);

  const savedAgentName = editingSettings.AI_AGENT_NAME || 'Agent';
  const agentNameDirty = (agentName.trim() || 'Agent') !== savedAgentName;

  const configDirty =
    provider !== (editingSettings.AI_PROVIDER || 'openai') ||
    isAiBaseUrlDirty(baseUrl, editingSettings.AI_API_BASE_URL, provider) ||
    model.trim() !== (editingSettings.AI_MODEL || '') ||
    maxConcurrent.trim() !== (editingSettings.AI_MAX_CONCURRENT || '1') ||
    (!platformRunnerManaged &&
      runnerUrl.trim() !==
        (editingSettings.AI_RUNNER_URL || 'http://agila-runner:8080')) ||
    keyReplaced ||
    runnerTokenReplaced;

  useEffect(() => {
    onLocalDirtyChange?.(configDirty || agentNameDirty);
  }, [configDirty, agentNameDirty, onLocalDirtyChange]);

  const applyAiPatch = (patch: Record<string, string | undefined>) => {
    if (onApplySettingsPatch) {
      onApplySettingsPatch(patch);
    } else {
      onSettingsChange({ ...editingSettings, ...patch });
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) updateSiteSetting(key, value);
      }
    }
  };

  const putSetting = async (key: string, value: string) => {
    const { data } = await api.put('/admin/settings', { key, value });
    const isSecret = ['AI_API_KEY', 'AI_RUNNER_TOKEN'].includes(key);
    const publicValue = isSecret ? (data?.value ?? maskApiKey(value)) : value;
    updateSiteSetting(key, publicValue);
    return data as { value?: string };
  };

  const draftPayload = () => ({
    provider,
    baseUrl: baseUrl.trim(),
    // Only send a newly pasted key; masks/empty use the saved secret on the server
    apiKey: keyReplaced ? trimmedKey : undefined,
    model: model.trim(),
  });

  /** Fill suggested endpoint when switching presets; keep a real custom override. */
  const applyProviderChange = (nextId: string) => {
    const next = getAiProviderPreset(nextId);
    setProvider(nextId);
    setModels([]);
    setValidationError(null);
    setValidationOk(null);
    if (isSuggestedOrEmptyBaseUrl(baseUrl) && next.suggestedBaseUrl) {
      setBaseUrl(next.suggestedBaseUrl);
    } else if (!next.suggestedBaseUrl && isSuggestedOrEmptyBaseUrl(baseUrl)) {
      setBaseUrl('');
    }
  };

  const applyAgentName = async () => {
    if (!agentNameDirty || savingAgentName) return;
    setSavingAgentName(true);
    try {
      const name = agentName.trim() || 'Agent';
      await putSetting('AI_AGENT_NAME', name);
      setAgentName(name);
      applyAiPatch({ AI_AGENT_NAME: name });
      toast.success(t('appSettings.aiAgentNameApplied'), '');
    } catch (error: any) {
      console.error('Failed to apply agent name:', error);
      const msg =
        error?.response?.data?.error ||
        error?.message ||
        t('failedToSaveSettings');
      toast.error(String(msg), '');
    } finally {
      setSavingAgentName(false);
    }
  };

  const saveConfiguration = async () => {
    const parsedMax = parseOptionalInt(maxConcurrent);
    if (
      parsedMax === null ||
      parsedMax < AI_MAX_CONCURRENT.min ||
      parsedMax > AI_MAX_CONCURRENT.max
    ) {
      toast.error(
        t('numberOutOfRange', {
          label: t('appSettings.aiMaxConcurrent'),
          min: AI_MAX_CONCURRENT.min,
          max: AI_MAX_CONCURRENT.max,
        }),
        ''
      );
      setMaxConcurrent(
        clampIntToString(
          maxConcurrent,
          AI_MAX_CONCURRENT.min,
          AI_MAX_CONCURRENT.max,
          1
        )
      );
      return;
    }

    setSavingConfig(true);
    setValidationError(null);
    setValidationOk(null);
    try {
      const url = baseUrl.trim();
      const modelVal = model.trim();
      const maxVal = String(parsedMax);
      setMaxConcurrent(maxVal);
      const runnerUrlVal = runnerUrl.trim();
      const baseUrlChanged = isAiBaseUrlDirty(
        url,
        editingSettings.AI_API_BASE_URL,
        provider
      );
      // Only AI keys — never copy unrelated draft settings into the saved baseline
      const patch: Record<string, string | undefined> = {
        AI_PROVIDER: provider,
        AI_API_BASE_URL: baseUrlChanged
          ? url
          : editingSettings.AI_API_BASE_URL || '',
        AI_MODEL: modelVal,
        AI_MAX_CONCURRENT: maxVal,
      };
      if (!platformRunnerManaged) {
        patch.AI_RUNNER_URL = runnerUrlVal;
      }

      if (provider !== (editingSettings.AI_PROVIDER || 'openai')) {
        await putSetting('AI_PROVIDER', provider);
      }
      if (baseUrlChanged) {
        await putSetting('AI_API_BASE_URL', url);
      }
      if (modelVal !== (editingSettings.AI_MODEL || '')) {
        await putSetting('AI_MODEL', modelVal);
      }
      if (maxVal !== (editingSettings.AI_MAX_CONCURRENT || '1')) {
        await putSetting('AI_MAX_CONCURRENT', maxVal);
        setMaxConcurrent(maxVal);
      }
      if (
        !platformRunnerManaged &&
        runnerUrlVal !== (editingSettings.AI_RUNNER_URL || '')
      ) {
        await putSetting('AI_RUNNER_URL', runnerUrlVal);
      }
      if (keyReplaced) {
        const saved = await putSetting('AI_API_KEY', trimmedKey);
        const hint = saved?.value || maskApiKey(trimmedKey);
        setApiKeyDraft(hint);
        patch.AI_API_KEY_SET = 'true';
        patch.AI_API_KEY = hint;
      }
      if (!platformRunnerManaged && runnerTokenReplaced) {
        const saved = await putSetting('AI_RUNNER_TOKEN', trimmedRunnerToken);
        const hint = saved?.value || maskApiKey(trimmedRunnerToken);
        setRunnerTokenDraft(hint);
        patch.AI_RUNNER_TOKEN_SET = 'true';
        patch.AI_RUNNER_TOKEN = hint;
      }
      applyAiPatch(patch);
      toast.success(t('appSettings.aiConfigSaved'), '');
    } catch (error: any) {
      console.error('Failed to save AI configuration:', error);
      const msg =
        error?.response?.data?.error ||
        error?.message ||
        t('failedToSaveSettings');
      toast.error(String(msg), '');
    } finally {
      setSavingConfig(false);
    }
  };

  const saveLocalDraftsRef = useRef<() => Promise<void>>(async () => {});
  saveLocalDraftsRef.current = async () => {
    if (configDirty) {
      await saveConfiguration();
    }
    if (agentNameDirty) {
      await applyAgentName();
    }
  };

  useEffect(() => {
    if (!onRegisterLocalSave) return;
    onRegisterLocalSave(() => saveLocalDraftsRef.current());
    return () => onRegisterLocalSave(null);
  }, [onRegisterLocalSave]);

  const runValidate = async () => {
    const { data } = await api.post('/admin/settings/ai/validate', draftPayload());
    return data as {
      ok: boolean;
      detail?: string;
      error?: string;
      models?: AiModelOption[];
      provider?: string;
    };
  };

  const refreshModels = async () => {
    setLoadingModels(true);
    setValidationError(null);
    try {
      const { data } = await api.post('/admin/settings/ai/models', draftPayload());
      if (!data?.ok) {
        setValidationError(data?.error || t('appSettings.aiModelsFailed'));
        return;
      }
      const list = (data.models || []) as AiModelOption[];
      setModels(list);
      if (list.length > 0) {
        toast.success(t('appSettings.aiModelsLoaded', { count: list.length }), '');
        if (!model && list[0]?.id) {
          setModel(list[0].id);
          setModelMode('list');
        }
      } else {
        toast.success(t('appSettings.aiModelsEmpty'), '');
        setModelMode('custom');
      }
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.message ||
        t('appSettings.aiModelsFailed');
      setValidationError(String(msg));
      toast.error(String(msg), '');
    } finally {
      setLoadingModels(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setValidationError(null);
    setValidationOk(null);
    try {
      const result = await runValidate();
      if (!result.ok) {
        setValidationError(result.error || t('appSettings.aiValidationFailed'));
        toast.error(result.error || t('appSettings.aiValidationFailed'), '');
        return;
      }
      const modelList = Array.isArray(result.models) ? result.models : [];
      const detail =
        modelList.length > 0
          ? t('appSettings.aiValidationOkWithModels', { count: modelList.length })
          : t('appSettings.aiValidationOk');
      setValidationOk(detail);
      toast.success(detail, '');
      if (modelList.length > 0) {
        setModels(modelList);
        if (!model && modelList[0]?.id) {
          setModel(modelList[0].id);
          setModelMode('list');
        }
      } else {
        void refreshModels();
      }
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.message ||
        t('appSettings.aiValidationFailed');
      setValidationError(String(msg));
      toast.error(String(msg), '');
    } finally {
      setTesting(false);
    }
  };

  const testRunner = async () => {
    setTestingRunner(true);
    setValidationError(null);
    setValidationOk(null);
    try {
      const body = platformRunnerManaged
        ? {}
        : {
            runnerUrl: runnerUrl.trim(),
            runnerToken: runnerTokenReplaced ? trimmedRunnerToken : undefined,
          };
      const { data } = await api.post('/admin/settings/ai/runner/probe', body);
      if (!data?.ok) {
        setValidationError(data?.error || t('appSettings.aiRunnerProbeFailed'));
        toast.error(data?.error || t('appSettings.aiRunnerProbeFailed'), '');
        return;
      }
      const running = data.status?.running ?? data.status?.runningJobs ?? '?';
      const maxConcurrent = data.status?.maxConcurrent ?? '?';
      const detail = t('appSettings.aiRunnerProbeOkDetail', {
        running,
        max: maxConcurrent,
      });
      setValidationOk(detail);
      toast.success(detail, '');
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.message ||
        t('appSettings.aiRunnerProbeFailed');
      setValidationError(String(msg));
      toast.error(String(msg), '');
    } finally {
      setTestingRunner(false);
    }
  };

  const toggleEnabled = async () => {
    const previous = editingSettings.AI_ENABLED ?? 'false';
    const turningOn = !isEnabled(previous);
    setSavingEnabled(true);
    setValidationError(null);
    setValidationOk(null);

    try {
      if (turningOn && configDirty) {
        setValidationError(t('appSettings.aiSaveBeforeEnable'));
        toast.error(t('appSettings.aiSaveBeforeEnable'), '');
        return;
      }

      // Server validates provider + runner when enabling — avoid a duplicate FE probe (felt like lag).
      await putSetting('AI_ENABLED', turningOn ? 'true' : 'false');
      applyAiPatch({ AI_ENABLED: turningOn ? 'true' : 'false' });
      toast.success(
        turningOn ? t('appSettings.aiEnabledSuccess') : t('appSettings.aiDisabledSuccess'),
        ''
      );
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.message ||
        t('failedToSaveSettings');
      setValidationError(String(msg));
      applyAiPatch({ AI_ENABLED: previous });
      toast.error(String(msg), '');
    } finally {
      setSavingEnabled(false);
    }
  };

  const modelSelectValue =
    modelMode === 'custom' || !models.some((m) => m.id === model)
      ? CUSTOM_MODEL
      : model;

  const sectionClass =
    'rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 p-4 sm:p-5 space-y-4';

  const savedProvider = editingSettings.AI_PROVIDER || 'openai';
  const savedBaseUrl = editingSettings.AI_API_BASE_URL || '';
  const baseUrlDirty = isAiBaseUrlDirty(baseUrl, savedBaseUrl, provider);
  const savedModel = editingSettings.AI_MODEL || '';
  const savedMaxConcurrent = editingSettings.AI_MAX_CONCURRENT || '1';
  const savedRunnerUrl =
    editingSettings.AI_RUNNER_URL || 'http://agila-runner:8080';

  const aiFieldLabel = (
    label: string,
    dirty: boolean,
    savedValue: string,
    onRevert: () => void,
    hideWas = false
  ) => (
    <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      <span>{label}</span>
      <AdminFieldDraftControls
        dirty={dirty}
        savedValue={savedValue}
        onRevert={onRevert}
        hideWas={hideWas}
      />
    </label>
  );

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Sparkles
            size={18}
            className="text-teal-600 dark:text-teal-400 shrink-0"
            aria-hidden
          />
          {t('appSettings.aiTitle')}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('appSettings.aiDescription')}
        </p>
      </div>

      <div className="px-6 py-5 space-y-5">
        {validationError && (
          <div
            role="alert"
            className="rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-800 dark:text-red-200"
          >
            {validationError}
          </div>
        )}
        {validationOk && !validationError && (
          <div
            role="status"
            className="rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-800 dark:text-green-200"
          >
            {validationOk}
          </div>
        )}

        {/* 1. Enable */}
        <section className={sectionClass} aria-labelledby="ai-section-enable" data-setting-key="AI_ENABLED">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h4
                id="ai-section-enable"
                className="text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                {t('appSettings.aiSectionEnable')}
              </h4>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {t('appSettings.aiSectionEnableHint')}
              </p>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {t('appSettings.aiEnabledDescription')}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {enabled ? t('appSettings.enabled') : t('appSettings.disabled')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={savingEnabled}
                onClick={() => void toggleEnabled()}
                className={`${
                  enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50`}
              >
                <span
                  className={`${
                    enabled ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* 2. Agent identity */}
        <section className={sectionClass} aria-labelledby="ai-section-agent">
          <div>
            <h4
              id="ai-section-agent"
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('appSettings.aiSectionAgent')}
            </h4>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.aiSectionAgentHint')}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('appSettings.aiAgentName')}
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('appSettings.aiAgentNameDescription')}
            </p>
            <div className="flex flex-wrap items-center gap-2 max-w-md">
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && agentNameDirty && !savingAgentName) {
                    e.preventDefault();
                    void applyAgentName();
                  }
                }}
                className={adminFieldClass(false, 'block min-w-0 flex-1 sm:text-sm')}
              />
              <button
                type="button"
                disabled={!agentNameDirty || savingAgentName}
                onClick={() => void applyAgentName()}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingAgentName
                  ? t('appSettings.saving')
                  : t('appSettings.aiAgentNameApply')}
              </button>
            </div>
          </div>
        </section>

        {/* 3. LLM */}
        <section className={`${sectionClass} relative`} aria-labelledby="ai-section-llm">
          <div>
            <h4
              id="ai-section-llm"
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('appSettings.aiSectionLlm')}
            </h4>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.aiSectionLlmHint')}
            </p>
          </div>

          {/* Absorb credential autofill so browsers don't overwrite Base URL with a saved email */}
          <div
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
          >
            <input type="text" name="username" autoComplete="username" tabIndex={-1} />
            <input type="password" name="password" autoComplete="new-password" tabIndex={-1} />
          </div>

          <div data-setting-key="AI_PROVIDER">
            {aiFieldLabel(
              t('appSettings.aiProvider'),
              provider !== savedProvider,
              savedProvider,
              () => applyProviderChange(savedProvider)
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('appSettings.aiProviderDescription')}
            </p>
            <select
              value={provider}
              onChange={(e) => applyProviderChange(e.target.value)}
              className={adminFieldClass(false, 'block w-full max-w-md sm:text-sm')}
            >
              {AI_PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {selectedPreset.hint && (
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                {selectedPreset.hint}
              </p>
            )}
          </div>

          <div data-setting-key="AI_API_BASE_URL">
            {aiFieldLabel(
              t('appSettings.aiApiBaseUrl'),
              baseUrlDirty,
              savedBaseUrl || initialBaseUrl(editingSettings),
              () => setBaseUrl(initialBaseUrl(editingSettings))
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('appSettings.aiApiBaseUrlDescription')}
            </p>
            <input
              type="text"
              name="ai-api-base-url"
              inputMode="url"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              spellCheck={false}
              value={baseUrl}
              readOnly={!baseUrlEditable}
              onChange={(e) => setBaseUrl(e.target.value)}
              onFocus={() => setBaseUrlEditable(true)}
              placeholder={
                selectedPreset.suggestedBaseUrl || 'https://api.openai.com/v1'
              }
              className={adminFocusToEditFieldClass('block w-full max-w-xl sm:text-sm')}
            />
            {selectedPreset.suggestedBaseUrl && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {t('appSettings.aiSuggestedEndpoint')}:{' '}
                <button
                  type="button"
                  className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => setBaseUrl(selectedPreset.suggestedBaseUrl)}
                >
                  {selectedPreset.suggestedBaseUrl}
                </button>
                {baseUrl.trim() !== selectedPreset.suggestedBaseUrl
                  ? ` — ${t('appSettings.aiUseSuggestedUrlShort')}`
                  : ''}
              </p>
            )}
          </div>

          <div data-setting-key="AI_API_KEY">
            {aiFieldLabel(
              t('appSettings.aiApiKey'),
              keyReplaced,
              '',
              () => setApiKeyDraft(savedKeyMask || editingSettings.AI_API_KEY || ''),
              true
            )}
            {selectedPreset && !selectedPreset.apiKeyRequired && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                {t('appSettings.aiApiKeyOptional')}
              </p>
            )}
            <input
              type="password"
              name="ai-api-key"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              spellCheck={false}
              value={apiKeyDraft}
              readOnly={!apiKeyEditable}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onFocus={() => {
                setApiKeyEditable(true);
                if (isMaskedApiKeyDisplay(apiKeyDraft)) {
                  setApiKeyDraft('');
                }
              }}
              placeholder={
                keySet
                  ? t('appSettings.aiApiKeyReplacePlaceholder')
                  : selectedPreset && !selectedPreset.apiKeyRequired
                    ? t('appSettings.aiApiKeyOptionalPlaceholder')
                    : t('appSettings.aiApiKeyPlaceholder')
              }
              className={adminFocusToEditFieldClass('block w-full max-w-xl sm:text-sm font-mono')}
            />
          </div>

          <div data-setting-key="AI_MODEL">
            {aiFieldLabel(
              t('appSettings.aiModel'),
              model.trim() !== savedModel,
              savedModel,
              () => {
                setModel(savedModel);
                setModelMode(
                  models.some((m) => m.id === savedModel) ? 'list' : 'custom'
                );
              }
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('appSettings.aiModelDescription')}
            </p>
            <div className="flex flex-wrap items-center gap-2 max-w-3xl">
              <select
                value={modelSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === CUSTOM_MODEL) {
                    setModelMode('custom');
                    return;
                  }
                  setModelMode('list');
                  setModel(v);
                }}
                className={adminFieldClass(false, 'block min-w-0 flex-1 max-w-md sm:text-sm')}
              >
                <option value={CUSTOM_MODEL}>
                  {t('appSettings.aiModelCustomOption')}
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={loadingModels || testing}
                onClick={() => void refreshModels()}
                className="shrink-0 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {loadingModels
                  ? t('appSettings.aiLoadingModels')
                  : t('appSettings.aiRefreshModels')}
              </button>
              <button
                type="button"
                disabled={testing || savingConfig}
                onClick={() => void testConnection()}
                className="shrink-0 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {testing ? t('appSettings.aiTesting') : t('appSettings.aiTestConnection')}
              </button>
            </div>
            {(modelMode === 'custom' || models.length === 0) && (
              <input
                type="text"
                value={model}
                onChange={(e) => {
                  setModelMode('custom');
                  setModel(e.target.value);
                }}
                placeholder={t('appSettings.aiModelPlaceholder')}
                className={adminFieldClass(false, 'mt-2 block w-full max-w-md sm:text-sm')}
              />
            )}
          </div>
        </section>

        {/* 4. Job limits */}
        <section className={sectionClass} aria-labelledby="ai-section-jobs">
          <div>
            <h4
              id="ai-section-jobs"
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('appSettings.aiSectionJobs')}
            </h4>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.aiSectionJobsHint')}
            </p>
          </div>
          <div data-setting-key="AI_MAX_CONCURRENT">
            {aiFieldLabel(
              t('appSettings.aiMaxConcurrent'),
              maxConcurrent.trim() !== savedMaxConcurrent,
              savedMaxConcurrent,
              () => setMaxConcurrent(savedMaxConcurrent)
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('appSettings.aiMaxConcurrentDescription')}
            </p>
            <input
              type="number"
              inputMode="numeric"
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.target.value)}
              onBlur={() =>
                setMaxConcurrent(
                  clampIntToString(
                    maxConcurrent,
                    AI_MAX_CONCURRENT.min,
                    AI_MAX_CONCURRENT.max,
                    1
                  )
                )
              }
              className={`${adminFieldClass(false, 'block w-24 sm:text-sm')} ${ADMIN_NUMERIC_INPUT_CLASS}`}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('numberRangeHint', {
                min: AI_MAX_CONCURRENT.min,
                max: AI_MAX_CONCURRENT.max,
              })}
            </p>
          </div>
        </section>

        {/* 5. Runner */}
        <section className={sectionClass} aria-labelledby="ai-section-runner">
          <div>
            <h4
              id="ai-section-runner"
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('appSettings.aiSectionRunner')}
            </h4>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.aiSectionRunnerHint')}
            </p>
          </div>

          <div data-setting-key="AI_RUNNER_URL">
            {aiFieldLabel(
              t('appSettings.aiRunnerUrl'),
              !platformRunnerManaged &&
                runnerUrl.trim() !==
                  (editingSettings.AI_RUNNER_URL || 'http://agila-runner:8080'),
              savedRunnerUrl,
              () => setRunnerUrl(savedRunnerUrl)
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {platformRunnerManaged
                ? t('appSettings.aiRunnerPlatformManagedDescription')
                : t('appSettings.aiRunnerUrlDescription')}
            </p>
            <div className="flex flex-wrap items-center gap-2 max-w-3xl">
              <input
                type="url"
                value={runnerUrl}
                onChange={(e) => setRunnerUrl(e.target.value)}
                readOnly={platformRunnerManaged}
                disabled={platformRunnerManaged}
                placeholder="http://agila-runner:8080"
                className={adminFieldClass(platformRunnerManaged, 'block min-w-0 flex-1 max-w-xl sm:text-sm font-mono')}
              />
              <button
                type="button"
                disabled={testingRunner || savingConfig}
                onClick={() => void testRunner()}
                className="shrink-0 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {testingRunner
                  ? t('appSettings.aiTestingRunner')
                  : t('appSettings.aiTestRunner')}
              </button>
            </div>
          </div>

          {!platformRunnerManaged && (
            <div data-setting-key="AI_RUNNER_TOKEN">
              {aiFieldLabel(
                t('appSettings.aiRunnerToken'),
                runnerTokenReplaced,
                '',
                () =>
                  setRunnerTokenDraft(
                    savedRunnerTokenMask || editingSettings.AI_RUNNER_TOKEN || ''
                  ),
                true
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                {t('appSettings.aiRunnerTokenDescription')}
              </p>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={runnerTokenDraft}
                onChange={(e) => setRunnerTokenDraft(e.target.value)}
                placeholder={
                  runnerTokenSet
                    ? t('appSettings.aiApiKeyReplacePlaceholder')
                    : t('appSettings.aiRunnerTokenPlaceholder')
                }
                className={adminFieldClass(false, 'block w-full max-w-xl sm:text-sm font-mono')}
              />
            </div>
          )}

          <div className="rounded-md border border-gray-200 dark:border-gray-600 bg-white/70 dark:bg-gray-800/60 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
            {platformRunnerManaged
              ? t('appSettings.aiRunnerPlatformManagedNote')
              : t('appSettings.aiRunnerNote')}
          </div>
        </section>

        {/* Shared save */}
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <AdminUnsavedHint show={configDirty} />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('appSettings.aiConfigSaveHint')}
            </p>
          </div>
          <button
            type="button"
            disabled={!configDirty || savingConfig}
            onClick={() => void saveConfiguration()}
            className={`shrink-0 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 ${
              configDirty ? 'ring-2 ring-amber-400 ring-offset-2' : ''
            }`}
          >
            {savingConfig ? t('appSettings.saving') : t('appSettings.aiSaveConfiguration')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminAISettingsTab;
