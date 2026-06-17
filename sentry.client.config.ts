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
      // Mask all text + media in session replays. Recopyfast replays render
      // customer website content (potentially their end-users' PII); capturing it
      // unmasked would route third-party personal data into our error tooling.
      maskAllText: true,
      blockAllMedia: true,
      maskAllInputs: true,
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
      const error = hint.originalException as Error | undefined;

      // Ignore errors from browser extensions
      if (error?.stack?.includes('chrome-extension://')) {
        return null;
      }

      // Ignore errors from third-party scripts
      if (error?.stack && (
        error.stack.includes('gtm.js') ||
        error.stack.includes('analytics.js') ||
        error.stack.includes('fbevents.js')
      )) {
        return null;
      }
    }
    
    // Attach only a non-PII user id for correlation. Email is personal data and
    // must not be shipped to Sentry — id alone is enough to join with our own logs.
    const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
    if (user) {
      try {
        const userData = JSON.parse(user);
        if (userData?.id) {
          event.user = { id: userData.id };
        }
      } catch {
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