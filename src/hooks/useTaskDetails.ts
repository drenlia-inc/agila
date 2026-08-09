import { useState, useEffect, useRef, useCallback } from 'react';
import { Task, TeamMember, Comment, Attachment, Tag, PriorityOption, CurrentUser, TaskUpdateOptions } from '../types';
import { createComment, uploadFile, updateTask, deleteComment, updateComment, fetchCommentAttachments, getAllTags, getTaskTags, addTagToTask, removeTagFromTask, getAllPriorities, addWatcherToTask, removeWatcherFromTask, addCollaboratorToTask, removeCollaboratorFromTask, fetchTaskAttachments, addTaskAttachments, deleteAttachment } from '../api';
import { getLocalISOString, formatToYYYYMMDDHHmmss } from '../utils/dateUtils';
import { generateUUID } from '../utils/uuid';
import websocketClient from '../services/websocketClient';
import { getAuthenticatedAttachmentUrl } from '../utils/authImageUrl';
import { userCanMutate } from '../utils/permissions';

interface UseTaskDetailsProps {
  task: Task;
  members: TeamMember[];
  currentUser: CurrentUser | null;
  onUpdate: (updatedTask: Task, options?: TaskUpdateOptions) => void;
  siteSettings?: { [key: string]: string };
  boards?: any[];
  /** When false (viewer), task field/relationship writes are no-ops; comments still work. */
  canMutate?: boolean;
}

