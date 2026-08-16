# Research — Story s11-ab-run-test

> **WARNING — the backlog is not ready.** [`docs/reviews/stories.md`](../reviews/stories.md)
> ends `Max severity: major` / `Stories ready: no`. The operator confirmed proceeding anyway.
> This file is verified context only: no code, no plan. Everything below was read out of the
> repository on 2026-08-16, not recalled.

> **A premise in the story is false.** `s11`'s agentic notes say *"much of this story is
> re-enabling and finishing"* ([`stories.md:588-589`](../stories.md)). The dashboard and the
> API routes are indeed re-enabling. **The data plane is not: `ab_test_results` and
> `visitor_buckets` have never existed in the production database.** The migration that
> creates them (`20260127_ab_testing_v2.sql`) aborted on a `42P01` before reaching them, is
> marked APPLIED in the ledger so it will never run again, and the repair migration that
> recreated `ab_tests`/`ab_test_variants` **deliberately did not recreate those two** and said
> so in writing (`supabase/migrations/20260801200000_missing_base_tables.sql:63-66`). Nothing
> after it creates them either. So today: `POST /ab-tests/track` returns 500 on every call and
> **no A/B event has ever been recorded**, and `/ab-tests/bucket` silently fails to persist any
> assignment. Both failures are invisible — `sendBeacon` discards the response
> (`recopyfast.src.js:3168-3170`) and the bucket route destructures `data` without reading
> `error` (`bucket/[siteId]/route.ts:120`). This is precisely the silent-bucketing failure the
> story's own Risk paragraph predicts, and it is live right now.

---

## The five structuring facts

1. `ab_test_results` and `visitor_buckets` do not exist in production; the migration creating them aborted and is marked applied — `supabase/migrations/20260801200000_missing_base_tables.sql:63-66`, `supabase/migrations/20260127_ab_testing_v2.sql:8,40`.
2. The snippet is a **non-async, non-defer** `<script>` pasted **before `</body>`**, and `init()`'s first statement awaits `DOMContentLoaded` — `src/lib/sites/embed-script.ts:98`, `src/components/sections/HowItWorks.tsx:32`, `public/embed/recopyfast.src.js:868` → `:2321-2329`.
3. Bucketing is deterministic from `fnv1aHash(visitorId + ':' + testId) % 100`, but maps that number onto a variant by walking a Postgres result set that carries **no `ORDER BY`** — `src/app/api/ab-tests/bucket/[siteId]/route.ts:62-71`, mirrored client-side at `public/embed/recopyfast.src.js:3016-3032`.
4. `active`, `bucket` and `track` all call `authorizeSiteRequest`, which throws on a missing token *and* pins `Origin`/`Referer` to the registered domain — `src/lib/security/site-auth.ts:118`, `:163`; call sites at `active/[siteId]/route.ts:36`, `bucket/[siteId]/route.ts:94`, `track/route.ts:61`.
5. The only working creation path is **AI generation** (credits + OpenAI); there is no manual-variant entry, no traffic-split control, and the review step's edits are held in React state and never sent to the server — `src/hooks/useABTestCreation.ts:74`, `:157-163`.

---

## Target story

`s11-ab-run-test` — *"run an A/B test on a section"*. Stated complexity **4**
([`stories.md:553-599`](../stories.md)). Dependencies: `s06-embed-budget-gate`,
`s01-trial-signup` (entitlement).

Acceptance criteria as written, with a verified verdict on each:

