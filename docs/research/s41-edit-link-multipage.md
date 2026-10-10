# Research — Story s41-edit-link-multipage

Date: 2026-09-25. Base: `fb28a8b` (origin/main). Operator-prevalidated scope from hands-on
testing. `docs/reviews/stories.md:263` still ends `Stories ready: no` (the 2026-08 backlog
review); s33–s40 proceeded under the same operator prevalidation, and this story does too.
Every line number below is in `public/embed/recopyfast.src.js` at `fb28a8b` unless another
file is named.

## The five structuring facts

1. **The edit-link credential lives in page memory only, so every load after the first is a
   visitor load.** Read at boot (`:83-93`), stripped from the address bar (`:97-105`), and kept on
   the instance (`:866-868`). Nothing writes it to storage. With a clean URL, `init()` sets
   `editMode = false` (`:892-896`). That covers internal links, a plain reload of the first page,
   and Edit Board's own "restore version" reload (`restoreVersion`, `:6239`). Invited editors are
   not affected: their device grant is stored (`writeStored`, `:210-220`: localStorage when
   remembered, sessionStorage otherwise).
2. **The server re-checks both credentials on every load and every write, so a stored copy
   cannot outlive its server lifetime.** An edit session needs `is_active`, `expires_at ≥ now`
   and a matching `site_id` (`src/lib/auth/editor-access.ts:416-431`). It lasts at most 24 hours in
   absolute terms (`src/lib/auth/edit-sessions.ts:50`), and the dashboard mints 2 hours
   (`EditWebsiteButton.tsx:75`). A staging token needs the same three checks
   (`staging-access.ts:186-193`), plus UA-bound email verification with a 12-hour TTL
   (`:266-286`, `staging-device.ts:73`). **Neither is bound to an origin. An edit session is not
   bound to a device either** (`edit-sessions.ts:44-49`). That is why the story uses sessionStorage,
   one tab only, and never localStorage.
3. **No test and no ADR forbids persisting these tokens, but the security direction runs against
   carrying them loosely.** The A-29 `test.failing` cases in
   `src/__tests__/api/edit-sessions/create-token-leak.test.ts:139-191` say the token should not be
   in `editUrl` at all. ADR 025 (`:101-106`) calls `rcf_token` "the pattern this story must not
   copy". The 2FA migration header (`20260801100000_editor_access_2fa.sql:30`) says "the entry URL
   carries no secret". s41 does not reverse any of these, but it stretches the client-side life of
   an unbound bearer token from one page to one tab. That calls for a new ADR, not a silent change
   (see Traps §1).
4. **The widget already has the hooks for clearing the token, except one.** `/staging/validate`
   answers 401 for every refusal (`validate/route.ts:47-58`) and 500 for an outage (`:73-78`). The
   B-19 terminal handler already filters 401/403 on writes (`:1137-1138`). **There is no
   exit/Done control for edit-link holders.** The staging banner offers Preview Live, Edit Board
   and Publish (`:2256-2290`). The editor bar's Done (`:1414-1418`) is grant-only (`:1272`) and
   deliberately signs nobody out. One trap: Preview Live calls `window.open(url, '_blank')` with
   no `noopener` (`:2288`). Per the HTML spec and MDN, that copies the opener tab's
   sessionStorage, so once s41 lands the "live" preview would open in staging mode.
5. **The fix costs about 130 gz, and the budget has 0 headroom once s39 and s40 land, so s41 has
   to pay for itself. The payment exists.** Measured with the gate's own method, the fix is
   +128 / +129 (bundle / widget) on s39's tip and +133 / +135 on `main`. Two pieces of dead code
   cover it:
   - `showEmailCaptureUI` and its branch (`:992-995`, `:1656-1772`) are unreachable. No server
     path has returned `requiresEmail: true` since `747d210` (2026-08-01). Removing them saves
     −399 / −396.
   - `escapeHtml` (`:117-122`) has no caller. Removing it saves −27 / −28.

   Net on s39: **45,920 / 33,170, which is −306 / −295** against s39's ceilings of 46,226 / 33,465.

## Target story

