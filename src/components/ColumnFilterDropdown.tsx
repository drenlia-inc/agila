import { useState, useRef, useEffect } from 'react';
import { Columns, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { onHelpReveal, takeHelpReveal } from '../utils/helpGoThere';

interface ColumnFilterDropdownProps {
  columns: Columns;
  visibleColumns: string[];
  onColumnsChange: (visibleColumns: string[]) => void;
  selectedBoard: string | null;
}

const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  columns,
  visibleColumns,
  onColumnsChange,
  selectedBoard
}) => {
  const { t } = useTranslation('common');
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
    const openFromHelp = () => {
      if (!takeHelpReveal('columnFilter')) return;
      window.setTimeout(() => setIsOpen(true), 0);
    };
    openFromHelp();
    return onHelpReveal(openFromHelp);
  }, []);

  const columnList = Object.values(columns).sort((a, b) => (a.position || 0) - (b.position || 0));
  const allVisible = columnList.length > 0 && visibleColumns.length === columnList.length;
  const someVisible = visibleColumns.length > 0 && visibleColumns.length < columnList.length;

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
    const allColumnIds = columnList.map(col => col.id);
    onColumnsChange(allColumnIds);
  };

  const handleSelectNone = () => {
    // Keep at least one column visible
    if (columnList.length > 0) {
      onColumnsChange([columnList[0].id]);
    }
  };

  return (
    <div className="relative" ref={dropdownRef} data-help-target="kanban-column-filter">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        title={t('columnFilterDropdown.filterColumns')}
      >
        <Columns size={14} />
        <span className="hidden sm:inline">{t('columnFilterDropdown.columns')}</span>
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        {someVisible && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
            {visibleColumns.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-[60] min-w-[200px] max-h-60 overflow-y-auto">
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('columnFilterDropdown.columnVisibility')}</span>
              <div className="flex gap-1">
                <button
                  onClick={handleSelectAll}
                  className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded"
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
              const isArchived = !!column.is_archived;
              
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
                    {column.title}
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
