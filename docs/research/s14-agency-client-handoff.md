# Research — Story s14-agency-client-handoff

> ⚠️ **BACKLOG WARNING, recorded before anything else.** `docs/reviews/stories.md` ends
> `Max severity: major` / `Stories ready: no`. The operator confirmed proceeding anyway.
> Six major findings are open against `docs/stories.md`, one of which (**M5**) is against
> this story. Everything below is written on a backlog that has not passed review.

> **FALSE PREMISE — read this before anything else.**
>
> `stories.md:722` says *"The single-site version works"* and names
> `/api/editor/*`, `rcf_handoff`, `SiteEditorsCard` and `handoff-roundtrip.test.ts` as the
> evidence. **That is false in the only sense that matters: an editor invited through the
> grant model can sign in and cannot edit.** The device grant proves identity to
> `/api/editor/*` and authorizes nothing else. The widget says so, out loud, on every
> customer's live page:
>
> ```js
> // public/embed/recopyfast.src.js:1130-1131
> note.textContent = '— in-page editing isn’t enabled for this site yet.';
> note.title = 'Your sign-in is recognised. The content API does not yet accept editor device grants.';
> ```
>
> This text is in the shipped artifact too (`public/embed/recopyfast.js:49`), so it is live.
> The widget's own comment states the rule (`recopyfast.src.js:1010-1017`): *"it does not turn
> on `editMode`… the content and publish endpoints authenticate through
> `validateEditorTokenFromRequest`, which knows staging tokens and edit-session tokens only."*
> Verified: `validateDeviceGrant` has exactly one caller in the whole app,
> `src/app/api/editor/validate-grant/route.ts:51`, plus its own internal use in
> `refreshDeviceGrant` (`editor-grants.ts:405`). No write path calls it.
>
> **What actually works end-to-end today is a different credential**: the `staging_access`
> token path (`ShareButton` → `ShareSiteDialog` → `POST /api/staging/access` → a
> `?rcf_staging=1&rcf_token=…` URL the owner copies and delivers by hand). Both systems are
> per-site and expiring, so both satisfy the grants-not-roles constraint — but they are two
> different tables, two different dashboard cards, and two different second factors, and s14
> names the one that cannot write.
>
> **Consequence for scope:** s14 as written silently contains "make the grant model a
> principal on the content write path". That is not a detail of a permissions story; it is a
> new authorization principal on the highest-consequence surface in the product, and it is why
> the complexity re-scores to **5**.

---

## The five structuring facts

1. **The grant authorizes nothing.** `public/embed/recopyfast.src.js:1130` ships
   *"in-page editing isn't enabled for this site yet"* to every grant holder, because
   `src/lib/auth/editor-access.ts:166-197` (`extractEditorToken`) recognises only `rcf_token`,
   `rcf_edit_token` and `Bearer` — never a `rcfg1…` grant.
2. **Revocation over HTTP is already immediate, on all three credentials.** Every validation
   re-reads durable state per request: `editor-grants.ts:344` (`editor.revoked_at` →
   `editor_revoked`), `staging-access.ts:182` (`.eq("is_active", true)`),
   `editor-access.ts:296-300` (`edit_sessions.is_active` + `expires_at`).
3. **The socket defect is real, is in `server/`, and is not deployed.** `server/index.js:401`
   caches `stagingPermissions` at handshake; `:527` reuses that cache per message; `:548-554`
   writes `content_elements` directly over the socket — which also violates ADR 004 rule 1.
4. **The only per-edit record that can name a non-account editor is `staging_history.user_email`**
   (`supabase/migrations/20251230000000_staging_workflow.sql:87`, written at
   `src/app/api/staging/content/[siteId]/route.ts:247-256`). It has no `site_id`, no
   `created_at` index, and **zero readers** in `src/`.
