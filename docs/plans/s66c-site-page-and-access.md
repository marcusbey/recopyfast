---
validated: yes
---
# Plan — Story s66c-site-page-and-access (proposed split: s66c1-site-pages, s66c2-quick-setup)

> Owner decisions (2026-10-08): plan validated with the split — s66c1-site-pages (after s66b1 merges), then
> s66c2-quick-setup. The site action is labelled "Edit website". Quick setup is done once the site is Live;
> step 3 (edit or add an editor) is offered until then, then hides.

Branch: `feature/s66c-site-page-and-access`. On split validation, Part 1 executes as
`feature/s66c1-site-pages` (this branch, renamed; s66a precedent), and Part 2 as
`feature/s66c2-quick-setup` from `main` once Part 1 merges. Each part is then copied verbatim to
`docs/plans/s66c1-site-pages.md` and `docs/plans/s66c2-quick-setup.md`.

Research: `docs/research/s66-app-design-system.md` § Information architecture, re-verified at
design on `origin/main` `d4dae46`; this plan does not repeat it.
Design: `docs/designs/s66c-site-page-and-access.md` and its `.html` mockup.
Decision: [ADR 052](../decisions/052-site-subpages-share-one-site-record.md).
Page frame: s66b1's `PageShell` and page-shell guard (ADR 053, on the s66b branch).

## Dependencies and order

1. **s66b1-app-shell merges first.** It provides:
   - `src/components/ui/page-shell.tsx` (`PageShell({ title, eyebrow?, meta?, description?, actions?, nav?, children })`);
   - `.text-page-title`;
   - `src/__tests__/design/page-shell-guard.test.ts`, under which every routed dashboard page
     renders `<PageShell`, only `page-shell.tsx` renders `<PageHeader`, there is no other `<h1`,
     and there is no `container`. `sites/page.tsx` starts on its shrink-only pending list.
2. Part 1 (s66c1) runs **in parallel with s66b2-app-page-passes**; they touch different files.
   Whichever merges second rebases the four shared files:
   - `e2e/app-layout.spec.ts`, plus the Playwright count (`playwright.config.ts:14`,
     `.github/workflows/ci.yml:215,:398`);
   - `src/__tests__/design/radius-baseline.json`;
   - `docs/design-system.md`;
   - `docs/stories.md`.
3. Part 2 (s66c2) follows Part 1's merge.

Before Task 1 of either part: `git fetch && git rebase origin/main`, confirm that `page-shell.tsx`
and the guard exist, and read ADR 053. If s66b1 is not merged, **stop**. Nothing here may
re-create `PageShell`.

## Target story

`docs/stories.md` → s66c (split proposed), s66c1-site-pages (AC 1–10), s66c2-quick-setup (AC 1–6).
In short:
- every site has four subpages at real URLs, sharing one site record;
- `/dashboard/sites` is a light list with one primary action and ⋮ per row;
- People & access offers exactly two actions with explainers, plus the two lists;
- "Edit website" is on the design system and has no dialog;
- "Invite a client" is gone;
- advanced Settings holds the optional panels and the Danger zone;
- s66c2 adds a quick setup that ends Live, and per-site API keys.

Ownership, per the coordinator on 2026-10-08:
- s66c owns `sites/**` and the dashboard components listed in AC 10.
- 14 of those files are in `radius-baseline.json` with **49 offences**. Part 1 takes all 14 to
  zero (see the per-task "Radius" lines).
- `Breadcrumbs.tsx` is s66b-owned. Part 1 changes only its segment labels (Task 3).

---

## Part 1 — s66c1-site-pages (10 tasks)

Every task starts with the test that must fail. "Provider stub" means a render inside
`<SiteContext.Provider value={…}>` built by the test helper
`src/components/dashboard/site/__tests__/site-context-fixture.tsx`, created in Task 1. Pages never
take the site as a prop.

