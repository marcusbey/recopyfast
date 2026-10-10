/**
 * s77 (s69 R5, s68b review minor 3) — every verb of `/api/domains/verify`
 * follows ADR 037's order: IP guard → `getUser()` → fail-closed per-user
 * limiter → permission read → service role.
 *
 * POST, GET and DELETE had no limiter at all; each runs a session lookup, an
 * RLS permission read and service-role work on `domain_verifications`. PUT had
 * its per-user limiter (s68b M10) but nothing in front of `getUser`, so an
 * anonymous flood reached the auth server unmetered.
 *
 * Numbers: the IP guard is `IP_GENERAL` (200/min per address) on every verb;
 * POST and DELETE share one `API_UPLOAD` bucket (10 changes a minute per user);
 * GET reads on `USER_GENERAL` (100/min per user) — the domain panel fetches on
 * mount and after each action. PUT keeps `USER_DOMAIN_VERIFY` (3 per 5 min).
 * Everything fails closed: these are service-role paths (ADR 002 §4, ADR 037).
 *
 * Only the store, the session and the database are stubbed; `enforceRateLimit`
 * is the shipped implementation.
 */

import { promises as dns } from "dns";
import { NextRequest } from "next/server";
import {
  rateLimiter,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig,
} from "@/lib/security/rate-limiter";

jest.mock("dns", () => ({
  promises: {
    lookup: jest.fn(),
    resolveTxt: jest.fn(),
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

const mockGetUser = jest.fn();
const permissionRead = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: permissionRead }),
          }),
        }),
      }),
    }),
  ),
}));

const serviceFrom = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: (table: string) => {
      serviceFrom(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.returns = () => Promise.resolve({ data: [], error: null });
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.insert = () => chain;
      chain.update = () => chain;
      chain.delete = () => chain;
      chain.single = () => Promise.resolve({ data: null, error: null });
      return chain;
    },
  })),
}));

import { DELETE, GET, POST, PUT } from "@/app/api/domains/verify/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_IP = "192.0.2.44";
const BASE = "http://localhost/api/domains/verify";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

const ALLOWED = {
  allowed: true,
  remaining: 1,
  resetTime: Date.now() + 60_000,
  totalRequests: 1,
};
const REFUSED = {
  allowed: false,
  remaining: 0,
  resetTime: Date.now() + 30_000,
  totalRequests: 999,
};

function req(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      "x-forwarded-for": CLIENT_IP,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const VERBS = {
  POST: {
    userEndpoint: "domains/verify:write",
    userPreset: "API_UPLOAD" as const,
    call: () =>
      POST(
        req(BASE, "POST", {
          siteId: SITE_ID,
          domain: "customer.example",
          method: "dns",
        }),
      ),
  },
  PUT: {
    userEndpoint: "domains/verify",
    userPreset: "USER_DOMAIN_VERIFY" as const,
    call: () => PUT(req(BASE, "PUT", { verificationId: "verification-1" })),
  },
  GET: {
    userEndpoint: "domains/verify:read",
    userPreset: "USER_GENERAL" as const,
    call: () => GET(req(`${BASE}?siteId=${SITE_ID}`, "GET")),
  },
  DELETE: {
    userEndpoint: "domains/verify:write",
    userPreset: "API_UPLOAD" as const,
    call: () => DELETE(req(`${BASE}?verificationId=verification-1`, "DELETE")),
  },
};

const VERB_NAMES = Object.keys(VERBS) as Array<keyof typeof VERBS>;

function refuse(
  match: (config: RateLimitConfig) => boolean,
  how: "429" | "down",
) {
  checkLimit.mockImplementation(async (config) => {
    if (!match(config)) return ALLOWED;
    if (how === "down") throw new Error("Redis unreachable");
    return REFUSED;
  });
}

function nothingPastTheGate() {
  expect(permissionRead).not.toHaveBeenCalled();
  expect(serviceFrom).not.toHaveBeenCalled();
  expect(dns.lookup).not.toHaveBeenCalled();
}

describe("/api/domains/verify — ADR 037 order on every verb", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    permissionRead.mockResolvedValue({ data: { permission: "admin" } });
    checkLimit.mockResolvedValue(ALLOWED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(VERB_NAMES)("%s", (verb) => {
    const { call, userEndpoint, userPreset } = VERBS[verb];

    it("meters the address first, then the user: the presets and their order", async () => {
      await call();

      const configs = checkLimit.mock.calls.map(([config]) => config);
      expect(configs[0]).toMatchObject({
        endpoint: "domains/verify:ip",
        identifier: CLIENT_IP,
        identifierType: "ip",
        maxRequests: RATE_LIMIT_CONFIGS.IP_GENERAL.maxRequests,
        windowMs: RATE_LIMIT_CONFIGS.IP_GENERAL.windowMs,
      });
      expect(configs[1]).toMatchObject({
        endpoint: userEndpoint,
        identifier: USER_ID,
        identifierType: "user",
        maxRequests: RATE_LIMIT_CONFIGS[userPreset].maxRequests,
        windowMs: RATE_LIMIT_CONFIGS[userPreset].windowMs,
      });
    });

    it("refuses an address over its limit before the session is read", async () => {
      refuse((config) => config.identifierType === "ip", "429");

      const response = await call();

      expect(response.status).toBe(429);
      expect(mockGetUser).not.toHaveBeenCalled();
      nothingPastTheGate();
    });

    it("fails closed on a store outage at the address guard", async () => {
      refuse((config) => config.identifierType === "ip", "down");

      const response = await call();

      expect(response.status).toBe(503);
      expect(mockGetUser).not.toHaveBeenCalled();
      nothingPastTheGate();
    });

    it("refuses a user over their limit before any permission read or service-role call", async () => {
      refuse((config) => config.endpoint === userEndpoint, "429");

      const response = await call();

      expect(response.status).toBe(429);
      nothingPastTheGate();
    });

    it("fails closed on a store outage at the user's bucket", async () => {
      refuse((config) => config.endpoint === userEndpoint, "down");

      const response = await call();

      expect(response.status).toBe(503);
      nothingPastTheGate();
    });

    it("never opens a user's bucket for an anonymous caller", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await call();

      expect(response.status).toBe(401);
      const endpoints = checkLimit.mock.calls.map(
        ([config]) => config.endpoint,
      );
      expect(endpoints).toEqual(["domains/verify:ip"]);
    });
  });
});
