/**
 * s77 — the staging publish and content routes meter before they authorize
 * (s69 L7) and canonicalise the site id before it keys anything (s69 R1).
 *
 * L7. `POST /api/staging/publish` ran a session lookup, a `site_permissions`
 * read and the editor-token validation before its limiter; its GET (the
 * publish dialog's preview) and `GET /api/staging/content/[siteId]` had no
 * limiter at all in front of a service-role read of the site's copy. Now a
 * per-IP guard (`IP_GENERAL`, fail closed) runs first on every handler, and the
 * two GETs gain a fail-closed per-site limiter behind authorization.
 *
 * R1. The per-site buckets were keyed on the raw `siteId` the caller sent. The
 * authorizers reach the site through a `uuid` cast, so `ABCD…` and `abcd…` were
 * one site with two budgets. The id is now canonicalised (lower case) before
 * any work, and a malformed one is 400 before any authorizer, limiter or query.
 *
 * Only the store, the identity and the database are stubbed; `enforceRateLimit`
 * and `requireUuid` are the shipped implementations.
 */

import { NextRequest } from "next/server";
import {
  rateLimiter,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig,
} from "@/lib/security/rate-limiter";
import {
  authorizeFirstPartyEditorAccess,
  validateEditorTokenFromRequest,
} from "@/lib/auth/editor-access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { fetchPageScopedRows } from "@/lib/content/paged-elements";

jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: () => Promise.resolve({ ok: true, ownerId: "owner-1" }),
}));
jest.mock("@/lib/auth/editor-access", () => {
  const actual = jest.requireActual("@/lib/auth/editor-access");
  return {
    __esModule: true,
    ...actual,
    authorizeFirstPartyEditorAccess: jest.fn(),
    validateEditorTokenFromRequest: jest.fn(),
  };
});
jest.mock("@/lib/content/paged-elements", () => ({
  fetchPageScopedRows: jest.fn(),
}));
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

import {
  GET as getStagingContent,
  PUT as putStagingContent,
} from "@/app/api/staging/content/[siteId]/route";
import {
  GET as getPublishPreview,
  POST as postPublish,
} from "@/app/api/staging/publish/route";

const SITE_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";
const UPPER_SITE_ID = SITE_ID.toUpperCase();
const CLIENT_IP = "198.51.100.23";
const BASE = "https://www.recopyfa.st/api/staging";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;
const firstParty = authorizeFirstPartyEditorAccess as jest.MockedFunction<
  typeof authorizeFirstPartyEditorAccess
>;
const editorToken = validateEditorTokenFromRequest as jest.MockedFunction<
  typeof validateEditorTokenFromRequest
>;
const pagedRows = fetchPageScopedRows as jest.MockedFunction<
  typeof fetchPageScopedRows
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

let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

function wireServiceClient() {
  rpcCalls = [];
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn(),
    rpc: jest.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data:
          name === "save_staging_content_atomic"
            ? [{ updated_at: "2026-10-09T12:00:00.000Z" }]
            : [],
        error: null,
      });
    }),
  });
}

