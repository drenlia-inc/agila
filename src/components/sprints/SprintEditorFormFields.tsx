import React from 'react';
import { useTranslation } from 'react-i18next';
import { ModernCheckbox } from '../ModernCheckbox';
import { formFieldClass } from '../../utils/formFieldClasses';
import { SPRINT_NAME_MAX_LENGTH, SPRINT_DESCRIPTION_MAX_LENGTH } from '../../constants/appConstants';

export type SprintEditorFormData = {
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  description: string;
};

interface SprintEditorFormFieldsProps {
  formData: SprintEditorFormData;
  onChange: (next: SprintEditorFormData) => void;
  compact?: boolean;
}

const SprintEditorFormFields: React.FC<SprintEditorFormFieldsProps> = ({
  formData,
  onChange,
  compact = false,
}) => {
  const { t } = useTranslation('admin');
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';
  const inputClass = `${formFieldClass(false, { widthClass: 'w-full', rounded: 'lg' })} placeholder-gray-400`;
  const gridGap = 'gap-4 mb-4';

  return (
    <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'} ${gridGap}`}>
      <div className={compact ? 'col-span-2' : 'md:col-span-2'}>
        <label className={labelClass}>
          {t('sprintSettings.sprintName')}
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
          placeholder={t('sprintSettings.namePlaceholder')}
          maxLength={SPRINT_NAME_MAX_LENGTH}
          className={inputClass}
          autoFocus={compact}
        />
      </div>

      <div>
        <label className={labelClass}>
          {t('sprintSettings.startDate')}
        </label>
        <input
          type="date"
          value={formData.start_date}
          onChange={(e) => onChange({ ...formData, start_date: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>
          {t('sprintSettings.endDate')}
        </label>
        <input
          type="date"
          value={formData.end_date}
          onChange={(e) => onChange({ ...formData, end_date: e.target.value })}
          className={inputClass}
        />
      </div>

      <div className={compact ? 'col-span-2' : 'md:col-span-2'}>
        <label className={labelClass}>
          {t('sprintSettings.descriptionLabel')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => onChange({ ...formData, description: e.target.value })}
          placeholder={t('sprintSettings.optionalDescription')}
          maxLength={SPRINT_DESCRIPTION_MAX_LENGTH}
          rows={2}
          className={inputClass}
        />
      </div>

      <div className={compact ? 'col-span-2' : 'md:col-span-2'}>
        <label className="flex items-center gap-2 cursor-pointer">
          <ModernCheckbox
            checked={formData.is_active}
            onChange={(e) => onChange({ ...formData, is_active: e.target.checked })}
            size="sm"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('sprintSettings.markAsActiveSprint')}
          </span>
        </label>
      </div>
    </div>
  );
};

export default SprintEditorFormFields;