`docs/stories.md` § s41-edit-link-multipage. An owner who follows **Edit website**, or anyone who
follows a **Share Preview Link**, stays in edit mode (plus staging mode for share links) while
navigating the site. This covers full page loads in the same tab on the same origin, and lasts
until the token expires, the server refuses it, or the tab closes. A new tab opened without the
token stays a visitor tab (accepted, and stated). SPA client-side routing is out of scope.

## Current state of the code

| Surface | Where | What it does today |
|---|---|---|
| Owner edit link | `src/app/api/edit-sessions/create/route.ts:121` | `editUrl = https://${domain}?rcf_edit_token=${token}` |
| | `src/components/dashboard/EditWebsiteButton.tsx:72-95` | mints a 2 h session (`:75`), falls back to the same URL shape (`:86-88`), `window.open(editUrl, "_blank")` (`:94`). recopyfast.com → customer origin is cross-origin, so no sessionStorage is copied |
| Share Preview Link | `src/components/dashboard/ShareSiteDialog.tsx:159-170` | `?rcf_staging=1&rcf_token=${link.token \|\| link.id}` copied to the clipboard; the server builds the same shape (`src/lib/auth/staging-access.ts:592-597`) |
| Widget read | `recopyfast.src.js:83-93` | `STAGING_MODE`, `STAGING_TOKEN`, `EDIT_SESSION_TOKEN`, `EDITOR_MODE` from `location.search` |
| Widget strip | `:97-105` | `history.replaceState` removes the three params. Pinned by `handoff-roundtrip.test.ts:282` |
| Instance | `:866-868` | `stagingMode = EDITOR_MODE`, tokens on `this.stagingToken` / `this.editSessionToken`, readable by any page script through `window.ReCopyFast` (`:6252`) |
| Boot | `:892-896` → `initStagingMode` `:955-1021` | a token means `POST /staging/validate`. `!result.valid` shows the "Invalid or expired staging link." modal (`:987-990`), and the token never leaves memory |
| Requests | `editorTokenQuery` `:1226-1230`, `editorTokenBody` `:1233-1239` | content reads, writes and publish carry the token in the query or body; the grant goes in a header instead |
| A/B | `:921` | the A/B pipeline is skipped in staging mode, so today the editor is bucketed and counted as a visitor on page 2 onward |
| Grant (unaffected) | `createEditorAuthClient` `:155-543`, key `rcf_editor_grant:<siteId>` `:166` | stored, validated and rotated. The model to mirror for storage exception handling (`safeGet` / `safeSet` / `safeRemove`, `:181-192`) |
| Existing sessionStorage use | `keepDraft` `:1142-1146` | `rcf_unsaved_draft:<SITE_ID>:<id>`, try/catch. Precedent for key shape |

## Anchor points

- **Persist and restore:** right after the strip block (`:97-105`) and before `EDITOR_MODE` is
  computed. `EDITOR_MODE` must move below the restore; the strip must stay conditioned on the
  URL values, as today.
- **Clear on server refusal:** in `initStagingMode`, inside `if (!result.valid)` (`:987`), only
  when `response.status` is 401 or 403, never on 5xx or a network failure. Also clear in
  `handleTerminalWriteFailure` right after the 401/403 filter (`:1138`).
- **Preview Live:** `:2284-2289` needs a third argument, `'noopener'`.
- **Byte payment:** delete `:992-995` (`if (result.requiresEmail)`), `showEmailCaptureUI`
  (`:1656` up to `showVerificationUI` at `:1774`), and `escapeHtml` (`:116-122`). Then ratchet
  `scripts/build-embed.mjs:110-111` and `src/__tests__/embed/build-size-gate.test.ts`
  (`SEEDED_MAX_*`).

## Verified APIs / functions

- `validateEditorAccess({ siteId, token, allowUnverified, device, deviceContext })`,
  `src/lib/auth/editor-access.ts:236`. Edit sessions go through `validateEditSessionAccess`
  (`:416-457`), which checks `is_active`, `expires_at` and `site_id` and does no IP, device or
  origin check. Staging tokens go through `validateStagingEditorAccess` (`:357-414`), then
  `StagingAccessManager.validateStagingAccess(token, siteId, device)` (`staging-access.ts:176`).
