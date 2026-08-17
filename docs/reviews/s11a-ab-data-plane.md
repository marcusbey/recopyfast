# Review — Story s11a-ab-data-plane

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s11a-ab-data-plane` (`98e08fe`). No UI in this story.

## Tests
- [x] Run by the reviewer. A bare worktree showed 5 failed / 2016 passed; the same four suites
      fail identically at `main` (`a213fcb`) — pre-existing, in untouched files. With
      `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_APP_URL` exported:
      **147 suites, 2021 passed, 0 failed.** lint 0 errors, type-check clean, format:check
      clean, `build-embed.mjs --check` up to date. Coverage 34.48 / 39.59 / 41.89 / 41.63, all
      above the raised ratchet.
- [x] **Bite proven by neutralization — 10 mutations, 10 went red.** Server hash → `*` (10 red) ·
      server sort dropped (2) · widget hash → `*` (2) · widget sort dropped (1) · widget non-OK
      stop removed (5) · read-error check deleted (2) · `upsert` → `insert` (3) ·
      `authorizeSiteRequest` removed from `track` (4) · same-day migration planted (1) ·
      `.order("is_control")` removed from `active` (1). All restored, `git diff --exit-code`
      clean.

## The eight verification points — all pass
1. **No table creation.** Only `CREATE UNIQUE INDEX`. The sole `CREATE TABLE` string in the diff
   is the test asserting its absence. No `DROP`. The research's claim that
   `ab_test_results` / `visitor_buckets` were missing was correctly ignored.
2. **Migration ordering verified, not assumed.** The test computes both orderings from disk; the
   plan records a measured verdict and **corrects itself** (two migrations reference those
   tables, not four). Planting `20260127120000_same_day_hazard.sql` turned the suite red.
3. **±2 pp** over 6 splits × 3 id families, seeded xorshift128, plus a bucket-spread assertion
   and a `Math.random` / `Date.now` spy.
4. **Hash parity independently recomputed** — all 75 vectors against an exact BigInt FNV-1a, 0
   mismatches. The fixture encodes the algorithm, not a snapshot of either implementation.
5. **`3099c07` intact.** The gate is not mocked — real HMACs, real refusals, 15 cases × 3 routes.
6. `bucket` reads both its errors → 500; the widget stops the A/B path on non-OK.
7. `ORDER BY` pinned twice, wire and walk.
8. RLS untouched (index only), no rename, no zod.

**The implementer's bonus find is real and was a live defect.** Both FNV-1a copies used a
float64 multiply past 2^53. Reproduced exactly: the old hash bucketed 4..328 where ~100 was
expected, with 5698/10000 ids having their low three bits zero. `Math.imul` → 70..130, 1222.
That was silent split-skew in production, correctly fixed.

## Findings

### MAJOR 1 — Task 2's database probe never ran, and the plan's own stop rule was crossed
The plan is explicit: *"Absent or partial → stop … do not proceed to Task 9."* The verdict is
UNKNOWN and Task 9 shipped anyway. Honestly disclosed and the DoD box left unticked — but the
gate is open. Only credentials are missing; the script runs and exits 2 correctly.

### MAJOR 2 — the `ON CONFLICT` claim is unverified, and if wrong it loses data silently
A code comment and the migration header both assert that omitting `onConflict` makes PostgREST
emit a bare `ON CONFLICT DO NOTHING`. The client half checks out (postgrest-js 1.19.4 sends
`Prefer: resolution=ignore-duplicates` with no `on_conflict`), but **PostgREST's documented
default target is the primary key** — here `id UUID DEFAULT gen_random_uuid()`, which never
collides. If that reading holds, every duplicate view raises 23505, the route 500s, and
`sendBeacon` discards the response — silent loss, which is the exact failure class this story
exists to prevent. The only in-repo precedent
(`content/[siteId]/route.ts:427-430`) passes `onConflict` explicitly.

### MAJOR 3 — hash parity is proven only for geo-null variants
The server geo-filters before the walk; the widget fallback explicitly does not
(`recopyfast.src.js:3053`). Every parity vector uses null geo. On a geo-restricted test with the
endpoint unreachable, the server hands A and the fallback hands B **under one `visitor_id`**.
Latent today, live with `s11b`. Recorded nowhere.

### MAJOR 4 — the artifact breaches `s06a`'s ceiling by 74 bytes
Node zlib -9: `main` 46,875 → branch **46,949**, against `MAX_BUNDLE_GZ = 46875`. Sequencing is
`s06 → s11a`, so if `s06a` merges first, `npm run build` fails. esbuild strips comments, so the
cost is genuine code — this needs a byte allocation, not a comment trim. **This is the concrete
instance of the headroom problem recorded against `s06a` as finding F3.**

### Minors
`recorded` over-reports · `CONCURRENTLY` deviation documented in the migration but not the plan ·
ADR 002 §4 rate limiter absent on all three routes (pre-existing) · the ratchet is not enforced
in CI (`npm test` ≠ `test:coverage`) · NULL `is_control` sorts differently on the wire vs in the
walk.

## Not verified
No database — the index was never created, RLS never observed, "one row" never observed. No
PostgREST, which is exactly what MAJOR 2 turns on, and the embedded-resource `order` was only
asserted against a mock. No browser — the widget was only ever a sliced class in JSDOM,
`sendBeacon` always mocked, the swap never run. No real traffic; synthetic ids only.
`npm run build` was not run by the reviewer.

**Human gestures before merge:** run `check-ab-schema.mjs` with `SUPABASE_DB_URL` and paste the
verdict; on staging, apply the migration and POST the same view event twice — a 500 with 23505
confirms MAJOR 2; revoke a token on a real page and confirm no beacon fires; decide the 74-byte
allocation.

## Verdict
Max severity: major
Ship allowed: no