1. [x] **SiteProvider: the record, not-found, errors, the install poll.**
   - RED, the new `src/components/dashboard/site/__tests__/SiteProvider.test.tsx`:
     - (a) with `/api/sites` mocked to three sites, `useSiteContext()` gives the matching site;
     - (b) an id not in the list renders `PageShell` titled "Site not found", a link to
       `/dashboard/sites`, and none of the listed sites' names;
     - (c) a non-ok response renders a destructive Alert with Try again, which refetches; it is
       never "not found";
     - (d) the four poll tests from `src/app/dashboard/sites/__tests__/page.test.tsx:200-284`,
       moved with their assertions unchanged:
       - polls while awaiting install;
       - stops once live;
       - never polls a live site;
       - stops on unmount (this replaces "goes back to the list");
     - (e) `isAdmin` is true exactly when the site has a `siteToken`. That is the route's own
       admin test (`src/app/api/sites/route.ts:169-181`); say so in a comment.
   - GREEN:
     - `src/components/dashboard/site/SiteProvider.tsx` (`"use client"`; `SiteContext`;
       `useSiteContext()` throws outside the provider);
     - `src/app/dashboard/sites/[siteId]/layout.tsx`, a server component:
       `params: Promise<{ siteId: string }>`, awaited, rendering
       `<SiteProvider key={siteId} siteId={siteId}>{children}</SiteProvider>`.

     The poll keeps the tombstone comment from `sites/page.tsx:271-301` (why five seconds, why
     only while awaiting install, why those dependencies).
2. [x] **SiteProvider: credentials and regeneration.**
   - RED, in `SiteProvider.test.tsx`: move `SiteDetailView.test.tsx:298-516` there, assertions
     unchanged:
     - every displayed credential is replaced after a rotation;
     - a same-site rotation survives stale props;
     - permission loss clears the credentials in the same render;
     - a late rotation is ignored;
     - a failed regeneration keeps the current credentials;
     - no regeneration is offered without credentials.

     The test drives them through a probe consumer that prints the token and the snippet and
     calls `regenerateSnippet()`. Add one new test: re-rendering the layout with another `siteId`
     shows none of the first site's token in that same render (the ADR 052 "Watch" item).
   - GREEN: move `SiteDetailView.tsx:103-234` (`credentials`, `credentialSiteId`,
     `latestSelection`, `displayedCredentials`, `handleRegenerateSnippet`) into the provider,
     with its comments. A successful rotation then calls `refetch()`.
