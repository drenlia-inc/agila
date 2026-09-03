/**
 * Fixed UUIDs for the AI Agent pseudo-user / member (mirrors SYSTEM account pattern).
 * Not a licensed seat; cannot log in (is_active = false).
 */
export const AGENT_USER_ID = '00000000-0000-0000-0000-000000000010';
export const AGENT_MEMBER_ID = '00000000-0000-0000-0000-000000000011';

export function isAgentMemberId(id) {
  return Boolean(id && String(id) === AGENT_MEMBER_ID);
}
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
export const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001';

export const AGENT_DEFAULT_NAME = 'Agent';
export const AGENT_DEFAULT_COLOR = '#0F766E';
