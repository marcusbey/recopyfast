# Review — s125-credit-and-style-grants

**Reviewer:** fresh-context `reviewer` subagent, 2026-10-27/28.
**Diff reviewed:** `git diff origin/main...feature/s125-credit-and-style-grants` (2 commits, 16 files).
**Judged against:** `docs/plans/s125-credit-and-style-grants.md`, `docs/research/s125-credit-and-style-grants.md`,
`AGENTS.md`, and ADRs 033, 034, 040, 042 and 075.

**Verdict:** the fix holds. There is one major gap, residual TRUNCATE, REFERENCES and TRIGGER
grants (finding 1). It was fixed in this PR before shipping; see "Fix run" below.

## Tests run by the reviewer

| What | Result |
|---|---|
| Full Jest suite (`NEXT_PUBLIC_APP_URL=http://localhost:3000`) | 8578 passed, 2 skipped. 1 unrelated failure: the `src/lib/tools/extract` "2 MB page in under 2 s" timing budget, missed under load. Passes in isolation. |
| `node scripts/run-db-invariants.mjs` on PostgreSQL 17.11 | 25/25 named suites, 232 passed, 1 skipped (pre-existing) |
| `credit-purchase-privileges` (new) | 19/19 passed (not gated) |
| `copy-style-privileges` (new) | 11/11 passed |
| `credit-spend.test.ts` against the replay including the new migration (`RCF_REQUIRE_TEST_DB=1`) | 27/27 passed, including `SET ROLE authenticated` charges and races |
| `run-node-tests.mjs` | 90/90 |
| `tsc --noEmit` | ok |
| eslint and prettier on changed code | clean |

## Specific questions

1. **Does `GRANT UPDATE (credits_remaining)` alone keep the INVOKER `spend_credits`, with its
   `FOR UPDATE`, working for `authenticated`?** Yes, proven on PG17.
2. **Can the jsonb-diff trigger wrongly refuse a legitimate write?** No path found.
   - The spend path changes only `credits_remaining`.
   - There are no auto-maintained columns and no ON UPDATE foreign-key actions.
   - The service-role paths are exempt, and the exempt set is byte-identical to the original.
3. **Do any web-role writers remain?** None.
   - Every `credit_purchases` write goes through `createServiceRoleClient()`.
   - `getCreditWallet` (`system.ts:697-703`) only runs SELECT.
   - All three `copy_styles` references use the service role.
4. **Constraint and DO blocks.**
   - The constraint is validated on a clean replay.
   - Re-applying the migration twice converges.
   - A planted violating row raises a WARNING and leaves the constraint `NOT VALID`, and new
     violations are still refused. After the row is deleted, a re-apply validates the constraint.
5. **The two edited fixtures** (`staging-token-device`, `owner-plan-gate`): no assertion was
   removed or weakened.
6. **Run interdicts:** all respected.

## Neutralization (each restored afterwards)

| Neutralization | Red |
|---|---|
| Remove `.is("site_id", null)` in `styles/route.ts` | 1 |
| `isApplicable` → `true` | 2 |
| `isApplicable` → `style.site_id === null` | 1 |
| Old trigger body | 6/19 |
| Table-wide `GRANT UPDATE` to authenticated | 8/19 |
| Preset constraint dropped | 4/11 |
| Member INSERT grant and policy restored | 5/11 |

## Checklist

- [x] Plan compliance. Tasks 1–6 are complete. Task 7 (PR) is pending by design.
- [x] Run interdicts respected.
- [x] No invented API: every reference was opened.
- [~] Code does what it claims, except that ADR 075 and the errata claim the ADR 042 rule
  (finding 1).
- [x] AGENTS.md rules 5 and 9 (forward-only migration; table revoke before the column grant).
- [n/a] Design system: no UI.
- [x] Tests run by the reviewer; bite proven by neutralization.
- [x] No regressions on the spend, refund, clawback or styles paths.

## Findings

1. **major:** `20261027120000_credit_purchase_and_copy_style_grants.sql` revokes only INSERT,
   UPDATE and DELETE.
   - TRUNCATE, REFERENCES and TRIGGER stay granted to `anon` and `authenticated` on both
     tables. `SET LOCAL ROLE authenticated; TRUNCATE public.credit_purchases CASCADE` succeeded
     on the replay.
   - TRUNCATE ignores RLS and fires no row trigger.
   - This contradicts ADR 042, which the story says it applies. It is not critical because
     PostgREST and pg_graphql cannot issue TRUNCATE.
   - **Fix:** add the three privileges to both REVOKEs and to both privilege suites.
2. **minor:** the `copy_styles` "Anyone can view preset styles" SELECT policy keys on
   `is_preset = true` alone.
   - A planted `(site, true)` row that already exists in production would stay readable through
     PostgREST, because the constraint is then `NOT VALID`.
   - Guard: the owner's read-only production query before merge.
3. **minor:** the migration's idempotency and its warning branch are proven by hand, not
   automated. The new migration is not in the replay's second-pass list.
4. **minor:** the plan says "7 seeded presets"; the seed has 6. The tests do not hard-code a
   count.

## Not verified

- **Production state.**
  - Before merge, the owner runs:
    `SELECT id, site_id, is_preset FROM copy_styles WHERE is_preset IS DISTINCT FROM (site_id IS NULL);`
  - After deploy, `has_column_privilege('authenticated','public.credit_purchases','stripe_payment_intent_id','UPDATE')`
    must return `false`, and the deploy log should be checked for the WARNING.
- **Real Supabase stack, as a signed-in user:**
  - PATCH `/rest/v1/credit_purchases` with `stripe_payment_intent_id` must be refused.
  - One AI spend (translate or ab-test) must still debit purchased credits.
- **Supabase default privileges on a live project** (extra roles) were not checked.
- **Stripe refund and dispute clawback** are proven at database level and with mocks only. No
  real event was replayed.
- **Edit Board style picker UI** was not rendered. A human should check that one site shows
  only the 6 global presets plus its own styles, and that applying one works.

## Fix run

Finding 1 and minor 4 were fixed in `8c1aa1e8`, test-first.

- **RED:** 6 new tests failed against the previous migration. They assert that anon and
  authenticated hold no TRUNCATE, REFERENCES or TRIGGER on either table, and that a real
  `TRUNCATE … CASCADE` run as `authenticated` is refused.
- **Over-revoke guard:** 2 new tests assert that `service_role` keeps every privilege.
- **GREEN:** both REVOKEs now cover `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`.
  ADR 075 and the errata wording were updated to match.
- **Gates:** `run-db-invariants` on PG17 passed 25/25 suites (240 passed, 1 skipped). The
  pre-commit hook passed (8,579 tests, 0 failed).

Finding 1 is resolved. Open: minors 2 and 3, both mitigated as described.

Max severity: major
Ship allowed: yes
