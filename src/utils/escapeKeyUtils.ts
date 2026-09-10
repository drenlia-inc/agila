/**
 * Shared Escape-key helpers for layered dismiss (menus → TaskDetails → multi-check).
 */

/** Inputs that are not text fields — Escape should not be treated as “still typing”. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'hidden',
  'range',
  'file',
  'image',
]);

export function isEditableEscapeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
  }
  if (target.isContentEditable) return true;
  return !!(
    target.closest('[contenteditable="true"]') ||
    target.closest('.ProseMirror') ||
    target.closest('.tiptap')
  );
}

/**
 * First Escape leaves a text field (blur). Callers then return so a second Escape
 * can close details or clear multi-select.
 */
export function blurEditableEscapeTarget(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if (!isEditableEscapeTarget(event.target)) return false;
  if (!(event.target instanceof HTMLElement)) return false;
  event.target.blur();
  event.preventDefault();
  return true;
}

/** True when a modal/menu/confirm should consume Escape before board-level handlers. */
export function hasEscapeConsumingOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  if (document.querySelector('[id^="column-bulk-menu-"]')) return true;
  if (document.querySelector('.delete-confirmation')) return true;
  return false;
}
