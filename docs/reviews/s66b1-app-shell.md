# Review — s66b1-app-shell

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s66b1-app-shell`
(merge-base `d4dae46`; commits `0a0824d`, `b1df6eb`, `e069843`).

## Verdict summary

Plan Part 1 tasks 2–5 done as written; tasks 1 and 6 wait on the harness's first run. Run interdicts hold (no
s66c-owned file, no API/DB/embed/server change, no dependency, `globals.css` 0 removed lines, one copy change).
The ADR 053 contract matches what s66c's validated plan expects (slots, data attributes, DOM order, nav
placement, guard rules, shrink-only pending list). Full jest 356 suites / 4,587 tests, type-check (both),
format, lint (0 errors), build green; the grid-area classes and `.text-page-title` are in the built CSS.
15 mutations: guard and component rules bite; gap (M7), page-level max-w (M4) and Analytics loading (M11)
are not caught.

## Findings

### Major

- M-1 — `src/app/dashboard/billing/page.tsx:95`: Billing keeps the page-level `min-h-screen bg-surface-1`
  wrapper (the research's "darker inset band"; ADR 053 "never wrap PageShell"); the band now sits flush at the
  content edge and forces ~120 px of empty scroll on short states. Fix: a fragment.
- M-2 — `src/components/billing/BillingDashboard.tsx:198`: the no-plan h2 keeps `text-2xl font-semibold`
  (24/600), the h1's size — every unentitled account sees two stacked titles. Fix: the panel-title scale.
- M-3 — `e2e/app-layout.spec.ts:979`: the harness behind AC 2, 4, 5 has never run (no red-first run). CI's
  blocking E2E job (strict 60) is its first run; merge only on 60/60.

### Minor

- m-1 — `page-header.tsx:14` `title: string` vs s66c's "Site layout loading" state: s66c uses a text title
  ("Loading site…") — decided by the orchestrator, keeps the h1 accessible; no API change.
- m-2 — the 24/16 gap and the actions' drawn position have no automated proof (M7 0 red); AC 1 claims both.
- m-3 — `AnalyticsDashboard.page-shell.test.tsx:93-101` "still loading its sites" passes vacuously (M11).
- m-4 — Billing title/description duplicated between the server fallback and the client component, unpinned;
  the fallback lacks the TrialStatusCard skeleton (body shift).
- m-5 — `playwright-ci-contract.test.ts` 56→60 must be named in the PR.
- m-6 — `dashboard/page.tsx:194`: the empty "Activation checklists" section still takes a flex slot (gap
  doubles for zero-site accounts).
- m-7 — `ContentFilterBar.tsx:64,83`: selects keep content width below 640 (design §4: full width).
- m-8 (pre-existing) — classic-scrollbar column shift between scrolling and non-scrolling pages.

## Not verified

The four harness tests in any browser (read-checked only); Billing at 375 ready state; which Billing state CI
renders under placeholder Stripe keys; visual checks (band, no-plan, zero-site Overview, mobile toggle, focus
ring); actions/gap drawn positions; screen-reader order; Suspense → client hand-off.

## Orchestrator note

Owner standing rule: fix majors and cheap minors before shipping. M-1, M-2, m-2, m-3, m-4, m-6, m-7 and m-8
(`scrollbar-gutter: stable` on `html`, decided by the orchestrator as low-risk) go to a fix run; M-3 is resolved
by the PR's E2E job; m-5 goes in the PR body.

## Verification of fix `43267c5` (fresh reviewer, 2026-10-08)

M-1, M-2 and m-2..m-7 fixed; each mutation turns a test red (billing wrapper, no-plan heading size, copy module
"use client", Analytics loading, empty activation section, filter selects, shell gap). m-8 left as a logged
follow-up — the reasoning holds (a reserved gutter makes react-remove-scroll-bar add body margin-right on every
Radix scroll lock). Full jest 357 suites / 4,598 tests, type-check green.

## M-3 resolved by CI (2026-10-08)

PR #70 CI run 37822702057, E2E job: 60 passed, 0 failed/skipped/flaky, including "s66b app pages" @375, @768,
@1280, @1920 against the real Supabase stack (header 56, no sideways scroll, one h1, left edge per width,
section edges, gap/actions rhythm, contrast in both themes).

## PR #70 bot review (Devin) and fix `10e5d16`

Devin (yellow): the dashboard `loading.tsx` and `error.tsx` fallbacks replace the routed page, so no PageShell
and no h1 while a route is pending or after a throw. Fixed: both render through `PageShell` ("Loading…",
"Something went wrong") with one h1; the page-shell guard now requires `<PageShell` in dashboard fallbacks
(red on the old files); 4 new tests. Full jest 358 suites / 4,604 tests green.

Max severity: minor
Ship allowed: yes
