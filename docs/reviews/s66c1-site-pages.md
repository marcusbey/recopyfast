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

Max severity: major
Ship allowed: yes
