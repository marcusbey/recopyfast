# Design — Story s47a-founding-20-grant

## Screen(s)

Three existing app screens get new copy for an offer account. No route, layout or primitive is
added. The one visible addition is an action row at the foot of the billing card. The source
brief is [`s47-founding-20-offer-brief.md`](./s47-founding-20-offer-brief.md) (Screens 2 and 3).
Where this document differs from the brief, the difference is listed under "Copy decisions"
below, with the reason.

All three are **App surface**: tokens only, automatic light and dark.

Example dates used throughout: the offer was granted Sep 27, 2026 and ends **Dec 26, 2026**
(90 days). "64 days left" means today is Oct 23, 2026.

### 1. Dashboard overview: the header badge (`/dashboard`)

`TrialStatusBadge` in the `PageHeader` actions (`src/app/dashboard/page.tsx:177-192`), left of
"Add site". Same pill, icon, tone rule and position as today, and still a link to
`/dashboard/billing` with the global focus ring. For an offer account (`trial.offerId`) only
the label and tooltip change:

| Part | Offer account | Plain 14-day trial (unchanged) |
|---|---|---|
| Label | **Founding offer — 64 days left** / **Founding offer — 1 day left** | Trial — 12 days left |
| Tooltip (`title`) | **Your founding offer gives you Pro until Dec 26, 2026. Open billing to choose a plan.** | Your Pro trial ends Oct 9, 2026. Open billing to upgrade. |
| Icon | Clock | Clock |
| Tone | `info`; `warning` at 3 days or fewer | same |

At 390 px the header stacks (title, then the actions row). The offer label is about 8
characters longer than the trial label, and badge plus "Add site" still fit on one line in the
358 px content width, so nothing wraps. The mockup shows it.

### 2. Billing: the offer card (`/dashboard/billing`)

`TrialStatusCard`, full width at `BillingDashboard.tsx:255`, under the page header ("Billing &
subscription", "PRO PLAN", "Change plan", all unchanged) and above the checkout banner and the
card grid. It keeps its container (`Card variant="outline"`, `p-6`, `space-y-5`, `mb-6`) and its
two rows. It gains a third row.

- **Row 1, time.** `IconTile` Clock. Title (`.text-title`): **Founding offer — 64 days left**.
  Muted line: **Pro until Dec 26, 2026. Nothing is charged when it ends.**
- **Row 2, AI credits.** `IconTile` Zap. **12** (`.text-metric .tabular`) then, muted, **of 100
  AI credits used this month**. The 8 px progress bar sits under it, `aria-label="AI credits
  used this month"`. Then a muted line: **100 AI credits a month for all 3 months. Credits you
  buy are spent after these.**
- **Row 3, actions.** A 1 px `--line` divider (`border-t`, `pt-5`). A muted paragraph:
  **To keep editing after Dec 26, choose a plan before then. A plan is billed from the day you
  choose it. Need more AI now? 1,000 credits for $19.** Then a wrapping row, `gap-3`:
  - **Choose a plan**: `Button` default variant, default size (40 px). Opens the existing
    `UpgradeDialog`, the one "Change plan" opens.
  - **Buy more AI credits**: `Button` outline variant, default size. Opens the existing
    `PurchaseCreditsDialog`, the one "Buy credits" opens in `CreditBalanceCard`.

  At 390 px both buttons stay on one line if they fit and wrap to two lines if they don't. They
  are never stretched to full width.

Every number comes from data, never a literal. The 100 is `creditsLimit`, the date is `endsAt`,
and "1,000" and "$19" are `catalogue.creditPack`.

The plain 14-day trial card (account 21 onward) is unchanged: "N days left in your trial",
"Ends …", "N of 500 trial AI credits used", and no action row.

### 3. Billing: the lapsed screen for an ended offer (`/dashboard/billing`, no plan)

This is the existing unentitled branch (`BillingDashboard.tsx:159-205`): a centred
`Card` (`max-w-lg p-8 text-center`), then `CheckoutStatusBanner`, then the lifetime offer cards.
It is not redesigned. When the payload carries `endedOfferId`, two strings change:

| Part | Ended offer (new) | Ended 14-day trial (unchanged) |
|---|---|---|
| Heading | **Your founding offer has ended** | Your trial has ended |
| Body | **Your 90 days of free Pro are over, and nothing was charged. Your site keeps serving its current content — editing, new sites and collaborators need Pro.** | Your 14-day Pro trial has ended. Your site keeps serving its current content — editing, new sites and collaborators need Pro. |
| Button | Upgrade to Pro (unchanged; opens `UpgradeDialog` with every plan) | Upgrade to Pro |

The existing precedence stays: an ended-offer account that still holds purchased credits sees
"You're on credits" instead, because credits outrank an ended trial. s49 later adds "Buy AI
credits" to this screen. That change is not part of this story.

### Copy decisions (where this differs from the brief)

1. **Action-row paragraph.** The brief says "Choose a plan before Dec 26 to keep editing
   without a break." That reads as advice to buy early. Checkout starts billing at once (there
   is no `trial_end`, `src/lib/stripe/checkout.ts:287-293`), so choosing a plan on day 10 gives
   up the remaining free days without saying so. The new paragraph says when billing starts.
2. **Used-up line.** The brief says "Credits you buy are spent next." That doesn't tell an
   account with no purchased credits that AI has stopped. The new line, **This month's 100 AI
   credits are used. AI suggestions now run on credits you buy. Editing text by hand still
   works.**, is true whether or not the account has bought any. It doesn't mention
   translations (s50 removes Translate claims) or promise a reset date, which the payload
   doesn't carry.