5. **Seats are counted per site, not per account.** `src/lib/feature-gating/permissions.ts:228-256`
   (`countOccupiedSeats`) sums `site_permissions` + `site_editors` for **one** `siteId`, charged
   to that site's owner — so "invite to several sites at once" is N independent quota checks with
   no shared transaction.

---

## Target story

`docs/stories.md:695-740`. Complexity as written: **4**. Dependencies as written: `s13-agency-plan`,
`s03-activation-funnel`.

**As a** web agency **I want** to invite each client to edit only their own site in one action
**so that** I can stop being the person who changes their phone number.

### Acceptance criteria, with a verdict on each against today's code

| # | Criterion (abridged) | State today |
|---|---|---|
| 1 | Invite an editor to a specific site by email, from that site's view, in one action | **Partial.** `SiteEditorsCard` (`SiteDetailView.tsx:228`) is one action and sends no mail; the editor must be told out-of-band to visit `/edit`. The staging path (`ShareSiteDialog`) emails a code but returns the *URL* to the owner to deliver by hand (`api/staging/access/route.ts:160-199`). Neither is "one action" end to end. |
| 2 | The invited editor can edit only that site; other sites refused | **Enforced, but vacuous.** `site_editors.site_id`, `validateDeviceGrant` site pin (`editor-grants.ts:245,346`), handoff site pin (`editor-handoff.ts:118`). Vacuous because the editor cannot edit *any* site by grant. |
| 3 | Invite to several sites at once, each an independently scoped grant | **Absent.** `upsertSiteEditor` is one `(site_id, email)` row per call; no batch route, no batch UI. |
| 4 | Revocation effective next request, **including over an established WebSocket** | **HTTP half: already true** (fact 2). **Socket half: untestable — no WebSocket service is deployed.** See the M5 section. |
| 5 | Grants expire on schedule, enforced server-side | **True.** 7d remembered / 12h session (`editor-grants.ts:39,47`), checked offline from the signed payload (`:241`) and again against the row (`:327`). Staging: ≤ 30 days (`staging-access.ts:63`). Edit sessions: 24h absolute ceiling (`edit-sessions.ts:50`). |
| 6 | Per site, the agency sees who holds a grant and when each expires | **Partial.** `listSiteEditors` returns email, permissions, `revokedAt`, `activeDevices` (`editor-directory.ts:215-261`) — but **not** each device grant's `expires_at`. `SiteEditorRow` renders no expiry. |
| 7 | One view lists recent edits across all the agency's sites (site, editor, element) | **Absent, and its named source does not exist.** No `account_milestones` table (grep over all 43 migrations). See fact 4 for what does exist. |
| 8 | Expired/revoked link shows a clear message and a way to request a new one | **Partial.** `needs-code` → `showEditorCodeUI()` (`recopyfast.src.js:1040,1160`) is correct. `hidden` (editor revoked) shows **nothing at all** — deliberate, to avoid confirming the address (`recopyfast.src.js:1044-1049`), which directly conflicts with "shows a clear message". |
| 9 | The invite flow does not reveal whether an email already has an account | **Already true by construction.** `site_editors` is keyed by email and never touches `auth.users`; `/api/editor/request-code` is neutral in body *and* timing (`route.ts:43-46`, work deferred to `after()` at `:115`). |

---

## Current state of the code

### Two parallel invited-editor systems, both live in the same dashboard

**A. `site_editors` + device grants — the model s14 names.**

- Dashboard: `SiteEditorsCard` → `InviteEditorForm` → `POST /api/editor/editors`
  (rendered at `SiteDetailView.tsx:228`, reached from `src/app/dashboard/sites/page.tsx:250`).
- Editor: `/edit` → `EditorSignIn.tsx` → `request-code` → `submit-code` → site list →
  `handoff/create` → redirect carrying `?rcf_handoff=` → widget redeems into a device grant
  (`recopyfast.src.js:279-287`).
- Entry URL carries **no secret**. That was the entire point of migration
  `20260801100000_editor_access_2fa.sql` (its header, lines 4-40).
