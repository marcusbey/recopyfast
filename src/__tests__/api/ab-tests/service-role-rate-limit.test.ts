/**
 * H-3 — the three widget-facing A/B routes run on the service-role client and
 * carried no rate limiter at all.
 *
 * ADR 002 rule 4: a service-role route carries a FAIL-CLOSED limiter keyed on
 * the site. The credential that opens these three is published in the customer's
 * own page markup, so the limiter is what bounds the damage a copied token can
 * do — and losing Redis must not quietly remove it.
 *
 * Keyed per SITE, not per IP: the point is to cap what one site's published
 * token can do, and a copied token is used from many addresses. Behind
 * authorization, not in front of it, for the reason spelled out on each route —
 * metering an unauthenticated caller into a customer's own bucket would let
 * anyone lock that customer's widget out by naming their site id.
 *
 * Only the store is stubbed. `enforceRateLimit`, its failure policy and its
 * headers are the shipped implementations, and the site tokens are real HMACs.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { rateLimiter } from "@/lib/security/rate-limiter";
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

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const API_KEY = "site-api-key";
const ORIGIN = "https://customer.example";
const TEST_ID = "33333333-3333-3333-3333-333333333333";
const VARIANT_ID = "44444444-4444-4444-4444-444444444444";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

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
    ab_test_results: createChain({
      // A view already on file, so the dedupe path short-circuits and the
      // control below is a clean 200 without a completion check.
      result: { data: null, error: null, count: 1 },
    }),
  });
}

function token() {
  return encodeURIComponent(buildSiteToken(SITE_ID, API_KEY));
}

/**
 * The three routes, each called the way the widget calls it. `tables` names the
 * ones a refusal must leave untouched — `sites` is excluded because the
 * authorization that reads it runs first by design.
 */
const ROUTES = {
  active: {
    tables: ["ab_tests"],
    call: () =>
      getActive(
        new NextRequest(
          `https://www.recopyfa.st/api/ab-tests/active/${SITE_ID}?token=${token()}`,
          { headers: { origin: ORIGIN } },
        ),
        { params: Promise.resolve({ siteId: SITE_ID }) },
      ),
  },
  bucket: {
    tables: ["ab_tests", "visitor_buckets"],
    call: () =>
      getBucket(
        new NextRequest(
          `https://www.recopyfa.st/api/ab-tests/bucket/${SITE_ID}?token=${token()}&visitor_id=v-1`,
          { headers: { origin: ORIGIN } },
        ),
        { params: Promise.resolve({ siteId: SITE_ID }) },
      ),
  },
  track: {
    tables: ["ab_test_results"],
    call: () =>
      postTrack(
        new NextRequest(
          `https://www.recopyfa.st/api/ab-tests/track?token=${token()}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", origin: ORIGIN },
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
  },
};

const ROUTE_NAMES = Object.keys(ROUTES) as Array<keyof typeof ROUTES>;

describe("the A/B service-role routes are metered per site", () => {
  let client: { from: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    client = wireDatabase() as unknown as { from: jest.Mock };
    checkLimit.mockResolvedValue({
      allowed: true,
      remaining: 999,
      resetTime: Date.now() + 60_000,
      totalRequests: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(ROUTE_NAMES)("/api/ab-tests/%s", (name) => {
    const { call, tables } = ROUTES[name];

    it("serves a request within the limit", async () => {
      // The control: without it, the refusals below could be the route refusing
      // everything and the limiter would be proving nothing.
      const response = await call();

      expect(response.status).toBe(200);
      expect(checkLimit).toHaveBeenCalled();
    });

    it("buckets the limit by site, never by IP", async () => {
      await call();

      const config = checkLimit.mock.calls[0][0];
      expect(config.identifier).toBe(SITE_ID);
      expect(config.identifierType).not.toBe("ip");
    });

    it("refuses over the limit without touching its tables", async () => {
      checkLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30_000,
        totalRequests: 1001,
      });

      const response = await call();

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).not.toBeNull();

      const touched = client.from.mock.calls.map((c) => c[0]);
      for (const table of tables) {
        expect(touched).not.toContain(table);
      }
    });

    it("refuses when the limiter store is unreachable", async () => {
      checkLimit.mockRejectedValue(new Error("Redis unreachable"));

      const response = await call();

      // Fails CLOSED (ADR 002 rule 4). Losing Redis must not remove the only
      // ceiling on a service-role path opened by a published credential. The
      // widget degrades to the page's authored copy, which is what it does for
      // any failed fetch — it does not break the host page.
      expect(response.status).toBe(503);

      const touched = client.from.mock.calls.map((c) => c[0]);
      for (const table of tables) {
        expect(touched).not.toContain(table);
      }
    });
  });
});
