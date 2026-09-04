import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Circle,
  GripHorizontal,
  Minus,
  Play,
  RotateCcw,
  SkipForward,
  X,
} from 'lucide-react';
import { KanbanChromeTooltip } from '../KanbanChromeTooltip';
import { useOwnerSetup } from '../../contexts/OwnerSetupContext';
import { useSettings } from '../../contexts/SettingsContext';
import {
  OWNER_SETUP_STEPS,
  OwnerSetupStepId,
  applyOwnerSetupFieldHighlights,
  constrainOwnerSetupPositionX,
  defaultOwnerSetupPositionX,
  filterOwnerSetupGuideFields,
  isOwnerSetupAtDefaultPosition,
  isStepResolved,
  ownerSetupAdjacentStepId,
  ownerSetupLeftBesideElement,
  ownerSetupTaskStepNumber,
  waitForOwnerSetupNudgeAnchor,
  getEffectiveDisplayStatus,
  getOwnerSetupStepKind,
  isMultiTenantDeploy,
  ownerSetupGuideSelectors,
  ownerSetupProgressStats,
} from '../../utils/ownerSetup';

const EXPANDED_WIDTH = 384; // ~24rem
const MINIMIZED_WIDTH = 320; // ~max-w-sm
const MARGIN = 16;
const GET_STARTED_NUDGE_MS = 1600;
const GET_STARTED_HINT_MS = 5000;
const GET_STARTED_NUDGE_GAP = 16;
const SITE_SETTINGS_CANCEL_SELECTOR = '[data-owner-setup-nudge="site-settings-cancel"]';

/** Same chip look as Admin → Mail Server “Switch to Custom SMTP” (non-interactive in the guide). */
const SwitchToCustomSmtpChip: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { t } = useTranslation('admin');
  return (
    <span
      className={`inline-flex align-middle text-xs bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2.5 py-1 rounded-md select-none whitespace-nowrap ${className}`}
      role="note"
    >
      {t('mail.switchToCustomSMTP')}
    </span>
  );
};

function PreviousStepIconButton({
  onClick,
  variant = 'default',
}: {
  onClick: () => void;
  variant?: 'default' | 'guide';
}) {
  const { t } = useTranslation('common');
  const label = t('ownerSetup.previousStep');
  const className =
    variant === 'guide'
      ? 'inline-flex items-center justify-center h-[30px] w-[30px] rounded-md text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-800/50'
      : 'inline-flex items-center justify-center h-[30px] w-[30px] rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700';
  return (
    <KanbanChromeTooltip label={label} placement="top">
      <button type="button" onClick={onClick} aria-label={label} className={className}>
        <ChevronLeft size={16} aria-hidden />
      </button>
    </KanbanChromeTooltip>
  );
}

const MailMultiTenantDescription: React.FC<{ textClassName: string }> = ({ textClassName }) => (
  <p className={textClassName}>
    <Trans
      i18nKey="ownerSetup.steps.mail.descriptionMultiTenant"
      ns="common"
      components={{
        platform: <strong className="font-semibold text-gray-800 dark:text-gray-100" />,
        smtpButton: <SwitchToCustomSmtpChip className="mx-0.5 relative -top-px" />,
      }}
    />
  </p>
);

