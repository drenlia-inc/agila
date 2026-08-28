import type { Task } from '../types';
import type { ViewMode } from './userPreferences';
import { requestTaskJump } from './taskJumpEvents';
import { scrollViewportToTaskWhenReady } from './scrollViewportToTask';

const NEW_TASK_TITLE_EDIT_EVENT = 'agila:new-task-title-edit';

let pendingTitleEditTaskId: string | null = null;

/** Ask Kanban cards / List rows to open inline title edit with the title selected. */
export function requestNewTaskTitleEdit(taskId: string): void {
  pendingTitleEditTaskId = taskId;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<{ taskId: string }>(NEW_TASK_TITLE_EDIT_EVENT, {
      detail: { taskId },
    })
  );
}

export function subscribeNewTaskTitleEdit(
  listener: (taskId: string) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<{ taskId: string }>).detail.taskId);
  };
  window.addEventListener(NEW_TASK_TITLE_EDIT_EVENT, handleEvent);

  if (pendingTitleEditTaskId) {
    const taskId = pendingTitleEditTaskId;
    window.queueMicrotask(() => listener(taskId));
  }

  return () => window.removeEventListener(NEW_TASK_TITLE_EDIT_EVENT, handleEvent);
}

export function completeNewTaskTitleEdit(taskId: string): void {
  if (pendingTitleEditTaskId === taskId) {
    pendingTitleEditTaskId = null;
  }
}

function scheduleTaskJump(task: Task): void {
  requestTaskJump(task);
  for (const delayMs of [80, 200, 400]) {
    window.setTimeout(() => requestTaskJump(task), delayMs);
  }
}

/** Scroll or jump to a freshly created task; Kanban/List also open inline title edit. */
export function revealNewlyCreatedTask(task: Task, viewMode: ViewMode): void {
  if (viewMode === 'gantt' || viewMode === 'calendar') {
    if (!task.startDate && !task.dueDate) return;
    scheduleTaskJump(task);
    if (viewMode === 'gantt') {
      void scrollViewportToTaskWhenReady(task.id, { maxAttempts: 60 });
    }
    return;
  }

  void scrollViewportToTaskWhenReady(task.id, { maxAttempts: 40 }).then((found) => {
    if (found) {
      requestNewTaskTitleEdit(task.id);
    }
  });
}
