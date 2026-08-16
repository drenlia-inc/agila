import React from 'react';

/** Shared control chrome — add `w-full` (or a fixed width) at the call site. */
export const adminInputClass =
  'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

/** Full-width variant for stacked form fields. */
export const adminInputFullClass = `w-full ${adminInputClass}`;

/** Typical settings fields — cap length so full-width pages do not stretch emails/secrets. */
export const adminInputBoundedClass = `w-full max-w-md ${adminInputClass}`;

/** Longer values (URLs, client IDs). */
export const adminInputWideClass = `w-full max-w-xl ${adminInputClass}`;

/** Ports and other short numeric values. */
export const adminInputShortClass = `w-full max-w-[7.5rem] ${adminInputClass}`;

export const adminSubtabPanelClass =
  'rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20 p-4';

export const adminStripTabClass = (active: boolean) =>
  `relative py-1 px-2 font-medium text-sm whitespace-nowrap rounded-md transition-colors ${
    active
      ? 'text-blue-700 dark:text-white bg-blue-100 dark:bg-blue-600/50'
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100/90 dark:hover:bg-gray-700/40'
  }`;

export const adminSubNavTabClass = (active: boolean) =>
  `py-1.5 px-2.5 font-medium text-sm whitespace-nowrap rounded-md transition-colors inline-flex items-center gap-1.5 ${
    active
      ? 'text-blue-700 dark:text-white bg-blue-100 dark:bg-blue-600/50'
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100/90 dark:hover:bg-gray-700/40'
  }`;

type AdminSectionTone = 'default' | 'indigo' | 'slate' | 'amber';

const toneBorder: Record<AdminSectionTone, string> = {
  default: 'border-gray-200 dark:border-gray-700',
  indigo: 'border-indigo-200 dark:border-indigo-800',
  slate: 'border-slate-200 dark:border-slate-700',
  amber: 'border-amber-200 dark:border-amber-800',
};

const toneHeader: Record<AdminSectionTone, string> = {
  default: 'border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/50',
  indigo: 'border-indigo-100 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20',
  slate: 'border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40',
  amber: 'border-amber-100 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20',
};

type AdminPageWidth = 'form' | 'wide' | 'full';

const pageWidthClass: Record<AdminPageWidth, string> = {
  /** Credential / short-field forms — readable line length (SSO, Mail, Storage-style). */
  form: 'max-w-3xl',
  /** Medium layouts — a bit more room without spanning ultra-wide monitors. */
  wide: 'max-w-5xl',
  /** Tables, multi-column checklists, long copy (File Uploads, App UI, queues). */
  full: 'max-w-none w-full',
};

interface AdminPageShellProps {
  description?: React.ReactNode;
  children: React.ReactNode;
  /**
   * Content column width. Default `form` (max-w-3xl) for dense settings forms.
   * Use `full` when multi-column grids / long explanations benefit from the panel width.
   */
  width?: AdminPageWidth;
  className?: string;
}

/** Compact page chrome: short intro + stacked sections. */
export const AdminPageShell: React.FC<AdminPageShellProps> = ({
  description,
  children,
  width = 'form',
  className = '',
}) => (
  <div className={className}>
    {description ? (
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 leading-snug">{description}</p>
    ) : null}
    <div className={`${pageWidthClass[width]} space-y-3`}>{children}</div>
  </div>
);

interface AdminSectionProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  tone?: AdminSectionTone;
  className?: string;
  /** Tighter body padding for dense forms */
  dense?: boolean;
  headerRight?: React.ReactNode;
  /** Admin search / help scroll target */
  settingKey?: string;
}

/** Bordered admin panel — use for grouped settings without tall empty space. */
export const AdminSection: React.FC<AdminSectionProps> = ({
  title,
  description,
  children,
  tone = 'default',
  className = '',
  dense = false,
  headerRight,
  settingKey,
}) => (
  <section
    className={`rounded-lg border ${toneBorder[tone]} ${className}`}
    {...(settingKey ? { 'data-setting-key': settingKey } : {})}
  >
    {(title || description || headerRight) && (
      <div
        className={`flex items-start justify-between gap-3 px-3 py-2 border-b ${toneHeader[tone]}`}
      >
        <div className="min-w-0">
          {title ? (
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          ) : null}
          {description ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
              {description}
            </p>
          ) : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>
    )}
    <div className={dense ? 'p-3 space-y-2.5' : 'p-3 space-y-3'}>{children}</div>
  </section>
);

interface AdminActionsBarProps {
  children: React.ReactNode;
  className?: string;
}

export const AdminActionsBar: React.FC<AdminActionsBarProps> = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-2 pt-0.5 ${className}`}>{children}</div>
);
