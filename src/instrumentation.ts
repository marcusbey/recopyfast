/**
 * Instrumentation file for Next.js
 * This file runs when the server starts and is used to initialize monitoring tools
 */

export async function register() {
  // Register monitoring tools in production
  if (process.env.NODE_ENV === 'production') {
    // Import and initialize Sentry for server-side monitoring
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      await import('../sentry.server.config');
    }
    
    // Register other monitoring tools here
    console.log('Production monitoring initialized');
  } else {
    console.log('Development mode - monitoring disabled');
  }
}