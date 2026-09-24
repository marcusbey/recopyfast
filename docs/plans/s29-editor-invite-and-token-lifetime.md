---
story: s29-editor-invite-and-token-lifetime
validated: yes
validation: Operator explicitly prevalidated this scope and D3 in the task on 2026-09-24.
---

# Plan — editor invitations and durable site tokens

Follow existing architecture and design-system primitives; no provider or dependency additions.

- [x] T1: Test-first invitation delivery through existing Resend helper. Include escaped HTML,
  text, inviter email, site name/domain, permission prose, one token-free /edit CTA, six-digit
  code/no account/password instructions. Send after successful new enrol/restore only; return
  false on provider/metadata failure without failing enrolment. Preserve duplicate behavior.
  Use a new service-role-only atomic activation RPC returning whether this call created/restored
  access; serialize site/email enrolment so concurrent duplicates cannot both send. Preserve the
  old RPC signature for other callers. Add one forward idempotent migration following the
  20260805190000 grant precedent, plus directory and migration/DB tests; never apply remotely.
- [x] T2: Add active-editor resend in the same route (PATCH with siteId + siteEditorId),
  same requireSiteAdmin guard, pre-auth and owner fail-closed limits, editor 3/hour limit.
  Scope row lookup to authorized site, reject revoked/missing rows. Test all limits/guards.
- [x] T3: Update SiteEditorsCard/Row notices and active-row resend, pending/error states,
  manual-link copy button with clipboard feedback. Component tests for sent/fallback/resend.
- [x] T4: Remove site-token age cap while retaining all other validation. Check mirrored
  verification, preserve parity where applicable. Add old-token acceptance and rotated-key
  rejection tests, retaining future/malformed/wrong-site/signature/origin guards.
- [x] T5: Typed site-auth errors carry a stable code and safe permitted origin. Apply existing
  withCors on GET/POST/PUT auth refusals; wrong/missing origins never gain a grant. Flip every
  A-25 marker into passing tests with real HMAC/route coverage. Keep the widget source identical
  to merged main (fix decision C1); server responses carry actionable error codes and the widget retains host copy on refusal.
- [x] T6: Add POST /api/sites/[siteId]/regenerate-snippet, authenticated admin-only with
  pre-auth + per-owner rate limits and cryptographically random api_key. One guarded update
  returns a freshly signed snippet/token, no raw api_key. Test denied users, write failures,
  old-token invalidation and new-token validity. Dashboard uses existing Button/Dialog/Alert
  beside snippet, warns old snippet stops working before confirmation, replaces displayed
  snippet/token after success and handles errors. Keep all displayed copy surfaces current.
- [x] T7: Run targeted tests then precommit, build, production typecheck, embed --check and
  audit:prod. Record inherited lint/format findings, format touched files and add no warnings.
  Preserve the independent review verdict unchanged and prepare the DRAFT PR handoff with exact evidence.
  After gates pass, commit and push the named branch and open the draft; never merge or deploy.

## D3 audit-test interpretation

The old "expired versus forged" comparison becomes "old genuine succeeds; forged/rotated
fails". The old actionable-expiry assertion becomes actionable rotated-token code/guidance.
The old "aged out still genuinely ours" assertion becomes successful old-token authorization.
CORS markers use revoked or forged credentials instead of an age that is now valid. Existing
guards retain their security purpose; age-boundary guard now proves >90-day acceptance and
explicit rotation revocation. No refresh endpoint is introduced because expiration is retired.

## Ownership and validation

Separate implementers own invitation API/email/UI; token auth/content/widget/tests; and
regeneration route/dashboard/tests. Shared limiter presets are invitation-owned; rotation
reuses existing presets. Leader owns story docs, integration, final gates, commit and draft PR.
All tests use CI placeholders and mocks or disposable local resources. No remote SQL, merge,
ready marking or deployment. Review verdict is deliberately left to the independent reviewer.

## Exact A-25 marker mapping

