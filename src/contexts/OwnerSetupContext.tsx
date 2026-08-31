import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import api from '../api';
import { useSettings } from './SettingsContext';
import type { Board, CurrentUser } from '../types';
import {
  OWNER_SETUP_STEPS,
  OwnerSetupHints,
  OwnerSetupManualStatus,
  OwnerSetupProgress,
  OwnerSetupStepId,
  applyOwnerSetupFieldHighlights,
  clearOwnerSetupFieldHighlights,
  computeOwnerSetupHints,
  coreStepsComplete,
  DEFAULT_OWNER_SETUP_PROGRESS,
  EMPTY_OWNER_SETUP_HINTS,
  firstIncompleteStepId,
  getStepDef,
  isMultiTenantDeploy,
  loadOwnerSetupProgress,
  ownerSetupGuideSelectors,
  persistOwnerSetupProgress,
} from '../utils/ownerSetup';
import { adminHashForTabId, requestAdminNavigation } from '../utils/adminNavigation';

interface OwnerSetupContextType {
  isOwner: boolean;
  ready: boolean;
  progress: OwnerSetupProgress;
  hints: OwnerSetupHints;
  /** When set, checklist shows Guide me instructions for this step */
  guidingStepId: OwnerSetupStepId | null;
  openChecklist: () => void;
  dismissChecklist: () => void;
  minimizeChecklist: () => void;
  expandChecklist: () => void;
  setActiveStep: (stepId: OwnerSetupStepId) => void;
  markStep: (stepId: OwnerSetupStepId, status: OwnerSetupManualStatus) => void;
  goToStep: (stepId: OwnerSetupStepId) => void;
  guideCurrentStep: () => void;
  closeGuide: () => void;
  /** Clear checklist progress and return to Welcome. */
  startOver: () => void;
  /** Mark Welcome done and open the first incomplete step (resets if core was already complete). */
  beginGuide: () => void;
  setPositionX: (x: number) => void;
  coreComplete: boolean;
}

const OwnerSetupContext = createContext<OwnerSetupContextType | undefined>(undefined);

export const useOwnerSetup = () => {
  const ctx = useContext(OwnerSetupContext);
  if (!ctx) {
    throw new Error('useOwnerSetup must be used within OwnerSetupProvider');
  }
  return ctx;
};

/** Optional hook when provider may be absent (e.g. Help on TaskPage). */
export const useOwnerSetupOptional = () => useContext(OwnerSetupContext);

interface OwnerSetupProviderProps {
  children: React.ReactNode;
  currentUser: CurrentUser | null;
  boards: Board[];
  memberCount: number;
  sprintCount: number;
  tagCount: number;
  priorityCount: number;
  onPageChange?: (
    page: 'kanban' | 'admin' | 'reports',
    options?: { hash?: string }
  ) => void;
}

