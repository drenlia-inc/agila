import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Users, Columns, ClipboardList, MessageSquare, MessageCircle, ArrowRight, LayoutGrid, List, Calendar, Search, Eye, Settings, Play, BarChart3, Shield, Download, Bot, KeyRound, CheckSquare, AlertTriangle, Trash2, ListChecks, Keyboard, Minus, ChevronUp, Circle, HardDrive, Plus, Pencil, Copy, Paperclip, Tag, Link, Archive, GripVertical, type LucideIcon } from 'lucide-react';
import { useTour } from '../contexts/TourContext';
import { useOwnerSetupOptional } from '../contexts/OwnerSetupContext';
import { useSettings } from '../contexts/SettingsContext';
import { versionDetection } from '../utils/versionDetection';
import { updateUserPreference, type ViewMode } from '../utils/userPreferences';
import { requestAdminNavigation } from '../utils/adminNavigation';
import {
  applyOwnerSetupFieldHighlights,
  clearOwnerSetupFieldHighlights,
} from '../utils/ownerSetup';
import { queueHelpReveal } from '../utils/helpGoThere';
import { CurrentUser } from '../types';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import {
  loadHelpSession,
  saveHelpSession,
} from '../utils/helpSessionPersistence';
import HelpAssistantChat, {
  type HelpAssistantUiMessage,
} from './HelpAssistantChat';
import HelpAssistantShell, { HELP_ASSISTANT_OVERLAY_HEIGHT } from './HelpAssistantShell';
import HelpAssistantTitle from './HelpAssistantTitle';
import {
  TROUBLESHOOTING_UNLOCK_KEY,
  TROUBLESHOOTING_VISIBILITY_EVENT,
  isTroubleshootingVisible,
} from '../utils/troubleshootingAccess';

type HelpGoTarget = {
  kind: 'admin' | 'view' | 'page' | 'profile';
  hash?: string;
  mode?: ViewMode;
  page?: 'kanban' | 'reports';
  profileFocus?: 'displayName' | 'bio' | 'activityFeed';
  /** CSS selectors highlighted like Configuration guide Guide me */
  highlights?: string[];
  /** Open closed chrome (search, column filter, trash) before highlight */
  reveal?: string[];
};

type ChecklistNavOptions = {
  titleTarget?: HelpGoTarget;
  itemTargets?: Partial<Record<string, HelpGoTarget>>;
};

const HELP_HL = {
  siteSettings: ['[data-setting-key="SITE_SETTINGS_SECTION"]'],
  sso: [
    '[data-setting-key="GOOGLE_CLIENT_ID"]',
    '[data-setting-key="GOOGLE_CLIENT_SECRET"]',
    '[data-setting-key="GOOGLE_CALLBACK_URL"]',
  ],
  mail: ['[data-setting-key="MAIL_SECTION"]'],
  storage: ['[data-setting-key="STORAGE_SECTION"]'],
  fileUploads: ['[data-setting-key="UPLOADS_SECTION"]'],
  ai: [
    '[data-setting-key="AI_ENABLED"]',
    '[data-setting-key="AI_PROVIDER"]',
    '[data-setting-key="AI_API_KEY"]',
    '[data-setting-key="AI_MODEL"]',
    '[data-setting-key="AI_RUNNER_URL"]',
    '[data-setting-key="AI_MAX_CONCURRENT"]',
  ],
  notifications: ['[data-setting-key="NOTIFICATIONS_SECTION"]'],
  notificationQueue: [
    '[data-setting-key="TASK_EMAIL_NOTIFICATIONS_ENABLED"]',
    '[data-setting-key="NOTIFICATION_QUEUE_RETENTION_DAYS"]',
  ],
  tags: ['[data-owner-setup="add-tag"]'],
  priorities: ['[data-owner-setup="add-priority"]'],
  appSettings: [
    '[data-setting-key="APP_LANGUAGE"]',
    '[data-setting-key="TASK_DELETE_CONFIRM"]',
    '[data-setting-key="ALLOW_USER_SELF_DELETE"]',
    '[data-setting-key="DEFAULT_VIEW_MODE"]',
    '[data-setting-key="DEFAULT_TASK_VIEW_MODE"]',
    '[data-setting-key="SHOW_ACTIVITY_FEED"]',
  ],
  troubleshooting: ['[data-setting-key="TROUBLESHOOTING_SECTION"]'],
  project: ['[data-setting-key="DEFAULT_BOARD_COLUMNS"]', '[data-setting-key="DEFAULT_FINISHED_COLUMN_NAMES"]'],
  features: [
    '[data-tour-id="admin-features-panel"]',
    '[data-setting-key="SHOW_BOARD_TAB_TASK_COUNTS"]',
    '[data-setting-key="EFFORT_UNIT"]',
    '[data-setting-key="HIGHLIGHT_OVERDUE_TASKS"]',
  ],
  sprints: ['[data-owner-setup="create-sprint"]'],
  reporting: ['[data-setting-key="REPORTS_ENABLED"]'],
  lifecycle: [
    '[data-tour-id="admin-lifecycle-content"]',
    '[data-setting-key="LIFECYCLE_DELETED_RETENTION_DAYS"]',
  ],
  licensing: ['[data-owner-setup="licensing-panel"]'],
  export: ['[data-tour-id="export-menu"]'],
} as const;

function adminGo(hash: string, highlights: readonly string[]): HelpGoTarget {
  return { kind: 'admin', hash, highlights: [...highlights] };
}

function viewGo(mode: ViewMode, highlights?: readonly string[]): HelpGoTarget {
  return {
    kind: 'view',
    mode,
    ...(highlights?.length ? { highlights: [...highlights] } : {}),
  };
}

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: CurrentUser | null;
  /** Bumped on each open (F1 / help) so a minimized panel expands. */
  expandToken?: number;
  onPageChange?: (page: 'kanban' | 'admin' | 'reports' | 'test', options?: { hash?: string }) => void;
  onViewModeChange?: (mode: ViewMode) => void;
  onOpenProfile?: (focus?: 'displayName' | 'bio' | 'activityFeed') => void;
}

type TabType = 'overview' | 'delivery' | 'shortcuts' | 'kanban' | 'list' | 'gantt' | 'reports' | 'ai' | 'admin';

const HELP_TAB_IDS = new Set<TabType>([
  'overview', 'delivery', 'shortcuts', 'kanban', 'list', 'gantt', 'reports', 'ai', 'admin',
]);

/** Translation keys for Help → Delivery (search + tab match highlighting). */
const HELP_DELIVERY_KEYS = [
  'help.delivery.intro', 'help.delivery.introDesc1', 'help.delivery.introDesc2', 'help.delivery.introDesc3',
  'help.delivery.roles', 'help.delivery.roleAdmin', 'help.delivery.roleUser', 'help.delivery.roleViewer',
  'help.delivery.firstHour', 'help.delivery.firstHourIntro',
  'help.delivery.firstHour2', 'help.delivery.firstHour3', 'help.delivery.firstHour4',
  'help.delivery.firstHour5', 'help.delivery.firstHour6', 'help.delivery.firstHour7', 'help.delivery.firstHour8', 'help.delivery.firstHour9',
  'help.delivery.shapeBoard', 'help.delivery.shapeColumns',
  'help.delivery.shapeColumns1', 'help.delivery.shapeColumns2', 'help.delivery.shapeColumns3', 'help.delivery.shapeColumns4',
  'help.delivery.oneBoard', 'help.delivery.oneBoardWhen', 'help.delivery.manyBoardsWhen', 'help.delivery.oneBoardAdvice',
  'help.delivery.softWip', 'help.delivery.softWipIntro',
  'help.delivery.columnWip', 'help.delivery.columnWip1', 'help.delivery.columnWip2', 'help.delivery.columnWip3',
  'help.delivery.boardWip', 'help.delivery.boardWip1', 'help.delivery.boardWip2', 'help.delivery.boardWip3', 'help.delivery.boardWip4',
  'help.delivery.softWipDefaults', 'help.delivery.softWipDefault1', 'help.delivery.softWipDefault2', 'help.delivery.softWipDefault3', 'help.delivery.softWipNote',
  'help.delivery.rituals', 'help.delivery.standup',
  'help.delivery.standup1', 'help.delivery.standup2', 'help.delivery.standup3', 'help.delivery.standup4', 'help.delivery.standup5',
  'help.delivery.planning', 'help.delivery.planning1', 'help.delivery.planning2', 'help.delivery.planning3', 'help.delivery.planning4',
  'help.delivery.sprints', 'help.delivery.sprints1', 'help.delivery.sprints2', 'help.delivery.sprints3', 'help.delivery.sprints4', 'help.delivery.sprintsNote',
  'help.delivery.features', 'help.delivery.featuresIntro',
  'help.delivery.features1', 'help.delivery.features2', 'help.delivery.features3', 'help.delivery.features4', 'help.delivery.featuresAdvice',
  'help.delivery.hygiene', 'help.delivery.hygieneDone', 'help.delivery.hygieneDelete', 'help.delivery.hygienePurge',
  'help.delivery.hygieneArchive', 'help.delivery.hygieneRetention',
  'help.delivery.antiPatterns',
  'help.delivery.antiPattern1', 'help.delivery.antiPattern2', 'help.delivery.antiPattern3', 'help.delivery.antiPattern4',
  'help.delivery.antiPattern6', 'help.delivery.antiPattern7',
  'help.delivery.conventions', 'help.delivery.conventionsIntro',
  'help.delivery.convention1', 'help.delivery.convention2', 'help.delivery.convention3', 'help.delivery.convention4', 'help.delivery.convention5',
  'help.delivery.convention6', 'help.delivery.convention7', 'help.delivery.convention8', 'help.delivery.convention9', 'help.delivery.convention10',
  'help.delivery.nextSteps', 'help.delivery.nextStepsDesc',
] as const;

