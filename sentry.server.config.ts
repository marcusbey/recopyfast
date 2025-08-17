/**
 * Sentry Server Configuration
 * This file configures the Sentry SDK for server-side error tracking
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  
  // Environment configuration
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
  
  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Release tracking
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  
  // Server-specific options
  autoSessionTracking: true,
  
  // Integrations
  integrations: [
    // Default Next.js integrations
  ],
  
  // Filtering
  ignoreErrors: [
    // Ignore non-critical errors
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    
    // Ignore expected errors
    'AbortError',
    'No user found',
    'Invalid token',
  ],
  
  beforeSend(event, hint) {
    // Filter sensitive data
    if (event.request) {
      // Remove sensitive headers
      if (event.request.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-supabase-auth'];
      }
      
      // Remove sensitive query params
      if (event.request.query_string) {
        event.request.query_string = event.request.query_string
          .split('&')
          .filter(param => !param.includes('token') && !param.includes('key'))
          .join('&');
      }
      
      // Remove sensitive body data
      if (event.request.data) {
        const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
        sensitiveKeys.forEach(key => {
          if (event.request.data[key]) {
            event.request.data[key] = '[REDACTED]';
          }
        });
      }
    }
    
    // Add server context
    event.contexts = {
      ...event.contexts,
      runtime: {
        name: 'node',
        version: process.version,
      },
      server: {
        host: process.env.VERCEL_URL || 'localhost',
        region: process.env.VERCEL_REGION || 'local',
      },
    };
    
    return event;
  },
  
  // Custom tags
  initialScope: {
    tags: {
      component: 'server',
      runtime: 'node',
    },
  },
});