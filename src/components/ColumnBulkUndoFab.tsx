import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';

export type ColumnBulkUndoFabProps = {
  columnId: string;
  count: number;
  busy?: boolean;
  labelKey?: string;
  onUndo: () => void;
  onDismiss: () => void;
  placement?: 'column' | 'fixed-left';
  /** `fixed-left` only: viewport x offset, so the control can hug the table edge. */
  fixedLeftPx?: number | null;
  /** `fixed-left` only: viewport right offset; anchors the control's right edge exactly. */
  fixedRightPx?: number | null;
};

const btnClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-amber-800 shadow-sm transition-colors hover:bg-amber-100 hover:text-amber-900 disabled:opacity-40 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/60';

/**
 * One-shot undo control in the same slot as the multi-select FAB
 * (in-column, so it pans with the board instead of lagging as position:fixed).
 */
export default function ColumnBulkUndoFab({
  columnId,
  count,
  busy = false,
  labelKey = 'kanbanSelect.undoBulk',
  onUndo,
  onDismiss,
  placement = 'column',
  fixedLeftPx = null,
  fixedRightPx = null,
}: ColumnBulkUndoFabProps) {
  const { t } = useTranslation('tasks');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const tooltip = t(labelKey, { count });

  const undoControl = (
    <div
      ref={rootRef}
      className={
        placement === 'fixed-left'
          ? 'pointer-events-auto fixed top-1/2 z-[70] flex -translate-y-1/2 flex-col items-center gap-1'
          : 'pointer-events-auto absolute top-full z-20 mt-1 flex -translate-x-1/2 flex-col gap-1 items-center'
      }
      style={
        placement === 'column'
          ? { left: 'calc(-1rem)' }
          : fixedRightPx !== null
            ? { right: fixedRightPx }
            : { left: fixedLeftPx ?? 8 }
      }
      data-testid={`column-bulk-undo-${columnId}`}
    >
      <div
        className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold tabular-nums text-amber-800 shadow-sm dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
        aria-hidden
      >
        {count}
      </div>
      <KanbanChromeTooltip label={tooltip} delayMs={0} placement="top">
        <button
          type="button"
          disabled={busy}
          className={btnClass}
          onClick={onUndo}
          aria-label={tooltip}
        >
          <Undo2 size={14} />
        </button>
      </KanbanChromeTooltip>
    </div>
  );

  return placement === 'fixed-left'
    ? createPortal(undoControl, document.body)
    : undoControl;
}
