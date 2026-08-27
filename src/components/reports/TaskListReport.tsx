import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { List, Calendar, RefreshCw, FileText, Tag as TagIcon, User, AlertCircle, Printer, ChevronDown, Search, X } from 'lucide-react';
import DateRangeSelector, { REPORT_DATE_FILTER_ROW_CLASS } from './DateRangeSelector';
import EnumPicker from '../ui/EnumPicker';
import { formDropdownSearchClass, formLabelClass, formPickerShellClass } from '../../utils/formFieldClasses';
import { getBoards } from '../../api';
import { getReportPrintStyles, printReport } from '../../utils/reportPrint';

interface Task {
  task_id: string;
  task_title: string;
  task_ticket: string | null;
  board_name: string;
  column_name: string;
  assignee_name: string | null;
  requester_name: string | null;
  priority_name: string | null;
  effort: number | null;
  start_date: string | null;
  due_date: string | null;
  is_completed: boolean;
  tags: string[];
  comment_count: number;
  created_at: string;
  completed_at: string | null;
}

interface TaskListData {
  success: boolean;
  filters: {
    startDate: string | null;
    endDate: string | null;
    boardId: string | null;
    status: string | null;
    assigneeId: string | null;
    priorityName: string | null;
  };
  metrics: {
    totalTasks: number;
    completedTasks: number;
    activeTasks: number;
    totalEffort: number;
    completedEffort: number;
    totalComments: number;
    avgCommentsPerTask: string;
  };
  tasks: Task[];
}

interface Board {
  id: string;
  title: string;
}

interface TaskListReportProps {
  initialFilters?: {
    startDate?: string;
    endDate?: string;
    status?: string;
    boardId?: string;
  };
  onFiltersChange?: (filters: { startDate: string; endDate: string; status: string; boardId: string }) => void;
}

