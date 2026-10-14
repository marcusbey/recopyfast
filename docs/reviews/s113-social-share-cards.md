# Review — s113-social-share-cards

Date: 2026-10-14. Independent review of commit
`660e9c243a069616cc48801bd4ae0a21dbe2ccd4`, against the approved baseline
`29fbc9dfc66fe8fe91954fe07a5ed708db71ecaf`. The commit contains the reviewed Concept C v2
working state, including all approved and preserved design assets. This review document is the
only remaining untracked file and is owned by the review lane.

## Verdict

The current implementation matches the validated mechanism and the owner's approved Concept C v2.
Both established image routes return the same immutable local PNG; their named `alt`, `size`, and
`contentType` exports remain compatible. The design export and production copy have SHA-256
`1dabbbe9442e487dd905b03026b43e0fd5216099a750c4d0f1fd1ad114577741`, are 984,757 bytes, and
decode as 1200×630 RGB PNGs. The exact headline is “You built the site. Now you’re stuck updating
it.” and the payoff is “Let clients edit the words. Make time for the work that matters.” The alt
text accurately describes the request loop, freelancer, headline, and payoff.

The production build traces the new asset into both route manifests. No request-time fetch,
dependency, auth/data path, migration, customer embed, or generated embed change was introduced.
Full-size and 320×168 inspection confirmed readable copy, safe margins, the freelancer desk, and
the illustrated content-request loop. The exported route asset contains no embedded metadata;
the approved source preview retains its C2PA provenance. Concepts A and B and both Concept C
previews remain preserved as design evidence.

## Prior selection and resolved finding

The owner-approved Concept C v2 supersedes the earlier Concept A default while retaining the same
binary route mechanism and story boundaries. The earlier minor documentation finding remains
resolved: `src/lib/seo/site-identity.ts:12` accurately distinguishes centralized metadata and
manifest copy from the separately approved social creative.

No actionable implementation findings remain.

## Independent verification

- The current build outputs trace
  `src/app/assets/recopyfast-social-card-developer-bottleneck-2026-10-14.png` from both image route
  manifests. Both prerendered route bodies are 984,757-byte 1200×630 PNGs with the approved hash.
- A production server using those current outputs, supplied safe non-secret placeholder values
  for the same environment variables production provides, returned HTTP 200 `image/png` from
  `/opengraph-image` and `/twitter-image`. Both bodies matched the approved bytes and dimensions.
- `/`, `/try`, `/compare`, `/docs/install`, and `/compare/webflow-editor` returned HTTP 200 and
  resolved their Open Graph and Twitter image metadata to the preserved public routes. The root
  metadata emitted the exact new alt text.
- Independent focused metadata tests passed 4/4; `npm run type-check` and the repository's
  `npm run format:check` passed. The focused test reads both handlers, checks the PNG signature,
  actual dimensions, sub-5 MB size, exact approved hash, shared bytes, named exports, and response
  MIME. The previously reviewed MIME mutation remains applicable because the binary handler
  mechanism is unchanged.
- The working-tree plan records passing build, production/build type checks, and lint with 0 errors
  and 33 existing warnings.
- The prior CORS failure is confirmed as an environment-dependent test fixture, not a route defect:
  with `NEXT_PUBLIC_APP_URL=https://www.recopyfa.st`, the exact content-route suite passes 42/42.
  The route correctly emits no grant when neither an authorized origin nor configured app origin
  exists. Production defines that canonical URL; CI and `.env.example` define the local test origin.
- A full run with the production origin cleared the CORS test but exposed 14 unrelated assertions
  in two comparison suites that hard-code `http://localhost:3000`: 533 suites / 7,986 tests passed.
  Log: `/tmp/s113-full-suite-canonical.log`.
- A full run with the repository's exact CI/local test configuration,
  `NEXT_PUBLIC_APP_URL=http://localhost:3000`, cleared both the CORS and comparison suites. It
  reached 534 passing suites / 7,999 passing tests, then one unrelated WebSocket rate-limit
  handshake timed out. The exact timed-out assertion immediately passed 1/1 in isolation under the
  same environment. Logs: `/tmp/s113-full-suite-ci-env.log` and
  `/tmp/s113-websocket-targeted-retry.log`.
- The final normal commit hook on exact commit `660e9c243a069616cc48801bd4ae0a21dbe2ccd4`,
  under the documented CI/local app-origin configuration, passed lint with 0 errors and 33 existing
  warnings, full TypeScript checking, repository formatting, and the complete Jest suite: 535
  passing suites / 8,000 passing tests, with the repository's 2 suites / 38 tests skipped. The log
  then records the commit creation, so this was not a `--no-verify` commit. Evidence:
  `/tmp/s113-final-hook.log`, SHA-256
  `4d92bb7fab402f1cfa750330bb138969bd7db7bd3a374bedc9ab946d4f235779`.

## Ship readiness and unverified evidence

There is no blocking defect in the s113 diff. The earlier CORS result was not a valid reason to
change production behavior: supplying the declared app-origin prerequisite preserves the exact
assertion and passes that suite. The tests remain non-hermetic across environments: one fixture
assumes the variable is present while two comparison suites assume its value is localhost. That
maintenance concern should be repaired in separately validated work, without changing this route
or weakening its no-wildcard behavior.

The exact committed tree now has a fresh all-green normal-hook run under the repository's declared
CI/local environment. The review gate is clear for `/ks-ship` to open the single story PR under the
manual merge strategy. Merge, deployment, and live social-preview verification remain separate
owner/release evidence.

This review did not verify a deployed production response, third-party crawler rendering, or
social-platform cache refresh. After the repository gate is green and the owner merges/deploys,
fetch both live image routes and representative live HTML, then use the platforms' normal preview
refresh tools where cached cards remain. Local production evidence is not live deployment proof.

Max severity: none
Ship allowed: yes
