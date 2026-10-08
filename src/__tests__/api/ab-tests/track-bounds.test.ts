/**
 * s68b M5 — `POST /api/ab-tests/track` is bounded and validated, and still
 * accepts everything the embed sends today.
 *
 * The route took any array length, stored `value` and `metadata` unvalidated,
 * and counted every conversion row — keyed on a `visitor_id` the caller
 * chooses. Its token ships in the customer's page markup, and every 50th view
 * can run `checkTestCompletion` → `promoteWinner`, which stages content. So the
 * bounds are refused with 400 BEFORE any database call (the authorizer's
 * `sites` lookup included), and a conversion counts once per (visitor, test),
 * and only for a visitor with a recorded view of that test.
 *
 * The accepted fixtures are copied from what the embed builds
 * (public/embed/recopyfast.src.js:3437-3495, visitor ids from :3238-3241): the
 * embed is on customer domains and is not ours to update, so a validator that
 * refuses one of these is a bug, not hardening.
 */

import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

import { POST } from "@/app/api/ab-tests/track/route";

const SITE_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";
const API_KEY = "site-api-key";
const ORIGIN = "https://example.com";
const TESTS = [
  {
    test: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    variant: "7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
  },
  {
    test: "8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f",
    variant: "9d4e5f6a-7b8c-4d9e-bfa0-2b3c4d5e6f7a",
  },
  {
    test: "ae5f6a7b-8c9d-4eaf-80b1-3c4d5e6f7a8b",
    variant: "bf6a7b8c-9dae-4fb0-91c2-4d5e6f7a8b9c",
  },
];
const UUID_VISITOR = randomUUID();
const RCF_VISITOR = "rcf-1700000000000-k3j9x2m1q";

type Query = {
  table: string;
  columns?: string;
  head?: boolean;
  filters: Record<string, unknown>;
  inserted?: Array<Record<string, unknown>>;
};

const queries: Query[] = [];
const recordedViews = new Set<string>();
const recordedConversions = new Set<string>();

function respond(query: Query) {
  if (query.table === "sites") {
    return {
      data: { id: SITE_ID, domain: "example.com", api_key: API_KEY },
      error: null,
    };
  }
  if (query.table === "ab_tests") {
    return {
      data: TESTS.map(({ test, variant }) => ({
        id: test,
        ab_test_variants: [{ id: variant }],
      })),
      error: null,
    };
  }
  if (query.inserted) return { data: null, error: null };
  // ab_test_results counts. The running total (no visitor filter) answers 0,
  // which keeps the significance check out of this suite.
  const pair = `${query.filters.visitor_id}:${query.filters.test_id}`;
  if (query.filters.visitor_id === undefined) {
    return { count: 0, data: null, error: null };
  }
  const recorded =
    query.filters.event_type === "view" ? recordedViews : recordedConversions;
  return { count: recorded.has(pair) ? 1 : 0, data: null, error: null };
}

