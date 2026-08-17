# Research — Story s12-ab-results

> ## 🔴 SCHEMA CORRECTION, 2026-08-17 — this report's data source does not exist
>
> **`ab_test_results` and `visitor_buckets` DO NOT EXIST in the database.** Every citation of
> `supabase/migrations/20260127_ab_testing_v2.sql` below is **accurate about that file** and wrong
> about the database: the migration **aborted in full** with `42P01` (`ab_test_results REFERENCES
> ab_tests`, and `ab_tests` did not exist), rolled back inside its transaction, and is still
> **marked applied**, so it will never re-run. Documented at
> `supabase/migrations/20260801200000_missing_base_tables.sql:41-42` and `:64-68`; confirmed live
> during `s11a`'s fix run, both returning `PGRST205`.
>
> **This hits `s12` harder than any other story.** `s12` computes results *from* `ab_test_results`
> — the N+1 count queries, the per-variant views and conversions, the significance math. There is
> no substrate for any of it. The conversion definition in
> [ADR 017](../decisions/017-ab-conversion-is-per-visitor.md) stands as a definition; what does not
> stand is the assumption that a table exists to evaluate it against.
>
> **`s12` cannot execute until the tables are created**, and creating them is a scope decision
> reserved to the operator — `s11a` withdrew its own Task 9 rather than ship a migration that would
> abort, be marked applied, and reproduce the original scar. Re-probe the live schema, including
> RLS and `UNIQUE(visitor_id, test_id)`, before planning around any of it.

> **Warning carried over from `docs/reviews/stories.md`:** that file ends `Stories ready: no`
> (max severity: major, `docs/reviews/stories.md:262-263`). **`s12` is one of the contested
> stories** — review finding **M2** (`docs/reviews/stories.md:116-132`) says `s12`'s conversion
> definition cannot be computed from `s09`'s data model and that, as specified, `s12` is
> unbuildable. Operator confirmed proceeding. This document settles M2 with code evidence in
> the section `## M2 — conversion definition and the s09 dependency`.

---

## False premise, stated first

**The story's central claim is false.** `docs/stories.md:632-634`:

> "The conversion definition above resolves PRD open decision 6. It depends on `s09`'s
> observer, which is why `s09` is a declared dependency — an earlier revision of this
> backlog omitted that edge and the graph was not executable."

Three separate errors, in descending order of consequence:

1. **`s12` does not depend on `s09`'s observer, and cannot.** The A/B pipeline already carries
   its own per-visitor event stream — `visitor_id`, `test_id`, `variant_id`, and the event types
   `view` / `click` / `conversion` — emitted by the widget at `public/embed/recopyfast.src.js:3096-3161`
   and persisted per-visitor in `ab_test_results` and `visitor_buckets`. `s09` by its own AC 9
   (`docs/stories.md:488`) stores **no visitor identifier and no page-view key**, so it can never
   supply the "same page view as" half of a join. The edge is not just unnecessary, it is
   unsatisfiable. Full evidence below.
2. **It is PRD decision *5*, not 6, and it is not open.** `docs/prd.md:430-432` is decision 5,
   listed under *"Resolved at `/ks-stories`"*. Decision 6 (`docs/prd.md:436-440`) is the realtime
   transport split, resolved at `/ks-architect`. The review's own M2 note
   (`docs/reviews/stories.md:130`) repeats this off-by-one in the other direction — it cites
   `prd.md:436` as "the conversion definition listed as an **open** decision". It is not; nothing
   at `prd.md:442-450` ("Still open": 7, 8, 9) concerns conversions. **There is no open PRD
   decision blocking this story.** Do not go looking for one.
3. **The "Existing:" inventory (`docs/stories.md:630-631`) names the wrong two files as the
   whole surface.** It lists `results/route.ts` and `cron/ab-test-lifecycle/route.ts` and omits
   `src/lib/ab-testing/lifecycle.ts` — which is where the significance calculation that actually
   *ends tests and promotes content* lives (`lifecycle.ts:222-253`), and where `promoteWinner`
   lives (`:160-217`). `calculateSignificance` exists **twice**, in two files, as two independent
   copies (`results/route.ts:203-235` and `lifecycle.ts:222-253`). An agent that reads the story
   and patches only `results/route.ts` fixes the *display* and leaves the *cron* promoting live
   customer content on the old math. That is precisely the story's own stated risk — "a wrong
   significance calculation does not error" — reproduced by its own file list.

---

## The five structuring facts

1. **The per-visitor A/B event stream already exists end to end.**
   `public/embed/recopyfast.src.js:2975` sets a one-year first-party `rcf_vid` cookie;
   `:3096-3109` emits `event_type: 'click'`; `:3113-3135` emits `'view'`; `:3137-3161` emits
   `'conversion'`; `:3163-3180` posts them via `sendBeacon` to `/api/ab-tests/track`. Every
   payload carries `site_id`, `test_id`, `variant_id`, `visitor_id`. **`s09` is not needed for
   any of it.**
