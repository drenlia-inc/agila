import React, { useCallback, useState } from 'react';
import { setPerfTestsUserPreference } from './preference';

type PerfOverlayHeaderProps = {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * Shared PERF TESTS chrome: expand on header click when collapsed; Disable matches
 * Admin → App Settings → Troubleshooting → Performance Test Overlay.
 */
export function PerfOverlayHeader({
  title,
  collapsed,
  onCollapsedChange,
}: PerfOverlayHeaderProps) {
  const [disabling, setDisabling] = useState(false);

  const expand = useCallback(() => {
    onCollapsedChange(false);
  }, [onCollapsedChange]);

  const toggleCollapsed = useCallback(() => {
    onCollapsedChange(!collapsed);
  }, [collapsed, onCollapsedChange]);

  const handleDisable = useCallback(async () => {
    if (disabling) return;
    setDisabling(true);
    try {
      await setPerfTestsUserPreference(false);
    } catch (err) {
      console.error('Failed to disable Performance Test Overlay:', err);
      setDisabling(false);
    }
  }, [disabling]);

  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 rounded-t-lg ${
        collapsed ? 'cursor-pointer' : ''
      }`}
      onClick={collapsed ? expand : undefined}
      onKeyDown={
        collapsed
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                expand();
              }
            }
          : undefined
      }
      role={collapsed ? 'button' : undefined}
      tabIndex={collapsed ? 0 : undefined}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `${title}, expand` : undefined}
    >
      <span className="text-xs font-bold tracking-wide text-amber-800 dark:text-amber-200 min-w-0 truncate">
        {title}
      </span>
      <div
        className="flex items-center gap-2 shrink-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => void handleDisable()}
          disabled={disabling}
          className="text-xs text-amber-800 dark:text-amber-200 hover:underline disabled:opacity-50"
          title="Turn off Performance Test Overlay (same as Admin → Troubleshooting)"
        >
          {disabling ? '…' : 'Disable'}
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="text-xs text-amber-800 dark:text-amber-200 hover:underline"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
    </div>
  );
}
