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
- [x] F5. Align PRD, ADR route decision, design notes and status records with /compare routes and
      actual draft delivery; supersede stale blocker statements (m5, m6).
- [x] F6. Run required gates with CI placeholders and official Node embed checks;
      commit fix(s37), push, update existing draft PR #34, preserve review (leader).

## Verification status

Initial implementation `121c9c4` and first fix `ba25a30` are on draft PR #34.
The independent re-review allows shipping with N1 and n1–n7 requested before
merge; narrow fix mode 2 below addresses those items. Its local gates pass:
241 Jest suites / 3,173 tests passed (2 suites / 38 tests skipped), lint 0 errors /
39 inherited warnings, both type-checks, format, build, Node 20 embed check and
zero-vulnerability production dependency audit. Four detail routes now prerender
with 300-second revalidation, also verified in local HTTP cache headers.
The latest focused render suite passes 18/18 after pinning all rendered cells.
Exact evidence is in the research record. Delivery stays draft, with the supplied
review unmodified and uncommitted and no production operation authorized.

## Prevalidated narrow fix mode 2 — 2026-09-25

The operator explicitly authorized N1 and n1–n7 in this run. The review remains
unmodified and uncommitted. No production operation is authorized.

- [x] G1. Restore accepted ADR 020 from main and add next unused ADR 032,
      superseding only the comparison route references in ADRs 012/013/020.
      Record s17's dynamic-route migration and Lighthouse scope inheritance.
- [x] G2. Test-first: scope Duda unlimited clients to Team and higher, with the
      official source quotation recorded in research; correct TinaCMS Git-save,
      optional Editorial Workflow and site-dependent HTML delivery wording.
- [x] G3. Pin every competitor table row independently of production data and
      all disclosure blocks, including the index platform-choice paragraph.
- [x] G4. Use revalidate = 300 on all four detail pages; document the distinct
      comparison database prices and landing Stripe-enriched pricing feed.
- [x] G5. Defer SoftwareApplication JSON-LD to s17's shared schema builders,
      explicitly retaining PRD 329 as outstanding work; no invented fields.
- [x] G6. Reuse the existing site-origin helper; select index rows by key.
- [x] G7. Run CI-placeholder local gates; verify the review checksum; commit
      fix(s37), push and retain draft PR #34. Preserve all story entries if main moves.

The leader owns docs, final gates and delivery. The delegated executor owns only
product code and tests and reports red/green evidence before leader verification.
