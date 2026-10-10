/**
 * Sentry Edge Configuration
 * This file configures the Sentry SDK for edge runtime error tracking
 */

import * as Sentry from '@sentry/nextjs';
import { releaseOption } from './src/lib/monitoring/sentry-release';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  
  // Environment configuration
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
  
  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',
  
  // Performance Monitoring (reduced for edge)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
  
  // Release tracking: the build's commit SHA, the same value the browser
  // reports (s84, src/lib/monitoring/sentry-release.ts). Spread, never
  // `release: undefined` — that would erase the SDK's own fallback.
  ...releaseOption(process.env.NEXT_PUBLIC_SENTRY_RELEASE),
  
  // Edge-specific configuration
  transportOptions: {
    // Reduce keep-alive to work better with edge runtime
    keepAlive: false,
  },
  
  // Filtering
  ignoreErrors: [
    // Network errors common in edge
    'FetchError',
    'NetworkError',
    'TimeoutError',
    
    // Edge-specific errors
    'EdgeRuntimeError',
    'WorkerError',
  ],
  
  beforeSend(event, hint) {
    // Add edge context
    event.contexts = {
      ...event.contexts,
      runtime: {
        name: 'edge',
        version: 'edge-runtime',
      },
      edge: {
        region: process.env.VERCEL_REGION || 'unknown',
        runtime: 'edge',
      },
    };
    
    // Tag edge events
    event.tags = {
      ...event.tags,
      runtime: 'edge',
    };
    
    return event;
  },
  
  // Custom tags
  initialScope: {
    tags: {
      component: 'edge',
      runtime: 'edge',
    },
  },
});