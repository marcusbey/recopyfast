---
validated: yes
story: s124-lifetime-spots
---
# Plan — Story s124-lifetime-spots

Validation source: owner in chat, 2026-10-26: "Approved. Plan, build with TDD, review and open the PR."
(after approving the revised design `docs/designs/s124-lifetime-spots.html`).

Branch: `feature/s124-lifetime-spots`
Research: `docs/research/s124-lifetime-spots.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s124-lifetime-spots.md` (+ `.html`, reference only).

## Target story

On the pricing section's `lifetime_agency` card only: a meter of its real spots, a count line
"N of L spots left at $P", a hold line, and the CTA "Get lifetime access". Everything else on the
section is unchanged. Acceptance criteria: `docs/stories.md` → `s124-lifetime-spots`.

## Tasks (ordered)

1. [x] **Parse helper (test first).** `src/components/sections/spot-meter.ts`:
       `parseSpotAvailability(value: unknown): { limit; remaining; soldOut } | null`. It returns
       null unless all of these hold: `limit` is an integer ≥ 1 and ≤ `SPOT_METER_MAX_CELLS`
       (100); `remaining` is an integer with 0 ≤ remaining ≤ limit; `soldOut` is a boolean; and
       `soldOut === (remaining === 0)`.
       Add `spotMeterCells(limit, remaining): ("taken" | "next" | "left")[]`. It returns `limit`
       entries: the first `limit - remaining` are "taken"; the next one is "next" when
       `remaining > 0`; the rest are "left".
       Tests: `src/components/sections/__tests__/spot-meter.test.ts`, including bounds,
       non-integers, NaN, strings, `__proto__` objects, the inconsistent `soldOut`, and the
       0 / 1 / limit cases.
2. [x] **`SpotMeter` component (test first).** `src/components/sections/SpotMeter.tsx`. It is a
       presentational server-safe component (no `"use client"` needed) with props
       `{ limit, remaining, label }`. It renders a `div` with `role="img"`, `aria-label={label}`,
       and a CSS grid of `limit` spans with `aria-hidden`.
       - Cell classes: taken = `bg-slate-500/45`, next = `bg-teal-700`, left = `bg-teal-700/20`.
       - `h-[18px]`, `gap-0.5`, `rounded-[1px]`.
       - The grid wraps to rows of 25 when `limit > 25`, at every breakpoint (amended during execute: the card's right column is ~224px at md+, so one row of 50 would be ~2.5px cells).
       - No motion.
       - Each cell carries `data-state` for tests.
       Tests: `SpotMeter.test.tsx`, covering the cell count and states and the aria label.
3. [x] **Pricing card (test first).** In `src/components/sections/Pricing.tsx`, parse
       `pricing.foundingAgencyAvailability` through `parseSpotAvailability`. A null result takes
       today's unknown path. The `FoundingAgencyAvailability.limit: 50` literal type becomes
       `number`. In the `lifetime_agency` card's right column, under the price:
       - **Open:** the `SpotMeter`, then the count line `"{remaining} of {limit} spots left at
         ${price}"`. When remaining is 1, it reads `"Last spot left at ${price}"`. Under it, the
         muted line "An open checkout can hold a spot for a short time." The CTA text becomes
         "Get lifetime access". The href, `data-cta-location` and `dataFastCtaAttributes(...)`
         stay byte-identical.
       - **Sold out:** a full meter (remaining 0) and "Sold out", with the disabled button
         unchanged.
       - **Unknown:** unchanged, with no meter.
       - Leave a comment explaining why the client re-validates. The server read
         (`getFoundingAgencyAvailability`) does not check bounds, and the meter draws `limit`
         cells.
       Update `Pricing.agency.test.tsx`. "17 of 50 founding spots left" becomes "17 of 50 spots
       left at $<price>", and the regexes `/founding spots left/` become `/spots left/`. Add cases
       for the out-of-bounds payload (no meter, unavailable), the last spot, the meter cell count,
       and the CTA label and analytics attributes.
4. [x] **Design system note.** Add a short "SpotMeter (marketing only, s124)" entry to
       `docs/design-system.md` → Available components, and tick these tasks.
5. [x] **Checks.** Run `npm run lint`, `npm run type-check`, `npm run format:check`,
       `npx jest src/components/sections`, then the full `npm test`, then `npm run build`.

## Run interdicts

- Do not change `src/app/api/**`, `src/lib/billing/**`, `src/lib/stripe/**`, `supabase/**`, or
  any price, catalogue or Stripe call. The diff must stay empty there.
- Do not change the plan cards, Lifetime Pro card, header, toggle, trust row, `FoundingOfferCard`,
  `founding-offer-copy.ts` or `useFoundingOffer.ts`.
- Do not change `src/components/billing/**`. `LifetimeOfferCard` and `UpgradeDialog` are the app
  surface and out of scope.
- No literal price or count anywhere in the component. Every number comes from the payload.
- No `framer-motion` on the meter, no new dependency, no `border-2` added, and no `gray-*`,
  `zinc-*` or `neutral-*`.
- Never run `next dev`. Run Jest and the build only.
- Keep the `h3` catalogue name (E2E-012) and the `pricing_founding_agency` analytics location.

## The point everything turns on

The meter draws `limit` DOM nodes from a public JSON field that today is trusted unchecked. Three
things could be wrong, and each should be checked against a source:

- **The parse.** Compare it with `parseFoundingOfferAvailability` in
  `src/hooks/useFoundingOffer.ts:37`. It must be at least as strict, plus the cell cap.
- **The cache path.** On a failed refresh, `/api/pricing` serves the cached catalogue with
  `foundingAgencyAvailability: null` (`route.ts:302-307`). That must still land on "unknown",
  not on a meter.
- **The test edits.** Changing strings in `Pricing.agency.test.tsx` is a behaviour change. The PR
  must say so (AGENTS.md "Tests").

## Files touched

- `src/components/sections/spot-meter.ts` (new)
- `src/components/sections/SpotMeter.tsx` (new)
- `src/components/sections/Pricing.tsx`
- `src/components/sections/__tests__/spot-meter.test.ts` (new)
- `src/components/sections/__tests__/SpotMeter.test.tsx` (new)
- `src/components/sections/__tests__/Pricing.agency.test.tsx`
- `docs/design-system.md`, `docs/plans/s124-lifetime-spots.md`

## Test strategy

- Unit tests for the pure parse and cell derivation.
- Component tests for `SpotMeter`.
- Integration through `Pricing` with mocked `fetch`, covering open, last, sold out, null and
  malformed.
- Existing E2E-012 is unchanged and must still match.
- The coverage ratchet must not drop.

## Definition of Done

- All tasks are ticked.
- lint, type-check, format:check, test and build pass.
- `git diff main...feature/s124-lifetime-spots` touches only the files above plus the story docs.
- An independent review in `docs/reviews/s124-lifetime-spots.md` ends `Ship allowed: yes`.
- The PR is open. Merge and deploy are manual.
