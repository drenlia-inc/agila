import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTaskDetails } from '../hooks/useTaskDetails';
import { Task, TeamMember, CurrentUser, Attachment } from '../types';
import { ArrowLeft, Save, Clock, User, Calendar, AlertCircle, Tag, Users, Paperclip, Edit2, X, ChevronDown, ChevronUp, GitBranch, Trash2 } from 'lucide-react';
import { parseTaskRoute } from '../utils/routingUtils';
import { getTaskById, getMembers, getBoards, addWatcherToTask, removeWatcherFromTask, addCollaboratorToTask, removeCollaboratorFromTask, addTagToTask, removeTagFromTask, deleteComment, updateComment, fetchTaskAttachments, deleteAttachment, fetchCommentAttachments, getTaskRelationships, getAvailableTasksForRelationship, addTaskRelationship, removeTaskRelationship, getAllSprints } from '../api';
import { useFileUpload } from '../hooks/useFileUpload';
import { generateTaskUrl } from '../utils/routingUtils';
import { loadUserPreferences, updateUserPreference } from '../utils/userPreferences';
import { truncateMemberName } from '../utils/memberUtils';
import { formatToYYYYMMDD } from '../utils/dateUtils';
import TextEditor from './TextEditor';
import ModalManager from './layout/ModalManager';
import Header from './layout/Header';
import TaskFlowChart from './TaskFlowChart';
import DOMPurify from 'dompurify';
import { getAuthenticatedAttachmentUrl } from '../utils/authImageUrl';
import { commentTextToHtml } from '../utils/commentContent';
import { feDebug } from '../utils/clientDebug';
import { parseEffortUnit, isTaskSoftDeleted } from '../utils/taskUtils';
import { TASK_TITLE_MAX_LENGTH, TASK_DESCRIPTION_MAX_LENGTH, COMMENT_MAX_LENGTH, BLOCKED_REASON_MAX_LENGTH } from '../constants/appConstants';
import { mergeTaskTagsWithLiveData } from '../utils/tagUtils';
import { userCanMutate, userIsViewer } from '../utils/permissions';
import MemberAvatar, { getPriorityPillStyle } from './ui/MemberAvatar';
import MemberPicker from './ui/MemberPicker';
import WatchThisTaskButton from './ui/WatchThisTaskButton';
import TagPicker from './ui/TagPicker';
import PriorityPicker from './ui/PriorityPicker';
import SprintSelector from './SprintSelector';
import type { Tag } from '../types';

function pageLog(...args: unknown[]) {
  if (feDebug('FE_DEBUG_TASK_PAGE')) console.log(...args);
}

/** Normalize API date values for <input type="date"> (YYYY-MM-DD). */
function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/** Normalize task payload from GET /tasks/:ticket (may include snake_case DB columns). */
function normalizeTaskFromApi(taskData: any): Task {
  const start = taskData.startDate || taskData.startdate || null;
  const due = taskData.dueDate || taskData.duedate || null;
  return {
    ...taskData,
    memberId: taskData.memberId || taskData.memberid || '',
    requesterId: taskData.requesterId || taskData.requesterid || '',
    columnId: taskData.columnId || taskData.columnid || '',
    boardId: taskData.boardId || taskData.boardid || '',
    startDate: toDateInputValue(start) || null,
    dueDate: toDateInputValue(due) || null,
    sprintId: taskData.sprintId || taskData.sprint_id || null,
    isBlocked: Boolean(taskData.isBlocked ?? taskData.is_blocked),
    blockedReason: taskData.blockedReason || taskData.blocked_reason || null,
    priorityId: taskData.priorityId ?? taskData.priority_id ?? null,
    deletedAt: taskData.deletedAt ?? taskData.deleted_at ?? null,
  };
}

interface TaskPageProps {
  currentUser: CurrentUser | null;
  siteSettings?: { [key: string]: string };
  members: TeamMember[];
  isPolling: boolean;
  lastPollTime: Date | null;
  onLogout: () => void;
  onPageChange: (page: 'kanban' | 'admin' | 'reports' | 'test', options?: { hash?: string }) => void;
  onRefresh: () => Promise<void>;
  onInviteUser?: (email: string) => Promise<void>;
  // Auto-refresh toggle
  // isAutoRefreshEnabled: boolean; // Disabled - using real-time updates
  // onToggleAutoRefresh: () => void; // Disabled - using real-time updates
}

