# Research — Story s66-app-design-system

## The nine structuring facts

1. **The owner's panel is the success state of `SiteRegistrationModal`**: "Site Details" plus
   "Integration Instructions", at `src/components/dashboard/SiteRegistrationModal.tsx:284-445`.
   All four defects in the screenshot come from one cause. `DialogContent` is `display: grid`
   with an implicit `auto` column (`src/components/ui/dialog.tsx:52`). Grid items keep
   `min-width: auto`, so the unwrapped 300-character `<pre>` snippet (`:332`) sets the column
   width.
   - I measured this with the production CSS, using a DOM-only replica inside the real dialog:
     the grid column is **2,524 px** inside a 588 px panel, and the panel `scrollWidth` is
     **2,572** at every width from 320 to 1920. That is the panel-level horizontal scrollbar.
   - The success header is centred (`mx-auto` plus `text-center`, `:286-295`) within that
     2,524 px track, which puts it off-screen. That is the **"tall empty band"**.
   - The Copy button (`absolute right-2`, `:335-339`) sits at the right edge of the 2,524 px
     block, so it cannot be seen either.
   - The same mechanism affects all **12 `DialogContent` call sites**. The Share Preview Link
     dialog overflows at 375 (`scrollWidth` 370 against a `clientWidth` of 331), driven by
     `ShareLinkCard.tsx:69-70`.
2. **"View Details" does not open that panel.** It replaces the Sites page with
   `SiteDetailView` in component state (`src/app/dashboard/sites/page.tsx:303-319`), so it has
   no URL. The view is 11 stacked cards: about **4,400 px tall at 1280** and **6,500 px at
   375**. The install snippet appears three times (checklist button, Embed Script card,
   Installation card), plus the raw site token.
3. **Radius.** `--radius: 0.75rem` (`src/app/globals.css:96`) drives a scale that measures live
   as follows:

   | Class | Live value |
   |---|---|
   | bare `rounded` | 4px |
   | `rounded-sm` | 6px |
   | `rounded-md` | 9px |
   | `rounded-lg` | 12px |
   | `rounded-xl` | 16px |
   | `rounded-2xl` | 22px |

   **196 `rounded*` occurrences across 67 reachable in-scope files**, plus 27 in 10 unreachable
   files. By class:

   | Class | Count |
   |---|---|
   | `rounded-lg` | 66 |
   | `rounded-md` | 41 |
   | `rounded-full` | 38 |
   | `rounded-xl` | 18 |
   | bare `rounded` | 18 |
   | `rounded-sm` | 11 |
   | `rounded-2xl` | 2 |
   | other | 2 |

   Every primitive is rounded. Card is 16px with a shadow, Dialog 16–22px, Badge is a pill,
   Button and Input are 9px.
4. **Two global CSS defects** make the app less crisp than its own tokens intend.
   - (a) The unlayered `* { border-color: var(--line) }` (`globals.css:215-216`) overrides every
     `border-*` colour utility. Measured live: `border-input`, `border-primary` and
     `border-tone-success-border` all compute to `--line`. Control boundaries therefore render
     at **1.45:1 (dark) and 1.34:1 (light)** against the card, which fails the 3:1 that
     `input.tsx:6-11` claims to meet.
   - (b) `bg-popover` and `text-popover-foreground` have no theme token. Every dropdown menu and
     Select popover is therefore **transparent** (measured `rgba(0,0,0,0)`; see
     `sort-menu-1280.jpg`, where the menu text overprints the site cards).
5. **One shell exists, but pages do not share a header.** The shell is
   `src/app/dashboard/layout.tsx:130-200`: a 256 px sidebar, a 64 px sticky header, and
   `max-w-[1180px] px-4 sm:px-6 lg:px-8`. Pages title themselves four different ways:

   | Pages | Title |
   |---|---|
   | Overview, Sites, Billing (`PageHeader` / `.text-display`) | h1, 32/600 |
   | Content, Settings (local markup) | h1, 30/700 |
   | Analytics | **h2**, 24/700, **no h1** |
   | Site detail | **h3**, 24/600, inset inside a card, **no h1** |

   Billing also nests `container mx-auto px-4 py-8` inside the shell
   (`BillingDashboard.tsx:252`), so its title sits **16 px to the right** of every other page.
6. **Responsive.** There is page-level horizontal scroll in one place: Analytics at 1280, by
   3 px (filter row, `AnalyticsDashboard.tsx:194-215`). More often, content is **clipped behind
   hidden scrollbars**:
   - at 375 on Sites: the status filter cuts "Stale" (395 px content in 341 px);
   - at 375 on Settings: 2 of 5 tabs are off-screen (610 in 341, `tabs.tsx:16-20`);
   - the Share dialog and the registration panel (fact 1).

   At 375 the site-detail title is squeezed into a column about 110 px wide
   (`SiteDetailView.tsx:246` does not wrap).
7. **There are 8 native `<select>`s, styled with 5 different class strings, and none uses
   `appearance-none`.** The owner's second screenshot is `ShareSiteDialog.tsx:279-283`
   (`rounded-lg border-border px-3`), where the browser's own chevron sits about 6 px from the
   border. Only `WebhooksPanel` uses `ui/select`. `BulkOperations.test.tsx:301` relies on the
   native `selectOptions`, so the fix is a styled native select, not a move to Radix.
8. **Supabase is not square.** Since 2026-09-23 its `radius-md` is 8px, its cards use
   `rounded-lg` (about 10.7px), and its badges are pills. What reads as "straight and clean"
   there is:
   - 1px low-contrast borders;
   - flat surfaces 1–3 % apart in lightness;
   - dividers;
   - dense controls and underline tabs;
   - a 1200 px container;
   - a side panel with a single scroll region.

   The owner's 0–2 px rule (AC 2) is stricter than Supabase. This doc follows the owner on
   radius and Supabase on everything else.
9. **IA (owner addition).** There are two working access mechanisms under three labels:
   - "Editors / Add editor";
   - "Invite a client";
   - "Share / Share Preview Link".

   Their forms are field-for-field identical: email plus View/Edit/Publish/Admin. A third API
   (`/api/sites/[siteId]/share`, the `site_permissions` collaborators) has no UI at all. Labels
   collide: the card's "Settings" button starts an edit session, and "History" names two
   different logs. Renaming a site or changing its domain is **impossible**:
   `src/app/api/sites/[siteId]/route.ts` exports only `DELETE`. Delete sits behind a kebab menu
   that only appears on hover (`SiteCard.tsx:107`).

## Target story

The story is `s66-app-design-system` in `docs/stories.md`. It asks for:
- one flat, straight-edged layout system (1px borders, 0–2 px radius, one spacing scale, one
  page shell);
- a site-registration panel with no overflow from 320 to 1920;
- a radius guard;
- Playwright proof at 375, 768, 1280 and 1920;
- no behaviour change, with the unit suite and existing e2e passing unchanged;
- WCAG AA contrast and squared focus outlines.

