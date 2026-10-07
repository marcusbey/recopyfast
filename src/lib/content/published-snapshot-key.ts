import { normalizePagePath } from "@/lib/content/page-path";

/**
 * The one URL spelling of a published-copy snapshot (s65a, ADR 046).
 *
 * `GET /api/published/[siteId]?page=…&language=…&variant=…` is cached by
 * Vercel's CDN, and the CDN keys a function response on the whole query string
 * (https://vercel.com/docs/caching/cdn-cache). Every spelling of the same key
 * that the origin answers can be a separate cache entry and a separate
 * database read — `?cb=1`, `?language=en&page=…`. So the origin answers one
 * parameter set in one order and refuses the rest before it spends anything:
 * no limiter, no database.
 *
 * THIS IS CDN HYGIENE, NOT THE ABUSE BOUND. Any caller can already mint
 * unlimited distinct canonical keys — any page, language or variant, each a
 * cache miss and a database read. The per-IP limiter in the route is what
 * bounds that, for canonical random keys and every other form alike (s65a
 * Abuse AC as amended by the owner on 2026-10-07, ADR 046). Refusing other
 * spellings saves CDN entries; do not describe it as the thing that stops a
 * flood, and do not drop the limiter because this check exists.
 *
 * The canonical spelling is whatever `URLSearchParams` serializes, in the order
 * page, language, variant. An integrator gets it from
 * `new URLSearchParams([["page", p], ["language", l], ["variant", v]])` in any
 * runtime, without a library from us.
 *
 * WHAT A DEPLOYED SERVER ACTUALLY REFUSES (measured on `next start`, Next
 * 16.3.8; asserted by `e2e/published-snapshot-ssr.spec.ts`). The handler
 * never sees the raw query: Next re-serializes it, URLSearchParams-style,
 * before the route runs. Order, extra, repeated and missing parameters survive
 * that and are refused here — except Next's own internal keys (`nxtP…`,
 * `nxtI…`, `nextInternalLocale`), which Next deletes before the handler, so
 * they are served as the canonical key (ADR 046). Percent-encoding spellings
 * of the same values (`/` or `%2f` for `%2F`, `%20` for `+`) arrive already
 * canonical and are served as the canonical key — by owner decision, not by
 * accident: refusing them would take `skipProxyUrlNormalize` (a global Next
 * flag) and a second check in the middleware, to save CDN entries the limiter
 * already bounds. This parser still refuses them when given the raw string
 * (the unit tests do); keep that — it is correct wherever the raw query is
 * visible.
 */

/** Lowercase only: an uppercase id is a second cache key for the same site. */
const SITE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SNAPSHOT_PARAMS = ["page", "language", "variant"] as const;

/**
 * Language and variant rule, derived from what can actually be stored.
 *
 * `content_elements.language` and `.variant` are unconstrained TEXT. Discovery
 * writes `en` / `default`; AI translate writes a BCP-47-ish tag of at most 20
 * characters (`LANGUAGE_TAG_PATTERN` in `src/app/api/ai/translate/route.ts`)
 * with variant `default`; but v1 POST/PUT and bulk import store whatever string
 * the caller sent. A/B variants live in `ab_test_variants`, never in this
 * column (promotion writes staging content). A charset rule tighter than "no
 * control characters" would therefore refuse rows that exist and are served by
 * the content GET today. What is refused: empty (every writer substitutes
 * `en`/`default` for an empty value, so no row can carry one), longer than 64
 * characters, and C0/DEL/C1 control characters, which no browser or header can
 * carry intact and which would forge log lines if echoed.
 */
const MAX_LANGUAGE_OR_VARIANT_LENGTH = 64;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export interface PublishedSnapshotKey {
  siteId: string;
  pagePath: string;
  language: string;
  variant: string;
}

export type SnapshotKeyRejection =
  | "invalid_site_id"
  | "non_canonical_query"
  | "invalid_page"
  | "invalid_language"
  | "invalid_variant";

export type SnapshotKeyResult =
  | { ok: true; key: PublishedSnapshotKey }
  | { ok: false; reason: SnapshotKeyRejection };

export function canonicalSnapshotQuery(
  pagePath: string,
  language: string,
  variant: string,
): string {
  return new URLSearchParams([
    ["page", pagePath],
    ["language", language],
    ["variant", variant],
  ]).toString();
}

function isValidLanguageOrVariant(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_LANGUAGE_OR_VARIANT_LENGTH &&
    !CONTROL_CHARACTERS.test(value)
  );
}

/**
 * The widget never produces a page key ending in `/` other than `/` itself:
 * `normalizedPagePath()` in the embed strips trailing slashes (and a final
 * `/index.html`) after `decodeURI`. Rows are stored under that key, so
 * `/pricing/` can never match a page row — it would be a distinct cache entry
 * serving shared rows only. This is a refusal, not a second fold: folding
 * again is unsafe (see `normalizePagePath` — `/index.html` is itself a
 * canonical widget output and must not collapse to `/`).
 */
function isCanonicalPagePath(pagePath: string): boolean {
  const normalized = normalizePagePath(pagePath);
  if (!normalized.ok || normalized.value !== pagePath) return false;
  return pagePath === "/" || !pagePath.endsWith("/");
}

/**
 * Parse the route's site id and raw query string (`request.nextUrl.search`,
 * with or without its leading `?`). Never throws.
 */
export function parsePublishedSnapshotKey(
  siteId: string,
  search: string,
): SnapshotKeyResult {
  if (!SITE_ID_PATTERN.test(siteId)) {
    return { ok: false, reason: "invalid_site_id" };
  }

  const rawQuery = search.startsWith("?") ? search.slice(1) : search;
  const entries = [...new URLSearchParams(rawQuery).entries()];
  const hasExactParams =
    entries.length === SNAPSHOT_PARAMS.length &&
    entries.every(([name], index) => name === SNAPSHOT_PARAMS[index]);
  if (!hasExactParams) {
    return { ok: false, reason: "non_canonical_query" };
  }

  const [[, pagePath], [, language], [, variant]] = entries;
  if (canonicalSnapshotQuery(pagePath, language, variant) !== rawQuery) {
    return { ok: false, reason: "non_canonical_query" };
  }
  if (!isCanonicalPagePath(pagePath)) {
    return { ok: false, reason: "invalid_page" };
  }
  if (!isValidLanguageOrVariant(language)) {
    return { ok: false, reason: "invalid_language" };
  }
  if (!isValidLanguageOrVariant(variant)) {
    return { ok: false, reason: "invalid_variant" };
  }

  return { ok: true, key: { siteId, pagePath, language, variant } };
}
