---
validated: no
---
# Plan — Story s09-section-impressions

Branch: `feature/s09-section-impressions`
Research: `docs/research/s09-section-impressions.md` — read it first; this plan does not repeat it.

## Target story

`s09-section-impressions` (`docs/stories.md:574-627`), all nine acceptance criteria.
Design: `docs/designs/s09-section-impressions.md` (+ `.html`, reference only).

**Three scope decisions taken here, each of which the human checkpoint is being asked to
confirm because none can be deferred past the first migration.**

1. **Impression rows carry a normalised `page_path`.** Research's premise finding:
   `computeStableElementId` is page-blind, so "per section" silently means "per section per
   *template*" — `/about`'s hero and `/pricing`'s hero merge into one count on any templated
   site, which is exactly the customer the PRD targets. Carrying the path as a **second
   dimension on the impression row** fixes the count without touching `content_elements`, so
   defect A-14 / decision D2 stays independently decidable and the three `test.failing` cases
   at `src/__tests__/embed/element-id-page-scope.test.ts:157,187,214` stay red until someone
   fixes them on purpose. This is *not* a second identity scheme: the section is still
   `content_elements.element_id` from `computeStableElementId`, unchanged. The design already
   assumes this dimension exists — its "Not tracked" state reads *"has no page dimension
   recorded yet"*.
2. **Entitlement is enforced twice, and the authoritative copy is server-side.** AC 7 has two
   halves that pull apart: "unentitled accounts see an upgrade prompt" (dashboard, easy) and
   "the widget sends no impression events for them" (widget must know its site's plan, which
   it has no way to learn today). Ingest discards for unentitled sites — that is the layer
   that protects the money and cannot be bypassed by a copied token. The widget additionally
   suppresses on a boot signal so the literal words of AC 7 are true. See task 4 for why the
   signal is a response header and not a body field.
3. **The design's two-tile summary strip is dropped.** The designer flagged it as an
   interpretive addition required by no AC and said it drops cleanly. It does: nothing else
   in the design depends on it. The page-level **upgrade banner** stays — AC 7 requires it.

**Split considered and not recommended.** The repo's own precedent (`s11a-ab-data-plane` /
`s11b-ab-surface`) puts the seam between data plane and surface. Applied here the cut falls
after task 10, leaving `s09b` at two tasks — a read route and one card stat. That is not a
story, it is a branch, a PR and a review cycle spent on two tasks, and it produces exactly the
"dark feature" (data nobody can see) that `docs/stories.md` opens by warning about. Twelve
tasks is the honest floor for five surfaces, not a bloated plan. If the operator wants the
split anyway: `s09a` = tasks 1-9 + 12, `s09b` = tasks 10-11.