| # | Criterion | Verdict against the code |
|---|---|---|
| 1 | `/dashboard/ab-tests` live and in the nav for entitled accounts | **Mostly free.** Page exists intact at `src/app/dashboard/_ab-tests/page.tsx`; rename undoes the parking. `DashboardNavigation.tsx:29,63,122-132` already has a `requiresPlan` mechanism (used by Teams). |
| 2 | Owner creates a test on an element with **two or more text variants and a traffic split** | **Not met, and not close.** Only `/api/ab-tests/generate` works, it always produces AI variants at equal splits (`generate/route.ts:170-196`), there is no split control in `ABTestConfigForm.tsx`, and edited variant text is discarded (`useABTestCreation.ts:157-163`). |
| 3 | Returning visitor gets the same variant; deterministic, never random per request | **Partly.** The hash is deterministic (`bucket/[siteId]/route.ts:62`). But the variant *lookup* is order-dependent (see fact 3) and the persistence table does not exist, so "returning visitor" rests entirely on the hash being stable — which it is not if Postgres returns the variants in a different order. |
| 4 | ±2 pp over 10,000 simulated assignments, unit-tested | **No such test exists.** No test file covers `active`, `bucket` or `track`; `src/__tests__/api/ab-tests/` holds only `route.test.ts`, `generate-unentitled.test.ts`, `results-unauthenticated.test.ts`. |
| 5 | No active test ⇒ default content **and no additional network request** | **Not met.** `recopyfast.src.js:901` calls `/ab-tests/active` unconditionally on every page load of every site, tests or not. Satisfying this needs a delivery change, not a guard. |
| 6 | Variant applied **before first paint**; test asserts the original is never painted | **Physically impossible in this architecture.** See [M3](#m3--the-anti-flicker-criterion). |
| 7 | Only one active test per element; second attempt refused with a clear reason | **UI-only.** `useContentElements.ts:54-64` computes `hasActiveTest` and `ABTestElementPicker.tsx:90` greys the row. No DB constraint, no API refusal. |
| 8 | ≤ 2,000 gz bytes added, total ≤ 30,000 | **Allowance is double-counted.** The A/B block (`recopyfast.src.js:2952-3202`, 8,196 raw / 2,247 gz standalone) is already inside the measured 34,063 widget baseline. Confirmed by the review's own `m2` (`reviews/stories.md:178`). |

---

## Current state of the code

### What is genuinely built and working

- **Widget A/B runtime** — `public/embed/recopyfast.src.js:2952-3202`. Visitor id + cookie
  (`:2956-2976`), `fetchActiveTests` (`:2978`), `bucketVisitor` with server call and
  client-side FNV-1a fallback (`:2993-3033`), `applyVariants` (`:3044`), `setupClickTracking`
  (`:3077`), `trackImpressions` (`:3113`), `trackConversion` (`:3137`), `sendTrackEvent`
  (`:3163`), `handleABTestUpdate` (`:3182`). Public surface at `:6191-6193`.
- **`GET /api/ab-tests/active/[siteId]`** — token-authorised, returns tests + variants in the
  v2 shape. Sets `Cache-Control: public, max-age=60, stale-while-revalidate=300` (`:20-23`).
- **`GET /api/ab-tests/bucket/[siteId]`** — token-authorised, geo-aware, deterministic hash.
- **`POST /api/ab-tests/track`** — token-authorised, per-`(visitor,test)` view dedup,
  triggers an inline significance check every ~50 views (`:169-189`).
- **`POST /api/ab-tests/generate`** — the only coherent create path. Checks
  `getEffectivePlan` → `plan.limits.abTesting` (`:70-93`), spends `CREDIT_COSTS.AB_TEST_GENERATION`,
  writes the v2 schema including `target_element_id` (`:143-159`) and a control variant (`:170-187`).
- **`GET/PUT /api/ab-tests`** — session + `site_permissions` authorised. `PUT` is what
  activates a test.
- **`GET /api/ab-tests/[testId]/results`** — session + `site_permissions` authorised.
- **`GET /api/cron/ab-test-lifecycle`** — `CRON_SECRET` bearer check (`:11-16`), iterates
  active tests through `checkTestCompletion`.
- **`src/lib/ab-testing/lifecycle.ts`** — significance maths, `promoteWinner` (`:160`).
  Note for `s12`: it writes `staging_content` (`:190`), i.e. promotion lands in staging, not live.
- **Dashboard** — `_ab-tests/page.tsx` (intact), `ABTestManager`, `ABTestCreateFlow`,
  `ABTestResults`, `ABTestCard`, `ABTestStatusBadge`, `ab-create/*` (5 files),
  `ab-results/*` (2 files), hooks `useABTests`, `useABTestCreation`, `useABTestResults`.
- **Schema** — `ab_tests` and `ab_test_variants` exist with the full v2 column set, recreated
  in `20260801200000_missing_base_tables.sql:449-452,497-499`, plus the
  `sync_ab_test_variant_columns` trigger (`:514-522`) that keeps the two naming generations
  (`name`/`variant_content` vs `variant_name`/`content`) in step. RLS policies for both are in
  the same file.

### What is parked

Commit **`d7cc8e0`**, *"feat: take A/B testing out of the launch, reversibly"* (2026-08-03).
Read in full. What it did and why, in its own words:

- Removed the cron from `vercel.json` — *"the cron goes first, because it was the part
  actually spending"*. Current `vercel.json` has only `generate-blog-post`.
- Removed the nav entry and the site-detail card — *"a card whose button leads to a 404 is
  worse than no card"*. `SiteDetailView.tsx` lost 57 lines including the active-test count fetch.
- Renamed `dashboard/ab-tests` → `dashboard/_ab-tests` (Next treats a leading underscore as
  private). *"A rename and a few deletions to undo rather than a rebuild."*
- Deliberately kept `plan.limits.abTesting` in the seeded plans — *"changing what a plan
  includes is a pricing decision rather than a scope cut"*. Confirmed live at
  `src/lib/stripe/plans.ts:200`, `plan-types.ts:66`.
- Verified the landing page makes no A/B claim, so no copy changed.

**Which of those reasons still apply.** The cost argument does: a 5-minute cron over an empty
`ab_tests` table is pure spend, and it should be re-added only once a test can actually run.
The "404 behind a button" argument is the one `s11` reverses on purpose. The pricing decision
was already made — `abTesting: true` is in the Pro plan today, so the product is already
selling this. Nothing in the commit argues the feature is *wrong*; it argues it was *unfinished
and metered*. That reasoning survives intact and is the strongest argument for the split below.

### What is broken (found by audit, not assumed)

1. **The two runtime tables do not exist.** See the premise warning above. Everything
   downstream — persistence of assignment, every impression, every click, every conversion,
   and `checkTestCompletion` (`lifecycle.ts:43,50,57`) — is dead in production and silent.
2. **`POST /api/ab-tests` writes a schema nothing reads.** It inserts
   `content_element_id`/`variant_name`/`content` (`route.ts:182-188`) and **never sets
   `ab_tests.target_element_id`**. `applyVariants` returns early without it
   (`recopyfast.src.js:3058-3059`), so a test created this way can never appear on a page. The
   migration's own comment flags the duplication as a follow-up
   (`20260731006000_ab_testing_schema_alignment.sql:26-28`). The dashboard does not use this
   route to create, so it is dead-but-reachable code.
3. **Variant-to-bucket mapping is order-dependent.** No `ORDER BY` on the nested
   `ab_test_variants` select in either `active/[siteId]/route.ts:56-75` or
   `bucket/[siteId]/route.ts:132-147`. Postgres makes no ordering promise. Same defect in the
   widget's fallback (`:3016-3032`).
4. **A non-OK bucket response falls through to the client fallback.** `bucketVisitor` only
   `return`s inside `if (response.ok)` (`:3003-3008`); a 401 or 500 skips the `catch` and lands
   on the client-side bucketing at `:3014`. So a revoked token still shows visitors variants
   while every `track` call 401s. Traffic is split, nothing is counted, and the numbers that do
   eventually accumulate are skewed by exactly the population that failed.
5. **Variant edits in the review step are lost.** `saveEdit` mutates local state only
   (`useABTestCreation.ts:157-163`). The user edits a headline, activates, and the AI's original
   text is what ships.
6. **No entitlement check on activation.** `/api/ab-tests` `PUT` (`:210-288`) checks session +
   `site_permissions` only. `plan.limits.abTesting` is read in exactly one place —
   `generate/route.ts:85`. An account that is not entitled cannot generate, but can activate.
   The nav gate uses a different source again (`PLAN_RANK` on `entitlement.planId`,
   `DashboardNavigation.tsx:122-132`), so re-enabling means three gates that must agree.
7. **View dedup races.** `track/route.ts:106-136` does a `SELECT count` then an `INSERT` with no
   unique constraint on `ab_test_results`. Two concurrent page loads both see zero and both
   insert. It is also an N+1: one round trip per unique `(visitor, test)` in the batch.
8. **The widget calls `/ab-tests/active` on every page load of every site**, including sites
   that have never had a test (`:901`). One guaranteed extra request per visitor, product-wide.

### Test coverage

`src/__tests__/api/ab-tests/` — `route.test.ts` (307 lines, GET/POST/PUT of the *dead* v1
route), `generate-unentitled.test.ts` (118), `results-unauthenticated.test.ts` (64).
**Zero tests** for `active`, `bucket`, `track`, the bucketing hash, distribution, the widget's
A/B block, or the lifecycle cron.

The harness for testing the widget already exists and is the right one to reuse:
`src/__tests__/embed/element-id-page-scope.test.ts:33-40` slices a named block out of the real
`recopyfast.src.js` and evaluates it in JSDOM, explicitly *"THESE TESTS RUN THE SHIPPED
WIDGET… a transcription of the hash into this file would pass forever while the widget rotted;
this cannot."* The ±2 pp test must be written that way, and it must run against **both**
implementations of the hash — the server's (`bucket/[siteId]/route.ts:26-33`) and the widget's
(`recopyfast.src.js:3035-3042`) — because they are two copies of one algorithm and nothing
today asserts they agree.

---

## Anchor points

| Concern | File:line |
|---|---|
| Snippet shape (no `async`/`defer`) | `src/lib/sites/embed-script.ts:98` |
| Install instruction ("before the closing body tag") | `src/components/sections/HowItWorks.tsx:32` |
| Widget init order | `public/embed/recopyfast.src.js:866-932` |
| `waitForDOM` = DOMContentLoaded | `public/embed/recopyfast.src.js:2321-2329` |
| Content hydration (the fetch already on the path) | `public/embed/recopyfast.src.js:3276-3336` |
| A/B block (all of it) | `public/embed/recopyfast.src.js:2952-3202` |
| `rcf_vid` cookie write (1 year, `SameSite=Lax`) | `public/embed/recopyfast.src.js:2975` |
| Widget FNV-1a | `public/embed/recopyfast.src.js:3035-3042` |
| Server FNV-1a + cumulative mapping | `src/app/api/ab-tests/bucket/[siteId]/route.ts:26-75` |
| Unchecked `visitor_buckets` read | `src/app/api/ab-tests/bucket/[siteId]/route.ts:120-124` |
| Site-token gate | `src/lib/security/site-auth.ts:109-172` |
| Dead v1 create path | `src/app/api/ab-tests/route.ts:84-208` |
| Working create path | `src/app/api/ab-tests/generate/route.ts:143-196` |
| Entitlement read (only one) | `src/app/api/ab-tests/generate/route.ts:85` |
| Lost variant edits | `src/hooks/useABTestCreation.ts:157-163` |
| Parked page | `src/app/dashboard/_ab-tests/page.tsx` |
| Stale nav comment | `src/components/dashboard/DashboardNavigation.tsx:49-51` |
| `requiresPlan` gate pattern | `src/components/dashboard/DashboardNavigation.tsx:29,63,122-132` |
| Nav test asserting A/B absence | `src/__tests__/components/dashboard/DashboardNavigation.test.tsx:135-137` |
| Cron (needs re-adding to `vercel.json`) | `src/app/api/cron/ab-test-lifecycle/route.ts:11-16` |
| Missing-table gap, recorded | `supabase/migrations/20260801200000_missing_base_tables.sql:63-66` |
| Table definitions that never ran | `supabase/migrations/20260127_ab_testing_v2.sql:8-53` |
| RLS the tables should have had | `supabase/migrations/20260611020000_tighten_permissive_policies.sql:55-95` |
| Widget test harness to copy | `src/__tests__/embed/element-id-page-scope.test.ts:33-40` |

---

## Verified APIs / functions

- `buildEmbedScript({ siteId, siteToken, appUrl?, wsUrl? }): string` — `embed-script.ts:83-99`.
  Emits one `<script src="{origin}/embed/recopyfast.js" data-site-id data-site-token
  data-api-url [data-ws-url]>`. **No `async`, no `defer`.**
- `authorizeSiteRequest({ siteId, token, origin?, referer? }): Promise<SiteAuthContext>` —
  `site-auth.ts:109`. Throws `"Missing site token"` (`:118`), `"Site not found"`,
  `"Invalid site token"`, `"Origin not allowed"` (`:163`). Origin pin is **mandatory**, not
  conditional on the header being present. One bypass: `token === "demo-site-token"` on a
  localhost origin in a non-production build.
- `buildSiteToken` / `verifySiteTokenSignature` — `site-auth.ts:64-107`. HMAC-SHA256 over
  `siteId.issuedAt`, 90-day max age, 60 s future skew, `timingSafeEqual`.
- `fnv1aHash(str): number` — two copies: `bucket/[siteId]/route.ts:26-33` and
  `recopyfast.src.js:3035-3042`. Identical text. `hash % 100` uses the low bits.
- `bucketVisitorToVariant(visitorId, testId, variants, geoCountry?, geoRegion?): string | null`
  — `bucket/[siteId]/route.ts:35-75`. Geo-filters, hashes, walks cumulative
  `traffic_percentage`, falls back to the last eligible variant.
- `checkTestCompletion(testId): Promise<void>` / `promoteWinner(testId, variantId)` —
  `lifecycle.ts:17`, `:160`. Reads `ab_test_results` (dead today); `promoteWinner` writes
  `content_elements.staging_content` (`:190`) and a `content_history` row (`:211`).
- `getEffectivePlan(userId)` → `entitlement.plan.limits.abTesting` — `generate/route.ts:70-93`.
- `window.ReCopyFast.trackConversion(eventName, value)` — public host-page API,
  `recopyfast.src.js:6191-6193`.
- Widget request shapes, verbatim:
  - `GET  {api}/ab-tests/active/{siteId}?token=…`
  - `GET  {api}/ab-tests/bucket/{siteId}?token=…&visitor_id=…`
  - `POST {api}/ab-tests/track?token=…` — body is an **array** of
    `{ site_id, test_id, variant_id, visitor_id, event_type: 'view'|'click'|'conversion',
    value?, metadata?, geo_country, geo_region }`, sent via `navigator.sendBeacon`.

---

## Traps & constraints

- **Trap — the artifact is a public URL.** `/embed/recopyfast.js` is baked into every snippet
  ever issued (`architecture.md:182-183`). `recopyfast.src.js` is the source; the artifact is
  generated and `node scripts/build-embed.mjs --check` fails on a stale one. Never hand-edit
  the output.
- **Trap — every failure on the widget side is silent by design.** The embed has no error
  surface on the host page (`architecture.md:189-192`). `sendBeacon` returns a boolean nobody
  reads. `fetchActiveTests` swallows into `console.log` (`:2986-2990`). A bucketing defect will
  present as "the numbers look a bit odd", months later. Every correctness claim in this story
  has to be a test, because nothing else will ever tell us.
- **Trap — two copies of the hash.** Server and widget each implement FNV-1a. They agree
  today by transcription. Nothing enforces it. If they diverge, the server assigns A, the
  fallback assigns B, and both are recorded under the same visitor.
- **Trap — the byte allowance is already spent.** The 2,000 gz in
  [`stories.md:101`](../stories.md) is charged as new spend, but the A/B code is inside the
  34,063 baseline. Treat the allowance as **net change against the post-`s06` measurement**, or
  reclaim it. Measured: A/B block = 8,196 bytes raw, 2,247 gz standalone; artifact today =
  46,781 gz (`gzip -9c public/embed/recopyfast.js | wc -c`).
- **Trap — `rcf_vid` versus `s09`'s privacy position.** `s11` needs a stable visitor id and
  writes a one-year first-party cookie (`:2975`). `s09`'s trap paragraph sells the opposite:
  *"No cookie, no fingerprint, no visitor id … keeps the feature out of GDPR consent scope."*
  Both can be live on one customer's page. Carried as `m4` in the review
  (`reviews/stories.md:182`) and still open. This story must state its position on `rcf_vid`
  and on `navigator.doNotTrack`, and it needs a real answer before an EU customer installs it.
- **Trap — three entitlement gates that do not agree.** Nav uses `PLAN_RANK`
  (`DashboardNavigation.tsx:122-132`), `generate` uses `plan.limits.abTesting`
  (`generate/route.ts:85`), and activation uses nothing at all (`route.ts:210-288`).
  Re-enabling the route without reconciling them ships an unentitled activation path.
- **Trap — `applyVariants` destroys child markup.** `elementData.element.textContent = …`
  (`:3068`). An `<h1>Ship <span class="accent">faster</span></h1>` becomes flat text the moment
  a variant is applied, and the styling silently disappears. `hydrateStoredContent` goes
  through `applyContentToElement` instead (`:3331`); the A/B path does not.
- **Trap — do not regress `3099c07`.** Verified: `active`, `bucket` and `track` each call
  `authorizeSiteRequest` and it throws on a missing token. Any change to the delivery path must
  keep the token *and* the Origin pin. Note the token is public by construction — it ships as a
  plain attribute in the customer's markup — so the Origin pin is the whole defence
  (`site-auth.ts:146-160`).
- **Constraint — degrade, never break.** A slow or failed bucket must fall back to default
  content immediately and must never block the host page's render
  (`architecture.md:189-192`).
- **Constraint — `s06` gates this story.** Until the budget is measured and enforced by the
  build, "does this fit?" is unanswerable ([`stories.md:72-73`](../stories.md)).
- **Housekeeping the story creates.** `DashboardNavigation.tsx:49-51` becomes false the moment
  the route is live (and already misnames the directory as `ab-tests`, not `_ab-tests`);
  `DashboardNavigation.test.tsx:135-137` asserts the absence; `vercel.json` needs the cron
  back. Reviewer's `m7` (`reviews/stories.md:188`).

---

## Open questions

1. **Does the operator accept the corrected AC 6?** The criterion as written cannot be met
   (below). The proposed replacement avoids the `s02` snippet-change dependency the reviewer
   named as remediation option (a), which is the cheaper of the two paths — but it is a
   material weakening and it must be an explicit decision, not an agent's.
2. **Manual variants and traffic split, or narrow AC 2?** AC 2 asks for "two or more text
   variants and a traffic split". Nothing in the product does either: creation is AI-only, at
   equal splits, and edits are lost. Building it is a UI story. Narrowing AC 2 to "AI-generated
   variants the owner can edit and re-weight" is defensible but changes what was promised.
3. **`rcf_vid` and DNT.** Does A/B ship with a consent posture, and does `s09`'s "no cookie"
   claim get scoped to sites not running A/B? This is a PRD-level trade, not a story decision.
4. **Does the cron go back on at 5 minutes?** `d7cc8e0` removed it as the part that was
   actually spending. Re-adding it before a test can run reinstates the spend for nothing. The
   natural answer is that it belongs with `s12`, not `s11` — but `s11` is what makes tests
   activatable, so an active test with no lifecycle will run forever.
5. **Should the dead `POST /api/ab-tests` be deleted or fixed?** It writes a shape nothing
   reads and 307 lines of test assert that behaviour. Deleting it is the honest move; it is
   also a diff nobody asked for.
6. **What is the ±2 pp test actually asserting over?** `fnv1aHash % 100` takes the low bits of
   FNV-1a, which are its weakest. Over 10,000 *distinct* visitor ids the distribution should
   hold, but over 10,000 sequential or patterned ids it may not. The test's id generator has to
   be specified, or the test proves nothing.

---

## Real complexity

**5** — re-scored up from the stated 4.

The story's own estimate is honest about what it thought it was buying: *"traffic bucketing
inside a third-party runtime"*. That part is a 4. What the audit adds is three more things that
are each independently a 4:

- **A database repair.** Two tables that the whole feature reads and writes do not exist, in a
  production database, behind a migration ledger that will not replay. That is its own forward
  migration with its own RLS policy set, and it is the prerequisite for every other criterion.
  Nothing in the story mentions it.
- **A delivery-path change to a hot public endpoint.** AC 5 ("no additional network request")
  and any honest version of AC 6 both require folding the active-test set and the assignment
  into the response the widget already awaits — `GET /api/content/:siteId`. That endpoint is on
  every visitor page load of every customer site.
- **A creation flow that does not exist.** AC 2 needs manual variants and a traffic split;
  there is no manual entry, no split control, and the edit step is a lie.

Add the anti-flicker mechanism, the entitlement reconciliation across three disagreeing gates,
and a bucketing-correctness test suite written from zero, and the arithmetic does not close in
one story. This is the same shape as the old `s05`, which the review split into `s06` + `s08`
for exactly this reason ([`stories.md:77-79`](../stories.md)).

---

## Split proposal

Three stories. The order is a hard dependency chain: nothing can be observed until the tables
exist, and nothing can be sold until it can be created.

### `s11a — A/B data plane and honest bucketing` (4)

*As a marketer I want the numbers a test produces to be real so that I am not shipping a
decision drawn from an empty table.* No UI. Ends with a suite that proves assignment is stable
and the split is honest, and that an event actually lands.

- Forward migration creating `ab_test_results` and `visitor_buckets` with the RLS set that
  `20260611020000_tighten_permissive_policies.sql:55-95` intended, following the pattern of
  `20260801200000_missing_base_tables.sql`.
- Deterministic variant ordering (`ORDER BY` in `active` and `bucket`) in both the server and
  the widget fallback.
- `bucket` reads its own query errors instead of discarding them; a non-OK bucket response in
  the widget stops the A/B path rather than falling through to unrecorded client bucketing.
- Unique constraint on `ab_test_results` for the view dedup, replacing the read-then-write race.
- Tests: ±2 pp over 10,000 assignments with a specified id generator; server hash and widget
  hash asserted equal against shared vectors; `active`/`bucket`/`track` each refuse a missing
  token and a foreign Origin (guards `3099c07`); returning-visitor stability across a simulated
  second page load.

### `s11b — the A/B surface` (4)

*As a marketer I want to create and start a test from the dashboard so that the feature Pro
sells is one I can actually use.*

- Un-park the route; nav entry gated on entitlement; fix the stale comment and its test.
- One entitlement source of truth, enforced on activation as well as generation.
- Manual variants **and** a traffic split, with review-step edits that persist.
- One active test per element enforced by a partial unique index and a 409 with a reason,
  not just a greyed row.
- Resolve the dead `POST /api/ab-tests` (delete or converge on the v2 shape).

### `s11c — variant delivery and the swap window` (4)

*As a site owner I want a test on my page to be invisible to my visitors so that running one
never costs me the impression the page makes.*

- Fold the active-test set and the visitor's assignment into the existing
  `GET /api/content/:siteId` response, removing `fetchActiveTests` and `bucketVisitor` from the
  widget's critical path. This is what makes AC 5 true (a no-test site issues **zero** extra
  requests) and it is the single biggest lever on the swap window.
