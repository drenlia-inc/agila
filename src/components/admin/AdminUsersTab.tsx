import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Edit, Trash2, User as UserIcon, Mail, Loader2, Search, X, ArrowUp, ArrowDown, ChevronsUpDown, ChevronDown, Check, Eye, Shield } from 'lucide-react';
import { getAuthenticatedAvatarUrl } from '../../utils/authImageUrl';
import { AGENT_BOT_AVATAR_SRC } from '../../utils/agentMemberUi';
import { toast } from '../../utils/toast';
import { CHROME_TOOLTIP_SURFACE_CLASS } from '../KanbanChromeTooltip';
import { ModernCheckbox } from '../ModernCheckbox';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';
import { useSettings } from '../../contexts/SettingsContext';
import {
  ADMIN_TABLE_ROW_ACTIVE_CLASS,
  ADMIN_TABLE_ROW_CLASS,
} from '../../utils/adminFieldLimits';
import { MODAL_OVERLAY_Z_INDEX } from '../../constants/appConstants';
import { formatToYYYYMMDDHHmmss } from '../../utils/dateUtils';
import {
  adminLabelClass,
  adminLabelLockedClass,
  adminLockedSurfaceClass,
  adminModalInputEditableClass,
  adminModalInputLockedClass,
} from './AdminSection';
import { AdminToggle } from './AdminToggle';
import MemberColorPickerDialog from './MemberColorPickerDialog';
import { DEFAULT_MEMBER_COLOR } from '../../constants/memberColorPalette';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  isActive: boolean;
  roles: string[];
  joined: string;
  createdAt: string;
  lastLoginAt?: string | null;
  avatarUrl?: string;
  authProvider?: string;
  googleAvatarUrl?: string;
  memberColor?: string;
}

interface AdminUsersTabProps {
  users: User[];
  loading: boolean;
  currentUser: any;
  ownerEmail: string | null;
  showDeleteConfirm: string | null;
  userTaskCounts: { [userId: string]: number };
  onRoleChange: (userId: string, role: 'admin' | 'user' | 'viewer') => Promise<void>;
  onStatusChange: (userId: string, isActive: boolean) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onConfirmDeleteUser: (userId: string, reassignToUserId?: string | null) => Promise<void>;
  onCancelDeleteUser: () => void;
  onAddUser: (userData: any) => Promise<void>;
  onEditUser: (user: User) => void;
  onSaveUser: (userData: any) => Promise<void>;
  onColorChange: (userId: string, color: string) => Promise<void>;
  onRemoveAvatar: (userId: string) => Promise<void>;
  onResendInvitation: (userId: string) => Promise<{ email?: string } | void>;
}

type RoleValue = 'admin' | 'user' | 'viewer';

const ROLE_OPTIONS: RoleValue[] = ['user', 'viewer', 'admin'];

