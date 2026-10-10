# Design — Story s47b-founding-20-landing

## Screen(s)

One screen, the landing page (`/`). It is on the **Marketing surface**: the legacy `sky`/`slate`
palette over the WebGL sky, light only, no app tokens. Three places change, and all three read
**one** count from **one** request, so the hero and the pricing card can never disagree. The
source brief is [`s47-founding-20-offer-brief.md`](./s47-founding-20-offer-brief.md), Screen 1,
with its local reference screenshots (not committed).
Where this document differs from the brief, the difference is listed under "Decisions that
differ from the brief" below.

**Drawn after s50.** s50 ships first (s50 plan, "Ship order"), so the mockup shows the page as
s50 leaves it:
- no "30-day money-back guarantee" in any trust row;
- the FinalCTA pill reads "Set up in minutes".

**The count.** The count comes from s47a's public route (`GET /api/offers/founding`, which
returns `{limit, remaining, soldOut}`). "20" is the response's `limit` and is never a literal.

| Response | Landing state |
|---|---|
| Request in flight | **Loading** |
| 200, `remaining` ≥ 2 | **Spots left** (e.g. 17) |
| 200, `remaining` = 1 | **Last spot** |
| 200, `soldOut` (remaining 0) | **Sold out** |
| Non-200 (503, 429), network error, or a body whose `remaining` isn't an integer between 0 and `limit` | **Failed**, rendered **identically to Sold out** |

The page never shows a guessed, cached or stale number. Loading and Failed show no number at
all, and Loading promises neither the offer nor the 14-day trial, so there is never a flash of
the wrong promise.

### 1a. Hero: the announcement pill and the line under the buttons (`Hero.tsx`)

- **Pill.** One `.glass` pill, `rounded-full px-4 py-2`, centred directly above the `h1` with
  `mb-6`. It holds a 16 px Rocket icon in `teal-700`, then `text-sm` text in `slate-800`, with
  the count in `font-semibold text-teal-800 tabular`. Use `whitespace-nowrap`: the pill never
  wraps. The whole pill is a link to `#pricing` with the global focus ring. Its slot has the
  same height in every state, so the headline never moves when the count arrives.
- **Full form from `md` up; short form below `md`.** The full line is about 580 px wide and does
  not fit at 390 px.

| State | Pill, `md` and up | Pill, below `md` |
|---|---|---|
| Loading | An empty `.glass` pill of the same height, `animate-pulse`. No icon, no text, no number. Rendered as a `div` with `aria-hidden`, **not a link**, so there is no empty focus stop. | same |
| Spots left | Rocket · **First 20 users get ReCopyFast Pro free for 3 months · 17 of 20 spots left** | Rocket · **Pro free for 3 months · 17 of 20 left** |
| Last spot | Rocket · **First 20 users get ReCopyFast Pro free for 3 months · Last spot left** | Rocket · **Pro free for 3 months · Last spot left** |
| Sold out / Failed | Rocket · **Every new account gets 14 days of Pro, free** | Rocket · **14 days of Pro, free** |