- Element-scoped masking with a hard timeout (below).
- The net byte measurement against the post-`s06` baseline. Removing two fetch paths should
  make this story byte-negative.

Sequencing: `s06` → `s11a` → `s11b` → `s11c`. `s12` depends on `s11a` (the tables) and `s11b`
(a startable test), not on `s11c`.

---

## M3 — the anti-flicker criterion

### Verdict: not achievable. The criterion as written cannot be met by any change confined to this story, and cannot be met at all without abandoning the async architecture.

**AC 6 reads:** *"Variant content is applied before first paint; a test asserts the original
text is never painted when a variant is assigned."*

Three independent facts each defeat it on their own.

**1. The snippet is pasted at the end of `<body>`.** `buildEmbedScript` emits a plain
`<script src>` with no `async` and no `defer` (`embed-script.ts:98`) — so it is parser-blocking,
which is the *good* case. But the install instruction the product gives every customer is
*"Paste it before the closing body tag"* (`HowItWorks.tsx:32`). By the time the parser reaches
it, the entire body has been parsed, and on any page with above-the-fold content the browser
has painted. Moving the snippet to `<head>` means changing the shape of a tag that
`architecture.md:182-183` records as *"baked into every snippet ever issued"* — which is the
`s02` dependency the reviewer priced, and which no story owns.

