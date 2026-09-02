import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Trophy, TrendingUp, Users, List } from 'lucide-react';
import UserStatsReport from './reports/UserStatsReport';
import LeaderboardReport from './reports/LeaderboardReport';
import BurndownReport from './reports/BurndownReport';
import TeamPerformanceReport from './reports/TeamPerformanceReport';
import TaskListReport from './reports/TaskListReport';
import { REPORT_TABS, ROUTES } from '../constants';
import { loadUserPreferencesAsync, updateUserPreference } from '../utils/userPreferences';
import { useSettings } from '../contexts/SettingsContext';
import { getReportsSettings } from '../api';
import { feDebug } from '../utils/clientDebug';

type ReportTab = 'stats' | 'leaderboard' | 'burndown' | 'team' | 'tasks';

interface ReportSettings {
  REPORTS_ENABLED: string;
  REPORTS_GAMIFICATION_ENABLED: string;
  REPORTS_LEADERBOARD_ENABLED: string;
  REPORTS_ACHIEVEMENTS_ENABLED: string;
  REPORTS_VISIBLE_TO: string;
}

interface ReportsProps {
  currentUser?: { id?: string; roles?: string[] };
}

const Reports: React.FC<ReportsProps> = ({ currentUser }) => {
  const { t } = useTranslation('common');
  const { systemSettings } = useSettings(); // Use SettingsContext for reports settings
  const [activeTab, setActiveTab] = useState<ReportTab>(() => {
    // Priority 1: Get tab from URL hash
    const fullHash = window.location.hash;
    const hashParts = fullHash.split('#');
    const tabHash = hashParts[hashParts.length - 1];
    
    if (REPORT_TABS.includes(tabHash)) {
      return tabHash as ReportTab;
    }
    
    // Priority 2: Will be loaded from user preferences in useEffect
    // Priority 3: Default tab
    return ROUTES.DEFAULT_REPORT_TAB as ReportTab;
  });
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  
  // Persistent filter state for each report tab
  const [reportFilters, setReportFilters] = useState<{ [key: string]: any }>(() => {
    try {
      const saved = localStorage.getItem('reportFilters');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Load settings from SettingsContext (for admins) or fetch from API (for non-admins)
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // If user is admin, settings should already be in systemSettings from SettingsContext
        const isAdmin = currentUser?.roles?.includes('admin');
        
        if (isAdmin && systemSettings && Object.keys(systemSettings).length > 0) {
          // Extract reports settings from systemSettings
          const reportsSettings: Partial<ReportSettings> = {};
          Object.keys(systemSettings).forEach(key => {
            if (key.startsWith('REPORTS_')) {
              reportsSettings[key as keyof ReportSettings] = systemSettings[key] as string;
            }
          });
          
          // Only use if we found reports settings
          if (Object.keys(reportsSettings).length > 0) {
            const newSettings = {
              REPORTS_ENABLED: reportsSettings.REPORTS_ENABLED || 'true',
              REPORTS_GAMIFICATION_ENABLED: reportsSettings.REPORTS_GAMIFICATION_ENABLED || 'true',
              REPORTS_LEADERBOARD_ENABLED: reportsSettings.REPORTS_LEADERBOARD_ENABLED || 'true',
              REPORTS_ACHIEVEMENTS_ENABLED: reportsSettings.REPORTS_ACHIEVEMENTS_ENABLED || 'true',
              REPORTS_VISIBLE_TO: reportsSettings.REPORTS_VISIBLE_TO || 'all',
            };
            if (feDebug('FE_DEBUG_REPORTS_UI')) console.log('📊 Reports Settings from SettingsContext:', newSettings);
            setSettings(newSettings);
            setLoading(false);
            return;
          }
        }
        
        // Fallback: Fetch from API (for non-admins or if SettingsContext doesn't have reports settings)
        // Use cached API function to prevent duplicate calls with Header component
        const data = await getReportsSettings();
        
        const newSettings = {
          REPORTS_ENABLED: data.REPORTS_ENABLED || 'true',
          REPORTS_GAMIFICATION_ENABLED: data.REPORTS_GAMIFICATION_ENABLED || 'true',
          REPORTS_LEADERBOARD_ENABLED: data.REPORTS_LEADERBOARD_ENABLED || 'true',
          REPORTS_ACHIEVEMENTS_ENABLED: data.REPORTS_ACHIEVEMENTS_ENABLED || 'true',
          REPORTS_VISIBLE_TO: data.REPORTS_VISIBLE_TO || 'all',
        };
        console.log('📊 Reports Settings from API:', newSettings);
        setSettings(newSettings);
      } catch (error) {
        console.error('Failed to fetch report settings:', error);
        // Default to all enabled on error
        setSettings({
          REPORTS_ENABLED: 'true',
          REPORTS_GAMIFICATION_ENABLED: 'true',
          REPORTS_LEADERBOARD_ENABLED: 'true',
          REPORTS_ACHIEVEMENTS_ENABLED: 'true',
          REPORTS_VISIBLE_TO: 'all',
        });
      } finally {
        setLoading(false);
      }
    };
    
    loadSettings();
  }, [systemSettings, currentUser?.roles]);

  // Load last accessed report tab from user preferences (database-stored)
  useEffect(() => {
    const loadLastReportTab = async () => {
      if (!currentUser?.id) {
        setPreferencesLoaded(true);
        return;
      }

      try {
        const preferences = await loadUserPreferencesAsync(currentUser.id);
        
        // Only use saved tab if no URL hash is present
        const fullHash = window.location.hash;
        const hashParts = fullHash.split('#');
        const tabHash = hashParts[hashParts.length - 1];
        
        if (!REPORT_TABS.includes(tabHash) && preferences.lastReportTab && REPORT_TABS.includes(preferences.lastReportTab)) {
          setActiveTab(preferences.lastReportTab as ReportTab);
        }
      } catch (error) {
        console.error('Failed to load last report tab:', error);
      } finally {
        setPreferencesLoaded(true);
      }
    };

    loadLastReportTab();
  }, [currentUser?.id]);

  // Save filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('reportFilters', JSON.stringify(reportFilters));
    } catch (error) {
      console.error('Failed to save report filters:', error);
    }
  }, [reportFilters]);

  // Handle URL hash changes for tab selection
  useEffect(() => {
    const handleHashChange = async () => {
      const fullHash = window.location.hash;
      const hashParts = fullHash.split('#');
      const tabHash = hashParts[hashParts.length - 1];
      
      if (REPORT_TABS.includes(tabHash) && tabHash !== activeTab) {
        setActiveTab(tabHash as ReportTab);
        
        // Save to database-stored user preferences
        if (currentUser?.id) {
          try {
            await updateUserPreference('lastReportTab', tabHash, currentUser.id);
          } catch (error) {
            console.error('Failed to save last report tab:', error);
          }
        }
      }
    };

    // Handle initial hash on component mount
    const fullHash = window.location.hash;
    const hashParts = fullHash.split('#');
    const tabHash = hashParts[hashParts.length - 1];
    
    if (REPORT_TABS.includes(tabHash) && tabHash !== activeTab) {
      setActiveTab(tabHash as ReportTab);
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeTab, currentUser?.id]);

  // Listen for real-time settings updates via WebSocket
  useEffect(() => {
    const handleSettingsUpdate = (data: any) => {
      console.log('📊 [Reports] Settings updated via WebSocket:', data);
      
      // If any REPORTS_* setting was updated, update local settings state
      if (data.key && data.key.startsWith('REPORTS_')) {
        console.log(`📊 [Reports] Updating setting ${data.key} to ${data.value}`);
        setSettings(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            [data.key]: data.value
          };
        });
      }
    };

    // Import websocket client and listen for settings updates
    import('../services/websocketClient').then(({ default: websocketClient }) => {
      websocketClient.onSettingsUpdated(handleSettingsUpdate);
      
      return () => {
        websocketClient.offSettingsUpdated(handleSettingsUpdate);
      };
    });
  }, []); // Empty deps - this listener is stable


  // Helper function to update filters for a specific report
  const updateReportFilters = useCallback((reportId: string, filters: any) => {
    setReportFilters(prev => {
      // Only update if filters actually changed
      if (JSON.stringify(prev[reportId]) === JSON.stringify(filters)) {
        return prev;
      }
      return {
        ...prev,
        [reportId]: filters
      };
    });
  }, []);

  // Helper function to get filters for a specific report
  const getReportFilters = (reportId: string) => {
    return reportFilters[reportId] || {};
  };

  const tabsRef = useRef<HTMLDivElement>(null);
  const pinTabsOnNextTabChangeRef = useRef(false);

  // Handle tab change with URL update and save to user preferences
  const handleTabChange = async (tab: ReportTab) => {
    if (tab === activeTab) return;

    // If the page title has already scrolled away, keep tabs pinned under the app
    // header after switch so a shorter tab doesn't "jump" back to the title.
    const stickyOffset = 56; // top-14
    const tabsEl = tabsRef.current;
    if (tabsEl) {
      const pinY = tabsEl.getBoundingClientRect().top + window.scrollY - stickyOffset;
      pinTabsOnNextTabChangeRef.current = window.scrollY > pinY + 1;
    }

    setActiveTab(tab);
    // Update URL hash for tab persistence
    window.location.hash = `reports#${tab}`;
    
    // Save to database-stored user preferences (persists across logout/login)
    if (currentUser?.id) {
      try {
        await updateUserPreference('lastReportTab', tab, currentUser.id);
      } catch (error) {
        console.error('Failed to save last report tab:', error);
      }
    }
  };

  useLayoutEffect(() => {
    if (!pinTabsOnNextTabChangeRef.current) return;
    pinTabsOnNextTabChangeRef.current = false;
    const tabsEl = tabsRef.current;
    if (!tabsEl) return;
    const stickyOffset = 56; // top-14
    const pinY = Math.max(0, tabsEl.getBoundingClientRect().top + window.scrollY - stickyOffset);
    window.scrollTo({ top: pinY, behavior: 'auto' });
  }, [activeTab]);

  // EARLY RETURN: Check if reports are disabled BEFORE any tab logic
  if (!loading && settings?.REPORTS_ENABLED === 'false') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md px-6">
          <BarChart3 className="w-20 h-20 text-gray-400 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            {t('reports.accessDenied')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            {t('reports.moduleDisabled')}
          </p>
          <button
            onClick={() => window.location.hash = 'kanban'}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('reports.goBackHome')}
          </button>
        </div>
      </div>
    );
  }

  // Check visibility permissions (admin-only vs all users)
  const isAdmin = currentUser?.roles?.includes('admin');
  if (!loading && settings?.REPORTS_VISIBLE_TO === 'admin' && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md px-6">
          <BarChart3 className="w-20 h-20 text-gray-400 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            {t('reports.accessDenied')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            {t('reports.restrictedToAdmins')}
          </p>
          <button
            onClick={() => window.location.hash = 'kanban'}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('reports.goBackHome')}
          </button>
        </div>
      </div>
    );
  }

  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Settings not loaded yet
  if (!settings) {
    return null;
  }

  // Only compute tabs if reports are enabled (we've already checked for disabled above)
  const gamificationEnabled = settings.REPORTS_GAMIFICATION_ENABLED === 'true';
  const allTabs = [
    // My Stats: Shows points - only visible if gamification enabled
    { id: 'stats' as ReportTab, label: t('reports.tabs.myStats'), icon: BarChart3, enabled: gamificationEnabled },
    // Leaderboard: Shows rankings - only visible if gamification AND leaderboard enabled
    { id: 'leaderboard' as ReportTab, label: t('reports.tabs.leaderboard'), icon: Trophy, enabled: gamificationEnabled && settings.REPORTS_LEADERBOARD_ENABLED === 'true' },
    // Non-gamification reports (always visible)
    { id: 'burndown' as ReportTab, label: t('reports.tabs.burndown'), icon: TrendingUp, enabled: true },
    { id: 'team' as ReportTab, label: t('reports.tabs.teamPerformance'), icon: Users, enabled: true },
    { id: 'tasks' as ReportTab, label: t('reports.tabs.taskList'), icon: List, enabled: true },
  ];

  const tabs = allTabs.filter(tab => tab.enabled);

  // If current tab is not available, use first available tab (prefer burndown if stats not available)
  const currentTab = tabs.some(tab => tab.id === activeTab) ? activeTab : (tabs[0]?.id || 'burndown');

  return (
    <div className="flex flex-col gap-4">
      {/* Title card — scrolls away */}
      <div className="reports-header bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 px-4 py-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('reports.title')}
        </h1>
      </div>

      {/* Tabs + content share a tall parent so sticky tabs work while scrolling.
          Negative margin pulls tabs closer to the title card. */}
      <div className="flex flex-col gap-4 -mt-3">
        <div
          ref={tabsRef}
          className="reports-tabs sticky top-14 z-40 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700"
          data-tour-id="reports-tabs"
        >
          <div className="flex gap-1 px-2 overflow-x-auto overflow-y-hidden">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`
                    flex items-center gap-2 px-4 py-3 font-medium text-sm whitespace-nowrap
                    border-b-2 transition-colors
                    ${
                      currentTab === tab.id
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Report Content — min-height keeps short tabs from collapsing scroll and revealing the title */}
        <div className="min-h-[calc(100vh-8.5rem)]">
          {currentTab === 'stats' && <UserStatsReport gamificationEnabled={settings?.REPORTS_GAMIFICATION_ENABLED === 'true'} achievementsEnabled={settings?.REPORTS_ACHIEVEMENTS_ENABLED === 'true'} />}
          {currentTab === 'leaderboard' && <LeaderboardReport />}
          {currentTab === 'burndown' && (
            <BurndownReport 
              initialFilters={getReportFilters('burndown')}
              onFiltersChange={(filters) => updateReportFilters('burndown', filters)}
            />
          )}
          {currentTab === 'team' && (
            <TeamPerformanceReport 
              initialFilters={getReportFilters('team')}
              onFiltersChange={(filters) => updateReportFilters('team', filters)}
            />
          )}
          {currentTab === 'tasks' && (
            <TaskListReport 
              initialFilters={getReportFilters('tasks')}
              onFiltersChange={(filters) => updateReportFilters('tasks', filters)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Reports;


