# Research — Story s04-retire-graveyard-surfaces

> **Warning carried over from `docs/reviews/stories.md`:** that file ends `Stories ready: no`
> (max severity: major, six majors, none touching `s04` directly). Operator confirmed
> proceeding. `s04` itself is referenced repeatedly in that review as one of the *closed*
> items (widget claim ✅, teams-nav claim ✅) — see "Verified APIs / functions" below for what
> was re-checked here versus what the review already checked.

## The five structuring facts

1. `src/components/dashboard/DashboardNavigation.tsx:49-51` is a stale comment ("A/B Tests is
   deliberately absent … see `src/app/dashboard/ab-tests`") that also names the **wrong
   directory** — the real one is `src/app/dashboard/_ab-tests/` (underscore). Not `s04`'s to
   fix per the story text, but it sits one line above the code `s04` does touch and an agent
   copying the pattern will copy the typo too.
2. `src/components/dashboard/DashboardNavigation.tsx:59-64` is the "Teams" nav item
   (`href: "/dashboard/teams"`, `badge: "Pro"`, `requiresPlan: "pro"`) — the only thing `s04`
   needs to delete from this file.
3. `TeamSelector`, `InvitationManager`, `NotificationCenter`, `SecurityDashboard` are **already**
   imported nowhere but their own file and `src/__tests__/integration/collaboration.test.tsx` —
   confirmed by grep, zero hits elsewhere. AC3 is already true today; it costs nothing to keep
   true, it just needs a regression test.
4. `public/embed/recopyfast.src.js:5454-5460` ships exactly the five tabs the story names —
   `{elements, styles, languages, history, themes}` — and the three fetch call sites the story
   cites resolve to the exact lines claimed: `:5726` (`styles/apply`, POST), `:6028` (`themes`,
   GET), `:6129` (`themes`, POST), `:6159` (`themes`, PUT).
5. **Not in the story text, and this is the real trap:** `:5639` —
   `applyStyleBtn.onclick = () => self.switchTab('styles');` — is a *second*, independent
   entry point into the Styles tab, rendered inside the **Elements** tab whenever one or more
   elements are selected (the "🎨 Apply Style" quick-action button). It calls `switchTab`
   directly, bypassing the tab bar entirely. Removing the two `tabData` entries at
   `:5454-5460` makes the tab buttons disappear but does **not** remove this button — a user
   can still select elements, click "Apply Style", land on the (allegedly retired) Styles tab,
   and fire the exact `/edit-board/styles/apply` request AC5 says must never happen.

## Target story

`s04-retire-graveyard-surfaces` (`docs/stories.md:236-275`). Complexity as scored: **2** —
"routing, navigation and removing two widget tabs." No dependencies.

Acceptance criteria (verbatim, numbered for reference below):
1. "Teams" absent from dashboard navigation.
2. `/dashboard/teams` redirects to the site sharing surface — not a 404, not a broken page.
3. No dashboard route renders `TeamSelector`, `InvitationManager`, `NotificationCenter` or
   `SecurityDashboard`.
4. Widget Edit Board no longer renders Styles/Themes tabs; remaining tabs are Elements,
   Languages, History.
5. Widget makes no request to `/edit-board/styles/apply` or `/edit-board/themes`.
6. Per-element typography/colour controls in the floating editor toolbar still work — untouched.
7. `/api/teams/*`, `/api/notifications`, `/api/security/*`, `/api/audit/*`,
   `/api/edit-board/styles/apply`, `/api/edit-board/themes` all respond exactly as before, their
   existing tests pass unchanged.
8. Email invitation to edit a site is unaffected and remains reachable.

## Current state of the code

**Dashboard side.**
- `DashboardNavigation.tsx` — two-group nav (`Workspace`, `Account`). Teams sits in `Account`
  with `requiresPlan: "pro"`, gated by `canAccessItem`/`PLAN_RANK`. Removing the item is a
  one-entry array edit; no other file references this array.
- `src/app/dashboard/teams/page.tsx` **exists and is not a stub** — 538 lines, a fully working
  team-management UI: lists teams (`GET /api/teams`), lists/removes members
  (`GET/DELETE /api/teams/{id}/members`), sends invitations (`POST /api/teams/{id}/invitations`),
  reads `/api/billing/entitlement`, and renders a "Roles & Permissions" explainer (Owner/Admin/
  Member). This is live, reachable code today for anyone who navigates to the URL directly
  (nav visibility does not gate the route itself — only `src/middleware.ts`'s generic
  auth/entitlement checks do, which do not single out `/dashboard/teams`). AC2 requires this
  538-line page become a redirect, not merely hiding its nav entry.
- The four "graveyard" React components (`TeamSelector.tsx`, `InvitationManager.tsx`,
  `NotificationCenter.tsx` in `src/components/collaboration/`, `SecurityDashboard.tsx` in
  `src/components/dashboard/`) are already orphaned — none is imported by
  `src/app/dashboard/teams/page.tsx` or any other route. `teams/page.tsx` re-implements the
  same functionality inline rather than using them. AC3 passes today without a code change;
  what's missing is a test that pins it (there is none yet — `collaboration.test.tsx` only
  covers the components in isolation, not "nothing else imports them").
