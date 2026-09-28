/**
 * @jest-environment node
 */

/**
 * s47a — GET /api/offers/founding, the public "X of 20 spots left" count.
 *
 * Public and uncached by contract: the landing page (s47b) must be right the
 * moment a spot is claimed or released, without a redeploy, so every request
 * reads the database. That makes the per-IP limiter the only brake, and it
 * runs before the read. On any doubt the route answers 503 with no number —
 * the landing then shows the 14-day trial line, never a guessed count.
 *
 * The limiter is the shipped `enforceRateLimit` over its in-memory store (what
 * Jest gets); only `checkLimit` is spied on, to exhaust the bucket or break the
 * store. The RPC is a double.
 */

import { NextRequest } from "next/server";
import { MemoryRateLimiter, rateLimiter } from "@/lib/security/rate-limiter";

const rpcMock = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: rpcMock })),
}));

import { GET, dynamic } from "@/app/api/offers/founding/route";

const store = rateLimiter as MemoryRateLimiter;

function request(): NextRequest {
  return new NextRequest("http://localhost/api/offers/founding", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
}

function availabilityRow(row: Record<string, unknown>) {
  rpcMock.mockResolvedValue({ data: [row], error: null });
}

beforeEach(async () => {
  await store.clearAll();
  rpcMock.mockReset();
  availabilityRow({
    spot_limit: 20,
    claimed: 3,
    remaining: 17,
    sold_out: false,
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /api/offers/founding", () => {
  it("answers 200 with exactly {limit, remaining, soldOut}", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ limit: 20, remaining: 17, soldOut: false });
    expect(Object.keys(body).sort()).toEqual(["limit", "remaining", "soldOut"]);
  });

  it("answers sold out at zero", async () => {
    availabilityRow({
      spot_limit: 20,
      claimed: 20,
      remaining: 0,
      sold_out: true,
    });

    const body = await (await GET(request())).json();

    expect(body).toEqual({ limit: 20, remaining: 0, soldOut: true });
  });

  it("is never cached: Cache-Control no-store, and force-dynamic", async () => {
    const response = await GET(request());

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(dynamic).toBe("force-dynamic");
  });

  it("reads the RPC on every request (no in-process cache)", async () => {
    await GET(request());
    availabilityRow({
      spot_limit: 20,
      claimed: 4,
      remaining: 16,
      sold_out: false,
    });

    const second = await (await GET(request())).json();

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(second.remaining).toBe(16);
  });

  it.each<[string, () => void]>([
    [
      "the RPC errors",
      () =>
        rpcMock.mockResolvedValue({
          data: null,
          error: { message: "permission denied for function" },
        }),
    ],
    ["the RPC throws", () => rpcMock.mockRejectedValue(new Error("reset"))],
    [
      "the RPC returns no row",
      () => rpcMock.mockResolvedValue({ data: [], error: null }),
    ],
    [
      "remaining is out of range",
      () => availabilityRow({ spot_limit: 20, remaining: 21, sold_out: false }),
    ],
    [
      "remaining is not an integer",
      () =>
        availabilityRow({ spot_limit: 20, remaining: 2.5, sold_out: false }),
    ],
    [
      "remaining is null",
      () =>
        availabilityRow({ spot_limit: 20, remaining: null, sold_out: false }),
    ],
  ])("answers 503 with no count when %s", async (_label, arrange) => {
    arrange();

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: expect.any(String) });
    expect(body).not.toHaveProperty("remaining");
    // The detail is logged, never returned to an anonymous caller.
    expect(JSON.stringify(body)).not.toMatch(/permission|reset|RPC/);
    expect(console.error).toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 429 when rate-limited, without reading the database", async () => {
    jest.spyOn(store, "checkLimit").mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      totalRequests: 201,
    });

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("still serves the count when the limiter's store is down (a public read fails open)", async () => {
    jest
      .spyOn(store, "checkLimit")
      .mockRejectedValue(new Error("Redis unreachable"));

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      limit: 20,
      remaining: 17,
      soldOut: false,
    });
  });
});