- **Line under the CTA buttons** (`Hero.tsx:148-155`, today "14 days of Pro. No credit card
  required."): **No credit card required.** in every state. The pill carries the part that
  varies.
- The headline, subtitle, "Start your free trial" and "Watch it work" don't change. "Start
  your free trial" is true in every state.

### 1b. Pricing: the offer card (`Pricing.tsx`)

- **Position.** Full width in the `max-w-6xl` container, between the subtitle "Choose the plan
  that fits your needs. Upgrade anytime." and the Monthly/Yearly toggle, with `mb-8` below it.
  The toggle doesn't affect it. It sits inside the centred header block, so the card sets
  `text-left`.
- **Container.** It uses the structure of the Founding Agency card (`Pricing.tsx:327-393`):
  `rounded-3xl p-8`, `grid items-center gap-8 md:grid-cols-[1fr_auto]`. It keeps that card's
  `border-2 border-teal-500` edge. It drops the gradient and `shadow-xl`: the ground is flat
  `bg-white` with no shadow. Below `md` it is one column.
- **Left column:**
  - Icon tile: 48 px, `rounded-2xl bg-teal-50`, Rocket 24 px in `teal-700`.
  - Tag, inline above the title: **Founding offer**. It uses the "Most popular" treatment,
    `rounded-full bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white`.
  - Title (`h3`, `text-2xl font-semibold text-slate-900`): **First 20 users get ReCopyFast Pro
    free for 3 months**
  - Description (`text-sm text-slate-600`): **Every Pro feature for 90 days, with 100 AI credits
    a month. No credit card, and nothing is charged when it ends.**
  - Benefit list (`mt-6 grid gap-3 sm:grid-cols-2`). Each item is a 20 px Check in `teal-700`
    followed by `text-sm text-slate-700`: **5 websites** · **Invited editors** · **All sites
    view** · **AI suggestions** · **100 AI credits a month** · **No credit card required**.
- **Right column** (`min-w-56`, centred below `md`, right-aligned from `md`):
  - **$0** (`text-5xl font-bold text-slate-900`), then **for 3 months** (`text-slate-600`).
  - Count (`mt-1 text-sm font-medium text-teal-800 tabular`): **17 of 20 spots left**
  - CTA **Claim your spot**, a link to `/signup`: `pressable mt-5 block rounded-xl bg-teal-700
    px-6 py-3 font-semibold text-white hover:bg-teal-800`, full width of its column. This is
    the "Buy founding access" treatment.
- **Fine print.** It spans both columns under `mt-8 border-t border-sky-100 pt-6`, in `text-sm
  text-slate-600`, as two paragraphs:
  - **After 90 days, choose a plan to keep editing. Your site keeps serving its content either
    way. Need more AI before then? 1,000 credits for $19.** The pack size and price come from
    the `credits` product in the pricing payload the section already fetches. If that payload
    hasn't loaded, has failed, or lacks either value, drop the last sentence. Never hardcode it.
  - **Spots go in sign-up order. If all 20 are taken when you sign up, you get the 14-day Pro
    trial instead.** The count can lag a sign-up by a few seconds, and this line keeps "Claim
    your spot" honest at that boundary.

| State | Card |
|---|---|
| Loading | **Not rendered** (see decision 1). The plan grid's own skeleton covers the section while `/api/pricing` loads. |
| Spots left | As above, "17 of 20 spots left". |
| Last spot | The count reads **Last spot left — 1 of 20**. Nothing else changes: no red, no timer, no animation. |
| Sold out / Failed | **Not rendered.** The section looks like `landing-pricing-desktop.png` without the guarantee. No "unavailable" message and no number. |

### 1c. Trust rows (copy swap; the FinalCTA dots change colour)

Two rows start with "14-day free trial": Pricing (`TRUST_POINTS`, `Pricing.tsx:69-74`, rendered
at `:397-412`) and FinalCTA (`FinalCTA.tsx:104-107`). Only the first item varies:

| State | First item |
|---|---|
| Loading | **Free trial** (true in every state) |
| Spots left / Last spot | **3 months free for the first 20** |
| Sold out / Failed | **14-day free trial** (today's text) |

After s50, both rows read `[first item] · No credit card required · Cancel anytime`.

**FinalCTA dots** (`FinalCTA.tsx:105,109,113`) move from `bg-emerald-500`, a forbidden hue, to
**`bg-teal-600`**. That is how the landing already expresses the design-system accent: it is
the same colour as the Pricing trust-row checks, so the two rows match. The dots stay 6 px
(`w-1.5 h-1.5 rounded-full`). Why not `bg-primary`: see gap 2.

### Decisions that differ from the brief

1. **The offer card has no loading skeleton.** The brief draws a card-height skeleton. After the
   20 spots go, sold out is the permanent state, so every later visit would show a 30 rem block
   that then collapses. The pricing section is several screens below the fold and the count
   resolves long before a visitor scrolls there, so inserting the card when it arrives causes no
   visible shift. The hero pill, which is above the fold, keeps its fixed-height slot.
2. **The loading pill is not a link.** An empty link is an unlabelled focus stop.
3. **The trust rows have no guarantee item.** The brief's §1c lists "30-day money-back guarantee"
   as unchanged. The owner removed it (2026-09-28), and s50 deletes it.
4. **Brand spelling is ReCopyFast**, the wordmark (100 UI occurrences against 1). The owner's hook
   wording is kept word for word.

Copy rules applied (owner, 2026-09-28): no money-back guarantee, no "future Pro features", no
"works on any site". Support would read "Email support", but no s47b string mentions support.

## Mockup

`docs/designs/s47b-founding-20-landing.html` is a visual reference. It has one artboard per
state (Loading, Spots left, Last spot, Sold out / Failed) at 1440 (scaled) and 390. Each
artboard shows the hero pill, the pricing offer card and both trust rows. The WebGL sky is
drawn as a flat `sky` stand-in, because the mockup allows no gradients. **Do not copy it into
production.** Execute edits `Hero.tsx`, `Pricing.tsx` and `FinalCTA.tsx` with their existing
patterns.

## Reused components (from the design system)

This is the Marketing surface, so none of the `src/components/ui/` primitives apply. All of
these patterns already exist in `src/components/sections/`:

- `.glass` pill (`FinalCTA.tsx:21-33`): the hero announcement pill.
- Founding Agency card structure (`Pricing.tsx:327-393`) **without** its gradient and
  `shadow-xl`: the offer card.
- "Most popular" tag (`Pricing.tsx:226-232`), used inline: the "Founding offer" tag.
- Plan icon tile (48 px `rounded-2xl`), here `bg-teal-50` with Rocket in `teal-700`, the same
  tile Founding Agency uses.
- Feature list with 20 px Check icons (`Pricing.tsx:346-354`): the benefit list.
- Founding Agency count line (`text-sm font-medium text-teal-800`): the spot count, plus
  `tabular`.
- Teal CTA link button ("Buy founding access", `Pricing.tsx:373-378`): "Claim your spot".
- Marketing skeleton (`animate-pulse`, `Pricing.tsx:184-197`): the loading pill, on `.glass`
  instead of `bg-white/60`.
- Trust rows (`Pricing.tsx:397-412`, `FinalCTA.tsx:90-116`), unchanged in layout.
- Lucide icons already in use: Rocket, Check.
- Type: Instrument Sans for everything this story adds. Bricolage stays on the `h1`/`h2`, which
  don't change.

## States

| State | Hero pill | Line under the hero buttons | Pricing offer card | Trust rows, first item |
|---|---|---|---|---|
| Loading | Empty glass pill, pulse, same height, not a link | No credit card required. | Not rendered | Free trial |
| Spots left (17) | First 20 users get ReCopyFast Pro free for 3 months · 17 of 20 spots left | No credit card required. | Rendered, "17 of 20 spots left" | 3 months free for the first 20 |
| Last spot (1) | … · Last spot left | No credit card required. | Rendered, "Last spot left — 1 of 20" | 3 months free for the first 20 |
| Sold out (0) | Every new account gets 14 days of Pro, free | No credit card required. | Not rendered | 14-day free trial |
| Failed | = Sold out | = Sold out | = Sold out | = Sold out |

Per the design system, the four data-view states map as follows:
- Loading is the pulsing pill.
- Empty is Sold out: no spots is a real, final answer.
- Error is Failed. It deliberately renders as Sold out, because the 14-day trial line is never
  wrong. Someone who signs up while spots remain gets more than the line promised.
- Success is Spots left or Last spot.

There is no scarcity theatre: no timer, no pulsing red, no exclamation marks. The number is the
only scarcity signal.

## Design system gaps

1. **The Marketing surface has no recorded palette or component inventory.**
   `docs/design-system.md` lists eight legacy values (`sky-50` to `500`, `slate-600/700/900`).
   The landing also uses Tailwind defaults (`sky-600/700`, `teal-50/500/600/700/800`,
   `slate-200/400/500/800`), `.glass`/`.glass-sheet`, and card, tag, pill and trust-row patterns
   that aren't recorded anywhere. This design uses only ones already in use. `/ks-design-system`
   should record them.
2. **There is no marketing accent token, and the landing isn't pinned by `data-theme`.** It
   stays light only because every section uses literal colours. An app token such as
   `bg-primary` is `light-dark()`, so on the landing it would follow OS dark mode. That mixing is
   the design system's own "auth-page bug". So the design-system accent is expressed here as
   `teal-600`, not `bg-primary`. Also, `FinalCTA.tsx`'s emerald dots were missing from the
   design system's list of live emerald violations. This story removes them.
3. **No marketing skeleton primitive.** The loading pill composes `.glass` + `animate-pulse`.
   Tailwind's `animate-pulse` runs a 2 s cycle, which is outside the design system's two motion
   durations. The precedent is `Pricing.tsx:184-197`.
4. **No live-count or scarcity pattern.** This design reuses the Founding Agency count line. A
   meter, ring or progress bar would be new and is not designed here.
5. **The Founding Agency card breaks two rules**: a gradient (`Pricing.tsx:332`) and
   `shadow-xl` on a static panel. The new card is flat on purpose. s50 leaves the precedent as
   it is, so clean it up the next time someone works in that block.
6. **FinalCTA uses amber**: a Zap icon in `text-amber-500` and a heading span in
   `text-amber-950`. Marketing accents are meant to be teal or sky only. This is observed, not
   changed (s50 owns the pill text, and amber is outside this story). The mockup draws that pill
   neutral so it doesn't copy the colour.
