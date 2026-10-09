---
validated: yes
---
# Plan — Story s66c2-quick-setup

> Part 2 of `docs/plans/s66c-site-page-and-access.md`, copied verbatim as that plan instructs
> ("Each part is then copied verbatim to … `docs/plans/s66c2-quick-setup.md`"), with the sections
> it shares with Part 1 that govern this part, also verbatim. The source stays the reference;
> its checkboxes and these move together.

> Owner decisions (2026-10-08): plan validated with the split — s66c1-site-pages (after s66b1 merges), then
> s66c2-quick-setup. The site action is labelled "Edit website". Quick setup is done once the site is Live;
> step 3 (edit or add an editor) is offered until then, then hides.

Research: `docs/research/s66-app-design-system.md` § Information architecture, re-verified at
design on `origin/main` `d4dae46`; this plan does not repeat it.
Design: `docs/designs/s66c-site-page-and-access.md` and its `.html` mockup.
Decision: [ADR 052](../decisions/052-site-subpages-share-one-site-record.md).
Page frame: s66b1's `PageShell` and page-shell guard (ADR 053, on the s66b branch).

---

## Part 2 — s66c2-quick-setup (6 tasks)

1. [x] **Extract `InstallStep`.**
   - RED: the new `src/components/dashboard/__tests__/InstallStep.test.tsx` covers the marker
     states `done` (✓, success tone), `current` (number, accent border) and `next` (number,
     muted). `SiteRegistrationModal.test.tsx` passes unchanged.
   - GREEN: `src/components/dashboard/InstallStep.tsx`, extracted from `SiteRegistrationModal`,
     which imports it back.
2. [x] **QuickSetup replaces ActivationChecklist.**
   - RED: `QuickSetup.test.tsx` replaces `ActivationChecklist.test.tsx` (`git mv`). Its loading,
     error with retry, dismissal persistence, copy-only-the-emitted-snippet, Add editor preset
     and Edit-website open-tab assertions carry over with their names changed. New:
     - three steps;
     - "Step N of 3";
     - only the current step expanded;
     - progress derived from props and activation only. Re-mounting with the same server state
       lands on the same step; no `localStorage` is involved.
   - GREEN: `QuickSetup.tsx`; delete `ActivationChecklist.tsx`.
3. [x] **Live install status, and done means Live.**
   - RED, in `QuickSetup.test.tsx`:
     - with the provider stub flipping `site.status` from `awaiting-install` to `live`, step 2's
       status row changes from "Waiting for the first page view…" to "Installed…" without an
       activation refetch;
     - live gives the header "Setup complete — <name> is live", with step 3 current (a stale
       site reads "… is installed");
     - `invited` or `published` (with live) hides the panel;
     - "Hide quick setup" calls the dismissal endpoint;
     - Edit website and Add editor appear when step 3 becomes current, once step 2 is done.
       Before that, step 3 shows only its title and one line.
   - GREEN: in `QuickSetup.tsx`.
4. [x] **Overview and the dashboard summary rows.**
   - RED:
     - `overview.test.tsx`: `QuickSetup` replaces the checklist;
     - `src/app/dashboard/__tests__/page.activation.test.tsx`: its mock moves to `QuickSetup`, and
       "renders a checklist for every admin site beyond the five recent rows" (`:45`) becomes one
       summary row per unfinished admin site, each with "Continue setup" →
       `/dashboard/sites/<id>`.
   - GREEN: `QuickSetup variant="summary"` on `/dashboard`; `variant="full"` on the Overview.
5. [x] **Per-site API keys.**
   - RED: the new `src/components/settings/__tests__/ApiKeysPanel.test.tsx`. With `siteId`: no
     site select, and keys fetched for that id. Without it: today's selector, and the existing
     behaviour is unchanged.
   - GREEN: an optional `siteId` prop on `ApiKeysPanel`; the "API keys" section on
     `settings/page.tsx`.