**ADR required: `docs/decisions/015-impression-grain-and-anonymity.md`** (written; see task 2
and travelling with this branch. It records what a future agent will otherwise "simplify" back
into a bug: the grain is `(site, element, page_path, day)`; rows are **upsert-incremented**,
never appended per event; there is no visitor key, no cookie, no fingerprint and no page-view
id — option C (making `s09` visitor-keyed to serve `s12`) was rejected and `s12`'s dependency
on this story was dropped instead (`stories.md:149-161`, review M2). It must also record the
collateral finding: the widget already sets a one-year `rcf_vid` cookie unconditionally at
`recopyfast.src.js:2975`, so the consent-scope claim is *"the impressions feature adds no
identifier"*, never *"RecopyFast sets none"*.

**Sequencing.** `s06a` must have landed (byte gate). `s01` must have landed (entitlement).
See the AC 8 interdict below for what `s06a` alone does *not* unblock.

## Tasks (ordered)

- [ ] **1 — A controllable `IntersectionObserver`, before any observer code exists.**
  New `src/__tests__/support/intersection-observer.ts` (not a suite — `jest.config.js:48`
  matches only `*.test.*`/`*.spec.*`). Export a class implementing `IntersectionObserver`
  whose `observe` records the target and does **nothing** until the test drives it, plus
  `enter(target, ratio)` / `leave(target)` helpers that synthesise an
  `IntersectionObserverEntry` with a real `intersectionRatio`. Follow
  `src/components/landing/__tests__/InteractiveHero.attract.test.tsx:40-74`, which is the
  working precedent for assigning over `global.IntersectionObserver` in `beforeEach`, but make
  this one *controllable* rather than always-intersecting — an always-intersecting double
  cannot fail AC 2 either.
  **Verifies:** its own suite asserts (a) a target observed but never driven produces zero
  callback invocations, and (b) that the double is in place — a guard test that constructs
  `global.IntersectionObserver` and asserts `observe` is not the `jest.setup.js:177-182` no-op.
  Without (b) the whole story's test suite can silently revert to vacuous.

- [ ] **2 — Migration: `section_impressions`, its RLS policy and its increment function, in
  one file.** `supabase/migrations/<YYYYMMDDHHMMSS>_section_impressions.sql`.
  Columns: `id uuid pk`, `site_id uuid not null references sites(id) on delete cascade`,
  `element_id text not null`, `page_path text not null`, `bucket_date date not null`,
  `impression_count integer not null default 0`, `created_at`, `updated_at`.
  `unique (site_id, element_id, page_path, bucket_date)` — this is the grain, and per AGENTS.md
  non-negotiable 5 it cannot be edited later. Index `(site_id, bucket_date)` for `s10`.
  Column comment on `bucket_date` naming **UTC** explicitly (`s10`'s timezone trap starts here).
  RLS **in this same migration** (ADR 002 §1): `select` for a user holding any
  `site_permissions` row on `site_id`; **no** client `insert`/`update`/`delete` policy at all —
  writes arrive only through the service-role ingest route.
  `increment_section_impressions(p_site_id uuid, p_rows jsonb)`: one `insert … select from
  jsonb_to_recordset … on conflict (site_id, element_id, page_path, bucket_date) do update set
  impression_count = section_impressions.impression_count + excluded.impression_count,
  updated_at = now()`. One statement, not a read-then-write — AGENTS.md, "multi-step writes go
  through a Postgres function". `security definer` with a pinned `search_path`, matching
  `20260809120000_lock_down_definer_functions.sql`. Write ADR 006 in this task.
  **Verifies:** a migration test asserts the unique constraint rejects a duplicate grain, that
  calling the function twice with the same batch yields `2 × count` (it increments, it does not
  overwrite), and that a signed-in user with no `site_permissions` row on the site selects zero
  rows under RLS.

- [ ] **3 — `POST /api/impressions/[siteId]` — the ingest route.**
  New `src/app/api/impressions/[siteId]/route.ts`. `params` is a `Promise` and must be awaited
  (Next 16). Order, and the order is load-bearing: validate `siteId` as a UUID → **rate limit**
  → `authorizeIngestRequest(request, siteId)` → validate body → write. AGENTS.md: rate limit
  *before* authorization, because auth itself costs a `sites` lookup.
  New preset in `src/lib/security/rate-limiter.ts`: `SITE_IMPRESSION_INGEST: { windowMs:
  60_000, maxRequests: 300 }`, keyed on `siteId` with `identifierType: "api_key"` and
  **`onStoreFailure: "deny"`** (ADR 002 §4 — the token is published in the customer's own
  markup, so losing Redis must not remove the bound). The arithmetic, and put it in the
  comment: a page view flushes at most twice, so 300/min covers ~150 concurrent page views per
  site per minute; none of the existing presets is site-keyed and `API_CONTENT` at 100/min
  would drop real data on a modestly busy site, which is the failure the story's own note warns
  about. Body: an array of `{elementId, pagePath, count}` capped at **100 rows per request**
  and `count` capped at 100 per row, validated with `src/lib/api/validation.ts` only (ADR 003 —
  no zod); extend that module rather than inlining checks. `page_path` is normalised
  **server-side** (`src/lib/impressions/page-path.ts`: strip query and hash, collapse to a
  leading-slash pathname, cap 512 chars, default `/`) — the client's value is untrusted input.
  `withCors` + `OPTIONS` returning `new NextResponse(null, { status: 204 })`; never
  `NextResponse.json({}, {status: 204})`, which has broken preflight on this codebase twice.
  **Verifies:** 401 with no token, 401 with a bad token (and *not* a session fall-through), 403
  for a session without a permission, 429 past the preset, 400 on an over-cap batch and on a
  non-array body, and a happy path asserting the RPC received the normalised path. One test
  asserts a `?x=1#y` path and a 600-char path both land normalised.

- [ ] **4 — Entitlement: authoritative at ingest, advertised to the widget.**
  Export `resolveSiteOwnerId` from `src/lib/feature-gating/permissions.ts:155` (currently
  module-private — export it, do not duplicate it). New
  `src/lib/impressions/entitlement.ts`: `isImpressionTrackingEnabled(siteId)` =
  `resolveSiteOwnerId` → `getEffectivePlan(userId)` → `kind === "plan"`. `"trialing"` is
  already inside `LIVE_SUBSCRIPTION_STATUSES`, so trialling accounts are entitled with no new
  logic — that is what makes AC 7's "trialling accounts see counts" satisfiable. Memoise per
  site for 60 s so ingest does not put two database round trips and the billing subsystem on
  every flush. Ingest returns `202` and writes **nothing** for an unentitled site (a silent
  discard, not an error — the widget must not start retrying on a customer's page).
  The widget's boot signal rides on `GET /api/content/[siteId]`, which the widget already calls
  during `hydrateStoredContent()`, as an **additive response header** `X-RCF-Impressions:
  on|off` — *not* a body field. Reason, and it needs a tombstone comment: that route returns a
  bare array today, `/embed/recopyfast.js` is a permanently-cached public URL (non-negotiable
  2), and during a deploy window a cached older widget will call the new route. A header is
  invisible to it; a shape change is not. Add `Access-Control-Expose-Headers` so the widget can
  read it cross-origin — without that the header is present and unreadable, which fails
  silently in exactly the way this codebase keeps getting bitten by.
  **Verifies:** ingest writes zero rows for an unentitled site and still answers 202; writes
  rows for a `kind === "plan"` site and for a trialling one; the content route emits `off` for
  an unentitled site and `on` for an entitled one; a test asserts `Access-Control-Expose-Headers`
  names the header.

- [ ] **5 — The widget's impression block: a marked, sliceable seam.**
  `public/embed/recopyfast.src.js`. Delimit with `// SECTION IMPRESSIONS` …
  `// END SECTION IMPRESSIONS` and expose a single factory
  `createImpressionTracker({ document, window, send, now })` returning
  `{ start, stop, observe, flush, resetPageView }`. This shape is not decoration: it is the
  only way the widget code becomes testable, because the established pattern for testing this
  file (`src/__tests__/embed/element-id-page-scope.test.ts:60-70`) reads the source, slices a
  marked block and `new Function(...)`s it. A tracker that reaches for globals cannot be
  sliced, and every subsequent task in this story would then be tested only through a full
  widget boot, which no existing test does. No behaviour in this task beyond the seam and a
  no-op `start`.
  **Verifies:** a loader test slices the block, builds the factory against a JSDOM document and
  the task-1 observer double, and throws a loud named error if either marker is missing —
  mirroring the existing loader's error, so a future agent who moves the markers is told why.

- [ ] **6 — Dwell: ≥ 50% for ≥ 1 continuous second, once per section per page view.**
  Observe every element in `this.elements` (the `Map` `scanForContent()` populates at `:890`)
  with `threshold: [0.5]`. On an entry crossing ≥ 0.5, start a 1,000 ms timer; on falling below
  0.5, clear it. On the timer firing, record the impression and **unobserve** that element for
  the remainder of the page view — dedupe by construction rather than by a `Set` lookup on a
  hot path, and it is byte-cheaper. Named constants (`IMPRESSION_RATIO`, `IMPRESSION_DWELL_MS`),
  not literals.
  **Verifies:** AC 1 — enter at 0.6, advance 1,000 ms, exactly one impression. AC 2 — enter at
  0.6, advance 900 ms, leave: **zero** impressions (this is the criterion that ships broken if
  task 1 was skipped). Ratio boundary — enter at 0.49 for 2 s records nothing. AC 3 — enter,
  dwell 1 s, leave, re-enter, dwell 1 s: exactly one.

- [ ] **7 — Page-view boundaries, including the SPA route change.**
  A page view begins at boot and again whenever `location.pathname` changes. Listen for
  `popstate`, and wrap `history.pushState` / `history.replaceState` so they call through to the
  original and then notify — never replace. On a boundary: flush the pending batch under the
  **old** path, clear the dedupe state, re-observe every element. Separately, extend the
  existing `MutationObserver` (`:3339-3357`, `childList` + 500 ms debounce → `scanForContent()`)
  so newly discovered elements are observed — DOM churn is *not* a new page view, and
  conflating them is how AC 3 breaks. Capture `location.pathname` at the moment an impression
  is recorded, not at flush time, or a route change mid-batch attributes the previous page's
  impressions to the new path.
  **Verifies:** a `pushState` to a new path resets dedupe, so the same element can impress
  again — and impresses under the **new** path. A `pushState` to the *same* path does not
  reset. A `MutationObserver` rescan that adds an element does not reset dedupe for existing
  ones. A test asserts the original `pushState` still runs (the host page's routing must not
  break — AGENTS.md non-negotiable 4).

- [ ] **8 — Do Not Track, GPC, and the entitlement suppression.**
  Suppress when any of `navigator.doNotTrack`, `window.doNotTrack`, `navigator.msDoNotTrack`
  equals `"1"` or `"yes"`, or `navigator.globalPrivacyControl === true`. Everything else —
  including `null`, `undefined`, `"0"`, and Safari, which removed the API — allows. Research
  open question 6 notes there is no precedent in this repo, so this **is** the decision; record
  it in a comment naming the values and why, because AC 9 is untestable without it. Suppression
  means the tracker never starts and **no observer is attached at all** — not "observes and
  discards". Same for `X-RCF-Impressions: off` from task 4.
  **Verifies:** each suppressing value produces zero `observe` calls and zero sends; `"0"` and
  `undefined` produce a working tracker; `off` from the header produces zero of both. One test
  asserts no cookie is written and no identifier appears anywhere in a sent payload — the
  standing guard on AC 9.

- [ ] **9 — Batch, flush, and wire into boot.**
  Accumulate `{elementId, pagePath}` into an in-memory count map. Flush on `visibilitychange`
  → `hidden` and on `pagehide` — **not** `beforeunload`, which frequently does not fire on
  mobile Safari and whose only use in this file (`:4172,4230`) is the edit-mode unsaved-changes
  guard and must not be extended. Deliver with `navigator.sendBeacon`, falling back to
  `fetch(..., { keepalive: true })`, mirroring `sendTrackEvent` (`:3163-3179`); token on the
  query string as that helper already does. Also flush on a size cap (100 rows, matching the
  route's) so a long-lived SPA session does not accumulate unboundedly. Empty batch sends
  nothing. Start the tracker in `init()` alongside the other non-staging telemetry
  (`:898-906`), **after** `scanForContent()`, and **never in staging mode**. Wrap the whole
  entry point in `try/catch`: no impression failure may reach the host page's `window`.
  **Verifies:** AC 4 — dwell 1 s, dispatch `visibilitychange` with `visibilityState: "hidden"`,
  assert exactly one beacon carrying the right counts; same for `pagehide`. Zero impressions →
  zero beacons. A tracker whose `send` throws does not throw out of the event handler. A
  staging-mode boot attaches nothing.

- [ ] **10 — `GET /api/impressions/[siteId]` — the read side.**
  Same `route.ts` as task 3 (one file per path; `analytics/track/route.ts` is the precedent for
  `GET` + `POST` + `OPTIONS` with different auth per method). `authorizeSiteReadAccess`, then
  `enforceRateLimit` on `USER_GENERAL` keyed on the user. Returns totals per `element_id` over
  a bounded window (default 30 days, capped), plus the number of distinct paths that
  contributed. Unentitled → `403 { error, upgradeRequired: true }`, matching `s01`'s
  convention, so the client can tell "locked" from "failed" — the design's Unentitled and Error
  states are different treatments and must not collapse into each other.
  **Verifies:** an entitled owner gets totals; an unentitled one gets 403 with
  `upgradeRequired: true`; a user with no permission on the site gets 403 **without** it; an
  out-of-range window is clamped, not honoured; totals sum across paths and the path count is
  right.

- [ ] **11 — The dashboard surface.**
  `src/hooks/useImpressions.ts` — `useState` + `useEffect` + `fetch` returning
  `{ data, loading, error, refetch }`, per AGENTS.md, with `useSites.ts` as the reference: a
  non-ok response produces an **error state, never an empty map**. A 403 with
  `upgradeRequired` produces a third state, `locked` — not an error.
  New `src/components/dashboard/ImpressionStat.tsx`, composed only from `src/components/ui/`
  (`Skeleton`, `Badge variant="outline"`, lucide `Eye` / `CircleDashed` / `Lock`) — invent
  nothing. Its six states are the design's table and they are the point of the component:
  loading → `Skeleton h-4 w-12`; error → `text-sm text-muted-foreground` "Unavailable"
  (`Metric`'s own copy); success → `Eye` + `.text-metric .tabular` + "impressions"; **zero
  tracked** → the identical treatment with a rendered `0`; **not tracked** → `CircleDashed` + an
  em dash, **no digit and never the `.text-metric` class**, with a `title` saying why;
  unentitled → `Lock` + `Badge` "Pro" + `text-primary hover:underline` "Upgrade to see
  impressions". Zero and not-tracked must be structurally impossible to confuse — one branch
  renders a digit, the other cannot.
  Attach it in `ContentElementCard.tsx` to the row that holds the section's *current* text: the
  "Live" row when `isEdited`, the "Original" row otherwise. `title` names how many pages
  contributed to the total, so a templated site is told its count spans pages rather than being
  quietly misled. Add the upgrade banner above the list in `src/app/dashboard/content/page.tsx`
  — a `Card` (`default`) with `IconTile tone="accent"`, a `Button` (`default`) "Upgrade to Pro"
  and a `Button` (`link`) — shown once, page-level, because entitlement resolves per account and
  not per element. Sentence case; no toast (there is no primitive and this story does not add one).
  **Verifies:** each of the six states renders its own treatment; a count of 0 renders the digit
  `0` **and** the not-tracked case renders no digit — asserted as two separate tests, because
  collapsing them is the specific regression the design calls non-negotiable; the stat attaches
  to the Live row for an edited element and the Original row for an unedited one; a failed fetch
  renders "Unavailable" and **not** a zero; unentitled renders the banner once and the locked
  stat on every card.

- [ ] **12 — Byte budget and the built artifact.**
  `npm run build:embed`, then measure: `gzip -9c public/embed/recopyfast.js | wc -c` for the
  artifact and the same with the `socket.io-client.min.js` prefix removed for widget code
  alone. Record the **delta** against the pre-story baseline in the PR description. Delta must
  be ≤ 2,000 gz. Read the AC 8 interdict below before touching `MAX_WIDGET_GZ`. Run the full
  suite: `lint`, `type-check`, `format:check`, `build`, `test`.
  **Verifies:** `s06a`'s gate runs and its verdict is recorded, `build:embed --check` passes
  (no stale artifact), and the measured delta is in the PR.

## Run interdicts

1. **Never assert impression behaviour against the global mock.** `jest.setup.js:177-182`
   returns `observe: jest.fn()` — a no-op that delivers no entry, so *every* "no impression was
   recorded" assertion passes for the wrong reason. AC 2 is the one that ships broken. Every
   impression test installs the task-1 double in `beforeEach`. **Do not edit `jest.setup.js`** —
   other suites depend on the current stub; override locally.
2. **AC 8 is not fully checkable in this story, and must not be faked.** The widget is 46,781 gz
   today against a 30,000 ceiling. `s06a` seeds `MAX_WIDGET_GZ` at 34,063 as a **ratchet that
   never regresses** (`stories.md:128`), so adding 2,000 bytes *fails that gate by design*. The
   ≤ 2,000 half of AC 8 is verifiable now, as a measured delta. The "total stays ≤ 30,000" half
   is not achievable until `s06c` and `s08` land. Do **not** raise `MAX_WIDGET_GZ` to make the
   build green — that repeals `s06a`. Record the total half as blocked-by-`s06c` in the PR and
   in the review, explicitly, rather than silently green. If the operator wants AC 8 fully
   satisfied in this story, `s09` must be sequenced after `s06c`.
3. **No visitor key. Ever.** No cookie, no fingerprint, no `visitor_id`, no `session_id`, no
   page-view id crosses the wire. The `pagePath` field is a page dimension, not a person. If a
   task appears to need a per-visitor key, stop — `s12`'s dependency on this story was dropped
   precisely so that pressure never lands here (`stories.md:149-161`).
4. **Do not extend `/api/analytics/track`** or widen its `ACTION_TYPES`. That union is
   `satisfies readonly UserActivityLog["action_type"][]`, so widening it widens the activity-log
   type across the app, and `s03` depends on that log staying cheap.
5. **`recopyfast.js` is generated.** Edit `.src.js`, then `npm run build:embed`. Do not rename or
   move `// STABLE ELEMENT IDENTITY` (`:680`) or `class ReCopyFast {` (`:826`) —
   `element-id-page-scope.test.ts:60-70` slices between them and fails loudly by design.
6. **The widget degrades, never breaks.** Every impression path inside `try/catch`; the
   `history` wrapper always calls through to the original; a failed flush is dropped, never
   retried in a loop. There is no error surface on the customer's domain, so a broken branch
   presents to them as "editing stopped working on one site".
7. **Service-role rules are not optional.** `authorizeIngestRequest` before any data access, and
   a site-keyed limiter with `onStoreFailure: "deny"` (ADR 002 §3-4). Do not write a fourth auth
   path.
8. **RLS ships in the migration that creates the table** (ADR 002 §1, AGENTS.md 6). Never edit an
   applied migration; the grain in task 2 is permanent from the moment it lands.
9. **No zod** (ADR 003). `src/lib/api/validation.ts`, extended where it falls short.
10. **Compose from `src/components/ui/`.** Do not invent a primitive. The design names a real gap
    — there is no canonical "value gated behind a plan" pattern — and the answer is to compose
    from existing primitives and *report* the gap, not to fill it freestyle.
11. **Do not modify an existing test to accommodate new behaviour.** Change the behaviour, or
    change the test and say so in the PR.
12. **No new hardcoded hex in `recopyfast.src.js`.** It has 103; the next one is what stops the
    token conversion from ever paying off.

## The point everything turns on

**The grain of `section_impressions` is the one decision in this story that cannot be taken
back.** AGENTS.md forbids editing an applied migration, `s10` builds its daily aggregation and
its pruning job directly on this table, and the dashboard's zero-versus-not-tracked distinction
— the one thing the design calls non-negotiable — is only expressible if a missing row means
"never observed" rather than "merged into some other page's row". Get `(site_id, element_id,
page_path, bucket_date)` wrong and every later story inherits it: without `page_path` a
templated site's counts merge silently and the feature misleads the exact customer it is sold
to; with an append-only event row instead of an upsert-increment, `s10` inherits a table it
cannot prune and the volume risk the story names in its own Risk paragraph comes true.

Everything else here is recoverable. The observer thresholds, the DNT value list, the rate-limit
numbers, the card layout — all changeable next week. The migration is not.

And the thing that decides whether any of it is *true*: task 1. Until a controllable
`IntersectionObserver` exists, every assertion in tasks 6 through 9 passes whether or not the
code works, because the global mock delivers no entries at all. Writing the observer first and
the tests second yields a green suite that asserts nothing — which is worse than no tests,
because it is believed.

## Files touched

**New**
- `supabase/migrations/<YYYYMMDDHHMMSS>_section_impressions.sql`
- `docs/decisions/015-impression-grain-and-anonymity.md`
- `src/app/api/impressions/[siteId]/route.ts` — `POST` (ingest), `GET` (read), `OPTIONS`
- `src/lib/impressions/page-path.ts` · `src/lib/impressions/entitlement.ts`
- `src/hooks/useImpressions.ts`
- `src/components/dashboard/ImpressionStat.tsx`
- `src/__tests__/support/intersection-observer.ts` (helper, not a suite)
- Suites: `src/__tests__/embed/impressions.test.ts`,
  `src/app/api/impressions/[siteId]/__tests__/route.test.ts`,
  `src/components/dashboard/__tests__/ImpressionStat.test.tsx`,
  `src/lib/impressions/__tests__/page-path.test.ts`,
  `src/__tests__/support/__tests__/intersection-observer.test.ts`

**Modified**
- `public/embed/recopyfast.src.js` (source) → `public/embed/recopyfast.js` (built, never hand-edited)
- `src/lib/security/rate-limiter.ts` — `SITE_IMPRESSION_INGEST` preset
- `src/lib/api/validation.ts` — extended for the batch array
- `src/lib/feature-gating/permissions.ts` — export `resolveSiteOwnerId`
- `src/app/api/content/[siteId]/route.ts` — `X-RCF-Impressions` + `Access-Control-Expose-Headers`
- `src/components/dashboard/ContentElementCard.tsx` — the stat on the current-content row
- `src/app/dashboard/content/page.tsx` — hook wiring + upgrade banner
- `docs/stories.md` — tick `s09`; `docs/architecture.md` — the new table, and correct the entry
  that files `conversion_events` under A/B when it is the Stripe billing funnel
  (`20260731002000_missing_tables_audit_analytics.sql:154-164`)

**Do not touch:** `jest.setup.js`, `src/app/api/analytics/track/route.ts`,
`public/embed/recopyfast.js` by hand, any applied migration.

## Test strategy

TDD, and the order is not negotiable: **task 1 before task 6**, because the tests for AC 1-4 are
worthless without it. Each task's "Verifies" line above is its red test.

- **Widget** (`src/__tests__/embed/impressions.test.ts`) — slice the `// SECTION IMPRESSIONS`
  block out of `recopyfast.src.js` and `new Function` it, exactly as
  `element-id-page-scope.test.ts:60-70` does for the identity helpers. Drive it with the task-1
  observer double, `jest.useFakeTimers()` for the 1 s dwell, a JSDOM document for the elements,
  and a `send` spy for the beacon. Covers AC 1, 2, 3, 4, 9 and the widget half of AC 7. This is
  the first suite in the repo to exercise widget *behaviour* rather than a pure helper; the
  factory seam in task 5 is what makes it possible, which is why task 5 exists.
- **Ingest and read routes** — auth matrix (no token / bad token / session without permission /
  session with permission / valid site token), the 429, the body caps, path normalisation, the
  entitlement discard, and `upgradeRequired` on the read side. Covers AC 5 and the server half
  of AC 7.
- **Migration** — grain uniqueness, increment-not-overwrite, and an RLS test proving a
  non-member selects zero rows. Covers ADR 002 compliance, which is the thing a security review
  will look at first on a service-role route.
- **Dashboard** — the six stat states as six tests, with **zero** and **not-tracked** asserted
  separately and explicitly; error-is-not-empty; the stat lands on the Live row for an edited
  element and the Original row otherwise. Covers AC 6 and the UI half of AC 7.
- **Byte budget** — measured, not asserted in a unit test; `s06a`'s gate is the mechanism.
  Covers the checkable half of AC 8. See interdict 2.

Coverage thresholds in `jest.config.js` are a ratchet at today's floor (22% lines). This story
adds substantial tested code; raise them to the new measured floor, never lower them.

## Definition of Done

- All twelve tasks ticked, each with its test green for the right reason.
- The task-1 guard test proves the global `IntersectionObserver` mock is overridden in every
  impression suite. A green suite that has not proven this is not done.
- `lint`, `type-check`, `format:check`, `build`, `test` all green; `build:embed --check` reports
  no stale artifact.
- Measured gzip delta for the widget recorded in the PR, ≤ 2,000. The "total ≤ 30,000" half of
  AC 8 explicitly recorded as blocked-by-`s06c`/`s08` if the shrink has not landed — stated, not
  omitted.
- `docs/decisions/015-impression-grain-and-anonymity.md` written and on the branch, with the
  rejected options (visitor key; page-view key; template-scoped counts) and why.
- No cookie, no identifier and no `visitor_id` anywhere in the diff — grep the diff before the PR.
- One commit for the story, plus a second for the migration alone (it is the thing you would
  want to revert on its own). Research, design and this plan travel in the story commit.
- Design system gaps reported, not filled: no canonical "value gated behind a plan" pattern and
  no upsell banner primitive exist; `s11b` and `s13` will need the same answer, and codifying it
  belongs to whichever ships second — not to this story.
