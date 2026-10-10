# Design — Story s66a-app-design-tokens-and-panels

Agent path. Derived from `docs/design-system.md` (s66a revision, 2026-10-08), with layout
evidence from `docs/research/s66-app-design-system.md`.

Today's captures are in `docs/designs/s66-app-design-system/current/`:
- `site-registered-replica-*.jpg`
- `share-dialog-*.jpg`
- `sort-menu-1280.jpg`

Supabase is a reference for structure and density only: hairline borders, dividers, a single
scroll region, a footer with right-aligned actions. Visual identity comes from the design system
alone: the teal accent, cool hue-200 greys, Instrument Sans, JetBrains Mono.

## Screen(s)

Three things are drawn: the two panels the owner pointed at, and the primitives they are built
from. Nothing else in the app is redesigned in this story.

### 1. Site-registered panel (the success state of `SiteRegistrationModal`)

Reached from Sites or Overview: Add site → Register Site succeeds. It is a 640 px dialog
(`max-w-[40rem]`), and a full-width bottom sheet below 640 px.

```
1280 · dialog 640                                         375 · bottom sheet
┌──────────────────────────────────────────────────┐      ┌───────────────────────────────┐
│ Site registered                              [×] │      │ Site registered           [×] │
│ Example site · example.com  ◌ Awaiting install   │      │ Example site · example.com    │
├──────────────────────────────────────────────────┤      │ ◌ Awaiting install            │
│ [1] Copy the snippet                             │      ├───────────────────────────────┤ ↕ the only
│ ┌ HTML ───────────────────────────────── [Copy] ┐│      │ [1] Copy the snippet          │   scroll
│ │ <script src="https://www.recopyfa.st/embed/re ││      │ ┌ HTML ─────────── [Copy] ┐  │
│ │ copyfast.js" data-site-id="0000…0000" data-si ││      │ │ <script src="https://ww │  │
│ │ te-token="•••" data-api-url="https://www.reco ││      │ │ w.recopyfa.st/embed/rec │  │
│ │ pyfa.st/api" data-ws-url="wss://…"></script>  ││      │ │ opyfast.js" data-site-i │  │
│ └───────────────────────────────────────────────┘│      │ │ … wraps, all visible …  │  │
│ [2] Paste it before </body>                      │      │ └─────────────────────────┘  │
│     WordPress  Next.js  Plain HTML               │      │ [2] Paste it before </body>   │
│     ─────────                                    │      │ WordPress  Next.js  Plain HTML│
│     Paste it into your theme's footer.php, …     │      │ …                             │
│ [3] Open your site — text is editable by itself  │      │ [3] Open your site …          │
│     Exclude      data-rcf-ignore                 │      │ Exclude                       │
│     Opt in       data-rcf-content                │      │ data-rcf-ignore               │
│     Opt in link  class="rcf-editable-link"       │      │ …                             │
│     ▸ Show example                               │      │ ▸ Show example                │
├──────────────────────────────────────────────────┤      ├───────────────────────────────┤
│ SITE ID 0000…0000   Installation guide ↗ [Close] │      │ SITE ID 0000…0000             │
└──────────────────────────────────────────────────┘      │ Installation guide ↗          │
                                                          │ [            Close          ] │
                                                          └───────────────────────────────┘
```

- **Header** (`DialogHeader`, left-aligned at every width):
  - `DialogTitle` "Site registered", 16/600.
  - A description row: the site name and the domain as **separate text nodes** (`Test Site`,
    `example.com`; tests find each by exact text), then `StatusBadge` with
    `siteStatuses["awaiting-install"]` (neutral tone, dashed circle).
  - Replaces: the 48 px success circle, the centred "Site Registered Successfully!" and its
    paragraph.
- **Body** (`DialogBody`, the only scroll container) is an ordered list of three steps. Each has
  a 24 px square step number (`border bg-surface-1 text-xs tabular`) and a 14/600 heading.
  - **Copy the snippet.** A `CodeBlock` labelled "HTML" whose `value` is the API's
    `embedScript`, byte for byte. It wraps (`pre-wrap` + `overflow-wrap:anywhere`). Its Copy
    button is always visible in the label bar, reads "Copied" for 2 s, and copies `value`
    exactly.
  - **Paste it before `</body>`.** Underline `Tabs` over `installRecipes` (WordPress / Next.js /
    Plain HTML): the same source and wording as `SiteInstallationCard`, so the product stops
    describing installation two ways. Each tab shows `recipe.location` (body) and
    `recipe.notes` (muted).
  - **Open your site — text is editable by itself.**
    - One sentence: "The widget finds headings, paragraphs, list items, table cells, labels,
      buttons and images by itself — no markup changes."
    - A three-row definition list:

      | Term | Value |
      |---|---|
      | Exclude | `data-rcf-ignore` |
      | Opt in | `data-rcf-content` |
      | Opt in a link | `class="rcf-editable-link"` |

    - "Links are skipped on purpose, so nobody can rewrite your navigation by accident."
    - A native `<details>` "Show example" that holds the existing four-line HTML example in a
      `CodeBlock` (`wrap={false}`; short lines, so it scrolls inside itself).

    The definition list stacks (term above value) below 640 px.
  - **Removed.** The "Need help? Visit your site dashboard" Alert, which links to the page the
    owner is already on; the footer's Installation guide link replaces it.