function serviceClient() {
  return {
    from(table: string) {
      const query: Query = { table, filters: {} };
      queries.push(query);
      const builder = {
        select(columns: string, options?: { head?: boolean }) {
          query.columns = columns;
          query.head = options?.head;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters[column] = value;
          return builder;
        },
        in() {
          return builder;
        },
        single: () => Promise.resolve(respond(query)),
        insert(rows: Array<Record<string, unknown>>) {
          query.inserted = rows;
          return Promise.resolve(respond(query));
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(respond(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function trackRequest(body: unknown): NextRequest {
  return new NextRequest("https://recopyfast.com/api/ab-tests/track", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${buildSiteToken(SITE_ID, API_KEY)}`,
      Origin: ORIGIN,
      "Content-Type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** An event exactly as `trackImpressions` builds it (geo unknown). */
function viewEvent(index = 0, visitorId = UUID_VISITOR) {
  return {
    site_id: SITE_ID,
    test_id: TESTS[index].test,
    variant_id: TESTS[index].variant,
    visitor_id: visitorId,
    event_type: "view",
    geo_country: null,
    geo_region: null,
  };
}

/** An event exactly as `trackConversion("signup")` builds it. */
function conversionEvent(visitorId = UUID_VISITOR) {
  return {
    site_id: SITE_ID,
    test_id: TESTS[0].test,
    variant_id: TESTS[0].variant,
    visitor_id: visitorId,
    event_type: "conversion",
    value: 1,
    metadata: { event_name: "signup" },
    geo_country: null,
    geo_region: null,
  };
}

function insertedRows(): Array<Record<string, unknown>> {
  return queries.flatMap((query) => query.inserted ?? []);
}

beforeEach(() => {
  jest.clearAllMocks();
  queries.length = 0;
  recordedViews.clear();
  recordedConversions.clear();
  (createServiceRoleClient as jest.Mock).mockImplementation(serviceClient);
  (enforceRateLimit as jest.Mock).mockResolvedValue(null);
});

describe("POST /api/ab-tests/track — accepts what the embed sends", () => {
  it("records a three-event view batch with a UUID visitor id and no geo", async () => {
    const response = await POST(
      trackRequest([viewEvent(0), viewEvent(1), viewEvent(2)]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: 3,
      deduplicated: 0,
    });
    expect(insertedRows()).toHaveLength(3);
  });

  it("records a click from an rcf- visitor id with geo", async () => {
    const response = await POST(
      trackRequest({
        site_id: SITE_ID,
        test_id: TESTS[1].test,
        variant_id: TESTS[1].variant,
        visitor_id: RCF_VISITOR,
        event_type: "click",
        geo_country: "US",
        geo_region: "CA",
      }),
    );

    expect(response.status).toBe(200);
    expect(insertedRows()).toEqual([
      expect.objectContaining({
        event_type: "click",
        visitor_id: RCF_VISITOR,
        geo_country: "US",
        geo_region: "CA",
      }),
    ]);
  });

  it("records a conversion with value 1 and its event name, after a recorded view", async () => {
    recordedViews.add(`${UUID_VISITOR}:${TESTS[0].test}`);

    const response = await POST(trackRequest([conversionEvent()]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: 1,
      deduplicated: 0,
    });
    expect(insertedRows()).toEqual([
      expect.objectContaining({
        event_type: "conversion",
        value: 1,
        metadata: { event_name: "signup" },
      }),
    ]);
  });
});

describe("POST /api/ab-tests/track — refuses out-of-bounds input before the database", () => {
  const withField = (field: string, value: unknown) => [
    { ...conversionEvent(), [field]: value },
  ];

  const refusals: Array<[string, unknown]> = [
    [
      "more than 50 events",
      Array.from({ length: 51 }, () => viewEvent(0, randomUUID())),
    ],
    [
      "a body over 64 KB",
      JSON.stringify([viewEvent()]) + " ".repeat(64 * 1024),
    ],
    ["a non-UUID test_id", withField("test_id", "test-1")],
    ["a non-UUID variant_id", withField("variant_id", "variant-1")],
    ["a non-UUID site_id", withField("site_id", "site-1")],
    ["an unknown event_type", withField("event_type", "purchase")],
    ["a non-number value", withField("value", "1")],
    [
      "a non-finite value",
      JSON.stringify(withField("value", 0)).replace(
        '"value":0',
        '"value":1e400',
      ),
    ],
    ["a negative value", withField("value", -1)],
    ["a value over 1,000,000", withField("value", 1_000_001)],
    ["array metadata", withField("metadata", ["signup"])],
    ["string metadata", withField("metadata", "signup")],
    ["metadata deeper than 2", withField("metadata", { a: { b: { c: 1 } } })],
    [
      "metadata over 1 KB",
      withField("metadata", { event_name: "x".repeat(1100) }),
    ],
    [
      "a __proto__ key in metadata",
      JSON.stringify(withField("metadata", { marker: true })).replace(
        '"marker":true',
        '"__proto__":{"polluted":true}',
      ),
    ],
    [
      "a constructor key in metadata",
      withField("metadata", { constructor: 1 }),
    ],
    ["a prototype key in metadata", withField("metadata", { prototype: 1 })],
    ["an empty visitor_id", withField("visitor_id", "")],
    [
      "a visitor_id over 64 characters",
      withField("visitor_id", "v".repeat(65)),
    ],
    [
      "a visitor_id with control characters",
      withField("visitor_id", "rcf-1\u0007bell"),
    ],
    ["an empty session_id", withField("session_id", "")],
    [
      "a session_id over 64 characters",
      withField("session_id", "s".repeat(65)),
    ],
    [
      "a session_id with control characters",
      withField("session_id", "sess\nion"),
    ],
    [
      "a geo_country over 64 characters",
      withField("geo_country", "c".repeat(65)),
    ],
    [
      "a geo_region over 64 characters",
      withField("geo_region", "r".repeat(65)),
    ],
  ];

  it.each(refusals)(
    "refuses %s with 400 and no database call",
    async (_name, body) => {
      const response = await POST(trackRequest(body));

      expect(response.status).toBe(400);
      expect(queries).toHaveLength(0);
      expect(enforceRateLimit).not.toHaveBeenCalled();
    },
  );

  it("never echoes a refused value back", async () => {
    const response = await POST(
      trackRequest(withField("visitor_id", "rcf-1\u0007<script>")),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("\\u0007");
    expect(JSON.stringify(body)).not.toContain("<script>");
  });
});

describe("POST /api/ab-tests/track — one conversion per visitor per test, after a view", () => {
  it("does not record a second conversion for the same visitor and test", async () => {
    recordedViews.add(`${UUID_VISITOR}:${TESTS[0].test}`);
    recordedConversions.add(`${UUID_VISITOR}:${TESTS[0].test}`);

    const response = await POST(trackRequest([conversionEvent()]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: 0,
      deduplicated: 1,
    });
    expect(insertedRows()).toHaveLength(0);
  });

  it("records only one of two conversions for the same visitor and test in one batch", async () => {
    recordedViews.add(`${UUID_VISITOR}:${TESTS[0].test}`);

    const response = await POST(
      trackRequest([conversionEvent(), conversionEvent()]),
    );

    await expect(response.json()).resolves.toEqual({
      recorded: 1,
      deduplicated: 1,
    });
    expect(insertedRows()).toHaveLength(1);
  });

  it("does not record a conversion from a visitor with no recorded view of the test", async () => {
    const response = await POST(trackRequest([conversionEvent()]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: 0,
      deduplicated: 1,
    });
    expect(insertedRows()).toHaveLength(0);
  });
});
