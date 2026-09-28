---
validated: yes
---
# Plan — Story s55-no-visitor-cookie-by-default

Branch: `feature/s55-no-visitor-cookie-by-default`
Research: `docs/research/s55-no-visitor-cookie-by-default.md`. Read it first; this plan does not
repeat it. Line numbers are `public/embed/recopyfast.src.js` on `main` at `3235618` unless a
file is named.

## Target story

`docs/stories.md:2004-2026`. Complexity 2. Embed allocation ≤ 0 bytes. No server change.

- **AC1.** On a page load where the site has no active A/B test, the embed reads no cookie,
  writes no cookie, and generates no visitor id. Published copy still applies exactly as
  before.
- **AC2.** The embed creates or reads `rcf_vid` only when `fetchActiveTests` returns at least
  one active test. The A/B pipeline then behaves as it does today.
- **AC3.** The artifact is rebuilt from the source, the byte gate passes, and the embed does
  not grow.
- **AC4.** Tests cover both paths. The required local gates pass, and the work lands in one
  story commit.

This plan takes these decisions from the research's open questions. The owner confirms them at
validation:

- **Q1.** Cookies that already exist are left to expire, not deleted.
- **Q2.** `initVisitorId` gets no `try` / `catch`.
- **Q3.** The `GET /ab-tests/active` request stays.
- **Q4.** The new test file is `src/__tests__/embed/visitor-cookie.test.ts`.

## Before task 1

- **Worktree.** Create it and install:

  ```
  git worktree add .omx/worktrees/s55-no-visitor-cookie-by-default -b feature/s55-no-visitor-cookie-by-default main
  cd .omx/worktrees/s55-no-visitor-cookie-by-default && npm run setup
  ```

  Do not start Supabase. The shared local stack belongs to other stories.
- **Environment for every Jest, build and commit command.** Set `SP` to
  `/private/tmp/claude-501/-Users-marcusbey-Desktop-02-CS-05-Startup-recopyfast/778b4678-01ef-4a37-bb35-2f2282f4350c/scratchpad`.
  Then run:

  ```
  source $SP/ci-env.sh
  export RCF_TEST_SUPABASE_CONFIG=$SP/dead-supabase.toml
  ```
- **Docs.** Copy the untracked research and this plan from the main tree into the worktree.
  They travel in the story commit.
- **Baseline.** Record:
  - the `npm test` pass/fail/gated counts;
  - the `node scripts/build-embed.mjs --check` line, which should be
    `bundle 45883 B (max 45883) | widget 33122 B (max 33122)`.
- **Reference.** `$SP/s55-proto/src/__tests__/embed/zz-proto-visitor-cookie.test.ts` is a working
  scratch prototype of Task 1's harness. Adapt it; do not copy its `any` casts.

## Tasks (ordered)

