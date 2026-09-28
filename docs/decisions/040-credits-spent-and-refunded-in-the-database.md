# ADR 040 — Credits are spent and refunded by database functions; a refund returns to its source

- Status: accepted
- Date: 2026-09-28
- Scope: s48-credit-integrity
- Supersedes: the rejected alternative "A `SECURITY DEFINER` spend function in Postgres" of
  [ADR 035](./035-widget-ai-charged-to-site-owner.md). ADR 035's decision (widget AI is authorised
  by editor credentials and charged to the site owner) stands unchanged.

## Context

ADR 035 kept the credit spend in TypeScript on the premise that "the compare-and-swap in
`deductPurchasedCredits` already makes the spend safe under concurrency". The credit purchase
verification (`.omx/qa-20260927/REPORT.md`, defects 1–3) measured otherwise:

- **P4, lost credits.** The loop ran one compare-and-swap per purchase row. On a collision it
  restarted with the full amount and never undid the rows it had already decremented; after eight
  collisions it refused, keeping those partial decrements. Twelve concurrent 5-credit charges lost
  2–9 credits per round and refused 3–6 requests the wallet covered. Read from the same code, two
  concurrent charges also both drew the same remaining allowance; s48's DB suite measured it with
  the lock removed: twelve charges drew 60 credits from a 12-credit allowance.
- **P2, refunds minted credits.** A usage row stored `credits_used` only, so a refund could not say
  where a charge came from. `refundCredits` minted a new never-expiring "purchased" row, even for
  a charge the monthly allowance had paid, which then also stayed counted as used.
- **P3, the mint was an entitlement.** Any positive purchased balance resolves to `credits` and
  passes the paywall. A lapsed trial that never paid, with one refunded failure, got in.
- **Defect 1.** Translation never reported failure, so its refund was dead code and a missing
  OpenAI key charged 5 credits for "Successfully translated 0 elements".

## Decision

**A charge is one database function, `spend_credits`, and a refund is another,
`refund_credit_usage`, keyed by the charge's receipt. A refund returns credits to where they came
from and never writes a purchase row.**

- **`SECURITY INVOKER`, not `DEFINER`.** Spenders run two ways: the service role (the widget's
  `/api/ai/suggest` charges the site owner, ADR 035) and the signed-in user's JWT (translate,
  ab-tests). INVOKER keeps the JWT caller inside RLS and inside the unchanged "may only decrease"
  trigger on `credit_purchases`. `function-grants.test.ts` forbids any `DEFINER` function that
  `authenticated` can execute. A JWT caller naming another user is refused with the function's own
  42501, not an RLS refusal that would read as "insufficient".
- **The allowance terms come from TypeScript.** `getUserCreditBalance` still computes the allowance
  (`included`) and the window start, and `consumeCredits` passes both as parameters. No plan,
  trial or window rule is copied into SQL, which was ADR 035's objection. Calling the function
  directly gains nothing: a caller who inflates `p_included` only writes usage rows for itself,
  which RLS already lets it insert, and receives no AI output.
- **One namespaced lock.** Both functions take
  `pg_advisory_xact_lock(hashtextextended('credits:' || user_id, 0))` before any row lock.
  Checkout claims already lock the bare `hashtextextended(user_id::text, 0)`; sharing it would
  queue every AI charge behind the user's checkout. Webhook revoke and restore take row locks
  only, so there is no deadlock cycle.
- **Net `credits_used` and an immutable debit record.** `credits_used` becomes the net charge. A
  refund lowers it and raises `credits_refunded`, so every existing reader (the TypeScript window
  sum, the in-lock sum, `totalConsumed`) stays correct unchanged, and the allowance comes back on
  its own. `credits_from_purchased` and `purchase_debits` (the rows debited, oldest first) are
  written once by the charge and never change.
- **Refunds: purchased first, in place, service role only, receipt-keyed.** A refund walks the
  debits in reverse, skipping what earlier refunds returned, and raises each row in place, capped
  at `credits_purchased`. Then it gives back the allowance. This is the exact reverse of a spend
  that draws the allowance first, so the wallet ends as if only the kept share had been charged,
  and two partial refunds equal one refund of their sum. The amount is capped at the charge's net
  `credits_used`, so refunding a receipt twice returns nothing the second time. Only
  `service_role` may execute it: raising `credits_remaining` is what the trigger forbids to
  everyone else. Routes pass only the receipt they got from the charge in the same request, never
  an id from a request body.
- **Legacy refund rows stop counting as paid, with no data migration.** Rows whose
  `stripe_payment_intent_id` starts with `refund_` (the old `refundCredits` was their only writer)
  stay spendable: nobody can tell which of them made up for paid credits, and zeroing them could
  take away value someone paid for. They no longer entitle an account (`resolveEntitlement` reads
  `readPaidCreditBalance`) and no longer count in "Total purchased". The predicate is keyed on the
  prefix, never on `price_cents = 0`, because `migrated_wallet_` rows are paid wallets recorded
  at price 0.

## Considered options

- **Keep the compare-and-swap and fix the restart.** Rejected. Undoing partial decrements from the
  client needs raising `credits_remaining`, which the trigger forbids on the JWT path, and it still
  leaves the allowance double-draw, which no row-level compare can see.
- **A `SECURITY DEFINER` function computing the allowance itself.** Rejected for ADR 035's reason:
  the plan, trial and window rules would exist twice and drift. Passing the terms in moves only the
  arithmetic and the exclusion into SQL.
- **A separate refunds ledger instead of net `credits_used`.** Rejected. Every reader of the
  allowance would have to subtract it, and the first reader that forgot would give the allowance
  twice.
- **Zero or delete legacy `refund_` rows.** Rejected. Their source was never recorded, so some are
  compensation for paid credits.

## Consequences

**Easier.** Every AI charge is exact under concurrency, proved on real Postgres by
`src/__tests__/db/credit-spend.test.ts`, which CI runs by name. A failed AI call costs nothing net.
Refund safety is a database property: the cap and the source are enforced where the rows are.

**Harder.** The spend is now split across two languages by design. TypeScript owns *how much is
included and since when*, and SQL owns *what is taken, from where, and in what order*. A change to
either half must keep the other's contract; the contract tests (`concurrency.test.ts`,
`explicit-payer-client.test.ts`) pin the arguments passed.

**Deploy order: the migration first, then the code.** Old code keeps working on the new schema: it
ignores the new columns, and the relaxed CHECK refuses nothing it writes. New code without the
migration fails every AI charge ("Failed to charge credits"), so AI is down but nobody is
overcharged. Rolling back the code is safe. **Never roll the schema back** once a refund has
written a net-0 usage row: the old `credit_usage_positive` CHECK (`credits_used > 0`) refuses it.

**Watch.**

- **The revoke-then-refund race is accepted.** A dispute can revoke a pack in the seconds between
  a charge and its refund; the refund then puts up to 5 credits back into a clawed-back row.
- Refunded requests still write `usage_tracking` (REPORT defect 5, out of scope).
- Translation is still priced flat per request. The partial-batch refund rounds the failed share
  up, which favours the customer by at most one credit, until per-text pricing (defect 8) removes
  the rounding.
- Run the operator count of legacy `refund_` rows before deploying. A non-zero count means the
  predicate is live protection; zero means it is inert.
