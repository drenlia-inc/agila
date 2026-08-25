import React, { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useColumnDisplayTitle } from '../../utils/columnDisplayTitle';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Trash2, GripVertical, ChevronDown } from 'lucide-react';
import { Task, Columns, Column } from '../../types';
import { GanttTaskSelectOptions } from './types';
import { ganttRowBoxStyle, ganttRowPaddingClass } from './ganttLayout';

interface GanttTaskListProps {
  columns: Columns;
  groupedTasks: { [columnId: string]: any[] };
  selectedTask?: Task | null;
  selectedTasks: string[];
  isMultiSelectMode: boolean;
  isRelationshipMode: boolean;
  selectedParentTask: string | null;
  priorities: any[];
  taskColumnWidth: number;
  taskViewMode: string;
  onSelectTask: (task: Task | null) => void;
  onTaskSelect: (taskId: string, options?: GanttTaskSelectOptions) => void;
  onCopyTask?: (task: Task) => Promise<void>;
  onRemoveTask?: (taskId: string, event?: React.MouseEvent) => Promise<void>;
  highlightedTaskId?: string | null;
  siteSettings?: any;
  isAdmin?: boolean;
  canMutate?: boolean;
  onReorderTask?: (taskId: string, columnId: string, targetIndex: number) => Promise<void>;
  onMoveTaskToColumn?: (taskId: string, targetColumnId: string) => Promise<void>;
}

const boardColumnsFromColumns = (columns: Columns): Column[] =>
  Object.values(columns).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

const formatTaskDates = (task: any) => {
  if (!task.startDate && !task.endDate) return null;
  if (task.startDate && task.endDate && task.startDate.getTime() === task.endDate.getTime()) {
    return `📅 ${task.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (task.startDate && task.endDate) {
    return `📅 ${task.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${task.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (task.endDate) {
    return `📅 ${task.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (task.startDate) {
    return `📅 ${task.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  return null;
};

const SortableTaskRow = memo(({
  task,
  columnId,
  taskIndex,
  isSelected,
  isMultiSelectMode,
  isRelationshipMode,
  selectedParentTask,
  taskViewMode,
  selectedTask,
  onSelectTask,
  onTaskSelect,
  onCopyTask,
  onRemoveTask,
  highlightedTaskId,
  isAdmin = false,
  canMutate = true,
  reorderEnabled,
  onStatusClick,
}: any) => {
  const { t } = useTranslation('common');
  const isTaskDetailsOpen = selectedTask?.id === task.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: !reorderEnabled,
    data: { columnId, taskId: task.id, type: 'gantt-task-row' },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 60 : undefined,
    position: isDragging ? 'relative' : undefined,
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isRelationshipMode || isDragging) {
      return;
    }

    if (canMutate && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      onTaskSelect(task.id, {
        additive: e.ctrlKey || e.metaKey,
        range: e.shiftKey,
        source: 'list',
      });
      return;
    }

    if (isMultiSelectMode) {
      onTaskSelect(task.id, { source: 'list' });
    } else {
      if (selectedTask && selectedTask.id === task.id) {
        onSelectTask(null);
      } else {
        const taskForSelection = {
          ...task,
          startDate: task.startDate
            ? `${task.startDate.getFullYear()}-${String(task.startDate.getMonth() + 1).padStart(2, '0')}-${String(task.startDate.getDate()).padStart(2, '0')}`
            : '',
          dueDate: task.endDate
            ? `${task.endDate.getFullYear()}-${String(task.endDate.getMonth() + 1).padStart(2, '0')}-${String(task.endDate.getDate()).padStart(2, '0')}`
            : task.dueDate || '',
        };
        onSelectTask(taskForSelection);
      }
    }
  };

  const rowSurfaceClass = [
    highlightedTaskId === task.id
      ? 'bg-yellow-100 dark:bg-yellow-900/50 ring-2 ring-inset ring-yellow-400 dark:ring-yellow-500'
      : isTaskDetailsOpen
        ? 'ring-1 ring-inset ring-amber-400 dark:ring-amber-500'
        : isSelected && highlightedTaskId !== task.id
          ? 'bg-blue-100 dark:bg-blue-800/80 ring-2 ring-inset ring-blue-400 dark:ring-blue-500'
          : '',
    isRelationshipMode && selectedParentTask === task.id
      ? 'ring-2 ring-inset ring-yellow-400 dark:ring-yellow-600 bg-yellow-50 dark:bg-yellow-900/40'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...ganttRowBoxStyle(taskViewMode) }}
      key={`task-info-${task.id}`}
      data-task-id={task.id}
      className={`relative shrink-0 border-b border-gray-200 dark:border-gray-600
      ${taskIndex % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700'}
      hover:bg-blue-50 dark:hover:bg-blue-900 transition-colors duration-200 ease-out ${
        isRelationshipMode ? 'cursor-default' : ''
      } ${isDragging ? 'shadow-2xl ring-2 ring-blue-400 bg-white dark:bg-gray-800 scale-[1.01] z-[60]' : ''}`}
      title={isRelationshipMode ? t('gantt.linkUseTaskBars') : undefined}
      onMouseDown={(e) => {
        // Modifier+click is selection, not text drag: block the native range.
        if (canMutate && (e.ctrlKey || e.metaKey || e.shiftKey)) {
          e.preventDefault();
        }
      }}
      onClick={handleClick}
    >
      <div
        className={`h-full overflow-hidden ${ganttRowPaddingClass(taskViewMode)} ${rowSurfaceClass}`}
      >
      <div className="flex items-center gap-0.5 pr-1 min-h-0 h-full">
        {reorderEnabled && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="flex-shrink-0 self-center p-0 rounded cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-none"
            aria-label={t('gantt.dragToReorderTask', { taskTitle: task.title })}
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={12} />
          </button>
        )}

        <div className="text-left flex-1 min-w-0 min-h-0 leading-none">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate leading-none">
              {task.ticket}
            </div>
            {(task.startDate || task.endDate) && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate leading-none shrink min-w-0">
                {formatTaskDates(task)}
              </span>
            )}
          </div>
          {taskViewMode === 'compact' ? null : (
            <div className="flex flex-col gap-0.5 mt-0.5">
              {taskViewMode === 'expand' && (
                <div className="text-xs text-gray-600 dark:text-gray-300 truncate leading-tight">
                  {task.title}
                </div>
              )}
              {canMutate && onStatusClick ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-[11px] leading-none text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded -ml-0.5 w-fit max-w-full"
                  title={t('gantt.changeStatus')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusClick(task.id, e.currentTarget as HTMLElement);
                  }}
                >
                  <span className="truncate">📋 {task.status}</span>
                  <ChevronDown size={10} className="opacity-70 shrink-0" />
                </button>
              ) : (
                <div className="text-[11px] leading-none text-gray-500 dark:text-gray-400 truncate">
                  📋 {task.status}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-0.5 relative z-50 self-center shrink-0"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {onCopyTask && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopyTask(task);
              }}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              title={t('gantt.copyTask')}
            >
              <Copy size={12} className="text-gray-500 hover:text-gray-700" />
            </button>
          )}
          {onRemoveTask && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTask(task.id, e);
              }}
              className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors"
              title={isAdmin ? t('gantt.deleteTaskAdminHint') : t('gantt.deleteTask')}
            >
              <Trash2 size={12} className="text-gray-500 hover:text-red-600" />
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
});

