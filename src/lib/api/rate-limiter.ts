import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: NextRequest) => string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  total: number;
}

export class APIRateLimiter {
  private supabase;

  constructor() {
    this.supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => '',
          set: () => {},
          remove: () => {},
        },
      }
    );
  }

  /**
   * Check rate limit for API key
   */
  async checkAPIKeyLimit(apiKeyId: string, config?: RateLimitConfig): Promise<RateLimitResult> {
    try {
      // Get API key with rate limit settings
      const { data: apiKey, error } = await this.supabase
        .from('api_keys')
        .select('rate_limit, is_active')
        .eq('id', apiKeyId)
        .single();

      if (error || !apiKey || !apiKey.is_active) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: Date.now(),
          total: 0
        };
      }

      const maxRequests = config?.maxRequests || apiKey.rate_limit || 1000;
      const windowMs = config?.windowMs || 60 * 60 * 1000; // 1 hour default

      return await this.checkLimit(`api_key:${apiKeyId}`, maxRequests, windowMs);
    } catch (error) {
      console.error('Rate limit check error:', error);
      return {
        allowed: false,
        remaining: 0,
        resetTime: Date.now(),
        total: 0
      };
    }
  }

  /**
   * Check rate limit for IP address
   */
  async checkIPLimit(ipAddress: string, config: RateLimitConfig): Promise<RateLimitResult> {
    return await this.checkLimit(`ip:${ipAddress}`, config.maxRequests, config.windowMs);
  }

  /**
   * Check rate limit for user
   */
  async checkUserLimit(userId: string, config: RateLimitConfig): Promise<RateLimitResult> {
    return await this.checkLimit(`user:${userId}`, config.maxRequests, config.windowMs);
  }

  /**
   * Generic rate limit checker
   */
  private async checkLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Clean up old entries
      await this.supabase
        .from('rate_limits')
        .delete()
        .lt('timestamp', new Date(windowStart).toISOString());

      // Count current requests in window
      const { count, error: countError } = await this.supabase
        .from('rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('key', key)
        .gte('timestamp', new Date(windowStart).toISOString());

      if (countError) {
        throw countError;
      }

      const currentCount = count || 0;
      const allowed = currentCount < maxRequests;
      const remaining = Math.max(0, maxRequests - currentCount - 1);

      if (allowed) {
        // Record this request
        await this.supabase
          .from('rate_limits')
          .insert({
            key,
            timestamp: new Date(now).toISOString()
          });
      }

      return {
        allowed,
        remaining,
        resetTime: windowStart + windowMs,
        total: maxRequests
      };
    } catch (error) {
      console.error('Rate limit error:', error);
      // In case of error, allow the request but log it
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: windowStart + windowMs,
        total: maxRequests
      };
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetLimit(key: string): Promise<void> {
    try {
      await this.supabase
        .from('rate_limits')
        .delete()
        .eq('key', key);
    } catch (error) {
      console.error('Reset rate limit error:', error);
    }
  }

  /**
   * Get rate limit status without incrementing
   */
  async getStatus(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const { count, error } = await this.supabase
        .from('rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('key', key)
        .gte('timestamp', new Date(windowStart).toISOString());

      if (error) {
        throw error;
      }

      const currentCount = count || 0;
      const remaining = Math.max(0, maxRequests - currentCount);

      return {
        allowed: currentCount < maxRequests,
        remaining,
        resetTime: windowStart + windowMs,
        total: maxRequests
      };
    } catch (error) {
      console.error('Get rate limit status error:', error);
      return {
        allowed: true,
        remaining: maxRequests,
        resetTime: windowStart + windowMs,
        total: maxRequests
      };
    }
  }
}

/**
 * Middleware for rate limiting
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const rateLimiter = new APIRateLimiter();

  return async (req: NextRequest) => {
    const key = config.keyGenerator ? config.keyGenerator(req) : getDefaultKey(req);
    const result = await rateLimiter.checkLimit(key, config.maxRequests, config.windowMs);

    return {
      rateLimitResult: result,
      headers: {
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(),
      }
    };
  };
}

/**
 * Default key generator based on IP address
 */
function getDefaultKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.ip || 'unknown';
  return `ip:${ip}`;
}

/**
 * API key extractor and validator
 */
export async function validateAPIKey(req: NextRequest): Promise<{
  valid: boolean;
  apiKey?: {
    id: string;
    site_id: string;
    permissions: Record<string, boolean>;
    rate_limit: number;
    expires_at?: string;
  };
  error?: string;
}> {
  try {
    const authHeader = req.headers.get('authorization');
    const apiKeyFromHeader = req.headers.get('x-api-key');
    
    let apiKeyValue: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKeyValue = authHeader.substring(7);
    } else if (apiKeyFromHeader) {
      apiKeyValue = apiKeyFromHeader;
    }

    if (!apiKeyValue) {
      return { valid: false, error: 'API key required' };
    }

    // Hash the API key for lookup (assuming keys are stored hashed)
    // In production, use proper hashing
    const keyHash = Buffer.from(apiKeyValue).toString('base64');

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => '',
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: apiKey, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();

    if (error || !apiKey) {
      return { valid: false, error: 'Invalid API key' };
    }

    // Check if key is expired
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return { valid: false, error: 'API key expired' };
    }

    // Update last used timestamp
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKey.id);

    return { valid: true, apiKey };
  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false, error: 'Internal error' };
  }
}

// Rate limiting configurations for different endpoints
export const RATE_LIMIT_CONFIGS = {
  // Public API endpoints
  public: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000
  },
  
  // Authentication endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10
  },
  
  // Content read operations
  content_read: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5000
  },
  
  // Content write operations
  content_write: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000
  },
  
  // Bulk operations
  bulk: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10
  },
  
  // Analytics
  analytics: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 500
  }
};

export const rateLimiter = new APIRateLimiter();