/**
 * A-29 — edit-session tokens are handed to the browser inside a URL.
 *
 * `src/app/api/edit-sessions/create/route.ts:121` builds
 * `https://${site.domain}?rcf_edit_token=${token}` and returns it as `editUrl`.
 * The widget strips the parameter only after the page has loaded
 * (`public/embed/recopyfast.src.js:91-100`), by which point the full URL is in
 * the customer's own access logs, in any CDN or server-side analytics on that
 * host, in browser history, in the `Referer` of every subresource, and readable
 * by every third-party script on the page via `location.search`.
 *
 * The token is not a low-value one. It carries the requesting user's site
 * permissions (`edit-sessions.ts` expands them from `site_permissions`), it has
 * no origin binding and no device binding, and its IP check deliberately does
 * not reject — so the only thing that retires a leaked one is elapsed time.
 *
 * Secondary, same line: `site.domain` is stored with a scheme in some rows, so
 * the template yields `https://https://example.com?...`.
 *
 * These assert on the artifact the route hands to the browser, not on the
 * status code — the route answers 200 in every case here.
 *
 * FIXED in s76 (ADR 055). The three `test.failing` pins are plain tests: the
 * link is `https://<host>/#rcf_edit=<code>`, where the code is a 60-second,
 * single-use signed envelope naming this session and site — not the token —
 * and it rides in the fragment, which no browser sends to a server or puts in
 * a `Referer`. The signing key is set below because minting a code needs one.
 */

// Must precede the imports: editor-crypto memoises the signing key on first use.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";

import { POST } from "@/app/api/edit-sessions/create/route";
import { createClient } from "@/lib/supabase/server";
import { EditSessionManager } from "@/lib/auth/edit-sessions";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { EDIT_LINK_TTL_MS, readEditLinkCode } from "@/lib/auth/edit-link";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/auth/edit-sessions", () => ({
  EditSessionManager: { createEditSession: jest.fn() },
}));
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
// The fixture's owner holds a plan (s51). The owner-plan gate itself is
// proved in src/__tests__/api/edit-sessions/create-plan-gate.test.ts.
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: () => Promise.resolve({ ok: true, ownerId: "owner-1" }),
}));

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockCreateEditSession =
  EditSessionManager.createEditSession as jest.MockedFunction<
    typeof EditSessionManager.createEditSession
  >;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const USER_ID = "user-1";
const SITE_ID = "site-123";

/**
 * A realistic token: 48 random bytes, base64url — the shape
 * `EditSessionManager` mints. Long and opaque, which is exactly why it survives
 * intact in a log line.
 */
const TOKEN = "b3JOZXZlckd1ZXNzYWJsZVRva2VuVmFsdWVGb3JBVGVzdFN1aXRlMDAx";

function supabaseFor(domain: string) {
  return {
    auth: {
      getUser: jest
        .fn()
        .mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      // The requesting user's own `site_permissions` row, read since s51 so
      // only someone with access on the site is told about its plan.
      maybeSingle: jest.fn().mockResolvedValue({
        data: { permission: "admin" },
        error: null,
      }),
      single: jest.fn().mockResolvedValue({
        data: { id: SITE_ID, domain, name: "Example" },
        error: null,
      }),
    })),
  };
}

function createRequest(): NextRequest {
  return new NextRequest(
    "https://app.recopyfast.test/api/edit-sessions/create",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId: SITE_ID, permissions: ["edit"] }),
    },
  );
}

async function createSession(domain = "example.com") {
  mockCreateClient.mockResolvedValue(
    supabaseFor(domain) as unknown as Awaited<ReturnType<typeof createClient>>,
  );

  const response = await POST(createRequest());
  return response.json();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});

  mockEnforceRateLimit.mockResolvedValue(null);
  mockCreateEditSession.mockResolvedValue({
    id: "session-1",
    site_id: SITE_ID,
    user_id: USER_ID,
    token: TOKEN,
    permissions: ["edit"],
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
    created_at: new Date(),
  } as Awaited<ReturnType<typeof EditSessionManager.createEditSession>>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-29 — POST /api/edit-sessions/create", () => {
  it("returns the token in the response body", () => {
    // The control, and the reason removing it from `editUrl` costs nothing:
    // the caller is an authenticated dashboard request that already receives
    // the token over the response body, which is not logged, not in history,
    // and not readable from the customer's page.
    return createSession().then((body) => {
      expect(body.session.token).toBe(TOKEN);
    });
  });

  it("returns an editUrl at all", async () => {
    // Guard for the two assertions below. Both inspect `body.editUrl`; if the
    // route 401'd on the mocked auth, threw on the mocked rate limiter, or
    // returned no `editUrl`, `.not.toContain(...)` and `new URL(...)` would
    // throw and `test.failing` would call that a confirmed token leak. This
    // proves the happy path ran and produced a URL to inspect.
    const body = await createSession();

    expect(typeof body.editUrl).toBe("string");
    expect(() => new URL(body.editUrl)).not.toThrow();
  });

  it("does not put the token in editUrl", async () => {
    const body = await createSession();

    expect(body.editUrl).not.toContain(TOKEN);
  });

  it("exposes the editUrl's query string for inspection", () => {
    // Guard for the assertion below: it asserts an empty key list, and an
    // empty list is also what a URL that failed to parse would leave behind if
    // the parse were swallowed. This shows the parse works and the keys are
    // readable.
    return createSession().then((body) => {
      const url = new URL(body.editUrl);

      expect(Array.isArray([...url.searchParams.keys()])).toBe(true);
      expect(url.protocol).toBe("https:");
    });
  });

  it("does not put a credential in the query string at all", async () => {
    // Stated as a property of the URL rather than of one parameter name, so
    // renaming `rcf_edit_token` does not quietly satisfy it.
    const body = await createSession();
    const url = new URL(body.editUrl);

    expect([...url.searchParams.keys()]).toEqual([]);
  });

  it("still returns an editUrl when the domain carries a scheme", async () => {
    // Guard for the assertion below. A scheme-carrying domain is the unusual
    // fixture, so prove the route survives it and still answers before reading
    // the hostname it produced.
    const body = await createSession("https://example.com");

    expect(typeof body.editUrl).toBe("string");
    expect(body.editUrl.length).toBeGreaterThan(0);
  });

  it("builds a well-formed URL when the domain carries a scheme", async () => {
    // `sites.domain` is not normalised on every write, so rows holding
    // "https://example.com" produce "https://https://example.com?...".
    const body = await createSession("https://example.com");

    expect(new URL(body.editUrl).hostname).toBe("example.com");
  });

  it("carries, in its fragment, a short-lived code for this session and site", async () => {
    // What replaced the token: the widget sends this to its boot check, which
    // spends it once (validate-edit-link.test.ts) and answers the token.
    const before = Date.now();
    const body = await createSession();
    const url = new URL(body.editUrl);

    expect(url.pathname).toBe("/");
    expect(url.hash.startsWith("#rcf_edit=")).toBe(true);
    const claim = readEditLinkCode(url.hash.slice("#rcf_edit=".length));
    expect(claim).toMatchObject({ sessionId: "session-1", siteId: SITE_ID });
    expect(claim!.expiresAt.getTime()).toBeGreaterThan(before);
    expect(claim!.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + EDIT_LINK_TTL_MS,
    );
  });
});
