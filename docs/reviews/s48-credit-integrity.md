# Review: story s48-credit-integrity

Reviewer: fresh-context `reviewer` subagent, 2026-09-28. Report saved verbatim by the orchestrator.

The story is sound and safe to ship. I found one real money defect: a refund can leave the customer a few credits short when requests overlap at the allowance boundary. It's bounded and never mints credits, so it doesn't block. Everything else I checked held up, including under deliberate mutation.

- **Diff reviewed:** `git diff main...feature/s48-credit-integrity`, one commit `93608d8` on base `f4cef65`. `main` is now at `a392bb1`; `git merge-tree` says it still merges cleanly.
- **Where I ran things:** everything ran in `.omx/worktrees/s48-credit-integrity` with the CI placeholder environment, against the local Supabase stack started from the worktree.
- **State I left behind:** the database functions are back to the committed versions (fingerprints checked), no test users remain, the worktree `git diff` is clean, Supabase is stopped (with backup) and colima is still running.

## Plan compliance
- [x] **The code does what the plan says, nothing more.** All nine tasks are present. The eight declared deviations are acceptable:
  - the `refundCredits` deletion moved from T4 to T6;
  - two more pinned balances in tests;
  - `consumeCredits` no longer pre-checks in TypeScript;
  - `refundCharge` also refuses `NaN`;
  - `result.error ?? "No text could be translated."` in the translate route;
  - comment wording;
  - and the other two are covered in the findings below.
- [x] **Run interdicts respected**, each checked:
  - **Migrations:** `git diff main -- supabase/` holds only `20260928110000_atomic_credit_spend_and_refund.sql`. I read the whole file: no UPDATE/DELETE/INSERT of existing rows, no RLS, policy or trigger change.
  - **No SECURITY DEFINER:** the live database shows both functions as INVOKER and VOLATILE. `function-grants`, `rls-policies`, `column-privileges` and `founding-agency-cap` have empty diffs and pass.
  - **s47a's lines:** no changed hunk in `system.ts` falls in `main`'s lines 121–211.
  - **`effective-plan.ts`:** line 527 changes, plus its import on line 5. The import is necessary and disclosed.
  - **Functions that must not change:** `addPurchasedCredits`, `insertNonExpiringGrant`, `revokePurchasedCredits`, `restorePurchasedCredits`, `CREDIT_COSTS`, `canUseAIFeatures`, `canUseTranslation` and the `usage_tracking` insert are all outside every hunk.
  - **Receipts only:** the four `refundCharge(` calls in `src/app` all use `usageResult.charge`. No `refundCredits` identifier remains in `src`, `supabase`, `scripts`, `.github` or `server`.
  - **Out-of-scope paths:** components, billing, the Stripe webhook, `lib/stripe`, ab-tests, middleware, `AGENTS.md` and ADR 035 all have empty diffs.
  - **CI:** exactly one step added (+6 lines, 0 removed).
  - **Suites:** no `.only`, `.skip`, TODO or FIXME, and the DB cleanup deletes only `dbtest-credits-%` users.

## Anti-hallucination
- [x] **No invented API.** I opened every target:
  - `hashtextextended` and `pg_advisory_xact_lock` exist on PG14 and PG15; the PG14 replay applies the migration.
  - `auth.uid()` reads `sub` from the JWT claims. The service-role key has no `sub`, so the caller check is skipped on the suggest path as designed.
  - `createServiceRoleClient` builds a plain service-key client.
  - `spendableFilter`, `readPurchasedCreditBalance`, `resolveEntitlement` and `startOfCurrentMonth` exist as called.
  - The `.rpc()` names and argument names were exercised live through PostgREST.
- [ ] **No plausible-but-wrong logic.** One exception: the overlapping-refund defect (major finding below).
- [x] **The code matches its claims**, with the same exception. The window is the parameter compared with `>=`, not `now()`. The allowance is drawn first. The refund walks debits in reverse with a skip. The cap is net `credits_used`.

## Rules compliance
- [x] AGENTS.md respected: multi-step writes now go through a Postgres function; the new comments explain why and name the incident; the migration is forward-only with a timestamp prefix; test changes are declared in the plan's execution log; one story commit.
- [x] No accepted ADR contradicted. ADR 040 supersedes only ADR 035's rejected alternative, and ADR 035 itself is untouched.
- [x] Design system: not applicable — the diff touches no UI.

