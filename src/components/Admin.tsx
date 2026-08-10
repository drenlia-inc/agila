import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { createUser, updateUser, deleteUser, getUserTaskCount, resendUserInvitation, getTags, createTag, updateTag, deleteTag, getTagUsage, getBatchTagUsage, getPriorities, createPriority, updatePriority, deletePriority, reorderPriorities, setDefaultPriority, getPriorityUsage, getBatchPriorityUsage, getLifecycleSummary } from '../api';
import { ADMIN_TABS, ROUTES } from '../constants';
import { toast } from '../utils/toast';
import AdminSiteSettingsTab from './admin/AdminSiteSettingsTab';
import AdminTagsTab from './admin/AdminTagsTab';
import AdminPrioritiesTab from './admin/AdminPrioritiesTab';
import AdminUsersTab from './admin/AdminUsersTab';
import AdminAppSettingsTab from './admin/AdminAppSettingsTab';
import AdminSystemSettingsTab from './admin/AdminSystemSettingsTab';
import AdminProjectHubTab from './admin/AdminProjectHubTab';
import AdminLicensingTab from './admin/AdminLicensingTab';
import AdminSettingsSearch from './admin/AdminSettingsSearch';
import { AdminUnsavedChangesBanner } from './admin/AdminUnsavedChanges';
import type { AdminDraftGate } from './admin/AdminLeaveUnsavedDialog';
import { AdminAttentionDot } from './admin/AdminFieldDraftControls';
import websocketClient from '../services/websocketClient';
import { LIFECYCLE_DATA_CHANGED_EVENT } from '../utils/boardTrashEvents';
import { useSettings } from '../contexts/SettingsContext';
import { isMaskedApiKeyDisplay } from '../utils/maskSecret';
import {
  adminSettingsHaveChanges,
  getDirtyAdminSettingsTabs,
  isLikelyDomEvent,
  isValidAdminSettingKey,
  settingValueAsString,
} from '../utils/adminSettingsDirty';
import { clampActivityFeedInSettings } from '../utils/adminFieldLimits';
import {
  ADMIN_NAVIGATE_EVENT,
  AdminNavigateDetail,
  adminHashForTabId,
  adminTabFromHash,
  canonicalizeAdminHash,
} from '../utils/adminNavigation';

interface AdminProps {
  currentUser: any;
  onUsersChanged?: () => void;
  onSettingsChanged?: () => void;
  /** Notify App when Admin has unsaved drafts (for leave-Admin prompt). */
  onDraftGateChange?: (gate: AdminDraftGate | null) => void;
  /** False while Admin is mounted-but-hidden (user on Kanban/Reports). */
  isPageActive?: boolean;
}

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
  avatarUrl?: string;
  authProvider?: string;
  googleAvatarUrl?: string;
  memberColor?: string;
}

interface Settings {
  SITE_NAME?: string;
  SITE_URL?: string;
  WEBSITE_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALLBACK_URL?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_SECURE?: string;
  MAIL_ENABLED?: string;
  TASK_DELETE_CONFIRM?: string;
}

// SystemInfo interface removed - Header.tsx handles all system info

const ADMIN_NAV_TABS = [
  'users',
  'site-settings',
  'system-settings',
  'tags',
  'priorities',
  'app-settings',
  'project-settings',
  'licensing',
] as const;

/** Keep visited tab panels mounted (hidden) so drafts survive tab switches. */
const AdminTabPanel: React.FC<{ active: boolean; children: React.ReactNode }> = ({
  active,
  children,
}) => (
  <div className={`min-w-0 ${active ? '' : 'hidden'}`} aria-hidden={!active}>
    {children}
  </div>
);

