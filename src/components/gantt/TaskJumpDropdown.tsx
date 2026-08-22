import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface GanttTask {
  id: string;
  ticket: string;
  title: string;
  startDate: Date | null;
  endDate: Date | null;
  status: string;
  priority: string;
  priorityName?: string;
  columnId: string;
  columnPosition: number;
  taskPosition: number;
}

interface TaskJumpDropdownProps {
  tasks: GanttTask[];
  onTaskSelect: (task: GanttTask) => void;
  className?: string;
}

export const TaskJumpDropdown: React.FC<TaskJumpDropdownProps> = ({
  tasks,
  onTaskSelect,
  className = ''
}) => {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-US';
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter tasks based on search term
  const filteredTasks = useMemo(() => {
    if (!searchTerm.trim()) {
      return tasks.slice(0, 20); // Show first 20 tasks when no search
    }
    
    const searchLower = searchTerm.toLowerCase();
    return tasks
      .filter(task => 
        task.ticket.toLowerCase().includes(searchLower) ||
        task.title.toLowerCase().includes(searchLower) ||
        task.status.toLowerCase().includes(searchLower)
      )
      .slice(0, 50); // Limit to 50 results for performance
  }, [tasks, searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        setIsOpen(true);
        setSelectedIndex(0);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < filteredTasks.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && filteredTasks[selectedIndex]) {
          handleTaskSelect(filteredTasks[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSearchTerm('');
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleTaskSelect = (task: GanttTask) => {
    onTaskSelect(task);
    setIsOpen(false);
    setSearchTerm('');
    setSelectedIndex(-1);
    inputRef.current?.blur();
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: '#10B981',      // green
      medium: '#F59E0B',   // yellow
      high: '#EF4444',     // red
      urgent: '#DC2626'    // dark red
    };
    return colors[priority.toLowerCase()] || '#6B7280'; // default gray
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t('gantt.jumpToTaskPlaceholder')}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
        />
        
        {/* Dropdown Arrow */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg
            className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-y-auto">
          {filteredTasks.length > 0 ? (
            <>
              {/* Search Results Header */}
              {searchTerm && (
                <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                  {t('gantt.tasksFound', { count: filteredTasks.length })}
                </div>
              )}
              
              {/* Task List */}
              {filteredTasks.map((task, index) => (
                <div
                  key={task.id}
                  className={`px-3 py-2 cursor-pointer text-sm transition-colors duration-150 ${
                    index === selectedIndex 
                      ? 'bg-blue-50 text-blue-900' 
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleTaskSelect(task)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {/* Priority Indicator */}
                        <div 
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getPriorityColor(task.priorityName || task.priority) }}
                        />
                        
                        {/* Task Info */}
                        <div className="truncate">
                          <span className="font-medium text-gray-900">{task.ticket}</span>
                          <span className="text-gray-600">: {task.title}</span>
                        </div>
                      </div>
                      
                      {/* Secondary Info */}
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="bg-gray-100 px-2 py-0.5 rounded-md">{task.status}</span>
                        {task.startDate && task.endDate && (
                          <span>
                            {task.startDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} - {task.endDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              {searchTerm ? (
                <>
                  <div>{t('gantt.noTasksFoundFor', { searchTerm })}</div>
                  <div className="text-xs mt-1">{t('gantt.trySearchingBy')}</div>
                </>
              ) : (
                <>
                  <div>{t('gantt.noTasksAvailable')}</div>
                  <div className="text-xs mt-1">{t('gantt.createTasksWithDates')}</div>
                </>
              )}
            </div>
          )}
          
          {/* Keyboard Hints */}
          {filteredTasks.length > 0 && (
            <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
              {t('gantt.keyboardHints')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
