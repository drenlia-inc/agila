import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { TaskJumpDropdown } from './TaskJumpDropdown';

interface GanttTask {
  id: string;
  title: string;
  ticket: string;
  startDate: Date | null;
  endDate: Date | null;
  priority: string;
  status: string;
  columnId: string;
  columnPosition: number;
  taskPosition: number;
}

interface GanttHeaderProps {
  // Date range and formatting
  dateRange: Array<{ date: Date }>;
  formatDate: (date: Date) => string;
  
  // Tasks
  ganttTasks: GanttTask[];
  
  // Navigation functions
  scrollToToday: () => void;
  scrollEarlier: () => void;
  scrollLater: () => void;
  scrollToTask: (startDate: Date, endDate: Date, position?: string) => void;
  
  // Relationship mode
  isRelationshipMode: boolean;
  setIsRelationshipMode: (mode: boolean) => void;
  
  // Multi-select mode
  isMultiSelectMode: boolean;
  setIsMultiSelectMode: (mode: boolean) => void;
  selectedTasks: string[];
  setSelectedTasks: (tasks: string[]) => void;
  setHighlightedTaskId?: (taskId: string | null) => void;
  resetArrowKeyState?: () => void;
  
  // Loading state
  isLoading: boolean;
  
  // Task jump handler
  onJumpToTask: (task: GanttTask) => void;
  
  // Relationship mode handlers
  selectedParentTask?: string | null;
  setSelectedParentTask?: (taskId: string | null) => void;

  /** When false, Select / Link mode toggles are disabled (viewers). */
  canMutate?: boolean;
}

