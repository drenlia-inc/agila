import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { X, Pause, Play, Square, Send, Settings2, CheckCircle2, Undo2 } from 'lucide-react';
import { AgentStatusIcon } from './AgentStatusButton';
import type { TaskWorkMap } from '../api';
import type { Comment, TeamMember } from '../types';
import { commentTextToHtml } from '../utils/commentContent';
import { formatToYYYYMMDDHHmmss } from '../utils/dateUtils';
import { AGENT_MEMBER_ID, isAgentIdleStatus } from '../constants/appConstants';
import { isTaskDescriptionEmpty } from '../utils/agentTaskHints';

interface AgentWorkingModalProps {
  taskTitle: string;
  taskDescription?: string;
  work: TaskWorkMap;
  comments?: Comment[];
  members?: TeamMember[];
  onClose: () => void;
  onControl: (control: 'pause' | 'stop' | 'resume' | 'apply') => void | Promise<void>;
  /** Open repo/branch configuration (parent shows shared modal). */
  onOpenConfig?: () => void;
  /** Post a refine comment; optionally restart the agent afterward. */
  onRefine?: (text: string, options: { restart: boolean }) => void | Promise<void>;
  isAdmin?: boolean;
  onUndo?: () => void | Promise<void>;
  busy?: boolean;
  /** Render body only (no portal/backdrop/title chrome) for AgentPanel. */
  embedded?: boolean;
  /** When false, activity is view-only (AI_ENABLED off). */
  aiEnabled?: boolean;
}

