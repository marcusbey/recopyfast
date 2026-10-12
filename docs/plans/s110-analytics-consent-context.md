---
validated: yes
---

# Plan — s110-analytics-consent-context

Date: 2026-10-12. Depends on s107 / PR94. Branch: `feature/s110-analytics-consent-context` from refreshed main. Research: [s110](../research/s110-analytics-consent-context.md). Independent plan review passed; human validation received 2026-10-12. This file authorizes nothing by its existence.

## Result and boundaries

An eligible public visitor can carry a bounded, revocable GA identity into a verified signup or checkout without loading Google on private pages. Attribution is optional: missing consent/context never blocks signup, login or payment. Existing privacy geography and public route/document guards remain unchanged.

The consent/client-ID binding lasts at most **30 days** from capture, never beyond consent-choice expiry. This explicit privacy decision supports the existing 14-day trial-to-payment journey. A session ID is eligible separately: dispatch within 24 hours of session start and actual event time within that observed session; otherwise omit session ID. If the true session boundary cannot be proved, omit it rather than inventing session/engagement time. Refresh requires an actual allowlisted public interaction with active GA, not a cron, auth callback or checkout. Captured-at, consent-interval evidence and frozen event attribution are immutable: a refreshed capture creates a new context record with its own expiry rather than rewriting the record an earlier event selected. Capability-scoped revoke covers all records created under that browser capability; authenticated revoke additionally covers the account, so refresh cannot hide an older context from withdrawal. It is not a new visitor metric. No email, name, IP, country, customer content, report URL, raw referrer or auth token is stored in it. No context is added to Stripe metadata or email links. No new package or external script.

## Data and authority contract

Proposed `analytics_contexts`: random UUID primary key; hash of a separate high-entropy browser capability; nullable internal user binding; GA client/session IDs; server-recorded capture/session times; effective-consent interval/basis/version; expiry and revocation timestamps. Constrain field lengths and valid states. RLS enabled; no anon/authenticated table grants. Service-only SQL functions perform atomic bind/revoke and enforce immutable one-account binding. Internal user references cascade on account deletion. Revoke immediately cancels unclaimed work and erases raw GA client/session IDs and browser-capability material after the revocation transaction has identified affected rows; expiry immediately makes them ineligible at the 30-day/choice-expiry ceiling. Physical purge runs independently every five minutes; normal deletion lag is at most one successful sweep, with an aggregate overdue alert after ten minutes. Scheduler/database failure may delay physical deletion but never extends eligibility. State this operational distinction in privacy/operations copy. Session fields expire separately when no longer eligible. Outbox references to a removed context use SET NULL, never deletion cascade: deleting attribution must not delete dedupe dispositions. No raw capability is stored in the database, only its hash; the hash is still sensitive capability material. Minimal private account/source-key dispositions remain while the underlying account/billing source is retained; they are pseudonymous sensitive data, not anonymous. Account deletion may cascade analytics rows, but all reconciliation and replay require a currently existing account and must never recreate a deleted user or that user's analytics records.

The browser receives only an opaque `Secure`, `HttpOnly`, `SameSite=Lax`, host-only context capability cookie. The context endpoint requires exact same-origin validation, fail-closed per-IP limits before auth, bounded JSON and fixed actions. Possession allows only that context's revoke/refresh; it cannot read identifiers or bind an arbitrary user. Successful server `getUser()` or the existing verified auth result establishes binding. A conversion may use only a context captured, with effective consent, at or before its true occurrence. For signup, the verified confirmation may establish account binding afterward only through the same browser capability, and the context itself must predate confirmation. A later grant/new context cannot retroactively attribute an earlier conversion. Authenticated revocation also covers that account's active contexts. Use separate, explicit service-role authorization documented by a new ADR; do not imitate tenant-site authorization.

Decline immediately keeps the existing Google disable/cookie deletion, then requests first-party revocation with retry on the next same-origin interaction while denied. The s111 atomic claim checks revocation/expiry and is the dispatch linearization point: claimed events are in flight even if the HTTP request has not begun. Revocation committed before claim cancels unclaimed events; revocation after claim cancels remaining unclaimed events but cannot guarantee stopping that in-flight request. No database lock is held across Google HTTP I/O. Already sent requests cannot be recalled. A failed revocation request cannot promise instant server cancellation; expiry bounds that failure and monitoring exposes it. Sign-out revokes/clears the current capability before another account can bind it.

## Tasks

