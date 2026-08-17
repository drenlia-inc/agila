import type { Board, Columns } from '../types';

function getTaskDetailsSafeViewport(): { safeLeft: number; safeRight: number } {
  const margin = 16;
  const details = document.querySelector('[data-task-details]');
  if (details instanceof HTMLElement) {
    const rect = details.getBoundingClientRect();
    if (rect.width > 0 && rect.left < window.innerWidth) {
      return {
        safeLeft: margin,
        safeRight: Math.max(margin + 80, rect.left - margin),
      };
    }
  }
  return { safeLeft: margin, safeRight: window.innerWidth - margin };
}

function scrollKanbanHorizontallyClearOfPanel(
  el: HTMLElement,
  boardScroller: HTMLElement,
  safeLeft: number,
  safeRight: number
): void {
  const eRect = el.getBoundingClientRect();
  const visibleWidth = safeRight - safeLeft;
  if (visibleWidth <= 0) return;

  let targetLeft = eRect.left;
  if (eRect.right > safeRight) {
    targetLeft -= eRect.right - safeRight;
  }
  if (targetLeft + eRect.width > safeRight) {
    targetLeft = safeRight - eRect.width;
  }
  if (targetLeft < safeLeft) {
    targetLeft = safeLeft;
  }

  const delta = eRect.left - targetLeft;
  if (Math.abs(delta) > 2) {
    boardScroller.scrollBy({ left: delta, behavior: 'smooth' });
  }
}

/**
 * Scroll the board (or list/gantt) so a task card is in view.
 * Kanban virtualization keeps the selected task mounted (`pinnedIndex`).
 */
export function scrollViewportToTask(taskId: string): boolean {
  if (typeof document === 'undefined' || !taskId) return false;

  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(taskId)
      : taskId.replace(/"/g, '\\"');

  const kanban = document.querySelector(
    `[data-kanban-task-row][data-task-id="${escaped}"]`
  );
  const el =
    (kanban instanceof HTMLElement ? kanban : null) ||
    (document.querySelector(`[data-task-id="${escaped}"]`) as HTMLElement | null);

  if (!el) return false;

  const boardScroller = document.querySelector('.kanban-scrollable-container');
  const applyHorizontalReveal = () => {
    if (!(boardScroller instanceof HTMLElement)) return;
    const { safeLeft, safeRight } = getTaskDetailsSafeViewport();
    scrollKanbanHorizontallyClearOfPanel(el, boardScroller, safeLeft, safeRight);
  };

  applyHorizontalReveal();
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  // scrollIntoView can leave the card under TaskDetails — nudge the board scroller afterward.
  window.setTimeout(applyHorizontalReveal, 320);

  return true;
}

export function scrollViewportToTaskWhenReady(
  taskId: string,
  options?: { maxAttempts?: number; intervalMs?: number }
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? 40;
  const intervalMs = options?.intervalMs ?? 100;

  return new Promise((resolve) => {
    let attempts = 0;
    const tryScroll = () => {
      if (scrollViewportToTask(taskId)) {
        resolve(true);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        resolve(false);
        return;
      }
      window.setTimeout(tryScroll, intervalMs);
    };
    tryScroll();
  });
}

function taskExistsInColumns(taskId: string, boardColumns?: Columns | null): boolean {
  if (!boardColumns) return false;
  for (const column of Object.values(boardColumns)) {
    if (column?.tasks?.some((task) => task.id === taskId)) return true;
  }
  return false;
}

/** Resolve which board holds a live task, preferring loaded column data over stale boardId. */
export function findBoardIdForTask(
  taskId: string,
  taskBoardId: string | undefined,
  boards: Board[],
  currentColumns: Columns,
  selectedBoardId: string | null
): string | null {
  if (selectedBoardId && taskExistsInColumns(taskId, currentColumns)) {
    return selectedBoardId;
  }

  for (const board of boards) {
    if (taskExistsInColumns(taskId, board.columns)) {
      return board.id;
    }
  }

  if (taskBoardId && boards.some((board) => board.id === taskBoardId)) {
    return taskBoardId;
  }

  return null;
}
