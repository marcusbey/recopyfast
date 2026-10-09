# Research — Story s72-edit-board-history-xss

Verified against `origin/main` at `85784a5` and against `feature/s70a-embed-ui-not-content` at
`107c400` (PR #75, which s72 rebases on) on 2026-10-09. No production access was used: no
production SQL, no connector, no credentials (the only SQL ran on a throwaway local PostgreSQL 14,
deleted after). Byte figures were built from a scratch copy of the s70a tree whose
unmodified build is byte-identical to the committed artifact (45840 / 33073); the s70a worktree was
not written to. Source of the finding: `docs/reviews/s70a-embed-ui-not-content.md` F1 (and F4(a)).

## The five structuring facts

1. **The sink is real and it is the only user-controlled one in the embed.** The Edit Board
   History tab builds each card's meta line with
   `cardMeta.innerHTML = '<span>' + dateStr + '</span><span>by ' + (version.created_by || 'Unknown') + '</span>'`
   (`public/embed/recopyfast.src.js:6496` on main, `:6516` on s70a; the served artifact carries it
   as `innerHTML="<span>"+N+"</span><span>by "+(i.created_by…`). A jsdom probe of both trees, with
   `created_by = '<img src=x onerror="window.__pwned=1">'`, creates an `<img>` inside
   `#rcf-edit-board-panel`. Of the embed's 30 HTML-sink statements, 26 are string literals, one is a
   constant icon map, and three are dynamic — all three in the Edit Board (table below).
2. **`created_by` is a staging invite's address, and a site admin chooses it unchecked.**
   `POST /api/edit-board/history` writes `p_created_by: authorEmail || "unknown"`
   (`src/app/api/edit-board/history/route.ts:245-250`), where `authorEmail` is the signed-in
   user's Supabase Auth email (`:193`, via `editor-access.ts:178`) or the staging invite's
   `email` (`:236`, `staging-access.ts:336-342`). `POST /api/staging/access` checks only that an
   invite has an email (`src/app/api/staging/access/route.ts:102-107`); `createStagingAccess`
   stores it verbatim through the admin's RLS client (`staging-access.ts:162-179`, `email:
   params.email || null` at `:166`) and the route returns the new row's `token` to the caller
   (`route.ts:242`).
3. **Verification needs no mailbox.** `authenticated` holds column SELECT on
   `staging_access.verification_code` and `token` (`20260925120000_sites_api_key_column_grants.sql:153-158`)
   under "Site admins can view staging access" (`20251230000000_staging_workflow.sql:109-118`), and
   table-level INSERT/UPDATE (`20251230000000:272`, never revoked) under the admin-only insert and
   update policies (`:120-129`, `:131-142`; the update policy has no `WITH CHECK`, so `USING` checks
   the new row). An admin can therefore (a) read the code and `POST /api/staging/verify` with it
   from their own browser, which binds their device (`staging-access.ts:444-458`); (b) write
   `email_verified`, `verified_user_agent_hash` and `verified_at` directly — the UA hash is an
   unkeyed `sha256("ua\0" + UA).slice(0, 32)` (`editor-crypto.ts:109-111,180-182`); (c) INSERT a row
   with a code of their choosing; or (d) PATCH `email` on an already-verified row. (c) and (d)
   bypass any route-level rule, which is why the database half is a separate story (see "Traps"
   and "Split proposal").
4. **Who can plant, who can be hit.** Only a site `admin` (the owner or a collaborator granted
   admin). `content_versions` is written by the service role only (`20260928140000:93-104`); every
   writer passes an email from Supabase Auth (GoTrue rejects `<`, section "Supabase Auth" below), the
   literal `"unknown"`, `user.id` (bulk import, `bulk/import/route.ts:192-196`), or a staging
   invite's email (history POST, restore `[versionId]/route.ts:277,304-307` →
   `restore_content_version` → `create_content_version(…, p_restored_by, 'Pre-restore snapshot',
   'restore')` at `20260924030000:274-276`, and `edit-board/styles/apply/route.ts:218-223`). The
   victim is whoever opens Edit Board → History **with a staging token**: the embed fetches history
   with `Authorization: Bearer ' + this.rcf.stagingToken` (`:6452-6454`), which is `null` on the
   owner's "Edit website" link (`rcf_edit_token`, `:76-77,948`), so for the owner the route answers
   401 (first-party access is cookie-only, `editor-access.ts:138-185`, and the cross-origin fetch
   sends none) and the tab renders "No versions saved yet". Victims are therefore staging-invite
   editors of that site (and an owner who opens a staging invite). No cross-site reach: rows and
   tokens are per site.
5. **What the payload reaches.** It runs on the customer's origin, inside the editor's tab: the
   edit-link credentials in `sessionStorage['rcf_edit_link:<site>']` (`:117-128`, ADR 036), a
   remembered editor grant in `localStorage['rcf_editor_grant:<site>']` (`:191`), every
   non-HttpOnly cookie and any app session the customer runs on that origin. The product's
   boundary — RecopyFast roles edit copy, never run code on a customer's domain (content is text,
   hrefs pass a scheme allowlist at `:3620-3627`) — is crossed by a role that should not cross it.

