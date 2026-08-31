import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { AdminSearchEntry } from '../../constants/adminSearchIndex';
import {
  scrollToAdminEntity,
  scrollToAdminSetting,
  searchAdminAll,
  type AdminContentHit,
  type AdminSearchContentSources,
  type AdminSearchHit,
  type AdminUnifiedSearchHit,
} from '../../utils/adminSettingsSearch';

interface AdminSettingsSearchProps {
  activeTab: string;
  onNavigate: (tab: string, hash: string) => void;
  contentSources?: AdminSearchContentSources;
}

function isContentHit(hit: AdminUnifiedSearchHit): hit is AdminContentHit {
  return (
    hit.kind === 'user' ||
    hit.kind === 'tag' ||
    hit.kind === 'priority' ||
    hit.kind === 'settingValue'
  );
}

const AdminSettingsSearch: React.FC<AdminSettingsSearchProps> = ({
  activeTab,
  onNavigate,
  contentSources,
}) => {
  const { t } = useTranslation('admin');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(
    () =>
      query.trim()
        ? searchAdminAll(query, (key) => t(key), contentSources || {}, 12)
        : [],
    [query, t, contentSources]
  );

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
      const isModK =
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.key === 'k' || e.key === 'K');
      if (!isSlash && !isModK) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectHit = (entry: AdminSearchEntry | AdminSearchHit | AdminContentHit) => {
    setOpen(false);
    setQuery('');
    onNavigate(entry.tab, entry.hash);

    if (isContentHit(entry as AdminUnifiedSearchHit)) {
      const content = entry as AdminContentHit;
      window.setTimeout(() => {
        if (content.kind === 'user' && content.entityId) {
          scrollToAdminEntity('data-user-id', content.entityId);
        } else if (content.kind === 'tag' && content.entityId) {
          scrollToAdminEntity('data-tag-id', content.entityId);
        } else if (content.kind === 'priority' && content.entityId) {
          scrollToAdminEntity('data-priority-id', content.entityId);
        } else if (content.kind === 'settingValue' && content.settingKey) {
          scrollToAdminSetting(content.settingKey);
        }
      }, 80);
      return;
    }

    if (entry.settingKey) {
      // Allow tab mount + hash-driven sub-tab switch
      window.setTimeout(() => scrollToAdminSetting(entry.settingKey!), 80);
    }
  };

  const kindLabel = (hit: AdminUnifiedSearchHit): string => {
    switch (hit.kind) {
      case 'tab':
        return t('search.tab');
      case 'setting':
        return t('search.setting');
      case 'user':
        return t('search.user');
      case 'tag':
        return t('search.tag');
      case 'priority':
        return t('search.priority');
      case 'settingValue':
        return t('search.settingValue');
      default:
        return t('search.setting');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter') && query.trim()) {
      setOpen(true);
    }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[highlight];
      if (hit) selectHit(hit);
    }
  };

  return (
    <div ref={rootRef} className="relative w-full sm:w-64">
      <label className="sr-only" htmlFor="admin-settings-search">
        {t('search.placeholder')}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
        <input
          ref={inputRef}
          id="admin-settings-search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('search.placeholder')}
          className="w-full rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 py-1.5 pl-8 pr-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {open && query.trim() && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 max-h-72 w-[min(100vw-2rem,20rem)] overflow-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              {t('search.noResults')}
            </li>
          ) : (
            hits.map((hit, index) => (
              <li key={hit.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                    index === highlight
                      ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100'
                      : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/60'
                  }`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => selectHit(hit)}
                >
                  <span className="font-medium leading-tight">{hit.displayLabel}</span>
                  {hit.detail && (
                    <span className="text-xs text-gray-600 dark:text-gray-300 truncate max-w-full">
                      {hit.detail}
                    </span>
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {kindLabel(hit)}
                    {hit.tab !== activeTab
                      ? ` · ${t(`tabs.${tabLabelKey(hit.tab)}`)}`
                      : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

/** Map tab id → tabs.* i18n key suffix */
function tabLabelKey(tab: string): string {
  const map: Record<string, string> = {
    users: 'users',
    'site-settings': 'siteSettings',
    'system-settings': 'systemSettings',
    notifications: 'notifications',
    sso: 'sso',
    'mail-server': 'mailServer',
    'notification-settings': 'notificationSettings',
    queue: 'queue',
    storage: 'storage',
    tags: 'tags',
    priorities: 'priorities',
    'app-settings': 'appSettings',
    'project-settings': 'projectSettings',
    'sprint-settings': 'sprintSettings',
    reporting: 'reporting',
    lifecycle: 'lifecycle',
    licensing: 'licensing',
    'notification-queue': 'notificationQueue',
    'file-uploads': 'fileUploads',
    ai: 'ai',
  };
  return map[tab] || tab;
}

export default AdminSettingsSearch;
