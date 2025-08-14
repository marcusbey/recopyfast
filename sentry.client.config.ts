// This file configures the initialization of Sentry on the browser side.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Set profile sample rate for performance monitoring
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Add context tags and user identification
  initialScope: {
    tags: {
      component: 'client',
      environment: process.env.NODE_ENV,
    },
  },
  
  // Configure environment
  environment: process.env.NODE_ENV || 'development',
  
  // Capture unhandled promise rejections
  captureUnhandledRejections: true,
  
  // Configure integrations
  integrations: [
    Sentry.browserTracingIntegration({
      // Set up automatic route change tracking in Next.js App Router
      routingInstrumentation: Sentry.nextRouterInstrumentation(),
    }),
    Sentry.replayIntegration({
      // Capture replays only for errors in production
      sessionSampleRate: process.env.NODE_ENV === 'production' ? 0 : 0.1,
      errorSampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 1.0,
    }),
  ],
  
  // Configure beforeSend to filter out development noise
  beforeSend(event, hint) {
    // Filter out development-only errors
    if (process.env.NODE_ENV === 'development') {
      // Filter out hydration errors which are common in development
      if (event.exception?.values?.[0]?.value?.includes('Hydration')) {
        return null;
      }
    }
    
    // Add additional context
    if (hint.originalException instanceof Error) {
      event.tags = {
        ...event.tags,
        errorType: hint.originalException.constructor.name,
      };
    }
    
    return event;
  },
  
  // Configure release tracking
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
});