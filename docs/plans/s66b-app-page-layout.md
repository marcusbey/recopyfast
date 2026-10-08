---
validated: yes
---
# Plan — Story s66b-app-page-layout (Part 1: s66b1-app-shell · Part 2: s66b2-app-page-passes)

> Owner decisions (2026-10-08): plan validated with the split (s66b1 first; s66b2 after s66b1 merges, in
> parallel with s66c). "Analytics Dashboard" becomes "Analytics". Whichever of s66b2 / s66c merges last
> deletes `radius-baseline.json` once it is empty.

Branches:
- Part 1: `feature/s66b1-app-shell`. This worktree's `feature/s66b-app-page-layout` is renamed at
  Execute, as s66a did.
- Part 2: `feature/s66b2-app-page-passes`, from `main` after Part 1 merges.

Inputs (this plan does not repeat them; read them first):
- research: `docs/research/s66-app-design-system.md`;
- design: `docs/designs/s66b-app-page-layout.md` and `.html`;
- decision: [ADR 053](../decisions/053-page-frame-is-layout-plus-page-shell.md);
- design system: `docs/design-system.md` (s66a revision).

**Why two parts.** On 2026-10-08 the coordinator gave s66c everything under `/dashboard/sites`,
and asked s66b for the shared `PageShell` / `PageHeader` that s66c builds on. Part 1 is the
frame, kept small so that it can merge first. After it merges:
- s66c builds the site pages on `PageShell`;
- Part 2 flattens and squares the rest of the app;
- the two run in parallel, because they touch different files.

Each part is one PR, with one review and six tasks. If the owner declines the split, run the two
parts in order on one branch: 12 tasks, which is over the ten-task line.

## Target story

See `docs/stories.md`, sections `s66b-app-page-layout`, `s66b1-app-shell` (AC 1–6) and
`s66b2-app-page-passes` (AC 1–6).

The owner's ask: one shell, one title, one left edge on every app page; no sideways scroll and
no clipping at 375, 768, 1280 and 1920 px; straight and flat.

## Ownership and collision list

**s66b edits none of these (s66c owns them):**
- `src/app/dashboard/sites/**`;
- `src/components/dashboard/{SiteDetailView, SiteCard, ShareButton, ShareSiteDialog,
  ShareLinkCard, SiteRegistrationModal, ActivationChecklist, EditWebsiteButton,
  SiteEditorsCard, SiteEditorRow, InviteEditorForm, SiteInstallationCard,
  DomainVerification, WebhooksPanel, BulkOperations, VersionHistoryPanel,
  VersionPreviewDialog, VersionTimelineItem}.tsx`;
- their tests.

Shared files are resolved by rebasing whichever story merges second:
- `e2e/app-layout.spec.ts`, plus the test count in `playwright.config.ts` and
  `.github/workflows/ci.yml`;
- `src/__tests__/design/radius-baseline.json`;
- `src/__tests__/design/page-shell-guard.test.ts`. s66c removes its pending entry;
- `src/app/dashboard/page.tsx`. s66c may retarget the recent-site row `href` and the checklist
  call site;
- `docs/design-system.md` and `docs/stories.md`.

**Radius baseline split** (`radius-baseline.json` at `d4dae46`: 45 files, 122 offences):

