/**
 * Shared form field chrome — editable blends with panel surface; locked gets gray fill.
 * Admin uses `surface: 'slate'` (slate-900); main app panels use `surface: 'panel'` (gray-900 on gray-800 chrome).
 */

export type FormFieldSurface = 'panel' | 'slate';

/** Locked surface colors/border (inputs, selects, read-only controls). */
export const formLockedSurfaceClass =
  'border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 cursor-not-allowed';

const EDITABLE_DARK: Record<FormFieldSurface, string> = {
  panel: 'dark:bg-gray-900',
  slate: 'dark:bg-slate-900',
};

const EDITABLE_BORDER = 'border border-gray-300 dark:border-gray-600';
const EDITABLE_TEXT =
  'bg-white text-gray-900 dark:text-gray-100 placeholder:text-gray-400';

type PySize = '1.5' | '2' | '2.5';
const PY: Record<PySize, string> = { '1.5': 'py-1.5', '2': 'py-2', '2.5': 'py-2.5' };

/** Editable fill/border/text without padding (compose at call site). */
export function formInputEditableParts(surface: FormFieldSurface = 'panel'): string {
  return `${EDITABLE_BORDER} ${EDITABLE_TEXT} ${EDITABLE_DARK[surface]}`;
}

export function formInputEditableClass(
  surface: FormFieldSurface = 'panel',
  opts?: { py?: PySize; rounded?: 'md' | 'lg'; shadow?: boolean; focus?: boolean }
): string {
  const py = PY[opts?.py ?? '2'];
  const rounded = opts?.rounded === 'lg' ? 'rounded-lg' : 'rounded-md';
  const shadow = opts?.shadow !== false ? ' shadow-sm' : '';
  const focus =
    opts?.focus !== false
      ? ' focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500'
      : '';
  return `px-3 ${py} text-sm ${rounded} ${formInputEditableParts(surface)}${shadow}${focus}`;
}

export function formInputLockedClass(opts?: { py?: PySize; rounded?: 'md' | 'lg' }): string {
  const py = PY[opts?.py ?? '2'];
  const rounded = opts?.rounded === 'lg' ? 'rounded-lg' : 'rounded-md';
  return `px-3 ${py} text-sm ${rounded} ${formLockedSurfaceClass} placeholder:text-slate-400/70 shadow-none focus:outline-none focus:ring-0`;
}

/** Pick editable vs locked input chrome; optional width/layout prefix. */
export function formFieldClass(
  locked: boolean,
  opts?: {
    surface?: FormFieldSurface;
    widthClass?: string;
    py?: PySize;
    rounded?: 'md' | 'lg';
    extra?: string;
  }
): string {
  const surface = opts?.surface ?? 'panel';
  const chrome = locked
    ? formInputLockedClass({ py: opts?.py, rounded: opts?.rounded })
    : formInputEditableClass(surface, { py: opts?.py, rounded: opts?.rounded });
  return [opts?.widthClass, chrome, opts?.extra].filter(Boolean).join(' ');
}

export const formLabelClass =
  'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1';
export const formLabelLockedClass =
  'block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1';

/** Picker trigger shell (flex row). */
export function formPickerShellClass(
  locked: boolean,
  surface: FormFieldSurface = 'panel',
  layoutClass = 'flex items-center gap-2'
): string {
  const base = `w-full ${layoutClass} px-3 py-2 rounded-md shadow-sm text-sm`;
  if (locked) {
    return `${base} ${formLockedSurfaceClass}`;
  }
  return `${base} ${formInputEditableParts(surface)}`;
}

/** Toggle track (blocked, settings) — light + dark. */
export const formToggleTrackClass =
  "w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 dark:peer-focus:ring-red-900/40 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-500 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600 dark:peer-checked:bg-red-600 peer-disabled:opacity-50";

/** Editable look for readOnly-until-focus fields (secrets); no cursor-not-allowed. */
export function formFocusToEditFieldClass(
  widthClass = '',
  surface: FormFieldSurface = 'panel',
  py: PySize = '2'
): string {
  return formFieldClass(false, { surface, widthClass, py });
}

/** Compact search inside dropdown panels (member/sprint pickers). */
export function formDropdownSearchClass(widthClass = 'w-full'): string {
  return formFieldClass(false, { widthClass, py: '1.5' });
}

/** Rich-text / memo editor outer shell (description, comments). */
export const formMemoShellClass =
  'border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-900';

/** Memo editor toolbar / footer strip — slightly lighter than content in dark mode. */
export const formMemoToolbarClass =
  'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800';

/** Secondary toolbar actions (Enable all, Refresh, Cancel) — bordered, not field fills. */
export const formSecondaryButtonClass = `inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 ${formInputEditableParts('panel')} text-gray-700 dark:text-gray-200`;

/** Compact filter-bar dropdown trigger (Search & Filter, columns, sprints, tags). */
export function formFilterTriggerClass(
  isActive: boolean,
  opts?: { widthClass?: string; extra?: string; prClass?: string },
): string {
  const layout = `relative flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 ${opts?.prClass ?? 'pr-6'} ${opts?.widthClass ?? ''} ${opts?.extra ?? ''}`;
  if (isActive) {
    return `${layout} border border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500/60`;
  }
  return `${layout} border ${formInputEditableParts('panel')} hover:border-gray-400 dark:hover:border-gray-500 dark:hover:bg-gray-800/80`;
}

/** Icon-only control on kanban chrome panels (linked tasks, overdue, manage). */
export function formChromeIconButtonClass(active = false, disabled = false): string {
  if (disabled) {
    return 'rounded p-1 transition-colors shrink-0 cursor-not-allowed text-gray-400 opacity-40';
  }
  return active
    ? 'rounded p-1 transition-colors shrink-0 bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
    : 'rounded p-1 transition-colors shrink-0 text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-900 dark:hover:text-gray-200';
}

/** Small outlined button on kanban cards (Clear, All Roles). */
export function formChromeOutlineButtonClass(
  variant: 'neutral' | 'danger-hover' = 'neutral',
): string {
  const base = `px-2 py-1 text-xs font-medium rounded-md border transition-colors ${formInputEditableParts('panel')} text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed`;
  if (variant === 'danger-hover') {
    return `${base} enabled:hover:text-red-600 dark:enabled:hover:text-red-400 enabled:hover:border-red-400 dark:enabled:hover:border-red-500/70`;
  }
  return `${base} hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500/70`;
}

/** Subtle × on a single filter pill (tag, priority, field). */
export const formFilterPillDismissButtonClass =
  'p-0.5 rounded-full transition-colors shrink-0 hover:bg-black/5 dark:hover:bg-white/10';
export const formFilterPillDismissIconClass =
  'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300';

/** Clear-all chip when multiple pills are stacked (tags, priorities). */
export const formFilterBulkClearChipClass = `flex items-center px-2 py-1 rounded-full text-xs border shrink-0 ${formInputEditableParts('panel')} text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 dark:hover:bg-gray-800/80`;

/** Global clear-all-filters control — more visible than per-pill dismiss. */
export const formClearAllFiltersButtonClass =
  'p-2 rounded-full transition-colors border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 hover:border-red-400 dark:hover:border-red-600';

/** Role filter pill on Team Members card. */
export function formRoleChipClass(active: boolean): string {
  return `
    flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
    transition-all duration-200 shrink-0 border
    focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
    ${
      active
        ? 'border-blue-500/60 bg-blue-500/15 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 ring-2 ring-inset ring-blue-500/80 dark:ring-blue-400/70'
        : `${formInputEditableParts('panel')} text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 dark:hover:bg-gray-800/80`
    }
  `;
}