**2. The widget waits for `DOMContentLoaded` before doing anything at all.** `init()`'s first
statement is `await this.waitForDOM()` (`recopyfast.src.js:868`), and `waitForDOM` resolves on
`DOMContentLoaded` (`:2321-2329`). DOMContentLoaded fires after the whole document is parsed.
First paint precedes it on essentially every real page. So even a synchronous `<head>` snippet
would not help without also restructuring init — the widget has no code path that runs before
the DOM is complete.

**3. Three sequential network round trips separate DOMContentLoaded from the swap.** After
`waitForDOM`, `init()` awaits `initEditorAuth()` (`:882`), `Rules.whenFontsReady()` (`:888`),
then `hydrateStoredContent()` (`:896`) — a `fetch` of `/api/content/:siteId` (`:3288`) — then
`fetchActiveTests()` (`:901`, a fetch) and `bucketVisitor()` (`:902`, another fetch), and only
then `applyVariants()` (`:903`). Two of those three round trips are strictly sequential and
neither can be started earlier, because bucketing needs the test list. On a median connection
that is several hundred milliseconds after first paint.

### What the reference products actually do

Both were checked against vendor documentation rather than recalled, and both confirm the same
thing: with a script tag you either **block** or you **mask**. Neither claims to do both.

**Optimizely** does not solve this asynchronously — it avoids the problem by refusing to be
async. Its default install is a **synchronous snippet in the `<head>`**, documented on the
grounds that this "lets the snippet execute its changes before content loads". Its own docs
call the non-blocking install a last resort. The `nonblocking-snippet` library it publishes for
that last resort is a masking pattern: `visibility: hidden` on selected elements, removed once
the synchronous variation code has run.

