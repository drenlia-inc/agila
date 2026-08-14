import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';

interface ResetCountdownProps {
  onReset?: () => void;
  inline?: boolean; // If true, render inline instead of as a portal
}

const ResetCountdown: React.FC<ResetCountdownProps> = ({ onReset, inline = false }) => {
  const { t } = useTranslation('common');
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number }>({
    minutes: 0,
    seconds: 0
  });
  const [mounted, setMounted] = useState(false);
  const [hasReset, setHasReset] = useState(false);

  // Calculate time until next hour
  const calculateTimeUntilNextHour = (): { minutes: number; seconds: number } => {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1);
    nextHour.setMinutes(0);
    nextHour.setSeconds(0);
    nextHour.setMilliseconds(0);
    
    const diffMs = nextHour.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffSeconds = Math.floor((diffMs % 60000) / 1000);
    
    return { minutes: diffMinutes, seconds: diffSeconds };
  };

  useEffect(() => {
    setMounted(true);
    // Set initial time
    setTimeLeft(calculateTimeUntilNextHour());
    
    const interval = setInterval(() => {
      const newTime = calculateTimeUntilNextHour();
      setTimeLeft(newTime);
      
      // Check if time has reached 0 and trigger reset
      if (newTime.minutes === 0 && newTime.seconds === 0 && !hasReset) {
        setHasReset(true);
        if (onReset) {
          onReset();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [hasReset, onReset]);

  if (!mounted) return null;

  // Check if we're in the last 30 seconds (urgent state)
  const isUrgent = timeLeft.minutes === 0 && timeLeft.seconds <= 30;
  const timeLabel = `${String(timeLeft.minutes).padStart(2, '0')}:${String(timeLeft.seconds).padStart(2, '0')}`;
  const tooltipLabel = t('resetCountdown.demoResetsIn', {
    minutes: timeLeft.minutes,
    seconds: timeLeft.seconds,
  });

  const countdownContent = (
    <KanbanChromeTooltip
      label={tooltipLabel}
      wrapperClassName="shrink-0 inline-flex"
      delayMs={0}
      dismissOnLabelChange={false}
    >
      <div
        className={`
          shrink-0
          ${isUrgent
            ? 'bg-red-600 dark:bg-red-700 text-white border-red-700 dark:border-red-800'
            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
          }
          text-xs py-1.5 px-2 rounded-full border flex items-center gap-1 transition-colors duration-300
          ${isUrgent ? 'animate-pulse' : ''}
        `}
        aria-label={tooltipLabel}
      >
        <Clock size={12} className={`shrink-0 ${isUrgent ? 'text-white' : 'text-red-500 dark:text-red-400'}`} />
        <span className="font-medium tabular-nums leading-none">{timeLabel}</span>
      </div>
    </KanbanChromeTooltip>
  );

  if (inline) {
    return countdownContent;
  }

  // Legacy fixed positioning (for backward compatibility)
  return (
    <div className="fixed top-2 left-1/2 transform -translate-x-1/2" style={{ zIndex: 9999 }}>
      {countdownContent}
    </div>
  );
};

export default ResetCountdown;
