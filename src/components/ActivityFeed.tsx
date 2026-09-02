import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  X,
  Activity,
  Clock,
  Minus,
  Maximize2,
  GripVertical,
  Search,
  Plus,
  Pencil,
  Trash2,
  Tag,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  UserPlus,
  RotateCcw,
  Check,
  CheckCheck,
  CircleDot,
  ListFilter,
  ScrollText,
} from 'lucide-react';
import {
  loadUserPreferencesAsync,
  subscribeToUserPreferences,
  updateActivityFeedPreference,
  type UserPreferences,
} from '../utils/userPreferences';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import { generateTaskUrl, parseTaskRoute } from '../utils/routingUtils';
import { isMobileViewport } from '../utils/mobileViewport';
import {
  DEFAULT_ACTIVITY_FEED_STORED_POSITION,
  resolveActivityFeedPosition,
  toStoredActivityFeedPosition,
} from '../utils/activityFeedPosition';
import { isActivityUnread } from '../utils/activityFeedReadState';
import {
  isColumnMoveActivity,
  summarizeActivityImpact,
} from '../utils/activityFeedCompact';

const MINIMIZED_HEIGHT = 40;
const BOTTOM_MARGIN = 12;
const HEADER_CLEARANCE = 66;
/** Below Tour nudge / Owner guide (9000), Joyride (10000), Perf toolbox (10050). */
const ACTIVITY_FEED_Z = 8500;
const ACTIVITY_FEED_CHROME_Z = 8600;

interface ActivityItem {
  id: number;
  action: string;
  details: string;
  createdAt: string;
  memberName: string;
  roleName: string;
  boardTitle: string;
  columnTitle: string;
  taskId: string;
  /** Board project identifier (e.g. PROJ-00008) when available */
  projectId?: string | null;
  /** Task ticket (e.g. TASK-00238) when the activity is tied to a task */
  taskTicket?: string | null;
  viaApi?: boolean;
}

/** PREFIX-##### tokens (TASK-00001, TICK-00022, PROJ-00007, …). */
const FEED_IDENTIFIER_SPLIT_RE = /(\b[A-Z][A-Z0-9]*-\d+\b)/gi;
const FEED_IDENTIFIER_TEST_RE = /^[A-Z][A-Z0-9]*-\d+$/i;

const ACTIVITY_TASK_LINK_CLASS =
  'text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer';

/** Hash-based href keeps navigation in the SPA without /task/ path (dev + prod). */
function activityFeedTaskHref(ticket: string, projectId?: string | null): string {
  const normalized = ticket.toUpperCase();
  const resolvedProject = projectId?.toUpperCase();
  if (resolvedProject) {
    return generateTaskUrl(normalized, resolvedProject);
  }
  return `#task#${normalized}`;
}

function navigateActivityFeedTaskLink(href: string): void {
  if (href.startsWith('#')) {
    window.location.hash = href;
    return;
  }
  try {
    const taskRoute = parseTaskRoute(new URL(href, window.location.origin).href);
    if (taskRoute.isTaskRoute && taskRoute.taskId) {
      if (taskRoute.projectId) {
        window.location.assign(href);
      } else {
        window.location.hash = `#task#${taskRoute.taskId.toUpperCase()}`;
      }
      return;
    }
  } catch {
    // fall through
  }
  window.location.assign(href);
}

