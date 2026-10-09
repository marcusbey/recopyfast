# Research — Story s76-grant-and-edit-token-hardening

Verified against `origin/main` at `72f4cff` on 2026-10-09, in the story worktree. No production
access: no SQL, no connector, no credentials. Byte figures are real `node scripts/build-embed.mjs`
runs on prototypes of the source, each restored with `git checkout --` after measuring.

## 1. The edit link (A-29)

**What happens today.** `POST /api/edit-sessions/create` mints an `edit_sessions` row through the
service role and answers `editUrl: https://${site.domain}?rcf_edit_token=${token}`
(`src/app/api/edit-sessions/create/route.ts:143`). `useEditSession` opens `about:blank` on the
click, nulls `opener`, and sets the popup's `location.href` to that URL after checking it is
http(s) on the site's registered host (`src/hooks/useEditSession.ts:92-104,118-139`). The widget
reads `rcf_edit_token` at parse time (`public/embed/recopyfast.src.js:77`), strips it with
`history.replaceState` (`:81-89`) and keeps it in the tab's `sessionStorage` (ADR 036, `:117-128`).

The strip runs after the navigation, so the token has already been sent in the request line to
the customer's server, CDN and analytics; it sits in history; and every subresource the page
requested before the widget ran carried it in `Referer` (unless the page sets a strict
Referrer-Policy, which we do not control). The token is good for 2 h (24 h absolute,
`edit-sessions.ts:44`) with no origin or device binding. A `sites.domain` stored with a scheme
gives `https://https://example.com?…` (pinned).

**The pins, read literally.** `create-token-leak.test.ts:151` asserts `editUrl` does not
*contain* the token — so the obvious "move it to `#rcf_edit_token=`" fails it. `:170` asserts the
URL has **no query key at all**, so a one-time code in the query fails it too. `:192` asserts the
hostname for a scheme-carrying domain. The design space is therefore: *something that is not the
token, outside the query*.

**Fragment facts relied on.** A URL fragment is never sent in an HTTP request, and the Fetch
standard strips it from every `Referer` ("strip url for use as a referrer"). It survives a
server-side redirect when the `Location` has no fragment of its own (the HTML navigation rule), so
`example.com → www.example.com` redirects keep it. It does land in history before the widget
replaces the entry, which is why what travels must be worthless on its own: single-use and short.

**A one-time code without a migration.** `edit_sessions.last_used_at` is nullable with no default
(`supabase/migrations/20250817000000_complete_database_setup.sql:379`); `createEditSession` never
sets it (`src/lib/auth/edit-sessions.ts:98-110`); every validation sets it
(`src/lib/auth/editor-access.ts:535-538`). So "a session that has never been used" is exactly
"a link that has not been opened", and a conditional `UPDATE … SET last_used_at = now() WHERE id =
… AND site_id = … AND is_active AND last_used_at IS NULL AND expires_at > now() RETURNING token`
spends the link once, atomically (the second concurrent UPDATE re-checks the predicate after the
first commits and matches nothing). The code itself is a signed envelope
`rcfl1.<base64url {e: session id, s: site id, x: expiry}>.<HMAC>` under a new domain tag
`recopyfast/edit-link/v1`, using the key every editor credential already uses
(`getSigningKey`, `src/lib/auth/editor-crypto.ts:43-78`; falls back to a derivation of
`SUPABASE_SERVICE_ROLE_KEY`, which production has). Forged, tampered or cross-purpose codes fail
offline, before any database read. Nothing in the code is secret beyond its signature: a session
id and a site id.

Nothing else can spend the link early: the only other holder of the token is the dashboard's
create response (pinned as the control, `create-token-leak.test.ts:129`), which the dashboard
never uses (`useEditSession` reads `editUrl` only).

**Where the code is spent — measured.** The embed is at its ceilings (45828 / 33062, zero
headroom). Prototype costs, gzipped bundle / widget, against those ceilings:

| Variant | Δ |
|---|---|
| Dedicated `POST /api/edit-sessions/redeem` + `EDIT_LINK` variable | +88 / +79 |
| Folded into `/staging/validate` as a separate `editLink` body field | +64 / +62 |
| Code held in the edit-token slot, sent as `editToken`, swapped for the returned token | +50 / +56 |
| … + one `keepEditLink()` shared by parse time and the swap | +45 / +40 |
| … + `kind: result.kind` (the server always sends it on `valid`, `staging/validate/route.ts:63`) | +27 / +24 |
| … + refresh body without `rememberDevice` (the server ignores it after this story) | +23 / +21 |
| … + `init()` tests `this.stagingMode` alone (it already implies a token, `:137`) | +13 / +13 |
| … + no `|| null` on the new read, `location.hash` | +9 / +8 |
| … + `|| undefined` dropped from `editorTokenBody()`, destructured restore | +4 / +3 |
| … + `|| undefined` dropped from the validate body | **−3 / −4** |

