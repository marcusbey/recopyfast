---
validated: yes
---

# s22 — Production dependency security

Validated by the user's "looking good" reply to the explicit plan/conditional security-PR
merge question on 20 September 2026 UTC. Scope matches the presented proposal. No UI design
or architectural change. Implementation is delegated; final review must be fresh-context.

## Tasks

- [x] Record the seven-package baseline and isolate feature/s22-production-dependency-security
      from ee3942dd. Add the story and research. Keep root user edits untouched.
- [x] Capture the existing failing production audit as the red regression gate before editing.
- [x] Apply targeted root manifest/lockfile updates: Next16.3.3, Sharp0.35.4,
      browserslist4.28.7, fast-uri3.1.7, baseline-browser-mapping2.11.0, fflate0.8.3
      and nested0.6.11, qs6.16.0 (or strictly necessary patched compatible transitive resolutions).
      Raise Next/Sharp declared floors. Preserve unrelated direct versions and the server/ tree.
      Include the same fast-uri patch as PR16 without modifying/closing that PR during development.
- [x] Prove clean install and green production audit (zero high/critical; aim zero total),
      native Sharp load/benign image operation, both typechecks, lint, format, unchanged embed
      artifact/byte gate, production build and full tests/coverage. Use safe dummy test config.
- [x] Run representative local public-image and login/editor route smoke checks on the new
      Next minor. Do not send exploit payloads or use production credentials in test fixtures.
- [ ] Commit one implementation story with docs; obtain independent review and run real CI.
      Do not count a skipped Playwright job as E2E evidence. No audit thresholds/test expectations
      weakened, no force audit fix, new dependencies, feature changes, migration, pricing or secrets.
- [ ] Release phase (leader): after review and CI pass, use the granted security-PR merge
      authority to squash-merge and verify exact Vercel production commit. Then integrate main into
      PR17/18 without force push and rerun their gates before the already-authorized merges.
- [ ] Release phase (leader): replay actual Compozit production owner/editor Save/Publish/fresh
      visitor, scope denial and revoked-session recovery; restore disposable copy and retain laptop
      access. Real payment needs a specific approved amount; label test-mode proof as test-mode.

## Files, risks, rollback

Product diff limited to root package.json and package-lock.json; pipeline docs accompany them.
Stop and report if compatibility requires application-source edits. Keep all other direct
dependencies and Fly server deployment unchanged. Inspect incidental lockfile changes.
Preserve pre-release deployment for emergency rollback; returning to vulnerable dependencies
does not resolve the security issue. Never deploy the private QA evidence directory.

Done: passing audit and regression gates on reviewed commits plus exact deployed/live proof;
local tests alone do not prove physical second-device or paid entitlement behavior.

## Implementation verification — 20 September 2026 UTC

The pre-change `npm audit --omit=dev --audit-level=high --json` failed with seven production
findings: one critical, three high and three moderate. After the targeted update it reports zero
findings at every severity. Clean `npm ci` installs passed for both the root and `server/`; the
server manifests remained byte-identical.

The compatible lockfile resolved the requested patched floors to the newest versions allowed by
their existing semver ranges: Next 16.3.5, Sharp 0.35.4, browserslist 4.29.0, fast-uri 3.1.8,
baseline-browser-mapping 2.11.25, fflate 0.8.3 plus the retained nested 0.6.11 line, and qs
6.16.0. Incidental changes are only the packages those upgrades require: Next SWC/env packages,
Sharp platform/libvips packages, browser compatibility data/helpers, `@swc/helpers`, and qs
side-channel helpers. No application source, server dependency, CI threshold or test expectation
changed.

Node 24.14.0 verification passed: Sharp performed a benign 2x2 SVG-to-PNG conversion; both
TypeScript checks passed; ESLint reported zero errors and 39 inherited warnings; formatting and
the generated embed freshness check passed; the embed remained byte-identical at 46,664 B bundle
and 33,853 B widget gzip under the existing Node gate; the Next 16.3.5 production build passed;
the complete Jest and coverage runs each passed 204 suites and 2,676 tests, with one suite and 36
tests explicitly skipped. Coverage remained above the configured ratchet (52.55% statements,
45.29% branches, 48.45% functions and 52.92% lines).

The leader's local production-server smoke on port 3217 passed: `/login` and `/edit` returned
200 and the sign-in UI rendered in a browser; `/dashboard/sites` returned the expected 307 login
redirect; `/opengraph-image` returned a 62,015-byte PNG; the Next image optimizer returned a
9,740-byte PNG; and `/embed/recopyfast.js` returned the unchanged 171,296-byte JavaScript
artifact. These checks used only dummy local configuration and benign public requests.
