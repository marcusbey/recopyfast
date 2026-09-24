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
