# ADR 046 — Published copy has one unauthenticated, page-scoped, CDN-cached read

- Status: accepted
- Date: 2026-10-06
- Scope: s65a-published-copy-snapshot
- Amends:
  - [ADR 002](./002-rls-tenant-boundary.md) and AGENTS.md "Data access" — adds one named
    exception to "an explicit `authorize*` call before any service-role data access": the
    snapshot read `GET /api/published/[siteId]`, and nothing else. ADR 002's body is not
    edited; AGENTS.md "Data access" and the header of `src/lib/http/public-cors.ts` carry a
    one-line pointer here, so a reader applying either rule finds the exception.
- Numbering: 043–045 are taken on the unmerged s61/s62 branches (045 is s62's
  "versioned public content cache"); expect to renumber if one of them merges first.

## Context

The embed fetches published copy from the browser, after the host's authored HTML has painted.
s61 tried to hide that swap behind a visibility hold of at most 200 ms. Production does not fit:
the content GET's median is 497–589 ms and 0 of 20 measured requests came in under 200 ms
(`docs/reviews/s61-stable-copy-loading.md` on `feature/s61-stable-copy-loading`, PR #59). No browser-side fetch from our origin closes that
gap. The only way a visitor sees published copy first is for the host to already have it when it
renders — on its server, at its edge or in its build.

Today's only public read, `GET /api/content/[siteId]`, is authorized per request (site token plus
`Origin`/`Referer` matched to the registered domain) and carries an `Authorization` header.
Vercel's CDN does not cache a request carrying `Authorization` nor a response setting a cookie
(https://vercel.com/docs/caching/cdn-cache#cacheable-response-criteria). So that read cannot be
made fast for a host by caching, and a host's server would need the token to call it at all.

Published copy changes through at least seven paths: the staging publish RPC, bulk update and
import, v1 POST/PUT, embed discovery, AI translate (through `original_content`) and site deletion.
Two of those are outside publish entirely.

## Decision

**`GET /api/published/[siteId]?page=<path>&language=<lang>&variant=<variant>` returns the current
published rows of one page, to anyone, with no token, origin, referrer or cookie, through
Vercel's CDN with a lifetime of at most 60 seconds.** It is the single exception to
"`authorize*` before service role".

What it serves is exactly what the widget-authorized content GET serves for the same page:

- the same columns (`PUBLIC_CONTENT_COLUMNS` in `src/lib/content/public-rows.ts`, byte-identical
  to that route's select, and pinned by a test);
- the same transform: `current_content = published_content ?? original_content ?? ""`, with
  `metadata.staging_attributes` removed and every other metadata key served whole;
- page rows plus shared (`page_path IS NULL`) rows, through the same loader
  (`fetchPageScopedRows`), in the same order.

A parity test runs one fixture through both routes and requires identical rows. The body is
`{ format: "rcf-published-v1", siteId, pagePath, language, variant, rows }`.

### Why dropping the token and origin check for this read exposes nothing new

The site token is printed in the source of every page that installs the embed. `Origin` and
`Referer` are request headers that any non-browser client sets to whatever it likes. So today,
anyone who can load one of a customer's pages can read that customer's published copy with `curl`
and a forged `Origin`. What the check actually prevents is a cross-site **browser** read — a page
on another domain reading, through a visitor's browser, text that is already public on the
customer's own page. It never kept published copy from anyone.

Two consequences, stated rather than assumed:

- **Not-yet-public sites.** A site registered for a domain that is not live yet now has its
  published rows readable by anyone who holds its site id. Today, the same reader needs the
  snippet's token and a forged `Origin`. Every token holder has the site id — it is the token's
  first segment (`<siteId>.<issuedAt>.<hmac>`) and sits beside it in the same snippet — but the
  site id also travels where the token does not: every outgoing webhook envelope carries
  `site_id` (`deliverWebhook` in `src/lib/webhooks/manager.ts`), so every receiver and its logs
  have it, and the dashboard puts it in the query string of its own API requests
  (`/api/webhooks?siteId=…`, `/api/bulk/export?siteId=…`). So for a site that is not live yet,
  the audience that can read its published rows grows from token holders to site-id holders.
  This decision accepts that wider audience; it does not claim the two are the same. Copy that
  is not ready for visitors belongs in staging, which this read never serves.
- **Cross-site browser reads.** They become possible (`Access-Control-Allow-Origin: *`, no
  credentials). They read the same text the customer serves to every visitor.

### Compensating controls

- **Fixed public projection** — the helper rebuilds every row from named fields, so a widened
  select cannot leak a column through it, and a row carrying `staging_content`,
  `staging_updated_at` or `published_by` fails the whole response (500) rather than being trimmed.
- **One page per request, plus the site's shared rows.** There is no unauthenticated whole-site
  read and no page index. But shared rows (`page_path IS NULL`) come with every page, exactly as
  the content GET returns them, and an author-written `data-rcf-id` — the anchoring the
  integrator doc recommends — is reported by the embed with no page path, so it is stored as a
  shared row. A request for any page path, known or not, therefore returns all of the site's
  shared rows, and every page's payload grows with the number of site-wide anchors, toward the
  1 MiB cap. A page over the cap fails closed with a 500; once the shared rows alone pass it,
  every page of the site does.
- **One parameter set per snapshot.** The CDN keys on the query string, so the route accepts the
  three parameters in order, as `URLSearchParams` serializes them, a lowercase UUID site id, a
  canonical page path (`normalizePagePath`, and no trailing slash but `/`), and a language and
  variant of 1–64 characters without control characters. Another order, an extra, repeated or
  missing parameter, or an invalid value is a 400 with `Cache-Control: no-store`, before the
  limiter and before the database. This saves CDN entries; it is not the abuse bound.

  **Percent-encoding spellings are served as the canonical key (owner decision, 2026-10-07).**
  Measured on `next start` (Next 16.3.8, s65a review): the handler never sees the raw query. Next
  re-serializes it, URLSearchParams-style, before the route runs, so percent-encoding spellings
  of the same values (`page=/` or `%2f` for `page=%2F`, `%65n` for `en`, `%20` for `+`, a trailing
  `&`) arrive canonical and are served as the canonical key. `e2e/published-snapshot-ssr.spec.ts`
  asserts this against a running server: the refused forms above answer 400 `no-store`, and `page=/` and
  `page=%2f` answer 200 with the canonical body and ETag. Refusing those spellings would take
  `skipProxyUrlNormalize`, a global Next flag that changes the URL every middleware path sees,
  plus a second canonical check in the middleware. The owner amended the Abuse criterion
  instead: any caller can already mint unlimited distinct canonical keys (any page, language or
  variant), each a cache miss costing at least three queries, so refusing other spellings never
  bounded anything. The limiter below does, for canonical random keys and every other form alike.

- **A per-IP limiter before the first query — the abuse bound** (`IP_GENERAL`, fail open — a
  public read).
- **A 1 MiB body cap**, failing closed with an uncached 500.
- **No cookie read or set**, and the path is in the middleware's `isSessionlessPath`, so
  `auth.getUser()` cannot rotate a session cookie onto it.
- **No write.** The route reads `sites.id` and the public projection of `content_elements`.

### Freshness and retraction: a lifetime, not an invalidation

Headers on 200, 304 and 404 (confirmed against
https://vercel.com/docs/caching/cache-control-headers):

- `Vercel-CDN-Cache-Control: max-age=30, stale-while-revalidate=30` — top priority, applies to
  Vercel's cache only, consumed at the edge. A response can be served at most 60 seconds after it
  was read from the database.
- `Cache-Control: public, max-age=0, must-revalidate` — forwarded as is. A browser or any cache in
  front of the host revalidates every time, cheaply, through a strong `ETag` (sha256 of the body)
  and `If-None-Match` → 304.
- No `s-maxage` (a downstream shared cache would add its own lifetime on top), and no
  `stale-if-error` (an outage would keep serving retracted copy for as long as it lasted). Errors
  are `no-store`.
- No second cache under the CDN: no `export const revalidate`, no `unstable_cache`, no fetch
  cache. A test pins the module's exports and source.

The bound is therefore **≤ 60 seconds after a commit, at our edge**, for every writer, including
writers not written yet, because nothing depends on a writer announcing its change. A superseded
value, a deleted element and a deleted site (404, cached for the same 60 s) all disappear within
it. A host's own HTML caching adds to that bound; that is the host's to choose.

The CDN cache is per deployment, so a deploy starts every key cold. `Vary: Origin` comes from the
shared public-CORS helper; it is not a high-cardinality header for Vercel, but it does give each
browser origin its own entry. A server-side fetch sends no `Origin` and shares one entry.

### Plan rule

Public delivery never depends on the owner's plan (s51 AC 3, ADR 041). The route reads no plan,
entitlement or permission, and a lapsed owner's snapshot keeps serving. No new exposure, no new
lockout.

### s62's fate

s62 (PR #61, "versioned public content cache", ADR 045 on its branch) is superseded on the visitor
read path. Its migration `20261005000000_versioned_public_content_cache.sql` is already applied in
production, so it lands on main byte-identical through this story, with its database tests.
Nothing in s65a reads its revision: the revision rotates on every `content_elements` statement,
staging-only and no-op updates included, so it is not a "published changed" signal. Whether to
keep its triggers (a write-path lock per statement) is a follow-up decision. Merging PR #61 now
requires rebasing it onto `public-rows.ts` first, or it reintroduces a second allow-list; closing
it is the owner's call.

## Considered options

- **CDN caching on the authenticated content GET.** Rejected. Every widget request carries
  `Authorization`, which Vercel never caches, and the response depends on that credential and on
  the request's `Origin`. Caching it would mean either caching an authorization decision or
  dropping the check — which is this ADR, without its controls or its one-URL rule.
- **Redis behind fresh authorization (s62).** Rejected for the visitor path. It keeps the
  per-request authorization round trip and the token, so a host's server still needs a credential
  and a visitor's browser still pays an origin round trip; it cannot reach the host's first paint.
  It also needs a transactional revision on every content write to stay correct.
- **A snapshot file in a Supabase Storage bucket, rebuilt on publish.** Rejected. The only bucket,
  `assets`, is image-only by MIME allowlist (`20260801000000_storage_assets_bucket.sql`). A JSON
  snapshot would need a new public bucket written by every one of the seven writers — a
  rebuild-per-writer design that is wrong the day one is missed. Per the s65a plan's evaluation,
  its CDN invalidation also depends on the Supabase plan and offers no purge API we could call
  from those writers.
- **Permanent versioned URLs** (`/published/<site>/<revision>.json`, immutable). Rejected.
  Retraction is a requirement: an unpublished or deleted element, or a deleted site, must stop
  being served. An immutable URL, once fetched and cached anywhere, serves forever. A bounded
  lifetime on one current URL is the only shape where retraction has a bound.

## Consequences

**Easier.**

- A host can render published copy into its own HTML from a plain unauthenticated `fetch`, with no
  SDK and no credential. The embed stays the zero-migration default, the editor and the fallback.
- Freshness is correct for every writer by construction; there is no invalidation list to keep.

**Harder.**

- The 60-second bound is real. An editor who publishes sees the change on an integrating host
  within a minute, not instantly. s65b (signed `content.published` webhooks) is how a static or
  long-caching host learns when to rebuild.
- The content GET keeps its inline projection until s65c; the parity test is what holds the two
  together until then.
- This is a second public read surface. Any change to what the content GET serves must be judged
  for this route too — and the parity test will fail until it is.

**Watch.**

- Speed is measured, not inferred: 20 fresh-connection production requests must be CDN hits with
  server wait p50 ≤ 80 ms and max < 200 ms (`scripts/measure-published-snapshot.mjs`), recorded
  after the authorized deploy.
- The remote migration ledger (`supabase migration list --linked`) must show
  `20261005000000` as applied, matching the file, before merge. The operator runs it; this
  environment is not linked.
- Percent-encoding spellings are served (see "One parameter set per snapshot"). Measure on the
  preview whether two spellings of one key share an `x-vercel-cache` entry. If they do not, each
  is an extra miss inside the same per-IP limit, which the owner accepted on 2026-10-07; reopen
  only with a measured cost.
- Shared-row growth. Every page carries all of a site's shared rows, so a site with many
  authored anchors approaches the 1 MiB cap on every page at once.