- `src/components/dashboard/Breadcrumbs.tsx` has **no hardcoded "Teams" label** — its test
  (`Breadcrumbs.test.tsx:74-78`, asserting the breadcrumb reads "Teams" for pathname
  `/dashboard/teams`) is a pure path-segment-to-title-case unit test, independent of whether
  the route actually renders anything. Verified not a trap: turning the route into a redirect
  will not break this test (it never mounts the real page).
- Email-invite grant path (AC8): `InviteEditorForm.tsx` is a dumb form taking an `onInvite`
  callback prop; it imports `EditorPermission` from `@/lib/auth/editor-access`, not from
  anything `/api/teams/*`-related. Rendered inside `SiteDetailView.tsx` alongside
  `ShareSiteDialog`/`ShareButton`/`SiteEditorsCard`. Confirmed zero code-path overlap with the
  teams API — safe by construction, not something this story can accidentally break.

**Widget side** (`public/embed/recopyfast.src.js`, the source; `recopyfast.js` is the built
artifact — 239,016 bytes source vs. 174,420 bytes built, confirming `recopyfast.js` predates
the current source and must be regenerated via `npm run build:embed`, never hand-edited).
- Tab list, `switchTab` dispatch, `renderStylesTab`/`renderThemesTab`, and `loadStyles`/
  `loadThemes` are all in one class. `loadTabData()`'s `switch (this.activeTab)` at
  `:5507-5531` has explicit `case 'styles'` / `case 'themes'` arms that call the loaders —
  these are dispatched on `this.activeTab`, which is only ever set by `switchTab()`, called
  from exactly two places: the tab-bar buttons (`:5466`) and the Elements-tab quick-action
  button (`:5639`, fact 5 above).
- `styles/apply`, `themes` (GET/POST/PUT) routes and their tests are real and currently
  exercised: `src/__tests__/api/edit-board/cors-credentials.test.ts` imports
  `@/app/api/edit-board/styles/apply/route` and `@/app/api/edit-board/themes/route` directly
  for CORS assertions; `staging-token-device.test.ts` also references both route files by path
  with device-staging-token assertions. AC7's "existing tests pass unchanged" is grounded in
  these two files specifically — touching the route files themselves (which the story
  correctly says not to do) would break them.

## Anchor points

- `src/components/dashboard/DashboardNavigation.tsx:59-64` — delete the Teams `NavItem`.
- `src/components/dashboard/DashboardNavigation.tsx:49-51` — adjacent stale comment (not this
  story's AC, but worth a one-line fix while the file is open; flagged as m7 in
  `docs/reviews/stories.md:188` for a *different* story, `s11`, to fix formally).
- `src/app/dashboard/teams/page.tsx` — replace body with a redirect (`redirect()` from
  `next/navigation` for a server component, or client-side `useEffect` + `router.replace` if
  it must stay a client component — current file is `"use client"`; a server-component
  redirect would be simpler and is idiomatic Next.js App Router).
- `public/embed/recopyfast.src.js:5454-5460` — remove the two `tabData` entries.
- `public/embed/recopyfast.src.js:5639` — remove (or disable) the "Apply Style" quick-action
  button entirely, since its only destination no longer exists.
- `public/embed/recopyfast.src.js:5507-5531` — the `case 'styles'` / `case 'themes'` arms in
  `loadTabData()` become unreachable once both call sites are gone; AC4/AC5 do not strictly
  require deleting this dead code (story's own note: "frozen means unexposed, not deleted" —
  though that note is about API routes, the same spirit plausibly extends to the dead branches
  here — worth a planning decision, see Open questions).