Marketing and the embed are out of scope. On 2026-10-07 the owner added an
information-architecture review to the research step; it is covered in §Information
architecture below.

## Inventory

### In-scope routes

| Route | File | Composition | Notes |
|---|---|---|---|
| `/dashboard` | `src/app/dashboard/page.tsx` (394 lines) | `PageHeader`; one celebration card per site; one `ActivationChecklist` **per incomplete site**; `Metric` grid; "Your sites" list; `SiteRegistrationModal` | Metric grid `lg:grid-cols-3` with `lg:row-span-3` (`:220,:235`) leaves the **right third empty** at ≥1024 |
| `/dashboard/sites` | `src/app/dashboard/sites/page.tsx` (639) | `PageHeader`, status filter, search, sort `DropdownMenu`, `SiteCard` grid; dialogs: Register, Delete, Edit Website | |
| site detail (state, no URL) | `src/components/dashboard/SiteDetailView.tsx` (552) | 11 `Card`s (listed under fact 2, and in §IA) | Opened via `selectedSiteId` |
| `/dashboard/content` | `src/app/dashboard/content/page.tsx` (477) | Local `PageHeader` (`:56-66`), `ContentFilterBar` inside its own card, `ContentElementCard` × 10 per page | Each element is a 3-band card; 10 rows take about 2,800 px |
| `/dashboard/analytics` | `analytics/page.tsx` → `AnalyticsDashboard.tsx` | h2 title, native select and date inputs, metric cards with blue/green/yellow icons | Off-palette icon hues; page overflow at 1280 |
| `/dashboard/settings` | `src/app/dashboard/settings/page.tsx` (396) | 5 `Tabs`: Profile, Notifications, Security, API Keys, Appearance | Tabs clipped at 375 |
| `/dashboard/billing` | `billing/page.tsx` → `src/components/billing/BillingDashboard.tsx` | Double container, emoji icons in Usage, `UpgradeDialog` (`max-w-4xl`) | |
| `/dashboard/teams` | `teams/page.tsx` | Redirects to `/dashboard/sites?notice=teams-moved` | |
| `/dashboard/_ab-tests` | `_ab-tests/page.tsx` | Not routed (Next private folder); every `ab-*` component is unreachable | Excluded |
| `/settings` | `src/app/settings/page.tsx` | Redirects to `/dashboard/settings` | |
| `/login`, `/signup` | `src/app/login/page.tsx`, `src/app/signup/page.tsx` | `Card` + `Tabs` + `LoginForm` / `SignupForm` | Redirect to `/dashboard` when signed in |
| `/auth/error` | `src/app/auth/error/page.tsx` | `Card` with a circular icon | |
| `/edit` | `src/app/edit/EditorSignIn.tsx` (502) | Invited-editor hub: sign-in, then a site picker | |
| `/try` | `src/app/try/page.tsx` + `components/try/TryExperience.tsx` | **Marketing** `Header`/`Footer`, hardcoded `slate-*`/`bg-white` (`:39,:71`) | Treat as Marketing, see Q3 |

Dead code (no importer):
- `SecurityDashboard`
- `TranslationDashboard`
- `src/components/collaboration/*`
- `src/components/editor/*`

### Shared primitives

Radius values below are measured live. "App files" counts reachable in-scope importers.
Marketing importers are in brackets.

| Primitive | Defined at | Radius now | Other notes | App files |
|---|---|---|---|---|
| Button | `ui/button.tsx:21,57-62` | 9px; sizes `sm` 6, `lg` 12, `xl` 16 | Heights 32/40/48/56; `shadow-xs` on the solid variants | 44 (+5) |
| Input | `ui/input.tsx:18` | 9px | `border-input` is overridden by the reset (fact 4) | 14 |
| Select (Radix) | `ui/select.tsx:32,54,82` | 9px | Content uses the undefined `bg-popover` (transparent); trigger is `bg-transparent` | 1 |
| Native select | none: 8 hand-styled copies in `ContentFilterBar:26`, `BulkOperations:500,614,814`, `AnalyticsDashboard:215`, `ShareSiteDialog:283`, `ApiKeysPanel:174` | 9–12px | Browser chevron; no `appearance-none` | 5 files |
| Textarea | none (only in the unreachable A/B code) | — | — | 0 |
| Card | `ui/card.tsx:18,24` | 16px; `default` = `shadow-sm` | `CardTitle` is `text-xl` | 27 (+4) |
| Badge / StatusBadge | `ui/badge.tsx:23`, `ui/status-badge.tsx` | pill | Leading dot `:93-95` | 13 / 11 (+2) |
| Tabs | `ui/tabs.tsx:19,35` | list 12px, trigger 9px (segmented pill) | Hidden scrollbar clips triggers | 7 |
| Dialog | `ui/dialog.tsx:52` | 16px (Register overrides to 22px) | **Grid min-width bug** (fact 1); header centred below `sm` | 11 files / 12 sites |
| Sheet | none: `VersionHistoryPanel.tsx:128,139` hand-rolls one | 0 | `bg-black/40` (off-token), `shadow-2xl` | 1 |
| DropdownMenu | `ui/dropdown-menu.tsx:50,68,86` | content 9px, items 6px | **Transparent background** | 4 |
| Table | none: `BulkOperations.tsx:1128-1130` hand-rolls one | 12px wrapper | design-system gap 8 | 1 |
| Toast | none: `EditWebsiteButton.tsx:105-123` injects a DOM toast | 8px | `#10b981` emerald (forbidden hue) | 1 |
| Sidebar | `dashboard/DashboardNavigation.tsx:156,229-235,273` | items 9px; plan box 12px | `w-64`; active item `bg-primary/12` plus a 2px bar | 1 |
| Header / breadcrumb | `dashboard/layout.tsx:134-190`, `Breadcrumbs.tsx` | — | Empty on `/dashboard` | 1 |
| PageHeader | `ui/page-header.tsx:26-41`, `SectionHeader` at `:57-80` | — | Used by only 2 pages | 2 |
| EmptyState | `ui/empty-state.tsx:44,69` | step numbers in pills | — | 5 |
| Alert | `ui/alert.tsx:6` | 12px | — | 19 (+2) |
| IconTile | `ui/icon-tile.tsx:19,35,37` | 12px (9 / 16) | — | 6 |
| Metric | `ui/metric.tsx:104` | 16px | — | 2 |
| Skeleton | `globals.css:357-367` | 9px | — | 9 |
| Avatar | `ui/avatar.tsx:15,42` | circle | Exception | 1 |
| Code block | none: 6 hand-rolled renderings (see next table) | 12px / 4px | Two wrapping strategies | — |

The six code-block renderings:

| Location | Element | Wrapping |
|---|---|---|
| `SiteRegistrationModal.tsx:332` | `<pre>` | none, scrolls sideways |
| `SiteRegistrationModal.tsx:413` | `<pre>` | none, scrolls sideways |
| `SiteDetailView.tsx:364-368` | div + `code` | `break-all` |
| `SiteDetailView.tsx:414-418` | div + `code` | `break-all` |
| `SiteInstallationCard.tsx:90-94` | div + `code` | `break-all` |
| `DomainVerification.tsx:366` | `<pre>` | none, scrolls sideways |

