import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DragOverlay as DndKitDragOverlay } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { snapPointerInsideOverlay } from '../../utils/dndOverlayModifiers';
import { lastKanbanPointer, setLastKanbanPointer } from '../../utils/kanbanPointer';
import { Task, TeamMember } from '../../types';
import DOMPurify from 'dompurify';
import { getAuthenticatedAttachmentUrl } from '../../utils/authImageUrl';
import type { TaskViewMode } from '../../utils/userPreferences';
import { useColumnDisplayTitle } from '../../utils/columnDisplayTitle';

import { Column } from '../../types';

interface SimpleDragOverlayProps {
  draggedTask: Task | null;
  draggedColumn: Column | null;
  members: TeamMember[];
  isHoveringBoardTab?: boolean;
  draggedTaskIds?: string[];
  taskViewMode?: TaskViewMode;
}

export const SimpleDragOverlay: React.FC<SimpleDragOverlayProps> = ({ 
  draggedTask,
  draggedColumn,
  members, 
  isHoveringBoardTab = false,
  draggedTaskIds = [],
  taskViewMode = 'expand',
}) => {
  const multiCount = draggedTaskIds.length > 1 ? draggedTaskIds.length : 0;
  const overlayModifiers = useMemo(() => {
    if (draggedColumn || !draggedTask) return undefined;
    if (isHoveringBoardTab) return undefined;
    return [snapPointerInsideOverlay];
  }, [draggedColumn, draggedTask, isHoveringBoardTab, multiCount]);

  const tabChip =
    isHoveringBoardTab && draggedTask
      ? createPortal(
          <TabDropPointerChip
            member={members.find((m) => m.id === draggedTask.memberId)}
            count={multiCount || 1}
          />,
          document.body
        )
      : null;

  return (
    <>
      {tabChip}
      <DndKitDragOverlay 
        dropAnimation={null}
        adjustScale={false}
        modifiers={overlayModifiers}
        style={{ pointerEvents: 'none' }}
      >
        {draggedColumn ? (
          <ColumnDragPreview column={draggedColumn} />
        ) : draggedTask && !isHoveringBoardTab ? (
          <TaskDragPreview
            task={draggedTask}
            member={members.find(m => m.id === draggedTask.memberId)}
            stackCount={multiCount}
            compact={taskViewMode === 'compact'}
          />
        ) : null}
      </DndKitDragOverlay>
    </>
  );
};

