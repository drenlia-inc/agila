import React, { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { TaskHandleProps, DRAG_TYPES, GanttDragItem } from './types';

export const TaskHandle: React.FC<TaskHandleProps> = React.memo(({ 
  taskId, 
  task, 
  handleType, 
  onDateChange,
  taskColor 
}) => {
  const dragType = handleType === 'start' ? DRAG_TYPES.TASK_START_HANDLE : DRAG_TYPES.TASK_END_HANDLE;
  
  // Helper function to safely convert date to string
  const dateToString = (date: string | Date | undefined | null): string => {
    if (!date) return '';
    if (typeof date === 'string') return date.split('T')[0]; // Already a string, just get date part
    if (date instanceof Date) {
      // Format as local date to avoid timezone issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return '';
  };

  // Memoize drag data to prevent constant re-renders
  const dragData: GanttDragItem = useMemo(() => ({
    id: `${taskId}-${handleType}`,
    taskId,
    taskTitle: task.title,
    originalStartDate: dateToString(task.startDate),
    originalEndDate: dateToString(task.dueDate), // Note: Task uses dueDate, not endDate
    dragType
  }), [taskId, handleType, task.title, task.startDate, task.dueDate, dragType]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging
  } = useDraggable({
    id: dragData.id,
    data: dragData
  });


  // Don't apply transform during drag to avoid visual displacement
  // The task bar itself will show the visual feedback
  const style = {
    opacity: isDragging ? 0.3 : 1,
    backgroundColor: taskColor?.backgroundColor || '#6B7280'
  };

  const isStartHandle = handleType === 'start';
  const cursor = isStartHandle ? 'cursor-w-resize' : 'cursor-e-resize';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        absolute top-0 w-3 h-full opacity-60 hover:opacity-80 
        transition-all rounded-${isStartHandle ? 'l' : 'r'} flex items-center justify-center
        ${cursor} z-30
        ${isStartHandle ? 'left-0' : 'right-0'}
        ${isDragging ? 'shadow-lg' : ''}
      `}
    >
      <div className="w-0.5 h-3 bg-white rounded opacity-80"></div>
    </div>
  );
});
