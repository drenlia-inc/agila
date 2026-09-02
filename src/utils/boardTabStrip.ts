/**
 * Board-tab strip geometry. Used so a task drag only treats the pointer as
 * “over tabs” when it is inside the real strip — not a padded band above it,
 * and not because closestCorners picked a nearby sticky tab.
 */

export function getBoardTabStripElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el =
    document.querySelector('[data-tour-id="board-tabs"]') ||
    document.querySelector('[data-board-tabs-scroll]') ||
    document.querySelector('.board-tabs-scroll');
  return el instanceof HTMLElement ? el : null;
}

export function getBoardTabStripRect(): DOMRect | null {
  const el = getBoardTabStripElement();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return r;
}

export function pointerInBoardTabStrip(x: number, y: number): boolean {
  const r = getBoardTabStripRect();
  if (!r) return false;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Tab under the pointer (visible tab chrome, not the card-sized drag rect). */
export function boardTabIdUnderPointer(x: number, y: number): string | null {
  if (typeof document === 'undefined') return null;
  if (!pointerInBoardTabStrip(x, y)) return null;
  const tabs = document.querySelectorAll('[data-board-tab-id]');
  for (const el of tabs) {
    if (!(el instanceof HTMLElement)) continue;
    const id = el.getAttribute('data-board-tab-id');
    if (!id) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
  }
  return null;
}

export function getBoardTabsScrollElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el =
    document.querySelector('[data-board-tabs-scroll]') ||
    document.querySelector('.board-tabs-scroll');
  return el instanceof HTMLElement ? el : null;
}

/** Scroll hidden tabs into view when the pointer sits on a strip edge. */
export function autoScrollBoardTabs(x: number, y: number): void {
  const strip = getBoardTabStripRect();
  if (!strip || y < strip.top || y > strip.bottom) return;
  const scroller = getBoardTabsScrollElement();
  if (!scroller) return;
  if (scroller.scrollWidth - scroller.clientWidth <= 1) return;
  const sr = scroller.getBoundingClientRect();
  const edge = 48;
  let step = 0;
  if (x <= sr.left + edge || x <= strip.left + 56) {
    const t = Math.min(1, Math.max(0.35, (sr.left + edge - x) / edge));
    step = -Math.max(10, t * 22);
  } else if (x >= sr.right - edge || x >= strip.right - 56) {
    const t = Math.min(1, Math.max(0.35, (x - (sr.right - edge)) / edge));
    step = Math.max(10, t * 22);
  }
  if (step) scroller.scrollLeft += step;
}
