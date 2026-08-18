import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { addTaskRelationship, removeTaskRelationship } from '../api';
import { toast } from '../utils/toast';

export interface TaskRelationshipRow {
  id: string;
  task_id: string;
  to_task_id: string;
  relationship: string;
  related_task_ticket?: string;
  related_task_title?: string;
  related_task_project_id?: string;
}

export interface AvailableRelationshipTask {
  id: string;
  ticket: string;
  title: string;
  projectId?: string;
}

interface TaskRelationshipLinkerProps {
  taskId: string;
  taskTicket: string;
  relationships: TaskRelationshipRow[];
  availableTasks: AvailableRelationshipTask[];
  canMutate: boolean;
  onRefresh: () => void | Promise<void>;
}

export default function TaskRelationshipLinker({
  taskId,
  taskTicket,
  relationships,
  availableTasks,
  canMutate,
  onRefresh,
}: TaskRelationshipLinkerProps) {
  const { t } = useTranslation('tasks');
  const [showRelatedDropdown, setShowRelatedDropdown] = useState(false);
  const [relatedSearchTerm, setRelatedSearchTerm] = useState('');
  const relatedDropdownRef = useRef<HTMLDivElement>(null);
  const addInFlightRef = useRef(false);

  const relatedTasks = useMemo(
    () =>
      relationships
        .filter((rel) => rel.relationship === 'related' && rel.task_id === taskId)
        .map((rel) => ({
          id: rel.to_task_id,
          ticket: rel.related_task_ticket || '',
          title: rel.related_task_title || '',
          projectId: rel.related_task_project_id,
          relationshipId: rel.id,
        })),
    [relationships, taskId]
  );

  const filteredAvailableRelated = useMemo(() => {
    const term = relatedSearchTerm.trim().toLowerCase();
    return availableTasks.filter((task) => {
      if (task.id === taskId) return false;
      if (relatedTasks.some((related) => related.id === task.id)) return false;
      if (!term) return true;
      return (
        task.ticket.toLowerCase().includes(term) ||
        task.title.toLowerCase().includes(term)
      );
    });
  }, [availableTasks, relatedSearchTerm, relatedTasks, taskId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (relatedDropdownRef.current && !relatedDropdownRef.current.contains(event.target as Node)) {
        setShowRelatedDropdown(false);
      }
    };
    if (showRelatedDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRelatedDropdown]);

  const handleAddRelatedTask = async (targetTaskId: string) => {
    if (!canMutate || addInFlightRef.current || targetTaskId === taskId) return;
    addInFlightRef.current = true;

    const targetTicket =
      availableTasks.find((task) => task.id === targetTaskId)?.ticket || targetTaskId;

    try {
      await addTaskRelationship(taskId, 'related', targetTaskId);
      toast.success(
        t('relationships.linkCreatedTitle'),
        t('relationships.linkCreatedMessage', {
          from: taskTicket,
          to: targetTicket,
          relationship: t('relationships.relationshipRelated'),
        })
      );
      setShowRelatedDropdown(false);
      setRelatedSearchTerm('');
      await onRefresh();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t('relationships.linkFailedTitle');
      toast.error(t('relationships.linkFailedTitle'), errorMessage);
    } finally {
      addInFlightRef.current = false;
    }
  };

  const handleRemoveRelated = async (relationshipId: string) => {
    if (!canMutate) return;
    try {
      await removeTaskRelationship(taskId, relationshipId);
      await onRefresh();
    } catch (error) {
      console.error('Failed to remove related task:', error);
    }
  };

  return (
    <div className="mt-3 border-t border-gray-200 dark:border-gray-600 pt-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        {t('relationships.relatedTasks')}
      </label>

      {relatedTasks.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {relatedTasks.map((related) => (
            <span
              key={related.id}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full font-medium bg-yellow-100 dark:bg-yellow-950 dark:ring-1 dark:ring-yellow-700/60 text-yellow-900 dark:text-yellow-100"
            >
              <span className="font-semibold">{related.ticket}</span>
              {canMutate && (
                <button
                  type="button"
                  onClick={() => void handleRemoveRelated(related.relationshipId)}
                  className="ml-1 text-yellow-800 dark:text-yellow-200 hover:bg-red-500 hover:text-white rounded-full w-3 h-3 flex items-center justify-center text-xs font-bold transition-colors"
                  title={t('relationships.removeRelated')}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canMutate && (
        <div className="relative" ref={relatedDropdownRef}>
          <button
            type="button"
            data-help-target="task-relationship-link-mode"
            onClick={() => setShowRelatedDropdown((open) => !open)}
            className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between text-gray-900 dark:text-gray-100"
          >
            <span className="text-gray-700 dark:text-gray-200">
              {t('relationships.addRelatedTask')}
            </span>
            <ChevronDown
              size={16}
              className={`transform transition-transform ${showRelatedDropdown ? 'rotate-180' : ''}`}
            />
          </button>

          {showRelatedDropdown && (
            <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto">
              <div className="p-2 border-b border-gray-200 dark:border-gray-600">
                <input
                  type="text"
                  placeholder={t('relationships.searchTasks')}
                  value={relatedSearchTerm}
                  onChange={(e) => setRelatedSearchTerm(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {filteredAvailableRelated.length > 0 ? (
                  filteredAvailableRelated.map((availableTask) => (
                    <button
                      key={availableTask.id}
                      type="button"
                      onClick={() => void handleAddRelatedTask(availableTask.id)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/35 focus:bg-blue-50 dark:focus:bg-blue-900/35 focus:outline-none transition-colors text-sm"
                    >
                      <div className="font-medium text-blue-600 dark:text-blue-400">{availableTask.ticket}</div>
                      <div className="text-gray-600 dark:text-gray-300 truncate">{availableTask.title}</div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    {relatedSearchTerm ? t('relationships.noTasksFound') : t('relationships.noAvailableTasks')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
