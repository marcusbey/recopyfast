/**
 * s77 review m3 — `GET /api/ab-tests/active/:siteId` lets a browser or CDN keep
 * its list of tests for a minute, but never a refusal.
 *
 * The route's CORS helper used to stamp `public, max-age=60,
 * stale-while-revalidate=300` on every answer, so a 429 or a 503 from either
 * limiter could be served again from a cache for up to six minutes after the
 * limiter had let go — a refusal outliving its own `Retry-After`. Only a
 * successful answer is reusable; every other answer is `private, no-cache`:
 * no shared cache keeps it (a 429 here is one address's), and the browser may
 * not serve it again without going back to the server.
 *
 * NOT `no-store`, which is what the m3 fix first shipped (PR #82). The widget
 * reads this body only when the answer is OK (`fetchActiveTests`: `if
 * (!response.ok) return;`), and Chromium never finishes a fetch whose body
 * nobody reads unless its HTTP cache is writing that body down — `no-store`
 * forbids exactly that. Every page view that drew a refusal kept a request open
 * forever: CI's `realtime-additive` and `realtime-parity` specs waited for
 * network idle until their 90 s / 180 s timeouts, on every retry, and so would
 * any prerenderer or crawler that waits for network idle on a customer's page.
 * `private, no-cache` may be stored, so the body is drained and the request
 * completes; it is still never reused unrevalidated.
 *
 * Only the store is stubbed; `enforceRateLimit` and the site token are real.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { rateLimiter, type RateLimitConfig } from "@/lib/security/rate-limiter";
import { createChain, mockServiceClient } from "./support/postgrest-chain";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

import { GET } from "@/app/api/ab-tests/active/[siteId]/route";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY = "site-api-key";
const ORIGIN = "https://customer.example";
const CLIENT_IP = "203.0.113.7";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

const ALLOWED = {
  allowed: true,
  remaining: 1,
  resetTime: Date.now() + 60_000,
  totalRequests: 1,
};
const REFUSED = {
  allowed: false,
  remaining: 0,
  resetTime: Date.now() + 30_000,
  totalRequests: 1001,
};

const CACHED = "public, max-age=60, stale-while-revalidate=300";
const NEVER_REUSED = "private, no-cache";

const isIpBucket = (config: RateLimitConfig) => config.identifierType === "ip";
const isSiteBucket = (config: RateLimitConfig) => !isIpBucket(config);

function wireDatabase() {
  mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
    sites: createChain({
      result: {
        data: { id: SITE_ID, domain: "customer.example", api_key: API_KEY },
        error: null,
      },
    }),
    ab_tests: createChain({ result: { data: [], error: null } }),
  });
}

function call(apiKey = API_KEY) {
  const token = encodeURIComponent(buildSiteToken(SITE_ID, apiKey));
  return GET(
    new NextRequest(
      `https://www.recopyfa.st/api/ab-tests/active/${SITE_ID}?token=${token}`,
      { headers: { origin: ORIGIN, "x-forwarded-for": CLIENT_IP } },
    ),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

describe("GET /api/ab-tests/active — only a served list is cacheable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    wireDatabase();
    checkLimit.mockResolvedValue(ALLOWED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps the one-minute public cache on the list of tests", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHED);
  });

  it.each([
    ["the address is over its limit", isIpBucket],
    ["the site is over its limit", isSiteBucket],
  ])("a 429 when %s is never reused", async (_case, refuses) => {
    checkLimit.mockImplementation(async (config) =>
      refuses(config) ? REFUSED : ALLOWED,
    );

    const response = await call();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(response.headers.get("Cache-Control")).toBe(NEVER_REUSED);
    // The widget still reads the refusal cross-origin.
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it.each([
    ["the address bucket", isIpBucket],
    ["the site bucket", isSiteBucket],
  ])(
    "a 503 when the store is down at %s is never reused",
    async (_case, fails) => {
      checkLimit.mockImplementation(async (config) => {
        if (fails(config)) throw new Error("Redis unreachable");
        return ALLOWED;
      });

      const response = await call();

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe(NEVER_REUSED);
    },
  );

  it("a 401 for a wrong site token is never reused", async () => {
    const response = await call("not-the-site-key");

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe(NEVER_REUSED);
  });
});
