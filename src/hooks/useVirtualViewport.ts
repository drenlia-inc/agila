import { useState, useEffect, useCallback, useRef } from 'react';
import { useBackgroundLoader } from './useBackgroundLoader';
import { usePerformanceMonitor } from './usePerformanceMonitor';
import { useWebWorker } from './useWebWorker';
import { parseLocalDate } from '../utils/dateUtils';

export interface DateColumn {
  date: Date;
  isToday: boolean;
  isWeekend: boolean;
}

export interface VirtualViewport {
  startIndex: number;
  endIndex: number;
  totalRange: number;
  visibleDates: DateColumn[];
  canLoadEarlier: boolean;
  canLoadLater: boolean;
}

interface UseVirtualViewportOptions {
  initialDays?: number;        // Initial number of days to load (default: 120)
  bufferDays?: number;         // Buffer days on each side (default: 20)
  chunkSize?: number;          // Days to load per chunk (default: 30)
  maxDays?: number;            // Maximum days to keep in memory (default: 120)
  daysBeforeToday?: number;    // Days before today in initial load (default: 0)
  allTasks?: any[];            // All tasks to position (loaded once)
  isDuringDrag?: boolean;      // Prevent viewport reinitialization during drag operations
  boardId?: string;            // Board identifier to detect tab switches
}

interface TaskPosition {
  taskId: string;
  startDateIndex: number;      // Absolute position from timeline start
  endDateIndex: number;        // Absolute position from timeline start
  task: any;                   // The actual task object
}

