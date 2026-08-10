import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Users, Columns, ClipboardList, MessageSquare, ArrowRight, LayoutGrid, List, Calendar, Search, Eye, Settings, Play, BarChart3, Shield, Download, Bot, KeyRound, CheckSquare, AlertTriangle, Trash2, ListChecks, Keyboard } from 'lucide-react';
import { useTour } from '../contexts/TourContext';
import { useOwnerSetupOptional } from '../contexts/OwnerSetupContext';
import { useSettings } from '../contexts/SettingsContext';
import { versionDetection } from '../utils/versionDetection';
import { updateUserPreference } from '../utils/userPreferences';
import { CurrentUser } from '../types';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: CurrentUser | null;
}

type TabType = 'overview' | 'shortcuts' | 'kanban' | 'list' | 'gantt' | 'reports' | 'ai' | 'admin';

const HELP_TAB_IDS = new Set<TabType>([
  'overview', 'shortcuts', 'kanban', 'list', 'gantt', 'reports', 'ai', 'admin',
]);

/** [[tab:shortcuts]]Shortcuts tab[[/tab]] → in-modal link that switches Help tabs */
const HELP_TAB_LINK_RE = /\[\[tab:([a-z]+)\]\]([\s\S]*?)\[\[\/tab\]\]/g;

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

