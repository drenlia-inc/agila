import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import AnchoredDropdownPortal, { useAnchoredDropdownDismiss } from './AnchoredDropdownPortal';
import {
  type FormFieldSurface,
  formFieldClass,
  formPickerShellClass,
} from '../../utils/formFieldClasses';

export type EnumOption = { value: string; label: string };

export interface EnumPickerProps {
  options: EnumOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  labelClassName?: string;
  className?: string;
  widthClass?: string;
  surface?: FormFieldSurface;
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * Custom enum dropdown — matches PriorityPicker / form field chrome (no native select).
 */
export default function EnumPicker({
  options,
  value,
  onChange,
  disabled = false,
  label,
  labelClassName,
  className = '',
  widthClass = 'w-full',
  surface = 'panel',
  placeholder,
  'aria-label': ariaLabel,
}: EnumPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  useAnchoredDropdownDismiss(open, () => setOpen(false), triggerRef, panelRef);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const shellClass = `${widthClass} ${formPickerShellClass(disabled, surface, 'flex items-center justify-between gap-2')}`;

  const triggerLabel = selected?.label ?? placeholder ?? value;

  return (
    <div className={className}>
      {label && (
        <label className={labelClassName ?? 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'}>
          {label}
        </label>
      )}
      {disabled ? (
        <div className={shellClass} aria-readonly="true">
          <span className="truncate text-left">{triggerLabel}</span>
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
          aria-label={ariaLabel ?? label}
        >
          <span className="truncate text-left text-gray-900 dark:text-gray-100">{triggerLabel}</span>
          <ChevronDown
            className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      {!disabled && (
        <AnchoredDropdownPortal
          open={open}
          triggerRef={triggerRef}
          panelRef={panelRef}
          preferredMaxHeight={280}
          minWidth={200}
          className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <span className="truncate flex-1 text-gray-900 dark:text-gray-100">{opt.label}</span>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </AnchoredDropdownPortal>
      )}
    </div>
  );
}

/** Admin enum fields — slate surface, compact width. */
export function adminEnumPickerWidth(locked: boolean, widthClass = 'w-full max-w-[11rem]') {
  return formFieldClass(locked, { surface: 'slate', widthClass, py: '1.5' });
}
