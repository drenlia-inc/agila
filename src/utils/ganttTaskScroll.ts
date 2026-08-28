const JUMP_HIGHLIGHT_CLASS = 'task-jump-highlight';
const JUMP_HIGHLIGHT_MS = 1800;

function escapeTaskId(taskId: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(taskId);
  }
  return taskId.replace(/"/g, '\\"');
}

/** Bottom edge of sticky Gantt date chrome — rows should sit below this. */
export function getGanttTaskBandTopPx(): number {
  const timelineHeader = document.querySelector('[data-gantt-timeline-header]');
  if (timelineHeader instanceof HTMLElement) {
    return timelineHeader.getBoundingClientRect().bottom;
  }

  const appHeader = document.querySelector('header[data-tour-id="navigation"]');
  return (appHeader?.getBoundingClientRect().bottom ?? 64) + 105;
}

export function findGanttTaskRowElement(taskId: string): HTMLElement | null {
  if (!taskId || typeof document === 'undefined') return null;

  const escaped = escapeTaskId(taskId);
  const inList = document.querySelector(`[data-gantt-task-list] [data-task-id="${escaped}"]`);
  if (inList instanceof HTMLElement) return inList;

  const fallback = document.querySelector(`[data-task-id="${escaped}"]`);
  return fallback instanceof HTMLElement ? fallback : null;
}

function flashJumpHighlight(el: HTMLElement): void {
  el.classList.remove(JUMP_HIGHLIGHT_CLASS);
  void el.offsetWidth;
  el.classList.add(JUMP_HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(JUMP_HIGHLIGHT_CLASS), JUMP_HIGHLIGHT_MS);
}

/**
 * Scroll the page so a Gantt task row is visible below sticky headers.
 * Gantt rows live in normal document flow (window scroll), not mainContentRef.
 */
export function scrollGanttTaskRowIntoView(
  taskId: string,
  options?: { behavior?: ScrollBehavior }
): boolean {
  const el = findGanttTaskRowElement(taskId);
  if (!el) return false;

  const margin = 8;
  const bandTop = getGanttTaskBandTopPx();
  const safeTop = bandTop + margin;
  const safeBottom = window.innerHeight - margin;
  const rect = el.getBoundingClientRect();

  const alreadyVisible = rect.top >= safeTop && rect.bottom <= safeBottom;
  if (!alreadyVisible) {
    const visibleHeight = Math.max(120, safeBottom - safeTop);
    const targetScrollY =
      window.scrollY + rect.top - safeTop - (visibleHeight - rect.height) / 2;

    window.scrollTo({
      top: Math.max(0, targetScrollY),
      behavior: options?.behavior ?? 'smooth',
    });
  }

  flashJumpHighlight(el);
  return true;
}

export function scrollGanttTaskRowIntoViewWhenReady(
  taskId: string,
  options?: { maxAttempts?: number; intervalMs?: number; behavior?: ScrollBehavior }
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? 40;
  const intervalMs = options?.intervalMs ?? 100;

  return new Promise((resolve) => {
    let attempts = 0;
    const tryScroll = () => {
      if (scrollGanttTaskRowIntoView(taskId, { behavior: options?.behavior ?? 'smooth' })) {
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
