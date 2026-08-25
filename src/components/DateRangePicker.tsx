import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, formatToYYYYMMDD } from '../utils/dateUtils';

export type DateRangePickerSprint = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active?: boolean | number;
};

interface DateRangePickerProps {
  startDate: string;
  endDate: string | null | undefined;
  onDateChange: (startDate: string, endDate: string) => void;
  onClose: () => void;
  position: { left: number; top: number };
  /** Currently associated sprint (enables “apply sprint dates”). */
  sprint?: DateRangePickerSprint | null;
  /** Sprints for the in-calendar chooser when the task has no sprint. */
  availableSprints?: DateRangePickerSprint[];
  sprintsLoading?: boolean;
  /** Assign a sprint from the in-calendar chooser (no-sprint case). */
  onSprintSelect?: (sprint: DateRangePickerSprint) => void;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onDateChange,
  onClose,
  position,
  sprint,
  availableSprints = [],
  sprintsLoading = false,
  onSprintSelect,
}) => {
  const { t } = useTranslation(['common', 'tasks']);
  const [tempStartDate, setTempStartDate] = useState<string>(startDate || '');
  const [tempEndDate, setTempEndDate] = useState<string>(endDate || '');
  const [selectedStart, setSelectedStart] = useState<Date | null>(
    startDate ? parseLocalDate(startDate) : null
  );
  const [selectedEnd, setSelectedEnd] = useState<Date | null>(
    endDate ? parseLocalDate(endDate) : null
  );
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const date = startDate ? parseLocalDate(startDate) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [selectionMode, setSelectionMode] = useState<'start' | 'end'>('start');
  const [showSprintChooser, setShowSprintChooser] = useState(false);
  const [sprintSearchTerm, setSprintSearchTerm] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<{ left: number; top: number }>(position);

  const hasAssignedSprint = !!(sprint && sprint.start_date && sprint.end_date);

  // Keep the whole picker (including expanded sprint chooser) inside the viewport
  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      // Second frame: layout has settled after sprint chooser expand/collapse
      requestAnimationFrame(() => {
        if (cancelled || !pickerRef.current) return;

        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const pickerHeight = pickerRef.current.offsetHeight || 350;
        const pickerWidth = pickerRef.current.offsetWidth || 280;

        let newTop = position.top;
        let newLeft = position.left;

        // Prefer below the trigger; if it won't fit, slide up so the bottom stays on-screen
        if (newTop + pickerHeight > viewportHeight - 10) {
          newTop = Math.max(10, viewportHeight - pickerHeight - 10);
        }
        if (newTop < 10) {
          newTop = 10;
        }

        if (newLeft + pickerWidth > viewportWidth - 10) {
          newLeft = Math.max(10, viewportWidth - pickerWidth - 10);
        }
        if (newLeft < 10) {
          newLeft = 10;
        }

        setAdjustedPosition({ left: newLeft, top: newTop });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [position, showSprintChooser, sprintsLoading, availableSprints.length]);

  // Close on outside click and handle ESC key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-task-date-trigger]')) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Update temp dates when props change
  useEffect(() => {
    setTempStartDate(startDate || '');
    setTempEndDate(endDate || '');
    setSelectedStart(startDate ? parseLocalDate(startDate) : null);
    setSelectedEnd(endDate ? parseLocalDate(endDate) : null);
  }, [startDate, endDate]);

  // Get days in month
  const daysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  // Get first day of month (0 = Sunday, 1 = Monday, etc.)
  const firstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  // Navigate months
  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev);
      if (direction === 'prev') {
        newMonth.setMonth(prev.getMonth() - 1);
      } else {
        newMonth.setMonth(prev.getMonth() + 1);
      }
      return newMonth;
    });
  };

  // Handle date selection from calendar
  const handleDateClick = (day: number) => {
    const clickedDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    
    if (selectionMode === 'start' || !selectedStart || clickedDate < selectedStart) {
      // Starting new selection or clicking before start date
      const dateStr = formatToYYYYMMDD(clickedDate.toISOString());
      setSelectedStart(clickedDate);
      setTempStartDate(dateStr);
      
      // Preserve existing end date if it's already set, otherwise clear it
      if (tempEndDate && selectedEnd) {
        // Keep existing end date - user can change it if they want
        setSelectionMode('end');
      } else {
        // No end date set, clear it and wait for user to select
        setSelectedEnd(null);
        setTempEndDate('');
        setSelectionMode('end');
      }
    } else {
      // Selecting end date
      const endStr = formatToYYYYMMDD(clickedDate.toISOString());
      const startStr = formatToYYYYMMDD(selectedStart.toISOString());
      
      // If same date selected, set both to same value
      if (clickedDate.getTime() === selectedStart.getTime()) {
        setSelectedEnd(clickedDate);
        setTempStartDate(startStr);
        setTempEndDate(startStr); // Same as start
        setSelectionMode('start');
        // Apply changes immediately
        onDateChange(startStr, startStr);
        onClose();
      } else {
        setSelectedEnd(clickedDate);
        setSelectionMode('start');
        setTempStartDate(startStr);
        setTempEndDate(endStr);
        // Apply changes
        onDateChange(startStr, endStr);
        onClose();
      }
    }
  };

  // Handle text input changes
  const handleStartDateInputChange = (value: string) => {
    setTempStartDate(value);
    if (value && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const date = parseLocalDate(value);
      setSelectedStart(date);
      setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      // Preserve existing end date - don't clear it
      // Only switch to end mode if there's no end date, otherwise stay in current mode
      if (!tempEndDate || !selectedEnd) {
        setSelectionMode('end');
      }
    } else if (!value) {
      // If start date is cleared, also clear selected start
      setSelectedStart(null);
    }
  };

  const handleEndDateInputChange = (value: string) => {
    setTempEndDate(value);
    if (value && value.match(/^\d{4}-\d{2}-\d{2}$/) && selectedStart) {
      const date = parseLocalDate(value);
      setSelectedEnd(date);
    }
  };

  // Apply changes from text inputs
  const handleApply = () => {
    if (tempStartDate) {
      // If only start date is provided, set both to same value
      const endDate = tempEndDate || tempStartDate;
      onDateChange(tempStartDate, endDate);
      onClose();
    }
  };

  // Handle keyboard shortcuts (only when not focused on input fields)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't handle if typing in an input field (let inputs handle their own keys)
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') {
      return;
    }

    // Handle keyboard shortcuts when not in input
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        handleApply();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        navigateMonth('prev');
        break;
      case 'ArrowRight':
        e.preventDefault();
        navigateMonth('next');
        break;
      default:
        break;
    }
  };

  // Clear dates
  const handleClear = () => {
    setTempStartDate('');
    setTempEndDate('');
    setSelectedStart(null);
    setSelectedEnd(null);
    setSelectionMode('start');
  };

  // Apply sprint dates
  const applySprintDateRange = (sprintData: DateRangePickerSprint) => {
    if (!sprintData.start_date || !sprintData.end_date) return;

    const sprintStartStr = formatToYYYYMMDD(sprintData.start_date);
    const sprintEndStr = formatToYYYYMMDD(sprintData.end_date);

    setTempStartDate(sprintStartStr);
    setTempEndDate(sprintEndStr);

    const sprintStart = parseLocalDate(sprintData.start_date);
    const sprintEnd = parseLocalDate(sprintData.end_date);
    setSelectedStart(sprintStart);
    setSelectedEnd(sprintEnd);
    setCurrentMonth(new Date(sprintStart.getFullYear(), sprintStart.getMonth(), 1));
    setSelectionMode('end');

    onDateChange(sprintStartStr, sprintEndStr);
    onClose();
  };

  const handleApplySprintDates = () => {
    if (!sprint || !sprint.start_date || !sprint.end_date) return;
    applySprintDateRange(sprint);
  };

  const handleSprintButtonClick = () => {
    if (hasAssignedSprint) {
      handleApplySprintDates();
      return;
    }
    setShowSprintChooser((prev) => !prev);
  };

  const handleChooseSprint = (chosen: DateRangePickerSprint) => {
    if (onSprintSelect) {
      // Parent assigns sprintId + dates (same as card sprint picker)
      onSprintSelect(chosen);
      onClose();
      return;
    }
    applySprintDateRange(chosen);
  };

  const filteredSprints = availableSprints.filter((s) =>
    s.name.toLowerCase().includes(sprintSearchTerm.toLowerCase())
  );

  // Generate calendar days
  const generateCalendarDays = () => {
    const days: (number | null)[] = [];
    const firstDay = firstDayOfMonth(currentMonth);
    const daysCount = daysInMonth(currentMonth);

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysCount; day++) {
      days.push(day);
    }

    return days;
  };

  // Check if date is in range
  const isDateInRange = (day: number): boolean => {
    if (!selectedStart || !selectedEnd) return false;
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    return date >= selectedStart && date <= selectedEnd;
  };

  // Check if date is selected (only current selectedStart and selectedEnd, not previous ones)
  const isDateSelected = (day: number): boolean => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    // Normalize dates to compare only date part (ignore time)
    const normalizeDate = (d: Date) => {
      const normalized = new Date(d);
      normalized.setHours(0, 0, 0, 0);
      return normalized;
    };
    
    const normalizedDate = normalizeDate(date);
    if (selectedStart && normalizeDate(selectedStart).getTime() === normalizedDate.getTime()) return true;
    if (selectedEnd && normalizeDate(selectedEnd).getTime() === normalizedDate.getTime()) return true;
    return false;
  };

  // Check if date is today
  const isToday = (day: number): boolean => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const calendarDays = generateCalendarDays();
  const monthNames = [
    t('dateRangePicker.months.january'),
    t('dateRangePicker.months.february'),
    t('dateRangePicker.months.march'),
    t('dateRangePicker.months.april'),
    t('dateRangePicker.months.may'),
    t('dateRangePicker.months.june'),
    t('dateRangePicker.months.july'),
    t('dateRangePicker.months.august'),
    t('dateRangePicker.months.september'),
    t('dateRangePicker.months.october'),
    t('dateRangePicker.months.november'),
    t('dateRangePicker.months.december')
  ];
  const dayNames = [
    t('dateRangePicker.days.sun'),
    t('dateRangePicker.days.mon'),
    t('dateRangePicker.days.tue'),
    t('dateRangePicker.days.wed'),
    t('dateRangePicker.days.thu'),
    t('dateRangePicker.days.fri'),
    t('dateRangePicker.days.sat')
  ];

  return createPortal(
    <div
      ref={pickerRef}
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-2xl z-[9999] p-2 overflow-y-auto"
      style={{
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
        width: '280px',
        maxHeight: 'calc(100vh - 20px)',
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100">{t('dateRangePicker.title')}</h3>
        <button
          onClick={onClose}
          className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
        >
          <X size={14} className="text-gray-500 dark:text-gray-400" />
        </button>
      </div>

      {/* Text Inputs */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div>
          <label className={`block text-[10px] mb-0.5 ${selectionMode === 'start' ? 'font-bold text-blue-600 dark:text-blue-400' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
            {t('dateRangePicker.startDate')}
          </label>
          <input
            type="text"
            value={tempStartDate}
            onChange={(e) => handleStartDateInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
              }
            }}
            className="w-full px-1.5 py-1 text-[10px] border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            placeholder="YYYY-MM-DD"
            pattern="\d{4}-\d{2}-\d{2}"
          />
        </div>
        <div>
          <label className={`block text-[10px] mb-0.5 ${selectionMode === 'end' ? 'font-bold text-blue-600 dark:text-blue-400' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
            {t('dateRangePicker.endDate')}
          </label>
          <input
            type="text"
            value={tempEndDate}
            onChange={(e) => handleEndDateInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
              }
            }}
            className="w-full px-1.5 py-1 text-[10px] border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            placeholder="YYYY-MM-DD"
            pattern="\d{4}-\d{2}-\d{2}"
          />
        </div>
      </div>

      {/* Calendar */}
      <div className="mb-2">
        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-1.5">
          <button
            onClick={() => navigateMonth('prev')}
            className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <ChevronLeft size={12} className="text-gray-600 dark:text-gray-400" />
          </button>
          <div className="text-[11px] font-medium text-gray-900 dark:text-gray-100">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </div>
          <button
            onClick={() => navigateMonth('next')}
            className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <ChevronRight size={12} className="text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {dayNames.map(day => (
            <div
              key={day}
              className="text-[9px] font-medium text-gray-500 dark:text-gray-400 text-center py-0.5"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {calendarDays.map((day, index) => {
            if (day === null) {
              return <div key={`empty-${index}`} className="aspect-square" />;
            }

            const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
            const inRange = isDateInRange(day);
            const selected = isDateSelected(day);
            const today = isToday(day);

            return (
              <button
                key={day}
                onClick={() => handleDateClick(day)}
                className={`
                  aspect-square text-[10px] font-medium rounded transition-colors
                  ${selected
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : inRange
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                  ${today && !selected ? 'ring-1 ring-gray-400 dark:ring-gray-500' : ''}
                  ${selectionMode === 'end' && selectedStart && date < selectedStart ? 'opacity-40' : ''}
                `}
                disabled={selectionMode === 'end' && selectedStart ? date < selectedStart : false}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-1.5">
          <button
            onClick={handleClear}
            className="px-2 py-1 text-[10px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            {t('dateRangePicker.clear')}
          </button>
          <div className="flex gap-1.5">
            {/* Sprint: apply dates when assigned; otherwise open in-calendar sprint chooser */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSprintButtonClick();
              }}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors border ${
                showSprintChooser && !hasAssignedSprint
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-600'
                  : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50'
              }`}
              title={
                hasAssignedSprint
                  ? `${t('dateRangePicker.applySprintDates')}: ${sprint!.name}`
                  : t('dateRangePicker.chooseSprint')
              }
            >
              {t('dateRangePicker.sprint')}
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 text-[10px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {t('dateRangePicker.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={!tempStartDate}
              className="px-2 py-1 text-[10px] font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('dateRangePicker.apply')}
            </button>
          </div>
        </div>

        {/* In-calendar sprint chooser (task has no sprint) */}
        {showSprintChooser && !hasAssignedSprint && (
          <div
            className="mt-1 max-h-40 overflow-hidden rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5 border-b border-gray-200 dark:border-gray-600">
              <input
                type="text"
                value={sprintSearchTerm}
                onChange={(e) => setSprintSearchTerm(e.target.value)}
                placeholder={t('taskCard.searchSprints', { ns: 'tasks' })}
                className="w-full px-2 py-1 text-[11px] border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                autoFocus
              />
            </div>
            <div className="max-h-28 overflow-y-auto">
              {sprintsLoading ? (
                <div className="px-2 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {t('taskCard.loadingSprints', { ns: 'tasks' })}
                </div>
              ) : filteredSprints.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {t('taskCard.noSprintsAvailable', { ns: 'tasks' })}
                </div>
              ) : (
                filteredSprints.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleChooseSprint(s);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      s.is_active === 1 || s.is_active === true
                        ? 'bg-green-50 dark:bg-green-900/10'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-gray-900 dark:text-white truncate">
                        {s.name}
                      </span>
                      {(s.is_active === 1 || s.is_active === true) && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-green-500 text-white">
                          {t('taskCard.active', { ns: 'tasks' })}
                        </span>
                      )}
                    </div>
                    {(s.start_date || s.end_date) && (
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                        {s.start_date ? formatToYYYYMMDD(s.start_date) : '—'}
                        {' → '}
                        {s.end_date ? formatToYYYYMMDD(s.end_date) : '—'}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default DateRangePicker;
