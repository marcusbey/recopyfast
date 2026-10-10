# Review: s33-agency-plan (re-review after the blocked review)

## Scope and verdict

This is a fresh-context `/ks-review` re-review of `git diff origin/main...HEAD` on
`feature/s33-agency-plan`.

- Head: `22bec29`. Codex's fix commit is `892d647`, plus the operator's re-date of the catalogue
  migration to `20260924065000`.
- Merge base: `300548a`, which is s28/PR #25 merged into the branch.
- `origin/main` has since moved to `3b108ba` (s32). That merge is textually clean
  (`git merge-tree`), and the contract and billing suites pass on the merged tree.

I checked the diff against the plan's fix scope F1–F8, the research fix-pass facts,
AGENTS.md, and ADRs 014, 019, 028 and the new 029.

**Ship allowed.** The critical and the four majors from the blocked review are fixed. I verified
each fix by running it, not just by reading the code:

- Agency monthly and yearly claims succeed on a database built in version order. That database
  has main's 54 migrations, the real s27 migrations `010000`/`030000`/`060000` (content tables
  only), then `065000` and `070000`.
- Removing the advisory lock turns the new barrier test red.
- The compatibility patch rescues the old loader.
- Definitive Stripe failures free the spot.

Every remaining finding is minor. Before the operator cutover, fix the stale runbook migration
version (n1) and deploy the compatibility release (n2, runbook step 1). Before merge, re-run the
flaky E2E check (n6).

## Prior findings → status

| # | Prior finding | Status | Evidence (re-verified here) |
| --- | --- | --- | --- |
| C1 | Agency checkout broken after merge with s28's `050000` | **Fixed** | See "C1 evidence" below the table. |
| M1 | Code and migration cannot deploy in either order; rollback bricks the catalogue | **Fixed, with an operational precondition (n2)** | See "M1 evidence" below the table. |
| M2 | Race test did not detect lock removal | **Fixed** | See "M2 evidence" below the table. |
| M3 | A definitive Stripe create failure burns a founding spot forever | **Fixed** (residual edge cases: n4) | See "M3 evidence" below the table. |
| M4 | Lifetime Pro silently removed from sale | **Fixed** | See "M4 evidence" below the table. |
| m1 | `checkFeatureAccess("collaborators")` false for -1 | Fixed | `subscription.ts:377` uses `!== 0`. |
| m2 | Stripe price creation duplicates after the 24h idempotency window | Fixed | See "m2 evidence" below the table. |
| m3 | No ADR for precedence, reservation ledger and refund-not-freed rule | Fixed | ADR 029 is accepted and scopes its supersession of ADR 014/019. One scope gap remains (n5). |
| m4 | API-only paths the UI hides | Fixed | See "m4 evidence" below the table. |
| m5 | Throwaway accounts can keep the offer held | **Open, minor, accepted by design** | One hold per account, hold shortened to 30 min 10 s. Fifty accounts can still hold all spots. `/api/billing/checkout` has no rate limiter (pre-existing). |
| m6 | Stale comments | Fixed, but one inaccurate comment was introduced (n3) | `e2e/landing.spec.ts` updated. |

**C1 evidence**

- `070000:6-17`: `checkout_pending_intents.plan_id` becomes a foreign key to `plans(id)`.
- `070000:40-67`: the claim RPC now validates against the catalogue: an active
  `kind='subscription'` row with `price_monthly > 0` and a yearly price when `yearly` is
  requested.
- Results on the version-ordered DB:
  - `agency`/monthly and `agency`/yearly return new rows. So do `starter`/monthly and
    `pro`/yearly.
  - `lifetime_agency`, `free`, `enterprise` and unknown ids raise `22023`.
  - A direct insert of `'nope'` violates `checkout_pending_intents_plan_id_fkey`.
  - The same `agency`/yearly claim succeeds through a real PostgREST 14.16.
- The DB test "subscription checkout choices come from the active paid catalogue" covers it.
- Both migrations re-apply cleanly.

**M1 evidence**

- The new loader ignores unknown rows (`plans.ts:49-99`) and treats Agency as optional
  (`plans.ts:391`). Both are proven by tests, and each goes red when neutralized.
