/**
 * s77 (s69 L7) — the three widget-facing A/B routes meter the caller's address
 * BEFORE authorizing them.
 *
 * Their per-site limiters sit behind `authorizeSiteRequest` on purpose (an
 * anonymous caller must not spend a customer's bucket), which left the
 * authorizer itself — a `sites` lookup per request — unmetered for anyone
 * naming a site id. AGENTS.md: "Rate limit before authorization."
 *
 * The guard is per IP (`IP_GENERAL`, 200/min) and FAILS CLOSED: every request
 * that would be served passes the fail-closed per-site limiter anyway, so an
 * outage refuses legitimate visitors there regardless, and failing open would
 * only hand the flood the authorizer.
 *
 * Only the store is stubbed; `enforceRateLimit` and the site tokens are real.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import {
  rateLimiter,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig,
} from "@/lib/security/rate-limiter";
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

import { GET as getActive } from "@/app/api/ab-tests/active/[siteId]/route";
import { GET as getBucket } from "@/app/api/ab-tests/bucket/[siteId]/route";
import { POST as postTrack } from "@/app/api/ab-tests/track/route";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY = "site-api-key";
const ORIGIN = "https://customer.example";
const CLIENT_IP = "203.0.113.7";
const TEST_ID = "33333333-3333-4333-8333-333333333333";
const VARIANT_ID = "44444444-4444-4444-8444-444444444444";

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
  totalRequests: 201,
};

function wireDatabase() {
  return mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
    sites: createChain({
      result: {
        data: { id: SITE_ID, domain: "customer.example", api_key: API_KEY },
        error: null,
      },
    }),
    ab_tests: createChain({
      result: {
        data: [
          {
            id: TEST_ID,
            name: "headline",
            target_element_id: "rcf-1",
            ab_test_variants: [
              {
                id: VARIANT_ID,
                name: "control",
                variant_content: "hello",
                traffic_percentage: 100,
                is_control: true,
                geo_countries: null,
                geo_regions: null,
              },
            ],
          },
        ],
        error: null,
      },
    }),
    visitor_buckets: createChain({ result: { data: [], error: null } }),
    ab_test_results: createChain({ result: { data: null, count: 1 } }),
  }) as unknown as { from: jest.Mock };
}

function token() {
  return encodeURIComponent(buildSiteToken(SITE_ID, API_KEY));
}

const HEADERS = { origin: ORIGIN, "x-forwarded-for": CLIENT_IP };

const ROUTES = {
  active: () =>
    getActive(
      new NextRequest(
        `https://www.recopyfa.st/api/ab-tests/active/${SITE_ID}?token=${token()}`,
        { headers: HEADERS },
      ),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    ),
  bucket: () =>
    getBucket(
      new NextRequest(
        `https://www.recopyfa.st/api/ab-tests/bucket/${SITE_ID}?token=${token()}&visitor_id=v-1`,
        { headers: HEADERS },
      ),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    ),
  track: () =>
    postTrack(
      new NextRequest(
        `https://www.recopyfa.st/api/ab-tests/track?token=${token()}`,
        {
          method: "POST",
          headers: { ...HEADERS, "content-type": "application/json" },
          body: JSON.stringify([
            {
              site_id: SITE_ID,
              test_id: TEST_ID,
              variant_id: VARIANT_ID,
              visitor_id: "v-1",
              event_type: "view",
            },
          ]),
        },
      ),
    ),
};

const ROUTE_NAMES = Object.keys(ROUTES) as Array<keyof typeof ROUTES>;

const isIpBucket = (config: RateLimitConfig) => config.identifierType === "ip";

describe("the A/B routes meter the caller's address before authorizing", () => {
  let client: { from: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    client = wireDatabase();
    checkLimit.mockResolvedValue(ALLOWED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(ROUTE_NAMES)("/api/ab-tests/%s", (name) => {
    const call = ROUTES[name];

    it("consults a per-IP bucket first: IP_GENERAL, its own endpoint", async () => {
      const response = await call();

      expect(response.status).toBe(200);
      const first = checkLimit.mock.calls[0][0];
      expect(first).toMatchObject({
        identifier: CLIENT_IP,
        identifierType: "ip",
        endpoint: `ab-tests/${name}:ip`,
        maxRequests: RATE_LIMIT_CONFIGS.IP_GENERAL.maxRequests,
        windowMs: RATE_LIMIT_CONFIGS.IP_GENERAL.windowMs,
      });
      // The per-site limiter still runs behind authorization, on the site.
      const perSite = checkLimit.mock.calls.map(([config]) => config);
      expect(perSite).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            identifier: SITE_ID,
            endpoint: `ab-tests/${name}`,
          }),
        ]),
      );
    });

    it("refuses an address over its limit before the site is even looked up", async () => {
      checkLimit.mockImplementation(async (config) =>
        isIpBucket(config) ? REFUSED : ALLOWED,
      );

      const response = await call();

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).not.toBeNull();
      expect(client.from).not.toHaveBeenCalled();
    });

    it("fails closed when the store is down, before any lookup", async () => {
      checkLimit.mockImplementation(async (config) => {
        if (isIpBucket(config)) throw new Error("Redis unreachable");
        return ALLOWED;
      });

      const response = await call();

      expect(response.status).toBe(503);
      expect(client.from).not.toHaveBeenCalled();
    });
  });
});
