import React from 'react';
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TeamMember } from '../../types';
import { SYSTEM_MEMBER_ID } from '../../constants/appConstants';
import { getAuthenticatedAvatarUrl } from '../../utils/authImageUrl';
import {
  getAgentAvatarSrc,
  isAgentMemberId,
  resolveTaskMember,
} from '../../utils/agentMemberUi';
import { memberIsViewer } from '../../utils/memberUtils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'w-4 h-4 text-[9px]',
  sm: 'w-5 h-5 text-[10px]',
  md: 'w-7 h-7 text-xs',
  lg: 'w-8 h-8 text-sm',
};

const BADGE_CLASS: Record<AvatarSize, string> = {
  xs: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5',
  sm: 'h-3 w-3 -bottom-0.5 -right-0.5',
  md: 'h-3.5 w-3.5 -bottom-0.5 -right-0.5',
  lg: 'h-4 w-4 -bottom-0.5 -right-0.5',
};

const EYE_PX: Record<AvatarSize, number> = {
  xs: 7,
  sm: 8,
  md: 9,
  lg: 10,
};

interface MemberAvatarProps {
  member?: TeamMember | null;
  memberId?: string | null;
  members?: TeamMember[];
  size?: AvatarSize;
  className?: string;
  title?: string;
  /** Viewer eye overlay (default on). */
  showViewerBadge?: boolean;
}

/**
 * Compact circular member avatar (photo, agent bot, system emoji, or initial).
 */
export default function MemberAvatar({
  member: memberProp,
  memberId,
  members,
  size = 'md',
  className = '',
  title,
  showViewerBadge = true,
}: MemberAvatarProps) {
  const { t } = useTranslation('common');
  const member =
    memberProp ||
    (memberId && members ? resolveTaskMember(members, memberId) : undefined);

  if (!member) {
    return (
      <div
        className={`${SIZE_CLASS[size]} rounded-full bg-gray-200 dark:bg-gray-600 shrink-0 ${className}`}
        title={title}
        aria-hidden
      />
    );
  }

  const sizeClass = SIZE_CLASS[size];
  const viewerHint = t('messages.readOnlyBadge');
  const label =
    title ||
    (showViewerBadge && memberIsViewer(member)
      ? `${member.name} (${viewerHint})`
      : member.name);

  let inner: React.ReactElement;

  if (member.id === SYSTEM_MEMBER_ID) {
    inner = (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center shrink-0 ${className}`}
        style={{ backgroundColor: member.color || '#1E40AF' }}
        title={label}
      >
        🤖
      </div>
    );
  } else if (isAgentMemberId(member.id)) {
    inner = (
      <img
        src={getAgentAvatarSrc(member)}
        alt={member.name}
        title={label}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  } else {
    const avatarSrc = member.googleAvatarUrl || member.avatarUrl;
    inner = avatarSrc ? (
      <img
        src={getAuthenticatedAvatarUrl(avatarSrc)}
        alt={member.name}
        title={label}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
      />
    ) : (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center font-medium text-white shrink-0 ${className}`}
        style={{ backgroundColor: member.color || '#6B7280' }}
        title={label}
      >
        {(member.name || '?').charAt(0).toUpperCase()}
      </div>
    );
  }

  if (!showViewerBadge || !memberIsViewer(member)) {
    return inner;
  }

  return (
    <span className={`relative inline-flex ${sizeClass} shrink-0`} title={label}>
      {inner}
      <span
        className={`absolute flex items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-1 ring-white dark:bg-sky-950 dark:text-sky-300 dark:ring-gray-800 ${BADGE_CLASS[size]}`}
        aria-label={viewerHint}
      >
        <Eye size={EYE_PX[size]} strokeWidth={2.5} aria-hidden />
      </span>
    </span>
  );
}

/** Soft tinted styles for priority pills (matches TaskCard). */
export function getPriorityPillStyle(hexColor?: string | null): React.CSSProperties {
  if (!hexColor) {
    return {
      backgroundColor: 'rgb(107, 114, 128, 0.1)',
      color: '#6B7280',
    };
  }
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) {
    return { backgroundColor: `${hexColor}20`, color: hexColor };
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`,
    color: hexColor,
    border: `1px solid rgba(${r}, ${g}, ${b}, 0.35)`,
  };
}
