import React from 'react';

type AdminToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label next to the switch (e.g. Enabled / Disabled). */
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/**
 * Shared admin boolean switch (matches AI / Troubleshooting / Site Settings).
 */
export function AdminToggle({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  className = '',
}: AdminToggleProps) {
  return (
    <div className={`flex flex-shrink-0 items-center gap-3 ${className}`.trim()}>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {label}
      </span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-300 shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function adminSettingIsEnabled(value: string | undefined, defaultEnabled = true): boolean {
  if (value === undefined || value === '') return defaultEnabled;
  return value === 'true';
}
