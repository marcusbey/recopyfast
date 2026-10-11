# Review — s25-stripe-test-entitlement-e2e

Reviewer: independent fresh-context `reviewer`, 2026-10-11. Candidate: s25 `d7d80dbf84aa08f323defb5c9969cabbbaf82358` with exact reviewed s82 `9807278e3d24a0d27ad46fa6db6504546d45683e` staged as `MERGE_HEAD`, plus the preserved 22-path human-assisted Checkout WIP.

## Verdict summary

No source defect was found in the integrated s25 harness. The candidate is clear for a draft PR and ordinary CI/review, but it is not accepted for ship: the two required fresh user-attended Stripe TEST passes have not run on this integrated source.

The s82 parent is exact, conflict-free, and review-preserving. All 55 s82 changed paths match its approved commit byte-for-byte. The s25 WIP has no changed-file overlap with s82; all 22 preserved paths match their pre-integration manifest except the declared s82 execution note in this plan. Package and lock files are unchanged by the integration.

## Human Checkout boundary

The approved amendment is implemented as a human checkpoint rather than payment automation:

- the runner requires the exact `--human-checkout` opt-in before reading private configuration or invoking a CLI/local/provider mutation;
- the dedicated Playwright config separately requires runner-owned human mode and manifest identity;
- Chromium is headed, one-worker, zero-retry, with trace/screenshot/video disabled and no preserved output;
- the worker prints one fixed identity-free notice only after the owned Stripe TEST page opens;
- the harness does not inspect or operate hosted payment fields, disclosure controls, CAPTCHA, submit UI, or Link Pay Tokens; and
- the human has ten minutes, after which timeout, close, interruption, provider/return error, or any inexact return fails closed.

Return acceptance is tied to the owned Session rather than to broad success copy: exact loopback origin and billing path, no fragment, exactly one `checkout=success`, exactly one matching `session_id`, and no extra query key. The complete negative matrix has fixed diagnostics that contain no raw URL or identifier.

## Automated proof after the human return

The remaining automation still proves the real integration rather than fabricating an entitlement: complete/paid/reconciled Checkout, billing-customer link, one active monthly Pro subscription on the configured test Price, completed checkout intent, genuine processed webhook events, effective Pro entitlement without a trial, and signed duplicate-event replay with unchanged subscription/ledger counts.

Those requests execute the final s82 checkout, webhook, effective-plan, subscription, and replay source. The fresh user begins with no trial, grant, Customer, or subscription, so a future provider pass proves s82's ordinary no-lifetime-grant path. It does not prove s82's separate lifetime/refund edge cases or any live/production behavior.

## Redaction, evidence, and cleanup

Operator output is fixed or bounded/redacted. The strict reporter suppresses arbitrary worker output and forwards only the exact ready notice or redacted core setup. Free-form diagnostics redact credentials, identities, payment values, Checkout URLs/secrets, and relevant Stripe object IDs. Failure evidence is owner-only and has exactly four fields; the runner validates it independently. Cleanup-critical provider IDs stay only in owner-only structured manifests/evidence, and the success line reports aggregate counts/status only.

The Playwright worker is non-destructive. The process-external janitor alone may expire/cancel/delete; before each mutation it independently proves loopback/test mode, the exact Price, fresh run metadata, object ownership, and Customer relationships. It repeatedly rediscovers late objects, observes the longer failure horizon, requires consecutive quiet passes, removes exact local/Auth ownership, and fails closed on incomplete pagination, foreign objects, residue, process-group uncertainty, or unfinished prior manifests. Each default pass reaches clean state before pass two starts.

## Findings

None in source. The earlier pre-provider review's four major findings are fixed: exact ready-notice forwarding, aggregate-only runner output, exact owned-Session return validation, and provider-ID redaction at shared/reporter/failure/runner boundaries.

## Verification

- Fresh independent human-harness contract: 13 suites / 112 tests passed.
- Recorded exact integrated s82 path scope: 20 suites / 405 tests passed.
- Full TypeScript, scoped ESLint, scoped formatting, and both staged/unstaged diff checks passed.
- The staged s82 index matches `9807278…` on all 55 changed paths; current s25 WIP matches its 22-path preservation manifest.

No browser, database, Docker, Stripe API, Checkout, payment, provider mutation, or production action occurred in this review.

## Missing acceptance and boundaries

Two fresh human-assisted TEST Checkout passes on this exact integrated source remain mandatory. Each must start from a fresh owned stack, complete through the visible Stripe page with the user present, prove the automated durable outcome/replay, and finish its independent cleanup before the next begins. Historical automated passes and attempts that stopped before submit do not count.

Normal hooks, draft-PR CI, and final post-provider review remain open. A live payment is a separate unapproved financial action and cannot be inferred from test mode. This review authorizes no merge, deployment, production mutation, or live charge.

Max severity: none
Ship allowed: no
