---
validated: yes
---
# Plan — Story s14b-multi-site-grants

Branch: `feature/s14b-multi-site-grants`
Research: `docs/research/s14-agency-client-handoff.md` — read it first; this plan does not repeat it.

## Target story

`docs/stories.md` → `s14-agency-client-handoff`, split at research. This is the second of three:
plural invites and per-site grant visibility. Complexity 3. **Depends on `s14a`** (a grant that
authorizes nothing is not worth issuing in bulk) **and `s13`** (what "the agency's sites" means).

Design: `docs/designs/s14b-multi-site-grants.md` (+ `.html`, reference only, never copied).

Acceptance criteria this story carries, from the parent:

- AC 1 — invite an editor to a site by email, from that site's view, in one action. Partially true
  (`SiteEditorsCard` → `InviteEditorForm` → `POST /api/editor/editors`); kept working unchanged.
- AC 3 — invitations to several sites at once, **each producing an independently scoped grant**.
  Absent today: `upsertSiteEditor` is one `(site_id, email)` row per call, no batch route, no
  batch UI.
- AC 5 — grants expire on schedule, enforced server-side. True today; asserted here.
- AC 6 — per site, who holds a grant, their permissions, **and when each expires**. Partial:
  `listSiteEditors` (`editor-directory.ts:215-261`) returns email, permissions, `revokedAt` and an
  aggregate `activeDevices` count — **but not each device grant's `expires_at`**, and
  `SiteEditorRow` renders no expiry at all.
- AC 8, the agency's half — revoked and expired states legible on the dashboard. T7's enumeration
  concern does **not** apply here: this screen shows an agency data about its own site, to someone
  who already knows who they invited. There is no oracle to protect on this surface.
- AC 9 — the invite flow does not reveal whether an email already has an account. Batch invite is
  admin-authenticated, so per-row outcomes do not reopen it; asserted anyway.

**One scope decision, made here and flagged for the checkpoint.** The design's invite dialog carries
an expiry `<select>` (`EXPIRY_OPTIONS`, 1/7/14/30 days) on the assumption that grant TTL is
per-invite, and says explicitly that research open question 6 is unsettled and Plan should confirm.
**Confirmed: not in this story.** A per-invite TTL cannot be stored on the invite — the grant is
minted at *redemption*, not at invite time, so it means a new column on `site_editors`, a migration,
and a change to `issueDeviceGrant` (`editor-grants.ts:153-214`), which is the one function in the
codebase where a longer-lived credential could be introduced by accident. No acceptance criterion
asks for it: AC 5 asks that grants expire on schedule server-side, and they do (7 days remembered /
12 hours session, checked offline from the signed payload at `:241` and again against the row at
`:327`). The dialog ships without the expiry control; Task 5 asserts the existing schedule instead.
If the checkpoint wants per-invite TTL, it is its own story with its own migration.

## Tasks (ordered)

- [ ] **T1 — `listSiteEditors` returns each device grant's expiry.** `editor-directory.ts:215-261`.
      The grants read currently selects only `site_editor_id` and filters
      `.is("revoked_at", null).gt("expires_at", now)`. Change it to select `id, site_editor_id,
      expires_at` and **drop the `expires_at` filter**, computing `activeDevices` in TypeScript as
      the count of non-revoked grants whose `expiresAt > now`. That keeps one query, preserves the
      existing `activeDevices` semantics exactly, and gives the row an expired grant to render.
      Return `grants: { id: string; expiresAt: Date }[]` alongside it, newest expiry first.
      *Tests:* an editor with two live grants returns two entries and `activeDevices === 2`; an
      editor with one live and one lapsed grant returns two entries and `activeDevices === 1`; a
      revoked grant appears in neither.

- [ ] **T2 — expose `grants` through `GET /api/editor/editors`, and nothing else.** The route maps
      fields explicitly (`route.ts:85-92`), so the mapping must be extended:
      `grants: [{ id, expiresAt }]`. **`grant_hash`, `user_agent_hash`, `origin_hash`, `ip_prefix`
      and the raw token must never leave the server** — only the hash is stored precisely so a
      dump of `editor_device_grants` yields nothing presentable, and echoing any of it to the
      dashboard undoes that.
      *Tests:* the response contains `grants` with exactly `id` and `expiresAt` per entry; a
      snapshot/shape assertion that no key matching `/hash|token|ip_/` appears anywhere in the
      response body.

