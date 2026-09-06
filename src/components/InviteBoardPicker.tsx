import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { formInputEditableParts, formPickerShellClass } from '../utils/formFieldClasses';
import type { FormFieldSurface } from '../utils/formFieldClasses';
import type { InviteBoardOption } from '../utils/inviteBoardIds';
import { liveInviteBoards } from '../utils/inviteBoardIds';
import { MODAL_OVERLAY_Z_INDEX } from '../constants/appConstants';

type InviteBoardPickerProps = {
  boards: InviteBoardOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  surface?: FormFieldSurface;
  compact?: boolean;
  id?: string;
};

/** Keep this much viewport below (or above) the menu. */
const VIEWPORT_GUTTER_PX = 160;

type MenuBox = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function menuLayout(rect: DOMRect): MenuBox {
  const gap = 4;
  const lo = VIEWPORT_GUTTER_PX;
  const hi = window.innerHeight - VIEWPORT_GUTTER_PX;
  const availBelow = hi - (rect.bottom + gap);
  const availAbove = rect.top - gap - lo;
  const openDown = availBelow >= availAbove;
  const maxHeight = Math.max(80, openDown ? availBelow : availAbove);
  if (openDown) {
    return {
      top: rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  }
  return {
    bottom: window.innerHeight - rect.top + gap,
    left: rect.left,
    width: rect.width,
    maxHeight,
  };
}

function scrollRowInsideMenu(menu: HTMLElement, row: HTMLElement) {
  const top = row.offsetTop - (menu.clientHeight - row.offsetHeight) / 2;
  const max = Math.max(0, menu.scrollHeight - menu.clientHeight);
  menu.scrollTop = Math.min(max, Math.max(0, top));
}

export default function InviteBoardPicker({
  boards,
  selectedIds,
  onChange,
  disabled = false,
  invalid = false,
  surface = 'panel',
  compact = false,
  id,
}: InviteBoardPickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const revealSelectedRef = useRef(false);
  const live = useMemo(() => liveInviteBoards(boards), [boards]);

  const updateMenuBox = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setMenuBox(menuLayout(trigger.getBoundingClientRect()));
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null);
      return;
    }
    updateMenuBox();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onReposition = () => updateMenuBox();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !menuBox || !revealSelectedRef.current) return;
    const selectedId = selectedIds[0];
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      revealSelectedRef.current = false;
      if (!selectedId) return;
      const row = menu.querySelector(`[data-invite-board-id="${CSS.escape(selectedId)}"]`);
      if (row instanceof HTMLElement) {
        scrollRowInsideMenu(menu, row);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, menuBox, selectedIds]);

  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) {
      return t('navigation.inviteBoardsPlaceholder');
    }
    if (selectedIds.length === 1) {
      const title = live.find((board) => board.id === selectedIds[0])?.title;
      return title || t('navigation.inviteBoardsPlaceholder');
    }
    return t('navigation.inviteBoardsSelected', { count: selectedIds.length });
  }, [live, selectedIds, t]);

  const toggle = (boardId: string) => {
    if (disabled) return;
    if (selectedIds.includes(boardId)) {
      onChange(selectedIds.filter((id) => id !== boardId));
      return;
    }
    onChange([...selectedIds, boardId]);
  };

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className={compact ? 'sr-only' : 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'}>
        {t('navigation.inviteBoards')}
      </label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled || live.length === 0}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        onClick={() => {
          if (disabled || live.length === 0) return;
          setOpen((prev) => {
            const next = !prev;
            if (next) revealSelectedRef.current = true;
            return next;
          });
        }}
        className={`${formPickerShellClass(disabled || live.length === 0, surface)} ${
          compact ? 'py-1.5 text-sm' : ''
        } ${
          invalid
            ? 'border-red-400 ring-2 ring-red-200 dark:border-red-500 dark:ring-red-900/40'
            : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && live.length > 0 && menuBox &&
        createPortal(
          <div
            ref={menuRef}
            data-invite-board-menu="true"
            className={`overflow-y-auto overscroll-contain rounded-md border shadow-lg ${formInputEditableParts(surface)} border-gray-200 dark:border-gray-600`}
            style={{
              position: 'fixed',
              top: menuBox.top,
              bottom: menuBox.bottom,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
              zIndex: MODAL_OVERLAY_Z_INDEX + 20,
            }}
            role="listbox"
            aria-multiselectable="true"
            aria-label={t('navigation.inviteBoards')}
          >
            {live.map((board) => {
              const selected = selectedIds.includes(board.id);
              return (
                <button
                  key={board.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-invite-board-id={board.id}
                  onClick={() => toggle(board.id)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
                    selected
                      ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {selected ? <Check size={14} className="text-blue-600 dark:text-blue-400" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{board.title || board.id}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
      {live.length === 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('navigation.inviteNoBoards')}</p>
      )}
    </div>
  );
}
