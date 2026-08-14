import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Copy, Eye, UserPlus, GripVertical, TagIcon, Plus, Trash2, Link, Archive } from 'lucide-react';
import { Task, TeamMember, Tag } from '../types';
import { formatMembersTooltip } from '../utils/taskUtils';
import { getAuthenticatedAvatarUrl } from '../utils/authImageUrl';
import AddTagModal from './AddTagModal';
import MemberSearchList from './ui/MemberSearchList';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import AgentStatusButton from './AgentStatusButton';
import {
  AGENT_MEMBER_ID,
  SYSTEM_MEMBER_ID,
  AGENT_DRAG_BLOCKING_STATUSES,
} from '../constants/appConstants';
import {
  getAgentAvatarSrc,
  isAgentMemberId,
} from '../utils/agentMemberUi';
import type { TaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import { getTaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import { getArchivedColumnId, isArchivedColumnFlag } from '../utils/columnUtils';

interface TaskCardToolbarProps {
  task: Task;
  member: TeamMember;
  members: TeamMember[];
  isDragDisabled?: boolean;
  showMemberSelect: boolean;
  onCopy: (task: Task) => void;
  onEdit: (task: Task) => void;
  onSelect: (task: Task, options?: { scrollToComments?: boolean }) => void;
  onRemove: (taskId: string, event?: React.MouseEvent) => void;
  onMemberChange: (memberId: string) => void;
  onToggleMemberSelect: () => void;
  /** Close assignee menu without toggling (outside click / exclusive open). */
  onCloseMemberSelect: () => void;
  setDropdownPosition: (position: 'above' | 'below') => void;
  dropdownPosition: 'above' | 'below';
  listeners?: any; // DnD kit listeners
  attributes?: any; // DnD kit attributes
  availableTags?: Tag[];
  onTagAdd?: (tagId: string) => void;
  columnIsFinished?: boolean;
  columns?: { [key: string]: { id: string; title: string; is_archived?: boolean; is_finished?: boolean } };
  /** Agent task_work.status when assigned to Agent */
  agentWorkStatus?: string | null;
  onOpenAgentActivity?: () => void;
  
  // Task linking props
  isLinkingMode?: boolean;
  linkingSourceTask?: Task | null;
  onStartLinking?: (task: Task, startPosition: {x: number, y: number}) => void;
  
  // Hover highlighting props
  hoveredLinkTask?: Task | null;
  onLinkToolHover?: (task: Task) => void;
  onLinkToolHoverEnd?: () => void;
  relationSummary?: TaskRelationshipSummary;
  /** When true, card owns hover-end so leaving the link control does not clear badges */
  highlightLinksMode?: boolean;
  getTaskRelationshipType?: (taskId: string) => 'parent' | 'child' | 'related' | null;
  onUnlinkRelatedTask?: (targetTask: Task) => void | Promise<void>;
  
  // Toolbar pinned open when editing or selected; hover uses parent `group` + group-hover
  isEditingTitle?: boolean;
  isEditingDescription?: boolean;
  isSelected?: boolean;
  /** Show Shift+click permanent-delete hint on trash tooltip. */
  isAdmin?: boolean;
  /** When false, only show assignee avatar + watcher/collaborator counts (read-only). */
  canMutate?: boolean;
}

export default function TaskCardToolbar({
  task,
  member,
  members,
  isDragDisabled = false,
  showMemberSelect,
  onCopy,
  onEdit,
  onSelect,
  onRemove,
  onMemberChange,
  onToggleMemberSelect,
  onCloseMemberSelect,
  setDropdownPosition: _setDropdownPosition,
  dropdownPosition: _dropdownPosition,
  listeners,
  attributes,
  availableTags = [],
  onTagAdd,
  columnIsFinished = false,
  columns,
  agentWorkStatus = null,
  onOpenAgentActivity,
  
  // Task linking props
  isLinkingMode,
  linkingSourceTask,
  onStartLinking,
  
  // Hover highlighting props
  hoveredLinkTask,
  onLinkToolHover,
  onLinkToolHoverEnd,
  relationSummary: relationSummaryProp,
  highlightLinksMode = false,
  getTaskRelationshipType,
  onUnlinkRelatedTask,
  
  isEditingTitle = false,
  isEditingDescription = false,
  isSelected = false,
  isAdmin = false,
  canMutate = true,
}: TaskCardToolbarProps) {
  const { t } = useTranslation('tasks');
  const _priorityButtonRef = useRef<HTMLButtonElement>(null);
  const [showQuickTagDropdown, setShowQuickTagDropdown] = useState(false);
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [tagDropdownPosition, setTagDropdownPosition] = useState<{left: number, top: number}>({left: 0, top: 0});
  const quickTagButtonRef = useRef<HTMLButtonElement>(null);
  const quickTagDropdownRef = useRef<HTMLDivElement>(null);
  const memberButtonRef = useRef<HTMLButtonElement>(null);
  
  const toolbarPinnedOpen =
    isEditingTitle || isEditingDescription || isSelected;

  const relationSummary =
    relationSummaryProp ?? getTaskRelationshipSummary(undefined, task.id);
  const hasRelations = relationSummary.hasAny;
  const highlightedAsRelated =
    !!hoveredLinkTask &&
    hoveredLinkTask.id !== task.id &&
    !!getTaskRelationshipType?.(task.id);

  const handleCopy = () => {
    onCopy(task);
  };

  // State for drag-to-link logic
  const [isDragPrepared, setIsDragPrepared] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState<{x: number, y: number} | null>(null);
  const dragThreshold = 5; // Minimum pixels to consider it a drag

  const handleLinkPointerDown = (e: React.PointerEvent) => {
    // CRITICAL: Prevent the task card's drag listeners from interfering
    e.preventDefault();
    e.stopPropagation();
    
    // Use the actual mouse position when clicking, not the button center
    // This prevents false drag detection when clicking the button
    const startPos = { x: e.clientX, y: e.clientY };
    
    // Prepare for potential drag, but don't start linking yet
    setIsDragPrepared(true);
    setDragStartPosition(startPos);
  };
  
  const handleLinkMouseDown = (e: React.MouseEvent) => {
    // Also handle mousedown as fallback
    e.preventDefault();
    e.stopPropagation();
    
    const startPos = { x: e.clientX, y: e.clientY };
    setIsDragPrepared(true);
    setDragStartPosition(startPos);
  };
  
  // Handle global mouse/pointer move to detect drag while holding down
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragPrepared && dragStartPosition && onStartLinking) {
        const currentX = e.clientX;
        const currentY = e.clientY;
        const deltaX = Math.abs(currentX - dragStartPosition.x);
        const deltaY = Math.abs(currentY - dragStartPosition.y);
        
        // If moved beyond threshold, start linking mode
        if (deltaX > dragThreshold || deltaY > dragThreshold) {
          setIsDragPrepared(false);
          onStartLinking(task, dragStartPosition);
          setDragStartPosition(null);
        }
      }
    };

    const handleGlobalPointerMove = (e: PointerEvent) => {
      // Also handle pointer events for better cross-device support
      if (isDragPrepared && dragStartPosition && onStartLinking) {
        const currentX = e.clientX;
        const currentY = e.clientY;
        const deltaX = Math.abs(currentX - dragStartPosition.x);
        const deltaY = Math.abs(currentY - dragStartPosition.y);
        
        // If moved beyond threshold, start linking mode
        if (deltaX > dragThreshold || deltaY > dragThreshold) {
          setIsDragPrepared(false);
          onStartLinking(task, dragStartPosition);
          setDragStartPosition(null);
        }
      }
    };

    const handleGlobalMouseUp = (_e: MouseEvent) => {
      if (isDragPrepared) {
        // Released without dragging - cancel linking
        setIsDragPrepared(false);
        setDragStartPosition(null);
      }
    };

    const handleGlobalPointerUp = (_e: PointerEvent) => {
      if (isDragPrepared) {
        // Released without dragging - cancel linking
        setIsDragPrepared(false);
        setDragStartPosition(null);
      }
    };

    if (isDragPrepared) {
      // Listen to both mouse and pointer events for better cross-device support
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('pointermove', handleGlobalPointerMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      document.addEventListener('pointerup', handleGlobalPointerUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('pointermove', handleGlobalPointerMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [isDragPrepared, dragStartPosition, onStartLinking, task]);

  // Filter out tags that are already assigned to the task
  const availableTagsForAssignment = availableTags.filter(tag => 
    !task.tags?.some(taskTag => taskTag.id === tag.id)
  );

  // Debug logging removed for clarity

  const handleQuickTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!showQuickTagDropdown && quickTagButtonRef.current) {
      // Calculate position for portal dropdown
      const rect = quickTagButtonRef.current.getBoundingClientRect();
      const dropdownWidth = 200;
      const dropdownHeight = 200;
      
      // Position below the button, centered
      let left = rect.left + (rect.width / 2) - (dropdownWidth / 2);
      let top = rect.bottom + 5;
      
      // Keep within viewport
      if (left + dropdownWidth > window.innerWidth - 20) {
        left = window.innerWidth - dropdownWidth - 20;
      }
      if (left < 20) {
        left = 20;
      }
      if (top + dropdownHeight > window.innerHeight - 20) {
        top = rect.top - dropdownHeight - 5; // Position above instead
      }
      
      setTagDropdownPosition({ left, top });
    }
    
    setShowQuickTagDropdown(!showQuickTagDropdown);
  };

  const handleQuickTagSelect = (tagId: string) => {
    if (onTagAdd) {
      onTagAdd(tagId);
    }
    setShowQuickTagDropdown(false); // Close immediately after selection
  };

  const handleTagCreated = (newTag: Tag) => {
    // Automatically add the newly created tag to the current task
    if (onTagAdd) {
      onTagAdd(newTag.id.toString());
    }
  };

  // Calculate member dropdown position for portal rendering
  const getMemberDropdownPosition = () => {
    if (memberButtonRef.current) {
      const dropdownWidth = 280;
      const rect = memberButtonRef.current.getBoundingClientRect();

      // Search header (~52) + agent section padding + rows; cap to viewport
      const searchHeaderHeight = 52;
      const memberItemHeight = 40;
      const availableSpaceBelow = window.innerHeight - rect.bottom - 20;
      const availableSpaceAbove = rect.top - 20;
      const maxAvailableSpace = Math.max(availableSpaceBelow, availableSpaceAbove);
      const maxVisibleMembers = Math.floor(
        Math.max(80, maxAvailableSpace - searchHeaderHeight) / memberItemHeight
      );
      const visibleMembers = Math.max(3, Math.min(10, maxVisibleMembers, members.length || 3));
      const dropdownHeight = searchHeaderHeight + visibleMembers * memberItemHeight + 24;

      let left = rect.right - dropdownWidth;
      let top = rect.bottom + 5;

      if (left < 20) left = 20;
      if (left + dropdownWidth > window.innerWidth - 20) {
        left = window.innerWidth - dropdownWidth - 20;
      }
      if (top + dropdownHeight > window.innerHeight - 20) {
        top = rect.top - dropdownHeight - 5;
      }

      return { left, top, height: dropdownHeight, width: dropdownWidth };
    }
    return { left: 0, top: 0, height: 280, width: 280 };
  };

  // Close quick tag dropdown when clicking outside
  useEffect(() => {
    if (!showQuickTagDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      
      // Check if click is inside the portal dropdown (using both data attribute and ref)
      const tagDropdown = target.closest('[data-tag-dropdown]');
      if (tagDropdown || (quickTagDropdownRef.current && quickTagDropdownRef.current.contains(target))) {
        return; // Click is inside dropdown, don't close
      }
      
      // Check if click is on the button itself - if so, let the toggle handle it
      if (quickTagButtonRef.current && quickTagButtonRef.current.contains(target)) {
        // The button's onClick will toggle, so we don't need to close here
        return;
      }
      
      // Click is outside both button and dropdown, close it
      setShowQuickTagDropdown(false);
    };

    // Use mousedown (not click) to catch events before stopPropagation can interfere
    document.addEventListener('mousedown', handleClickOutside);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showQuickTagDropdown]);

  // Close member dropdown when clicking outside (capture so other avatars' stopPropagation cannot block it)
  useEffect(() => {
    if (!showMemberSelect) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        memberButtonRef.current?.contains(target) ||
        target.closest('[data-member-dropdown]')
      ) {
        return;
      }
      onCloseMemberSelect();
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [showMemberSelect, onCloseMemberSelect]);

  const handleMemberToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleMemberSelect();
  };

  const isAgentAssigned = member.id === AGENT_MEMBER_ID;
  const agentBlocking =
    isAgentAssigned &&
    !!agentWorkStatus &&
    (AGENT_DRAG_BLOCKING_STATUSES as readonly string[]).includes(agentWorkStatus);

  const agentLockedLabel = t('toolbar.disabledWhileAgent');

  const toolbarHoverVisibility = toolbarPinnedOpen
    ? 'pointer-events-auto opacity-100'
    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100';

  // Fixed slots: [AI or grip][grip if AI][actions] …… [trash][watchers][avatar]
  // When no agent, grip occupies the AI activity button slot (no empty spacer).
  // The indicators retain their original 46px maximum width, but now sit between
  // trash and avatar. Trash remains pinned regardless of indicators or agent state.
  const trashRightClass = 'right-24';
  const watchersRightClass = 'right-12 w-[46px]';
  // Preserve each 22px toolbar slot. The pseudo-element extends its hit area by
  // 2px per side, while transform enlarges only the hovered control (no reflow).
  const toolbarReachClass =
    "relative after:absolute after:-inset-0.5 after:rounded-full after:content-[''] hover:scale-110 transition-[transform,background-color,color,opacity] disabled:hover:scale-100";

  const gripHandle = !agentBlocking && !isDragDisabled ? (
    <KanbanChromeTooltip label={t('toolbar.dragToMove')} wrapperClassName="relative inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center">
      <div
        {...listeners}
        {...attributes}
        className={`p-1 rounded cursor-grab active:cursor-grabbing hover:bg-gray-200 dark:hover:bg-gray-700 opacity-60 hover:opacity-100 inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass}`}
      >
        <GripVertical size={14} className="text-gray-400" />
      </div>
    </KanbanChromeTooltip>
  ) : (
    <span className="inline-flex h-[22px] w-[22px] shrink-0 p-1" aria-hidden />
  );

  const linkButton =
    onStartLinking ? (
      <KanbanChromeTooltip
        label={
          agentBlocking
            ? agentLockedLabel
            : isLinkingMode && linkingSourceTask?.id === task.id
              ? t('toolbar.sourceTaskForLinking')
              : hasRelations && hoveredLinkTask
                ? t('relationships.shiftClickLinkToUnlink')
                : hasRelations
                  ? t('toolbar.holdAndDragToLinkWithRelations')
                  : t('toolbar.holdAndDragToLink')
        }
        wrapperClassName="relative inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center"
      >
        <button
          data-no-dnd="true"
          disabled={agentBlocking}
          onPointerDown={(e) => {
            if (agentBlocking) return;
            // Shift+click link icon → unlink (pointerdown only — click would double-fire and 404)
            if (e.shiftKey && e.button === 0 && onUnlinkRelatedTask && hasRelations) {
              e.preventDefault();
              e.stopPropagation();
              void onUnlinkRelatedTask(task);
              return;
            }
            handleLinkPointerDown(e);
          }}
          onMouseDown={(e) => {
            if (agentBlocking) return;
            if (e.shiftKey && e.button === 0 && onUnlinkRelatedTask && hasRelations) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            handleLinkMouseDown(e);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Unlink is handled on pointerdown to avoid a second DELETE after success
          }}
          onMouseEnter={(e) => {
            if (agentBlocking) return;
            e.stopPropagation();
            onLinkToolHover?.(task);
          }}
          onMouseLeave={(e) => {
            e.stopPropagation();
            // Avoid clearing while highlight mode keeps sticky focus across cards
            if (!(highlightLinksMode && hasRelations)) {
              onLinkToolHoverEnd?.();
            }
          }}
          onPointerEnter={(e) => {
            if (agentBlocking) return;
            e.stopPropagation();
            onLinkToolHover?.(task);
          }}
          onPointerLeave={(e) => {
            e.stopPropagation();
            if (!(highlightLinksMode && hasRelations)) {
              onLinkToolHoverEnd?.();
            }
          }}
          className={`p-1 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass} ${
            agentBlocking
              ? 'opacity-40 cursor-not-allowed text-gray-400'
              : isLinkingMode && linkingSourceTask?.id === task.id
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                : hasRelations || highlightedAsRelated
                  ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900'
                  : 'hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400'
          }`}
          style={{ pointerEvents: 'auto', zIndex: 100, touchAction: 'none', userSelect: 'none' }}
        >
          <span className="relative inline-flex h-[14px] w-[14px] items-center justify-center overflow-visible">
            <Link size={14} className="shrink-0" />
            {hasRelations && (
              <span
                className="absolute -top-1 -right-1.5 flex items-center gap-px leading-none pointer-events-none"
                aria-hidden="true"
              >
                {relationSummary.hasParent && (
                  <span className="text-[8px] font-bold text-green-600 dark:text-green-400">{t('relationships.markParent')}</span>
                )}
                {relationSummary.hasChildren && (
                  <span className="text-[8px] font-bold text-purple-600 dark:text-purple-400">{t('relationships.markChild')}</span>
                )}
                {!relationSummary.hasParent &&
                  !relationSummary.hasChildren &&
                  relationSummary.hasRelated && (
                    <span className="text-[8px] font-bold text-yellow-600 dark:text-yellow-400">{t('relationships.markRelated')}</span>
                  )}
              </span>
            )}
          </span>
        </button>
      </KanbanChromeTooltip>
    ) : null;

  const linkVisibility =
    hasRelations || highlightedAsRelated
      ? 'pointer-events-auto opacity-100'
      : toolbarHoverVisibility;

  const assigneeAvatar = isAgentMemberId(member.id) ? (
    <img
      src={getAgentAvatarSrc(member)}
      alt={member.name}
      className="w-8 h-8 rounded-full object-cover"
    />
  ) : member.googleAvatarUrl || member.avatarUrl ? (
    <img
      src={getAuthenticatedAvatarUrl(member.googleAvatarUrl || member.avatarUrl)}
      alt={member.name}
      className="w-8 h-8 rounded-full object-cover"
    />
  ) : (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white"
      style={{ backgroundColor: member.color }}
    >
      {member.id === SYSTEM_MEMBER_ID ? '🤖' : member.name.charAt(0).toUpperCase()}
    </div>
  );

  // Viewers: assignee avatar + watcher/collaborator counts only (no mutation controls).
  if (!canMutate) {
    return (
      <>
        <div className="absolute top-[7px] right-12 w-[46px] z-30 flex items-center justify-start gap-1.5">
          {task.watchers && task.watchers.length > 0 && (
            <KanbanChromeTooltip label={formatMembersTooltip(task.watchers, 'watcher')} delayMs={0} wrapperClassName="flex items-center">
              <span className="flex items-center">
                <Eye size={12} className="text-blue-500" />
                <span className="text-[10px] text-blue-600 ml-0.5 font-medium">{task.watchers.length}</span>
              </span>
            </KanbanChromeTooltip>
          )}
          {task.collaborators && task.collaborators.length > 0 && (
            <KanbanChromeTooltip label={formatMembersTooltip(task.collaborators, 'collaborator')} delayMs={0} wrapperClassName="flex items-center">
              <span className="flex items-center">
                <UserPlus size={12} className="text-blue-500" />
                <span className="text-[10px] text-blue-600 ml-0.5 font-medium">{task.collaborators.length}</span>
              </span>
            </KanbanChromeTooltip>
          )}
        </div>
        <div className="absolute top-1 right-2 z-20">
          <KanbanChromeTooltip label={member.name}>
            <div className="rounded-full" aria-hidden>
              {assigneeAvatar}
            </div>
          </KanbanChromeTooltip>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Left cluster: AI (when assigned) + grip; grip takes AI slot when agent absent */}
      <div className="absolute top-1 left-1 z-[6] flex items-start gap-0.5">
        {isAgentAssigned ? (
          <>
            <AgentStatusButton
              status={agentWorkStatus}
              className={`p-1 rounded hover:bg-teal-100 dark:hover:bg-teal-900/40 ${toolbarReachClass}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenAgentActivity?.();
              }}
            />
            {gripHandle}
          </>
        ) : (
          gripHandle
        )}

        <div
          className="flex h-[22px] items-center gap-0.5"
          data-tour-id="task-card-toolbar"
        >
          {onTagAdd && (
            <div className={`flex h-[22px] items-center transition-opacity duration-200 ${toolbarHoverVisibility}`}>
              <KanbanChromeTooltip label={agentBlocking ? agentLockedLabel : t('toolbar.addTag')}>
                <button
                  ref={quickTagButtonRef}
                  disabled={agentBlocking}
                  className={`p-1 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass} ${
                    agentBlocking
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  onClick={agentBlocking ? undefined : handleQuickTagClick}
                >
                  <div className="relative">
                    <TagIcon size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" />
                    <Plus size={7} className="text-gray-400 absolute -top-1 -right-1" />
                  </div>
                </button>
              </KanbanChromeTooltip>
            </div>
          )}

          <div className={`flex h-[22px] items-center transition-opacity duration-200 ${toolbarHoverVisibility}`}>
            <KanbanChromeTooltip label={t('toolbar.copyTask')}>
              <button
                onClick={handleCopy}
                className={`p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass}`}
              >
                <Copy size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" />
              </button>
            </KanbanChromeTooltip>
          </div>

          {linkButton && (
            <div className={`flex h-[22px] items-center transition-opacity duration-200 ${linkVisibility}`}>
              {linkButton}
            </div>
          )}

          {(() => {
            const archiveColumnId = getArchivedColumnId(columns);
            const currentColumn = columns && columns[task.columnId];
            const isCurrentColumnArchived = isArchivedColumnFlag(currentColumn);

            return archiveColumnId && !isCurrentColumnArchived ? (
              <div className={`flex h-[22px] items-center transition-opacity duration-200 ${toolbarHoverVisibility}`}>
                <KanbanChromeTooltip label={agentBlocking ? agentLockedLabel : t('toolbar.archiveTask')}>
                  <button
                    disabled={agentBlocking}
                    onClick={(e) => {
                      if (agentBlocking) return;
                      e.stopPropagation();
                      onEdit({ ...task, columnId: archiveColumnId });
                    }}
                    className={`p-1 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass} ${
                      agentBlocking
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-yellow-100 dark:hover:bg-yellow-900/40'
                    }`}
                  >
                    <Archive size={14} className="text-yellow-600" />
                  </button>
                </KanbanChromeTooltip>
              </div>
            ) : null;
          })()}
        </div>
      </div>

      {/* Watchers & Collaborators — original-width fixed slot between trash and avatar */}
      <div
        className={`absolute top-[7px] ${watchersRightClass} z-30 flex items-center justify-start gap-1.5`}
      >
          {task.watchers && task.watchers.length > 0 && (
            <KanbanChromeTooltip label={formatMembersTooltip(task.watchers, 'watcher')} delayMs={0} wrapperClassName="flex items-center">
              <span className="flex items-center">
                <Eye size={12} className="text-blue-500" />
                <span className="text-[10px] text-blue-600 ml-0.5 font-medium">{task.watchers.length}</span>
              </span>
            </KanbanChromeTooltip>
          )}
          {task.collaborators && task.collaborators.length > 0 && (
            <KanbanChromeTooltip label={formatMembersTooltip(task.collaborators, 'collaborator')} delayMs={0} wrapperClassName="flex items-center">
              <span className="flex items-center">
                <UserPlus size={12} className="text-blue-500" />
                <span className="text-[10px] text-blue-600 ml-0.5 font-medium">{task.collaborators.length}</span>
              </span>
            </KanbanChromeTooltip>
          )}
      </div>

      {/* Delete — pinned left of indicators (constant X on every card) */}
      <div
        className={`absolute top-0 ${trashRightClass} z-[5] py-1 transition-opacity duration-200 ${toolbarHoverVisibility}`}
        data-tour-id="task-card-delete"
      >
        <KanbanChromeTooltip
          label={
            agentBlocking
              ? agentLockedLabel
              : isAdmin
                ? t('toolbar.deleteTaskAdminHint')
                : t('toolbar.deleteTask')
          }
        >
          <button
            disabled={agentBlocking}
            onClick={(e) => {
              if (agentBlocking) return;
              e.preventDefault();
              e.stopPropagation();
              onRemove(task.id, e);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            className={`p-1 rounded-full ${toolbarReachClass} ${
              agentBlocking
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-red-100 dark:hover:bg-red-900/40'
            }`}
          >
            <Trash2 size={14} className="text-red-500" />
          </button>
        </KanbanChromeTooltip>
      </div>

      {/* Avatar Overlay - Top Right */}
      <div className={`absolute top-1 right-2 ${showMemberSelect ? 'z-[110]' : 'z-20'}`}>
        <div className="relative">
          <KanbanChromeTooltip
            label={agentBlocking ? agentLockedLabel : t('toolbar.changeAssignee')}
          >
            <button
              ref={memberButtonRef}
              disabled={agentBlocking}
              onClick={(e) => {
                if (agentBlocking) return;
                handleMemberToggle(e);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              className={`rounded-full transition-colors ${
                agentBlocking
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:opacity-90 cursor-pointer'
              }`}
              data-member-button="true"
            >
            {assigneeAvatar}
            </button>
          </KanbanChromeTooltip>

          {/* Member Selection Dropdown - Now handled by portal below */}
        </div>
      </div>

      {/* Portal-rendered quick tag dropdown */}
      {showQuickTagDropdown && createPortal(
        <div 
          ref={quickTagDropdownRef}
          data-tag-dropdown
          className="fixed w-[200px] bg-white border border-gray-200 rounded-md shadow-lg z-[9999] max-h-[400px] overflow-y-auto"
          style={{
            left: `${tagDropdownPosition.left}px`,
            top: `${tagDropdownPosition.top}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Add Tag Button */}
          <div 
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowAddTagModal(true);
              setShowQuickTagDropdown(false);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            className="flex items-center gap-2 p-2 hover:bg-blue-50 cursor-pointer border-b border-gray-200 text-blue-600 font-medium sticky top-0 bg-white"
          >
            <Plus size={14} />
            <span className="text-sm">{t('toolbar.addTag')}</span>
          </div>
          
          {availableTagsForAssignment.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">
              {t('toolbar.noMoreTagsAvailable')}
            </div>
          ) : (
            availableTagsForAssignment.map(tag => (
              <div
                key={tag.id}
                className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleQuickTagSelect(tag.id.toString());
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  // Use onMouseUp as primary trigger since onClick sometimes fails
                  handleQuickTagSelect(tag.id.toString());
                }}
                onMouseDown={(e) => {
                  // Critical: This stopPropagation is essential for proper event handling
                  e.stopPropagation();
                }}
              >
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-sm text-gray-700 truncate">{tag.tag}</span>
              </div>
            ))
          )}
        </div>,
        document.body
      )}

      {/* Portal-rendered member selection dropdown */}
      {showMemberSelect && (() => {
        const position = getMemberDropdownPosition();
        return createPortal(
          <div
            data-member-dropdown="true"
            className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-[99999] overflow-hidden flex flex-col"
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              width: `${position.width}px`,
              height: `${position.height}px`,
              maxHeight: `${position.height}px`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('toolbar.assignTo')}
            </div>
            <MemberSearchList
              members={members}
              selectedId={member.id}
              showAgentSection
              onSelect={(memberId) => {
                onMemberChange(memberId);
                onCloseMemberSelect();
              }}
              onEscape={onCloseMemberSelect}
              maxHeightClassName="max-h-none"
              className="min-h-0 flex-1"
            />
          </div>,
          document.body
        );
      })()}
      
      {/* Add Tag Modal */}
      {showAddTagModal && createPortal(
        <AddTagModal
          onClose={() => setShowAddTagModal(false)}
          onTagCreated={handleTagCreated}
        />,
        document.body
      )}
    </>
  );
}
