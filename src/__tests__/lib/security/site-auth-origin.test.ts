/**
 * A-2 — the site token is a published credential, so its Origin pin is mandatory.
 *
 * `data-site-token` ships as a plain HTML attribute on every customer page
 * (src/lib/sites/embed-script.ts:76), so it is readable with View Source. The
 * single thing that makes a published credential safe is the check that it was
 * presented from the registered domain — and that check used to be written as
 *
 *     if (requestOriginHost && requestOriginHost !== allowedDomain) throw
 *
 * (src/lib/security/site-auth.ts:128, and identically at :218 in
 * `authorizeSiteOrigin`). `Origin` is enforced by browsers, never by callers.
 * A browser cannot omit it; curl omits it by default. So the guard was skipped
 * for exactly the caller it exists to stop, and enforced only against the one
 * that could not have forged it anyway.
 *
 * The element ids are not a secret either: they are
 * `'rcf-' + hashPath(structuralPath(element))` (recopyfast.src.js:819-824),
 * a pure function of the victim's own DOM, so an attacker renders the page
 * headlessly and computes them. `ignoreDuplicates` protects rows that already
 * exist, but every id not yet discovered was seedable, and the widget then
 * serves the attacker's `published_content` to every visitor.
 *
 * Both functions now refuse a caller that cannot present the registered domain.
 * The only exemption is the localhost demo token on a non-production build.
 */

import crypto from "crypto";

jest.mock("@/lib/supabase/service");

// No dashboard session. `authorizeFirstPartySiteRequest` must return null
// cleanly rather than throwing on `next/headers`, otherwise the GET handler
// 500s from its outer catch and a "refused" assertion would pass for a reason
// that has nothing to do with Origin.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
      },
    }),
  ),
}));

import {
  authorizeSiteRequest,
  authorizeSiteOrigin,
  buildSiteToken,
} from "@/lib/security/site-auth";
import { POST, GET, OPTIONS } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest } from "next/server";

const SITE_ID = "site-123";
const API_KEY = "site-api-key-shhh";
const REGISTERED_DOMAIN = "example.com";

const upsert = jest.fn(() => Promise.resolve({ error: null }));

/**
 * A service-role client that answers the `sites` lookup and records writes.
 *
 * Only the database is stubbed. `authorizeSiteRequest`, `verifySiteTokenSignature`
 * and the HMAC are all the real implementations — the point of this suite is the
 * decision that code makes, not a restatement of it.
 */
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
  upsert,
};

/** The token any visitor can read off the customer's page. */
function publishedSiteToken() {
  return buildSiteToken(SITE_ID, API_KEY);
}

/**
 * Re-wire the stubbed client from scratch before every test.
 *
 * `jest.clearAllMocks()` forgets calls but keeps a `mockReturnValueOnce` queue,
 * and two tests below queue four `.eq()` answers to walk the content query. A
 * headerless request is now refused before that query runs, so those answers go
 * unconsumed and would be handed to whichever test ran next — which is how a
 * stale queue becomes a failure three tests away, in the one describe block that
 * never wired a client of its own. `mockReset` drops the queue.
 */
