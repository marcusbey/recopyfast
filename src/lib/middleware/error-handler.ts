/**
 * Global Error Handler Middleware
 * Provides comprehensive error handling, logging, and user-friendly responses
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '../monitoring/logger';
import { config } from '../config/production';
import * as Sentry from '@sentry/nextjs';

// Error types and their handling strategies
export enum ErrorType {
  VALIDATION = 'ValidationError',
  AUTHENTICATION = 'AuthenticationError',
  AUTHORIZATION = 'AuthorizationError',
  NOT_FOUND = 'NotFoundError',
  RATE_LIMIT = 'RateLimitError',
  INTERNAL = 'InternalError',
  DATABASE = 'DatabaseError',
  EXTERNAL_SERVICE = 'ExternalServiceError',
  BUSINESS_LOGIC = 'BusinessLogicError',
}

export interface AppError extends Error {
  type: ErrorType;
  statusCode: number;
  isOperational: boolean;
  context?: Record<string, unknown>;
  userMessage?: string;
}

// Custom error classes
export class ValidationError extends Error implements AppError {
  type = ErrorType.VALIDATION;
  statusCode = 400;
  isOperational = true;

  constructor(message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(message);
    this.name = 'ValidationError';
    this.userMessage = userMessage || 'Invalid input provided';
  }
}

export class AuthenticationError extends Error implements AppError {
  type = ErrorType.AUTHENTICATION;
  statusCode = 401;
  isOperational = true;

  constructor(message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(message);
    this.name = 'AuthenticationError';
    this.userMessage = userMessage || 'Authentication required';
  }
}

export class AuthorizationError extends Error implements AppError {
  type = ErrorType.AUTHORIZATION;
  statusCode = 403;
  isOperational = true;

  constructor(message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(message);
    this.name = 'AuthorizationError';
    this.userMessage = userMessage || 'Insufficient permissions';
  }
}

export class NotFoundError extends Error implements AppError {
  type = ErrorType.NOT_FOUND;
  statusCode = 404;
  isOperational = true;

  constructor(resource: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
    this.userMessage = userMessage || 'Resource not found';
  }
}

export class RateLimitError extends Error implements AppError {
  type = ErrorType.RATE_LIMIT;
  statusCode = 429;
  isOperational = true;

  constructor(message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(message);
    this.name = 'RateLimitError';
    this.userMessage = userMessage || 'Too many requests. Please try again later.';
  }
}

export class DatabaseError extends Error implements AppError {
  type = ErrorType.DATABASE;
  statusCode = 500;
  isOperational = true;

  constructor(message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(message);
    this.name = 'DatabaseError';
    this.userMessage = userMessage || 'Database operation failed';
  }
}

export class ExternalServiceError extends Error implements AppError {
  type = ErrorType.EXTERNAL_SERVICE;
  statusCode = 503;
  isOperational = true;

  constructor(service: string, message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(`${service}: ${message}`);
    this.name = 'ExternalServiceError';
    this.userMessage = userMessage || 'External service temporarily unavailable';
  }
}

export class BusinessLogicError extends Error implements AppError {
  type = ErrorType.BUSINESS_LOGIC;
  statusCode = 422;
  isOperational = true;

  constructor(message: string, public context?: Record<string, unknown>, public userMessage?: string) {
    super(message);
    this.name = 'BusinessLogicError';
    this.userMessage = userMessage || 'Operation could not be completed';
  }
}

/**
 * Check if error is an operational error (expected errors we handle gracefully)
 */
function isOperationalError(error: Error): boolean {
  if ('isOperational' in error) {
    return (error as AppError).isOperational;
  }
  return false;
}

/**
 * Get error severity level
 */
function getErrorSeverity(error: AppError | Error): 'low' | 'medium' | 'high' | 'critical' {
  if ('type' in error) {
    switch ((error as AppError).type) {
      case ErrorType.VALIDATION:
      case ErrorType.NOT_FOUND:
      case ErrorType.RATE_LIMIT:
        return 'low';
      
      case ErrorType.AUTHENTICATION:
      case ErrorType.AUTHORIZATION:
      case ErrorType.BUSINESS_LOGIC:
        return 'medium';
      
      case ErrorType.DATABASE:
      case ErrorType.EXTERNAL_SERVICE:
        return 'high';
      
      case ErrorType.INTERNAL:
      default:
        return 'critical';
    }
  }
  
  // Unknown errors are critical
  return 'critical';
}

/**
 * Format error response for clients
 */
function formatErrorResponse(
  error: AppError | Error,
  requestId: string,
  includeStack: boolean = false
): {
  error: {
    type: string;
    message: string;
    requestId: string;
    timestamp: string;
    stack?: string;
    context?: Record<string, unknown>;
  };
} {
  const appError = error as AppError;
  
  return {
    error: {
      type: appError.type || 'UnknownError',
      message: config.app.debug ? error.message : (appError.userMessage || 'An error occurred'),
      requestId,
      timestamp: new Date().toISOString(),
      ...(includeStack && config.app.debug && { stack: error.stack }),
      ...(config.app.debug && appError.context && { context: appError.context }),
    },
  };
}