const OwnerSetupChecklist: React.FC = () => {
  const { t } = useTranslation('common');
  const {
    isOwner,
    ready,
    progress,
    hints,
    dismissChecklist,
    minimizeChecklist,
    expandChecklist,
    markStep,
    goToStep,
    guideCurrentStep,
    closeGuide,
    startOver,
    beginGuide,
    guidingStepId,
    setPositionX,
    coreComplete,
  } = useOwnerSetup();
  const { siteSettings, systemSettings } = useSettings();

  const guideFieldContext = useMemo(() => {
    const rawMail = (systemSettings?.MAIL_MANAGED ?? siteSettings?.MAIL_MANAGED) as
      | string
      | undefined;
    const rawStorageMode = (systemSettings?.STORAGE_MODE ?? siteSettings?.STORAGE_MODE) as
      | string
      | undefined;
    const rawStorage = (systemSettings?.STORAGE_MANAGED ?? siteSettings?.STORAGE_MANAGED) as
      | string
      | undefined;
    const storageKnown =
      (rawStorageMode !== undefined && rawStorageMode !== '') ||
      (rawStorage !== undefined && rawStorage !== '');
    return {
      multiTenant: isMultiTenantDeploy(),
      mailManaged:
        rawMail === undefined || rawMail === ''
          ? undefined
          : String(rawMail).toLowerCase() === 'true',
      storageManaged: storageKnown
        ? String(rawStorageMode || '').toLowerCase() === 'managed' ||
          (String(rawStorageMode || '').trim() === '' &&
            String(rawStorage || '').toLowerCase() === 'true')
        : undefined,
    };
  }, [
    siteSettings?.MAIL_MANAGED,
    systemSettings?.MAIL_MANAGED,
    siteSettings?.STORAGE_MODE,
    systemSettings?.STORAGE_MODE,
    siteSettings?.STORAGE_MANAGED,
    systemSettings?.STORAGE_MANAGED,
  ]);

  const dragRef = useRef<{
    startClientX: number;
    startLeft: number;
    currentLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [animatePosition, setAnimatePosition] = useState(false);
  const [showMoveHint, setShowMoveHint] = useState(false);
  const moveHintTimersRef = useRef<number[]>([]);
  const moveHintGenerationRef = useRef(0);
  const activeStepIdRef = useRef(progress.activeStepId);
  activeStepIdRef.current = progress.activeStepId;
  /** When true, only the active step is shown (entered via Go there / Guide me). */
  const [stepFocused, setStepFocused] = useState(false);
  /** Prefer the full step list even on intro/outro bookends. */
  const [preferStepList, setPreferStepList] = useState(false);

  // Leave focus / guide only when dismissed — minimize should preserve resume state
  useEffect(() => {
    if (!progress.visible) {
      setStepFocused(false);
      setPreferStepList(false);
      closeGuide();
    }
  }, [progress.visible, closeGuide]);

  // Reset list override when the active step changes
  useEffect(() => {
    setPreferStepList(false);
  }, [progress.activeStepId]);

  // When Guide me opens (or resumes after expand), enter focus mode on that step
  useEffect(() => {
    if (guidingStepId) {
      setStepFocused(true);
    }
  }, [guidingStepId]);

  // Re-apply field highlights after expanding while still guiding
  useEffect(() => {
    if (progress.minimized || !guidingStepId) return;
    const def = OWNER_SETUP_STEPS.find((s) => s.id === guidingStepId);
    const selectors = ownerSetupGuideSelectors(def?.guideFields, guideFieldContext);
    const targets =
      selectors.length > 0
        ? selectors
        : def?.tourTarget
          ? [def.tourTarget]
          : [];
    if (targets.length === 0) return;
    const cancel = applyOwnerSetupFieldHighlights(targets, {
      scrollToTop: Boolean(def?.scrollToTop),
    });
    return cancel;
  }, [progress.minimized, guidingStepId, guideFieldContext]);

  const panelWidth = progress.minimized ? MINIMIZED_WIDTH : EXPANDED_WIDTH;

  const resolvedLeft = useMemo(() => {
    if (typeof dragLeft === 'number') return dragLeft;
    if (typeof progress.positionX === 'number') {
      return constrainOwnerSetupPositionX(progress.positionX, panelWidth, MARGIN);
    }
    return defaultOwnerSetupPositionX(panelWidth, MARGIN);
  }, [dragLeft, progress.positionX, panelWidth]);

  // Keep on-screen when resized or when expand/minimize changes width
  useEffect(() => {
    if (typeof progress.positionX !== 'number') return;
    const constrained = constrainOwnerSetupPositionX(progress.positionX, panelWidth, MARGIN);
    if (constrained !== progress.positionX) {
      setPositionX(constrained);
    }
  }, [panelWidth, progress.positionX, setPositionX]);

  useEffect(() => {
    const onResize = () => {
      if (typeof progress.positionX !== 'number') return;
      const constrained = constrainOwnerSetupPositionX(progress.positionX, panelWidth, MARGIN);
      if (constrained !== progress.positionX) {
        setPositionX(constrained);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelWidth, progress.positionX, setPositionX]);

  const endDrag = useCallback(() => {
    const session = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    setDragLeft(null);
    if (!session) return;
    if (session.moved) {
      suppressClickRef.current = true;
      setPositionX(
        constrainOwnerSetupPositionX(session.currentLeft, panelWidth, MARGIN)
      );
    }
  }, [panelWidth, setPositionX]);

  const onDragMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startClientX;
      if (Math.abs(dx) > 3) dragRef.current.moved = true;
      const next = constrainOwnerSetupPositionX(
        dragRef.current.startLeft + dx,
        panelWidth,
        MARGIN
      );
      dragRef.current.currentLeft = next;
      setDragLeft(next);
    },
    [panelWidth]
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    endDrag();
  }, [endDrag, onDragMove]);

  const clearMoveHintTimers = useCallback(() => {
    for (const id of moveHintTimersRef.current) {
      window.clearTimeout(id);
    }
    moveHintTimersRef.current = [];
  }, []);

  const playGetStartedMoveHint = useCallback(() => {
    clearMoveHintTimers();
    // Only auto-park beside Cancel on step 1 (Site name & URL) — not later steps.
    if (isStepResolved(progress, 'siteIdentity')) {
      return;
    }
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const startHint = () => {
      setShowMoveHint(true);
      if (!reduceMotion) {
        moveHintTimersRef.current.push(
          window.setTimeout(() => setAnimatePosition(false), GET_STARTED_NUDGE_MS)
        );
      }
      moveHintTimersRef.current.push(
        window.setTimeout(() => setShowMoveHint(false), GET_STARTED_HINT_MS)
      );
    };

    const parkedAtDefault = isOwnerSetupAtDefaultPosition(
      progress.positionX,
      resolvedLeft,
      panelWidth,
      MARGIN
    );
    if (!parkedAtDefault) {
      return;
    }

    const generation = ++moveHintGenerationRef.current;
    void (async () => {
      const cancelBtn = await waitForOwnerSetupNudgeAnchor(
        SITE_SETTINGS_CANCEL_SELECTOR,
        4000
      );
      if (generation !== moveHintGenerationRef.current) return;
      if (activeStepIdRef.current !== 'siteIdentity') return;
      const liveLeft = panelRef.current?.getBoundingClientRect().left ?? resolvedLeft;
      if (!isOwnerSetupAtDefaultPosition(progress.positionX, liveLeft, panelWidth, MARGIN)) {
        return;
      }
      if (cancelBtn) {
        const target = ownerSetupLeftBesideElement(
          cancelBtn,
          panelWidth,
          GET_STARTED_NUDGE_GAP,
          MARGIN
        );
        if (target != null && target < liveLeft - 4) {
          if (!reduceMotion) setAnimatePosition(true);
          setPositionX(target);
        }
      }
      if (activeStepIdRef.current === 'siteIdentity') {
        startHint();
      }
    })();
  }, [
    clearMoveHintTimers,
    panelWidth,
    progress,
    resolvedLeft,
    setPositionX,
  ]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select')) return;

      e.preventDefault();
      setAnimatePosition(false);
      setShowMoveHint(false);
      clearMoveHintTimers();
      dragRef.current = {
        startClientX: e.clientX,
        startLeft: resolvedLeft,
        currentLeft: resolvedLeft,
        moved: false,
      };
      setIsDragging(true);
      setDragLeft(resolvedLeft);
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    },
    [clearMoveHintTimers, onDragEnd, onDragMove, resolvedLeft]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
    };
  }, [onDragEnd, onDragMove]);

  useEffect(() => () => clearMoveHintTimers(), [clearMoveHintTimers]);

  const progressStats = useMemo(() => ownerSetupProgressStats(progress), [progress.steps]);

  if (!ready || !isOwner || !progress.visible) {
    return null;
  }

  const positionStyle: React.CSSProperties = {
    left: resolvedLeft,
    right: 'auto',
    bottom: MARGIN,
    width: Math.min(
      panelWidth,
      typeof window !== 'undefined' ? window.innerWidth - MARGIN * 2 : panelWidth
    ),
    transition:
      animatePosition && !isDragging ? `left ${GET_STARTED_NUDGE_MS}ms ease-in-out` : undefined,
  };

  if (progress.minimized) {
    return (
      <div
        className={`fixed z-[9000] max-w-sm ${isDragging ? 'cursor-grabbing select-none' : ''}`}
        style={positionStyle}
      >
        <div
          role="button"
          tabIndex={0}
          onMouseDown={startDrag}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            expandChecklist();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              expandChecklist();
            }
          }}
          className={`w-full flex items-center justify-between gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 shadow-lg px-4 py-3 text-left hover:bg-amber-50 dark:hover:bg-gray-700 transition-colors ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          aria-label={t('ownerSetup.expand')}
          title={t('ownerSetup.dragHint')}
        >
          <GripHorizontal
            size={16}
            className="text-gray-400 flex-shrink-0 pointer-events-none"
            aria-hidden
          />
          <div className="min-w-0 flex-1 pointer-events-none">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {t('ownerSetup.minimizedTitle')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('ownerSetup.progressCount', {
                done: progressStats.done,
                total: progressStats.total,
              })}
              {coreComplete ? ` · ${t('ownerSetup.coreComplete')}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                expandChecklist();
              }}
              className="p-1.5 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-900/30"
              aria-label={t('ownerSetup.expand')}
              title={t('ownerSetup.expand')}
            >
              <ChevronUp size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismissChecklist();
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
              aria-label={t('ownerSetup.dismiss')}
              title={t('ownerSetup.dismiss')}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeId = progress.activeStepId;
  const activeStep = OWNER_SETUP_STEPS.find((s) => s.id === activeId) || OWNER_SETUP_STEPS[0];
  const activeKind = getOwnerSetupStepKind(activeStep);
  const activeDisplay = getEffectiveDisplayStatus(progress, activeId, hints);

  const handleGoThere = () => {
    closeGuide();
    setStepFocused(true);
    goToStep(activeId);
  };

  const handleGuide = () => {
    setStepFocused(true);
    guideCurrentStep();
  };

  const handleMarkDone = () => {
    // Stay focused and jump to the next step's screen
    setStepFocused(true);
    markStep(activeId, 'done');
  };

  const handleSkip = () => {
    setStepFocused(true);
    markStep(activeId, 'skipped');
  };

  const handleGuideDone = () => {
    // Same path as Mark done — complete step + navigate to next screen
    setStepFocused(true);
    markStep(activeId, 'done');
  };

  const handleReset = () => {
    setStepFocused(false);
    closeGuide();
    markStep(activeId, 'todo');
  };

  const handleGetStarted = () => {
    setPreferStepList(false);
    setStepFocused(true);
    beginGuide();
    playGetStartedMoveHint();
  };

  const handleDoItLater = () => {
    minimizeChecklist();
  };

  const handleCloseGuide = () => {
    markStep('finish', 'done');
    dismissChecklist();
  };

  const handleReviewSteps = () => {
    setPreferStepList(true);
    setStepFocused(false);
    closeGuide();
  };

  const handleStartOver = () => {
    setPreferStepList(false);
    setStepFocused(false);
    startOver();
  };

  const handleReopenStep = (stepId: OwnerSetupStepId) => {
    setStepFocused(false);
    closeGuide();
    markStep(stepId, 'todo');
    goToStep(stepId);
  };

  const handleSelectStep = (stepId: OwnerSetupStepId) => {
    const kind = getOwnerSetupStepKind(stepId);
    // Bookends open as their own screen; tasks stay on the step list.
    setPreferStepList(kind === 'task');
    setStepFocused(false);
    closeGuide();
    // Navigate to the step's Admin / Kanban target by default (same as Go there).
    goToStep(stepId);
  };

  const previousStepId = ownerSetupAdjacentStepId(activeId, -1);

  const handlePreviousStep = () => {
    if (!previousStepId) return;
    setPreferStepList(false);
    setStepFocused(true);
    closeGuide();
    goToStep(previousStepId);
  };

  const formatStepTitle = (stepId: OwnerSetupStepId) => {
    const title = t(`ownerSetup.steps.${stepId}.title`);
    const number = ownerSetupTaskStepNumber(stepId);
    return number ? t('ownerSetup.stepNumbered', { number, title }) : title;
  };

  const isGuiding = guidingStepId === activeId;
  const guideFields = filterOwnerSetupGuideFields(
    activeStep.guideFields,
    guideFieldContext
  );
  const stepDescriptionKey =
    (activeId === 'mail' || activeId === 'storage') && guideFieldContext.multiTenant
      ? `ownerSetup.steps.${activeId}.descriptionMultiTenant`
      : `ownerSetup.steps.${activeId}.description`;

  const isBookend = activeKind === 'intro' || activeKind === 'outro';
  const showStepList = preferStepList || (!stepFocused && !isBookend);

  return (
    <div
      ref={panelRef}
      className={`fixed z-[9000] rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 shadow-xl flex flex-col max-h-[min(90vh,44rem)] overflow-hidden ${
        isDragging ? 'select-none' : ''
      }`}
      style={positionStyle}
      role="dialog"
      aria-labelledby="owner-setup-title"
    >
      <div
        className={`flex-shrink-0 flex items-start gap-2 px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700 ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onMouseDown={startDrag}
        title={t('ownerSetup.dragHint')}
      >
        <GripHorizontal
          size={16}
          className={`mt-0.5 flex-shrink-0 pointer-events-none ${
            showMoveHint
              ? 'text-amber-500 dark:text-amber-400 owner-setup-handle-throb'
              : 'text-gray-400'
          }`}
          aria-hidden
        />
        {showMoveHint ? (
          <ArrowLeft
            size={18}
            strokeWidth={2.5}
            className="mt-0.5 flex-shrink-0 text-amber-500 dark:text-amber-400 owner-setup-nudge-arrow pointer-events-none"
            aria-hidden
          />
        ) : null}
        {showMoveHint ? (
          <span className="sr-only" role="status">
            {t('ownerSetup.moveHintLive')}
          </span>
        ) : null}
        <div className="flex-1 min-w-0 pointer-events-none">
          <h2
            id="owner-setup-title"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            {stepFocused || isBookend
              ? formatStepTitle(activeId)
              : t('ownerSetup.title')}
          </h2>
          {showStepList && (
            <>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t('ownerSetup.subtitle')}
              </p>
              <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('ownerSetup.progressCount', {
                  done: progressStats.done,
                  total: progressStats.total,
                })}
              </p>
            </>
          )}
          {!showStepList && (
            <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              {activeKind === 'intro'
                ? t('ownerSetup.introBadge')
                : activeKind === 'outro'
                  ? t('ownerSetup.outroBadge')
                  : t('ownerSetup.focusModeHint')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={minimizeChecklist}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 pointer-events-auto"
          title={t('ownerSetup.minimize')}
          aria-label={t('ownerSetup.minimize')}
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={dismissChecklist}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 pointer-events-auto"
          title={t('ownerSetup.dismiss')}
          aria-label={t('ownerSetup.dismiss')}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!showStepList ? (
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-start gap-2">
              {!isBookend && <StatusIcon status={activeDisplay} />}
              <div className="min-w-0 flex-1 space-y-2">
                {activeStep.optional && (
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {t('ownerSetup.optional')}
                  </span>
                )}
                {activeId === 'mail' && guideFieldContext.multiTenant ? (
                  <MailMultiTenantDescription textClassName="text-sm text-gray-600 dark:text-gray-300" />
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {t(stepDescriptionKey)}
                  </p>
                )}
                {isGuiding && (
                  <div className="rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-3 py-2 space-y-2">
                    <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                      {t('ownerSetup.guideIntro')}
                    </p>
                    {guideFields.length > 0 ? (
                      <div className="space-y-2.5 text-xs text-blue-900 dark:text-blue-100">
                        {(() => {
                          const groups: {
                            sectionKey?: string;
                            fields: typeof guideFields;
                          }[] = [];
                          for (const field of guideFields) {
                            const last = groups[groups.length - 1];
                            if (last && last.sectionKey === field.sectionKey) {
                              last.fields.push(field);
                            } else {
                              groups.push({
                                sectionKey: field.sectionKey,
                                fields: [field],
                              });
                            }
                          }
                          return groups.map((group, groupIndex) => (
                            <div key={group.sectionKey || `group-${groupIndex}`} className="space-y-1">
                              {group.sectionKey && (
                                <p className="font-semibold text-blue-800 dark:text-blue-200">
                                  {t(`ownerSetup.steps.${activeId}.sections.${group.sectionKey}`)}
                                </p>
                              )}
                              <ul className="list-disc ml-4 space-y-1">
                                {group.fields.map((field) => (
                                  <li key={field.fieldKey}>
                                    {t(`ownerSetup.steps.${activeId}.fields.${field.fieldKey}`, {
                                      defaultValue: t(`ownerSetup.steps.${activeId}.guide`),
                                    })}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ));
                        })()}
                      </div>
                    ) : (
                      <p className="text-xs text-blue-900 dark:text-blue-100">
                        {t(`ownerSetup.steps.${activeId}.guide`)}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleGuideDone}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      >
                        {t('ownerSetup.guideDone')}
                      </button>
                      {previousStepId && (
                        <PreviousStepIconButton onClick={handlePreviousStep} variant="guide" />
                      )}
                      {activeId !== 'finish' && (
                        <button
                          type="button"
                          onClick={handleSkip}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-800/50"
                        >
                          {t('ownerSetup.skip')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                closeGuide();
                setPreferStepList(true);
                setStepFocused(false);
              }}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('ownerSetup.showAllSteps')}
            </button>
          </div>
        ) : (
          <div className="px-2 py-2 space-y-0.5">
            {OWNER_SETUP_STEPS.map((step) => {
              const display = getEffectiveDisplayStatus(progress, step.id, hints);
              const isActive = activeId === step.id;
              const stepKind = getOwnerSetupStepKind(step);
              const canReopen =
                stepKind === 'task' && (display === 'done' || display === 'skipped');
              return (
                <div
                  key={step.id}
                  className={`w-full flex items-start gap-1 rounded-md px-1 py-1 transition-colors ${
                    isActive
                      ? 'bg-amber-50 dark:bg-amber-900/30 ring-1 ring-amber-300 dark:ring-amber-700'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectStep(step.id)}
                    className="min-w-0 flex-1 flex items-start gap-2 rounded-md px-1 py-1 text-left"
                  >
                    <StatusIcon status={display} kind={stepKind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {formatStepTitle(step.id)}
                        </span>
                        {stepKind === 'intro' && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {t('ownerSetup.introBadge')}
                          </span>
                        )}
                        {stepKind === 'outro' && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {t('ownerSetup.outroBadge')}
                          </span>
                        )}
                        {step.optional && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {t('ownerSetup.optional')}
                          </span>
                        )}
                      </div>
                      {isActive &&
                        (step.id === 'mail' && guideFieldContext.multiTenant ? (
                          <div className="mt-0.5">
                            <MailMultiTenantDescription textClassName="text-xs text-gray-600 dark:text-gray-300 leading-relaxed" />
                          </div>
                        ) : (
                          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                            {t(
                              (step.id === 'mail' || step.id === 'storage') &&
                                guideFieldContext.multiTenant
                                ? `ownerSetup.steps.${step.id}.descriptionMultiTenant`
                                : `ownerSetup.steps.${step.id}.description`
                            )}
                          </p>
                        ))}
                    </div>
                    {isActive ? (
                      <ChevronDown size={14} className="text-gray-400 mt-1 flex-shrink-0" />
                    ) : null}
                  </button>
                  {canReopen && (
                    <button
                      type="button"
                      title={t('ownerSetup.reopen')}
                      aria-label={t('ownerSetup.reopen')}
                      onClick={() => handleReopenStep(step.id)}
                      className="mt-0.5 p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
                    >
                      <RotateCcw size={14} aria-hidden />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* While Guide me is open, Done in the tip completes the step — hide duplicate footer actions */}
      {!isGuiding && (
        <div className="flex-shrink-0">
          <ActiveStepActions
            stepId={activeId}
            stepKind={activeKind}
            stepFocused={stepFocused || (isBookend && !preferStepList)}
            isGuiding={isGuiding}
            onGo={handleGoThere}
            onGuide={handleGuide}
            onDone={handleMarkDone}
            onSkip={handleSkip}
            onReset={handleReset}
            onPrevious={previousStepId ? handlePreviousStep : undefined}
            onGetStarted={handleGetStarted}
            onDoItLater={handleDoItLater}
            onCloseGuide={handleCloseGuide}
            onReviewSteps={handleReviewSteps}
            onStartOver={handleStartOver}
            display={activeDisplay}
          />
        </div>
      )}
    </div>
  );
};

