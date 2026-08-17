---
validated: yes
---
# Plan — Story s11a-ab-data-plane

Branch: `feature/s11a-ab-data-plane`
Research: `docs/research/s11-ab-run-test.md` — read it first; this plan does not repeat it.

## Target story

`s11a — A/B data plane and honest bucketing` (complexity 4), the first of the three stories
`s11-ab-run-test` split into (`docs/stories.md:136`, `docs/research/s11-ab-run-test.md`
`## Split proposal`).

> *As a marketer I want the numbers a test produces to be real so that I am not shipping a
> decision drawn from an empty table.*

**No UI. No dashboard file is touched.** This story ends with a test suite that proves
assignment is stable, the split is honest, the server and the widget agree, and an event
actually lands. It exists ahead of `s11b` because the story's own Risk paragraph is correct:
a bucketing bug is silent — visitors get served variants, numbers accumulate, and the results
are wrong with no error anywhere. The bucketing function needs tests before it needs a UI.

Criteria this story owns, from `docs/stories.md:673-676`:

- A returning visitor is served the same variant on every visit — deterministic from a stable
  input, never random per request.
- Over 10,000 simulated assignments each bucket's share is within ±2 percentage points of its
  configured split, asserted in a unit test.

Criteria it does **not** own: the route and nav (`s11b`), creation and the traffic-split UI
(`s11b`), the one-test-per-element constraint (`s11b`, because the constraint is meaningless
before there is a second creation path), delivery and the swap window (`s11c`).

**Two premises corrected before planning, both binding on the tasks below.**

1. **`ab_test_results` and `visitor_buckets` are not this story's to create.** The research
   report opens by asserting both tables have never existed and prices a database repair into
   its re-score. That is corrected in `docs/stories.md:118-124`: both are created at
   `supabase/migrations/20260127_ab_testing_v2.sql:8` and `:40`, and no migration anywhere
   drops them. **This plan does not create them.**
2. **There is a live contradiction in the repo about premise 1, and Task 2 exists to settle
   it empirically rather than by argument.** `supabase/migrations/20260801200000_missing_base_tables.sql:42-43,63-66`
   states in writing that `20260127_ab_testing_v2.sql` aborted on a `42P01`
   (`ab_test_results REFERENCES ab_tests`, and `ab_tests` did not exist yet), that Supabase
   wraps each migration in a transaction so it rolled back in full, and that this repair file
   *deliberately did not* recreate those two tables. That claim is about the state of the
   **production database**; the corrected fact above is about the state of the **migration
   files**. Both can be true at once. Task 2 probes the actual database and records a verdict.
   **If the probe says the tables are absent, this story stops and escalates** — creating them
   is a scope decision for the operator, not something an agent adds mid-plan.

**Migration-ordering verdict, planned not assumed.** `20260127_ab_testing_v2.sql` carries an
8-digit prefix where every other migration uses 14 (`YYYYMMDDHHMMSS`), so the Supabase ledger
parses its version as the string `20260127`. Read against today's directory, the ordering
holds: `"20251230100000" < "20260127" < "20260531000000"`, and all four migrations that
reference these tables (`20260611020000`, `20260731006000`, `20260731007000`,
`20260801200000`) sort after it. **The expected verdict is therefore "not mis-ordered today".**
The real, narrow defect is a *future* hazard: any migration stamped on the same day with a full
timestamp — `20260127HHMMSS_…` — sorts **before** `20260127_…`, because `'1' < '_'` in ASCII.
A same-day file would silently jump the queue. Task 1 asserts the invariant mechanically rather
than trusting this paragraph, and fixes the ordering only if the assertion disagrees with it.
**The fix is never a rename** — renaming an applied migration changes its ledger key and is
editing an applied migration (`AGENTS.md` non-negotiable 5).

## Tasks (ordered)