- `POST /api/staging/validate`, `src/app/api/staging/validate/route.ts`. It has no rate limiter
  and uses public CORS. Invalid returns `{ valid:false, error }` with `result.status || 401`
  (`:47-58`). A missing token or siteId returns 400 (`:19-35`). An exception returns 500 with
  `{ error }` and no `valid` key (`:73-78`). Today the widget reads that 500 as `!result.valid`
  and shows "Invalid or expired" (pre-existing wording).
- Every write re-validates: `validateEditorTokenFromRequest` in
  `src/app/api/staging/content/[siteId]/route.ts:54,221` and `src/app/api/staging/publish/route.ts:103,267`.
- Revocation: `EditSessionManager.revokeEditSession` (`edit-sessions.ts:198-230`) sets
  `is_active=false`. `DELETE /api/staging/access?accessId=` is wired to ShareSiteDialog's revoke
  (`ShareSiteDialog.tsx:172-184`).
- Lifetimes: edit session default 2 h, maximum 24 h, absolute 24 h including extend
  (`edit-sessions.ts:50-54`). Staging access up to 30 days (`staging-access.ts:72`), with its
  verification trusted for 12 h per device (`staging-device.ts:73`).
- `requiresEmail`: declared (`staging-access.ts:59`, `editor-access.ts:58`) and forwarded
  (`editor-access.ts:382-401`, `validate/route.ts:68`), but never set to `true`. `git log -S`
  shows the last `requiresEmail: true` was removed in `747d210`, when link-without-email rows
  became `valid:false` (`staging-access.ts:212-222`). No test pins that property today.
- No `pushState` or `popstate` / `hashchange` handling exists (0 matches). `setupMutationObserver`
  (`:3695-3719`) rescans added nodes.

## Premise verification

| Claim in the brief | Verdict |
|---|---|
| `create/route.ts ~:121` puts the token in `editUrl` | **True**, `:121` |
| `EditWebsiteButton.tsx ~:88` | **True**, `:86-88` (fallback), opened at `:94` |
| `ShareSiteDialog.tsx ~:163` | **True**, `:163` (Copy link). The create path copies the server's `data.stagingUrl` (`:138-139`) in the same shape |
| Widget reads at ~:84-93 | **True**, `:83-93` |
| Strips at ~:96-105 | **True**, `:97-105` |
| Never stores it | **True.** No storage write of either token anywhere. It lives on the instance (`:866-868`) for one page |
| Clean URL → `editMode=false` (~:892-895) | **True**, `:892-896` |
| Invited editors unaffected (~:205-217) | **True**, `writeStored` `:210-220` (`remembered` → local, else session) |
| **Understated:** "every page except the first" | A **reload of the first page** also drops edit mode, and so does Edit Board's restore-version reload (`:6239`). The finding is broader than internal links |
| SPA: "saved content for the new route is never loaded" | **True.** `hydrateStoredContent` runs once from `init` (`:918`); no route hook exists |
| SPA: "reused React nodes keep a stale `data-rcf-id`/path" | **Half true.** The id is recomputed on every rescan from the current path (`:2643-2644`). What goes stale is `elementData.path`, inherited from the previously stamped entry (`:2642`), which becomes `page_path` on save (`:3088`) |
| SPA fix +70 gz lean / +198 gz full | **Not re-measured** (no implementation to measure). Out of scope, with precedent: stories.md:1241 (s27) already defers SPA routing |

Verdict: **the premise holds.** It is repaired only by widening it to include reloads.

## Traps & constraints

