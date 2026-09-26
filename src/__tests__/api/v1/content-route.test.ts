/**
 * @jest-environment node
 */

/**
 * s44 — `/api/v1/content` must answer a valid key.
 *
 * On 2026-09-25 a freshly created, active API key's FIRST call to
 * `GET /api/v1/content` returned 429 in production. The route's Postgres
 * limiter read `api_keys.rate_limit` and counted `rate_limits` by `key` and
 * `timestamp`; none of those columns exist, PostgREST answered 42703, and the
 * limiter took every error for "over the limit". The endpoint had never served a
 * request. Its old suite mocked Supabase with a stub that accepted any column,
 * so it passed against a schema that was never there.
 *
 * This suite drives the shipped route against `createSchemaStrictDatabase`,
 * whose columns come from the migrations and which answers an unknown column
 * with PostgREST's error. The limiter is the shipped `enforceRateLimit` over its
 * real in-memory store (what Jest gets; production gets Redis). Only
 * `checkLimit` is ever spied on, to simulate a store outage or an exhausted
 * bucket; `Date.now` is pinned so a minute boundary cannot reset a count
 * mid-test.
 */

import { createHash } from "crypto";
import { NextRequest } from "next/server";
import {
  createSchemaStrictDatabase,
  type SchemaStrictDatabase,
} from "@/__tests__/helpers/schema-strict-supabase";
import {
  MemoryRateLimiter,
  rateLimiter,
  type RateLimitConfig,
} from "@/lib/security/rate-limiter";
import { DELETE, GET, POST, PUT } from "@/app/api/v1/content/route";

let mockDatabase: SchemaStrictDatabase;

jest.mock("@supabase/ssr", () => ({
  __esModule: true,
  createServerClient: () => mockDatabase.client,
}));

jest.mock("@/lib/analytics/tracker", () => ({
  __esModule: true,
  analytics: { trackAPIUsage: jest.fn().mockResolvedValue(undefined) },
}));

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const FRESH_KEY = "rcp_fresh_key_plaintext";
const OTHER_KEY = "rcp_other_key_plaintext";
const CLIENT_IP = "203.0.113.7";

/** Mid-minute, so a window boundary is nowhere near. */
const FIXED_NOW = Date.UTC(2026, 8, 25, 12, 0, 30);

const store = rateLimiter as MemoryRateLimiter;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A key as `POST /api/api-keys` creates it: every other column at its DB default. */
function keyRow(
  id: string,
  plaintext: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    user_id: ADMIN_ID,
    site_id: SITE_ID,
    name: `key ${id}`,
    key_hash: sha256(plaintext),
    key_prefix: plaintext.slice(0, 12),
    scopes: ["read", "write"],
    rate_limit_per_minute: 100,
    is_active: true,
    last_used_at: null,
    expires_at: null,
    ...overrides,
  };
}