export default function HelpModal({ isOpen, onClose, currentUser }: HelpModalProps) {
  const { t, i18n } = useTranslation('common');
  const { siteSettings, systemSettings } = useSettings();
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const firstMatchRef = useRef<HTMLElement | null>(null);
  const { startTour } = useTour();
  const ownerSetup = useOwnerSetupOptional();
  
  // Check if user is admin
  const isAdmin = currentUser?.roles?.includes('admin') || false;
  const aiEnabled =
    siteSettings?.AI_ENABLED === 'true' || systemSettings?.AI_ENABLED === 'true';

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
    return text.replace(/\[\[tab:([a-z]+)\]\]([\s\S]*?)\[\[\/tab\]\]/g, '$2');
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

  const goToHelpTab = useCallback((tabId: TabType) => {
    if (tabId === 'ai' && !aiEnabled) return;
    if (tabId === 'admin' && !isAdmin) return;
    setActiveTab(tabId);
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [aiEnabled, isAdmin]);

  const renderHelpContent = useCallback((text: string, searchTerm: string): React.ReactNode => {
    if (!text) return text;
    if (!text.includes('[[tab:')) {
      return highlightText(text, searchTerm);
    }

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    const re = new RegExp(HELP_TAB_LINK_RE.source, 'g');
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

      const tabId = match[1] as TabType;
      const label = match[2];
      const isValidTab = HELP_TAB_IDS.has(tabId);
      const isAvailable =
        isValidTab &&
        !(tabId === 'ai' && !aiEnabled) &&
        !(tabId === 'admin' && !isAdmin);

      if (isAvailable) {
        nodes.push(
          <button
            key={key++}
            type="button"
            onClick={() => goToHelpTab(tabId)}
            className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            {highlightText(label, searchTerm)}
          </button>
        );
      } else {
        nodes.push(
          <React.Fragment key={key++}>
            {highlightText(label, searchTerm)}
          </React.Fragment>
        );
      }

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
  }, [highlightText, goToHelpTab, aiEnabled, isAdmin]);

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

  // Handle click outside to close modal
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEscapeDismiss(onClose, { enabled: isOpen });

  if (!isOpen) return null;

  const tabs = [
    { id: 'overview' as TabType, label: t('help.tabs.overview'), icon: LayoutGrid },
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
    iconColor: string
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
      <section
        ref={sectionRef}
        className={hasMatch && debouncedSearchTerm.trim() ? 'bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 border-2 border-yellow-400 dark:border-yellow-600 shadow-md' : ''}
      >
        <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
          {React.createElement(icon, { className: iconColor, size: 20 })}
          {highlightText(title, debouncedSearchTerm)}
        </h3>
        <div className="space-y-3 text-gray-600 dark:text-gray-300">
          {contents.map((content, index) => (
            <p key={index}>{renderHelpContent(content, debouncedSearchTerm)}</p>
          ))}
        </div>
      </section>
    );
  }, [t, debouncedSearchTerm, highlightText, renderHelpContent, anyTextMatches]);

  // Helper to render a section with list items
  const renderSectionWithList = useCallback((
    titleKey: string,
    contentKeys: string[],
    listKeys: string[],
    icon: any, // Lucide icon type
    iconColor: string
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
      <section
        ref={sectionRef}
        className={hasMatch && debouncedSearchTerm.trim() ? 'bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 border-2 border-yellow-400 dark:border-yellow-600 shadow-md' : ''}
      >
        <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
          {React.createElement(icon, { className: iconColor, size: 20 })}
          {highlightText(title, debouncedSearchTerm)}
        </h3>
        <div className="space-y-3 text-gray-600 dark:text-gray-300">
          {contents.map((content, index) => (
            <p key={index}>{renderHelpContent(content, debouncedSearchTerm)}</p>
          ))}
          {listKeys.length > 0 && (
            <ul className="ml-4 space-y-1 text-gray-600 dark:text-gray-300">
              {listItems.map((item, index) => (
                <li key={index}>{renderHelpContent(item, debouncedSearchTerm)}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }, [t, debouncedSearchTerm, highlightText, renderHelpContent, anyTextMatches]);

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
        'text-blue-500'
      ),
      renderSection(
        'help.overview.navigation',
        navigationKeys,
        ArrowRight,
        'text-green-500'
      ),
      renderSection(
        'help.overview.sprints',
        ['help.overview.sprintsDesc1', 'help.overview.sprintsDesc2', 'help.overview.sprintFilter'],
        Calendar,
        'text-blue-500'
      ),
      renderSectionWithList(
        'help.overview.teamManagement',
        ['help.overview.teamMembers', 'help.overview.memberSelection', 'help.overview.clearButton', 'help.overview.roleBasedFiltering'],
        roleListKeys,
        Users,
        'text-purple-500'
      ),
      renderSection(
        'help.overview.tools',
        ['help.overview.views', 'help.overview.searchFilterTools', 'help.overview.multiSelectTools', 'help.overview.taskViewModes', 'help.overview.activityFeedTools', 'help.overview.userProfileTools', 'help.overview.realtimeCollaboration', 'help.overview.keyboardShortcuts'],
        Settings,
        'text-orange-500'
      ),
    ].filter(Boolean);

    return <div className="space-y-8">{sections}</div>;
  };

  const renderShortcutsTab = () => {
    const note = t('help.shortcuts.note');
    const noteMatch =
      debouncedSearchTerm.trim() && anyTextMatches([note, t('help.shortcuts.title')], debouncedSearchTerm);

    return (
      <div className="space-y-8">
        <section
          className={
            noteMatch
              ? 'bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 border-2 border-yellow-400 dark:border-yellow-600 shadow-md'
              : ''
          }
        >
          <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2 flex items-center gap-2">
            <Keyboard className="text-indigo-500" size={20} />
            {highlightText(t('help.shortcuts.title'), debouncedSearchTerm)}
          </h3>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
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
              className={
                hasMatch
                  ? 'bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 border-2 border-yellow-400 dark:border-yellow-600 shadow-md'
                  : ''
              }
            >
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">
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
        'text-blue-500'
      ),
      renderSection(
        'help.kanban.taskManagement',
        ['help.kanban.createTasks', 'help.kanban.editTasks', 'help.kanban.editTasksSprint', 'help.kanban.editTasksQuick', 'help.kanban.editTasksDates', 'help.kanban.editTasksAssignee', 'help.kanban.editTasksPriority', 'help.kanban.taskDetailsClick', 'help.kanban.moveTasks', 'help.kanban.reorderTasks', 'help.kanban.copyTasks', isAdmin ? 'help.kanban.deleteTasksAdmin' : 'help.kanban.deleteTasks', 'help.kanban.taskToolbar'],
        ClipboardList,
        'text-orange-500'
      ),
      renderSection(
        'help.kanban.multiSelect',
        ['help.kanban.multiSelectDesc1', 'help.kanban.multiSelectDesc2', 'help.kanban.multiSelectDesc3'],
        CheckSquare,
        'text-cyan-600'
      ),
      renderSection(
        'help.kanban.flowAids',
        ['help.kanban.flowAidsWip', 'help.kanban.flowAidsAging', 'help.kanban.flowAidsBlocked', 'help.kanban.flowAidsPolicy'],
        AlertTriangle,
        'text-amber-500'
      ),
      renderSection(
        'help.kanban.dragDrop',
        ['help.kanban.crossColumnMovement', 'help.kanban.crossBoardMovement', 'help.kanban.withinColumnReordering', 'help.kanban.visualFeedback', 'help.kanban.autoSave'],
        ArrowRight,
        'text-teal-500'
      ),
      renderSection(
        'help.kanban.taskDetailsComm',
        ['help.kanban.taskInformation', 'help.kanban.comments', 'help.kanban.attachments', 'help.kanban.priorityLevels', 'help.kanban.tags', 'help.kanban.watchers', 'help.kanban.collaborators', 'help.kanban.taskRelationships'],
        MessageSquare,
        'text-indigo-500'
      ),
      ...(isAdmin ? [renderSection(
        'help.kanban.columnManagement',
        ['help.kanban.createColumns', 'help.kanban.renameColumns', 'help.kanban.reorderColumns', 'help.kanban.deleteColumns', 'help.kanban.finishedColumns', 'help.kanban.columnWipPolicy'],
        Columns,
        'text-purple-500'
      )] : []),
    ].filter(Boolean);

    return <div className="space-y-8">{sections}</div>;
  };

  const renderListTab = () => {
    const sections = [
      renderSection(
        'help.list.overview',
        ['help.list.overviewDesc1', 'help.list.overviewDesc2', 'help.list.overviewDesc3'],
        List,
        'text-blue-500'
      ),
      renderSection(
        'help.list.columnConfiguration',
        ['help.list.showHideColumns', 'help.list.defaultColumns', 'help.list.columnPersistence', 'help.list.horizontalScrolling'],
        Settings,
        'text-purple-500'
      ),
      renderSection(
        'help.list.sortingFiltering',
        ['help.list.sortByColumn', 'help.list.multiLevelSorting', 'help.list.searchIntegration', 'help.list.savedFilters', 'help.list.advancedFiltering'],
        Search,
        'text-orange-500'
      ),
      renderSection(
        'help.list.taskActions',
        [isAdmin ? 'help.list.quickActionsAdmin' : 'help.list.quickActions', 'help.list.statusChanges', 'help.list.directEditing', 'help.list.taskDetails'],
        ClipboardList,
        'text-green-500'
      ),
      renderSection(
        'help.list.dataDisplay',
        ['help.list.richText', 'help.list.dateFormatting', 'help.list.priorityIndicators', 'help.list.memberAvatars', 'help.list.tagDisplay', 'help.list.commentCounts', 'help.list.statusIndicators'],
        Eye,
        'text-indigo-500'
      ),
      ...(isAdmin ? [renderSection(
        'help.list.export',
        ['help.list.exportDesc', 'help.list.exportFormats', 'help.list.exportScopes', 'help.list.exportFields', 'help.list.exportExcel'],
        Download,
        'text-green-500'
      )] : []),
    ].filter(Boolean);

    return <div className="space-y-8">{sections}</div>;
  };

  const renderGanttTab = () => {
    const sections = [
      renderSection(
        'help.gantt.overview',
        ['help.gantt.overviewDesc1', 'help.gantt.overviewDesc2', 'help.gantt.overviewDesc3'],
        Calendar,
        'text-blue-500'
      ),
      renderSection(
        'help.gantt.timelineNavigation',
        ['help.gantt.scrollNavigation', 'help.gantt.todayButton', 'help.gantt.taskNavigation', 'help.gantt.relationshipMode'],
        ArrowRight,
        'text-green-500'
      ),
      renderSection(
        'help.gantt.taskManagement',
        ['help.gantt.createTasks', 'help.gantt.editTasks', 'help.gantt.resizeTasks', 'help.gantt.moveTasks', 'help.gantt.reorderTasks', 'help.gantt.copyTasks', isAdmin ? 'help.gantt.deleteTasksAdmin' : 'help.gantt.deleteTasks'],
        ClipboardList,
        'text-orange-500'
      ),
      renderSection(
        'help.gantt.dependencies',
        ['help.gantt.createDependencies', 'help.gantt.dependencyTypes', 'help.gantt.visualArrows', 'help.gantt.cycleDetection', 'help.gantt.taskRelationships'],
        ArrowRight,
        'text-purple-500'
      ),
      renderSection(
        'help.gantt.timelineFeatures',
        ['help.gantt.timelineNavigationDesc', 'help.gantt.todayIndicator', 'help.gantt.lateBadge', 'help.gantt.columnOrganization', 'help.gantt.realtimeUpdatesTimeline'],
        Calendar,
        'text-indigo-500'
      ),
      renderSection(
        'help.gantt.performance',
        ['help.gantt.virtualScrolling', 'help.gantt.lazyLoading', 'help.gantt.realtimeUpdates', 'help.gantt.keyboardShortcuts', 'help.gantt.performanceMonitoring'],
        Settings,
        'text-green-500'
      ),
    ].filter(Boolean);

    return <div className="space-y-8">{sections}</div>;
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

    return <div className="space-y-8">{sections}</div>;
  };

  const renderAiTab = () => {
    const sections = [
      renderSection(
        'help.ai.overview',
        ['help.ai.overviewDesc1', 'help.ai.overviewDesc2'],
        Bot,
        'text-teal-600'
      ),
      renderSection(
        'help.ai.assigning',
        ['help.ai.assigningDesc1', 'help.ai.assigningDesc2', 'help.ai.assigningDesc3'],
        ClipboardList,
        'text-orange-500'
      ),
      renderSection(
        'help.ai.controlling',
        ['help.ai.controllingDesc1', 'help.ai.controllingDesc2', 'help.ai.controllingDesc3'],
        Play,
        'text-blue-500'
      ),
      renderSectionWithList(
        'help.ai.devCredentials',
        ['help.ai.devCredentialsDesc1'],
        [
          'help.ai.devCredentialsApiTokens',
          'help.ai.devCredentialsSsh',
          'help.ai.devCredentialsGithub',
          'help.ai.devCredentialsProbe'
        ],
        KeyRound,
        'text-purple-500'
      ),
      ...(isAdmin
        ? [
            renderSection(
              'help.ai.adminSettings',
              ['help.ai.adminSettingsDesc1', 'help.ai.adminSettingsDesc2'],
              Settings,
              'text-red-500'
            ),
            renderSection(
              'help.ai.automation',
              ['help.ai.automationDesc1', 'help.ai.automationDesc2'],
              Bot,
              'text-teal-700'
            )
          ]
        : []),
    ].filter(Boolean);

    return <div className="space-y-8">{sections}</div>;
  };

  const renderAdminTab = () => {
    const sections = [
      renderSection(
        'help.admin.overview',
        ['help.admin.overviewDesc'],
        Shield,
        'text-blue-500'
      ),
      renderSection(
        'help.admin.users',
        ['help.admin.usersDesc', 'help.admin.usersSystemUser', 'help.admin.usersOwnerUser'],
        Users,
        'text-purple-500'
      ),
      renderSection(
        'help.admin.siteSettings',
        ['help.admin.siteSettingsDesc', 'help.admin.siteSettingsUrl'],
        Settings,
        'text-orange-500'
      ),
      renderSection(
        'help.admin.sso',
        ['help.admin.ssoDesc', 'help.admin.ssoGoogleOnly'],
        Settings,
        'text-green-500'
      ),
      renderSection(
        'help.admin.mailServer',
        ['help.admin.mailServerDesc', 'help.admin.mailServerTesting'],
        Settings,
        'text-indigo-500'
      ),
      renderSection(
        'help.admin.tags',
        ['help.admin.tagsDesc'],
        Settings,
        'text-teal-500'
      ),
      renderSection(
        'help.admin.priorities',
        ['help.admin.prioritiesDesc', 'help.admin.prioritiesDefault'],
        Settings,
        'text-pink-500'
      ),
      renderSection(
        'help.admin.appSettings',
        ['help.admin.appSettingsDesc', 'help.admin.appSettingsLanguage'],
        Settings,
        'text-red-500'
      ),
      renderSection(
        'help.admin.projectSettings',
        ['help.admin.projectSettingsDesc', 'help.admin.projectSettingsIdentifiers'],
        Settings,
        'text-yellow-500'
      ),
      renderSection(
        'help.admin.sprintSettings',
        ['help.admin.sprintSettingsDesc', 'help.admin.sprintSettingsImportant'],
        Calendar,
        'text-blue-500'
      ),
      renderSection(
        'help.admin.reporting',
        ['help.admin.reportingDesc', 'help.admin.reportingGamification'],
        BarChart3,
        'text-purple-500'
      ),
      renderSection(
        'help.admin.lifecycle',
        ['help.admin.lifecycleDesc', 'help.admin.lifecycleRetention'],
        Trash2,
        'text-amber-600'
      ),
      renderSection(
        'help.admin.licensing',
        ['help.admin.licensingDesc'],
        Shield,
        'text-green-500'
      ),
    ].filter(Boolean);

    return <div className="space-y-8">{sections}</div>;
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
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
          'help.overview.tools', 'help.overview.views', 'help.overview.searchFilterTools',
          'help.overview.multiSelectTools', 'help.overview.taskViewModes', 'help.overview.activityFeedTools', 'help.overview.userProfileTools',
          'help.overview.realtimeCollaboration', 'help.overview.keyboardShortcuts');
        if (isAdmin) {
          tabKeys.push('help.overview.boardSelectorAdmin', 'help.overview.boardTrash', 'help.overview.adminPanel', 'help.overview.system');
        } else {
          tabKeys.push('help.overview.boardSelector', 'help.overview.taskTrash');
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
            'help.kanban.deleteColumns', 'help.kanban.finishedColumns', 'help.kanban.columnWipPolicy'
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
          'help.gantt.resizeTasks', 'help.gantt.moveTasks', 'help.gantt.reorderTasks', 'help.gantt.copyTasks',
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
          tabKeys.push(
            'help.ai.overview', 'help.ai.overviewDesc1', 'help.ai.overviewDesc2',
            'help.ai.assigning', 'help.ai.assigningDesc1', 'help.ai.assigningDesc2', 'help.ai.assigningDesc3',
            'help.ai.controlling', 'help.ai.controllingDesc1', 'help.ai.controllingDesc2', 'help.ai.controllingDesc3',
            'help.ai.devCredentials', 'help.ai.devCredentialsDesc1', 'help.ai.devCredentialsApiTokens',
            'help.ai.devCredentialsSsh', 'help.ai.devCredentialsGithub', 'help.ai.devCredentialsProbe'
          );
          if (isAdmin) {
            tabKeys.push(
              'help.ai.adminSettings',
              'help.ai.adminSettingsDesc1',
              'help.ai.adminSettingsDesc2',
              'help.ai.automation',
              'help.ai.automationDesc1',
              'help.ai.automationDesc2'
            );
          }
        }
        break;
      case 'admin':
        if (isAdmin) {
          tabKeys.push('help.admin.overview', 'help.admin.overviewDesc', 'help.admin.users', 'help.admin.usersDesc',
            'help.admin.siteSettings', 'help.admin.siteSettingsDesc', 'help.admin.sso', 'help.admin.ssoDesc',
            'help.admin.mailServer', 'help.admin.mailServerDesc', 'help.admin.tags', 'help.admin.tagsDesc',
            'help.admin.priorities', 'help.admin.prioritiesDesc', 'help.admin.appSettings', 'help.admin.appSettingsDesc',
            'help.admin.projectSettings', 'help.admin.projectSettingsDesc', 'help.admin.sprintSettings', 'help.admin.sprintSettingsDesc',
            'help.admin.reporting', 'help.admin.reportingDesc', 'help.admin.lifecycle', 'help.admin.lifecycleDesc',
            'help.admin.lifecycleRetention', 'help.admin.licensing', 'help.admin.licensingDesc');
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
  }, [t, debouncedSearchTerm, anyTextMatches, isAdmin, aiEnabled]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10030]">
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-4/5 max-w-6xl h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-6 border-b bg-white dark:bg-gray-800 sticky top-0 z-10">
          <div>
            <h2 id="help-modal-title" className="text-2xl font-bold text-gray-800 dark:text-gray-100">{t('help.title')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('help.pressF1')}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('help.searchPlaceholder')}
                className="pl-10 pr-4 py-2 w-64 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                >
                  <X size={14} className="text-gray-400" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleLanguageToggle}
              className="px-2.5 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500"
              title={currentLanguage === 'en' ? t('help.switchToFrench') : t('help.switchToEnglish')}
              aria-label={currentLanguage === 'en' ? t('help.switchToFrench') : t('help.switchToEnglish')}
            >
              {currentLanguage === 'en' ? 'FR' : 'EN'}
            </button>
            {ownerSetup?.isOwner && (
              <button
                type="button"
                onClick={handleOpenOwnerSetup}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium"
              >
                <ListChecks size={16} />
                {t('help.ownerSetup')}
              </button>
            )}
            <button
              onClick={handleStartTour}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors font-medium"
            >
              <Play size={16} />
              {t('help.startTutorial')}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <X size={24} className="text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b bg-gray-50 dark:bg-gray-700 px-6 overflow-x-auto">
          <nav className="flex space-x-6 min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const hasMatch = getTabMatches(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'
                  } ${
                    hasMatch && debouncedSearchTerm.trim() ? 'bg-yellow-100 dark:bg-yellow-900/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} />
                    {tab.label}
                    {hasMatch && debouncedSearchTerm.trim() && (
                      <span className="ml-1 w-2 h-2 bg-yellow-500 rounded-full" title="Has matches" />
                    )}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Scrollable Content */}
        <div ref={contentRef} className="p-6 space-y-8 overflow-y-auto flex-1 min-h-0">
          {renderTabContent()}
        </div>

        {/* Sticky Footer */}
        <div className="flex justify-between items-center p-6 border-t bg-gray-50 dark:bg-gray-700 sticky bottom-0">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Version {versionDetection.getInitialVersion() || '0.9-beta'}
          </span>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('help.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}