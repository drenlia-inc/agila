import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { TeamMember } from '../../types';
import { truncateMemberName } from '../../utils/memberUtils';
import { layoutMemberDropdownFromElement, type MemberDropdownLayout } from '../../utils/memberDropdownLayout';
import MemberAvatar from './MemberAvatar';
import MemberSearchList from './MemberSearchList';

export interface MemberPickerProps {
  members: TeamMember[];
  /** Selected member id (single mode) */
  value?: string | null;
  onChange: (memberId: string | null) => void;
  /** Exclude members from the list (e.g. already watchers) */
  excludeIds?: string[];
  /**
   * single — trigger shows current member (assignee/requester)
   * add — trigger is a placeholder; selecting fires onChange (watchers/collaborators)
   */
  mode?: 'single' | 'add';
  placeholder?: string;
  label?: string;
  /**
   * Read-only display: full-contrast value, no chevron / menu.
   * Prefer this over washing out the control with opacity.
   */
  disabled?: boolean;
  className?: string;
  /** Highlight agent in its own section (default true for single) */
  showAgentSection?: boolean;
  /** Hide read-only viewers from assignee lists */
  excludeViewers?: boolean;
  /** Show clear/unassign row (assignee pickers) */
  allowClear?: boolean;
}

/**
 * Dropdown member picker with avatars + type-to-search (Task Page / shared UX).
 */
export default function MemberPicker({
  members,
  value = null,
  onChange,
  excludeIds = [],
  mode = 'single',
  placeholder,
  label,
  disabled = false,
  className = '',
  showAgentSection,
  excludeViewers = false,
  allowClear = false,
}: MemberPickerProps) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<MemberDropdownLayout | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const preferAgentSection = showAgentSection ?? mode === 'single';
  const selected = value ? members.find((m) => m.id === value) : undefined;

  const close = () => setOpen(false);

  const measure = () => {
    const el = triggerRef.current;
    if (!el) return;
    setLayout(
      layoutMemberDropdownFromElement(el, members, {
        showAgent: preferAgentSection,
        excludeViewers,
        selectedId: mode === 'single' ? value : null,
        placement: 'below',
        extraChrome: allowClear && mode === 'single' ? 44 : 0,
      })
    );
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, members, preferAgentSection, excludeViewers, value, mode, allowClear]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onWin = () => measure();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [open, members, preferAgentSection, excludeViewers, value, mode]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = (id: string | null) => {
    onChange(id);
    close();
  };

  const triggerLabel =
    mode === 'add'
      ? placeholder || t('taskPage.addWatcher', { defaultValue: 'Add…' })
      : selected
        ? truncateMemberName(selected.name)
        : placeholder ||
          (allowClear
            ? t('taskCard.noAssignee')
            : t('labels.selectMember', { defaultValue: 'Select member' }));

  const shellClass =
    'w-full flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';

  // Read-only: same chrome and contrast as editable, without picker affordances.
  if (disabled) {
    return (
      <div className={`relative ${className}`} ref={rootRef}>
        {label && (
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {label}
          </label>
        )}
        <div
          className={`${shellClass} cursor-default`}
          aria-readonly="true"
        >
          {mode === 'single' && (
            <MemberAvatar member={selected} memberId={value} members={members} size="sm" />
          )}
          <span
            className={`flex-1 text-left truncate ${
              mode === 'add' || !selected ? 'text-gray-500 dark:text-gray-400' : ''
            }`}
          >
            {triggerLabel}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      {label && (
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        className={`${shellClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          open ? 'ring-2 ring-blue-500 border-blue-500' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {mode === 'single' && (
          <MemberAvatar member={selected} memberId={value} members={members} size="sm" />
        )}
        <span
          className={`flex-1 text-left truncate ${
            mode === 'add' || !selected ? 'text-gray-500 dark:text-gray-400' : ''
          }`}
        >
          {triggerLabel}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        layout &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[80] rounded-lg border border-gray-200 dark:border-gray-600 shadow-lg overflow-hidden flex flex-col bg-white dark:bg-gray-800"
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              maxHeight: layout.height,
            }}
          >
            <MemberSearchList
              members={members}
              excludeIds={excludeIds}
              selectedId={mode === 'single' ? value : null}
              showAgentSection={preferAgentSection}
              excludeViewers={excludeViewers}
              allowClear={allowClear && mode === 'single'}
              columns={layout.columns}
              onSelect={pick}
              onEscape={close}
              maxHeightClassName="max-h-none"
              className="min-h-0 flex-1"
            />
          </div>,
          document.body
        )}
    </div>
  );
}
