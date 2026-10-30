---
validated: yes
story: s127-embed-current-script
---

# Plan — Story s127-embed-current-script

Validation source: owner in chat, 2026-10-28 ("Validate" on the s126–s128 plan checkpoint, Codex-authored plans).

Branch: `feature/s127-embed-current-script`
Research: `docs/research/s127-embed-current-script.md` — read it first.
Execution was authorized by the owner on 2026-10-28. The validated approach secures both
getters and keeps the legacy public URL working.

## Target story

Close audit H3 in the canonical widget and legacy loader without breaking genuine snippets or
letting invalid script identity throw into the host page. Acceptance is in `docs/stories.md`.
No UI design or ADR is needed: preserve existing configuration and loading architecture.

## Tasks (ordered)

1. [x] **Red: capture the startup boundary.** Extend startup Jest coverage and add
       `legacy-loader-current-script.test.ts`. Plant one and two named images with attacker
       src, endpoint attributes and copied dummy site identity. Test native-getter success with
       a real script, null, image/collection results, absent getter and throwing getter.
       Assert no escaped exception, API/WS calls or legacy insertion on refusal; unchanged
       authored copy and credentials/storage/URL on early return. Successful cases assert
       genuine configuration and nonzero expected calls, not merely absence of attacker calls.
2. [x] **Green: canonical capture.** In `recopyfast.src.js`, synchronously call the prototype
       getter inside a narrow try/catch, require `instanceof HTMLScriptElement`, return silently
       on failure before reading configuration. Keep duplicate-instance handling and existing
       endpoint precedence. Add an H3 incident comment explaining why ordinary property access
       and tag-name checks are insufficient. Run the targeted startup cases.
3. [x] **Green: legacy compatibility.** Apply the same guarded capture in
       `recopyfast-secure.js` before creating a script. Keep sibling URL/query replacement and
       non-src attribute forwarding, with explicit nonce preservation if the browser hides its
       attribute value. Test valid canonical handoff, query preservation, data attributes,
       nonce, async/defer attributes, and one/two clobbers. Invalid identity inserts nothing;
       never delete the public legacy URL or redirect it to a fixed production origin.
4. [x] **Restore realistic unit setup.** Adapt existing boot fixtures that fake an own
       `document.currentScript` to a scoped `Document.prototype` getter spy returning a real
       script (restore descriptors/spies after each test). Retain their assertions and exercise
       them against the hardened source. Leave extracted-function tests alone unless needed.
       Run all `src/__tests__/embed` tests. Explain fixture-only changes in the later PR.
5. [ ] **Red/green browser proof.** Add `e2e/embed-fixture/current-script.spec.ts`, serve the
       legacy loader locally, and add opt-in adversarial markup before the fixture script.
       Test zero/one/two named images for canonical and legacy entry points with actual classic
       script execution; assert native accessor vs named-property behaviour. Capture all fetch,
       WS and script requests with synthetic credential sentinels; intercept/abort every
       non-loopback destination. Prove a stored grant, fragment edit code and handoff code use
       only genuine configured endpoints, with no host pageerror or attacker script execution.
       Distinguish harmless planted-image requests from widget/script/credential exfiltration.
       Keep a normal edit/publish journey. Demonstrate new attack cases fail on baseline bytes
       and pass on the rebuilt fix without weakening assertions. Update strict fixture count
       and its release-gate pin to the exact new count; leave existing seven cases intact.
       **Status: done 2026-10-29 by Claude outside the sandbox.** Built-embed Playwright 13/13 green; baseline red proof against origin/main artifacts: the 4 clobber cases (canonical+legacy × 1,2) fail, the 2 zero-clobber controls pass. The owner assigned
       browser execution to Claude on 2026-10-28; this resume must not launch Playwright/Chromium.
