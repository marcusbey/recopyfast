---
validated: yes
---

# Plan — s111-verified-signup-analytics

Date: 2026-10-12. Depends on released s107 and s110. Branch: `feature/s111-verified-signup-analytics`. Research: [s111](../research/s111-verified-signup-analytics.md). Independent review passed; human validation received2026-10-12.

## Business result

Google receives `sign_up` only for a newly confirmed account with eligible s110 context. Repeated login, magic-link request and legacy account produce no signup event. The complete current confirmed-account count remains the surviving Auth accounts with confirmation present, shown separately from GA's smaller attributed count. It is not an immutable historical first-signup series: confirmation timestamps can change or clear, so period counts using those timestamps carry that explicit limitation. No change to account access, trial grants or private CSPs.

## Minimal persistence and state machine

One private `analytics_delivery_events` outbox serves signup now and purchase/refund in s112. Fields: internal UUID; event kind; unique canonical source key; internal account/context references; immutable selected-context source key or explicit absent disposition; true occurred-at; bounded typed payload; state; claim/attempt timestamps; sanitized result code. Store GA identity only by the context reference, not copied into durable delivery payloads; construct the wire body in memory at claim. No raw provider event bodies. Suggested states: `pending`, `sending`, `accepted_http`, `suppressed`, `invalid`, `uncertain`, `expired`. `accepted_http` never means verified GA ingestion.

The outbox migration records an immutable activation cutoff **and seeds suppressed `signup:<user-id>` rows for every already-confirmed account in the same consistent activation snapshot**. Do not rely on the current `email_confirmed_at` remaining unchanged: upstream admin reconfirmation can overwrite it. Baseline rows carry `preexisting_confirmed` as their reason and never become sendable; an account unconfirmed in that snapshot can still qualify on its first later confirmation. The private unique `signup:<user-id>` key is the sole durable once-per-account authority; no new Auth trigger or account-milestone ledger. A service-only SQL function atomically freezes a verified confirmation candidate using the actual request capability hash, true occurrence and context/consent eligible at occurrence, under s110 advisory lock 710110. Binding to the verified user, selecting context or absence, and inserting the source disposition must be one transaction; separate best-effort binding plus later selection is insufficient. It returns only a typed outcome/internal source reference, never email/profile data. Keep the immutable context source key separate from the nullable context FK so cleanup cannot trigger reselection. Security-definer reads, if needed, use fixed schemas/search_path, explicit PUBLIC/anon/authenticated revokes and service-only execute with effective-grant tests. Keep minimal account/source-key/state tombstones for as long as the underlying account/billing source is retained; a short TTL would let repeat login become a new signup. They remain sensitive private identifiers, not anonymized aggregates. Context deletion sets references NULL and does not remove these tombstones. Account deletion can cascade analytics rows, but every reconciliation/replay requires the source account still to exist and cannot reconstruct deleted users.

Auth completion remains successful if analytics persistence fails. The callback must attempt the atomic freeze only after provider verification and verified user identity; the no-code existing-session fallback never creates a signup candidate. Recovery repairs only an already durably frozen candidate or a lost acknowledgement of a committed freeze. It does not scan arbitrary bound contexts to reconstruct the original confirming browser. If the whole freeze failed, no durable original-browser proof exists: emit a sanitized aggregate failure diagnostic and report a possible unattributed/unknown signup; a later login or cron must not invent context, choose another device, or reclassify this as a new sendable signup. Missing consent at occurrence freezes a suppressed absence; a later grant is never retrospective permission. Neither callback nor dispatcher updates Auth/billing. Claim rechecks current revocation/expiry of the frozen selection. Never backdate beyond 72 hours or replace occurrence with delivery time.

Atomic claim checks current context revocation/expiry and moves one event to `sending` before any network call. This commit is the dispatch/in-flight linearization point: revocation committed before claim cancels; revocation after claim cannot guarantee stopping that request even if HTTP starts later. Do not hold a database lock over HTTP or promise a second preflight read closes this race. Test both orderings. An expired claim becomes `uncertain`, never automatically `pending`. A non-2xx or ambiguous transport outcome is recorded for diagnosis, not blindly replayed. Signup replay requires evidence the prior attempt was not ingested; if that cannot be proven, preserve an explicit possible undercount rather than inflate conversions. This is not an exactly-once network guarantee.

