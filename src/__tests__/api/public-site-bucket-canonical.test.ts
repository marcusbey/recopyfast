/**
 * s68b M4 — the per-site limiters of the public-token routes key on the
 * AUTHORIZED site id, not on the route's spelling of it.
 *
 * `authorizeSiteRequest` finds the site with `.eq("id", siteId)` — a `uuid`
 * cast that accepts any case — and verifies the token against the DATABASE's
 * `site.id`. So the upper-case spelling of a real site id, carrying that site's
 * genuine token, authorizes; and the four routes then metered it under the raw
 * spelling, which is a fresh bucket. Every spelling Postgres accepts multiplied
 * the per-site ceiling that bounds what one copied token can do.
 *
 * The routes still accept every spelling — installed snippets are permanent and
 * the widget degrades, never breaks (non-negotiables 2 and 4). What changed is
 * only which bucket a request spends: `site.id`, the canonical one.
 *
 * Nothing mocks the authorizer: the token is a real HMAC over the lower-case id
 * the database returns, which is exactly what a real snippet carries.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

import { POST as postContent } from "@/app/api/content/[siteId]/route";
import { GET as getBucket } from "@/app/api/ab-tests/bucket/[siteId]/route";
import { GET as getActive } from "@/app/api/ab-tests/active/[siteId]/route";
import { POST as postTrack } from "@/app/api/ab-tests/track/route";

const SITE_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";
const UPPER_SITE_ID = SITE_ID.toUpperCase();
const API_KEY = "site-api-key";
const ORIGIN = "https://example.com";
const TEST_ID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VARIANT_ID = "7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";

/** Per-site buckets: the call each route makes behind authorization. */
const PER_SITE_ENDPOINTS = new Set([
  "content/discovery",
  "ab-tests/bucket",
  "ab-tests/active",
  "ab-tests/track",
]);

/** Every table answers the `sites` lookup the authorizer makes. */
function serviceClient() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.single = () =>
    Promise.resolve({
      data: { id: SITE_ID, domain: "example.com", api_key: API_KEY },
      error: null,
    });
  chain.maybeSingle = chain.single;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return { from: () => chain };
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${buildSiteToken(SITE_ID, API_KEY)}`,
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
}

/** The identifier the route's per-site limiter was called with. */
function perSiteIdentifier(): unknown {
  const call = (enforceRateLimit as jest.Mock).mock.calls.find(([, options]) =>
    PER_SITE_ENDPOINTS.has(options.endpoint),
  );
  expect(call).toBeDefined();
  return call![1].identifier;
}

describe("public-token per-site limiters key on the authorized site id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createServiceRoleClient as jest.Mock).mockImplementation(serviceClient);
    // Per-IP limiters pass; each per-site limiter refuses, which ends the
    // request at the call under test — the bucket it spent is the assertion.
    (enforceRateLimit as jest.Mock).mockImplementation(
      async (_request, options: { endpoint: string }) =>
        PER_SITE_ENDPOINTS.has(options.endpoint)
          ? NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
          : null,
    );
  });

  it("content discovery POST spends the canonical bucket", async () => {
    const response = await postContent(
      new NextRequest(`https://recopyfast.com/api/content/${UPPER_SITE_ID}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          "rcf-headline": { selector: "h1", content: "Copy", type: "text" },
        }),
      }),
      { params: Promise.resolve({ siteId: UPPER_SITE_ID }) },
    );

    expect(response.status).toBe(429);
    expect(perSiteIdentifier()).toBe(SITE_ID);
  });

  it("ab-tests/bucket spends the canonical bucket", async () => {
    const response = await getBucket(
      new NextRequest(
        `https://recopyfast.com/api/ab-tests/bucket/${UPPER_SITE_ID}?visitor_id=rcf-1700000000000-abcdefghi`,
        { headers: headers() },
      ),
      { params: Promise.resolve({ siteId: UPPER_SITE_ID }) },
    );

    expect(response.status).toBe(429);
    expect(perSiteIdentifier()).toBe(SITE_ID);
  });

  it("ab-tests/active spends the canonical bucket", async () => {
    const response = await getActive(
      new NextRequest(
        `https://recopyfast.com/api/ab-tests/active/${UPPER_SITE_ID}`,
        { headers: headers() },
      ),
      { params: Promise.resolve({ siteId: UPPER_SITE_ID }) },
    );

    expect(response.status).toBe(429);
    expect(perSiteIdentifier()).toBe(SITE_ID);
  });

  it("ab-tests/track spends the canonical bucket", async () => {
    const response = await postTrack(
      new NextRequest("https://recopyfast.com/api/ab-tests/track", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify([
          {
            site_id: UPPER_SITE_ID,
            test_id: TEST_ID,
            variant_id: VARIANT_ID,
            visitor_id: "rcf-1700000000000-abcdefghi",
            event_type: "view",
          },
        ]),
      }),
    );

    expect(response.status).toBe(429);
    expect(perSiteIdentifier()).toBe(SITE_ID);
  });
});