- Old loader, reproduced:
  - Unpatched `origin/main` with the Agency rows fails: `plans row "agency" is kind=subscription
    but is not a known plan id`.
  - `docs/operations/patches/s33-catalogue-compat.patch` applies cleanly to current
    `origin/main` (`3b108ba`). With it applied, the loader suite passes 37/37 with the Agency rows
    present.
- The runbook is `stripe-setup.md` "s33 live cutover": compatibility release, then live prices,
  then env, then migration, then the s33 release.
- Rollback is `AGENCY_CHECKOUT_ENABLED=false` plus a redeploy of the same release. It stops sales
  and keeps paid access. The kill switch is enforced at the route (`route.ts:155`), in pricing,
  in subscription PUT and on the billing page, and it is tested.

**M2 evidence**

- `founding-agency-cap.test.ts:123-211` is a barrier on the production advisory key with 20
  buyers at 45 sold.
- I removed the lock from `reserve_founding_agency_spot` (`065000:142`) on the disposable DB:
  **1 red of 15** (`waiters: 0, resolvedClaims: 6`).
- Codex's `scripts/test-founding-agency-lock-mutation.mjs` reproduced red, then green after
  restore.
- My own probe, 30 buyers × 15 rounds at 45 sold: up to **75** live holds without the lock,
  exactly **50** with it.

**M3 evidence**

- Preflight (price, customer, URLs) runs before the reservation. It is tested.
- Invalid-request, authentication and permission errors release the unbound hold
  (`route.ts:70-79`, `:603`).
- Connection, API, rate-limit and idempotency errors keep the hold. Both directions go red when
  neutralized.
- Expired holds are reconciled against Stripe before every new claim
  (`founding-agency.ts:111-193`). Only a session that is expired and unpaid, or an exhaustive
  empty search, releases a hold.

**M4 evidence**

- Landing and billing render Lifetime Pro and Founding Agency side by side.
- Lifetime Pro stays offered when Founding Agency is sold out or its checkout is switched off.
- E2E-012 "Pricing shows both lifetime offers" passed in CI.
- The operator's decision to keep Lifetime Pro is recorded in the plan, the design and ADR 029.

**m2 evidence**

- Before creating anything, the sync script looks up existing prices by `lookup_key`, then by
  catalogue product metadata, then by legacy price match (`sync-stripe-catalogue.mjs:416-575`).
  A mismatched, inactive or ambiguous match stops the run instead of creating a duplicate.
- The key is `STRIPE_SECRET_KEY_LIVE` only for `--mode=live`. The `sk_live_`/`sk_test_` prefix
  is enforced (`:580-594`). There is no live-key fallback anywhere in the code.
- The node tests pass 12/12.

**m4 evidence**

- The route returns 409 for Lifetime Pro when the buyer has an Agency subscription or an Agency
  grant (`route.ts:487-508`).
- The webhook no longer cancels Agency after a late Lifetime Pro payment (`webhooks route.ts:863`).
- The `refunded` outcome gives an accurate message (`065000:156-169`).
- All of these are tested and go red when neutralized.

## Verification performed

| Check | Result |
| --- | --- |
| Full Jest, CI placeholder env from `ci.yml`, Node 20.11.0, `--maxWorkers=2` | 224 suites passed, 2 skipped, 1 failed. **2,948 passed**, 38 skipped, 1 failed. The failure is `src/lib/images/__tests__/process.test.ts` (`zlib.crc32` does not exist in Node 20.11; the diff does not touch this file). On Node 22.22.1 it passes 13/13, so the effective result is 2,949 passed and 0 failed. This matches Codex's claim. |
| Targeted suites: billing API, pricing, webhooks, lib/billing, lib/stripe, billing and section components, trial lifecycle, nav | 37 suites, 466 tests, all passed |
| `node --test scripts/__tests__/sync-stripe-catalogue.test.mjs` | 12/12 passed |
| Disposable PostgreSQL 14.17 (TCP loopback only, Supabase shim, torn down afterwards) | 59 migrations in version order: main, then the real s27 `010000`/`030000`/`060000`, then s33 `065000`/`070000`. All applied, and both s33 migrations re-apply idempotently. |
| `founding-agency-cap.test.ts` on that DB | 15/15 passed. This was re-run after every SQL mutation was restored. |
| All DB suites on that DB | 40 passed, 1 failed. The failure is `function-grants`: `update_translation_coverage(uuid) -> authenticated`. It reproduces identically on a **main-only** DB, so it comes from the shim or is pre-existing, not from s33. |
| Real PostgREST 14.16 against that DB | `reserve_founding_agency_spot` returns `checkout_expires_at` as a JSON **number**. This closes a gap left open by the prior review. Overloaded `bind_founding_agency_checkout` resolves by named arguments, with both 3 and 4 arguments. `anon` gets `42501`. The `agency`/yearly subscription claim succeeds. |
| Merged tree, branch + current `origin/main` `3b108ba` | `merge-tree` is clean. The merged `ci.yml` keeps s32's 44-test contract and the s33 DB step. Contract, middleware and billing suites: 39 suites, 467 tests passed. |
| `prettier --check` on the 41 changed source files | clean |
| `gh pr checks 29` (head `22bec29`) | Lint/Test/Build, Type-Check (incl. tests), realtime audit and Vercel pass. **E2E fails:** strict 38 passed + 1 flaky (`share-edit-publish` "edit-session token…"). See n6. |

