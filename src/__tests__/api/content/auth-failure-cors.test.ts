/**
 * A-25 — site tokens expire at 90 days, and the failure is unreadable and
 * unactionable when they do.
 *
 * `verifySiteTokenSignature` enforces a 90-day maximum age
 * (src/lib/security/site-auth.ts:53,71). `buildSiteToken` is called only when
 * the dashboard renders a fresh snippet (sites/register/route.ts:158,
 * sites/route.ts:98) — nothing rotates the static string already pasted into
 * the customer's HTML, and the widget has no refresh path. So every install
 * stops working on a timer, and the dashboard keeps showing a freshly minted,
 * perfectly valid snippet, so the owner has no way to notice.
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
 * 2. THE SERVER DOES NOT SAY WHAT WENT WRONG. An expired-but-genuine token and
 *    a forged one produce the identical string "Invalid site token", so even a
 *    reader of the raw response cannot tell "reinstall your snippet" from
 *    "somebody is probing you".
 *
 * Nothing here mocks `site-auth`: the real HMAC, the real age check and the
 * real route are what answer. Only the database is stubbed.
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

    // GUARD for the three marked groups below. `test.failing` passes on ANY
    // throw — a handler that stopped exporting, a mock that no longer matches,
    // a typo in a header name — so each needs an unmarked sibling driving the
    // identical request through the identical handler and asserting only that
    // it ran and refused. What it refuses *with* is the marked assertion.
    it.each(methods)(
      "%s refuses an expired token and answers",
      async (method) => {
        const response = await handlers[method](
          widgetRequest(method, tokenIssuedDaysAgo(91)),
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

    test.failing.each(methods)(
      "%s sends CORS headers on a 401 for an expired token",
      async (method) => {
        const response = await handlers[method](
          widgetRequest(method, tokenIssuedDaysAgo(91)),
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

    test.failing.each(methods)(
      "%s sends CORS headers on a 401 for a missing token",
      async (method) => {
        const response = await handlers[method](widgetRequest(method, null));

        expect(response.status).toBe(401);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
          WIDGET_ORIGIN,
        );
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

    test.failing.each(methods)(
      "%s sends a Vary: Origin on an authorization failure",
      async (method) => {
        // The success path sets it (route.ts:38). A cacheable refusal without
        // it is a cross-origin cache poisoning primitive on a response that is
        // already origin-dependent.
        const response = await handlers[method](
          widgetRequest(method, tokenIssuedDaysAgo(91)),
        );

        expect(response.headers.get("Vary")).toBe("Origin");
      },
    );

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

  describe("a 91-day-old token must surface an actionable state", () => {
    it("is refused, which is the behaviour the age check is for", async () => {
      // Not the defect. The expiry itself is correct; what follows from it is
      // not.
      const response = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(91)),
      );

      expect(response.status).toBe(401);
    });

    it("accepts an 89-day-old token, pinning the boundary", async () => {
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

      const response = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(89)),
      );

      expect(response.status).toBe(200);
    });

    // GUARD for the three marked tests below: both tokens reach the handler,
    // both are refused, and both answer with a readable JSON body carrying an
    // `error`. That is everything the marked assertions depend on except the
    // one thing they assert.
    it("refuses both an expired and a forged token with a JSON error", async () => {
      const expired = await handlers.GET(
        widgetRequest("GET", tokenIssuedDaysAgo(91)),
      );
      const forged = await handlers.GET(widgetRequest("GET", forgedToken()));

      expect(expired.status).toBe(401);
      expect(forged.status).toBe(401);
      expect(typeof (await expired.json()).error).toBe("string");
      expect(typeof (await forged.json()).error).toBe("string");
    });

    test.failing(
      "distinguishes an expired token from a forged one",
      async () => {
        // One is "your install aged out, paste the new snippet"; the other is
        // "someone is probing your site". They are the same 401 with the same
        // string today, so neither the widget nor an operator reading logs can
        // tell which happened.
        const expired = await handlers.GET(
          widgetRequest("GET", tokenIssuedDaysAgo(91)),
        );
        const forged = await handlers.GET(widgetRequest("GET", forgedToken()));

        expect(await expired.json()).not.toEqual(await forged.json());
      },
    );

    test.failing(
      "says the token expired, in words a site owner can act on",
      async () => {
        const response = await handlers.GET(
          widgetRequest("GET", tokenIssuedDaysAgo(91)),
        );
        const body = await response.json();

        expect(String(body.error)).toMatch(/expir/i);
      },
    );

    test.failing(
      "a token that has aged out is still recognised as genuinely ours",
      async () => {
        // The widget cannot self-heal without this. An expired token still
        // carries a valid HMAC over a site id we issued, so the server is able
        // to answer "re-mint this" — but the refusal collapses that into the
        // same verdict as a random string, so there is nothing for a refresh
        // path to key off and none exists.
        const response = await handlers.GET(
          widgetRequest("GET", tokenIssuedDaysAgo(91)),
        );
        const body = await response.json();

        expect(body).toHaveProperty("code");
      },
    );
  });

  describe("the installed snippet is never rotated", () => {
    it("mints a token dated now, so the dashboard always looks healthy", () => {
      // `buildSiteToken` stamps `Date.now()` (site-auth.ts:43). Every dashboard
      // render therefore shows a token that will pass for another 90 days,
      // regardless of how old the one on the customer's page is — which is why
      // the owner cannot see the expiry coming.
      const issuedAt = Number(buildSiteToken(SITE_ID, API_KEY).split(".")[1]);
      const now = Math.floor(Date.now() / 1000);

      expect(now - issuedAt).toBeLessThan(5);
    });
  });
});
