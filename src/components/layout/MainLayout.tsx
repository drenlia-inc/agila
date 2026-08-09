import React, { Suspense, useEffect, useState } from 'react';
import { 
  CurrentUser, 
  TeamMember, 
  Board, 
  Task, 
  Columns, 
  PriorityOption,
  Tag,
  ColumnVisibilityWarning
} from '../../types';
import { TaskViewMode, ViewMode } from '../../utils/userPreferences';
import LoadingSpinner from '../LoadingSpinner';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import type { AdminDraftGate } from '../admin/AdminLeaveUnsavedDialog';

// Lazy load heavy pages to reduce initial bundle size with retry logic for network failures
const Admin = lazyWithRetry(() => import('../Admin'));
const Reports = lazyWithRetry(() => import('../Reports'));
const KanbanPage = lazyWithRetry(() => import('./KanbanPage'));

// Loading fallback component for lazy-loaded pages
const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <LoadingSpinner />
  </div>
);

interface MainLayoutProps {
  currentPage: 'kanban' | 'admin' | 'reports';
  currentUser: CurrentUser | null;
  selectedTask: Task | null;
  
  // Admin props
  adminRefreshKey: number;
  onUsersChanged: () => Promise<void>;
  onSettingsChanged: () => Promise<void>;
  onAdminDraftGateChange?: (gate: AdminDraftGate | null) => void;
  
  // Kanban props
  siteSettings: { [key: string]: string };
  isOnline?: boolean; // Network status
  /** false for viewer (read-only) role */
  canMutate?: boolean;
  loading: {
    general: boolean;
    tasks: boolean;
    boards: boolean;
    columns: boolean;
  };
  members: TeamMember[];
  boards: Board[];
  selectedBoard: string | null;
  columns: Columns;
  selectedMembers: string[];
  draggedTask: Task | null;
  draggedColumn: any;
  dragPreview: any;
  availablePriorities: PriorityOption[];
  availableTags: Tag[];
  availableSprints?: any[]; // Optional for backward compatibility
  taskViewMode: TaskViewMode;
  viewMode: ViewMode;
  isSearchActive: boolean;
  searchFilters: any;
  filteredColumns: Columns;
  activeFilters: boolean;
  gridStyle: React.CSSProperties;
  sensors: any;
  collisionDetection: any;
  boardColumnVisibility: {[boardId: string]: string[]};
  onBoardColumnVisibilityChange: (boardId: string, visibleColumns: string[]) => void;

  
  // Event handlers
  onSelectMember: (memberId: string) => void;
  onClearMemberSelections: () => void;
  onSelectAllMembers: () => void;
  isAllModeActive: boolean;
  includeAssignees: boolean;
  includeWatchers: boolean;
  includeCollaborators: boolean;
  includeRequesters: boolean;
  includeSystem: boolean;
  onToggleAssignees: (include: boolean) => void;
  onToggleWatchers: (include: boolean) => void;
  onToggleCollaborators: (include: boolean) => void;
  onToggleRequesters: (include: boolean) => void;
  onToggleSystem: (include: boolean) => void;
  onEditOwnProfile?: () => void;
  showAgentTasks?: boolean;
  onToggleShowAgentTasks?: (show: boolean) => void;
  onTaskViewModeChange: (mode: TaskViewMode) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleSearch: () => void;
  onSearchFiltersChange: (filters: any) => void;
  currentFilterView?: any; // SavedFilterView | null
  sharedFilterViews?: any[]; // SavedFilterView[]
  onFilterViewChange?: (view: any) => void; // (view: SavedFilterView | null) => void
  onSelectBoard: (boardId: string) => void;
  onAddBoard: () => Promise<void>;
  onEditBoard: (boardId: string, title: string) => Promise<void>;
  onRemoveBoard: (boardId: string) => Promise<void>;
  onReorderBoards: (boardId: string, newPosition: number) => Promise<void>;
  getTaskCountForBoard: (board: Board) => number;
  /** Unfiltered board task total, used for destructive confirmations. */
  getTotalTaskCountForBoard?: (board: Board) => number;
  onDragStart: (event: any) => void;
  onDragOver: (event: any) => void;
  onDragEnd: (event: any) => void;
  onAddTask: (columnId: string) => Promise<void>;
  columnWarnings: Record<string, ColumnVisibilityWarning>;
  onDismissColumnWarning: (columnId: string) => void;
  onClearFiltersForHiddenTask?: () => void;
  onAssignCreatedTaskToSprint?: (columnId: string, taskId: string, sprintId: string) => Promise<void>;
  onRemoveTask: (taskId: string, event?: React.MouseEvent) => Promise<void>;
  onEditTask: (task: Task) => Promise<void>;
  onCopyTask: (task: Task) => Promise<void>;
  onTagAdd: (taskId: string) => (tagId: string) => Promise<void>;
  onTagRemove: (taskId: string) => (tagId: string) => Promise<void>;
  onMoveTaskToColumn: (taskId: string, targetColumnId: string) => Promise<void>;
  onEditColumn: (
    columnId: string,
    title: string,
    is_finished?: boolean,
    is_archived?: boolean,
    wip_limit?: number | null,
    policy_text?: string | null
  ) => Promise<void>;
  onRemoveColumn: (columnId: string) => Promise<void>;
  onAddColumn: (afterColumnId: string) => Promise<void>;
  onTaskDragStart: (task: Task) => void;
  onTaskDragEnd: () => void;
  onClearDragState: () => void;
  onTaskDragOver: (e: React.DragEvent) => void;
  onRefreshBoardData: () => Promise<void>;
  onSetDragCooldown: (active: boolean, duration?: number) => void;
  onTaskDrop: () => Promise<void>;
  onSelectTask: (task: Task | null, options?: { scrollToComments?: boolean }) => void;
  onTaskDropOnBoard: (taskId: string, targetBoardId: string) => Promise<void>;
  animateCopiedTaskId?: string | null;
  showColumnDeleteConfirm?: string | null;
  onConfirmColumnDelete?: (columnId: string) => Promise<void>;
  onCancelColumnDelete?: () => void;
  getColumnTaskCount?: (columnId: string) => number;
  isTaskMiniMode?: boolean;
  onTaskEnterMiniMode?: () => void;
  onTaskExitMiniMode?: () => void;
  