- [ ] **T3 — `POST /api/editor/editors` accepts `siteIds: string[]` and answers per row.** Extend
      `src/lib/api/validation.ts` with `requireUuidArray(body, field, { maxLength })` — **not zod**
      (ADR 003) — capping the batch at 25 so one request cannot enrol an unbounded list. Accept the
      existing single `siteId` as a one-element array so `InviteEditorForm` keeps working
      unchanged; one code path, two entry shapes.
      Inside the loop, **per site**: `requireSiteAdmin(siteId)` → `findActiveSiteEditor` →
      `canShareSite` (only when the editor is not already active — the existing logic at
      `route.ts:165-180`, which correctly charges the seat to the *site's owner*, never the acting
      admin) → `upsertSiteEditor`. One permission set applies to the whole batch (the design's
      stated assumption; a per-site permission matrix is a second axis nothing asks for).
      Response is **always** per-row, never a single ok/fail — the batch has no transaction (T4),
      so partial failure is the normal case:
      `results: [{ siteId, outcome: "created" | "restored" | "seat_limited" | "forbidden" |
      "failed", message?, upgradeRequired? }]`.
      *Tests:* a caller who is admin on 2 of 3 named sites gets `forbidden` for the third **and no
      `site_editors` row is written for it**; a batch where one site is at its seat cap returns
      `seat_limited` for that row and `created` for the others; re-inviting a revoked address
      returns `restored`; 26 site ids is a 400 before any write; a non-UUID site id is a 400 before
      any write.

- [ ] **T4 — charge the invite limiter per row, not per request.** Today one
      `USER_DOMAIN_VERIFY` hit covers one POST (`route.ts:127-135`), which was correct when a POST
      was one enrolment. A 25-site batch would buy 25 enrolments for one budget unit — the exact
      "throttle so a compromised owner session cannot enrol a list of addresses at speed" property
      that comment exists to hold. Charge one unit per site, before the loop writes anything, and
      keep `onStoreFailure: "deny"`.
      *Tests:* a caller with 3 units of budget submitting 5 sites writes at most 3 rows and reports
      the remainder as rate-limited, not `failed`; with Redis unavailable the whole batch is
      refused (deny, not allow).

- [ ] **T5 — assert AC 5: expiry is enforced server-side, twice.** Not new behaviour — a test that
      pins it. A grant whose signed payload is still in date but whose **row** `expires_at` has
      passed is refused (`editor-grants.ts:327`); a grant whose payload has expired is refused
      offline before any database round trip (`:241`). Both matter: the first is the case where an
      operator shortened a grant in the database, the second is the case where the row is gone.
      *Tests:* the two cases above, each refused, each with the right `GrantRejection`.

- [ ] **T6 — the multi-site invite dialog.** New component beside `InviteEditorForm`, opened from
      the `actions` slot of the sites-list page's `PageHeader`. Composed from `Dialog` /
      `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter`,
      `Input`, `Label`, `Button`, `Skeleton`, `EmptyState`, `Alert` — **nothing invented**, and the
      checkbox-as-button pattern (`role="checkbox" aria-checked`, native `<button>`) lifted
      verbatim from `InviteEditorForm`'s permission picker and applied a second time to the site
      checklist. Sites come from the existing sites read, filtered to the caller's `admin` rows.
      Submit disabled until email is non-empty and ≥ 1 site and ≥ 1 permission are selected.
      **The site checklist renders name and domain only.** No `siteToken`, no `embedScript`, no
      `api_key` — `728b646` exists because a non-admin was handed a minted 90-day site token, and a
      cross-site picker is the exact shape that leaks one again (T1).
      *Tests:* submit stays disabled through each missing precondition; the rendered checklist
      contains no value matching a site token or script tag; zero sites renders `EmptyState`, not
      an unusable dialog.

- [ ] **T7 — the per-row outcome report.** Replaces the form inside the same dialog on submit. One
      row per selected site: name/domain + a `StatusBadge` + reason text where the outcome needs
      one. Add **one** registry entry beside `siteStatuses` / `contentStatuses` / `abTestStatuses`
      in `src/components/ui/status-badge.tsx` — `grantOutcomeStatuses: { created, restored,
      seatLimited, failed, forbidden }` mapped to `success / info / warning / danger / danger`.
      That is the established way to add a status vocabulary; it is not a new primitive.
      Failed and forbidden rows show human text from `SiteEditorsCard`'s existing `ERROR_MESSAGES`
      table, reused rather than re-written — never a bare code, never a stack trace. Seat-limited
      rows name the specific site (T12: the limit is per-site), with **one** grouped
      `Button variant="outline" size="sm"` to `/dashboard/billing` at the bottom rather than one
      per row. Summary line above: "3 of 5 invites sent" or "3 of 5 invites sent — 2 need
      attention". "Done" closes; no retry-in-place (re-opening the dialog for the failed sites is
      the retry path, consistent with a batch that has no transaction to resume).
      *Tests:* a mixed response renders one row per requested site with the mapped tone; a failed
      row renders prose, not the raw `error` key; the upgrade link appears once for two
      seat-limited rows.