const AgentWorkingModal: React.FC<AgentWorkingModalProps> = ({
  taskTitle,
  taskDescription = '',
  work,
  comments = [],
  members = [],
  onClose,
  onControl,
  onOpenConfig,
  onRefine,
  isAdmin = false,
  onUndo,
  busy,
  embedded = false,
  aiEnabled = true,
}) => {
  const { t } = useTranslation('common');
  const rawStatus = String(work.status || '').trim();
  const isIdle = isAgentIdleStatus(rawStatus);
  const status = isIdle ? 'idle' : rawStatus;
  const statusLabel = isIdle
    ? t('agent.statusIdle')
    : t(`agent.status_${status}`, { defaultValue: status });
  const isAutomation = work.agent_mode === 'automation';
  const descriptionEmpty = isTaskDescriptionEmpty(taskDescription);
  const pendingPlan = useMemo(() => {
    const raw = work.automation_pending_plan;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as {
        summary?: unknown;
        operations?: unknown[];
        empty?: boolean;
      };
    } catch {
      return null;
    }
  }, [work.automation_pending_plan]);

  const pendingOpsCount = Array.isArray(pendingPlan?.operations)
    ? pendingPlan.operations.length
    : 0;
  const hasApplyablePlan =
    !!pendingPlan &&
    pendingPlan.empty !== true &&
    pendingOpsCount > 0;

  const contextLost =
    work.automation_context_lost === 'true' ||
    (hasApplyablePlan &&
      work.automation_runner_alive === 'false' &&
      (work.awaiting_apply === 'true' ||
        status === 'waiting' ||
        status === 'failed' ||
        status === 'stopped'));

  const awaitingApply =
    hasApplyablePlan &&
    (work.awaiting_apply === 'true' ||
      contextLost ||
      (isAutomation && status === 'waiting'));
  const log = work.log || '';
  const progress = work.progress;
  const repoUrl = work.repo_url;
  const waitingForSlot = work.waiting_for_slot === 'true' && status === 'queued';
  const prUrl = work.pr_url;
  const agentBranch = work.agent_branch;
  const llmModelOverride = String(work.llm_model || '').trim();

  const actionsAllowed = aiEnabled;
  const canPause = actionsAllowed && (status === 'running' || status === 'queued');
  const canResume =
    actionsAllowed &&
    (contextLost ||
      (!awaitingApply &&
        (isIdle ||
          status === 'paused' ||
          status === 'waiting' ||
          status === 'stopped' ||
          status === 'failed' ||
          status === 'done' ||
          status === 'undone')));
  const canStop =
    actionsAllowed &&
    (status === 'running' ||
      status === 'queued' ||
      status === 'paused' ||
      status === 'waiting');
  const showStartLabel = isIdle;
  const showRestartLabel =
    contextLost ||
    status === 'stopped' ||
    status === 'failed' ||
    status === 'done' ||
    status === 'undone';

  const [refineText, setRefineText] = useState('');
  const [refineBusy, setRefineBusy] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const sortedComments = useMemo(() => {
    return [...(comments || [])]
      .filter((c) => c && c.text)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [comments]);

  const automationPlanSummary =
    typeof pendingPlan?.summary === 'string'
      ? pendingPlan.summary
      : typeof work.automation_plan_summary === 'string' &&
          work.automation_plan_summary.trim()
        ? work.automation_plan_summary.trim()
        : null;

  const undoSummary =
    typeof work.automation_undo_summary === 'string' && work.automation_undo_summary.trim()
      ? work.automation_undo_summary.trim()
      : null;

  const undoableFlag = String(work.automation_undoable || '');
  // Prefer explicit flag; allow legacy Applied jobs (pre-flag) while status is still done
  const showUndo =
    actionsAllowed &&
    isAdmin &&
    isAutomation &&
    !!onUndo &&
    (undoableFlag === 'true' ||
      (undoableFlag === '' &&
        !work.automation_undone_at &&
        status === 'done'));

  useLayoutEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sortedComments.length, status]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const memberName = (authorId: string) => {
    if (authorId === AGENT_MEMBER_ID) return t('agent.agentAuthor', { defaultValue: 'Agent' });
    return members.find((m) => m.id === authorId)?.name || t('agent.unknownAuthor', { defaultValue: 'User' });
  };

  const submitRefine = async (restart: boolean) => {
    const text = refineText.trim();
    if (!text || !onRefine || refineBusy || busy) return;
    if (restart && descriptionEmpty) return;
    setRefineBusy(true);
    try {
      await onRefine(text, { restart });
      setRefineText('');
    } catch (err) {
      console.error('Refine comment failed:', err);
    } finally {
      setRefineBusy(false);
    }
  };

  const panel = (
    <div
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      className={
        embedded
          ? 'flex-1 min-h-0 flex flex-col'
          : 'w-full max-w-5xl h-[min(80vh,720px)] flex flex-col rounded-lg bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700'
      }
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header — standalone modal only (AgentPanel provides chrome when embedded) */}
      {!embedded && (
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">
              {t('agent.workingTitle')}
            </h3>
            <p className="text-xs text-gray-500 truncate">{taskTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X size={20} />
          </button>
        </div>
      )}

      {/* Status + controls */}
      <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <AgentStatusIcon
            status={isIdle ? 'idle' : status}
            size={14}
          />
          {t('agent.status')}: <strong>{statusLabel}</strong>
        </span>
        {waitingForSlot && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {t('agent.waitingForSlot')}
          </span>
        )}
        {progress != null && progress !== '' && (
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {t('agent.progress')}: {progress}%
          </span>
        )}
        {agentBranch && (
          <span className="text-xs text-gray-600 dark:text-gray-300 font-mono">{agentBranch}</span>
        )}
        {prUrl && (
          <a
            href={String(prUrl)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            {t('agent.pullRequest')}
          </a>
        )}
        {repoUrl && (
          <a
            href={String(repoUrl).replace(/\.git$/, '')}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:underline truncate max-w-[14rem]"
          >
            {String(repoUrl)}
          </a>
        )}
        {llmModelOverride && (
          <span className="text-xs text-gray-600 dark:text-gray-300 font-mono truncate max-w-[12rem]" title={llmModelOverride}>
            {t('agent.llmModelOverride')}: {llmModelOverride}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5 justify-end">
          {awaitingApply && isAdmin && actionsAllowed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onControl('apply')}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50"
            >
              <CheckCircle2 size={14} /> {t('agent.applyAutomation')}
            </button>
          )}
          {showUndo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onUndo?.()}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              <Undo2 size={12} /> {t('agent.undoAutomation')}
            </button>
          )}
          {onOpenConfig && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenConfig()}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              <Settings2 size={12} /> {t('agent.configuration')}
            </button>
          )}
          {canPause && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onControl('pause')}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-100 text-amber-900 hover:bg-amber-200 disabled:opacity-50"
            >
              <Pause size={12} /> {t('agent.pause')}
            </button>
          )}
          {canResume && (
            <button
              type="button"
              disabled={busy || descriptionEmpty}
              title={descriptionEmpty ? t('agent.descriptionRequired') : undefined}
              onClick={() => onControl('resume')}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-teal-100 text-teal-900 hover:bg-teal-200 disabled:opacity-50"
            >
              <Play size={12} />{' '}
              {showStartLabel
                ? t('agent.start')
                : showRestartLabel
                  ? t('agent.restart')
                  : t('agent.resume')}
            </button>
          )}
          {canStop && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onControl('stop')}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-100 text-red-900 hover:bg-red-200 disabled:opacity-50"
            >
              <Square size={12} /> {t('agent.stop')}
            </button>
          )}
        </div>
      </div>

      {!aiEnabled && (
        <div className="px-4 py-2 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 shrink-0">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
            {t('agent.aiDisabledViewOnly')}
          </p>
        </div>
      )}

      {aiEnabled && descriptionEmpty && (
        <div className="px-4 py-2 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 shrink-0">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
            {t('agent.descriptionRequired')}
            {onOpenConfig ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => onOpenConfig()}
                  className="underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50"
                >
                  {t('agent.configuration')}
                </button>
              </>
            ) : null}
          </p>
        </div>
      )}

      {contextLost && (
        <div className="px-4 py-2 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 shrink-0">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
            {t('agent.automationContextLost')}
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
            {t('agent.automationContextLostHint')}
          </p>
        </div>
      )}

      {awaitingApply && isAdmin && (
        <div className="px-4 py-2 border-b border-teal-100 dark:border-teal-900/40 bg-teal-50 dark:bg-teal-900/20 shrink-0">
          <p className="text-xs font-medium text-teal-900 dark:text-teal-100 mb-1.5">
            {t('agent.automationAwaitingApply')}
          </p>
          {automationPlanSummary && (
            <pre className="text-xs font-mono whitespace-pre-wrap text-teal-950 dark:text-teal-50 bg-white/70 dark:bg-gray-900/50 border border-teal-200 dark:border-teal-800 rounded-md p-2.5 m-0 max-h-40 overflow-auto">
              {automationPlanSummary}
            </pre>
          )}
        </div>
      )}

      {status === 'waiting' && !contextLost && (
        <div className="px-4 py-1.5 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-900 dark:text-amber-100 shrink-0">
          {isAutomation && (awaitingApply || work.awaiting_apply === 'true')
            ? t('agent.automationWaitingApplyHint')
            : t('agent.waitingHint')}
        </div>
      )}

      {status === 'undone' && (
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 shrink-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100">
            {t('agent.automationUndoneBanner')}
          </p>
          {undoSummary && (
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{undoSummary}</p>
          )}
        </div>
      )}

      {/* Main: log | conversation */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-0 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 shrink-0">
            {t('agent.runnerLog')}
          </div>
          <pre
            ref={logRef}
            className="flex-1 overflow-auto text-xs font-mono whitespace-pre-wrap text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 p-3 m-0"
          >
            {log || t('agent.noLogYet')}
          </pre>
        </div>

        <div className="flex flex-col min-h-0">
          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 shrink-0">
            {t('agent.conversation')}
          </div>
          <div ref={conversationRef} className="flex-1 overflow-auto px-3 py-2 space-y-3">
            {sortedComments.length === 0 ? (
              <p className="text-xs text-gray-500">{t('agent.noCommentsYet')}</p>
            ) : (
              sortedComments.map((c) => {
                const isAgent = c.authorId === AGENT_MEMBER_ID;
                const html = DOMPurify.sanitize(commentTextToHtml(c.text));
                return (
                  <div
                    key={c.id}
                    className={`rounded-md px-2.5 py-2 text-xs ${
                      isAgent
                        ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-800'
                        : 'bg-gray-50 dark:bg-gray-900/60 border border-gray-100 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        {memberName(c.authorId)}
                      </span>
                      <span>{formatToYYYYMMDDHHmmss(c.createdAt)}</span>
                    </div>
                    <div
                      className="comment-md text-gray-800 dark:text-gray-100 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Refine composer */}
      {actionsAllowed && onRefine ? (
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-2.5 bg-gray-50/80 dark:bg-gray-900/40">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
          {t('agent.refineLabel')}
        </label>
        <textarea
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          rows={2}
          placeholder={t('agent.refinePlaceholder')}
          disabled={!onRefine || refineBusy || busy}
          className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submitRefine(true);
            }
          }}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 justify-end">
          <span className="mr-auto text-[11px] text-gray-400 hidden sm:inline">
            {t('agent.refineHint')}
          </span>
          <button
            type="button"
            disabled={!refineText.trim() || !onRefine || refineBusy || busy}
            onClick={() => void submitRefine(false)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Send size={12} /> {t('agent.refineSend')}
          </button>
          <button
            type="button"
            disabled={
              !refineText.trim() ||
              !onRefine ||
              refineBusy ||
              busy ||
              descriptionEmpty
            }
            title={descriptionEmpty ? t('agent.descriptionRequired') : undefined}
            onClick={() => void submitRefine(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50"
          >
            <Play size={12} /> {t('agent.refineSendAndRestart')}
          </button>
        </div>
      </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return panel;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>{panel}</div>
    </div>,
    document.body
  );
};

export default AgentWorkingModal;
