# Research — s111-verified-signup-analytics

Date: 2026-10-12. Depends on s107 and proposed s110. Documentation only.

## Premise and current implementation

Completed signup means **the first verified account confirmation**, not requesting a magic link, clicking a CTA, starting a trial or visiting the dashboard. The authoritative current confirmed-account count is surviving Auth accounts with `email_confirmed_at` present; GA is an optional attributed subset. That mutable timestamp is not an immutable historical first-signup series, so period counts based on it must disclose timestamp reset/clearing limitations.

Verified `src/contexts/AuthContext.tsx` calls `supabase.auth.signInWithOtp` for registration and login. `src/app/auth/confirm/route.ts` verifies allowed OTP types and then obtains a server-verified user; `src/app/auth/callback/route.ts` exchanges a PKCE code and obtains a verified user. Both start trials idempotently. Callback's no-code fallback accepts an existing authenticated session and is not evidence of new confirmation. `src/lib/billing/trial.ts` returns no first-account marker and intentionally tolerates trial failures.

ADR007 describes `account_milestones`, but current source graph/search and migration search found **no implemented table or writer**. Do not treat the accepted design document as evidence that a reusable confirmation ledger exists. The proposed story reuses Auth's confirmation timestamp; it does not implement s03 or duplicate account truth.

Existing `vercel.json` has a five-minute webhook dispatcher. Its route/authentication and service-only claims are patterns to inspect, not permission to change customer webhook semantics. Analytics requires its own bounded dispatcher.

## Official behavior

