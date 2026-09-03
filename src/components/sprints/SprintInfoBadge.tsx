import React from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KanbanChromeTooltip } from '../KanbanChromeTooltip';

export type SprintInfoFields = {
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  goal?: string | null;
  description?: string | null;
  is_active?: boolean | number;
};

function formatSprintDate(value?: string | null): string {
  if (!value) return '—';
  const ymd = String(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!ymd) return String(value);
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(year, month - 1, day).toLocaleDateString();
}

const CLAMP_2_LINES = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
};

export default function SprintInfoBadge({
  sprint,
  ns = 'tasks',
}: {
  sprint: SprintInfoFields;
  ns?: 'tasks' | 'common';
}) {
  const { t } = useTranslation(ns);
  const goalKey = ns === 'common' ? 'reports.dateRangeSelector.goal' : 'sprintSelector.goal';
  const descKey = ns === 'common' ? 'reports.dateRangeSelector.description' : 'sprintSelector.description';
  const detailsKey = ns === 'common' ? 'reports.dateRangeSelector.sprintDetails' : 'sprintSelector.sprintDetails';
  const activeKey = ns === 'common' ? 'reports.dateRangeSelector.active' : 'sprintSelector.active';

  return (
    <KanbanChromeTooltip
      delayMs={0}
      maxWidth={320}
      content={
        <div className="space-y-1.5">
          <div className="font-semibold">
            {sprint.name}
            {(sprint.is_active === true || sprint.is_active === 1) && (
              <span className="ml-1.5 font-normal opacity-80">· {t(activeKey)}</span>
            )}
          </div>
          <div className="opacity-80">
            {formatSprintDate(sprint.start_date)} – {formatSprintDate(sprint.end_date)}
          </div>
          {sprint.goal ? (
            <div>
              <div className="opacity-70">{t(goalKey)}</div>
              <div className="whitespace-pre-wrap break-words">{sprint.goal}</div>
            </div>
          ) : null}
          {sprint.description ? (
            <div>
              <div className="opacity-70">{t(descKey)}</div>
              <div className="whitespace-pre-wrap break-words">{sprint.description}</div>
            </div>
          ) : null}
        </div>
      }
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        aria-label={t(detailsKey)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Info size={13} />
      </button>
    </KanbanChromeTooltip>
  );
}

export function sprintTextClampClass(extra = ''): string {
  return `break-words whitespace-normal ${extra}`;
}

export function sprintTextClampStyle(): React.CSSProperties {
  return CLAMP_2_LINES;
}
