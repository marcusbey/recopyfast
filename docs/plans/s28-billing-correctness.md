---
validated: yes
---

# Plan — s28-billing-correctness

Validated by the operator's explicit current task; scope A-19 and A-21 only. Branch feature/s28-billing-correctness. No UI design.

- [x] Prove A-19 red using its two existing markers; add deterministic month-end/leap-year/boundary and live-status tests. Preserve every existing guard. Confirm A-21 markers were already flipped at base; add failing regression coverage for URL reuse, cross-isolate claim races, stale-expiry claims, and provider failures.
- [x] Implement startOfCurrentAllowanceWindow using UTC original-anchor month offsets and deterministic clamping. Reuse existing entitlement statuses and preserve trial-grant/calendar fallback and purchased-credit arithmetic.
- [x] Add a new timestamped idempotent checkout pending-intent migration. Enforce partial UNIQUE user_id WHERE status = pending, atomic claim/expiry, session id/URL/expiry persistence and service-only RLS/grants. No migration execution. Prefer existing checkout-reservation module as the application boundary; do not alter applied migrations.
- [x] Claim before Stripe creation; match finite Stripe expiry with intent validity; use intent-scoped metadata/idempotency. Reuse existing open URL or respond 409 with it; concurrent in-flight creation may return 409 pending. Handle stale claims/ambiguous provider outcomes without permitting two payable sessions. Keep existing subscription/lifetime guards and fail closed on database errors.
- [x] Handle checkout.session.expired/completed in the existing webhook idempotently. Release only the matching intent, preserve delayed old-event safety, establish subscription state before completed release, and propagate failed writes for retry. Add event replay, delayed event and database failure tests with SDK mocks.
- [x] Format only touched files; run focused tests and all required gates using CI placeholders: npm run precommit, npm run build, node scripts/build-embed.mjs --check, npm run audit:prod. Record exact test/lint/byte counts and inherited format limitations. Never weaken unrelated tests or change catalogue expectations.
- [x] Write docs/reviews/s28-billing-correctness.md containing only pending independent review and inspect the final diff.

Delivery follows the verified gates: create one focused conventional commit, push this branch, and open a DRAFT PR with Why / What changed / Decisions / Verification / Risk & rollback. Commit and PR identifiers are recorded in the delivery report and PR. Leave the migration unapplied and the independent review pending; no merge or deploy.

## Risk and rollback

Application deployment requires operator-applied migration first. The DB invariant is reviewed statically here, not execution-proven. Roll back application via revert, retain compatible schema and repair forward. Do not reopen sessions after uncertain Stripe creation. Independent reviewer owns the verdict.

## Independent review fix pass — 2026-09-24

The operator prevalidated the following repair scope. Preserve the independent review verbatim and uncommitted; its blocked verdict remains reviewer-owned.

- [x] C1: rename the unapplied migration to `20260924020000_checkout_pending_intents.sql` and update owned references.
- [x] C2, m4: keep monthly Stripe periods intact, step annual windows only, select the newest live subscription, and add month-end/multiple-row regressions.
- [x] M1: pin route-to-provider intent id/expiry options and prove mutation M5 fails.
- [x] M2: route reusable 409 session URLs through the checkout hook and billing page, with UI tests.
- [x] M3: restore the existing active/trialing/past_due guard in route and claim RPC; test new-checkout access for unpaid/incomplete/paused.
- [x] m1–m3, m5–m7, m9: cover independent request races, idempotent late webhook handling, URL preservation, safe late-retry 409/retryAt (immediate retry deferred for immutable-key safety), fresh-claim lookup avoidance, TTL rationale and completed-payment messaging.
- [x] m8: record the durable protocol decision and ADR 014 pointer erratum without editing the accepted ADR.
- [x] Merge `origin/main` (PR #22 and #26), preserve both stories in the sole `docs/stories.md` conflict, and repeat precommit/build/embed/audit gates. Delivery uses focused `fix(s28):` commits and a push to draft PR #25.

No remote database, real Stripe operation, production deployment, merge into main, or review-verdict edit is authorized.

## Re-review fix mode 2 — 2026-09-24

Operator-prevalidated scope below; retain `validated: yes`. The current independent re-review allows ship and must remain unchanged and uncommitted.

- [x] N1: persist requested price, plan and interval on each intent through a forward-only idempotent migration. Resume only an identical choice. For a different choice, confirm the old Stripe session expired (including already-expired responses), finish the old intent and re-claim before creating the requested session. Preserve fail-closed handling of completed or ambiguous provider outcomes and concurrent requests. Prove Pro yearly → Starter monthly returns the new Starter session and expires the old one, including recovered-session and expiry-retry cases.
- [x] N3: list all 14 webhook events in the Stripe operations runbook, adding `checkout.session.expired` and the required operator update of the live endpoint. No Stripe configuration action.
- [x] N4: use two live subscription rows with observably different allowance windows; demonstrate the test fails with the balance query's `.order(...)` removed, then restore it.
- [x] N5: correct the research's nonterminal-subscription protection and ordering-regression claims.
- [x] m5: render valid 409 `retryAt` in the existing billing error surface as “You can start a new checkout at HH:MM”; test the sentence and preserve URL-resume behavior.
- [x] Merge current `origin/main` at `9f22598` (s25 documentation); no conflict.
- [x] Run required placeholder-only precommit, build, embed freshness/ceiling and production audit gates; preserve all tests and inherited warning ceiling.

Delivery after these gates: commit `fix(s28): ...`, push to existing draft PR #25, and preserve the reviewer file. Commit/push identifiers belong in the PR and final report.

### Out-of-scope follow-up — N2

The existing active/trialing/past_due guard allows checkout while another subscription is incomplete, unpaid or paused. If that prior subscription recovers, parallel live subscriptions can result. A separate story must decide whether to block recoverable obligations or reconcile/cancel older subscriptions when one becomes live, record the consequences in an ADR, and cover delayed settlement and recovery. This fix does not change subscription eligibility or claim to close that window.
