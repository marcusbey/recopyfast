# Research — Story s65a-published-copy-snapshot

## The five structuring facts

1. No browser fetch from our origin meets s61's 200 ms hold: production content GET median
   497–589 ms, 0/20 under 200 ms (`docs/reviews/s61-stable-copy-loading.md:28-33`). The fix is
   delivery that a host can render server-side, not a faster swap.
2. Published copy changes through at least seven paths, two of them outside publish (bulk
   update/import, v1 POST/PUT, discovery, AI translate via `original_content`, site delete —
   §Current state). A rebuild-per-writer snapshot would already be wrong; a bounded-lifetime
   CDN read of the current rows is correct by construction.
3. Vercel caches function responses carrying `s-maxage`, but not for requests with
   `Authorization` nor responses with `set-cookie`; query strings are part of the function
   cache key (https://vercel.com/docs/caching/cdn-cache). `src/middleware.ts:116-146` calls
   `auth.getUser()` on every non-sessionless path and can rotate the session cookie — the new
   route MUST be in `isSessionlessPath` (`src/middleware.ts:93-104`) or it is never cached.
4. AGENTS.md "Data access" requires an `authorize*` call before any service-role read. This
   route deliberately has none: the ADR must record it as a named, single-route exception
   bounded by a fixed public projection, page scoping, input validation and an IP limiter.
5. s62's migration `20261005000000_versioned_public_content_cache.sql` is applied in
   production but absent from main. Its revision rotates on every `content_elements` statement,
   staging-only and no-op updates included (s62 file :91-93) — it is not a "published changed"
   signal and s65a does not use it. It still has to land byte-identical (AC 0).

## Target story

`docs/stories.md` → `s65a-published-copy-snapshot`. An unauthenticated, page-scoped,
CDN-cached read of the current published rows, identical in projection to today's public read,
fresh within ≤ 60 s, retraction within the same bound, never gated by the owner's plan, abuse
bounded, measured against a recorded baseline, with an in-repo no-flash browser proof, an ADR
and integrator documentation. No change to the authenticated content GET or the embed runtime.

## Current state of the code

Public read — `src/app/api/content/[siteId]/route.ts` GET:
- IP limiter, fail open (`:288-296`), then dashboard auth (`:344`), else
  `authorizeSiteRequest` (`:354-359`: signed token + Origin/Referer domain match).
- Projection `id, site_id, element_id, selector, published_content, original_content, language,
  variant, page_path, metadata, published_at` (`:393`, `:396`). Only
  `metadata.staging_attributes` is stripped (`:435-436`); all other metadata is served.
- `current_content = published_content ?? original_content ?? ""` (`:441-442`).
- `language` defaults `"en"`, `variant` `"default"`, neither validated (`:369-370`);
  `page_path` via `normalizePagePath` (`:371-381`, 400 on invalid).
- Page scope = page rows + shared rows (`page_path IS NULL`), 1,000-row pages, ordered
  `element_id, id`, no total cap (`src/lib/content/paged-elements.ts:1,34-36,83-97`).
- No `Cache-Control`.

Writers that change public output (informational under the TTL design):
staging publish RPC `publish_staging_content_with_attributes_atomic`
(`src/app/api/staging/publish/route.ts:178-186`; all languages/variants of the element ids);
bulk update (`src/app/api/bulk/update/route.ts:354-362`); bulk import
(`src/app/api/bulk/import/route.ts:721-750`); v1 POST/PUT (`src/app/api/v1/content/route.ts:293-323`);
discovery inserts with `published_content` set (`route.ts:168-182`, `:637-642`, `ignoreDuplicates`);
AI translate (`src/app/api/ai/translate/route.ts:316-336`, writes `original_content`/`metadata`);
v1 DELETE (`:427-431`, unreachable today per ADR 041); site delete cascade
(`src/app/api/sites/[siteId]/route.ts:76-79`). Staging-only: staging save, version restore,
styles/apply, A/B promotion (`src/lib/ab-testing/lifecycle.ts:187-195`).

Site lifecycle: hard delete only; `sites.status` is install state and never gates delivery
(`supabase/migrations/20260817001000_sites_install_status.sql:11-16,50-52`). Deleted site →
today 401 `site_not_found`. Plan: public delivery is never gated (ADR 041 `:63-65`, s51 AC 3).

## Anchor points

- New route handler (path decided in the plan) under `src/app/api/`.
- `src/middleware.ts` `isSessionlessPath` (`:93-104`) — add the new prefix.
- Loader: `src/lib/content/paged-elements.ts` (page + shared rows, ordering, paging).
- Allow-list: port `publicRow` / `validateRows` / `PRIVATE_ROW_FIELDS` from s62's
  `src/lib/content/published-content-cache.ts:90-157` into one new helper.
- Limiter: `enforceRateLimit(request, { limit, endpoint, onStoreFailure: "allow" })`
  (`src/lib/api/rate-limit.ts:36,53,98-147`); precedent `IP_GENERAL` on the content GET.
- CORS: `src/lib/http/public-cors.ts` (`*`, no credentials, `Vary: Origin`, 204 preflight).
- Cache precedent: `/api/pricing` sets `public, max-age=300, s-maxage=300,
  stale-while-revalidate=600` (`src/app/api/pricing/route.ts:270-271`) and is a live CDN HIT
  through this middleware.
- Migration: copy from `origin/feature/s62-versioned-public-content-cache`.
- E2E: `e2e/support/local-supabase.ts` seeding; count contract
  `e2e/support/strict-run-contract.ts`.

## Verified APIs / functions

- `normalizePagePath` — used by the content GET (`route.ts:371-381`).
- `enforceRateLimit(request, { limit, endpoint, onStoreFailure })` — `"allow"` = fail open.
- Vercel header priority `Vercel-CDN-Cache-Control` > `CDN-Cache-Control` > `Cache-Control`;
  `s-maxage` stripped before the browser when only `Cache-Control` is used; cacheable statuses
  include 200 and 404 (https://vercel.com/docs/caching/cache-control-headers,
  https://vercel.com/docs/caching/cdn-cache#cacheable-response-criteria).
- Each deployment starts with a fresh CDN cache (per-deployment keys).
- Baseline 2026-10-06, `/api/pricing` HIT from the operator machine (edge `yul1`): fresh
  connection TLS ≈ 55–98 ms, server wait 27–116 ms (p50 ≈ 60 ms); reused connection 16–65 ms.

## Traps & constraints

- `set-cookie` on the response or a request `Authorization` header disables caching — assert
  both in tests; never read cookies in this route.
- Any query string is a new cache key: reject requests carrying one before any work.
- Unvalidated `language`/`variant` today: no validators exist in `src/lib`. The new route must
  bound them (length, charset, canonical encoding) without rejecting values the writers produce
  (translate language codes; A/B variant names).
- No total row cap today: cap the snapshot body (s62 used 1 MiB) and fail closed above it.
- Parity: metadata is served whole today (incl. `translatedFrom`, `aiGenerated`, `tokensUsed`).
  Parity keeps that; tightening it is a separate decision, not silently done here.
- Middleware CSP headers are added to every response — harmless for JSON; keep.
- Embed discovery records DOM text as `original_content` for new rows; with server-rendered
  published copy, anchored rows already exist (upsert `ignoreDuplicates`), but the browser
  proof must assert no stored `original_content` changes.
- Open PRs #59 and #61 edit `src/app/api/content/[siteId]/route.ts` and `docs/stories.md`; s65a
  must not touch the route. `docs/stories.md` appends will need a trivial rebase.
- Local commits from the primary checkout fail `comparison-pages.test.tsx` because `.env`
  supplies `VERCEL_URL`/`NEXT_PUBLIC_APP_URL`; this worktree has no `.env` and matches CI.

## Open questions

1. Route shape: path segments vs canonical query. Planner decides (query strings bypass CDN).
2. Exact validator rules for `language`/`variant` that accept every value writers produce.
3. Remote migration-ledger check: the connected Supabase account cannot see project
   `uexwowziiigweobgpmtk`; the operator may need to run `supabase migration list --linked`.
4. Whether to keep s62's revision triggers in production (write-path lock cost, unused by
   s65a) — follow-up decision, not this story.

## Real complexity

4, as scored. The delivery code is small (one route, one helper, one middleware line); the
weight is in the security exception and its ADR, the migration-ledger repair, header/caching
correctness and the browser proof. No split needed after the s65a/s65b cut.

## Split proposal

None beyond the existing s65a/s65b split.
