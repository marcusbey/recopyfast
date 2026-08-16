# Design — Story s14c-cross-site-edit-activity

## Screen(s)

One screen: **Activity** — a new top-level dashboard page at `/dashboard/activity`, a sibling of
`/dashboard/sites` (per-site editor management, `s14a`/`s14b`) and `/dashboard/analytics`
(activation funnel, `s03`), and deliberately **not** grafted onto either. It is also not
`/dashboard/teams` — that route is the graveyard org surface `s04` retires; this screen must not
be reached from it or read from anything it touches.

**What the view represents.** Every row the signed-in account holds an `admin` row on in
`site_permissions` — never a column on `sites`, never a team/org join
(`docs/stories.md:839-842`, `docs/research/s14-agency-client-handoff.md` T1). The read model is
`s03`'s (`docs/stories.md:825`: *"read from `s03`'s milestone and activity data"*); this design
does not resolve the open schema question between `s03`'s four-timestamp milestone table and a
richer per-edit log (`research/s14-agency-client-handoff.md` T5/T6, `research/s15-agency-digest.md`
open question 1) — that is a planning decision for `/ks-plan`, not a design one. The mockup renders
the shape every candidate source must ultimately supply: **site, editor, element, changed value,
timestamp** — one row per edit.

**Avoiding the org-activity resemblance.** A cross-site list of "who did what, where" is the exact
shape of the PRD graveyard's frozen "org activity" screen, and the team-lead's brief names this
explicitly as the trap. Concretely, this design:
- Never labels a person's relationship to a site as a role, a title, or "member." A row says *this
  email edited this site*, nothing about what they are to the account.
- Never colours a row by which site it belongs to. Colour in this system signals *state*
  (`docs/design-system.md:49-54`); which site an edit happened on is not a state, so the site label
  is a plain neutral `Badge`, identical treatment for every site, exactly like every other site.
- Never groups or filters by anything resembling a team, and the Site/Editor filters below query
  `site_permissions` admin rows and per-site grant records — not `/api/teams/*` or
  `site_permissions.team_id`, which `research/s14-agency-client-handoff.md` T10 names as the join
  to avoid extending.
- The word "grant" (not "role" or "member") is the only relationship vocabulary this screen uses,
  matching `docs/stories.md:839-842`: *"grants are per-site and expiring, roles are per-org and
  persistent."*

### Layout, top to bottom

1. **`PageHeader`** — title `"Activity"`, description `"Recent edits across every site you
   manage."` No eyebrow (not nested under a larger section), no header actions — inviting an
   editor is a site-level action that lives on that site's own page (`s14a`/`s14b`'s
   `SiteEditorsCard`), not duplicated here.

2. **Filters row** — three `Select` controls, left-aligned, wrapping under the header on narrow
   viewports:
   - **Site** — `"All sites"` + one entry per site the account holds an admin row on. This is the
     same site set `s14a`/`s14b`'s dashboard already scopes editor management to; no new site
     query is implied by this filter, only a new consumer of the existing one.
   - **Editor** — `"All editors"` + one entry per distinct email that has edited any of these
     sites, whether or not that email has an account. Listed by email (the only identifier that is
     always true for both kinds — see attribution below).
   - **Date range** — `"Today"` / `"Last 7 days"` / `"Last 30 days"` / `"Last 90 days"`, default
     **Last 30 days**. A fixed-option `Select`, the same shape `s10-impression-history` already
     uses for its range control (`docs/designs/s10-impression-history.md`, "Reused components").
     The design system has no date-range-picker primitive to build a custom range with — see
     Design system gaps.

