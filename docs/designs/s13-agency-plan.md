# Design — Story s13-agency-plan

> **Assumption carried from research.** `docs/research/s13-agency-plan.md` records PRD open
> decision 7 (`prd.md:444-446`) as **blocking** — `/ks-plan` cannot start until it is answered.
> This design proceeds under **answer A** (agency-only, single invoice), which is what the
> story itself assumes (`stories.md:649`) and what every screen below is built against. If
> decision 7 resolves to answer B (client-paid upgrades), the site-count meter and the "one
> invoice" note below stop being true by construction and this document would need a pass —
> flagged here so that dependency is visible at the design layer, not just in research.
>
> **Scope, per the split.** This covers AC 1–7 and 9 only. AC 8 (branded subdomain) is
> `s20-agency-branded-subdomain` and is **not designed here**.

## Screen(s)

Five surfaces, all existing screens gaining an Agency-shaped row through data they already
render — no new page is created.

1. **Public pricing surface** — `src/components/sections/Pricing.tsx` (marketing) and
   `UpgradeDialog.tsx`'s plan grid (dashboard) both read `/api/pricing`. Today both render
   `starter`, `pro`, `lifetime_pro`. Agency becomes a fourth/second card in each, same
   components, same data path — the design is "add a row," not a new layout.
2. **Site-count meter** — new. `src/app/dashboard/sites/page.tsx` has status-filter chips but
   nothing today shows sites-used against the plan's limit. This is the surface AC 3/4 need to
   be visible on.
3. **Over-limit path in site registration** — `SiteRegistrationModal.tsx`. Today a denial from
   `canCreateWebsite` renders as one generic destructive `Alert` regardless of whether
   `additionalSitePrice` is set. This design splits that into two visually distinct states (see
   States).
4. **Upgrade Pro → Agency** — inside the existing "Change your plan" `UpgradeDialog`. No new
   dialog; the Agency card joins the plan grid and the existing proration copy gets one
   Agency-specific line.
5. **Downgrade refusal** — also inside `UpgradeDialog`, triggered by selecting a plan whose
   `limits.websites` is below the account's current site count.

**Not designed here — no screen needed:** AC 7, "one invoice covers all sites." Under answer A
this is true because billing is already per-user and `InvoiceHistoryCard.tsx` already renders
one row per billing-cycle invoice for the account; an Agency subscription produces exactly one
more row of the same shape. Nothing about that component changes for this story.

## Mockup

`docs/designs/s13-agency-plan.html` — **REFERENCE only**, low fidelity. Shows: the pricing row
with Agency alongside the existing plans, the site-count meter at four states (normal → near
limit → at limit → over limit), the over-limit offer vs. plain-refusal split, and the downgrade
refusal naming an exact number. Execute builds with the real `src/components/ui/*` components,
not by copying this markup.

## Reused components

- **`Card`** (`default`) — every panel; the plan grid inside `UpgradeDialog` already uses a
  hand-rolled `<button>` card, unchanged shape, Agency is one more entry in the same `.map()`.
- **`Badge`** — `default`/`secondary` for "Current" / "Selected" on plan cards (existing
  pattern in `UpgradeDialog.tsx:236-239`), unchanged for Agency.
- **`StatusBadge`** — new use: the site-count meter's state pill (`tone-neutral` "On track",
  `tone-warning` "Near limit" / "At your limit", `tone-info` "Extra sites active",
  `tone-danger` "Limit reached"). This is the component the design system names for "any
  state" — the meter's colour signal lives here, not in the bar itself (see gaps).
- **`Metric`** — the site-count number itself: `label="Sites"`, `value="{used} / {limit}"`
  (`.text-metric .tabular`, built in), `hint` carries the state-specific caption, `icon={Globe}`
  with `tone` following the same escalation as the adjacent `StatusBadge`.
- **`Alert`** (`info` / `warning` / `destructive`) — three distinct jobs, not one generic
  banner: `info` for the accepted-offer state ("2 extra sites active"), `warning` for the
  downgrade refusal shown *before* an attempt (nothing has failed yet, this is a guard), and
  `destructive` for the plain over-limit refusal and for the server-side downgrade-refusal
  fallback (something was attempted and blocked).
- **`Dialog`** — the existing `UpgradeDialog`; no second dialog is introduced. "Confirmation"
  for upgrade is the existing `DialogDescription` proration sentence; "confirmation" for a
  blocked downgrade is the inline `Alert` replacing the normal submit affordance, in the same
  dialog.
- **`Button`** (`default`/`outline`/`destructive`) — plan-card CTA, "Add site" trigger, and the
  disabled-with-reason state on the downgrade path (see States).
