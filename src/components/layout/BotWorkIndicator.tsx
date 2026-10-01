import React, { useCallback, useEffect, useState } from 'react';
import { Cable, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BotWorkItem, getBotWork } from '../../api';
import { KanbanChromeTooltip } from '../KanbanChromeTooltip';
import websocketClient from '../../services/websocketClient';

type BotWorkIndicatorProps = {
  selectedBoard?: string | null;
  onOpenTask?: (taskId: string) => void;
};

const BotWorkIndicator: React.FC<BotWorkIndicatorProps> = ({ selectedBoard, onOpenTask }) => {
  const { t } = useTranslation('common');
  const [items, setItems] = useState<BotWorkItem[] | null>(null);

  const load = useCallback(() => {
    getBotWork()
      .then((rows) => setItems(rows))
      .catch(() => setItems((current) => current ?? []));
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    websocketClient.onTaskUpdated(load);
    websocketClient.onTaskCreated(load);
    return () => {
      window.clearInterval(interval);
      websocketClient.offTaskUpdated(load);
      websocketClient.offTaskCreated(load);
    };
  }, [load]);

  const known = items !== null && Boolean(selectedBoard);
  const onThisBoard = known
    ? items.filter((item) => item.boardId === selectedBoard)
    : [];
  const working = onThisBoard.length > 0;

  const glyph = (
    <span
      className="relative inline-flex h-8 w-8 items-center justify-center overflow-visible rounded-full"
      aria-busy={!known}
      aria-label={known ? (working ? t('botWork.labelWorking') : t('botWork.labelIdle')) : undefined}
    >
      {known && working ? (
        <>
          <style>{`
            @keyframes apiCableFlash {
              0%, 100% { opacity: 0; transform: scale(0.7); }
              50% { opacity: 0.9; transform: scale(1); }
            }
          `}</style>
          <Cable className="relative z-10 h-4 w-4 text-sky-600 dark:text-sky-300" aria-hidden />
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 z-20 h-2 w-2 rounded-full bg-sky-500 dark:bg-sky-300"
            style={{ animation: 'apiCableFlash 2s ease-in-out infinite' }}
          />
        </>
      ) : known ? (
        <Unplug className="h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden />
      ) : null}
    </span>
  );

  if (!known) return glyph;

  return (
    <KanbanChromeTooltip
      label={working ? t('botWork.labelWorking') : t('botWork.labelIdle')}
      dismissOnLabelChange={false}
      delayMs={200}
      placement="bottom"
      interactive
      wrapperClassName="relative inline-flex overflow-visible"
      content={
        <div className="space-y-1 max-w-[16rem]">
          {working ? (
            onThisBoard.map((item) => (
              <p key={item.taskId}>
                {item.workerName || t('activityFeed.unknownUser')}
                {' · '}
                {item.ticket && onOpenTask ? (
                  <button
                    type="button"
                    className="font-medium text-sky-300 underline-offset-2 hover:underline dark:text-sky-700"
                    aria-label={t('activityFeed.jumpToTask', { ticket: item.ticket })}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenTask(item.taskId);
                    }}
                  >
                    {item.ticket}
                  </button>
                ) : (
                  item.ticket
                )}
                {item.taskTitle ? ` ${item.taskTitle}` : ''}
              </p>
            ))
          ) : (
            <p>{t('botWork.idle')}</p>
          )}
        </div>
      }
    >
      {glyph}
    </KanbanChromeTooltip>
  );
};

export default BotWorkIndicator;
