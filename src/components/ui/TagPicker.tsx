import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { Tag } from '../../types';
import {
  getTagDisplayStyle,
  mergeTaskTagsWithLiveData,
} from '../../utils/tagUtils';
import AddTagModal from '../AddTagModal';

export interface TagPickerProps {
  availableTags: Tag[];
  selectedTags: Tag[];
  onToggle: (tag: Tag) => void;
  /** Called after a new tag is created in AddTagModal */
  onTagCreated?: (tag: Tag) => void;
  isLoading?: boolean;
  label?: string;
  className?: string;
  allowCreate?: boolean;
  disabled?: boolean;
}

/**
 * Multi-select tag dropdown with color dots (matches TaskDetails UX).
 */
export default function TagPicker({
  availableTags,
  selectedTags,
  onToggle,
  onTagCreated,
  isLoading = false,
  label,
  className = '',
  allowCreate = true,
  disabled = false,
}: TagPickerProps) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const liveSelected = mergeTaskTagsWithLiveData(selectedTags, availableTags);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const summary =
    liveSelected.length === 0
      ? t('labels.selectTags')
      : `${liveSelected.length} ${
          liveSelected.length !== 1 ? t('tag.plural') : t('tag.singular')
        } ${t('tag.selected')}`;

  const shellClass =
    'w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      {label && (
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}
        </label>
      )}
      {disabled ? (
        <div className={`${shellClass} cursor-default`} aria-readonly="true">
          <span className={`truncate text-left ${liveSelected.length === 0 ? 'text-gray-500 dark:text-gray-400' : ''}`}>
            {liveSelected.length === 0 ? t('taskPage.noTagsAssigned') : summary}
          </span>
        </div>
      ) : (
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${shellClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          open ? 'ring-2 ring-blue-500 border-blue-500' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-left">{summary}</span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-[400px] overflow-y-auto rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {allowCreate && (
            <button
              type="button"
              onClick={() => {
                setShowAddModal(true);
                setOpen(false);
              }}
              className="w-full px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 text-sm border-b border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 font-medium sticky top-0 bg-white dark:bg-gray-800"
            >
              <Plus size={14} />
              <span>{t('labels.addNewTag')}</span>
            </button>
          )}

          {isLoading ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {t('labels.loadingTags')}
            </div>
          ) : availableTags.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {t('labels.noTagsAvailable')}
            </div>
          ) : (
            availableTags.map((tag) => {
              const checked = selectedTags.some((t) => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => onToggle(tag)}
                  className="w-full px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 text-sm text-left"
                >
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    {checked && <Check size={12} className="text-blue-600" />}
                  </div>
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-300 dark:border-gray-600"
                    style={{ backgroundColor: tag.color || '#4ECDC4' }}
                  />
                  <span className="text-gray-700 dark:text-gray-200 truncate">
                    {tag.tag}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {liveSelected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {liveSelected.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full font-medium"
              style={getTagDisplayStyle(tag)}
            >
              {tag.tag}
              {!disabled && (
              <button
                type="button"
                onClick={() => onToggle(tag)}
                className="ml-0.5 hover:bg-black/20 rounded-full w-3.5 h-3.5 flex items-center justify-center text-xs font-bold transition-colors"
                title={t('taskPage.removeTag', { defaultValue: 'Remove tag' })}
              >
                ×
              </button>
              )}
            </span>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddTagModal
          onClose={() => setShowAddModal(false)}
          onTagCreated={(tag) => {
            onTagCreated?.(tag);
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}
