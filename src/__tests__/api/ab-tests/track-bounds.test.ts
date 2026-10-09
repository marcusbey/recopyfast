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
 * and only for a visitor bucketed into that test or with a view of it (PR #65
 * review D1: the view and the conversion are separate beacons and may land in
 * either order).
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
/** `visitor_buckets` rows, as `<site_id>:<visitor_id>:<test_id>`. */
const bucketRows = new Set<string>();

/**
 * A `visitor_buckets` lookup finds a row only when every filter it carries
 * matches one: a lookup that names no site would match any site's row.
 */
function respondToBucketLookup(query: Query) {
  const found = Array.from(bucketRows).some((row) => {
    const [site, visitor, test] = row.split(":");
    const { site_id, visitor_id, test_id } = query.filters;
    return (
      (site_id === undefined || site_id === site) &&
      (visitor_id === undefined || visitor_id === visitor) &&
      (test_id === undefined || test_id === test)
    );
  });
  return { count: found ? 1 : 0, data: null, error: null };
}

/** Inserted rows are recorded, so a later request in the same test sees them. */
function recordInsert(rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const pair = `${row.visitor_id}:${row.test_id}`;
    if (row.event_type === "view") recordedViews.add(pair);
    if (row.event_type === "conversion") recordedConversions.add(pair);
  }
}

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
  if (query.table === "visitor_buckets") return respondToBucketLookup(query);
  if (query.inserted) {
    recordInsert(query.inserted);
    return { data: null, error: null };
  }
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
  bucketRows.clear();
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
    ["array metadata", withField("metadata", ["signup"])],
    ["string metadata", withField("metadata", "signup")],
    ["metadata deeper than 2", withField("metadata", { a: { b: { c: 1 } } })],
    // Through a key the public API never sends: an over-long `event_name` is
    // cut to fit instead (re-review N1, below).
    ["metadata over 1 KB", withField("metadata", { note: "x".repeat(1100) })],
    [
      "a __proto__ key in metadata",
      JSON.stringify(withField("metadata", { marker: true })).replace(
        '"marker":true',
        '"__proto__":{"polluted":true}',
      ),
    ],
    [
      // Coercing the name rebuilds the object: the key must survive as a key.
      "a __proto__ key beside an event_name in metadata",
      JSON.stringify(
        withField("metadata", { event_name: "signup", marker: true }),
      ).replace('"marker":true', '"__proto__":{"polluted":true}'),
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
      // The site's bucket is not spent by a refused body. Since s77 the per-IP
      // guard runs first, before the body is read (s69 L7), so it is the one
      // limiter a refused body meets.
      expect(enforceRateLimit).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ endpoint: "ab-tests/track" }),
      );
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

/**
 * Review major 1 (plan amendment 2026-10-08). `window.recopyfast
 * .trackConversion(eventName, value)` is a public API: whatever the host page
 * passes lands as `value: value || 1` (recopyfast.src.js:3492, :6255), in one
 * beacon carrying one event per active test. Refusing an odd `value` with 400
 * threw away the whole beacon — `sendBeacon` ignores the answer, so every
 * conversion in it was lost without a trace. The column is never read for a
 * decision (lifecycle.ts:74), so an odd value is stored as the default instead.
 */
/** The beacon `trackConversion(eventName, value)` sends: one event per active test. */
function trackConversionBeacon(eventName: unknown, value: unknown) {
  return TESTS.map(({ test, variant }) => ({
    site_id: SITE_ID,
    test_id: test,
    variant_id: variant,
    visitor_id: UUID_VISITOR,
    event_type: "conversion",
    value: value || 1,
    metadata: { event_name: eventName },
    geo_country: null,
    geo_region: null,
  }));
}