## Current-state audit

### Global (tokens and CSS)

- **Radius.** The scale is `calc(var(--radius) ± n)` (`globals.css:195-200`) and the skeleton
  uses `calc(var(--radius) - 3px)` (`:366`). Three utilities are **not** driven by tokens:
  - bare `rounded` is a literal 4px (measured; 18 call sites);
  - `rounded-full` is `calc(infinity*1px)` (38 sites);
  - `rounded-3xl` / `rounded-4xl` use Tailwind's own defaults.
- **Borders.** The `*` reset problem is fact 4. The file's own comment (`globals.css:219-226`)
  records that fixing it "would repaint 138 call sites across 39 files". `border-2` is used on 3
  reachable controls: `ShareSiteDialog.tsx:251`, `ThemePicker.tsx:46` and `UpgradeDialog.tsx:243`.
- **Popover token** is missing (fact 4b). Affected: the sites sort menu, the card kebab menu, the
  account menu, and the `WebhooksPanel` select.
- **Elevation.**
  - The `Card` default carries `shadow-sm`, and Button adds `shadow-xs`.
  - The sheet uses `shadow-2xl`.
  - `.surface-interactive` lifts cards with `translateY(-1px)` plus `shadow-md`.

  So static panels cast shadows, which conflicts with the flat look.
- **Typography.**
  - `.text-display` is `clamp(26px…32px)/600`.
  - 21 uses of `font-bold` (700) across 6 files, against the design system's 400/500/600 rule:
    `StatTile` (`SiteDetailView.tsx:88`), the Analytics metrics, the Settings and Content h1s,
    and the registration title.
  - 13 uses of `text-3xl`.
- **Focus.** Global `:focus-visible` is a 2px accent outline at 2px offset (`globals.css:250`).
  Components add `ring-2 ring-offset-2`, which follows the border radius, so it becomes square
  once the radius is 0. `ShareSiteDialog.tsx:283` uses `focus:` rather than `focus-visible:`.
- **Contrast (computed from the tokens).**

  | Pair | Light | Dark | Verdict |
  |---|---|---|---|
  | text-muted on card | 6.08 | 7.89 | passes |
  | text-muted on surface-2 | 5.34 | 7.01 | passes |
  | accent on card | 6.01 | 8.65 | passes |
  | `--line` on card | 1.34 | 1.45 | decorative only; fails 3:1 for controls |
  | `--line-strong` on card | 3.27 | 3.09 | passes 3:1 |

  Text is therefore AA. Control boundaries fail only because of the reset.
- **Off-system colour.**
  - Analytics icon hues (blue, green, yellow);
  - Billing emoji icons and the "PRO PLAN" pill next to a "Free" badge;
  - the emerald toast in `EditWebsiteButton.tsx:112`;
  - `/try`'s `slate-*`, which is marketing.

### Per page (1280 and 375 measured in the owner's live app, dark theme)

| Page | Shell / title | Concrete defects |
|---|---|---|
| Overview | `PageHeader`; h1 32/600 aligned at x=288 | Checklists stack one full card per incomplete site, with rows nested three boxes deep (16px card, then 12px rows, then buttons). The metric grid leaves the right column empty (`page.tsx:220-235`). At 375 the nested padding leaves a content width of about 271 px. |
| Sites | `PageHeader` | Status filter in a hidden-scroll pill (`sites/page.tsx:362-363`) clips "Stale" at 375. At 768 the search placeholder is clipped. The card kebab and copy-domain icons are `opacity-0` until hover (`SiteCard.tsx:88,107`), so **they are invisible on touch screens**. Each card has 7 controls, 2 of them duplicated. Live cards are 16px with a hover lift. |
| Site detail | No h1; a "Back to Sites" outline button above an h3 card title | 11 cards with nested rounded insets. The header row is `flex justify-between` with no wrap (`SiteDetailView.tsx:246`), so at 375 the title wraps to 4 lines. Full-width buttons in the Embed Script and Site Token cards. The snippet is shown 3 times. The `StatTile` 48 px icon tiles truncate "3 minut…" at 1280. "View install snippet" and "Installation guide" links sit at different sizes and baselines (`SiteInstallationCard.tsx:147,243`). The Content portability Format select has the browser chevron flush right. |
| Registration success panel | Dialog 600px, 22px radius | Fact 1. Also: "Go to Site Dashboard" only closes the dialog, yet carries an external-link icon (`:163-165,439-442`). The install copy duplicates `SiteInstallationCard`'s recipes in different words. Title "Site Registered Successfully!" is Title Case with an exclamation mark (copy rule violated; text pinned by tests). |
| Share Preview Link | Dialog 512px, 16px radius | Content clipped and a horizontal scrollbar at 375 (`ShareLinkCard.tsx:69-70` drives the grid). The select is described in fact 7. Permission toggles use `border-2` + 12px radius, and their unselected border is `--line` (1.45:1). The header is centred at 375 while the body is left-aligned (`dialog.tsx:75`). |
| Content | Local h1 30/700 | The filter bar is a card within the page. Each element is a card (very low density). Selector paths are monospace with no truncation strategy. |
| Analytics | **h2** 24/700, no h1 | Title squeezed to 125 px by the filter row; 3 px page overflow at 1280; native select and date inputs; off-palette icons; empty chart cards at 280 px tall. |
| Settings | h1 30/700 | 5 segmented tabs; 2 clipped at 375 with no affordance. |
| Billing | h1 32/600 but **x = +16 px** | Double container (`BillingDashboard.tsx:96,114,179,229,252`) plus a darker inset band. Emoji icons; nested tinted boxes. |
| Login / Signup | Centred `max-w-md` card | 16px card, 12px logo tile. Clean otherwise; no overflow. |
| Auth error, `/edit` hub | Centred column | Circular icon badges (`auth/error/page.tsx:17`, `EditorSignIn.tsx:286`); site picker rows at 12px radius. No overflow. |
| `/try` | Marketing header and footer | No overflow. Its radius and palette belong to marketing. |

### Responsive measurements

I measured `documentElement.scrollWidth` against `clientWidth`, every element whose right edge
passes the viewport, and every `overflow-x:auto` container whose `scrollWidth` exceeds its
`clientWidth`.

| Surface | 375 | 768 | 1280 | 1920 |
|---|---|---|---|---|
| Overview | ok | — | ok | — |
| Sites | **clipped filter** (395/341) | search placeholder clipped | ok | ok |
| Site detail | title column ≈110 px; 6,512 px tall | ok | ok | ok |
| Registration success panel (replica) | **panel h-scroll 2,572/331** | **2,572/588** | **2,572/588** | **2,572/588** (also at 320) |
| Share dialog | **panel h-scroll 370/331, content clipped** | — | ok | — |
| Add-site first screen | ok | — | ok | — |
| Content | ok | — | ok | — |
| Analytics | ok | — | **page h-scroll +3 px** | — |
| Settings | **tabs clipped** (610/341) | — | ok | — |
| Billing, Login, Signup, Auth error, Edit hub, Try | ok | — | ok | — |

