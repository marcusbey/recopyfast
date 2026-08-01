import crypto from "crypto";
import {
  buildSiteToken,
  verifySiteTokenSignature,
  normalizeDomain,
} from "@/lib/security/site-auth";

// Mock Supabase service client
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: "site-123", domain: "example.com", api_key: "test-api-key" },
      error: null,
    }),
  })),
}));

// Mock content sanitizer
jest.mock("@/lib/security/content-sanitizer", () => ({
  sanitizeHTML: jest.fn((content: string) => content),
}));

describe("Site Token Authentication", () => {
  const testSiteId = "site-123";
  const testApiKey = "test-api-key-secret";

  // UNIT-050: buildSiteToken produces 3-part token
  describe("UNIT-050: buildSiteToken format", () => {
    it("should produce a 3-part token separated by dots", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const parts = token.split(".");

      expect(parts).toHaveLength(3);
    });

    it("should include siteId as first part", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const parts = token.split(".");

      expect(parts[0]).toBe(testSiteId);
    });

    it("should include timestamp as second part", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const parts = token.split(".");

      expect(Number(parts[1])).toBeGreaterThan(0);
      expect(/^[0-9]+$/.test(parts[1])).toBe(true);
    });

    it("should include HMAC signature as third part", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const parts = token.split(".");

      // HMAC-SHA256 hex digest is 64 chars
      expect(parts[2]).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(parts[2])).toBe(true);
    });
  });

  // UNIT-051: Valid token passes verification
  describe("UNIT-051: Token verification", () => {
    it("should verify a valid token", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const result = verifySiteTokenSignature(testSiteId, testApiKey, token);

      expect(result).toBe(true);
    });
  });

  // UNIT-052: Wrong apiKey rejected
  describe("UNIT-052: Wrong API key rejection", () => {
    it("should reject token signed with different API key", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const result = verifySiteTokenSignature(
        testSiteId,
        "wrong-api-key",
        token,
      );

      expect(result).toBe(false);
    });
  });

  // UNIT-053: Wrong siteId rejected
  describe("UNIT-053: Wrong site ID rejection", () => {
    it("should reject token with mismatched siteId", () => {
      const token = buildSiteToken(testSiteId, testApiKey);
      const result = verifySiteTokenSignature(
        "different-site",
        testApiKey,
        token,
      );

      expect(result).toBe(false);
    });
  });

  // UNIT-054: Malformed tokens rejected
  describe("UNIT-054: Malformed token rejection", () => {
    it("should reject token with only 2 parts", () => {
      const result = verifySiteTokenSignature(
        testSiteId,
        testApiKey,
        "part1.part2",
      );
      expect(result).toBe(false);
    });

    it("should reject token with 4 parts", () => {
      const result = verifySiteTokenSignature(
        testSiteId,
        testApiKey,
        "part1.part2.part3.part4",
      );
      expect(result).toBe(false);
    });

    it("should reject empty token", () => {
      const result = verifySiteTokenSignature(testSiteId, testApiKey, "");
      expect(result).toBe(false);
    });

    it("should reject token with non-numeric timestamp", () => {
      const result = verifySiteTokenSignature(
        testSiteId,
        testApiKey,
        `${testSiteId}.abc.signature`,
      );
      expect(result).toBe(false);
    });
  });

  // UNIT-055: Timing-safe comparison used
  describe("UNIT-055: Timing-safe comparison", () => {
    it("should use crypto.timingSafeEqual for comparison", () => {
      const spy = jest.spyOn(crypto, "timingSafeEqual");
      const token = buildSiteToken(testSiteId, testApiKey);

      verifySiteTokenSignature(testSiteId, testApiKey, token);

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // UNIT-056: normalizeDomain handles all URL formats
  describe("UNIT-056: normalizeDomain", () => {
    it("should normalize plain domain", () => {
      expect(normalizeDomain("example.com")).toBe("example.com");
    });

    it("should normalize domain with https://", () => {
      expect(normalizeDomain("https://example.com")).toBe("example.com");
    });

    it("should normalize domain with http://", () => {
      expect(normalizeDomain("http://example.com")).toBe("example.com");
    });

    it("should normalize domain with trailing path", () => {
      expect(normalizeDomain("https://example.com/path")).toBe("example.com");
    });

    it("should normalize domain with port", () => {
      expect(normalizeDomain("https://example.com:8080")).toBe("example.com");
    });

    it("should normalize uppercase domain", () => {
      expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
    });

    it("should normalize domain with whitespace", () => {
      expect(normalizeDomain("  example.com  ")).toBe("example.com");
    });

    it("should normalize domain with www prefix", () => {
      expect(normalizeDomain("https://www.example.com")).toBe(
        "www.example.com",
      );
    });

    it("should throw for empty domain", () => {
      expect(() => normalizeDomain("")).toThrow("Invalid domain");
    });

    it("should throw for whitespace-only domain", () => {
      expect(() => normalizeDomain("   ")).toThrow("Invalid domain");
    });
  });
});