SortableTaskRow.displayName = 'SortableTaskRow';

const GanttTaskList = memo(({
  columns,
  groupedTasks,
  selectedTask,
  selectedTasks,
  isMultiSelectMode,
  isRelationshipMode,
  selectedParentTask,
  taskColumnWidth,
  taskViewMode,
  onSelectTask,
  onTaskSelect,
  onCopyTask,
  onRemoveTask,
  highlightedTaskId,
  isAdmin = false,
  canMutate = true,
  onReorderTask,
  onMoveTaskToColumn,
}: GanttTaskListProps) => {
  const { t } = useTranslation('common');
  const columnDisplayTitle = useColumnDisplayTitle();
  const [statusDropdown, setStatusDropdown] = useState<{ taskId: string; left: number; top: number } | null>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  const boardColumns = useMemo(() => boardColumnsFromColumns(columns), [columns]);

  const reorderEnabled = Boolean(canMutate && onReorderTask && !isRelationshipMode && !isMultiSelectMode);

  const taskColumnById = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(groupedTasks).forEach(([columnId, tasks]) => {
      tasks.forEach((task) => map.set(task.id, columnId));
    });
    return map;
  }, [groupedTasks]);

  const sameColumnCollisionDetection = useCallback<CollisionDetection>((args) => {
    const activeColumnId = args.active?.data?.current?.columnId as string | undefined;
    if (!activeColumnId) return [];

    return closestCenter(args).filter((collision) => {
      const overColumnId = taskColumnById.get(String(collision.id));
      return overColumnId === activeColumnId;
    });
  }, [taskColumnById]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!statusDropdown) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setStatusDropdown(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStatusDropdown(null);
    };
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [statusDropdown]);

  const handleStatusClick = useCallback((taskId: string, element: HTMLElement) => {
    if (!canMutate || !onMoveTaskToColumn) return;
    const rect = element.getBoundingClientRect();
    setStatusDropdown((prev) =>
      prev?.taskId === taskId ? null : { taskId, left: rect.left, top: rect.bottom + 4 }
    );
  }, [canMutate, onMoveTaskToColumn]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    const activeColumnId = active.data.current?.columnId as string | undefined;
    const overColumnId = over ? taskColumnById.get(String(over.id)) : undefined;

    const isValidDrop = Boolean(
      over &&
      onReorderTask &&
      active.id !== over.id &&
      activeColumnId &&
      overColumnId === activeColumnId
    );

    if (!isValidDrop) return;

    const columnTasks = groupedTasks[activeColumnId!] ?? [];
    const oldIndex = columnTasks.findIndex((task) => task.id === active.id);
    const newIndex = columnTasks.findIndex((task) => task.id === over!.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    await onReorderTask(active.id as string, activeColumnId!, newIndex);
  }, [groupedTasks, onReorderTask, taskColumnById]);

  const statusTask = statusDropdown
    ? Object.values(groupedTasks).flat().find((task) => task.id === statusDropdown.taskId)
    : null;

  const listContent = (
    <>
      <div className="h-12 bg-blue-50 dark:bg-blue-900 border-b-4 border-blue-400 dark:border-blue-500 flex items-center justify-end px-3">
        <span className="text-sm text-blue-700 dark:text-blue-200 font-medium">{t('gantt.addTasksHere')}</span>
      </div>

      {Object.entries(groupedTasks).map(([columnId, tasks], groupIndex) => {
        if (tasks.length === 0) {
          return (
            <React.Fragment key={`empty-${columnId}`}>
              {groupIndex > 0 && (
                <div className="bg-pink-300 dark:bg-pink-600 h-0.5 w-full" />
              )}
            </React.Fragment>
          );
        }

        const taskIds = tasks.map((task) => task.id);

        return (
          <div key={columnId} data-column-id={columnId}>
            {groupIndex > 0 && (
              <div className="bg-pink-300 dark:bg-pink-600 h-0.5 w-full flex-shrink-0" />
            )}

            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {tasks.map((task, taskIndex) => (
                <SortableTaskRow
                  key={`tasklist-task-${task.id}-${columnId}-${taskIndex}`}
                  task={task}
                  columnId={columnId}
                  taskIndex={taskIndex}
                  isSelected={selectedTasks.includes(task.id)}
                  isMultiSelectMode={isMultiSelectMode}
                  isRelationshipMode={isRelationshipMode}
                  selectedParentTask={selectedParentTask}
                  taskViewMode={taskViewMode}
                  selectedTask={selectedTask}
                  onSelectTask={onSelectTask}
                  onTaskSelect={onTaskSelect}
                  onCopyTask={onCopyTask}
                  onRemoveTask={onRemoveTask}
                  highlightedTaskId={highlightedTaskId}
                  isAdmin={isAdmin}
                  canMutate={canMutate}
                  reorderEnabled={reorderEnabled}
                  onStatusClick={canMutate && onMoveTaskToColumn ? handleStatusClick : undefined}
                />
              ))}
            </SortableContext>
          </div>
        );
      })}
    </>
  );

  return (
    <div
      className="sticky left-0 z-10 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-visible"
      style={{ width: `${taskColumnWidth}px` }}
    >
      {reorderEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={sameColumnCollisionDetection}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          {listContent}
        </DndContext>
      ) : (
        listContent
      )}

      {statusDropdown && onMoveTaskToColumn && createPortal(
        <div
          ref={statusDropdownRef}
          role="dialog"
          aria-modal="true"
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999] min-w-[150px]"
          style={{ left: statusDropdown.left, top: statusDropdown.top }}
        >
          <div className="py-1 flex flex-col">
            {boardColumns.length > 0 ? (
              boardColumns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={async () => {
                    if (!statusDropdown) return;
                    try {
                      if (statusTask?.columnId !== col.id) {
                        await onMoveTaskToColumn(statusDropdown.taskId, col.id);
                      }
                    } finally {
                      setStatusDropdown(null);
                    }
                  }}
                  className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 block text-gray-900 dark:text-gray-100 ${
                    statusTask?.columnId === col.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''
                  }`}
                >
                  {columnDisplayTitle(col)}
                  {statusTask?.columnId === col.id && (
                    <span className="ml-2 text-blue-600 dark:text-blue-400">✓</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                {t('gantt.noColumnsAvailable')}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

GanttTaskList.displayName = 'GanttTaskList';

export default GanttTaskList;
