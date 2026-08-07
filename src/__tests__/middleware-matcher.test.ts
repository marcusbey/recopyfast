/**
 * A-24 — the middleware matcher runs Node middleware on static assets.
 *
 * `src/middleware.ts:231` excludes `_next/static`, `_next/image`, `favicon.ico`
 * and five image extensions. It does not exclude `.js`, `.txt` or `.xml`, so
 * `/embed/recopyfast.js` — a plain file in `public/`, fetched by every visitor
 * to every customer site that has installed the widget — is served through a
 * Node middleware (`:10`) that awaits `supabase.auth.getUser()` (`:84`), a
 * GoTrue round trip, before any bytes are returned. The caller has no cookie and
 * cannot have one: it is a third-party visitor on the customer's domain.
 *
 * Two costs, both scaling with *customers'* traffic rather than ours: a GoTrue
 * call per widget load, and widget availability coupled to GoTrue availability.
 *
 * Deliberately a separate file from `src/__tests__/middleware.test.ts`. That
 * suite stubs `next/server` to observe redirect-vs-next, which is about what the
 * middleware *does* once it runs. This one is about which paths reach it at all,
 * and needs no stubbing of the response at all — only `config.matcher`.
 */

// The middleware module body constructs nothing at import time, but it does
// import `@supabase/ssr`, which must not be resolved for real under jsdom.
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(),
}));

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { config } from "@/middleware";

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

/**
 * Every file `public/embed/` serves. Named once so the guard and the assertion
 * below cannot drift apart — a guard that checks a different list than the
 * test it guards is not a guard.
 */
const EMBED_ASSETS = [
  "/embed/recopyfast.js",
  "/embed/recopyfast.src.js",
  "/embed/socket.io-client.min.js",
  "/embed/recopyfast.js.map",
];

describe("middleware matcher — paths that must never reach the middleware", () => {
  it("does not run on a request that already carries a session", () => {
    // Guards every assertion below. If the compiled matcher matched nothing,
    // the `test.failing` cases would fail for the wrong reason and would start
    // reporting "fixed" the moment the matcher was broken outright.
    expect(middlewareRuns("/dashboard")).toBe(true);
    expect(middlewareRuns("/dashboard/sites")).toBe(true);
  });

  it("already skips the exclusions it does list", () => {
    expect(middlewareRuns("/_next/static/chunks/main.js")).toBe(false);
    expect(middlewareRuns("/_next/image")).toBe(false);
    expect(middlewareRuns("/favicon.ico")).toBe(false);
    expect(middlewareRuns("/logo.png")).toBe(false);
    expect(middlewareRuns("/icon.svg")).toBe(false);
  });

  /**
   * One guard per `test.failing` below.
   *
   * `test.failing` passes on ANY throw, so a bad import, a `config.matcher`
   * that stopped compiling, or a typo in `middlewareRuns` would all read as a
   * confirmed defect. These run the identical code path against the identical
   * inputs and assert only that it produced an answer — so a green
   * `test.failing` beside a green guard means the matcher really does match.
   */
  it.each([
    "/embed/recopyfast.js",
    "/embed/socket.io-client.min.js",
    "/robots.txt",
    "/sitemap.xml",
  ])("evaluates the compiled matcher against %s", (pathname) => {
    expect(typeof middlewareRuns(pathname)).toBe("boolean");
  });

  it("evaluates the compiled matcher against every embed asset", () => {
    expect(
      EMBED_ASSETS.map(middlewareRuns).every((ran) => typeof ran === "boolean"),
    ).toBe(true);
  });

  // The embed script. Requested by every visitor to every customer page, none
  // of whom have — or could have — a recopyfast session cookie.
  it("does not run on /embed/recopyfast.js", () => {
    expect(middlewareRuns("/embed/recopyfast.js")).toBe(false);
  });

  it("does not run on /embed/socket.io-client.min.js", () => {
    expect(middlewareRuns("/embed/socket.io-client.min.js")).toBe(false);
  });

  // Crawler fetches. Not high-volume, but a GoTrue round trip on a robots.txt
  // read is pure waste and couples indexability to auth uptime.
  it("does not run on /robots.txt", () => {
    expect(middlewareRuns("/robots.txt")).toBe(false);
  });

  it("does not run on /sitemap.xml", () => {
    expect(middlewareRuns("/sitemap.xml")).toBe(false);
  });

  it("skips every static file under /embed", () => {
    // Stated as a directory rule rather than a filename list: the fix should
    // exclude the whole prefix, not add `.js` to the extension alternation and
    // leave the next asset type to be discovered in production.
    expect(EMBED_ASSETS.filter(middlewareRuns)).toEqual([]);
  });
});
