# Research — s29-editor-invite-and-token-lifetime

## Verified current state

- `src/app/api/editor/editors/route.ts` owns GET/POST/DELETE and `requireSiteAdmin`. POST
  checks `findActiveSiteEditor`, meters seats only for new/restored editors, then upserts.
  Its response already computes `${NEXT_PUBLIC_APP_URL}/edit`; it sends no email.
- `src/lib/email/resend.ts` is the existing single Resend integration. `send` accepts HTML
  and text, returns `{sent}`, and catches provider errors. Reuse this integration/template style.
- `SiteEditorsCard.tsx` always displays the manual hub instructions. `SiteEditorRow.tsx`
  is the active-row action surface. Existing dashboard primitives cover notices/buttons/dialogs.
- `verifySiteTokenSignature` in `src/lib/security/site-auth.ts` rejects tokens after 90 days
  in addition to HMAC/shape/future-time checks. `authorizeSiteRequest` throws generic Errors
  and checks signatures before resolving permitted origin. `authorizeSiteOrigin` is the
  matching preflight grant authority.
- `src/__tests__/api/content/auth-failure-cors.test.ts` exercises real HMAC/route behavior,
  with failing CORS/expiry markers. Its expired-token premises must change under operator D3.
- `src/app/api/sites/route.ts` mints snippets only for admins. `SiteDetailView.tsx` displays
  snippets and tokens, but has no regeneration action. Repository API-key searches find
  registration/read usage, not a site-key rotation endpoint. General API keys are separate.
- `enforceRateLimit` uses named presets and explicit store-failure policy; new mail and
  rotation writes should fail closed, including a cheap pre-auth limiter.

## Constraints and traps

No production credentials or remote writes. `npm run setup` installs root and server. Use CI
placeholder values from `.github/workflows/ci.yml`; do not copy any .env. Keep embed source
authoritative and rebuild artifact with the existing byte ceiling. Preserve active-duplicate
seat semantics and origin refusal (no wildcard credential CORS). Do not remove audit guards.
Other token verifier copies/tests (including WebSocket parity) need inspection for the D3
lifetime contract. Keep future-date checks. Email failure includes site-label lookup failure.

## Decision and open questions

Operator D3 chooses no age cap with explicit api_key rotation, so no refresh endpoint is
needed. Independent review remains pending; this lane only opens a draft PR. No new
dependency is needed; key rotation is a single sites update. Invitation concurrency does
require one forward migration: the current upsert_site_editor RPC returns only a row and
findActiveSiteEditor returns null on DB errors as well as absent/revoked addresses. A new
atomic activation result is necessary to distinguish the one enrol/restore writer from active
duplicates. Existing RPC compatibility is preserved. Never apply remotely. Complexity remains 4.

## Database reference check

The official [Supabase database-functions guide](https://supabase.com/docs/guides/database/functions)
confirms invoker execution and explicit function execution grants. The new RPC uses SECURITY
INVOKER and explicitly revokes PUBLIC/anon/authenticated execution, following the repository's
20260805190000 precedent. The current changelog index was checked; no change to this existing
PL/pgSQL/RPC pattern was identified. Local role-execution tests provide the implementation proof.

## Fix-run findings and decisions

The independent blocked review remains unmodified. The operator chose removal of the widget
warning to preserve zero net source bytes after s27 lands. Server structured errors and safe
CORS remain. Strict canonical UUIDs and a shared recipient mail bucket close limiter bypasses;
predicate-aware tests and forced database overlap replace vacuous guard/concurrency evidence.
Missing activation RPC is a logged 503 and a hard migration-before-app release requirement.
ADR 027 records D3 and the handshake-only WebSocket revocation limitation/follow-up. Prior
Homebrew Node byte measurements are superseded by explicit Node 20 and 24 runs.
