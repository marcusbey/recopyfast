---
story: s61-stable-copy-loading
validated: yes
---

# Stable initial copy and earlier delivery

The user approved the outcome, requires default protection, and rejected a 1.5-second hold.
The revised cap is 200 ms of actual concealment; faster delivery is a rollout prerequisite. The user explicitly validated this written plan on 2026-10-04: “validate and implement”. Source: `docs/research/s61-stable-copy-loading.md`;
behavior: `docs/designs/s61-stable-copy-loading.md`.

## Ordered implementation tasks

- [x] 1. Lock current behavior with tests, then add failing tests for early public fetch,
  no font wait on visitor delivery, private-grant isolation, and atomic baseline/A/B reveal.
  Add an initial browser reproduction that sees the current authored-to-published swap.
- [x] 2. Add a shared small startup coordinator and generated native head bootstrap. Use
  scanner-compatible eligibility, ignore/contenteditable exclusions, a fixed 200 ms
  deadline and idempotent applied/fallback settlement. Arm recovery before requests.
  Test escaping, duplicate installs, mode/site/path mismatch, blocking JS/CSP and no runtime.
- [x] 3. Hand the bounded public fetch promise to the existing runtime without duplicate
  requests. Separate retrieving rows from applying them. Begin fonts concurrently and
  retain their wait before edit geometry. Preserve private authentication and endpoint choice.
- [x] 4. Gather published rows and A/B selection before a synchronous final commit/reveal.
  On fallback do not mutate from late content, AB, startup polling or socket replay, and
  do not record impressions for variants never displayed. Preserve explicit editor actions.
- [x] 5. Route bearer content GETs directly through existing site authorization after the
  rate limiter. Add route-specific preflight max-age. Prove malformed/revoked credentials
  cannot fall back to dashboard cookies; cookie dashboard and denied origins remain correct.
- [ ] 6. Update snippet generation, recipes, installation diagnostics, public guide and
  agent instructions. Integrate with s59 once available on the base; never duplicate its
  canonical guide. Add trusted bootstrap support to the aicompoz installation adapter in a
  separate site-repo change, preserving credential/referrer protections and host animation.
  - [x] ReCopyFast typed generation, recipes, dashboard installation surfaces and diagnostics.
  - [ ] Canonical guide/agent-brief integration after PR 56 merges and this branch rebases.
  - [ ] Separately tracked aicompoz adapter story/PR and its own release gate.
- [ ] 7. Prove first-visible-frame behavior on generic HTML and React fixtures plus the
  actual aicompoz homepage structure: cold/repeat, slow fonts, API before/after deadline,
  script/API/CSP failure, ignored/structural/nested media regions, reduced motion, open
  shadow roots, valid/expired editor grants and active A/B tests. A reverted gate must fail
  the visible-copy assertion. Do not count an already-swapped screenshot as timing proof.
  - [x] Repeatable generic HTML and real React 19 fixtures, slow font/API/A-B/CSP paths,
    ignored and nested regions, reduced motion, open/closed shadow boundaries and the
    legacy authored-to-published control.
  - [x] Source/runtime coverage for valid private grant isolation and terminal public lockout.
  - [ ] Actual aicompoz structure/adapter and browser grant matrix for expired, revoked,
    offline and hung authorization states.
- [ ] 8. Run generated-artifact freshness/size, targeted and full tests, typechecks, lint,
  format, build and coverage with normal hooks. Keep both existing gzip ceilings; gate the
  extra bootstrap separately at 2,500 gzip bytes maximum including generated configuration
  for the canonical test site. If reuse/extraction cannot fit, stop for a focused split;
  do not increase budgets. Obtain fresh independent code review.
- [ ] 9. Record at least ten before/after runs per cold/repeat scenario: request start,
  final-copy readiness, reveal time, fallback frequency and layout shift. Open the single ReCopyFast PR.
  Reconcile s59/s60 integration before release, keep dependency audits blocking, and follow
  manual merge. After authorized deploy/install migration, verify deployed identity and
  repeat the real landing-page first-visible-copy test. No production claim before that.
  - [x] Preliminary 20-request production HTTP sample recorded as rollout-blocking context.
  - [ ] Required cold/repeat browser measurements, PR, dependency reconciliation, authorized
    deploy/install migration and deployed homepage first-visible-copy verification.

## Implementation evidence and current stop

- Task 5 source and route tests are complete. The focused content-route run passed 48/48;
  the five related content suites passed 153 tests, with typecheck, lint and format green.
- The generated head bootstrap is fresh and measures 2,497 bytes gzip against its fixed
  2,500-byte ceiling with a representative high-entropy 112-character site token and
  24-character nonce. Its generator, CSP hashes, cross-origin no-referrer and same-origin
  bare-origin request, 200 ms recovery, duplicate/mismatch handling, text-node observation
  and open-root behavior have targeted passing tests.
- The current runtime handoff tests pass for early-fetch reuse without a font wait, atomic
  baseline/A/B reveal, delayed A/B falling back to the valid baseline without a late variant
  or impression, and missing/unsupported marked runtimes retaining authored copy.
