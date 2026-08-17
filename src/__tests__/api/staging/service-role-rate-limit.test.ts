/**
 * H-3 — the two staging write paths run on the service-role client and carried
 * no rate limiter.
 *
 * PUT /api/staging/content/[siteId] updates staged copy with the service-role
 * key; POST /api/staging/publish calls `publish_staging_content_atomic`, which
 * pushes that copy live on the customer's site. Both are opened by a credential
 * that is hand-delivered in a link — an invite that leaks is a copied
 * credential, and ADR 002 rule 4 makes the fail-closed per-site limiter the
 * thing that bounds what it can do.
 *
 * Keyed per SITE for the reason the rule gives: it is the site's blast radius
 * being capped, not one address's. Behind the permission grade, where the
 * service-role work begins — the same placement as the per-site limiter on
 * api/content/[siteId]/route.ts:455-473.
 *
 * Only the store and the identity are stubbed. `enforceRateLimit`, its failure
 * policy and its headers are the shipped implementations.
 */

import { NextRequest } from "next/server";
import { rateLimiter } from "@/lib/security/rate-limiter";
import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/auth/editor-access", () => {
  const actual = jest.requireActual("@/lib/auth/editor-access");
  return {
    __esModule: true,
    ...actual,
    authorizeFirstPartyEditorAccess: jest.fn(),
  };
});
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

import { PUT as putStagingContent } from "@/app/api/staging/content/[siteId]/route";
import { POST as postPublish } from "@/app/api/staging/publish/route";

const SITE_ID = "11111111-1111-1111-1111-111111111111";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;
const firstPartyAccess = authorizeFirstPartyEditorAccess as jest.MockedFunction<
  typeof authorizeFirstPartyEditorAccess
>;

/**
 * A service-role client that records what it was asked to do. Every terminal
 * call resolves, so an admitted request runs to completion and the refusals
 * below are attributable to the limiter alone.
 */
function wireServiceClient() {
  const calls: string[] = [];
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    not: jest.fn(() => chain),
    order: jest.fn(() => chain),
    single: jest.fn(() =>
      Promise.resolve({ data: { id: "element-1" }, error: null }),
    ),
    update: jest.fn(() => {
      calls.push("update");
      return chain;
    }),
    insert: jest.fn(() => {
      calls.push("insert");
      return Promise.resolve({ error: null });
    }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  } as unknown as Record<string, jest.Mock>;

  const client = {
    from: jest.fn(() => chain),
    rpc: jest.fn(() => {
      calls.push("rpc");
      return Promise.resolve({ data: [], error: null });
    }),
  };

  (createServiceRoleClient as jest.Mock).mockReturnValue(client);
  return { client, calls };
}

const ROUTES = {
  "staging/content (PUT)": {
    permission: "edit" as const,
    call: () =>
      putStagingContent(
        new NextRequest(
          `https://www.recopyfa.st/api/staging/content/${SITE_ID}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              elementId: "rcf-headline",
              content: "New copy",
            }),
          },
        ),
        { params: Promise.resolve({ siteId: SITE_ID }) },
      ),
  },
  "staging/publish (POST)": {
    permission: "publish" as const,
    call: () =>
      postPublish(
        new NextRequest("https://www.recopyfa.st/api/staging/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ siteId: SITE_ID }),
        }),
      ),
  },
};

const ROUTE_NAMES = Object.keys(ROUTES) as Array<keyof typeof ROUTES>;

describe("the staging service-role writes are metered per site", () => {
  let service: ReturnType<typeof wireServiceClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    service = wireServiceClient();
    firstPartyAccess.mockResolvedValue({
      kind: "edit-session",
      siteId: SITE_ID,
      token: "session-token",
      permissions: ["view", "edit", "publish", "admin"],
      email: "owner@example.com",
      userId: "user-1",
    });
    checkLimit.mockResolvedValue({
      allowed: true,
      remaining: 49,
      resetTime: Date.now() + 60_000,
      totalRequests: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(ROUTE_NAMES)("%s", (name) => {
    const { call } = ROUTES[name];

    it("serves a request within the limit", async () => {
      // The control: the limiter is the only thing refusing anything below.
      const response = await call();

      expect(response.status).toBe(200);
      expect(checkLimit).toHaveBeenCalled();
    });

    it("buckets the limit by site, never by IP", async () => {
      await call();

      const config = checkLimit.mock.calls[0][0];
      expect(config.identifier).toBe(SITE_ID);
      expect(config.identifierType).not.toBe("ip");
    });

    it("refuses over the limit without writing anything", async () => {
      checkLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30_000,
        totalRequests: 51,
      });

      const response = await call();

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).not.toBeNull();
      expect(service.calls).toHaveLength(0);
    });

    it("refuses when the limiter store is unreachable", async () => {
      checkLimit.mockRejectedValue(new Error("Redis unreachable"));

      const response = await call();

      // Fails CLOSED (ADR 002 rule 4). These paths change what a customer's
      // visitors see; losing Redis must not remove the only ceiling on them.
      expect(response.status).toBe(503);
      expect(service.calls).toHaveLength(0);
    });
  });
});