| Owner | Files (offences) |
|---|---|
| s66b1 (10) | `app/dashboard/layout.tsx` 3 · `components/dashboard/DashboardNavigation.tsx` 5 · `components/dashboard/Breadcrumbs.tsx` 2 |
| s66b2 (63) | `app/auth/error/page.tsx` 1 · `app/dashboard/billing/page.tsx` 2 · `app/dashboard/content/page.tsx` 2 · `app/dashboard/error.tsx` 2 · `app/dashboard/loading.tsx` 4 · `app/dashboard/page.tsx` 1 · `app/dashboard/settings/page.tsx` 4 · `app/edit/EditorSignIn.tsx` 5 · `app/login/page.tsx` 1 · `app/signup/page.tsx` 1 · `components/auth/{LoginForm 1, SignupForm 1, UserMenu 2}` · `components/billing/{BillingDashboard 2, CreditBalanceCard 4, InvoiceHistoryCard 1, LifetimeOfferCard 1, PaymentMethodsCard 1, PurchaseCreditsDialog 1, TrialStatusCard 3, UpgradeDialog 4, UsageCard 3}` · `components/dashboard/{AnalyticsDashboard 8, ContentElementCard 1, TrialStatusBadge 1}` · `components/settings/{ApiKeysPanel 3, ThemePicker 2}` · `components/shared/ErrorBoundary.tsx` 1 |
| s66c (49) | `app/dashboard/sites/page.tsx` 7 · `ActivationChecklist` 1 · `EditWebsiteButton` 6 · `SiteDetailView` 3 · `SiteEditorsCard` 9 · `SiteEditorRow` 2 · `InviteEditorForm` 1 · `SiteInstallationCard` 1 · `DomainVerification` 5 · `WebhooksPanel` 2 · `BulkOperations` 5 · `VersionHistoryPanel` 2 · `VersionPreviewDialog` 3 · `VersionTimelineItem` 2 |

Part 1 rewrites a few s66b2 lines anyway: the Billing skeletons, and the Analytics date inputs
that become `Input`. Wherever an entry drops, it is lowered in the same task, because the
guard's shrink-only test demands it.

---

# Part 1 — s66b1-app-shell

## Tasks (ordered)

