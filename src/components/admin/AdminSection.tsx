import React from 'react';
import {
  formFieldClass,
  formFocusToEditFieldClass as formFocusToEditFieldClassBase,
  formInputEditableClass,
  formInputLockedClass,
  formLockedSurfaceClass,
} from '../../utils/formFieldClasses';

/**
 * Admin form field chrome — light and dark follow the same idea:
 * - Editable: matches the panel surface (white / slate-900) — border carries affordance.
 * - Locked: filled gray (slate-100 / slate-800) so non-editable fields read clearly.
 */

/** Editable text/select chrome for admin settings forms. */
export const adminInputEditableClass = formInputEditableClass('slate', { py: '1.5' });

/** Locked surface colors/border (inputs, selects, read-only controls). */
export const adminLockedSurfaceClass = formLockedSurfaceClass;

/** Locked / read-only field chrome (matches Admin → Users edit modal). */
export const adminInputLockedClass = formInputLockedClass({ py: '1.5' });

/** Modal forms (Users) — editable fields blend with slate-900 modal shell in dark mode. */
export const adminModalInputEditableClass = `w-full ${formInputEditableClass('slate', { py: '2.5' })}`;

export const adminModalInputLockedClass = `w-full ${formInputLockedClass({ py: '2.5' })}`;

export const adminLabelClass = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5';
export const adminLabelLockedClass = 'block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1.5';

/** Settings section labels (slightly larger than modal labels). */
export const adminSettingsLabelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
export const adminSettingsLabelLockedClass =
  'block text-sm font-medium text-slate-400 dark:text-slate-500 mb-1';

/** Pick editable vs locked input chrome; optional width/layout prefix (e.g. `w-full max-w-md`). */
export function adminFieldClass(locked: boolean, widthClass = ''): string {
  return formFieldClass(locked, { surface: 'slate', widthClass, py: '1.5' });
}

/** Editable look for readOnly-until-focus fields (secrets); no cursor-not-allowed. */
export function adminFocusToEditFieldClass(widthClass = ''): string {
  return formFocusToEditFieldClassBase(widthClass, 'slate', '1.5');
}

/** Short enum selects (visibility, locale-style values). */
export const adminSelectEnumClass = (locked: boolean, widthClass = 'w-full max-w-[11rem]') =>
  adminFieldClass(locked, widthClass);

/** Shared control chrome — add `w-full` (or a fixed width) at the call site. */
export const adminInputClass = adminInputEditableClass;

/** Full-width variant for stacked form fields. */
export const adminInputFullClass = `w-full ${adminInputClass}`;

export const adminInputLockedFullClass = `w-full ${adminInputLockedClass}`;

/** Typical settings fields — cap length so full-width pages do not stretch emails/secrets. */
export const adminInputBoundedClass = `w-full max-w-md ${adminInputClass}`;

export const adminInputLockedBoundedClass = `w-full max-w-md ${adminInputLockedClass}`;

/** Longer values (URLs, client IDs). */
export const adminInputWideClass = `w-full max-w-xl ${adminInputClass}`;

export const adminInputLockedWideClass = `w-full max-w-xl ${adminInputLockedClass}`;

/** Ports and other short numeric values. */
export const adminInputShortClass = `w-full max-w-[7.5rem] ${adminInputClass}`;

export const adminInputLockedShortClass = `w-full max-w-[7.5rem] ${adminInputLockedClass}`;

export const adminSubtabPanelClass = 'min-w-0';

/** Hub sub-nav row mounted in the sticky Admin chrome via portal. */
export const adminHubSubnavShellClass =
  'px-4 py-2 overflow-x-auto bg-white dark:bg-gray-800';

export const adminChromeTitleClass =
  'text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide leading-5 shrink-0';

/** Primary Admin nav — underline accent (distinct from subtab pills). */
export const adminStripTabClass = (active: boolean) =>
  `relative py-2 px-0.5 font-medium text-sm whitespace-nowrap transition-colors border-b-2 -mb-px inline-flex items-center gap-1.5 ${
    active
      ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600'
  }`;

/** Secondary hub subtabs — compact pills. */
export const adminSubNavTabClass = (active: boolean) =>
  `py-1 px-2.5 font-medium text-sm whitespace-nowrap rounded-md transition-colors inline-flex items-center gap-1.5 ${
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