Catalogue on the migrated DB, matching the approved prices exactly:

- **`agency`:** subscription. `price_monthly` 49.00, `price_yearly_monthly_equivalent` 40.83,
  `price_yearly_total` **490.00**. Limits: websites 10, collaborators -1, ai_features true,
  translations -1, ab_testing true, monthly_credits 1000. `additional_site_price` 4.00. The six
  approved feature bullets. Sort order 25.
- **`lifetime_agency`:** one_time, 299.00, `grants_plan_id='agency'`, sort order 45.
- **Cap and prices elsewhere:** the cap is 50 in every capacity RPC. `starter`, `pro` and
  `lifetime_pro` are unchanged. Annual totals for Starter and Pro still derive as 90 and 189.

### Neutralization

Each mutation was restored and proven clean with `git diff --exit-code`. SQL mutations were
applied only to the disposable DB, then the real migration was re-applied.

| Neutralized | Red |
| --- | --- |
| Webhook expired: founding release removed (`webhooks/stripe/route.ts:1083`) | 2 |
| Webhook expired: s28 intent finish skipped (`if (false && attached)`) | 3 |
| Checkout route: definitive-failure release off (`checkout/route.ts:603`) | 3 |
| Checkout route: release on every create failure | 5 |
| Reconcile releases regardless of Stripe status (`founding-agency.ts:185`) | 2 |
| Checkout route kill switch (`checkout/route.ts:155`) | 2 |
| `/api/pricing` kill switch (Agency always listed) | 1 |
| `isAgencyCheckoutEnabled()` → `true` | 1. A second red, BulkOperations, is an unrelated load flake. |
| Agency precedence in `readEffectivePlanId` | 1 |
| Lifetime Pro vs Agency subscription guard | 1 |
| Loader unknown-row filter removed / Agency made required / exact yearly total dropped | 1 / 1 / 1 |
| SQL: reserve advisory lock removed (`065000:142`) | 1 of 15 |
| SQL `070000`: `plan.kind = 'subscription'` dropped / `plan.is_active` dropped | 1 / 1 |
| **SQL `070000:53`: `plan.price_monthly > 0` dropped** | **0** (n7) |

### Requested reproductions

1. **Version-ordered DB (main + s27 real + s33):** an Agency claim succeeds, and Starter and Pro
   still work (see C1 evidence).
2. **Lock removal:** the race test goes red. Without the lock, holds oversell up to 75.
3. **Old code with the new rows:** unpatched `origin/main` throws. With the documented patch it
   passes 37/37 on current main.
   **New code without the rows:**
   - The loader tolerates absent Agency rows (tested; goes red when neutralized).
   - It reads `select("*")`, so a missing `price_yearly_total` column parses as absent.
   - `/api/pricing` and the billing page catch a missing availability RPC and fall back to
     "unavailable".
   - Starter, Pro, Credits and Lifetime Pro checkout do not touch the founding RPCs.
4. **Stripe rejecting after a reserve:** invalid-request, authentication and permission errors
   release the unbound hold with `session_id = null`, and the DB release of an unbound hold frees
   capacity (DB test "expired holds…"). Uncertain errors keep it.
