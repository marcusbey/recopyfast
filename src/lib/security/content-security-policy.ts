import { createHash, randomBytes } from "node:crypto";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-init-script";

/**
 * The Content Security Policies this app sends — two of them, by ADR 059.
 *
 * TOMBSTONE — s69 L1, closed in s79. Production sent `script-src 'self'
 * 'unsafe-inline'` on every page, so an injected inline script or event
 * handler ran on the dashboard, which renders text scraped off customers'
 * pages, and on the pages that take credentials. A nonce is the fix, but Next
 * can only stamp one on a page it renders per request; a prerendered page has
 * none, and under a nonce policy it does not hydrate at all (measured in
 * docs/research/s79-headers-csp-ws.md). So:
 *
 * - the APP surface (`NONCE_POLICY_PATH_PREFIXES`) gets a fresh nonce per
 *   request with `'strict-dynamic'`, and each of those segments renders per
 *   request (its layout awaits `connection()`);
 * - the static MARKETING surface keeps the old policy and stays prerendered.
 *
 * Do not add a nonce or a hash to the static policy "to tighten it": the
 * presence of either makes browsers ignore `'unsafe-inline'`, which is the only
 * thing that lets a prerendered page's inline scripts run.
 */

/**
 * Path segments served under the nonce policy, everything below them included.
 *
 * Each one MUST render dynamically — `src/app/<segment>/layout.tsx` awaits
 * `connection()` — or its pages ship with no nonce and stop hydrating. Adding
 * an entry without that layout breaks the segment in production builds only
 * (`next dev` renders everything per request). Pinned by
 * `src/__tests__/security/nonce-routes-render-dynamically.test.tsx`.
 */
export const NONCE_POLICY_PATH_PREFIXES = [
  "/dashboard",
  "/login",
  "/signup",
  "/edit",
] as const;

/** Segment-exact: `/login` and `/login/x`, never `/loginx` or `/editor`. */
export function usesNoncePolicy(pathname: string): boolean {
  return NONCE_POLICY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** 128 random bits, base64 — the shape Next's `getScriptNonceFromHeader` accepts. */
export function createCspNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * The root layout's theme script, allowed by content. Next never stamps the
 * nonce on a script we render ourselves, so without this the theme flashes on
 * every app page. Computed from the constant the layout renders, so the two
 * cannot disagree.
 */
export const THEME_INIT_SCRIPT_HASH = `'sha256-${createHash("sha256")
  .update(THEME_INIT_SCRIPT, "utf8")
  .digest("base64")}'`;

/** The env values the policy is derived from. All optional. */
export interface CspEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_WS_URL?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
}

export interface ContentSecurityPolicyOptions {
  /** Present on the app surface only. */
  nonce?: string;
  isDev: boolean;
  env?: CspEnvironment;
}

/**
 * connect-src must allowlist every origin the client opens XHR/fetch/WebSocket
 * to, or the browser silently blocks them. 'self' alone breaks Supabase (REST +
 * wss realtime) and the Socket.io server. Derived from env so the policy never
 * widens to a blanket https:/wss:.
 *
 * Sentry needs no entry of its own: since s46 the browser SDK posts to the
 * same-origin tunnel, which 'self' covers. The DSN origin is still added for
 * the one case the SDK skips the tunnel — a DSN that is not a sentry.io SaaS
 * host.
 */
function connectSources(env: CspEnvironment, isDev: boolean): string[] {
  const sources = new Set<string>(["'self'"]);
  const addOrigin = (raw?: string) => {
    if (!raw) return;
    try {
      const { protocol, host } = new URL(raw);
      // Supabase exposes REST over https and realtime over wss on one host.
      if (protocol === "https:" || protocol === "http:") {
        sources.add(`https://${host}`);
        sources.add(`wss://${host}`);
      } else if (protocol === "wss:" || protocol === "ws:") {
        sources.add(`wss://${host}`);
        sources.add(`https://${host}`);
      }
      // Keep the scheme as configured too, in development only: a local
      // `http://host:4001` WS URL needs http:/ws: allowed. Production env
      // values are https/wss and stay that way.
      if (isDev && (protocol === "http:" || protocol === "ws:")) {
        sources.add(`http://${host}`);
        sources.add(`ws://${host}`);
      }
    } catch {
      // ignore malformed env values
    }
  };
  addOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  addOrigin(env.NEXT_PUBLIC_WS_URL);
  addOrigin(env.NEXT_PUBLIC_SENTRY_DSN);
  if (isDev) sources.add("ws://localhost:*");
  return Array.from(sources);
}

/**
 * Script sources.
 *
 * Static: `'self' 'unsafe-inline'` — today's policy, which a prerendered page
 * needs. In development `'unsafe-eval'` too, for React's debugging stacks.
 *
 * Nonce: `'nonce-N' 'strict-dynamic' <theme hash> 'self' 'unsafe-inline'`. A
 * CSP3 browser honours the nonce, the hash and `'strict-dynamic'` (so chunks a
 * trusted script loads run) and IGNORES `'self'` and `'unsafe-inline'`. The
 * trailing pair is the fallback: a CSP2 browser ignores `'unsafe-inline'`
 * because a nonce is present and loads same-origin chunks by `'self'`; a CSP1
 * browser runs on `'self' 'unsafe-inline'`. No `https:` — every script here is
 * same-origin.
 */
function scriptSources(nonce: string | undefined, isDev: boolean): string {
  const sources = nonce
    ? [
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        THEME_INIT_SCRIPT_HASH,
        "'self'",
        "'unsafe-inline'",
      ]
    : ["'self'", "'unsafe-inline'"];
  if (isDev) sources.push("'unsafe-eval'");
  return sources.join(" ");
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
  env = {},
}: ContentSecurityPolicyOptions): string {
  const scripts = scriptSources(nonce, isDev);
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    // Browsers fall back to script-src when script-src-elem is absent, so this
    // is not a tightening — it stops the fallback from being implicit and
    // makes the "which directive blocked me" console message unambiguous.
    `script-src-elem ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    `connect-src ${connectSources(env, isDev).join(" ")}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // CSP equivalent of X-Frame-Options: DENY, which the middleware also
    // sends; frame-ancestors is what modern browsers actually honour.
    "frame-ancestors 'none'",
  ].join("; ");
}
