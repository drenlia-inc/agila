import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Clock, MessageCircle, Calendar, Paperclip, Pencil, Check, Ban, Plus } from 'lucide-react';
import { FirstLineEndAnchor } from './FirstLineEndAnchor';
import { ModernCheckbox } from './ModernCheckbox';
import { Task, TeamMember, Priority, PriorityOption, CurrentUser, Tag } from '../types';
import { TaskViewMode } from '../utils/userPreferences';
import TaskCardToolbar from './TaskCardToolbar';
import AddCommentModal from './AddCommentModal';
import DateRangePicker from './DateRangePicker';
import { formatToYYYYMMDD, formatToYYYYMMDDHHmmss, parseLocalDate } from '../utils/dateUtils';
import { getColumnAgeDays } from '../utils/kanbanFlowUtils';
import { getArchivedColumnId } from '../utils/columnUtils';
import { formatEffortDisplay, parseEffortUnit } from '../utils/taskUtils';
import type { TaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import { getTaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import {
  createComment,
  fetchTaskAttachments,
  putTaskWork,
  setTaskWorkControl,
  undoAutomationJob,
  getTaskWork,
  getTaskById,
  type TaskWorkMap
} from '../api';
import { generateTaskUrl } from '../utils/routingUtils';
import { generateUUID } from '../utils/uuid';
import { mergeTaskTagsWithLiveData, getTagDisplayStyle } from '../utils/tagUtils';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { getAuthenticatedAttachmentUrl } from '../utils/authImageUrl';
import { CSS } from '@dnd-kit/utilities';
import { setDndGloballyDisabled, isDndGloballyDisabled } from '../utils/globalDndState';
import DOMPurify from 'dompurify';
import TextEditor from './TextEditor';
import { KanbanChromeTooltip, CHROME_TOOLTIP_PANEL_SURFACE_CLASS, CHROME_TOOLTIP_SURFACE_CLASS } from './KanbanChromeTooltip';
import { getLinkTarget, shouldOpenLinkInNewTab } from '../utils/linkUtils';
import { feDebug } from '../utils/clientDebug';
import { commentTextToHtml } from '../utils/commentContent';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import {
  AGENT_MEMBER_ID,
  SYSTEM_MEMBER_ID,
  AGENT_DRAG_BLOCKING_STATUSES,
} from '../constants/appConstants';
import AgentPanel from './AgentPanel';
import type { AgentPanelView } from './AgentPanel';
import websocketClient from '../services/websocketClient';

function cardLog(...args: unknown[]) {
  if (feDebug('FE_DEBUG_TASK_CARD')) console.log(...args);
}

// Helper function to get priority colors from hex
const getPriorityColors = (hexColor: string) => {
  // Convert hex to RGB
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Create light background and use original color for text
  const bgColor = `rgb(${r}, ${g}, ${b}, 0.1)`; // 10% opacity background
  const textColor = hexColor; // Original color for text
  
  return {
    backgroundColor: bgColor,
    color: textColor
  };
};

interface TaskCardProps {
  task: Task;
  member: TeamMember;
  members: TeamMember[];
  currentUser?: CurrentUser | null;
  onRemove: (taskId: string, event?: React.MouseEvent) => void;
  onEdit: (task: Task) => void | Promise<void>;
  onCopy: (task: Task) => void;
  onDragStart: (task: Task) => void;
  onDragEnd: () => void;
  onSelect: (task: Task | null, options?: { scrollToComments?: boolean }) => void;
  isDragDisabled?: boolean;
  isColumnBeingDragged?: boolean; // Disable task droppable when column is being dragged
  taskViewMode?: TaskViewMode;
  availablePriorities?: PriorityOption[];
  selectedTask?: Task | null;
  availableTags?: Tag[];
  siteSettings?: { [key: string]: string };
  columnIsFinished?: boolean;
  columnIsArchived?: boolean;
  onTagAdd?: (tagId: string) => void;
  onTagRemove?: (tagId: string) => void;
  boards?: any[]; // To get project identifier from board
  columns?: { [key: string]: { id: string; title: string; is_archived?: boolean; is_finished?: boolean } };
  
  // Task linking props
  isLinkingMode?: boolean;
  linkingSourceTask?: Task | null;
  onStartLinking?: (task: Task, startPosition: {x: number, y: number}) => void;
  onFinishLinking?: (targetTask: Task | null, relationshipType?: 'parent' | 'child' | 'related') => Promise<void>;
  
  // Hover highlighting props
  hoveredLinkTask?: Task | null;
  onLinkToolHover?: (task: Task) => void;
  onLinkToolHoverEnd?: () => void;
  getTaskRelationshipType?: (taskId: string) => 'parent' | 'child' | 'related' | null;
  highlightLinksMode?: boolean;
  relationSummary?: TaskRelationshipSummary;
  onUnlinkRelatedTask?: (targetTask: Task) => void | Promise<void>;
  
  // Sprint filtering props
  selectedSprintId?: string | null;
  availableSprints?: any[]; // Optional: sprints passed from parent (avoids duplicate API calls)

  /** Multi-check (bulk). Distinct from TaskDetails amber selection. */
  isChecked?: boolean;
  onToggleChecked?: () => void;
  /** True when multi-check spans multiple columns — disables this card’s DnD. */
  isMultiSelectDragLocked?: boolean;
  /** false for viewer — hide toolbar, pencil, multi-select, inline editors */
  canMutate?: boolean;
}



const TaskCard = React.memo(function TaskCard({
  task,
  member,
  members,
  currentUser,
  onRemove,
  onEdit: onEditProp,
  onCopy,
  onDragStart,
  onDragEnd,
  onSelect,
  isDragDisabled = false,
  isColumnBeingDragged = false,
  taskViewMode = 'expand',
  availablePriorities = [],
  selectedTask = null,
  availableTags = [],
  onTagAdd,
  onTagRemove,
  siteSettings,
  columnIsFinished = false,
  columnIsArchived = false,
  boards,
  columns,
  
  // Task linking props
  isLinkingMode,
  linkingSourceTask,
  onStartLinking,
  onFinishLinking,
  
  // Hover highlighting props
  hoveredLinkTask,
  onLinkToolHover,
  onLinkToolHoverEnd,
  getTaskRelationshipType,
  highlightLinksMode = false,
  relationSummary: relationSummaryProp,
  onUnlinkRelatedTask,
  
  // Sprint filtering props
  selectedSprintId = null,
  availableSprints: propSprints,
  isChecked = false,
  onToggleChecked,
  isMultiSelectDragLocked = false,
  canMutate = true,
}: TaskCardProps) {
  const { t } = useTranslation('tasks');
  const relationSummary =
    relationSummaryProp ?? getTaskRelationshipSummary(undefined, task.id);
  const allowMutations = canMutate;
  const toggleChecked = allowMutations ? onToggleChecked : undefined;
  const onEdit = (updated: Task) => {
    if (!allowMutations) return;
    return onEditProp(updated);
  };
  const [showMemberSelect, setShowMemberSelect] = useState(false);
  const [showCommentTooltip, setShowCommentTooltip] = useState(false);

  // Only one assignee menu across all cards
  useEffect(() => {
    const handler = (event: Event) => {
      const openTaskId = (event as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (openTaskId && openTaskId !== task.id) {
        setShowMemberSelect(false);
      }
    };
    window.addEventListener('easykanban:assignee-menu-open', handler);
    return () => window.removeEventListener('easykanban:assignee-menu-open', handler);
  }, [task.id]);
  const [tooltipPosition, setTooltipPosition] = useState<{left: number, top: number}>({left: 0, top: 0});
  const [showTagRemovalMenu, setShowTagRemovalMenu] = useState(false);
  const [selectedTagForRemoval, setSelectedTagForRemoval] = useState<Tag | null>(null);
  const [tagRemovalPosition, setTagRemovalPosition] = useState<{left: number, top: number}>({left: 0, top: 0});
  const [isHoveringTitle, setIsHoveringTitle] = useState(false);
  const [isHoveringDescription, setIsHoveringDescription] = useState(false);
  
  // Get project identifier from the board this task belongs to
  const getProjectIdentifier = () => {
    if (!boards || !task.boardId) return null;
    const board = boards.find(b => b.id === task.boardId);
    return board?.project || null;
  };

  // State for task attachments
  const [taskAttachments, setTaskAttachments] = useState<any[]>([]);
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);

  // Fetch task attachments when component mounts or task changes
  useEffect(() => {
    const fetchAttachments = async () => {
      // Skip fetching if attachmentCount is falsy (0, null, undefined) - avoids unnecessary API calls
      if (!task.attachmentCount || task.attachmentCount === 0) {
        setTaskAttachments([]);
        setAttachmentsLoaded(true);
        return;
      }
      
      try {
        const attachments = await fetchTaskAttachments(task.id);
        setTaskAttachments(attachments || []);
        setAttachmentsLoaded(true);
      } catch (error) {
        console.error('❌ TaskCard: Failed to fetch task attachments:', error);
        setTaskAttachments([]);
        setAttachmentsLoaded(true);
      }
    };

    setAttachmentsLoaded(false);
    fetchAttachments();
  }, [task.id, task.attachmentCount]);

  // Fix blob URLs in task description - using EXACT same logic as comments
  const fixImageUrls = (htmlContent: string, attachments: any[]) => {
    if (!htmlContent) return htmlContent;
    
    let fixedContent = htmlContent;
    
    // First, try to replace blob URLs with their corresponding attachments
    attachments.forEach(attachment => {
      if (attachment.name && attachment.name.startsWith('img-')) {
        // Replace blob URLs with authenticated server URLs
        const blobPattern = new RegExp(`blob:[^"]*#${attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        const authenticatedUrl = getAuthenticatedAttachmentUrl(attachment.url);
        fixedContent = fixedContent.replace(blobPattern, authenticatedUrl || attachment.url);
      }
    });
    
    // Fallback: Remove ANY remaining blob URLs that couldn't be matched to attachments
    // This prevents ERR_FILE_NOT_FOUND errors for stale blob URLs
    if (fixedContent.includes('blob:')) {
      console.warn('⚠️ TaskCard: Found unmatched blob URLs in description, removing them', {
        taskId: task.id,
        hasBlobUrl: fixedContent.includes('blob:')
      });
      // Replace remaining blob URLs in img tags
      fixedContent = fixedContent.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/gi, '<!-- Image removed: blob URL expired -->');
      // Also replace any blob URLs in other contexts (like background-image in style attributes)
      fixedContent = fixedContent.replace(/blob:[^\s"')]+/gi, '');
    }
    
    return fixedContent;
  };

  const getFixedDescription = () => {
    if (!task.description) return task.description;
    
    // ALWAYS fix blob URLs, even while attachments are loading
    // If attachments are still loading and we have images, remove blob URLs immediately
    if (!attachmentsLoaded && task.description.includes('blob:')) {
      console.warn('⚠️ TaskCard: Attachments still loading but blob URLs found, removing them');
      return task.description.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/g, '<!-- Loading image... -->');
    }
    
    // Use the exact same function as comments
    const fixedContent = fixImageUrls(task.description, taskAttachments);
    
    
    return fixedContent;
  };

  const cardDescriptionHtml = useMemo(() => {
    const fixed = getFixedDescription() || '';
    const sanitized = DOMPurify.sanitize(fixed);
    if (typeof document === 'undefined') return sanitized;
    const wrap = document.createElement('div');
    wrap.innerHTML = sanitized;
    const opensNew = shouldOpenLinkInNewTab(siteSettings);
    wrap.querySelectorAll('a[href]').forEach(anchor => {
      if (opensNew) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    });
    return wrap.innerHTML;
  }, [task.description, taskAttachments, attachmentsLoaded, siteSettings?.SITE_OPENS_NEW_TAB]);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [isEditingEffort, setIsEditingEffort] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [showPrioritySelect, setShowPrioritySelect] = useState(false);
  const [editedEffort, setEditedEffort] = useState(String(task.effort ?? 0));
  const [editedDescription, setEditedDescription] = useState(task.description);
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [dateRangePickerPosition, setDateRangePickerPosition] = useState<{ left: number; top: number } | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  
  // Sprint selector states
  const [showSprintSelector, setShowSprintSelector] = useState(false);
  const [sprints, setSprints] = useState<any[]>([]);
  const [sprintSearchTerm, setSprintSearchTerm] = useState('');
  const [highlightedSprintIndex, setHighlightedSprintIndex] = useState<number>(-1);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintSelectorCoords, setSprintSelectorCoords] = useState<{left: number, top: number} | null>(null);
  const sprintSelectorRef = useRef<HTMLDivElement>(null);
  const sprintOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const calendarIconRef = useRef<HTMLDivElement>(null);
  const sprintBadgeRef = useRef<HTMLSpanElement>(null);
  
  // Date validation tooltip states
  const [showStartDateTooltip, setShowStartDateTooltip] = useState(false);
  const [showDueDateTooltip, setShowDueDateTooltip] = useState(false);
  const [dateTooltipPosition, setDateTooltipPosition] = useState<{left: number, top: number} | null>(null);
  const dateTooltipRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'above' | 'below'>('below');
  const [showAddCommentModal, setShowAddCommentModal] = useState(false);
  const [showAttachmentsDropdown, setShowAttachmentsDropdown] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [agentPanelView, setAgentPanelView] = useState<AgentPanelView>('activity');
  const [agentPanelRestoreToken, setAgentPanelRestoreToken] = useState(0);
  /** Snapshot after flushing in-progress edits so Configuration sees latest text immediately */
  const [agentFormTask, setAgentFormTask] = useState<{ title: string; description: string } | null>(null);
  const [agentWork, setAgentWork] = useState<TaskWorkMap>({});
  const [agentControlBusy, setAgentControlBusy] = useState(false);
  const [agentModalComments, setAgentModalComments] = useState(task.comments || []);
  const [attachmentsDropdownPosition, setAttachmentsDropdownPosition] = useState<{top: number, left: number, direction: 'above' | 'below'}>({top: 0, left: 0, direction: 'below'});
  const [priorityDropdownPosition, setPriorityDropdownPosition] = useState<{top: number, left: number, direction: 'above' | 'below'}>({top: 0, left: 0, direction: 'below'});
  const priorityButtonRef = useRef<HTMLButtonElement>(null);
  const commentTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commentTooltipShowTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commentContainerRef = useRef<HTMLDivElement>(null);
  const commentTooltipRef = useRef<HTMLDivElement>(null);
  const wasDraggingRef = useRef(false);
  const tagRemovalMenuRef = useRef<HTMLDivElement>(null);
  const attachmentsButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentsDropdownRef = useRef<HTMLDivElement>(null);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [cardElement, setCardElement] = useState<HTMLDivElement | null>(null);
  const isInteractingWithTagRef = useRef<boolean>(false); // Track if user is interacting with tags
  const isInteractingWithDropdownRef = useRef<boolean>(false); // Track if user is interacting with dropdowns (member, sprint, etc.)
  const isSelectingRef = useRef<boolean>(false); // Track if we're in the process of selecting this task

  // Check if any editing is active to disable drag
  const agentStatus = agentWork.status || null;
  const isAgentWorkActive =
    task.memberId === AGENT_MEMBER_ID &&
    !!agentStatus &&
    (AGENT_DRAG_BLOCKING_STATUSES as readonly string[]).includes(agentStatus);

  const isAnyEditingActive = isEditingTitle || isEditingEffort || isEditingDescription || showMemberSelect || showPrioritySelect || showCommentTooltip || showTagRemovalMenu || showAttachmentsDropdown || showSprintSelector || showDateRangePicker || isAgentWorkActive;

  // Sync editedEffort with task.effort when task updates (but not while editing)
  useEffect(() => {
    if (!isEditingEffort) {
      setEditedEffort(String(task.effort ?? 0));
    }
  }, [task.effort, isEditingEffort]);

  // Prevent component updates while editing description to maintain focus
  useEffect(() => {
    if (isEditingDescription) {
      return () => {
        // Cleanup if needed
      };
    }
  }, [isEditingDescription, task.description]);

  // @dnd-kit sortable hook for vertical reordering
  const {
    attributes,
    listeners: originalListeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: task.id,
    disabled:
      isDragDisabled ||
      isMultiSelectDragLocked ||
      isAnyEditingActive ||
      isDndGloballyDisabled(),
    data: {
      type: 'task',
      task: task,
      columnId: task.columnId,
      position: task.position
    }
  });

  // Wrap listeners to prevent drag from starting on elements with data-no-dnd attribute
  const listeners = React.useMemo(() => {
    if (!originalListeners) {
      return originalListeners;
    }
    
    return {
      ...originalListeners,
      onPointerDown: (e: React.PointerEvent) => {
        // Check if the target or any parent has data-no-dnd attribute
        const target = e.target as HTMLElement;
        if (target.closest('[data-no-dnd="true"]')) {
          // Don't start drag for elements marked with data-no-dnd
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Cmd/Ctrl+click is multi-select — do not activate dnd-kit.
        // With a low activation distance, pointerdown otherwise starts a drag and the
        // column wrapper applies opacity-50 (looks disabled) until drag end.
        if (e.metaKey || e.ctrlKey) {
          return;
        }

        // Call original listener - CRITICAL: Don't prevent default or stop propagation
        // The sensor needs these events to track pointer movement
        originalListeners.onPointerDown?.(e);
      }
    };
  }, [originalListeners]);

  // @dnd-kit droppable hook for cross-column insertion
  // CRITICAL: Disable task droppable when a column is being dragged to prevent interference
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `${task.id}-drop`,
    data: {
      type: 'task',
      task: task,
      columnId: task.columnId,
      position: task.position
    },
    disabled: isColumnBeingDragged // Disable when column drag is active
  });

  // Combine both refs
  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    setDroppableRef(node);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
    zIndex: isDragging ? 1000 : 'auto',
    // CRITICAL: Disable pointer events on tasks when a column is being dragged
    // This allows the column droppable to be detected even when tasks cover it
    pointerEvents: isColumnBeingDragged ? 'none' : 'auto',
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return formatToYYYYMMDD(dateStr);
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    return formatToYYYYMMDDHHmmss(dateStr);
  };

  // Get sprint name for display
  const getSprintName = (): string => {
    if (!task.sprintId || sprints.length === 0) return '';
    const sprint = sprints.find(s => s.id === task.sprintId);
    return sprint?.name || '';
  };

  // Determine if sprint badge should be shown
  const shouldShowSprintBadge = (): boolean => {
    // Only show badge if:
    // 1. Task has a sprint assigned
    // 2. No sprint filter is active (selectedSprintId is null)
    // 3. Sprint name is available
    return task.sprintId !== null && task.sprintId !== undefined && 
           selectedSprintId === null && 
           getSprintName() !== '';
  };

  // Validate task dates against sprint dates
  const getDateValidation = () => {
    if (!task.sprintId || sprints.length === 0) {
      return { startDateValid: true, dueDateValid: true, sprint: null };
    }

    const sprint = sprints.find(s => s.id === task.sprintId);
    if (!sprint || !sprint.start_date || !sprint.end_date) {
      return { startDateValid: true, dueDateValid: true, sprint: null };
    }

    const sprintStart = parseLocalDate(sprint.start_date);
    const sprintEnd = parseLocalDate(sprint.end_date);
    sprintStart.setHours(0, 0, 0, 0);
    sprintEnd.setHours(0, 0, 0, 0);

    let startDateValid = true;
    let dueDateValid = true;
    let startDateError = '';
    let dueDateError = '';

    if (task.startDate) {
      const taskStart = parseLocalDate(task.startDate);
      taskStart.setHours(0, 0, 0, 0);
      
      if (taskStart < sprintStart) {
        startDateValid = false;
        startDateError = `Start date is before sprint start (${formatDate(sprint.start_date)})`;
      } else if (taskStart > sprintEnd) {
        startDateValid = false;
        startDateError = `Start date is after sprint end (${formatDate(sprint.end_date)})`;
      }
    }

    if (task.dueDate) {
      const taskDue = parseLocalDate(task.dueDate);
      taskDue.setHours(0, 0, 0, 0);
      
      if (taskDue < sprintStart) {
        dueDateValid = false;
        dueDateError = `Due date is before sprint start (${formatDate(sprint.start_date)})`;
      } else if (taskDue > sprintEnd) {
        dueDateValid = false;
        dueDateError = `Due date is after sprint end (${formatDate(sprint.end_date)})`;
      }
    }

    return {
      startDateValid,
      dueDateValid,
      sprint,
      startDateError,
      dueDateError
    };
  };

  const dateValidation = getDateValidation();

  // Check if task is overdue (due date is before today)
  // Tasks in finished columns are never considered overdue
  const isOverdue = () => {
    if (columnIsFinished) return false; // Never overdue if in finished column
    if (!task.dueDate) return false;
    const today = new Date();
    const dueDate = parseLocalDate(task.dueDate);
    // Set time to beginning of day for fair comparison
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  // Check if this task is currently selected (TaskDetails panel is open for this task)
  const isSelected = selectedTask?.id === task.id;
  
  // Clear hover state when card becomes unselected to prevent light gray appearance
  useEffect(() => {
    if (!isSelected) {
      setIsHoveringTitle(false);
      setIsHoveringDescription(false);
    }
  }, [isSelected]);

  // Track drag state for parent notifications
  useEffect(() => {
    if (isDragging && !wasDraggingRef.current) {
      onDragStart(task);
      wasDraggingRef.current = true;
    } else if (!isDragging && wasDraggingRef.current) {
      onDragEnd();
      wasDraggingRef.current = false;
    }
  }, [isDragging, task, onDragStart, onDragEnd]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (commentTooltipTimeoutRef.current) {
        clearTimeout(commentTooltipTimeoutRef.current);
      }
      if (commentTooltipShowTimeoutRef.current) {
        clearTimeout(commentTooltipShowTimeoutRef.current);
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      // Reset all interaction flags on cleanup
      isInteractingWithTagRef.current = false;
      isInteractingWithDropdownRef.current = false;
      isSelectingRef.current = false;
    };
  }, []);



  const flushPendingEdits = async (): Promise<Task> => {
    let next: Task = { ...task };
    let dirty = false;

    if (isEditingTitle) {
      const trimmed = editedTitle.trim();
      if (trimmed && trimmed !== task.title) {
        next = { ...next, title: trimmed };
        dirty = true;
      }
      setIsEditingTitle(false);
    }

    if (isEditingDescription) {
      if (editedDescription !== task.description) {
        next = { ...next, description: editedDescription };
        dirty = true;
      }
      setIsEditingDescription(false);
    }

    if (dirty) {
      await Promise.resolve(onEdit(next));
    }
    return next;
  };

  const openAssignAgentPanel = async () => {
    const latest = await flushPendingEdits();
    setAgentFormTask({ title: latest.title, description: latest.description || '' });
    setAgentPanelView('configure');
    setShowAgentPanel(true);
    setAgentPanelRestoreToken((n) => n + 1);
  };

  const openAgentWorkingModal = () => {
    setAgentModalComments(task.comments || []);
    setAgentFormTask(null);
    setAgentPanelView('activity');
    setShowAgentPanel(true);
    setAgentPanelRestoreToken((n) => n + 1);
  };

  // While activity panel is open, poll work + comments so UI recovers if WebSocket drops
  useEffect(() => {
    if (!showAgentPanel || task.memberId !== AGENT_MEMBER_ID) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [{ work }, fresh] = await Promise.all([
          getTaskWork(task.id),
          getTaskById(task.id),
        ]);
        if (cancelled) return;
        if (work) setAgentWork(work);
        if (fresh?.comments) {
          setAgentModalComments(fresh.comments);
        }
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
  }, [showAgentPanel, task.id, task.memberId]);

  const handleMemberChange = async (memberId: string) => {
    if (!allowMutations) return;
    setShowMemberSelect(false);
    if (memberId === AGENT_MEMBER_ID) {
      if (siteSettings?.AI_ENABLED !== 'true') return;
      await openAssignAgentPanel();
      return;
    }
    const latest = await flushPendingEdits();
    await Promise.resolve(onEdit({ ...latest, memberId }));
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
    const isFirstAssign = task.memberId !== AGENT_MEMBER_ID;
    const baseTask = isFirstAssign ? await flushPendingEdits() : task;

    if (isFirstAssign) {
      const withDescription =
        options?.description !== undefined
          ? { ...baseTask, description: options.description, memberId: AGENT_MEMBER_ID }
          : { ...baseTask, memberId: AGENT_MEMBER_ID };
      await Promise.resolve(onEdit(withDescription));
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
      setAgentWork(work);
      setAgentFormTask(null);
      return;
    }

    if (options?.description !== undefined) {
      await Promise.resolve(
        onEdit({ ...task, description: options.description })
      );
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
    setAgentWork(work);
    if (options?.restart) {
      await handleAgentControl('resume');
    }
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

  useEffect(() => {
    if (task.memberId !== AGENT_MEMBER_ID) {
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
  }, [task.id, task.memberId]);

  useEffect(() => {
    const handler = (data: { taskId?: string; work?: TaskWorkMap }) => {
      if (data?.taskId === task.id && data.work) {
        setAgentWork(data.work);
      }
    };
    websocketClient.onTaskWorkUpdated(handler);
    return () => websocketClient.offTaskWorkUpdated(handler);
  }, [task.id]);

  const handleAgentRefine = async (text: string, options: { restart: boolean }) => {
    await handleCommentSubmit(text);
    try {
      const fresh = await getTaskById(task.id);
      if (fresh?.comments) setAgentModalComments(fresh.comments);
    } catch {
      /* ignore */
    }
    if (options.restart) {
      await handleAgentControl('resume');
    }
  };

  const handleAddComment = () => {
    setShowAddCommentModal(true);
  };

  const handleCommentSubmit = async (commentText: string) => {
    if (!currentUser) {
      console.error('No current user available for comment');
      throw new Error('You must be logged in to add comments');
    }

    // Find the current user's member record to get the authorId
    const currentMember = members.find(m => m.user_id === currentUser.id);
    if (!currentMember) {
      console.error('Current user member record not found');
      throw new Error('Unable to identify user for comment');
    }

    try {
      // Create the comment via API
      const newComment = {
        id: generateUUID(), // Generate a proper UUID
        text: commentText,
        authorId: currentMember.id, // Use member ID as authorId
        createdAt: new Date().toISOString(),
        taskId: task.id,
        attachments: []
      };

      // Call the API to create the comment
      await createComment(newComment);

      // Update the local task state with the new comment
      const updatedTask = {
        ...task,
        comments: [...(task.comments || []), newComment]
      };
      
      // Update the task in the UI
      onEdit(updatedTask);
    } catch (error) {
      console.error('Failed to add comment:', error);
      throw error;
    }
  };

  const [clickPosition, setClickPosition] = useState<number | null>(null);
  const [selectAllTitleOnFocus, setSelectAllTitleOnFocus] = useState(false);
  const [_clickPositionDescription, setClickPositionDescription] = useState<{x: number, y: number} | null>(null);
  const _descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTitleClick = (
    e: React.MouseEvent<HTMLElement>,
    options?: { selectAll?: boolean }
  ) => {
    if (!allowMutations) return;
    if (options?.selectAll) {
      setClickPosition(null);
      setSelectAllTitleOnFocus(true);
    } else {
      // Calculate cursor position based on click location
      const element = e.currentTarget;
      const rect = element.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      setClickPosition(clickX);
      setSelectAllTitleOnFocus(false);
    }
    setIsEditingTitle(true);
    setEditedTitle(task.title);
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.target;
    if (selectAllTitleOnFocus) {
      setTimeout(() => {
        input.select();
      }, 0);
      setSelectAllTitleOnFocus(false);
      return;
    }
    if (clickPosition !== null) {
      // Create a temporary span to measure text width
      const tempSpan = document.createElement('span');
      tempSpan.style.font = window.getComputedStyle(input).font;
      tempSpan.style.visibility = 'hidden';
      tempSpan.style.position = 'absolute';
      tempSpan.style.whiteSpace = 'pre';
      document.body.appendChild(tempSpan);
      
      // Find the character position closest to the click
      let cursorPosition = 0;
      for (let i = 0; i <= task.title.length; i++) {
        tempSpan.textContent = task.title.substring(0, i);
        const textWidth = tempSpan.offsetWidth;
        if (textWidth > clickPosition - 4) { // 4px padding offset
          cursorPosition = Math.max(0, i - 1);
          break;
        }
        cursorPosition = i;
      }
      
      document.body.removeChild(tempSpan);
      
      // Set cursor position after a brief delay to ensure it works
      setTimeout(() => {
        input.setSelectionRange(cursorPosition, cursorPosition);
      }, 0);
      
      // Clear the click position
      setClickPosition(null);
    }
  };

  const handleDescriptionClick = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!allowMutations) return;
    
    // Save title first if it's being edited
    if (isEditingTitle) {
      handleTitleSave();
    }
    
    // Calculate cursor position based on click location
    const element = e.currentTarget;
    const rect = element.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Store both X and Y positions for later use
    setClickPositionDescription({ x: clickX, y: clickY });
    setIsEditingDescription(true);
    // Use fixed description with proper image URLs for editing
    setEditedDescription(getFixedDescription() || '');
  };

  const handleTitleSave = () => {
    if (editedTitle.trim() && editedTitle !== task.title) {
      onEdit({ ...task, title: editedTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setEditedTitle(task.title);
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleTitleCancel();
    }
  };

  // Auto-save title when clicking away from title field
  const handleTitleBlur = () => {
    if (isEditingTitle) {
      handleTitleSave();
    }
  };

  const handleDateRangeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!allowMutations) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    setDateRangePickerPosition({
      left: rect.left,
      top: rect.bottom + 4
    });
    setShowDateRangePicker(true);
  };

  const handleDateRangeChange = (startDate: string, endDate: string) => {
    // Optimistically update - the WebSocket event will eventually sync, but show changes immediately
    const updatedTask = { 
      ...task, 
      startDate,
      dueDate: endDate || undefined
    };
    onEdit(updatedTask);
  };

  const handleDateRangePickerClose = () => {
    setShowDateRangePicker(false);
    setDateRangePickerPosition(null);
  };

  // Sprint selector handlers
  const handleSprintSelectorOpen = (triggerElement?: React.RefObject<HTMLElement>) => {
    if (!allowMutations) return;
    // Use provided ref or fall back to calendar icon ref
    const elementRef = triggerElement || calendarIconRef;
    if (!elementRef.current) return;
    
    const rect = elementRef.current.getBoundingClientRect();
    const dropdownWidth = 256; // w-64
    const dropdownHeight = 300; // Approximate max height
    
    // Calculate horizontal position
    let left = rect.left;
    const spaceRight = window.innerWidth - (left + dropdownWidth);
    
    if (spaceRight < 10) {
      left = rect.right - dropdownWidth;
    }
    
    if (left < 10) {
      left = 10;
    }
    
    // Calculate vertical position
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    let top;
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      // Show above
      top = rect.top - Math.min(dropdownHeight, spaceAbove - 10);
    } else {
      // Show below
      top = rect.bottom + 4;
    }
    
    setSprintSelectorCoords({ left, top });
    setShowSprintSelector(true);
  };

  const handleSprintSelect = (sprint: any | null) => {
    if (sprint === null) {
      // "None (Backlog)" selected - clear sprint association (keep existing dates)
      onEdit({ 
        ...task, 
        sprintId: null
      });
    } else {
      // Align task dates with the selected sprint's date range
      onEdit({ 
        ...task, 
        sprintId: sprint.id,
        startDate: sprint.start_date ? formatToYYYYMMDD(sprint.start_date) : task.startDate,
        dueDate: sprint.end_date ? formatToYYYYMMDD(sprint.end_date) : task.dueDate
      });
    }
    setShowSprintSelector(false);
    setSprintSelectorCoords(null);
    setSprintSearchTerm('');
    setHighlightedSprintIndex(-1);
  };

  const handleSprintKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const filteredSprints = sprints.filter(sprint =>
      sprint.name.toLowerCase().includes(sprintSearchTerm.toLowerCase())
    );

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedSprintIndex(prev =>
        prev < filteredSprints.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedSprintIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedSprintIndex >= 0) {
      e.preventDefault();
      handleSprintSelect(filteredSprints[highlightedSprintIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSprintSelector(false);
      setSprintSearchTerm('');
      setHighlightedSprintIndex(-1);
    }
  };

  // Use prop sprints if provided, otherwise fetch when needed (fallback for backward compatibility)
  useEffect(() => {
    if (propSprints && propSprints.length > 0) {
      setSprints(propSprints);
      return;
    }
    
    // Only fetch if not provided via props and needed
    const fetchSprints = async () => {
      // Fetch if selector/date picker is opened OR if task has sprintId and we don't have sprints yet
      const shouldFetch =
        showSprintSelector ||
        showDateRangePicker ||
        (task.sprintId && sprints.length === 0);
      if (!shouldFetch) return;
      
      try {
        setSprintsLoading(true);
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/admin/sprints', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSprints(data.sprints || []);
        }
      } catch (error) {
        console.error('Failed to fetch sprints:', error);
      } finally {
        setSprintsLoading(false);
      }
    };

    fetchSprints();
  }, [propSprints, showSprintSelector, showDateRangePicker, task.sprintId, sprints.length]);

  // Close sprint selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sprintSelectorRef.current && !sprintSelectorRef.current.contains(event.target as Node)) {
        setShowSprintSelector(false);
        setSprintSelectorCoords(null);
        setSprintSearchTerm('');
        setHighlightedSprintIndex(-1);
      }
    };

    if (showSprintSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSprintSelector]);

  // Reset highlighted index when search term changes
  useEffect(() => {
    setHighlightedSprintIndex(-1);
  }, [sprintSearchTerm]);

  // Auto-scroll to highlighted sprint option
  useEffect(() => {
    if (highlightedSprintIndex >= 0 && sprintOptionRefs.current[highlightedSprintIndex]) {
      sprintOptionRefs.current[highlightedSprintIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [highlightedSprintIndex]);

  const parseEffortInput = (raw: string): number => {
    const trimmed = raw.trim();
    if (trimmed === '') return 0;
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 9999);
  };

  const handleEffortSave = () => {
    const effort = parseEffortInput(editedEffort);
    setEditedEffort(String(effort));
    if (effort !== task.effort) {
      onEdit({ ...task, effort });
    }
    setIsEditingEffort(false);
  };

  const handleEffortCancel = () => {
    setEditedEffort(String(task.effort ?? 0));
    setIsEditingEffort(false);
  };

  const handleEffortKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEffortSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEffortCancel();
    }
  };

  const _handleDescriptionSave = () => {
    if (editedDescription !== task.description) {
      onEdit({ ...task, description: editedDescription });
    }
    setIsEditingDescription(false);
  };

  const _handleDescriptionCancel = () => {
    setEditedDescription(task.description);
    setIsEditingDescription(false);
  };

  const handlePriorityChange = (priorityId: number) => {
    const priorityOption = availablePriorities.find(p => p.id === priorityId);
    onEdit({ 
      ...task, 
      priorityId: priorityId,
      priority: priorityOption?.priority || null 
    });
    setShowPrioritySelect(false);
  };

  const handleCommentTooltipShow = () => {
    // Clear any pending hide timeout
    if (commentTooltipTimeoutRef.current) {
      clearTimeout(commentTooltipTimeoutRef.current);
      commentTooltipTimeoutRef.current = null;
    }
    
    // Clear any existing show timeout
    if (commentTooltipShowTimeoutRef.current) {
      clearTimeout(commentTooltipShowTimeoutRef.current);
    }
    
    // Wait 0.5 seconds before showing tooltip
    commentTooltipShowTimeoutRef.current = setTimeout(() => {
      // Position will be calculated by useLayoutEffect
      setShowCommentTooltip(true);
      commentTooltipShowTimeoutRef.current = null;
    }, 500);
  };

  const handleCommentTooltipHide = () => {
    // Cancel any pending show timeout when leaving
    if (commentTooltipShowTimeoutRef.current) {
      clearTimeout(commentTooltipShowTimeoutRef.current);
      commentTooltipShowTimeoutRef.current = null;
    }
    
    // Only hide after a delay to allow mouse movement into tooltip
    commentTooltipTimeoutRef.current = setTimeout(() => {
      setShowCommentTooltip(false);
    }, 500); // Generous delay
  };

  const calculateDropdownPosition = () => {
    if (priorityButtonRef.current) {
      const rect = priorityButtonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownHeight = 150; // Approximate height for priority dropdown
      
      let top, left;
      if (spaceBelow < dropdownHeight) {
        // Show above
        top = rect.top - dropdownHeight - 8;
      } else {
        // Show below
        top = rect.bottom + 8;
      }
      
      left = rect.left;
      
      return { top, left, direction: spaceBelow < dropdownHeight ? 'above' : 'below' };
    }
    return { top: 0, left: 0, direction: 'below' as const };
  };

  const calculateAttachmentsDropdownPosition = () => {
    if (attachmentsButtonRef.current) {
      const rect = attachmentsButtonRef.current.getBoundingClientRect();
      const dropdownWidth = 256; // w-64
      const dropdownMaxHeight = 320; // max-h-80 = 20rem = 320px
      
      // Get actual dropdown height if it exists, otherwise use max
      const actualDropdownHeight = attachmentsDropdownRef.current?.offsetHeight || dropdownMaxHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      let top, left;
      
      // Prefer showing below, but if not enough space, show above
      if (spaceBelow >= actualDropdownHeight + 16 || spaceBelow > spaceAbove) {
        // Show below
        top = rect.bottom + 8;
      } else {
        // Show above
        top = rect.top - actualDropdownHeight - 8;
      }
      
      // Align right edge of dropdown with right edge of button
      left = rect.right - dropdownWidth;
      
      // Ensure dropdown doesn't go off-screen horizontally
      if (left < 8) left = 8;
      if (left + dropdownWidth > window.innerWidth - 8) {
        left = window.innerWidth - dropdownWidth - 8;
      }
      
      // Ensure dropdown doesn't go off-screen vertically
      if (top < 8) top = 8;
      if (top + actualDropdownHeight > window.innerHeight - 8) {
        top = window.innerHeight - actualDropdownHeight - 8;
      }
      
      return { top, left, direction: spaceBelow >= actualDropdownHeight + 16 ? 'below' : 'above' };
    }
    return { top: 0, left: 0, direction: 'below' as const };
  };

  const calculateTooltipPosition = () => {
    if (commentContainerRef.current) {
      const commentRect = commentContainerRef.current.getBoundingClientRect();
      const tooltipWidth = 320; // w-80 = 320px
      const tooltipMaxHeight = 256; // max-h-64 = 256px
      
      // Get actual tooltip height if it exists, otherwise use max
      const actualTooltipHeight = commentTooltipRef.current?.offsetHeight || tooltipMaxHeight;
      const spaceAbove = commentRect.top;
      const spaceBelow = window.innerHeight - commentRect.bottom;
      
      // Calculate horizontal position - center tooltip on the comment icon
      let left = commentRect.left + (commentRect.width / 2) - (tooltipWidth / 2);
      
      // Keep tooltip within viewport bounds horizontally
      if (left < 8) {
        left = 8;
      }
      if (left + tooltipWidth > window.innerWidth - 8) {
        left = window.innerWidth - tooltipWidth - 8;
      }
      
      // Position tooltip - prefer above, fallback to below
      let top;
      if (spaceAbove >= actualTooltipHeight + 16 || spaceAbove > spaceBelow) {
        // Show above (preferred)
        top = commentRect.top - actualTooltipHeight - 8;
      } else {
        // Show below (fallback)
        top = commentRect.bottom + 8;
      }
      
      // Ensure tooltip doesn't go off-screen vertically
      if (top < 8) top = 8;
      if (top + actualTooltipHeight > window.innerHeight - 8) {
        top = window.innerHeight - actualTooltipHeight - 8;
      }
      
      return { left, top };
    }
    return { left: 0, top: 0 };
  };

  // Recalculate dropdown positions when they open (before browser paints)
  useLayoutEffect(() => {
    if (showPrioritySelect) {
      setPriorityDropdownPosition(calculateDropdownPosition());
    }
  }, [showPrioritySelect]);

  useLayoutEffect(() => {
    if (showAttachmentsDropdown) {
      setAttachmentsDropdownPosition(calculateAttachmentsDropdownPosition());
    }
  }, [showAttachmentsDropdown]);

  useLayoutEffect(() => {
    if (showCommentTooltip) {
      setTooltipPosition(calculateTooltipPosition());
    }
  }, [showCommentTooltip]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Don't handle member select here - it's portal-rendered in TaskCardToolbar
      // and handles its own click-outside logic via stopPropagation
      
      if (showPrioritySelect) {
        // Check if click is outside both the button and the dropdown
        if (
          priorityButtonRef.current && !priorityButtonRef.current.contains(target) &&
          priorityDropdownRef.current && !priorityDropdownRef.current.contains(target)
        ) {
          setShowPrioritySelect(false);
        }
      }
      
      if (showAttachmentsDropdown) {
        // Check if click is outside both the button and the dropdown
        if (
          attachmentsButtonRef.current && !attachmentsButtonRef.current.contains(target) &&
          attachmentsDropdownRef.current && !attachmentsDropdownRef.current.contains(target)
        ) {
          setShowAttachmentsDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPrioritySelect, showAttachmentsDropdown]);

  useEffect(() => {
    if (isDragging) {
      onDragStart(task);
    } else {
      onDragEnd();
    }
  }, [isDragging, task, onDragStart, onDragEnd]);

  // Close tag removal menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagRemovalMenuRef.current && !tagRemovalMenuRef.current.contains(event.target as Node)) {
        setShowTagRemovalMenu(false);
        setSelectedTagForRemoval(null);
      }
    };

    if (showTagRemovalMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTagRemovalMenu]);

  useEscapeDismiss(
    () => {
      setShowTagRemovalMenu(false);
      setSelectedTagForRemoval(null);
    },
    { enabled: showTagRemovalMenu }
  );

  // Handle click outside for title and description editing
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Check if clicked outside the card
      if (cardElement && !cardElement.contains(target)) {
        // Save title if editing
        if (isEditingTitle) {
          handleTitleSave();
        }
        
        // Save description if editing
        if (isEditingDescription) {
          if (editedDescription !== task.description) {
            onEdit({ ...task, description: editedDescription });
          }
          setIsEditingDescription(false);
        }
      }
    };

    if (isEditingTitle || isEditingDescription) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isEditingTitle, isEditingDescription, editedDescription, task, cardElement, handleTitleSave, onEdit]);

  // Tag removal handlers
  const handleConfirmTagRemoval = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation(); // Prevent event from bubbling to card onClick
      e.preventDefault();
    }
    if (!allowMutations) {
      setShowTagRemovalMenu(false);
      setSelectedTagForRemoval(null);
      return;
    }
    if (selectedTagForRemoval && onTagRemove) {
      onTagRemove(selectedTagForRemoval.id.toString());
      setShowTagRemovalMenu(false);
      setSelectedTagForRemoval(null);
    }
  };

  const handleCancelTagRemoval = () => {
    setShowTagRemovalMenu(false);
    setSelectedTagForRemoval(null);
  };

  const validComments = (task.comments || [])
    .filter(comment => 
      comment && 
      comment.id && 
      comment.text && 
      comment.text.trim() !== '' && 
      comment.authorId && 
      comment.createdAt
    );

  return (
    <>
      <div
        ref={(node) => {
          setNodeRef(node);
          setCardElement(node);
        }}
        style={{ 
          ...style, 
          borderLeft: `4px solid ${member.color}`,
          // Use CSS variable for background to prevent flash - ensures correct color immediately
          backgroundColor: isSelected 
            ? undefined 
            : member.id === SYSTEM_MEMBER_ID 
              ? undefined 
              : isAgentWorkActive
                ? undefined
              : 'var(--task-card-bg)',
          // Prevent clicks on tag areas from reaching card
          position: 'relative'
        }}
        className={`group task-card sortable-item cursor-pointer ${
          isSelected ? 'bg-gray-100 dark:bg-gray-700 ring-1 ring-amber-400 dark:ring-amber-500' : 
          member.id === SYSTEM_MEMBER_ID ? 'bg-yellow-50 dark:bg-yellow-900' :
          isAgentWorkActive ? 'bg-teal-50/90 dark:bg-teal-950/40' :
          '' // Background now handled by CSS variable in style to prevent flash
        } p-4 rounded-lg shadow-sm relative ${
          isDragging ? 'opacity-90 scale-105 shadow-2xl rotate-2 ring-2 ring-blue-400' : 'hover:shadow-md'
        } ${
          isLinkingMode && linkingSourceTask?.id !== task.id 
            ? 'hover:ring-2 hover:ring-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900' 
            : ''
        } ${
          isLinkingMode && linkingSourceTask?.id === task.id 
            ? 'ring-2 ring-blue-500 bg-blue-100 dark:bg-blue-900' 
            : ''
        } ${
          // Highlight related tasks when hovering over link tool
          hoveredLinkTask && getTaskRelationshipType && hoveredLinkTask.id !== task.id ? (() => {
            const relationshipType = getTaskRelationshipType(task.id);
            if (relationshipType === 'parent') {
              return 'ring-2 ring-green-400 bg-green-50 dark:bg-green-900 shadow-lg';
            } else if (relationshipType === 'child') {
              return 'ring-2 ring-purple-400 bg-purple-50 dark:bg-purple-900 shadow-lg';
            } else if (relationshipType === 'related') {
              return 'ring-2 ring-yellow-400 bg-yellow-50 dark:bg-yellow-900 shadow-lg';
            }
            return '';
          })() : ''
        } ${
          highlightLinksMode && !relationSummary.hasAny ? 'opacity-40' : ''
        } ${
          highlightLinksMode && relationSummary.hasAny && hoveredLinkTask?.id === task.id
            ? 'ring-2 ring-blue-300 dark:ring-blue-500'
            : ''
        }`}
        {...attributes}
        {...listeners}
        onClickCapture={(e) => {
          // Use capture phase to detect tag clicks BEFORE onClick fires.
          // Only the dedicated tag container — do NOT treat every rounded-full
          // (priority/member chips) as a tag, or the clickable strip beside an
          // overlapping activity feed becomes dead.
          const target = e.target as HTMLElement;
          if (target.closest('[data-tag-container]')) {
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            isInteractingWithTagRef.current = true;
            setTimeout(() => {
              isInteractingWithTagRef.current = false;
            }, 500);
          }
        }}
        onClick={(e) => {
          // Only open task details if we're not in linking mode and not clicking interactive elements
          if (isLinkingMode) return;

          // Ctrl/Cmd+click toggles multi-select (same as the card checkbox).
          if ((e.ctrlKey || e.metaKey) && toggleChecked) {
            e.preventDefault();
            e.stopPropagation();
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            toggleChecked();
            return;
          }
          
          const target = e.target as HTMLElement;
          
          // Tags only — container already stopPropagates; keep this as a safety net
          if (target.closest('[data-tag-container]')) {
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            isInteractingWithTagRef.current = true;
            setTimeout(() => {
              isInteractingWithTagRef.current = false;
            }, 500);
            e.stopPropagation();
            return;
          }
          
          // CRITICAL: Check if clicking on dropdowns (member selector, sprint selector, etc.)
          const isDropdownClick = 
            target.closest('[data-member-dropdown]') !== null ||
            target.closest('[data-member-button]') !== null ||
            target.closest('[data-sprint-selector]') !== null ||
            target.closest('[data-sprint-badge]') !== null || // Sprint badge (informational only)
            target.closest('[data-tag-removal-menu]') !== null ||
            target.closest('[data-tour-id="sprint-association"]') !== null ||
            target.closest('button[data-tour-id="sprint-association"]') !== null ||
            (target.closest('svg') && target.closest('svg')?.parentElement?.getAttribute('data-tour-id') === 'sprint-association') ||
            target.closest('.fixed.bg-white.dark\\:bg-gray-800') !== null; // Portal-rendered dropdowns
          
          if (isDropdownClick) {
            // Immediately clear any pending click timer
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            // Set flag to prevent any delayed selection
            isInteractingWithDropdownRef.current = true;
            // Reset flag after delay
            setTimeout(() => {
              isInteractingWithDropdownRef.current = false;
            }, 500);
            // Stop propagation to prevent card selection
            e.stopPropagation();
            return;
          }
          
          // Check flags - if we're interacting with tags or dropdowns, don't do anything
          if (isInteractingWithTagRef.current || isInteractingWithDropdownRef.current) {
            // Clear any pending click timer
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            return;
          }
          
          // Don't open if tag removal menu is open
          if (showTagRemovalMenu) {
            // Clear any pending click timer
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            return;
          }
          
          // Don't open if any dropdown is open
          if (showMemberSelect || showSprintSelector || showPrioritySelect || showAttachmentsDropdown) {
            // Clear any pending click timer
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            return;
          }
          
          // Don't open if clicking on interactive elements or their children
          // Check both direct tag and closest() to catch clicks on elements inside buttons
          if (
            target.tagName === 'BUTTON' ||
            target.tagName === 'INPUT' ||
            target.tagName === 'SELECT' ||
            target.tagName === 'A' ||
            target.tagName === 'IMG' || // Images might be inside buttons
            target.tagName === 'SVG' || // SVG icons might be inside buttons
            target.tagName === 'PATH' || // SVG paths inside icons
            target.closest('button') ||
            target.closest('a') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('svg') || // SVG elements and their children
            target.closest('[data-stop-propagation]') || // Allow marking elements to stop propagation
            target.closest('[data-tag-removal-menu]') || // Tag removal menu (rendered in portal)
            isEditingEffort || // Don't open if editing effort
            isEditingTitle || // Don't open if editing title
            isEditingDescription // Don't open if editing description
          ) {
            // Clear any pending click timer
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            return;
          }
          
          // Delay opening/closing TaskDetails to allow double-click to cancel it
          // CRITICAL: Only set timer if we're NOT interacting with tags or dropdowns, and not already selecting, and not editing
          const canStartSelection = !isInteractingWithTagRef.current && 
                                    !isInteractingWithDropdownRef.current && 
                                    !isSelectingRef.current && 
                                    !showTagRemovalMenu && 
                                    !showMemberSelect && 
                                    !showSprintSelector && 
                                    !showPrioritySelect && 
                                    !showAttachmentsDropdown && 
                                    !isEditingEffort && 
                                    !isEditingTitle && 
                                    !isEditingDescription;
          
          if (canStartSelection) {
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
            }
            isSelectingRef.current = true; // Mark that we're in the process of selecting
            // Don't clear hover state here - it causes light gray appearance during task switching
            // The selected state styling will handle the visual appearance
            
            // Store the current task ID and selected task ID to avoid stale closures
            // CRITICAL: Use the task prop directly in the callback to ensure we have the latest task data
            const currentTaskId = task.id;
            const currentSelectedTaskId = selectedTask?.id;
            
            cardLog('[TaskCard] Starting selection timer for task:', currentTaskId, 'currently selected:', currentSelectedTaskId);
            
            clickTimerRef.current = setTimeout(() => {
              // CRITICAL: Re-read task and selectedTask from props to avoid stale closures
              // This ensures we have the latest data when switching tasks
              const latestTaskId = task.id;
              const latestSelectedTaskId = selectedTask?.id;
              
              // Final check before selecting - make sure we're still not interacting with tags or dropdowns, and not editing
              // Use refs for state checks to avoid stale closures
              const shouldSelect = !isInteractingWithTagRef.current && 
                                   !isInteractingWithDropdownRef.current && 
                                   !showTagRemovalMenu && 
                                   !showMemberSelect && 
                                   !showSprintSelector && 
                                   !showPrioritySelect && 
                                   !showAttachmentsDropdown && 
                                   !isEditingEffort && 
                                   !isEditingTitle && 
                                   !isEditingDescription;
              
              // Only proceed if timer wasn't cleared (e.g., by double-click)
              if (shouldSelect && clickTimerRef.current !== null) {
                cardLog('[TaskCard] Executing selection for task:', latestTaskId, 'currently selected:', latestSelectedTaskId);
                // Toggle: if clicking the same task that's already selected, close TaskDetails
                // Use the latest IDs to avoid stale closure issues
                if (latestSelectedTaskId === latestTaskId) {
                  // Clear hover state before unselecting to prevent light gray appearance
                  setIsHoveringTitle(false);
                  setIsHoveringDescription(false);
                  cardLog('[TaskCard] Closing TaskDetails (same task clicked)');
                  onSelect(null);
                } else {
                  // Switching to a different task - use the latest task object from props
                  cardLog('[TaskCard] Switching to task:', latestTaskId);
                  // Use task prop directly to ensure we have the latest data
                  // Don't clear hover state here - let it be managed by mouse events
                  onSelect(task);
                }
                // Reset selection flag immediately after onSelect to allow hover state to be restored
                // This is critical when performance violations delay React state updates
                isSelectingRef.current = false;
              } else {
                // Selection was blocked - ensure hover state is cleared to prevent light gray appearance
                setIsHoveringTitle(false);
                setIsHoveringDescription(false);
                // Reset selection flag since we're not selecting
                isSelectingRef.current = false;
                // Debug: Log why selection was blocked
                if (clickTimerRef.current === null) {
                  cardLog('[TaskCard] Selection blocked: timer was cleared');
                } else {
                  cardLog('[TaskCard] Selection blocked:', {
                    isInteractingWithTag: isInteractingWithTagRef.current,
                    isInteractingWithDropdown: isInteractingWithDropdownRef.current,
                    showTagRemovalMenu,
                    showMemberSelect,
                    showSprintSelector,
                    showPrioritySelect,
                    showAttachmentsDropdown,
                    isEditingEffort,
                    isEditingTitle,
                    isEditingDescription
                  });
                }
              }
              clickTimerRef.current = null;
            }, 250); // Wait 250ms to distinguish from double-click
          } else {
            // If we're interacting with tags or already selecting, make sure timer is cleared
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            isSelectingRef.current = false; // Reset selection flag
            cardLog('[TaskCard] Selection prevented:', {
              isInteractingWithTag: isInteractingWithTagRef.current,
              isInteractingWithDropdown: isInteractingWithDropdownRef.current,
              isSelecting: isSelectingRef.current,
              showTagRemovalMenu,
              showMemberSelect,
              showSprintSelector,
              showPrioritySelect,
              showAttachmentsDropdown,
              isEditingEffort,
              isEditingTitle,
              isEditingDescription
            });
          }
        }}
        onMouseEnter={() => {
          // Don't set hover state if we're in the process of selecting
          // Also don't set hover if the card is currently selected (it has its own styling)
          if (!isSelectingRef.current && !isSelected) {
            setIsHoveringTitle(true);
            setIsHoveringDescription(true);
          }
          if (highlightLinksMode && relationSummary.hasAny) {
            // Switch highlight focus to this card so counterpart badges (PARENT/CHILD) update
            onLinkToolHover?.(task);
          } else if (highlightLinksMode && !relationSummary.hasAny) {
            onLinkToolHoverEnd?.();
          }
        }}
        onMouseLeave={() => {
          // Only clear hover if card is not selected (selected cards have their own styling)
          if (!isSelected) {
            setIsHoveringTitle(false);
            setIsHoveringDescription(false);
          }
          // Do not clear highlight focus on leave while highlight mode is on —
          // column scroll would otherwise remove PARENT/CHILD badges mid-inspect.
        }}
        onDoubleClick={(e) => {
          // Cancel pending single-click timer to prevent TaskDetails from opening/closing
          if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
          }
          // Reset selection flag
          isSelectingRef.current = false;
          // Clear interaction flags
          isInteractingWithTagRef.current = false;
          isInteractingWithDropdownRef.current = false;
          // Double-click doesn't do anything special for now, but prevents single-click action
          e.stopPropagation();
        }}
        onPointerUp={isLinkingMode ? (e) => {
          cardLog('🔗 TaskCard onPointerUp in linking mode:', {
            taskId: task.id,
            sourceTaskId: linkingSourceTask?.id,
            isDifferentTask: linkingSourceTask?.id !== task.id
          });
          e.preventDefault();
          e.stopPropagation();
          if (onFinishLinking) {
            if (linkingSourceTask?.id !== task.id) {
              cardLog('🔗 Creating relationship (pointer):', linkingSourceTask?.ticket, '→', task.ticket);
              void onFinishLinking(task);
            } else {
              cardLog('🔗 Same task - canceling linking (pointer)');
              void onFinishLinking(null);
            }
          }
        } : undefined}
      >
        {/* Task Identifier Overlay - Top Right Corner.
            leading-none keeps the overlay box flush with the badge; extra line-box leading
            would hang over the toolbar row and steal hover/clicks from the trash. */}
        {task.ticket && (
          <div
            className="absolute right-0 z-10 leading-none"
            style={{ top: '-8px' }}
            data-stop-propagation
          >
            <KanbanChromeTooltip
              label={t('taskCard.directLinkTo', { ticket: task.ticket })}
              wrapperClassName="relative inline-flex align-top leading-none"
            >
              <a
                href={generateTaskUrl(task.ticket, getProjectIdentifier())}
                {...(getLinkTarget(siteSettings)
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
                className={`bg-white dark:bg-gray-800 px-1.5 py-0.8 text-gray-600 dark:text-gray-300 font-mono font-bold hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 transition-all duration-200 cursor-pointer whitespace-nowrap max-w-none`}
                style={{
                  borderTopLeftRadius: '0.25rem',
                  borderTopRightRadius: '0.25rem',
                  borderBottomLeftRadius: '0',
                  borderBottomRightRadius: '0',
                  border: 'none',
                  fontSize: '12px',
                  textDecoration: 'none',
                  display: 'inline-block',
                  lineHeight: '1.2',
                  verticalAlign: 'top'
                }}
              >
                {task.ticket}
              </a>
            </KanbanChromeTooltip>
          </div>
        )}

        {/* TaskCard Toolbar — viewers still get assignee avatar (read-only) */}
        <TaskCardToolbar
          task={task}
          member={member}
          members={members}
          isDragDisabled={isDragDisabled || isAnyEditingActive || isDndGloballyDisabled() || isAgentWorkActive || !allowMutations}
          showMemberSelect={showMemberSelect}
          onCopy={onCopy}
          onEdit={onEdit}
          onSelect={onSelect}
          onRemove={onRemove}
          onMemberChange={handleMemberChange}
          onToggleMemberSelect={() => {
            if (!allowMutations) return;
            void (async () => {
              if (!showMemberSelect) {
                await flushPendingEdits();
                window.dispatchEvent(
                  new CustomEvent('easykanban:assignee-menu-open', {
                    detail: { taskId: task.id },
                  })
                );
                setShowMemberSelect(true);
              } else {
                setShowMemberSelect(false);
              }
            })();
          }}
          onCloseMemberSelect={() => setShowMemberSelect(false)}
          setDropdownPosition={setDropdownPosition}
          dropdownPosition={dropdownPosition}
          listeners={listeners}
          attributes={attributes}
          availableTags={availableTags}
          onTagAdd={onTagAdd}
          columnIsFinished={columnIsFinished}
          columns={columns}
          agentWorkStatus={agentStatus}
          onOpenAgentActivity={openAgentWorkingModal}
          
          // Task linking props
          isLinkingMode={isLinkingMode}
          linkingSourceTask={linkingSourceTask}
          onStartLinking={allowMutations ? onStartLinking : undefined}
          
          // Hover highlighting props
          hoveredLinkTask={hoveredLinkTask}
          onLinkToolHover={onLinkToolHover}
          onLinkToolHoverEnd={onLinkToolHoverEnd}
          relationSummary={relationSummary}
          highlightLinksMode={highlightLinksMode}
          getTaskRelationshipType={getTaskRelationshipType}
          onUnlinkRelatedTask={onUnlinkRelatedTask}
          
          // Toolbar visibility: CSS group-hover on card (survives list reorder without mouseenter)
          isEditingTitle={isEditingTitle}
          isEditingDescription={isEditingDescription}
          isSelected={isSelected}
          isAdmin={Boolean(currentUser?.roles?.includes('admin'))}
          canMutate={allowMutations}
        />

        {/* Relationship Type Indicator - when focus card highlights related ones */}
        {hoveredLinkTask && getTaskRelationshipType && hoveredLinkTask.id !== task.id && (() => {
          const relationshipType = getTaskRelationshipType(task.id);
          if (relationshipType) {
            const badges = {
              parent: { text: t('relationships.badgeParent'), color: 'bg-green-500' },
              child: { text: t('relationships.badgeChild'), color: 'bg-purple-500' },
              related: { text: t('relationships.badgeRelated'), color: 'bg-yellow-500' }
            };
            const badge = badges[relationshipType];
            return (
              <div className="absolute top-2 left-2 z-[40] pointer-events-none">
                <div
                  className={`${badge.color} text-white text-xs px-1.5 py-0.5 rounded-full font-bold shadow-md`}
                  title={t('relationships.shiftClickLinkToUnlink')}
                >
                  {badge.text}
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Title row: float spacer matches assignee avatar (w-8) so line boxes wrap
            beside it, then reclaim full card width once past the avatar height. */}
        <div className="mb-2 mt-1">
          {isEditingTitle ? (
            <div className="pr-10">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                onFocus={handleInputFocus}
                className="font-medium text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 outline-none focus:border-blue-500 w-full text-sm"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
          ) : (
            <div
              className={`relative ${
                isDragDisabled || isMultiSelectDragLocked || isAnyEditingActive
                  ? ''
                  : 'cursor-grab active:cursor-grabbing'
              }`}
              {...(isMultiSelectDragLocked ? {} : listeners)}
            >
              {/* Multi-check reuses the former left pencil slot (no layout growth). */}
              {toggleChecked && (
                <label
                  className="absolute -left-[10px] top-[19px] z-10 -translate-x-1 -translate-y-1/2 -m-1.5 flex cursor-pointer items-center p-1.5"
                  data-no-dnd="true"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <ModernCheckbox
                    checked={isChecked}
                    onChange={toggleChecked}
                    size="sm"
                    aria-label={t('kanbanSelect.selectTask')}
                    data-testid={`task-check-${task.id}`}
                  />
                </label>
              )}
              <FirstLineEndAnchor
                contentClassName="min-w-0 flow-root"
                anchor={
                  allowMutations && isHoveringTitle ? (
                    <KanbanChromeTooltip label={t('taskCard.editTitle')} wrapperClassName="inline-flex">
                      <button
                        type="button"
                        data-no-dnd="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTitleClick(e as any, { selectAll: true });
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        data-testid="task-quick-edit"
                      >
                        <Pencil size={12} className="text-gray-400 hover:text-blue-500" />
                      </button>
                    </KanbanChromeTooltip>
                  ) : null
                }
              >
                <div
                  className="float-right h-8 w-8 ml-1 mb-0.5 pointer-events-none"
                  aria-hidden
                />
                <h3
                  className="font-medium text-gray-800 dark:text-gray-100 px-1 py-0.5 rounded text-sm"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                    handleTitleClick(e as any, { selectAll: true });
                  }}
                  style={{
                    cursor:
                      isDragDisabled || isMultiSelectDragLocked || isAnyEditingActive
                        ? 'default'
                        : 'grab',
                  }}
                >
                  {task.title}
                </h3>
              </FirstLineEndAnchor>
            </div>
          )}
        </div>

        {/* Description Section */}
        {taskViewMode !== 'compact' && (
          <>
            {isEditingDescription ? (
              <div className="-mt-2 mb-3" onClick={(e) => e.stopPropagation()} style={{ cursor: 'text' }}>
                <TextEditor
                  onSubmit={async (content) => {
                    // Handle save
                    if (content !== task.description) {
                      onEdit({ ...task, description: content });
                    }
                    setIsEditingDescription(false);
                  }}
                  onCancel={() => {
                    setEditedDescription(task.description);
                    setIsEditingDescription(false);
                  }}
                  onChange={(content) => {
                    setEditedDescription(content);
                  }}
                  initialContent={editedDescription}
                  placeholder={t('taskCard.enterTaskDescription')}
                  compact={true}
                  showSubmitButtons={false}
                  resizable={true}
                  toolbarOptions={{
                    bold: true,
                    italic: true,
                    underline: false,
                    link: true,
                    lists: true,
                    alignment: false,
                    attachments: false
                  }}
                  // Image behavior: read-only mode for TaskCard
                  allowImagePaste={false}    // ❌ No pasting new images
                  allowImageDelete={false}   // ❌ No delete button on images
                  allowImageResize={true}    // ✅ Allow resizing for layout
                  imageDisplayMode="compact" // 📏 Smaller images in TaskCard
                  className="w-full"
                />
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                  <span>{t('taskCard.descriptionSaveHint')}</span>
                </div>
              </div>
            ) : (
              <div
                className={`relative -mt-2 mb-3 ${
                  isDragDisabled || isMultiSelectDragLocked || isAnyEditingActive
                    ? ''
                    : 'cursor-grab active:cursor-grabbing'
                }`}
                {...(isMultiSelectDragLocked ? {} : listeners)}
              >
                <KanbanChromeTooltip
                  label={
                    taskViewMode === 'shrink' && task.description
                      ? task.description.replace(/<[^>]*>/g, '')
                      : ''
                  }
                  wrapperClassName="block min-w-0"
                >
                  <FirstLineEndAnchor
                    contentClassName="min-w-0"
                    anchor={
                      allowMutations && isHoveringDescription ? (
                        <KanbanChromeTooltip
                          label={t('taskCard.editDescription')}
                          wrapperClassName="inline-flex"
                        >
                          <button
                            type="button"
                            data-no-dnd="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDescriptionClick(e as any);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                          >
                            <Pencil size={12} className="text-gray-400 hover:text-blue-500" />
                          </button>
                        </KanbanChromeTooltip>
                      ) : null
                    }
                  >
                  <div
                    className={`task-card-description text-sm text-gray-600 dark:text-gray-300 px-2 py-1 rounded transition-colors min-h-[2.5rem] prose prose-sm max-w-none ${
                      taskViewMode === 'shrink' ? 'line-clamp-2 overflow-hidden' : ''
                    }`}
                    onDoubleClick={(e) => {
                    e.stopPropagation();
                    // Cancel pending single-click timer to prevent TaskDetails from opening
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                    handleDescriptionClick(e as any);
                  }}
                  dangerouslySetInnerHTML={{
                    __html: cardDescriptionHtml
                  }}
                    style={{
                      // Ensure images fit nicely in task cards
                      '--tw-prose-body': '1rem',
                      '--tw-prose-headings': '1rem',
                      cursor:
                        isDragDisabled || isMultiSelectDragLocked || isAnyEditingActive
                          ? 'default'
                          : 'grab',
                    } as React.CSSProperties}
                  />
                  </FirstLineEndAnchor>
                </KanbanChromeTooltip>
              </div>
            )}
          </>
        )}

        {/* Sprint Badge - Conditional Display */}
        {shouldShowSprintBadge() && (() => {
          const sprintName = getSprintName();
          // Truncate long sprint names
          const displayName = sprintName.length > 20 ? sprintName.substring(0, 17) + '...' : sprintName;
          
          return (
            <div className="mb-2 flex justify-end">
              <KanbanChromeTooltip
                label={t('taskCard.clickToSelectSprint')}
                delayMs={0}
                wrapperClassName="inline-flex max-w-full shrink-0"
              >
                <span
                  ref={sprintBadgeRef}
                  data-sprint-badge="true"
                  className={`px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700 max-w-full truncate transition-colors ${
                    allowMutations ? 'cursor-pointer hover:bg-indigo-200' : 'cursor-default'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!allowMutations) return;
                    // Set flag to prevent card selection
                    isInteractingWithDropdownRef.current = true;
                    // Clear any pending click timer
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                    // Open sprint selector using badge position
                    handleSprintSelectorOpen(sprintBadgeRef);
                    // Reset flag after delay
                    setTimeout(() => {
                      isInteractingWithDropdownRef.current = false;
                    }, 500);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    isInteractingWithDropdownRef.current = true;
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                  }}
                >
                  {displayName}
                </span>
              </KanbanChromeTooltip>
            </div>
          );
        })()}

        {/* Tags Section - Right Aligned */}
        {task.tags && task.tags.length > 0 && (() => {
          // Merge task tags with live tag data to get updated colors
          const liveTags = mergeTaskTagsWithLiveData(task.tags, availableTags);
          
          return (
            <div 
              data-tag-container="true"
              className="flex justify-end mb-2 relative"
              style={{ 
                pointerEvents: 'auto', // Ensure this div can receive pointer events
                zIndex: 10 // Ensure tag container is above card for event handling
              }}
              onMouseEnter={() => {
                setShowAllTags(true);
                isInteractingWithTagRef.current = true; // Mark that user is interacting with tags
              }}
              onMouseLeave={() => {
                setShowAllTags(false);
                // Reset flag after a short delay to allow click to complete
                setTimeout(() => {
                  isInteractingWithTagRef.current = false;
                }, 300);
              }}
              onClick={(e) => {
                // CRITICAL: Stop propagation to prevent card onClick from firing
                e.stopPropagation();
                e.preventDefault();
                // Set flag synchronously (before any async operations)
                isInteractingWithTagRef.current = true;
                // Clear any pending click timer on the card to prevent selection
                if (clickTimerRef.current) {
                  clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = null;
                }
                // Reset flag after click completes (longer than card's 250ms timer)
                setTimeout(() => {
                  isInteractingWithTagRef.current = false;
                }, 500);
              }}
              onMouseDown={(e) => {
                // Set flag immediately on mousedown (before click)
                isInteractingWithTagRef.current = true;
                e.stopPropagation();
                // Clear any pending click timer
                if (clickTimerRef.current) {
                  clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = null;
                }
              }}
              onMouseUp={(e) => {
                // Keep flag set on mouseup
                isInteractingWithTagRef.current = true;
                e.stopPropagation();
              }}
            >
              <div className={`flex flex-wrap gap-1 justify-end transition-all duration-200 ${
                showAllTags ? 'max-w-none' : 'max-w-full overflow-hidden'
              }`}>
                {(showAllTags ? liveTags : liveTags.slice(0, 3)).map((tag) => (
                  <KanbanChromeTooltip
                    key={tag.id}
                    label={allowMutations ? t('taskCard.clickToRemoveTag') : tag.tag}
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium transition-opacity ${
                        allowMutations ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                      }`}
                      style={getTagDisplayStyle(tag)}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!allowMutations) return;
                        isInteractingWithTagRef.current = true; // Mark interaction
                        // Clear any pending click timer on the card to prevent selection
                        if (clickTimerRef.current) {
                          clearTimeout(clickTimerRef.current);
                          clickTimerRef.current = null;
                        }
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        const menuWidth = 220;
                        const menuHeight = 80; // Approximate height of the menu

                        // Calculate ideal position (centered below tag)
                        let left = rect.left + rect.width / 2 - menuWidth / 2;
                        let top = rect.bottom + 5;

                        // Prevent going off the right edge
                        if (left + menuWidth > window.innerWidth - 10) {
                          left = window.innerWidth - menuWidth - 10;
                        }

                        // Prevent going off the left edge
                        if (left < 10) {
                          left = 10;
                        }

                        // If menu would go below viewport, show it above the tag instead
                        if (top + menuHeight > window.innerHeight - 10) {
                          top = rect.top - menuHeight - 5;
                        }

                        // If still going off top, position it within viewport
                        if (top < 10) {
                          top = 10;
                        }

                        setTagRemovalPosition({ left, top });
                        setSelectedTagForRemoval(tag);
                        setShowTagRemovalMenu(true);
                      }}
                    >
                      {tag.tag}
                    </span>
                  </KanbanChromeTooltip>
                ))}
              {!showAllTags && liveTags.length > 3 && (
                <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-400 text-white">
                  +{liveTags.length - 3}
                </span>
              )}
            </div>
          </div>
          );
        })()}
        
        {/* Bottom metadata row */}
        <div className="flex items-center justify-between text-sm text-gray-500">
          {/* Left side - flow status, dates, effort, comments */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Before calendar: days-in-column and/or blocked (Ban replaces Clock when blocked) */}
            {(() => {
              const daysInColumn =
                !columnIsFinished && !columnIsArchived
                  ? getColumnAgeDays(task.columnEnteredAt)
                  : 0;
              const showDays = daysInColumn >= 1;
              const showBlocked = Boolean(task.isBlocked);
              if (!showDays && !showBlocked) return null;

              const daysLabel = showDays
                ? t('taskCard.daysInColumn', { count: daysInColumn })
                : null;
              const blockedLabel = task.blockedReason || t('taskCard.blocked');
              const tooltipLabel =
                showBlocked && showDays
                  ? `${blockedLabel} · ${daysLabel}`
                  : showBlocked
                    ? blockedLabel
                    : daysLabel || '';

              return (
                <KanbanChromeTooltip
                  label={tooltipLabel}
                  delayMs={0}
                  wrapperClassName="inline-flex shrink-0"
                >
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${
                      showBlocked
                        ? 'text-red-500 dark:text-red-400'
                        : daysInColumn >= 7
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-gray-500 dark:text-gray-400'
                    }`}
                    aria-label={tooltipLabel}
                  >
                    {showBlocked ? <Ban size={12} /> : <Clock size={12} />}
                    {showDays &&
                      t('taskCard.daysInColumnShort', { count: daysInColumn })}
                  </span>
                </KanbanChromeTooltip>
              );
            })()}
            {/* Dates - ultra compact with sprint selector */}
            <div className="flex items-center gap-0.5">
              <KanbanChromeTooltip label={t('taskCard.clickToSelectSprint')} delayMs={0} wrapperClassName="inline-flex">
                <div
                  ref={calendarIconRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    // Set flag to prevent card selection
                    isInteractingWithDropdownRef.current = true;
                    // Clear any pending click timer
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                    handleSprintSelectorOpen();
                    // Reset flag after delay
                    setTimeout(() => {
                      isInteractingWithDropdownRef.current = false;
                    }, 500);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    isInteractingWithDropdownRef.current = true;
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                  }}
                  data-tour-id="sprint-association"
                >
                  <Calendar
                    size={12}
                    className="cursor-pointer hover:text-blue-600 transition-colors"
                  />
                </div>
              </KanbanChromeTooltip>
              <KanbanChromeTooltip
                label={allowMutations ? t('taskCard.clickToChangeDates') : undefined}
                wrapperClassName="inline-flex"
              >
                <div
                  className={`text-[8px] leading-none font-mono rounded px-0.5 py-0.5 transition-colors ${
                    allowMutations ? 'cursor-pointer hover:bg-gray-100' : 'cursor-default'
                  }`}
                  onClick={handleDateRangeClick}
                >
                {/* Start Date */}
                <div
                  className={`${!dateValidation.startDateValid ? 'font-semibold ring-1 ring-red-400 rounded px-0.5' : ''}`}
                  onMouseEnter={(e) => {
                    if (!dateValidation.startDateValid) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDateTooltipPosition({
                        left: rect.left + rect.width / 2,
                        top: rect.top - 4
                      });
                      setShowStartDateTooltip(true);
                    }
                  }}
                  onMouseLeave={() => setShowStartDateTooltip(false)}
                >
                  {formatDate(task.startDate)}
                </div>
                {/* Due Date - directly underneath with zero spacing */}
                {task.dueDate && (
                  <div 
                    className={`${!dateValidation.dueDateValid ? 'font-semibold ring-1 ring-red-400 rounded px-0.5' : ''}`}
                    onMouseEnter={(e) => {
                      if (!dateValidation.dueDateValid) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDateTooltipPosition({
                          left: rect.left + rect.width / 2,
                          top: rect.top - 4
                        });
                        setShowDueDateTooltip(true);
                      }
                    }}
                    onMouseLeave={() => setShowDueDateTooltip(false)}
                  >
                    {formatDate(task.dueDate)}
                  </div>
                )}
                </div>
              </KanbanChromeTooltip>
            </div>
            
            {/* Effort - squeezed close */}
            <div className="flex items-center gap-0.5">
              <Clock size={12} />
              {isEditingEffort ? (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={editedEffort}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d{0,4}$/.test(v)) {
                      setEditedEffort(v);
                    }
                  }}
                  onBlur={handleEffortSave}
                  onKeyDown={handleEffortKeyDown}
                  className="text-xs bg-white border border-blue-400 rounded px-1 py-0.5 outline-none focus:border-blue-500 w-10"
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    isInteractingWithDropdownRef.current = true;
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    isInteractingWithDropdownRef.current = true;
                    if (clickTimerRef.current) {
                      clearTimeout(clickTimerRef.current);
                      clickTimerRef.current = null;
                    }
                  }}
                />
              ) : (
                <KanbanChromeTooltip label={t('taskCard.clickToChangeEffort')} wrapperClassName="inline-flex">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (!allowMutations) return;
                      // Set flag to prevent card selection
                      isInteractingWithDropdownRef.current = true;
                      // Clear any pending click timer
                      if (clickTimerRef.current) {
                        clearTimeout(clickTimerRef.current);
                        clickTimerRef.current = null;
                      }
                      setIsEditingEffort(true);
                      // Reset flag after delay
                      setTimeout(() => {
                        isInteractingWithDropdownRef.current = false;
                      }, 500);
                    }}
                    disabled={!allowMutations}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      isInteractingWithDropdownRef.current = true;
                      if (clickTimerRef.current) {
                        clearTimeout(clickTimerRef.current);
                        clickTimerRef.current = null;
                      }
                    }}
                    className="hover:bg-gray-100 rounded px-0.5 py-0.5 transition-colors cursor-pointer text-xs"
                  >
                    {formatEffortDisplay(task.effort, parseEffortUnit(siteSettings))}
                  </button>
                </KanbanChromeTooltip>
              )}
            </div>

            {/* Comments — always visible; gray when empty (click to add), blue when present */}
            <div
              ref={commentContainerRef}
              className="relative"
              onMouseEnter={() => {
                if (validComments.length > 0) handleCommentTooltipShow();
              }}
              onMouseLeave={handleCommentTooltipHide}
            >
              {(() => {
                const commentButton = (
                  <button
                    type="button"
                    className={`flex items-center gap-0.5 rounded px-1 py-1 transition-colors ${
                      validComments.length > 0
                        ? 'text-blue-600'
                        : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      isInteractingWithDropdownRef.current = true;
                      if (clickTimerRef.current) {
                        clearTimeout(clickTimerRef.current);
                        clickTimerRef.current = null;
                      }
                      if (validComments.length === 0) {
                        handleAddComment();
                      }
                      setTimeout(() => {
                        isInteractingWithDropdownRef.current = false;
                      }, 500);
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      isInteractingWithDropdownRef.current = true;
                      if (clickTimerRef.current) {
                        clearTimeout(clickTimerRef.current);
                        clickTimerRef.current = null;
                      }
                    }}
                    data-tour-id="task-card-comments"
                    aria-label={
                      validComments.length > 0
                        ? t('taskCard.hoverToViewComments')
                        : t('taskCard.addComment')
                    }
                  >
                    <MessageCircle size={12} />
                    {validComments.length > 0 && (
                      <span className="font-medium text-xs">{validComments.length}</span>
                    )}
                  </button>
                );
                // Preview panel already opens on hover when comments exist — skip chrome tip.
                if (validComments.length > 0) return commentButton;
                return (
                  <KanbanChromeTooltip
                    label={t('taskCard.addComment')}
                    wrapperClassName="inline-flex"
                  >
                    {commentButton}
                  </KanbanChromeTooltip>
                );
              })()}
            </div>
          </div>

          {/* Right side - attachments and priority */}
          <div className="flex items-center gap-2">
            {/* Attachments indicator - clickable */}
            {task.attachmentCount > 0 && (
              <div className="relative">
                <KanbanChromeTooltip
                  label={
                    task.attachmentCount > 1
                      ? t('taskCard.attachments', { count: task.attachmentCount })
                      : t('taskCard.attachment', { count: task.attachmentCount })
                  }
                  wrapperClassName="inline-flex"
                >
                  <button
                    ref={attachmentsButtonRef}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAttachmentsDropdown(!showAttachmentsDropdown);
                    }}
                    className="flex items-center gap-0.5 text-gray-500 hover:text-blue-600 cursor-pointer transition-colors"
                    data-stop-propagation
                  >
                    <Paperclip size={12} />
                    <span className="text-xs">{task.attachmentCount}</span>
                  </button>
                </KanbanChromeTooltip>
              </div>
            )}

            {/* Attachments Dropdown - Portal */}
            {showAttachmentsDropdown && createPortal(
              <div 
                ref={attachmentsDropdownRef}
                className="fixed w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999] max-h-80 overflow-y-auto"
                style={{
                  top: `${attachmentsDropdownPosition.top}px`,
                  left: `${attachmentsDropdownPosition.left}px`
                }}
              >
                <div className="p-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 px-2">
                    {t('taskCard.attachmentsTitle', { count: task.attachmentCount })}
                  </div>
                  {taskAttachments
                    .filter(att => !att.name.startsWith('img-'))
                    .map((attachment) => (
                      <a
                        key={attachment.id}
                        href={getAuthenticatedAttachmentUrl(attachment.url) || attachment.url}
                        {...(siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true' 
                          ? { target: '_blank', rel: 'noopener noreferrer' } 
                          : {})}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 px-2 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        <Paperclip size={14} className="flex-shrink-0 text-gray-400" />
                        <span className="truncate flex-1">{attachment.name}</span>
                      </a>
                    ))}
                  {taskAttachments.filter(att => !att.name.startsWith('img-')).length === 0 && (
                    <div className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                      {t('taskCard.loadingAttachments')}
                    </div>
                  )}
                </div>
              </div>,
              document.body
            )}

            {/* Priority */}
            <div className="relative priority-container">
              <KanbanChromeTooltip label={t('taskCard.clickToChangePriority')} wrapperClassName="inline-flex">
                <button
                  ref={priorityButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!allowMutations) return;
                    setShowPrioritySelect(!showPrioritySelect);
                  }}
                  disabled={!allowMutations}
                  className={`px-2 py-1 rounded-full text-xs hover:opacity-80 transition-all ${
                    allowMutations ? 'cursor-pointer' : 'cursor-default'
                  } ${showPrioritySelect ? 'ring-2 ring-blue-400' : ''}`}
                  style={(() => {
                // Always use priorityId to find the current priority (handles renamed priorities)
                // Fall back to priorityName from API (from JOIN), then stored priority name
                let priorityOption = task.priorityId 
                  ? availablePriorities.find(p => p.id === task.priorityId)
                  : null;
                
                // If priorityId lookup failed, try priorityName (from WebSocket JOIN)
                if (!priorityOption && task.priorityName) {
                  priorityOption = availablePriorities.find(p => p.priority === task.priorityName);
                }
                
                // Last fallback: try stored priority name
                if (!priorityOption && task.priority) {
                  priorityOption = availablePriorities.find(p => p.priority === task.priority);
                }
                
                // If we have priorityColor from WebSocket but no matching priority in availablePriorities,
                // use the color directly (handles deleted priority reassignment)
                if (!priorityOption && task.priorityColor) {
                  return getPriorityColors(task.priorityColor);
                }
                
                return priorityOption ? getPriorityColors(priorityOption.color) : { backgroundColor: '#f3f4f6', color: '#6b7280' };
                  })()}
                >
                  {(() => {
                // Always use priorityId to look up current priority name (handles renamed priorities)
                // This ensures we show the current name, not the old stored name
                if (task.priorityId) {
                  const priorityOption = availablePriorities.find(p => p.id === task.priorityId);
                  if (priorityOption) {
                    return priorityOption.priority; // Use current name from availablePriorities
                  }
                }
                // Fallback: use priorityName from API (from JOIN), or stored priority name
                    return task.priorityName || task.priority || '';
                  })()}
                </button>
              </KanbanChromeTooltip>

            {/* Completed Column Banner Overlay - positioned over priority */}
            {columnIsFinished && !columnIsArchived && (
              <div className="absolute inset-0 pointer-events-none z-30">
                {/* Diagonal banner background */}
                <div className="absolute top-0 right-0 w-full h-full">
                  <div 
                    className="absolute top-0 right-0 w-0 h-0"
                    style={{
                      borderLeft: '60px solid transparent',
                      borderBottom: '100% solid rgba(34, 197, 94, 0.2)',
                      transform: 'translateX(0)'
                    }}
                  />
                </div>
                {/* "DONE" stamp */}
                <div className="absolute top-0.5 right-0.5">
                  <div className="bg-green-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-lg opacity-95 transform -rotate-12">
                    {t('taskCard.done')}
                  </div>
                </div>
              </div>
            )}
            
            {/* Overdue Task Banner Overlay - positioned over priority */}
            {!columnIsFinished && !columnIsArchived && isOverdue() && siteSettings?.HIGHLIGHT_OVERDUE_TASKS === 'true' && (
              <div className="absolute inset-0 pointer-events-none z-30">
                {/* Diagonal banner background */}
                <div className="absolute top-0 right-0 w-full h-full">
                  <div 
                    className="absolute top-0 right-0 w-0 h-0"
                    style={{
                      borderLeft: '60px solid transparent',
                      borderBottom: '100% solid rgba(239, 68, 68, 0.2)',
                      transform: 'translateX(0)'
                    }}
                  />
                </div>
                {/* "LATE" stamp */}
                <div className="absolute top-0.5 right-0.5">
                  <div className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-lg opacity-95 transform -rotate-12">
                    {t('taskCard.late')}
                  </div>
                </div>
              </div>
            )}

            </div>
          </div>
        </div>
      </div>

      {/* Priority Dropdown - Portal */}
      {showPrioritySelect && createPortal(
        <div 
          ref={priorityDropdownRef}
          className="fixed w-24 bg-white dark:bg-gray-800 rounded-md shadow-lg z-[9999] border border-gray-200 dark:border-gray-700"
          style={{
            top: `${priorityDropdownPosition.top}px`,
            left: `${priorityDropdownPosition.left}px`
          }}
        >
          {availablePriorities
            .filter(priorityOption => priorityOption.id !== task.priorityId)
            .map(priorityOption => (
              <button
                key={priorityOption.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePriorityChange(priorityOption.id);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0 flex items-center gap-2"
              >
                <div 
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: priorityOption.color }}
                />
                {priorityOption.priority}
              </button>
            ))}
        </div>,
        document.body
      )}



      {showAgentPanel && (
        <AgentPanel
          panelId={task.id}
          taskTitle={agentFormTask?.title ?? task.title}
          taskTicket={task.ticket}
          taskDescription={agentFormTask?.description ?? task.description}
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
            setAgentFormTask(null);
          }}
          onControl={handleAgentControl}
          onUndo={handleAutomationUndo}
          onRefine={handleAgentRefine}
          onSaveConfig={handleAgentPanelSaveConfig}
          aiEnabled={siteSettings?.AI_ENABLED === 'true'}
          isAssigned={task.memberId === AGENT_MEMBER_ID}
        />
      )}
      <AddCommentModal
        isOpen={showAddCommentModal}
        taskTitle={task.title}
        onClose={() => setShowAddCommentModal(false)}
        onSubmit={handleCommentSubmit}
      />

      {/* Portal-rendered comment tooltip */}
      {showCommentTooltip && createPortal(
        <div
          ref={commentTooltipRef}
          className={`comment-tooltip fixed z-[9999] ${CHROME_TOOLTIP_PANEL_SURFACE_CLASS}`}
          style={{
            left: `${tooltipPosition.left}px`,
            top: `${tooltipPosition.top}px`
          }}
          onMouseEnter={handleCommentTooltipShow}
          onMouseLeave={handleCommentTooltipHide}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
                      {/* Scrollable comments area */}
                      <div className="p-3 overflow-y-auto flex-1">
                    {validComments
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((comment, index) => {
                        const author = members.find(m => m.id === comment.authorId);
                        
                        // Function to render HTML content with safe link handling and blob URL fixing
                        const renderCommentHTML = (htmlText: string) => {
                          // First, fix blob URLs by replacing them with authenticated server URLs (matching TaskDetails/TaskPage)
                          let fixedContent = commentTextToHtml(htmlText);
                          const blobPattern = /blob:[^"]*#(img-[^"]*)/g;
                          fixedContent = fixedContent.replace(blobPattern, (_match, filename) => {
                            // Convert blob URL to authenticated server URL
                            const authenticatedUrl = getAuthenticatedAttachmentUrl(`/attachments/${filename}`);
                            return authenticatedUrl || `/uploads/${filename}`;
                          });
                          
                          // Fallback: Remove ANY remaining blob URLs that couldn't be matched
                          if (fixedContent.includes('blob:')) {
                            // Replace remaining blob URLs in img tags
                            fixedContent = fixedContent.replace(/<img[^>]*src="blob:[^"]*"[^>]*>/gi, '<!-- Image removed: blob URL expired -->');
                            // Also replace any blob URLs in other contexts
                            fixedContent = fixedContent.replace(/blob:[^\s"')]+/gi, '');
                          }

                          fixedContent = DOMPurify.sanitize(fixedContent);
                          
                          // Create a temporary div to parse the HTML
                          const tempDiv = document.createElement('div');
                          tempDiv.innerHTML = fixedContent;
                          
                          // Find all links and update their attributes for safety
                          const links = tempDiv.querySelectorAll('a');
                          const opensInNewTab = siteSettings?.SITE_OPENS_NEW_TAB === undefined || siteSettings?.SITE_OPENS_NEW_TAB === 'true';
                          
                          links.forEach(link => {
                            if (opensInNewTab) {
                              link.setAttribute('target', '_blank');
                              link.setAttribute('rel', 'noopener noreferrer');
                            } else {
                              link.removeAttribute('target');
                            }
                            link.style.color = '#60a5fa'; // text-blue-400
                            link.style.textDecoration = 'underline';
                            link.style.wordBreak = 'break-all';
                            link.style.cursor = 'pointer';
                            
                            // Add click handler
                            link.addEventListener('click', (e) => {
                              e.stopPropagation();
                              if (opensInNewTab) {
                                window.open(link.href, '_blank', 'noopener,noreferrer');
                              } else {
                                window.location.href = link.href;
                              }
                            });
                            
                            link.addEventListener('mousedown', (e) => {
                              e.stopPropagation();
                            });
                          });
                          
                          return (
                            <span 
                              dangerouslySetInnerHTML={{ __html: tempDiv.innerHTML }}
                              className="select-text"
                            />
                          );
                        };

                        return (
                          <div key={comment.id} className={`mb-3 ${index > 0 ? 'pt-2 border-t border-gray-700 dark:border-gray-300' : ''}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <div 
                                className="w-2 h-2 rounded-full flex-shrink-0" 
                                style={{ backgroundColor: author?.color || '#6B7280' }} 
                              />
                              <span className="font-medium text-gray-200 dark:text-gray-800">{author?.name || 'Unknown'}</span>
                              <span className="text-gray-400 dark:text-gray-600 text-xs">
                                {formatDateTime(comment.createdAt)}
                              </span>
                              {comment.attachments && comment.attachments.length > 0 && (
                                <KanbanChromeTooltip
                                  label={t('taskCard.attachments', { count: comment.attachments.length })}
                                  wrapperClassName="inline-flex"
                                >
                                  <Paperclip size={12} className="text-gray-400 dark:text-gray-600" />
                                </KanbanChromeTooltip>
                              )}
                            </div>
                            <div className="text-gray-300 dark:text-gray-700 text-xs leading-relaxed select-text comment-md">
                              {renderCommentHTML(comment.text)}
                            </div>
                          </div>
                        );
                        })}
                      </div>
                      
                      {/* Sticky footer */}
                      <div className="border-t border-gray-700 dark:border-gray-300 p-3 bg-gray-900 dark:bg-gray-100 rounded-b-md flex items-center justify-between gap-2">
                        <span className="text-gray-300 dark:text-gray-800 font-medium">
                          {t('taskCard.comments', { count: validComments.length })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <KanbanChromeTooltip label={t('taskCard.addComment')} wrapperClassName="inline-flex">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowCommentTooltip(false);
                                handleAddComment();
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded bg-gray-700 hover:bg-gray-600 text-gray-100 dark:bg-gray-300 dark:hover:bg-gray-400 dark:text-gray-900 transition-colors"
                              aria-label={t('taskCard.addComment')}
                            >
                              <Plus size={14} />
                            </button>
                          </KanbanChromeTooltip>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(task, { scrollToComments: true });
                            }}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                          >
                            {t('taskCard.open')}
                          </button>
                        </div>
                      </div>
        </div>,
        document.body
      )}

      {/* Tag Removal Confirmation Menu - Portal */}
      {showTagRemovalMenu && selectedTagForRemoval && createPortal(
        <div 
          ref={tagRemovalMenuRef}
          data-tag-removal-menu="true"
          className="fixed w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg z-[9999] p-3"
          style={{ 
            left: `${tagRemovalPosition.left}px`, 
            top: `${tagRemovalPosition.top}px`
          }}
          onClick={(e) => {
            e.stopPropagation(); // Prevent clicks inside menu from bubbling to card
            e.preventDefault();
          }}
          onMouseDown={(e) => {
            e.stopPropagation(); // Also prevent mousedown from triggering card selection
          }}
          onMouseUp={(e) => {
            e.stopPropagation(); // Prevent mouseup from triggering card selection
          }}
        >
          <div className="text-sm font-medium text-gray-800 mb-2">
            {t('taskCard.removeTag')}
                    </div>
          <div className="text-xs text-gray-600 mb-3">
            {t('taskCard.removeTagConfirm', { tag: selectedTagForRemoval.tag })}
              </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation(); // Prevent event from bubbling to card onClick
                e.preventDefault();
                handleConfirmTagRemoval(e);
              }}
              className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
            >
              {t('taskCard.remove')}
            </button>
                    <button
              onClick={(e) => {
                e.stopPropagation(); // Prevent event from bubbling to card onClick
                e.preventDefault();
                handleCancelTagRemoval();
              }}
              className="flex-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded transition-colors"
            >
              {t('taskCard.cancel')}
                    </button>
              </div>
        </div>,
        document.body
      )}

      {/* Portal-rendered Sprint Selector Dropdown */}
      {showSprintSelector && sprintSelectorCoords && createPortal(
        <div
          ref={sprintSelectorRef}
          data-sprint-selector="true"
          className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[9999]"
          style={{
            left: `${sprintSelectorCoords.left}px`,
            top: `${sprintSelectorCoords.top}px`,
            width: '256px',
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            isInteractingWithDropdownRef.current = true;
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            isInteractingWithDropdownRef.current = true;
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
          }}
        >
          <div className="p-2">
            <input
              type="text"
              value={sprintSearchTerm}
              onChange={(e) => setSprintSearchTerm(e.target.value)}
              onKeyDown={handleSprintKeyDown}
              placeholder={t('taskCard.searchSprints')}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              autoFocus
            />
          </div>
          
          <div className="max-h-60 overflow-y-auto">
            {sprintsLoading ? (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                {t('taskCard.loadingSprints')}
              </div>
            ) : (
              <>
                {/* "None (Backlog)" option */}
                {'backlog'.includes(sprintSearchTerm.toLowerCase()) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSprintSelect(null);
                    }}
                    onMouseEnter={() => setHighlightedSprintIndex(-1)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-200 dark:border-gray-600 ${
                      task.sprintId === null
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-l-2 border-blue-500'
                        : highlightedSprintIndex === -1
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {task.sprintId === null && (
                          <Check className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        )}
                        <div className="font-medium text-gray-900 dark:text-white">
                          {t('taskCard.noneBacklog')}
                        </div>
                      </div>
                      <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-400 dark:bg-gray-600 text-white">
                        {t('taskCard.unassigned')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('taskCard.removeFromSprint')}
                    </div>
                  </button>
                )}
                
                {sprints.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    {t('taskCard.noSprintsAvailable')}
                  </div>
                ) : (
                  sprints
                    .filter(sprint =>
                      sprint.name.toLowerCase().includes(sprintSearchTerm.toLowerCase())
                    )
                    .map((sprint, index) => (
                      <button
                        key={sprint.id}
                        ref={(el) => (sprintOptionRefs.current[index] = el)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSprintSelect(sprint);
                        }}
                        onMouseEnter={() => setHighlightedSprintIndex(index)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      task.sprintId === sprint.id
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-l-2 border-blue-500'
                        : highlightedSprintIndex === index
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : sprint.is_active === 1 || sprint.is_active === true
                        ? 'bg-green-50 dark:bg-green-900/10'
                        : ''
                    }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {task.sprintId === sprint.id && (
                              <Check className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            )}
                            <div className="font-medium text-gray-900 dark:text-white">
                              {sprint.name}
                            </div>
                          </div>
                          {(sprint.is_active === 1 || sprint.is_active === true) && (
                            <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-500 text-white">
                              {t('taskCard.active')}
                            </span>
                          )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDate(sprint.start_date)} → {formatDate(sprint.end_date)}
                    </div>
                  </button>
                ))
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Date Range Picker */}
      {showDateRangePicker && dateRangePickerPosition && (
        <DateRangePicker
          startDate={task.startDate || ''}
          endDate={task.dueDate}
          onDateChange={handleDateRangeChange}
          onClose={handleDateRangePickerClose}
          position={dateRangePickerPosition}
          sprint={task.sprintId && sprints.length > 0 ? sprints.find(s => s.id === task.sprintId) : null}
          availableSprints={sprints}
          sprintsLoading={sprintsLoading}
          onSprintSelect={(sprint) => {
            handleSprintSelect(sprint);
          }}
        />
      )}

      {/* Date Validation Tooltip */}
      {(showStartDateTooltip || showDueDateTooltip) && dateTooltipPosition && createPortal(
        <div
          ref={dateTooltipRef}
          className={`fixed z-[10000] ${CHROME_TOOLTIP_SURFACE_CLASS} transform -translate-x-1/2 -translate-y-full`}
          style={{
            left: `${dateTooltipPosition.left}px`,
            top: `${dateTooltipPosition.top}px`,
          }}
        >
          {showStartDateTooltip && dateValidation.startDateError}
          {showDueDateTooltip && dateValidation.dueDateError}
        </div>,
        document.body
      )}
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent unnecessary re-renders
  // Only re-render if props that actually affect the component have changed
  
  // Always re-render if task data changes
  if (prevProps.task.id !== nextProps.task.id ||
      prevProps.task.title !== nextProps.task.title ||
      prevProps.task.description !== nextProps.task.description ||
      prevProps.task.position !== nextProps.task.position ||
      prevProps.task.columnId !== nextProps.task.columnId ||
      prevProps.task.memberId !== nextProps.task.memberId ||
      prevProps.task.requesterId !== nextProps.task.requesterId ||
      prevProps.task.priority !== nextProps.task.priority ||
      prevProps.task.sprintId !== nextProps.task.sprintId ||
      prevProps.task.effort !== nextProps.task.effort ||
      prevProps.task.startDate !== nextProps.task.startDate ||
      prevProps.task.dueDate !== nextProps.task.dueDate ||
      prevProps.task.attachmentCount !== nextProps.task.attachmentCount ||
      Boolean(prevProps.task.isBlocked) !== Boolean(nextProps.task.isBlocked) ||
      (prevProps.task.blockedReason || '') !== (nextProps.task.blockedReason || '') ||
      (prevProps.task.columnEnteredAt || '') !== (nextProps.task.columnEnteredAt || '')) {
    return false; // Re-render
  }

  // Watchers / collaborators (icons + counts on the card toolbar)
  const prevWatchers = prevProps.task.watchers || [];
  const nextWatchers = nextProps.task.watchers || [];
  if (prevWatchers.length !== nextWatchers.length) {
    return false;
  }
  const prevWatcherIds = prevWatchers.map(w => w?.id).filter(Boolean).sort().join(',');
  const nextWatcherIds = nextWatchers.map(w => w?.id).filter(Boolean).sort().join(',');
  if (prevWatcherIds !== nextWatcherIds) {
    return false;
  }
  const prevCollaborators = prevProps.task.collaborators || [];
  const nextCollaborators = nextProps.task.collaborators || [];
  if (prevCollaborators.length !== nextCollaborators.length) {
    return false;
  }
  const prevCollaboratorIds = prevCollaborators.map(c => c?.id).filter(Boolean).sort().join(',');
  const nextCollaboratorIds = nextCollaborators.map(c => c?.id).filter(Boolean).sort().join(',');
  if (prevCollaboratorIds !== nextCollaboratorIds) {
    return false;
  }
  
  // CRITICAL: Check if tags changed - tags array reference or content
  const prevTags = prevProps.task.tags || [];
  const nextTags = nextProps.task.tags || [];
  if (prevTags.length !== nextTags.length) {
    return false; // Re-render - tag count changed
  }
  // Check if tag IDs changed (more efficient than deep comparison)
  const prevTagIds = prevTags.map(t => t.id).sort().join(',');
  const nextTagIds = nextTags.map(t => t.id).sort().join(',');
  if (prevTagIds !== nextTagIds) {
    return false; // Re-render - tags changed
  }
  
  // CRITICAL: Check if comments changed - comments array length or IDs
  const prevComments = prevProps.task.comments || [];
  const nextComments = nextProps.task.comments || [];
  if (prevComments.length !== nextComments.length) {
    return false; // Re-render - comment count changed
  }
  // Check if comment IDs changed (more efficient than deep comparison)
  const prevCommentIds = prevComments.map(c => c?.id).filter(Boolean).sort().join(',');
  const nextCommentIds = nextComments.map(c => c?.id).filter(Boolean).sort().join(',');
  if (prevCommentIds !== nextCommentIds) {
    return false; // Re-render - comments changed
  }
  
  // Re-render if selected task changes
  if (prevProps.selectedTask?.id !== nextProps.selectedTask?.id) {
    return false;
  }

  if (prevProps.isChecked !== nextProps.isChecked) {
    return false;
  }
  if (prevProps.isMultiSelectDragLocked !== nextProps.isMultiSelectDragLocked) {
    return false;
  }
  
  // Re-render if assignee identity OR display fields change.
  // After demo reset, members often load after cards: stub → real member keeps the
  // same id but gains name/color/avatar — must not skip that update.
  if (
    prevProps.member?.id !== nextProps.member?.id ||
    prevProps.member?.name !== nextProps.member?.name ||
    prevProps.member?.color !== nextProps.member?.color ||
    prevProps.member?.avatarUrl !== nextProps.member?.avatarUrl ||
    prevProps.member?.googleAvatarUrl !== nextProps.member?.googleAvatarUrl
  ) {
    return false;
  }

  // Assignee dropdown / mentions need a fresh members list after late hydrate
  if ((prevProps.members?.length || 0) !== (nextProps.members?.length || 0)) {
    return false;
  }
  
  // Re-render if linking mode state changes
  if (prevProps.isLinkingMode !== nextProps.isLinkingMode ||
      prevProps.linkingSourceTask?.id !== nextProps.linkingSourceTask?.id) {
    return false;
  }
  
  // Re-render if hovered link task changes
  if (prevProps.hoveredLinkTask?.id !== nextProps.hoveredLinkTask?.id) {
    return false;
  }

  // Relationships list may load after hover — must refresh PARENT/CHILD badges
  if (prevProps.getTaskRelationshipType !== nextProps.getTaskRelationshipType) {
    return false;
  }

  if (prevProps.highlightLinksMode !== nextProps.highlightLinksMode) {
    return false;
  }

  const prevRel = prevProps.relationSummary;
  const nextRel = nextProps.relationSummary;
  if (
    prevRel?.hasAny !== nextRel?.hasAny ||
    prevRel?.hasParent !== nextRel?.hasParent ||
    prevRel?.hasChildren !== nextRel?.hasChildren ||
    prevRel?.hasRelated !== nextRel?.hasRelated
  ) {
    return false;
  }
  
  // IGNORE isDragDisabled changes when it's just due to column drag
  // This prevents thousands of re-renders when dragging a column
  // Only re-render if isDragDisabled changes AND it's not just because a column is being dragged
  if (prevProps.isDragDisabled !== nextProps.isDragDisabled) {
    // If isColumnBeingDragged is true, ignore isDragDisabled changes
    // This means the drag disable is just because a column is being dragged,
    // not because of actual task drag state
    if (nextProps.isColumnBeingDragged) {
      // Don't re-render just because column drag disabled tasks
      // But still check other props
    } else {
      // isDragDisabled changed for a real reason (not column drag)
      return false; // Re-render
    }
  }
  
  // Re-render if column state changes
  if (getArchivedColumnId(prevProps.columns) !== getArchivedColumnId(nextProps.columns)) {
    return false;
  }

  if (prevProps.columnIsFinished !== nextProps.columnIsFinished ||
      prevProps.columnIsArchived !== nextProps.columnIsArchived) {
    return false;
  }
  
  // Re-render if available tags/priorities/sprints arrays change (reference check)
  if (prevProps.availableTags !== nextProps.availableTags ||
      prevProps.availablePriorities !== nextProps.availablePriorities ||
      prevProps.availableSprints !== nextProps.availableSprints) {
    return false;
  }
  
  // Re-render if sprint filter changes
  if (prevProps.selectedSprintId !== nextProps.selectedSprintId) {
    return false;
  }
  
  // Re-render if task view mode changes (expanded/compact/shrink)
  if (prevProps.taskViewMode !== nextProps.taskViewMode) {
    return false;
  }
  
  // All other prop changes can be ignored (like callback functions, etc.)
  // These don't affect the visual output
  return true; // Don't re-render
});

export default TaskCard;
