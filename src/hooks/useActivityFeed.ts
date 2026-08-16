/**
 * Hook for managing activity feed state and handlers
 */

import { useEffect, useState } from 'react';
import {
  loadUserPreferences,
  updateActivityFeedPreference,
} from '../utils/userPreferences';
import { DEFAULT_ACTIVITY_FEED_STORED_POSITION } from '../utils/activityFeedPosition';
import { isMobileViewport } from '../utils/mobileViewport';
import { useIsMobileViewport } from './useIsMobileViewport';

export interface UseActivityFeedReturn {
  // State
  showActivityFeed: boolean;
  activityFeedMinimized: boolean;
  activityFeedPosition: { x: number; y: number };
  activityFeedDimensions: { width: number; height: number };
  activities: any[];
  lastSeenActivityId: number;
  clearActivityId: number;
  
  // Setters
  setShowActivityFeed: (enabled: boolean) => void;
  setActivityFeedMinimized: (minimized: boolean) => void;
  setActivityFeedPosition: (position: { x: number; y: number }) => void;
  setActivityFeedDimensions: (dimensions: { width: number; height: number }) => void;
  setActivities: (activities: any[]) => void;
  setLastSeenActivityId: (activityId: number) => void;
  setClearActivityId: (activityId: number) => void;
  
  // Handlers
  handleActivityFeedToggle: (enabled: boolean) => void;
  handleActivityFeedMinimizedChange: (minimized: boolean) => void;
  handleActivityFeedMarkAsRead: (activityId: number) => Promise<void>;
  handleActivityFeedClearAll: (activityId: number) => Promise<void>;
}

function readActivityFeedPrefs(userId: string | null) {
  try {
    const prefs = loadUserPreferences(userId);
    const width = Math.max(120, Math.min(600, Number(prefs.activityFeed?.width) || 160));
    const height = Math.max(200, Math.min(800, Number(prefs.activityFeed?.height) || 400));
    return {
      isMinimized: prefs.activityFeed?.isMinimized === true,
      position: prefs.activityFeed?.position || DEFAULT_ACTIVITY_FEED_STORED_POSITION,
      width,
      height,
      lastSeenActivityId: Number(prefs.activityFeed?.lastSeenActivityId) || 0,
      clearActivityId: Number(prefs.activityFeed?.clearActivityId) || 0,
      showActivityFeed: prefs.appSettings?.showActivityFeed === true,
    };
  } catch {
    return {
      isMinimized: true,
      position: DEFAULT_ACTIVITY_FEED_STORED_POSITION,
      width: 160,
      height: 400,
      lastSeenActivityId: 0,
      clearActivityId: 0,
      showActivityFeed: false,
    };
  }
}

export const useActivityFeed = (currentUserId: string | null): UseActivityFeedReturn => {
  const [initial] = useState(() => readActivityFeedPrefs(currentUserId));
  const isMobile = useIsMobileViewport();
  const [showActivityFeed, setShowActivityFeed] = useState<boolean>(initial.showActivityFeed);
  // Mobile: always start minimized; expand is session-only (refresh collapses again).
  const [activityFeedMinimized, setActivityFeedMinimized] = useState<boolean>(
    () => isMobileViewport() || initial.isMinimized
  );
  const [activityFeedPosition, setActivityFeedPosition] = useState<{ x: number; y: number }>(
    initial.position
  );
  const [activityFeedDimensions, setActivityFeedDimensions] = useState<{ width: number; height: number }>({
    width: initial.width,
    height: initial.height,
  });
  const [activities, setActivities] = useState<any[]>([]);
  const [lastSeenActivityId, setLastSeenActivityId] = useState<number>(initial.lastSeenActivityId);
  const [clearActivityId, setClearActivityId] = useState<number>(initial.clearActivityId);

  useEffect(() => {
    if (isMobile) {
      setActivityFeedMinimized(true);
    }
  }, [isMobile]);

  const handleActivityFeedToggle = (enabled: boolean) => {
    setShowActivityFeed(enabled);
  };

  const handleActivityFeedMinimizedChange = (minimized: boolean) => {
    setActivityFeedMinimized(minimized);
  };

  const handleActivityFeedMarkAsRead = async (activityId: number) => {
    try {
      await updateActivityFeedPreference('lastSeenActivityId', activityId, currentUserId);
      setLastSeenActivityId(activityId);
    } catch (error) {
      // console.error('Failed to mark activities as read:', error);
    }
  };

  const handleActivityFeedClearAll = async (activityId: number) => {
    try {
      await updateActivityFeedPreference('clearActivityId', activityId, currentUserId);
      await updateActivityFeedPreference('lastSeenActivityId', activityId, currentUserId);
      setClearActivityId(activityId);
      setLastSeenActivityId(activityId);
    } catch (error) {
      // console.error('Failed to clear activities:', error);
    }
  };

  return {
    showActivityFeed,
    activityFeedMinimized,
    activityFeedPosition,
    activityFeedDimensions,
    activities,
    lastSeenActivityId,
    clearActivityId,
    setShowActivityFeed,
    setActivityFeedMinimized,
    setActivityFeedPosition,
    setActivityFeedDimensions,
    setActivities,
    setLastSeenActivityId,
    setClearActivityId,
    handleActivityFeedToggle,
    handleActivityFeedMinimizedChange,
    handleActivityFeedMarkAsRead,
    handleActivityFeedClearAll,
  };
};