### Radius by file (top 12 reachable in-scope files)

| Count | File |
|---|---|
| 10 | `SiteRegistrationModal.tsx` |
| 9 | `AnalyticsDashboard.tsx` |
| 9 | `SiteEditorsCard.tsx` |
| 8 | `BulkOperations.tsx` |
| 8 | `CreditBalanceCard.tsx` |
| 7 | `sites/page.tsx` |
| 6 | `ui/button.tsx` |
| 6 | `ui/dropdown-menu.tsx` |
| 6 | `EditWebsiteButton.tsx` |
| 5 | `EditorSignIn.tsx` |
| 5 | `DomainVerification.tsx` |
| 5 | `DashboardNavigation.tsx` |

`TryExperience.tsx` also has 5 and is marketing. Inline radius exists in one place:
`EditWebsiteButton.tsx:115` (`border-radius: 8px`). The `rounded-full` sites split as follows:

| Kind | Count | Examples |
|---|---|---|
| Real exceptions | 9 | avatar ×2, status dots ×6, spinner ×1 |
| Circles around icons | 11 | `error.tsx:34`, `content/page.tsx:337,385`, `auth/error:17`, `LoginForm:71`, `SignupForm:62`, `EditorSignIn:286`, `SiteRegistrationModal:286`, `VersionHistoryPanel:175`, `ShareLinkCard:72`, `SiteEditorRow:78` |
| Pills | 4 | Badge, filter counts, `TrialStatusBadge` |
| Progress bars | 4 | — |
| Skeletons | 3 | — |

## Screenshots

All captures are in `docs/designs/s66-app-design-system/current/<page>-<width>.jpg`.
- Widths 1280 and 375 for every surface; 768 and 1920 as well for `sites` and the two detail
  surfaces.
- Full-page captures, capped at 4,400 CSS px tall.
- JPEG, each file under 400 KB.
- Taken in the owner's signed-in Chrome, in my own tab, read-only.

Files:
- `overview`, `sites`, `site-detail-awaiting` (the awaiting-install site: install tabs and
  snippet), `site-detail-live`
- `add-site-dialog` (first screen only)
- `share-dialog`
- `site-registered-replica`
- `content`, `analytics`, `settings`, `billing`
- `teams-redirect`
- `login`, `signup`, `auth-error`, `edit-hub`, `try`
- `sort-menu-1280` (the transparent popover)

What these captures are not:
- **Every site token is masked to `•••`, and the one email address (Settings) is masked to
  `owner@example.com`, in the DOM before capture.** No token appears in this doc.
- **`site-registered-replica-*` is a reconstruction.** The real success state needs a site to be
  created, which was forbidden. I opened the real Register dialog, hid its form, and injected the
  success markup with the exact class strings of `SiteRegistrationModal.tsx:284-445` and a
  same-length masked token. It reproduces the owner's screenshot defect for defect. Nothing was
  submitted.
- **`login` and `signup` were captured in an isolated browser context**, because a signed-in
  session redirects them to `/dashboard`. A Dark Reader extension injected a fallback style
  there, which I stripped before capture.

What I could not capture:
- the open native "Expires in" dropdown (an OS popup that CDP screenshots do not include);
- light theme (the owner's OS is in dark mode);
- the bottom ~2,100 px of site detail at 375 (capture cap);
- `/dashboard/_ab-tests` (not a route).

The data shown is the owner's live QA data.

## Supabase reference

My source was `github.com/supabase/supabase` main (HEAD 2026-10-06), plus the live supabase.com
CSS fetched 2026-10-07. Files read: `apps/studio/styles/globals.css`, `packages/ui/build/css/*`,
`packages/config/{typography.css,css/theme.css,css/utilities.css}`,
`packages/ui/src/lib/constants.ts`, `packages/ui/src/components/shadcn/ui/*`,
`packages/ui-patterns/src/{PageHeader,PageContainer,PageSection,CodeBlock}`,
`apps/studio/components/layouts/Scaffold.tsx`, and `SidePanel.tsx`.

**What Supabase actually does:**
- **Radius.** Studio and www scale Tailwind's radius scale by 4/3 (commit cd77beba,
  2026-09-23): `--radius-sm` 5.33px, `--radius-md` **8px**, `--radius-lg` 10.67px,
  `--radius-xl` 16px. `--radius-panel` is 6px.
  - `rounded-md`: Button, Input, Select trigger, code block, project card.
  - `sm:rounded-lg`: Card and Dialog.
  - **No radius**: Sheet, SidePanel, Table and Tabs (underline style).
  - Badge is `rounded-full`.
- **Borders.**
  - All borders are 1px.
  - A base rule sets `border-color: var(--border-default)` on everything, inside the base
    layer.
  - Each border token is the foreground colour at low alpha: default 7.5–8 %, control and strong
    13.5–14.6 %, control-hover about 29 %.
  - Dividers are elements (`h-px bg-border`).
- **Surfaces.** The OKLCH ramp works out to: canvas `#131413` dark / `#fdfdfd` light; card
  `#181a19` / `#fff`; popover `#1b1d1c` / `#fff`.
  - In light mode cards are separated by their border, not by colour.
  - Text tokens are `foreground` / `-light` / `-lighter`.
- **Density.**
  - Button defaults to "tiny": 26px, `px-2.5`, `text-xs`.
  - Input and Select are 34px.
  - Table header is 40px with mono uppercase `heading-meta` labels.
  - Body cells are `p-4` (about 53px rows).
  - Body weight is 450; headings use Manrope semibold.
- **Shell.**
  - `ScaffoldContainer` is `max-w-[1200px] mx-auto`, with padding `px-4 @lg:px-6 @xl:px-10`.
  - Header is 48px; sidebar is 13rem.
  - `PageHeader`: `pt-12`, title `text-2xl tracking-tight`, description underneath, actions
    on the right, navigation tabs below with `border-b`.
  - Sections are `pt-12 gap-6`. The horizontal form layout is a `1fr 2fr` grid.
- **Lists.** The project list defaults to a **card grid**: `h-44 rounded-md border p-5`, hover
  `bg-surface-200`. A table view is optional.
- **Dialog and side panel.**
  - Dialog: header with no border, sections divided by `h-px` rules, footer `border-t` with
    right-aligned buttons, title `text-base`. The overlay is the dialog's scroll container.
  - SidePanel: square, `border-l`, 48px header with `border-b`, body
    `flex-1 overflow-y-auto` (**the single scroll region**), footer `border-t`.
- **Code block.**
  - Bordered, `bg-surface-100`, `rounded-md`, 13px mono.
  - **Scrolls horizontally by default.**
  - The copy button is top-right, icon-only, and shown only on hover or focus.