## Implementation clarification: initial confirmation versus later login

This clarification preserves the approved once-per-account/no-retrotracking scope and human validation; it narrows an impossible recovery claim rather than adding another identity store.

- An existing `signup:<user>` disposition means the signup was already classified, including baseline/suppressed/unknown rows. Return its outcome without changing occurrence or context. A successful later login is not a new signup.
- An absent row is **not proof of first confirmation**. A sendable new row also needs provider-verified evidence that this request performed initial confirmation, plus the actual browser capability. A successful explicitly typed signup/invite OTP verification is a confirmation-flow signal; confirm its provider semantics and baseline/unique-key defenses in tests. A user-controlled query string alone is not proof. Generic `email`/`magiclink` responses and the existing PKCE exchange do not expose a documented first-confirmation flag, so do not infer it from timestamp proximity, `last_sign_in_at`, created-at equality, or the fact that binding succeeded.
- Where the current API cannot prove that this request was the initial confirmation, freeze/report `suppressed` with reason `initial_confirmation_unproven` if persistence is available; do not send GA. Keep the confirmed account in the first-party count. Do not read/modify private GoTrue token/flow tables or add an Auth hook merely to close this gap within this story.
- For a proven first confirmation, the transaction accepts the request capability only if its context predates occurrence, effective consent includes occurrence, it is not bound to another user and the verified account exists. Account binding can then occur after confirmation inside that transaction. Missing/denied/expired/ineligible capability freezes absence. No later callback/cron may replace that disposition.
- If acknowledgement is lost after commit, source-key lookup returns the original disposition. If nothing committed, later requests lacking independently verified initial-confirmation proof cannot recover attribution. A durable failure diagnostic cannot be guaranteed when all persistence is unavailable; operational logs and the Auth-confirmed/outbox-classified count gap expose possible loss without inventing an exact per-user failed event.

**Minimal useful release path:** RecopyFast's last recorded production signup-template configuration explicitly sends `/auth/confirm?...&type=signup` (`docs/archive/2026-08-04-qa-user-journey.md`, signup-template repair). The live read-back recorded in research now confirms that configuration without exposing tokens; actual email delivery and controlled first-confirmation ingestion remain acceptance gates. Successful `verifyOtp({ type: "signup", token_hash })` is checked by GoTrue against the signup confirmation token, so this path can freeze and send the consented signup after baseline/source-key checks; it is not a proposal for zero GA signups. Existing-user magic links remain login-only. The equivalent validated invite-confirmation path may qualify for a genuinely unconfirmed account. Generic `type=email` is internally classified by GoTrue, but its resolved type is not returned by the installed auth-js `AuthResponse` (`{user, session}`); PKCE's `redirectType` comes from client code-verifier storage, not a trusted new-account flag. Keep those successful sign-ins working and expose their provenance gap rather than relabeling a local field as server proof. If the live signup template no longer uses the explicit signup route, report that concrete acceptance blocker; do not silently enable a zero-coverage fallback or modify provider templates during implementation without checking the concrete action.

**Exact acceptance wording correction:** replace “reconciliation repairs missed enqueue from bound contexts” with “reconciliation completes already durably frozen signup candidates; total freeze failure or unprovable initial-confirmation provenance is explicitly unattributed/unknown and never retroactively attributed.” Both auth handlers are integrated and tested, but a handler without trusted initial-confirmation evidence must not be claimed to deliver every new signup. Achieving universal same-request provenance across the current generic/PKCE paths would require a separately justified provider signal; it is not silently solved by this plan.

