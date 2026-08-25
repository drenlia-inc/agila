import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBoardColumns } from '../../api';
import { useColumnDisplayTitle } from '../../utils/columnDisplayTitle';

type BoardColumnOption = {
  id: string;
  title: string;
  boardId: string;
  position?: number;
};

export default function TaskStatusSelect({
  boardId,
  columnId,
  statusTitle,
  disabled = false,
  onChange,
  labelClassName,
  selectClassName,
}: {
  boardId?: string | null;
  columnId?: string | null;
  statusTitle?: string | null;
  disabled?: boolean;
  onChange: (column: { id: string; title: string }) => void;
  labelClassName?: string;
  selectClassName?: string;
}) {
  const { t } = useTranslation('tasks');
  const columnDisplayTitle = useColumnDisplayTitle();
  const [columns, setColumns] = useState<BoardColumnOption[]>([]);

  useEffect(() => {
    if (!boardId) {
      setColumns([]);
      return;
    }
    let cancelled = false;
    void getBoardColumns(boardId)
      .then((rows) => {
        if (cancelled) return;
        const next = (rows || [])
          .map((row) => ({
            id: row.id,
            title: row.title,
            boardId: row.boardId || boardId,
            position: row.position,
          }))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        setColumns(next);
      })
      .catch(() => {
        if (!cancelled) setColumns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const options = useMemo(() => {
    if (!columnId || columns.some((column) => column.id === columnId)) {
      return columns;
    }
    return [
      {
        id: columnId,
        title: statusTitle || '',
        boardId: boardId || '',
      },
      ...columns,
    ];
  }, [boardId, columnId, columns, statusTitle]);

  return (
    <div>
      <label className={labelClassName}>{t('labels.status')}</label>
      <select
        value={columnId || ''}
        disabled={disabled || options.length === 0}
        onChange={(event) => {
          const next = options.find((column) => column.id === event.target.value);
          if (!next || next.id === columnId) return;
          onChange({ id: next.id, title: next.title });
        }}
        className={selectClassName}
        aria-label={t('labels.status')}
      >
        {options.length === 0 ? (
          <option value="">{t('gantt.noColumnsAvailable', { ns: 'common' })}</option>
        ) : (
          options.map((column) => (
            <option key={column.id} value={column.id}>
              {columnDisplayTitle(column)}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
