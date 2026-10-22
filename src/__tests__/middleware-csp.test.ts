/**
 * s79 (s69 L1, ADR 059) — which policy each response gets, and what Next sees.
 *
 * Next stamps the nonce on its scripts from the REQUEST's
 * `Content-Security-Policy` header (`app-render.js`, `getScriptNonceFromHeader`),
 * not from the response's. A nonce that reaches only the response is a policy
 * that blocks every Next script on the page, so the property under test is
 * "the policy forwarded to Next is the policy sent to the browser", per
 * request — including on the path where Supabase refreshes the session cookie
 * and the forwarded request is rebuilt.
 *
 * `next/server` is stubbed, as in `middleware.test.ts`: the real module cannot
 * be loaded under jsdom. The stub records the init each `NextResponse.next`
 * call received — which is exactly what Next forwards.
 */

interface StubResponse {
  init: { request?: { headers?: Headers } } | undefined;
  headers: Headers;
  cookies: { set: jest.Mock; getAll: () => never[] };
}

const nextCalls: StubResponse[] = [];

jest.mock("next/server", () => ({
  NextResponse: {
    next: (init?: StubResponse["init"]) => {
      const response: StubResponse = {
        init,
        headers: new Headers(),
        cookies: { set: jest.fn(), getAll: () => [] },
      };
      nextCalls.push(response);
      return response;
    },
    redirect: (url: URL | string) => ({
      redirectedTo: new URL(url.toString()),
      headers: new Headers(),
      cookies: { set: jest.fn() },
    }),
  },
}));

type CookieWrite = { name: string; value: string; options: object };
let refreshCookies: CookieWrite[] = [];
const getUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(
    (
      _url: string,
      _key: string,
      options: { cookies: { setAll: (cookies: CookieWrite[]) => void } },
    ) => ({
      auth: {
        getUser: async () => {
          // What @supabase/ssr does when it rotates the session: setAll runs
          // during getUser, and the middleware rebuilds its response.
          if (refreshCookies.length > 0) options.cookies.setAll(refreshCookies);
          return getUser();
        },
      },
    }),
  ),
}));

jest.mock("@/lib/billing/effective-plan", () => ({
  resolveEntitlement: jest.fn(async () => ({
    kind: "plan",
    planId: "pro",
    plan: {},
  })),
  hasAnyEntitlement: () => true,
}));

import type { NextRequest } from "next/server";
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { buildContentSecurityPolicy } from "@/lib/security/content-security-policy";
import { middleware } from "@/middleware";

const env = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = env.NODE_ENV;

function request(
  pathname: string,
  headers: Record<string, string> = {},
): NextRequest {
  const url = new URL(pathname, "https://app.test") as URL & {
    clone: () => URL;
  };
  url.clone = () => new URL(url.toString());
  return {
    url: url.toString(),
    nextUrl: url,
    headers: new Headers({ "user-agent": "jest", ...headers }),
    cookies: { getAll: () => [], set: jest.fn() },
  } as unknown as NextRequest;
}

async function run(
  pathname: string,
  headers?: Record<string, string>,
): Promise<StubResponse> {
  return (await middleware(
    request(pathname, headers),
  )) as unknown as StubResponse;
}

function responsePolicy(response: StubResponse): string {
  const policy = response.headers.get("Content-Security-Policy");
  if (!policy) throw new Error("no Content-Security-Policy on the response");
  return policy;
}

function forwardedPolicy(response: StubResponse): string | null {
  return (
    response.init?.request?.headers?.get("content-security-policy") ?? null
  );
}

beforeEach(() => {
  nextCalls.length = 0;
  refreshCookies = [];
  getUser.mockResolvedValue({ data: { user: null } });
  env.NODE_ENV = "production";
});

