/**
 * System Status Monitor
 * Tracks and reports on system health and performance metrics
 */

import { logger } from './logger';
import { performanceMonitor } from './performance';
import { config } from '../config/production';

interface SystemMetrics {
  timestamp: string;
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  cpu?: {
    usage: number;
    loadAverage: number[];
  };
  eventLoop?: {
    delay: number;
  };
  requests: {
    total: number;
    active: number;
    errored: number;
    averageResponseTime: number;
  };
  database: {
    connections: number;
    queries: number;
    averageQueryTime: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

interface SystemAlert {
  type: 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  metric: string;
  value: number;
  threshold: number;
}

class SystemStatusMonitor {
  private startTime: number = Date.now();
  private metrics: SystemMetrics[] = [];
  private alerts: SystemAlert[] = [];
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  
  // Request tracking
  private requestCounts = {
    total: 0,
    active: 0,
    errored: 0,
    totalResponseTime: 0,
  };
  
  // Database tracking
  private dbCounts = {
    connections: 0,
    queries: 0,
    totalQueryTime: 0,
  };
  
  // Cache tracking
  private cacheCounts = {
    hits: 0,
    misses: 0,
  };

  /**
   * Start monitoring system status
   */
  start(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    const interval = config.monitoring.metrics.interval * 1000;

    logger.info('Starting system status monitoring', undefined, {
      component: 'system-monitor',
      interval,
    });

    // Collect metrics at regular intervals
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, interval);

    // Initial collection
    this.collectMetrics();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('Stopped system status monitoring', undefined, {
      component: 'system-monitor',
    });
  }

  /**
   * Collect current system metrics (Edge Runtime compatible)
   */
  private collectMetrics(): void {
    try {
      // Check if we're in Node.js environment (not Edge Runtime)
      const isNodeJs = typeof process !== 'undefined' && process.memoryUsage;
      
      let memoryInfo = {
        used: 0,
        total: 0,
        percentage: 0,
        rss: 0,
        heapUsed: 0,
        heapTotal: 0,
      };

      if (isNodeJs) {
        const memoryUsage = process.memoryUsage();
        memoryInfo = {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        };
      }
      
      const metrics: SystemMetrics = {
        timestamp: new Date().toISOString(),
        uptime: Math.round((Date.now() - this.startTime) / 1000),
        memory: memoryInfo,
        requests: {
          total: this.requestCounts.total,
          active: this.requestCounts.active,
          errored: this.requestCounts.errored,
          averageResponseTime: this.requestCounts.total > 0 
            ? Math.round(this.requestCounts.totalResponseTime / this.requestCounts.total)
            : 0,
        },
        database: {
          connections: this.dbCounts.connections,
          queries: this.dbCounts.queries,
          averageQueryTime: this.dbCounts.queries > 0
            ? Math.round(this.dbCounts.totalQueryTime / this.dbCounts.queries)
            : 0,
        },
        cache: {
          hits: this.cacheCounts.hits,
          misses: this.cacheCounts.misses,
          hitRate: (this.cacheCounts.hits + this.cacheCounts.misses) > 0
            ? Math.round((this.cacheCounts.hits / (this.cacheCounts.hits + this.cacheCounts.misses)) * 100)
            : 0,
        },
      };

      // Add CPU metrics if available (Node.js specific)
      if (typeof process.cpuUsage === 'function') {
        try {
          const cpuUsage = process.cpuUsage();
          const loadAverage = process.loadavg?.() || [];
          
          metrics.cpu = {
            usage: Math.round((cpuUsage.user + cpuUsage.system) / 1000 / 1000 * 100),
            loadAverage,
          };
        } catch {
          // CPU metrics not available
        }
      }

      // Store metrics (keep last 100 data points)
      this.metrics.push(metrics);
      if (this.metrics.length > 100) {
        this.metrics = this.metrics.slice(-100);
      }

      // Check for alerts
      this.checkAlerts(metrics);

      // Record performance metrics
      performanceMonitor.recordMetric({
        name: 'system.memory_usage',
        value: metrics.memory.percentage,
        unit: 'count',
        metadata: { type: 'percentage' },
      });

      performanceMonitor.recordMetric({
        name: 'system.uptime',
        value: metrics.uptime,
        unit: 'count',
        metadata: { type: 'seconds' },
      });

    } catch (error) {
      logger.error('Failed to collect system metrics', error as Error, undefined, {
        component: 'system-monitor',
      });
    }
  }

  /**
   * Check for system alerts based on thresholds
   */
  private checkAlerts(metrics: SystemMetrics): void {
    const alerts: SystemAlert[] = [];

    // Memory usage alerts
    if (metrics.memory.percentage > 90) {
      alerts.push({
        type: 'critical',
        message: 'Critical memory usage detected',
        timestamp: new Date().toISOString(),
        metric: 'memory.percentage',
        value: metrics.memory.percentage,
        threshold: 90,
      });
    } else if (metrics.memory.percentage > 80) {
      alerts.push({
        type: 'warning',
        message: 'High memory usage detected',
        timestamp: new Date().toISOString(),
        metric: 'memory.percentage',
        value: metrics.memory.percentage,
        threshold: 80,
      });
    }

    // Response time alerts
    if (metrics.requests.averageResponseTime > 3000) {
      alerts.push({
        type: 'error',
        message: 'High average response time detected',
        timestamp: new Date().toISOString(),
        metric: 'requests.averageResponseTime',
        value: metrics.requests.averageResponseTime,
        threshold: 3000,
      });
    }

    // Database query time alerts
    if (metrics.database.averageQueryTime > 500) {
      alerts.push({
        type: 'warning',
        message: 'Slow database queries detected',
        timestamp: new Date().toISOString(),
        metric: 'database.averageQueryTime',
        value: metrics.database.averageQueryTime,
        threshold: 500,
      });
    }

    // Cache hit rate alerts
    if (metrics.cache.hitRate < 50 && (metrics.cache.hits + metrics.cache.misses) > 100) {
      alerts.push({
        type: 'warning',
        message: 'Low cache hit rate detected',
        timestamp: new Date().toISOString(),
        metric: 'cache.hitRate',
        value: metrics.cache.hitRate,
        threshold: 50,
      });
    }

    // Log and store alerts
    alerts.forEach(alert => {
      this.alerts.push(alert);
      
      const logLevel = alert.type === 'critical' ? 'error' : 
                      alert.type === 'error' ? 'error' : 'warn';
      
      logger[logLevel](alert.message, undefined, undefined, {
        component: 'system-monitor',
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        alertType: alert.type,
      });
    });

    // Keep only last 50 alerts
    if (this.alerts.length > 50) {
      this.alerts = this.alerts.slice(-50);
    }
  }

  /**
   * Track HTTP request
   */
  trackRequest(duration: number, isError: boolean = false): void {
    this.requestCounts.total++;
    this.requestCounts.totalResponseTime += duration;
    
    if (isError) {
      this.requestCounts.errored++;
    }
  }

  /**
   * Track active request
   */
  trackActiveRequest(delta: number): void {
    this.requestCounts.active += delta;
  }

  /**
   * Track database query
   */
  trackDatabaseQuery(duration: number): void {
    this.dbCounts.queries++;
    this.dbCounts.totalQueryTime += duration;
  }

  /**
   * Track database connections
   */
  trackDatabaseConnections(count: number): void {
    this.dbCounts.connections = count;
  }

  /**
   * Track cache hit/miss
   */
  trackCacheHit(isHit: boolean): void {
    if (isHit) {
      this.cacheCounts.hits++;
    } else {
      this.cacheCounts.misses++;
    }
  }

  /**
   * Get current system status
   */
  getStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: SystemMetrics | null;
    alerts: SystemAlert[];
    uptime: number;
  } {
    const currentMetrics = this.metrics[this.metrics.length - 1] || null;
    const recentAlerts = this.alerts.filter(
      alert => Date.now() - new Date(alert.timestamp).getTime() < 5 * 60 * 1000 // Last 5 minutes
    );

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (recentAlerts.some(alert => alert.type === 'critical')) {
      status = 'unhealthy';
    } else if (recentAlerts.some(alert => alert.type === 'error') || recentAlerts.length > 3) {
      status = 'degraded';
    }

    return {
      status,
      metrics: currentMetrics,
      alerts: recentAlerts,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit: number = 50): SystemMetrics[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(minutes: number = 60): SystemAlert[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.alerts.filter(
      alert => new Date(alert.timestamp).getTime() > cutoff
    );
  }
}

// Export singleton instance
export const systemMonitor = new SystemStatusMonitor();

// Auto-start monitoring if enabled
if (config.monitoring.enabled) {
  systemMonitor.start();
}