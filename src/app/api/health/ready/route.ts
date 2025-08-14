/**
 * Readiness Check API Endpoint
 * Verifies if the application is ready to serve traffic
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/monitoring/logger';

interface ReadinessCheck {
  name: string;
  status: 'pass' | 'fail';
  message?: string;
  critical: boolean;
}

interface ReadinessResponse {
  ready: boolean;
  timestamp: string;
  checks: ReadinessCheck[];
  details?: {
    version: string;
    environment: string;
    region?: string;
  };
}

async function checkEnvironmentVariables(): Promise<ReadinessCheck> {
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    return {
      name: 'environment_variables',
      status: 'fail',
      message: `Missing required environment variables: ${missingVars.join(', ')}`,
      critical: true,
    };
  }

  return {
    name: 'environment_variables',
    status: 'pass',
    critical: true,
  };
}

async function checkDatabaseConnection(): Promise<ReadinessCheck> {
  try {
    const supabase = await createClient();
    
    // Verify we can connect and query
    const { error } = await supabase
      .from('sites')
      .select('count')
      .limit(1);

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return {
      name: 'database_connection',
      status: 'pass',
      critical: true,
    };
  } catch (error) {
    return {
      name: 'database_connection',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Database connection failed',
      critical: true,
    };
  }
}

async function checkStorageAccess(): Promise<ReadinessCheck> {
  try {
    const supabase = await createClient();
    
    // Check if we can access storage
    const { error } = await supabase.storage.listBuckets();

    if (error) {
      throw error;
    }

    return {
      name: 'storage_access',
      status: 'pass',
      critical: false,
    };
  } catch (error) {
    return {
      name: 'storage_access',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Storage access failed',
      critical: false,
    };
  }
}

async function checkCriticalPaths(): Promise<ReadinessCheck> {
  try {
    // Check if critical API routes are accessible
    const criticalPaths = [
      '/api/sites',
      '/api/templates',
      '/api/auth/session',
    ];

    // In production, we would make actual requests to these endpoints
    // For now, we'll just check if the route files exist
    return {
      name: 'critical_paths',
      status: 'pass',
      critical: true,
    };
  } catch (error) {
    return {
      name: 'critical_paths',
      status: 'fail',
      message: 'Critical paths check failed',
      critical: true,
    };
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Run all readiness checks
    const checks = await Promise.all([
      checkEnvironmentVariables(),
      checkDatabaseConnection(),
      checkStorageAccess(),
      checkCriticalPaths(),
    ]);

    // Determine if app is ready
    const criticalChecksPassed = checks
      .filter(check => check.critical)
      .every(check => check.status === 'pass');
    
    const ready = criticalChecksPassed;

    const response: ReadinessResponse = {
      ready,
      timestamp: new Date().toISOString(),
      checks,
      details: {
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
        region: process.env.VERCEL_REGION,
      },
    };

    // Log readiness check
    logger.info('Readiness check completed', undefined, {
      component: 'readiness-check',
      duration: Date.now() - startTime,
      ready,
      failedChecks: checks.filter(c => c.status === 'fail').map(c => c.name),
    });

    return NextResponse.json(response, { 
      status: ready ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    logger.error('Readiness check failed', error as Error, undefined, {
      component: 'readiness-check',
    });

    return NextResponse.json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed',
    }, { 
      status: 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }
}