# ADR 055 — The owner's edit link carries a one-time code in the URL fragment

- Status: accepted (CTO decision under the owner's 2026-10-09 directive)
- Date: 2026-10-09
- Scope: story s76-grant-and-edit-token-hardening
- Amends: [ADR 036](./036-edit-link-credential-in-tab-session-storage.md) — its "Context" and
  "Decision" describe the owner's link as `?rcf_edit_token=<token>` read off the URL. The
  persistence decision (the tab's `sessionStorage`, cleared on 401/403, kept through 5xx) is
  unchanged; what arrives in the URL is not. Numbering: next free number on `main` at 72f4cff;
  renumber at merge if another branch lands 055 first.

## Context

`POST /api/edit-sessions/create` answered `editUrl: https://<domain>?rcf_edit_token=<token>`. The
token is the edit session itself: a bearer credential good for 2 h (24 h absolute) with no origin
or device binding. In the query string it reaches the customer's access logs and CDN, every
`Referer` sent before the widget strips it, and browser history (finding A-29, pinned by
`src/__tests__/api/edit-sessions/create-token-leak.test.ts`). The pins require that `editUrl`
contain no token and no query key at all.

## Decision

1. `editUrl` is `https://<registered host>/#rcf_edit=<code>`. The code is
   `rcfl1.<payload>.<signature>`: an HMAC (domain tag `recopyfast/edit-link/v1`, the editor signing
   key) over `{e: edit session id, s: site id, x: expiry}`. It lives **60 seconds** and is spent
   **once**: spending it is the conditional write `last_used_at = now()` on a session that has
   never been used (`last_used_at IS NULL`), which is exactly a link that has never been opened.
2. The widget reads the code from the fragment at parse time, strips the fragment with
   `history.replaceState`, and sends the code in the `editToken` field of its existing boot check,
   `POST /api/staging/validate`. That route — and no other — recognises the prefix, checks the
   signature, site and expiry offline, requires the request's `Origin` to be the site's exact
   registered host, validates the session as any stored session is validated (ADR 047) without
   recording a use, and only then spends the code. It answers the session's token in the response
   body; the widget swaps it in, in memory and in the tab's storage (ADR 036). From then on the
   token travels exactly as before. Check, then spend (s76 review fix): when the database fails at
   any step the answer is 503 and the code is still unspent, so the widget, which keeps it on a
   5xx, can retry; a token is never answered for a session that was not confirmed valid.
3. The widget no longer reads `rcf_edit_token` from the query. A legacy or crafted
   `?rcf_edit_token=` link boots a visitor and stores nothing; the parameter is still stripped
   from the address bar (tested for presence, never read), so a pre-deploy token does not stay
   visible there.

## Considered options

- **The token in the fragment (`#rcf_edit_token=<token>`)** — rejected. It leaves server logs and
  `Referer`, but not history, screenshots, screen shares or a pasted link, where it is good for
  hours. It also fails the A-29 pin by construction ("does not put the token in editUrl").
- **A one-time code in the query string** — rejected. Dead after one use, but still written to the
  customer's logs and sent in `Referer`; the pin forbids any query key.
- **A dedicated `POST /api/edit-sessions/redeem`** — rejected on bytes, measured: +88 / +79 gz
  against ceilings with zero headroom; riding the boot check costs nothing extra on the wire and
  fits (the story measures −3 / −4 overall with the offsetting savings).
- **A table of link codes (the `editor_handoffs` shape)** — rejected. A migration, RLS, a
  migration-first deploy, for state the session row already holds: an unused session is an
  unopened link.
- **`postMessage` from the dashboard tab** — rejected. The dashboard nulls the popup's `opener` on
  purpose (reverse tabnabbing), and a cross-origin handshake timed against a third-party page load
  is fragile.
- **Owner links as device-grant hand-offs** — still the principled end state (ADR 036's
  "deferred" option); still a product change, not a security fix.

## Consequences

- An opened link cannot be opened again; a link opened after 60 s says "Invalid or expired staging
  link." once and the owner clicks Edit website again. A site that rewrites the fragment before the
  widget runs (hash routing that normalises `#…` on boot) loses the code the same way.
- The only credential in any landing URL is worth nothing after 60 s or one use. A link pushed on
  someone else (fixation) is bounded the same way, and requires the pusher to already hold a
  session on that site.
- Request bodies from the widget may now carry `"token": null` / `"editToken": null` where they
  omitted the key (bytes); servers take a credential only when it is a string.
- Still in a query string, and not this ADR's: the widget's own API reads (`?rcf_edit_token=` to
  RecopyFast's API), the realtime handshake's `editToken`, the hub's 60 s `?rcf_handoff=`, and
  Share Preview Links. None reaches a third party's logs.
- Do not "simplify" the code into the token, or back into the query. Do not let a second route
  spend codes: one spender is what makes "single use" checkable.
