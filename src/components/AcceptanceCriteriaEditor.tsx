import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  createAcceptanceCriterion,
  deleteAcceptanceCriterion,
  getAcceptanceCriteria,
  reorderAcceptanceCriteria,
  updateAcceptanceCriterion,
  type AcceptanceCriterion,
} from '../api';
import { ACCEPTANCE_CRITERION_MAX_LENGTH } from '../constants/appConstants';
import { ModernCheckbox } from './ModernCheckbox';
import { formFieldClass } from '../utils/formFieldClasses';
import websocketClient from '../services/websocketClient';

function SortableCriterion({
  item,
  locked,
  onToggle,
  onDelete,
  onEdit,
}: {
  item: AcceptanceCriterion;
  locked: boolean;
  onToggle: (item: AcceptanceCriterion) => void;
  onDelete: (item: AcceptanceCriterion) => void;
  onEdit: (item: AcceptanceCriterion, text: string) => void;
}) {
  const { t } = useTranslation('tasks');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  useEffect(() => {
    if (!editing) setDraft(item.text);
  }, [item.text, editing]);

  const commitEdit = () => {
    const next = draft.trim();
    if (!next) return;
    onEdit(item, next);
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(item.text);
    setEditing(false);
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: locked,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-800"
    >
      {!locked && (
        <button
          type="button"
          className="mt-0.5 cursor-grab text-slate-400 hover:text-slate-600"
          aria-label={t('acceptanceCriteria.reorder')}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      )}
      <ModernCheckbox
        checked={item.isDone}
        disabled={locked}
        onChange={() => onToggle(item)}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex gap-1">
            <input
              value={draft}
              maxLength={ACCEPTANCE_CRITERION_MAX_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              className={formFieldClass(false, { widthClass: 'w-full', rounded: 'md' })}
              autoFocus
            />
            <button
              type="button"
              className="rounded-md bg-blue-600 p-1.5 text-white hover:bg-blue-700"
              onClick={commitEdit}
              aria-label={t('acceptanceCriteria.saveItem')}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="rounded-md p-1 text-slate-400"
              onClick={cancelEdit}
              aria-label={t('acceptanceCriteria.cancelEdit')}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <span
            className={`text-sm ${
              item.isDone
                ? 'text-slate-400 line-through dark:text-gray-500'
                : 'text-slate-800 dark:text-gray-100'
            }`}
            onDoubleClick={() => {
              if (!locked) {
                setDraft(item.text);
                setEditing(true);
              }
            }}
          >
            {item.text}
          </span>
        )}
      </div>
      {!locked && !editing && (
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:text-blue-600"
            onClick={() => setEditing(true)}
            aria-label={t('acceptanceCriteria.edit')}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:text-red-600"
            onClick={() => onDelete(item)}
            aria-label={t('acceptanceCriteria.delete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function AcceptanceCriteriaEditor({
  taskId,
  locked = false,
}: {
  taskId: string;
  locked?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const [items, setItems] = useState<AcceptanceCriterion[]>([]);
  const [draft, setDraft] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    const next = await getAcceptanceCriteria(taskId);
    setItems(next);
  }, [taskId]);

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);

  useEffect(() => {
    const onUpdated = (data: { taskId?: string; items?: AcceptanceCriterion[] }) => {
      if (String(data?.taskId) !== String(taskId) || !Array.isArray(data.items)) return;
      setItems(data.items);
    };
    websocketClient.onAcceptanceCriteriaUpdated(onUpdated);
    return () => websocketClient.offAcceptanceCriteriaUpdated(onUpdated);
  }, [taskId]);

  const addItem = async () => {
    const text = draft.trim();
    if (!text || locked) return;
    const created = await createAcceptanceCriterion(taskId, text);
    setItems((prev) => (prev.some((row) => row.id === created.id) ? prev : [...prev, created]));
    setDraft('');
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    await reorderAcceptanceCriteria(taskId, next.map((item) => item.id));
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('acceptanceCriteria.label')}
      </label>
      {!locked && (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            maxLength={ACCEPTANCE_CRITERION_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addItem();
              }
            }}
            placeholder={t('acceptanceCriteria.placeholder')}
            className={formFieldClass(false, { widthClass: 'w-full', rounded: 'lg' })}
          />
          <button
            type="button"
            onClick={() => void addItem()}
            disabled={!draft.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus size={14} />
            {t('acceptanceCriteria.add')}
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        // AC editor is a vertical checklist: prevent horizontal drifts for a cleaner UX.
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={(e) => void onDragEnd(e)}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {items.map((item) => (
              <SortableCriterion
                key={item.id}
                item={item}
                locked={locked}
                onToggle={(current) => {
                  void updateAcceptanceCriterion(taskId, current.id, { isDone: !current.isDone }).then(
                    (updated) => setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
                  );
                }}
                onDelete={(current) => {
                  void deleteAcceptanceCriterion(taskId, current.id).then(() =>
                    setItems((prev) => prev.filter((row) => row.id !== current.id))
                  );
                }}
                onEdit={(current, text) => {
                  void updateAcceptanceCriterion(taskId, current.id, { text }).then((updated) =>
                    setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
                  );
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
