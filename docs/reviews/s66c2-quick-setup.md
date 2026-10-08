# Review — s66c2-quick-setup

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s66c2-quick-setup`
(`828970c` → `a23b6f5`, one story commit, 30 files).

## Verdict summary

All 6 plan tasks present: InstallStep extracted (`SiteRegistrationModal.test.tsx` untouched, green); QuickSetup
replaces ActivationChecklist; live flip and "done means Live"; `/dashboard` summary rows; ApiKeysPanel takes an
optional `siteId`; e2e added, Playwright contract 78 → 80. Nothing outside the plan. Run interdicts hold
(`git diff -- src/app/api supabase public/embed server` empty; no new `fetch(`; `ui/**`, `page-shell.tsx`,
`Breadcrumbs.tsx`, `jest.config.js`, `package.json`, marketing untouched; no web storage; account Settings ›
API Keys tab kept; one commit). ADR 050/051/052 (+ amendment)/053 respected; page-shell guard R1–R7 green.
Captures match the mockup at 375 and 1280 with fixture data only.

Gates (run by the reviewer): Jest 374 suites / 4,854 passed (2 suites / 38 tests skipped, pre-existing); the 18
story and guard suites 314/314; `type-check` and `type-check:build` exit 0; Playwright `--list` 80 in 14 files;
ESLint on changed files 0; `format:check` green. 15 mutations, all bite (M1–M15: installed-by-status clause,
finish requires install, current step, dismissed on panel and row, finished on row, Overview admin gate,
dashboard admin filter, panel `siteId`, POST `siteId`, site select hidden, Setup complete header, step-3
actions after step 2, stepper grant, status row step state).

## Findings

**M-1 (major) — focus falls to `<body>` when the invite finishes setup.** `QuickSetup.tsx:320-326`, `:342-350`.
The focus target is the region `div` with `empty:hidden`. Live site, no editors → Add editor → add with Publish
→ `invited` true → the panel returns null → the region is empty and `display:none` → on Close
`surfaceRef.current.focus()` does nothing. Reproduced in real Chromium (`focus()` on an empty `empty:hidden`
region leaves `document.activeElement === BODY`). The comment at `:345-349` promises the opposite; on main this
case showed a completion card, and the s35 review pinned the behaviour ("C5 region focus fallback"). No test
catches it: jsdom applies no CSS, and the unit test revokes the editor before closing.

**m-1 — "Edit website is disabled until step 2" is unreachable as written; the deviation is accepted.** Only the
current step expands (AC 1) and the current step is the first incomplete one, so step 3's actions only render
after step 2 is done. Matches the mockup (step 3 collapsed to its title and one line before install). Amend
`docs/stories.md:2811`, `docs/plans/s66c2-quick-setup.md:49`, `docs/plans/s66c-site-page-and-access.md:366`,
`docs/designs/s66c-site-page-and-access.md:127-128` to: "Edit website and Add editor appear when step 3 becomes
current, once step 2 is done. Before that, step 3 shows only its title and one line." The test comment at
`QuickSetup.test.tsx:571-579` ("would show the owner nothing") is wrong — s66c1's header Edit website is enabled
while the site awaits install.

**m-2 — the activation hook polls after the panel is gone.** `useSiteActivation.ts:103-105` stops only when
installed, invited and published are all true; the panel finishes at installed plus invited-or-published. Same
request count as main for that state, but the requests now serve nothing on screen.

**m-3 — per-site API keys panel not admin-gated in the UI.** `sites/[siteId]/settings/page.tsx:78`. A
non-admin member sees "Generate Key" and always gets 403. Server enforces admin; `useSiteContext().isAdmin` is
available.

**m-4 — "is live" header for a stale site.** `QuickSetup.tsx:60-62`, `:428-431`. A `stale` site counts as
installed, so the header says "… is live" while the badge says Stale.

**m-5 — summary-row error is danger text, not `Alert variant="destructive"`.** `QuickSetup.tsx:189-207`.
Defensible inside a list row.

**m-6 — e2e hunk not Prettier-formatted.** `e2e/site-pages.spec.ts:550-554` (`format:check` covers `src/**`
only).

**m-7 — labelling nits.** `QuickSetup.test.tsx:23` says "`git mv`'d" (git records delete + add); the new e2e sits
inside `describe("s66c1 site pages")` (`e2e/site-pages.spec.ts:165`).

## Not verified

The e2e was listed, not run (no local Supabase/server) — CI runs `site-pages.spec` at 375 and 1280. Real-app
focus after the finishing invite (mechanism reproduced only). `/dashboard` with every admin site finished
(`:empty` never rendered in a browser). Real `/activation`, `/api-keys` and edit-session endpoints (mocked).
Non-admin on Settings (m-3). `npm run build` and full `npm run lint` (CI).

Max severity: major
Ship allowed: yes