function headers(json = false) {
  return {
    "x-forwarded-for": CLIENT_IP,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

/** Each handler, called the way the widget (or the dashboard) calls it. */
const HANDLERS = {
  "publish POST": {
    ipEndpoint: "staging/publish:ip",
    siteEndpoint: "staging/publish",
    call: (siteId: string) =>
      postPublish(
        new NextRequest(`${BASE}/publish`, {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({ siteId }),
        }),
      ),
  },
  "publish GET (preview)": {
    ipEndpoint: "staging/publish:ip",
    siteEndpoint: "staging/publish-preview",
    call: (siteId: string) =>
      getPublishPreview(
        new NextRequest(
          `${BASE}/publish?siteId=${encodeURIComponent(siteId)}`,
          { headers: headers() },
        ),
      ),
  },
  "content GET": {
    ipEndpoint: "staging/content:ip",
    siteEndpoint: "staging/content-read",
    call: (siteId: string) =>
      getStagingContent(
        new NextRequest(`${BASE}/content/${encodeURIComponent(siteId)}`, {
          headers: headers(),
        }),
        { params: Promise.resolve({ siteId }) },
      ),
  },
  "content PUT": {
    ipEndpoint: "staging/content:ip",
    siteEndpoint: "staging/content-update",
    call: (siteId: string) =>
      putStagingContent(
        new NextRequest(`${BASE}/content/${encodeURIComponent(siteId)}`, {
          method: "PUT",
          headers: headers(true),
          body: JSON.stringify({ elementId: "rcf-headline", content: "New" }),
        }),
        { params: Promise.resolve({ siteId }) },
      ),
  },
};

const HANDLER_NAMES = Object.keys(HANDLERS) as Array<keyof typeof HANDLERS>;

function configsFor(endpoint: string): RateLimitConfig[] {
  return checkLimit.mock.calls
    .map(([config]) => config)
    .filter((config) => config.endpoint === endpoint);
}

function serviceRoleWork(): number {
  return pagedRows.mock.calls.length + rpcCalls.length;
}

describe("staging publish/content: meter first, canonical site id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    wireServiceClient();
    pagedRows.mockResolvedValue({ data: [], error: null } as never);
    firstParty.mockImplementation(async (siteId: string) => ({
      kind: "edit-session",
      siteId,
      token: "",
      permissions: ["view", "edit", "publish", "admin"],
      email: "owner@example.com",
      userId: "user-1",
      verified: true,
    }));
    checkLimit.mockResolvedValue(ALLOWED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(HANDLER_NAMES)("%s", (name) => {
    const { call, ipEndpoint, siteEndpoint } = HANDLERS[name];

    it("is served, and meters the address first: IP_GENERAL, fail closed", async () => {
      const response = await call(SITE_ID);

      expect(response.status).toBe(200);
      expect(checkLimit.mock.calls[0][0]).toMatchObject({
        endpoint: ipEndpoint,
        identifier: CLIENT_IP,
        identifierType: "ip",
        maxRequests: RATE_LIMIT_CONFIGS.IP_GENERAL.maxRequests,
        windowMs: RATE_LIMIT_CONFIGS.IP_GENERAL.windowMs,
      });
    });

    it("refuses an address over its limit before any authorization", async () => {
      checkLimit.mockImplementation(async (config) =>
        config.identifierType === "ip" ? REFUSED : ALLOWED,
      );

      const response = await call(SITE_ID);

      expect(response.status).toBe(429);
      expect(firstParty).not.toHaveBeenCalled();
      expect(editorToken).not.toHaveBeenCalled();
      expect(serviceRoleWork()).toBe(0);
    });

    it("fails closed on a store outage, before any authorization", async () => {
      checkLimit.mockImplementation(async (config) => {
        if (config.identifierType === "ip") throw new Error("Redis down");
        return ALLOWED;
      });

      const response = await call(SITE_ID);

      expect(response.status).toBe(503);
      expect(firstParty).not.toHaveBeenCalled();
      expect(serviceRoleWork()).toBe(0);
    });

    it("serves an upper-case id as the canonical one: authorizer, bucket, query", async () => {
      const response = await call(UPPER_SITE_ID);

      expect(response.status).toBe(200);
      expect(firstParty).toHaveBeenCalledWith(SITE_ID, "view");
      const perSite = configsFor(siteEndpoint);
      expect(perSite).toHaveLength(1);
      expect(perSite[0].identifier).toBe(SITE_ID);
      for (const { args } of rpcCalls) {
        expect(args.p_site_id).toBe(SITE_ID);
      }
    });

    it.each([
      ["a slug", "site-1"],
      ["a braced id", `{${SITE_ID}}`],
      ["an id without hyphens", SITE_ID.replace(/-/g, "")],
      ["a non-RFC variant", "11111111-1111-1111-1111-111111111111"],
    ])(
      "refuses %s with 400 before any authorizer, site bucket or query",
      async (_label, siteId) => {
        const response = await call(siteId);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Field "siteId" must be a valid UUID');
        expect(firstParty).not.toHaveBeenCalled();
        expect(editorToken).not.toHaveBeenCalled();
        expect(configsFor(siteEndpoint)).toHaveLength(0);
        expect(serviceRoleWork()).toBe(0);
      },
    );
  });

  describe.each(["publish GET (preview)", "content GET"] as const)(
    "%s — per-site read limiter behind authorization",
    (name) => {
      const { call, siteEndpoint } = HANDLERS[name];

      it("meters the site (USER_GENERAL, 100/min) before the service-role read", async () => {
        await call(SITE_ID);

        expect(configsFor(siteEndpoint)[0]).toMatchObject({
          identifier: SITE_ID,
          identifierType: "api_key",
          maxRequests: RATE_LIMIT_CONFIGS.USER_GENERAL.maxRequests,
          windowMs: RATE_LIMIT_CONFIGS.USER_GENERAL.windowMs,
        });
      });

      it("refuses over the site's limit without reading anything", async () => {
        checkLimit.mockImplementation(async (config) =>
          config.endpoint === siteEndpoint ? REFUSED : ALLOWED,
        );

        const response = await call(SITE_ID);

        expect(response.status).toBe(429);
        expect(pagedRows).not.toHaveBeenCalled();
      });

      it("fails closed when the store is down", async () => {
        checkLimit.mockImplementation(async (config) => {
          if (config.endpoint === siteEndpoint) throw new Error("Redis down");
          return ALLOWED;
        });

        const response = await call(SITE_ID);

        expect(response.status).toBe(503);
        expect(pagedRows).not.toHaveBeenCalled();
      });

      it("never meters the site for a caller who is not authorized", async () => {
        firstParty.mockResolvedValue(null);
        editorToken.mockResolvedValue({
          valid: false,
          error: "Invalid editor token",
          status: 401,
        });

        const response = await call(SITE_ID);

        expect(response.status).toBe(401);
        expect(configsFor(siteEndpoint)).toHaveLength(0);
      });
    },
  );
});