So the code rides in the existing `editToken` field of the widget's boot check, and the server
recognises it by its prefix. Bodies now carry `"token": null` / `"editToken": null` where they
used to omit the key; every server reader takes a credential only when it is a string
(`extractEditorToken`, `editor-access.ts:207-226`; `staging/validate/route.ts:17-28`).

**Origin.** The boot check is a public, CORS-`*` route. The code's redemption additionally
requires the request's `Origin` to be the site's registered host (`originBelongsToSite`, after
L12), as `handoff/redeem` does (`route.ts:51-62`): a browser page on another origin that saw the
fragment cannot spend it. A non-browser caller can forge the header; the code's 60 s life and
single use are what bound that.

**Fixation and downgrade.** Any link-borne login can be pushed on someone: an attacker who is
already an `edit` member of a site could send the owner a fresh link to *their own* session (the
owner then edits as, and is attributed to, the attacker). The window is 60 s and one use, against
2–24 h for the legacy query token. The widget stops reading `rcf_edit_token` from the query
entirely, so a legacy or crafted `?rcf_edit_token=` link is a visitor load — the long-lived token
cannot be planted through a URL any more, and no code path accepts a credential from a landing
URL's query. The server keeps accepting a raw token in the boot check's body: that is the tab's
stored session (ADR 036), not a URL.

**Callers that land with `?rcf_edit_token=`** and must move: `e2e/share-edit-publish.spec.ts:155`
(seeded session, real app → mint a code for it), `e2e/realtime-parity.spec.ts:232,296` (two
contexts on one session — a code is single-use, so each context starts from a tab that already
holds the session in `sessionStorage`), and the jsdom suites
`src/__tests__/embed/{edit-link-persistence,ai-suggest-credentials,editor-terminal-session,plan-ended-message}.test.ts`.
Dashboard tests that mock `editUrl` (`EditWebsiteButton`, `SiteRow`, `QuickSetup`, the site
layout) test the hook's host check, which is unchanged; their fixtures still parse.