- [ ] **1 — Assert the migration-ledger ordering invariant, and record the verdict.**
  New test `src/__tests__/migrations/ledger-order.test.ts`. It reads `supabase/migrations/`
  and asserts (a) every filename matches `^\d{14}_[a-z0-9_]+\.sql$`, and (b) sorting the
  directory lexically produces the same order as sorting by parsed timestamp. **This test fails
  on the first run** — `20260127_ab_testing_v2.sql` breaks (a). Then, and only then, resolve it:
  the file is applied and cannot be renamed, so it goes into a named, single-entry allowlist
  constant in the test with a tombstone comment recording *why* (8-digit ledger version; a
  same-day 14-digit migration would sort ahead of it; the four migrations that reference its
  tables all sort after it today). Assertion (b) stays live and unallowlisted, so the day
  someone adds `20260127120000_*.sql` the suite fails instead of the schema silently applying
  out of order. **If (b) fails today**, the fix is a forward migration that idempotently
  re-asserts the affected objects — not a rename, not an edit to any applied file.
  *Fails when:* a migration is added with a non-14-digit prefix, or lexical and timestamp order
  diverge.

- [ ] **2 — Probe the target database for the two tables, and record a verdict in this file.**
  New `scripts/check-ab-schema.mjs`, run against the target database with the service-role key
  from env (never a literal — `AGENTS.md` non-negotiable 8). It asserts, and exits non-zero on
  any failure: `ab_test_results` and `visitor_buckets` exist; `ab_test_results` carries
  `test_id, variant_id, visitor_id, session_id, event_type, value, metadata, geo_country,
  geo_region, recorded_at`; `visitor_buckets` carries `site_id, visitor_id, test_id, variant_id,
  geo_country, geo_region, bucketed_at` and its `UNIQUE(visitor_id, test_id)`; RLS is enabled on
  both; each has at least one policy. Write the result into this plan under Task 2 as a dated
  one-line verdict. **Decision rule:** present → continue at Task 3. Absent or partial → stop,
  report to the operator, and do not proceed to Task 9 (its index would fail on a missing table)
  or to any task that writes A/B rows. Do not create the tables under this story.
  *Fails when:* a table, column, unique constraint, or RLS policy the code depends on is missing.

- [ ] **3 — Make variant order deterministic, server and widget.**
  Add `.order("is_control", { ascending: false }).order("id", { ascending: true })` to the
  nested `ab_test_variants` select in `src/app/api/ab-tests/active/[siteId]/route.ts:56-75`
  and `src/app/api/ab-tests/bucket/[siteId]/route.ts:132-147`, and sort the same way in the
  widget fallback before the cumulative walk (`public/embed/recopyfast.src.js:3016-3032`).
  Control first, then id — a total order that does not depend on Postgres, which promises none.
  Leave the tombstone comment: an unordered cumulative walk reassigns a returning visitor when
  the planner changes its mind, and nothing anywhere reports it.
  *Fails when:* the same visitor and test, fed the same variants in a different array order,
  produce a different variant id.

- [ ] **4 — Pin the two hash implementations to one set of shared vectors.**
  New fixture `src/__tests__/fixtures/bucketing-vectors.json`: at least 64
  `{ visitorId, testId, expectedHash, expectedBucket }` rows. New test
  `src/__tests__/embed/ab-bucketing-parity.test.ts`, built on the harness at
  `src/__tests__/embed/element-id-page-scope.test.ts:33-40` — it slices the block between
  `// A/B TESTING METHODS` and `// END A/B TESTING METHODS` out of the real
  `public/embed/recopyfast.src.js` and evaluates it in JSDOM, so a transcription cannot pass
  while the widget rots. It runs the fixture through the widget's `fnv1aHash`
  (`recopyfast.src.js:3035-3042`) and through the server's
  (`bucket/[siteId]/route.ts:26-33`) and asserts all three agree.
  *Fails when:* either copy of FNV-1a is edited without the other.

