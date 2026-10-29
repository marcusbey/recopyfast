# Review — Story s124-lifetime-spots

> Fresh-context review by the `reviewer` subagent, 2026-10-26. It judged the diff
> `git diff origin/main...feature/s124-lifetime-spots` at commit `2d54fc18`: 12 files, +1033/−16.
> Each issue is classified critical / major / minor.

## Post-review fixes (orchestrator, documentation only)

- Finding 1 is fixed. `docs/operations/analytics.md:127` now names the CTA "Get lifetime access".
- Finding 2 is fixed. `docs/designs/s124-lifetime-spots.md` §1 now carries the execute amendment:
  the cells wrap to rows of 25 at every width when `limit > 25`.
- Finding 3 is carried to the PR description, which states the changed `Pricing.agency.test.tsx`
  strings.

## Plan compliance

- [x] **The code does what the plan asks, and nothing more.**
  - **T1:** `spot-meter.ts` has `parseSpotAvailability`, `spotMeterCells` and
    `SPOT_METER_MAX_CELLS = 100`. The tests cover bounds, non-integers, NaN, Infinity, strings,
    `__proto__` and inherited objects, an inconsistent `soldOut`, and the 0 / 1 / limit cases.
  - **T2:** `SpotMeter.tsx` has `role="img"` and an `aria-label`. Each cell is `aria-hidden` and
    carries `data-state`. The classes are as planned. There is no motion and no `"use client"`.
    Cells wrap to rows of 25 at every breakpoint when `limit > 25`, as amended during execute.
  - **T3:** in `Pricing.tsx`:
    - The parse result drives three states: open, sold out and unknown.
    - `limit: 50` became `number`.
    - New copy: the count line, the last-spot line, the hold line (open state only) and the CTA
      "Get lifetime access".
    - The href, `data-cta-location` and
      `dataFastCtaAttributes("pricing_founding_agency","checkout","lifetime_agency")` are
      byte-identical.
    - The why-comment is present.
    - The test edits match the plan.
  - **T4:** the design-system entry is added.
  - **T5:** the checks were re-run independently.
- [x] **Run interdicts respected:**
  - The diff is empty under `src/app/api/**`, `src/lib/billing/**`, `src/lib/stripe/**`,
    `supabase/**` and `src/components/billing/**`.
  - The plan cards, Lifetime Pro, header, toggle, trust row, `FoundingOfferCard`,
    `founding-offer-copy.ts` and `useFoundingOffer.ts` are untouched.
  - No literal price or count.
  - No framer-motion on the meter, no new dependency, no `border-2` added, and no
    `gray-`/`zinc-`/`neutral-` classes.
  - The `h3` catalogue name and the `pricing_founding_agency` location are kept.
- The owner's narrowed scope holds. Only the `lifetime_agency` card changes, and no new "founding"
  wording is added.

## Anti-hallucination

- [x] **No invented API, function or import.** Each one was opened:
  - `SpotMeter` and `parseSpotAvailability` exist at the imported paths.
  - `dataFastCtaAttributes` is unchanged.
  - `.tabular` is at `src/app/globals.css:326`.
  - `getFoundingAgencyAvailability` (`founding-agency.ts:57-75`) returns the RPC row without a
    bounds check, which confirms research fact 3.
  - The `/api/pricing` stale path sets `foundingAgencyAvailability: null` (`route.ts:303`), and that
    maps to "unknown", which is tested.
- [x] **No plausible-but-wrong logic.**
  - The rule `soldOut === (remaining === 0)` was checked against `get_founding_agency_availability`
    (`20260924065000_..._founding_capacity.sql:369-383`). A real row never fails it.
  - The count includes only completed sales (ADR 029), so the hold line is true.
  - The built CSS contains every arbitrary class.
- [x] **The own-property read rejects a `__proto__` JSON payload**, as tested.

## Rules compliance

- [x] **AGENTS.md conventions** are followed: naming, why-comments, `__tests__/` placement,
  framer-motion kept to marketing, and no `.skip`, `.only` or TODO.
- [x] **No ADR is contradicted:** ADR 020 (marketing surface), ADR 029 (capacity untouched),
  ADR 074 (DataFast attributes unchanged), and non-negotiable 7 (no hardcoded price).
- [x] **The design system is respected.**
  - Only slate and teal are used, within the marketing palette.
  - SpotMeter is documented as marketing-only.
  - The card matches the screen's intent in the open, sold-out and unknown states.
  - Editorial uses `teal-700`, which matches the card's existing button. This is coherent and not
    new drift.

## Tests

- [x] **Full suite passes**, run with `NEXT_PUBLIC_APP_URL` set: 573 suites passed and 1 skipped;
  8571 tests passed and 2 skipped. `type-check` and `format:check` pass. `lint` reports 0 errors
  (its 34 warnings are all outside the diff). `build` exits 0. The new files have 100% coverage.
- [x] **The assertions pin the acceptance criteria:** cell count, states and positions, aria label,
  count copy, last-spot copy, hold line, CTA href and analytics, the sold-out state, eight
  malformed or null payloads, and the editorial variant.
- [x] **Every guard bites.** Each mutation was run, then restored, and the tree stayed clean.

| # | Mutation | Red tests |
|---|---|---|
| 1 | Dropped the `soldOut !== (remaining === 0)` clause | 3 |
| 2 | Dropped the `limit > SPOT_METER_MAX_CELLS` cap | 2 |
| 3 | Bypassed `parseSpotAvailability` in `Pricing.tsx` | 7 |
| 4 | Changed `remaining === 1` to `=== -1` | 1 |
| 5 | Changed the hold-line copy | 1 |
| 6 | Wrap guard `false` + `<=` cell order + mutation 4 | 9 |

## Regressions

- [x] **No impact on existing paths.**
  - `UpgradeDialog.tsx:508` and `LifetimeOfferCard.tsx:137` still say "founding spots left". They
    are the app surface and out of scope by interdict.
  - The landing tests and E2E-017 regexes do not match the new copy.
  - No e2e spec references "Buy founding access".

## Findings

1. **minor:** `docs/operations/analytics.md:127` still names the CTA "Buy founding access".
   *(Fixed after review.)*
2. **minor:** the design doc §1 still describes one row of cells, wrapping on narrow cards only.
   *(Fixed after review.)*
3. **minor (process):** AGENTS.md "Tests" requires the PR to state the changed test strings:
   - `"17 of 50 founding spots left"` became `"17 of 50 spots left at $299"`.
   - `/founding spots left/` became `/spots left/`.

   *(Carried to the PR description.)*

Observations, not defects:
- The cell contrast is low, but the meter is redundant with the text count and the aria label.
- Screen readers hear the count twice, which the design intends.

## Not verified

- **The rendered screen was never seen** (no browser, no `next dev`). Check `/` and `/product` at
  375, 768 and 1280px:
  - the meter makes two even rows under "$299 once";
  - nothing is clipped;
  - the next cell is visible;
  - the default variant's gradient does not swallow the 20% teal cells.
- **The live `/api/pricing` payload was not exercised.** After deploy, check that the card shows
  "50 of 50 spots left at $299".
- **The failed-refresh cache path was read, not run.**
- **Playwright E2E (E2E-012, E2E-017) was not run.** CI runs it.
- **The global coverage ratchet was not measured locally.** CI enforces it.
- **DataFast and GA events were not observed live.**
- **No contrast or axe audit** was run.

Max severity: minor
Ship allowed: yes
