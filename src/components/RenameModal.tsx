import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { BOARD_TITLE_MAX_LENGTH } from '../constants/appConstants';

interface RenameModalProps {
  title: string;
  currentName: string;
  onSubmit: (newName: string) => void;
  onClose: () => void;
  maxLength?: number;
}

export default function RenameModal({
  title,
  currentName,
  onSubmit,
  onClose,
  maxLength = BOARD_TITLE_MAX_LENGTH
}: RenameModalProps) {
  const { t } = useTranslation('common');
  const [name, setName] = React.useState(currentName);

  useEscapeDismiss(onClose);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-white rounded-lg shadow-xl w-96 overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-6">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              {t('labels.name')}
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              placeholder={t('renameModal.enterName')}
              maxLength={maxLength}
              autoFocus
            />
          </div>
          
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              {t('buttons.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              {t('buttons.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}