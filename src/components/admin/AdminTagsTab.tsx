import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Edit, Trash2 } from 'lucide-react';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';
import { ADMIN_TABLE_ROW_CLASS } from '../../utils/adminFieldLimits';
import { TAG_NAME_MAX_LENGTH, TAG_DESCRIPTION_MAX_LENGTH } from '../../constants/appConstants';
import { adminFieldClass } from './AdminSection';

interface Tag {
  id: number;
  tag: string;
  description?: string;
  color: string;
}

interface AdminTagsTabProps {
  tags: Tag[];
  loading: boolean;
  onAddTag: (tag: { tag: string; description: string; color: string }) => Promise<void>;
  onUpdateTag: (tagId: number, updates: { tag: string; description: string; color: string }) => Promise<void>;
  onDeleteTag: (tagId: number) => void;
  onConfirmDeleteTag: (tagId: number) => Promise<void>;
  onCancelDeleteTag: () => void;
  showDeleteTagConfirm: number | null;
  tagUsageCounts: { [tagId: number]: number };
}

// Helper function to determine text color based on background color
const getTextColor = (backgroundColor: string): string => {
  if (!backgroundColor) return '#ffffff';
  
  // Handle white and very light colors
  const normalizedColor = backgroundColor.toLowerCase();
  if (normalizedColor === '#ffffff' || normalizedColor === '#fff' || normalizedColor === 'white') {
    return '#374151'; // gray-700 for good contrast on white
  }
  
  // For hex colors, calculate luminance to determine if we need light or dark text
  if (backgroundColor.startsWith('#')) {
    const hex = backgroundColor.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      
      // Calculate relative luminance
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      
      // Use dark text for light backgrounds, white text for dark backgrounds
      return luminance > 0.6 ? '#374151' : '#ffffff';
    }
  }
  
  // Default to white text
  return '#ffffff';
};

