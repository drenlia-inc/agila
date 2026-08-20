import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Copy,
  Eye,
  Layers,
  Square,
  Tag as TagIcon,
  Trash2,
  Calendar,
  Flag,
  Plus,
  User,
  UserCircle,
  UserPlus,
} from 'lucide-react';
import { Board, PriorityOption, Tag, Task, TeamMember } from '../types';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';
import { getTagDisplayStyle } from '../utils/tagUtils';
import { truncateMemberName } from '../utils/memberUtils';
import AddTagModal from './AddTagModal';
import MemberAvatar from './ui/MemberAvatar';
import MemberSearchList from './ui/MemberSearchList';
import { layoutMemberDropdownFromElement } from '../utils/memberDropdownLayout';

export type ColumnBulkActionBarProps = {
  columnId: string;
  selectedCount: number;
  selectedTasks?: Task[];
  members?: TeamMember[];
  showUnselectAll?: boolean;
  isAdmin?: boolean;
  hasArchiveColumn?: boolean;
  availableTags?: Tag[];
  availablePriorities?: PriorityOption[];
  availableSprints?: Array<{ id: string; name: string }>;
  boards?: Board[];
  currentBoardId?: string | null;
  busy?: boolean;
  onUnselectAll: () => void;
  onAddTag: (tagId: string) => void;
  onCopy: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** When set (admin), Shift+click on delete confirms permanent purge. */
  onPermanentDelete?: () => void;
  onSprint: (sprintId: string | null) => void;
  onPriority: (priorityId: string) => void;
  onMoveToBoard: (boardId: string) => void;
  onAssignee?: (memberId: string) => void;
  onRequester?: (memberId: string) => void;
  onAddWatcher?: (memberId: string) => void;
  onRemoveWatcher?: (memberId: string) => void;
  onAddCollaborator?: (memberId: string) => void;
  onRemoveCollaborator?: (memberId: string) => void;
};

type MenuKind =
  | 'tag'
  | 'sprint'
  | 'priority'
  | 'board'
  | 'assignee'
  | 'requester'
  | 'watchers'
  | 'collaborators'
  | null;

type UnionMemberChip = {
  member: TeamMember;
  count: number;
};

function unionMembersFromTasks(
  tasks: Task[],
  members: TeamMember[],
  field: 'watchers' | 'collaborators'
): UnionMemberChip[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const list = task[field] || [];
    const seen = new Set<string>();
    for (const entry of list) {
      if (!entry?.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
    }
  }
  const memberById = new Map(members.map((m) => [m.id, m]));
  return Array.from(counts.entries())
    .map(([id, count]) => {
      const fromMembers = memberById.get(id);
      const fromTask = tasks
        .flatMap((t) => t[field] || [])
        .find((m) => m && m.id === id);
      const member = fromMembers || fromTask;
      if (!member) return null;
      return { member, count };
    })
    .filter((x): x is UnionMemberChip => Boolean(x))
    .sort((a, b) =>
      (a.member.name || '').localeCompare(b.member.name || '', undefined, {
        sensitivity: 'base',
      })
    );
}

const btnClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700';

const MEMBER_MENU_WIDTH = 280;

