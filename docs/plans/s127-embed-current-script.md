---
validated: no
story: s127-embed-current-script
---
# Plan — Story s127-embed-current-script

Branch: `feature/s127-embed-current-script`
Research: `docs/research/s127-embed-current-script.md` — read it first.
Phase 1 only: this document awaits the owner's validation. No execution is authorized here.

## Target story

Close audit H3 in the canonical widget and legacy loader without breaking genuine snippets or
letting invalid script identity throw into the host page. Acceptance is in `docs/stories.md`.
No UI design or ADR is needed: preserve existing configuration and loading architecture.

## Tasks (ordered)

1. [ ] **Red: capture the startup boundary.** Extend startup Jest coverage and add
       `legacy-loader-current-script.test.ts`. Plant one and two named images with attacker
       src, endpoint attributes and copied dummy site identity. Test native-getter success with
       a real script, null, image/collection results, absent getter and throwing getter.
       Assert no escaped exception, API/WS calls or legacy insertion on refusal; unchanged
       authored copy and credentials/storage/URL on early return. Successful cases assert
       genuine configuration and nonzero expected calls, not merely absence of attacker calls.
2. [ ] **Green: canonical capture.** In `recopyfast.src.js`, synchronously call the prototype
       getter inside a narrow try/catch, require `instanceof HTMLScriptElement`, return silently
       on failure before reading configuration. Keep duplicate-instance handling and existing
       endpoint precedence. Add an H3 incident comment explaining why ordinary property access
       and tag-name checks are insufficient. Run the targeted startup cases.
3. [ ] **Green: legacy compatibility.** Apply the same guarded capture in
       `recopyfast-secure.js` before creating a script. Keep sibling URL/query replacement and
       non-src attribute forwarding, with explicit nonce preservation if the browser hides its
       attribute value. Test valid canonical handoff, query preservation, data attributes,
       nonce, async/defer attributes, and one/two clobbers. Invalid identity inserts nothing;
       never delete the public legacy URL or redirect it to a fixed production origin.
4. [ ] **Restore realistic unit setup.** Adapt existing boot fixtures that fake an own
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
6. [ ] **Build and verify.** Rebuild with `npm run build:embed`; run
       `node scripts/build-embed.mjs --check` and the size-gate tests. Record before/after Node
       zlib sizes. Run targeted Jest, the complete local fixture suite, lint, both type checks,
       format check, full Jest and coverage, then a build using dummy/local configuration only.
       Inspect the scoped diff, collect evidence, tick tasks only on success and request the
       independent killer-saas review before any later PR. No production validation in this run.

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

Phase 1: four scoped docs committed after `npm ci` and unbypassed hooks with
`NEXT_PUBLIC_APP_URL=http://localhost:3000`; plan remains `validated: no`; no code, push or PR.

Later implementation: acceptance cases pass; genuine configuration and legacy compatibility
hold; built bytes fit unchanged ceilings; lint, type-check, type-check:build, format:check, full
Jest/coverage, local fixture and build pass with evidence. Independent review ends with the exact
`Max severity: ...` and `Ship allowed: yes` lines before a PR. Merge and production deployment
remain separate owner-controlled steps and are not claimed by local checks.

## Open questions for the owner

Validate this plan for a later execution run. Proposed default: retain the legacy sibling loader
and secure its capture, rather than switching existing installations to a constant host. Browser
execution capability and exact byte cost are verification questions for implementation, not
reasons to bypass the validation gate.
