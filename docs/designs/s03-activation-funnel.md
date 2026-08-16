# Design — Story s03-activation-funnel

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
   first persisted content update. Each step shows its count, its percentage of the funnel's
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
2. **`docs/design-system.md` lists `Select` as an available Radix-wrapped component**
   (`design-system.md:117`), but no `src/components/ui/select.tsx` or any `Select` import exists
   anywhere in `src/` — confirmed by search. Used two `Input type="date"` fields instead,
   matching the one existing precedent in the codebase
   (`src/components/dashboard/AnalyticsDashboard.tsx:233-256`). Flagging the doc/code mismatch
   rather than inventing a `Select` component to match the doc.
3. **No toast primitive** — already an open gap in `design-system.md`. Not needed on this
   screen; feedback stays inline via `Alert`, per the existing rule.
