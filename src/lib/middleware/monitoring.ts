/**
 * API Monitoring Middleware
 * Tracks API requests, responses, and performance metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger, createRequestContext, LogContext } from '../monitoring/logger';
import { performanceMonitor } from '../monitoring/performance';
import { systemMonitor } from '../monitoring/system-status';
import { config } from '../config/production';
import * as Sentry from '@sentry/nextjs';

interface RequestMetadata {
  method: string;
  url: string;
  userAgent?: string;
  referer?: string;
  contentLength?: number;
  userId?: string;
  sessionId?: string;
}

interface ResponseMetadata {
  statusCode: number;
  contentLength?: number;
  duration: number;
  cached?: boolean;
  error?: string;
}

/**
 * API request monitoring middleware
 */
export function withApiMonitoring(
  handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>,
  options: {
    skipLogging?: boolean;
    skipMetrics?: boolean;
    operationName?: string;
  } = {}
) {
  return async function monitoredHandler(req: NextRequest, context?: unknown): Promise<NextResponse> {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    const operationName = options.operationName || `${req.method} ${new URL(req.url).pathname}`;

    // Create request context for logging
    const requestContext: LogContext = {
      ...createRequestContext(req as Parameters<typeof createRequestContext>[0]),
      requestId,
      method: req.method,
      url: req.url,
      operationName,
    };

    // Extract request metadata
    const requestMetadata: RequestMetadata = {
      method: req.method,
      url: req.url,
      userAgent: req.headers.get('user-agent') || undefined,
      referer: req.headers.get('referer') || undefined,
      contentLength: req.headers.get('content-length') ? 
        parseInt(req.headers.get('content-length')!, 10) : undefined,
    };

    // Try to extract user info from auth headers
    try {
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        // Add user context if available (implement based on your auth system)
        // const user = await extractUserFromAuth(authHeader);
        // requestMetadata.userId = user?.id;
      }
    } catch {
      // Ignore auth extraction errors
    }

    // Start performance tracking
    const timerId = options.skipMetrics ? null : 
      performanceMonitor.startTimer(`api.${req.method.toLowerCase()}_request`, {
        method: req.method,
        path: new URL(req.url).pathname,
      });

    // Track active request
    systemMonitor.trackActiveRequest(1);

    // Start Sentry transaction
    let transaction;
    if (config.monitoring.sentry.enabled) {
      transaction = Sentry.startTransaction({
        name: operationName,
        op: 'http.server',
        data: {
          'http.method': req.method,
          'http.url': req.url,
          'http.user_agent': requestMetadata.userAgent,
        },
      });
      Sentry.getCurrentScope().setSpan(transaction);
    }

    let response: NextResponse;
    let responseMetadata: ResponseMetadata;

    try {
      // Log request start
      if (!options.skipLogging) {
        logger.http(`${req.method} ${new URL(req.url).pathname} - Started`, requestContext, {
          component: 'api-middleware',
          requestMetadata,
        });
      }

      // Execute the actual handler
      response = await handler(req, context);
      
      // Calculate response time
      const duration = Date.now() - startTime;
      
      // Extract response metadata
      responseMetadata = {
        statusCode: response.status,
        contentLength: response.headers.get('content-length') ? 
          parseInt(response.headers.get('content-length')!, 10) : undefined,
        duration,
        cached: response.headers.get('x-cache-status') === 'HIT',
      };

      // Log successful response
      if (!options.skipLogging) {
        logger.http(
          `${req.method} ${new URL(req.url).pathname} - ${response.status}`,
          requestContext,
          {
            component: 'api-middleware',
            requestMetadata,
            responseMetadata,
          }
        );
      }

      // Track metrics
      if (!options.skipMetrics) {
        systemMonitor.trackRequest(duration, response.status >= 400);
        
        // Record API response time
        performanceMonitor.recordMetric({
          name: 'api.response_time',
          value: duration,
          unit: 'ms',
          tags: {
            method: req.method,
            status: response.status.toString(),
            path: new URL(req.url).pathname,
          },
          metadata: {
            success: response.status < 400,
            cached: responseMetadata.cached,
          },
        });
      }

      // Set Sentry transaction status
      if (transaction) {
        transaction.setHttpStatus(response.status);
        transaction.setData('http.response.status_code', response.status);
        transaction.setStatus(response.status < 400 ? 'ok' : 'internal_error');
      }

      return response;

    } catch (err) {
      const error = err as Error;
      const duration = Date.now() - startTime;
      
      // Create error response
      response = NextResponse.json(
        { 
          error: 'Internal Server Error',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );

      responseMetadata = {
        statusCode: 500,
        duration,
        error: error.message,
      };

      // Log error
      logger.error(
        `${req.method} ${new URL(req.url).pathname} - Error`,
        error,
        requestContext,
        {
          component: 'api-middleware',
          requestMetadata,
          responseMetadata,
        }
      );

      // Track error metrics
      if (!options.skipMetrics) {
        systemMonitor.trackRequest(duration, true);
        
        performanceMonitor.recordMetric({
          name: 'api.error_rate',
          value: 1,
          unit: 'count',
          tags: {
            method: req.method,
            path: new URL(req.url).pathname,
            errorType: error.constructor.name,
          },
          metadata: {
            errorMessage: error.message,
          },
        });
      }

      // Set Sentry transaction error status
      if (transaction) {
        transaction.setStatus('internal_error');
        transaction.setData('error', error.message);
        Sentry.captureException(error);
      }

      return response;

    } finally {
      // End performance tracking
      if (timerId) {
        performanceMonitor.endTimer(timerId, {
          statusCode: response!.status,
          success: response!.status < 400,
        });
      }

      // Track active request completion
      systemMonitor.trackActiveRequest(-1);

      // Finish Sentry transaction
      if (transaction) {
        transaction.finish();
      }
    }
  };
}

