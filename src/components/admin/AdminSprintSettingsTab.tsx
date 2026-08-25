import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, Edit2, Trash2, Save, X, CheckCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from '../../utils/toast';
import { getAllSprints, getSprintUsage, deleteSprint, createSprint, updateSprint } from '../../api';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';
import { ADMIN_TABLE_ROW_CLASS } from '../../utils/adminFieldLimits';
import { getDefaultNewSprintDates } from '../../utils/dateUtils';
import SprintEditorFormFields from '../sprints/SprintEditorFormFields';
import SprintTransferConfirmDialog from '../sprints/SprintTransferConfirmDialog';
import {
  fetchSprintTransferOffer,
  notifySprintsUpdated,
  type SprintTransferOffer,
} from '../../utils/sprintActiveWorkTransfer';

interface PlanningPeriod {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  description: string | null;
  created_at: string;
  task_count?: number;
}

/** `<input type="date">` only accepts YYYY-MM-DD; PostgreSQL JSON often sends ISO datetimes. */
function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

const AdminSprintSettingsTab: React.FC = () => {
  const { t } = useTranslation('admin');
  const [sprints, setSprints] = useState<PlanningPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showDeleteSprintConfirm, setShowDeleteSprintConfirm] = useState<string | null>(null);
  const [sprintUsageCounts, setSprintUsageCounts] = useState<{ [sprintId: string]: number }>({});
  const [deleteButtonPositions, setDeleteButtonPositions] = useState<{ [sprintId: string]: { top: number; left: number; maxHeight?: number } }>({});
  const [formData, setFormData] = useState({
    name: '',
    start_date: '',
    end_date: '',
    is_active: false,
    description: ''
  });
  const [transferOffer, setTransferOffer] = useState<SprintTransferOffer | null>(null);
  const [transferToName, setTransferToName] = useState('');
  const [savingSprint, setSavingSprint] = useState(false);
  const pendingActivateRef = useRef<{
    mode: 'create' | 'update' | 'toggle';
    sprintId?: string;
    payload: {
      name: string;
      start_date: string;
      end_date: string;
      is_active: boolean;
      description: string;
    };
  } | null>(null);

  useEffect(() => {
    fetchSprints();
  }, []);

  // Other tabs / browsers: sprint WebSocket triggers `sprints-updated` on this window too
  useEffect(() => {
    const onSprintsUpdated = () => {
      void fetchSprints();
    };
    window.addEventListener('sprints-updated', onSprintsUpdated);
    return () => window.removeEventListener('sprints-updated', onSprintsUpdated);
  }, []);

  // Handle click outside to close delete confirmation (defer so the opening click does not dismiss)
  useEffect(() => {
    if (!showDeleteSprintConfirm) return;
    let handleClickOutside: ((event: MouseEvent) => void) | undefined;
    const timeoutId = window.setTimeout(() => {
      handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Element;
        if (
          !target.closest('.delete-confirmation') &&
          !target.closest(`button[data-sprint-id="${showDeleteSprintConfirm}"]`)
        ) {
          setShowDeleteSprintConfirm(null);
          setDeleteButtonPositions(prev => {
            const updated = { ...prev };
            delete updated[showDeleteSprintConfirm];
            return updated;
          });
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      if (handleClickOutside) {
        document.removeEventListener('mousedown', handleClickOutside);
      }
    };
  }, [showDeleteSprintConfirm]);

  useEscapeDismiss(
    () => setShowDeleteSprintConfirm(null),
    { enabled: showDeleteSprintConfirm != null }
  );
  const fetchSprints = async () => {
    try {
      setLoading(true);
      setSprints(await getAllSprints());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sprintSettings.failedToLoadSprints'), '');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    const { start_date, end_date } = getDefaultNewSprintDates();
    setIsCreating(true);
    setFormData({
      name: '',
      start_date,
      end_date,
      is_active: false,
      description: ''
    });
  };

  const handleEdit = (sprint: PlanningPeriod) => {
    setEditingId(sprint.id);
    setFormData({
      name: sprint.name,
      start_date: toDateInputValue(sprint.start_date),
      end_date: toDateInputValue(sprint.end_date),
      is_active: Boolean(sprint.is_active),
      description: sprint.description || ''
    });
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({
      name: '',
      start_date: '',
      end_date: '',
      is_active: false,
      description: ''
    });
    setTransferOffer(null);
    pendingActivateRef.current = null;
  };

  const commitSprintPayload = async (
    payload: {
      name: string;
      start_date: string;
      end_date: string;
      is_active: boolean;
      description: string;
    },
    options: { sprintId?: string; transfer: boolean; selectAfter: boolean }
  ) => {
    setSavingSprint(true);
    try {
      const saved = options.sprintId
        ? await updateSprint(options.sprintId, {
            ...payload,
            transfer_active_work: options.transfer,
          })
        : await createSprint({
            ...payload,
            transfer_active_work: options.transfer,
          });
      const moved = Number(saved?.transferred_count) || 0;
      toast.success(
        options.sprintId
          ? t('sprintSettings.sprintUpdatedSuccessfully')
          : t('sprintSettings.sprintCreatedSuccessfully'),
        ''
      );
      if (moved > 0) {
        toast.success(
          t('sprintSettings.transferSuccess', { count: moved, toName: saved.name }),
          ''
        );
      }
      notifySprintsUpdated({
        selectSprintId: options.selectAfter && saved?.id ? saved.id : undefined,
        transferredFromSprintId: options.transfer ? transferOffer?.fromId : undefined,
        transferredToSprintId:
          options.transfer && transferOffer?.fromId && saved?.id ? saved.id : undefined,
      });
      setTransferOffer(null);
      pendingActivateRef.current = null;
      const closeEditor = !options.sprintId || editingId === options.sprintId;
      if (closeEditor) {
        handleCancel();
      }
      fetchSprints();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sprintSettings.failedToSaveSprint'), '');
    } finally {
      setSavingSprint(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t('sprintSettings.sprintNameRequired'), '');
      return;
    }
    if (!formData.start_date) {
      toast.error(t('sprintSettings.startDateRequired'), '');
      return;
    }
    if (!formData.end_date) {
      toast.error(t('sprintSettings.endDateRequired'), '');
      return;
    }
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      toast.error(t('sprintSettings.endDateAfterStartDate'), '');
      return;
    }

    const wasActive = editingId
      ? Boolean(sprints.find((s) => s.id === editingId)?.is_active)
      : false;
    const becomingActive = Boolean(formData.is_active) && !wasActive;

    try {
      if (becomingActive) {
        const offer = await fetchSprintTransferOffer({
          excludeSprintId: editingId || undefined,
          sprints,
        });
        if (offer) {
          pendingActivateRef.current = {
            mode: editingId ? 'update' : 'create',
            sprintId: editingId || undefined,
            payload: { ...formData },
          };
          setTransferToName(formData.name.trim());
          setTransferOffer(offer);
          return;
        }
      }
      await commitSprintPayload(formData, {
        sprintId: editingId || undefined,
        transfer: false,
        selectAfter: false,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sprintSettings.failedToSaveSprint'), '');
    }
  };

  const handleDelete = async (id: string, event?: React.MouseEvent<HTMLButtonElement>) => {
    // Capture button geometry before any await — after await, React's synthetic event
    // target is cleared, so the confirmation portal (which requires positions) never mounted.
    let position: { top: number; left: number; maxHeight?: number } | null = null;
    const target = event?.currentTarget;
    if (target) {
      const buttonRect = target.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const modalHeight = 150;
      const spacing = 5;

      let top = buttonRect.bottom + window.scrollY + spacing;
      let left = buttonRect.left + window.scrollX;
      let maxHeight: number | undefined;

      if (buttonRect.bottom + modalHeight > viewportHeight) {
        top = buttonRect.top + window.scrollY - modalHeight - spacing;
        if (top < window.scrollY) {
          top = window.scrollY + spacing;
          maxHeight = viewportHeight - (top - window.scrollY) - spacing * 2;
        }
      }

      const modalWidth = 250;
      if (left + modalWidth > window.innerWidth) {
        left = window.innerWidth - modalWidth - spacing;
      }
      if (left < 0) {
        left = spacing;
      }

      position = { top, left, maxHeight };
    }

    try {
      const usageData = await getSprintUsage(id);
      setSprintUsageCounts(prev => ({ ...prev, [id]: usageData.count }));
    } catch (error) {
      console.error('Failed to get sprint usage:', error);
      setSprintUsageCounts(prev => ({ ...prev, [id]: 0 }));
    }

    const fallbackPosition = {
      top: window.scrollY + Math.max(16, window.innerHeight / 2 - 75),
      left: window.scrollX + Math.max(16, window.innerWidth / 2 - 125)
    };
    setDeleteButtonPositions(prev => ({
      ...prev,
      [id]: position ?? fallbackPosition
    }));
    setShowDeleteSprintConfirm(id);
  };

  const confirmDeleteSprint = async (id: string) => {
    try {
      const response = await deleteSprint(id);
      setSprints(await getAllSprints());
      setShowDeleteSprintConfirm(null);
      setDeleteButtonPositions(prev => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
      
      // Show success message with unassigned tasks info if applicable
      const unassignedCount = response?.unassignedTasks || 0;
      let successMessage = t('sprintSettings.sprintDeletedSuccessfully');
      if (unassignedCount > 0) {
        successMessage += ` (${t('sprintSettings.tasksUnassignedToBacklog', { count: unassignedCount })})`;
      }
      
      toast.success(successMessage, '');
      
      // Dispatch custom event to refresh sprints in App-level state
      window.dispatchEvent(new CustomEvent('sprints-updated'));
    } catch (error: any) {
      console.error('Failed to delete sprint:', error);
      
      // Extract specific error message from backend response
      let errorMessage = t('sprintSettings.failedToDeleteSprint');
      
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage, '');
    }
  };

  const cancelDeleteSprint = () => {
    setShowDeleteSprintConfirm(null);
    setDeleteButtonPositions(prev => {
      const updated = { ...prev };
      if (showDeleteSprintConfirm) {
        delete updated[showDeleteSprintConfirm];
      }
      return updated;
    });
  };

  const handleToggleActive = async (sprint: PlanningPeriod) => {
    const payload = {
      name: sprint.name,
      start_date: toDateInputValue(sprint.start_date),
      end_date: toDateInputValue(sprint.end_date),
      is_active: !sprint.is_active,
      description: sprint.description || '',
    };

    try {
      if (!sprint.is_active) {
        const offer = await fetchSprintTransferOffer({ excludeSprintId: sprint.id, sprints });
        if (offer) {
          pendingActivateRef.current = {
            mode: 'toggle',
            sprintId: sprint.id,
            payload,
          };
          setTransferToName(payload.name.trim());
          setTransferOffer(offer);
          return;
        }
      }
      await commitSprintPayload(payload, {
        sprintId: sprint.id,
        transfer: false,
        selectAfter: false,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sprintSettings.failedToUpdateSprint'), '');
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    // Handle null/undefined dates
    if (!dateString) {
      return '-';
    }

    const ymd = toDateInputValue(dateString);
    if (!ymd) return '-';

    // Parse as local date to avoid timezone offset issues
    const [year, month, day] = ymd.split('-').map(Number);
    if (!year || !month || !day) return '-';
    const date = new Date(year, month - 1, day); // month is 0-indexed
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div>
      {!isCreating && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={handleCreate}
            data-owner-setup="create-sprint"
            className="flex flex-shrink-0 items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('sprintSettings.createSprint')}
          </button>
        </div>
      )}


      {/* Create/Edit Form */}
      {(isCreating || editingId) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {editingId ? t('sprintSettings.editSprint') : t('sprintSettings.createNewSprint')}
          </h4>
          
          <SprintEditorFormFields formData={formData} onChange={setFormData} />

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {editingId ? t('sprintSettings.update') : t('sprintSettings.create')}
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
            >
              <X className="w-4 h-4" />
              {t('sprintSettings.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Sprints List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        {sprints.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400">{t('sprintSettings.noSprintsCreated')}</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
              {t('sprintSettings.noSprintsCreatedDescription')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('sprintSettings.actions')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('sprintSettings.sprintName')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('sprintSettings.startDate')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('sprintSettings.endDate')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('sprintSettings.tasksColumn')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('sprintSettings.status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {sprints.map((sprint) => (
                  <tr key={sprint.id} className={ADMIN_TABLE_ROW_CLASS}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(sprint)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          title={t('sprintSettings.edit')}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          data-sprint-id={sprint.id}
                          onClick={(e) => handleDelete(sprint.id, e)}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          title={t('sprintSettings.delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        
                        {/* Portal-based Delete Confirmation Dialog */}
                        {showDeleteSprintConfirm === sprint.id && deleteButtonPositions[sprint.id] && createPortal(
                          <div 
                            className="delete-confirmation fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 z-[9999] min-w-[16rem] max-w-sm"
                            style={{
                              top: `${deleteButtonPositions[sprint.id].top}px`,
                              left: `${deleteButtonPositions[sprint.id].left}px`,
                              maxHeight: deleteButtonPositions[sprint.id].maxHeight ? `${deleteButtonPositions[sprint.id].maxHeight}px` : '300px',
                              overflowY: 'auto'
                            }}
                          >
                            <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                              {(() => {
                                const taskCount = sprintUsageCounts[sprint.id] || 0;
                                const isActive = sprint.is_active === true;
                                return (
                                  <>
                                    <div className="font-medium mb-1">
                                      {isActive
                                        ? t('sprintSettings.deleteActiveTitle')
                                        : t('sprintSettings.deleteSprint')}
                                    </div>
                                    {isActive && (
                                      <div className="text-xs text-amber-800 dark:text-amber-200 mb-2">
                                        {t('sprintSettings.deleteActiveBody', { name: sprint.name })}
                                      </div>
                                    )}
                                    {taskCount > 0 ? (
                                      <div className="text-xs text-gray-700 dark:text-gray-400">
                                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                                          {t('sprintSettings.tasksUsingSprint', { count: taskCount })}
                                        </span>{' '}
                                        {t('sprintSettings.using')}{' '}
                                        <span className="font-medium">{sprint.name}</span>
                                        {' '}{t('sprintSettings.willBeUnassignedToBacklog')}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-600 dark:text-gray-400">
                                        {t('sprintSettings.noTasksUsing')}{' '}
                                        <span className="font-medium">{sprint.name}</span>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => confirmDeleteSprint(sprint.id)}
                                className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                              >
                                {sprint.is_active === true
                                  ? t('sprintSettings.deleteAnyway')
                                  : t('sprintSettings.yes')}
                              </button>
                              <button
                                onClick={cancelDeleteSprint}
                                className="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
                              >
                                {t('sprintSettings.cancel')}
                              </button>
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {sprint.name}
                        </div>
                        {sprint.description && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {sprint.description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(sprint.start_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(sprint.end_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm tabular-nums text-gray-600 dark:text-gray-400">
                      {Number(sprint.task_count) || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleActive(sprint)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          sprint.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {sprint.is_active ? t('sprintSettings.active') : t('sprintSettings.inactive')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
              {t('sprintSettings.aboutSprints')}
            </h4>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {t('sprintSettings.aboutSprintsDescription')}
            </p>
          </div>
        </div>
      </div>
      <SprintTransferConfirmDialog
        offer={transferOffer}
        toName={transferToName}
        busy={savingSprint}
        onMove={() => {
          const pending = pendingActivateRef.current;
          if (!pending) return;
          void commitSprintPayload(pending.payload, {
            sprintId: pending.sprintId,
            transfer: true,
            selectAfter: true,
          });
        }}
        onKeep={() => {
          const pending = pendingActivateRef.current;
          if (!pending) return;
          void commitSprintPayload(pending.payload, {
            sprintId: pending.sprintId,
            transfer: false,
            selectAfter: false,
          });
        }}
        onCancel={() => {
          setTransferOffer(null);
          pendingActivateRef.current = null;
        }}
      />
    </div>
  );
};

export default AdminSprintSettingsTab;

