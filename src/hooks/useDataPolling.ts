import { useState, useEffect, useRef } from 'react';
import { Board, TeamMember, Columns, SiteSettings, PriorityOption } from '../types';
import { POLLING_INTERVAL } from '../constants';
import * as api from '../api';
import { getAllPriorities, getActivityFeed, getSharedFilterViews, SavedFilterView, getBoardTaskRelationships } from '../api';

interface ActivityItem {
  id: number;
  action: string;
  details: string;
  member_name: string;
  role_name: string;
  board_title: string;
  column_title: string;
  taskId: string;
  created_at: string;
}

interface TaskRelationship {
  id: number;
  task_id: string;
  relationship: string;
  to_task_id: string;
  created_at: string;
}

export interface UserStatus {
  isActive: boolean;
  isAdmin: boolean;
  isViewer?: boolean;
  canMutate?: boolean;
  roles?: string[];
  forceLogout: boolean;
}

interface UseDataPollingProps {
  enabled: boolean;
  selectedBoard: string | null;
  currentBoards: Board[];
  currentMembers: TeamMember[];
  currentColumns: Columns;
  // currentSiteSettings removed - SettingsContext handles all settings
  currentPriorities: PriorityOption[];
  currentActivities?: ActivityItem[];
  currentSharedFilters?: SavedFilterView[];
  currentRelationships?: TaskRelationship[];
  includeSystem: boolean;
  onBoardsUpdate: (boards: Board[]) => void;
  onMembersUpdate: (members: TeamMember[]) => void;
  onColumnsUpdate: (columns: Columns) => void;
  // onSiteSettingsUpdate removed - SettingsContext handles all settings updates
  onPrioritiesUpdate: (priorities: PriorityOption[]) => void;
  onActivitiesUpdate?: (activities: ActivityItem[]) => void;
  onSharedFiltersUpdate?: (sharedFilters: SavedFilterView[]) => void;
  onRelationshipsUpdate?: (relationships: TaskRelationship[]) => void;
}

interface UseDataPollingReturn {
  isPolling: boolean;
  lastPollTime: Date | null;
  updateLastPollTime: () => void;
}