## Tests
- [x] Test suite run by the reviewer, passing. Everything below I ran myself in the worktree with the CI placeholder environment:
  - `RCF_REQUIRE_TEST_DB=1 npx jest --runInBand src/__tests__/db`: 11 suites passed / 1 skipped, 91 tests passed / 3 skipped.
  - `credit-spend.test.ts` alone: 27/27. I listed every test name from Jest's JSON output to confirm all 27 ran live — none is a "[gated]" placeholder.
  - Full Jest: 279 suites passed / 2 skipped, 3,620 tests passed / 39 skipped (matches the execution log's claim).
  - Lint: 0 errors (38 inherited warnings); ESLint run directly on the touched files exits 0.
  - `tsc --noEmit`, `type-check:build`, `format:check`: all clean.
  - `npm run build`: exit 0, with the 5 known `fetch failed` lines from the placeholder environment.
  - `env -u RCF_TEST_DB_URL node scripts/run-db-invariants.mjs`: exit 0 on a disposable PostgreSQL 14.17, story migration included.
- [x] The real TypeScript works end to end through local PostgREST. I wrote a scratch script that calls the real `consumeCredits`, `refundCharge` and `resolveEntitlement` against the local stack:
  - User's JWT (translate path): a 5-credit charge leaves the wallet at 7. A partial refund of 2 brings it to 9 with net 3 recorded. A full refund then returns only 3 (capped), and a second full refund returns 0. No purchase row is ever created.
  - Refusals: the JWT calling `refund_credit_usage` gets 42501 permission denied; the JWT naming another user gets 42501 with the function's own message ("may only spend its own credits"); the anon key calling `spend_credits` gets 42501.
  - Service role (suggest path): charge 1, refund 1, pack restored.
  - Insufficient funds: the error sentence carries the function's available amount.
  - Legacy rows: an account holding only a `refund_` row resolves to `none` while keeping 3 spendable credits; a paid pack resolves to `credits`.
  - Operator query parity: the operator's `LIKE 'refund\_%'` and the TypeScript `startsWith` predicate agree on local data (4 rows, 3 users, 4 credits), and the escaped pattern correctly rejects `refundX`.
- [x] Assertions pin the acceptance criteria — rows, balances, status codes and receipts. No assertion-free tests.
- [x] Bite proven by neutralization. Every mutation was applied alone and restored. Database mutations were restored by re-applying the committed migration file, verified with an md5 fingerprint of both function definitions. TypeScript mutations were restored with `/bin/cp -f`, verified by sha256 match plus `git diff --exit-code` on the file. The worktree tree is clean and the live functions match the committed file.

  | Mutation | Tests red |
  |---|---|
  | Advisory lock removed from `spend_credits` | 4 of 27: all four barrier tests, failing on the waiters / resolved-while-held assertion |
  | Lock kept but moved after the in-window sum | 1: the straddle test, behaviourally — 60 credits drawn from the allowance instead of 12 |
  | Refund forgets what earlier refunds returned (`v_skip := 0`) | 1: "two partial refunds equal one refund of their sum" |
  | Caller identity check removed from `spend_credits` | 1: "naming another user's id is refused with the function's own message" — without it the call quietly returns `insufficient` |
  | Window bound `>=` changed to `>` | 1: the oldest-first debit-order test |
  | Per-row refund cap (`LEAST(credits_purchased, …)`) removed | 1: the row reaches 13 against a 10-credit pack |
  | `isLegacyRefundGrant` always false | 2: "P3 legacy" and the `totalPurchased` test |
  | `p_window_start` replaced by the calendar month | 2: both payer-client contract tests |
  | Suggest route drops the receipt (`charge = null`) | 2 refund assertions |
  | Translate partial refund disabled | 2 rounding cases |
  | `batchTranslate` zero case removed | 1 |

  The barrier tests catch the lock removal through their structural assertion (waiters/resolvedWhileHeld), which fires before the money assertion can. Measured separately under the lock-removed mutation: 12 unsynchronised 5-credit charges against a 12-credit allowance drew 46, 50, 60, 60 and 60 credits from that allowance across 5 rounds. The committed code draws exactly 12 from the allowance and 48 from the wallet in all 5 rounds. The allowance double-draw the research inferred is real and the lock is what stops it.

## Regressions
- [x] No impact on existing code paths.
  - `ab-tests/generate` spends a fixed positive cost through `consumeCredits` on the cookie path; its suite passes.
  - `hasEnoughCredits`, `canUseAIFeatures` and `canUseTranslation` are unchanged. Legacy `refund_` rows stay spendable, which is the intended design.
  - `resolveEntitlement:527` is the only place a positive purchased balance grants entitlement; the middleware reads nothing else. The other `spendableFilter()` use in that file (line 361) is on `plan_entitlements`, not credits, so it is unaffected.
  - The `batchTranslate` zero case has exactly one caller (the translate route).
  - Deploy order: old code on the new schema is compatible by inspection — the three new columns have defaults and the relaxed CHECK refuses nothing the old code wrote. Reasoned, not run.

## Findings

**major — supabase/migrations/20260928110000_atomic_credit_spend_and_refund.sql, lines 329-336 (`refund_credit_usage`): the refund does not make the customer whole when requests overlap at the allowance boundary.**

The allowance share of a refund is returned only by lowering the charge's net `credits_used`. If a later, overlapping charge in the same window was paid from purchased credits precisely because this charge had just taken the allowance, the refunded allowance cannot be spent: the later charge's usage already fills the window.

Reproduced on local Postgres — 20 purchased credits, a 2-credit allowance left in the window:
- Request 1 takes 2 from the allowance and 3 from purchased. Request 2 overlaps and takes 5 purchased.
- Request 1 fails and is fully refunded; the function reports `to_allowance = 2`.
- The subject ends with 15 spendable credits. A control account that only ever made request 2 ends with 17.

Bound and reach: the failed call costs up to its allowance share net — at most 5 credits on translate, 1 on suggest. It needs overlapping requests, the allowance boundary, and a failure. It breaks AC 1 ("charges nothing net") and AC 2 ("a refund returns to its source") in that case, and it contradicts the claim in ADR 040 and the migration header that "the wallet ends as if only the kept share had been charged" — which holds only for an isolated charge. Every refund test in the suite uses a single charge, which is why it was not caught.

Not a blocker: it never mints credits (the dangerous direction), it is bounded at 5 credits, there are 0 users, and it is strictly better than the shipped behaviour it replaces.

Fix needs a plan decision, not a one-liner: returning the unabsorbable share means re-attributing a later charge's debits, which breaks the immutable-debit-record rule the design rests on. The alternative is to accept it — state the bound in ADR 040's "Watch" list and pin it with a DB test (a refund plus a concurrent charge).

**minor — same migration, lines 295-326: the refund result can report credits that were never returned.** If a dispute restore puts a debited row back to `credits_purchased` between the charge and its refund, the per-row cap swallows that share; it is still counted in `to_purchased`, lands nowhere, and `credits_used` still drops. This was declared as deviation 5. TypeScript ignores `to_purchased` and `to_allowance`, so it is a reporting inaccuracy in a window of seconds.

**minor — src/lib/billing/trial.ts:72 and src/app/api/ai/suggest/route.ts:144: comment lines run past the file's wrap width.** Prettier does not reflow comments, so `format:check` stays green.

## Not verified
- The HTTP routes never ran — no `next dev`, no browser, no widget. By hand, with local Supabase: POST `/api/ai/translate` with `OPENAI_API_KEY` unset (expect 503, wallet and usage untouched); then with an invalid key (expect 500 "No text could be translated." and the allowance or wallet restored); then make a widget suggestion fail (expect 502 and the owner's allowance restored).
- No real OpenAI call. Provider failures were only ever mocked in the route tests.
- Production was never touched. Nobody has run the operator's `refund_` count query, so whether the legacy predicate is live protection or dead code is still unknown. After the migration, confirm PostgREST sees the functions: one real charge from the dashboard must not come back PGRST202. Production grants were assumed to match the migrations.
- The new CI step never ran on GitHub Actions. Its text is pinned by the contract test and the equivalent command passed locally.
- The dashboard was never rendered. On `/dashboard/billing`, for an account holding a legacy `refund_` row, check that "Total purchased" excludes it and that the history shows no "0" line after a refunded failure.
- I did not re-run the implementer's probe script (`credits-probes-s48.ts`); my own PostgREST end-to-end run with the real functions stands in for it.
- Not exercised: the accepted revoke-then-refund race, and lock contention under production load.

## Product owner disposition (orchestrator, 2026-09-28)

Major finding accepted for launch: bounded at 5 credits per failed call, needs an overlap at the allowance boundary plus a failure, never mints credits, and strictly improves on the shipped behaviour. Follow-up story `s53-refund-overlap-bound` states the bound in ADR 040's "Watch" list and pins it with a DB test. The "Not verified" live checks become the post-deploy smoke test.

## Verdict
Max severity: major
Ship allowed: yes