- **Select.** The chevron is a flex item inside `px-3`, so it sits 12px from the edge. It is a
  16px `ChevronDown` at `text-foreground-lighter`. The focus ring is 2px with a 2px offset.
- **Elevation.** Faint: Card `shadow-xs`, popovers and Dialog `shadow-md`, SidePanel
  `shadow-xl`.

**My opinion, not Supabase:**
- Take its structure, density, borders, dividers, underline tabs, container and side-panel
  pattern.
- Do **not** take its radius, because the owner asked for straighter than Supabase.
- Do not hide the copy button behind hover; it does not work on touch.
- Wrap snippets rather than scroll them. A long token scrolled out of view at 320 px is what
  the owner complained about.

## Information architecture (owner addition, 2026-10-07)

> "https://www.recopyfa.st/dashboard/sites is overwhelming. have multiple levels of settings. and
> invite a client, and editors are confusing. which one to use and when ?"

### Every settings surface and its depth

| Surface | How you reach it | Depth from the sidebar | What it holds | Duplicated by |
|---|---|---|---|---|
| Account settings `/dashboard/settings` | Sidebar → Settings | 1 | Tabs: Profile, Notifications, Security, API Keys, Appearance | Avatar menu → Settings; `/settings` redirects here |
| Billing `/dashboard/billing` | Sidebar → Billing | 1 | Plan, credits, usage, payment, invoices, lifetime offer | Avatar menu → Billing; sidebar Plan box |
| Card "Settings" button | Sites → card | 2 | **Not settings.** Opens the "Edit Website" dialog, which starts an edit session (`sites/page.tsx:606-636`) | Card kebab → "Settings"; checklist "Open site in edit mode" (same `/api/edit-sessions/create`) |
| Card kebab ⋮ (hover only) | Sites → hover → ⋮ | 2 | View Details, Settings, **Delete Site** (the only delete entry point) | — |
| Site detail (state) | Sites → View Details | 2 | 11 sections, listed in the next table | — |
| Share Preview Link dialog | Card share icon / detail → Share | 2 / 3 | Preview-link invites | — |
| Version History side panel | Detail → History | 3 | Content versions and restore | Name clashes with "History" in Content portability |
| Regenerate dialog | Detail → Regenerate snippet | 3 | Token rotation | — |
| Invite a client dialog | Overview or detail checklist | 1–3 | `SiteEditorsCard` inside a dialog | The Editors card on the same page |

The 11 sections of the site-detail page:

| Order | Section | Contents | Distance from top |
|---|---|---|---|
| 1 | Header | Share, History | — |
| 2 | Checklist | Copy snippet, Invite a client, Open site in edit mode | — |
| 3 | 4 stats | — | — |
| 4 | Editors | Add editor | ≈870 px at 1280 / ≈1,540 at 375 |
| 5 | Embed Script | Copy, Regenerate | ≈1,690 / ≈2,500 |
| 6 | Site Token | Copy | — |
| 7 | Installation | Snippet again, platform recipes | — |
| 8 | Domain ownership | — | — |
| 9 | Webhooks | — | — |
| 10 | Content portability | Export, Import, Batch Update, History | ≈3,520 at 1280 |
| 11 | Dialogs | — | — |

### Every access and invite entry point

| Label the owner sees | Where | Mechanism | Lifetime | Permissions offered | API / table |
|---|---|---|---|---|---|
| **Editors → "Add editor"** | Site detail section 4 | Durable allowlist. The invitee signs in at `/edit` with a one-time email code | Until revoked | View/Edit/Publish/Admin (default View+Edit, `InviteEditorForm.tsx:46`) | `/api/editor/editors` → `site_editors` |
| **"Invite a client"** | Overview checklist (one per incomplete site); detail checklist | **The same `SiteEditorsCard`** in a dialog, preset View+Edit+Publish (`ActivationChecklist.tsx:326-355`) | Until revoked | Same | Same |
| **"Share" / share icon → "Share Preview Link"** | Card (title "Share preview link"); detail header | Email invite to a staging/preview link, with a verification code | 1, 7, 14 or 30 days (`ShareSiteDialog.tsx:27-32`) | **Also** View/Edit/Publish/Admin (default View+Edit) | `/api/staging/access` → staging access |
| "Team management has moved" | `/dashboard/teams` → Sites notice | Retired | — | — | — |
| *(none)* | — | Collaborators via `site_permissions` | — | — | `/api/sites/[siteId]/share` has **no UI caller**; `components/collaboration/*` is orphaned |

Why it confuses:
- The two real mechanisms present **identical forms**: email plus the same four permission
  toggles.
- Nothing on screen says that one is permanent and the other expires, or that one edits the
  live site after sign-in while the other is a review link.
- "Invite a client" is the first mechanism under a third name.

### Simplified IA (proposal)

Sitemap today:

```
Sidebar ─ Overview /dashboard
        │   ├ celebration card × published site
        │   ├ "Get <site> publishing" checklist × every incomplete site
        │   │    Copy snippet · Invite a client(→Editors dialog) · Open site in edit mode
        │   ├ 4 metrics          └ Your sites list ── Manage → /dashboard/sites
        ├ Sites /dashboard/sites
        │   ├ Add site → Register dialog → success: Site Details + Integration Instructions
        │   ├ card × N: View Details · Settings(=start edit session) · share icon(=preview link)
        │   │           [hover] copy domain · [hover] ⋮ View Details / Settings / Delete
        │   └ View Details (no URL) → 11 stacked cards: Share · History · checklist · stats ·
        │      Editors · Embed Script · Site Token · Installation · Domain · Webhooks ·
        │      Content portability(Export · Import · Batch · History)
        ├ Content · Analytics
        ├ Settings (Profile · Notifications · Security · API Keys · Appearance) ← avatar menu, /settings
        └ Billing ← avatar menu, Plan box
Invitees: /edit hub        Orphan API: /api/sites/[siteId]/share
```

Proposed sitemap:

```
Sidebar ─ Overview · Sites · Content · Analytics │ Settings · Billing   (avatar menu: account + log out only)
Overview   "Needs attention": one row per incomplete site → deep link to its Install/People tab
Sites      one list: Name+domain · Status · Edits · Last activity · ⋮ (Open editor, Share preview link,
           Copy snippet, Delete) — row click opens the site
Site  /dashboard/sites/[siteId]    header: name · domain ↗ · status · [Open editor] [Share preview link]
   ├ Overview      setup checklist (until done) · stats
   ├ Install       ONE code block + Copy · platform recipes · site token + Regenerate · domain proof (optional)
   ├ People        Editors (durable) [Add editor] · Preview links (temporary) [Share preview link]
   ├ Content       version history · export / import / batch, with their log
   ├ Integrations  webhooks
   └ Settings      name & domain (needs API) · Danger zone: Delete site
```

The "People" tab carries two actions, each with a one-line explainer:
- **Add editor.** "For someone who keeps editing this site. They sign in on the editor page
  with a code sent to their email and keep access until you remove them."
- **Share preview link.** "For a one-off review before you publish. The link expires after the
  time you choose." Recommended default: view only, with edit and publish behind "Allow
  changes" (Q4).

