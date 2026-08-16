# Design — Story s10-impression-history

## Screen(s)

One screen: **Impression history** for a single content section. It is a focused `Dialog`
(`elevated` Card semantics, wide content: `max-w-3xl` vs. `VersionPreviewDialog`'s precedent
`max-w-2xl` — the chart needs the extra width), opened from that section's row in the site's
content list. `s09` already puts an impression count next to each section's current text on
that list (its own AC); this dialog is what that count opens into. No new page/route — the
content list is where a marketer already is when the question "did my edit do anything?"
occurs to them, so the answer stays one click away rather than a navigation.

Layout, top to bottom, inside the dialog:

1. **Header** — `DialogTitle` "Impression history", and directly under it the section's
   identity: its human label in `text-sm text-foreground`, its CSS selector in
   `font-mono text-xs text-muted-foreground` (machine string — same convention
   `ContentElementCard` already uses for selectors).
2. **Controls row** — the range `Select` (left) and a `Metric` (right) showing the total
   impressions for the selected range in `.text-metric.tabular`, with `hint` stating the
   exact date span, e.g. "Aug 8 – Nov 6, 2026 · UTC".
3. **Chart** — daily bars over the selected window, with change markers. Detailed below.
4. **Caption line** — one sentence under the chart stating the timezone and the retention
   split, so the axis is never ambiguous: *"Daily totals shown in UTC. Raw events are kept
   30 days; daily totals stay available for the full 90-day window."* (Retention window and
   timezone are both config values per the story's AC — this caption reads them, it does not
   hardcode "30"/"90" as copy; the mockup shows illustrative numbers.)
5. **Legend** — three swatches: *Impressions* (solid bar), *Not tracked* (hatched column),
   *Content changed* (accent marker). This is what makes the zero-vs-not-tracked distinction
   legible without a tooltip, and what keeps "a marker sits over this bar" from being
   mistaken for "this bar caused the marker."
6. **Correlation caveat** — one line under the legend: *"Markers show when this section's
   content changed. They don't prove the change caused a shift in the bars around it."* This
   is the mechanism for "make the correlation legible without implying causation" — it is
   copy, not a chart affordance, because the design system has no annotation-confidence
   primitive to build one with.

## Mockup

`docs/designs/s10-impression-history.html` — reference only, static, low-fidelity. Shows the
dialog in its success state with a full chart (mixed tracked/zero/not-tracked days and three
change markers), plus a states gallery underneath (loading, empty, error) for comparison. Uses
`light-dark()` token values copied verbatim from `src/app/globals.css`, so it also holds up
under OS dark mode the way every app screen must.

## Reused components

- **Dialog / DialogContent / DialogHeader / DialogTitle** (`src/components/ui/dialog.tsx`) —
  the screen's frame. `max-w-3xl` override, same pattern `VersionPreviewDialog` already uses
  for its own width override.
- **Select** (`src/components/ui/select.tsx`) — the range control. Three options: Last 7 days
  / Last 30 days / Last 90 days, default 90.
- **Metric** (`src/components/ui/metric.tsx`) — total impressions for the range, `.text-metric
  .tabular`, `hint` carries the date span + timezone. `emphasis="default"`, no icon (the chart
  below it is the icon).
- **Skeleton** (`src/components/ui/skeleton.tsx`) — loading state: chart-shaped skeleton bars
  at varying heights (not a spinner), skeleton over the Metric value, per the system's "shaped
  like the content" rule.
- **EmptyState** (`src/components/ui/empty-state.tsx`) — used when the section has no tracked
  days at all in the window (distinct from a tracked day with a zero count — see States).
- **Alert `variant="destructive"`** (`src/components/ui/alert.tsx`) — error state: what failed,
  what to do.
- **Badge / StatusBadge tone tokens** — the legend swatches and the change-marker styling pull
  their colour from `--tone-accent-*` (the same tone `VersionChangeType: restore` already uses
  for "rolled back to an earlier version" — a change-history marker already reads as "accent"
  elsewhere in the product, so this is consistent, not a new colour decision).
- **`.text-eyebrow` / `.text-metric` / `.tabular`** — axis labels and the total figure.

## States

- **Loading** — `Skeleton` chart: a row of skeleton blocks at varied heights standing in for
  bars, skeleton line over the Metric value. No spinner.
- **Empty** — `EmptyState`, replacing the whole chart: icon, "No impressions recorded yet",
  "This section hasn't been in view since impression tracking started." No action (this is a
  read surface; the fix, if any, lives in `s09`'s entitlement/tracking state, not here).
- **Error** — `Alert variant="destructive"` above where the chart would be: "Couldn't load
  impression history" + what to try (retry action).
- **Success** — the full chart, Metric populated, legend visible.
- **Zero vs. not-tracked (within the success state — the story's specific AC, not a fourth
  top-level state)** — two visually distinct treatments inside the same chart, both real data,
  neither an error:
  - A day that *was* tracked and genuinely had no impressions renders as a **real bar at zero
    height** — a thin baseline tick in `--text-muted`, still present, still hoverable
    (`title="0 impressions — Aug 14"`). It reads as "we counted, the answer was zero."
  - A day *before* tracking existed for this section (before `s09` shipped for this account,
    or before the section itself existed) renders as a **hatched column** — diagonal stripes
    in `--line` over `--surface-2`, no numeric tick, `title="Not tracked"`. It reads as "we
    have no answer for this day," which is a different claim than zero.
  - The whole-chart **Empty** state above is what happens when *every* day in the window is
    the hatched case — at that point showing 90 hatched columns is worse than the dedicated
    empty state, so Empty wins outright rather than degrading into "unusually chalky chart."

## Design system gaps

1. **No chart/timeline primitive.** This is the one the team-lead flagged going in, confirmed
   true: `src/components/ui/` has 17 primitives and none of them draws a series over time. The
   chart here is composed directly from tokens, not invented as a new named component:
   - Bars: `fill: var(--accent-solid)` at full opacity for a tracked/counted day.
   - Not-tracked columns: an SVG `<pattern>` of 45° stripes, stroke `var(--line)` over a
     `var(--surface-2)` fill — reuses the exact two tokens the app already uses for "structure
     without emphasis" (`Card variant="outline"` shadow-none logic), just applied inside SVG
     instead of a DOM border.
   - Zero-but-tracked ticks: a 2px-tall rect in `var(--text-muted)`, i.e. the same colour a
     disabled/quiet label already uses — "present, not emphasized."
   - Change markers: a small diamond in `var(--tone-accent-text)` with a `var(--tone-accent-
     border)` ring, sitting on a hairline `var(--line)` stem down to its bar — the accent tone
     triplet the system already reserves for "restore"-type history events.
   - Gridlines: `var(--line)`, one per Y tick, never more than 4 — matches "decorative, not a
     boundary" from the token doc.
   - All type in the chart (axis labels, legend labels) is `.text-eyebrow` or `text-xs
     text-muted-foreground`, never a bespoke size.
   - This composition is disposable by design: if the system later gets a real chart
     primitive, this SVG is what that primitive should be extracted from, not a pattern to
     keep hand-rolling per story.
2. **No tooltip/hover-detail primitive.** A chart wants per-bar and per-marker detail on
   hover (exact count, exact date, what changed). The system has no floating-tooltip
   component in its 17 primitives. This mockup falls back to the native `title` attribute —
   the same graceful degradation `StatusBadge` already relies on for its status description
   (`status-badge.tsx:227`, `title={status.description}`) — rather than inventing a popover.
   Acceptable for this story; a future tooltip primitive would improve discoverability, but
   is out of scope to invent here.
