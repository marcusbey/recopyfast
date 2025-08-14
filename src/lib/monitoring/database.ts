/**
 * Database Performance Monitoring
 * Tracks database queries, connections, and performance metrics
 */

import { logger } from './logger';
import { performanceMonitor } from './performance';
import { systemMonitor } from './system-status';
import { SupabaseClient } from '@supabase/supabase-js';

interface QueryMetrics {
  query: string;
  table: string;
  operation: string;
  duration: number;
  timestamp: Date;
  success: boolean;
  error?: string;
  rowCount?: number;
  params?: unknown[];
}

// interface ConnectionMetrics {
//   activeConnections: number;
//   idleConnections: number;
//   waitingConnections: number;
//   totalConnections: number;
//   errors: number;
//   timestamp: Date;
// }

class DatabaseMonitor {
  private queryMetrics: QueryMetrics[] = [];
  private slowQueryThreshold: number = 1000; // 1 second
  private longRunningQueries: Map<string, { startTime: number; query: string }> = new Map();

  /**
   * Wrap a database query with monitoring
   */
  async monitorQuery<T>(
    operation: string,
    table: string,
    queryFn: () => Promise<T>,
    query?: string
  ): Promise<T> {
    const startTime = Date.now();
    const queryId = Math.random().toString(36).substring(7);
    
    // Track long-running queries
    if (query) {
      this.longRunningQueries.set(queryId, {
        startTime,
        query: query.substring(0, 200), // Truncate for logging
      });
    }

    try {
      const result = await queryFn();
      const duration = Date.now() - startTime;

      // Extract row count if possible
      let rowCount: number | undefined;
      if (result && typeof result === 'object') {
        const resultObj = result as Record<string, unknown>;
        if ('data' in resultObj && Array.isArray(resultObj.data)) {
          rowCount = resultObj.data.length;
        } else if ('count' in resultObj && typeof resultObj.count === 'number') {
          rowCount = resultObj.count;
        }
      }

      // Record query metrics
      const metrics: QueryMetrics = {
        query: query || `${operation} on ${table}`,
        table,
        operation,
        duration,
        timestamp: new Date(),
        success: true,
        rowCount,
      };

      this.recordQueryMetrics(metrics);

      // Log slow queries
      if (duration > this.slowQueryThreshold) {
        logger.warn('Slow database query detected', undefined, {
          component: 'database-monitor',
          query: query?.substring(0, 200),
          table,
          operation,
          duration,
          rowCount,
        });
      }

      // Track system metrics
      systemMonitor.trackDatabaseQuery(duration);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      // Record error metrics
      const metrics: QueryMetrics = {
        query: query || `${operation} on ${table}`,
        table,
        operation,
        duration,
        timestamp: new Date(),
        success: false,
        error: err.message,
      };

      this.recordQueryMetrics(metrics);

      // Log database error
      logger.error('Database query failed', err, undefined, {
        component: 'database-monitor',
        query: query?.substring(0, 200),
        table,
        operation,
        duration,
      });

      throw error;

    } finally {
      // Clean up long-running query tracking
      this.longRunningQueries.delete(queryId);
    }
  }

  /**
   * Record query metrics
   */
  private recordQueryMetrics(metrics: QueryMetrics): void {
    // Store metrics (keep last 1000)
    this.queryMetrics.push(metrics);
    if (this.queryMetrics.length > 1000) {
      this.queryMetrics = this.queryMetrics.slice(-1000);
    }

    // Record performance metrics
    performanceMonitor.recordMetric({
      name: 'database.query_time',
      value: metrics.duration,
      unit: 'ms',
      tags: {
        table: metrics.table,
        operation: metrics.operation,
        success: metrics.success.toString(),
      },
      metadata: {
        rowCount: metrics.rowCount,
        error: metrics.error,
      },
    });

    // Record error rate
    if (!metrics.success) {
      performanceMonitor.recordMetric({
        name: 'database.error_rate',
        value: 1,
        unit: 'count',
        tags: {
          table: metrics.table,
          operation: metrics.operation,
          error: metrics.error?.substring(0, 50),
        },
      });
    }
  }