- `scripts/build-embed.mjs` — rebuild step (`npm run build:embed`) after any `.src.js` edit;
  the script has a `--check` staleness gate per `AGENTS.md:105`.

## Verified APIs / functions

- `GET/POST /api/teams` (`src/app/api/teams/route.ts`), `GET/DELETE /api/teams/{id}/members`,
  `POST /api/teams/{id}/invitations`, `POST /api/teams/invitations/accept` — all exist, all
  have route-level tests (`src/__tests__/api/teams/route.test.ts`,
  `identity-attachment.test.ts`, `members-embed.test.ts`). None of these are touched by this
  story; AC7 requires they keep passing, which they will since no route file changes.
- `GET /api/notifications`, `GET /api/security/events`, `GET /api/security/stats`,
  `GET /api/audit/compliance`, `GET /api/audit/logs` all exist as standalone route files.
  Only `security/events` has a dedicated test found
  (`src/__tests__/api/security/events-unauthenticated.test.ts`) — the others have no test file
  under `src/__tests__/` matching their name, meaning AC7's "existing tests pass unchanged" is
  vacuously true for `notifications` and `audit/*` (nothing to break) but real for
  `security/events`.
- `POST /api/edit-board/styles/apply`, `GET/POST/PUT /api/edit-board/themes` — exist, covered
  by `cors-credentials.test.ts` and `staging-token-device.test.ts` as noted above.
- `src/app/dashboard/_ab-tests/page.tsx` — the cited reversibility precedent. It is a single
  file with no redirect logic (the underscore alone makes it unroutable, and the story text
  says visiting `/dashboard/ab-tests` "now 404s"). `s04` is explicitly asked to do *more* than
  this precedent (add a redirect, not just make the segment private) — correctly called out in
  the story's own agentic notes.
- `TypographyPanel.tsx`, `ColorPicker.tsx`, `FontSizeSelector.tsx`,
  `TextAlignmentControls.tsx` under `src/components/editor/` — verified these do **not** appear
  anywhere in `recopyfast.src.js` at all; they are React components consumed by
  `FloatingEditorToolbar.tsx`, which itself is only imported by
  `src/components/landing/InteractiveHero.tsx` (a marketing/landing demo), not by the widget or
  by any dashboard editing surface. AC6 ("does not touch them") is true by construction — there
  is zero shared code between what this story changes and what AC6 protects.

## Traps & constraints

