# Design — Story s70-content-changes

Proposed split (see `docs/research/s70-content-changes.md` § Split proposal and
`docs/plans/s70-content-changes.md`): **s70a-embed-ui-not-content** (no UI),
**s70b-changes-page** (the global page, this document's main screen), **s70c-site-content-tab**
(the same view under a site).

Design system: `docs/design-system.md` (s66a revision, enforced: square containers, 2px controls,
flat panels, one page frame, the page-shell guard R1–R7, the radius guard at zero). Page frame:
`PageShell` (ADR 053). Site subpages: ADR 052. Data: ADR 054.

## Owner input

- 2026-10-08, on `/dashboard/content`: "what is the content page about ?? it doesn't look great to
  me."
- 2026-10-08, accepted direction: a "Changes" page; edited/pending/published by default, "all
  discovered text" as a filter; grouped site → page; dense rows with a readable location, the
  current text, expand to compare with the original, status, who/when, actions (open on the page,
  history, revert where supported); the same view as a "Content" tab on the site pages; the
  embed's own UI never shown as content.

## Mockup

`docs/designs/s70-content-changes.html` — visual reference, dark theme, the real tokens of
`src/app/globals.css`, fixture data only (every domain `.example`, every address
`@example.com`). DO NOT copy into production: Execute builds with `src/components/ui/*`.
Sections: A global page at 1280 · B at 375 · C row anatomy · D states · E revert dialog and sheet ·
F the site Content tab at 1280 and 375.

## Screen(s)

### Route map

```
/dashboard/changes                    Changes: every site, grouped site → page        (s70b)
/dashboard/content                    308 → /dashboard/changes (next.config redirects) (s70b)
/dashboard/sites/<id>/content         Site › Content: the same view, one site          (s70c)
```

Sidebar: "Content" becomes **"Changes"** (same icon, same place). Breadcrumbs read "Changes".
The Overview "Total edits" metric links to `/dashboard/changes`.

### Global page — `/dashboard/changes`

`PageShell`:

| Slot | Content |
|---|---|
| `title` | Changes |
| `description` | What changed on your sites, page by page. |
| `actions` | none |

Sections, in order (direct children of the shell, 24 px apart, 16 below 640):

1. **Filter row** (design system, Shell › Filter row): `flex flex-wrap gap-2`.
   - Search `Input` with the search icon, `flex-1 min-w-[12rem]`, placeholder "Search text or
     page". Server-side, debounced 250 ms; searches the original, live and draft text and the page
     path.
   - Site `NativeSelect` (global page only): "All sites", then each site by name.
   - Status `NativeSelect`, with counts from the server:
     `Changes (15)` (default: pending + published) · `Pending (3)` · `Published (12)` ·
     `All text (1,248)` (adds original rows).
   - Below 640 each select takes the full row (as today's filter bar, s66b design §4).
2. **Result line**, 12 px muted, `aria-live="polite"`: "15 changes on 2 sites" / "Showing 50 of
   1,248 text elements".
3. **One panel per site** (`Card`, `rounded-container`, 1px `border`, flat), in order of each
   site's most recent change:
   - **Site header** (48 px, `border-b`, `px-4`): site name (14/600) · domain in mono 12 muted ·
     two `StatusBadge`-tone counts "3 pending" (warning) "12 published" (success) · a ghost `sm`
     link "Site page" → `/dashboard/sites/<id>` on the right.
   - **Page band** per page (36 px, `bg-surface-1`, `border-b`, `px-4`): the page label
     ("Homepage", `h3`, `text-sm font-medium`) · the path in mono 12 muted ("/") ·
     the row count on the right in 12 muted tabular. `NULL` page paths group under
     "Every page" with the note "Shared by every page (set with data-rcf-id)".
   - **Rows** (`<ul>`, each `border-b`, the last none). Anatomy below.
4. **Load more**: when the server says there is more, an outline `sm` button "Show 50 more" with
   "Showing 50 of 1,248" beside it. Rows append; groups merge by site and page.

Ordering: rows are paged from the server newest change first (`changed_at desc, id`); the client
groups the loaded rows site → page, keeping the order of first appearance. A load-more that adds
rows to an existing group adds them under it; a new group appears at the end.

### Row anatomy (≥ 768)

One line, 44 px minimum, `px-4`, CSS grid
`32px 96px minmax(10rem,1.1fr) minmax(0,2fr) 11rem auto`:

| Column | Content |
|---|---|
| Expand | `Button` ghost `icon-sm`, chevron, `aria-expanded`, `aria-controls` the detail region, named "Compare and history: <location>" |
| Status | `StatusBadge`: Pending (warning, `Clock`), Published (success, `Upload`), Original (neutral, `FileText`, only under All text) |
| Location | `describeLocation(row)`: "Main heading", "Hero · Button", with the page already in the band. Author ids win: `data-rcf-id="hero-title"` → "Hero title". 14/500, truncates |
| Text | The text that matters for the state: the **draft** for Pending, the **live** text for Published, the original for Original. One line, truncated with an ellipsis, `title` holds the full string. Images render as a 32 px `ContentValue` thumbnail plus the file name |
| Who · when | 12 muted: "ana@example.com · 2 h ago" (`formatDistanceToNow`, full date in `title`). No "who" when the caller cannot read history (non-admin) or the writer left none (import, API, A/B): the time alone |
| Actions | "Open ↗" ghost `sm` link (new tab, `noopener`) to `https://<domain><page_path>`; ⋮ ghost `icon-sm` "More actions for <location>", **visible at rest** |

Below 768 the row stacks (16 px padding):

```
[▸] [Pending]  Main heading                        [⋮]
    Ship copy changes in minutes, not sprints
    (two-line clamp)
    ana@example.com · 2 h ago                 Open ↗
```

Never shown in a row: the element id (`rcf-…`) or the CSS selector. They live under "Technical
details" in the expanded region, for support.

### Human-readable location (`src/lib/content/describe-location.ts`, pure, unit-tested)

Page label (used in the band):

| `page_path` | Label |
|---|---|
| `/` | Homepage |
| `/pricing` | Pricing |
| `/blog/how-we-ship` | Blog › How we ship |
| `/products/alpha/setup` | Products › Alpha › Setup (three segments or fewer: whole) |
| `/docs/a/b/c` | Docs › … › B › C (deeper: the first segment, then the last two) |
| `NULL` | Every page |

Element label (the row's Location column) = `[place · ]element`:

- **element**, from `metadata.type`, else the tag of the selector's last segment: h1 "Main
  heading" · h2 "Heading" · h3–h6 "Subheading" · p "Paragraph" · li "List item" · button
  "Button" · a "Link" · img "Image" · label "Form label" · td/th "Table cell" · span "Text"
  (inside a `button`/`a` segment: "Button label"/"Link text") · `div[data-rcf-content]`
  "Content block" · anything else "Text". An author id (an `element_id` not starting `rcf-`)
  replaces the element label, humanized ("hero-title" → "Hero title").
- **place**, at most one, nearest to the element first: a landmark segment (`header`
  "Header", `nav` "Navigation", `footer` "Footer", `aside` "Sidebar", `form` "Form"); the
  anchoring `#id`, humanized, unless it is a framework root (`#root`, `#__next`, `#app`,
  `#__nuxt`, `#___gatsby`); a class word from a fixed list (`hero`, `pricing`, `faq` "FAQ",
  `features`, `testimonials`, `cta` "Call to action", `banner`, `about`, `contact`, `team`,
  `blog`). A place equal to the page label is dropped (`#pricing` on `/pricing`).

Examples (all in the unit test table):

| page_path · selector · type | Band · Location |
|---|---|
| `/` · `#root > main > section.hero > h1` · h1 | Homepage · Hero · Main heading |
| `/pricing` · `#pricing > div.grid > div:nth-child(2) > button` · button | Pricing · Button (place = page, dropped) |
| `/` · `#root > main > div.cta > button > span` · span | Homepage · Call to action · Button label |
| `/` · `body > header > nav > a:nth-child(3)` · a | Homepage · Navigation · Link |
| `NULL` · `[data-rcf-id="hero-title"]` · h2 | Every page · Hero title |
| `/blog/how-we-ship` · `article > p:nth-child(4)` · p | Blog › How we ship · Paragraph |

The text is the primary identifier; the label orients. Two "Paragraph" rows on one page are told
apart by their text.

### Expanded row (the detail region)

`bg-surface-1`, `border-t`, `px-4 py-3` (16 at < 640), `role="region"`, labelled by the row:

1. **Compare.** Columns at ≥ 768 (`grid` with `minmax(0,1fr)` tracks), stacked below:
   - "Original" — what ReCopyFast first read;
   - "Live now" — `published_content` (or the original when never published);
   - "Draft" — only for Pending.

   Each: `.text-eyebrow` label, then the full text through `ContentValue` (images at their frame,
   data URIs summarised), `overflow-wrap: anywhere`. When Live equals Original on a Published row
   (attribute-only publish, or a revert published): a muted line "Text is the same as the
   original." No word-level highlighting (design-system gap 2).
2. **Actions** (visible at rest, left-aligned, `flex-wrap gap-2`), by state and the caller's grant
   on the site:

   | State | edit | publish / admin |
   |---|---|---|
   | Pending | Discard draft (ghost) | Publish (default `sm`) · Discard draft |
   | Published | Revert to original (outline `sm`) | Revert to original |
   | Original | — | — |
   | all | Edit on page (ghost `sm`, opens an edit session at this row's page) | same |

   A `view` member sees no write action.
3. **History** (lazy, loaded on first expand from `GET /api/content/changes/<rowId>/history`): a
   list, newest first, at most 20, each line `action · who · when` and the new text clamped to two
   lines: "Published", "Draft saved", "Reverted to original (draft)" (a draft whose text equals
   the original), "Discovered" (from `created_at`, always last). For a non-admin: "Only this
   site's admins can see who changed what." and the "Discovered" line. Loading: three skeleton
   lines. Error: an inline destructive `Alert` with Try again.
4. **Technical details** (a `details` disclosure, collapsed): element id and selector in mono 12 on
   `bg-surface-2`, language and variant when not `en` / `default`.

The ⋮ menu mirrors the panel: Open on page · Edit on page · Compare and history (expands) ·
separator · Revert to original / Discard draft (by state and grant). Publish stays in the panel
only, beside the draft it publishes.

### Revert (Published rows)

"Revert to original" opens a `Dialog` (448), never a one-click write:

- Title "Revert to the original text?"; description "Main heading on Homepage, acme.example".
- Body: "Live now" and "Original", stacked, each in a `bg-surface-1` block.
- Footer, right-aligned, primary last: Cancel · **Save as draft** (outline) · **Revert and
  publish** (default; only with publish/admin). Without publish rights the primary is "Save as
  draft" and a muted line says "It goes live when someone with publish rights publishes it."
- Requests (existing routes, ADR 042 paths): `PUT /api/staging/content/<site>`
  `{ elementId, content: original, language, variant }`; then, for "Revert and publish",
  `POST /api/staging/publish` `{ siteId, elementIds: [elementId] }`.
- Pending: buttons disabled with a spinner in the pressed one; the dialog stays open on failure
  with the server's message in a destructive `Alert` (402 "plan ended" included). One write at a
  time per element: while it runs (and until its re-read lands), every other language and variant
  row of the same element has Publish, Discard draft and Revert to original disabled too, in the
  panel and in ⋮, without a spinner. Rows of other elements stay usable.
- Success: the buttons keep their spinner until the page has read the element again (every
  language and variant row of it: Publish promotes them all) and the counts; then the dialog
  closes, the rows update in place as the server now holds them (Pending, or Published with "Text
  is the same as the original."), and the result line announces "Reverted. Saved as a draft." /
  "Reverted and published." politely. No toast (gap 1). If that read fails, the row says "This
  went through, but the row could not be read again and may be out of date. Reload the page to see
  it as it is now." (s70b fix pass)
- Below 640: the bottom sheet (design system, Dialogs and sheets), buttons full width, primary on
  top.

"Discard draft" (Pending) is the same dialog shape: "Discard this draft?" — body shows Draft and
Live now — Cancel · **Discard draft** (destructive). Request: `PUT …` with the live text, plus each
attribute the draft stages (`href`, `alt`) with its live value, which the save RPC drops from the
draft (`{ elementId, content, language, variant, href?, alt? }`). When one cannot go back that way
(no live value, a key the PUT does not know, a value it would trim or refuse), Discard is not
offered and the expanded row says "This draft changes a link or image attribute, which can't be
discarded here. Change it on the page."; when the staged attributes could not be read, it says
"This draft could not be read in full, so it can't be discarded here. Reload the page to try
again."
Just before the PUT, Discard reads its row again and builds the PUT from that read (s70b fix pass):
if the draft was published, replaced or gone meanwhile (another tab, an editor on the live page),
nothing is sent, the dialog closes on the row as it now is, and the row says "This change was
updated elsewhere — review it again." (followed by "The row could not be read again and may be out
of date. Reload the page to see it as it is now." when that read fails).
A draft on text that was never published (a translation: no published text of its own, "Live now"
shows the original) is not offered Discard: the staging PUT cannot clear a draft, and saving the
original keeps it pending. The expanded row says "This text was never published, so its draft
can't be discarded here. Edit or publish it on the page."
"Publish" (Pending, publish/admin) asks nothing more: the draft is visible right above it; the
request is `POST /api/staging/publish` with the one element id.

### Site tab — `/dashboard/sites/<id>/content` (s70c)

The site frame from `useSitePageShell` (title = site name, status badge, domain, "Edit website",
"Version history"), the subnav gaining **Content** after Overview:

`Overview · Content · Install · People & access · Settings`

Below 640 the five links wrap onto two lines (never clipped; design system, Controls › Tabs).

Body: the same view, `siteId` fixed: no site select, no site header; the page bands start the
panel. Empty state: "No changes on <site> yet" with **Edit website** (`EditWebsiteButton`, the
caller's grant) when the caller may edit; "Show all text" otherwise.

## Reused components (from the design system)

- `PageShell` — both pages; the tab through `useSitePageShell` and `SiteSubnav` (`nav` slot).
- `Card` (`default`) — one per site group; the tab's single panel.
- `StatusBadge` + `contentStatuses` — row status and the site header counts. Registry change:
  `edited` retired, `published` added (success, `Upload`, "Live on your site, different from the
  original"); `pending` keeps warning ("Saved as a draft, not live yet").
- `Input` (search, icon-in-input spec), `NativeSelect` (site, status; ADR 051).
- `Button` — ghost `icon-sm` expand and ⋮; ghost `sm` Open, Edit on page; outline `sm` Revert,
  Show 50 more; default `sm` Publish; destructive Discard in the dialog.
- `DropdownMenu` — the row's ⋮ (opaque `bg-popover`, `shadow-md`).
- `Dialog` (`DialogHeader`, `DialogBody`, `DialogFooter`) — revert, discard; bottom sheet < 640.
- `ContentValue` — every text and image value, row thumbnail and compare.
- `Skeleton` — loading rows and history lines. `EmptyState` — no sites, no changes. `Alert` —
  page error, row action error, history error.
- `useEditSession` — "Edit on page", with a new optional `path` (the edit URL's host is still
  checked by `validEditUrl`; only the path changes).

## States

| State | Global page | Site tab |
|---|---|---|
| Loading | Filter row rendered and usable; one panel with a 48 px header skeleton, one band skeleton and six 44 px row skeletons (`Skeleton`, square) | same, no header skeleton |
| No sites | `EmptyState` (Globe): "Add a site to see its changes here." · **Add site** → `/dashboard/sites` | n/a |
| No changes (default filter) | `EmptyState` (FileText): "No changes yet." / "Text you or your editors change shows up here, grouped by page." · **Show all text** | "No changes on Acme Studio yet." · Edit website / Show all text |
| No matches | Inside the panel area: "Nothing matches “pricng”." · ghost "Clear search" | same |
| Error (list) | `Alert variant="destructive"`: "Changes could not be loaded." + the reason + **Try again**. Never the empty state | same |
| Error (row action) | Inside the dialog, or under the panel's action row for Publish: destructive `Alert`, `role="alert"` | same |
| No answer (row action) | The connection dropped before the server answered, or no answer came within 30 s (the page then drops the request): the row is read again, the dialog closes onto it, and under its actions: "The connection dropped before the server answered, so the draft may or may not have been discarded / the revert may or may not have been saved / it may or may not have been published. Check the row before trying again." No announcement | same |
| Success | Once the element is read again: its rows update in place; polite announcement in the result line | same |

## Accessibility

- One `h1` (PageShell). Site headers are `h2`; page bands are `h3`.
- The expand button carries `aria-expanded` / `aria-controls`; the region is labelled by the
  row's location and status.
- Every action has a full accessible name ("Open Main heading on acme.example/ in a new tab",
  "More actions for Main heading").
- Focus: after a dialog closes, focus returns to the button that opened it; after Discard the row
  keeps focus on its expand button.
- Touch: ⋮ and the panel's actions are visible at rest (design system, Don't: hover-only actions).

## Performance

- The list request returns at most 50 rows; filters, search, ordering and paging run in Postgres
  (ADR 054). The default view loads only changed rows.
- No call to `GET /api/sites` (the ~4 s route): the list route returns the caller's sites itself.
- Counts for the status select come from three `count: exact, head: true` reads in parallel, with
  the same site and search filters.
- History loads per row, on first expand, and is kept for the page's lifetime.
- No virtualization: a loaded list is ≤ 50 × k rows of 44 px; "Show 50 more" bounds the DOM by
  what the owner asks for.

## Design system gaps

Report-only; none is filled in this story.

1. **Toast** (gap 1): success is the row's new state plus a polite line, not a toast.
2. **No diff primitive**: compare is side by side, without word-level highlighting. Long paragraphs
   with one changed word are hard to compare; a `TextDiff` primitive (tokens: `tone-success` /
   `tone-danger` surfaces, never colour alone) would answer it.
3. **No `Table` primitive** (gap 8): this is the fourth list composed from `<ul>` rows (s05, s16,
   s66c Sites, here). The row and band values here use the documented "Table header / row 36 / 44,
   px-4" spec (backlog `s66d`); promotion is that story's.
4. **No expandable-row pattern**: composed from a ghost `icon-sm` button with `aria-expanded` and a
   region. Documented here; codify if a second list needs it.
5. **No element highlight on the customer's page**: "Open on page" lands on the page, not on the
   element. Highlighting needs embed bytes (unfunded).
