# Research — Story s127-embed-current-script

**Verdict: H3's unsafe source reads and downstream trust premise hold at `534e7926`.
Browser-native named-property reproduction remains unverified in this run.** The audit's
“M8 same-origin check” means the older s67 review, not October audit M8 (scarce offers).
The consequence is conditional on attacker HTML preceding execution, browser named access,
credential presence, and network/CSP/CORS permitting the relevant request. “Whole-site publish
rights” is bounded by the stolen credential's live permissions; it is not an unconditional grant.

## The five structuring facts

1. `public/embed/recopyfast.src.js:38-50` trusts `document.currentScript` for both the origin
   guard and attribute fallback; validating an origin derived from the same attacker object
   cannot establish trust.
2. `public/embed/recopyfast-secure.js:4-24` reads the same property, copies attributes and
   inserts a script; an unmatched attacker URL survives its filename replacement unchanged.
3. `public/embed/recopyfast.src.js:46,69-70` calls `getAttribute` outside a catch: a collection
   from two names has no such method. The later initialization catch at `:1068` cannot catch it.
4. `src/__tests__/embed/embed-startup-config.test.ts:49` installs an own-property fake getter;
   bypassing that property will invalidate test setup unless the fixtures are adapted.
5. `playwright.embed.config.ts:19` requires exactly seven fixture tests, also pinned by
   `src/__tests__/ci/release-gates.test.ts:82`; new browser coverage must update both deliberately.

## Target story

Close H3 in both permanent public entry points, fail silently on unavailable trustworthy script
identity, retain genuine snippet configuration, and prove the result with source and built-artifact
coverage. See the appended story's acceptance criteria. L7 is a separate transport change.

## Current state of the code

### Configuration and failure paths

- Source IIFE begins at `public/embed/recopyfast.src.js:1`; the existing duplicate-instance
  guard is at `:11`. `SCRIPT` is captured synchronously at `:38`.
- `SCRIPT_ORIGIN` reads `.src` at `:40` inside a catch, but that catch does not protect subsequent
  `configuredEndpoint(name, attribute)` calls (`:41-50`) or site-id/token reads (`:69-70`).
- A single image provides `.src` and `.getAttribute`, so attacker data attributes can supply
  all four configuration values. The public site id/token can be copied from the real snippet.
  Even without attacker globals, attribute fallback supplies the endpoints. Existing legitimate
  `data-api-url` and `data-ws-url` values may be cross-origin; do not remove that support.
- Two named elements are expected to yield an HTMLCollection in affected browsers. Given that
  value, `SCRIPT.getAttribute` throws synchronously. No outer try/catch protects the IIFE.
- Legacy loader `public/embed/recopyfast-secure.js:6-8` replaces only a matching suffix; arbitrary
  image URLs are otherwise unchanged. `:14-18` copies every non-src attribute, and `:21-24`
  inserts the new executable script. With a collection, `current.attributes` is absent and
  `Array.prototype.forEach.call` throws. Its fallback relative URL does not safely rescue it.

### Credential sinks and limits of the audit claim

- `public/embed/recopyfast.src.js:93` reads the edit code from the fragment;
  `:1093-1102` posts it as `editToken` to the selected API's `/staging/validate`.
- `:306-312` sends editor-client bodies to the selected API; `:327-354` consumes and posts the
  handoff code to `/editor/handoff/redeem`; `:360-361` posts stored grants to `/validate-grant`.
  Exfiltration is not limited to the `X-RCF-Editor-Grant` header (`:1359-1361`): validation
  itself sends the stored grant in a body. An attacker responding successfully can also cause
  subsequent authenticated requests to use the header.
- `:3117-3124` connects to the configured WS endpoint with site and edit/staging tokens in
  query fields. This is H3's endpoint trust issue; moving tokens out of URLs is L7 and excluded.
- `src/lib/auth/edit-link-redeem.ts:65-78` checks expiry and site origin; `:98-134` validates
  then conditionally spends the session. A POST to an attacker does not spend a real code.
  `src/lib/auth/editor-handoff.ts:27,102-105,120-147` enforces 60 seconds, single use and the
  editor's permissions. Replay impact is inferred from these local paths, not tested against
  any service. Origin checks are not proof against a non-browser caller supplying that header.
- Existing arbitrary host JavaScript can already access credentials (ADR 036's accepted
  residual). This story closes an HTML-only gadget; it does not isolate the widget from all
  scripts executing on a customer origin.

## Anchor points

- Harden script capture in `public/embed/recopyfast.src.js` and `recopyfast-secure.js` before
  endpoint/global assignment, URL credential handling, or script creation.
- Preserve the legacy sibling-loader contract; no constant production-host migration is needed.
  This repairs an existing boundary without introducing an architectural choice or new ADR.
- Extend `src/__tests__/embed/embed-startup-config.test.ts`; add a legacy-loader unit suite.
- Reuse `e2e/embed-fixture/{servers,fixture-page,stub-api}.ts` for local artifact coverage.
  The fixture currently emits its script in the head, before body markup: adversarial HTML
  must be emitted before the executing tag, not inserted after startup.

## Verified APIs / functions

- `configuredEndpoint(name, attribute)` (`recopyfast.src.js:41`) retains string-global
  same-origin precedence, then script data attributes, then API-only origin fallback.
- Native accessor invocation requested by the owner: get the descriptor from
  `Document.prototype`, call its getter with `document`, then check `HTMLScriptElement`.
  Wrap descriptor lookup, invocation and type validation in a narrow catch; unavailable or
  invalid results return. Never fall back to the clobberable property or a script selector.
