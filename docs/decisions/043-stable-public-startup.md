# ADR 043 — Default protection during public text startup

Date: 2026-10-04. Status: accepted by the user through validation of
s61-stable-copy-loading. Scope: new supported installations; rollout still requires
measured performance and the repository release gates.

## Context

The body-end external widget cannot undo authored text already painted. Its serial
font/content/A-B startup produced a visible original-to-published swap on the actual
aicompoz.com homepage. The user requires protection by default and rejected a
1.5-second visibility delay. Existing installation and runtime URLs must remain compatible.

## Decision

Expose a typed two-placement installation: a native head bootstrap plus a hydration-safe
external runtime tag, with explicit protocol/CSP metadata. Retain the unmarked legacy
builder and permanent runtime URL. A marked runtime lacking matching early state must
retain authored public copy rather than silently take the late-swap path.

The bootstrap owns the early public request, scanner-compatible temporary text gate,
normalized document key and terminal startup state. It starts the existing authorized
GET immediately, omits cookies and editor credentials, and sets no-referrer explicitly.
A fixed 200 ms visibility deadline starts when eligible text is first held. The runtime
consumes the bounded request, gathers valid published rows and A-B selection, commits
final values synchronously and reveals once. If only the experiment decision misses the
cap, valid published baseline may be shown. If published data is missing, reveal authored
copy and abandon automatic late public startup replacements for that document.

Private preview validation and later authorized private hydration retain their own
principal/endpoint flow. Private data never enters the public prefetch or cache. Font
readiness remains a requirement for editing geometry rather than public text delivery.
Preserve host layout and styles; do not force originally hidden visual children visible.

No shared CDN or response cache is introduced. Every GET retains current token/origin
authorization. Explicit credentials select site authorization without cookie fallback;
OPTIONS may cache permission to send, but never authenticates a later GET.

## Alternatives

- API latency optimization alone cannot prevent earlier authored paint.
- Optional protection contradicts the user's requested default behavior.
- Whole-document concealment delays unrelated media and interface elements.
- A long deadline contradicts the user's limit.
- A public shared response cache would require a separate authorization and atomic
  invalidation contract; existing Authorization-bearing requests are not Vercel CDN-cacheable.
- Server-rendered published HTML is a stronger first-paint integration but requires
  customer-side server/build changes outside this reusable snippet story.

## Consequences

Existing installations require migration for the new guarantee. Initial eligible text,
including unchanged text, can briefly wait because edited targets are unknown on a first
visit. Dynamic content, SPA transitions and unreachable roots are not covered by a blanket
claim. A short deadline is not proof of fast delivery: more than one authored fallback in
twenty representative cold runs blocks rollout and requires further delivery work.
Existing embed ceilings stay fixed; the configured bootstrap has a separate 2,500-byte
gzip gate. Source tests, production revision, installation migration and browser proof
remain separate completion gates.
