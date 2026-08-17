# Review — Story s01-trial-signup

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s01-trial-signup` (`9dc9207`).

## Tests
- [x] Run by the reviewer. **149 suites passed / 1 skipped; 2038 tests passed, 36 skipped, 0
      failed.** lint 0 errors / 44 warnings — **44 on `main` too**, all in untouched files.
      type-check clean, prettier clean, `npm run build` succeeds and `prebuild` left the
      worktree clean, so `public/embed/recopyfast.js` is not stale.
- [x] A first run showed 5 failures in 4 suites. **Not charged** — the reviewer built a second
      worktree at `main` with identical setup and got the *same 5 test names* failing. Cause: a
      scratch worktree lacking `.env`, which `next/jest` loads.
- [x] **Bite proven by neutralization — 11 mutations, 17 tests red, 0 survivors.** Including the
      two singled out: moving the expiry filter out of the query into a post-`maybeSingle` check
      → 3 red across 2 suites, incl. *"keeps a converted customer entitled when their earlier
      trial lapses"*; removing `.neq("source", TRIAL_SOURCE)` → 3 red, incl. the real-route
      *"still sells Lifetime Pro to an account that is only trialling"*. All restored,
      `git diff --exit-code` clean.

## The ten checkpoints — all verified empirically
1. **No `trial` plan row.** `plans.ts` and `20260802000000_plans_catalog.sql` diffs are empty;
   the only migration is `20260817000000_trial_entitlements.sql`, with no `INSERT INTO plans`,
   pinned by a test. ADR 014 honoured.
2. **The expiry filter is inside the query** — `src/lib/billing/effective-plan.ts:245-271`,
   `.or(spendableFilter())` before `.order().limit(1)`. Proven by mutation, not by comment.
3. **`readGrantedPlanIds` excludes trials** — `.neq("source", TRIAL_SOURCE)` at `:230`. `source`
   is `NOT NULL`, so there is no NULL-drop trap.
4. **Expiry is server-computed.** No route in this diff parses a request body at all.
5. **Conversion runs inside the existing lock** — `checkout-reservation.ts`, `user-lock.ts` and
   `checkout/route.ts` diffs are empty, and the integration test drives the *real* checkout
   route and asserts a `checkout_reservations` row lands.
6. **The credit period keys off the trial's `granted_at`**, with a subscription still outranking
   it.
7. **No uncapped OpenAI spend.** Chased past the plan: Pro's `translations: -1` makes
   `canUseTranslation` allow, but `consumeFeatureUsage` still calls `consumeCredits`, which hard-
   refuses below balance. Ceiling is 500 credits for the whole 14 days.
8. **One trial ever** — and the one thing that could void the index was checked:
   `revokeEntitlementForPayment` rewrites `source` (which would free it) but matches on
   `stripe_payment_intent_id`, NULL on a trial row. No code path can revoke a trial.
9. ADR 002 / ADR 003 / AGENTS.md non-negotiables hold. Every run interdict verified empty.
10. **`src/components/ui/select.tsx` does not exist and nothing imports a `Select`.** All 17
    `@/…` import targets resolve to real files with the signatures used.

## Findings

### MAJOR 1 — the chokepoint hard-depends on a column that does not exist until the migration runs
`readEffectivePlanId` sends `expires_at.is.null,expires_at.gt.<now>` at `plan_entitlements`.
Before the migration is applied, PostgREST answers `42703 column does not exist` and **the code
throws**. That is the function every gate reaches through `resolveEntitlement` — site creation,
editor invites, AI credits, both billing routes — failing for **paying** accounts as much as
trialling ones. `middleware.ts:152` fails open, so the dashboard shell renders while everything
behind it 500s. `.github/workflows/ci.yml` has **no migration step**.

This repo carries a tombstone for exactly this inversion (`src/lib/credits/system.ts:60-107`,
and `effective-plan.ts:35-40` — *"the code-before-schema inversion that already broke credits
once"*). Both prior fixes shipped a code-side fallback; this one does not, and neither the
plan's DoD nor any comment mentions the ordering.

**Action: the migration must be applied before the deploy that carries this code, and that must
be stated in the PR** — or add a `42703`-tolerant fallback matching `insertNonExpiringGrant`'s
house pattern. Major rather than critical because it is fully mitigable by sequencing.

### Minors
The design's "See plans" trailing action on the trial card was dropped (lost at plan time, no AC
missed) · test-file naming drift in two places, both closer to repo convention than the plan's
literal paths, no coverage lost · two route tests use a one-key `jest.mock` factory for
`@/lib/billing/effective-plan` that blanks the module's other exports · a stale comment anchor at
`entitlement/route.ts:93-97` · an a11y inconsistency on the zero-allowance progressbar · ~3–4
extra `plan_entitlements` reads per AI call.

## Not verified
**The migration was never executed.** The partial unique index — the sole enforcement of AC 6 —
is asserted by regex against the SQL text, and both suites simulate `23505` in JavaScript. No
real PostgREST: the `.or()` predicate ran only against hand-written JS stubs. No real clock
advance (expiry is simulated by rewriting the timestamp). No real Stripe (`check:stripe` not
run; "no trial row in the catalogue" comes from file text, not the live feed). No browser. No
magic-link flow — nobody opened a link on a second device, the only path that reaches
`/auth/confirm`. No Playwright. One suite / 36 tests are skipped in the full run and were not
investigated.

**Human gestures:** apply the migration on staging, fire two concurrent `ensureTrialStarted`
calls for one user id, confirm one row lands and the lifetime grant still inserts; seed an
expired trial plus a live subscription and hit a gated route; open `/dashboard` and
`/dashboard/billing` at >3 days, at 3 days, at 100% credits, and after expiry.

Note: ADR 014 sits on `main` (committed in `45844fd`) rather than travelling with the branch as
AGENTS.md asks. Predates this diff; flagged only so the DoD is not read as unmet.

## Verdict
Max severity: major
Ship allowed: yes