All entries below are in `src/__tests__/api/content/auth-failure-cors.test.ts`.

| Former failing marker | Passing assertion under D3 |
| --- | --- |
| `%s sends CORS headers on a 401 for an expired token` | `%s sends CORS headers on a 401 for a token revoked by key rotation` (GET/POST/PUT) |
| `%s sends CORS headers on a 401 for a missing token` | Same name and assertion (GET/POST/PUT) |
| `%s sends a Vary: Origin on an authorization failure` | Same name, forged credential fixture (GET/POST/PUT) |
| `distinguishes an expired token from a forged one` | `distinguishes an old genuine token from a forged one by accepting only genuine` |
| `says the token expired, in words a site owner can act on` | `says a rotated token is invalid with a stable actionable code` |
| `a token that has aged out is still recognised as genuinely ours` | `recognises a multi-year genuine token as ours` |

Six source markers expand to twelve cases. The three age-section guards remain separate: 91-day
acceptance, 89-day acceptance, and old genuine success versus forged JSON refusal. The WebSocket
integration test also replaces age-based refusal with old-token acceptance and adds stored-key
rotation refusal. The existing generic HTTP warning and authored-copy preservation behavior is tested against executable
source in `src/__tests__/embed/site-token-refusal.test.ts`.

## Migration and release boundary

`20260924000000_atomic_editor_activation.sql` adds the service-only activation RPC; existing RPC
remains compatible. Apply this forward migration before releasing the new invitation route.
No remote database was contacted or migrated. Mail tests mock Resend; delivery of real email
and deployed behavior remain outside this local/draft-PR lane. HTTP and WebSocket verifiers
both change, so a later authorized release must update both targets for matching lifetime rules.
Rollback application/server commits together; the unused additive RPC can remain. Rotating a
key is intentionally irreversible: replace installed snippets, rather than restoring an old key.

## Previous run evidence

The original run used Homebrew Node 25 compression figures that did not reproduce in CI.
Those figures are superseded. The ENOSPC-interrupted fix run left partial changes; this run
retains verified changes and reruns the required gates with CI placeholders and Node 24.
Dependencies were already installed and were not reinstalled. No review verdict is modified.

## Validated fix scope — 2026-09-24

The operator explicitly authorized this fix run. The independent review file is immutable and
must remain uncommitted. Merge origin/main before fixes and again if PR #24 lands before push.

- [x] F1 / C1: Remove the widget warning entirely and restore the embed source to the merged
  origin/main exactly (zero net source bytes); retain server error codes/CORS and authored-copy
  refusal tests. Rebuild and measure under Node 20 and 24 without changing ceilings.
- [x] F2 / M2: Strictly validate UUID spelling and lowercase before all story rate-limit keys;
  share a per-recipient mail limit across resend and new/restored enrollment.
- [x] F3 / M3: Predicate-aware resend tests must fail without site scope or revoked filtering;
  directory mapping tests must fail with didActivate forced true.
- [x] F4 / M4: Missing activate_site_editor must log and return clear fail-closed 503, with no
  enrollment fallback or email. Release order is mandatory: operator applies migration
  20260924000000_atomic_editor_activation.sql, verifies RPC grants/availability, then deploys
  app and WebSocket targets. No migration is applied remotely in this work.
- [x] F5 / M5+m8: Record D3 in the next free ADR: no age cap, api_key rotation, rejected
  refresh/longer-cap alternatives, existing sockets only checked at handshake, follow-up
  current-key validation/disconnection. Correct immediate-revocation UI copy.
- [x] F6 / m6: Force overlap in disposable-loopback DB concurrency test; prove lock mutation red.
- [x] F7 / m7: Strip CR/LF/control characters and cap site label in invitation subject/body.
- [x] F8 / m9: Stale comment, production-only typed auth failure handling (repair test doubles),
  per-row resend accessible names, accurate resend failure copy, truthful DB skip accounting,
  and reset queued auth mocks.
