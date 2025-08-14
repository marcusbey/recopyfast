// This file configures the initialization of Sentry on the server side.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Define how likely traces are sampled. Adjust this value in production.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Set profile sample rate for performance monitoring
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Add context tags
  initialScope: {
    tags: {
      component: 'server',
      environment: process.env.NODE_ENV,
    },
  },
  
  // Configure environment
  environment: process.env.NODE_ENV || 'development',
  
  // Capture unhandled promise rejections
  captureUnhandledRejections: true,
  
  // Configure integrations for server-side
  integrations: [
    Sentry.nodeProfilingIntegration(),
  ],
  
  // Configure beforeSend to add server context
  beforeSend(event, hint) {
    // Add server-specific context
    event.tags = {
      ...event.tags,
      runtime: 'node',
      platform: process.platform,
      nodeVersion: process.version,
    };
    
    // Add memory usage information
    const memUsage = process.memoryUsage();
    event.extra = {
      ...event.extra,
      memoryUsage: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
      },
    };
    
    // Filter out specific errors in development
    if (process.env.NODE_ENV === 'development') {
      const errorMessage = event.exception?.values?.[0]?.value || '';
      
      // Filter out common development errors
      const developmentErrorPatterns = [
        'EADDRINUSE',
        'ENOTFOUND',
        'connect ECONNREFUSED',
      ];
      
      if (developmentErrorPatterns.some(pattern => errorMessage.includes(pattern))) {
        return null;
      }
    }
    
    return event;
  },
  
  // Configure release tracking
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
});