# Design Brief — Story s47-founding-20-offer

> Paste this brief into the external design tool (Claude Design / Gemini). It is self-contained: story, screens, constraints, expected output.

**Attach these reference images** (current production, captured 2026-09-27 from
https://www.recopyfa.st; local reference screenshots (not committed)):

| File | Shows |
|---|---|
| `landing-hero-desktop.png`, `landing-hero-mobile.png` | Hero today. The line under the buttons reads "14 days of Pro. No credit card required." |
| `landing-pricing-desktop.png`, `landing-pricing-mobile.png` | Pricing section today: 3 plan cards, Lifetime Pro, the **Founding Agency** card with "50 of 50 founding spots left" (the closest precedent for this story), and the trust row starting "14-day free trial" |
| `landing-final-cta-desktop.png`, `landing-final-cta-mobile.png` | Final call to action: the glass pill "Set up in under 5 minutes" and a second trust row starting "14-day free trial" |

The dashboard badge and the billing card sit behind sign-in, so there are no screenshots of
them. Screens 2 and 3 describe their current state from the code.

## Story

**First 20 users get ReCopyFast Pro free for 3 months.** Today every new account gets a 14-day
Pro trial at first sign-in, with no card. For the first 20 new accounts after the offer opens,
that first sign-in grants **Pro for 90 days** instead, with **100 AI credits a month** and **no
card**. Account 21 and later gets the 14-day trial exactly as today. When the 90 days end, the
account lands on the existing lapsed "choose a plan" billing screen: nothing is charged and no
card is ever asked for. For more AI during the offer, the account buys the existing credit pack
(**$19 for 1,000 credits**). Purchased credits are spent after the monthly 100.

Acceptance criteria this design has to satisfy:

1. The landing page shows the offer with a live **"X of 20 spots left"**. The count comes from
   a public endpoint that returns only the number. It stays correct after a sign-up without a
   redeploy.
2. At 0 spots the landing stops presenting the offer and shows the 14-day trial line again.
3. If the count cannot be read, the page never shows a guessed or stale number.
4. The dashboard trial badge and the billing card say what the account actually has:
   **"Founding offer — N days left"** and **"100 AI credits a month"**. An offer account never
   sees "500 trial AI credits" or a 14-day countdown.
5. After 90 days the account sees the existing lapsed "choose a plan" screen. That screen is
   not redesigned here.

What the offer account gets. Use these facts and no others:

| Fact | Exact wording to use |
|---|---|
| Duration | "3 months" in marketing copy, "90 days" where precision matters. They are the same thing. |
| Sites | "5 websites" |
| Collaboration | "Invited editors" |
| Multi-site editing | "All sites view" |
| AI | "AI suggestions" |
| Allowance | "100 AI credits a month" (never 500 for an offer account) |
| Payment | "No credit card required". Nothing is charged when the offer ends. |
| More AI | "1,000 AI credits for $19", spent after the monthly 100 |
| After 90 days | Choose a plan to keep editing. The site keeps serving its current content either way. |
| Spot 21 onward | The 14-day Pro trial |

Brand spelling: **ReCopyFast** (capital C), which is how the wordmark and every UI string write
it. The owner's hook line spells it "RecopyFast"; use the wordmark spelling.

## Screens to produce

### Screen 1 — Landing: the founding offer and its live spot count

Marketing surface. It sits on the WebGL sky, is pinned light and has no dark mode. It uses the
marketing palette below, not the app tokens. Three places change, and all three read **one**
count from **one** request, so the hero and the pricing card can never disagree.

- **Purpose:** put the hook "First 20 users get ReCopyFast Pro free for 3 months" in front of
  every visitor, with honest scarcity (the live count), and then get out of the way cleanly
  once the spots are gone.

#### 1a. Hero announcement pill (new, above the headline)

- **Layout:** one glass pill, centred, directly above the `h1` "Change your … in seconds."
  (`src/components/sections/Hero.tsx:65`). Use the pattern of the existing glass pill in the
  final CTA section (`FinalCTA.tsx:21-33`): `.glass`, `rounded-full`, `px-4 py-2`, a 16px
  lucide icon followed by `text-sm` text in slate-800. Put a 16px `mb-6` gap between the pill
  and the `h1`. The pill's slot has a **fixed height in every state**, so the headline never
  moves when the count arrives. The whole pill is a link to `#pricing`.
- **Content, desktop:** `[Rocket icon, teal-700]` **"First 20 users get ReCopyFast Pro free for 3
  months"** `·` **"17 of 20 spots left"**. Set the count in `font-semibold text-teal-800 tabular`.
- **Content, mobile (390px):** the full line does not fit on one line, and a pill must not
  wrap. Use the short form: **"Pro free for 3 months · 17 of 20 left"**. The full hook line
  appears in the pricing card (1b).
- **Line under the CTA buttons** (`Hero.tsx:148-155`, today "14 days of Pro. No credit card
  required."): becomes **"No credit card required."** in every state. That is true for both the
  offer and the trial, and the pill now carries the variable part.
- **CTA buttons:** unchanged. "Start your free trial" is true in every state.
- **States:**
  | State | Pill shows | Line under the buttons |
  |---|---|---|
  | Loading (count not yet known) | Empty glass pill of the same size, opacity pulse (marketing skeleton, see components). No text, no number. | "No credit card required." |
  | Spots left, N ≥ 2 (e.g. 17) | "First 20 users get ReCopyFast Pro free for 3 months · 17 of 20 spots left" | "No credit card required." |
  | Last spot, N = 1 | "First 20 users get ReCopyFast Pro free for 3 months · Last spot left" (mobile: "Pro free for 3 months · Last spot left") | "No credit card required." |
  | Sold out, N = 0 | The 14-day trial line inside the same pill: **"Every new account gets 14 days of Pro, free"** (mobile: "14 days of Pro, free"). Rocket icon. Links to `#pricing`. | "No credit card required." |
  | Count failed | **Identical to sold out.** The trial line is never wrong: an account that signs up while spots remain simply gets more than the line promised. | "No credit card required." |

#### 1b. Pricing section: the offer card (new)

- **Layout:** one full-width card inside the pricing container (`max-w-6xl`). It sits
  **between the section subtitle "Choose the plan that fits your needs. Upgrade anytime." and
  the Monthly/Yearly toggle** (`Pricing.tsx:123-168`), so the toggle stays next to the prices it
  changes. The toggle does not affect this card. Use the structure of the Founding Agency card
  (`Pricing.tsx:327-393`, visible in `landing-pricing-desktop.png`): `rounded-3xl p-8`, a
  two-column grid `md:grid-cols-[1fr_auto] gap-8`, the left column for details and the right
  column for the price, count and CTA. It keeps that card's `border-2 border-teal-500` edge but
  **drops its gradient and `shadow-xl`**: the ground is flat `bg-white`. It stacks to one column
  on mobile. The card has `mb-8` below it before the toggle.
- **Left column:**
  - Icon tile: 48px square, `rounded-2xl bg-teal-50`, Rocket icon 24px teal-700. This is the
    same tile as the plan cards, whose Pro icon is Rocket.
  - Tag: **"Founding offer"**. It is a `rounded-full bg-teal-700 px-4 py-1.5 text-sm
    font-semibold text-white` pill, the same treatment as the "Most popular" tag
    (`Pricing.tsx:226-232`), but inline above the title instead of overlapping the edge.
  - Title (`h3`, `text-2xl font-semibold text-slate-900`): **"First 20 users get ReCopyFast Pro
    free for 3 months"**
  - Description (`text-sm text-slate-600`): **"Every Pro feature for 90 days, with 100 AI credits
    a month. No credit card, and nothing is charged when it ends."**
  - Benefit list: 2 columns from `sm` up, each item a 20px Check icon in teal-700 followed by
    `text-sm text-slate-700`. The items are **"5 websites"**, **"Invited editors"**, **"All sites
    view"**, **"AI suggestions"**, **"100 AI credits a month"** and **"No credit card required"**.
- **Right column** (`min-w-56`, text centred on mobile and right-aligned from `md`):
  - Price: **"$0"** (`text-5xl font-bold text-slate-900`) followed by **"for 3 months"**
    (`text-slate-600`).
  - Count (`mt-1 text-sm font-medium text-teal-800 tabular`): **"17 of 20 spots left"**
  - CTA: **"Claim your spot"**. It is a link button to `/signup`: `pressable rounded-xl bg-teal-700
    px-6 py-3 font-semibold text-white hover:bg-teal-800`, full width in its column. This is
    the same treatment as "Buy founding access".
- **Fine print:** full width under both columns, separated by `mt-8 border-t border-sky-100
  pt-6`, `text-sm text-slate-600`, two lines:
  - **"After 90 days, choose a plan to keep editing. Your site keeps serving its content either
    way. Need more AI before then? 1,000 credits for $19."**
  - **"Spots go in sign-up order. If all 20 are taken when you sign up, you get the 14-day Pro
    trial instead."** The count can lag a sign-up by a few seconds, and this line is what keeps
    "Claim your spot" honest at the boundary.
- **States:**
  | State | Card |
  |---|---|
  | Loading | A skeleton block of the card's height in the same slot: `rounded-3xl border border-sky-100 bg-white/60 animate-pulse`, the same composition as the pricing skeleton at `Pricing.tsx:184-197`. No text, no number. |
  | Spots left (17) | As above. |
  | Last spot (1) | The count reads **"Last spot left — 1 of 20"**. Nothing else changes: no red, no timer, no animation. |
  | Sold out (0) | **The card is not rendered.** The section looks exactly like `landing-pricing-desktop.png` today. |
  | Count failed | **Identical to sold out.** No card, no "unavailable" message, no number. This differs from the Founding Agency card, which shows "Availability temporarily unavailable". That is right for a product you pay for, but here the 14-day trial line is the honest fallback. |

#### 1c. Trust rows (copy swap, no layout change)

Two rows each start with "14-day free trial": the pricing trust row (`Pricing.tsx:69-74`,
rendered at `:397-412`) and the final CTA row (`FinalCTA.tsx:104-107`). Only that first item
changes:

| State | First trust item |
|---|---|
| Loading | **"Free trial"** (true in every state) |
| Spots left / last spot | **"3 months free for the first 20"** |
| Sold out / count failed | **"14-day free trial"** (today's text) |

The other items ("No credit card required", "Cancel anytime", "30-day money-back guarantee")
are unchanged.

Show 1a + 1b + 1c together on one artboard per state, at 1440 and at 390 wide: loading, 17
left, last spot, and sold-out/failed (one artboard, because the two are identical).

### Screen 2 — Dashboard: trial badge for an offer account

- **Purpose:** on the overview page, tell an offer account how long its free Pro lasts, in the
  offer's own name, and link to billing.
- **Where:** the `PageHeader` actions on `/dashboard` (`src/app/dashboard/page.tsx:177-192`),
  left of the "Add site" button. The component is `src/components/dashboard/TrialStatusBadge.tsx`.
- **Current state (from code):** a `StatusBadge` pill with a Clock icon, **"Trial — 12 days
  left"**, tone `info`, turning `warning` at 3 days or fewer (`TrialStatusBadge.tsx:22-26,63`).
  Its tooltip reads "Your Pro trial ends Oct 9, 2026. Open billing to upgrade." (`:75`). The
  whole pill is a link to `/dashboard/billing` with the global focus ring. It is absent for
  anyone who is not trialling.
- **Layout:** unchanged. The same pill, icon and position, and it is still a link to billing.
  Only the label and tooltip change for an offer account.
- **Content:**
  - Label: **"Founding offer — 64 days left"**. For one day: **"Founding offer — 1 day left"**.
  - Tooltip (`title`): **"Your founding offer gives you Pro until Dec 26, 2026. Open billing to
    choose a plan."**
  - Icon: Clock.
- **Actions:** click or Enter opens `/dashboard/billing`.
- **States:**
  | State | Shows |
  |---|---|
  | Loading | Nothing. The badge is absent until the entitlement read resolves, as today, and "Add site" stays where it is. |
  | Nominal (e.g. 64 days) | "Founding offer — 64 days left", tone `info`. |
  | Last days (≤ 3) | "Founding offer — 3 days left" / "— 2 days left" / "— 1 day left", tone `warning`. This is the same threshold as the trial badge. |
  | Error | Nothing. The existing rule is that a badge saying something wrong about someone's own account is worse than no badge (`TrialStatusBadge.tsx:15-18`). |
  | Expired | No badge. The account now has no plan, and every dashboard route redirects it to the existing lapsed billing screen, so the overview is not reachable. There is nothing to draw. |
  | Converted (bought a plan during the offer) | No badge, as today when a trial converts. |
  | Account 21+ (plain 14-day trial) | Unchanged: "Trial — N days left". Draw one artboard of it beside the offer badge for comparison. |
- Show the header at 1440 and 390 wide. At 390 the actions wrap, and the offer label is
  about 8 characters longer than the trial label. Draw it in light and dark.

### Screen 3 — Billing: the offer card for an offer account

- **Purpose:** on `/dashboard/billing`, state exactly what the offer account has (Pro, until
  when, 100 AI credits a month, how many are used) and give it two ways forward: buy more
  credits now, or choose a plan before the offer ends.
- **Where:** `src/components/billing/TrialStatusCard.tsx`, rendered full width at
  `BillingDashboard.tsx:255`. It sits under the page header ("Billing & subscription", the "PRO
  PLAN" badge and a "Change plan" button, all unchanged) and above the checkout banner and the
  card grid.
- **Current state (from code, for 14-day trials):** `Card variant="outline"` with `p-6` and
  `space-y-5`, holding two rows. Row 1 is an `IconTile` with Clock (info, or warning at 3 days
  or fewer), **"12 days left in your trial"** (`.text-title`) and **"Ends Oct 9, 2026"**
  (muted). Row 2 is an `IconTile` with Zap (info, warning at 80% or more, danger when used up),
  **"37 of 500 trial AI credits used"** with the number in `.text-metric .tabular`, and an 8px
  progress bar. When the credits are used up it adds "AI suggestions and translations are
  paused until you upgrade. Editing text by hand still works." The card has no actions.
- **Layout for an offer account:** the same card, the same two rows and the same tones, plus
  **one action row** at the bottom.
  - **Row 1 (time):** IconTile Clock. Title **"Founding offer — 64 days left"**. Muted line
    **"Pro until Dec 26, 2026. Nothing is charged when it ends."**
  - **Row 2 (credits):** IconTile Zap. **"12"** (metric) followed by **"of 100 AI credits used
    this month"** (muted). The progress bar sits under it, with the ARIA label "AI credits used
    this month". A muted line follows: **"100 AI credits a month for all 3 months. Credits you
    buy are spent after these."**
  - **Row 3 (actions):** a 1px `--line` divider, then `pt-5`. A muted paragraph comes first:
    **"Choose a plan before Dec 26 to keep editing without a break. Need more AI now? 1,000
    credits for $19."** It is followed by two buttons in a wrapping row with `gap-3`:
    - **"Choose a plan"**: `Button` default variant, default size (40px). It opens the existing
      plan dialog (`UpgradeDialog`, the same one "Change plan" opens).
    - **"Buy more AI credits"**: `Button` outline variant, default size. It opens the existing
      credit purchase dialog (`PurchaseCreditsDialog`, the same one "Buy credits" opens in the AI
      credits card). The pack size and price come from the catalogue: 1,000 for $19.
- **States:**
  | State | Card |
  |---|---|
  | Loading | `Skeleton` in the card's shape: two rows (a 36px square and two text bars each), then an action row with two 40px button-shaped bars. This extends the existing `LoadingRows` (`TrialStatusCard.tsx:69-83`) by one row, so the page does not jump. |
  | Zero (fresh account) | "0 of 100 AI credits used this month", empty bar, tone `info`. |
  | Nominal | 64 days left, "12 of 100", tone `info` on both rows. |
  | Credits running low (≥ 80) | "84 of 100 …", Zap tile and bar fill in `warning`. |
  | Credits used up (100 of 100) | Zap tile and bar in `danger`. Add the line **"This month's 100 AI credits are used. Credits you buy are spent next. Editing text by hand still works."** Swap the button emphasis: "Buy more AI credits" becomes the default variant and "Choose a plan" becomes outline. |
  | Last days (≤ 3) | The Clock tile turns `warning`. The title reads "Founding offer — 3 days left". The muted line becomes **"Pro until Dec 26, 2026. After that, choose a plan to keep editing. Your site keeps serving its content either way."** |
  | Error | The card renders nothing (existing rule, `TrialStatusCard.tsx:94-98`: a failed presentation read must not look like a problem with the account). A failure of the whole page is the existing "Error loading billing data" card with a "Try again" button, which is not redrawn. |
  | Expired | Not this card. The account lands on the existing lapsed screen (see Out of scope). |
  | Account 21+ (plain 14-day trial) | Unchanged: "N days left in your trial", "of 500 trial AI credits used", no action row. |
- Draw the offer card at 1440 wide in context (page header above, the top of the card grid
  below) and at 390 wide. Draw it in light and dark, covering nominal, credits used up and last
  days, plus the loading skeleton.

## Design system constraints (non-negotiable)

Two surfaces with two palettes. **Screen 1 is Marketing** (legacy `sky`/`slate` over the sky,
pinned light). **Screens 2 and 3 are App** (tokens, automatic light and dark). Never mix them
on one screen.

### Tokens — App (Screens 2 and 3)

Colour, from `src/app/globals.css`, declared with `light-dark()`. One accent, deep teal. Greys
are one cool family at hue 200.

| Token | Light | Dark | Class |
|---|---|---|---|
| `--accent-solid` | `hsl(176 54% 28%)` | `hsl(174 48% 58%)` | `primary` |
| `--accent-on-solid` | `hsl(0 0% 100%)` | `hsl(200 30% 8%)` | `primary-foreground` |
| `--canvas` | `hsl(200 24% 98%)` | `hsl(200 18% 7%)` | `background` |
| `--surface-card` | `hsl(0 0% 100%)` | `hsl(200 15% 10%)` | `card` |
| `--surface-1` | `hsl(200 24% 97%)` | `hsl(200 18% 8%)` | `surface-1` |
| `--surface-2` | `hsl(200 18% 94%)` | `hsl(200 14% 14%)` | `surface-2` |
| `--surface-3` | `hsl(200 16% 90%)` | `hsl(200 13% 18%)` | `surface-3` (progress track) |
| `--text-strong` | `hsl(200 22% 11%)` | `hsl(200 22% 96%)` | `foreground` |
| `--text-muted` | `hsl(200 11% 38%)` | `hsl(200 12% 68%)` | `muted-foreground` |
| `--line` | `hsl(200 15% 87%)` | `hsl(200 12% 21%)` | `border` (dividers, card edges) |
| `--line-strong` | `hsl(200 13% 55%)` | `hsl(200 10% 40%)` | `input` (control boundary, outline button) |
| `--danger-solid` | `hsl(358 60% 42%)` | `hsl(358 62% 62%)` | `destructive` |

Status tones. Colour signals **state**, never category. Each tone is a surface/text/line
triplet used as `bg-tone-X-surface text-tone-X-text border-tone-X-border`:

| Tone | Surface L / D | Text L / D | Line L / D |
|---|---|---|---|
| neutral | `200 18% 95%` / `200 12% 17%` | `200 12% 32%` / `200 12% 76%` | `200 15% 86%` / `200 12% 26%` |
| info | `204 62% 95%` / `206 44% 18%` | `206 72% 30%` / `204 78% 76%` | `204 55% 85%` / `206 40% 30%` |
| success | `162 46% 93%` / `166 40% 15%` | `166 72% 24%` / `162 60% 70%` | `162 40% 82%` / `166 36% 27%` |
| warning | `42 84% 92%` / `30 44% 17%` | `28 74% 29%` / `42 84% 68%` | `40 70% 80%` / `32 40% 29%` |
| danger | `4 76% 96%` / `358 40% 19%` | `358 62% 39%` / `4 84% 76%` | `4 70% 88%` / `358 36% 31%` |
| accent | `176 40% 93%` / `178 38% 16%` | `178 68% 24%` / `176 52% 70%` | `176 34% 82%` / `178 34% 28%` |

(All values are `hsl()`.)

Typography. Instrument Sans for all UI. **Weights 400 / 500 / 600 only**: never jump from 400
to 700 in UI. Bricolage Grotesque is never used in the app.

| Role | Class | Spec |
|---|---|---|
| Page title | `.text-display` | `clamp(1.625rem, 1.35rem + 1.1vw, 2rem)`, 600, line-height 1.12, tracking −0.023em |
| Panel/row title | `.text-title` | 1.0625rem, 600, line-height 1.35, tracking −0.012em |
| Eyebrow | `.text-eyebrow` | 0.6875rem, 600, uppercase, tracking +0.075em, muted |
| Body | `text-sm` (0.875rem) | `foreground` or `muted-foreground` |
| Number | `.text-metric` + `.tabular` | tabular numerals, 600, tracking −0.02em, line-height 1. Numbers must not change width as they change value. |

Spacing, radius, shadow, motion, focus:

- Rhythm in steps of 4px (`space-y-5` inside the card, `p-6`, `gap-3`, `mb-6` below it).
- `--radius: 0.75rem`. The container is softer than its contents: cards `rounded-xl`, controls
  `rounded-md`, the icon tile `rounded-lg`, and `rounded-full` only on pills (the badge, the
  progress bar).
- Shadows are tinted with the surface hue (`--shadow-a: hsl(200 32% 20% / 0.05)`, `--shadow-b:
  hsl(200 32% 20% / 0.07)` in light), never black. The outline card has no shadow.
- Motion: one easing, `cubic-bezier(0.22, 1, 0.36, 1)`, and two durations, 160ms and 220ms.
  Animate only transform, opacity, colour and shadow.
- Focus: `:focus-visible` draws a 2px `--accent-solid` outline at a 2px offset. Never remove it.

### Tokens — Marketing (Screen 1)

The landing stays on the legacy palette over the WebGL sky, **pinned light, with no dark
mode**. Accent moments use teal or sky only.

Declared in `globals.css`:

| Token | Value |
|---|---|
| `sky-50` | `hsl(204 100% 97%)` |
| `sky-100` | `hsl(204 94% 94%)` |
| `sky-200` | `hsl(201 94% 86%)` |
| `sky-400` | `hsl(198 93% 60%)` |
| `sky-500` | `hsl(199 89% 48%)` |
| `slate-600` | `hsl(215 19% 35%)` |
| `slate-700` | `hsl(215 25% 27%)` |
| `slate-900` | `hsl(222 47% 11%)` |

Already used on the landing today, with Tailwind v4 default values (see gap 1):

| Class | Value | Used for |
|---|---|---|
| `sky-600` / `sky-700` | `oklch(58.8% 0.158 241.966)` / `oklch(50% 0.134 242.749)` | Primary CTA fill and hover, eyebrow |
| `teal-50` | `oklch(98.4% 0.014 180.72)` | Icon tile ground (offer card) |
| `teal-500` | `oklch(70.4% 0.14 182.503)` | Offer card border |
| `teal-600` | `oklch(60% 0.118 184.704)` | Trust-row check icons |
| `teal-700` | `oklch(51.1% 0.096 186.391)` | Offer tag, CTA fill, list checks, pill icon |
| `teal-800` | `oklch(43.7% 0.078 188.216)` | Spot count text, CTA hover |
| `slate-400` / `slate-500` / `slate-800` | `oklch(70.4% 0.04 256.788)` / `oklch(55.4% 0.046 257.417)` / `oklch(27.9% 0.041 260.031)` | Secondary heading tint / muted small text / text on glass |

Marketing type and spacing, as used in `Pricing.tsx`, `Hero.tsx` and `FinalCTA.tsx`:

- Bricolage Grotesque (`font-display`) is for the landing `h1` and section `h2` only. Card
  titles, the pill, the counts and all body text use Instrument Sans.
- Card title `text-2xl` (1.5rem) at 600. Price `text-5xl` (3rem) at 700, which is allowed on
  marketing display. Body `text-sm` (0.875rem) in slate-600 or slate-700. Eyebrow `text-sm`
  600, uppercase, tracking 0.075em.
- Section `py-24 sm:py-32 px-6`, container `max-w-6xl mx-auto`, card `p-8`, card gap `gap-6
  lg:gap-8`, card radius `rounded-3xl`, CTA `rounded-xl px-6 py-3`, pill `rounded-full px-4
  py-2`, icon tile 48px `rounded-2xl`.
- `.glass` (the pill): background `color-mix(in oklab, white 14%, transparent)`, 1px border
  `color-mix(in oklab, white 30%, transparent)`, `backdrop-filter: blur(32px) saturate(180%)`,
  inset top highlight `inset 0 1px 0 color-mix(in oklab, white 60%, transparent)`, soft shadow
  `0 2px 40px -12px hsl(200 40% 30% / 0.18)`.

### Components to reuse

App (from `src/components/ui/`, which is the floor; compose from it):

- `Card`, `variant="outline"`: the offer card container (no shadow, `--line` edge, `rounded-xl`).
- `IconTile`, default size (36px, `rounded-lg`, 16px icon), tones `info`, `warning` and
  `danger`: the row icons (Clock, Zap).
- `StatusBadge`: the dashboard pill (`rounded-full`, `text-xs` at 500, tone surface/text/border,
  leading icon, `title` tooltip). Tones `info` and `warning`.
- `Button`: `default` (primary fill) and `outline` (`--line-strong` border on `card`), default
  size = 40px tall, `rounded-md`, `text-sm` at 500.
- `Skeleton`: loading, in the shape of the content, never a spinner.
- Progress bar: composed, not a primitive (see gap 3). An 8px `rounded-full bg-surface-3`
  track with a fill in `bg-tone-<tone>-text`, `role="progressbar"`. Reuse it exactly as it
  appears in `TrialStatusCard.tsx:135-147`.
- Lucide icons already in use: Clock, Zap.

Marketing (existing patterns in `src/components/sections/`):

- The Founding Agency card structure (`Pricing.tsx:327-393`), **without its gradient and
  `shadow-xl`**.
- The "Most popular" tag treatment (`Pricing.tsx:226-232`) for "Founding offer".
- The feature list with 20px Check icons (`Pricing.tsx:346-354`).
- The CTA link button (`Pricing.tsx:373-378`).
- The glass pill (`FinalCTA.tsx:21-33`).
- The skeleton block (`Pricing.tsx:184-197`).
- The trust row (`Pricing.tsx:397-412`).
- Lucide icons already in use: Rocket, Check.

### Do / Don't

✅ **Do**

- Compose only from the components above.
- Show every data view in all four states (loading skeleton, zero, error, nominal), plus the
  story's extra states (last spot, sold out, last days, credits used up).
- Put every number in tabular numerals: the spot count, day counts and credit counts.
- Use sentence case, plain language and active voice. "Claim your spot", not "Claim Your Spot".
- Keep app screens fully token-driven so light and dark both work. Keep the landing pinned
  light.
- Make colour mean state: `info` for nominal, `warning` for last days or high usage, `danger`
  for used up.

❌ **Don't**

- **No gradients anywhere**: cards, buttons, pills, tiles. That includes the offer card, which
  must not copy the Founding Agency card's `bg-gradient-to-br from-teal-50 to-sky-50`.
- No second brand colour. No emerald, purple, blue-to-purple or other saturated hue. On
  marketing, accents are teal or sky only.
- No `gray-*`, `zinc-*`, `neutral-*` or `stone-*` greys.
- No `shadow-lg` or `shadow-xl` on static panels, and no black shadows.
- No `transition-all`, no bespoke durations, and no entrance animation beyond the landing's
  existing fade-up.
- No fake urgency: no countdown timers, no "Hurry!", no pulsing red, no exclamation marks. The
  scarcity is the real count and nothing else.
- Never show a number that is not the live count. Loading and failure show no number at all.
- Never show an offer account "500 trial AI credits", "N days left in your trial" or a 14-day
  countdown.
- No toast. Feedback stays inline.
- Never use Bricolage (`font-display`) in the app, and never jump from 400 to 700 in app UI.

Do not invent components, tokens or colors outside these.

## Design system gaps

Recorded here, not filled freestyle:

1. **The marketing surface has no recorded palette or component inventory.**
   `docs/design-system.md` documents only the eight declared legacy values (sky-50 to 500,
   slate-600/700/900). The landing also uses Tailwind's default `sky-600/700`, `teal-50` to
   `800` and `slate-200/400/500/800`, the `.glass` and `.glass-sheet` utilities, and card, pill
   and tag patterns that are recorded nowhere. This brief lists only the ones already in use,
   with their real values. `/ks-design-system` should record them.
2. **The Founding Agency card breaks two rules.** It has a gradient (`Pricing.tsx:332`, `from-teal-50
   to-sky-50`) and `shadow-xl` on a static panel. The new offer card is flat on purpose. The
   precedent card should be cleaned the next time someone works in that file.
3. **No progress/meter primitive** (design-system gap 7). The credit bar is hand-composed in
   `TrialStatusCard.tsx`. Screen 3 reuses that composition rather than adding a primitive.
4. **No marketing skeleton primitive.** `Skeleton` is token-based (app). The landing composes
   its own `animate-pulse … bg-white/60` block. Screen 1 reuses that composition.
5. **The FinalCTA trust dots are `bg-emerald-500`** (`FinalCTA.tsx:105-115`), a forbidden hue
   and not one of the two violations the design system lists. If the mockup redraws that row,
   use `teal-600`, matching the pricing trust checks. Do not copy emerald.
6. **No marketing pattern for a live count or scarcity.** The only precedent is the Founding
   Agency's plain `text-sm font-medium text-teal-800` count line. Screen 1 uses that. A spots
   meter or progress ring would be new and is not designed here.

## Out of scope

- **The lapsed "choose a plan" billing screen** (`BillingDashboard.tsx:159-205`). It exists
  and an offer account lands there after 90 days. Do not redraw it. Note for the plan, not for
  this design: its body line "Your 14-day Pro trial has ended…" is untrue for an offer account
  and needs a one-line copy fix (research open question 3).
- The plan dialog (`UpgradeDialog`) and the credit purchase dialog (`PurchaseCreditsDialog`).
  Screen 3 opens them as they are.
- The rest of the billing page: header, `SubscriptionCard`, `CreditBalanceCard`, `UsageCard`,
  payment methods, invoices and lifetime offer cards. Known adjacent issue, not s47's: for any
  trialling account, `SubscriptionCard` shows a "Free" badge and "$19/month"
  (`SubscriptionCard.tsx:63-68,133`).
- The 14-day trial badge and card for account 21 and later. They are unchanged and drawn only
  for comparison.
- Hero headline, CTA buttons and demo; the three plan cards; the Lifetime Pro and Founding
  Agency cards; the header and its "Get started"; `/try` ("Start your free trial" is true in
  every state); `/signup` and the auth pages.
- Emails. The offer sends none.
- The operator's spot-release tool. It is a service-role command in the runbook, with no UI.
- Countdown timers, confetti, a spots meter, and any new animation.

## Expected output

A static HTML mockup of each screen (low fidelity is fine), using only the tokens above. Bring the export back — it will be saved as docs/designs/s47-founding-20-offer.html.

One artboard per state, labelled with the state name:

- **Screen 1:** loading, 17 of 20 left, last spot, and sold out/failed. Each at 1440 and 390
  wide, showing the hero pill, the pricing offer card and both trust rows. Light only.
- **Screen 2:** the page header with the badge at 64 days, 3 days and 1 day; the no-badge
  header (loading, error, expired, converted); and the unchanged 14-day trial badge for
  comparison. At 1440 and 390, in light and dark.
- **Screen 3:** loading, zero, nominal, credits running low, credits used up and last days. At
  1440 in page context and at 390, in light and dark.

Use real copy from this brief, never lorem ipsum. Example dates: the offer ends
**Dec 26, 2026** (granted Sep 27, 2026 + 90 days), so 64 days left means today is Oct 23, 2026.
