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
  dismissedActivityIds: number[];
  readActivityIds: number[];
  
  // Setters
  setShowActivityFeed: (enabled: boolean) => void;
  setActivityFeedMinimized: (minimized: boolean) => void;
  setActivityFeedPosition: (position: { x: number; y: number }) => void;
  setActivityFeedDimensions: (dimensions: { width: number; height: number }) => void;
  setActivities: (activities: any[]) => void;
  setLastSeenActivityId: (activityId: number) => void;
  setClearActivityId: (activityId: number) => void;
  setDismissedActivityIds: (ids: number[]) => void;
  setReadActivityIds: (ids: number[]) => void;
  
  // Handlers
  handleActivityFeedToggle: (enabled: boolean) => void;
  handleActivityFeedMinimizedChange: (minimized: boolean) => void;
  handleActivityFeedMarkOneAsRead: (activityId: number) => Promise<void>;
  handleActivityFeedMarkAllAsRead: (activityId: number) => Promise<void>;
  handleActivityFeedDismissActivity: (activityId: number) => Promise<void>;
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
      dismissedActivityIds: Array.isArray(prefs.activityFeed?.dismissedActivityIds)
        ? prefs.activityFeed.dismissedActivityIds.map((id) => Number(id)).filter((id) => id > 0)
        : [],
      readActivityIds: Array.isArray(prefs.activityFeed?.readActivityIds)
        ? prefs.activityFeed.readActivityIds.map((id) => Number(id)).filter((id) => id > 0)
        : [],
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
      dismissedActivityIds: [],
      readActivityIds: [],
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
  const [dismissedActivityIds, setDismissedActivityIds] = useState<number[]>(initial.dismissedActivityIds);
  const [readActivityIds, setReadActivityIds] = useState<number[]>(initial.readActivityIds);

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

  /** Mark a single activity read without affecting other unread items. */
  const handleActivityFeedMarkOneAsRead = async (activityId: number) => {
    if (activityId <= lastSeenActivityId || readActivityIds.includes(activityId)) return;
    const nextRead = [...readActivityIds, activityId];
    try {
      await updateActivityFeedPreference('readActivityIds', nextRead, currentUserId);
      setReadActivityIds(nextRead);
    } catch {
      // ignore
    }
  };

  /** Mark everything up to activityId read (bulk watermark). */
  const handleActivityFeedMarkAllAsRead = async (activityId: number) => {
    const nextId = Math.max(lastSeenActivityId, activityId);
    const nextRead = readActivityIds.filter((id) => id > nextId);
    if (nextId === lastSeenActivityId && nextRead.length === readActivityIds.length) return;
    try {
      if (nextId !== lastSeenActivityId) {
        await updateActivityFeedPreference('lastSeenActivityId', nextId, currentUserId);
      }
      if (nextRead.length !== readActivityIds.length) {
        await updateActivityFeedPreference('readActivityIds', nextRead, currentUserId);
      }
      setLastSeenActivityId(nextId);
      setReadActivityIds(nextRead);
    } catch {
      // ignore
    }
  };

  const handleActivityFeedDismissActivity = async (activityId: number) => {
    if (dismissedActivityIds.includes(activityId)) return;
    const nextDismissed = [...dismissedActivityIds, activityId];
    try {
      await updateActivityFeedPreference('dismissedActivityIds', nextDismissed, currentUserId);
      setDismissedActivityIds(nextDismissed);
    } catch {
      // ignore
    }
  };

  const handleActivityFeedClearAll = async (activityId: number) => {
    try {
      await updateActivityFeedPreference('clearActivityId', activityId, currentUserId);
      await updateActivityFeedPreference('lastSeenActivityId', activityId, currentUserId);
      await updateActivityFeedPreference('dismissedActivityIds', [], currentUserId);
      await updateActivityFeedPreference('readActivityIds', [], currentUserId);
      setClearActivityId(activityId);
      setLastSeenActivityId(activityId);
      setDismissedActivityIds([]);
      setReadActivityIds([]);
    } catch {
      // ignore
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
    dismissedActivityIds,
    readActivityIds,
    setShowActivityFeed,
    setActivityFeedMinimized,
    setActivityFeedPosition,
    setActivityFeedDimensions,
    setActivities,
    setLastSeenActivityId,
    setClearActivityId,
    setDismissedActivityIds,
    setReadActivityIds,
    handleActivityFeedToggle,
    handleActivityFeedMinimizedChange,
    handleActivityFeedMarkOneAsRead,
    handleActivityFeedMarkAllAsRead,
    handleActivityFeedDismissActivity,
    handleActivityFeedClearAll,
  };
};
