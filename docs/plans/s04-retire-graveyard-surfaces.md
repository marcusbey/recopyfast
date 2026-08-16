---
validated: no
---
# Plan — Story s04-retire-graveyard-surfaces

Branch: `feature/s04-retire-graveyard-surfaces`
Research: `docs/research/s04-retire-graveyard-surfaces.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s04-retire-graveyard-surfaces.md` — the redirect landing (`Alert variant="info"` on `/dashboard/sites`) and the widget's 3-tab layout come from here verbatim. No new component is invented.

## Target story

`s04-retire-graveyard-surfaces` (`docs/stories.md:343-382`). Complexity 2 — a tight 2, per
research: an unusually large amount of *already-true* behaviour to pin with tests, plus one
non-obvious secondary entry point to close.

Acceptance criteria carried forward verbatim from `docs/stories.md`:
1. "Teams" absent from dashboard navigation.
2. `/dashboard/teams` redirects to the site sharing surface — not a 404, not a broken page.
3. No dashboard route renders `TeamSelector`, `InvitationManager`, `NotificationCenter` or `SecurityDashboard`.
4. Widget Edit Board no longer renders Styles/Themes tabs; remaining tabs are Elements, Languages, History.
5. Widget makes no request to `/edit-board/styles/apply` or `/edit-board/themes`.
6. Per-element typography/colour controls in the floating editor toolbar still work — untouched.
7. `/api/teams/*`, `/api/notifications`, `/api/security/*`, `/api/audit/*`, `/api/edit-board/styles/apply`, `/api/edit-board/themes` all respond exactly as before, existing tests pass unchanged.
8. Email invitation to edit a site is unaffected and remains reachable.

