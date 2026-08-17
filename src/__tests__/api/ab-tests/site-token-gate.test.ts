/**
 * Guards commit `3099c07`, "close unauthenticated A/B writes".
 *
 * `active`, `bucket` and `track` all run on the service-role client, which
 * bypasses RLS entirely, so `authorizeSiteRequest` is the only tenant boundary
 * these three routes have. It refuses a missing token *and* pins Origin/Referer
 * to the site's registered domain.
 *
 * Both halves matter, and the second one is the load-bearing one: the site
 * token ships as a plain `data-site-token` attribute in the customer's page
 * markup, so it is readable with View Source by anyone who visits their site.
 * The token proves which site is being addressed; the Origin pin is what makes
 * a published credential safe. Relaxing either half to make something pass
 * re-opens the hole that commit closed.
 *
 * Nothing here mocks `authorizeSiteRequest`. The tokens are real HMACs and the
 * refusals are the real ones — a test that stubbed the gate would pass with the
 * gate deleted.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { createChain, mockServiceClient } from "./support/postgrest-chain";

jest.mock("@/lib/supabase/service");

import { GET as getActive } from "@/app/api/ab-tests/active/[siteId]/route";
import { GET as getBucket } from "@/app/api/ab-tests/bucket/[siteId]/route";
import { POST as postTrack } from "@/app/api/ab-tests/track/route";

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const API_KEY = "site-api-key";
const REGISTERED_ORIGIN = "https://customer.example";
const FOREIGN_ORIGIN = "https://attacker.example";
const TEST_ID = "33333333-3333-3333-3333-333333333333";
const VARIANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function wireDatabase() {
  mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
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
      result: { data: null, error: null, count: 1 },
    }),
  });
}

interface Attempt {
  token: string | null;
  origin: string | null;
}

function headersFor({ origin }: Attempt): Record<string, string> {
  return origin ? { origin } : {};
}

function queryFor({ token }: Attempt): string {
  return token ? `?token=${encodeURIComponent(token)}` : "";
}

const ROUTES = {
  active: (attempt: Attempt) =>
    getActive(
      new NextRequest(
        `https://www.recopyfa.st/api/ab-tests/active/${SITE_ID}${queryFor(attempt)}`,
        { headers: headersFor(attempt) },
      ),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    ),
  bucket: (attempt: Attempt) =>
    getBucket(
      new NextRequest(
        `https://www.recopyfa.st/api/ab-tests/bucket/${SITE_ID}${queryFor(attempt) || "?"}${queryFor(attempt) ? "&" : ""}visitor_id=v-1`,
        { headers: headersFor(attempt) },
      ),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    ),
  track: (attempt: Attempt) =>
    postTrack(
      new NextRequest(
        `https://www.recopyfa.st/api/ab-tests/track${queryFor(attempt)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headersFor(attempt),
          },
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

describe("the A/B site-token gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    wireDatabase();
  });

  describe.each(ROUTE_NAMES)("/api/ab-tests/%s", (name) => {
    const call = ROUTES[name];

    it("refuses a request with no token", async () => {
      const response = await call({
        token: null,
        origin: REGISTERED_ORIGIN,
      });

      expect(response.status).toBe(401);
    });

    it("refuses a valid token presented from a foreign origin", async () => {
      const response = await call({
        token: buildSiteToken(SITE_ID, API_KEY),
        origin: FOREIGN_ORIGIN,
      });

      expect(response.status).toBe(401);
    });

    it("refuses a valid token presented with no origin at all", async () => {
      // curl sends neither Origin nor Referer. Treating "no header" as
      // "nothing to check" enforced the pin only against the caller that could
      // never have beaten it. (A-2)
      const response = await call({
        token: buildSiteToken(SITE_ID, API_KEY),
        origin: null,
      });

      expect(response.status).toBe(401);
    });

    it("refuses a forged token from the registered origin", async () => {
      const response = await call({
        token: buildSiteToken(SITE_ID, "not-the-api-key"),
        origin: REGISTERED_ORIGIN,
      });

      expect(response.status).toBe(401);
    });

    it("accepts a valid token from the registered origin", async () => {
      const response = await call({
        token: buildSiteToken(SITE_ID, API_KEY),
        origin: REGISTERED_ORIGIN,
      });

      expect(response.status).toBe(200);
    });
  });
});