- [x] F9: Run required gates, record exact counts/Node versions/bytes and mutation results,
  commit fix(s29), push, update existing draft PR #23. Do not commit the independent review.

## Fix-run evidence

Merged `origin/main` at `9f22598` before continuing the interrupted changes. PR #24 was still
open at the initial check; recheck before push. Source equality is exact, not merely byte-neutral:
`git diff --exit-code origin/main -- public/embed/recopyfast.src.js` passes.

| Runtime / command | Result |
| --- | --- |
| Node 20.11.0: `node scripts/build-embed.mjs` and `--check` | Fresh; bundle 46,604 B, widget 33,828 B, transport 13,141 B gzip |
| Node 24.14.0: same build and check | Same bytes; both ceilings pass |

Both builds use Node `zlib.gzipSync({ level: 9 })`. Bundle headroom is 77 B and widget headroom
37 B against current main. The s29 delta is zero for the source and generated artifact. The
story-specific console warning and once-only assertion were removed; the existing generic
HTTP warning and authored-copy refusal assertions remain. Server structured errors and safe
CORS are unchanged by that decision.

Targeted verification on Node 24.14.0: 8 suites / 122 tests passed, including the two real
PostgreSQL 14 tests on a disposable loopback server. The database test checks migration replay,
service-only grants, concurrent enrollment/restoration and the observed advisory-lock wait.
The server and its directory were stopped/removed after verification. Ordinary Jest runs skip
the two optional DB tests honestly; no placeholder is counted as a passing test.

| Temporary mutation | Red tests |
| --- | --- |
| Remove resend site predicate | 2 |
| Remove resend revoked predicate | 1 |
| Force directory didActivate to true | 1 |
| Remove SQL advisory lock | 1 (observed transactionid instead of advisory wait) |

All mutations were restored before final gates. The migration SHA-256 remains
`b657cc5d1d186b582507a8b3cb4a2406cf0f299e0554ccc9149ca85e195191e0`.
The recipient limiter applies to every POST to cover revocation between lookup and activation;
resend uses exactly the same endpoint and canonical site/email identifier. A regression test
covers that race. Node 20.11.0 additionally passed both embed suites, 11/11 tests.

| Final local gate (Node 24.14.0, CI placeholders) | Result |
| --- | --- |
| `npm run precommit -- -- --runInBand --coverage` | Exit 0; 216 suites passed, 2 skipped; 2,820 tests passed, 38 skipped, 0 failed |
| lint / full type-check within precommit | 0 errors, 39 inherited warnings; TypeScript passed |
| `npm run type-check:build` | Exit 0 |
| `npm run format:check` | All matched files pass |
| `npm run build` | Exit 0; 96/96 static pages |
| Node 20 and Node 24 `node scripts/build-embed.mjs --check` after build | Fresh; 46,604 B bundle / 33,828 B widget on both |
| `npm run audit:prod` | 0 vulnerabilities |
| `git diff --check` | Clean |

Coverage: statements 53.20%, branches 46.03%, functions 48.89%, lines 53.56%; all ratchets pass.
The first full fix-run gate found two failures in the pre-existing mid-session revocation suite:
its non-UUID fixture IDs were rejected by the new boundary validation. Only those fixture IDs
were changed to valid UUIDs; every revocation assertion remains. The targeted suite then passed
2/2 and the full precommit rerun above passed. No test was weakened, deleted or newly skipped.
The 38 skips comprise 36 inherited skips and the two explicitly optional database cases, which
were executed separately as described above.

Final pre-push refresh still found origin/main at `9f22598` and PR #24 open/unmerged. Both embed
files remain identical to that main. PR #24 must merge first; re-integrate and repeat byte gates
when it lands. `.next` and coverage output are removed after these gates to conserve disk.
Git hooks are not changed; their checks were run explicitly and the per-command hooksPath
override avoids redundant builds/tests at commit/push. No release or independent review pass
is claimed; the existing verdict remains untouched and uncommitted.
