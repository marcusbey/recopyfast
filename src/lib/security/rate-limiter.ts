import { createClient } from "redis";

/**
 * Environment names that mean "a developer's machine", and nothing else.
 *
 * Everything not on this list — including an environment that identifies
 * itself as nothing at all — is treated as serving real traffic. See
 * `isProductionLikeEnvironment` for why the default leans that way.
 */
const DEVELOPER_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * True where requests arrive from the internet rather than from whoever is
 * running the app.
 *
 * WHY NOT `NODE_ENV === "production"` (M-1)
 * ----------------------------------------
 * That is what this module used to ask, and it is the wrong question twice
 * over. NODE_ENV describes the compile, not the deployment: Vercel sets it to
 * "production" for every `next build`, previews included, and it is ordinary
 * configuration that can be dropped or mistyped by hand. When it came back
 * false the app silently got `MemoryRateLimiter`, whose `checkLimit` never
 * throws — so every `onStoreFailure: "deny"` in the codebase became dead code
 * and the counters went per-isolate, which on a serverless platform is no
 * limit at all. No log, no failure, nothing to notice. `src/lib/stripe/mode.ts`
 * carries the same tombstone for the same variable.
 *
 * VERCEL_ENV is set by the platform on every deployment and is the honest
 * discriminator, so it is read first — the resolution order this project
 * already uses in `src/lib/config/production.ts` and both health routes.
 * "preview" counts as production-like: a preview deployment is publicly
 * reachable and serves the same service-role widget paths as production, whose
 * credential is published in the customer's own page markup. ADR 002 rule 4
 * makes the fail-closed limiter the thing that bounds a copied token; an
 * unmetered preview is the same exposure as an unmetered production.
 *
 * The default when NOTHING identifies the environment is production-like, on
 * purpose. Being wrongly strict costs a 503 that someone reads within the
 * hour; being wrongly permissive costs an unmetered service-role path that no
 * signal anywhere reports. Only the two names above buy the memory store.
 */
export function isProductionLikeEnvironment(): boolean {
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;
  if (!environment) return true;
  return !DEVELOPER_ENVIRONMENTS.has(environment);
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  identifier: string;
  identifierType: "user" | "ip" | "api_key";
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
    const endpoint = config.endpoint || "global";
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
    // Anchor the window to a fixed wall-clock boundary (not to the first request).
    // This mirrors RedisRateLimiter so dev (memory) and prod (redis) enforce the
    // SAME limit. Anchoring to first-hit let a caller drift the window forward with
    // every request and sustain ~2x the intended rate across boundaries.
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const windowEnd = windowStart + config.windowMs;

    let info = this.requests.get(key);

    if (!info || now >= info.windowEnd) {
      // Start of a fresh fixed window
      info = {
        requests: 1,
        windowStart,
        windowEnd,
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
      totalRequests: info.requests,
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
      activeWindows: this.requests.size,
    };
  }
}

/** Max time to wait for the TCP handshake before giving up on Redis. */
const REDIS_CONNECT_TIMEOUT_MS = 2000;

/** Max time to wait for a single rate-limit command round trip. */
const REDIS_COMMAND_TIMEOUT_MS = 1500;

/**
 * Reject a promise if it has not settled within `timeoutMs`.
 * A serverless invocation has a hard execution budget — a rate-limit check must
 * never be the thing that consumes it. Without this, an unreachable-but-not-yet
 * -refused Redis host stalls every request until the platform kills the function.
 */
async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Redis-based rate limiter for production.
 *
 * Serverless lifecycle notes (Vercel functions):
 *  - The client is created lazily and cached on the module singleton so warm
 *    invocations in the same isolate reuse one TCP connection. Cold starts pay
 *    a new handshake; that is inherent to node-redis over TCP.
 *  - Connection state is read from `client.isOpen` rather than a hand-maintained
 *    boolean. The previous flag desynced whenever an 'error' event fired without
 *    the socket actually closing, which made connect() either double-open or
 *    skip connecting entirely.
 *  - Concurrent checkLimit() calls in one isolate share a single in-flight
 *    connect promise instead of each racing to open their own socket.
 *  - A client that fails to connect is discarded so the next invocation builds a
 *    fresh one instead of reusing a permanently broken socket.
 *
 * Callers decide the failure policy. checkLimit() throws when Redis is
 * unreachable; it does NOT silently allow. See `enforceRateLimit` in
 * `@/lib/api/rate-limit` for the fail-open/fail-closed decision per endpoint.
 */
export class RedisRateLimiter {
  private client: ReturnType<typeof createClient> | null = null;
  private connecting: Promise<void> | null = null;
  private readonly resolvedUrl?: string;

  constructor(redisUrl?: string) {
    // Store the URL but DO NOT construct the Redis client here. createClient()
    // parses the URL synchronously, so constructing it at module-import time
    // would throw during `next build` page-data collection whenever a route
    // imports this module with a placeholder/invalid REDIS_URL. The client is
    // created lazily on first connect() instead.
    this.resolvedUrl = redisUrl ?? process.env.REDIS_URL;
  }