function seedDatabase(
  keyOverrides: Record<string, unknown> = {},
  otherKeyOverrides: Record<string, unknown> = {},
) {
  mockDatabase = createSchemaStrictDatabase();
  mockDatabase.seed("api_keys", [
    keyRow("key-fresh", FRESH_KEY, keyOverrides),
    keyRow("key-other", OTHER_KEY, otherKeyOverrides),
  ]);
  mockDatabase.seed("site_permissions", [
    { id: "perm-1", user_id: ADMIN_ID, site_id: SITE_ID, permission: "admin" },
  ]);
  mockDatabase.seed("content_elements", [
    {
      id: "element-1",
      site_id: SITE_ID,
      element_id: "hero",
      selector: "h1",
      original_content: "Original headline",
      current_content: "Published headline",
      published_content: "Published headline",
      language: "en",
      variant: "default",
      metadata: {},
    },
  ]);
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

function v1Request(
  method: Method,
  options: {
    key?: string;
    body?: Record<string, unknown>;
    query?: string;
  } = {},
) {
  const { key = FRESH_KEY, body, query = `?site_id=${SITE_ID}` } = options;
  return new NextRequest(`https://www.recopyfa.st/api/v1/content${query}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "x-forwarded-for": CLIENT_IP,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Make the store throw for the matching checks and behave normally otherwise. */
function storeFailsFor(predicate: (config: RateLimitConfig) => boolean) {
  const realCheck = store.checkLimit.bind(store);
  jest
    .spyOn(store, "checkLimit")
    .mockImplementation((config) =>
      predicate(config)
        ? Promise.reject(new Error("Redis unreachable"))
        : realCheck(config),
    );
}

beforeEach(async () => {
  await store.clearAll();
  jest.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  seedDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("/api/v1/content answers a valid key (s44)", () => {
  it("runs on the in-memory store under Jest", () => {
    expect(rateLimiter).toBeInstanceOf(MemoryRateLimiter);
  });

  it("answers a freshly created key's first GET with its site's content", async () => {
    const response = await GET(v1Request("GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta).toMatchObject({ count: 1, site_id: SITE_ID });
    expect(body.data[0]).toMatchObject({
      element_id: "hero",
      current_content: "Published headline",
    });
  });

  it("asks the database only for columns that exist", async () => {
    await GET(v1Request("GET"));
    await POST(
      v1Request("POST", {
        body: { site_id: SITE_ID, element_id: "cta", content: "Buy now" },
      }),
    );

    expect(mockDatabase.queries.filter((query) => query.error)).toEqual([]);
    // The key lookup names its columns, so the check above sees every one of
    // them — a `*` would let a read of a missing column through as undefined.
    expect(mockDatabase.queriesOn("api_keys")[0].columns).not.toContain("*");
  });

  it("creates content with a write-scoped key", async () => {
    const response = await POST(
      v1Request("POST", {
        body: { site_id: SITE_ID, element_id: "cta", content: "Buy now" },
      }),
    );

    expect(response.status).toBe(201);
    expect(
      mockDatabase
        .rows("content_elements")
        .find((row) => row.element_id === "cta"),
    ).toMatchObject({ site_id: SITE_ID, published_content: "Buy now" });
  });

  it("updates existing content with PUT", async () => {
    const response = await PUT(
      v1Request("PUT", {
        body: { site_id: SITE_ID, element_id: "hero", content: "New headline" },
      }),
    );

    expect(response.status).toBe(200);
    expect(
      mockDatabase
        .rows("content_elements")
        .find((row) => row.element_id === "hero"),
    ).toMatchObject({ published_content: "New headline" });
  });

  it("holds each key to its own rate_limit_per_minute, and refuses only past it", async () => {
    seedDatabase({ rate_limit_per_minute: 2 });

    const first = await GET(v1Request("GET"));
    const second = await GET(v1Request("GET"));
    const third = await GET(v1Request("GET"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(third.headers.get("Retry-After")).toBeTruthy();
    // The refused request never reached customer content.
    expect(mockDatabase.queriesOn("content_elements")).toHaveLength(2);
  });

  it("meters each key in its own bucket", async () => {
    // Both keys at 1/min (s44 review m1): with the other key at 100, a bucket
    // shared per site still let it through, so keying the limiter on site_id
    // instead of the key id went unnoticed.
    seedDatabase({ rate_limit_per_minute: 1 }, { rate_limit_per_minute: 1 });

    await GET(v1Request("GET"));
    const exhausted = await GET(v1Request("GET"));
    const otherKey = await GET(v1Request("GET", { key: OTHER_KEY }));

    expect(exhausted.status).toBe(429);
    expect(otherKey.status).toBe(200);
  });

  it("counts reads and writes against the same per-key budget", async () => {
    seedDatabase({ rate_limit_per_minute: 2 });

    const read = await GET(v1Request("GET"));
    const write = await POST(
      v1Request("POST", {
        body: { site_id: SITE_ID, element_id: "cta", content: "Buy now" },
      }),
    );
    const refused = await GET(v1Request("GET"));

    expect(read.status).toBe(200);
    expect(write.status).toBe(201);
    expect(refused.status).toBe(429);
  });

  it("sheds a flood from one IP before spending anything on the key, on every verb", async () => {
    // `IP_GENERAL` is 200 a minute. A caller cycling through made-up keys never
    // reaches a per-key bucket, so only a limiter in front of `validateAPIKey`
    // — an api_keys lookup, a site_permissions read and an update per call —
    // can stop it.
    for (let call = 0; call < 200; call += 1) {
      await GET(v1Request("GET", { key: `rcp_made_up_${call}` }));
    }
    const lookupsBeforeRefusal = mockDatabase.queriesOn("api_keys").length;

    const refused = await Promise.all([
      GET(v1Request("GET")),
      POST(v1Request("POST", { body: { site_id: SITE_ID } })),
      PUT(v1Request("PUT", { body: { site_id: SITE_ID } })),
      DELETE(
        v1Request("DELETE", { query: `?site_id=${SITE_ID}&element_id=hero` }),
      ),
    ]);

    expect(refused.map((response) => response.status)).toEqual([
      429, 429, 429, 429,
    ]);
    expect(mockDatabase.queriesOn("api_keys")).toHaveLength(
      lookupsBeforeRefusal,
    );
    expect(mockDatabase.queriesOn("site_permissions")).toEqual([]);
  });

  it("refuses every verb with 503 before reading the key when the store is down", async () => {
    storeFailsFor(() => true);

    const responses = await Promise.all([
      GET(v1Request("GET")),
      POST(v1Request("POST", { body: { site_id: SITE_ID } })),
      PUT(v1Request("PUT", { body: { site_id: SITE_ID } })),
      DELETE(
        v1Request("DELETE", { query: `?site_id=${SITE_ID}&element_id=hero` }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      503, 503, 503, 503,
    ]);
    expect(mockDatabase.queries).toEqual([]);
  });

  it("meters DELETE per key as well", async () => {
    seedDatabase({ rate_limit_per_minute: 1 });
    const request = () =>
      v1Request("DELETE", { query: `?site_id=${SITE_ID}&element_id=hero` });

    const first = await DELETE(request());
    const second = await DELETE(request());

    // No key is granted content_delete today (see the research), so the first
    // call is a 403 — and still spends the key's budget.
    expect(first.status).toBe(403);
    expect(second.status).toBe(429);
  });

  it("refuses with 503 before touching content when the per-key meter is down", async () => {
    storeFailsFor((config) => config.identifierType === "api_key");

    const read = await GET(v1Request("GET"));
    const write = await POST(
      v1Request("POST", {
        body: { site_id: SITE_ID, element_id: "cta", content: "Buy now" },
      }),
    );

    expect(read.status).toBe(503);
    expect(write.status).toBe(503);
    expect(read.headers.get("Retry-After")).toBeTruthy();
    expect(mockDatabase.queriesOn("content_elements")).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