- **Footer** (`DialogFooter`):
  - On the left, "Site ID" (`text-eyebrow`) and the id in mono, selectable, as its own text node
    (pinned by test).
  - On the right, the "Installation guide" link (`/docs/install`, new tab, external-link icon;
    honest because it does open elsewhere), then one **Close** button.
  - "Go to Site Dashboard" is removed: it only closed the dialog yet carried an external-link
    icon (research, per-page table). s66c can add "Open site page" once the site has a URL.
  - Below 640 px the footer stacks and Close spans the full width.
- **Form state** (before registering): restyled only through the primitives (inputs at 3:1,
  square Alert, footer actions). Its copy ("Register New Site", "Website Name", "Register Site")
  is unchanged in this story, because tests pin it.

### 2. Share preview link dialog (`ShareSiteDialog` + `ShareLinkCard`)

Reached from a Sites card's share icon, or from site detail's Share. It is a 512 px dialog (the
default), and a bottom sheet below 640 px.

```
┌ Share preview link ─────────────────────── [×] ┐
│ Create a shareable link for others to preview  │
│ and collaborate on your site.                  │
├────────────────────────────────────────────────┤
│ Email address                                  │
│ [ collaborator@example.com                   ] │
│ Permissions                                    │
│ [◉ View        ✓] [✎ Edit         ✓]          │
│ [⇪ Publish      ] [⛨ Admin         ]          │
│ Expires in                                     │
│ [ 7 days                                  ⌄ ] │  ← chevron 12 px inside the border
│ Label (optional)                               │
│ [ e.g., Client review v2                     ] │
│ ────────────────────────────────────────────── │
│ ACTIVE LINKS · 2                               │
│ ┌────────────────────────────────────────────┐ │
│ │ [✉] Client review — homepage copy, …  [⧉][🗑]│ │  label truncates, never pushes
│ │     Expires Oct 14 · Pending               │ │
│ │     View  Edit                             │ │  badges wrap
│ └────────────────────────────────────────────┘ │
├────────────────────────────────────────────────┤
│                          [Cancel] [Create link]│
└────────────────────────────────────────────────┘
```

- **Title** "Share preview link" (sentence case; no test pins the old Title Case). The
  description is unchanged; s66c rewrites the explainer when it adds People & access.
- **Field labels**, in sentence case: "Email address" and "Label (optional)". "Expires in" is
  kept verbatim (pinned).
- **Permissions**: a 2 × 2 grid at every width (each tile is at least 160 px at 375). Tiles are
  40 px tall, 1px `border-input`, `rounded-control`. A selected tile has `border-primary`,
  `bg-tone-accent-surface` and `text-tone-accent-text`, with a tick on the right (WCAG 1.4.1 on
  its own). The `role="group"` and `role="checkbox"` semantics and today's defaults (View + Edit)
  are unchanged; s66c changes the default.
- **Expires in**: a `NativeSelect` at full width with `id="expiry"`. The options and their
  values (1 / 7 / 14 / 30 days) are unchanged.
- **Feedback**: errors and successes render as `Alert` (`destructive` / `success`), square,
  above the divider.
- **Active links**: an eyebrow heading with the count, then `ShareLinkCard`s:
  - each card is `rounded-container`, `border`, `bg-surface-1`, `p-3`;
  - the 32 px circle around the mail icon becomes a square `IconTile size="sm"` with the info
    tone;
  - the label truncates (`min-w-0 truncate`);
  - meta and permission badges wrap (`flex-wrap`);
  - Copy and Revoke are 32 px ghost icon buttons that are always visible, with today's
    `aria-label`s.
- **Footer**: Cancel (outline) and "Create link" (primary). The footer is sticky, because the
  body scrolls and the footer does not.
- **Root cause of the 375 px overflow**: `ShareLinkCard`'s row could not shrink inside the grid
  track (research fact 1). It is fixed twice:
  - by `DialogBody`'s `min-w-0` children;
  - in the card itself: `min-w-0` on the text column, `flex-wrap` on the badge row.

### 3. Primitives sheet