6. [x] **Build and verify the non-browser gates (owner's resume scope).** Rebuild with `npm run build:embed`; run
       `node scripts/build-embed.mjs --check` and the size-gate tests. Record before/after Node
       zlib sizes. Run targeted Jest, lint, both type checks,
       format check, full Jest and coverage, then a build using dummy/local configuration only.
       Inspect the scoped diff and collect evidence. Browser fixture execution remains in task 5;
       independent killer-saas review is required before any later PR. No production validation.

## Run interdicts

- No implementation until this frontmatter is validated by the owner. Phase 1 edits only the
  story, research, plan and unchanged audit copy, then commits and stops: no push or PR.
- Never access production, read `.env*`, call Supabase/Fly/Vercel/Stripe, or run deployment,
  catalogue checks, migrations or provider-connected E2E. Use synthetic credentials and local
  stubs; a build needing real services is a blocker, not permission to connect.
- Keep `supabase/**`, `server/**`, `src/app/api/**`, billing and authorization modules unchanged;
  in particular do not touch s125's tables or `src/app/api/edit-board/styles/*`.
- Do not edit migrations, add dependencies, rewrite history, stash, or skip hooks.
- Do not hand-edit generated JS, raise `MAX_*` ceilings, disable strict fixture accounting,
  lower coverage floors, or delete/skip existing tests. No unrelated byte-saving refactor.
- No fallback to `document.currentScript`, `querySelector`, the last script tag, or host-named
  globals for identity. No prototype mutations in production code; test spies are restored.
- Preserve public URLs, data-attribute endpoint overrides and credential transport semantics;
  L7 is excluded. Do not broaden this to defend against arbitrary executing host JavaScript.

## The point everything turns on

The native getter must identify the executing classic script before any untrusted configuration
is consumed. Compare the real browser result against the direct property under one/two named
images; compare the fake unit setup against that browser proof; compare the legacy loader's
inserted script and copied nonce/data attributes against a normal install. A native getter that
returns null in an eval-based test must cause refusal, not a fallback introduced to satisfy a
synthetic fixture. The generated artifact and loader must both be tested, not just source text.

## Files touched

Current phase: `docs/stories.md`, this plan, `docs/research/s127-embed-current-script.md`, and
`docs/reviews/security-audit-2026-10.md` (unchanged supplied audit).

Later execution:

- `public/embed/recopyfast.src.js`, `public/embed/recopyfast-secure.js`.
- `public/embed/recopyfast.js` generated; `socket.io-client.min.js` only if the build changes it,
  with any unexpected transport diff investigated before inclusion.
- `src/__tests__/embed/embed-startup-config.test.ts`, new
  `src/__tests__/embed/legacy-loader-current-script.test.ts`, and existing boot-test setup
  identified by `rg currentScript src/__tests__/embed` (no behavioural assertion weakening).
- `e2e/embed-fixture/current-script.spec.ts` (new), `fixture-page.ts`, `servers.ts`, and
  `stub-api.ts` only for synthetic credential response/capture support.
- `playwright.embed.config.ts`, `src/__tests__/ci/release-gates.test.ts` for exact test count.
- Story progress and subsequent `docs/reviews/s127-embed-current-script.md`.

## Test strategy

Jest models accessor failures and configuration/credential sinks with scoped mocks. Real Chromium
proves DOM named access using markup, parsing order, native accessor and script insertion, through
the s06b local two-origin harness. Inspect both error events and actual requests. Use non-`test_`
synthetic edit/staging values so localhost's demo bypass does not skip validation. Store grants
under the genuine site's key and verify meaningful positive requests. CORS responses are stubbed
locally; no production credentials or traffic. Re-run the existing edit/publish and fidelity/CLS
suite with its normal fixture unchanged. Browser launch failure is an explicit verification gap,
never a passing claim. Size/staleness checks apply to committed build bytes.

## Definition of Done

Phase 1 was committed at `da839bfd`; owner validation then changed this plan to `validated: yes`.

Later implementation: acceptance cases pass; genuine configuration and legacy compatibility
hold; built bytes fit unchanged ceilings; lint, type-check, type-check:build, format:check, full
Jest/coverage, local fixture and build pass with evidence. Independent review ends with the exact
`Max severity: ...` and `Ship allowed: yes` lines before a PR. Merge and production deployment
remain separate owner-controlled steps and are not claimed by local checks.

## Open questions for the owner

Answered by the owner on 2026-10-28: retain the legacy sibling loader, secure both getters, and
keep the public legacy URL working.

## Historical execution blocker — 2026-10-28

Tasks 1–4 are complete. The six-case local browser fixture is authored and the strict inventory
is 13, but Chromium cannot launch in this sandbox: `MachPortRendezvousServer: Permission denied
(1100)` occurs before any test body. Therefore task 5 has no observed browser red/green result.
The built guard measures 45,803 B gzipped against the unchanged 45,801 B ceiling (widget 33,026 B
against 33,044 B), so task 6 also remains open. The standalone transport file is byte-identical
to `HEAD`; its independent Node 24 measurement remains 13,122 B. No commit is allowed while
these two gates are unmet under that run's instructions. The owner's resume instruction below
supersedes this commit restriction and assigns browser execution separately.

### Final local validation evidence

- Startup/legacy red: 11 expected failures before the guard (`/tmp/s127-task1-red.log`).
- Final targeted startup/legacy run: 2 suites, 26 tests passed; 16 cases are new in this story
  (the eight canonical refusal/clobber cases and eight legacy compatibility/refusal cases named
  in `docs/stories.md`); the other 10 retain existing startup behavior
  (`/tmp/s127-targeted-final.log`).
- Behavioral embed run excluding the build-only stale-artifact suite: 27 suites, 365 tests passed
  (`/tmp/s127-task4-embed-behavior.log`). Strict release inventory: 22 tests passed and the embed
  fixture count is 13 (`/tmp/s127-fixture-count.log`).
- `npm run lint`: exit 0, 34 existing warnings and zero errors
  (`/tmp/s127-gate-lint-final.log`). `npm run type-check`: exit 0
  (`/tmp/s127-gate-type-check.log`). `npm run type-check:build`: exit 0
  (`/tmp/s127-gate-type-check-build.log`). `npm run format:check`: exit 0
  (`/tmp/s127-gate-format-check-final.log`).
- Browser fixture: all six new cases were blocked before their bodies ran because Chromium could
  not register `MachPortRendezvousServer` in this sandbox (`Permission denied (1100)`); no
  behavioral browser red/green is claimed (`/tmp/s127-task5-browser-red.log`).
- Final artifact is up to date, but `build:embed`, `build:embed --check`, the size suite and
  `npm run build` exit 1 because the bundle is 45,803/45,801 B gzipped; the widget is within its
  own ceiling at 33,026/33,044 B (`/tmp/s127-build-final-up-to-date.log`,
  `/tmp/s127-build-check-final-up-to-date.log`, `/tmp/s127-size-gate-final.log`,
  `/tmp/s127-gate-build.log`).
- Full Jest with coverage exited 139 before totals were printed. It reported the then-stale size
  artifact, the known contended 2 MB extraction timing case and one unrelated `ChangesView`
  timeout (`/tmp/s127-gate-jest-coverage.log`). The `ChangesView` case passed focused (1/1,
  `/tmp/s127-classify-changes-view.log`); the extraction case still refused `too_complex` on two
  focused retries (`/tmp/s127-classify-extract-timing.log`,
  `/tmp/s127-classify-extract-timing-retry2.log`). The artifact was rebuilt afterward, producing
  the current up-to-date 2 B size failure above.

## Owner-directed resume — 2026-10-29

The owner authorized a hook-checked WIP commit, rebase onto `origin/main`, a bounded byte trim
without changing either ceiling, and one final story commit after all non-browser gates. This
overrides the earlier prohibition on history rewriting for this unpublished branch only. No
push, PR, production access, environment files, stash, other worktrees, or browser execution.
Browser red/green and fixture execution remain Claude's pending work, not a commit prerequisite
for this handoff. Independent review remains required before any later PR.

- Saved all implementation work in WIP `f3d02cb9` after the normal hook passed: lint (34 existing
  warnings), type-check, format check, 574 Jest suites / 8,587 tests passed; one suite / two tests
  were already skipped. The first attempt exposed the other fixture-count pin in
  `playwright-ci-contract.test.ts`; it now requires exactly 13, matching the six new browser cases.
- Fetched main at `5efbc0ff` (s125/#127 and s126/#128). Replayed docs commit `da839bfd` as
  `35d5a544`: kept main's H1/M1 audit resolution notes and all s125/s126 stories, then appended
  s127. The audit is now inherited from main rather than re-added by the docs commit.
- The source and `content-attributes.test.ts` merged automatically. The generated embed
  conflicted and was replaced only by `node scripts/build-embed.mjs`, never hand-merged.
  s126's `uploadImage` implementation and `languages-images.spec.ts` are retained unchanged.
- Fresh Node 24.14.0 gzip measurements: initial bundle 45,803 / 45,801 B; first trim 45,799 /
  45,801 B. Rebuilt after rebase: bundle 45,827 / 45,801 B, widget 33,049 / 33,044 B. The first
  trim passes endpoint values directly into `configuredEndpoint`, removing the redundant
  dynamic `window[name]` lookup while retaining origin checks and attribute fallback.
- Final startup trim: `configuredEndpoint` only validates an already-read string global; the
  two call sites retain the script-attribute fallback. Unused catch bindings are omitted. The
  one deliberate diagnostic change is removing `ReCopyFast: set data-api-url.`; it was not a
  duplicate warning. Missing-API configuration remains falsy and existing guards still no-op.
  No upload logic, credential transport, public URL, byte ceiling, or threshold was changed.
- Rebased final bytes: bundle 45,800 / 45,801 B (1 B headroom), widget 33,022 / 33,044 B
  (22 B headroom), transport 13,141 B unchanged. The second trim saves 27 B on each gated
  measurement. The rebuilt artifact passes `--check`.
- s126 added an upload fixture that still used an own `document.currentScript` getter. It now
  uses the same restored prototype getter spy as the other s127 fixtures; all upload credential
  assertions are unchanged. Startup, legacy, size and upload suites pass: 4 suites / 38 tests.
- Final full Jest with coverage: 579 suites and 8,621 tests passed out of 580 suites / 8,623
  tests. The existing two `editor-activation-concurrency.test.ts` database cases remain skipped
  without their local database; no tests were newly skipped. Coverage ratchet passed: statements
  78.21%, branches 72.27%, functions 76.74%, lines 79.03%
  (`/tmp/s127-resume-final-coverage.log`, `/tmp/s127-resume-final-jest.json`).
- Lint passed with 34 existing warnings and no errors; `type-check`, `type-check:build`, and
  `format:check` passed (`/tmp/s127-resume-final-{lint,type,type-build,format}.log`).
- `npm run build` passed with an isolated environment, synthetic keys and a loopback Supabase
  URL; expected unavailable catalogue/blog reads used the existing build fallbacks. No provider
  credentials or environment files were read. The prebuild regeneration was byte-identical:
  embed blob `5e299f54b21d4e3433b7e74794f30382516f6d45`. Post-build `--check` passed at the
  same sizes (`/tmp/s127-resume-final-build.log`).
- Local non-browser handoff is complete. Task 5's six authored cases and the full 13-case
  fixture, baseline browser red proof, and independent review remain pending; no browser,
  production, push or PR was attempted during this resume.