interface ActivityFeedProps {
  isVisible: boolean;
  onClose: () => void;
  isMinimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  activities?: ActivityItem[];
  lastSeenActivityId?: number;
  clearActivityId?: number;
  dismissedActivityIds?: number[];
  readActivityIds?: number[];
  onMarkOneAsRead?: (activityId: number) => void;
  onMarkAllAsRead?: (activityId: number) => void;
  onDismissActivity?: (activityId: number) => void;
  onClearAll?: (activityId: number) => void;
  /** Open the board for a project id (e.g. PROJ-00007) in the current board view. */
  onOpenProject?: (projectId: string) => void;
  /** Jump to a task in the current view (same as header search). */
  onJumpToTask?: (ticket: string, taskId?: string | null) => void;
  /** Known board project ids — any matching token in feed text links to that board. */
  boardProjectIds?: string[];
  hasMoreActivities?: boolean;
  loadingMoreActivities?: boolean;
  onLoadMore?: () => void | Promise<void>;
  position?: { x: number; y: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
  dimensions?: { width: number; height: number };
  onDimensionsChange?: (dimensions: { width: number; height: number }) => void;
  userId?: string | null;
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({ 
  isVisible, 
  onClose, 
  isMinimized: initialIsMinimized = false,
  onMinimizedChange,
  activities = [],
  lastSeenActivityId = 0,
  clearActivityId = 0,
  dismissedActivityIds = [],
  readActivityIds = [],
  onMarkOneAsRead,
  onMarkAllAsRead,
  onDismissActivity,
  onClearAll,
  onOpenProject,
  onJumpToTask,
  boardProjectIds = [],
  hasMoreActivities = false,
  loadingMoreActivities = false,
  onLoadMore,
  position = DEFAULT_ACTIVITY_FEED_STORED_POSITION,
  onPositionChange,
  dimensions = { width: 208, height: 400 },
  onDimensionsChange,
  userId = null
}) => {
  const { t } = useTranslation('common');
  const knownProjectIds = React.useMemo(
    () => new Set(boardProjectIds.map((id) => id.toUpperCase())),
    [boardProjectIds]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prop is source of truth (parent restores from user prefs on refresh)
  const isMinimized = initialIsMinimized;
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState<
    'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null
  >(null);
  /** Absolute viewport coords while dragging/resizing; null uses resolved stored position. */
  const [liveAbsolutePosition, setLiveAbsolutePosition] = useState<{ x: number; y: number } | null>(null);
  const currentDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const currentDragDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  /** Fixed opposite edges for the active resize gesture (avoids drift across frames). */
  const resizeAnchorRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef<typeof isResizing>(null);
  const dragOffsetRef = useRef(dragOffset);
  const dimensionsRef = useRef(dimensions);
  const viewportSizeRef = useRef({ w: 1200, h: 800 });
  const isMinimizedRef = useRef(isMinimized);
  const positionRef = useRef(position);
  const feedRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listScrollHintTimerRef = useRef<number | null>(null);
  const [listScrollThumb, setListScrollThumb] = useState<{ top: number; height: number } | null>(
    null
  );
  const [listScrollHint, setListScrollHint] = useState(false);
  const [showDimensionsTooltip, setShowDimensionsTooltip] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  dragOffsetRef.current = dragOffset;
  dimensionsRef.current = dimensions;
  viewportSizeRef.current = viewportSize;
  isMinimizedRef.current = isMinimized;
  positionRef.current = position;
  
  // Filter state
  const [filterText, setFilterText] = useState('');
  const [taskImpactView, setTaskImpactView] = useState(true);
  const [expandedCompactIds, setExpandedCompactIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Clear live override when stored position changes from outside (e.g. prefs load).
  // Do not key off isDragging/isResizing — clearing on resize-end before position
  // commits is what caused the snap-back flash.
  useEffect(() => {
    if (!isDraggingRef.current && !isResizingRef.current) {
      setLiveAbsolutePosition(null);
    }
  }, [position.x, position.y]);

  const persistStoredPosition = async (absolute: { x: number; y: number }, width: number) => {
    const stored = toStoredActivityFeedPosition(absolute, width, viewportSizeRef.current.w);
    onPositionChange?.(stored);
    try {
      await updateActivityFeedPreference('position', stored, userId);
    } catch (error) {
      console.error('Failed to save activity feed position:', error);
    }
  };

  // Utility function to ensure ActivityFeed stays within viewport and above header
  function constrainAbsolute(pos: { x: number; y: number }, dims: { width: number; height: number }) {
    const viewportWidth = viewportSizeRef.current.w;
    const viewportHeight = viewportSizeRef.current.h;
    const margin = 10;
    const constrainedX = Math.max(margin, Math.min(viewportWidth - dims.width - margin, pos.x));
    const minY = HEADER_CLEARANCE;
    const maxY = Math.max(minY, viewportHeight - dims.height - margin);
    const constrainedY = Math.max(minY, Math.min(maxY, pos.y));
    return { x: constrainedX, y: constrainedY };
  }

  const resolvedAbsolute = resolveActivityFeedPosition(
    position,
    dimensions.width,
    viewportSize.w
  );
  // Minimized shares the same preferred X; only Y is pinned to the bottom
  const dockAbsolute = constrainAbsolute(
    {
      x: resolvedAbsolute.x,
      y: viewportSize.h - MINIMIZED_HEIGHT - BOTTOM_MARGIN,
    },
    { width: dimensions.width, height: MINIMIZED_HEIGHT }
  );

  const displayAbsolute =
    liveAbsolutePosition ||
    (isMinimized ? dockAbsolute : resolvedAbsolute);

  // Load saved feed prefs (async DB merge on login; subscribe for post-logout reload)
  useEffect(() => {
    let cancelled = false;

    const applyFeedPrefs = (prefs: UserPreferences) => {
      if (cancelled) return;
      setFilterText(prefs.activityFeed.filterText || '');
      setTaskImpactView(prefs.activityFeed.taskImpactView !== false);
    };

    const loadFeedPrefs = async () => {
      if (!userId) {
        setFilterText('');
        setTaskImpactView(true);
        return;
      }
      try {
        const prefs = await loadUserPreferencesAsync(userId);
        applyFeedPrefs(prefs);
      } catch (error) {
        console.error('Failed to load activity feed preferences:', error);
      }
    };

    void loadFeedPrefs();

    const unsubscribe = subscribeToUserPreferences((prefs, prefsUserId) => {
      if (prefsUserId === userId) {
        applyFeedPrefs(prefs);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  const handleMinimize = async () => {
    // Shared position pref stays as-is; minimized only changes chrome + bottom Y
    await handleMinimizedChange(true);
  };

  const handleMinimizedChange = async (minimized: boolean) => {
    onMinimizedChange?.(minimized);
    
    if (!minimized) {
      // Expand to the same preferred X/Y (updated if the pill was dragged)
      setLiveAbsolutePosition(null);
      const adjusted = constrainAbsolute(
        resolveActivityFeedPosition(position, dimensions.width, viewportSize.w),
        dimensions
      );
      await persistStoredPosition(adjusted, dimensions.width);
    }
    
    try {
      // Mobile expand is session-only — do not persist so refresh starts minimized again.
      if (isMobileViewport() && !minimized) {
        return;
      }
      await updateActivityFeedPreference('isMinimized', minimized, userId);
    } catch (error) {
      console.error('Failed to save activity feed minimized state:', error);
    }
  };

  // Drag functionality
  const handleDragStart = (e: React.MouseEvent) => {
    if (!feedRef.current) return;
    
    const rect = feedRef.current.getBoundingClientRect();
    const offset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    dragOffsetRef.current = offset;
    setDragOffset(offset);
    isDraggingRef.current = true;
    setIsDragging(true);
    setShowDimensionsTooltip(true);
    
    // Prevent text selection
    e.preventDefault();
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;

    const offset = dragOffsetRef.current;
    const dims = dimensionsRef.current;
    const vw = viewportSizeRef.current;
    const minimized = isMinimizedRef.current;
    
    const newX = e.clientX - offset.x;
    const feedDims = minimized
      ? { width: dims.width, height: MINIMIZED_HEIGHT }
      : dims;
    // Minimized: stay on the bottom edge; free horizontal placement
    const newY = minimized
      ? vw.h - MINIMIZED_HEIGHT - BOTTOM_MARGIN
      : e.clientY - offset.y;
    const newPosition = constrainAbsolute({ x: newX, y: newY }, feedDims);
    currentDragPositionRef.current = newPosition;
    setLiveAbsolutePosition(newPosition);
  };

  const handleDragEnd = async () => {
    if (!isDraggingRef.current) return;

    const dims = dimensionsRef.current;
    const absoluteToSave =
      currentDragPositionRef.current ||
      resolveActivityFeedPosition(positionRef.current, dims.width, viewportSizeRef.current.w);
    currentDragPositionRef.current = null;

    if (isMinimizedRef.current) {
      const bottomY = viewportSizeRef.current.h - MINIMIZED_HEIGHT - BOTTOM_MARGIN;
      const clamped = constrainAbsolute(
        { x: absoluteToSave.x, y: bottomY },
        { width: dims.width, height: MINIMIZED_HEIGHT }
      );
      // Update shared preferred position: new X, keep expanded Y
      const stored = toStoredActivityFeedPosition(
        { x: clamped.x, y: positionRef.current.y },
        dims.width,
        viewportSizeRef.current.w
      );
      stored.y = positionRef.current.y;
      // Commit parent state before clearing live overlay (avoids snap-back)
      onPositionChange?.(stored);
      isDraggingRef.current = false;
      setIsDragging(false);
      setShowDimensionsTooltip(false);
      // Clear live after parent props can commit (same-event batch + next frame)
      requestAnimationFrame(() => setLiveAbsolutePosition(null));
      try {
        await updateActivityFeedPreference('position', stored, userId);
      } catch (error) {
        console.error('Failed to save activity feed position:', error);
      }
      return;
    }

    const stored = toStoredActivityFeedPosition(
      absoluteToSave,
      dims.width,
      viewportSizeRef.current.w
    );
    onPositionChange?.(stored);
    isDraggingRef.current = false;
    setIsDragging(false);
    setShowDimensionsTooltip(false);
    requestAnimationFrame(() => setLiveAbsolutePosition(null));
    try {
      await updateActivityFeedPreference('position', stored, userId);
    } catch (error) {
      console.error('Failed to save activity feed position:', error);
    }
  };

  // Resize functionality — any edge or corner
  const handleResizeStart = (
    e: React.MouseEvent,
    resizeType: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  ) => {
    if (!feedRef.current) return;
    const startPos =
      liveAbsolutePosition ||
      resolveActivityFeedPosition(position, dimensions.width, viewportSize.w);
    currentDragPositionRef.current = startPos;
    currentDragDimensionsRef.current = { ...dimensions };
    resizeAnchorRef.current = {
      left: startPos.x,
      top: startPos.y,
      right: startPos.x + dimensions.width,
      bottom: startPos.y + dimensions.height,
    };
    isResizingRef.current = resizeType;
    setIsResizing(resizeType);
    setShowDimensionsTooltip(true);
    e.preventDefault();
    e.stopPropagation();
  };

  const handleResizeMove = (e: MouseEvent) => {
    const resizeType = isResizingRef.current;
    const anchor = resizeAnchorRef.current;
    if (!resizeType || !anchor) return;

    const minW = 120;
    const maxW = 600;
    const minH = 200;
    const maxH = viewportSizeRef.current.h * 0.8;

    let newWidth = anchor.right - anchor.left;
    let newHeight = anchor.bottom - anchor.top;
    let newX = anchor.left;
    let newY = anchor.top;

    const resizeE = resizeType === 'e' || resizeType === 'ne' || resizeType === 'se';
    const resizeW = resizeType === 'w' || resizeType === 'nw' || resizeType === 'sw';
    const resizeS = resizeType === 's' || resizeType === 'se' || resizeType === 'sw';
    const resizeN = resizeType === 'n' || resizeType === 'ne' || resizeType === 'nw';

    if (resizeE) {
      newWidth = Math.max(minW, Math.min(maxW, e.clientX - anchor.left));
    }

    if (resizeW) {
      const proposedWidth = Math.max(minW, Math.min(maxW, anchor.right - e.clientX));
      newWidth = proposedWidth;
      newX = anchor.right - proposedWidth;
      if (newX < 10) {
        newX = 10;
        newWidth = Math.max(minW, Math.min(maxW, anchor.right - newX));
      }
    }

    if (resizeS) {
      newHeight = Math.max(minH, Math.min(maxH, e.clientY - anchor.top));
    }

    if (resizeN) {
      const proposedHeight = Math.max(minH, Math.min(maxH, anchor.bottom - e.clientY));
      newHeight = proposedHeight;
      newY = anchor.bottom - proposedHeight;
      if (newY < HEADER_CLEARANCE) {
        newY = HEADER_CLEARANCE;
        newHeight = Math.max(minH, Math.min(maxH, anchor.bottom - newY));
      }
    }

    const newDimensions = { width: newWidth, height: newHeight };
    const newPosition = constrainAbsolute(
      { x: newX, y: newY },
      newDimensions
    );
    currentDragDimensionsRef.current = newDimensions;
    currentDragPositionRef.current = newPosition;
    onDimensionsChange?.(newDimensions);
    setLiveAbsolutePosition(newPosition);
  };

  const handleResizeEnd = async () => {
    if (!isResizingRef.current) return;

    const dimensionsToSave =
      currentDragDimensionsRef.current || dimensionsRef.current;
    const absoluteToSave =
      currentDragPositionRef.current ||
      resolveActivityFeedPosition(
        positionRef.current,
        dimensionsToSave.width,
        viewportSizeRef.current.w
      );
    const stored = toStoredActivityFeedPosition(
      absoluteToSave,
      dimensionsToSave.width,
      viewportSizeRef.current.w
    );

    // Commit parent layout before clearing live overlay (avoids snap-back)
    onDimensionsChange?.(dimensionsToSave);
    onPositionChange?.(stored);
    isResizingRef.current = null;
    resizeAnchorRef.current = null;
    setIsResizing(null);
    setShowDimensionsTooltip(false);
    currentDragDimensionsRef.current = null;
    currentDragPositionRef.current = null;
    // Wait a frame so new position/dimensions props apply before dropping the override
    requestAnimationFrame(() => setLiveAbsolutePosition(null));

    try {
      await updateActivityFeedPreference('width', dimensionsToSave.width, userId);
      await updateActivityFeedPreference('height', dimensionsToSave.height, userId);
      await updateActivityFeedPreference('position', stored, userId);
    } catch (error) {
      console.error('Failed to save activity feed dimensions/position:', error);
    }
  };

  // Add global mouse event listeners for dragging and resizing
  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => handleDragMove(e);
    const handleEnd = () => {
      void handleDragEnd();
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => handleResizeMove(e);
    const handleEnd = () => {
      void handleResizeEnd();
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
    };
  }, [isResizing]);

  useEffect(() => {
    const sync = () => {
      const el = listScrollRef.current;
      if (!el) {
        setListScrollThumb(null);
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight + 2) {
        setListScrollThumb(null);
        return;
      }
      const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
      const travel = scrollHeight - clientHeight;
      const top = travel <= 0 ? 0 : (scrollTop / travel) * (clientHeight - height);
      setListScrollThumb({ top, height });
    };

    sync();
    const el = listScrollRef.current;
    if (!el) return undefined;
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(el);
    return () => {
      resizeObserver.disconnect();
      if (listScrollHintTimerRef.current != null) {
        window.clearTimeout(listScrollHintTimerRef.current);
      }
    };
  }, [isMinimized, dimensions.height, activities.length]);

  const formatTimeAgo = (timestamp: string | undefined, short: boolean = false) => {
    if (!timestamp) {
      return t('activityFeed.unknownTime');
    }
    
    const now = new Date();
    const activityTime = new Date(timestamp);
    
    // Debug logging (can remove later)
    if (isNaN(activityTime.getTime())) {
      console.warn('Invalid timestamp:', timestamp);
      return t('activityFeed.unknownTime');
    }
    
    const diffMs = now.getTime() - activityTime.getTime();
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return t('activityFeed.justNow');
    if (diffMinutes < 60) return short ? t('activityFeed.minutesAgoShort', { count: diffMinutes }) : t('activityFeed.minutesAgo', { count: diffMinutes });
    if (diffHours < 24) return short ? t('activityFeed.hoursAgoShort', { count: diffHours }) : t('activityFeed.hoursAgo', { count: diffHours });
    if (diffDays < 7) return short ? t('activityFeed.daysAgoShort', { count: diffDays }) : t('activityFeed.daysAgo', { count: diffDays });
    
    return activityTime.toLocaleDateString();
  };

  const formatActivityDescription = (activity: ActivityItem) => {
    const { memberName, details, boardTitle, viaApi, projectId } = activity;
    const name = memberName || t('activityFeed.unknownUser');
    
    // Extract the main action from details
    let description = details || '';
    
    // Add board context if available and not already included in details
    // Check for both English and French patterns to avoid duplicates
    const hasBoardContext = description.includes('board') || 
                           description.includes('tableau') || 
                           description.includes('dans le tableau') ||
                           description.includes('in board');
    
    if (boardTitle && !hasBoardContext) {
      description += ` ${t('activityFeed.in')} ${boardTitle}`;
    }

    return { name, description, viaApi: Boolean(viaApi) };
  };

  const findProjectHintInText = (text: string, activityProjectId?: string | null): string | undefined => {
    if (activityProjectId) {
      return activityProjectId.toUpperCase();
    }
    const tokens = text.match(/\b[A-Z][A-Z0-9]*-\d+\b/gi) || [];
    for (const token of tokens) {
      const upper = token.toUpperCase();
      if (knownProjectIds.has(upper)) {
        return upper;
      }
    }
    return undefined;
  };

  const renderActivityDescriptionText = (
    text: string,
    projectId: string | null | undefined,
    searchTerm: string,
    activityTaskHint?: { taskId?: string | null; taskTicket?: string | null }
  ): React.ReactNode => {
    if (!text) return null;
    const resolvedProject = findProjectHintInText(text, projectId);

    return text.split(FEED_IDENTIFIER_SPLIT_RE).map((part, index) => {
      if (!part || !FEED_IDENTIFIER_TEST_RE.test(part)) {
        return part ? <React.Fragment key={index}>{highlightText(part, searchTerm)}</React.Fragment> : null;
      }
      const token = part.toUpperCase();
      if (knownProjectIds.has(token)) {
        return (
          <KanbanChromeTooltip
            key={`${token}-${index}`}
            label={t('activityFeed.jumpToBoard', { project: token })}
            placement="top"
            portalZIndex={ACTIVITY_FEED_CHROME_Z}
            wrapperClassName="inline"
          >
            <a
              href="#"
              className={ACTIVITY_TASK_LINK_CLASS}
              aria-label={t('activityFeed.jumpToBoard', { project: token })}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenProject?.(token);
              }}
            >
              {highlightText(part, searchTerm)}
            </a>
          </KanbanChromeTooltip>
        );
      }
      const href = activityFeedTaskHref(token, resolvedProject);
      const hintTaskId =
        activityTaskHint?.taskTicket?.toUpperCase() === token
          ? activityTaskHint.taskId
          : undefined;
      const taskLinkLabel = onJumpToTask
        ? t('activityFeed.jumpToTask', { ticket: token })
        : t('activityFeed.openTask', { ticket: token });
      return (
        <KanbanChromeTooltip
          key={`${token}-${index}`}
          label={taskLinkLabel}
          placement="top"
          portalZIndex={ACTIVITY_FEED_CHROME_Z}
          wrapperClassName="inline"
        >
          <a
            href={href}
            className={ACTIVITY_TASK_LINK_CLASS}
            aria-label={taskLinkLabel}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onJumpToTask) {
                onJumpToTask(token, hintTaskId);
              } else {
                navigateActivityFeedTaskLink(href);
              }
            }}
          >
            {highlightText(part, searchTerm)}
          </a>
        </KanbanChromeTooltip>
      );
    });
  };

  const getActionIcon = (action: string, sizeClass = 'w-3.5 h-3.5', details = '') => {
    const className = `${sizeClass} shrink-0`;
    if (action.includes('agent_job_done')) {
      return <CheckCircle2 className={`${className} text-emerald-600 dark:text-emerald-400`} />;
    }
    if (action.includes('agent_job_failed')) {
      return <AlertTriangle className={`${className} text-amber-600 dark:text-amber-400`} />;
    }
    if (action.includes('member_joined') || action.includes('account_activated')) {
      return <UserPlus className={`${className} text-emerald-600 dark:text-emerald-400`} />;
    }
    if (action.includes('create')) {
      return <Plus className={`${className} text-sky-600 dark:text-sky-400`} />;
    }
    if (isColumnMoveActivity(action, details)) {
      return <CircleDot className={`${className} text-indigo-600 dark:text-indigo-400`} />;
    }
    if (action.includes('move')) {
      return <ArrowRightLeft className={`${className} text-indigo-600 dark:text-indigo-400`} />;
    }
    if (action.includes('update')) {
      return <Pencil className={`${className} text-slate-500 dark:text-slate-400`} />;
    }
    if (action.includes('delete')) {
      return <Trash2 className={`${className} text-rose-600 dark:text-rose-400`} />;
    }
    if (action.includes('restore')) {
      return <RotateCcw className={`${className} text-emerald-600 dark:text-emerald-400`} />;
    }
    if (action.includes('tag')) {
      return <Tag className={`${className} text-violet-600 dark:text-violet-400`} />;
    }
    return <FileText className={`${className} text-slate-500 dark:text-slate-400`} />;
  };

  // Filter activities based on text input
  const filterActivities = (activities: ActivityItem[], filterText: string): ActivityItem[] => {
    if (!filterText.trim()) return activities;
    
    const searchTerm = filterText.toLowerCase().trim();
    return activities.filter(activity => {
      // Search in multiple fields
      const searchableText = [
        activity.memberName || '',
        activity.details || '',
        activity.action || '',
        activity.boardTitle || '',
        activity.columnTitle || '',
        activity.viaApi ? 'via api' : ''
      ].join(' ').toLowerCase();
      
      return searchableText.includes(searchTerm);
    });
  };

  // Handle filter input change
  const handleFilterChange = (value: string) => {
    setFilterText(value);
    // Save filter preference
    if (userId) {
      updateActivityFeedPreference('filterText', value, userId).catch(error => {
        console.error('Failed to save activity filter preference:', error);
      });
    }
  };

  // Clear filter
  const clearFilter = () => {
    setFilterText('');
    if (userId) {
      updateActivityFeedPreference('filterText', '', userId).catch(error => {
        console.error('Failed to clear activity filter preference:', error);
      });
    }
  };

  const handleTaskImpactViewToggle = () => {
    const next = !taskImpactView;
    setTaskImpactView(next);
    setExpandedCompactIds(new Set());
    if (userId) {
      updateActivityFeedPreference('taskImpactView', next, userId).catch(error => {
        console.error('Failed to save activity feed view preference:', error);
      });
    }
  };

  const toggleCompactActivityExpand = (activityId: number) => {
    setExpandedCompactIds((prev) => {
      const next = new Set(prev);
      if (next.has(activityId)) {
        next.delete(activityId);
      } else {
        next.add(activityId);
      }
      return next;
    });
  };

  const compactSummaryFor = (activity: ActivityItem): string | null =>
    summarizeActivityImpact(activity, knownProjectIds, t);

  // Highlight search terms in text - returns React components for regular display
  const highlightText = (text: string, searchTerm: string): React.ReactNode => {
    if (!searchTerm.trim() || !text) {
      return text;
    }

    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => {
      const isMatch = regex.test(part);
      // Reset regex lastIndex to avoid issues with global flag
      regex.lastIndex = 0;
      
      if (isMatch) {
        return (
          <span 
            key={index} 
            className="bg-yellow-200 text-yellow-900 px-0.5 rounded font-medium"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  if (!isVisible) return null;

  const dismissedIdSet = new Set(dismissedActivityIds);
  const readIdSet = new Set(readActivityIds);

  // Step 1: Filter activities based on clear point and individually dismissed items
  const visibleActivities = activities.filter(
    (activity) => activity.id > clearActivityId && !dismissedIdSet.has(activity.id)
  );
  
  // Step 2: Apply text filter to visible activities
  const filteredActivities = filterActivities(visibleActivities, filterText);
  
  // Step 3: Within filtered activities, determine which are "unread"
  const unreadActivities = filteredActivities.filter((activity) =>
    isActivityUnread(activity.id, lastSeenActivityId, readIdSet)
  );
  const unreadCount = unreadActivities.length;
  const unreadBadgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  
  // Use filtered activities for display (task-impact view hides non-task noise)
  const displayActivities = taskImpactView
    ? filteredActivities.filter((activity) => compactSummaryFor(activity) !== null)
    : filteredActivities;
  
  // Get latest activity for minimized view (could be read or unread)
  const latestActivity = activities.length > 0 ? activities[0] : null;
  
  // Handle mark as read - marks visible activities as read
  const handleMarkAllAsRead = () => {
    if (visibleActivities.length > 0 && onMarkAllAsRead) {
      const latestVisibleId = Math.max(...visibleActivities.map(a => a.id));
      onMarkAllAsRead(latestVisibleId);
    }
  };

  const handleMarkOneAsRead = (activityId: number) => {
    onMarkOneAsRead?.(activityId);
  };

  // Handle clear all - sets clear point to hide current activities
  const handleClearAll = () => {
    if (onClearAll && activities.length > 0) {
      const clearId = Math.max(...activities.map(a => a.id));
      onClearAll(clearId);
    }
  };

  const handleDismissActivity = (activityId: number) => {
    onDismissActivity?.(activityId);
  };

  const isNarrowMode = dimensions.width <= 160;
  const isExtraNarrowMode = dimensions.width <= 130;

  const syncListScrollThumb = () => {
    const el = listScrollRef.current;
    if (!el) {
      setListScrollThumb(null);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 2) {
      setListScrollThumb(null);
      return;
    }
    const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
    const travel = scrollHeight - clientHeight;
    const top = travel <= 0 ? 0 : (scrollTop / travel) * (clientHeight - height);
    setListScrollThumb({ top, height });
  };

  const revealListScroll = () => {
    syncListScrollThumb();
    setListScrollHint(true);
    if (listScrollHintTimerRef.current != null) {
      window.clearTimeout(listScrollHintTimerRef.current);
    }
    listScrollHintTimerRef.current = window.setTimeout(() => {
      setListScrollHint(false);
      listScrollHintTimerRef.current = null;
    }, 800);
  };
  
  if (isMinimized) {
    const compactLatest =
      latestActivity && taskImpactView
        ? compactSummaryFor(latestActivity)
        : null;
    const preview =
      latestActivity
        ? compactLatest ||
          `${latestActivity.memberName || t('activityFeed.unknownUser')}${
            latestActivity.details ? ` · ${latestActivity.details}` : ''
          }`
        : t('activityFeed.noRecentActivity');

    return (
      <div 
        ref={feedRef}
        className={`fixed flex items-center gap-1 rounded-full border border-slate-200/80 dark:border-slate-600/80 bg-white/95 dark:bg-slate-900/95 shadow-lg backdrop-blur-md px-1.5 ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
          left: displayAbsolute.x,
          top: displayAbsolute.y,
          width: dimensions.width,
          height: MINIMIZED_HEIGHT,
          zIndex: ACTIVITY_FEED_Z,
        }}
      >
        <div
          className="cursor-grab active:cursor-grabbing p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          onMouseDown={handleDragStart}
          aria-hidden
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        <button
          type="button"
          onClick={() => void handleMinimizedChange(false)}
          className="min-w-0 flex-1 flex items-center gap-1.5 text-left rounded-full px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
          aria-label={t('activityFeed.expand')}
        >
          <KanbanChromeTooltip
            delayMs={200}
            placement="top"
            portalZIndex={ACTIVITY_FEED_CHROME_Z}
            wrapperClassName="relative inline-flex shrink-0"
            content={
              <div className="max-w-[min(18rem,calc(100vw-2rem))] space-y-1">
                <div className="font-semibold text-white dark:text-gray-900">
                  {t('activityFeed.title')}
                  {unreadCount > 0 ? ` · ${unreadCount}` : ''}
                </div>
                <div className="text-white/90 dark:text-gray-800 break-words whitespace-normal">
                  {preview}
                </div>
              </div>
            }
          >
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400">
              {latestActivity ? getActionIcon(latestActivity.action, 'w-3.5 h-3.5', latestActivity.details) : <Activity className="w-3.5 h-3.5" />}
              <span
                className={`absolute -top-1 -right-1.5 min-w-[1.15rem] h-4 px-1 rounded-full text-[9px] font-semibold leading-4 text-center tabular-nums ${
                  unreadCount > 0
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100'
                }`}
              >
                {unreadBadgeLabel}
              </span>
            </span>
          </KanbanChromeTooltip>
          <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
            {t('activityFeed.titleShort')}
          </span>
        </button>

        <div className="flex items-center shrink-0">
          <KanbanChromeTooltip label={t('activityFeed.expand')} placement="top" portalZIndex={ACTIVITY_FEED_CHROME_Z}>
            <button
              type="button"
              onClick={() => void handleMinimizedChange(false)}
              className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={t('activityFeed.expand')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </KanbanChromeTooltip>
          <KanbanChromeTooltip label={t('activityFeed.close')} placement="top" portalZIndex={ACTIVITY_FEED_CHROME_Z}>
            <button
              type="button"
              onClick={onClose}
              data-help-target="activity-feed-close"
              className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={t('activityFeed.close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </KanbanChromeTooltip>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={feedRef}
      className={`fixed flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-600/80 bg-white dark:bg-slate-900 shadow-2xl shadow-slate-900/10 dark:shadow-black/40 ${isDragging ? 'cursor-grabbing' : ''} ${isResizing ? 'select-none' : ''}`}
      style={{
        left: displayAbsolute.x,
        top: displayAbsolute.y,
        width: dimensions.width,
        height: dimensions.height,
        zIndex: ACTIVITY_FEED_Z,
      }}
      aria-label={t('activityFeed.title')}
    >
      {/* Header: controls only (title is rarely visible over the board) */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40">
        <div 
          className="cursor-grab active:cursor-grabbing p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          onMouseDown={handleDragStart}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {unreadCount > 0 && (
            <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-sky-600 text-white text-[10px] font-semibold leading-5 text-center tabular-nums">
              {unreadBadgeLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <KanbanChromeTooltip label={t('activityFeed.minimize')}>
            <button
              type="button"
              onClick={() => void handleMinimize()}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
              aria-label={t('activityFeed.minimize')}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </KanbanChromeTooltip>
          
          <KanbanChromeTooltip label={t('activityFeed.close')}>
            <button
              type="button"
              onClick={onClose}
              data-help-target="activity-feed-close"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
              aria-label={t('activityFeed.close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </KanbanChromeTooltip>
        </div>
      </div>

      {/* Filter */}
      <div className={`border-b border-slate-100 dark:border-slate-800 ${isNarrowMode ? 'p-1.5' : 'p-2'}`}>
        <div className="relative">
          {!isExtraNarrowMode && (
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <Search className="h-3 w-3 text-slate-400" />
            </div>
          )}
          <input
            type="text"
            placeholder={isNarrowMode ? t('activityFeed.filterShort') : t('activityFeed.filter')}
            value={filterText}
            onChange={(e) => handleFilterChange(e.target.value)}
            className={`block w-full py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl leading-4 bg-slate-50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 ${
              isExtraNarrowMode ? 'pl-2.5 pr-7' : 'pl-8 pr-7'
            }`}
          />
          {filterText && (
            <KanbanChromeTooltip label={t('activityFeed.clearFilter')} wrapperClassName="absolute inset-y-0 right-0 pr-2 flex items-center">
              <button
                type="button"
                onClick={clearFilter}
                className="flex items-center p-0.5 rounded hover:bg-slate-200/80 dark:hover:bg-slate-800"
              >
                <X className="h-3 w-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
              </button>
            </KanbanChromeTooltip>
          )}
        </div>
        {filterText && !isNarrowMode && (
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {t('activityFeed.activitiesShown', { showing: displayActivities.length, total: visibleActivities.length })}
          </div>
        )}
        {filterText && isNarrowMode && (
          <div className="mt-1 text-[11px] text-slate-500 text-center">
            {displayActivities.length}/{visibleActivities.length}
          </div>
        )}
      </div>

      {/* Content — native scrollbar hidden; thin overlay only while scrolling/hover (Windows). */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={listScrollRef}
        className={`absolute inset-0 overflow-y-auto hide-scrollbar ${isNarrowMode ? 'p-1.5' : 'p-2'}`}
        onScroll={revealListScroll}
        onMouseEnter={revealListScroll}
      >
        {loading && activities.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-sky-600 border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="text-rose-600 dark:text-rose-400 text-xs text-center py-3">
            {error}
          </div>
        )}

        {!loading && displayActivities.length === 0 && (
          <div className="text-slate-500 dark:text-slate-400 text-xs text-center py-8 px-2">
            {clearActivityId > 0
              ? t('activityFeed.feedClearedNew')
              : taskImpactView && filteredActivities.length > 0
                ? t('activityFeed.compact.noTaskImpact')
                : taskImpactView && visibleActivities.length > 0
                  ? t('activityFeed.compact.noTaskImpactHint')
                  : t('activityFeed.noRecentActivity')}
          </div>
        )}

        <div className="space-y-1">
          {displayActivities.map((activity) => {
            const compactSummary = taskImpactView ? compactSummaryFor(activity) : null;
            const isCompactExpanded =
              taskImpactView && compactSummary !== null && expandedCompactIds.has(activity.id);
            const showCompactSummary = compactSummary !== null && !isCompactExpanded;
            const isCompactExpandable = taskImpactView && compactSummary !== null;
            const { name, description, viaApi } = formatActivityDescription(activity);
            const isUnread = isActivityUnread(activity.id, lastSeenActivityId, readIdSet);
            const actorClass = isUnread
              ? 'text-sky-800 dark:text-sky-200'
              : 'text-slate-800 dark:text-slate-100';
            return (
              <div 
                key={activity.id} 
                role={isCompactExpandable ? 'button' : undefined}
                tabIndex={isCompactExpandable ? 0 : undefined}
                aria-expanded={isCompactExpandable ? isCompactExpanded : undefined}
                aria-label={
                  isCompactExpandable
                    ? isCompactExpanded
                      ? t('activityFeed.compact.collapseRow')
                      : t('activityFeed.compact.expandRow')
                    : undefined
                }
                onClick={
                  isCompactExpandable
                    ? () => toggleCompactActivityExpand(activity.id)
                    : undefined
                }
                onKeyDown={
                  isCompactExpandable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCompactActivityExpand(activity.id);
                        }
                      }
                    : undefined
                }
                className={`group/item relative min-w-0 rounded-xl transition-colors ${
                  isNarrowMode ? 'p-1.5' : 'p-2'
                } ${
                  isUnread 
                    ? 'bg-sky-50/90 dark:bg-sky-950/30 ring-1 ring-inset ring-sky-200/70 dark:ring-sky-800/50' 
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                } ${
                  isCompactExpandable ? 'cursor-pointer' : ''
                }`}
              >
                <div className="text-xs text-slate-800 dark:text-slate-100 leading-snug">
                  {showCompactSummary ? (
                    <div className="flex items-start gap-1.5 min-w-0">
                      <span
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 mt-0.5"
                        aria-hidden
                      >
                        {getActionIcon(activity.action, 'w-2.5 h-2.5', activity.details)}
                      </span>
                      <div className="min-w-0 flex-1 font-medium text-slate-700 dark:text-slate-200">
                        {renderActivityDescriptionText(compactSummary, activity.projectId, filterText, {
                          taskId: activity.taskId,
                          taskTicket: activity.taskTicket,
                        })}
                        {viaApi && (
                          <span className="ml-1 text-slate-400 dark:text-slate-500 font-normal">
                            {t('activityFeed.viaApi')}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                  {/* Icon sits with the actor only; wrapped lines use full feed width */}
                  <span className={`inline-flex items-center gap-1 max-w-full font-semibold align-middle ${actorClass}`}>
                    <span
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"
                      aria-hidden
                    >
                      {getActionIcon(activity.action, 'w-2.5 h-2.5', activity.details)}
                    </span>
                    <span className={isNarrowMode ? 'truncate' : undefined}>
                      {highlightText(name, filterText)}
                    </span>
                    {viaApi && (
                      <span className="text-slate-400 dark:text-slate-500 font-normal shrink-0">
                        {t('activityFeed.viaApi')}
                      </span>
                    )}
                  </span>
                  {isNarrowMode ? (
                    <div className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-300">
                      {renderActivityDescriptionText(description, activity.projectId, filterText, {
                        taskId: activity.taskId,
                        taskTicket: activity.taskTicket,
                      })}
                    </div>
                  ) : (
                    <>
                      {' '}
                      <span className="text-slate-600 dark:text-slate-300 align-middle">
                        {renderActivityDescriptionText(description, activity.projectId, filterText, {
                          taskId: activity.taskId,
                          taskTicket: activity.taskTicket,
                        })}
                      </span>
                    </>
                  )}
                    </>
                  )}
                </div>
                <div className={`flex items-center mt-1 gap-1 ${isNarrowMode ? '' : 'gap-1.5'}`}>
                  <Clock className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                  <span className="min-w-0 flex-1 text-[11px] text-slate-500 dark:text-slate-400 leading-none truncate">
                    {isNarrowMode ? formatTimeAgo(activity.createdAt, true) : formatTimeAgo(activity.createdAt)}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-25 group-hover/item:opacity-100 focus-within:opacity-100 transition-opacity">
                    {isUnread && (
                      <KanbanChromeTooltip label={t('activityFeed.markOneRead')} placement="top" portalZIndex={ACTIVITY_FEED_CHROME_Z}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkOneAsRead(activity.id);
                          }}
                          className="p-0.5 rounded text-sky-600/80 dark:text-sky-400/80 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-100/80 dark:hover:bg-sky-900/40"
                          aria-label={t('activityFeed.markOneRead')}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </KanbanChromeTooltip>
                    )}
                    <KanbanChromeTooltip label={t('activityFeed.dismissOne')} placement="top" portalZIndex={ACTIVITY_FEED_CHROME_Z}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDismissActivity(activity.id);
                        }}
                        className="p-0.5 rounded text-slate-500/80 dark:text-slate-400/80 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        aria-label={t('activityFeed.dismissOne')}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </KanbanChromeTooltip>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {hasMoreActivities && onLoadMore && (
          <div className={`${isNarrowMode ? 'pt-1' : 'pt-1.5'} flex justify-center`}>
            <button
              type="button"
              onClick={() => void onLoadMore()}
              disabled={loadingMoreActivities}
              className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              aria-busy={loadingMoreActivities}
            >
              {loadingMoreActivities ? t('activityFeed.loadingMore') : t('activityFeed.loadMore')}
            </button>
          </div>
        )}
      </div>
      {listScrollThumb && (
        <div
          className={`pointer-events-none absolute right-0.5 top-1 bottom-1 w-1.5 transition-opacity duration-200 ${
            listScrollHint ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden
        >
          <div
            className="w-full rounded-full bg-slate-400/45 dark:bg-slate-500/50"
            style={{
              height: listScrollThumb.height,
              transform: `translateY(${listScrollThumb.top}px)`,
            }}
          />
        </div>
      )}
      </div>

      {/* Footer */}
      <div className={`border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/30 ${isNarrowMode ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}>
        <div className="flex items-center justify-between gap-0.5 min-h-[1.75rem]">
          <KanbanChromeTooltip
            label={
              taskImpactView
                ? t('activityFeed.compact.switchToFullView')
                : t('activityFeed.compact.switchToTaskImpact')
            }
            placement="top"
            portalZIndex={ACTIVITY_FEED_CHROME_Z}
            dismissOnLabelChange={false}
          >
            <button
              type="button"
              onClick={handleTaskImpactViewToggle}
              className={`p-1.5 rounded-lg transition-colors ${
                taskImpactView
                  ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100/80 dark:bg-indigo-950/40 hover:bg-indigo-200/80 dark:hover:bg-indigo-900/50'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800/80'
              }`}
              aria-pressed={taskImpactView}
              aria-label={
                taskImpactView
                  ? t('activityFeed.compact.switchToFullView')
                  : t('activityFeed.compact.switchToTaskImpact')
              }
            >
              {taskImpactView ? (
                <ScrollText className="w-3.5 h-3.5" />
              ) : (
                <ListFilter className="w-3.5 h-3.5" />
              )}
            </button>
          </KanbanChromeTooltip>
          <div className="flex items-center gap-0.5">
          <KanbanChromeTooltip
            label={unreadCount > 0 ? t('activityFeed.markAllRead', { count: unreadCount }) : t('activityFeed.markAllReadNone')}
            placement="top"
            portalZIndex={ACTIVITY_FEED_CHROME_Z}
          >
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              disabled={unreadCount === 0}
              className="p-1.5 rounded-lg text-sky-600/90 dark:text-sky-400/90 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-100/80 dark:hover:bg-sky-900/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              aria-label={t('activityFeed.markAllRead', { count: unreadCount })}
            >
              <CheckCheck className="w-3.5 h-3.5" />
            </button>
          </KanbanChromeTooltip>
          <KanbanChromeTooltip
            label={visibleActivities.length > 0 ? t('activityFeed.clearAll') : t('activityFeed.clearAllNone')}
            placement="top"
            portalZIndex={ACTIVITY_FEED_CHROME_Z}
          >
            <button
              type="button"
              onClick={handleClearAll}
              disabled={visibleActivities.length === 0}
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              aria-label={t('activityFeed.clearAll')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </KanbanChromeTooltip>
          </div>
        </div>
      </div>

      {/* Resize handles — all edges and corners */}
      <div
        className="absolute left-3 right-3 h-1 cursor-ns-resize hover:bg-sky-300/50 transition-colors z-10"
        onMouseDown={(e) => handleResizeStart(e, 'n')}
        style={{ top: -2 }}
      />
      <div
        className="absolute left-3 right-3 h-1 cursor-ns-resize hover:bg-sky-300/50 transition-colors z-10"
        onMouseDown={(e) => handleResizeStart(e, 's')}
        style={{ bottom: -2 }}
      />
      <div
        className="absolute top-3 bottom-3 w-1 cursor-ew-resize hover:bg-sky-300/50 transition-colors z-10"
        onMouseDown={(e) => handleResizeStart(e, 'e')}
        style={{ right: -2 }}
      />
      <div
        className="absolute top-3 bottom-3 w-1 cursor-ew-resize hover:bg-sky-300/50 transition-colors z-10"
        onMouseDown={(e) => handleResizeStart(e, 'w')}
        style={{ left: -2 }}
      />
      <div
        className="absolute w-3 h-3 cursor-nw-resize hover:bg-sky-400/60 transition-colors rounded-tl-2xl z-20"
        onMouseDown={(e) => handleResizeStart(e, 'nw')}
        style={{ top: -2, left: -2 }}
      />
      <div
        className="absolute w-3 h-3 cursor-ne-resize hover:bg-sky-400/60 transition-colors rounded-tr-2xl z-20"
        onMouseDown={(e) => handleResizeStart(e, 'ne')}
        style={{ top: -2, right: -2 }}
      />
      <div
        className="absolute w-3 h-3 cursor-sw-resize hover:bg-sky-400/60 transition-colors rounded-bl-2xl z-20"
        onMouseDown={(e) => handleResizeStart(e, 'sw')}
        style={{ bottom: -2, left: -2 }}
      />
      <div
        className="absolute w-3 h-3 cursor-se-resize hover:bg-sky-400/60 transition-colors rounded-br-2xl z-20"
        onMouseDown={(e) => handleResizeStart(e, 'se')}
        style={{ bottom: -2, right: -2 }}
      />
      
      {showDimensionsTooltip && (isDragging || isResizing) && (() => {
        const tipW = 148;
        const tipH = 44;
        const gap = 8;
        const feedH = isMinimized ? MINIMIZED_HEIGHT : dimensions.height;
        let left = displayAbsolute.x + dimensions.width / 2 - tipW / 2;
        let top = displayAbsolute.y - tipH - gap;
        // Prefer above the feed; if clipped, stick below
        if (top < gap) {
          top = displayAbsolute.y + feedH + gap;
        }
        left = Math.max(gap, Math.min(left, viewportSize.w - tipW - gap));
        top = Math.max(gap, Math.min(top, viewportSize.h - tipH - gap));
        const fmt = (n: number) => String(Math.round(n)).padStart(4, '\u00A0');

        return createPortal(
          <div
            className="fixed pointer-events-none rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 shadow-lg backdrop-blur-sm px-2.5 py-1.5 box-border"
            style={{
              left,
              top,
              width: tipW,
              height: tipH,
              zIndex: ACTIVITY_FEED_CHROME_Z,
            }}
          >
            <div className="font-mono text-[10px] tabular-nums text-slate-700 dark:text-slate-300 leading-snug h-full flex flex-col justify-center gap-0.5">
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="w-3 shrink-0 text-slate-500">{t('activityFeed.position')}</span>
                <span className="font-medium">
                  x:{fmt(displayAbsolute.x)} y:{fmt(displayAbsolute.y)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="w-3 shrink-0 text-slate-500">{t('activityFeed.size')}</span>
                <span className="font-medium">
                  w:{fmt(dimensions.width)} h:{fmt(dimensions.height)}
                </span>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
};

export default ActivityFeed;
