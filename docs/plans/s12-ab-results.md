---
validated: yes
---
# Plan — Story s12-ab-results

Branch: `feature/s12-ab-results`
Research: `docs/research/s12-ab-results.md` — read it first; this plan does not repeat it.

## Target story

`s12-ab-results — call the winner` (`docs/stories.md:709-752`). Complexity **4**, confirmed —
and confirmed *only because* the `s09` edge is dropped. Dependencies: `s11a-ab-data-plane`,
`s11b-ab-surface`. `s11b` un-parks `/dashboard/ab-tests` and owns the entitlement gate; this
story attaches to a route that already exists and **must not add a second gate**
(research trap 12).

The conversion is defined over the **existing per-visitor A/B event stream** the widget
already emits — `view` / `click` / `conversion` carrying `visitor_id`, `test_id`,
`variant_id` (`public/embed/recopyfast.src.js:3096-3161`, `rcf_vid` at `:2956-2976`) landing
in `ab_test_results` (`visitor_id NOT NULL`). **This story finishes that path. It does not
build an ingest pipeline, and it changes zero bytes of the widget.**

### The `same page view` question — resolved, not deferred

AC 2 says a conversion is *"a click on a tracked CTA within the same page view as an
impression of the tested section."* As written that is unrepresentable: `ab_test_results.session_id`
exists but nothing ever sets it — the widget's track payloads omit it and
`track/route.ts:149` writes `null`.

**Decision: reword, do not mint a page-view key.** The correlation is already structural, not
computable. `setupClickTracking` (`recopyfast.src.js:3077-3111`) binds its listener to the
element resolved from `self.elements` — the content map built for *that* page view — and the
matching `view` event is emitted two lines later in the same `init` sequence (`:904`, `:905`).
A click can therefore only be recorded from a page view that also produced an impression of
the tested section. Minting a page-view id would spend widget bytes and add an ingest column
to re-derive a fact the call graph already guarantees.

The settled definition:

> **A conversion is a click on the tested element (or its nearest `<a>`/`<button>` ancestor)
> by a visitor bucketed into a variant, counted once per visitor. The denominator is that
> variant's assignment count from `visitor_buckets`.**

"Once per visitor" is load-bearing, not pedantry. `view` rows are already de-duplicated per
`(visitor_id, test_id)` (`track/route.ts:101-136`) while `click` rows are not, so today's
`conversions / views` divides an event count by a visitor count — a ratio that can exceed 1.0
under a pooled-proportion z-test that assumes both are binomial counts over the same
denominator. Fixing the definition and fixing the statistics are the same fix.

This is a structural choice, now recorded as
**`docs/decisions/017-ab-conversion-is-per-visitor.md`**. The ADR is the authoritative wording;
`docs/stories.md:723` still carries the old AC 2 text and is a framing doc that commits on
`main` — flag it for the operator at ship, do not edit it from this branch.

---

## Tasks (ordered)

- [ ] **T1 — One significance module, five vectors, RED first.**
  New `src/lib/ab-testing/statistics.ts`. Exports a **pure** `calculateSignificance(controlConversions,
  controlAssignments, treatmentConversions, treatmentAssignments) → { zScore, pValue, confidence }`
  (pooled two-proportion z-test, the existing Abramowitz–Stegun 7.1.26 `erf`, the
  `standardError === 0` guard that `results/route.ts` currently lacks) plus
  `MIN_ASSIGNMENTS_PER_VARIANT = 1000` and `CONFIDENCE_THRESHOLD = 0.95` as named constants.
  **No gating inside this function** — it does textbook arithmetic and nothing else, so it can
  be tested against textbook answers. ADR 017 (above) already records the definition this
  module implements.
  Tests: `src/__tests__/lib/ab-testing/statistics.test.ts`, tolerance `1e-6` on `pValue`:

  | # | control | treatment | expected `pValue` | expected `confidence` | must be |
  |---|---|---|---|---|---|
  | 1 | 100 / 1000 | 150 / 1000 | `0.00072334` | `99.9277%` | significant |
  | 2 | 100 / 1000 | 110 / 1000 | `0.46574345` | `53.4257%` | **NOT significant** |
  | 3 | 100 / 1000 | 128 / 1000 | `0.04883432` | `95.1166%` | just clears 95% |
  | 4 | 100 / 1000 | 127 / 1000 | `0.05699887` | `94.3001%` | just misses 95% |
  | 5 | 0 / 1000 | 0 / 1000 | `1` | `0%` | zero-variance guard, NOT significant |

  Vectors 3 and 4 are one conversion apart and straddle the threshold — they are what catches
  an off-by-one or a one-tailed/two-tailed slip that vectors 1 and 2 sail past. Vector 5 is
  research trap 3 in numeric form: the customer who never wired `trackConversion`.
  **Fails if** any vector mismatches, or if the module gates.

