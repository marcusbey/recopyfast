# Design — Story s09-section-impressions

## Screen(s)

One screen, extended, not replaced: the existing **Content** list at `/dashboard/content`
(`src/app/dashboard/content/page.tsx`), which already renders one `ContentElementCard`
(`src/components/dashboard/ContentElementCard.tsx`) per content element. AC 6 — "impression
counts per section appear in the dashboard next to that section's current text" — is satisfied
by attaching a count directly to the row that already renders that section's current text, not
by adding a separate analytics page. Per the brief: a separate table would destroy the value
this feature sells.

Two additions to the existing page, both entitlement-gated as one unit (research confirms
entitlement resolves once per account — `getEffectivePlan` / `resolveSiteOwnerId` — not per
element, so the gate is page-level, not per-card):

1. A two-tile summary strip above the list (entitled/trialling accounts only) — "Impressions
   today" and "Sections tracked" — using the `Metric` component exactly as it is documented ("a
   number with a label"). **This is an interpretive addition, not literally required by any AC.**
   It is the cheapest way to make the "decision tool" framing (PRD angle 4 of 5) legible in one
   glance instead of making the reader infer it card-by-card. Flag for `/ks-plan` to confirm
   scope; it drops cleanly if out of scope, nothing else in the design depends on it.
2. An inline impression readout attached to `ContentElementCard`'s content row — specifically
   the row that already represents the section's *current* content: the existing "Live" row when
   the element has been edited, the existing "Original" row when it hasn't (today's card only
   ever shows a "Live" row for edited elements — unedited elements have no separate "current"
   row because Original *is* current). The count follows that same logic, so it is never attached
   to a row that isn't actually the live text.

Unentitled accounts see the same page structure with the summary strip replaced by a single
upgrade banner, and every card's stat area replaced by a locked indicator — never a fabricated
zero, never silence. AC 7 states the widget sends no impression events for these accounts, so
the UI must not imply data exists that was never collected.

## Mockup   (REFERENCE only)

`docs/designs/s09-section-impressions.html` — static, all states laid out on one scrollable
page: the entitled account state first (summary strip, privacy line, five card variants covering
every per-row state), then the unentitled account state (upgrade banner, two locked cards).
**Not production code.** Execute builds this with the real `src/components/ui/*` components and
the real `ContentElementCard`; the HTML file exists to fix layout and states, nothing else.

## Reused components

- `Metric` — the summary strip, used exactly as documented ("a number with a label", `.text-metric
  .tabular` mandatory, `emphasis="lead"` on the one metric that leads). Icon `Eye` for
  impressions, tone left at the default (informational, not a state signal — nothing here is
  failing or waiting).
- `ContentValue` — unchanged. Keeps rendering the section's current text; the count sits beside
  it, never replaces or crowds it.
- `Card` (`default` variant) — the element card container, unchanged; the upgrade banner is also
  a `Card` (`default`) so it reads as part of the same page, not a modal interruption.
- `Badge` (`outline`) — the "Pro" tag on a locked stat. Deliberately a plain `Badge`, not
  `StatusBadge`: plan tier is a category, and the system is explicit that colour signals state,
  never category.
- `IconTile` (`tone="accent"`) — the glyph on the upgrade banner, one of the few places `accent`
  tone is correct per the existing registry (a genuine brand/promotional moment, not a status).
- `Button` (`default`) — "Upgrade to Pro" CTA on the banner. `Button` (`link`) — secondary "See
  what's included".
- `Skeleton` — the per-row loading state for the count, sized like `Metric`'s own loading branch
  (`h-4 w-12` in place of the number; the label stays static) — same convention, smaller instance.
- Type scale: `.text-eyebrow` (row labels, unchanged from the existing card), `.text-metric` +
  `.tabular` (every real number — summary tiles and the per-row count alike, mandatory per the
  design system), `text-sm text-muted-foreground` (the "Unavailable" / "Not tracked yet" /
  "Upgrade to see" copy).
- Icons (lucide-react, no new icon system): `Eye` (tracked, has a value — reuses the icon already
  imported in `ContentElementCard.tsx` for the "View" action, so "eye" already means "seen" in
  this file), `CircleDashed` (not tracked — reuses the exact icon `siteStatuses.verifying`
  already uses for "nothing recorded yet, and that's not a problem"), `Lock` (unentitled),
  `ShieldCheck` (privacy reassurance line).

## States   (empty / loading / error / success — plus not-tracked and unentitled)

Page-level empty / loading / error (no content at all, initial fetch, fetch failure) are
unchanged — `ContentElementCard`'s existing `EmptyState` / skeleton list / `Alert
variant="destructive"` pattern already covers them, and this story adds nothing to that layer.
What's new is entirely inside the per-row impression stat:

| State | Trigger | Treatment |
|---|---|---|
| Loading | Count not yet fetched for this element | `Skeleton` (`h-4 w-12`) in place of the number; label unchanged |
| Error | Count fetch failed for this element (rest of card renders fine) | `text-sm text-muted-foreground` "Unavailable" — the same copy `Metric` already uses on its own error branch |
| Success (nonzero) | Real data, count > 0 | `Eye` icon + `.text-metric .tabular` value + "impressions" label, full weight |
| **Zero (tracked)** | Real data, count = 0 — tracking is active, nobody has scrolled to it yet | Same treatment as any other number: `Eye` icon + `.text-metric .tabular` **"0"** + "impressions". A zero is a fact, rendered with full confidence, never dimmed differently |
| **Not tracked** | Element predates instrumentation, or has no page dimension recorded yet | `CircleDashed` icon (muted) + an em dash, **no digit rendered at all** + "Not tracked yet", with a `title` explaining why. Must never collapse into "0" — that would assert a fact ("nobody saw this") the system doesn't have |
| **Unentitled** | Account has no Pro/trial entitlement | Stat area replaced by `Lock` icon + `Badge variant="outline"` "Pro" + `text-primary hover:underline` "Upgrade to see impressions". No number, no zero, no blank — a locked affordance, consistent with the fact that the widget genuinely sent nothing for this account (AC 7) |

The zero/not-tracked pair is the one distinction this story calls out as non-negotiable, and it
is structurally impossible to confuse in the mockup: one branch renders a `.text-metric` digit,
the other renders a dash and never touches that class.

## Design system gaps

1. **No "gated feature" pattern exists yet.** This is the first Pro-gated *inline read* in the
   app — existing entitlement gates (e.g. `s01` trial expiry) block an action outright rather
   than showing a locked value beside real content. The `Lock` + outline `Badge` + inline upgrade
   link composed here uses only existing primitives, but there is no canonical answer in
   `design-system.md` for "value hidden behind a plan." `s11` (A/B results) and `s13` (agency
   plan) will need the identical decision; worth codifying once one of them ships, rather than
   three stories each composing a slightly different answer.
2. **No upsell/paywall banner primitive**, for the same reason — the summary-strip replacement is
   composed from `Card` + `IconTile` + `Button`, which is within contract, but it is a pattern
   that will recur across every Pro-gated surface the PRD lists.

Everything else this screen needs — the count itself, its two story-specific states, and the row
it attaches to — is already covered by existing components and tokens.
