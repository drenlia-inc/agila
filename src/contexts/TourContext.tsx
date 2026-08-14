import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import Joyride, { ACTIONS, CallBackProps, EVENTS, STATUS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { getTourSteps } from '../components/tour/TourSteps';
import { parseTaskRoute } from '../utils/routingUtils';
import { adminHashForTabId } from '../utils/adminNavigation';
import { useTheme } from './ThemeContext';

interface TourContextType {
  isRunning: boolean;
  startTour: () => void;
  stopTour: () => void;
  isHelpModalOpen: boolean;
  setHelpModalOpen: (open: boolean) => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export const useTour = () => {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error('useTour must be used within a TourProvider');
  }
  return context;
};

interface TourProviderProps {
  children: React.ReactNode;
  currentUser: any;
  onViewModeChange?: (mode: 'kanban' | 'list' | 'gantt') => void;
  onPageChange?: (
    page: 'kanban' | 'admin' | 'reports',
    options?: { hash?: string }
  ) => void;
}

/** Scroll an admin tab button into the horizontal tab strip before Joyride measures it. */
function scrollAdminTabIntoStrip(targetSelector: string): boolean {
  if (!targetSelector.startsWith('[data-tour-id="admin-')) return false;
  const tabMatch = targetSelector.match(/admin-([^"]+)/);
  if (!tabMatch?.[1] || tabMatch[1] === 'tab' || tabMatch[1] === 'tabs') return false;

  const el = document.querySelector(targetSelector) as HTMLElement | null;
  if (!el) return false;

  const nav =
    (el.closest('[data-tour-id="admin-tabs"]')?.querySelector('nav') as HTMLElement | null) ||
    (el.closest('nav') as HTMLElement | null);

  if (!nav) {
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    return true;
  }

  const navRect = nav.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const elCenter = (elRect.left + elRect.right) / 2;
  const navCenter = (navRect.left + navRect.right) / 2;
  const nextLeft = nav.scrollLeft + (elCenter - navCenter);
  const maxLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
  nav.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
  return true;
}

function prepareAdminTourTarget(
  targetSelector: string,
  onPageChange?: TourProviderProps['onPageChange'],
  isAdmin?: boolean
) {
  if (!isAdmin || !targetSelector.startsWith('[data-tour-id="admin-')) return;

  const currentHash = window.location.hash;
  const tabMatch = targetSelector.match(/admin-([^"]+)/);
  const tabName =
    tabMatch?.[1] && tabMatch[1] !== 'tab' && tabMatch[1] !== 'tabs'
      ? tabMatch[1]
      : null;

  // Map tour target ids (incl. System / Project hub subtabs) to Admin hashes
  const hash = tabName ? adminHashForTabId(tabName) : undefined;

  if (onPageChange && (!currentHash.includes('admin') || tabName)) {
    onPageChange('admin', hash ? { hash } : undefined);
  } else if (hash) {
    const expectedHash = `#${hash}`;
    if (currentHash !== expectedHash) {
      window.location.hash = hash;
    }
  }

  scrollAdminTabIntoStrip(targetSelector);
}

function ensureSystemUsagePanelVisible(): boolean {
  if (document.querySelector('[data-tour-id="system-usage-panel"]')) {
    return true;
  }
  window.dispatchEvent(new Event('tour:ensure-system-panel'));
  return !!document.querySelector('[data-tour-id="system-usage-panel"]');
}

export const TourProvider: React.FC<TourProviderProps> = ({ children, currentUser, onViewModeChange, onPageChange }) => {
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const joyrideStyles = useMemo(() => {
    const isDark = theme === 'dark';
    return {
      options: {
        primaryColor: '#3b82f6',
        textColor: isDark ? '#f3f4f6' : '#1f2937',
        backgroundColor: isDark ? '#1f2937' : '#ffffff',
        overlayColor: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.4)',
        arrowColor: isDark ? '#1f2937' : '#ffffff',
        zIndex: 10000,
      },
      tooltip: {
        borderRadius: 10,
        fontSize: 14,
        // Extra right/top padding so body text never sits under the absolute ×
        padding: '18px 16px 14px',
        maxWidth: 380,
        lineHeight: 1.5,
      },
      tooltipContainer: {
        textAlign: 'left' as const,
        lineHeight: 1.5,
      },
      tooltipTitle: {
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 8,
        paddingRight: 28,
      },
      tooltipContent: {
        // Joyride’s × is position:absolute; keep clear space on the right + top
        padding: '4px 32px 4px 2px',
        lineHeight: 1.55,
      },
      tooltipFooter: {
        marginTop: 14,
        alignItems: 'center',
      },
      buttonNext: {
        backgroundColor: '#3b82f6',
        borderRadius: 6,
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 500,
        padding: '8px 12px',
        whiteSpace: 'pre-line',
        textAlign: 'center' as const,
        lineHeight: 1.25,
      },
      buttonBack: {
        color: isDark ? '#9ca3af' : '#6b7280',
        fontSize: 14,
        marginRight: 8,
      },
      buttonSkip: {
        color: isDark ? '#9ca3af' : '#6b7280',
        fontSize: 14,
      },
      buttonClose: {
        color: isDark ? '#9ca3af' : '#6b7280',
        height: 16,
        width: 16,
        padding: 8,
        top: 8,
        right: 8,
      },
      beacon: {
        inner: '#3b82f6',
        outer: '#3b82f6',
      },
      // Keep the cutout close to the control so dense header buttons don't bleed together
      spotlight: {
        borderRadius: 6,
      },
    };
  }, [theme]);

  const previousStepIndexRef = React.useRef<number>(-1);
  const advancingRef = React.useRef(false);

  const isAdmin = currentUser?.roles?.includes('admin') || currentUser?.role === 'admin';
  const isSystemPanelAvailable =
    process.env.MULTI_TENANT !== 'true' && process.env.DEMO_ENABLED !== 'true';
  const steps = useMemo(() => {
    const { userSteps, adminSteps } = getTourSteps();
    const raw = isAdmin ? adminSteps : userSteps;
    if (isSystemPanelAvailable) return raw;
    return raw.filter((step) => {
      const target = typeof step.target === 'string' ? step.target : '';
      return !target.includes('system-panel-toggle') && !target.includes('system-usage-panel');
    });
  }, [isAdmin, isSystemPanelAvailable, t]);

  const beginTourRun = useCallback(() => {
    previousStepIndexRef.current = -1;
    advancingRef.current = false;
    setStepIndex(0);
    setIsRunning(true);
  }, []);

  // Resume a tour after navigating to Kanban (from TaskPage / Admin / Reports)
  useEffect(() => {
    const startIfPending = () => {
      if (sessionStorage.getItem('pendingTourStart') !== 'true') return;

      const hash = window.location.hash.toLowerCase();
      const taskRoute = parseTaskRoute();
      // Wait until we are actually on the kanban route
      if (taskRoute.isTaskRoute || hash.includes('admin') || hash.includes('reports')) {
        return;
      }

      sessionStorage.removeItem('pendingTourStart');
      if (onViewModeChange) {
        onViewModeChange('kanban');
      }
      setTimeout(() => {
        beginTourRun();
      }, 350);
    };

    startIfPending();
    window.addEventListener('hashchange', startIfPending);
    const retry = window.setTimeout(startIfPending, 150);
    return () => {
      window.removeEventListener('hashchange', startIfPending);
      window.clearTimeout(retry);
    };
  }, [onViewModeChange, beginTourRun]);

  const startTour = useCallback(() => {
    setIsHelpModalOpen(false);

    const hash = window.location.hash.toLowerCase();
    const taskRoute = parseTaskRoute();
    const needsKanbanPage =
      taskRoute.isTaskRoute ||
      hash.includes('admin') ||
      hash.includes('reports');

    if (needsKanbanPage && onPageChange) {
      sessionStorage.setItem('pendingTourStart', 'true');
      onPageChange('kanban');
      return;
    }

    if (onViewModeChange) {
      onViewModeChange('kanban');
    }
    setTimeout(() => {
      beginTourRun();
    }, 200);
  }, [onViewModeChange, onPageChange, beginTourRun]);

  const returnToKanbanAfterTour = useCallback(() => {
    // When admin/system-monitor steps are skipped or the tour ends on Admin, land on Kanban.
    const hash = window.location.hash.toLowerCase();
    if (onPageChange && (hash.includes('admin') || hash.includes('reports'))) {
      onPageChange('kanban');
    }
    if (onViewModeChange) {
      onViewModeChange('kanban');
    }
  }, [onPageChange, onViewModeChange]);

  const stopTour = useCallback(() => {
    setIsRunning(false);
    setStepIndex(0);
    previousStepIndexRef.current = -1;
    advancingRef.current = false;
    // Restore system metrics panel to whatever visibility it had before the tour opened it
    window.dispatchEvent(new Event('tour:restore-system-panel'));
    returnToKanbanAfterTour();
  }, [returnToKanbanAfterTour]);

  const setHelpModalOpen = useCallback((open: boolean) => {
    setIsHelpModalOpen(open);
  }, []);

  const goToStep = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    if (advancingRef.current) return;
    advancingRef.current = true;

    const nextStep = steps[nextIndex];
    const target = typeof nextStep?.target === 'string' ? nextStep.target : '';
    const stepData = nextStep as any;

    if (stepData?.data?.switchToPage === 'admin' && onPageChange && isAdmin) {
      onPageChange('admin');
    }

    if (stepData?.data?.switchToPage === 'kanban' && onPageChange) {
      onPageChange('kanban');
    }

    if (
      (stepData?.data?.switchToView === 'list' ||
        target === '[data-tour-id="export-menu"]' ||
        target === '[data-tour-id="column-visibility"]') &&
      onViewModeChange
    ) {
      const currentHash = window.location.hash;
      if (currentHash.includes('admin') && onPageChange) {
        onPageChange('kanban');
        setTimeout(() => onViewModeChange('list'), 300);
      } else {
        onViewModeChange('list');
      }
    }

    const settleAndShow = (delayMs: number) => {
      window.setTimeout(() => {
        if (target.startsWith('[data-tour-id="admin-') && isAdmin) {
          scrollAdminTabIntoStrip(target);
        }
        if (stepData?.data?.ensureSystemPanel) {
          ensureSystemUsagePanelVisible();
        }
        setStepIndex(nextIndex);
        previousStepIndexRef.current = nextIndex;
        advancingRef.current = false;
      }, delayMs);
    };

    if (target.startsWith('[data-tour-id="admin-') && isAdmin) {
      prepareAdminTourTarget(target, onPageChange, isAdmin);
      settleAndShow(120);
      return;
    }

    if (stepData?.data?.switchToPage === 'kanban' || stepData?.data?.ensureSystemPanel) {
      // Leave Admin, open metrics panel, wait for it to mount, then show step 34.
      if (stepData?.data?.ensureSystemPanel) {
        ensureSystemUsagePanelVisible();
      }
      window.setTimeout(() => {
        ensureSystemUsagePanelVisible();
        setStepIndex(nextIndex);
        previousStepIndexRef.current = nextIndex;
        advancingRef.current = false;
        window.dispatchEvent(new Event('resize'));
      }, 450);
      return;
    }

    setStepIndex(nextIndex);
    previousStepIndexRef.current = nextIndex;
    advancingRef.current = false;
  }, [steps, onPageChange, onViewModeChange, isAdmin]);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, step, index, type, action } = data;

    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status as any)) {
      stopTour();
      return;
    }

    // Controlled mode: advance ourselves so admin tabs can scroll into view first.
    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      if (action === ACTIONS.PREV) {
        goToStep(index - 1);
        return;
      }

      // Finish on Next from the last step (controlled mode does not auto-finish).
      if (action === ACTIONS.NEXT && index >= steps.length - 1) {
        stopTour();
        return;
      }

      if (type === EVENTS.TARGET_NOT_FOUND) {
        const missing = typeof step?.target === 'string' ? step.target : '';
        // Last step: open system panel and retry instead of skipping past the end.
        if (missing.includes('system-usage-panel')) {
          if (onPageChange && window.location.hash.toLowerCase().includes('admin')) {
            onPageChange('kanban');
          }
          ensureSystemUsagePanelVisible();
          window.setTimeout(() => {
            ensureSystemUsagePanelVisible();
            advancingRef.current = false;
            // Remount this step so Joyride re-queries the target after the panel opens.
            setIsRunning(false);
            setStepIndex(index);
            previousStepIndexRef.current = index;
            window.setTimeout(() => setIsRunning(true), 50);
          }, 450);
          return;
        }
        // Skip unknown missing targets when possible
        if (index < steps.length - 1) {
          goToStep(index + 1);
        } else {
          stopTour();
        }
        return;
      }

      if (action === ACTIONS.NEXT) {
        goToStep(index + 1);
      }
    }

    // Safety net if a tooltip still lands on a clipped tab.
    if (type === EVENTS.TOOLTIP || type === EVENTS.STEP_BEFORE) {
      previousStepIndexRef.current = index;
      if (step?.target && typeof step.target === 'string' && step.target.startsWith('[data-tour-id="admin-')) {
        if (scrollAdminTabIntoStrip(step.target)) {
          window.dispatchEvent(new Event('resize'));
        }
      }
      if (step?.target === '[data-tour-id="system-usage-panel"]') {
        ensureSystemUsagePanelVisible();
      }
    }
  }, [stopTour, goToStep, steps.length, onPageChange]);

  return (
    <TourContext.Provider
      value={{
        isRunning,
        startTour,
        stopTour,
        isHelpModalOpen,
        setHelpModalOpen,
      }}
    >
      {children}
      <Joyride
        steps={steps}
        run={isRunning}
        stepIndex={stepIndex}
        continuous={true}
        showProgress={true}
        showSkipButton={true}
        callback={handleJoyrideCallback}
        scrollToFirstStep={true}
        scrollOffset={150}
        disableOverlayClose={true}
        hideCloseButton={false}
        disableScrolling={false}
        disableScrollParentFix={true}
        disableOverlay={false}
        spotlightClicks={true}
        spotlightPadding={4}
        styles={joyrideStyles}
        locale={{
          back: t('tour.back'),
          close: t('tour.close'),
          last: t('tour.last'),
          next: t('tour.next'),
          skip: t('tour.skip'),
          nextLabelWithProgress: t('tour.nextWithProgress'),
        }}
      />
    </TourContext.Provider>
  );
};