const HELP_ADMIN_KEYS = [
  'help.admin.overview', 'help.admin.overviewDesc',
  'help.admin.users', 'help.admin.usersDesc',
  'help.admin.usersStep1', 'help.admin.usersStep2', 'help.admin.usersStep3', 'help.admin.usersStep4', 'help.admin.usersStep5', 'help.admin.usersNote',
  'help.admin.siteSettings', 'help.admin.siteSettingsDesc',
  'help.admin.siteStep1', 'help.admin.siteStep2', 'help.admin.siteStep3', 'help.admin.siteStep4',
  'help.admin.sso', 'help.admin.ssoDesc',
  'help.admin.ssoStep1', 'help.admin.ssoStep2', 'help.admin.ssoStep3', 'help.admin.ssoStep4', 'help.admin.ssoStep5',
  'help.admin.mailServer', 'help.admin.mailServerDesc',
  'help.admin.mailStep1', 'help.admin.mailStep2', 'help.admin.mailStep3', 'help.admin.mailStep4', 'help.admin.mailStep5',
  'help.admin.storage', 'help.admin.storageDesc',
  'help.admin.storageStep1', 'help.admin.storageStep2', 'help.admin.storageStep3', 'help.admin.storageStep4', 'help.admin.storageStep5',
  'help.admin.fileUploads', 'help.admin.fileUploadsDesc',
  'help.admin.fileUploadsStep1', 'help.admin.fileUploadsStep2', 'help.admin.fileUploadsStep3', 'help.admin.fileUploadsStep4',
  'help.admin.ai', 'help.admin.aiDesc',
  'help.admin.aiStep1', 'help.admin.aiStep2', 'help.admin.aiStep3', 'help.admin.aiStep4', 'help.admin.aiStep5',
  'help.admin.notifications', 'help.admin.notificationsDesc',
  'help.admin.notificationsStep1', 'help.admin.notificationsStep2', 'help.admin.notificationsStep3', 'help.admin.notificationsStep4',
  'help.admin.notificationQueue', 'help.admin.notificationQueueDesc',
  'help.admin.notificationQueueStep1', 'help.admin.notificationQueueStep2', 'help.admin.notificationQueueStep3', 'help.admin.notificationQueueStep4',
  'help.admin.tags', 'help.admin.tagsDesc',
  'help.admin.tagsStep1', 'help.admin.tagsStep2', 'help.admin.tagsStep3',
  'help.admin.priorities', 'help.admin.prioritiesDesc',
  'help.admin.prioritiesStep1', 'help.admin.prioritiesStep2', 'help.admin.prioritiesStep3', 'help.admin.prioritiesStep4',
  'help.admin.appSettings', 'help.admin.appSettingsDesc',
  'help.admin.appStep1', 'help.admin.appStep2', 'help.admin.appStep3', 'help.admin.appStep4',
  'help.admin.projectSettings', 'help.admin.projectSettingsDesc',
  'help.admin.projectStep1', 'help.admin.projectStep2', 'help.admin.projectStep3',
  'help.admin.features', 'help.admin.featuresDesc',
  'help.admin.featuresStep1', 'help.admin.featuresStep2', 'help.admin.featuresStep3', 'help.admin.featuresStep4',
  'help.admin.sprintSettings', 'help.admin.sprintSettingsDesc',
  'help.admin.sprintStep1', 'help.admin.sprintStep2', 'help.admin.sprintStep3', 'help.admin.sprintStep4',
  'help.admin.reporting', 'help.admin.reportingDesc',
  'help.admin.reportingStep1', 'help.admin.reportingStep2', 'help.admin.reportingStep3', 'help.admin.reportingNote',
  'help.admin.lifecycle', 'help.admin.lifecycleDesc',
  'help.admin.lifecycleStep1', 'help.admin.lifecycleStep2', 'help.admin.lifecycleStep3', 'help.admin.lifecycleStep4',
  'help.admin.licensing', 'help.admin.licensingDesc',
  'help.admin.licensingTip1', 'help.admin.licensingTip2', 'help.admin.licensingTip3',
] as const;

/** Included in Admin Help search only when Troubleshooting is visible in Admin. */
const HELP_ADMIN_TROUBLESHOOTING_KEYS = [
  'help.admin.troubleshooting', 'help.admin.troubleshootingDesc',
  'help.admin.troubleshootingStep1', 'help.admin.troubleshootingStep2',
  'help.admin.troubleshootingStep3', 'help.admin.troubleshootingStep4',
] as const;

const HELP_AI_KEYS = [
  'help.ai.overview', 'help.ai.overviewDesc1', 'help.ai.overviewDesc2',
  'help.ai.assigning', 'help.ai.assigningDesc',
  'help.ai.assignStep1', 'help.ai.assignStep2', 'help.ai.assignStep3', 'help.ai.assignStep4',
  'help.ai.controlling', 'help.ai.controllingDesc',
  'help.ai.controlStep1', 'help.ai.controlStep2', 'help.ai.controlStep3',
  'help.ai.devCredentials', 'help.ai.devCredentialsDesc',
  'help.ai.devCredentialsApiTokens', 'help.ai.devCredentialsSsh', 'help.ai.devCredentialsGithub', 'help.ai.devCredentialsProbe',
  'help.ai.adminSettings', 'help.ai.adminSettingsDesc',
  'help.ai.adminStep1', 'help.ai.adminStep2', 'help.ai.adminStep3', 'help.ai.adminStep4', 'help.ai.adminStep5',
  'help.ai.automation', 'help.ai.automationDesc',
  'help.ai.autoStep1', 'help.ai.autoStep2', 'help.ai.autoStep3', 'help.ai.autoStep4',
] as const;

/** [[tab:shortcuts]]Shortcuts tab[[/tab]] → in-modal link that switches Help tabs */
const HELP_TAB_LINK_RE = /\[\[tab:([a-z]+)\]\]([\s\S]*?)\[\[\/tab\]\]/g;

/** [[icon:pencil]] → inline Lucide glyph matching the UI control */
const HELP_ICON_RE = /\[\[icon:([a-zA-Z0-9]+)\]\]/g;

const HELP_INLINE_ICONS: Record<string, LucideIcon> = {
  layoutGrid: LayoutGrid,
  columns: Columns,
  list: List,
  calendar: Calendar,
  search: Search,
  plus: Plus,
  pencil: Pencil,
  copy: Copy,
  trash: Trash2,
  paperclip: Paperclip,
  message: MessageCircle,
  tag: Tag,
  link: Link,
  archive: Archive,
  grip: GripVertical,
};

type ShortcutRow = { keys: string; actionKey: string };

const HELP_SHORTCUT_SECTIONS: { titleKey: string; rows: ShortcutRow[] }[] = [
  {
    titleKey: 'help.shortcuts.global',
    rows: [
      { keys: 'F1 / ?', actionKey: 'help.shortcuts.globalHelp' },
      { keys: 'Escape', actionKey: 'help.shortcuts.globalEscape' },
      { keys: 'Enter', actionKey: 'help.shortcuts.globalEnter' },
    ],
  },
  {
    titleKey: 'help.shortcuts.board',
    rows: [
      { keys: '/ or Ctrl/Cmd+K', actionKey: 'help.shortcuts.boardSearch' },
      { keys: 'S', actionKey: 'help.shortcuts.boardSearchPanel' },
      { keys: 'N', actionKey: 'help.shortcuts.boardNewTask' },
      { keys: '1 / 2 / 3', actionKey: 'help.shortcuts.boardViews' },
      { keys: 'F / P / M', actionKey: 'help.shortcuts.boardDensity' },
      { keys: 'Escape', actionKey: 'help.shortcuts.boardFilterEscape' },
      { keys: 'Ctrl/Cmd+click', actionKey: 'help.shortcuts.boardMultiSelectClick' },
    ],
  },
  {
    titleKey: 'help.shortcuts.admin',
    rows: [
      { keys: '/ or Ctrl/Cmd+K', actionKey: 'help.shortcuts.adminSearch' },
    ],
  },
  {
    titleKey: 'help.shortcuts.gantt',
    rows: [
      { keys: 'Escape / Enter', actionKey: 'help.shortcuts.ganttExitModes' },
      { keys: '← / →', actionKey: 'help.shortcuts.ganttNudge' },
    ],
  },
  {
    titleKey: 'help.shortcuts.editor',
    rows: [
      { keys: 'Escape', actionKey: 'help.shortcuts.editorEscape' },
      { keys: 'Enter', actionKey: 'help.shortcuts.editorEnter' },
      { keys: 'Ctrl/Cmd+←/→', actionKey: 'help.shortcuts.editorNav' },
    ],
  },
];