- **Cannot write content.** The false premise above.

**B. `staging_access` — the model that actually works.**

- Dashboard: `ShareButton` (`SiteDetailView.tsx:146`, `SiteCard.tsx:186`) → `ShareSiteDialog` →
  `POST /api/staging/access` with `type: "invite"`.
- The route emails only the 6-digit **code** (`route.ts:160-178`) and returns `stagingUrl` and
  `token` to the owner (`:198-199`) to deliver out of band.
- Recipient opens `?rcf_staging=1&rcf_token=…`; widget strips the params (`recopyfast.src.js:91-99`),
  validates at `/staging/validate`, verifies email in place, binds to the device
  (`staging-access.ts:257-277`), then `editMode = true` (`recopyfast.src.js:994`).
- Writes: `PUT /api/staging/content/:siteId` → `authorizeFirstPartyEditorAccess` first
  (`route.ts:140`), else `validateEditorTokenFromRequest` (`:161`). Publish:
  `/api/staging/publish` (same two-branch shape at `:55`/`:76`).
- Revoke: `DELETE /api/staging/access?accessId=` → `revokeStagingAccess` → `is_active=false`.
- Anonymous "anyone with link" is dead at three layers: the dialog, `createStagingAccess`
  (`staging-access.ts:91-95`), and a database trigger (`20260801100000…sql:388-408`).

**C. `edit_sessions` — the owner's own "Edit Website" button.** `EditWebsiteButton` →
`POST /api/edit-sessions/create` → `?rcf_edit_token=…`. No origin binding, no device binding,
IP checked but never enforced (`edit-sessions.ts:160-170`); a 24h absolute ceiling is the only
thing that retires a leaked `editUrl` (`edit-sessions.ts:39-50`). `POST /api/edit-sessions/revoke`
exists and is session-authorized, authorizing by a `user_id` filter inside
`revokeEditSession` (`edit-sessions.ts:212-218`).

### Cross-site surfaces

There is **no owner-facing cross-site query of any kind** in `src/lib/auth/`. `listSiteEditors`
takes one `siteId`; `listSitesForEditor` is the editor-facing hub query and is keyed by the
editor's email, not by an account. Building AC 6/AC 7 across "the agency's sites" means a new
read that walks `site_permissions` (admin rows) → sites → editors, and there is no existing
helper for it.

### Tables

`site_editors` · `editor_verification_codes` · `editor_device_grants` · `editor_handoffs`
(all in `20260801100000_editor_access_2fa.sql`) · `staging_access` · `staging_history` ·
`edit_sessions` · `site_permissions`.

RLS: `site_editors` admin-only SELECT/INSERT/UPDATE + service-role ALL (`:108-136`);
`editor_verification_codes` and `editor_handoffs` are **service-role only** (`:188-194`, `:320-326`);
`editor_device_grants` admins may SELECT/UPDATE via the parent join (`:254-285`).

`20260813140000_site_permissions_delete_per_row.sql` narrowed the DELETE policy to
`user_id IS NOT NULL AND granted_by IS NOT NULL AND user_has_site_permission(site_id, ['admin'])` —
per-row, so no admin can wipe the creator over PostgREST.

---

## Anchor points