Labels to remove or merge:

| Label | Change |
|---|---|
| "Invite a client" | Becomes "Add editor" |
| Card "Settings" | Becomes "Open editor" |
| "Edit Website" | Becomes "Open editor" |
| "Open site in edit mode" | Becomes "Open editor" |
| "History" (two meanings) | "Version history" and "Import/export log" |
| "Embed Script" | Merged with "Installation" into Install |
| "Site Token" card | Merged with "Installation" into Install |
| "Integration Instructions" | Merged with "Installation" into Install |

### Click counts, before and after

Counted from the Sites page, signed in. These are pointer clicks; typing is not counted, and
scroll is in CSS px at 1280.

| Task | Today | Today's count | Proposed | Proposed count |
|---|---|---|---|---|
| Copy install snippet | View Details → scroll → Copy Embed Script (or checklist Copy snippet, before install only) | 2 + 1,690 px scroll (1 from Overview before install) | row → Install (the default tab while awaiting install) → Copy | 2 awaiting / 3 live, no scroll |
| Add a durable editor | View Details → scroll → type → toggles → Add editor (or Invite a client dialog) | 2 + 870 px scroll + toggles | row → People → type → Add editor | 3, no scroll, one form |
| Share a preview link | card share icon → type → Create Link | 2 | row ⋮ → Share preview link → Create link | 3 |
| Delete site | hover → ⋮ → Delete Site → confirm | 3, **hover only** | row ⋮ (always visible) → Delete → confirm | 3 |
| Rename / change domain | **impossible**: delete and re-register gives a new token and the snippet must be re-pasted | — | Settings → edit → Save | 3 (needs API) |
| Regenerate snippet | View Details → scroll → Regenerate → confirm | 3 + 1,690 px scroll | row → Install → Regenerate → confirm | 4, no scroll |
| Open the editor | card Settings → Edit Website → button | 3 (2 via checklist) | row ⋮ → Open editor, or site header | 2 |
| Version history | View Details → History | 2 | row → Content | 2 |

The honest summary: click counts are about the same. What the IA removes is scrolling (up to
3,500 px), hover-only actions, three duplicate snippets, and the choice between two
identical-looking invite forms.

### What would need API or data changes

| Change | API / data? |
|---|---|
| Per-site route `/dashboard/sites/[siteId]` | UI only. It can read the existing `GET /api/sites` list (a plan allows at most 5 sites). A single-site GET would be cleaner but optional. |
| Merging "Invite a client" into People | UI only (same endpoint) |
| Relabelling | UI only |
| Moving delete into Settings | UI only (same `DELETE`) |
| Overview "Needs attention" | UI only (it reads `/api/sites/[siteId]/activation` as the checklists already do) |
| View-only preview links by default | UI only: the API still accepts any permissions. It is still **a product decision** (Q4). |
| **Rename / change domain** | **Needs an API.** `PATCH /api/sites/[siteId]` does not exist. Changing `sites.domain` changes which origin `authorizeSiteRequest` accepts, on a live install. **Separate story.** |
| Retiring `/api/sites/[siteId]/share` and `components/collaboration/*` | Dead-code cleanup. Separate story. |

## Options

| | A — tokens, primitives, panel | B — A plus Supabase-style list and site IA | C — full shell rework |
|---|---|---|---|
| What | Radius tokens to 0/2 px; border reset moved into `@layer base`; popover token; Dialog rebuilt as a flex column with one scroll body; new `CodeBlock` and `NativeSelect` primitives; one `PageHeader` everywhere; Billing container removed; filter and tab wrapping; registration and share panels redesigned; radius guard; screenshot harness | A, plus the Sites list as rows, the per-site route with tabs (Overview, Install, People, Content, Integrations, Settings), People unified, labels fixed | B, plus a 48 px header, a 208 px sidebar that collapses to an icon rail, a per-site secondary nav, and a site switcher in the header |
| Blast radius | `globals.css` and ~14 `ui/*`, `SiteRegistrationModal`, `ShareSiteDialog`/`ShareLinkCard`, 8 native selects, 5 page headers, ~18 bare `rounded`, ~29 non-exception `rounded-full`, plus a new e2e harness. **About 40–45 files.** Also reaches 9 marketing importers of `ui/*` (Q3) | A plus `sites/page.tsx`, a new site route, `SiteDetailView` split into sections, `SiteCard`→row, `ActivationChecklist`, `SiteEditorsCard`, `Overview`. **About 60 files** | Every page plus the layout, `DashboardNavigation` and `Breadcrumbs`. **80+** |
| Tests at risk | `card.test.tsx:39,55` pins `rounded-xl` and `:43` pins `shadow-sm`: **these pass if the token is remapped and the class kept.** `badge.test.tsx:46` pins `rounded-full`. `button.test.tsx:96-118` pins heights (keep them). Copy pinned by `SiteRegistrationModal.test` ("Site Registered Successfully!", `/^Copy$/`, `/^Copied!$/`), `ShareSiteDialog.test` ("Expires in", option "7 days", checkbox group) and `SiteDetailView.test` ("Site Token", "Installation", "copy embed script"). Keep all of these accessible names. | Also `sites/__tests__/page.test.tsx` ("Back to Sites", `site-detail-view` in-page, "View Details"), `SiteCard.test` (open menu / Delete Site), `SiteDetailView.test` section texts, and the `ActivationChecklist` labels. **This conflicts with AC 5 ("unchanged").** | Most dashboard tests |
| e2e | No authenticated dashboard e2e exists (`e2e/dashboard.spec.ts` only checks redirects). AC 4 needs a new seeded-owner harness, and the CI contract is `expected: 45` (`playwright.config.ts:14`) | Same | Same |
| Effort | M–L | L–XL | XL |
| Visual result | Straight, bordered, flat, aligned; panels fixed. Sites is still a card grid and site detail is still long, but square and tidy. | Answers "overwhelming" and "which invite" directly | Closest to Supabase Studio; highest regression risk |

## Recommendation

Take option A, and split the story three ways:

- **s66a — system, and the panel the owner pointed at** (AC 1, 2 and 6 in full; AC 3 and 4 for
  the shell, Sites, the registration panel and the Share dialog):
  - tokens: radius, the border-reset layer, the popover token, elevation;
  - the primitives: Button, Input, Select, a new NativeSelect, Card, Badge, Tabs (underline),
    Dialog, DropdownMenu, Alert, IconTile, Metric, Skeleton, PageHeader, and a new CodeBlock;
  - the registration success panel and the Share dialog;
  - the radius guard;
  - the authenticated Playwright screenshot harness;
  - an update to `docs/design-system.md`;
  - an ADR on app-surface radius and borders, superseding the design system's "container softer
    than contents" rule.
- **s66b — page passes, no IA change.** Overview, Sites, site detail (layout only: header wrap,
  section spacing, one CodeBlock), Content, Analytics, Settings, Billing, auth, the edit hub,
  and the error and loading pages. This completes AC 3 and AC 4 on every page.