- [Recommended events](https://developers.google.com/analytics/devguides/collection/ga4/reference/recommended-events): `sign_up` is account creation; optional `method` can describe email authentication.
- [MP reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference): HTTPS POST; server-only secret; 2xx acknowledges receipt, not processing; no documented general signup idempotency key. Non-2xx is not an instruction to blindly resend the same payload.
- [Validation endpoint](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events): `/debug/mp/collect` records nothing in reports and does not validate API secret. Schema validation alone cannot prove collection.
- [Session attribution](https://developers.google.com/analytics/devguides/collection/protocol/ga4/use-cases): session attribution has a 24-hour delivery window and timestamp/session bounds. Do not fabricate session time or engagement duration to make Realtime green.
- [Sending events](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events): events older than 72 hours can be timestamp-shifted under relaxed validation; prevent this with local expiry rather than sending historical users as current signups.

## Traps and settled proposal inputs

Email confirmation on another device may lack s110 context. Freeze the eligible context or explicit absence against the signup source key at true confirmation time; a later consent grant or marketing visit cannot repair that absence. A binding created just after verification is allowed only through the real confirming browser capability for a context captured before confirmation, not by searching for any account context captured afterward. It must still appear in the all-user Auth count; no generated GA client ID, cross-device email linkage, or forced third-party script repairs attribution.

A durable outbox protects event identity and records attempts; the retained account/source keys are still sensitive private data. Context cleanup must not remove them or repeat login can become signup again. Account deletion may remove analytics rows, but replay must require an existing account and cannot recreate deleted-user analytics. The outbox cannot atomically commit a PostgreSQL row and an external Google request. A crash after claiming may have sent nothing or may have sent successfully. For signup, automatically reclaiming that ambiguous attempt risks duplicates. Keep it explicitly uncertain until reconciled; do not advertise exactly-once external delivery. Atomic claim is the in-flight boundary for revocation: before claim cancels, after claim cannot guarantee stopping the HTTP request.

The activation baseline must exclude confirmed accounts that existed before this feature. Upstream [user model](https://github.com/supabase/auth/blob/master/internal/models/user.go) preserves confirmation during a normal already-confirmed email change, but `Confirm()` assigns the current time; [admin update](https://github.com/supabase/auth/blob/master/internal/api/admin.go) invokes it unconditionally for `email_confirm: true`. Identity promotion can also clear confirmation before a later reconfirmation. Therefore activation cutoff alone is insufficient: seed suppressed signup source rows for all already-confirmed users in the outbox migration's consistent activation snapshot. Retain the private once-per-account disposition, including suppressed outcomes, despite later timestamp changes. No second ledger or Auth trigger is needed.

The current generic verified user result cannot prove that the request was the initial confirmation. [GoTrue verification](https://github.com/supabase/auth/blob/master/internal/api/verify.go) routes signup/invite through signup verification, but generic email verification resolves the token category internally and magic-link recovery may confirm an unconfirmed user or log in an existing one. The current PKCE exchange result supplies no documented first-confirmation flag. Successful explicit signup/invite OTP verification is a provider-validated confirmation-flow signal; the query string alone is not proof. Timestamp proximity and absent outbox rows do not resolve concurrent-device or prior-write-failure ambiguity.

At an eligible proven confirmation, one service-only transaction must bind the actual request capability and freeze selected context or absence under the unique signup source key. A lost acknowledgement can be recovered from that durable row. A total freeze failure loses original-browser proof; later cron/login must not select from arbitrary bound contexts. The minimal plan-consistent correction is conservative attribution: report unproven/unknown or suppressed instead of claiming universal recovery. Both auth paths remain integrated, but no path without trusted initial-confirmation evidence may be reported as universal signup tracking. Complete first-party account counts remain independent of this GA gap.

## Open questions and complexity

The parent has since provisioned separate QA property558607633, stream16115552825, measurementG-JHTG44WQ5W and server-only MP credentials; identifier-only evidence is in the conversion release progress archive. Actual signup ingestion and production conversion deployment remain unverified. This research task created no provider objects. The owner's current request supplies analytics release intent; concrete provider/credential actions still need an authority check after semantic plan validation. Debug schema checks, QA ingested events and genuine production signups are distinct evidence lanes.

Complexity 4/5 with transport limited to two typed future event shapes and signup implemented first. Do not expand into activation dashboard, user-ID tracking, arbitrary event ingestion or account-milestones work. Privacy copy and the proposed 30-day consent/client-ID retention are inherited from s110; session attribution still requires the separate Google 24-hour/time-within-session conditions. No new screen.

## Implementation clarification evidence

Readiness inspection of the mutable s110 worktree found `bindAnalyticsContext(request, userId): Promise<void>` swallowing failures, while `eligible_analytics_context(user, occurred_at, signup_hash)` requires actual browser hash for post-confirmation binding. s111 must not infer durable browser provenance from that void return or merely from a bound context. Its own atomic freeze can compose existing s110 functions under advisory lock 710110 and store the frozen source/absence in the approved outbox. No-code callback may continue s110 binding but never enqueues signup.

Required race evidence includes baseline timestamp overwrite, concurrent genuine/unknown callbacks, cross-device subsequent login, lost commit acknowledgement, total write failure followed by later grant/login, revoke-before/after-claim and context/account deletion. The implementation may recover committed candidates; it must state the possible unattributed outcome where the original browser proof was never persisted.

## Supported release path and response shape

The repository's last saved production template evidence is `docs/archive/2026-08-04-qa-user-journey.md`: the signup confirmation template was repointed to `/auth/confirm?token_hash=…&type=signup&redirect_to=…`, separately from the existing-user magic-link template. This gives a useful explicit-signup path; the live read-back below now confirms this configuration; an archive alone would not prove it. Successful explicit signup verification validates the confirmation token with GoTrue, then the application can atomically freeze the actual browser source and once-per-account disposition.

Installed `node_modules/@supabase/auth-js/src/lib/types.ts` defines `AuthResponse` with `user` and `session`, not a first-confirmation or resolved-verification-type flag. Installed `GoTrueClient.verifyOtp()` returns that shape and emits `SIGNED_IN`; it does not preserve GoTrue's internal generic-email token classification. Its PKCE exchange extracts `redirectType` from local code-verifier storage. [Official auth-js source](https://github.com/supabase/auth-js/blob/master/src/GoTrueClient.ts) and [GoTrue token endpoint](https://github.com/supabase/auth/blob/master/internal/api/token.go) support this boundary: those fields are not proof that this callback caused first confirmation. Thus explicit signup can deliver; generic email/PKCE gaps remain honest unless a real provider signal is established. No temporal-proximity heuristic is substituted.


## Live production template read-back

Read-only Management API `GET /v1/projects/uexwowziiigweobgpmtk/config/auth` succeeded
on 2026-10-12 using the existing CLI credential in Keychain (decoded in memory; no credential
or complete configuration printed). Confirmation mail uses `/auth/confirm`, TokenHash and
explicit `type=signup`; SHA256 of template content:
6298c9106dbb7a57a1b7cbb19fd69819fdfa2fddf9871832ed8d8647f9317bb8.
Existing-user magic-link mail separately uses `/auth/confirm`, TokenHash and `type=magiclink`;
SHA256 1f6597506d0cebefed963f8f4d13b643bc728e6f0b7af3dde8fb0fd54e2852a0.
Email authentication is enabled and mailer_autoconfirm is false. Invite mail still uses
ConfirmationURL. No template/provider changes were made. This confirms the supported explicit
signup route is configured; it does not prove email delivery or an attended first-confirmation
journey. Reference: https://supabase.com/docs/reference/api/v1-get-auth-service-config.