**Mutiny** cannot always be synchronous, and does not pretend to beat first paint. Its client
"attaches CSS to the page before letting the browser continue loading, setting the opacity of
any personalized element to zero" — **element-scoped**, so the rest of the page renders in
parallel. Where even that is impossible (async install, or custom JS the client cannot
predict), it ships a separate anti-flicker snippet that hides the **whole page** behind a
timeout defaulting to **4000 ms**, installed "as high in the `<head>` as possible". DebugBear's
teardown of a live Mutiny install measured LCP going from 6.0 s to 2.7 s once that hide was
overridden — which is the cost of the whole-page variant, and the reason to prefer the
element-scoped one.

The honest reading: **"before first paint" is a synchronous-script property.** RecopyFast is
not a synchronous script and the PRD's whole install pitch — one tag, before `</body>`, no
build step (`HowItWorks.tsx:32`) — depends on it not being one.

### One more thing worth saying plainly

The flash is **not new to A/B**. `hydrateStoredContent` already replaces the host page's
authored copy with published RecopyFast content after paint, on every install, today
(`recopyfast.src.js:896`, `:3317-3334`). Every customer already sees exactly this swap for
ordinary edits. Holding `s11` to a standard the core product does not meet — and paying for it
with a snippet change that breaks the install story — is the wrong trade. The right trade is to
make the swap window small, bounded, and measured, and to make a *late* swap impossible.

