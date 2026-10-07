import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { fetchPageScopedRows } from "@/lib/content/paged-elements";
import {
  PUBLIC_CONTENT_COLUMNS,
  toPublicRows,
  type PublicContentSourceRow,
} from "@/lib/content/public-rows";
import {
  parsePublishedSnapshotKey,
  type PublishedSnapshotKey,
  type SnapshotKeyRejection,
} from "@/lib/content/published-snapshot-key";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * GET /api/published/[siteId]?page=<path>&language=<lang>&variant=<variant>
 *
 * The published copy of one page, for a host to render into its own HTML
 * (s65a, ADR 046). No browser fetch from our origin can beat a host's first
 * paint — production content GET median 497–589 ms, 0/20 under s61's 200 ms
 * hold — so the only way a visitor sees published copy first is for the host to
 * already have it when it renders. This is that read.
 *
 * UNAUTHENTICATED ON PURPOSE. Every other service-role read in this app runs an
 * `authorize*` call first (AGENTS.md "Data access", ADR 002). This route is the
 * single named exception, recorded in ADR 046: the widget's site token sits in
 * the source of every customer page and `Origin` is forgeable by anything that
 * is not a browser, so the content GET's check never kept published copy from
 * anyone — it only stopped cross-site BROWSER reads of text that is already
 * public on the customer's own page. What stands in for authorization here:
 * the fixed public projection (`src/lib/content/public-rows.ts`), one page per
 * request (no site-wide or page index), a canonical-key check that refuses
 * other parameter sets, orders and invalid values before any work (encoding
 * variants excepted — ADR 046's known gap), a per-IP limiter before the database,
 * and a body cap. Nothing written by this route, nothing private read.
 *
 * FRESHNESS IS A LIFETIME, NOT AN INVALIDATION. Published copy changes through
 * at least seven paths (publish RPC, bulk update/import, v1 POST/PUT,
 * discovery, AI translate, site delete). Rebuilding a snapshot on each writer
 * would already be wrong by omission; a CDN entry that cannot outlive 60 s is
 * correct for every writer, including ones not written yet. So: the CDN may
 * hold a response 30 s fresh plus 30 s stale-while-revalidate, and the browser
 * may not hold it at all.
 *
 * WHY THESE HEADERS AND NOT OTHERS (https://vercel.com/docs/caching/cache-control-headers):
 * - `Vercel-CDN-Cache-Control` has top priority, applies only to Vercel's cache
 *   and is consumed at the edge, so it can say "cache 30 s" without telling the
 *   browser or any cache in front of the host anything.
 * - `Cache-Control: public, max-age=0, must-revalidate` is forwarded as is: a
 *   browser or an intermediate cache revalidates every time (cheap — ETag/304).
 * - No `s-maxage`: with only `Cache-Control`, Vercel would strip it before the
 *   client, and a downstream shared cache honouring it would add its own
 *   lifetime on top of ours. No `stale-if-error`: it would let an outage serve
 *   retracted copy for as long as it lasts, breaking the 60 s bound.
 * - Vercel does not cache a response that sets a cookie or a request that
 *   carries `Authorization`. This route reads no cookie and sets none, and the
 *   path is in `isSessionlessPath` (`src/middleware.ts`) so the middleware's
 *   `auth.getUser()` cannot rotate a session cookie onto it either.
 * - No `export const revalidate`, no `unstable_cache`, no fetch cache: a second
 *   cache layer under the CDN would stack its lifetime onto the 60 s.
 */

const SNAPSHOT_FORMAT = "rcf-published-v1";

/**
 * Today's content GET has no total row cap, and a snapshot is held in the CDN
 * and in hosts' renderers. s62 capped its cached payload at 1 MiB; the same
 * bound applies here and fails closed — a truncated page would present as
 * "some copy silently reverted", which is worse than the host keeping its
 * authored copy.
 */
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

const BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const EDGE_CACHE_CONTROL = "max-age=30, stale-while-revalidate=30";
const ALLOWED_METHODS = "GET,OPTIONS";

/**
 * Fixed text, never the rejected value: the value is attacker-chosen and a
 * response that echoed it would be a reflection channel.
 */
const REJECTION_MESSAGES: Record<SnapshotKeyRejection, string> = {
  invalid_site_id: "Site id must be a lowercase UUID",
  non_canonical_query:
    "Query must be exactly page, language and variant, in that order, as URLSearchParams serializes them",
  invalid_page: "Page must be a canonical page path",
  invalid_language:
    "Language must be 1 to 64 characters without control characters",
  invalid_variant:
    "Variant must be 1 to 64 characters without control characters",
};

/**
 * 200 and 404 share one lifetime. A 404 for a well-formed but unknown site id
 * is cached for the same 60 s so a caller cycling random ids pays one database
 * read per id per edge region per minute, not one per request — and a site
 * created a moment ago becomes readable within the same bound as any edit.
 */
function edgeCached(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", BROWSER_CACHE_CONTROL);
  response.headers.set("Vercel-CDN-Cache-Control", EDGE_CACHE_CONTROL);
  return withPublicCors(response, undefined, ALLOWED_METHODS);
}

/** Refusals and faults must never become the cached answer for a key. */
function uncached(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return withPublicCors(response, undefined, ALLOWED_METHODS);
}

function serverFault(): NextResponse {
  return uncached(
    NextResponse.json({ error: "Internal server error" }, { status: 500 }),
  );
}

/** RFC 9110 §13.1.2: If-None-Match uses the weak comparison. */
function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .includes(etag);
}

async function readSnapshotBody(
  key: PublishedSnapshotKey,
): Promise<
  | { kind: "body"; body: string }
  | { kind: "site_not_found" }
  | { kind: "fault" }
> {
  // Service role, with no `authorize*` call before it: ADR 046 is the single
  // exception to that rule, for this read only. What bounds it is everything
  // above — canonical key, IP limiter — and the fixed projection below. Do not
  // copy this shape to another route; the next one needs its own ADR.
  const supabase = createServiceRoleClient();

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id")
    .eq("id", key.siteId)
    .maybeSingle();
  if (siteError) {
    console.error("[published] site lookup failed:", siteError);
    return { kind: "fault" };
  }
  if (!site) return { kind: "site_not_found" };

  // Same loader as the content GET: page rows plus shared (`page_path IS NULL`)
  // rows, paginated past PostgREST's 1,000-row cap, ordered element_id, id.
  const { data, error } = await fetchPageScopedRows((scope) => {
    let query = supabase
      .from("content_elements")
      .select(PUBLIC_CONTENT_COLUMNS, { count: "exact" })
      .eq("site_id", key.siteId)
      .eq("language", key.language)
      .eq("variant", key.variant);
    if (scope.kind === "page") {
      query = query.eq("page_path", scope.pagePath);
    } else if (scope.kind === "shared") {
      query = query.is("page_path", null);
    }
    return query;
  }, key.pagePath);
  if (error) {
    console.error("[published] content read failed:", error);
    return { kind: "fault" };
  }

  const rows = toPublicRows(
    (data ?? []) as unknown as PublicContentSourceRow[],
  );
  if (rows === null) {
    // Only reachable if the select above is widened to a private column. Serve
    // nothing rather than a trimmed page that hides the defect.
    console.error("[published] refused rows carrying a private column", {
      siteId: key.siteId,
    });
    return { kind: "fault" };
  }

  return {
    kind: "body",
    body: JSON.stringify({
      format: SNAPSHOT_FORMAT,
      siteId: key.siteId,
      pagePath: key.pagePath,
      language: key.language,
      variant: key.variant,
      rows,
    }),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;

    // First, before the limiter and the database: the CDN keys on the query
    // string, so every non-canonical spelling must cost nothing and cache
    // nothing, or it is a free cache bypass. `nextUrl.search` is the query as
    // Next re-serialized it, so percent-encoding variants arrive canonical and
    // are not caught here — the known gap recorded in ADR 046.
    const parsed = parsePublishedSnapshotKey(siteId, request.nextUrl.search);
    if (!parsed.ok) {
      return uncached(
        NextResponse.json(
          { error: REJECTION_MESSAGES[parsed.reason] },
          { status: 400 },
        ),
      );
    }

    // Per IP, before the first query. FAILS OPEN: this is a public read of
    // copy that is already public on the customer's page, and it sits in
    // front of every host's render — a Redis outage must not take published
    // copy off every integrating site at once (AGENTS.md: public reads fail
    // open). The CDN in front absorbs repeat keys; this bounds the misses.
    const limited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "published/read",
      identifierType: "ip",
      onStoreFailure: "allow",
      message: "Too many snapshot requests. Please try again shortly.",
    });
    if (limited) return uncached(limited);

    const snapshot = await readSnapshotBody(parsed.key);
    if (snapshot.kind === "fault") return serverFault();
    if (snapshot.kind === "site_not_found") {
      return edgeCached(
        NextResponse.json({ error: "Site not found" }, { status: 404 }),
      );
    }

    const bytes = new TextEncoder().encode(snapshot.body).byteLength;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      console.error(
        `[published] snapshot over the ${MAX_SNAPSHOT_BYTES}-byte cap`,
        { siteId: parsed.key.siteId, bytes },
      );
      return serverFault();
    }

    // Strong validator: the bytes served are exactly the bytes hashed.
    const etag = `"${createHash("sha256").update(snapshot.body).digest("hex")}"`;
    if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
      return edgeCached(
        new NextResponse(null, { status: 304, headers: { ETag: etag } }),
      );
    }

    return edgeCached(
      new NextResponse(snapshot.body, {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: etag },
      }),
    );
  } catch (error) {
    console.error("[published] snapshot failed:", error);
    return serverFault();
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, ALLOWED_METHODS);
}