- **The hidden Styles entry point (fact 5).** The single biggest risk to AC5. An implementer
  who reads only the story's cited line numbers (`:5454-5460`, `:5726`, `:6028/:6129/:6159`)
  will remove the tab list and leave `:5639` in place, shipping a version where AC4 passes
  (no Styles *tab*) but AC5 fails under a specific user action (select elements → "Apply
  Style" still reachable, still fires the fetch).
- **`/dashboard/teams/page.tsx` is not a stub to hide, it's 538 lines of live functionality to
  remove.** The story's own framing ("this removes the last dashboard entry point") undersells
  it — nav visibility was never the only way to reach this URL. The redirect must replace real
  functioning code (team listing, invite-by-email-with-role, member removal), not just add a
  guard in front of it.
- **Widget is a built artifact.** Edits to `recopyfast.js` are silently overwritten by the next
  build (`AGENTS.md:103-105`). Must edit `.src.js`, then `npm run build:embed`, and the
  `--check` flag will fail CI on a stale artifact if the rebuild step is skipped.
- **Do not touch API routes or their tests** (story's own instruction, consistent with
  `AGENTS.md`'s "frozen means unexposed, not deleted" framing) — `s06-embed-budget-gate`'s
  minor finding (m3 in `docs/reviews/stories.md:180`) explicitly says `s04` leaving the route
  layer alone is correct, but flags that if `s04`'s AC4 is only "no longer renders," the tab
  *implementation* bytes (`renderStylesTab`, `renderThemesTab`, `loadStyles`, `loadThemes`,
  ~90+ lines each) stay in the shipped artifact and `s06`'s later byte-budget work gets nothing
  from this story unless `s04` is asked to delete the widget-side implementation, not just stop
  calling it. `s04`'s own AC4/AC5 as currently written do **not** require deleting the
  `renderStylesTab`/`renderThemesTab`/`loadStyles`/`loadThemes` functions or the dead `case`
  arms — only that they stop being reachable. This is a real scope boundary a planner must
  set explicitly (see Open questions).
- **Stale nav comment adjacency.** `DashboardNavigation.tsx:49-51`'s wrong directory name
  (`ab-tests` vs `_ab-tests`) sits directly above the code this story edits. `docs/reviews/
  stories.md:188` (m7) assigns fixing this comment to `s11`, not `s04` — but if `s11` has not
  landed first, an implementer touching this file for `s04` may reasonably "clean up" the
  comment anyway. Not this story's AC; flag rather than silently do it, to avoid stepping on
  `s11`'s territory.
- **No plan-mode `teams/page.tsx` test exists to break.** `Breadcrumbs.test.tsx` is the only
  hit for "dashboard/teams" under `src/__tests__/`, and it is decoupled from the real page (see
  above) — so there is no regression safety net today for the 538-line page being replaced.
  New tests for the redirect (AC2) and for AC3's "nothing renders these four components" are
  both new work this story must add, not modify.

## Open questions

- **Exact redirect target for AC2.** "The site sharing surface" has no single dedicated route.
  Sharing (`ShareSiteDialog`, `InviteEditorForm`, `ShareButton`, `SiteEditorsCard`) is rendered
  per-site inside `SiteDetailView.tsx`; there is no `/dashboard/sites/[id]` directory (site
  detail appears to be handled within `src/app/dashboard/sites/page.tsx`, not a separate
  dynamic route folder — not fully traced here, out of this story's file set). The most
  literal reading is `/dashboard/teams` → `/dashboard/sites` (the list, where a user then picks
  a site to share), but the story does not say whether the redirect is unconditional or should
  carry a query param / toast explaining why they landed there. Needs a planning decision.
- **Scope of "no longer renders" vs. "removed" for the widget tab implementations.** As flagged
  in Traps: does AC4/AC5 require deleting `renderStylesTab`, `renderThemesTab`, `loadStyles`,
  `loadThemes`, and the `case 'styles'`/`case 'themes'` dispatch arms, or just making them
  unreachable? The story text says "no longer renders" (AC4) and "makes no request" (AC5) —
  both satisfiable by leaving the functions defined but unreferenced. `s06`'s own notes (in
  `docs/reviews/stories.md`, m3) assume `s04` deletes this code and are counting on those bytes
  being gone; if `s04` only disconnects the entry points, `s06` inherits ~150-200 lines of dead
  weight it did not budget for. This should be settled explicitly at `/ks-plan`, not left
  implicit.
- **Whether `switchTab('styles'|'themes')` should be blocked defensively inside `switchTab`
  itself**, in addition to removing both known call sites — i.e., a belt-and-suspenders guard
  against some future re-introduction of a third call site. Not required by any AC as written;
  a planning call, not a research finding.
- **Server vs. client redirect for `/dashboard/teams`.** The current page is `"use client"`.
  A server-component redirect (`redirect()` from `next/navigation`) is idiomatic and avoids a
  content flash, but changes the file's component type; whether anything downstream expects
  this route to remain a client component was not traced (nothing found that would, but the
  page.tsx file itself was the only file inspected for this — not its transitive test/type
  usage beyond what grep covered).

## Real complexity

**Re-scored: 2, holding at the story's own estimate — but a tight 2, not a loose one.**
Nothing here crosses into "business logic / several states" (3) or "integrations, payments,
roles" (4) on the PRD's own scale (`prd.md:128-129`): no new schema, no new integration, no
payment path, no new permission role — it is deletion/redirection of existing surfaces plus
one non-obvious secondary entry point to also close off. The story's complexity note ("routing,
navigation and removing two widget tabs") slightly undersells two things found here — the
538-line live page behind the redirect, and the second Styles entry point at `:5639` — but
both are still mechanical removals bounded to files already named in the story's own agentic
notes (`DashboardNavigation.tsx`, `teams/page.tsx`, `recopyfast.src.js`). Neither introduces a
new state machine, a new external dependency, or a new data model. No split proposal.

Not a 5, and no split proposal is offered (per the research brief, one is only required when
the re-score lands at 5).