  // Task linking props
  isLinkingMode?: boolean;
  linkingSourceTask?: Task | null;
  linkingLine?: {startX: number, startY: number, endX: number, endY: number} | null;
  onStartLinking?: (task: Task, startPosition: {x: number, y: number}) => void;
  onUpdateLinkingLine?: (endPosition: {x: number, y: number}) => void;
  onFinishLinking?: (targetTask: Task | null, relationshipType?: 'parent' | 'child' | 'related') => Promise<void>;
  onCancelLinking?: () => void;
  
  // Hover highlighting props
  hoveredLinkTask?: Task | null;
  onLinkToolHover?: (task: Task) => void;
  onLinkToolHoverEnd?: () => void;
  getTaskRelationshipType?: (taskId: string) => 'parent' | 'child' | 'related' | null;
  
  // Column resizing
  kanbanColumnWidth?: number;
  onColumnWidthResize?: (deltaX: number) => void;
  onTaskRestoredLocally?: (task: Task) => void;

  // Kanban multi-select / bulk actions
  checkedTaskIds?: Set<string>;
  onToggleTaskChecked?: (taskId: string) => void;
  onToggleColumnChecked?: (columnId: string, taskIds: string[], selectAll: boolean) => void;
  onClearAllChecked?: () => void;
  isMultiSelectDragLocked?: boolean;
  bulkBusy?: boolean;
  onBulkAddTag?: (taskIds: string[], tagId: string) => void;
  onBulkCopy?: (taskIds: string[]) => void;
  onBulkArchive?: (taskIds: string[]) => void;
  onBulkDelete?: (taskIds: string[]) => void;
  onBulkPermanentDelete?: (taskIds: string[]) => void;
  onBulkSprint?: (taskIds: string[], sprintId: string | null) => void;
  onBulkPriority?: (taskIds: string[], priorityId: string) => void;
  onBulkMoveToBoard?: (taskIds: string[], boardId: string) => void;
  onBulkAssignee?: (taskIds: string[], memberId: string) => void;
  onBulkRequester?: (taskIds: string[], memberId: string) => void;
  onBulkAddWatcher?: (taskIds: string[], memberId: string) => void;
  onBulkRemoveWatcher?: (taskIds: string[], memberId: string) => void;
  onBulkAddCollaborator?: (taskIds: string[], memberId: string) => void;
  onBulkRemoveCollaborator?: (taskIds: string[], memberId: string) => void;
  bulkUndoTaskIds?: string[] | null;
  bulkUndoLabelKey?: string;
  onBulkUndo?: () => void;
  onClearBulkUndo?: () => void;
  draggedTaskIds?: string[];
}

const MainLayout: React.FC<MainLayoutProps> = ({
  currentPage,
  currentUser,
  selectedTask,
  adminRefreshKey,
  onUsersChanged,
  onSettingsChanged,
  onAdminDraftGateChange,
  ...kanbanProps
}) => {
  // Keep Admin mounted after first visit so unsaved drafts survive Kanban/Reports switches
  const [adminEverOpened, setAdminEverOpened] = useState(currentPage === 'admin');
  useEffect(() => {
    if (currentPage === 'admin') setAdminEverOpened(true);
  }, [currentPage]);

  const adminVisible = currentPage === 'admin';

  return (
    <div className="flex-1 py-6 app-page-inline-gutter main-layout-container">
      <div className="app-page-shell">
        <Suspense fallback={<PageLoader />}>
          {(adminVisible || adminEverOpened) && (
            <div
              className={adminVisible ? undefined : 'hidden'}
              aria-hidden={!adminVisible}
            >
              <Admin
                key={adminRefreshKey}
                currentUser={currentUser}
                onUsersChanged={onUsersChanged}
                onSettingsChanged={onSettingsChanged}
                onDraftGateChange={onAdminDraftGateChange}
              />
            </div>
          )}
          {currentPage === 'reports' && <Reports currentUser={currentUser} />}
          {currentPage === 'kanban' && (
            <KanbanPage
              currentUser={currentUser}
              selectedTask={selectedTask}
              {...kanbanProps}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default MainLayout;
