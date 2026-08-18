import React from 'react';
import { useTranslation } from 'react-i18next';

interface GanttLegendProps {
  priorities: Array<{ id: string; priority: string; color: string }>;
  className?: string;
}

const SWATCH_CLASS =
  'w-2.5 h-2.5 rounded-sm shrink-0 border border-gray-200/80 dark:border-gray-600/80';

const LegendEntry: React.FC<{
  label: string;
  swatchClassName?: string;
  swatchStyle?: React.CSSProperties;
  labelClassName?: string;
}> = ({ label, swatchClassName = '', swatchStyle, labelClassName = '' }) => (
  <span className="inline-flex items-center gap-1 shrink-0">
    <span className={`${SWATCH_CLASS} ${swatchClassName}`} style={swatchStyle} aria-hidden />
    <span className={labelClassName}>{label}</span>
  </span>
);

/** Single-line legend for the Gantt header top row. */
export const GanttLegend: React.FC<GanttLegendProps> = ({ priorities, className = '' }) => {
  const { t } = useTranslation('common');

  return (
    <div
      className={`flex flex-nowrap items-center justify-end gap-x-3 text-[10px] leading-none text-gray-500 dark:text-gray-400 whitespace-nowrap ${className}`}
      aria-label={t('gantt.legendAriaLabel')}
    >
      <div className="flex items-center gap-x-3 shrink-0">
        <LegendEntry
          label={t('gantt.today')}
          swatchClassName="bg-blue-100 dark:bg-blue-900 border-blue-200 dark:border-blue-700"
          labelClassName="text-blue-600 dark:text-blue-400 font-medium"
        />
        <LegendEntry
          label={t('gantt.weekends')}
          swatchClassName="bg-gray-100 dark:bg-gray-700"
        />
      </div>

      {priorities.length > 0 && (
        <>
          <span
            className="mx-2 h-3.5 w-px shrink-0 bg-gray-400 dark:bg-gray-500"
            role="separator"
            aria-hidden
          />
          <div className="flex items-center gap-x-3 min-w-0">
            <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300">
              {t('gantt.priority')}:
            </span>
            {priorities.map((priority) => (
              <LegendEntry
                key={priority.id}
                label={priority.priority}
                swatchStyle={{ backgroundColor: priority.color }}
                labelClassName="capitalize"
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
