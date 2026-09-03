import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Bug, Github, HelpCircle, Lightbulb, LogOut, Settings, User, UserPlus, Mail, X, Send, Monitor, MonitorOff, MoreHorizontal, Menu, Check, Eye, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CurrentUser, SiteSettings, TeamMember, Task } from '../../types';
import type { HeaderSearchTask } from './HeaderTaskSearch';
import ThemeToggle from '../ThemeToggle';
import { useTheme } from '../../contexts/ThemeContext';
import { getSystemInfo, searchTrashedTasks } from '../../api';
import { isArchivedColumnFlag } from '../../utils/columnUtils';
import SprintSelector from '../SprintSelector';
import HeaderTaskSearch from './HeaderTaskSearch';
import { updateAppSettingsPreference, updateUserPreference, loadUserPreferences, loadUserPreferencesAsync } from '../../utils/userPreferences';
import { setExplicitGuestLanguage } from '../../utils/guestLanguage';
import { feDebug } from '../../utils/clientDebug';
import ResetCountdown from '../ResetCountdown';
import { KanbanChromeTooltip } from '../KanbanChromeTooltip';
import { TOOLS_HEADER_SLOT_ID } from '../Tools';
import { toast } from '../../utils/toast';
import { getAuthenticatedAvatarUrl } from '../../utils/authImageUrl';
import {
  AGILA_GITHUB_URL,
  agilaGithubFeedbackUrls,
  DEFAULT_SITE_LOGO,
  DEFAULT_SITE_LOGO_DARK,
  isPublicBrandAssetPath,
} from '../../constants';
import { userIsAdmin, userIsViewer } from '../../utils/permissions';
import { requestAdminNavigation } from '../../utils/adminNavigation';
import {
  isSystemPanelAvailable as readSystemPanelAvailable,
  TROUBLESHOOTING_VISIBILITY_EVENT,
} from '../../utils/troubleshootingAccess';
import { useColumnDisplayTitle } from '../../utils/columnDisplayTitle';
import { formFieldClass } from '../../utils/formFieldClasses';

interface SystemInfo {
  memory: {
    used: number;
    total: number;
    free: number;
    percent: number;
    usedFormatted: string;
    totalFormatted: string;
    freeFormatted: string;
  };
  cpu: {
    percent: number;
    loadAverage: number;
    cores: number;
  };
  disk: {
    used: number;
    total: number;
    percent: number;
    usedFormatted: string;
    totalFormatted: string;
  };
  timestamp: string;
}

/**
 * Rich text → plain text for header search matching. Regex rather than a DOM
 * parse: this runs over every task on every board.
 */
