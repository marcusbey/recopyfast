/**
 * @jest-environment node
 */

/**
 * s79 (s69 L1, ADR 059) — the two Content Security Policies.
 *
 * Production sent `script-src 'self' 'unsafe-inline'` on every page, so an
 * injected inline script ran on the dashboard, which renders text scraped off
 * customers' pages. The app surface now gets a per-request nonce with
 * `'strict-dynamic'`; the static marketing surface keeps the old policy,
 * because a prerendered page has no nonce and would not hydrate under one
 * (measured: docs/research/s79-headers-csp-ws.md).
 *
 * The nonce assertions go through Next's own `getScriptNonceFromHeader`, the
 * function that decides which nonce Next stamps on its scripts — so "Next will
 * find our nonce" is checked against Next, not against a copy of its regex.
 */

import { createHash } from "node:crypto";
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { THEME_STORAGE_KEY } from "@/hooks/useTheme";
import {
  NONCE_POLICY_PATH_PREFIXES,
  THEME_INIT_SCRIPT_HASH,
  buildContentSecurityPolicy,
  createCspNonce,
  usesNoncePolicy,
} from "@/lib/security/content-security-policy";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-init-script";

/** `"a b; c d"` → `{ a: "b", c: "d" }`, one entry per directive. */
function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources.join(" ")];
      }),
  );
}

const NONCE = "bm9uY2UtdmFsdWUtMTIzNA==";

/** Today's production policy, byte for byte, with no env-derived origins. */
const STATIC_PRODUCTION_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-elem 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' https:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

describe("the static (marketing) policy", () => {
  it("is exactly today's production policy", () => {
    expect(buildContentSecurityPolicy({ isDev: false, env: {} })).toBe(
      STATIC_PRODUCTION_POLICY,
    );
  });

  it("carries no nonce, no hash and no 'strict-dynamic' — any would void 'unsafe-inline'", () => {
    const policy = buildContentSecurityPolicy({ isDev: false, env: {} });

    expect(policy).not.toMatch(/'nonce-/);
    expect(policy).not.toMatch(/'sha256-/);
    expect(policy).not.toContain("'strict-dynamic'");
    expect(getScriptNonceFromHeader(policy)).toBeUndefined();
  });

  it("keeps 'unsafe-eval' for development only", () => {
    const dev = directives(
      buildContentSecurityPolicy({ isDev: true, env: {} }),
    );

    expect(dev["script-src"]).toBe("'self' 'unsafe-inline' 'unsafe-eval'");
    expect(dev["script-src-elem"]).toBe(dev["script-src"]);
  });
});

describe("the nonce (app surface) policy", () => {
  const SCRIPT_SOURCES = `'nonce-${NONCE}' 'strict-dynamic' ${THEME_INIT_SCRIPT_HASH} 'self' 'unsafe-inline'`;

  it("allows scripts by nonce and trust propagation, with the CSP1/CSP2 fallback last", () => {
    const policy = directives(
      buildContentSecurityPolicy({ nonce: NONCE, isDev: false, env: {} }),
    );

    expect(policy["script-src"]).toBe(SCRIPT_SOURCES);
    expect(policy["script-src-elem"]).toBe(SCRIPT_SOURCES);
  });

  it("adds 'unsafe-eval' in development only", () => {
    const policy = directives(
      buildContentSecurityPolicy({ nonce: NONCE, isDev: true, env: {} }),
    );

    expect(policy["script-src"]).toBe(`${SCRIPT_SOURCES} 'unsafe-eval'`);
  });

  it("is the nonce Next extracts from it", () => {
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      isDev: false,
      env: {},
    });

    expect(getScriptNonceFromHeader(policy)).toBe(NONCE);
  });

  it("changes nothing but the script directives", () => {
    const withNonce = directives(
      buildContentSecurityPolicy({ nonce: NONCE, isDev: false, env: {} }),
    );
    const withoutNonce = directives(
      buildContentSecurityPolicy({ isDev: false, env: {} }),
    );

    for (const name of Object.keys(withoutNonce)) {
      if (name === "script-src" || name === "script-src-elem") continue;
      expect([name, withNonce[name]]).toEqual([name, withoutNonce[name]]);
    }
    expect(Object.keys(withNonce)).toEqual(Object.keys(withoutNonce));
  });
});

/**
 * s107 (ADR 063) — Google Analytics on the static marketing policy, and only
 * there. The middleware sets `analytics` only for an allowlisted marketing
 * path with a configured measurement id; the builder still refuses it under a
 * nonce, so the app surface can never carry Google's hosts.
 */
