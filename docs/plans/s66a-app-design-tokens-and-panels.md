---
validated: yes
---
# Plan — Story s66a-app-design-tokens-and-panels

> Owner decision (2026-10-08, card titles): "Accept 16px everywhere" — CardTitle is 16 px on app and
> marketing surfaces (404, error page, blog index); the AuthModal title follows the same dialog-title rule.

Branch: `feature/s66a-app-design-tokens-and-panels`. It was renamed from
`feature/s66-app-design-system` and already carries the s66 stories and research commits.
Worktree: `.omx/worktrees/s66-app-design-system`; every gate runs there, never at the repo root.

Read these first; this plan does not repeat them:
- Research: `docs/research/s66-app-design-system.md` (commit `b534b23`). It covers s66a, s66c and
  s66b. For this story read facts 1, 3, 4 and 7, "Shared primitives", "Proposed design spec" and
  "Traps and constraints".
- Design: `docs/designs/s66a-app-design-tokens-and-panels.md` and its `.html` (a reference, not
  code).
- System: `docs/design-system.md` (s66a revision).
- Decisions: ADR 050 (radius tokens) and ADR 051 (native selects).

## Target story

`docs/stories.md` → s66a. The deliverables:
- App primitives become square and flat: containers 0, controls 2 px, hairline borders that
  render their authored colour, opaque menus.
- The two global CSS bugs are fixed: the unlayered border reset, and the missing popover token.
- The dialog's `min-width: auto` grid bug is fixed at its root for all 12 call sites.
- The site-registered panel and the Share preview link dialog are redesigned and proved free of
  overflow at 320, 375, 768, 1280 and 1920 px by a new authenticated Playwright harness.
- A radius guard with a shrink-only baseline is added.

The acceptance criteria are AC 1–10 in the story.

## Tasks (ordered)

Each task starts with the failing test it names. A task ends with that test and every existing
suite green, except where a task says a guard stays red until a named later task.

