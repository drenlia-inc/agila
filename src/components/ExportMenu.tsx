import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Table } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ExcelJS from 'exceljs';
import { Board, TeamMember, Tag, PriorityOption } from '../types';
import { 
  convertToCSV,
  generateFilename, 
  downloadFile,
  getAllTasksForExport,
  getCurrentBoardTasksForExport,
  ExportOptions,
  ExportData
} from '../utils/exportUtils';

interface ExportMenuProps {
  boards: Board[];
  selectedBoard: Board;
  members: TeamMember[];
  availableTags: Tag[];
  availablePriorities?: PriorityOption[];
  isAdmin: boolean;
}

const COLUMN_WIDTHS: Record<string, number> = {
  boardName: 20,
  sprint: 20,
  ticket: 15,
  title: 30,
  description: 40,
  assignee: 20,
  priority: 15,
  status: 20,
  startDate: 12,
  dueDate: 12,
  effort: 8,
  tags: 25,
  comments: 15,
  createdAt: 12,
  updatedAt: 12,
  project: 20
};

function cleanExcelSheetName(name: string): string {
  return name.replace(/[\\/?*[\]]/g, '').substring(0, 31) || 'Sheet';
}

function addSheetFromRows(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: ExportData[],
  columns: Array<{ key: keyof ExportData | string; header: string }>
) {
  const worksheet = workbook.addWorksheet(cleanExcelSheetName(sheetName));
  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: String(col.key),
    width: COLUMN_WIDTHS[String(col.key)] || 15
  }));
  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const col of columns) {
      values[String(col.key)] = (row as Record<string, unknown>)[String(col.key)] ?? '';
    }
    worksheet.addRow(values);
  }
}

async function createXlsxBuffer(
  data: ExportData[],
  translateFn: (key: string) => string
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();

  const columnMapping = [
    { key: 'sprint', header: translateFn('export.headers.sprint') },
    { key: 'ticket', header: translateFn('export.headers.ticket') },
    { key: 'title', header: translateFn('export.headers.task') },
    { key: 'description', header: translateFn('export.headers.description') },
    { key: 'assignee', header: translateFn('export.headers.assignee') },
    { key: 'priority', header: translateFn('export.headers.priority') },
    { key: 'status', header: translateFn('export.headers.status') },
    { key: 'startDate', header: translateFn('export.headers.startDate') },
    { key: 'dueDate', header: translateFn('export.headers.dueDate') },
    { key: 'effort', header: translateFn('export.headers.effort') },
    { key: 'tags', header: translateFn('export.headers.tags') },
    { key: 'comments', header: translateFn('export.headers.comments') },
    { key: 'createdAt', header: translateFn('export.headers.created') },
    { key: 'updatedAt', header: translateFn('export.headers.updated') },
    { key: 'project', header: translateFn('export.headers.project') }
  ];

  const columnMappingWithBoard = [
    { key: 'boardName', header: translateFn('export.headers.board') },
    ...columnMapping
  ];

  const boardGroups = data.reduce((acc, task) => {
    if (!acc[task.boardName]) {
      acc[task.boardName] = [];
    }
    acc[task.boardName].push(task);
    return acc;
  }, {} as Record<string, ExportData[]>);

  for (const [boardName, boardTasks] of Object.entries(boardGroups)) {
    addSheetFromRows(workbook, boardName, boardTasks, columnMapping);
  }

  if (Object.keys(boardGroups).length > 1) {
    addSheetFromRows(workbook, translateFn('export.allBoards'), data, columnMappingWithBoard);
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export default function ExportMenu({ 
  boards, 
  selectedBoard, 
  members, 
  availableTags,
  availablePriorities,
  isAdmin 
}: ExportMenuProps) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sprints, setSprints] = useState<Array<{ id: string; name: string }>>([]);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuPortalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchSprints = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/admin/sprints', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSprints(data.sprints || []);
        }
      } catch (error) {
        console.error('Failed to fetch sprints:', error);
      }
    };

    fetchSprints();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (menuPortalRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) {
      setMenuCoords(null);
      return;
    }

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuCoords({ top: rect.bottom + 4, left: rect.left });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  if (!isAdmin) {
    return null;
  }

  const handleExport = async (options: ExportOptions) => {
    setIsExporting(true);
    
    try {
      let data;
      
      if (options.scope === 'current') {
        data = getCurrentBoardTasksForExport(selectedBoard, members, availableTags, sprints, availablePriorities);
      } else {
        data = getAllTasksForExport(boards, members, availableTags, sprints, availablePriorities);
      }

      const filename = generateFilename(
        options.format, 
        options.scope, 
        options.scope === 'current' ? selectedBoard.title : undefined
      );

      if (options.format === 'csv') {
        const csvContent = convertToCSV(data, t);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        downloadFile(blob, filename);
      } else {
        const xlsxBuffer = await createXlsxBuffer(data, t);
        const blob = new Blob([xlsxBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        downloadFile(blob, filename);
      }

      setIsOpen(false);
    } catch (error) {
      console.error('Export failed:', error);
      alert(t('export.failed'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="opacity-60 hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-opacity disabled:opacity-50"
        title={t('export.title')}
        aria-label={t('export.title')}
        aria-expanded={isOpen}
        data-tour-id="export-menu"
      >
        <Download size={14} />
      </button>

      {isOpen && menuCoords && createPortal(
        <div
          ref={menuPortalRef}
          className="fixed w-48 bg-white dark:bg-gray-700 rounded-md shadow-lg border border-gray-200 dark:border-gray-600 z-[9999]"
          style={{ top: menuCoords.top, left: menuCoords.left }}
          role="menu"
        >
          <div className="py-1">
            <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('export.csvExport')}
            </div>
            <button
              type="button"
              onClick={() => handleExport({ format: 'csv', scope: 'current' })}
              disabled={isExporting}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-2 disabled:opacity-50"
            >
              <FileText size={14} />
              {t('export.currentBoard')}
            </button>
            <button
              type="button"
              onClick={() => handleExport({ format: 'csv', scope: 'all' })}
              disabled={isExporting}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-2 disabled:opacity-50"
            >
              <FileText size={14} />
              {t('export.allBoards')}
            </button>

            <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

            <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('export.excelExport')}
            </div>
            <button
              type="button"
              onClick={() => handleExport({ format: 'xlsx', scope: 'current' })}
              disabled={isExporting}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-2 disabled:opacity-50"
            >
              <Table size={14} />
              {t('export.currentBoard')}
            </button>
            <button
              type="button"
              onClick={() => handleExport({ format: 'xlsx', scope: 'all' })}
              disabled={isExporting}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-2 disabled:opacity-50"
            >
              <Table size={14} />
              {t('export.allBoards')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
