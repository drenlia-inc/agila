import { useEffect } from 'react';
import type { TaskViewMode, ViewMode } from '../utils/userPreferences';
import {
  focusHeaderTaskSearch,
  isTypingTarget,
  shouldIgnoreBoardShortcut,
} from '../utils/keyboardShortcutUtils';

export type KeyboardShortcutHandlers = {
  onHelp: () => void;
  /** Focus board header search (/ and Ctrl/Cmd+K). Only used when boardShortcutsEnabled. */
  onFocusSearch?: () => void;
  /** Create a task on the first column (N). */
  onNewTask?: () => void;
  /** Switch Kanban / List / Gantt (1 / 2 / 3). */
  onViewMode?: (mode: ViewMode) => void;
  /** Card density Full / Preview / Minimal (F / P / M). */
  onTaskViewMode?: (mode: TaskViewMode) => void;
  /** Toggle Tools Search & Filter panel (S). */
  onToggleSearchPanel?: () => void;
  /** When true, board letter shortcuts are active. */
  boardShortcutsEnabled?: boolean;
};

/**
 * Global keyboard shortcuts.
 * Character shortcuts never fire while typing in inputs / TipTap / overlays.
 * F1 always opens Help; ? opens Help when not typing.
 */
export const useKeyboardShortcuts = ({
  onHelp,
  onFocusSearch,
  onNewTask,
  onViewMode,
  onTaskViewMode,
  onToggleSearchPanel,
  boardShortcutsEnabled = false,
}: KeyboardShortcutHandlers) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // F1 — always available (does not insert text)
      if (event.key === 'F1') {
        event.preventDefault();
        onHelp();
        return;
      }

      // ? — help when not typing (Shift+/ on US layouts)
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        onHelp();
        return;
      }

      if (!boardShortcutsEnabled) return;
      if (shouldIgnoreBoardShortcut(event)) return;
      if (event.repeat) return;

      const mod = event.metaKey || event.ctrlKey;

      // Ctrl/Cmd+K — focus header search
      if (mod && !event.altKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        if (onFocusSearch) onFocusSearch();
        else focusHeaderTaskSearch();
        return;
      }

      // Plain / — focus header search (Admin keeps its own / when boardShortcutsEnabled is false)
      if (event.key === '/' && !mod && !event.altKey) {
        event.preventDefault();
        if (onFocusSearch) onFocusSearch();
        else focusHeaderTaskSearch();
        return;
      }

      // N — new task
      if ((event.key === 'n' || event.key === 'N') && !mod && !event.altKey) {
        if (!onNewTask) return;
        event.preventDefault();
        onNewTask();
        return;
      }

      // S — Tools Search & Filter panel (not header search)
      if ((event.key === 's' || event.key === 'S') && !mod && !event.altKey) {
        if (!onToggleSearchPanel) return;
        event.preventDefault();
        onToggleSearchPanel();
        return;
      }

      // F / P / M — card density (Full / Preview / Minimal)
      if (!mod && !event.altKey && onTaskViewMode) {
        if (event.key === 'f' || event.key === 'F') {
          event.preventDefault();
          onTaskViewMode('expand');
          return;
        }
        if (event.key === 'p' || event.key === 'P') {
          event.preventDefault();
          onTaskViewMode('shrink');
          return;
        }
        if (event.key === 'm' || event.key === 'M') {
          event.preventDefault();
          onTaskViewMode('compact');
          return;
        }
      }

      // 1 / 2 / 3 — board view modes (key value so AZERTY Shift+digit still works)
      if (!mod && !event.altKey && onViewMode) {
        if (event.key === '1') {
          event.preventDefault();
          onViewMode('kanban');
          return;
        }
        if (event.key === '2') {
          event.preventDefault();
          onViewMode('list');
          return;
        }
        if (event.key === '3') {
          event.preventDefault();
          onViewMode('gantt');
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    onHelp,
    onFocusSearch,
    onNewTask,
    onViewMode,
    onTaskViewMode,
    onToggleSearchPanel,
    boardShortcutsEnabled,
  ]);
};