- [ ] **T8 — `SiteEditorRow` renders per-device expiry.** Additive to the existing row (avatar,
      email, permission badges unchanged): one `text-xs text-muted-foreground .tabular` line per
      grant under the permission badges — "Expires in 5 days (Aug 21, 2026)". A grant past its
      `expiresAt` renders `StatusBadge tone="neutral"` "Expired" on that line instead of a
      countdown, **with no action button beside it** — there is no resend-a-grant endpoint, the
      editor's own next sign-in mints a fresh one, and adding an agency-initiated resend path would
      be the fourth auth path AGENTS.md forbids. Zero devices keeps today's "No devices signed in"
      copy. Rendered flat, not behind a disclosure control: the inventory has no `Accordion`, and
      `DropdownMenu` is for actions, not read-only lists.
      *Tests:* two grants render two lines; a lapsed grant renders the "Expired" badge and no
      button; zero grants renders the existing copy unchanged.

- [ ] **T9 — regression tests for the prior hardening this story sits next to.** The batch invite
      writes `site_editors` rows and nothing else; assert that the neighbouring permission surfaces
      are unmoved:
      - **`aca2eb2`** — the last-admin revoke guard at `src/app/api/sites/[siteId]/share/route.ts:445-503`
        still refuses removal of the final admin, and the per-row DELETE policy
        (`20260813140000_site_permissions_delete_per_row.sql`) still prevents an admin wiping the
        creator over PostgREST.
      - **`728b646`** — `GET /api/sites` still gates `siteToken`/`embedScript` on
        `permission === 'admin'`; site DELETE still requires `permission === 'admin' &&
        granted_by === null`.
      - **AC 9 / T8** — `/api/editor/request-code` remains neutral in body and timing; the batch
        route's per-row outcomes are behind an admin session and therefore reveal nothing an admin
        did not already know, asserted by a test that an unauthenticated caller gets 401 before any
        per-row information is computed.

## Run interdicts

- **This uses the GRANT model and must touch NO `/api/teams/*` route. Do not introduce a role.**
  Grants are per-site and expiring; roles are per-org and persistent. `site_editors.permissions` is
  a capability array on a revocable row. Do not extend `/api/sites/[siteId]/share`, which joins the
  graveyard `teams` tables through `site_permissions.team_id`. A multi-site invite dialog is the
  first surface in the backlog that *looks* like team management; the distinction has to be
  maintained deliberately, in the code and in the copy.
- **Authorization is per site, inside the loop.** One `requireSiteAdmin` hoisted above the loop is
  the fail-open shape this whole story exists to avoid — see "The point everything turns on".
- **Seat quota is per site, charged to that site's owner.** `canShareSite` resolves the payer
  (`permissions.ts:188-211`); do not substitute the acting admin, or a Pro admin issues seats on a
  Starter owner's site that nobody bought. Do not batch the seat checks into one count: they are N
  independent quotas against N different plans.
- **No transaction is available and none is to be faked.** Do not wrap the batch in a
  best-effort rollback loop; a partial batch is a reported outcome, not an error to hide.
- **No `staging_access` row is created by anything in this story.** `ShareSiteDialog` writes a
  different table with a different revocation path and a different second factor. This dialog
  borrows two of its *visual* patterns and none of its data path. (Whether the staging invite is
  retired at all is research open question 2 and is not settled here.)
- **No new `createServiceRoleClient()` call site.** The batch route reuses the existing
  service-role reads inside `editor-directory.ts`, which are a documented per-call deviation from
  ADR 002 rule 2; multiplying them across a batch route is exactly what T3 of the research warns
  against. 28 of 77 today.
- **No zod** (ADR 003). Extend `src/lib/api/validation.ts`.
- **Compose from `src/components/ui/`; never invent a component.** `StatusBadge` gains a registry
  entry, not a variant. There is no `Accordion` and none is to be written here.
- **Do not add the expiry control to the dialog.** See the scope decision above.
- **Do not modify an existing test to accommodate a change in behaviour** (AGENTS.md).

## The point everything turns on

**Each row is an independent authorization decision, and the batch is where that stops being
obvious.**

`POST /api/editor/editors` today authenticates a session and then authorizes against *the one site
named in the body*. The batch version receives a list, and the tempting shape — check the caller is
an admin, then loop and write — turns "invite my client to my sites" into "invite anyone to any
site whose UUID I can name." Nothing else in the request distinguishes those two readings. The
caller is a legitimately signed-in user either way; the write succeeds either way; the response
looks identical either way. It fails **open**, silently, and the blast radius is one grant per site
id an attacker can guess or scrape — on the highest-consequence surface in the product.

The same reasoning applies twice more in the same loop, for the same reason:

- **The seat check is per site and charged to that site's owner** (T12: `countOccupiedSeats` sums
  `site_permissions` + `site_editors` for **one** `siteId`). Five sites is five plans, possibly
  five different payers. Hoisting it is the same mistake wearing a billing hat.
