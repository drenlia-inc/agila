/**
 * Agent Automation mode constants (admin-only board ops via job-scoped token).
 */

export const AUTOMATION_MODE = 'automation';

export const AUTOMATION_SCOPE = Object.freeze({
  THIS_BOARD: 'this_board',
  SELECTED: 'selected',
  ALL_BOARDS: 'all_boards'
});

/** task_work config keys (copied on task copy; not runtime) */
export const AUTOMATION_CONFIG_KEYS = Object.freeze([
  'agent_mode',
  'automation_scope',
  'automation_board_ids',
  'llm_model'
]);

/** task_work runtime keys cleared on copy / new run */
export const AUTOMATION_RUNTIME_KEYS = Object.freeze([
  'status',
  'control',
  'log',
  'progress',
  'callback_token',
  'runner_job_id',
  'claimed_by',
  'claimed_at',
  'waiting_for_slot',
  'awaiting_apply',
  'automation_token_id',
  'automation_pending_plan',
  'automation_plan_hash',
  'automation_apply_hash',
  'automation_result',
  'automation_undoable',
  'automation_undone_at',
  'automation_undo_summary',
  'pr_url',
  'agent_branch',
  'launch_attempt_at'
]);

export const AUTOMATION_MAX_TASKS_PER_APPLY = 500;
export const AUTOMATION_MAX_TOOL_STEPS = 40;
export const AUTOMATION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export const AUTOMATION_CAPABILITIES = Object.freeze({
  allowed: [
    'list_boards',
    'list_columns',
    'list_sprints',
    'list_members',
    'list_tags',
    'list_priorities',
    'list_capabilities',
    'get_task',
    'get_tasks',
    'search_tasks',
    'create_task',
    'update_tasks',
    'move_tasks',
    'restore_tasks',
    'create_sprint',
    'update_sprint',
    'set_task_sprint',
    'create_column',
    'rename_column',
    'reorder_columns',
    'create_board',
    'rename_board',
    'add_comment',
    'link_tasks',
    'unlink_tasks',
    'create_tag',
    'assign_tags',
    'create_priority',
    'export_tasks_xlsx',
    'export_tasks_csv',
    'submit_dry_run_plan',
    'finish'
  ],
  denied: [
    'delete_tasks',
    'delete_boards',
    'delete_columns',
    'admin_users',
    'settings',
    'credentials',
    'billing'
  ]
});