1. [x] **Tests for both paths, first (RED).**

   Create `src/__tests__/embed/visitor-cookie.test.ts`. Open it with a header comment in the
   house style: why `rcf_vid` used to be minted on every visitor, and why that is a
   cookie-consent exposure for every customer.

   **Harness.** Boot the real source as `content-attributes.test.ts:53-96` does:
   - `new Function(WIDGET_SOURCE)()`;
   - `document.currentScript` defined as an own property;
   - `RECOPYFAST_WS` deleted, so no socket.

   Then add:
   - **A cookie jar.** `Object.defineProperty(document, "cookie", { configurable: true, get, set })`
     with `jest.fn` accessors backed by a string. `afterEach` runs `delete document.cookie`.
   - **A fetch mock.** It answers:
     - `/content/<site>?` with a lazily built row that gives the `<h1>` "Published copy";
     - `/ab-tests/active/` with `{ tests }`, a failure, or a throw, depending on the case;
     - `/ab-tests/bucket/` with `{ assignments: { [TEST_ID]: VARIANT_ID } }`.

     It records every URL, and the body of `/ab-tests/track`.
   - **Typed casts only**, such as `window as unknown as { ReCopyFast: … }`. No `any`.

   **Cases:**

   - **(a) No active test.** `/ab-tests/active` answers `{ tests: [] }`.
     - The getter and the setter are never called.
     - `ReCopyFast.visitorId` is `null`.
     - No `/ab-tests/bucket/` or `/ab-tests/track` request is made.
     - The `<h1>` reads "Published copy".
   - **(b) The lookup fails.** `it.each` over a 500 and a thrown network error. The assertions
     are the same as (a).
   - **(c) One active test, empty jar.**
     - The setter is called exactly once, with a value matching
       `^rcf_vid=[^;]+; path=/; max-age=31536000; SameSite=Lax$`.
     - `visitorId` equals that id.
     - The bucket URL carries `visitor_id=<id>`.
     - The `<h1>` shows the variant content.
     - The `view` event in the track body carries `visitor_id: <id>`.
   - **(d) One active test, returning visitor.** The jar holds
     `other=1; rcf_vid=returning-visitor`.
     - The setter is never called.
     - The bucket URL carries `visitor_id=returning-visitor`.
   - **(e) The second call site** (`handleABTestUpdate`, `:3502-3518`).
     1. Boot with no tests. The setter has not been called.
     2. Make `/ab-tests/active` return one test, call
        `ReCopyFast.handleABTestUpdate({ status: "active", test_id })` directly, and settle.
        The setter has been called once, and the bucket URL carries the new id.
     3. Call `handleABTestUpdate` again and settle. The setter has still been called once, and
        `visitorId` is unchanged.

   **Run** `npx jest src/__tests__/embed/visitor-cookie.test.ts`. It is RED only on (a) and (b),
   because the getter was called once. (c), (d) and (e) pass on `main`: they pin today's
   pipeline. Record the output. If anything else fails, the harness is wrong; fix the harness,
   not the expectation.

2. [x] **Mint the id only once a test is active (GREEN).** Make three edits to
   `public/embed/recopyfast.src.js`, and nothing else in it:

   1. **Delete `this.initVisitorId();` at `:957`.** Rewrite the pipeline comment at `:955` to
      say the id is minted in `bucketVisitor`, and only when a test is active.
   2. **`bucketVisitor`, `:3255`.** Replace
      `if (!this.activeTests.length || !this.visitorId) return;` with
      `if (!this.activeTests.length) return;` and put `this.initVisitorId();` on the next line.
      Above it, add a tombstone comment in the house style:
      - the id and its one-year cookie were minted on every page load of every customer site,
        before anything knew whether a test was running;
      - this is the one point both callers (`init` and `handleABTestUpdate`) pass, and only past
        the guard;
      - do not move it back into `init`.
   3. **`initVisitorId`, `:3218`.** Make `if (this.visitorId) return;` the first line, with a
      comment. It must be idempotent for two reasons:
      - a repeated `handleABTestUpdate` would otherwise re-mint whenever the write did not
        stick;
      - `ab-bucketing-parity.test.ts` presets `visitorId`, and an unguarded mint overwrites it.

   **Run** `npx jest src/__tests__/embed/`. Everything is green except
   `build-size-gate.test.ts`, which fails because the artifact is stale. That is expected until
   Task 3. `ab-bucketing-parity.test.ts` must be green with its diff empty.

