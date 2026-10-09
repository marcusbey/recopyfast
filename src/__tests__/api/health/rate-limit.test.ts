/**
 * s84 — the health endpoints are rate limited per IP, and an uptime monitor
 * never notices.
 *
 * `/api/health` was unlimited by design (s07b): denying a monitor seemed worse
 * than what a limit bounds. But every admitted GET costs two Supabase calls, a
 * rate-limit-store round trip and — once per memo window — an outbound probe to
 * the realtime service, and the s07b review flagged the endpoint as the one
 * public path AGENTS.md's "rate limit before authorization" rule did not cover.
 *
 * The limit is set so the two goals never meet: 60 per minute per IP, shared by
 * `GET`/`HEAD /api/health` and `GET /api/health/ready`. Our uptime workflow
 * asks once per 10 minutes; Sentry uptime at its tightest once a minute. And it
 * FAILS OPEN — this endpoint exists to report a Redis outage, so a store
 * failure must produce that report, never a refusal.
 *
 * The real memory store runs here (NODE_ENV=test selects it), behind a switch
 * that makes it throw the way the Redis store does when Redis is unreachable.
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/monitoring/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreateClient = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

let isStoreDown = false;

jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    ...actual,
    rateLimiter: {
      checkLimit: (config: unknown) =>
        isStoreDown
          ? Promise.reject(new Error("Redis unreachable: connect ECONNREFUSED"))
          : actual.rateLimiter.checkLimit(config),
      resetLimit: jest.fn(),
    },
  };
});

const MONITOR_IP = "203.0.113.7";
const OTHER_IP = "198.51.100.23";
const LIMIT_PER_MINUTE = 60;

const env = process.env as Record<string, string | undefined>;
const savedWsUrl = env.NEXT_PUBLIC_WS_URL;
const originalFetch = global.fetch;

function request(path: string, ip: string): NextRequest {
  return new NextRequest(`https://www.recopyfa.st${path}`, {
    headers: { "x-forwarded-for": ip },
  });
}

async function routes() {
  const health = await import("@/app/api/health/route");
  const ready = await import("@/app/api/health/ready/route");
  return {
    get: (ip: string) => health.GET(request("/api/health", ip)),
    head: (ip: string) => health.HEAD(request("/api/health", ip)),
    ready: (ip: string) => ready.GET(request("/api/health/ready", ip)),
  };
}

let nowSpy: jest.SpyInstance<number, []>;
let clock: number;

beforeEach(() => {
  jest.resetModules();
  isStoreDown = false;
  mockCreateClient.mockReset();
  mockCreateClient.mockImplementation(async () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn(async () => ({ data: [{ id: "plan-1" }], error: null })),
    storage: {
      getBucket: jest.fn(async () => ({ data: {}, error: null })),
      listBuckets: jest.fn(async () => ({ data: [], error: null })),
    },
  }));
  env.NEXT_PUBLIC_WS_URL = "wss://recopyfast-ws.fly.dev";
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
  })) as unknown as typeof fetch;
  // A fixed clock, mid-window: a minute boundary crossed during a loop would
  // reset the counter and make "the 61st is refused" pass or fail by luck.
  clock = Date.UTC(2026, 9, 9, 12, 0, 30);
  nowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(() => {
  nowSpy.mockRestore();
  global.fetch = originalFetch;
  if (savedWsUrl === undefined) delete env.NEXT_PUBLIC_WS_URL;
  else env.NEXT_PUBLIC_WS_URL = savedWsUrl;
});

describe("the health endpoints' per-IP limit", () => {
  it("refuses the 61st request in a minute from one IP, before touching a dependency", async () => {
    const health = await routes();

    // One shared bucket: GET, HEAD and readiness all count against it.
    for (let i = 0; i < LIMIT_PER_MINUTE; i += 1) {
      const call = [health.get, health.head, health.ready][i % 3];
      const response = await call(MONITOR_IP);
      expect([i, response.status]).toEqual([i, 200]);
    }

    mockCreateClient.mockClear();
    (global.fetch as jest.Mock).mockClear();

    for (const call of [health.get, health.head, health.ready]) {
      const refused = await call(MONITOR_IP);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("Retry-After")).toMatch(/^\d+$/);
    }

    // Refused before the database, storage or realtime were asked anything.
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("leaves another IP's requests untouched", async () => {
    const health = await routes();
    for (let i = 0; i <= LIMIT_PER_MINUTE; i += 1) await health.get(MONITOR_IP);
    expect((await health.get(MONITOR_IP)).status).toBe(429);

    expect((await health.get(OTHER_IP)).status).toBe(200);
  });

  it("never limits a monitor checking every 5 minutes, all day", async () => {
    const health = await routes();
    const fiveMinutes = 5 * 60 * 1000;

    for (let i = 0; i < (24 * 60) / 5; i += 1) {
      const response = await health.get(MONITOR_IP);
      expect([i, response.status]).toEqual([i, 200]);
      clock += fiveMinutes;
    }
  });

  it("never limits a 30-second monitor hitting all three probes", async () => {
    // Six requests a minute — ten times what our workflow sends, and what a
    // paid SaaS monitor does when someone wires up every endpoint.
    const health = await routes();

    for (let i = 0; i < 120; i += 1) {
      for (const call of [health.get, health.head, health.ready]) {
        const response = await call(MONITOR_IP);
        expect([i, response.status]).toEqual([i, 200]);
      }
      clock += 30 * 1000;
    }
  });

  it("fails open: with the store down, the outage is reported, not refused", async () => {
    isStoreDown = true;
    const health = await routes();

    const response = await health.get(MONITOR_IP);
    const body = await response.json();

    // The limiter let it through; the cache check then told the truth.
    expect(mockCreateClient).toHaveBeenCalled();
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.cache.status).toBe("error");
    expect(response.status).toBe(503);
    expect(body).not.toHaveProperty("message");

    // Readiness does not depend on the store, so it stays ready.
    expect((await health.ready(MONITOR_IP)).status).toBe(200);
  });
});