/** Chip glued to the live pointer — not dnd-kit’s card-sized overlay box. */
const TabDropPointerChip: React.FC<{ member?: TeamMember; count: number }> = ({
  member,
  count,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (x: number, y: number) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    place(lastKanbanPointer.x, lastKanbanPointer.y);
    const onMove = (e: PointerEvent) => {
      setLastKanbanPointer(e.clientX, e.clientY);
      place(e.clientX, e.clientY);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <div
      ref={ref}
      data-kanban-drag-overlay
      className="pointer-events-none fixed z-[10050] flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border-2 border-blue-500 bg-white shadow-lg"
    >
      <div
        className="absolute inset-0 rounded-lg opacity-20"
        style={{ backgroundColor: member?.color || '#3B82F6' }}
      />
      <FileText size={16} className="relative z-10 text-blue-600" />
      <div className="absolute -top-1 -right-1 flex h-3 min-w-[12px] items-center justify-center rounded-full border border-white bg-blue-500 px-0.5 text-[8px] font-bold text-white">
        {count}
      </div>
    </div>
  );
};

// Full task preview for normal dragging
const TaskDragPreview: React.FC<{
  task: Task;
  member?: TeamMember;
  stackCount?: number;
  compact?: boolean;
}> = ({ task, member, stackCount = 0, compact = false }) => {
  const { t } = useTranslation('tasks');
  const layers = stackCount > 1 ? Math.min(stackCount, 3) : 1;
  const isMultiDrag = stackCount > 1;
  const previewTitle = isMultiDrag
    ? t('kanbanSelect.multiDragPreview')
    : task.title;
  const previewTicket = isMultiDrag ? null : task.ticket;

  if (compact) {
    return (
      <div className="relative w-80 pointer-events-none">
        {layers > 1 &&
          Array.from({ length: layers - 1 }).map((_, i) => {
            const depth = layers - 1 - i;
            return (
              <div
                key={`stack-${i}`}
                className="absolute inset-0 h-[72px] rounded-lg border border-gray-200 bg-white shadow-md"
                style={{
                  transform: `translate(${depth * 4}px, ${depth * 4}px)`,
                  opacity: 0.55 - i * 0.1,
                  zIndex: i,
                }}
              />
            );
          })}
        <div
          data-kanban-drag-overlay
          className="relative z-10 flex h-[72px] min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 shadow-2xl ring-2 ring-blue-400 opacity-90"
        >
          {isMultiDrag && (
            <div className="absolute -top-2 -right-2 z-20 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white shadow">
              {stackCount}
            </div>
          )}
          {previewTicket ? (
            <span className="shrink-0 font-mono text-[11px] font-bold text-gray-500 dark:text-gray-400">
              {previewTicket}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{previewTitle}</span>
          {member ? (
            <span
              className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: member.color || '#3B82F6' }}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-80 pointer-events-none">
      {layers > 1 &&
        Array.from({ length: layers - 1 }).map((_, i) => {
          const depth = layers - 1 - i;
          return (
            <div
              key={`stack-${i}`}
              className="absolute inset-0 rounded-lg border border-gray-200 bg-white shadow-md"
              style={{
                transform: `translate(${depth * 4}px, ${depth * 4}px) rotate(${2 + depth}deg)`,
                opacity: 0.55 - i * 0.1,
                zIndex: i,
              }}
            />
          );
        })}
      <div
        data-kanban-drag-overlay
        className="relative z-10 bg-white rounded-lg shadow-2xl border border-gray-200 p-4 w-80 transform rotate-3 scale-105 opacity-90 ring-2 ring-blue-400"
      >
        {isMultiDrag && (
          <div className="absolute -top-2 -right-2 z-20 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white shadow">
            {stackCount}
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <h4 className="truncate font-semibold text-gray-900">{previewTitle}</h4>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-500 rounded-full opacity-75"></div>
            <div className="w-3 h-3 bg-blue-400 rounded-full opacity-50"></div>
            <div className="w-3 h-3 bg-blue-300 rounded-full opacity-25"></div>
          </div>
        </div>
        {task.description && !isMultiDrag && (
          <div
            className="text-sm text-gray-600 line-clamp-2 mb-2 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                (() => {
                  // Fix blob URLs in task description
                  let fixedDescription = task.description.length > 50
                    ? task.description.substring(0, 50) + '...'
                    : task.description;
                  const blobPattern = /blob:[^"]*#(img-[^"]*)/g;
                  fixedDescription = fixedDescription.replace(blobPattern, (_match, filename) => {
                    // Convert blob URL to authenticated server URL
                    const authenticatedUrl = getAuthenticatedAttachmentUrl(`/attachments/${filename}`);
                    return authenticatedUrl || `/uploads/${filename}`;
                  });
                  return fixedDescription;
                })()
              )
            }}
          />
        )}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {isMultiDrag
              ? t('kanbanSelect.movingMultiple', { count: stackCount })
              : t('kanbanSelect.movingSingle')}
          </span>
          {member && <span>@{member.name}</span>}
        </div>
      </div>
    </div>
  );
};

// Column drag preview
const ColumnDragPreview: React.FC<{ column: Column }> = ({ column }) => {
  const { t } = useTranslation('common');
  const columnDisplayTitle = useColumnDisplayTitle();
  const taskCount = column.tasks?.length || 0;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border-2 border-blue-400 p-4 w-64 transform rotate-2 scale-105 opacity-95 ring-2 ring-blue-300">
      <div className="flex flex-col items-center justify-center py-4">
        <div className="text-3xl mb-2">📋</div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 text-center mb-1">
          {columnDisplayTitle(column)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {taskCount} {taskCount === 1 ? t('column.task') : t('column.tasks')}
        </div>
      </div>
    </div>
  );
};

export default SimpleDragOverlay;
