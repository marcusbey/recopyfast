# ADR 044 — Origin-only proof for same-origin public reads

Date: 2026-10-04. Status: accepted implementation refinement of s61's validated
privacy and authorization goals. Supersedes only ADR 043's unconditional
no-referrer sentence; its remaining startup and release decisions stay in force.

## Evidence

A real in-app browser request from a native head bootstrap to a local API on the
same origin carried Authorization, but neither Origin nor Referer. The current
`authorizeSiteRequest` requires a registered domain proven by one of those headers.
Unconditional no-referrer therefore refuses legitimate same-origin installations.
No production credential was sent by the probe.

## Decision

Keep no-referrer for cross-origin public fetches. Only when the parsed API origin
matches document.location.origin, set referrer to exactly that origin followed by
"/" and referrerPolicy to origin. Continue omitting cookies and private editor
headers. Never copy location.href, pathname, query, hash or invitation parameters.

Keep the current server token/domain authorization. Do not trust a new client
header or add a same-origin server bypass. A permanent browser test records the
actual headers and verifies both same-origin and cross-origin privacy contracts.

## Alternatives

- Keep unconditional no-referrer: breaks the existing authorization contract.
- Send the full document referrer: could expose private entry parameters.
- Set Origin manually: browsers control that forbidden request header.
- Remove the server domain check: weakens the existing credential boundary.

## Consequences

The same-origin request discloses only its already registered origin to its own
API. Cross-origin public reads continue to disclose no referrer. This changes the
client's header strategy while preserving the intended privacy and authorization
invariants. It does not waive the 200 ms performance or production release gates.
