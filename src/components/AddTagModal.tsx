import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { TAG_NAME_MAX_LENGTH } from '../constants/appConstants';

interface AddTagModalProps {
  onClose: () => void;
  onTagCreated: (tag: any) => void;
}

const PRESET_COLORS = [
  '#4F46E5', // Indigo
  '#EF4444', // Red
  '#10B981', // Green
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#6366F1', // Indigo-500
  '#84CC16', // Lime
  '#06B6D4', // Cyan
];

export default function AddTagModal({ onClose, onTagCreated }: AddTagModalProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [tagName, setTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleClose = useCallback(() => {
    if (!isSubmitting) onClose();
  }, [isSubmitting, onClose]);

  useEscapeDismiss(handleClose);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!tagName.trim()) {
      setError(t('addTagModal.tagNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          tag: tagName.trim(),
          description: '',
          color: selectedColor
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('addTagModal.failedToCreate'));
      }

      const newTag = await response.json();
      onTagCreated(newTag);
      onClose();
    } catch (err: any) {
      setError(err.message || t('addTagModal.failedToCreate'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Capture Esc key to close modal
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!isSubmitting) {
        onClose();
      }
      return;
    }
    // For Enter key, only stop propagation to prevent bubbling to parent handlers
    // Let the form's natural submission handle it
    if (e.key === 'Enter' && !e.shiftKey) {
      e.stopPropagation();
      // Don't preventDefault - let form submission happen naturally
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Stop propagation for Enter to prevent parent handlers from catching it
    if (e.key === 'Enter' && !e.shiftKey) {
      e.stopPropagation();
      // Let the form's natural submission handle it
    }
    // Handle Esc key
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!isSubmitting) {
        onClose();
      }
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]" 
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6" 
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('addTagModal.title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('addTagModal.tagName')}
            </label>
            <input
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder={t('addTagModal.enterTagName')}
              maxLength={TAG_NAME_MAX_LENGTH}
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('addTagModal.color')}
            </label>
            <div className="grid grid-cols-6 gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-10 h-10 rounded-md transition-all ${
                    selectedColor === color 
                      ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' 
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                  disabled={isSubmitting}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting || !tagName.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? t('addTagModal.creating') : t('addTagModal.createTag')}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('buttons.cancel', { ns: 'common' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

