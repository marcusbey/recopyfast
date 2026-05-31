/**
 * Suite 5D: Rate Limiting Integration - SEC-030 to SEC-032
 * Verifies rate limiting enforcement at integration level.
 */

import {
  MemoryRateLimiter,
  RATE_LIMIT_CONFIGS,
  createRateLimitConfig,
} from "@/lib/security/rate-limiter";

// Mock Redis
jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  })),
}));

describe("Rate Limiting Integration", () => {
  let rateLimiter: MemoryRateLimiter;

  beforeEach(() => {
    rateLimiter = new MemoryRateLimiter();
  });

  // SEC-030: Auth endpoints: 5 req/15min limit
  describe("SEC-030: Auth endpoint rate limiting", () => {
    it("should allow 5 auth requests within 15 minutes", async () => {
      const config = createRateLimitConfig(
        "192.168.1.1",
        "ip",
        "API_AUTH",
        "/api/auth/login",
      );

      // First 5 should be allowed
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);
      }
    });

    it("should block 6th auth request", async () => {
      const config = createRateLimitConfig(
        "192.168.1.1",
        "ip",
        "API_AUTH",
        "/api/auth/login",
      );

      // Use up 5 allowed requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(config);
      }

      // 6th should be blocked
      const result = await rateLimiter.checkLimit(config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("auth rate limit should be more restrictive than general", () => {
      expect(RATE_LIMIT_CONFIGS.API_AUTH.maxRequests).toBeLessThan(
        RATE_LIMIT_CONFIGS.API_GENERAL.maxRequests,
      );
      expect(RATE_LIMIT_CONFIGS.API_AUTH.windowMs).toBeGreaterThan(
        RATE_LIMIT_CONFIGS.API_GENERAL.windowMs,
      );
    });
  });

  // SEC-031: IP registration: 5/hour limit
  describe("SEC-031: IP registration rate limiting", () => {
    it("should allow 5 registrations per hour per IP", async () => {
      const config = createRateLimitConfig(
        "192.168.1.1",
        "ip",
        "IP_REGISTRATION",
        "/api/sites/register",
      );

      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);
      }
    });

    it("should block 6th registration in same hour", async () => {
      const config = createRateLimitConfig(
        "192.168.1.1",
        "ip",
        "IP_REGISTRATION",
        "/api/sites/register",
      );

      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(config);
      }

      const result = await rateLimiter.checkLimit(config);
      expect(result.allowed).toBe(false);
    });

    it("registration limit config should be 5 per hour", () => {
      expect(RATE_LIMIT_CONFIGS.IP_REGISTRATION.maxRequests).toBe(5);
      expect(RATE_LIMIT_CONFIGS.IP_REGISTRATION.windowMs).toBe(60 * 60 * 1000);
    });
  });

  // SEC-032: API key rate limits enforced per key
  describe("SEC-032: API key rate limiting", () => {
    it("should enforce default API key limit (1000/min)", async () => {
      expect(RATE_LIMIT_CONFIGS.API_KEY_DEFAULT.maxRequests).toBe(1000);
      expect(RATE_LIMIT_CONFIGS.API_KEY_DEFAULT.windowMs).toBe(60 * 1000);
    });

    it("should enforce premium API key limit (5000/min)", async () => {
      expect(RATE_LIMIT_CONFIGS.API_KEY_PREMIUM.maxRequests).toBe(5000);
    });

    it("should enforce enterprise API key limit (20000/min)", async () => {
      expect(RATE_LIMIT_CONFIGS.API_KEY_ENTERPRISE.maxRequests).toBe(20000);
    });

    it("should track API key requests independently", async () => {
      const config1 = createRateLimitConfig(
        "api_key_1",
        "api_key",
        "API_KEY_DEFAULT",
        "/api/v1/content",
      );
      const config2 = createRateLimitConfig(
        "api_key_2",
        "api_key",
        "API_KEY_DEFAULT",
        "/api/v1/content",
      );

      // Use up key 1 (with small limit for test)
      const smallConfig = { ...config1, maxRequests: 2 };
      await rateLimiter.checkLimit(smallConfig);
      await rateLimiter.checkLimit(smallConfig);
      const result1 = await rateLimiter.checkLimit(smallConfig);
      expect(result1.allowed).toBe(false);

      // Key 2 should still work
      const smallConfig2 = { ...config2, maxRequests: 2 };
      const result2 = await rateLimiter.checkLimit(smallConfig2);
      expect(result2.allowed).toBe(true);
    });
  });
});
