import { useCallback, RefObject } from 'react';
import { Columns, Board, Task } from '../types';
import { toast } from '../utils/toast';
import i18n from '../i18n/config';
import { loadUserPreferences } from '../utils/userPreferences';
import { scheduleSettledBoardRefresh } from '../utils/boardRestoredRefresh';

interface UseBoardWebSocketProps {
  // State setters
  setSelectedBoard: React.Dispatch<React.SetStateAction<string | null>>;
  setColumns: React.Dispatch<React.SetStateAction<Columns>>;
  setBoards: React.Dispatch<React.SetStateAction<Board[]>>;
  setSelectedTask: React.Dispatch<React.SetStateAction<Task | null>>;

  // Prefer App's selection helper (hash + lastSelectedBoard preference)
  onSelectBoard: (boardId: string) => void;
  /** Clears open task details and selectedTaskId preference */
  onClearSelectedTask: () => void;

  // Refs
  selectedBoardRef: RefObject<string | null>;
  refreshBoardDataRef: RefObject<
    ((options?: { force?: boolean; forBoardId?: string }) => Promise<void>) | null
  >;
  /** Boards created by this client via HTTP — skip delayed force refresh on WS echo. */
  pendingSelfBoardCreatesRef?: RefObject<Set<string>>;
}

export const useBoardWebSocket = ({
  setSelectedBoard,
  setColumns,
  setBoards,
  setSelectedTask,
  onSelectBoard,
  onClearSelectedTask,
  selectedBoardRef,
  refreshBoardDataRef,
  pendingSelfBoardCreatesRef,
}: UseBoardWebSocketProps) => {
  const handleBoardCreated = useCallback((data: any) => {
    if (!data.board || !data.boardId) return;

    const selfCreated = Boolean(pendingSelfBoardCreatesRef?.current?.has(data.boardId));
    if (selfCreated) {
      pendingSelfBoardCreatesRef?.current?.delete(data.boardId);
    }

    // Add the new board to the boards state immediately
    // This ensures the board appears in real-time, even before columns are created
    setBoards(prevBoards => {
      // Check if board already exists (avoid duplicates)
      const boardExists = prevBoards.some(b => b.id === data.boardId);
      if (boardExists) {
        return prevBoards;
      }

      // Insert the new board at the correct position based on its position value
      // This ensures it appears in the right place in the tabs, not just at the end
      const newBoard = {
        ...data.board,
        columns: {}
      };

      // Positions are NUMERIC server-side and may arrive as fractional strings
      const toPosition = (value: unknown): number | null => {
        if (value == null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const newBoardPosition = toPosition(newBoard.position);
      if (newBoardPosition == null) {
        return [...prevBoards, newBoard];
      }

      // Find the correct insertion index based on position
      let insertIndex = prevBoards.length;
      for (let i = 0; i < prevBoards.length; i++) {
        const boardPosition = toPosition(prevBoards[i].position);

        if (boardPosition != null && newBoardPosition < boardPosition) {
          insertIndex = i;
          break;
        }
      }

      // Insert at the correct position
      const newBoards = [...prevBoards];
      newBoards.splice(insertIndex, 0, newBoard);
      return newBoards;
    });

    // Initiator already hydrated via handleAddBoard — avoid a second force refresh flash.
    if (selfCreated) return;
    
    // Peers: refresh after a short delay so default columns exist
    if (refreshBoardDataRef.current) {
      setTimeout(() => {
        if (refreshBoardDataRef.current) {
          refreshBoardDataRef.current({ force: true });
        }
      }, 500);
    }
  }, [setBoards, refreshBoardDataRef, pendingSelfBoardCreatesRef]);

  const handleBoardUpdated = useCallback((data: any) => {
    const board = data?.board;
    if (board?.id) {
      setBoards((prev) =>
        prev.map((b) =>
          b.id === board.id
            ? {
                ...b,
                title: board.title ?? b.title,
                wip_limit:
                  board.wip_limit !== undefined ? board.wip_limit : b.wip_limit,
              }
            : b
        )
      );
    }
    // Refresh boards list (columns/tasks remain authoritative via full refresh)
    if (refreshBoardDataRef.current) {
      refreshBoardDataRef.current();
    }
  }, [refreshBoardDataRef, setBoards]);

  const handleBoardDeleted = useCallback((data: any) => {
    const boardId = data?.boardId;
    if (!boardId) return;

    const wasViewing = selectedBoardRef.current === boardId;
    const permanent = Boolean(data.permanent) || data.softDeleted === false;
    let boardTitle =
      (typeof data.boardTitle === 'string' && data.boardTitle.trim()) ||
      (typeof data.title === 'string' && data.title.trim()) ||
      '';

    let remainingBoards: Board[] = [];

    setBoards((prevBoards) => {
      if (!boardTitle) {
        boardTitle = prevBoards.find((b) => b.id === boardId)?.title || '';
      }
      remainingBoards = prevBoards.filter((b) => b.id !== boardId);
      return remainingBoards;
    });

    if (wasViewing) {
      onClearSelectedTask();
    } else {
      // Rare: details open for a task on a board the user isn't viewing
      setSelectedTask((prev) => {
        if (!prev) return prev;
        const taskBoardId = prev.boardId || (prev as any).boardid;
        return taskBoardId === boardId ? null : prev;
      });
    }

    const displayTitle = boardTitle || i18n.t('boardTabs.newBoard', { ns: 'common' });

    if (!wasViewing) {
      // Quiet tab-list update; optional refresh keeps counts/snapshots in sync
      if (refreshBoardDataRef.current) {
        refreshBoardDataRef.current({ force: true });
      }
      return;
    }

    // Defer navigation until after React applies the boards filter
    queueMicrotask(() => {
      if (remainingBoards.length === 0) {
        setSelectedBoard(null);
        setColumns({});
        toast.warning(
          permanent
            ? i18n.t('boardTabs.boardPermanentlyDeletedTitle', { ns: 'common' })
            : i18n.t('boardTabs.boardMovedToTrashTitle', { ns: 'common' }),
          i18n.t('boardTabs.boardRemovedNoReplacement', {
            ns: 'common',
            title: displayTitle,
          }),
          6000
        );
        return;
      }

      const preferredId = loadUserPreferences().lastSelectedBoard;
      const nextBoard =
        (preferredId && remainingBoards.find((b) => b.id === preferredId)) ||
        remainingBoards[0];

      onSelectBoard(nextBoard.id);
      // Optimistic columns from board snapshot; force refresh fills any gaps
      setColumns(
        nextBoard.columns
          ? Object.fromEntries(
              Object.entries(nextBoard.columns).map(([columnId, column]) => [
                columnId,
                { ...column, tasks: [...(column.tasks || [])] },
              ])
            )
          : {}
      );

      toast.warning(
        permanent
          ? i18n.t('boardTabs.boardPermanentlyDeletedTitle', { ns: 'common' })
          : i18n.t('boardTabs.boardMovedToTrashTitle', { ns: 'common' }),
        permanent
          ? i18n.t('boardTabs.boardPermanentlyDeletedMessage', {
              ns: 'common',
              title: displayTitle,
            })
          : i18n.t('boardTabs.boardMovedToTrashMessage', {
              ns: 'common',
              title: displayTitle,
            }),
        6000
      );

      if (refreshBoardDataRef.current) {
        refreshBoardDataRef.current({ force: true, forBoardId: nextBoard.id });
      }
    });
  }, [
    setBoards,
    setSelectedBoard,
    setColumns,
    setSelectedTask,
    onSelectBoard,
    onClearSelectedTask,
    selectedBoardRef,
    refreshBoardDataRef,
  ]);

  const handleBoardRestored = useCallback((data: any) => {
    const boardId = data?.boardId || data?.board?.id;
    if (!boardId) return;

    // Upsert board immediately so task-restored events that follow (lifecycle
    // "restore board then tasks") have a board to land in — otherwise handleTaskCreated
    // drops them when the board is still missing from local state.
    if (data.board) {
      const incomingColumns: Columns = data.board.columns || {};
      setBoards((prevBoards) => {
        const existing = prevBoards.find((b) => b.id === boardId);
        if (existing) {
          return prevBoards.map((b) => {
            if (b.id !== boardId) return b;
            const mergedColumns: Columns = { ...(incomingColumns || {}) };
            // Keep any tasks already applied by earlier task-restored events
            Object.keys(b.columns || {}).forEach((columnId) => {
              const prevCol = b.columns[columnId];
              const nextCol = mergedColumns[columnId];
              if (!prevCol) return;
              if (!nextCol) {
                mergedColumns[columnId] = prevCol;
                return;
              }
              const byId = new Map<string, Task>();
              (nextCol.tasks || []).forEach((t) => byId.set(t.id, t));
              (prevCol.tasks || []).forEach((t) => {
                if (!byId.has(t.id)) byId.set(t.id, t);
              });
              mergedColumns[columnId] = {
                ...nextCol,
                tasks: Array.from(byId.values()).sort(
                  (a, bTask) => (a.position || 0) - (bTask.position || 0)
                ),
              };
            });
            return {
              ...b,
              ...data.board,
              id: boardId,
              deletedAt: null,
              deletedBy: null,
              columns: mergedColumns,
            };
          });
        }

        const sorted = [...prevBoards, {
          ...data.board,
          id: boardId,
          deletedAt: null,
          deletedBy: null,
          columns: incomingColumns,
        } as Board];
        sorted.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        return sorted;
      });

      // If user is already viewing this board (switched early), hydrate columns without wiping tasks
      if (selectedBoardRef.current === boardId) {
        setColumns((prev) => {
          if (Object.keys(prev).length > 0) {
            // Merge column shells onto existing tasks
            const next: Columns = { ...incomingColumns };
            Object.keys(prev).forEach((columnId) => {
              const prevCol = prev[columnId];
              const shell = next[columnId];
              if (!shell) {
                next[columnId] = prevCol;
                return;
              }
              next[columnId] = {
                ...shell,
                tasks: prevCol.tasks?.length ? prevCol.tasks : (shell.tasks || []),
              };
            });
            return next;
          }
          const seeded: Columns = {};
          Object.keys(incomingColumns).forEach((columnId) => {
            const col = incomingColumns[columnId];
            seeded[columnId] = { ...col, tasks: [...(col.tasks || [])] };
          });
          return seeded;
        });
      }
    }

    // Debounced authoritative refresh; task-restored events bump the same timer
    scheduleSettledBoardRefresh(refreshBoardDataRef.current);
  }, [setBoards, setColumns, selectedBoardRef, refreshBoardDataRef]);

  const handleBoardReordered = useCallback((data: any) => {
    // Refresh boards list to show new order
    if (refreshBoardDataRef.current) {
      refreshBoardDataRef.current();
    }
  }, [refreshBoardDataRef]);

  return {
    handleBoardCreated,
    handleBoardUpdated,
    handleBoardDeleted,
    handleBoardRestored,
    handleBoardReordered,
  };
};