## Target story

`docs/stories.md` → `s72-edit-board-history-xss`. Nothing a response carries reaches the embed's
HTML as markup: a version's author, a restore's error and a restore's result are text. The invite
route refuses an address that is not an address. The "THE RULE" comment above `shouldSkipElement`
names its one exception (s70a review F4(a)). Ceilings go down, not up.

## Every HTML sink in the embed

`innerHTML` / `+=`, plus `outerHTML`, `insertAdjacentHTML`, `document.write`,
`createContextualFragment`, `DOMParser`: only `innerHTML` occurs. Scanned mechanically (each
statement's right-hand side parsed up to its `;`) and read by hand. Lines main / s70a.

| Line (main / s70a) | Sink | Right-hand side | Class |
|---|---|---|---|
| 1850, 1854, 1880, 1923, 1929, 1935, 1950, 1952, 1956, 1960 | verification UI buttons | `'<span>…</span>'` | static |
| 2003 | `svg.innerHTML` | `ICONS[name]`; `ICONS` is a const map of path literals (`:1983-1989`), `name` a literal at every caller | static (constant map) |
| 2323 | publish confirmation modal | four concatenated literals; the count goes in later by `textContent` (`:2363-2415`) | static |
| 2448 | staging error "← Go Back" | literal (the message itself is `textContent`, `:2444`) | static |
| 5624 / 5644, 5676 / 5696, 5761 / 5781 | AI "Generate" button | literals | static |
| 6114 / 6134 | Edit Board title | literal | static |
| 6183 / 6203, 6201 / 6221, 6213 / 6233, 6343 / 6363, 6466 / 6486 | Edit Board loading / empty / clear | literals | static |
| 6235 / 6255, 6477 / 6497 | `section.innerHTML +=` empty states | literal; the re-parsed subtree is a title set by `textContent` | static |
| 6401 / 6421 | language `<select>` placeholder | literal; options use `textContent` / `value` | static |
| **6496 / 6516** | **History card meta** | `dateStr` + **`version.created_by`** | **user-controlled (site admin)** |
| 6553 / 6573, 6577 / 6597 | restore loading / network error | literals | static |
| 6567 / 6587 | restore success | `result.elementsRestored` — the RPC returns `BOOLEAN` (`20260924030000:253`), so it prints "Restored true elements" | server-fixed (and wrong) |
| 6573 / 6593 | restore failure | `result.error` — every refusal of the restore POST is a fixed string (`[versionId]/route.ts:59,207,227,239,256,270,287,313,330`; limiter `rate-limit.ts:141,156`; `owner-can-edit.ts:117,127`) | server-fixed, fragile |

Jsdom probe, s70a and main: the History payload creates an `<img>`; a restore answered
`{error: '<b id="err-markup">denied</b>'}` creates `#err-markup`; a successful restore says
"Restored true elements".

## Every other path from an editor-controlled string to the DOM

- **Embed, text** (`textContent`, safe): editor and staging bar email (`:1508-1509`, `:2229-2231`,
  `title` as a property), verification email (`:1817`), Elements tab copy (`:6276`), language
  names (`:6366`, `:6408`), History `version_number` and `description || change_type` (`:6485`,
  `:6489` — `description` is free text from any staging editor with `edit`, `history/route.ts:166`;
  `change_type` has a CHECK, `20251230100000:69`), AI suggestions (`:5715`), every server error
  shown in a modal (`:1920`, `:2409`, `:2444`, `:5206`, `:5749`), `alert()` (`:4902`, `:5281`,
  `:5482`).
- **Embed, attributes and URLs** on the customer's page: `applyContentToElement` writes `href`
  only after a scheme allowlist (http, https, mailto, tel, relative; refuses `\`, `//`, control
  characters) and `alt` as an attribute (`:3611-3628`); text through `writeText` (`:744`); image
  copy through `img.src` (`:674-689`; `javascript:` in `img src` does not execute). The link field
  (`:5334`) and `style.backgroundImage` (`:5293`) are written unfiltered but only in the editor's
  own session, from their own input; the next load re-applies through the allowlist.
- **Dashboard**: React escapes text. `dangerouslySetInnerHTML` occurs five times: the theme script
  (`src/app/layout.tsx:127`, literal), the blog body (`src/app/blog/[slug]/page.tsx:96`,
  cron-generated, `sanitizeHTML` → DOMPurify), and three JSON-LD blocks with `<` escaped
  (`src/app/compare/page.tsx:269`, `src/components/compare/ComparisonPage.tsx:285,291`, compile-time
  data). None is editor-controlled. `created_by` renders as React text
  (`VersionTimelineItem.tsx:95`, `VersionPreviewDialog.tsx:106`). Invite errors render as text
  (`ShareSiteDialog.tsx:186-190`).
- **Email**: every interpolation into HTML goes through `escapeHtml` (`src/lib/email/resend.ts:163-166,187,219`, s68b).
- **Realtime**: the embed handles `content-update` (through `applyContentToElement`) and
  `auth-error` (→ `showStagingError`, `textContent`); nothing else (`:3058-3078`).
- **`staging_history.user_email`** (written from staging, device-grant and edit-session emails,
  `staging/publish/route.ts:184`, `staging/content/[siteId]/route.ts:316`) is rendered nowhere on
  main; s70b will render it as React text.

## Server writers of the author fields

| Field | Writer | Value | Who controls it |
|---|---|---|---|
| `content_versions.created_by` | `history` POST `:245-250` | auth email / staging email / `"unknown"` | site admin (staging email) |
| | restore `[versionId]` `:304-307` → `20260924030000:274-276` | same | same |
| | `styles/apply` `:218-223` | staging email / `"unknown"` | same |
| | `bulk/import` `:192-196,817-823` | `user.email ?? user.id` | Supabase Auth |
| `staging_history.user_email` | `staging/publish` `:184`, `staging/content` `:316` | access email / user id / kind | admin (staging), admin (`site_editors` via `editor/editors/route.ts:178`), Auth |
| `staging_access.email` | `staging/access` POST → `createStagingAccess` (RLS client) | request body | site admin; also PostgREST INSERT/UPDATE directly |
| `site_editors.email` | `editor/editors` POST `:178` | `isPlausibleEmail` | site admin |

No non-admin or anonymous path controls any of them: `content_versions` and `staging_history`
writes are service-role only (`20260928140000:93-104`); `staging_access` writes need an admin row;
an `edit` member's only free text is `description`, which is rendered as text.

## Supabase Auth would refuse a payload-shaped address

GoTrue's `validateEmail` (`supabase/auth` `internal/api/mail.go`) runs `checkmail.ValidateFormat`,
and `go.mod` pins `github.com/badoux/checkmail v0.0.0-20170203135005-d0a759655d62`, whose rule is
`` ^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$ ``
— no `<`, `>`, `"`, whitespace, and Go's `$` is end-of-text. (checkmail's current `master` is a
permissive RFC 5322 rule with `(?m)`; GoTrue does not use it.) Code-level reasoning against the
upstream sources on 2026-10-09; production's GoTrue build and any OAuth provider enabled in the
project's configuration (provider-supplied emails do not pass this check) were not verified. The
app itself calls no OAuth or admin user API (`grep` of `src/`).

