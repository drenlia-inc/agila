/** Latest pointer in viewport coords. Updated without React state. */
export const lastKanbanPointer = { x: 0, y: 0 };

export function setLastKanbanPointer(x: number, y: number): void {
  lastKanbanPointer.x = x;
  lastKanbanPointer.y = y;
}
