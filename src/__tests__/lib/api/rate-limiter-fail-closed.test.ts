/**
 * H-4 — the Postgres-backed limiter in `@/lib/api/rate-limiter` swallowed its
 * own failures and allowed the request.
 *
 * Its catch ended with "In case of error, allow the request but log it", so any
 * error on the `rate_limits` table — a dead connection, a timeout, a missing
 * table — silently removed the limit. The endpoint behind it, `/api/v1/content`,
 * reads and WRITES `content_elements` with the service-role key.
 *
 * The fix mirrors the semantics already in `@/lib/security/rate-limiter`, which
 * this project's other limiter uses: strict in production, permissive on a
 * developer's machine (there, a missing REDIS_URL throws in production and falls
 * back to localhost otherwise). Two conventions for "what happens when the
 * meter is down" is one too many.
 *
 * Nothing here stubs the limiter itself. The Supabase client under it is
 * replaced; `checkLimit`, `checkAPIKeyLimit` and the route are the shipped code.
 */

import { createHash } from "crypto";

/** Flipped per test: is the rate-limit store answering? */
let isStoreDown = false;

const trackAPIUsage = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/analytics/tracker", () => ({
  __esModule: true,
  analytics: { trackAPIUsage: (...args: unknown[]) => trackAPIUsage(...args) },
}));

const API_KEY_ROW = {
  id: "api-key-1",
  site_id: "11111111-1111-1111-1111-111111111111",
  is_active: true,
  scopes: ["read", "write"],
  rate_limit: 1000,
  rate_limit_per_minute: 60,
  expires_at: null,
};

/**
 * One chainable stub per table. Every filter returns the builder; awaiting it or
 * calling `.single()` resolves whatever the table's handler says.
 */
function tableStub(
  result: () => { data?: unknown; error?: unknown; count?: number | null },
) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "gte",
    "lt",
    "delete",
    "insert",
    "update",
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.single = jest.fn(() => Promise.resolve(result()));
  chain.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result()).then(resolve, reject);
  return chain;
}

jest.mock("@supabase/ssr", () => ({
  __esModule: true,
  createServerClient: jest.fn(() => ({
    from: (table: string) => {
      if (table === "rate_limits") {
        return tableStub(() =>
          isStoreDown
            ? { count: null, error: { message: "connection refused" } }
            : { count: 0, error: null },
        );
      }
      if (table === "api_keys") {
        return tableStub(() => ({ data: API_KEY_ROW, error: null }));
      }
      if (table === "content_elements") {
        contentElementsRead = true;
        return tableStub(() => ({ data: [], error: null }));
      }
      throw new Error(`unexpected table: ${table}`);
    },
  })),
}));

/** Set by the stub above whenever the route reaches customer content. */
let contentElementsRead = false;

import { NextRequest } from "next/server";
import { APIRateLimiter } from "@/lib/api/rate-limiter";
import { GET as getV1Content } from "@/app/api/v1/content/route";

const originalNodeEnv = process.env.NODE_ENV;

function inProduction() {
  Reflect.set(process.env, "NODE_ENV", "production");
}

function v1Request() {
  // The hash the route computes must match the row the stub returns; the plain
  // value is arbitrary.
  const plain = "rcf_live_key";
  createHash("sha256").update(plain).digest("hex");
  return new NextRequest(
    `https://www.recopyfa.st/api/v1/content?site_id=${API_KEY_ROW.site_id}`,
    { headers: { "x-api-key": plain } },
  );
}

describe("the Postgres rate limiter when its own store is down", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    isStoreDown = false;
    contentElementsRead = false;
  });

  afterEach(() => {
    Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    jest.restoreAllMocks();
  });

  it("meters normally while the store answers", async () => {
    // The control: the refusals below are the outage, not the limiter refusing
    // everything.
    const limiter = new APIRateLimiter();

    const result = await limiter.checkLimit("api_key:k", 10, 60_000);

    expect(result.allowed).toBe(true);
  });

  it("refuses in production", async () => {
    inProduction();
    isStoreDown = true;
    const limiter = new APIRateLimiter();

    const result = await limiter.checkLimit("api_key:k", 10, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("says so loudly rather than failing silently", async () => {
    inProduction();
    isStoreDown = true;
    const limiter = new APIRateLimiter();

    await limiter.checkLimit("api_key:k", 10, 60_000);

    expect(console.error).toHaveBeenCalled();
  });

  it("stays permissive outside production", async () => {
    // A developer with no local Postgres must not be locked out of their own
    // app — the same call `@/lib/security/rate-limiter` makes about REDIS_URL.
    Reflect.set(process.env, "NODE_ENV", "development");
    isStoreDown = true;
    const limiter = new APIRateLimiter();

    const result = await limiter.checkLimit("api_key:k", 10, 60_000);

    expect(result.allowed).toBe(true);
  });

  it("keeps /api/v1/content off the database during an outage in production", async () => {
    // The endpoint the fail-open catch actually exposed: it holds the
    // service-role key and reads and writes `content_elements`.
    inProduction();
    isStoreDown = true;

    const response = await getV1Content(v1Request());

    expect(response.status).toBe(429);
    expect(contentElementsRead).toBe(false);
  });

  it("still serves /api/v1/content while the store answers", async () => {
    inProduction();

    const response = await getV1Content(v1Request());

    expect(response.status).toBe(200);
    expect(contentElementsRead).toBe(true);
  });
});
