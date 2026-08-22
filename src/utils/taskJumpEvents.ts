import type { Task } from '../types';

const TASK_JUMP_EVENT = 'agila:jump-to-task';

export interface TaskJumpRequest {
  task: Task;
}

let pendingRequest: TaskJumpRequest | null = null;

export function requestTaskJump(task: Task): void {
  pendingRequest = { task };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<TaskJumpRequest>(TASK_JUMP_EVENT, {
        detail: pendingRequest,
      })
    );
  }
}

export function subscribeTaskJump(
  listener: (request: TaskJumpRequest) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<TaskJumpRequest>).detail);
  };
  window.addEventListener(TASK_JUMP_EVENT, handleEvent);

  // Keep a request until its view mounts. This matters when Task Details jumps
  // from another page or changes boards before the destination view renders.
  if (pendingRequest) {
    const request = pendingRequest;
    window.queueMicrotask(() => listener(request));
  }

  return () => window.removeEventListener(TASK_JUMP_EVENT, handleEvent);
}

export function completeTaskJump(taskId: string): void {
  if (pendingRequest?.task.id === taskId) {
    pendingRequest = null;
  }
}