afterAll(() => {
  env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("the app surface gets a per-request nonce", () => {
  it.each(["/login", "/signup", "/edit"])(
    "%s: the response and the request Next renders carry the same nonce policy",
    async (pathname) => {
      const response = await run(pathname);
      const policy = responsePolicy(response);
      const nonce = getScriptNonceFromHeader(policy);

      expect(nonce).toEqual(expect.any(String));
      expect(policy).toContain("'strict-dynamic'");
      expect(forwardedPolicy(response)).toBe(policy);
    },
  );

  it("a signed-in dashboard page too", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await run("/dashboard/sites");
    const policy = responsePolicy(response);

    expect(getScriptNonceFromHeader(policy)).toEqual(expect.any(String));
    expect(forwardedPolicy(response)).toBe(policy);
  });

  it("never reuses a nonce", async () => {
    const first = getScriptNonceFromHeader(responsePolicy(await run("/login")));
    const second = getScriptNonceFromHeader(
      responsePolicy(await run("/login")),
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("keeps the policy on the request when Supabase refreshes the session cookie", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    refreshCookies = [{ name: "sb-token", value: "rotated", options: {} }];

    const response = await run("/dashboard");

    // setAll rebuilt the response: the one returned is the second `next()`.
    expect(nextCalls.length).toBeGreaterThan(1);
    expect(response).toBe(nextCalls[nextCalls.length - 1]);
    expect(response.cookies.set).toHaveBeenCalledWith(
      "sb-token",
      "rotated",
      {},
    );
    expect(forwardedPolicy(response)).toBe(responsePolicy(response));
  });

  it("replaces a policy the caller sent, so a chosen nonce never reaches Next", async () => {
    const response = await run("/login", {
      "content-security-policy": "script-src 'nonce-chosen-by-caller'",
    });

    expect(forwardedPolicy(response)).toBe(responsePolicy(response));
    expect(getScriptNonceFromHeader(forwardedPolicy(response) ?? "")).not.toBe(
      "chosen-by-caller",
    );
  });
});

describe("the marketing surface keeps today's policy", () => {
  it.each(["/", "/pricing", "/compare/webflow-editor", "/embed/recopyfast.js"])(
    "%s",
    async (pathname) => {
      const response = await run(pathname);

      expect(responsePolicy(response)).toBe(
        buildContentSecurityPolicy({
          isDev: false,
          // ADR 073: DataFast's origin is on every page by default.
          dataFast: true,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
            NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
            NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
          },
        }),
      );
      expect(forwardedPolicy(response)).toBeNull();
    },
  );
});

/**
 * s107 (ADR 063) — Google's hosts are on the static policy of an allowlisted
 * marketing page with a configured measurement id, and nowhere else: not on
 * the app surface, not on account or auth pages, not on the API, not on the
 * widget or the /try runtime that run on third-party pages.
 */
describe("Google Analytics in the policy", () => {
  const savedId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const GTM = "https://www.googletagmanager.com";

  afterEach(() => {
    if (savedId === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = savedId;
  });

  it.each([
    "/",
    "/compare/webflow-editor",
    "/blog/some-post",
    "/try",
    "/privacy",
  ])("%s names Google's hosts when GA is configured", async (pathname) => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";

    const policy = responsePolicy(await run(pathname));

    // ADR 073: DataFast's origin follows Google's on every page.
    expect(policy).toContain(
      `script-src 'self' 'unsafe-inline' ${GTM} https://datafa.st;`,
    );
    expect(policy).toContain("https://*.google-analytics.com");
    expect(getScriptNonceFromHeader(policy)).toBeUndefined();
  });

  it.each([
    ["/dashboard", true],
    ["/dashboard/sites", true],
    ["/settings", true],
    ["/login", false],
    ["/signup", false],
    ["/edit", false],
    ["/auth/error", false],
    ["/api/pricing", false],
    ["/embed/recopyfast.js", false],
    ["/try/rcf-try.js", false],
    ["/analytics/gtag-init.js", false],
  ] as const)("%s never names Google's hosts", async (pathname, isSignedIn) => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
    getUser.mockResolvedValue({
      data: { user: isSignedIn ? { id: "user-1" } : null },
    });

    const policy = responsePolicy(await run(pathname));

    expect(policy).not.toContain("google");
  });

  it("a marketing page is unchanged when GA is not configured (every preview)", async () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

    expect(responsePolicy(await run("/"))).not.toContain("google");
  });

  it("a malformed id counts as not configured", async () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "UA-1234-1";

    expect(responsePolicy(await run("/"))).not.toContain("google");
  });
});

/**
 * ADR 073 — DataFast runs on every page, so its origin is on both policies:
 * the marketing pages and the nonce app surface where the signup funnel it
 * attributes lives. `NEXT_PUBLIC_DATAFAST_DISABLED=true` removes it everywhere.
 */
describe("DataFast in the policy", () => {
  const saved = process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
  const DF = "https://datafa.st";

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
    else process.env.NEXT_PUBLIC_DATAFAST_DISABLED = saved;
  });

  it.each([
    ["/", false],
    ["/compare/webflow-editor", false],
    ["/pricing", false],
    ["/signup", false],
    ["/login", false],
    ["/dashboard/sites", true],
  ] as const)(
    "%s allows datafa.st scripts and beacons",
    async (pathname, isSignedIn) => {
      delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
      getUser.mockResolvedValue({
        data: { user: isSignedIn ? { id: "user-1" } : null },
      });

      const response = await run(pathname);
      const policy = responsePolicy(response);
      const directive = (name: string) =>
        policy
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${name} `)) ?? "";

      expect(directive("script-src").split(" ")).toContain(DF);
      expect(directive("script-src-elem").split(" ")).toContain(DF);
      expect(directive("connect-src").split(" ")).toContain(DF);
      if (forwardedPolicy(response) !== null) {
        // The nonce surface: Next renders with the same policy it sends.
        expect(forwardedPolicy(response)).toBe(policy);
        expect(getScriptNonceFromHeader(policy)).toEqual(expect.any(String));
      }
    },
  );

  it.each(["/", "/signup", "/login"])(
    "%s names no datafa.st when NEXT_PUBLIC_DATAFAST_DISABLED=true",
    async (pathname) => {
      process.env.NEXT_PUBLIC_DATAFAST_DISABLED = "true";

      expect(responsePolicy(await run(pathname))).not.toContain("datafa.st");
    },
  );
});

describe("legacy headers", () => {
  // Signed in where the page needs it, signed out on /login — a signed-in
  // visit to /login is a redirect, which carries no headers by design.
  it.each([
    ["/", false],
    ["/login", false],
    ["/dashboard", true],
    ["/embed/recopyfast.js", false],
    ["/api/sites", true],
  ] as const)("%s sends no X-XSS-Protection", async (pathname, isSignedIn) => {
    getUser.mockResolvedValue({
      data: { user: isSignedIn ? { id: "user-1" } : null },
    });
    const response = await run(pathname);

    expect(response.headers.get("X-XSS-Protection")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
