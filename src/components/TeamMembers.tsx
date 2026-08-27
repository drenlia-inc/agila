import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, Info, X, Minimize2, Maximize2, GripVertical, Eye } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TeamMember } from '../types';
import { useTranslation } from 'react-i18next';
import { getAuthenticatedAvatarUrl } from '../utils/authImageUrl';
import {
  getAgentAvatarSrc,
  isAgentMemberId,
  isSystemMemberId,
  sortMembersAgentLast,
} from '../utils/agentMemberUi';
import { memberIsViewer, memberIsInactive } from '../utils/memberUtils';
import { UNASSIGNED_MEMBER_FILTER_ID } from '../constants/appConstants';
import {
  loadUserPreferences,
  loadUserPreferencesAsync,
  updateUserPreference,
} from '../utils/userPreferences';
import { KanbanChromeTooltip, CHROME_TOOLTIP_MUTED_TEXT_CLASS } from './KanbanChromeTooltip';
import { formRoleChipClass, formChromeOutlineButtonClass } from '../utils/formFieldClasses';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import MemberAvatar from './ui/MemberAvatar';

export const PRESET_COLORS = [
  '#FF3B30', // Bright Red
  '#007AFF', // Vivid Blue
  '#4CD964', // Lime Green
  '#FF9500', // Orange
  '#5856D6', // Purple
  '#FF2D55', // Pink
  '#00C7BE', // Teal
  '#FFD60A', // Yellow
  '#BF5AF2', // Magenta
  '#34C759', // Green
  '#FF6B6B', // Coral
  '#1C7ED6', // Royal Blue
  '#845EF7', // Violet
  '#F76707', // Deep Orange
  '#20C997', // Mint
  '#E599F7', // Light Purple
  '#40C057', // Forest Green
  '#F59F00', // Golden
  '#0CA678', // Sea Green
  '#FA5252'  // Red Orange
];

/** Below this card width: hide role chips. */
const NARROW_MAX_WIDTH_PX = 576;

/** Horizontal padding of the card (p-3 → 12px each side). */
const CARD_PAD_X_PX = 24;

interface TeamMembersProps {
  members: TeamMember[];
  selectedMembers: string[];
  onSelectMember: (id: string) => void;
  onClearSelections?: () => void;
  onSelectAll?: () => void;
  isAllModeActive?: boolean;
  includeAssignees?: boolean;
  includeWatchers?: boolean;
  includeCollaborators?: boolean;
  includeRequesters?: boolean;
  includeSystem?: boolean;
  onToggleAssignees?: (include: boolean) => void;
  onToggleWatchers?: (include: boolean) => void;
  onToggleCollaborators?: (include: boolean) => void;
  onToggleRequesters?: (include: boolean) => void;
  onToggleSystem?: (include: boolean) => void;
  /** When false, hide Agent from the member strip (Search & Filter Agent toggle). */
  showAgentTasks?: boolean;
  currentUserId?: string;
  currentUser?: any; // To check if user is admin
  systemTaskCount?: number;
  onEditOwnProfile?: (opts?: { focus?: 'displayName' | 'bio' }) => void;
}

function truncateDisplayName(name: string, maxLength: number = 12): string {
  if (name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength) + '...';
}

/** Active accounts with an email, or inactive accounts (rich tooltip without email). */
function canShowMemberContactTooltip(member: TeamMember): boolean {
  if (isAgentMemberId(member.id) || isSystemMemberId(member.id)) return false;
  if (member.isActive !== false && Boolean(member.email?.trim())) return true;
  return memberIsInactive(member);
}

