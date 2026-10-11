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
  VERCEL_GIT_COMMIT_SHA: env.VERCEL_GIT_COMMIT_SHA,
  GITHUB_SHA: env.GITHUB_SHA,
  SENTRY_RELEASE: env.SENTRY_RELEASE,
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

describe("next.config and the Sentry release (s84)", () => {
  it("gives every runtime and the source maps one release: the build's commit SHA", async () => {
    // A stray CI variable must not win: the SDK's own detection reads
    // SENTRY_RELEASE and GITHUB_SHA before VERCEL_GIT_COMMIT_SHA, so a build
    // run inside GitHub Actions would otherwise name the release after a
    // different commit than the one Vercel deployed.
    setEnv("VERCEL_GIT_COMMIT_SHA", "8f2c1e0d9b7a");
    setEnv("GITHUB_SHA", "stray-ci-sha");
    setEnv("SENTRY_RELEASE", undefined);

    const config = await loadConfig(DSN);

    // What browser, server and edge inits read (inlined by Next)...
    expect(config.env?.NEXT_PUBLIC_SENTRY_RELEASE).toBe("8f2c1e0d9b7a");
    // ...and what the SDK itself resolved, used for the source-map upload.
    expect(config.env?._sentryRelease).toBe("8f2c1e0d9b7a");
  });

  it("inlines no release when the build has no commit SHA, so the SDK keeps its own", async () => {
    setEnv("VERCEL_GIT_COMMIT_SHA", undefined);

    const config = await loadConfig(DSN);

    expect(config.env).not.toHaveProperty("NEXT_PUBLIC_SENTRY_RELEASE");
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
