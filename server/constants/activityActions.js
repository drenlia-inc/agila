/**
 * Activity Action Constants
 * Standard naming conventions for user activity logging
 */

// Task Actions
export const TASK_ACTIONS = {
  CREATE: 'create_task',
  UPDATE: 'update_task',
  DELETE: 'delete_task',
  MOVE: 'move_task',
  COPY: 'copy_task'
};

// Tag Actions
export const TAG_ACTIONS = {
  CREATE: 'create_tag',
  UPDATE: 'update_tag',
  DELETE: 'delete_tag',
  ASSOCIATE: 'associate_tag',
  DISASSOCIATE: 'disassociate_tag'
};

// Comment Actions
export const COMMENT_ACTIONS = {
  CREATE: 'create_comment',
  UPDATE: 'update_comment',
  DELETE: 'delete_comment'
};

/** Agent automation outcomes (attributed to AGENT_USER_ID) */
export const AGENT_ACTIONS = {
  JOB_DONE: 'agent_job_done',
  JOB_FAILED: 'agent_job_failed'
};

/** Membership / account lifecycle (team-facing feed) */
export const MEMBER_ACTIONS = {
  JOINED: 'member_joined'
};

// All actions combined for easy reference
export const ALL_ACTIONS = [
  ...Object.values(TASK_ACTIONS),
  ...Object.values(TAG_ACTIONS),
  ...Object.values(COMMENT_ACTIONS),
  ...Object.values(AGENT_ACTIONS),
  ...Object.values(MEMBER_ACTIONS)
];

// Helper function to check if action is valid
export const isValidAction = (action) => {
  return ALL_ACTIONS.includes(action);
};
