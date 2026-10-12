# Review — s111-verified-signup-analytics

Date: 2026-10-12. Independent full-story reviewer; no implementation authorship.
Scope: the s111 working diff and new files against reviewed s110 commit830a6fa, subsequently
integrated onto the byte-identical merged main ee8de655b7dfe1accf1cedb659888d40756f014a.
The main and reviewed dependency tree IDs are both9b0c8dc40e91508d894a5d8ae4c12c561d845802.
Final source-manifest equality after branch alignment is required before committing.

## Source verdict

No actionable implementation findings remain. The implementation follows the human-validated
plan and independently reviewed clarifications: existing confirmed accounts receive permanent
suppressed baseline dispositions; only provider-verified initial signup/invite proof can select
the actual browser capability; unknown proof and missing attribution are conservatively frozen.
Binding and source freezing are atomic. A complete analytics-write failure cannot be repaired
by inventing the original browser on a later login. Current confirmed-account stock is distinct
from an immutable historical signup series.

- [x] Unique source identity, immutable selected/absent context and baseline reset protection.
- [x] Claim/revocation ordering shares lock710110; no database lock spans a Google request.
- [x] Ambiguous delivery stays uncertain and is not automatically replayed.
- [x] Context cleanup preserves minimal dedupe dispositions; absent/deleted accounts are refused.
- [x] Service-only functions/tables, effective grants, RLS and fixed authority boundaries tested.
- [x] Payload, occurrence window, destination, default-off config and transport diagnostics bounded.
- [x] No new dependency, private-page Google, copied provider body or raw context/source logging.
- [x] Actual Sentry SDK envelope tests prove exact collector exclusion while retaining unrelated
  errors, transactions, spans and breadcrumbs; final filters were independently neutralized
  in memory to prove the tests detect secret leakage.

## Independent evidence

450 tests across24 focused suites passed. Native PostgreSQL17 replay passed141 assertions
across18 suites before and after mutations, with one existing PostgREST-only skip.
Accepting every provider proof type caused4 failures; inverting the SQL initial-confirmation
guard caused9 failures. Both mutations restored exactly; all36 manifest entries verified.
Earlier transport/QA slice:36 Jest assertions and10 Node CLI assertions independently passed.

Manifest: /tmp/s111-implementation-review-manifest.sha256.
SHA256: 02d83fbcde629ece5e06949b1c1f5540feffeeb75b2a6eb64a54f0ef51577f64.
Logs: /tmp/s111-independent-focused-review.log,
/tmp/s111-independent-db-restored.log, /tmp/s111-review-proof-mutant.log,
/tmp/s111-review-sql-proof-mutant.log.

The guarded real-Supabase test is meaningful: initially unconfirmed fixture signup token →
product HTTP confirmation route → frozen outbox context/time; later magic-link login leaves
that row unchanged. It deliberately seeds context and therefore proves auth → outbox,
not public capture → confirmation. Its strict inventory is106 tests, with no skipped/flaky
allowance added. Actual hosted execution remains required.

The public context test now waits for the initial consent banner to disappear before opening
Cookie settings, matching the older consent test. Capture completion is a separate async
signal, not a UI readiness contract. The failure did not establish a runtime defect. This
stronger synchronization has no sleep, retry increase, or relaxed assertion; the same compiled
application passed all7 public cases with zero retries.

## Release evidence and remaining gates

Owner-reported final local checks:7,878 Jest tests,525 suites,38 inherited skips,77.66% line
coverage; build, lint(0 errors/33 inherited warnings), full/build typechecks, formatting and
production audit(0 vulnerabilities) passed. Normal commit/push hooks must run on the final
aligned tree. Hosted106-case execution, exact-head CI/performance/external review, reviewed
migration executor and production deployment remain required.

Parent separately verified standalone shared transport in RecopyFast QA: validation passed,
one receipt call was HTTP accepted, and the QA Realtime report showed sign_up=1. This is
synthetic QA transport evidence, not an integrated auth/outbox/worker journey, production
signup, attended human email delivery or product traction. Integrated worker QA and genuine
production receipt remain separate acceptance observations.

Max severity: none
Ship allowed: yes
