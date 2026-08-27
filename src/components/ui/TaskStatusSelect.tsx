import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBoardColumns } from '../../api';
import { useColumnDisplayTitle } from '../../utils/columnDisplayTitle';
import EnumPicker, { type EnumOption } from './EnumPicker';

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
  className,
}: {
  boardId?: string | null;
  columnId?: string | null;
  statusTitle?: string | null;
  disabled?: boolean;
  onChange: (column: { id: string; title: string }) => void;
  labelClassName?: string;
  /** @deprecated Native select class — ignored; custom picker uses form chrome. */
  selectClassName?: string;
  className?: string;
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

  const optionsList = useMemo(() => {
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

  const options: EnumOption[] = useMemo(
    () =>
      optionsList.length === 0
        ? [{ value: '', label: t('gantt.noColumnsAvailable', { ns: 'common' }) }]
        : optionsList.map((column) => ({
            value: column.id,
            label: columnDisplayTitle(column),
          })),
    [optionsList, columnDisplayTitle, t]
  );

  const pickerDisabled = disabled || optionsList.length === 0;

  return (
    <EnumPicker
      className={className}
      label={t('labels.status')}
      labelClassName={labelClassName}
      options={options}
      value={columnId || ''}
      disabled={pickerDisabled}
      surface="panel"
      aria-label={t('labels.status')}
      onChange={(nextId) => {
        const next = optionsList.find((column) => column.id === nextId);
        if (!next || next.id === columnId) return;
        onChange({ id: next.id, title: next.title });
      }}
    />
  );
}
