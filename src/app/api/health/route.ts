/**
 * Health Check API Endpoint
 * Provides comprehensive system health status for monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/monitoring/logger';
import * as Sentry from '@sentry/nextjs';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  checks: {
    database: ServiceCheck;
    storage: ServiceCheck;
    cache?: ServiceCheck;
    external?: ServiceCheck;
  };
  metrics?: {
    memory: MemoryMetrics;
    cpu?: CPUMetrics;
  };
}

interface ServiceCheck {
  status: 'ok' | 'error' | 'timeout';
  latency?: number;
  error?: string;
  details?: Record<string, any>;
}

interface MemoryMetrics {
  used: number;
  total: number;
  percentage: number;
}

interface CPUMetrics {
  usage: number;
  loadAverage: number[];
}

// Track server start time
const serverStartTime = Date.now();

async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();
    
    // Simple query to check database connectivity
    const { error } = await supabase
      .from('sites')
      .select('id')
      .limit(1)
      .single();

    const latency = Date.now() - start;

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned (which is fine)
      throw error;
    }

    return {
      status: 'ok',
      latency,
      details: {
        connected: true,
        responseTime: `${latency}ms`,
      },
    };
  } catch (error) {
    logger.error('Database health check failed', error as Error, undefined, {
      component: 'health-check',
      service: 'database',
    });

    return {
      status: 'error',
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkStorage(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();
    
    // Check if storage bucket exists
    const { data, error } = await supabase
      .storage
      .getBucket('assets');

    const latency = Date.now() - start;

    if (error) {
      throw error;
    }

    return {
      status: 'ok',
      latency,
      details: {
        connected: true,
        bucket: data?.name || 'assets',
        public: data?.public || false,
      },
    };
  } catch (error) {
    logger.error('Storage health check failed', error as Error, undefined, {
      component: 'health-check',
      service: 'storage',
    });

    return {
      status: 'error',
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkExternalServices(): Promise<ServiceCheck> {
  const start = Date.now();
  const services: Record<string, boolean> = {};

  try {
    // Check Sentry connectivity
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      try {
        // Sentry SDK provides isEnabled method
        services.sentry = Sentry.isEnabled();
      } catch {
        services.sentry = false;
      }
    }

    // Check other external services as needed
    // Add checks for Stripe, email services, etc.

    const latency = Date.now() - start;
    const allHealthy = Object.values(services).every(status => status);

    return {
      status: allHealthy ? 'ok' : 'error',
      latency,
      details: services,
    };
  } catch (error) {
    return {
      status: 'error',
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function getMemoryMetrics(): MemoryMetrics {
  const memoryUsage = process.memoryUsage();
  const totalMemory = memoryUsage.heapTotal;
  const usedMemory = memoryUsage.heapUsed;
  
  return {
    used: Math.round(usedMemory / 1024 / 1024), // MB
    total: Math.round(totalMemory / 1024 / 1024), // MB
    percentage: Math.round((usedMemory / totalMemory) * 100),
  };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Get detail level from query params
    const { searchParams } = new URL(request.url);
    const detailed = searchParams.get('detailed') === 'true';
    const quick = searchParams.get('quick') === 'true';

    // Quick health check - just return OK without checks
    if (quick) {
      return NextResponse.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    }

    // Run all health checks in parallel
    const [database, storage, external] = await Promise.allSettled([
      checkDatabase(),
      checkStorage(),
      detailed ? checkExternalServices() : Promise.resolve(undefined),
    ]);

    // Process results
    const checks: any = {
      database: database.status === 'fulfilled' ? database.value : {
        status: 'error',
        error: 'Check failed',
      },
      storage: storage.status === 'fulfilled' ? storage.value : {
        status: 'error',
        error: 'Check failed',
      },
    };

    if (detailed && external.status === 'fulfilled') {
      checks.external = external.value;
    }

    // Determine overall health status
    const statuses = Object.values(checks)
      .filter(Boolean)
      .map((check: any) => check.status);
    
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (statuses.includes('error')) {
      overallStatus = statuses.filter(s => s === 'error').length > 1 ? 'unhealthy' : 'degraded';
    }

    // Build response
    const response: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      uptime: Math.round((Date.now() - serverStartTime) / 1000), // seconds
      checks,
    };

    // Add metrics if requested
    if (detailed) {
      response.metrics = {
        memory: getMemoryMetrics(),
      };
    }

    // Log health check
    logger.info('Health check completed', undefined, {
      component: 'health-check',
      duration: Date.now() - startTime,
      status: overallStatus,
      detailed,
    });

    // Set appropriate status code
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;

    return NextResponse.json(response, { 
      status: statusCode,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    logger.error('Health check endpoint error', error as Error, undefined, {
      component: 'health-check',
    });

    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    }, { 
      status: 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }
}

// Support HEAD requests for uptime monitoring
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}