## The project's own email rule accepts a payload

`isPlausibleEmail` (`src/lib/auth/editor-directory.ts:57-59`, `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`)
returns `true` for `<img/src/onerror=alert(1)>@x.co` and `<svg/onload=alert(1)>@x.co` (no
whitespace needed). It guards `editor/editors` POST (`:178`), `editor/request-code` (`:55`) and
`editor/submit-code` (`:67`). `staging/verify` (`:130`) and `teams/[teamId]/invitations` (`:150`)
carry the same shape inline. So a tightened rule belongs in that one function, not beside it.
Every address in the editor, staging, auth, websocket and e2e fixtures passes the WHATWG
"valid e-mail address" rule with a dotted domain (28 checked; the only misses are an `href`
fixture `mailto:hello@example.com` and a doc-comment placeholder `e2e-layout-<uuid>@example.com`).

## What a site admin can do to `staging_access` (migrations, replay view)

| Privilege | Source | Columns / rows |
|---|---|---|
| SELECT | column grant `20260925120000:145-158`; policy `20251230000000:109-118` | every column but `verified_user_agent_hash`, `verified_origin_hash` — **including `verification_code`, `verification_expires_at`, `token`** — on their sites' rows |
| INSERT | table grant `20251230000000:272`; policy `:120-129`; `link` rows refused by trigger `20260801100000:388-408` (deliberately not applied in production, `20260818000000:151-155`) | every column, their sites |
| UPDATE | table grant `:272`; policy `:131-142` (no `WITH CHECK`) | every column, their sites — `email`, `email_verified`, `verification_code`, `verified_*`, `token`, `permissions`, `expires_at` |
| DELETE / TRUNCATE / REFERENCES / TRIGGER | not granted by any migration; Supabase's platform defaults grant them to `anon`/`authenticated` on new public tables (as `20260928140000`'s header records for the content tables) | no DELETE policy, so RLS refuses deletes; TRUNCATE is not exposed by PostgREST. Not verified on production |

