/**
 * A-25 / operator decision D3 — site tokens do not expire by age. Rotation of
 * the site's api_key is the explicit revocation boundary.
 *
 * A genuine old token must keep working until an owner rotates the key. A token
 * signed by the previous key is then refused with a stable code the widget can
 * turn into an actionable warning.
 *
 * Two things then hide the failure from everyone who could act on it:
 *
 * 1. THE BROWSER CANNOT READ THE REFUSAL. Every authorization failure in
 *    /api/content/[siteId] returns a bare `NextResponse.json(...)` — GET at
 *    :74-87, POST at :152-167, PUT at :253-268 — with no `withCors(...)`. The
 *    success paths all call it. For a cross-origin widget that means no
 *    `Access-Control-Allow-Origin` on the refusal, so the browser blocks the
 *    response body outright and the widget lands in its network `catch`. The
 *    site owner sees a generic network error for what is really "your token
 *    expired".
 *
 * 2. THE SERVER DOES NOT SUPPLY A MACHINE-READABLE REASON. The widget needs a
 *    stable code for a refused site token so it can name key rotation as the
 *    recovery path without putting any replacement credential in the response.
 *
 * Nothing here mocks `site-auth`: the real HMAC and route answer. Only the
 * database is stubbed.
 */

import crypto from "crypto";

jest.mock("@/lib/supabase/service");

// No dashboard session, so GET falls through to the widget's token path rather
// than throwing on `next/headers` and 500ing out of the outer catch.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
      },
    }),
  ),
}));

import { GET, POST, PUT } from "@/app/api/content/[siteId]/route";
import { buildSiteToken } from "@/lib/security/site-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest } from "next/server";

const SITE_ID = "site-123";
const API_KEY = "site-api-key-shhh";
const ROTATED_API_KEY = "rotated-site-api-key";
const REGISTERED_DOMAIN = "example.com";
const WIDGET_ORIGIN = `https://${REGISTERED_DOMAIN}`;

const DAY_SECONDS = 24 * 60 * 60;

// Annotated explicitly: the chain methods return the object itself, which
// TypeScript cannot infer from a self-referential initializer (TS7022).
type MockServiceClient = {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
  upsert: jest.Mock;
};

const serviceClient: MockServiceClient = {
  from: jest.fn(() => serviceClient),
  select: jest.fn(() => serviceClient),
  eq: jest.fn(() => serviceClient),
  single: jest.fn(() =>
    Promise.resolve({
      data: { id: SITE_ID, domain: REGISTERED_DOMAIN, api_key: API_KEY },
      error: null,
    }),
  ),
  upsert: jest.fn(() => Promise.resolve({ error: null })),
};

/**
 * A token the dashboard really did mint, `ageDays` ago.
 *
 * Built with the same payload-and-HMAC shape as `buildSiteToken`
 * (site-auth.ts:42-50) rather than by faking the clock, so the signature is
 * genuine and only the age is old — which is exactly the customer's situation
 * ninety-one days after they pasted the snippet.
 */
function tokenIssuedDaysAgo(ageDays: number) {
  const issuedAt = Math.floor(Date.now() / 1000) - ageDays * DAY_SECONDS;
  const payload = `${SITE_ID}.${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", API_KEY)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

/** A token nobody with the api_key ever signed. */
function forgedToken() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${SITE_ID}.${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", "not-the-api-key")
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

function widgetRequest(
  method: "GET" | "POST" | "PUT",
  token: string | null,
  origin = WIDGET_ORIGIN,
) {
  const headers: Record<string, string> = {
    Origin: origin,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return new NextRequest(`https://recopyfast.com/api/content/${SITE_ID}`, {
    method,
    headers,
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({ elementId: "rcf-headline", content: "hi" }),
  });
}

const params = { params: Promise.resolve({ siteId: SITE_ID }) };

