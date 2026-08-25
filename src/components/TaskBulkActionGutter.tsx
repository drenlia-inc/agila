import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Board, CurrentUser, PriorityOption, Tag, Task, TeamMember } from '../types';
import ColumnBulkActionBar from './ColumnBulkActionBar';
import ColumnBulkUndoFab from './ColumnBulkUndoFab';

const GUTTER_GAP_PX = 3;
const MIN_CONTROL_WIDTH_PX = 28;

export type TaskBulkActionGutterProps = {
  anchorRef: RefObject<HTMLElement>;
  controlId: string;
  selectedTaskIds: string[];
  tasks: Task[];
  onClearSelection: () => void;
  canMutate?: boolean;
  busy?: boolean;
  currentUser?: CurrentUser | null;
  members?: TeamMember[];
  availableTags?: Tag[];
  availablePriorities?: PriorityOption[];
  availableSprints?: Array<{ id: string; name: string }>;
  boards?: Board[];
  currentBoardId?: string | null;
  hasArchiveColumn?: boolean;
  onBulkAddTag?: (taskIds: string[], tagId: string) => void | Promise<void>;
  onBulkCopy?: (taskIds: string[]) => void | Promise<void>;
  onBulkArchive?: (taskIds: string[]) => void | Promise<void>;
  onBulkDelete?: (taskIds: string[]) => void | Promise<void>;
  onBulkPermanentDelete?: (taskIds: string[]) => void | Promise<void>;
  onBulkSprint?: (taskIds: string[], sprintId: string | null) => void | Promise<void>;
  onBulkPriority?: (taskIds: string[], priorityId: string) => void | Promise<void>;
  onBulkMoveToBoard?: (taskIds: string[], boardId: string) => void | Promise<void>;
  onBulkAssignee?: (taskIds: string[], memberId: string | null) => void | Promise<void>;
  onBulkRequester?: (taskIds: string[], memberId: string | null) => void | Promise<void>;
  onBulkAddWatcher?: (taskIds: string[], memberId: string) => void | Promise<void>;
  onBulkRemoveWatcher?: (taskIds: string[], memberId: string) => void | Promise<void>;
  onBulkAddCollaborator?: (taskIds: string[], memberId: string) => void | Promise<void>;
  onBulkRemoveCollaborator?: (taskIds: string[], memberId: string) => void | Promise<void>;
  bulkUndoTaskIds?: string[] | null;
  bulkUndoLabelKey?: string;
  onBulkUndo?: () => void;
  onClearBulkUndo?: () => void;
  /**
   * Views with a persistent selection mode (Gantt, Calendar) keep their picks
   * after an action so keyboard nudges and follow-up actions still apply; undo
   * then rides inside the action bar instead of replacing it.
   */
  retainSelectionAfterAction?: boolean;
  /** Re-publishes retained ids to the board-level selection after an action. */
  onRetainSelection?: (taskIds: string[]) => void;
};