| Concern | File:line |
|---|---|
| Editor token extraction (the place a grant would become a principal) | `src/lib/auth/editor-access.ts:166-197` |
| Token validation fan-out | `src/lib/auth/editor-access.ts:199-226` |
| First-party (owner) branch | `src/lib/auth/editor-access.ts:118-164` |
| Content write, token branch | `src/app/api/staging/content/[siteId]/route.ts:161` |
| Publish, token branch | `src/app/api/staging/publish/route.ts:76`, `:175` |
| Grant validation (revocation chokepoint) | `src/lib/auth/editor-grants.ts:226-386` |
| Editor revocation + grant sweep | `src/lib/auth/editor-directory.ts:183-212` |
| Invite / list / revoke route | `src/app/api/editor/editors/route.ts` |
| Seat quota | `src/app/api/editor/editors/route.ts:165-180` → `permissions.ts:188-256` |
| Widget identity boot (does **not** set `editMode`) | `public/embed/recopyfast.src.js:1019-1050` |
| Widget banner claiming editing is off | `public/embed/recopyfast.src.js:1128-1132` |
| Per-edit record carrying a non-account identity | `src/app/api/staging/content/[siteId]/route.ts:247-256` |
| Socket handshake caches permissions | `server/index.js:386-405`, reused `:527` |
| Socket writes content directly | `server/index.js:541-586` |
| Dashboard card (site view) | `src/components/dashboard/SiteEditorsCard.tsx`, `SiteEditorRow.tsx` |
| Editor hub | `src/app/edit/EditorSignIn.tsx`, `src/app/edit/page.tsx` |

---

## Verified APIs / functions

**`/api/editor/*`** — all read against code, not memory.

| Route | Auth | CORS | Rate limit |
|---|---|---|---|
| `POST request-code` | none (public) | `*` (`public-cors.ts:33`) | per email+site **and** per IP, both `onStoreFailure: "deny"` (`editor-request.ts:104-127`) |
| `POST submit-code` | the emailed code | `*` | per address **and** per IP, both deny (`editor-request.ts:137-160`) |
| `POST handoff/create` | hub cookie `rcf_editor_hub`, httpOnly/Lax (`editor-hub-session.ts:69-83`) | **none, deliberately** (route header) | none |
| `POST handoff/redeem` | the 60s handoff code + `originBelongsToSite` | `*` | IP, `onStoreFailure: "allow"` |
| `POST validate-grant` | the grant itself | `*` | IP, allow |
| `POST refresh-grant` | the grant itself | `*` | IP, allow |
| `GET/POST/DELETE editors` | Supabase session + `site_permissions.permission === 'admin'` (`route.ts:37-69`) | none | POST only: per-user deny |
| `GET sites` | hub cookie | none | none |

**`/api/edit-sessions/*`** — `create` (session + per-user deny limiter), `validate` (public CORS,
token), `extend` (public CORS; slides inside a fixed 24h ceiling, `route.ts:106-128`), `revoke`
(session, same-origin, no CORS — stated in its header), `active` (session).

**Key functions.**

- `issueDeviceGrant` (`editor-grants.ts:153`) — inserts a `pending:` placeholder row, signs a token
  naming its id, then seals with the SHA-256. Only the hash is stored.
- `validateDeviceGrant` (`:226`) — signature → payload expiry → site pin → origin pin (all offline)
  → row → hash equality → revocation/rotation → row expiry → **parent `site_editors.revoked_at`**
  → UA hash. Returns `shouldRefresh` inside 24h of expiry.
- `refreshDeviceGrant` (`:396`) — claims the rotation with a conditional update *before* minting,
  with a compensating rollback if the mint fails (`:465-479`).
- `revokeAllGrantsForEditor` (`:498`) / `revokeGrantById` (`:520`).
- `revokeSiteEditor` (`editor-directory.ts:183`) — sets `revoked_at`, then sweeps grants; returns
  `grantsKilled`, which `SiteEditorsCard` shows in its confirm dialog (`:440-449`).
- `findActiveSiteEditor` (`editor-directory.ts:52`) — **returns null for unknown *and* revoked**,
  on purpose, so the two are indistinguishable.
- `redeemHandoff` (`editor-handoff.ts:66`) — consumes before minting via
  `.is("consumed_at", null)` (`:124-137`); re-checks the editor is live and site-matched.
- `normalizePermissions` (`editor-access.ts:55`) — the single widening rule
  (`admin ⊃ publish ⊃ edit ⊃ view`).