const AdminTagsTab: React.FC<AdminTagsTabProps> = ({
  tags,
  loading,
  onAddTag,
  onUpdateTag,
  onDeleteTag,
  onConfirmDeleteTag,
  onCancelDeleteTag,
  showDeleteTagConfirm,
  tagUsageCounts,
}) => {
  const { t } = useTranslation('admin');
  const [showAddTagForm, setShowAddTagForm] = useState(false);
  const [showEditTagForm, setShowEditTagForm] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [newTag, setNewTag] = useState({ tag: '', description: '', color: '#4ECDC4' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Refs for delete button positioning
  const deleteButtonRefs = useRef<{[key: string]: HTMLButtonElement | null}>({});
  const [deleteButtonPosition, setDeleteButtonPosition] = useState<{top: number, left: number, tagId: number, maxHeight?: number} | null>(null);

  // Handle click outside to close delete confirmation
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showDeleteTagConfirm && deleteButtonPosition) {
        const target = event.target as Element;
        if (!target.closest('.delete-confirmation') && !target.closest(`[data-tag-id="${showDeleteTagConfirm}"]`)) {
          onCancelDeleteTag();
        }
      }
    };

    if (showDeleteTagConfirm) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDeleteTagConfirm, deleteButtonPosition, onCancelDeleteTag]);

  useEscapeDismiss(
    () => {
      if (isSubmitting) return;
      if (showAddTagForm) {
        setShowAddTagForm(false);
        setNewTag({ tag: '', description: '', color: '#4ECDC4' });
        return;
      }
      if (showEditTagForm) {
        setShowEditTagForm(false);
        setEditingTag(null);
        return;
      }
      if (showDeleteTagConfirm) {
        onCancelDeleteTag();
      }
    },
    {
      enabled:
        showAddTagForm || showEditTagForm || showDeleteTagConfirm != null,
    }
  );

  const handleDeleteClick = (tagId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const button = deleteButtonRefs.current[tagId];
    if (button) {
      const rect = button.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Estimate dialog height based on whether tasks use this tag
      const tag = tags.find(t => t.id === tagId);
      const estimatedDialogHeight = tag && tagUsageCounts[tag.id] > 0 ? 100 : 80;
      const dialogWidth = 200;
      
      // Check if there's enough space below
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Position above if not enough space below, but enough space above
      let top: number;
      if (spaceBelow < estimatedDialogHeight && spaceAbove > estimatedDialogHeight) {
        // Position above the button
        top = rect.top - estimatedDialogHeight - 5;
      } else {
        // Position below the button (default)
        top = rect.bottom + 5;
      }
      
      // Ensure dialog doesn't go off the right edge
      let left = rect.right - dialogWidth;
      if (left + dialogWidth > viewportWidth) {
        left = viewportWidth - dialogWidth - 10; // 10px margin from edge
      }
      
      // Ensure dialog doesn't go off the left edge
      if (left < 10) {
        left = 10; // 10px margin from edge
      }
      
      // Calculate max height based on position
      const maxHeight = top < rect.top
        ? Math.min(top - 10, 300) // If above, use space from top
        : Math.min(viewportHeight - top - 20, 300); // If below, use space to bottom
      
      setDeleteButtonPosition({
        top,
        left,
        tagId: tagId,
        maxHeight
      });
    }
    onDeleteTag(tagId);
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.tag.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddTag(newTag);
      setShowAddTagForm(false);
      setNewTag({ tag: '', description: '', color: '#4ECDC4' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTag || !editingTag.tag.trim()) return;

    setIsSubmitting(true);
    try {
      await onUpdateTag(editingTag.id, {
        tag: editingTag.tag,
        description: editingTag.description || '',
        color: editingTag.color,
      });
      setShowEditTagForm(false);
      setEditingTag(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="p-6">
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowAddTagForm(true)}
            data-owner-setup="add-tag"
            className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {t('tags.addTag')}
          </button>
        </div>

        {/* Tags Table */}
        <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/60">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {t('tags.tableHeaders.actions')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {t('tags.tableHeaders.tag')}
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('tags.tableHeaders.description')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {Array.isArray(tags) && tags.length > 0 ? (
                  tags.map((tag) => {
                    const bgColor = tag.color || '#4ECDC4';
                    const textColor = getTextColor(bgColor);
                    return (
                  <tr key={tag.id} data-tag-id={tag.id} className={ADMIN_TABLE_ROW_CLASS}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTag(tag);
                            setShowEditTagForm(true);
                          }}
                          className="p-1.5 rounded-lg transition-colors text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                          title={t('tags.editTag')}
                          aria-label={t('tags.editTag')}
                        >
                          <Edit size={15} />
                        </button>
                        <button
                          type="button"
                          ref={(el) => { deleteButtonRefs.current[tag.id] = el; }}
                          onClick={(e) => handleDeleteClick(tag.id, e)}
                          className="p-1.5 rounded-lg transition-colors text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title={t('tags.deleteTag')}
                          aria-label={t('tags.deleteTag')}
                          data-tag-id={tag.id}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap min-w-[10rem]">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="h-3.5 w-3.5 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/15 shadow-sm"
                          style={{ backgroundColor: bgColor }}
                          aria-hidden
                        />
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {tag.tag}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md text-[11px] font-semibold inline-block border shrink-0"
                          style={{
                            backgroundColor: bgColor,
                            color: textColor,
                            borderColor: textColor === '#374151' ? '#d1d5db' : 'rgba(255, 255, 255, 0.25)',
                          }}
                        >
                          {tag.tag}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        {tag.description || (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </span>
                    </td>
                  </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      {loading ? t('tags.loadingTags') : t('tags.noTagsFound')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Tag Modal */}
      {showAddTagForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100 mb-4">{t('tags.addNewTag')}</h3>
              <form onSubmit={handleAddTag}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('tags.tagName')}</label>
                  <input
                    type="text"
                    value={newTag.tag}
                    onChange={(e) => setNewTag(prev => ({ ...prev, tag: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('tags.enterTagName')}
                    maxLength={TAG_NAME_MAX_LENGTH}
                    required
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('tags.descriptionOptional')}</label>
                  <textarea
                    value={newTag.description}
                    onChange={(e) => setNewTag(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('tags.enterTagDescription')}
                    maxLength={TAG_DESCRIPTION_MAX_LENGTH}
                    rows={3}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('tags.color')}</label>
                  <input
                    type="color"
                    value={newTag.color}
                    onChange={(e) => setNewTag(prev => ({ ...prev, color: e.target.value }))}
                    className="w-full h-10 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex space-x-3">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                  >
                    {isSubmitting ? t('tags.creating') : t('tags.createTag')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTagForm(false);
                      setNewTag({ tag: '', description: '', color: '#4ECDC4' });
                    }}
                    className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                  >
                    {t('tags.cancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tag Modal */}
      {showEditTagForm && editingTag && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-black dark:bg-opacity-70 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border border-gray-300 dark:border-gray-600 w-96 shadow-lg rounded-md bg-white dark:bg-gray-800">
            <div className="mt-3">
              <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100 mb-4">{t('tags.editTagTitle')}</h3>
              <form onSubmit={handleEditTag}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('tags.tagName')}</label>
                  <input
                    type="text"
                    value={editingTag.tag}
                    onChange={(e) => setEditingTag(prev => prev ? { ...prev, tag: e.target.value } : null)}
                    className={adminFieldClass(false, 'w-full')}
                    placeholder={t('tags.enterTagName')}
                    maxLength={TAG_NAME_MAX_LENGTH}
                    required
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('tags.descriptionOptional')}</label>
                  <textarea
                    value={editingTag.description || ''}
                    onChange={(e) => setEditingTag(prev => prev ? { ...prev, description: e.target.value } : null)}
                    className={adminFieldClass(false, 'w-full')}
                    placeholder={t('tags.enterTagDescription')}
                    maxLength={TAG_DESCRIPTION_MAX_LENGTH}
                    rows={3}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('tags.color')}</label>
                  <input
                    type="color"
                    value={editingTag.color}
                    onChange={(e) => setEditingTag(prev => prev ? { ...prev, color: e.target.value } : null)}
                    className="w-full h-10 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex space-x-3">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50"
                  >
                    {isSubmitting ? t('tags.updating') : t('tags.updateTag')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditTagForm(false);
                      setEditingTag(null);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                  >
                    {t('tags.cancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Portal-based Delete Confirmation Dialog */}
      {showDeleteTagConfirm && deleteButtonPosition && deleteButtonPosition.tagId === showDeleteTagConfirm && createPortal(
        <div 
          className="delete-confirmation fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 z-[9999] min-w-[200px]"
          style={{
            top: `${deleteButtonPosition.top}px`,
            left: `${deleteButtonPosition.left}px`,
            maxHeight: deleteButtonPosition.maxHeight ? `${deleteButtonPosition.maxHeight}px` : '300px',
            overflowY: 'auto'
          }}
        >
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            {(() => {
              const tag = tags.find(t => t.id === showDeleteTagConfirm);
              if (!tag) return null;
              
              if (tagUsageCounts[tag.id] > 0) {
                return (
                  <>
                    <div className="font-medium mb-1">{t('tags.deleteTag')}</div>
                    <div className="text-xs text-gray-700 dark:text-gray-300">
                      <span className="text-red-600 dark:text-red-400 font-medium">
                        {t('tags.tasksWillLoseTag', { count: tagUsageCounts[tag.id] })}
                      </span>{' '}
                      {t('tags.willLoseThisTag')}{' '}
                      <span className="font-medium">{tag.tag}</span>
                    </div>
                  </>
                );
              } else {
                return (
                  <>
                    <div className="font-medium mb-1">{t('tags.deleteTag')}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {t('tags.noTasksAffected')}{' '}
                      <span className="font-medium">{tag.tag}</span>
                    </div>
                  </>
                );
              }
            })()}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => onConfirmDeleteTag(showDeleteTagConfirm)}
              className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              {t('tags.yes')}
            </button>
            <button
              onClick={onCancelDeleteTag}
              className="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
            >
              {t('tags.no')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default AdminTagsTab;