- The permanent Playwright regression passes one test with nine internal scenarios: the
  legacy swap control, fast baseline, authored deadline fallback, delayed-A/B baseline,
  synchronous open shadow root with a blocked font, real React 19 `hydrateRoot` over nested
  hero spans, CSP style-block fallback, and quoted bootstrap/style hash admission without
  `unsafe-inline`, plus same-origin authorization with a bare-origin Referer and no Origin
  header. The separate evidence capture passed seven scenarios with zero layout shift and
  zero React recoverable errors. Its timings are frame-sampled CSS visibility, not guaranteed
  glyph-paint timestamps.
- The embed build passes all three fixed size gates: 45,840 bytes gzip for the bundle
  (ceiling 45,880), 33,085 for the widget slice (ceiling 33,120), and 2,497 for the
  configured bootstrap (ceiling 2,500). The ceilings were not changed. Headroom remains
  deliberately narrow, so freshness and size checks stay blocking on every rebuild.
- A preliminary 20-request production HTTP operator sample measured median 589 ms, range
  507–3,841 ms, with 20/20 responses over 200 ms. This is not browser-cold or pixel timing,
  but it already blocks rollout under the story's fallback threshold. No fixture timing is
  being substituted for production speed evidence.
- The s59 guide/agent-brief integration remains pending PR 56 and requires rebase after that
  PR merges. The aicompoz installation adapter remains a separate dependent site-repo story
  and PR. Neither dependency was duplicated into this branch.

## Main code surfaces

`src/lib/sites/embed-script.ts`, `install-recipes.ts`, new shared startup coordinator,
`public/embed/recopyfast.src.js` and generated artifact, `scripts/build-embed.mjs`,
`src/app/api/content/[siteId]/route.ts`, installation surfaces and their tests, browser
fixtures/specs and the explicit Playwright count contract when new tests are added.
The companion site adapter is `src/components/ReCopyFastEmbed.tsx` and
`src/lib/recopyfast-embed.ts` in the aicompoz-com-landing repository.

## Scope and stop conditions

No optional protection toggle, hero-specific logic, shared response cache, SSR integration,
new dependency, relaxed CSP/auth, arbitrary inline HTML execution or silent budget increase.
No claim that late existing snippets protect text already painted. No blanket SPA/closed
shadow/iframe or host-script guarantee. Late/blocked bootstrap degrades visibly to authored
text without late initial replacement; private editing remains available after authorization.

The historical backlog review still ends `Stories ready: no`; stories.md records its
subsequent repairs. This new, explicitly requested story receives its own research, design,
plan and fresh review. The framing entry travels on the isolated feature branch to preserve
the dirty primary checkout; it must be reconciled during manual integration.

## Binding details and integration order

These refine the tasks above and take precedence over their shorter summaries.

- Task 2 uses the typed two-placement installation object and CSP/version contract in
  the design. Keep the legacy builder intact. Add per-open-root style and observation for
  roots present during startup. Prove missing/blocked/late bootstrap cannot enter a legacy
  swap path through a new v2 runtime tag.
- Task 3 uses no-referrer for cross-origin public fetches. Browser-proven same-origin
  GETs omit Origin, so only that case sends an explicit origin-only referrer
  (document.location.origin + "/", referrerPolicy: origin), retaining the existing
  mandatory site-domain authorization. No path, query, hash or private parameter may
  appear in either case; cookies remain omitted. This bounded implementation refinement
  preserves the validated privacy goal and adds no server authorization bypass.
- Task 4 lockout is public-only. Private authorized preview can hydrate after mask release.
  Valid published rows win as baseline if A/B fails/misses the cap; no unshown variant
  impression. Gather before synchronous commit and roll back partial host exceptions.
- Task 5 treats ANY explicit site credential (Bearer or legacy query token) as widget auth;
  invalid credentials never fall through to a cookie session. Only token-absent calls can
  use dashboard auth. Set Access-Control-Max-Age: 86400 on OPTIONS only, retain uniform
  204 and Vary: Origin, echo ACAO only for allowed origins, and test actual GET denial
  after revocation even with cached preflight. Never cache GET/error responses.
- Measure twenty representative cold visits after early-fetch/API work. More than one
  authored fallback under the 200 ms cap blocks rollout and requires a separate delivery
  improvement plan. Do not silently lengthen the cap or declare fallback a speed success.
- s60/PR57 is additive, not a prerequisite. Keep this branch green against main. Whichever
  merges second rebases onto main and reruns full/browser gates plus independent review;
  do not cherry-pick or stack PR57.
- The guide/agent-brief part of task 6 requires s59/PR56 merged and this branch rebased
  onto main before that part can complete. Other implementation can proceed independently.
  Do not duplicate its canonical guide or silently omit the integration.
- ReCopyFast has ONE story branch and ONE PR. The aicompoz adapter is a separately tracked
  dependent site-repo story/PR. Its own release gate applies. Production proof needs both
  exact revisions deployed; this plan is not blanket merge/deploy authorization.
