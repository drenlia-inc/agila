import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { X, Edit2, Trash2, Globe, Lock } from 'lucide-react';
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
  onRefreshFilters?: () => void;
}

export default function ManageFiltersModal({
  isOpen,
  onClose,
  savedFilterViews,
  onViewsUpdated,
  currentFilterView,
  onCurrentFilterViewChange,
  onRefreshFilters,
}: ManageFiltersModalProps) {
  const { t } = useTranslation('common');
  const [editingView, setEditingView] = useState<SavedFilterView | null>(null);
  const [editName, setEditName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selectedCount = selectedIds.size;
  const allSelected =
    savedFilterViews.length > 0 && selectedCount === savedFilterViews.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const bulkModeActive = selectedCount > 0;

  const selectedViews = useMemo(
    () => savedFilterViews.filter((view) => selectedIds.has(view.id)),
    [savedFilterViews, selectedIds],
  );

  const canBulkShare = selectedViews.some((view) => !view.shared);
  const canBulkMakePrivate = selectedViews.some((view) => view.shared);

  useEffect(() => {
    if (!isOpen) {
      setEditingView(null);
      setEditName('');
      setDeleteConfirmId(null);
      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const toggleSelected = (viewId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(viewId)) next.delete(viewId);
      else next.add(viewId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(savedFilterViews.map((view) => view.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  };

  const handleCancelEdit = () => {
    setEditingView(null);
    setEditName('');
  };

  const handleCancelDelete = () => {
    setDeleteConfirmId(null);
  };

  const handleCancelBulkDelete = () => {
    setBulkDeleteConfirm(false);
  };

  const handleEscape = useCallback(() => {
    if (isLoading) return;
    if (editingView) {
      setEditingView(null);
      setEditName('');
      return;
    }
    if (bulkDeleteConfirm) {
      setBulkDeleteConfirm(false);
      return;
    }
    if (deleteConfirmId != null) {
      setDeleteConfirmId(null);
      return;
    }
    onClose();
  }, [isLoading, editingView, bulkDeleteConfirm, deleteConfirmId, onClose]);

  useEscapeDismiss(handleEscape, { enabled: isOpen });

  if (!isOpen) return null;

  const handleStartEdit = (view: SavedFilterView) => {
    clearSelection();
    setEditingView(view);
    setEditName(view.filterName);
  };

  const handleSaveEdit = async () => {
    if (!editingView || !editName.trim()) return;

    const nameExists = savedFilterViews.some(
      (view) => view.id !== editingView.id && view.filterName === editName.trim(),
    );

    if (nameExists) {
      alert(t('manageFiltersModal.filterNameExists'));
      return;
    }

    setIsLoading(true);
    try {
      const updatedView = await updateSavedFilterView(editingView.id, {
        filterName: editName.trim(),
      });

      const updatedViews = savedFilterViews.map((view) =>
        view.id === editingView.id ? updatedView : view,
      );

      onViewsUpdated(updatedViews);

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
    clearSelection();
    setDeleteConfirmId(viewId);
  };

  const handleConfirmDelete = async (viewId: number) => {
    setIsLoading(true);
    try {
      await deleteSavedFilterView(viewId);

      const updatedViews = savedFilterViews.filter((view) => view.id !== viewId);
      onViewsUpdated(updatedViews);

      if (currentFilterView?.id === viewId) {
        onCurrentFilterViewChange?.(null);
      }

      setDeleteConfirmId(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(viewId);
        return next;
      });
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
        shared: !view.shared,
      });

      const updatedViews = savedFilterViews.map((v) => (v.id === view.id ? updatedView : v));
      onViewsUpdated(updatedViews);

      if (currentFilterView?.id === view.id) {
        onCurrentFilterViewChange?.(updatedView);
      }

      onRefreshFilters?.();
    } catch (error) {
      console.error('Failed to toggle filter sharing:', error);
      alert(t('manageFiltersModal.failedToUpdateSharing'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsLoading(true);
    try {
      const ids = [...selectedIds];
      await Promise.all(ids.map((id) => deleteSavedFilterView(id)));

      const idSet = new Set(ids);
      const updatedViews = savedFilterViews.filter((view) => !idSet.has(view.id));
      onViewsUpdated(updatedViews);

      if (currentFilterView && idSet.has(currentFilterView.id)) {
        onCurrentFilterViewChange?.(null);
      }

      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to bulk delete filter views:', error);
      alert(t('manageFiltersModal.failedToDelete'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkShare = async (shared: boolean) => {
    if (selectedIds.size === 0) return;

    const targets = selectedViews.filter((view) => view.shared !== shared);
    if (targets.length === 0) return;

    setIsLoading(true);
    try {
      const results = await Promise.all(
        targets.map((view) => updateSavedFilterView(view.id, { shared })),
      );
      const byId = new Map(results.map((view) => [view.id, view]));
      const updatedViews = savedFilterViews.map((view) => byId.get(view.id) ?? view);
      onViewsUpdated(updatedViews);

      if (currentFilterView && selectedIds.has(currentFilterView.id)) {
        const updatedCurrent = byId.get(currentFilterView.id);
        if (updatedCurrent) onCurrentFilterViewChange?.(updatedCurrent);
      }

      onRefreshFilters?.();
    } catch (error) {
      console.error('Failed to bulk update filter sharing:', error);
      alert(t('manageFiltersModal.failedToUpdateSharing'));
    } finally {
      setIsLoading(false);
    }
  };

  const rowSelectionDisabled =
    isLoading || editingView != null || deleteConfirmId != null || bulkDeleteConfirm;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] overflow-y-auto">
      <div className="min-h-screen flex items-start justify-center p-4 pt-[8vh]">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('manageFiltersModal.title')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
              disabled={isLoading}
              aria-label={t('buttons.close')}
            >
              <X size={20} className="text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {savedFilterViews.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">{t('manageFiltersModal.noSavedFilters')}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  {t('manageFiltersModal.createFiltersHint')}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={rowSelectionDisabled}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      aria-label={t('manageFiltersModal.selectAll')}
                    />
                    <span>{t('manageFiltersModal.selectAll')}</span>
                  </label>
                  {bulkModeActive && !bulkDeleteConfirm && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      {t('manageFiltersModal.selectedCount', { count: selectedCount })}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {savedFilterViews.map((view) => {
                    const isSelected = selectedIds.has(view.id);
                    const isEditing = editingView?.id === view.id;
                    const isDeleting = deleteConfirmId === view.id;

                    return (
                      <div
                        key={view.id}
                        className={`border rounded-lg p-3 ${
                          currentFilterView?.id === view.id
                            ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                            : isSelected
                              ? 'border-blue-200 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10'
                              : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-2">
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
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                                disabled={isLoading}
                              >
                                {t('manageFiltersModal.cancel')}
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={!editName.trim() || isLoading}
                                className="px-3 py-1.5 text-sm text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                              >
                                {isLoading ? t('manageFiltersModal.saving') : t('manageFiltersModal.save')}
                              </button>
                            </div>
                          </div>
                        ) : isDeleting ? (
                          <div className="space-y-2">
                            <div>
                              <h4 className="font-medium text-gray-900 dark:text-gray-100">{view.filterName}</h4>
                              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                                {t('manageFiltersModal.deleteConfirmation')}
                              </p>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={handleCancelDelete}
                                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                                disabled={isLoading}
                              >
                                {t('manageFiltersModal.cancel')}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmDelete(view.id)}
                                className="px-3 py-1.5 text-sm text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
                                disabled={isLoading}
                              >
                                {isLoading ? t('manageFiltersModal.deleting') : t('manageFiltersModal.delete')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(view.id)}
                                disabled={rowSelectionDisabled}
                                className="mt-1 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                aria-label={t('manageFiltersModal.selectFilter', { name: view.filterName })}
                              />
                              <div className="flex items-center justify-between flex-1 min-w-0 gap-3">
                                <div className="flex-1 min-w-0">
                                  <h4
                                    className="font-medium text-gray-900 dark:text-gray-100 truncate"
                                    title={view.filterName}
                                  >
                                    {view.filterName}
                                  </h4>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-1">
                                    <p>
                                      {t('manageFiltersModal.created')}
                                      {new Date(view.created_at).toLocaleDateString()}
                                    </p>
                                    {currentFilterView?.id === view.id && (
                                      <p className="text-blue-600 dark:text-blue-400 font-medium">
                                        {t('manageFiltersModal.currentlyApplied')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEdit(view)}
                                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                                    title={t('manageFiltersModal.renameFilter')}
                                    disabled={isLoading}
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClick(view.id)}
                                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                                    title={t('manageFiltersModal.deleteFilter')}
                                    disabled={isLoading}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700 ml-7">
                              <div className="flex items-center gap-2">
                                {view.shared ? (
                                  <Globe size={14} className="text-blue-500 dark:text-blue-400" />
                                ) : (
                                  <Lock size={14} className="text-gray-400 dark:text-gray-500" />
                                )}
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  {view.shared
                                    ? t('manageFiltersModal.sharedWithTeam')
                                    : t('manageFiltersModal.privateFilter')}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleShare(view)}
                                disabled={isLoading}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                                  view.shared
                                    ? 'bg-blue-600 dark:bg-blue-500'
                                    : 'bg-gray-200 dark:bg-gray-600'
                                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                aria-label={
                                  view.shared
                                    ? t('manageFiltersModal.makePrivateFilter', { name: view.filterName })
                                    : t('manageFiltersModal.shareFilter', { name: view.filterName })
                                }
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
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                {bulkDeleteConfirm ? (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="bulk-delete-filter-title"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <p
                      id="bulk-delete-filter-title"
                      className="text-xs font-medium text-red-700 dark:text-red-300"
                    >
                      {t('manageFiltersModal.bulkDeleteConfirmation', { count: selectedCount })}
                    </p>
                    <button
                      type="button"
                      onClick={handleCancelBulkDelete}
                      className="px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                      disabled={isLoading}
                    >
                      {t('manageFiltersModal.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      className="px-2.5 py-1.5 text-xs text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 disabled:opacity-50"
                      disabled={isLoading}
                    >
                      {isLoading
                        ? t('manageFiltersModal.deleting')
                        : t('manageFiltersModal.deleteSelectedConfirm', { count: selectedCount })}
                    </button>
                  </div>
                ) : bulkModeActive ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setBulkDeleteConfirm(true)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      {t('manageFiltersModal.deleteSelected', { count: selectedCount })}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkShare(true)}
                      disabled={isLoading || !canBulkShare}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50"
                    >
                      <Globe size={12} />
                      {t('manageFiltersModal.shareSelected', { count: selectedCount })}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkShare(false)}
                      disabled={isLoading || !canBulkMakePrivate}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                      <Lock size={12} />
                      {t('manageFiltersModal.makePrivateSelected', { count: selectedCount })}
                    </button>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
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