3. **Loading skeleton unchanged.** The brief adds a third skeleton row. That skeleton renders
   before the page knows what kind of account it has, so every plain-trial account (all but 20)
   would shrink by one row when data arrives. The offer card grows by one row instead, for 20
   accounts.
4. **Brand spelling** in UI strings stays **ReCopyFast**, the wordmark. The UI has 100
   occurrences of it and one of "RecopyFast". The owner's hook line wording is used unchanged.
   No string in this story names the brand.

## Mockup

`docs/designs/s47a-founding-20-grant.html` is a visual reference for all three screens, every
state, 1440 and 390 wide, light and dark. **Do not copy it into production.** Execute builds
with the real `src/components/ui/*` primitives.

## Reused components (from the design system)

- `PageHeader`: unchanged. The badge stays in `actions`.
- `StatusBadge`: the header pill, built inline (`{label, tone, icon: Clock, description}`), as
  today. Tones `info` and `warning`.
- `Card`, `variant="outline"`: the offer card (no shadow, `--line` edge, `rounded-xl`) and the
  lapsed panel (existing).
- `IconTile`, default size (36 px, `rounded-lg`, 16 px icon): Clock (`info`/`warning`) and Zap
  (`info`/`warning`/`danger`), as today.
- `Button`: `default` and `outline` at default size (40 px) in the action row, swapping variants
  when credits are used up. `lg` "Upgrade to Pro" on the lapsed panel (existing).
- `Skeleton`: the existing two-row `LoadingRows`, unchanged.
- Progress bar: the composition already in `TrialStatusCard.tsx:135-147` (`h-2 rounded-full
  bg-surface-3` track, `bg-tone-<tone>-text` fill, `role="progressbar"`). Only the
  `aria-label` changes, to "AI credits used this month".
- Existing dialogs, opened as they are: `UpgradeDialog`, `PurchaseCreditsDialog`.
- Type: `.text-title` (row titles), `.text-metric` + `.tabular` (credits used), `text-sm
  text-muted-foreground` (sub-lines, action paragraph). Day counts in the badge and title are
  numbers too and take `.tabular`.
- Icons: Clock, Zap (already in use for exactly these meanings).

## States

**Badge** (`/dashboard`)

| State | Shows |
|---|---|
| Loading | Nothing. The badge is absent until `/api/billing/entitlement` resolves, as today. "Add site" does not move. |
| Nominal (4+ days) | "Founding offer — 64 days left", `info`. |
| Last days (3 or fewer) | "Founding offer — 3 days left" / "— 2 days left" / "— 1 day left", `warning`. |
| Error | Nothing (existing rule, `TrialStatusBadge.tsx:15-18`). |
| Expired | Nothing. The account has no plan, and middleware redirects every dashboard route to the lapsed billing screen. |
| Converted (bought a plan) | Nothing, as when a trial converts (the entitlement route hides the countdown once converted). |
| Account 21+ | Unchanged "Trial — N days left". |

**Billing card** (`/dashboard/billing`)

| State | Card |
|---|---|
| Loading | The page-level skeleton with the existing two-row `LoadingRows`, unchanged. |
| Zero (fresh) | Row 2: "0 of 100 AI credits used this month", empty bar, `info`. Buttons: Choose a plan (default), Buy more AI credits (outline). |
| Nominal | 64 days left, "12 of 100", `info` on both tiles. |
| Running low (80 or more used) | "84 of 100 …", Zap tile and bar fill `warning`. No extra line. |
| Used up (100 of 100) | Zap tile and bar fill `danger`. The used-up line appears under the bar. **Buy more AI credits** becomes `default` and **Choose a plan** becomes `outline`; the button order stays the same. |
| Last days (3 or fewer) | Clock tile `warning`, "Founding offer — 3 days left". Muted line: **Pro until Dec 26, 2026. After that, choose a plan to keep editing. Your site keeps serving its content either way.** |
| Error | The card renders nothing (existing rule, `TrialStatusCard.tsx:94-98`). If the whole page fails, the existing "Error loading billing data" card with "Try again" shows; it is not redrawn. |
| Expired | Not this card. See the lapsed screen. |
| Account 21+ | Unchanged 14-day card, no action row. |

Time and credits keep separate tones: "3 days left" with "84 of 100" shows `warning` on both
tiles, and "64 days left" with "100 of 100" shows `info` and `danger`.

**Lapsed screen** (`/dashboard/billing`, no plan): one state, the ended-offer copy above.
Loading and error for this screen are the page's existing ones.

## Design system gaps

1. **No progress/meter primitive** (design system gap 7). The credit bar is still
   hand-composed in `TrialStatusCard.tsx`. It is reused, not extracted.
2. **The existing bar fill uses `transition-all`** (`TrialStatusCard.tsx:144`). The design
   system forbids it, and the fill animates `width`, which is not one of the four animatable
   properties. This story doesn't change the bar. It is recorded so the next story that touches
   the bar fixes it, for example by dropping the transition or animating `transform: scaleX`.
3. **A data view that hides on error instead of showing an `Alert`.** This is inherited from
   s01 (gap 2 there) and kept deliberately: a failed presentation read must not look like a
   problem with the account. It is still not written into the design system's States table as
   an allowed exception.
4. **No pattern for a card that shows status and also carries actions.** Status cards in the
   app have no actions, and action cards have no status rows. This card composes a divider plus
   a `Button` row from existing parts. Record the pattern if a second card needs it.

No token, colour or component outside `docs/design-system.md` is used.
