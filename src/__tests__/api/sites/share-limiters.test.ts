/**
 * s77 (s69 R6) — `/api/sites/[siteId]/share` follows ADR 037's order on every
 * verb: IP guard → `getUser()` → fail-closed per-user limiter → permission
 * check → service role.
 *
 * POST, GET and DELETE had no limiter at all. Each runs a session lookup and
 * `checkSitePermission`, then service-role reads and writes of
 * `site_permissions`; GET also resolves every collaborator's identity through
 * the Admin API, one call per row.
 *
 * Numbers: the IP guard is `IP_GENERAL` (200/min per address) on every verb;
 * POST and DELETE share one `API_UPLOAD` bucket (10 changes a minute per user);
 * GET reads on `USER_GENERAL` (100/min per user). All fail closed: these are
 * service-role paths (ADR 002 §4, ADR 037).
 *
 * Only the store, the session, the permission model and the database are
 * stubbed; `enforceRateLimit` is the shipped implementation.
 */

import { NextRequest } from "next/server";
import {
  rateLimiter,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig,
} from "@/lib/security/rate-limiter";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CollaborationPermissions } from "@/lib/collaboration/permissions";
import { canShareSite } from "@/lib/feature-gating/permissions";

jest.mock("@/lib/supabase/server", () => ({ createServerClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/feature-gating/permissions", () => ({
  canShareSite: jest.fn(),
}));
jest.mock("@/lib/collaboration/permissions", () => ({
  CollaborationPermissions: jest.fn(),
  teamRoleToSitePermission: jest.requireActual(
    "@/lib/collaboration/permissions",
  ).teamRoleToSitePermission,
}));
jest.mock("@/lib/auth/user-identity", () => ({
  resolveUserIdentity: jest.fn(async () => ({ name: "Teammate" })),
  attachUserIdentities: jest.fn(async (rows: unknown[]) => rows),
}));
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

import { DELETE, GET, POST } from "@/app/api/sites/[siteId]/share/route";

const SITE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_IP = "192.0.2.80";
const BASE = `http://localhost/api/sites/${SITE_ID}/share`;

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;
const getUser = jest.fn();
const checkSitePermission = jest.fn();
const serviceFrom = jest.fn();

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

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "delete", "update"]) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return builder;
}

function wire() {
  (createServerClient as jest.Mock).mockResolvedValue({
    auth: { getUser },
    from: () => chain({ data: { id: SITE_ID, name: "Site" }, error: null }),
  });
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: (table: string) => {
      serviceFrom(table);
      return chain({ data: null, error: null });
    },
  });
  (CollaborationPermissions as unknown as jest.Mock).mockImplementation(() => ({
    checkSitePermission,
  }));
  (canShareSite as jest.Mock).mockResolvedValue({ allowed: true });
}

const context = { params: Promise.resolve({ siteId: SITE_ID }) };

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
    userEndpoint: "sites/share:write",
    userPreset: "API_UPLOAD" as const,
    call: () =>
      POST(
        req(BASE, "POST", { userId: "teammate-1", role: "editor" }),
        context,
      ),
  },
  GET: {
    userEndpoint: "sites/share:read",
    userPreset: "USER_GENERAL" as const,
    call: () => GET(req(BASE, "GET"), context),
  },
  DELETE: {
    userEndpoint: "sites/share:write",
    userPreset: "API_UPLOAD" as const,
    call: () => DELETE(req(`${BASE}?permissionId=perm-1`, "DELETE"), context),
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
  expect(checkSitePermission).not.toHaveBeenCalled();
  expect(serviceFrom).not.toHaveBeenCalled();
}

describe("/api/sites/[siteId]/share — ADR 037 order on every verb", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    wire();
    getUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "owner@example.com" } },
      error: null,
    });
    checkSitePermission.mockResolvedValue({ hasPermission: true });
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
        endpoint: "sites/share:ip",
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
      expect(getUser).not.toHaveBeenCalled();
      nothingPastTheGate();
    });

    it("fails closed on a store outage at the address guard", async () => {
      refuse((config) => config.identifierType === "ip", "down");

      const response = await call();

      expect(response.status).toBe(503);
      expect(getUser).not.toHaveBeenCalled();
      nothingPastTheGate();
    });

    it("refuses a user over their limit before the permission check or any service-role call", async () => {
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
      getUser.mockResolvedValue({ data: { user: null }, error: null });

      const response = await call();

      expect(response.status).toBe(401);
      const endpoints = checkLimit.mock.calls.map(
        ([config]) => config.endpoint,
      );
      expect(endpoints).toEqual(["sites/share:ip"]);
    });
  });
});
