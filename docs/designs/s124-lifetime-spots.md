# Design — s124-lifetime-spots

The agent generated this low-fidelity reference: `docs/designs/s124-lifetime-spots.html`. It was
revised on 2026-10-26 after the owner narrowed the scope. Only the capped lifetime card changes,
and it stays inside the existing pricing section with plain wording.

## Screen(s)

The section is today's `Pricing` (`#pricing`) on `/` (editorial) and `/product` (default). The
header, toggle, three plan cards, Lifetime Pro card and trust row are unchanged.

The **`lifetime_agency` card** is the right-hand card in the existing lifetime row. Its structure is
unchanged: icon tile, `h3` catalogue name, description, features, price "once". Three things are
added under the price:

1. **SpotMeter**: `limit` equal cells (2px gap, 18px tall, 1px radius).
   - Taken cells are muted ink at 45%, the next cell is solid teal, and the remaining cells are a
     22% teal tint.
   - When `limit > 25` the cells wrap to rows of 25 at every width (amended during execute: the card's right column is ~224px at md+, so one row of 50 would be ~2.5px cells).
   - It has `role="img"` and `aria-label="<remaining> of <limit> spots left"`.
   - There is no animation.
2. **Count line**, in the same place and style as today's count, `teal-800`, tabular:
   "`remaining` of `limit` spots left at $`price`". When one spot is left: "Last spot left at
   $`price`".
3. **Hold line**, muted 13px: "An open checkout can hold a spot for a short time." It is there
   because the count includes only completed sales.

The button label changes from "Buy founding access" to **"Get lifetime access"**. The href
`/dashboard/billing` and the `pricing_founding_agency` analytics attributes are unchanged.

## Mockup

`docs/designs/s124-lifetime-spots.html` is a visual reference. DO NOT copy it into production:
Execute edits the real card in `Pricing.tsx`.

## Reused components (from the design system)

- The existing lifetime card markup in `Pricing.tsx`, in both the editorial and default variants.
- `.tabular` numerals and the existing count text style.
- `dataFastCtaAttributes`, unchanged.
- New: a small marketing-only `SpotMeter` (`src/components/sections/`). It is built from plain
  elements, with a pure parse helper beside it.

## States

- **Loading / pricing failed**: unchanged. This means the skeleton, or "Try again" with no card.
- **Open**: meter, count, hold line, and an enabled "Get lifetime access" button.
- **Last spot**: the count reads "Last spot left at $`price`".
- **Sold out**: a full meter, "Sold out", and today's disabled "Sold out" button.
- **Unknown**: the count is null or fails the bounds parse. The card shows today's
  "Availability temporarily unavailable" and a disabled button, with no meter.

## Design system gaps

1. **No meter primitive** exists. `SpotMeter` is a marketing-only section component used once. Its
   rule goes into `design-system.md` with this story.
2. **The card still says "Founding" because the catalogue says it.** The name is "Founding Agency
   (lifetime)" and one feature reads "Founding offer limited to 50 completed sales". Both come from
   the `plans` table. Changing them is a catalogue edit and needs an owner decision. It would also
   require updating the E2E-012 `h3` match. This story does not do it.
3. **Marketing is pinned light.** There is no dark variant of this card, by the existing rule.
