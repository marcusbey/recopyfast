---
story: s60-public-content-timing
validated: yes
---

# Improve published copy loading time

## Outcome

Reduce the roughly 0.9–1.3 second measured wait between initial paint and published
content availability on the aicompoz.com hero. Focus on the two avoidable backend
round trips first. This shortens the swap window; it does not promise zero flash.

## Tasks

- [x] 1. Add a test proving a content response does not wait for a deliberately
  pending liveness write. Schedule the existing best-effort write using Next
  after only for successfully authorized widget reads. Test one deferred write,
  none for dashboard/auth/read failures, and unchanged response/CORS on write error.
- [x] 2. Add optional exact-count pagination tests. Only page-scoped public content GET requests
  an exact count; stop when the latest reliable count is exhausted.
  Use later growing counts so concurrent inserts do not truncate an existing tail.
  If a later count is missing/invalid, revert that scope to empty-page termination.
  Preserve unknown/invalid-count fallback, capped pages, empty termination,
  returned rows, per-scope counts, ordering and error propagation. Compare count
  cost with the removed empty query; keep the optimization only if it helps.
- [ ] 3. Run targeted route/helper tests, full repository checks and independent
  review. Assert no widget/auth/CORS/plan/staging changes and no dependencies added.
  Keep failing baseline security audits visible rather than bypassing them.
- [ ] 4. Benchmark matched before/after visitor reads (at least five each) on the
  same content/path and comparable cache/network conditions. Record response
  median/range, paint-to-response timing, correct hero text, and failure fallback.
  Open the reviewed PR. After authorized merge/deploy and passing release gates,
  verify the exact deployed revision and repeat the public hero check.

## Boundaries

No source-copy hardcoding on aicompoz.com, CDN cache, SSR bridge, schema migration,
new endpoint, whole-page hiding, auth changes, or widget startup refactor. If API
latency remains dominant after these changes, report the measurements and propose
the next bounded change instead of expanding the work silently.

## Required checkpoint

The user validated this plan: "Validate the plan and implement".
Implement in TDD on feature/s60-public-content-timing. Merge remains manual and
the existing dependency-security gate must be cleared before release.
