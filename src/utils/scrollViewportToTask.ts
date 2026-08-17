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
  const details = document.querySelector('[data-task-details]');
  const detailsWidth =
    details instanceof HTMLElement ? details.getBoundingClientRect().width : 0;
  const visibleRight =
    window.innerWidth - detailsWidth - 16;

  if (boardScroller instanceof HTMLElement) {
    const sRect = boardScroller.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const targetLeft = sRect.left + 24;
    const targetRight = Math.min(sRect.right, visibleRight);
    if (eRect.left < targetLeft || eRect.right > targetRight) {
      const visibleWidth = Math.max(120, targetRight - targetLeft);
      const delta =
        eRect.left - targetLeft - (visibleWidth - eRect.width) / 2;
      boardScroller.scrollBy({ left: delta, behavior: 'smooth' });
    }
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  return true;
}
