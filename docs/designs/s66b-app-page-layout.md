# Design — Story s66b-app-page-layout (s66b1-app-shell + s66b2-app-page-passes)

Agent path. The source is `docs/design-system.md` (the s66a revision, 2026-10-08), with evidence
from `docs/research/s66-app-design-system.md`, re-verified in the code at `d4dae46` (after s66a
merged). Decision: [ADR 053](../decisions/053-page-frame-is-layout-plus-page-shell.md).

Captures:
- before: `docs/designs/s66-app-design-system/current/`;
- after s66a: `docs/designs/s66a-app-design-tokens-and-panels/after/` (`dashboard-1280`,
  `billing-1280`, `settings-1280`);
- after this story: `docs/designs/s66b-app-page-layout/after/` (written by the harness).

## Ownership (2026-10-08 coordination)

The owner gave s66c everything under `/dashboard/sites`:
- the light list;
- the per-site subpages;
- the quick-setup stepper and the advanced settings;
- the Edit Website dialog.

s66c also owns the site components (list under "Collision list"). s66b provides the page frame
that s66c consumes, and applies it to every other app page, the sidebar and the header. The
story is split so that the frame lands first:

| Order | Story | What it draws |
|---|---|---|
| 1 | **s66b1-app-shell** | The frame: header, sidebar, `PageShell` / `PageHeader`, one title, one left edge on Overview, Content, Analytics, Settings and Billing |
| 2a | s66c-site-page-and-access | `/dashboard/sites/**` on `PageShell` (its own design) |
| 2b | **s66b2-app-page-passes** | Flat and square inside those five pages; the standalone pages (login, signup, auth error, `/edit`); nothing clipped |

2a and 2b touch different files and can run in parallel. Whichever merges second rebases the
shared files.

## What the current code does (re-verified at `d4dae46`)

| Research claim | Today | Owner |
|---|---|---|
| One page shell missing | Still true. `layout.tsx` frames width and gutters. Nothing frames the page inside it: each page titles itself | s66b1 |
| Four title styles | Still four, measured in code: <br>- `PageHeader` `.text-display` (clamp 26–32/600) on Overview and Sites; <br>- a hand-rolled `.text-display` on Billing; <br>- `text-3xl font-bold` (30/700) on Content and Settings; <br>- `text-2xl font-bold` **h2** (24/700) on Analytics. <br>Analytics shows **no title at all** while sites load (`analytics/page.tsx` returns a spinner) | s66b1 |
| Analytics and site detail have no h1 | Analytics: still true. Site detail: s66c replaces it | s66b1 / s66c |
| Billing 16 px off the left edge | Still true. `container mx-auto px-4 py-8` wraps all 5 returns of `BillingDashboard` and the Suspense fallback in `billing/page.tsx`. The s66a capture also shows the nested band | s66b1 |
| Analytics scrolls sideways at 1280 | The code path is unchanged: the title, the site select, two date inputs and two export buttons share one non-wrapping row. s66a only swapped the select for `NativeSelect`. Not re-measured live (no browser run in design); the s66b1 harness is the proof | s66b1 |
| Sites status filter clipped at 375 | Still true (`sites/page.tsx:364`: hidden-scrollbar pill group, `rounded-lg`, `rounded-md` segments) | **s66c** |
| Settings tabs clipped at 375 | **Fixed by s66a.** `TabsList` now wraps (`tabs.tsx`, underline style). s66b2's harness proves no trigger is hidden | s66b2 (proof only) |
| Rounded filter pill group | Still rounded | **s66c** |
| Rounded sidebar items | Still rounded: `rounded-md` items, `rounded-r-full` rail, `rounded-lg` plan box, `rounded-md` brand tile | s66b1 |
| Overview metric grid leaves the right third empty | Still true (s66a `dashboard-1280` after-capture) | s66b2 |
| Checklists nest three boxes deep | `ActivationChecklist`, now the quick-setup stepper | **s66c** |

