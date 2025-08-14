/**
 * Performance Monitoring Utilities
 * Track and report performance metrics throughout the application
 */

import { logger } from './logger';
import * as Sentry from '@sentry/nextjs';

interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count';
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

interface PerformanceThreshold {
  warning: number;
  critical: number;
}

const PERFORMANCE_THRESHOLDS: Record<string, PerformanceThreshold> = {
  'api.response_time': { warning: 1000, critical: 3000 },
  'database.query_time': { warning: 100, critical: 500 },
  'page.load_time': { warning: 3000, critical: 5000 },
  'image.processing_time': { warning: 2000, critical: 5000 },
  'websocket.latency': { warning: 100, critical: 300 },
};

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private timers: Map<string, number> = new Map();

  /**
   * Start a performance timer
   */
  startTimer(name: string, tags?: Record<string, string>): string {
    const timerId = `${name}_${Date.now()}_${Math.random()}`;
    this.timers.set(timerId, performance.now());
    
    // Start Sentry transaction if in production
    if (process.env.NODE_ENV === 'production') {
      const transaction = Sentry.startTransaction({
        name,
        tags,
      });
      Sentry.getCurrentScope().setSpan(transaction);
    }
    
    return timerId;
  }

  /**
   * End a performance timer and record the metric
   */
  endTimer(
    timerId: string, 
    metadata?: Record<string, unknown>
  ): number | null {
    const startTime = this.timers.get(timerId);
    if (!startTime) {
      logger.warn(`Timer ${timerId} not found`);
      return null;
    }

    const duration = performance.now() - startTime;
    this.timers.delete(timerId);

    // Extract name from timerId
    const name = timerId.split('_')[0];

    // Record the metric
    this.recordMetric({
      name: `${name}.duration`,
      value: duration,
      unit: 'ms',
      metadata,
    });

    // End Sentry transaction
    const transaction = Sentry.getCurrentScope().getTransaction();
    if (transaction) {
      transaction.setStatus('ok');
      transaction.finish();
    }

    return duration;
  }

  /**
   * Record a performance metric
   */
  recordMetric(metric: PerformanceMetric): void {
    const { name, value, unit, tags, metadata } = metric;

    // Store metric
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(metric);

    // Check thresholds
    const threshold = PERFORMANCE_THRESHOLDS[name];
    if (threshold) {
      if (value >= threshold.critical) {
        logger.error(`Performance critical: ${name}`, undefined, undefined, {
          metric: name,
          value,
          unit,
          threshold: threshold.critical,
          ...metadata,
        });
      } else if (value >= threshold.warning) {
        logger.warn(`Performance warning: ${name}`, undefined, {
          metric: name,
          value,
          unit,
          threshold: threshold.warning,
          ...metadata,
        });
      }
    }

    // Log performance metric
    logger.performance(name, value, undefined, {
      unit,
      tags,
      ...metadata,
    });

    // Send to Sentry as custom metric
    if (process.env.NODE_ENV === 'production') {
      Sentry.metrics.distribution(name, value, {
        unit,
        tags,
      });
    }

    // Clean up old metrics (keep last 100)
    const metrics = this.metrics.get(name)!;
    if (metrics.length > 100) {
      this.metrics.set(name, metrics.slice(-100));
    }
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(name: string): {
    count: number;
    average: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const values = metrics.map(m => m.value).sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((acc, val) => acc + val, 0);

    return {
      count,
      average: sum / count,
      min: values[0],
      max: values[count - 1],
      p50: values[Math.floor(count * 0.5)],
      p95: values[Math.floor(count * 0.95)],
      p99: values[Math.floor(count * 0.99)],
    };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.timers.clear();
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Performance timing decorator for class methods
 */
export function measurePerformance(target: unknown, propertyName: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: unknown[]) {
    const className = (target as { constructor: { name: string } }).constructor.name;
    const metricName = `${className}.${propertyName}`;
    const timerId = performanceMonitor.startTimer(metricName);

    try {
      const result = await originalMethod.apply(this, args);
      performanceMonitor.endTimer(timerId);
      return result;
    } catch (error) {
      performanceMonitor.endTimer(timerId, { error: true });
      throw error;
    }
  };

  return descriptor;
}

/**
 * Measure async function performance
 */
export async function measureAsync<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const timerId = performanceMonitor.startTimer(name);
  
  try {
    const result = await fn();
    performanceMonitor.endTimer(timerId, { ...metadata, success: true });
    return result;
  } catch (error) {
    performanceMonitor.endTimer(timerId, { ...metadata, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

/**
 * Measure sync function performance
 */
export function measureSync<T>(
  name: string,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const timerId = performanceMonitor.startTimer(name);
  
  try {
    const result = fn();
    performanceMonitor.endTimer(timerId, { ...metadata, success: true });
    return result;
  } catch (error) {
    performanceMonitor.endTimer(timerId, { ...metadata, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

/**
 * Resource timing observer
 */
export function observeResourceTiming() {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    return;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'resource') {
          const resourceEntry = entry as PerformanceResourceTiming;
          
          performanceMonitor.recordMetric({
            name: 'resource.load_time',
            value: resourceEntry.duration,
            unit: 'ms',
            tags: {
              type: resourceEntry.initiatorType,
              name: resourceEntry.name,
            },
            metadata: {
              transferSize: resourceEntry.transferSize,
              encodedBodySize: resourceEntry.encodedBodySize,
              decodedBodySize: resourceEntry.decodedBodySize,
            },
          });
        }
      }
    });

    observer.observe({ entryTypes: ['resource'] });
  } catch (error) {
    logger.error('Failed to setup resource timing observer', error as Error);
  }
}

/**
 * Web Vitals tracking
 */
export function trackWebVitals(metric: {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
}) {
  performanceMonitor.recordMetric({
    name: `web_vitals.${metric.name.toLowerCase()}`,
    value: metric.value,
    unit: 'ms',
    tags: {
      rating: metric.rating,
    },
    metadata: {
      delta: metric.delta,
      id: metric.id,
    },
  });

  // Send to Sentry
  if (process.env.NODE_ENV === 'production') {
    Sentry.metrics.distribution(`web_vitals.${metric.name.toLowerCase()}`, metric.value, {
      tags: {
        rating: metric.rating,
      },
    });
  }
}