- [ ] **T2 — `evaluateTest`: the gate, as a separate pure function.**
  Same module. `evaluateTest(variants: { variantId, variantName, isControl, assignments, converters }[])`
  → a discriminated union:
  - `{ outcome: "below_sample", progress: { variantId, assignments, required }[] }` — **no
    `confidence` field exists on this branch of the type.**
  - `{ outcome: "inconclusive", variantStats[], confidence }`
  - `{ outcome: "winner", winnerVariantId, variantStats[], confidence }`

  Rules: control is identified by `isControl`, **never by array position** (`results/route.ts:162`
  and `ABTestResults.tsx:74` both assume index 0 today while `lifecycle.ts:90` uses the column —
  the two can disagree about the same test). `below_sample` if **any** variant has
  `assignments < 1000`. `winner` only if `confidence >= 95` **and** that variant's rate strictly
  exceeds control's. Everything else is `inconclusive`. No variant may win with zero converters
  across the board.
  Tests: below-sample returns no confidence key; at-sample-not-significant returns confidence
  and no winner; winner case; all-zero-converters at 1,000+ assignments returns `inconclusive`
  with no winner; control-beats-treatment returns `inconclusive` (control keeps the content —
  there is nothing to promote).
  **Fails if** a confidence number is reachable below the sample floor, or a winner is
  returned without both gates.

