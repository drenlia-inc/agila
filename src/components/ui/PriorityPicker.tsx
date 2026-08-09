import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { PriorityOption } from '../../types';
import { getPriorityPillStyle } from './MemberAvatar';

export interface PriorityPickerProps {
  priorities: PriorityOption[];
  value: number | null | undefined;
  onChange: (priorityId: number | null, priorityName: string | null) => void;
  label?: string;
  className?: string;
  allowClear?: boolean;
  disabled?: boolean;
}

/**
 * Priority dropdown with colored pills (matches TaskCard priority UX).
 */
export default function PriorityPicker({
  priorities,
  value,
  onChange,
  label,
  className = '',
  allowClear = true,
  disabled = false,
}: PriorityPickerProps) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = value != null ? priorities.find((p) => p.id === value) : undefined;

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

  const pick = (p: PriorityOption | null) => {
    if (disabled) return;
    if (!p) {
      onChange(null, null);
    } else {
      onChange(p.id, p.priority);
    }
    setOpen(false);
  };

  const valueContent = selected ? (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold min-w-0"
      style={getPriorityPillStyle(selected.color)}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: selected.color || '#6B7280' }}
      />
      <span className="truncate">{selected.priority}</span>
    </span>
  ) : (
    <span className="text-gray-500 dark:text-gray-400 truncate">
      {t('taskPage.noPriority')}
    </span>
  );

  const shellClass =
    'w-full flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm bg-white dark:bg-gray-700';

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      {label && (
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}
        </label>
      )}
      {disabled ? (
        <div className={`${shellClass} cursor-default`} aria-readonly="true">
          {valueContent}
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
        {valueContent}
        <ChevronDown
          className={`h-4 w-4 text-gray-400 shrink-0 ml-auto transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      )}

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1"
          role="listbox"
        >
          {allowClear && (
            <button
              type="button"
              onClick={() => pick(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                !selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-500 shrink-0" />
              <span className="text-gray-600 dark:text-gray-300 flex-1">
                {t('taskPage.noPriority')}
              </span>
              {!selected && (
                <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              )}
            </button>
          )}
          {priorities.map((p) => {
            const isSelected = selected?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold min-w-0"
                  style={getPriorityPillStyle(p.color)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: p.color || '#6B7280' }}
                  />
                  <span className="truncate">{p.priority}</span>
                </span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0 ml-auto" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
