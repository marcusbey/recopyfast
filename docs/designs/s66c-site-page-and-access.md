# Design — Story s66c-site-page-and-access

Proposed split: **s66c1-site-pages** (subpages, light list, one access model, Edit website) and
**s66c2-quick-setup** (guided quick setup that ends Live, per-site API keys). See
`docs/stories.md` and `docs/plans/s66c-site-page-and-access.md`.

Research: `docs/research/s66-app-design-system.md` § Information architecture, re-verified
against `origin/main` `d4dae46` (s66a, s68a/b/c merged). Design system: `docs/design-system.md`
(s66a revision). Page frame: s66b1's `PageShell` (ADR 053 on the s66b branch). Routing: ADR 052.

## Owner input

- 2026-10-07: "https://www.recopyfa.st/dashboard/sites is overwelming. have multiple levels of
  settings. and invite a client, and editors are confusing. which one to use and when ?"
- 2026-10-08, accepted direction:
  - one URL per site, with Install, People & access and Settings;
  - exactly two access actions, each with a one-line explainer;
  - "Invite a client" is removed;
  - the card's "Settings" button is renamed;
  - Delete can be reached without hover;
  - a lighter Sites page.
- 2026-10-08, with a screenshot of the card's "Settings" button and its "Edit Website" dialog:
  "also i told u this page https://www.recopyfa.st/dashboard/sites is overwelming. u need to have
  subpages to it. steps for user with advanve or quick setting."

## Screen(s)

### Route map

```
/dashboard/sites                          Sites: a light list (one row per site)
/dashboard/sites/<id>                     Overview: quick setup (s66c2) or checklist (s66c1), metrics, details
/dashboard/sites/<id>/install             Install: snippet once, where to paste it, site token
/dashboard/sites/<id>/people              People & access: Add editor | Share preview link, two lists
/dashboard/sites/<id>/settings            Settings (advanced): general, domain, API keys*, webhooks,
                                          import & export, danger zone          (* s66c2)
```

Every site subpage renders through `PageShell`:

| Slot | Content |
|---|---|
| `title` | The site name. This is the page's only h1. |
| `meta` | `StatusBadge`. |
| `description` | The domain as an external link (`acme.example ↗`). |
| `actions` | "Edit website" (default) and "Version history" (outline). |
| `nav` | `SiteSubnav`: Overview · Install · People & access · Settings. |

`SiteSubnav` is a `<nav aria-label="Site">` of four links with `aria-current="page"`. It uses the
underline-tab look (s66a Tabs spec: a 40 px trigger and a 2 px `primary` bottom border on the
current link). Links push history, so Back and Forward walk the subpages and Back from Overview
returns to Sites. Below 640 px the four links wrap and are never clipped; at 375 they fit on one
line (≈330 of 343 px).

Back-compat: the old detail view had no URL, so nothing needs a redirect. These entry points are
re-pointed:

| Entry point | New target |
|---|---|
| Sites row | The site's own URL |
| Registration success panel | Gains "Open site page" (→ Overview) |
| Overview "Your sites" rows (`/dashboard`) | Each site's page, not `/dashboard/sites` |
| Teams-moved notice | Names People & access |
| `/docs/install` steps (`installation-content.ts:118-119, :216, :226`) | Name the new pages and labels |

An unknown subpath 404s through the dashboard's existing `not-found`.

### Sites list (`/dashboard/sites`): light

Kept: `PageShell` (title "Sites", description, "Add site"), then the status filter, search and
sort.

The card grid becomes **one bordered list, one row per site**. A row holds:

- an `IconTile` globe;
- the **site name as a link** to the site page, with the domain under it in mono 12 muted;
- the `StatusBadge`, followed by "Last edited …";
- **one primary action, chosen by status**:
  - Awaiting install: **Continue setup**, an outline `sm` button linking to the site Overview;
  - Live or Stale: **Edit website**, an outline `sm` button that starts the edit session.
