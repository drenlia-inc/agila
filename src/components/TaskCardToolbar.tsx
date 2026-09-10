import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Copy, Eye, UserPlus, GripVertical, TagIcon, Plus, Trash2, GitBranch, Archive, MoreVertical } from 'lucide-react';
import { Task, TeamMember, Tag } from '../types';
import { formatMembersTooltip } from '../utils/taskUtils';
import AddTagModal from './AddTagModal';
import MemberSearchList from './ui/MemberSearchList';
import MemberAvatar from './ui/MemberAvatar';
import { layoutMemberDropdownFromElement } from '../utils/memberDropdownLayout';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import AgentStatusButton from './AgentStatusButton';
import {
  AGENT_MEMBER_ID,
  AGENT_DRAG_BLOCKING_STATUSES,
} from '../constants/appConstants';
import type { TaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import { getTaskRelationshipSummary } from '../utils/taskRelationshipSummary';
import { getArchivedColumnId, isArchivedColumnFlag } from '../utils/columnUtils';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { useFloatingOverlayDismiss } from '../hooks/useFloatingOverlayDismiss';

interface TaskCardToolbarProps {
  task: Task;
  member?: TeamMember | null;
  members: TeamMember[];
  isDragDisabled?: boolean;
  showMemberSelect: boolean;
  onCopy: (task: Task) => void;
  onEdit: (task: Task) => void;
  onSelect: (task: Task, options?: { scrollToComments?: boolean }) => void;
  onRemove: (taskId: string, event?: React.MouseEvent) => void;
  onMemberChange: (memberId: string | null) => void;
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
  onStartLinking?: (
    task: Task,
    startPosition: { x: number; y: number },
    options?: { shiftKey?: boolean }
  ) => void;
  
  // Hover highlighting props
  hoveredLinkTask?: Task | null;
  onLinkToolHover?: (task: Task) => void;
  onLinkToolHoverEnd?: () => void;
  relationSummary?: TaskRelationshipSummary;
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
  /** Task card root — constrains link tooltip width so long copy wraps within the card. */
  cardWidthAnchorRef?: React.RefObject<HTMLElement | null>;
  /** Live card node (memoized cards do not re-render on column resize). */
  cardWidthAnchorEl?: HTMLElement | null;
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
  getTaskRelationshipType,
  onUnlinkRelatedTask: _onUnlinkRelatedTask,
  
  isEditingTitle = false,
  isEditingDescription = false,
  isSelected = false,
  isAdmin = false,
  canMutate = true,
  cardWidthAnchorRef,
  cardWidthAnchorEl = null,
}: TaskCardToolbarProps) {
  const { t } = useTranslation('tasks');
  const _priorityButtonRef = useRef<HTMLButtonElement>(null);
  const [showQuickTagDropdown, setShowQuickTagDropdown] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [tagDropdownPosition, setTagDropdownPosition] = useState<{left: number, top: number}>({left: 0, top: 0});
  const [overflowMenuPosition, setOverflowMenuPosition] = useState<{left: number, top: number}>({left: 0, top: 0});
  const quickTagButtonRef = useRef<HTMLButtonElement>(null);
  const quickTagDropdownRef = useRef<HTMLDivElement>(null);
  const overflowMoreButtonRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const overflowPointerStartRef = useRef<{ x: number; y: number } | null>(null);
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
  const linkGestureHandledRef = useRef(false);
  const dragThreshold = 5; // Minimum pixels to consider it a drag

  const handleLinkPointerDown = (e: React.PointerEvent) => {
    // CRITICAL: Prevent the task card's drag listeners from interfering
    e.preventDefault();
    e.stopPropagation();
    
    // Use the actual mouse position when clicking, not the button center
    // This prevents false drag detection when clicking the button
    const startPos = { x: e.clientX, y: e.clientY };
    linkGestureHandledRef.current = false;
    
    // Prepare for potential drag, but don't start linking yet
    setIsDragPrepared(true);
    setDragStartPosition(startPos);
  };
  
  const handleLinkMouseDown = (e: React.MouseEvent) => {
    // Also handle mousedown as fallback
    e.preventDefault();
    e.stopPropagation();
    
    const startPos = { x: e.clientX, y: e.clientY };
    linkGestureHandledRef.current = false;
    setIsDragPrepared(true);
    setDragStartPosition(startPos);
  };
  
  // Handle global mouse/pointer move to detect drag while holding down
  useEffect(() => {
    const beginLinkingDrag = (shiftKey: boolean) => {
      if (!dragStartPosition || !onStartLinking) return;
      linkGestureHandledRef.current = true;
      setIsDragPrepared(false);
      onStartLinking(task, dragStartPosition, { shiftKey });
      setDragStartPosition(null);
    };

    const tryFinishLinkClick = (clientX: number, clientY: number, shiftKey: boolean) => {
      if (!isDragPrepared || !dragStartPosition || !onStartLinking) return false;
      const deltaX = Math.abs(clientX - dragStartPosition.x);
      const deltaY = Math.abs(clientY - dragStartPosition.y);
      const isClick = deltaX <= dragThreshold && deltaY <= dragThreshold;
      if (isClick && shiftKey) {
        beginLinkingDrag(true);
        return true;
      }
      return false;
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragPrepared && dragStartPosition && onStartLinking) {
        const currentX = e.clientX;
        const currentY = e.clientY;
        const deltaX = Math.abs(currentX - dragStartPosition.x);
        const deltaY = Math.abs(currentY - dragStartPosition.y);
        
        // If moved beyond threshold, start linking mode (Shift = related)
        if (deltaX > dragThreshold || deltaY > dragThreshold) {
          beginLinkingDrag(e.shiftKey);
        }
      }
    };

    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (isDragPrepared && dragStartPosition && onStartLinking) {
        const currentX = e.clientX;
        const currentY = e.clientY;
        const deltaX = Math.abs(currentX - dragStartPosition.x);
        const deltaY = Math.abs(currentY - dragStartPosition.y);
        
        if (deltaX > dragThreshold || deltaY > dragThreshold) {
          beginLinkingDrag(e.shiftKey);
        }
      }
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (tryFinishLinkClick(e.clientX, e.clientY, e.shiftKey)) return;
      if (isDragPrepared) {
        setIsDragPrepared(false);
        setDragStartPosition(null);
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      if (tryFinishLinkClick(e.clientX, e.clientY, e.shiftKey)) return;
      if (isDragPrepared) {
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

  const positionMenuFromButton = (
    el: HTMLElement | null,
    dropdownWidth: number,
    dropdownHeight: number
  ) => {
    if (!el) return { left: 20, top: 20 };
    const rect = el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - dropdownWidth / 2;
    let top = rect.bottom + 5;
    if (left + dropdownWidth > window.innerWidth - 20) {
      left = window.innerWidth - dropdownWidth - 20;
    }
    if (left < 20) left = 20;
    if (top + dropdownHeight > window.innerHeight - 20) {
      top = rect.top - dropdownHeight - 5;
    }
    return { left, top };
  };

  const handleQuickTagClick = (e: React.MouseEvent, fromEl?: HTMLElement | null) => {
    e.stopPropagation();

    if (!showQuickTagDropdown) {
      setTagDropdownPosition(
        positionMenuFromButton(fromEl || quickTagButtonRef.current, 200, 200)
      );
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
      return layoutMemberDropdownFromElement(memberButtonRef.current, members, {
        showAgent: true,
        excludeViewers: true,
        selectedId: member?.id ?? null,
        placement: 'below',
        extraChrome: 72,
      });
    }
    return { left: 0, top: 0, height: 280, width: 280, columns: 1 as const };
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
        return;
      }
      if (overflowMoreButtonRef.current && overflowMoreButtonRef.current.contains(target)) {
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

  const isAgentAssigned = member?.id === AGENT_MEMBER_ID;
  const agentBlocking =
    isAgentAssigned &&
    !!agentWorkStatus &&
    (AGENT_DRAG_BLOCKING_STATUSES as readonly string[]).includes(agentWorkStatus);

  const agentLockedLabel = t('toolbar.disabledWhileAgent');

  const archiveColumnId = getArchivedColumnId(columns);
  const currentColumn = columns && columns[task.columnId];
  const showArchiveButton = Boolean(archiveColumnId && !isArchivedColumnFlag(currentColumn));

  const [compactLevel, setCompactLevel] = useState<0 | 1 | 2>(0);
  const [toolbarLayoutReady, setToolbarLayoutReady] = useState(false);
  const hasTagAction = Boolean(onTagAdd);
  const hasLinkAction = Boolean(onStartLinking);
  useLayoutEffect(() => {
    const card = cardWidthAnchorEl ?? cardWidthAnchorRef?.current;
    if (!card) return;

    const TOOLBAR_SLOT_PX = 22;
    const TOOLBAR_GAP_PX = 2;
    const LEFT_INSET_PX = 4;
    const GUTTER_PX = 8;
    const hasTag = hasTagAction;
    const hasLink = hasLinkAction;
    const hasArchive = showArchiveButton;
    const hasAgent = isAgentAssigned;

    const slotCount = (opts: {
      tag: boolean;
      copy: boolean;
      archive: boolean;
      more: boolean;
    }) =>
      1 +
      (hasAgent ? 1 : 0) +
      (hasLink ? 1 : 0) +
      (opts.tag ? 1 : 0) +
      (opts.copy ? 1 : 0) +
      (opts.archive ? 1 : 0) +
      (opts.more ? 1 : 0);

    const clusterWidth = (slots: number) =>
      slots * TOOLBAR_SLOT_PX + Math.max(0, slots - 1) * TOOLBAR_GAP_PX;

    const sync = () => {
      const cardRect = card.getBoundingClientRect();
      if (cardRect.width <= 0) return;
      const trash = card.querySelector<HTMLElement>('[data-tour-id="task-card-delete"]');
      const trashLeft = trash
        ? trash.getBoundingClientRect().left
        : cardRect.right - 118;
      const available = trashLeft - cardRect.left - LEFT_INSET_PX - GUTTER_PX;
      const full = clusterWidth(
        slotCount({ tag: hasTag, copy: true, archive: hasArchive, more: false })
      );
      const mid = clusterWidth(
        slotCount({ tag: hasTag, copy: false, archive: false, more: true })
      );
      let next: 0 | 1 | 2 = 0;
      if (available < full) next = 1;
      if (available < mid) next = 2;
      setCompactLevel(next);
      setToolbarLayoutReady(true);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(card);
    return () => ro.disconnect();
  }, [
    cardWidthAnchorEl,
    cardWidthAnchorRef,
    isAgentAssigned,
    showArchiveButton,
    hasLinkAction,
    hasTagAction,
  ]);

  const hideCopyAndArchive = compactLevel >= 1;
  const hideTagInOverflow = compactLevel >= 2 && Boolean(onTagAdd);
  const showOverflowTrigger = hideCopyAndArchive;

  useEffect(() => {
    if (compactLevel < 1) setShowOverflowMenu(false);
  }, [compactLevel]);

  useEscapeDismiss(() => setShowOverflowMenu(false), { enabled: showOverflowMenu });
  useFloatingOverlayDismiss(showOverflowMenu, `${task.id}:overflow`, () => setShowOverflowMenu(false));
  useFloatingOverlayDismiss(showQuickTagDropdown, `${task.id}:add-tag`, () =>
    setShowQuickTagDropdown(false)
  );

  useEffect(() => {
    if (!showOverflowMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (overflowMoreButtonRef.current?.contains(target)) return;
      if (overflowMenuRef.current?.contains(target)) return;
      if (target.closest('[data-toolbar-overflow-menu]')) return;
      setShowOverflowMenu(false);
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [showOverflowMenu]);

  const toolbarHoverVisibility = toolbarPinnedOpen
    ? 'pointer-events-auto opacity-100'
    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100';

  // Fixed slots: [grip][AI if assigned][actions] …… [trash][watchers][avatar]
  // Grip is always top-left. Agent activity sits immediately after it when assigned.
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
              : t('toolbar.holdAndDragToLink')
        }
        widthAnchorRef={cardWidthAnchorRef}
        wrapperClassName="relative inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center"
      >
        <button
          data-no-dnd="true"
          data-kanban-mod-allow="shift link"
          disabled={agentBlocking}
          onPointerDown={(e) => {
            if (agentBlocking) return;
            e.stopPropagation();
            handleLinkPointerDown(e);
          }}
          onMouseDown={(e) => {
            if (agentBlocking) return;
            e.stopPropagation();
            handleLinkMouseDown(e);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (
              !agentBlocking &&
              e.shiftKey &&
              onStartLinking &&
              !isLinkingMode &&
              !linkGestureHandledRef.current
            ) {
              linkGestureHandledRef.current = true;
              onStartLinking(task, { x: e.clientX, y: e.clientY }, { shiftKey: true });
            }
          }}
          onMouseEnter={(e) => {
            if (agentBlocking) return;
            e.stopPropagation();
            onLinkToolHover?.(task);
          }}
          onMouseLeave={(e) => {
            e.stopPropagation();
            onLinkToolHoverEnd?.();
          }}
          onPointerEnter={(e) => {
            if (agentBlocking) return;
            e.stopPropagation();
            onLinkToolHover?.(task);
          }}
          onPointerLeave={(e) => {
            e.stopPropagation();
            onLinkToolHoverEnd?.();
          }}
          className={`relative p-1 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass} ${
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
          <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
            <GitBranch size={14} className="shrink-0" />
            {hasRelations && (
              <span
                className="absolute bottom-0 right-0 flex items-center gap-px leading-none pointer-events-none"
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
    toolbarPinnedOpen || (isLinkingMode && linkingSourceTask?.id === task.id)
      ? 'pointer-events-auto opacity-100'
      : hasRelations
        ? 'pointer-events-auto opacity-50 group-hover:opacity-100'
        : toolbarHoverVisibility;

  const assigneeAvatar = (
    <MemberAvatar member={member} members={members} size="lg" nativeTitle={false} />
  );
  const assigneeLabel = member?.name || t('taskCard.noAssignee');
  const assigneeChangeLabel = t('toolbar.changeAssigneeNamed', { name: assigneeLabel });

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
          <KanbanChromeTooltip label={assigneeLabel}>
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
      {/* Left cluster: grip first; agent activity immediately after when assigned */}
      <div className="absolute top-1 left-1 z-[6] flex items-start gap-0.5">
        {gripHandle}
        {isAgentAssigned ? (
          <AgentStatusButton
            status={agentWorkStatus}
            className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center p-1 rounded hover:bg-teal-100 dark:hover:bg-teal-900/40 ${toolbarReachClass}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenAgentActivity?.();
            }}
          />
        ) : null}

        <div
          className="flex h-[22px] items-center gap-0.5"
          data-tour-id="task-card-toolbar"
        >
          {linkButton && (
            <div className={`flex h-[22px] items-center transition-opacity duration-200 ${linkVisibility}`}>
              {linkButton}
            </div>
          )}

          {onTagAdd && !hideTagInOverflow && (
            <div className={`flex h-[22px] items-center ${toolbarLayoutReady ? `transition-opacity duration-200 ${toolbarHoverVisibility}` : 'opacity-0 pointer-events-none'}`}>
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

          {!hideCopyAndArchive && (
          <div className={`flex h-[22px] items-center ${toolbarLayoutReady ? `transition-opacity duration-200 ${toolbarHoverVisibility}` : 'opacity-0 pointer-events-none'}`}>
            <KanbanChromeTooltip label={t('toolbar.copyTask')}>
              <button
                onClick={handleCopy}
                className={`p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass}`}
              >
                <Copy size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" />
              </button>
            </KanbanChromeTooltip>
          </div>
          )}

          {showArchiveButton && archiveColumnId && !hideCopyAndArchive && (
              <div className={`flex h-[22px] items-center ${toolbarLayoutReady ? `transition-opacity duration-200 ${toolbarHoverVisibility}` : 'opacity-0 pointer-events-none'}`}>
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
          )}

          {showOverflowTrigger && (
            <div className={`flex h-[22px] items-center ${toolbarLayoutReady ? `transition-opacity duration-200 ${toolbarHoverVisibility}` : 'opacity-0 pointer-events-none'}`}>
              <KanbanChromeTooltip label={t('toolbar.moreActions')}>
                <button
                  ref={overflowMoreButtonRef}
                  type="button"
                  aria-label={t('toolbar.moreActions')}
                  aria-expanded={showOverflowMenu}
                  className={`p-1 rounded-full inline-flex h-[22px] w-[22px] items-center justify-center ${toolbarReachClass} hover:bg-gray-100 dark:hover:bg-gray-700`}
                  onPointerDown={(e) => {
                    overflowPointerStartRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const start = overflowPointerStartRef.current;
                    overflowPointerStartRef.current = null;
                    if (
                      start &&
                      (Math.abs(e.clientX - start.x) > 5 || Math.abs(e.clientY - start.y) > 5)
                    ) {
                      return;
                    }
                    if (!showOverflowMenu && overflowMoreButtonRef.current) {
                      setOverflowMenuPosition(
                        positionMenuFromButton(overflowMoreButtonRef.current, 200, 140)
                      );
                    }
                    setShowOverflowMenu((open) => !open);
                    setShowQuickTagDropdown(false);
                  }}
                >
                  <MoreVertical size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" />
                </button>
              </KanbanChromeTooltip>
            </div>
          )}
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
            data-kanban-mod-allow="shift"
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
            label={agentBlocking ? agentLockedLabel : assigneeChangeLabel}
          >
            <button
              ref={memberButtonRef}
              disabled={agentBlocking}
              aria-label={agentBlocking ? agentLockedLabel : assigneeChangeLabel}
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

      {showOverflowMenu && createPortal(
        <div
          ref={overflowMenuRef}
          data-toolbar-overflow-menu
          data-floating-overlay=""
          data-no-dnd="true"
          role="menu"
          className="fixed min-w-[11rem] py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg z-[9999]"
          style={{
            left: `${overflowMenuPosition.left}px`,
            top: `${overflowMenuPosition.top}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {hideTagInOverflow && onTagAdd && (
            <button
              type="button"
              role="menuitem"
              disabled={agentBlocking}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-left ${
                agentBlocking
                  ? 'opacity-40 cursor-not-allowed text-gray-400'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              onClick={(e) => {
                if (agentBlocking) return;
                e.stopPropagation();
                setShowOverflowMenu(false);
                setTagDropdownPosition(
                  positionMenuFromButton(overflowMoreButtonRef.current, 200, 200)
                );
                setShowQuickTagDropdown(true);
              }}
            >
              <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <TagIcon size={14} className="text-gray-400" />
                <Plus size={7} className="text-gray-400 absolute -top-1 -right-1" />
              </span>
              {t('toolbar.addTag')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation();
              setShowOverflowMenu(false);
              handleCopy();
            }}
          >
            <Copy size={14} className="text-gray-400" />
            {t('toolbar.copyTask')}
          </button>
          {showArchiveButton && archiveColumnId && (
            <button
              type="button"
              role="menuitem"
              disabled={agentBlocking}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-left ${
                agentBlocking
                  ? 'opacity-40 cursor-not-allowed text-gray-400'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-yellow-50 dark:hover:bg-yellow-900/30'
              }`}
              onClick={(e) => {
                if (agentBlocking) return;
                e.stopPropagation();
                setShowOverflowMenu(false);
                onEdit({ ...task, columnId: archiveColumnId });
              }}
            >
              <Archive size={14} className="text-yellow-600" />
              {t('toolbar.archiveTask')}
            </button>
          )}
        </div>,
        document.body
      )}

      {/* Portal-rendered quick tag dropdown */}
      {showQuickTagDropdown && createPortal(
        <div 
          ref={quickTagDropdownRef}
          data-tag-dropdown
          data-floating-overlay=""
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
            data-floating-overlay=""
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
              selectedId={member?.id ?? null}
              showAgentSection
              excludeViewers
              allowClear
              columns={position.columns}
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
