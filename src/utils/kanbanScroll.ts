/** Instantly jump the window to the top (Kanban board page scroll). */
export function scrollKanbanPageToTop(behavior: ScrollBehavior = 'auto'): void {
  if (typeof window === 'undefined') return;
  if (window.scrollY <= 0 && document.documentElement.scrollTop <= 0) return;
  window.scrollTo({ top: 0, behavior });
}

/**
 * Fast ease-out scroll to top (shorter than native smooth for tall pages).
 * Resolves when the animation finishes (or immediately if already at top).
 */
export function scrollKanbanPageToTopFastSmooth(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const start = Math.max(window.scrollY, document.documentElement.scrollTop);
  if (start <= 0) return Promise.resolve();

  // ~180–420ms depending on distance — snappy but still smooth
  const duration = Math.min(420, Math.max(180, start * 0.28));
  const t0 = performance.now();

  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) ** 3;
      window.scrollTo(0, start * (1 - eased));
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/** True when the page is scrolled down enough to warrant a “back to top” control. */
export function isKanbanPageScrolledDown(thresholdPx = 200): boolean {
  if (typeof window === 'undefined') return false;
  return Math.max(window.scrollY, document.documentElement.scrollTop) > thresholdPx;
}
