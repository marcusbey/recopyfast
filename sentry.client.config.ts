/**
 * Sentry Client Configuration
 * This file configures the Sentry SDK for client-side error tracking
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  
  // Environment configuration
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',
  
  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Session Replay
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
  
  // Release tracking
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  
  // Integrations
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
      maskAllInputs: true,
      maskAllSelectors: ['.sensitive-data'],
    }),
    Sentry.browserTracingIntegration(),
  ],
  
  // Filtering
  ignoreErrors: [
    // Browser errors
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
    
    // Network errors
    'NetworkError',
    'Network request failed',
    'Failed to fetch',
    
    // User canceled actions
    'The user aborted a request',
    'User cancelled',
    'Request aborted',
    
    // Common extension errors
    'Extension context invalidated',
    'Cannot access dead object',
  ],
  
  beforeSend(event, hint) {
    // Filter out non-critical errors
    if (event.exception) {
      const error = hint.originalException;
      
      // Ignore errors from browser extensions
      if (error && error.stack && error.stack.includes('chrome-extension://')) {
        return null;
      }
      
      // Ignore errors from third-party scripts
      if (error && error.stack && (
        error.stack.includes('gtm.js') ||
        error.stack.includes('analytics.js') ||
        error.stack.includes('fbevents.js')
      )) {
        return null;
      }
    }
    
    // Add user context if available
    const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
    if (user) {
      try {
        const userData = JSON.parse(user);
        event.user = {
          id: userData.id,
          email: userData.email,
        };
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    return event;
  },
  
  // Custom tags
  initialScope: {
    tags: {
      component: 'client',
    },
  },
});