Found while re-verifying:
- The header is `bg-card/85 backdrop-blur-md`, and the mobile overlay is
  `backdrop-blur-[2px]`. Both break "flat" and "Overlay: no blur".
- The sidebar brand row is 64 px, matching the old header.
- The mobile menu button is `fixed left-4 top-4`. Between 640 and 1023 px the header gutter is
  24 px, so the button no longer sits over the header's 40 px spacer.
- `/login`, `/signup` and `/auth/error` have **no h1**: `CardTitle` is an h3.
- `.text-display` is also the `/blog` h1, and `globals-css.test.ts` pins it byte-identical
  (s66a). Repurposing it would repaint the blog, so the page title gets its own utility (ADR 053).
- `.surface-interactive` (lift plus `shadow-md`) is on two app call sites: `ui/metric.tsx` and
  Overview's recent-site rows.
- `ContentElementCard` has `hover:shadow-md`.
- `font-bold` appears 13 times in 5 reachable files: 9 in `AnalyticsDashboard`, then
  `DashboardNavigation`, `content/page`, `settings/page` and `SiteDetailView` (s66c).
- Radius baseline: 45 files and 122 offences:
  - s66c owns 14 files / 49 offences;
  - s66b1 owns 3 files / 10 offences (`layout.tsx`, `DashboardNavigation.tsx`,
    `Breadcrumbs.tsx`);
  - s66b2 owns 28 files / 63 offences.

  Every file is listed in the plan.

## Screen(s)

### 1. The frame (s66b1)

```
≥1024                                                     <1024
┌──────────┬──────────────────────────────────────┐       ┌──────────────────────────────┐
│ RF  ReCo │ ⌂ Dashboard › Analytics          (A) │ 56    │[☰] ⌂ Dashboard › Analy… (A)│ 56
├──────────┼──────────────────────────────────────┤ ←one  ├──────────────────────────────┤
│WORKSPACE │ ↕24/32                               │  rule │ ↕24                          │
│▌Overview │ Analytics            [⇩ JSON][⇩ CSV] │       │ Analytics                    │
│ Sites    │ Monitor your site performance…       │       │ Monitor your site perfor…    │
│ Content  │ ↕24                                  │       │ [⇩ JSON] [⇩ CSV]             │
│ Analytics│ [All sites      ⌄][date][date]       │       │ ↕16                          │
│ ACCOUNT  │ ↕24                                  │       │ [All sites               ⌄] │
│ Settings │ ┌ panel ───────────────────────────┐ │       │ [date      ] [date      ]   │
│ Billing  │ └──────────────────────────────────┘ │       │ ┌ panel ─────────────────┐ │
│┌PLAN────┐│                                      │       │ └────────────────────────┘ │
││Pro     ││ ← left edge: 288 @1280 · 530 @1920   │       │ ← left edge: 16 @375 · 24 @768
└┴────────┴┴──────────────────────────────────────┘       └──────────────────────────────┘
 256 px      max-w 1180 · gutters 16 / 24 / 32
```

- **Header** (`layout.tsx`):
  - 56 px (`h-14`), sticky, `bg-card`, opaque, with no blur and a 1px `border-b`;
  - its inner row uses the main column's `max-w-[1180px]` and gutters, so the breadcrumbs start
    on the h1's left edge at ≥1024;
  - contents: breadcrumbs on the left (unchanged); the account `Avatar` on the right, inside a
    ghost icon `Button` (`rounded-control`, so its focus ring is square around the round
    avatar).
- **Sidebar** (`DashboardNavigation.tsx`, 256 px, unchanged width):
  - Brand row: 56 px tall with a `border-b` on the same line as the header's rule, so the top
    reads as one band. The brand tile is a 28 px square `bg-primary` tile with "RF" at 600, not
    700.
  - Items: 40 px tall and square (`rounded-container`).
    - Active: `bg-primary/12 text-primary`, plus a square 2 px rail (it loses `rounded-r-full`).
    - Hover: `bg-surface-2`.
    - Focus: a square 2 px ring.
  - Plan box: square, 1px `border`, `bg-surface-1`.