- `startFixtureServers` in `e2e/embed-fixture/servers.ts` serves the committed artifact from
  loopback alongside a stub API and a separate loopback host. No Next server or real provider
  is required. It currently serves only the canonical embed, so add the legacy path explicitly.
- `node scripts/build-embed.mjs --check` passed on October 27: Node zlib level 9 measured
  bundle 45,643 B / max 45,801; widget 32,878 B / max 33,044; transport 13,122 B.
  Headroom is 158 / 166 B respectively, not a promise that the fix will fit.

## Traps & constraints

- Current source tests use `new Function(WIDGET_SOURCE)()` outside classic-script execution.
  A real native getter then returns null. Adapt only their setup: a scoped prototype accessor
  spy returning an actual script, restored after each test; retain every behaviour assertion.
  `rg currentScript src/__tests__/embed` identifies the affected boot suites, including
  editor-grant, edit-link, SPA, React writes, host-globals, content, save and cookie coverage.
  Do not add a production fallback to keep synthetic tests passing.
- jsdom is insufficient evidence for native named-property behaviour. Real browser tests must
  assert that the one/two images actually produce an image/collection through direct access
  while the native getter identifies the genuine executing script. Otherwise a green test
  could be vacuous. Include source and artifact paths where appropriate.
- The source guard's silent-return guarantee concerns widget effects. The generated artifact
  prepends Socket.io initialization; do not claim zero JavaScript side effects in the bundle.
- Legacy nonce forwarding needs a genuine nonce-bearing script test, since browser nonce
  hiding can make attribute values differ from the `.nonce` property.
- Read `AGENTS.md`, architecture, ADR 036, ADR 049 and ADR 055. H3 names no ADR directly;
  036 and 055 govern the cited credential paths and 049 governs s67's host-page contract.
  Existing decisions end at 074; 075 is reserved for s125. No ADR is added for this repair.
- `docs/reviews/stories.md` still ends `Stories ready: no`; the owner's explicit October 27
  instruction authorizes this bounded story/research/plan phase, not execution validation.
- No codebase-memory tools were available; used targeted source reads. The s125 story shape
  was read from its sibling worktree because it is not on this branch; no sibling file changed.

## Open questions

- Owner validation of the proposed compatibility-preserving getter fix in both entry points
  is still required. No product/UI decision is otherwise needed.
- Native Chromium reproduction was attempted with fully intercepted requests, but browser
  startup failed under the macOS sandbox (`MachPortRendezvousServer: Permission denied`).
  A local jsdom diagnostic explicitly supplied an HTMLCollection (not native named access):
  the unchanged source threw `SCRIPT.getAttribute is not a function`; the legacy loader threw
  `Array.prototype.forEach called on null or undefined`. This confirms the failure sinks,
  not the browser named-property premise.
  Real markup behaviour and end-to-end credential isolation must be demonstrated during
  execution in an environment that can launch the local fixture browser. No production was used.
- Exact post-fix byte cost is unknown until execution/rebuild. If the bounded fix cannot fit,
  stop and report the measured overage; do not raise ceilings or expand into unrelated cleanup.

## Real complexity

3, matching the story: two small production edits but nontrivial fixture adaptation and browser
proof, plus a tight byte budget. No split needed; both public entry points must be secured together.

## Phase 1 validation and commit status (historical)

The phase completed in commit `da839bfd`; the owner validated the plan on 2026-10-28. The
paragraphs below preserve the phase's gate evidence and are no longer the current execution state.

`npm ci` completed once (the initial shell used Node 25 and printed the package's Node 24
engine warning; subsequent hook runs explicitly used installed Node 24.14.0). The unchanged
pre-commit hook passed lint (34 warnings, zero errors), type-check and format:check twice with
`NEXT_PUBLIC_APP_URL=http://localhost:3000`.

The first full Jest run reported `extract-page.test.ts` → “extracts a 2 MB page in under 2 s”
refused with `too_complex`, then emitted no further suite results for more than five minutes.
It was interrupted through its own tool session. A second normal commit attempt with `CI=true`
also stopped producing output after Jest startup for nearly three minutes and was interrupted.
No assertions, hooks or code were changed; no hook was bypassed. No commit was created. The four
documents remain staged for a later unbypassed retry. Logs for this local run are
`/tmp/s127-phase1-commit.log` and `/tmp/s127-phase1-commit-retry.log` (ephemeral).

## Resume handoff — 2026-10-29

The owner validated execution and later authorized rebasing the unpublished branch onto main
after s125/#127 and s126/#128. The docs commit was replayed as `35d5a544`; main's audit resolution
notes and s125/s126 stories were preserved. s126's upload credential implementation and browser
assertions survived unchanged. Its new Jest upload fixture needed the same prototype getter spy
as the other hardened-source boot fixtures; credential assertions are unchanged.

The native descriptor/getter and caught `HTMLScriptElement` check remain the identity boundary.
To fit the unchanged gate, endpoint-global validation and attribute fallback were separated,
unused catch bindings were removed, and the existing missing-API console warning was removed.
The warning removal is a deliberate diagnostic change, not a duplicate-message cleanup; normal
configuration precedence, refusal behavior, and credential semantics remain unchanged.

Rebased bundle: 45,827 → 45,800 B gzipped (45,801 B ceiling); widget: 33,049 → 33,022 B
(33,044 B ceiling), measured under Node 24.14.0. Full Jest/coverage, lint, both type checks,
format, build and post-build staleness/size checks pass; detailed evidence is in the plan.
Browser regressions are authored; executed by Claude outside sandbox — pending. The earlier
browser uncertainty remains unresolved, and independent review is still required before a PR.
