/** Reveal hidden chrome when Help “Go there” only highlights a selector. */

export const HELP_GO_THERE_EVENT = 'agila:help-go-there';

export type HelpRevealAction = 'boardToolbar' | 'searchFilters' | 'columnFilter' | 'trash';

const pending = new Set<HelpRevealAction>();

export function queueHelpReveal(actions: readonly string[]): void {
  for (const raw of actions) {
    if (
      raw === 'boardToolbar' ||
      raw === 'searchFilters' ||
      raw === 'columnFilter' ||
      raw === 'trash'
    ) {
      pending.add(raw);
    }
  }
  pulseHelpReveal();
  if (typeof window !== 'undefined') {
    window.setTimeout(pulseHelpReveal, 160);
    window.setTimeout(pulseHelpReveal, 400);
  }
}

export function pulseHelpReveal(): void {
  if (typeof window === 'undefined' || pending.size === 0) return;
  window.dispatchEvent(
    new CustomEvent(HELP_GO_THERE_EVENT, { detail: { actions: [...pending] } })
  );
}

export function takeHelpReveal(action: HelpRevealAction): boolean {
  if (!pending.has(action)) return false;
  pending.delete(action);
  return true;
}

export function onHelpReveal(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const fn = () => handler();
  window.addEventListener(HELP_GO_THERE_EVENT, fn);
  return () => window.removeEventListener(HELP_GO_THERE_EVENT, fn);
}
