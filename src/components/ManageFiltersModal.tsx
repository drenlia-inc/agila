import { useState, useCallback } from 'react';
import { X, Edit2, Trash2, Save, XCircle, Globe, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SavedFilterView, updateSavedFilterView, deleteSavedFilterView } from '../api';
import { useEscapeDismiss } from '../hooks/useEscapeDismiss';
import { FILTER_NAME_MAX_LENGTH } from '../constants/appConstants';

interface ManageFiltersModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedFilterViews: SavedFilterView[];
  onViewsUpdated: (views: SavedFilterView[]) => void;
  currentFilterView?: SavedFilterView | null;
  onCurrentFilterViewChange?: (view: SavedFilterView | null) => void;
  onRefreshFilters?: () => void; // For refreshing shared filters
}

export default function ManageFiltersModal({
  isOpen,
  onClose,
  savedFilterViews,
  onViewsUpdated,
  currentFilterView,
  onCurrentFilterViewChange,
  onRefreshFilters
}: ManageFiltersModalProps) {
  const { t } = useTranslation('common');
  const [editingView, setEditingView] = useState<SavedFilterView | null>(null);
  const [editName, setEditName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const handleCancelEdit = () => {
    setEditingView(null);
    setEditName('');
  };

  const handleCancelDelete = () => {
    setDeleteConfirmId(null);
  };

  const handleEscape = useCallback(() => {
    if (isLoading) return;
    if (editingView) {
      setEditingView(null);
      setEditName('');
      return;
    }
    if (deleteConfirmId != null) {
      setDeleteConfirmId(null);
      return;
    }
    onClose();
  }, [isLoading, editingView, deleteConfirmId, onClose]);

  useEscapeDismiss(handleEscape, { enabled: isOpen });

  if (!isOpen) return null;

  const handleStartEdit = (view: SavedFilterView) => {
    setEditingView(view);
    setEditName(view.filterName);
  };

  const handleSaveEdit = async () => {
    if (!editingView || !editName.trim()) return;

    // Check if name already exists (excluding current item)
    const nameExists = savedFilterViews.some(
      view => view.id !== editingView.id && view.filterName === editName.trim()
    );

    if (nameExists) {
      alert(t('manageFiltersModal.filterNameExists'));
      return;
    }

    setIsLoading(true);
    try {
      const updatedView = await updateSavedFilterView(editingView.id, {
        filterName: editName.trim()
      });

      const updatedViews = savedFilterViews.map(view => 
        view.id === editingView.id ? updatedView : view
      );
      
      onViewsUpdated(updatedViews);

      // Update current filter view if it's the one being edited
      if (currentFilterView?.id === editingView.id) {
        onCurrentFilterViewChange?.(updatedView);
      }

      setEditingView(null);
      setEditName('');
    } catch (error) {
      console.error('Failed to update filter view:', error);
      alert(t('manageFiltersModal.failedToUpdate'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteClick = (viewId: number) => {
    setDeleteConfirmId(viewId);
  };

  const handleConfirmDelete = async (viewId: number) => {
    setIsLoading(true);
    try {
      await deleteSavedFilterView(viewId);
      
      const updatedViews = savedFilterViews.filter(view => view.id !== viewId);
      onViewsUpdated(updatedViews);

      // Clear current filter view if it's the one being deleted
      if (currentFilterView?.id === viewId) {
        onCurrentFilterViewChange?.(null);
      }

      setDeleteConfirmId(null);
    } catch (error) {
      console.error('Failed to delete filter view:', error);
      alert(t('manageFiltersModal.failedToDelete'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleShare = async (view: SavedFilterView) => {
    setIsLoading(true);
    try {
      const updatedView = await updateSavedFilterView(view.id, {
        shared: !view.shared
      });

      const updatedViews = savedFilterViews.map(v => 
        v.id === view.id ? updatedView : v
      );
      onViewsUpdated(updatedViews);

      // Update current filter view if it's the one being modified
      if (currentFilterView?.id === view.id) {
        onCurrentFilterViewChange?.(updatedView);
      }
      
      // Refresh all filters to update shared filters lists for all users
      onRefreshFilters?.();
    } catch (error) {
      console.error('Failed to toggle filter sharing:', error);
      alert(t('manageFiltersModal.failedToUpdateSharing'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] overflow-y-auto">
      <div className="h-screen flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('manageFiltersModal.title')}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            disabled={isLoading}
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {savedFilterViews.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">{t('manageFiltersModal.noSavedFilters')}</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                {t('manageFiltersModal.createFiltersHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedFilterViews.map((view) => (
                <div
                  key={view.id}
                  className={`border rounded-lg p-4 ${
                    currentFilterView?.id === view.id 
                      ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30' 
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {editingView?.id === view.id ? (
                    /* Edit Mode */
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        placeholder={t('manageFiltersModal.filterNamePlaceholder')}
                        maxLength={FILTER_NAME_MAX_LENGTH}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editName.trim()) {
                            handleSaveEdit();
                          } else if (e.key === 'Escape') {
                            handleCancelEdit();
                          }
                        }}
                        autoFocus
                        disabled={isLoading}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                          disabled={isLoading}
                        >
                          {t('manageFiltersModal.cancel')}
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          disabled={!editName.trim() || isLoading}
                          className="px-3 py-1.5 text-sm text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          {isLoading ? t('manageFiltersModal.saving') : t('manageFiltersModal.save')}
                        </button>
                      </div>
                    </div>
                  ) : deleteConfirmId === view.id ? (
                    /* Delete Confirmation Mode */
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{view.filterName}</h4>
                        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                          {t('manageFiltersModal.deleteConfirmation')}
                        </p>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleCancelDelete}
                          className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                          disabled={isLoading}
                        >
                          {t('manageFiltersModal.cancel')}
                        </button>
                        <button
                          onClick={() => handleConfirmDelete(view.id)}
                          className="px-3 py-1.5 text-sm text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
                          disabled={isLoading}
                        >
                          {isLoading ? t('manageFiltersModal.deleting') : t('manageFiltersModal.delete')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View Mode */
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">{view.filterName}</h4>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-1">
                            <p>{t('manageFiltersModal.created')}{new Date(view.created_at).toLocaleDateString()}</p>
                            {currentFilterView?.id === view.id && (
                              <p className="text-blue-600 dark:text-blue-400 font-medium">{t('manageFiltersModal.currentlyApplied')}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-3">
                          <button
                            onClick={() => handleStartEdit(view)}
                            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                            title={t('manageFiltersModal.renameFilter')}
                            disabled={isLoading}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(view.id)}
                            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                            title={t('manageFiltersModal.deleteFilter')}
                            disabled={isLoading}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      
                      {/* Share toggle */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                          {view.shared ? (
                            <Globe size={14} className="text-blue-500 dark:text-blue-400" />
                          ) : (
                            <Lock size={14} className="text-gray-400 dark:text-gray-500" />
                          )}
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {view.shared ? t('manageFiltersModal.sharedWithTeam') : t('manageFiltersModal.privateFilter')}
                          </span>
                        </div>
                        <button
                          onClick={() => handleToggleShare(view)}
                          disabled={isLoading}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                            view.shared 
                              ? 'bg-blue-600 dark:bg-blue-500' 
                              : 'bg-gray-200 dark:bg-gray-600'
                          } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-200 transition-transform ${
                              view.shared ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              disabled={isLoading}
            >
              {t('manageFiltersModal.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
