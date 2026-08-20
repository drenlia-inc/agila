import { useCallback, useRef, useEffect, RefObject } from 'react';
import { Board, Columns, Task, TeamMember } from '../types';
import { getBoardTaskRelationships } from '../api';
import { feDebug } from '../utils/clientDebug';
import { dedupeTasksInColumns, stripTaskFromAllColumns, applyRestoredTaskToColumns } from '../utils/taskReorderingUtils';
import { scheduleSettledBoardRefresh } from '../utils/boardRestoredRefresh';

function wsHookLog(...args: unknown[]) {
  if (feDebug('FE_DEBUG_WEBSOCKET')) console.log(...args);
}

interface UseTaskWebSocketProps {
  // State setters
  setBoards: React.Dispatch<React.SetStateAction<Board[]>>;
  setColumns: React.Dispatch<React.SetStateAction<Columns>>;
  setSelectedTask: React.Dispatch<React.SetStateAction<Task | null>>;
  
  // Refs
  selectedBoardRef: RefObject<string | null>;
  pendingTaskRefreshesRef: RefObject<Set<string>>;
  refreshBoardDataRef: RefObject<
    ((options?: { force?: boolean; forBoardId?: string }) => Promise<void>) | null
  >;
  recentlyDeletedTasksRef: RefObject<Set<string>>;
  /** Task IDs restored via our own HTTP — skip WS echo's settled force refresh. */
  pendingSelfTaskRestoresRef?: RefObject<Set<string>>;
  
  // Task filters hook
  taskFilters: {
    setFilteredColumns: React.Dispatch<React.SetStateAction<Columns>>;
    viewModeRef: RefObject<'kanban' | 'list' | 'gantt'>;
    shouldIncludeTaskRef: RefObject<(task: Task) => boolean>;
  };
  
  // Task linking hook
  taskLinking: {
    setBoardRelationships: (relationships: any[]) => void;
  };
  
  // Current user
  currentUser: { id: string } | null | undefined;
  
  // Selected task (for comment handlers)
  selectedTask: Task | null;
}

