# ADR 075 — A web role's write to a billing row is column-scoped and trigger-pinned

- Status: accepted (owner validated the s125 plan, 2026-10-27)
- Date: 2026-10-27
- Scope: s125-credit-and-style-grants
- Extends: [ADR 033](./033-column-privileges-require-table-level-revoke.md) (column privileges
  need the table-level revoke first) to a billing table, and
  [ADR 042](./042-content-writes-are-service-role-only.md) (writes are service-role only) to
  `copy_styles`.
- Related: [ADR 040](./040-credits-spent-and-refunded-in-the-database.md) (credits are spent by
  the `SECURITY INVOKER` `spend_credits`); audit `docs/reviews/security-audit-2026-10.md` H1, M1.

## Context

`authenticated` held table-wide UPDATE on `credit_purchases` through Supabase's default grants.
The only guard was a `BEFORE UPDATE` trigger refusing a rise of `credits_remaining`. A buyer could
therefore rewrite `stripe_payment_intent_id` on their own row through PostgREST with the
publishable key, and the refund / dispute clawback — which looks the row up by that column — then
found nothing to claw back (audit H1).

The only web-role writer of the table is `spend_credits`. It runs as the caller
(`SECURITY INVOKER`, ADR 040) for translate and ab-tests, locks the purchase rows with
`SELECT … FOR UPDATE` and decrements `credits_remaining`. PostgreSQL accepts `FOR UPDATE` when the
role holds UPDATE on at least one column of the table. Every other write — grant, restore, refund,
clawback, webhook — goes through the service role.

`copy_styles` had the same shape of hole (audit M1): the member INSERT policy never constrained
`is_preset`, so any site admin could publish a "preset" listed to every tenant. No application
code writes `copy_styles` as a web role.

## Decision

1. **A web role's write to a billing row is column-scoped.** The table-level INSERT, UPDATE,
   DELETE, TRUNCATE, REFERENCES and TRIGGER are revoked from `PUBLIC`, `anon` and
   `authenticated` first (TRUNCATE ignores RLS and fires no row trigger, so it would bypass both
   walls) (ADR 033: a column grant
   does not subtract a table grant). Only the column a user-side RPC needs is granted back — for
   `credit_purchases`, `UPDATE (credits_remaining)` to `authenticated`.
2. **And trigger-pinned.** A `BEFORE UPDATE` trigger refuses, for every role outside the
   service/owner exemption set, any change to a column other than the granted one, and any rise of
   it. The comparison is `to_jsonb(NEW) - '<column>' IS DISTINCT FROM to_jsonb(OLD) - '<column>'`,
   so a column added later is covered with no list to maintain.
3. **`copy_styles` takes no web-role write** (ADR 042's rule, applied to this table). The three
   member write policies are dropped, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER
   are revoked from web roles, and the constraint
   `copy_styles_preset_is_global CHECK (is_preset IS NOT DISTINCT FROM (site_id IS NULL))` pins a
   preset to a global row for every writer, the service role included. Existing violating rows are
   reported by the migration, never deleted; the constraint stays `NOT VALID` until they are
   resolved.
4. **Routes that read with the service role scope their own reads.** RLS does not apply to them,
   so the preset list filters `site_id IS NULL` and `styles/apply` accepts only a global style or
   the target site's own.
5. **Proved on real PostgreSQL** (`credit-purchase-privileges.test.ts`,
   `copy-style-privileges.test.ts`, both in `REPLAY_SUITES`), each with a negative control that
   restores the dangerous grant inside a rolled-back transaction and shows the second wall
   (trigger, or the absent write policy) still refuses.

## Considered options

- **Make `spend_credits` `SECURITY DEFINER` and revoke all web writes.** Rejected:
  `function-grants.test.ts` forbids DEFINER functions `authenticated` can execute (ADR 040), and a
  DEFINER function needs its own tenant checks.
- **Column grant only, no trigger.** Rejected: a later blanket grant (a Supabase default, a
  hand-run SQL edit) silently reopens the hole. The trigger is the second wall the negative
  control proves.
- **Route all spend through the service role.** Rejected: a larger behavioural change to the payer
  model of ADR 035/040, outside this story.

## Consequences

- A future column on `credit_purchases` is frozen for web roles by default. If a user-side path
  ever needs to write it, that is a new grant and a trigger change, reviewed together.
- An auto-maintained column (an `updated_at` trigger, say) added to `credit_purchases` would make
  the trigger refuse every spend by `authenticated`; the spend test in
  `credit-purchase-privileges.test.ts` would catch it.
- After deploy, the owner confirms on production that
  `has_column_privilege('authenticated','public.credit_purchases','stripe_payment_intent_id','UPDATE')`
  is `false`.
