import { Task } from '../../types';

// Drag item types for different drag operations (timeline date move / resize)
export const DRAG_TYPES = {
  TASK_START_HANDLE: 'task-start-handle',
  TASK_END_HANDLE: 'task-end-handle',
  TASK_MOVE_HANDLE: 'task-move-handle',
  TASK_BODY: 'task-body',
} as const;

export type DragType = typeof DRAG_TYPES[keyof typeof DRAG_TYPES];

/** Options for Gantt multi-select clicks. */
export type GanttTaskSelectOptions = {
  range?: boolean;
  additive?: boolean;
  source?: 'list' | 'bar';
};

// Data passed during drag operations
export interface TaskDragData {
  taskId: string;
  taskTitle: string;
  originalStartDate: string;
  originalEndDate: string;
  dragType: DragType;
}

// Drop result when dropping on a date column
export interface DateDropResult {
  date: string;
  dateIndex: number;
}

// Combined drag item for dnd-kit
export interface GanttDragItem extends TaskDragData {
  id: string; // Required by dnd-kit
}

// Union type for all possible drag items
export type AnyDragItem = GanttDragItem;

// Props for draggable task handles
export interface TaskHandleProps {
  taskId: string;
  task: Task;
  handleType: 'start' | 'end';
  onDateChange: (taskId: string, handleType: 'start' | 'end', newDate: string) => void;
  taskColor?: {
    backgroundColor: string;
    color: string;
  };
}

// Props for droppable date columns
export interface DateColumnProps {
  date: Date;
  dateIndex: number;
  children: React.ReactNode;
  onTaskDrop: (dragData: TaskDragData, targetDate: string) => void;
}
