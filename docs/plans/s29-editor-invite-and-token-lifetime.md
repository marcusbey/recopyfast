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
  A-25 marker into passing tests with real HMAC/route coverage. Widget reads the error code
  and logs one warning with "regenerate your snippet in the dashboard", retaining host copy.
- [x] T6: Add POST /api/sites/[siteId]/regenerate-snippet, authenticated admin-only with
  pre-auth + per-owner rate limits and cryptographically random api_key. One guarded update
  returns a freshly signed snippet/token, no raw api_key. Test denied users, write failures,
  old-token invalidation and new-token validity. Dashboard uses existing Button/Dialog/Alert
  beside snippet, warns old snippet stops working before confirmation, replaces displayed
  snippet/token after success and handles errors. Keep all displayed copy surfaces current.
- [x] T7: Run targeted tests then precommit, build, production typecheck, embed --check and
  audit:prod. Record inherited lint/format findings, format touched files and add no warnings.
  Write review placeholder only and prepare the DRAFT PR handoff with exact evidence.
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
rotation refusal. The warning text and once-per-widget behavior are tested against executable
source in `src/__tests__/embed/site-token-refusal.test.ts`.

## Migration and release boundary

`20260924000000_atomic_editor_activation.sql` adds the service-only activation RPC; existing RPC
remains compatible. Apply this forward migration before releasing the new invitation route.
No remote database was contacted or migrated. Mail tests mock Resend; delivery of real email
and deployed behavior remain outside this local/draft-PR lane. HTTP and WebSocket verifiers
both change, so a later authorized release must update both targets for matching lifetime rules.
Rollback application/server commits together; the unused additive RPC can remain. Rotating a
key is intentionally irreversible: replace installed snippets, rather than restoring an old key.

## Validation run notes

The first precommit run overlapped the production build and ended with 2,776 passed, 38 skipped
and two timing failures in untouched BulkOperations/WebhooksPanel suites. After the build
finished, both suites passed unchanged in one serial run (25/25). The final full gate is run
serially with coverage; no assertions or timeouts were changed to hide these failures.

## Final local gate evidence

Commands below ran through `/tmp/recopyfast-s29-ci.py`, which builds an isolated environment
from the main CI job's exact placeholder values; only the explicit loopback DB test adds its
disposable local connection. No credential `.env` was present or copied.

| Command | Result |
| --- | --- |
| `npm run setup` | Root and server dependencies installed; lockfiles unchanged |
| `npm run precommit -- -- --runInBand --coverage` | Exit 0; 216 suites passed, 1 skipped; 2,778 tests passed, 38 skipped, 0 failed |
| `npm run lint` (within precommit) | 0 errors, 39 warnings; exactly the inherited count |
| `npm run type-check` (within precommit) | Exit 0 including tests |
| `npm run type-check:build` | Exit 0 |
| `npm run format:check` | All matched files pass |
| `npm run build` | Exit 0; 96/96 static pages |
| `node scripts/build-embed.mjs --check` | Fresh; bundle 46,618 / 46,681 B; widget 33,850 / 33,865 B; transport 13,122 B gzip |
| `npm run audit:prod` | 0 vulnerabilities |
| `env RCF_S29_DB_URL=postgresql://postgres@127.0.0.1:56332/postgres npm test -- --runInBand --runTestsByPath src/__tests__/db/editor-activation-concurrency.test.ts` | 2/2 real-DB tests pass; disposable database removed and owned server stopped |
| `git diff --check` | Clean |

Coverage: statements 53.04%, branches 45.90%, functions 48.94%, lines 53.41%; all ratchets pass.
Database proof includes migration replay, concurrent enrol/restore, active duplicates, ACLs,
anon/authenticated execution denial, and service-role execution under the table's RLS policy.
The ordinary Jest gate skips this optional local-DB body; its separate real execution above
is the evidence, not the gated placeholder.

Pre-commit and pre-push hook checks (including formatting, build and coverage) were executed
explicitly before committing. Git's per-command hooksPath override avoids redundant reruns;
no hook file, repository config, threshold, test timeout or assertion was changed.
