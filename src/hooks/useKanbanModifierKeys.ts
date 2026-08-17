import { useEffect } from 'react';
import { isEditableEscapeTarget } from '../utils/escapeKeyUtils';

const CTRL_CLASS = 'kanban-mod-ctrl';
const SHIFT_CLASS = 'kanban-mod-shift';

function clearKanbanModifierClasses(): void {
  document.body.classList.remove(CTRL_CLASS, SHIFT_CLASS);
}

function applyKanbanModifierClasses(ctrl: boolean, shift: boolean): void {
  document.body.classList.toggle(CTRL_CLASS, ctrl);
  document.body.classList.toggle(SHIFT_CLASS, shift && !ctrl);
}

/**
 * While Ctrl/Cmd or Shift is held (and the user is not typing), mark <body>
 * so card chrome buttons cannot steal the click. Ctrl = multi-select;
 * Shift = range-select (delete remains clickable via data-kanban-mod-allow).
 */
export function useKanbanModifierKeys(): void {
  useEffect(() => {
    const fromEvent = (e: KeyboardEvent | PointerEvent | MouseEvent) => {
      if (isEditableEscapeTarget(e.target) || isEditableEscapeTarget(document.activeElement)) {
        clearKanbanModifierClasses();
        return;
      }
      applyKanbanModifierClasses(e.ctrlKey || e.metaKey, e.shiftKey);
    };

    const onBlur = () => clearKanbanModifierClasses();

    const onSelectStart = (e: Event) => {
      if (isEditableEscapeTarget(e.target) || isEditableEscapeTarget(document.activeElement)) {
        return;
      }
      if (!(e.target instanceof Element) || !e.target.closest('.task-card')) return;
      if (document.body.classList.contains(SHIFT_CLASS) || document.body.classList.contains(CTRL_CLASS)) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', fromEvent, true);
    window.addEventListener('keyup', fromEvent, true);
    window.addEventListener('pointerdown', fromEvent, true);
    document.addEventListener('selectstart', onSelectStart, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);
    return () => {
      window.removeEventListener('keydown', fromEvent, true);
      window.removeEventListener('keyup', fromEvent, true);
      window.removeEventListener('pointerdown', fromEvent, true);
      document.removeEventListener('selectstart', onSelectStart, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      clearKanbanModifierClasses();
    };
  }, []);
}
