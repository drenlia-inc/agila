import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Settings2, MessageSquare, Code2, Rocket, Workflow } from 'lucide-react';
import {
  computeAnchoredPosition,
  type RectLike,
} from '../utils/anchorPosition';
import { probeGithubRepo, getSettings, listAdminAiModels, getAgentLlmInfo, type GithubRepoProbeResult, type AiModelOption } from '../api';
import {
  isTaskDescriptionEmpty,
  looksLikeNonCodingRequest,
} from '../utils/agentTaskHints';
import TextEditor from './TextEditor';
import { TASK_DESCRIPTION_MAX_LENGTH } from '../constants/appConstants';
import { ModernCheckbox } from './ModernCheckbox';
import DOMPurify from 'dompurify';

export type AssignToAgentModalMode = 'assign' | 'configure';
export type AgentJobMode = 'assist' | 'code' | 'automation';
export type AutomationScope = 'this_board' | 'selected' | 'all_boards';

interface AssignToAgentModalProps {
  mode?: AssignToAgentModalMode;
  initialRepoUrl?: string;
  initialRepoBranch?: string;
  initialAgentMode?: AgentJobMode;
  initialAutomationScope?: string;
  initialAutomationBoardIds?: string[];
  boards?: { id: string; title: string }[];
  /** Admin-only per-task model override (empty = tenant default). */
  initialLlmModel?: string;
  /** Task title/description for empty-description hard stop + soft code warning. */
  taskTitle?: string;
  taskDescription?: string;
  /** Show LLM model override (admins only). */
  isAdmin?: boolean;
  /** When true, show Save & restart (configure mode). */
  canRestart?: boolean;
  /** Configure: never launched yet — use "Save & start" instead of "Save & restart". */
  isFirstStart?: boolean;
  /** Agent is running/queued — save applies on next restart. */
  appliesNextRun?: boolean;
  /** Lock task description editing (agent actively running). */
  descriptionLocked?: boolean;
  /** View-only when tenant AI is disabled. */
  readOnly?: boolean;
  onConfirm: (
    repoUrl: string,
    repoBranch: string,
    options?: {
      restart?: boolean;
      llmModel?: string;
      launch?: boolean;
      agentMode?: AgentJobMode;
      automationScope?: AutomationScope;
      automationBoardIds?: string[];
      description?: string;
    }
  ) => void | Promise<void>;
  onCancel: () => void;
  /** When set, panel is positioned near this rect instead of viewport-centered. */
  anchorRect?: RectLike | null;
  /** Body-only render for AgentPanel (no portal / title chrome). */
  embedded?: boolean;
}

type ProbeUiState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'connected'; defaultBranch?: string }
  | { kind: 'failed'; message: string }
  | { kind: 'no_pat' };