function StatusIcon({
  status,
  kind = 'task',
}: {
  status: 'todo' | 'done' | 'skipped' | 'suggested';
  kind?: 'task' | 'intro' | 'outro';
}) {
  if (kind === 'intro' || kind === 'outro') {
    if (status === 'done') {
      return (
        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 flex-shrink-0">
          <Check size={12} strokeWidth={3} />
        </span>
      );
    }
    return (
      <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex-shrink-0">
        <Circle size={10} fill="currentColor" />
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 flex-shrink-0">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 flex-shrink-0">
        <SkipForward size={11} />
      </span>
    );
  }
  if (status === 'suggested') {
    return (
      <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex-shrink-0">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-5 w-5 items-center justify-center text-gray-300 dark:text-gray-600 flex-shrink-0">
      <Circle size={14} />
    </span>
  );
}

function ActiveStepActions({
  stepId,
  stepKind,
  stepFocused,
  isGuiding,
  onGo,
  onGuide,
  onDone,
  onSkip,
  onReset,
  onPrevious,
  onGetStarted,
  onDoItLater,
  onCloseGuide,
  onReviewSteps,
  onStartOver,
  display,
}: {
  stepId: OwnerSetupStepId;
  stepKind: 'task' | 'intro' | 'outro';
  stepFocused: boolean;
  isGuiding: boolean;
  onGo: () => void;
  onGuide: () => void;
  onDone: () => void;
  onSkip: () => void;
  onReset: () => void;
  onPrevious?: () => void;
  onGetStarted: () => void;
  onDoItLater: () => void;
  onCloseGuide: () => void;
  onReviewSteps: () => void;
  onStartOver: () => void;
  display: 'todo' | 'done' | 'skipped' | 'suggested';
}) {
  const { t } = useTranslation('common');
  const def = OWNER_SETUP_STEPS.find((s) => s.id === stepId);
  const canNavigate = Boolean(def?.tourTarget || def?.adminTab || def?.goKanban || def?.guideFields?.length);
  const canGuide = Boolean(def?.guideFields?.length || def?.tourTarget || def?.adminTab || def?.goKanban);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const confirmPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmStartOver) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setConfirmStartOver(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmStartOver]);

  useEffect(() => {
    if (!confirmStartOver) return;
    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointer = (e: MouseEvent) => {
        if (confirmPanelRef.current && !confirmPanelRef.current.contains(e.target as Node)) {
          setConfirmStartOver(false);
        }
      };
      document.addEventListener('mousedown', onPointer);
      remove = () => document.removeEventListener('mousedown', onPointer);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      remove?.();
    };
  }, [confirmStartOver]);

  if (stepKind === 'intro') {
    return (
      <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGetStarted}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <Play size={12} />
            {t('ownerSetup.getStarted')}
          </button>
          <button
            type="button"
            onClick={onDoItLater}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t('ownerSetup.doItLater')}
          </button>
        </div>
      </div>
    );
  }

  if (stepKind === 'outro') {
    return (
      <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-3 space-y-2">
        {confirmStartOver ? (
          <div
            ref={confirmPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('ownerSetup.startOverConfirm')}
            className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 px-3 py-2.5 space-y-2"
          >
            <p className="text-xs text-amber-900 dark:text-amber-100">
              {t('ownerSetup.startOverConfirm')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmStartOver(false);
                  onStartOver();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700"
              >
                <RotateCcw size={12} aria-hidden />
                {t('ownerSetup.startOverConfirmAction')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmStartOver(false)}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t('ownerSetup.startOverCancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {onPrevious && <PreviousStepIconButton onClick={onPrevious} />}
            <button
              type="button"
              onClick={onCloseGuide}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700"
            >
              {t('ownerSetup.closeGuide')}
            </button>
            <button
              type="button"
              onClick={onReviewSteps}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {t('ownerSetup.reviewSteps')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmStartOver(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/40"
            >
              <RotateCcw size={12} aria-hidden />
              {t('ownerSetup.startOver')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-3 space-y-2">
      {display === 'suggested' && (
        <p className="text-xs text-blue-600 dark:text-blue-400">{t('ownerSetup.suggestedHint')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {onPrevious && <PreviousStepIconButton onClick={onPrevious} />}
        {canNavigate && !stepFocused && (
          <button
            type="button"
            onClick={onGo}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {t('ownerSetup.goThere')}
          </button>
        )}
        {canGuide && !isGuiding && (
          <button
            type="button"
            onClick={onGuide}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <Play size={12} />
            {t('ownerSetup.guideMe')}
          </button>
        )}
        {display !== 'done' && (
          <button
            type="button"
            onClick={onDone}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700"
          >
            {t('ownerSetup.markDone')}
          </button>
        )}
        {display !== 'skipped' && (
          <button
            type="button"
            onClick={onSkip}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t('ownerSetup.skip')}
          </button>
        )}
        {(display === 'done' || display === 'skipped') && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <RotateCcw size={12} aria-hidden />
            {t('ownerSetup.reopen')}
          </button>
        )}
      </div>
    </div>
  );
}

export default OwnerSetupChecklist;
