import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Edit, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from '../../utils/toast';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';
import { ADMIN_TABLE_ROW_CLASS } from '../../utils/adminFieldLimits';
import { adminInputClass } from './AdminSection';
import {
  type DefaultBoardColumnRow,
  duplicateTitleInLanguage,
  isArchiveColumnTitle,
  rowMatchesFinishedKeywords,
} from '../../utils/defaultBoardColumns';

interface AdminDefaultBoardColumnsTableProps {
  rows: DefaultBoardColumnRow[];
  finishedKeywords: string[];
  onRowsChange: (
    rows: DefaultBoardColumnRow[],
    extraFinishedKeywords?: string[],
    options?: { autoSave?: boolean }
  ) => void;
}

const actionBtnClass =
  'p-1.5 rounded-lg transition-colors text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800';

function newRowId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `col-${Date.now()}`;
}

const SortableDefaultColumnRow: React.FC<{
  row: DefaultBoardColumnRow;
  isEditing: boolean;
  draftEn: string;
  draftFr: string;
  onDraftEn: (value: string) => void;
  onDraftFr: (value: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onDelete: () => void;
  onSetFinished: () => void;
  canDelete: boolean;
}> = ({
  row,
  isEditing,
  draftEn,
  draftFr,
  onDraftEn,
  onDraftFr,
  onStartEdit,
  onCommitEdit,
  onDelete,
  onSetFinished,
  canDelete,
}) => {
  const { t } = useTranslation('admin', { keyPrefix: 'projectSettings' });
  const enRef = useRef<HTMLInputElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: isEditing });

  useEffect(() => {
    if (isEditing) enRef.current?.focus();
  }, [isEditing]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${ADMIN_TABLE_ROW_CLASS}${isDragging ? ' z-50' : ''}`}
      data-default-column-editing={isEditing ? row.id : undefined}
    >
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => (isEditing ? onCommitEdit() : onStartEdit())}
            className={actionBtnClass}
            title={isEditing ? t('defaultColumnsDoneEditing') : t('defaultColumnsEdit')}
            aria-label={isEditing ? t('defaultColumnsDoneEditing') : t('defaultColumnsEdit')}
          >
            {isEditing ? <Check size={15} /> : <Edit size={15} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!canDelete}
            className={`p-1.5 rounded-lg transition-colors ${
              canDelete
                ? 'text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
            }`}
            title={
              !canDelete
                ? row.isFinished
                  ? t('defaultColumnsCannotDeleteFinished')
                  : t('defaultColumnsMinTwo')
                : t('defaultColumnsDelete')
            }
            aria-label={t('defaultColumnsDelete')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap min-w-[12rem]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={isEditing}
            className="cursor-grab active:cursor-grabbing p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 touch-none disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('defaultColumnsDragToReorder')}
            aria-label={t('defaultColumnsDragToReorder')}
          >
            <GripVertical size={15} />
          </button>
          {isEditing ? (
            <input
              ref={enRef}
              type="text"
              required
              value={draftEn}
              onChange={(e) => onDraftEn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitEdit();
                }
              }}
              className={`w-full max-w-[12rem] ${adminInputClass}`}
              placeholder="To Do"
            />
          ) : (
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {row.titleEn || '—'}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap min-w-[12rem]">
        {isEditing ? (
          <input
            type="text"
            required
            value={draftFr}
            onChange={(e) => onDraftFr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEdit();
              }
            }}
            className={`w-full max-w-[12rem] ${adminInputClass}`}
            placeholder="À faire"
          />
        ) : (
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {row.titleFr || '—'}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="defaultBoardFinishedColumn"
            checked={row.isFinished}
            onChange={onSetFinished}
            className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 focus:ring-sky-500 focus:ring-2 cursor-pointer"
          />
          {row.isFinished ? (
            <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
              {t('defaultColumnsFinishedBadge')}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {t('defaultColumnsSetFinished')}
            </span>
          )}
        </label>
      </td>
    </tr>
  );
};

const AdminDefaultBoardColumnsTable: React.FC<AdminDefaultBoardColumnsTableProps> = ({
  rows,
  finishedKeywords,
  onRowsChange,
}) => {
  const { t } = useTranslation('admin', { keyPrefix: 'projectSettings' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftEn, setDraftEn] = useState('');
  const [draftFr, setDraftFr] = useState('');
  const [draftRows, setDraftRows] = useState<DefaultBoardColumnRow[] | null>(null);

  const displayRows = draftRows ?? rows;
  const finishedRow = displayRows.find((r) => r.isFinished);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const startEdit = (row: DefaultBoardColumnRow) => {
    setEditingId(row.id);
    setDraftEn(row.titleEn);
    setDraftFr(row.titleFr);
  };

  const validateTitles = (en: string, fr: string, exceptId: string): boolean => {
    const titleEn = en.trim();
    const titleFr = fr.trim();
    if (!titleEn || !titleFr) {
      toast.error(t('defaultColumnsTitlesRequired'), '');
      return false;
    }
    if (isArchiveColumnTitle(titleEn) || isArchiveColumnTitle(titleFr)) {
      toast.error(t('defaultColumnsArchiveReserved'), '');
      return false;
    }
    if (
      duplicateTitleInLanguage(displayRows, 'titleEn', titleEn, exceptId) ||
      duplicateTitleInLanguage(displayRows, 'titleFr', titleFr, exceptId)
    ) {
      toast.error(t('defaultColumnsDuplicateTitle'), '');
      return false;
    }
    const nextRow = { ...displayRows.find((r) => r.id === exceptId)!, titleEn, titleFr };
    const othersMatch = displayRows.some(
      (r) => r.id !== exceptId && rowMatchesFinishedKeywords(r, finishedKeywords)
    );
    if (rowMatchesFinishedKeywords(nextRow, finishedKeywords) && othersMatch && !nextRow.isFinished) {
      toast.error(t('defaultColumnsSecondKeyword'), '');
      return false;
    }
    return true;
  };

  const commitEdit = useCallback((): boolean => {
    if (!editingId) return true;
    if (!validateTitles(draftEn, draftFr, editingId)) return false;
    const titleEn = draftEn.trim();
    const titleFr = draftFr.trim();
    const next = displayRows.map((r) =>
      r.id === editingId ? { ...r, titleEn, titleFr } : r
    );
    setDraftRows(null);
    setEditingId(null);
    onRowsChange(next, undefined, { autoSave: true });
    return true;
  }, [displayRows, draftEn, draftFr, editingId, finishedKeywords, onRowsChange, t]);

  const cancelEdit = useCallback(() => {
    if (!editingId) return;
    const isUnsavedAdd = Boolean(
      draftRows?.some((r) => r.id === editingId) && !rows.some((r) => r.id === editingId)
    );
    if (isUnsavedAdd) {
      const next = displayRows.filter((r) => r.id !== editingId);
      const stillDrafting = next.some((r) => !rows.some((s) => s.id === r.id));
      setDraftRows(stillDrafting ? next : null);
    }
    setEditingId(null);
    setDraftEn('');
    setDraftFr('');
  }, [draftRows, displayRows, editingId, rows]);

  useEscapeDismiss(cancelEdit, { enabled: Boolean(editingId) });

  useEffect(() => {
    if (!editingId) return;
    let handler: ((event: PointerEvent) => void) | null = null;
    const timer = window.setTimeout(() => {
      handler = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const surface = document.querySelector(`[data-default-column-editing="${editingId}"]`);
        if (surface?.contains(target)) return;
        commitEdit();
      };
      document.addEventListener('pointerdown', handler, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (handler) document.removeEventListener('pointerdown', handler, true);
    };
  }, [editingId, commitEdit]);

  const handleSetFinished = (id: string) => {
    if (finishedRow?.id === id) return;
    const target = displayRows.find((r) => r.id === id);
    if (!target) return;
    if (!target.titleEn.trim() || !target.titleFr.trim()) {
      toast.error(t('defaultColumnsTitlesRequired'), '');
      return;
    }
    const next = displayRows.map((r) => ({ ...r, isFinished: r.id === id }));
    let extras: string[] | undefined;
    if (!rowMatchesFinishedKeywords(target, finishedKeywords)) {
      extras = [target.titleEn, target.titleFr]
        .map((n) => n.trim())
        .filter((n) => n && !isArchiveColumnTitle(n));
      if (extras.length === 0) extras = undefined;
    }
    onRowsChange(next, extras, { autoSave: true });
  };

  const handleDelete = (id: string) => {
    const row = displayRows.find((r) => r.id === id);
    if (!row) return;
    if (row.isFinished) {
      toast.error(t('defaultColumnsCannotDeleteFinished'), '');
      return;
    }
    const remainingComplete = displayRows.filter(
      (r) => r.id !== id && r.titleEn.trim() && r.titleFr.trim()
    );
    if (remainingComplete.length < 2) {
      toast.error(t('defaultColumnsMinTwo'), '');
      return;
    }
    if (editingId === id) setEditingId(null);
    const next = displayRows.filter((r) => r.id !== id);
    const isUnsavedAdd = Boolean(draftRows?.some((r) => r.id === id) && !rows.some((r) => r.id === id));
    if (isUnsavedAdd) {
      const stillDrafting = next.some((r) => !rows.some((s) => s.id === r.id));
      setDraftRows(stillDrafting ? next : null);
      return;
    }
    setDraftRows(null);
    onRowsChange(next, undefined, { autoSave: true });
  };

  const handleAdd = () => {
    if (editingId && !commitEdit()) return;
    const id = newRowId();
    const row: DefaultBoardColumnRow = { id, titleEn: '', titleFr: '', isFinished: false };
    setDraftRows([...displayRows, row]);
    setEditingId(id);
    setDraftEn('');
    setDraftFr('');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || editingId) return;
    const oldIndex = displayRows.findIndex((r) => r.id === active.id);
    const newIndex = displayRows.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onRowsChange(arrayMove(displayRows, oldIndex, newIndex), undefined, { autoSave: true });
  };

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/60">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {t('defaultColumnsActions')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {t('defaultColumnsEnglish')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {t('defaultColumnsFrench')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {t('defaultColumnsFinished')}
                  </th>
                </tr>
              </thead>
              <SortableContext
                items={displayRows.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayRows.map((row) => (
                    <SortableDefaultColumnRow
                      key={row.id}
                      row={row}
                      isEditing={editingId === row.id}
                      draftEn={editingId === row.id ? draftEn : row.titleEn}
                      draftFr={editingId === row.id ? draftFr : row.titleFr}
                      onDraftEn={setDraftEn}
                      onDraftFr={setDraftFr}
                      onStartEdit={() => startEdit(row)}
                      onCommitEdit={commitEdit}
                      onDelete={() => handleDelete(row.id)}
                      onSetFinished={() => handleSetFinished(row.id)}
                      canDelete={
                        !row.isFinished &&
                        displayRows.filter(
                          (r) => r.id !== row.id && r.titleEn.trim() && r.titleFr.trim()
                        ).length >= 2
                      }
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </div>
        </DndContext>
      </div>
      <button
        type="button"
        onClick={handleAdd}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-md"
      >
        <Plus size={14} />
        {t('defaultColumnsAdd')}
      </button>
    </div>
  );
};

export default AdminDefaultBoardColumnsTable;
