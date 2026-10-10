# Review — Story s55-no-visitor-cookie-by-default

> Fresh-context review by the `reviewer` subagent, 2026-09-28. Diff reviewed:
> `git diff main...feature/s55-no-visitor-cookie-by-default`, one commit `6662c20`, branched
> from `b05666d`. `main` has since gained `bae700c` (s51). No UI in this story, so the design
> conformity check does not apply.

## Plan compliance
- [x] The code does what the plan specifies, and nothing more. I checked each task:
  - **Task 1.** `src/__tests__/embed/visitor-cookie.test.ts` is new. It has the house-style
    header, the harness the plan names (`new Function(WIDGET_SOURCE)()`, `currentScript` as an
    own property, `RECOPYFAST_WS` deleted), an own-property `document.cookie` jar with `jest.fn`
    accessors deleted in `afterEach`, and a fetch mock that records URLs and track bodies. There
    are no `any` casts. It covers cases (a), (b)×2, (c), (d) and (e), with the assertions the
    plan lists. That makes 6 tests.
  - **Task 2.** `recopyfast.src.js` has exactly three edits:
    - the init-time `this.initVisitorId();` is deleted (`:958` on main), and the pipeline
      comment is rewritten;
    - the `bucketVisitor` guard becomes `if (!this.activeTests.length) return;`, followed by a
      tombstone comment and `this.initVisitorId();` (`:3263-3276`);
    - `initVisitorId` now opens with `if (this.visitorId) return;` and a comment (`:3220-3225`).

    There are no other hunks in the file.
  - **Task 3.** The fallback was not taken, and it did not need to be (see Bytes).
    `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` in `scripts/build-embed.mjs:178-179` went from 45883 /
    33122 to 45880 / 33120, with a dated `RATCHETED DOWN` block. `SEEDED_MAX_*` in
    `build-size-gate.test.ts:84-85` moved to the same pair, with a dated comment. The plan asked
    for "one line" and the comment is two lines, which is immaterial.
  - **Task 4.** The four AC boxes are ticked at `docs/stories.md:2013-2020` and nothing else
    changed in that file. The research and the plan travel in the commit, the plan's task boxes
    are ticked, and there is one commit with the plan's subject line. Its body gives the byte
    pair and says the fallback was not taken.
- [x] Every run interdict holds. Each was checked against `git diff main...feature/<id>`:
  - **No server change.** `--stat` over `src/app src/lib src/middleware.ts server supabase` is
    empty.
  - **`recopyfast.js` only through the build.** I rebuilt it and got byte-identical output (see
    below). `--check` passes, and so does its staleness marker.
  - **Ceilings only go down.** 45883→45880 and 33122→33120. No committed file outside the
    script, its test and the docs sets `RCF_EMBED_CEILING_OVERRIDE` (`git grep`).
  - **`ab-bucketing-parity.test.ts` diff is empty.** Its `--stat` is empty. The only existing
    test changed is the `SEEDED_*` pair and its comment.
  - **Markers kept.** `initVisitorId` stays between the `// A/B TESTING METHODS` (`:3216`) and
    `// END A/B TESTING METHODS` (`:3542`) markers, and their text is unchanged.
  - **No other A/B method changed.** `fetchActiveTests`, `applyVariants`,
    `setupClickTracking`, `trackImpressions`, `trackConversion`, `sendTrackEvent`, `fnv1aHash`
    and `handleABTestUpdate` are all untouched.
  - **Adjacent work kept out.** There is no DNT handling, no cookie deletion, no `try`/`catch`,
    the `/ab-tests/active` request stays, and the storage reads at `:133-136` / `:201-231` are
    untouched.
  - **Protected docs unedited.** ADRs 015/016, `src/app/privacy`, `src/app/terms` and
    `docs/architecture.md` have no diff.
  - **No Supabase, push or PR.** Nothing was started, pushed or opened.

