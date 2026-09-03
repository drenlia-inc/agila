import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  getBoardParticipants,
  updateBoardParticipants,
  type BoardParticipantUser,
} from '../api';
import { toast } from '../utils/toast';
import type { AppRole } from '../utils/permissions';
import type { TeamMember } from '../types';
import MemberAvatar from './ui/MemberAvatar';
import { ModernCheckbox } from './ModernCheckbox';

function participantLabel(user: BoardParticipantUser): string {
  const name = (user.displayName || `${user.firstName || ''} ${user.lastName || ''}`).trim();
  return name || user.email;
}

function primaryRole(user: BoardParticipantUser): AppRole {
  const roles = user.roles || [];
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('user')) return 'user';
  if (roles.includes('viewer')) return 'viewer';
  return 'user';
}

function toAvatarMember(user: BoardParticipantUser): TeamMember {
  return {
    id: user.memberId || user.id,
    name: participantLabel(user),
    color: user.color || '#6B7280',
    user_id: user.id,
    avatarUrl: user.avatarUrl || undefined,
    googleAvatarUrl: user.googleAvatarUrl || undefined,
    isViewer: user.isViewer,
  };
}

function rangeBetween(ids: string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0) return [toId];
  const [start, end] = from < to ? [from, to] : [to, from];
  return ids.slice(start, end + 1);
}

function nextSelection(
  ids: string[],
  current: string[],
  clickedId: string,
  event: React.MouseEvent,
  anchorId: string | null
): string[] {
  if (event.shiftKey && anchorId && ids.includes(anchorId)) {
    return rangeBetween(ids, anchorId, clickedId);
  }
  if (event.ctrlKey || event.metaKey) {
    return current.includes(clickedId)
      ? current.filter((id) => id !== clickedId)
      : [...current, clickedId];
  }
  return [clickedId];
}

function moveListSelection(
  ids: string[],
  current: string[],
  delta: number,
  shiftKey: boolean,
  anchorId: string | null
): { next: string[]; cursor: string } | null {
  if (ids.length === 0) return null;
  const cursor = current[current.length - 1] || anchorId || ids[0];
  const from = Math.max(0, ids.indexOf(cursor));
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  const nextId = ids[to];
  if (shiftKey && anchorId) {
    return { next: rangeBetween(ids, anchorId, nextId), cursor: nextId };
  }
  return { next: [nextId], cursor: nextId };
}

