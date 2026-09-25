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
  claim boundaries from research. No pricing API fallback; dated editorial prices
  link to current `/#pricing`, Founding is conditional on availability. Each page
  needs its own useful comparison and integration advice, not noun substitution.
- [x] 3. Test then add all five sitemap entries and landing footer discovery. Preserve
  all previous route/blog tests, and test footer links and sitemap under DB failure.
  No Playwright changes, no schema/dependency/embed changes.
- [x] 4. Targeted tests green, changed-file formatting and type/lint checks. Update
  research with exact evidence and docs/reviews/s37-comparison-pages.md containing
  only “pending independent review”.
- [ ] 5. Leader verification: npm run precommit (lint/type-check/full Jest), build,
  node scripts/build-embed.mjs --check, npm run audit:prod; report exact counts.
  Use CI placeholder runner, low concurrency; rerun unrelated timeout-only failures
  without changing test behavior/timeouts. Record any inherited format/lint issues.
- [ ] 6. Leader delivery: inspect status/diff, one conventional commit, push branch,
  draft PR with Why / What changed / Decisions / Verification / Risk & rollback.
  No review verdict, ready-for-review, merge, deploy or remote migrations.

Implementation ownership: delegated executor owns product files/tests and can update
plan tasks 1–4. Leader owns final gates, docs integration, commit, push and draft PR.

## Verification status

Implementation and browser verification complete. Task 5 was executed but remains
unchecked because the inherited local DB function-grants assertion still fails.
All other required checks pass; exact commands/counts are in the research record.
Task 6 is blocked by the user's green-before-push rule. No gate bypass, commit or
external delivery attempted; independent review placeholder is intact.