function primeServiceClient() {
  serviceClient.from.mockReset();
  serviceClient.from.mockReturnValue(serviceClient);
  serviceClient.select.mockReset();
  serviceClient.select.mockReturnValue(serviceClient);
  serviceClient.eq.mockReset();
  serviceClient.eq.mockReturnValue(serviceClient);
  serviceClient.single.mockReset();
  serviceClient.single.mockResolvedValue({
    data: { id: SITE_ID, domain: REGISTERED_DOMAIN, api_key: API_KEY },
    error: null,
  });
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });

  (
    createServiceRoleClient as jest.MockedFunction<
      typeof createServiceRoleClient
    >
  ).mockReturnValue(
    serviceClient as unknown as ReturnType<typeof createServiceRoleClient>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  primeServiceClient();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("authorizeSiteRequest Origin enforcement", () => {
  // The controls. These establish that the check works when a header is
  // present, so the failures below isolate the omission and nothing else.
  it("refuses a token presented from the wrong Origin", async () => {
    await expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: publishedSiteToken(),
        origin: "https://attacker.example.net",
        referer: null,
      }),
    ).rejects.toThrow("Origin not allowed");
  });

  it("refuses a token presented with only a wrong Referer", async () => {
    await expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: publishedSiteToken(),
        origin: null,
        referer: "https://attacker.example.net/landing",
      }),
    ).rejects.toThrow("Origin not allowed");
  });

  it("accepts the widget on the registered domain", async () => {
    const context = await authorizeSiteRequest({
      siteId: SITE_ID,
      token: publishedSiteToken(),
      origin: `https://${REGISTERED_DOMAIN}`,
      referer: null,
    });

    expect(context.site.id).toBe(SITE_ID);
  });

  // Independent of the refusal below: the call reaches the real code path and
  // looks the site up, so a rejection there is the Origin decision and not a
  // broken fixture throwing on the way in.
  it("reaches the site lookup on a headerless request", async () => {
    await authorizeSiteRequest({
      siteId: SITE_ID,
      token: publishedSiteToken(),
      origin: null,
      referer: null,
    }).catch(() => undefined);

    expect(serviceClient.from).toHaveBeenCalledWith("sites");
  });

  it("refuses a request that sends neither Origin nor Referer", async () => {
    // curl, a server-side script, anything that is not a browser. The token
    // came from View Source; nothing else was needed.
    await expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: publishedSiteToken(),
        origin: null,
        referer: null,
      }),
    ).rejects.toThrow("Origin not allowed");
  });

  // Independent of the refusal below.
  it("reaches the site lookup when Origin is the literal string null", async () => {
    await authorizeSiteRequest({
      siteId: SITE_ID,
      token: publishedSiteToken(),
      origin: "null",
      referer: null,
    }).catch(() => undefined);

    expect(serviceClient.from).toHaveBeenCalledWith("sites");
  });

  it("refuses a request whose Origin header is present but unparseable", async () => {
    // `parseOrigin` returns null for anything `new URL()` rejects
    // (site-auth.ts:33-40), and null used to land in the same permissive branch.
    // So sending `Origin: null` — which browsers really do send for sandboxed
    // and some redirected requests — was treated as "no Origin to check".
    await expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: publishedSiteToken(),
        origin: "null",
        referer: null,
      }),
    ).rejects.toThrow("Origin not allowed");
  });

  // Independent of the refusal below.
  it("authorizeSiteOrigin reaches the site lookup with no headers", async () => {
    await authorizeSiteOrigin(SITE_ID, null, null).catch(() => undefined);

    expect(serviceClient.from).toHaveBeenCalledWith("sites");
  });

  it("authorizeSiteOrigin refuses a headerless caller too", async () => {
    // The same optional-guard shape used to sit at site-auth.ts:218. This is the
    // function behind the content preflight, so a refusal here is what keeps a
    // headerless caller from learning that a site id exists.
    await expect(authorizeSiteOrigin(SITE_ID, null, null)).rejects.toThrow(
      "Origin not allowed",
    );
  });
});