Can it be locked down without breaking invites? Application readers and writers through the
admin's RLS client: `createStagingAccess` INSERT + returning select (`staging-access.ts:162-179`),
`listStagingAccess` SELECT of `STAGING_ACCESS_USER_COLUMNS` incl. `token` (`:612-640`, `:33-34`),
`revokeStagingAccess` UPDATE of `is_active, revoked_at, revoked_by` (`:586-607`), the DELETE
route's `site_id` read (`route.ts:347-352`). Validate, verify and resend use the service role
(`:211,396,494,529`), as does `server/auth.js:251`. Therefore:

- Revoking SELECT on `verification_code` alone breaks nothing — and closes nothing: the admin can
  INSERT a code they chose (the app's own insert sends `verification_code`, so INSERT on it cannot
  be revoked while the insert runs on the RLS client), or UPDATE the binding columns.
- Revoking SELECT on `token` breaks `listStagingAccess` and the insert's returning select, and
  gains nothing against this attacker: the creating admin receives the token in the response by
  design, and ADR 034 (`:41-42`) chose to keep invitation/token fields readable.
- The effective version is the ADR 037 pattern for `staging_access`: create and revoke through the
  service role after the RLS admin read, revoke INSERT/UPDATE (and the platform defaults) from web
  roles, drop the code from the SELECT list, add the real-database privilege suite ADR 033
  requires, deploy code first. That is s69 R3 (and ADR 047 "Watch") — a database story with its
  own blast radius, not an embed fix. Split proposal below.

## Byte cost of the candidate fixes

Measured with the real `scripts/build-embed.mjs` on the s70a tree (a scratch copy with
`node_modules` linked; the unmodified copy rebuilt byte-identical to the committed artifact). Every
variant includes the F4(a) comment edit; deltas against 45840 / 33073 (bundle / widget, gzip).

| Variant | Measured | Δ | Note |
|---|---|---|---|
| F4(a) comment only | 45840–45842 / 33073–33074 (8 salts) | 0…+2 / 0…+1 | over the widget ceiling in 7 of 8 — confirms the s70a review |
| B: `cardMeta.textContent = dateStr + ' by ' + who` | 45836 / 33069 | −4 / −4 | one text node: the meta row's `gap: 8px` (`:5997-6004` main) no longer separates date and author |
| B2: same with " · " | 45840 / 33073 | 0 / 0 | |
| **G: `const by = createElement('span'); by.textContent = 'by ' + who; cardMeta.append(dateStr, by)`** | 45833–45837 / 33068–33070 (8 salts) | −3…−7 / −3…−5 | same two flex items as today (a text run is an anonymous flex item) |
| C: `innerHTML = '<span></span><span></span>'` + `firstChild`/`lastChild.textContent` | 45855 / 33088 | +15 / +15 | |
| D: as C, `lastChild.append(who)` | 45854 / 33087 | +14 / +14 | |
| E: two `createElement('span')` + `append` | 45847 / 33077 | +7 / +4 | |
| F: inline escape `replace(/[&<>"']/g, …)` | 45880 / 33112 | +40 / +39 | a helper is dearer still for one sink |
| G + R1 (restore error as text: empty `div`, then `firstChild.textContent`) | 45839 / 33074 | −1 / +1 | over |
| **G + R1 + R2 (success copy "Version restored")** | 45828–45829 / 33062–33064 (8 salts) | **−11…−12 / −9…−11** | recommended |
| B + R1 + R2 | 45831 / 33063 | −9 / −10 | |
| D + R0 + R2 (error always "Failed to restore") | 45833 / 33067 | −7 / −6 | drops the plan-ended message (402) |

