---
story: s64-rollout-dependency-refresh
validated: yes
---

# Patch new advisories during the authorized rollout

The owner approved merging and production testing, then reiterated the full rollout on
2026-10-06. These minimal existing-dependency patches are a necessary release prerequisite
within that scope. No dependency addition, major upgrade, force update or CI bypass.

- [x] 1. Preserve the fresh red root/server audit evidence and map exact vulnerable paths.
- [x] 2. Resolve only proxy-addr/sharp/source-map-js within unchanged manifests through npm.
     Clean-install root/server; require zero-vulnerability production audits and exact resolution
     evidence.
- [x] 3. Run relevant IP-trust/image/sanitizer/websocket/transport regression checks, then
     all required full statics/tests/build/coverage/hooks. No new tests mirroring lock versions.
     Prove generated artifacts and existing byte ceilings unchanged.
- [ ] 4. Pin source for a fresh independent review, push a draft PR with normal hooks, verify
     hosted CI, then complete the authorized squash merge and production health/deployment. Root owns final
     merge/deploy; implementer stops at source/check evidence and may push only the feature.

Ownership: root+server lockfiles and story docs only. No source, manifests, migrations,
provider/catalogue, customer content or environment change. If a fix needs a major/manifest
change or grows the embed, report that concrete blocker before expanding.

## Execution evidence

- The preserved Node 24 production-audit baseline is root 1 critical / 2 high and server
  1 critical: `proxy-addr` 2.0.7 in both trees, `sharp` 0.35.4 and `source-map-js` 1.2.1.
- npm's non-force lock-only repair resolves root `proxy-addr` 2.0.8, `sharp` 0.35.5 and
  `source-map-js` 1.2.2, plus server `proxy-addr` 2.0.8. Both clean installs and production
  audits pass with zero vulnerabilities; manifests and application source remain unchanged.
- Twelve focused IP, sanitizer, image, metadata and WebSocket suites pass 260 tests. Full
  precommit passes 309 suites / 4,009 tests with the existing 2 suites / 38 tests skipped;
  lint has zero errors and 35 inherited warnings. Format and both TypeScript checks pass.
- The production build and full coverage gate pass. Coverage is 63.70% statements, 56.96%
  branches, 60.22% functions and 64.31% lines. The embed remains byte-identical to main at
  45,880-byte bundle, 33,120-byte widget and 13,141-byte transport gzip ceilings.
- The first full coverage run hit the existing 100 ms `MemoryRateLimiter` wall-clock test
  after its window had already elapsed under suite load. The exact instrumented suite then
  passed 21/21 and the unchanged full prepush rerun passed all 4,009 tests. No test timeout,
  test source or product source changed to obtain the green run.
