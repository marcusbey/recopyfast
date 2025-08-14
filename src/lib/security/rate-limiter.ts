import { createClient } from 'redis';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  identifier: string;
  identifierType: 'user' | 'ip' | 'api_key';
  endpoint?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalRequests: number;
}

export interface RateLimitInfo {
  requests: number;
  windowStart: number;
  windowEnd: number;
}

/**
 * In-memory rate limiter for development/small scale
 */
export class MemoryRateLimiter {
  private requests: Map<string, RateLimitInfo> = new Map();

  private generateKey(config: RateLimitConfig): string {
    const endpoint = config.endpoint || 'global';
    return `${config.identifierType}:${config.identifier}:${endpoint}`;
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [key, info] of this.requests.entries()) {
      if (now > info.windowEnd) {
        this.requests.delete(key);
      }
    }
  }

  async checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
    this.cleanupExpiredEntries();
    
    const key = this.generateKey(config);
    const now = Date.now();
    const windowStart = now;
    const windowEnd = now + config.windowMs;

    let info = this.requests.get(key);

    if (!info || now > info.windowEnd) {
      // Create new window
      info = {
        requests: 1,
        windowStart,
        windowEnd
      };
    } else {
      // Increment requests in current window
      info.requests++;
    }

    this.requests.set(key, info);

    const allowed = info.requests <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - info.requests);

    return {
      allowed,
      remaining,
      resetTime: info.windowEnd,
      totalRequests: info.requests
    };
  }

  async resetLimit(config: RateLimitConfig): Promise<void> {
    const key = this.generateKey(config);
    this.requests.delete(key);
  }

  async clearAll(): Promise<void> {
    this.requests.clear();
  }

  getStats(): { totalKeys: number; activeWindows: number } {
    this.cleanupExpiredEntries();
    return {
      totalKeys: this.requests.size,
      activeWindows: this.requests.size
    };
  }
}

/**
 * Redis-based rate limiter for production
 */
export class RedisRateLimiter {
  private client: ReturnType<typeof createClient>;
  private isConnected = false;

  constructor(redisUrl?: string) {
    this.client = createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
      this.isConnected = true;
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  private generateKey(config: RateLimitConfig): string {
    const endpoint = config.endpoint || 'global';
    const window = Math.floor(Date.now() / config.windowMs);
    return `rate_limit:${config.identifierType}:${config.identifier}:${endpoint}:${window}`;
  }

  async checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
    await this.connect();

    const key = this.generateKey(config);
    const now = Date.now();
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const windowEnd = windowStart + config.windowMs;

    // Use Redis pipeline for atomic operations
    const pipeline = this.client.multi();
    
    pipeline.incr(key);
    pipeline.expire(key, Math.ceil(config.windowMs / 1000));
    pipeline.ttl(key);

    const results = await pipeline.exec();
    
    if (!results || results.length < 3) {
      throw new Error('Redis pipeline execution failed');
    }

    const requests = results[0] as number;
    const ttl = results[2] as number;

    const allowed = requests <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - requests);
    const resetTime = ttl > 0 ? now + (ttl * 1000) : windowEnd;

    return {
      allowed,
      remaining,
      resetTime,
      totalRequests: requests
    };
  }

  async resetLimit(config: RateLimitConfig): Promise<void> {
    await this.connect();
    const key = this.generateKey(config);
    await this.client.del(key);
  }

  async clearAll(): Promise<void> {
    await this.connect();
    const keys = await this.client.keys('rate_limit:*');
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  async getStats(): Promise<{ totalKeys: number; activeWindows: number }> {
    await this.connect();
    const keys = await this.client.keys('rate_limit:*');
    return {
      totalKeys: keys.length,
      activeWindows: keys.length
    };
  }
}

/**
 * Rate limiter factory
 */
export class RateLimiterFactory {
  private static memoryInstance: MemoryRateLimiter;
  private static redisInstance: RedisRateLimiter;

  static getMemoryLimiter(): MemoryRateLimiter {
    if (!this.memoryInstance) {
      this.memoryInstance = new MemoryRateLimiter();
    }
    return this.memoryInstance;
  }

  static getRedisLimiter(redisUrl?: string): RedisRateLimiter {
    if (!this.redisInstance) {
      this.redisInstance = new RedisRateLimiter(redisUrl);
    }
    return this.redisInstance;
  }

