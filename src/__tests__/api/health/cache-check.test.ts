/**
 * A-30 — /api/health is blind to Redis, the dependency that takes editor login
 * down.
 *
 * `HealthStatus` declares `cache?: ServiceCheck` (src/app/api/health/route.ts:20)
 * and nothing ever populates it. `:193-197` runs database, storage and — only
 * when `detailed=true` — external services. `HEAD` (`:299-305`) checks the
 * database alone.
 *
 * Meanwhile the rate-limit store is a hard dependency of signing in to edit:
 * `src/lib/security/rate-limiter.ts:172-176` throws outright without
 * `REDIS_URL` in production, and `src/lib/api/rate-limit.ts:99` defaults to
 * `onStoreFailure: "deny"`, so a store failure returns 503 from the endpoints
 * that use it. `.env.example:110-114` says so in capitals.
 *
 * The result is the failure mode a health endpoint exists to prevent: editor
 * login is refusing every request, and the uptime probe is green — so nothing
 * pages, and nothing is routed around.
 *
 * The mock below makes the store throw, which is exactly what `checkLimit()`
 * does when Redis is unreachable. `RATE_LIMIT_CONFIGS` and
 * `createRateLimitConfig` are left real so a `checkCache()` written against
 * them works unchanged.
 *
 * `test.failing` — there is no cache check to fail today; these flip green→red
 * the moment one is added.
 */

import { NextRequest } from "next/server";

const mockSingle = jest.fn();
const mockGetBucket = jest.fn();
const mockCheckLimit = jest.fn();

// Winston's transport queue calls `setImmediate`, which jsdom does not define,
// so any *successful* pass through this route throws inside `logger.info` and
// lands in the outer catch as a 503. Without this stub the handler can only
// ever answer 503 here, and no assertion about a healthy response means
// anything. (This is a test-environment artifact, not a route defect — Node's
// runtime has setImmediate.)
jest.mock("@/lib/monitoring/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: mockSingle,
    storage: { getBucket: mockGetBucket },
  })),
}));

jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    ...actual,
    rateLimiter: { checkLimit: mockCheckLimit, resetLimit: jest.fn() },
  };
});

import { GET, HEAD } from "@/app/api/health/route";

function healthRequest(query = ""): NextRequest {
  return new NextRequest(`https://www.recopyfa.st/api/health${query}`);
}

/** Redis reachable: the limiter answers normally. */
function cacheUp() {
  mockCheckLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    resetTime: Date.now() + 60_000,
    totalRequests: 1,
  });
}

/** Redis unreachable: checkLimit throws rather than silently allowing. */
function cacheDown() {
  mockCheckLimit.mockRejectedValue(
    new Error("Redis unreachable: connect ECONNREFUSED"),
  );
}

describe("A-30 /api/health does not check the rate-limit store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSingle.mockResolvedValue({ data: { id: "site-1" }, error: null });
    mockGetBucket.mockResolvedValue({
      data: { name: "assets", public: false },
      error: null,
    });
    cacheUp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports healthy when every dependency answers (control)", async () => {
    const response = await GET(healthRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.storage.status).toBe("ok");
  });

  test.failing("reports the cache as ok while Redis is reachable", async () => {
    const response = await GET(healthRequest());
    const body = await response.json();

    // `checks.cache` is declared in the response type and never populated, so
    // a monitor keyed on it sees nothing at all — neither ok nor error.
    expect(body.checks.cache).toBeDefined();
    expect(body.checks.cache.status).toBe("ok");
  });

  // Guard for the case below. With Redis down the handler still runs to
  // completion and answers a well-formed body — so the missing `checks.cache`
  // below is the defect, not a crash this file caused.
  it("still answers a well-formed body while Redis is down (guard)", async () => {
    cacheDown();

    const response = await GET(healthRequest());
    const body = await response.json();

    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.storage.status).toBe("ok");
    expect(body).toHaveProperty("timestamp");
  });

  test.failing(
    "reports unhealthy when the rate-limit store throws",
    async () => {
      cacheDown();

      const response = await GET(healthRequest());
      const body = await response.json();

      expect(body.checks.cache?.status).toBe("error");
      // Editor login is refusing every request at this point; the probe must
      // not answer 200.
      expect(response.status).toBe(503);
      expect(body.status).not.toBe("healthy");
    },
  );

  test.failing(
    "HEAD answers 503 when the rate-limit store is down",
    async () => {
      cacheDown();

      const response = await HEAD();

      // HEAD is what the uptime monitor calls. It checks the database alone,
      // so it stays 200 straight through a Redis outage.
      expect(response.status).toBe(503);
    },
  );

  it("HEAD still answers 503 when the database is down (control)", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });

    const response = await HEAD();

    expect(response.status).toBe(503);
  });
});