1. [ ] **Harness first: `app pages @375/@768/@1280/@1920` (red).**
   - In `e2e/app-layout.spec.ts`:
     - make `capture()` take a root. s66a's describe keeps
       `docs/designs/s66a-app-design-tokens-and-panels`, and the new describe writes
       `docs/designs/s66b-app-page-layout`. s66a's assertions stay byte-identical;
     - add `test.describe("s66b app pages")`, with one test per width (reusing
       `seedLayoutOwner` / `signInAsLayoutOwner`). Each test visits `/dashboard`,
       `/dashboard/content`, `/dashboard/analytics`, `/dashboard/settings` and
       `/dashboard/billing`, waits for `networkidle`, and measures:
       - `[data-app-header]` height = 56 ± 0.5. At ≥1024, the bottom of
         `[data-sidebar-brand]` equals the header's;
       - `scrollWidth ≤ clientWidth`;
       - exactly one visible `h1`, inside `[data-page-header]`, with computed `font-size` 24px
         and `font-weight` 600;
       - the h1's left x: 16 / 24 / 288 at 375 / 768 / 1280; at 1920, `main`'s left plus 32.
         Assert one value across the five pages;
       - `[data-page-shell]` has ≥ 2 visible element children (width > 1). Each one's left
         equals the h1's left ± 0.5;
       - at 1280, in dark and in light, contrast ≥ 4.5:1 for: the h1 on the canvas, the
         description, the breadcrumb, an inactive nav item, and the active nav item (against
         its composited background).
   - Raise the Playwright contract by exactly 4 in `playwright.config.ts` and `ci.yml` (56 →
     60, or s66c's value + 4).
   - Run it against a production build (see interdicts). It **must fail** today: header 64, no
     `[data-page-shell]`, no h1 on Analytics, Billing's h1 at 304. Paste the red summary into
     the PR.
2. [ ] **`PageShell`, `PageHeader`, `.text-page-title` (AC 1).**
   - **Test first** (red):
     - `src/components/ui/__tests__/page-shell.test.tsx`:
       - with every slot set: exactly one `h1`, carrying `text-page-title`, inside
         `[data-page-header]`;
       - eyebrow, meta, description, actions and nav render, with DOM order title → meta →
         description → actions, and nav after the header;
       - the children are direct children of `[data-page-shell]`;
       - with only `title`, there are no empty slot wrappers;
     - in `globals-css.test.ts`, one new `it`: `.text-page-title` declares
       `font-size: 1.5rem`, `line-height: 2rem`, `font-weight: 600` and
       `letter-spacing: -0.015em`. The `.text-display` pin is untouched.
   - **Then:**
     - add `.text-page-title` to `src/app/globals.css`, next to the other type helpers, with a
       comment saying why it is not `.text-display`;
     - rework `src/components/ui/page-header.tsx`: the title row is `min-h-10` and centred;
       `meta`; `description: ReactNode`; actions on the title row at ≥640 and after the
       description below 640 (a `grid-template-areas` grid keeps that DOM order);
       `data-page-header`;
     - create `src/components/ui/page-shell.tsx`: `data-page-shell`,
       `flex min-w-0 flex-col gap-4 sm:gap-6`, a `nav` slot. Its comment points at ADR 053 and
       names the Billing double-container incident.
   - Sites (s66c) still renders `PageHeader` directly until s66c adopts the shell. Its title
     simply becomes 24 px; no Sites file is edited.
3. [ ] **The frame (AC 2).**
   - **Test first:** delete the `layout.tsx`, `DashboardNavigation.tsx` and `Breadcrumbs.tsx`
     entries from `radius-baseline.json`. `radius-guard.test.ts` goes red, naming 10 lines.
     The harness frame assertions from task 1 are already red.
   - **Then:**
     - `layout.tsx`:
       - header `h-14`, `bg-card`, no `/85`, no `backdrop-blur-md`, `data-app-header`;
       - the avatar trigger is `variant="ghost" size="icon"` with no `rounded-full` (the
         `Avatar` stays round);
       - the loading skeleton: `h-14` header and square blocks;
       - the skip link: `focus:rounded-control focus:shadow-md`.
     - `DashboardNavigation.tsx`:
       - brand row `h-14 border-b border-border`, `data-sidebar-brand`;
       - brand tile `rounded-container font-semibold`;
       - items `rounded-container`;
       - the rail loses `rounded-r-full`;
       - the plan box is `rounded-container`;
       - the mobile toggle is `left-4 sm:left-6 top-2`;
       - the overlay loses `backdrop-blur-[2px]`.
     - `Breadcrumbs.tsx`: `rounded-sm` becomes `rounded-control`.
   - `DashboardNavigation.test.tsx` and `Breadcrumbs.test.tsx` pass unchanged.
4. [ ] **Guard, then Overview, Settings and Content (AC 3, AC 4).**
   - **Test first:** `src/__tests__/design/page-shell-guard.test.ts`, which reuses
     `app-surface.ts` and `stripComments`. Rules:
     - **R1 adoption.** Every `src/app/dashboard/**/page.tsx`, outside `_ab-tests`, contains
       `<PageShell`, or its delegate does. Delegates: analytics → `AnalyticsDashboard.tsx`,
       billing → `BillingDashboard.tsx`. Redirect pages are exempt: `teams/page.tsx`, with a
       self-check that it calls `redirect(`.
     - **R2.** `<PageHeader` appears only in `ui/page-shell.tsx`.
     - **R3.** No `<h1` on the app surface outside `ui/page-header.tsx` and the standalone
       allow-list: `login/page.tsx`, `signup/page.tsx`, `auth/error/page.tsx`,
       `edit/EditorSignIn.tsx`.
     - **R4.** No `container` class token on the app surface.
     - **Pending map** `{ file: rules[] }`, shrink-only: a pending file that already passes a
       listed rule fails the test until its entry is removed.
       - Starting state: `sites/page.tsx` [R1, R2] (s66c), `analytics/page.tsx` [R1],
         `billing/page.tsx` [R1, R4], `BillingDashboard.tsx` [R3, R4].
       - It ends Part 1 holding `sites/page.tsx` only.
     - Self-test fixtures for each rule.
   - Also red: `src/__tests__/app/dashboard/content-page-shell.test.tsx`. Using
     `content-load-states.test.tsx`'s fetch mocks, the loading, error and ready states each
     render exactly one h1 named "Content", inside `[data-page-header]`.
   - **Then:**
     - **Overview** (`dashboard/page.tsx`): `<div className="space-y-8"><PageHeader…>` becomes
       `<PageShell eyebrow title description actions>`. The sections stay as direct children.
       No other change (the grid is Part 2's).
     - **Settings:** `PageShell` replaces the local h1 block. `Tabs` is the first child.
     - **Content:**
       - delete the local `PageHeader` function;
       - one `return`, with `PageShell` around a state-switched body;
       - the filter bar leaves its `Card` and becomes a direct child;
       - `ContentFilterBar`'s row becomes `flex flex-wrap gap-2`, with search
         `flex-1 min-w-[12rem]`.
5. [ ] **Analytics and Billing (AC 3, AC 4, AC 5).**
   - **Test first:**
     - remove analytics and billing from the pending map. The guard goes red;
     - `src/__tests__/components/dashboard/AnalyticsDashboard.page-shell.test.tsx`: loading,
       load error, no data and ready each render exactly one h1, "Analytics". In ready, the
       JSON and CSV buttons are inside `[data-page-header]`, and the filters are a
       `group` named "Analytics filters";
     - `src/components/billing/__tests__/BillingDashboard.page-shell.test.tsx`, using the
       existing billing tests' mocks:
       - loading, error, no plan, catalogue unavailable and ready each render exactly one h1,
         "Billing & subscription";
       - in the no-plan state, "Choose a plan to continue" is an h2;
       - no element has the class `container`.
   - **Then:**
     - **Analytics:**
       - `AnalyticsDashboard` renders one `PageShell` (title "Analytics", the description, the
         export buttons as `actions`) around a state-switched body;
       - the filter row is a direct child: `role="group"`, `aria-label="Analytics filters"`,
         `flex flex-wrap gap-2`;
       - the site `NativeSelect` is `w-full sm:w-64`;
       - the dates are `Input type="date"`, `w-full sm:w-40`, with their `sr-only` labels
         unchanged;
       - `analytics/page.tsx` passes `isLoadingSites` instead of returning its own spinner.
     - **Billing:**
       - `BillingDashboard` renders one `PageShell` around a state-switched body. Actions
         [PRO PLAN badge][Change plan] appear in the ready state only;
       - every `container mx-auto px-4 py-8` is deleted;
       - the no-plan card is `max-w-lg`, left-aligned, with an h2;
       - `TrialStatusCard`'s and `CheckoutStatusBanner`'s `mb-6` are dropped, because the
         shell's gap now spaces them;
       - `billing/page.tsx`'s Suspense fallback renders `PageShell` with a `Skeleton` body.
     - Lower the baseline entries the rewritten lines remove (`AnalyticsDashboard`,
       `BillingDashboard`, `billing/page.tsx`).
   - The existing `BillingDashboard.*.test.tsx`, `billing/__tests__/page.test.tsx` and
     `TrialStatusCard.test.tsx` pass unchanged.
6. [ ] **Docs, green harness, gates (AC 6).**
   - `docs/design-system.md`:
     - § Shell: "lands in s66b" becomes "in code (s66b1)";
     - add a `PageShell` row to "Available components" (ADR 053);
     - the typography "Page title" row: class `.text-page-title`, in code;
     - spacing: "Page header to content: 24 (16 below 640)";
     - `PageHeader` actions are centred on the title row.
   - Tick s66b1's ACs in `docs/stories.md`.
   - Run `app pages @w` green at all four widths, and record the measured left x values in the
     PR.
   - Run `npm run lint`, `type-check`, `format:check`, `build` and `test`.

## Run interdicts

- `git diff main...HEAD` is empty for every s66c-owned path in the collision list.
- `git diff main...HEAD -- src/app/api supabase public/embed server` is empty.
- In `globals.css`, `.text-display`, `.text-title`, `.surface-interactive`, `--radius` and the
  legacy scale stay byte-identical. `globals-css.test.ts` proves it; its existing `it`s are not
  edited.
- Existing test assertions are not edited. The only test-file changes are the ones listed
  under "Tests that change".
- Copy is unchanged, except "Analytics Dashboard" → "Analytics". No route changes.
- `PageShell` gets no slot beyond `title`, `eyebrow`, `meta`, `description`, `actions` and
  `nav` without an amendment to ADR 053. If s66c needs one, it asks.
- **Never run `next dev`.** Run Playwright against `npm run build && npx next start` with
  `PLAYWRIGHT_BASE_URL` and the local Supabase (`RUN_RECOPYFAST_CORE_E2E`).
- No new dependency. No `framer-motion` on the dashboard. No `--no-verify`. Jest SIGSEGV means
  load: retry.

## The point everything turns on

The left-edge contract: "every visible direct child of `[data-page-shell]` starts on the h1's
x". It is the only thing that proves "one left edge" rather than "one title". Where it could be
wrong:
1. **Vacuous pass.** A page that wraps all its sections in one `div` passes trivially; hence
   "≥ 2 children". Compare each page's DOM after task 4/5 against the design's per-page
   section list.
2. **False failure from non-layout children.**
   - Dialog roots render nothing, or portal to `body`. Live regions and `sr-only` nodes are at
     most 1 px wide.
   - `CheckoutStatusBanner` and `TrialStatusCard` can render `null`.

   The "visible, width > 1" filter must exclude exactly these. Check it against the Billing
   trial and non-trial fixtures and the Overview with its dialog closed.
3. **Scrollbar width at 1920.** A classic scrollbar moves the centred column by ~7.5 px. That
   is why 1920 reads its expected value from `main`, not from a constant. Compare the CI value
   against a local headless run.

Also verify that `PageHeader`'s grid keeps the actions after the description in DOM order (a
screen reader reads the title, then the description, then the actions), while drawing them on
the title row at ≥640.

## Files touched (Part 1)

- New:
  - `src/components/ui/page-shell.tsx`;
  - `src/components/ui/__tests__/page-shell.test.tsx`;
  - `src/__tests__/design/page-shell-guard.test.ts`;
  - `src/__tests__/app/dashboard/content-page-shell.test.tsx`;
  - `src/__tests__/components/dashboard/AnalyticsDashboard.page-shell.test.tsx`;
  - `src/components/billing/__tests__/BillingDashboard.page-shell.test.tsx`.
- Changed:
  - `src/app/globals.css`;
  - `src/components/ui/page-header.tsx`;
  - `src/app/dashboard/{layout,page}.tsx`;
  - `src/app/dashboard/{content,settings,analytics,billing}/page.tsx`;
  - `src/components/dashboard/{DashboardNavigation,Breadcrumbs,ContentFilterBar,AnalyticsDashboard}.tsx`;
  - `src/components/billing/{BillingDashboard,TrialStatusCard,CheckoutStatusBanner}.tsx`;
  - `e2e/app-layout.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`;
  - `src/__tests__/design/{radius-baseline.json,globals-css.test.ts}`;
  - `docs/design-system.md`, `docs/stories.md`.

## Test strategy (Part 1)

- **Unit (RTL):**
  - `PageShell`'s slots and DOM order;
  - per-state h1 counts for the three multi-return pages (Content, Analytics, Billing). The
    harness only sees the ready state.
- **Source guard:** adoption, one header component, no stray h1, no `container`. It has
  self-tests and a shrink-only pending map that hands `sites/**` to s66c explicitly.
- **e2e (harness):** the measured frame at four widths. These are the only proof of 56 px, of
  the left edge, and of no page scroll; jsdom computes no layout (s66a's lesson).

## Definition of Done (Part 1)

- The repo DoD: one PR, lint, type-check, format, build, test, and CI's `audit:prod` and
  `type-check:build`.
- Harness `app pages @375/@768/@1280/@1920` green, with the red run from task 1 shown in the PR.
- The guard's pending map holds only `src/app/dashboard/sites/page.tsx`.
- ADR 053 and the design-system update are merged with the code.
- s66c is told that the branch merged (it unblocks s66c's Execute).

---

# Part 2 — s66b2-app-page-passes

Starts from `main` with Part 1 merged. Before task 1:
- regenerate nothing;
- **re-read `radius-baseline.json`**. If s66c merged first, its entries are already gone, and
  the end state of task 6 changes accordingly.

## Tasks (ordered)

1. [ ] **New proofs first (red).**
   - `page-shell-guard.test.ts` gains three rules, each with self-tests:
     - **R5 flat.** No `surface-interactive`, `hover:shadow-*`, `group-hover:shadow-*`,
       `transition-shadow` or `hover:-translate-y-*` on the app surface. A static
       `shadow-{xs,sm,md,lg,xl,2xl}` is allowed only in `ui/{dialog,dropdown-menu,select,card}.tsx`,
       in `VersionHistoryPanel.tsx`, and as `focus:` in `layout.tsx`.
     - **R6 weight.** No `font-bold`, `font-extrabold` or `font-black`.
     - Pending, shrink-only: the s66c files that still offend at that time, for example
       `SiteDetailView.tsx` [R6] and `EditWebsiteButton.tsx` [R5].
   - `e2e/app-layout.spec.ts`:
     - extend `app pages @w`:
       - the clip check, with the exceptions as worded in s66b2 AC 5;
       - no `box-shadow` at rest in `main`;
       - hovering the first Overview metric and the first site row leaves `transform` and
         `box-shadow` at `none`;
       - at ≥1024, the rightmost metric's right edge equals the content's right edge ± 0.5;
       - at 375, every `[role=tab]` lies inside its `[role=tablist]`'s box.
     - add `standalone pages @375/@768/@1280/@1920`, in a fresh signed-out context, for
       `/login`, `/signup`, `/auth/error` and `/edit`:
       - one h1 with `font-size` 24px;
       - no page scroll;
       - the clip check.
     - Captures every page to `after/` behind `RCF_LAYOUT_SCREENSHOTS=1`.
   - Contract +4.
   - Red today: `metric.tsx`, Overview rows, `ContentElementCard`, `AnalyticsDashboard`'s 9
     `font-bold`, the Overview grid, and the auth pages' missing h1.
2. [ ] **Overview, and its error and loading frames (AC 1, 2, 4).**
   - **Test first:** delete the baseline entries for `dashboard/page.tsx`, `loading.tsx`,
     `error.tsx`, `TrialStatusBadge.tsx` and `ErrorBoundary.tsx`.
   - **Then:**
     - `ui/metric.tsx` drops `surface-interactive`. A linked metric uses
       `hover:border-primary/40` (Card `interactive`'s treatment);
     - the summary grid: lead `lg:row-span-3`; the others `lg:col-span-2` (replacing
       `lg:col-start-2`);
     - "Your sites" is a `divide-y` list of full-bleed rows (`px-6 py-3.5`,
       `hover:bg-surface-2`), with no inner box and no lift;
     - `loading.tsx` mirrors the grid, square;
     - `TrialStatusBadge`'s focus wrapper is `rounded-control`;
     - `error.tsx` uses an `IconTile` (danger), and its dev code box is `rounded-container`;
     - `ErrorBoundary`'s box is square.
   - `page.activation.test.tsx` and `TrialStatusBadge.test.tsx` pass unchanged.
3. [ ] **Billing internals (AC 1, 4).**
   - **Test first:** delete the remaining billing entries (`BillingDashboard`,
     `billing/page`, `CreditBalanceCard`, `InvoiceHistoryCard`, `LifetimeOfferCard`,
     `PaymentMethodsCard`, `PurchaseCreditsDialog`, `TrialStatusCard`, `UpgradeDialog`,
     `UsageCard`).
   - **Then:**
     - insets and rows become `rounded-container`, keeping their tone surfaces and borders;
     - the progress tracks and fills are square;
     - `UpgradeDialog`'s interval toggle is square; its plan tiles drop `border-2` for a 1px
       `border-input` (selected: `border-primary` plus `bg-tone-accent-surface` plus a tick, as
       the design system's option toggle);
     - the `TrialStatusCard` skeleton is square.
   - All `components/billing/__tests__/*` pass unchanged. `TrialStatusCard.test.tsx:246-272`
     pins button variants only.
4. [ ] **Content, Analytics and Settings internals (AC 1, 2, 3, 4).**
   - **Test first:** delete the entries for `content/page`, `ContentElementCard`,
     `AnalyticsDashboard`, `settings/page`, `ApiKeysPanel` and `ThemePicker`. R5 and R6 are
     already red.
   - **Then:**
     - Content: the error and empty circles become `IconTile` (`lg`, danger / neutral);
     - `ContentElementCard`: no `transition-shadow hover:shadow-md`, and the copy link is
       `rounded-control`;
     - Analytics:
       - 9 × `font-bold` become `font-semibold`;
       - skeleton bars, inline alerts and `rounded-lg` rows are square;
       - chart bars lose `rounded-t`;
       - the spinner in `analytics/page.tsx`, if any remains, keeps `animate-spin` (allowed);
     - Settings: the four feedback paragraphs are `rounded-container`;
     - `ApiKeysPanel`: square;
     - `ThemePicker`: square, `border-2` becomes a 1px border, selected as the option toggle.
5. [ ] **Standalone pages (AC 1, 5).**
   - **Test first:** delete the entries for `login/page`, `signup/page`, `auth/error/page`,
     `LoginForm`, `SignupForm`, `EditorSignIn` and `UserMenu`. The standalone harness tests are
     red from task 1.
   - **Then:**
     - the logo tile is a square `bg-primary` tile;
     - the `CardTitle` becomes `<h1 className="text-page-title">`, with the same text;
     - the success, danger and accent circles become `IconTile`s;
     - `/edit`: the h1 class becomes `text-page-title`; the remember-me checkbox is
       `rounded-control`; the picker rows and the empty box are square;
     - `UserMenu` uses `Avatar` + `AvatarFallback`, which keeps
       `bg-primary text-primary-foreground` (`UserMenu.test.tsx:258` is unchanged); the trigger
       is a ghost icon `Button`.
   - `LoginForm.test.tsx`, `SignupForm.test.tsx`, `EditorSignIn.test.tsx` and
     `session-management.test.tsx` pass unchanged.
6. [ ] **Close-out (AC 1, 5, 6).**
   - If `radius-baseline.json` is now `{}`:
     - delete it;
     - make `radius-guard.test.ts` zero-tolerance: "finds no offence on the app surface";
     - remove the shrink-only and must-be-zero tests and the `RCF_WRITE_RADIUS_BASELINE` path;
     - list the change in the PR.
   - Otherwise, leave the guard as it is, with only s66c entries, and note in s66c's story that
     it flips the guard.
   - Run the harness with `RCF_LAYOUT_SCREENSHOTS=1` and commit
     `docs/designs/s66b-app-page-layout/after/*` (fixture data only; each file under 400 KB).
   - In `docs/design-system.md`: s66b statuses become "in code", and `.surface-interactive`
     leaves the app.
   - Tick s66b2's ACs. Run the gates.

## Run interdicts (Part 2)

Part 1's interdicts, plus:
- no layout restructuring. Part 1 owns structure; Part 2 changes classes, `IconTile` swaps and
  the Overview grid only;
- no change to the Analytics icon hues, Billing's emoji, or "PRO PLAN" (out of scope);
- `UserMenu.test.tsx:258` and `TrialStatusCard.test.tsx:246-272` stay green without edits.

## The point everything turns on (Part 2)

The clip check: "no element hides content behind an overflow box". Its exceptions decide
whether it proves anything.
1. **Too loose.** If `overflow-hidden` decorative wrappers (cards, tracks) are excluded, a
   clipped status filter would pass. The rule must exclude only form controls, ellipsis text,
   `sr-only` and `CodeBlock` `pre`. A negative control in the same test must go red: it injects
   into the page a hidden-scrollbar row (`overflow-x:auto; scrollbar-width:none`, as the old
   Sites filter was) that is wider than its box, and asserts the check reports it. The control
   then removes the row. This proves the check bites without depending on s66c's page.
2. **Too tight.** Sub-pixel layout can make `scrollWidth` exceed `clientWidth` by 1 on
   fractional widths, hence the 1 px tolerance. Check Billing's progress tracks and the
   Analytics chart cards at 768.
3. **Guard flip timing.** Flipping the radius guard to zero tolerance before s66c's entries are
   gone would turn s66c's branch red on rebase. Task 6 flips only on `{}`.

## Files touched (Part 2)

- The 28 s66b2-owned baseline files (table above);
- `src/components/ui/metric.tsx`;
- `src/app/dashboard/loading.tsx`;
- `e2e/app-layout.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`;
- `src/__tests__/design/{page-shell-guard.test.ts, radius-baseline.json}`, and
  `radius-guard.test.ts` if it flips;
- `docs/designs/s66b-app-page-layout/after/*`;
- `docs/design-system.md`, `docs/stories.md`.

## Test strategy (Part 2)

- **Source guards** (R5, R6, radius) for what can be read from the source.
- **The harness** for what only layout shows: clipping, rest and hover shadows, the grid
  filling its width, tabs inside their list, standalone h1s.
- **Existing RTL suites unchanged**, as the behaviour proof.

## Definition of Done (Part 2)

- The repo DoD.
- Both harness families green at four widths; the captures committed.
- Radius baseline: zero s66b entries. If s66c merged first, the guard is zero-tolerance.
- Weight and flat rules: pending holds only s66c files.

## Tests that change (both parts)

| Test | Part | Change | Why |
|---|---|---|---|
| `src/__tests__/design/radius-baseline.json` | 1, 2 | 31 s66b entries deleted (3 in Part 1, plus any lowered by rewritten lines) | ADR 050: s66b empties its share |
| `src/__tests__/design/radius-guard.test.ts` | 2 (conditional) | baseline machinery removed; zero tolerance | only if the baseline is `{}` |
| `src/__tests__/design/globals-css.test.ts` | 1 | one new `it` (`.text-page-title`); existing pins untouched | AC 1 |
| `e2e/app-layout.spec.ts` | 1, 2 | capture root parameterised; two new describes (8 tests) | AC 2–5 / AC 2, 4, 5 |
| `playwright.config.ts`, `.github/workflows/ci.yml` | 1, 2 | expected count +4 each | strict contract |

**Checked, and they do not change:**
- `Breadcrumbs.test.tsx:113` (last crumb `font-medium text-foreground`);
- `DashboardNavigation.test.tsx` (labels, hrefs, gating);
- `BillingDashboard.{trial,plan-change,plan-card}.test.tsx` (headings by role and name, no
  level);
- `billing/__tests__/page.test.tsx`;
- `content-load-states.test.tsx`, `content-partial-failure.test.tsx`;
- `page.activation.test.tsx`;
- `TrialStatusCard.test.tsx` (button variants);
- `TrialStatusBadge.test.tsx` (tone classes);
- `UserMenu.test.tsx` (fallback classes kept);
- `LoginForm`, `SignupForm` and `EditorSignIn` tests.

No test pins "Analytics Dashboard" (grep across `src` and `e2e`).
