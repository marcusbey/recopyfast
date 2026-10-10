/**
 * @jest-environment node
 */

/**
 * s44 — a bucket whose ceiling is data, not a preset.
 *
 * `/api/v1/content` meters each API key at the key's own
 * `rate_limit_per_minute` — the figure `/dashboard/settings` shows next to the
 * key. `enforceRateLimit` took only a preset name, so the ceiling could not come
 * from the row. `maxRequests` overrides the preset's ceiling and keeps its
 * window; a value that is not a positive integer is ignored rather than
 * trusted, because a 0 or a NaN from a database row would otherwise refuse every
 * request (or none) without a word.
 *
 * Runs the shipped helper over the real in-memory store Jest gets, with
 * `Date.now` pinned so a window boundary cannot reset the count mid-test.
 */

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { MemoryRateLimiter, rateLimiter } from "@/lib/security/rate-limiter";

const store = rateLimiter as MemoryRateLimiter;

/** `USER_DOMAIN_VERIFY` is 3 per 5 minutes: small enough to exhaust cheaply. */
const PRESET = "USER_DOMAIN_VERIFY";
const PRESET_CEILING = 3;

function request() {
  return new NextRequest("https://www.recopyfa.st/api/v1/content", {
    headers: { "x-forwarded-for": "198.51.100.1" },
  });
}

/** How many calls pass before the first refusal, and that refusal. */
async function exhaust(identifier: string, maxRequests?: number) {
  let allowed = 0;
  for (let call = 0; call < 20; call += 1) {
    const refused = await enforceRateLimit(request(), {
      limit: PRESET,
      endpoint: "override-test",
      identifier,
      identifierType: "api_key",
      onStoreFailure: "deny",
      maxRequests,
    });
    if (refused) return { allowed, refused };
    allowed += 1;
  }
  throw new Error("never refused");
}

beforeEach(async () => {
  await store.clearAll();
  jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 25, 12, 1, 30));
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("enforceRateLimit maxRequests", () => {
  it("replaces the preset's ceiling", async () => {
    const { allowed, refused } = await exhaust("key-a", 2);

    expect(allowed).toBe(2);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(refused.headers.get("Retry-After")).toBeTruthy();
  });

  it.each([
    ["absent", undefined],
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
  ])("keeps the preset's ceiling when the override is %s", async (_, value) => {
    const { allowed, refused } = await exhaust(`key-${String(value)}`, value);

    expect(allowed).toBe(PRESET_CEILING);
    expect(refused.headers.get("X-RateLimit-Limit")).toBe(
      String(PRESET_CEILING),
    );
  });
});
