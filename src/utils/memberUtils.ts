/**
 * Utility function to truncate member display names for dropdowns
 * Limits names to 30 characters with ellipsis if longer
 */
export const truncateMemberName = (name: string, maxLength: number = 30): string => {
  if (name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength) + '...';
};

export function memberIsViewer(member?: { isViewer?: boolean } | null): boolean {
  return Boolean(member?.isViewer);
}

/** Linked user account is deactivated (Agent is handled separately in pickers). */
export function memberIsInactive(member?: { isActive?: boolean } | null): boolean {
  return member?.isActive === false;
}

/** Pending invite: linked, inactive, never activated. Hide from TEAM chips. */
export function memberIsPendingInvite(member?: {
  user_id?: string;
  isActive?: boolean;
  hasActivated?: boolean;
} | null): boolean {
  if (!member?.user_id) return false;
  return memberIsInactive(member) && member.hasActivated !== true;
}

/** TEAM / Meet the Team: show after first activation (dim if later deactivated). */
export function memberVisibleOnTeamBoard(member?: {
  id?: string;
  user_id?: string;
  isActive?: boolean;
  hasActivated?: boolean;
} | null): boolean {
  if (!member) return false;
  return !memberIsPendingInvite(member);
}

function asSettingBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  return undefined;
}

/**
 * Normalize a member-created / member-updated WS payload onto TeamMember fields.
 * @param options.assumeInactiveIfLinked — member-created: invited users omit isActive; treat linked as inactive.
 */
export function normalizeTeamMemberFromEvent(
  raw: Record<string, unknown> | null | undefined,
  options?: { assumeInactiveIfLinked?: boolean }
): Partial<import('../types').TeamMember> {
  if (!raw || typeof raw !== 'object') return {};
  const userId = raw.user_id ?? raw.userId;
  const isActive = asSettingBool(raw.isActive);
  const next: Partial<import('../types').TeamMember> = {};
  if (raw.id != null) next.id = String(raw.id);
  if (raw.name != null) next.name = String(raw.name);
  if (raw.color != null) next.color = String(raw.color);
  if (userId != null && String(userId).trim()) next.user_id = String(userId);
  if (raw.email != null) next.email = String(raw.email);
  if (isActive !== undefined) {
    next.isActive = isActive;
  } else if (options?.assumeInactiveIfLinked && next.user_id) {
    next.isActive = false;
  }
  const hasActivated = asSettingBool(raw.hasActivated);
  if (hasActivated !== undefined) {
    next.hasActivated = hasActivated;
  } else if (options?.assumeInactiveIfLinked && next.user_id && next.isActive === false) {
    next.hasActivated = false;
  } else if (next.isActive === true) {
    next.hasActivated = true;
  }
  if (raw.bio != null) next.bio = String(raw.bio);
  if (raw.avatarUrl != null) next.avatarUrl = String(raw.avatarUrl);
  if (raw.authProvider === 'local' || raw.authProvider === 'google') {
    next.authProvider = raw.authProvider;
  }
  if (raw.googleAvatarUrl != null) next.googleAvatarUrl = String(raw.googleAvatarUrl);
  if (raw.isViewer !== undefined) next.isViewer = Boolean(raw.isViewer);
  return next;
}

