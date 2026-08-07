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
 */

import { NextRequest } from "next/server";

import { POST } from "@/app/api/edit-sessions/create/route";
import { createClient } from "@/lib/supabase/server";
import { EditSessionManager } from "@/lib/auth/edit-sessions";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/auth/edit-sessions", () => ({
  EditSessionManager: { createEditSession: jest.fn() },
}));
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

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

  test.failing("does not put the token in editUrl", async () => {
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

  test.failing(
    "does not put a credential in the query string at all",
    async () => {
      // Stated as a property of the URL rather than of one parameter name, so
      // renaming `rcf_edit_token` does not quietly satisfy it.
      const body = await createSession();
      const url = new URL(body.editUrl);

      expect([...url.searchParams.keys()]).toEqual([]);
    },
  );

  it("still returns an editUrl when the domain carries a scheme", async () => {
    // Guard for the assertion below. A scheme-carrying domain is the unusual
    // fixture, so prove the route survives it and still answers before reading
    // the hostname it produced.
    const body = await createSession("https://example.com");

    expect(typeof body.editUrl).toBe("string");
    expect(body.editUrl.length).toBeGreaterThan(0);
  });

  test.failing(
    "builds a well-formed URL when the domain carries a scheme",
    async () => {
      // `sites.domain` is not normalised on every write, so rows holding
      // "https://example.com" produce "https://https://example.com?...".
      const body = await createSession("https://example.com");

      expect(new URL(body.editUrl).hostname).toBe("example.com");
    },
  );
});