function MemberContactTooltipBody({
  member,
  statusLabel,
  isSelf,
  onEditOwnProfile,
  inactiveAccount = false,
}: {
  member: TeamMember;
  statusLabel: string;
  isSelf?: boolean;
  onEditOwnProfile?: (opts?: { focus?: 'displayName' | 'bio' }) => void;
  inactiveAccount?: boolean;
}) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const email = member.email?.trim() || '';
  const bioText = member.bio?.trim() || '';
  const hasBio = bioText.length > 1;

  const copyEmail = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      const el = document.createElement('textarea');
      el.value = email;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(el);
      }
    }
  };

  const editProfile = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onEditOwnProfile?.();
  };

  const toggleBio = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBioOpen((open) => !open);
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="font-semibold leading-snug break-words flex-1 min-w-0">{member.name}</div>
        {hasBio ? (
          <button
            type="button"
            onClick={toggleBio}
            className="shrink-0 p-0.5 rounded hover:bg-white/10 dark:hover:bg-black/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 dark:focus-visible:ring-black/30"
            title={bioOpen ? t('teamMembers.hideBio') : t('teamMembers.showBio')}
            aria-label={bioOpen ? t('teamMembers.hideBio') : t('teamMembers.showBio')}
            aria-expanded={bioOpen}
          >
            <Info size={14} strokeWidth={2.25} />
          </button>
        ) : null}
      </div>
      {hasBio && bioOpen ? (
        <p className={`text-[11px] leading-snug whitespace-pre-wrap break-words ${CHROME_TOOLTIP_MUTED_TEXT_CLASS}`}>
          {bioText}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5 min-w-0">
        {inactiveAccount ? (
          <span className={`flex-1 min-w-0 ${CHROME_TOOLTIP_MUTED_TEXT_CLASS}`}>
            {t('teamMembers.inactiveAccount')}
          </span>
        ) : (
          <>
            <span
              className={`flex-1 min-w-0 break-all select-text ${CHROME_TOOLTIP_MUTED_TEXT_CLASS}`}
              title={email}
            >
              {email}
            </span>
            <button
              type="button"
              onClick={copyEmail}
              className="shrink-0 p-1 rounded hover:bg-white/10 dark:hover:bg-black/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 dark:focus-visible:ring-black/30"
              title={copied ? t('teamMembers.emailCopied') : t('teamMembers.copyEmail')}
              aria-label={copied ? t('teamMembers.emailCopied') : t('teamMembers.copyEmail')}
            >
              {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} strokeWidth={2} />}
            </button>
          </>
        )}
      </div>
      {isSelf && onEditOwnProfile && !inactiveAccount ? (
        <button
          type="button"
          onClick={editProfile}
          className="self-start text-left text-[11px] font-medium underline underline-offset-2 decoration-white/40 dark:decoration-black/30 hover:decoration-white/80 dark:hover:decoration-black/60 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 dark:focus-visible:ring-black/30 rounded"
        >
          {t('teamMembers.editMyProfile')}
        </button>
      ) : null}
      {statusLabel ? (
        <div className={`text-[11px] ${CHROME_TOOLTIP_MUTED_TEXT_CLASS}`}>{statusLabel}</div>
      ) : null}
    </div>
  );
}