function htmlToSearchText(html?: string | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when SITE_URL means "this app" rather than an external site.
 * Hash-router SPA: bare origin (https://host) and / are equivalent to #kanban
 * (board restored via onPageChange) — must not full-reload and drop #kanban#boardId.
 */
function isInAppSiteHomeUrl(raw: string): boolean {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '#' || trimmed === '/') return true;
  try {
    const target = new URL(trimmed, window.location.origin);
    return target.origin === window.location.origin;
  } catch {
    return false;
  }
}

interface HeaderProps {
  currentUser: CurrentUser | null;
  siteSettings: SiteSettings;
  currentPage: 'kanban' | 'admin' | 'reports';
  // isPolling: boolean; // Removed - using real-time WebSocket updates
  // lastPollTime: Date | null; // Removed - using real-time WebSocket updates
  members: TeamMember[];
  onProfileClick: () => void;
  onLogout: () => void;
  onPageChange: (page: 'kanban' | 'admin' | 'reports', options?: { hash?: string }) => void;
  /** Kept for callers; manual refresh control removed from the header UI. */
  onRefresh?: () => Promise<void>;
  onHelpClick: () => void;
  onInviteUser?: (email: string) => Promise<void>;
  // Auto-refresh toggle - DISABLED (using real-time updates)
  // isAutoRefreshEnabled: boolean;
  // onToggleAutoRefresh: () => void;
  selectedSprintId?: string | null;
  onSprintChange?: (sprint: { id: string; name: string; start_date: string; end_date: string } | null) => void;
  hideSprintSelector?: boolean; // Hide sprint selector (e.g., on TaskPage)
  /** Bound to searchFilters.text — Kanban quick search */
  taskSearchText?: string;
  onTaskSearchTextChange?: (text: string) => void;
  onJumpToTask?: (task: Task) => void | Promise<void>;
  boards?: Array<{
    id: string;
    title?: string;
    columns?: {
      [columnId: string]: {
        id: string;
        title?: string;
        boardId?: string;
        is_archived?: boolean | number;
        tasks?: Array<Task & { sprintId?: string | null }>;
      };
    };
  }>;
  sprints?: Array<{ id: string; name: string; start_date: string; end_date: string }>; // Optional: sprints passed from parent (avoids duplicate API calls)
  /** False until GET sprints has finished so the selector does not flash "All Sprints". */
  sprintsReady?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  currentUser,
  siteSettings,
  currentPage,
  // isPolling, // Removed - using real-time WebSocket updates
  // lastPollTime, // Removed - using real-time WebSocket updates
  members,
  onProfileClick,
  onLogout,
  onPageChange,
  onHelpClick,
  onInviteUser,
  // isAutoRefreshEnabled, // Disabled - using real-time updates
  // onToggleAutoRefresh, // Disabled - using real-time updates
  selectedSprintId,
  onSprintChange,
  hideSprintSelector = false,
  taskSearchText = '',
  onTaskSearchTextChange,
  onJumpToTask,
  boards = [],
  sprints: propSprints,
  sprintsReady = true,
}) => {
  const isDemoMode = process.env.DEMO_ENABLED === 'true';
  const { theme } = useTheme();
  const columnDisplayTitle = useColumnDisplayTitle();
  const [systemPanelUnlocked, setSystemPanelUnlocked] = useState(() =>
    readSystemPanelAvailable(siteSettings)
  );
  useEffect(() => {
    const sync = () => setSystemPanelUnlocked(readSystemPanelAvailable(siteSettings));
    sync();
    window.addEventListener(TROUBLESHOOTING_VISIBILITY_EVENT, sync);
    return () => window.removeEventListener(TROUBLESHOOTING_VISIBILITY_EVENT, sync);
  }, [siteSettings]);
  const isSystemPanelAvailable = systemPanelUnlocked;
  // Extract all tasks from all boards for sprint counting and header jump search
  const allTasks = useMemo(() => {
    const tasks: Array<{ id: string; sprintId?: string | null }> = [];
    boards.forEach(board => {
      if (board.columns) {
        Object.values(board.columns).forEach(column => {
          if (column.tasks) {
            tasks.push(...column.tasks.map(task => ({
              id: task.id,
              sprintId: task.sprintId
            })));
          }
        });
      }
    });
    return tasks;
  }, [boards]);

  const jumpToSearchTask = (partial: HeaderSearchTask) => {
    if (!onJumpToTask) return;
    for (const board of boards) {
      if (!board.columns) continue;
      for (const column of Object.values(board.columns)) {
        const full = column.tasks?.find((row) => row.id === partial.id);
        if (full) {
          void onJumpToTask({
            ...full,
            boardId: full.boardId || board.id,
            status: columnDisplayTitle({
              ...column,
              title: column.title || '',
              boardId: column.boardId || board.id,
            }),
          });
          return;
        }
      }
    }
    void onJumpToTask(partial as Task);
  };

  const searchableTasks = useMemo((): HeaderSearchTask[] => {
    const memberName = (id?: string | null) =>
      id ? members.find((m) => m.id === id)?.name : undefined;
    const found: HeaderSearchTask[] = [];
    boards.forEach((board) => {
      if (!board.columns) return;
      Object.values(board.columns).forEach((column) => {
        const archived = isArchivedColumnFlag(column);
        (column.tasks || []).forEach((task) => {
          if (task.deletedAt) return;
          found.push({
            archived,
            id: task.id,
            title: task.title,
            ticket: task.ticket,
            status: columnDisplayTitle({
              ...column,
              title: column.title || '',
              boardId: column.boardId || board.id,
            }),
            priority: task.priority,
            priorityName: task.priorityName,
            priorityColor: task.priorityColor,
            boardId: task.boardId || board.id,
            startDate: task.startDate,
            dueDate: task.dueDate,
            columnId: task.columnId || column.id,
            descriptionText: htmlToSearchText(task.description),
            commentsText: (task.comments || [])
              .map((comment) => htmlToSearchText(comment.text))
              .join(' '),
            assigneeName: memberName(task.memberId),
            requesterName: memberName(task.requesterId),
          });
        });
      });
    });
    return found;
  }, [boards, members, columnDisplayTitle]);

  /**
   * Trashed tasks are not part of the board payload, so the dropdown asks the
   * server for them. Board title is used as the row's status line since the
   * task's column no longer means anything once it is in the Trash.
   */
  const searchTrashedForHeader = useCallback(
    async (query: string, signal: AbortSignal): Promise<HeaderSearchTask[]> => {
      const memberName = (id?: string | null) =>
        id ? members.find((m) => m.id === id)?.name : undefined;
      const rows = await searchTrashedTasks(query, { signal });
      return rows.map((task) => ({
        id: task.id,
        title: task.title,
        ticket: task.ticket,
        status: boards.find((board) => board.id === task.boardId)?.title,
        priority: task.priority,
        priorityName: task.priorityName,
        priorityColor: task.priorityColor,
        boardId: task.boardId,
        startDate: task.startDate,
        dueDate: task.dueDate,
        columnId: task.columnId,
        deletedAt: task.deletedAt,
        descriptionText: htmlToSearchText(task.description),
        assigneeName: memberName(task.memberId),
        requesterName: memberName(task.requesterId),
      }));
    },
    [boards, members]
  );
  const [showInviteDropdown, setShowInviteDropdown] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const inviteDropdownRef = useRef<HTMLDivElement>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAppNavMenu, setShowAppNavMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const appNavMenuRef = useRef<HTMLDivElement>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const { i18n, t } = useTranslation('common');

  const isViewOnlyAccount = userIsViewer(currentUser);
  const isAdminAccount = userIsAdmin(currentUser);
  
  // Get current language - use i18n.language for immediate updates, fallback to user preferences
  const currentLanguage = useMemo(() => {
    // Use i18n.language if available (most up-to-date)
    if (i18n.language && (i18n.language === 'en' || i18n.language === 'fr')) {
      return i18n.language;
    }
    // Fallback to user preferences
    if (currentUser) {
      const prefs = loadUserPreferences(currentUser.id);
      return prefs.language || 'en';
    }
    return 'en';
  }, [currentUser, i18n.language]);
  
  // Handle language toggle - save to user preferences when user explicitly chooses
  const handleLanguageToggle = async () => {
    const newLanguage = currentLanguage === 'en' ? 'fr' : 'en';
    // Switch UI immediately — do not wait on the preference API
    await i18n.changeLanguage(newLanguage);
    // Keep login/guest screens in sync after logout
    setExplicitGuestLanguage(newLanguage);
    if (currentUser) {
      // Persist in background (cookie updates sync; DB write can lag)
      void updateUserPreference('language', newLanguage, currentUser.id);
    }
  };

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [reportsEnabled, setReportsEnabled] = useState(true); // Default to enabled
  const [reportsVisibleTo, setReportsVisibleTo] = useState('all'); // Default to all users
  
  // System panel visibility - will be loaded asynchronously from database
  const [showSystemPanel, setShowSystemPanel] = useState<boolean>(true); // Default to true, will be updated from database

  // Handle system panel toggle - save to user preferences
  const handleSystemPanelToggle = async () => {
    const newValue = !showSystemPanel;
    setShowSystemPanel(newValue);
    if (currentUser) {
      // Use updateAppSettingsPreference to save only this specific setting (avoids saving all preferences)
      await updateAppSettingsPreference('showSystemPanel', newValue, currentUser.id);
    }
  };

  // Load system panel preference from database when user changes (async to get database value)
  useEffect(() => {
    const loadSystemPanelPreference = async () => {
      if (currentUser?.roles?.includes('admin')) {
        try {
          // Use async version to load from both cookies and database
          const prefs = await loadUserPreferencesAsync(currentUser.id);
          // Check if showSystemPanel is explicitly set (could be true, false, or undefined)
          if (prefs.appSettings?.showSystemPanel !== undefined) {
            // Use the saved value (could be true or false)
            setShowSystemPanel(prefs.appSettings.showSystemPanel);
          } else {
            // Default to true if not set (first time, show the panel)
            setShowSystemPanel(true);
          }
        } catch (error) {
          console.error('Failed to load system panel preference:', error);
          // Fallback: try synchronous load from cookies as backup
          const cookiePrefs = loadUserPreferences(currentUser.id);
          if (cookiePrefs.appSettings?.showSystemPanel !== undefined) {
            setShowSystemPanel(cookiePrefs.appSettings.showSystemPanel);
          } else {
            // Final fallback to default (true for admins)
            setShowSystemPanel(true);
          }
        }
      } else {
        setShowSystemPanel(false);
      }
    };

    loadSystemPanelPreference();
  }, [currentUser]);

  // Fetch reports settings to check if reports module is enabled
  // Use cached API function to prevent duplicate calls with Reports component
  useEffect(() => {
    const fetchReportsSettings = async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        // Use cached API function instead of direct fetch
        const { getReportsSettings } = await import('../../api');
        const data = await getReportsSettings();

        setReportsEnabled(data.REPORTS_ENABLED === 'true');
        setReportsVisibleTo(data.REPORTS_VISIBLE_TO || 'all');
      } catch (error) {
        console.error('Failed to fetch reports settings:', error);
        // Default to enabled on error
        setReportsEnabled(true);
        setReportsVisibleTo('all');
      }
    };

    if (currentUser) {
      fetchReportsSettings();
    }
  }, [currentUser]);

  // Listen for real-time settings updates via WebSocket
  useEffect(() => {
    if (!currentUser) return;

    const handleSettingsUpdate = (data: any) => {
      if (feDebug('FE_DEBUG_REPORTS_UI')) console.log('📊 [Header] Settings updated via WebSocket:', data);

      // If REPORTS_ENABLED was updated, refresh the reports button visibility
      if (data.key === 'REPORTS_ENABLED') {
        const isEnabled = data.value === 'true' || data.value === true;
        if (feDebug('FE_DEBUG_REPORTS_UI')) console.log(`📊 [Header] Reports module is now: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
        setReportsEnabled(isEnabled);

        // If reports were disabled and user is on reports page, redirect to kanban
        if (!isEnabled && currentPage === 'reports') {
          if (feDebug('FE_DEBUG_REPORTS_UI')) console.log('📊 [Header] Redirecting to Kanban as reports were disabled');
          window.location.hash = 'kanban';
        }
      }

      // If REPORTS_VISIBLE_TO was updated, refresh the visibility setting
      if (data.key === 'REPORTS_VISIBLE_TO') {
        if (feDebug('FE_DEBUG_REPORTS_UI')) console.log(`📊 [Header] Reports visibility changed to: ${data.value}`);
        setReportsVisibleTo(data.value);

        // If visibility changed to admin-only and user is not admin and on reports page, redirect
        const isAdmin = currentUser?.roles?.includes('admin');
        if (data.value === 'admin' && !isAdmin && currentPage === 'reports') {
          if (feDebug('FE_DEBUG_REPORTS_UI')) console.log('📊 [Header] Redirecting to Kanban as reports are now admin-only');
          window.location.hash = 'kanban';
        }
      }
    };

    // Import websocket client and listen for settings updates
    import('../../services/websocketClient').then(({ default: websocketClient }) => {
      websocketClient.onSettingsUpdated(handleSettingsUpdate);
      
      return () => {
        websocketClient.offSettingsUpdated(handleSettingsUpdate);
      };
    });
  }, [currentUser, currentPage]);

  // Close invite / more / profile menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (inviteDropdownRef.current && !inviteDropdownRef.current.contains(target)) {
        if (isInviting) return;
        setShowInviteDropdown(false);
        setInviteEmail('');
        setInviteError('');
        setInviteSuccess('');
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false);
      }
      if (appNavMenuRef.current && !appNavMenuRef.current.contains(target)) {
        setShowAppNavMenu(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isInviting]);

  // Fetch system info with polling when system panel is visible
  // Header is always loaded, so it handles all system info polling (Admin.tsx no longer polls)
  useEffect(() => {
    if (!isSystemPanelAvailable || !currentUser?.roles?.includes('admin') || !showSystemPanel) {
      setSystemInfo(null); // Clear info when panel is hidden
      return;
    }

    const fetchSystemInfo = async () => {
      try {
        const info = await getSystemInfo();
        // Guard against partial/error payloads — reading .percent on undefined crashes the app
        if (
          info &&
          typeof info.memory?.percent === 'number' &&
          typeof info.cpu?.percent === 'number' &&
          typeof info.disk?.percent === 'number'
        ) {
          setSystemInfo(info);
        } else {
          console.warn('Ignoring invalid system info payload:', info);
          setSystemInfo(null);
        }
      } catch (error) {
        console.error('Failed to fetch system info:', error);
        setSystemInfo(null);
      }
    };

    // Fetch immediately
    fetchSystemInfo();

    // Poll every 20 seconds (consistent interval since Header is the only one polling now)
    const interval = setInterval(fetchSystemInfo, 20000);

    return () => clearInterval(interval);
  }, [currentUser?.roles, showSystemPanel, isSystemPanelAvailable]);

  // Tour can force the metrics panel open without flipping a closed preference the wrong way.
  // Remember the pre-tour visibility so finish/skip can restore it.
  const showSystemPanelRef = useRef(showSystemPanel);
  showSystemPanelRef.current = showSystemPanel;
  const systemPanelBeforeTourRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isSystemPanelAvailable) return;
    const openForTour = () => {
      if (systemPanelBeforeTourRef.current === null) {
        systemPanelBeforeTourRef.current = showSystemPanelRef.current;
      }
      setShowSystemPanel(true);
    };
    const restoreAfterTour = () => {
      if (systemPanelBeforeTourRef.current !== null) {
        setShowSystemPanel(systemPanelBeforeTourRef.current);
        systemPanelBeforeTourRef.current = null;
      }
    };
    window.addEventListener('tour:ensure-system-panel', openForTour);
    window.addEventListener('tour:restore-system-panel', restoreAfterTour);
    return () => {
      window.removeEventListener('tour:ensure-system-panel', openForTour);
      window.removeEventListener('tour:restore-system-panel', restoreAfterTour);
    };
  }, [isSystemPanelAvailable]);

  const handleInviteClick = () => {
    setShowInviteDropdown(!showInviteDropdown);
    setInviteEmail('');
    setInviteError('');
    setInviteSuccess('');
  };

  const handleInviteCancel = () => {
    setShowInviteDropdown(false);
    setInviteEmail('');
    setInviteError('');
    setInviteSuccess('');
  };

  const handleInviteSend = async () => {
    if (isDemoMode) {
      setInviteError(t('navigation.inviteDisabledDemo'));
      return;
    }

    if (!inviteEmail.trim()) {
      setInviteError(t('navigation.pleaseEnterEmail'));
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail.trim())) {
      setInviteError(t('navigation.pleaseEnterValidEmail'));
      return;
    }

    if (!onInviteUser) {
      setInviteError(t('navigation.inviteNotAvailable'));
      return;
    }

    setIsInviting(true);
    setInviteError('');
    setInviteSuccess('');

    try {
      await onInviteUser(inviteEmail.trim());
      const sentTo = inviteEmail.trim();
      setInviteSuccess(t('navigation.invitationSent'));
      toast.success(t('navigation.invitationSentTo', { email: sentTo }), '');
      setInviteEmail('');
      setTimeout(() => {
        setShowInviteDropdown(false);
        setInviteSuccess('');
      }, 2000);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : t('navigation.failedToSendInvitation'));
    } finally {
      setIsInviting(false);
    }
  };

  const handleInviteKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleInviteSend();
    } else if (e.key === 'Escape') {
      handleInviteCancel();
    }
  };

  const siteUrlRaw = (siteSettings.SITE_URL || '').trim();
  const siteHomeIsInApp = isInAppSiteHomeUrl(siteUrlRaw);
  // Prefer hash href for in-app home so status bar / fallback nav matches Kanban (not bare origin).
  const siteHomeHref = siteHomeIsInApp ? '#kanban' : (siteUrlRaw || '#');

  /** Site title always navigates in this tab (ignore browser “open links in new tab” and SITE_OPENS_NEW_TAB). */
  const handleSiteTitleNavigation = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Same-origin SITE_URL (incl. https://host with no hash) → SPA kanban; board restored by App
    if (siteHomeIsInApp) {
      onPageChange('kanban');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.location.assign(siteUrlRaw);
  };

  return (
    <header className="sticky top-0 z-[60] bg-white dark:bg-gray-800 shadow-sm border-b border-gray-100 dark:border-gray-700" data-tour-id="navigation">
      {/* Gutter outside shell — same nesting as MainLayout so brand aligns with page content */}
      <div className="app-page-inline-gutter">
      <div className="app-page-shell relative py-2.5 flex justify-between items-center gap-2 min-w-0 max-w-full">
        {/*
          Board view / density controls land here once Tools scrolls away. Absolute
          + right-full parks them in the empty header margin left of the logo, so
          the brand never shifts; ToolsHeaderControls skips them when that margin
          is too narrow.
        */}
        <div
          id={TOOLS_HEADER_SLOT_ID}
          className="hidden md:flex absolute inset-y-0 right-full mr-2 items-center"
        />
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
          <a
            href={siteHomeHref}
            onClick={handleSiteTitleNavigation}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                handleSiteTitleNavigation(e);
              }
            }}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer min-w-0 shrink"
          >
            {(() => {
              const hideLogo = siteSettings.HIDE_SITE_LOGO === 'true';
              const isDark = theme === 'dark';
              const configuredLight = siteSettings.SITE_LOGO?.trim() || '';
              const configuredDark = siteSettings.SITE_LOGO_DARK?.trim() || '';
              const rawLogo = hideLogo
                ? ''
                : isDark
                  ? (configuredDark || configuredLight || DEFAULT_SITE_LOGO_DARK)
                  : (configuredLight || DEFAULT_SITE_LOGO);

              const resolveBrandLogo = (value: string) => {
                // Public static / external URLs — do not rewrite through avatar file auth
                if (
                  value.startsWith('http://') ||
                  value.startsWith('https://') ||
                  isPublicBrandAssetPath(value)
                ) {
                  return value;
                }
                // Never fall back to bare `/avatars/...` — SPA catch-all returns 404 for that path
                return getAuthenticatedAvatarUrl(value);
              };

              const logoSrc = rawLogo ? resolveBrandLogo(rawLogo) : undefined;
              // Blank / missing SITE_NAME → logo only (wordmark includes the product name)
              const siteName = siteSettings.SITE_NAME ?? '';
              const showName = siteName.trim().length > 0;

              if (!logoSrc && !showName) {
                return null;
              }

              return (
                <>
                  {logoSrc && (
                    <img
                      key={logoSrc}
                      src={logoSrc}
                      alt={showName ? siteName : 'Agila'}
                      className="h-7 max-w-[100px] sm:max-w-[140px] object-contain shrink-0"
                    />
                  )}
                  {showName && (
                    <span className="hidden md:inline truncate max-w-[10rem] lg:max-w-[14rem]">{siteName}</span>
                  )}
                </>
              );
            })()}
          </a>
          {/* Sprint Selector - only show in Kanban view, hide on TaskPage / very narrow */}
          {currentUser && currentPage === 'kanban' && !hideSprintSelector && (
            <div className="hidden sm:block min-w-0 shrink">
              <SprintSelector
                selectedSprintId={selectedSprintId || null}
                onSprintChange={onSprintChange || (() => {})}
                tasks={allTasks}
                sprints={propSprints}
                sprintsReady={sprintsReady}
                canCreateSprint={userIsAdmin(currentUser)}
                onGoToSprints={() => {
                  onPageChange('admin', { hash: 'admin#project-settings#sprint-settings' });
                  requestAdminNavigation('admin#project-settings#sprint-settings');
                }}
              />
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1 justify-end">
          {/* Demo reset timer — right cluster so it never crowds the sprint selector */}
          {process.env.DEMO_ENABLED === 'true' && (
            <ResetCountdown inline={true} onReset={onLogout} />
          )}
          {currentUser && (
            <>
              {/* Quick task search — fills leftover header space on phones */}
              {currentPage === 'kanban' && !hideSprintSelector && onTaskSearchTextChange && (
                <>
                  <div className="min-w-0 flex-1 max-w-[12rem] sm:max-w-[14rem] md:flex-none md:max-w-none">
                    <HeaderTaskSearch
                      value={taskSearchText}
                      onChange={onTaskSearchTextChange}
                      tasks={searchableTasks}
                      onJumpToTask={jumpToSearchTask}
                      onSearchTrashed={searchTrashedForHeader}
                    />
                  </div>
                  <div
                    className="hidden md:block h-6 w-px bg-gray-300 dark:bg-gray-600 flex-shrink-0"
                    aria-hidden
                  />
                </>
              )}

              {/* Desktop app navigation (lg+) */}
              <div className="hidden lg:flex items-center gap-1">
                <button
                  onClick={() => onPageChange('kanban')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    currentPage === 'kanban'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  {t('navigation.boards')}
                </button>
                {reportsEnabled && (reportsVisibleTo === 'all' || currentUser.roles?.includes('admin')) && (
                  <button
                    onClick={() => onPageChange('reports')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      currentPage === 'reports'
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    data-tour-id="reports-button"
                  >
                    {t('navigation.reports')}
                  </button>
                )}
              </div>

              {/* Compact app nav: Boards / Reports / Invite */}
              <div className="relative lg:hidden" ref={appNavMenuRef}>
                <KanbanChromeTooltip label={t('navigation.menu')}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAppNavMenu((open) => !open);
                      setShowMoreMenu(false);
                    }}
                    className={`flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded-md transition-colors border ${
                      showAppNavMenu
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                        : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-400'
                    }`}
                    aria-label={t('navigation.menu')}
                    aria-expanded={showAppNavMenu}
                    aria-haspopup="menu"
                    data-tour-id="app-nav-menu"
                  >
                    <Menu size={16} />
                    <span className="hidden sm:inline max-w-[4.5rem] truncate">
                      {currentPage === 'admin'
                        ? t('navigation.settings')
                        : currentPage === 'reports'
                          ? t('navigation.reports')
                          : t('navigation.boards')}
                    </span>
                  </button>
                </KanbanChromeTooltip>
                {showAppNavMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-2 min-w-[11rem] bg-white dark:bg-gray-800 rounded-lg shadow-lg z-[70] border border-gray-200 dark:border-gray-700 py-1"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowAppNavMenu(false);
                        onPageChange('kanban');
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                    >
                      <span>{t('navigation.boards')}</span>
                      {currentPage === 'kanban' && <Check size={14} className="text-blue-600" />}
                    </button>
                    {reportsEnabled && (reportsVisibleTo === 'all' || currentUser.roles?.includes('admin')) && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowAppNavMenu(false);
                          onPageChange('reports');
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                        data-tour-id="reports-button"
                      >
                        <span>{t('navigation.reports')}</span>
                        {currentPage === 'reports' && <Check size={14} className="text-blue-600" />}
                      </button>
                    )}
                    {isAdminAccount && onInviteUser && (
                      <>
                        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowAppNavMenu(false);
                            handleInviteClick();
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                          data-tour-id="invite-user-button"
                        >
                          <UserPlus size={16} />
                          {t('navigation.invite')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Invite — desktop button; dropdown host for both breakpoints */}
              {isAdminAccount && onInviteUser && (
                <div className="relative" ref={inviteDropdownRef}>
                  <KanbanChromeTooltip label={t('navigation.inviteUser')} wrapperClassName="relative hidden lg:inline-flex">
                    <button
                      onClick={handleInviteClick}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded-md transition-colors border border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500"
                      data-tour-id="invite-user-button"
                    >
                      <UserPlus className="h-4 w-4" />
                      {t('navigation.invite')}
                    </button>
                  </KanbanChromeTooltip>

                  {showInviteDropdown && (
                    <div className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-[70]">
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Mail className="h-4 w-4 text-blue-600" />
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('navigation.inviteNewUser')}</h3>
                        </div>
                        
                        <div className="space-y-3">
                          {isDemoMode && (
                            <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700 px-2 py-2 rounded">
                              {t('navigation.inviteDisabledDemo')}
                            </div>
                          )}
                          <div>
                            <input
                              type="email"
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              onKeyDown={handleInviteKeyPress}
                              placeholder={t('navigation.enterEmailAddress')}
                              className={formFieldClass(isInviting || isDemoMode, { widthClass: 'w-full' })}
                              disabled={isInviting || isDemoMode}
                              autoFocus={!isDemoMode}
                            />
                          </div>
                          
                          {inviteError && (
                            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900 px-2 py-1 rounded">
                              {inviteError}
                            </div>
                          )}
                          
                          {inviteSuccess && (
                            <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900 px-2 py-1 rounded">
                              {inviteSuccess}
                            </div>
                          )}
                          
                          <div className="flex items-center gap-2 pt-2">
                            <button
                              onClick={handleInviteSend}
                              disabled={isInviting || isDemoMode || !inviteEmail.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {isInviting ? (
                                <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              {isInviting ? t('navigation.sending') : t('navigation.send')}
                            </button>
                            <button
                              onClick={handleInviteCancel}
                              disabled={isInviting}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                            >
                              <X className="h-3 w-3" />
                              {t('buttons.cancel')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="hidden lg:block w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" aria-hidden="true" />
            </>
          )}

          {/* 3. Preferences */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {currentUser && (
              <KanbanChromeTooltip
                label={currentLanguage === 'en' ? 'Switch to French' : 'Passer en anglais'}
              >
                <button
                  type="button"
                  onClick={handleLanguageToggle}
                  className="px-2 py-1 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors border border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500"
                  aria-label={currentLanguage === 'en' ? 'Switch to French' : 'Passer en anglais'}
                >
                  {currentLanguage === 'en' ? 'FR' : 'EN'}
                </button>
              </KanbanChromeTooltip>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" aria-hidden="true" />

          {/* 4–5. Utilities + GitHub — one flex group so spacing stays even */}
          <div className="flex items-center gap-0.5">
            {/* Desktop (lg+): system panel */}
            <div className="hidden lg:contents">
              {isSystemPanelAvailable && currentUser?.roles?.includes('admin') && (
                <KanbanChromeTooltip
                  label={showSystemPanel ? t('navigation.hideSystemPanel') : t('navigation.showSystemPanel')}
                >
                  <button
                    type="button"
                    onClick={handleSystemPanelToggle}
                    className="p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    aria-label={showSystemPanel ? t('navigation.hideSystemPanel') : t('navigation.showSystemPanel')}
                    data-tour-id="system-panel-toggle"
                  >
                    {showSystemPanel ? (
                      <Monitor size={16} />
                    ) : (
                      <MonitorOff size={16} />
                    )}
                  </button>
                </KanbanChromeTooltip>
              )}
            </div>

            <KanbanChromeTooltip label={t('navigation.help')} wrapperClassName="relative hidden md:inline-flex">
              <button
                type="button"
                onClick={onHelpClick}
                className="p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label={t('navigation.help')}
                data-tour-id="help-button"
              >
                <HelpCircle size={20} />
              </button>
            </KanbanChromeTooltip>

            {siteSettings.HIDE_GITHUB_LINK !== 'true' && (
              <KanbanChromeTooltip label={t('navigation.github')} wrapperClassName="relative hidden lg:inline-flex">
                <a
                  href={AGILA_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                  aria-label={t('navigation.github')}
                >
                  <Github size={20} />
                </a>
              </KanbanChromeTooltip>
            )}

            {/* Tablet overflow menu (hidden on phones; desktop uses inline controls) */}
            <div className="relative hidden md:block lg:hidden" ref={moreMenuRef}>
              <KanbanChromeTooltip label={t('navigation.more')}>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu((open) => !open)}
                  className="p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  aria-label={t('navigation.more')}
                  aria-expanded={showMoreMenu}
                  aria-haspopup="menu"
                >
                  <MoreHorizontal size={20} />
                </button>
              </KanbanChromeTooltip>
              {showMoreMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 min-w-[12rem] bg-white dark:bg-gray-800 rounded-lg shadow-lg z-[70] border border-gray-200 dark:border-gray-700 py-1"
                >
                  {isSystemPanelAvailable && currentUser?.roles?.includes('admin') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowMoreMenu(false);
                        void handleSystemPanelToggle();
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                      data-tour-id="system-panel-toggle"
                    >
                      {showSystemPanel ? <Monitor size={16} /> : <MonitorOff size={16} />}
                      {showSystemPanel ? t('navigation.hideSystemPanel') : t('navigation.showSystemPanel')}
                    </button>
                  )}
                  {siteSettings.HIDE_GITHUB_LINK !== 'true' && (
                    <a
                      role="menuitem"
                      href={AGILA_GITHUB_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setShowMoreMenu(false)}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <Github size={16} />
                      {t('navigation.github')}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 6. Account — click to open (iPad / keyboard friendly) */}
          {currentUser && (
            <div className="relative ml-1" ref={profileMenuRef}>
              <KanbanChromeTooltip
                label={isViewOnlyAccount ? t('messages.readOnlyBadge') : ''}
                delayMs={0}
              >
                <button
                  type="button"
                  className="relative flex items-center gap-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                  onClick={() => setShowProfileMenu((open) => !open)}
                  aria-label={
                    isViewOnlyAccount
                      ? `${t('navigation.profileMenu')} — ${t('messages.readOnlyBadge')}`
                      : t('navigation.profileMenu')
                  }
                  aria-expanded={showProfileMenu}
                  aria-haspopup="menu"
                  data-tour-id="profile-menu"
                >
                  <span className="relative inline-flex h-8 w-8 shrink-0">
                    {currentUser?.googleAvatarUrl || currentUser?.avatarUrl ? (
                      <img
                        src={getAuthenticatedAvatarUrl(currentUser.googleAvatarUrl || currentUser.avatarUrl)}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent && !parent.querySelector('[data-avatar-fallback]')) {
                            const fallback = document.createElement('div');
                            fallback.setAttribute('data-avatar-fallback', 'true');
                            fallback.className = 'h-8 w-8 rounded-full flex items-center justify-center';
                            fallback.style.backgroundColor = members.find(m => m.user_id === currentUser?.id)?.color || '#4ECDC4';
                            const initials = document.createElement('span');
                            initials.className = 'text-sm font-medium text-white';
                            initials.textContent = `${currentUser.firstName?.[0] || ''}${currentUser.lastName?.[0] || ''}`;
                            fallback.appendChild(initials);
                            parent.appendChild(fallback);
                          }
                        }}
                      />
                    ) : (
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center"
                        style={{
                          backgroundColor: members.find(m => m.user_id === currentUser?.id)?.color || '#4ECDC4'
                        }}
                      >
                        <span className="text-sm font-medium text-white">
                          {currentUser.firstName?.[0]}{currentUser.lastName?.[0]}
                        </span>
                      </div>
                    )}
                    {isViewOnlyAccount && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-2 ring-white dark:bg-sky-950 dark:text-sky-300 dark:ring-gray-800"
                        aria-hidden
                      >
                        <Eye size={10} strokeWidth={2.5} />
                      </span>
                    )}
                  </span>
                </button>
              </KanbanChromeTooltip>

              {showProfileMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 min-w-[14rem] bg-white dark:bg-gray-800 rounded-lg shadow-lg z-[70] border border-gray-200 dark:border-gray-700"
                >
                  <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {[currentUser.firstName, currentUser.lastName].filter(Boolean).join(' ') || currentUser.email}
                    </div>
                    {(currentUser.firstName || currentUser.lastName) && currentUser.email && (
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {currentUser.email}
                      </div>
                    )}
                    {isViewOnlyAccount && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                        <Eye size={12} aria-hidden />
                        {t('messages.readOnlyBadge')}
                      </span>
                    )}
                    {isAdminAccount && !isViewOnlyAccount && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                        <Shield size={12} aria-hidden />
                        {t('messages.adminBadge')}
                      </span>
                    )}
                  </div>
                  <div className="py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowProfileMenu(false);
                        onProfileClick();
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                      <User size={18} />
                      {t('navigation.profile')}
                    </button>
                    {isAdminAccount && !isViewOnlyAccount && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onPageChange('admin');
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors whitespace-nowrap"
                        data-tour-id="admin-tab"
                      >
                        <Settings size={18} />
                        {t('navigation.settings')}
                      </button>
                    )}
                    {isAdminAccount && !isViewOnlyAccount && !isDemoMode && (
                      <>
                        <a
                          role="menuitem"
                          href={agilaGithubFeedbackUrls(i18n.language).ideas}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowProfileMenu(false)}
                          className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <Lightbulb size={18} />
                          {t('navigation.suggestFeature')}
                        </a>
                        <a
                          role="menuitem"
                          href={agilaGithubFeedbackUrls(i18n.language).issues}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowProfileMenu(false)}
                          className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <Bug size={18} />
                          {t('navigation.reportBug')}
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowProfileMenu(false);
                        onLogout();
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                      <LogOut size={18} />
                      {t('navigation.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
      
      {/* System Usage Panel - Vertical Compact for Admins (Toggleable) */}
      {isSystemPanelAvailable && systemInfo?.memory && systemInfo?.cpu && systemInfo?.disk && currentUser?.roles?.includes('admin') && showSystemPanel && (
        <div className="absolute top-full right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-b-lg p-1.5 shadow-lg z-10" data-tour-id="system-usage-panel">
          <div className="flex flex-col space-y-0.5 text-[10px]">
            {/* RAM */}
            <div className="flex items-center space-x-1.5">
              <div className="text-gray-500 dark:text-gray-400 w-6">RAM</div>
              <div className="flex items-center space-x-0.5">
                <div className="w-6 bg-gray-200 dark:bg-gray-700 rounded-full h-0.5">
                  <div 
                    className={`h-0.5 rounded-full ${
                      systemInfo.memory.percent > 80 ? 'bg-red-500' : 
                      systemInfo.memory.percent > 60 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(systemInfo.memory.percent, 100)}%` }}
                  ></div>
                </div>
                <span className="font-medium text-gray-900 dark:text-gray-100 w-6 text-right">
                  {systemInfo.memory.percent}%
                </span>
              </div>
            </div>

            {/* CPU */}
            <div className="flex items-center space-x-1.5">
              <div className="text-gray-500 dark:text-gray-400 w-6">CPU</div>
              <div className="flex items-center space-x-0.5">
                <div className="w-6 bg-gray-200 dark:bg-gray-700 rounded-full h-0.5">
                  <div 
                    className={`h-0.5 rounded-full ${
                      systemInfo.cpu.percent > 80 ? 'bg-red-500' : 
                      systemInfo.cpu.percent > 60 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(systemInfo.cpu.percent, 100)}%` }}
                  ></div>
                </div>
                <span className="font-medium text-gray-900 dark:text-gray-100 w-6 text-right">
                  {systemInfo.cpu.percent}%
                </span>
              </div>
            </div>

            {/* Disk */}
            <div className="flex items-center space-x-1.5">
              <div className="text-gray-500 dark:text-gray-400 w-6">Disk</div>
              <div className="flex items-center space-x-0.5">
                <div className="w-6 bg-gray-200 dark:bg-gray-700 rounded-full h-0.5">
                  <div 
                    className={`h-0.5 rounded-full ${
                      systemInfo.disk.percent > 80 ? 'bg-red-500' : 
                      systemInfo.disk.percent > 60 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(systemInfo.disk.percent, 100)}%` }}
                  ></div>
                </div>
                <span className="font-medium text-gray-900 dark:text-gray-100 w-6 text-right">
                  {systemInfo.disk.percent}%
                </span>
              </div>
            </div>

            {/* Last updated indicator */}
            <div className="text-gray-400 dark:text-gray-500 text-center pt-0.5 border-t border-gray-200 dark:border-gray-700">
              {systemInfo.timestamp ? new Date(systemInfo.timestamp).toLocaleTimeString() : ''}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
