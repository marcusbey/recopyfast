/**
 * @jest-environment node
 */

/**
 * s84 review, F1 (critical) — the tunnel guard sees every path the tunnel
 * rewrite accepts, as Next itself compiles that rewrite.
 *
 * The guard first compared `pathname === "/monitoring"`. Sentry's rewrite has
 * source `/monitoring(/?)`, and Next compiles custom routes case-insensitively
 * with an optional trailing slash: the built `routes-manifest.json` says
 * `caseSensitive: false` and `^/monitoring(/?)(?:/)?$`, which is also what
 * Vercel routes by. So `POST /MONITORING?o=1&p=1` skipped the guard and was
 * relayed to a stranger's Sentry project — proved on a production build.
 *
 * A list of spellings someone thought of is how that happened. This file asks
 * Next instead: the real next.config (wrapped by the real `withSentryConfig`)
 * goes through Next's own `loadCustomRoutes` and `buildCustomRoute` — the
 * functions `next build` uses to write the routes manifest — and every
 * candidate path the resulting regexes accept, raw or percent-decoded, is sent
 * through the real middleware with a foreign destination. Each must get the
 * guard's 400. If a Sentry or Next upgrade changes the rewrite's source, its
 * phase or how it is compiled, this file follows the change; a guard keyed to
 * the old spelling goes red here.
 *
 * Matching is compiled with the `i` flag whatever the config says: `next
 * start` matches `beforeFiles` rewrites case-insensitively unconditionally,
 * and `afterFiles` per `experimental.caseSensitiveRoutes` (unset here). The
 * guard must cover the most permissive of them. Decoded paths are counted as
 * accepted because, while `next start` matches the raw path (a
 * percent-encoded letter 404s), how Vercel's edge treats one is not
 * inspectable from here.
 */

interface StubResponse {
  kind: "next" | "json";
  status: number;
  body?: unknown;
  headers: Headers;
  cookies: { set: jest.Mock; getAll: () => never[] };
}

jest.mock("next/server", () => ({
  NextResponse: {
    next: (): StubResponse => ({
      kind: "next",
      status: 200,
      headers: new Headers(),
      cookies: { set: jest.fn(), getAll: () => [] },
    }),
    json: (body: unknown, init?: { status?: number }): StubResponse => ({
      kind: "json",
      status: init?.status ?? 200,
      body,
      headers: new Headers(),
      cookies: { set: jest.fn(), getAll: () => [] },
    }),
    redirect: () => {
      throw new Error("the tunnel never redirects");
    },
  },
}));

const getUser = jest.fn(async () => ({ data: { user: null } }));

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser } })),
}));

import type { NextConfig } from "next";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import loadCustomRoutes from "next/dist/lib/load-custom-routes";
import { SENTRY_TUNNEL_ROUTE } from "@/lib/monitoring/sentry-tunnel";
import { middleware } from "@/middleware";

const DSN =
  "https://abc123publickey@o4507000000000001.ingest.us.sentry.io/4507000000000002";
const FOREIGN_QUERY = "o=1&p=1";
const FOREIGN_ENVELOPE = `${JSON.stringify({
  dsn: "https://key@o1.ingest.sentry.io/1",
})}\n{"type":"event"}\n{}`;

const env = process.env as Record<string, string | undefined>;
const original = {
  NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN,
  __SENTRY_TUNNEL_ROUTE__: env.__SENTRY_TUNNEL_ROUTE__,
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete env[name];
  else env[name] = value;
}

/** The tunnel rewrites, compiled exactly as `next build` writes them. */
async function compiledTunnelRewrites(): Promise<RegExp[]> {
  setEnv("__SENTRY_TUNNEL_ROUTE__", undefined);
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});

  let config: NextConfig | undefined;
  await jest.isolateModulesAsync(async () => {
    config = (await import("../../next.config")).default;
  });
  const routes = await loadCustomRoutes(
    config as Parameters<typeof loadCustomRoutes>[0],
  );
  const { beforeFiles, afterFiles, fallback } = routes.rewrites;

  return [...beforeFiles, ...afterFiles, ...fallback]
    .filter((rule) => rule.destination.includes("/envelope/"))
    .map((rule) => new RegExp(buildCustomRoute("rewrite", rule).regex, "i"));
}

function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

const WORD = SENTRY_TUNNEL_ROUTE.slice(1);

