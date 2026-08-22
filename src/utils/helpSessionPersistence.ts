/**
 * Persist Help open/minimized (and optional tab/scroll) for the current browser tab.
 * sessionStorage survives refresh; clear on logout so it does not follow the next login.
 */

import type { ViewMode } from './userPreferences';

const KEY_PREFIX = 'easy-kanban-help-session:';

export type HelpAssistantPersistedMessage = {
  role: 'user' | 'assistant';
  content: string;
  target?: {
    kind: 'admin' | 'view' | 'page';
    hash?: string;
    mode?: ViewMode;
    page?: 'kanban' | 'reports';
    profileFocus?: string;
    highlights?: string[];
  } | null;
};

export type HelpSessionState = {
  open: boolean;
  minimized: boolean;
  activeTab?: string;
  scrollByTab?: Partial<Record<string, number>>;
  assistantOpen?: boolean;
  assistantMessages?: HelpAssistantPersistedMessage[];
  assistantPositionX?: number | null;
  assistantHeight?: number;
};

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadHelpSession(userId: string): HelpSessionState | null {
  if (!userId || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HelpSessionState>;
    if (typeof parsed?.open !== 'boolean') return null;
    const assistantMessages = Array.isArray(parsed.assistantMessages)
      ? parsed.assistantMessages
          .filter(
            (m): m is HelpAssistantPersistedMessage =>
              !!m &&
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string'
          )
          .slice(-20)
      : undefined;
    return {
      open: parsed.open,
      minimized: Boolean(parsed.minimized),
      activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : undefined,
      scrollByTab:
        parsed.scrollByTab && typeof parsed.scrollByTab === 'object'
          ? parsed.scrollByTab
          : undefined,
      assistantOpen: Boolean(parsed.assistantOpen),
      assistantMessages,
      assistantPositionX:
        typeof parsed.assistantPositionX === 'number' ? parsed.assistantPositionX : undefined,
      assistantHeight:
        typeof parsed.assistantHeight === 'number' ? parsed.assistantHeight : undefined,
    };
  } catch {
    return null;
  }
}

export function saveHelpSession(userId: string, state: HelpSessionState): void {
  if (!userId || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

/** Clear one user's help session, or all help session keys when userId is omitted. */
export function clearHelpSession(userId?: string | null): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (userId) {
      sessionStorage.removeItem(storageKey(userId));
      return;
    }
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) toRemove.push(key);
    }
    toRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // ignore
  }
}