**Scope decision this plan settles (research left it open):** the widget-side dead code left
behind once both tab entry points are removed — `renderStylesTab`, `renderThemesTab`,
`loadStyles`, `loadThemes`, and the `case 'styles'` / `case 'themes'` arms in `loadTabData()`
(`public/embed/recopyfast.src.js:5513-5527, 5650-5726, 6026-6167` — exact ranges confirmed by
read before execution) — is **deleted, not left unreferenced**. Reasoning: the "don't delete,
freeze" interdict in this story protects the **API route layer** (`src/app/api/**/route.ts`)
because deleting a route is unrecoverable scope loss if an agency later asks for real teams.
It does not extend to the widget's client-side caller code, which has no external contract —
deleting it is the only way to make AC5 true by construction rather than by omission, and it is
exactly the code `s06-embed-budget-gate`'s own agentic notes expect `s04` to have removed
(`docs/stories.md:463-466`: "sequence `s04` first ... it deletes code this story would
otherwise spend effort minifying"). The API routes themselves are never touched.

## Tasks (ordered)

1. **Dashboard nav: remove the Teams entry (AC1).**
   Delete the `Teams` `NavItem` object at `src/components/dashboard/DashboardNavigation.tsx:59-64`
   from the `Account` group. Drop the now-unused `Users` icon import (line 13) — verify with
   `npm run lint` that nothing else in the file references `Users`.
   Test: a component test rendering `DashboardNavigation` asserts no element with text
   "Teams" exists, and that `Account` group still renders `Settings` and `Billing`.

2. **Dashboard: pin AC3 as a regression test.**
   AC3 is already true (research: zero imports of `TeamSelector`, `InvitationManager`,
   `NotificationCenter`, `SecurityDashboard` outside their own files and
   `collaboration.test.tsx`) — this task adds the missing test, no source change.
   Test: a static-analysis test (grep/`ts-morph`/regex over `src/app/**/*.tsx` and
   `src/app/**/page.tsx`, excluding `__tests__`) asserts none of the four component names
   appear as an import specifier anywhere under `src/app/`. Fails loudly if a future PR
   reintroduces one.

3. **`/dashboard/teams` becomes a redirect (AC2, part 1).**
   Replace the 538-line client component at `src/app/dashboard/teams/page.tsx` with a server
   component that calls `redirect("/dashboard/sites?notice=teams-moved")` from
   `next/navigation`. Delete the team-listing/invite/member-removal body entirely — per design,
   this is real functioning code being removed, not a guard added in front of it.
   Test: a route test (Next.js route handler test or a Playwright/RTL navigation test per the
   existing pattern for redirecting pages in this repo) asserts visiting `/dashboard/teams`
   issues a redirect to `/dashboard/sites?notice=teams-moved` and never renders team UI or a 404.

4. **`/dashboard/sites`: render the "moved" notice (AC2, part 2).**
   In `src/app/dashboard/sites/page.tsx` (already `"use client"`, already imports `Alert`,
   `AlertDescription`, `AlertTitle`, and the `X` icon — no new imports needed), read the
   `notice` search param; when it equals `teams-moved`, render a dismissible
   `Alert variant="info"` above the site list ("Team management has moved — share access from
   a site's own page instead," linking to a site's Share control) per
   `docs/designs/s04-retire-graveyard-surfaces.md`. Dismiss is local component state only (no
   persistence) — clicking the `X` hides the alert for the session; the query param is not
   otherwise stripped. Applies in every list state (loading/empty/error/success), per design.
   Test: renders the alert when `?notice=teams-moved` is present in each of the loading/empty/
   error/success states; renders nothing extra when the param is absent; dismiss removes the
   alert from the DOM.

5. **Widget: drop the Styles/Themes tabs (AC4).**
   In `public/embed/recopyfast.src.js`, remove the two `styles` and `themes` entries from the
   `tabData` array (`:5454-5460`). Remaining order: `elements`, `languages`, `history`.
   Test: extend the existing "slice the real widget and eval it" pattern (see
   `src/__tests__/embed/element-id-page-scope.test.ts` for the established technique — the
   file is a browser IIFE and cannot be `import`ed) to slice the Edit Board tab-bar-rendering
   block, inject a `document`, and assert exactly 3 tab buttons render with ids
   `elements`/`languages`/`history` and no button with id `styles` or `themes` exists.

6. **Widget: close the hidden Styles entry point and delete dead code (AC5).**
   Remove the "🎨 Apply Style" quick-action button at `:5639` (`applyStyleBtn` — the Elements-tab
   button whose `onclick` calls `self.switchTab('styles')`, reachable independently of the tab
   bar removed in task 5 — this is the trap research fact 5 identifies as the real risk to AC5).
   Before deleting, `grep -n "switchTab(" public/embed/recopyfast.src.js` to confirm exactly the
   two call sites already known (`:5466` tab bar, `:5639` quick action) — if a third exists,
   stop and re-scope this task. Then delete the now-fully-dead implementation: `loadStyles`
   (`:5650`), `renderStylesTab` (`:5663`), the `styles/apply` fetch (`:5726`), `loadThemes`
   (`:6026`), `renderThemesTab` (`:6039`), both `themes` fetches (`:6129`, `:6159`), and the
   `case 'styles'` / `case 'themes'` arms in `loadTabData()` (`:5513-5527`).
   Test: (a) the sliced-eval harness from task 5, extended to simulate selecting one or more
   elements, asserts no "Apply Style" button exists in the rendered Elements tab; (b) a
   source-level test asserts the strings `/edit-board/styles/apply` and `/edit-board/themes`
   no longer appear anywhere in `recopyfast.src.js` — the strongest form of AC5, since it rules
   out both the two known and any not-yet-imagined call sites at once.

7. **Rebuild the artifact and verify the staleness gate.**
   Run `npm run build:embed` to regenerate `public/embed/recopyfast.js` from the edited
   `.src.js` (never hand-edit the artifact — `scripts/build-embed.mjs`'s
   `STALE_MARKER = "// @generated-from-sha256 "` mechanism detects a mismatch). Then run
   `node scripts/build-embed.mjs --check` and confirm it exits 0.
   Test: `npm run build:embed -- --check` (or the equivalent documented invocation) passes in
   CI as part of the standard build; a manually staled artifact (edit `.js` without rebuilding)
   is confirmed locally to make `--check` fail, proving the gate is live — this check is
   deleted from the working tree before committing, it is a one-time proof, not a shipped test.

8. **Verify every frozen surface, AC6/7/8, with an explicit diff guard.**
   Run the full existing suites that cover the frozen routes and confirm they pass **and** that
   `git diff main...feature/s04-retire-graveyard-surfaces -- <path>` is empty for each path
   listed under "Run interdicts" below. Specifically: `src/__tests__/api/teams/*.test.ts`,
   `src/__tests__/api/edit-board/cors-credentials.test.ts`,
   `src/__tests__/api/edit-board/staging-token-device.test.ts`,
   `src/__tests__/api/security/events-unauthenticated.test.ts`. Also run any existing test that
   exercises the email-invite path (`InviteEditorForm`, `ShareSiteDialog`, `SiteEditorsCard`)
   and confirm unchanged pass, and confirm the floating-toolbar files
   (`TypographyPanel.tsx`, `ColorPicker.tsx`, `FontSizeSelector.tsx`,
   `TextAlignmentControls.tsx`, `FloatingEditorToolbar.tsx`) show zero diff.
   Test: this task *is* the test — a green run of the listed suites plus a clean `git diff`
   on every interdicted path is the acceptance evidence for AC6, AC7 and AC8. No new test file
   is written for this task; new evidence would be redundant with the frozen tests already in
   the tree, which is the point.

## Run interdicts

One line each, all reviewer-checkable with `git diff main...feature/s04-retire-graveyard-surfaces -- <path>`.

- `src/app/api/teams/**` (all `route.ts` files under it) — diff must be empty.
- `src/app/api/notifications/route.ts` — diff must be empty.
- `src/app/api/security/**` (`events`, `stats`) — diff must be empty.
- `src/app/api/audit/**` (`compliance`, `logs`) — diff must be empty.
- `src/app/api/edit-board/styles/apply/route.ts` — diff must be empty.
- `src/app/api/edit-board/themes/route.ts` — diff must be empty.
- `src/__tests__/api/teams/route.test.ts`, `identity-attachment.test.ts`, `members-embed.test.ts` — diff must be empty.
- `src/__tests__/api/edit-board/cors-credentials.test.ts`, `staging-token-device.test.ts` — diff must be empty.
- `src/__tests__/api/security/events-unauthenticated.test.ts` — diff must be empty.
- `src/components/editor/TypographyPanel.tsx`, `ColorPicker.tsx`, `FontSizeSelector.tsx`, `TextAlignmentControls.tsx`, `src/components/editor/FloatingEditorToolbar.tsx` — diff must be empty (AC6 scope guard: site-wide themes are graveyard, per-element controls are not).
- `src/components/dashboard/InviteEditorForm.tsx`, `ShareSiteDialog.tsx`, `SiteEditorsCard.tsx`, `ShareButton.tsx` — diff must be empty (AC8: the email-invite path shares no code with `/api/teams/*`).
- `src/components/collaboration/TeamSelector.tsx`, `InvitationManager.tsx`, `NotificationCenter.tsx`, `src/components/dashboard/SecurityDashboard.tsx` — diff must be empty; these files are not deleted, only pinned as unreachable (task 2).
- `public/embed/recopyfast.js` — never hand-edited; its diff must be exactly what `npm run build:embed` produces from the `.src.js` diff, nothing more.

## The point everything turns on

**AC5 is not satisfied by removing the tab bar entries alone.** The tab list at `tabData`
(`:5454-5460`) and the `case 'styles'`/`case 'themes'` dispatch in `loadTabData()` are reached
from **two** independent call sites, not one: the tab-bar button loop (`:5466`) and the
"🎨 Apply Style" quick-action button rendered inside the Elements tab whenever one or more
elements are selected (`:5639`). Task 5 alone (removing `tabData` entries) makes AC4 pass —
the tab bar visually shows three tabs — while leaving AC5 to fail under an easily reachable
user action: select an element, click "Apply Style," land on the Styles tab, fire the exact
`/edit-board/styles/apply` request the criterion forbids. Task 6 is what actually closes AC5,
and it is the task most likely to be shipped incomplete if an implementer works only from the
story's own cited line numbers (which name `:5454-5460`, `:5726`, `:6028/:6129/:6159` and never
mention `:5639`).

