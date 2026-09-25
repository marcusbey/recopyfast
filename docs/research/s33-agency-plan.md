# Research — s33-agency-plan

Verified 2026-09-24 on feature/s33-agency-plan.

- `src/lib/stripe/plan-types.ts` closes PaidPlanId to starter/pro and OneTimeProductId to credits/lifetime_pro. Plan yearly totals currently multiply the rounded equivalent by twelve; Agency requires an exact yearly total to avoid $489.96.
- `src/lib/stripe/plans.ts` validates catalogue rows and has explicit environment mappings. Catalogue cache is five minutes.
- `src/lib/stripe/checkout.ts` and billing checkout route assume one lifetime product. Preserve old lifetime calls while accepting an explicit product id.
- Stripe webhook grantLifetime validates paid ids, then writes the existing payment-intent-deduplicated entitlement. Founding completed sales must count this durable purchase path, including revoked purchases; reservations are separate capacity, never sales.
- Subscription CHECK constraints need Agency support (20260803000000 precedent). New grants follow 20260805190000.
- `/api/pricing` already caches public catalogue payloads and can add an aggregate founding availability field without identity data.
- Landing `Pricing`, billing `LifetimeOfferCard`/`UpgradeDialog`/`BillingDashboard` and billing page are consumers. Existing feature gates read catalogue limits.
- `scripts/sync-stripe-catalogue.mjs` loads local .env files and reads Supabase. Test execution must never inherit a production endpoint. It has explicit PRICE_ENV mappings and initially verifies existing prices rather than creating missing ones.
- Audit A-22 covers lifetime metadata/grant correctness (already repaired); A-18/A-19/A-21 belong to s28 PR25 and must not be duplicated or weakened.
- Older s13 includes branded domains and downgrade changes outside this lane. Additional-site price is currently a catalogue/denial-message property; broader metering must not be invented silently.

Execution evidence: the interrupted run left only pipeline documents. The installed dependency tree was incomplete (hundreds of missing package entries and missing Sentry declarations), so one lockfile-only npm ci repair restored 1,108 packages without changing package.json/package-lock.json. A disposable local PostgreSQL 14 cluster verified the SQL migration and race guard. The Stripe tooling used only a selectively retrieved, prefix-checked test key; test catalogue creation and verification succeeded without loading production Supabase/live settings.

## Fix-pass findings (2026-09-24)

- Fetched `origin/main` at `300548a`: PR25 and PR23 are present; merge produced the six reviewed conflicts. `020000` and `050000` are already applied in production by operator report and remain immutable.
- `050000` validates only Starter/Pro both through a CHECK and inside `claim_subscription_checkout_intent`; changing only the application cannot fix Agency checkout. A new `070000` follows it. The unpublished Agency migration moves to `060000` so ordinary migration push remains ordered.
- The pre-s33 loader throws before returning any catalogue on unknown rows. A compatibility loader release is a prerequisite before active new rows meet that binary; migration-first applies to the feature cutover after that compatibility preparation. Rollback after sales must retain Agency entitlement support.
- Clock expiry alone cannot prove an existing hosted session went unpaid: success delivery may be delayed. Bound holds must be reconciled against Stripe expiry before release; provider uncertainty retains capacity.
- The operator explicitly retains Lifetime Pro ($199, five sites) on both purchase surfaces alongside Founding Agency. The founding cap counts completed purchases permanently, including refunds/disputes.
- Stripe creation idempotency keys are a short retry aid, not a durable uniqueness index. Price lookup keys and catalogue metadata lookup must precede creation on every rerun.