export const useDataPolling = ({
  enabled,
  selectedBoard,
  currentBoards,
  currentMembers,
  currentColumns,
  // currentSiteSettings removed - SettingsContext handles all settings
  currentPriorities,
  currentActivities = [],
  currentSharedFilters = [],
  currentRelationships = [],
  includeSystem,
  onBoardsUpdate,
  onMembersUpdate,
  onColumnsUpdate,
  // onSiteSettingsUpdate removed - SettingsContext handles all settings updates
  onPrioritiesUpdate,
  onActivitiesUpdate,
  onSharedFiltersUpdate,
  onRelationshipsUpdate,
}: UseDataPollingProps): UseDataPollingReturn => {
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);

  // Use refs to access current values without causing re-renders
  const currentBoardsRef = useRef(currentBoards);
  const currentMembersRef = useRef(currentMembers);
  const currentColumnsRef = useRef(currentColumns);
  // currentSiteSettingsRef removed - SettingsContext handles all settings
  const currentPrioritiesRef = useRef(currentPriorities);
  const currentActivitiesRef = useRef(currentActivities);
  const currentSharedFiltersRef = useRef(currentSharedFilters);
  const currentRelationshipsRef = useRef(currentRelationships);
  const includeSystemRef = useRef(includeSystem);

  // Update refs when props change
  currentBoardsRef.current = currentBoards;
  currentMembersRef.current = currentMembers;
  currentColumnsRef.current = currentColumns;
  // currentSiteSettingsRef removed - SettingsContext handles all settings
  currentPrioritiesRef.current = currentPriorities;
  currentActivitiesRef.current = currentActivities;
  currentSharedFiltersRef.current = currentSharedFilters;
  currentRelationshipsRef.current = currentRelationships;
  includeSystemRef.current = includeSystem;

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);

    const pollForUpdates = async () => {
      
      try {
        // Settings are now managed by SettingsContext - no need to fetch here
        const [loadedBoards, loadedMembers, loadedPriorities, loadedActivities, loadedSharedFilters, loadedRelationships] = await Promise.all([
          api.getBoards(),
          api.getMembers(includeSystemRef.current), // Use ref to avoid dependency on includeSystem
          getAllPriorities(),
          onActivitiesUpdate ? getActivityFeed() : Promise.resolve([]),
          onSharedFiltersUpdate ? getSharedFilterViews() : Promise.resolve([]),
          onRelationshipsUpdate && selectedBoard ? getBoardTaskRelationships(selectedBoard) : Promise.resolve([])
        ]);

        // Update boards list if it changed (efficient comparison)
        const boardsChanged = 
          currentBoardsRef.current.length !== loadedBoards.length ||
          !currentBoardsRef.current.every((board, index) => {
            const newBoard = loadedBoards[index];
            if (!newBoard || 
                board.id !== newBoard.id || 
                board.title !== newBoard.title ||
                board.position !== newBoard.position) {
              return false;
            }
            
            // Also check if tasks within the board have changed
            const currentTasks = board.columns ? Object.values(board.columns).flatMap(col => col.tasks || []) : [];
            const newTasks = newBoard.columns ? Object.values(newBoard.columns).flatMap(col => col.tasks || []) : [];
            
            if (currentTasks.length !== newTasks.length) {
              return false;
            }
            
            // Check if any task has changed (title, description, etc.)
            return currentTasks.every(currentTask => {
              const newTask = newTasks.find(t => t.id === currentTask.id);
              return newTask && 
                     currentTask.title === newTask.title &&
                     currentTask.description === newTask.description &&
                     currentTask.startDate === newTask.startDate &&
                     currentTask.dueDate === newTask.dueDate &&
                     currentTask.columnId === newTask.columnId &&
                     currentTask.position === newTask.position;
            });
          });

        if (boardsChanged) {
          onBoardsUpdate(loadedBoards);
        }

        // Update members list if it changed (efficient comparison)
        const membersChanged = 
          currentMembersRef.current.length !== loadedMembers.length ||
          !currentMembersRef.current.every((member, index) => {
            const newMember = loadedMembers[index];
            return newMember && 
                   member.id === newMember.id && 
                   member.name === newMember.name;
          });

        if (membersChanged) {
          onMembersUpdate(loadedMembers);
        }

        // Settings are now managed by SettingsContext - no need to update here
        // SettingsContext handles all settings updates via WebSocket

        // Update priorities if they changed
        const currentPrioritiesString = JSON.stringify(currentPriorities);
        const newPrioritiesString = JSON.stringify(loadedPriorities);

        if (currentPrioritiesString !== newPrioritiesString) {
          onPrioritiesUpdate(loadedPriorities || []);
        }

        // Update activities if they changed (efficient comparison)
        if (onActivitiesUpdate && loadedActivities) {
          const activitiesChanged = 
            currentActivitiesRef.current.length !== loadedActivities.length ||
            !currentActivitiesRef.current.every((activity, index) => {
              const newActivity = loadedActivities[index];
              return newActivity && 
                     activity.id === newActivity.id && 
                     activity.action === newActivity.action &&
                     activity.created_at === newActivity.created_at;
            });

          if (activitiesChanged) {
            onActivitiesUpdate(loadedActivities);
          }
        }

        // Update shared filters if they changed
        if (onSharedFiltersUpdate && loadedSharedFilters) {
          const currentSharedFiltersString = JSON.stringify(currentSharedFilters);
          const newSharedFiltersString = JSON.stringify(loadedSharedFilters);

          if (currentSharedFiltersString !== newSharedFiltersString) {
            onSharedFiltersUpdate(loadedSharedFilters);
          }
        }

        // Update relationships if they changed (efficient comparison to prevent memory leaks)
        if (onRelationshipsUpdate && loadedRelationships) {
          // Use efficient comparison instead of JSON.stringify to prevent memory leaks
          const relationshipsChanged = 
            currentRelationshipsRef.current.length !== loadedRelationships.length ||
            !currentRelationshipsRef.current.every((rel, index) => {
              const newRel = loadedRelationships[index];
              return newRel && 
                     rel.id === newRel.id && 
                     rel.task_id === newRel.task_id && 
                     rel.to_task_id === newRel.to_task_id &&
                     rel.relationship === newRel.relationship;
            });

          if (relationshipsChanged) {
            onRelationshipsUpdate(loadedRelationships);
          }
        }


        // Update columns for the current board if it changed (efficient comparison)
        if (selectedBoard) {
          const currentBoard = loadedBoards.find(b => b.id === selectedBoard);
          if (currentBoard) {
            // Use efficient comparison instead of JSON.stringify to prevent memory leaks
            const currentColumnIds = Object.keys(currentColumnsRef.current);
            const newColumnIds = Object.keys(currentBoard.columns || {});
            
            const columnsChanged = 
              currentColumnIds.length !== newColumnIds.length ||
              !currentColumnIds.every(id => {
                const currentCol = currentColumnsRef.current[id];
                const newCol = currentBoard.columns?.[id];
                if (!newCol) return false;
                
                // Check basic column properties
                if (currentCol?.title !== newCol.title ||
                    currentCol?.position !== newCol.position ||
                    currentCol?.tasks?.length !== newCol.tasks?.length) {
                  return false;
                }
                
                // Check if any task properties changed (priority, title, dates, etc.)
                const currentTasks = currentCol?.tasks || [];
                const newTasks = newCol.tasks || [];
                
                if (currentTasks.length !== newTasks.length) {
                  return false;
                }
                
                // Check each task for property changes
                return currentTasks.every(currentTask => {
                  const newTask = newTasks.find(t => t.id === currentTask.id);
                  if (!newTask) return false;
                  
                  // Check key properties that affect the UI
                  return currentTask.title === newTask.title &&
                         currentTask.priority === newTask.priority &&
                         currentTask.startDate === newTask.startDate &&
                         currentTask.dueDate === newTask.dueDate &&
                         currentTask.description === newTask.description &&
                         currentTask.memberId === newTask.memberId;
                });
              });

            if (columnsChanged) {
              // Check if we just updated from WebSocket to avoid overriding
              if (window.justUpdatedFromWebSocket) {
                return;
              }
              onColumnsUpdate(currentBoard.columns || {});
            } else {
            }
          }
        }

        setLastPollTime(new Date());
      } catch (error) {
        // Silent error handling for polling
      }
    };

    // Initial poll
    pollForUpdates();

    // Set up interval
    const interval = setInterval(pollForUpdates, POLLING_INTERVAL);

    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [
    enabled,
    selectedBoard,
    onBoardsUpdate,
    onMembersUpdate,
    onColumnsUpdate,
    // onSiteSettingsUpdate removed - SettingsContext handles all settings updates
    onSharedFiltersUpdate,
    onRelationshipsUpdate,
  ]);

  const updateLastPollTime = () => {
    setLastPollTime(new Date());
  };

  return {
    isPolling,
    lastPollTime,
    updateLastPollTime,
  };
};
