---
validated: yes
---
# Plan — Story s65a-published-copy-snapshot

Branch: `feature/s65a-published-copy-snapshot`
Research: `docs/research/s65a-published-copy-snapshot.md` — read it first; this plan does not repeat it.

## Target story

`docs/stories.md` → s65a. An unauthenticated, page-scoped, CDN-cached read of the current
published rows at `GET /api/published/[siteId]?page=<path>&language=<lang>&variant=<variant>`:
same projection as today's public read, ≤ 60 s freshness and retraction at our edge, never gated
by plan, abuse bounded before the database, measured, proven flash-free in a browser, recorded
in ADR 046. AC 0 lands s62's applied migration byte-identical.

## Tasks (ordered)

1. [x] **AC 0 — migration ledger.** Copy
   `supabase/migrations/20261005000000_versioned_public_content_cache.sql` from
   `origin/feature/s62-versioned-public-content-cache` with `git show`, and record both sha256
   values (must be equal) in the PR body. Bring only the changes that pin that migration:
   `src/__tests__/db/column-privileges.test.ts` (decision for `sites.public_content_revision`),
   `src/__tests__/db/public-content-revision.test.ts`, and the parts of
   `scripts/run-db-invariants.mjs`, `.github/workflows/ci.yml`, `jest.setup.js` those tests
   need. Exclude everything about the Redis cache runtime (`PUBLIC_CONTENT_CACHE_*`,
   `REDIS_URL`, `site-auth.ts` revision reads). Verify: DB suite green against a local stack
   (`npx supabase start`, then `RCF_TEST_DB_URL=… npx jest src/__tests__/db`). Remote ledger:
   attempt `npx supabase migration list --linked`; if not linked/authorized, record that the
   operator must run it and stop that sub-step (do not link with guessed credentials).
2. [x] **Public-row helper (TDD).** New `src/lib/content/public-rows.ts`: `PUBLIC_CONTENT_COLUMNS`
   (byte-identical to the select at `src/app/api/content/[siteId]/route.ts:393`), a row mapper
   that strips `metadata.staging_attributes` and computes
   `current_content = published_content ?? original_content ?? ""`, and a guard refusing any row
   carrying `staging_content`, `staging_updated_at` or `published_by` (ported from s62's
   `publicRow`/`validateRows`/`PRIVATE_ROW_FIELDS`). Unit tests first.
3. [x] **Canonical key parsing (TDD).** New `src/lib/content/published-snapshot-key.ts`. Input:
   siteId path param + URL search. Rules: siteId is a lowercase UUID; exactly the three params
   `page`, `language`, `variant`, in that order, each once; the search string must equal
   `new URLSearchParams([["page",p],["language",l],["variant",v]]).toString()`; `page` must equal
   `normalizePagePath(page)`; `language`/`variant` bounded (length ≤ 64, no control characters)
   by a rule derived from what writers actually produce (check `src/app/api/ai/translate/route.ts`
   language codes and A/B variant naming; document the rule in a comment). Every other form →
   a typed rejection. Tests enumerate: extra param, missing param, duplicate, reordered,
   `%2F` vs `/` variants, uppercase UUID, trailing slash page, oversized and control chars.
4. [x] **Route (TDD).** New `src/app/api/published/[siteId]/route.ts` with GET + OPTIONS.
   Order: canonical key check (400, no DB, `Cache-Control: no-store`) → IP limiter
   `enforceRateLimit(…, { onStoreFailure: "allow" })` with the public-read justification comment
   → site exists (unknown → 404, negative-cached with the same lifetime) → page + shared rows via
   `src/lib/content/paged-elements.ts` with `PUBLIC_CONTENT_COLUMNS` → helper mapping → body cap
   1 MiB (above → 500 `no-store`, logged) → body
   `{ format: "rcf-published-v1", siteId, pagePath, language, variant, rows }` → strong ETag
   (sha256 of the body), `If-None-Match` → 304 → headers
   `Cache-Control: public, max-age=0, must-revalidate` and
   `Vercel-CDN-Cache-Control: max-age=30, stale-while-revalidate=30` (confirm directive semantics
   against https://vercel.com/docs/caching/cache-control-headers before coding; total ≤ 60 s;
   no `stale-if-error`) → CORS via `src/lib/http/public-cors.ts`. OPTIONS is the existing 204
   preflight. No cookies read or set; no `revalidate`/`unstable_cache`/fetch cache. Service-role
   client with the house-style comment naming ADR 046 as the single exception to the
   `authorize*`-before-service-role rule. Tests: exact headers; no `set-cookie`; zero DB calls for
   every non-canonical form from task 3; 404 unknown site; lapsed-owner site served (no plan
   lookup at all); superseded value and deleted element absent; empty page → 200 `rows: []`;
   oversized → 500; 304 path; **parity**: the same fixture through
   `GET /api/content/[siteId]` (widget-authorized) and the new route yields identical rows.