6. [x] **e2e and gates.**
   - Extend `e2e/site-pages.spec.ts` at 375 and 1280, with register, sites and activation
     fulfilled by `page.route`: registration → "Open site page" → Overview with step 2 current;
     the status flips when the next poll answers `live`; no overflow.
   - Raise the Playwright contract by exactly the new count.
   - Run the full gates.

---

## Run interdicts

- `git diff main...HEAD -- src/app/api supabase public/embed server` is empty, in both parts,
  save one sanctioned addition in s66c1 (PR #72 review D1, 2026-10-08; ADR 052 Amendment):
  `GET /api/sites` returns each site's `permission`, the caller's own grant. It only chooses what
  "Edit website" asks for; the session route re-reads the live grant and refuses anything higher
  (s68a, ADR 047), so the field grants nothing.
- No request body changes:
  - the edit session sends `["edit","admin"]` (row, menu, header) and `["edit","publish"]`
    (checklist, stepper), with 2 h. Since D1 that holds for an owner; a member's row, menu and
    header ask for their own grant (publish → `["edit","publish"]`, edit → `["edit"]`, view → no
    button);
  - editors POST/PATCH/DELETE, staging access POST/GET/DELETE, `DELETE /api/sites/[id]` and
    `POST …/regenerate-snippet` are unchanged.

  The reviewer greps every `fetch(` in the diff.
- `src/components/ui/**` and `page-shell.tsx` are not edited; compose with them. No new `ui/`
  primitive: no toast, no stepper, no table.
- `Breadcrumbs.tsx` (s66b-owned): only the id-segment and `people` label map.
- `radius-baseline.json` only loses entries.
- `jest.config.js` thresholds are not lowered.
- No marketing file changes.
- No zod, React Query or new dependency.
- Quick-setup progress is never stored client-side.
- **Never run `next dev`**: it appends to AGENTS.md. e2e uses the harness's build and start.
- The account Settings › API Keys tab is not removed (s66b's decision).
- The explainer strings are exactly those in AC 6; the owner reviews copy, not the implementer.
- Never `--no-verify`. One story commit per part (plus nothing else: no migration).

## The point everything turns on

**One site record shared by four routed pages (ADR 052).** The provider owns the site, its
install credentials and the install poll. Every subpage, the header's "Edit website" and Version
history read from it. If that single instance is wrong, a revoked snippet can survive on another
subpage, or a second site's credentials can flash under the first.

Where it could be wrong, and what to compare it against:
1. **Remount across sites.** Does `key={siteId}` on the provider, rendered by a server layout,
   really remount it when the segment changes in Next 16? Compare Task 2's "another `siteId`"
   test with a manual A → B navigation in the e2e. Fulfil `/api/sites` with two sites, and assert
   that site A's token never appears on site B's Install.
2. **The credential guards, ported out of one component into a provider plus consumers.** The
   first-render guard (`SiteDetailView.tsx:155-162`: props win during the first render for a new
   site) only works if consumers read `displayedCredentials`, never the raw state. Compare each
   consumer against the moved tests (`SiteDetailView.test.tsx:367-476`).
3. **Poll ownership.** Today the Sites page polls only while the detail is open. After this
   change:
   - the Sites page must not poll at all;
   - the provider polls only while the site is awaiting install;
   - `useSiteActivation`'s own 60 s refresh must not be doubled.

   Compare the fetch call counts in the moved poll tests, and the network log in the e2e.

## Files touched

Part 1:
- **Created**:
  - `src/app/dashboard/sites/[siteId]/layout.tsx`;
  - `src/app/dashboard/sites/[siteId]/page.tsx`, `install/page.tsx`, `people/page.tsx`,
    `settings/page.tsx`, and their `__tests__`;
  - `src/components/dashboard/site/{SiteProvider,SiteSubnav,useSitePageShell}.tsx`, and their
    `__tests__` including `site-context-fixture.tsx`;
  - `src/components/dashboard/{AddEditorDialog,PreviewLinksList,DeleteSiteDialog,SiteRow}.tsx`,
    and their tests;
  - `src/hooks/{useEditSession,usePreviewLinks}.ts`, and their tests;
  - `e2e/site-pages.spec.ts`;
  - `e2e/support/site-fixtures.ts`.
- **Changed**:
  - `src/app/dashboard/sites/page.tsx`;
  - `src/app/dashboard/page.tsx` (one href);
  - `EditWebsiteButton`, `ActivationChecklist`, `SiteEditorsCard`, `SiteEditorRow`,
    `InviteEditorForm`, `SiteInstallationCard`, `ShareSiteDialog`, `SiteRegistrationModal`,
    `DomainVerification`, `WebhooksPanel`, `BulkOperations`, `VersionHistoryPanel`,
    `VersionPreviewDialog`, `VersionTimelineItem`;
  - `Breadcrumbs.tsx` (labels only);
  - `src/lib/docs/installation-content.ts`;
  - the tests listed in AC 10;
  - `e2e/app-layout.spec.ts`;
  - `playwright.config.ts`;
  - `.github/workflows/ci.yml`;
  - `src/__tests__/design/radius-baseline.json`.
- **Deleted**: `SiteDetailView.tsx`, `SiteCard.tsx`, `ShareButton.tsx`, and their tests.

Part 2:
- **Created**:
  - `InstallStep.tsx`;
  - `QuickSetup.tsx` (it replaces `ActivationChecklist.tsx`);
  - the tests;
  - `ApiKeysPanel.test.tsx`.
- **Changed**:
  - `SiteRegistrationModal.tsx` (it imports `InstallStep`);
  - the Overview page;
  - `src/app/dashboard/page.tsx`;
  - `page.activation.test.tsx`;
  - `ApiKeysPanel.tsx`;
  - the Settings page;
  - `e2e/site-pages.spec.ts`;
  - the Playwright contract.

## Test strategy

- **Unit (Jest + RTL).** Each page is rendered inside a provider stub; the provider is tested
  against a mocked `fetch`. The moved tests keep their assertions verbatim, and the PR lists every
  move with its source `file:line`. Labels are asserted by accessible name. The exact explainer
  strings and `data-site-token` uniqueness are asserted on the rendered page, not on components.
- **Source scans** (existing): the radius guard, the page-shell guard (s66b1), the dialog
  call-site scan and the native-select scan all cover the new files automatically.
- **e2e (Playwright, the s66a signed-in harness).** At 375 and 1280: overflow on each page,
  Back/Forward, Delete by taps, the long preview-link label, and the dialog's single scroll region.
  Every list a capture shows is fulfilled by `page.route`, so no real token or address reaches a
  capture.
- **No new API tests**: no route changes.

## Definition of Done

Per part:
- a single PR, whose description lists every changed or moved test with its reason (AC 10);
- lint, type-check, type-check:build, format:check, build and the full Jest suite are green;
- the Playwright contract equals the new total, and `site-pages.spec` passes in CI;
- the radius guard and the page-shell guard pass, and the 14 owned baseline entries are gone
  (Part 1);
- the captures in `docs/designs/s66c-site-page-and-access/after/` are committed, fixture data
  only;
- the review is passed with no open critical;
- deployed.

## Questions for the owner (each has a recommended default)

1. **Label: "Edit website" or "Open editor"?** The first story wording said "Open editor". In this
   product, "editor" already names a person ("Add editor", "Editors", "editor hub").
   **Default: "Edit website".**
2. **Split into s66c1 (pages, list, access, advanced settings) and s66c2 (quick setup, per-site
   API keys), both after s66b1?** s66c as one story would be 16 tasks. **Default: yes.**
3. **Quick setup is "done" when the site is Live.** Step 3 (Edit website / Add editor) stays
   offered until it is done or hidden. This replaces s35's completion card (installed + invited +
   published). **Default: yes, as drawn.**
