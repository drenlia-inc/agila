/** Shared Admin numeric limits and clamp helpers (type freely; clamp on blur/save). */

import {
  ACTIVITY_FEED_INSET,
  ACTIVITY_FEED_POS_Y,
  DEFAULT_ACTIVITY_FEED_STORED_POSITION,
  activityFeedEdgeFromStored,
  activityFeedInsetFromStored,
  storedActivityFeedPositionFromEdge,
  type ActivityFeedPosition,
} from './activityFeedPosition';

export const ADMIN_NUMERIC_INPUT_CLASS =
  'admin-numeric-input [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

/**
 * Admin data-table row hover (matches ListView / board tables).
 * Box-shadow on bare table rows is unreliable across browsers; use background shade.
 */
export const ADMIN_TABLE_ROW_CLASS =
  'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150';

/** Persistent row highlight while a user row is being edited (color picker / edit modal). */
export const ADMIN_TABLE_ROW_ACTIVE_CLASS = 'bg-gray-50 dark:bg-gray-700/50';

export const ACTIVITY_FEED_WIDTH = { min: 120, max: 400 } as const;
export const ACTIVITY_FEED_HEIGHT = { min: 200, max: 800 } as const;
/** @deprecated Prefer ACTIVITY_FEED_INSET — kept for any leftover imports */
export const ACTIVITY_FEED_POS_X = ACTIVITY_FEED_INSET;
export { ACTIVITY_FEED_INSET, ACTIVITY_FEED_POS_Y };
export type { ActivityFeedPosition };

/** Max upload size in MB (stored as bytes in settings). */
export const UPLOAD_MAX_MB = { min: 0, max: 1024 } as const;

export const AI_MAX_CONCURRENT = { min: 1, max: 10 } as const;

/** SMTP port range. */
export const SMTP_PORT = { min: 1, max: 65535 } as const;

/** Lifecycle retention days. */
export const LIFECYCLE_RETENTION_DAYS = { min: 0, max: 3650 } as const;

/** Notification queue retention for sent/failed rows (0 = keep forever). */
export const NOTIFICATION_QUEUE_RETENTION_DAYS = { min: 0, max: 3650 } as const;

/** Gamification action points (create/complete/move/…). */
export const REPORTS_ACTION_POINTS = { min: 0, max: 100 } as const;
/** Effort → points multiplier. */
export const REPORTS_EFFORT_MULTIPLIER = { min: 0, max: 20 } as const;

export const REPORTS_POINTS_LIMITS: Record<string, { min: number; max: number }> = {
  REPORTS_POINTS_TASK_CREATED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_TASK_COMPLETED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_TASK_MOVED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_TASK_UPDATED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_COMMENT_ADDED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_WATCHER_ADDED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_COLLABORATOR_ADDED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_TAG_ADDED: REPORTS_ACTION_POINTS,
  REPORTS_POINTS_EFFORT_MULTIPLIER: REPORTS_EFFORT_MULTIPLIER,
};

