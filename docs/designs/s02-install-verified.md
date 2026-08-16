# Design — Story s02-install-verified

## Screen(s)

One panel, four visual states: the **Installation** card inside the site detail view
(`SiteDetailView.tsx`, rendered at `/dashboard/sites/[siteId]`). This replaces the
existing duplicated pair — the header `resolveSiteStatus` badge and the separate
`hasReportedContent`-driven "Integration Status" card (`SiteDetailView.tsx:316-358`) —
with one card that is the single source of install status.

The card has one fixed anatomy across all states — `IconTile` + `.text-title` +
`StatusBadge` in the header, state-specific body below — so the states differ only in
tone and content, never in layout. That sameness of frame is what makes the state
change (the thing AC 2/3 promise happens "by itself") legible at a glance: the user is
watching one shape, not being handed a different screen.

States shown, left to right / top to bottom in the mockup:

1. `awaiting-install` — snippet, copy control, and the three install locations (AC 5).
2. `awaiting-install` with a domain-mismatch advisory layered on top (AC 4) — same
   state, not a fourth status; a mismatch report never verifies the site, so the card
   stays in `awaiting-install` and gets an additional inline notice.
3. `live` — the flip that happens with no user action (AC 2/3).
4. `stale` — advisory only, explicitly not an error state (AC 7).

Out of scope for this screen: the sites list row (`SiteCard.tsx`) and the dashboard
overview (`dashboard/page.tsx`) both already render `StatusBadge` from the same
registry (`status-badge.tsx`) — once `awaiting-install` / `live` / `stale` are added
to `siteStatuses`, those surfaces inherit the correct pill automatically. No separate
design needed there; it is the same component, different call site.

## Mockup
docs/designs/s02-install-verified.html — visual reference, all four states side by
side. DO NOT copy into production: Execute builds with the real
`src/components/ui/*` components (`Card`, `StatusBadge`, `IconTile`, `Alert`, `Tabs`,
`Button`).

## Reused components (from the design system)
- `Card` (`default` variant) — the panel container.
- `IconTile` — state glyph in the card header. Tone follows the same mapping the
  existing registry already uses for adjacent states (`verifying` → neutral /
  `CircleDashed`, `active` → success / `CheckCircle2`): `awaiting-install` → neutral,
  `live` → success, `stale` → warning.
- `StatusBadge` — the state pill itself, driving the whole design ("use it for the
  site state" per brief). New `siteStatuses` entries needed: `awaiting-install`
  (tone `neutral`), `live` (tone `success`), `stale` (tone `warning`). No `danger`
  tone anywhere on this card — `stale` must read as a nudge, never a blocker,
  per the story's own trap.
- `Tabs` — switches the install snippet between WordPress / Next.js / Plain HTML
  (AC 5). Three triggers, one snippet panel underneath.
- `Alert` (`variant="info"`) — the "we're checking automatically" note under the
  snippet in `awaiting-install`.
- `Alert` (`variant="warning"`) — both the domain-mismatch notice and the `stale`
  notice. Same variant for both because both are the same kind of signal: something
  worth the owner's attention that isn't blocking anything.
- `Button` (`variant="outline" size="sm"`) — the copy-snippet control.
- `Button` (`variant="link" size="sm"`) — "View install snippet" disclosure in
  `live` and `stale`, since the primary content of those two states is the status
  itself, not the snippet.
- Type scale: `.text-title` (card title), `.text-eyebrow` ("Add this snippet"
  label), `text-sm text-muted-foreground` (body/instructions), `--font-mono`
  (the snippet — a machine string, per the design system's explicit rule).

## States
- **Loading** — `Skeleton` in the shape of the card (header bar + two body lines)
  while the site record fetches. Not rendered in the mockup (standard `Skeleton`
  usage, nothing state-specific to show).
- **Empty** — not applicable; a registered site always has a status the moment it
  exists (`awaiting-install` is itself the empty/initial state, not a separate empty
  case).
- **Error** — `Alert variant="destructive"` if the site record fails to load,
  replacing the whole card per the system's data-view pattern. Not rendered in the
  mockup; this is the standard pattern, nothing custom to this story.
- **Success** — the four states above ARE the success surface for this story; there
  is no separate "success toast" moment. `live` itself is the confirmation.

## Design system gaps
- **Copy-snippet confirmation has no primitive.** The design system already lists
  "no toast/transient feedback primitive" as an open gap (`design-system.md`, gap
  #1) and says a story needing non-blocking confirmation has nowhere to put it.
  This story's copy control is exactly that case — the user needs to know the click
  registered. The mockup shows the pragmatic in-place fallback (the button's own
  label swaps to "Copied" briefly), which uses no new primitive, but this should be
  confirmed as the intended pattern in `/ks-plan` rather than assumed, since it is
  filling a real gap, not composing an existing one.
- Everything else needed by this screen — snippet display, tabs, state pill,
  advisory alert — is already covered by existing components. No other gap found.