- **The rate limit is per row.** One budget unit covering 25 enrolments is the same hoisting error
  in the throttle, and the comment at `route.ts:124-126` already says what it costs.

So: nothing is hoisted out of the loop. Not the admin check, not the seat check, not the limiter.
The response is per row because the *decisions* are per row, and a single ok/fail would be a lie
about what the server actually did.

## Files touched

| File | Change |
|---|---|
| `src/lib/auth/editor-directory.ts` | `listSiteEditors` returns per-grant `{ id, expiresAt }`; `activeDevices` computed rather than filtered |
| `src/app/api/editor/editors/route.ts` | `siteIds[]` accepted; per-site authorization + seat check + upsert in a loop; per-row outcome response; per-row rate limiting; `grants` in the GET mapping |
| `src/lib/api/validation.ts` | `requireUuidArray` added |
| `src/components/dashboard/InviteEditorsDialog.tsx` | new — the multi-site invite dialog + per-row outcome report |
| `src/components/dashboard/SiteEditorRow.tsx` | per-device expiry lines; "Expired" badge |
| `src/components/dashboard/SiteEditorsCard.tsx` | `ERROR_MESSAGES` exported for reuse by the report; no behavioural change |
| `src/components/ui/status-badge.tsx` | one registry entry: `grantOutcomeStatuses` |
| `src/app/dashboard/sites/page.tsx` | "Invite editor" in the `PageHeader` `actions` slot |
| `src/__tests__/api/editor/editors/batch-invite.test.ts` | new — per-row authorization, seat limits, outcomes |
| `src/__tests__/api/editor/editors/seat-quota.test.ts` | extended for the batch path |
| `src/lib/auth/__tests__/editor-grants-ttl.test.ts` | extended for T5's two expiry checks |
| `src/components/dashboard/__tests__/` | dialog gating, outcome report tones, expiry row rendering |
| `docs/plans/s14b-multi-site-grants.md` | checkboxes ticked as tasks land |

No migration. No ADR (the one decision — deferring per-invite TTL — is a scope note recorded above,
not a structural choice).

Not touched, deliberately: `src/components/dashboard/ShareSiteDialog.tsx`, `ShareLinkCard.tsx`,
`src/app/api/staging/access/route.ts` (different model), `src/app/api/teams/*`,
`src/app/api/sites/[siteId]/share/route.ts` (regression-tested, not edited), `src/lib/auth/editor-grants.ts`.

## Test strategy

**Route tests carry the authorization assertions.** As in `s14a`: the failure mode is a check that
was hoisted or forgotten, and only a test that enters through the route can catch it. Follow
`src/__tests__/api/editor/editors/seat-quota.test.ts` — it already mocks the session and the
`site_permissions` read and is the closest existing shape.

**The tests that must fail before the code exists:**

1. A batch naming three sites, where the caller is admin on two, writes exactly two rows and
   reports `forbidden` for the third.
2. A batch where one site is at its seat cap reports `seat_limited` for that site and `created`
   for the rest — and the cap is evaluated against **that site's owner's** plan.
3. A batch of 5 against 3 remaining rate-limit units writes at most 3.
4. `listSiteEditors` returns a grant's `expiresAt`; the dashboard row renders it.
5. A lapsed grant renders "Expired" with no action button.
6. The GET response contains no key matching `/hash|token|ip_/`.

**Component tests.** Testing Library, colocated in `__tests__/`. Assert the disabled-until-valid
gating, the outcome→tone mapping, and the absence of install credentials in the site checklist.
The last of those is a security assertion wearing a component test's clothes — write it as such,
with a comment naming `728b646`.

**Not tested here:** anything about what a grant can *do*. That is `s14a`, and if `s14a` has not
landed, this story is issuing credentials that authorize nothing.

**Coverage.** Ratchet only upward (`jest.config.js`, 22% lines floor today).

## Definition of Done

- [ ] Every task above checked, with its named tests present and green.
- [ ] One email invited to three sites in one action produces three independent `site_editors`
      rows, each revocable on its own, each with its own seat charged to its own site's owner.
      Verified by hand, not only in tests.
- [ ] A site's editor card shows, per editor, who they are, what they may do, and when each of
      their devices' grants expires.
- [ ] A batch with a mixed result reports per row and never a single ok/fail.
- [ ] `lint`, `type-check`, `format:check`, `build`, `test` all green.
- [ ] Mechanically checkable interdicts checked and stated in the PR: no `/api/teams/*` in the
      diff; no new `createServiceRoleClient` call site; no `zod` import; no new file under
      `src/components/ui/`; no `staging_access` write.
- [ ] The word "role", "member", "team" and "org" appear nowhere in this story's user-facing copy.
- [ ] `docs/reviews/s14b-multi-site-grants.md` ends `Ship allowed: yes` with no critical finding.