- [ ] **5 — The ±2 pp distribution test, with a specified id generator.**
  New `src/__tests__/api/ab-tests/bucket-distribution.test.ts`. The id generator is stated in
  the test and is **seeded, not random**, so the test cannot flake: a deterministic
  xorshift128 PRNG rendered as v4-shaped UUIDs — the same shape `initVisitorId` produces
  (`recopyfast.src.js:2968`). Sequential and patterned ids are *also* asserted, as a separate
  case, because `fnv1aHash % 100` takes FNV-1a's weakest bits and that is where a defect would
  hide. Splits covered: 50/50, 90/10, and 34/33/33. Assert each observed share is within ±2
  percentage points of configured over 10,000 assignments.
  *Fails when:* the mapping is skewed, or someone replaces the hash with `Math.random()`.

- [ ] **6 — Returning-visitor stability.**
  Same test file. Assert that a fixed `(visitorId, testId)` yields the same variant across two
  simulated page loads, across the server path and the widget fallback path, and after the
  variant array is reordered (leans on Task 3). Assert a persisted `visitor_buckets` row is
  honoured in preference to re-hashing, which is what makes the guarantee survive a split
  change mid-test.
  *Fails when:* assignment is recomputed instead of read back, or the two paths disagree.

- [ ] **7 — `bucket` stops discarding its own query errors.**
  `src/app/api/ab-tests/bucket/[siteId]/route.ts:120-124` destructures `data` and drops `error`. A failed
  read of `visitor_buckets` currently presents as "this visitor has no assignments", so every
  returning visitor is re-bucketed and the persisted assignment is ignored. Read the error,
  `console.error` the detail, and return 500 — the widget's job is to fall back to default
  content, not to invent an assignment. Same treatment for the `upsert` at `:200-206`, which
  today logs and returns success.
  *Fails when:* a forced query error produces a 200 with an empty `assignments` object.

- [ ] **8 — A non-OK bucket response stops the A/B path in the widget.**
  `bucketVisitor` only `return`s inside `if (response.ok)` (`recopyfast.src.js:3003-3008`), so
  a 401 or a 500 skips the `catch` and lands on the client-side bucketing at `:3014`. A revoked
  token therefore still splits traffic while every `track` call 401s — the numbers that
  accumulate are skewed by exactly the population that failed. Make a non-OK response clear
  `activeTests` and `variantAssignments` and return; keep the client fallback for the *network
  error* case only, and mark those assignments so `trackImpressions` still fires (they are
  shown) but the failure is visible in one `console.warn`. Edit `recopyfast.src.js`, then
  `npm run build:embed`.
  *Fails when:* a 401 from `bucket` still results in a variant being applied.

- [ ] **9 — Replace the view-dedup race with a database constraint.**
  New forward migration `supabase/migrations/<YYYYMMDDHHMMSS>_ab_results_view_dedup.sql`:
  `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_atr_unique_view ON ab_test_results
  (visitor_id, test_id) WHERE event_type = 'view';`. `ab_test_results` already has RLS and
  policies (`20260127_ab_testing_v2.sql:56-64`, tightened in `20260611020000:25-64`) — the
  migration adds an index only and changes no policy, and says so in its header (ADR 002: a new
  *table* needs a policy in the same migration; this creates none). Then rewrite
  `src/app/api/ab-tests/track/route.ts:101-136`: drop the `SELECT count` loop (a read-then-write
  race *and* an N+1, one round trip per unique `(visitor, test)`) and use a single
  `.upsert(rows, { onConflict: "visitor_id,test_id", ignoreDuplicates: true })` for view events.
  *Fails when:* two concurrent identical view batches produce two rows.

- [ ] **10 — Lock the site-token gate with tests (guards `3099c07`).**
  New `src/__tests__/api/ab-tests/site-token-gate.test.ts`. For each of `active`, `bucket`,
  `track`: a request with no token is refused; a request with a valid token but a foreign
  `Origin` is refused; a valid token with the registered origin succeeds. Three routes × three
  cases. These are the tests that make the interdict below mechanical instead of aspirational.
  *Fails when:* anyone removes an `authorizeSiteRequest` call or relaxes the Origin pin.

## Run interdicts

- **Do not create `ab_test_results` or `visitor_buckets`.** If Task 2 says they are absent,
  stop and escalate. Do not "helpfully" add a `CREATE TABLE IF NOT EXISTS`.