- **⋮, visible at rest.** It is an `icon-sm` ghost button named "Open menu for <name>", reachable
  by keyboard. Its menu holds Open site page, Edit website, Share preview link, a separator, and
  Delete site (danger).

Removed from the face of the card:

| Removed | Where it went |
|---|---|
| The Edits / Views / Activity metrics | Edits and activity are on the Overview. Views is never computed: `route.ts:156` returns 0 with a TODO. |
| The hover-only "Copy domain" | Dropped |
| "View Details" | Replaced by the name link and "Open site page" |
| "Settings" | Renamed "Edit website" |
| The share icon | Moved into the menu |

Visible controls per site: 7 → 3 (name link, primary action, ⋮). None needs hover.

Row widths:

| Width | Layout |
|---|---|
| ≥ 768 | One line: identity · status · last edited · primary · ⋮ |
| < 768 | Name and ⋮ on the first line, then the domain, status + last edited, and the primary action left-aligned |

There is no `Table` primitive (gap 8). The list is a `<ul>` of `border-b` rows inside one
`rounded-container` bordered panel: 16 px padding, 64 px minimum row height.

Delete from the menu opens the shared `DeleteSiteDialog`, the same `DELETE /api/sites/[siteId]`
and the same confirmation, in sentence case: "Delete site?" / Cancel / "Delete site".

### Site Overview (`/dashboard/sites/<id>`)

1. **Quick setup** (s66c2; the owner's "quick" path; mocked). It replaces `ActivationChecklist`:
   one component, the same `useSiteActivation` data and the same dismissal. It is a vertical
   stepper whose step markers reuse the registration panel's square numbered marker (`InstallStep`,
   extracted to `src/components/dashboard/InstallStep.tsx`):
   1. **Site added.** Always ✓. Shows name · domain.
   2. **Install the snippet.** A `CodeBlock` (HTML, "Copy snippet"), then one line, "Paste it just
      before `</body>` on every page you want to edit.", then a "Platform instructions" link (→
      Install). Then a **live status row**:
      - "Waiting for the first page view on acme.example. Checking every 5 seconds." Neutral
        tone, with a spinner.
      - When the provider's poll sees `live`, it turns into "Installed. ReCopyFast saw
        acme.example a few seconds ago." Success tone, with no reload.
      - Complete when activation says `installed`, or the site's status is no longer
        `awaiting-install`.
   3. **Start editing.** "Edit the copy yourself, or add the person who will."
      - [Edit website]: default; disabled with the hint "Available once the snippet is
        installed" until step 2 is done.
      - [Add editor]: outline; opens the Add editor dialog with View+Edit+Publish preset.
      - Complete when `invited` or `published`.

   The current step is expanded. Done steps are collapsed to one line with ✓, and future steps to
   their number and title. The header reads "Quick setup · Step 2 of 3", with a ghost "Hide quick
   setup" (the existing dismissal).

   **Done means Live.** Once the site is live, the panel header becomes "Setup complete — <name>
   is live" in the success tone. Step 3 stays offered until it is done or hidden, then the panel
   leaves the page.

   **Resumable**: every step's state comes from the server (site status plus `/activation`), so
   leaving and coming back lands on the first incomplete step.
2. **Metrics**: three `Metric`s, Edits · Content elements · Last activity. "Page views" is dropped
   because it is never computed.
3. **Site details**: a definition list of Created, Last updated, and Site ID (mono, with a
   `CodeBlock`-style copy).

**s66c1 interim** (not mocked): until s66c2 lands, the Overview shows today's `ActivationChecklist`,
relabelled (the "Add editor" step and the "Edit website" action, below), above the same metrics
and details.

### Install (`/install`)