**Where this could still be wrong:** the plan assumes exactly two call sites to
`switchTab('styles'|'themes')`, per research's grep. Task 6 re-runs that grep immediately before
deleting anything, specifically to catch a third call site introduced since research was
written — if one exists, the task's own instruction is to stop rather than delete around it.
The second, independent safety net is task 6's source-level string test: even if a call site
were missed, deleting the fetch calls themselves (not just their triggers) means no code path
anywhere in the file can still issue the forbidden request — the test asserts on the *absence
of the request-issuing code*, not on the absence of a particular button.

## Files touched

- `src/components/dashboard/DashboardNavigation.tsx` — remove Teams `NavItem` + unused `Users` import.
- `src/app/dashboard/teams/page.tsx` — replaced with a server-component redirect.
- `src/app/dashboard/sites/page.tsx` — add the `?notice=teams-moved` `Alert`.
- `public/embed/recopyfast.src.js` — remove `tabData` entries, the Apply Style button, and the dead styles/themes implementation (source of truth).
- `public/embed/recopyfast.js` — regenerated by `npm run build:embed`; never hand-edited.
- New test files: a `DashboardNavigation` nav-item test (task 1), a static-import-scan test for AC3 (task 2), a teams-redirect test (task 3), a sites-notice test (task 4), and one or two widget tests extending the sliced-eval pattern for the Edit Board tabs (tasks 5–6).

