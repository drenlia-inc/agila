/**
 * Shared Escape-key helpers for layered dismiss (menus → TaskDetails → multi-check).
 */

export function isEditableEscapeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return !!(
    target.closest('[contenteditable="true"]') ||
    target.closest('.ProseMirror') ||
    target.closest('.tiptap')
  );
}

/** True when a modal/menu/confirm should consume Escape before board-level handlers. */
export function hasEscapeConsumingOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  if (document.querySelector('[id^="column-bulk-menu-"]')) return true;
  if (document.querySelector('.delete-confirmation')) return true;
  return false;
}
