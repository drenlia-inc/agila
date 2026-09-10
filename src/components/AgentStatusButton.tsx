import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  Pause,
  Square,
  CheckCircle2,
  AlertCircle,
  Bot,
  MessageCircleQuestion,
  Undo2,
} from 'lucide-react';
import { KanbanChromeTooltip } from './KanbanChromeTooltip';

interface AgentStatusButtonProps {
  status: string | null | undefined;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  iconSize?: number;
}

export function AgentStatusIcon({
  status,
  size = 14,
}: {
  status: string | null | undefined;
  size?: number;
}) {
  switch (status) {
    case 'running':
    case 'queued':
      return <Loader2 size={size} className="text-teal-600 animate-spin" aria-hidden />;
    case 'paused':
      return <Pause size={size} className="text-amber-600" aria-hidden />;
    case 'waiting':
      // Distinct from MessageSquarePlus (add comment) — clearly “needs your input”
      return <MessageCircleQuestion size={size} className="text-amber-600" aria-hidden />;
    case 'stopped':
      return <Square size={size} className="text-gray-500 fill-gray-500/20" aria-hidden />;
    case 'done':
      return <CheckCircle2 size={size} className="text-teal-600" aria-hidden />;
    case 'undone':
      return <Undo2 size={size} className="text-gray-600" aria-hidden />;
    case 'failed':
      return <AlertCircle size={size} className="text-red-600" aria-hidden />;
    default:
      return <Bot size={size} className="text-teal-700" aria-hidden />;
  }
}

/** Shared agent status control (card toolbar + TaskDetails title). */
export default function AgentStatusButton({
  status,
  onClick,
  className = 'p-1 rounded hover:bg-teal-100 dark:hover:bg-teal-900/40',
  iconSize = 14,
}: AgentStatusButtonProps) {
  const { t } = useTranslation('common');
  const statusLabel = status
    ? t(`agent.status_${status}`, {
        defaultValue: `${t('agent.status')}: ${status}`,
      })
    : t('agent.statusIdle');
  const label = `${statusLabel} — ${t('agent.openActivity')}`;

  return (
    <KanbanChromeTooltip label={label} wrapperClassName="">
      <button
        type="button"
        data-no-dnd="true"
        data-agent-status-button="true"
        onClick={onClick}
        onMouseDown={(e) => e.stopPropagation()}
        className={className}
        aria-label={label}
      >
        <AgentStatusIcon status={status} size={iconSize} />
      </button>
    </KanbanChromeTooltip>
  );
}
