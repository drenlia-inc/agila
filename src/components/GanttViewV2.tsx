import React, { useState, useRef, useCallback, useMemo, useEffect, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, DragEndEvent, DragStartEvent, DragOverEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { Task, Columns } from '../types';
import GanttTaskList from './gantt/GanttTaskList';
import GanttTimeline from './gantt/GanttTimeline';
import { createPortal } from 'react-dom';
import TaskDependencyArrows from './gantt/TaskDependencyArrows';
import { DRAG_TYPES, GanttDragItem } from './gantt/types';
import { GanttHeader } from './gantt/GanttHeader';
import { GanttHeaderLegendPortal } from './gantt/GanttHeaderLegendPortal';
import { getAllPriorities, addTaskRelationship, removeTaskRelationship, getUserSettings, batchUpdateTasks } from '../api';
import websocketClient from '../services/websocketClient';
import { loadUserPreferencesAsync, saveUserPreferences, loadUserPreferences } from '../utils/userPreferences';
import { useGanttScrollPosition, getLeftmostVisibleDateFromDOM } from '../hooks/useGanttScrollPosition';
import {
  clampGanttTaskColumnWidth,
  GANTT_TASK_COLUMN_DEFAULT_WIDTH,
} from './gantt/ganttLayout';

interface GanttViewV2Props {
  columns: Columns;
  onSelectTask: (task: Task | null) => void;
  selectedTask?: Task | null;
  taskViewMode?: 'expand' | 'compact' | 'shrink';
  onUpdateTask?: (task: Task) => void;
  onTaskDragStart?: (task: Task) => void;
  onTaskDragEnd?: () => void;
  onClearDragState?: () => void;
  boardId?: string | null;
  onAddTask?: (columnId: string, startDate?: string, dueDate?: string) => Promise<void>;
  currentUser?: any;
  members?: any[];
  onRefreshData?: () => Promise<void>;
  relationships?: any[];
  onCopyTask?: (task: Task) => Promise<void>;
  onRemoveTask?: (taskId: string, event?: React.MouseEvent) => Promise<void>;
  siteSettings?: { [key: string]: string };
  /** false for viewer — disable timeline drag / create / mutation actions */
  canMutate?: boolean;
  onMoveTaskToColumn?: (taskId: string, targetColumnId: string) => Promise<void>;
  onReorderTaskInColumn?: (taskId: string, columnId: string, targetIndex: number) => Promise<void>;
}

// Parse date helper
const parseLocalDate = (dateInput: string | Date): Date => {
  if (!dateInput) return new Date();
  
  // If it's already a Date object, return it
  if (dateInput instanceof Date) {
    return dateInput;
  }
  
  // If it's a string, parse it
  if (typeof dateInput === 'string') {
    const dateOnly = dateInput.split('T')[0];
    const [year, month, day] = dateOnly.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  
  // Fallback
  return new Date();
};

// Format date helper for local dates
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const GanttViewV2 = ({
  columns,
  onSelectTask,
  selectedTask,
  taskViewMode = 'expand',
  onUpdateTask: onUpdateTaskProp,
  onTaskDragStart,
  onTaskDragEnd,
  onClearDragState,
  boardId,
  onAddTask,
  currentUser,
  members,
  onRefreshData,
  relationships = [],
  onCopyTask,
  onRemoveTask,
  siteSettings,
  canMutate = true,
  onMoveTaskToColumn,
  onReorderTaskInColumn,
}: GanttViewV2Props) => {
  const { t } = useTranslation('common');
  const onUpdateTask = (task: Task) => {
    if (!canMutate || !onUpdateTaskProp) return;
    return onUpdateTaskProp(task);
  };
  // State
  const [priorities, setPriorities] = useState<any[]>([]);
  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const activeDragItemRef = useRef<any>(null);
  const [currentHoverDate, setCurrentHoverDate] = useState<string | null>(null);
  const [taskColumnWidth, setTaskColumnWidth] = useState(GANTT_TASK_COLUMN_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [isMultiSelectMode, setIsMultiSelectModeState] = useState(false);
  
  // Custom setter that also updates the immediate ref
  const setIsMultiSelectMode = useCallback((value: boolean) => {
    setIsMultiSelectModeState(value);
    isMultiSelectModeImmediateRef.current = value;
  }, []);
  
  const [isRelationshipMode, setIsRelationshipMode] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [selectedParentTask, setSelectedParentTask] = useState<string | null>(null);
  const selectedParentTaskRef = useRef<string | null>(null);
  const shiftHeldInLinkModeRef = useRef(false);

  // Local relationships state for optimistic updates
  const [localRelationships, setLocalRelationships] = useState<any[]>([]);
  const lastRelationshipClickRef = useRef<number>(0);

  useEffect(() => {
    selectedParentTaskRef.current = selectedParentTask;
  }, [selectedParentTask]);

  useEffect(() => {
    if (!isRelationshipMode) {
      shiftHeldInLinkModeRef.current = false;
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftHeldInLinkModeRef.current = true;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftHeldInLinkModeRef.current = false;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRelationshipMode]);
  
  // Sync relationships from props, but preserve optimistic updates
  useEffect(() => {
    if (relationships && relationships.length >= 0) {
      // Always merge: keep optimistic updates (temp or confirmed IDs) and add new server relationships
      // Match relationships by task_id and to_task_id to avoid duplicates
      const optimisticRelationships = localRelationships.filter(rel => 
        typeof rel.id === 'string' && (rel.id.startsWith('temp-') || rel.id.startsWith('confirmed-'))
      );
      
      // Create a set of existing relationships from server (by taskId + toTaskId)
      // Support both camelCase (from API) and snake_case (from optimistic updates)
      const serverRelationshipKeys = new Set(
        relationships.map(rel => {
          const taskId = rel.taskId || rel.task_id;
          const toTaskId = rel.toTaskId || rel.to_task_id;
          return `${taskId}-${toTaskId}`;
        })
      );
      
      // Keep optimistic relationships that don't have a server match yet
      const unmatchedOptimistic = optimisticRelationships.filter(rel => {
        const taskId = rel.taskId || rel.task_id;
        const toTaskId = rel.toTaskId || rel.to_task_id;
        const key = `${taskId}-${toTaskId}`;
        return !serverRelationshipKeys.has(key);
      });
      
      // Merge server relationships with unmatched optimistic ones
      // Server relationships take precedence (they're the source of truth)
      const mergedRelationships = [...relationships, ...unmatchedOptimistic];
      setLocalRelationships(mergedRelationships);
    } else if (relationships && relationships.length === 0 && localRelationships.length === 0) {
      // If both are empty, ensure localRelationships is also empty
      setLocalRelationships([]);
    }
  }, [relationships]);

  // Reset modes when switching boards
  useEffect(() => {
    // Exit multi-select mode when switching boards
    if (isMultiSelectMode) {
      setIsMultiSelectMode(false);
      setSelectedTasks([]);
      setHighlightedTaskId(null);
    }
    
    // Exit relationship mode when switching boards
    if (isRelationshipMode) {
      setIsRelationshipMode(false);
      setSelectedParentTask(null);
    }
  }, [boardId]); // Reset when boardId changes

  // Viewers cannot use select/link modes
  useEffect(() => {
    if (canMutate) return;
    if (isMultiSelectMode) {
      setIsMultiSelectMode(false);
      setSelectedTasks([]);
      setHighlightedTaskId(null);
    }
    if (isRelationshipMode) {
      setIsRelationshipMode(false);
      setSelectedParentTask(null);
    }
  }, [canMutate, isMultiSelectMode, isRelationshipMode, setIsMultiSelectMode]);
  
  // Ref to store current columns for keyboard navigation
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  
  // Refs to store current state for keyboard navigation
  const isMultiSelectModeRef = useRef(isMultiSelectMode);
  isMultiSelectModeRef.current = isMultiSelectMode;

  
  const selectedTasksRef = useRef(selectedTasks);
  selectedTasksRef.current = selectedTasks;
  
  // Debouncing for arrow key navigation
  const arrowKeyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isArrowKeyPressedRef = useRef(false);
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map());
  const updateBatchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Flag to prevent task selection immediately after exiting multi-select mode
  const isExitingMultiSelectRef = useRef(false);
  
  // Flag to track if we're in multi-select mode (immediate, not dependent on state)
  const isMultiSelectModeImmediateRef = useRef(false);
  const [localDragState, setLocalDragState] = useState<any>({
    isDragging: false,
    draggedTaskId: null,
    localTaskData: {},
    originalTaskData: {}
  });
  const localDragStateRef = useRef(localDragState);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [taskCreationStart, setTaskCreationStart] = useState<any>(null);
  
  // Task jump dropdown state
  const [showTaskJumpDropdown, setShowTaskJumpDropdown] = useState(false);
  const taskJumpRef = useRef<HTMLDivElement>(null);
  
  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const dropdown = document.querySelector('.task-jump-dropdown');
      if (taskJumpRef.current && !taskJumpRef.current.contains(target) && 
          dropdown && !dropdown.contains(target)) {
        setShowTaskJumpDropdown(false);
      }
    };
    
    if (showTaskJumpDropdown) {
      // Use setTimeout to avoid closing immediately on the same click that opened it
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTaskJumpDropdown]);
  const [taskCreationEnd, setTaskCreationEnd] = useState<any>(null);
  const [taskPositions, setTaskPositions] = useState<Map<string, {x: number, y: number, width: number, height: number}>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const ganttStickyHeaderRef = useRef<HTMLDivElement>(null);

  // Date range (simplified for now)
  const [dateRange, setDateRange] = useState<any[]>([]);
  
  // Board loading state for scroll position restoration
  const [isBoardLoading, setIsBoardLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSwitchingBoards, setIsSwitchingBoards] = useState(false);
  
  
  // Scroll position persistence hook
  const {
    isLoading: isScrollLoading,
    lastSavedScrollDate,
    saveCurrentScrollPosition,
    flushPendingSave,
    getSavedScrollPosition,
    calculateCenterDate,
    calculateScrollPosition
  } = useGanttScrollPosition({ boardId: boardId || null, currentUser });

  
  // Constants for date range management
  const MAX_DAYS_IN_VIEW = 365; // Maximum days to keep in memory
  const BUFFER_DAYS = 60; // Days to add when extending
  const VIEWPORT_DAYS = 180; // Days to show around target when jumping
  
  // Helper function to generate date range
  const generateDateRange = useCallback((startDate: Date, endDate: Date) => {
    const range = [];
    const current = new Date(startDate);
    const today = new Date();
    
    while (current <= endDate) {
      range.push({
        date: new Date(current),
        isToday: current.toDateString() === today.toDateString(),
        isWeekend: current.getDay() === 0 || current.getDay() === 6
      });
      current.setDate(current.getDate() + 1);
    }
    
    return range;
  }, []);
  
  // Navigate to a specific date with sliding window
  const navigateToDate = useCallback((targetDate: Date, position: 'start' | 'center' | 'end' = 'center') => {
    if (!scrollContainerRef.current) {
      return;
    }
    
    // Calculate new date range centered around target
    const newStart = new Date(targetDate);
    const newEnd = new Date(targetDate);
    
    if (position === 'start') {
      newStart.setDate(newStart.getDate() - 30);
      newEnd.setDate(newEnd.getDate() + VIEWPORT_DAYS - 30);
    } else if (position === 'end') {
      newStart.setDate(newStart.getDate() - VIEWPORT_DAYS + 30);
      newEnd.setDate(newEnd.getDate() + 30);
    } else {
      // Center
      newStart.setDate(newStart.getDate() - VIEWPORT_DAYS / 2);
      newEnd.setDate(newEnd.getDate() + VIEWPORT_DAYS / 2);
    }
    
    // Generate new range
    const newRange = generateDateRange(newStart, newEnd);
    setDateRange(newRange);
    
    // Calculate scroll position after state update
    setTimeout(() => {
      const targetIndex = newRange.findIndex(d => 
        d.date.toISOString().split('T')[0] === targetDate.toISOString().split('T')[0]
      );
      
      if (targetIndex >= 0 && scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        let scrollPosition;
        
        if (position === 'start') {
          scrollPosition = targetIndex * 40;
        } else if (position === 'end') {
          scrollPosition = (targetIndex * 40) - container.clientWidth + 40;
        } else {
          scrollPosition = (targetIndex * 40) - (container.clientWidth / 2) + 20;
        }
        
        container.scrollLeft = Math.max(0, scrollPosition);
        
        // Save scroll position after navigation
        saveCurrentScrollPosition(container, newRange, { immediate: true, targetBoardId: boardId || undefined });
      }
    }, 50);
  }, [generateDateRange, saveCurrentScrollPosition]);
  
  // Handle task jump from dropdown with highlighting and scrolling
  const handleJumpToTask = useCallback((task: any) => {
    if (!task.startDate || !task.endDate) {
      return;
    }

    // Use async wrapper to handle the promise
    (async () => {
      try {
        // First, scroll horizontally to the task
        navigateToDate(task.startDate, 'center');
        
        // Wait for horizontal scroll to complete before highlighting
        setTimeout(() => {
          // Highlight the task for 1 second
          setHighlightedTaskId(task.id);
          setTimeout(() => {
            setHighlightedTaskId(null);
          }, 1000);
        }, 400); // Wait for horizontal scroll to complete
        
        // Scroll vertically to task if not visible (after horizontal scroll completes)
        setTimeout(() => {
          const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
          
          if (taskElement) {
            const taskRect = taskElement.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            
            // Check if task is outside the visible viewport (with buffer)
            const buffer = 100;
            const isAboveViewport = taskRect.top < buffer;
            const isBelowViewport = taskRect.bottom > viewportHeight - buffer;
            
            if (isAboveViewport || isBelowViewport) {
              // Find the scrollable parent (could be document or a parent container)
              let scrollableParent = taskElement.parentElement;
              while (scrollableParent && scrollableParent !== document.body) {
                const style = window.getComputedStyle(scrollableParent);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
                  break;
                }
                scrollableParent = scrollableParent.parentElement;
              }
              
              // If no scrollable parent found, use window scrolling
              if (!scrollableParent || scrollableParent === document.body) {
                // Scroll the page to bring task into view
                const targetY = window.pageYOffset + taskRect.top - (viewportHeight / 2) + (taskRect.height / 2);
                window.scrollTo({
                  top: Math.max(0, targetY),
                  behavior: 'smooth'
                });
              } else {
                // Scroll within the parent container
                const containerRect = scrollableParent.getBoundingClientRect();
                const relativeTop = taskRect.top - containerRect.top;
                const targetScrollTop = scrollableParent.scrollTop + relativeTop - (containerRect.height / 2) + (taskRect.height / 2);
                
                scrollableParent.scrollTo({
                  top: Math.max(0, targetScrollTop),
                  behavior: 'smooth'
                });
              }
            }
          }
        }, 500); // Wait a bit longer for horizontal scroll to complete
      } catch (error) {
        console.error('Error jumping to task:', error);
      }
    })();
  }, [navigateToDate]);
  
  // Combined keyboard handler for ESC/Enter and arrow key navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle ESC key to exit relationship mode and multi-select mode
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isRelationshipMode) {
          setIsRelationshipMode(false);
          setSelectedParentTask(null);
        }
        if (isMultiSelectMode) {
          // Immediately set flags to prevent task selection
          isExitingMultiSelectRef.current = true;
          isMultiSelectModeImmediateRef.current = false; // Immediately disable multi-select mode
          
          // Reset all states (custom setter will update immediate ref)
          setIsMultiSelectMode(false);
          setSelectedTasks([]);
          setHighlightedTaskId(null); // Clear any highlighted tasks
          // Clear any active drag state to prevent frozen tasks
          setActiveDragItem(null);
          activeDragItemRef.current = null;
          // Clear local drag state to prevent stale data from arrow key movement
          setLocalDragState({
            isDragging: false,
            draggedTaskId: null,
            localTaskData: {},
            originalTaskData: {}
          });
          // Reset arrow key state to prevent frozen tasks
          isArrowKeyPressedRef.current = false;
          if (arrowKeyTimeoutRef.current) {
            clearTimeout(arrowKeyTimeoutRef.current);
            arrowKeyTimeoutRef.current = null;
          }
          
          // Clear any stuck drag state without triggering cooldown
          if (onClearDragState) {
            onClearDragState();
          }
          
          // Clear the exit flag after a short delay
          setTimeout(() => {
            isExitingMultiSelectRef.current = false;
          }, 100);
        }
        return;
      }
      
      // Handle Enter key to exit relationship mode and multi-select mode
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation(); // Prevent other Enter key handlers from firing
        
        // Use a single state update to ensure all changes happen atomically
        if (isRelationshipMode || isMultiSelectMode) {
          
          // Immediately set flags to prevent task selection
          isExitingMultiSelectRef.current = true;
          isMultiSelectModeImmediateRef.current = false; // Immediately disable multi-select mode
          
          // Reset all states in one go (custom setter will update immediate ref)
          setIsRelationshipMode(false);
          setSelectedParentTask(null);
          setIsMultiSelectMode(false);
          setSelectedTasks([]);
          setHighlightedTaskId(null);
          
          // Clear any active drag state
          setActiveDragItem(null);
          activeDragItemRef.current = null;
          
          // Clear local drag state
          setLocalDragState({
            isDragging: false,
            draggedTaskId: null,
            localTaskData: {},
            originalTaskData: {}
          });
          
          // Reset arrow key state
          isArrowKeyPressedRef.current = false;
          if (arrowKeyTimeoutRef.current) {
            clearTimeout(arrowKeyTimeoutRef.current);
            arrowKeyTimeoutRef.current = null;
          }
          
          // Clear any stuck drag state without triggering cooldown
          if (onClearDragState) {
            onClearDragState();
          }
          
          // Clear the exit flag after a short delay to allow state updates to complete
          setTimeout(() => {
            isExitingMultiSelectRef.current = false;
          }, 100);
        }
        return;
      }
      
      // Handle arrow key navigation for selected tasks (only in multi-select mode)
      if (isMultiSelectModeRef.current && selectedTasksRef.current.length > 0) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          
          // If arrow key is already being processed, ignore this event
          if (isArrowKeyPressedRef.current) {
            return;
          }
          
          // Set flag to prevent multiple rapid calls
          isArrowKeyPressedRef.current = true;
          
          const moveAmount = event.key === 'ArrowLeft' ? -1 : 1; // Move left or right by 1 day
          
          // Clear any existing timeout
          if (arrowKeyTimeoutRef.current) {
            clearTimeout(arrowKeyTimeoutRef.current);
          }
          
          // Batch updates to prevent rapid-fire WebSocket events
          const batchUpdates = async () => {
            const updates = Array.from(pendingUpdatesRef.current.values());
            if (updates.length > 0) {
              try {
                // Use batch update API for better performance (single HTTP request instead of N)
                // Note: Optimistic updates were already applied via onUpdateTask calls above
                // This batch update ensures the server state is synced correctly
                // The individual onUpdateTask calls above already made API calls, but this batch
                // ensures all updates are processed together on the server side
                await batchUpdateTasks(updates);
                // WebSocket events will confirm the updates, but optimistic updates are already visible
              } catch (error) {
                console.error('❌ [Gantt] Batch update failed:', error);
                // If batch fails, the optimistic updates from onUpdateTask are already applied
                // The WebSocket events or error handling in handleEditTask will handle rollback if needed
              }
              pendingUpdatesRef.current.clear();
            }
          };

          // Clear any existing batch timeout
          if (updateBatchTimeoutRef.current) {
            clearTimeout(updateBatchTimeoutRef.current);
          }

          // Move all selected tasks and apply optimistic updates immediately
          selectedTasksRef.current.forEach((taskId) => {
            // Find the original task from columns to get the full task data
            const originalTask = Object.values(columnsRef.current)
              .flatMap(col => col.tasks || [])
              .find(t => t.id === taskId);
              
            if (originalTask && originalTask.startDate && originalTask.dueDate) {
              // Parse dates properly using the parseLocalDate function
              const parsedStartDate = parseLocalDate(originalTask.startDate);
              const parsedDueDate = parseLocalDate(originalTask.dueDate);
              
              const newStartDate = new Date(parsedStartDate);
              const newDueDate = new Date(parsedDueDate);
              
              newStartDate.setDate(newStartDate.getDate() + moveAmount);
              newDueDate.setDate(newDueDate.getDate() + moveAmount);
              
              // Create updated task object with proper date format
              const updatedTask = {
                ...originalTask,
                startDate: formatLocalDate(newStartDate), // Format as YYYY-MM-DD
                dueDate: formatLocalDate(newDueDate) // Format as YYYY-MM-DD
              };
              
              // Apply optimistic update immediately for instant UI feedback
              // Note: onUpdateTask will make an API call, but we need it for optimistic updates
              // The batch update below will ensure server consistency, but the optimistic update
              // ensures the UI responds immediately to arrow key presses
              if (onUpdateTask) {
                // Call onUpdateTask for optimistic update (updates UI immediately)
                // This will update the columns state in App.tsx via handleEditTask
                // It will also make an API call, but that's acceptable for immediate feedback
                onUpdateTask(updatedTask).catch(error => {
                  console.error(`Failed to update task ${taskId} optimistically:`, error);
                });
              }
              
              // Also queue for batch update to ensure server consistency
              // (The individual onUpdateTask calls above will also update the server,
              // but the batch update ensures all updates are processed together)
              pendingUpdatesRef.current.set(taskId, updatedTask);
            }
          });

          // Set a timeout to batch all server updates together
          // The optimistic updates are already applied via onUpdateTask above
          updateBatchTimeoutRef.current = setTimeout(batchUpdates, 150);
          
          // Reset flag after a longer delay to prevent rapid key presses
          arrowKeyTimeoutRef.current = setTimeout(() => {
            isArrowKeyPressedRef.current = false;
          }, 200); // Increased to 200ms debounce
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Reset flag immediately on key release
        isArrowKeyPressedRef.current = false;
        if (arrowKeyTimeoutRef.current) {
          clearTimeout(arrowKeyTimeoutRef.current);
          arrowKeyTimeoutRef.current = null;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      // Cleanup timeouts on unmount
      if (arrowKeyTimeoutRef.current) {
        clearTimeout(arrowKeyTimeoutRef.current);
      }
      if (updateBatchTimeoutRef.current) {
        clearTimeout(updateBatchTimeoutRef.current);
      }
    };
  }, [isRelationshipMode, isMultiSelectMode, selectedParentTask, selectedTasks, onUpdateTask]);
  
  // Initialize date range with a reasonable default (only if no boardId)
  useEffect(() => {
    if (boardId) {
      // Board initialization will handle date range setup
      return;
    }
    
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 60); // 60 days in past
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 120); // 120 days in future
    
    setDateRange(generateDateRange(startDate, endDate));
  }, [generateDateRange, boardId]);
  
  // Extend date range when scrolling near edges with sliding window
  useEffect(() => {
    const timeline = scrollContainerRef.current;
    if (!timeline) return;
    
    let isExtending = false;
    let scrollTimeout: NodeJS.Timeout;
    
    const handleScroll = () => {
      // Clear previous timeout
      clearTimeout(scrollTimeout);
      
      // Throttle the actual logic
      scrollTimeout = setTimeout(() => {
        if (isExtending || dateRange.length === 0) return;
        
        const scrollLeft = timeline.scrollLeft;
        const scrollWidth = timeline.scrollWidth;
        const clientWidth = timeline.clientWidth;
        
        // Check if near the end (within 500px)
        if (scrollLeft + clientWidth > scrollWidth - 500) {
          isExtending = true;
          
          requestAnimationFrame(() => {
            setDateRange(prev => {
              const lastDate = new Date(prev[prev.length - 1].date);
              const today = new Date();
              const newDates = [];
              
              // Add new dates
              for (let i = 1; i <= BUFFER_DAYS; i++) {
                const newDate = new Date(lastDate);
                newDate.setDate(newDate.getDate() + i);
                newDates.push({
                  date: newDate,
                  isToday: newDate.toDateString() === today.toDateString(),
                  isWeekend: newDate.getDay() === 0 || newDate.getDay() === 6
                });
              }
              
              // Apply sliding window - remove old dates if exceeding max
              let updatedRange = [...prev, ...newDates];
              if (updatedRange.length > MAX_DAYS_IN_VIEW) {
                const toRemove = updatedRange.length - MAX_DAYS_IN_VIEW;
                updatedRange = updatedRange.slice(toRemove);
                
                // Adjust scroll position
                requestAnimationFrame(() => {
                  if (timeline) {
                    timeline.scrollLeft = Math.max(0, scrollLeft - (toRemove * 40));
                  }
                });
              }
              
              isExtending = false;
              return updatedRange;
            });
          });
        }
        
        // Check if near the start (within 500px)
        if (scrollLeft < 500) {
          isExtending = true;
          const currentScrollLeft = scrollLeft;
          
          requestAnimationFrame(() => {
            setDateRange(prev => {
              const firstDate = new Date(prev[0].date);
              const today = new Date();
              const newDates = [];
              
              // Add new dates
              for (let i = BUFFER_DAYS; i >= 1; i--) {
                const newDate = new Date(firstDate);
                newDate.setDate(newDate.getDate() - i);
                newDates.push({
                  date: newDate,
                  isToday: newDate.toDateString() === today.toDateString(),
                  isWeekend: newDate.getDay() === 0 || newDate.getDay() === 6
                });
              }
              
              // Apply sliding window - remove old dates if exceeding max
              let updatedRange = [...newDates, ...prev];
              let removedFromEnd = 0;
              if (updatedRange.length > MAX_DAYS_IN_VIEW) {
                removedFromEnd = updatedRange.length - MAX_DAYS_IN_VIEW;
                updatedRange = updatedRange.slice(0, MAX_DAYS_IN_VIEW);
              }
              
              // Adjust scroll position to maintain view
              requestAnimationFrame(() => {
                if (timeline) {
                  timeline.scrollLeft = currentScrollLeft + (BUFFER_DAYS * 40);
                }
              });
              
              isExtending = false;
              return updatedRange;
            });
          });
        }
        
        // Save scroll position after any scroll event (debounced)
        if (!isBoardLoading && !isInitializing && !isSwitchingBoards) {
          saveCurrentScrollPosition(timeline, dateRange, { targetBoardId: boardId || undefined });
          // Update debug overlay after saving with a longer delay to ensure cookie is written
        } else {
        }
      }, 100); // 100ms throttle
    };
    
    timeline.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      timeline.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [dateRange.length, isBoardLoading, isInitializing, isSwitchingBoards, saveCurrentScrollPosition]);


  // Load priorities
  useEffect(() => {
    getAllPriorities()
      .then(priorities => {
        setPriorities(priorities);
      })
      .catch(error => {
        console.error('❌ Failed to load priorities:', error);
      });
  }, []);

  // Load task column width from user preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const preferences = await loadUserPreferencesAsync();
        setTaskColumnWidth(clampGanttTaskColumnWidth(preferences.ganttTaskColumnWidth));
      } catch (error) {
        // Keep default value
      }
    };
    loadPreferences();
  }, []);

  // Save task column width to user preferences when it changes (heavily debounced for performance)
  useEffect(() => {
    const savePreference = () => {
      // Use requestIdleCallback for non-blocking operation
      if ('requestIdleCallback' in window) {
        requestIdleCallback(async () => {
          try {
            const currentPreferences = await loadUserPreferencesAsync();
            await saveUserPreferences({
              ...currentPreferences,
              ganttTaskColumnWidth: taskColumnWidth
            });
          } catch (error) {
            // Silent fail to avoid blocking
          }
        });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(async () => {
          try {
            const currentPreferences = await loadUserPreferencesAsync();
            await saveUserPreferences({
              ...currentPreferences,
              ganttTaskColumnWidth: taskColumnWidth
            });
          } catch (error) {
            // Silent fail to avoid blocking
          }
        }, 100);
      }
    };
    
    // Heavily debounce the save to avoid blocking during resize (2 seconds)
    const timeoutId = setTimeout(() => {
      // Only save if not the initial default value (avoid saving on mount)
      if (taskColumnWidth !== GANTT_TASK_COLUMN_DEFAULT_WIDTH) {
        savePreference();
      }
    }, 2000); // 2000ms debounce for performance
    
    return () => clearTimeout(timeoutId);
  }, [taskColumnWidth]);

  // Handle task column resizing
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    // Store the initial mouse position and current width
    const initialX = e.clientX;
    const initialWidth = taskColumnWidth;
    
    const handleMove = (moveE: MouseEvent) => {
      const deltaX = moveE.clientX - initialX;
      const newWidth = clampGanttTaskColumnWidth(initialWidth + deltaX);
      setTaskColumnWidth(newWidth);
    };
    
    const handleEnd = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
    };
    
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
  }, [taskColumnWidth]);

  // WebSocket listeners for priority updates
  useEffect(() => {
    const handlePriorityUpdated = async (data: any) => {
      try {
        const priorities = await getAllPriorities();
        setPriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after update:', error);
      }
    };

    const handlePriorityCreated = async (data: any) => {
      try {
        const priorities = await getAllPriorities();
        setPriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after creation:', error);
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
        const priorities = await getAllPriorities();
        setPriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after reorder:', error);
      }
    };

    // Register WebSocket event listeners
    websocketClient.onPriorityCreated(handlePriorityCreated);
    websocketClient.onPriorityUpdated(handlePriorityUpdated);
    websocketClient.onPriorityDeleted(handlePriorityDeleted);
    websocketClient.onPriorityReordered(handlePriorityReordered);

    // Cleanup function
    return () => {
      websocketClient.offPriorityCreated(handlePriorityCreated);
      websocketClient.offPriorityUpdated(handlePriorityUpdated);
      websocketClient.offPriorityDeleted(handlePriorityDeleted);
      websocketClient.offPriorityReordered(handlePriorityReordered);
    };
  }, []);

  // WebSocket listeners for task updates
  // NOTE: We DON'T refresh board data for task updates in Gantt view because:
  // 1. The useTaskWebSocket hook in App.tsx already updates the state via WebSocket events
  // 2. Batch updates would trigger N refreshes (one per task), causing excessive /api/boards calls
  // 3. The WebSocket handler updates columns state directly, so no refresh is needed
  // We only refresh for task creation/deletion which might need full board structure
  useEffect(() => {
    const handleTaskCreated = async (data: any) => {
      // Only refresh if the task is for the current board
      // Task creation might need full board refresh to get new task with all relationships
      if (data.boardId === boardId && onRefreshData) {
        try {
          await onRefreshData();
        } catch (error) {
          console.error('Failed to refresh board data after task creation:', error);
        }
      }
    };

    const handleTaskDeleted = async (data: any) => {
      // Only refresh if the task is for the current board
      // Task deletion might need full board refresh to ensure proper cleanup
      if (data.boardId === boardId && onRefreshData) {
        try {
          await onRefreshData();
        } catch (error) {
          console.error('Failed to refresh board data after task deletion:', error);
        }
      }
    };

    // NOTE: We intentionally do NOT listen to task-updated events here
    // The useTaskWebSocket hook in App.tsx already handles task updates via WebSocket
    // and updates the state directly without needing a full board refresh
    // This prevents N calls to /api/boards when batch updating multiple tasks

    // Register WebSocket event listeners (only for create/delete)
    websocketClient.onTaskCreated(handleTaskCreated);
    websocketClient.onTaskDeleted(handleTaskDeleted);

    // Cleanup function
    return () => {
      websocketClient.offTaskCreated(handleTaskCreated);
      websocketClient.offTaskDeleted(handleTaskDeleted);
    };
  }, [boardId, onRefreshData]);

  // Update local drag state ref
  useEffect(() => {
    localDragStateRef.current = localDragState;
  }, [localDragState]);

  // Sync scroll between header and timeline
  useEffect(() => {
    const timeline = scrollContainerRef.current;
    const header = headerScrollRef.current;
    
    if (!timeline || !header) return;
    
    let rafId: number;
    const syncHeaderScroll = () => {
      // Cancel any pending animation frame
      if (rafId) cancelAnimationFrame(rafId);
      
      rafId = requestAnimationFrame(() => {
        const scrollLeft = timeline.scrollLeft;
        const headerContent = header.querySelector('.absolute') as HTMLElement;
        if (headerContent) {
          headerContent.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
        }
      });
    };
    
    timeline.addEventListener('scroll', syncHeaderScroll, { passive: true });
    
    return () => {
      timeline.removeEventListener('scroll', syncHeaderScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Set flags immediately when boardId changes
  useEffect(() => {
    if (boardId) {
      setIsSwitchingBoards(true);
      setIsInitializing(true);
    }
  }, [boardId]);

  // Flush pending scroll position saves on board change or unmount
  useEffect(() => {
    return () => {
      // On unmount or board change, flush any pending save
      flushPendingSave();
    };
  }, [boardId, flushPendingSave]);

  // Board initialization with scroll position restoration
  useEffect(() => {
    const initializeBoard = async () => {
      if (!boardId) {
        setIsBoardLoading(false);
        return;
      }

      setIsBoardLoading(true);
      setIsInitializing(true);

      // Add a delay to ensure previous board's scroll position is saved
      await new Promise(resolve => setTimeout(resolve, 200));

      try {
        // Get saved scroll position for this board
        const savedPositionDate = await getSavedScrollPosition();
        
        // Calculate center date (saved position or today)
        const centerDate = calculateCenterDate(savedPositionDate);
        
        // Generate date range around center date
        const startDate = new Date(centerDate);
        startDate.setDate(startDate.getDate() - 90);
        
        const endDate = new Date(centerDate);
        endDate.setDate(endDate.getDate() + 90);
        
        const initialRange = generateDateRange(startDate, endDate);
        setDateRange(initialRange);
        
        // If we have a saved position, position the viewport
        if (savedPositionDate) {
          const targetDate = new Date(savedPositionDate);
          
          // Wait for DOM to be ready, then set scroll position
          setTimeout(() => {
            if (scrollContainerRef.current) {
              const scrollPosition = calculateScrollPosition(
                targetDate, 
                initialRange
              );
              
              scrollContainerRef.current.scrollLeft = scrollPosition;
              
              // Wait longer before allowing scroll saves to ensure positioning is complete
              setTimeout(() => {
                setIsInitializing(false);
                setIsSwitchingBoards(false);
              }, 500);
            }
          }, 100);
        } else {
          // No saved position, allow scroll saves immediately
          setIsInitializing(false);
          setIsSwitchingBoards(false);
        }
      } catch (error) {
        console.error(`Failed to initialize board ${boardId}:`, error);
        setIsInitializing(false);
        setIsSwitchingBoards(false);
      } finally {
        setIsBoardLoading(false);
        // Don't reset isInitializing here - let the positioning logic handle it
      }
    };

    initializeBoard();
  }, [boardId, getSavedScrollPosition, calculateCenterDate, generateDateRange, calculateScrollPosition]);
  

  // DnD sensors (effectively disabled for viewers)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: canMutate ? 8 : 100000,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Get priority color
  const getPriorityColor = useCallback((priority: string) => {
    if (!priorities || priorities.length === 0) {
      return '#808080';
    }
    const priorityOption = priorities.find(p => p.priority === priority);
    const color = priorityOption?.color || '#808080';
    
    return color;
  }, [priorities]);

  // Process tasks
  const ganttTasks = useMemo(() => {
    const tasks: any[] = [];
    
    Object.values(columns).forEach(column => {
      column.tasks.forEach(task => {
        // Skip tasks without valid IDs
        if (!task || !task.id) {
          return;
        }
        
        let startDate = null;
        let endDate = null;
        
        // Get effective task data (with local drag state)
        const effectiveTask = localDragState.isDragging && localDragState.draggedTaskId === task.id
          ? { ...task, ...localDragState.localTaskData[task.id] }
          : task;
        
        if (effectiveTask.startDate) {
          startDate = parseLocalDate(effectiveTask.startDate);
          endDate = effectiveTask.dueDate ? parseLocalDate(effectiveTask.dueDate) : startDate;
        } else if (effectiveTask.dueDate) {
          endDate = parseLocalDate(effectiveTask.dueDate);
          startDate = endDate;
        }
        
        
        // Get current priority name: use priorityId to look up, or use priorityName from API, or fall back to stored priority
        let priorityName = 'medium';
        if (task.priorityId && priorities) {
          const priorityOption = priorities.find(p => p.id === task.priorityId);
          priorityName = priorityOption?.priority || task.priorityName || task.priority || 'medium';
        } else {
          priorityName = task.priorityName || task.priority || 'medium';
        }
        
        const ganttTask = {
          ...task,
          id: task.id,
          title: task.title,
          ticket: task.ticket || '',
          startDate,
          endDate,
          dueDate: effectiveTask.dueDate || effectiveTask.startDate || '', // Keep original string format
          status: column.title,
          priority: priorityName,
          priorityId: task.priorityId,
          priorityName: priorityName,
          columnId: task.columnId,
          columnPosition: column.position || 0,
          taskPosition: task.position || 0
        };
        
        tasks.push(ganttTask);
      });
    });
    
    return tasks.sort((a, b) => {
      if (a.columnPosition !== b.columnPosition) {
        return a.columnPosition - b.columnPosition;
      }
      if (a.taskPosition !== b.taskPosition) {
        return a.taskPosition - b.taskPosition;
      }
      return 0;
    });
  }, [columns, localDragState, priorities]);

  // Group tasks by column
  const groupedTasks = useMemo(() => {
    const groups: { [columnId: string]: any[] } = {};
    
    Object.values(columns)
      .sort((a, b) => a.position - b.position)
      .forEach(column => {
        groups[column.id] = [];
      });
    
    ganttTasks.forEach(task => {
      if (groups[task.columnId]) {
        groups[task.columnId].push(task);
      }
    });
    
    
    Object.keys(groups).forEach(columnId => {
      groups[columnId].sort((a, b) => a.taskPosition - b.taskPosition);
    });
    
    return groups;
  }, [ganttTasks, columns]);


  // Calculate task positions for dependency arrows
  const calculateTaskPositions = useCallback(() => {
    const positions = new Map<string, {x: number, y: number, width: number, height: number}>();
    
    ganttTasks.forEach(task => {
      const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
      if (taskElement && task.startDate && task.endDate) {
        const rect = taskElement.getBoundingClientRect();
        const container = scrollContainerRef.current;
        if (container) {
          const containerRect = container.getBoundingClientRect();

          const startIndex = dateRange.findIndex(d =>
            d.date.toDateString() === task.startDate.toDateString()
          );
          const endIndex = dateRange.findIndex(d =>
            d.date.toDateString() === task.endDate.toDateString()
          );

          if (startIndex >= 0 && endIndex >= 0) {
            positions.set(task.id, {
              x: startIndex * 40,
              y: rect.top - containerRect.top + container.scrollTop,
              width: (endIndex - startIndex + 1) * 40,
              height: rect.height
            });
          }
        }
      }
    });
    
    setTaskPositions(positions);
  }, [ganttTasks, dateRange]);

  // Calculate task positions when tasks change or view mode changes
  useEffect(() => {
    // Wait for DOM to update
    const timer = setTimeout(() => {
      calculateTaskPositions();
    }, 100);
    
    return () => clearTimeout(timer);
  }, [ganttTasks, calculateTaskPositions, taskViewMode]);

  // Create a memoized date-to-index map for O(1) lookups
  const dateToIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    dateRange.forEach((dateObj, index) => {
      // Use local date format instead of UTC to avoid timezone issues
      const year = dateObj.date.getFullYear();
      const month = String(dateObj.date.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.date.getDate()).padStart(2, '0');
      const localDateStr = `${year}-${month}-${day}`;
      map.set(localDateStr, index);
    });
    return map;
  }, [dateRange]);

  // Get task bar grid position - optimized with O(1) lookup
  const getTaskBarGridPosition = useCallback((task: any) => {
    if (!task.startDate || !task.endDate) return null;
    
    // Convert task dates to local date format for comparison (avoid timezone issues)
    const formatLocalDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    const taskStartStr = formatLocalDate(task.startDate);
    const taskEndStr = formatLocalDate(task.endDate);
    
    // Use O(1) lookup instead of O(n) findIndex
    const startIndex = dateToIndexMap.get(taskStartStr) ?? -1;
    const endIndex = dateToIndexMap.get(taskEndStr) ?? -1;
    
    if (startIndex === -1 || endIndex === -1) {
      // Task is outside current date range
      return null;
    }
    
    const result = {
      startDayIndex: startIndex,
      endDayIndex: endIndex
    };
    
    // CRITICAL FIX: For 1-day tasks (startDate === endDate), ensure they span exactly 1 column
    // This prevents the task bar from having zero width, which makes it unclickable
    if (startIndex === endIndex) {
      // For 1-day tasks, we need to ensure the task bar has a visible width
      // The TaskBar component will handle the visual width, but we need valid indices
      result.endDayIndex = startIndex; // Keep them the same, but ensure they're valid
    }
    
    return result;
  }, [dateToIndexMap]);

  // Task selection
  const handleTaskSelect = useCallback((taskId: string) => {
    // Prevent task selection if we're in the process of exiting multi-select mode
    if (isExitingMultiSelectRef.current) {
      return;
    }
    
    // Only allow task selection if we're actually in multi-select mode
    if (!isMultiSelectModeImmediateRef.current) {
      return;
    }
    setSelectedTasks(prev => {
      const newTasks = prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId];
      return newTasks;
    });
  }, []); // No dependencies needed since we use refs

  // Reset arrow key state to prevent frozen tasks
  const resetArrowKeyState = useCallback(() => {
    isArrowKeyPressedRef.current = false;
    if (arrowKeyTimeoutRef.current) {
      clearTimeout(arrowKeyTimeoutRef.current);
      arrowKeyTimeoutRef.current = null;
    }
    if (updateBatchTimeoutRef.current) {
      clearTimeout(updateBatchTimeoutRef.current);
      updateBatchTimeoutRef.current = null;
    }
    // Clear any pending updates
    pendingUpdatesRef.current.clear();
    // Also clear any active drag state
    setActiveDragItem(null);
    activeDragItemRef.current = null;
    // Clear local drag state to prevent stale data
    setLocalDragState({
      isDragging: false,
      draggedTaskId: null,
      localTaskData: {},
      originalTaskData: {}
    });
  }, []);

  // Handle relationship creation with optimistic updates
  const handleCreateRelationship = useCallback(async (
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType: 'parent' | 'related' = 'parent'
  ) => {
    if (!canMutate) return;
    // Debounce rapid clicks (prevent multiple clicks within 500ms)
    const now = Date.now();
    if (now - lastRelationshipClickRef.current < 500) {
      return;
    }
    lastRelationshipClickRef.current = now;
    
    // Check if relationship already exists to prevent duplicates
    // Support both camelCase (from API) and snake_case (from optimistic updates)
    const existingRelationship = localRelationships.find(rel => {
      const taskId = rel.taskId || rel.task_id;
      const toTaskId = rel.toTaskId || rel.to_task_id;
      if (relationshipType === 'parent') {
        return taskId === sourceTaskId && toTaskId === targetTaskId && rel.relationship === 'parent';
      }
      return rel.relationship === 'related' && (
        (taskId === sourceTaskId && toTaskId === targetTaskId) ||
        (taskId === targetTaskId && toTaskId === sourceTaskId)
      );
    });
    
    if (existingRelationship) {
      return;
    }
    
    // Create optimistic relationship object (matching TaskDependencyArrows interface)
    const optimisticRelationship = {
      id: `temp-${Date.now()}`, // Temporary ID for optimistic update
      task_id: sourceTaskId,
      to_task_id: targetTaskId,
      relationship: relationshipType,
      task_ticket: '', // Will be filled by the component
      related_task_ticket: '', // Will be filled by the component
      createdAt: new Date().toISOString()
    };
    
    // Immediately add to local state for instant UI update
    setLocalRelationships(prev => [...prev, optimisticRelationship]);
    
    try {
      const createdRelationship = await addTaskRelationship(sourceTaskId, relationshipType, targetTaskId);
      
      // Mark optimistic relationship as confirmed (keep it, just change the ID)
      // The WebSocket event will eventually replace it with the real relationship from server
      setLocalRelationships(prev => 
        prev.map(rel => 
          rel.id === optimisticRelationship.id 
            ? { ...rel, id: `confirmed-${Date.now()}` }
            : rel
        )
      );
      
      // Note: WebSocket event will update boardRelationships, which will sync via props
      // The merge logic will handle replacing the confirmed relationship with the real one
      
    } catch (error: any) {
      console.error('Failed to create relationship:', error);
      
      // Always revert optimistic update on error
      setLocalRelationships(prev => 
        prev.filter(rel => rel.id !== optimisticRelationship.id)
      );
      
      // Handle specific error cases with user-friendly messages
      const status = error?.response?.status;
      const errorMessage = error?.response?.data?.message || error?.message || t('gantt.unknownError', { ns: 'common' });
      
      if (status === 409) {
        // Duplicate relationship or circular dependency
        alert(`${t('gantt.cannotCreateRelationship', { ns: 'common' })}: ${errorMessage}`);
      } else if (status === 400) {
        // Invalid relationship type or self-relationship
        alert(`${t('gantt.invalidRelationship', { ns: 'common' })}: ${errorMessage}`);
      } else if (status === 404) {
        // Task not found
        alert(`${t('gantt.taskNotFound', { ns: 'common' })}: ${errorMessage}`);
      } else {
        // Other errors
        alert(`${t('gantt.failedToCreateRelationship', { ns: 'common' })}: ${errorMessage}`);
      }
    }
  }, [localRelationships, onRefreshData, canMutate, t]);

  // Handle relationship deletion with optimistic updates
  const handleDeleteRelationship = useCallback(async (relationshipId: string, fromTaskId: string) => {
    if (!canMutate) return;
    // Store the relationship to restore if deletion fails
    const relationshipToDelete = localRelationships.find(rel => rel.id === relationshipId);
    
    // Immediately remove from local state for instant UI update
    setLocalRelationships(prev => prev.filter(rel => rel.id !== relationshipId));
    
    try {
      // Delete relationship in background
      await removeTaskRelationship(fromTaskId, relationshipId);
      
      // Note: No need to refresh data since arrow already removed from optimistic update
      
    } catch (error) {
      console.error('Failed to delete relationship:', error);
      
      // Revert optimistic update on error
      if (relationshipToDelete) {
        setLocalRelationships(prev => [...prev, relationshipToDelete]);
      }
      
      // Show user-friendly error message
      const errorMessage = (error as any)?.response?.data?.message || (error as any)?.message || t('gantt.unknownError', { ns: 'common' });
      alert(`${t('gantt.failedToDeleteRelationship', { ns: 'common' })}: ${errorMessage}`);
    }
  }, [localRelationships, canMutate, t]);

  // Relationship click — ref avoids missing the second click before state re-renders
  const handleRelationshipClick = useCallback((taskId: string, shiftKey = false) => {
    if (!canMutate) return;

    const sourceId = selectedParentTaskRef.current;
    const wantRelated = shiftKey || shiftHeldInLinkModeRef.current;

    if (!sourceId) {
      selectedParentTaskRef.current = taskId;
      setSelectedParentTask(taskId);
      return;
    }

    if (sourceId === taskId) {
      selectedParentTaskRef.current = null;
      setSelectedParentTask(null);
      return;
    }

    selectedParentTaskRef.current = null;
    setSelectedParentTask(null);
    void handleCreateRelationship(sourceId, taskId, wantRelated ? 'related' : 'parent');
  }, [handleCreateRelationship, canMutate]);

  // Task creation handlers
  const handleTaskCreationMouseDown = useCallback((e: React.MouseEvent, dateString: string) => {
    if (!canMutate) return;
    e.preventDefault();
    setIsCreatingTask(true);
    setTaskCreationStart({ date: dateString });
    setTaskCreationEnd({ date: dateString });
  }, [canMutate]);

  const handleTaskCreationMouseEnter = useCallback((e: React.MouseEvent, dateString: string) => {
    if (isCreatingTask && taskCreationStart) {
      setTaskCreationEnd({ date: dateString });
    }
  }, [isCreatingTask, taskCreationStart]);

  const handleTaskCreationMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (!canMutate || !isCreatingTask || !taskCreationStart || !taskCreationEnd) return;
    
    e.preventDefault();
    
    // Calculate dates using parseLocalDate to avoid timezone issues
    const startDate = parseLocalDate(taskCreationStart.date);
    const endDate = parseLocalDate(taskCreationEnd.date);
    const finalStartDate = startDate <= endDate ? startDate : endDate;
    const finalEndDate = startDate <= endDate ? endDate : startDate;
    
    // Find the default column (first one)
    const firstColumn = Object.values(columns).sort((a, b) => a.position - b.position)[0];
    if (!firstColumn || !onAddTask) return;
    
    // Create task with the selected date range
    try {
      // finalStartDate and finalEndDate are already Date objects, convert to yyyy-MM-dd format
      const year1 = finalStartDate.getFullYear();
      const month1 = String(finalStartDate.getMonth() + 1).padStart(2, '0');
      const day1 = String(finalStartDate.getDate()).padStart(2, '0');
      const startDateStr = `${year1}-${month1}-${day1}`;
      
      const year2 = finalEndDate.getFullYear();
      const month2 = String(finalEndDate.getMonth() + 1).padStart(2, '0');
      const day2 = String(finalEndDate.getDate()).padStart(2, '0');
      const dueDateStr = `${year2}-${month2}-${day2}`;
      
      await onAddTask(firstColumn.id, startDateStr, dueDateStr);
      // Don't refresh - let WebSocket handle the update to avoid duplicates
    } catch (error) {
      console.error('Failed to create task:', error);
    }
    
    // Reset state
    setIsCreatingTask(false);
    setTaskCreationStart(null);
    setTaskCreationEnd(null);
  }, [isCreatingTask, taskCreationStart, taskCreationEnd, columns, onAddTask, canMutate]);

  // Drag handlers for timeline (task bars)
  const handleTimelineDragStart = useCallback((event: DragStartEvent) => {
    if (!canMutate) return;
    const dragData = event.active.data.current as any;
    
    if (dragData?.dragType) {
      setActiveDragItem(dragData);
      activeDragItemRef.current = dragData;
      
      // Initialize local drag state
      const taskId = dragData.taskId;
      const task = ganttTasks.find(t => t.id === taskId);
      
      if (task) {
        
        const dragState = {
          isDragging: true,
          draggedTaskId: taskId,
          localTaskData: {
            [taskId]: {
              startDate: task.startDate ? formatLocalDate(task.startDate) : '',
              dueDate: task.endDate ? formatLocalDate(task.endDate) : ''
            }
          },
          originalTaskData: {
            [taskId]: {
              startDate: task.startDate ? formatLocalDate(task.startDate) : '',
              dueDate: task.endDate ? formatLocalDate(task.endDate) : ''
            }
          }
        };
        
        setLocalDragState(dragState);
        localDragStateRef.current = dragState;
        
        if (onTaskDragStart) {
          const originalTask = Object.values(columns)
            .flatMap(col => col.tasks)
            .find(t => t.id === taskId);
          if (originalTask) {
            onTaskDragStart(originalTask);
          }
        }
      }
    }
  }, [ganttTasks, columns, onTaskDragStart, canMutate]);

  const handleTimelineDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    const currentActiveDragItem = activeDragItemRef.current;
    const dragState = localDragStateRef.current;
    
    if (over && currentActiveDragItem) {
      const overData = over.data.current as any;
      
      if (overData?.date) {
        setCurrentHoverDate(overData.date);
        
        // Use ref — dragOver can fire before React re-renders after dragStart
        if (dragState.isDragging && dragState.draggedTaskId) {
          const taskId = dragState.draggedTaskId;
          const dragType = (currentActiveDragItem as GanttDragItem).dragType;
          
          let newStartDate = dragState.originalTaskData[taskId].startDate;
          let newDueDate = dragState.originalTaskData[taskId].dueDate;
          
          if (dragType === DRAG_TYPES.TASK_MOVE_HANDLE) {
            const originalStart = new Date(dragState.originalTaskData[taskId].startDate);
            const originalEnd = new Date(dragState.originalTaskData[taskId].dueDate);
            // Add 1 day to duration since both start and end dates are inclusive
            const duration = originalEnd.getTime() - originalStart.getTime() + (24 * 60 * 60 * 1000);
            
            newStartDate = overData.date;
            const newStart = new Date(overData.date);
            const newEnd = new Date(newStart.getTime() + duration);
            newDueDate = formatLocalDate(newEnd);
            
          } else if (dragType === DRAG_TYPES.TASK_START_HANDLE) {
            newStartDate = overData.date;
            // Ensure we don't go past the end date
            if (new Date(newStartDate) > new Date(newDueDate)) {
              newStartDate = newDueDate;
            }
          } else if (dragType === DRAG_TYPES.TASK_END_HANDLE) {
            newDueDate = overData.date;
            // Ensure we don't go before the start date
            if (new Date(newDueDate) < new Date(newStartDate)) {
              newDueDate = newStartDate;
            }
          }
          
          // Update ref immediately for calculations
          localDragStateRef.current = {
            ...localDragStateRef.current,
            localTaskData: {
              ...localDragStateRef.current.localTaskData,
              [taskId]: {
                startDate: newStartDate,
                dueDate: newDueDate
              }
            }
          };
          
          // Batch the state update to avoid blocking
          startTransition(() => {
            setLocalDragState(localDragStateRef.current);
          });
        }
      }
    }
  }, []);

  const handleTimelineDragEnd = useCallback(async (event: DragEndEvent) => {
    const { over } = event;
    const currentActiveDragItem = activeDragItemRef.current;
    const dragState = localDragStateRef.current;
    
    if (currentActiveDragItem && dragState.isDragging && over) {
      const taskId = dragState.draggedTaskId ?? currentActiveDragItem.taskId;
      const overData = over.data.current as any;
      
      if (overData?.date && onUpdateTask) {
        const originalTask = Object.values(columns)
          .flatMap(col => col.tasks)
          .find(t => t.id === taskId);
          
        if (originalTask) {
          const dragType = (currentActiveDragItem as GanttDragItem).dragType;
          const task = ganttTasks.find(t => t.id === taskId);
          
          if (task) {
            let newStartDate = task.startDate ? formatLocalDate(task.startDate) : '';
            let newDueDate = task.endDate ? formatLocalDate(task.endDate) : '';
            
            if (dragType === DRAG_TYPES.TASK_MOVE_HANDLE) {
              // Use the final dates from local state which were updated during drag over
              const finalLocalDates = localDragStateRef.current.localTaskData[taskId];
              if (finalLocalDates) {
                newStartDate = finalLocalDates.startDate;
                newDueDate = finalLocalDates.dueDate;
              }
            } else if (dragType === DRAG_TYPES.TASK_START_HANDLE) {
              newStartDate = overData.date;
              // Ensure we don't go past the end date
              if (new Date(newStartDate) > new Date(newDueDate)) {
                newStartDate = newDueDate;
              }
            } else if (dragType === DRAG_TYPES.TASK_END_HANDLE) {
              newDueDate = overData.date;
              // Ensure we don't go before the start date
              if (new Date(newDueDate) < new Date(newStartDate)) {
                newDueDate = newStartDate;
              }
            }
            
            
            const updatedTask = {
              ...originalTask,
              startDate: newStartDate,
              dueDate: newDueDate
            };
            
            await onUpdateTask(updatedTask);
          }
        }
      }
    }
    
    // Clear state
    setActiveDragItem(null);
    activeDragItemRef.current = null;
    setCurrentHoverDate(null);
    setLocalDragState({
      isDragging: false,
      draggedTaskId: null,
      localTaskData: {},
      originalTaskData: {}
    });
    
    // Only call onTaskDragEnd if there was actually a drag operation
    if (onTaskDragEnd && dragState.isDragging) {
      onTaskDragEnd();
    }
  }, [columns, onUpdateTask, onTaskDragEnd, ganttTasks]);

  return (
    <>

    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-visible relative">

      {/* Board Loading Overlay */}
      {isBoardLoading && (
        <div className="absolute inset-0 bg-white dark:bg-gray-800 bg-opacity-90 dark:bg-opacity-90 z-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Loading Board...</div>
          </div>
        </div>
      )}

      {/* Gantt Header - sticky under page header */}
      <div ref={ganttStickyHeaderRef} className="sticky top-16 z-50 bg-white dark:bg-gray-800 relative">
        <GanttHeaderLegendPortal containerRef={ganttStickyHeaderRef} priorities={priorities} />
        <GanttHeader
          dateRange={dateRange}
          formatDate={(date: Date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }}
          ganttTasks={ganttTasks}
          scrollToToday={() => navigateToDate(new Date(), 'center')}
          scrollEarlier={() => navigateToDate(new Date(dateRange[0].date.getTime() - 30 * 24 * 60 * 60 * 1000), 'end')}
          scrollLater={() => navigateToDate(new Date(dateRange[dateRange.length - 1].date.getTime() + 30 * 24 * 60 * 60 * 1000), 'start')}
          scrollToTask={(startDate: Date, endDate: Date, position?: string) => {
            const pos = position === 'start-left' ? 'start' : position === 'end-right' ? 'end' : 'center';
            navigateToDate(startDate, pos);
          }}
          isRelationshipMode={isRelationshipMode}
          setIsRelationshipMode={setIsRelationshipMode}
          isMultiSelectMode={isMultiSelectMode}
          setIsMultiSelectMode={setIsMultiSelectMode}
          selectedTasks={selectedTasks}
          setSelectedTasks={setSelectedTasks}
          setHighlightedTaskId={setHighlightedTaskId}
          resetArrowKeyState={resetArrowKeyState}
          isLoading={false}
          onJumpToTask={handleJumpToTask}
          selectedParentTask={selectedParentTask}
          setSelectedParentTask={setSelectedParentTask}
          canMutate={canMutate}
        />
      </div>
      
      {/* Timeline header - sticky under Gantt header */}
      <div className="sticky top-[169px] z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" data-gantt-timeline-header="true">
        <div className="flex">
          <div 
            className="sticky left-0 z-30 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
            style={{ width: `${taskColumnWidth}px` }}
          >
            <div className="h-14 flex flex-col">
              <div className="h-6 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600"></div>
              <div className="h-8 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <span className="font-semibold text-sm">{t('gantt.tasks', { ns: 'common' })}</span>
                {/* Navigation controls */}
                <div className="flex items-center gap-1">
                  {/* Jump to earliest task */}
                  <button
                    onClick={() => {
                      if (ganttTasks.length > 0) {
                        const earliestTask = ganttTasks.reduce((earliest, task) => 
                          (!earliest.startDate || (task.startDate && task.startDate < earliest.startDate)) ? task : earliest
                        );
                        if (earliestTask.startDate) {
                          navigateToDate(earliestTask.startDate, 'start');
                        }
                      }
                    }}
                    disabled={ganttTasks.length === 0}
                    className="p-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('gantt.jumpToEarliestTask')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  
                  {/* Earlier button */}
                  <button
                    onClick={() => {
                      if (scrollContainerRef.current) {
                        const container = scrollContainerRef.current;
                        const currentScroll = container.scrollLeft;
                        const viewportWidth = container.clientWidth;
                        
                        // If we're near the start, extend the date range
                        if (currentScroll < 500) {
                          // Trigger the lazy loading
                          container.scrollLeft = 100;
                          setTimeout(() => {
                            container.scrollLeft = currentScroll + (60 * 40); // Adjust for new dates
                          }, 100);
                        } else {
                          // Normal scroll
                          container.scrollLeft = Math.max(0, currentScroll - viewportWidth * 0.8);
                        }
                      }
                    }}
                    className="p-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    title={t('gantt.scrollToEarlierDates')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  
                  {/* Today button */}
                  <button
                    onClick={() => {
                      navigateToDate(new Date(), 'center');
                    }}
                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    {t('gantt.today')}
                  </button>
                  
                  {/* Later button */}
                  <button
                    onClick={() => {
                      if (scrollContainerRef.current) {
                        const container = scrollContainerRef.current;
                        const currentScroll = container.scrollLeft;
                        const viewportWidth = container.clientWidth;
                        const maxScroll = container.scrollWidth - viewportWidth;
                        
                        // If we're near the end, let the lazy loading handle it
                        if (currentScroll > maxScroll - 500) {
                          container.scrollLeft = maxScroll - 100;
                        } else {
                          // Normal scroll
                          container.scrollLeft = Math.min(maxScroll, currentScroll + viewportWidth * 0.8);
                        }
                      }
                    }}
                    className="p-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    title={t('gantt.scrollToLaterDates')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  
                  {/* Jump to latest task */}
                  <button
                    onClick={() => {
                      if (ganttTasks.length > 0) {
                        const latestTask = ganttTasks.reduce((latest, task) => 
                          (!latest.endDate || (task.endDate && task.endDate > latest.endDate)) ? task : latest
                        );
                        if (latestTask.endDate) {
                          navigateToDate(latestTask.endDate, 'end');
                        }
                      }
                    }}
                    disabled={ganttTasks.length === 0}
                    className="p-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('gantt.jumpToLatestTask')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                  
                  {/* Resize handle */}
                  <div
                    className={`w-1 h-6 transition-colors cursor-col-resize ${
                      isResizing 
                        ? 'bg-blue-500' 
                        : 'bg-gray-300 dark:bg-gray-500 hover:bg-gray-400 dark:hover:bg-gray-400'
                    }`}
                    onMouseDown={handleResizeStart}
                    title={t('gantt.dragToResizeColumn', { ns: 'common' })}
                  />
                  
                </div>
              </div>
            </div>
          </div>
          <div 
            ref={headerScrollRef}
            className="flex-1 overflow-hidden relative"
          >
            <div 
              className="absolute"
              style={{ 
                width: `${dateRange.length * 40}px`,
                transform: `translateX(0px)`,
                willChange: 'transform'
              }}>
              {/* Month/Year Row */}
              <div 
                className="h-6 grid border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700"
                style={{ gridTemplateColumns: `repeat(${dateRange.length}, 40px)` }}
                data-gantt-month-row="true"
              >
                {dateRange.map((dateCol, index) => (
                  <div
                    key={`month-${index}`}
                    className="text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center justify-center"
                  >
                    {(index === 0 || dateCol.date.getDate() === 1 || dateCol.date.getDate() === 15) && (
                      <span>
                        {dateCol.date.toLocaleDateString('en-US', { month: 'short' })}'{dateCol.date.getFullYear().toString().slice(-2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Day Numbers Row */}
              <div 
                className="h-8 grid border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700"
                style={{ gridTemplateColumns: `repeat(${dateRange.length}, 40px)` }}
                data-gantt-day-row="true"
              >
                {dateRange.map((dateCol, index) => (
                  <div
                    key={`day-${index}`}
                    className={`text-xs text-center border-r border-gray-300 dark:border-gray-600 flex items-center justify-center ${
                      dateCol.isToday ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-semibold' :
                      dateCol.isWeekend ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {dateCol.date.getDate()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={handleTimelineDragStart}
        onDragOver={handleTimelineDragOver}
        onDragEnd={handleTimelineDragEnd}
      >
      <div ref={mainContentRef} className="relative flex">
        {/* Task list — vertical reorder within status + status dropdown */}
        <GanttTaskList
          columns={columns}
          groupedTasks={groupedTasks}
          selectedTask={selectedTask}
          selectedTasks={selectedTasks}
          isMultiSelectMode={isMultiSelectMode}
          isRelationshipMode={isRelationshipMode}
          selectedParentTask={selectedParentTask}
          priorities={priorities}
          taskColumnWidth={taskColumnWidth}
          taskViewMode={taskViewMode}
          onSelectTask={onSelectTask}
          onTaskSelect={handleTaskSelect}
          onCopyTask={onCopyTask}
          onRemoveTask={onRemoveTask}
          highlightedTaskId={highlightedTaskId}
          siteSettings={siteSettings}
          isAdmin={Boolean(currentUser?.roles?.includes('admin'))}
          canMutate={canMutate}
          onReorderTask={onReorderTaskInColumn}
          onMoveTaskToColumn={onMoveTaskToColumn}
        />

        {/* Timeline (horizontal date move / resize only) */}
          <GanttTimeline
            groupedTasks={groupedTasks}
            dateRange={dateRange}
            activeDragItem={activeDragItem}
            currentHoverDate={currentHoverDate}
            selectedTasks={selectedTasks}
            isMultiSelectMode={isMultiSelectMode}
            isRelationshipMode={isRelationshipMode}
            taskViewMode={taskViewMode}
            isCreatingTask={isCreatingTask}
            taskCreationStart={taskCreationStart}
            taskCreationEnd={taskCreationEnd}
            getPriorityColor={getPriorityColor}
            getTaskBarGridPosition={getTaskBarGridPosition}
            onSelectTask={onSelectTask}
            onTaskSelect={handleTaskSelect}
            onRelationshipClick={handleRelationshipClick}
            onTaskCreationMouseDown={handleTaskCreationMouseDown}
            onTaskCreationMouseEnter={handleTaskCreationMouseEnter}
            onTaskCreationMouseUp={handleTaskCreationMouseUp}
            scrollContainerRef={scrollContainerRef}
            localDragState={localDragState}
            ganttTasks={ganttTasks}
            taskPositions={taskPositions}
            relationships={localRelationships}
            highlightedTaskId={highlightedTaskId}
            selectedParentTask={selectedParentTask}
            onDeleteRelationship={handleDeleteRelationship}
            columns={columns}
            siteSettings={siteSettings}
          />
      </div>
      </DndContext>

    </div>
    
    {/* Jump to task dropdown */}
    {showTaskJumpDropdown && taskJumpRef.current && createPortal(
      <div 
        className="task-jump-dropdown fixed z-50 mt-1 w-64 max-h-96 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg"
        style={{
          top: taskJumpRef.current.getBoundingClientRect().bottom,
          left: taskJumpRef.current.getBoundingClientRect().left
        }}
      >
        <div className="p-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-2">{t('gantt.selectTaskToJump')}</div>
          {ganttTasks.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 py-2">{t('gantt.noTasksAvailable')}</div>
          ) : (
            ganttTasks
              .filter(task => task.startDate)
              .sort((a, b) => (a.startDate?.getTime() || 0) - (b.startDate?.getTime() || 0))
              .map(task => (
                <button
                  key={task.id}
                  onClick={() => {
                    if (task.startDate) {
                      navigateToDate(task.startDate, 'center');
                      
                      // Also scroll to task vertically
                      setTimeout(() => {
                        const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
                        if (taskElement && mainContentRef.current) {
                          const containerRect = mainContentRef.current.getBoundingClientRect();
                          const taskRect = taskElement.getBoundingClientRect();
                          const relativeTop = taskRect.top - containerRect.top + mainContentRef.current.scrollTop;
                          
                          // Scroll to center the task vertically
                          mainContentRef.current.scrollTop = relativeTop - (containerRect.height / 2) + (taskRect.height / 2);
                        }
                      }, 100);
                    }
                    setShowTaskJumpDropdown(false);
                  }}
                className="w-full text-left px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between"
              >
                <span className="truncate">{task.title}</span>
                <span className="text-gray-500 dark:text-gray-400 ml-2 flex-shrink-0">
                  {task.startDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </button>
              ))
          )}
        </div>
      </div>,
      document.body
    )}
    
    </>
  );
};

GanttViewV2.displayName = 'GanttViewV2';

export default GanttViewV2;