- **s66c (or s67) — site IA.** The per-site route and tabs, People unified, the Sites list,
  label fixes. It changes navigation and the tests that pin labels and routes, so **it needs its
  own ACs.** AC 5 cannot hold as written. The owner should validate the sketch above first (Q4).

Do not take C: it buys more of the Supabase look at the price of every dashboard test.

### Radius exceptions (for the plan) and the guard (AC 2)

**Exceptions** (`rounded-full` allowed):
- `ui/avatar.tsx`;
- status dots up to 8 px (Badge dot `badge.tsx:93-95`, `CreditBalanceCard` dots,
  `VersionTimelineItem:46`, `EditWebsiteButton:344`);
- spinners (`animate-spin`; better replaced by `Loader2`);
- the WebKit scrollbar thumb (`globals.css:386`, browser chrome).

**Not exceptions**, so they become square: icon circles (use `IconTile`), progress bars,
empty-state step numbers, pills and filter counts. Badges are pending Q2.

**Guard.** `src/__tests__/design/radius-guard.test.ts` (Jest, so no new lint plugin) does two
things:
- (1) It parses `globals.css` and asserts that every `--radius*` theme token resolves to 0 or
  ≤ 2px.
- (2) It scans the app-surface sources (`src/app/{dashboard,settings,login,signup,auth,edit}`,
  `src/components/{ui,dashboard,auth,settings,billing,shared}`, excluding `__tests__`). It fails
  on:
  - bare `rounded` (a literal 4px, not tokenised);
  - `rounded-3xl` and `rounded-4xl`;
  - `rounded-[…]` above 2px;
  - `rounded-full` outside a file:line-pattern allowlist;
  - inline `border-radius` / `borderRadius` in TSX.

  The test prints the offending file:line.

Keeping the existing class names on the primitives and remapping the tokens keeps
`card.test.tsx` unchanged. The plan should also decide whether to rename to `rounded-none` /
`rounded-sm` later for honest names.

## Proposed design spec (concise)

**Radius.**
- `--radius-control: 2px`: button, input, select, textarea, checkbox, badge/chip, tab trigger,
  menu item, inline `code`.
- `--radius-container: 0`: card, panel, dialog, sheet, popover/menu, alert, code block, table,
  tabs list, skeleton, icon tile, sidebar items.
- Implementation in `@theme inline`:
  - `--radius-xs`, `--radius-sm`, `--radius-md` = 2px;
  - `--radius-lg`, `-xl`, `-2xl`, `-3xl`, `-4xl` = 0;
  - `--radius` = 0, which squares the skeleton;
  - `button.tsx` `lg`/`xl` move to `rounded-sm`.
- With `@theme inline`, values are inlined into utilities. Scoping per surface therefore needs a
  runtime variable (Q3); overriding `--radius-*` on a subtree does nothing.

**Borders.**
- 1px everywhere; drop `border-2`.
- Move the `*` reset into `@layer base`, so `border-input` (`--line-strong`, 3.09–3.27:1) applies
  to control boundaries and `--line` stays for containers and dividers. Then re-check
  `[data-demo-surface]`.
- Selected state uses an accent border plus a tick (as today), not 2px.

**Surfaces and elevation.**
- `canvas` for the page, `surface-card` for panels, `surface-1` for insets (code block, table
  header), `surface-2` for hover and selected.
- `--color-popover: var(--surface-card)` and `--color-popover-foreground: var(--text-strong)`.
- No shadow on static panels (Card `default` becomes the `outline` look; remove the hover lift
  from dashboard cards).
- `shadow-md` only on menus, popovers, dialogs and the sheet. Overlay `foreground/40`, no blur.

**Spacing** (4 px base).

| Element | Value |
|---|---|
| Page header to content | 24 |
| Section gap | 24 (16 below 640) |
| Panel padding | 20 / 16 |
| Panel header row | 48 px with `border-b` |
| Form fields | 16 apart; label to control 6 |
| Control height | 40 (`sm` 32); the 40 px touch rationale in `button.tsx:52-54` stands |
| Table header / row | 36 / 44 px, `px-4` |

**Shell.**
- Keep the 256 px sidebar and `max-w-[1180px]`.
- Gutters 16 / 24 / 32 at <640 / ≥640 / ≥1024.
- Header 56 px (from 64; Q5).
- **One `PageHeader` on every page.** Title on the left, actions on the right aligned to the
  title's bottom, wrapping under the title below 640. An optional underline tab bar goes below
  it (`border-b`).
- Filters row: same left edge, `flex-wrap gap-2`, search `flex-1 min-w-[12rem]`.
- Everything aligns to the content's left edge (today Billing is +16).

**Typography** (Instrument Sans).

| Role | Spec |
|---|---|
| Page title | 24/600, −0.015em (replaces the 26–32 clamp; Q5) |
| Panel and section title | 16/600 |
| Body | 14/20, weight 400 |
| Small | 13 |
| Meta label | 11/600 uppercase +0.075em (`.text-eyebrow`) |
| Code | JetBrains Mono 13/20 |
| Metric | 24/600, tabular |

No 700 in the app.

**Focus.** 2px accent outline at 2px offset. It is square because the radius is 0 or 2.
`focus:` becomes `focus-visible:`.

**Tabs.** Underline style: list `border-b`, trigger 40 px, active state a 2 px accent bottom
border. When they overflow, they wrap, or scroll with a visible edge fade. They are never
silently clipped.

**CodeBlock (new `ui/code-block.tsx`; closes the duplication behind fact 1).**
- `border` `--line`, `bg-surface-1`, radius 0.
- 36 px header bar: label on the left (for example "HTML"), a **visible** `sm` "Copy" button on
  the right. The label swaps to "Copied" for 2 s (the existing pattern).
- Body: mono 13/20, `white-space: pre-wrap; overflow-wrap: anywhere` by default. `wrap={false}`
  switches to `overflow-x: auto` inside the block only.
- `min-w-0` on every ancestor.
- It copies the exact `buildEmbedScript` string. It may *display* one attribute per line.

**NativeSelect (new `ui/native-select.tsx`).** A native `<select>` that keeps
`selectOptions`/mobile pickers working:
- `appearance: none`, height 40, `pl-3 pr-9`;
- `ChevronDown` 16 px, `absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none
  text-muted-foreground`;
- `border-input`, radius 2, `bg-card`;
- hover border `text-muted`; disabled `surface-2` at 60 %.

Align the Radix `SelectTrigger` to the same spec (`bg-card` instead of `bg-transparent`, radius
2). Its chevron is already a flex item inside `px-3`, which puts it 12 px from the edge.

**Dialog.**
- `flex flex-col`, `max-h-[90dvh]`, `w-[calc(100%-2rem)]`, widths 448 / **512** / 640 / 768,
  radius 0, `border`, `shadow-md`.
- Header `px-6 pt-5 pb-4`: title 16/600 left-aligned (never centred), description 14 muted.
- Body `flex-1 min-h-0 overflow-y-auto px-6 pb-5`. **This is the only scroll container, and its
  children are `min-w-0`.**