/**
 * Global error handling middleware
 */
export function withErrorHandler(
  handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>
) {
  return async function errorHandlerWrapper(req: NextRequest, context?: unknown): Promise<NextResponse> {
    const requestId = Math.random().toString(36).substring(7);
    
    try {
      // Add request ID to headers for tracing
      const response = await handler(req, context);
      response.headers.set('X-Request-ID', requestId);
      return response;
      
    } catch (error) {
      const err = error as AppError | Error;
      const appError = err as AppError;
      const statusCode = appError.statusCode || 500;
      const severity = getErrorSeverity(err);
      
      // Create request context for logging
      const requestContext = {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers.get('user-agent'),
        ip: req.headers.get('x-forwarded-for') || 
            req.headers.get('x-real-ip') || 
            'unknown',
      };

      // Log the error based on severity
      const logLevel = severity === 'critical' ? 'error' : 
                      severity === 'high' ? 'error' : 
                      severity === 'medium' ? 'warn' : 'info';

      logger[logLevel](`API Error: ${err.message}`, err, requestContext, {
        component: 'error-handler',
        errorType: appError.type || 'UnknownError',
        statusCode,
        severity,
        operational: isOperationalError(err),
        context: appError.context,
      });

      // Report to Sentry for non-operational errors or high severity
      if (config.monitoring.sentry.enabled && 
          (!isOperationalError(err) || severity === 'critical' || severity === 'high')) {
        
        Sentry.withScope((scope) => {
          scope.setTag('error_type', appError.type || 'UnknownError');
          scope.setTag('error_severity', severity);
          scope.setTag('operational', isOperationalError(err));
          scope.setContext('request', requestContext);
          scope.setContext('error_context', appError.context || {});
          scope.setLevel(severity === 'critical' ? 'error' : 
                         severity === 'high' ? 'error' : 'warning');
          
          Sentry.captureException(err);
        });
      }

      // Create error response
      const errorResponse = formatErrorResponse(err, requestId, config.app.debug);
      
      return NextResponse.json(errorResponse, { 
        status: statusCode,
        headers: {
          'X-Request-ID': requestId,
          'Content-Type': 'application/json',
        },
      });
    }
  };
}

/**
 * Handle async errors in route handlers
 */
export function asyncHandler(
  fn: (req: NextRequest, context?: unknown) => Promise<NextResponse>
) {
  return withErrorHandler(fn);
}

/**
 * Validate request data and throw ValidationError if invalid
 */
export function validateRequest<T>(
  data: unknown,
  validator: (data: unknown) => data is T,
  message: string = 'Invalid request data'
): T {
  if (!validator(data)) {
    throw new ValidationError(message, { receivedData: data });
  }
  return data;
}

/**
 * Assert condition and throw appropriate error if false
 */
export function assert(
  condition: boolean,
  error: AppError | Error,
  context?: Record<string, unknown>
): asserts condition {
  if (!condition) {
    if (context && 'context' in error) {
      (error as AppError).context = { ...(error as AppError).context, ...context };
    }
    throw error;
  }
}

/**
 * Wrap external service calls with error handling
 */
export async function withExternalServiceErrorHandling<T>(
  serviceName: string,
  operation: () => Promise<T>,
  fallback?: T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const err = error as Error;
    
    logger.error(`External service error: ${serviceName}`, err, undefined, {
      component: 'external-service',
      service: serviceName,
    });

    // Return fallback if provided
    if (fallback !== undefined) {
      logger.info(`Using fallback for ${serviceName}`, undefined, {
        component: 'external-service',
        service: serviceName,
        fallback: true,
      });
      return fallback;
    }

    // Throw external service error
    throw new ExternalServiceError(serviceName, err.message, {
      originalError: err.message,
      stack: err.stack,
    });
  }
}

/**
 * Handle database errors with proper classification
 */
export function handleDatabaseError(error: Error, operation: string): never {
  const message = error.message.toLowerCase();
  
  // Classify database errors
  if (message.includes('not found') || message.includes('no rows')) {
    throw new NotFoundError('Resource', { operation, originalError: error.message });
  }
  
  if (message.includes('duplicate') || message.includes('unique constraint')) {
    throw new ValidationError('Resource already exists', { operation, originalError: error.message });
  }
  
  if (message.includes('foreign key') || message.includes('constraint')) {
    throw new ValidationError('Invalid reference', { operation, originalError: error.message });
  }
  
  // Generic database error
  throw new DatabaseError(`Database operation failed: ${operation}`, {
    operation,
    originalError: error.message,
  });
}

// Export error types for use in other modules
export { ErrorType as AppErrorType };