1. [x] **Authenticated layout harness (RED on today's code).**
   - **Files.** New `e2e/app-layout.spec.ts`, plus `e2e/support/owner-session.ts` for the seeding
     and sign-in helpers.
   - **Gating.** Gate on `createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E")`, as
     `share-edit-publish.spec.ts` does, with `test.describe.configure({ mode: "serial" })`.
   - **Seed.**
     - An owner: `auth.admin.createUser({ email: "e2e-layout-<uuid>@example.com",
       email_confirm: true })`.
     - One site row: domain `e2e-layout-<uuid>.invalid`, a fake `api_key`, same shape as
       `seedSite()` at `e2e/share-edit-publish.spec.ts:344-357`.
     - Its `site_permissions` admin row, and a `plan_entitlements` pro row with `source: "e2e"`.
     - Cleanup is exact: `deleteCapturedSiteFixture` plus `auth.admin.deleteUser`.
   - **Sign-in, through the real path.** Call `auth.admin.generateLink({ type: "magiclink",
     email })`, then go to
     `/auth/confirm?token_hash=<properties.hashed_token>&type=magiclink&next=/dashboard/sites`
     (`magiclink` is in `ALLOWED_OTP_TYPES`, `src/app/auth/confirm/route.ts:30-36`). Assert the
     page lands on `/dashboard/sites`. No new auth code.
   - **Fixtures, by `page.route`, so no real token can reach a screenshot.**
     - `POST /api/sites/register` returns a fixed body. Its `embedScript` comes from
       `buildEmbedScript({ siteId: "00000000-0000-4000-8000-000000000000", siteToken:
       "•".repeat(160), appUrl: "https://www.recopyfa.st", wsUrl: "wss://recopyfast-ws.fly.dev"
       })`. That string is about the length of a real snippet, so it reproduces the owner's
       overflow.
     - `GET /api/staging/access?siteId=…` returns two links: a 60-character label with an
       unverified email, and an expired link.
   - **Shared `measureDialog(page)` helper**, which returns:
     - page overflow (`documentElement.scrollWidth - clientWidth`);
     - dialog `scrollWidth - clientWidth`;
     - visible descendants whose right edge passes the dialog's;
     - the number of elements in the dialog whose computed `overflow-y` is `auto` or `scroll`;
     - the title's offset from the dialog's top;
     - whether the CodeBlock Copy button is fully inside the dialog;
     - the NativeSelect chevron inset (select right edge minus chevron right edge).
   - **Tests (11).**
     - `site-registered panel @<w>` for w ∈ {320, 375, 768, 1280, 1920}. Open Add site, assert
       the form state has one scroll container, register (routed), then assert AC 1.
     - `share preview link @<w>`, same widths. Open the card's share button
       (`title="Share preview link"`, `ShareButton.tsx:30`), then assert AC 2.
     - `app CSS: borders, popover, contrast, focus` at 1280 (AC 4 and AC 7). Run it in dark, then
       again after `document.documentElement.dataset.theme = "light"`:
       - an Input's computed border colour equals `--line-strong`, with contrast ≥ 3:1 against
         `--surface-card`;
       - the Sites sort menu (`sites/page.tsx:416`) has a non-transparent background;
       - dialog body and muted text contrast ≥ 4.5:1;
       - keyboard-focused Button, Input, NativeSelect and tab trigger show a 2 px outline or
         ring, with radius ≤ 2 px.
   - **Screenshots.** With `RCF_LAYOUT_SCREENSHOTS=1`, the panel tests write JPEGs (quality 80,
     each under 400 KB) to `docs/designs/s66a-app-design-tokens-and-panels/after/<panel>-<w>.jpg`.
     The CSS test also writes `/dashboard`, `/dashboard/sites`, `/dashboard/settings` and
     `/dashboard/billing` at 1280. Without the variable nothing is written.
   - **Contract.** In the same change, raise the contract from 45 to **56** in
     `playwright.config.ts:14` and in the not-run summary at `.github/workflows/ci.yml:215`.
   - **RED evidence.** Run the spec on unchanged code and keep its failure summary for the PR.
     The registration panel overflows at every width; the share dialog at 320 and 375; the
     border colour, popover, radius and chevron checks fail.
   - **Before captures.** In the same run, capture the "before" set into
     `docs/designs/s66a-app-design-tokens-and-panels/before/`:
     - the four dashboard pages above, via the variable;
     - the marketing pages that import `ui/*`: `/` (Header), `/docs/install`, one `/blog/<slug>`,
       a 404, and `/try`, at 1280 and 375, with `npx playwright screenshot` or a throwaway script
       in the scratchpad. Use no new spec, so the contract stays 56; cap each at 4,400 CSS px tall.
2. [x] **Design guards (RED).**
   - **Shared helper**, `src/__tests__/design/app-surface.ts`:
     - **Scanned roots:** `src/app/{dashboard,settings,login,signup,auth,edit}` and
       `src/components/{ui,dashboard,auth,settings,billing,shared}`, excluding `__tests__`.
     - **Explicit unreachable exclusions**, each with a comment pointing to the dead-code chore:
       `src/app/dashboard/_ab-tests/**`, `src/components/dashboard/ab-*` and `ab-create/**`,
       `SecurityDashboard.tsx`, `TranslationDashboard.tsx`, `SiteSelectorBar.tsx`.
     - **A check** that fails if an excluded file gains an importer from a scanned file.
   - **`radius-guard.test.ts`**:
     - **Tokens.** Parses `src/app/globals.css` and requires `--radius-control` ≤ 2 px and
       `--radius-container` = 0. Both are absent today, so this is red.
     - **Scan.** Fails, printing `file:line`, on:
       - bare `rounded`;
       - `rounded(-[trbl]{1,2}|-[se]{1,2})?-(xs|sm|md|lg|xl|2xl|3xl|4xl)`;
       - `rounded-[<n>]` with n > 2 px;
       - `rounded-full`, unless the same class string carries `animate-spin` or `animate-ping`
         (a spinner, or the pulse ring of a status dot: `badge.tsx:93`), or a height and width
         ≤ 8 px (`h-1`/`h-1.5`/`h-2` with `w-1`/`w-1.5`/`w-2`), or the file is
         `ui/avatar.tsx`;
       - `borderRadius` / `border-radius` in TSX.
     - **Baseline.** `src/__tests__/design/radius-baseline.json` maps file to count. Generate it
       once with `RCF_WRITE_RADIUS_BASELINE=1`, then delete every entry under
       `src/components/ui/` and for `SiteRegistrationModal.tsx`, `ShareSiteDialog.tsx` and
       `ShareLinkCard.tsx`, which must be zero. The test also fails when a file's real count
       drops below its baseline entry, with a message to lower it: a ratchet, like the coverage
       floor.
     - **Self-tests.** Fixture strings prove each rule both fires and stays quiet.
   - **`dialog-structure.test.ts`.** Every scanned file that renders `<DialogContent` also
     renders `<DialogBody`. The `className` passed to `DialogContent` contains none of
     `overflow-`, `max-h-`, `rounded-`, `p-`/`px-`/`py-`, `grid`, `gap-`; only `max-w-*` / `w-*`
     are allowed.
   - **`native-select-guard.test.ts`.** No `<select` in a scanned file except
     `ui/native-select.tsx`.
   - **When they go green.** The radius-guard tokens in task 3; the radius scan (ui/** and the
     two panels at zero) in tasks 4, 5 and 6 and fully at task 9; dialog-structure in task 6;
     native-select in task 5. Commit nothing until the suite is green (one story commit, AGENTS.md).
3. [x] **Tokens and global CSS.**
   - **Tests first.**
     - `src/__tests__/design/globals-css.test.ts`, by plain text parsing:
       - no unlayered `*` rule sets `border-color`;
       - the reset `*, ::after, ::before, ::backdrop, ::file-selector-button { border-color:
         var(--line) }` sits inside `@layer base`;
       - `@theme inline` defines `--color-popover: var(--surface-card)`,
         `--color-popover-foreground: var(--text-strong)`, `--radius-control: 2px` and
         `--radius-container: 0px`;
       - `.skeleton` uses `var(--radius-container)`;
       - `--radius`, `--radius-xs…2xl`, `.surface-interactive` and `.text-display` are
         byte-identical to `main`.
     - `src/lib/utils/__tests__/cn.test.ts`:
       - `cn("rounded-container", "rounded-2xl") === "rounded-2xl"`;
       - `cn("rounded-lg", "rounded-control") === "rounded-control"`;
       - `cn("rounded-control", "rounded-none") === "rounded-none"`.
   - **Implement.**
     - `globals.css`: the three token additions and the layer move. Rewrite the
       `globals.css:219-226` comment as a tombstone: the unlayered reset beat every
       `border-*` utility, so inputs drew at 1.45:1. Delete the `[data-demo-surface]`
       `revert-layer` opt-out, now redundant; task 10's before/after captures of `/` are the
       proof the demo is unchanged.
     - `src/lib/utils/cn.ts`: `extendTailwindMerge({ extend: { theme: { radius: ["control",
       "container"] } } })`. Confirm the v3 option name against the tailwind-merge docs
       (Context7) before coding.
4. [x] **Square, flat primitives.**
   - **Tests first (RED), existing tests edited and named in the PR:**
     - `card.test.tsx:39,55`: `rounded-xl` becomes `rounded-container`.
     - `card.test.tsx:43`: `shadow-sm` becomes "no `shadow-` class".
     - `card.test.tsx:156,169`: `text-xl` becomes `text-base`.
     - `badge.test.tsx:46`: `rounded-full` becomes `rounded-control`.
   - **New assertions:**
     - `button.test.tsx`: every size carries `rounded-control`; no variant carries `shadow-`.
     - New `textarea.test.tsx`, `tabs.test.tsx`, `alert.test.tsx`, `icon-tile.test.tsx`:
       radius class; for tabs, list `border-b` and `flex-wrap`, with no `overflow-x-auto` or
       hidden-scrollbar classes.
   - **Implement:**
     - `button.tsx`: `rounded-control` at every size; drop `shadow-xs` and `hover:shadow-sm`.
     - `input.tsx`: `rounded-control`.
     - New `ui/textarea.tsx`: Input's classes, `min-h-20 py-2 resize-y`.
     - `card.tsx`: `rounded-container`. `default` and `interactive` lose their shadows;
       `interactive` loses `hover:-translate-y-px`; `elevated` keeps `shadow-md`. `CardTitle`
       becomes `text-base font-semibold leading-6`. Rewrite the `card.tsx:7-15` comment and
       cite ADR 050.
     - `badge.tsx`: `rounded-control`; the dot stays round.
     - `alert.tsx`, `icon-tile.tsx`, `metric.tsx`, `empty-state.tsx`, `content-value.tsx`,
       `skeleton.tsx`: `rounded-container`. Radius only; Metric's `.surface-interactive` is
       s66b.
     - `tabs.tsx`: underline per the design system.
   - **Must pass unchanged:** the suites that render Tabs (`LoginForm.test.tsx`, settings,
     `SiteInstallationCard.test.tsx`), because roles and names are unchanged.
5. [x] **Selects and menus.**
   - **Tests first:**
     - New `native-select.test.tsx`:
       - `<Label htmlFor>` resolves to the `<select>`;
       - `userEvent.selectOptions` works;
       - `ref` and `aria-*` forward;
       - the select carries `appearance-none` and `pr-9`;
       - the chevron is `aria-hidden`, `pointer-events-none`, `right-3`.
     - `select.test.tsx` gains: trigger `bg-card rounded-control`; content `bg-popover
       rounded-container`.
     - New `dropdown-menu.test.tsx`: content `bg-popover rounded-container shadow-md`; items
       `rounded-control`.
   - **Implement** `ui/native-select.tsx` (ADR 051), and align `select.tsx` and
     `dropdown-menu.tsx`.
   - **Adopt** NativeSelect at the 8 reachable call sites: `ContentFilterBar.tsx:68,88`,
     `BulkOperations.tsx:494,608,805`, `AnalyticsDashboard.tsx:211`, `ShareSiteDialog.tsx:279`
     and `ApiKeysPanel.tsx:167`. Re-grep first. `native-select-guard` goes green.
   - **Must pass unchanged:** `BulkOperations.test.tsx` (`selectOptions` at `:301`),
     `ShareSiteDialog.test.tsx` and `WebhooksPanel.test.tsx`.
6. [x] **Dialog root cause, all 12 call sites.**
   - **Tests first:** `dialog.test.tsx` gains:
     - `DialogContent` has `flex flex-col overflow-hidden` and no `overflow-y-auto` or `grid`;
     - `DialogBody` is exported and carries `overflow-y-auto min-h-0 flex-1` and `[&>*]:min-w-0`;
     - `DialogHeader` has no `text-center`;
     - `DialogTitle` is `text-base`;
     - `DialogFooter` has `border-t`.
   - **Implement `dialog.tsx`:**
     - Frame: `rounded-container border bg-card shadow-md`, `w-[calc(100%-2rem)] max-w-lg
       max-h-[90dvh]`, centred from `sm` up.
     - Below `sm` it becomes a bottom sheet: `inset-x-0 bottom-0 w-full max-h-[92dvh]
       border-x-0 border-b-0`, `px-4` paddings, footer `flex-col-reverse` with full-width
       children.
     - Header `px-6 pt-5 pb-4 pr-12 text-left`; body `px-6 pb-5`; footer `px-6 py-3`.
     - The close X is `rounded-control`, and `showClose` is kept.
     - The house comment names the 2,524 px incident.
   - **Migrate** every reachable call site to header/body/footer and drop its layout overrides:
     `sites/page.tsx` ×2, `AuthModal`, `WebhooksPanel`, `SiteRegistrationModal`,
     `SiteEditorsCard`, `ActivationChecklist`, `VersionPreviewDialog`, `ShareSiteDialog`,
     `SiteDetailView`, `PurchaseCreditsDialog`, `UpgradeDialog`. A `<form>` that spans body and
     footer gets `flex min-h-0 flex-1 flex-col` (design system § Dialogs). `TeamSelector` is dead
     code outside the scanned roots; leave it.
   - **`VersionHistoryPanel`**: overlay `bg-black/40` becomes `bg-foreground/40`, `shadow-2xl`
     becomes `shadow-md`, and it gains `border-l`. No structural change (gap 12).
   - **Green:** `dialog-structure` goes green. Every listed dialog's suite passes unchanged
     (`AuthModal.test.tsx`, `WebhooksPanel.test.tsx`, `SiteEditorsCard.test.tsx`,
     `ActivationChecklist.test.tsx`, `UpgradeDialog.agency.test.tsx`,
     `SiteDetailView.test.tsx`, `sites/__tests__/page.test.tsx`,
     `SiteRegistrationModal.test.tsx` and `ShareSiteDialog.test.tsx` as they stand before tasks
     8 and 9).
7. [x] **CodeBlock primitive.**
   - **Tests first:** new `code-block.test.tsx`:
     - it renders `value`;
     - by default the `<pre>` has `whitespace-pre-wrap` and `[overflow-wrap:anywhere]`;
       `wrap={false}` gives `whitespace-pre overflow-x-auto`;
     - the Copy button is in the label bar with no `opacity-0` or `group-hover` classes;
     - a click calls `clipboard.writeText` with exactly `value`;
     - with fake timers, "Copied" shows for 2,000 ms and then "Copy";
     - a rejected write shows "Copy failed", never "Copied", and selects the `<pre>` contents.
   - **Implement** `ui/code-block.tsx` with props `value`, `label`, `wrap = true`; root `min-w-0`.
8. [x] **Site-registered panel.**
   - **Tests first (RED), edits named in the PR:** in `SiteRegistrationModal.test.tsx`:
     - `/Site Registered Successfully!/i` (×9) becomes `/Site registered/i`;
     - `/^Copied!$/` (×2) becomes `/^Copied$/`;
     - the "Integration Instructions" and "Step 1/2/3: …" headings (`:367-378`) and
       `findByText(/Step 3/i)` (`:399`) become the new step headings;
     - the test "should call onSuccess when Go to Site Dashboard is clicked" (`:639-690`) is
       **removed**. The button is gone, and its two assertions (`onSuccess` and `onClose`
       called) remain covered by the F-11 test and the Close test.
   - **New assertions:**
     - the header has no `text-center`;
     - `Test Site`, `example.com` and `test-site-123` are each their own text node;
     - Copy writes exactly `embedScript`;
     - the recipe tabs list WordPress, Next.js and Plain HTML from `installRecipes`;
     - "Installation guide" is `href="/docs/install"`, `target="_blank"`,
       `rel="noopener noreferrer"`;
     - no button named "Go to Site Dashboard".
   - **Implement** per `docs/designs/s66a-…md` § 1. The form-state copy and behaviour are
     unchanged.
   - **Green:** the harness's 5 registration tests go green.
9. [x] **Share preview link dialog.**
   - **Tests first:**
     - `ShareSiteDialog.test.tsx` keeps every existing assertion and gains:
       - the title "Share preview link" and the button "Create link";
       - no `border-2` on the permission toggles;
       - a selected toggle has `border-primary`;
       - feedback renders through `Alert`.
     - New `ShareLinkCard.test.tsx`:
       - the label has `truncate`, inside a `min-w-0` column;
       - the meta and permission rows have `flex-wrap`;
       - the icon container is square (no `rounded-full`);
       - Copy and Revoke keep their `aria-label`s.
   - **Implement** per the design § 2. The default permissions stay `["view","edit"]` (s66c
     changes them).
   - **Green:** the harness's 5 share tests go green, and the radius baseline holds zero for
     ui/** and both panels.
10. [x] **Evidence and gates.**
    - **Captures.** Run the harness with `RCF_LAYOUT_SCREENSHOTS=1` to write `after/`. Capture
      the marketing "after" set the same way as in task 1. Compare before with after, and
      record in the PR anything that changed beyond the accepted side effect. Squared
      primitives, and authored border colours now showing, are the accepted effects; anything
      else is a finding to fix or to escalate.
    - **Ratchet.** Lower the baseline counts to the real counts.
    - **Docs.** If a value was refined with evidence, `docs/design-system.md` matches the code.
      Tick this plan's checkboxes.
    - **Gates.** `npm run precommit` and `npm run prepush` pass in this worktree,
      `npm run test:e2e` (the 56 contract) passes on the local stack, and
      `npm run build:embed -- --check` is clean.

## Run interdicts

- `git diff main...HEAD -- public/embed server supabase src/app/api` is empty.
- The `package.json`, `package-lock.json` and `server/package*.json` diffs are empty.
  tailwind-merge, Radix and lucide are already dependencies.
- No edits under `src/app/{page.tsx,compare,docs,blog,try,privacy,terms,demo}` or
  `src/components/{landing,sections,layout,try,blog,compare,docs,demo,three}`. Marketing changes
  only through `ui/*` and `globals.css`. (`AuthModal` lives in `src/components/auth` and is
  migrated in task 6.)
- In `globals.css`, `--radius`, `--radius-xs…2xl`, `.surface-interactive`, `.text-display` and
  `.text-title` are unchanged; `globals-css.test.ts` asserts it.
- `src/app/dashboard/layout.tsx`, `ui/page-header.tsx` and `DashboardNavigation.tsx` diffs are
  empty (s66b).
- No route or label change outside the two panels. In particular "View Details", "Settings",
  "Back to Sites", "Invite a client", "Delete Site" and "Edit Website" stay (s66c).
- The ShareSiteDialog default permissions stay `["view","edit"]` (s66c).
- Existing tests:
  - only the edits listed in tasks 4 and 8 change an existing assertion;
  - one existing test is removed: "should call onSuccess when Go to Site Dashboard is clicked";
  - any other change to an existing test file only adds assertions.
  `git diff main...HEAD -- '*.test.ts*'` must read that way.
- No `--no-verify`. No push, merge or deploy. No writes outside this worktree. No production
  data. No real token or email in any committed capture or fixture.
- No new Context, and no `framer-motion` on the dashboard.

## The point everything turns on

Two moves carry the story, and both are global:
- the radius scale becomes two semantic tokens applied per primitive (ADR 050), and the border
  reset moves into `@layer base`;
- `DialogContent` stops being a padded, scrolling grid and becomes a frame whose only scroll
  region is `DialogBody`.

Where this could be wrong, and what to compare it against:
1. **tailwind-merge does not know the new names.** Without the extension,
   `cn("rounded-container", "rounded-2xl")` ships both classes and CSS source order picks the
   winner, so call-site overrides can silently lose. Compare against: the `cn` tests (task 3),
   and a grep for `rounded-` passed into `ui/*` components at call sites. After task 6 none
   should be passed to `DialogContent`.
2. **The layer move repaints more than controls.** About 138 authored `border-*` colours across
   39 files start to apply, on app and marketing pages alike: `border-transparent` on ghost
   cards, `border-white/*` on marketing, tone borders. Compare against: the before/after
   captures (tasks 1 and 10) of the four dashboard pages and the five marketing pages. Also
   compare the computed colour of a plain `border` div: it must still be `--line`, not
   `currentColor`, which would mean Tailwind's preflight won the base layer.
3. **A dialog body that is not a direct flex child.** A call site that wraps body and footer in a
   `<form>`, or another element, without `flex min-h-0 flex-1 flex-col`, loses the scroll region
   and overflows the frame. The source scan only checks that `DialogBody` exists. Compare
   against: the harness's single-scroll assertion on the registration form state (it has a
   `<form>`), and a manual pass of each migrated dialog at 375 in `npm run dev`. Note the
   dialogs whose suites render no layout (`PurchaseCreditsDialog`, `VersionPreviewDialog`) in
   the PR.

## Files touched

- **New:**
  - `src/components/ui/{native-select,textarea,code-block}.tsx` and their tests;
  - `src/components/ui/__tests__/{tabs,alert,icon-tile,dropdown-menu}.test.tsx`;
  - `src/components/dashboard/__tests__/ShareLinkCard.test.tsx`;
  - `src/__tests__/design/{app-surface.ts,radius-guard.test.ts,radius-baseline.json,dialog-structure.test.ts,native-select-guard.test.ts,globals-css.test.ts}`;
  - `src/lib/utils/__tests__/cn.test.ts`;
  - `e2e/app-layout.spec.ts`, `e2e/support/owner-session.ts`;
  - captures under `docs/designs/s66a-app-design-tokens-and-panels/{before,after}/`.
- **Modified:**
  - `src/app/globals.css`, `src/lib/utils/cn.ts`;
  - `src/components/ui/{button,input,card,badge,alert,tabs,select,dropdown-menu,dialog,icon-tile,metric,empty-state,content-value,skeleton}.tsx`;
  - the 12 dialog call sites (task 6);
  - the 5 native-select files (task 5);
  - `SiteRegistrationModal.tsx`, `ShareSiteDialog.tsx`, `ShareLinkCard.tsx`,
    `VersionHistoryPanel.tsx`;
  - `card.test.tsx`, `badge.test.tsx`, `button.test.tsx`, `select.test.tsx`,
    `dialog.test.tsx`, `SiteRegistrationModal.test.tsx`, `ShareSiteDialog.test.tsx`;
  - `playwright.config.ts`, `.github/workflows/ci.yml`;
  - this plan, and `docs/design-system.md` (only if a value is refined).

## Test strategy

The layers:
- **Source scans** (radius, dialog structure, native selects) are the cheap, permanent guards.
- **CSS text tests** pin the layer move and the tokens.
- **RTL tests** cover each primitive's contract: classes that carry the spec, accessible names,
  the copy behaviour including failure.
- **Component suites** for the two panels.
- **One authenticated Playwright spec** proves what jsdom cannot: real layout at five widths,
  computed colours, contrast, focus geometry.

The harness is written first and run red on today's code, so its green at the end means
something. Green unit tests never stand in for AC 1, 2, 4 or 7.

Not covered, by design: the OS-drawn open state of a native select (gap 13), and pages other
than the two panels and the four captured dashboard pages (s66b).

## Definition of Done

The repo DoD applies: a single PR; lint, type-check, format, build and test green; review
passed; deployed. In addition:
- **AC evidence.** Every s66a AC is checked off with its evidence in the PR: the harness's
  red-then-green summary; the after captures; marketing and dashboard before/after; the list of
  edited tests with their reasons.
- **Contract.** The Playwright contract is 56 in both places.
- **Baseline.** The radius baseline holds zero entries for `src/components/ui/**` and the three
  panel files.
- **Untouched.** `public/embed/` is unchanged and embed allocation is 0 bytes.
- **Decisions.** ADR 050 and ADR 051 are merged. They are numbered after 047 and 048 on
  `feature/s68-security-hardening`; renumber at merge if another ADR lands first.
