import React from 'react';
import { useTranslation } from 'react-i18next';
import { Columns } from '../types';
import { formatEffortDisplay, parseEffortUnit, sumTaskEffort } from '../utils/taskUtils';
import { isBoardWipActiveColumn } from '../utils/kanbanFlowUtils';
import { showBoardTabEffort } from '../utils/kanbanChromeVisibility';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';

interface BoardMetricsProps {
  columns: Columns;
  filteredColumns?: Columns;
  siteSettings?: { [key: string]: string };
}

const BoardMetrics: React.FC<BoardMetricsProps> = ({ columns, filteredColumns = columns, siteSettings }) => {
  const { t } = useTranslation('common');
  const effortUnit = parseEffortUnit(siteSettings);
  // Progress uses all visible tasks; effort pill matches board WIP (active columns only).
  const allTasks = Object.values(filteredColumns).flatMap(column => column.tasks || []);
  const activeEffortTasks = Object.values(filteredColumns)
    .filter((column) => isBoardWipActiveColumn(column))
    .flatMap((column) => column.tasks || []);
  const totalTasks = allTasks.length;
  const totalEffort = sumTaskEffort(activeEffortTasks);
  const effortDisplay = formatEffortDisplay(totalEffort, effortUnit);
  
  // Count completed tasks (tasks in finished or archived columns)
  const completedTasks = Object.values(filteredColumns)
    .filter(column => column.is_finished || column.is_archived)
    .flatMap(column => column.tasks || [])
    .length;
  
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const effortTooltip = t('boardMetrics.totalEffortTooltip', { display: effortDisplay });
  const showEffortPill = showBoardTabEffort(siteSettings) && totalEffort > 0;

  return (
        <div className="p-3 bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-100 dark:border-gray-700 w-full flex-1 flex flex-col box-border">
      {/* Same title row height/spacing as Tools + Team Members so headings share one baseline */}
      <div className="flex items-center justify-center mb-3 min-h-5 shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide leading-5 text-center">
          {t('boardMetrics.progress')}
        </h2>
      </div>

      <div className="space-y-2 flex-1 flex flex-col justify-center min-h-0">
        {/* Progress */}
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {completedTasks}/{totalTasks} <span className="text-xs font-normal text-gray-600 dark:text-gray-400">({completionPercentage}%)</span>
          </div>
        </div>
        
        {/* Progress bar + optional effort on the same row (keeps card height aligned with Tools / Team Members) */}
        <div className="flex items-center gap-1.5 w-full min-w-0">
          <div className="flex-1 min-w-0">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
          {showEffortPill && (
            <KanbanChromeTooltip label={effortTooltip} wrapperClassName="relative inline-flex shrink-0 items-center">
              <span
                className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-violet-100 px-1.5 py-0.5 text-center text-[0.65rem] font-medium leading-none tabular-nums text-violet-700 dark:bg-violet-900/50 dark:text-violet-200"
                aria-label={effortTooltip}
              >
                {effortDisplay}
              </span>
            </KanbanChromeTooltip>
          )}
        </div>
      </div>
    </div>
  );
};

export default BoardMetrics;