## Anti-hallucination
- [x] No invented API, function or import. I opened each target:
  - `initVisitorId`, `fetchActiveTests`, `bucketVisitor`, `handleABTestUpdate`,
    `trackConversion` and `sendTrackEvent` exist in `recopyfast.src.js` with the names and
    arities the diff and tests use. `window.ReCopyFast` is the widget instance, so the test's
    direct `handleABTestUpdate` call is valid.
  - The bucket route (`src/app/api/ab-tests/bucket/[siteId]/route.ts:32-38`) does 400 on a
    missing or empty `visitor_id`, as the research says.
  - `server/index.js:534-557` documents the frozen relay. The only `ab-test-update` hit in
    `server/` or `src/` is the test that pins it as *not* relayed
    (`server.integration.test.ts:1013`).
  - The test's imports (`node:fs`, `node:path`) and `jest.fn<void, [string]>` type-check under
    `tsc --noEmit`, which exits 0.
- [x] No plausible-but-wrong value:
  - The cookie format regex in the test matches the source's write string character for
    character.
  - The byte pair in both files and in the commit is the pair `--check` prints, re-measured by
    me, not copied from the research.
  - The ratchet note says the pre-s55 ceilings were "measured on main at b05666d". I rebuilt
    `b05666d` and got `45883 / 33122`. Current `main` (`bae700c`) is also `45883 / 33122`.
- [x] The code does what it claims. `document.cookie` appears exactly twice in the source and in
  the minified artifact, both inside `initVisitorId`. In the artifact, `initVisitorId()` is now
  called only inside `bucketVisitor`, after `if(this.activeTests.length)`. On `main`, the call
  sat in `init` before `fetchActiveTests`. The `cookie` hits in the bundled socket.io-client are
  its opt-in `cookieJar` option, which is unused.

## Rules compliance
- [x] Repo conventions (AGENTS.md) are followed:
  - **Non-negotiable 1.** The source was edited and the artifact rebuilt.
  - **Non-negotiable 2.** The public URL is unchanged.
  - **Non-negotiable 4.** See F2 for a latent residual.
  - **Comments.** The tombstones follow the house style and explain *why*, anchored to the
    incident.
  - **Tests.** They are colocated and have no `any`.
  - **Commits.** There is one story commit, in conventional form.
- [x] No accepted ADR is contradicted:
  - **ADR 016 §1** says "`initVisitorId()` is the single source of visitor identity for A/B".
    That still holds. It is called from one place, and the cookie is still first-party and
    page-origin.
  - **ADR 016 §2-3** (DNT, cookie refusal) is unimplemented `s11c` scope, as before. s55 narrows
    *when* the id is minted and adds no path that contradicts those sections.
  - **ADR 015** is untouched, and `rcf_vid` is still not shared with impressions.
  - **ADR 004 / the byte gate** is respected.
