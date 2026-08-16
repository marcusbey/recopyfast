# Design — Story s04-retire-graveyard-surfaces

## Screen(s)

This is a removal story: two surfaces lose graveyard features, and one of them needs an
after-state designed so the removal doesn't read as broken.

1. **Dashboard navigation** (`DashboardNavigation.tsx`) — the "Teams" item leaves the
   `Account` group. Shown before/after, side by side.
2. **`/dashboard/teams` redirect landing** — AC2 requires this route redirect somewhere
   real, not 404. The literal target per `docs/research/s04-retire-graveyard-surfaces.md`
   ("Open questions") is `/dashboard/sites` (the list a user picks a site from to share
   it) — there is no dedicated `/dashboard/sites/[id]` route to redirect to instead. This
   design specifies the redirect as `/dashboard/sites?notice=teams-moved`, with the Sites
   page conditionally rendering a dismissible `Alert variant="info"` at the top when that
   param is present. This is a screen the story's own AC requires exist; it is not a new
   feature, it's what "not a broken page" cashes out to.
3. **Embed widget Edit Board** (`public/embed/recopyfast.src.js`) — the tab bar drops
   from five tabs to three: **Elements, Languages, History**. This ships on every
   customer site.

**Explicitly not a screen here:** the floating editor toolbar (`TypographyPanel`,
`ColorPicker`, `FontSizeSelector`, `TextAlignmentControls`). See the scope guard below —
it is shown once, annotated, purely to make the boundary visible; it is not redesigned.

## Mockup
`docs/designs/s04-retire-graveyard-surfaces.html` — visual reference, all three screens
in one page: nav before/after, the redirect landing, and the widget's 3-tab Edit Board.
DO NOT copy into production: Execute builds with the real `src/components/ui/*`
components for the dashboard part, and edits `recopyfast.src.js` directly (then
`npm run build:embed`) for the widget part.

## Reused components (from the design system)

**Dashboard nav + redirect landing** (`docs/design-system.md` components, all
`var()`-driven):
- Existing nav shell/markup in `DashboardNavigation.tsx` — no new component, one
  `NavItem` entry removed from the `Account` group. `Users` icon import becomes unused
  and should be dropped with it.
- `Alert` (`variant="info"`) — the "Team management has moved" notice on the redirect
  landing. Same variant class the system already uses for non-blocking, informational
  banners (`docs/design-system.md`'s States table: "Loading / Empty / Error / Success"
  plus the existing `variant="info"` used elsewhere in the app).
- `Button` (`variant="ghost" size="icon"`, or a plain `×`-style dismiss affordance
  already used on `Alert`-adjacent dismissible UI) — closes the notice. If no dismiss
  affordance exists on `Alert` today, the notice may instead simply not re-appear once
  the query param is dropped from the URL by the page's own navigation — a planning
  decision, not a visual one; the mockup shows a dismiss control for clarity.
- `.text-display` — unaffected page title ("Sites") stays as-is; the notice sits below
  the `PageHeader`, above the site list.
- Type: `text-sm text-foreground` for the notice body, `text-primary hover:underline`
  for the notice's link back to per-site sharing (`Site details → Share`).

**Embed widget Edit Board** (three-tab layout, literal values):
- No component library exists on the widget side — it hand-rolls DOM/CSS
  (`docs/design-system.md`, "Embed widget — off-system" section: 0 CSS custom
  properties, 6 unlinked `<style>` blocks, no shadow DOM). The mockup keeps the
  existing tab-bar and panel structure (`rcf-eb-tabs`, `rcf-eb-tab`,
  `rcf-eb-panel` class names as they exist in `recopyfast.src.js`) and only:
  - Removes the `styles` and `themes` entries from `tabData` (`:5454-5460`).
  - Removes the "🎨 Apply Style" quick-action button (`:5639`) from the Elements tab,
    since its only destination (the Styles tab) is gone — this closes the second entry
    point the research doc flags as the real risk to AC5.
  - **Recolors the tab bar's active-state and focus treatment from the current
    off-brand blue (`#3b82f6`) to a teal-derived literal**, per this story's brief.
    This is a colour substitution on elements already being touched (the tab list),
    not a redesign of the widget — every other widget colour is left as-is; full
    token conversion is out of scope here and stays assigned to `s06` (see gap #4
    below, already recorded in `docs/design-system.md`).

## States

- **Dashboard nav — before/after**: not a state machine, a point-in-time diff. Shown
  side by side in the mockup. "Before" = current five-item Account+Workspace nav with
  Teams (Pro badge). "After" = same nav, Teams entry gone, nothing repositioned to fill
  the gap (Settings/Billing keep their order).