- `countOccupiedSeats` (`permissions.ts:228`) — `site_permissions` + `site_editors` for one site;
  reads `site_editors` with service-role deliberately, because its RLS would zero the count for a
  manager (`:219-223`).

**Crypto, verified.** HMAC-SHA-256, NUL-separated, domain-tagged per purpose
(`editor-crypto.ts:18-23`); `EDITOR_GRANT_SECRET` required ≥ 32 chars, else a one-way derivation
from the service-role key with a loud warning (`:43-78`); codes are `crypto.randomInt`
(`:137`), grants `crypto.randomBytes(32/48).base64url` (`:142`); all comparisons via
`timingSafeEqualString` (`:130`).

**Prior hardening that must not regress.**

- `728b646` — `GET /api/sites` only returns `siteToken`/`embedScript` when
  `permission === 'admin'` (`src/app/api/sites/route.ts:98,103-108,124`); site DELETE requires
  `permission === 'admin' && granted_by === null`, i.e. the creator
  (`src/app/api/sites/[siteId]/route.ts:43-46`); `20260813120000_hide_sites_api_key.sql` revokes
  `sites.api_key` from anon/authenticated.
- `aca2eb2` — last-admin revoke guard at `src/app/api/sites/[siteId]/share/route.ts:445-503`,
  plus the per-row DELETE policy migration.

---

## Traps & constraints

**T1 — a cross-site view is the exact shape that leaks install credentials.** `728b646` exists
because non-admins were being handed a minted 90-day site token. Any new "all my sites and their
editors" projection must not select `sites.api_key`, must not call `buildSiteToken`, and must be
gated on an `admin` row per site — not on account membership.

**T2 — teaching the write path a third principal is the whole risk.** If s14 makes the grant
usable, `extractEditorToken` gains a branch that is reachable from every `/api/staging/*` and
`/api/edit-board/*` route (≈17 call sites). The device-grant checks that make it safe (origin pin,
UA pin, parent-row re-read) live inside `validateDeviceGrant`, which needs a `DeviceContext` —
built from the `Origin` header (`editor-request.ts:20-29`) — and `validateEditorTokenFromRequest`
today builds only a `StagingDeviceFingerprint`. Getting that plumbing wrong fails **open**: a
grant accepted without its origin binding is a token that works from anywhere.
AGENTS.md is explicit: *"Do not write a fourth auth path."*

**T3 — ADR 002 pressure.** 28 of 77 route files already use `createServiceRoleClient`; ADR 002
says revisit the design past ~40. `/api/editor/editors` already uses service-role for a
*signed-in* caller (via `listSiteEditors`, `upsertSiteEditor`, `revokeSiteEditor`), which is a
deviation from rule 2 that is defensible per-call but must not be multiplied by a batch route and
a cross-site view.

**T4 — batch invite has no transaction.** AC 3 is N × (`canShareSite` → `upsertSiteEditor`).
Concurrent calls can each pass the per-site check; per-site limits make that bounded, but partial
failure is the real problem: five sites, three succeed, two hit the seat cap. The response must be
per-row (the shape `s05` uses for bulk import), not a single ok/fail.

**T5 — `staging_history` cannot answer AC 7 as it stands.** No `site_id` (join through
`content_elements`), no `created_at` index, no `element_id` (only `content_element_id`), no reader
anywhere, and `server/index.js:575-581` is a second writer that inserts rows with a *different*
attribution path. Building a cross-site activity view on it means a migration — which is one of the
PRD's own markers for complexity 5.

**T6 — `s03`'s named source does not exist and is the wrong shape anyway.** No `account_milestones`
table (checked across all 43 migrations). `s03` AC 1 describes it as *four write-once timestamps per
account*; AC 7 of s14 needs *a list of individual edits with site, editor and element*. Those are
different objects. `s03` AC 8 claims ownership of "account-level edit activity", which s14 must not
duplicate — but s14 needs per-edit rows, which `s03` does not produce.
`docs/research/s15-agency-digest.md:170-174` reached the same conclusion independently.

