# Review — s71-billing-plan-badge

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s71-billing-plan-badge`
(`828970c` → `fd6def7`: 57d4c7e docs, 2f1afd6 fix, fd6def7 AC2 amended to the validated plan's case 3).

## Verdict summary

The owner's bug is fixed: a lifetime owner with no subscription row (the screenshot — "Pro plan · Lifetime
access" plus a "Free" badge) now sees "Lifetime"; no path on `/dashboard/billing` lets a lifetime or paid owner
see "Free" (badge, price line, header `… PLAN` badge, UpgradeDialog, sidebar all traced). Tasks 1 and 2 done as
planned; nothing beyond the plan. Every type and prop opened and confirmed. AC2 amendment judged right: the
card header describes the plan in force, so "Lifetime" beats a lower subscription's "ACTIVE".

Gates: billing jest 10 suites / 102; full jest 374 suites / 4,843 passed (one unrelated content-route test needs
`NEXT_PUBLIC_APP_URL`, absent from the worktree — green with it set); `type-check`, `type-check:build` exit 0;
eslint on changed files 0; `format:check` green; Playwright `--list` 78. Mutations: Lifetime branch removed → 2
red; "Free" fallback restored → 1 red; full revert → 3 red; empty-state copies swapped → 2 red; condition forced
→ 1 red; `isPlanHeldForLife` prop pass removed or forced → **0 red** (m-2).

## Findings

**M-1 (major, pre-existing on main; AC1 unmet in a reachable state).** A Pro subscriber who buys Lifetime Pro
sees no "Lifetime" until the old subscription's period ends: `BillingDashboard.tsx:267` excludes
`subscription.plan_id === plan.id`, while the webhook sets that subscription to cancel at period end
(`route.ts:973-976`). The card shows "ACTIVE", "$19/month", "Plan will be canceled", "Reactivate Subscription"
for up to one period after a $199 purchase — the main Lifetime Pro purchase path
(`LifetimeOfferCard.tsx:83-97`).

**M-2 (major, pre-existing on main; approved by amended AC2).** In the lifetime + running-out-subscription state
the card contradicts itself: the period rows (`SubscriptionCard.tsx:191-209`, `:235-244`) belong to the lower
subscription but never name it, so "Plan will be canceled" sits under "Lifetime" / "Lifetime access"; and
"Reactivate Subscription" calls `reactivateSubscription` (`subscription.ts:480-520`) with no lifetime check —
it would restart billing for a plan the grant replaced. The case-3 test uses `cancel_at_period_end: false`, a
state the webhook never leaves after a lifetime purchase.

**m-1.** With `isLifetime` true, a lower subscription's past-due or trialing status is shown nowhere
(`SubscriptionCard.tsx:140`); before s71 a red "PAST DUE" badge showed.

**m-2 (test gap).** Nothing tests `BillingDashboard.tsx:310` passing `isPlanHeldForLife` (mutations M3/M3b: 0 of
272 red).

**m-3.** `SubscriptionCard.tsx:67` `priceLabel` still returns "Free" for a 0-priced plan — unreachable today
(paid plans cost 9/19/49), but contradicts AC3 and the new "never reintroduce it" comment.

**m-4 (process).** AC2 was rewritten after the code (fd6def7) to match plan case 3, which the owner validated;
the owner should acknowledge the amended AC at ship.

## Not verified

`/dashboard/billing` never rendered (header with no badge, dark-mode contrast, mobile). Which state the owner's
account is in — the screenshot's "Lifetime access" price line plus "Free" badge is case 1 (grant, no
subscription row), which this branch fixes. M-1/M-2 from code reading, not a Stripe test-mode run. No real
Supabase/Stripe calls. `npm run build` not run (prebuild regenerates a tracked embed file; `type-check:build`
used). Playwright listed only; no e2e covers the billing badge.

Max severity: major
Ship allowed: yes

## Fix passes `9bead19`, `57bfdf0`

M-1: `isPlanHeldForLife` drops the `subscription.plan_id !== plan.id` clause — a plan the grant covers reads as
lifetime whatever a still-running subscription bills. M-2 (UI only): under a lifetime plan the period grid is
replaced by one named row ("Your Pro subscription ends October 10, 2026 — you won't be charged again." / "…
renews … — you hold Agency for life, so you no longer need it." with Cancel), name from the catalogue the page
already holds, "Your previous subscription" when unnamed; Reactivate is never rendered under lifetime. m-1 the
row carries a past-due/trialing status; m-2 dashboard test for the PaymentMethodsCard prop; m-3 "$0/month".
`57bfdf0`: the cancel confirmation under lifetime no longer says "You keep access until <period end>".

## Verification of `9bead19` and `57bfdf0` (fresh reviewer, 2026-10-08)

Every finding fixed and proven by a red test. `isPlanHeldForLife` traced against `readEffectivePlanBasis` for
none / unknown / granted × higher, same, lower subscription: an Agency subscription always wins over a lifetime
Pro grant (false, card unchanged); same or lower → true with a named row. Only `SubscriptionCard` and
`PaymentMethodsCard` read it. Non-lifetime states byte-identical to main apart from the intended "Free" removals.
12 mutations, all red. Jest billing 120/120; full 374 suites / 4,857; `type-check` (both) 0; ESLint 0;
`format:check` clean; `--list` 78. Interdicts hold (nothing under `src/lib/stripe`, `src/app/api`, `supabase`,
`public/embed`, `server`, `src/components/ui`).

New minors: N-1 a Founding Agency buyer still running out an Agency subscription reads "1,000 AI credits /
month" with nothing saying it drops to 250 at period end (pre-existing for Pro → Founding Agency since s45;
follow-up). N-2 past-due/trialing + not cancelling said "renews <date>". N-3 two comments restated the invariant
M-1 removed. Server-side gap (not a finding of this UI-only story): `POST /api/billing/subscription/reactivate`
has no lifetime check — follow-up story recommended.

## Fix pass `7640c67` — N-2, N-3

A past-due or trialing subscription not set to cancel reads "… is past due — you hold Agency for life, so you
no longer need it." (no "renews"); test red first. Comments at the `isLifetime` prop and the badge now describe
the M-1 rule. Jest billing 121/121; full 4,858 passed; type-check 0; ESLint 0. N-1 and the reactivate endpoint
are follow-ups, not blockers. Reviewed by the orchestrator (copy-only, not authored by the verifier).

## Tests changed (AGENTS.md § Tests)

Task 1 case 3 asserted `getByText("Current period")` in the lifetime + running-out state; M-2 replaces that grid,
so it now asserts the named row. No other existing assertion changed.

Max severity: minor
Ship allowed: yes
