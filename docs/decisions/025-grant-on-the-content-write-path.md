# ADR 025 — The device grant is a principal on the content write path, in a header, fail-closed on its origin pin

- Status: accepted
- Date: 2026-08-16
- Scope: story `s14a-grant-authorized-editing`
- **Renumbered from 019 on 2026-08-17.** Two ADRs were independently authored as 019 while this
  one sat on an unmerged branch: this, and `019-agency-billing-single-payer`, which had already
  been referenced from `prd.md` and two plans by the time they met. Renumbering the less-cited
  file was the cheaper correction. **The decision below is unchanged** — only its filing.

## Context

RecopyFast's stated angle is that an invited editor changes copy on their own site **without an
account**. The credential built for that is the *device grant*: a signed, site-pinned,
origin-pinned, browser-pinned token the widget keeps in `localStorage` on the customer's own
domain, minted from an emailed 6-digit code (`20260801100000_editor_access_2fa.sql`).

Before this story that credential authorised nothing. `extractEditorToken`
(`src/lib/auth/editor-access.ts`) recognised `rcf_token`, `rcf_edit_token` and
`Authorization: Bearer` — never a `rcfg1…` grant. `validateDeviceGrant` had exactly one caller in
the whole application, `POST /api/editor/validate-grant`, plus its own internal use inside
`refreshDeviceGrant`. No write path called it. The widget said so out loud on every customer's live
page, in a grey note beside the editor's name apologising that in-page editing was not yet
available on this site.

So the product's main angle rested on a credential that proved identity and permitted no edit. The
research for `s14-agency-client-handoff` recorded this as a false premise in the backlog: the story
above it assumed the single-site version already worked.

Two things had to be decided to close that, and neither is a detail:

1. **Which credential becomes a principal on `PUT /api/staging/content/:siteId` and
   `POST /api/staging/publish`** — the grant, or the `staging_access` bearer token that already
   works there.
2. **How the grant reaches the server**, given that the widget already sends
   `Authorization: Bearer <SITE_TOKEN>` on the same requests, and given that a grant in a URL is a
   grant in browser history.

The failure mode of getting the second one wrong is not a broken feature. `validateDeviceGrant`
takes a `DeviceContext` built from the `Origin` header, and the origin pin
(`editor-grants.ts`, "the binding that makes an exfiltrated grant worthless somewhere else") is
what stops a copied grant working from an attacker's page. That parameter is optional in the type
system. An omitted context is not a compile error, not a test failure and not a 500 — it is a
silent cross-site editing credential, minted with our name on it, redeemable against a customer's
live site.

## Decision

**1. The grant becomes a third principal accepted by `validateEditorTokenFromRequest`.**
`EditorAccessKind` widens to `"staging" | "edit-session" | "device-grant"`. The branch lands
entirely inside `extractEditorToken` / `validateEditorAccess`; no route file changed. Both write
routes already call the chokepoint and already grade with `requireEditorPermission`, so a route
that forgets the new principal cannot exist — there is nothing per-route to forget. This is the
"do not write a fourth auth path" rule in AGENTS.md applied literally.

**2. It travels only in `X-RCF-Editor-Grant`, and that header is checked first.**
Never a query parameter, never a path segment, never a fragment, never a body field. Header-first
ordering is load-bearing rather than cosmetic: the widget sends `Authorization: Bearer <SITE_TOKEN>`
on the same content requests, and the existing `Bearer` branch reads its value as a *staging*
token — checking the grant later would send every grant-carrying request down the wrong validator.
The header is added to `ALLOW_HEADERS` in `src/lib/http/public-cors.ts` in the same change, because
a header the preflight does not allow is stripped by the browser and the feature would fail
silently on every customer domain while passing every server-side test.

**3. The device-grant branch is fail-closed on a missing `DeviceContext`.**
`validateEditorTokenFromRequest` derives it once, with `readDeviceContext(request)`, at the same
single point it already derives the staging device fingerprint. When there is no usable `Origin`,
that returns null and the branch refuses with `origin_mismatch` **before any database read**. It
never defaults the context, never synthesises an origin from the request URL, and never treats an
unpinnable grant as a lookup question. The test for this runs *through the route*, not against the
helper: a helper test proves the helper is right, a route test proves nobody forgot to call it.