function ParticipantRow({
  user,
  selected,
  onClick,
  onToggle,
  onDoubleClick,
}: {
  user: BoardParticipantUser;
  selected: boolean;
  onClick: (event: React.MouseEvent) => void;
  onToggle: () => void;
  onDoubleClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      role="option"
      aria-selected={selected}
      data-participant-id={user.id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left select-none ${
        selected
          ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100'
          : 'text-slate-700 hover:bg-slate-50 dark:text-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      <ModernCheckbox
        checked={selected}
        size="sm"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle()}
        aria-hidden
      />
      <MemberAvatar member={toAvatarMember(user)} size="md" showViewerBadge={false} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{participantLabel(user)}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-gray-400">{user.email}</span>
      </span>
    </button>
  );
}

export default function BoardParticipantsEditor({
  boardId,
  onSaved,
}: {
  boardId: string;
  onSaved?: (count: number) => void;
}) {
  const { t } = useTranslation('common');
  const [loading, setLoading] = useState(true);
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BoardParticipantUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [availableHighlight, setAvailableHighlight] = useState<string[]>([]);
  const [onBoardHighlight, setOnBoardHighlight] = useState<string[]>([]);
  const availableAnchorRef = useRef<string | null>(null);
  const onBoardAnchorRef = useRef<string | null>(null);
  const availableListRef = useRef<HTMLDivElement>(null);
  const onBoardListRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const [activePane, setActivePane] = useState<'available' | 'onBoard'>('available');

  useEffect(() => {
    initializedRef.current = false;
    let cancelled = false;
    setLoading(true);
    getBoardParticipants(boardId)
      .then((data) => {
        if (cancelled) return;
        const incoming = data.candidates || [];
        const participants = data.participants || [];
        const merged = [...incoming];
        for (const user of participants) {
          if (!merged.some((row) => row.id === user.id)) merged.push(user);
        }
        setCandidates(merged.length > 0 ? merged : participants);
        setSelectedIds(participants.map((p) => p.id));
        setLoadedBoardId(boardId);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('boardParticipants.loadFailed'), '');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, t]);

  useEffect(() => {
    if (selectedIds.length > 0) setSaveError(null);
  }, [selectedIds.length]);

  const byId = useMemo(() => {
    const map = new Map<string, BoardParticipantUser>();
    for (const user of candidates) map.set(user.id, user);
    return map;
  }, [candidates]);

  const available = candidates.filter((user) => !selectedIds.includes(user.id));
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean) as BoardParticipantUser[];
  const onBoardGroups = useMemo(() => {
    const groups: { role: AppRole; users: BoardParticipantUser[] }[] = [
      { role: 'admin', users: [] },
      { role: 'user', users: [] },
      { role: 'viewer', users: [] },
    ];
    for (const user of selected) {
      const role = primaryRole(user);
      const group = groups.find((item) => item.role === role);
      group?.users.push(user);
    }
    return groups.filter((group) => group.users.length > 0);
  }, [selected]);
  const availableIds = available.map((user) => user.id);
  const onBoardIds = onBoardGroups.flatMap((group) => group.users.map((user) => user.id));

  useEffect(() => {
    if (loading || loadedBoardId !== boardId || initializedRef.current) return;
    initializedRef.current = true;
    if (availableIds.length > 0) {
      setActivePane('available');
      setAvailableHighlight([availableIds[0]]);
      availableAnchorRef.current = availableIds[0];
      requestAnimationFrame(() => availableListRef.current?.focus());
      return;
    }
    if (onBoardIds.length > 0) {
      setActivePane('onBoard');
      setOnBoardHighlight([onBoardIds[0]]);
      onBoardAnchorRef.current = onBoardIds[0];
      requestAnimationFrame(() => onBoardListRef.current?.focus());
    }
  }, [loading, loadedBoardId, boardId, availableIds, onBoardIds]);

  const scrollRowIntoView = (list: HTMLElement | null, id: string | null) => {
    if (!list || !id) return;
    const row = list.querySelector(`[data-participant-id="${CSS.escape(id)}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest' });
    }
  };

  const addHighlighted = () => {
    if (availableHighlight.length === 0) return;
    const moving = availableHighlight.filter((id) => availableIds.includes(id));
    setSelectedIds((prev) => [...prev, ...moving.filter((id) => !prev.includes(id))]);
    const remaining = availableIds.filter((id) => !moving.includes(id));
    setAvailableHighlight(remaining[0] ? [remaining[0]] : []);
    availableAnchorRef.current = remaining[0] ?? null;
    if (remaining.length === 0 && moving.length > 0) {
      setActivePane('onBoard');
      setOnBoardHighlight(moving);
      onBoardAnchorRef.current = moving[0] ?? null;
      requestAnimationFrame(() => onBoardListRef.current?.focus());
    }
  };

  const removeHighlighted = () => {
    if (onBoardHighlight.length === 0) return;
    const moving = onBoardHighlight.filter((id) => onBoardIds.includes(id));
    setSelectedIds((prev) => prev.filter((id) => !moving.includes(id)));
    const remaining = onBoardIds.filter((id) => !moving.includes(id));
    setOnBoardHighlight(remaining[0] ? [remaining[0]] : []);
    onBoardAnchorRef.current = remaining[0] ?? null;
    if (remaining.length === 0 && moving.length > 0) {
      setActivePane('available');
      setAvailableHighlight(moving);
      availableAnchorRef.current = moving[0] ?? null;
      requestAnimationFrame(() => availableListRef.current?.focus());
    }
  };

  const handlePaneKeyDown = (pane: 'available' | 'onBoard', event: React.KeyboardEvent) => {
    const ids = pane === 'available' ? availableIds : onBoardIds;
    const current = pane === 'available' ? availableHighlight : onBoardHighlight;
    const setHighlight = pane === 'available' ? setAvailableHighlight : setOnBoardHighlight;
    const anchorRef = pane === 'available' ? availableAnchorRef : onBoardAnchorRef;
    const listRef = pane === 'available' ? availableListRef : onBoardListRef;
    const isMod = event.metaKey || event.ctrlKey;

    if (isMod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      if (ids.length === 0) return;
      setHighlight(ids);
      anchorRef.current = ids[0];
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const moved = moveListSelection(
        ids,
        current,
        event.key === 'ArrowDown' ? 1 : -1,
        event.shiftKey,
        anchorRef.current
      );
      if (!moved) return;
      if (!event.shiftKey) anchorRef.current = moved.cursor;
      setHighlight(moved.next);
      scrollRowIntoView(listRef.current, moved.cursor);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
      if (!target) return;
      const next = event.shiftKey && anchorRef.current
        ? rangeBetween(ids, anchorRef.current, target)
        : [target];
      if (!event.shiftKey) anchorRef.current = target;
      setHighlight(next);
      scrollRowIntoView(listRef.current, target);
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      const id = current[current.length - 1] || anchorRef.current;
      if (!id) return;
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      setHighlight(next);
      anchorRef.current = id;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (pane === 'available') addHighlighted();
      else removeHighlighted();
    }
  };

  const toggleId = (
    pane: 'available' | 'onBoard',
    id: string
  ) => {
    const current = pane === 'available' ? availableHighlight : onBoardHighlight;
    const setHighlight = pane === 'available' ? setAvailableHighlight : setOnBoardHighlight;
    const anchorRef = pane === 'available' ? availableAnchorRef : onBoardAnchorRef;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    setHighlight(next);
    anchorRef.current = id;
  };

  const setPaneSelection = (pane: 'available' | 'onBoard', ids: string[]) => {
    if (pane === 'available') {
      setAvailableHighlight(ids);
      availableAnchorRef.current = ids[0] ?? null;
      return;
    }
    setOnBoardHighlight(ids);
    onBoardAnchorRef.current = ids[0] ?? null;
  };

  const handleSave = async () => {
    if (selectedIds.length === 0) {
      setSaveError(t('boardParticipants.minOne'));
      setActivePane('onBoard');
      onBoardListRef.current?.focus();
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      const data = await updateBoardParticipants(boardId, selectedIds);
      toast.success(t('boardParticipants.saved'), '');
      onSaved?.(data.participantCount);
    } catch {
      toast.error(t('boardParticipants.saveFailed'), '');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('boardParticipants.loading')}
      </div>
    );
  }

  const listClass = (pane: 'available' | 'onBoard') =>
    `h-64 w-full overflow-y-auto rounded-lg border bg-white text-sm outline-none dark:bg-gray-800 ${
      pane === 'onBoard' && saveError
        ? 'border-red-400 ring-2 ring-red-200 dark:border-red-500 dark:ring-red-900/40'
        : activePane === pane
          ? 'border-blue-400 ring-2 ring-blue-200 dark:border-blue-500 dark:ring-blue-900/50'
          : 'border-slate-200 dark:border-gray-600'
    }`;

  const groupLabel = (role: AppRole) =>
    role === 'admin'
      ? t('boardParticipants.groupAdmins')
      : role === 'viewer'
        ? t('boardParticipants.groupViewers')
        : t('boardParticipants.groupUsers');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <ModernCheckbox
              checked={availableIds.length > 0 && availableHighlight.length === availableIds.length}
              indeterminate={
                availableHighlight.length > 0 && availableHighlight.length < availableIds.length
              }
              size="sm"
              disabled={availableIds.length === 0}
              onChange={() =>
                setPaneSelection(
                  'available',
                  availableHighlight.length === availableIds.length ? [] : availableIds
                )
              }
              aria-label={
                availableHighlight.length === availableIds.length && availableIds.length > 0
                  ? t('boardParticipants.clearSelection')
                  : t('boardParticipants.selectAll')
              }
            />
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('boardParticipants.available')}
            </div>
          </div>
          <div
            ref={availableListRef}
            className={listClass('available')}
            role="listbox"
            tabIndex={0}
            aria-multiselectable="true"
            aria-label={t('boardParticipants.available')}
            aria-keyshortcuts="Control+A Meta+A"
            onFocus={() => setActivePane('available')}
            onKeyDown={(event) => handlePaneKeyDown('available', event)}
          >
            {available.map((user) => (
              <ParticipantRow
                key={user.id}
                user={user}
                selected={availableHighlight.includes(user.id)}
                onToggle={() => {
                  setActivePane('available');
                  toggleId('available', user.id);
                  availableListRef.current?.focus();
                }}
                onClick={(event) => {
                  setActivePane('available');
                  const next = nextSelection(
                    availableIds,
                    availableHighlight,
                    user.id,
                    event,
                    availableAnchorRef.current
                  );
                  if (!event.shiftKey) availableAnchorRef.current = user.id;
                  setAvailableHighlight(next);
                  availableListRef.current?.focus();
                }}
                onDoubleClick={() => {
                  setSelectedIds((prev) => (prev.includes(user.id) ? prev : [...prev, user.id]));
                  setAvailableHighlight((prev) => prev.filter((id) => id !== user.id));
                }}
              />
            ))}
            {available.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-400">
                {t('boardParticipants.noneAvailable')}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={addHighlighted}
            disabled={availableHighlight.length === 0}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            aria-label={t('boardParticipants.add')}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={removeHighlighted}
            disabled={onBoardHighlight.length === 0}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            aria-label={t('boardParticipants.remove')}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <ModernCheckbox
              checked={onBoardIds.length > 0 && onBoardHighlight.length === onBoardIds.length}
              indeterminate={
                onBoardHighlight.length > 0 && onBoardHighlight.length < onBoardIds.length
              }
              size="sm"
              disabled={onBoardIds.length === 0}
              onChange={() =>
                setPaneSelection(
                  'onBoard',
                  onBoardHighlight.length === onBoardIds.length ? [] : onBoardIds
                )
              }
              aria-label={
                onBoardHighlight.length === onBoardIds.length && onBoardIds.length > 0
                  ? t('boardParticipants.clearSelection')
                  : t('boardParticipants.selectAll')
              }
            />
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('boardParticipants.onBoard')}
            </div>
          </div>
          <div
            ref={onBoardListRef}
            className={listClass('onBoard')}
            role="listbox"
            tabIndex={0}
            aria-multiselectable="true"
            aria-label={t('boardParticipants.onBoard')}
            aria-keyshortcuts="Control+A Meta+A"
            onFocus={() => setActivePane('onBoard')}
            onKeyDown={(event) => handlePaneKeyDown('onBoard', event)}
          >
            {onBoardGroups.map((group) => (
              <div key={group.role}>
                <div className="sticky top-0 z-[1] bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-gray-700/90 dark:text-gray-300">
                  {groupLabel(group.role)}
                </div>
                {group.users.map((user) => (
                  <ParticipantRow
                    key={user.id}
                    user={user}
                    selected={onBoardHighlight.includes(user.id)}
                    onToggle={() => {
                      setActivePane('onBoard');
                      toggleId('onBoard', user.id);
                      onBoardListRef.current?.focus();
                    }}
                    onClick={(event) => {
                      setActivePane('onBoard');
                      const next = nextSelection(
                        onBoardIds,
                        onBoardHighlight,
                        user.id,
                        event,
                        onBoardAnchorRef.current
                      );
                      if (!event.shiftKey) onBoardAnchorRef.current = user.id;
                      setOnBoardHighlight(next);
                      onBoardListRef.current?.focus();
                    }}
                    onDoubleClick={() => {
                      setSelectedIds((prev) => prev.filter((id) => id !== user.id));
                      setOnBoardHighlight((prev) => prev.filter((id) => id !== user.id));
                    }}
                  />
                ))}
              </div>
            ))}
            {onBoardGroups.length === 0 && (
              <div
                className={`px-3 py-6 text-center text-xs ${
                  saveError ? 'text-red-600 dark:text-red-400' : 'text-slate-400'
                }`}
              >
                {saveError || t('boardParticipants.noneOnBoard')}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        {saveError ? (
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {saveError}
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex shrink-0 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? t('boardParticipants.saving') : t('boardParticipants.save')}
        </button>
      </div>
    </div>
  );
}
