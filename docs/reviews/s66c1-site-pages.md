# Review — s66c1-site-pages

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s66c1-site-pages`
(merge-base `2b092e4` → `79d757f`; merge commit `43acb1e`).

## Verdict summary

Tasks 1–9 done as specified; Task 10 partly (e2e written, contract raised, baseline entries removed; captures
missing, e2e never run). Run interdicts hold (no API/DB/embed/server/ui/middleware/package change;
Breadcrumbs labels only; baseline only loses entries — 14 entries / 49 offences; page-shell PENDING empty; no
marketing file). Every request body is unchanged except the preview-link default grant becoming `["view"]`
(AC 6). Security: the site token lives once in `SiteScope`, members without credentials never see it,
`key={siteId}` remounts on site change (removing it → red); Edit website relies on the unchanged s68a route
and only opens http(s) links on the registered host (stricter than before); Delete stays creator-only
server-side, 403 shown in the dialog, confirmation pinned; Regenerate safeguards moved word for word; deleted
components leave nothing dangling. People & access answers the owner's question: exactly two actions under
"Ongoing access" / "One-off review" with the AC 6 explainers; preview links View-only by default. Full jest
368 suites / 4,674 tests, type-check (both), lint (0 errors) green; `--list` 69. 18 mutations: 15 bite.

## Findings

### Major

- Task 10 incomplete (`docs/plans/s66c-site-page-and-access.md:308`, DoD :503, :506): no captures in
  `docs/designs/s66c-site-page-and-access/after/`; the 9 new e2e tests and the edited `app-layout.spec.ts`
  have never run (AC 1 Back/Forward, AC 3 ⋮ → Delete by taps, AC 10 overflow at 375/1280 rest on them).

### Minor

- m1 — `people/__tests__/page.test.tsx:95-103`: the explainer-to-button pairing is not pinned (swapping them →
  0 red) — exactly the owner's complaint; assert inside each option card.
- m2 — `SiteProvider.tsx:299-303`: the "this render shows the new site's own values" safeguard is untested
  (removing it → 0 red); `SiteProvider.test.tsx:493` "immediately clears…" overclaims.
- m3 — `SiteProvider.tsx:343-348`: the late-rotation check is untested (backup only).
- m4 — `ShareSiteDialog.tsx:90-91` kept mounted at `people/page.tsx:101-106`: stale error/success messages
  survive closing and reopening (undeclared behaviour loss).
- m5 — `OWNER_EDIT_PERMISSIONS` lives in `useSitePageShell.tsx`; `SiteRow.tsx:34` imports it and pulls the
  header, VersionHistoryPanel and SiteProvider into the Sites list's module graph.
- m6 — `DeleteSiteDialog.tsx:70-74`: after a successful DELETE, `finally` re-enables the button while
  `router.replace` is in flight; a second tap sends another DELETE and flashes a 403.
- m7 — `e2e/site-pages.spec.ts:418`: the A→B test uses `page.goto` (full load), so it cannot catch a
  client-side remount problem; the Jest layout-key test is the real proof.
- m8 — plan drift: no `docs/plans/s66c1-site-pages.md` copy of Part 1.
- m9 — `ActivationChecklist.test.tsx` changed beyond button names (regex `/allow pop-ups/`, auto-focus assertion
  dropped, mock "Revoke publish editor" calls `onAdded`) — must be declared in the PR.
- m10 — `e2e/site-pages.spec.ts:270,274` not Prettier-formatted.
- m11 (logistics) — the branch is behind main; the Playwright contract must be reconciled on merge.

## Not verified

No e2e run; nothing rendered (rows at 375/1280, subnav wrapping, bottom sheet, Settings at 375, site-page left
edge); no real router Back/Forward/remount; no real pop-up blockers; no real creator-only 403 with a second
admin; no email delivery; `npm run build` not run.

## Orchestrator note

Owner standing rule: fix majors and cheap minors before shipping. Captures are produced against the local
in-memory Supabase stand-in (the s66a approach); the e2e run is CI's. m1–m10 go to the fix run; m11 is the
orchestrator's at merge time.

## Verification of `ddc5d22`, `ab7cf52`, merge `4a45e2c`, `ff94968` (fresh reviewer, 2026-10-08)

- Review fixes bite: m6 single delete + per-site re-arm, m4 Share dialog reset on open, m3 late rotation, m2
  first-render guard, m1 explainer-to-button pairing (each mutation → red); m5 constant moved to
  `src/hooks/useEditSession.ts`.
- Edit-website errors never render inside a header's actions, a toolbar or a button row: site pages render the
  Alert as a direct child of `[data-page-shell]` after the site nav; Sites row and ⋮ menu share one message line;
  the checklist uses its alert slot; errors clear on the next attempt; `role="alert"`. Captures confirm the
  header stays aligned at 375 and 1280.
- Merge correct: Playwright 78 consistent (`--list` 78); page-shell PENDING `{}`; `radius-baseline.json` deleted
  and the radius guard asserts zero offences app-wide (probe → red); `dashboard/page.tsx` keeps s66b2's
  full-bleed rows with the new site links; nothing from s66b2/s67 lost.
- R5/R6/R7 pass app-wide; VersionTimelineItem status stays legible without rings (colour + "Current Version"
  text label).
- The 9 site-pages + 19 app-layout e2e passed 28/28 locally against the Supabase stand-in.
- Full jest 372 suites / 4,818 tests, type-check green.

Remaining proof: this PR's CI E2E on the real stack (78).

Max severity: none
Ship allowed: yes

## PR #72 bot review (Devin)

Three findings on PR #72, fixed test-first in one commit on `feature/s66c1-site-pages`.

- **D1 (red) — an `edit` member could never open a site.** The site header (`useSitePageShell`) and the Sites
  row with its ⋮ menu (`SiteRow`) sent `OWNER_EDIT_PERMISSIONS` (`["edit","admin"]`) for every member;
  `createEditSession` refuses any permission outside the caller's live grant (s68a, ADR 047). Fix:
  `GET /api/sites` now returns each site's `permission`, the caller's own `site_permissions` row (a label,
  not a capability: the session route re-reads the row). `editPermissionsForGrant` (`src/hooks/useEditSession.ts`)
  maps it: admin → the owner set, unchanged; publish → `["edit","publish"]`; edit → `["edit"]` (the button
  never sends `view`); view or unknown → `[]`, and neither the header, the row nor the menu offers Edit
  website. The activation checklist (admins only) keeps `["edit","publish"]`. This is an API change in a
  story whose run interdicts said "no API change": the list carried no role field, and `siteToken` presence
  only tells admin from non-admin, not edit from view.
- **D2 (red) — every preview link copied from the list was dead.** `PreviewLinksList` built
  `rcf_token=${link.token || link.id}`, and `GET /api/staging/access` omits the secret token by design, so it
  always copied the row id. **Pre-existing on main**: `ShareSiteDialog.handleCopyLink` had the same fallback
  over the same token-less list. Fix: no copy control on a listed link (`ShareLinkCard` loses Copy and the
  never-filled `token`/`stagingUrl` fields; `PreviewLinksList` loses `previewUrl`, `handleCopy` and its
  `domain` prop) and a one-line hint ("Copy a link when you create it: this list cannot show it again. Lost
  one? Revoke it and share a new one."). The dialog's success state offers "Copy link", copying the creation
  response's `stagingUrl`. No owner-side resend exists (the only resend, `POST /api/staging/verify`, is keyed
  by the token itself); the invite email carries only the code, so "the link was sent by email" would be false.
- **D3 (yellow) — another admin's rotation never reached an open page.** `SiteScope` ignored every same-site
  refresh, so after an external "Regenerate snippet" the page kept the revoked token. Fix: a newer record
  replaces the shown credentials when (1) its `updated_at` is later than the row the credentials came from,
  (2) no regeneration of ours is pending, and (3) its list request started after our last regeneration landed
  (a request counter); the first answer after our own regeneration only re-anchors the marker. Not the token's
  issued-at: `GET /api/sites` mints a fresh token per request, so issued-at "newest wins" would swap the
  snippet on every 5 s install poll, and it is stamped after the stats reads, not when the key was read. Known
  limit: a rotation by another admin between our regeneration's commit and our refetch's read is picked up at
  the next row change, not at once.

Tests: D1 — API grant (`install-credentials-visibility.test.ts`, 3), mapping (`useEditSession.test.ts`, 5),
row button + menu for an editor and a viewer (`SiteRow.test.tsx`, 3), header for an editor and a viewer
(`layout.test.tsx`, 2). D2 — list offers no row-id copy and shows the hint (`PreviewLinksList.test.tsx`),
Copy link from the creation response and none without one (`ShareSiteDialog.test.tsx`, 2). D3 — Install
follows an external rotation on the next poll (`install/page.test.tsx`), no churn on a re-mint, own
regeneration survives an earlier newer record and the answer after it (`SiteProvider.test.tsx`, 2). Mutations:
each guard removed → red (updated_at check, request counter, pending guard, re-anchor, viewer gating on header,
row and menu, menu body, dialog Copy link condition, API field).

Rewritten assertions: `PreviewLinksList.test.tsx` "copies the link's preview URL" (it fed the list a `token`
the API never sends) → the D2 test; `ShareLinkCard.test.tsx` "keeps the Copy and Revoke names" → "keeps the
Revoke name, and offers no Copy". Fixtures gain the owner's grant (`permission: "admin"`): `buildSite`,
`SiteRow.test.tsx`, the Sites page test, `e2e/support/site-fixtures.ts` `routeSites` ("as an admin of each").

Gates: full Jest 372 suites / 4,836 passed (38 skipped), `type-check` and `type-check:build` green, lint 0
errors, `format:check` clean, Playwright `--list` 78.

Follow-up: a refused automatic clipboard copy after creation no longer reports the created link as failed (`ShareSiteDialog` shows "Link created — copy it with the Copy link button.", refetches the list and keeps Copy link; red-then-green in `ShareSiteDialog.test.tsx`), and ADR 052 gains an Amendment recording D1's `permission` field as the story's one sanctioned API addition (run interdicts in `stories.md` and both plans updated to match).

Max severity: major
Ship allowed: yes