describe("POST /api/ab-tests/track — a conversion value the public API can send is stored, never refused", () => {
  const cases: Array<[string, unknown, number]> = [
    [
      "a finite numeric string is coerced",
      trackConversionBeacon("purchase", "49.99"),
      49.99,
    ],
    [
      "a value over 1,000,000 becomes 1",
      trackConversionBeacon("purchase", 1_500_000),
      1,
    ],
    [
      "a numeric string over 1,000,000 becomes 1",
      trackConversionBeacon("purchase", "2000000"),
      1,
    ],
    ["a negative value becomes 1", trackConversionBeacon("purchase", -5), 1],
    [
      "a non-numeric string becomes 1",
      trackConversionBeacon("purchase", "lots"),
      1,
    ],
    [
      "a non-number, non-string value becomes 1",
      trackConversionBeacon("purchase", { amount: 5 }),
      1,
    ],
    [
      "a non-finite value becomes 1",
      JSON.stringify(trackConversionBeacon("purchase", 7)).replaceAll(
        '"value":7',
        '"value":1e400',
      ),
      1,
    ],
  ];

  it.each(cases)(
    "%s, and the beacon answers 2xx",
    async (_name, body, storedValue) => {
      for (const { test } of TESTS) {
        recordedViews.add(`${UUID_VISITOR}:${test}`);
      }

      const response = await POST(trackRequest(body));

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      await expect(response.json()).resolves.toEqual({
        recorded: TESTS.length,
        deduplicated: 0,
      });
      const rows = insertedRows();
      expect(rows).toHaveLength(TESTS.length);
      for (const row of rows) {
        expect(row).toEqual(
          expect.objectContaining({
            event_type: "conversion",
            value: storedValue,
            metadata: { event_name: "purchase" },
          }),
        );
      }
    },
  );
});

/**
 * Re-review N1 (plan amendment 2026-10-08). `eventName` is the other argument
 * of the public `trackConversion(eventName, value)`: it lands, untouched, as
 * `metadata: { event_name: eventName }` (recopyfast.src.js:3493), in the same
 * one-event-per-active-test beacon. A non-string name nested too deep for the
 * metadata bound, and a name over its 1 KB, refused that whole beacon — and
 * `sendBeacon` ignores the 400. The name is coerced instead: text is kept, a
 * number or boolean is stringified, anything else becomes "conversion";
 * control characters are stripped; the result is cut to what fits the
 * metadata's existing 1 KB bound.
 */
describe("POST /api/ab-tests/track — an event name the public API can send is coerced, never refused", () => {
  /** Bytes of `{"event_name":""}`: the 1 KB metadata bound, minus this, is the name's room. */
  const NAME_ROOM_BYTES = 1024 - JSON.stringify({ event_name: "" }).length;

  const cases: Array<[string, unknown, string]> = [
    ["an object name becomes 'conversion'", { name: "p" }, "conversion"],
    ["an array name becomes 'conversion'", ["a"], "conversion"],
    ["a null name becomes 'conversion'", null, "conversion"],
    ["a number name is stringified", 42, "42"],
    [
      "a 2,000-byte name is cut to the metadata's 1 KB",
      "n".repeat(2000),
      "n".repeat(NAME_ROOM_BYTES),
    ],
    [
      "a 2,000-byte multi-byte name is cut on a whole character",
      "\u{1F600}".repeat(500),
      "\u{1F600}".repeat(Math.floor(NAME_ROOM_BYTES / 4)),
    ],
    [
      "a name with control characters has them stripped",
      "sign\u0000up\u0007\n\u009f",
      "signup",
    ],
    [
      // PR #65 review D3: stored as a `\ud800` escape, Postgres jsonb refuses
      // the row — and with it the whole beacon.
      "a name with a lone surrogate has it replaced by U+FFFD",
      "signup\uD800",
      "signup�",
    ],
  ];

  it.each(cases)(
    "%s, and the beacon answers 2xx",
    async (_name, eventName, storedName) => {
      for (const { test } of TESTS) {
        recordedViews.add(`${UUID_VISITOR}:${test}`);
      }

      const response = await POST(
        trackRequest(trackConversionBeacon(eventName, 1)),
      );

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      await expect(response.json()).resolves.toEqual({
        recorded: TESTS.length,
        deduplicated: 0,
      });
      const rows = insertedRows();
      expect(rows).toHaveLength(TESTS.length);
      for (const row of rows) {
        expect(row).toEqual(
          expect.objectContaining({
            event_type: "conversion",
            metadata: { event_name: storedName },
          }),
        );
        expect(
          Buffer.byteLength(JSON.stringify(row.metadata), "utf8"),
        ).toBeLessThanOrEqual(1024);
      }
    },
  );
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

  /**
   * Review minor 5: a first-time visitor's view and conversion can share one
   * request, and nothing is recorded for them yet. The view in the batch is the
   * proof of viewing — the conversion must not be dropped for want of a stored
   * row that this very insert is about to create.
   */
  it("records a conversion whose view arrives in the same batch", async () => {
    const response = await POST(
      trackRequest([viewEvent(0), conversionEvent()]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: 2,
      deduplicated: 0,
    });
    expect(insertedRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "view",
          visitor_id: UUID_VISITOR,
          test_id: TESTS[0].test,
        }),
        expect.objectContaining({
          event_type: "conversion",
          visitor_id: UUID_VISITOR,
          test_id: TESTS[0].test,
        }),
      ]),
    );
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