/**
 * Rate limiting middleware
 */
export function withRateLimit(
  handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>,
  options: {
    windowMs?: number;
    maxRequests?: number;
    keyGenerator?: (req: NextRequest) => string;
    skip?: (req: NextRequest) => boolean;
  } = {}
) {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();
  const windowMs = options.windowMs || config.api.rateLimiting.windowMs;
  const maxRequests = options.maxRequests || config.api.rateLimiting.maxRequests;

  const defaultKeyGenerator = (req: NextRequest) => {
    return req.headers.get('x-forwarded-for') || 
           req.headers.get('x-real-ip') || 
           'unknown';
  };

  const keyGenerator = options.keyGenerator || defaultKeyGenerator;

  return async function rateLimitedHandler(req: NextRequest, context?: unknown): Promise<NextResponse> {
    // Skip rate limiting if configured
    if (options.skip && options.skip(req)) {
      return handler(req, context);
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const resetTime = now + windowMs;

    // Clean up old entries
    for (const [k, v] of requestCounts.entries()) {
      if (v.resetTime < now) {
        requestCounts.delete(k);
      }
    }

    // Get current count
    let requestData = requestCounts.get(key);
    if (!requestData || requestData.resetTime < now) {
      requestData = { count: 0, resetTime };
      requestCounts.set(key, requestData);
    }

    // Check rate limit
    if (requestData.count >= maxRequests) {
      logger.warn('Rate limit exceeded', { ip: key }, {
        component: 'rate-limiter',
        limit: maxRequests,
        window: windowMs,
        current: requestData.count,
      });

      return NextResponse.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${Math.ceil((requestData.resetTime - now) / 1000)} seconds.`,
          retryAfter: Math.ceil((requestData.resetTime - now) / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((requestData.resetTime - now) / 1000).toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': Math.max(0, maxRequests - requestData.count - 1).toString(),
            'X-RateLimit-Reset': new Date(requestData.resetTime).toISOString(),
          },
        }
      );
    }

    // Increment counter
    requestData.count++;

    // Add rate limit headers to response
    const response = await handler(req, context);
    
    response.headers.set('X-RateLimit-Limit', maxRequests.toString());
    response.headers.set('X-RateLimit-Remaining', Math.max(0, maxRequests - requestData.count).toString());
    response.headers.set('X-RateLimit-Reset', new Date(requestData.resetTime).toISOString());

    return response;
  };
}

/**
 * CORS middleware
 */
export function withCors(
  handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>,
  options: {
    origins?: string[];
    methods?: string[];
    headers?: string[];
    credentials?: boolean;
  } = {}
) {
  const origins = options.origins || config.api.cors.origins;
  const methods = options.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  const headers = options.headers || ['Content-Type', 'Authorization', 'X-Requested-With'];
  const credentials = options.credentials !== undefined ? options.credentials : config.api.cors.credentials;

  return async function corsHandler(req: NextRequest, context?: unknown): Promise<NextResponse> {
    const origin = req.headers.get('origin');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': origin && origins.includes(origin) ? origin : origins[0],
          'Access-Control-Allow-Methods': methods.join(', '),
          'Access-Control-Allow-Headers': headers.join(', '),
          'Access-Control-Allow-Credentials': credentials.toString(),
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const response = await handler(req, context);

    // Add CORS headers
    if (origin && origins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    } else if (origins.length > 0) {
      response.headers.set('Access-Control-Allow-Origin', origins[0]);
    }
    
    response.headers.set('Access-Control-Allow-Credentials', credentials.toString());
    response.headers.set('Vary', 'Origin');

    return response;
  };
}