- [x] Byte budget (`docs/stories.md` § Byte budget; s55's allocation is ≤ 0 bytes): the result
  is −3 bundle / −2 widget gz.
- n/a Design system: no UI.

## Tests
- [x] I ran the suite myself in the worktree, under `ci-env.sh` and the dead Supabase config:
  - `npx jest`: **292 suites passed, 2 skipped (DB-gated), 0 failed; 3696 tests passed, 38
    skipped, 0 failed.**
  - Embed suites: **17 / 17 suites, 212 / 212 tests.**
  - `lint`: 0 errors, 38 pre-existing warnings. `eslint` on the two touched test files returns
    exit 0 with no output.
  - `tsc --noEmit`, `type-check:build` and `format:check`: clean.
  - `npm run build`: exit 0. The tree is clean after it (`prebuild` rebuilt the embed and
    produced identical bytes).
  - I did not re-run the `main` baseline count myself.
- [x] Merged with current `main`. `git merge-tree` reports no conflicts. On the merged tree
  (`a869e10`, built in a scratch dir):
  - `build-embed --check` shows `45880 / 33120`, up to date;
  - the embed suites give **18 / 18 suites, 216 / 216 tests**, which includes s51's new
    `plan-ended-message.test.ts`.

  s51 touched no embed source, `build-embed.mjs` or `editingRules.core.ts`, so no re-ratchet is
  needed.
- [x] The assertions pin the acceptance criteria:
  - **(a)/(b) pin AC1.** They assert that the getter and setter are never called, that
    `visitorId` is null, that `/ab-tests/active` *was* requested (so the early return is
    exercised, not skipped by staging), that no bucket or track request is made, and that the
    `<h1>` shows the published copy.
  - **(c)/(d) pin AC2 on the `init` path.** They assert one write in the exact format, the id
    carried to the bucket URL and the `view` event, the variant applied, and a returning visitor
    reused with no write.
  - **(e) pins the second caller.** It asserts a mint on the first `handleABTestUpdate` and no
    re-mint on the second. The jar deliberately never reflects writes, so (e) also proves the
    idempotency guard.
- [x] **The tests bite, proven by neutralization.** I ran five mutations of
  `recopyfast.src.js`, each against all embed suites except `build-size-gate` (203 tests; that
  suite goes stale-red on any source edit by design). After each, I restored with
  `git checkout` and confirmed `git diff --exit-code` was clean:

  | # | Mutation | Red |
  |---|---|---|
  | M1 | restore `this.initVisitorId()` in `init` before `fetchActiveTests` | **4** — (a), (b)×2, (e) |
  | M2 | drop the `if (!this.activeTests.length) return;` early return | **4** — (a), (b)×2, (e) |
  | M3 | drop the `if (this.visitorId) return;` idempotency guard | **2** — (e), and parity "assigns what the server would assign, for the same visitor" |
  | M4 | "variant E": gate in `init` only, keep `\|\| !this.visitorId` in `bucketVisitor`, no mint there | **1** — (e) |
  | M5 | remove the mint from `bucketVisitor` entirely | **3** — (c), (d), (e) |

  Every guard the story turns on is covered by at least one red test. M4 is the plausible wrong
  fix the research warned about, and the test catches it.
- [x] Also run: the new test file against the **pre-s55 source** (`b05666d`), in scratch. 4 of 6
  are red: (a), (b)×2 and (e). (c) and (d) are green. See F3.

## Artifact fidelity
- I did `git archive` of the branch into scratch, symlinked `node_modules`, and ran
  `node scripts/build-embed.mjs`. The result is **byte-identical** to the committed
  `public/embed/recopyfast.js` (sha256 `6676bd5c…7b61f9` for both). `--check` prints
  `bundle 45880 B (max 45880) | widget 33120 B (max 33120) | transport 13141 B`.
- An identical rebuild from the committed source means the artifact was not hand-edited.
- The artifact diff is the banner hash plus the minified widget body. `socket.io-client.min.js`
  has no diff.

## Regressions
- [x] No impact on existing code paths beyond F1 and F2:
  - **Hydration.** `hydrateStoredContent` runs before the A/B block and is untouched. The `<h1>`
    assertions in (a)/(b) and the existing embed suites (content-attributes, hydration and
    publish/edit suites, 212 tests) are all green.
  - **Staging and edit mode** never ran the A/B pipeline, and still don't.
  - **Every `visitorId` reader** (`:3282`, `:3320`, `:3439`, `:3460`, `:3484`) runs after the
    mint, or behind a `variantId` that only `bucketVisitor` fills.
  - **`trackConversion`** (public at `:6255`) is still a no-op with no tests or no assignment.
  - **Callers.** `bucketVisitor` has two callers (`:960`, `:3528`), and both are covered.
  - **Other code and tests.** No e2e test, server code, legal page or architecture doc depends on
    `rcf_vid` being set on every load (`git grep`).
- **Sandboxed frames (`document.cookie` throws), a behaviour change.**
  - *Active-test load:* init still aborts after hydration, as before. It now aborts in
    `bucketVisitor` rather than before `fetchActiveTests`, which costs one extra GET.
  - *No-test load:* init now completes, so the socket, discovery and the mutation observer come
    up where they previously died silently. That is the widget working as designed, not a
    regression. It is the precondition for F2.

## Findings
- **F1 — minor — `public/embed/recopyfast.src.js:3263`.** Dropping `|| !this.visitorId` from
  the `bucketVisitor` guard changes the active-test path for one input: an existing `rcf_vid=`
  cookie with an **empty** value. The embed never writes one; only a third party or a hand edit
  could.
  - **Before:** `visitorId = ""`, `bucketVisitor` returned, and no request was made.
  - **After:** `visitorId = ""` still, but the bucket request goes out with `visitor_id=`.
    - The server 400s and `activeTests` is emptied. What the visitor sees is identical.
    - On a *network throw*, the FNV fallback assigns a variant from the hash of
      `":" + test.id`. That is the same variant for every such visitor, and it is unrecorded,
      because the trackers still check `!self.visitorId`.

  This is not exactly "behaves as today" (AC2), but it is unreachable through the embed's own
  writes. Accept it, or treat an empty value as absent in `initVisitorId`, which costs bytes.
- **F2 — minor — `public/embed/recopyfast.src.js:3527-3533`, latent.** The plan names this
  residual, and I confirmed it. `handleABTestUpdate`'s `.then` chain has no `.catch`.
  - After s55, a sandboxed frame with no test at load completes `init` and can open a socket.
  - An `ab-test-update` would then call `bucketVisitor` → `initVisitorId`. That call throws on
    `document.cookie` and produces an unhandled rejection on the host page, which would breach
    AGENTS.md non-negotiable 4.
  - It is unreachable today:
    - no server emits the event (`server/index.js:534-557`, `server.integration.test.ts:1004-1022`);
    - `RECOPYFAST_WS` is opt-in and unset on real installs.

  Whoever re-enables the relay must add a `.catch` first.
- **F3 — minor — `docs/plans/s55-no-visitor-cookie-by-default.md` Task 1.** The plan predicts
  that "(c), (d) and (e) pass on `main`". Measured on the `b05666d` source, (e) is **red**,
  because its step 1 asserts the no-test boot wrote nothing, which the old code violates. So the
  plan's RED record ("RED only on (a) and (b)") is wrong, and (e) pins the new behaviour of the
  second caller, not today's. The commit does not record the RED run.
  - This is a documentation inaccuracy with no code impact. The post-change second-caller
    behaviour is pinned (M1, M3, M4 and M5 all turn (e) red).

No critical and no major findings.

## Not verified
- **A real page in a real browser.** Jest/jsdom with a stubbed `document.cookie` is not a
  browser cookie jar. Load a static page with the built `public/embed/recopyfast.js` for a site
  with **no** active test, then:
  - in DevTools → Application → Cookies for that origin, check there is **no `rcf_vid`**;
  - in DevTools → Network, check `GET /ab-tests/active/<site>` fires and there is no
    `/ab-tests/bucket`;
  - check the published copy renders.

  Repeat on `main` for the "before" shot, which should show `rcf_vid` with a one-year expiry.
  The working-tree `AGENTS.md` requires this `/before-and-after` pair for any
  `public/embed/` change. It belongs in the PR body.
- **The active-test path against a real API.** Bucket, variant swap and the `view` beacon were
  only ever mocked. `navigator.sendBeacon` is absent in jsdom, so the test exercises the
  `fetch` fallback, not the beacon path real browsers use. The A/B feature is parked (its
  result tables are documented as never created), so a real end-to-end run needs a seeded
  active test. With one: load the page, see `rcf_vid` written once, see
  `/ab-tests/bucket?...&visitor_id=<that id>`, then reload and see the same id with no new
  write.
- **Sandboxed iframes and cookie-blocking browsers** (Safari private mode, a CMP intercepting
  `document.cookie`). Not run. Embed the test page in `<iframe sandbox="allow-scripts">` with no
  test active, and check the console shows no error and the copy renders.
- **The `handleABTestUpdate` path over a real socket.** Only the direct method call was tested,
  because no server emits the event.
- **Legal sufficiency.** The widget still reads `sessionStorage` / `localStorage` for edit-link
  and editor-grant keys on every load (out of scope by plan). Whether that matters for consent is
  a product and legal call (s54's owner list), not something code review can settle.
- **The `main` baseline test count.** I did not re-run it. The branch shows 0 failures.

## Verdict

## Product owner disposition (orchestrator, 2026-09-28)

All three minors accepted: F1 needs an empty `rcf_vid=` cookie the embed never writes; F2 needs an
`ab-test-update` event no server emits today (revisit if A/B ships); F3 is a plan-doc prediction only.


Max severity: minor
Ship allowed: yes