1. **Deliberate-security check, stated plainly.** No test asserts the edit or staging token is
   "never persisted", and no ADR decides that. The nearest decisions are:
   - A-29 (`create-token-leak.test.ts`, three `test.failing`): the token should not be in the URL
     at all. The test comment says the only thing that retires a leaked token is elapsed time.
   - ADR 025 rejected accepting the grant "as a query parameter, like `rcf_token`".
   - The 2FA migration moved invited editors to origin- and UA-pinned grants so that the entry URL
     carries no secret.

   s41 keeps the URL strip and adds no URL. What it widens is where an **unbound** bearer token
   sits on the client:
   - Before: one page's memory (already exposed on `window.ReCopyFast`).
   - After: that tab's sessionStorage. Every page script sees it on every page of the tab.
     Chrome and Firefox keep sessionStorage in session-restore data on disk. Duplicate Tab and
     `window.open` without `noopener` copy it.

   The bound is still the server lifetime: at most 24 h for an edit session; for staging, up to
   30 days of row life behind a 12 h per-device verification. **This is a product-security trade
   the operator is accepting by directive. Record it in an ADR** (next free number; s40 plans 035,
   so expect 036), with the rejected options below, so a later reader cannot "tighten" it back into
   the bug or "loosen" it into localStorage.
   - **localStorage:** survives restarts and spreads to every tab; no device binding makes that a
     shared-computer credential.
   - **A cookie on the customer's origin:** sent to their server on every request, where it lands
     in their logs, and JS cannot make it httpOnly.
   - **Re-appending the token to internal links:** puts it back into history, Referer and logs,
     which is exactly A-29.
   - **Converting the owner link into a device grant via handoff:** the principled A-29
     direction, but owners are not `site_editors` rows and share links would still need this; a
     separate, larger story.
2. **Preview Live would silently turn into a staging preview** (`:2288`, no `noopener`). Add
   `'noopener'`. The `searchParams.delete` calls there are already no-ops, since the boot strip
   removed those params, so the line can shrink to `window.open(location.href, '_blank',
   'noopener')`: −12 / −11 gz, optional.
3. **Orphan `rcf_token`.** `editor-grant-requests.test.ts:330-345` pins that a bare `?rcf_token=`
   (no `rcf_staging=1`) never reaches a public read. Persist only when the URL itself establishes
   `EDITOR_MODE` (`(STAGING_MODE && STAGING_TOKEN) || EDIT_SESSION_TOKEN`), and store the staging
   token only when `STAGING_MODE` holds.
4. **Clear on 401/403 only.** A 500 or a network error is our outage. Clearing on it would sign
   an editor out mid-session, the same reasoning the grant client writes down at `:309-313`.
   Because a stored token was validated on page 1, a 401 on page N means it expired or was
   revoked. Keep the existing modal (0 bytes) so the editor learns why editing stopped; its
   "Go Back" (`:2435-2439`) then reloads into visitor mode because the key is gone.
5. **Non-negotiable #4.** Touching `window.sessionStorage` itself throws when site data is
   blocked. Every read, write and remove goes inside try/catch, including the identifier access.
   A corrupt or host-written value (`"abc"`, `{}`, invalid JSON) may only degrade: a bad token
   meets a 401 and is cleared. Only same-origin script can write the key, and it already owns
   the page.
6. **Key per `SITE_ID`**, e.g. `rcf_edit_link:<SITE_ID>`, beside `rcf_unsaved_draft:<SITE_ID>:…`.
   Two widgets on one origin must not share a session. A token in the URL always overwrites the
   stored one (a new link wins).
7. **Test isolation.** jsdom sessionStorage survives across tests in a file. Six embed suites
   never clear it (`ab-bucketing-parity`, `build-size-gate`, `edit-board-tabs`, `editor-auth`,
   `element-id-page-scope`, `site-token-refusal`), but none of them boots through a token, so none
   writes the key. The suites that boot with tokens (`content-attributes`, `editor-grant-requests`,
   `handoff-roundtrip`, `editor-terminal-session`) all clear sessionStorage in `beforeEach`. The
   prototype confirms this: **all 164 existing embed tests pass** on the prototype (scratch run,
   14/14 suites, 168/168 including four probe tests; `staging-token-device.test.ts` 10/10).
