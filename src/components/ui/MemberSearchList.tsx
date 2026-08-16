import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Search, X } from 'lucide-react';
import type { TeamMember } from '../../types';
import { SYSTEM_MEMBER_ID } from '../../constants/appConstants';
import {
  isAgentMemberId,
  sortMembersAgentLast,
} from '../../utils/agentMemberUi';
import { truncateMemberName, memberIsViewer } from '../../utils/memberUtils';
import MemberAvatar from './MemberAvatar';

export interface MemberSearchListProps {
  members: TeamMember[];
  onSelect: (memberId: string) => void;
  /** Exclude members from the list (e.g. already watchers) */
  excludeIds?: string[];
  /** Highlight currently selected id (assignee/requester single pick) */
  selectedId?: string | null;
  /** Hide read-only viewers (assignee pickers). Still shows selectedId if it is a viewer. */
  excludeViewers?: boolean;
  /** Highlight agent in its own section */
  showAgentSection?: boolean;
  /** Auto-focus search on mount */
  autoFocus?: boolean;
  className?: string;
  /** Called when Escape is pressed in the search field */
  onEscape?: () => void;
  maxHeightClassName?: string;
  /** People grid; agent stays full-width under the list (no horizontal scroll). */
  columns?: 1 | 2;
}

function memberMatchesQuery(member: TeamMember, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const name = (member.name || '').toLowerCase();
  const email = (member.email || '').toLowerCase();
  return name.includes(q) || email.includes(q);
}

/**
 * Searchable member list with avatars (shared by MemberPicker and bulk menus).
 */
export default function MemberSearchList({
  members,
  onSelect,
  excludeIds = [],
  selectedId = null,
  excludeViewers = false,
  showAgentSection = true,
  autoFocus = true,
  className = '',
  onEscape,
  maxHeightClassName = 'max-h-[min(24rem,55vh)]',
  columns = 1,
}: MemberSearchListProps) {
  const { t } = useTranslation('tasks');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const exclude = new Set(excludeIds);
  const ordered = useMemo(
    () =>
      sortMembersAgentLast(
        members.filter((m) => {
          if (exclude.has(m.id)) return false;
          if (excludeViewers && memberIsViewer(m) && m.id !== selectedId) return false;
          return true;
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, excludeIds.join('|'), excludeViewers, selectedId]
  );

  const filtered = useMemo(
    () => ordered.filter((m) => memberMatchesQuery(m, searchTerm.trim())),
    [ordered, searchTerm]
  );

  const people = filtered.filter((m) => !isAgentMemberId(m.id));
  const agent = filtered.find((m) => isAgentMemberId(m.id));
  const hasAnyResults = people.length > 0 || Boolean(agent);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  const pick = (id: string) => {
    onSelect(id);
    setSearchTerm('');
  };

  const renderRow = (m: TeamMember) => {
    const isSelected = Boolean(selectedId && m.id === selectedId);
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => pick(m.id)}
        className={`w-full min-w-0 flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
          m.id === SYSTEM_MEMBER_ID ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''
        } ${
          isSelected
            ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-200 dark:ring-blue-700'
            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
      >
        <MemberAvatar member={m} size="sm" />
        <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
          <span className="block truncate">{truncateMemberName(m.name)}</span>
          {m.email && searchTerm.trim() && (
            <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">
              {m.email}
            </span>
          )}
        </span>
        {isSelected && (
          <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
        )}
      </button>
    );
  };

  return (
    <div
      className={`flex flex-col overflow-hidden bg-white dark:bg-gray-800 ${className}`}
      role="listbox"
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onEscape?.();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const first = people[0] || agent;
                if (first) pick(first.id);
              }
            }}
            placeholder={t('taskPage.searchMembers', {
              defaultValue: 'Search by name…',
            })}
            className="w-full pl-8 pr-8 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            aria-label={t('taskPage.searchMembers', {
              defaultValue: 'Search by name…',
            })}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full"
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
            >
              <X className="w-3 h-3 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      <div className={`overflow-y-auto overflow-x-hidden flex-1 min-h-0 p-1.5 ${maxHeightClassName}`}>
        {!hasAnyResults ? (
          <div className="px-3 py-3 text-sm text-gray-500 text-center">
            {searchTerm.trim()
              ? t('taskPage.noMembersFound', {
                  defaultValue: 'No matching people',
                })
              : t('taskPage.noMembersAvailable', {
                  defaultValue: 'No members available',
                })}
          </div>
        ) : (
          <div
            className={
              columns === 2 && people.length > 0
                ? 'grid grid-cols-2 gap-x-1'
                : 'flex flex-col'
            }
          >
            {people.map(renderRow)}
            {!showAgentSection && agent && (
              <div className={columns === 2 ? 'col-span-2' : undefined}>{renderRow(agent)}</div>
            )}
          </div>
        )}
      </div>
      {showAgentSection && agent && hasAnyResults && (
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-600 p-1.5 bg-white dark:bg-gray-800">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 px-2 mb-1">
            {t('toolbar.assignToAgentSection')}
          </div>
          {renderRow(agent)}
        </div>
      )}
    </div>
  );
}