**T7 — AC 8 contradicts an existing security decision.** `nextActionFor` returns `hide` for
`editor_revoked` and `site_mismatch` (`editor-grants.ts:131-144`), and the widget deliberately
renders nothing (`recopyfast.src.js:1044-1049`): *"prompting would only confirm that the address
once was one."* AC 8's "clear message and a way to request a new one" would re-open that oracle if
applied to the revoked case. The criterion must be scoped to *expired* (and to the hub, where the
person has already proved the mailbox), or the decision must be reversed explicitly.

**T8 — enumeration, verified clean, easy to break.**
`request-code` is neutral in body **and** timing: minting and mailing both run in `after()`
(`route.ts:115`) specifically so a recognised address costs no extra latency, and the old
`code_unavailable` 503 — reachable only for a recognised address — was removed (`route.ts:16-20`).
`submit-code` collapses wrong/expired/never-issued/spent into one `rejectCode` (`route.ts:41-52`).
A batch-invite route reporting per-site outcomes is admin-authenticated, so it does not reopen
this — but any *editor-facing* multi-site surface would.

**T9 — the grant is not guessable, reusable across sites, or valid after redemption.** Verified:
32-byte CSPRNG handoff code, stored hashed, 60s TTL (`editor-handoff.ts:27`), consumed by a
conditional update so two racers produce one grant (`:124-137`), site re-pinned at redemption
(`:118`), and the redeeming origin must belong to the site (`editor-request.ts:44-90`, subdomains
allowed, localhost only when `NODE_ENV !== "production"`). Grants are site-pinned in the signed
payload (`editor-grants.ts:245`) and origin-pinned (`:253-257`). **No gap found here.**

**T10 — the constraint holds trivially.** Nothing in this area touches `/api/teams/*`, and neither
candidate model introduces a role: `site_editors.permissions` is a capability array on a per-site,
revocable, expiring row. Note the graveyard `teams` tables are joined by
`/api/sites/[siteId]/share` (`site_permissions.team_id`) — do not extend that route.

**T11 — the widget is a built artifact.** Any change to the banner or to `editMode` means editing
`recopyfast.src.js` then `npm run build:embed`; `--check` fails on a stale artifact. And it competes
for the byte budget `s06` owns — `stories.md:96-103` allocates **nothing** to s14.

**T12 — seats are per-site, and s13 sells an "editor limit".** `countOccupiedSeats` is per-site
(`permissions.ts:228-256`). `s13` AC 1 asks for an `agency` plan with "its own site limit, editor
limit and monthly credit allowance". If that editor limit is meant per *account*, it is a different
quota shape from the one that exists, and s14's batch invite is the first thing that would expose
the difference.

---

## Open questions

1. **Which credential is s14 consolidating onto?** The story names the grant model, which cannot
   write. The staging model can write but puts a bearer token in a URL the owner hand-delivers.
   Recommended: grant model, because migration `20260801100000` already made the deliberate choice
   that the entry URL carries no secret — but this must be decided before planning, because it
   determines whether s14 contains an auth-path change.
2. **Does s14 also retire the staging-invite surface?** Two invite dialogs on one site view is a UX
   and a security problem (two revocation paths, two expiry rules, two second factors). Retiring
   `ShareSiteDialog`'s invite is in the spirit of `s04` but is not in any story.
3. **AC 7's source.** Given T5/T6, does s14 (a) add `site_id` + indexes to `staging_history` and
   read it, (b) wait for `s03` and require `s03` to emit per-edit rows it does not currently
   promise, or (c) drop AC 7 into its own story? This is a blocking question for the AC-7 half only.
4. **AC 8 vs. the revoked-editor silence (T7).** Reverse the decision, or scope the criterion to
   expiry? Needs a named answer, in the story, not in the plan.
