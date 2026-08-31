import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, X } from 'lucide-react';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';
import { MODAL_OVERLAY_Z_INDEX } from '../../constants/appConstants';
import {
  DEFAULT_MEMBER_COLOR,
  MEMBER_COLOR_PALETTE,
} from '../../constants/memberColorPalette';

interface MemberColorPickerDialogProps {
  open: boolean;
  initialColor: string;
  userLabel?: string;
  isSaving?: boolean;
  onCancel: () => void;
  onSave: (color: string) => void | Promise<void>;
}

const MemberColorPickerDialog: React.FC<MemberColorPickerDialogProps> = ({
  open,
  initialColor,
  userLabel,
  isSaving = false,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation('admin');
  const [selectedColor, setSelectedColor] = useState(initialColor || DEFAULT_MEMBER_COLOR);

  useEffect(() => {
    if (open) {
      setSelectedColor(initialColor || DEFAULT_MEMBER_COLOR);
    }
  }, [open, initialColor]);

  useEscapeDismiss(onCancel, { enabled: open, disabled: isSaving });

  if (!open) return null;

  const normalizedSelected = selectedColor.toUpperCase();
  const paletteHasSelection = MEMBER_COLOR_PALETTE.some(
    (color) => color.toUpperCase() === normalizedSelected
  );

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      style={{ zIndex: MODAL_OVERLAY_Z_INDEX }}
      role="presentation"
      onClick={() => {
        if (!isSaving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-color-picker-title"
        className="w-[17.5rem] max-w-[calc(100vw-2rem)] shrink-0 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        style={{ width: '17.5rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h3
              id="member-color-picker-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {t('users.changeMemberColor')}
            </h3>
            {userLabel ? (
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{userLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={t('users.cancel')}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 shadow-sm dark:border-slate-600"
              style={{ backgroundColor: selectedColor }}
              aria-hidden
            />
            <p className="text-xs leading-snug text-slate-600 dark:text-slate-300">
              {t('users.memberColorHint')}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label={t('users.changeMemberColor')}
            className="flex flex-wrap gap-2"
          >
            {MEMBER_COLOR_PALETTE.map((color) => {
              const isSelected = color.toUpperCase() === normalizedSelected;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={t('users.colorSwatch', { color })}
                  disabled={isSaving}
                  onClick={() => setSelectedColor(color)}
                  className={`relative h-7 w-7 shrink-0 rounded-full border transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 ${
                    isSelected
                      ? 'border-slate-900 ring-2 ring-slate-900 ring-offset-1 dark:border-white dark:ring-white dark:ring-offset-slate-900'
                      : 'border-black/10 dark:border-white/15'
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {isSelected ? (
                    <Check
                      size={12}
                      className="absolute inset-0 m-auto text-white drop-shadow-sm"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
            <label
              htmlFor="member-custom-color"
              className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              {t('users.customColor')}
            </label>
            <div className="flex items-center gap-2.5 min-w-0">
              <input
                id="member-custom-color"
                type="color"
                value={selectedColor}
                disabled={isSaving}
                onChange={(e) => setSelectedColor(e.target.value)}
                className="h-9 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
              />
              <span className="truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                {selectedColor.toUpperCase()}
              </span>
              {!paletteHasSelection ? (
                <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                  {t('users.customColorActive')}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('users.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void onSave(selectedColor)}
            disabled={isSaving}
            aria-busy={isSaving}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {isSaving ? t('users.savingColor') : t('users.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MemberColorPickerDialog;