## Test strategy

- Dashboard tasks (1–4): Jest + Testing Library component/route tests, colocated in
  `__tests__/`, following existing patterns in the same directories (`DashboardNavigation` and
  `sites` page already have sibling test files to model against).
- Widget tasks (5–6): follow `src/__tests__/embed/element-id-page-scope.test.ts`'s established
  technique exactly — `recopyfast.src.js` is a browser IIFE keyed off `document.currentScript`
  at parse time and cannot be `import`ed, so tests slice the relevant block out of the real
  shipped file and evaluate it with `jsdom`'s `document` injected. This guarantees the test
  runs the actual shipped code, not a transcription that could silently drift from it.
- Task 6 additionally uses a plain string-absence assertion over the raw file contents
  (`/edit-board/styles/apply`, `/edit-board/themes` must not appear) as a second, independent
  signal that does not depend on correctly identifying every call site.
- Task 7 is a build-tool check, not a Jest test: `npm run build:embed` then
  `node scripts/build-embed.mjs --check`, run locally before commit and already enforced in CI
  per `AGENTS.md`.
- Task 8 runs pre-existing suites unchanged and checks diffs; it adds no new test files by
  design — see task 8's rationale above.

## Definition of Done

- Single PR on `feature/s04-retire-graveyard-surfaces`, structured description, readable diff.
- `npm run lint`, `npm run type-check`, `npm run format` (check mode), `npm run build`,
  `npm test` all green — `npm run build` runs `build:embed` as its documented `prebuild` step,
  so a stale artifact fails the build itself, not just a separate check.
- `node scripts/build-embed.mjs --check` passes explicitly (task 7) — the staleness gate named
  in this story's own interdicts, confirmed green in addition to the build's own prebuild run.
- All eight acceptance criteria demonstrated: AC1–AC2 via the new dashboard tests, AC3 via the
  new static-import-scan test, AC4–AC5 via the new sliced-eval widget tests plus the
  string-absence test, AC6–AC8 via the diff-guard evidence in task 8.
- Every path listed under "Run interdicts" shows an empty diff against `main` — verified as
  part of task 8, re-verified at `/ks-review`.
- No test modified to accommodate this story's behaviour change — every frozen test named in
  the interdicts passes with its original assertions intact.
- Review passed (`/ks-review`), no open critical issue.
