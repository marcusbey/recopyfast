/**
 * s84 — `/monitoring` forwards our browser's Sentry envelopes, and nobody
 * else's.
 *
 * `tunnelRoute` (next.config.ts) makes `@sentry/nextjs` add a rewrite from
 * `/monitoring?o=<org>&p=<project>[&r=<region>]` to
 * `https://o<org>.ingest[.<region>].sentry.io/api/<project>/envelope/`, for
 * ANY digits. The destination is read from the query string alone, so until
 * s84 this origin relayed envelopes to every Sentry SaaS project in existence:
 * anyone could launder traffic for their own project through
 * www.recopyfa.st, past ad blockers and IP reputation, on our bandwidth.
 *
 * The middleware runs before that rewrite, so that is where the allow-list
 * lives: the query must name exactly our DSN's org, project and region — that
 * is what decides where the bytes go — and the envelope's own header must name
 * our DSN's host and project. Anything else is a 400, still carrying the
 * security headers, still costing no GoTrue round trip.
 *
 * `next/server` is stubbed the way `middleware-matcher.test.ts` does it: the
 * real module cannot load under jsdom, and what this file asserts is which
 * response the middleware asked for.
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

const getUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser } })),
}));

import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SENTRY_TUNNEL_ROUTE } from "@/lib/monitoring/sentry-tunnel";
import { middleware } from "@/middleware";

const ORG = "4507000000000001";
const PROJECT = "4507000000000002";
const OUR_HOST = `o${ORG}.ingest.us.sentry.io`;
const OUR_DSN = `https://abc123publickey@${OUR_HOST}/${PROJECT}`;
const OUR_QUERY = `o=${ORG}&p=${PROJECT}&r=us`;

const env = process.env as Record<string, string | undefined>;
const savedDsn = env.NEXT_PUBLIC_SENTRY_DSN;

/** A browser SDK envelope: header line, item header, payload. `null`: no DSN. */
function envelope(dsn: string | null = OUR_DSN): string {
  const header = JSON.stringify({
    event_id: "9ec79c33ec9942ab8353589fcb2e04dc",
    sent_at: "2026-10-09T12:00:00.000Z",
    sdk: { name: "sentry.javascript.nextjs", version: "10.58.0" },
    ...(dsn === null ? {} : { dsn }),
  });
  return `${header}\n{"type":"event"}\n{"message":"boom"}`;
}