5. **What "the agency's sites" means before `s13` exists.** Today an account's sites are its
   `admin` rows in `site_permissions`. Is that the definition, or does `s13` introduce something
   else? `prd.md:444-446` still lists the Agency plan shape as an open decision.
6. **Grant TTL for a client handoff.** 7 days remembered / 12h session were chosen for a returning
   editor. An agency handing a client the keys is arguably a longer relationship. Is the TTL a
   per-invite choice (as `staging_access.expiresInDays` is) or fixed?

---

## Real complexity

**Re-scored: 5.** `stories.md:700` says 4 — *"permissions and expiry across many sites"* — and that
score was set on the premise that the single-site version works. It does not (see the top of this
document). Corrected, the story contains:

1. **A new authorization principal on the content write path** (device grants accepted by
   `validateEditorTokenFromRequest`), reachable from ~17 routes, failing open if the origin/device
   binding is mis-plumbed. This is the product's stated highest-consequence surface.
2. **A widget change** — turning `editMode` on for grant holders and removing the "not enabled yet"
   banner — inside a byte budget that allocates s14 nothing.
3. **A batch invite** with per-row outcomes and per-site quota.
4. **A new read model + migration** for cross-site edit activity (`staging_history` has no
   `site_id`, no index, no reader).
5. **A criterion that cannot be executed at all** without a service that is not deployed (AC 4's
   socket clause).

Under the PRD's own scale (`prd.md:129`: *"5 real-time, migrations, external systems"*) that is
three of the three markers. **A 5 must be split.**

---

## Split proposal

Three stories. The edge `s14a → s14b → s14c` is real; `s14c` additionally needs `s13` and `s03`.

### `s14a-grant-authorized-editing` — the invited editor can actually edit (complexity 4)

Make the device grant a principal on the content path, for **one** site. This is the story the
current s14 assumes already shipped.

- `extractEditorToken` gains a `device-grant` kind reading `X-RCF-Editor-Grant` (header, not URL —
  a grant must never enter browser history); `validateEditorAccess` routes it to
  `validateDeviceGrant` with a `DeviceContext` built from `Origin`.
- The widget sends the grant on `/staging/content` and `/staging/publish`, sets `editMode` from the
  grant's permissions, and the `showEditorBanner` note at `recopyfast.src.js:1130` is deleted.
- **AC 4's HTTP half lands here for free and must be asserted here**: a test that revokes
  `site_editors` mid-session and asserts the next save is refused. `editor-grants.ts:344` already
  makes this true; the test is what makes it a criterion rather than an accident.
- Risk: the failure mode is fail-open. A grant accepted without its origin pin is a credential that
  works from any site.
- Depends on: nothing. Explicitly **not** on `s13` — this is single-site and is the security floor.

### `s14b-multi-site-grants` — plural invites and per-site grant visibility (complexity 3)

- Invite one email to several sites in one action, each producing an independent
  `site_editors` row; per-row outcomes (created / restored / seat-limited / failed).
- Per site: who holds a grant, their permissions, **and each device grant's expiry** (the field
  `listSiteEditors` does not currently return).
- Expired/revoked messaging (AC 8), with T7 settled in the story text.
- Enumeration guarantees restated as tests over the existing neutral responses.
- Depends on: `s14a`, `s13` (for what "the agency's sites" means).

### `s14c-cross-site-edit-activity` — one view of recent edits across the account (complexity 3)

- The AC 7 view: site, editor, element, timestamp, across every site the account holds an `admin`
  row on.
- Owns the read-model decision from open question 3, including the migration if the answer is
  `staging_history`.
- Depends on: `s14b`, `s03`. This is also `s15-agency-digest`'s real dependency — see
  `docs/research/s15-agency-digest.md`.

---

## M5 — who owns the revocation-over-WebSocket criterion

