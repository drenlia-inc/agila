import { useState, useRef, useEffect, useMemo } from 'react';
import { Columns, Check, ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { onHelpReveal, takeHelpReveal } from '../utils/helpGoThere';
import type { Columns as BoardColumns } from '../types';
import { useColumnDisplayTitle } from '../utils/columnDisplayTitle';
import { formFilterTriggerClass, formInputEditableParts } from '../utils/formFieldClasses';

interface ColumnFilterDropdownProps {
  columns: BoardColumns;
  visibleColumns: string[];
  onColumnsChange: (visibleColumns: string[]) => void;
  selectedBoard: string | null;
  /** Stretch trigger to fill parent width (e.g. match date input below). */
  fullWidth?: boolean;
  /** Clear saved override — default visibility (non-archived columns only). */
  onResetToDefault?: () => void;
  /** Icon-sized trigger for packed headers (Calendar). */
  compact?: boolean;
  /** Override the trigger tooltip. */
  triggerTitle?: string;
  /** Skip the Kanban help-reveal hook when this copy is not the Tools filter. */
  enableHelpReveal?: boolean;
}

const isArchivedColumn = (column: { is_archived?: boolean | number }) =>
  column.is_archived === true || column.is_archived === 1;

const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  columns,
  visibleColumns,
  onColumnsChange,
  selectedBoard,
  fullWidth = false,
  onResetToDefault,
  compact = false,
  triggerTitle,
  enableHelpReveal = true,
}) => {
  const { t } = useTranslation('common');
  const columnDisplayTitle = useColumnDisplayTitle();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!enableHelpReveal) return;
    const openFromHelp = () => {
      if (!takeHelpReveal('columnFilter')) return;
      window.setTimeout(() => setIsOpen(true), 0);
    };
    openFromHelp();
    return onHelpReveal(openFromHelp);
  }, [enableHelpReveal]);

  const columnList = Object.values(columns).sort((a, b) => (a.position || 0) - (b.position || 0));
  const liveVisibleColumns = useMemo(
    () => visibleColumns.filter((id) => columns[id]),
    [visibleColumns, columns]
  );
  const allVisible = columnList.length > 0 && liveVisibleColumns.length === columnList.length;
  const someVisible = liveVisibleColumns.length > 0 && liveVisibleColumns.length < columnList.length;

  const defaultVisibleColumnIds = useMemo(
    () => columnList.filter((col) => !isArchivedColumn(col)).map((col) => col.id),
    [columnList],
  );

  const isCustomized = useMemo(() => {
    const current = [...liveVisibleColumns].sort();
    const defaults = [...defaultVisibleColumnIds].sort();
    if (current.length !== defaults.length) return true;
    return current.some((id, index) => id !== defaults[index]);
  }, [liveVisibleColumns, defaultVisibleColumnIds]);

  const handleToggleColumn = (columnId: string) => {
    if (visibleColumns.includes(columnId)) {
      // Don't allow hiding the last remaining column
      if (visibleColumns.length > 1) {
        onColumnsChange(visibleColumns.filter(id => id !== columnId));
      }
    } else {
      // Always allow adding columns back
      onColumnsChange([...visibleColumns, columnId]);
    }
  };

  const handleSelectAll = () => {
    // Archive stays off unless the user ticks it — All means every active status.
    onColumnsChange(
      defaultVisibleColumnIds.length > 0
        ? defaultVisibleColumnIds
        : columnList.slice(0, 1).map((col) => col.id)
    );
  };

  const handleSelectNone = () => {
    const fallback =
      defaultVisibleColumnIds[0] || columnList[0]?.id;
    if (fallback) {
      onColumnsChange([fallback]);
    }
  };

  const handleResetToDefault = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onResetToDefault?.();
  };

  return (
    <div
      className={`relative${fullWidth ? ' w-full' : ''}`}
      ref={dropdownRef}
      data-help-target={enableHelpReveal ? 'kanban-column-filter' : 'calendar-column-filter'}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={
          compact
            ? `relative inline-flex h-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                isCustomized
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500/60 text-blue-800 dark:text-blue-200'
                  : `${formInputEditableParts('panel')} text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 dark:hover:bg-gray-800/80`
              } ${isCustomized && onResetToDefault ? 'pr-6' : ''}`
            : `${formFilterTriggerClass(isCustomized, {
                extra: fullWidth ? ' w-full' : '',
              })}`
        }
        title={triggerTitle || t('columnFilterDropdown.filterColumns')}
        aria-label={triggerTitle || t('columnFilterDropdown.filterColumns')}
        aria-expanded={isOpen}
      >
        <Columns size={14} className="shrink-0" />
        <span className={compact ? '' : 'min-w-0 flex-1 truncate hidden sm:inline'}>
          {t('columnFilterDropdown.columns')}
        </span>
        {someVisible && (
          <span className="shrink-0 px-1.5 py-0.5 text-xs leading-none bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
            {liveVisibleColumns.length}
          </span>
        )}
        {!compact && !isCustomized && (
          <ChevronDown
            size={12}
            className={`pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {isCustomized && onResetToDefault && selectedBoard && (
        <button
          type="button"
          onClick={handleResetToDefault}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors z-10"
          title={t('columnFilterDropdown.resetToDefault')}
          aria-label={t('columnFilterDropdown.resetToDefault')}
        >
          <X size={10} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
        </button>
      )}

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-[60] min-w-[200px] max-h-60 overflow-y-auto">
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('columnFilterDropdown.columnVisibility')}</span>
              <div className="flex gap-1">
                <button
                  onClick={handleSelectAll}
                  className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded"
                  title={t('columnFilterDropdown.allHint')}
                >
                  {t('columnFilterDropdown.all')}
                </button>
                <button
                  onClick={handleSelectNone}
                  className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                >
                  {t('columnFilterDropdown.none')}
                </button>
              </div>
            </div>
          </div>
          
          <div className="py-1">
            {columnList.map(column => {
              const isVisible = visibleColumns.includes(column.id);
              // Only disable if this is the last remaining visible column
              const isDisabled = isVisible && visibleColumns.length === 1;
              const isArchived = isArchivedColumn(column);
              
              return (
                <button
                  key={column.id}
                  onClick={() => handleToggleColumn(column.id)}
                  disabled={isDisabled}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                    isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    isArchived 
                      ? 'bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30' 
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-center w-4 h-4">
                    {isVisible && <Check size={12} className="text-blue-600 dark:text-blue-400" />}
                  </div>
                  <span className={`truncate ${isArchived ? 'text-gray-500 dark:text-gray-400 italic' : 'text-gray-700 dark:text-gray-300'}`}>
                    {columnDisplayTitle(column)}
                    {isArchived && t('columnFilterDropdown.archive')}
                  </span>
                  {isDisabled && (
                    <span className="text-xs text-gray-400 ml-auto">{t('columnFilterDropdown.required')}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ColumnFilterDropdown;
