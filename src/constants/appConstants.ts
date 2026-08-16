/**
 * Application-wide constants
 */

// System user member ID - used to identify system-generated tasks and members
export const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001';

// AI Agent pseudo-member (assignable when AI_ENABLED); mirrors SYSTEM fixed UUIDs
export const AGENT_USER_ID = '00000000-0000-0000-0000-000000000010';
export const AGENT_MEMBER_ID = '00000000-0000-0000-0000-000000000011';
export const AGENT_DEFAULT_NAME = 'Agent';
export const AGENT_DEFAULT_COLOR = '#0F766E';

/** Keep in sync with server/constants/fieldLimits.js */
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 100_000;
export const COMMENT_MAX_LENGTH = 10_000;
export const BOARD_TITLE_MAX_LENGTH = 200;
export const COLUMN_TITLE_MAX_LENGTH = 200;
export const COLUMN_POLICY_MAX_LENGTH = 500;
export const TAG_NAME_MAX_LENGTH = 30;
export const TAG_DESCRIPTION_MAX_LENGTH = 2000;
export const BLOCKED_REASON_MAX_LENGTH = 500;
export const FILTER_NAME_MAX_LENGTH = 100;
export const SPRINT_NAME_MAX_LENGTH = 30;
export const SPRINT_DESCRIPTION_MAX_LENGTH = 5000;
export const PRIORITY_NAME_MAX_LENGTH = 30;

/** task_work.status values for agent automation */
export const AGENT_WORK_STATUSES = {
  queued: 'queued',
  running: 'running',
  paused: 'paused',
  waiting: 'waiting',
  stopped: 'stopped',
  done: 'done',
  failed: 'failed',
  undone: 'undone'
} as const;

export type AgentWorkStatus = (typeof AGENT_WORK_STATUSES)[keyof typeof AGENT_WORK_STATUSES];

/** Statuses that show spinner / disable drag on the card (active work) */
export const AGENT_ACTIVE_WORK_STATUSES: readonly AgentWorkStatus[] = [
  'queued',
  'running',
  'paused',
  'waiting'
];

/** Statuses where the card should not be dragged (in-flight agent work) */
export const AGENT_DRAG_BLOCKING_STATUSES: readonly AgentWorkStatus[] = [
  'queued',
  'running',
  'paused',
  'waiting'
];

/** Statuses that can be resumed / restarted from the card menu */
export const AGENT_RESUMABLE_STATUSES: readonly AgentWorkStatus[] = [
  'paused',
  'waiting',
  'stopped',
  'failed',
  'done',
  'undone'
];

/** True when assigned but never launched (Assign without Assign & Launch). */
export function isAgentIdleStatus(status: string | null | undefined): boolean {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'idle' || s === 'unknown';
}

/** Configure / activity may start or restart (idle or a finished/paused state). */
export function canStartOrRestartAgent(status: string | null | undefined): boolean {
  return (
    isAgentIdleStatus(status) ||
    (AGENT_RESUMABLE_STATUSES as readonly string[]).includes(String(status || ''))
  );
}

// WebSocket throttle duration in milliseconds
// Throttles to max 20 updates per second for better performance
export const WEBSOCKET_THROTTLE_MS = 50;