- **Never edit or rename an applied migration.** Forward-only, `YYYYMMDDHHMMSS_snake_case.sql`.
  This applies to `20260127_ab_testing_v2.sql` above all — its 8-digit name is a scar, not a
  bug to tidy.
- **Do not regress `3099c07`.** `active`, `bucket` and `track` each call `authorizeSiteRequest`
  and it throws on a missing token *and* pins `Origin`/`Referer` to the registered domain
  (`src/lib/security/site-auth.ts:118`, `:163`). The site token is public by construction — it
  ships as a plain attribute in the customer's markup — so the Origin pin is the whole defence.
  Task 10 is the guard; do not weaken either half to make a test pass.
- **No zod.** Validation goes through `src/lib/api/validation.ts`, extended if a validator is
  missing (ADR 003). The workspace coding rules name zod by default; `AGENTS.md` and ADR 003
  override them.
- **Bucketing is deterministic from a stable input, never random per request.** No
  `Math.random()`, no `Date.now()`, no request-scoped entropy anywhere on the assignment path.
- **`recopyfast.src.js` is the source; `recopyfast.js` is generated.** Never hand-edit the
  artifact. Run `npm run build:embed` after every widget edit;
  `node scripts/build-embed.mjs --check` must pass.
- **The widget degrades, never breaks.** No uncaught exception may reach the host page's
  `window`. Task 8 makes the A/B path *stop*, not *throw*.
- **No UI.** Nothing under `src/app/dashboard/`, `src/components/`, or `src/hooks/` is touched.
- **Do not lower the coverage thresholds** in `jest.config.js` (16/19/22/22). They are a
  ratchet. This story only raises them.

## The point everything turns on

**Whether the two implementations of one algorithm can be shown to agree, on evidence, before
either of them is trusted with a customer's decision.**

Everything else here is plumbing. The failure this story exists to prevent has no error, no
log line, no 500 and no support ticket: the server hands variant A to a visitor, the widget's
fallback hands variant B to the same visitor on the next page, both are recorded under one
`visitor_id`, and six weeks later a marketer ships the headline the arithmetic preferred. The
research names it exactly — *"they agree today by transcription. Nothing enforces it."*

That is why Task 4 runs the **shipped widget source** through JSDOM rather than a transcription
of the hash, and why Task 5 states its id generator instead of reaching for `Math.random()`. A
±2 pp test over ids nobody specified proves nothing; a parity test against a copy-pasted hash
proves less than nothing, because it passes forever while the widget rots.

The second-order version of the same point is Task 7 and Task 8: **a silent failure on the
assignment path is worse than a loud one**, because it does not merely lose data, it *biases*
the data that survives. A 401 that falls through to client-side bucketing keeps splitting
traffic while nothing is counted, and the population that failed is not random.

## Files touched

**Modified**
- `src/app/api/ab-tests/active/[siteId]/route.ts` — variant `ORDER BY` (Task 3)
- `src/app/api/ab-tests/bucket/[siteId]/route.ts` — variant `ORDER BY` (3); read the
  `visitor_buckets` query and upsert errors, 500 on failure (7)
- `src/app/api/ab-tests/track/route.ts` — replace the read-then-write dedup loop with a single
  conflict-ignoring upsert (9)
- `public/embed/recopyfast.src.js` — sort variants in the fallback (3); a non-OK bucket response
  stops the A/B path (8). **Source only.**
- `public/embed/recopyfast.js` — regenerated by `npm run build:embed`, never hand-edited

**Created**
- `supabase/migrations/<YYYYMMDDHHMMSS>_ab_results_view_dedup.sql` (9)
- `scripts/check-ab-schema.mjs` (2)
- `src/__tests__/migrations/ledger-order.test.ts` (1)
- `src/__tests__/fixtures/bucketing-vectors.json` (4)
- `src/__tests__/embed/ab-bucketing-parity.test.ts` (4)
- `src/__tests__/api/ab-tests/bucket-distribution.test.ts` (5, 6)
- `src/__tests__/api/ab-tests/site-token-gate.test.ts` (10)

