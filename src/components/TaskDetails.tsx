import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Task, TeamMember, Comment, Attachment, Tag, PriorityOption, CurrentUser, TaskUpdateOptions } from '../types';
import { X, Paperclip, ChevronDown, Check, Edit2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import TextEditor from './TextEditor';
import {
  createComment,
  uploadFile,
  updateTask,
  deleteComment,
  updateComment,
  fetchCommentAttachments,
  getAllTags,
  getTaskTags,
  addTagToTask,
  removeTagFromTask,
  getAllPriorities,
  addWatcherToTask,
  removeWatcherFromTask,
  addCollaboratorToTask,
  removeCollaboratorFromTask,
  fetchTaskAttachments,
  deleteAttachment,
  getTaskRelationships,
  getAvailableTasksForRelationship,
  addTaskRelationship,
  removeTaskRelationship,
  putTaskWork,
  getTaskWork,
  getTaskById,
  setTaskWorkControl,
  undoAutomationJob,
  type TaskWorkMap,
} from '../api';
import { useFileUpload, getUploadErrorMessage } from '../hooks/useFileUpload';
import { toast } from '../utils/toast';
import { getLocalISOString, formatToYYYYMMDDHHmmss } from '../utils/dateUtils';
import { generateUUID } from '../utils/uuid';
import { loadUserPreferences, updateUserPreference } from '../utils/userPreferences';
import { generateTaskUrl } from '../utils/routingUtils';
import { mergeTaskTagsWithLiveData, getTagDisplayStyle } from '../utils/tagUtils';
import { getAuthenticatedAttachmentUrl, getAuthenticatedAvatarUrl } from '../utils/authImageUrl';
import { truncateMemberName } from '../utils/memberUtils';
import {
  isAgentMemberId,
} from '../utils/agentMemberUi';
import AddTagModal from './AddTagModal';
import AgentPanel from './AgentPanel';
import type { AgentPanelView } from './AgentPanel';
import MemberPicker from './ui/MemberPicker';
import MemberAvatar from './ui/MemberAvatar';
import AgentStatusButton from './AgentStatusButton';
import {
  AGENT_MEMBER_ID,
  SYSTEM_MEMBER_ID,
  AGENT_DRAG_BLOCKING_STATUSES,
} from '../constants/appConstants';
import { feDebug } from '../utils/clientDebug';
import { commentTextToHtml } from '../utils/commentContent';
import { parseEffortUnit, isTaskSoftDeleted } from '../utils/taskUtils';
import websocketClient from '../services/websocketClient';

function detailsLog(...args: unknown[]) {
  if (feDebug('FE_DEBUG_TASK_DETAILS')) console.log(...args);
}

interface TaskDetailsProps {
  task: Task;
  members: TeamMember[];
  currentUser: CurrentUser | null;
  onClose: () => void;
  onUpdate: (updatedTask: Task, options?: TaskUpdateOptions) => void;
  siteSettings?: { [key: string]: string };
  boards?: any[]; // To get project identifier from board
  scrollToComments?: boolean;
  /** When true (or task is soft-deleted), disable all writers and show restore/purge. */
  readOnly?: boolean;
  /** Board/task field edits (false for viewers). Comments still allowed unless lifecycle read-only. */
  canMutate?: boolean;
  onRestore?: () => Promise<void>;
  onPurge?: () => Promise<void>;
  isAdmin?: boolean;
}

export default function TaskDetails({
  task,
  members,
  currentUser,
  onClose,
  onUpdate,
  siteSettings,
  boards,
  scrollToComments,
  readOnly = false,
  canMutate = true,
  onRestore,
  onPurge,
  isAdmin = false,
}: TaskDetailsProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const userPrefs = loadUserPreferences();
  const [width, setWidth] = useState(userPrefs.taskDetailsWidth);
  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setIsCompactViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const panelWidth = Math.min(
    isCompactViewport
      ? Math.max(width, Math.round(window.innerWidth * 0.88))
      : width,
    typeof window !== 'undefined' ? window.innerWidth : width
  );
  
  // Get project identifier from the board this task belongs to
  const getProjectIdentifier = () => {
    if (!boards || !task.boardId) return null;
    const board = boards.find(b => b.id === task.boardId);
    return board?.project || null;
  };
  const [isResizing, setIsResizing] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [agentPanelView, setAgentPanelView] = useState<AgentPanelView>('activity');
  const [agentPanelRestoreToken, setAgentPanelRestoreToken] = useState(0);
  const [agentWork, setAgentWork] = useState<TaskWorkMap>({});
  const [agentControlBusy, setAgentControlBusy] = useState(false);
  const [agentModalComments, setAgentModalComments] = useState(task.comments || []);
  const detailsPanelRef = useRef<HTMLDivElement>(null);
  const [editedTask, setEditedTask] = useState<Task>(() => ({
    ...task,
    memberId: task.memberId || members[0]?.id || '',
    requesterId: task.requesterId || members[0]?.id || '',
    comments: (task.comments || [])
      .filter(comment => 
        comment && 
        comment.id && 
        comment.text && 
        comment.authorId && 
        comment.createdAt
      )
      .map(comment => ({
        id: comment.id,
        text: comment.text,
        authorId: comment.authorId,
        createdAt: comment.createdAt,
        taskId: task.id,
        attachments: Array.isArray(comment.attachments) 
          ? comment.attachments.map(attachment => ({
              id: attachment.id,
              name: attachment.name,
              url: attachment.url,
              type: attachment.type,
              size: attachment.size
            }))
          : []
      }))
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingText, setIsSavingText] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const [commentAttachments, setCommentAttachments] = useState<Record<string, Attachment[]>>({});
  const textSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blockedReasonSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [showTagsDropdown, setShowTagsDropdown] = useState(false);
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const tagsDropdownRef = useRef<HTMLDivElement>(null);
  const [availablePriorities, setAvailablePriorities] = useState<PriorityOption[]>([]);

  const agentStatus = agentWork.status || null;
  const isAgentAssigned =
    editedTask.memberId === AGENT_MEMBER_ID || task.memberId === AGENT_MEMBER_ID;
  const isAgentWorkActive =
    isAgentAssigned &&
    !!agentStatus &&
    (AGENT_DRAG_BLOCKING_STATUSES as readonly string[]).includes(agentStatus);
  /** Soft-deleted / trash: blocks comments and task fields. */
  const isReadOnlyMode = readOnly || isTaskSoftDeleted(task);
  /** Task field writers (title, assignee, etc.) — viewers cannot mutate board data. */
  const isWritersLocked = isAgentWorkActive || isReadOnlyMode || !canMutate;
  /** Comments allowed for viewers on live tasks; blocked in trash. */
  const commentsLocked = isReadOnlyMode;

  useEffect(() => {
    if (!isAgentAssigned) {
      setAgentWork({});
      return;
    }
    let cancelled = false;
    getTaskWork(task.id)
      .then(({ work }) => {
        if (!cancelled) setAgentWork(work || {});
      })
      .catch(() => {
        if (!cancelled) setAgentWork({});
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, isAgentAssigned]);

  useEffect(() => {
    const handler = (data: { taskId?: string; work?: TaskWorkMap }) => {
      if (data?.taskId === task.id && data.work) {
        setAgentWork(data.work);
      }
    };
    websocketClient.onTaskWorkUpdated(handler);
    return () => websocketClient.offTaskWorkUpdated(handler);
  }, [task.id]);

  useEffect(() => {
    if (!showAgentPanel || !isAgentAssigned) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [{ work }, fresh] = await Promise.all([
          getTaskWork(task.id),
          getTaskById(task.id),
        ]);
        if (cancelled) return;
        if (work) setAgentWork(work);
        if (fresh?.comments) setAgentModalComments(fresh.comments);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [showAgentPanel, task.id, isAgentAssigned]);
  
  // Task relationships state
  const [relationships, setRelationships] = useState<any[]>([]);
  const [parentTask, setParentTask] = useState<{id: string, ticket: string, title: string, projectId?: string} | null>(null);
  const [childTasks, setChildTasks] = useState<{id: string, ticket: string, title: string, projectId?: string}[]>([]);
  const [availableTasksForChildren, setAvailableTasksForChildren] = useState<{id: string, ticket: string, title: string, status: string, projectId?: string}[]>([]);
  const [showChildrenDropdown, setShowChildrenDropdown] = useState(false);
  const [childrenSearchTerm, setChildrenSearchTerm] = useState('');
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false);
  const childrenDropdownRef = useRef<HTMLDivElement>(null);
  
  // Task attachments state with logging
  const [taskAttachments, setTaskAttachmentsInternal] = useState<Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }>>([]);
  
  // Clean wrapper for taskAttachments setter
  const setTaskAttachments = setTaskAttachmentsInternal;
  
  // Use the new file upload hook for task attachments
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
  const [lastSavedDescription, setLastSavedDescription] = useState(task.description || '');
  const [effortDraft, setEffortDraft] = useState(String(task.effort ?? 0));
  const isUploadingRef = useRef(false);
  const taskAttachmentsRef = useRef(taskAttachments);
  const editedTaskRef = useRef(editedTask);
  
  // Keep refs in sync with state
  useEffect(() => {
    taskAttachmentsRef.current = taskAttachments;
  }, [taskAttachments]);
  
  useEffect(() => {
    editedTaskRef.current = editedTask;
  }, [editedTask]);

  // Keep effort text draft in sync when switching tasks or external updates
  useEffect(() => {
    setEffortDraft(String(editedTask.effort ?? 0));
  }, [editedTask.id]);
  
  // Watchers and Collaborators state
  const [taskWatchers, setTaskWatchers] = useState<TeamMember[]>(task.watchers || []);
  const [taskCollaborators, setTaskCollaborators] = useState<TeamMember[]>(task.collaborators || []);
  const [tagsDropdownPosition, setTagsDropdownPosition] = useState<'above' | 'below'>('below');
  const tagsButtonRef = useRef<HTMLButtonElement>(null);
  const previousTaskIdRef = useRef<string | null>(null);
  const previousTaskRef = useRef<Task | null>(null);

  // Comment editing state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState<string>('');
  const [showRefreshIndicator, setShowRefreshIndicator] = useState(false);
  const [isInitialTaskLoad, setIsInitialTaskLoad] = useState(true);
  
  // Local state for date inputs to handle visual updates separately from server updates
  const [localStartDate, setLocalStartDate] = useState(task.startDate);
  const [localDueDate, setLocalDueDate] = useState(task.dueDate || '');

  // Reset component state when switching to a different task
  useEffect(() => {
    // Update local date state when task changes
    setLocalStartDate(task.startDate);
    setLocalDueDate(task.dueDate || '');
    
    // Reset attachment-related state
    setTaskAttachments([]);
    clearFiles();
    setIsDeletingAttachment(false);
    recentlyDeletedAttachmentsRef.current.clear();
    
    // Reset watchers and collaborators
    setTaskWatchers(task.watchers || []);
    setTaskCollaborators(task.collaborators || []);
    
    // Reset dropdown states
    setShowTagsDropdown(false);
    setShowChildrenDropdown(false);
    
    // Reset relationship state
    setRelationships([]);
    setParentTask(null);
    setChildTasks([]);
    setAvailableTasksForChildren([]);
    setChildrenSearchTerm('');
    setIsLoadingRelationships(false);
    
    // Reset comment editing state
    setEditingCommentId(null);
    setEditingCommentText('');
    
    // Reset other UI states
    setIsSubmitting(false);
    setIsSavingText(false);
    setIsInitialTaskLoad(true);
    setShowRefreshIndicator(false);
    
    // Clear comment attachments for new task
    setCommentAttachments({});
  }, [task.id]); // Only depend on task.id to trigger when switching tasks

  // Update local date state when task dates change (from WebSocket updates)
  // This is separate from the task.id effect to handle date updates for the same task
  useEffect(() => {
    // Update local state when task dates change (from WebSocket or other updates)
    setLocalStartDate(task.startDate);
    setLocalDueDate(task.dueDate || '');
  }, [task.startDate, task.dueDate]); // Update when dates change, even if task ID is same

  // Auto-refresh comments when task prop updates (from polling)
  useEffect(() => {
    // Don't process updates if we're currently editing a comment
    if (editingCommentId) return;

    const processedComments = (task.comments || [])
      .filter(comment => 
        comment && 
        comment.id && 
        comment.text && 
        comment.authorId && 
        comment.createdAt
      )
      .map(comment => ({
        id: comment.id,
        text: comment.text,
        authorId: comment.authorId,
        createdAt: comment.createdAt,
        taskId: task.id,
        attachments: Array.isArray(comment.attachments) 
          ? comment.attachments.map(attachment => ({
              id: attachment.id,
              name: attachment.name,
              url: attachment.url,
              type: attachment.type,
              size: attachment.size
            }))
          : []
      }));

    // Update local state when task prop changes, but preserve any unsaved local changes
    setEditedTask(prev => {
      // Check if comments have changed (new comments added by other users)
      const prevCommentIds = (prev.comments || []).map(c => c.id).sort();
      const newCommentIds = processedComments.map(c => c.id).sort();
      const commentsChanged = JSON.stringify(prevCommentIds) !== JSON.stringify(newCommentIds);

      // Show refresh indicator if comments were added/removed (but not on initial task load)
      if (commentsChanged && prev.comments && prev.comments.length > 0 && !isInitialTaskLoad) {
        setShowRefreshIndicator(true);
        setTimeout(() => setShowRefreshIndicator(false), 3000); // Hide after 3 seconds
      }

      // Mark that we've completed the initial load for this task
      if (isInitialTaskLoad) {
        setIsInitialTaskLoad(false);
      }

      return {
        ...task,
        // Preserve unsaved text changes to avoid losing user input
        title: prev.title !== task.title && isSavingText ? prev.title : task.title,
        description: prev.description !== task.description && (isSavingText || isUploadingAttachments) ? prev.description : task.description,
        // Update comments with processed data
        comments: processedComments
      };
    });
  }, [task, isSavingText, editingCommentId, isUploadingAttachments]);

  // Load task relationships
  useEffect(() => {
    const loadRelationships = async () => {
      if (!task.id) return;
      
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
        setAvailableTasksForChildren(Array.isArray(availableTasksData) ? availableTasksData : []);
        
      } catch (error) {
        console.error('Error loading task relationships:', error);
      } finally {
        setIsLoadingRelationships(false);
      }
    };
    
    loadRelationships();
  }, [task.id]);

  // Helper function to calculate optimal dropdown position
  const calculateDropdownPosition = (buttonRef: React.RefObject<HTMLButtonElement>): 'above' | 'below' => {
    if (!buttonRef.current) return 'below';
    
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Space available above and below the button
    const spaceAbove = buttonRect.top;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    
    // Dropdown height estimate (max-h-48 = 192px + padding)
    const dropdownHeight = 200;
    
    
    // Prefer going up if there's enough space (more aggressive preference for upward)
    if (spaceAbove >= dropdownHeight) {
      return 'above';
    }
    
    return 'below';
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.max(380, Math.min(800, newWidth));
      setWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Save the final width to user preferences
      updateUserPreference('taskDetailsWidth', width);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, width]);

  const handleUpdate = async (updatedFields: Partial<Task>) => {
    if (isSubmitting) return;
    if (isWritersLocked) return;

    if (updatedFields.memberId === AGENT_MEMBER_ID) {
      if (siteSettings?.AI_ENABLED !== 'true') return;
      setAgentPanelView('configure');
      setShowAgentPanel(true);
      setAgentPanelRestoreToken((n) => n + 1);
      return;
    }

    const updatedTask = { ...editedTask, ...updatedFields };
    setEditedTask(updatedTask);

    // Don't update server immediately for text fields to prevent focus loss
    // Only update server for non-text fields or when explicitly needed
    const isTextUpdate = 'title' in updatedFields || 'description' in updatedFields;
    
    if (!isTextUpdate) {
      try {
        setIsSubmitting(true);
        await onUpdate(updatedTask);
      } catch (error) {
        console.error('Failed to update task:', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleAgentPanelSaveConfig = async (
    repoUrl: string,
    repoBranch: string,
    options?: {
      restart?: boolean;
      llmModel?: string;
      launch?: boolean;
      agentMode?: 'assist' | 'code' | 'automation';
      automationScope?: 'this_board' | 'selected' | 'all_boards';
      automationBoardIds?: string[];
      description?: string;
    }
  ) => {
    const agentMode = options?.agentMode || (repoUrl.trim() ? 'code' : 'assist');
    const isFirstAssign = editedTask.memberId !== AGENT_MEMBER_ID;
    setIsSubmitting(true);
    try {
      if (isFirstAssign) {
        const updatedTask = {
          ...editedTask,
          memberId: AGENT_MEMBER_ID,
          ...(options?.description !== undefined
            ? { description: options.description }
            : {}),
        };
        setEditedTask(updatedTask);
        await onUpdate(updatedTask);
        const shouldLaunch = options?.launch !== false;
        const { work } = await putTaskWork(task.id, {
          repoUrl: agentMode === 'automation' ? '' : repoUrl,
          repoBranch: agentMode === 'automation' ? '' : repoBranch,
          agentMode,
          ...(agentMode === 'automation'
            ? {
                automationScope: options?.automationScope || 'this_board',
                automationBoardIds: options?.automationBoardIds || [],
              }
            : {}),
          ...(shouldLaunch
            ? { status: 'queued', entries: { control: 'none' } }
            : {}),
          ...(options?.llmModel !== undefined ? { llmModel: options.llmModel } : {}),
        });
        setAgentWork(work || {});
        return;
      }

      if (options?.description !== undefined) {
        const updatedTask = { ...editedTask, description: options.description };
        setEditedTask(updatedTask);
        await onUpdate(updatedTask);
      }
      const { work } = await putTaskWork(task.id, {
        repoUrl: agentMode === 'automation' ? '' : repoUrl,
        repoBranch: agentMode === 'automation' ? '' : repoBranch,
        agentMode,
        ...(agentMode === 'automation'
          ? {
              automationScope: options?.automationScope || 'this_board',
              automationBoardIds: options?.automationBoardIds || [],
            }
          : {}),
        ...(options?.llmModel !== undefined ? { llmModel: options.llmModel } : {}),
      });
      setAgentWork(work || {});
      if (options?.restart) {
        await handleAgentControl('resume');
      }
    } catch (error) {
      console.error('Failed to save agent configuration:', error);
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAgentWorkingModal = () => {
    setAgentModalComments(editedTask.comments || task.comments || []);
    setAgentPanelView('activity');
    setShowAgentPanel(true);
    setAgentPanelRestoreToken((n) => n + 1);
  };

  const handleAgentControl = async (
    control: 'pause' | 'stop' | 'resume' | 'apply'
  ) => {
    setAgentControlBusy(true);
    try {
      const { work } = await setTaskWorkControl(task.id, control);
      setAgentWork(work);
    } catch (error) {
      console.error('Agent control failed:', error);
    } finally {
      setAgentControlBusy(false);
    }
  };

  const handleAutomationUndo = async () => {
    setAgentControlBusy(true);
    try {
      const result = await undoAutomationJob(task.id);
      if (result.work) {
        setAgentWork(result.work);
      } else {
        const { work } = await getTaskWork(task.id);
        setAgentWork(work || {});
      }
      try {
        const fresh = await getTaskById(task.id);
        if (fresh?.comments) setAgentModalComments(fresh.comments);
      } catch {
        /* ignore comment refresh errors */
      }
    } catch (error) {
      console.error('Automation undo failed:', error);
    } finally {
      setAgentControlBusy(false);
    }
  };

  const handleAgentRefine = async (text: string, options: { restart: boolean }) => {
    // Reuse comment flow via createComment path used by handleCommentSubmit below —
    // call the same API used for panel comments.
    const currentUserMember = members.find((m) => m.user_id === currentUser?.id);
    if (!currentUserMember) return;
    const newComment = {
      id: generateUUID(),
      text,
      authorId: currentUserMember.id,
      createdAt: new Date().toISOString(),
      taskId: task.id,
      attachments: [] as Attachment[],
    };
    await createComment(newComment);
    const updatedComments = [...(editedTask.comments || []), newComment];
    setEditedTask((prev) => ({ ...prev, comments: updatedComments }));
    setAgentModalComments(updatedComments);
    await onUpdate({ ...editedTask, comments: updatedComments }, { localOnly: true });
    if (options.restart) {
      await handleAgentControl('resume');
    }
  };

  // Separate function for text field updates with immediate save
  const handleTextUpdate = (field: 'title' | 'description', value: string) => {
    if (isWritersLocked) return;
    const updatedTask = { ...editedTask, [field]: value };
    setEditedTask(updatedTask);
    
    // Debounce text saves to prevent spam (but keep attachments immediate)
    if (textSaveTimeoutRef.current) {
      clearTimeout(textSaveTimeoutRef.current);
    }
    
    textSaveTimeoutRef.current = setTimeout(async () => {
      await saveImmediately(updatedTask);
    }, 1500); // 1.5 second debounce for text
  };

  // Function to save immediately
  const saveImmediately = useCallback(async (updatedTask: Task) => {
    try {
      setIsSavingText(true);
      // Always include the current attachment count when saving
      const taskWithAttachmentCount = {
        ...updatedTask,
        attachmentCount: taskAttachments.length
      };
      await onUpdate(taskWithAttachmentCount);
      // Update last saved description after successful save
      if (updatedTask.description) {
        setLastSavedDescription(updatedTask.description);
      }
    } catch (error) {
      console.error('❌ Immediate save failed:', error);
    } finally {
      setIsSavingText(false);
    }
  }, [onUpdate, taskAttachments.length]);

  // Function to save changes immediately
  const saveChanges = async () => {
    if (editedTask.title !== task.title || editedTask.description !== task.description) {
      try {
        setIsSavingText(true);
        // Always include the current attachment count when saving
        const taskWithAttachmentCount = {
          ...editedTask,
          attachmentCount: taskAttachments.length
        };
        await onUpdate(taskWithAttachmentCount);
      } catch (error) {
        console.error('Failed to save task:', error);
      } finally {
        setIsSavingText(false);
      }
    }
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (textSaveTimeoutRef.current) {
        clearTimeout(textSaveTimeoutRef.current);
      }
      if (blockedReasonSaveTimeoutRef.current) {
        clearTimeout(blockedReasonSaveTimeoutRef.current);
      }
    };
  }, []);

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

  // Handle task switching - save current task before switching to new one
  useEffect(() => {
    const handleTaskSwitch = async () => {
      const previousTaskId = previousTaskIdRef.current;
      const currentTaskId = task.id;
      
      // Check if this is a task switch (not initial load)
      if (previousTaskId && previousTaskId !== currentTaskId) {
        const previousTask = previousTaskRef.current;
        
        if (previousTask) {
          // Save any pending changes before switching
          const hasUnsavedChanges = 
            editedTask.title !== previousTask.title || 
            editedTask.description !== previousTask.description;
            
          if (hasUnsavedChanges) {
            try {
              // Force save any unsaved changes to the previous task
              await updateTask(previousTaskId, {
                title: editedTask.title,
                description: editedTask.description
              });
              detailsLog('Auto-saved changes before switching tasks');
            } catch (error) {
              console.error('Error saving changes before task switch:', error);
            }
          }
        }
      }
      
      // Update the refs for next comparison
      previousTaskIdRef.current = currentTaskId;
      previousTaskRef.current = task;
      
      // Reset initial load flag for new task
      setIsInitialTaskLoad(true);
      
      // Reset edited task to match the new task
      setEditedTask({
        ...task,
        memberId: task.memberId || members[0]?.id || '',
        requesterId: task.requesterId || members[0]?.id || '',
        comments: (task.comments || [])
          .filter(comment => 
            comment && 
            comment.id && 
            comment.text && 
            comment.authorId && 
            comment.createdAt
          )
          .map(comment => ({
            id: comment.id,
            text: comment.text,
            authorId: comment.authorId,
            createdAt: comment.createdAt,
            taskId: task.id,
            attachments: Array.isArray(comment.attachments) 
              ? comment.attachments.map(attachment => ({
                  id: attachment.id,
                  name: attachment.name,
                  url: attachment.url,
                  type: attachment.type,
                  size: attachment.size
                }))
              : []
          }))
      });
    };

    handleTaskSwitch();
  }, [task]);

  // Load available tags, task tags, and priorities (watchers/collaborators come from task prop)
  useEffect(() => {
    const loadTaskData = async () => {
      try {
        setIsLoadingTags(true);
        const [allTags, currentTaskTags, allPriorities, currentAttachments] = await Promise.all([
          getAllTags(),
          getTaskTags(task.id),
          getAllPriorities(),
          fetchTaskAttachments(task.id)
        ]);
        setAvailableTags(allTags || []);
        setTaskTags(currentTaskTags || []);
        setAvailablePriorities(allPriorities || []);
        
        // Filter out recently deleted attachments and only update if not uploading
        if (!isUploadingAttachments) {
          const filteredAttachments = (currentAttachments || []).filter((att: any) => 
            !recentlyDeletedAttachmentsRef.current.has(att.name)
          );
          setTaskAttachments(filteredAttachments);
        }
        // Update watchers and collaborators from task prop
        setTaskWatchers(task.watchers || []);
        setTaskCollaborators(task.collaborators || []);
      } catch (error) {
        console.error('Failed to load task data:', error);
      } finally {
        setIsLoadingTags(false);
      }
    };
    
    loadTaskData();
  }, [task.id, task.watchers, task.collaborators]);

  // Sync taskTags with task.tags when task prop changes
  useEffect(() => {
    if (task.tags && Array.isArray(task.tags)) {
      setTaskTags(task.tags);
    }
  }, [task.tags]);

  // Sync taskWatchers with task.watchers when task prop changes
  useEffect(() => {
    if (task.watchers && Array.isArray(task.watchers)) {
      setTaskWatchers(task.watchers);
    }
  }, [task.watchers]);

  // Sync taskCollaborators with task.collaborators when task prop changes
  useEffect(() => {
    if (task.collaborators && Array.isArray(task.collaborators)) {
      setTaskCollaborators(task.collaborators);
    }
  }, [task.collaborators]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(event.target as Node)) {
        setShowTagsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTag = async (tag: Tag) => {
    if (isWritersLocked) return;
    try {
      const isSelected = taskTags.some(t => t.id === tag.id);
      
      if (isSelected) {
        // Remove tag
        await removeTagFromTask(task.id, tag.id);
        const newTaskTags = taskTags.filter(t => t.id !== tag.id);
        setTaskTags(newTaskTags);
        
        // Update parent task with new tags
        const updatedTask = { ...editedTask, tags: newTaskTags, attachmentCount: taskAttachments.length };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      } else {
        // Add tag
        await addTagToTask(task.id, tag.id);
        const newTaskTags = [...taskTags, tag];
        setTaskTags(newTaskTags);
        
        // Update parent task with new tags
        const updatedTask = { ...editedTask, tags: newTaskTags, attachmentCount: taskAttachments.length };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      }
    } catch (error) {
      console.error('Failed to toggle tag:', error);
    }
  };

  const handleTagCreated = async (newTag: Tag) => {
    // Add the new tag to available tags list
    setAvailableTags(prev => [...prev, newTag].sort((a, b) => a.tag.localeCompare(b.tag)));
    // Automatically add it to the current task
    try {
      await addTagToTask(task.id, newTag.id);
      const newTaskTags = [...taskTags, newTag];
      setTaskTags(newTaskTags);
      
      // Update parent task with new tags
      const updatedTask = { ...editedTask, tags: newTaskTags, attachmentCount: taskAttachments.length };
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
    } catch (error) {
      console.error('Failed to add new tag to task:', error);
    }
  };

  const toggleWatcher = async (member: TeamMember) => {
    try {
      const isWatching = taskWatchers.some(w => w.id === member.id);
      
      if (isWatching) {
        // Remove watcher
        await removeWatcherFromTask(task.id, member.id);
        const newWatchers = taskWatchers.filter(w => w.id !== member.id);
        setTaskWatchers(newWatchers);
        
        // Update parent task with new watchers
        const updatedTask = { ...editedTask, watchers: newWatchers, attachmentCount: taskAttachments.length };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      } else {
        // Add watcher
        await addWatcherToTask(task.id, member.id);
        const newWatchers = [...taskWatchers, member];
        setTaskWatchers(newWatchers);
        
        // Update parent task with new watchers
        const updatedTask = { ...editedTask, watchers: newWatchers, attachmentCount: taskAttachments.length };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      }
    } catch (error) {
      console.error('Failed to toggle watcher:', error);
    }
  };

  const toggleCollaborator = async (member: TeamMember) => {
    try {
      const isCollaborating = taskCollaborators.some(c => c.id === member.id);
      
      if (isCollaborating) {
        // Remove collaborator
        await removeCollaboratorFromTask(task.id, member.id);
        const newCollaborators = taskCollaborators.filter(c => c.id !== member.id);
        setTaskCollaborators(newCollaborators);
        
        // Update parent task with new collaborators
        const updatedTask = { ...editedTask, collaborators: newCollaborators, attachmentCount: taskAttachments.length };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      } else {
        // Add collaborator
        await addCollaboratorToTask(task.id, member.id);
        const newCollaborators = [...taskCollaborators, member];
        setTaskCollaborators(newCollaborators);
        
        // Update parent task with new collaborators
        const updatedTask = { ...editedTask, collaborators: newCollaborators, attachmentCount: taskAttachments.length };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      }
    } catch (error) {
      console.error('Failed to toggle collaborator:', error);
    }
  };

  // Handler for opening tags dropdown with position calculation
  const handleTagsDropdownToggle = () => {
    if (isWritersLocked) return;
    if (!showTagsDropdown) {
      const position = calculateDropdownPosition(tagsButtonRef);
      setTagsDropdownPosition(position);
    }
    setShowTagsDropdown(!showTagsDropdown);
  };

  // Task relationship handlers
  const handleAddChildTask = async (childTaskId: string) => {
    try {
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
      setAvailableTasksForChildren(Array.isArray(availableTasksData) ? availableTasksData : []);
      
      setShowChildrenDropdown(false);
      setChildrenSearchTerm('');
    } catch (error) {
      console.error('Failed to add child task:', error);
    }
  };

  const handleRemoveChildTask = async (childTaskId: string) => {
    try {
      // Find the relationship to delete
      const relationship = relationships.find(rel => 
        rel.relationship === 'parent' && 
        rel.task_id === task.id && 
        rel.to_task_id === childTaskId
      );
      
      detailsLog('🗑️ Attempting to remove child task:', {
        childTaskId,
        foundRelationship: relationship,
        allRelationships: relationships
      });
      
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
        setAvailableTasksForChildren(Array.isArray(availableTasksData) ? availableTasksData : []);
        
        detailsLog('✅ Successfully removed child task and reloaded data');
      } else {
        console.error('❌ No relationship found to delete');
      }
    } catch (error) {
      console.error('Failed to remove child task:', error);
    }
  };

  // Handler for opening children dropdown
  const handleChildrenDropdownToggle = () => {
    if (isWritersLocked) return;
    setShowChildrenDropdown(!showChildrenDropdown);
    if (!showChildrenDropdown) {
      setChildrenSearchTerm('');
    }
  };

  // Filter available tasks based on search term
  const filteredAvailableChildren = (Array.isArray(availableTasksForChildren) ? availableTasksForChildren : []).filter(task => 
    task.ticket.toLowerCase().includes(childrenSearchTerm.toLowerCase()) ||
    task.title.toLowerCase().includes(childrenSearchTerm.toLowerCase())
  );

  const handleAddComment = async (content: string, attachments: File[] = []) => {
    if (commentsLocked) return;
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

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

      // Find the member corresponding to the current user
      const currentUserMember = members.find(m => m.user_id === currentUser?.id);
      
      // Create new comment with attachments
      const newComment = {
        id: generateUUID(),
        text: content,
        authorId: currentUserMember?.id || editedTask.memberId || members[0].id,
        createdAt: getLocalISOString(new Date()),
        taskId: editedTask.id,
        attachments: uploadedAttachments
      };

      detailsLog('Sending comment to backend:', newComment);

      // Save comment to server
      const savedComment = await createComment(newComment);

      // Update commentAttachments state with new attachments
      if (uploadedAttachments.length > 0) {
        setCommentAttachments(prev => ({
          ...prev,
          [savedComment.id]: uploadedAttachments
        }));
      }

      // Update task with new comment
      const updatedTask = {
        ...editedTask,
        comments: [...(editedTask.comments || []), savedComment]
      };

      // Update local state immediately (comments already persisted via createComment)
      setEditedTask(updatedTask);
      
      // Refresh parent TaskCard without a full task PATCH
      if (onUpdate) {
        onUpdate(updatedTask, { localOnly: true });
      }

    } catch (error) {
      console.error('Failed to add comment:', error);
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper function to check if user can edit/delete a comment
  const canModifyComment = (comment: Comment): boolean => {
    if (!currentUser) return false;
    
    // Admin can modify any comment
    if (currentUser.roles?.includes('admin')) return true;
    
    // User can modify their own comments
    const currentMember = members.find(m => m.user_id === currentUser.id);
    return currentMember?.id === comment.authorId;
  };

  const handleDeleteComment = async (commentId: string) => {
    if (isSubmitting) return;

    // Find the comment to check permissions
    const comment = editedTask.comments?.find(c => c.id === commentId);
    if (!comment || !canModifyComment(comment)) {
      console.error('Unauthorized: Cannot delete this comment');
      return;
    }

    try {
      setIsSubmitting(true);

      // Delete comment from server (comments are not persisted via task PATCH)
      await deleteComment(commentId);

      // Remove comment from local state
      const updatedComments = editedTask.comments?.filter(c => c.id !== commentId) || [];
      
      const updatedTask = {
        ...editedTask,
        comments: updatedComments
      };

      setEditedTask(updatedTask);
      
      // Remove attachments for the deleted comment from local state
      setCommentAttachments(prevAttachments => {
        const newAttachments = { ...prevAttachments };
        delete newAttachments[commentId];
        return newAttachments;
      });

      // Refresh parent TaskCard without a full task PATCH
      if (onUpdate) {
        await onUpdate(updatedTask, { localOnly: true });
      }

    } catch (error) {
      console.error('Failed to delete comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.text);
  };


  const handleSaveEditCommentWithContent = async (content: string) => {
    if (!editingCommentId || !content.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);

      // Update comment on server
      await updateComment(editingCommentId, content.trim());

      // Update local state
      const updatedComments = editedTask.comments?.map(comment => 
        comment.id === editingCommentId 
          ? { ...comment, text: content.trim() }
          : comment
      ) || [];
      
      const updatedTask = { ...editedTask, comments: updatedComments };
      setEditedTask(updatedTask);

      // Refresh parent TaskCard without a full task PATCH
      if (onUpdate) {
        await onUpdate(updatedTask, { localOnly: true });
      }

      // Clear editing state
      setEditingCommentId(null);
      setEditingCommentText('');

    } catch (error) {
      console.error('Failed to update comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentText('');
  };

  // Scroll to comments when requested (e.g., from TaskCard tooltip)
  useEffect(() => {
    if (scrollToComments && commentsRef.current) {
      // Small delay to ensure the component is fully rendered
      setTimeout(() => {
        commentsRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
      }, 100);
    }
  }, [task.id, scrollToComments]);

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

  // Ensure we have valid member IDs
  const validMemberId = members.some(m => m.id === editedTask.memberId)
    ? editedTask.memberId
    : members[0]?.id || '';
    
  const validRequesterId = members.some(m => m.id === editedTask.requesterId)
    ? editedTask.requesterId
    : members[0]?.id || '';

  // Update the date formatting utility
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return `${new Intl.DateTimeFormat('default', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date).replace(/\//g, '-')} ${new Intl.DateTimeFormat('default', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date)}`;
  };

  // Add effect to fetch attachments when comments change
  useEffect(() => {
    const fetchAttachments = async () => {
      const attachmentsMap: Record<string, Attachment[]> = {};
      
      // Only fetch for valid comments
      const validComments = (editedTask.comments || []).filter(
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
  }, [editedTask.comments]);

  // Handle saving pending attachments using the new utility
  // Defined early so it can be used in useEffect dependency array
  const savePendingAttachments = useCallback(async () => {
    if (pendingAttachments.length === 0 || isUploadingRef.current) return;
    
    isUploadingRef.current = true;
    try {
      detailsLog('📎 Uploading', pendingAttachments.length, 'task attachments...');
      
      // Use the new upload utility
      const uploadedAttachments = await uploadTaskFiles(task.id, {
        currentTaskAttachments: taskAttachmentsRef.current,
        currentDescription: editedTaskRef.current.description,
        onTaskAttachmentsUpdate: (updatedAttachments) => {
          detailsLog('🔄 Updating taskAttachments with:', updatedAttachments.length, 'attachments');
          setTaskAttachments(updatedAttachments);
          
          // Update parent component immediately with new attachment count
          const updatedTask = { 
            ...editedTask, 
            attachmentCount: updatedAttachments.length 
          };
          setEditedTask(updatedTask);
          onUpdate(updatedTask);
        },
        onDescriptionUpdate: (updatedDescription) => {
          detailsLog('🔄 Updating task description with server URLs');
          const updatedTask = { ...editedTask, description: updatedDescription };
          setEditedTask(updatedTask);
          saveImmediately(updatedTask);
        },
        onSuccess: (attachments) => {
          detailsLog('✅ Task attachments saved successfully:', attachments.length, 'files');
          // Clear pending attachments on success
          clearFiles();
        },
        onError: (error) => {
          // uploadError is set by useFileUpload; UI rollback + toast happen in catch
          console.error('❌ Failed to upload task attachments:', error);
        }
      });
      
      detailsLog('📎 Task attachment upload completed, got:', uploadedAttachments.length, 'attachments');
    } catch (error: any) {
      console.error('❌ Failed to save task attachments:', error);
      const failedNames = pendingAttachments.map((f) => f.name);
      const errorMessage = getUploadErrorMessage(error);
      clearFiles({ keepError: true });
      (window as any).textEditorDiscardPendingAttachments?.(failedNames);
      toast.error(errorMessage, '');
    } finally {
      isUploadingRef.current = false;
    }
  }, [pendingAttachments, task.id, uploadTaskFiles, onUpdate, saveImmediately, clearFiles]);

  // Save attachments immediately to prevent blob URL issues
  React.useEffect(() => {
    if (pendingAttachments.length > 0) {
      savePendingAttachments();
    }
  }, [pendingAttachments.length, savePendingAttachments]);

  // Update editedTask with current attachment count whenever taskAttachments changes
  React.useEffect(() => {
    if (taskAttachments.length !== editedTask.attachmentCount) {
      setEditedTask(prev => ({
        ...prev,
        attachmentCount: taskAttachments.length
      }));
    }
  }, [taskAttachments.length, editedTask.attachmentCount]);

  // Handle attachment changes from TextEditor
  const handleAttachmentsChange = (attachments: File[]) => {
    // TextEditor passes only NEW attachments, so just add them
    // Don't clear first - that would cause a race condition with the useEffect
    addFiles(attachments);
  };

  // Handle immediate attachment deletion
  const handleAttachmentDelete = async (attachmentId: string) => {
    try {
      await deleteAttachment(attachmentId);
      
      // Find the attachment to get its filename
      const attachmentToDelete = taskAttachments.find(att => att.id === attachmentId) || 
                                 displayAttachments.find(att => att.id === attachmentId);
      
      if (attachmentToDelete) {
        // Remove from ALL local state (just like image X button does)
        setTaskAttachments(prev => prev.filter(att => att.id !== attachmentId && att.name !== attachmentToDelete.name));
        // Note: pendingAttachments are managed by the hook, no need to manually filter
      } else {
        // Fallback: just remove by ID
        setTaskAttachments(prev => prev.filter(att => att.id !== attachmentId));
      }
      
      // Update parent component immediately with new attachment count
      const updatedTask = { 
        ...editedTask, 
        attachmentCount: taskAttachments.length - 1 
      };
      setEditedTask(updatedTask);
      onUpdate(updatedTask);
    } catch (error) {
      console.error('❌ Failed to delete attachment:', error);
      throw error; // Re-throw to let TextEditor handle the error
    }
  };

  // Handle image removal from TextEditor - remove from server if saved, clean local state
  const handleImageRemoval = async (filename: string) => {
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
        const freshAttachments = await fetchTaskAttachments(task.id);
        const freshServerAttachment = freshAttachments.find(att => att.name === filename);
        
        if (freshServerAttachment) {
          await deleteAttachment(freshServerAttachment.id);
        }
      } catch (error) {
        console.error('Failed to fetch/delete fresh attachment:', error);
      }
    }
    
    // Remove from ALL local state immediately
    // Note: pendingAttachments are managed by the hook, no need to manually filter
    setTaskAttachments(prev => prev.filter(att => att.name !== filename));
    
    // Update parent component immediately with new attachment count
    const updatedTask = { 
      ...editedTask, 
      attachmentCount: taskAttachments.length - 1 
    };
    setEditedTask(updatedTask);
    onUpdate(updatedTask);
    
    // Clear the recently deleted flag after a longer delay
    setTimeout(() => {
      recentlyDeletedAttachmentsRef.current.delete(filename);
    }, 5000); // 5 seconds should be enough for any polling cycles
  };

  // Only show saved attachments - no pending ones to avoid state sync issues
  const displayAttachments = React.useMemo(() => taskAttachments, [taskAttachments]);

  return (
    <>
    {isCompactViewport && (
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50 border-0 cursor-default"
        aria-label={t('buttons.close', { ns: 'common' })}
        onClick={onClose}
      />
    )}
    <div
      ref={detailsPanelRef}
      className="fixed right-0 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex z-50 shadow-xl lg:shadow-none overflow-x-hidden"
      style={{ 
        width: `${panelWidth}px`,
        maxWidth: '100vw',
        top: '65px', // Position below header (adjusted for proper clearance)
        height: 'calc(100vh - 65px)' // Full height minus header
      }}
      data-task-details
      data-readonly={isReadOnlyMode ? 'true' : undefined}
    >
      {/* Professional Resize Handle */}
      <div
        ref={resizeRef}
        className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize group transition-all duration-200 z-50 ${
          isResizing 
            ? 'bg-blue-500 shadow-md' 
            : 'bg-gray-50 hover:bg-blue-400'
        }`}
        onMouseDown={handleMouseDown}
        title="Drag to resize panel"
      >
        {/* Extended hit area for easier grabbing */}
        <div className="absolute inset-y-0 left-0 w-4 -translate-x-2" />
        
        {/* Visual grip dots */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center space-y-1">
            <div className={`w-1 h-1 rounded-full transition-all duration-200 ${
              isResizing 
                ? 'bg-white' 
                : 'bg-gray-400 group-hover:bg-white'
            }`} />
            <div className={`w-1 h-1 rounded-full transition-all duration-200 ${
              isResizing 
                ? 'bg-white' 
                : 'bg-gray-400 group-hover:bg-white'
            }`} />
            <div className={`w-1 h-1 rounded-full transition-all duration-200 ${
              isResizing 
                ? 'bg-white' 
                : 'bg-gray-400 group-hover:bg-white'
            }`} />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden pl-2">
        {/* Scrollable Container */}
        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {/* Sticky Title Section */}
          <div className="bg-white dark:bg-gray-800 sticky top-0 z-10 shadow-sm">
            <div className="p-3">
              <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
                {/* Title — takes remaining width */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {isAgentAssigned && !isReadOnlyMode && (
                    <AgentStatusButton
                      status={agentStatus}
                      iconSize={18}
                      className="flex-shrink-0 p-1.5 rounded hover:bg-teal-100 dark:hover:bg-teal-900/40"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAgentWorkingModal();
                      }}
                    />
                  )}
                  <input
                    type="text"
                    value={editedTask.title}
                    onChange={e => handleTextUpdate('title', e.target.value)}
                    className={`text-xl font-semibold w-full min-w-0 border-none focus:outline-none focus:ring-0 p-3 rounded text-gray-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed ${
                      isReadOnlyMode
                        ? 'bg-amber-50/80 dark:bg-amber-950/30'
                        : 'bg-gray-50 dark:bg-gray-700'
                    }`}
                    disabled={isSubmitting || isWritersLocked}
                    readOnly={isReadOnlyMode}
                    title={
                      isWritersLocked
                        ? isReadOnlyMode
                          ? t('trash.readOnlyHint')
                          : t('toolbar.disabledWhileAgent')
                        : undefined
                    }
                  />
                </div>
                
                {/* Ticket + close on top; Restore / Delete forever under the ticket */}
                <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                  <div className="flex items-center gap-2">
                    {isReadOnlyMode && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                        <Trash2 size={11} aria-hidden />
                        {t('trash.readOnlyBadge')}
                      </span>
                    )}
                    {task.ticket && (
                      <a 
                        href={generateTaskUrl(task.ticket, getProjectIdentifier())}
                        className="font-mono text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        title={`Direct link to ${task.ticket}`}
                      >
                        {task.ticket}
                      </a>
                    )}
                    {isSavingText && !isReadOnlyMode && (
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                        Auto-saving...
                      </div>
                    )}
                    <button
                      onClick={async () => {
                        if (!isReadOnlyMode) await saveChanges();
                        onClose();
                      }}
                      className="flex-shrink-0 text-gray-500 hover:text-gray-700"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  {isReadOnlyMode && (onRestore || (isAdmin && onPurge)) && (
                    <div className="flex justify-end gap-1">
                      {onRestore && (
                        <button
                          type="button"
                          disabled={lifecycleBusy}
                          onClick={async () => {
                            setLifecycleBusy(true);
                            try {
                              await onRestore();
                            } finally {
                              setLifecycleBusy(false);
                            }
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                          title={t('trash.restore')}
                          aria-label={t('trash.restore')}
                        >
                          <RotateCcw size={16} className={lifecycleBusy ? 'animate-spin' : ''} />
                        </button>
                      )}
                      {isAdmin && onPurge && (
                        <button
                          type="button"
                          disabled={lifecycleBusy}
                          onClick={async () => {
                            if (!window.confirm(t('trash.purgeConfirm'))) return;
                            setLifecycleBusy(true);
                            try {
                              await onPurge();
                            } finally {
                              setLifecycleBusy(false);
                            }
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          title={t('trash.purge')}
                          aria-label={t('trash.purge')}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Separator line - part of sticky section */}
            <div className="border-t border-gray-200"></div>
          </div>

          {/* Scrollable Content */}
          <div className="p-6 pt-6">
            
            <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                {t('labels.description')}
              </label>
              <TextEditor
                onSubmit={async () => {
                  if (isWritersLocked) return;
                  // Save pending attachments when submit is triggered
                  await savePendingAttachments();
                }}
                onChange={(content) => {
                  if (isWritersLocked) return;
                  handleTextUpdate('description', content);
                }}
                onAttachmentsChange={isWritersLocked ? undefined : handleAttachmentsChange}
                onAttachmentDelete={isWritersLocked ? undefined : handleAttachmentDelete}
                onImageRemovalNeeded={isWritersLocked ? undefined : handleImageRemoval}
                initialContent={editedTask.description}
                placeholder={t('placeholders.enterDescription')}
                minHeight="120px"
                showSubmitButtons={false}
                showAttachments={true}
                attachmentContext="task"
                attachmentParentId={task.id}
                existingAttachments={taskAttachments}
                toolbarOptions={{
                  bold: true,
                  italic: true,
                  underline: true,
                  link: true,
                  lists: true,
                  alignment: false,
                  attachments: !isWritersLocked
                }}
                allowImagePaste={!isWritersLocked}
                allowImageDelete={!isWritersLocked}
                allowImageResize={!isWritersLocked}
                showToolbar={!isWritersLocked}
                editable={!isWritersLocked}
                className="w-full"
              />
              
              {/* Upload error display for task attachments */}
              {uploadError && (
                <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {t('errors.uploadError')}: {uploadError}
                  </div>
                </div>
              )}
            </div>


            <div className="grid grid-cols-2 gap-4">
              <div>
                <MemberPicker
                  label={t('labels.assignedTo')}
                  members={members}
                  value={validMemberId}
                  onChange={(memberId) => handleUpdate({ memberId })}
                  mode="single"
                  disabled={isSubmitting || isWritersLocked}
                />
              </div>

              <div>
                <MemberPicker
                  label={t('labels.requester')}
                  members={members}
                  value={validRequesterId}
                  onChange={(memberId) => handleUpdate({ requesterId: memberId })}
                  mode="single"
                  showAgentSection={false}
                  disabled={isSubmitting || isWritersLocked}
                />
              </div>
            </div>

            {/* Watchers and Collaborators Section - Side by Side */}
            <div className="grid grid-cols-2 gap-4">
              {/* Watchers Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('labels.watchers')}
                </label>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {taskWatchers.map((watcher) => (
                      <span
                        key={watcher.id}
                        className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
                      >
                        <MemberAvatar memberId={watcher.id} members={members} size="xs" />
                        <span className="max-w-[7rem] truncate">{truncateMemberName(watcher.name)}</span>
                        {!isWritersLocked && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => toggleWatcher(watcher)}
                          className="ml-0.5 h-4 w-4 rounded-full bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 flex items-center justify-center text-blue-700 dark:text-blue-200 disabled:opacity-50"
                          aria-label={t('remove.watcher')}
                          title={t('remove.watcher')}
                        >
                          ×
                        </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {isWritersLocked ? (
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
                    disabled={isSubmitting}
                    onChange={(memberId) => {
                      const member = members.find((m) => m.id === memberId);
                      if (member) toggleWatcher(member);
                    }}
                  />
                  )}
                </div>
              </div>

              {/* Collaborators Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('labels.collaborators')}
                </label>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {taskCollaborators.map((collaborator) => (
                      <span
                        key={collaborator.id}
                        className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800"
                      >
                        <MemberAvatar memberId={collaborator.id} members={members} size="xs" />
                        <span className="max-w-[7rem] truncate">{truncateMemberName(collaborator.name)}</span>
                        {!isWritersLocked && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => toggleCollaborator(collaborator)}
                          className="ml-0.5 h-4 w-4 rounded-full bg-emerald-100 dark:bg-emerald-900 hover:bg-emerald-200 dark:hover:bg-emerald-800 flex items-center justify-center disabled:opacity-50"
                          aria-label={t('remove.collaborator')}
                          title={t('remove.collaborator')}
                        >
                          ×
                        </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {isWritersLocked ? (
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
                    disabled={isSubmitting}
                    onChange={(memberId) => {
                      const member = members.find((m) => m.id === memberId);
                      if (member) toggleCollaborator(member);
                    }}
                  />
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('labels.startDate')}
                </label>
                <input
                  type="date"
                  value={localStartDate}
                  onChange={e => setLocalStartDate(e.target.value)}
                  onBlur={e => handleUpdate({ startDate: e.target.value })}
                  readOnly={isSubmitting || isWritersLocked}
                  tabIndex={isSubmitting || isWritersLocked ? -1 : undefined}
                  className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 ${
                    isSubmitting || isWritersLocked ? 'cursor-default pointer-events-none' : ''
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('labels.dueDate')}
                </label>
                <input
                  type="date"
                  value={localDueDate}
                  onChange={e => setLocalDueDate(e.target.value)}
                  onBlur={e => handleUpdate({ dueDate: e.target.value })}
                  readOnly={isSubmitting || isWritersLocked}
                  tabIndex={isSubmitting || isWritersLocked ? -1 : undefined}
                  className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 ${
                    isSubmitting || isWritersLocked ? 'cursor-default pointer-events-none' : ''
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {parseEffortUnit(siteSettings) === 'points' ? t('labels.effortPoints') : t('labels.effortHours')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={effortDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d{0,4}$/.test(v)) {
                      setEffortDraft(v);
                    }
                  }}
                  onFocus={(e) => {
                    if (!(isSubmitting || isWritersLocked)) e.currentTarget.select();
                  }}
                  onBlur={() => {
                    const trimmed = effortDraft.trim();
                    const n = trimmed === '' ? 0 : parseInt(trimmed, 10);
                    const effort = Number.isFinite(n) && n >= 0 ? Math.min(n, 9999) : 0;
                    setEffortDraft(String(effort));
                    if (effort !== editedTask.effort) {
                      handleUpdate({ effort });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  readOnly={isSubmitting || isWritersLocked}
                  tabIndex={isSubmitting || isWritersLocked ? -1 : undefined}
                  className={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 ${
                    isSubmitting || isWritersLocked ? 'cursor-default' : ''
                  }`}
                />
              </div>

              <div className="col-span-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {t('labels.blocked')}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('labels.blockedHint')}
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={Boolean(editedTask.isBlocked)}
                      disabled={isSubmitting || isWritersLocked}
                      onChange={(e) =>
                        handleUpdate({
                          isBlocked: e.target.checked,
                          blockedReason: e.target.checked ? editedTask.blockedReason || null : null,
                        })
                      }
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600" />
                  </label>
                </div>
                {editedTask.isBlocked && (
                  <input
                    type="text"
                    value={editedTask.blockedReason || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEditedTask((prev) => ({ ...prev, blockedReason: value }));
                      if (blockedReasonSaveTimeoutRef.current) {
                        clearTimeout(blockedReasonSaveTimeoutRef.current);
                      }
                      blockedReasonSaveTimeoutRef.current = setTimeout(() => {
                        void handleUpdate({
                          isBlocked: true,
                          blockedReason: value.trim() || null,
                        });
                      }, 500);
                    }}
                    onBlur={(e) => {
                      if (blockedReasonSaveTimeoutRef.current) {
                        clearTimeout(blockedReasonSaveTimeoutRef.current);
                        blockedReasonSaveTimeoutRef.current = null;
                      }
                      void handleUpdate({
                        isBlocked: true,
                        blockedReason: e.target.value.trim() || null,
                      });
                    }}
                    placeholder={t('labels.blockedReasonPlaceholder')}
                    className="mt-2 w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-sm"
                    disabled={isSubmitting || isWritersLocked}
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('labels.priority')}
                </label>
                {isWritersLocked || isSubmitting ? (
                  <div
                    className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 cursor-default"
                    aria-readonly="true"
                  >
                    {editedTask.priorityId
                      ? availablePriorities.find((p) => p.id === editedTask.priorityId)?.priority ||
                        t('taskPage.noPriority')
                      : t('taskPage.noPriority')}
                  </div>
                ) : (
                <select
                  value={editedTask.priorityId || ''}
                  onChange={e => {
                    const priorityId = e.target.value ? parseInt(e.target.value) : null;
                    const priority = priorityId ? availablePriorities.find(p => p.id === priorityId) : null;
                    handleUpdate({ 
                      priorityId: priorityId,
                      priority: priority?.priority || null 
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                >
                  <option value="">{t('taskPage.noPriority')}</option>
                  {availablePriorities.map(priority => (
                    <option key={priority.id} value={priority.id}>
                      {priority.priority}
                    </option>
                  ))}
                </select>
                )}
              </div>
            </div>

            {/* Tags Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">{t('labels.tags')}</label>
              <div className="relative" ref={tagsDropdownRef}>
                {isWritersLocked || isSubmitting ? (
                  <div
                    className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm flex items-center text-gray-900 dark:text-gray-100 cursor-default"
                    aria-readonly="true"
                  >
                    <span className={taskTags.length === 0 ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200'}>
                      {taskTags.length === 0
                        ? t('taskPage.noTagsAssigned')
                        : `${taskTags.length} ${taskTags.length !== 1 ? t('tag.plural') : t('tag.singular')} ${t('tag.selected')}`}
                    </span>
                  </div>
                ) : (
                <button
                  ref={tagsButtonRef}
                  type="button"
                  onClick={handleTagsDropdownToggle}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between text-gray-900 dark:text-gray-100"
                >
                  <span className="text-gray-700 dark:text-gray-200">
                    {taskTags.length === 0 
                      ? t('labels.selectTags')
                      : `${taskTags.length} ${taskTags.length !== 1 ? t('tag.plural') : t('tag.singular')} ${t('tag.selected')}`
                    }
                  </span>
                  <ChevronDown size={14} className="text-gray-400" />
                </button>
                )}
                
                {showTagsDropdown && (
                  <div className={`absolute left-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-10 w-full max-h-[400px] overflow-y-auto ${
                    tagsDropdownPosition === 'above' 
                      ? 'bottom-full mb-1' 
                      : 'top-full mt-1'
                  }`}>
                    {/* Add Tag Button */}
                    <div 
                      onClick={() => {
                        setShowAddTagModal(true);
                        setShowTagsDropdown(false);
                      }}
                      className="px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer flex items-center gap-2 text-sm border-b border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 font-medium sticky top-0 bg-white dark:bg-gray-800"
                    >
                      <Plus size={14} />
                      <span>{t('labels.addNewTag')}</span>
                    </div>
                    
                    {isLoadingTags ? (
                      <div className="px-3 py-2 text-sm text-gray-500">{t('labels.loadingTags')}</div>
                    ) : availableTags.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">{t('labels.noTagsAvailable')}</div>
                    ) : (
                      availableTags.map(tag => (
                        <div
                          key={tag.id}
                          onClick={() => toggleTag(tag)}
                          className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-sm"
                        >
                          <div className="w-4 h-4 flex items-center justify-center">
                            {taskTags.some(t => t.id === tag.id) && (
                              <Check size={12} className="text-blue-600" />
                            )}
                          </div>
                          <div 
                            className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-300"
                            style={{ backgroundColor: tag.color || '#4ECDC4' }}
                          />
                          <span className="text-gray-700 dark:text-gray-200">{tag.tag}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              
              {/* Selected Tags Display */}
              {taskTags.length > 0 && (() => {
                // Merge task tags with live tag data to get updated colors
                const liveTags = mergeTaskTagsWithLiveData(taskTags, availableTags);
                
                return (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {liveTags.map(tag => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full font-medium hover:opacity-80 transition-opacity"
                        style={getTagDisplayStyle(tag)}
                    >
                      {tag.tag}
                      {!isWritersLocked && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleTag(tag);
                        }}
                        className="ml-1 hover:bg-red-500 hover:text-white rounded-full w-3 h-3 flex items-center justify-center text-xs font-bold transition-colors"
                        title={t('taskPage.removeTag', { defaultValue: 'Remove tag' })}
                      >
                        ×
                      </button>
                      )}
                    </span>
                  ))}
                </div>
                );
              })()}
            </div>
            
            {/* Task Relationships Section */}
            <div className="mt-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Parent Field - Left Side */}
                {parentTask && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">{t('relationships.parent')}</label>
                    <span 
                      onClick={() => {
                        const url = generateTaskUrl(parentTask.ticket, parentTask.projectId);
                        detailsLog('🔗 TaskDetails Parent URL:', { 
                          ticket: parentTask.ticket, 
                          projectId: parentTask.projectId, 
                          generatedUrl: url 
                        });
                        // Extract just the hash part for navigation
                        const hashPart = url.split('#').slice(1).join('#');
                        window.location.hash = hashPart;
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                      title={`${t('relationships.goToParent')} ${parentTask.ticket}`}
                    >
                      {parentTask.ticket}
                    </span>
                  </div>
                )}
                
                {/* Children Field - Right Side */}
                <div className={parentTask ? '' : 'col-span-2'}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">{t('relationships.children')}</label>
                  
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
                                detailsLog('🔗 TaskDetails Child URL:', { 
                                  ticket: child.ticket, 
                                  projectId: child.projectId, 
                                  generatedUrl: url 
                                });
                                // Extract just the hash part for navigation
                                const hashPart = url.split('#').slice(1).join('#');
                                window.location.hash = hashPart;
                              }}
                              className="text-blue-900 dark:text-blue-100 hover:text-blue-700 dark:hover:text-white hover:underline cursor-pointer transition-colors"
                              title={`${t('relationships.goToChild')} ${child.ticket}`}
                            >
                              {child.ticket}
                            </span>
                          {!isWritersLocked && (
                          <button
                            type="button"
                            onClick={() => handleRemoveChildTask(child.id)}
                            className="ml-1 text-blue-700 dark:text-blue-200 hover:bg-red-500 hover:text-white rounded-full w-3 h-3 flex items-center justify-center text-xs font-bold transition-colors"
                            title={t('relationships.removeChild')}
                          >
                            ×
                          </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {/* Children Dropdown */}
                  {!isWritersLocked && (
                  <div className="relative" ref={childrenDropdownRef}>
                    <button
                      type="button"
                      onClick={handleChildrenDropdownToggle}
                      className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between text-gray-900 dark:text-gray-100"
                    >
                      <span className="text-gray-700 dark:text-gray-200">
                        {t('relationships.addChildTask')}
                      </span>
                      <ChevronDown size={16} className={`transform transition-transform ${showChildrenDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showChildrenDropdown && (
                      <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto">
                        {/* Search Input */}
                        <div className="p-2 border-b border-gray-200 dark:border-gray-600">
                          <input
                            type="text"
                            placeholder={t('relationships.searchTasks')}
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
                              {childrenSearchTerm ? 'No tasks found matching your search' : 'No available tasks'}
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
        </div>

        <div ref={commentsRef} className="p-6 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              {t('taskCard.comments', { count: sortedComments.length })}
            </h3>
            {showRefreshIndicator && (
              <div 
                className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full transition-all duration-300 ease-in-out"
                style={{
                  animation: 'fadeIn 0.3s ease-in-out'
                }}
              >
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Comments updated
              </div>
            )}
          </div>
          <div className="mb-4">
            {!commentsLocked && (
            <TextEditor 
              onSubmit={handleAddComment}
              onCancel={() => {
                // The TextEditor handles clearing its own content and attachments
                // No additional action needed here
              }}
              placeholder={t('comments.addComment')}
              showAttachments={true}
              submitButtonText={t('actions.addComment')}
              cancelButtonText={t('buttons.cancel', { ns: 'common' })}
              toolbarOptions={{
                bold: true,
                italic: true,
                underline: true,
                link: true,
                lists: true,
                alignment: false,
                attachments: true
              }}
              allowImagePaste={true}
              allowImageDelete={true}
              allowImageResize={true}
            />
            )}
            {commentsLocked && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('trash.readOnlyHint')}</p>
            )}
          </div>

          <div className="space-y-6">
            {sortedComments.map(comment => {
              const author = members.find(m => m.id === comment.authorId);
              if (!author) return null;

              const attachments = commentAttachments[comment.id] || [];

              // Fix blob URLs in comment text by replacing them with authenticated server URLs
              const fixImageUrls = (htmlContent: string, attachments: Attachment[]) => {
                let fixedContent = htmlContent;
                attachments.forEach(attachment => {
                  if (attachment.name.startsWith('img-')) {
                    // Replace blob URLs with authenticated server URLs
                    const blobPattern = new RegExp(`blob:[^"]*#${attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
                    const authenticatedUrl = getAuthenticatedAttachmentUrl(attachment.url);
                    fixedContent = fixedContent.replace(blobPattern, authenticatedUrl || attachment.url);
                  }
                });
                return fixedContent;
              };

              const displayContent = fixImageUrls(
                commentTextToHtml(comment.text),
                attachments
              );

              return (
                <div key={comment.id} className="border-b border-gray-200 pb-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {author.googleAvatarUrl || author.avatarUrl ? (
                        <img
                          src={getAuthenticatedAvatarUrl(
                            author.googleAvatarUrl || author.avatarUrl
                          )}
                          alt={author.name}
                          className="w-7 h-7 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                          style={{ backgroundColor: author.color }}
                        >
                          {author.id === SYSTEM_MEMBER_ID
                            ? '🤖'
                            : author.id === AGENT_MEMBER_ID
                              ? '✨'
                              : author.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium">{author.name}</span>
                      <span className="text-sm text-gray-500">
                        {formatToYYYYMMDDHHmmss(comment.createdAt)}
                      </span>
                    </div>
                    {canModifyComment(comment) && editingCommentId !== comment.id && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEditComment(comment)}
                          disabled={isSubmitting || commentsLocked}
                          className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-100 rounded-full transition-colors"
                          title={t('comments.editCommentTitle')}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteComment(comment.id)}
                          disabled={isSubmitting || commentsLocked}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 rounded-full transition-colors"
                          title={t('comments.deleteCommentTitle')}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  {editingCommentId === comment.id ? (
                    <TextEditor
                      initialContent={editingCommentText}
                      onSubmit={async (content: string) => {
                        setEditingCommentText(content);
                        await handleSaveEditCommentWithContent(content);
                      }}
                      onCancel={handleCancelEditComment}
                      placeholder={t('comments.editComment')}
                      showAttachments={true}
                      submitButtonText={t('comments.saveChanges')}
                      cancelButtonText={t('buttons.cancel', { ns: 'common' })}
                      existingAttachments={attachments}
                      onAttachmentDelete={async (attachmentId: string) => {
                        try {
                          // Find the attachment to get its name before deleting
                          const attachmentToDelete = attachments.find(att => att.id === attachmentId);
                          
                          // Delete from server
                          await deleteAttachment(attachmentId);
                          
                          // Remove from local commentAttachments state
                          setCommentAttachments(prev => ({
                            ...prev,
                            [comment.id]: prev[comment.id]?.filter(att => att.id !== attachmentId) || []
                          }));

                          // Also remove the image from the editor if it's an image attachment
                          if (attachmentToDelete && attachmentToDelete.name.startsWith('img-') && window.textEditorRemoveImage) {
                            window.textEditorRemoveImage(attachmentToDelete.name);
                          }
                        } catch (error) {
                          console.error('Failed to delete comment attachment:', error);
                          throw error;
                        }
                      }}
                      onImageRemovalNeeded={(attachmentName: string) => {
                        // Remove from local commentAttachments state by name
                        setCommentAttachments(prev => ({
                          ...prev,
                          [comment.id]: prev[comment.id]?.filter(att => att.name !== attachmentName) || []
                        }));
                      }}
                      attachmentContext="comment"
                      attachmentParentId={comment.id}
                      toolbarOptions={{
                        bold: true,
                        italic: true,
                        underline: true,
                        link: true,
                        lists: true,
                        alignment: false,
                        attachments: true
                      }}
                      allowImagePaste={true}
                      allowImageDelete={true}
                      allowImageResize={true}
                    />
                  ) : (
                    <div
                      className="prose prose-sm max-w-none comment-md"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(displayContent) }}
                    />
                  )}
                  {attachments.filter(att => !att.name.startsWith('img-')).length > 0 && (
                    <div className="mt-3 space-y-1">
                      {attachments.filter(att => !att.name.startsWith('img-')).map(attachment => (
                        <div
                          key={attachment.id}
                          className="flex items-center gap-2 text-sm text-gray-600"
                        >
                          <Paperclip size={14} />
                          <a
                            href={getAuthenticatedAttachmentUrl(attachment.url) || attachment.url}
                            {...(siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true' 
                              ? { target: '_blank', rel: 'noopener noreferrer' } 
                              : {})}
                            className="hover:text-blue-500"
                          >
                            {attachment.name}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      </div>
      
      {/* Add Tag Modal */}
      {showAddTagModal && (
        <AddTagModal
          onClose={() => setShowAddTagModal(false)}
          onTagCreated={handleTagCreated}
        />
      )}
      {showAgentPanel && (
        <AgentPanel
          panelId={task.id}
          taskTitle={editedTask.title}
          taskTicket={task.ticket}
          taskDescription={editedTask.description}
          work={agentWork}
          comments={agentModalComments}
          members={members}
          busy={agentControlBusy}
          isAdmin={Boolean(currentUser?.roles?.includes('admin'))}
          boards={(boards || []).map((b: { id: string; title?: string; name?: string }) => ({
            id: b.id,
            title: b.title || b.name || b.id,
          }))}
          view={agentPanelView}
          onViewChange={setAgentPanelView}
          restoreToken={agentPanelRestoreToken}
          onClose={() => {
            setShowAgentPanel(false);
            setAgentPanelView('activity');
          }}
          onControl={handleAgentControl}
          onUndo={handleAutomationUndo}
          onRefine={handleAgentRefine}
          onSaveConfig={handleAgentPanelSaveConfig}
          aiEnabled={siteSettings?.AI_ENABLED === 'true'}
          isAssigned={isAgentAssigned}
        />
      )}
    </div>
    </>
  );
}