export default function ColumnBulkActionBar({
  columnId,
  selectedCount,
  selectedTasks = [],
  members = [],
  showUnselectAll = false,
  isAdmin = false,
  hasArchiveColumn = false,
  availableTags = [],
  availablePriorities = [],
  availableSprints = [],
  boards = [],
  currentBoardId = null,
  busy = false,
  onUnselectAll,
  onAddTag,
  onCopy,
  onArchive,
  onDelete,
  onPermanentDelete,
  onSprint,
  onPriority,
  onMoveToBoard,
  onAssignee,
  onRequester,
  onAddWatcher,
  onRemoveWatcher,
  onAddCollaborator,
  onRemoveCollaborator,
}: ColumnBulkActionBarProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuKind>(null);
  const [menuPos, setMenuPos] = useState<
    { top: number; left: number; width?: number; height?: number; columns?: 1 | 2 } | null
  >(null);
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false);
  const [boardConfirm, setBoardConfirm] = useState<{ id: string; name: string } | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const watcherChips = useMemo(
    () => unionMembersFromTasks(selectedTasks, members, 'watchers'),
    [selectedTasks, members]
  );
  const collaboratorChips = useMemo(
    () => unionMembersFromTasks(selectedTasks, members, 'collaborators'),
    [selectedTasks, members]
  );

  const isMemberMenu = (kind: MenuKind) =>
    kind === 'assignee' ||
    kind === 'requester' ||
    kind === 'watchers' ||
    kind === 'collaborators';

  const openMenu = (kind: MenuKind, el: HTMLElement | null) => {
    if (!el) return;
    if (menu === kind) {
      setMenu(null);
      setMenuPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (kind === 'assignee' || kind === 'requester') {
      const layout = layoutMemberDropdownFromElement(el, members || [], {
        showAgent: kind === 'assignee',
        excludeViewers: kind === 'assignee',
        placement: 'beside',
      });
      setMenuPos(layout);
      setMenu(kind);
      setDeleteConfirm(false);
      setBoardConfirm(null);
      return;
    }
    const menuWidth = kind === 'tag' ? 200 : isMemberMenu(kind) ? MEMBER_MENU_WIDTH : 192;
    const menuHeight = kind === 'tag' ? 400 : isMemberMenu(kind) ? 360 : 256;
    const preferredLeft = rect.right + 6;
    setMenuPos({
      top: Math.max(8, Math.min(rect.top, window.innerHeight - menuHeight - 8)),
      left:
        preferredLeft + menuWidth <= window.innerWidth - 8
          ? preferredLeft
          : Math.max(8, rect.left - menuWidth - 6),
    });
    setMenu(kind);
    setDeleteConfirm(false);
    setBoardConfirm(null);
  };

  const closeMenu = () => {
    setMenu(null);
    setMenuPos(null);
  };

  const overlayOpen = !!menu || deleteConfirm || permanentDeleteConfirm || !!boardConfirm;

  useEffect(() => {
    if (!menu && !deleteConfirm && !permanentDeleteConfirm && !boardConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
        setDeleteConfirm(false);
        setPermanentDeleteConfirm(false);
        setBoardConfirm(null);
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (confirmRef.current?.contains(target)) return;
      const portal = document.getElementById(`column-bulk-menu-${columnId}`);
      if (portal?.contains(target)) return;
      setMenu(null);
      setDeleteConfirm(false);
      setPermanentDeleteConfirm(false);
      setBoardConfirm(null);
    };
    document.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [menu, deleteConfirm, permanentDeleteConfirm, boardConfirm, columnId]);

  const otherBoards = boards.filter((b) => b.id !== currentBoardId && !(b as any).deletedAt);

  const renderMemberChips = (
    chips: UnionMemberChip[],
    variant: 'watchers' | 'collaborators',
    onRemove?: (memberId: string) => void
  ) => {
    const chipClass =
      variant === 'watchers'
        ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800'
        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800';
    const removeBtnClass =
      variant === 'watchers'
        ? 'bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200'
        : 'bg-emerald-100 dark:bg-emerald-900 hover:bg-emerald-200 dark:hover:bg-emerald-800';

    if (chips.length === 0) {
      return (
        <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
          {variant === 'watchers'
            ? t('kanbanSelect.noWatchersOnSelection')
            : t('kanbanSelect.noCollaboratorsOnSelection')}
        </p>
      );
    }

    return (
      <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        {chips.map(({ member, count }) => (
          <span
            key={member.id}
            className={`inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full text-xs border ${chipClass}`}
          >
            <MemberAvatar member={member} members={members} size="xs" />
            <span className="max-w-[6.5rem] truncate">{truncateMemberName(member.name)}</span>
            {count < selectedCount && (
              <span className="text-[10px] opacity-70 tabular-nums">
                {count}/{selectedCount}
              </span>
            )}
            {onRemove && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(member.id)}
                className={`ml-0.5 h-4 w-4 rounded-full flex items-center justify-center ${removeBtnClass}`}
                aria-label={
                  variant === 'watchers'
                    ? t('taskPage.removeWatcher', { defaultValue: 'Remove watcher' })
                    : t('taskPage.removeCollaborator', {
                        defaultValue: 'Remove collaborator',
                      })
                }
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    );
  };

  const menuPortal =
    menu && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={`column-bulk-menu-${columnId}`}
            className={`fixed z-[9990] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800 ${
              menu === 'tag'
                ? 'max-h-[400px] w-[200px] overflow-y-auto'
                : menu === 'assignee' || menu === 'requester'
                  ? 'flex flex-col'
                  : isMemberMenu(menu)
                    ? ''
                    : 'max-h-64 w-48 overflow-y-auto py-1'
            }`}
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: isMemberMenu(menu)
                ? menuPos.width || MEMBER_MENU_WIDTH
                : undefined,
              height:
                menu === 'assignee' || menu === 'requester'
                  ? menuPos.height
                  : undefined,
              maxHeight:
                menu === 'assignee' || menu === 'requester'
                  ? menuPos.height
                  : undefined,
            }}
            role="menu"
          >
            {menu === 'tag' && (
              <>
                <button
                  type="button"
                  className="sticky top-0 flex w-full items-center gap-2 border-b border-gray-200 bg-white p-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-blue-900/20"
                  onClick={() => {
                    setMenu(null);
                    setShowAddTagModal(true);
                  }}
                >
                  <Plus size={14} />
                  {t('toolbar.addTag')}
                </button>
                {availableTags.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
                    {t('toolbar.noMoreTagsAvailable')}
                  </div>
                ) : (
                  availableTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className="flex w-full items-center gap-2 border-b border-gray-100 p-2 text-left text-sm text-gray-700 hover:bg-gray-50 last:border-b-0 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                      onClick={() => {
                        onAddTag(String(tag.id));
                        setMenu(null);
                      }}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: getTagDisplayStyle(tag).backgroundColor }}
                      />
                      <span className="min-w-0 truncate">{tag.tag}</span>
                    </button>
                  ))
                )}
              </>
            )}
            {menu === 'sprint' && (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => {
                    onSprint(null);
                    setMenu(null);
                  }}
                >
                  {t('kanbanSelect.noSprint')}
                </button>
                {availableSprints.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={() => {
                      onSprint(s.id);
                      setMenu(null);
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </>
            )}
            {menu === 'priority' &&
              availablePriorities.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => {
                    onPriority(p.id);
                    setMenu(null);
                  }}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.priority}
                </button>
              ))}
            {menu === 'board' &&
              otherBoards.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => {
                    setMenu(null);
                    setBoardConfirm({ id: b.id, name: b.title || b.id });
                  }}
                >
                  {b.title || b.id}
                </button>
              ))}
            {menu === 'board' && otherBoards.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">—</div>
            )}
            {menu === 'assignee' && onAssignee && (
              <MemberSearchList
                members={members}
                showAgentSection
                excludeViewers
                columns={menuPos.columns || 1}
                maxHeightClassName="max-h-none"
                className="min-h-0 flex-1"
                onSelect={(memberId) => {
                  onAssignee(memberId);
                  closeMenu();
                }}
                onEscape={closeMenu}
              />
            )}
            {menu === 'requester' && onRequester && (
              <MemberSearchList
                members={members}
                showAgentSection={false}
                columns={menuPos.columns || 1}
                maxHeightClassName="max-h-none"
                className="min-h-0 flex-1"
                onSelect={(memberId) => {
                  onRequester(memberId);
                  closeMenu();
                }}
                onEscape={closeMenu}
              />
            )}
            {menu === 'watchers' && (
              <div className="flex flex-col max-h-[360px]">
                <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                  {t('kanbanSelect.watchers')}
                </div>
                {renderMemberChips(watcherChips, 'watchers', onRemoveWatcher)}
                <div className="border-t border-gray-200 dark:border-gray-700">
                  <MemberSearchList
                    members={members}
                    excludeIds={watcherChips
                      .filter((c) => c.count >= selectedCount)
                      .map((c) => c.member.id)}
                    showAgentSection={false}
                    onSelect={(memberId) => onAddWatcher?.(memberId)}
                    onEscape={closeMenu}
                    maxHeightClassName="max-h-48"
                  />
                </div>
              </div>
            )}
            {menu === 'collaborators' && (
              <div className="flex flex-col max-h-[360px]">
                <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                  {t('kanbanSelect.collaborators')}
                </div>
                {renderMemberChips(collaboratorChips, 'collaborators', onRemoveCollaborator)}
                <div className="border-t border-gray-200 dark:border-gray-700">
                  <MemberSearchList
                    members={members}
                    excludeIds={collaboratorChips
                      .filter((c) => c.count >= selectedCount)
                      .map((c) => c.member.id)}
                    showAgentSection={false}
                    onSelect={(memberId) => onAddCollaborator?.(memberId)}
                    onEscape={closeMenu}
                    maxHeightClassName="max-h-48"
                  />
                </div>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  const addTagModalPortal =
    showAddTagModal && typeof document !== 'undefined'
      ? createPortal(
          <AddTagModal
            onClose={() => setShowAddTagModal(false)}
            onTagCreated={(newTag) => onAddTag(String(newTag.id))}
          />,
          document.body
        )
      : null;

  const dismissConfirms = () => {
    setDeleteConfirm(false);
    setPermanentDeleteConfirm(false);
    setBoardConfirm(null);
  };

  const boardConfirmPortal =
    boardConfirm && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            className="fixed z-[9991] w-72 rounded-lg border border-red-200 bg-white p-3 shadow-lg dark:border-red-800 dark:bg-gray-900"
            style={{
              top: menuPos?.top ?? 120,
              left: menuPos?.left ?? 80,
            }}
          >
            <p className="mb-2 text-xs text-gray-700 dark:text-gray-200">
              {t('kanbanSelect.moveToBoardConfirm', {
                count: selectedCount,
                board: boardConfirm?.name,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                onClick={dismissConfirms}
              >
                {t('buttons.cancel', { ns: 'common' })}
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                onClick={() => {
                  onMoveToBoard(boardConfirm.id);
                  dismissConfirms();
                }}
              >
                {t('kanbanSelect.moveToBoard')}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  const deleteConfirmPortal =
    (deleteConfirm || permanentDeleteConfirm) && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[9991] flex items-center justify-center bg-black/45 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) dismissConfirms();
            }}
          >
            <div
              ref={confirmRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`column-bulk-delete-title-${columnId}`}
              className="w-full max-w-sm rounded-xl border-2 border-red-300 bg-white p-5 shadow-2xl dark:border-red-700 dark:bg-gray-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                  <Trash2 size={18} aria-hidden="true" />
                </span>
                <div>
                  <h2
                    id={`column-bulk-delete-title-${columnId}`}
                    className="text-base font-semibold text-gray-900 dark:text-gray-100"
                  >
                    {permanentDeleteConfirm
                      ? t('kanbanSelect.deleteConfirmPermanentTitle')
                      : t('kanbanSelect.deleteConfirmTitle')}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {permanentDeleteConfirm
                      ? t('kanbanSelect.deleteConfirmPermanent', { count: selectedCount })
                      : t('kanbanSelect.deleteConfirm', { count: selectedCount })}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                  onClick={dismissConfirms}
                >
                  {t('buttons.cancel', { ns: 'common' })}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  onClick={() => {
                    if (permanentDeleteConfirm) onPermanentDelete?.();
                    else onDelete();
                    dismissConfirms();
                  }}
                >
                  {permanentDeleteConfirm
                    ? t('kanbanSelect.deleteForever')
                    : t('kanbanSelect.delete')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const actionBar = (
          <div
            ref={rootRef}
            className="pointer-events-auto absolute top-full z-20 mt-1 flex -translate-x-1/2 flex-col gap-1"
            style={{ left: 'calc(-1rem)' }}
            data-testid={`column-bulk-fab-${columnId}`}
          >
            <div className="flex flex-col gap-1 items-center">
              <KanbanChromeTooltip
                label={overlayOpen ? '' : t('kanbanSelect.selectedCount', { count: selectedCount })}
                delayMs={0}
                placement="top"
              >
                <div
                  className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-1.5 text-[11px] font-semibold tabular-nums text-blue-700 shadow-sm dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200"
                  aria-label={t('kanbanSelect.selectedCount', { count: selectedCount })}
                >
                  {selectedCount}
                </div>
              </KanbanChromeTooltip>
              {showUnselectAll && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.unselectAll')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={onUnselectAll}
                    aria-label={t('kanbanSelect.unselectAll')}
                  >
                    <Square size={14} />
                  </button>
                </KanbanChromeTooltip>
              )}
              <KanbanChromeTooltip
                label={overlayOpen ? '' : t('kanbanSelect.addTag')}
                delayMs={0}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy}
                  className={btnClass}
                  onClick={(e) => openMenu('tag', e.currentTarget)}
                  aria-label={t('kanbanSelect.addTag')}
                >
                  <TagIcon size={14} />
                </button>
              </KanbanChromeTooltip>
              <KanbanChromeTooltip
                label={overlayOpen ? '' : t('kanbanSelect.copy')}
                delayMs={0}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy}
                  className={btnClass}
                  onClick={onCopy}
                  aria-label={t('kanbanSelect.copy')}
                >
                  <Copy size={14} />
                </button>
              </KanbanChromeTooltip>
              <KanbanChromeTooltip
                label={overlayOpen ? '' : t('kanbanSelect.sprint')}
                delayMs={0}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy}
                  className={btnClass}
                  onClick={(e) => openMenu('sprint', e.currentTarget)}
                  aria-label={t('kanbanSelect.sprint')}
                >
                  <Calendar size={14} />
                </button>
              </KanbanChromeTooltip>
              <KanbanChromeTooltip
                label={overlayOpen ? '' : t('kanbanSelect.priority')}
                delayMs={0}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy}
                  className={btnClass}
                  onClick={(e) => openMenu('priority', e.currentTarget)}
                  aria-label={t('kanbanSelect.priority')}
                >
                  <Flag size={14} />
                </button>
              </KanbanChromeTooltip>
              {onAssignee && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.assignee')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={(e) => openMenu('assignee', e.currentTarget)}
                    aria-label={t('kanbanSelect.assignee')}
                  >
                    <User size={14} />
                  </button>
                </KanbanChromeTooltip>
              )}
              {onRequester && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.requester')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={(e) => openMenu('requester', e.currentTarget)}
                    aria-label={t('kanbanSelect.requester')}
                  >
                    <UserCircle size={14} />
                  </button>
                </KanbanChromeTooltip>
              )}
              {onAddWatcher && onRemoveWatcher && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.watchers')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={(e) => openMenu('watchers', e.currentTarget)}
                    aria-label={t('kanbanSelect.watchers')}
                  >
                    <Eye size={14} />
                  </button>
                </KanbanChromeTooltip>
              )}
              {onAddCollaborator && onRemoveCollaborator && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.collaborators')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={(e) => openMenu('collaborators', e.currentTarget)}
                    aria-label={t('kanbanSelect.collaborators')}
                  >
                    <UserPlus size={14} />
                  </button>
                </KanbanChromeTooltip>
              )}
              {isAdmin && otherBoards.length > 0 && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.moveToBoard')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={(e) => openMenu('board', e.currentTarget)}
                    aria-label={t('kanbanSelect.moveToBoard')}
                  >
                    <Layers size={14} />
                  </button>
                </KanbanChromeTooltip>
              )}
              {hasArchiveColumn && (
                <KanbanChromeTooltip
                  label={overlayOpen ? '' : t('kanbanSelect.archive')}
                  delayMs={0}
                  placement="top"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={btnClass}
                    onClick={onArchive}
                    aria-label={t('kanbanSelect.archive')}
                  >
                    <Archive size={14} className="text-yellow-600" />
                  </button>
                </KanbanChromeTooltip>
              )}
              <KanbanChromeTooltip
                label={
                  overlayOpen
                    ? ''
                    : isAdmin && onPermanentDelete
                      ? t('kanbanSelect.deleteAdminHint')
                      : t('kanbanSelect.delete')
                }
                delayMs={0}
                placement="top"
              >
                <button
                  type="button"
                  disabled={busy}
                  className={`${btnClass} text-red-600 hover:text-red-700 ${
                    deleteConfirm || permanentDeleteConfirm
                      ? 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-gray-900'
                      : ''
                  }`}
                  onClick={(e) => {
                    if (deleteConfirm || permanentDeleteConfirm) {
                      setDeleteConfirm(false);
                      setPermanentDeleteConfirm(false);
                      setMenuPos(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const popupWidth = 288;
                    setMenuPos({
                      top: Math.max(8, Math.min(rect.top, window.innerHeight - 160)),
                      left:
                        rect.right + 6 + popupWidth <= window.innerWidth - 8
                          ? rect.right + 6
                          : Math.max(8, rect.left - popupWidth - 6),
                    });
                    const wantPermanent = !!(e.shiftKey && isAdmin && onPermanentDelete);
                    setPermanentDeleteConfirm(wantPermanent);
                    setDeleteConfirm(!wantPermanent);
                    setMenu(null);
                    setBoardConfirm(null);
                  }}
                  aria-label={
                    isAdmin && onPermanentDelete
                      ? t('kanbanSelect.deleteAdminHint')
                      : t('kanbanSelect.delete')
                  }
                >
                  <Trash2 size={14} />
                </button>
              </KanbanChromeTooltip>
            </div>
          </div>
  );

  return (
    <>
      {actionBar}
      {menuPortal}
      {addTagModalPortal}
      {boardConfirmPortal}
      {deleteConfirmPortal}
    </>
  );
}