5. **Merged `checkout.session.expired` handler (`webhooks/stripe/route.ts:1045-1083`):**
   - It runs the s28 duty first: `attachCheckoutSession(..., {ignoreMissingIntent})`, then
     `finishSubscriptionCheckoutIntent`.
   - It then runs the s33 duty: `releaseFoundingAgencyCheckout`, whose `false` result is ignored,
     so a replay is a no-op.
   - The `billing_events` claim still precedes the switch (`route.ts:201-212`).
   - A failing duty throws a 500 and leaves the event `processed=false`, so Stripe redelivers and
     both duties re-run. Each duty is idempotent.
   - **One duty cannot skip the other in practice.** `checkout_intent_id` is set only on
     `mode=subscription` sessions (`checkout.ts:261-264`), and `founding_reservation_id` only on
     `lifetime_agency` payments, so no real session carries both. The dual-metadata test is
     synthetic.
6. **Prices:** exactly as approved (see the catalogue list above).
7. **Live sync script:** checks lookup key, then catalogue metadata, then legacy prices before
   creating. The live key is explicit, the prefix is enforced, and there is no fallback (see m2
   evidence).

## Findings

All remaining findings are **minor**.

### n1 — The operator runbook still names the old migration version

- `docs/operations/stripe-setup.md:59` says "`060000` and `070000` follow the applied
  migrations", and `:105` says the dry run "must list … `060000` then `070000`".
- After `22bec29`, s33's migration is `065000`, and `060000` is s27's
  `restore_site_wide_publish`.
- The instruction "Do not use `--include-all`" will also block if s27's `010000`/`030000` land on
  `main` before this cutover. Both sort before the already-applied `050000`.
- The failure mode is safe: the runbook says to stop on any mismatch. But an operator following
  the text literally will stop, or mistake s27's file for s33's.
- Fix the two lines, and state the ship order relative to PR #24.

### n2 — The compatibility release is a hard precondition that exists only as a patch file

- ADR 029 and runbook step 1 make it mandatory to deploy
  `docs/operations/patches/s33-catalogue-compat.patch` to production before `065000` is applied.
- That release has no PR, branch or CI run of its own. If step 1 is skipped, the running main
  binary loses the whole catalogue: pricing, checkout and every gate. That is the original M1
  outage.
- I verified the patch applies cleanly to `3b108ba` and passes 37/37.
- Two ways to fix it:
  - Open it as its own reviewed PR before this merge.
  - Reorder the runbook to ship the s33 release first, with `AGENCY_CHECKOUT_ENABLED=false`, then
    migrate. The s33 code already tolerates the rows being absent (reproduction 3).

### n3 — Inaccurate comments

- `webhooks/stripe/route.ts:444-447` now says "The subscription-plan foreign key admits only
  catalogue rows".
  - `billing_subscriptions.plan` has no foreign key. It is guarded by the hard-coded CHECK
    `billing_subscriptions_plan_valid` (starter/pro/agency), which `065000:72-76` re-creates.
  - That is exactly the "hard-coded subscription list in SQL" that ADR 029 rejects, and it will
    repeat C1's class of bug for the next plan, as a webhook `23514` retry loop.
  - Fix the comment, or replace the CHECK with a foreign key in a later migration.
- `065000:257-259` says "the previously deployed code calls the three-argument function". No
  deployed code ever did: `040000` was an unpublished draft. The wrapper is harmless.

### n4 — Founding reconciliation edge cases

- **One bad row blocks all founding sales.** `checkout/route.ts:538` runs
  `reconcileExpiredFoundingAgencyCheckouts()` synchronously before every founding reservation,
  and any Stripe or DB error on any expired row fails all founding checkouts closed. A row Stripe
  can never resolve blocks the offer until an operator releases it by hand; the runbook covers
  that. An example is a session id from the other Stripe mode, if any preview with test keys
  shares the production DB.
- **No clock-skew margin on the unbound search.** It filters on `created >= reservation.created_at`
  (`founding-agency.ts:146`). The database clock and Stripe's clock are compared with no margin.
  - The failure needs a lost bind, a paid session, a delayed success webhook and skew all at
    once.
  - If it happens, the hold is released and `complete_founding_agency_purchase` then raises
    `founding reservation is released, not reserved`. The webhook returns 500 until Stripe gives
    up, and a paying customer has no grant.
  - Subtracting a few minutes from the lower bound removes the risk.

### n5 — ADR 029's supersession scope misses `getUserSubscription`