  /**
   * Get query performance summary
   */
  getQuerySummary(timeWindow: number = 60000): {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    averageResponseTime: number;
    slowQueries: number;
    topSlowQueries: Array<{ query: string; duration: number; table: string }>;
    errorsByTable: Record<string, number>;
  } {
    const cutoff = Date.now() - timeWindow;
    const recentQueries = this.queryMetrics.filter(
      metric => metric.timestamp.getTime() > cutoff
    );

    const totalQueries = recentQueries.length;
    const successfulQueries = recentQueries.filter(m => m.success).length;
    const failedQueries = totalQueries - successfulQueries;
    const averageResponseTime = totalQueries > 0 
      ? Math.round(recentQueries.reduce((sum, m) => sum + m.duration, 0) / totalQueries)
      : 0;
    
    const slowQueries = recentQueries.filter(m => m.duration > this.slowQueryThreshold).length;
    
    const topSlowQueries = recentQueries
      .filter(m => m.duration > this.slowQueryThreshold)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(m => ({
        query: m.query.substring(0, 100),
        duration: m.duration,
        table: m.table,
      }));

    const errorsByTable = recentQueries
      .filter(m => !m.success)
      .reduce((acc, m) => {
        acc[m.table] = (acc[m.table] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return {
      totalQueries,
      successfulQueries,
      failedQueries,
      averageResponseTime,
      slowQueries,
      topSlowQueries,
      errorsByTable,
    };
  }

  /**
   * Check for long-running queries
   */
  checkLongRunningQueries(threshold: number = 30000): Array<{
    queryId: string;
    query: string;
    duration: number;
  }> {
    const now = Date.now();
    const longRunning: Array<{ queryId: string; query: string; duration: number }> = [];

    for (const [queryId, data] of this.longRunningQueries.entries()) {
      const duration = now - data.startTime;
      if (duration > threshold) {
        longRunning.push({
          queryId,
          query: data.query,
          duration,
        });
      }
    }

    // Log long-running queries
    if (longRunning.length > 0) {
      logger.warn('Long-running database queries detected', undefined, {
        component: 'database-monitor',
        count: longRunning.length,
        queries: longRunning.map(q => ({
          duration: q.duration,
          query: q.query,
        })),
      });
    }

    return longRunning;
  }

  /**
   * Create a monitored Supabase client
   */
  createMonitoredClient(client: SupabaseClient): SupabaseClient {
    // Create a proxy to intercept method calls
    return new Proxy(client, {
      get: (target, prop) => {
        const originalMethod = target[prop as keyof SupabaseClient];

        // Monitor specific methods
        if (prop === 'from') {
          return (table: string) => {
            const query = target.from(table);
            return this.createMonitoredQueryBuilder(query, table);
          };
        }

        if (typeof originalMethod === 'function') {
          return (originalMethod as (...args: unknown[]) => unknown).bind(target);
        }

        return originalMethod;
      },
    });
  }

  /**
   * Create a monitored query builder
   */
  private createMonitoredQueryBuilder(query: unknown, table: string): unknown {
    return new Proxy(query as Record<string, unknown>, {
      get: (target, prop) => {
        const originalMethod = (target as Record<string | symbol, unknown>)[prop];

        // Monitor query execution methods
        if (['select', 'insert', 'update', 'delete', 'upsert'].includes(prop as string)) {
          return (...args: unknown[]) => {
            const result = (originalMethod as (...args: unknown[]) => unknown).apply(target, args);
            
            // If this returns a thenable (Promise-like), wrap it
            if (result && typeof result.then === 'function') {
              return this.monitorQuery(
                prop as string,
                table,
                () => result,
                `${prop} from ${table}`
              );
            }
            
            return result;
          };
        }

        if (typeof originalMethod === 'function') {
          return (originalMethod as (...args: unknown[]) => unknown).bind(target);
        }

        return originalMethod;
      },
    });
  }

  /**
   * Set slow query threshold
   */
  setSlowQueryThreshold(threshold: number): void {
    this.slowQueryThreshold = threshold;
    
    logger.info('Updated slow query threshold', undefined, {
      component: 'database-monitor',
      threshold,
    });
  }

  /**
   * Clear query metrics
   */
  clearMetrics(): void {
    this.queryMetrics = [];
    this.longRunningQueries.clear();
    
    logger.info('Database metrics cleared', undefined, {
      component: 'database-monitor',
    });
  }
}

// Export singleton instance
export const databaseMonitor = new DatabaseMonitor();

/**
 * Decorator for monitoring database operations
 */
export function monitorDatabaseOperation(table: string, operation: string) {
  return function (target: unknown, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return databaseMonitor.monitorQuery(
        operation,
        table,
        () => originalMethod.apply(this, args),
        `${operation} on ${table}`
      );
    };

    return descriptor;
  };
}

/**
 * Utility function to wrap Supabase queries
 */
export async function monitorSupabaseQuery<T>(
  operation: string,
  table: string,
  queryFn: () => Promise<T>
): Promise<T> {
  return databaseMonitor.monitorQuery(operation, table, queryFn);
}