export const useTaskDetails = ({
  task,
  members,
  currentUser,
  onUpdate,
  siteSettings,
  boards,
  canMutate: canMutateProp,
}: UseTaskDetailsProps) => {
  const canMutate = canMutateProp ?? userCanMutate(currentUser);
  // Get project identifier from the board this task belongs to
  const getProjectIdentifier = () => {
    if (!boards || !task.boardId) return null;
    const board = boards.find(b => b.id === task.boardId);
    return board?.project || null;
  };

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
          ? comment.attachments.map(att => ({
              id: att.id,
              name: att.name,
              url: att.url,
              commentId: comment.id,
              size: att.size || 0,
              uploadedAt: att.uploadedAt || new Date().toISOString()
            }))
          : []
      }))
  }));

  const [hasChanges, setHasChanges] = useState(false);

  // Update editedTask when task prop changes (e.g., when data is loaded)
  useEffect(() => {
    if (!task.id) return;

    const normalizeComments = (comments: Comment[] | undefined) =>
      (comments || [])
        .map((comment: any) => ({
          id: comment.id,
          text: comment.text,
          authorId: comment.authorId || comment.authorid || comment.author_id,
          createdAt: comment.createdAt || comment.createdat || comment.created_at,
          taskId: task.id,
          attachments: Array.isArray(comment.attachments)
            ? comment.attachments.map((att: any) => ({
                id: att.id,
                name: att.name,
                url: att.url,
                commentId: comment.id,
                size: att.size || 0,
                uploadedAt: att.uploadedAt || new Date().toISOString()
              }))
            : []
        }))
        .filter(
          (comment) =>
            comment &&
            comment.id &&
            comment.text &&
            comment.authorId &&
            comment.createdAt
        );

    const nextComments = normalizeComments(task.comments as Comment[]);
    const taskIdChanged = task.id !== editedTask.id;
    const prevIds = (editedTask.comments || []).map((c) => c.id).sort().join(',');
    const nextIds = nextComments.map((c) => c.id).sort().join(',');
    const commentsChanged = prevIds !== nextIds;

    if (taskIdChanged || commentsChanged) {
      setEditedTask((prev) => ({
        ...(taskIdChanged ? task : prev),
        ...(!taskIdChanged
          ? {
              // Keep local edits for same task; refresh comments from server
              title: task.title ?? prev.title,
              description: task.description ?? prev.description,
              watchers: task.watchers ?? prev.watchers,
              collaborators: task.collaborators ?? prev.collaborators,
              tags: task.tags ?? prev.tags,
            }
          : {}),
        id: task.id,
        memberId: task.memberId || members[0]?.id || prev.memberId || '',
        requesterId: task.requesterId || members[0]?.id || prev.requesterId || '',
        comments: nextComments
      }));
      if (taskIdChanged) {
        setHasChanges(false);
      }
    }
  }, [task, members]);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [newComment, setNewComment] = useState('');
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editedCommentText, setEditedCommentText] = useState('');
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [availablePriorities, setAvailablePriorities] = useState<PriorityOption[]>([]);
  const [taskAttachments, setTaskAttachments] = useState<Attachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<{ file: File; tempId: string }[]>([]);
  const [commentAttachments, setCommentAttachments] = useState<{ [commentId: string]: Attachment[] }>({});
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [taskWatchers, setTaskWatchers] = useState<TeamMember[]>([]);
  const [taskCollaborators, setTaskCollaborators] = useState<TeamMember[]>([]);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<Task | null>(null);
  const editedTaskRef = useRef(editedTask);
  editedTaskRef.current = editedTask;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const canMutateRef = useRef(canMutate);
  canMutateRef.current = canMutate;

  // Immediate save — always persist the latest editedTaskRef snapshot
  const saveImmediately = useCallback(async (taskToSave?: Task) => {
    if (!canMutateRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const payload = taskToSave || editedTaskRef.current;
    if (!payload?.id) {
      console.error('Cannot save task: missing id');
      return;
    }

    try {
      isSavingRef.current = true;
      setIsSaving(true);
      const saved = await updateTask(payload);
      // Prefer server response when available; keep local description if response omits it
      const merged = {
        ...payload,
        ...(saved || {}),
        description: saved?.description ?? payload.description,
        title: saved?.title ?? payload.title,
      };
      editedTaskRef.current = merged;
      setEditedTask(merged);
      setLastSaved(new Date());
      onUpdateRef.current(merged);
      if (!pendingSaveRef.current) {
        setHasChanges(false);
      }
    } catch (error) {
      console.error('Error saving task:', error);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
      if (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        void saveImmediately(pending);
      }
    }
  }, []);

  // Debounced save — never drop updates when a save is already in flight
  const debouncedSave = useCallback((taskToSave: Task) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (isSavingRef.current) {
        pendingSaveRef.current = taskToSave;
        return;
      }
      void saveImmediately(taskToSave);
    }, 1000);
  }, [saveImmediately]);

  // Load task data (tags, priorities, attachments). Do NOT depend on description —
  // that would re-fetch on every keystroke and race autosave.
  const loadTaskData = useCallback(async () => {
    if (!task.id || task.id === '') {
      return;
    }

    try {
      const [allTags, taskTagsResponse] = await Promise.all([
        getAllTags(),
        getTaskTags(task.id)
      ]);
      setAvailableTags(allTags);
      setTaskTags(taskTagsResponse);

      const priorities = await getAllPriorities();
      setAvailablePriorities(priorities);

      const attachments = await fetchTaskAttachments(task.id);
      const filteredAttachments = attachments.filter((att: any) => att && att.id && att.name && att.url);
      setTaskAttachments(filteredAttachments);

      const currentTask = editedTaskRef.current;
      const currentDescription = currentTask.description;
      if (currentDescription && currentDescription.includes('blob:') && filteredAttachments.length > 0) {
        let fixedDescription = currentDescription;
        filteredAttachments.forEach(attachment => {
          if (attachment.name.startsWith('img-')) {
            const blobPattern = new RegExp(`blob:[^"]*#${attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
            const authenticatedUrl = getAuthenticatedAttachmentUrl(attachment.url);
            fixedDescription = fixedDescription.replace(blobPattern, authenticatedUrl || attachment.url);
          }
        });

        if (fixedDescription !== currentDescription) {
          const updatedTask = { ...currentTask, description: fixedDescription };
          setEditedTask(updatedTask);
          await saveImmediately(updatedTask);
        }
      }

      const commentAttachmentsMap: { [commentId: string]: Attachment[] } = {};
      for (const comment of currentTask.comments || []) {
        if (comment.id) {
          try {
            const commentAtts = await fetchCommentAttachments(comment.id);
            commentAttachmentsMap[comment.id] = commentAtts;
          } catch (error) {
            console.warn(`Failed to load attachments for comment ${comment.id}:`, error);
            commentAttachmentsMap[comment.id] = [];
          }
        }
      }
      setCommentAttachments(commentAttachmentsMap);
    } catch (error) {
      console.error('Error loading task data:', error);
    }
  }, [task.id, saveImmediately]);

  // Re-sync watchers/collaborators when the task identity or those lists change from the server
  useEffect(() => {
    if (!task.id) return;
    setTaskWatchers(task.watchers || []);
    setTaskCollaborators(task.collaborators || []);
  }, [task.id, task.watchers, task.collaborators]);

  // Handle task field updates
  const handleTaskUpdate = useCallback((updates: Partial<Task>) => {
    if (!canMutateRef.current) return;

    const normalizeRichText = (html: string | null | undefined) => {
      const trimmed = (html || '').trim();
      if (!trimmed || trimmed === '<p></p>' || trimmed === '<p><br></p>' || trimmed === '<p><br/></p>') {
        return '';
      }
      return trimmed;
    };

    const prev = editedTaskRef.current;
    const hasActualChange = (Object.keys(updates) as (keyof Task)[]).some((key) => {
      const next = updates[key];
      const current = prev[key];
      if (key === 'description') {
        return normalizeRichText(next as string) !== normalizeRichText(current as string);
      }
      if (next == null || next === '') {
        return !(current == null || current === '');
      }
      return next !== current;
    });

    if (!hasActualChange) {
      return;
    }

    const updatedTask = { ...prev, ...updates };
    editedTaskRef.current = updatedTask;
    setEditedTask(updatedTask);
    setHasChanges(true);
    debouncedSave(updatedTask);
  }, [debouncedSave]);

  // Handle attachment changes
  const handleAttachmentChange = useCallback((files: { file: File; tempId: string }[]) => {
    if (!canMutateRef.current) return;
    setPendingAttachments(files);
    
    if (files.length > 0) {
      // Save immediately when attachments are pending
      saveImmediately(editedTaskRef.current);
    }
  }, [saveImmediately]);

  // Handle image removal
  const handleImageRemoval = useCallback((filename: string) => {
    if (!canMutateRef.current) return;
    setPendingAttachments(prev => prev.filter(att => att.file.name !== filename));
    setTaskAttachments(prev => prev.filter(att => att.name !== filename));
  }, []);

  // Handle attachment deletion
  const handleAttachmentDelete = useCallback(async (attachment: Attachment) => {
    if (!canMutateRef.current) return;
    try {
      await deleteAttachment(attachment.id);
      
      // Remove from both arrays
      setPendingAttachments(prev => prev.filter(att => att.file.name !== attachment.name));
      setTaskAttachments(prev => prev.filter(att => att.id !== attachment.id));
    } catch (error) {
      console.error('Error deleting attachment:', error);
    }
  }, []);

  // Handle watcher operations
  const handleAddWatcher = useCallback(async (memberId: string) => {
    if (!canMutateRef.current) return;
    try {
      await addWatcherToTask(task.id, memberId);
      const member = members.find(m => m.id === memberId);
      if (member) {
        const newWatchers = [...taskWatchers, member];
        setTaskWatchers(newWatchers);
        
        // Update task and notify parent
        const updatedTask = { ...editedTask, watchers: newWatchers };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      }
    } catch (error) {
      console.error('Error adding watcher:', error);
      throw error;
    }
  }, [task.id, members, taskWatchers, editedTask, onUpdate]);

  const handleRemoveWatcher = useCallback(async (memberId: string) => {
    if (!canMutateRef.current) return;
    try {
      await removeWatcherFromTask(task.id, memberId);
      const newWatchers = taskWatchers.filter(w => w.id !== memberId);
      setTaskWatchers(newWatchers);
      
      // Update task and notify parent
      const updatedTask = { ...editedTask, watchers: newWatchers };
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
    } catch (error) {
      console.error('Error removing watcher:', error);
      throw error;
    }
  }, [task.id, taskWatchers, editedTask, onUpdate]);

  // Handle collaborator operations
  const handleAddCollaborator = useCallback(async (memberId: string) => {
    if (!canMutateRef.current) return;
    try {
      await addCollaboratorToTask(task.id, memberId);
      const member = members.find(m => m.id === memberId);
      if (member) {
        const newCollaborators = [...taskCollaborators, member];
        setTaskCollaborators(newCollaborators);
        
        // Update task and notify parent
        const updatedTask = { ...editedTask, collaborators: newCollaborators };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      }
    } catch (error) {
      console.error('Error adding collaborator:', error);
      throw error;
    }
  }, [task.id, members, taskCollaborators, editedTask, onUpdate]);

  const handleRemoveCollaborator = useCallback(async (memberId: string) => {
    if (!canMutateRef.current) return;
    try {
      await removeCollaboratorFromTask(task.id, memberId);
      const newCollaborators = taskCollaborators.filter(c => c.id !== memberId);
      setTaskCollaborators(newCollaborators);
      
      // Update task and notify parent
      const updatedTask = { ...editedTask, collaborators: newCollaborators };
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
    } catch (error) {
      console.error('Error removing collaborator:', error);
      throw error;
    }
  }, [task.id, taskCollaborators, editedTask, onUpdate]);

  // Handle tag operations
  const handleAddTag = useCallback(async (tagId: number) => {
    if (!canMutateRef.current) return;
    try {
      await addTagToTask(task.id, tagId);
      const tag = availableTags.find(t => t.id === tagId);
      if (tag) {
        const newTags = [...taskTags, tag];
        setTaskTags(newTags);
        
        // Update task and notify parent
        const updatedTask = { ...editedTask, tags: newTags };
        setEditedTask(updatedTask);
        onUpdate(updatedTask, { localOnly: true });
      }
    } catch (error) {
      console.error('Error adding tag:', error);
      throw error;
    }
  }, [task.id, availableTags, taskTags, editedTask, onUpdate]);

  const handleRemoveTag = useCallback(async (tagId: number) => {
    if (!canMutateRef.current) return;
    try {
      await removeTagFromTask(task.id, tagId);
      const newTags = taskTags.filter(t => t.id !== tagId);
      setTaskTags(newTags);
      
      // Update task and notify parent
      const updatedTask = { ...editedTask, tags: newTags };
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
    } catch (error) {
      console.error('Error removing tag:', error);
      throw error;
    }
  }, [task.id, taskTags, editedTask, onUpdate]);

  // Handle comment operations
  const handleDeleteComment = useCallback(async (commentId: string) => {
    try {
      await deleteComment(commentId);
      const newComments = (editedTask.comments || []).filter(c => c.id !== commentId);
      
      // Update task and notify parent
      const updatedTask = { ...editedTask, comments: newComments };
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
    } catch (error) {
      console.error('Error deleting comment:', error);
      throw error;
    }
  }, [editedTask, onUpdate]);

  const handleAddComment = useCallback(async (content: string, attachments: File[] = []) => {
    try {
      // Upload attachments first if any
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

      // Find the member corresponding to the current user
      const currentUserMember = members.find(m => m.user_id === currentUser?.id);
      
      // Create new comment with fixed content
      const newComment = {
        id: generateUUID(),
        text: finalContent,
        authorId: currentUserMember?.id || editedTask.memberId || members[0]?.id || '',
        createdAt: getLocalISOString(new Date()),
        taskId: editedTask.id,
        attachments: uploadedAttachments
      };

      // Save comment to server
      const savedComment = await createComment(newComment);

      // Update task with new comment
      const newComments = [...(editedTask.comments || []), savedComment];
      const updatedTask = { ...editedTask, comments: newComments };
      
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
      
      return savedComment;
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }, [editedTask, members, currentUser, onUpdate]);

  const handleUpdateComment = useCallback(async (commentId: string, content: string) => {
    try {
      // Update comment on server
      await updateComment(commentId, content.trim());

      // Update local state
      const updatedComments = (editedTask.comments || []).map(comment => 
        comment.id === commentId 
          ? { ...comment, text: content.trim() }
          : comment
      );
      
      const updatedTask = { ...editedTask, comments: updatedComments };
      setEditedTask(updatedTask);
      onUpdate(updatedTask, { localOnly: true });
    } catch (error) {
      console.error('Error updating comment:', error);
      throw error;
    }
  }, [editedTask, onUpdate]);

  // Upload attachments
  useEffect(() => {
    const uploadAttachments = async () => {
      if (pendingAttachments.length === 0 || isUploadingAttachments) return;

      try {
        setIsUploadingAttachments(true);
        
        const uploadPromises = pendingAttachments.map(({ file }) => uploadFile(file));
        const uploadedFiles = await Promise.all(uploadPromises);
        
        // Update description with server URLs
        let updatedDescription = editedTask.description;
        uploadedFiles.forEach((uploadedFile, index) => {
          const originalFile = pendingAttachments[index].file;
          if (originalFile.name.startsWith('img-') && updatedDescription) {
            const blobPattern = new RegExp(`blob:[^"]*#${originalFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
            updatedDescription = updatedDescription.replace(blobPattern, uploadedFile.url);
          }
        });
        
        if (updatedDescription !== editedTask.description) {
          setEditedTask(prev => ({ ...prev, description: updatedDescription }));
        }

        // Add uploaded attachments to task
        for (let i = 0; i < uploadedFiles.length; i++) {
          const uploadedFile = uploadedFiles[i];
          await addTaskAttachments(task.id, [uploadedFile.id]);
          setTaskAttachments(prev => [...prev, uploadedFile]);
        }

        // Clear pending attachments
        setPendingAttachments([]);
        
        // Save the updated task
        const finalTask = { ...editedTask, description: updatedDescription };
        await saveImmediately(finalTask);
        
      } catch (error) {
        console.error('Error uploading attachments:', error);
      } finally {
        setIsUploadingAttachments(false);
      }
    };

    uploadAttachments();
  }, [pendingAttachments, isUploadingAttachments, editedTask, task.id, saveImmediately]);

  // Load initial data
  useEffect(() => {
    loadTaskData();
  }, [loadTaskData]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    // Tag management event handlers
    const handleTagCreated = async (data: any) => {
      try {
        const tags = await getAllTags();
        setAvailableTags(tags);
      } catch (error) {
        console.error('Failed to refresh tags after creation:', error);
      }
    };

    const handleTagUpdated = async (data: any) => {
      try {
        const tags = await getAllTags();
        setAvailableTags(tags);
      } catch (error) {
        console.error('Failed to refresh tags after update:', error);
      }
    };

    const handleTagDeleted = async (data: any) => {
      try {
        const tags = await getAllTags();
        setAvailableTags(tags);
      } catch (error) {
        console.error('Failed to refresh tags after deletion:', error);
      }
    };

    // Priority management event handlers
    const handlePriorityCreated = async (data: any) => {
      try {
        const priorities = await getAllPriorities();
        setAvailablePriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after creation:', error);
      }
    };

    const handlePriorityUpdated = async (data: any) => {
      try {
        const priorities = await getAllPriorities();
        setAvailablePriorities(priorities);
      } catch (error) {
        console.error('Failed to refresh priorities after update:', error);
      }
    };

    const handlePriorityDeleted = async (data: any) => {
      // Just remove the deleted priority from the list - no need to refresh all priorities
      // The task-updated events will handle updating affected tasks with the new priority
      setAvailablePriorities(prevPriorities => 
        prevPriorities.filter(p => p.id !== data.priorityId && p.id !== Number(data.priorityId))
      );
    };

    const handlePriorityReordered = async (data: any) => {
      try {
        const priorities = await getAllPriorities();
        setAvailablePriorities(priorities);
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

    // Cleanup function
    return () => {
      websocketClient.offTagCreated(handleTagCreated);
      websocketClient.offTagUpdated(handleTagUpdated);
      websocketClient.offTagDeleted(handleTagDeleted);
      websocketClient.offPriorityCreated(handlePriorityCreated);
      websocketClient.offPriorityUpdated(handlePriorityUpdated);
      websocketClient.offPriorityDeleted(handlePriorityDeleted);
      websocketClient.offPriorityReordered(handlePriorityReordered);
    };
  }, []);

  return {
    editedTask,
    setEditedTask,
    hasChanges,
    isSaving,
    lastSaved,
    newComment,
    setNewComment,
    isAddingComment,
    setIsAddingComment,
    editingCommentId,
    setEditingCommentId,
    editedCommentText,
    setEditedCommentText,
    availableTags,
    taskTags,
    setTaskTags,
    taskWatchers,
    taskCollaborators,
    availablePriorities,
    taskAttachments,
    pendingAttachments,
    commentAttachments,
    isUploadingAttachments,
    getProjectIdentifier,
    handleTaskUpdate,
    handleAttachmentChange,
    handleImageRemoval,
    handleAttachmentDelete,
    handleAddWatcher,
    handleRemoveWatcher,
    handleAddCollaborator,
    handleRemoveCollaborator,
    handleAddTag,
    handleRemoveTag,
    handleAddComment,
    handleDeleteComment,
    handleUpdateComment,
    saveImmediately,
    loadTaskData
  };
};
