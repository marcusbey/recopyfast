# Review — s68b-api-abuse-bounds

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s68b-api-abuse-bounds`
(merge-base `659778e`; code commit `404947c`).

## Verdict summary

M1, M10, M2, M3a/M3b, M4 and M6 hold. M3b's bounded-retry deviation is proven correct: N concurrent guesses
never exceed 5 comparisons and a correct 5th guess consumes exactly once (argument + 1,500-trial randomized
stress probe). Full jest 328 suites / 4,262 tests, type-check, type-check:build, build, build:embed --check
green. Every disabled guard turned a test red except one equivalent mutant (M4 track) and one untested branch
(minor 5).

## Findings

### Major

1. `src/app/api/ab-tests/track/route.ts:67,106-113` — conversions from the public
   `window.recopyfast.trackConversion(eventName, value)` (`recopyfast.src.js:6255`, `:3492` `value: value || 1`)
   are now refused when `value` is a numeric string, > 1,000,000 or negative. The whole beacon (one event per
   active test) gets a 400 that `sendBeacon` ignores → conversions silently lost. Before, they were recorded
   (`value` is DECIMAL). `value` is never read (`lifecycle.ts:74`). Contradicts the AC "accepts what the embed
   sends today" and plan risk #1. Fix via plan amendment: coerce finite numeric strings, and store the default
   instead of refusing an out-of-range or non-numeric value.

### Minor

2. `editor-verification.ts:111-165` — bounded-retry deviation is correct but not recorded in the plan; up to 12
   round trips per guess.
3. `domains/verify/route.ts:300-318` — no fail-closed IP guard before `getUser` (ADR 037 step 1); pre-existing.
4. `domain-verification.ts:226` — a non-3xx failure still echoes `HTTP <status>: <statusText>` (rebinding window,
   now limited to 3 / 5 min / user); a fixed message would close it.
5. `track/route.ts:217` — "view in the same batch counts as viewed" branch untested (0 red when disabled).
6. `track/route.ts:204-230` — conversion dedupe is check-then-insert without a unique constraint (best-effort;
   say so in the PR).
7. `validation.ts:64` — `readBoundedJson` reads the whole body before the 64 KB check (platform cap 4.5 MB).
8. Branch scope carries s68a/s68c docs and ADR 047 (accepted, scope s68a).
9. Reshaped fixture ids in four existing suites + two editor suites must be called out in the PR.

## Not verified

Real-Postgres M3b suite (CI DB step only; docker down); Next's patched fetch keeping `redirect: "manual"` on
Vercel; domain verification end to end; real embed traffic against the new validators; email rendering;
Redis/Upstash limiter behaviour.

## Orchestrator note

Owner standing rule: fix majors before shipping. Major 1 + minors 2, 4, 5 go back to the implementer
(plan amended 2026-10-08), then a focused re-review updates this verdict.

## Re-review after fix `d5613ce` (fresh reviewer, 2026-10-08)

Major 1 fixed: a probe replicating the embed's `trackConversion` + `sendTrackEvent` serialization sent 27
`value` shapes through the real route — every one answered 200 and was recorded. Every M5 bound and the new
coercion branches bite under mutation. Minors 2, 4 and 5 closed. Full jest 328 suites / 4,266 tests,
type-check, type-check:build green.

New minors:

- N1 — `track/route.ts:71,73,122-126`: a non-string or > ~1,000-byte `eventName` from the public
  `trackConversion` still gets the whole beacon refused (same class as major 1).
- N2 — `docs/stories.md:2459`: the M5 AC still says out-of-range `value` is refused with 400.
- N3 — `domain-verification.ts:283`: on a 2xx with wrong content, the first 200 chars of the upstream body go
  back as `details.received` (pre-existing; rebinding concern like minor 4).

Still open from the first review: 3 (no IP guard before `getUser` on `PUT /api/domains/verify`), 6
(best-effort dedupe — say so in the PR), 7 (`readBoundedJson` reads the body before the cap), 8 (branch carries
s68a/s68c docs and ADR 047), 9 (PR must disclose reshaped fixture ids AND the rewritten assertions in
`domain-verification.test.ts`).

Orchestrator: N1, N2, N3 go to a short fix run (owner's standing preference: fix minors, then ship).

## Verification of fix `fabe68a` (fresh reviewer, 2026-10-08)

N1–N3 confirmed; no new defect. `coerceText` is the single implementation, applied before the metadata bound;
truncation is by code point (no lone surrogates created); the `__proto__` refusal holds. Mutations (non-string
coercion, strip, truncation, UTF-16 truncation, route bypass) each turn tests red; re-adding `received` turns
the N3 test red. Remaining domain-check echoes are the customer's own DNS TXT records (not rebinding-controlled)
and local resolver/undici error messages. Full jest 328 suites / 4,275 tests, type-check green.

New minor: a lone surrogate sent by the caller in `event_name` is stored as given (a `jsonb` insert may reject
it; untested; not a regression).

Max severity: minor
Ship allowed: yes