### Proposed replacement

Replace AC 6 with two criteria. Both are assertable in the existing JSDOM widget harness
(`src/__tests__/embed/element-id-page-scope.test.ts:33-40`).

> - [ ] **Bounded swap window.** The widget makes **at most one network round trip** between
>   `DOMContentLoaded` and the variant swap, asserted by a test that counts requests on the A/B
>   path. The element under test is masked with `visibility: hidden` — **that element only,
>   never the page or the document element** — from the widget's first synchronous statement
>   until the swap or a **200 ms** timeout, whichever comes first. After the timeout the
>   original is revealed and the test is abandoned for that page view: **a variant is never
>   applied late.** The elapsed time from script execution to swap is recorded and reported by
>   the test.
> - [ ] **The mask can never strand the page.** It is removed on every exit path — success,
>   timeout, a rejected fetch, and a thrown error — asserted by one test per path. A site with
>   no active test masks nothing and issues no additional network request.

**Why this shape, specifically:**

- *"At most one round trip"* is the testable version of "fast", and it is the criterion that
  forces the real fix: fold the active-test set and the visitor's assignment into the
  `/api/content/:siteId` response the widget already awaits. That collapses three round trips
  to one, satisfies AC 5's "no additional network request" for free, and **deletes**
  `fetchActiveTests` and `bucketVisitor` from the widget — which helps AC 8 rather than
  competing with it.
