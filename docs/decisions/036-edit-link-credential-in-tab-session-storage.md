# ADR 036 — Edit-link credential persists in the tab's sessionStorage

- Status: accepted
- Date: 2026-09-25
- Scope: story s41-edit-link-multipage. The number assumes s40 lands ADR 035 first; renumber to
  the next free number at execution if it has not.

## Context

The owner's **Edit website** link (`rcf_edit_token`, `src/app/api/edit-sessions/create/route.ts:121`)
and the **Share Preview Link** (`rcf_staging=1&rcf_token`, `ShareSiteDialog.tsx:163`) carry their
credential only in the URL. The widget reads it at parse time, strips it from the address bar
(`public/embed/recopyfast.src.js:83-105`) and keeps it in page memory only.

On a normal multi-page site, every later load in the tab boots as a visitor: an internal link, a
reload, and Edit Board's restore reload. The one feature these links exist for (editing *my site*,
not one page of it) stopped at the first click.

Invited editors never had the problem. Their device grant is stored (`writeStored`,
`recopyfast.src.js:210-220`), and it is origin-pinned, UA-pinned and hashed server-side.

The two edit-link credentials are weaker than a grant:

- An **edit session** is a bearer token with no origin binding and no device binding. Its IP check
  logs and never rejects (`edit-sessions.ts:44-49`). Only elapsed time retires a leaked one: 2 h
  from the dashboard, at most 24 h absolute.
- A **staging token** lives up to 30 days, but its email verification is bound to the verifying
  browser's User-Agent for 12 hours (`staging-device.ts:73`).

The server re-validates both on every page load (`/api/staging/validate`) and on every write
(`validateEditorTokenFromRequest`).

## Decision

When the URL itself establishes editor mode (`(rcf_staging=1 && rcf_token) || rcf_edit_token`),
the widget writes the credential to **`sessionStorage`** under `rcf_edit_link:<SITE_ID>` as
`[stagingToken | null, editSessionToken | null]`. On a load with no such URL, it restores from that
key.

The key is removed when the server refuses the credential:

- `/staging/validate` answers 401 or 403;
- a save or publish hits the terminal 401/403 handler.

It is kept through 5xx and network failures. A credential in the URL always overwrites the stored
one. Every storage access sits inside try/catch (non-negotiable #4).

Two things do not change: the URL strip, and where the credential travels on requests (query or
body, exactly as before). Persistence adds no client-side expiry and no bypass. The server
lifetime is the only lifetime.

Preview Live opens with `noopener`, so the "live" view does not inherit the tab's session.

## Considered options

- **localStorage** — rejected. The credential would survive browser restarts and spread to every
  future tab on the origin. For a token with no device binding, that makes it a shared-computer
  credential: the next person to use the browser opens the site and is editing it. The grant may
  use localStorage because it is pinned to origin and UA, and hashed server-side. These tokens are
  neither.
- **A cookie on the customer's origin** — rejected. It would ride along on every request to the
  customer's own server and land in their access logs and CDN. A script-set cookie cannot be
  httpOnly, so it is no safer than storage and leaks further.
- **Re-appending the token to internal links, or re-writing it into the URL** — rejected. It puts
  the credential back in history, in the `Referer` sent to every third-party asset and in every
  access log. That is exactly the A-29 finding
  (`src/__tests__/api/edit-sessions/create-token-leak.test.ts`) and the pattern ADR 025 names as
  the one not to copy.
- **Convert the owner's link into a device grant via an editor handoff** — deferred, not rejected.
  It is the principled end state for A-29: an origin-pinned grant that already survives
  navigation. It is a larger story, for three reasons:
  - owners are `site_permissions` admins, not `site_editors` rows;
  - `handoff/create` serves hub sessions only;
  - share links (staging tokens) would still need this ADR's answer.
- **Keep the status quo and tell owners to use the /edit hub** — rejected. The owner's dashboard
  button and the share link are the advertised entry points, and both break on the first click.

## Consequences

- Edit mode now lasts as long as the tab, bounded by the server. An editor on page N is also
  excluded from A/B bucketing and impressions (staging mode skips them), where today they are
  counted as a visitor from page 2 onward.
- **Accepted exposure, stated so nobody has to rediscover it:**
  - Any script on any page of that tab, on the customer's origin, can read the token for the
    tab's life. It could already read it on the first page, through `window.ReCopyFast`.
  - Chrome and Firefox persist sessionStorage in session-restore data, so a restored tab can bring
    it back.
  - Duplicate Tab copies it, and so does a host page's own `window.open` without `noopener`.

  All of these are bounded by server expiry and revocation. None of them adds a URL.
- A stale stored token shows the existing "Invalid or expired staging link." modal once, on the
  next load, and is cleared. The editor learns why editing stopped instead of silently becoming a
  visitor.
- There is no in-page "stop editing" control for edit-link holders. Closing the tab ends it. A
  control is a separate, costed follow-up if the operator wants one.
- Do not "harden" this into localStorage-with-expiry, or into URL rewriting. Do not "simplify" it
  back into memory-only; that is the s41 bug. If the owner link moves to device grants (the A-29
  end state), supersede this ADR for edit sessions and keep it for staging links.
