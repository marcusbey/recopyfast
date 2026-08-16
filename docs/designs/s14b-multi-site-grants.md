# Design — Story s14b-multi-site-grants

> Surface: **app dashboard**, agency operator's control panel — not the client/editor-facing
> surface (that is `s14a`). Built on the **grant model** (`site_editors` + device grants via
> `/api/editor/editors` and `editor-grants.ts`), never `/api/teams/*` and never a role, org
> chart or team. Per `docs/research/s14-agency-client-handoff.md`'s split proposal, this story
> is scoped to: plural invite, per-site grant visibility with expiry, revoke, and
> expired/revoked messaging **for the agency**. The cross-site activity view is `s14c`.

---

## Screen(s)

### 1. Invite one email to several sites (dialog)

Entry point: an **"Invite editor"** action in a `PageHeader`'s `actions` slot on the page that
lists the agency's sites (its `admin` rows in `site_permissions` — the definition research
leaves open pending `s13`, assumed here since no other definition exists yet). Opens a `Dialog`
with four fields, all in the **grant model**, none of it staging-access:

- **Email** — one `Label` + `Input type="email"`, one address per batch (the story invites *one*
  email to *several* sites, not several emails at once).
- **Sites** — a checklist of the agency's sites (name + domain only — **never** `api_key` or a
  minted site token in this view, per T1). Reuses the exact checkbox-as-button pattern
  `ShareSiteDialog`/`InviteEditorForm` already use for permissions
  (`role="checkbox" aria-checked`, native `<button>`, tick on the granted option) — applied here
  to sites instead of permissions. Not a new interaction pattern.