5. [x] **Freshness by direct SQL.** A real-Postgres test in `src/__tests__/db/` (gated like its
   neighbours) updates `published_content` with SQL, bypassing all app writers, then reads
   through the route's loader and sees the new value; also deletes the element and sees it gone.
6. [x] **Middleware.** Add `/api/published/` to `isSessionlessPath` (`src/middleware.ts:93-104`).
   Middleware test: a request with a Supabase session cookie to that path triggers no
   `auth.getUser()` and returns no `set-cookie`; CSP headers still applied.
7. [x] **Browser proof (Playwright).** New `e2e/published-snapshot-ssr.spec.ts` on the local
   stack (`e2e/support/local-supabase.ts`): seed a site and a published row for a known
   `element_id`; fetch the new route; serve a fixture page whose HTML already contains the
   published text in `<h1 data-rcf-id="<element_id>">` plus the real embed tag (follow
   `e2e/share-edit-publish.spec.ts` for site/origin setup). Assert: a MutationObserver installed
   before the embed records zero text changes on the anchored element through embed settle; the
   row's `original_content` is unchanged in the database afterwards. Update the explicit count
   in `e2e/support/strict-run-contract.ts` (+1) in the same change.
8. [x] **ADR + integrator doc.** `docs/decisions/046-unauthenticated-published-copy-snapshot.md`
   (043–045 are taken on the s61/s62 branches): why token/origin checks are dropped for this read
   only (the token is in page source and Origin is forgeable outside browsers, so today's check
   prevents cross-site browser reads, not exposure), the compensating controls, why no permanent
   versioned URLs (retraction), rejected options (CDN on the authenticated GET; Redis behind
   fresh authorization = s62; Supabase Storage bucket — image-only bucket, plan-dependent
   invalidation, no purge API), s62's fate. Integrator doc
   `docs/architecture/published-snapshot.md` + its row in `docs/README.md`: URL format, response
   shape, ≤ 60 s bound at our edge (host caching adds), retraction, `data-rcf-id` anchoring,
   embed alone is not flash-free, plan rule (ADR 041).
9. [x] **Measurement tooling.** `scripts/measure-published-snapshot.mjs`: N fresh-connection
   requests (server wait = TTFB − TLS, `x-vercel-cache` per request), a reused-connection sample,
   a same-session sample of the current content GET for comparison, and a `--freshness` mode
   that polls until a given text appears/disappears and prints elapsed time. Run against the PR's
   Vercel preview if reachable; the production run is recorded after the authorized deploy.
10. [x] **Gates and commits.** `npm run precommit` and `npm run prepush` green in this worktree
    (no `.env`, CI-equivalent), `npm run test:e2e` green, `npm run build:embed -- --check` clean.
    One story commit (stories, research, plan, code, docs); the migration + its DB tests as a
    separate commit. Tick plan checkboxes as tasks land.

## Run interdicts

- `git diff main...HEAD -- 'src/app/api/content/[siteId]/route.ts'` is empty.
- `git diff main...HEAD -- public/embed/` is empty.
- `package.json`, `package-lock.json`, `server/package*.json` diffs are empty (no new dependency).
- The only new migration is the s62 file, sha256-identical to `origin/feature/s62-versioned-public-content-cache`.
- No file from s62's cache runtime: `src/lib/content/published-content-cache.ts`, its tests,
  `scripts/measure-public-content-cache.mjs`, the `site-auth.ts` revision changes.
- The new route exports no `revalidate`, uses no `unstable_cache`, sets no `stale-if-error`, reads no cookie.
- No `--no-verify`, no edits to `.env*` files, no writes outside this worktree (Codex worktrees,
  other branches and the primary checkout are off limits).
- No push to main, no merge, no deploy, no production database write.

## The point everything turns on

Dropping authorization for one read is safe because today's authorization never protected
published copy from exposure: the site token sits in every page's source and `Origin` is
forgeable by any non-browser client, so the existing check only stops cross-site *browser*
reads of text that is public on the customer's own page. Where this could be wrong:
1. **Projection leak** — the new route exposes something the old one would not. Compare the
   route's rows field-by-field with the content GET (parity test) and against s62's private-field
   list; metadata is served whole today (`translatedFrom`, `aiGenerated`, `tokensUsed`) — parity
   keeps that, it must not widen it.
2. **Not-yet-public sites** — a site registered for a domain that is not live yet now has its
   published rows readable by anyone holding its site id. Compare with today: the same reader
   with the public snippet token and a forged Origin header already gets them. The ADR must say
   this explicitly rather than assume it.
3. **CDN semantics** — `Vercel-CDN-Cache-Control` `max-age` + `stale-while-revalidate` must bound
   staleness to ≤ 60 s, including when the origin errors. Compare against the Vercel header docs
   before coding and against the production freshness probe after deploy.

## Files touched