3. [x] **Edit website on the design system.**
   - RED:
     - the new `src/hooks/__tests__/useEditSession.test.ts`, ported from
       `ActivationChecklist.test.tsx:393-480`:
       - the tab opens before the request resolves;
       - the posted body is exactly the one given;
       - only an http(s) URL on the registered host is opened;
       - a refused request closes the tab and returns the server message;
       - a blocked pop-up returns "Allow pop-ups for ReCopyFast, then try again.";
     - the new `src/components/dashboard/__tests__/EditWebsiteButton.test.tsx`:
       - it renders the `Button` primitive (`rounded-control`; no `rounded-lg`, no raw
         `<button>` classes);
       - the label is "Edit website", with `Loader2` while pending;
       - an error is a `role="alert"` reported to the caller and rendered outside the button row (site pages: a full-width Alert directly in the page shell after the site nav; Sites row: the row's own message line; checklist: its message slot) — s66c1 review fix `ab7cf52`;
       - `document.body` gains no injected node on success (the DOM toast is gone);
       - the row, menu and header send `permissions: ["edit","admin"], durationHours: 2`.
   - GREEN:
     - `src/hooks/useEditSession.ts`;
     - rewrite `EditWebsiteButton.tsx`: delete `showSuccessNotification` and the SVG spinner,
       delete `ActiveEditSessions` if `rg ActiveEditSessions src` shows no importer, and keep the
       `userPermissions` gate;
     - `ActivationChecklist.handleEdit` calls the hook. Its labels stay as they are in this task,
       so `ActivationChecklist.test.tsx` **must pass unchanged**: that is the proof the
       extraction changed no behaviour.
   - Radius: `EditWebsiteButton` → 0.
4. [x] **The site frame: header, subnav, states, breadcrumb.**
   - RED:
     - the new `src/app/dashboard/sites/[siteId]/__tests__/layout.test.tsx`. With a provider stub
       and `usePathname` mocked per case, each of the four pages renders:
       - one h1 (the site name);
       - the `StatusBadge` text;
       - the domain link (`https://acme.example`, `target="_blank"`, `rel` including
         `noopener`);
       - the buttons "Edit website" and "Version history"; Version history opens
         `VersionHistoryPanel`;
       - a `nav` named "Site" with links "Overview", "Install", "People & access" and
         "Settings", with exact hrefs, and `aria-current="page"` only on the current one;
     - new cases in `src/__tests__/components/dashboard/Breadcrumbs.test.tsx`: a UUID segment reads
       "Site", `people` reads "People & access", and the existing `"123"` case is unchanged;
     - the page-shell guard covers the four new `page.tsx` files;
     - write `e2e/site-pages.spec.ts` now, using the s66a signed-in harness (`seedLayoutOwner`,
       `signInAsLayoutOwner` from `e2e/support/owner-session.ts`). It goes Sites → row name →
       Install → People & access, then Back, Back, Forward, then Back to Sites; and an unknown id
       shows "Site not found". It stays red until Task 9.
   - GREEN:
     - `src/components/dashboard/site/SiteSubnav.tsx` (`next/link`, Tabs trigger look per ADR
       053's `nav` slot);
     - `src/components/dashboard/site/useSitePageShell.tsx`, which returns the `PageShell` props,
       so each page reads `<PageShell {...shell}>` and the guard sees `<PageShell`;
     - stub pages `page.tsx`, `install/page.tsx`, `people/page.tsx` and `settings/page.tsx` under
       `src/app/dashboard/sites/[siteId]/`;
     - the label map in `Breadcrumbs.tsx`.
   - Radius: `VersionHistoryPanel`, `VersionPreviewDialog`, `VersionTimelineItem` → 0. Their
     overlay and sheet are otherwise untouched (design-system gap 12 stays open).
5. [x] **Install.**
   - RED:
     - the new `install/__tests__/page.test.tsx`:
       - in each of awaiting / live / stale, exactly one element's text contains
         `data-site-token`;
       - "Copy snippet" writes exactly the provider's `embedScript`;
       - "Copy site token" writes the token;
       - Regenerate snippet → "Regenerate now" POSTs `/api/sites/<id>/regenerate-snippet`, and
         both blocks show the new values;
       - without credentials: "Only this site's admins can see its install snippet." and no
         `data-site-token` anywhere;
     - `SiteInstallationCard.test.tsx`:
       - `:151-160` now asserts the snippet is visible when live, with no disclosure button;
       - `:102` `findByText("Copied")` becomes
         `findByRole("button", { name: /copy snippet/i })` with text "Copied", because
         `CodeBlock` also announces it in a live region.
   - GREEN:
     - `SiteInstallationCard`: one `CodeBlock` (`label="HTML"`, `copyLabel="Copy snippet"`) above
       the recipe `Tabs`. The recipes become text only. `InstallSnippet` and `SnippetDisclosure`
       are deleted.
     - `install/page.tsx`: the regenerated Alert, `SiteInstallationCard`, and the Site token
       `Card`. The regenerate `Dialog` moves from `SiteDetailView.tsx:493-552` with its copy.
   - Radius: `SiteInstallationCard` → 0.
6. [x] **People & access: editors, and the checklist's Add editor.**
   - RED:
     - the new `src/components/dashboard/__tests__/AddEditorDialog.test.tsx` receives the
       enrolment tests from `SiteEditorsCard.test.tsx` (`:117`, `:165-239`, `:374-557`). The only
       change: render `<AddEditorDialog open …>` instead of the card. Their assertions are
       unchanged:
       - focus;
       - the emailed notice and the hub-link fallback with "Copy link";
       - the posted permissions;
       - the Publish preset;
       - the typed address kept on refusal;
       - the seat-limit warning with "View plans";
       - a red ordinary failure;
       - no submit without permissions.

       Add: after success the footer shows only "Done".
     - `SiteEditorsCard.test.tsx` keeps the list, resend, remove and forbidden tests, and they
       pass. `:106-115` still passes; the empty-state first step becomes "Choose Add editor
       above."
     - `ActivationChecklist.test.tsx`:
       - "Invite a client" becomes "Add editor" (`:141`, `:147`, `:160`, `:322`, `:378`;
         aria-label "Add editor to Client Site");
       - "Open Client Site in edit mode" becomes "Edit website: Client Site" (`:150`, `:161`,
         `:404-476`);
       - the mock at `:9-25` mocks `../AddEditorDialog` and keeps `data-default-permissions`;
       - `:264-391` (the notice survives completion and a refresh error) asserts against that
         mock.
   - GREEN:
     - `AddEditorDialog.tsx`: `InviteEditorForm`, `handleInvite`, `readActionFailure`,
       `NoticePanel` and the seat-limit branch, moved out of `SiteEditorsCard`. Props: `open`,
       `onOpenChange`, `siteId`, `siteName`, `defaultPermissions`, `onAdded`.
     - `SiteEditorsCard` keeps the list, resend, remove and its notices. Its form is gone.
     - `ActivationChecklist`: the step is relabelled and renders `AddEditorDialog` (preset
       View+Edit+Publish), and its edit action renders `EditWebsiteButton` (body
       `["edit","publish"]`).
   - Radius: `SiteEditorsCard`, `SiteEditorRow`, `InviteEditorForm`, `ActivationChecklist` → 0.
7. [x] **People & access: preview links and the page.**
   - RED:
     - the new `src/components/dashboard/__tests__/PreviewLinksList.test.tsx`:
       - it lists from `GET /api/staging/access?siteId=`;
       - a 403 shows "You cannot manage preview links on this site.";
       - a failure shows an Alert with Try again;
       - the empty line;
       - revoke DELETEs and drops the row, and a failed revoke shows an error instead of failing
         silently;
       - copy;
     - `ShareSiteDialog.test.tsx`:
       - `:76-80` becomes View checked and Edit, Publish, Admin unchecked;
       - `:110-122` clicks Edit as well;
       - `renderDialog` (`:25-37`) awaits the email field rather than a fetch;
       - new: after a successful send the grant is `["view"]` again;
       - new: the description is the explainer;
     - the new `people/__tests__/page.test.tsx`:
       - exactly two action buttons, named "Add editor" and "Share preview link";
       - both explainers, exact (AC 6);
       - for a non-admin: both disabled, plus "Only this site's admins can give access.";
       - Add editor → success → the editors list fetches again;
       - Share → success → the links list fetches again.
   - GREEN:
     - `src/hooks/usePreviewLinks.ts` (`{ data, loading, error, refetch, revoke }`, error states
       per AGENTS.md § React);
     - `PreviewLinksList.tsx`;
     - `ShareSiteDialog` becomes create-only: its list and fetch are removed; it gains
       `onCreated?` and `manageHref?` (the "See preview links" link used from the Sites row);
     - `people/page.tsx`.
8. [x] **Settings (advanced) and Delete.**
   - RED, the new `settings/__tests__/page.test.tsx`:
     - the intro line;
     - name and domain read-only, with the "isn't available yet" note;
     - `DomainVerification`, `WebhooksPanel` and `BulkOperations` mounted with this `siteId`;
     - a tab named "Operation history";
     - Danger zone → "Delete site" → "Delete site?" → DELETE `/api/sites/<id>` →
       `router.replace("/dashboard/sites")`;
     - a 403 `{ error: "Only the site creator can delete this site" }` stays inside the dialog;
     - `expectNoEmptyBodyBand` on the confirmation.

     `BulkOperations.test.tsx:506,516,527` passes unchanged (`/history/i`).
   - GREEN:
     - `src/components/dashboard/DeleteSiteDialog.tsx`, which the Sites row also uses;
     - `settings/page.tsx`;
     - the tab label in `BulkOperations.tsx:473`.
   - Radius: `DomainVerification`, `WebhooksPanel`, `BulkOperations` → 0.
9. [x] **Overview, the light list, the entry points; retire the detail view.**
   - RED:
     - the new `src/components/dashboard/__tests__/SiteRow.test.tsx`, from
       `SiteCard.test.tsx`'s surviving cases (`:44-55`, `:64-68`, `:128-172`):
       - the name link's href is `/dashboard/sites/<id>`;
       - the primary action is "Continue setup" (href to the Overview) while awaiting install,
         "Edit website" otherwise;
       - the trigger "Open menu for Example Site" has no `opacity-0` class;
       - the menu shows Open site page, Edit website, Share preview link, Delete site;
       - "Delete site" calls `onDelete`;
       - no "Copy domain" control;
     - `sites/__tests__/page.test.tsx`:
       - the mock (`:28-46`) becomes `SiteRow`;
       - the poll tests are gone (moved in Task 1);
       - `:349-392` become a name-link href assertion;
       - the empty-band test (`:458-464`) passes via `DeleteSiteDialog`;
       - new: no "View Details" and no "Edit Website" dialog anywhere;
     - `teams-moved-notice.test.tsx`: the mocks (`:35-45`), and `:90` becomes
       `/People & access/i`;
     - the new `src/app/dashboard/sites/[siteId]/__tests__/overview.test.tsx`:
       - the checklist for an admin;
       - the three metrics, with no "Page views";
       - site details with "Copy site ID";
     - `SiteRegistrationModal.test.tsx` (added): "Open site page" links to
       `/dashboard/sites/<id>`;
     - `src/lib/docs/__tests__/installation-content.test.ts` (added): no "View Details" and no
       "Invite a client"; the guide names "People & access" and "Add editor".
   - GREEN:
     - `SiteRow.tsx`;
     - `sites/page.tsx` renders through `PageShell` and is removed from the guard's pending
       list. Removed from it: `selectedSiteId`, the poll, the `SiteDetailView` branch and the
       "Edit Website" dialog. It uses `DeleteSiteDialog` and `ShareSiteDialog` (`manageHref`).
     - `[siteId]/page.tsx` (Overview);
     - the registration footer link;
     - `dashboard/page.tsx:339-341`: `href={`/dashboard/sites/${site.id}`}`;
     - the teams notice copy (`sites/page.tsx:344`);
     - `installation-content.ts:118-119`, `:216` and `:226`.
     - Delete `SiteDetailView.tsx`, `SiteCard.tsx`, `ShareButton.tsx` and their tests, after
       `rg -n "SiteDetailView|SiteCard\b|ShareButton" src e2e` shows no remaining importer.
   - Radius: `sites/page.tsx` → 0; the `SiteDetailView` entry disappears with the file.
10. [ ] **e2e, the Playwright contract, the radius baseline, gates.**
    - Complete `e2e/site-pages.spec.ts`. At 375 and 1280, on the Sites list and each of the four
      subpages:
      - `documentElement.scrollWidth - clientWidth ≤ 0`;
      - no visible descendant of `#dashboard-main` past its right edge.

      Also:
      - at 375, ⋮ is visible at rest, and taps alone go ⋮ → Delete site → Delete site. The
        DELETE is fulfilled by `page.route`, so the seeded site survives for later tests, and
        the page lands on `/dashboard/sites`;
      - at 375, the preview-link list holds the s66a 60-character label without overflow, using
        the `routeShareList` fixture idea from `app-layout.spec.ts:252-294`, copied into
        `e2e/support/site-fixtures.ts`;
      - at 375, the Add editor dialog has exactly one scroll container;
      - Back and Forward, as in Task 4.
    - `e2e/app-layout.spec.ts`:
      - `openShareDialog` (`:296-301`) goes through `/dashboard/sites/<seeded id>/people` →
        "Share preview link";
      - the long-label assertion moves to the page list;
      - `:505-508` asserts the row's "Open menu for E2E layout site" is visible;
      - `:550` matches the new description.
    - Raise `expected: 56` by exactly the new test count in `playwright.config.ts:14` and
      `.github/workflows/ci.yml:215,:398`.
    - Remove the 14 s66c entries from `radius-baseline.json`; the guard proves them at zero.
    - With `RCF_LAYOUT_SCREENSHOTS=1`, write captures to
      `docs/designs/s66c-site-page-and-access/after/`, fixture data only: token `•••`, `.invalid`
      domain, `@example.com`.
    - Gates: `lint`, `type-check`, `type-check:build`, `format:check`, `build`, `npm test`, and
      `npm run test:e2e` with `RUN_RECOPYFAST_CORE_E2E` against the local Supabase stack.

---

## Part 2 — s66c2-quick-setup (6 tasks)

1. [ ] **Extract `InstallStep`.**
   - RED: the new `src/components/dashboard/__tests__/InstallStep.test.tsx` covers the marker
     states `done` (✓, success tone), `current` (number, accent border) and `next` (number,
     muted). `SiteRegistrationModal.test.tsx` passes unchanged.
   - GREEN: `src/components/dashboard/InstallStep.tsx`, extracted from `SiteRegistrationModal`,
     which imports it back.
2. [ ] **QuickSetup replaces ActivationChecklist.**
   - RED: `QuickSetup.test.tsx` replaces `ActivationChecklist.test.tsx` (`git mv`). Its loading,
     error with retry, dismissal persistence, copy-only-the-emitted-snippet, Add editor preset
     and Edit-website open-tab assertions carry over with their names changed. New:
     - three steps;
     - "Step N of 3";
     - only the current step expanded;
     - progress derived from props and activation only. Re-mounting with the same server state
       lands on the same step; no `localStorage` is involved.
   - GREEN: `QuickSetup.tsx`; delete `ActivationChecklist.tsx`.
3. [ ] **Live install status, and done means Live.**
   - RED, in `QuickSetup.test.tsx`:
     - with the provider stub flipping `site.status` from `awaiting-install` to `live`, step 2's
       status row changes from "Waiting for the first page view…" to "Installed…" without an
       activation refetch;
     - live gives the header "Setup complete — <name> is live", with step 3 current;
     - `invited` or `published` (with live) hides the panel;
     - "Hide quick setup" calls the dismissal endpoint;
     - "Edit website" is disabled until step 2 is done.
   - GREEN: in `QuickSetup.tsx`.
4. [ ] **Overview and the dashboard summary rows.**
   - RED:
     - `overview.test.tsx`: `QuickSetup` replaces the checklist;
     - `src/app/dashboard/__tests__/page.activation.test.tsx`: its mock moves to `QuickSetup`, and
       "renders a checklist for every admin site beyond the five recent rows" (`:45`) becomes one
       summary row per unfinished admin site, each with "Continue setup" →
       `/dashboard/sites/<id>`.
   - GREEN: `QuickSetup variant="summary"` on `/dashboard`; `variant="full"` on the Overview.
5. [ ] **Per-site API keys.**
   - RED: the new `src/components/settings/__tests__/ApiKeysPanel.test.tsx`. With `siteId`: no
     site select, and keys fetched for that id. Without it: today's selector, and the existing
     behaviour is unchanged.
   - GREEN: an optional `siteId` prop on `ApiKeysPanel`; the "API keys" section on
     `settings/page.tsx`.
6. [ ] **e2e and gates.**
   - Extend `e2e/site-pages.spec.ts` at 375 and 1280, with register, sites and activation
     fulfilled by `page.route`: registration → "Open site page" → Overview with step 2 current;
     the status flips when the next poll answers `live`; no overflow.
   - Raise the Playwright contract by exactly the new count.
   - Run the full gates.

---

## Run interdicts

- `git diff main...HEAD -- src/app/api supabase public/embed server` is empty, in both parts.
- No request body changes:
  - the edit session sends `["edit","admin"]` (row, menu, header) and `["edit","publish"]`
    (checklist, stepper), with 2 h;
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