- ADR 019 lists `getUserSubscription` as "untouched".
- `subscription.ts:341-343` now throws on a read error. This is a deliberate fail-closed guard for
  the Lifetime Pro/Agency check, and every caller sits inside a route `try`. ADR 029 supersedes
  ADR 019 only for "the entitlement resolver".
- Record this in ADR 029 or in an erratum.

### n6 — The required E2E check is red on the head commit

- The strict reporter counts one flaky retry as failure: `share-edit-publish.spec.ts`
  "edit-session token edits staging content and publishes live".
- The same test flaked on `main`'s `3b108ba` push run. `892d647`, whose code is identical apart
  from the migration file rename, was green. This is not caused by s33.
- Re-run the job before merge, and track the flake on `main`.

### n7 — The free-plan price guard in the claim RPC is untested

- `070000:53` (`plan.price_monthly > 0`) went 0 red when removed.
- The `free` row is inactive, so `is_active` already refuses it, and the route rejects `free`
  before the RPC.
- A test should activate `free` in a transaction, or use a zero-price active row.

### n8 — Duplicated kill-switch logic

- `src/app/dashboard/billing/page.tsx:70` re-implements `AGENCY_CHECKOUT_ENABLED !== "false"`
  instead of calling `isAgencyCheckoutEnabled()` (`plans.ts:101`). Behaviour is identical today.

## Checks that passed

- **Plan conformance.** Every fix-scope task F1–F8 is present in the diff. Nothing outside the
  plan was found, and the research facts are respected:
  - `050000` was not edited.
  - Lifetime Pro is retained.
  - Clock expiry alone never releases a hold.
  - Lookup happens before price creation.
- **Merge integrity.** Both expiry duties, the s28 durable intents and claim-before-effect are
  preserved. The s28 suites pass unmodified apart from additive mocks. The trial mock fix in
  `trial-lifecycle.test.ts` keeps its assertions.
- **Money boundary.**
  - One advisory key serialises every capacity RPC.
  - Completion is idempotent per payment intent.
  - Sales survive refund, revocation and account deletion (`ON DELETE SET NULL`).
  - The service-role-only grants were verified via `has_function_privilege` and PostgREST.
  - RLS is enabled with a service_role policy in the same migration.
- **Security and config.**
  - No secrets were added.
  - Price ids come from env or catalogue columns.
  - The `validateCreationRow` amounts are a creation fuse in operator tooling, not a served
    catalogue.
  - `.env.example` and CI list placeholders only.

## Could not verify

- **Rendered UI.** I rendered no screen. CI E2E-012/013/014 asserted the landing prices, "$490
  charged annually" and both lifetime cards in Chromium against a local stack. The billing page,
  UpgradeDialog and founding sold-out and unavailable states are covered only by RTL tests.
  - **Human gesture:** open the preview at 1440px and 390px, toggle monthly and yearly, and check
    the founding card in its remaining, sold-out and unavailable states.
- **Real Stripe.** Every Stripe call was mocked. None of these was exercised:
  - `sessions.create` with `expires_at`, and idempotent replay after a lost response.
  - `sessions.list` with the `customer` + `created` filters.
  - `checkout.session.expired` delivery.
  - lookup-key price creation.

  Codex's claimed test-mode creation run was not re-run.
  - **Human gesture:** in TEST mode, run each of these end to end and watch the counter,
    entitlement and reservation row after each step:
    - Agency monthly and yearly subscriptions.
    - One founding purchase.
    - One abandoned founding session left to expire (at least 30 minutes).
    - One refund.
    - A forced definitive failure: point `STRIPE_LIFETIME_AGENCY_PRICE_ID` at an archived price
      and confirm the spot is freed.
- **Real Supabase.** The database was PostgreSQL 14 with a hand-written auth/storage shim, plus a
  standalone PostgREST, not the Supabase stack. Supabase default privileges and role wiring
  differ. CI ran the 15 founding DB tests on its disposable Supabase stack, and the log is green
  for `892d647`.
- **Production and operator steps.** None was run:
  - live migration state
  - the compatibility release (n2)
  - live price creation and env installation
  - the `AGENCY_CHECKOUT_ENABLED` flip and redeploy
  - the 14-event webhook subscription
- **Infrastructure assumptions.** Unverified:
  - Clock skew between Supabase and Stripe (n4).
  - Whether any preview deployment shares the production DB with test-mode Stripe keys (n4).

Max severity: minor
Ship allowed: yes