export const OwnerSetupProvider: React.FC<OwnerSetupProviderProps> = ({
  children,
  currentUser,
  boards,
  memberCount,
  sprintCount,
  tagCount,
  priorityCount,
  onPageChange,
}) => {
  const { siteSettings, systemSettings } = useSettings();
  const [isOwner, setIsOwner] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<OwnerSetupProgress>({
    ...DEFAULT_OWNER_SETUP_PROGRESS,
    steps: {},
  });
  const [guidingStepId, setGuidingStepId] = useState<OwnerSetupStepId | null>(null);
  const persistTimer = useRef<number | null>(null);
  const autoOpenedRef = useRef(false);
  /** Always-current progress for sync reads (setState updaters are not sync). */
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const mergedSettings = useMemo(
    () => ({ ...(systemSettings || {}), ...(siteSettings || {}) }),
    [siteSettings, systemSettings]
  );

  const hints = useMemo(
    () =>
      computeOwnerSetupHints({
        siteSettings: mergedSettings,
        memberCount,
        boards,
        sprintCount,
        tagCount,
        priorityCount,
      }),
    [mergedSettings, memberCount, boards, sprintCount, tagCount, priorityCount]
  );

  const coreComplete = useMemo(() => coreStepsComplete(progress), [progress]);

  const guideFieldContext = useMemo(() => {
    const rawMail = mergedSettings.MAIL_MANAGED;
    const rawStorageMode = mergedSettings.STORAGE_MODE;
    const rawStorage = mergedSettings.STORAGE_MANAGED;
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
  }, [mergedSettings.MAIL_MANAGED, mergedSettings.STORAGE_MODE, mergedSettings.STORAGE_MANAGED]);

  // Detect owner + load progress
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!currentUser?.id || !localStorage.getItem('authToken')) {
        setIsOwner(false);
        setReady(true);
        return;
      }
      try {
        const ownerCheck = await api.get('/auth/is-owner');
        if (cancelled) return;
        const owner = Boolean(ownerCheck.data?.isOwner);
        setIsOwner(owner);
        if (owner) {
          const loaded = await loadOwnerSetupProgress(currentUser.id);
          if (!cancelled) {
            setProgress(loaded);
          }
        }
      } catch {
        if (!cancelled) setIsOwner(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    setReady(false);
    void run();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const schedulePersist = useCallback(
    (next: OwnerSetupProgress) => {
      if (!currentUser?.id) return;
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        void persistOwnerSetupProgress(currentUser.id, next);
      }, 300);
    },
    [currentUser?.id]
  );

  const updateProgress = useCallback(
    (updater: (prev: OwnerSetupProgress) => OwnerSetupProgress) => {
      setProgress((prev) => {
        const next = updater(prev);
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist]
  );

  // First-time owners: show checklist once after login if not dismissed
  useEffect(() => {
    if (!ready || !isOwner || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (coreComplete) return;
    if (!progress.visible) return;
    const timer = window.setTimeout(() => {
      updateProgress((prev) => ({
        ...prev,
        visible: true,
        minimized: prev.minimized,
        activeStepId: firstIncompleteStepId(prev),
      }));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [ready, isOwner, coreComplete, progress.visible, updateProgress]);

  const openChecklist = useCallback(() => {
    updateProgress((prev) => ({
      ...prev,
      visible: true,
      minimized: false,
      activeStepId: firstIncompleteStepId(prev),
    }));
  }, [updateProgress]);

  const dismissChecklist = useCallback(() => {
    setGuidingStepId(null);
    updateProgress((prev) => ({
      ...prev,
      visible: false,
      minimized: false,
    }));
  }, [updateProgress]);

  const minimizeChecklist = useCallback(() => {
    // Keep guiding / focus state — expand should resume the same step
    updateProgress((prev) => ({ ...prev, minimized: true, visible: true }));
  }, [updateProgress]);

  const expandChecklist = useCallback(() => {
    updateProgress((prev) => ({ ...prev, minimized: false, visible: true }));
  }, [updateProgress]);

  const setActiveStep = useCallback(
    (stepId: OwnerSetupStepId) => {
      setGuidingStepId(null);
      updateProgress((prev) => ({ ...prev, activeStepId: stepId, minimized: false, visible: true }));
    },
    [updateProgress]
  );

  const navigateForStep = useCallback(
    (stepId: OwnerSetupStepId) => {
      const def = getStepDef(stepId);
      if (def.goKanban && onPageChange) {
        onPageChange('kanban');
        if (def.scrollToTop) {
          window.setTimeout(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }, 50);
        }
        return;
      }
      if (!def.adminTab || !onPageChange) return;

      const hash = adminHashForTabId(def.adminTab);
      // Switch page + notify Admin tab state directly (avoids Guide me / hash races)
      onPageChange('admin', { hash });
      requestAdminNavigation(hash);
    },
    [onPageChange]
  );

  const markStep = useCallback(
    (stepId: OwnerSetupStepId, status: OwnerSetupManualStatus) => {
      // Tear down Guide me first so App Settings / highlight cleanup cannot fight navigation
      clearOwnerSetupFieldHighlights();
      setGuidingStepId(null);

      // Compute next step synchronously — do not rely on setState updater side effects
      // (React may defer the updater, which left navigation on the old Admin tab).
      const draftSteps = { ...progressRef.current.steps, [stepId]: status };
      const draft: OwnerSetupProgress = { ...progressRef.current, steps: draftSteps };
      const nextStepId =
        status === 'done' || status === 'skipped'
          ? firstIncompleteStepId(draft)
          : stepId;

      updateProgress((prev) => {
        const steps = { ...prev.steps, [stepId]: status };
        const next: OwnerSetupProgress = { ...prev, steps };
        if (status === 'done' || status === 'skipped') {
          next.activeStepId = firstIncompleteStepId(next);
        }
        return next;
      });

      if (status === 'done' || status === 'skipped') {
        // Defer so Guide me unmount/cleanup finishes, then go to next screen
        window.setTimeout(() => {
          navigateForStep(nextStepId);
        }, 0);
      }
    },
    [updateProgress, navigateForStep]
  );

  const setPositionX = useCallback(
    (x: number) => {
      updateProgress((prev) => ({ ...prev, positionX: x }));
    },
    [updateProgress]
  );

  const goToStep = useCallback(
    (stepId: OwnerSetupStepId) => {
      setActiveStep(stepId);
      navigateForStep(stepId);
    },
    [setActiveStep, navigateForStep]
  );

  const guideCurrentStep = useCallback(() => {
    const stepId = progress.activeStepId;
    const def = getStepDef(stepId);
    if (!def.guideFields?.length && !def.tourTarget && !def.adminTab && !def.goKanban) {
      return;
    }
    updateProgress((prev) => ({
      ...prev,
      visible: true,
      minimized: false,
      activeStepId: stepId,
    }));
    navigateForStep(stepId);
    setGuidingStepId(stepId);
  }, [progress.activeStepId, navigateForStep, updateProgress]);

  const closeGuide = useCallback(() => {
    clearOwnerSetupFieldHighlights();
    setGuidingStepId(null);
  }, []);

  const startOver = useCallback(() => {
    clearOwnerSetupFieldHighlights();
    setGuidingStepId(null);
    updateProgress((prev) => ({
      version: 1,
      visible: true,
      minimized: false,
      activeStepId: 'welcome',
      steps: {},
      positionX: prev.positionX,
    }));
  }, [updateProgress]);

  const beginGuide = useCallback(() => {
    clearOwnerSetupFieldHighlights();
    setGuidingStepId(null);
    let nextStepId: OwnerSetupStepId = 'welcome';
    updateProgress((prev) => {
      const reset = coreStepsComplete(prev);
      const steps: OwnerSetupProgress['steps'] = reset
        ? { welcome: 'done' }
        : { ...prev.steps, welcome: 'done' };
      const draft: OwnerSetupProgress = {
        ...prev,
        visible: true,
        minimized: false,
        steps,
      };
      nextStepId = firstIncompleteStepId(draft);
      return { ...draft, activeStepId: nextStepId };
    });
    window.setTimeout(() => {
      navigateForStep(nextStepId);
    }, 0);
  }, [updateProgress, navigateForStep]);

  // Highlight related fields at once while Guide me is open (no Joyride)
  useEffect(() => {
    if (!guidingStepId) {
      clearOwnerSetupFieldHighlights();
      return;
    }
    const def = getStepDef(guidingStepId);
    const selectors = ownerSetupGuideSelectors(def.guideFields, guideFieldContext);
    const targets =
      selectors.length > 0
        ? selectors
        : def.tourTarget
          ? [def.tourTarget]
          : [];
    if (targets.length === 0) return;

    // Allow Admin / Kanban to mount after navigation
    const cancel = applyOwnerSetupFieldHighlights(targets);
    return () => {
      cancel();
      clearOwnerSetupFieldHighlights();
    };
  }, [guidingStepId, guideFieldContext]);

  const value = useMemo(
    () => ({
      isOwner,
      ready,
      progress,
      hints: isOwner ? hints : EMPTY_OWNER_SETUP_HINTS,
      guidingStepId,
      openChecklist,
      dismissChecklist,
      minimizeChecklist,
      expandChecklist,
      setActiveStep,
      markStep,
      goToStep,
      guideCurrentStep,
      closeGuide,
      startOver,
      beginGuide,
      setPositionX,
      coreComplete,
    }),
    [
      isOwner,
      ready,
      progress,
      hints,
      guidingStepId,
      openChecklist,
      dismissChecklist,
      minimizeChecklist,
      expandChecklist,
      setActiveStep,
      markStep,
      goToStep,
      guideCurrentStep,
      closeGuide,
      startOver,
      beginGuide,
      setPositionX,
      coreComplete,
    ]
  );

  return (
    <OwnerSetupContext.Provider value={value}>
      {children}
    </OwnerSetupContext.Provider>
  );
};

export { OWNER_SETUP_STEPS };
