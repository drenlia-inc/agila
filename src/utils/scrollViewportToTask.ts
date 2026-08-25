import type { Board, Columns } from '../types';

export function getTaskDetailsSafeViewport(): { safeLeft: number; safeRight: number } {
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

const JUMP_HIGHLIGHT_CLASS = 'task-jump-highlight';
const JUMP_HIGHLIGHT_MS = 1800;

/** Pulse the card/row so a jump is visible even when Task Details stays closed. */
function flashJumpHighlight(el: HTMLElement): void {
  el.classList.remove(JUMP_HIGHLIGHT_CLASS);
  // Reading offsetWidth restarts the animation when jumping to the same task twice.
  void el.offsetWidth;
  el.classList.add(JUMP_HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(JUMP_HIGHLIGHT_CLASS), JUMP_HIGHLIGHT_MS);
}

function findTaskElement(taskId: string): HTMLElement | null {
  if (typeof document === 'undefined' || !taskId) return null;

  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(taskId)
      : taskId.replace(/"/g, '\\"');

  const kanban = document.querySelector(
    `[data-kanban-task-row][data-task-id="${escaped}"]`
  );
  return (
    (kanban instanceof HTMLElement ? kanban : null) ||
    (document.querySelector(`[data-task-id="${escaped}"]`) as HTMLElement | null)
  );
}

/**
 * Scroll the board (or list/gantt) so a task card is in view.
 * Kanban virtualization keeps the selected task mounted (`pinnedIndex`).
 */
export function scrollViewportToTask(taskId: string): boolean {
  const el = findTaskElement(taskId);
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
  flashJumpHighlight(el);

  return true;
}

const SETTLE_INTERVAL_MS = 50;
const SETTLE_TIMEOUT_MS = 700;

/**
 * Wait for the card to stop moving before scrolling to it. A jump often clears
 * the header text filter, and the board re-renders with every task restored a
 * frame or two later — scrolling before that lands on a position the card has
 * already left, and the highlight fires off screen.
 */
function scrollWhenSettled(taskId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let waited = 0;
    let stableSamples = 0;
    let previous: { top: number; left: number } | null = null;

    const step = () => {
      const el = findTaskElement(taskId);
      const timedOut = waited >= SETTLE_TIMEOUT_MS;

      if (el) {
        const rect = el.getBoundingClientRect();
        const held =
          previous !== null &&
          Math.abs(rect.top - previous.top) < 1 &&
          Math.abs(rect.left - previous.left) < 1;
        previous = { top: rect.top, left: rect.left };
        stableSamples = held ? stableSamples + 1 : 0;

        if (stableSamples >= 2 || timedOut) {
          resolve(scrollViewportToTask(taskId));
          return;
        }
      } else if (timedOut) {
        // Re-render unmounted the row (virtualization) and it never came back.
        resolve(false);
        return;
      }

      waited += SETTLE_INTERVAL_MS;
      window.setTimeout(step, SETTLE_INTERVAL_MS);
    };

    step();
  });
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
      if (findTaskElement(taskId)) {
        void scrollWhenSettled(taskId).then(resolve);
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