const handlers = {
  GET: (request: NextRequest) => GET(request, params),
  POST: (request: NextRequest) => POST(request, params),
  PUT: (request: NextRequest) => PUT(request, params),
} as const;

describe("/api/content/[siteId] authorization failures", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});

    (
      createServiceRoleClient as jest.MockedFunction<
        typeof createServiceRoleClient
      >
    ).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    serviceClient.from.mockReturnValue(serviceClient);
    serviceClient.select.mockReturnValue(serviceClient);
    // `clearAllMocks` preserves queued `mockReturnValueOnce` implementations.
    // A failed content-read assertion must not leak its unused query steps into
    // the next test and turn an independent token check into a cascade failure.
    serviceClient.eq.mockReset();
    serviceClient.eq.mockReturnValue(serviceClient);
    serviceClient.single.mockResolvedValue({
      data: { id: SITE_ID, domain: REGISTERED_DOMAIN, api_key: API_KEY },
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the browser must be able to read the refusal", () => {
    const methods = ["GET", "POST", "PUT"] as const;

    // GUARD for the three groups below: each handler reaches the real auth path
    // and refuses a token signed with a key that is no longer current.
    it.each(methods)(
      "%s refuses a token signed before key rotation and answers",
      async (method) => {
        serviceClient.single.mockResolvedValue({
          data: {
            id: SITE_ID,
            domain: REGISTERED_DOMAIN,
            api_key: ROTATED_API_KEY,
          },
          error: null,
        });
        const response = await handlers[method](
          widgetRequest(method, tokenIssuedDaysAgo(1)),
        );

        expect(response.status).toBe(401);
        expect(typeof response.headers.get).toBe("function");
      },
    );

    it.each(methods)(
      "%s refuses a missing token and answers",
      async (method) => {
        const response = await handlers[method](widgetRequest(method, null));

        expect(response.status).toBe(401);
      },
    );

    test.each(methods)(
      "%s sends CORS headers on a 401 for a token revoked by key rotation",
      async (method) => {
        serviceClient.single.mockResolvedValue({
          data: {
            id: SITE_ID,
            domain: REGISTERED_DOMAIN,
            api_key: ROTATED_API_KEY,
          },
          error: null,
        });
        const response = await handlers[method](
          widgetRequest(method, tokenIssuedDaysAgo(1)),
        );

        expect(response.status).toBe(401);
        // Without this header the browser discards the body before the widget
        // can look at it, and a recoverable "reinstall your snippet" presents
        // as an unexplained network failure on the customer's own site.
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
          WIDGET_ORIGIN,
        );
      },
    );

    test.each(methods)(
      "%s sends CORS headers on a 401 for a missing token",
      async (method) => {
        const response = await handlers[method](widgetRequest(method, null));

        expect(response.status).toBe(401);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
          WIDGET_ORIGIN,
        );
        expect(await response.json()).toEqual({
          error: "Missing site token",
          code: "site_token_missing",
        });
      },
    );

    // GUARD for the Vary group below: proves the header name is spelled the
    // way the route spells it, by reading it off a response that does set it.
    // Without this, a typo in "Vary" would read as a confirmed defect.
    it("reads Vary off a response that sets it", async () => {
      const response = await handlers.PUT(
        widgetRequest("PUT", tokenIssuedDaysAgo(1)),
      );

      expect(response.headers.get("Vary")).toBe("Origin");
    });

    test.each(methods)(
      "%s sends a Vary: Origin on an authorization failure",
      async (method) => {
        // The success path sets it (route.ts:38). A cacheable refusal without
        // it is a cross-origin cache poisoning primitive on a response that is
        // already origin-dependent.
        const response = await handlers[method](
          widgetRequest(method, forgedToken()),
        );

        expect(response.headers.get("Vary")).toBe("Origin");
      },
    );

    it.each(methods)(
      "%s never grants CORS to a wrong origin",
      async (method) => {
        const response = await handlers[method](
          widgetRequest(method, forgedToken(), "https://attacker.example"),
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Vary")).toBe("Origin");
      },
    );

    it.each(methods)(
      "%s never grants CORS when origin and referer are missing",
      async (method) => {
        const request = widgetRequest(method, forgedToken());
        request.headers.delete("origin");

        const response = await handlers[method](request);

        expect(response.status).toBe(401);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Vary")).toBe("Origin");
      },
    );

    it("does not grant CORS or expose database detail for an unknown site", async () => {
      serviceClient.single.mockResolvedValue({
        data: null,
        error: { message: "relation sites is unavailable" },
      });

      const response = await handlers.GET(widgetRequest("GET", forgedToken()));

      expect(response.status).toBe(401);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await response.json()).toEqual({
        error: "Site not found",
        code: "site_not_found",
      });
    });

    it("does not reflect an unexpected authorization exception", async () => {
      serviceClient.single.mockResolvedValue({
        data: { id: SITE_ID, domain: "", api_key: API_KEY },
        error: null,
      });

      const response = await handlers.GET(widgetRequest("GET", forgedToken()));

      expect(response.status).toBe(401);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    // The control. Everything the route considers a success does carry the
    // header, so the failures above are about the refusal path specifically and
    // not about the fixture.
    it("PUT's 403 refusal of live writes already carries CORS headers", async () => {
      const response = await handlers.PUT(
        widgetRequest("PUT", tokenIssuedDaysAgo(1)),
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        WIDGET_ORIGIN,
      );
    });
  });

  describe("site tokens remain valid until the api_key rotates", () => {
    function allowOneContentRead() {
      serviceClient.eq
        .mockReturnValueOnce(serviceClient)
        .mockReturnValueOnce(serviceClient)
        .mockReturnValueOnce(serviceClient)
        .mockReturnValueOnce(
          Promise.resolve({
            data: [],
            error: null,
          }) as unknown as typeof serviceClient,
        );
    }

    it("accepts a 91-day-old genuine token and answers", async () => {
      allowOneContentRead();

      const response = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(91)),
      );

      expect(response.status).toBe(200);
    });

    it("accepts an 89-day-old token, retaining the former boundary guard", async () => {
      allowOneContentRead();

      const response = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(89)),
      );

      expect(response.status).toBe(200);
    });

    it("answers for an old genuine token and refuses a forged token with JSON", async () => {
      allowOneContentRead();

      const genuine = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(91)),
      );
      const forged = await handlers.GET(widgetRequest("GET", forgedToken()));

      expect(genuine.status).toBe(200);
      expect(forged.status).toBe(401);
      expect(typeof (await forged.json()).error).toBe("string");
    });

    it("distinguishes an old genuine token from a forged one by accepting only genuine", async () => {
      allowOneContentRead();

      const genuine = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(91)),
      );
      const forged = await handlers.GET(widgetRequest("GET", forgedToken()));

      expect(genuine.status).toBe(200);
      expect(forged.status).toBe(401);
    });

    it("says a rotated token is invalid with a stable actionable code", async () => {
      serviceClient.single.mockResolvedValue({
        data: {
          id: SITE_ID,
          domain: REGISTERED_DOMAIN,
          api_key: ROTATED_API_KEY,
        },
        error: null,
      });

      const response = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(365)),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Invalid site token",
        code: "site_token_invalid",
      });
    });

    it("recognises a multi-year genuine token as ours", async () => {
      allowOneContentRead();

      const response = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(365 * 3)),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("new snippets still carry an issuance timestamp", () => {
    it("mints a token dated now without making age a validity boundary", () => {
      // The timestamp remains part of the signed token shape and future-date
      // guard. D3 removes only the maximum age; it does not rewrite the format.
      const issuedAt = Number(buildSiteToken(SITE_ID, API_KEY).split(".")[1]);
      const now = Math.floor(Date.now() / 1000);

      expect(now - issuedAt).toBeLessThan(5);
    });
  });
});