function memberAvatarNode(
  member: TeamMember,
  sizeClass: string,
  textClass = 'text-xs',
  viewerLabel?: string,
  options?: { dimInactive?: boolean }
) {
  const isInactive =
    memberIsInactive(member) && !isAgentMemberId(member.id) && !isSystemMemberId(member.id);
  const dimInactive = options?.dimInactive !== false;

  let inner: ReactElement;
  if (isAgentMemberId(member.id)) {
    inner = (
      <img
        src={getAgentAvatarSrc(member)}
        alt=""
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  } else if (member.googleAvatarUrl) {
    inner = (
      <img
        src={getAuthenticatedAvatarUrl(member.googleAvatarUrl)}
        alt=""
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  } else if (member.avatarUrl) {
    inner = (
      <img
        src={getAuthenticatedAvatarUrl(member.avatarUrl)}
        alt=""
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  } else {
    const initials = member.name.split(' ').map(n => n[0]).join('').toUpperCase();
    inner = (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center ${textClass} font-bold text-white`}
        style={{ backgroundColor: member.color }}
      >
        {initials}
      </div>
    );
  }
  if (!memberIsViewer(member)) {
    if (isInactive && dimInactive) {
      return (
        <span className={`relative inline-flex ${sizeClass} shrink-0 opacity-45 saturate-50`}>
          {inner}
        </span>
      );
    }
    return inner;
  }
  const compact = sizeClass.includes('w-7');
  return (
    <span className={`relative inline-flex ${sizeClass} shrink-0`} title={viewerLabel}>
      {inner}
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-2 ring-white dark:bg-sky-950 dark:text-sky-300 dark:ring-gray-800 ${
          compact ? 'h-3.5 w-3.5' : 'h-5 w-5'
        }`}
        aria-label={viewerLabel}
      >
        <Eye size={compact ? 8 : 12} strokeWidth={2.5} aria-hidden />
      </span>
    </span>
  );
}

function MeetTheTeamCard({
  member,
  currentUserId,
  showBios,
  onEditOwnProfile,
  openOwnProfile,
}: {
  member: TeamMember;
  currentUserId?: string;
  showBios: boolean;
  onEditOwnProfile?: (opts?: { focus?: 'displayName' | 'bio' }) => void;
  openOwnProfile: () => void;
}) {
  const { t } = useTranslation('common');
  const isAgent = isAgentMemberId(member.id);
  const isInactiveMember =
    memberIsInactive(member) && !isAgent && !isSystemMemberId(member.id);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: member.id, disabled: isAgent });

  const bioText = member.bio?.trim() || '';
  const hasBio = bioText.length > 1;
  const isSelf = Boolean(currentUserId && member.user_id && member.user_id === currentUserId);

  const style = {
    // Translate only (no scale) — required for sortable siblings while dragging
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.92 : undefined,
    minHeight: showBios ? undefined : 116,
    backgroundColor: `${member.color}18`,
    borderColor: `${member.color}40`,
    cursor: isAgent ? 'default' : isDragging ? 'grabbing' : 'grab',
    touchAction: isAgent ? undefined : 'none',
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`meet-team-card group relative flex h-full flex-col items-center text-center rounded-xl border px-3.5 py-4 overflow-hidden ${
        isSelf ? 'ring-2 ring-blue-500/40 dark:ring-blue-400/40' : ''
      } ${isInactiveMember ? 'opacity-65 saturate-75' : ''} ${isDragging ? 'meet-team-card--dragging' : ''} ${isAgent ? 'meet-team-card--static' : ''}`}
      {...attributes}
      {...(isAgent ? {} : listeners)}
    >
      {!isAgent ? (
        <span
          className="absolute top-2 left-2 flex items-center justify-center rounded-md p-1 text-gray-400 dark:text-gray-500 pointer-events-none"
          aria-hidden
        >
          <GripVertical size={22} strokeWidth={2.25} />
        </span>
      ) : null}
      {isSelf ? (
        <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-black/30 text-blue-700 dark:text-blue-300 pointer-events-none">
          {t('teamMembers.thatsYou')}
        </span>
      ) : null}
      <div
        className="relative shrink-0 self-center rounded-full p-[3px] shadow-sm pointer-events-none w-fit"
        style={{
          background: `linear-gradient(145deg, ${member.color}, ${member.color}66)`,
        }}
      >
        <div className="rounded-full bg-white dark:bg-gray-900 p-0.5">
          {memberAvatarNode(
            member,
            showBios ? 'w-16 h-16' : 'w-12 h-12',
            showBios ? 'text-lg' : 'text-sm',
            t('messages.readOnlyBadge'),
            { dimInactive: false }
          )}
        </div>
      </div>
      <div className="mt-2.5 text-sm font-semibold text-gray-900 dark:text-gray-50 break-words w-full pointer-events-none">
        {member.name}
      </div>
      {isInactiveMember ? (
        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 pointer-events-none">
          {t('teamMembers.inactiveAccount')}
        </div>
      ) : null}
      {showBios ? (
        <div className="mt-1.5 flex-1 flex flex-col items-center w-full min-h-0">
          {hasBio ? (
            <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words leading-relaxed w-full pointer-events-none">
              {bioText}
            </p>
          ) : (
            <p className="text-xs italic text-gray-400 dark:text-gray-500 pointer-events-none">
              {t('teamMembers.noBio')}
            </p>
          )}
          {isSelf && onEditOwnProfile ? (
            <div className="mt-auto pt-3 w-full flex justify-center shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openOwnProfile();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-medium rounded-full bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
              >
                {hasBio ? t('teamMembers.updateYourBio') : t('teamMembers.addYourBio')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MeetTheTeamModal({
  members,
  currentUserId,
  memberDisplayOrder,
  onMemberDisplayOrderChange,
  onEditOwnProfile,
  onClose,
}: {
  members: TeamMember[];
  currentUserId?: string;
  memberDisplayOrder: string[];
  onMemberDisplayOrderChange: (order: string[]) => void;
  onEditOwnProfile?: (opts?: { focus?: 'displayName' | 'bio' }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  useEscapeDismiss(onClose);
  const [showBios, setShowBios] = useState(true);

  const roster = sortMembersAgentLast(
    members.filter((m) => !isSystemMemberId(m.id)),
    memberDisplayOrder,
    currentUserId
  );
  const count = roster.length;

  const sizeBounds = (n: number, bios: boolean, forWidth?: number) => {
    const viewportW = typeof window !== 'undefined' ? window.innerWidth - 24 : 1200;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight - 72 : 800;
    const padX = 48;
    const padY = 40;
    const gap = 16;
    const headerH = 58;
    const cardMinW = bios ? 260 : 196;
    const cardMinH = bios ? 184 : 116;
    const minCols = n <= 1 ? 1 : 2;
    const minW = Math.min(
      viewportW,
      Math.max(bios ? 560 : 420, padX + minCols * cardMinW + (minCols - 1) * gap)
    );
    // At least one full card row visible below the header (no crushed rows)
    const w = forWidth ?? minW;
    const cols =
      n <= 1 || w < padX + 2 * cardMinW + gap
        ? 1
        : w < padX + 3 * cardMinW + 2 * gap
          ? 2
          : w < padX + 4 * cardMinW + 3 * gap
            ? 3
            : 4;
    const minH = Math.min(viewportH, headerH + padY + cardMinH);
    return { minW, minH, viewportW, viewportH, cardMinW, cardMinH, cols };
  };

  const defaultWidthForCount = (n: number, bios: boolean) => {
    const { minW, viewportW } = sizeBounds(n, bios);
    if (n <= 1) return Math.max(minW, 448);
    if (n <= 4) return Math.max(minW, 768);
    if (n <= 9) return Math.max(minW, 1024);
    if (n <= 16) return Math.max(minW, 1152);
    return Math.max(minW, Math.min(Math.floor(viewportW * 0.94), 1536));
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  const userResizedRef = useRef(false);
  const [width, setWidth] = useState(() => defaultWidthForCount(count, true));
  const [height, setHeight] = useState<number | null>(null);

  const { cardMinW, minW, minH } = sizeBounds(count, showBios);
  const effectiveWidth = Math.max(width, minW);

  useEffect(() => {
    if (!userResizedRef.current) {
      setWidth(defaultWidthForCount(count, showBios));
      setHeight(null);
      return;
    }
    // User has resized — still enforce dynamic floor when bios/count change
    setWidth((w) => Math.max(w, sizeBounds(count, showBios).minW));
    setHeight((h) => (h == null ? h : Math.max(h, sizeBounds(count, showBios).minH)));
  }, [count, showBios]);

  const twoColFloor = 40 + 2 * cardMinW + 12;
  const gridCols =
    effectiveWidth < twoColFloor || count <= 1
      ? 'grid-cols-1'
      : effectiveWidth < 40 + 3 * cardMinW + 24
        ? 'grid-cols-2'
        : effectiveWidth < 40 + 4 * cardMinW + 36
          ? 'grid-cols-2 sm:grid-cols-3'
          : effectiveWidth < 40 + 5 * cardMinW + 48
            ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
            : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const openOwnProfile = () => {
    onClose();
    onEditOwnProfile?.({ focus: 'bio' });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (isAgentMemberId(String(active.id)) || isAgentMemberId(String(over.id))) return;

    const oldIndex = roster.findIndex((m) => m.id === active.id);
    const newIndex = roster.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextRoster = arrayMove(roster, oldIndex, newIndex);
    const peopleOrder = nextRoster
      .filter((m) => !isAgentMemberId(m.id) && !isSystemMemberId(m.id))
      .map((m) => m.id);
    onMemberDisplayOrderChange(peopleOrder);
  };

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width;
    const startH = dialogRef.current?.offsetHeight ?? 360;
    const bounds = sizeBounds(count, showBios);
    userResizedRef.current = true;

    const onMove = (ev: PointerEvent) => {
      // Dialog is centered: double horizontal delta so the SE corner tracks the pointer.
      setWidth(
        Math.min(bounds.viewportW, Math.max(bounds.minW, startW + (ev.clientX - startX) * 2))
      );
      setHeight(
        Math.min(bounds.viewportH, Math.max(bounds.minH, startH + (ev.clientY - startY)))
      );
    };

    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return createPortal(
    <div
      className="meet-team-backdrop fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-start justify-center overflow-y-auto z-[10020] p-3 sm:p-5 pt-10 sm:pt-14"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="meet-team-dialog relative flex flex-col overflow-hidden rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 mb-8"
        style={{
          width: effectiveWidth,
          minWidth: minW,
          // Hug content until the user resizes; then honor explicit height
          height: height == null ? 'auto' : Math.max(height, minH),
          minHeight: height == null ? undefined : minH,
          maxWidth: 'calc(100vw - 1.5rem)',
          maxHeight: height == null ? 'min(82vh, 48rem)' : undefined,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meet-the-team-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 min-h-5 shrink-0">
          <div className="min-w-0">
            <h3
              id="meet-the-team-title"
              className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide leading-5"
            >
              {t('teamMembers.meetTheTeamTitle')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug truncate">
              {t('teamMembers.meetTheTeamDescription')}
            </p>
          </div>
          <div className="flex items-center shrink-0">
            <KanbanChromeTooltip
              label={showBios ? t('teamMembers.hideBios') : t('teamMembers.showBios')}
              portalZIndex={10040}
            >
              <button
                type="button"
                onClick={() => setShowBios((v) => !v)}
                className={`p-1.5 rounded-md transition-colors ${
                  !showBios
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                aria-label={showBios ? t('teamMembers.hideBios') : t('teamMembers.showBios')}
                aria-pressed={!showBios}
              >
                {showBios ? <Minimize2 size={18} strokeWidth={2.25} /> : <Maximize2 size={18} strokeWidth={2.25} />}
              </button>
            </KanbanChromeTooltip>
            <button
              type="button"
              onClick={onClose}
              className="ml-2.5 p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label={t('buttons.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <DndContext
          id="meet-the-team-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={roster.map((m) => m.id)} strategy={rectSortingStrategy}>
            <div
              className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 grid ${gridCols} gap-3 sm:gap-4`}
              style={{ alignContent: 'start', alignItems: 'stretch' }}
            >
              {roster.map((member) => (
                <MeetTheTeamCard
                  key={member.id}
                  member={member}
                  currentUserId={currentUserId}
                  showBios={showBios}
                  onEditOwnProfile={onEditOwnProfile}
                  openOwnProfile={openOwnProfile}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('teamMembers.resizeModal')}
          title={t('teamMembers.resizeModal')}
          onPointerDown={handleResizePointerDown}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize touch-none z-10"
        >
          <svg
            viewBox="0 0 16 16"
            className="absolute bottom-1 right-1 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none"
            aria-hidden
          >
            <path
              d="M5 15h2M9 15h2M13 15h2M9 11h2M13 11h2M13 7h2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function TeamMembers({
  members,
  selectedMembers,
  onSelectMember,
  onClearSelections,
  onSelectAll,
  isAllModeActive = false,
  includeAssignees = false,
  includeWatchers = false,
  includeCollaborators = false,
  includeRequesters = false,
  includeSystem = false,
  onToggleAssignees,
  onToggleWatchers,
  onToggleCollaborators,
  onToggleRequesters,
  onToggleSystem,
  showAgentTasks = true,
  currentUserId,
  currentUser,
  systemTaskCount = 0,
  onEditOwnProfile,
}: TeamMembersProps) {
  const { t } = useTranslation('common');
  const rootRef = useRef<HTMLDivElement>(null);
  const nameProbeRef = useRef<HTMLDivElement>(null);
  /** Narrow card: hide Assignees/Watchers/… chips */
  const [hideRoleChips, setHideRoleChips] = useState(false);
  /** Avatar-only member row (narrow card OR too many named chips to fit) */
  const [avatarOnly, setAvatarOnly] = useState(false);
  const [meetTheTeamOpen, setMeetTheTeamOpen] = useState(false);
  const [memberDisplayOrder, setMemberDisplayOrder] = useState<string[]>(
    () => loadUserPreferences(currentUserId ?? null).memberDisplayOrder || []
  );

  // Hide System chip when unused; clear sticky filter so it cannot stay on invisibly
  useEffect(() => {
    if (systemTaskCount === 0 && includeSystem && onToggleSystem) {
      onToggleSystem(false);
    }
  }, [systemTaskCount, includeSystem, onToggleSystem]);

  useEffect(() => {
    let cancelled = false;
    loadUserPreferencesAsync(currentUserId ?? null).then((prefs) => {
      if (!cancelled) {
        setMemberDisplayOrder(prefs.memberDisplayOrder || []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const handleMemberDisplayOrderChange = useCallback(
    (order: string[]) => {
      setMemberDisplayOrder(order);
      void updateUserPreference('memberDisplayOrder', order, currentUserId ?? null);
    },
    [currentUserId]
  );

  const displayMembers = sortMembersAgentLast(
    showAgentTasks ? members : members.filter((m) => !isAgentMemberId(m.id)),
    memberDisplayOrder,
    currentUserId
  );

  const recomputeLayout = useCallback(() => {
    const root = rootRef.current;
    const probe = nameProbeRef.current;
    if (!root) return;

    const width = root.clientWidth;
    const narrow = width < NARROW_MAX_WIDTH_PX;
    setHideRoleChips(narrow);

    if (narrow || displayMembers.length === 0) {
      setAvatarOnly(true);
      return;
    }

    if (!probe) {
      setAvatarOnly(false);
      return;
    }

    const available = Math.max(0, width - CARD_PAD_X_PX);
    // Named chips that would overflow a single row → avatar-only (even on wide screens)
    setAvatarOnly(probe.scrollWidth > available + 1);
  }, [displayMembers.length]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    recomputeLayout();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputeLayout());
    ro.observe(root);
    return () => ro.disconnect();
  }, [recomputeLayout, displayMembers]);

  const handleClearSelections = () => {
    if (onClearSelections) {
      onClearSelections();
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative p-3 bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-100 dark:border-gray-700 w-full flex-1 flex flex-col min-w-0 overflow-visible"
      data-tour-id="team-members"
    >
      {/* Off-screen probe: width of named chips in one row */}
      <div
        ref={nameProbeRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 -z-10 flex flex-nowrap gap-2 opacity-0"
        style={{ width: 'max-content', visibility: 'hidden' }}
      >
        {displayMembers.map((member) => (
          <div
            key={`probe-${member.id}`}
            className="flex items-center gap-1 px-2 py-1 shrink-0 text-xs font-medium"
          >
            <span className="w-7 h-7 shrink-0" />
            <span>{truncateDisplayName(member.name)}</span>
          </div>
        ))}
      </div>

      {/* Header: title → Clear → All Roles → role chips | meet-the-team (i) */}
      <div className="flex items-start justify-between mb-3 gap-2 min-h-5 shrink-0 overflow-visible">
        <div className="flex items-center gap-3 flex-wrap min-w-0 overflow-visible">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide leading-5 shrink-0 self-start">
            {t('teamMembers.title')}
          </h2>

          {onClearSelections && (
            <KanbanChromeTooltip label={t('teamMembers.clearSelectionsTooltip')}>
              <button
                type="button"
                onClick={handleClearSelections}
                disabled={selectedMembers.length === 0}
                aria-disabled={selectedMembers.length === 0}
                className={`${formChromeOutlineButtonClass('danger-hover')} disabled:hover:text-gray-600 dark:disabled:hover:text-gray-300 disabled:hover:border-gray-300 dark:disabled:hover:border-gray-600`}
              >
                {t('teamMembers.clear')}
              </button>
            </KanbanChromeTooltip>
          )}

          {onSelectAll && (
            <KanbanChromeTooltip
              label={
                isAllModeActive
                  ? t('teamMembers.showOnlyAssignees')
                  : t('teamMembers.showAllRoles')
              }
            >
              <button
                onClick={onSelectAll}
                className={formChromeOutlineButtonClass('neutral')}
              >
                {isAllModeActive ? t('teamMembers.assigneesOnly') : t('teamMembers.allRoles')}
              </button>
            </KanbanChromeTooltip>
          )}

          {!hideRoleChips && (
            <div className="flex items-center gap-2 overflow-visible">
              {onToggleAssignees && (
                <KanbanChromeTooltip label={t('teamMembers.assigneesTooltip')}>
                  <button
                    onClick={() => onToggleAssignees(!includeAssignees)}
                    className={formRoleChipClass(includeAssignees)}
                  >
                    <span>{t('teamMembers.assignees')}</span>
                  </button>
                </KanbanChromeTooltip>
              )}

              {onToggleWatchers && (
                <KanbanChromeTooltip label={t('teamMembers.watchersTooltip')}>
                  <button
                    type="button"
                    onClick={() => onToggleWatchers(!includeWatchers)}
                    className={formRoleChipClass(includeWatchers)}
                  >
                    <span>{t('teamMembers.watchers')}</span>
                  </button>
                </KanbanChromeTooltip>
              )}

              {onToggleCollaborators && (
                <KanbanChromeTooltip label={t('teamMembers.collaboratorsTooltip')}>
                  <button
                    type="button"
                    onClick={() => onToggleCollaborators(!includeCollaborators)}
                    className={formRoleChipClass(includeCollaborators)}
                  >
                    <span>{t('teamMembers.collaborators')}</span>
                  </button>
                </KanbanChromeTooltip>
              )}

              {onToggleRequesters && (
                <KanbanChromeTooltip label={t('teamMembers.requestersTooltip')}>
                  <button
                    onClick={() => onToggleRequesters(!includeRequesters)}
                    className={formRoleChipClass(includeRequesters)}
                  >
                    <span>{t('teamMembers.requesters')}</span>
                  </button>
                </KanbanChromeTooltip>
              )}

              <KanbanChromeTooltip label={t('teamMembers.unassignedTooltip')}>
                <button
                  type="button"
                  onClick={() => onSelectMember(UNASSIGNED_MEMBER_FILTER_ID)}
                  className={formRoleChipClass(
                    selectedMembers.includes(UNASSIGNED_MEMBER_FILTER_ID)
                  )}
                >
                  <MemberAvatar member={null} size="xs" />
                  <span>{t('teamMembers.unassigned')}</span>
                </button>
              </KanbanChromeTooltip>

              {onToggleSystem &&
                currentUser?.roles?.includes('admin') &&
                systemTaskCount > 0 && (
                <KanbanChromeTooltip label={t('teamMembers.systemTooltip')}>
                  <button
                    type="button"
                    onClick={() => onToggleSystem(!includeSystem)}
                    className={formRoleChipClass(includeSystem)}
                  >
                    <span>{t('teamMembers.system')}</span>
                    <span className="ml-0.5 px-1.5 py-0.5 bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                      {systemTaskCount}
                    </span>
                  </button>
                </KanbanChromeTooltip>
              )}
            </div>
          )}
        </div>

        <KanbanChromeTooltip label={t('teamMembers.meetTheTeam')}>
          <button
            type="button"
            onClick={() => setMeetTheTeamOpen(true)}
            className="shrink-0 p-1 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={t('teamMembers.meetTheTeam')}
          >
            <Info size={16} strokeWidth={2.25} />
          </button>
        </KanbanChromeTooltip>
      </div>

      {!includeAssignees &&
        !includeWatchers &&
        !includeCollaborators &&
        !includeRequesters &&
        !selectedMembers.includes(UNASSIGNED_MEMBER_FILTER_ID) && (
        <div className="mb-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2 py-1 rounded border border-red-200 dark:border-red-800">
          {t('teamMembers.noFiltersSelected')}
        </div>
      )}

      <div
        className={`flex content-start flex-1 ${
          avatarOnly
            ? 'flex-nowrap overflow-x-auto py-1 px-0.5 -mx-0.5 gap-1.5'
            : 'flex-wrap overflow-visible gap-2'
        }`}
      >
        {displayMembers.map(member => {
          const isSelected = selectedMembers.includes(member.id);
          const isInactiveMember =
            memberIsInactive(member) &&
            !isAgentMemberId(member.id) &&
            !isSystemMemberId(member.id);
          const statusLabel = isSelected
            ? t('teamMembers.selected')
            : t('teamMembers.clickToSelect');
          const showContact = canShowMemberContactTooltip(member);
          const isSelf = Boolean(
            currentUserId && member.user_id && member.user_id === currentUserId
          );
          const tooltipProps = showContact
            ? {
                interactive: true as const,
                content: (
                  <MemberContactTooltipBody
                    member={member}
                    statusLabel={statusLabel}
                    isSelf={isSelf}
                    onEditOwnProfile={onEditOwnProfile}
                    inactiveAccount={isInactiveMember}
                  />
                ),
              }
            : {
                label: `${member.name} ${statusLabel}`,
              };

          if (avatarOnly) {
            return (
              <KanbanChromeTooltip
                key={member.id}
                wrapperClassName="relative inline-flex shrink-0"
                {...tooltipProps}
              >
                <button
                  type="button"
                  className={`shrink-0 rounded-full transition-shadow duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isSelected
                      ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-sm'
                      : isInactiveMember
                        ? 'opacity-70 hover:opacity-85'
                        : 'hover:opacity-90'
                  }`}
                  onClick={() => onSelectMember(member.id)}
                >
                  {memberAvatarNode(
                    member,
                    'w-7 h-7',
                    'text-xs',
                    t('messages.readOnlyBadge')
                  )}
                </button>
              </KanbanChromeTooltip>
            );
          }
          return (
            <KanbanChromeTooltip
              key={member.id}
              wrapperClassName="relative inline-flex shrink-0"
              {...tooltipProps}
            >
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-full cursor-pointer transition-all duration-200 shrink-0 ${
                  isSelected
                    ? 'ring-2 ring-inset ring-blue-500 dark:ring-blue-400 shadow-sm'
                    : isInactiveMember
                      ? 'opacity-60 hover:opacity-80 hover:shadow-sm'
                      : 'hover:shadow-sm hover:scale-101'
                }`}
                style={{
                  backgroundColor: isSelected ? `${member.color}25` : `${member.color}15`,
                }}
                onClick={() => onSelectMember(member.id)}
              >
                {memberAvatarNode(
                  member,
                  'w-7 h-7',
                  'text-xs',
                  t('messages.readOnlyBadge')
                )}
                <span
                  className={`text-xs ${
                    isInactiveMember
                      ? 'text-gray-500 dark:text-gray-400 italic'
                      : 'text-gray-800 dark:text-gray-100'
                  } ${isSelected ? 'font-semibold' : 'font-medium'}`}
                >
                  {truncateDisplayName(member.name)}
                </span>
              </div>
            </KanbanChromeTooltip>
          );
        })}
      </div>

      {meetTheTeamOpen ? (
        <MeetTheTeamModal
          members={members}
          currentUserId={currentUserId}
          memberDisplayOrder={memberDisplayOrder}
          onMemberDisplayOrderChange={handleMemberDisplayOrderChange}
          onEditOwnProfile={onEditOwnProfile}
          onClose={() => setMeetTheTeamOpen(false)}
        />
      ) : null}
    </div>
  );
}