Race tests: (1) two proven callbacks for one account preserve one source/context; (2) repeat login on another device cannot overwrite; (3) proven callback versus unknown callback preserves whichever immutable disposition committed first, with possible conservative undercount if unknown won; (4) revoke before freeze/claim suppresses, after claim is in flight; (5) atomic commit with lost response is recovered unchanged; (6) full write failure followed by later login/cron stays unknown, even with a newly granted or earlier-captured arbitrary context; (7) baseline account timestamp reset stays suppressed; (8) unconfirmed baseline account's real later confirmation may qualify; (9) context deletion retains disposition; (10) account deletion/replay never reconstructs it. These tests must not use a fake “first login” timestamp heuristic.

## Tasks

- [x] T1 Pin signup semantics and failure tests: both confirmation paths; first versus repeat login; code-less callback; rejected OTP; existing baseline; pending old account newly confirmed; cross-device/no context; late grant and new campaign after confirmation produce no retroactive event; pre-confirmation context bound by the real confirming browser may qualify; replacement context cannot rescue revoked/absent choice; two devices cannot overwrite frozen attribution; concurrent callbacks; atomic freeze commit/lost acknowledgement versus total persistence failure; later-login reconstruction refusal; provider proof absent; baseline timestamp reset; execute the explicit race matrix above without changing sign-in outcome.
- [x] T2 Add new numbered ADR and `YYYYMMDDHHMMSS_analytics_delivery_outbox.sql`: private outbox, consistent activation snapshot and suppressed baseline rows, constraints, indexes, atomic verified-browser freeze and bounded service-only claim/finalize/reconcile functions and grants. Replay all migrations and test actual PostgreSQL isolation/concurrency.
- [x] T3 Add `src/lib/analytics/google-analytics/conversions.ts`, `delivery.ts` and `measurement-protocol.ts`; wire both verified auth establishment paths, not the existing-session fallback; require provider-confirmation provenance before sendable freeze and preserve an explicit unattributed/unknown outcome where it cannot be proved. Payload allowlist emits `sign_up`, fixed `method: email`, valid 30-day client context, true timestamp and ads denied; no user ID sent. Session ID is optional and requires proven event-within-session plus dispatch within 24 hours of its start; omit uncertain/expired session fields and never invent engagement time.
- [x] T4 Add `/api/cron/analytics-dispatch` and five-minute `vercel.json` schedule using the existing fail-closed CRON_SECRET pattern, bounded batch/runtime and no arbitrary request-driven event injection. Reconcile already frozen candidates only, claim, send with timeout and finalize; never reconstruct a missing candidate by joining current bound contexts to Auth users. Make raw GA IDs/capability material immediately ineligible on revocation or context expiry; physically purge them normally in the next five-minute cleanup sweep, with overdue cleanup alerted after ten minutes; discard event-specific payload once terminal and no longer needed for delivery/reconciliation. Keep only private minimal account/source-key/state dispositions for the underlying source-retention lifetime. Never let context cleanup cascade into dedupe deletion; account deletion is distinct and replay must refuse a nonexistent account. Tests cover terminal/uncertain cleanup, repeat login after cleanup and account deletion/replay.
- [x] T5 Add a fixture-based validation command with explicit validation-only endpoint and QA destination allowlist. Validate secret presence without logging it. Default previews/tests to no sending; no accidental fallback to production property. Update `docs/operations/analytics.md`, privacy disclosure if needed, and an aggregate source-of-truth query comparing the same surviving-account population across current Auth-confirmed and outbox-classified/GA-eligible/delivered/uncertain/unproven/baseline counts; disclose mutable-timestamp period limitations. Any residual gap is possible attribution loss, not inferred successful delivery.
- [ ] T6 After checking concrete provider/credential actions against the owner's current release instruction and validated plan, configure/read back QA destination and server-only MP secret; validate representative payloads, then verify one controlled QA signup ingestion and no duplicate on login/replay. No synthetic signup is sent to the production stream. Keep validation-only, QA report and production evidence distinct.
- [ ] T7 Run targeted and full repository gates, auth browser regression, no-private-analytics CSP assertions, DB grants/concurrency tests and independent review. Open story PR; check exact migration/merge/provider actions against current release authority once concrete, rather than assuming only the older PR batch counts.

## Likely file surface

