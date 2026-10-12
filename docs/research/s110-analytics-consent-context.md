# Research — s110-analytics-consent-context

Date: 2026-10-12. Scope: the missing consented attribution bridge between public marketing and verified server conversions. Documentation only; no implementation or provider changes.

## Premise and verified baseline

PR #94 (`s107-google-analytics`) measures public page views and marketing actions. Its approved plan explicitly excludes server-side `sign_up`; nothing sends `purchase`. Its operations document identifies property 558499366 and web stream 16109846324. Provider configuration must be read back during release rather than inferred from this document.

Inspected source in `.omx/worktrees/s107-google-analytics`, including its current staged integration of released billing fixes. Graph discovery was followed by direct source inspection where graph spans lagged the merge. Relevant files:

- `src/lib/analytics/google-analytics/consent.ts`: explicit denied/granted choice; unknown geography, EEA/UK/CH and Quebec require permission. Known other regions default analytics on. Ads always denied.
- `src/lib/analytics/google-analytics/gtag.ts`: guarded event sending, cookie deletion on decline, no server identity/context storage.
- `src/components/analytics/GoogleAnalyticsRuntime.tsx`: the existing public runtime; exact context-capture hook must be rechecked after s107 integration.
- `src/app/analytics/gtag-init.js/route.ts`: reduces trusted edge country/province to a consent-required boolean; no location persistence.
- `src/contexts/AuthContext.tsx`: signup/login both call Supabase `signInWithOtp`; no completed-signup signal here.
- `src/app/auth/confirm/route.ts` and `src/app/auth/callback/route.ts`: verified sessions; repeated login uses these paths too.
- `src/app/api/billing/checkout/route.ts`: authenticated checkout boundary, not a completed payment.

ADR 063 and ADR 069 forbid Google runtime on auth, dashboard, editor and report documents. Server conversion attribution must preserve that boundary. A GA `client_id` is a pseudonymous identifier, not anonymous data; new first-party storage needs explicit privacy disclosure and retention.

## Official API evidence

- [Google tag `get`](https://developers.google.com/tag-platform/gtagjs/reference#get) supports `client_id` and `session_id` callbacks. Use this API after existing GA activation; do not parse undocumented `_ga_*` session-cookie formats.
- [Measurement Protocol consent](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference#consent) exposes advertising consent fields. It does not replace the application's analytics-consent enforcement. The server must decide whether it may send before constructing a payload.
- [Session attribution](https://developers.google.com/analytics/devguides/collection/protocol/ga4/use-cases#session_attribution) requires a session ID and delivery within 24 hours of session start; an overridden event timestamp must fall within the session. A persistent client ID does not make an old session current.

## Traps and bounded proposal inputs

Cookies on the browser never reach a Stripe webhook. A cookie grant copied to Stripe metadata would become stale after withdrawal; storing raw identifiers in payment metadata also creates unnecessary copies. A private context table with a revocable opaque capability avoids both. Raw GA IDs and capability material must be removed on revocation/expiry without cascading away delivery dedupe dispositions; those internal account/source keys remain sensitive and follow the underlying account/billing retention, not an invented anonymization claim.

A public page can capture context before the account exists. Binding must occur only after server verification, and one account must not inherit another account's context on a shared device. Attribution eligibility belongs to the true conversion time: capture and the effective consent interval must predate that event. A new grant or campaign visit must not attach retrospectively to an earlier denied/unattributed conversion. For first signup, binding necessarily follows confirmation, but it can bind only the actual browser capability whose underlying context already existed before confirmation. Context creation is an unauthenticated service write and therefore needs a named, reviewed ADR exception with same-origin checks, fail-closed rate limits and bounded capability-scoped writes.

Independent review rejected a 24-hour whole-context lifetime: `src/lib/billing/trial.ts` sets the normal trial to 14 days, so that proposal discarded the core trial-to-payment journey. The revised proposal retains consent/client-ID binding for **30 days**, never beyond choice expiry, refreshed only by a real eligible public interaction. This is an explicit new privacy/retention decision requiring human plan validation. Session identity is separate: send `session_id` only when the actual event falls within the observed session and dispatch meets Google's 24-hour session-attribution window. A day-14 payment can use the still-valid client ID without pretending the original session lasted 14 days. All verified signups/payments remain in auth/billing; GA stays a consented subset.

## Open questions and verification gaps

- The runtime's final deployment/head must be verified after PR94 lands.
- A region outside explicit-consent areas is not authority to disregard a stored denial.
- Browser revocation can fail to reach the server. The design must disclose the already-in-flight limit, retry revocation, reject subsequent local capture while denied, and bound stale server authority by expiry. Do not claim instant global withdrawal during network failure. The atomic dispatch claim is the in-flight boundary: revocation committed before claim cancels the event; revocation after claim cannot guarantee prevention of the later network request. It does not wait for Google HTTP I/O under a database lock.
- No provider objects, new dependencies or private-page scripts are needed for this story. An independent authenticated context-cleanup cron must ship with s110 rather than wait for s111 dispatch: expiry blocks eligibility immediately, while physical purge normally follows within five minutes; overdue purge older than ten minutes alerts operations. Failures cannot renew eligibility, and physical-deletion latency must not be described as an instantaneous guarantee.
- Story reservation and a new numbered ADR remain parent-owned; no existing ADR is edited.

## Complexity

4/5: bounded context/capability persistence and revocation, without event delivery. Separate s111 owns signup/outbox transport; s112 owns payment semantics. UI reuses existing banner/footer controls and tokens; there is no new screen.