  static getLimiter(useRedis = true): MemoryRateLimiter | RedisRateLimiter {
    return useRedis ? this.getRedisLimiter() : this.getMemoryLimiter();
  }
}

/**
 * Common rate limit configurations
 */
export const RATE_LIMIT_CONFIGS = {
  // API endpoints
  API_GENERAL: { windowMs: 60 * 1000, maxRequests: 60 }, // 60 requests per minute
  API_AUTH: { windowMs: 15 * 60 * 1000, maxRequests: 5 }, // 5 requests per 15 minutes
  API_CONTENT: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 requests per minute
  API_UPLOAD: { windowMs: 60 * 1000, maxRequests: 10 }, // 10 requests per minute

  // User-specific limits
  USER_GENERAL: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 requests per minute
  USER_CONTENT_EDIT: { windowMs: 60 * 1000, maxRequests: 50 }, // 50 edits per minute
  USER_DOMAIN_VERIFY: { windowMs: 5 * 60 * 1000, maxRequests: 3 }, // 3 verifications per 5 minutes

  // IP-based limits (more restrictive)
  IP_GENERAL: { windowMs: 60 * 1000, maxRequests: 200 }, // 200 requests per minute per IP
  IP_AUTH: { windowMs: 15 * 60 * 1000, maxRequests: 10 }, // 10 auth attempts per 15 minutes per IP
  IP_REGISTRATION: { windowMs: 60 * 60 * 1000, maxRequests: 5 }, // 5 registrations per hour per IP

  // API key-based limits
  API_KEY_DEFAULT: { windowMs: 60 * 1000, maxRequests: 1000 }, // 1000 requests per minute
  API_KEY_PREMIUM: { windowMs: 60 * 1000, maxRequests: 5000 }, // 5000 requests per minute
  API_KEY_ENTERPRISE: { windowMs: 60 * 1000, maxRequests: 20000 } // 20000 requests per minute
} as const;

/**
 * Rate limit middleware helper
 */
export function createRateLimitConfig(
  identifier: string,
  identifierType: 'user' | 'ip' | 'api_key',
  limitType: keyof typeof RATE_LIMIT_CONFIGS,
  endpoint?: string
): RateLimitConfig {
  const baseConfig = RATE_LIMIT_CONFIGS[limitType];
  return {
    ...baseConfig,
    identifier,
    identifierType,
    endpoint
  };
}

/**
 * Abuse detection utilities
 */
export class AbuseDetector {
  private suspiciousActivity: Map<string, { count: number; lastSeen: number }> = new Map();
  private readonly thresholds = {
    rapidRequests: 50, // 50 requests in a short time
    timeWindow: 10 * 1000, // 10 seconds
    suspicionThreshold: 3, // 3 rapid bursts = suspicious
    banDuration: 60 * 60 * 1000 // 1 hour ban
  };

  detectRapidRequests(identifier: string): { isSuspicious: boolean; shouldBan: boolean } {
    const now = Date.now();
    const activity = this.suspiciousActivity.get(identifier) || { count: 0, lastSeen: now };

    // Reset counter if enough time has passed
    if (now - activity.lastSeen > this.thresholds.timeWindow) {
      activity.count = 1;
    } else {
      activity.count++;
    }

    activity.lastSeen = now;
    this.suspiciousActivity.set(identifier, activity);

    const isSuspicious = activity.count > this.thresholds.rapidRequests;
    const shouldBan = activity.count > this.thresholds.suspicionThreshold * this.thresholds.rapidRequests;

    return { isSuspicious, shouldBan };
  }

  isCurrentlyBanned(identifier: string): boolean {
    const activity = this.suspiciousActivity.get(identifier);
    if (!activity) return false;

    const now = Date.now();
    const timeSinceBan = now - activity.lastSeen;

    return timeSinceBan < this.thresholds.banDuration;
  }

  clearSuspiciousActivity(identifier?: string): void {
    if (identifier) {
      this.suspiciousActivity.delete(identifier);
    } else {
      this.suspiciousActivity.clear();
    }
  }

  getSuspiciousActivities(): Array<{ identifier: string; count: number; lastSeen: Date }> {
    return Array.from(this.suspiciousActivity.entries()).map(([identifier, activity]) => ({
      identifier,
      count: activity.count,
      lastSeen: new Date(activity.lastSeen)
    }));
  }
}

// Export default instances
export const rateLimiter = RateLimiterFactory.getLimiter(process.env.NODE_ENV === 'production');
export const abuseDetector = new AbuseDetector();