**Out of reach for s76.** The widget's own reads still send `?rcf_edit_token=` to RecopyFast's API
(`editorTokenQuery`, `recopyfast.src.js:1333`), and the realtime handshake carries `editToken` in
its query (`server/index.js:211`). Neither reaches a third party, history or a `Referer`; moving
them to a header needs `server/` (s79's file) and is byte-neutral at best. The hub's
`?rcf_handoff=` is already a 60 s single-use code. Share links (`?rcf_staging=1&rcf_token=`) are
s72b's.

## 2. Grant lifetimes (A-28)

- `refresh-grant` reads `rememberDevice` from the body (`route.ts:39`) and `refreshDeviceGrant`
  passes it to `issueDeviceGrant` (`editor-grants.ts:450-456`), which picks the TTL from it
  (`:162-165`). Every rotation starts a full TTL from now.
- The row records `created_at NOT NULL DEFAULT NOW()` and `rotated_from`
  (`20260801100000_editor_access_2fa.sql:220-222`). `authenticated` may UPDATE only `revoked_at`
  and `revoked_reason` (`20260925120000_sites_api_key_column_grants.sql:136-140`), so
  `expires_at − created_at` is the span the server itself chose at mint: 12 h for a session grant,
  7 d for a remembered one. That span, not the body, is what a rotation can honestly inherit
  (threshold 24 h — the widget's own `REMEMBERED_FLOOR_MS`, `recopyfast.src.js:198`).
  **Corrected in the Devin fix pass:** the span describes the row, not the choice. Once the
  ceiling caps a replacement (any rotation in the final day), its span is under 24 h and the next
  rotation read a remembered lineage as session-only. The choice now travels signed in the token
  as `r` (1 / 0), beside `l`; the span stands in only for a token minted before it, whose row was
  never capped.
- The lineage's first issue is not on the row, and walking `rotated_from` is unbounded. The grant
  is already a signed payload (`{g, s, o, x, n}`, `editor-grants.ts:69-80`): it can carry the
  lineage start `l` (epoch seconds) forward at every rotation, unforgeable without the key. A
  token minted before s76 has no `l`; its row's `created_at` stands in once, and its successor
  carries it from then on. A migration adding `lineage_started_at` was weighed and rejected: it
  needs a recursive backfill and a migration-first deploy, and code reading a column the database
  lacks would fail every grant validation.
- **Ceiling: 30 days from first issue**, for both kinds (CTO decision in the plan). A remembered
  grant slides 7 d at a time until then; a session grant 12 h at a time. Enforced where the grant
  is used (`validateDeviceGrant` → `expired`, which the widget answers with a code prompt) and
  where it is extended (the replacement's `expires_at` never passes the ceiling). The realtime
  service never sees device grants (`server/auth.js:226-247`), so there is no third validator.
- The suite's guards that asserted "both an hour-old and a 300-day-old lineage refresh"
  (`editor-grants-ttl.test.ts:386-410`) describe the defect; they change with it.
- Many grant fixtures carry no `created_at` (`content-device-grant`, `grant-revocation-midsession`,
  `editor-access`, `editor-grants.replay`, `ai/suggest/editor-credentials`). The validator treats an
  undatable lineage as unbounded-therefore-refused, like `validateEditSessionAccess` does with
  `created_at`; those fixtures gain the column the real table always has.

## 3. L12 — origin matching

`originBelongsToSite` (`editor-request.ts:44-90`) accepts `originHost.endsWith('.' + registered)`.
Its callers are `submit-code` (`route.ts:162`) and `handoff/redeem` (`route.ts:51`). The widget's
content and publish requests authenticate with the site token, whose origin pin is the exact
hostname (`site-auth.ts:188,242`, `normalizeDomain`/`parseOrigin`). So a grant bound to
`www.example.com` on a site registered as `example.com` never let anyone edit — the content
routes refuse that host — but a grant bound to an attacker-controlled subdomain (user content on a
shared parent, a dangling CNAME) is a credential minted with our name on it for an origin that is
not the customer's. Exact host, using site-auth's own `normalizeDomain` and `parseOrigin`, keeps one
rule. No test covered the function before.

## 4. R4 — revoking an editor leaves their staging invites live

`revokeSiteEditor` stamps `site_editors.revoked_at` and sweeps device grants
(`editor-directory.ts:292-322`). Since s68c every staging validator refuses an invite whose
address has a revoked directory row (`staging-access.ts:252-264`, `isEditorRevoked`), so the rows
are not load-bearing — but they stay `is_active` and the dashboard lists them as live access.
`staging_access.email` keeps the case it was typed in; `site_editors.email` is normalised
(`isEditorRevoked`'s note, `staging-access.ts:684-686`). A PostgREST `ilike` would treat `_` and
`%` in an address as wildcards and could deactivate someone else's invite, so the sweep reads the
site's active invites and matches with `normalizeEmail` in code, then updates by id.

## 5. Outages answered as verdicts (s41 review)

| Path | Today on a database error | Widget consequence |
|---|---|---|
| `validateEditSessionAccess` (`editor-access.ts:471-482`) | `.single()` error → 401 | edit link forgotten, writes locked |
| site_permissions read (`:515-524`) | → 401 | same |
| `validateStagingAccess` (`staging-access.ts:214-232`, catch `:343-353`, `isEditorRevoked` throw) | → 401 | share link forgotten |
| `validateDeviceGrantAccess` (`editor-access.ts:330-335`) | reason `error` → 401 | write locked (terminal) |
| `POST /api/editor/validate-grant` (`route.ts:56-66`) | 401 `{reason: "error"}` | widget treats a string `reason` as a verdict and clears the grant (`recopyfast.src.js:338-347`) |

`.single()` reports "no row" as an error (PGRST116), which is why the edit-session path cannot
tell the two apart today; `.maybeSingle()` returns `{data: null, error: null}` for no row. The
widget already treats any status other than 401/403 as transient on the boot check (`:1077-1085`)
and on writes (`handleTerminalWriteFailure`, `:1233`), and any status ≥ 500 as transient for grants
(`:338`). So the fix is server-side: 503 for infrastructure errors; the widget needs only tests.

## Traps

- `cp` is `cp -i` in this shell; restore with `git checkout --`.
- The artifact's banner carries the source's sha256: any source edit, comments included, moves
  gzip by up to ±2 B. Measure the final tree; only that number is the ceiling.
- `getSigningKey` memoises: tests that mint codes set `EDITOR_GRANT_SECRET` before importing and
  call `resetSigningKeyCache()`.
- Playwright specs may import from `src/` only through relative paths with no `@/` imports
  (`share-edit-publish.spec.ts:5` imports `editor-crypto` that way); the code-minting module must
  stay free of Supabase and aliases.