const AssignToAgentModal: React.FC<AssignToAgentModalProps> = ({
  mode = 'assign',
  initialRepoUrl = '',
  initialRepoBranch = '',
  initialAgentMode,
  initialAutomationScope = '',
  initialAutomationBoardIds = [],
  boards = [],
  initialLlmModel = '',
  taskTitle = '',
  taskDescription = '',
  isAdmin = false,
  canRestart = false,
  isFirstStart = false,
  appliesNextRun = false,
  descriptionLocked = false,
  readOnly = false,
  onConfirm,
  onCancel,
  anchorRect,
  embedded = false,
}) => {
  const { t } = useTranslation('common');
  const isConfigure = mode === 'configure';
  const parseAutomationScope = (value: string): AutomationScope => {
    const trimmed = value.trim();
    if (trimmed === 'selected' || trimmed === 'all_boards') return trimmed;
    return 'this_board';
  };
  const [jobMode, setJobMode] = useState<AgentJobMode>(() => {
    if (initialAgentMode === 'automation') return 'automation';
    if (initialRepoUrl.trim()) return 'code';
    return 'assist';
  });
  const [automationScope, setAutomationScope] = useState<AutomationScope>(() =>
    parseAutomationScope(initialAutomationScope)
  );
  const [automationBoardIds, setAutomationBoardIds] = useState<string[]>(
    () => [...initialAutomationBoardIds]
  );
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [repoBranch, setRepoBranch] = useState(initialRepoBranch);
  const [llmModel, setLlmModel] = useState(initialLlmModel);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [tenantDefaultModel, setTenantDefaultModel] = useState('');
  const [aiModels, setAiModels] = useState<AiModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [probeState, setProbeState] = useState<ProbeUiState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const fieldsDisabled = readOnly || busy;
  /** Which footer action is in flight (for button labels). */
  const [busyAction, setBusyAction] = useState<
    'assign' | 'launch' | 'save' | 'restart' | 'clear' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [softWarnDismissed, setSoftWarnDismissed] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(taskDescription);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const probeSeq = useRef(0);

  useEffect(() => {
    setDescriptionDraft(taskDescription);
  }, [taskDescription]);

  const descriptionEmpty = useMemo(
    () => isTaskDescriptionEmpty(descriptionDraft),
    [descriptionDraft]
  );

  const showNonCodingSoftWarn = useMemo(() => {
    if (jobMode !== 'code' || softWarnDismissed) return false;
    return looksLikeNonCodingRequest(taskTitle, descriptionDraft);
  }, [jobMode, softWarnDismissed, taskTitle, descriptionDraft]);

  const canEditDescription = !descriptionLocked && !readOnly;

  const sortedBranches = useMemo(() => {
    const defaultBranch =
      probeState.kind === 'connected' ? probeState.defaultBranch : undefined;
    const unique = [...new Set(branches.filter(Boolean))];
    unique.sort((a, b) => {
      if (defaultBranch && a === defaultBranch) return -1;
      if (defaultBranch && b === defaultBranch) return 1;
      return a.localeCompare(b);
    });
    return unique;
  }, [branches, probeState]);

  // Position once from the anchor using a stable height budget so Assist ↔ Code
  // toggles don't flip the panel above/below the card.
  useLayoutEffect(() => {
    if (!anchorRect) {
      setPos(null);
      return;
    }
    const width = panelRef.current?.getBoundingClientRect().width || 576;
    setPos(
      computeAnchoredPosition(anchorRect, {
        width,
        // Budget for code fields + soft warn; content scrolls inside the panel if taller
        height: 640,
      })
    );
  }, [anchorRect]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        // Everyone can see the tenant default model name (read-only for non-admins)
        const llmInfo = await getAgentLlmInfo().catch(() => ({ tenantModel: '' }));
        if (cancelled) return;
        setTenantDefaultModel(String(llmInfo?.tenantModel || '').trim());

        if (!isAdmin) {
          setAiModels([]);
          return;
        }

        const [settings, listed] = await Promise.all([
          getSettings().catch(() => null),
          listAdminAiModels().catch((err: any) => ({
            ok: false as const,
            error:
              err?.response?.data?.error ||
              err?.message ||
              'Failed to list models',
          })),
        ]);
        if (cancelled) return;
        const fromSettings = String(settings?.AI_MODEL || '').trim();
        if (fromSettings) setTenantDefaultModel(fromSettings);

        if (listed && 'ok' in listed && listed.ok && Array.isArray(listed.models)) {
          setAiModels(listed.models);
          const initial = String(initialLlmModel || '').trim();
          if (initial && !listed.models.some((m) => m.id === initial)) {
            setUseCustomModel(true);
          }
        } else {
          setAiModels([]);
          if (String(initialLlmModel || '').trim()) {
            setUseCustomModel(true);
          }
          if (listed && 'error' in listed && listed.error) {
            setModelsError(String(listed.error));
          }
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, initialLlmModel]);

  const effectiveDisplayModel =
    (llmModel || initialLlmModel || '').trim() || tenantDefaultModel;

  const selectJobMode = (next: AgentJobMode) => {
    setJobMode(next);
    setError(null);
    setSoftWarnDismissed(false);
    if (next === 'assist' || next === 'automation') {
      setRepoUrl('');
      setRepoBranch('');
      setBranches([]);
      setProbeState({ kind: 'idle' });
    }
    if (next === 'automation') {
      setAutomationScope('this_board');
    }
  };

  const toggleAutomationBoard = (boardId: string) => {
    setAutomationBoardIds((prev) =>
      prev.includes(boardId) ? prev.filter((id) => id !== boardId) : [...prev, boardId]
    );
  };

  const runProbe = async (url: string, opts?: { force?: boolean }) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setProbeState({ kind: 'idle' });
      setBranches([]);
      return;
    }

    const seq = ++probeSeq.current;
    setProbeState({ kind: 'checking' });
    try {
      const result: GithubRepoProbeResult = await probeGithubRepo(trimmed);
      if (seq !== probeSeq.current) return;

      if (result.reason === 'no_pat') {
        setProbeState({ kind: 'no_pat' });
        setBranches([]);
        return;
      }

      if (!result.ok) {
        setProbeState({
          kind: 'failed',
          message: result.error || t('agent.probeFailed'),
        });
        setBranches([]);
        return;
      }

      const list = result.branches || [];
      setBranches(list);
      setProbeState({
        kind: 'connected',
        defaultBranch: result.defaultBranch,
      });
      setRepoBranch((prev) => {
        if (prev.trim()) return prev;
        return result.defaultBranch || '';
      });
    } catch (err: any) {
      if (seq !== probeSeq.current) return;
      setProbeState({
        kind: 'failed',
        message: err?.response?.data?.error || err?.message || t('agent.probeFailed'),
      });
      if (!opts?.force) {
        setBranches([]);
      }
    }
  };

  useEffect(() => {
    if (jobMode !== 'code') return;
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      setProbeState({ kind: 'idle' });
      setBranches([]);
      return;
    }
    const looksGithub =
      /github\.com/i.test(trimmed) || /^git@github\.com:/i.test(trimmed);
    if (!looksGithub) {
      setProbeState({ kind: 'idle' });
      setBranches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void runProbe(trimmed);
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl, jobMode]);

  const effectiveRepoUrl = jobMode === 'code' ? repoUrl.trim() : '';
  const effectiveRepoBranch = jobMode === 'code' ? repoBranch.trim() : '';
  const codeRepoMissing = jobMode === 'code' && !repoUrl.trim();

  const buildConfirmOptions = (opts: { restart?: boolean; launch?: boolean } = {}) => ({
    restart: opts.restart,
    launch: isConfigure ? undefined : opts.launch,
    agentMode: jobMode,
    description: descriptionDraft,
    ...(isAdmin ? { llmModel: llmModel.trim() } : {}),
    ...(jobMode === 'automation'
      ? {
          automationScope,
          automationBoardIds:
            automationScope === 'selected' ? [...automationBoardIds] : [],
        }
      : {}),
  });

  const handleSubmit = async (
    e: React.FormEvent,
    opts: { restart?: boolean; launch?: boolean } = {}
  ) => {
    e.preventDefault();
    if (readOnly) return;
    setError(null);
    const launch = opts.launch !== false;
    // Launch / configure save require a description; assign-only can omit one
    if ((isConfigure || launch) && descriptionEmpty) {
      setError(t('agent.descriptionRequired'));
      return;
    }
    if (codeRepoMissing) {
      setError(t('agent.repoRequiredForCode'));
      return;
    }
    setBusy(true);
    setBusyAction(
      isConfigure
        ? opts.restart
          ? 'restart'
          : 'save'
        : launch
          ? 'launch'
          : 'assign'
    );
    try {
      await onConfirm(effectiveRepoUrl, effectiveRepoBranch, buildConfirmOptions(opts));
    } catch (err: any) {
      setError(
        err?.message ||
          (isConfigure ? t('agent.configFailed') : t('agent.assignFailed'))
      );
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleClearRepo = async () => {
    selectJobMode('assist');
    setBusy(true);
    setBusyAction('clear');
    setError(null);
    try {
      await onConfirm('', '', {
        restart: false,
        agentMode: 'assist',
        ...(isAdmin ? { llmModel: llmModel.trim() } : {}),
      });
    } catch (err: any) {
      setError(err?.message || t('agent.configFailed'));
      setBusy(false);
      setBusyAction(null);
    }
  };

  const anchored = Boolean(anchorRect) && !embedded;
  const assignOnlyDisabled = busy || codeRepoMissing || readOnly;
  const launchDisabled = busy || descriptionEmpty || codeRepoMissing || readOnly;
  const configureSaveDisabled = busy || codeRepoMissing || readOnly;

  const probeBadge = (() => {
    if (probeState.kind === 'checking') {
      return (
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {t('agent.probeChecking')}
        </span>
      );
    }
    if (probeState.kind === 'connected') {
      return (
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
          {t('agent.probeConnected')}
        </span>
      );
    }
    if (probeState.kind === 'failed') {
      return (
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-red-50 text-red-800 dark:bg-red-900/40 dark:text-red-200"
          title={probeState.message}
        >
          {t('agent.probeFailed')}
        </span>
      );
    }
    return null;
  })();

  const panel = (
    <div
      ref={panelRef}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      className={
        embedded
          ? 'flex-1 min-h-0 flex flex-col bg-white dark:bg-gray-800'
          : 'w-full max-w-xl min-h-[28rem] max-h-[min(90vh,720px)] flex flex-col rounded-lg bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700'
      }
      style={
        anchored && pos
          ? {
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 100011,
              width: 'min(36rem, calc(100vw - 16px))',
            }
          : undefined
      }
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3 shrink-0">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
            {isConfigure && <Settings2 size={18} className="text-gray-500" />}
            {isConfigure ? t('agent.configTitle') : t('agent.assignTitle')}
          </h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => handleSubmit(e, isConfigure ? {} : { launch: true })}
        className="flex flex-col flex-1 min-h-0"
      >
        <div
          className={`px-4 sm:px-6 py-4 flex-1 min-h-0 overflow-y-auto ${
            embedded ? 'space-y-3' : 'space-y-4'
          } ${readOnly ? 'pointer-events-none opacity-80' : ''}`}
        >
        {readOnly && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {t('agent.aiDisabledViewOnly')}
          </div>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {isConfigure ? t('agent.configDescription') : t('agent.assignDescription')}
        </p>

        {!isConfigure && descriptionEmpty && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {t('agent.descriptionRequired')}
          </div>
        )}

        {/* Explicit mode: Assist (default) vs Code vs Automation (admin) */}
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('agent.jobModeLabel')}
          </p>
          <div className={`grid gap-2 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => selectJobMode('assist')}
              className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors ${
                jobMode === 'assist'
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-900/30 ring-1 ring-teal-600'
                  : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                <MessageSquare size={14} />
                {t('agent.jobModeAssist')}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                {t('agent.jobModeAssistHint')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => selectJobMode('code')}
              className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors ${
                jobMode === 'code'
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-900/30 ring-1 ring-teal-600'
                  : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                <Code2 size={14} />
                {t('agent.jobModeCode')}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                {t('agent.jobModeCodeHint')}
              </span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => selectJobMode('automation')}
                className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors ${
                  jobMode === 'automation'
                    ? 'border-teal-600 bg-teal-50 dark:bg-teal-900/30 ring-1 ring-teal-600'
                    : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                  <Workflow size={14} />
                  {t('agent.jobModeAutomation', 'Automation')}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                  {t('agent.jobModeAutomationHint', 'Preview and apply board automation rules.')}
                </span>
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            {jobMode === 'code'
              ? t('agent.previewCode')
              : jobMode === 'automation'
                ? t('agent.previewAutomation')
                : t('agent.previewAssist')}
          </p>
        </div>

        {isConfigure && appliesNextRun && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t('agent.configAppliesNextRun')}
          </p>
        )}

        {/* Primary settings | mode options — left column self-start so description stays put */}
        <div
          className={
            embedded
              ? 'grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3 items-start'
              : 'space-y-4'
          }
        >
          <div className="space-y-2 self-start w-full">
            {isAdmin ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('agent.llmModelLabel')}
                </label>
                <select
                  value={useCustomModel ? '__custom__' : llmModel}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setUseCustomModel(false);
                      setLlmModel('');
                      return;
                    }
                    if (v === '__custom__') {
                      setUseCustomModel(true);
                      return;
                    }
                    setUseCustomModel(false);
                    setLlmModel(v);
                  }}
                  disabled={busy || modelsLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                >
                  <option value="">
                    {tenantDefaultModel
                      ? t('agent.llmModelDefaultNamed', { model: tenantDefaultModel })
                      : t('agent.llmModelDefault')}
                  </option>
                  {aiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                    </option>
                  ))}
                  <option value="__custom__">{t('agent.llmModelCustom')}</option>
                </select>
                {useCustomModel && (
                  <input
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder={t('agent.llmModelCustomPlaceholder')}
                    className="mt-2 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                )}
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {t('agent.llmModelHint')}
                </p>
                {modelsLoading && (
                  <p className="mt-1 text-[11px] text-gray-500">{t('agent.llmModelLoading')}</p>
                )}
                {modelsError && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{modelsError}</p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t('agent.llmModelLabelReadonly')}
                </label>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={
                    modelsLoading
                      ? t('agent.llmModelLoading')
                      : effectiveDisplayModel || t('agent.llmModelUnknown')
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {(llmModel || initialLlmModel || '').trim()
                    ? t('agent.llmModelReadonlyOverrideHint')
                    : t('agent.llmModelReadonlyDefaultHint')}
                </p>
              </div>
            )}

            {/* Secondary recipe — fixed under model; right column growth does not move it */}
            <div className="space-y-1.5 pt-2 mt-1 border-t border-gray-100 dark:border-gray-700/80">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {t('agent.taskDescriptionLabel')}
                </label>
                {descriptionLocked && (
                  <span className="text-[11px] text-amber-700 dark:text-amber-300">
                    {t('agent.descriptionLockedWhileRunning')}
                  </span>
                )}
              </div>
              {canEditDescription ? (
                <TextEditor
                  key={descriptionLocked ? 'desc-locked' : 'desc-edit'}
                  initialContent={descriptionDraft}
                  onChange={(content) => setDescriptionDraft(content)}
                  onSubmit={async () => {}}
                  showSubmitButtons={false}
                  showAttachments={false}
                  showToolbar={true}
                  variant="inline"
                  compact
                  minHeight="96px"
                  placeholder={t('agent.taskDescriptionPlaceholder')}
                  maxLength={TASK_DESCRIPTION_MAX_LENGTH}
                  allowImagePaste={false}
                  allowImageDelete={false}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-md overflow-hidden bg-gray-50/50 dark:bg-gray-900/20"
                />
              ) : (
                <div className="max-h-36 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                  {descriptionEmpty ? (
                    <p className="text-sm text-gray-400 italic m-0">
                      {t('agent.taskDescriptionEmpty')}
                    </p>
                  ) : (
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert text-gray-800 dark:text-gray-100"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(descriptionDraft || ''),
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={`self-start w-full ${embedded ? 'space-y-4' : 'space-y-4'}`}>
        {jobMode === 'automation' && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('agent.automationScopeLabel', 'Automation scope')}
              </p>
              <div className="space-y-2">
                {(
                  [
                    ['this_board', t('agent.automationScopeThisBoard', 'This board only')],
                    ['selected', t('agent.automationScopeSelected', 'Selected boards')],
                    ['all_boards', t('agent.automationScopeAllBoards', 'All boards')],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="automationScope"
                      value={value}
                      checked={automationScope === value}
                      onChange={() => setAutomationScope(value)}
                      disabled={busy}
                      className="text-teal-600 focus:ring-teal-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('agent.automationScopeHint')}
              </p>
            </div>
            {automationScope === 'selected' && (
              <div className="rounded-md border border-gray-200 dark:border-gray-600 p-3 max-h-40 overflow-y-auto space-y-2">
                {boards.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('agent.automationNoBoards', 'No boards available.')}
                  </p>
                ) : (
                  boards.map((board) => (
                    <label
                      key={board.id}
                      className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                    >
                      <ModernCheckbox
                        checked={automationBoardIds.includes(board.id)}
                        onChange={() => toggleAutomationBoard(board.id)}
                        disabled={busy}
                        size="sm"
                      />
                      <span className="truncate">{board.title}</span>
                    </label>
                  ))
                )}
              </div>
            )}
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              {t('agent.automationAdminOnlyHint')}
            </div>
          </div>
        )}

        {jobMode === 'code' && (
          <div className="space-y-4">
            {showNonCodingSoftWarn && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-2">
                <p>{t('agent.softWarnNonCoding')}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => selectJobMode('assist')}
                    className="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100/80"
                  >
                    {t('agent.softWarnSwitchAssist')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSoftWarnDismissed(true)}
                    className="px-2 py-1 rounded text-amber-800 dark:text-amber-200 hover:underline"
                  >
                    {t('agent.softWarnKeepCode')}
                  </button>
                </div>
              </div>
            )}
            <div className={embedded ? 'space-y-4' : 'space-y-4'}>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('agent.repoUrl')}
                </label>
                <div className="flex items-center gap-2">
                  {probeBadge}
                  {repoUrl.trim() && (
                    <button
                      type="button"
                      disabled={busy || probeState.kind === 'checking'}
                      onClick={() => void runProbe(repoUrl, { force: true })}
                      className="text-[11px] text-teal-700 dark:text-teal-300 hover:underline disabled:opacity-50"
                    >
                      {t('agent.probeTest')}
                    </button>
                  )}
                </div>
              </div>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('agent.repoCodeHint')}
              </p>
              {probeState.kind === 'failed' && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{probeState.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('agent.repoBranch')}
              </label>
              {sortedBranches.length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={
                      sortedBranches.includes(repoBranch.trim())
                        ? repoBranch.trim()
                        : '__custom__'
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') {
                        if (sortedBranches.includes(repoBranch.trim())) {
                          setRepoBranch('');
                        }
                        return;
                      }
                      setRepoBranch(v);
                    }}
                    disabled={!repoUrl.trim() || busy}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  >
                    {sortedBranches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                        {probeState.kind === 'connected' &&
                        probeState.defaultBranch === b
                          ? ` (${t('agent.branchDefault')})`
                          : ''}
                      </option>
                    ))}
                    <option value="__custom__">{t('agent.branchCustom')}</option>
                  </select>
                  {!sortedBranches.includes(repoBranch.trim()) && (
                    <input
                      type="text"
                      value={repoBranch}
                      onChange={(e) => setRepoBranch(e.target.value)}
                      placeholder={t('agent.branchCustomPlaceholder')}
                      disabled={!repoUrl.trim() || busy}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                    />
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={repoBranch}
                  onChange={(e) => setRepoBranch(e.target.value)}
                  placeholder="main"
                  disabled={!repoUrl.trim()}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                />
              )}
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {branches.length > 0
                  ? t('agent.branchListHint', { count: branches.length })
                  : t('agent.probePatHint')}
              </p>
            </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('agent.agentsMdHint')}</p>
          </div>
        )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-4 sm:px-6 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 bg-white dark:bg-gray-800 rounded-b-lg">
          {readOnly ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              {embedded ? t('agent.backToActivity') : t('buttons.cancel')}
            </button>
          ) : (
          <>
          {isConfigure && (initialRepoUrl || jobMode === 'code') && (
            <button
              type="button"
              onClick={() => void handleClearRepo()}
              disabled={fieldsDisabled}
              className="mr-auto px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md disabled:opacity-50"
            >
              {t('agent.configClearRepo')}
            </button>
          )}
          {!embedded && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              {t('buttons.cancel')}
            </button>
          )}
          {embedded && !isConfigure && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
            >
              {t('buttons.cancel')}
            </button>
          )}
          {isConfigure && canRestart && (
            <button
              type="button"
              disabled={configureSaveDisabled}
              onClick={(e) =>
                handleSubmit(e as unknown as React.FormEvent, { restart: true })
              }
              className="px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/40 dark:text-teal-200 rounded-md disabled:opacity-50"
            >
              {busyAction === 'restart'
                ? t('agent.configSaving')
                : isFirstStart
                  ? t('agent.configSaveAndStart')
                  : t('agent.configSaveAndRestart')}
            </button>
          )}
          {isConfigure ? (
            <button
              type="submit"
              disabled={configureSaveDisabled}
              className="px-3 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md disabled:opacity-50"
            >
              {busyAction === 'save'
                ? t('agent.configSaving')
                : t('agent.configSave')}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={assignOnlyDisabled}
                onClick={(e) =>
                  handleSubmit(e as unknown as React.FormEvent, { launch: false })
                }
                className="px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/40 dark:text-teal-200 rounded-md disabled:opacity-50"
              >
                {busyAction === 'assign'
                  ? t('agent.assignSaving')
                  : t('agent.assignOnly')}
              </button>
              <button
                type="submit"
                disabled={launchDisabled}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md disabled:opacity-50"
                title={
                  descriptionEmpty ? t('agent.descriptionRequired') : undefined
                }
              >
                {busyAction !== 'launch' && (
                  <Rocket size={14} className="shrink-0" aria-hidden />
                )}
                {busyAction === 'launch'
                  ? t('agent.assigning')
                  : t('agent.assignConfirm')}
              </button>
            </>
          )}
          </>
          )}
        </div>
      </form>
    </div>
  );

  if (embedded) {
    return panel;
  }

  return createPortal(
    <div
      className={
        anchored
          ? 'fixed inset-0 z-[100010] bg-black/25'
          : 'fixed inset-0 z-[100010] flex items-start justify-center bg-black/40 p-4 pt-[max(1.5rem,8vh)]'
      }
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {anchored ? panel : <div onClick={(e) => e.stopPropagation()}>{panel}</div>}
    </div>,
    document.body
  );
};

export default AssignToAgentModal;