describe("POST /api/content/[siteId] without an Origin header", () => {
  function headerlessPost(body: unknown) {
    // Deliberately no Origin and no Referer. Everything else is exactly what
    // the real widget sends.
    return new NextRequest(`https://recopyfast.com/api/content/${SITE_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${publishedSiteToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  // Independent of the seed-write refusal below: the handler runs to completion
  // and returns a response for this exact request, whatever it decides.
  it("returns a response for a headerless POST", async () => {
    const response = await POST(
      headerlessPost({
        "rcf-not-yet-discovered": {
          selector: "h1",
          content: "seeded",
          type: "text",
        },
      }),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    );

    expect(typeof response.status).toBe("number");
    expect(serviceClient.from).toHaveBeenCalledWith("sites");
  });

  it("refuses an unauthenticated seed write", async () => {
    // The id is computed from the victim's own markup, so an attacker could name
    // an element the widget had not reached yet — a page never visited, an
    // element added since the last scan — and own its content before discovery
    // did. `hydrateStoredContent` serves it to every visitor thereafter.
    const response = await POST(
      headerlessPost({
        "rcf-not-yet-discovered": {
          selector: "h1",
          content: "Your account has moved. Sign in at evil.example",
          type: "text",
        },
      }),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    );

    // Asserted on the write as well as the status: this route used to answer 200
    // while persisting the attacker's row.
    expect(upsert).not.toHaveBeenCalled();
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // Independent of the headerless-read refusal below: the same request, the same
  // four-deep mock chain, asserting only that the handler ran and answered.
  it("returns a response for a headerless GET", async () => {
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

    const response = await GET(
      new NextRequest(`https://recopyfast.com/api/content/${SITE_ID}`, {
        headers: { Authorization: `Bearer ${publishedSiteToken()}` },
      }),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    );

    expect(typeof response.status).toBe("number");
    expect(serviceClient.from).toHaveBeenCalledWith("sites");
  });

  it("refuses an unauthenticated read of every content row", async () => {
    // Four `.eq()` calls in order: the `sites` lookup inside
    // authorizeSiteRequest, then site_id / language / variant on
    // content_elements. Only the last resolves.
    serviceClient.eq
      .mockReturnValueOnce(serviceClient)
      .mockReturnValueOnce(serviceClient)
      .mockReturnValueOnce(serviceClient)
      .mockReturnValueOnce(
        Promise.resolve({
          data: [
            {
              element_id: "rcf-headline",
              published_content: "Private pre-launch copy",
            },
          ],
          error: null,
        }) as unknown as typeof serviceClient,
      );

    const request = new NextRequest(
      `https://recopyfast.com/api/content/${SITE_ID}`,
      {
        headers: { Authorization: `Bearer ${publishedSiteToken()}` },
      },
    );

    const response = await GET(request, {
      params: Promise.resolve({ siteId: SITE_ID }),
    });
    const body = await response.json();

    // The leak is the point, so assert on the payload as well as the status:
    // a headerless caller must not come away holding the rows.
    expect(JSON.stringify(body)).not.toContain("Private pre-launch copy");
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("still refuses the same write when a wrong Origin is supplied", async () => {
    // The case that always worked, kept beside the pair above: a mismatched
    // header and an absent one now reach the same verdict, and this one pins the
    // exact status the widget's CORS path depends on.
    const request = new NextRequest(
      `https://recopyfast.com/api/content/${SITE_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${publishedSiteToken()}`,
          Origin: "https://attacker.example.net",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          "rcf-not-yet-discovered": {
            selector: "h1",
            content: "seeded",
            type: "text",
          },
        }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ siteId: SITE_ID }),
    });

    expect(response.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("the element id an attacker has to guess", () => {
  it("is a pure function of the victim's markup, so it is not a secret", () => {
    // Transcribed from recopyfast.src.js:770-786 (cyrb53). The point is not to
    // test the widget here — src/__tests__/embed/element-id-page-scope.test.ts
    // runs the shipped implementation — it is that the id derives from the
    // structural path with no per-site salt, no server round trip and no
    // secret, so possession of the public token is the whole attack.
    const hashPath = (text: string) => {
      let h1 = 0xdeadbeef;
      let h2 = 0x41c6ce57;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 =
        Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
        Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 =
        Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
        Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    };

    // Same path in, same id out — computed offline, twice, with no access to
    // the site beyond its public HTML.
    expect(`rcf-${hashPath("#main>section:2>h1:1")}`).toBe(
      `rcf-${hashPath("#main>section:2>h1:1")}`,
    );
    // And no dependence on the api_key that signs the token.
    expect(hashPath("#main>section:2>h1:1")).not.toContain(API_KEY);
  });

  it("cannot be forged without the api_key, which is the only real secret", () => {
    const forged = `${SITE_ID}.${Math.floor(Date.now() / 1000)}.${crypto
      .createHmac("sha256", "not-the-api-key")
      .update(`${SITE_ID}.${Math.floor(Date.now() / 1000)}`)
      .digest("hex")}`;

    return expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: forged,
        origin: null,
        referer: null,
      }),
    ).rejects.toThrow("Invalid site token");
  });
});

