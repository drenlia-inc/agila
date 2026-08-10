import React from 'react';

/**
 * Compact keyboard-key chip for menus and tooltips.
 */
export function KbdBadge({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded border border-gray-300/90 bg-gray-50 px-1 py-0.5 font-mono text-[10px] font-medium leading-none text-gray-500 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)] dark:border-gray-600 dark:bg-gray-700/80 dark:text-gray-300 dark:shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)] ${className}`}
    >
      {children}
    </kbd>
  );
}
