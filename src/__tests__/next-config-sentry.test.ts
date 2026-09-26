/**
 * @jest-environment node
 */

/**
 * s46 — the browser's Sentry events leave through this app's own origin.
 *
 * `tunnelRoute` makes `withSentryConfig` add a rewrite from a same-origin path
 * to Sentry's ingest, and hand that path to the browser SDK through
 * `nextConfig.env`. The browser then posts to `'self'`, which the CSP already
 * allows, and ad blockers keyed on `sentry.io` never see the request.
 *
 * The real `withSentryConfig` runs here, not a stub: what matters is the config
 * Next receives, and a stub would only prove we passed an option to it.
 */

import type { NextConfig } from "next";

const DSN = "https://s46dummypublickey@o0.ingest.sentry.io/0";

const env = process.env as Record<string, string | undefined>;
const original = {
  NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN,
  // `withSentryConfig` memoises the resolved tunnel path in this variable for
  // the rest of the process; left set, it would leak from one case to the next.
  __SENTRY_TUNNEL_ROUTE__: env.__SENTRY_TUNNEL_ROUTE__,
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

interface RewriteRule {
  source: string;
  destination: string;
  has?: Array<{ type: string; key: string; value?: string }>;
}

async function loadConfig(dsn: string | undefined): Promise<NextConfig> {
  setEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  setEnv("__SENTRY_TUNNEL_ROUTE__", undefined);
  jest.resetModules();
  // Sentry's build-time warnings (deprecated options, missing auth token) are
  // expected here and are not what this suite is about.
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});

  return (await import("../../next.config")).default;
}

async function rewritesOf(config: NextConfig): Promise<RewriteRule[]> {
  const rewrites = await config.rewrites?.();
  if (!rewrites) return [];
  if (Array.isArray(rewrites)) return rewrites as RewriteRule[];
  return [
    ...(rewrites.beforeFiles ?? []),
    ...(rewrites.afterFiles ?? []),
    ...(rewrites.fallback ?? []),
  ] as RewriteRule[];
}

afterEach(() => {
  for (const [name, value] of Object.entries(original)) setEnv(name, value);
  jest.restoreAllMocks();
});

describe("next.config with a Sentry DSN", () => {
  it("rewrites /monitoring to Sentry's envelope endpoint", async () => {
    const rules = await rewritesOf(await loadConfig(DSN));
    const tunnel = rules.filter((rule) => rule.source === "/monitoring(/?)");

    expect(tunnel.length).toBeGreaterThan(0);
    for (const rule of tunnel) {
      expect(rule.destination).toMatch(
        /^https:\/\/o:orgid\.ingest\.(:region\.)?sentry\.io\/api\/:projectid\/envelope\//,
      );
      expect(rule.has?.map((condition) => condition.key)).toEqual(
        expect.arrayContaining(["o", "p"]),
      );
    }
  });

  it("tells the browser SDK to post to /monitoring", async () => {
    // The client reads `process.env._sentryRewritesTunnelPath`; without it the
    // SDK posts straight to sentry.io and the rewrite above is never used.
    const config = await loadConfig(DSN);

    expect(config.env?._sentryRewritesTunnelPath).toBe("/monitoring");
  });

  it("keeps the /pricing redirect through the wrap", async () => {
    const config = await loadConfig(DSN);
    const redirects = (await config.redirects?.()) ?? [];

    expect(redirects).toContainEqual({
      source: "/pricing",
      destination: "/#pricing",
      permanent: true,
    });
  });
});

describe("next.config without a Sentry DSN", () => {
  it("is not wrapped, so there is no tunnel to rewrite", async () => {
    // CI builds without a DSN; the wrap, and with it the tunnel, is skipped.
    const config = await loadConfig(undefined);

    expect(await rewritesOf(config)).toEqual([]);
    expect(config.env?._sentryRewritesTunnelPath).toBeUndefined();
  });
});