export default function TaskBulkActionGutter({
  anchorRef,
  controlId,
  selectedTaskIds,
  tasks,
  onClearSelection,
  canMutate = true,
  busy = false,
  currentUser,
  members = [],
  availableTags = [],
  availablePriorities = [],
  availableSprints = [],
  boards = [],
  currentBoardId = null,
  hasArchiveColumn = false,
  onBulkAddTag,
  onBulkCopy,
  onBulkArchive,
  onBulkDelete,
  onBulkPermanentDelete,
  onBulkSprint,
  onBulkPriority,
  onBulkMoveToBoard,
  onBulkAssignee,
  onBulkRequester,
  onBulkAddWatcher,
  onBulkRemoveWatcher,
  onBulkAddCollaborator,
  onBulkRemoveCollaborator,
  bulkUndoTaskIds = null,
  bulkUndoLabelKey,
  onBulkUndo,
  onClearBulkUndo,
  retainSelectionAfterAction = false,
  onRetainSelection,
}: TaskBulkActionGutterProps) {
  const active =
    canMutate && (selectedTaskIds.length > 0 || Boolean(bulkUndoTaskIds?.length));
  const [fixedRightPx, setFixedRightPx] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setFixedRightPx(null);
      return;
    }
    const node = anchorRef.current;
    if (!node) return;
    const update = () => {
      const tableLeft = node.getBoundingClientRect().left;
      const desiredRight = window.innerWidth - tableLeft + GUTTER_GAP_PX;
      const maxRight = window.innerWidth - MIN_CONTROL_WIDTH_PX - GUTTER_GAP_PX;
      setFixedRightPx(
        Math.max(GUTTER_GAP_PX, Math.min(desiredRight, maxRight))
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, anchorRef]);

  const selectedTasks = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return selectedTaskIds
      .map((id) => byId.get(id))
      .filter((task): task is Task => Boolean(task));
  }, [selectedTaskIds, tasks]);

  if (!active || fixedRightPx === null) return null;

  const run = async (action: (() => void | Promise<void>) | undefined) => {
    await action?.();
    if (retainSelectionAfterAction) {
      onRetainSelection?.(selectedTaskIds);
    } else {
      onClearSelection();
    }
  };
  const showActions =
    selectedTaskIds.length > 0 &&
    Boolean(onBulkAddTag && onBulkCopy && onBulkDelete);
  const showUndo =
    selectedTaskIds.length === 0 &&
    Boolean(bulkUndoTaskIds?.length && onBulkUndo && onClearBulkUndo);

  return (
    <>
      {showActions && (
        <ColumnBulkActionBar
          columnId={controlId}
          placement="fixed-left"
          fixedRightPx={fixedRightPx}
          selectedCount={selectedTaskIds.length}
          selectedTasks={selectedTasks}
          members={members}
          showUnselectAll
          isAdmin={Boolean(currentUser?.roles?.includes('admin'))}
          hasArchiveColumn={hasArchiveColumn}
          availableTags={availableTags}
          availablePriorities={availablePriorities}
          availableSprints={availableSprints}
          boards={boards}
          currentBoardId={currentBoardId}
          busy={busy}
          onUnselectAll={onClearSelection}
          onAddTag={(tagId) =>
            run(() => onBulkAddTag?.(selectedTaskIds, tagId))
          }
          onCopy={() => run(() => onBulkCopy?.(selectedTaskIds))}
          onArchive={() => run(() => onBulkArchive?.(selectedTaskIds))}
          onDelete={() => run(() => onBulkDelete?.(selectedTaskIds))}
          onPermanentDelete={
            onBulkPermanentDelete
              ? () => run(() => onBulkPermanentDelete(selectedTaskIds))
              : undefined
          }
          onSprint={(sprintId) =>
            run(() => onBulkSprint?.(selectedTaskIds, sprintId))
          }
          onPriority={(priorityId) =>
            run(() => onBulkPriority?.(selectedTaskIds, priorityId))
          }
          onMoveToBoard={(boardId) =>
            run(() => onBulkMoveToBoard?.(selectedTaskIds, boardId))
          }
          onAssignee={(memberId) =>
            run(() => onBulkAssignee?.(selectedTaskIds, memberId))
          }
          onRequester={(memberId) =>
            run(() => onBulkRequester?.(selectedTaskIds, memberId))
          }
          onAddWatcher={(memberId) =>
            run(() => onBulkAddWatcher?.(selectedTaskIds, memberId))
          }
          onRemoveWatcher={(memberId) =>
            run(() => onBulkRemoveWatcher?.(selectedTaskIds, memberId))
          }
          onAddCollaborator={(memberId) =>
            run(() => onBulkAddCollaborator?.(selectedTaskIds, memberId))
          }
          onRemoveCollaborator={(memberId) =>
            run(() => onBulkRemoveCollaborator?.(selectedTaskIds, memberId))
          }
          undoCount={
            retainSelectionAfterAction ? bulkUndoTaskIds?.length || 0 : 0
          }
          onUndo={retainSelectionAfterAction ? onBulkUndo : undefined}
        />
      )}
      {showUndo && (
        <ColumnBulkUndoFab
          columnId={controlId}
          placement="fixed-left"
          fixedRightPx={fixedRightPx}
          count={bulkUndoTaskIds?.length || 0}
          busy={busy}
          labelKey={bulkUndoLabelKey}
          onUndo={() => onBulkUndo?.()}
          onDismiss={() => onClearBulkUndo?.()}
        />
      )}
    </>
  );
}