- [ ] **T3 — Counting moves into SQL.**
  New migration `<YYYYMMDDHHMMSS>_ab_test_variant_stats.sql` (14 digits — the existing
  `20260127_ab_testing_v2.sql` has 8 and its ledger order is not guaranteed; do not copy that).
  Creates `ab_test_variant_stats(p_test_id uuid)` returning one row per variant:
  `variant_id, variant_name, variant_content, is_control, assignments, converters` where
  `assignments = count(*) from visitor_buckets` for that variant and
  `converters = count(distinct visitor_id) from ab_test_results where event_type = 'click'`.
  `SECURITY DEFINER`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO
  service_role` — the pattern at `20260805190000_lock_down_content_version_rpcs.sql:50-55`.
  Postgres' implicit `PUBLIC` grant is what actually needs revoking.
  This one task kills four defects at once: the unit mismatch, the unbounded
  `select` at `results/route.ts:57-66` (no `.limit()`, so PostgREST's row cap silently truncates
  at exactly the volumes AC 3 asks for), the `total_participants` Set-of-`undefined` that always
  returns 1 (`:191`), and JS-side counting.
  **Fails if** the route still fetches raw `ab_test_results` rows, or the grant is missing.

- [ ] **T4 — `GET /api/ab-tests/[testId]/results` rebuilt on T1–T3.**
  Delete the duplicate `calculateSignificance` at `:203-235`. Call the RPC, pass its rows to
  `evaluateTest`, return `{ test, variants, evaluation }`. Keep the deliberate `POST` 405 at
  `:100-121` (commit `3099c07` — do not regress it). Keep the existing auth + `site_permissions`
  check; add no entitlement gate.
  Tests: the existing `results-unauthenticated.test.ts` stays green; **a new test asserts the
  serialized response body for a below-sample test contains no `confidence`, `p_value`,
  `significance` or `zScore` key anywhere.** The peeking interdict is asserted at the API
  boundary, not only in the DOM — a number the API does not send cannot leak through a tooltip,
  a devtools tab, or the next component someone writes.
  **Fails if** any significance figure crosses the wire below the sample floor.

- [ ] **T5 — Lifecycle: idempotent completion, and a hard refusal to promote when inconclusive.**
  `src/lib/ab-testing/lifecycle.ts`: delete the local `calculateSignificance` (`:222-253`), the
  N+1 count loop (`:41-76`), the summed-across-variants sample gate (`:79-87`), the hardcoded
  `< 30` floor (`:99`), and — critically — **the `reduce` at `:132-136`**, which today promotes
  the highest-rate variant when nothing is significant and, with all rates at `0`, promotes the
  *first* variant to a live customer site. Replace with the T3 RPC + `evaluateTest`.
  Completion becomes a **conditional update**: `.update({...}).eq("id", testId).eq("status",
  "active").select("id")`, and `promoteWinner` runs **only if that update returned a row**. Two
  concurrent runs both read `active` today and both promote.
  `inconclusive` past end date → `status = 'completed'`, `winner_variant = null`,
  `statistical_significance = 0`, **no promotion**. No new column: "inconclusive" is
  `status = 'completed' AND winner_variant IS NULL`.
  Tests: second invocation with the conditional update returning zero rows never calls
  `promoteWinner`; an all-zero-conversion test past its end date completes as inconclusive and
  promotes nothing; a genuine winner promotes exactly once.
  **Fails if** a duplicate run promotes twice, or an inconclusive test writes content.

- [ ] **T6 — Promotion travels the human edit path.**
  New migration `<YYYYMMDDHHMMSS>_promote_ab_test_winner.sql` defining
  `promote_ab_test_winner(p_test_id uuid, p_variant_id uuid) returns uuid`, one transaction,
  in this order:
  1. `UPDATE content_elements SET staging_content = <variant_content>, staging_updated_at = now()`
     for `(site_id, element_id = target_element_id)`;
  2. `INSERT INTO staging_history (content_element_id, staging_access_id, previous_content,
     new_content, user_email, action)` — `staging_access_id` null, `user_email` `'ab-test:'||p_test_id`,
     `action` `'update'` or `'create'` per prior `staging_content`. This mirrors
     `src/app/api/staging/content/[siteId]/route.ts:247-256` exactly;
  3. `SELECT create_content_version(site_id, 'ab-test', <description>, 'ab_test_winner')`,
     returning the version id.

  **Step 3 must come after step 1.** `create_content_version` snapshots
  `COALESCE(staging_content, published_content, current_content, original_content)`
  (`20260805120000_reconcile_create_content_version.sql:64-70`); called first, it silently
  records the *pre-promotion* copy and AC 7 passes while being false.
  `promoteWinner` becomes one RPC call. Delete the direct `content_elements.update` (`:187-195`)
  and the `content_history` insert (`:211-216`) — `content_history` is **not the table the
  dashboard reads**; `GET /api/edit-board/history` reads `content_versions` (`:88`, `:109`).
  That mismatch is why AC 7 is silently false today. Keep the `is_control` early return
  (`:184`): if control wins, the live copy is already correct.
  Multi-step writes go through a Postgres function per AGENTS.md — this is why it is one
  function and not three round trips.
  Tests: `promoteWinner` calls the RPC with `(testId, variantId)` and performs no direct table
  write; a control winner calls nothing.
  **Fails if** any direct `content_elements` or `content_history` write survives in
  `lifecycle.ts`.

- [ ] **T7 — Rip out the inline peeking trigger.**
  Delete `src/app/api/ab-tests/track/route.ts:169-189`, which runs the full completion check on
  roughly every 50th `view` event from a **public, unauthenticated-visitor-triggered** path.
  Repeatedly re-evaluating a 95% threshold as data arrives inflates the false-positive rate far
  above the nominal 5% no matter how correct each individual evaluation is. Removing the number
  from the UI while leaving this in place satisfies the letter of AC 5 and none of its purpose.
  Leave a tombstone comment in the house style (AGENTS.md: *"a comment saying what broke last
  time is the asset"*) naming continuous re-evaluation as the reason.
  Tests: a `POST /api/ab-tests/track` with view events never invokes `checkTestCompletion`.
  **Fails if** the dynamic import survives.

- [ ] **T8 — Schedule the cron.**
  Add `{ "path": "/api/cron/ab-test-lifecycle", "schedule": "0 3 * * *" }` to `vercel.json`
  (today it holds only `/api/cron/generate-blog-post`, confirmed at `docs/architecture.md:279`).
  **Daily, deliberately**: Vercel's Hobby tier allows one cron per day, so a daily cadence is
  correct on every plan tier and end-date granularity is one day — which the UI states rather
  than implies. T5's conditional update makes cadence a free variable; tighten later without
  touching correctness.
  Fix the stale header comment at `cron/ab-test-lifecycle/route.ts:6-7`, which claims the job
  already runs every 5 minutes. That comment is the exact defect class this story exists to
  kill: a confident, plausible, false statement.
  `CRON_SECRET` is a **precondition, not a task output** — `route.ts:14` fails closed when it is
  unset, so scheduling without it yields a job that 401s silently every night. Add it to
  `.env.example`; verifying it in the Vercel project is a DoD line.
  Tests: a test asserting `vercel.json` contains the entry; a route test asserting a wrong
  bearer returns 401.
  **Fails if** the schedule is absent or the stale comment survives.

- [ ] **T9 — The screen, per `docs/designs/s12-ab-results.md`.**
  Compose from `src/components/ui/` only; invent no primitive (AGENTS.md).
  - `src/components/ui/status-badge.tsx:177-206`: add two entries to the existing
    `abTestStatuses` registry — `winner` (tone `success`, icon `Trophy`) and `inconclusive`
    (tone `neutral`, icon `CircleDashed`). Design gap 1. `completed` is tone `accent` and
    cannot express either. Extends the registry pattern; no new component.
  - `src/hooks/useABTestResults.ts`: return the new `evaluation` shape. Keep the
    `{ data, loading, error, refetch }` contract; a non-ok response produces an error state,
    never an empty list (`useSites.ts` is the reference).
  - `ABTestVariantCard.tsx`: label the denominator **"Assignments", not "Impressions"** — it
    counts `visitor_buckets` rows, and an `s09` impressions feature will later live on the same
    page. Always show Assignments / Conversions / Rate (AC 1 gates nothing). **Delete the
    unconditional confidence render at `:94-96` and the "Leading" trophy at `:40-45`** — the
    latter crowns a variant at n=1. Below sample: a track+fill progress readout
    ("482 of 1,000 assignments") composed from `bg-surface-2` + `bg-primary` + `rounded-full`
    (design gap 2 — no `Progress` primitive exists; do not add one here). Confidence renders as
    a lead `Metric` **only when the API sent one**, driven by the presence of the field, never
    by a local threshold comparison.
  - `ABTestResults.tsx`: drop the positional control assumption at `:74` and the max-rate
    `bestVariant` at `:50-52`; both come from `evaluation` now.
  - Persistent `Alert variant="info"` carrying the ADR 017 conversion definition in plain
    language, including that a page view means the tested element was present on the page. **AC 2
    is "documented in the UI" — this Alert is the deliverable, not a docs file.**
  - Inconclusive: `Alert variant="default"` stating the original content was kept and nothing
    was published. Winner: `Alert variant="success"` naming the promotion, with
    `Button variant="link"` into version history.
  - `Skeleton` loading; `EmptyState` (icon `FlaskConical`, "No visitors assigned yet") only at
    zero assignments on both variants; `Alert variant="destructive"` on fetch failure — never
    fall through to Empty, which reads as "no data" instead of "we failed".

  Tests (RTL): below-sample render contains no `%`-suffixed confidence string and no
  trophy/"Leading" affordance; winner render contains exactly one confidence figure and one
  "Winner" badge; inconclusive render asserts the "kept your original content" copy; the
  definition Alert is present in every non-loading state.
  **Fails if** a confidence figure renders below the sample floor.

- [ ] **T10 — Correct the docs this story disproves.**
  `docs/architecture.md:279` (cron now scheduled) and `:239` (`conversion_events` is listed
  under A/B and has no relationship to it — it belongs to `src/lib/analytics/tracker.ts:114`).
  Note for the operator at ship: `docs/stories.md:664` still carries the pre-ADR AC 2 wording,
  and framing docs commit on `main`, not from this branch.
  **Fails if** either architecture line still asserts the old state.

---

## Run interdicts

Non-negotiable during execution. Breaking one is a review block, not a discussion.

1. **No significance figure may reach the client while a test is running and below the minimum
   sample.** Not in the DOM, not in a tooltip, not in the JSON payload, not behind a flag. The
   `below_sample` branch of `evaluateTest`'s return type has no `confidence` field, and T4
   asserts the wire format. Do not relax this into a tooltip.
2. **The inline completion check in `track/route.ts` is deleted, not made conditional.**
   Continuous automated re-evaluation is the same statistical harm as human peeking.
3. **Promotion goes through `promote_ab_test_winner` → `create_content_version`.** No direct
   `content_elements` write, no `content_history` insert. If it does not appear in
   `content_versions`, it does not appear in version history.
4. **An inconclusive test promotes nothing.** AC 8 is a hard refusal, not a tie-break. Delete
   the `reduce`; do not "improve" it.
5. **Idempotency is a conditional update that reports rows changed**, not a status read
   followed by a write. Cron platforms retry (`docs/architecture.md:279`).
6. **Two copies of the significance function must become one.** Both files import from
   `src/lib/ab-testing/statistics.ts`. Leaving a second copy means the display and the promotion
   can disagree about the same test — which is how this story fails invisibly.
7. **Zero widget changes.** `public/embed/recopyfast.src.js` is untouched; every event this
   story consumes is already emitted and already persisted. No byte budget is spent.
8. **No zod.** `src/lib/api/validation.ts`, extended if needed (ADR 003).
9. **No entitlement gate here.** `s11b` owns it; a second gate is a second thing to drift.
10. **Never edit an applied migration.** Two new forward-only 14-digit files.

## The point everything turns on

**A wrong significance calculation does not throw.** It renders a confident, plausible,
incorrect recommendation, the customer acts on it, and nothing anywhere reports an error. Every
other failure in this story is loud by comparison.

Concretely, today, in production: the p-value divides click *events* by visitor *counts*, so it
is wrong before any threshold is applied; the sample gate sums views across variants instead of
requiring 1,000 each; the UI prints a confidence figure at n=1; the ingest path re-evaluates the
threshold every ~50 views from a public endpoint; and a test that measured nothing at all
promotes its first variant to the customer's live site at the end date. None of that errors.
All of it renders.

That is why the arithmetic is extracted into one pure, dependency-free function pinned to five
known vectors — including two that differ by a single conversion and straddle 95%, and one that
must never reach significance. If T1's suite is green and T2's gate is honest, every remaining
task in this plan is plumbing. If T1 is wrong, everything downstream is confidently wrong, and
the tests will agree with it.

## Files touched

**New**
- `src/lib/ab-testing/statistics.ts`
- `src/__tests__/lib/ab-testing/statistics.test.ts`
- `src/__tests__/lib/ab-testing/lifecycle.test.ts`
- `src/__tests__/api/ab-tests/results-below-sample.test.ts`
- `src/__tests__/api/ab-tests/track-no-inline-check.test.ts`
- `src/__tests__/components/dashboard/ab-results/ABTestVariantCard.test.tsx`
- `src/__tests__/config/vercel-crons.test.ts`
- `supabase/migrations/<ts>_ab_test_variant_stats.sql`
- `supabase/migrations/<ts>_promote_ab_test_winner.sql`
- `docs/decisions/017-ab-conversion-is-per-visitor.md` (written; not new on this branch)

**Modified**
- `src/lib/ab-testing/lifecycle.ts` (the file `docs/stories.md:741-742` omits from its
  "Existing:" list, and where the promotion actually happens)
- `src/app/api/ab-tests/[testId]/results/route.ts`
- `src/app/api/ab-tests/track/route.ts`
- `src/app/api/cron/ab-test-lifecycle/route.ts` (stale comment only)
- `src/components/ui/status-badge.tsx`
- `src/components/dashboard/ABTestResults.tsx`
- `src/components/dashboard/ab-results/ABTestVariantCard.tsx`
- `src/components/dashboard/ab-results/ABTestOverviewStats.tsx`
- `src/hooks/useABTestResults.ts`
- `vercel.json`, `.env.example`
- `docs/architecture.md`

**Untouched, deliberately**: `public/embed/recopyfast.src.js`, `src/app/api/ab-tests/bucket/[siteId]/route.ts`,
`src/app/api/ab-tests/route.ts`, everything `s11a`/`s11b` own.

## Test strategy

Jest + Testing Library, colocated in `__tests__/` (AGENTS.md).

| Layer | What it proves | AC |
|---|---|---|
| `statistics.test.ts` — 5 vectors, tolerance `1e-6` | the arithmetic is right, including one that must not reach significance and two one-conversion-apart cases straddling 95% | 4 |
| `statistics.test.ts` — `evaluateTest` | below-sample carries no confidence; no winner without both gates; all-zero-converters is inconclusive | 3, 5, 8 |
| `results-below-sample.test.ts` | no significance figure crosses the wire below sample | 5 |
| `results-unauthenticated.test.ts` (existing, must stay green) | no auth regression | — |
| `lifecycle.test.ts` | duplicate run promotes once; inconclusive promotes nothing; winner promotes via RPC only | 6, 7, 8, 9 |
| `track-no-inline-check.test.ts` | ingest never triggers completion | 5 |
| `ABTestVariantCard.test.tsx` | no confidence string and no trophy below sample; exactly one above | 1, 5 |
| `vercel-crons.test.ts` | the schedule exists | 6 |

Notes:
- Coverage thresholds in `jest.config.js` are a **ratchet**: raise them to the level this story
  earns. Never lower them.
- Migrations are reviewed as SQL, not executed by Jest. The grant lines (`REVOKE … FROM PUBLIC,
  anon, authenticated` then `GRANT … TO service_role`) are a named review item — Postgres grants
  `EXECUTE` to `PUBLIC` on every new function, and revoking only the named roles leaves the
  implicit grant behind.
- Do not modify a test to accommodate a change in behaviour. Change the behaviour, or change
  the test and say so in the PR.

## Definition of Done

- [ ] All ten tasks ticked; every AC 1-9 maps to a named passing test above.
- [ ] `src/lib/ab-testing/statistics.ts` is the **only** significance implementation in the repo
      (`grep -rn "pooledRate\|normalCDF" src/` returns one file).
- [ ] No significance figure is reachable below the sample floor — asserted at the API boundary
      and in the DOM.
- [ ] `grep -rn "content_history" src/lib/ab-testing/` returns nothing.
- [ ] `grep -n "checkTestCompletion" src/app/api/ab-tests/track/route.ts` returns nothing.
- [ ] ADR 017 referenced from the UI definition alert and this plan; `docs/architecture.md:239,279`
      corrected; the `docs/stories.md:723` AC 2 reword flagged for `main` at ship.
- [ ] **`CRON_SECRET` confirmed set in the Vercel project before merge** — without it the newly
      scheduled job 401s silently every night and AC 6 is false in production while green in CI.
- [ ] `npm run lint`, `type-check`, `format:check`, `build`, `test` all green; CI's `audit:prod`
      and `type-check:build` green.
- [ ] Embed artifact unchanged — `npm run build:embed --check` clean, byte count unmoved.
- [ ] Single PR, structured description, readable diff. One story commit; the two migrations may
      be a second commit if they should be revertible on their own.
- [ ] `/ks-review` passed, no open critical.
