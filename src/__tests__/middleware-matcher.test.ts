/**
 * A-24 — what the widget script costs, and what it is still owed.
 *
 * `/embed/recopyfast.js` is a plain file in `public/`, fetched by every visitor
 * to every customer site that has installed the widget. The caller has no
 * session cookie and cannot have one: it is a third party on someone else's
 * domain. Two things must hold at once for that request.
 *
 * It must not reach GoTrue. This middleware runs on the Node runtime and awaits
 * `supabase.auth.getUser()`, so a session lookup here is a round trip per widget
 * load, on customers' traffic rather than ours, and it couples widget
 * availability to GoTrue's.
 *
 * It must still carry the security headers. It is executable JavaScript loaded
 * cross-origin onto other people's pages — the single response on this domain
 * that can least afford to be served without `X-Content-Type-Options: nosniff`.
 *
 * The two pull against each other, because `config.matcher` is the only lever
 * that skips the middleware and it skips the headers with it. So the paths stay
 * matched and the saving is made inside: `isSessionlessPath` short-circuits
 * before the Supabase client is constructed. This file pins both halves —
 * dropping either one is the regression.
 *
 * Deliberately a separate file from `src/__tests__/middleware.test.ts`. That
 * suite is about who gets redirected where once the auth block runs. This one
 * is about the paths that must never get that far.
 */

interface StubResponse {
  headers: Headers;
  cookies: { set: jest.Mock; getAll: () => never[] };
}

jest.mock("next/server", () => ({
  NextResponse: {
    next: (): StubResponse => ({
      headers: new Headers(),
      cookies: { set: jest.fn(), getAll: () => [] },
    }),
    redirect: () => {
      throw new Error("no path in this suite should redirect");
    },
  },
}));

const getUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser } })),
}));

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { config, middleware } from "@/middleware";

const asMock = (fn: unknown) => fn as jest.Mock;

/**
 * Compile the matcher the way Next itself does.
 *
 * `getPathMatch` is Next's own matcher compiler — the same helper the router
 * uses on the value exported from `config.matcher`. Using it rather than
 * hand-rolling `new RegExp(...)` means this test cannot drift from the runtime
 * by re-implementing the compilation step it is supposed to be checking.
 */
const matchers = ([] as string[])
  .concat(config.matcher as string | string[])
  .map((pattern) => getPathMatch(pattern));

function middlewareRuns(pathname: string): boolean {
  return matchers.some((match) => match(pathname) !== false);
}

/** The middleware reads `nextUrl` and the request cookies. Nothing else. */
function request(pathname: string): NextRequest {
  return {
    url: `https://app.test${pathname}`,
    nextUrl: new URL(pathname, "https://app.test"),
    cookies: { getAll: () => [], set: jest.fn() },
  } as unknown as NextRequest;
}

async function run(pathname: string): Promise<StubResponse> {
  return (await middleware(request(pathname))) as unknown as StubResponse;
}

/**
 * The files `public/embed/` serves today, plus a `.map` it does not, because
 * the rule under test is the directory and not the extension list: the next
 * asset type added there must not have to be rediscovered in production.
 */
const EMBED_ASSETS = [
  "/embed/recopyfast.js",
  "/embed/recopyfast.src.js",
  "/embed/recopyfast-secure.js",
  "/embed/socket.io-client.min.js",
  "/embed/recopyfast.js.map",
];

/** Crawler fetches. Same shape of caller: no session is possible. */
const CRAWLER_ASSETS = ["/robots.txt", "/sitemap.xml"];

const SESSIONLESS_PATHS = [...EMBED_ASSETS, ...CRAWLER_ASSETS];

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("middleware matcher", () => {
  it("runs on a page request", () => {
    // Guards every assertion below. If the compiled matcher matched nothing,
    // "the widget path is matched" would be the only claim left standing and it
    // would be true of a matcher that had stopped working entirely.
    expect(middlewareRuns("/dashboard")).toBe(true);
    expect(middlewareRuns("/dashboard/sites")).toBe(true);
  });

  it("skips the build output and image assets it lists", () => {
    expect(middlewareRuns("/_next/static/chunks/main.js")).toBe(false);
    expect(middlewareRuns("/_next/image")).toBe(false);
    expect(middlewareRuns("/favicon.ico")).toBe(false);
    expect(middlewareRuns("/logo.png")).toBe(false);
    expect(middlewareRuns("/icon.svg")).toBe(false);
  });

  it.each(SESSIONLESS_PATHS)(
    "keeps %s matched, so it can be given headers",
    (pathname) => {
      // Excluding these from the matcher is the tempting fix and the wrong one:
      // it skips the header block along with the session lookup.
      expect(middlewareRuns(pathname)).toBe(true);
    },
  );
});

describe("a request that cannot carry a session", () => {
  it.each(SESSIONLESS_PATHS)(
    "spends no GoTrue round trip on %s",
    async (pathname) => {
      await run(pathname);

      expect(asMock(createServerClient)).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it("does the round trip on an ordinary page, so the above means something", async () => {
    // Without this, `not.toHaveBeenCalled()` would also pass against a broken
    // mock that never wired up, or a middleware that had stopped calling
    // Supabase at all.
    await run("/pricing");

    expect(asMock(createServerClient)).toHaveBeenCalled();
    expect(getUser).toHaveBeenCalled();
  });

  it.each(SESSIONLESS_PATHS)(
    "is still served with nosniff: %s",
    async (pathname) => {
      const response = await run(pathname);

      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    },
  );

  it("carries the same header set an ordinary page gets", async () => {
    // Named individually rather than compared as a whole object so a header
    // added for pages but forgotten here shows up as its own failure.
    const widget = await run("/embed/recopyfast.js");
    const page = await run("/pricing");

    for (const header of [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ]) {
      expect([header, widget.headers.get(header)]).toEqual([
        header,
        page.headers.get(header),
      ]);
    }
  });
});