- Footer `border-t px-6 py-3 flex justify-end gap-2`.
- Below 640: full width, anchored to the bottom, `max-h-[92dvh]`, footer buttons stretch.
- At minimum, the grid becomes `grid-cols-[minmax(0,1fr)]`.

**Site-registered panel**, section by section:
1. **Header.** "Site registered" (pending the test copy, see Traps), then name · domain, the
   `StatusBadge` "Awaiting install", and the close button.
2. **Step 1, "Copy the snippet".** A CodeBlock that wraps, with Copy.
3. **Step 2, "Paste it before `</body>`".** The *same* platform recipe tabs as
   `SiteInstallationCard` (WordPress / Next.js / Plain HTML from `installRecipes`), rather than
   a second wording.
4. **Step 3, "Open your site — text is editable automatically".** Exclude / opt-in / links as
   one compact definition list. The HTML example goes in a collapsed "Show example" CodeBlock.
5. **Footer.** Site ID with a copy icon, an "Installation guide" link, then [Close] and [Open
   site page], which goes to the site's Install section and actually navigates.

```
1280 / dialog 640 px                                    375 / bottom sheet, full width
┌────────────────────────────────────────────────┐     ┌──────────────────────────────┐
│ Site registered                            [×] │     │ Site registered          [×] │
│ Example site · example.com  ◌ Awaiting install │     │ Example site · example.com   │
├────────────────────────────────────────────────┤     │ ◌ Awaiting install           │
│ 1  Copy the snippet                            │     ├──────────────────────────────┤ ↕ only
│ ┌ HTML ─────────────────────────────── [Copy] ┐│     │ 1 Copy the snippet           │   scroll
│ │ <script src="https://www.recopyfa.st/embed/ ││     │ ┌ HTML ─────────── [Copy] ┐ │
│ │ recopyfast.js" data-site-id="…" data-site-  ││     │ │ <script src="https://ww │ │
│ │ token="•••…" data-api-url="…/api" data-ws-  ││     │ │ w.recopyfa.st/embed/rec │ │
│ │ url="wss://recopyfast-ws.fly.dev"></script> ││     │ │ opyfast.js" data-site-i │ │
│ └─────────────────────────────────────────────┘│     │ │ d="…" data-site-token=" │ │
│ 2  Paste it before </body>                     │     │ │ •••…" …></script>       │ │
│    WordPress  Next.js  Plain HTML              │     │ └─────────────────────────┘ │
│    ─────────                                   │     │ 2 Paste it before </body>    │
│    Paste it into footer.php, before </body>.   │     │ WordPress Next.js Plain HTML │
│ 3  Open your site — text is editable           │     │ 3 Open your site…            │
│    Exclude  data-rcf-ignore                    │     │ Exclude  data-rcf-ignore     │
│    Opt in   data-rcf-content · rcf-editable-…  │     │ Opt in   data-rcf-content    │
│    ▸ Show example                              │     │ ▸ Show example               │
├────────────────────────────────────────────────┤     ├──────────────────────────────┤
│ Site ID 0000…0000 ⧉   Installation guide ↗     │     │ [ Open site page          ]  │
│                      [Close] [Open site page]  │     │ [ Close                   ]  │
└────────────────────────────────────────────────┘     └──────────────────────────────┘
```

## Traps and constraints

- **AC 5 against the copy rules.** The tests pin "Site Registered Successfully!", `/^Copy$/`,
  `/^Copied!$/`, "Register Site", "Expires in", "Site Token", "Installation", "Back to Sites" and
  "View Details". s66a/b must keep these accessible names, or change the tests *and say so in
  the PR* (AGENTS.md § Tests). That would be an explicit exception to AC 5.
- **`@theme inline` inlines token values**, and Radix portals render under `<body>`. Any
  per-surface scoping must live on `html` or `body` (for example `html[data-surface]` or
  `:has()`), not on the layout `div`.
- **Bare `rounded` is a literal 4px and `rounded-full` is `calc(infinity*1px)`.** Neither
  follows the tokens; both need class edits (18 and about 29 call sites).
- **Moving the border reset repaints about 138 call sites across 39 files, including
  marketing.** It needs before/after screenshots, not reasoning.
- **AC 4 needs an authenticated harness.**
  - Seed an owner with `supabase.auth.admin.createUser` (pattern:
    `e2e/share-edit-publish.spec.ts:371`), use fixture sites with fake tokens, and loop over 4
    viewports.
  - Raise the CI contract `expected: 45` by the number of new tests.
  - Never screenshot real tokens or emails.
- **Keep native selects.** `BulkOperations.test.tsx:301` uses `selectOptions`, and mobile
  pickers stay native.
- `docs/design-system.md` ("container softer than contents", "Radius `--radius: 0.75rem`") and
  the `card.tsx:7-15` comment must be rewritten in the same story. Framing-doc changes travel
  with `feature/<id>` as a story decision (AGENTS.md § Data & docs lifecycle).
- `framer-motion` stays off the dashboard. Embed allocation is 0 bytes; do not touch
  `public/embed/`.
- `EditWebsiteButton.tsx:105-123` injects an emerald DOM toast with innerHTML. The fix is
  either inline status or design-system gap 1 (toast); this story should not invent a toast.

## Open questions for the owner

1. **Radius split.** Containers at 0 and controls (buttons, inputs, chips, tabs) at 2px, or 0
   everywhere? **Default: 0 / 2px.**
2. **Badges and status chips.** Square (2px), which changes one class assertion in
   `badge.test.tsx:46`, or keep pills as a listed exception (Supabase uses pills)? **Default:
   square.**
3. **Marketing coupling.** Nine marketing files use `ui/*`: the Header CTA, `docs/install`, the
   blog, 404 and error. The token change squares their buttons and cards too. Accept that, or
   scope the app radius with an `html[data-surface]` runtime variable? Should `/try` (marketing
   header, footer and palette) count as Marketing? **Default: accept the squaring, and treat
   `/try` as Marketing**, excluded from the radius guard but still in the overflow checks.
4. **IA.** Approve the site IA above as its own story, s66c, with relaxed AC 5 for the
   route/label tests? Should preview links become view-only by default, with edit and publish
   behind "Allow changes"? **Default: yes to both.** Rename and change-domain go to a separate
   API story.
5. **Density.** Shrink the header from 64 to 56 px and the page title from a 26–32 px clamp to a
   fixed 24 px (Supabase-like)? **Default: yes.**

## Real complexity and split

The story was scored 5 for the system and the panel, and that holds. With the owner's IA
addition it exceeds 5 as one story. Split it into **s66a** (system, panel, guard, harness),
**s66b** (page passes) and **s66c** (site IA, with new ACs). Rename/domain becomes a separate
API story, and orphan cleanup (`/api/sites/[siteId]/share`, `components/collaboration/*`,
`SecurityDashboard`, `TranslationDashboard`) becomes a chore.