function tunnelRequest(
  query: string,
  body: string,
  method = "POST",
  pathname = SENTRY_TUNNEL_ROUTE,
): NextRequest {
  // `new URL` keeps a percent-encoded letter encoded, as NextURL does: the
  // middleware sees `/%6Donitoring`, not `/monitoring`.
  const url = `https://www.recopyfa.st${pathname}?${query}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    cookies: { getAll: () => [], set: jest.fn() },
    text: async () => body,
  } as unknown as NextRequest;
}

async function send(request: NextRequest): Promise<StubResponse> {
  return (await middleware(request)) as unknown as StubResponse;
}

beforeEach(() => {
  jest.clearAllMocks();
  env.NEXT_PUBLIC_SENTRY_DSN = OUR_DSN;
});

afterAll(() => {
  if (savedDsn === undefined) delete env.NEXT_PUBLIC_SENTRY_DSN;
  else env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
});

describe("the Sentry tunnel allow-list", () => {
  it("forwards our own browser's envelope (control)", async () => {
    const response = await send(tunnelRequest(OUR_QUERY, envelope()));

    expect(response.kind).toBe("next");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(asMock(createServerClient)).not.toHaveBeenCalled();
  });

  const refused: Array<[string, () => NextRequest]> = [
    [
      "another org in the query",
      () => tunnelRequest(`o=1&p=${PROJECT}&r=us`, envelope()),
    ],
    [
      "another project in the query",
      () => tunnelRequest(`o=${ORG}&p=1&r=us`, envelope()),
    ],
    [
      "another region in the query",
      () => tunnelRequest(`o=${ORG}&p=${PROJECT}&r=de`, envelope()),
    ],
    [
      "no region when our DSN has one",
      () => tunnelRequest(`o=${ORG}&p=${PROJECT}`, envelope()),
    ],
    [
      "a duplicated org parameter",
      () => tunnelRequest(`o=${ORG}&o=1&p=${PROJECT}&r=us`, envelope()),
    ],
    [
      "a duplicated project parameter",
      () => tunnelRequest(`o=${ORG}&p=${PROJECT}&p=1&r=us`, envelope()),
    ],
    [
      "an envelope for another project of our org",
      () =>
        tunnelRequest(
          OUR_QUERY,
          envelope(`https://abc123publickey@${OUR_HOST}/1`),
        ),
    ],
    [
      "an envelope for another host",
      () =>
        tunnelRequest(
          OUR_QUERY,
          envelope(`https://key@o1.ingest.us.sentry.io/${PROJECT}`),
        ),
    ],
    [
      "an envelope header with no DSN",
      () => tunnelRequest(OUR_QUERY, envelope(null)),
    ],
    [
      "an envelope header that is not JSON",
      () => tunnelRequest(OUR_QUERY, `not json\n{"type":"event"}\n{}`),
    ],
    ["an empty body", () => tunnelRequest(OUR_QUERY, "")],
    [
      "a header line over 16 KiB",
      () =>
        tunnelRequest(
          OUR_QUERY,
          `{"dsn":"${OUR_DSN}","pad":"${"x".repeat(17 * 1024)}"}\n{}\n{}`,
        ),
    ],
    ["a GET", () => tunnelRequest(OUR_QUERY, envelope(), "GET")],
  ];

  it.each(refused)("answers 400 to %s", async (_label, build) => {
    const response = await send(build());

    expect(response.kind).toBe("json");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid tunnel request" });
    // Still served like every other path here: headers on, no session work.
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(asMock(createServerClient)).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("refuses everything when no DSN is configured", async () => {
    // No DSN: next.config.ts does not wrap with Sentry, so there is no
    // legitimate envelope to forward — and nothing to allow-list against.
    delete env.NEXT_PUBLIC_SENTRY_DSN;

    const response = await send(tunnelRequest(OUR_QUERY, envelope()));

    expect(response.status).toBe(400);
  });

  describe("under every spelling the rewrite accepts", () => {
    // s84 review, F1 (critical). The guard compared `pathname === "/monitoring"`
    // while Next compiles the tunnel rewrite case-insensitively, with an
    // optional trailing slash (`routes-manifest.json`: `caseSensitive: false`,
    // regex `^/monitoring(/?)(?:/)?$` — the same manifest Vercel routes by).
    // On a production build, `POST /MONITORING?o=1&p=1` with a foreign
    // envelope was relayed to Sentry: the open relay this story closes was
    // one Shift key away. Percent-encoded letters are covered too: `next
    // start` matches the raw path (they 404), but which form Vercel's edge
    // matches is not inspectable from here, so the guard decodes as well.
    // Every spelling below is proved against Next's own route compiler in
    // `sentry-tunnel-route-coverage.test.ts`.
    const FOREIGN_QUERY = "o=1&p=1";
    const FOREIGN_ENVELOPE = envelope("https://key@o1.ingest.sentry.io/1");

    it.each([
      "/MONITORING",
      "/Monitoring",
      "/monitorinG",
      "/MONITORING/",
      "/monitoring/",
      "/%6Donitoring",
      "/%4Donitoring",
      "/m%6fnitoring",
      "/%6D%6F%6E%69%74%6F%72%69%6E%67",
      "/monitoring%2F",
    ])("answers 400 to a foreign envelope on %s", async (pathname) => {
      const response = await send(
        tunnelRequest(FOREIGN_QUERY, FOREIGN_ENVELOPE, "POST", pathname),
      );

      expect(response.kind).toBe("json");
      expect(response.status).toBe(400);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(asMock(createServerClient)).not.toHaveBeenCalled();
    });

    it("forwards our own envelope on another spelling, with no session lookup", async () => {
      // The rewrite forwards `/Monitoring` like `/monitoring`, so it is the
      // tunnel for `isSessionlessPath` too: no GoTrue round trip, and no
      // rotated session cookie on Sentry's response.
      const response = await send(
        tunnelRequest(OUR_QUERY, envelope(), "POST", "/Monitoring"),
      );

      expect(response.kind).toBe("next");
      expect(asMock(createServerClient)).not.toHaveBeenCalled();
    });

    it.each(["/monitoring/x", "/monitoringx", "/xmonitoring", "/monitorin"])(
      "leaves %s alone: the rewrite does not accept it",
      async (pathname) => {
        getUser.mockResolvedValue({ data: { user: null } });

        const response = await send(
          tunnelRequest(FOREIGN_QUERY, FOREIGN_ENVELOPE, "POST", pathname),
        );

        expect(response.kind).toBe("next");
        expect(getUser).toHaveBeenCalled();
      },
    );
  });

  describe("with a DSN that names no region", () => {
    const NO_REGION_DSN = `https://key@o${ORG}.ingest.sentry.io/${PROJECT}`;

    beforeEach(() => {
      env.NEXT_PUBLIC_SENTRY_DSN = NO_REGION_DSN;
    });

    it("forwards a query with no region", async () => {
      const response = await send(
        tunnelRequest(`o=${ORG}&p=${PROJECT}`, envelope(NO_REGION_DSN)),
      );

      expect(response.kind).toBe("next");
    });

    it("refuses a query that adds one", async () => {
      // The rewrite with `r` routes to `o<org>.ingest.<r>.sentry.io`: a region
      // our DSN does not name is another host.
      const response = await send(
        tunnelRequest(`o=${ORG}&p=${PROJECT}&r=us`, envelope(NO_REGION_DSN)),
      );

      expect(response.status).toBe(400);
    });
  });
});

function asMock(fn: unknown): jest.Mock {
  return fn as jest.Mock;
}