- *Element-scoped, not page-scoped.* This is Mutiny's default technique and Optimizely's
  documented masking pattern, and it is the one that keeps FCP and LCP off the critical path
  for everything except the tested headline. Whole-page hiding is what DebugBear measured
  costing 3.3 s of LCP.
- *200 ms, not 4000 ms.* The vendor defaults are long because they hide the whole page and the
  failure mode is a blank site. Masking one element means the failure mode is "one headline
  appears 200 ms late", so the timeout can be aggressive. `visibility: hidden` — not
  `opacity: 0` — because opacity does not hide a background image, a documented gotcha with the
  Google Optimize-style snippet.
- *"Never applied late"* is the criterion that actually prevents the bug the story's trap
  paragraph predicts. A customer's client does not report "the swap took 340 ms"; they report
  "the headline changed while I was reading it". A variant that misses its window must not be
  applied at all — the visitor gets control, and `trackImpressions` must not record a view it
  did not show. That last clause matters for `s12`: an unshown variant counted as an impression
  poisons the conversion rate.
- **No snippet change.** This criterion is met entirely inside `recopyfast.src.js` and one API
  route. It therefore avoids the `s02` dependency and the already-issued-single-tag-install
  problem that the reviewer priced as remediation option (a) — which is the reason to prefer
  it.

**Sources for the vendor behaviour above:**
[Optimizely — Load snippet synchronously and asynchronously](https://support.optimizely.com/hc/en-us/articles/4410289847053-Load-snippet-synchronously-and-asynchronously) ·
[Optimizely — Install the snippet as a non-blocking resource](https://support.optimizely.com/hc/en-us/articles/4410289790221-Install-the-snippet-as-a-non-blocking-resource) ·
[optimizely/library — nonblocking-snippet](https://github.com/optimizely/library/blob/master/nonblocking-snippet/README.md) ·
[Mutiny — How the client code works](https://help.mutinyhq.com/hc/en-us/articles/22091848557339-How-the-client-code-works) ·
[Mutiny — Using the Anti-flicker Snippet](https://help.mutinyhq.com/hc/en-us/articles/22211548988955-Using-the-Anti-flicker-Snippet) ·
[DebugBear — Anti-flicker snippets from A/B testing tools and page speed](https://www.debugbear.com/blog/ab-testing-anti-flicker-body-hiding) ·
[SpeedCurve — Understanding the performance impact of anti-flicker snippets](https://www.speedcurve.com/blog/web-performance-anti-flicker-snippets/)