The mockup's third section shows each primitive at its s66a spec, in dark:
- Button: variants × sizes, icon, disabled, loading, focus;
- Input: rest, hover, focus, disabled, error;
- Textarea;
- NativeSelect: the chevron inset annotated;
- Radix Select: trigger and open opaque menu;
- DropdownMenu: opaque;
- Badge: structural, tones, dot;
- Tabs: underline, and wrapping at a narrow width;
- Card: flat; `interactive` hover is border only;
- Alert;
- CodeBlock: wrap and scroll variants, Copy and Copied;
- dialog anatomy;
- focus rings.

## Mockup

`docs/designs/s66a-app-design-tokens-and-panels.html` is a visual reference. **Do not copy it
into production.** Execute builds with the real components in `src/components/ui/`. The file is
standalone: inline CSS, Google Fonts for Instrument Sans and JetBrains Mono (as `next/font`
loads them), and the dark-theme token values copied from `src/app/globals.css`. Every token in
it is the placeholder `•••`, and every id is the zero UUID.

## Reused components (from the design system)

- `Dialog`, `DialogHeader`, `DialogBody` (new), `DialogFooter`, `DialogTitle`,
  `DialogDescription`: both panels.
- `CodeBlock` (new): the snippet and the example.
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (underline) with `installRecipes`: install
  step 2.
- `StatusBadge` with `siteStatuses["awaiting-install"]`: the panel header.
- `NativeSelect` (new): Expires in.
- `Input`, `Label`, `Button`, `Alert`, `Badge`, `IconTile`: forms, feedback, link cards.

## States

| Surface | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Registration form | Submit button `loading` ("Registering…") | — | `Alert variant="destructive"` above the form; field errors under each field (copy unchanged) | Swaps to the site-registered panel; `onSuccess` fires at once (F-11, unchanged) |
| CodeBlock copy | — | — | The button reads "Copy failed" for 2 s and the code text is selected, so ⌘C/Ctrl+C works; it never shows "Copied" after a failed write | "Copied" for 2 s |
| Share dialog | Active links: today's centred spinner (unchanged; the design system prefers a skeleton, and switching is left to s66c, which rebuilds this list in People & access) | No active links: the section is hidden (today's behaviour) | `Alert variant="destructive"` with the API message (today's strings) | `Alert variant="success"` with today's strings ("Invite sent successfully!"); the new link appears in the list. Exclamation marks in these strings are left for s66c's copy pass, which owns this flow's wording |
| ShareLinkCard | Revoke button `loading` | — | — | Copy icon becomes a tick for 2 s (today) |

## What the harness measures (e2e/app-layout.spec.ts)

At 320, 375, 768, 1280 and 1920, for each panel:
- `documentElement.scrollWidth ≤ clientWidth`;
- dialog `scrollWidth ≤ clientWidth`;
- no visible descendant's `getBoundingClientRect().right` exceeds the dialog's;
- exactly one element in the dialog has computed `overflow-y` of `auto`/`scroll`
  (`DialogBody`);
- the title's top is less than 120 px below the dialog's top;
- the CodeBlock Copy button is fully inside the dialog;
- the NativeSelect chevron's right edge is 12 ± 1 px from the select's right border.

At 1280, the global CSS checks:
- the Input border colour equals `--line-strong`, with contrast ≥ 3:1 against `--surface-card`,
  in dark and in light;
- the Sites sort menu's background is not `rgba(0, 0, 0, 0)`;
- text contrast is ≥ 4.5:1;
- focused controls have a radius ≤ 2 px.

## Copy changes (each one breaks a pinned assertion that the plan lists)

| Before | After | Why |
|---|---|---|
| "Site Registered Successfully!" | "Site registered" | Design system § Copy: sentence case, no exclamation mark in success states |
| "Copied!" | "Copied" | Same rule; it is also the CodeBlock's single label |
| "Integration Instructions" / "Step 1: Copy the embed script" / "Step 2: Add the script to your website" / "Step 3: That's it — your text is already editable" | Numbered steps "Copy the snippet" / "Paste it before `</body>`" / "Open your site — text is editable by itself" | Step 2 now reuses `installRecipes`; the old headings described a single, generic paste |
| "Go to Site Dashboard" (button) | removed | It only closed the dialog, while its icon promised navigation |
| "Share Preview Link", "Email Address", "Create Link", "Active Links" | "Share preview link", "Email address", "Create link", "Active links" | Sentence case; no test pins them |

## Design system gaps

- **Side sheet** (gap 12, new): `VersionHistoryPanel` stays hand-rolled; s66a aligns only its
  tokens.
- **Native select open state** (gap 13, new): drawn by the OS and not designable. The mockup
  shows the closed control and an annotation.
- **Toast** (gap 1, existing): the copy confirmation stays in the button label, so no toast is
  needed here.
