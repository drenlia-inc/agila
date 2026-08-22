import React, { Suspense } from 'react';
import { Task, TeamMember, CurrentUser, TaskUpdateOptions } from '../../types';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { isTaskSoftDeleted } from '../../utils/taskUtils';
import type { ViewMode } from '../../utils/userPreferences';

// Lazy load modal components to reduce initial bundle size with retry logic
const TaskDetails = lazyWithRetry(() => import('../TaskDetails'));
const HelpModal = lazyWithRetry(() => import('../HelpModal'));
const Profile = lazyWithRetry(() => import('../Profile'));

interface ModalManagerProps {
  // Task Details Modal
  selectedTask: Task | null;
  taskDetailsOptions?: { scrollToComments?: boolean };
  members: TeamMember[];
  onTaskClose: () => void;
  onTaskUpdate: (task: Task, options?: TaskUpdateOptions) => Promise<void>;
  onRestoreTask?: () => Promise<void>;
  onPurgeTask?: () => Promise<void>;
  
  // Help Modal
  showHelpModal: boolean;
  helpExpandToken?: number;
  onHelpClose: () => void;
  onPageChange?: (page: 'kanban' | 'admin' | 'reports' | 'test', options?: { hash?: string }) => void;
  onViewModeChange?: (mode: ViewMode) => void;
  
  // Profile Modal
  showProfileModal: boolean;
  currentUser: CurrentUser | null;
  onProfileClose: () => void;
  onProfileUpdated: () => Promise<void>;
  isProfileBeingEdited: boolean;
  onProfileEditingChange: (isEditing: boolean) => void;
  onActivityFeedToggle?: (enabled: boolean) => void;
  onAccountDeleted?: () => void;
  /** Focus target when Profile opens (e.g. bio from Meet the team). */
  profileInitialFocus?: 'displayName' | 'bio' | 'activityFeed';
  onOpenProfile?: (focus?: 'displayName' | 'bio' | 'activityFeed') => void;
  siteSettings?: { [key: string]: string };
  boards?: any[];
  canMutate?: boolean;
  onJumpToTask?: (task: Task) => void | Promise<void>;
}

const ModalManager: React.FC<ModalManagerProps> = ({
  selectedTask,
  taskDetailsOptions,
  members,
  onTaskClose,
  onTaskUpdate,
  onRestoreTask,
  onPurgeTask,
  showHelpModal,
  helpExpandToken = 0,
  onHelpClose,
  onPageChange,
  onViewModeChange,
  showProfileModal,
  currentUser,
  onProfileClose,
  onProfileUpdated,
  isProfileBeingEdited,
  onProfileEditingChange,
  profileInitialFocus = 'displayName',
  onActivityFeedToggle,
  onAccountDeleted,
  onOpenProfile,
  siteSettings,
  boards,
  canMutate = true,
  onJumpToTask,
}) => {
  const isReadOnly = isTaskSoftDeleted(selectedTask);
  const isAdmin = !!currentUser?.roles?.includes('admin');

  return (
    <>
      {/* Task Details Modal */}
      {selectedTask && (
        <Suspense fallback={null}>
          <TaskDetails
            task={selectedTask}
            members={members}
            currentUser={currentUser}
            onClose={onTaskClose}
            onUpdate={onTaskUpdate}
            siteSettings={siteSettings}
            boards={boards}
            scrollToComments={taskDetailsOptions?.scrollToComments}
            readOnly={isReadOnly}
            canMutate={canMutate}
            onRestore={isReadOnly ? onRestoreTask : undefined}
            onPurge={isReadOnly && isAdmin ? onPurgeTask : undefined}
            isAdmin={isAdmin}
            onJumpToTask={onJumpToTask}
          />
        </Suspense>
      )}

      {/* Help Modal */}
      {showHelpModal && (
        <Suspense fallback={null}>
          <HelpModal
            isOpen={showHelpModal}
            expandToken={helpExpandToken}
            onClose={onHelpClose}
            currentUser={currentUser}
            onPageChange={onPageChange}
            onViewModeChange={onViewModeChange}
            onOpenProfile={onOpenProfile}
          />
        </Suspense>
      )}

      {/* Profile Modal */}
      {showProfileModal && (
        <Suspense fallback={null}>
          <Profile 
            isOpen={showProfileModal} 
            onClose={onProfileClose} 
            currentUser={currentUser ? {
              ...currentUser,
              // Only update displayName from members if not currently being edited
              displayName: isProfileBeingEdited 
                ? currentUser.displayName // Keep current displayName while editing
                : members.find(m => m.user_id === currentUser?.id)?.name || `${currentUser?.firstName} ${currentUser?.lastName}`,
              // Ensure authProvider is explicitly set
              authProvider: currentUser?.authProvider || 'local'
            } : null}
            onProfileUpdated={onProfileUpdated}
            isProfileBeingEdited={isProfileBeingEdited}
            onProfileEditingChange={onProfileEditingChange}
            onActivityFeedToggle={onActivityFeedToggle}
            onAccountDeleted={onAccountDeleted}
            initialFocus={profileInitialFocus}
          />
        </Suspense>
      )}
    </>
  );
};

export default ModalManager;
