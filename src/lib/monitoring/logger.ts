/**
 * Comprehensive logging system for ReCopyFast
 * Provides structured logging with different transports for development and production
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as Sentry from '@sentry/nextjs';

// Define log levels and their priorities
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for console output
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(logColors);

// Custom format for production logs
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Custom format for development logs
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}${
      info.stack ? `\n${info.stack}` : ''
    }`
  )
);

// Create transports array
const transports = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  })
);

// File transports for production
if (process.env.NODE_ENV === 'production') {
  // Error log file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: productionFormat,
      maxSize: '20m',
      maxFiles: '14d',
      createSymlink: true,
      symlinkName: 'error.log',
    })
  );

  // Combined log file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      format: productionFormat,
      maxSize: '20m',
      maxFiles: '30d',
      createSymlink: true,
      symlinkName: 'combined.log',
    })
  );

  // HTTP requests log
  transports.push(
    new DailyRotateFile({
      filename: 'logs/http-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'http',
      format: productionFormat,
      maxSize: '20m',
      maxFiles: '7d',
      createSymlink: true,
      symlinkName: 'http.log',
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  levels: logLevels,
  format: productionFormat,
  transports,
  exitOnError: false,
});

// Enhanced logging interface with context and metadata
interface LogContext {
  userId?: string;
  siteId?: string;
  sessionId?: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  [key: string]: unknown;
}

interface LogMetadata {
  component?: string;
  action?: string;
  resource?: string;
  duration?: number;
  statusCode?: number;
  [key: string]: unknown;
}

class EnhancedLogger {
  private logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  private formatMessage(message: string, context?: LogContext, metadata?: LogMetadata) {
    const enrichedMetadata = {
      ...metadata,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      ...(context && { context }),
    };

    return {
      message,
      ...enrichedMetadata,
    };
  }

  error(message: string, error?: Error, context?: LogContext, metadata?: LogMetadata) {
    const logData = this.formatMessage(message, context, {
      ...metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    });

    this.logger.error(logData);

    // Send to Sentry in production
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.withScope((scope) => {
        if (context) {
          scope.setContext('log_context', context);
        }
        if (metadata) {
          scope.setContext('log_metadata', metadata);
        }
        if (error) {
          Sentry.captureException(error);
        } else {
          Sentry.captureMessage(message, 'error');
        }
      });
    }
  }

  warn(message: string, context?: LogContext, metadata?: LogMetadata) {
    const logData = this.formatMessage(message, context, metadata);
    this.logger.warn(logData);
  }

  info(message: string, context?: LogContext, metadata?: LogMetadata) {
    const logData = this.formatMessage(message, context, metadata);
    this.logger.info(logData);
  }

  http(message: string, context?: LogContext, metadata?: LogMetadata) {
    const logData = this.formatMessage(message, context, metadata);
    this.logger.http(logData);
  }

  debug(message: string, context?: LogContext, metadata?: LogMetadata) {
    const logData = this.formatMessage(message, context, metadata);
    this.logger.debug(logData);
  }

  // Performance logging
  performance(
    operation: string,
    duration: number,
    context?: LogContext,
    metadata?: LogMetadata
  ) {
    this.info(`Performance: ${operation}`, context, {
      ...metadata,
      duration,
      component: 'performance',
    });
  }

  // Authentication logging
  auth(
    action: string,
    success: boolean,
    context?: LogContext,
    metadata?: LogMetadata
  ) {
    const level = success ? 'info' : 'warn';
    this[level](`Auth: ${action}`, context, {
      ...metadata,
      success,
      component: 'auth',
    });
  }

  // API request logging
  apiRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: LogContext,
    metadata?: LogMetadata
  ) {
    this.http(`${method} ${path} ${statusCode}`, context, {
      ...metadata,
      method,
      path,
      statusCode,
      duration,
      component: 'api',
    });
  }

  // Database operation logging
  database(
    operation: string,
    table: string,
    duration: number,
    context?: LogContext,
    metadata?: LogMetadata
  ) {
    this.debug(`DB: ${operation} on ${table}`, context, {
      ...metadata,
      operation,
      table,
      duration,
      component: 'database',
    });
  }

  // WebSocket logging
  websocket(
    event: string,
    context?: LogContext,
    metadata?: LogMetadata
  ) {
    this.debug(`WebSocket: ${event}`, context, {
      ...metadata,
      event,
      component: 'websocket',
    });
  }

  // Security event logging
  security(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context?: LogContext,
    metadata?: LogMetadata
  ) {
    const level = severity === 'critical' || severity === 'high' ? 'error' : 'warn';
    this[level](`Security: ${event}`, context, {
      ...metadata,
      severity,
      component: 'security',
    });
  }
}

// Create enhanced logger instance
const enhancedLogger = new EnhancedLogger(logger);

// Export both the winston logger and enhanced logger
export { logger as winstonLogger, enhancedLogger as logger };
export type { LogContext, LogMetadata };

// Utility function to create child logger with context
export function createContextLogger(defaultContext: LogContext) {
  return {
    error: (message: string, error?: Error, metadata?: LogMetadata) =>
      enhancedLogger.error(message, error, defaultContext, metadata),
    warn: (message: string, metadata?: LogMetadata) =>
      enhancedLogger.warn(message, defaultContext, metadata),
    info: (message: string, metadata?: LogMetadata) =>
      enhancedLogger.info(message, defaultContext, metadata),
    http: (message: string, metadata?: LogMetadata) =>
      enhancedLogger.http(message, defaultContext, metadata),
    debug: (message: string, metadata?: LogMetadata) =>
      enhancedLogger.debug(message, defaultContext, metadata),
    performance: (operation: string, duration: number, metadata?: LogMetadata) =>
      enhancedLogger.performance(operation, duration, defaultContext, metadata),
    auth: (action: string, success: boolean, metadata?: LogMetadata) =>
      enhancedLogger.auth(action, success, defaultContext, metadata),
    apiRequest: (method: string, path: string, statusCode: number, duration: number, metadata?: LogMetadata) =>
      enhancedLogger.apiRequest(method, path, statusCode, duration, defaultContext, metadata),
    database: (operation: string, table: string, duration: number, metadata?: LogMetadata) =>
      enhancedLogger.database(operation, table, duration, defaultContext, metadata),
    websocket: (event: string, metadata?: LogMetadata) =>
      enhancedLogger.websocket(event, defaultContext, metadata),
    security: (event: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata?: LogMetadata) =>
      enhancedLogger.security(event, severity, defaultContext, metadata),
  };
}

// Helper function for request logging middleware
export function createRequestContext(req: {
  headers: { [key: string]: string | string[] | undefined };
  ip?: string;
}): LogContext {
  return {
    requestId: (req.headers['x-request-id'] as string) || 
               (req.headers['x-vercel-id'] as string) || 
               Math.random().toString(36).substring(7),
    userAgent: req.headers['user-agent'] as string,
    ip: req.ip || req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string,
  };
}