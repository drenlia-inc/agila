import { useCallback } from 'react';
import { TeamMember, SavedFilterView } from '../types';
import { getMembers, getCurrentUser } from '../api';
import { normalizeTeamMemberFromEvent } from '../utils/memberUtils';

interface UseMemberWebSocketProps {
  // State setters
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<any>>;
  
  // Callbacks
  handleMembersUpdate: (newMembers: TeamMember[]) => void;
  handleActivitiesUpdate: (newActivities: any[]) => void;
  syncActivityDelta: () => Promise<void>;
  handleSharedFilterViewsUpdate: (newFilters: SavedFilterView[]) => void;
  
  // Task filters hook
  taskFilters: {
    includeSystem: boolean;
    setSharedFilterViews: React.Dispatch<React.SetStateAction<SavedFilterView[]>>;
  };
  
  // Current user
  currentUser: { id: string } | null | undefined;
}

export const useMemberWebSocket = ({
  setMembers,
  setCurrentUser,
  handleMembersUpdate,
  handleActivitiesUpdate,
  syncActivityDelta,
  handleSharedFilterViewsUpdate,
  taskFilters,
  currentUser,
}: UseMemberWebSocketProps) => {
  
  const handleMemberCreated = useCallback((data: any) => {
    if (!data?.member) return;
    const incoming = normalizeTeamMemberFromEvent(data.member, {
      assumeInactiveIfLinked: true,
    }) as TeamMember;
    if (!incoming.id) return;
    // Merge into list — do not replace the whole members array with a single entry
    setMembers(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const exists = list.some(m => m.id === incoming.id);
      if (exists) {
        return list.map(m => (m.id === incoming.id ? { ...m, ...incoming } : m));
      }
      return [...list, incoming];
    });
  }, [setMembers]);

  const handleUserUpdated = useCallback((data: any) => {
    const user = data?.user;
    if (!user?.id) return;
    const isActive =
      user.isActive === false || user.isActive === 0 || user.isActive === 'false'
        ? false
        : user.isActive === undefined
          ? undefined
          : true;
    setMembers((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((member) => {
        if (!member.user_id || String(member.user_id) !== String(user.id)) return member;
        return {
          ...member,
          ...(user.email != null ? { email: String(user.email) } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(isActive === true ? { hasActivated: true } : {}),
        };
      });
    });
  }, [setMembers]);

  const handleMemberUpdated = useCallback(async (data: any) => {
    // Update the specific member in the members list
    if (data.member) {
      const incoming = normalizeTeamMemberFromEvent(data.member);
      if (!incoming.id) return;
      setMembers(prevMembers => {
        const list = Array.isArray(prevMembers) ? prevMembers : [];
        const memberExists = list.some(member => member.id === incoming.id);
        
        if (memberExists) {
          return list.map(member => 
            member.id === incoming.id ? { ...member, ...incoming } : member
          );
        }
        console.log('📨 Adding new member to list:', incoming);
        return [...list, incoming as TeamMember];
      });
    } else {
      // Fallback: refresh entire members list
      try {
        const loadedMembers = await getMembers(taskFilters.includeSystem);
        setMembers(Array.isArray(loadedMembers) ? loadedMembers : []);
      } catch (error) {
        console.error('Failed to refresh members after update:', error);
      }
    }
  }, [setMembers, taskFilters.includeSystem]);

  const applyMembersFromServer = useCallback(async () => {
    try {
      const loadedMembers = await getMembers(taskFilters.includeSystem);
      setMembers(Array.isArray(loadedMembers) ? loadedMembers : []);
    } catch (error) {
      console.error('Failed to refresh members after deletion:', error);
    }
  }, [setMembers, taskFilters.includeSystem]);

  const removeMemberLocally = useCallback((data: any) => {
    const userId = data?.userId ?? data?.user?.id;
    const memberId = data?.memberId;
    const email = String(data?.userEmail || data?.user?.email || '').trim().toLowerCase();
    setMembers((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.filter((m) => {
        if (memberId != null && String(m.id) === String(memberId)) return false;
        if (userId != null && m.user_id != null && String(m.user_id) === String(userId)) return false;
        if (email && m.email && String(m.email).trim().toLowerCase() === email) return false;
        return true;
      });
    });
  }, [setMembers]);

  const handleMemberDeleted = useCallback(async (data: any) => {
    removeMemberLocally(data);
    await applyMembersFromServer();
  }, [removeMemberLocally, applyMembersFromServer]);

  const handleUserDeleted = useCallback(async (data: any) => {
    removeMemberLocally(data);
    await applyMembersFromServer();
  }, [removeMemberLocally, applyMembersFromServer]);

  const handleUserProfileUpdated = useCallback(async (data: any) => {
    // If this is the current user's profile update, refresh currentUser
    if (data.userId === currentUser?.id) {
      try {
        const response = await getCurrentUser();
        setCurrentUser(response.user);
      } catch (error) {
        console.error('Failed to refresh current user after profile update:', error);
      }
    }
    
    // Refresh members list to update display name and avatar
    try {
      const loadedMembers = await getMembers(taskFilters.includeSystem);
      setMembers(Array.isArray(loadedMembers) ? loadedMembers : []);
    } catch (error) {
      console.error('Failed to refresh members after profile update:', error);
    }
  }, [currentUser?.id, taskFilters.includeSystem, setCurrentUser, setMembers]);

  const handleActivityUpdated = useCallback(async (data: any) => {
    // Minimal WebSocket payload — fetch only rows newer than what we already have.
    if (data.activities && Array.isArray(data.activities) && data.activities.length > 0) {
      handleActivitiesUpdate(data.activities);
    } else {
      await syncActivityDelta();
    }
  }, [handleActivitiesUpdate, syncActivityDelta]);

  const handleFilterCreated = useCallback((data: any) => {
    // Refresh shared filters list
    if (data.filter && data.filter.shared) {
      handleSharedFilterViewsUpdate([data.filter]);
    }
  }, [handleSharedFilterViewsUpdate]);

  const handleFilterUpdated = useCallback((data: any) => {
    // Handle filter sharing/unsharing
    if (data.filter) {
      if (data.filter.shared) {
        // Filter was shared or updated - add/update it
        handleSharedFilterViewsUpdate([data.filter]);
      } else {
        // Filter was unshared - remove it from the list
        taskFilters.setSharedFilterViews(prev => prev.filter(f => f.id !== data.filter.id));
      }
    }
  }, [handleSharedFilterViewsUpdate, taskFilters.setSharedFilterViews]);

  const handleFilterDeleted = useCallback((data: any) => {
    console.log('📨 Filter deleted via WebSocket:', data);
    // Remove from shared filters list
    if (data.filterId) {
      const filterIdToDelete = parseInt(data.filterId, 10);
      taskFilters.setSharedFilterViews(prev => prev.filter(f => f.id !== filterIdToDelete));
    }
  }, [taskFilters.setSharedFilterViews]);

  return {
    handleMemberCreated,
    handleMemberUpdated,
    handleUserUpdated,
    handleMemberDeleted,
    handleUserDeleted,
    handleUserProfileUpdated,
    handleActivityUpdated,
    handleFilterCreated,
    handleFilterUpdated,
    handleFilterDeleted,
  };
};