/** Every upper/lower-case spelling of the tunnel's path segment. */
function caseVariants(word: string): string[] {
  return Array.from({ length: 2 ** word.length }, (_, mask) =>
    [...word]
      .map((char, index) =>
        mask & (1 << index) ? char.toUpperCase() : char.toLowerCase(),
      )
      .join(""),
  );
}

function percentEncoded(char: string, isUpperHex: boolean): string {
  const hex = char.charCodeAt(0).toString(16);
  return `%${isUpperHex ? hex.toUpperCase() : hex}`;
}

/** One letter percent-encoded at each position, both cases, both hex cases. */
function encodedVariants(word: string): string[] {
  const variants: string[] = [];
  for (const base of [word.toLowerCase(), word.toUpperCase()]) {
    for (const isUpperHex of [true, false]) {
      for (let index = 0; index < base.length; index += 1) {
        variants.push(
          base.slice(0, index) +
            percentEncoded(base[index], isUpperHex) +
            base.slice(index + 1),
        );
      }
      variants.push(
        [...base].map((char) => percentEncoded(char, isUpperHex)).join(""),
      );
    }
  }
  return variants;
}

function candidatePaths(): string[] {
  const segments = [...caseVariants(WORD), ...encodedVariants(WORD)];
  const paths = segments.flatMap((segment) => [
    `/${segment}`,
    `/${segment}/`,
    `/${segment}%2F`,
  ]);
  return [
    ...paths,
    // Near misses: not the tunnel, whatever the case.
    `/${WORD}/x`,
    `/${WORD}x`,
    `/x${WORD}`,
    `/${WORD.slice(0, -1)}`,
    `/api/${WORD}`,
    `/${WORD}.js`,
  ];
}

function tunnelRequest(pathname: string): NextRequest {
  const url = `https://www.recopyfa.st${pathname}?${FOREIGN_QUERY}`;
  return {
    url,
    method: "POST",
    nextUrl: new URL(url),
    cookies: { getAll: () => [], set: jest.fn() },
    text: async () => FOREIGN_ENVELOPE,
  } as unknown as NextRequest;
}

async function isRefusedByGuard(pathname: string): Promise<boolean> {
  jest.mocked(createServerClient).mockClear();
  const response = (await middleware(
    tunnelRequest(pathname),
  )) as unknown as StubResponse;
  return (
    response.kind === "json" &&
    response.status === 400 &&
    jest.mocked(createServerClient).mock.calls.length === 0
  );
}

let accepted: string[];
let notAccepted: string[];

beforeAll(async () => {
  setEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  const rewrites = await compiledTunnelRewrites();
  const accepts = (pathname: string) =>
    rewrites.some((re) => re.test(pathname) || re.test(decoded(pathname)));

  const candidates = candidatePaths();
  accepted = candidates.filter(accepts);
  notAccepted = candidates.filter((pathname) => !accepts(pathname));
});

afterAll(() => {
  for (const [name, value] of Object.entries(original)) setEnv(name, value);
  jest.restoreAllMocks();
});

describe("the Sentry tunnel guard against Next's own compiled rewrite", () => {
  it("finds the tunnel rewrite, and Next accepts it in any case (the F1 fact)", () => {
    // If this fails, the rewrite or its compilation changed: re-read
    // `withSentryConfig/tunnel.js` and Next's `buildCustomRoute` before
    // trusting anything else in this file.
    expect(accepted).toEqual(
      expect.arrayContaining([
        SENTRY_TUNNEL_ROUTE,
        "/MONITORING",
        "/Monitoring/",
        "/%6Donitoring",
      ]),
    );
    expect(accepted.length).toBeGreaterThanOrEqual(2 ** WORD.length * 2);
  });

  it("refuses a foreign destination on every path the rewrite accepts", async () => {
    const bypasses: string[] = [];
    for (const pathname of accepted) {
      if (!(await isRefusedByGuard(pathname))) bypasses.push(pathname);
    }

    expect(bypasses).toEqual([]);
  });

  it("leaves every path the rewrite does not accept to the normal middleware", async () => {
    expect(notAccepted.length).toBeGreaterThan(0);
    const swallowed: string[] = [];
    for (const pathname of notAccepted) {
      if (await isRefusedByGuard(pathname)) swallowed.push(pathname);
    }

    expect(swallowed).toEqual([]);
  });
});
