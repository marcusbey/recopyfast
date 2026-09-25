---
validated: yes
validated_by: operator-prevalidated-user-scope
validated_at: 2026-09-25
---

# Plan — s37-comparison-pages

Scope and decisions were explicitly prevalidated in the task. Follow research and
design records. Branch `feature/s37-comparison-pages`; draft PR only.

- [x] 1. Write failing render tests for the index and each explicit competitor route.
     Assert distinct short answers/headings, fair best-fit sections, table semantics,
     dated official citations, signup/try and all sibling links. Parse FAQPage JSON-LD,
     require every Question/Answer to match visible FAQ content. Assert unique canonical
     and OG metadata. Run red before implementation.
- [x] 2. Add typed comparison content and shared server renderer with four thin static
     route wrappers plus index. Use verified external sources only and exact ReCopyFast
     claim boundaries from research. No pricing API fallback; ReCopyFast offers read the live catalogue and availability,
     respect the Agency switch and link to `/#pricing`. Only competitor facts are dated. Each page
     needs its own useful comparison and integration advice, not noun substitution.
- [x] 3. Test then add all five sitemap entries and landing footer discovery. Preserve
     all previous route/blog tests, and test footer links and sitemap under DB failure.
     No Playwright changes, no schema/dependency/embed changes.
- [x] 4. Targeted tests green, changed-file formatting and type/lint checks. Update
     research with exact evidence. The initial placeholder was replaced by the reviewer;
     fix mode must preserve that uncommitted review byte-for-byte.
- [x] 5. Leader verification: npm run precommit (lint/type-check/full Jest), build,
     node scripts/build-embed.mjs --check, npm run audit:prod; report exact counts.
     Use CI placeholder runner, low concurrency; rerun unrelated timeout-only failures
     without changing test behavior/timeouts. Record any inherited format/lint issues.
- [x] 6. Leader delivery: inspect status/diff, one conventional commit, push branch,
     draft PR with Why / What changed / Decisions / Verification / Risk & rollback.
     No review verdict, ready-for-review, merge, deploy or remote migrations.

Implementation ownership: delegated executor owns product files/tests and can update
plan tasks 1–4. Leader owns final gates, docs integration, commit, push and draft PR.

## Prevalidated fix scope — 2026-09-25

The operator explicitly authorized this fix run for draft PR #34. Preserve the
uncommitted independent review byte-for-byte; it remains the reviewer's property.

- [x] F1. Test-first: correct Duda billing/client-account claims and Webflow's shared
      draft/publish behavior (C1, m1, m2), using the cited official evidence.
- [x] F2. Disclose browser-applied published edits, original HTML for no-JS visitors
      and crawlers, competitor served-HTML advantage, and source updates for SEO-critical
      copy in every comparison table and competitor-choice section (M1).
- [x] F3. Replace ReCopyFast editorial prices with live catalogue/availability data,
      honoring the Agency switch, sold-out and unavailable states. Keep a centralized
      dated snapshot only for competitor facts and explain the boundary (M2, m8).
- [x] F4. Strengthen editor-access, live-price and exact FAQ answer regression tests;
      derive sitemap entries from comparisonList; fix titles, BreadcrumbList,
      aria-current and signup UTM attribution (m3, m4, m7, m9).
- [x] F5. Align PRD, ADR 020, design notes and status records with /compare routes and
      actual draft delivery; supersede stale blocker statements (m5, m6).
- [x] F6. Run required gates with CI placeholders and official Node embed checks;
      commit fix(s37), push, update existing draft PR #34, preserve review (leader).

## Verification status

The original verification history is superseded by this fix run's results.

Initial implementation was committed as `121c9c4` and pushed to draft PR #34.
The previous statement that no delivery occurred was stale; the research record
now separates the initial failed local run from the reviewer's subsequent green
run. Fix-mode gates pass: lint/type-check, 236 passing Jest suites / 3,111 passing tests
(2 suites / 38 tests skipped), format, build, official-Node embed and zero-vulnerability
production audit. Browser evidence covers 15 route/viewport renders. The focused
fix commit is prepared for the existing draft PR #34; no production operation is
authorized. The independent review stays blocked and untouched until its owner
reassesses the new commit. Exact evidence is in the research record.