describe("Google Analytics sources", () => {
  const GTM = "https://www.googletagmanager.com";

  it("adds exactly what GA4 needs to the static policy", () => {
    const policy = directives(
      buildContentSecurityPolicy({ isDev: false, env: {}, analytics: true }),
    );

    expect(policy["script-src"]).toBe(`'self' 'unsafe-inline' ${GTM}`);
    expect(policy["script-src-elem"]).toBe(policy["script-src"]);
    expect(policy["connect-src"]).toBe(
      "'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    );
    expect(policy["img-src"]).toBe(
      "'self' data: https: https://*.google-analytics.com https://*.googletagmanager.com",
    );
  });

  it("changes nothing but script, connect and img sources", () => {
    const withGa = directives(
      buildContentSecurityPolicy({ isDev: false, env: {}, analytics: true }),
    );
    const without = directives(
      buildContentSecurityPolicy({ isDev: false, env: {} }),
    );

    expect(Object.keys(withGa)).toEqual(Object.keys(without));
    for (const name of Object.keys(without)) {
      if (
        ["script-src", "script-src-elem", "connect-src", "img-src"].includes(
          name,
        )
      ) {
        continue;
      }
      expect([name, withGa[name]]).toEqual([name, without[name]]);
    }
  });

  it("keeps the env-derived origins and appends Google's after them", () => {
    const connect = directives(
      buildContentSecurityPolicy({
        isDev: false,
        env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" },
        analytics: true,
      }),
    )["connect-src"].split(" ");

    expect(connect.slice(0, 3)).toEqual([
      "'self'",
      "https://project.supabase.co",
      "wss://project.supabase.co",
    ]);
    expect(connect).toContain("https://*.google-analytics.com");
  });

  it("is still nonce-free, so 'unsafe-inline' keeps working for prerendered pages", () => {
    const policy = buildContentSecurityPolicy({
      isDev: false,
      env: {},
      analytics: true,
    });

    expect(policy).not.toMatch(/'nonce-|'sha256-|'strict-dynamic'/);
  });

  it("never reaches the nonce (app) policy, even when asked", () => {
    expect(
      buildContentSecurityPolicy({
        nonce: NONCE,
        isDev: false,
        env: {},
        analytics: true,
      }),
    ).toBe(buildContentSecurityPolicy({ nonce: NONCE, isDev: false, env: {} }));
  });
});

/**
 * ADR 073 — DataFast on every page. Unlike GA, its origin reaches BOTH
 * policies: the signup funnel it attributes lives on the nonce surface.
 */
describe("DataFast sources", () => {
  const DF = "https://datafa.st";

  it("adds datafa.st to script-src and connect-src of the static policy", () => {
    const policy = directives(
      buildContentSecurityPolicy({ isDev: false, env: {}, dataFast: true }),
    );

    expect(policy["script-src"]).toBe(`'self' 'unsafe-inline' ${DF}`);
    expect(policy["script-src-elem"]).toBe(policy["script-src"]);
    expect(policy["connect-src"]).toBe(`'self' ${DF}`);
  });

  it("adds datafa.st to the nonce policy too, after the nonce sources", () => {
    const policy = directives(
      buildContentSecurityPolicy({
        nonce: NONCE,
        isDev: false,
        env: {},
        dataFast: true,
      }),
    );

    expect(policy["script-src"]).toBe(
      `'nonce-${NONCE}' 'strict-dynamic' ${THEME_INIT_SCRIPT_HASH} 'self' 'unsafe-inline' ${DF}`,
    );
    expect(policy["script-src-elem"]).toBe(policy["script-src"]);
    expect(policy["connect-src"]).toBe(`'self' ${DF}`);
  });

  it("keeps the nonce Next extracts, and the static policy nonce-free", () => {
    expect(
      getScriptNonceFromHeader(
        buildContentSecurityPolicy({
          nonce: NONCE,
          isDev: false,
          env: {},
          dataFast: true,
        }),
      ),
    ).toBe(NONCE);
    expect(
      buildContentSecurityPolicy({ isDev: false, env: {}, dataFast: true }),
    ).not.toMatch(/'nonce-|'sha256-|'strict-dynamic'/);
  });

  it("changes nothing but script and connect sources", () => {
    const withDf = directives(
      buildContentSecurityPolicy({ isDev: false, env: {}, dataFast: true }),
    );
    const without = directives(
      buildContentSecurityPolicy({ isDev: false, env: {} }),
    );

    expect(Object.keys(withDf)).toEqual(Object.keys(without));
    for (const name of Object.keys(without)) {
      if (["script-src", "script-src-elem", "connect-src"].includes(name)) {
        continue;
      }
      expect([name, withDf[name]]).toEqual([name, without[name]]);
    }
  });

  it("sits after Google's hosts when both run on a marketing page", () => {
    const policy = directives(
      buildContentSecurityPolicy({
        isDev: false,
        env: {},
        analytics: true,
        dataFast: true,
      }),
    );

    expect(policy["script-src"]).toBe(
      `'self' 'unsafe-inline' https://www.googletagmanager.com ${DF}`,
    );
    expect(policy["connect-src"].split(" ").at(-1)).toBe(DF);
  });

  it("is absent unless asked", () => {
    expect(buildContentSecurityPolicy({ isDev: false, env: {} })).not.toContain(
      "datafa.st",
    );
    expect(
      buildContentSecurityPolicy({ nonce: NONCE, isDev: false, env: {} }),
    ).not.toContain("datafa.st");
  });
});

describe("the theme script's hash", () => {
  it("is the SHA-256 of the script the root layout renders", () => {
    const expected = createHash("sha256")
      .update(THEME_INIT_SCRIPT, "utf8")
      .digest("base64");

    expect(THEME_INIT_SCRIPT_HASH).toBe(`'sha256-${expected}'`);
  });

  it("reads the key the theme hook writes", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });
});