export const GanttHeader: React.FC<GanttHeaderProps> = ({
  dateRange,
  formatDate,
  ganttTasks,
  scrollToToday,
  scrollEarlier,
  scrollLater,
  scrollToTask,
  isRelationshipMode,
  setIsRelationshipMode,
  isMultiSelectMode,
  setIsMultiSelectMode,
  selectedTasks,
  setSelectedTasks,
  setHighlightedTaskId,
  resetArrowKeyState,
  isLoading,
  onJumpToTask,
  selectedParentTask,
  setSelectedParentTask,
  canMutate = true,
}) => {
  const { t } = useTranslation('common');

  const showModeHint = isRelationshipMode || isMultiSelectMode;

  const modeHintContent = isRelationshipMode
    ? selectedParentTask
      ? t('gantt.linkModeHintPickTarget')
      : t('gantt.linkModeHintPickSource')
    : isMultiSelectMode
      ? selectedTasks.length > 0
        ? 'move'
        : t('gantt.selectModeHint')
      : null;

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 p-4 pb-5 relative">
      <div className="flex items-center justify-between gap-4">
        {/* Title and Description */}
        <div className="w-[130px] flex-shrink-0 mr-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('gantt.title')}</h2>
          <p className="text-sm text-gray-600 mt-1 break-words">
            {dateRange.length > 0 ? (
              t('gantt.timelineView', { 
                startDate: formatDate(dateRange[0].date), 
                endDate: formatDate(dateRange[dateRange.length - 1].date) 
              })
            ) : (
              t('gantt.loadingTimeline')
            )}
          </p>
        </div>
        
        {/* Navigation Controls */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Select / Link — hint overlays fixed slot below (pb-5), no layout shift */}
          <div className="relative flex items-center gap-2">
          {/* Multi-Select Mode Toggle */}
              <button
                disabled={!canMutate}
                onClick={() => {
                  if (!canMutate) return;
                  if (isMultiSelectMode) {
                    // Exit multi-select mode and clear selections
                    setIsMultiSelectMode(false);
                    setSelectedTasks([]);
                    setHighlightedTaskId?.(null); // Clear any highlighted tasks
                    resetArrowKeyState?.(); // Reset arrow key state to prevent frozen tasks
                  } else {
                    // Enter multi-select mode
                    // First exit relationship mode if it's active
                    if (isRelationshipMode) {
                      setIsRelationshipMode(false);
                      if (setSelectedParentTask) {
                        setSelectedParentTask(null);
                      }
                    }
                    setIsMultiSelectMode(true);
                  }
                }}
                className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isMultiSelectMode
                    ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title={isMultiSelectMode ? t('gantt.exitMultiSelectMode') : t('gantt.selectMultipleTasks')}
              >
            <svg className="w-4 h-4 mr-1.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {isMultiSelectMode ? t('gantt.exit') : t('gantt.select')}
            {selectedTasks.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-200 text-green-800 rounded-full">
                {selectedTasks.length}
              </span>
            )}
          </button>
          
          {/* Multi-Select Actions */}
          {isMultiSelectMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const allTaskIds = ganttTasks.map(task => task.id);
                  if (selectedTasks.length === allTaskIds.length) {
                    // Deselect all
                    setSelectedTasks([]);
                  } else {
                    // Select all
                    setSelectedTasks(allTaskIds);
                  }
                }}
                className="px-2 py-1 text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded transition-colors"
                title={selectedTasks.length === ganttTasks.length ? t('gantt.deselectAll') : t('gantt.selectAll')}
              >
                {selectedTasks.length === ganttTasks.length ? t('gantt.deselectAll') : t('gantt.selectAll')}
              </button>
              
            </div>
          )}
          
          {/* Relationship Mode Toggle */}
          <button
            disabled={!canMutate}
            onClick={() => {
              if (!canMutate) return;
              if (isRelationshipMode) {
                // Exit relationship mode and clear selected parent
                setIsRelationshipMode(false);
                if (setSelectedParentTask) {
                  setSelectedParentTask(null);
                }
              } else {
                // Enter relationship mode
                // First exit multi-select mode if it's active
                if (isMultiSelectMode) {
                  setIsMultiSelectMode(false);
                  setSelectedTasks([]);
                  setHighlightedTaskId?.(null);
                  resetArrowKeyState?.();
                }
                setIsRelationshipMode(true);
              }
            }}
            className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isRelationshipMode
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-800'
                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
            title={isRelationshipMode ? t('gantt.exitRelationshipMode') : t('gantt.createTaskRelationships')}
          >
            <svg className="w-4 h-4 mr-1.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {isRelationshipMode ? t('gantt.exit') : t('gantt.link')}
          </button>
            <div className="absolute left-1/2 top-full -translate-x-1/2 mt-0.5 h-4 w-max max-w-lg flex items-center justify-center pointer-events-none">
              <p
                className={`text-xs leading-none text-gray-600 dark:text-gray-400 truncate whitespace-nowrap text-center ${
                  showModeHint ? '' : 'opacity-0'
                }`}
                aria-live="polite"
                aria-hidden={!showModeHint}
              >
                {showModeHint ? (
                  modeHintContent === 'move' ? (
                    <span className="text-gray-500 dark:text-gray-500">
                      <Trans
                        i18nKey="gantt.selectModeHintMove"
                        ns="common"
                        components={{
                          bold: <span className="font-semibold text-gray-700 dark:text-gray-300" />,
                        }}
                      />
                    </span>
                  ) : (
                    <span className="opacity-75">{modeHintContent}</span>
                  )
                ) : (
                  '\u00a0'
                )}
              </p>
            </div>
          </div>
          
          {/* Task Navigation: < Task > */}
          <div className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-gray-300 px-1 dark:border-gray-600">
            <button
              type="button"
              onClick={() => {
                if (ganttTasks.length > 0) {
                  const earliestTask = ganttTasks.reduce((earliest, task) =>
                    (!earliest.startDate || (task.startDate && task.startDate < earliest.startDate)) ? task : earliest
                  );
                  if (earliestTask.startDate) {
                    scrollToTask(earliestTask.startDate, earliestTask.endDate || earliestTask.startDate, 'start-left');
                  }
                }
              }}
              disabled={ganttTasks.length === 0}
              className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
              title={t('gantt.jumpToEarliestTask')}
              aria-label={t('gantt.jumpToEarliestTask')}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('gantt.task')}
            </span>
            <button
              type="button"
              onClick={() => {
                if (ganttTasks.length > 0) {
                  const latestTask = ganttTasks.reduce((latest, task) =>
                    (!latest.endDate || (task.endDate && task.endDate > latest.endDate)) ? task : latest
                  );
                  if (latestTask.endDate) {
                    scrollToTask(latestTask.startDate || latestTask.endDate, latestTask.endDate, 'end-right');
                  }
                }
              }}
              disabled={ganttTasks.length === 0}
              className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
              title={t('gantt.jumpToLatestTask')}
              aria-label={t('gantt.jumpToLatestTask')}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Date Navigation: < Earlier Today Later > */}
          <div className="flex items-center gap-2">
            {/* Earlier Button */}
            <button
              onClick={scrollEarlier}
              disabled={isLoading}
              className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                isLoading 
                  ? 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed' 
                  : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300'
              }`}
              title={t('gantt.scrollToEarlierDates')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t('gantt.earlier')}
            </button>

            {/* Today Button */}
            <button
              onClick={scrollToToday}
              disabled={isLoading}
              className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                isLoading 
                  ? 'text-gray-400 bg-gray-300 cursor-not-allowed' 
                  : 'text-white bg-blue-500 hover:bg-blue-600'
              }`}
              title={t('gantt.scrollToToday')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t('gantt.today')}
            </button>

            {/* Later Button */}
            <button
              onClick={scrollLater}
              disabled={isLoading}
              className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                isLoading 
                  ? 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed' 
                  : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300'
              }`}
              title={t('gantt.scrollToLaterDates')}
            >
              {t('gantt.later')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Loading Indicator - Fixed position to prevent layout shift */}
          <div className="relative w-20 flex justify-center">
            {isLoading && (
              <div className="absolute flex items-center gap-1 px-2 py-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md whitespace-nowrap">
                <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                {t('gantt.loading')}
              </div>
            )}
          </div>

          {/* Task Jump Dropdown */}
          {ganttTasks.length > 0 && (
            <div className="flex-shrink-0">
              <TaskJumpDropdown
                tasks={ganttTasks.filter(task => task.startDate && task.endDate)}
                onTaskSelect={onJumpToTask}
                className="w-56"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