Both auth routes; new analytics modules/cron above; `vercel.json`; `src/__tests__/db/analytics-delivery.test.ts`; colocated delivery and auth-route tests; `e2e/google-analytics.spec.ts`; `scripts/check-analytics-conversions.mjs`; one migration/ADR and canonical operations/privacy docs. No Auth schema column, account milestone system, package dependency or customer webhook dispatcher rewrite.

## Delivery acceptance and rollback

Prove transport structurally via `/debug/mp/collect` with `ENFORCE_RECOMMENDATIONS`, but note it neither records nor authenticates the secret. Prove actual ingestion in a QA stream whose creation/use is covered by the checked current authority with a controlled new account; existing production Auth counts remain untouched. Production completion needs the released worker/config and observed genuine eligible event, not a screenshot of an empty configured property.

Migration first; configure an explicit disabled/default-off dispatch flag; deploy; read back target/secret-presence; enable only after reviewed checks, semantic plan validation and confirmation that the concrete action is covered by current authority. Disabling dispatch/context capture is rollback. Do not delete dedupe rows or automatically replay uncertain events after rollback. No live payment is needed for this story.

## Human validation

Owner replied “Validate all three recommended plans” on2026-10-12 to the reviewed analytics conversion release proposal. This validates the30-day consented-context, verified-signup and verified-payment designs and the requested analytics release, subject to independent implementation review and verification. No live charge is authorized.


## Clarification review

A fresh independent review accepted the baseline and source-proof clarification as within
validated scope. It requested the current confirmed-account metric and historical period
limitation be distinguished, and completed provider metadata/read-back be reflected; both
are now recorded. No new human product checkpoint is required. Implementation remains gated
on released s110 and its own independent review and release verification.


## Local execution sequencing

While s110 hosted release gates run, the local s111 branch may integrate against the exact
independently reviewed s110 candidate. This is implementation preparation, not release
acceptance. Rebase the unpublished s111 story onto merged main before its independent full
review/PR so the diff contains only s111. Production migrations and releases remain ordered:
s110 first, then s111, then s112. No source or privacy semantics change, and no hosted gate
is waived by this local sequencing.

## Isolated implementation preparation (2026-10-12)

The parent explicitly authorized only the dependency-independent Measurement Protocol and QA
command portions of T3/T5 while s110 release gates run. T3/T5 remain unchecked: no auth wiring,
outbox, dispatcher, provider receipt or integrated story acceptance exists yet.

- Added the fixed `sign_up` payload allowlist and bounded single-attempt transport. Production
  sends require `GA4_MP_ENABLED=1`, `VERCEL_ENV=production`, explicit server-only
  `GA4_MP_MEASUREMENT_ID=G-DQ00NEM3WE`, and `GA4_MP_API_SECRET`. Browser and preview paths fail
  closed. HTTP acceptance and uncertain outcomes are distinct; no network retry occurs.
- The QA command imports this same TypeScript core under Node 24 native type stripping; no new
  dependency or second payload implementation. It accepts only `--mode=validate` (default) or
  `--mode=receipt`, uses fixed QA `G-JHTG44WQ5W` and `GA4_MP_QA_API_SECRET`, and cannot choose a
  production target, arbitrary URL or event. Validation never proves receipt or secret validity.
- TDD evidence: both new test entrypoints failed for their absent implementation before source
  was written. Then 26 transport assertions and 10 isolated Node command assertions passed
  using dummy secrets and intercepted fetch only. Type-check, targeted ESLint, changed-file
  Prettier checks and `git diff --check` passed. No Google requests or real credentials were used.
- No commit, push or production action was performed. s110 must be released before dependent
  source integration, and the full story still needs its independent review and full gates.

### Review repair: outgoing telemetry query secrets

Independent review reproduced an MP `api_secret` leak through Sentry's automatic outgoing-fetch
breadcrumb. Header-propagation restrictions did not prevent it. A new regression initializes
the actual installed SDK with the actual server config and an in-memory envelope transport;
its first run showed the dummy secret in an error envelope and a collector span in a transaction.
The repair excludes only the exact Google MP collection/debug endpoints using the installed
`nativeNodeFetchIntegration({ ignoreOutgoingRequests })`, with a breadcrumb filter and a
transaction-span filter as defenses against duplicate instrumentation. Unrelated requests and
the enclosing transaction remain monitored. No transport/QA core change was needed.