- **Redirect landing — the "success" state for AC2**: user follows a stale
  `/dashboard/teams` bookmark/link → lands on `/dashboard/sites` → sees the normal
  Sites list (`Skeleton` while loading, `EmptyState` if the account has no sites yet,
  `Alert variant="destructive"` if the fetch fails — all pre-existing patterns, not
  redesigned here) **plus** the info notice at the top explaining the move. This is the
  screen that proves AC2's "not a 404, not a broken page."
  - **Loading**: Sites list's own `Skeleton`, notice renders immediately (it needs no
    fetch — it's driven by the query param alone).
  - **Empty**: Sites list's own `EmptyState` ("no sites yet"), notice still shows above
    it — a user redirected here for Teams may have zero sites, and still needs to know
    why they're on this page.
  - **Error**: Sites list's own `Alert variant="destructive"` if sites fail to load;
    the notice is independent and still renders (it's about navigation, not data).
  - **Success**: Sites list renders normally with the notice above it.
- **Embed widget Edit Board — the three tabs**:
  - **Elements** (default active tab): list of detected content elements. Empty sub-state
    if nothing is selected yet — hand-rolled copy already in the widget ("Click any text
    on the page to start editing"), unchanged by this story except for the removed
    "Apply Style" button.
  - **Languages**: loading sub-state while translations fetch (thin skeleton bars, widget's
    existing pattern — not new), error sub-state if the language list fails to fetch
    (inline red text, existing widget pattern, recolored only insofar as any teal
    substitution touches shared chrome, not the error colour itself).
  - **History**: list of past versions; loading (skeleton rows) and empty ("no edits yet")
    sub-states both already exist in the widget and are unchanged.
  - **Scope guard, shown once in the mockup**: the floating editor toolbar (appears
    inline on the page when an element is selected, not inside the Edit Board panel)
    is rendered once, annotated **"UNCHANGED — per-element typography/colour, not an
    Edit Board tab, not touched by this story."** This directly answers the brief's
    requirement that an implementer cannot confuse the two.

## Design system gaps

1. **No dismiss affordance documented for a "moved" notice banner.** `Alert` covers the
   visual (`variant="info"`), but the design system does not document a pattern for a
   query-param-triggered, dismissible, one-time banner (as opposed to a persistent
   inline error/success next to a form). This story's redirect landing needs exactly
   that. Not a new primitive — composes `Alert` + an existing dismiss control — but the
   *interaction pattern* (when it appears, how it's dismissed, whether dismissal is
   remembered) isn't specified anywhere and should be confirmed at `/ks-plan`, not
   assumed here.
2. **Widget has no token layer** — already an open gap in `docs/design-system.md`
   ("Open design system gaps" #4). This design's teal substitution on the tab bar uses
   literal hex values **derived from the app's tokens, not `var()` references** (the
   widget has zero CSS custom properties and cannot use them — confirmed in
   `docs/design-system.md`'s "Embed widget — off-system" section). Values used in the
   mockup and their source token:
   - `--accent-solid` (dark) `hsl(174 48% 58%)` → literal `#4fb8ac`, for the active
     tab's underline/text and focus ring (replaces the current `#3b82f6`).
   - `--canvas` (dark) `hsl(200 18% 7%)` → literal `#0f1315` (already the exact value
     `docs/design-system.md` cites as "off-black in dark," reused here for the panel
     background — no new derivation needed).
   - `--surface-2` (dark) `hsl(200 14% 14%)` → literal `#1c2226`, panel header /
     tab-bar background.
   - `--text-strong` (dark) `hsl(200 22% 96%)` → literal `#eef2f3`, primary text.
   - `--text-muted` (dark) `hsl(200 12% 68%)` → literal `#a4b1b7`, inactive tab labels.
   - `--line` (dark) `hsl(200 12% 21%)` → literal `#2c3336`, tab-bar bottom border.
   A **full** conversion of the widget's remaining 100 hardcoded hexes (the blue/violet/
   indigo/emerald ones outside the tab bar, the six style blocks) is explicitly out of
   scope for `s04` and stays folded into `s06-embed-budget-gate`, per
   `docs/design-system.md`'s own instruction ("Do this *inside* `s06`, not as separate
   work").
3. **No documented dark-mode treatment for the widget** — open gap #5 in
   `docs/design-system.md`. The widget's Edit Board is fixed-dark today regardless of
   host page or OS theme; this design does not change that (out of scope), it only
   substitutes the accent hue used within the existing fixed-dark chrome.
