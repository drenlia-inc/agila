export type InviteBoardOption = {
  id: string;
  title?: string;
  deletedAt?: string | null;
  deleted_at?: string | null;
};

export function liveInviteBoards(boards: InviteBoardOption[] = []): InviteBoardOption[] {
  return boards.filter((board) => {
    if (!board?.id) return false;
    if (board.deletedAt || board.deleted_at) return false;
    return true;
  });
}

export function defaultInviteBoardIds(
  boards: InviteBoardOption[],
  preferredId?: string | null
): string[] {
  const live = liveInviteBoards(boards);
  const ids = live.map((board) => board.id);
  if (preferredId && ids.includes(preferredId)) return [preferredId];
  if (ids.length === 1) return [ids[0]];
  return [];
}

export function roleNeedsInviteBoards(role: string | undefined): boolean {
  return role !== 'admin';
}