2. **`visitor_buckets` is a per-visitor assignment ledger with `UNIQUE(visitor_id, test_id)`**
   (`supabase/migrations/20260127_ab_testing_v2.sql:40-50`), written by
   `src/app/api/ab-tests/bucket/[siteId]/route.ts:198-207`. This is the exact, indexed source for
   the AC's *"≥ 1,000 assignments per variant"* — and nothing currently reads it for that purpose.
3. **The conversion rate is computed on mismatched units and is therefore statistically
   invalid.** `views` are de-duplicated server-side to **one row per `(visitor_id, test_id)` for
   the test's entire lifetime** (`src/app/api/ab-tests/track/route.ts:101-136`), while `click`
   and `conversion` rows are **not de-duplicated at all**. Both `lifecycle.ts:73` and
   `results/route.ts:148` then compute `conversions / views` — an event count over a visitor
   count. The ratio can exceed 1.0, and the pooled-proportion z-test underneath
   (`lifecycle.ts:236-247`) assumes both are binomial counts over the same denominator. The
   p-values are wrong before any threshold is even applied.
4. **The lifecycle cron is not scheduled, and it is not idempotent in the sense the AC demands.**
   `vercel.json` contains only `/api/cron/generate-blog-post`;
   `docs/architecture.md:279` records this explicitly (*"`/api/cron/ab-test-lifecycle` exists but
   is unscheduled"*). `checkTestCompletion` does guard on `test.status !== "active"`
   (`lifecycle.ts:32`), but the status update (`:139-147`) and `promoteWinner` (`:150`) are two
   separate unconditional writes with no transaction and no compare-and-swap — two concurrent
   runs both read `active` and both promote.
5. **Promotion does not appear in version history today, because it writes to the wrong table.**
   `promoteWinner` inserts into `content_history` (`lifecycle.ts:211-216`). The version history
   the dashboard renders reads `content_versions` (`src/app/api/edit-board/history/route.ts:88`,
   `:109`), written only by the `create_content_version` RPC. AC 7 ("promotion appears in version
   history as a normal, revertible edit") is **false today** and the failure is silent.

---

## Target story

`s12-ab-results — call the winner` (`docs/stories.md:602-640`).
Scored **4** — *"statistics that must not lie, plus scheduled lifecycle."*
Declared dependencies: `s11-ab-run-test`, `s09-section-impressions`.

Stated risk (`docs/stories.md:610-612`): *"a wrong significance calculation does not error — it
produces a confident, plausible, incorrect recommendation, and the customer acts on it. This is
the story where a silent defect does the most commercial damage."* That risk is **realised in
production code right now**, not hypothetical — see facts 3 and 5 and the trap list.

### Acceptance criteria, each against current state

| # | Criterion (`stories.md:615-623`) | State today |
|---|---|---|
| 1 | Each variant's impressions and conversions shown with observed rate | **Partial** — `ABTestVariantCard.tsx:52-67` renders views / conversions / rate; the rate is computed on mismatched units (fact 3) |
| 2 | Conversion = click on tracked CTA in same page view as an impression of the tested section; documented in UI | **Not met.** No definition anywhere in the UI. And the definition itself is the contested one — see M2 |
| 3 | Winner only at ≥ 95% confidence **and** ≥ 1,000 assignments per variant; else "inconclusive" | **Not met.** `min_sample_size` defaults to **100** and is compared against **total views across all variants** (`lifecycle.ts:34`, `:79-87`), not per-variant. The only per-variant floor is a hardcoded `< 30` (`lifecycle.ts:99`, `results/route.ts:216`). No "inconclusive" state exists in the UI |
| 4 | Significance unit-tested against ≥ 3 known pairs, incl. one that must not reach significance | **Not met.** `src/__tests__/api/ab-tests/` contains three files (`route.test.ts`, `generate-unentitled.test.ts`, `results-unauthenticated.test.ts`). **Zero tests for `lifecycle.ts` or for either copy of `calculateSignificance`** |
| 5 | No significance figure while running and below minimum sample; show progress instead | **Actively violated.** `ABTestVariantCard.tsx:94-96` renders `"{confidence}% confidence"` whenever a `significanceResult` exists — i.e. for every non-control variant at any n. `:40-45` shows a "Leading" trophy at n=1. This is the peeking trap, shipped |
| 6 | Lifecycle cron ends tests at configured end date and records outcome | **Partial.** `lifecycle.ts:83` handles `isPastEndDate` and `:139-147` records `status`/`winner_variant`/`statistical_significance`. But the cron is **unscheduled** (`vercel.json`) so nothing ever calls it on a timer |
| 7 | Promotion lands in version history as a normal, revertible edit | **Not met** — writes `content_history`, history reads `content_versions` (fact 5) |
| 8 | Inconclusive test keeps original content and says so | **Actively violated.** `lifecycle.ts:132-136`: when past end date with no significant winner, it `reduce`s to the highest conversion rate and promotes it. With zero conversions recorded (the default — see trap 3) every rate is `0`, `reduce` returns the **first** variant, and that arbitrary variant is promoted to the customer's live site |
| 9 | Cron idempotent: a duplicate run promotes nothing twice | **Not met** (fact 4) |

---

## Current state of the code

### Read path — `src/app/api/ab-tests/[testId]/results/route.ts`

`GET` authenticates via the cookie-scoped SSR client (`:11-28`), loads the test (`:31-35`),
checks `site_permissions` (`:42-54`), then **fetches every raw `ab_test_results` row for the
test** (`:57-66`) and aggregates in JavaScript (`:138-201`).

What it computes today:
- `views` / `conversions` per variant by filtering the row array (`:144-147`)
- `conversion_rate = conversions / views` (`:148`)
- `lift` vs. `variantStats[0]` — **positional**, not `is_control` (`:162`, `:176-181`)
- a two-proportion pooled z-test (`:203-235`) with a `< 30` per-arm floor, `pValue = 2·(1-Φ(|z|))`,
  `significant = pValue < 0.05`, `confidence = (1-pValue)·100`
- `total_participants` (`:191-192`) and `test_duration_days` (`:193-199`)

`POST` is a deliberate 405 pointing writes at `/api/ab-tests/track` (`:100-121`) — a fix from
commit `3099c07`. Do not regress it.

**Is the significance calculation correct?** The *formula* is standard and the `erf`
approximation (`:242-259`) is Abramowitz–Stegun 7.1.26, accurate to ~1.5e-7 — fine. **The inputs
are not.** Four defects, all silent:

- **Wrong denominator/numerator units** (fact 3). Breaks the binomial assumption the z-test rests
  on. This is the single most damaging one and it invalidates every p-value the product has ever
  shown.
- **Unbounded raw fetch.** `:57-66` has no `.limit()` and no `.range()`. At the AC's own target of
  1,000 assignments per variant this pulls thousands of rows into a serverless function to count
  them. Supabase/PostgREST applies a default row cap, so the realistic failure is not a timeout —
  it is **silently truncated counts that still render as a confident percentage**. Counting
  belongs in SQL.
- **`total_participants` is always 1.** `:191` builds `new Set(results.map(r => r.user_id || r.session_id))`.
  `ab_test_results` has **no `user_id` column** (`20260127_ab_testing_v2.sql:8-20`) and the widget
  never sends `session_id` (`track/route.ts:149` writes `null`). Every element is `undefined`, so
  the Set has size 1. `ABTestOverviewStats` renders that as the participant count. The correct
  source is `visitor_buckets`.
- **Control identified positionally.** `:162` takes `variantStats[0]` as control; `ab_test_variants`
  has an `is_control` column (`20260127_ab_testing_v2.sql:35`) which `lifecycle.ts:90` *does* use.
  The two files can therefore disagree about which variant is the baseline for the same test.

### Lifecycle — `src/lib/ab-testing/lifecycle.ts` (the file the story does not mention)

`checkTestCompletion(testId)` (`:17-155`):
- guards `status !== "active"` (`:32`)
- reads `min_sample_size || 100` and `confidence_threshold || 0.95` (`:34-35`). **Neither is ever
  set at creation** — `src/app/api/ab-tests/route.ts` writes `end_date` (`:95`, `:170`) but not
  these two, so every test runs on the column defaults from
  `20260127_ab_testing_v2.sql:30-31`
- issues **3 `count` queries per variant** (`:42-61`) — N+1 against `ab_test_results`
- gates on `totalViews < minSampleSize` summed **across** variants (`:79-87`)
- per-treatment `< 30` floor (`:99`), significance at `confidence/100 >= threshold` (`:108`)
- `shouldComplete = test.auto_complete && (isSignificant || isPastEndDate)` (`:127`);
  `auto_complete` defaults to `true`
- when not significant, picks the max-rate variant and promotes it anyway (`:132-136`) — AC 8 violation
- writes status + winner (`:139-147`), then calls `promoteWinner` (`:150`)

`promoteWinner(testId, variantId)` (`:160-217`):
- returns early if the winner `is_control` (`:184`) — correct, no content change needed
- otherwise **writes `content_elements.staging_content` directly** (`:187-195`)
- then inserts `content_history` with `change_type: 'ab_test_winner'` (`:211-216`)

**Two callers.** The cron (`cron/ab-test-lifecycle/route.ts:44`) and — critically —
**the ingest path**: `track/route.ts:169-189` runs `checkTestCompletion` inline on roughly every
50th `view` event. So today a test can complete and promote content **from a public, unauthenticated-
visitor-triggered code path**, at up to test-traffic frequency. That is continuous automated
peeking: repeatedly evaluating a significance threshold as data arrives inflates the false-positive
rate far above the nominal 5%, no matter how correct the per-evaluation math is.

### Cron — `src/app/api/cron/ab-test-lifecycle/route.ts`

`GET`, guarded by `Bearer ${process.env.CRON_SECRET}` (`:11-16`) — note it fails closed if
`CRON_SECRET` is unset, which is correct. Selects `status = 'active'` tests (`:21-24`), loops
`checkTestCompletion` (`:44`), re-reads status to count completions (`:47-54`), returns
`{checked, completed, errors}`. Errors per-test are collected, not fatal (`:56-60`) — good.

**Not scheduled.** `vercel.json` holds one cron entry, `/api/cron/generate-blog-post` at
`0 14 * * *`. The route's own header comment (`:6-7`) claims *"Configured to run every 5 minutes
via Vercel cron"* — a stale comment describing config that does not exist. Confirmed independently
at `docs/architecture.md:279`.

**Idempotency**: the `status !== "active"` guard (`lifecycle.ts:32`) is a read-then-write with no
lock. A duplicate/retried run overlapping the first will double-promote. `docs/architecture.md:279`
states the rule this must satisfy: *"Cron platforms retry — every job must be idempotent."*

### UI — `ABTestResults.tsx`, `ab-results/`

`src/components/dashboard/ABTestResults.tsx` (81 lines) is a thin container over
`useABTestResults` (`src/hooks/useABTestResults.ts:38`, a plain `fetch` + `useEffect`, no polling).
It computes `bestVariant` by max conversion rate (`:50-52`) and treats `index === 0` as control
(`:74`) — same positional assumption as the API.

`ab-results/ABTestOverviewStats.tsx` renders participants / duration / best rate.
`ab-results/ABTestVariantCard.tsx` renders per-variant views, conversions, rate, a bar, and — at
`:94-96` — the confidence figure, unconditionally.

**Reachability**: the page lives at `src/app/dashboard/_ab-tests/page.tsx`. The leading underscore
makes it a Next.js *private folder*, excluded from routing — `/dashboard/ab-tests` 404s today.
**`s11` owns un-parking the route** (`docs/stories.md:567`); `s12` inherits a working route from it.

### Schema

`supabase/migrations/20260127_ab_testing_v2.sql`:
- `ab_test_results` (`:8-20`): `test_id`, `variant_id`, `visitor_id NOT NULL`, `session_id`,
  `event_type CHECK IN ('view','click','conversion')`, `value`, `metadata`, `geo_*`, `recorded_at`.
  Indexes at `:22-25` include `idx_atr_visitor_event (visitor_id, test_id, event_type)`.
- `ab_tests` gains `target_element_id`, `auto_complete DEFAULT true`,
  `min_sample_size DEFAULT 100`, `confidence_threshold DEFAULT 0.95` (`:28-31`)
- `ab_test_variants` gains `variant_content`, `is_control`, `geo_countries`, `geo_regions` (`:34-37`)
- `visitor_buckets` (`:40-50`) with `UNIQUE(visitor_id, test_id)`

RLS: the permissive `FOR ALL USING (true)` policies from `:60-64` were replaced in
`20260611020000_tighten_permissive_policies.sql:25-70` — site members may **read**
`ab_test_results` via `site_permissions`; writes are service-role only. The results route's
user-scoped client therefore reads under RLS correctly.

**`conversion_events` is a red herring.** It exists
(`20260731002000_missing_tables_audit_analytics.sql:154-179`) but belongs to
`src/lib/analytics/tracker.ts:114` and has **no relationship to A/B testing**. Do not wire `s12`
to it. `docs/architecture.md:239` listing it under "A/B" is a doc error worth correcting in passing.

### The human edit path (for the promotion trap)

Verified end to end:

1. **Direct live writes are refused.** `PUT /api/content/[siteId]` returns 403 with
   *"Live content updates must use /api/staging/content and publish explicitly"*
   (`src/app/api/content/[siteId]/route.ts:499-508`).
2. **Stage**: `PUT /api/staging/content/[siteId]` writes `staging_content` (`:226`) **and**
   records a `staging_changes` audit row with `previous_content` / `action` (`:252-255`).
3. **Publish**: `POST /api/staging/publish` calls the RPC `publish_staging_content_atomic`
   (`:111-112`), which inserts into `staging_history`
   (`20260803020000_restore_atomic_publish.sql:63`).
4. **Version snapshot**: `POST /api/edit-board/history` calls the `create_content_version` RPC
   (`:212`), which writes `content_versions`
   (`20260805120000_reconcile_create_content_version.sql:80`). That RPC is `SECURITY DEFINER` and
   was **revoked from `authenticated` and granted to `service_role` only**
   (`20260805190000_lock_down_content_version_rpcs.sql:50-55`) — so server-side promotion code
   *can* call it, but must do so with the service client.
5. **History read**: `GET /api/edit-board/history` reads `content_versions` (`:88`, `:109`), which
   is what `VersionHistoryPanel` renders.

`promoteWinner` performs step 2's database write *without* step 2's audit row, skips steps 3 and 4
entirely, and writes to `content_history` — a table step 4 does not read.

**Webhooks are a non-issue and the story's trap overstates them.** `src/lib/webhooks/manager.ts`
defines `WebhookManager` and exports a `webhookManager` singleton (`:502`), but a repo-wide grep
for `triggerWebhook|WebhookManager` outside `__tests__` returns **only that file**. Nothing fires
webhooks on a human edit either, so promotion cannot "bypass" a path that does not run. State this
rather than budgeting for it.

---

## Anchor points

| What | Where |
|---|---|
| Significance math (authoritative — used to end tests) | `src/lib/ab-testing/lifecycle.ts:222-253` |
| Significance math (duplicate — used for display only) | `src/app/api/ab-tests/[testId]/results/route.ts:203-235` |
| Test completion + winner selection | `src/lib/ab-testing/lifecycle.ts:17-155` |
| Content promotion | `src/lib/ab-testing/lifecycle.ts:160-217` |
| Cron entry point | `src/app/api/cron/ab-test-lifecycle/route.ts:8-75` |
| Cron schedule (must be added) | `vercel.json` |
| Inline peeking trigger (must be removed) | `src/app/api/ab-tests/track/route.ts:169-189` |
| View de-duplication | `src/app/api/ab-tests/track/route.ts:101-136` |
| Confidence rendered below sample (AC 5 violation) | `src/components/dashboard/ab-results/ABTestVariantCard.tsx:94-96` |
| "Leading" badge at any n | `src/components/dashboard/ab-results/ABTestVariantCard.tsx:40-45` |
| Participant count bug | `src/app/api/ab-tests/[testId]/results/route.ts:191-192` |
| Assignment ledger (the correct denominator) | `visitor_buckets`, written at `src/app/api/ab-tests/bucket/[siteId]/route.ts:198-207` |
| Version-history write RPC (service-role only) | `create_content_version`, `20260805120000_reconcile_create_content_version.sql:43-101` |
| Version-history read | `src/app/api/edit-board/history/route.ts:88,109` |
| Staging write + audit row | `src/app/api/staging/content/[siteId]/route.ts:226,252-255` |
| Atomic publish RPC | `src/app/api/staging/publish/route.ts:111-112` |
| Widget A/B init sequence | `public/embed/recopyfast.src.js:898-906` |
| Widget event emitters | `public/embed/recopyfast.src.js:3096-3161` |
| Public `trackConversion` API | `public/embed/recopyfast.src.js:6191-6193` (also `window.rcf`, `:6197`) |
| Existing tests (3 files, none on statistics) | `src/__tests__/api/ab-tests/` |

---

## Verified APIs / functions

Everything below was read in this session, not recalled.

- `checkTestCompletion(testId: string): Promise<void>` — `lifecycle.ts:17`. Service-role client.
  Returns silently on every failure path (test missing, not active, under sample, no control).
- `promoteWinner(testId: string, winnerVariantId: string): Promise<void>` — `lifecycle.ts:160`.
  Also returns silently on missing test / missing `target_element_id` / missing variant / control winner.
- `calculateSignificance(controlConversions, controlViews, treatmentConversions, treatmentViews)`
  → `{ significant, confidence, pValue }`. Two copies: `lifecycle.ts:222`, `results/route.ts:203`.
  `lifecycle.ts:243-245` has a `standardError === 0` guard that `results/route.ts` **lacks** — the
  display copy can divide by zero and produce `NaN`/`Infinity` confidence.
- `POST /api/ab-tests/track` — `track/route.ts:36`. Accepts a single event or an array; requires all
  events share one `site_id` (`:48-56`); authorizes via `authorizeSiteRequest({siteId, token, origin, referer})`
  (`:61-66`); validates `test_id`/`variant_id`/`visitor_id`/`event_type` (`:82-99`); CORS
  `Access-Control-Allow-Origin: *` (`:14`).
- `GET /api/ab-tests/bucket/[siteId]` — returns `{assignments: Record<testId, variantId>, geo}`;
  upserts `visitor_buckets` on `visitor_id,test_id` (`:198-207`); geo from `x-vercel-ip-country`
  (`:113-115`).
- `GET /api/ab-tests/[testId]/results` — returns `{test, results, variants, statistics}`.
  `statistics: { variant_stats[], significance_results[], total_participants, test_duration_days }`.
- `useABTestResults(testId)` — `src/hooks/useABTestResults.ts:38` → `{data, loading, error, refetch}`.
  Single fetch on mount, no polling.
- Widget: `initVisitorId()` `:2956`, `fetchActiveTests()` `:2978`, `bucketVisitor()` `:2993`
  (with FNV-1a client fallback `:3014-3042`), `applyVariants()` `:3044`, `setupClickTracking()` `:3077`,
  `trackImpressions()` `:3113`, `trackConversion(eventName, value)` `:3137`,
  `sendTrackEvent(eventOrEvents)` `:3163`. Init order at `:900-905`, skipped entirely in staging
  mode (`:899`).

---

## Traps & constraints

1. **Two copies of the significance function.** Fixing one and not the other leaves the display and
   the promotion disagreeing about the same test. Extract to a single tested module and have both
   call it. This is the trap the story's own "Existing:" list walks an agent straight into.

2. **Promotion is a content write — and it currently writes to a table history does not read.**
   The story names this trap (`stories.md:638-640`) and it is real, but the specific failure is
   sharper than the story says: the write is not "a direct database update" in the sense of
   bypassing staging — it *does* land in `staging_content`, so the change is correctly invisible to
   public traffic until published. What it bypasses is (a) the `staging_changes` audit row and
   (b) `content_versions`, so AC 7's "appears in version history as a normal, revertible edit" is
   flatly false. Route promotion through `create_content_version` (service-role grant already
   exists) rather than the ad-hoc `content_history` insert. **Webhooks are not part of this trap** —
   nothing dispatches them on any edit path (see "The human edit path" above).

3. **`conversion` events are almost always zero, and the "inconclusive" path promotes anyway.**
   `trackConversion` is only reachable via `window.recopyfast.trackConversion(...)`
   (`recopyfast.src.js:6191`) — the customer must write JavaScript on their own site. The widget
   never calls it. So for every customer who has not hand-wired it, `conversions = 0` for every
   variant, every `conversion_rate` is `0`, and `lifecycle.ts:132-136`'s `reduce` returns the
   **first** variant — which is then promoted to their live site at the end date. A test that
   measured nothing ships a copy change. This is the single worst live behaviour found, and it is
   exactly the "confident, plausible, incorrect recommendation" the story's risk paragraph
   predicts. AC 8 must be implemented as a hard refusal to promote, not as a tie-break.

4. **Peeking is not just a UI concern — it is wired into ingest.** `track/route.ts:169-189` runs the
   full completion check roughly every 50th view event, from a public visitor-triggered path.
   Removing the confidence figure from `ABTestVariantCard.tsx:94-96` satisfies the letter of AC 5
   while leaving continuous automated re-evaluation in place, which is the statistical harm the
   criterion exists to prevent. Both must go. The story's note (*"do not relax it into a tooltip"*)
   is aimed at the UI only and under-describes the problem.

5. **Sample gates are wrong on two axes.** `min_sample_size` is (a) defaulted to 100, never set at
   creation, and (b) compared against the **sum** of views across variants. AC 3 wants ≥ 1,000
   **per variant**. And "assignments" ≠ "views": the right source is `count(*) from visitor_buckets
   group by variant_id`, not a filtered scan of `ab_test_results`.

6. **Counting in JavaScript over an unbounded `select`.** `results/route.ts:57-66` fetches raw rows
   with no limit. At AC-3 volumes the row cap truncates and the UI shows a confident number derived
   from a partial scan, with no error. Move aggregation into SQL (an RPC or a view); the index
   `idx_atr_visitor_event` already supports it.

7. **`is_control` vs. position.** `results/route.ts:162` and `ABTestResults.tsx:74` both assume
   index 0 is control; `lifecycle.ts:90` uses `is_control`. `ab_test_variants` is fetched without an
   `order by` (`results/route.ts:73-76`), so row order is not guaranteed stable between requests.

8. **Cron idempotency needs a real guard.** Make the completion write a conditional update
   (`... where id = ? and status = 'active'`) and promote only when that update reports a row
   changed — or move both writes into one Postgres function, which is the codebase's stated pattern
   (`docs/architecture.md:266-268`).

9. **`CRON_SECRET` must exist in the environment before scheduling.** `cron/ab-test-lifecycle/route.ts:14`
   fails closed when it is unset. Adding the `vercel.json` entry without the env var yields a job
   that 401s silently every run.

10. **Stale comment.** `cron/ab-test-lifecycle/route.ts:6-7` claims the cron is "Configured to run
    every 5 minutes via Vercel cron". It is not. Fix it in the same pass or it becomes the next
    reader's false premise — the same defect class this document opens with.

11. **`s11` must land first and must un-park the route.** `/dashboard/ab-tests` 404s
    (`src/app/dashboard/_ab-tests/`, private folder). `s12` has no UI to attach to until `s11`
    renames it. This dependency is correctly declared.

12. **Entitlement.** AC list does not mention gating, but A/B is a Pro feature (`docs/prd.md:387`).
    `s11` owns the entitled route (`stories.md:567`); confirm `s12`'s results endpoint inherits it
    rather than re-implementing a second gate.

---

## Open questions

1. **Does the operator accept redefining conversion over the existing A/B event stream?** My verdict
   below says yes and that the `s09` edge should be dropped. This is a story-text edit to
   `docs/stories.md:616` and `:625-627` plus the graph at `:62`, and it needs an explicit yes before
   `/ks-plan`. It is *not* a PRD change: `prd.md:430-432` says "a click on a tracked CTA within the
   same page view as an impression of the tested section" — the corrected definition satisfies that
   sentence, it just names a different (and the only available) impression source.

2. **Which impression semantics for the A/B `view` event?** Today a `view` means *"the visitor was
   bucketed and the tested element was present in the content map on that page"* — presence, not
   viewport visibility. Two options, **neither requiring `s09`**:
   (a) keep presence semantics and say so in the UI (zero widget work);
   (b) gate the A/B `view` emission behind an `IntersectionObserver` inside the A/B code path,
   carrying its own `visitor_id`, which yields the PRD's stricter reading at a cost of roughly
   10–15 lines inside `s11`'s existing 2,000-byte allowance.
   I recommend (a) for this story and (b) as a follow-up if the operator wants the strict reading.
   Decide before the AC text is finalised, because it changes what the UI must document.

3. **Should `click` be the conversion, or should an explicitly-instrumented `conversion` event
   remain the primary metric?** AC 2 says *"a click on a tracked CTA"*, which maps to the widget's
   automatic `click`. The manual `conversion` event (`recopyfast.src.js:6191`) can stay as an
   advanced opt-in for customers who want a downstream goal, but it must not be the default
   denominator — see trap 3. Confirm the primary metric is `click`.

4. **Cron cadence and end-date granularity.** The route comment says 5 minutes; Vercel's Hobby plan
   allows one cron per day. What plan is this deployed on, and is "ends at their configured end
   date" satisfied by a daily run? This changes AC 6's testability.

5. **Retention.** `ab_test_results` grows one row per click per visitor with no pruning job. `s10`
   introduces a retention window for impressions (`stories.md:532`); A/B events have none. Out of
   scope for `s12`'s ACs, but flagged so it is a deliberate omission rather than an oversight.

6. **Backfill / existing data.** 0 users (`prd.md:221-222`), so any `ab_test_results` rows in
   production are test data. Confirm they can be truncated rather than migrated, so the
   unit-mismatch in fact 3 does not have to be corrected retroactively.

---

## M2 — conversion definition and the s09 dependency

### Verdict: **drop the `s09` edge.** The dependency is unnecessary *and* unsatisfiable. The review's remediation (`docs/reviews/stories.md:132`) is correct and should be applied verbatim.

### Evidence that `s09` cannot supply what `s12` asks for

`s12` AC 2 needs to establish that a click and an impression occurred **in the same page view**.
That requires a key shared by both records — a visitor id, a session id, or a page-view id.

`s09` forbids all three, in its own acceptance criteria and notes:
- `docs/stories.md:488` — *"Do Not Track is respected, and **no per-visitor identifier is stored**."*
- `docs/stories.md:515-517` — *"**Trap — privacy.** No cookie, no fingerprint, no visitor id.
  Aggregate counts only. This keeps the feature out of GDPR consent scope…"*
- `docs/stories.md:506-507` — impressions write *"pre-aggregated counts"*, deliberately not raw events.
- `docs/prd.md:427-429` (decision 4) — *"one impression per section per page view, **no visitor
  identifier**."*

An aggregate count with no key cannot be joined to an individual click. There is no implementation
of `s12` AC 2 that reads `s09`'s data. Also worth noting: **`s09` does not exist yet** — no
`IntersectionObserver` in `public/embed/`, no impressions route under `src/app/api/` (both verified
by grep this session). So the edge would also serialize `s12` behind an unbuilt story for data it
could never use.

### Evidence that the A/B stream already supplies it

Per-visitor identity, in the widget, today:

| Element | Location |
|---|---|
| `rcf_vid` first-party cookie, 1 year, `SameSite=Lax` | `public/embed/recopyfast.src.js:2956-2976` |
| `view` event with `visitor_id`, `test_id`, `variant_id` | `:3113-3135` |
| `click` event with the same four keys | `:3096-3109` |
| `conversion` event (manual opt-in) | `:3137-3161` |
| Posted via `sendBeacon` to `/api/ab-tests/track` | `:3163-3180` |
| Persisted with `visitor_id NOT NULL` | `ab_test_results`, `20260127_ab_testing_v2.sql:8-20` |
| Indexed for exactly this query | `idx_atr_visitor_event (visitor_id, test_id, event_type)`, `:24` |
| Per-visitor assignment ledger, `UNIQUE(visitor_id, test_id)` | `visitor_buckets`, `:40-50` |

The "same page view" correlation is **structural, not something that needs computing**.
`setupClickTracking` (`:3077-3111`) binds its listener to the element resolved from
`self.elements` — the content map built for *that* page view. The listener therefore only exists
on a page view where the tested element was present, and the matching `view` event is emitted two
lines later in the same `init` sequence (`:904` then `:905`). A click can only be recorded from a
page view that also produced an impression of the tested section. No join, no page-view id, no `s09`.

### Corrected conversion definition (proposed replacement for `docs/stories.md:616`)

> **A conversion is a click on the tested element (or its nearest `<a>`/`<button>` ancestor) by a
> visitor bucketed into a variant, counted once per visitor. The denominator is that variant's
> assignment count from `visitor_buckets`. Both halves come from the A/B event stream the widget
> already emits; the definition is documented in the results UI.**

Why "counted once per visitor" is load-bearing and not pedantry: `view` rows are already
de-duplicated per `(visitor_id, test_id)` for the test's lifetime (`track/route.ts:101-136`) while
`click` rows are not. Counting click *events* against visitor *assignments* is what produces rates
above 1.0 and invalidates the pooled-proportion z-test. Fixing the definition and fixing the
statistics are the same fix — which is a good sign the definition is the right one.

### What to change, concretely

1. `docs/stories.md:616` — replace AC 2 with the definition above.
2. `docs/stories.md:625-627` — Dependencies become `s11-ab-run-test` only.
3. `docs/stories.md:62` — the graph edge `s09 ──> s10 ──┐ … ┴─> s12` loses its `s10 → s12` leg
   (which review finding **m1**, `docs/reviews/stories.md:176`, separately flags as spurious and
   undeclared). After the change `s12` depends on `s06 → s11 → s12` only.
4. `docs/stories.md:632-634` — rewrite the note. Correct "decision 6" to "decision 5", state that
   the definition is computed over the existing per-visitor A/B stream, and name
   `src/lib/ab-testing/lifecycle.ts` in the "Existing:" list at `:630-631`.
5. Extend `s11`'s audit note (`docs/stories.md:588-589`) to name `initVisitorId`, `setupClickTracking`,
   `trackImpressions`, `trackConversion` and the `sendTrackEvent` payload shape — per the review's
   remediation.

### Knock-on effects, both favourable

- **`s09` is unblocked and stays clean.** Its privacy position (`stories.md:515-517`) survives
  untouched, and with it the GDPR-consent-scope selling point. Review finding **m4**
  (`docs/reviews/stories.md:182`) — that `s11` re-enables an `rcf_vid` cookie while `s09` sells the
  opposite — **remains open and is not resolved by this verdict.** Both features can run on one
  customer page. `s11` still needs to state its position on `rcf_vid` and DNT, and `s09`'s consent
  claim still needs scoping to sites not running A/B. Flagging so it is not assumed closed here.
- **`s12` can start as soon as `s11` lands**, rather than waiting on an unbuilt `s09`.

---

## Real complexity

### Re-scored: **4 — confirmed, no split required.**

The story's own score of 4 is right, but for partly different reasons than it gives, and it holds
**only if M2 is settled before `/ks-plan`**. Under the story as written — with `s09` as a real
dependency — `s12` would have to build a per-visitor impression pipeline it does not own, which is
a second ingest axis on top of statistics and lifecycle. That is a 5. Dropping the `s09` edge is
what keeps it a 4.

Against the PRD scale (`docs/prd.md:128-129`, *"4 integrations, payments, roles · 5 real-time,
migrations, external systems"*):

**Why 4 and not 3.** Three independent correctness surfaces, each with a silent failure mode:
statistics (units, thresholds, peeking), lifecycle (scheduling, idempotency, the inconclusive path),
and content promotion (routing a machine-initiated write through a human edit path with version
history and revertibility). Plus the ingest-path change (removing the inline check at
`track/route.ts:169-189`), a `vercel.json` change with an env-var prerequisite, and a UI that
currently violates one AC outright.

**Why not 5.** No new external system — the cron platform and Supabase are both already in use, and
the widget needs **zero** changes: every event `s12` consumes is already emitted and already
persisted. No new byte budget spend (review finding m2, `docs/reviews/stories.md:178`, establishes
the A/B widget code is inside the existing measured baseline). No billing, no auth, no third-party
DOM. The schema change is at most an aggregate RPC and possibly one index — comparable to `s10`,
which this backlog scores **3** for aggregation plus a scheduled pruning job. Most of the work is
correcting code that exists rather than writing new subsystems.

**Where the weight actually sits**, in descending order — useful for `/ks-plan` sequencing:
1. Re-model the conversion metric (unit fix + SQL aggregation + single shared significance module)
2. Route promotion through `create_content_version` and make the inconclusive path refuse
3. Cron: schedule, `CRON_SECRET`, conditional-update idempotency, remove the inline ingest trigger
4. UI: suppress significance below sample, show progress, document the definition
5. Tests: the three-pair significance suite AC 4 demands, against a module that currently has none

If the operator wants to de-risk without a formal split, the natural seam is between (1)+(4)+(5)
— "the numbers are honest" — and (2)+(3) — "the test ends itself safely". Both halves are
independently shippable and independently testable. That is a sequencing note, **not** a split
proposal: at 4, none is required.

## Split proposal

Not applicable — the story scores 4.
