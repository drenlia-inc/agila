/** Fired after local soft-delete so the board trash badge does not depend only on WebSocket. */
export const BOARD_TRASH_CHANGED_EVENT = 'easy-kanban:board-trash-changed';

/** Fired when trash/lifecycle data may have changed (task or board soft-delete, etc.). */
export const LIFECYCLE_DATA_CHANGED_EVENT = 'easy-kanban:lifecycle-data-changed';

export type BoardTrashChangedDetail = {
  boardId: string;
};

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