  private ensureClient(): ReturnType<typeof createClient> {
    if (!this.client) {
      // In production a missing REDIS_URL means rate limiting would silently
      // fall back to a local Redis that does not exist on Vercel. Fail fast
      // so the misconfiguration is caught at first use rather than ignored.
      //
      // Keyed on the same predicate as the store selection below, not on
      // NODE_ENV: a deployment whose NODE_ENV was lost would otherwise dial
      // localhost:6379 and surface ECONNREFUSED instead of naming the variable
      // an operator has to set.
      if (!this.resolvedUrl && isProductionLikeEnvironment()) {
        throw new Error(
          "REDIS_URL environment variable is required in production. " +
            "Rate limiting cannot be initialised without a Redis connection.",
        );
      }

      this.client = createClient({
        url: this.resolvedUrl ?? "redis://localhost:6379",
        socket: {
          connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
          // Do not retry forever inside a function invocation. One retry, then
          // surface the failure to the caller so it can apply its policy.
          reconnectStrategy: (retries) =>
            retries > 1 ? new Error("Redis unreachable") : 200,
        },
      });

      // node-redis emits 'error' for both connection and command failures. An
      // unhandled 'error' on an EventEmitter crashes the process, so this
      // listener is mandatory even though the promise rejection is what we act on.
      this.client.on("error", (err) => {
        console.error("Redis Client Error:", err);
      });
    }
    return this.client;
  }

  /** Discard a broken client so the next call builds a fresh one. */
  private resetClient(): void {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (!client) return;
    try {
      client.destroy();
    } catch {
      // The socket is already gone; nothing left to clean up.
    }
  }

  async connect(): Promise<void> {
    const client = this.ensureClient();
    if (client.isOpen) return;

    // Collapse concurrent connects in the same isolate onto one handshake.
    if (!this.connecting) {
      this.connecting = withTimeout(
        client.connect().then(() => undefined),
        REDIS_CONNECT_TIMEOUT_MS,
        "Redis connect",
      ).finally(() => {
        this.connecting = null;
      });
    }

    try {
      await this.connecting;
    } catch (error) {
      this.resetClient();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.resetClient();
  }

  /**
   * `now` is passed in rather than read here so one checkLimit() call derives
   * the key and the window boundaries from a single instant. Reading the clock
   * twice let a call that straddled a window boundary bump the counter for one
   * window while reporting the reset time of the next.
   */
  private generateKey(config: RateLimitConfig, now: number): string {
    const endpoint = config.endpoint || "global";
    const window = Math.floor(now / config.windowMs);
    return `rate_limit:${config.identifierType}:${config.identifier}:${endpoint}:${window}`;
  }

  async checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
    await this.connect();

    const now = Date.now();
    const key = this.generateKey(config, now);
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const windowEnd = windowStart + config.windowMs;

    /**
     * Two commands, not three.
     *
     * The key is already scoped to a fixed window, so it expires exactly at
     * `windowEnd` — the TTL round-trip that used to be here only re-derived a
     * number this function had already computed. It was also less accurate:
     * `now + ttl * 1000` measures the TTL forward from the CURRENT request, so
     * the first request of a window reported a reset up to a full window late
     * and clients got an inflated Retry-After.
     *
     * The third of the traffic this removes matters on a metered store: the
     * auth endpoints fail closed, so exhausting a command quota takes down
     * editor login exactly the way a dead instance does.
     */
    const pipeline = this.client!.multi();

    pipeline.incr(key);
    pipeline.expire(key, Math.ceil(config.windowMs / 1000));

    let results: unknown[] | null;
    try {
      results = await withTimeout(
        pipeline.exec(),
        REDIS_COMMAND_TIMEOUT_MS,
        "Redis rate-limit pipeline",
      );
    } catch (error) {
      // A timed-out or failed command usually means the socket is unusable.
      this.resetClient();
      throw error;
    }

    if (!results || results.length < 2) {
      throw new Error("Redis pipeline execution failed");
    }

    const requests = Number(results[0]);

    // A non-numeric INCR reply means the key holds something else entirely (key
    // collision, or someone else writing into our namespace). Treating NaN as a
    // count would make `allowed` false-y in a way that silently denies traffic.
    if (!Number.isFinite(requests)) {
      throw new Error("Redis INCR returned a non-numeric reply");
    }

    const allowed = requests <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - requests);

