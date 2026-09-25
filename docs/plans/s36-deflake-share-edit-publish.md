---
validated: yes
validated_by: operator-prevalidated user scope (2026-09-25)
---

# s36 — Inline editor save lifecycle

No new screen or design change; preserve the current UI and architecture.

- [x] Add deterministic tests booting the real widget source. Hold a save response
  pending while dispatching Save, Enter and Publish/outside mousedown; assert one
  staging PUT. Complete save/cancel before the 100ms listener timer, advance it,
  publish/clear simulated staging and click outside; assert no resurrected draft.
  Cover a fresh edit after cleanup and recovery after a nonterminal save failure.
  Run these against baseline and record the red result before changing source.
- [x] Repair startTextEdit locally: synchronous in-flight and closed-session save
  guards, retryable failure unlock, cancel/teardown lifecycle protection, cancel
  deferred outside-listener installation, remove session-owned keyboard/paste
  listeners on cleanup. Keep legitimate later edits and failure recovery working.
  No global lock, new abstractions, dependencies or API changes.
- [x] Rebuild embed and run targeted widget suites, preserving all guards.
- [x] Repair the separately reproduced spec readiness race before heading.click:
  the banner and data-rcf-id exist before hydration and edit listeners finish.
  Poll the existing widget isInitialized flag with the default assertion budget,
  retaining every assertion, retry setting and timeout. Baseline local failure at
  share-edit-publish.spec.ts:250 is the red evidence (click before listener).
- [x] Run the share spec with --repeat-each=20 --workers=1 --retries=0
  against disposable loopback services; if unavailable, obtain three consecutive
  green PR E2E jobs. Capture counts and limitations, without credentials.
- [x] Run npm run precommit, npm run build, embed freshness/size, audit:prod,
  production typecheck and formatting checks; record counts and inherited warnings.
- [x] Add only a pending-independent-review placeholder, commit, push and create
  a draft PR with Why / What changed / Decisions / Verification / Risk & rollback.

Implementation ownership: executor subagent; integration, stack and release gates:
leader. Independent review verdict remains a separate reviewer's responsibility.
