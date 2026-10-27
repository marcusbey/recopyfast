# Research — Story s124-lifetime-spots

Date: 2026-10-26. Inputs: `origin/main` at `84cc20a6`, the live production feeds
(`https://www.recopyfa.st/api/pricing` and `/api/offers/founding`, read 2026-10-26), and the owner's
reference screenshot (Wow Keywords "Get lifetime access" card).

Warning carried forward: `docs/reviews/stories.md` ends `Stories ready: no`. That has been the
state through s100–s123, which all shipped; the story was added on the owner's direct request.

## The five structuring facts

1. **The reference's price ladder has no RecopyFast equivalent.** The catalogue has one Founding
   Agency price (`lifetime_agency`, $299 live) and no tiers. Bars "rising from $89 to $199" would be
   invented prices, which AGENTS.md non-negotiable 7 and the brief forbid. The honest translation is a
   **spot meter**: one cell per founding spot, taken / next / remaining.
2. **The "lifetime, once" hero already exists:** `Founding Agency (lifetime)`, $299 once, 50 spots,
   Agency features + 250 AI credits/month — `src/components/sections/Pricing.tsx:120` finds it, `:460`
   renders `"N of 50 founding spots left"`. Live count: 50 of 50 left.
3. **The Founding Agency count is not bounds-checked anywhere.** `getFoundingAgencyAvailability`
   (`src/lib/billing/founding-agency.ts:57-75`) returns the RPC row as-is, and `Pricing.tsx:50-56`
   trusts the JSON. The first-20 count, by contrast, is validated twice
   (`founding-offer.ts:126-150`, `useFoundingOffer.ts:37-55`). Drawing `limit` cells from an
   unchecked number is a new failure mode (a 5,000-cell meter, or a negative one), so the story adds
   a client parse.
4. **"Remaining" counts completed sales only** (`20260924065000_agency_plan_and_founding_capacity.sql:376-383`).
   An open Checkout holds a reservation without moving the count, so "1 left" can meet
   `capacity_busy` at checkout. The meter's fine print has to say so.
5. **The first-20 offer is $0 for 3 months, not a purchase** — live 19 of 20 (the GTM log's "20 of
   20" is stale). It can carry the same meter from `useFoundingOffer`, but has no "price once".

## Target story

Narrowed by the owner on 2026-10-26: only the capped lifetime Agency card changes, inside the
existing pricing section, with plain wording. A `SpotMeter` under its price, drawn from a validated
live count; "N of 50 spots left at $P"; CTA "Get lifetime access". Plan cards, Lifetime Pro, the
first-20 card and the section header are untouched. Facts 2–4 below still bind; fact 5 (first-20
card) is now out of scope.

## Current state of the code

- `src/app/page.tsx:58` renders `EditorialHomePage`, which renders
  `<Pricing offer={offer} variant="editorial" />` (`EditorialHomePage.tsx:119`). `/product` renders
  the legacy `HomePage` with the default variant (`HomePage.tsx:77`). Both variants are live.
- `Pricing.tsx` (client component, framer-motion, marketing only) fetches `/api/pricing` once; three
  plan cards; then a two-column row with Lifetime Pro and Founding Agency (`:364-520`); then the trust
  row. Fail → "Try again", never a fallback price.
- `FoundingOfferCard.tsx` renders the first-20 offer (`$0 for 3 months`, `"N of 20 spots left"`,
  "Claim your spot" → `/signup`). Only when `offer.status === "open"` (`Pricing.tsx:180`).
- `/api/pricing` (`src/app/api/pricing/route.ts`) — catalogue from `plans`, live Stripe amounts on
  top, 5-min in-process + 5-min CDN cache; on a failed refresh it serves the cached catalogue with
  `foundingAgencyAvailability: null`.
- `/api/offers/founding` — uncached, `no-store`, 503 on anything out of bounds.

## Anchor points

- `src/components/sections/Pricing.tsx` — Founding Agency block (`:420-520`) and the
  `foundingAgencyAvailability` type (`:50-56`).
- `src/components/sections/FoundingOfferCard.tsx` — count line (`:42`), right column.
- New: `src/components/sections/SpotMeter.tsx` (+ a pure parse/derive helper beside it, e.g.
  `spot-meter.ts`) — Marketing surface, `src/components/sections/*` per ADR 020's rule.

## Verified APIs / functions

- `parseFoundingOfferAvailability(body: unknown): FoundingOfferAvailability | null` —
  `src/hooks/useFoundingOffer.ts:37`. Validation pattern to mirror for the Agency count.
- `toFoundingOfferView(state) → { status: "loading" | "open" | "closed" }` — `useFoundingOffer.ts:57`.
- `getFoundingAgencyAvailability(): Promise<{ remaining, soldOut, limit: 50 }>` —
  `founding-agency.ts:57`; `limit` is the constant `FOUNDING_AGENCY_LIMIT`, not the RPC.
- `dataFastCtaAttributes(location, kind, productId?)` — `src/lib/analytics/datafast-goals.ts`; the
  Founding Agency CTA uses `"pricing_founding_agency"`; keep it unchanged so analytics continuity holds.
- Live payload (2026-10-26): plans starter $9 / pro $19 / agency $49 per month ($490/yr);
  oneTimeProducts credits $19, lifetime_pro $199, lifetime_agency $299; founding agency 50/50;
  first-20 19/20.

## Traps & constraints

- `Pricing.agency.test.tsx:105` asserts the exact string `"17 of 50 founding spots left"`, `:130`
  two `"Sold out"` texts, `:146-171` the unavailable states. Changing the count copy changes these
  tests — say so in the PR (AGENTS.md "Tests").
- `Pricing.founding-offer.test.tsx` ties the first-20 card's 90 days / 100 credits / 14-day fallback
  to their sources; leave those strings alone.
- `e2e/landing.spec.ts:139-180` (E2E-012) matches `h3` text `/^Founding Agency \(lifetime\)$/` and
  `/^Lifetime Pro$/` — the block must keep the catalogue name in an `h3`.
- `jest.setup.js:217` mocks IntersectionObserver as a no-op: `useInView` never fires in Jest, so
  framer-motion `animate` stays at `initial`. A meter animation must not gate content on it.
- Marketing surface rules (design-system.md:78-112, editorial guide): pinned light, no app tokens,
  editorial = cream `#f7f3e9` / ink `#142024` / teal `#287f7c` / divider `#d9d3c6`, 3px radius. There
  is **no marketing dark mode** — a dark (ink) panel is a design-system decision for the owner.
- Design system "Don't": no `border-2`, no shadow on static panels, no blue. The current Founding
  Agency card has `border-2` and a gradient + shadow on the default variant (already flagged in
  `FoundingOfferCard.tsx` comments).
- Copy constraints: launch kit §11 (no A/B, translation, impressions; "no account", never "no
  login"); no "Up $10 every 30 licenses"-style line — there is no step.

## Open questions

1. The catalogue name is "Founding Agency (lifetime)". Renaming it is a `plans` row edit (catalogue
   change, owner decision) and E2E-012 pins the `h3`; left as is.

## Real complexity

**1** after narrowing: one presentational component + a pure parse helper, one card edited, test
strings updated. No server, data or billing change.
