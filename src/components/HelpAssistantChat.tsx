import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { postHelpAssistantChat, type HelpAssistantTarget } from '../api';

export type HelpAssistantUiMessage = {
  role: 'user' | 'assistant';
  content: string;
  target?: HelpAssistantTarget | null;
};

const USER_SUGGESTION_KEYS = [
  'help.assistant.suggestArchive',
  'help.assistant.suggestTrash',
  'help.assistant.suggestFeed',
  'help.assistant.suggestSoftWip',
  'help.assistant.suggestArchiveVsTrash',
] as const;

const ADMIN_SUGGESTION_KEYS = [
  'help.assistant.suggestArchive',
  'help.assistant.suggestTrash',
  'help.assistant.suggestColumnWip',
  'help.assistant.suggestCreateSprint',
  'help.assistant.suggestFeedDefault',
] as const;

type Props = {
  compact?: boolean;
  isAdmin?: boolean;
  language: 'en' | 'fr';
  messages: HelpAssistantUiMessage[];
  onMessagesChange: (next: HelpAssistantUiMessage[]) => void;
  onGoThere: (target: HelpAssistantTarget) => void;
  onInteract?: () => void;
};

export default function HelpAssistantChat({
  compact = false,
  isAdmin = false,
  language,
  messages,
  onMessagesChange,
  onGoThere,
  onInteract,
}: Props) {
  const { t } = useTranslation('common');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    onInteract?.();
    setError(null);
    setDraft('');
    const next: HelpAssistantUiMessage[] = [...messages, { role: 'user', content }];
    onMessagesChange(next);
    setBusy(true);
    try {
      const payloadMessages = next
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      const data = await postHelpAssistantChat({ language, messages: payloadMessages });
      onMessagesChange([
        ...next,
        {
          role: 'assistant',
          content: data.answer,
          target: data.target || null,
        },
      ]);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      const msg =
        status?.data?.error ||
        (status?.status === 403
          ? t('help.assistant.disabled')
          : t('help.assistant.error'));
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex flex-col min-h-0 h-full`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-2 px-1 py-1"
      >
        {messages.length === 0 && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800 px-2.5 py-2">
            <p className="text-sm font-medium text-slate-800 dark:text-gray-100 leading-snug">
              {t('help.assistant.intro')}
            </p>
          </div>
        )}
        {messages.length === 0 && !busy && (
          <div className="flex flex-wrap gap-1.5 px-0.5 pb-1">
            {(isAdmin ? ADMIN_SUGGESTION_KEYS : USER_SUGGESTION_KEYS).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void send(t(key))}
                className="text-xs px-2 py-1 rounded-full border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700"
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={`rounded-lg px-2.5 py-2 text-sm whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-blue-600 text-white ml-8'
                : 'bg-slate-100 dark:bg-gray-700 text-slate-800 dark:text-gray-100 mr-2'
            }`}
          >
            {m.content}
            {m.role === 'assistant' && m.target && (
              <button
                type="button"
                onClick={() => onGoThere(m.target as HelpAssistantTarget)}
                className="mt-2 block shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white/90 dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t('help.goThere')}
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="text-xs text-slate-500 dark:text-gray-400 px-1">
            {t('help.assistant.thinking')}
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 px-1 pb-1">{error}</p>
      )}
      <form
        className="flex items-end gap-1.5 pt-1 border-t border-slate-200 dark:border-gray-600 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor={compact ? 'help-assistant-input-min' : 'help-assistant-input'}>
          {t('help.assistant.placeholder')}
        </label>
        <textarea
          id={compact ? 'help-assistant-input-min' : 'help-assistant-input'}
          rows={compact ? 2 : 2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={t('help.assistant.placeholder')}
          className="flex-1 resize-none text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          aria-label={t('help.assistant.send')}
          title={t('help.assistant.send')}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
