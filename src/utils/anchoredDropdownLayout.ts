export type AnchoredDropdownLayout = {
  left: number;
  /** Set when placement is below the trigger. */
  top?: number;
  /** Set when placement is above the trigger (avoids gap from maxHeight vs content height). */
  bottom?: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
};

/**
 * Viewport-aware fixed dropdown placement for triggers inside scroll/overflow panels.
 */
export function layoutAnchoredDropdown(opts: {
  anchor: DOMRect;
  width?: number;
  preferredMaxHeight?: number;
  gap?: number;
  margin?: number;
}): AnchoredDropdownLayout {
  const margin = opts.margin ?? 8;
  const gap = opts.gap ?? 4;
  const width = Math.min(opts.width ?? anchor.width, window.innerWidth - margin * 2);
  const preferredMaxHeight = opts.preferredMaxHeight ?? 320;

  let left = opts.width != null ? opts.anchor.left : opts.anchor.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  const spaceBelow = window.innerHeight - opts.anchor.bottom - margin;
  const spaceAbove = opts.anchor.top - margin;
  const openBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;

  const maxHeight = Math.min(
    preferredMaxHeight,
    Math.max(120, (openBelow ? spaceBelow : spaceAbove) - gap)
  );

  if (openBelow) {
    const top = Math.max(margin, Math.min(opts.anchor.bottom + gap, window.innerHeight - maxHeight - margin));
    return {
      left,
      top,
      width,
      maxHeight,
      placement: 'below',
    };
  }

  // Anchor bottom edge to trigger top so short menus sit flush (no maxHeight gap).
  const bottom = window.innerHeight - opts.anchor.top + gap;

  return {
    left,
    bottom,
    width,
    maxHeight,
    placement: 'above',
  };
}
