/**
 * Hook for managing activity feed state and handlers
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadUserPreferences,
  updateActivityFeedPreference,
} from '../utils/userPreferences';
import { DEFAULT_ACTIVITY_FEED_STORED_POSITION } from '../utils/activityFeedPosition';
import { isMobileViewport } from '../utils/mobileViewport';
import { useIsMobileViewport } from './useIsMobileViewport';
import {
  ACTIVITY_FEED_PAGE_SIZE,
  getActivityFeed,
} from '../api';

function sortActivitiesNewestFirst(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const idDiff = (Number(b.id) || 0) - (Number(a.id) || 0);
    if (idDiff !== 0) return idDiff;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

function mergePrependActivities(existing: any[], incoming: any[]): any[] {
  if (!incoming.length) return existing;
  const byId = new Map<number, any>();
  for (const activity of incoming) {
    const id = Number(activity.id);
    if (id > 0) byId.set(id, activity);
  }
  for (const activity of existing) {
    const id = Number(activity.id);
    if (id > 0 && !byId.has(id)) byId.set(id, activity);
  }
  return sortActivitiesNewestFirst(Array.from(byId.values()));
}

function mergeAppendActivities(existing: any[], incoming: any[]): any[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((activity) => Number(activity.id)));
  const toAppend = incoming.filter((activity) => {
    const id = Number(activity.id);
    return id > 0 && !seen.has(id);
  });
  return toAppend.length ? [...existing, ...toAppend] : existing;
}

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
  hasMoreActivities: boolean;
  loadingMoreActivities: boolean;
  
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
  loadMoreActivities: () => Promise<void>;
  syncActivityDelta: (lang?: string) => Promise<void>;
  
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
  const [activities, setActivitiesState] = useState<any[]>([]);
  const [lastSeenActivityId, setLastSeenActivityId] = useState<number>(initial.lastSeenActivityId);
  const [clearActivityId, setClearActivityId] = useState<number>(initial.clearActivityId);
  const [dismissedActivityIds, setDismissedActivityIds] = useState<number[]>(initial.dismissedActivityIds);
  const [readActivityIds, setReadActivityIds] = useState<number[]>(initial.readActivityIds);
  const [hasMoreActivities, setHasMoreActivities] = useState(false);
  const [loadingMoreActivities, setLoadingMoreActivities] = useState(false);
  const activitiesRef = useRef<any[]>([]);
  activitiesRef.current = activities;

  const replaceActivities = useCallback((next: any[]) => {
    const normalized = sortActivitiesNewestFirst(Array.isArray(next) ? next : []);
    activitiesRef.current = normalized;
    setActivitiesState(normalized);
    setHasMoreActivities(normalized.length >= ACTIVITY_FEED_PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setActivityFeedMinimized(true);
    }
  }, [isMobile]);

  const loadMoreActivities = useCallback(async () => {
    if (loadingMoreActivities || !hasMoreActivities) return;
    const current = activitiesRef.current;
    if (!current.length) return;

    const oldestId = current.reduce((min, activity) => {
      const id = Number(activity.id);
      return id > 0 ? Math.min(min, id) : min;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(oldestId)) return;

    setLoadingMoreActivities(true);
    try {
      const older = await getActivityFeed({
        beforeId: oldestId,
        limit: ACTIVITY_FEED_PAGE_SIZE,
      });
      const batch = Array.isArray(older) ? older : [];
      setActivitiesState((prev) => {
        const merged = mergeAppendActivities(prev, batch);
        activitiesRef.current = merged;
        return merged;
      });
      setHasMoreActivities(batch.length >= ACTIVITY_FEED_PAGE_SIZE);
    } catch (error) {
      console.warn('Failed to load more activity feed items:', error);
    } finally {
      setLoadingMoreActivities(false);
    }
  }, [hasMoreActivities, loadingMoreActivities]);

  const syncActivityDelta = useCallback(async (lang?: string) => {
    const current = activitiesRef.current;
    let maxId = current.reduce((max, activity) => {
      const id = Number(activity.id);
      return id > 0 ? Math.max(max, id) : max;
    }, 0);

    try {
      if (maxId <= 0) {
        const initial = await getActivityFeed({ limit: ACTIVITY_FEED_PAGE_SIZE, lang });
        replaceActivities(Array.isArray(initial) ? initial : []);
        return;
      }

      let merged = current;
      for (let pass = 0; pass < 5; pass += 1) {
        const delta = await getActivityFeed({
          sinceId: maxId,
          limit: ACTIVITY_FEED_PAGE_SIZE,
          lang,
        });
        const batch = Array.isArray(delta) ? delta : [];
        if (!batch.length) break;

        merged = mergePrependActivities(merged, batch);
        maxId = batch.reduce((nextMax, activity) => {
          const id = Number(activity.id);
          return id > 0 ? Math.max(nextMax, id) : nextMax;
        }, maxId);

        if (batch.length < ACTIVITY_FEED_PAGE_SIZE) break;
      }

      if (merged !== current) {
        activitiesRef.current = merged;
        setActivitiesState(merged);
      }
    } catch (error) {
      console.warn('Failed to sync activity feed delta:', error);
    }
  }, [replaceActivities]);

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
    hasMoreActivities,
    loadingMoreActivities,
    setShowActivityFeed,
    setActivityFeedMinimized,
    setActivityFeedPosition,
    setActivityFeedDimensions,
    setActivities: replaceActivities,
    setLastSeenActivityId,
    setClearActivityId,
    setDismissedActivityIds,
    setReadActivityIds,
    loadMoreActivities,
    syncActivityDelta,
    handleActivityFeedToggle,
    handleActivityFeedMinimizedChange,
    handleActivityFeedMarkOneAsRead,
    handleActivityFeedMarkAllAsRead,
    handleActivityFeedDismissActivity,
    handleActivityFeedClearAll,
  };
};