function roleToneClasses(role: string): string {
  if (role === 'admin') {
    return 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800';
  }
  if (role === 'viewer') {
    return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
}

function roleDotClass(role: RoleValue): string {
  if (role === 'admin') return 'bg-violet-500';
  if (role === 'viewer') return 'bg-sky-500';
  return 'bg-slate-400 dark:bg-slate-500';
}

function UserListAvatarRoleBadge({
  role,
  labels,
}: {
  role: RoleValue;
  labels: Record<RoleValue, string>;
}) {
  if (role !== 'admin' && role !== 'viewer') return null;
  const isAdmin = role === 'admin';
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white dark:ring-slate-900 ${
        isAdmin
          ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
          : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
      }`}
      aria-label={isAdmin ? labels.admin : labels.viewer}
      title={isAdmin ? labels.admin : labels.viewer}
    >
      {isAdmin ? (
        <Shield size={10} strokeWidth={2.5} aria-hidden />
      ) : (
        <Eye size={10} strokeWidth={2.5} aria-hidden />
      )}
    </span>
  );
}

type StatusValue = 'active' | 'inactive';
const STATUS_OPTIONS: StatusValue[] = ['active', 'inactive'];

function statusToneClasses(status: StatusValue): string {
  if (status === 'active') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800';
  }
  return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800';
}

function statusDotClass(status: StatusValue): string {
  return status === 'active' ? 'bg-emerald-500' : 'bg-orange-500';
}

function StatusBadgeSelect({
  value,
  onChange,
  disabled = false,
  title,
  labels,
}: {
  value: boolean;
  onChange: (isActive: boolean) => void;
  disabled?: boolean;
  title?: string;
  labels: Record<StatusValue, string>;
}) {
  const statusValue: StatusValue = value ? 'active' : 'inactive';
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateMenuPos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 132);
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.right - menuWidth);
    }
    const estimatedHeight = 88;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < estimatedHeight && rect.top > estimatedHeight
        ? rect.top - estimatedHeight - 4
        : rect.bottom + 4;
    setMenuPos({ top, left, width: menuWidth });
  };

  const selectStatus = (status: StatusValue) => {
    const nextActive = status === 'active';
    if (nextActive !== value) {
      onChange(nextActive);
    }
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, STATUS_OPTIONS.indexOf(statusValue));
    setActiveIndex(idx);
    updateMenuPos();
    requestAnimationFrame(() => {
      optionRefs.current[idx]?.focus();
    });

    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onReposition = () => updateMenuPos();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, statusValue]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (activeIndex + delta + STATUS_OPTIONS.length) % STATUS_OPTIONS.length;
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectStatus(STATUS_OPTIONS[activeIndex]);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={title}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`w-full inline-flex items-center justify-between gap-1.5 font-medium rounded-md border transition-colors px-1.5 py-1 text-[11px] ${
          disabled
            ? adminLockedSurfaceClass
            : `${statusToneClasses(statusValue)} hover:brightness-[0.98] dark:hover:brightness-110 cursor-pointer`
        }`}
      >
        <span className="truncate font-medium">{labels[statusValue]}</span>
        <ChevronDown
          size={12}
          className={`shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={title}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            className="fixed z-[11000] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {STATUS_OPTIONS.map((status, index) => {
              const selected = status === statusValue;
              const active = index === activeIndex;
              return (
                <button
                  key={status}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={active ? 0 : -1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectStatus(status)}
                  className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                    selected
                      ? 'bg-blue-50 dark:bg-blue-950/40'
                      : active
                        ? 'bg-slate-100 dark:bg-slate-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <span
                    className={`shrink-0 h-2 w-2 rounded-full ${statusDotClass(status)}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {labels[status]}
                    </span>
                    {selected && (
                      <Check
                        size={12}
                        className="shrink-0 text-blue-600 dark:text-blue-400"
                        aria-hidden
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

function RoleBadgeSelect({
  value,
  onChange,
  disabled = false,
  size = 'sm',
  title,
  labels,
  descriptions,
}: {
  value: RoleValue;
  onChange: (role: RoleValue) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  labels: Record<RoleValue, string>;
  descriptions?: Partial<Record<RoleValue, string>>;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const isMd = size === 'md';
  const hasDescriptions = Boolean(descriptions && ROLE_OPTIONS.some((r) => descriptions[r]));

  const updateMenuPos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, isMd ? 280 : 140);
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.right - menuWidth);
    }
    const estimatedHeight = hasDescriptions ? 220 : 132;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < estimatedHeight && rect.top > estimatedHeight
        ? rect.top - estimatedHeight - 4
        : rect.bottom + 4;
    setMenuPos({ top, left, width: menuWidth });
  };

  const selectRole = (role: RoleValue) => {
    onChange(role);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, ROLE_OPTIONS.indexOf(value));
    setActiveIndex(idx);
    updateMenuPos();
    // Focus the active option after paint so keyboard nav works immediately
    requestAnimationFrame(() => {
      optionRefs.current[idx]?.focus();
    });

    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onReposition = () => updateMenuPos();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, isMd, hasDescriptions, value]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (activeIndex + delta + ROLE_OPTIONS.length) % ROLE_OPTIONS.length;
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
      optionRefs.current[0]?.focus();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = ROLE_OPTIONS.length - 1;
      setActiveIndex(last);
      optionRefs.current[last]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectRole(ROLE_OPTIONS[activeIndex]);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={title}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={
          isMd
            ? `w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-md transition-colors ${
                disabled ? adminLockedSurfaceClass : 'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 hover:border-slate-400 dark:hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer'
              }`
            : `w-full inline-flex items-center justify-between gap-1.5 font-medium rounded-md border transition-colors px-1.5 py-1 text-[11px] ${
                disabled
                  ? adminLockedSurfaceClass
                  : `${roleToneClasses(value)} hover:brightness-[0.98] dark:hover:brightness-110 cursor-pointer`
              }`
        }
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          {isMd && (
            <span
              className={`shrink-0 h-2 w-2 rounded-full ${roleDotClass(value)}`}
              aria-hidden
            />
          )}
          <span className="truncate font-medium">{labels[value]}</span>
        </span>
        <ChevronDown
          size={isMd ? 16 : 12}
          className={`shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={title}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            className="fixed z-[11000] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {ROLE_OPTIONS.map((role, index) => {
              const selected = role === value;
              const active = index === activeIndex;
              const description = descriptions?.[role];
              return (
                <button
                  key={role}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={active ? 0 : -1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectRole(role)}
                  className={`w-full flex gap-2.5 rounded-md px-2.5 text-left transition-colors ${
                    isMd ? 'items-start py-2' : 'items-center py-1.5'
                  } ${
                    selected
                      ? 'bg-blue-50 dark:bg-blue-950/40'
                      : active
                        ? 'bg-slate-100 dark:bg-slate-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <span
                    className={`shrink-0 h-2 w-2 rounded-full ${roleDotClass(role)} ${
                      isMd ? 'mt-1.5' : ''
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`flex items-center justify-between gap-2 ${
                        isMd ? 'text-sm' : 'text-[11px]'
                      }`}
                    >
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {labels[role]}
                      </span>
                      {selected && (
                        <Check
                          size={isMd ? 15 : 12}
                          className="shrink-0 text-blue-600 dark:text-blue-400"
                          aria-hidden
                        />
                      )}
                    </span>
                    {description && (
                      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        {description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  users,
  loading,
  currentUser,
  ownerEmail,
  showDeleteConfirm,
  userTaskCounts,
  onRoleChange,
  onStatusChange,
  onDeleteUser,
  onConfirmDeleteUser,
  onCancelDeleteUser,
  onAddUser,
  onEditUser,
  onSaveUser,
  onColorChange,
  onRemoveAvatar,
  onResendInvitation,
}) => {
  const { t } = useTranslation('admin');
  const { systemSettings } = useSettings();
  // Email invites are disabled when DEMO_ENABLED=true (see emailService)
  const isDemoMode = process.env.DEMO_ENABLED === 'true';
  const visibleUsers = useMemo(() => {
    const aiEnabled = systemSettings?.AI_ENABLED === 'true';
    if (!Array.isArray(users)) return [];
    return aiEnabled ? users : users.filter((u) => u.email !== 'agent@local');
  }, [users, systemSettings?.AI_ENABLED]);

  type StatusFilter = 'all' | 'active' | 'inactive';
  type RoleFilter = 'all' | 'admin' | 'member' | 'viewer';
  type AuthFilter = 'all' | 'local' | 'google';
  type SortKey = 'name' | 'status' | 'auth' | 'joined' | 'lastLogin' | 'role';
  type SortDir = 'asc' | 'desc';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [authFilter, setAuthFilter] = useState<AuthFilter>('all');
  const [userSearch, setUserSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterToolbarRef = useRef<HTMLDivElement>(null);

  const userMatchesSearch = (user: User, q: string) => {
    if (!q) return true;
    const haystack = [
      user.firstName,
      user.lastName,
      user.displayName,
      user.email,
      `${user.firstName || ''} ${user.lastName || ''}`,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  };

  const userMatchesStatus = (user: User, status: StatusFilter) => {
    if (status === 'active') return user.isActive;
    if (status === 'inactive') return !user.isActive;
    return true;
  };

  const userMatchesRole = (user: User, role: RoleFilter) => {
    if (role === 'admin') return user.roles.includes('admin');
    if (role === 'viewer') return user.roles.includes('viewer');
    if (role === 'member') {
      return !user.roles.includes('admin') && !user.roles.includes('viewer');
    }
    return true;
  };

  const userMatchesAuth = (user: User, auth: AuthFilter) => {
    if (auth === 'google') return user.authProvider === 'google';
    if (auth === 'local') return user.authProvider !== 'google';
    return true;
  };

  const searchQuery = userSearch.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    return visibleUsers.filter(
      (user) =>
        userMatchesStatus(user, statusFilter) &&
        userMatchesRole(user, roleFilter) &&
        userMatchesAuth(user, authFilter) &&
        userMatchesSearch(user, searchQuery)
    );
  }, [visibleUsers, statusFilter, roleFilter, authFilter, searchQuery]);

  const userSummary = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let admin = 0;
    let member = 0;
    let viewer = 0;
    let local = 0;
    let google = 0;
    for (const user of visibleUsers) {
      if (user.isActive) active += 1;
      else inactive += 1;
      if (!userMatchesSearch(user, searchQuery)) continue;
      const okStatusAuth =
        userMatchesStatus(user, statusFilter) && userMatchesAuth(user, authFilter);
      const okStatusRole =
        userMatchesStatus(user, statusFilter) && userMatchesRole(user, roleFilter);
      if (okStatusAuth) {
        if (user.roles.includes('admin')) admin += 1;
        else if (user.roles.includes('viewer')) viewer += 1;
        else member += 1;
      }
      if (okStatusRole) {
        if (user.authProvider === 'google') google += 1;
        else local += 1;
      }
    }
    return { total: visibleUsers.length, active, inactive, admin, member, viewer, local, google };
  }, [visibleUsers, statusFilter, roleFilter, authFilter, searchQuery]);

  const displayedUsers = useMemo(() => {
    const list = [...filteredUsers];
    const dir = sortDir === 'asc' ? 1 : -1;
    const nameOf = (u: User) =>
      (u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '').toLowerCase();
    const roleRank = (u: User) =>
      u.roles.includes('admin') ? 0 : u.roles.includes('viewer') ? 2 : 1;
    const joinedOf = (u: User) => {
      const raw = u.joined || u.createdAt || '';
      const t = Date.parse(raw);
      return Number.isFinite(t) ? t : 0;
    };
    const lastLoginOf = (u: User) => {
      const raw = u.lastLoginAt || '';
      const t = Date.parse(raw);
      return Number.isFinite(t) ? t : 0;
    };
    const isPinnedBottom = (u: User) => {
      const e = String(u.email || '').toLowerCase();
      return e === 'agent@local' || e === 'system@local';
    };
    list.sort((a, b) => {
      const aPin = isPinnedBottom(a) ? 1 : 0;
      const bPin = isPinnedBottom(b) ? 1 : 0;
      if (aPin !== bPin) return aPin - bPin;

      let cmp = 0;
      switch (sortKey) {
        case 'status':
          cmp = Number(b.isActive) - Number(a.isActive);
          break;
        case 'auth':
          cmp = (a.authProvider || 'local').localeCompare(b.authProvider || 'local');
          break;
        case 'role':
          cmp = roleRank(a) - roleRank(b);
          break;
        case 'lastLogin':
          cmp = lastLoginOf(a) - lastLoginOf(b);
          break;
        case 'joined':
          cmp = joinedOf(a) - joinedOf(b);
          break;
        case 'name':
        default:
          cmp = nameOf(a).localeCompare(nameOf(b));
          break;
      }
      if (cmp === 0 && sortKey !== 'name') {
        cmp = nameOf(a).localeCompare(nameOf(b));
      }
      return cmp * dir;
    });
    return list;
  }, [filteredUsers, sortKey, sortDir]);

  const hasActiveFilters =
    statusFilter !== 'all' ||
    roleFilter !== 'all' ||
    authFilter !== 'all' ||
    userSearch.trim() !== '';

  const clearUserFilters = () => {
    setStatusFilter('all');
    setRoleFilter('all');
    setAuthFilter('all');
    setUserSearch('');
  };

  const toggleStatusFilter = (next: Exclude<StatusFilter, 'all'>) => {
    setStatusFilter((prev) => (prev === next ? 'all' : next));
  };
  const toggleRoleFilter = (next: Exclude<RoleFilter, 'all'>) => {
    setRoleFilter((prev) => (prev === next ? 'all' : next));
  };
  const toggleAuthFilter = (next: Exclude<AuthFilter, 'all'>) => {
    setAuthFilter((prev) => (prev === next ? 'all' : next));
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'joined' || key === 'lastLogin' ? 'desc' : 'asc');
    }
  };

  const filterGroupClass = (active: boolean) =>
    `inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md px-1 py-0.5 transition-colors ${
      active
        ? 'bg-sky-50 ring-1 ring-sky-300/80 dark:bg-sky-950/40 dark:ring-sky-700'
        : ''
    }`;

  const filterChipClass = (active: boolean, emphasize = false) =>
    `rounded-md px-1.5 py-0.5 transition-colors ${
      active
        ? 'bg-sky-600 text-white shadow-sm dark:bg-sky-500 font-semibold'
        : emphasize
          ? 'text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40'
          : 'hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'
    }`;
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showEditUserForm, setShowEditUserForm] = useState(false);
  const [colorPickerUserId, setColorPickerUserId] = useState<string | null>(null);
  const colorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [editingColor, setEditingColor] = useState<string>(DEFAULT_MEMBER_COLOR);
  const [isSavingColor, setIsSavingColor] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isResendingInvitation, setIsResendingInvitation] = useState<boolean>(false);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [hoveredButton, setHoveredButton] = useState<{userId: string, type: 'promote' | 'demote' | 'edit' | 'delete' | 'resend', position: {top: number, left: number}} | null>(null);
  
  const [deleteReassignToUserId, setDeleteReassignToUserId] = useState<string>(''); // '' = System
  // Refs for button positioning and focus
  const deleteButtonRefs = useRef<{[key: string]: HTMLButtonElement | null}>({});
  const actionButtonRefs = useRef<{[key: string]: {[type: string]: HTMLButtonElement | null}}>({});
  const noButtonRef = useRef<HTMLButtonElement>(null);
  const [deleteButtonPosition, setDeleteButtonPosition] = useState<{top: number, left: number, userId: string, maxHeight?: number} | null>(null);

  const getEmptyNewUser = () => ({
    email: '',
    firstName: '',
    lastName: '',
    displayName: '',
    role: 'user',
    // Demo mode cannot send invites — always create locally as active
    isActive: isDemoMode ? true : false
  });
  
  // Helper function to check if a user is the instance owner
  const isOwner = (userEmail: string) => {
    return ownerEmail && userEmail === ownerEmail;
  };

  // Handle button hover for tooltips
  const handleButtonMouseEnter = (userId: string, type: 'promote' | 'demote' | 'edit' | 'delete' | 'resend', e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredButton({
      userId,
      type,
      position: {
        top: rect.top - 8, // Position above button
        left: rect.left + rect.width / 2 // Center horizontally
      }
    });
  };

  const handleButtonMouseLeave = () => {
    setHoveredButton(null);
  };

  // Helper function to check if current user can modify a given user (role / delete / activate)
  const canModifyUser = (userEmail: string) => {
    // Owner can only be modified by themselves
    if (isOwner(userEmail)) {
      return currentUser?.email === userEmail;
    }
    // Pseudo-accounts: profile-only edits (name / display name / avatar)
    if (userEmail === 'agent@local' || userEmail === 'system@local') {
      return false;
    }
    // Other users can be modified by any admin
    return true;
  };

  /** Profile fields (names, avatar) — allowed for Agent / System; owner still self-only. */
  const canEditUserProfile = (userEmail: string) => {
    if (isOwner(userEmail)) {
      return currentUser?.email === userEmail;
    }
    return true;
  };

  /** Admins may edit their own profile but cannot deactivate themselves. */
  const canChangeUserActivation = (userId: string, userEmail: string) => {
    if (userId === currentUser?.id) return false;
    if (isLocalPseudoAccount(userEmail)) return false;
    return canModifyUser(userEmail);
  };

  /** Pseudo @local accounts never receive invite emails. */
  const isLocalPseudoAccount = (userEmail: string) =>
    typeof userEmail === 'string' && userEmail.toLowerCase().endsWith('@local');

  const canResendInvitation = (user: User) =>
    !isDemoMode &&
    user.authProvider === 'local' &&
    !user.isActive &&
    !isLocalPseudoAccount(user.email) &&
    canModifyUser(user.email);
  
  // Focus the "No" button when any delete dialog opens and handle Enter key
  useEffect(() => {
    if (showDeleteConfirm) {
      setDeleteReassignToUserId('');
      // Small delay to ensure the dialog has rendered
      setTimeout(() => {
        noButtonRef.current?.focus();
      }, 50);
    }
  }, [showDeleteConfirm]);

  // Cleanup preview URL on component unmount
  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  // Handle Enter and ESC keys to choose "No"/cancel by default for all users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showDeleteConfirm && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        setDeleteButtonPosition(null);
        onCancelDeleteUser();
      }
    };

    if (showDeleteConfirm) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showDeleteConfirm, onCancelDeleteUser]);

  // Outside click dismisses delete confirmation (defer so opening click does not close it)
  useEffect(() => {
    if (!showDeleteConfirm) return undefined;
    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Element;
        if (!target.closest('.delete-confirmation')) {
          setDeleteButtonPosition(null);
          onCancelDeleteUser();
        }
      };
      document.addEventListener('mousedown', handleOutside);
      remove = () => document.removeEventListener('mousedown', handleOutside);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      remove?.();
    };
  }, [showDeleteConfirm, onCancelDeleteUser]);

  
  const [editingUserData, setEditingUserData] = useState({
    id: '',
    email: '',
    firstName: '',
    lastName: '',
    displayName: '',
    isActive: true,
    role: 'user' as 'admin' | 'user' | 'viewer',
    avatarUrl: '',
    googleAvatarUrl: '',
    memberColor: '#4ECDC4',
    selectedFile: null as File | null,
    authProvider: ''
  });
  /** Saved row for the user currently in the edit modal (ignore unsaved Active checkbox). */
  const persistedEditingUser = users.find((u) => u.id === editingUserData.id) || null;
  const [editingUserInitialRole, setEditingUserInitialRole] = useState<'admin' | 'user' | 'viewer'>('user');

  const roleLabels = useMemo(
    () => ({
      user: t('users.user'),
      viewer: t('users.viewer'),
      admin: t('users.admin'),
    }),
    [t]
  );
  const roleDescriptions = useMemo(
    () => ({
      user: t('users.roleUserHint'),
      viewer: t('users.roleViewerHint'),
      admin: t('users.roleAdminHint'),
    }),
    [t]
  );
  const statusLabels = useMemo(
    () => ({
      active: t('users.active'),
      inactive: t('users.inactive'),
    }),
    [t]
  );
  
  const [newUser, setNewUser] = useState(getEmptyNewUser);

  const openColorPicker = (userId: string, currentColor: string) => {
    setEditingColor(currentColor || DEFAULT_MEMBER_COLOR);
    setColorPickerUserId(userId);
  };

  const handleCancelColorPicker = () => {
    if (isSavingColor) return;
    setColorPickerUserId(null);
  };

  const handleSaveColor = async (color: string) => {
    if (!colorPickerUserId) return;
    try {
      setIsSavingColor(true);
      await onColorChange(colorPickerUserId, color);
      setColorPickerUserId(null);
    } catch (err) {
      console.error('Failed to save color:', err);
    } finally {
      setIsSavingColor(false);
    }
  };

  const colorPickerUser = colorPickerUserId
    ? users.find((u) => u.id === colorPickerUserId)
    : null;
  const colorPickerUserLabel = colorPickerUser
    ? colorPickerUser.displayName ||
      `${colorPickerUser.firstName} ${colorPickerUser.lastName}`.trim() ||
      colorPickerUser.email
    : undefined;

  const handleUserAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        console.error('Please select an image file');
        return;
      }
      
      // Validate file size (2MB limit)
      if (file.size > 2 * 1024 * 1024) {
        console.error('Image size must be less than 2MB');
        return;
      }

      // Create preview URL
      const previewUrl = URL.createObjectURL(file);
      setAvatarPreviewUrl(previewUrl);

      setEditingUserData(prev => ({ ...prev, selectedFile: file }));
    }
  };

  const handleAddUser = async () => {
    if (isAddingUser) return;
    const userPayload = isDemoMode ? { ...newUser, isActive: true } : newUser;
    const emailNorm = String(userPayload.email || '').trim().toLowerCase();
    if (!emailNorm) {
      toast.error(t('users.email'), '');
      return;
    }
    if (users.some((u) => String(u.email || '').trim().toLowerCase() === emailNorm)) {
      toast.error(t('users.emailAlreadyExists', { email: emailNorm }), '');
      return;
    }
    const creatingLocally = Boolean(userPayload.isActive);
    setIsAddingUser(true);
    try {
      await onAddUser({ ...userPayload, email: emailNorm });
      setShowAddUserForm(false);
      setNewUser(getEmptyNewUser());
      if (creatingLocally) {
        toast.success(t('users.userCreatedSuccessfully'), '');
      } else {
        toast.success(
          t('users.userInvitedSuccessfully', { email: emailNorm }),
          ''
        );
      }
    } catch (err: any) {
      console.error('Failed to add user:', err);
      const backendError = err.response?.data?.error || err.message || '';
      const errorMessage =
        /already exists/i.test(String(backendError))
          ? t('users.emailAlreadyExists', { email: emailNorm })
          : backendError || t('failedToCreateUser');
      toast.error(errorMessage, '');
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleEditUserClick = (user: User) => {
    // Clean up any existing preview URL
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
      setAvatarPreviewUrl(null);
    }
    
    const role: 'admin' | 'user' | 'viewer' = user.roles.includes('admin')
      ? 'admin'
      : user.roles.includes('viewer')
        ? 'viewer'
        : 'user';
    setEditingUserData({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName || `${user.firstName} ${user.lastName}`,
      isActive: user.isActive,
      role,
      avatarUrl: user.avatarUrl || '',
      googleAvatarUrl: user.googleAvatarUrl || '',
      memberColor: user.memberColor || '#4ECDC4',
      selectedFile: null,
      authProvider: user.authProvider || ''
    });
    setEditingUserInitialRole(role);
    setShowEditUserForm(true);
    onEditUser(user);
  };

  const handleSaveUser = async () => {
    try {
      setIsSubmitting(true);
      const emailNorm = String(editingUserData.email || '').trim().toLowerCase();
      if (
        users.some(
          (u) =>
            u.id !== editingUserData.id &&
            String(u.email || '').trim().toLowerCase() === emailNorm
        )
      ) {
        toast.error(t('users.emailAlreadyExists', { email: emailNorm }), '');
        return;
      }
      await onSaveUser({ ...editingUserData, email: emailNorm });
      if (
        editingUserData.role !== editingUserInitialRole &&
        canModifyUser(editingUserData.email) &&
        editingUserData.id !== currentUser?.id
      ) {
        await onRoleChange(editingUserData.id, editingUserData.role);
      }
      
      // Clean up preview URL after successful save
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
        setAvatarPreviewUrl(null);
      }
      
      setShowEditUserForm(false);
    } catch (err: any) {
      console.error('Failed to save user:', err);
      const backendError = err.response?.data?.error || err.message || '';
      const errorMessage = /already exists/i.test(String(backendError))
        ? t('users.emailAlreadyExists', {
            email: String(editingUserData.email || '').trim().toLowerCase(),
          })
        : backendError || t('failedToUpdateUser');
      toast.error(errorMessage, '');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEditUser = () => {
    // Clean up preview URL
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
      setAvatarPreviewUrl(null);
    }
    
    setShowEditUserForm(false);
    setEditingUserData({
      id: '',
      email: '',
      firstName: '',
      lastName: '',
      displayName: '',
      isActive: true,
      role: 'user',
      avatarUrl: '',
      googleAvatarUrl: '',
      memberColor: '#4ECDC4',
      selectedFile: null,
      authProvider: ''
    });
    setEditingUserInitialRole('user');
  };

  const handleResendInvitation = async (userId?: string) => {
    const targetId = userId || editingUserData.id;
    if (!targetId || isResendingInvitation) return;
    const savedUser = users.find((u) => u.id === targetId);
    // Never resend from unsaved edit-form state — only when the account is inactive in saved data
    if (!savedUser || !canResendInvitation(savedUser)) {
      toast.error(t('users.saveDeactivationBeforeResend'), '');
      return;
    }
    try {
      setIsResendingInvitation(true);
      setResendingUserId(targetId);
      const result = await onResendInvitation(targetId);
      const email = result?.email;
      toast.success(
        email
          ? t('invitationEmailSent', { email })
          : t('users.invitationEmailSentSuccessfully'),
        ''
      );
    } catch (err: any) {
      console.error('Failed to resend invitation:', err);
      const errorMessage = err.response?.data?.error || err.message || t('failedToSendInvitationEmail');
      toast.error(errorMessage, '');
    } finally {
      setIsResendingInvitation(false);
      setResendingUserId(null);
    }
  };

  const handleCancelAddUser = () => {
    setShowAddUserForm(false);
    setNewUser(getEmptyNewUser());
  };

  useEscapeDismiss(
    () => {
      if (isAddingUser || isSubmitting) return;
      if (showAddUserForm) {
        handleCancelAddUser();
      } else if (showEditUserForm) {
        handleCancelEditUser();
      }
    },
    { enabled: (showAddUserForm || showEditUserForm) && !showDeleteConfirm }
  );

  // ESC: search clears → blur; filters clear → blur focused chip (when no modal open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (showAddUserForm || showEditUserForm || showDeleteConfirm || colorPickerUserId) return;

      const searchEl = searchInputRef.current;
      const searchFocused = searchEl != null && document.activeElement === searchEl;

      if (searchFocused) {
        e.preventDefault();
        e.stopPropagation();
        if (userSearch.trim() !== '') {
          setUserSearch('');
        } else {
          searchEl.blur();
        }
        return;
      }

      if (hasActiveFilters) {
        e.preventDefault();
        e.stopPropagation();
        clearUserFilters();
        return;
      }

      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        filterToolbarRef.current?.contains(active)
      ) {
        e.preventDefault();
        e.stopPropagation();
        active.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    showAddUserForm,
    showEditUserForm,
    showDeleteConfirm,
    colorPickerUserId,
    userSearch,
    hasActiveFilters,
  ]);

  const handleNewUserChange = (field: string, value: string) => {
    setNewUser(prev => ({ ...prev, [field]: value }));
  };

  const handleAddUserClick = async () => {
    // Check if user can be created before opening the modal
    try {
      const response = await fetch('/api/admin/users/can-create', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });

      if (!response.ok) {
        toast.error(t('users.failedToCheckUserLimit'), '');
        return;
      }

      const result = await response.json();

      if (!result.canCreate) {
        toast.error(result.message || t('users.userLimitReached'), '');
        return;
      }

      // Limit check passed, open the modal
      setShowAddUserForm(true);
    } catch (error) {
      console.error('Error checking user limit:', error);
      toast.error('Failed to check user limit. Please try again.', '');
    }
  };

  return (
    <>
      <div className="p-6">
        <div className="mb-4 flex justify-end">
          <button
            onClick={handleAddUserClick}
            data-owner-setup="add-user"
            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center gap-2"
          >
            <UserIcon size={16} />
            {t('users.addUser')}
          </button>
        </div>

        {/* Users table */}
        <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          {!loading && visibleUsers.length > 0 && (
            <div
              ref={filterToolbarRef}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 border-b border-slate-100 dark:border-slate-800 text-[11px] leading-tight text-slate-500 dark:text-slate-400"
              aria-label={t('users.summary.ariaLabel')}
            >
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={clearUserFilters}
                  className={filterChipClass(!hasActiveFilters)}
                  aria-pressed={!hasActiveFilters}
                  title={t('users.summary.showAll')}
                >
                  {t('users.summary.total', { count: userSummary.total })}
                </button>

                <div className={filterGroupClass(statusFilter !== 'all')}>
                  <button
                    type="button"
                    onClick={() => toggleStatusFilter('active')}
                    className={filterChipClass(statusFilter === 'active')}
                    aria-pressed={statusFilter === 'active'}
                  >
                    {t('users.summary.active', { count: userSummary.active })}
                  </button>
                  <span className="text-slate-300 dark:text-slate-600 select-none" aria-hidden>
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleStatusFilter('inactive')}
                    className={
                      statusFilter === 'inactive'
                        ? 'rounded-md px-1.5 py-0.5 transition-colors bg-orange-600 text-white shadow-sm dark:bg-orange-500 font-semibold'
                        : userSummary.inactive > 0
                          ? 'rounded-md px-1.5 py-0.5 transition-colors text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/40'
                          : filterChipClass(false)
                    }
                    aria-pressed={statusFilter === 'inactive'}
                    >
                    {t('users.summary.inactive', { count: userSummary.inactive })}
                  </button>
                </div>

                <span
                  className="mx-0.5 h-3 w-px bg-slate-300 dark:bg-slate-600 shrink-0"
                  aria-hidden
                />

                <div className={filterGroupClass(roleFilter !== 'all')}>
                  <button
                    type="button"
                    onClick={() => toggleRoleFilter('admin')}
                    className={filterChipClass(roleFilter === 'admin')}
                    aria-pressed={roleFilter === 'admin'}
                  >
                    {t('users.summary.admin', { count: userSummary.admin })}
                  </button>
                  <span className="text-slate-300 dark:text-slate-600 select-none" aria-hidden>
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleRoleFilter('member')}
                    className={filterChipClass(roleFilter === 'member')}
                    aria-pressed={roleFilter === 'member'}
                  >
                    {t('users.summary.member', { count: userSummary.member })}
                  </button>
                  <span className="text-slate-300 dark:text-slate-600 select-none" aria-hidden>
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleRoleFilter('viewer')}
                    className={filterChipClass(roleFilter === 'viewer')}
                    aria-pressed={roleFilter === 'viewer'}
                  >
                    {t('users.summary.viewer', { count: userSummary.viewer })}
                  </button>
                </div>

                <span
                  className="mx-0.5 h-3 w-px bg-slate-300 dark:bg-slate-600 shrink-0"
                  aria-hidden
                />

                <div className={filterGroupClass(authFilter !== 'all')}>
                  <button
                    type="button"
                    onClick={() => toggleAuthFilter('local')}
                    className={filterChipClass(authFilter === 'local')}
                    aria-pressed={authFilter === 'local'}
                  >
                    {t('users.summary.local', { count: userSummary.local })}
                  </button>
                  <span className="text-slate-300 dark:text-slate-600 select-none" aria-hidden>
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleAuthFilter('google')}
                    className={filterChipClass(authFilter === 'google')}
                    aria-pressed={authFilter === 'google'}
                  >
                    {t('users.summary.google', { count: userSummary.google })}
                  </button>
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearUserFilters}
                    className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    title={t('users.clearFilters')}
                    aria-label={t('users.clearFilters')}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-rose-500 text-rose-600 dark:border-rose-400 dark:text-rose-400">
                      <X size={10} strokeWidth={2.5} aria-hidden />
                    </span>
                    <span>{t('users.clearFilters')}</span>
                  </button>
                )}
              </div>

              <div className="relative ml-auto w-full sm:w-52 max-w-full">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (userSearch.trim() !== '') {
                      setUserSearch('');
                    } else {
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder={t('users.searchPlaceholder')}
                  aria-label={t('users.searchPlaceholder')}
                  className={`w-full rounded-md border bg-white dark:bg-slate-900 pl-7 pr-7 py-1 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ${
                    userSearch.trim() !== ''
                      ? 'border-sky-400 dark:border-sky-600'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                />
                {userSearch.trim() !== '' && (
                  <button
                    type="button"
                    onClick={() => setUserSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label={t('users.clearSearch')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="overflow-x-auto overflow-y-visible">
            <table className="min-w-full table-fixed">
              {(() => {
                const thClass =
                  'px-3 py-2.5 text-left whitespace-nowrap align-middle';
                const headerLabelClass =
                  'text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
                const headerControlClass =
                  'inline-flex items-center gap-1 -mx-1 px-1 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
                const tdClass = 'px-3 py-2.5 align-middle';
                const tdNowrap = `${tdClass} whitespace-nowrap`;
                const pillClass =
                  'inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md border';
                const staticHeader = (label: string) => (
                  <th className={thClass}>
                    <span className={headerControlClass}>{label}</span>
                  </th>
                );
                const sortHeader = (key: SortKey, label: string) => {
                  const active = sortKey === key;
                  const SortIcon = !active ? ChevronsUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th key={key} className={thClass}>
                      <button
                        type="button"
                        onClick={() => handleSort(key)}
                        className={`${headerControlClass} hover:bg-slate-100 dark:hover:bg-slate-800/80`}
                        aria-sort={
                          active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        title={
                          active
                            ? sortDir === 'asc'
                              ? t('users.sortDescending')
                              : t('users.sortAscending')
                            : t('users.sortBy', { column: label })
                        }
                      >
                        <span className={headerLabelClass}>{label}</span>
                        <SortIcon
                          size={12}
                          className={`shrink-0 ${
                            active
                              ? 'text-slate-600 dark:text-slate-300 opacity-100'
                              : 'text-slate-400 dark:text-slate-500 opacity-70'
                          }`}
                          aria-hidden
                        />
                      </button>
                    </th>
                  );
                };
                return (
                  <>
              <colgroup>
                <col className="w-[7.5rem]" />
                <col className="w-[7.25rem]" />
                <col />
                <col className="w-[7.25rem]" />
                <col className="w-[7.25rem]" />
                <col className="w-[4rem]" />
                <col className="w-[11rem]" />
                <col className="w-[10rem]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/60">
                  {staticHeader(t('users.tableHeaders.actions'))}
                  {sortHeader('role', t('users.tableHeaders.role'))}
                  {sortHeader('name', t('users.tableHeaders.name'))}
                  {sortHeader('status', t('users.tableHeaders.status'))}
                  {sortHeader('auth', t('users.tableHeaders.authType'))}
                  {staticHeader(t('users.tableHeaders.color'))}
                  {sortHeader('lastLogin', t('users.tableHeaders.lastLogin'))}
                  {sortHeader('joined', t('users.tableHeaders.joined'))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayedUsers.length > 0 ? (
                  displayedUsers.map((user) => {
                    const displayName = user.displayName || `${user.firstName} ${user.lastName}`.trim();
                    const fullName = `${user.firstName} ${user.lastName}`.trim();
                    const primaryRole = user.roles.includes('admin')
                      ? 'admin'
                      : user.roles.includes('viewer')
                        ? 'viewer'
                        : 'user';
                    const roleSelectLocked =
                      user.id === currentUser?.id || !canModifyUser(user.email);
                    const isSystemAccount = isLocalPseudoAccount(user.email);
                    const isCurrentUserRow = user.id === currentUser?.id;
                    const statusSelectLocked =
                      isSystemAccount || !canChangeUserActivation(user.id, user.email);
                    const isActiveUserRow =
                      colorPickerUserId === user.id ||
                      (showEditUserForm && editingUserData.id === user.id);
                    return (
                <tr
                  key={user.id}
                  data-user-id={user.id}
                  className={`${ADMIN_TABLE_ROW_CLASS}${
                    isActiveUserRow ? ` ${ADMIN_TABLE_ROW_ACTIVE_CLASS}` : ''
                  }`}
                >
                  <td className={tdNowrap}>
                    <div className="flex items-center gap-0.5 h-8">
                      <button 
                        onClick={() => handleEditUserClick(user)}
                        onMouseEnter={(e) => handleButtonMouseEnter(user.id, 'edit', e)}
                        onMouseLeave={handleButtonMouseLeave}
                        disabled={!canEditUserProfile(user.email)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          !canEditUserProfile(user.email)
                            ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Edit size={15} />
                      </button>
                      <div className="relative">
                        <button
                          ref={(el) => {
                            deleteButtonRefs.current[user.id] = el;
                          }}
                          onClick={(e) => {
                            if (user.id === currentUser?.id || !canModifyUser(user.email)) return;
                            
                            const rect = e.currentTarget.getBoundingClientRect();
                            const viewportHeight = window.innerHeight;
                            const viewportWidth = window.innerWidth;
                            
                            // Estimate dialog height (larger for system user / task reassign)
                            const isSystemUser = user.email === 'system@local';
                            const hasTasks = (userTaskCounts[user.id] || 0) > 0;
                            const estimatedDialogHeight = isSystemUser ? 180 : hasTasks ? 220 : 100;
                            const dialogWidth = isSystemUser || hasTasks ? 320 : 220;
                            
                            // Check if there's enough space below
                            const spaceBelow = viewportHeight - rect.bottom;
                            const spaceAbove = rect.top;
                            
                            // Position above if not enough space below, but enough space above
                            let top: number;
                            if (spaceBelow < estimatedDialogHeight && spaceAbove > estimatedDialogHeight) {
                              // Position above the button
                              top = rect.top - estimatedDialogHeight - 5;
                            } else {
                              // Position below the button (default)
                              top = rect.bottom + 5;
                            }
                            
                            // Ensure dialog doesn't go off the right edge
                            let left = rect.right - dialogWidth;
                            if (left + dialogWidth > viewportWidth) {
                              left = viewportWidth - dialogWidth - 10; // 10px margin from edge
                            }
                            
                            // Ensure dialog doesn't go off the left edge
                            if (left < 10) {
                              left = 10; // 10px margin from edge
                            }
                            
                            // Calculate max height based on position
                            const maxHeight = top < rect.top 
                              ? Math.min(top - 10, 300) // If above, use space from top
                              : Math.min(viewportHeight - top - 20, 300); // If below, use space to bottom
                            
                            setDeleteButtonPosition({
                              top,
                              left,
                              userId: user.id,
                              maxHeight
                            });
                            onDeleteUser(user.id);
                          }}
                          onMouseEnter={(e) => handleButtonMouseEnter(user.id, 'delete', e)}
                          onMouseLeave={handleButtonMouseLeave}
                          disabled={user.id === currentUser?.id || (!canModifyUser(user.email))}
                          className={`p-1.5 rounded-lg transition-colors ${
                            user.id === currentUser?.id || (!canModifyUser(user.email))
                              ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                              : 'text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                          }`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      {canResendInvitation(user) ? (
                        <button
                          type="button"
                          onClick={() => void handleResendInvitation(user.id)}
                          onMouseEnter={(e) => handleButtonMouseEnter(user.id, 'resend', e)}
                          onMouseLeave={handleButtonMouseLeave}
                          disabled={isResendingInvitation}
                          aria-busy={isResendingInvitation && resendingUserId === user.id}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isResendingInvitation && resendingUserId !== user.id
                              ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                              : 'text-sky-600 hover:text-sky-800 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40 disabled:opacity-70 disabled:cursor-wait'
                          }`}
                          aria-label={
                            isResendingInvitation && resendingUserId === user.id
                              ? t('users.sendingInvitation')
                              : t('users.resendInvitation')
                          }
                        >
                          {isResendingInvitation && resendingUserId === user.id ? (
                            <Loader2 size={15} className="animate-spin" aria-hidden />
                          ) : (
                            <Mail size={15} />
                          )}
                        </button>
                      ) : (
                        <span className="inline-flex w-[27px]" aria-hidden />
                      )}
                    </div>
                  </td>
                  <td className={tdNowrap}>
                    {isSystemAccount ? (
                      <span className={`${pillClass} w-full justify-start bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700`}>
                        —
                      </span>
                    ) : (
                      <RoleBadgeSelect
                        value={primaryRole}
                        disabled={roleSelectLocked}
                        title={t('users.changeRole')}
                        labels={roleLabels}
                        onChange={(role) => {
                          void onRoleChange(user.id, role);
                        }}
                      />
                    )}
                  </td>
                  <td className={`${tdClass} min-w-0`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0 h-8 w-8">
                        {user.email === 'agent@local' && !(user.googleAvatarUrl || user.avatarUrl) ? (
                          <img
                            src={AGENT_BOT_AVATAR_SRC}
                            alt={fullName}
                            className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600"
                          />
                        ) : (user.googleAvatarUrl || user.avatarUrl) ? (
                          <img
                            src={getAuthenticatedAvatarUrl(user.googleAvatarUrl || user.avatarUrl)}
                            alt={fullName}
                            className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600"
                          />
                        ) : (
                          <div 
                            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white ring-1 ring-black/5"
                            style={{ backgroundColor: user.memberColor || '#4ECDC4' }}
                          >
                            {user.firstName?.[0]}{user.lastName?.[0]}
                          </div>
                        )}
                        {!isSystemAccount && (
                          <UserListAvatarRoleBadge role={primaryRole} labels={roleLabels} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {displayName}
                          </div>
                          {isCurrentUserRow && (
                            <span className="shrink-0 inline-flex items-center px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide leading-none rounded border bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-700">
                              {t('users.youBadge')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {user.email}
                        </div>
                        {displayName !== fullName && fullName && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            {fullName}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className={tdNowrap}>
                    {isSystemAccount ? (
                      <span className={`${pillClass} w-full justify-start bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800`}>
                        {t('users.system')}
                      </span>
                    ) : (
                      <StatusBadgeSelect
                        value={user.isActive}
                        disabled={statusSelectLocked}
                        title={t('users.changeStatus')}
                        labels={statusLabels}
                        onChange={(isActive) => {
                          void onStatusChange(user.id, isActive);
                        }}
                      />
                    )}
                  </td>
                  <td className={tdNowrap}>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                      {user.authProvider === 'google' ? (
                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" aria-hidden>
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                      ) : null}
                      {user.authProvider === 'google' ? t('users.google') : t('users.local')}
                    </span>
                  </td>
                  <td className={tdNowrap}>
                    <button
                      type="button"
                      ref={(el) => {
                        colorButtonRefs.current[user.id] = el;
                      }}
                      className="h-5 w-5 rounded-full border border-slate-200 dark:border-slate-600 shadow-sm hover:ring-2 hover:ring-slate-300 dark:hover:ring-slate-500"
                      style={{ backgroundColor: user.memberColor || DEFAULT_MEMBER_COLOR }}
                      onClick={() => {
                        if (colorPickerUserId === user.id) {
                          handleCancelColorPicker();
                          return;
                        }
                        openColorPicker(user.id, user.memberColor || DEFAULT_MEMBER_COLOR);
                      }}
                      title={t('users.clickToChangeColor')}
                      aria-label={t('users.clickToChangeColor')}
                      aria-expanded={colorPickerUserId === user.id}
                      aria-haspopup="dialog"
                    />
                  </td>
                  <td className={`${tdNowrap} text-xs tabular-nums text-slate-600 dark:text-slate-300`}>
                    {user.lastLoginAt
                      ? formatToYYYYMMDDHHmmss(user.lastLoginAt)
                      : '—'}
                  </td>
                  <td className={`${tdNowrap} text-xs tabular-nums text-slate-600 dark:text-slate-300`}>
                    {formatToYYYYMMDDHHmmss(user.joined || user.createdAt)}
                  </td>
                </tr>
                    );
                  })
                ) : (
                <tr>
                  <td colSpan={8} className={`${tdClass} py-8 text-center text-sm text-slate-500 dark:text-slate-400`}>
                    {loading
                      ? t('users.loadingUsers')
                      : hasActiveFilters
                        ? t('users.noMatchingUsers')
                        : t('users.noUsersFound')}
                  </td>
                </tr>
              )}
              </tbody>
                  </>
                );
              })()}
            </table>
          </div>
        </div>
      </div>


      {/* Add User Modal */}
      {showAddUserForm && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
          style={{ zIndex: MODAL_OVERLAY_Z_INDEX }}
          role="presentation"
          onClick={() => {
            if (!isAddingUser) handleCancelAddUser();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-add-user-title"
            className="w-full max-w-lg max-h-[min(90vh,720px)] overflow-y-auto rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h3 id="admin-add-user-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('users.addNewUser')}
              </h3>
              <button
                type="button"
                onClick={handleCancelAddUser}
                disabled={isAddingUser}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                aria-label={t('users.cancel')}
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-5">
              <div>
                <label className={adminLabelClass}>{t('users.email')}</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => handleNewUserChange('email', e.target.value)}
                  className={adminModalInputEditableClass}
                  placeholder="user@example.com"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={adminLabelClass}>{t('users.firstName')}</label>
                  <input
                    type="text"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser(prev => ({ ...prev, firstName: e.target.value }))}
                    className={adminModalInputEditableClass}
                    placeholder={t('users.firstName')}
                  />
                </div>
                <div>
                  <label className={adminLabelClass}>{t('users.lastName')}</label>
                  <input
                    type="text"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser(prev => ({ ...prev, lastName: e.target.value }))}
                    className={adminModalInputEditableClass}
                    placeholder={t('users.lastName')}
                  />
                </div>
              </div>
              <div>
                <label className={adminLabelClass}>{t('users.displayName')}</label>
                <input
                  type="text"
                  value={newUser.displayName || `${newUser.firstName} ${newUser.lastName}`.trim()}
                  onChange={(e) => setNewUser(prev => ({ ...prev, displayName: e.target.value }))}
                  maxLength={30}
                  className={adminModalInputEditableClass}
                  placeholder={t('users.displayName')}
                />
              </div>
              <div>
                <label className={adminLabelClass}>{t('users.role')}</label>
                <RoleBadgeSelect
                  size="md"
                  value={(newUser.role as RoleValue) || 'user'}
                  labels={roleLabels}
                  descriptions={roleDescriptions}
                  title={t('users.changeRole')}
                  onChange={(role) => setNewUser((prev) => ({ ...prev, role }))}
                />
              </div>
              <div className="flex items-start gap-2 pt-0.5">
                <ModernCheckbox
                  id="isActive"
                  checked={isDemoMode || newUser.isActive}
                  disabled={isDemoMode}
                  onChange={(e) => {
                    if (isDemoMode) return;
                    setNewUser(prev => ({ ...prev, isActive: e.target.checked }));
                  }}
                  title={isDemoMode ? t('users.activeCreateLocallyDemo') : undefined}
                />
                <label
                  htmlFor="isActive"
                  className={`text-sm leading-snug ${
                    isDemoMode
                      ? 'text-slate-500 dark:text-slate-400 cursor-not-allowed'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                  title={isDemoMode ? t('users.activeCreateLocallyDemo') : undefined}
                >
                  {t('users.activeCreateLocally')}
                </label>
              </div>
              {isDemoMode && (
                <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-md px-2.5 py-2">
                  {t('users.activeCreateLocallyDemo')}
                </p>
              )}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-5 py-4 backdrop-blur">
              <button
                type="button"
                onClick={handleCancelAddUser}
                disabled={isAddingUser}
                className="px-4 py-2.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {t('users.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAddUser}
                disabled={isAddingUser}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingUser && (
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                )}
                {isAddingUser
                  ? newUser.isActive || isDemoMode
                    ? t('users.creatingUser')
                    : t('users.sendingInvitation')
                  : newUser.isActive || isDemoMode
                    ? t('users.save')
                    : t('users.inviteUser')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit User Modal */}
      {showEditUserForm && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
          style={{ zIndex: MODAL_OVERLAY_Z_INDEX }}
          role="presentation"
          onClick={() => {
            if (!isSubmitting) handleCancelEditUser();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-edit-user-title"
            className="w-full max-w-lg max-h-[min(90vh,720px)] overflow-y-auto rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-5 py-4 backdrop-blur">
              <div className="flex items-center gap-2 min-w-0">
                <h3 id="admin-edit-user-title" className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {t('users.editUser')}
                </h3>
                {isLocalPseudoAccount(editingUserData.email) && (
                  <span className="shrink-0 inline-flex items-center px-1 py-px text-[9px] font-semibold uppercase tracking-wide leading-none rounded border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
                    {t('users.systemAccount')}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleCancelEditUser}
                disabled={isSubmitting}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                aria-label={t('users.cancel')}
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-5">
              {isLocalPseudoAccount(editingUserData.email) && (
                <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-2">
                  {t('users.pseudoProfileHint')}
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={adminLabelClass}>{t('users.firstName')}</label>
                  <input
                    type="text"
                    value={editingUserData.firstName}
                    onChange={(e) => setEditingUserData(prev => ({ ...prev, firstName: e.target.value }))}
                    className={adminModalInputEditableClass}
                    placeholder={t('users.firstName')}
                  />
                </div>
                <div>
                  <label className={adminLabelClass}>{t('users.lastName')}</label>
                  <input
                    type="text"
                    value={editingUserData.lastName}
                    onChange={(e) => setEditingUserData(prev => ({ ...prev, lastName: e.target.value }))}
                    className={adminModalInputEditableClass}
                    placeholder={t('users.lastName')}
                  />
                </div>
              </div>
              <div>
                <label className={adminLabelClass}>{t('users.displayName')}</label>
                <input
                  type="text"
                  value={editingUserData.displayName}
                  onChange={(e) => setEditingUserData(prev => ({ ...prev, displayName: e.target.value }))}
                  maxLength={30}
                  className={adminModalInputEditableClass}
                  placeholder={t('users.displayName')}
                />
              </div>
              <div>
                <label
                  className={
                    isOwner(editingUserData.email) || isLocalPseudoAccount(editingUserData.email)
                      ? adminLabelLockedClass
                      : adminLabelClass
                  }
                >
                  {t('users.email')}
                  {isOwner(editingUserData.email) && (
                    <span className="ml-2 text-[11px] text-amber-600/90 dark:text-amber-500/90 font-normal">{t('users.ownerCannotBeChanged')}</span>
                  )}
                  {isLocalPseudoAccount(editingUserData.email) && (
                    <span className="ml-2 text-[11px] text-amber-600/90 dark:text-amber-500/90 font-normal">{t('users.pseudoEmailLocked')}</span>
                  )}
                </label>
                <input
                  type="email"
                  value={editingUserData.email}
                  onChange={(e) => setEditingUserData(prev => ({ ...prev, email: e.target.value }))}
                  disabled={isOwner(editingUserData.email) || isLocalPseudoAccount(editingUserData.email)}
                  readOnly={isOwner(editingUserData.email) || isLocalPseudoAccount(editingUserData.email)}
                  className={
                    isOwner(editingUserData.email) || isLocalPseudoAccount(editingUserData.email)
                      ? adminModalInputLockedClass
                      : adminModalInputEditableClass
                  }
                  placeholder="user@example.com"
                />
              </div>
              {!isLocalPseudoAccount(editingUserData.email) && (
                <div>
                  <label
                    className={
                      editingUserData.id === currentUser?.id || !canModifyUser(editingUserData.email)
                        ? adminLabelLockedClass
                        : adminLabelClass
                    }
                  >
                    {t('users.role')}
                  </label>
                  <RoleBadgeSelect
                    size="md"
                    value={editingUserData.role}
                    labels={roleLabels}
                    descriptions={roleDescriptions}
                    title={t('users.changeRole')}
                    disabled={
                      editingUserData.id === currentUser?.id ||
                      !canModifyUser(editingUserData.email)
                    }
                    onChange={(role) =>
                      setEditingUserData((prev) => ({
                        ...prev,
                        role,
                      }))
                    }
                  />
                </div>
              )}
              {!isLocalPseudoAccount(editingUserData.email) && (
                <AdminToggle
                  id="editIsActive"
                  checked={editingUserData.isActive}
                  disabled={!canChangeUserActivation(editingUserData.id, editingUserData.email)}
                  label={editingUserData.isActive ? t('users.active') : t('users.inactive')}
                  onChange={(next) =>
                    setEditingUserData((prev) => ({ ...prev, isActive: next }))
                  }
                />
              )}
              <div>
                <label className={adminLabelClass}>{t('users.avatar')}</label>
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {avatarPreviewUrl ? (
                      <img src={avatarPreviewUrl} alt="" className="w-12 h-12 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
                    ) : editingUserData.email === 'agent@local' && !(editingUserData.googleAvatarUrl || editingUserData.avatarUrl) ? (
                      <img src={AGENT_BOT_AVATAR_SRC} alt="" className="w-12 h-12 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
                    ) : (editingUserData.googleAvatarUrl || editingUserData.avatarUrl) ? (
                      <img
                        src={getAuthenticatedAvatarUrl(editingUserData.googleAvatarUrl || editingUserData.avatarUrl)}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600"
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-lg ring-1 ring-black/5"
                        style={{ backgroundColor: editingUserData.memberColor || '#4ECDC4' }}
                      >
                        {editingUserData.firstName?.charAt(0)}{editingUserData.lastName?.charAt(0)}
                      </div>
                    )}
                  </div>
                  {editingUserData.authProvider === 'local' ? (
                    <div className="flex-1 space-y-1.5 min-w-0">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleUserAvatarSelect}
                        className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-950/40 dark:file:text-blue-300"
                      />
                      {editingUserData.avatarUrl && (
                        <button
                          type="button"
                          onClick={() => onRemoveAvatar(editingUserData.id)}
                          className="text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2 py-1 rounded transition-colors"
                        >
                          {t('users.removeAvatar')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 text-xs text-sky-800 dark:text-sky-200 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-md px-2.5 py-2">
                      <p className="font-medium">{t('users.googleAccount')}</p>
                      <p className="mt-0.5 opacity-90">{t('users.avatarManagedByGoogle')}</p>
                    </div>
                  )}
                </div>
              </div>
              {persistedEditingUser && canResendInvitation(persistedEditingUser) && (
                <div className="flex items-center justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md dark:bg-amber-950/30 dark:border-amber-800">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('users.accountPendingActivation')}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">{t('users.accountNotActivatedYet')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleResendInvitation()}
                    disabled={isResendingInvitation || isSubmitting}
                    aria-busy={isResendingInvitation}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isResendingInvitation && <Loader2 size={12} className="animate-spin" aria-hidden />}
                    {isResendingInvitation ? t('users.sendingInvitation') : t('users.resendInvitation')}
                  </button>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-5 py-4 backdrop-blur">
              <button
                type="button"
                onClick={handleCancelEditUser}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {t('users.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveUser}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? t('users.saving') : t('users.saveChanges')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Portal-based Delete Confirmation Dialog */}
      {showDeleteConfirm && deleteButtonPosition && deleteButtonPosition.userId === showDeleteConfirm && createPortal(
        <div 
          role="dialog"
          aria-modal="true"
          className="delete-confirmation fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 z-[9999]"
          style={{
            top: `${deleteButtonPosition.top}px`,
            left: `${deleteButtonPosition.left}px`,
            width: users.find(u => u.id === showDeleteConfirm)?.email === 'system@local' || (userTaskCounts[showDeleteConfirm] || 0) > 0
              ? '320px'
              : '220px',
            maxHeight: deleteButtonPosition.maxHeight ? `${deleteButtonPosition.maxHeight}px` : '360px',
            overflowY: 'auto'
          }}
        >
          <div className="text-sm text-gray-700 dark:text-gray-200 mb-2 break-words">
            {(() => {
              const user = users.find(u => u.id === showDeleteConfirm);
              if (!user) return null;
              
              if (user.email === 'system@local') {
                return (
                  <>
                    <div className="font-medium mb-1 text-amber-600">{t('users.deleteSystemUser')}</div>
                    <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 mb-2">
                      <div className="font-medium mb-1">{t('users.criticalWarning')}</div>
                      <div className="break-words overflow-wrap-anywhere whitespace-normal">
                        {t('users.deleteSystemUserWarning')}
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {t('users.areYouSureProceed')}
                    </div>
                  </>
                );
              } else if (userTaskCounts[user.id] > 0) {
                const reassignOptions = users.filter(
                  (u) =>
                    u.id !== user.id &&
                    u.email !== 'agent@local' &&
                    u.email !== 'system@local' &&
                    u.isActive
                );
                return (
                  <>
                    <div className="font-medium mb-1">{t('users.deleteUser')}</div>
                    <div className="text-xs text-gray-700 dark:text-gray-300 mb-2">
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        {t('users.tasksWillBeRemoved', { count: userTaskCounts[user.id] })}
                      </span>{' '}
                      {t('users.willBeReassignedFor')}{' '}
                      <span className="font-medium">{user.email}</span>
                    </div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t('users.reassignTasksTo')}
                    </label>
                    <select
                      value={deleteReassignToUserId}
                      onChange={(e) => setDeleteReassignToUserId(e.target.value)}
                      onKeyDown={(e) => {
                        // Don't let Enter/Escape on the select bubble as dialog cancel
                        e.stopPropagation();
                      }}
                      className="w-full mb-2 px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    >
                      <option value="">{t('users.reassignToSystem')}</option>
                      {reassignOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {(u.displayName || `${u.firstName} ${u.lastName}`).trim()} ({u.email})
                        </option>
                      ))}
                    </select>
                  </>
                );
              } else {
                return (
                  <>
                    <div className="font-medium mb-1">{t('users.deleteUser')}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {t('users.noTasksAffected')}{' '}
                      <span className="font-medium">{user.email}</span>
                    </div>
                  </>
                );
              }
            })()}
          </div>
          <div className="flex space-x-2">
            <button
              ref={noButtonRef}
              onClick={() => {
                onCancelDeleteUser();
                setDeleteButtonPosition(null);
              }}
              className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors"
            >
              {t('users.no')}
            </button>
            <button
              onClick={() => {
                const reassign =
                  (userTaskCounts[showDeleteConfirm] || 0) > 0 && deleteReassignToUserId
                    ? deleteReassignToUserId
                    : null;
                onConfirmDeleteUser(showDeleteConfirm, reassign);
                setDeleteButtonPosition(null);
              }}
              className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              {t('users.yes')}
            </button>
          </div>
        </div>,
        document.body
      )}

      <MemberColorPickerDialog
        open={colorPickerUserId != null}
        initialColor={editingColor}
        userLabel={colorPickerUserLabel}
        isSaving={isSavingColor}
        anchorEl={colorPickerUserId ? colorButtonRefs.current[colorPickerUserId] : null}
        onCancel={handleCancelColorPicker}
        onSave={handleSaveColor}
      />

      {/* Portal-based Tooltips */}
      {hoveredButton && createPortal(
        <div
          className={`fixed z-[9999] ${CHROME_TOOLTIP_SURFACE_CLASS} transition-opacity duration-200`}
          style={{
            top: `${hoveredButton.position.top}px`,
            left: `${hoveredButton.position.left}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          {(() => {
            const user = users.find(u => u.id === hoveredButton.userId);
            if (!user) return '';
            
            switch (hoveredButton.type) {
              case 'promote':
                return isOwner(user.email) ? t('users.cannotModifyInstanceOwner') : t('users.promoteToAdmin');
              case 'demote':
                return user.id === currentUser?.id 
                  ? t('users.cannotDemoteYourself') 
                  : isOwner(user.email) 
                    ? t('users.cannotDemoteInstanceOwner') 
                    : t('users.demoteToUser');
              case 'edit':
                return !canEditUserProfile(user.email)
                  ? t('users.onlyOwnerCanEditProfile')
                  : isLocalPseudoAccount(user.email)
                    ? t('users.editPseudoProfile')
                    : t('users.editUser');
              case 'resend':
                return isResendingInvitation && resendingUserId === hoveredButton.userId
                  ? t('users.sendingInvitation')
                  : t('users.resendInvitation');
              case 'delete':
                return user.id === currentUser?.id 
                  ? t('cannotDeleteOwnAccount') 
                  : isOwner(user.email)
                    ? t('users.cannotDeleteInstanceOwner')
                    : t('users.deleteUser');
              default:
                return '';
            }
          })()}
        </div>,
        document.body
      )}
    </>
  );
};

export default AdminUsersTab;