/**
 * PR #65 review D1. The embed sends a view and a conversion as two separate
 * `sendBeacon` calls (`trackImpressions`, recopyfast.src.js:3454-3475;
 * `trackConversion`, :3478-3501), and nothing orders their arrival: a
 * conversion can be handled before its view has committed. Requiring a
 * recorded view dropped that conversion for good — `sendBeacon` ignores the
 * answer. The proof of exposure is the `visitor_buckets` row the bucket route
 * persists before it answers (bucket/[siteId]/route.ts:209-229), which the
 * embed awaits before it can send either beacon (:958-963, :3278-3288; both
 * track methods skip a test with no assignment, :3459-3460, :3483-3484).
 */
describe("POST /api/ab-tests/track — a bucketed visitor's conversion counts whatever order the beacons land in", () => {
  const bucket = (visitorId: string, testId: string, siteId = SITE_ID) =>
    bucketRows.add(`${siteId}:${visitorId}:${testId}`);

  it("records a conversion delivered before its view, then records the view", async () => {
    bucket(UUID_VISITOR, TESTS[0].test);

    const conversion = await POST(trackRequest([conversionEvent()]));
    const view = await POST(trackRequest([viewEvent(0)]));

    await expect(conversion.json()).resolves.toEqual({
      recorded: 1,
      deduplicated: 0,
    });
    await expect(view.json()).resolves.toEqual({
      recorded: 1,
      deduplicated: 0,
    });
    expect(insertedRows()).toEqual([
      expect.objectContaining({
        event_type: "conversion",
        visitor_id: UUID_VISITOR,
        test_id: TESTS[0].test,
      }),
      expect.objectContaining({
        event_type: "view",
        visitor_id: UUID_VISITOR,
        test_id: TESTS[0].test,
      }),
    ]);
  });

  it("still counts one conversion per bucketed visitor per test across requests", async () => {
    bucket(UUID_VISITOR, TESTS[0].test);

    await POST(trackRequest([conversionEvent()]));
    const second = await POST(trackRequest([conversionEvent()]));

    await expect(second.json()).resolves.toEqual({
      recorded: 0,
      deduplicated: 1,
    });
    expect(insertedRows()).toHaveLength(1);
  });

  it("does not count a conversion from a visitor with no bucket row and no view of that test", async () => {
    // Bucketed for another test, and another visitor bucketed for this one:
    // neither is this visitor's exposure to this test.
    bucket(UUID_VISITOR, TESTS[1].test);
    bucket(RCF_VISITOR, TESTS[0].test);

    const response = await POST(trackRequest([conversionEvent()]));

    await expect(response.json()).resolves.toEqual({
      recorded: 0,
      deduplicated: 1,
    });
    expect(insertedRows()).toHaveLength(0);
  });

  it("reads buckets only for the authorized site, after its ownership of the test is proven", async () => {
    bucket(UUID_VISITOR, TESTS[0].test);

    await POST(trackRequest([conversionEvent()]));

    const tables = queries.map((query) => query.table);
    const bucketLookups = queries.filter(
      (query) => query.table === "visitor_buckets",
    );
    expect(bucketLookups).not.toHaveLength(0);
    for (const lookup of bucketLookups) {
      expect(lookup.filters).toEqual(
        expect.objectContaining({
          site_id: SITE_ID,
          test_id: TESTS[0].test,
          visitor_id: UUID_VISITOR,
        }),
      );
    }
    expect(tables.indexOf("ab_tests")).toBeLessThan(
      tables.indexOf("visitor_buckets"),
    );
  });
});
