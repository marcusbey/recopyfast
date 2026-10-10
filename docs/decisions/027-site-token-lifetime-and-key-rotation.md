# ADR 027 — Site tokens remain valid until key rotation

- Status: accepted
- Date: 2026-09-24
- Scope: story `s29-editor-invite-and-token-lifetime`, operator decision D3

## Context

A site token is embedded in a static snippet on a customer-controlled domain. Expiring it after
90 days silently disables a previously working installation: there is no account session or
refresh credential in that page to renew it. A-25 also found that authorization refusals lacked
the CORS headers needed to read their structured error response.

## Decision

Site tokens have **no age cap**. HTTP and WebSocket verifiers retain strict token shape, matching
site ID, digit-only timestamp, the 60-second future-date guard and timing-safe HMAC verification.
Origin authorization remains required. Removing expiry does not relax these checks.

Revocation is explicit rotation of `sites.api_key` through the authenticated, admin-only,
rate-limited Regenerate snippet action. HTTP authorization reads the current key on each request,
so old tokens fail subsequent HTTP requests. The owner must replace installed snippets with the
newly generated snippet. A leaked credential remains valid until rotation; that operational
responsibility is the tradeoff for durable installations.

Readable structured errors and CORS on refusals remain the A-25 diagnostic mechanism. The s29
widget warning is removed: this story adds zero bytes to the widget source relative to the main
branch it integrates, preserving the headroom required by s27. Authored page content remains
intact when hydration is refused.

## Considered options

- **Keep the 90-day age cap:** rejected because static installations stop without an owner action
  and there is no renewal path in the deployed snippet.
- **Use a longer finite age cap:** rejected because it delays the same failure and gives owners
  an arbitrary maintenance deadline rather than deliberate revocation.
- **Add a refresh endpoint:** rejected because a public, indefinitely renewable installation
  token does not gain a useful expiry boundary from automatic renewal. It also adds network,
  state, failure and widget-byte costs. Introducing separate limited refresh credentials would
  require a different credential model outside the operator-approved D3 scope.
- **No age cap with key rotation:** accepted. It matches static snippet lifetime and gives the
  site administrator a deliberate revocation action while preserving validation and origin rules.

## WebSocket boundary and follow-up

The server checks the current key at the **handshake only**. An already-open socket retains its
handshake token in `socket.data.siteToken`; rotating the key does not disconnect that socket.
Existing connections may continue receiving published content until they disconnect. Reconnects
with the old token are refused. This decision does not claim immediate revocation of live sockets.

Follow-up: implement and independently review either current-key validation for socket activity
or a rotation-triggered disconnect of the affected site's sockets. It must include an integration
test that opens a socket, rotates the stored key, proves the old socket loses access, then proves
a new-token connection succeeds. Preserve the separate editor-grant authorization boundary and
account for the one-machine deployment constraint in ADR 026. Live-socket revocation is deferred
from s29; the dashboard confirmation states the current limitation.

## Release and rollback

The operator must apply `20260924000000_atomic_editor_activation.sql` and verify the service-only
RPC is callable before deploying the invitation route. A missing function fails closed with a
logged, clear 503; it must not fall back to uncoordinated enrollment or send mail. Deploy both
Next.js and the WebSocket verifier for matching lifetime rules. No remote migration or deployment
is authorized in this fix run.

Application/server rollback can leave the additive activation RPC installed. Never restore an old
API key to undo a rotation; replace snippets instead, since restoration would revive revoked
credentials. Reverting the lifetime decision would require a superseding ADR and an explicit
installation migration strategy.
