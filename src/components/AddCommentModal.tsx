import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, Send } from 'lucide-react';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { COMMENT_MAX_LENGTH } from '../constants/appConstants';
import { formFieldClass } from '../utils/formFieldClasses';

interface AddCommentModalProps {
  isOpen: boolean;
  taskTitle: string;
  onClose: () => void;
  onSubmit: (commentText: string) => Promise<void>;
  editingComment?: {
    id: string;
    text: string;
  } | null;
}

export default function AddCommentModal({
  isOpen,
  taskTitle,
  onClose,
  onSubmit,
  editingComment
}: AddCommentModalProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when modal opens/closes or editing comment changes
  useEffect(() => {
    if (isOpen) {
      setCommentText(editingComment?.text || '');
      setIsSubmitting(false);
    }
  }, [isOpen, editingComment]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) onClose();
  }, [isSubmitting, onClose]);

  useEscapeDismiss(handleClose, { enabled: isOpen });

  const handleSubmit = async () => {
    if (commentText.trim() && !isSubmitting) {
      setIsSubmitting(true);
      try {
        await onSubmit(commentText.trim());
        onClose();
      } catch (error) {
        console.error('Failed to add comment:', error);
        setIsSubmitting(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift+Enter: Allow new line (default behavior)
        return;
      } else {
        // Enter: Submit comment
        e.preventDefault();
        handleSubmit();
      }
    } else if (e.key === 'Escape') {
      // Escape: Cancel
      e.preventDefault();
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingComment ? t('addCommentModal.editComment') : t('addCommentModal.addComment')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            title={t('addCommentModal.close')}
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Task Title */}
        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {editingComment ? t('addCommentModal.editingCommentOn') : t('addCommentModal.addingCommentTo')} <span className="font-medium text-gray-800 dark:text-gray-100">{taskTitle}</span>
          </p>
        </div>

        {/* Comment Input */}
        <div className="mb-4">
          <label htmlFor="comment-text" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            {t('addCommentModal.comment')}
          </label>
          <textarea
            id="comment-text"
            ref={textareaRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('addCommentModal.typeYourCommentHere')}
            maxLength={COMMENT_MAX_LENGTH}
            className={formFieldClass(false, { widthClass: 'w-full', extra: 'resize-none placeholder:text-gray-400 dark:placeholder:text-gray-500' })}
            rows={4}
            disabled={isSubmitting}
          />
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t('addCommentModal.pressEnterToSubmit')}{' '}
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-xs">Enter</kbd>{' '}
            {t('addCommentModal.toSubmit')},{' '}
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-xs ml-1">Shift+Enter</kbd>{' '}
            {t('addCommentModal.forNewLine')},{' '}
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-xs ml-1">Esc</kbd>{' '}
            {t('addCommentModal.toCancel')}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            disabled={isSubmitting}
          >
            {t('buttons.cancel', { ns: 'common' })}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!commentText.trim() || isSubmitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {editingComment ? t('addCommentModal.updating') : t('addCommentModal.adding')}
              </>
            ) : (
              <>
                <Send size={16} />
                {editingComment ? t('addCommentModal.updateComment') : t('addCommentModal.addComment')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