**Read, not modified**
- `src/lib/security/site-auth.ts`, `src/lib/ab-testing/lifecycle.ts`,
  `supabase/migrations/20260127_ab_testing_v2.sql`,
  `supabase/migrations/20260611020000_tighten_permissive_policies.sql`,
  `supabase/migrations/20260801200000_missing_base_tables.sql`,
  `src/__tests__/embed/element-id-page-scope.test.ts`

## Test strategy

Jest, colocated under `src/__tests__/`, per `AGENTS.md`. Three layers.

**1. Widget-source tests (JSDOM), the harness from `element-id-page-scope.test.ts:33-40.**
The A/B block is sliced out of the real `public/embed/recopyfast.src.js` between its existing
`// A/B TESTING METHODS` / `// END A/B TESTING METHODS` markers and evaluated with `document`
and a stubbed `fetch` injected. Nothing is transcribed into the test file. Covers: hash parity
(4), fallback ordering (3), the non-OK-response stop (8).

**2. Route tests.** Supabase client mocked at the module boundary, as the existing
`src/__tests__/api/ab-tests/*.test.ts` files already do. Covers: `ORDER BY` present and
honoured (3), query-error propagation (7), dedup upsert (9), the nine token/origin cases (10).

**3. Pure-function tests.** `bucketVisitorToVariant` and `fnv1aHash` imported directly for the
distribution and stability work (5, 6). 10,000 assignments × three split configurations runs in
well under a second; no `--runInBand` accommodation, no snapshot.

**Explicitly asserted, because the research says nothing else will ever tell us:**
- ±2 pp over 10,000 assignments, with the id generator written down in the test.
- Sequential and patterned ids as a distinct case from seeded-UUID ids.
- Server hash ≡ widget hash across ≥ 64 shared vectors.
- Same visitor → same variant across two loads, across both paths, after a reorder.
- A persisted bucket beats a re-hash.
- Two concurrent identical view batches → exactly one row.
- Missing token → refused, on all three routes. Foreign Origin → refused, on all three routes.

**Not asserted here:** anything that needs a dashboard (`s11b`), anything about swap timing or
bytes (`s11c`), significance maths (`s12`).

**Coverage.** New tests raise measured coverage; ratchet `jest.config.js` up to the new
measured floor in the same commit, never down.

## Definition of Done

- [ ] Task 1's verdict recorded in this file: whether lexical and timestamp order agree today,
      and whether any fix was needed. `ledger-order.test.ts` green, with exactly one
      allowlisted historical filename and a tombstone explaining it.
- [ ] Task 2's verdict recorded in this file, dated. If it reported anything absent, the story
      is stopped and escalated rather than shipped.
- [ ] Variant order is total and stable in `active`, in `bucket`, and in the widget fallback.
- [ ] Server FNV-1a and widget FNV-1a proven equal against ≥ 64 shared vectors, with the widget
      side sliced out of the shipped source, not transcribed.
- [ ] ±2 pp over 10,000 assignments holds for 50/50, 90/10 and 34/33/33, with the id generator
      specified in the test, and separately for sequential ids.
- [ ] A returning visitor gets the same variant across page loads, across both paths, and after
      a variant reorder.
- [ ] `bucket` returns 500 on its own query failure instead of an empty assignment set.
- [ ] A 401 or 500 from `bucket` stops the widget's A/B path; no variant is applied and no event
      is sent.
- [ ] The partial unique index exists; two concurrent identical view batches produce one row.
- [ ] `active`, `bucket` and `track` each refuse a missing token and a foreign Origin — nine
      passing cases guarding `3099c07`.
- [ ] `npm run build:embed` run; `node scripts/build-embed.mjs --check` passes.
- [ ] `lint`, `type-check`, `format:check`, `build`, `test` all green. Coverage thresholds
      raised to the new measured floor.
- [ ] One commit for the story; the migration may be a second commit, since it is the thing you
      would want to revert on its own.
- [ ] No dashboard, component or hook file appears in `git diff main...feature/s11a-ab-data-plane`.
