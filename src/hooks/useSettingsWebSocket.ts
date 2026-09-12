import { useCallback } from 'react';
import { getAllTags, getAllPriorities, getAllSprints, getSettings } from '../api';
import { versionDetection } from '../utils/versionDetection';
import { handleAuthError } from '../utils/authErrorHandler';
import { instanceStatusIsBlocking } from '../components/layout/InstanceStatusBanner';

interface UseSettingsWebSocketProps {
  // State setters
  setAvailableTags: React.Dispatch<React.SetStateAction<any[]>>;
  setAvailablePriorities: React.Dispatch<React.SetStateAction<any[]>>;
  setAvailableSprints?: React.Dispatch<React.SetStateAction<any[]>>; // Optional: sprints state setter
  setSiteSettings?: React.Dispatch<React.SetStateAction<any>>; // Optional: SettingsContext now handles settings updates
  /** Refresh members when AI_ENABLED / AI_AGENT_NAME changes (Agent assignee visibility) */
  refreshMembers?: () => Promise<void> | void;
  
  // Version status hook
  versionStatus: {
    setInstanceStatus: (status: { status: string; message: string; isDismissed: boolean }) => void;
  };
}

export const useSettingsWebSocket = ({
  setAvailableTags,
  setAvailablePriorities,
  setAvailableSprints,
  setSiteSettings, // Optional - SettingsContext handles settings updates
  refreshMembers,
  versionStatus,
}: UseSettingsWebSocketProps) => {
  const handleTagCreated = useCallback(async (data: any) => {
    console.log('📨 Tag created via WebSocket:', data);
    // Optimistic catalog update so cards can render the chip before getAllTags returns
    if (data?.tag?.id != null) {
      setAvailableTags((prev) => {
        if (prev.some((t) => t.id === data.tag.id || String(t.id) === String(data.tag.id))) {
          return prev;
        }
        return [...prev, data.tag];
      });
    }
    try {
      const tags = await getAllTags();
      setAvailableTags(tags);
      console.log('📨 Tags refreshed after creation');
    } catch (error) {
      console.error('Failed to refresh tags after creation:', error);
    }
  }, [setAvailableTags]);

  const handleTagUpdated = useCallback(async (data: any) => {
    console.log('📨 Tag updated via WebSocket:', data);
    if (data?.tag?.id != null) {
      setAvailableTags((prev) => {
        const idx = prev.findIndex((t) => t.id === data.tag.id || String(t.id) === String(data.tag.id));
        if (idx === -1) return [...prev, data.tag];
        const next = [...prev];
        next[idx] = { ...next[idx], ...data.tag };
        return next;
      });
    }
    try {
      const tags = await getAllTags();
      setAvailableTags(tags);
      console.log('📨 Tags refreshed after update');
    } catch (error) {
      console.error('Failed to refresh tags after update:', error);
    }
  }, [setAvailableTags]);

  const handleTagDeleted = useCallback(async (data: any) => {
    console.log('📨 Tag deleted via WebSocket:', data);
    try {
      const tags = await getAllTags();
      setAvailableTags(tags);
      console.log('📨 Tags refreshed after deletion');
    } catch (error) {
      console.error('Failed to refresh tags after deletion:', error);
    }
  }, [setAvailableTags]);

  const handlePriorityCreated = useCallback(async (data: any) => {
    console.log('📨 Priority created via WebSocket:', data);
    if (data?.priority?.id != null) {
      setAvailablePriorities((prev) => {
        if (prev.some((p) => p.id === data.priority.id || String(p.id) === String(data.priority.id))) {
          return prev;
        }
        return [...prev, data.priority];
      });
    }
    try {
      const priorities = await getAllPriorities();
      setAvailablePriorities(priorities);
      console.log('📨 Priorities refreshed after creation');
    } catch (error) {
      console.error('Failed to refresh priorities after creation:', error);
    }
  }, [setAvailablePriorities]);

  const handlePriorityUpdated = useCallback(async (data: any) => {
    console.log('📨 Priority updated via WebSocket:', data);
    if (data?.priority?.id != null) {
      setAvailablePriorities((prev) => {
        const idx = prev.findIndex((p) => p.id === data.priority.id || String(p.id) === String(data.priority.id));
        if (idx === -1) return [...prev, data.priority];
        const next = [...prev];
        next[idx] = { ...next[idx], ...data.priority };
        return next;
      });
    }
    try {
      const priorities = await getAllPriorities();
      setAvailablePriorities(priorities);
      console.log('📨 Priorities refreshed after update');
    } catch (error) {
      console.error('Failed to refresh priorities after update:', error);
    }
  }, [setAvailablePriorities]);

  const handlePriorityDeleted = useCallback(async (data: any) => {
    console.log('📨 Priority deleted via WebSocket:', data);
    // Remove the deleted priority from availablePriorities list
    // This ensures TaskCard won't find the deleted priority when looking up by priorityId
    // The task-updated events (published separately) will update all affected tasks with the new priority
    setAvailablePriorities(prevPriorities => 
      prevPriorities.filter(p => p.id !== data.priorityId && p.id !== Number(data.priorityId))
    );
    console.log('📨 Priority removed from availablePriorities (affected tasks will be updated via task-updated events)');
  }, [setAvailablePriorities]);

  const handlePriorityReordered = useCallback(async (data: any) => {
    console.log('📨 Priority reordered via WebSocket:', data);
    try {
      const priorities = await getAllPriorities();
      setAvailablePriorities(priorities);
      console.log('📨 Priorities refreshed after reorder');
    } catch (error) {
      console.error('Failed to refresh priorities after reorder:', error);
    }
  }, [setAvailablePriorities]);

  // Sprint changes: broadcast via window event so App (setAvailableSprints) and AdminSprintSettingsTab both refetch.
  const handleSprintCreated = useCallback((data: any) => {
    console.log('📨 Sprint created via WebSocket:', data);
    window.dispatchEvent(new CustomEvent('sprints-updated'));
  }, []);

  const handleSprintUpdated = useCallback((data: any) => {
    console.log('📨 Sprint updated via WebSocket:', data);
    window.dispatchEvent(new CustomEvent('sprints-updated'));
  }, []);

  const handleSprintDeleted = useCallback((data: any) => {
    console.log('📨 Sprint deleted via WebSocket:', data);
    window.dispatchEvent(new CustomEvent('sprints-updated'));
  }, []);

  const handleSettingsUpdated = useCallback(async (data: any) => {
    // Settings values are applied in SettingsContext; here we react to AI toggles
    // so the Agent assignee appears/disappears without a full page reload.
    console.log('📨 [useSettingsWebSocket] Settings update received (handled by SettingsContext):', data);
    if (
      refreshMembers &&
      (data?.key === 'AI_ENABLED' || data?.key === 'AI_AGENT_NAME')
    ) {
      try {
        await refreshMembers();
      } catch (error) {
        console.error('Failed to refresh members after AI settings change:', error);
      }
    }
  }, [refreshMembers]);

  const handleInstanceStatusUpdated = useCallback((data: any) => {
    const status = data?.status || 'unavailable';
    versionStatus.setInstanceStatus({
      status,
      message: '',
      isDismissed: false
    });
    if (instanceStatusIsBlocking(status)) {
      handleAuthError('Workspace unavailable');
    }
  }, [versionStatus.setInstanceStatus]);

  const handleVersionUpdated = useCallback((_data: any) => {
    // DB APP_VERSION / legacy version-updated is not used for reload or banner.
  }, []);

  const handleDeployStateUpdated = useCallback((data: any) => {
    console.log('📦 Fleet deploy state via WebSocket:', data);
    versionDetection.applyFleetSignal({
      version: data?.fleetVersion || data?.version,
      fleetVersion: data?.fleetVersion || data?.version,
      deployState: data?.deployState,
      podCount: typeof data?.podCount === 'number' ? data.podCount : undefined,
    });
  }, []);

  return {
    handleTagCreated,
    handleTagUpdated,
    handleTagDeleted,
    handlePriorityCreated,
    handlePriorityUpdated,
    handlePriorityDeleted,
    handlePriorityReordered,
    handleSprintCreated,
    handleSprintUpdated,
    handleSprintDeleted,
    handleSettingsUpdated,
    handleInstanceStatusUpdated,
    handleVersionUpdated,
    handleDeployStateUpdated,
  };
};