Verified API behavior against installed 10.58.0 types/source and its
[upstream NodeFetch implementation](https://github.com/getsentry/sentry-javascript/blob/10.58.0/packages/node/src/integrations/node-fetch/index.ts),
which applies the same exclusion callback to breadcrumb and span instrumentation. The
in-memory envelope test now proves zero dummy-secret leakage and zero collector spans, while
retaining the safe error, transaction, health breadcrumb and health span. Exact-origin/path
negative tests preserve unrelated Google traffic. Red/green evidence:
`/tmp/s111-telemetry-red.log` and `/tmp/s111-telemetry-green.log` (301 tests / 12 suites).
This is local verification only; no real credentials or provider requests occurred in this repair.


## Local integrated implementation checkpoint

Implementation was prepared on reviewed s110 candidate830a6fa without claiming its release.
Before full independent review/PR, the parent must rebase this unpublished work onto actual
merged main. No commit, push, migration, real credential access or provider action was performed
by the implementer.

T1–T5 are implemented. T6/T7 stay open for the full release evidence: the parent recorded shared
transport validation and one synthetic QA sign_up ingestion; that does not prove the newly wired
Auth→outbox→worker integration or genuine production conversion. The real disposable Supabase
integration case is collected in the strict106-test suite, with MP sending explicitly disabled.
Local Docker remains unavailable; hosted execution is required, and fixture confirmation does not
prove human email delivery. Seven existing public browser cases are checked locally on a compiled
fake-GA build with Google interception.

- Outbox migration20261012232824: exact atomic DO statement, SHA256
  469c2c5b9a957725f62e30a626874f944810cda1e33966b32ff6bda790887c50.
- Native PostgreSQL17 full replay:18 suites,141 assertions, one existing PostgREST-only skip;
  actual role invocation, baseline timestamp reset, unknown/proven competition, capability
  selection/absence, account/context deletion and claim/revoke orderings are included.
- Full Jest coverage:7,878 passing tests,38 inherited skips,525 passing suites; coverage ratchets
  unchanged. Source/auth/cron red evidence is in /tmp/s111-source-red.log and
  /tmp/s111-auth-red.log; real DB red evidence is /tmp/s111-db-red.log. Follow-up red coverage
  pinned anonymous-capability withdrawal and maintenance continuing while sends are disabled.
- Production build, full lint (0errors/33 inherited warnings), full/build typechecks,
  format:check and production audit (0vulnerabilities) passed. Logs use /tmp/s111-*.
- Existing auth-binding tests now assert the new atomic freeze integration instead of the
  superseded separate bind; no-code fallback still binds only. Two Sentry test mocks gained the
  new supported integration factory without weakening their release/propagation assertions.
- A public context browser check initially timed out reopening settings. The test now asserts
  that the prior banner visibly closed before reopening, matching the older consent test;
  no runtime code, sleeps, retries or behavior expectations changed. Initial and follow-up
  evidence are /tmp/s111-public-browser.log and /tmp/s111-context-browser-diagnostic.log.

Plan clarifications followed: initial confirmation provenance remains conservative; no Auth
trigger, metadata/financial mutation, arbitrary event API, new package or private Google script
was added. The one private outbox records activation as a literal immutable timestamp function
rather than introducing a mutable settings table. Privacy disclosure already covers minimal
source dispositions and30-day identifiers; operations documentation now specifies actual state
and evidence boundaries. Uncertain sends are not automatically replayed.

Final local browser result: all7 public analytics cases passed on the same compiled fake-GA
application with retries0 (/tmp/s111-public-browser-final.log). This does not substitute for
hosted execution of the new real-Supabase signup case. Final coverage is77.66% lines; full
format and typecheck were rerun after test-only synchronization/mock updates and passed.
Owned loopback server3111 was stopped after verification.
