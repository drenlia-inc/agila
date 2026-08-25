/** Fired after local soft-delete so the board trash badge does not depend only on WebSocket. */
export const BOARD_TRASH_CHANGED_EVENT = 'easy-kanban:board-trash-changed';

/** Fired when trash/lifecycle data may have changed (task or board soft-delete, etc.). */
export const LIFECYCLE_DATA_CHANGED_EVENT = 'easy-kanban:lifecycle-data-changed';

/** Ask Kanban chrome to close the live-board trash panel so a task card can scroll into view. */
export const CLOSE_BOARD_TRASH_EVENT = 'easy-kanban:close-board-trash';

/** Ask Kanban chrome to open the trash panel, e.g. when jumping to a soft-deleted task. */
export const OPEN_BOARD_TRASH_EVENT = 'easy-kanban:open-board-trash';

export type BoardTrashChangedDetail = {
  boardId: string;
};

export type CloseBoardTrashDetail = {
  boardId: string;
};

export type OpenBoardTrashDetail = {
  boardId: string;
};

const TRASH_OPEN_STORAGE_KEY = 'easyKanban.trashOpenByBoard';

export function readBoardTrashOpenPreference(boardId: string | null): boolean {
  if (!boardId || typeof sessionStorage === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(TRASH_OPEN_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return !!parsed?.[boardId];
  } catch {
    return false;
  }
}

export function writeBoardTrashOpenPreference(boardId: string | null, open: boolean) {
  if (!boardId || typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(TRASH_OPEN_STORAGE_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, boolean>;
    if (open) {
      parsed[boardId] = true;
    } else {
      delete parsed[boardId];
    }
    if (Object.keys(parsed).length === 0) {
      sessionStorage.removeItem(TRASH_OPEN_STORAGE_KEY);
    } else {
      sessionStorage.setItem(TRASH_OPEN_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {
    // ignore quota / private mode
  }
}

export function closeBoardTrashView(boardId: string) {
  writeBoardTrashOpenPreference(boardId, false);
  window.dispatchEvent(
    new CustomEvent(CLOSE_BOARD_TRASH_EVENT, {
      detail: { boardId } satisfies CloseBoardTrashDetail,
    })
  );
}

export function openBoardTrashView(boardId: string) {
  writeBoardTrashOpenPreference(boardId, true);
  window.dispatchEvent(
    new CustomEvent(OPEN_BOARD_TRASH_EVENT, {
      detail: { boardId } satisfies OpenBoardTrashDetail,
    })
  );
}

export function notifyLifecycleDataChanged() {
  window.dispatchEvent(new CustomEvent(LIFECYCLE_DATA_CHANGED_EVENT));
}

export function notifyBoardTrashChanged(boardId: string | null | undefined) {
  if (!boardId) return;
  window.dispatchEvent(
    new CustomEvent(BOARD_TRASH_CHANGED_EVENT, {
      detail: { boardId } satisfies BoardTrashChangedDetail,
    })
  );
  notifyLifecycleDataChanged();
}
