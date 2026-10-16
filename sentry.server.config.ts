/**
 * Sentry Server Configuration
 * This file configures the Sentry SDK for server-side error tracking
 */

import * as Sentry from '@sentry/nextjs';
import { releaseOption } from './src/lib/monitoring/sentry-release';
import { tracePropagationTargets } from './src/lib/monitoring/trace-propagation';
import { isMeasurementProtocolRequest, filterAnalyticsBreadcrumb, filterAnalyticsTransaction } from './src/lib/monitoring/analytics-telemetry';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  
  // Environment configuration
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
  
  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // s96: trace headers go to our own origins only. Unset, the SDK attaches
  // them to EVERY outgoing request — including the free tools' fetches of
  // sites a stranger named (src/lib/monitoring/trace-propagation.ts).
  tracePropagationTargets: tracePropagationTargets(process.env),

  // Release tracking: the build's commit SHA, the same value the browser
  // reports (s84, src/lib/monitoring/sentry-release.ts). Spread, never
  // `release: undefined` — that would erase the SDK's own fallback.
  ...releaseOption(process.env.NEXT_PUBLIC_SENTRY_RELEASE),
  
  // Integrations
  integrations: [
    // The installed SDK's ignoreOutgoingRequests excludes both fetch spans and
    // breadcrumbs; tracePropagationTargets alone does not hide query secrets.
    Sentry.nativeNodeFetchIntegration({
      ignoreOutgoingRequests: isMeasurementProtocolRequest,
    }),
  ],
  
  // Final envelope defenses preserve unrelated telemetry and cover duplicate
  // outgoing instrumentation outside the NodeFetch integration.
  beforeBreadcrumb: filterAnalyticsBreadcrumb,
  beforeSendTransaction: filterAnalyticsTransaction,

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
  
  beforeSend(event) {
    // Filter sensitive data
    if (event.request) {
      // Remove sensitive headers
      if (event.request.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-supabase-auth'];
      }

      // Remove sensitive query params
      if (typeof event.request.query_string === 'string') {
        event.request.query_string = event.request.query_string
          .split('&')
          .filter((param: string) => !param.includes('token') && !param.includes('key'))
          .join('&');
      }

      // Remove sensitive body data
      const data = event.request.data as Record<string, unknown> | undefined;
      if (data && typeof data === 'object') {
        const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
        sensitiveKeys.forEach(key => {
          if (data[key]) {
            data[key] = '[REDACTED]';
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