export const useVirtualViewport = (options: UseVirtualViewportOptions = {}) => {
  const {
    initialDays = 120,
    bufferDays = 20,
    chunkSize = 30,
    maxDays = 120,
    daysBeforeToday = 0,
    allTasks = [],
    isDuringDrag = false,
    boardId = 'default'
  } = options;

  // Performance monitoring
  const { recordMetric, measureFunction, startMeasurement } = usePerformanceMonitor({
    enableConsoleLog: false,
    sampleRate: 0.1 // Sample 10% of operations
  });

  // Background loading for non-critical operations
  const { addTask } = useBackgroundLoader({
    timeout: 5000
  });

  // Web Worker for heavy computations
  const { 
    generateDates: workerGenerateDates, 
    isWorkerSupported,
    getWorkerStatus 
  } = useWebWorker({
    timeout: 8000,
    fallbackToMainThread: true
  });

  // Core state
  const [dateRange, setDateRange] = useState<DateColumn[]>([]);
  const [viewportStart, setViewportStart] = useState(0);
  const [viewportEnd, setViewportEnd] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [initializedBoardId, setInitializedBoardId] = useState<string | null>(null);
  
  // Task positioning state
  const [taskPositions, setTaskPositions] = useState<TaskPosition[]>([]);
  const [timelineStartDate, setTimelineStartDate] = useState<Date | null>(null); // Absolute timeline start
  
  // Refs for scroll tracking
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dateColumnWidth = 20; // Minimum width per date column
  
  // Calculate absolute positions for all tasks (once when tasks change)
  const calculateTaskPositions = useCallback((tasks: any[], startDate: Date): TaskPosition[] => {
    if (!tasks || tasks.length === 0 || !startDate) return [];
    
    return tasks.map(task => {
      const taskStartDate = task.startDate ? parseLocalDate(task.startDate) : null;
      const taskEndDate = task.endDate ? parseLocalDate(task.endDate) : null;
      
      if (!taskStartDate) {
        return null; // Skip tasks without start dates
      }
      
      // Calculate absolute position from timeline start
      const startDateIndex = Math.floor((taskStartDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const endDateIndex = taskEndDate 
        ? Math.floor((taskEndDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        : startDateIndex + 1; // Default to 1 day if no end date
      
      return {
        taskId: task.id,
        startDateIndex,
        endDateIndex,
        task
      };
    }).filter(Boolean) as TaskPosition[];
  }, []);
  
  // Generate date columns (main thread fallback)
  const generateDateRangeMainThread = useCallback(measureFunction((startDaysOffset: number, numDays: number): DateColumn[] => {
    const dates: DateColumn[] = [];
    const today = new Date();
    const todayString = today.toDateString();
    
    // Pre-allocate array for better performance
    dates.length = numDays;
    
    for (let i = 0; i < numDays; i++) {
      const currentDate = new Date(
        today.getFullYear(), 
        today.getMonth(), 
        today.getDate() + startDaysOffset + i
      );
      
      const dayOfWeek = currentDate.getDay();
      
      dates[i] = {
        date: currentDate,
        isToday: currentDate.toDateString() === todayString,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6
      };
    }
    
    return dates;
  }, 'generateDateRange', 'computation'), [measureFunction]);

  // Generate date columns (Web Worker or main thread)
  const generateDateRange = useCallback(async (startDaysOffset: number, numDays: number): Promise<DateColumn[]> => {
    // Use Web Worker for large datasets if supported
    if (isWorkerSupported && numDays > 50) {
      try {
        const workerResult = await workerGenerateDates(startDaysOffset, numDays);
        
        // Convert serialized dates back to Date objects
        return workerResult.map((item: any) => ({
          date: new Date(item.date),
          isToday: item.isToday,
          isWeekend: item.isWeekend
        }));
      } catch (error) {
        console.warn('Worker date generation failed, falling back to main thread:', error);
        // Fall back to main thread
        return generateDateRangeMainThread(startDaysOffset, numDays);
      }
    } else {
      // Use main thread for small datasets or when worker not supported
      return generateDateRangeMainThread(startDaysOffset, numDays);
    }
  }, [isWorkerSupported, workerGenerateDates, generateDateRangeMainThread]);

  // Calculate task positions when tasks change
  useEffect(() => {
    if (allTasks.length > 0 && timelineStartDate) {
      const positions = calculateTaskPositions(allTasks, timelineStartDate);
      setTaskPositions(positions);
    }
  }, [allTasks, timelineStartDate, calculateTaskPositions]);

  // Initialize date range on board switch or first load - SIMPLE and RELIABLE
  useEffect(() => {
    // Don't initialize during drag operations to prevent viewport shifts
    if (isDuringDrag) return;
    
    // Only initialize if this is a different board than we've initialized before
    // This allows tab switching while preventing reinitialization during work
    if (initializedBoardId === boardId) return;
    
    const initializeDateRange = async () => {
      // Mark this specific board as initialized
      setInitializedBoardId(boardId);
      
      // SIMPLIFIED: Always start centered on today with 60 days before and 60 days after
      // This is predictable, reliable, and works the same for everyone
      const daysFromToday = -Math.floor(initialDays / 2); // -60 days from today
      const today = new Date();
      const absoluteStartDate = new Date(today.getTime() + daysFromToday * 24 * 60 * 60 * 1000);
      
      // Set the absolute timeline start date for task positioning
      setTimelineStartDate(absoluteStartDate);
      
      try {
        const initialDates = await generateDateRange(daysFromToday, initialDays);
        setDateRange(initialDates);
      } catch (error) {
        console.error('Failed to initialize date range:', error);
        // Fallback to main thread generation
        const fallbackDates = generateDateRangeMainThread(daysFromToday, initialDays);
        setDateRange(fallbackDates);
      }
    };
    
    initializeDateRange();
  }, [isDuringDrag, boardId, initializedBoardId, initialDays, generateDateRange, generateDateRangeMainThread]);

  // Calculate viewport based on scroll position (optimized)
  const updateViewport = useCallback(measureFunction(() => {
    if (!scrollContainerRef.current || dateRange.length === 0) return;
    
    const container = scrollContainerRef.current;
    const scrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;
    
    // Calculate which date indices are visible
    const startIndex = Math.max(0, Math.floor(scrollLeft / dateColumnWidth) - bufferDays);
    const endIndex = Math.min(
      dateRange.length - 1, 
      Math.ceil((scrollLeft + containerWidth) / dateColumnWidth) + bufferDays
    );
    
    // Only update if values actually changed (prevent unnecessary re-renders)
    setViewportStart(prev => prev !== startIndex ? startIndex : prev);
    setViewportEnd(prev => prev !== endIndex ? endIndex : prev);
  }, 'updateViewport', 'computation'), [dateRange.length, bufferDays, measureFunction]);

  // Load more dates in the past (before current range) - optimized with background loading
  const loadEarlier = useCallback(async () => {
    if (isLoading || dateRange.length === 0) return;
    
    const measurement = startMeasurement('loadEarlier');
    setIsLoading(true);
    
    try {
      // Schedule heavy computation as background task
      addTask({
        id: `load-earlier-${Date.now()}`,
        priority: 'high',
        task: async () => {
          try {
            // Calculate offset for new dates (before current range)
            const firstDate = dateRange[0].date;
            const today = new Date();
            const currentStartOffset = Math.floor((firstDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const newStartOffset = currentStartOffset - chunkSize;
            
            // Generate new dates (using Web Worker if available)
            const newDates = await generateDateRange(newStartOffset, chunkSize);
            
            // Prepend to existing range
            const updatedRange = [...newDates, ...dateRange];
            
            // Always limit to maxDays - flush from the right side
            const finalRange = updatedRange.length > maxDays 
              ? updatedRange.slice(0, maxDays)
              : updatedRange;
            
            // Update state in next tick to avoid blocking
            setTimeout(() => {
              setDateRange(finalRange);
              
              // Update absolute timeline start date (extended backwards)
              if (timelineStartDate && newDates.length > 0) {
                const newTimelineStart = new Date(timelineStartDate.getTime() - (chunkSize * 24 * 60 * 60 * 1000));
                setTimelineStartDate(newTimelineStart);
              }
              
              // Adjust viewport indices since we prepended dates
              setViewportStart(prev => prev + chunkSize);
              setViewportEnd(prev => prev + chunkSize);
              
              // Maintain scroll position
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollLeft += chunkSize * dateColumnWidth;
              }
              
              setIsLoading(false);
              measurement.end('computation');
            }, 0);
          } catch (error) {
            console.error('Failed to load earlier dates:', error);
            setIsLoading(false);
            measurement.end('computation');
          }
        }
      });
    } catch (error) {
      setIsLoading(false);
      measurement.end('computation');
      console.error('Failed to load earlier dates:', error);
    }
  }, [dateRange, generateDateRange, chunkSize, addTask, startMeasurement]);

  // Load more dates in the future (after current range) - optimized with background loading
  const loadLater = useCallback(async () => {
    if (isLoading || dateRange.length === 0) return;
    
    const measurement = startMeasurement('loadLater');
    setIsLoading(true);
    
    try {
      // Schedule heavy computation as background task
      addTask({
        id: `load-later-${Date.now()}`,
        priority: 'high',
        task: async () => {
          try {
            // Calculate offset for new dates (after current range)
            const lastDate = dateRange[dateRange.length - 1].date;
            const today = new Date();
            const lastDateOffset = Math.floor((lastDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const newStartOffset = lastDateOffset + 1;
          
            // Generate new dates (using Web Worker if available)
            const newDates = await generateDateRange(newStartOffset, chunkSize);
          
            // Append to existing range
            const updatedRange = [...dateRange, ...newDates];
            
            // Always limit to maxDays - flush from the left side
            const finalRange = updatedRange.length > maxDays 
              ? updatedRange.slice(-maxDays)
              : updatedRange;
          
          // Update state in next tick to avoid blocking
          setTimeout(() => {
            setDateRange(finalRange);
            
            // Adjust viewport if we trimmed from the beginning
            if (updatedRange.length > maxDays) {
              const trimmed = updatedRange.length - maxDays;
              setViewportStart(prev => Math.max(0, prev - trimmed));
              setViewportEnd(prev => Math.max(0, prev - trimmed));
              
              // Adjust scroll position
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollLeft -= trimmed * dateColumnWidth;
              }
            }
            
            setIsLoading(false);
            measurement.end('computation');
          }, 0);
          } catch (error) {
            console.error('Failed to load later dates:', error);
            setIsLoading(false);
            measurement.end('computation');
          }
        }
      });
    } catch (error) {
      setIsLoading(false);
      measurement.end('computation');
      console.error('Failed to load later dates:', error);
    }
  }, [dateRange, generateDateRange, chunkSize, addTask, startMeasurement]);

  // DISABLED: Automatic loading was causing infinite scroll - use manual buttons only
  // Manual infinite scroll: Load more dates when user scrolls near edges (user-controlled)
  // useEffect(() => {
  //   if (dateRange.length === 0 || isLoading) return;
  //   
  //   // Only trigger loading when user is very close to edges (smaller threshold = less aggressive)
  //   const loadThreshold = 5; // Load when within 5 columns of edge (very conservative)
  //   
  //   // Heavy debounce to prevent cascading loads
  //   const timeoutId = setTimeout(() => {
  //     // Load earlier only if user scrolled very close to start
  //     if (viewportStart <= loadThreshold && viewportStart >= 0) {
  //       console.log('User scrolled near start, loading earlier dates...');
  //       loadEarlier();
  //     }
  //     
  //     // Load later only if user scrolled very close to end  
  //     if (viewportEnd >= dateRange.length - loadThreshold) {
  //       console.log('User scrolled near end, loading later dates...');
  //       loadLater();
  //     }
  //   }, 500); // 500ms debounce - much more conservative
  //   
  //   return () => clearTimeout(timeoutId);
  // }, [viewportStart, viewportEnd, dateRange.length, isLoading, loadEarlier, loadLater]);

  // Set up scroll event listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      updateViewport();
    };
    
    // Update viewport on mount and when container changes
    updateViewport();
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [updateViewport]);

  // Calculate virtual viewport data
  // Get tasks that are visible in current viewport (based on absolute positions)
  const getVisibleTasks = useCallback(() => {
    if (!timelineStartDate || taskPositions.length === 0) return [];
    
    // Calculate absolute start index of current timeline window
    const currentWindowStart = dateRange.length > 0 
      ? Math.floor((dateRange[0].date.getTime() - timelineStartDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    // Get tasks that intersect with current timeline window
    return taskPositions.filter(taskPos => {
      const taskStartInWindow = taskPos.startDateIndex - currentWindowStart;
      const taskEndInWindow = taskPos.endDateIndex - currentWindowStart;
      
      // Task intersects if it starts before window ends AND ends after window starts
      return taskStartInWindow < dateRange.length && taskEndInWindow >= 0;
    }).map(taskPos => ({
      ...taskPos.task,
      // Add position info relative to current window
      startIndex: taskPos.startDateIndex - currentWindowStart,
      endIndex: taskPos.endDateIndex - currentWindowStart
    }));
  }, [taskPositions, dateRange, timelineStartDate]);

  const virtualViewport: VirtualViewport = {
    startIndex: viewportStart,
    endIndex: viewportEnd,
    totalRange: dateRange.length,
    visibleDates: dateRange.slice(viewportStart, viewportEnd + 1),
    canLoadEarlier: true, // Always allow scrolling to past
    canLoadLater: true    // Always allow scrolling to future
  };

  return {
    // Core data
    dateRange,
    virtualViewport,
    
    // Task positioning
    getVisibleTasks,
    taskPositions,
    timelineStartDate,
    
    // Refs
    scrollContainerRef,
    
    // Actions
    loadEarlier,
    loadLater,
    updateViewport,
    
    // State
    isLoading,
    
    // Utilities
    getDateIndex: (date: Date) => {
      return dateRange.findIndex(d => 
        d.date.toDateString() === date.toDateString()
      );
    },
    
    scrollToDate: (date: Date) => {
      const index = dateRange.findIndex(d => 
        d.date.toDateString() === date.toDateString()
      );
      
      if (index >= 0 && scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = index * dateColumnWidth;
      }
    },

    scrollToTask: async (taskStartDate: Date, taskEndDate: Date, positioning: 'start-left' | 'end-right' | 'center' = 'center') => {
      // Find if the task dates are in the current range
      const startIndex = dateRange.findIndex(d => 
        d.date.toDateString() === taskStartDate.toDateString()
      );
      const endIndex = dateRange.findIndex(d => 
        d.date.toDateString() === taskEndDate.toDateString()
      );
      
      if (startIndex >= 0) {
        // Task is already in range, just scroll to it
        if (scrollContainerRef.current) {
          const containerWidth = scrollContainerRef.current.clientWidth;
          let scrollPosition = 0;
          
          if (positioning === 'start-left') {
            // Position task start date at the first visible column (left edge)
            scrollPosition = Math.max(0, startIndex * dateColumnWidth);
          } else if (positioning === 'end-right' && endIndex >= 0) {
            // Position task end date at the rightmost visible column (right edge)
            const columnsVisible = Math.floor(containerWidth / dateColumnWidth);
            scrollPosition = Math.max(0, (endIndex - columnsVisible + 1) * dateColumnWidth);
          } else {
            // Default: center the task in the viewport
            const taskCenter = startIndex * dateColumnWidth;
            scrollPosition = Math.max(0, taskCenter - containerWidth / 2);
          }
          
          scrollContainerRef.current.scrollLeft = scrollPosition;
        }
      } else {
        // Task is not in current range, need to load it
        const today = new Date();
        const daysFromToday = Math.floor((taskStartDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        try {
          // Generate a new date range around the task
          let rangeStart, rangeSize;
          
          if (positioning === 'start-left') {
            // Load range starting from the task start date
            rangeStart = daysFromToday;
            rangeSize = 121;
          } else if (positioning === 'end-right') {
            // Load range ending at the task end date
            const endDaysFromToday = Math.floor((taskEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            rangeStart = endDaysFromToday - 120; // 120 days before task end
            rangeSize = 121;
          } else {
            // Default: center around task start
            rangeStart = daysFromToday - 60; // 60 days before task
            rangeSize = 121; // 121 days total (task will be roughly centered)
          }
          
          const newDates = await generateDateRange(rangeStart, rangeSize);
          setDateRange(newDates);
          
          // After setting new range, scroll to the task with proper positioning
          setTimeout(() => {
            const newStartIndex = newDates.findIndex(d => 
              d.date.toDateString() === taskStartDate.toDateString()
            );
            const newEndIndex = newDates.findIndex(d => 
              d.date.toDateString() === taskEndDate.toDateString()
            );
            
            if (newStartIndex >= 0 && scrollContainerRef.current) {
              const containerWidth = scrollContainerRef.current.clientWidth;
              let scrollPosition = 0;
              
              if (positioning === 'start-left') {
                // Position task start date at the first visible column
                scrollPosition = Math.max(0, newStartIndex * dateColumnWidth);
              } else if (positioning === 'end-right' && newEndIndex >= 0) {
                // Position task end date at the rightmost visible column
                const columnsVisible = Math.floor(containerWidth / dateColumnWidth);
                scrollPosition = Math.max(0, (newEndIndex - columnsVisible + 1) * dateColumnWidth);
              } else {
                // Default: center the task
                const taskCenter = newStartIndex * dateColumnWidth;
                scrollPosition = Math.max(0, taskCenter - containerWidth / 2);
              }
              
              scrollContainerRef.current.scrollLeft = scrollPosition;
            }
          }, 100); // Small delay to ensure DOM update
          
        } catch (error) {
          console.error('Failed to load task date range:', error);
          // Fallback: try with main thread generation
          let rangeStart, rangeSize;
          
          if (positioning === 'start-left') {
            rangeStart = daysFromToday;
            rangeSize = 121;
          } else if (positioning === 'end-right') {
            const endDaysFromToday = Math.floor((taskEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            rangeStart = endDaysFromToday - 120;
            rangeSize = 121;
          } else {
            rangeStart = daysFromToday - 60;
            rangeSize = 121;
          }
          
          const fallbackDates = generateDateRangeMainThread(rangeStart, rangeSize);
          setDateRange(fallbackDates);
          
          setTimeout(() => {
            const newStartIndex = fallbackDates.findIndex(d => 
              d.date.toDateString() === taskStartDate.toDateString()
            );
            const newEndIndex = fallbackDates.findIndex(d => 
              d.date.toDateString() === taskEndDate.toDateString()
            );
            
            if (newStartIndex >= 0 && scrollContainerRef.current) {
              const containerWidth = scrollContainerRef.current.clientWidth;
              let scrollPosition = 0;
              
              if (positioning === 'start-left') {
                scrollPosition = Math.max(0, newStartIndex * dateColumnWidth);
              } else if (positioning === 'end-right' && newEndIndex >= 0) {
                const columnsVisible = Math.floor(containerWidth / dateColumnWidth);
                scrollPosition = Math.max(0, (newEndIndex - columnsVisible + 1) * dateColumnWidth);
              } else {
                const taskCenter = newStartIndex * dateColumnWidth;
                scrollPosition = Math.max(0, taskCenter - containerWidth / 2);
              }
              
              scrollContainerRef.current.scrollLeft = scrollPosition;
            }
          }, 100);
        }
      }
    },
    
    scrollToToday: async () => {
      const todayIndex = dateRange.findIndex(d => d.isToday);
      
      if (todayIndex >= 0 && scrollContainerRef.current) {
        // Today is in current range, scroll to it
        const container = scrollContainerRef.current;
        const containerWidth = container.clientWidth;
        const targetCenter = todayIndex * dateColumnWidth;
        const targetScrollLeft = Math.max(0, targetCenter - containerWidth / 2);
        
        container.scrollTo({
          left: targetScrollLeft,
          behavior: 'smooth'
        });
      } else {
        // Today is not in current range, load it
        try {
          const todayOffset = 0; // Today is 0 days from today
          const rangeStart = todayOffset - 60; // 60 days before today
          const rangeSize = 121; // 121 days total
          
          const newDates = await generateDateRange(rangeStart, rangeSize);
          setDateRange(newDates);
          
          // After loading, scroll to today
          setTimeout(() => {
            const newTodayIndex = newDates.findIndex(d => d.isToday);
            if (newTodayIndex >= 0 && scrollContainerRef.current) {
              const container = scrollContainerRef.current;
              const containerWidth = container.clientWidth;
              const targetCenter = newTodayIndex * dateColumnWidth;
              const targetScrollLeft = Math.max(0, targetCenter - containerWidth / 2);
              
              container.scrollTo({
                left: targetScrollLeft,
                behavior: 'smooth'
              });
            }
          }, 100);
        } catch (error) {
          console.error('Failed to load today:', error);
          // Fallback: try with main thread generation
          const rangeStart = -60;
          const rangeSize = 121;
          const fallbackDates = generateDateRangeMainThread(rangeStart, rangeSize);
          setDateRange(fallbackDates);
          
          setTimeout(() => {
            const newTodayIndex = fallbackDates.findIndex(d => d.isToday);
            if (newTodayIndex >= 0 && scrollContainerRef.current) {
              const container = scrollContainerRef.current;
              const containerWidth = container.clientWidth;
              const targetCenter = newTodayIndex * dateColumnWidth;
              const targetScrollLeft = Math.max(0, targetCenter - containerWidth / 2);
              
              container.scrollTo({
                left: targetScrollLeft,
                behavior: 'smooth'
              });
            }
          }, 100);
        }
      }
    },

    // Smooth scrolling navigation functions
    scrollEarlier: async () => {
      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        
        // If we're near the beginning and can load more, load earlier dates first
        if (container.scrollLeft < container.clientWidth && !isLoading) {
          await loadEarlier();
          // After loading, the scroll position is automatically adjusted
        } else {
          // Normal scroll
          const scrollAmount = container.clientWidth * 0.8; // Scroll 80% of viewport
          container.scrollTo({
            left: Math.max(0, container.scrollLeft - scrollAmount),
            behavior: 'smooth'
          });
        }
      }
    },

    scrollLater: async () => {
      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const maxScroll = container.scrollWidth - container.clientWidth;
        
        // If we're near the end and can load more, load later dates first
        if (container.scrollLeft > maxScroll - container.clientWidth && !isLoading) {
          await loadLater();
          // Continue with normal scroll after loading
        }
        
        // Normal scroll (either way)
        const scrollAmount = container.clientWidth * 0.8; // Scroll 80% of viewport
        container.scrollTo({
          left: Math.min(maxScroll, container.scrollLeft + scrollAmount),
          behavior: 'smooth'
        });
      }
    },

    // Quick navigation functions
    scrollToRelativeDate: async (daysOffset: number) => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysOffset);
      
      // Check if target date is in current range
      const targetIndex = dateRange.findIndex(d => 
        d.date.toDateString() === targetDate.toDateString()
      );
      
      if (targetIndex >= 0) {
        // Target is in range, just scroll
        if (scrollContainerRef.current) {
          const containerWidth = scrollContainerRef.current.clientWidth;
          const targetCenter = targetIndex * dateColumnWidth;
          const scrollPosition = Math.max(0, targetCenter - containerWidth / 2);
          scrollContainerRef.current.scrollLeft = scrollPosition;
        }
      } else {
        // Target is outside range, load new range centered on target
        try {
          const rangeStart = daysOffset - 60; // 60 days before target
          const rangeSize = 121; // 121 days total
          
          const newDates = await generateDateRange(rangeStart, rangeSize);
          setDateRange(newDates);
          
          setTimeout(() => {
            const newTargetIndex = newDates.findIndex(d => 
              d.date.toDateString() === targetDate.toDateString()
            );
            
            if (newTargetIndex >= 0 && scrollContainerRef.current) {
              const containerWidth = scrollContainerRef.current.clientWidth;
              const targetCenter = newTargetIndex * dateColumnWidth;
              const scrollPosition = Math.max(0, targetCenter - containerWidth / 2);
              scrollContainerRef.current.scrollLeft = scrollPosition;
            }
          }, 100);
        } catch (error) {
          console.error('Failed to navigate to relative date:', error);
        }
      }
    }
  };
};