export default function HelpModal({
  isOpen,
  onClose,
  currentUser,
  expandToken = 0,
  onPageChange,
  onViewModeChange,
  onOpenProfile,
}: HelpModalProps) {
  const { t, i18n } = useTranslation('common');
  const { siteSettings, systemSettings } = useSettings();
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const userId = currentUser?.id ?? null;
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (!currentUser?.id) return 'overview';
    const savedTab = loadHelpSession(currentUser.id)?.activeTab;
    if (savedTab && HELP_TAB_IDS.has(savedTab as TabType)) {
      return savedTab as TabType;
    }
    return 'overview';
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [minimized, setMinimized] = useState(() => {
    if (!currentUser?.id) return false;
    return Boolean(loadHelpSession(currentUser.id)?.minimized);
  });
  const [searchFocused, setSearchFocused] = useState(false);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const firstMatchRef = useRef<HTMLElement | null>(null);
  const highlightCancelRef = useRef<(() => void) | null>(null);
  /** Preserve scroll per Help tab across minimize / remount / refresh. */
  const savedScrollByTabRef = useRef<Partial<Record<TabType, number>>>(
    currentUser?.id
      ? ({ ...(loadHelpSession(currentUser.id)?.scrollByTab || {}) } as Partial<Record<TabType, number>>)
      : {}
  );
  const { startTour } = useTour();
  const ownerSetup = useOwnerSetupOptional();
  
  // Check if user is admin
  const isAdmin = currentUser?.roles?.includes('admin') || false;
  const aiEnabled =
    siteSettings?.AI_ENABLED === 'true' || systemSettings?.AI_ENABLED === 'true';
  const [troubleshootingVisible, setTroubleshootingVisible] = useState(() =>
    isTroubleshootingVisible()
  );
  const [assistantOpen, setAssistantOpen] = useState(() =>
    Boolean(currentUser?.id && loadHelpSession(currentUser.id)?.assistantOpen)
  );
  const [assistantMessages, setAssistantMessages] = useState<HelpAssistantUiMessage[]>(() => {
    if (!currentUser?.id) return [];
    return (loadHelpSession(currentUser.id)?.assistantMessages || []) as HelpAssistantUiMessage[];
  });
  const [assistantPositionX, setAssistantPositionX] = useState<number | null>(() => {
    const x = currentUser?.id ? loadHelpSession(currentUser.id)?.assistantPositionX : undefined;
    return typeof x === 'number' ? x : null;
  });
  const [assistantHeight, setAssistantHeight] = useState(() => {
    const h = currentUser?.id ? loadHelpSession(currentUser.id)?.assistantHeight : undefined;
    return typeof h === 'number' ? h : 280;
  });

  // Keep in sync with Admin (gated deployments unlock via TROUBLE sequence)
  useEffect(() => {
    const sync = () => setTroubleshootingVisible(isTroubleshootingVisible());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === TROUBLESHOOTING_UNLOCK_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TROUBLESHOOTING_VISIBILITY_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TROUBLESHOOTING_VISIBILITY_EVENT, sync);
    };
  }, [isOpen]);

  const persistHelpScroll = useCallback(() => {
    if (contentRef.current) {
      savedScrollByTabRef.current[activeTab] = contentRef.current.scrollTop;
    }
  }, [activeTab]);

  const minimizeHelp = useCallback(() => {
    persistHelpScroll();
    setMinimized(true);
  }, [persistHelpScroll]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        const buildTime = typeof data?.buildTime === 'string' ? data.buildTime : null;
        const dateMatch = buildTime?.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!cancelled && dateMatch) {
          setReleaseDate(dateMatch[1]);
        }
      } catch {
        // Keep version-only footer when build time is unavailable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      highlightCancelRef.current?.();
      highlightCancelRef.current = null;
    };
  }, []);

  // Restore scroll after expand (content remounts when leaving minimized chip)
  useLayoutEffect(() => {
    if (minimized || !isOpen) return;
    const top = savedScrollByTabRef.current[activeTab] ?? 0;
    const restore = () => {
      if (contentRef.current) {
        contentRef.current.scrollTop = top;
      }
    };
    restore();
    const raf = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(raf);
  }, [minimized, isOpen, activeTab]);

  const goThere = useCallback(
    (target: HelpGoTarget) => {
      minimizeHelp();
      highlightCancelRef.current?.();
      highlightCancelRef.current = null;
      clearOwnerSetupFieldHighlights();

      if (target.kind === 'admin' && target.hash) {
        onPageChange?.('admin', { hash: target.hash });
        requestAdminNavigation(target.hash);
      } else if (target.kind === 'page' && target.page) {
        onPageChange?.(target.page);
      } else if (target.kind === 'profile') {
        onPageChange?.('kanban');
        onOpenProfile?.(target.profileFocus || 'displayName');
      } else if (target.kind === 'view' && target.mode) {
        onPageChange?.('kanban');
        onViewModeChange?.(target.mode);
      }

      if (target.reveal?.length) {
        queueHelpReveal(target.reveal);
      }

      if (target.highlights?.length) {
        highlightCancelRef.current = applyOwnerSetupFieldHighlights(target.highlights, {
          attempts: 30,
          intervalMs: 80,
          // Temporary spotlight (Guide me keeps highlights until the step ends)
          clearAfterMs: 4500,
        });
      }
    },
    [minimizeHelp, onPageChange, onViewModeChange, onOpenProfile]
  );

  const renderGoThereButton = useCallback(
    (target: HelpGoTarget) => (
      <button
        type="button"
        onClick={() => goThere(target)}
        className="shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        {t('help.goThere')}
      </button>
    ),
    [goThere, t]
  );

  // F1 / help button while docked → expand again
  useEffect(() => {
    if (isOpen && expandToken > 0) {
      setMinimized(false);
      if (userId) {
        persistHelpScroll();
        saveHelpSession(userId, {
          open: true,
          minimized: false,
          activeTab,
          scrollByTab: { ...savedScrollByTabRef.current },
          assistantOpen,
          assistantMessages,
          assistantPositionX,
          assistantHeight,
        });
      }
    }
  }, [expandToken, isOpen, userId, activeTab, persistHelpScroll]);

  useEffect(() => {
    if (!isOpen) {
      setMinimized(false);
      setSearchTerm('');
      setDebouncedSearchTerm('');
      savedScrollByTabRef.current = {};
    }
  }, [isOpen]);

  // Keep sessionStorage in sync while Help is open (refresh-safe)
  useEffect(() => {
    if (!isOpen || !userId) return;
    const flush = () => {
      if (contentRef.current) {
        savedScrollByTabRef.current[activeTab] = contentRef.current.scrollTop;
      }
      saveHelpSession(userId, {
        open: true,
        minimized,
        activeTab,
        scrollByTab: { ...savedScrollByTabRef.current },
        assistantOpen,
        assistantMessages,
        assistantPositionX,
        assistantHeight,
      });
    };
    flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [isOpen, userId, minimized, activeTab, assistantOpen, assistantMessages, assistantPositionX, assistantHeight]);

  const currentLanguage = useMemo(() => {
    if (i18n.language?.startsWith('fr')) return 'fr';
    if (i18n.language?.startsWith('en')) return 'en';
    return 'en';
  }, [i18n.language]);

  const handleLanguageToggle = async () => {
    const newLanguage = currentLanguage === 'en' ? 'fr' : 'en';
    await i18n.changeLanguage(newLanguage);
    if (currentUser) {
      void updateUserPreference('language', newLanguage, currentUser.id);
    }
  };

  // Leave AI tab if AI is turned off while the modal is open
  useEffect(() => {
    if (!aiEnabled && activeTab === 'ai') {
      setActiveTab('overview');
    }
  }, [aiEnabled, activeTab]);

  // Delivery playbook is admin-only
  useEffect(() => {
    if (!isAdmin && activeTab === 'delivery') {
      setActiveTab('overview');
    }
  }, [isAdmin, activeTab]);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Scroll to first match when search term changes
  useEffect(() => {
    if (debouncedSearchTerm.trim() && firstMatchRef.current) {
      setTimeout(() => {
        firstMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [debouncedSearchTerm, activeTab]);

  // Reset first match ref when search changes
  useEffect(() => {
    firstMatchRef.current = null;
  }, [debouncedSearchTerm, activeTab]);

  const stripHelpTabMarkers = useCallback((text: string): string => {
    return text
      .replace(/\[\[tab:([a-z]+)\]\]([\s\S]*?)\[\[\/tab\]\]/g, '$2')
      .replace(/\[\[icon:([a-zA-Z0-9]+)\]\]/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1');
  }, []);

  // Highlight search terms in text - returns React components
  const highlightText = useCallback((text: string, searchTerm: string): React.ReactNode => {
    if (!searchTerm.trim() || !text) {
      return text;
    }

    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    const parts = text.split(regex);
    
    // Map parts to React elements, filtering empty strings
    return parts
      .filter(part => part.length > 0) // Filter out empty strings from split
      .map((part, index) => {
        // Check if this part exactly matches the search term (case-insensitive)
        const testRegex = new RegExp(`^${escapedTerm}$`, 'i');
        const isMatch = testRegex.test(part);
        
        if (isMatch) {
          return (
            <span 
              key={index}
              className="bg-yellow-200 dark:bg-yellow-600 text-yellow-900 dark:text-yellow-100 px-0.5 rounded font-medium"
            >
              {part}
            </span>
          );
        }
        // Return plain string for non-matching parts to prevent spacing issues
        return part;
      });
  }, []);

  const renderInlineMarkup = useCallback((text: string, searchTerm: string): React.ReactNode => {
    if (!text) return text;
    if (!text.includes('**')) {
      return highlightText(text, searchTerm);
    }

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    const re = /\*\*([^*]+)\*\*/g;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(
          <React.Fragment key={key++}>
            {highlightText(text.slice(lastIndex, match.index), searchTerm)}
          </React.Fragment>
        );
      }
      nodes.push(
        <strong key={key++} className="font-semibold text-slate-800 dark:text-gray-100">
          {highlightText(match[1], searchTerm)}
        </strong>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      nodes.push(
        <React.Fragment key={key++}>
          {highlightText(text.slice(lastIndex), searchTerm)}
        </React.Fragment>
      );
    }

    return nodes.length === 1 ? nodes[0] : nodes;
  }, [highlightText]);

  const goToHelpTab = useCallback((tabId: TabType) => {
    if (tabId === 'ai' && !aiEnabled) return;
    if (tabId === 'admin' && !isAdmin) return;
    if (tabId === 'delivery' && !isAdmin) return;
    persistHelpScroll();
    savedScrollByTabRef.current[tabId] = 0;
    setActiveTab(tabId);
  }, [aiEnabled, isAdmin, persistHelpScroll]);

  const renderHelpContent = useCallback((text: string, searchTerm: string): React.ReactNode => {
    if (!text) return text;
    if (!text.includes('[[tab:') && !text.includes('[[icon:')) {
      return renderInlineMarkup(text, searchTerm);
    }

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    const re = /\[\[tab:([a-z]+)\]\]([\s\S]*?)\[\[\/tab\]\]|\[\[icon:([a-zA-Z0-9]+)\]\]/g;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(
          <React.Fragment key={key++}>
            {renderInlineMarkup(text.slice(lastIndex, match.index), searchTerm)}
          </React.Fragment>
        );
      }

      if (match[1] != null) {
        const tabId = match[1] as TabType;
        const label = match[2];
        const isValidTab = HELP_TAB_IDS.has(tabId);
        const isAvailable =
          isValidTab &&
          !(tabId === 'ai' && !aiEnabled) &&
          !(tabId === 'admin' && !isAdmin) &&
          !(tabId === 'delivery' && !isAdmin);

        if (isAvailable) {
          nodes.push(
            <button
              key={key++}
              type="button"
              onClick={() => goToHelpTab(tabId)}
              className="mx-0.5 inline-flex items-center gap-1 align-baseline px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700/90 text-slate-700 dark:text-gray-200 text-[13px] font-medium border border-slate-200/90 dark:border-gray-600 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-800 dark:hover:bg-teal-900/40 dark:hover:border-teal-600 dark:hover:text-teal-200 transition-colors"
            >
              {renderInlineMarkup(label, searchTerm)}
              <ArrowRight size={12} className="opacity-60 shrink-0" aria-hidden />
            </button>
          );
        } else {
          nodes.push(
            <React.Fragment key={key++}>
              {renderInlineMarkup(label, searchTerm)}
            </React.Fragment>
          );
        }
      } else if (match[3]) {
        const Icon = HELP_INLINE_ICONS[match[3]];
        if (Icon) {
          nodes.push(
            <Icon
              key={key++}
              size={14}
              className="inline-block align-text-bottom mx-0.5 text-slate-600 dark:text-gray-300"
              aria-hidden
            />
          );
        }
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      nodes.push(
        <React.Fragment key={key++}>
          {renderInlineMarkup(text.slice(lastIndex), searchTerm)}
        </React.Fragment>
      );
    }

    return nodes.length === 1 ? nodes[0] : nodes;
  }, [renderInlineMarkup, goToHelpTab, aiEnabled, isAdmin]);

  // Check if text contains search term (case-insensitive)
  const textMatches = useCallback((text: string, searchTerm: string): boolean => {
    if (!searchTerm.trim() || !text) return false;
    return stripHelpTabMarkers(text).toLowerCase().includes(searchTerm.toLowerCase());
  }, [stripHelpTabMarkers]);

  // Check if any text in an array of strings matches
  const anyTextMatches = useCallback((texts: string[], searchTerm: string): boolean => {
    if (!searchTerm.trim()) return false;
    return texts.some(text => textMatches(text, searchTerm));
  }, [textMatches]);

  const handleStartTour = () => {
    onClose(); // Close the modal first
    setTimeout(() => {
      startTour(); // Use context function
    }, 100);
  };

  const handleOpenOwnerSetup = () => {
    if (!ownerSetup) return;
    onClose();
    setTimeout(() => {
      ownerSetup.openChecklist();
    }, 100);
  };

  // Handle click outside to minimize (keep help docked)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        minimizeHelp();
      }
    };

    if (isOpen && !minimized) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, minimized, minimizeHelp]);

  const handleHelpEscape = useCallback(() => {
    const searchEl = searchInputRef.current;
    const searchIsFocused =
      searchFocused || (searchEl != null && document.activeElement === searchEl);
    if (searchIsFocused) {
      if (searchTerm) {
        setSearchTerm('');
        setDebouncedSearchTerm('');
      }
      searchEl?.blur();
      setSearchFocused(false);
      return;
    }
    minimizeHelp();
  }, [searchFocused, searchTerm, minimizeHelp]);

  useEscapeDismiss(handleHelpEscape, { enabled: isOpen && !minimized });

  if (!isOpen) return null;

  const sectionShellClass = (hasMatch: boolean) =>
    hasMatch && debouncedSearchTerm.trim()
      ? 'rounded-xl border-2 border-yellow-400 dark:border-yellow-600 bg-yellow-50/90 dark:bg-yellow-900/30 p-5 shadow-md'
      : 'rounded-xl border border-slate-200/90 dark:border-gray-700/80 bg-gradient-to-br from-white via-white to-slate-50/90 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900/50 p-5 shadow-sm';

  const sectionTitleClass =
    'text-lg font-semibold text-slate-800 dark:text-gray-100 mb-3 flex flex-wrap items-center gap-3';

  const subtitleClass =
    'text-sm font-semibold text-slate-800 dark:text-gray-100 tracking-tight';

  const bodyTextClass = 'text-sm leading-relaxed text-slate-600 dark:text-gray-300';

  const tabs = [
    { id: 'overview' as TabType, label: t('help.tabs.overview'), icon: LayoutGrid },
    ...(isAdmin ? [{ id: 'delivery' as TabType, label: t('help.tabs.delivery'), icon: ClipboardList }] : []),
    { id: 'shortcuts' as TabType, label: t('help.tabs.shortcuts'), icon: Keyboard },
    { id: 'kanban' as TabType, label: t('help.tabs.kanbanView'), icon: Columns },
    { id: 'list' as TabType, label: t('help.tabs.listView'), icon: List },
    { id: 'gantt' as TabType, label: t('help.tabs.ganttView'), icon: Calendar },
    { id: 'reports' as TabType, label: t('help.tabs.reports'), icon: BarChart3 },
    ...(aiEnabled ? [{ id: 'ai' as TabType, label: t('help.tabs.ai'), icon: Bot }] : []),
    ...(isAdmin ? [{ id: 'admin' as TabType, label: t('help.tabs.admin'), icon: Shield }] : []),
  ];

  // Helper to render a section with search highlighting
  const renderSection = useCallback((
    titleKey: string,
    contentKeys: string[],
    icon: any, // Lucide icon type
    iconColor: string,
    iconBg: string = 'bg-blue-50 dark:bg-blue-900/40',
    titleTarget?: HelpGoTarget
  ) => {
    const title = t(titleKey);
    const contents = contentKeys.map(key => t(key));
    const allTexts = [title, ...contents];
    const hasMatch = debouncedSearchTerm.trim() ? anyTextMatches(allTexts, debouncedSearchTerm) : false;

    const sectionRef = (node: HTMLElement | null) => {
      if (node && hasMatch && debouncedSearchTerm.trim() && !firstMatchRef.current) {
        firstMatchRef.current = node;
      }
    };

    return (
      <section ref={sectionRef} className={sectionShellClass(hasMatch)}>
        <h3 className={sectionTitleClass}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {React.createElement(icon, { className: iconColor, size: 18 })}
          </span>
          <span className="min-w-0">{highlightText(title, debouncedSearchTerm)}</span>
          {titleTarget ? renderGoThereButton(titleTarget) : null}
        </h3>
        <div className={`space-y-2.5 ${bodyTextClass}`}>
          {contents.map((content, index) => (
            <p key={index}>{renderHelpContent(content, debouncedSearchTerm)}</p>
          ))}
        </div>
      </section>
    );
  }, [t, debouncedSearchTerm, highlightText, renderHelpContent, anyTextMatches, renderGoThereButton]);

  // Helper to render a section with list items
  const renderSectionWithList = useCallback((
    titleKey: string,
    contentKeys: string[],
    listKeys: string[],
    icon: any, // Lucide icon type
    iconColor: string,
    iconBg: string = 'bg-blue-50 dark:bg-blue-900/40',
    titleTarget?: HelpGoTarget
  ) => {
    const title = t(titleKey);
    const contents = contentKeys.map(key => t(key));
    const listItems = listKeys.map(key => t(key));
    const allTexts = [title, ...contents, ...listItems];
    const hasMatch = debouncedSearchTerm.trim() ? anyTextMatches(allTexts, debouncedSearchTerm) : false;

    const sectionRef = (node: HTMLElement | null) => {
      if (node && hasMatch && debouncedSearchTerm.trim() && !firstMatchRef.current) {
        firstMatchRef.current = node;
      }
    };

    return (
      <section ref={sectionRef} className={sectionShellClass(hasMatch)}>
        <h3 className={sectionTitleClass}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {React.createElement(icon, { className: iconColor, size: 18 })}
          </span>
          <span className="min-w-0">{highlightText(title, debouncedSearchTerm)}</span>
          {titleTarget ? renderGoThereButton(titleTarget) : null}
        </h3>
        <div className={`space-y-2.5 ${bodyTextClass}`}>
          {contents.map((content, index) => (
            <p key={index}>{renderHelpContent(content, debouncedSearchTerm)}</p>
          ))}
          {listKeys.length > 0 && (
            <ul className="mt-1 space-y-2">
              {listItems.map((item, index) => (
                <li key={index} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-gray-500" aria-hidden />
                  <span>{renderHelpContent(item, debouncedSearchTerm)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }, [t, debouncedSearchTerm, highlightText, renderHelpContent, anyTextMatches, renderGoThereButton]);

  const renderChecklistSection = useCallback((
    titleKey: string,
    introKey: string | null,
    itemKeys: string[],
    icon: any,
    iconColor: string,
    iconBg: string,
    nav?: ChecklistNavOptions
  ) => {
    const title = t(titleKey);
    const intro = introKey ? t(introKey) : '';
    const items = itemKeys.map((key) => t(key));
    const allTexts = [title, intro, ...items].filter(Boolean);
    const hasMatch = debouncedSearchTerm.trim() ? anyTextMatches(allTexts, debouncedSearchTerm) : false;

    const sectionRef = (node: HTMLElement | null) => {
      if (node && hasMatch && debouncedSearchTerm.trim() && !firstMatchRef.current) {
        firstMatchRef.current = node;
      }
    };

    return (
      <section ref={sectionRef} className={sectionShellClass(hasMatch)}>
        <h3 className={sectionTitleClass}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {React.createElement(icon, { className: iconColor, size: 18 })}
          </span>
          <span className="min-w-0">{highlightText(title, debouncedSearchTerm)}</span>
          {nav?.titleTarget ? renderGoThereButton(nav.titleTarget) : null}
        </h3>
        {intro ? (
          <p className={`mb-3 ${bodyTextClass}`}>{renderHelpContent(intro, debouncedSearchTerm)}</p>
        ) : null}
        <ol className="space-y-2.5">
          {items.map((item, index) => {
            const itemKey = itemKeys[index];
            const itemTarget = nav?.itemTargets?.[itemKey];
            return (
              <li
                key={itemKey}
                className="flex gap-3 rounded-lg border border-slate-200/80 dark:border-gray-700/70 bg-white/70 dark:bg-gray-900/30 px-3 py-2.5"
              >
                <span
                  className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-teal-400/80 dark:border-teal-500/70 bg-teal-50 dark:bg-teal-900/40 text-xs font-bold text-teal-700 dark:text-teal-300 tabular-nums"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span className={`min-w-0 ${bodyTextClass} flex flex-wrap items-center gap-2`}>
                  <span>{renderHelpContent(item, debouncedSearchTerm)}</span>
                  {itemTarget ? renderGoThereButton(itemTarget) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }, [t, debouncedSearchTerm, highlightText, renderHelpContent, anyTextMatches, renderGoThereButton]);

  const renderGroupedSection = useCallback((
    titleKey: string,
    introKeys: string[],
    groups: { titleKey: string; itemKeys: string[] }[],
    footerKeys: string[],
    icon: any,
    iconColor: string,
    iconBg: string,
    itemTargets?: Partial<Record<string, HelpGoTarget>>
  ) => {
    const title = t(titleKey);
    const intros = introKeys.map((key) => t(key));
    const footers = footerKeys.map((key) => t(key));
    const groupPayload = groups.map((g) => ({
      titleKey: g.titleKey,
      title: t(g.titleKey),
      items: g.itemKeys.map((key) => t(key)),
      itemKeys: g.itemKeys,
    }));
    const allTexts = [
      title,
      ...intros,
      ...footers,
      ...groupPayload.flatMap((g) => [g.title, ...g.items]),
    ];
    const hasMatch = debouncedSearchTerm.trim() ? anyTextMatches(allTexts, debouncedSearchTerm) : false;

    const sectionRef = (node: HTMLElement | null) => {
      if (node && hasMatch && debouncedSearchTerm.trim() && !firstMatchRef.current) {
        firstMatchRef.current = node;
      }
    };

    return (
      <section ref={sectionRef} className={sectionShellClass(hasMatch)}>
        <h3 className={sectionTitleClass}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {React.createElement(icon, { className: iconColor, size: 18 })}
          </span>
          {highlightText(title, debouncedSearchTerm)}
        </h3>
        <div className="space-y-4">
          {intros.map((content, index) => (
            <p key={`intro-${index}`} className={bodyTextClass}>
              {renderHelpContent(content, debouncedSearchTerm)}
            </p>
          ))}
          {groupPayload.map((group) => (
            <div key={group.titleKey} className="space-y-2">
              <h4 className={subtitleClass}>{highlightText(group.title, debouncedSearchTerm)}</h4>
              <ul className="space-y-1.5">
                {group.items.map((item, index) => {
                  const itemKey = group.itemKeys[index];
                  const itemTarget = itemTargets?.[itemKey];
                  return (
                    <li key={itemKey} className={`flex gap-2.5 ${bodyTextClass}`}>
                      <Circle className="mt-1.5 h-2 w-2 shrink-0 fill-current text-slate-400 dark:text-gray-500" aria-hidden />
                      <span className="min-w-0 flex flex-wrap items-center gap-2">
                        <span>{renderHelpContent(item, debouncedSearchTerm)}</span>
                        {itemTarget ? renderGoThereButton(itemTarget) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {footers.map((content, index) => (
            <p key={`footer-${index}`} className={`${bodyTextClass} italic text-slate-500 dark:text-gray-400`}>
              {renderHelpContent(content, debouncedSearchTerm)}
            </p>
          ))}
        </div>
      </section>
    );
  }, [t, debouncedSearchTerm, highlightText, renderHelpContent, anyTextMatches, renderGoThereButton]);

  const renderDeliveryTab = () => {
    const sections = [
      renderSection(
        'help.delivery.intro',
        ['help.delivery.introDesc1', 'help.delivery.introDesc2', 'help.delivery.introDesc3'],
        ClipboardList,
        'text-teal-600 dark:text-teal-400',
        'bg-teal-50 dark:bg-teal-900/40'
      ),
      renderSectionWithList(
        'help.delivery.roles',
        [],
        ['help.delivery.roleAdmin', 'help.delivery.roleUser', 'help.delivery.roleViewer'],
        Users,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40'
      ),
      renderChecklistSection(
        'help.delivery.firstHour',
        'help.delivery.firstHourIntro',
        [
          'help.delivery.firstHour2', 'help.delivery.firstHour3',
          'help.delivery.firstHour4', 'help.delivery.firstHour5', 'help.delivery.firstHour6',
          'help.delivery.firstHour7', 'help.delivery.firstHour8', 'help.delivery.firstHour9',
        ],
        CheckSquare,
        'text-emerald-600 dark:text-emerald-400',
        'bg-emerald-50 dark:bg-emerald-900/40',
        {
          itemTargets: {
            'help.delivery.firstHour5': adminGo('admin#project-settings#project', HELP_HL.project),
            'help.delivery.firstHour6': adminGo('admin#project-settings#features', HELP_HL.features),
            'help.delivery.firstHour8': adminGo('admin#project-settings#sprint-settings', HELP_HL.sprints),
          },
        }
      ),
      renderGroupedSection(
        'help.delivery.shapeBoard',
        [],
        [
          {
            titleKey: 'help.delivery.shapeColumns',
            itemKeys: [
              'help.delivery.shapeColumns1', 'help.delivery.shapeColumns2',
              'help.delivery.shapeColumns3', 'help.delivery.shapeColumns4',
            ],
          },
          {
            titleKey: 'help.delivery.oneBoard',
            itemKeys: [
              'help.delivery.oneBoardWhen', 'help.delivery.manyBoardsWhen', 'help.delivery.oneBoardAdvice',
            ],
          },
        ],
        [],
        Columns,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40'
      ),
      renderGroupedSection(
        'help.delivery.softWip',
        ['help.delivery.softWipIntro'],
        [
          {
            titleKey: 'help.delivery.columnWip',
            itemKeys: ['help.delivery.columnWip1', 'help.delivery.columnWip2', 'help.delivery.columnWip3'],
          },
          {
            titleKey: 'help.delivery.boardWip',
            itemKeys: [
              'help.delivery.boardWip1', 'help.delivery.boardWip2',
              'help.delivery.boardWip3', 'help.delivery.boardWip4',
            ],
          },
          {
            titleKey: 'help.delivery.softWipDefaults',
            itemKeys: [
              'help.delivery.softWipDefault1', 'help.delivery.softWipDefault2', 'help.delivery.softWipDefault3',
            ],
          },
        ],
        ['help.delivery.softWipNote'],
        AlertTriangle,
        'text-amber-600 dark:text-amber-400',
        'bg-amber-50 dark:bg-amber-900/40'
      ),
      renderGroupedSection(
        'help.delivery.rituals',
        [],
        [
          {
            titleKey: 'help.delivery.standup',
            itemKeys: [
              'help.delivery.standup1', 'help.delivery.standup2', 'help.delivery.standup3',
              'help.delivery.standup4', 'help.delivery.standup5',
            ],
          },
          {
            titleKey: 'help.delivery.planning',
            itemKeys: [
              'help.delivery.planning1', 'help.delivery.planning2',
              'help.delivery.planning3', 'help.delivery.planning4',
            ],
          },
          {
            titleKey: 'help.delivery.sprints',
            itemKeys: [
              'help.delivery.sprints1', 'help.delivery.sprints2',
              'help.delivery.sprints3', 'help.delivery.sprints4',
            ],
          },
        ],
        ['help.delivery.sprintsNote'],
        MessageSquare,
        'text-indigo-600 dark:text-indigo-400',
        'bg-indigo-50 dark:bg-indigo-900/40',
        {
          'help.delivery.sprints3': adminGo('admin#project-settings#reporting', HELP_HL.reporting),
        }
      ),
      renderSectionWithList(
        'help.delivery.features',
        ['help.delivery.featuresIntro', 'help.delivery.featuresAdvice'],
        [
          'help.delivery.features1', 'help.delivery.features2',
          'help.delivery.features3', 'help.delivery.features4',
        ],
        Eye,
        'text-cyan-600 dark:text-cyan-400',
        'bg-cyan-50 dark:bg-cyan-900/40',
        adminGo('admin#project-settings#features', HELP_HL.features)
      ),
      renderSectionWithList(
        'help.delivery.hygiene',
        [],
        [
          'help.delivery.hygieneDone', 'help.delivery.hygieneDelete', 'help.delivery.hygienePurge',
          'help.delivery.hygieneArchive', 'help.delivery.hygieneRetention',
        ],
        Trash2,
        'text-amber-600 dark:text-amber-400',
        'bg-amber-50 dark:bg-amber-900/40'
      ),
      renderSectionWithList(
        'help.delivery.antiPatterns',
        [],
        [
          'help.delivery.antiPattern1', 'help.delivery.antiPattern2', 'help.delivery.antiPattern3',
          'help.delivery.antiPattern4', 'help.delivery.antiPattern6',
          'help.delivery.antiPattern7',
        ],
        AlertTriangle,
        'text-red-600 dark:text-red-400',
        'bg-red-50 dark:bg-red-900/40'
      ),
      renderChecklistSection(
        'help.delivery.conventions',
        'help.delivery.conventionsIntro',
        [
          'help.delivery.convention1', 'help.delivery.convention2', 'help.delivery.convention3',
          'help.delivery.convention4', 'help.delivery.convention5', 'help.delivery.convention6',
          'help.delivery.convention7', 'help.delivery.convention8', 'help.delivery.convention9',
          'help.delivery.convention10',
        ],
        ListChecks,
        'text-slate-600 dark:text-slate-300',
        'bg-slate-100 dark:bg-slate-700/50'
      ),
      renderSection(
        'help.delivery.nextSteps',
        ['help.delivery.nextStepsDesc'],
        ArrowRight,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40'
      ),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderOverviewTab = () => {
    const navigationKeys = isAdmin
      ? ['help.overview.boardSelectorAdmin', 'help.overview.boardTrash', 'help.overview.viewModes', 'help.overview.searchFilter', 'help.overview.userProfile', 'help.overview.activityFeed', 'help.overview.adminPanel']
      : ['help.overview.boardSelector', 'help.overview.taskTrash', 'help.overview.viewModes', 'help.overview.searchFilter', 'help.overview.userProfile', 'help.overview.activityFeed'];
    const roleListKeys = [
      'help.overview.assignees',
      'help.overview.watchers',
      'help.overview.collaborators',
      'help.overview.requesters',
      ...(isAdmin ? ['help.overview.system'] : []),
    ];

    const sections = [
      renderSection(
        'help.overview.whatIsEasyKanban',
        ['help.overview.whatIsEasyKanbanDesc1', 'help.overview.whatIsEasyKanbanDesc2'],
        LayoutGrid,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40'
      ),
      renderSectionWithList(
        'help.overview.navigation',
        [],
        navigationKeys,
        ArrowRight,
        'text-emerald-600 dark:text-emerald-400',
        'bg-emerald-50 dark:bg-emerald-900/40'
      ),
      renderSectionWithList(
        'help.overview.sprints',
        ['help.overview.sprintsDesc1', 'help.overview.sprintsDesc2'],
        ['help.overview.sprintFilter'],
        Calendar,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40'
      ),
      renderSectionWithList(
        'help.overview.teamManagement',
        ['help.overview.teamMembers', 'help.overview.memberSelection', 'help.overview.clearButton', 'help.overview.roleBasedFiltering'],
        roleListKeys,
        Users,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40'
      ),
      renderSectionWithList(
        'help.overview.tools',
        [],
        [
          'help.overview.multiSelectTools',
          'help.overview.taskViewModes', 'help.overview.activityFeedTools',
          'help.overview.realtimeCollaboration', 'help.overview.keyboardShortcuts',
          ...(isAdmin ? ['help.overview.deliveryPlaybook'] : []),
        ],
        Settings,
        'text-orange-600 dark:text-orange-400',
        'bg-orange-50 dark:bg-orange-900/40'
      ),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderShortcutsTab = () => {
    const note = t('help.shortcuts.note');
    const noteMatch =
      debouncedSearchTerm.trim() && anyTextMatches([note, t('help.shortcuts.title')], debouncedSearchTerm);

    return (
      <div className="space-y-5">
        <section className={sectionShellClass(!!noteMatch)}>
          <h3 className={sectionTitleClass}>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/40">
              <Keyboard className="text-indigo-600 dark:text-indigo-400" size={18} />
            </span>
            {highlightText(t('help.shortcuts.title'), debouncedSearchTerm)}
          </h3>
          <p className={bodyTextClass}>
            {highlightText(note, debouncedSearchTerm)}
          </p>
        </section>

        {HELP_SHORTCUT_SECTIONS.map((section) => {
          const title = t(section.titleKey);
          const actions = section.rows.map((row) => t(row.actionKey));
          const hasMatch =
            !!debouncedSearchTerm.trim() &&
            anyTextMatches(
              [title, ...section.rows.map((r) => r.keys), ...actions],
              debouncedSearchTerm
            );

          return (
            <section
              key={section.titleKey}
              className={sectionShellClass(hasMatch)}
            >
              <h3 className={sectionTitleClass}>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/60">
                  <Keyboard className="text-slate-600 dark:text-slate-300" size={18} />
                </span>
                {highlightText(title, debouncedSearchTerm)}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/80">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 w-48">
                        {t('help.shortcuts.colKeys')}
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                        {t('help.shortcuts.colAction')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-600 bg-white dark:bg-gray-800">
                    {section.rows.map((row) => (
                      <tr key={`${section.titleKey}-${row.keys}-${row.actionKey}`}>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <kbd className="inline-block px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-mono text-xs border border-gray-200 dark:border-gray-600">
                            {highlightText(row.keys, debouncedSearchTerm)}
                          </kbd>
                        </td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                          {highlightText(t(row.actionKey), debouncedSearchTerm)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  const renderKanbanTab = () => {
    const sections = [
      renderSection(
        'help.kanban.overview',
        ['help.kanban.overviewDesc1', 'help.kanban.overviewDesc2', 'help.kanban.overviewDesc3'],
        Columns,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40',
        viewGo('kanban')
      ),
      renderGroupedSection(
        'help.kanban.taskManagement',
        [],
        [
          {
            titleKey: 'help.kanban.createAndEdit',
            itemKeys: [
              'help.kanban.createTasks', 'help.kanban.editTasks', 'help.kanban.editTasksQuick',
              'help.kanban.editTasksDates', 'help.kanban.editTasksAssignee', 'help.kanban.editTasksPriority',
              'help.kanban.editTasksSprint', 'help.kanban.taskDetailsClick',
            ],
          },
          {
            titleKey: 'help.kanban.moveAndOrganize',
            itemKeys: [
              'help.kanban.moveTasks', 'help.kanban.reorderTasks', 'help.kanban.copyTasks',
              isAdmin ? 'help.kanban.deleteTasksAdmin' : 'help.kanban.deleteTasks',
              'help.kanban.taskToolbar',
            ],
          },
        ],
        [],
        ClipboardList,
        'text-orange-600 dark:text-orange-400',
        'bg-orange-50 dark:bg-orange-900/40'
      ),
      renderChecklistSection(
        'help.kanban.multiSelect',
        null,
        ['help.kanban.multiSelectDesc1', 'help.kanban.multiSelectDesc2', 'help.kanban.multiSelectDesc3'],
        CheckSquare,
        'text-cyan-600 dark:text-cyan-400',
        'bg-cyan-50 dark:bg-cyan-900/40'
      ),
      renderSectionWithList(
        'help.kanban.flowAids',
        [],
        ['help.kanban.flowAidsWip', 'help.kanban.flowAidsAging', 'help.kanban.flowAidsBlocked', 'help.kanban.flowAidsPolicy'],
        AlertTriangle,
        'text-amber-600 dark:text-amber-400',
        'bg-amber-50 dark:bg-amber-900/40'
      ),
      renderSectionWithList(
        'help.kanban.dragDrop',
        [],
        ['help.kanban.crossColumnMovement', 'help.kanban.crossBoardMovement', 'help.kanban.withinColumnReordering', 'help.kanban.visualFeedback', 'help.kanban.autoSave'],
        ArrowRight,
        'text-teal-600 dark:text-teal-400',
        'bg-teal-50 dark:bg-teal-900/40'
      ),
      renderSectionWithList(
        'help.kanban.taskDetailsComm',
        [],
        ['help.kanban.taskInformation', 'help.kanban.comments', 'help.kanban.attachments', 'help.kanban.priorityLevels', 'help.kanban.tags', 'help.kanban.watchers', 'help.kanban.collaborators', 'help.kanban.taskRelationships'],
        MessageSquare,
        'text-indigo-600 dark:text-indigo-400',
        'bg-indigo-50 dark:bg-indigo-900/40'
      ),
      ...(isAdmin
        ? [
            renderSectionWithList(
              'help.kanban.columnManagement',
              [],
              [
                'help.kanban.createColumns', 'help.kanban.renameColumns', 'help.kanban.reorderColumns',
                'help.kanban.deleteColumns', 'help.kanban.finishedColumns', 'help.kanban.columnWipPolicy',
                'help.kanban.boardWipTip',
              ],
              Columns,
              'text-purple-600 dark:text-purple-400',
              'bg-purple-50 dark:bg-purple-900/40'
            ),
          ]
        : []),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderListTab = () => {
    const sections = [
      renderSection(
        'help.list.overview',
        ['help.list.overviewDesc1', 'help.list.overviewDesc2', 'help.list.overviewDesc3'],
        List,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40',
        viewGo('list')
      ),
      renderSectionWithList(
        'help.list.columnConfiguration',
        [],
        ['help.list.showHideColumns', 'help.list.defaultColumns', 'help.list.columnPersistence', 'help.list.horizontalScrolling'],
        Settings,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40'
      ),
      renderSectionWithList(
        'help.list.sortingFiltering',
        [],
        ['help.list.sortByColumn', 'help.list.multiLevelSorting', 'help.list.searchIntegration', 'help.list.savedFilters', 'help.list.advancedFiltering'],
        Search,
        'text-orange-600 dark:text-orange-400',
        'bg-orange-50 dark:bg-orange-900/40'
      ),
      renderSectionWithList(
        'help.list.taskActions',
        [],
        [isAdmin ? 'help.list.quickActionsAdmin' : 'help.list.quickActions', 'help.list.statusChanges', 'help.list.directEditing', 'help.list.taskDetails'],
        ClipboardList,
        'text-emerald-600 dark:text-emerald-400',
        'bg-emerald-50 dark:bg-emerald-900/40'
      ),
      renderSectionWithList(
        'help.list.dataDisplay',
        [],
        ['help.list.richText', 'help.list.dateFormatting', 'help.list.priorityIndicators', 'help.list.memberAvatars', 'help.list.tagDisplay', 'help.list.commentCounts', 'help.list.statusIndicators'],
        Eye,
        'text-indigo-600 dark:text-indigo-400',
        'bg-indigo-50 dark:bg-indigo-900/40'
      ),
      ...(isAdmin
        ? [
            renderChecklistSection(
              'help.list.export',
              'help.list.exportDesc',
              ['help.list.exportFormats', 'help.list.exportScopes', 'help.list.exportFields', 'help.list.exportExcel'],
              Download,
              'text-emerald-600 dark:text-emerald-400',
              'bg-emerald-50 dark:bg-emerald-900/40',
              {
                titleTarget: viewGo('list', HELP_HL.export),
              }
            ),
          ]
        : []),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderGanttTab = () => {
    const sections = [
      renderSection(
        'help.gantt.overview',
        ['help.gantt.overviewDesc1', 'help.gantt.overviewDesc2', 'help.gantt.overviewDesc3'],
        Calendar,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40',
        viewGo('gantt')
      ),
      renderSectionWithList(
        'help.gantt.timelineNavigation',
        [],
        ['help.gantt.scrollNavigation', 'help.gantt.todayButton', 'help.gantt.taskNavigation', 'help.gantt.relationshipMode'],
        ArrowRight,
        'text-emerald-600 dark:text-emerald-400',
        'bg-emerald-50 dark:bg-emerald-900/40'
      ),
      renderSectionWithList(
        'help.gantt.taskManagement',
        [],
        [
          'help.gantt.createTasks', 'help.gantt.editTasks', 'help.gantt.resizeTasks', 'help.gantt.moveTasks',
          'help.gantt.copyTasks',
          isAdmin ? 'help.gantt.deleteTasksAdmin' : 'help.gantt.deleteTasks',
        ],
        ClipboardList,
        'text-orange-600 dark:text-orange-400',
        'bg-orange-50 dark:bg-orange-900/40'
      ),
      renderSectionWithList(
        'help.gantt.dependencies',
        [],
        ['help.gantt.createDependencies', 'help.gantt.dependencyTypes', 'help.gantt.visualArrows', 'help.gantt.cycleDetection', 'help.gantt.taskRelationships'],
        MessageSquare,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40'
      ),
      renderSectionWithList(
        'help.gantt.timelineFeatures',
        [],
        ['help.gantt.timelineNavigationDesc', 'help.gantt.todayIndicator', 'help.gantt.lateBadge', 'help.gantt.columnOrganization', 'help.gantt.realtimeUpdatesTimeline'],
        Eye,
        'text-indigo-600 dark:text-indigo-400',
        'bg-indigo-50 dark:bg-indigo-900/40'
      ),
      renderSectionWithList(
        'help.gantt.performance',
        [],
        ['help.gantt.virtualScrolling', 'help.gantt.lazyLoading', 'help.gantt.realtimeUpdates', 'help.gantt.keyboardShortcuts', 'help.gantt.performanceMonitoring'],
        Settings,
        'text-slate-600 dark:text-slate-300',
        'bg-slate-100 dark:bg-slate-700/50'
      ),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderReportsTab = () => {
    const sections = [
      renderSection(
        'help.reports.overview',
        ['help.reports.overviewDesc'],
        BarChart3,
        'text-blue-500'
      ),
      renderSection(
        'help.reports.myStats',
        ['help.reports.myStatsDesc'],
        BarChart3,
        'text-purple-500'
      ),
      renderSection(
        'help.reports.leaderboard',
        ['help.reports.leaderboardDesc'],
        BarChart3,
        'text-orange-500'
      ),
      renderSection(
        'help.reports.burndown',
        ['help.reports.burndownDesc'],
        BarChart3,
        'text-green-500'
      ),
      renderSection(
        'help.reports.teamPerformance',
        ['help.reports.teamPerformanceDesc'],
        BarChart3,
        'text-indigo-500'
      ),
      renderSection(
        'help.reports.taskList',
        ['help.reports.taskListDesc'],
        BarChart3,
        'text-teal-500'
      ),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderAiTab = () => {
    const sections = [
      renderSection(
        'help.ai.overview',
        ['help.ai.overviewDesc1', 'help.ai.overviewDesc2'],
        Bot,
        'text-violet-600 dark:text-violet-400',
        'bg-violet-50 dark:bg-violet-900/40',
        isAdmin ? adminGo('admin#system-settings#ai', HELP_HL.ai) : undefined
      ),
      renderChecklistSection(
        'help.ai.assigning',
        'help.ai.assigningDesc',
        [
          'help.ai.assignStep1', 'help.ai.assignStep2', 'help.ai.assignStep3', 'help.ai.assignStep4',
        ],
        ClipboardList,
        'text-orange-600 dark:text-orange-400',
        'bg-orange-50 dark:bg-orange-900/40'
      ),
      renderChecklistSection(
        'help.ai.controlling',
        'help.ai.controllingDesc',
        ['help.ai.controlStep1', 'help.ai.controlStep2', 'help.ai.controlStep3'],
        Play,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40'
      ),
      renderSectionWithList(
        'help.ai.devCredentials',
        ['help.ai.devCredentialsDesc'],
        [
          'help.ai.devCredentialsApiTokens',
          'help.ai.devCredentialsSsh',
          'help.ai.devCredentialsGithub',
          'help.ai.devCredentialsProbe',
        ],
        KeyRound,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40'
      ),
      ...(isAdmin
        ? [
            renderChecklistSection(
              'help.ai.adminSettings',
              'help.ai.adminSettingsDesc',
              [
                'help.ai.adminStep1', 'help.ai.adminStep2', 'help.ai.adminStep3',
                'help.ai.adminStep4', 'help.ai.adminStep5',
              ],
              Settings,
              'text-red-600 dark:text-red-400',
              'bg-red-50 dark:bg-red-900/40',
              { titleTarget: adminGo('admin#system-settings#ai', HELP_HL.ai) }
            ),
            renderChecklistSection(
              'help.ai.automation',
              'help.ai.automationDesc',
              [
                'help.ai.autoStep1', 'help.ai.autoStep2', 'help.ai.autoStep3', 'help.ai.autoStep4',
              ],
              Bot,
              'text-teal-700 dark:text-teal-400',
              'bg-teal-50 dark:bg-teal-900/40'
            ),
          ]
        : []),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderAdminTab = () => {
    const sections = [
      renderSection(
        'help.admin.overview',
        ['help.admin.overviewDesc'],
        Shield,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40'
      ),
      renderChecklistSection(
        'help.admin.users',
        'help.admin.usersDesc',
        [
          'help.admin.usersStep1', 'help.admin.usersStep2', 'help.admin.usersStep3',
          'help.admin.usersStep4', 'help.admin.usersStep5', 'help.admin.usersNote',
        ],
        Users,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40'
      ),
      renderChecklistSection(
        'help.admin.siteSettings',
        'help.admin.siteSettingsDesc',
        [
          'help.admin.siteStep1', 'help.admin.siteStep2', 'help.admin.siteStep3', 'help.admin.siteStep4',
        ],
        Settings,
        'text-orange-600 dark:text-orange-400',
        'bg-orange-50 dark:bg-orange-900/40',
        { titleTarget: adminGo('admin#site-settings', HELP_HL.siteSettings) }
      ),
      renderChecklistSection(
        'help.admin.sso',
        'help.admin.ssoDesc',
        [
          'help.admin.ssoStep1', 'help.admin.ssoStep2', 'help.admin.ssoStep3',
          'help.admin.ssoStep4', 'help.admin.ssoStep5',
        ],
        Settings,
        'text-emerald-600 dark:text-emerald-400',
        'bg-emerald-50 dark:bg-emerald-900/40',
        { titleTarget: adminGo('admin#system-settings#sso', HELP_HL.sso) }
      ),
      renderChecklistSection(
        'help.admin.mailServer',
        'help.admin.mailServerDesc',
        [
          'help.admin.mailStep1', 'help.admin.mailStep2', 'help.admin.mailStep3',
          'help.admin.mailStep4', 'help.admin.mailStep5',
        ],
        Settings,
        'text-indigo-600 dark:text-indigo-400',
        'bg-indigo-50 dark:bg-indigo-900/40',
        { titleTarget: adminGo('admin#system-settings#mail-server', HELP_HL.mail) }
      ),
      renderChecklistSection(
        'help.admin.storage',
        'help.admin.storageDesc',
        [
          'help.admin.storageStep1', 'help.admin.storageStep2', 'help.admin.storageStep3',
          'help.admin.storageStep4', 'help.admin.storageStep5',
        ],
        HardDrive,
        'text-cyan-600 dark:text-cyan-400',
        'bg-cyan-50 dark:bg-cyan-900/40',
        { titleTarget: adminGo('admin#system-settings#storage', HELP_HL.storage) }
      ),
      renderChecklistSection(
        'help.admin.fileUploads',
        'help.admin.fileUploadsDesc',
        [
          'help.admin.fileUploadsStep1', 'help.admin.fileUploadsStep2',
          'help.admin.fileUploadsStep3', 'help.admin.fileUploadsStep4',
        ],
        Download,
        'text-sky-600 dark:text-sky-400',
        'bg-sky-50 dark:bg-sky-900/40',
        { titleTarget: adminGo('admin#system-settings#file-uploads', HELP_HL.fileUploads) }
      ),
      renderChecklistSection(
        'help.admin.ai',
        'help.admin.aiDesc',
        [
          'help.admin.aiStep1', 'help.admin.aiStep2', 'help.admin.aiStep3',
          'help.admin.aiStep4', 'help.admin.aiStep5',
        ],
        Bot,
        'text-teal-600 dark:text-teal-400',
        'bg-teal-50 dark:bg-teal-900/40',
        { titleTarget: adminGo('admin#system-settings#ai', HELP_HL.ai) }
      ),
      renderChecklistSection(
        'help.admin.notifications',
        'help.admin.notificationsDesc',
        [
          'help.admin.notificationsStep1', 'help.admin.notificationsStep2',
          'help.admin.notificationsStep3', 'help.admin.notificationsStep4',
        ],
        MessageSquare,
        'text-pink-600 dark:text-pink-400',
        'bg-pink-50 dark:bg-pink-900/40',
        { titleTarget: adminGo('admin#system-settings#notifications', HELP_HL.notifications) }
      ),
      renderChecklistSection(
        'help.admin.notificationQueue',
        'help.admin.notificationQueueDesc',
        [
          'help.admin.notificationQueueStep1', 'help.admin.notificationQueueStep2',
          'help.admin.notificationQueueStep3', 'help.admin.notificationQueueStep4',
        ],
        ListChecks,
        'text-fuchsia-600 dark:text-fuchsia-400',
        'bg-fuchsia-50 dark:bg-fuchsia-900/40',
        { titleTarget: adminGo('admin#system-settings#notification-queue', HELP_HL.notificationQueue) }
      ),
      renderChecklistSection(
        'help.admin.tags',
        'help.admin.tagsDesc',
        ['help.admin.tagsStep1', 'help.admin.tagsStep2', 'help.admin.tagsStep3'],
        Settings,
        'text-teal-600 dark:text-teal-400',
        'bg-teal-50 dark:bg-teal-900/40',
        { titleTarget: adminGo('admin#tags', HELP_HL.tags) }
      ),
      renderChecklistSection(
        'help.admin.priorities',
        'help.admin.prioritiesDesc',
        [
          'help.admin.prioritiesStep1', 'help.admin.prioritiesStep2',
          'help.admin.prioritiesStep3', 'help.admin.prioritiesStep4',
        ],
        Settings,
        'text-rose-600 dark:text-rose-400',
        'bg-rose-50 dark:bg-rose-900/40',
        { titleTarget: adminGo('admin#priorities', HELP_HL.priorities) }
      ),
      renderChecklistSection(
        'help.admin.appSettings',
        'help.admin.appSettingsDesc',
        [
          'help.admin.appStep1', 'help.admin.appStep2', 'help.admin.appStep3', 'help.admin.appStep4',
        ],
        Settings,
        'text-red-600 dark:text-red-400',
        'bg-red-50 dark:bg-red-900/40',
        { titleTarget: adminGo('admin#app-settings#user-interface', HELP_HL.appSettings) }
      ),
      ...(troubleshootingVisible
        ? [
            renderChecklistSection(
              'help.admin.troubleshooting',
              'help.admin.troubleshootingDesc',
              [
                'help.admin.troubleshootingStep1', 'help.admin.troubleshootingStep2',
                'help.admin.troubleshootingStep3', 'help.admin.troubleshootingStep4',
              ],
              AlertTriangle,
              'text-orange-600 dark:text-orange-400',
              'bg-orange-50 dark:bg-orange-900/40',
              { titleTarget: adminGo('admin#app-settings#troubleshooting', HELP_HL.troubleshooting) }
            ),
          ]
        : []),
      renderChecklistSection(
        'help.admin.projectSettings',
        'help.admin.projectSettingsDesc',
        ['help.admin.projectStep1', 'help.admin.projectStep2', 'help.admin.projectStep3'],
        Settings,
        'text-amber-600 dark:text-amber-400',
        'bg-amber-50 dark:bg-amber-900/40',
        { titleTarget: adminGo('admin#project-settings#project', HELP_HL.project) }
      ),
      renderChecklistSection(
        'help.admin.features',
        'help.admin.featuresDesc',
        [
          'help.admin.featuresStep1', 'help.admin.featuresStep2',
          'help.admin.featuresStep3', 'help.admin.featuresStep4',
        ],
        Eye,
        'text-cyan-600 dark:text-cyan-400',
        'bg-cyan-50 dark:bg-cyan-900/40',
        { titleTarget: adminGo('admin#project-settings#features', HELP_HL.features) }
      ),
      renderChecklistSection(
        'help.admin.sprintSettings',
        'help.admin.sprintSettingsDesc',
        [
          'help.admin.sprintStep1', 'help.admin.sprintStep2',
          'help.admin.sprintStep3', 'help.admin.sprintStep4',
        ],
        Calendar,
        'text-blue-600 dark:text-blue-400',
        'bg-blue-50 dark:bg-blue-900/40',
        { titleTarget: adminGo('admin#project-settings#sprint-settings', HELP_HL.sprints) }
      ),
      renderChecklistSection(
        'help.admin.reporting',
        'help.admin.reportingDesc',
        [
          'help.admin.reportingStep1', 'help.admin.reportingStep2',
          'help.admin.reportingStep3', 'help.admin.reportingNote',
        ],
        BarChart3,
        'text-purple-600 dark:text-purple-400',
        'bg-purple-50 dark:bg-purple-900/40',
        { titleTarget: adminGo('admin#project-settings#reporting', HELP_HL.reporting) }
      ),
      renderChecklistSection(
        'help.admin.lifecycle',
        'help.admin.lifecycleDesc',
        [
          'help.admin.lifecycleStep1', 'help.admin.lifecycleStep2',
          'help.admin.lifecycleStep3', 'help.admin.lifecycleStep4',
        ],
        Trash2,
        'text-amber-600 dark:text-amber-400',
        'bg-amber-50 dark:bg-amber-900/40',
        { titleTarget: adminGo('admin#project-settings#lifecycle', HELP_HL.lifecycle) }
      ),
      renderSectionWithList(
        'help.admin.licensing',
        ['help.admin.licensingDesc'],
        ['help.admin.licensingTip1', 'help.admin.licensingTip2', 'help.admin.licensingTip3'],
        Shield,
        'text-emerald-600 dark:text-emerald-400',
        'bg-emerald-50 dark:bg-emerald-900/40',
        adminGo('admin#licensing', HELP_HL.licensing)
      ),
    ].filter(Boolean);

    return <div className="space-y-5">{sections}</div>;
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'delivery':
        return isAdmin ? renderDeliveryTab() : renderOverviewTab();
      case 'shortcuts':
        return renderShortcutsTab();
      case 'kanban':
        return renderKanbanTab();
      case 'list':
        return renderListTab();
      case 'gantt':
        return renderGanttTab();
      case 'reports':
        return renderReportsTab();
      case 'ai':
        return aiEnabled ? renderAiTab() : renderOverviewTab();
      case 'admin':
        return renderAdminTab();
      default:
        return renderOverviewTab();
    }
  };

  // Check which tabs have matches for highlighting
  const getTabMatches = useCallback((tabId: TabType): boolean => {
    if (!debouncedSearchTerm.trim()) return false;
    
    // Get all translation keys for this tab
    const tabKeys: string[] = [];
    switch (tabId) {
      case 'overview':
        tabKeys.push('help.overview.whatIsEasyKanban', 'help.overview.whatIsEasyKanbanDesc1', 'help.overview.whatIsEasyKanbanDesc2',
          'help.overview.navigation', 'help.overview.viewModes', 'help.overview.searchFilter',
          'help.overview.userProfile', 'help.overview.activityFeed', 'help.overview.sprints',
          'help.overview.sprintsDesc1', 'help.overview.sprintsDesc2', 'help.overview.sprintFilter', 'help.overview.teamManagement',
          'help.overview.teamMembers', 'help.overview.memberSelection', 'help.overview.clearButton', 'help.overview.roleBasedFiltering',
          'help.overview.assignees', 'help.overview.watchers', 'help.overview.collaborators', 'help.overview.requesters',
          'help.overview.tools',
          'help.overview.multiSelectTools', 'help.overview.taskViewModes', 'help.overview.activityFeedTools',
          'help.overview.realtimeCollaboration', 'help.overview.keyboardShortcuts');
        if (isAdmin) {
          tabKeys.push('help.overview.boardSelectorAdmin', 'help.overview.boardTrash', 'help.overview.adminPanel', 'help.overview.system', 'help.overview.deliveryPlaybook');
        } else {
          tabKeys.push('help.overview.boardSelector', 'help.overview.taskTrash');
        }
        break;
      case 'delivery':
        if (isAdmin) {
          tabKeys.push(...HELP_DELIVERY_KEYS);
        }
        break;
      case 'shortcuts':
        tabKeys.push(
          'help.shortcuts.title',
          'help.shortcuts.note',
          'help.shortcuts.colKeys',
          'help.shortcuts.colAction',
          ...HELP_SHORTCUT_SECTIONS.flatMap((section) => [
            section.titleKey,
            ...section.rows.map((row) => row.actionKey),
          ])
        );
        break;
      case 'kanban':
        tabKeys.push('help.kanban.overview', 'help.kanban.overviewDesc1', 'help.kanban.overviewDesc2', 'help.kanban.overviewDesc3',
          'help.kanban.taskManagement', 'help.kanban.createTasks', 'help.kanban.editTasks', 'help.kanban.editTasksSprint',
          'help.kanban.editTasksQuick', 'help.kanban.editTasksDates', 'help.kanban.editTasksAssignee', 'help.kanban.editTasksPriority',
          'help.kanban.taskDetailsClick', 'help.kanban.moveTasks', 'help.kanban.reorderTasks', 'help.kanban.copyTasks',
          'help.kanban.taskToolbar', 'help.kanban.multiSelect', 'help.kanban.multiSelectDesc1',
          'help.kanban.multiSelectDesc2', 'help.kanban.multiSelectDesc3', 'help.kanban.flowAids', 'help.kanban.flowAidsWip',
          'help.kanban.flowAidsAging', 'help.kanban.flowAidsBlocked', 'help.kanban.flowAidsPolicy', 'help.kanban.dragDrop',
          'help.kanban.crossColumnMovement', 'help.kanban.crossBoardMovement', 'help.kanban.withinColumnReordering',
          'help.kanban.visualFeedback', 'help.kanban.autoSave', 'help.kanban.taskDetailsComm',
          'help.kanban.taskInformation', 'help.kanban.comments', 'help.kanban.attachments', 'help.kanban.priorityLevels',
          'help.kanban.tags', 'help.kanban.watchers', 'help.kanban.collaborators', 'help.kanban.taskRelationships');
        tabKeys.push(isAdmin ? 'help.kanban.deleteTasksAdmin' : 'help.kanban.deleteTasks');
        if (isAdmin) {
          tabKeys.push(
            'help.kanban.columnManagement', 'help.kanban.createColumns', 'help.kanban.renameColumns', 'help.kanban.reorderColumns',
            'help.kanban.deleteColumns', 'help.kanban.finishedColumns', 'help.kanban.columnWipPolicy', 'help.kanban.boardWipTip',
            'help.kanban.createAndEdit', 'help.kanban.moveAndOrganize'
          );
        }
        break;
      case 'list':
        tabKeys.push('help.list.overview', 'help.list.overviewDesc1', 'help.list.overviewDesc2', 'help.list.overviewDesc3',
          'help.list.columnConfiguration', 'help.list.showHideColumns', 'help.list.defaultColumns', 'help.list.columnPersistence',
          'help.list.horizontalScrolling', 'help.list.sortingFiltering', 'help.list.sortByColumn', 'help.list.multiLevelSorting',
          'help.list.searchIntegration', 'help.list.savedFilters', 'help.list.advancedFiltering', 'help.list.taskActions',
          'help.list.statusChanges', 'help.list.directEditing', 'help.list.taskDetails',
          'help.list.dataDisplay', 'help.list.richText', 'help.list.dateFormatting', 'help.list.priorityIndicators',
          'help.list.memberAvatars', 'help.list.tagDisplay', 'help.list.commentCounts', 'help.list.statusIndicators');
        tabKeys.push(isAdmin ? 'help.list.quickActionsAdmin' : 'help.list.quickActions');
        if (isAdmin) {
          tabKeys.push('help.list.export', 'help.list.exportDesc', 'help.list.exportFormats', 'help.list.exportScopes',
            'help.list.exportFields', 'help.list.exportExcel');
        }
        break;
      case 'gantt':
        tabKeys.push('help.gantt.overview', 'help.gantt.overviewDesc1', 'help.gantt.overviewDesc2', 'help.gantt.overviewDesc3',
          'help.gantt.timelineNavigation', 'help.gantt.scrollNavigation', 'help.gantt.todayButton', 'help.gantt.taskNavigation',
          'help.gantt.relationshipMode', 'help.gantt.taskManagement', 'help.gantt.createTasks', 'help.gantt.editTasks',
          'help.gantt.resizeTasks', 'help.gantt.moveTasks', 'help.gantt.copyTasks',
          'help.gantt.dependencies', 'help.gantt.createDependencies', 'help.gantt.dependencyTypes',
          'help.gantt.visualArrows', 'help.gantt.cycleDetection', 'help.gantt.taskRelationships', 'help.gantt.timelineFeatures',
          'help.gantt.timelineNavigationDesc', 'help.gantt.todayIndicator', 'help.gantt.lateBadge', 'help.gantt.columnOrganization',
          'help.gantt.realtimeUpdatesTimeline', 'help.gantt.performance', 'help.gantt.virtualScrolling', 'help.gantt.lazyLoading',
          'help.gantt.realtimeUpdates', 'help.gantt.keyboardShortcuts', 'help.gantt.performanceMonitoring');
        tabKeys.push(isAdmin ? 'help.gantt.deleteTasksAdmin' : 'help.gantt.deleteTasks');
        break;
      case 'reports':
        tabKeys.push('help.reports.overview', 'help.reports.overviewDesc', 'help.reports.myStats', 'help.reports.myStatsDesc',
          'help.reports.leaderboard', 'help.reports.leaderboardDesc', 'help.reports.burndown', 'help.reports.burndownDesc',
          'help.reports.teamPerformance', 'help.reports.teamPerformanceDesc', 'help.reports.taskList', 'help.reports.taskListDesc');
        break;
      case 'ai':
        if (aiEnabled) {
          for (const key of HELP_AI_KEYS) {
            if (!isAdmin && (key.startsWith('help.ai.admin') || key.startsWith('help.ai.auto') || key === 'help.ai.automationDesc')) {
              continue;
            }
            tabKeys.push(key);
          }
        }
        break;
      case 'admin':
        if (isAdmin) {
          tabKeys.push(...HELP_ADMIN_KEYS);
          if (troubleshootingVisible) {
            tabKeys.push(...HELP_ADMIN_TROUBLESHOOTING_KEYS);
          }
        }
        break;
    }
    
    const tabTexts = tabKeys.map(key => t(key));
    if (tabId === 'shortcuts') {
      for (const section of HELP_SHORTCUT_SECTIONS) {
        for (const row of section.rows) {
          tabTexts.push(row.keys);
        }
      }
    }
    return anyTextMatches(tabTexts, debouncedSearchTerm);
  }, [t, debouncedSearchTerm, anyTextMatches, isAdmin, aiEnabled, troubleshootingVisible]);

  if (minimized) {
    const activeTabMeta = tabs.find((tab) => tab.id === activeTab);
    const ActiveIcon = activeTabMeta?.icon || ClipboardList;
    const showDockedChat = aiEnabled && assistantOpen;
    const dockHeader = (
      <>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMinimized(false);
            }
          }}
          className="w-full flex items-center justify-between gap-3 px-4 pb-2 text-left"
          aria-label={t('help.expand')}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
            {showDockedChat ? <Bot size={18} aria-hidden /> : <ActiveIcon size={18} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {showDockedChat ? <HelpAssistantTitle /> : t('help.minimizedTitle')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {showDockedChat ? t('help.minimizedTitle') : activeTabMeta?.label}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
            aria-label={t('help.close')}
          >
            <X size={16} />
          </button>
          <ChevronUp
            size={18}
            className="text-blue-600 dark:text-blue-400 flex-shrink-0"
            aria-hidden
          />
        </div>
      </>
    );

    if (showDockedChat) {
      return (
        <HelpAssistantShell
          variant="dock"
          positionX={assistantPositionX}
          height={assistantHeight}
          onPositionXChange={setAssistantPositionX}
          onHeightChange={setAssistantHeight}
          onHeaderActivate={() => setMinimized(false)}
          header={dockHeader}
        >
          <HelpAssistantChat
            compact
            isAdmin={isAdmin}
            language={currentLanguage}
            messages={assistantMessages}
            onMessagesChange={setAssistantMessages}
            onGoThere={goThere}
          />
        </HelpAssistantShell>
      );
    }

    return (
      <div className="fixed bottom-4 right-4 z-[10040] w-[min(33vw,20rem)] max-w-[33vw]">
        <div className="rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
          {dockHeader}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10030] flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-3 sm:p-6">
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-gray-700 w-full max-w-6xl h-[min(90vh,920px)] flex flex-col overflow-hidden relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <div className="relative flex items-center justify-between gap-3 px-4 py-3 sm:px-5 border-b border-slate-200/80 dark:border-gray-700 bg-gradient-to-r from-blue-50 via-white to-indigo-50 dark:from-gray-800 dark:via-gray-800 dark:to-slate-900">
          <div className="min-w-0 shrink flex items-center gap-2">
            <div className="min-w-0">
              <h2 id="help-modal-title" className="text-lg sm:text-xl font-bold text-slate-800 dark:text-gray-100 tracking-tight truncate">
                {t('help.title')}
              </h2>
              <p className="hidden md:block text-xs text-slate-500 dark:text-gray-400 mt-0.5 truncate">
                {t('help.pressF1')}
              </p>
            </div>
            {aiEnabled && (
              <button
                type="button"
                onClick={() => setAssistantOpen((open) => !open)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  assistantOpen
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-white/80 dark:hover:bg-gray-700'
                }`}
                aria-pressed={assistantOpen}
                aria-label={t('help.assistant.title')}
                title={t('help.assistant.title')}
              >
                <Bot size={18} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-nowrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={t('help.searchPlaceholder')}
                className="pl-8 pr-7 py-1.5 w-36 sm:w-48 lg:w-56 border border-slate-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 bg-white/90 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm shadow-sm"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                >
                  <X size={12} className="text-gray-400" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleLanguageToggle}
              className="px-2 py-1.5 text-xs font-semibold text-slate-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-gray-700 rounded-lg transition-colors border border-slate-200 dark:border-gray-600"
              title={currentLanguage === 'en' ? t('help.switchToFrench') : t('help.switchToEnglish')}
              aria-label={currentLanguage === 'en' ? t('help.switchToFrench') : t('help.switchToEnglish')}
            >
              {currentLanguage === 'en' ? 'FR' : 'EN'}
            </button>
            {ownerSetup?.isOwner && (
              <button
                type="button"
                onClick={handleOpenOwnerSetup}
                className="inline-flex items-center justify-center p-1.5 sm:px-2.5 sm:py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium text-sm shadow-sm"
                title={t('help.ownerSetup')}
                aria-label={t('help.ownerSetup')}
              >
                <ListChecks size={16} />
                <span className="hidden xl:inline ml-1.5">{t('help.ownerSetup')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleStartTour}
              className="inline-flex items-center justify-center p-1.5 sm:px-2.5 sm:py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-sm shadow-sm"
              title={t('help.startTutorial')}
              aria-label={t('help.startTutorial')}
            >
              <Play size={16} />
              <span className="hidden xl:inline ml-1.5">{t('help.startTutorial')}</span>
            </button>
            <button
              type="button"
              onClick={minimizeHelp}
              className="p-1.5 hover:bg-white/80 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label={t('help.minimize')}
              title={t('help.minimize')}
            >
              <Minus size={18} className="text-slate-500 dark:text-gray-400" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-white/80 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label={t('help.close')}
            >
              <X size={18} className="text-slate-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-200/80 dark:border-gray-700 bg-slate-50/90 dark:bg-gray-900/40 px-4 sm:px-6 py-2.5 overflow-x-auto">
          <nav className="flex gap-1 min-w-max p-1 rounded-xl bg-slate-200/50 dark:bg-gray-800/80">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const hasMatch = getTabMatches(tab.id);
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    persistHelpScroll();
                    setActiveTab(tab.id);
                  }}
                  className={`relative py-2 px-3 rounded-lg font-medium text-sm transition-all ${
                    isActive
                      ? 'bg-white dark:bg-gray-700 text-blue-700 dark:text-blue-300 shadow-sm'
                      : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-gray-700/60'
                  } ${
                    hasMatch && debouncedSearchTerm.trim() && !isActive
                      ? 'ring-2 ring-yellow-400/70'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={15} />
                    {tab.label}
                    {hasMatch && debouncedSearchTerm.trim() && (
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" aria-hidden />
                    )}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-1 min-h-0">
          <div
            ref={contentRef}
            onScroll={() => {
              if (contentRef.current) {
                savedScrollByTabRef.current[activeTab] = contentRef.current.scrollTop;
              }
            }}
            className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1 min-h-0 bg-slate-50/40 dark:bg-gray-900/20"
          >
            {renderTabContent()}
          </div>
        </div>
        {aiEnabled && assistantOpen && (
          <HelpAssistantShell
            variant="overlay"
            boundsEl={modalRef.current}
            positionX={null}
            height={HELP_ASSISTANT_OVERLAY_HEIGHT}
            onPositionXChange={() => {}}
            onHeightChange={() => {}}
            header={
              <div className="px-3 pt-3 pb-1 text-sm font-semibold text-slate-800 dark:text-gray-100">
                <HelpAssistantTitle />
              </div>
            }
          >
            <HelpAssistantChat
              language={currentLanguage}
              isAdmin={isAdmin}
              messages={assistantMessages}
              onMessagesChange={setAssistantMessages}
              onGoThere={goThere}
              onInteract={() => setAssistantOpen(true)}
            />
          </HelpAssistantShell>
        )}

        <div className="flex justify-between items-center gap-3 px-5 py-3.5 sm:px-6 border-t border-slate-200/80 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90">
          <span className="text-xs sm:text-sm text-slate-500 dark:text-gray-400 tabular-nums">
            {releaseDate
              ? t('help.versionLabelWithDate', {
                  version: versionDetection.getInitialVersion() || '0.9-beta',
                  date: releaseDate,
                })
              : t('help.versionLabel', { version: versionDetection.getInitialVersion() || '0.9-beta' })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={minimizeHelp}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-gray-200 rounded-xl border border-slate-200 dark:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('help.minimize')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm font-medium"
            >
              {t('help.gotIt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
