/**
 * Which requests the Sentry tunnel may forward (s84).
 *
 * `tunnelRoute` (next.config.ts) makes `@sentry/nextjs` rewrite
 * `/monitoring?o=<org>&p=<project>[&r=<region>]` to
 * `https://o<org>.ingest[.<region>].sentry.io/api/<project>/envelope/` —
 * `node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/tunnel.js`.
 * The rewrite accepts ANY digits and takes the destination from the query
 * string alone, so until s84 this origin was an open relay to every Sentry SaaS
 * project: anyone could launder their envelopes through www.recopyfa.st.
 *
 * Two checks, both required:
 *
 *   1. The QUERY must name exactly our DSN's org, project and region, one value
 *      each. This is the control that matters: it is what the rewrite turns
 *      into a destination. Duplicates are refused because which of two values a
 *      `has` matcher binds is the router's business, not something to bet on.
 *   2. The ENVELOPE HEADER (the first line of the body, JSON) must carry a
 *      `dsn` naming our host and project. The browser SDK always writes it when
 *      a tunnel is set. Defence in depth, and what Sentry's own tunnel guidance
 *      checks.
 *
 * Reading the body here does not starve the rewrite: Next hands middleware a
 * clone and replaces the original stream with a buffered copy
 * (`next/dist/server/body-streams.js`, `getCloneableBody`).
 *
 * The host pattern is the browser SDK's own
 * (`@sentry/nextjs/build/cjs/client/tunnelRoute.js`): a DSN that is not a
 * Sentry SaaS host is never tunnelled by the SDK, so nothing is allowed then.
 */

import { SENTRY_TUNNEL_ROUTE } from "./sentry-tunnel";

/** A header line longer than this is not one the browser SDK wrote. */
export const MAX_ENVELOPE_HEADER_CHARS = 16 * 1024;

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: the router cannot decode them into the tunnel either.
    return pathname;
  }
}

/**
 * Is this the tunnel, under ANY spelling its rewrite accepts?
 *
 * The first guard (s84) asked `pathname === "/monitoring"` and the review
 * relayed a foreign envelope through `/MONITORING` on a production build: Next
 * compiles the rewrite's `/monitoring(/?)` case-insensitively with an optional
 * trailing slash (`routes-manifest.json`: `caseSensitive: false`,
 * `^/monitoring(/?)(?:/)?$` — the manifest Vercel routes by too). So: any
 * case, any trailing slashes, and the percent-decoded form as well — `next
 * start` matches the raw path, but how Vercel's edge treats `/%6Donitoring` is
 * not inspectable from here, and refusing a spelling no browser sends costs
 * nothing. `sentry-tunnel-route-coverage.test.ts` compiles the real rewrite
 * with Next's own route compiler and proves every path it accepts lands here;
 * widen this, never narrow it, if that test goes red after an upgrade.
 */
export function isSentryTunnelPath(pathname: string): boolean {
  const normalized = decodedPath(pathname).toLowerCase().replace(/\/+$/, "");
  return normalized === SENTRY_TUNNEL_ROUTE.toLowerCase();
}

const SAAS_INGEST_HOST = /^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$/;

interface DsnTarget {
  host: string;
  projectId: string;
}

interface TunnelTarget extends DsnTarget {
  orgId: string;
  region: string | null;
}

/** Host and numeric project id of a DSN, or null when it is not one. */
function parseDsn(dsn: unknown): DsnTarget | null {
  if (typeof dsn !== "string") return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (!/^\d+$/.test(projectId)) return null;
  return { host: url.hostname, projectId };
}

/** What the tunnel may forward to, derived from our own DSN. */
export function tunnelTargetFromDsn(
  dsn: string | undefined,
): TunnelTarget | null {
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  const match = parsed.host.match(SAAS_INGEST_HOST);
  if (!match) return null;
  return { ...parsed, orgId: match[1], region: match[2] ?? null };
}

function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function queryNamesTarget(
  params: URLSearchParams,
  target: TunnelTarget,
): boolean {
  if (single(params, "o") !== target.orgId) return false;
  if (single(params, "p") !== target.projectId) return false;
  const regions = params.getAll("r");
  return target.region === null
    ? regions.length === 0
    : regions.length === 1 && regions[0] === target.region;
}

function envelopeNamesTarget(body: string, target: TunnelTarget): boolean {
  const newline = body.indexOf("\n");
  const headerLine = newline === -1 ? body : body.slice(0, newline);
  if (!headerLine || headerLine.length > MAX_ENVELOPE_HEADER_CHARS) {
    return false;
  }

  let header: unknown;
  try {
    header = JSON.parse(headerLine);
  } catch {
    return false;
  }
  if (!header || typeof header !== "object") return false;

  const envelopeDsn = parseDsn((header as { dsn?: unknown }).dsn);
  return (
    envelopeDsn !== null &&
    envelopeDsn.host === target.host &&
    envelopeDsn.projectId === target.projectId
  );
}

export interface TunnelRequest {
  method: string;
  searchParams: URLSearchParams;
  readBody: () => Promise<string>;
}

/**
 * True when the tunnel may forward this request to Sentry. Cheap checks first:
 * the body is only read once the method and the destination are ours.
 */
export async function isForwardableTunnelRequest(
  request: TunnelRequest,
  dsn: string | undefined,
): Promise<boolean> {
  const target = tunnelTargetFromDsn(dsn);
  if (!target) return false;
  if (request.method !== "POST") return false;
  if (!queryNamesTarget(request.searchParams, target)) return false;

  let body: string;
  try {
    body = await request.readBody();
  } catch {
    return false;
  }
  return envelopeNamesTarget(body, target);
}