Jsdom probe of G + R1 + R2: no `<img>`, the meta line is `#text` + `SPAN` with the payload as
literal text, the restore error is text, success reads "Version restored".

The banner hash moves gzip by ±2 B on any source edit (s70a review F3); the 8-salt ranges above are
that noise measured. The ceilings ratchet to whatever the rebased branch measures.

## Traps & constraints

- **Rebase first.** s70a (PR #75) edits the same file and sets the ceilings this story must stay
  under (45840 / 33073 in `scripts/build-embed.mjs:289-290` and
  `src/__tests__/embed/build-size-gate.test.ts:106-107` on s70a). Build on its merge, re-measure,
  ratchet down. While this research ran, another session was editing four s70a files (a migration,
  its test and two plans; no embed file) — the embed numbers above are unaffected, but re-measure
  after the rebase regardless.
- **Ceilings only go down.** The comment fix alone cannot ship (table). It ships inside a
  byte-negative edit of the same file.
- **s70a's surface test** asserts `panel.textContent` contains `by owner@example.com`
  (`embed-ui-not-content.test.ts:336` on s70a). G keeps that true; no test changes.
- **A flex container's text run is one item.** `cardMeta.append(dateStr, 'by ' + who)` (two
  strings) would merge into one item and lose the gap; G appends a string and an element.
- **Tightening `isPlausibleEmail`** also changes the three editor routes: an address with
  non-ASCII characters (allowed today) is refused, as Supabase Auth already refuses it. An
  existing editor row whose address fails the new rule could no longer request a code — a
  read-only count is the owner's precondition (expected 0: no users).
- **The route rule is advisory for an admin until the database story lands** (fact 3 (c), (d)).
  The embed fix is what makes stored values harmless, including any row written before the fix
  (no product path deletes a `content_versions` row short of deleting its site).
- **`styles/apply` is still routable** (`edit-board/styles/apply/route.ts`, s69 L6) and writes
  `created_by` from the staging email; the embed no longer calls it, but it is one more writer the
  embed fix covers.
- **jsdom does not fire `onerror`** on an image; tests assert that no element is created, which is
  the property, plus a sentinel global that a fired handler would set.
- Do not run `next dev` (it appends to `AGENTS.md`).

## Observations, not in scope

- The owner's "Edit website" link (edit session) gets 401 from `GET /api/edit-board/history`
  (`stagingToken` is null), so History is always empty for the owner in the embed. Functional
  defect, unrelated to the XSS.
- `public/embed/__fidelity__/index.html:380-403` loads `?widget=<url>` as a script on the app's
  origin; tracked as s69 L8. Whether production's CSP reaches that static file was not verified.
- s69 L15 is this finding at older line numbers (`:6157`, `:6234`); s72 closes it.

## Open questions (for the owner, with recommendations in the plan)

1. Fold the restore panel's two dynamic sinks (R1) and the "Restored true elements" copy (R2) into
   s72? R1 does not fit the budget without R2.
2. Tighten the shared `isPlausibleEmail` (all four routes) or add a staging-only rule?
3. The `staging_access` lockdown: separate story (proposed `s72b`) or in s72?
4. Run the read-only production count of payload-shaped stored values before ship?

## Real complexity

2. One embed function and one comment, two new jsdom suites, one route rule and one helper, a
ratchet. No migration, no `server/` change, no UI design (the History row looks the same).

## Split proposal

`s72b-staging-invite-writes` (complexity 3, backlog stub): `staging_access` writes through the
service role after the RLS admin read (ADR 037), web-role INSERT/UPDATE and default privileges
revoked, `verification_code` dropped from the authenticated SELECT list, real-database privilege
suite (ADR 033), code-first deploy. Absorbs s69 R3. Alternative for the owner to weigh: retire
staging invites altogether, since `site_editors` is the access model (s66c1).
