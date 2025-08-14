// This file configures the initialization of Sentry for edge runtime.
// The config you add here will be used whenever a page or API route is running in the edge runtime.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Define how likely traces are sampled. Adjust this value in production.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Add context tags
  initialScope: {
    tags: {
      component: 'edge',
      environment: process.env.NODE_ENV,
      runtime: 'edge',
    },
  },
  
  // Configure environment
  environment: process.env.NODE_ENV || 'development',
  
  // Configure beforeSend for edge runtime
  beforeSend(event, hint) {
    // Add edge-specific context
    event.tags = {
      ...event.tags,
      runtime: 'edge',
    };
    
    return event;
  },
  
  // Configure release tracking
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
});