import { useCallback, useEffect, useMemo, useState } from 'react';
import Joyride, { CallBackProps, STATUS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { getTourSteps } from './TourSteps';
import { useTheme } from '../../contexts/ThemeContext';

interface TourProviderProps {
  children: React.ReactNode;
  currentUser: any; // CurrentUser type from your app
}

const TourProvider: React.FC<TourProviderProps> = ({ children, currentUser }) => {
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  const [isRunning, setIsRunning] = useState(false);
  const { userSteps, adminSteps } = getTourSteps();

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
        borderRadius: 8,
        fontSize: 14,
        padding: 20,
      },
      tooltipContainer: {
        textAlign: 'left' as const,
      },
      tooltipTitle: {
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 8,
      },
      tooltipContent: {
        padding: 0,
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
      },
      beacon: {
        inner: '#3b82f6',
        outer: '#3b82f6',
      },
    };
  }, [theme]);

  // Expose startTour function globally for the help modal
  useEffect(() => {
    (window as any).startTour = () => {
      setIsRunning(true);
    };
  }, []);

  // Determine if user is admin
  const isAdmin = currentUser?.roles?.includes('admin') || currentUser?.role === 'admin';
  const steps = isAdmin ? adminSteps : userSteps;

  const stopTour = useCallback(() => {
    setIsRunning(false);
  }, []);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status } = data;
    
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      stopTour();
    }
  }, [stopTour]);

  return (
    <>
      {children}
      <Joyride
        steps={steps}
        run={isRunning}
        continuous={true}
        showProgress={true}
        showSkipButton={true}
        callback={handleJoyrideCallback}
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
    </>
  );
};

export default TourProvider;