3. **The list** — grouped by calendar day so a 30-site agency's feed reads as a rhythm of days
   rather than one undifferentiated scroll. Each day is one `.text-eyebrow` label (`"Today"`,
   `"Yesterday"`, `"Aug 10, 2026"`) over one `Card` (`outline` variant — "structure without
   weight," the dashboard's workhorse) containing divide-y rows, newest edit first inside the day.

4. **Each row** (see Mockup for exact markup), left to right:
   - **`Avatar`** (28px, smaller than the default 40px — the row is dense, this is a list not a
     profile view). Account-holder edits get initials in `AvatarFallback`. Grant-holder (no
     account) edits get a mail-glyph fallback, never initials — there is no name to initial from,
     and initials would imply an identity the product doesn't have.
   - **Identity block** — the editor's **email**, always. If the editor is an account holder with
     a stored name, the name renders as the primary line and the email as a `text-xs
     text-muted-foreground` second line; if not, the email alone is the primary line. A `Badge`
     `outline` `"No account"` sits beside it **only** for grant-holder rows. This is the mechanism
     for the brief's requirement that non-account editors are "identified by the email the grant
     was issued to" and are never rendered as "unknown": the email is always present and always
     the thing that answers "who did this," account or not.
   - **Site `Badge`** (`outline` variant) — the site's domain, plain text, identical styling for
     every site. Not a `StatusBadge`/tone — see "Avoiding the org-activity resemblance" above.
   - **Element identity** — human label (`text-sm text-foreground`) over the CSS selector in
     `font-mono text-xs text-muted-foreground`, the exact convention `s10-impression-history`
     already establishes for the same underlying `content_elements` row
     (`docs/designs/s10-impression-history.md`: *"its CSS selector in font-mono text-xs
     text-muted-foreground (machine string — same convention `ContentElementCard` already uses for
     selectors)"*).
   - **`ContentValue`** — the changed value, `expanded={false}` (clamped to 3 lines), `label` set
     to the element's human label. This is what makes the row answer *what* changed, not just that
     something did — `ContentValue` already handles text, images and empty values safely (it is
     literally the component built for "rendering stored content safely," per
     `docs/design-system.md`'s component table).
   - **Timestamp**, right-aligned, `.tabular`, relative (`"2h ago"`) with the absolute timestamp in
     `title` — so the column stays narrow and stable while still being exact on hover/focus.

5. **`"Load more"`** — a plain `Button` `variant="outline"` `size="sm"`, centered, under the last
   day group. No pagination primitive exists in the system; this is composition, not invention (an
   agency with 30 sites' worth of edits needs the list to not load unbounded rows at once, and
   "load more" is the same shape several existing list screens already use informally).

---

## Mockup

`docs/designs/s14c-cross-site-edit-activity.html` — **REFERENCE only**, static, low-fidelity.
Renders the filters row, three day-groups (Today / Yesterday / an older date) mixing account-holder
and grant-holder edits across three different sites, then a states gallery below for loading,
both empty variants, and error. Tokens copied verbatim (light values, for legibility — the real
screen is fully token-driven per `docs/design-system.md`'s theme-discipline rule, so it inherits
dark mode automatically; this mockup pins light only because a static reference file has no
`color-scheme` to follow).

---

## Reused components

- **`PageHeader`** (`src/components/ui/page-header.tsx`) — title + description, no actions.
- **`Select`** ×3 — Site, Editor, Date range filters. Each a plain fixed-option select; no new
  variant.
- **`Card`** `outline` — the day-group containers. `outline`: "structure without weight," matches
  every other dense list surface in the dashboard.
- **`Avatar` / `AvatarImage` / `AvatarFallback`** (`src/components/ui/avatar.tsx`) — the editor
  glyph. Sized down from the 40px default via `className` override (same pattern `Metric`'s
  `IconTile` sizing already uses per-context).
- **`Badge`** `outline` (`src/components/ui/badge.tsx`) — used twice per applicable row: the
  `"No account"` tag and the site-domain tag. Deliberately **`Badge`, not `StatusBadge`** — the
  component table is explicit that `Badge` is for "static labels" and `StatusBadge` is for "any
  state" (`docs/design-system.md`'s component table). Neither "which site" nor "has no account" is
  a state; both are static facts, so the state-signalling tone system stays untouched — no site and
  no editor kind gets a colour.
- **`ContentValue`** (`src/components/ui/content-value.tsx`) — the changed-value preview per row,
  `expanded={false}`.
- **`EmptyState`** (`src/components/ui/empty-state.tsx`) — two distinct uses, see States.
- **`Skeleton`** (`src/components/ui/skeleton.tsx`) — loading rows, shaped like the row layout
  (avatar circle + text bars), not a spinner.
- **`Alert`** `variant="destructive"` (`src/components/ui/alert.tsx`) — error state.
- **`Button`** `variant="outline"` `size="sm"` — the `"Load more"` control; `variant="outline"`
  `size="sm"` again for `"Clear filters"` in the filtered-empty state.
- **`.text-eyebrow`** — day-group labels. **`.tabular`** — every timestamp. **`.text-display`** /
  page title via `PageHeader`.

No component or token outside `docs/design-system.md` is used anywhere in this design.

---

## States

| State | Behaviour |
|---|---|
| **Loading** | `Skeleton` rows in the exact row shape — a circle for the avatar, two short bars for the identity block, a badge-shaped bar, a wider multi-line bar for the `ContentValue` preview, a short bar for the timestamp. One day-group's worth (~5 rows), no group label skeleton (the eyebrow itself doesn't need to shimmer). |
| **Empty — true** | Account has zero edits ever, across every site it holds admin on. This is a new agency's likely first view of the product, named explicitly in the brief. `EmptyState`: icon `History` (neutral tone — this is not a failure), title `"No activity yet"`, description `"Recent edits across your sites will show up here once you or your clients start making changes."`, and `steps`: *"Invite an editor from any site's detail view"* → *"They edit content from the page they're on"* → *"Their changes appear here, attributed to their email"*. The steps describe the product's actual mechanism (grant invite → edit → attribution), not an invented workflow — this doubles as a first explanation of how grant-based editing works, for an owner who has never used it yet. No filters row shown above a true-empty state — there's nothing yet to filter. |
| **Empty — filtered** | Filters produce zero rows on an account that does have activity elsewhere (e.g., a specific editor + a narrow date range with no overlap). This is **not** the same claim as true-empty and must not reuse its copy (`docs/design-system.md`'s own rule: *"Empty is never how an error renders"* generalises here to *filtered-empty is never how true-empty renders* — a filled account showing "No activity yet" reads as broken, not as filtered). Same `EmptyState` component, different content: icon `SearchX`, title `"No edits match these filters"`, description `"Try a different site, editor or date range."`, `secondaryAction`: `Button variant="outline" size="sm"` `"Clear filters"`. No `steps`. Filters row stays visible above it (the user needs to change the filters, not lose them). |
| **Error** | `Alert variant="destructive"` in place of the list: `"Couldn't load activity"` + a retry action, matching the system's error-state pattern exactly (what failed, what to do). Filters row stays visible and interactive above it. |
| **Success** | The full grouped list described above. |

---

## Design system gaps

Report-only, per the contract — none of these is filled freestyle here.

1. **No date-range-picker primitive.** The Date range filter uses a fixed-option `Select`
   (Today / 7 / 30 / 90 days), the same shape `s10-impression-history` already established for an
   equivalent need. An arbitrary custom range (start date → end date) is not buildable from the
   current component set. Not a gap unique to this story — already implicit in `design-system.md`'s
   silence on a calendar/date-picker component — but worth restating since this is the second story
   in a row to want one.
2. **No pagination/"load more" primitive.** Composed here from a plain `Button`, which is
   sufficient (this is composition of an existing primitive, not invention of a new one) but is
   worth naming since a cross-site view for a 30-site agency is exactly the kind of screen that
   will need this pattern again (`s15-agency-digest`'s dashboard link and any future site-level
   history list are candidates).