**4. Permissions come from the parent `site_editors` row, never from the token.**
Graded by `normalizePermissions`, the single widening rule. The grant's payload carries binding, not
capability. Revocation therefore takes effect on the very next request, because the parent row is
re-read every time.

**5. `/api/edit-board/*` is deliberately out of reach.** Those routes call
`StagingAccessManager.validateStagingAccess` directly and never touch `extractEditorToken`, so a
grant cannot reach theme, language or style administration. That is correct scoping, not an
oversight, and it should stay that way: an invited editor was given a paragraph to fix, not a
settings surface.

**6. Rejection reasons reuse the `GrantRejection` vocabulary** that `POST /api/editor/validate-grant`
already returns to the same caller. Nothing new is disclosed: the holder already knows which token,
origin and browser they used.

## Considered options

**Consolidate onto the `staging_access` token that already writes.** Rejected. It works today, so
this is the cheap answer — but it puts a bearer token in a URL that the site owner copies and
hand-delivers. Migration `20260801100000_editor_access_2fa.sql` exists precisely because the entry
URL was deliberately made to carry no secret, and its header says so. Choosing the working
credential here would reverse a decision made on purpose, and would trade a per-device, per-browser,
origin-pinned credential for a forwardable one.

**Accept the grant as a `Bearer` token.** Rejected. It collides with the site token the same
requests already carry. One `Authorization` header cannot mean two credentials, and the collision
would surface as an intermittent 401 on exactly the requests that matter.

**Accept the grant as a query parameter, like `rcf_token`.** Rejected. A grant in a URL is a grant
in browser history, in the `Referer` header sent to every third-party asset on the customer's page,
and in every access log between here and there. `rcf_token` is the pattern this story must not
copy; the widget strips it from the address bar on arrival precisely because it should not have
been there.

**Default the `DeviceContext` when `Origin` is absent** (or derive it from the request URL, or skip
the origin check for "server-side callers"). Rejected outright, and named here so it is not
re-proposed as a convenience. Any of these turns the grant into a credential that works from
anywhere. There is no legitimate widget request without an `Origin`: the widget is cross-origin by
construction.

**Give the grant a role instead.** Rejected on the story's own terms. Grants are per-site and
expiring; roles are per-org and persistent. `site_editors.permissions` is a capability array on a
revocable row and must not grow into a role. No `/api/teams/*` route is touched by this change.

## Consequences

- An invited editor can now change copy on the one site they were invited to, from the browser they
  verified on, on the origin the grant was minted for, for as long as the grant lives and the
  `site_editors` row is not revoked. That is the product's angle, working for the first time.
- The blast radius of a leaked grant is bounded by four independent pins — site, origin, browser,
  and a live parent row re-read on every request. Three of them are cryptographic or durable; the
  origin pin is browser-enforced, so it stops a copied token rather than a forged header, and the
  module comment already says so.
- `docs/architecture.md`'s auth surface gains a third token kind. Anything that enumerates
  `EditorAccessKind` must handle it; the compiler finds those sites.
- `ADR 002` rule 3 already names "a scoped editor grant" as a permitted service-role principal
  without saying how it reaches the write path. This ADR is that missing half. No new
  `createServiceRoleClient()` call site was added: `validateDeviceGrant` already owns its
  service-role read behind its own validation.
- `staging_history.user_email` now carries the grant holder's address on their edits, which is the
  only per-edit record in the schema that can name a non-account editor. It still has no `site_id`
  and no reader; `s14c` owns that.
- Revocation over an **established WebSocket** is explicitly *not* addressed here.
  `server/index.js` caches permissions at handshake and reuses that cache per message. No WebSocket
  service is deployed, and ADR 004 rule 2 requires realtime to be provably additive — so a security
  property of the HTTP path may not be made conditional on it. `s07a` owns that defect.
