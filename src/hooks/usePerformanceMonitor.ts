import { useCallback, useRef, useEffect } from 'react';

interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  type: 'render' | 'computation' | 'network' | 'interaction';
}

interface UsePerformanceMonitorOptions {
  enableConsoleLog?: boolean;
  sampleRate?: number; // 0-1, percentage of metrics to record
  maxMetrics?: number; // Maximum metrics to keep in memory
}

export const usePerformanceMonitor = (options: UsePerformanceMonitorOptions = {}) => {
  const { 
    enableConsoleLog = false, 
    sampleRate = 1.0, 
    maxMetrics = 1000 
  } = options;
  
  const metricsRef = useRef<PerformanceMetric[]>([]);
  const performanceObserverRef = useRef<PerformanceObserver | null>(null);

  // Initialize performance observer for web vitals
  useEffect(() => {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        
        entries.forEach((entry) => {
          // Skip if sampling rate doesn't match
          if (Math.random() > sampleRate) return;

          let metric: PerformanceMetric | null = null;

          // Layout Shift (CLS)
          if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
            metric = {
              name: 'CLS',
              value: (entry as any).value,
              timestamp: entry.startTime,
              type: 'render'
            };
          }
          
          // Largest Contentful Paint (LCP)
          else if (entry.entryType === 'largest-contentful-paint') {
            metric = {
              name: 'LCP',
              value: entry.startTime,
              timestamp: performance.now(),
              type: 'render'
            };
          }
          
          // First Input Delay (FID)
          else if (entry.entryType === 'first-input') {
            metric = {
              name: 'FID',
              value: (entry as any).processingStart - entry.startTime,
              timestamp: entry.startTime,
              type: 'interaction'
            };
          }

          // Navigation timing
          else if (entry.entryType === 'navigation') {
            const navEntry = entry as PerformanceNavigationTiming;
            recordMetric('DOM Content Loaded', navEntry.domContentLoadedEventEnd - navEntry.fetchStart, 'render');
            recordMetric('Load Complete', navEntry.loadEventEnd - navEntry.fetchStart, 'render');
          }

          if (metric) {
            recordMetric(metric.name, metric.value, metric.type);
          }
        });
      });

      // Observe different types of performance entries
      try {
        observer.observe({ entryTypes: ['layout-shift', 'largest-contentful-paint', 'first-input', 'navigation'] });
        performanceObserverRef.current = observer;
      } catch (e) {
        // Fallback for older browsers
        observer.observe({ entryTypes: ['navigation'] });
        performanceObserverRef.current = observer;
      }
    } catch (error) {
      console.warn('Performance monitoring not supported:', error);
    }

    return () => {
      if (performanceObserverRef.current) {
        performanceObserverRef.current.disconnect();
      }
    };
  }, [sampleRate]);

  // Record a performance metric
  const recordMetric = useCallback((
    name: string, 
    value: number, 
    type: PerformanceMetric['type'] = 'computation'
  ) => {
    // Skip if sampling rate doesn't match
    if (Math.random() > sampleRate) return;

    const metric: PerformanceMetric = {
      name,
      value,
      timestamp: performance.now(),
      type
    };

    metricsRef.current.push(metric);

    // Keep only the latest metrics to prevent memory issues
    if (metricsRef.current.length > maxMetrics) {
      metricsRef.current = metricsRef.current.slice(-maxMetrics);
    }

    if (enableConsoleLog) {
      // Metric values stay in metricsRef; console output was removed.
    }
  }, [sampleRate, maxMetrics, enableConsoleLog]);

  // Measure a function's execution time
  const measureFunction = useCallback(<T extends any[], R>(
    fn: (...args: T) => R,
    name: string,
    type: PerformanceMetric['type'] = 'computation'
  ) => {
    return (...args: T): R => {
      const start = performance.now();
      const result = fn(...args);
      const duration = performance.now() - start;
      
      recordMetric(name, duration, type);
      
      return result;
    };
  }, [recordMetric]);

  // Measure async function's execution time
  const measureAsyncFunction = useCallback(<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    name: string,
    type: PerformanceMetric['type'] = 'computation'
  ) => {
    return async (...args: T): Promise<R> => {
      const start = performance.now();
      try {
        const result = await fn(...args);
        const duration = performance.now() - start;
        recordMetric(name, duration, type);
        return result;
      } catch (error) {
        const duration = performance.now() - start;
        recordMetric(`${name} (error)`, duration, type);
        throw error;
      }
    };
  }, [recordMetric]);

  // Mark the start of a performance measurement
  const startMeasurement = useCallback((name: string) => {
    const startTime = performance.now();
    
    return {
      end: (type: PerformanceMetric['type'] = 'computation') => {
        const duration = performance.now() - startTime;
        recordMetric(name, duration, type);
        return duration;
      }
    };
  }, [recordMetric]);

  // Get performance statistics
  const getStats = useCallback(() => {
    const metrics = metricsRef.current;
    
    if (metrics.length === 0) {
      return null;
    }

    const byType = metrics.reduce((acc, metric) => {
      if (!acc[metric.type]) {
        acc[metric.type] = [];
      }
      acc[metric.type].push(metric.value);
      return acc;
    }, {} as Record<PerformanceMetric['type'], number[]>);

    const calculateStats = (values: number[]) => ({
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((sum, val) => sum + val, 0) / values.length,
      p95: values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)] || 0
    });

    return {
      total: metrics.length,
      timespan: metrics.length > 0 ? metrics[metrics.length - 1].timestamp - metrics[0].timestamp : 0,
      byType: Object.entries(byType).reduce((acc, [type, values]) => {
        acc[type as PerformanceMetric['type']] = calculateStats(values);
        return acc;
      }, {} as Record<PerformanceMetric['type'], ReturnType<typeof calculateStats>>)
    };
  }, []);

  // Get recent metrics
  const getRecentMetrics = useCallback((limit = 50) => {
    return metricsRef.current.slice(-limit);
  }, []);

  // Clear all metrics
  const clearMetrics = useCallback(() => {
    metricsRef.current = [];
  }, []);

  // Export metrics as JSON
  const exportMetrics = useCallback(() => {
    return {
      metrics: metricsRef.current,
      stats: getStats(),
      timestamp: Date.now(),
      userAgent: navigator.userAgent
    };
  }, [getStats]);

  return {
    recordMetric,
    measureFunction,
    measureAsyncFunction,
    startMeasurement,
    getStats,
    getRecentMetrics,
    clearMetrics,
    exportMetrics
  };
};