- **Permissions** — the same four-option checkbox group (View / Edit / Publish / Admin), reused
  verbatim from `InviteEditorForm`, applied uniformly to every selected site in this one action.
  *Assumption, stated because the story doesn't specify otherwise*: one permission set for the
  whole batch, not a per-site matrix — a per-site permission matrix is a materially bigger
  surface (T4's per-row complexity would compound with a second axis) and nothing in the
  acceptance criteria asks for it.
- **Expiry** — the same `EXPIRY_OPTIONS` `<select>` from `ShareSiteDialog` (1 / 7 / 14 / 30
  days), for the device grant's TTL. Research's open question 6 (is grant TTL per-invite or
  fixed?) is **not settled** — this design assumes per-invite because it is the only existing UI
  pattern for it and nothing in research argues against it; Plan should confirm before Execute.
- **Submit** — `Button` "Send invites", disabled until email is non-empty, ≥1 site and ≥1
  permission are selected. No "Anyone with link" option — that access type doesn't exist for
  either invite model in this product (`ShareSiteDialog`'s own comment confirms it was retired).

**Note on which existing dialog this extends.** The brief asks for an inventory of
`ShareSiteDialog` + `ShareLinkCard` alongside `SiteEditorsCard`/`InviteEditorForm`/
`SiteEditorRow`. They are **two different data models**: `ShareSiteDialog` posts to
`/api/staging/access` and writes `staging_access` rows (time-boxed preview links/invites, a
different table). `InviteEditorForm`/`SiteEditorsCard` post to `/api/editor/editors` and write
`site_editors` rows — the durable, revocable, device-grant-backed allowlist s14a/s14b are built
on. **This design extends the `InviteEditorForm`/`SiteEditorsCard` lineage, not
`ShareSiteDialog`.** It borrows two of `ShareSiteDialog`'s *visual patterns* (the checkbox-group
permission picker, the expiry `<select>`) but none of its data path. Research's open question 2
— whether the staging-invite surface should be retired now that two invite dialogs exist on one
site — stays open; this design doesn't resolve it, just avoids making it worse by keeping the
grant-model dialog visually consistent with its staging-model sibling rather than divergent.

### 2. Per-row outcome report (same dialog, replaces the form on submit)

A batch invite is N independent `site_editors` upserts (T4) with no transaction — partial
failure is the normal case, not an edge case, so the response is **always per-row**, never a
single ok/fail:

- One row per selected site: site name/domain + a `StatusBadge` for that row's outcome +
  reason text where the outcome needs one.
- Outcome → tone mapping (per the brief, composed from the existing six `tone-*` triplets):
  **created → success**, **restored → info**, **seat-limited → warning**, **failed → danger**.
  "Restored" reuses the copy already established in `SiteEditorsCard`'s `NoticePanel`
  ("Adding the same address again later restores their access") applied per-row.
- **Seat-limited** rows carry the same upgrade path `SiteEditorsCard` already uses for a single
  site's `upgradeRequired` failure: reason text + a `Button variant="outline" size="sm"` linking
  to `/dashboard/billing`, shown once at the bottom of the report if any row is seat-limited
  (not repeated per row — the destination is the same for all of them). Per T12, the limit is
  per-site, so the reason text names the specific site: "Seat limit reached for
  acme-dental.com."
- **Failed** rows show the human reason text the route returns (never a bare code, matching
  `SiteEditorsCard`'s `ERROR_MESSAGES` translation table — this report reuses that table rather
  than inventing new copy).
- A one-line summary above the rows: "3 of 5 invites sent" (all success/info) or "3 of 5 invites
  sent — 2 need attention" (any warning/danger present).
- `Button` "Done" closes the dialog. No retry-in-place for failed rows in this pass — re-opening
  the invite dialog for just the failed sites is the retry path, consistent with the batch
  having no transaction to resume.

### 3. Per-site grant list — who holds a grant, permissions, and each device's expiry

Extends `SiteEditorsCard`/`SiteEditorRow` **in place** (same card, same page — not a new
screen). Today's `SiteEditorRow` shows the editor's email, permissions, and an aggregate device
*count* ("2 devices signed in"). This story needs the **per-device expiry**, which
`listSiteEditors` does not currently return.

**Data requirement, not a design-system gap — flagged per the brief.** The row design below
assumes each editor summary gains a `grants: { id: string; expiresAt: string }[]` array (or
equivalent). This is new API surface Execute must add to `listSiteEditors`/`editor-grants.ts`'s
read path; it is not something this design can produce by composing existing tokens.

Row layout, additive to the existing `SiteEditorRow`:

- Existing: avatar/email/permission badges, unchanged.
- New: under the permission badges, one line per device grant —
  `text-xs text-muted-foreground .tabular`, e.g. "Expires in 5 days (Aug 21, 2026)". Rendered
  flat, not behind a disclosure control — see "Design system gaps" for why no collapsible
  component is introduced for this.
- A grant past its `expiresAt` renders that one line with a `StatusBadge` (`tone="neutral"`,
  label "Expired") instead of the countdown text — see Screen 5.
- Zero devices keeps today's copy ("No devices signed in") unchanged.

### 4. Revoke, and what the agency sees after

**Unchanged — reused exactly as built.** `SiteEditorsCard`'s existing revoke confirmation
`Dialog` (device count stated before the click, `Button variant="destructive"`, `NoticePanel`
success `Alert` naming how many devices were signed out, row moves to a "Previously removed"
section with `Badge variant="tone-neutral"`) already satisfies this story's needs for a single
site. Nothing new to design here; the plural invite (Screen 1–2) is additive, this flow is not.

### 5. Expired / revoked messaging — the agency's view

Two distinct states the agency's dashboard must be able to show, kept visually distinct because
they mean different things even though both use `tone-neutral` (a deliberate action vs. a
natural lapse are still both "over," and the *label* carries the distinction the tone alone
doesn't):

- **Revoked editor** — unchanged `Badge variant="tone-neutral"` "Removed" on the row, already
  built (Screen 4).
- **Expired device grant** — `StatusBadge tone="neutral"` "Expired" on that one device's line
  only (Screen 3); the editor row itself stays in the active list if the editor still has other
  live grants, or the editor row itself if it was never revoked. **No action button is offered**
  next to an expired grant. There is no "resend this grant" endpoint — the editor's own next
  sign-in at the editor hub mints a fresh device grant automatically. Adding a resend button here
  would be designing against an API that doesn't exist (AGENTS.md: "do not write a fourth auth
  path" — a resend-by-agency path would be exactly that, and a new one).

**T7 does not apply to this screen.** The enumeration concern research raises (AC 8's "clear
message and a way to request a new one" re-opening the revoked/unknown-email oracle) is about
the **editor's** own redemption attempt — `s14a`'s surface. Here the *agency* is looking at data
about their own site, already knows who they invited; there is no oracle to protect against on
this screen.

---

## Mockup

**REFERENCE only** — see `docs/designs/s14b-multi-site-grants.html`. Renders three states in one
page: (1) the multi-site invite dialog open, mid-selection, with two sites and two permissions
checked; (2) the same dialog after submit, showing a mixed per-row outcome report (created,
restored, seat-limited, failed); (3) a `SiteEditorsCard`-shaped panel with two editor rows, one
carrying an active device grant with a countdown expiry and an expired one on a second device.
Low fidelity, `:root` token block copied from `docs/design-system.md`, `var()` throughout. Not
production code — Execute composes the real `src/components/ui/*` primitives, it does not copy
this markup.

---

## Reused components

Inventoried first, per the brief:

- **`InviteEditorForm.tsx`** — the checkbox-group permission picker is reused verbatim in Screen
  1, extended with a second checkbox group for site selection using the identical pattern.
- **`SiteEditorsCard.tsx`** — the whole loading/forbidden/error/ready state machine, the
  `NoticePanel` success-message pattern, the revoke confirm `Dialog`, and the
  active/revoked-editor split are reused unchanged for Screens 3–4. Its `ERROR_MESSAGES`
  translation table is reused for Screen 2's failed-row reasons rather than inventing new copy.
- **`SiteEditorRow.tsx`** — extended (not replaced) with the per-device expiry line described in
  Screen 3.
- **`ShareSiteDialog.tsx`** — its checkbox-as-button interaction pattern and its
  `EXPIRY_OPTIONS` `<select>` are reused *visually* in Screen 1. Its data path
  (`/api/staging/access`, `staging_access`) is **not** reused — see the note under Screen 1 on
  why this design stays on the grant model.
- **`ShareLinkCard.tsx`** — inventoried, not reused. It renders a `staging_access` row (link
  type, verified/pending, expiry, revoke), which is the staging model's equivalent of what
  Screen 3 needs for the grant model — but the underlying data (device grants, not staging
  tokens) and the component (`SiteEditorRow`) are already different from what it wraps. No
  overlap to compose from beyond what's already listed above.
- **`Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` /
  `DialogFooter`** — Screen 1–2's container, unchanged Radix wrapper.
- **`Button`, `Input`, `Label`** — every form control, unchanged variants (`default`, `outline`,
  `destructive` for revoke, `ghost` for row-level actions).
- **`Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent`** — Screen 3's panel
  shell, unchanged.
- **`Badge`** — `tone-neutral` for "Removed" (unchanged) and reused for permission chips.
- **`StatusBadge`** — Screen 2's outcome pills and Screen 5's "Expired" pill. Requires one new
  registry entry set alongside `siteStatuses`/`contentStatuses`/`abTestStatuses` in
  `status-badge.tsx` — e.g. `grantOutcomeStatuses: { created, restored, seatLimited, failed }` —
  which is the established pattern for adding a new status vocabulary, not a new primitive.
- **`Alert variant="destructive"`** — Screen 3's load-error state, unchanged from
  `SiteEditorsCard`.
- **`EmptyState`** — Screen 3's zero-editors state, unchanged copy and steps.
- **`Skeleton`** — Screen 1's site-list loading rows (new usage, same shape as
  `SiteEditorsCard`'s existing loading skeleton) and Screen 3's unchanged loading rows.
- **`PageHeader`** — its `actions` slot is where "Invite editor" is composed on the sites list
  page; no change to the component.

---

## States

| State | Screen | Behaviour |
|---|---|---|
| Loading | Invite dialog, site checklist | `Skeleton` rows in place of the checklist, same shape as `SiteEditorsCard`'s existing loading rows |
| Empty | Invite dialog | The agency has zero sites — reuse `EmptyState` ("Add a site first") rather than rendering an unusable dialog |
| Error | Invite dialog, site checklist | `Alert variant="destructive"` with a "Try again" `Button`, mirrors `SiteEditorsCard`'s `status === "error"` branch |
| Success | Outcome report | Every row `success`/`info`; summary "N of N invites sent" |
| Partial success | Outcome report | Mixed outcomes in one list; summary "N of M invites sent — K need attention" |
| Seat-limited | Outcome report, per row | `StatusBadge tone="warning"`, reason names the specific site (T12: limit is per-site), one grouped "View plans" link at the bottom |
| Failed | Outcome report, per row | `StatusBadge tone="danger"`, human reason from `ERROR_MESSAGES`, never a bare code or stack trace |
| Revoked | Per-site grant list | Unchanged: row drops to "Previously removed," `Badge tone-neutral` "Removed," `NoticePanel` success `Alert` naming devices signed out |
| Expired | Per-site grant list, per device line | `StatusBadge tone="neutral"` "Expired" on that line only; no action offered (see Screen 5) |
| Loading / Empty | Per-site grant list | Unchanged from `SiteEditorsCard` today |

---

## Design system gaps

Report-only, per the contract.

1. **No collapsible/disclosure primitive.** Screen 3 needs to show potentially several
   device-grant lines per editor. The inventory has no `Accordion`; `DropdownMenu` exists but is
   built for actions/navigation, and using it to display a read-only list would be a misuse, not
   a gap-fill. This design renders the grant lines flat rather than inventing a disclosure
   component — acceptable because `activeDevices` today is observed as a small count (1–2) in
   the existing product; flagged in case a future story needs to show materially more per row.
2. **Existing gap #1 (no toast) applies here.** The per-row outcome report (Screen 2) is
   deliberately inline and blocking-dialog, not a toast, for exactly the reason gap #1 already
   states — there is nowhere else to put it.
3. **Existing gap #2 (no `aria-invalid`/`aria-describedby` on form fields) applies to the email
   field in Screen 1**, same as every other form in the product. Not new, restated so Execute
   doesn't treat this dialog as an exception.
4. **`listSiteEditors` does not return device-grant expiry** (Screen 3) — this is a **data**
   requirement, not a design-system gap in the token/component sense, but it blocks the screen as
   designed and is recorded here per the brief's explicit instruction so it isn't lost before
   Plan.