export default function TaskPage({ 
  currentUser, 
  siteSettings, 
  members: propMembers, 
  isPolling, 
  lastPollTime, 
  onLogout, 
  onPageChange, 
  onRefresh, 
  onInviteUser,
  // isAutoRefreshEnabled, // Disabled - using real-time updates
  // onToggleAutoRefresh // Disabled - using real-time updates
}: TaskPageProps) {
  const { t } = useTranslation('tasks');
  const [task, setTask] = useState<Task | null>(null);
  const [boards, setBoards] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sprints, setSprints] = useState<Array<{
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    is_active?: boolean;
  }>>([]);
  const [blockedReasonDraft, setBlockedReasonDraft] = useState('');
  
  // Use members from props
  const members = propMembers;
  
  // Modal states
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpExpandToken, setHelpExpandToken] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isProfileBeingEdited, setIsProfileBeingEdited] = useState(false);

  // Task relationships state
  const [relationships, setRelationships] = useState<any[]>([]);
  const [parentTask, setParentTask] = useState<{id: string, ticket: string, title: string, projectId?: string} | null>(null);
  const [childTasks, setChildTasks] = useState<{id: string, ticket: string, title: string, projectId?: string}[]>([]);
  /** Bumps TaskFlowChart to refetch after local relationship mutations. */
  const [flowChartRevision, setFlowChartRevision] = useState(0);
  const [availableTasksForChildren, setAvailableTasksForChildren] = useState<{id: string, ticket: string, title: string, status: string, projectId?: string}[]>([]);
  const [showChildrenDropdown, setShowChildrenDropdown] = useState(false);
  const [childrenSearchTerm, setChildrenSearchTerm] = useState('');
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false);
  const childrenDropdownRef = useRef<HTMLDivElement>(null);

  // Collapsible sections state - always load from preferences if available
  const [collapsedSections, setCollapsedSections] = useState<{
    assignment: boolean;
    schedule: boolean;
    tags: boolean;
    associations: boolean;
    taskFlow: boolean;
    taskInfo: boolean;
  }>(() => {
    if (currentUser?.id) {
      const prefs = loadUserPreferences(currentUser.id);
      pageLog('📁 TaskPage: Initial preferences loaded:', prefs.taskPageCollapsed);
      if (prefs.taskPageCollapsed) {
        pageLog('📁 TaskPage: Using saved preferences for initial state');
        return {
          ...prefs.taskPageCollapsed,
          taskFlow: prefs.taskPageCollapsed.taskFlow ?? false, // Default to expanded for new section
        };
      }
    }
    pageLog('📁 TaskPage: Using default state (all expanded)');
    return {
      assignment: false,
      schedule: false,
      tags: false,
      associations: false,
      taskFlow: false,
      taskInfo: false,
    };
  });

  // Track current hash to detect changes and re-parse task route
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  
  // Parse the task route to get task ID (will re-calculate when currentHash changes)
  const taskRoute = useMemo(() => {
    return parseTaskRoute(window.location.href);
  }, [currentHash]);
  const taskId = taskRoute.taskId;
  
  // Listen for hash changes and update current hash state
  useEffect(() => {
    const handleHashChange = () => {
      pageLog('🔄 [TaskPage] Hash changed:', window.location.hash);
      setCurrentHash(window.location.hash);
    };
    
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  
  // Reset all state when task ID changes
  useEffect(() => {
    pageLog('🔄 [TaskPage] Task ID changed to:', taskId);
    setTask(null);
    setError(null);
    setIsLoading(true);
    setRelationships([]);
    setParentTask(null);
    setChildTasks([]);
    setAvailableTasksForChildren([]);
    setShowChildrenDropdown(false);
    setChildrenSearchTerm('');
    setFlowChartRevision(0);
  }, [taskId]);
  

  // Load task data
  useEffect(() => {
    const loadPageData = async () => {
      if (!taskId) {
        setError(t('taskPage.invalidTaskId'));
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        
        pageLog('🚀 [TaskPage] Starting data load for taskId:', taskId);
        
        // Load task and boards in parallel (members come from props)
        pageLog('📡 [TaskPage] Making API calls...');
        const [taskData, boardsData] = await Promise.all([
          getTaskById(taskId),
          getBoards()
        ]);

        pageLog('📥 [TaskPage] API responses received:');
        pageLog('  📄 Task data:', {
          id: taskData?.id,
          title: taskData?.title,
          priority: taskData?.priority,
          priorityId: taskData?.priorityId,
          status: taskData?.status,
          watchers: taskData?.watchers?.length || 0,
          collaborators: taskData?.collaborators?.length || 0,
          tags: taskData?.tags?.length || 0,
          comments: taskData?.comments?.length || 0
        });
        pageLog('  👥 Members data:', { count: members?.length, first: members?.[0] });
        pageLog('  📋 Boards data:', { count: boardsData?.length });

        if (!taskData) {
          pageLog('❌ [TaskPage] No task data received');
          setError(t('taskPage.taskNotFound'));
          return;
        }

        pageLog('✅ [TaskPage] Setting state with loaded data');
        setTask(normalizeTaskFromApi(taskData));
        setBoards(boardsData);
        setBlockedReasonDraft(taskData.blockedReason || taskData.blocked_reason || '');
      } catch (error) {
        console.error('❌ [TaskPage] Error loading task page data:', error);
        console.error('❌ [TaskPage] Error details:', {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          data: error.response?.data
        });
        setError(t('taskPage.failedToLoad', { status: error.response?.status || error.message }));
      } finally {
        setIsLoading(false);
      }
    };

    loadPageData();
  }, [taskId]);

  // Load sprints for Schedule & Priority section
  useEffect(() => {
    let cancelled = false;
    const loadSprints = async () => {
      try {
        const data = await getAllSprints();
        if (!cancelled) {
          setSprints(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to load sprints for TaskPage:', err);
        if (!cancelled) setSprints([]);
      }
    };
    loadSprints();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load task relationships
  useEffect(() => {
    const loadRelationships = async () => {
      if (!task?.id) return;
      
      setIsLoadingRelationships(true);
      try {
        // Load task relationships
        const relationshipsData = await getTaskRelationships(task.id);
        setRelationships(relationshipsData);
        
        // Parse parent and children from relationships
        const parent = relationshipsData.find((rel: any) => rel.relationship === 'child' && rel.task_id === task.id);
        if (parent) {
          setParentTask({
            id: parent.to_task_id,
            ticket: parent.related_task_ticket,
            title: parent.related_task_title,
            projectId: parent.related_task_project_id
          });
        } else {
          setParentTask(null);
        }
        
        const children = relationshipsData
          .filter((rel: any) => rel.relationship === 'parent' && rel.task_id === task.id)
          .map((rel: any) => ({
            id: rel.to_task_id,
            ticket: rel.related_task_ticket,
            title: rel.related_task_title,
            projectId: rel.related_task_project_id
          }));
        setChildTasks(children);
        
        // Load available tasks for adding as children
        const availableTasksData = await getAvailableTasksForRelationship(task.id);
        setAvailableTasksForChildren(availableTasksData);
        
      } catch (error) {
        console.error('Error loading task relationships:', error);
      } finally {
        setIsLoadingRelationships(false);
      }
    };
    
    loadRelationships();
  }, [task?.id]);

  // Handle clicking outside children dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (childrenDropdownRef.current && !childrenDropdownRef.current.contains(event.target as Node)) {
        setShowChildrenDropdown(false);
        setChildrenSearchTerm('');
      }
    };

    if (showChildrenDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showChildrenDropdown]);

  // Create a default task to avoid hook issues during loading
  const defaultTask = {
    id: '',
    title: '',
    description: '',
    memberId: '',
    requesterId: '',
    startDate: null,
    dueDate: null,
    effort: null,
    priority: null,
    priorityId: null,
    columnId: '',
    boardId: '',
    position: 0,
    sprintId: null,
    isBlocked: false,
    blockedReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: []
  };

  // Task relationship handlers
  const handleAddChildTask = async (childTaskId: string) => {
    try {
      if (!task?.id) return;
      
      await addTaskRelationship(task.id, 'parent', childTaskId);
      
      // Reload relationships data from server to get accurate IDs
      const relationshipsData = await getTaskRelationships(task.id);
      setRelationships(relationshipsData);
      
      // Parse children from fresh relationships data
      const children = relationshipsData
        .filter((rel: any) => rel.relationship === 'parent' && rel.task_id === task.id)
        .map((rel: any) => ({
          id: rel.to_task_id,
          ticket: rel.related_task_ticket,
          title: rel.related_task_title,
          projectId: rel.related_task_project_id
        }));
      setChildTasks(children);
      
      // Reload available tasks
      const availableTasksData = await getAvailableTasksForRelationship(task.id);
      setAvailableTasksForChildren(availableTasksData);
      
      setFlowChartRevision((n) => n + 1);
      setShowChildrenDropdown(false);
      setChildrenSearchTerm('');
    } catch (error) {
      console.error('Failed to add child task:', error);
    }
  };

  const handleRemoveChildTask = async (childTaskId: string) => {
    try {
      if (!task?.id) return;
      
      // Find the relationship to delete
      const relationship = relationships.find(rel => 
        rel.relationship === 'parent' && 
        rel.task_id === task.id && 
        rel.to_task_id === childTaskId
      );
      
      if (relationship) {
        await removeTaskRelationship(task.id, relationship.id);
        
        // Reload all relationship data from server after successful deletion
        const relationshipsData = await getTaskRelationships(task.id);
        setRelationships(relationshipsData);
        
        // Parse parent and children from fresh data
        const parent = relationshipsData.find((rel: any) => rel.relationship === 'child' && rel.task_id === task.id);
        if (parent) {
          setParentTask({
            id: parent.to_task_id,
            ticket: parent.related_task_ticket,
            title: parent.related_task_title,
            projectId: parent.related_task_project_id
          });
        } else {
          setParentTask(null);
        }
        
        const children = relationshipsData
          .filter((rel: any) => rel.relationship === 'parent' && rel.task_id === task.id)
          .map((rel: any) => ({
            id: rel.to_task_id,
            ticket: rel.related_task_ticket,
            title: rel.related_task_title,
            projectId: rel.related_task_project_id
          }));
        setChildTasks(children);
        
        // Reload available tasks
        const availableTasksData = await getAvailableTasksForRelationship(task.id);
        setAvailableTasksForChildren(availableTasksData);

        setFlowChartRevision((n) => n + 1);
      }
    } catch (error) {
      console.error('Failed to remove child task:', error);
    }
  };

  // Handler for opening children dropdown
  const handleChildrenDropdownToggle = () => {
    if (!userCanMutate(currentUser)) return;
    const softDeleted =
      isTaskSoftDeleted(editedTask) || (task ? isTaskSoftDeleted(task) : false);
    if (softDeleted) return;
    setShowChildrenDropdown(!showChildrenDropdown);
    if (!showChildrenDropdown) {
      setChildrenSearchTerm('');
    }
  };

  // Filter available tasks based on search term
  const filteredAvailableChildren = availableTasksForChildren.filter(task => 
    task.ticket.toLowerCase().includes(childrenSearchTerm.toLowerCase()) ||
    task.title.toLowerCase().includes(childrenSearchTerm.toLowerCase())
  );

  const taskDetailsHook = useTaskDetails({
    task: task || defaultTask,
    members,
    currentUser,
    onUpdate: setTask,
    siteSettings,
    boards,
    canMutate: userCanMutate(currentUser),
  });

  const {
    editedTask,
    hasChanges,
    isSaving,
    lastSaved,
    availableTags,
    taskTags,
    taskWatchers,
    taskCollaborators,
    availablePriorities,
    getProjectIdentifier,
    handleTaskUpdate,
    handleAddWatcher,
    handleRemoveWatcher,
    handleAddCollaborator,
    handleRemoveCollaborator,
    handleAddTag,
    handleRemoveTag,
    handleAddComment,
    handleDeleteComment,
    handleUpdateComment,
    saveImmediately
  } = taskDetailsHook;

  // Keep blocked reason draft aligned when switching tasks
  useEffect(() => {
    setBlockedReasonDraft(editedTask.blockedReason || '');
  }, [editedTask.id]);

  // Direct attachment management (matching TaskDetails exactly)
  const [taskAttachments, setTaskAttachments] = useState<Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }>>([]);
  
  // Use the new file upload hook
  const {
    pendingFiles: pendingAttachments,
    isUploading: isUploadingAttachments,
    uploadError: uploadError,
    uploadTaskFiles,
    clearFiles,
    addFiles
  } = useFileUpload([], siteSettings);
  
  const [isDeletingAttachment, setIsDeletingAttachment] = useState(false);
  const recentlyDeletedAttachmentsRef = useRef<Set<string>>(new Set());
  const [commentAttachments, setCommentAttachments] = useState<Record<string, Attachment[]>>({});

  // Comment editing state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState<string>('');

  // Helper function to check if user can edit/delete a comment
  const canModifyComment = (comment: any): boolean => {
    if (!currentUser) return false;
    
    // Admin can modify any comment
    if (currentUser.roles?.includes('admin')) return true;
    
    // User can modify their own comments
    const currentMember = members.find(m => m.user_id === currentUser.id);
    return currentMember?.id === comment.authorId;
  };

  const handleEditComment = (comment: any) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.text);
  };

  const handleSaveEditComment = async (content: string, attachments: File[] = []) => {
    if (!editingCommentId || !content.trim()) return;
    
    try {
      // If there are attachments, handle them like adding a comment
      if (attachments.length > 0) {
        // Upload attachments first
        const uploadedAttachments = await Promise.all(
          attachments.map(async (file) => {
            const fileData = await uploadFile(file);
            return {
              id: fileData.id,
              name: fileData.name,
              url: fileData.url,
              type: fileData.type,
              size: fileData.size
            };
          })
        );

        // Replace blob URLs with server URLs in comment content
        let finalContent = content;
        uploadedAttachments.forEach(attachment => {
          if (attachment.name.startsWith('img-')) {
            // Replace blob URLs with authenticated server URLs
            const blobPattern = new RegExp(`blob:[^"]*#${attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
            const authenticatedUrl = getAuthenticatedAttachmentUrl(attachment.url);
            finalContent = finalContent.replace(blobPattern, authenticatedUrl || attachment.url);
          }
        });

        await handleUpdateComment(editingCommentId, finalContent.trim());
      } else {
        await handleUpdateComment(editingCommentId, content.trim());
      }
      
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (error) {
      console.error('Error saving comment edit:', error);
    }
  };

  const handleCancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentText('');
  };

  // Toggle section collapse state
  const toggleSection = useCallback((section: keyof typeof collapsedSections) => {
    setCollapsedSections(prev => {
      const newState = {
        ...prev,
        [section]: !prev[section]
      };
      
      // Save to user preferences
      if (currentUser?.id) {
        pageLog(`📁 TaskPage: Toggling section ${section} to ${newState[section] ? 'collapsed' : 'expanded'}`);
        updateUserPreference(currentUser.id, 'taskPageCollapsed', newState);
      }
      
      return newState;
    });
  }, [currentUser?.id]);

  const handleDeleteCommentClick = async (commentId: string) => {
    if (!currentUser) return;
    
    try {
      // Use hook's delete function which handles both server and state
      await handleDeleteComment(commentId);
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  // Direct attachment management functions (matching TaskDetails exactly)
  const handleAttachmentsChange = useCallback((attachments: File[]) => {
    // Use the hook's addFiles function instead of direct state management
    addFiles(attachments);
  }, [addFiles]);

  const handleAttachmentDelete = useCallback(async (attachmentId: string) => {
    try {
      await deleteAttachment(attachmentId);
      
      // Find the attachment to get its filename
      const attachmentToDelete = taskAttachments.find(att => att.id === attachmentId) || 
                                 displayAttachments.find(att => att.id === attachmentId);
      
      if (attachmentToDelete) {
        // Remove from ALL local state (just like image X button does)
        setTaskAttachments(prev => {
          const updated = prev.filter(att => att.id !== attachmentId && att.name !== attachmentToDelete.name);
          // Update the task with the new attachment count
          handleTaskUpdate({ attachmentCount: updated.length });
          return updated;
        });
        setPendingAttachments(prev => prev.filter(att => att.name !== attachmentToDelete.name));
      } else {
        // Fallback: just remove by ID
        setTaskAttachments(prev => {
          const updated = prev.filter(att => att.id !== attachmentId);
          // Update the task with the new attachment count
          handleTaskUpdate({ attachmentCount: updated.length });
          return updated;
        });
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
      throw error; // Re-throw to let TextEditor handle the error
    }
  }, [taskAttachments, handleTaskUpdate]);

  const handleImageRemoval = useCallback(async (filename: string) => {
    // Track this attachment as recently deleted
    recentlyDeletedAttachmentsRef.current.add(filename);
    
    // Check if this file exists in server-saved attachments
    const serverAttachment = taskAttachments.find(att => att.name === filename);
    
    if (serverAttachment) {
      try {
        await deleteAttachment(serverAttachment.id);
      } catch (error) {
        console.error('Failed to delete server attachment:', error);
        // Continue with local cleanup even if server deletion fails
      }
    } else {
      // Also try to delete from server by making a request to get fresh attachments and delete
      try {
        const freshAttachments = await fetchTaskAttachments(task?.id || '');
        const freshServerAttachment = freshAttachments.find(att => att.name === filename);
        
        if (freshServerAttachment) {
          await deleteAttachment(freshServerAttachment.id);
        }
      } catch (error) {
        console.error('Failed to fetch/delete fresh attachment:', error);
      }
    }
    
    // Remove from ALL local state immediately
    setPendingAttachments(prev => prev.filter(att => att.name !== filename));
    setTaskAttachments(prev => {
      const updated = prev.filter(att => att.name !== filename);
      // Update the task with the new attachment count
      handleTaskUpdate({ attachmentCount: updated.length });
      return updated;
    });
    
    // Clear the recently deleted flag after a longer delay
    setTimeout(() => {
      recentlyDeletedAttachmentsRef.current.delete(filename);
    }, 5000); // 5 seconds should be enough for any polling cycles
  }, [taskAttachments, task?.id, handleTaskUpdate]);

  const savePendingAttachments = useCallback(async () => {
    if (pendingAttachments.length === 0 || isUploadingRef.current) return;
    
    isUploadingRef.current = true;
    try {
      pageLog('📎 Uploading', pendingAttachments.length, 'task attachments...');
      
      // Use the new upload utility
      const uploadedAttachments = await uploadTaskFiles(task?.id || '', {
        currentTaskAttachments: taskAttachments,
        currentDescription: editedTask.description,
        onTaskAttachmentsUpdate: (updatedAttachments) => {
          pageLog('🔄 Updating taskAttachments with:', updatedAttachments.length, 'attachments');
          setTaskAttachments(updatedAttachments);
          // Update the task with the new attachment count
          handleTaskUpdate({ attachmentCount: updatedAttachments.length });
        },
        onDescriptionUpdate: (updatedDescription) => {
          pageLog('🔄 Updating task description with server URLs');
          handleTaskUpdate({ description: updatedDescription });
        },
        onSuccess: (attachments) => {
          pageLog('✅ Task attachments saved successfully:', attachments.length, 'files');
          // Clear pending attachments on success
          clearFiles();
        },
        onError: (error) => {
          console.error('❌ Failed to upload task attachments:', error);
          // Clear pending attachments on error to prevent retry loop
          const errorMessage = error.response?.status === 413 
            ? 'File(s) too large. Please reduce file size or upload fewer files at once.'
            : error.message || 'Failed to upload files. Please try again.';
          console.error('Upload error details:', errorMessage);
          clearFiles(); // Clear to prevent infinite retry loop
        }
      });
      
      pageLog('📎 Task attachment upload completed, got:', uploadedAttachments.length, 'attachments');
    } catch (error: any) {
      console.error('❌ Failed to save task attachments:', error);
      // Clear pending attachments on error to prevent retry loop
      clearFiles();
      
      // Show user-friendly error message
      const errorMessage = error.response?.status === 413 
        ? 'File(s) too large. Please reduce file size or upload fewer files at once.'
        : error.message || 'Failed to upload files. Please try again.';
      console.error('Upload error details:', errorMessage);
    } finally {
      isUploadingRef.current = false;
    }
  }, [pendingAttachments.length, task?.id, uploadTaskFiles, handleTaskUpdate, clearFiles]);

  // Only show saved attachments - no pending ones to avoid state sync issues
  const displayAttachments = React.useMemo(() => taskAttachments, [taskAttachments]);

  // Text save timeout ref for debouncing
  const textSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Separate function for text field updates with immediate save (matching TaskDetails)
  const handleTextUpdate = useCallback((field: 'title' | 'description', value: string) => {
    // Update hook state immediately
    handleTaskUpdate({ [field]: value });
    
    // Debounce text saves to prevent spam (but keep attachments immediate)
    if (textSaveTimeoutRef.current) {
      clearTimeout(textSaveTimeoutRef.current);
    }
    
    textSaveTimeoutRef.current = setTimeout(() => {
      // The hook's debounced save will handle this
      pageLog(`💾 Debounced save triggered for ${field}:`, value.substring(0, 50) + '...');
    }, 1000);
  }, [handleTaskUpdate]);

  // Auto-upload pending attachments (matching TaskDetails)
  // Use a ref to track if we're currently uploading to prevent retry loops
  const isUploadingRef = React.useRef(false);
  useEffect(() => {
    if (pendingAttachments.length > 0) {
      savePendingAttachments();
    }
  }, [pendingAttachments.length, savePendingAttachments]); // Only depend on length, not the array itself

  // Load task attachments when task changes
  useEffect(() => {
    const loadAttachments = async () => {
      if (task?.id) {
        try {
          const attachments = await fetchTaskAttachments(task.id);
          // Filter out recently deleted attachments and only update if not uploading
          if (!isUploadingAttachments) {
            const filteredAttachments = (attachments || []).filter((att: any) => 
              !recentlyDeletedAttachmentsRef.current.has(att.name)
            );
            setTaskAttachments(filteredAttachments);
          }
        } catch (error) {
          console.error('Error loading task attachments:', error);
        }
      }
    };

    loadAttachments();
  }, [task?.id, isUploadingAttachments]);

  // Load comment attachments (matching TaskDetails)
  useEffect(() => {
    const fetchAttachments = async () => {
      if (!editedTask?.comments) return;
      
      const attachmentsMap: Record<string, Attachment[]> = {};
      
      // Only fetch for valid comments
      const validComments = editedTask.comments.filter(
        comment => comment && comment.id && comment.text
      );

      // Fetch attachments for each comment
      await Promise.all(
        validComments.map(async (comment) => {
          try {
            const attachments = await fetchCommentAttachments(comment.id);
            attachmentsMap[comment.id] = attachments;
          } catch (error) {
            console.error(`Failed to fetch attachments for comment ${comment.id}:`, error);
            attachmentsMap[comment.id] = [];
          }
        })
      );

      setCommentAttachments(attachmentsMap);
    };

    fetchAttachments();
  }, [editedTask?.comments]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (textSaveTimeoutRef.current) {
        clearTimeout(textSaveTimeoutRef.current);
      }
    };
  }, []);

  const handleBack = async () => {
    // Flush any pending debounced edits (e.g. blocked reason still being typed)
    // so board cards / peers receive the latest task-updated payload.
    try {
      await saveImmediately();
    } catch (err) {
      console.error('Failed to flush task before leaving Task Page:', err);
    }

    // Navigate back to the kanban board
    if (task?.boardId) {
      // Try to get project identifier if available
      const projectId = getProjectIdentifier ? getProjectIdentifier() : null;
      if (projectId) {
        window.location.hash = `#kanban#${task.boardId}`;
      } else {
        window.location.hash = `#kanban#${task.boardId}`;
      }
    } else {
      // Fallback to just kanban if no board info
      window.location.hash = '#kanban';
    }
  };


  // Sync with preferences when user changes (backup for edge cases)
  useEffect(() => {
    pageLog('📁 TaskPage: useEffect triggered - syncing preferences');
    if (currentUser?.id) {
      const prefs = loadUserPreferences(currentUser.id);
      pageLog('📁 TaskPage: Syncing preferences for user', currentUser.id);
      pageLog('📁 TaskPage: Current prefs:', prefs.taskPageCollapsed);
      if (prefs.taskPageCollapsed) {
        pageLog('📁 TaskPage: Syncing to saved preferences');
        setCollapsedSections(prefs.taskPageCollapsed);
      }
    }
  }, [currentUser?.id]);

  // Modal handlers
  const handleProfileUpdated = async () => {
    // Profile updates are handled by the main app, so we don't need to do anything special here
    // The currentUser prop will be updated by the parent
  };

  const handleActivityFeedToggle = (enabled: boolean) => {
    // Activity feed is not used on TaskPage, but we need the handler for ModalManager
    pageLog('Activity feed toggle not applicable on TaskPage:', enabled);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('taskPage.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || (!task && !isLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('taskPage.taskNotFoundTitle')}</h1>
          <p className="text-gray-600 mb-4">{error || t('taskPage.taskNotFoundMessage')}</p>
          <button
            onClick={handleBack}
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
          >
            {t('taskPage.backToBoard')}
          </button>
        </div>
      </div>
    );
  }

  // Don't render the full page until we have actual task data
  if (!task) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('taskPage.loading')}</p>
        </div>
      </div>
    );
  }

  const assignedMember = members.find(m => m.id === editedTask.memberId);
  const requesterMember = members.find(m => m.id === editedTask.requesterId);
  const priority = availablePriorities.find(p => p.id === editedTask.priorityId);
  const liveTaskTags = mergeTaskTagsWithLiveData(taskTags, availableTags);
  const isInTrash = isTaskSoftDeleted(editedTask) || isTaskSoftDeleted(task);
  const canMutate = userCanMutate(currentUser);
  const fieldsLocked = isInTrash || !canMutate;
  const commentsLocked = isInTrash;
  const ownMember = members.find((m) => m.user_id === currentUser?.id);
  const viewerWatchOk = userIsViewer(currentUser) && !isInTrash && Boolean(ownMember);

  const toggleTaskTag = async (tag: Tag) => {
    if (fieldsLocked) return;
    try {
      if (taskTags.some((t) => t.id === tag.id)) {
        await handleRemoveTag(tag.id);
      } else {
        await handleAddTag(tag.id);
      }
    } catch (error) {
      console.error('Error toggling tag:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      {/* App Header */}
      <Header
        currentUser={currentUser}
        siteSettings={siteSettings || {}}
        currentPage={'kanban'} // Task page is part of kanban flow
        // isPolling={isPolling} // Removed - using real-time WebSocket updates
        // lastPollTime={lastPollTime} // Removed - using real-time WebSocket updates
        members={members}
        onProfileClick={() => setShowProfileModal(true)}
        onLogout={onLogout}
        onPageChange={onPageChange}
        onRefresh={onRefresh}
        onHelpClick={() => {
          setShowHelpModal(true);
          setHelpExpandToken((n) => n + 1);
        }}
        onInviteUser={onInviteUser}
        hideSprintSelector={true} // Hide sprint selector on TaskPage
        // isAutoRefreshEnabled={isAutoRefreshEnabled} // Disabled - using real-time updates
        // onToggleAutoRefresh={onToggleAutoRefresh} // Disabled - using real-time updates
      />
      
      {/* Task Navigation Bar - Sticky */}
      <div className="sticky top-16 z-40 bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="app-page-shell app-page-inline-gutter max-w-full">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 sm:py-4">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
              <button
                onClick={handleBack}
                className="flex items-center shrink-0 text-gray-600 dark:text-white hover:text-gray-900 dark:hover:text-blue-400 font-medium transition-colors text-sm sm:text-base"
              >
                <ArrowLeft className="h-5 w-5 mr-1" />
                <span className="truncate max-w-[9rem] sm:max-w-none">{t('taskPage.backToBoard')}</span>
              </button>
              <div className="h-6 border-l border-gray-300 shrink-0"></div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h1 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {editedTask.title}
                  </h1>
                  {(editedTask.status || '').trim() && (
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200 max-w-[10rem] sm:max-w-[14rem] truncate"
                      title={editedTask.status}
                    >
                      {editedTask.status}
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  <span className="truncate">
                    {getProjectIdentifier() && `${getProjectIdentifier()} / `}
                    {taskId}
                  </span>
                  {isInTrash && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                      <Trash2 size={11} aria-hidden />
                      {t('trash.readOnlyBadge')}
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {hasChanges && (
                <span className="text-xs sm:text-sm text-amber-600 flex items-center">
                  <Clock className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">{t('taskPage.unsavedChanges')}</span>
                </span>
              )}
              {hasChanges && !isSaving && (
                <button
                  type="button"
                  onClick={() => {
                    // Flush any in-flight editor HTML into state, then save from the ref
                    window.setTimeout(() => saveImmediately(), 0);
                  }}
                  className="inline-flex items-center px-2.5 sm:px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <Save className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">{t('taskPage.save')}</span>
                </button>
              )}
              {isSaving && (
                <span className="text-xs sm:text-sm text-blue-600 flex items-center">
                  <Save className="h-4 w-4 mr-1 animate-spin" />
                  <span className="hidden sm:inline">{t('taskPage.saving')}</span>
                </span>
              )}
              {lastSaved && !hasChanges && !isSaving && (
                <span className="text-xs sm:text-sm text-green-600 hidden sm:inline">
                  {t('taskPage.saved', { time: lastSaved.toLocaleTimeString() })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="app-page-shell app-page-inline-gutter max-w-full py-4 sm:py-6 lg:py-8">
        {/* Two columns from md (768px) so ~865px half-screens keep title + sidebar side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 min-w-0">
          
          {/* Left Column - Main Content */}
          <div className="md:col-span-2 space-y-4 sm:space-y-6 min-w-0">
            
            {/* Title */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 sm:p-4 lg:p-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{t('taskPage.taskTitle')}</label>
              <input
                type="text"
                value={editedTask.title}
                onChange={(e) => handleTaskUpdate({ title: e.target.value })}
                readOnly={fieldsLocked}
                disabled={fieldsLocked}
                title={isInTrash ? t('trash.readOnlyHint') : undefined}
                className={`w-full min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100 disabled:opacity-70 disabled:cursor-not-allowed ${
                  isInTrash
                    ? 'bg-amber-50/80 dark:bg-amber-950/30'
                    : 'bg-white dark:bg-gray-700'
                }`}
                placeholder={t('placeholders.enterTitle')}
                maxLength={TASK_TITLE_MAX_LENGTH}
              />
            </div>

            {/* Description */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 sm:p-4 lg:p-6 min-w-0 overflow-hidden">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-3 sm:mb-4">{t('labels.description')}</label>
              <TextEditor
                onSubmit={async () => {
                  // Save pending attachments when submit is triggered
                  await savePendingAttachments();
                }}
                onChange={(content) => handleTextUpdate('description', content)}
                onAttachmentsChange={fieldsLocked ? undefined : handleAttachmentsChange}
                onAttachmentDelete={fieldsLocked ? undefined : handleAttachmentDelete}
                onImageRemovalNeeded={fieldsLocked ? undefined : handleImageRemoval}
                initialContent={editedTask.description || ''}
                placeholder={t('placeholders.enterDescription')}
                maxLength={TASK_DESCRIPTION_MAX_LENGTH}
                minHeight="120px"
                showSubmitButtons={false}
                showAttachments={!fieldsLocked}
                attachmentContext="task"
                attachmentParentId={task?.id}
                existingAttachments={displayAttachments}
                compact={false}
                resizable={true}
                className="min-h-[200px] sm:min-h-[300px] max-w-full"
                editable={!fieldsLocked}
                showToolbar={!fieldsLocked}
                allowImagePaste={!fieldsLocked}
                allowImageDelete={!fieldsLocked}
                allowImageResize={!fieldsLocked}
                toolbarOptions={{
                  bold: true,
                  italic: true,
                  underline: true,
                  link: true,
                  lists: true,
                  alignment: false,
                  attachments: !fieldsLocked
                }}
              />
              
              {/* Upload error display */}
              {uploadError && (
                <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {t('taskPage.uploadError', { error: uploadError })}
                  </div>
                </div>
              )}
            </div>

            {/* Attachments */}
            {displayAttachments.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 sm:p-4 lg:p-6">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-4 flex items-center">
                  <Paperclip className="h-4 w-4 mr-2" />
                  {t('taskPage.attachments', { count: displayAttachments.length })}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {displayAttachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center p-3 border border-gray-200 rounded-md">
                      <Paperclip className="h-4 w-4 text-gray-400 mr-3 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{attachment.name}</p>
                        <p className="text-xs text-gray-500">
                          {attachment.size ? `${Math.round(attachment.size / 1024)} KB` : t('taskPage.unknownSize')}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <a
                          href={getAuthenticatedAttachmentUrl(attachment.url) || attachment.url}
                          {...(siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true' 
                            ? { target: '_blank', rel: 'noopener noreferrer' } 
                            : {})}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          {t('taskPage.view')}
                        </a>
                        {!fieldsLocked && (
                        <button
                          onClick={() => handleAttachmentDelete(attachment.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          {t('taskPage.delete')}
                        </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 sm:p-4 lg:p-6 border border-transparent dark:border-gray-700 min-w-0 overflow-hidden">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-4 flex items-center">
                <Users className="h-4 w-4 mr-2" />
                {t('taskPage.comments', { count: (editedTask.comments || []).filter(comment => 
                  comment && 
                  comment.id && 
                  comment.text && 
                  comment.text.trim() !== '' && 
                  comment.authorId && 
                  comment.createdAt
                ).length })}
              </h3>
              {/* Add Comment Section */}
              {!commentsLocked && (
              <div className="mb-6">
                <TextEditor 
                  onSubmit={async (content: string, attachments: File[] = []) => {
                    try {
                      await handleAddComment(content, attachments);
                    } catch (error) {
                      console.error('Error adding comment:', error);
                    }
                  }}
                  onCancel={() => {
                    // The TextEditor handles clearing its own content and attachments
                    // No additional action needed here
                  }}
                  placeholder={t('taskPage.addCommentPlaceholder')}
                  maxLength={COMMENT_MAX_LENGTH}
                  showAttachments={true}
                  submitButtonText={t('taskPage.addComment')}
                  cancelButtonText={t('buttons.cancel', { ns: 'common' })}
                  attachmentContext="comment"
                  allowImagePaste={true}
                  allowImageDelete={true}
                  allowImageResize={true}
                  toolbarOptions={{
                    bold: true,
                    italic: true,
                    underline: true,
                    link: true,
                    lists: true,
                    alignment: false,
                    attachments: true
                  }}
                />
              </div>
              )}
              {commentsLocked && (
                <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{t('trash.readOnlyHint')}</p>
              )}

              <div className="space-y-4">
                {(() => {
                  // Sort comments newest first (matching TaskDetails)
                  const sortedComments = (editedTask.comments || [])
                    .filter(comment => 
                      comment && 
                      comment.id && 
                      comment.text && 
                      comment.text.trim() !== '' && 
                      comment.authorId && 
                      comment.createdAt
                    )
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                  
                  return sortedComments;
                })().map((comment) => {
                  const author = members.find(m => m.id === comment.authorId);
                  
                  return (
                    <div key={comment.id} className="border border-gray-200 dark:border-gray-600 rounded-md p-4 bg-white dark:bg-gray-900/40">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <MemberAvatar member={author} members={members} size="sm" />
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{author?.name || 'Unknown'}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(comment.createdAt).toLocaleDateString()} {new Date(comment.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {canModifyComment(comment) && editingCommentId !== comment.id && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditComment(comment)}
                              className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                              title={t('taskPage.editComment')}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteCommentClick(comment.id)}
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                              title={t('taskPage.deleteComment')}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      {editingCommentId === comment.id ? (
                        <TextEditor
                          initialContent={editingCommentText}
                          onSubmit={handleSaveEditComment}
                          onCancel={handleCancelEditComment}
                          placeholder={t('taskPage.editCommentPlaceholder')}
                          maxLength={COMMENT_MAX_LENGTH}
                          minHeight="80px"
                          showToolbar={true}
                          showSubmitButtons={true}
                          submitButtonText={t('taskPage.saveChanges')}
                          cancelButtonText={t('buttons.cancel', { ns: 'common' })}
                          className="border rounded"
                          showAttachments={true}
                          attachmentContext="comment"
                          attachmentParentId={comment.id}
                          allowImagePaste={true}
                          allowImageDelete={true}
                          allowImageResize={true}
                          toolbarOptions={{
                            bold: true,
                            italic: true,
                            underline: true,
                            link: true,
                            lists: true,
                            alignment: false,
                            attachments: true
                          }}
                        />
                      ) : (
                        <>
                          <div 
                            className="text-sm text-gray-700 dark:text-gray-200 prose prose-sm dark:prose-invert max-w-none"
                            dangerouslySetInnerHTML={{ 
                              __html: DOMPurify.sanitize(
                                (() => {
                                  // Fix blob URLs in comment text by replacing them with server URLs (matching TaskDetails)
                                  const attachments = commentAttachments[comment.id] || [];
                                  let fixedContent = commentTextToHtml(comment.text);
                                  
                                  attachments.forEach(attachment => {
                                    if (attachment.name.startsWith('img-')) {
                                      // Replace blob URLs with authenticated server URLs
                                      const blobPattern = new RegExp(`blob:[^"]*#${attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
                                      const authenticatedUrl = getAuthenticatedAttachmentUrl(attachment.url);
                                      fixedContent = fixedContent.replace(blobPattern, authenticatedUrl || attachment.url);
                                    }
                                  });
                                  
                                  return fixedContent;
                                })()
                              ) 
                            }}
                          />
                          {/* Display non-image attachments as clickable links (matching TaskDetails) */}
                          {(() => {
                            const attachments = commentAttachments[comment.id] || [];
                            const nonImageAttachments = attachments.filter(att => !att.name.startsWith('img-'));
                            if (nonImageAttachments.length === 0) return null;
                            
                            return (
                              <div className="mt-3 space-y-1">
                                {nonImageAttachments.map(attachment => (
                                  <div
                                    key={attachment.id}
                                    className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                                  >
                                    <Paperclip size={14} />
                                    <a
                                      href={getAuthenticatedAttachmentUrl(attachment.url) || attachment.url}
                                      {...(siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true' 
                                        ? { target: '_blank', rel: 'noopener noreferrer' } 
                                        : {})}
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
                                    >
                                      {attachment.name}
                                    </a>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  );
                })}
                
                {(!editedTask.comments || editedTask.comments.length === 0) && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">{t('taskPage.noComments')}</p>
                )}
              </div>
            </div>

            {/* Task Flow Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div 
                className={`p-3 sm:p-4 lg:p-6 cursor-pointer flex items-center justify-between ${collapsedSections.taskFlow ? 'pb-3' : 'pb-0'}`}
                onClick={() => toggleSection('taskFlow')}
              >
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center">
                  <GitBranch className="h-4 w-4 mr-2" />
                  {t('taskPage.taskFlowChart')}
                </h3>
                {collapsedSections.taskFlow ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                )}
              </div>
              {!collapsedSections.taskFlow && (
                <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
                  <TaskFlowChart 
                    currentTaskId={task?.id || ''} 
                    currentTaskData={task}
                    refreshRevision={flowChartRevision}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Metadata */}
          <div className="space-y-4 sm:space-y-6 min-w-0">
            
            {/* Assignment */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div 
                className={`p-3 sm:p-4 lg:p-6 cursor-pointer flex items-center justify-between ${collapsedSections.assignment ? 'pb-3' : 'pb-0'}`}
                onClick={() => toggleSection('assignment')}
              >
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center min-w-0">
                  <User className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate">{t('taskPage.assignment')}</span>
                  {collapsedSections.assignment && (
                    <span className="ml-2 flex items-center gap-1 shrink-0">
                      <MemberAvatar member={assignedMember} members={members} size="xs" />
                      {requesterMember && requesterMember.id !== assignedMember?.id && (
                        <MemberAvatar member={requesterMember} members={members} size="xs" />
                      )}
                    </span>
                  )}
                </h3>
                {collapsedSections.assignment ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 hover:text-gray-600 shrink-0" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-400 hover:text-gray-600 shrink-0" />
                )}
              </div>
              {!collapsedSections.assignment && (
                <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="space-y-4">
                <MemberPicker
                  label={t('labels.assignedTo')}
                  members={members}
                  value={editedTask.memberId}
                  onChange={(memberId) => handleTaskUpdate({ memberId })}
                  mode="single"
                  excludeViewers
                  disabled={fieldsLocked}
                />

                <MemberPicker
                  label={t('taskPage.requestedBy')}
                  members={members}
                  value={editedTask.requesterId}
                  onChange={(memberId) => handleTaskUpdate({ requesterId: memberId })}
                  mode="single"
                  showAgentSection={false}
                  disabled={fieldsLocked}
                />
                
                {/* Watchers */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('labels.watchers')}</label>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {taskWatchers.map((watcher) => (
                        <span
                          key={watcher.id}
                          className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
                        >
                          <MemberAvatar memberId={watcher.id} members={members} size="xs" />
                          <span className="max-w-[7rem] truncate">{truncateMemberName(watcher.name)}</span>
                          {(!fieldsLocked || (viewerWatchOk && ownMember?.id === watcher.id)) && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleRemoveWatcher(watcher.id);
                              } catch (error) {
                                console.error('Error removing watcher:', error);
                              }
                            }}
                            className="ml-0.5 h-4 w-4 rounded-full bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 flex items-center justify-center text-blue-700 dark:text-blue-200"
                            aria-label={t('taskPage.removeWatcher', { defaultValue: 'Remove watcher' })}
                          >
                            ×
                          </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {viewerWatchOk && ownMember ? (
                      <WatchThisTaskButton
                        watching={taskWatchers.some((w) => w.id === ownMember.id)}
                        onClick={async () => {
                          try {
                            if (taskWatchers.some((w) => w.id === ownMember.id)) {
                              await handleRemoveWatcher(ownMember.id);
                            } else {
                              await handleAddWatcher(ownMember.id);
                            }
                          } catch (error) {
                            console.error('Error toggling watcher:', error);
                          }
                        }}
                      />
                    ) : fieldsLocked ? (
                      taskWatchers.length === 0 && (
                        <div
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-default"
                          aria-readonly="true"
                        >
                          {t('taskPage.noWatchers')}
                        </div>
                      )
                    ) : (
                    <MemberPicker
                      members={members}
                      mode="add"
                      placeholder={t('taskPage.addWatcher')}
                      excludeIds={taskWatchers.map((w) => w.id)}
                      showAgentSection={false}
                      onChange={async (memberId) => {
                        try {
                          await handleAddWatcher(memberId);
                        } catch (error) {
                          console.error('Error adding watcher:', error);
                        }
                      }}
                    />
                    )}
                  </div>
                </div>

                {/* Collaborators */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('labels.collaborators')}</label>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {taskCollaborators.map((collaborator) => (
                        <span
                          key={collaborator.id}
                          className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800"
                        >
                          <MemberAvatar memberId={collaborator.id} members={members} size="xs" />
                          <span className="max-w-[7rem] truncate">{truncateMemberName(collaborator.name)}</span>
                          {!fieldsLocked && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleRemoveCollaborator(collaborator.id);
                              } catch (error) {
                                console.error('Error removing collaborator:', error);
                              }
                            }}
                            className="ml-0.5 h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-900 hover:bg-emerald-200 dark:hover:bg-emerald-800 flex items-center justify-center"
                            aria-label={t('taskPage.removeCollaborator', { defaultValue: 'Remove collaborator' })}
                          >
                            ×
                          </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {fieldsLocked ? (
                      taskCollaborators.length === 0 && (
                        <div
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-default"
                          aria-readonly="true"
                        >
                          {t('taskPage.noCollaborators')}
                        </div>
                      )
                    ) : (
                    <MemberPicker
                      members={members}
                      mode="add"
                      placeholder={t('taskPage.addCollaborator')}
                      excludeIds={taskCollaborators.map((c) => c.id)}
                      showAgentSection={false}
                      onChange={async (memberId) => {
                        try {
                          await handleAddCollaborator(memberId);
                        } catch (error) {
                          console.error('Error adding collaborator:', error);
                        }
                      }}
                    />
                    )}
                  </div>
                </div>
              </div>
                </div>
              )}
            </div>

            {/* Priority & Dates */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div 
                className={`p-3 sm:p-4 lg:p-6 cursor-pointer flex items-center justify-between ${collapsedSections.schedule ? 'pb-3' : 'pb-0'}`}
                onClick={() => toggleSection('schedule')}
              >
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center min-w-0">
                  <Calendar className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate">{t('taskPage.scheduleAndPriority')}</span>
                  {collapsedSections.schedule && priority && (
                    <span
                      className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 max-w-[7rem]"
                      style={getPriorityPillStyle(priority.color)}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: priority.color || '#6B7280' }}
                      />
                      <span className="truncate">{priority.priority}</span>
                    </span>
                  )}
                </h3>
                {collapsedSections.schedule ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 hover:text-gray-600 shrink-0" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-400 hover:text-gray-600 shrink-0" />
                )}
              </div>
              {!collapsedSections.schedule && (
                <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('labels.sprint')}</label>
                  <SprintSelector
                    mode="assign"
                    className="w-full"
                    selectedSprintId={editedTask.sprintId || null}
                    sprints={sprints as any}
                    disabled={fieldsLocked}
                    onSprintChange={(sprint) => {
                      if (fieldsLocked) return;
                      if (!sprint) {
                        handleTaskUpdate({ sprintId: null });
                        return;
                      }
                      handleTaskUpdate({
                        sprintId: sprint.id,
                        startDate: sprint.start_date
                          ? formatToYYYYMMDD(sprint.start_date)
                          : editedTask.startDate,
                        dueDate: sprint.end_date
                          ? formatToYYYYMMDD(sprint.end_date)
                          : editedTask.dueDate,
                      });
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('labels.startDate')}</label>
                  <input
                    type="date"
                    value={toDateInputValue(editedTask.startDate)}
                    onChange={(e) => handleTaskUpdate({ startDate: e.target.value || null })}
                    readOnly={fieldsLocked}
                    tabIndex={fieldsLocked ? -1 : undefined}
                    className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
                      fieldsLocked
                        ? 'cursor-default pointer-events-none'
                        : 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('labels.dueDate')}</label>
                  <input
                    type="date"
                    value={toDateInputValue(editedTask.dueDate)}
                    onChange={(e) => handleTaskUpdate({ dueDate: e.target.value || null })}
                    readOnly={fieldsLocked}
                    tabIndex={fieldsLocked ? -1 : undefined}
                    className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
                      fieldsLocked
                        ? 'cursor-default pointer-events-none'
                        : 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {parseEffortUnit(siteSettings) === 'points' ? t('labels.effortPoints') : t('labels.effortHours')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editedTask.effort ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || /^\d{0,4}$/.test(v)) {
                        handleTaskUpdate({ effort: v === '' ? null : parseInt(v, 10) });
                      }
                    }}
                    onFocus={(e) => {
                      if (!fieldsLocked) e.currentTarget.select();
                    }}
                    readOnly={fieldsLocked}
                    tabIndex={fieldsLocked ? -1 : undefined}
                    className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
                      fieldsLocked
                        ? 'cursor-default'
                        : 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                    }`}
                    placeholder="0"
                  />
                </div>

                <PriorityPicker
                  label={t('labels.priority')}
                  priorities={availablePriorities}
                  value={editedTask.priorityId}
                  disabled={fieldsLocked}
                  onChange={(priorityId, priorityName) =>
                    handleTaskUpdate({
                      priorityId,
                      priority: priorityName,
                    })
                  }
                />

                <div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {t('labels.blocked')}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('labels.blockedHint')}
                      </p>
                    </div>
                    <label className={`relative inline-flex items-center shrink-0 ${fieldsLocked ? 'cursor-default' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={Boolean(editedTask.isBlocked)}
                        disabled={fieldsLocked}
                        onChange={(e) =>
                          handleTaskUpdate({
                            isBlocked: e.target.checked,
                            blockedReason: e.target.checked ? editedTask.blockedReason || null : null,
                          })
                        }
                      />
                      <div className={`w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600 ${
                        fieldsLocked ? '' : 'peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300'
                      }`} />
                    </label>
                  </div>
                  {editedTask.isBlocked && (
                    <input
                      type="text"
                      value={blockedReasonDraft}
                      readOnly={fieldsLocked}
                      tabIndex={fieldsLocked ? -1 : undefined}
                      onChange={(e) => {
                        const value = e.target.value;
                        setBlockedReasonDraft(value);
                        // Debounced autosave so navigating away mid-typing still persists
                        handleTaskUpdate({
                          isBlocked: true,
                          blockedReason: value.trim() || null,
                        });
                      }}
                      onBlur={(e) => {
                        const value = e.target.value.trim() || null;
                        setBlockedReasonDraft(e.target.value.trim());
                        handleTaskUpdate({
                          isBlocked: true,
                          blockedReason: value,
                        });
                        // Flush immediately on blur
                        window.setTimeout(() => saveImmediately(), 0);
                      }}
                      placeholder={t('labels.blockedReasonPlaceholder')}
                      maxLength={BLOCKED_REASON_MAX_LENGTH}
                      className={`mt-2 w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-sm ${
                        fieldsLocked ? 'cursor-default' : ''
                      }`}
                    />
                  )}
                </div>
              </div>
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div 
                className={`p-3 sm:p-4 lg:p-6 cursor-pointer flex items-center justify-between ${collapsedSections.tags ? 'pb-3' : 'pb-0'}`}
                onClick={() => toggleSection('tags')}
              >
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center min-w-0">
                  <Tag className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate">{t('labels.tags')}</span>
                  {collapsedSections.tags && liveTaskTags.length > 0 && (
                    <span className="ml-2 flex items-center gap-1 shrink-0">
                      {liveTaskTags.slice(0, 3).map((tag) => (
                        <span
                          key={tag.id}
                          className="w-2.5 h-2.5 rounded-full border border-white dark:border-gray-800 shadow-sm"
                          style={{ backgroundColor: tag.color || '#6b7280' }}
                          title={tag.tag}
                        />
                      ))}
                      {liveTaskTags.length > 3 && (
                        <span className="text-[10px] text-gray-400">+{liveTaskTags.length - 3}</span>
                      )}
                    </span>
                  )}
                </h3>
                {collapsedSections.tags ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 hover:text-gray-600 shrink-0" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-400 hover:text-gray-600 shrink-0" />
                )}
              </div>
              {!collapsedSections.tags && (
                <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
                  <TagPicker
                    availableTags={availableTags}
                    selectedTags={taskTags}
                    disabled={fieldsLocked}
                    allowCreate={!fieldsLocked}
                    onToggle={toggleTaskTag}
                    onTagCreated={async (tag) => {
                      try {
                        await handleAddTag(tag.id);
                      } catch (error) {
                        console.error('Error adding created tag:', error);
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* Task Association */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div 
                className={`p-3 sm:p-4 lg:p-6 cursor-pointer flex items-center justify-between ${collapsedSections.associations ? 'pb-3' : 'pb-0'}`}
                onClick={() => toggleSection('associations')}
              >
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center">
                  <Users className="h-4 w-4 mr-2" />
                  {t('taskPage.taskAssociation')}
                </h3>
                {collapsedSections.associations ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                )}
              </div>
              {!collapsedSections.associations && (
                <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 min-w-0">
                  {/* Parent Field - Left Side */}
                  {parentTask && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('taskPage.parent')}:</label>
                      <span 
                        onClick={() => {
                          const url = generateTaskUrl(parentTask.ticket, parentTask.projectId);
                          pageLog('🔗 TaskPage Parent URL:', { 
                            ticket: parentTask.ticket, 
                            projectId: parentTask.projectId, 
                            generatedUrl: url 
                          });
                          // Extract just the hash part for navigation
                          const hashPart = url.split('#').slice(1).join('#');
                          window.location.hash = hashPart;
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                        title={`Go to parent task ${parentTask.ticket}`}
                      >
                        {parentTask.ticket}
                      </span>
                    </div>
                  )}
                  
                  {/* Children Field - Right Side */}
                  <div className={parentTask ? '' : 'col-span-2'}>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{t('taskPage.children')}:</label>
                    
                    {/* Selected Children Display */}
                    {childTasks.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {childTasks.map(child => (
                          <span
                            key={child.id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full font-medium bg-blue-100 dark:bg-blue-950 dark:ring-1 dark:ring-blue-700/60 text-blue-900 dark:text-blue-100 hover:opacity-90 transition-opacity"
                          >
                            <span 
                              onClick={() => {
                                const url = generateTaskUrl(child.ticket, child.projectId);
                                pageLog('🔗 TaskPage Child URL:', { 
                                  ticket: child.ticket, 
                                  projectId: child.projectId, 
                                  generatedUrl: url 
                                });
                                // Extract just the hash part for navigation
                                const hashPart = url.split('#').slice(1).join('#');
                                window.location.hash = hashPart;
                              }}
                              className="text-blue-900 dark:text-blue-100 hover:text-blue-700 dark:hover:text-white hover:underline cursor-pointer transition-colors"
                              title={`Go to child task ${child.ticket}`}
                            >
                              {child.ticket}
                            </span>
                            {!fieldsLocked && (
                            <button
                              type="button"
                              onClick={() => handleRemoveChildTask(child.id)}
                              className="ml-1 text-blue-700 dark:text-blue-200 hover:bg-red-500 hover:text-white rounded-full w-3 h-3 flex items-center justify-center text-xs font-bold transition-colors"
                              title={t('taskPage.removeChildTask')}
                            >
                              ×
                            </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* Children Dropdown */}
                    {!fieldsLocked && (
                    <div className="relative" ref={childrenDropdownRef}>
                      <button
                        type="button"
                        onClick={handleChildrenDropdownToggle}
                        className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between text-gray-900 dark:text-gray-100"
                      >
                        <span className="text-gray-700 dark:text-gray-200">
                          {t('taskPage.addChildTask')}
                        </span>
                        <ChevronDown size={16} className={`transform transition-transform ${showChildrenDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {showChildrenDropdown && (
                        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto">
                          {/* Search Input */}
                          <div className="p-2 border-b border-gray-200 dark:border-gray-600">
                            <input
                              type="text"
                              placeholder={t('taskPage.searchTasks')}
                              value={childrenSearchTerm}
                              onChange={(e) => setChildrenSearchTerm(e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              autoFocus
                            />
                          </div>
                          
                          {/* Available Tasks List */}
                          <div className="max-h-40 overflow-y-auto">
                            {filteredAvailableChildren.length > 0 ? (
                              filteredAvailableChildren.map(availableTask => (
                                <button
                                  key={availableTask.id}
                                  type="button"
                                  onClick={() => handleAddChildTask(availableTask.id)}
                                  className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/35 focus:bg-blue-50 dark:focus:bg-blue-900/35 focus:outline-none transition-colors text-sm"
                                >
                                  <div className="font-medium text-blue-600 dark:text-blue-400">{availableTask.ticket}</div>
                                  <div className="text-gray-600 dark:text-gray-300 truncate">{availableTask.title}</div>
                                </button>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                                {childrenSearchTerm ? t('taskPage.noTasksFound') : t('taskPage.noAvailableTasks')}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              </div>
                </div>
              )}
            </div>


            {/* Task Info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
              <div 
                className={`p-3 sm:p-4 lg:p-6 cursor-pointer flex items-center justify-between ${collapsedSections.taskInfo ? 'pb-3' : 'pb-0'}`}
                onClick={() => toggleSection('taskInfo')}
              >
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('taskPage.taskInformation')}</h3>
                {collapsedSections.taskInfo ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" />
                )}
              </div>
              {!collapsedSections.taskInfo && (
                <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('taskPage.taskId')}:</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">{taskId}</span>
                </div>
                {getProjectIdentifier() && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('taskPage.project')}:</span>
                    <span className="font-mono text-gray-900 dark:text-gray-100">{getProjectIdentifier()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('taskPage.status')}:</span>
                  <span className="capitalize text-gray-900 dark:text-gray-100">{editedTask.status || t('taskPage.unknown')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('labels.created')}:</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {editedTask.created_at ? new Date(editedTask.created_at).toLocaleDateString() : 
                     editedTask.createdAt ? new Date(editedTask.createdAt).toLocaleDateString() : t('taskPage.unknown')}
                  </span>
                </div>
                {(editedTask.updated_at || editedTask.updatedAt) && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('labels.updated')}:</span>
                    <span className="text-gray-900 dark:text-gray-100">
                      {editedTask.updated_at ? new Date(editedTask.updated_at).toLocaleDateString() :
                       editedTask.updatedAt ? new Date(editedTask.updatedAt).toLocaleDateString() : t('taskPage.unknown')}
                    </span>
                  </div>
                )}
              </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Manager */}
      <ModalManager
        selectedTask={null} // TaskPage doesn't use task details modal
        members={members}
        onTaskClose={() => {}} // Not applicable for TaskPage
        onTaskUpdate={async () => {}} // Not applicable for TaskPage
        showHelpModal={showHelpModal}
        helpExpandToken={helpExpandToken}
        onHelpClose={() => setShowHelpModal(false)}
        onPageChange={onPageChange}
        showProfileModal={showProfileModal}
        currentUser={currentUser}
        onProfileClose={() => {
          setShowProfileModal(false);
          setIsProfileBeingEdited(false);
        }}
        onProfileUpdated={handleProfileUpdated}
        isProfileBeingEdited={isProfileBeingEdited}
        onProfileEditingChange={setIsProfileBeingEdited}
        onActivityFeedToggle={handleActivityFeedToggle}
        siteSettings={siteSettings}
        boards={boards}
      />
    </div>
  );
}
