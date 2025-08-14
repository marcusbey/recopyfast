/**
 * Next.js Instrumentation File
 * Initializes monitoring and observability tools when the application starts
 */

import { logger } from './src/lib/monitoring/logger';

export async function register() {
  // Only run in Node.js runtime (server-side)
  if (typeof window === 'undefined') {
    const { config, validateConfig } = await import('./src/lib/config/production');
    
    logger.info('Initializing application instrumentation', undefined, {
      component: 'instrumentation',
      environment: config.app.environment,
      version: config.app.version,
    });

    try {
      // Validate configuration
      const configValidation = validateConfig();
      if (!configValidation.valid) {
        logger.error('Configuration validation failed', undefined, undefined, {
          component: 'instrumentation',
          errors: configValidation.errors,
        });
        
        // In production, we should exit on config validation failure
        if (config.app.environment === 'production') {
          process.exit(1);
        }
      }

      // Initialize monitoring if enabled
      if (config.monitoring.enabled) {
        const { systemMonitor } = await import('./src/lib/monitoring/system-status');
        
        // Start system monitoring
        systemMonitor.start();
        
        logger.info('System monitoring initialized', undefined, {
          component: 'instrumentation',
          metricsInterval: config.monitoring.metrics.interval,
        });

        // Setup performance monitoring
        if (typeof window !== 'undefined') {
          const { observeResourceTiming } = await import('./src/lib/monitoring/performance');
          observeResourceTiming();
        }
      }

      // Initialize Sentry if configured and enabled
      if (config.monitoring.sentry.enabled && process.env.NEXT_PUBLIC_SENTRY_DSN) {
        logger.info('Sentry monitoring initialized', undefined, {
          component: 'instrumentation',
          tracesSampleRate: config.monitoring.sentry.tracesSampleRate,
          profilesSampleRate: config.monitoring.sentry.profilesSampleRate,
        });
      }

      // Setup graceful shutdown handlers
      if (process.env.NODE_ENV === 'production') {
        setupGracefulShutdown();
      }

      // Setup unhandled error catching
      setupErrorHandlers();

      // Log successful initialization
      logger.info('Application instrumentation completed successfully', undefined, {
        component: 'instrumentation',
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
      });

    } catch (error) {
      logger.error('Failed to initialize instrumentation', error as Error, undefined, {
        component: 'instrumentation',
      });
      
      // Don't crash the app in development, but do in production
      if (config?.app?.environment === 'production') {
        throw error;
      }
    }
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`, undefined, {
      component: 'shutdown',
      signal,
    });

    try {
      // Stop system monitoring
      const { systemMonitor } = await import('./src/lib/monitoring/system-status');
      systemMonitor.stop();

      // Close any database connections, stop servers, etc.
      // Add your cleanup logic here

      logger.info('Graceful shutdown completed', undefined, {
        component: 'shutdown',
        signal,
      });

      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', error as Error, undefined, {
        component: 'shutdown',
        signal,
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Setup global error handlers
 */
function setupErrorHandlers() {
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
    logger.error('Unhandled Promise Rejection', reason as Error, undefined, {
      component: 'error-handler',
      type: 'unhandledRejection',
      promise: promise.toString(),
    });

    // In production, we might want to exit on unhandled rejections
    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    }
  });

  // Uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', error, undefined, {
      component: 'error-handler',
      type: 'uncaughtException',
    });

    // Always exit on uncaught exceptions
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Warning handler
  process.on('warning', (warning: Error) => {
    logger.warn('Node.js Warning', undefined, {
      component: 'warning-handler',
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });
}