/**
 * RedisRateLimiter was previously uncovered — the suite mocked `redis` but only
 * ever exercised MemoryRateLimiter. These tests pin the two properties that
 * decide whether a metered store survives production: how many commands each
 * check costs, and what the reported reset time actually is.
 */

const pipeline = {
  incr: jest.fn(),
  expire: jest.fn(),
  pExpireAt: jest.fn(),
  ttl: jest.fn(),
  exec: jest.fn(),
};

const client = {
  isOpen: true,
  connect: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(),
  multi: jest.fn(() => pipeline),
  del: jest.fn(() => Promise.resolve()),
  keys: jest.fn(() => Promise.resolve([])),
  on: jest.fn(),
};

jest.mock("redis", () => ({ createClient: jest.fn(() => client) }));

import {
  EXPIRY_GRACE_MS,
  REDIS_COMMAND_TIMEOUT_MS,
  RedisRateLimiter,
} from "@/lib/security/rate-limiter";

const config = {
  windowMs: 60_000,
  maxRequests: 10,
  identifier: "user123",
  identifierType: "user" as const,
  endpoint: "/api/test",
};

describe("RedisRateLimiter", () => {
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    client.isOpen = true;
    pipeline.exec.mockResolvedValue([1, "OK"]);
    limiter = new RedisRateLimiter("redis://localhost:6379");
  });

  it("spends exactly two commands per check", async () => {
    // Arrange / Act
    await limiter.checkLimit(config);

    // Assert — the TTL round trip is the regression this guards against. On a
    // metered store a third command is a 50% quota increase for no new data.
    expect(pipeline.incr).toHaveBeenCalledTimes(1);
    // s96 review (minor 4): the expiry is PEXPIREAT at the window's end. It
    // replaced EXPIRE, still one command, so the count is unchanged.
    expect(pipeline.pExpireAt).toHaveBeenCalledTimes(1);
    expect(pipeline.expire).not.toHaveBeenCalled();
    expect(pipeline.ttl).not.toHaveBeenCalled();
  });

  it("reports the window boundary as the reset time, not a TTL measured from now", async () => {
    // Arrange
    const now = Date.now();
    const expectedWindowEnd =
      Math.floor(now / config.windowMs) * config.windowMs + config.windowMs;

    // Act
    const result = await limiter.checkLimit(config);

    // Assert — `now + ttl` would land up to a full window past the real
    // boundary on the first request of a window, inflating Retry-After.
    expect(result.resetTime).toBe(expectedWindowEnd);
    expect(result.resetTime).toBeLessThanOrEqual(now + config.windowMs);
  });

  it("scopes the key to the current fixed window", async () => {
    // Arrange
    const now = Date.now();
    const window = Math.floor(now / config.windowMs);

    // Act
    await limiter.checkLimit(config);

    // Assert
    expect(pipeline.incr).toHaveBeenCalledWith(
      `rate_limit:user:user123:/api/test:${window}`,
    );
    expect(pipeline.pExpireAt).toHaveBeenCalledWith(
      `rate_limit:user:user123:/api/test:${window}`,
      (window + 1) * config.windowMs + EXPIRY_GRACE_MS,
    );
  });

  /**
   * s96 review (minor 4). `EXPIRE key <window>` on every increment pushed the
   * expiry forward each time, so a key could outlive its window by almost a
   * whole window — a daily key holding a client address for ~48 h while
   * /privacy says 24. The expiry is now the window's absolute end: the same
   * timestamp on every check in the window, never extended.
   */
  it("expires the key at its window's end plus a fixed grace, the same instant on every check", async () => {
    const day = { ...config, windowMs: 24 * 60 * 60 * 1000 };
    const now = Date.now();
    const windowEnd = (Math.floor(now / day.windowMs) + 1) * day.windowMs;

    await limiter.checkLimit(day);
    await limiter.checkLimit(day);

    const expiries = pipeline.pExpireAt.mock.calls.map((call) => call[1]);
    expect(expiries).toEqual([
      windowEnd + EXPIRY_GRACE_MS,
      windowEnd + EXPIRY_GRACE_MS,
    ]);
    expect(windowEnd + EXPIRY_GRACE_MS - now).toBeLessThanOrEqual(
      day.windowMs + EXPIRY_GRACE_MS,
    );
  });

  /**
   * s96 review round 2, minor 1. PEXPIREAT with a timestamp already in the
   * past DELETES the key. A MULTI built in a window's last milliseconds that
   * reached Redis after `windowEnd` (latency, a slow pipeline, clock skew
   * between this instance and Redis) wiped the counter: every later INCR in
   * that window returned 1, and every limiter — the fail-closed editor-login
   * ones included — let everything through near a window's end. The expiry now
   * carries a grace longer than any command may take; the key names its
   * window, so the grace never lets two windows share a count.
   */
  it("still sets a future expiry when the MULTI reaches Redis after the window's end", async () => {
    const windowEnd =
      (Math.floor(Date.now() / config.windowMs) + 1) * config.windowMs;
    const clock = jest.spyOn(Date, "now").mockReturnValue(windowEnd - 1);
    let redisNow = 0;
    pipeline.exec.mockImplementation(async () => {
      // The MULTI lands as late as the command timeout allows.
      redisNow = windowEnd - 1 + REDIS_COMMAND_TIMEOUT_MS;
      return [1, 1];
    });

    try {
      await limiter.checkLimit(config);
    } finally {
      clock.mockRestore();
    }

    const [key, expiry] = pipeline.pExpireAt.mock.calls[0];
    expect(key).toBe(
      `rate_limit:user:user123:/api/test:${windowEnd / config.windowMs - 1}`,
    );
    expect(redisNow).toBeGreaterThan(windowEnd);
    expect(expiry).toBeGreaterThan(redisNow);
    expect(EXPIRY_GRACE_MS).toBeGreaterThan(REDIS_COMMAND_TIMEOUT_MS);
  });

  it("allows a request at the limit and denies the one past it", async () => {
    // Arrange
    pipeline.exec.mockResolvedValueOnce([10, "OK"]);

    // Act
    const atLimit = await limiter.checkLimit(config);

    // Assert
    expect(atLimit.allowed).toBe(true);
    expect(atLimit.remaining).toBe(0);
    expect(atLimit.totalRequests).toBe(10);

    // Arrange
    pipeline.exec.mockResolvedValueOnce([11, "OK"]);

    // Act
    const overLimit = await limiter.checkLimit(config);

    // Assert
    expect(overLimit.allowed).toBe(false);
    expect(overLimit.remaining).toBe(0);
  });

  it("throws rather than silently allowing when the pipeline reply is short", async () => {
    // Arrange
    pipeline.exec.mockResolvedValueOnce([1]);

    // Act / Assert
    await expect(limiter.checkLimit(config)).rejects.toThrow(
      "Redis pipeline execution failed",
    );
  });

  it("throws rather than silently allowing when INCR returns a non-numeric reply", async () => {
    // Arrange — a key collision, or another writer in our namespace.
    pipeline.exec.mockResolvedValueOnce(["not-a-number", "OK"]);

    // Act / Assert
    await expect(limiter.checkLimit(config)).rejects.toThrow(
      "non-numeric reply",
    );
  });

  it("discards the client after a failed command so the next call reconnects", async () => {
    // Arrange
    pipeline.exec.mockRejectedValueOnce(new Error("ECONNRESET"));

    // Act
    await expect(limiter.checkLimit(config)).rejects.toThrow("ECONNRESET");

    // Assert — reusing a broken socket would fail every subsequent invocation
    // in the same warm isolate.
    expect(client.destroy).toHaveBeenCalled();
  });

  it("propagates the failure instead of allowing the request through", async () => {
    // Arrange
    pipeline.exec.mockRejectedValueOnce(new Error("Redis unreachable"));

    // Act / Assert — the fail-open/fail-closed decision belongs to
    // enforceRateLimit, so the store itself must never swallow this.
    await expect(limiter.checkLimit(config)).rejects.toThrow(
      "Redis unreachable",
    );
  });
});
