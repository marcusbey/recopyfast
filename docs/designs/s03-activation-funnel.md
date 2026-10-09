# Design — Story s03-activation-funnel

> **Execution preflight amendment — 2026-09-12.** This visual contract is preserved for proposed
> story `s03b-activation-funnel-surface`; `s03a` has no UI. The server page supplies a boolean
> operator capability computed from the same server-only `ADMIN_EMAILS` / `app_metadata.role`
> helper as the API. Client components never read or reconstruct the allowlist. The new tab mounts
> and fetches only when that capability is true. Counts come from `account_milestones`; ongoing
> edit attribution comes from the immutable `account_edit_activity` ledger defined by ADR 027.
> The range cohort is anchored to account creation, so an unconfirmed account remains visible as
> first-step drop-off; confirmation is a reached step, not the query's admission ticket.
> Time-to-first-edit includes only measurable accounts with both timestamps and a nonnegative
> confirmation-to-edit interval. Edit share excludes legacy `unknown` actor rows from both sides;
> when no classified edits exist, the metric reads “Not enough classified edits,” not 0%.

## Screen(s)

**`/dashboard/analytics` — new "Activation" tab.**

The page already exists (`src/app/dashboard/analytics/page.tsx` → `AnalyticsDashboard.tsx`)
with three tabs: Trends, Top Sites, Performance (`AnalyticsDashboard.tsx:408-413`). This story
adds a fourth tab, **Activation**, using the same `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`
composition point the research anchor points to. It is the only screen this story touches —
the other three tabs, the overview cards above them, and the date/site selector row are
existing surfaces and stay out of scope. (Those existing surfaces are themselves off-system —
raw `text-3xl font-bold`, ad-hoc `p-6` cards, a hand-rolled bar chart keyed off `tone-*-border`
as a fill — but fixing them is not this story; only the new tab is designed on-system here.)

Content of the new tab, top to bottom:

1. Section header — "Activation funnel" + a one-line description + a date-range control on
   the right (p50/p90 and the attribution split are queried over this range; the story's own
   AC2 requires an arbitrary range).
2. **Four-step funnel** — account confirmed → first site registered → first verified install →
   first persisted content update. The funnel base is accounts created in the selected UTC range,
   so unconfirmed accounts remain visible as drop-off before step 1. Each step shows its count, its percentage of the funnel's
   base, and (from step 2 on) the drop-off from the previous step.
3. **Four metrics** — p50 time-to-first-edit, p90 time-to-first-edit, non-account edit share,
   and the unmeasurable-cohort count — each a `Metric` tile.
4. **Edit attribution** — a two-segment proportion bar making the non-account share visually
   legible on its own, not just as one metric among four, per the story's requirement that this
   number "must be legible, not buried."

## Mockup

`docs/designs/s03-activation-funnel.html` — **reference only**, never copied into production.
Static, self-contained, tokens via `var()` against a `:root` block copied from
`src/app/globals.css`. Shows the success state with realistic numbers, plus loading, empty and
error, stacked on one page with labeled dividers so all four are visible without interaction.

## Reused components

| Component | Use here |
|---|---|
| `PageHeader` / `SectionHeader` | Existing page title stands; `SectionHeader` opens the new tab's content ("Activation funnel" + description + date-range actions). |
| `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` | New `TabsTrigger value="activation"` alongside the three existing triggers. |
| `Card` (`variant="outline"`, `padding="sm"`) | The four funnel-step tiles — structure without weight, matching "operator screen, density beats decoration." |
| `Metric` | p50, p90, non-account edit share, unmeasurable-cohort count. Its own `state="loading"/"error"/"ready"` covers that tile's states — no separate loading markup needed for this part. |
| `IconTile` | Leading icon on each `Metric`, `tone` signaling state (`success`/`warning`/`accent`/`neutral`) — never category. |
| `Badge` (`tone-accent`, `tone-neutral`, `dot`) | Legend chips under the attribution bar ("Non-account edits", "Account holder edits"). |
| `Alert` (`variant="destructive"`) | Error state — what failed, retry action. |
| `EmptyState` | Zero-accounts state. |
| `Skeleton` | Funnel-step loading shape — the four step cards are not `Metric`, so they need their own skeleton fill (same `.skeleton` shimmer, sized to the step card's content). |
| `Input` (`type="date"`, ×2) | Date-range "From"/"To" — matches the one existing precedent, `AnalyticsDashboard.tsx:233-256`. Not `Select` — see gap below. |
| `Button` (`variant="outline"`, `size="sm"`) | "Apply" on the date range; "Try again" on the error state. |
| `.text-metric .tabular` | Every count and percentage in the funnel and the metrics row. |
| `.text-eyebrow` / `.text-title` | Step labels; card/section titles. |

## States

Every data view on this screen carries all four, per the design system's rule that empty is
never how an error renders:

- **Loading** — four `Skeleton`-filled step cards in the funnel row; the four `Metric` tiles in
  `state="loading"`.
- **Empty** — `EmptyState`: icon, "No activation data yet", "Accounts will appear here once
  they start confirming and setting up their site." No action — there is nothing on this screen
  itself that changes the state to non-empty.
- **Error** — `Alert variant="destructive"`: "Couldn't load the activation funnel" + the
  failure reason + a "Try again" `Button`. Renders in place of the funnel and metrics, not as an
  empty funnel — the same distinction `useSites.ts` already gets right elsewhere in the product.
- **Success** — funnel + metrics + attribution bar as designed, with the `unmeasurable` cohort
  shown as its own tile (a count, e.g. "128"), never folded into or read as "0."

## Design system gaps

1. **No chart primitive.** The funnel's step-to-step visual and the attribution bar are plain
   `div`s sized by inline `width` percentage, filled with existing tokens only (`bg-primary`,
   `bg-surface-3`, `border-border`) — not a new component, and nothing that gets added to
   `src/components/ui/`. Recorded because a future story that needs an actual trend line (e.g.
   daily funnel movement over time) will need a real charting primitive, which does not exist
   today. This screen does not need one — a static bar is enough for a point-in-time / one
   selected range view.
2. **`Select` now exists, but a date is not a select choice.** `s16` added
   `src/components/ui/select.tsx` after this design was first written. The two
   `Input type="date"` fields remain the correct control and match the existing analytics
   precedent (`AnalyticsDashboard.tsx:233-256`); no dropdown is introduced merely because the
   primitive now exists.
3. **No toast primitive** — already an open gap in `design-system.md`. Not needed on this
   screen; feedback stays inline via `Alert`, per the existing rule.