describe("createCspNonce", () => {
  it("is 128 random bits, base64, in the shape Next accepts", () => {
    const nonce = createCspNonce();

    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    expect(getScriptNonceFromHeader(`script-src 'nonce-${nonce}'`)).toBe(nonce);
  });

  it("never repeats", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createCspNonce()));

    expect(nonces.size).toBe(200);
  });
});

describe("usesNoncePolicy", () => {
  it("names the four app segments", () => {
    expect(NONCE_POLICY_PATH_PREFIXES).toEqual([
      "/dashboard",
      "/login",
      "/signup",
      "/edit",
    ]);
  });

  it.each([
    "/dashboard",
    "/dashboard/",
    "/dashboard/sites/0b1f3c2e-1111-4111-8111-111111111111/people",
    "/login",
    "/signup",
    "/edit",
    "/edit/anything",
  ])("is true for %s", (pathname) => {
    expect(usesNoncePolicy(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/pricing",
    "/compare/webflow-editor",
    "/blog/some-post",
    "/docs/install",
    "/loginx",
    "/login-help",
    "/editor",
    "/edit-x",
    "/dashboards",
    "/api/edit",
    "/embed/recopyfast.js",
    "/try",
  ])("is false for %s", (pathname) => {
    expect(usesNoncePolicy(pathname)).toBe(false);
  });

  // s96 (ADR 062): a free-tool report renders a stranger's page text, so it
  // joins the nonce policy — at exactly /tools/<slug>/r/<id>, nothing wider.
  it.each([
    "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c",
    "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c/",
    "/tools/x/r/y",
  ])("is true for the report path %s", (pathname) => {
    expect(usesNoncePolicy(pathname)).toBe(true);
  });

  it.each([
    "/tools",
    "/tools/",
    "/tools/website-spell-checker",
    "/tools/x/r",
    "/tools/x/r/",
    "/tools/x/r/y/z",
    "/tools/x/report/y",
    "/toolsx/x/r/y",
    "/api/tools/scan",
  ])("is false for %s, which must stay static", (pathname) => {
    expect(usesNoncePolicy(pathname)).toBe(false);
  });
});

describe("connect-src", () => {
  const ENV = {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_WS_URL: "wss://recopyfast-ws.fly.dev",
    NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.sentry.io/2",
  };

  it("names each configured origin exactly, over https and wss", () => {
    const connect = directives(
      buildContentSecurityPolicy({ isDev: false, env: ENV }),
    )["connect-src"].split(" ");

    expect(connect).toEqual([
      "'self'",
      "https://project.supabase.co",
      "wss://project.supabase.co",
      "wss://recopyfast-ws.fly.dev",
      "https://recopyfast-ws.fly.dev",
      "https://o1.ingest.sentry.io",
      "wss://o1.ingest.sentry.io",
    ]);
  });

  it("is the same under both policies", () => {
    const withNonce = directives(
      buildContentSecurityPolicy({ nonce: NONCE, isDev: false, env: ENV }),
    );
    const withoutNonce = directives(
      buildContentSecurityPolicy({ isDev: false, env: ENV }),
    );

    expect(withNonce["connect-src"]).toBe(withoutNonce["connect-src"]);
  });

  it("keeps a plain http/ws origin only in development", () => {
    const env = { NEXT_PUBLIC_WS_URL: "http://localhost:4001" };
    const prod = directives(buildContentSecurityPolicy({ isDev: false, env }));
    const dev = directives(buildContentSecurityPolicy({ isDev: true, env }));

    expect(prod["connect-src"]).not.toContain("http://localhost:4001");
    expect(prod["connect-src"]).not.toContain("ws://localhost:4001 ");
    expect(dev["connect-src"]).toContain("http://localhost:4001");
    expect(dev["connect-src"]).toContain("ws://localhost:*");
  });

  it("ignores a malformed value", () => {
    const connect = directives(
      buildContentSecurityPolicy({
        isDev: false,
        env: { NEXT_PUBLIC_SUPABASE_URL: "not a url" },
      }),
    )["connect-src"];

    expect(connect).toBe("'self'");
  });
});