3. [x] **Rebuild the artifact and ratchet the ceilings down (AC3).**

   1. Run `npm run build:embed` and record the `gzipped` line. The research measured
      45880 / 33120 without the comments. Hash-marker noise puts the final figure within a few
      bytes of that, and the final figure is the one that counts.
   2. **Stop rule.** If either figure is above 45883 / 33122, apply the one pre-measured
      fallback: in `setupClickTracking` (`:3418`), `trackImpressions` (`:3439`) and
      `trackConversion` (`:3463`), change `if (!variantId || !self.visitorId) return;` to
      `if (!variantId) return;`. Comment each change: `variantAssignments` is only ever filled
      after `bucketVisitor` has minted the id. This measured 45870 / 33109. If it is still over,
      stop and report. Never raise a constant.
   3. In `scripts/build-embed.mjs:168-169`, set `MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ` to the
      measured pair. Above them, add a block in the form of the s41 block (`:149-167`):

      ```
      /*
       * RATCHETED DOWN 2026-09-28 (s55-no-visitor-cookie-by-default), from 45883 / 33122.
       *   45883 / 33122  ceilings before s55 = measured on main at 3235618
       *   −a / −b        rcf_vid minted in bucketVisitor behind the active-test guard,
       *                  initVisitorId idempotent, the init-time call removed
       *   N / M          measured on the branch — the new ceilings
       * build-size-gate.test.ts pins the same pair.
       */
      ```
   4. In `src/__tests__/embed/build-size-gate.test.ts:82-83`, set `SEEDED_MAX_BUNDLE_GZ` and
      `SEEDED_MAX_WIDGET_GZ` to the same pair, with one `// RATCHETED 2026-09-28 (s55)…` line in
      the form of `:77-81`.
   5. Run `node scripts/build-embed.mjs --check`. It is green, and it prints the new pair as both
      measured and max.
   6. Run `npx jest src/__tests__/embed/`. All 17 suites (16 existing + the new one) are green.

4. [x] **Gates, docs and the one story commit (AC4).**

   1. In the worktree, with the environment above, run:
      - `npm run lint`
      - `npm run type-check`
      - `npm run type-check:build`
      - `npm run format:check`
      - `npm test`
      - `npm run build`
   2. After the build, `git status --short public/embed` must show only the Task 3 artifact
      change. `prebuild` rebuilds deterministically, so a second build changes nothing.
      `socket.io-client.min.js` has no diff.
   3. Compare the `npm test` counts with the baseline: +1 suite, no new failures.
   4. Tick the four AC boxes at `docs/stories.md:2013-2020`, and this plan's task boxes.
   5. Run `git status` and `git diff --stat`. The diff is exactly the "Files touched" list below.
   6. Make one commit: `fix: the embed sets no visitor cookie unless an A/B test is running
      (s55)`. Its body gives the byte pair and the fallback taken or not taken, and ends with the
      attribution lines.
   7. No push, no PR.

## Run interdicts

- **No server change.** The diff under `src/app/`, `src/lib/`, `src/middleware.ts`, `server/`
  and `supabase/` is empty.
- **`public/embed/recopyfast.js` changes only through `npm run build:embed` or `npm run build`.**
  It is never hand-edited, and the `--check` staleness marker must pass.
- **The ceilings only go down.** `MAX_*` and `SEEDED_*` are lowered, never raised. No committed
  file sets `RCF_EMBED_CEILING_OVERRIDE`.
- **The diff to `src/__tests__/embed/ab-bucketing-parity.test.ts` is empty.** No existing test
  changes except the `SEEDED_*` pair and its comment in `build-size-gate.test.ts`.
- **`initVisitorId` stays between the `// A/B TESTING METHODS` markers (`:3215`, `:3521`).** The
  markers keep their text, because the parity suite slices on them.
- **No other A/B method changes**, apart from the named Task 3 fallback and only if the gate is
  red. That covers `fetchActiveTests`, `applyVariants`, `setupClickTracking`, `trackImpressions`,
  `trackConversion`, `sendTrackEvent`, `fnv1aHash` and `handleABTestUpdate`.
- **Adjacent work that stays out:**
  - Do Not Track and cookie-refusal handling (ADR 016 §2-3 belongs to `s11c`);
  - deleting existing `rcf_vid` cookies;
  - a `try` / `catch` around `initVisitorId`;
  - dropping the `/ab-tests/active` request;
  - the edit-link and editor-grant storage reads (`:133-136`, `:229-231`).
- **Leave these files unedited:** ADRs 015 and 016 (immutable), `src/app/privacy` and
  `src/app/terms` (s54), and `docs/architecture.md`.
- **No Supabase start.** No push, PR or merge.

## The point everything turns on

The id is minted inside `bucketVisitor`, after the active-test guard, by an `initVisitorId` that
has become idempotent. That single placement is the one that:

- covers both callers;
- keeps the parity suite green;
- fits a gate that has zero headroom.