const TaskListReport: React.FC<TaskListReportProps> = ({ initialFilters, onFiltersChange }) => {
  const { t } = useTranslation('common');
  const [startDate, setStartDate] = useState(initialFilters?.startDate || '');
  const [endDate, setEndDate] = useState(initialFilters?.endDate || '');
  const [status, setStatus] = useState(initialFilters?.status || '');
  const [boardId, setBoardId] = useState(initialFilters?.boardId || '');
  const [taskData, setTaskData] = useState<TaskListData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Board selector state
  const [boards, setBoards] = useState<Board[]>([]);
  const [showBoardDropdown, setShowBoardDropdown] = useState(false);
  const [boardSearchTerm, setBoardSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const boardListRef = useRef<HTMLDivElement>(null);
  const boardOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Fetch boards on mount
  useEffect(() => {
    const fetchBoards = async () => {
      try {
        const boardsData = await getBoards();
        setBoards(boardsData || []);
      } catch (error) {
        console.error('Failed to fetch boards:', error);
      }
    };
    fetchBoards();
  }, []);

  // Reset highlighted index when search term changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [boardSearchTerm]);

  // Auto-scroll to highlighted option
  useEffect(() => {
    if (highlightedIndex >= 0 && boardOptionRefs.current[highlightedIndex]) {
      boardOptionRefs.current[highlightedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [highlightedIndex]);

  // Get filtered boards for dropdown
  const filteredBoards = boards.filter(board => 
    board.title.toLowerCase().includes(boardSearchTerm.toLowerCase())
  );

  // Total options = "All Boards" + filtered boards
  const totalOptions = 1 + filteredBoards.length;

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showBoardDropdown) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < totalOptions - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : -1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex === -1) {
          return;
        } else if (highlightedIndex === 0) {
          setBoardId('');
          setShowBoardDropdown(false);
          setBoardSearchTerm('');
          setHighlightedIndex(-1);
        } else {
          const selectedBoard = filteredBoards[highlightedIndex - 1];
          if (selectedBoard) {
            setBoardId(selectedBoard.id);
            setShowBoardDropdown(false);
            setBoardSearchTerm('');
            setHighlightedIndex(-1);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowBoardDropdown(false);
        setBoardSearchTerm('');
        setHighlightedIndex(-1);
        break;
    }
  };

  // Notify parent of filter changes
  useEffect(() => {
    if (onFiltersChange) {
      onFiltersChange({ startDate, endDate, status, boardId });
    }
  }, [startDate, endDate, status, boardId, onFiltersChange]);

  const fetchTaskList = async () => {
    if (!startDate || !endDate) {
      setError(t('reports.taskList.selectBothDates'));
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      params.append('startDate', startDate);
      params.append('endDate', endDate);
      if (status) params.append('status', status);
      if (boardId) params.append('boardId', boardId);

      const response = await fetch(`/api/reports/task-list?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });

      if (!response.ok) {
        throw new Error(t('reports.taskList.failedToFetch'));
      }

      const data = await response.json();
      setTaskData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reports.taskList.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when filters change
  useEffect(() => {
    if (startDate && endDate) {
      fetchTaskList();
    }
  }, [startDate, endDate, status, boardId]);

  const handlePrint = () => {
    printReport();
  };

  return (
    <div className="space-y-6">
      <style>{getReportPrintStyles('taskList')}</style>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <List className="w-7 h-7 text-green-500" />
            {t('reports.taskList.title')}
          </h2>
          <p className="no-print text-gray-600 dark:text-gray-400 mt-1">
            {t('reports.taskList.description')}
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="no-print flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
          title={t('reports.taskList.printReport')}
        >
          <Printer className="w-4 h-4" />
          {t('reports.taskList.print')}
        </button>
      </div>

      {/* Filters */}
      <div className="no-print bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h3 className="font-semibold text-gray-900 dark:text-white">{t('reports.taskList.filters')}</h3>
          </div>
          {startDate && endDate && (
            <button
              onClick={fetchTaskList}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {t('reports.taskList.refresh')}
            </button>
          )}
        </div>
        
        <DateRangeSelector
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />

        <div className={`mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 ${REPORT_DATE_FILTER_ROW_CLASS}`}>
          <div>
            <label className={formLabelClass}>
              {t('reports.taskList.boardFilter')}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowBoardDropdown(!showBoardDropdown)}
                className={`${formPickerShellClass(false, 'panel', 'flex items-center justify-between gap-2')} hover:border-gray-400 dark:hover:border-gray-500 transition-colors`}
              >
              <span className={boardId ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>
                {boardId ? boards.find(b => b.id === boardId)?.title || t('reports.taskList.allBoards') : t('reports.taskList.allBoards')}
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showBoardDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showBoardDropdown && (
              <>
                {/* Backdrop */}
                <div 
                  className="fixed inset-0 z-10"
                  onClick={() => setShowBoardDropdown(false)}
                />
                
                {/* Dropdown Menu */}
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-80 flex flex-col">
                  {/* Search Input */}
                  <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={boardSearchTerm}
                        onChange={(e) => setBoardSearchTerm(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('reports.taskList.searchBoards')}
                        className={`${formDropdownSearchClass('w-full')} pl-9 pr-8`}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {boardSearchTerm && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setBoardSearchTerm('');
                          }}
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Board List */}
                  <div ref={boardListRef} className="overflow-y-auto max-h-64">
                    {/* All Boards Option */}
                    <button
                      ref={(el) => boardOptionRefs.current[0] = el}
                      onClick={() => {
                        setBoardId('');
                        setShowBoardDropdown(false);
                        setBoardSearchTerm('');
                        setHighlightedIndex(-1);
                      }}
                      onMouseEnter={() => setHighlightedIndex(0)}
                      className={`w-full text-left px-4 py-2 transition-colors ${
                        highlightedIndex === 0 
                          ? 'bg-gray-100 dark:bg-gray-700' 
                          : ''
                      } ${
                        !boardId ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 font-medium' : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {t('reports.taskList.allBoards')}
                    </button>

                    {/* Individual Boards */}
                    {filteredBoards.map((board, index) => {
                      const optionIndex = index + 1;
                      return (
                        <button
                          key={board.id}
                          ref={(el) => boardOptionRefs.current[optionIndex] = el}
                          onClick={() => {
                            setBoardId(board.id);
                            setShowBoardDropdown(false);
                            setBoardSearchTerm('');
                            setHighlightedIndex(-1);
                          }}
                          onMouseEnter={() => setHighlightedIndex(optionIndex)}
                          className={`w-full text-left px-4 py-2 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                            highlightedIndex === optionIndex 
                              ? 'bg-gray-100 dark:bg-gray-700' 
                              : ''
                          } ${
                            boardId === board.id ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 font-medium' : 'text-gray-900 dark:text-white'
                          }`}
                        >
                          {board.title}
                        </button>
                      );
                    })}

                    {/* No Results */}
                    {boardSearchTerm && filteredBoards.length === 0 && (
                      <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                        {t('reports.taskList.noBoardsFound')}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          </div>

          <div>
            <EnumPicker
              label={t('reports.taskList.statusFilter')}
              labelClassName={formLabelClass}
              widthClass="w-full"
              options={[
                { value: '', label: t('reports.taskList.allTasks') },
                { value: 'completed', label: t('reports.taskList.completedOnly') },
                { value: 'active', label: t('reports.taskList.activeOnly') },
              ]}
              value={status}
              onChange={setStatus}
            />
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
        </div>
      )}

      {/* Task Data */}
      {!loading && taskData && (
        <div className="table-report-print-data">
          {/* Summary Metrics */}
          <div className="table-report-print-metrics grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('reports.taskList.totalTasks')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {taskData.metrics.totalTasks}
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('reports.taskList.completed')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {taskData.metrics.completedTasks}
              </div>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('reports.taskList.active')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {taskData.metrics.activeTasks}
              </div>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('reports.taskList.totalEffort')}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {taskData.metrics.totalEffort}
              </div>
            </div>
          </div>

          {/* Tasks Table */}
          <div className="table-report-print-table bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              {taskData.tasks.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t('reports.taskList.tableHeaders.task')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t('reports.taskList.tableHeaders.board')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t('reports.taskList.tableHeaders.status')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t('reports.taskList.tableHeaders.assignee')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t('reports.taskList.tableHeaders.effort')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t('reports.taskList.tableHeaders.tags')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {taskData.tasks.map((task) => (
                      <tr key={task.task_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {task.task_ticket ? `${task.task_ticket}: ` : ''}{task.task_title}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {t('reports.taskList.created')}: {new Date(task.created_at).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {task.board_name}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            task.is_completed
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                            {task.column_name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {task.assignee_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white text-right font-medium">
                          {task.effort || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {task.tags && task.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {task.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  {t('reports.taskList.noTasksFound')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskListReport;
