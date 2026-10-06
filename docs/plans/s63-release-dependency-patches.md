---
story: s63-release-dependency-patches
validated: yes
---

# Patch the dependencies blocking release

Approved as the security prerequisite in the performance plan the user started with
“ok start” on 2026-10-05. No new dependency, major upgrade, merge or deployment authorization.

- [x] 1. Verify fresh root/server audits and installed paths. Inspect package fix versions
  within existing ranges. Record failing audit baseline before changing either lockfile.
- [x] 2. Apply the smallest non-force dependency fixes to root and server lockfiles. Prefer
  npm-generated resolutions; no hand lock merging, manifest range changes or unrelated churn.
  Verify every patched package resolves and both audit:prod gates pass. Reconcile PR58
  explicitly in report/PR; do not merge/close/edit that PR.
- [x] 3. Run existing focused sanitizer, API, websocket/transport/SSR and Next build checks,
  then full required lint/typechecks/format/test/build/coverage and fixed embed freshness/
  size gates with Node24 and inert CI env. Normal commit/prepush hooks remain enabled.
  No tests merely mirroring the lockfile; existing security/regression suites prove behavior.
- [ ] 4. Independent fresh review and a draft PR with exact patched versions, audit evidence,
  tests, remaining deployment/integration gaps. Keep production untouched. Re-test the combined
  s59/s60/s61/s62 candidate after manual integration before any production approval.

Ownership: package-lock.json, server/package-lock.json and story docs. No product source
change except regenerated embed artifacts if dependency outputs actually differ and size
gates pass; any new behavior or extra dependency is outside this plan.

## Execution evidence

- Fresh pre-change audits exited 1 with root critical/high/moderate/low counts 1/2/2/1 and
  server 0/1/0/1. Fresh post-change production audits exit 0 with zero advisories at every
  severity in both projects.
- `npm ci` installed the patched locks. The production build identifies Next 16.3.8; the root
  and server websocket trees both resolve Engine.IO 6.6.11.
- Nine focused sanitizer, XSS, image/metadata, websocket, transport and SSR-adjacent suites pass
  194 tests. The full suite passes 309 suites and 4,009 tests, with 2 suites and 38 tests skipped.
  Lint has 0 errors and 35 inherited warnings; both typechecks and format pass.
- The normal prepush build and coverage gate passes on the patched dependency tree. Coverage is
  63.70% statements, 56.96% branches, 60.22% functions and 64.31% lines.
- The generated widget and transport remain byte-identical to main. Freshness passes at the
  unchanged ceilings: 45,880-byte bundle, 33,120-byte widget and 13,141-byte transport gzip.
- One first coverage run timed out in an existing websocket staging-room wait. The exact socket
  suite then passed 45/45 under coverage, the focused dependency suite passed 194/194, and the
  unchanged normal prepush rerun passed the complete coverage suite. No test timeout or source
  code was changed to obtain the green run.
