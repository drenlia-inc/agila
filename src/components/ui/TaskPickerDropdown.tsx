import React, { useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredDropdownPortal, { useAnchoredDropdownDismiss } from './AnchoredDropdownPortal';
import { formFieldClass, formPickerShellClass } from '../../utils/formFieldClasses';

export interface TaskPickerOption {
  id: string;
  ticket: string;
  title: string;
}

interface TaskPickerDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: string;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  searchPlaceholder: string;
  items: TaskPickerOption[];
  emptyText: string;
  noResultsText: string;
  onSelect: (taskId: string) => void;
  disabled?: boolean;
  helpTarget?: string;
}

/**
 * Searchable task picker with viewport-aware portal (TaskDetails / TaskPage relationships).
 */
export default function TaskPickerDropdown({
  open,
  onOpenChange,
  triggerLabel,
  searchTerm,
  onSearchTermChange,
  searchPlaceholder,
  items,
  emptyText,
  noResultsText,
  onSelect,
  disabled = false,
  helpTarget,
}: TaskPickerDropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useAnchoredDropdownDismiss(open, () => onOpenChange(false), triggerRef, panelRef);

  const shellClass = `${formPickerShellClass(disabled, 'panel', 'flex items-center justify-between')} text-gray-900 dark:text-gray-100`;

  return (
    <>
      {disabled ? (
        <div className={shellClass} data-help-target={helpTarget} aria-readonly="true">
          <span className="truncate">{triggerLabel}</span>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          data-help-target={helpTarget}
          onClick={() => onOpenChange(!open)}
          className={`${shellClass} focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
        >
          <span className="truncate text-gray-700 dark:text-gray-200">{triggerLabel}</span>
          <ChevronDown
            size={16}
            className={`shrink-0 transform transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      {!disabled && (
        <AnchoredDropdownPortal
          open={open}
          triggerRef={triggerRef}
          panelRef={panelRef}
          preferredMaxHeight={280}
          className="flex flex-col overflow-hidden rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="shrink-0 border-b border-gray-200 p-2 dark:border-gray-600">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className={formFieldClass(false, { widthClass: 'w-full', py: '1.5', extra: 'rounded px-2 focus:ring-1 focus:ring-blue-500' })}
              autoFocus
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length > 0 ? (
              items.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onSelect(task.id)}
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none dark:hover:bg-blue-900/35 dark:focus:bg-blue-900/35"
                >
                  <div className="font-medium text-blue-600 dark:text-blue-400">{task.ticket}</div>
                  <div className="truncate text-gray-600 dark:text-gray-300">{task.title}</div>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                {searchTerm.trim() ? noResultsText : emptyText}
              </div>
            )}
          </div>
        </AnchoredDropdownPortal>
      )}
    </>
  );
}