/** Parse integer; return null if empty/invalid (not a finite number). */
export function parseOptionalInt(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** Clamp integer into [min, max]. Invalid/empty → fallback. */
export function clampInt(
  raw: string | number | undefined | null,
  min: number,
  max: number,
  fallback: number
): number {
  const n =
    typeof raw === 'number'
      ? raw
      : parseOptionalInt(String(raw ?? ''));
  if (n === null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function clampIntToString(
  raw: string | number | undefined | null,
  min: number,
  max: number,
  fallback: number
): string {
  return String(clampInt(raw, min, max, fallback));
}

export type ActivityFeedPositionDraft = {
  edge: 'left' | 'right';
  inset: string | number;
  y: string | number;
};

/** Read position for display while typing (not clamped). */
export function readActivityFeedPositionRaw(
  raw: string | undefined
): ActivityFeedPositionDraft {
  try {
    const parsed = JSON.parse(
      raw || JSON.stringify(DEFAULT_ACTIVITY_FEED_STORED_POSITION)
    ) as { x?: unknown; y?: unknown };
    const xRaw = parsed?.x;
    const yRaw = parsed?.y;
    const xNum = xRaw === '' || xRaw === undefined || xRaw === null ? null : Number(xRaw);
    const edge: 'left' | 'right' =
      xNum !== null && Number.isFinite(xNum)
        ? xNum < 0
          ? 'right'
          : 'left'
        : 'left';
    return {
      edge,
      inset:
        xRaw === '' || xRaw === undefined || xRaw === null
          ? ''
          : Number.isFinite(xNum)
            ? Math.abs(xNum as number)
            : activityFeedInsetFromStored(DEFAULT_ACTIVITY_FEED_STORED_POSITION),
      y:
        yRaw === '' || yRaw === undefined || yRaw === null
          ? ''
          : Number.isFinite(Number(yRaw))
            ? Number(yRaw)
            : DEFAULT_ACTIVITY_FEED_STORED_POSITION.y,
    };
  } catch {
    return {
      edge: 'left',
      inset: activityFeedInsetFromStored(DEFAULT_ACTIVITY_FEED_STORED_POSITION),
      y: DEFAULT_ACTIVITY_FEED_STORED_POSITION.y,
    };
  }
}

export function parseActivityFeedPosition(
  raw: string | undefined
): ActivityFeedPosition {
  const draft = readActivityFeedPositionRaw(raw);
  const inset = clampInt(
    draft.inset,
    ACTIVITY_FEED_INSET.min,
    ACTIVITY_FEED_INSET.max,
    activityFeedInsetFromStored(DEFAULT_ACTIVITY_FEED_STORED_POSITION)
  );
  const y = clampInt(
    draft.y,
    ACTIVITY_FEED_POS_Y.min,
    ACTIVITY_FEED_POS_Y.max,
    DEFAULT_ACTIVITY_FEED_STORED_POSITION.y
  );
  return storedActivityFeedPositionFromEdge(draft.edge, inset, y);
}

export function stringifyActivityFeedPosition(pos: ActivityFeedPosition): string {
  const edge = activityFeedEdgeFromStored(pos);
  const inset = clampInt(
    activityFeedInsetFromStored(pos),
    ACTIVITY_FEED_INSET.min,
    ACTIVITY_FEED_INSET.max,
    activityFeedInsetFromStored(DEFAULT_ACTIVITY_FEED_STORED_POSITION)
  );
  const y = clampInt(
    pos.y,
    ACTIVITY_FEED_POS_Y.min,
    ACTIVITY_FEED_POS_Y.max,
    DEFAULT_ACTIVITY_FEED_STORED_POSITION.y
  );
  return JSON.stringify(storedActivityFeedPositionFromEdge(edge, inset, y));
}

/** Normalize activity-feed defaults in a settings draft before save. */
export function clampActivityFeedInSettings(
  draft: Record<string, string | undefined>
): Record<string, string | undefined> {
  const next = { ...draft };
  if (next.DEFAULT_ACTIVITY_FEED_POSITION !== undefined) {
    next.DEFAULT_ACTIVITY_FEED_POSITION = stringifyActivityFeedPosition(
      parseActivityFeedPosition(next.DEFAULT_ACTIVITY_FEED_POSITION)
    );
  }
  if (next.DEFAULT_ACTIVITY_FEED_WIDTH !== undefined) {
    next.DEFAULT_ACTIVITY_FEED_WIDTH = clampIntToString(
      next.DEFAULT_ACTIVITY_FEED_WIDTH,
      ACTIVITY_FEED_WIDTH.min,
      ACTIVITY_FEED_WIDTH.max,
      160
    );
  }
  if (next.DEFAULT_ACTIVITY_FEED_HEIGHT !== undefined) {
    next.DEFAULT_ACTIVITY_FEED_HEIGHT = clampIntToString(
      next.DEFAULT_ACTIVITY_FEED_HEIGHT,
      ACTIVITY_FEED_HEIGHT.min,
      ACTIVITY_FEED_HEIGHT.max,
      400
    );
  }
  return next;
}

export function clampUploadMaxMb(raw: string | number): number {
  return clampInt(raw, UPLOAD_MAX_MB.min, UPLOAD_MAX_MB.max, 10);
}

export function reportsPointsLimitForKey(key: string): { min: number; max: number } {
  return REPORTS_POINTS_LIMITS[key] || REPORTS_ACTION_POINTS;
}
