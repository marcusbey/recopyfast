# Review — `s11a-ab-data-plane` (re-review of the fix run)

Branch `feature/s11a-ab-data-plane`, commit `1a1e23c`. Fresh context, read-only.
Supersedes the first-pass review (major / ship no, four majors). **All four are genuinely closed.**

## Tests, run by the reviewer

146 suites passed / 1 skipped, **2020 passed, 0 failed**. `lint` 0 errors, `tsc` clean, `prettier`
clean, `build-embed.mjs --check` up to date, and **`npm run build` green — exit 0** (the first-pass
reviewer did not run the build; this one did).

Coverage against the raised ratchet (34/39/41/41): **branches 34.32 · functions 39.51 · lines 41.82
· statements 41.57.** All clear; thinnest margin is 0.32 pp on branches. The SIGSEGV worker flake
appeared once in `src/__tests__/api/ab-tests/route.test.ts`; the isolated re-run was green and the
DoD numbers reproduce exactly.

## Bite — 15 mutations, 14 red, 1 green

Red: server hash `Math.imul`→`*` (10 tests) · widget hash (2) · `orderVariantsForBucketing` sort (2)
· widget fallback sort (1) · geo guard (1) · non-OK `activeTests` clear (4) · `console.warn`→`log`
(1) · `existingBucketsError` check (2) · upsert 500 (1) · `nullsFirst: false` (1) ·
`authorizeSiteRequest` in `active` (4) · Origin pin back to the A-2 form (3) · a planted
`20260127120000_same_day_hazard.sql` (1) · one fixture `expectedHash` bit-flipped (1).

Green: dropping `!!` from the widget comparator — 15/15 still pass. The plan predicts this itself;
recorded as minor 2.

Restored cleanly: `git status --porcelain` empty, `git diff --exit-code` 0, `--check` up to date,
full suite re-run green.

## The Task 9 withdrawal — verified, not taken on trust

`git diff main...HEAD -- supabase/` is empty. `git diff --exit-code -- src/app/api/ab-tests/track/
route.ts` returns 0 — **byte-identical to `main`**. No `track-view-dedup.test.ts`. Grepping
`ux_atr_unique_view|ab_results_view_dedup` across `src/`, `public/`, `scripts/`, `supabase/` and
`docs/` hits **only** the plan's own Task 9 text: no dead references left behind. Task 9's box is
`[ ]`, as are the DoD lines for the index and the byte ceiling. The view-dedup race is **reported
open, not fixed on paper.**

The refusal to plant a `to_regclass`-guarded migration is correct and correctly reasoned: shipping
it would abort, be marked applied, and reproduce the exact scar that created this situation.

## Comparator, bucketing and ordering — checked as arithmetic, not read

Both comparators are valid total orders and mutually equivalent. `!` binds tighter than `-`, `-1` is
truthy so `||` never swallows it, and the id term is the standard sign expression. **The `!!` is
genuinely load-bearing**: `undefined - true` is `NaN`, which falls through to the id tiebreak, while
the server returns −1.

`referencedTable` / `nullsFirst` verified against postgrest-js 1.19.4 source
(`PostgrestTransformBuilder.js:57-60`): `nullsFirst: false` emits `.nullslast`, and the two
`.order()` calls append into a single `ab_test_variants.order` param. Postgres sorts NULLs first
under `DESC`; both walks now sort them last, so client and server agree.

**Hash parity independently recomputed** — all 75 fixture vectors against the reviewer's own BigInt
FNV-1a: 0 hash mismatches, 0 bucket mismatches, 56 distinct buckets across 0–99.

**Byte delta reproduced: +58 exactly, and no constant was raised.** This is accepted and is not a
finding — `s04-retire-graveyard-surfaces` frees 981 bytes and merges first
([`../ship-order.md`](../ship-order.md)).

## Findings — all minor

1. **Task 8 clears `activeTests` but not `variantAssignments`**, though the plan says both. Inert on
   a fresh load, but a click listener bound in an earlier cycle reads `variantAssignments` directly,
   so a click can still fire a beacon after a 401 — which the adjacent comment says will not happen.
   The server refuses it anyway. Undeclared deviation.
2. **The `!!` guard has no test.** Neutralization confirms it. One ordering vector with
   `is_control: null` closes it.
3. **The geo guard creates an unrecorded tension with accepted [ADR 016](../decisions/016-ab-visitor-identity-and-dnt.md) §2**, which names that exact fallback path as the DNT bucketing mechanism and states DNT *"changes nothing about what they see"*. Post-`s11c`, a DNT visitor on a geo-scoped test would see default content while others see a variant. Latent — nothing writes the geo columns today — but unrecorded. **`s11c` must reconcile it.**
4. **ADR 002 §4's fail-closed per-site rate limiter is still absent on all three A/B routes.**
   Pre-existing on `main`, not a regression, carried forward.
5. One stale Task 9 reference survives: the plan's "Test strategy → 2. Route tests" still says
   "dedup upsert (9)".

## Ship note — deliberate, argued, and the operator should know

Once merged, **`GET /api/ab-tests/bucket/:siteId` 500s on every request in production**
(`visitor_buckets` is absent and the error is now surfaced rather than swallowed), and Task 8 then
clears `activeTests` — so **no variant is applied on any site with an active test** until the tables
exist. That trades a silent mis-split for a visible refusal, which is the right trade. The widget
still degrades rather than breaks: `bucketVisitor` is awaited at `recopyfast.src.js:901`, a 500
resolves normally, and init proceeds.

With 0 users the blast radius is nil — **but the feature goes dark on deploy**, and that is a
consequence of merging, not a defect in this branch.

## Not verified — needs a human's hands

- **No database.** The absence was verified from
  `supabase/migrations/20260801200000_missing_base_tables.sql:41-42,59-66` plus independent
  confirmation, not by re-running the live probe. RLS, policies and `UNIQUE(visitor_id, test_id)`
  remain unobserved. **Run `scripts/check-ab-schema.mjs` with a pooler-region `SUPABASE_DB_URL`
  _before_ anything creates these tables.** Note the script ships **on this branch** — it is not on
  `main`, so merging `s11a` is what puts the instrument in the tree.
- **The PostgREST-server half of the `ON CONFLICT` claim** (`Plan.hs:936`,
  `QueryBuilder.hs:117-123`) is unchecked — no offline source available. The postgrest-js half was
  verified locally (1.19.4, `PostgrestQueryBuilder.js:158-162`), as were Postgres's partial-index
  inference semantics. The record is version-pinned and attributed rather than asserted as general
  truth, so it is recorded proportionately — **treat it as a lead, not a settled fact.**
- **No browser.** JSDOM class-body slice only; `sendBeacon` and `fetch` always mocked, the DOM swap
  never run, the cookie never exercised. Needed: revoke a token on a real page and confirm no beacon
  fires and the authored copy stays; kill the network mid-load and confirm one warning plus a
  fallback assignment.
- **The `ORDER BY` was only asserted against a mock** — nothing proves Postgres honours it. The walk
  sorting for itself is what makes that acceptable.
- **No real traffic** — synthetic ids only. **The geo guard was never exercised against a
  geo-scoped test that exists**, because no creation path can write those columns.

## Verdict
Max severity: minor
Ship allowed: yes