const Admin: React.FC<AdminProps> = ({
  currentUser,
  onUsersChanged,
  onSettingsChanged,
  onDraftGateChange,
  isPageActive = true,
}) => {
  const { t } = useTranslation('admin');
  const { systemSettings, refreshSettings, updateSiteSetting, updateSiteSettings } = useSettings(); // Use SettingsContext for admin settings
  const [activeTab, setActiveTab] = useState(() => {
    const tab = adminTabFromHash(window.location.hash);
    return tab && ADMIN_TABS.includes(tab) ? tab : ROUTES.DEFAULT_ADMIN_TAB;
  });
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  /** Prevents refreshSettings / WS context updates from re-running full loadData (unmounts modals). */
  const adminDataBootstrappedRef = useRef(false);
  // systemInfo removed - Header.tsx handles all system info polling and display
  const [showTestEmailModal, setShowTestEmailModal] = useState(false);
  const [showTestEmailErrorModal, setShowTestEmailErrorModal] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<any>(null);
  const [testEmailError, setTestEmailError] = useState<string>('');
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [editingSettings, setEditingSettings] = useState<Settings>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [userTaskCounts, setUserTaskCounts] = useState<{ [userId: string]: number }>({});
  const [showDeleteTagConfirm, setShowDeleteTagConfirm] = useState<number | null>(null);
  const [tagUsageCounts, setTagUsageCounts] = useState<{ [tagId: number]: number }>({});
  const [showDeletePriorityConfirm, setShowDeletePriorityConfirm] = useState<string | null>(null);
  const [priorityUsageCounts, setPriorityUsageCounts] = useState<{ [priorityId: string]: number }>({});
  const [hasDefaultAdmin, setHasDefaultAdmin] = useState<boolean | null>(null);
  const [tags, setTags] = useState<any[]>([]);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  /** Tabs mounted at least once — keep mounted to retain local drafts */
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([activeTab]));
  const [lifecyclePendingCount, setLifecyclePendingCount] = useState(0);

  const refreshLifecyclePending = useCallback(async () => {
    if (!currentUser?.roles?.includes('admin')) {
      setLifecyclePendingCount(0);
      return;
    }
    try {
      const summary = await getLifecycleSummary();
      setLifecyclePendingCount(
        (Number(summary.deletedTasks) || 0) + (Number(summary.deletedBoards) || 0)
      );
    } catch (err) {
      console.error('Failed to load lifecycle summary:', err);
    }
  }, [currentUser]);

  useEffect(() => {
    void refreshLifecyclePending();
  }, [refreshLifecyclePending]);

  // Admin stays mounted while on Kanban; refresh badge when returning
  useEffect(() => {
    if (isPageActive) void refreshLifecyclePending();
  }, [isPageActive, refreshLifecyclePending]);

  useEffect(() => {
    if (!currentUser?.roles?.includes('admin')) return;
    const refresh = () => {
      void refreshLifecyclePending();
    };
    websocketClient.onTaskDeleted(refresh);
    websocketClient.onTaskRestored(refresh);
    websocketClient.onTaskPurged(refresh);
    websocketClient.onBoardDeleted(refresh);
    websocketClient.onBoardRestored(refresh);
    window.addEventListener(LIFECYCLE_DATA_CHANGED_EVENT, refresh);
    return () => {
      websocketClient.offTaskDeleted(refresh);
      websocketClient.offTaskRestored(refresh);
      websocketClient.offTaskPurged(refresh);
      websocketClient.offBoardDeleted(refresh);
      websocketClient.offBoardRestored(refresh);
      window.removeEventListener(LIFECYCLE_DATA_CHANGED_EVENT, refresh);
    };
  }, [currentUser, refreshLifecyclePending]);

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    if (!currentUser?.roles?.includes('admin')) {
      adminDataBootstrappedRef.current = false;
      return;
    }
    fetchOwner();
    // Bootstrap Admin once when settings first arrive. Do NOT re-run on every
    // systemSettings reference change (quiet refresh / WebSocket) — that sets
    // loading=true and unmounts open modals (e.g. storage migration result).
    if (
      !adminDataBootstrappedRef.current &&
      systemSettings &&
      Object.keys(systemSettings).length > 0
    ) {
      adminDataBootstrappedRef.current = true;
      void loadData();
    }
  }, [currentUser, systemSettings]);

  const applySettingsPatch = useCallback(
    (patch: Record<string, string | undefined>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      setEditingSettings((prev) => ({ ...prev, ...patch }));
      updateSiteSettings(patch);
    },
    [updateSiteSettings]
  );

  // Fetch instance owner
  const fetchOwner = async () => {
    try {
      const response = await api.get('/admin/owner');
      setOwnerEmail(response.data.owner);
    } catch (err) {
      console.error('Failed to fetch owner:', err);
      setOwnerEmail(null);
    }
  };

  const applyAdminHash = useCallback((fullHash: string) => {
    const canonical = canonicalizeAdminHash(fullHash);
    const currentBare = window.location.hash.replace(/^#/, '');
    if (canonical !== currentBare) {
      // Rewrite legacy hashes without adding history noise when possible
      window.history.replaceState(null, '', `#${canonical}`);
    }
    const tab = adminTabFromHash(`#${canonical}`);
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [activeTab]);

  // Handle URL hash changes for tab selection
  useEffect(() => {
    const handleHashChange = () => {
      applyAdminHash(window.location.hash);
    };

    // Direct navigation from Configuration guide (bypasses missed hashchange races)
    const handleAdminNavigate = (event: Event) => {
      const detail = (event as CustomEvent<AdminNavigateDetail>).detail;
      if (!detail?.hash) return;
      applyAdminHash(`#${detail.hash.replace(/^#/, '')}`);
    };

    // Handle initial hash on component mount
    applyAdminHash(window.location.hash);

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener(ADMIN_NAVIGATE_EVENT, handleAdminNavigate);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener(ADMIN_NAVIGATE_EVENT, handleAdminNavigate);
    };
  }, [applyAdminHash]);

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!currentUser?.roles?.includes('admin')) return;

    // Tag management event handlers
    const handleTagCreated = async (data: any) => {
      try {
        const tags = await getTags();
        setTags(tags);
      } catch (error) {
        console.error('Failed to refresh tags after creation:', error);
      }
    };

    const handleTagUpdated = async (data: any) => {
      try {
        const tags = await getTags();
        setTags(tags);
      } catch (error) {
        console.error('Failed to refresh tags after update:', error);
      }
    };

    const handleTagDeleted = async (data: any) => {
      try {
        const tags = await getTags();
        setTags(tags);
      } catch (error) {
        console.error('Failed to refresh tags after deletion:', error);
      }
    };

    // Priority management event handlers
    const handlePriorityCreated = async (data: any) => {
      try {
        const priorities = await getPriorities();
        setPriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after creation:', error);
      }
    };

    const handlePriorityUpdated = async (data: any) => {
      try {
        const priorities = await getPriorities();
        setPriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after update:', error);
      }
    };

    const handlePriorityDeleted = async (data: any) => {
      // Just remove the deleted priority from the list - no need to refresh all priorities
      // The task-updated events will handle updating affected tasks with the new priority
      setPriorities(prevPriorities => 
        prevPriorities.filter(p => p.id !== data.priorityId && p.id !== Number(data.priorityId))
      );
    };

    const handlePriorityReordered = async (data: any) => {
      try {
        const priorities = await getPriorities();
        setPriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after reorder:', error);
      }
    };

    // Register WebSocket event listeners
    websocketClient.onTagCreated(handleTagCreated);
    websocketClient.onTagUpdated(handleTagUpdated);
    websocketClient.onTagDeleted(handleTagDeleted);
    websocketClient.onPriorityCreated(handlePriorityCreated);
    websocketClient.onPriorityUpdated(handlePriorityUpdated);
    websocketClient.onPriorityDeleted(handlePriorityDeleted);
    websocketClient.onPriorityReordered(handlePriorityReordered);

    // User management event handlers
    const handleUserCreated = async (data: any) => {
      try {
        const usersResponse = await api.get('/admin/users');
        setUsers(usersResponse.data || []);
      } catch (error) {
        console.error('Failed to refresh users after creation:', error);
      }
    };

    const handleUserUpdated = async (data: any) => {
      try {
        const usersResponse = await api.get('/admin/users');
        setUsers(usersResponse.data || []);
      } catch (error) {
        console.error('Failed to refresh users after update:', error);
      }
    };

    const handleUserRoleUpdated = async (data: any) => {
      try {
        const usersResponse = await api.get('/admin/users');
        setUsers(usersResponse.data || []);
      } catch (error) {
        console.error('Failed to refresh users after role update:', error);
      }
    };

    const handleUserDeleted = async (data: any) => {
      try {
        const usersResponse = await api.get('/admin/users');
        setUsers(usersResponse.data || []);
      } catch (error) {
        console.error('Failed to refresh users after deletion:', error);
      }
    };

    const handleUserProfileUpdated = async (data: any) => {
      try {
        // Refresh users list to get updated avatar/color/profile info
        const usersResponse = await api.get('/admin/users');
        setUsers(usersResponse.data || []);
      } catch (error) {
        console.error('Failed to refresh users after profile update:', error);
      }
    };

    // Settings event handlers
    const handleSettingsUpdated = async (data: any) => {
      try {
        const asSettingString = (value: unknown) =>
          value == null ? '' : typeof value === 'string' ? value : String(value);

        // Bulk patch from PUT /admin/settings/bulk
        if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
          const patch: Record<string, string> = {};
          for (const [key, value] of Object.entries(data.settings)) {
            patch[key] = asSettingString(value);
          }
          setSettings((prev) => ({ ...prev, ...patch }));
          setEditingSettings((prev) => ({ ...prev, ...patch }));
          return;
        }
        // Update the specific setting directly from WebSocket data instead of fetching all settings
        if (data.key && data.value === null) {
          setSettings(prev => {
            const next = { ...prev };
            delete next[data.key];
            return next;
          });
          setEditingSettings(prev => {
            const next = { ...prev };
            delete next[data.key];
            return next;
          });
        } else if (data.key && data.value !== undefined) {
          const value = asSettingString(data.value);
          const setFlagKey = `${data.key}_SET`;
          const setFlag =
            data[setFlagKey] !== undefined ? asSettingString(data[setFlagKey]) : undefined;
          setSettings((prev) => ({
            ...prev,
            [data.key]: value,
            ...(setFlag !== undefined ? { [setFlagKey]: setFlag } : {}),
          }));
          setEditingSettings((prev) => ({
            ...prev,
            [data.key]: value,
            ...(setFlag !== undefined ? { [setFlagKey]: setFlag } : {}),
          }));
          // Agent row appears/disappears in Users when AI is toggled
          if (data.key === 'AI_ENABLED') {
            try {
              const usersResponse = await api.get('/admin/users');
              setUsers(usersResponse.data || []);
            } catch (usersErr) {
              console.warn('Failed to refresh users after AI_ENABLED change:', usersErr);
            }
          }
        } else {
          // Fallback: Refresh from SettingsContext if WebSocket data is incomplete
          await refreshSettings();
          // SettingsContext will update, and our useEffect will trigger loadData() to sync local state
        }
      } catch (error) {
        console.error('Failed to refresh settings after update:', error);
      }
    };

    // Register WebSocket event listeners
    websocketClient.onUserCreated(handleUserCreated);
    websocketClient.onUserUpdated(handleUserUpdated);
    websocketClient.onUserRoleUpdated(handleUserRoleUpdated);
    websocketClient.onUserDeleted(handleUserDeleted);
    websocketClient.onUserProfileUpdated(handleUserProfileUpdated);
    websocketClient.onSettingsUpdated(handleSettingsUpdated);

    // Cleanup function
    return () => {
      websocketClient.offTagCreated(handleTagCreated);
      websocketClient.offTagUpdated(handleTagUpdated);
      websocketClient.offTagDeleted(handleTagDeleted);
      websocketClient.offPriorityCreated(handlePriorityCreated);
      websocketClient.offPriorityUpdated(handlePriorityUpdated);
      websocketClient.offPriorityDeleted(handlePriorityDeleted);
      websocketClient.offPriorityReordered(handlePriorityReordered);
      websocketClient.offUserCreated(handleUserCreated);
      websocketClient.offUserUpdated(handleUserUpdated);
      websocketClient.offUserRoleUpdated(handleUserRoleUpdated);
      websocketClient.offUserDeleted(handleUserDeleted);
      websocketClient.offUserProfileUpdated(handleUserProfileUpdated);
      websocketClient.offSettingsUpdated(handleSettingsUpdated);
    };
  }, [currentUser?.roles, refreshSettings]);

  // System info fetching removed - Header.tsx handles all system info polling
  // Header is always loaded and has the same admin check, so no need for duplicate polling

  /** @param options.quiet Skip full-page loading state so open modals (e.g. storage migrate) stay mounted. */
  const loadData = async (options?: { quiet?: boolean }) => {
    const quiet = Boolean(options?.quiet);
    try {
      if (!quiet) setLoading(true);
      // Use SettingsContext for settings (already fetched for admins) instead of duplicate API call.
      // Quiet reloads refresh settings first so STORAGE_* etc. match the server without unmounting Admin.
      const [usersResponse, tagsResponse, prioritiesResponse, refreshedSettings] = await Promise.all([
        api.get('/admin/users'),
        getTags(),
        getPriorities(),
        quiet ? refreshSettings() : Promise.resolve(null)
      ]);
      
      setUsers(usersResponse.data || []);
      
      const loadedSettings =
        refreshedSettings && Object.keys(refreshedSettings).length > 0
          ? refreshedSettings
          : systemSettings || {};
      const settingsWithDefaults = {
        ...loadedSettings,
        TASK_DELETE_CONFIRM: loadedSettings.TASK_DELETE_CONFIRM || 'true',
        ALLOW_USER_SELF_DELETE: loadedSettings.ALLOW_USER_SELF_DELETE || 'true',
        // Ensure SMTP_SECURE has a default value if not in database
        // This ensures it's always in editingSettings and will be saved when user clicks Save/Test
        SMTP_SECURE: loadedSettings.SMTP_SECURE || 'tls'
      };
      
      setSettings(settingsWithDefaults);
      setEditingSettings(settingsWithDefaults);
      setTags(tagsResponse || []);
      setPriorities(prioritiesResponse || []);
      
      // Load tag usage counts for all tags (batch query - fixes N+1 problem)
      if (tagsResponse && tagsResponse.length > 0) {
        try {
          const tagIds = tagsResponse.map((tag: any) => tag.id);
          const batchUsageData = await getBatchTagUsage(tagIds);
          const tagUsageCountsMap: { [tagId: number]: number } = {};
          tagIds.forEach((tagId: number) => {
            tagUsageCountsMap[tagId] = batchUsageData[tagId]?.count || 0;
          });
          setTagUsageCounts(tagUsageCountsMap);
        } catch (error) {
          console.error('Failed to get batch tag usage:', error);
          // Fallback to empty map
          setTagUsageCounts({});
        }
      }
      
      // Load priority usage counts for all priorities (batch query - fixes N+1 problem)
      if (prioritiesResponse && prioritiesResponse.length > 0) {
        try {
          const priorityIds = prioritiesResponse.map((priority: any) => priority.id);
          const batchUsageData = await getBatchPriorityUsage(priorityIds);
          const priorityUsageCountsMap: { [priorityId: string]: number } = {};
          priorityIds.forEach((priorityId: string) => {
            priorityUsageCountsMap[priorityId] = batchUsageData[priorityId]?.count || 0;
          });
          setPriorityUsageCounts(priorityUsageCountsMap);
        } catch (error) {
          console.error('Failed to get batch priority usage:', error);
          // Fallback to empty map
          setPriorityUsageCounts({});
        }
      }
      
      // Check if default admin account still exists
      const defaultAdminExists = usersResponse.data?.some((user: any) => 
        user.email === 'admin@example.com'
      );
      setHasDefaultAdmin(defaultAdminExists);
    } catch (err) {
      toast.error(t('failedToLoadAdminData'), '');
      console.error(err);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, role: 'admin' | 'user' | 'viewer') => {
    try {
      await api.put(`/admin/users/${userId}/role`, { role });
      await loadData(); // Reload users
      toast.success(t('userRoleUpdatedSuccessfully'), '');
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        t('failedToUpdateUserRole');
      toast.error(errorMessage, '');
      console.error(err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    // Prevent users from deleting themselves
    if (userId === currentUser?.id) {
      toast.error(t('cannotDeleteOwnAccount'), '');
      return;
    }

    try {
      // Fetch task count for this user
      const taskCountData = await getUserTaskCount(userId);
      setUserTaskCounts(prev => ({ ...prev, [userId]: taskCountData.count }));
      setShowDeleteConfirm(userId);
    } catch (error: any) {
      console.error('Failed to get task count:', error);
      // Show error toast but still allow deletion
      const errorMessage = error.response?.data?.error || error.message || t('failedToGetTaskCount');
      toast.error(errorMessage, '');
      // Still show confirmation even if task count fails
      setUserTaskCounts(prev => ({ ...prev, [userId]: 0 }));
      setShowDeleteConfirm(userId);
    }
  };

  const confirmDeleteUser = async (userId: string, reassignToUserId?: string | null) => {
    try {
      await deleteUser(userId, reassignToUserId);
      await loadData(); // Reload users
      if (onUsersChanged) {
        onUsersChanged();
      }
      setShowDeleteConfirm(null);
      toast.success(t('userDeletedSuccessfully'), '');
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('failedToDeleteUser');
      toast.error(errorMessage, '');
      console.error(err);
    }
  };

  const cancelDeleteUser = () => {
    setShowDeleteConfirm(null);
  };

  const handleDeleteTag = async (tagId: number) => {
    try {
      // Fetch usage count for this tag
      const usageData = await getTagUsage(tagId);
      setTagUsageCounts(prev => ({ ...prev, [tagId]: usageData.count }));
      setShowDeleteTagConfirm(tagId);
    } catch (error) {
      console.error('Failed to get tag usage:', error);
      // Still show confirmation even if usage count fails
      setTagUsageCounts(prev => ({ ...prev, [tagId]: 0 }));
      setShowDeleteTagConfirm(tagId);
    }
  };

  const confirmDeleteTag = async (tagId: number) => {
    try {
      await deleteTag(tagId);
      const updatedTags = await getTags();
      setTags(updatedTags);
      setShowDeleteTagConfirm(null);
      toast.success(t('tagDeletedSuccessfully'), '');
    } catch (error: any) {
      toast.error(t('failedToDeleteTag'), error.response?.data?.error || '');
    }
  };

  const cancelDeleteTag = () => {
    setShowDeleteTagConfirm(null);
  };

  const handleAddTag = async (tagData: { tag: string; description: string; color: string }) => {
    await createTag(tagData);
    const updatedTags = await getTags();
    setTags(updatedTags);
    toast.success(t('tagCreatedSuccessfully'), '');
  };

  const handleUpdateTag = async (tagId: number, updates: { tag: string; description: string; color: string }) => {
    await updateTag(tagId, updates);
    const updatedTags = await getTags();
    setTags(updatedTags);
    toast.success(t('tagUpdatedSuccessfully'), '');
  };

  const handleAddPriority = async (priorityData: { priority: string; color: string }) => {
    await createPriority(priorityData);
    const updatedPriorities = await getPriorities();
    setPriorities(updatedPriorities);
    toast.success(t('priorityCreatedSuccessfully'), '');
  };

  const handleUpdatePriority = async (priorityId: string, updates: { priority: string; color: string }) => {
    await updatePriority(Number(priorityId), updates);
    const updatedPriorities = await getPriorities();
    setPriorities(updatedPriorities);
    toast.success(t('priorityUpdatedSuccessfully'), '');
  };

  const handleDeletePriority = async (priorityId: string) => {
    try {
      // Fetch usage count for this priority
      const usageData = await getPriorityUsage(priorityId);
      setPriorityUsageCounts(prev => ({ ...prev, [priorityId]: usageData.count }));
      setShowDeletePriorityConfirm(priorityId);
    } catch (error) {
      console.error('Failed to get priority usage:', error);
      // Still show confirmation even if usage count fails
      setPriorityUsageCounts(prev => ({ ...prev, [priorityId]: 0 }));
      setShowDeletePriorityConfirm(priorityId);
    }
  };

  const confirmDeletePriority = async (priorityId: string) => {
    try {
      const response = await deletePriority(Number(priorityId));
      const updatedPriorities = await getPriorities();
      setPriorities(updatedPriorities);
      setShowDeletePriorityConfirm(null);
      
      // Show success message with reassignment info if applicable
      const reassignedCount = response?.data?.reassignedTasks || 0;
      let successMessage = t('priorityDeletedSuccessfully');
      if (reassignedCount > 0) {
        successMessage += ` (${t('tasksReassignedToDefault', { count: reassignedCount })})`;
      }
      
      toast.success(successMessage, '');
    } catch (error: any) {
      console.error('Failed to delete priority:', error);
      
      // Extract specific error message from backend response
      let errorMessage = t('failedToDeletePriority');
      
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage, '');
    }
  };

  const cancelDeletePriority = () => {
    setShowDeletePriorityConfirm(null);
  };

  const handleReorderPriorities = async (reorderedPriorities: any[]) => {
    setPriorities(reorderedPriorities);
    try {
      await reorderPriorities(reorderedPriorities);
      toast.success(t('prioritiesReorderedSuccessfully'), '');
    } catch (error: any) {
      // Revert on error
      const currentPriorities = await getPriorities();
      setPriorities(currentPriorities);
      toast.error(error.response?.data?.error || t('failedToReorderPriorities'), '');
    }
  };

  const handleSetDefaultPriority = async (priorityId: string) => {
    try {
      await setDefaultPriority(Number(priorityId));
      const updatedPriorities = await getPriorities();
      setPriorities(updatedPriorities);
      toast.success(t('defaultPriorityUpdatedSuccessfully'), '');
    } catch (error: any) {
      console.error('Failed to set default priority:', error);
      toast.error(error?.response?.data?.error || t('failedToSetDefaultPriority'), '');
    }
  };

  const handleUserColorChange = async (userId: string, color: string) => {
    try {
      await api.put(`/admin/users/${userId}/color`, { color });
      await loadData(); // Reload users
      if (onUsersChanged) {
        onUsersChanged();
      }
      toast.success(t('userColorUpdatedSuccessfully'), '');
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('failedToUpdateUserColor');
      toast.error(errorMessage, '');
      console.error('Failed to update user color:', err);
    }
  };

  const handleUserRemoveAvatar = async (userId: string) => {
    try {
      await api.delete(`/admin/users/${userId}/avatar`);
      await loadData();
      if (onUsersChanged) {
        onUsersChanged();
      }
    } catch (error) {
      console.error('Failed to remove user avatar:', error);
      toast.error(t('failedToRemoveAvatar'), '');
    }
  };

  // Close confirmation menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showDeleteConfirm && !(event.target as Element).closest('.delete-confirmation')) {
        setShowDeleteConfirm(null);
      }
      if (showDeleteTagConfirm && !(event.target as Element).closest('.delete-confirmation')) {
        setShowDeleteTagConfirm(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDeleteConfirm, showDeleteTagConfirm]);

  const handleSaveSettings = async (newSettings?: { [key: string]: string | undefined }) => {
    try {
      
      let hasChanges = false;
      const changedKeys: string[] = [];
      // Prefer explicit draft; ignore click events mistakenly passed via onClick={onSave}
      const draftSource =
        newSettings && !isLikelyDomEvent(newSettings) ? newSettings : editingSettings;
      const settingsToSave = clampActivityFeedInSettings(draftSource);
      if (settingsToSave !== draftSource) {
        setEditingSettings(settingsToSave);
      }
      
      // Ensure SMTP_SECURE is included if we're saving SMTP settings
      // This handles the case where SMTP_SECURE is not in the database but should be saved with default 'tls'
      const hasSmtpSettings = Object.keys(settingsToSave).some(key => key.startsWith('SMTP_'));
      if (hasSmtpSettings) {
        // If SMTP_SECURE is not in editingSettings or is empty, use the dropdown's default value 'tls'
        // This ensures that even after clearing managed settings, the default 'tls' will be saved
        if (
          !('SMTP_SECURE' in settingsToSave) ||
          !settingValueAsString(settingsToSave.SMTP_SECURE).trim()
        ) {
          settingsToSave.SMTP_SECURE = 'tls';
        }
      }
      
      // Do not activate S3 without a successful connection test (managed platform S3 is exempt)
      const nextBackend =
        settingValueAsString(settingsToSave.STORAGE_BACKEND || settings.STORAGE_BACKEND)
          .trim()
          .toLowerCase() || 'disk';
      const currBackend =
        settingValueAsString(settings.STORAGE_BACKEND).trim().toLowerCase() || 'disk';
      if (nextBackend === 's3' && currBackend !== 's3') {
        const managed =
          settingValueAsString(
            settingsToSave.STORAGE_MANAGED || settings.STORAGE_MANAGED
          ).trim() === 'true';
        const testOk =
          settingValueAsString(
            settingsToSave.STORAGE_TEST_OK || settings.STORAGE_TEST_OK
          ).trim() === 'true';
        const hasBucket = Boolean(
          settingValueAsString(
            settingsToSave.S3_BUCKET || settings.S3_BUCKET
          ).trim()
        );
        const hasRegionOrEndpoint = Boolean(
          settingValueAsString(
            settingsToSave.S3_REGION || settings.S3_REGION
          ).trim() ||
            settingValueAsString(
              settingsToSave.S3_ENDPOINT || settings.S3_ENDPOINT
            ).trim()
        );
        const hasAccessKey = Boolean(
          settingValueAsString(
            settingsToSave.S3_ACCESS_KEY_ID || settings.S3_ACCESS_KEY_ID
          ).trim()
        );
        const secretSet =
          settingValueAsString(
            settingsToSave.S3_SECRET_ACCESS_KEY_SET || settings.S3_SECRET_ACCESS_KEY_SET
          ).trim() === 'true' ||
          Boolean(
            settingValueAsString(
              settingsToSave.S3_SECRET_ACCESS_KEY || settings.S3_SECRET_ACCESS_KEY
            ).trim()
          );
        if (
          !managed &&
          !(testOk && hasBucket && hasRegionOrEndpoint && hasAccessKey && secretSet)
        ) {
          toast.error(t('storage.saveS3NeedsTest'), '');
          return false;
        }
      }

      // Save each setting individually
      for (const [key, value] of Object.entries(settingsToSave)) {
        // Skip accidental DOM/React event props (from a prior buggy Save) and invalid keys
        if (!isValidAdminSettingKey(key)) {
          continue;
        }

        // Skip WEBSITE_URL - it's read-only and set during instance purchase
        if (key === 'WEBSITE_URL') {
          continue;
        }
        
        // Skip APP_URL - it's owner-only and must be updated via dedicated endpoint
        if (key === 'APP_URL') {
          continue;
        }

        // Client-only flags from admin GET (e.g. SMTP_PASSWORD_SET) — not DB keys
        if (key.endsWith('_SET')) {
          continue;
        }

        // Migration detail / other large JSON blobs — not edited in the form
        if (key === 'STORAGE_MIGRATION_DETAIL') {
          continue;
        }
        
        // Normalize values for comparison (treat undefined and empty string as the same).
        // Values may be non-strings after WebSocket / patch updates.
        const normalizedValue = settingValueAsString(value).trim();
        const normalizedCurrent = settingValueAsString(settings[key]).trim();
        
        // For SMTP_SECURE, ensure default value is set if not present
        let valueToSave = normalizedValue;
        if (key === 'SMTP_SECURE' && !valueToSave) {
          valueToSave = 'tls'; // Default value
        }

        // Write-only secrets: empty/mask means keep existing value (do not PUT)
        if (
          ['SMTP_PASSWORD', 'GOOGLE_CLIENT_SECRET', 'AI_API_KEY', 'AI_RUNNER_TOKEN', 'S3_SECRET_ACCESS_KEY'].includes(key) &&
          isMaskedApiKeyDisplay(valueToSave)
        ) {
          continue;
        }
        
        // Save if value is different from current (handles undefined vs empty string)
        if (valueToSave !== normalizedCurrent) {
          // Skip console log for NOTIFICATION_* settings to reduce noise
          if (!key.startsWith('NOTIFICATION_')) {
            const secretKeys = [
              'SMTP_PASSWORD',
              'GOOGLE_CLIENT_SECRET',
              'AI_API_KEY',
              'AI_RUNNER_TOKEN',
              'S3_SECRET_ACCESS_KEY',
            ];
            console.log(`Saving setting: ${key}`, {
              oldValue: secretKeys.includes(key) ? '(redacted)' : settings[key] || '(empty)',
              newValue: secretKeys.includes(key) ? '(redacted)' : valueToSave
            });
          }
          await api.put('/admin/settings', { key, value: valueToSave });
          hasChanges = true;
          changedKeys.push(key);
        }
      }
      
      if (hasChanges) {
        // Refresh settings from SettingsContext (which will refetch from API via WebSocket or manual refresh)
        await refreshSettings();
        // Quiet: avoid full-page loading unmount (drops storage draft UI / modals)
        await loadData({ quiet: true });
        
        // Update the parent component's site settings immediately
        if (onSettingsChanged) {
          onSettingsChanged();
        }
        
        // Check if this is only UPLOAD_LIMITS_ENFORCED (which has its own toast message)
        const isOnlyUploadLimitsEnforced = changedKeys.length === 1 && changedKeys[0] === 'UPLOAD_LIMITS_ENFORCED';
        
        // Show success toast (skip for UPLOAD_LIMITS_ENFORCED as it has its own specific message)
        if (!isOnlyUploadLimitsEnforced) {
          toast.success(t('settingsSavedSuccessfully'), '');
        }
      } else {
        toast.info(t('noChangesToSave'), '', 3000);
      }
      return true;
    } catch (err) {
      toast.error(t('failedToSaveSettings'), '');
      console.error(err);
      return false;
    }
  };

  // Auto-save function for immediate saving of individual settings
  const handleAutoSaveSetting = async (key: string, value: string) => {
    try {
      
      // Save the setting immediately
      await api.put('/admin/settings', { key, value });
      
      // Update the settings state
      setSettings(prev => ({ ...prev, [key]: value }));
      // Keep header/branding in sync immediately (empty logo → default Agila logo without full reload)
      updateSiteSetting(key, value);
      
      // Update the parent component's site settings immediately
      if (onSettingsChanged) {
        await onSettingsChanged();
      } else {
        await refreshSettings();
      }
      
      // Show brief success message for auto-save
      toast.success(t('settingsSavedSuccessfully'), '', 3000);
      
    } catch (err) {
      toast.error(t('failedToSaveSetting', { key }), '');
      console.error(err);
      throw err; // Re-throw so the component can handle the error
    }
  };

  const handleReloadOAuth = async () => {
    try {
      await api.post('/auth/reload-oauth');
      toast.success(t('oauthReloadedSuccessfully'), '');
    } catch (err: any) {
      toast.error(t('failedToReloadOAuth'), '');
      console.error(err);
    }
  };

  const handleAddUser = async (userData: any) => {
    try {
      // Only check email server status if sending an invite (isActive = false)
      if (!userData.isActive) {
        const emailStatusResponse = await fetch('/api/admin/email-status', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          }
        });
        
        if (emailStatusResponse.ok) {
          const emailStatus = await emailStatusResponse.json();
          if (!emailStatus.available) {
            throw new Error(t('emailServerNotAvailable', { error: emailStatus.error }));
          }
        } else {
          console.warn('Could not check email status, proceeding with user creation');
        }
      }

      const result = await createUser(userData);
      
      // Check if email was actually sent (only relevant if isActive is false)
      if (!userData.isActive && result.emailSent === false) {
        toast.warning(t('userCreatedButEmailFailed', { error: result.emailError || t('emailServiceUnavailable') }), '');
      } else {
      }
      
      await loadData(); // Reload users
      // Notify parent component that users have changed
      if (onUsersChanged) {
        onUsersChanged();
      }
    } catch (error: any) {
      console.error('Failed to create user:', error);
      const message =
        error.response?.data?.error ||
        error.message ||
        t('failedToCreateUser');
      // Re-throw so AdminUsersTab can show a single toast (avoid double toast)
      const wrapped = new Error(message);
      (wrapped as any).response = error.response;
      throw wrapped;
    }
  };

  const handleResendInvitation = async (userId: string) => {
    try {
      // Check email server status first
      const emailStatusResponse = await fetch('/api/admin/email-status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });

      if (emailStatusResponse.ok) {
        const emailStatus = await emailStatusResponse.json();
        if (!emailStatus.available) {
          throw new Error(t('emailServerNotAvailableForResend', { error: emailStatus.error }));
        }
      } else {
        console.warn('Could not check email status, proceeding with resend');
        console.warn('Email status check failed with status:', emailStatusResponse.status);
      }

      const result = await resendUserInvitation(userId);

      // API: { success: true, email } on success — toast is owned by AdminUsersTab
      if (result && result.success === true && result.email) {
        return { email: result.email as string };
      }

      throw new Error(result?.error || result?.details || t('failedToSendInvitationEmail'));
    } catch (err: any) {
      console.error('Failed to resend invitation:', err);
      const message =
        err.response?.data?.error || err.message || t('failedToSendInvitationEmail');
      const wrapped = new Error(message);
      (wrapped as any).response = err.response;
      throw wrapped;
    }
  };

  const handleEditUser = (_user: User) => {
    // This will be handled by the AdminUsersTab component
  };

  const handleSaveUser = async (userData: any) => {
    try {
      // Update user basic info
      await updateUser(userData.id, userData);
      
      // Update display name in members table
      if (userData.displayName) {
        await api.put(`/admin/users/${userData.id}/member-name`, { 
          displayName: userData.displayName.trim() 
        });
      }
      
      // Upload avatar if selected
      if (userData.selectedFile) {
        const formData = new FormData();
        formData.append('avatar', userData.selectedFile);
        await api.post(`/admin/users/${userData.id}/avatar`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      
      await loadData(); // Reload users
      
      if (onUsersChanged) {
        onUsersChanged();
      }
      
      toast.success(t('userUpdatedSuccessfully'), '');
    } catch (err: any) {
      console.error('❌ Failed to save user:', err);
      // Extract detailed error message, including user limit errors
      let errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('failedToUpdateUser');
      
      // Check for user limit error specifically
      if (err.response?.status === 403 && (errorMessage.includes('limit') || errorMessage.includes('Limit'))) {
        errorMessage = err.response?.data?.message || err.response?.data?.error || t('users.userLimitReached');
      }
      
      // Let AdminUsersTab show the toast once
      const wrapped = new Error(errorMessage);
      (wrapped as any).response = err.response;
      throw wrapped;
    }
  };

  /** Bumped on Discard so tabs with local draft state (AI, uploads, reporting, …) re-hydrate. */
  const [settingsDiscardNonce, setSettingsDiscardNonce] = useState(0);

  const handleCancelSettings = () => {
    setEditingSettings(settings);
    setSettingsDiscardNonce((n) => n + 1);
  };

  /** Local draft dirty flags for tabs that do not use shared editingSettings. */
  const [localDirtyTabs, setLocalDirtyTabs] = useState<Record<string, boolean>>({});
  const [isSavingAllDrafts, setIsSavingAllDrafts] = useState(false);
  const localSaveByTabRef = useRef<Map<string, () => Promise<void>>>(new Map());

  const handleTabLocalDirty = useCallback((tabId: string, dirty: boolean) => {
    setLocalDirtyTabs((prev) => {
      if (Boolean(prev[tabId]) === dirty) return prev;
      return { ...prev, [tabId]: dirty };
    });
  }, []);

  const registerTabLocalSave = useCallback(
    (tabId: string, save: (() => Promise<void>) | null) => {
      if (save) localSaveByTabRef.current.set(tabId, save);
      else localSaveByTabRef.current.delete(tabId);
    },
    []
  );

  const hasUnsavedSettings = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );

  const hasAnyLocalDirty = useMemo(
    () => Object.values(localDirtyTabs).some(Boolean),
    [localDirtyTabs]
  );

  const hasAnyUnsavedDrafts = hasUnsavedSettings || hasAnyLocalDirty;

  const hasUnsavedSettingsRef = useRef(hasUnsavedSettings);
  hasUnsavedSettingsRef.current = hasUnsavedSettings;
  const hasAnyLocalDirtyRef = useRef(hasAnyLocalDirty);
  hasAnyLocalDirtyRef.current = hasAnyLocalDirty;
  const localDirtyTabsRef = useRef(localDirtyTabs);
  localDirtyTabsRef.current = localDirtyTabs;
  const handleSaveSettingsRef = useRef(handleSaveSettings);
  handleSaveSettingsRef.current = handleSaveSettings;
  const handleCancelSettingsRef = useRef(handleCancelSettings);
  handleCancelSettingsRef.current = handleCancelSettings;

  /** Save shared editingSettings (if dirty) then any registered tab-local drafts. */
  const saveAllAdminDrafts = useCallback(async (): Promise<{ hasLocalDirtyStill: boolean }> => {
    if (hasUnsavedSettingsRef.current) {
      const ok = await handleSaveSettingsRef.current();
      if (!ok) {
        throw new Error('Failed to save admin settings');
      }
    }
    for (const [tabId, dirty] of Object.entries(localDirtyTabsRef.current)) {
      if (!dirty) continue;
      const save = localSaveByTabRef.current.get(tabId);
      if (save) await save();
    }
    // Allow child dirty effects to flush before reporting leftover local drafts
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 0);
    });
    return { hasLocalDirtyStill: hasAnyLocalDirtyRef.current };
  }, []);

  const handleHeaderSaveAllDrafts = useCallback(async () => {
    if (isSavingAllDrafts) return;
    setIsSavingAllDrafts(true);
    try {
      await saveAllAdminDrafts();
    } catch {
      // Individual saves toast; keep banner open
    } finally {
      setIsSavingAllDrafts(false);
    }
  }, [isSavingAllDrafts, saveAllAdminDrafts]);

  // Expose draft gate to App for leave-Admin confirmation
  useEffect(() => {
    if (!onDraftGateChange) return;
    onDraftGateChange({
      hasSharedDirty: hasUnsavedSettings,
      hasLocalDirty: hasAnyLocalDirty,
      saveShared: () => saveAllAdminDrafts(),
      discardAll: () => handleCancelSettingsRef.current(),
    });
    return () => onDraftGateChange(null);
  }, [hasUnsavedSettings, hasAnyLocalDirty, onDraftGateChange, saveAllAdminDrafts]);

  const dirtySettingsTabs = useMemo(
    () => getDirtyAdminSettingsTabs(settings, editingSettings),
    [settings, editingSettings]
  );

  const isTabDirty = useCallback(
    (tabId: string) => dirtySettingsTabs.has(tabId as any) || Boolean(localDirtyTabs[tabId]),
    [dirtySettingsTabs, localDirtyTabs]
  );

  // Warn on browser refresh/close when drafts exist (Admin stays mounted across in-app page switches)
  useEffect(() => {
    if (!hasAnyUnsavedDrafts) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasAnyUnsavedDrafts]);

  const handleMailServerDisabled = () => {
    // Clear test result when mail server is disabled to require re-testing
    setTestEmailResult(null);
  };

  const handleTestEmail = async () => {
    try {
      setIsTestingEmail(true);
      
      // First, save any unsaved SMTP settings (only save SMTP-related settings)
      const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL', 'SMTP_FROM_NAME', 'SMTP_SECURE'];
      let hasChanges = false;
      for (const key of smtpKeys) {
        // For SMTP_SECURE, use the dropdown's displayed value (which defaults to 'tls' if not in editingSettings)
        // This ensures we save the default value even if it's not explicitly in editingSettings
        let value = editingSettings[key];
        
        const currentValue = settings[key];
        
        // Normalize values: treat undefined and empty string as the same
        let normalizedValue = settingValueAsString(value).trim();

        // Write-only secret: empty or display mask means keep existing stored password
        if (key === 'SMTP_PASSWORD') {
          if (!normalizedValue || isMaskedApiKeyDisplay(normalizedValue)) {
            continue;
          }
        }
        
        // For SMTP_SECURE, always ensure it has a default value of 'tls' if empty
        // This is critical because the dropdown shows 'tls' as default, so we must save it
        if (key === 'SMTP_SECURE' && !normalizedValue) {
          normalizedValue = 'tls'; // Default value - this must be saved even if empty in editingSettings
        }
        
        const normalizedCurrent = settingValueAsString(currentValue).trim();
        
        // Save if:
        // 1. Value exists (not empty) AND is different from current, OR
        // 2. For SMTP_SECURE, always save if current is empty/undefined (to ensure default is set)
        const shouldSave = normalizedValue && (
          normalizedValue !== normalizedCurrent || 
          (key === 'SMTP_SECURE' && !normalizedCurrent)
        );
        
        if (shouldSave) {
          console.log(`Saving SMTP setting: ${key}`, {
            oldValue: key === 'SMTP_PASSWORD' ? '(redacted)' : currentValue || '(empty)',
            newValue: key === 'SMTP_PASSWORD' ? '(redacted)' : normalizedValue
          });
          await api.put('/admin/settings', { key, value: normalizedValue });
          hasChanges = true;
        }
      }
      
      if (hasChanges) {
        // Wait a bit to ensure database writes are committed
        await new Promise(resolve => setTimeout(resolve, 200));
        await loadData(); // Reload settings
        if (onSettingsChanged) {
          onSettingsChanged();
        }
        // Wait a bit more to ensure settings are refreshed in context
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Now test the email
      const response = await api.post('/admin/test-email');
      
      // Auto-enable mail server if test succeeds and it's not already enabled
      if (response.data && editingSettings.MAIL_ENABLED !== 'true') {
        setEditingSettings(prev => ({ ...prev, MAIL_ENABLED: 'true' }));
        // Save the auto-enabled setting
        await api.put('/admin/settings', { key: 'MAIL_ENABLED', value: 'true' });
        console.log('✅ Mail server auto-enabled after successful test');
      }
      
      // Show success modal
      setTestEmailResult(response.data);
      setShowTestEmailModal(true);
      
    } catch (err: any) {
      // Capture the full error details for debugging
      const errorDetails = {
        message: err.message || 'Unknown error',
        status: err.response?.status || 'No status',
        statusText: err.response?.statusText || 'No status text',
        data: err.response?.data || 'No response data',
        url: err.config?.url || '/admin/test-email',
        method: err.config?.method || 'POST'
      };
      
      setTestEmailError(JSON.stringify(errorDetails, null, 2));
      setShowTestEmailErrorModal(true);
    } finally {
      setIsTestingEmail(false);
    }
  };

  const tabsRef = useRef<HTMLDivElement>(null);
  const pinTabsOnNextTabChangeRef = useRef(false);

  const handleTabChange = (tab: string) => {
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
    // Compound hubs get a default subtab (SSO / Project / User Interface)
    window.location.hash = adminHashForTabId(tab);
  };

  const adminSearchContentSources = useMemo(
    () => ({
      users,
      tags,
      priorities,
      settings: editingSettings as Record<string, string | undefined | null>,
    }),
    [users, tags, priorities, editingSettings]
  );

  /** Navigate from settings search (supports System / Project / App sub-hashes). */
  const handleSearchNavigate = (tab: string, hash: string) => {
    const stickyOffset = 56;
    const tabsEl = tabsRef.current;
    const canonical = canonicalizeAdminHash(hash);
    const resolvedTab = adminTabFromHash(canonical) || tab;
    if (resolvedTab !== activeTab && tabsEl) {
      const pinY = tabsEl.getBoundingClientRect().top + window.scrollY - stickyOffset;
      pinTabsOnNextTabChangeRef.current = window.scrollY > pinY + 1;
      setActiveTab(resolvedTab);
    }
    window.location.hash = `#${canonical}`;
    // Ensure hashchange fires for same-tab sub-navigation (e.g. AI → troubleshooting)
    if (resolvedTab === activeTab) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
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

  if (!currentUser?.roles?.includes('admin')) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('accessDenied')}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{t('noPermissionToAccess')}</p>
          <a
            href="/"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            ← {t('goBackHome')}
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t('loadingAdminPanel')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
        {/* Security Warning - Default Admin Account */}
        {hasDefaultAdmin && (
          <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400 dark:text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{t('securityWarning')}</h3>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  {t('defaultAdminAccountWarning')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sticky header: title + search on top row, tabs below (no overlap) */}
        <div
          ref={tabsRef}
          className="sticky top-14 z-40 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700"
          data-tour-id="admin-tabs"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700">
            <div className="admin-header min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('adminPanel')}</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t('adminPanelDescription')}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-shrink-0 w-full sm:w-auto sm:pt-0.5 sm:max-w-none sm:justify-end">
              <AdminUnsavedChangesBanner
                visible={hasAnyUnsavedDrafts}
                onSave={() => {
                  void handleHeaderSaveAllDrafts();
                }}
                onDiscard={handleCancelSettings}
                isSaving={isSavingAllDrafts}
              />
              <div className="w-full sm:w-auto sm:max-w-xs">
                <AdminSettingsSearch
                  activeTab={activeTab}
                  onNavigate={handleSearchNavigate}
                  contentSources={adminSearchContentSources}
                />
              </div>
            </div>
          </div>
          <nav className="flex space-x-8 overflow-x-auto px-4 max-w-full">
            {ADMIN_NAV_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`relative py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                data-tour-id={`admin-${tab}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {tab === 'users' && t('tabs.users')}
                  {tab === 'site-settings' && t('tabs.siteSettings')}
                  {tab === 'system-settings' && t('tabs.systemSettings')}
                  {tab === 'tags' && t('tabs.tags')}
                  {tab === 'priorities' && t('tabs.priorities')}
                  {tab === 'app-settings' && t('tabs.appSettings')}
                  {tab === 'project-settings' && t('tabs.projectSettings')}
                  {tab === 'licensing' && t('tabs.licensing')}
                  {tab === 'project-settings' && (
                    <AdminAttentionDot
                      show={lifecyclePendingCount > 0}
                      label={t('lifecycle.pendingAttention')}
                    />
                  )}
                  {isTabDirty(tab) && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"
                      title={t('unsavedChanges')}
                      aria-label={t('unsavedChanges')}
                    />
                  )}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tabs + content share a tall parent so sticky header works while scrolling content. */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Tab Content — visited panels stay mounted (hidden) to retain drafts */}
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-100 dark:border-gray-700 min-h-[calc(100vh-8.5rem)] min-w-0">
          {visitedTabs.has('users') && (
            <AdminTabPanel active={activeTab === 'users'}>
              <AdminUsersTab
                users={users}
                loading={loading}
                currentUser={currentUser}
                ownerEmail={ownerEmail}
                showDeleteConfirm={showDeleteConfirm}
                userTaskCounts={userTaskCounts}
                onRoleChange={handleRoleChange}
                onDeleteUser={handleDeleteUser}
                onConfirmDeleteUser={confirmDeleteUser}
                onCancelDeleteUser={cancelDeleteUser}
                onAddUser={handleAddUser}
                onEditUser={handleEditUser}
                onSaveUser={handleSaveUser}
                onColorChange={handleUserColorChange}
                onRemoveAvatar={handleUserRemoveAvatar}
                onResendInvitation={handleResendInvitation}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('site-settings') && (
            <AdminTabPanel active={activeTab === 'site-settings'}>
              <AdminSiteSettingsTab
                settings={settings}
                editingSettings={editingSettings}
                onSettingsChange={setEditingSettings}
                onSave={handleSaveSettings}
                onCancel={handleCancelSettings}
                onAutoSave={handleAutoSaveSetting}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('system-settings') && (
            <AdminTabPanel active={activeTab === 'system-settings'}>
              <AdminSystemSettingsTab
                settings={settings}
                editingSettings={editingSettings}
                onSettingsChange={setEditingSettings}
                onSave={handleSaveSettings}
                onCancel={handleCancelSettings}
                onAutoSave={handleAutoSaveSetting}
                onSettingsReload={loadData}
                onApplySettingsPatch={applySettingsPatch}
                onReloadOAuth={handleReloadOAuth}
                onTestEmail={handleTestEmail}
                onMailServerDisabled={handleMailServerDisabled}
                isTestingEmail={isTestingEmail}
                showTestEmailModal={showTestEmailModal}
                testEmailResult={testEmailResult}
                onCloseTestModal={() => setShowTestEmailModal(false)}
                showTestEmailErrorModal={showTestEmailErrorModal}
                testEmailError={testEmailError}
                onCloseTestErrorModal={() => setShowTestEmailErrorModal(false)}
                onLocalDirtyChange={(dirty) =>
                  handleTabLocalDirty('system-settings', dirty)
                }
                onRegisterLocalSave={(save) =>
                  registerTabLocalSave('system-settings', save)
                }
                discardNonce={settingsDiscardNonce}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('tags') && (
            <AdminTabPanel active={activeTab === 'tags'}>
              <AdminTagsTab
                tags={tags}
                loading={loading}
                onAddTag={handleAddTag}
                onUpdateTag={handleUpdateTag}
                onDeleteTag={handleDeleteTag}
                onConfirmDeleteTag={confirmDeleteTag}
                onCancelDeleteTag={cancelDeleteTag}
                showDeleteTagConfirm={showDeleteTagConfirm}
                tagUsageCounts={tagUsageCounts}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('priorities') && (
            <AdminTabPanel active={activeTab === 'priorities'}>
              <AdminPrioritiesTab
                priorities={priorities}
                loading={loading}
                onAddPriority={handleAddPriority}
                onUpdatePriority={handleUpdatePriority}
                onDeletePriority={handleDeletePriority}
                onConfirmDeletePriority={confirmDeletePriority}
                onCancelDeletePriority={cancelDeletePriority}
                onReorderPriorities={handleReorderPriorities}
                onSetDefaultPriority={handleSetDefaultPriority}
                showDeletePriorityConfirm={showDeletePriorityConfirm}
                priorityUsageCounts={priorityUsageCounts}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('app-settings') && (
            <AdminTabPanel active={activeTab === 'app-settings'}>
              <AdminAppSettingsTab
                settings={settings}
                editingSettings={editingSettings}
                onSettingsChange={setEditingSettings}
                onSave={handleSaveSettings}
                onCancel={handleCancelSettings}
                onAutoSave={handleAutoSaveSetting}
                discardNonce={settingsDiscardNonce}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('project-settings') && (
            <AdminTabPanel active={activeTab === 'project-settings'}>
              <AdminProjectHubTab
                settings={settings}
                editingSettings={editingSettings}
                onSettingsChange={setEditingSettings}
                onSave={handleSaveSettings}
                onCancel={handleCancelSettings}
                onAutoSave={handleAutoSaveSetting}
                onLocalDirtyChange={(dirty) =>
                  handleTabLocalDirty('project-settings', dirty)
                }
                onRegisterLocalSave={(save) =>
                  registerTabLocalSave('project-settings', save)
                }
                discardNonce={settingsDiscardNonce}
                lifecyclePendingCount={lifecyclePendingCount}
                onLifecyclePendingRefresh={refreshLifecyclePending}
                isActive={isPageActive && activeTab === 'project-settings'}
              />
            </AdminTabPanel>
          )}

          {visitedTabs.has('licensing') && (
            <AdminTabPanel active={activeTab === 'licensing'}>
              <AdminLicensingTab
                currentUser={currentUser}
                settings={settings}
              />
            </AdminTabPanel>
          )}
          </div>
        </div>
    </div>
  );
};

export default Admin;