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

## External review follow-up — PR #102

Devin's private review reported two critical-labelled concerns and two bugs after the initial
independent source review: overlapping withdrawals can clear a newer sign-out, browser-writable
consent time is not server-authenticated proof, refreshed context does not renew its browser
capability cookie, and a settled denial repeatedly consumes the context endpoint quota.
A session-ID acceptance-text flag also needs reconciliation with the deliberately conservative
session omission already documented in the plan. These are being reproduced and independently
classified; this gate remains closed until fixes or evidence-backed dispositions are reviewed.
No production migration or release has occurred for s110.

## Independent repair review — 2026-10-12

A fresh reviewer inspected the full story and uncommitted repairs against the validated
plan, repository rules and accepted decisions. No unresolved source findings remain.
The review additionally found that signout removed the identifier-free choice receipt
while retaining the granted readable choice; both logout paths now preserve the receipt
while revoking the capability. Explicit consent withdrawal still clears the receipt.
Two red/green regression tests cover this correction.

Verified: exact-generation withdrawal acknowledgements and draining; dedicated signed
server issuance/expiry receipt; no writable-timestamp authority; bounded capability-cookie
renewal; no repeated settled-denial requests; truthful session omission; restored deferred
Google import boundary with synchronous auth invalidation retained.

Independent final run: 340 tests across 18 suites passed. Native PostgreSQL17 full migration
replay: 124 passed across 17 suites, one existing PostgREST-only skip. Neutralizing generation
acknowledgement and receipt signature verification caused one failure each; both mutations
were restored byte-for-byte. All34 frozen manifest entries and git diff --check verified.
Manifest: /tmp/s110-gates/devin-repair-source-manifest.sha256,
SHA256 1da7420e99128b891bfd295a14f6e76bb62d8ebc356a62a96463029219eceadd.
Evidence: /tmp/s110-repair-review-final.log and /tmp/s110-repair-review-db.log.

This source verdict supersedes the blocked review above. It does not claim final hooks,
new-head hosted checks, external review, migration, deployment or live acceptance passed.

## Fresh external review of 99b6042

Functional CI passed all105 browser tests with zero skips or flaky cases. Devin's fresh
analysis reported two new items and retained the original withdrawal thread as Outdated.
Independent triage confirms the original withdrawal loss is repaired: exact generations and
both action slots are retained/drained, with regression and neutralization evidence above.

The grant-provenance warning does not demonstrate a violation of the accepted trust boundary.
The endpoint records a same-origin explicit grant command and server issuance/expiry; it does
not authenticate a physical human click. Cross-origin victim-browser commands are rejected;
attacker-controlled same-origin JavaScript already controls the consent UI/state. A nonce on
another public transition would not establish human action against that actor. The existing
receipt code and operations documentation explicitly disclaim such proof. Disposition:
non-actionable under the validated threat model, without expanding consent authority.

One functional finding remains under repair: an Allow interaction during a pending Google
lookup can reuse the now-invalidated capture promise, losing the requested fresh capture
until another public interaction. Ship remains blocked until regression, repair and fresh
independent verification. No migration or release has occurred.

## Second repair independently verified

Fresh Allow now waits for an older capture and starts a new one only if its generation is
still current. Same-generation calls coalesce; later signout invalidates a waiting refresh.
An empty-drain handoff processes newly queued withdrawal without looping after failed HTTP
responses. The pending intent remains durable on failure.

Independent restored run: 92 tests / 7 suites passed. Neutralizing fresh Allow caused one
failure, neutralizing the later-signout guard caused one, and restoring the old empty drain
caused two. All mutations were restored byte-for-byte with original diffs preserved; all
three source manifest entries and git diff --check passed.
Manifest /tmp/s110-gates/refresh-handoff-manifest.sha256,
SHA256 bac378008e3a51ee76a0df726b2156374e531c642f8597c90867801f28984a55.
Log /tmp/s110-refresh-handoff-restored.log. No unresolved source findings remain. Final
normal hooks, exact-head hosted checks, migration and deployment proof remain separate.

Max severity: none
Ship allowed: yes