export const useTaskWebSocket = ({
  setBoards,
  setColumns,
  setSelectedTask,
  selectedBoardRef,
  pendingTaskRefreshesRef,
  refreshBoardDataRef,
  recentlyDeletedTasksRef,
  pendingSelfTaskRestoresRef,
  taskFilters,
  taskLinking,
  currentUser,
  selectedTask,
}: UseTaskWebSocketProps) => {
  // Keep a ref to selectedTask to avoid stale closures in batch processing
  const selectedTaskRef = useRef<Task | null>(selectedTask);
  
  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);
  
  // Batch processing for rapid task updates (e.g., 259 updates from batch-update-positions)
  // This prevents React batching from causing state overwrites
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map());
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Pre-compute deferral mechanism ONCE to avoid repeated checks (performance optimization)
  // This eliminates 550+ typeof checks when messages arrive rapidly
  const deferUpdateRef = useRef<((taskId: string, data: any) => void) | null>(null);
  
  const processBatchedUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.size === 0) return;
    
    // Skip processing if a local reordering is in progress
    // This prevents WebSocket updates from overwriting optimistic updates
    if ((window as any).reorderingInProgress) {
      wsHookLog('🚫 [WebSocket] Skipping batch updates - reordering in progress');
      pendingUpdatesRef.current.clear();
      return;
    }
    
    const updates = Array.from(pendingUpdatesRef.current.values());
    pendingUpdatesRef.current.clear();
    
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
      batchTimeoutRef.current = null;
    }

    // `columns` state only holds the SELECTED board. Applying task-updated batches for other
    // boards corrupts the UI (e.g. new empty board briefly shows the previous board's tasks).
    const currentBoardId = selectedBoardRef.current;
    const updatesForVisibleBoard =
      currentBoardId != null && currentBoardId !== ''
        ? updates.filter((d: any) => d?.boardId === currentBoardId)
        : updates;
    
    // Set flag only when we actually mutate visible columns (avoids blocking refresh for unrelated boards)
    if (updatesForVisibleBoard.length > 0) {
      window.justUpdatedFromWebSocket = true;
      (window as any).lastWebSocketUpdateTime = Date.now();
      setTimeout(() => {
        window.justUpdatedFromWebSocket = false;
      }, 2000);
    }
    
    // Use requestAnimationFrame + setTimeout to break up the work and avoid blocking the main thread
    // This prevents "message handler took Xms" violations
    // Double defer: requestAnimationFrame ensures we're in the right frame, setTimeout breaks up heavy work
    // REDUCED DELAY: Use 0ms timeout instead of default (~4ms) to minimize delay for position updates
    requestAnimationFrame(() => {
      // Defer the actual heavy processing to the next tick to avoid blocking
      // Use 0ms timeout for faster updates (still defers to next event loop tick)
      setTimeout(() => {
    
    // Track if we need to update selectedTask
    let updatedSelectedTask: Task | null = null;
    const currentSelectedTask = selectedTaskRef.current;
    // Track which task IDs were updated (for selectedTask update check)
    const updatedTaskIds = new Set<string>();
    
    // Process visible-board updates only (skip when batch is entirely for other boards)
    if (updatesForVisibleBoard.length > 0) {
    setColumns(prevColumns => {
      // OPTIMIZED: Use shallow copy - only copy columns we actually modify
      // This is 10-100x faster than JSON.parse(JSON.stringify()) for large datasets
      const updatedColumns: Columns = {};
      
      // Shallow copy all columns first (we'll deep copy tasks only when we modify them)
      Object.keys(prevColumns).forEach(columnId => {
        const column = prevColumns[columnId];
        if (column) {
          updatedColumns[columnId] = {
            ...column,
            tasks: [...(column.tasks || [])] // Shallow copy task array (tasks themselves will be copied when modified)
          };
        }
      });
      
      
      // First pass: Build a map of all task updates by taskId
      // This allows us to handle multiple updates for the same task correctly
      const taskUpdatesMap = new Map<string, any>();
      const taskSourceColumns = new Map<string, string>(); // Track where each task currently is
      
      // Build initial map of where tasks currently are
      Object.keys(updatedColumns).forEach(columnId => {
        const column = updatedColumns[columnId];
        if (!column || !column.tasks) return;
        column.tasks.forEach((task: any) => {
          if (task && task.id) {
            taskSourceColumns.set(task.id, columnId);
          }
        });
      });
      
      
      // Collect all updates for the board currently on screen
      updatesForVisibleBoard.forEach(data => {
        if (!data.task || !data.boardId) return;
        const taskId = data.task.id;
        if (!taskId) return;
        taskUpdatesMap.set(taskId, data);
        updatedTaskIds.add(taskId); // Track for selectedTask update
      });
      
      
      // Second pass: Process moves first (tasks changing columns)
      // This ensures we remove tasks from source columns before processing position updates
      const moves: Array<{ taskId: string; fromColumn: string; toColumn: string; data: any }> = [];
      taskUpdatesMap.forEach((data, taskId) => {
        const targetColumnId = data.task.columnId || data.task.columnid || taskSourceColumns.get(taskId);
        if (!targetColumnId) return;
        if (!data.task.columnId) data.task.columnId = targetColumnId;
        
        const currentColumnId = taskSourceColumns.get(taskId);
        if (currentColumnId && currentColumnId !== targetColumnId) {
          moves.push({ taskId, fromColumn: currentColumnId, toColumn: targetColumnId, data });
        }
      });
      
      // Process moves: Remove from source, preserve full task data
      const movedTasksData = new Map<string, any>(); // Store full task data for moved tasks
      moves.forEach(({ taskId, fromColumn, toColumn, data }) => {
        const sourceColumn = updatedColumns[fromColumn];
        if (!sourceColumn || !sourceColumn.tasks) return;
        
        const taskIndex = sourceColumn.tasks.findIndex((t: any) => t && t.id === taskId);
        if (taskIndex !== -1) {
          // Preserve FULL task data before removing
          movedTasksData.set(taskId, sourceColumn.tasks[taskIndex]);
          
          // Remove from source column
          updatedColumns[fromColumn] = {
            ...sourceColumn,
            tasks: [
              ...sourceColumn.tasks.slice(0, taskIndex),
              ...sourceColumn.tasks.slice(taskIndex + 1)
            ]
          };
          
          // Update tracking
          taskSourceColumns.delete(taskId);
        }
      });
      
      // Third pass: Process all updates (position changes and moves)
      // Group by target column to process all updates for each column together
      const updatesByColumn = new Map<string, Array<{ taskId: string; data: any; isMove: boolean }>>();
      
      taskUpdatesMap.forEach((data, taskId) => {
        // Resolve columnId from payload or from the task's current column on this board
        const targetColumnId = data.task.columnId || data.task.columnid || taskSourceColumns.get(taskId);
        if (!targetColumnId) return;
        // Ensure later merge steps see a columnId even when the server omitted it
        if (!data.task.columnId) {
          data.task.columnId = targetColumnId;
        }
        
        if (!updatesByColumn.has(targetColumnId)) {
          updatesByColumn.set(targetColumnId, []);
        }
        
        const currentColumnId = taskSourceColumns.get(taskId);
        const isMove = currentColumnId && currentColumnId !== targetColumnId;
        updatesByColumn.get(targetColumnId)!.push({ taskId, data, isMove });
      });
      
      // CRITICAL: Build a map of all original tasks from prevColumns BEFORE processing updates
      // This ensures we always have the full task data, even if it was modified in a previous update
      const originalTasksMap = new Map<string, any>();
      Object.keys(prevColumns).forEach(columnId => {
        const column = prevColumns[columnId];
        if (!column || !column.tasks) return;
        column.tasks.forEach((task: any) => {
          if (task && task.id) {
            originalTasksMap.set(task.id, task);
          }
        });
      });
      
      // Process each column's updates together
      updatesByColumn.forEach((columnUpdates, targetColumnId) => {
        const targetColumn = updatedColumns[targetColumnId];
        if (!targetColumn) {
          console.warn('⚠️ [WebSocket] Batch update: Target column not found:', targetColumnId);
          return;
        }
        
        // Start with current tasks in the column (after moves removed)
        let columnTasks = [...(targetColumn.tasks || [])];
        
        
        // Process each update for this column
        columnUpdates.forEach(({ taskId, data, isMove }) => {
          // Ignore tasks that were recently deleted (prevents reappearing after deletion)
          if (recentlyDeletedTasksRef.current?.has(taskId)) {
            wsHookLog('🚫 [Batch] Ignoring task-updated for recently deleted task:', taskId);
            return;
          }
          
          // CRITICAL: Get full task data from original state, not from modified columnTasks
          // Priority: 1) moved tasks (preserved before removal), 2) original state, 3) current column, 4) minimal payload
          let fullTaskData = movedTasksData.get(taskId);
          let dataSource = 'moved';
          if (!fullTaskData) {
            // Get from original state (before any modifications)
            fullTaskData = originalTasksMap.get(taskId);
            dataSource = 'original';
          }
          if (!fullTaskData) {
            // Fallback to current column (might be incomplete, but better than nothing)
            const existingTask = columnTasks.find((t: any) => t && t.id === taskId);
            fullTaskData = existingTask;
            dataSource = 'column';
          }
          
          
          // Build merged task
          // CRITICAL: Preserve ALL fields from fullTaskData, only override with values from data.task
          // that are explicitly provided. The server sends minimal payloads with only changed fields,
          // so we must preserve all unchanged fields from the original task data.
          const mergedTask = fullTaskData ? {
            ...fullTaskData,  // Full existing data - this is the base (preserves ALL fields)
            // Override with fields from the update payload (only if they exist in data.task)
            // The server's minimal payload includes changed fields: title, description, memberId, 
            // requesterId, startDate, dueDate, effort, priority, columnId, position, sprintId, etc.
            // CRITICAL: The server always includes these fields in minimal payload: id, title, boardId, memberId, ticket
            // So we can always use them from data.task. For other fields, only use if they exist in the payload.
            id: data.task.id ?? fullTaskData.id,
            title: data.task.title ?? fullTaskData.title, // Server always includes title
            boardId: data.task.boardId ?? fullTaskData.boardId, // Server always includes boardId
            columnId: targetColumnId, // Always use target column
            memberId: data.task.memberId !== undefined ? data.task.memberId : fullTaskData.memberId, // Server always includes memberId (may be null)
            ticket: data.task.ticket !== undefined ? data.task.ticket : fullTaskData.ticket, // Server always includes ticket (may be null)
            updatedBy: data.task.updatedBy ?? fullTaskData.updatedBy,
            // Handle fields that are only included if they changed
            description: data.task.hasOwnProperty('description') ? data.task.description : fullTaskData.description,
            // CRITICAL: Always use position from update if provided (even if 0)
            // Use nullish coalescing to handle 0 as a valid position value
            position: data.task.hasOwnProperty('position') 
              ? (data.task.position !== null && data.task.position !== undefined ? data.task.position : fullTaskData.position)
              : fullTaskData.position,
            requesterId: data.task.hasOwnProperty('requesterId') ? data.task.requesterId : fullTaskData.requesterId,
            startDate: data.task.hasOwnProperty('startDate') ? data.task.startDate : fullTaskData.startDate,
            dueDate: data.task.hasOwnProperty('dueDate') ? data.task.dueDate : fullTaskData.dueDate,
            effort: data.task.hasOwnProperty('effort') ? (data.task.effort ?? fullTaskData.effort ?? 0) : fullTaskData.effort,
            // CRITICAL: Always update priority fields if they exist in the update (even if null/undefined)
            // This ensures priority reassignment after deletion is always applied
            // Use priorityName from JOIN as the source of truth, not the stale priority field
            priority: data.task.hasOwnProperty('priorityName') ? (data.task.priorityName ?? null) 
                     : (data.task.hasOwnProperty('priority') ? (data.task.priority ?? null) : fullTaskData.priority),
            priorityId: data.task.hasOwnProperty('priorityId') ? (data.task.priorityId ?? null) : fullTaskData.priorityId,
            priorityName: data.task.hasOwnProperty('priorityName') ? (data.task.priorityName ?? null) : fullTaskData.priorityName,
            priorityColor: data.task.hasOwnProperty('priorityColor') ? (data.task.priorityColor ?? null) : fullTaskData.priorityColor,
            sprintId: data.task.hasOwnProperty('sprintId') ? data.task.sprintId : fullTaskData.sprintId,
            columnEnteredAt: data.task.hasOwnProperty('columnEnteredAt')
              ? data.task.columnEnteredAt
              : fullTaskData.columnEnteredAt,
            isBlocked: data.task.hasOwnProperty('isBlocked')
              ? Boolean(data.task.isBlocked)
              : fullTaskData.isBlocked,
            blockedReason: data.task.hasOwnProperty('blockedReason')
              ? data.task.blockedReason
              : fullTaskData.blockedReason,
            // Handle previous location fields (for cross-column/board moves)
            previousColumnId: data.task.hasOwnProperty('previousColumnId') ? data.task.previousColumnId : fullTaskData.previousColumnId,
            previousBoardId: data.task.hasOwnProperty('previousBoardId') ? data.task.previousBoardId : fullTaskData.previousBoardId,
            // Preserve arrays when omitted; apply when present (including empty = cleared)
            comments: data.task.hasOwnProperty('comments') && Array.isArray(data.task.comments)
              ? data.task.comments
              : (fullTaskData.comments || []),
            watchers: data.task.hasOwnProperty('watchers') && Array.isArray(data.task.watchers)
              ? data.task.watchers
              : (fullTaskData.watchers || []),
            collaborators: data.task.hasOwnProperty('collaborators') && Array.isArray(data.task.collaborators)
              ? data.task.collaborators
              : (fullTaskData.collaborators || []),
            tags: data.task.hasOwnProperty('tags') && Array.isArray(data.task.tags)
              ? data.task.tags
              : (fullTaskData.tags || []),
            attachmentCount: data.task.hasOwnProperty('attachmentCount')
              ? (data.task.attachmentCount ?? 0)
              : fullTaskData.attachmentCount
          } : {
            // No existing data - use minimal payload with defaults
            ...data.task,
            id: taskId,
            title: data.task.title || 'Untitled Task',
            boardId: data.task.boardId || data.boardId,
            columnId: targetColumnId,
            position: data.task.position ?? 0,
            comments: data.task.comments || [],
            watchers: data.task.watchers || [],
            collaborators: data.task.collaborators || [],
            tags: data.task.tags || [],
            attachmentCount: data.task.attachmentCount ?? 0,
            memberId: data.task.memberId || null,
            requesterId: data.task.requesterId || null,
            effort: data.task.effort ?? 0,
            priority: data.task.priority || null,
            sprintId: data.task.sprintId || null,
            startDate: data.task.startDate || null,
            dueDate: data.task.dueDate || null,
            createdAt: data.task.createdAt || new Date().toISOString(),
            updatedAt: data.task.updatedAt || new Date().toISOString()
          };
          
          // Update or add task in column (immutable update)
          const existingIndex = columnTasks.findIndex((t: any) => t && t.id === taskId);
          if (existingIndex !== -1) {
            // Create new array with updated task
            columnTasks = [
              ...columnTasks.slice(0, existingIndex),
              mergedTask,
              ...columnTasks.slice(existingIndex + 1)
            ];
          } else {
            columnTasks = [...columnTasks, mergedTask];
          }
        });
        
        // Sort by position and update column (create new sorted array, don't mutate)
        const sortedTasks = [...columnTasks].sort((a, b) => (a.position || 0) - (b.position || 0));
        updatedColumns[targetColumnId] = {
          ...targetColumn,
          tasks: sortedTasks
        };
      });

      // Invariant: each updated task exists in at most one column (target wins)
      let normalizedColumns = updatedColumns;
      updatedTaskIds.forEach((taskId) => {
        const data = taskUpdatesMap.get(taskId);
        const targetColumnId =
          data?.task?.columnId || data?.task?.columnid || taskSourceColumns.get(taskId);
        if (!targetColumnId) return;
        normalizedColumns = stripTaskFromAllColumns(normalizedColumns, taskId, {
          exceptColumnId: targetColumnId,
          renumber: false,
        });
      });
      normalizedColumns = dedupeTasksInColumns(normalizedColumns);

      // Track updated selectedTask if it's one of the updated tasks
      // We'll update it after setColumns completes
      // CRITICAL: Always update selectedTask if it's one of the updated tasks, even if only field values changed
      if (currentSelectedTask) {
        const taskId = currentSelectedTask.id;
        // Check if this task was updated in the batch
        if (updatedTaskIds.has(taskId)) {
          // Find the updated task in the columns
          Object.keys(normalizedColumns).forEach(columnId => {
            const column = normalizedColumns[columnId];
            if (!column || !column.tasks) return;
            const task = column.tasks.find((t: any) => t && t.id === taskId);
            if (task) {
              updatedSelectedTask = task;
            }
          });
        }
      }
      
      
      return normalizedColumns;
    });
    }
    
    // CRITICAL: Also update boards state for all boards (not just selected board)
    // This ensures task position/column changes are reflected even when board is not currently viewed
    // Similar to how handleTaskDeleted updates boards state
    const boardUpdatesMap = new Map<string, any>(); // Track updates by boardId
    updates.forEach(data => {
      if (!data.task || !data.boardId) return;
      const boardId = data.boardId;
      if (!boardUpdatesMap.has(boardId)) {
        boardUpdatesMap.set(boardId, []);
      }
      boardUpdatesMap.get(boardId)!.push(data);
    });
    
    // Update boards state for each affected board
    boardUpdatesMap.forEach((boardUpdates, boardId) => {
      setBoards(prevBoards => {
        return prevBoards.map(board => {
          if (board.id === boardId) {
            const updatedBoard = { ...board };
            const updatedColumns: Columns = { ...updatedBoard.columns };
            
            // Process each update for this board
            boardUpdates.forEach((data: any) => {
              const taskId = data.task?.id;
              if (!taskId) return;
              
              const targetColumnId = data.task.columnId || data.task.columnid;
              if (!targetColumnId) return;
              if (!data.task.columnId) data.task.columnId = targetColumnId;

              // Preserve full local task BEFORE stripping. Batch position WS payloads are
              // minimal (no description/priority/comments); looking only in the target
              // column after a cross-column strip would replace the card with a skeleton.
              let preservedTask: any = null;
              Object.keys(updatedColumns).forEach(columnId => {
                const column = updatedColumns[columnId];
                if (!column || !column.tasks) return;
                const found = column.tasks.find((t: any) => t && t.id === taskId);
                if (found) preservedTask = found;
              });

              // Strip from every column (including target) so we re-insert once, merged
              Object.keys(updatedColumns).forEach(columnId => {
                const column = updatedColumns[columnId];
                if (!column || !column.tasks) return;
                if (!column.tasks.some((t: any) => t && t.id === taskId)) return;
                updatedColumns[columnId] = {
                  ...column,
                  tasks: column.tasks.filter((t: any) => t && t.id !== taskId),
                };
              });
              
              // Add/update task in target column
              const targetColumn = updatedColumns[targetColumnId];
              if (targetColumn) {
                const base = preservedTask || {};
                const patch = data.task || {};
                const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
                const mergedTask = {
                  ...base,
                  ...patch,
                  id: taskId,
                  boardId: boardId,
                  columnId: targetColumnId,
                  title: has('title') ? patch.title : (base.title ?? patch.title),
                  description: has('description') ? patch.description : base.description,
                  memberId: has('memberId') ? patch.memberId : base.memberId,
                  requesterId: has('requesterId') ? patch.requesterId : base.requesterId,
                  ticket: has('ticket') ? patch.ticket : base.ticket,
                  effort: has('effort') ? (patch.effort ?? base.effort ?? 0) : base.effort,
                  priority: has('priority') ? patch.priority : base.priority,
                  priorityId: has('priorityId') ? patch.priorityId : base.priorityId,
                  priorityName: has('priorityName') ? patch.priorityName : base.priorityName,
                  priorityColor: has('priorityColor') ? patch.priorityColor : base.priorityColor,
                  startDate: has('startDate') ? patch.startDate : base.startDate,
                  dueDate: has('dueDate') ? patch.dueDate : base.dueDate,
                  sprintId: has('sprintId') ? patch.sprintId : base.sprintId,
                  comments: has('comments') && Array.isArray(patch.comments) ? patch.comments : (base.comments || []),
                  watchers: has('watchers') && Array.isArray(patch.watchers) ? patch.watchers : (base.watchers || []),
                  collaborators: has('collaborators') && Array.isArray(patch.collaborators) ? patch.collaborators : (base.collaborators || []),
                  tags: has('tags') && Array.isArray(patch.tags) ? patch.tags : (base.tags || []),
                  attachmentCount: has('attachmentCount') ? (patch.attachmentCount ?? 0) : base.attachmentCount,
                  position: has('position')
                    ? (patch.position !== null && patch.position !== undefined ? patch.position : (base.position ?? 0))
                    : (base.position ?? 0),
                };
                
                const updatedTasks = [...targetColumn.tasks, mergedTask].sort(
                  (a, b) => (a.position || 0) - (b.position || 0)
                );
                
                updatedColumns[targetColumnId] = {
                  ...targetColumn,
                  tasks: updatedTasks
                };
              }
            });

            // Final pass: unique task ids across this board's columns
            Object.assign(updatedColumns, dedupeTasksInColumns(updatedColumns));
            
            updatedBoard.columns = updatedColumns;
            return updatedBoard;
          }
          return board;
        });
      });
    });
    
    // Update selectedTask after columns update completes
    // This ensures the task detail view shows the latest data
    // CRITICAL: Always update selectedTask if it was updated, even if only field values changed
    if (updatedSelectedTask && currentSelectedTask) {
      // Use setTimeout to ensure this happens after setColumns state update
      setTimeout(() => {
        setSelectedTask(updatedSelectedTask);
      }, 0);
    } else if (currentSelectedTask && updatedTaskIds.has(currentSelectedTask.id)) {
      // Task was updated but not found in columns - this shouldn't happen, but log it
      console.warn(`⚠️ [Batch] Task ${currentSelectedTask.id} was updated but not found in columns for selectedTask update`);
    }
    
    // NOTE: We don't manually update filteredColumns here
    // The useTaskFilters hook has a useEffect that automatically recalculates filteredColumns
    // whenever columns changes. This ensures filtering is always correct and consistent.
    // Manual updates could cause race conditions or inconsistencies with the filter logic.
    // 
    // The useTaskFilters effect will run after setColumns completes and will:
    // 1. Read the updated columns state (with all our batch updates)
    // 2. Apply filters to determine which tasks should be visible
    // 3. Update filteredColumns automatically
    // 
    // This is the correct approach because:
    // - It ensures filter logic is always consistent
    // - It handles all filter types (sprint, search, members, etc.)
    // - It avoids race conditions between manual updates and effect updates
    }, 0); // Defer to next tick to break up heavy work
    });
  }, [setColumns, setSelectedTask, setBoards, recentlyDeletedTasksRef]);
  
  // Helper function to schedule batch processing (defined early so it can be used by getMessageChannel)
  const scheduleBatchProcessing = useCallback((data: any) => {
    // Schedule async processing - use requestIdleCallback if available, otherwise setTimeout
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
    }
    
    // Check if this is a priority update (should process faster)
    // Use 'in' operator instead of hasOwnProperty for better performance
    const isPriorityUpdate = 'priority' in data.task ||
                             'priorityId' in data.task ||
                             'priorityName' in data.task ||
                             'priorityColor' in data.task;
    
    // Process priority updates with minimal delay, others with standard debounce
    const debounceDelay = isPriorityUpdate ? 0 : 50;
    
    // Use requestIdleCallback if available for better performance, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined' && !isPriorityUpdate) {
      batchTimeoutRef.current = setTimeout(() => {
        requestIdleCallback(() => {
          processBatchedUpdates();
        }, { timeout: 100 });
      }, debounceDelay);
    } else {
      batchTimeoutRef.current = setTimeout(() => {
        processBatchedUpdates();
      }, debounceDelay);
    }
  }, [processBatchedUpdates]);
  
  // Initialize deferral mechanism once (useEffect to set it up)
  // This pre-computes the deferral function to avoid 550+ typeof checks per message
  useEffect(() => {
    if (typeof (window as any).scheduler !== 'undefined' && (window as any).scheduler.postTask) {
      // scheduler.postTask is fastest (runs in separate task queue, doesn't block)
      deferUpdateRef.current = (taskId: string, data: any) => {
        (window as any).scheduler.postTask(() => {
          pendingUpdatesRef.current.set(taskId, data);
          scheduleBatchProcessing(data);
        }, { priority: 'user-blocking' });
      };
    } else if (typeof MessageChannel !== 'undefined') {
      // MessageChannel defers to next event loop tick (reuse shared channel)
      const channel = new MessageChannel();
      channel.port1.onmessage = (e: MessageEvent) => {
        const { taskId, data } = e.data;
        if (taskId && data) {
          pendingUpdatesRef.current.set(taskId, data);
          scheduleBatchProcessing(data);
        }
      };
      deferUpdateRef.current = (taskId: string, data: any) => {
        channel.port2.postMessage({ taskId, data });
      };
    } else {
      // Fallback: setTimeout(0) - still defers to next tick
      deferUpdateRef.current = (taskId: string, data: any) => {
        setTimeout(() => {
          pendingUpdatesRef.current.set(taskId, data);
          scheduleBatchProcessing(data);
        }, 0);
      };
    }
  }, [scheduleBatchProcessing]);
  
  
  const handleTaskCreated = useCallback((data: any) => {
    if (!data.task || !data.boardId) return;
    
    // Ignore tasks that were recently deleted (prevents reappearing after deletion)
    if (recentlyDeletedTasksRef.current?.has(data.task.id)) {
      wsHookLog('🚫 [WebSocket] Ignoring task-created for recently deleted task:', data.task.id);
      return;
    }
    
    // Ensure columnId is in camelCase (handle both snake_case and camelCase)
    if (!data.task.columnId && (data.task.columnid || data.task.column_id)) {
      data.task.columnId = data.task.columnid || data.task.column_id;
    }
    // Ensure boardId is in camelCase
    if (!data.task.boardId && (data.task.boardid || data.task.board_id)) {
      data.task.boardId = data.task.boardid || data.task.board_id;
    }
    
    // Cancel fallback refresh if WebSocket event arrived (for the user who created it)
    if (pendingTaskRefreshesRef.current?.has(data.task.id)) {
      pendingTaskRefreshesRef.current.delete(data.task.id);
    }
    
    // Always update boards state for task count updates (for all boards)
    setBoards(prevBoards => {
      const targetColumnId = data.task.columnId;
      const boardExists = prevBoards.some(b => b.id === data.boardId);

      // Lifecycle "restore board then tasks" can deliver task-restored before board-restored
      // is applied. Dropping the task here left peers with an empty restored board until refresh.
      const ensureColumn = (columns: Columns): Columns => {
        const next = { ...columns };
        if (!targetColumnId) return next;
        if (!next[targetColumnId]) {
          next[targetColumnId] = {
            id: targetColumnId,
            boardId: data.boardId,
            title: 'Unknown Column',
            tasks: [],
            position: 0,
            is_finished: false,
            is_archived: false,
          };
        }
        const existingTasks = next[targetColumnId].tasks || [];
        const taskExists = existingTasks.some((t) => t.id === data.task.id);
        next[targetColumnId] = {
          ...next[targetColumnId],
          tasks: taskExists
            ? existingTasks.map((t) => (t.id === data.task.id ? data.task : t))
            : [...existingTasks, data.task].sort(
                (a, b) => (a.position || 0) - (b.position || 0)
              ),
        };
        return next;
      };

      if (!boardExists) {
        return [
          ...prevBoards,
          {
            id: data.boardId,
            title: data.boardTitle || data.task?.boardTitle || 'Board',
            columns: ensureColumn({}),
            deletedAt: null,
          } as Board,
        ];
      }

      return prevBoards.map((board) => {
        if (board.id !== data.boardId) return board;
        return {
          ...board,
          deletedAt: null,
          columns: ensureColumn(board.columns || {}),
        };
      });
    });
    
    // Only update columns/filteredColumns if the task is for the currently selected board
    if (data.boardId === selectedBoardRef.current) {
      // Optimized: Add the specific task instead of full refresh
      setColumns(prevColumns => {
        const updatedColumns = { ...prevColumns };
        const targetColumnId = data.task.columnId;
        
        if (!updatedColumns[targetColumnId] && targetColumnId) {
          // Column doesn't exist yet - create it (similar to boards handler)
          updatedColumns[targetColumnId] = {
            id: targetColumnId,
            boardId: data.boardId,
            title: 'Unknown Column', // Will be updated when column-created event arrives
            tasks: [],
            position: 0,
            is_finished: false,
            is_archived: false
          };
        }
        
        if (updatedColumns[targetColumnId]) {
          // Check if task already exists (from optimistic update)
          const existingTasks = updatedColumns[targetColumnId].tasks;
          const taskExists = existingTasks.some(t => t.id === data.task.id);
          
          if (taskExists) {
            // Task already exists (optimistic update), just update it with server data
            const updatedTasks = existingTasks.map(t => {
              if (t.id === data.task.id) {
                // Preserve existing task data (comments, watchers, etc.) when updating
                const mergedTask = {
                  ...t,          // Preserve existing data (comments, watchers, collaborators, etc.)
                  ...data.task,  // Override with server data (position, columnId, etc.)
                  // Explicitly preserve nested arrays that might not be in data.task
                  // Use server data if it exists and is valid, otherwise preserve existing
                  comments: (data.task.comments && Array.isArray(data.task.comments) && data.task.comments.length > 0) 
                    ? data.task.comments 
                    : (t.comments || []),
                  watchers: (data.task.watchers && Array.isArray(data.task.watchers) && data.task.watchers.length > 0)
                    ? data.task.watchers
                    : (t.watchers || []),
                  collaborators: (data.task.collaborators && Array.isArray(data.task.collaborators) && data.task.collaborators.length > 0)
                    ? data.task.collaborators
                    : (t.collaborators || []),
                  tags: (data.task.tags && Array.isArray(data.task.tags) && data.task.tags.length > 0)
                    ? data.task.tags
                    : (t.tags || [])
                };
                return mergedTask;
              }
              return t;
            });
            updatedColumns[targetColumnId] = {
              ...updatedColumns[targetColumnId],
              tasks: updatedTasks
            };
          } else {
            // Task doesn't exist yet, add it and sort by position (preserve server position)
            // CRITICAL: Use the position from the server (e.g., 4.50 for copied tasks)
            // Don't renumber - this would break fractional positions
            const allTasks = [...existingTasks, data.task];
            const updatedTasks = allTasks.sort((a, b) => (a.position || 0) - (b.position || 0));
            
            updatedColumns[targetColumnId] = {
              ...updatedColumns[targetColumnId],
              tasks: updatedTasks
            };
          }
        }
        // Ensure created task isn't also lingering in another column
        return stripTaskFromAllColumns(updatedColumns, data.task.id, {
          exceptColumnId: targetColumnId,
          renumber: false,
        });
      });
      
      // DON'T update filteredColumns here - let the filtering useEffect handle it
      // This prevents duplicate tasks when the effect runs after columns change
    }
  }, [setBoards, setColumns, selectedBoardRef, pendingTaskRefreshesRef, recentlyDeletedTasksRef]);

  const handleTaskUpdated = useCallback((data: any) => {
    // CRITICAL: Make message handler ULTRA-lightweight - absolute minimum synchronous work
    // This prevents violations when hundreds of messages arrive rapidly (e.g., 550 tasks on page load)
    // Strategy: Validate once, then immediately defer ALL work (no conditional checks in hot path)
    
    // Ultra-fast validation (single optional chaining check)
    const taskId = data?.task?.id;
    if (!taskId || !data?.boardId) return;
    
    // Ignore tasks that were recently deleted (prevents reappearing after deletion)
    if (recentlyDeletedTasksRef.current?.has(taskId)) {
      wsHookLog('🚫 [WebSocket] Ignoring task-updated for recently deleted task:', taskId);
      return;
    }
    
    // IMMEDIATELY defer using pre-computed mechanism (no conditional checks here!)
    // The deferral mechanism was pre-computed in useEffect to avoid 550+ typeof checks
    const defer = deferUpdateRef.current;
    if (defer) {
      defer(taskId, data);
    } else {
      // Fallback if not initialized yet (shouldn't happen, but be safe)
      setTimeout(() => {
        pendingUpdatesRef.current.set(taskId, data);
        scheduleBatchProcessing(data);
      }, 0);
    }
  }, [scheduleBatchProcessing, recentlyDeletedTasksRef]);
  
  const handleTaskDeleted = useCallback((data: any) => {
    if (!data.taskId || !data.boardId) return;
    
    // Always update boards state for task count updates (for all boards)
    setBoards(prevBoards => {
      return prevBoards.map(board => {
        if (board.id === data.boardId) {
          const updatedBoard = { ...board };
          const updatedColumns = { ...updatedBoard.columns };
          
          // Find and remove the task from the appropriate column
          Object.keys(updatedColumns).forEach(columnId => {
            const column = updatedColumns[columnId];
            const taskIndex = column.tasks.findIndex(t => t.id === data.taskId);
            if (taskIndex !== -1) {
              // Keep position gaps (matches server soft-delete) so restore can reclaim its slot
              const remainingTasks = column.tasks.filter(task => task.id !== data.taskId);
              
              updatedColumns[columnId] = {
                ...column,
                tasks: remainingTasks
              };
            }
          });
          
          updatedBoard.columns = updatedColumns;
          return updatedBoard;
        }
        return board;
      });
    });
    
    // Only update columns if the task is for the currently selected board
    if (data.boardId === selectedBoardRef.current) {
      setColumns(prevColumns => {
        const updatedColumns = { ...prevColumns };
        
        // Find and remove the task from the appropriate column
        Object.keys(updatedColumns).forEach(columnId => {
          const column = updatedColumns[columnId];
          if (!column || !column.tasks) return;
          
          const taskIndex = column.tasks.findIndex(t => t && t.id === data.taskId);
          if (taskIndex !== -1) {
            // Keep position gaps (matches server soft-delete) so restore can reclaim its slot
            const remainingTasks = column.tasks.filter(task => task && task.id !== data.taskId);
            
            updatedColumns[columnId] = {
              ...column,
              tasks: remainingTasks
            };
          }
        });
        
        return updatedColumns;
      });
      
      // Clear selectedTask if it was the deleted task
      if (selectedTaskRef.current?.id === data.taskId) {
        setSelectedTask(null);
      }
    }
  }, [setBoards, setColumns, selectedBoardRef, setSelectedTask]);

  const handleTaskRestored = useCallback((
    data: any,
    options?: { skipSettledRefresh?: boolean }
  ) => {
    if (!data.task || !data.boardId) return;
    // Allow the task to reappear after soft-delete ignore window
    recentlyDeletedTasksRef.current?.delete(data.task.id);
    // Normalize fields from SQL / restore payload
    if (!data.task.columnId && (data.task.columnid || data.task.column_id)) {
      data.task.columnId = data.task.columnid || data.task.column_id;
    }
    if (!data.task.boardId && (data.task.boardid || data.task.board_id)) {
      data.task.boardId = data.task.boardid || data.task.board_id;
    }
    if (!data.task.memberId && data.task.memberid) {
      data.task.memberId = data.task.memberid;
    }
    // Clear camelCase + snake_case so a later merge cannot revive read-only mode
    data.task.deletedAt = null;
    data.task.deletedBy = null;
    data.task.deleted_at = null;
    data.task.deleted_by = null;

    const positionUpdates = Array.isArray(data.positionUpdates)
      ? data.positionUpdates
      : undefined;

    // Single state update: reclaim original slot + shift siblings (or apply server snapshot)
    setBoards((prevBoards) => {
      const boardExists = prevBoards.some((b) => b.id === data.boardId);
      if (!boardExists) {
        return [
          ...prevBoards,
          {
            id: data.boardId,
            title: data.boardTitle || data.task?.boardTitle || 'Board',
            columns: applyRestoredTaskToColumns({}, data.task, { positionUpdates }),
            deletedAt: null,
          } as Board,
        ];
      }
      return prevBoards.map((board) => {
        if (board.id !== data.boardId) return board;
        return {
          ...board,
          deletedAt: null,
          columns: applyRestoredTaskToColumns(board.columns || {}, data.task, {
            positionUpdates,
          }),
        };
      });
    });

    if (data.boardId === selectedBoardRef.current) {
      setColumns((prev) =>
        applyRestoredTaskToColumns(prev, data.task, { positionUpdates })
      );
    }

    // Lifecycle "restore board then tasks" still needs a settled force refresh.
    // Local trash/details restores already patched from HTTP — skip the 1.5s flash
    // (including the WS echo for our own restore).
    const selfRestore =
      options?.skipSettledRefresh ||
      pendingSelfTaskRestoresRef?.current?.delete(data.task.id);
    if (!selfRestore) {
      scheduleSettledBoardRefresh(refreshBoardDataRef.current);
    }
    // If TaskDetails is open on this task, exit read-only lifecycle mode
    if (selectedTaskRef.current?.id === data.task.id) {
      setSelectedTask({
        ...selectedTaskRef.current,
        ...data.task,
        deletedAt: null,
        deletedBy: null,
        deleted_at: null,
        deleted_by: null,
      });
    }
  }, [setBoards, setColumns, selectedBoardRef, recentlyDeletedTasksRef, setSelectedTask, refreshBoardDataRef, pendingSelfTaskRestoresRef]);

  const handleTaskPurged = useCallback((data: any) => {
    if (!data.taskId) return;
    recentlyDeletedTasksRef.current?.delete(data.taskId);
    if (selectedTaskRef.current?.id === data.taskId) {
      setSelectedTask(null);
    }
    // Also remove from board state if still present (live permanent delete / race)
    setColumns((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((columnId) => {
        const column = next[columnId];
        if (!column?.tasks?.some((t) => t.id === data.taskId)) return;
        changed = true;
        const remaining = column.tasks.filter((t) => t.id !== data.taskId);
        next[columnId] = {
          ...column,
          tasks: remaining
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((task, index) => ({ ...task, position: index })),
        };
      });
      return changed ? next : prev;
    });
  }, [recentlyDeletedTasksRef, selectedTaskRef, setSelectedTask, setColumns]);
  
  const handleTaskRelationshipCreated = useCallback((data: any) => {
    wsHookLog('🔗 [WebSocket] task-relationship-created received:', data);
    
    // Always clear the taskRelationships cache for both tasks involved
    // This ensures hover highlighting will reload fresh data
    if (data.taskId && data.toTaskId) {
      taskLinking.setTaskRelationships((prev: { [taskId: string]: any[] }) => {
        const updated = { ...prev };
        delete updated[data.taskId];
        delete updated[data.toTaskId];
        return updated;
      });
    }
    
    const currentBoardId = selectedBoardRef.current;
    if (data.boardId && data.boardId === currentBoardId) {
      wsHookLog('🔗 [WebSocket] Refreshing relationships for board:', data.boardId);
      getBoardTaskRelationships(data.boardId)
        .then(relationships => {
          wsHookLog('🔗 [WebSocket] Loaded relationships:', relationships.length, 'for board:', data.boardId);
          taskLinking.setBoardRelationships(relationships);
        })
        .catch(error => {
          console.warn('⚠️ [WebSocket] Failed to load relationships:', error);
          if (refreshBoardDataRef.current) {
            refreshBoardDataRef.current();
          }
        });
    } else if (!data.boardId) {
      console.warn('⚠️ [WebSocket] task-relationship-created event missing boardId:', data);
    }
  }, [selectedBoardRef, taskLinking]);
  
  const handleTaskRelationshipDeleted = useCallback((data: any) => {
    if (data.taskId && data.toTaskId) {
      taskLinking.setTaskRelationships((prev: { [taskId: string]: any[] }) => {
        const updated = { ...prev };
        delete updated[data.taskId];
        delete updated[data.toTaskId];
        return updated;
      });
    }

    const currentBoardId = selectedBoardRef.current;
    if (data.boardId && data.boardId === currentBoardId) {
      getBoardTaskRelationships(data.boardId)
        .then(relationships => {
          taskLinking.setBoardRelationships(relationships);
        })
        .catch(error => {
          console.warn('Failed to load relationships:', error);
          if (refreshBoardDataRef.current) {
            refreshBoardDataRef.current();
          }
        });
    }
  }, [selectedBoardRef, taskLinking]);
  
  const handleTaskWatcherAdded = useCallback((data: any) => {
    // Only refresh if the task is for the current board
    if (data.boardId === selectedBoardRef.current) {
      // For watchers/collaborators, we need to refresh the specific task
      // This is more efficient than refreshing the entire board
      if (data.taskId && pendingTaskRefreshesRef.current) {
        pendingTaskRefreshesRef.current.add(data.taskId);
      }
    }
  }, [selectedBoardRef, pendingTaskRefreshesRef]);
  
  const handleTaskWatcherRemoved = useCallback((data: any) => {
    // Only refresh if the task is for the current board
    if (data.boardId === selectedBoardRef.current) {
      // For watchers/collaborators, we need to refresh the specific task
      // This is more efficient than refreshing the entire board
      if (data.taskId && pendingTaskRefreshesRef.current) {
        pendingTaskRefreshesRef.current.add(data.taskId);
      }
    }
  }, [selectedBoardRef, pendingTaskRefreshesRef]);
  
  const handleTaskCollaboratorAdded = useCallback((data: any) => {
    // Only refresh if the task is for the current board
    if (data.boardId === selectedBoardRef.current) {
      // For watchers/collaborators, we need to refresh the specific task
      // This is more efficient than refreshing the entire board
      if (data.taskId && pendingTaskRefreshesRef.current) {
        pendingTaskRefreshesRef.current.add(data.taskId);
      }
    }
  }, [selectedBoardRef, pendingTaskRefreshesRef]);
  
  const handleTaskCollaboratorRemoved = useCallback((data: any) => {
    // Only refresh if the task is for the current board
    if (data.boardId === selectedBoardRef.current) {
      // For watchers/collaborators, we need to refresh the specific task
      // This is more efficient than refreshing the entire board
      if (data.taskId && pendingTaskRefreshesRef.current) {
        pendingTaskRefreshesRef.current.add(data.taskId);
      }
    }
  }, [selectedBoardRef, pendingTaskRefreshesRef]);
  
  const handleTaskTagAdded = useCallback((data: any) => {
    // CRITICAL: Make message handler lightweight - defer heavy work to prevent blocking
    // Validate quickly first
    if (!data.taskId || !data.tagId || !data.boardId) {
      return;
    }
    
    // Normalize boardId comparison (handle both snake_case and camelCase)
    const eventBoardId = data.boardId || data.boardid || data.board_id;
    const currentBoardId = selectedBoardRef.current;
    
    // Only update if the task is for the current board
    if (eventBoardId !== currentBoardId) {
      return;
    }
    
    // Handle case where tag might be a string or incomplete object
    const tagData = typeof data.tag === 'string' 
      ? { id: data.tagId, tag: data.tag, description: null, color: null }
      : { id: data.tagId, tag: data.tag?.tag || data.tag, description: data.tag?.description || null, color: data.tag?.color || null };
    
    // Defer state updates to prevent blocking the main thread
    setTimeout(() => {
      const updatedTaskRef = { current: null as Task | null };
      
      // Update columns state directly
      setColumns(prevColumns => {
        const updatedColumns = { ...prevColumns };
        let taskFound = false;
        
        // Find the task across all columns and add the tag
        Object.keys(updatedColumns).forEach(columnId => {
          const column = updatedColumns[columnId];
          const taskIndex = column.tasks.findIndex(t => t.id === data.taskId);
          
          if (taskIndex !== -1) {
            taskFound = true;
            wsHookLog('✅ [WebSocket] handleTaskTagAdded: Task found in column', {
              columnId,
              taskIndex,
              currentTags: column.tasks[taskIndex].tags?.length || 0
            });
            
            const updatedTasks = [...column.tasks];
            const task = { ...updatedTasks[taskIndex] };
            
            // Ensure tags array exists
            const existingTags = Array.isArray(task.tags) ? task.tags : [];
            
            wsHookLog('🏷️ [WebSocket] handleTaskTagAdded: Current tags', {
              existingTagsCount: existingTags.length,
              existingTagIds: existingTags.map(t => t.id),
              newTagId: data.tagId,
              tagAlreadyExists: existingTags.some(t => t.id === data.tagId || t.id === parseInt(data.tagId))
            });
            
            // Check if tag already exists (avoid duplicates)
            if (!existingTags.some(t => t.id === data.tagId || t.id === parseInt(data.tagId))) {
              // Add the new tag (use tagData which handles both string and object formats)
              const newTag = {
                id: data.tagId,
                tag: tagData.tag,
                description: tagData.description,
                color: tagData.color
              };
              const newTags = [...existingTags, newTag];
              
              wsHookLog('➕ [WebSocket] handleTaskTagAdded: Adding tag', {
                newTag,
                newTagsCount: newTags.length
              });
              
              // Create updated task with new tags
              const updatedTask = {
                ...task,
                tags: newTags
              };
              
              updatedTasks[taskIndex] = updatedTask;
              updatedColumns[columnId] = {
                ...column,
                tasks: updatedTasks
              };
              
              wsHookLog('✅ [WebSocket] handleTaskTagAdded: Task updated in column', {
                columnId,
                taskId: updatedTask.id,
                tagsCount: updatedTask.tags.length,
                tagIds: updatedTask.tags.map(t => t.id)
              });
              
              // Track updated task if it's the selected one
              if (selectedTaskRef.current && selectedTaskRef.current.id === data.taskId) {
                updatedTaskRef.current = updatedTask;
                wsHookLog('✅ [WebSocket] handleTaskTagAdded: Selected task updated');
              }
            } else {
              wsHookLog('⚠️ [WebSocket] handleTaskTagAdded: Tag already exists, skipping');
            }
          }
        });
        
        if (!taskFound) {
          console.warn('⚠️ [WebSocket] handleTaskTagAdded: Task not found in columns, queueing refresh', {
            taskId: data.taskId,
            availableColumnIds: Object.keys(updatedColumns)
          });
          // Task not found in columns, queue refresh
          if (pendingTaskRefreshesRef.current) {
            pendingTaskRefreshesRef.current.add(data.taskId);
          }
        }
        
        // Log final state to verify update
        const finalColumn = updatedColumns[Object.keys(updatedColumns).find(colId => {
          const col = updatedColumns[colId];
          return col.tasks.some(t => t.id === data.taskId);
        }) || ''];
        const finalTask = finalColumn?.tasks.find(t => t.id === data.taskId);
        
      wsHookLog('✅ [WebSocket] handleTaskTagAdded: Updated columns state', {
        taskFound: !!finalTask,
        finalTagsCount: finalTask?.tags?.length || 0,
        finalTagIds: finalTask?.tags?.map(t => t.id) || [],
        columnId: Object.keys(updatedColumns).find(colId => {
          const col = updatedColumns[colId];
          return col.tasks.some(t => t.id === data.taskId);
        })
      });
      
      return updatedColumns;
      });
      
      // Update selectedTask if it's the one that got the tag
      if (updatedTaskRef.current) {
        wsHookLog('✅ [WebSocket] handleTaskTagAdded: Updating selectedTask');
        setSelectedTask(updatedTaskRef.current);
      }
      
      // Manually update filteredColumns immediately for tag updates
      // The useTaskFilters useEffect has a delay for batch updates, but for single tag updates
      // we want immediate UI updates. We'll update filteredColumns directly.
      // We always update filteredColumns to match columns for tag updates, regardless of filtering state
      taskFilters.setFilteredColumns(prevFilteredColumns => {
          // No filtering active - filteredColumns should match columns
          // We need to find the updated task and apply the same change
          const updatedFilteredColumns = { ...prevFilteredColumns };
          Object.keys(updatedFilteredColumns).forEach(columnId => {
            const column = updatedFilteredColumns[columnId];
            if (column) {
              const taskIndex = column.tasks.findIndex(t => t.id === data.taskId);
              if (taskIndex !== -1) {
                const updatedTasks = [...column.tasks];
                const task = { ...updatedTasks[taskIndex] };
                const existingTags = Array.isArray(task.tags) ? task.tags : [];
                if (!existingTags.some(t => t.id === data.tagId || t.id === parseInt(data.tagId))) {
                  const newTag = {
                    id: data.tagId,
                    tag: tagData.tag,
                    description: tagData.description,
                    color: tagData.color
                  };
                  updatedTasks[taskIndex] = {
                    ...task,
                    tags: [...existingTags, newTag]
                  };
                  updatedFilteredColumns[columnId] = {
                    ...column,
                    tasks: updatedTasks
                  };
                }
              }
            }
          });
          return updatedFilteredColumns;
      });
      
      wsHookLog('✅ [WebSocket] handleTaskTagAdded: Updated both columns and filteredColumns');
    }, 0);
  }, [setColumns, setSelectedTask, selectedBoardRef, pendingTaskRefreshesRef, taskFilters, selectedTaskRef]);
  
  const handleTaskTagRemoved = useCallback((data: any) => {
    wsHookLog('📥 [WebSocket] handleTaskTagRemoved received:', data);
    
    if (!data.taskId || !data.tagId || !data.boardId) {
      console.warn('⚠️ [WebSocket] handleTaskTagRemoved: Missing required fields', { taskId: data.taskId, tagId: data.tagId, boardId: data.boardId });
      return;
    }
    
    // Normalize boardId comparison (handle both snake_case and camelCase)
    const eventBoardId = data.boardId || data.boardid || data.board_id;
    const currentBoardId = selectedBoardRef.current;
    
    wsHookLog('📋 [WebSocket] handleTaskTagRemoved: boardId:', eventBoardId, 'selectedBoard:', currentBoardId);
    
    // Only update if the task is for the current board
    if (eventBoardId === currentBoardId) {
      wsHookLog('✅ [WebSocket] handleTaskTagRemoved: Board matches, updating state');
      const updatedTaskRef = { current: null as Task | null };
      
      // Update columns state directly
      setColumns(prevColumns => {
        const updatedColumns = { ...prevColumns };
        let taskFound = false;
        
        // Find the task across all columns and remove the tag
        Object.keys(updatedColumns).forEach(columnId => {
          const column = updatedColumns[columnId];
          const taskIndex = column.tasks.findIndex(t => t.id === data.taskId);
          
          if (taskIndex !== -1) {
            taskFound = true;
            const updatedTasks = [...column.tasks];
            const task = { ...updatedTasks[taskIndex] };
            
            // Ensure tags array exists and filter out the removed tag
            const existingTags = Array.isArray(task.tags) ? task.tags : [];
            const newTags = existingTags.filter(t => 
              t.id !== data.tagId && t.id !== parseInt(data.tagId)
            );
            
            // Create updated task with filtered tags
            const updatedTask = {
              ...task,
              tags: newTags
            };
            
            updatedTasks[taskIndex] = updatedTask;
            updatedColumns[columnId] = {
              ...column,
              tasks: updatedTasks
            };
            
            // Track updated task if it's the selected one
            if (selectedTaskRef.current && selectedTaskRef.current.id === data.taskId) {
              updatedTaskRef.current = updatedTask;
            }
          }
        });
        
        if (!taskFound) {
          // Task not found in columns, queue refresh
          if (pendingTaskRefreshesRef.current) {
            pendingTaskRefreshesRef.current.add(data.taskId);
          }
        }
        
        return updatedColumns;
      });
      
      // Update selectedTask if it's the one that got the tag removed
      if (updatedTaskRef.current) {
        setSelectedTask(updatedTaskRef.current);
      }
      
      // Also update filteredColumns
      taskFilters.setFilteredColumns(prevFilteredColumns => {
        const updatedFilteredColumns = { ...prevFilteredColumns };
        
        Object.keys(updatedFilteredColumns).forEach(columnId => {
          const column = updatedFilteredColumns[columnId];
          if (column) {
            const taskIndex = column.tasks.findIndex(t => t.id === data.taskId);
            
            if (taskIndex !== -1) {
              const updatedTasks = [...column.tasks];
              const task = { ...updatedTasks[taskIndex] };
              
              const existingTags = Array.isArray(task.tags) ? task.tags : [];
              const newTags = existingTags.filter(t => 
                t.id !== data.tagId && t.id !== parseInt(data.tagId)
              );
              
              updatedTasks[taskIndex] = {
                ...task,
                tags: newTags
              };
              
              updatedFilteredColumns[columnId] = {
                ...column,
                tasks: updatedTasks
              };
            }
          }
        });
        
        return updatedFilteredColumns;
      });
    }
  }, [setColumns, setSelectedTask, selectedBoardRef, selectedTask, taskFilters, pendingTaskRefreshesRef, recentlyDeletedTasksRef]);

  /**
   * Admin deleted a tag globally — strip it from every cached task (current board + boards[]).
   * Complements task-tag-removed events so other boards' caches stay clean on switch.
   */
  const handleTagDeleted = useCallback((data: any) => {
    const rawTagId = data?.tagId ?? data?.tag?.id;
    if (rawTagId == null) return;
    const tagIdNum = typeof rawTagId === 'number' ? rawTagId : parseInt(String(rawTagId), 10);
    if (Number.isNaN(tagIdNum)) return;

    const stripTags = (tags: Task['tags']) => {
      if (!Array.isArray(tags) || tags.length === 0) return tags;
      const filtered = tags.filter((t) => t.id !== tagIdNum && String(t.id) !== String(rawTagId));
      return filtered.length === tags.length ? tags : filtered;
    };

    const stripColumns = (cols: Columns): Columns => {
      let changed = false;
      const next: Columns = { ...cols };
      for (const columnId of Object.keys(cols)) {
        const column = cols[columnId];
        if (!column?.tasks) continue;
        let columnChanged = false;
        const tasks = column.tasks.map((task) => {
          const newTags = stripTags(task.tags);
          if (newTags === task.tags) return task;
          columnChanged = true;
          return { ...task, tags: newTags || [] };
        });
        if (columnChanged) {
          changed = true;
          next[columnId] = { ...column, tasks };
        }
      }
      return changed ? next : cols;
    };

    setColumns((prev) => stripColumns(prev));
    taskFilters.setFilteredColumns((prev) => stripColumns(prev));
    setBoards((prevBoards) =>
      prevBoards.map((board) => {
        if (!board.columns) return board;
        const updatedColumns = stripColumns(board.columns);
        return updatedColumns === board.columns ? board : { ...board, columns: updatedColumns };
      })
    );
    setSelectedTask((prev) => {
      if (!prev?.tags?.length) return prev;
      const newTags = stripTags(prev.tags);
      if (newTags === prev.tags) return prev;
      return { ...prev, tags: newTags || [] };
    });
  }, [setColumns, setBoards, setSelectedTask, taskFilters]);

  /**
   * Apply authoritative column positions from server (add-at-top, delete renumber).
   * Payload: { boardId, updates: [{ taskId, position, columnId }] }
   */
  const handleTasksPositionsUpdated = useCallback((data: any) => {
    if (!data) return;

    // Oversized NOTIFY was compacted to a refresh hint (large columns)
    if (data.refresh === true && data.boardId) {
      scheduleSettledBoardRefresh(refreshBoardDataRef.current);
      return;
    }

    if (!data?.updates || !Array.isArray(data.updates) || data.updates.length === 0) {
      return;
    }

    if ((window as any).reorderingInProgress) {
      wsHookLog('🚫 [WebSocket] Skipping tasks-positions-updated - reordering in progress');
      return;
    }

    const positionById = new Map<string, { position: number; columnId?: string }>();
    for (const u of data.updates) {
      if (!u?.taskId) continue;
      positionById.set(u.taskId, {
        position: typeof u.position === 'number' ? u.position : parseFloat(u.position) || 0,
        columnId: u.columnId
      });
    }

    const applyPositions = (cols: Columns): Columns => {
      const next = { ...cols };
      let changed = false;
      for (const columnId of Object.keys(next)) {
        const column = next[columnId];
        if (!column?.tasks) continue;
        let columnChanged = false;
        const updatedTasks = column.tasks.map(task => {
          const upd = positionById.get(task.id);
          if (!upd) return task;
          const targetCol = upd.columnId || columnId;
          if (task.position !== upd.position || task.columnId !== targetCol) {
            columnChanged = true;
            return { ...task, position: upd.position, columnId: targetCol };
          }
          return task;
        });
        if (columnChanged) {
          changed = true;
          next[columnId] = {
            ...column,
            tasks: [...updatedTasks].sort((a, b) => (a.position || 0) - (b.position || 0))
          };
        }
      }
      // Move tasks that changed columnId between columns in this board snapshot
      // (add/delete usually stay in-column; cross-column is via task-updated batch)
      return changed ? next : cols;
    };

    if (data.boardId === selectedBoardRef.current) {
      setColumns(prev => applyPositions(prev));
    }

    setBoards(prevBoards =>
      prevBoards.map(board => {
        if (data.boardId && board.id !== data.boardId) return board;
        const updatedColumns = applyPositions(board.columns || {});
        if (updatedColumns === board.columns) return board;
        return { ...board, columns: updatedColumns };
      })
    );
  }, [setColumns, setBoards, selectedBoardRef, refreshBoardDataRef]);
  
  return {
    handleTaskCreated,
    handleTaskUpdated,
    handleTaskDeleted,
    handleTaskRestored,
    handleTaskPurged,
    handleTasksPositionsUpdated,
    handleTaskRelationshipCreated,
    handleTaskRelationshipDeleted,
    handleTaskWatcherAdded,
    handleTaskWatcherRemoved,
    handleTaskCollaboratorAdded,
    handleTaskCollaboratorRemoved,
    handleTaskTagAdded,
    handleTaskTagRemoved,
    handleTagDeleted
  };
};

