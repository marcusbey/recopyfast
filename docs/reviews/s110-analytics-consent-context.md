# Review — s110-analytics-consent-context

Independent review completed 2026-10-12 against released main c1ad4a9 and the human-validated
s110 plan, research and accepted ADR 070. Reviewer did not implement the change.

## Verdict and repaired findings

No open findings remain. Initial findings and subsequent race reviews were repaired test-first:

- Transient auth failure while revoking must not acknowledge complete account-wide withdrawal.
  The current browser capability is still revoked, but transient failure returns 503, preserves
  retry state and emits a sanitized diagnostic. Genuine no-session requests may finish anonymously.
- Fixed actions require a string; arrays/objects cannot pass by String coercion.
- Withdrawal waits for a bounded first-capture request, and invalidates delayed Google callbacks.
- Capture generation is snapshotted before any await, including pending-revocation retries.
- The existing cross-tab SIGNED_OUT notification synchronously invalidates pending captures
  without starting a Supabase call or another network operation inside the notification.

The reviewed design preserves public-only Google scripts/private CSPs, optional analytics that
cannot break auth/payment, immutable 30-day contexts, occurrence-time eligibility, capability and
account withdrawal scopes, immediate eligibility expiry, bounded cleanup and account deletion.
The future outbox is not invented in this migration; its SET NULL/dedupe contract remains s111.

## Independently executed evidence

- 62 tests across 7 focused suites passed on the final source.
- PostgreSQL 17 migration replay, grants and concurrency: 17 suites, 124 assertions passed;
  one existing PostgREST-only check is explicitly skipped in the plain PostgreSQL runner.
- Targeted mutations produced 6 failing tests total: transient-auth handling (2), in-flight
  first-capture sequencing (1), delayed-get generation (1), snapshot-before-first-await (1),
  cross-tab invalidation (1). Every temporary mutation was restored byte-for-byte and green rerun. - `git diff --check` passed.

Final reviewed 31-file manifest: `/tmp/s110-review-final-source-manifest.sha256`.
Manifest SHA256: `7b81d8dae6eceb767e0a0b1be13a4dac71ae987a12346817b02ca7eb6f3299ba`.
Evidence: `/tmp/s110-review-final-green.log`, `/tmp/s110-review-db.log` and the scoped
`/tmp/s110-review-mutant-*.log` proofs. Subsequent plan/evidence formatting is documentation only.

## Verification boundaries

Parent's public browser baseline passed 7/7 with no retries; a final rebuilt-artifact pass remains
required after the last callback fixes. That test intercepts the context endpoint and proves
client consent/retry behavior, not real browser-to-database HttpOnly capability persistence.
Normal final hooks/build/coverage, exact hosted 105-test real-Supabase browser inventory,
Lighthouse, production migration/deployment and actual provider receipt remain separate gates.
A timed-out first capture can leave an unbound orphan until expiry; without the lost browser
capability it cannot become a conversion. Do not promise immediate remote deletion after an
ambiguous network failure. Completed signups and purchase delivery belong to s111/s112.

Max severity: none
Ship allowed: yes