- [x] T1 Lock contracts with tests: existing consent matrix; valid/invalid `get` callbacks; denied/missing/expired identity; private documents; shared-device binding; concurrent bind/revoke; day-14 payment context still valid, day-31 expired, consent expiry wins, and expired/unproven session omitted; revoke-before-claim suppresses whereas revoke-after-claim is explicitly in flight; late grant never retrotracks, replacement/multiple-device contexts cannot steal an earlier conversion, and cleanup works before s111 exists; endpoint origin/rate-limit/validation boundaries. Capture baseline tests before edits.
- [x] T2 Finalize parent-owned proposed ADR 070 preserving 063/069 and describing capability authority, 30-day client-ID retention and separate session eligibility, withdrawal/in-flight limits, and rejected long-lived identity/Stripe-metadata alternatives. Recheck number availability at execution. Add `YYYYMMDDHHMMSS_analytics_consent_context.sql` with RLS, grants, constraints and service-only atomic functions; never edit applied migrations.
- [x] T3 Add `src/lib/analytics/google-analytics/context.ts`, `context-server.ts` and `src/app/api/analytics/context/route.ts`; capture through the documented `gtag get` API only when the runtime is active. Validate callback values, bound waits, and never delay navigation for analytics.
- [x] T4 Integrate server binding after existing verified auth establishment and in authenticated checkout; enforce expiry/denial with trusted edge hints. Integrate revocation in existing consent controls and sign-out. Keep all private CSPs and third-party loads unchanged.
- [x] T5 Update `src/app/privacy/page.tsx` and `docs/operations/analytics.md` to describe pseudonymous first-party context, consented subset, retention and withdrawal accurately. Reuse banner/footer design; no new screen.
- [x] T6 Ship `src/app/api/cron/analytics-context-cleanup/route.ts` with an existing-pattern fail-closed CRON_SECRET check, a five-minute `vercel.json` schedule and bounded cleanup function. Revoke purges synchronously where possible; expiry is enforced on every read/claim even if sweeping is down. Test no-dispatcher deployment, sweep retries, SET NULL without dedupe cascade, exact expiry and sanitized overdue alert after ten minutes.
- [ ] T7 Run targeted Jest/real PostgreSQL boundary tests, browser consent/navigation/sign-out tests, lint/types/format/build/full suites and applicable Lighthouse gates. Independent review, one story PR, hosted CI and exact deployment verification after final release authority is checked against the owner's current request.

## Likely files and verification

Existing files: `gtag.ts`, `GoogleAnalyticsRuntime.tsx`, consent controls, `AuthContext.tsx`, both auth routes, billing checkout route, privacy page. New files: the context modules/route above, colocated tests, `src/__tests__/db/analytics-context.test.ts`, one forward migration and numbered ADR; independent context-cleanup route/helper, `vercel.json` schedule and cleanup tests. The cleanup job remains functional before s111 deployment and is not conditional on its dispatcher. Confirm exact filenames during research refresh; no broad auth or billing refactor.

PostgreSQL tests prove anon/member cannot select/write contexts or invoke privileged functions, capability cannot cross rows, user binding cannot change, expiry wins, concurrent revoke prevents a subsequent claim, expired/revoked context cleanup leaves dedupe dispositions intact, repeated login cannot become signup after cleanup, and account deletion purges analytics identifiers without replay recreating the account. Browser tests verify no request to Google before permission where required and none on private documents; no cross-account reuse after logout. Failed context creation must preserve user journeys and produce a sanitized aggregate diagnostic.

## Ship and rollback

Migration before application paths, feature disabled until provider-independent checks pass. Rollback disables context creation/binding and conversion dispatch; retain forward schema and purge expired data. The owner's current instruction to finish the analytics release supplies release intent; the old PR batch is not the only authority. Human validation remains required for this new semantic/privacy plan. Once exact reviewed heads, migrations and provider/credential actions are concrete, check each against current authority; ask only for a genuinely missing scope or credential action. The draft itself is not approval.

## Human validation

Owner replied “Validate all three recommended plans” on2026-10-12 to the reviewed analytics conversion release proposal. This validates the30-day consented-context, verified-signup and verified-payment designs and the requested analytics release, subject to independent implementation review and verification. No live charge is authorized.

## Implementation evidence and deliberate conservative choices

