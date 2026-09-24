---
validated: yes
validated_by: user scope and operator pre-validation, 2026-09-24
---

# Plan — s33-agency-plan

Approved exact user scope; isolated branch feature/s33-agency-plan. Source of truth: plans table. No production access, remote migrations, live Stripe, merge or deploy.

- [x] T1 Backend tests first: catalogue accepts Agency and exact annual total; checkout monthly/yearly/lifetime; lifetime grants Agency and existing limits/credits resolve. Preserve every existing audit guard.
- [x] T2 Add idempotent 20260924040000 migration: exact catalogue rows/limits/features, annual total column, subscription constraint, service-only capacity reservation/completion RPCs with RLS and explicit grants. Serialize cap decisions with a PostgreSQL advisory transaction lock. Count completed durable purchases, never sessions; reserve capacity before Stripe checkout, release only when safely cancelled/expired, preserve unresolved/paid capacity. Atomic idempotent completion links existing lifetime grant/payment path. Verify 49 allowed/50 refused/concurrent last spot using local PostgreSQL.
- [x] T3 Widen plan/product contracts, environment resolution, checkout parsing/metadata, webhook and entitlement paths, badges and other plan-id assumptions. Preserve existing lifetime_pro API calls. Exact yearly totals must come from catalogue. Keep changes focused, avoid s28 credit/checkout rewrite.
- [x] T4 Pricing/UI tests first, then API cached aggregate availability, Agency grid + founding highlighted card, billing selection/badges, annual total display. Update existing landing E2E expectations and strict count contract only if test count changes. Design: docs/designs/s33-agency-plan.md.
- [x] T5 Stripe tooling tests first, then explicit Agency price mapping/create/verify support and operations docs. Use local catalogue/export with test key only, reject unsafe DB endpoint in test mode. Document exact live creation/verification commands for operator; do not run live.
- [x] T6 Run targeted tests, precommit, build, embed freshness/gzip, audit:prod and applicable render/DB tests using CI placeholders or verified disposable loopback services. Record exact counts/gaps. Review placeholder only.
Delivery handoff (tracked by the branch and draft PR): Fetch before push; if PR25 merged, merge origin/main, resolve billing conflicts and rerun affected/full gates. Conventional focused commit, push feature/s33-agency-plan, open draft PR with Why/What changed/Decisions/Verification/Risk & rollback.

Ownership: backend executor owns migration and backend libraries/routes/tests; UI executor owns components/hooks/billing page/pricing route and UI/E2E tests; tooling executor owns scripts/operations docs/tooling tests/CI price placeholders. Leader owns pipeline docs, integration and final gates. Shared contract: lifetime intent accepts productId lifetime_agency; existing omitted productId means lifetime_pro. Backend exports founding availability reader; UI only consumes aggregate completed sales.

## Verification — 2026-09-24

- `npm run precommit -- -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`: passed; lint 0 errors / 39 inherited warnings, type-check passed, Jest 217 passed suites / 1 skipped, 2,773 passed tests / 36 skipped / 0 failed. No existing failing markers flipped or guards removed.
- `npm run format:check`: passed. `npm run build`: passed with CI placeholder environment.
- `node scripts/build-embed.mjs --check`: fresh; bundle 46,604 bytes gzip (ceiling 46,681), widget 33,828 (ceiling 33,865). No embed source/artifact change.
- `npm run audit:prod`: 0 vulnerabilities.
- `node --test scripts/__tests__/sync-stripe-catalogue.test.mjs`: 7/7 passed. Stripe TEST API created/verified all three approved prices; repeated creation returned the same ids. Only a verified test key was used; no live operation or remote Supabase access.
- `RCF_TEST_DB_URL=postgresql://postgres@127.0.0.1:55433/postgres npx jest src/__tests__/db/founding-agency-cap.test.ts --runInBand`: 7/7 passed on disposable PostgreSQL 14. All existing migrations applied; the new migration applied and reapplied idempotently. Tests cover 49/50, competing last-spot reservations, duplicate grant, expiry recovery, revocation/account-deletion durability and RPC permissions. CI runs this suite against its existing disposable Supabase stack with a fail-closed connection/schema probe.
- `npx playwright test --list --reporter=list`: exactly 39 tests in 9 files; the strict execution count is unchanged. Full 39-test stack execution remains the PR CI gate.
- Production browser probe: desktop 1440px and mobile 390px rendered without horizontal overflow; monthly/yearly prices, exact annual totals, savings, 17 remaining, sold-out and unavailable states passed. Focused Agency/founding screenshots were visually inspected. The real production build used pricing fixtures transformed from the disposable migrated database; this is UI evidence, not full-stack Playwright proof.
- PR #25 was still open at the pre-push coordination check. The independent reviewer file is intentionally unmodified and excluded from this commit.

## Operational limits

- Apply only the new migration at ship and configure the three live price ids using `docs/operations/stripe-setup.md`; no remote migration was applied here. Include `checkout.session.expired` in the live webhook event set.
- Completed sales drive the public aggregate; reservations only prevent concurrent overcommit. Uncertain Stripe create outcomes retain capacity until idempotent retry recovers the session and a signed completion/expiry arrives. Reconcile an undelivered terminal event in Stripe before releasing capacity; never release by local elapsed time alone.
- Agency supplies the existing catalogue-driven $4 extra-site denial message. This repository has no actual overage purchase/metering flow; building that is outside this catalogue/plumbing story.
