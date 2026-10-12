# Research — Story s98-maintenance-cost-calculator (retrospective)

This is a retrospective reconstruction written on 2026-10-12 from the merged code on
`origin/main` `bc6e503`. It repairs a missing pipeline artifact; it is not evidence that research
preceded implementation, plan validation, review, PR #92 or merge. No production access or
external write was used.

## Story premise, checked against current code

The story promises a client-side calculator that turns the visitor's own workload, billing share
and hourly rate into monthly and yearly unbilled cost; preserves the result in a link; and produces
an inert HTML result card. The current implementation satisfies that shape:

- `src/lib/tools/maintenance-cost/calculate.ts` owns the pure calculation and formatting.
- `src/lib/tools/maintenance-cost/params.ts` owns the six-key URL contract.
- `src/components/tools/maintenance-cost/CostCalculator.tsx` owns form state, field feedback,
  result presentation and debounced URL synchronization.
- `src/lib/tools/maintenance-cost/embed-snippet.ts` owns the copyable card string.
- `src/app/tools/website-maintenance-cost/page.tsx` owns the static marketing page, metadata,
  structured data, FAQ and conversion links.

No API route, table, service-role client or server mutation is involved in the calculation.

## Current behavior

### Arithmetic and input policy

`calculateCost()` clamps a fresh object built only from known fields. Non-finite values fall back to
defaults; bounds are 1–500 sites, 0–50 changes per site per month, 1–240 minutes, 0–10,000 hourly
rate, and 0–100 percent billed. Currency is exactly USD, EUR or GBP.

The calculation is:

1. `changesMonthly = sites × changesPerSiteMonthly`
2. `hoursMonthly = changesMonthly × minutesPerChange / 60`
3. `unbilledHoursMonthly = hoursMonthly × (1 − billedPercent / 100)`
4. `unbilledMonthly = unbilledHoursMonthly × hourlyRate`
5. `unbilledYearly = unbilledMonthly × 12`

There is no hidden overhead multiplier, benchmark or ReCopyFast-supplied estimate. The formula
sentence is produced from the same clamped values as the displayed result.

Current code differs from the pre-implementation plan in one reviewed way: hourly rate uses a
`0.01` step and retains cents. Commit `05bdbca` also made off-step rounding visible to the visitor.
The retrospective artifact records that final behavior rather than rewriting history to match the
older integer-rate decision.

### Form and state

The client component seeds its state once from `useSearchParams`; after that, controlled text
inputs are authoritative and the address bar follows them after 300 ms. Emptying any field hides
the result card and snippet, shows a neutral prompt, and suppresses URL updates. This avoids
presenting a default calculation for a value the visitor deliberately removed.

Every numeric field has a `Label`, native numeric constraints, an entry-mode hint and a described
help line. Out-of-range or non-numeric text gets a fixed range message while the calculation uses
the clamped/default value. In-range values off their allowed step get a non-error “Rounded to …”
message.

The visible result updates immediately. A separate screen-reader headline is the only polite live
region and waits 500 ms after typing stops. This is intended to reduce announcements while a
multi-digit value is entered; the tests prove DOM update timing, not attended screen-reader
announcement behavior.

### URL and static rendering

The URL contract is exactly:

`?sites=&changes=&minutes=&rate=&billed=&currency=`

Parsing reads those names individually with `.get`; prototype-shaped and extra keys have nowhere
to land. Serialization always writes clamped values in a stable order. The canonical remains the
bare tool URL.

The page is a server component and wraps the calculator in `Suspense`, allowing Next.js to keep the
route statically prerendered despite the client use of `useSearchParams`. The card origin comes
from `resolveSiteUrl()` on the server, so a preview deployment never emits its own host into HTML a
visitor may paste permanently.

### Copyable card

An iframe is incompatible with the site's `frame-ancestors 'none'` and `X-Frame-Options: DENY`
boundary. The implemented card is therefore one anchor with inline styles, four text spans and a
link back to the calculator with canonical parameters and embed UTMs. It has no script, style
element, class or event attribute. Every interpolation is escaped even though ordinary inputs are
numbers and an enum.

`CostResultCard` renders the same `buildCardText()` lines through React. `EmbedSnippet` displays the
string through the existing `CodeBlock`; it never injects the snippet into this page as markup.

### Marketing, SEO and claims

The page uses the marketing surface: `Header`, `Footer`, a pinned light theme, slate/sky palette,
display headings, rounded cards, a visible FAQ and a final CTA panel. It emits `WebApplication`,
`BreadcrumbList` and `FAQPage` JSON-LD from the visible copy, plus canonical/Open Graph/Twitter
metadata. The s96 tool hub and catalogue now provide the surrounding `/tools` discovery surface.

All product claims come from `copy.ts` and the launch claims ledger. The page says the result uses
the visitor's numbers and explicitly disclaims ReCopyFast averages, benchmarks and savings
estimates. Signup uses a native document link across the ADR 059 marketing/app boundary; `/try`
remains a normal link and says desktop.

## Tests that currently pin the story

- `calculate.test.ts`: defaults, formula, billing shares, zero cases, maximum finite result,
  decimals, step behavior, currency, clamping, cents and visible rounding.
- `params.test.ts`: round trip, canonical order, bounds, junk and prototype-shaped keys.
- `embed-snippet.test.ts`: exact inert markup, one anchor, server origin, escaping and shared card
  text.
- `CostCalculator.test.tsx`: labelled inputs, entry hints, live-region behavior, empty state,
  rounding, debounce, URL restore, card parity and `CodeBlock` copy surface.
- Page, SEO, discovery and Playwright coverage referenced by
  `docs/reviews/s98-maintenance-cost-calculator.md`.

PR #92's independent review ended `Max severity: minor` and `Ship allowed: yes`; the reviewed
rounding/cents fixes are present on main. The missing research/design documents were process debt,
not evidence that those fixes were absent.

## Traps for future edits

1. Changing a numeric step changes both the amount and the URL contract. Keep the field hint,
   clamp, serialized value and rounding message together.
2. Do not put the whole result panel in a live region; only the debounced headline is announced.
3. An empty field is not the default. It deliberately removes the result and prevents URL writes.
4. Do not derive the pasted-card origin from `window.location`.
5. Do not loosen the frame policy to make an iframe card.
6. The page is statically prerendered because `useSearchParams` stays below `Suspense`.
7. The pasted card's literal colors are an external-host contract; page UI continues to use the
   design system.

## Evidence limits and open questions

- Repository tests prove deterministic behavior, not that a representative set of CMS editors
  preserves the pasted inline-style card exactly.
- The current artifact contains no attended screen-reader transcript or fresh cross-browser visual
  capture of the calculator at 390 px and 1440 px.
- Analytics is not on `origin/main` in this snapshot; PR #94 is a separate open story. Future event
  wiring must preserve the no-PII/no-query-string contract and must not make calculation depend on
  analytics availability.

## Complexity reassessment

Complexity 2 remains fair for the merged feature: the arithmetic and state are local, but the URL,
static-rendering, CSP, claims, accessibility and pasteable-card boundaries made it more than a
single-component calculation. No split is warranted retrospectively.

Research backfill complete. The existing merged implementation and review remain the behavioral
authority; this document supplies the missing verified context only.