- If a regeneration just succeeded: Alert success, "Snippet regenerated" (existing copy).
- **Installation** panel (`SiteInstallationCard`). The header is unchanged: IconTile, "Installation"
  and `StatusBadge`. The body, in order:
  - the mismatch warning (`awaiting-install` only);
  - the state line (live: "ReCopyFast detected … Editing is on", "Last report …"; stale: the
    warning);
  - **the snippet, exactly once**: a `CodeBlock` labelled HTML, "Copy snippet", wrapping. It is
    shown in **every** state. Live and stale no longer hide it behind "View install snippet": the
    page is itself the disclosure;
  - "Where to paste it": underline `Tabs` WordPress · Next.js · Plain HTML, recipe text only, with
    no snippet per tab;
  - the "Checking automatically" info Alert (awaiting only);
  - the "Installation guide" link.
- **Site token** panel. It holds the explainer (today's copy, unchanged); a `CodeBlock` labelled
  "Token" with "Copy site token"; and an outline "Regenerate snippet" button. The button opens the
  existing confirmation ("Regenerate snippet?" / "Regenerate now") and calls the same
  `POST …/regenerate-snippet`.
- **No install credentials** (a member who is not an admin): the Installation panel shows the
  status only, plus an info Alert, "Only this site's admins can see its install snippet." The
  placeholder `YOUR_SITE_TOKEN` snippet is no longer shown.

Domain ownership moves to Settings: it is optional and blocks nothing (its own copy says so).

### People & access (`/people`)

Two option blocks, side by side from 768 px and stacked below. Each holds an eyebrow, a one-line
explainer and exactly one button:

| Eyebrow | Explainer | Button |
|---|---|---|
| ONGOING ACCESS | "For someone who keeps editing this site. They sign in with a code sent to their email and keep access until you remove them." | **Add editor** (default) |
| ONE-OFF REVIEW | "For a one-off review of unpublished changes. View only unless you allow more, and the link stops working after the time you choose." | **Share preview link** (outline) |

The Add editor explainer deliberately does not promise publishing: the form's default is
View+Edit (`InviteEditorForm.tsx:46`), and Publish is one tick away.

Below the two blocks:

- **Editors · N.** `SiteEditorsCard`, now list-only:
  - rows (`SiteEditorRow`): email, permission badges, devices signed in, "Resend invite",
    "Remove";
  - a "Previously removed" sub-list;
  - the remove confirmation;
  - the resend and remove notices.

  Empty: `EmptyState` "No editors yet", with steps starting "Choose Add editor above." A member who
  is not an admin sees the existing "You cannot manage editors on this site".
- **Preview links · N.** A new `PreviewLinksList`. It uses `ShareLinkCard` rows (label or email,
  "Expires Oct 14", Pending or Expired badge, permission badges, copy and revoke) over a
  `usePreviewLinks(siteId)` hook. That hook moves the `GET` and `DELETE /api/staging/access` calls
  out of the dialog. Empty state: one line, "No preview links. Share one when you want a review
  before you publish." A 403 shows "You cannot manage preview links on this site."

The two dialogs, both following the s66a Dialog rules (512 px; a bottom sheet below 640):

- **Add editor** (new `AddEditorDialog`). Description: the ONGOING ACCESS explainer.
  - Body: `InviteEditorForm` (Editor email; Permissions View/Edit/Publish/Admin, default View+Edit;
    "Higher permissions include the ones below them.").
  - Footer: Cancel and Add editor.
  - On success the body becomes the delivery notice. "We emailed x an invitation", or the existing
    manual fallback with the editor hub link and "Copy link". A seat limit shows the existing
    warning and "View plans". The footer's only button is then "Done".
  - The same component, endpoint and notices serve the checklist and the stepper; those callers
    pass the View+Edit+Publish preset.
- **Share preview link** (`ShareSiteDialog`, now **create-only**: the active links live on the
  page).
  - Description: the ONE-OFF REVIEW explainer.
  - Body: Email address; Permissions with **View only ticked by default** and the help "Edit and
    publish let the reviewer change unpublished copy."; Expires in (`NativeSelect`, 7 days); Label
    (optional).
  - Footer: Cancel and Create link.
  - After a send, the grant resets to View only. The s68c `409` ("This address was removed as an
    editor of this site. Re-add them as an editor…") renders in the dialog's destructive Alert as
    it does today.
  - Opened from a Sites row menu, it is the same create-only dialog. Its success Alert adds a link,
    "See preview links", to that site's People & access.

### Settings: advanced (`/settings`)

The first line under the nav reads "Advanced settings. You don't need any of these to start
editing." Then, as `Card` panels at the 24 px section gap:

1. **General.** A read-only definition list on `bg-surface-1`: Name, then Domain. A muted note
   follows: "Renaming a site or changing its domain isn't available yet."
2. **Domain ownership.** The existing `DomainVerification`, unchanged; it was moved here.
3. **API keys** (s66c2). `ApiKeysPanel` with a new `siteId` prop, which hides its site selector.
4. **Webhooks.** The existing `WebhooksPanel`.
5. **Content import and export.** The existing `BulkOperations`. Its "History" tab is renamed
   **"Operation history"**, so the word no longer means two things: version history is the header
   action. The new name keeps `/history/i` in `BulkOperations.test.tsx:506,516,527` matching.
6. **Danger zone.** A `Card` with a `border-tone-danger-border` border, holding one row:
   - "Delete site": "Permanently delete Acme marketing site, its content, editors and preview
     links. This can't be undone.";
   - a [Delete site] button (destructive).

   It opens the shared `DeleteSiteDialog`. On success the app navigates to `/dashboard/sites` with
   `replace`, so Back does not return to a deleted site. The creator-only `403`
   (`api/sites/[siteId]/route.ts:43-48`) renders in the dialog.

### Edit website (row, menu, header, checklist step, stepper)

One `EditWebsiteButton`, rebuilt on `Button` (`rounded-control`, so the pill is gone), over a
`useEditSession` hook extracted from `ActivationChecklist.handleEdit`:

1. It opens `about:blank` synchronously on click, which keeps the popup permission.
2. It POSTs `/api/edit-sessions/create`.
3. It navigates the tab only to an http(s) URL on the registered host (`validEditUrl`).

There is **no confirmation dialog**. The "Edit Website" dialog said one sentence and offered the
same button again. There is **no DOM toast**: the emerald `innerHTML` toast is removed, and the
new tab is the feedback.

When the popup is blocked or the request is refused, the tab is closed and an inline
`Alert variant="destructive"` sits under the control ("Allow pop-ups for ReCopyFast, then try
again.", or the server's message). The spinner is `Loader2`, and the label stays "Edit website".

The request body stays per entry point, unchanged from today:

| Entry point | Body |
|---|---|
| Row, menu, header | `permissions: ["edit","admin"]`, `durationHours: 2` (what `EditWebsiteButton` sends for an owner) |
| Checklist and stepper | `["edit","publish"]` |

## Labels

| Today | s66c | Where |
|---|---|---|
| Card "Settings" (starts an edit session) | **Edit website** | Sites row, menu, site header |
| "Edit Website" dialog | removed | `sites/page.tsx:608-641` |
| "Open site in edit mode" | **Edit website** | Checklist / stepper |
| "Invite a client" (step, button, dialog) | **Add editor** | Checklist / stepper, `/docs/install` |
| "View Details" | the site name link + **Open site page** (menu) | Sites row; `/docs/install` |
| "Delete Site" | **Delete site** | Menu, Danger zone, confirmation |
| "Embed Script" / "Copy Embed Script" | merged into Install's one **Copy snippet** | Install |
| "Site Token" / "Copy Site Token" | **Site token** / **Copy site token** | Install |
| "History" (two meanings) | **Version history** (header) · **Operation history** (import/export tab) | |
| "Share" (detail header) | removed; **Share preview link** in People & access and the row menu | |
| Teams notice "…that site's Share panel" | "…that site's People & access page" | `sites/page.tsx:344` |

**Why "Edit website", not "Open editor".** The story's first wording said "Open editor". But in
this product "editor" is already a person: "Add editor", the "Editors" list, the "editor hub" at
`/edit`. "Open editor" next to "Add editor" recreates the very ambiguity the owner reported. Owner
question 1 in the plan carries the alternative.

## Click counts, before and after

Counted from the Sites list, signed in, at 1280. Pointer clicks only; typing is not counted.

| Task | Today | Clicks today | s66c | Clicks |
|---|---|---|---|---|
| Copy snippet, site awaiting install | View Details → checklist Copy snippet | 2 | Continue setup → Copy snippet (Quick setup step 2) | 2 |
| Copy snippet, live site | View Details → scroll ≈1,690 px → Copy Embed Script | 2 + scroll | name → Install → Copy snippet | 3, no scroll |
| Add editor | View Details → scroll ≈870 px → toggles → Add editor | 2 + scroll | name → People & access → Add editor → Add editor | 4, no scroll |
| Share preview link | share icon → Create link | 2 | ⋮ → Share preview link → Create link | 3 |
| Delete site | hover → ⋮ → Delete Site → Delete Site | 3, **hover only: impossible on touch** | ⋮ → Delete site → Delete site (or name → Settings → Delete site → Delete site) | 3 (4), touch works |
| Edit website | Settings → Edit Website (in the dialog) | 2 | Edit website (live row) | 1 |
| Regenerate snippet | View Details → scroll → Regenerate → Regenerate now | 3 + scroll | name → Install → Regenerate snippet → Regenerate now | 4, no scroll |
| Version history | View Details → History | 2 | name → Version history | 2 |
| Webhooks, import/export | View Details → scroll ≈3,000 px | 1 + scroll | name → Settings | 2, no scroll |
| New site to first edit (s66c2) | Close → View Details → Copy snippet → … → Open site in edit mode | 4, no guidance | Open site page → Copy snippet → … → Edit website | 3, guided |
| Reach any of the above from a link or bookmark | impossible (no URL) | — | `/dashboard/sites/<id>/<page>` | 0 |

Plainly: click counts move by ±1. What the change removes is up to 3,000 px of scrolling, every
hover-only action, two of the three copies of the snippet, and the choice between two
identical-looking invite forms. What it adds is a URL for every place.

## Mockup

`docs/designs/s66c-site-page-and-access.html` is a visual reference, dark theme, using the real
tokens from `globals.css`. **Do not copy it into production**: Execute builds with the real
components. Its frames, each at 1280 and 375:

- the Sites list;
- the site Overview (Quick setup, step 2 active), plus a 1280 frame of the done state;
- Install;
- People & access;
- Settings (advanced);
- dialogs: Add editor (1280 and a 375 sheet), Share preview link (1280), and the open row menu.

Every token is `•••` and every address ends in `example`.

## Reused components (from the design system)

| Component | Where |
|---|---|
| `PageShell` / `PageHeader` (s66b1, ADR 053) | Every page: one h1, `meta`, `description`, `actions`, `nav` |
| `Button` | Every action, `rounded-control`. Default for the one primary per view, outline elsewhere, destructive in the Danger zone |
| `StatusBadge` | Row, header `meta`, Installation panel |
| `IconTile` | Row identity, Installation header, option blocks |
| `DropdownMenu` | The row ⋮ menu: opaque, square |
| `Card` | Every panel: flat, square. The Danger zone is a `Card` with `border-tone-danger-border` |
| `CodeBlock` | Snippet (Install, Quick setup), site token |
| `Tabs` | Recipes inside Installation, BulkOperations |
| `Dialog` | Add editor, Share preview link, Delete site, Regenerate, Remove editor; header / body / footer, one scroll region |
| `NativeSelect` | Expires in |
| `Alert` | Inline feedback, errors, the "admins only" note, the Edit website failure |
| `EmptyState` | No editors, Site not found, no sites |
| `Metric` | Overview metrics |
| `Skeleton` | Loading row list, loading site page |
| `Badge` | Permission chips (via `SiteEditorRow` and `ShareLinkCard`) |

## States

| Surface | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Sites list | 3 skeleton rows | `EmptyState` "No sites connected yet" (unchanged); filtered: "Nothing matches those filters" | Alert "Could not load your sites" + Try again | Rows |
| Site layout (every subpage) | `PageShell` with a skeleton title and nav; a skeleton panel | — | `PageShell` "Could not load this site" + Alert + Try again. Never "not found" | Subpage |
| Unknown or foreign id | — | `PageShell` "Site not found" + `EmptyState` "This site isn't in your account." + "Back to Sites" | — | — |
| Install | (layout) | No credentials: info Alert "Only this site's admins can see its install snippet." | Regenerate failure inside its dialog (unchanged) | "Snippet regenerated" Alert |
| People: editors | skeleton rows | "No editors yet" | Alert + Try again; forbidden note | Delivery notice (in the dialog), removal notice |
| People: preview links | skeleton rows | One line, "No preview links…" | Alert + Try again; 403 note | The new link appears in the list; dialog success Alert |
| Quick setup (s66c2) | skeleton steps | — (hidden when done or dismissed) | Alert "Could not load setup progress" + Try again | "Setup complete — … is live" |
| Edit website | `Loader2` in the button | — | Inline destructive Alert under the control | The new tab opens |
| Delete site | "Deleting…" in the confirm button | — | Error inside the dialog (incl. creator-only 403) | Row removed / `replace` to Sites |

## API and data gaps (flagged, not designed around)

1. **Rename a site or change its domain: no API.** `src/app/api/sites/[siteId]/route.ts` exports
   only `DELETE`. Changing `sites.domain` changes which origin `authorizeSiteRequest` accepts on a
   live install, so this is a separate API story. Settings shows both read-only, with a note.
2. **Who can delete is not in the payload.** `DELETE` allows only the creator (an `admin` row with
   `granted_by` null, `route.ts:43-48`). `GET /api/sites` returns neither `permission` nor
   `granted_by`, so the UI offers Delete to every admin and shows the 403 in the dialog, as today.
   Hiding it properly needs the list to return the caller's role: an API change, a follow-up.
3. **Page views are never computed** (`GET /api/sites` → `views: 0`, `route.ts:156` TODO). The
   UI stops showing the number. Computing it is out of scope.
4. **`GET /api/sites` is not RLS-scoped.** It uses the service client with an explicit
   `site_permissions.user_id = session user` filter (`route.ts:26-29, :46-51`). The site page's
   not-found guarantee rests on that filter. The story said "the RLS-scoped `GET /api/sites`"; the
   ACs are corrected.
5. **No API or data change is needed for anything designed here.**
   `git diff main...HEAD -- src/app/api supabase public/embed server` stays empty in s66c1 and
   s66c2.

## Design system gaps

Report-only. Nothing here invents a primitive.

| Need | Gap | How s66c composes it |
|---|---|---|
| Site sub-navigation | — | Not a gap. ADR 053's `PageShell nav` slot is "underline Tabs, or links with a bottom border". `SiteSubnav` uses links (`aria-current`) with the Tabs trigger spec. Extract it into `ui/` only if a second page family needs one. |
| A list of rows (Sites) | 8 (no `Table`) | A `<ul>` of `border-b` rows in one bordered panel, like `s16`'s delivery history. This is the third such list: worth promoting in s66b2 or later. |
| Stepper (Quick setup) | **new gap 14** | There is no stepper primitive. The square numbered marker exists only inside `SiteRegistrationModal` (`InstallStep`). s66c2 extracts it to `components/dashboard/InstallStep.tsx` (dashboard-local, two consumers) rather than adding `ui/steps.tsx`. |
| "Edit website" success | 1 (no toast) | Not needed: the new tab is the confirmation. The emerald DOM toast is deleted, not replaced. |
| Delete confirmation | 11 (irreversible actions) | Unchanged: a simple confirmation, not type-to-confirm. Still open. |
| Version history sheet | 12 (no side sheet) | Unchanged: the hand-rolled `VersionHistoryPanel`, opened from the header. s66c does not decide gap 12. |
