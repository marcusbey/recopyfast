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

- [x] **1 — Assert the migration-ledger ordering invariant, and record the verdict.**
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

  > **Verdict (2026-08-17) — not mis-ordered today. No fix applied, no migration written.**
  > Assertion (a) failed on the first run, on exactly one file — `20260127_ab_testing_v2.sql` —
  > as predicted. Assertion (b) passed on the first run and passes unallowlisted, for both
  > orderings the ledger could use: raw filename and parsed version string. Measured, not
  > argued: `20251230100000` < `20260127` < `20260531000000`. Correction to the plan's own
  > paragraph, from `grep`: only **two** other migrations name `ab_test_results` /
  > `visitor_buckets` — `20260611020000` and `20260801200000`, not four; `20260731006000` and
  > `20260731007000` never mention either table. Both sort after it under both orderings, and no
  > migration anywhere drops either table. The 8-digit name is therefore
  > a scar, not a live defect; it is allowlisted in `LEDGER_SCARS` with a tombstone, and the
  > ordering assertions stay live so a same-day `20260127HHMMSS_*.sql` fails the suite.

- [x] **2 — Probe the target database for the two tables, and record a verdict in this file.**
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

  > **Verdict (2026-08-17) — ABSENT. Both tables are missing from the target database. The
  > decision rule fires: Task 9 is stopped and escalated, not shipped.**
  >
  > Probe run against `https://uexwowziiigweobgpmtk.supabase.co` over PostgREST with
  > `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the environment. Verbatim:
  >
  > ```
  >  FAIL  table ab_test_results exists with every column the code writes — HTTP 404
  >        {"code":"PGRST205","message":"Could not find the table 'public.ab_test_results'
  >         in the schema cache","hint":"Perhaps you meant the table 'public.ab_test_variants'"}
  >  FAIL  table visitor_buckets exists with every column the code writes — HTTP 404
  >        {"code":"PGRST205","message":"Could not find the table 'public.visitor_buckets'
  >         in the schema cache","hint":"Perhaps you meant the table 'public.billing_tickets'"}
  >  ????  RLS, policies and UNIQUE(visitor_id, test_id) — not visible over PostgREST
  > VERDICT: ABSENT OR PARTIAL — 2 check(s) failed.
  > ```
  >
  > The hints prove the schema cache is populated with this project's other `public` tables, so
  > this is an absence, not an empty cache. **The full probe could not run**: `SUPABASE_DB_URL`
  > needs either the IPv6-only direct host (`connect EHOSTUNREACH`, no IPv6 egress from here) or
  > the project's pooler region, which is not in the environment. RLS, the policies and
  > `UNIQUE(visitor_id, test_id)` therefore remain unobserved — but they are moot while the
  > tables they would sit on do not exist.
  >
  > **This overturns the plan's premise 1 and `docs/stories.md:118-121`,** which state as a
  > correction-by-measurement that "`ab_test_results` and `visitor_buckets` DO exist". That
  > correction is true of the migration *files* and false of the *database*, which is exactly the
  > distinction premise 2 was written to test. The research report
  > (`docs/research/s11-ab-run-test.md:12-21`) and
  > `20260801200000_missing_base_tables.sql:59-66` were right: `20260127_ab_testing_v2.sql`
  > aborted on a `42P01` before reaching them and is marked applied, so it will never replay.
  > Note this is not repairable by a fresh `supabase db reset` either — `ab_tests` is created by
  > `20260801200000`, which sorts *after* `20260127`, so the same `42P01` would abort the same
  > migration in any environment built from this tree. `docs/stories.md` is not this story's to
  > edit; the correction is reported to the operator.
  >
  > **What this means for the rest of the story.** Nothing here creates the tables. Tasks 3–8 and
  > 10 stand and are unaffected: they are correctness work on the *assignment* path, which reads
  > `ab_tests` / `ab_test_variants` (both present). Their effect in production today is now the
  > right one rather than an academic one — Task 7 turns the `visitor_buckets` read failure into
  > a 500 instead of "this visitor has no assignments", and Task 8 makes that 500 stop the
  > widget's A/B path. Together they convert a live, silent mis-bucketing into a visible refusal:
  > visitors get the page's own copy and no skewed numbers accumulate. That is the story's own
  > thesis applied to its own worst case.

- [x] **3 — Make variant order deterministic, server and widget.**
  Add `.order("is_control", { ascending: false }).order("id", { ascending: true })` to the
  nested `ab_test_variants` select in `src/app/api/ab-tests/active/[siteId]/route.ts:56-75`
  and `src/app/api/ab-tests/bucket/[siteId]/route.ts:132-147`, and sort the same way in the
  widget fallback before the cumulative walk (`public/embed/recopyfast.src.js:3016-3032`).
  Control first, then id — a total order that does not depend on Postgres, which promises none.
  Leave the tombstone comment: an unordered cumulative walk reassigns a returning visitor when
  the planner changes its mind, and nothing anywhere reports it.
  *Fails when:* the same visitor and test, fed the same variants in a different array order,
  produce a different variant id.

  > **ADDITION (2026-08-17) — the fallback also declines a geo-scoped test.** Review finding
  > MAJOR 3: order is not the only input the two paths disagree on. `bucketVisitorToVariant`
  > filters variants by country and region *before* the walk, reading `x-vercel-ip-country` off
  > the request; the widget has neither — geo reaches it only in the bucket response's `geo`
  > field, and on the fallback path that response never arrived. An unfiltered walk is not the
  > safe half of that choice: it walks a **longer** list, so the same bucket number lands on a
  > different variant, and server-A / fallback-B end up recorded under one `visitor_id`. The
  > fallback now returns without assigning when any variant carries a non-empty `geo_countries`
  > or `geo_regions`; the visitor sees the page's own copy, and `trackImpressions` /
  > `setupClickTracking` both already skip a test with no assignment, so no event is sent for a
  > variant nobody was shown. An empty array counts as no restriction, matching the server's
  > `length > 0` test. Nothing writes either column today — `generate/route.ts:170-186` is the
  > only creation path and sets neither — so this is a guard against `s11b`, not a live repair,
  > and four cases in `ab-bucketing-parity.test.ts` hold it. Also fixed there: `nullsFirst:
  > false` on both `ORDER BY is_control DESC`, because Postgres sorts NULLs first under `DESC`
  > while both walks read a NULL as "not the control" and sort it last.

- [x] **4 — Pin the two hash implementations to one set of shared vectors.**
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

  > **DEVIATION (2026-08-17) — the vectors found a defect, not just a drift risk.** The fixture
  > computes FNV-1a from the algorithm definition rather than from either implementation, and
  > both implementations disagreed with it: each read `hash = (hash * 16777619) >>> 0`, a
  > float64 multiply whose product passes 2^53 and is rounded before `>>> 0` reads it — which
  > destroys exactly the low bits `% 100` consumes. Measured over 10,000 seeded ids: low three
  > bits 57% zeros, per-bucket counts 4–328 against an expected ~100, and the configured split
  > missed by more than ±2 pp on 10/90 (2.01), 5/95 (2.06) and 33/33/34 (2.01). Both copies now
  > use `Math.imul`; worst deviation across every split tested is 0.56 pp. This changes the
  > variant a given visitor hashes to — acceptable because `visitor_buckets` rows win over a
  > re-hash (Task 6) and no A/B event has ever been recorded — and it was not in the plan, which
  > assumed the two copies were correct and only unpinned.

- [x] **5 — The ±2 pp distribution test, with a specified id generator.**
  New `src/__tests__/api/ab-tests/bucket-distribution.test.ts`. The id generator is stated in
  the test and is **seeded, not random**, so the test cannot flake: a deterministic
  xorshift128 PRNG rendered as v4-shaped UUIDs — the same shape `initVisitorId` produces
  (`recopyfast.src.js:2968`). Sequential and patterned ids are *also* asserted, as a separate
  case, because `fnv1aHash % 100` takes FNV-1a's weakest bits and that is where a defect would
  hide. Splits covered: 50/50, 90/10, and 34/33/33. Assert each observed share is within ±2
  percentage points of configured over 10,000 assignments.
  *Fails when:* the mapping is skewed, or someone replaces the hash with `Math.random()`.

- [x] **6 — Returning-visitor stability.**
  Same test file. Assert that a fixed `(visitorId, testId)` yields the same variant across two
  simulated page loads, across the server path and the widget fallback path, and after the
  variant array is reordered (leans on Task 3). Assert a persisted `visitor_buckets` row is
  honoured in preference to re-hashing, which is what makes the guarantee survive a split
  change mid-test.
  *Fails when:* assignment is recomputed instead of read back, or the two paths disagree.

- [x] **7 — `bucket` stops discarding its own query errors.**
  `src/app/api/ab-tests/bucket/[siteId]/route.ts:120-124` destructures `data` and drops `error`. A failed
  read of `visitor_buckets` currently presents as "this visitor has no assignments", so every
  returning visitor is re-bucketed and the persisted assignment is ignored. Read the error,
  `console.error` the detail, and return 500 — the widget's job is to fall back to default
  content, not to invent an assignment. Same treatment for the `upsert` at `:200-206`, which
  today logs and returns success.
  *Fails when:* a forced query error produces a 200 with an empty `assignments` object.

- [x] **8 — A non-OK bucket response stops the A/B path in the widget.**
  `bucketVisitor` only `return`s inside `if (response.ok)` (`recopyfast.src.js:3003-3008`), so
  a 401 or a 500 skips the `catch` and lands on the client-side bucketing at `:3014`. A revoked
  token therefore still splits traffic while every `track` call 401s — the numbers that
  accumulate are skewed by exactly the population that failed. Make a non-OK response clear
  `activeTests` and `variantAssignments` and return; keep the client fallback for the *network
  error* case only, and mark those assignments so `trackImpressions` still fires (they are
  shown) but the failure is visible in one `console.warn`. Edit `recopyfast.src.js`, then
  `npm run build:embed`.
  *Fails when:* a 401 from `bucket` still results in a variant being applied.

- [ ] **9 — Replace the view-dedup race with a database constraint. — STOPPED BY TASK 2.**
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

  > **Not done, on purpose (2026-08-17). Task 2 came back ABSENT, and Task 2's decision rule
  > says "do not proceed to Task 9 (its index would fail on a missing table)".** It was written
  > first, then reverted when the probe ran: the migration, the `track/route.ts` rewrite and
  > `src/__tests__/api/ab-tests/track-view-dedup.test.ts` are all withdrawn, and `track/route.ts`
  > is byte-identical to `main`. The read-then-write dedup race is therefore still there, and is
  > reported unfixed rather than fixed on paper.
  >
  > **Why the migration is not merely useless but harmful while the table is absent.** It would
  > abort on `42P01`, and per `20260801200000_missing_base_tables.sql:37-52` Supabase marks an
  > aborted migration applied so it never replays. The index would then be permanently missing
  > while the ledger said otherwise — the identical failure that put this story here. A
  > `to_regclass` guard around it is worse, not better: it applies cleanly, is marked applied,
  > and still never creates the index.
  >
  > **Two facts verified while it was written down, so the next attempt does not re-derive
  > them.** Both were review findings (`docs/reviews/s11a-ab-data-plane.md`, MAJOR 2).
  >
  > 1. **`onConflict: "visitor_id,test_id"` — as the plan specifies it — raises `42P10`.** The
  >    only index matching those columns is partial (`WHERE event_type = 'view'`), and Postgres
  >    infers a partial unique index only when the statement repeats the index predicate
  >    (`ON CONFLICT (cols) WHERE …`). PostgREST has no way to express that predicate, so the
  >    named target matches nothing.
  > 2. **Omitting `onConflict` does *not* emit a bare `ON CONFLICT DO NOTHING`** — the claim the
  >    withdrawn code made in a comment, and it is false. Read out of PostgREST v12.2.3, the
  >    version line Supabase runs: `src/PostgREST/Plan.hs:936` computes
  >    `confCols = fromMaybe pkCols qsOnConflict`, so with no `on_conflict` query parameter the
  >    conflict target defaults to the table's **primary key**, and
  >    `src/PostgREST/Query/QueryBuilder.hs:117-123` emits `ON CONFLICT("id") DO NOTHING`.
  >    `ab_test_results.id` is `gen_random_uuid()` and never collides, so the partial index would
  >    raise `23505`, PostgREST would return 409, the route would 500 — and `sendBeacon` discards
  >    the response, so the loss is silent. Worse, one duplicate aborts the whole multi-row
  >    `INSERT`, taking the batch's genuinely-new rows with it. (postgrest-js 1.19.4 confirmed to
  >    send `Prefer: resolution=ignore-duplicates` and no `on_conflict`:
  >    `PostgrestQueryBuilder.js`, `upsert`.)
  >
  > So whoever picks this up needs a conflict target Postgres can infer without a predicate —
  > which means the dedup key has to be expressible as a *non-partial* unique index — or an
  > explicit `23505`-is-success path in the route. That is a design decision, and it belongs at
  > plan level with the table creation, not here.

- [x] **10 — Lock the site-token gate with tests (guards `3099c07`).**
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

## Byte allocation — this story needs 58 gzipped bytes it does not have

Review finding MAJOR 4. **The story ends 58 gz bytes over both of `s06a`'s ceilings, and the
excess is irreducible without dropping a task the plan mandates.** No constant was raised: the
gate lives on `feature/s06a-embed-byte-gate` and is not on this branch, so this is a merge
decision for the operator, recorded here rather than absorbed silently.

Measured with `s06a`'s own method — Node `zlib.gzipSync` level 9, widget = the artifact with the
socket.io payload spliced out (`scripts/build-embed.mjs`, `measureBundle`, on that branch). Every
line below is a real `node scripts/build-embed.mjs` run, not an estimate:

| Artifact state | bundle gz | vs `MAX_BUNDLE_GZ` 46875 | widget gz | vs `MAX_WIDGET_GZ` 34063 |
|---|---|---|---|---|
| `main` | 46,875 | +0 | 34,063 | +0 |
| `Math.imul` fix + Task 8 stop + reworded warning | 46,875 | **+0** | 34,064 | +1 |
| … + Task 3's widget sort | 46,910 | +35 | 34,099 | +36 |
| … + the geo guard (MAJOR 3) — **as committed** | 46,933 | **+58** | 34,121 | **+58** |

So the itemised cost is: **Task 3's fallback sort 37 gz, MAJOR 3's geo guard 23 gz**, and
everything else nets to zero — the `Math.imul` repair and Task 8's refusal branch are paid for by
replacing `'ReCopyFast: Using client-side bucketing fallback'` with
`'ReCopyFast: A/B bucketing unavailable'`, which gzip nearly gets for free because
`'ReCopyFast: A/B tests unavailable'` is already in the file eighty lines up (−11 gz on its own).

**What was tried, and what it bought.** Every candidate was built and measured, not reasoned
about; gzip already compresses this code well, so raw savings do not translate.

- Boolean arithmetic for the comparator (`!!b.is_control - !!a.is_control` in place of the
  four-branch form): kept — this *is* the golfed version, 36 raw bytes below the readable one.
- Dropping `!!`: −5 gz. **Rejected.** `undefined - false` is `NaN`, which falls through to the id
  tiebreak while the server's `Number(Boolean(…))` returns 0 and puts control first. A divergence
  the parity test cannot see is exactly what this story exists to prevent.
- `a.id < b.id ? -1 : 1` in place of `(a.id > b.id) - (a.id < b.id)`: −4 gz. **Rejected**, it is
  not a valid comparator for equal ids.
- Geo guard as a server-computed `geo_scoped` flag on `/ab-tests/active`: −8 gz. **Rejected** —
  it changes a public response shape to buy 8 bytes that do not change the outcome.
- Moving the geo check after the sort so it reads `eligible` rather than `test.variants`: −7 gz,
  **taken**, and it reads better: check what you are about to walk.
- Trimming comments: worth nothing. esbuild strips every one of them.

**Why nothing else can go.** Removing the fallback sort leaves the cumulative walk's answer a
function of whatever order Postgres felt like, which is the defect Task 3 exists to close and
which the reviewer confirmed has bite (deleting the sort turns the suite red). Removing the geo
guard reinstates MAJOR 3. `Math.imul` repairs a live production split-skew. Task 8 is two bytes.

**The real finding is that the ceiling has no room in it, not that this story is fat.**
`docs/stories.md:96-103` allocates **≤ 2,000 gz to A/B bucketing (`s11`)**; 58 is 2.9% of that
allowance. `s06a` seeded `MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ` at the artifact's *current measured*
size, so the artifact sits at both ceilings with zero headroom and **any** story spending its
documented allowance breaches them — which is `s06a`'s own finding F3, and this is its first
concrete instance. `s06c-embed-shrink`, the story that creates headroom, has not run. Three ways
out, for the operator, not for an implementer:

1. Sequence `s06c` before `s11a` and take the headroom from the shrink. Cheapest if `s06c` is
   near.
2. Raise both ceilings by the measured 58 and cite this section — a ratchet that moves by a
   recorded, itemised amount is still a ratchet; one that moves silently is not.
3. Merge `s11a` before `s06a` and re-seed the gate from the measurement that includes it, which
   is the same arithmetic with the branches swapped.

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
- `src/app/api/ab-tests/active/[siteId]/route.ts` — variant `ORDER BY`, `nullsFirst: false` (3)
- `src/app/api/ab-tests/bucket/[siteId]/route.ts` — variant `ORDER BY`, `nullsFirst: false` (3);
  read the `visitor_buckets` query and upsert errors, 500 on failure (7); bucketing moved to
  `src/lib/ab-testing/bucketing.ts` so it can be unit-tested at all (4, 5, 6)
- `public/embed/recopyfast.src.js` — sort variants in the fallback and decline a geo-scoped test
  (3); a non-OK bucket response stops the A/B path (8); `Math.imul` in `fnv1aHash` (4).
  **Source only.**
- `public/embed/recopyfast.js` — regenerated by `npm run build:embed`, never hand-edited
- `jest.config.js` — coverage ratchet raised to the newly measured floor

**Not modified after all**
- `src/app/api/ab-tests/track/route.ts` — byte-identical to `main`. Task 9 is stopped by Task 2's
  ABSENT verdict; the rewrite and its migration were written, then withdrawn.

**Created**
- `scripts/check-ab-schema.mjs` (2)
- `src/lib/ab-testing/bucketing.ts` (3, 4, 5, 6)
- `src/__tests__/migrations/ledger-order.test.ts` (1)
- `src/__tests__/fixtures/bucketing-vectors.json` (4)
- `src/__tests__/embed/ab-bucketing-parity.test.ts` (3, 4, 6, 8)
- `src/__tests__/api/ab-tests/variant-order.test.ts` (3)
- `src/__tests__/api/ab-tests/bucket-distribution.test.ts` (5, 6)
- `src/__tests__/api/ab-tests/bucket-query-errors.test.ts` (7)
- `src/__tests__/api/ab-tests/site-token-gate.test.ts` (10)
- `src/__tests__/api/ab-tests/support/postgrest-chain.ts` — shared supabase-js chain double

**Not created after all**
- `supabase/migrations/<YYYYMMDDHHMMSS>_ab_results_view_dedup.sql` (9) — see Task 9
- `src/__tests__/api/ab-tests/track-view-dedup.test.ts` (9) — same

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
- ~~Two concurrent identical view batches → exactly one row.~~ **Not asserted.** Task 9 is
  stopped by Task 2's ABSENT verdict; the dedup race is still open and is reported as open.
- A geo-scoped test is declined by the fallback rather than guessed at, and the server's answer
  is shown to genuinely depend on the geo the widget does not have.
- Missing token → refused, on all three routes. Foreign Origin → refused, on all three routes.

**Not asserted here:** anything that needs a dashboard (`s11b`), anything about swap timing or
bytes (`s11c`), significance maths (`s12`).

**Coverage.** New tests raise measured coverage; ratchet `jest.config.js` up to the new
measured floor in the same commit, never down.

## Definition of Done

- [x] Task 1's verdict recorded in this file: whether lexical and timestamp order agree today,
      and whether any fix was needed. `ledger-order.test.ts` green, with exactly one
      allowlisted historical filename and a tombstone explaining it.
- [x] Task 2's verdict recorded in this file, dated. If it reported anything absent, the story
      is stopped and escalated rather than shipped.
      **Run 2026-08-17. Verdict ABSENT — both tables are missing from the target database.**
      Task 9 is stopped and withdrawn accordingly, and the absence is escalated. The box is
      ticked because the probe ran and its rule was obeyed, not because the news was good. The
      full `SUPABASE_DB_URL` probe still could not run (no IPv6 egress, pooler region unknown),
      so RLS and `UNIQUE(visitor_id, test_id)` remain unobserved — moot while the tables do not
      exist, and required before anything creates them.
- [x] Variant order is total and stable in `active`, in `bucket`, and in the widget fallback.
- [x] Server FNV-1a and widget FNV-1a proven equal against ≥ 64 shared vectors, with the widget
      side sliced out of the shipped source, not transcribed. *(75 vectors; a third leg computes
      the expected hash from the algorithm definition, which is what caught the float-multiply
      defect — see the deviation note under Task 4.)*
- [x] ±2 pp over 10,000 assignments holds for 50/50, 90/10 and 34/33/33, with the id generator
      specified in the test, and separately for sequential ids. *(Also 10/90, 5/95 and 33/33/34,
      which are the splits the plan's three would have missed the live defect on, and patterned
      ids as a third id family.)*
- [x] A returning visitor gets the same variant across page loads, across both paths, and after
      a variant reorder.
- [x] `bucket` returns 500 on its own query failure instead of an empty assignment set.
- [x] A 401 or 500 from `bucket` stops the widget's A/B path; no variant is applied and no event
      is sent.
- [ ] The partial unique index exists; two concurrent identical view batches produce one row.
      **NOT DONE, and not doable under this story.** Task 2 came back ABSENT, and its decision
      rule stops Task 9: an index on a table that does not exist aborts the migration, which this
      repo's ledger then marks applied. `track/route.ts` is left byte-identical to `main`, so the
      read-then-write dedup race and its N+1 are still there. See Task 9 for the two PostgREST
      facts verified along the way, so the next attempt does not rediscover them.
- [x] `active`, `bucket` and `track` each refuse a missing token and a foreign Origin — nine
      passing cases guarding `3099c07`. *(Fifteen: also no-Origin-at-all and a forged token.)*
- [x] `npm run build:embed` run; `node scripts/build-embed.mjs --check` passes.
- [ ] The artifact is inside `s06a`'s ceilings. **It is not: 46,933 / 46,875 gz bundle and
      34,121 / 34,063 gz widget, +58 on both.** Itemised, and every alternative that was measured
      and rejected, in *Byte allocation* above. No constant was raised — the gate is on
      `feature/s06a-embed-byte-gate` and not on this branch. The 58 bytes are 2.9% of the ≤ 2,000
      gz `docs/stories.md:101` allocates to A/B bucketing; the ceilings were seeded with no
      headroom at all, which is `s06a`'s finding F3. Operator decision, not an implementer's.
- [x] `lint`, `type-check`, `format:check`, `build`, `test` all green. Coverage thresholds
      raised to the new measured floor.
      lint 0 errors (44 pre-existing warnings) · type-check clean · format:check clean · build
      clean · **jest 146 suites passed / 1 skipped, 2020 passed, 36 skipped, 0 failed** ·
      thresholds raised 16/19/22/22 → 34/39/41/41 (measured branches 34.32, functions 39.51,
      lines 41.82, statements 41.57 — each rounded down).

      > **Note for whoever runs this next, because it cost an hour and a wrong conclusion.**
      > A bare worktree has no `.env.local`, and five tests fail without one:
      > `api/ai/translate` (×2), `api/ai/suggest`, `api/content/[siteId]`, `api/sites/register`.
      > They are **not** broken — `createServiceRoleClient()` *throws* when
      > `SUPABASE_SERVICE_ROLE_KEY` is unset (`src/lib/supabase/service.ts:13-17`), so any route
      > that touches it lands in its outer `catch` and answers "Internal server error" instead of
      > the error the test asserts. `jest.setup.js:151-153` sets the URL, the anon key and the
      > OpenAI key but not the service-role key, and `next/jest` did not pick up a `.env.local`
      > here — the values have to be in the environment of the jest process. With
      > `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_APP_URL` exported, the
      > suite is green end to end. I first recorded these as inherited breakage on `main`; that
      > was wrong, and this note replaces it.
- [x] One commit for the story; the migration may be a second commit, since it is the thing you
      would want to revert on its own. *(One commit. There is no migration — see Task 9.)*
- [x] No dashboard, component or hook file appears in `git diff main...feature/s11a-ab-data-plane`.