8. **E2E semantics shift, count unchanged.** In `e2e/share-edit-publish.spec.ts:298-307`, the
   same `page` does `page.goto(TARGET_URL)` under a comment reading "A plain visitor load". For
   the invited-editor flow that load was already a grant-holder load, because the grant is
   stored. After s41 the edit-session flow behaves the same way. The assertions (same
   `data-rcf-id`, published text) still hold, because staging reads fall back to published after
   publish; that is why the grant flow passes today. Do not add a spec (44 contract). If the
   comment is corrected, say so in the PR.
9. **The byte gate is exact-fit.**
   - s39 (PR #37) ratchets to 46,226 / 33,465, its measured size.
   - s40's plan T7 ratchets again to its own measurement (about −53 / −48), leaving 0 headroom.
   - s41 must be net ≤ 0 on both numbers after rebasing on whatever has merged, and then ratchet
     down to its own measurement.

   Gzip deltas drift a few bytes with context: the feature measured +133 / +135 on `main` against
   +128 / +129 on s39. Re-measure after the rebase, and do not reuse these numbers.
10. **Merge surface.** s39 changes the editor bar and CSS literals; s40 changes the AI suggest
    fetch (it adds `editorTokenBody()`, so AI suggest on page N also works once s41 restores the
    token). Neither touches `:83-105`, `initStagingMode` or the staging banner. `docs/stories.md`
    gets appended by s39, s40 and s41, so expect a trivial tail conflict.
11. **Adjacent and out of scope:** the dashboard Content page's Edit link
    (`src/app/dashboard/content/page.tsx:427`) is `?rcf_staging=1&rcf_edit=<id>` with no token.
    The widget never reads `rcf_edit`, so the link does nothing today. Record it; do not fix it here.

## Measurements (gate method: `scripts/build-embed.mjs`, Node `zlib.gzipSync` level 9)

Scratch copies (`git archive` of each base, node_modules symlinked, `node scripts/build-embed.mjs`).
Baselines reproduce exactly: `main` 46,635 / 33,860, s39 `0cf43f4` 46,226 / 33,465. The
prototype is the credential-only JSON design described under Anchor points.

| Change | on `main` (bundle / widget) | on s39 (bundle / widget) |
|---|---|---|
| s41 feature (persist + restore + 2 clears + noopener) | +133 / +135 | +128 / +129 |
| Alt: store the raw query string and re-parse it | +114 / +116 | +111 / +110 |
| Remove dead `showEmailCaptureUI` + `requiresEmail` branch | — | −399 / −396 |
| Remove unused `escapeHtml` | — | −27 / −28 |
| Preview Live param deletes, which are already no-ops (optional) | — | −12 / −11 |
| **Feature + both dead-code removals** | **46,336 / 33,571 (−299 / −289)** | **45,920 / 33,170 (−306 / −295)** |

The raw-query alternative saves about 18 gz but stores unrelated params (utm, a spent
`rcf_handoff`). The credential-only design is recommended; the savings cover it with room to spare.

## Open questions

1. **Exit control.** None exists for edit-link holders. The recommendation is to add none in s41
   (bytes, scope): closing the tab ends the session, and Preview Live shows the visitor view. If
   the operator wants an explicit "Stop editing", it is a follow-up, costed like s39's control
   (about +56 gz).
2. **Stale token on page N.** Should the modal show at all? The recommendation is to keep the
   existing "Invalid or expired staging link." modal. It tells the editor why editing stopped.
   Its wording ("link") is slightly off for a click-through, and rewording costs bytes.
3. **Session restore.** Chrome and Firefox restore sessionStorage with a restored tab; browser
   behaviour here is not uniform and was not measured. The server lifetime still bounds it. The
   ADR should state this as accepted.
4. **The live proof needs production access** (owner dashboard, a multi-page customer site with
   the snippet installed, a share link). None was used here. The acceptance criterion is proven
   after deploy by the operator or `/ks-ship`.

## Real complexity

The brief gives no prior score. **3.** The code change is small: about 25 source lines, two
deletions, one argument, tests in one new jsdom suite plus two extended ones. What raises it
above 2:

- a security trade that needs an ADR;
- a byte gate at exact fit that must be paid for in-branch;
- a trap (Preview Live) that ships a regression if missed;
- a live-production proof across page loads.

No split is needed.
