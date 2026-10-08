# Review — s68a-edit-session-authority

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s68a-edit-session-authority`
(merge-base `659778e`; implementation commits `4c9aa2b`, `aae393b`, `4af6269`).

## Verdict summary

H1 (an `edit` member minting a publish/admin session with no expiry that survives removal) is closed and
proven closed at both the app layer and the database layer. Full jest 326 suites / 4210 tests, type-check,
type-check:build, format:check, build green; `run-db-invariants` 6 suites / 48 tests on a throwaway PG14.
Mutation checks: 8 of 10 disabled guards turn a test red (two postcondition branches have no negative
control — m1).

## Findings

### Major

- **M1 — the 24 h ceiling trusts a holder-writable `created_at`.** `src/lib/auth/editor-access.ts:487-488`,
  `supabase/migrations/20261008100000_edit_sessions_service_role_writes.sql:92-110`,
  `docs/operations/edit-session-authority.md:122-123`. Before the migration lands, an `edit` member can insert
  `{created_at:'2099-01-01', expires_at:'2099-01-01T12:00Z'}`: negative age passes the validator, the data
  step leaves it active, the step-4 verification query returns 0 rows, and extend's ceiling moves to 2099.
  No escalation (live-grant cap and removal still apply), but the session never expires — defeats ADR 047
  rule 2 and the AC "refused whatever its expires_at". Reproduced on a replay. Fix: refuse `created_at` in the
  future beyond a small skew (e.g. 5 min) in the validator; add `OR s.created_at > now()` to the data step,
  the step-0 count and the step-4 query (migrations are unapplied, so amend them now).

### Minor

- m1 — postcondition branches `20261008100000:145` and `20261008110000:119-124` have no negative control.
- m2 — runbook step 0 does not reliably predict a postcondition abort; out-of-order `20260809120000` may need
  `--include-all`, which `stripe-setup.md:59` forbids (aborts are transactional, so safe).
- m3 — `src/lib/auth/edit-sessions.ts:142-201` `validateEditSession` still trusts the row (no caller): trap.
- m4 — `extend/route.ts:122-135` 403 branch now unreachable (validator answers 401 first).
- m5 — data-step clock-skew edge for 24 h sessions created by direct API callers (`:98`).
- m6 — `docs/stories.md:2402` names `create-token-leak.test.ts`; the test is `create-service-role.test.ts`.
- m7 — commit layout vs plan; branch also carries s68b/s68c/s69 docs and ADR 048; squash-merge collapses the
  separately-revertible migration commit.
- m8 — comments list `edit-board history` as an edit-token route (it is not) and omit `staging/validate`.
- m9 — `/api/edit-sessions/create` is now a service-role writer without an IP flood guard, limiter after
  `getUser`; AGENTS.md:173 no longer lists every service-role principal.

## Not verified

PostgREST with a real GoTrue JWT and the four newly named DB suites on the Supabase CLI stack (docker down);
Playwright e2e; production ledger/step-0 counts; `db push` per-file atomicity; the owner's rollout gestures;
the realtime server still trusts the stored row (s68c).

## Orchestrator note

Owner standing rule: fix majors before shipping. M1 (+ m3, m6, m8) goes back to the implementer, then a
focused re-review updates this verdict.

## Re-review after fix `4faf716` (fresh reviewer, 2026-10-08)

M1 closed at both layers and reproduced on a throwaway PG14: an edit member's own inserts with `created_at`
2099 / +6 min were accepted on the pre-fix replay, flagged by step 0 and step 4, and deactivated by both s68a
migrations (applied twice); +4 min and normal rows stayed active; step 0 and step 4 then returned 0. After the
migration every member INSERT/UPDATE/DELETE on `edit_sessions` is denied. m3, m6, m8 done. Mutation checks on
the app tolerance (0, 7 min, 100 y) and the migration clause (deleted, 3 min, 10 min) each turn a test red. Full
jest 326 suites / 4,212 tests, type-check, type-check:build, `run-db-invariants` 6 suites / 49 tests green.

New minors:

- n1 — the data step (`20261008100000:101-103`) and runbook step 0/4 (`edit-session-authority.md:42-43,
  124-125`) miss `created_at IS NULL`; such a row stays active (the HTTP validator refuses it; the realtime
  server would accept it until s68c). Fix now while unapplied: `OR s.created_at IS NULL` in all three places.
- n2 — `docs/plans/s68c-realtime-grant-parity.md:46-51` has no "+6 min future created_at → refused" parity case.
- n3 — ADR 047 (accepted) was corrected in this unmerged branch; mention in the PR.

Still open: m1 (postcondition branches lack negative controls), m2 (runbook step 0 / `--include-all`), m4
(extend 403 practically unreachable), m5 (data step `expires_at > created_at + 24h` has no skew tolerance), m7
(commit layout; branch carries other stories' docs), m9 (create route: limiter after `getUser`, no IP guard;
AGENTS.md:173 list).

Orchestrator: n1, n2 and m5 go to a short fix run before shipping (migrations are still unapplied).

## Verification of fix `37ffc67` (fresh reviewer, 2026-10-08)

n1, m5 and n2 confirmed; no new defect. The data step deactivates `created_at IS NULL`, future-dated
(> now + 5 min) and over-long (`expires_at > created_at + 24 h + 5 min`) sessions; the tolerance equals
`CREATED_AT_CLOCK_SKEW_MS`; runbook step 0 matches the data step character for character, step 4 carries the
same date/null clauses. `run-db-invariants` 6 suites / 50 tests on a throwaway PG14; mutations (NULL clause
deleted, tolerance 1 min, 7 min) each turn a test red. Full jest 326 suites / 4,212 tests, type-check green.

Still open (minor): m1, m2, m4, m7, m9, n3.

Max severity: minor
Ship allowed: yes