- **Below 1024**:
  - The menu button is `fixed left-4 sm:left-6 top-2`, centred in the 56 px header and over the
    header's spacer at every gutter.
  - The overlay is `bg-foreground/40` with no blur.
- **Main**: `max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8` (unchanged). The
  content's left x per width:

  | Width | Sidebar | Content left (= every h1's left) |
  |---|---|---|
  | 375 | hidden | 16 |
  | 768 | hidden | 24 |
  | 1280 | 256 | 288 |
  | 1920 | 256 | 530 with overlay scrollbars: the 1180 column centred in 1664, plus 32. A classic 15 px scrollbar makes it 522.5, so the harness reads the expected value from `main` at 1920 |

- **Loading skeleton** (`layout.tsx`, while auth resolves): the same 56 px header and brand row,
  with square blocks.

### 2. `PageShell` and `PageHeader` (s66b1; s66c consumes them)

```
≥640                                                         <640
[EYEBROW]                                                    [EYEBROW]
Title (h1 24/32 600) [meta]           [action][primary] ←40  Title (h1) [meta]
Description, 14/20 muted, one or two lines                   Description…
──── nav (optional, its own border-b) ────────────────       [action][primary]   ← wraps
↕ 24                                                         ──── nav ────
section                                                      ↕ 16
section                                                      section
```

- `PageShell` takes `{ title, eyebrow?, meta?, description?, actions?, nav?, children }`. Its
  root is `<div data-page-shell>`, a flex column with a gap of 24 px (16 below 640).
  - **Direct children are sections.** Each one starts at the content's left edge. Never wrap
    the sections in one extra div.
- `PageHeader` (`header[data-page-header]`):
  - **Title row**: the h1 in **`.text-page-title`** (new: `1.5rem/2rem`, 600, `-0.015em`,
    `--text-strong`, `overflow-wrap: anywhere`), followed by `meta` (badges, inline). The row is
    `min-h-10` and centred, so a 24 px title and 40 px buttons share one centre line.
  - **≥640**: `actions` sit at the right end of the title row. The eyebrow sits above, and the
    description spans the full width below.
  - **<640**: eyebrow, title row, description, then `actions` in their own row, left-aligned
    and wrapping.
  - Implementation hint, not a mandate: one grid with `grid-template-areas`, so the source
    order stays title → description → actions.
- **Description**: `text-sm text-muted-foreground`, `max-w-prose`, 4 px under the title row.
  It is a ReactNode, so s66c can put the domain there with an external-link icon.
- **`nav`** (s66c): rendered directly under the header, inside the shell's gap. Typically
  underline `Tabs` or a row of links with `border-b`. s66b's own pages leave it empty: Settings
  keeps its `Tabs` as the first section, because Radix `Tabs` must wrap both its list and its
  panels.
- **`.text-display` is untouched** (it stays the `/blog` h1, pinned since s66a).
- **Rhythm** refined from the design system's "page header to content: 24": the gap is 16 below
  640, the same as the section gap. One value per breakpoint for every vertical step in a page.

### 3. Overview `/dashboard` (s66b1 title; s66b2 grid and rows)

```
OVERVIEW
Welcome back, Ada                         [Trial · 9 days] [+ Add site]
Every site you have connected, and what has changed on them.

[ quick-setup / checklist — s66c-owned, drawn as a placeholder ]

┌ CONNECTED SITES ───────┐┌ TOTAL EDITS  ──────────────────────────────── [⟲] ┐
│ 3                  [◎] │└──────────────────────────────────────────────────┘
│ 2 of 3 have sent       │┌ AI SUGGESTIONS ───────────────────────────── [ϟ] ┐
│ content                ││ 128   Last 30 days                               │
│                        │└──────────────────────────────────────────────────┘
│                        │┌ LAST EDIT ─────────────────────────────────── [◷] ┐
└────────────────────────┘└──────────────────────────────────────────────────┘
┌ Your sites                                                        [Manage →] ┐
│ Most recently connected first.                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◎] Acme marketing  ● Live          acme.example                   12 edits │
│                                                                    2 h ago  │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◎] Client blog  ◌ Awaiting install client-blog.example            0 edits  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The grid fills its width. At ≥1024 the lead metric takes the left third and spans three rows;
  the three subordinate metrics stack in the right two thirds (`lg:col-span-2`, replacing
  `lg:col-start-2`). The asymmetry the code comment defends is kept. Below 1024 it is one
  column.
- Metrics are flat: `ui/metric.tsx` drops `.surface-interactive`, and a linked metric changes
  only its border colour on hover (Card `interactive`). The values stay `.text-metric`: 24/600
  for subordinates, the existing 40 px for the lead.
- "Your sites" is one `Card variant="outline"`:
  - a 48 px-plus header row with `border-b` (`SectionHeader` plus Manage);
  - a `divide-y` list of full-bleed rows (`px-6 py-3.5`, hover `bg-surface-2`). No box inside
    the box, no lift.
- `loading.tsx` mirrors this grid with square skeleton blocks.

### 4. Content `/dashboard/content` (s66b1)

- `PageShell` with title "Content" and description "Manage all editable content across your
  sites". The local 30/700 header goes.
- The filter row **leaves its card** and becomes a direct section:
  - `flex flex-wrap gap-2`;
  - search `flex-1 min-w-[12rem]`;
  - site and status `NativeSelect`s at their content width; full width below 640.
- The failure notice, the element list and the pagination follow, each on the left edge.
- **s66b2**:
  - the error and empty icon circles become `IconTile`s;
  - `ContentElementCard` loses `hover:shadow-md` and its last `rounded`.

### 5. Analytics `/dashboard/analytics` (s66b1 title and filters; s66b2 weights and radius)

```
Analytics                                                  [⇩ JSON] [⇩ CSV]
Monitor your site performance and user engagement
[All sites                 ⌄] [2026-09-08] [2026-10-08]
┌ TOTAL SITES ── [◎]┐┌ ACTIVE USERS ─ [⚇]┐┌ PAGE VIEWS ── [◉]┐┌ CONTENT EDITS [✎]┐
│ 4                 ││ 0                 ││ 0                ││ 0                │
└───────────────────┘└───────────────────┘└──────────────────┘└──────────────────┘
┌ AVG LOAD TIME ──────── [◷]┐┌ AVG EDIT TIME ───────── [∿]┐┌ CONVERSION RATE ──── [↗]┐
Trends   Top Sites   Performance
─────
┌ Page views trend ─────────┐┌ Content edits trend ───────┐┌ Active users trend ─────┐
```

- **Title.** The h2 "Analytics Dashboard" becomes the h1 "Analytics", the same word as the
  sidebar and the breadcrumb. This is the story's **one listed label change**. No test pins
  the old text (grep).
- **Delegate.** `AnalyticsDashboard` is the delegate, so it renders `PageShell` once and
  switches the body on its four states: loading, error with nothing cached, no data, and ready.
  `analytics/page.tsx` stops returning its own titleless spinner and passes its sites-loading
  state down.
- **Actions.** The export buttons (`outline sm`, labels "JSON" / "CSV" unchanged) move to the
  header actions.
- **Filters.** The filter row is a direct section, `role="group"` with the name "Analytics
  filters", `flex flex-wrap gap-2`:
  - the site `NativeSelect` is full width below 640 and `w-64` above it;
  - the two dates are the `Input` primitive with `type="date"` (they were hand-rolled
    `rounded-md` inputs), `w-40` each, sharing a row below 640. Their `sr-only` labels "Start
    date" and "End date" are unchanged.

  This is what removes the 3 px overflow at 1280: nothing in a non-wrapping row any more.
- **s66b2**:
  - nine `font-bold` become `font-semibold` (values at 24/600, matching `.text-metric`);
  - skeleton blocks and alert boxes are square;
  - chart bars lose `rounded-t`;
  - the `rounded-lg` inset rows are square.

  The icon hues stay (off-palette is out of scope; follow-up).

### 6. Settings `/dashboard/settings` (s66b1 title; s66b2 panels)

- `PageShell` with title "Settings" and description "Manage your account and preferences".
  The local 30/700 header goes.
- The `Tabs` (Profile, Notifications, Security, API Keys, Appearance; labels unchanged) are the
  first section. At 375 the list wraps onto two rows, with three triggers then two, each fully
  inside the list's box. That wrapping is s66a's behaviour, proven here.
- **s66b2**:
  - the four inline `rounded-md` feedback paragraphs become square, still tone-coloured;
  - `ApiKeysPanel` (3) and `ThemePicker` (2) go square;
  - `ThemePicker` drops `border-2`: selected is `border-primary` plus a tick (design system,
    Borders).

### 7. Billing `/dashboard/billing` (s66b1 frame; s66b2 inner panels)

```
Billing & subscription                                [PRO PLAN] [Change plan]
Manage your subscription, payment methods, and billing information
[trial card — only while a trial runs]
┌ Current subscription ──────────── Free ┐ ┌ AI credits ──────── [Buy credits] ┐
│ Pro plan · Lifetime access             │ │ ┌──────────────────────────────┐ │
│ ✓ Up to 5 websites …                   │ │ │ 500  Available credits       │ │  square inset,
└────────────────────────────────────────┘ │ └──────────────────────────────┘ │  tone-accent
┌ Payment methods ─────── [Add new card] ┐ │ 0 Total purchased │ 0 Total used │  surface
└────────────────────────────────────────┘ └──────────────────────────────────┘
┌ Invoice history ───────────────────────┐ ┌ Current usage ────────────────────┐
└────────────────────────────────────────┘ │ Websites            1 / 5        │
                                           │ ▇▇▇▁▁▁▁▁▁▁▁▁▁▁  square bar        │
                                           └──────────────────────────────────┘
```

- **One frame for every state.** `BillingDashboard` renders `PageShell` once: title "Billing
  & subscription", the description, and actions [`PRO PLAN` badge] [Change plan] in the ready
  state only. Its five returns become one, with a state-switched body. The Suspense fallback in
  `billing/page.tsx` renders the same `PageShell` with a skeleton body. **No `container`
  anywhere**, which puts Billing's h1 on the shared left edge.
- **No-plan state.**
  - The centred `max-w-lg` card becomes a left-aligned `max-w-lg` card, the first section under
    the header.
  - Its heading ("Choose a plan to continue" / "You're on credits" / the ended-trial heading) is
    an **h2**. Tests find it by role and name, with no level, so they still pass.
- **s66b2 inner panels**:
  - the credits hero, the purchased/used tiles, the warning box, the invoice and payment-method
    rows, the lifetime-offer inset, the purchase dialog inset and the "Pro plan benefits" box
    become square, each keeping its tone surface;
  - the usage and trial progress bars become square tracks;
  - `UpgradeDialog`'s interval toggle and plan tiles become square, and drop `border-2`
    (selected: accent border plus tick).

  Emoji and the PRO PLAN copy stay (out of scope, see "Not drawn").

### 8. Standalone app pages (s66b2)

`/login`, `/signup`, `/auth/error` and `/edit` keep their centred `max-w-md` column. They have
no sidebar and no app header.
- **Logo.** The tile is a square `bg-primary` tile (`rounded-xl` goes). The wordmark is
  unchanged.
- **Title.** Exactly one h1 per page in `.text-page-title`, replacing the h3 `CardTitle`:
  "Welcome back", "Create your account", "Authentication error", and the `/edit` hub's existing
  h1.
- **Icons.** The success, danger and accent circles (`LoginForm`, `SignupForm`, auth error,
  `/edit`) become `IconTile`s.
- **`/edit` site picker.** Its rows and the remember-me checkbox go square.
- **`UserMenu`** (the marketing header's account menu, scanned as app code) uses the `Avatar`
  primitive. The fallback keeps `bg-primary text-primary-foreground` (pinned by
  `UserMenu.test.tsx:258`).
- **Error surfaces.** `dashboard/error.tsx` and `shared/ErrorBoundary.tsx` square their icon
  and code boxes.

## Mockup

`docs/designs/s66b-app-page-layout.html` is a visual reference. **Do not copy it into
production.** Execute builds with `src/components/ui/*`.

The file is standalone:
- inline CSS;
- Google Fonts for Instrument Sans and JetBrains Mono, as `next/font` loads them;
- the dark-theme token values copied from `src/app/globals.css`.

It draws the frame and four pages (Overview, Analytics, Settings, Billing) at 1280 and 375.
Settings at 375 shows the wrapped tabs. All data is fixture data: the account is "Ada",
domains end in `.example`, there are no tokens and no emails.

## Reused components (from the design system)

- `PageShell` (**new composition**, ADR 053) and `PageHeader` / `SectionHeader`: every page.
- `Card` (`outline`, `interactive`), `Metric`, `IconTile`, `StatusBadge`, `Badge`: panels and
  rows.
- `NativeSelect`, `Input` (`type="date"`), `Button`: filters and actions.
- `Tabs` (underline): Settings and Analytics.
- `Alert`, `EmptyState`, `Skeleton`: states.
- `Avatar`: the header and `UserMenu`.

## States

The frame renders the title in **every** state, so no state ever shows a titleless page.

| Page | Loading | Empty | Error | Ready |
|---|---|---|---|---|
| Overview | `loading.tsx`: square skeletons in the new grid shape | `EmptyState` in "Your sites" (unchanged) | `Alert` in "Your sites" (unchanged) | as drawn |
| Content | `PageShell` + spinner body (unchanged body) | empty card (square `IconTile`) | error card (square `IconTile`) | filter row + list |
| Analytics | `PageShell` + skeleton metric row | `PageShell` + "No analytics data" | `PageShell` + "Couldn't load analytics" + Try again | as drawn |
| Settings | — (form state per tab, unchanged) | — | inline tone paragraphs (square) | as drawn |
| Billing | `PageShell` + skeleton (both the Suspense fallback and the client loading state) | no-plan card (h2) | `PageShell` + error card (h2, unchanged copy) | as drawn |
| Standalone | button `loading` (unchanged) | — | `Alert variant="destructive"` (unchanged) | one h1, square tiles |

## What the harness measures (`e2e/app-layout.spec.ts`)

**s66b1** adds `app pages @375 / @768 / @1280 / @1920` (4 tests). Each test signs in the
fixture owner and visits Overview, Content, Analytics, Settings and Billing:
- the app header is 56 ± 0.5 px tall. At ≥1024, the sidebar brand row's bottom equals the
  header's bottom (± 0.5);
- `documentElement.scrollWidth ≤ clientWidth`;
- exactly one visible `h1`, inside `[data-page-header]`, whose computed font is 24 px / 600;
- the h1's left x equals the table above for that width (± 0.5); at 1920 it equals `main`'s
  left plus 32. Either way it is one value across all five pages;
- `[data-page-shell]` has at least two element children, and every visible one starts at the
  h1's left x (± 0.5);
- at 1280, in dark and in light: h1, description, breadcrumb, and inactive and active sidebar
  items each contrast ≥ 4.5:1 with their background.

**s66b2** extends those four tests and adds `standalone pages @375 / @768 / @1280 / @1920`
(4 tests, signed out: login, signup, auth error, `/edit`):
- **Nothing clipped.** Every visible element with `overflow-x` ≠ `visible` has
  `scrollWidth − clientWidth ≤ 1`. The exceptions are form controls, elements with
  `text-overflow: ellipsis`, `sr-only` elements of 1 px or less, and `pre` inside a
  `CodeBlock`.
- **Settings tabs.** At 375 every trigger lies inside the `tablist` box.
- **Flat.** No element in `main` has a computed `box-shadow` other than `none` at rest. A
  hovered Overview metric and a hovered site row keep `transform: none` and
  `box-shadow: none`.
- **Overview grid.** At ≥1024, the right edge of the rightmost metric equals the content's
  right edge (± 0.5).
- **Standalone pages.** One h1 each, no page-level horizontal scroll, nothing clipped.
- **Evidence.** Captures go to `docs/designs/s66b-app-page-layout/after/<page>-<width>.jpg`,
  only when `RCF_LAYOUT_SCREENSHOTS=1`.

## Collision list (files s66c will also touch)

s66c owns these; **s66b edits none of them**:
- `src/app/dashboard/sites/**` (the list, the new `[siteId]` subpages, and the teams-moved
  notice inside the list);
- `SiteDetailView`, `SiteCard`, `ShareButton`, `ShareSiteDialog`, `ShareLinkCard`,
  `SiteRegistrationModal`, `ActivationChecklist`, `EditWebsiteButton`;
- `SiteEditorsCard`, `SiteEditorRow`, `InviteEditorForm`, `SiteInstallationCard`,
  `DomainVerification`, `WebhooksPanel`, `BulkOperations`;
- `VersionHistoryPanel`, `VersionPreviewDialog`, `VersionTimelineItem`;
- their tests.

These 14 baseline files hold 49 radius offences and one `font-bold`; s66c owns taking them to
zero.

Files both stories touch, each resolved by rebasing whichever merges second:

| File | s66b | s66c (expected) |
|---|---|---|
| `src/components/ui/page-shell.tsx`, `page-header.tsx` | creates / changes (s66b1) | consumes. Any new slot is asked of s66b1, not added locally |
| `src/__tests__/design/page-shell-guard.test.ts` | creates, with `sites/page.tsx` pending (s66b1); adds rules (s66b2) | removes the pending entry; its new pages must pass |
| `src/__tests__/design/radius-baseline.json` | removes its 31 entries | removes its 14 |
| `src/__tests__/design/radius-guard.test.ts` | flips to zero tolerance only if the baseline is empty when s66b2 merges | flips it if s66c merges last |
| `e2e/app-layout.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` (the test count) | +4 (s66b1), +4 (s66b2) | its own site-page tests |
| `src/app/dashboard/page.tsx` (Overview) | title, grid, recent rows | maybe the row `href` (to `/dashboard/sites/[id]`) and the checklist call site |
| `docs/design-system.md`, `docs/stories.md` | Shell, PageShell, `.text-page-title` rows; the s66b sections | its own rows and sections |

## Not drawn (out of scope)

- Off-palette colour: the Analytics icon hues, Billing's emoji, and the uppercase "PRO PLAN"
  badge copy. These are colour and copy follow-ups, not layout.
- `.text-title` converging from 17 to 16 px. `globals-css.test.ts` pins it byte-identical, and
  no story AC asks for it. The design-system row keeps "converges on 16px" without a story.
- Content density (one card per element). It is not in the defect list.
- Marketing, `/try` and `/blog`.

## Design system gaps and amendments

- **Amendment, recorded by s66b1 in `docs/design-system.md`.**
  - Page title class: `.text-page-title`, replacing `.text-display`, which stays for `/blog`.
  - New `PageShell` row in "Available components".
  - "Page header to content: 24" becomes "24 (16 below 640)".
  - PageHeader actions centre on the title row instead of aligning to the block's bottom. With
    a two-line description at 768, bottom alignment pushed the button away from the title it
    belongs to.
- **Gap, not filled here.** There is no `Table` primitive (gap 8). No s66b page has a table.
- **Gap, not filled here.** There is no toast (gap 1). Nothing in s66b needs one.