/**
 * The preflight is the half of the pin a non-browser caller never sees.
 *
 * A cross-origin GET or POST from the widget is preceded by an OPTIONS, and
 * `authorizeSiteOrigin` answers it with no token to inspect. That makes it the one
 * place where "is this the registered domain?" has to be decided on the header
 * alone — so it is also the place where the localhost demo exemption in
 * `authorizeSiteRequest` has to be mirrored, or the request it exempts is blocked
 * before it is sent (docs/PROJECT_REPORT.md:435).
 *
 * WHAT A REFUSED PREFLIGHT LOOKS LIKE. Every caller gets 204. Refusing means
 * withholding the `Access-Control-Allow-Origin` grant, not varying the status: a
 * 204 that does not name the caller's origin is one the browser will not act on,
 * so the request behind it is never sent. The status used to vary, and since
 * `authorizeSiteOrigin` throws "Site not found" as well as "Origin not allowed",
 * that made the preflight an existence oracle for site ids.
 *
 * The exemption is development-only and localhost-only. The absent-Origin case is
 * still refused the grant: that is A-2 itself, and a caller with no Origin is
 * exactly the one this check exists to stop.
 */
describe("OPTIONS /api/content/[siteId] preflight", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  });

  function preflight(origin: string | null) {
    const headers: Record<string, string> = {
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    };
    if (origin) headers.Origin = origin;

    return OPTIONS(
      new NextRequest(`https://recopyfast.com/api/content/${SITE_ID}`, {
        method: "OPTIONS",
        headers,
      }),
      { params: Promise.resolve({ siteId: SITE_ID }) },
    );
  }

  it("admits the widget on the registered domain", async () => {
    const response = await preflight(`https://${REGISTERED_DOMAIN}`);

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      `https://${REGISTERED_DOMAIN}`,
    );
  });

  /**
   * "Local" is an exact host, never a prefix.
   *
   * The check read `host.startsWith("127.0.0.1")`, which is true of
   * `127.0.0.1.attacker.example` — a domain anyone can register and point wherever
   * they like. That handed the development exemptions to an attacker-controlled
   * origin: the demo-token bypass in `authorizeSiteRequest` and the preflight grant
   * here. The prefix existed to tolerate a port that `parseOrigin` already strips.
   */
  it.each([
    [
      "a domain that merely starts with the loopback IP",
      "http://127.0.0.1.attacker.example",
    ],
    ["a subdomain of it", "http://127.0.0.1.evil.test"],
    [
      "a host that merely starts with localhost",
      "http://localhost.attacker.example",
    ],
    ["a look-alike loopback", "http://127.0.0.10"],
  ])("does not treat %s as local", async (_label, origin) => {
    const response = await preflight(origin);

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(
      origin,
    );
  });

  it("never falls back to a wildcard grant when the app URL is unset", async () => {
    // "No grant" must be the ABSENCE of the header. withCors used to fall back
    // to NEXT_PUBLIC_APP_URL || "*", so on a deployment without the env var a
    // REFUSED preflight granted every origin — the exact grant the uniform 204
    // exists to withhold ("*" is also invalid beside Allow-Credentials: true).
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    try {
      const response = await preflight("https://not-the-registered-domain.com");

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(
        response.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
    } finally {
      if (originalAppUrl !== undefined) {
        process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
      }
    }
  });

  it("refuses a site token presented from a loopback look-alike domain", async () => {
    // The same exactness on the request path, where the demo token would otherwise
    // be honoured for an origin the attacker controls.
    await expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: "demo-site-token",
        origin: "http://127.0.0.1.attacker.example",
        referer: null,
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["localhost", "http://localhost:8080"],
    ["127.0.0.1", "http://127.0.0.1:8080"],
    ["the IPv6 loopback", "http://[::1]:8080"],
  ])(
    "admits a %s demo page in development, against a non-local registered domain",
    async (_label, origin) => {
      // The site is registered to example.com, and the demo page is served from
      // the developer's own machine — the shape docs/PROJECT_REPORT.md documents.
      const response = await preflight(origin);

      expect(response.status).toBe(204);
      // Echoed, or the browser discards the 204 and blocks the request anyway.
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    },
  );

  it("withholds the grant from the same localhost preflight in production", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");

    const response = await preflight("http://localhost:8080");

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "http://localhost:8080",
    );
  });

  it("withholds the grant from an origin that is neither local nor registered", async () => {
    const response = await preflight("https://attacker.example.net");

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "https://attacker.example.net",
    );
  });

  it("withholds the grant from a preflight that sends no Origin at all", async () => {
    // Not a browser, therefore not a preflight. The development exemption is for
    // localhost, not for the absence of a header — that absence is A-2.
    const response = await preflight(null);

    expect(response.status).toBe(204);
    expect(serviceClient.from).toHaveBeenCalledWith("sites");
  });

  /**
   * The oracle Devin flagged, pinned shut — and the part of it that cannot close,
   * written down rather than papered over.
   *
   * `authorizeSiteOrigin` throws both for a site that does not exist and for an
   * origin that is not allowed. The handler used to turn both into 403, which was
   * uniform until the localhost exemption turned one of them into a 204. The status
   * is now 204 for everyone, so it carries nothing.
   *
   * What cannot be uniform is the GRANT, because a CORS grant *is* "this origin
   * matches the site's registered domain" — answering that is the header's whole
   * job. So a caller who can already name the registered domain (or is on localhost
   * against a dev build) can still tell a known site id from an unknown one by
   * whether their origin comes back echoed. In a browser that requires already
   * being on the registered domain, where the site token is readable from the
   * page's own markup; outside a browser it confirms "this id belongs to that
   * domain" for someone who had to know both to ask. Every caller who cannot state
   * the registered domain — which is the attacker this check exists for — gets a
   * byte-identical answer, asserted below.
   */
  describe("does not tell a caller whether a site id exists", () => {
    function withMissingSite() {
      serviceClient.single.mockResolvedValue({
        data: null,
        error: { message: "No rows returned" },
      });
    }

    it.each([
      ["a wrong origin", "https://attacker.example.net"],
      ["no origin at all", null],
    ])(
      "answers a known and an unknown site id identically, given %s",
      async (_label, origin) => {
        const known = await preflight(origin);
        const knownAnswer = {
          status: known.status,
          allowOrigin: known.headers.get("Access-Control-Allow-Origin"),
          vary: known.headers.get("Vary"),
        };

        withMissingSite();
        const unknown = await preflight(origin);

        expect({
          status: unknown.status,
          allowOrigin: unknown.headers.get("Access-Control-Allow-Origin"),
          vary: unknown.headers.get("Vary"),
        }).toEqual(knownAnswer);
      },
    );

    it.each([
      ["the registered domain", `https://${REGISTERED_DOMAIN}`],
      ["a localhost demo origin", "http://localhost:8080"],
      ["a wrong origin", "https://attacker.example.net"],
      ["no origin at all", null],
    ])(
      "answers 204 for a site id that does not exist, given %s",
      async (_label, origin) => {
        // The status is the channel that closed: it is the same for a missing row,
        // a mismatched origin and a granted one.
        withMissingSite();

        const response = await preflight(origin);

        expect(response.status).toBe(204);
      },
    );

    it("never echoes an origin for a site id that does not exist", async () => {
      // The grant is not the leak in the other direction: an unknown site id grants
      // nobody, not even a caller naming the registered domain.
      withMissingSite();

      const response = await preflight(`https://${REGISTERED_DOMAIN}`);

      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(
        `https://${REGISTERED_DOMAIN}`,
      );
    });
  });
});