Where it could be wrong, and what to compare it against:

1. **Something reads `visitorId` before `bucketVisitor` has run.** Compare against every read,
   from `grep -n visitorId`:
   - `:3261` and `:3299` are inside `bucketVisitor`;
   - `:3418`, `:3439` and `:3463` are each behind a `variantId`, and only `bucketVisitor` fills
     `variantAssignments`.

   `trackConversion` is public (`:6234`) and can run at any time. With no tests, or before
   bucketing, it finds no `variantId` and sends nothing. That is unchanged.
2. **The second caller.** Compare against `handleABTestUpdate` (`:3502-3518`) and case (e). The
   plausible wrong fix gates only in `init`. It passes (a) through (d), fails (e), and measured
   +7 / +10 gz. The research reproduced both results.
3. **The byte figure.** Compare against the final branch's `--check` line, not against the
   research's 45880 / 33120. The sha256 banner makes every source edit, comments included, move
   the figure by a few bytes. Twelve samples spanned 45877–45881 / 33116–33121.

One residual stays unfixed on purpose, and the reviewer should weigh it:

- A sandboxed frame that throws on `document.cookie` used to abort `init` at `:957`, before the
  socket came up.
- After this change, `init` completes on a load with no tests.
- A later `ab-test-update` socket event could then reject `handleABTestUpdate`'s chain, which has
  no `.catch`.
- No tracked code emits that event (`server/index.js:547-557`,
  `server.integration.test.ts:1004-1022`), so the path is unreachable today.

## Files touched

- `public/embed/recopyfast.src.js`: the three edits and their comments, plus the fallback if it
  is taken.
- `public/embed/recopyfast.js`: generated.
- `scripts/build-embed.mjs`: the constants and the ratchet note.
- `src/__tests__/embed/build-size-gate.test.ts`: the `SEEDED_*` pair and one comment line.
- `src/__tests__/embed/visitor-cookie.test.ts`: new.
- `docs/research/s55-no-visitor-cookie-by-default.md` and
  `docs/plans/s55-no-visitor-cookie-by-default.md`: new.
- `docs/stories.md`: the AC ticks only.

## Test strategy

- **Behaviour, at the level the bug lives.** Jest with jsdom boots the real
  `recopyfast.src.js` for one page load. The cookie jar is observed through own-property
  accessors on `document`, so a read and a write are each provable and separable, and AC1 says
  "reads no cookie" as well as "writes". The fetch mock proves no identifier leaves the page on
  the no-test path, and the `<h1>` proves hydration is untouched.
- **Both callers.** `init` is covered by (a) through (d), and `handleABTestUpdate` by (e),
  called directly. The socket is not in the harness, and no server emits the event.
- **Parity.** `ab-bucketing-parity.test.ts` stays as it is. It guards idempotency (research
  fact 5) and the bucketing arithmetic the pipeline still depends on.
- **Bytes.** `build-size-gate.test.ts` and `--check` against the rebuilt artifact, with the
  ratchet pinned in both files.
- **Not in Jest: a real page, at ship.** For the `/before-and-after` beat, load a static page
  with the built `recopyfast.js` and a site that has no active test. The evidence is DevTools →
  Application → Cookies showing no `rcf_vid` after load, while the published copy renders. The
  before shot is the same page on `main`.

## Definition of Done

- All four AC boxes are ticked at `docs/stories.md:2013-2020`, with the evidence in the new test
  file and the `--check` line.
- `lint`, `type-check`, `type-check:build`, `format:check`, `test` and `build` are green in the
  worktree, under `ci-env.sh` and the dead Supabase config.
- The embed shrinks or stays equal: the new ceiling pair is at or below 45883 / 33122, pinned in
  `build-embed.mjs` and in `build-size-gate.test.ts`.
- There is one story commit on `feature/s55-no-visitor-cookie-by-default`, carrying the research,
  this plan and the code. Every interdict above is verifiable in `git diff main...HEAD`.
- At ship: the `/before-and-after` real-page evidence is in the PR body, and `/ks-review` records
  `Ship allowed: yes`.