- New client/context tests observed missing-module failures before implementation; PostgreSQL17 replay observed six missing-schema/function failures before migration implementation. Focused race test failed before serializing capture and withdrawal.
- Final targeted auth/billing/runtime/context/cron regressions:523 tests across25 suites passed. Full Jest baseline:516 passed suites,7777 passed tests,38 existing skips; final normal commit hook reruns after the last fixes.
- Real PostgreSQL17 replay:17 suites,124 passed tests,one existing PostgREST-only skip. Covers effective web denial/service execution, simultaneous binds, revoke against a waiting bind, immutable replacement captures, day14 retention, expiry, account deletion, and a transaction-scoped SET NULL disposition fixture. This fixture is not a production outbox.
- Lint/type/format passed; lint has34 pre-existing warnings. Build/browser/independent review and hosted evidence remain separately gated.
- Session identifiers are omitted because documented get cannot prove complete session boundaries. Legacy explicit consent without issuance evidence creates no conversion context until a new choice. These are fail-closed implementations of the approved constraints.
- Existing AuthContext tests now clear pending-action cookies between independent browser fixtures; assertions were retained. Auth callbacks additionally reject a getUser result that contains an error before binding or starting a trial. Server logout is the second existing signout entrypoint and receives the same bounded revoke/failure-marker behavior.
- Deviation from strict per-task TDD sequencing: endpoint tests were added immediately after its initial route skeleton, while schema, client, server-helper, cron, logout and capture/withdrawal race changes had observed failing tests first. No claim of endpoint-first red evidence is made.
- s111 owns actual outbox claim/cancel/disposition semantics. s110 supplies the shared transaction-lock/eligibility and SET NULL contract; no future table is referenced or fabricated.

Independent review fixes: transient auth lookup failures during withdrawal now erase the presented capability but return503 without clearing it, preserving the pending account-wide retry; genuine missing sessions remain anonymous204. Exact-string action validation rejects coercible arrays. Both findings had observed failing regressions before repair. The first normal commit hook caught an overlooked104-test assertion after adding the new browser case; the strict assertion is now105, matching actual collection, with no lowered/skipped gate.

Additional self-review race: a Google get callback arriving after successful signout revocation cleared the pending cookie could start a fresh capture. A failing regression observed the unwanted `signout,capture` sequence; a capture-generation guard now invalidates callbacks begun before withdrawal/signout. A new real public interaction may create new context afterward.

Scoped re-review also reproduced signout during an older pending-revocation await. The generation snapshot now precedes every await; its failing regression observed `revoke,capture` and now allows only the revocation.

The same synchronous invalidation now handles Supabase SIGNED_OUT notifications, including another tab. A failing deferred-get notification test observed a capture after logout; the guard now cancels it without calling Supabase or fetch inside the notification.

## PR102 Devin follow-up repair

Reproduced the dropped newer withdrawal/signout generations, non-renewed capability
cookie, and denied-click spam with five failing assertions. The older pre-await
regression's expectation also mistakenly allowed the dropped signout; it now
requires both revoke and signout. Use two bounded durable action-generation slots,
acknowledge only the sent generation, retry only real pending work, and renew an
existing capability on actual eligible captures. Migration bytes remain unchanged.

Independent security triage classified the writable consent timestamp as an expiry
integrity defect, not a proven remote human-consent bypass. The plan-consistent
repair adds a dedicated signed HttpOnly receipt issued only by explicit Allow,
with server issuance/expiry, a purpose/version-bound HMAC and separately provisioned
64-hex server key. Capture/bind never issue or renew receipts; denial and pending
work override grants. No new DB table, GA identifier or account identifier is stored
in the receipt. Tests cover tamper, future/expired values, key/version mismatch,
180-day cap, forged old timestamps, delayed grant versus denial/signout, pending
retry and actual refresh expiry. Backlog session wording now matches the validated
conservative omission. The review remains blocked until independent re-review.

The old-head Lighthouse run exposed the root AuthContext importing the GA capture
module eagerly. A module-evaluation regression rejected loading gtag or the
geography consent catalog from root authentication before the repair. Shared
synchronous cancellation and first-party actions now live in `context-control`,
with lightweight cookie helpers in `consent-choice`; GA capture stays behind the
existing deferred runtime. All race tests are preserved. New-head Lighthouse
validation remains required with unchanged thresholds.

Fresh review corrected an over-conservative signout change: preserving the granted
readable choice while clearing its receipt silently disabled later public capture.
Two observed failing route regressions now require signout to clear only identifier
capability, retain the identifier-free receipt, and allow a fresh public capture.
Actual consent revoke still clears the receipt.

Repair verification: fresh independent review passed with no unresolved findings;
generation-acknowledgement and signature-verification mutants were killed and all
34 source manifest entries were restored. PostgreSQL17 replay stayed124 passing;
the migration SHA is unchanged. The repaired build passed and the public browser
subset passed7/7 with zero retries (`devin-public-browser.log`). Full105-case hosted
E2E, the unchanged40-sample Lighthouse gate and production acceptance remain pending.
