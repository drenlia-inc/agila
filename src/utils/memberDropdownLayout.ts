import type { TeamMember } from '../types';
import { isAgentMemberId } from './agentMemberUi';
import { memberIsInactive, memberIsViewer } from './memberUtils';

const MARGIN = 12;
const SEARCH_H = 56;
const AGENT_H = 76;
const ROW_H = 40;
const COL1_W = 280;
const COL2_W = 520;

export type MemberDropdownLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
  columns: 1 | 2;
};

export function countAssigneePeople(
  members: TeamMember[],
  opts?: { excludeViewers?: boolean; excludeInactive?: boolean; selectedId?: string | null }
): number {
  return members.filter((m) => {
    if (isAgentMemberId(m.id)) return false;
    if (opts?.excludeViewers && memberIsViewer(m) && m.id !== opts.selectedId) return false;
    if (
      opts?.excludeInactive !== false &&
      memberIsInactive(m) &&
      !isAgentMemberId(m.id) &&
      m.id !== opts.selectedId
    ) {
      return false;
    }
    return true;
  }).length;
}

/**
 * Viewport-aware assignee menu: grow vertically first, then two columns.
 * Overflow is always vertical — never horizontal scroll.
 */
export function layoutMemberDropdown(opts: {
  anchor: DOMRect;
  peopleCount: number;
  showAgent: boolean;
  /** Card/list: below the trigger. Bulk bar: beside. */
  placement?: 'below' | 'beside';
  extraChrome?: number;
}): MemberDropdownLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const extra = opts.extraChrome ?? 0;
  const chrome = SEARCH_H + extra + (opts.showAgent ? AGENT_H : 0);
  const content1 = chrome + Math.max(opts.peopleCount, 1) * ROW_H;

  const spaceBelow = vh - opts.anchor.bottom - MARGIN;
  const spaceAbove = opts.anchor.top - MARGIN;
  const openDown = opts.placement !== 'beside' && (spaceBelow >= 240 || spaceBelow >= spaceAbove);
  const maxH =
    opts.placement === 'beside'
      ? Math.max(220, vh - 2 * MARGIN)
      : Math.max(200, openDown ? spaceBelow : spaceAbove);

  const canFitTwoCols = vw >= COL2_W + 2 * MARGIN;
  const heightTight = maxH < content1 - 8;
  const manyPeople = opts.peopleCount >= 5;
  const columns: 1 | 2 = canFitTwoCols && heightTight && manyPeople ? 2 : 1;

  const width = columns === 2 ? Math.min(COL2_W, vw - 2 * MARGIN) : COL1_W;
  const rows = columns === 2 ? Math.ceil(opts.peopleCount / 2) : opts.peopleCount;
  const desired = chrome + Math.min(Math.max(rows, 4), 14) * ROW_H;
  const height = Math.min(maxH, Math.max(220, desired));

  let left: number;
  let top: number;

  if (opts.placement === 'beside') {
    const preferredLeft = opts.anchor.right + 6;
    left =
      preferredLeft + width <= vw - MARGIN
        ? preferredLeft
        : Math.max(MARGIN, opts.anchor.left - width - 6);
    top = Math.max(MARGIN, Math.min(opts.anchor.top, vh - height - MARGIN));
  } else {
    left = opts.anchor.left;
    if (left + width > vw - MARGIN) left = Math.max(MARGIN, vw - width - MARGIN);
    if (left < MARGIN) left = MARGIN;
    top = openDown ? opts.anchor.bottom + 4 : opts.anchor.top - height - 4;
    if (top < MARGIN) top = MARGIN;
    if (top + height > vh - MARGIN) top = Math.max(MARGIN, vh - height - MARGIN);
  }

  return { left, top, width, height, columns };
}

export function layoutMemberDropdownFromElement(
  el: HTMLElement,
  members: TeamMember[],
  opts?: {
    showAgent?: boolean;
    excludeViewers?: boolean;
    excludeInactive?: boolean;
    selectedId?: string | null;
    placement?: 'below' | 'beside';
    extraChrome?: number;
  }
): MemberDropdownLayout {
  return layoutMemberDropdown({
    anchor: el.getBoundingClientRect(),
    peopleCount: countAssigneePeople(members, {
      excludeViewers: opts?.excludeViewers,
      excludeInactive: opts?.excludeInactive,
      selectedId: opts?.selectedId,
    }),
    showAgent: opts?.showAgent !== false,
    placement: opts?.placement,
    extraChrome: opts?.extraChrome,
  });
}
