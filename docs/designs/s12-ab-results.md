# Design — Story s12-ab-results

> Path: Agent. Design system: `docs/design-system.md` (captured 2026-08-16) +
> `docs/design/styleguide.md`. Research: `docs/research/s12-ab-results.md` — its M2 verdict
> is load-bearing for this design: the `s09` dependency is dropped, and the conversion
> definition is computed over the **existing per-visitor A/B event stream**
> (`ab_test_results`, `visitor_id`, `visitor_buckets`), not over `s09`'s anonymous,
> visitor-less impression aggregates. That changes what this screen can honestly label a
> number, which is why "Assignments" replaces "Impressions" below — see the terminology note
> under States.

## Screen(s)

**One screen: A/B test results.** `/dashboard/ab-tests/[testId]` (the route itself is
un-parked by `s11`; this story owns everything rendered inside it). Reached from the test
list (`s11`'s screen, not designed here).

The screen has one layout — page header, a persistent conversion-definition explainer, then
one result card containing both variants — and that layout is constant. What changes with
test state is the content inside the card: whether a progress track or a confidence figure
shows, which `StatusBadge` tone applies, and which explanatory `Alert` renders. This is
deliberate: the honesty requirement is about **what number is allowed to appear, when** —
not about redesigning the screen per state.

No second screen for "ended" tests — same route, same layout, terminal state.

## Mockup (REFERENCE only)

`docs/designs/s12-ab-results.html` — static, token-only HTML. Per the hard rule in
`/ks-design`, this is not production code; the real screen is built from
`src/components/ui/*` in Execute.

The mockup shows **three copies of the same card side by side**, one per lifecycle point,
because that is the fastest way to review the honesty requirements against each other in one
glance. In production this is never three columns — it is one card whose content changes as
the test's state changes. The mockup says so in a caption above the grid.

Columns, left to right:
1. **Running, below minimum sample** — progress toward 1,000 assignments/variant, no
   significance figure anywhere.
2. **Ended, inconclusive** — final counts shown, no confidence number, explicit "kept your
   original content" statement.
3. **Ended, winner declared** — confidence figure now legitimate (test is over, decision is
   made), promotion statement with a link into version history.

## Reused components

All from `docs/design-system.md` → Available components. Nothing new.

| Component | Use on this screen |
|---|---|
| `PageHeader` | Title (test name), eyebrow "A/B test", description (date range), actions (back to test list) |
| `Card` (`default`) | The one result panel — houses both variant rows, state block, definition |
| `StatusBadge` | Test-level state pill: running / inconclusive / winner declared — **needs two new registry entries, see gap 1** |
| `Badge` (`outline`, `tone-success` `size="sm"`) | "Original"/"Control" tag on the control row; "Winner" tag on the winning variant row |
| `Alert` (`default`, `info`, `success`) | Conversion definition (persistent, `info`); below-sample explainer (`info`); inconclusive explainer (`default` — no tone-specific Alert variant exists, and `default`'s neutral treatment matches the `tone-neutral` badge next to it); winner explainer + promotion note (`success`) |
| `Metric` | Per-variant Assignments / Conversions / Rate; the single lead Confidence metric on the winner card (`emphasis="lead"`) |
| `IconTile` | Small tone-carrying icon slot inside `Metric`, reused as-is |
| `ContentValue` | Renders each variant's actual copy (the headline text being tested) safely, clamped |
| `Button` (`outline`, `link`) | "Back to tests"; "View in version history" |
| `Skeleton` | Loading state (not in the 3-column mockup — states section covers it) |
| `EmptyState` | Zero-traffic state (not in the 3-column mockup — states section covers it) |

## States

Every state below belongs to the **same** screen and layout described above.

| State | Pattern |
|---|---|
| **Loading** | `Skeleton` blocks in the shape of `PageHeader` + one result card (two variant rows, no numbers) |
| **Empty** | Test exists but has recorded **zero assignments on either variant** — genuinely no traffic yet, distinct from "below sample with some data". `EmptyState`, icon `FlaskConical`, title "No visitors assigned yet", description "This test is live but hasn't served any traffic. Results appear once visitors are bucketed into a variant." No `steps` — nothing for the owner to do but wait |
| **Error** | Results fetch fails. `Alert variant="destructive"`: what failed ("Couldn't load this test's results") + a retry action. Never falls through to Empty — that would read as "no data" instead of "we failed", the exact bug `design-system.md` calls out for `useSites.ts` |
| **Success — running, below minimum sample** | Mockup column 1. `StatusBadge` reuses the existing `running` entry (tone `info`). Assignments, conversions and observed rate **are** shown per AC 1 — nothing gates those. What's withheld is the significance figure: instead, a track+fill progress readout per variant ("482 of 1,000 assignments") plus an `Alert variant="info"` framing it as "still gathering data," not "hiding something." No confidence number, no tooltip escape hatch — the research trap this guards against (`track/route.ts:169-189` re-checking significance on ~every 50th view) is a backend fix, but the UI must not create demand for the number by showing a teaser |
| **Success — running, at minimum sample, not yet significant** | Not a separate mockup column (timeboxed — same information shape as below-sample, only the gate differs). Once both variants clear 1,000 assignments, the peeking risk the AC exists to prevent is gone — the sample floor is already met — so the actual confidence figure is legitimate to show, with `StatusBadge` reading a transitional "inconclusive so far" (`tone-neutral`) while the test keeps running toward its end date. Recorded here so Plan doesn't miss it; the winner/below-sample columns cover the two boundary cases fully |
| **Success — ended, inconclusive** | Mockup column 2. `StatusBadge` tone `neutral`, label "Inconclusive" — **needs a new registry entry, gap 1**. Final assignments/conversions/rate per variant, no confidence number. Deliberately **no** number here either, even though the test is over: an ended-by-date test may never have reached the sample floor, and showing a number in that case would be exactly the AC-5 violation in a different outfit. `Alert variant="default"` states plainly that the original content was kept and nothing was published |
| **Success — ended, winner declared** | Mockup column 3. `StatusBadge` tone `success`, label "Winner declared" — **needs a new registry entry, gap 1**. This is the one state where a confidence figure is correct and required: the test is over, both gates (≥95%, ≥1,000/variant) are met, this is the final number, not a mid-flight peek. Shown as a lead `Metric`. Winning variant carries a small `tone-success` "Winner" `Badge`. `Alert variant="success"` states the promotion plainly and links to version history via `Button variant="link"` — satisfies "ending a test promotes the winner and that appears in version history as a normal, revertible edit" as a UI-visible fact, not a silent side effect |

### Terminology note (not a gap — a naming decision made from the research)

The story's AC text and the brief both say "impressions." The research's M2 verdict drops
`s09` and defines the denominator as **assignments** — rows in `visitor_buckets`, keyed by
`visitor_id`, not the viewport-visibility "impression" concept `s09` would have supplied.
Labelling the metric "Impressions" on this screen would misdescribe what's actually being
counted (and would collide with a real `s09` impressions feature later, on the same page).
This design uses **"Assignments"** throughout. The conversion-definition `Alert` on the
screen makes the distinction explicit in plain language so a marketer isn't left guessing
what the word means.

## Design system gaps

Report-only, per the contract — nothing below was invented into the mockup as a new
primitive; the mockup approximates each gap using only existing tokens.

1. **`StatusBadge`'s `abTestStatuses` registry has no "winner" or "inconclusive" entries.**
   `src/components/ui/status-badge.tsx:177-206` defines `draft` / `active` / `running` /
   `paused` / `completed`, and `completed` is `tone: "accent"` with a generic "Finished,
   winner picked" description — it doesn't distinguish a declared winner from an ended,
   inconclusive test, and its tone is wrong for both: this story's honesty requirement is
   explicit that winner = `tone-success`, inconclusive = `tone-neutral`. Implementation needs
   two new `StatusDefinition` entries in the existing registry (e.g. `winner`: tone
   `success`, icon `Trophy`; `inconclusive`: tone `neutral`, icon `CircleSlash` or
   `CircleDashed`) — extends the established pattern, not a new component.
2. **No progress/meter primitive in `src/components/ui/`.** The below-sample state's
   "482 of 1,000 assignments" readout is composed directly from `bg-surface-2` (track) +
   `bg-primary` (fill) + `rounded-full` in the mockup — plain token composition, not a new
   component. Flagging because a reusable `Progress` primitive would also serve other
   in-flight surfaces (bulk import progress, upload state) if the team wants to formalize it;
   this story does not require that decision.
3. **No chart primitive** — confirmed not needed for this screen. Noting only because a
   future "conversion rate over time" view (a natural follow-on, not in this story's ACs)
   would need one and there is none today.
