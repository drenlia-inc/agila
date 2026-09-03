import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { PriorityOption } from '../../types';
import AnchoredDropdownPortal, { useAnchoredDropdownDismiss } from './AnchoredDropdownPortal';
import { formPickerShellClass } from '../../utils/formFieldClasses';

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
 * Priority dropdown: color dot plus the priority name, styled like the other
 * form fields around it.
 */
export default function PriorityPicker({
  priorities,
  value,
  onChange,
  label,
  className = '',
  allowClear = false,
  disabled = false,
}: PriorityPickerProps) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected =
    value != null
      ? priorities.find((priority) => String(priority.id) === String(value))
      : undefined;

  useAnchoredDropdownDismiss(open, () => setOpen(false), triggerRef, panelRef);

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
    <span className="inline-flex items-center gap-2 min-w-0">
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: selected.color || '#6B7280' }}
      />
      <span className="truncate">{selected.priority}</span>
    </span>
  ) : (
    <span className="text-gray-500 dark:text-gray-400 truncate">
      {t('taskPage.noPriority')}
    </span>
  );

  const shellClass = formPickerShellClass(disabled);

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}
        </label>
      )}
      {disabled ? (
        <div className={shellClass} aria-readonly="true">
          {valueContent}
        </div>
      ) : (
      <button
        ref={triggerRef}
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

      <AnchoredDropdownPortal
        open={open && !disabled}
        triggerRef={triggerRef}
        panelRef={panelRef}
        preferredMaxHeight={256}
        className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
      >
        <div className="min-h-0 flex-1 overflow-y-auto" role="listbox">
          {allowClear && (
            <button
              type="button"
              onClick={() => pick(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                !selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-500 shrink-0" />
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
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color || '#6B7280' }}
                />
                <span className="truncate text-gray-900 dark:text-gray-100">
                  {p.priority}
                </span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0 ml-auto" />
                )}
              </button>
            );
          })}
        </div>
      </AnchoredDropdownPortal>
    </div>
  );
}