    return {
      allowed,
      remaining,
      resetTime: windowEnd,
      totalRequests: requests,
    };
  }

  async resetLimit(config: RateLimitConfig): Promise<void> {
    await this.connect();
    const key = this.generateKey(config, Date.now());
    await this.client!.del(key);
  }

  async clearAll(): Promise<void> {
    await this.connect();
    const keys = await this.client!.keys("rate_limit:*");
    if (keys.length > 0) {
      await this.client!.del(keys);
    }
  }

  async getStats(): Promise<{ totalKeys: number; activeWindows: number }> {
    await this.connect();
    const keys = await this.client!.keys("rate_limit:*");
    return {
      totalKeys: keys.length,
      activeWindows: keys.length,
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
  API_KEY_ENTERPRISE: { windowMs: 60 * 1000, maxRequests: 20000 }, // 20000 requests per minute
} as const;

/**
 * Rate limit middleware helper
 */
export function createRateLimitConfig(
  identifier: string,
  identifierType: "user" | "ip" | "api_key",
  limitType: keyof typeof RATE_LIMIT_CONFIGS,
  endpoint?: string,
): RateLimitConfig {
  const baseConfig = RATE_LIMIT_CONFIGS[limitType];
  return {
    ...baseConfig,
    identifier,
    identifierType,
    endpoint,
  };
}

/**
 * Abuse detection utilities
 */
export class AbuseDetector {
  private suspiciousActivity: Map<string, { count: number; lastSeen: number }> =
    new Map();
  private readonly thresholds = {
    rapidRequests: 50, // 50 requests in a short time
    timeWindow: 10 * 1000, // 10 seconds
    suspicionThreshold: 3, // 3 rapid bursts = suspicious
    banDuration: 60 * 60 * 1000, // 1 hour ban
  };

  detectRapidRequests(identifier: string): {
    isSuspicious: boolean;
    shouldBan: boolean;
  } {
    const now = Date.now();
    const activity = this.suspiciousActivity.get(identifier) || {
      count: 0,
      lastSeen: now,
    };

    // Reset counter if enough time has passed
    if (now - activity.lastSeen > this.thresholds.timeWindow) {
      activity.count = 1;
    } else {
      activity.count++;
    }

    activity.lastSeen = now;
    this.suspiciousActivity.set(identifier, activity);

    const isSuspicious = activity.count > this.thresholds.rapidRequests;
    const shouldBan =
      activity.count >
      this.thresholds.suspicionThreshold * this.thresholds.rapidRequests;

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

  getSuspiciousActivities(): Array<{
    identifier: string;
    count: number;
    lastSeen: Date;
  }> {
    return Array.from(this.suspiciousActivity.entries()).map(
      ([identifier, activity]) => ({
        identifier,
        count: activity.count,
        lastSeen: new Date(activity.lastSeen),
      }),
    );
  }
}

/** How the environment described itself, for a log line an operator can act on. */
function describeEnvironment(): string {
  const vercelEnv = process.env.VERCEL_ENV ?? "<unset>";
  const nodeEnv = process.env.NODE_ENV ?? "<unset>";
  return `VERCEL_ENV=${vercelEnv}, NODE_ENV=${nodeEnv}`;
}

/**
 * Pick the store this process will meter against, and refuse to do it quietly.
 *
 * This runs once, at module import — the closest thing a serverless app has to
 * a startup gate. `server/index.js`'s `assertProductionEnvironment()` answers
 * the same misconfiguration by refusing to boot and exiting 1; a Vercel
 * function has no boot to refuse, so the equivalent is the pair below: a
 * production-like deployment NEVER receives the in-memory store, and a missing
 * REDIS_URL is stated at error level rather than absorbed.
 *
 * Error, not warn, and not silence. The failure this replaces was invisible by
 * construction — the memory limiter answers every check successfully, so
 * nothing downstream could tell "metered" from "unmetered". A warning would be
 * one more line in a stream nobody reads at the moment it matters.
 *
 * Note what this deliberately does NOT do: fail the import. Throwing here would
 * take every route in the app down over a rate-limit store, including the ones
 * that declared `onStoreFailure: "allow"` precisely because they would rather
 * serve unmetered than not serve. Handing them the Redis limiter instead lets
 * each endpoint keep the policy it chose — the fail-closed ones 503, the
 * fail-open ones proceed — which is the behaviour they were reviewed against.
 */
function selectRateLimiter(): MemoryRateLimiter | RedisRateLimiter {
  if (!isProductionLikeEnvironment()) {
    return RateLimiterFactory.getMemoryLimiter();
  }

  if (!process.env.REDIS_URL) {
    console.error(
      "REDIS_URL is not set and this deployment looks production-like " +
        `(${describeEnvironment()}). Rate limiting has no shared store: every ` +
        'endpoint with onStoreFailure: "deny" — including the service-role ' +
        "paths ADR 002 rule 4 requires a limiter on — will answer 503 until it " +
        "is set. Set REDIS_URL and REDEPLOY: Vercel bakes environment variables " +
        "into a deployment, so editing the value alone changes nothing.",
    );
  }

  return RateLimiterFactory.getRedisLimiter();
}

// Export default instances
export const rateLimiter = selectRateLimiter();
export const abuseDetector = new AbuseDetector();