**Finding restated.** `stories.md:711` AC 4 requires that *"an open editing session cannot continue
saving after revocation — including over an established WebSocket connection."* s14 declares no
dependency on `s07`/`s08` and sits on a branch (`s01 → s13 → s14 → s15`) that never reaches them.
Reviewed: **no WebSocket service is deployed** (`architecture.md:52`, ADR 004 context,
`server/fly.toml:22` still carries the placeholder app name), so s14 cannot test the socket half
against anything that exists.

**Verdict: split the criterion. The HTTP half stays in s14 (in `s14a` under the split above). The
socket half moves to `s07-realtime-service`, not to `s08`.**

Reasoning, in order of weight:

1. **The defect is server-side, and `s07` owns the server.** The bug is concrete and readable
   today: `server/index.js:386-405` resolves permissions once at handshake and stores them on
   `socket.data`; `:527` reads that cache on every `content-update`; nothing re-reads
   `staging_access` or `site_editors`. Revoking mid-session leaves the socket writing. ADR 004 says
   *"`server/index.js` serves both"* transports — so the connection lifecycle is shared between
   native-WS embed clients and Socket.io dashboard clients. `s08` replaces only the **client**
   library. Putting a server-lifecycle criterion in `s08` would leave the Socket.io dashboard path
   uncovered.
2. **ADR 004 rule 1 shrinks the problem, and `s07` is where that rule is enforced.** The ADR says
   *"HTTP stays authoritative… Real-time broadcasts; it never becomes a second write path."*
   Today `server/index.js:541-586` writes `content_elements` and inserts `staging_history` directly
   over the socket — a straight violation. If `s07` enforces rule 1 and the socket stops persisting,
   the revocation problem collapses from "a revoked editor can still save" to "a revoked editor can
   still *receive* staging broadcasts" — a disclosure issue, not a defacement. Whoever enforces rule
   1 is the only person in a position to say how much of AC 4 remains. That is `s07`.
3. **ADR 004 rule 2 forbids the alternative.** *"Realtime is provably additive… with the WebSocket
   service stopped, editing, saving, staging and publishing must all still work."* If realtime is
   additive, then a security property of the HTTP path cannot be *conditional* on realtime shipping.
   Adding `s07`/`s08` to s14's dependencies would invert that: it would gate the product's most
   security-critical story on a service the ADR insists is optional. **Reject the "add a hard
   dependency" option on ADR grounds, not on scheduling grounds.**
4. **`s07` already owns the adjacent criterion.** `stories.md:388` AC 8: *"Socket connections are
   authorized per site, and a connection cannot join a site room it has no grant or permission
   for."* That is join-time authorization. The fix is a one-clause extension of a criterion `s07`
   already carries, not a new axis — so it does not push `s07` past a 4.
5. **Making it conditional is the option to reject outright.** A criterion phrased *"once `s07`
   lands…"* is exactly what the review calls out: vacuous when tested, owned by nobody, and the
   thing it guards is a revoked editor defacing a customer's live site.

**Concrete edits.**

- `s14` AC 4 becomes: *"Revoking a grant takes effect on the next HTTP request, and an open editing
  session cannot continue saving. Asserted by a test that revokes mid-session and shows the next
  save refused."* Strike *"including over an established WebSocket connection."*
- `s07` gains an AC: *"A connection's authorization is re-checked, not cached from the handshake:
  revoking or expiring the grant or token a connection was authorized with terminates it, and no
  further write or staging broadcast reaches it."* Add a note naming `server/index.js:401` and
  `:527` as the code that does the caching today.
- `s07` gains a second AC, or an explicit note, for ADR 004 rule 1: *"the socket does not persist
  content"* — naming `server/index.js:541-586` as what must go. This is worth stating even though
  it looks like a refactor: it is the difference between a revoked socket being a defacement and
  being a leak.
- Keep the trap note in `s14` (`stories.md:734-736`) as a **pointer** to `s07`'s criterion, so the
  coupling stays visible from both ends. Do not leave it as the only place the work is described.
- Do **not** add `s07` or `s08` to `s14`'s Dependencies.