- **`IconTile`** — IconTile classes drive the `Metric`'s icon container tone; no standalone use.
- **Type scale** — `.text-metric .tabular` for every number that can change (site count, prices,
  the "$X each" overage rate — money must not jitter, per the design system's mandatory rule).
  `.text-eyebrow` for the meter's "Sites" label and the pricing section's existing eyebrow.

## States

| State | Where | Pattern |
|---|---|---|
| **Loading** | Pricing grid | Existing skeleton in `Pricing.tsx:168-181` — three pulsing cards. Agency adds a fourth; no change to the pattern. |
| **Loading** | Site-count meter | `Metric`'s own `state="loading"` — built-in skeleton sizing, nothing bespoke. |
| **Empty** | Site-count meter | A brand-new Agency account with zero sites: `value="0 / 20"`, `tone="neutral"`, hint "No sites yet — add your first one." Not a separate empty-state component; the meter renders this the same way it renders any low count, because zero is not an error here. |
| **Error** | Pricing grid | Existing retry pattern in `Pricing.tsx:154-166` — unchanged. `hasFailed` still means "could not read `/api/pricing`," which is now also where Agency amounts come from. No hardcoded fallback is introduced (T6) — a `/api/pricing` failure hides the Agency card exactly as it currently hides every other paid plan. |
| **Error** | Upgrade/downgrade submit | Existing generic `Alert variant="destructive"` in `UpgradeDialog.tsx:157-161` (`planChangeError`/`checkoutError`) — unchanged for failures unrelated to the site-count guard (card declined, network error). |
| **Success** | Plan switched | No toast (design system gap #1, still open). Same fallback the rest of the app uses: the dialog closes, `handleSubscriptionUpdate` refetches, and the page underneath is already correct — the `Badge` reading "AGENCY PLAN" and the site-count meter's new limit are the confirmation. |
| **Success** | Site added via offer | Same pattern — the modal's existing success screen (`SiteRegistrationModal.tsx:283-446`) is unchanged; the meter behind it updates to reflect the new count on `onSuccess`. |
| **At-limit** | Site-count meter | `value="20 / 20"`, `tone="warning"`, `StatusBadge` "At your limit", hint "Add another site to see what happens next." The exact-limit case is deliberately not `danger` — nothing has failed yet, the account simply has no headroom left. |
| **Over-limit, offer available** | Site-count meter + `SiteRegistrationModal` | Meter: `value="22 / 20"`, `tone="info"`, `StatusBadge` "Extra sites active", hint "2 extra at $8/mo each." Modal, at the moment of hitting the limit: `Alert variant="warning"` (not `destructive` — this is not a stop) reading *"Your Agency plan includes 20 sites. This one adds a 21st at $8/mo, billed with your next invoice."* with the form's submit button relabelled `Add site — $8/mo` rather than disabled. Chosen deliberately over `destructive`: a state the account can act through, not one that blocks it. |
| **Over-limit, no offer configured** | Site-count meter + `SiteRegistrationModal` | Meter: `tone="danger"`, `StatusBadge` "Limit reached". Modal: `Alert variant="destructive"` reading the plan's existing denial text (`permissions.ts:135`, unchanged: *"You've reached your limit of 20 websites"*), submit button disabled, single available action is `Button variant="outline"` → "Upgrade plan" (opens `UpgradeDialog`). No price is shown because none exists to show — showing one here is what T6 prohibits. |
| **Downgrade refused (pre-flight, client-side)** | `UpgradeDialog` plan grid | Selecting **Starter** (1-site limit) while the account holds 8 sites on Agency: the Starter card's normal feature list is replaced with `Alert variant="warning"` inline in the card — *"Downgrading to Starter would exceed its 1-site limit. You have 8 sites on Agency — remove 7 before switching."* — and the global submit button, if this card is the current selection, reads `Remove sites first` (`Button variant="outline"`, links to `/dashboard/sites`) instead of `Switch to Starter`. This is a **guard**, not a failure: `warning`, never `destructive`, because nothing has been attempted. Requires threading the account's current site count into `UpgradeDialog` as a new prop (it already reaches `BillingDashboard` via `dashboardData.currentUsage.websites` for `UsageCard` — this is wiring, not new data). |
| **Downgrade refused (server-side fallback)** | `UpgradeDialog` submit | If the pre-flight guard is bypassed or the client's count is stale, the existing error slot (`Alert variant="destructive"`, `UpgradeDialog.tsx:157-161`) renders the **same sentence** the guard showed — *"Downgrading to Starter would exceed its 1-site limit. You have 8 sites on Agency — remove 7 before switching."* — never the generic "Failed to change plan." One message, two places it can appear, so the account never sees a vaguer version of the truth depending on which check caught it. |

## Design system gaps

1. **No toast/transient feedback primitive** (already-open gap #1). Applies twice here: plan
   switch success and the accepted site-addition offer both fall back to the existing pattern
   of "the page underneath is already correct," per the design system's own instruction. Not
   filled here.
2. **Tone triplets have no solid/fill value — only `surface` / `text` / `border`.** A filled
   meter bar (the site-count progress fill) has nothing to tint *by state* without inventing a
   fourth value per tone. Resolved in this design by keeping the fill itself `bg-primary` at all
   times and moving the state signal entirely into the adjacent `StatusBadge` and hint text —
   composing existing primitives rather than inventing a `tone-*-solid` token. Recorded because
   the next story that needs a coloured meter (there will be one) hits the same wall.
3. **Form fields carry no `aria-invalid`/`aria-describedby`** (already-open gap #2). The
   over-limit `Alert` inside `SiteRegistrationModal` sits in the same form this gap already
   covers; not a new instance, just another place it applies.

No new component, token, colour or spacing was invented for this design. Everything above
composes `Card`, `Badge`, `StatusBadge`, `Metric`, `Alert`, `Dialog`, `Button`, `IconTile` — the
existing seventeen.

Design ready (`docs/designs/s13-agency-plan.md` + `.html`). Next step: `/ks-plan s13-agency-plan`
— note PRD open decision 7 must be answered first (research doc, Q1, blocking).