New: `src/app/api/published/[siteId]/route.ts`, `src/lib/content/public-rows.ts`,
`src/lib/content/published-snapshot-key.ts` (+ colocated `__tests__`), a route test,
`src/__tests__/db/published-snapshot-freshness.test.ts`, `e2e/published-snapshot-ssr.spec.ts`,
`scripts/measure-published-snapshot.mjs`, `docs/decisions/046-unauthenticated-published-copy-snapshot.md`,
`docs/architecture/published-snapshot.md`, the migration file, `src/__tests__/db/public-content-revision.test.ts`.
Modified: `src/middleware.ts` (+ its test), `src/__tests__/db/column-privileges.test.ts`,
`e2e/support/strict-run-contract.ts`, `docs/README.md`, possibly `scripts/run-db-invariants.mjs`,
`.github/workflows/ci.yml`, `jest.setup.js` (task 1 scope only), `docs/stories.md`,
`docs/research/…`, this plan.

## Test strategy

Unit (helper, key parser) → route handler tests with a mocked service client (headers, DB-call
counts, parity, lapsed, retraction, cap, 304) → middleware test → real-Postgres tests (migration
triggers and column grants from s62; direct-SQL freshness) → one Playwright spec for the
no-flash and `original_content` invariants → operator measurements (preview, then production).
Green tests never stand in for the speed and freshness ACs.

## Definition of Done

Repo DoD (single PR, lint/type-check/format/build/test green, review passed, deployed), plus:
every s65a AC checked with its evidence; migration sha256 equality and remote-ledger status
recorded in the PR; ADR 046 and the integrator doc merged; production measurement (20 requests,
thresholds, freshness probe) recorded after the authorized deploy; embed artifact unchanged.

## Fix round 1 — 2026-10-07 (owner: "Fix majors first"; M1 → "Amend the criterion")

Source: `docs/reviews/s65a-published-copy-snapshot.md`. The amended Abuse AC is in `docs/stories.md`.

- [x] F1 (M2) — Run `src/__tests__/db/published-snapshot-freshness.test.ts` by name in CI with
  `RCF_REQUIRE_TEST_DB=1`, the PostgREST URL and the service key, in the e2e-job step that already
  does this for `content-write-privileges`. It must fail CI if the database is unreachable, never
  pass as `[gated]`.
- [x] F2 (M1) — Align code comments (`published-snapshot-key.ts:12`, `route.ts:209`), ADR 046 and
  the integrator doc with the amended AC: the limiter is the abuse bound; encoding spellings are
  served canonical. Add a real-server check (Playwright `request.get` against the running app,
  inside the existing s65a spec — no new spec, count unchanged): reordered/extra/duplicate/missing
  params → 400 `no-store`; `%2F`/`%2f` page spelling → 200 with the same body and ETag as canonical.
  Real-server half proven in CI run 37633742095 at `4966659`: the s65a spec passed on `next start`,
  strict summary 45/45.
- [x] F3 (m1) — ADR 046: drop "the audience is the same"; state that the site id also travels in
  webhook envelopes and dashboard URLs, so a not-yet-public site's published rows reach a wider
  audience than token holders.
- [x] F4 (m2) — Integrator doc and ADR: shared rows (authored `data-rcf-id` anchors are stored
  with `page_path` NULL) are returned for every page; fix "an unknown page is 200 with rows: []",
  and note payload growth with site-wide anchors toward the 1 MiB cap.
- [x] F5 (m4) — One-line pointers to ADR 046 in AGENTS.md "Data access" (the single exception to
  authorize-before-service-role) and in the header comment of `src/lib/http/public-cors.ts`.
  No behaviour change to the shared CORS helper.
- [x] F6 (m5) — Run `scripts/__tests__/measure-published-snapshot.test.mjs` in CI next to the
  existing script test.

Interdicts unchanged. m6 (framing edits on the feature branch) is a coordinator call: kept, same
precedent as s61; the stories changes merge with this PR.

## Fix round 2 — 2026-10-07 (owner: "Fix minors, then ship")

Source: the re-review in `docs/reviews/s65a-published-copy-snapshot.md` (Max severity minor, Ship allowed yes).

- [x] G1 (n1) — Tick F2 above, citing CI run 37633742095 (s65a spec passed on `next start`, strict 45/45).
- [x] G2 (n2) — In `src/__tests__/api/published/route.test.ts`, mark the "literal slash" and
  "lowercase percent hex" refusal cases as route-level only (Next re-serializes them before the
  handler, so production serves them canonical — see the s65a Playwright spec); same note in the
  parser test header. Comments only; assertions unchanged.
- [x] G3 (n3) — Add a trailing-slash page and an oversized language to the real-server refused
  queries in `e2e/published-snapshot-ssr.spec.ts` (same test, Playwright total stays 45), so the
  amended AC's "same refusals hold on a real `next start` server" covers value checks too.
- [x] G4 (n4) — AGENTS.md "API routes" CORS line: add the ADR 046 exception pointer.
- [x] G5 (n5) — `docs/architecture/published-snapshot.md`: state the uncached budget
  (`IP_GENERAL`, 200 requests/min per IP, `published/read` bucket) and advise pacing/retry for
  static builds and shared egress IPs.
