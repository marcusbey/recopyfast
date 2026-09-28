# Research — Story s55-no-visitor-cookie-by-default

Researched on `main` at `3235618`. Line numbers are `public/embed/recopyfast.src.js` unless a
file is named. Byte figures come from `scripts/build-embed.mjs` itself, which uses Node
`zlib.gzipSync` level 9. They were measured on a scratch copy of the build, never on the repo
tree.

## The five structuring facts

1. **The cookie is minted on every visitor load only because of call order.** `init()` calls
   `this.initVisitorId()` at `:957`, one line before `await this.fetchActiveTests()` at `:958`,
   inside `if (!this.stagingMode)` (`:956`). `initVisitorId` (`:3218-3238`) is the only
   `document.cookie` access in the whole artifact. The source has two, a read at `:3220` and a
   write at `:3237`, and the bundled socket.io-client has none.
2. **Both call sites of the A/B pipeline go through `bucketVisitor`, which already returns when
   no test is active.** The two callers are `init` at `:959` and `handleABTestUpdate` at
   `:3506-3507`. The guard is at `:3255`: `if (!this.activeTests.length || !this.visitorId)
   return;`. If the id is minted there, one line covers both callers. The obvious fix is to gate
   it in `init` alone ("variant E" below). That misses the second caller: after a load with no
   tests, `visitorId` stays `null`, and the `!this.visitorId` guard makes a test that goes
   active later bucket nobody. It also measured **+7 / +10 gz**, which fails the gate.
3. **Nothing on the server needs a visitor id unless a test is active.** `fetchActiveTests`
   (`:3240-3252`) sends only the site id and token. `src/app/api/ab-tests/active/[siteId]/route.ts`
   never reads a visitor id. Only two server paths read `visitor_id`:
   - `src/app/api/ab-tests/bucket/[siteId]/route.ts:32-38` answers 400 without one;
   - `src/app/api/ab-tests/track/route.ts:195-202` rejects an event without one.

   The widget reaches bucket only when `activeTests` is non-empty, and track only when a variant
   is assigned. The words `rcf_vid` and `visitor` appear nowhere in `server/`, `src/middleware.ts`
   or `src/app/api/content/[siteId]/route.ts`. **No server change.**
4. **The byte gate has zero headroom, and the recommended change pays for itself.** `--check`
   on `main` prints `bundle 45883 B (max 45883) | widget 33122 B (max 33122)`. The recommended
   change measured **45880 / 33120, which is −3 bundle / −2 widget**. Twelve builds whose sources
   differed only by a trailing comment spanned 45877–45881 and 33116–33121. That spread comes
   from the banner's sha256 marker, which changes whenever the source changes. The spread never
   crossed a ceiling. The ratchet procedure then lowers both constants to the final measured
   value.
5. **`initVisitorId` must become idempotent, and an existing suite already enforces this.**
   `src/__tests__/embed/ab-bucketing-parity.test.ts:128-136` and `:358-367` slice the A/B block
   out of the source, preset `visitorId`, and call `bucketVisitor()` directly. An unguarded
   mint inside `bucketVisitor` ("variant B") overwrites the preset id. It then fails "assigns
   what the server would assign, for the same visitor" (measured). Adding
   `if (this.visitorId) return;` as the first line of `initVisitorId` fixes that. It also keeps
   one id per page when `handleABTestUpdate` repeats.

## Target story

`docs/stories.md:2004-2026`. Complexity 2. Branch `feature/s55-no-visitor-cookie-by-default`.
Embed allocation ≤ 0 bytes. The product owner decided this on 2026-09-28, from the s54
research, and it is launch-relevant.

- **AC1.** On a page load where the site has no active A/B test, the embed reads no cookie,
  writes no cookie, and generates no visitor id. Published copy still applies exactly as
  before.
- **AC2.** The embed creates or reads `rcf_vid` only when `fetchActiveTests` returns at least
  one active test. The A/B pipeline then behaves as it does today.
- **AC3.** The artifact is rebuilt from the source (`recopyfast.js` is never hand-edited), the
  byte gate passes, and the embed does not grow.
- **AC4.** Tests cover both paths: with no tests, `document.cookie` is untouched; with an active
  test, the cookie is set. The required local gates pass, and the work lands in one story
  commit.

## Current state of the code

- **Widget fields** (`:914-918`). `activeTests = []`, `variantAssignments = {}`,
  `visitorId = null`, `geoData = null`.
- **`init()` order** (`:923-985`):
  1. `waitForDOM`
  2. staging or editor auth
  3. `whenFontsReady`
  4. `scanForContent`
  5. `hydrateStoredContent` at `:953`, which applies published copy
  6. the A/B pipeline at `:955-963`: `initVisitorId`, `fetchActiveTests`, `bucketVisitor`,
     `applyVariants`, `setupClickTracking`, `trackImpressions`
  7. `establishConnection` at `:965`
  8. `sendContentMap` at `:976`
  9. `setupMutationObserver` at `:978`

  Everything runs in one `try`, whose `catch` at `:982-984` logs the error and stops.
- **`initVisitorId()`** (`:3218-3238`). It splits `document.cookie` on `;` and adopts the first
  `rcf_vid=` value. If there is none, it mints `crypto.randomUUID()`, or falls back to
  `'rcf-' + Date.now() + random`. It then writes
  `rcf_vid=<id>; path=/; max-age=31536000; SameSite=Lax`. The function is not idempotent: each
  call re-reads the cookie, and if the write never stuck, it mints a new id.
- **`fetchActiveTests()`** (`:3240-3252`). It sends
  `GET {API}/ab-tests/active/{SITE_ID}?token=…` and sets `activeTests = data.tests || []`. A
  non-ok answer returns and leaves the previous value in place. A network error sets `[]`.
- **`bucketVisitor()`** (`:3254-3338`). It returns when there are no tests or no id. It then
  calls `GET …/ab-tests/bucket/{SITE_ID}?token=…&visitor_id=…`:
  - a 200 fills `variantAssignments` and `geoData`;
  - a non-ok answer empties `activeTests`;
  - a network throw falls back to FNV-1a over `visitorId + ':' + test.id` (`:3299`).
- **Readers of `visitorId` after the pipeline.** Every one is downstream of `bucketVisitor`, or
  guarded by a `variantId` that only `bucketVisitor` can populate:
  - `setupClickTracking` (`:3418`, `:3424`);
  - `trackImpressions` (`:3439`, `:3445`);
  - `trackConversion` (`:3463`, `:3469`). This one is also public, as
    `window.recopyfast.trackConversion` (`:6234-6236`). With no tests, its
    `activeTests.forEach` does nothing.
- **`handleABTestUpdate(data)`** (`:3502-3518`). On `active`, it runs `fetchActiveTests()`, then
  `bucketVisitor()`, then `applyVariants`, `setupClickTracking` and `trackImpressions`. The
  promise chain has no `.catch`. It is reached only through `socket.on('ab-test-update')`
  (`:2997-2999`). No tracked code outside tests emits that event:
  - `git grep "ab-test-update" -- server src ':!src/__tests__'` finds nothing;
  - `server/index.js:547-557` records that the socket relay was removed;
  - `src/__tests__/websocket/server.integration.test.ts:1004-1022` pins it as not relayed.

  So today this call site is unreachable, but the story still requires covering it.

## Anchor points

- **`public/embed/recopyfast.src.js`.** Three edits:
  1. delete `:957`;
  2. at `:3255`, the guard becomes `if (!this.activeTests.length) return;`, followed by
     `this.initVisitorId();`;
  3. `initVisitorId` gets `if (this.visitorId) return;` as its first line.

  Every edit stays between the `// A/B TESTING METHODS` (`:3215`) and
  `// END A/B TESTING METHODS` (`:3521`) markers, apart from the deletion in `init`.
- **`public/embed/recopyfast.js`.** Regenerated by `npm run build:embed`.
- **`scripts/build-embed.mjs:168-169`.** `MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ` are lowered to the
  measured values. A dated `RATCHETED DOWN` block goes above them, in the form of the s39, s40
  and s41 blocks (`:110-167`).
- **`src/__tests__/embed/build-size-gate.test.ts:82-83`.** `SEEDED_MAX_BUNDLE_GZ` and
  `SEEDED_MAX_WIDGET_GZ` are lowered to the same pair, with one comment line in the form of
  `:77-81`.
- **New `src/__tests__/embed/visitor-cookie.test.ts`.** It covers both paths.

## Verified APIs / functions

| Symbol | Signature / behaviour | Location |
|---|---|---|
| `initVisitorId()` | sync, no return value; reads then writes `document.cookie` | `:3218-3238` |
| `fetchActiveTests()` | `async`; never throws; sets `this.activeTests` | `:3240-3252` |
| `bucketVisitor()` | `async`; its only throw risk comes before its `try`, and after s55 that means `initVisitorId` | `:3254-3338` |
| `handleABTestUpdate(data)` | `data.status` is `'active'` or `'completed'`; `data.test_id` | `:3502-3518` |
| `window.ReCopyFast` | the widget instance; tests call `handleABTestUpdate` on it directly | constructed at the bottom of the IIFE |
| `GET /api/ab-tests/active/[siteId]` | token auth, rate-limited per site (fail closed), `{ tests: [...] }`, no visitor input | `src/app/api/ab-tests/active/[siteId]/route.ts` |
| `GET /api/ab-tests/bucket/[siteId]` | `visitor_id` is required (400 without it) | `src/app/api/ab-tests/bucket/[siteId]/route.ts:32-38` |
| `POST /api/ab-tests/track` | each event requires `visitor_id` | `src/app/api/ab-tests/track/route.ts:195-202` |
| `node scripts/build-embed.mjs --check` | exits non-zero on a stale artifact or an exceeded ceiling; prints the `gzipped` line | `scripts/build-embed.mjs:458-498` |
| `RCF_EMBED_CEILING_OVERRIDE` | can only tighten a ceiling, never raise one | `scripts/build-embed.mjs:171-184`, `:365-395` |

**The test harness is verified.** A scratch prototype, outside the repo, sits at
`$SP/s55-proto/src/__tests__/embed/zz-proto-visitor-cookie.test.ts`, where `$SP` is the
session scratchpad. It boots the real source the way `content-attributes.test.ts:53-96` does:
`new Function(WIDGET_SOURCE)()`, a `jest.fn` fetch that computes rows lazily, and
`document.currentScript` defined as an own property. It stubs the cookie the same way:
`Object.defineProperty(document, "cookie", { configurable: true, get, set })` shadows the
`Document.prototype` accessor, and `delete document.cookie` in `afterEach` restores it.

- **On `main`:** the no-test case is red, because the getter was called once. The active-test,
  existing-cookie and second-call-site cases are green, which confirms they describe today's
  pipeline.
- **With the recommended change:** all four prototype cases are green. With the artifact rebuilt
  and the ceilings ratcheted, all 17 embed suites and 209 tests are green.

jsdom has no `navigator.sendBeacon`, so tracking goes through the `fetch(…, { keepalive: true })`
fallback (`:3491-3498`), where the fetch mock sees it. `jest.setup.js` stubs neither cookies,
nor `sendBeacon`, nor `crypto`.

## Traps & constraints

- **Parity slicer.** `ab-bucketing-parity.test.ts:33-35` finds the A/B block by its marker
  comments and evaluates it as a class. `initVisitorId` must stay inside the markers, and the
  markers must not be renamed. The idempotency guard is what keeps that suite green (fact 5).
- **Zero headroom.** Any variant that adds bytes is red on arrival. Measured on scratch copies
  (bundle / widget):

  | Variant | Change | Result |
  |---|---|---|
  | E | gate in `init` only | 45890 / 33132, **over** |
  | A | `this.visitorId \|\| this.initVisitorId()` in `bucketVisitor` | 45882 / 33121 |
  | **D, recommended** | guard inside `initVisitorId` | **45880 / 33120** |
  | B | unguarded | 45876 / 33115, breaks parity |
  | D + fallback | also drop the three redundant `\|\| !self.visitorId` checks at `:3418`, `:3439`, `:3463` | 45870 / 33109 |

- **Hash-marker noise.** The widget measurement includes the banner line
  `// @generated-from-sha256 <hex>` (`build-embed.mjs:289-298`), so a comment-only source edit
  moves the gz figure by a few bytes. For example, D with a sample tombstone comment measured
  45880 / 33118. **Ratchet to the final committed build's `--check` line**, never to a figure
  from this document.
- **Comments are free.** esbuild minifies with `legalComments: "none"`, so the house-style
  tombstone costs nothing beyond the hash noise above.
- **`npm test` goes red between the source edit and the rebuild.** `build-size-gate.test.ts`
  runs `--check` against the committed artifact, and 8 of its tests fail on a stale artifact
  (measured). That is expected until the artifact is rebuilt.
- **`npm run build` rebuilds the artifact.** `prebuild` runs `build:embed`. The output is
  deterministic, so a second build must leave `git diff public/embed` unchanged.
  `socket.io-client.min.js` is rewritten with identical bytes.
- **A cookie access can throw.** A sandboxed iframe without `allow-same-origin` throws on any
  `document.cookie` access. The widget already defends against this for storage
  (`:213-227`: "Storage throws … with cookies blocked outright"), but `initVisitorId` has no
  `try`.
  - **Today:** such a throw at `:957` aborts `init` after hydration. `establishConnection`,
    `sendContentMap` (discovery) and `setupMutationObserver` never run.
  - **After s55:** this happens only on a site with an active test, which is unchanged
    behaviour on that path.
  - **Residual:** on the socket path, a throw inside `bucketVisitor` would reject a chain that
    has no `.catch`. That path is unreachable today (no emitter).
- **ADR 016 is accepted but only half implemented.** It makes `rcf_vid` the A/B identity "for
  A/B alone" (§1, §4). Its Do Not Track and cookie-refusal paths (§2-3) are `s11c` scope and
  are not in the code (`grep doNotTrack` finds nothing). s55 narrows *when* the id is minted and
  contradicts nothing in the ADR, so no new ADR is needed. ADRs 015 and 016 describe the
  unconditional write as the state at the time. They are immutable and stay as written.
- **Adjacent storage access is out of scope.** It is not a cookie, the story does not cover it,
  and it must not be touched here. On every load, the widget reads
  `sessionStorage['rcf_edit_link:<site>']` (`:133-136`) and the editor-grant key in
  localStorage or sessionStorage (`:201`, `:229-231`).
- **Cross-story state.**
  - Four stories are in flight: `feature/s47a`, `s49`, `s51` and `s54`. `git diff main...<branch>`
    shows none of them touching `public/embed/`, `build-embed.mjs` or `build-size-gate.test.ts`.
  - If one lands first with embed bytes, rebase, rebuild, re-measure, and ratchet to the merged
    measurement (the s41 precedent, `build-embed.mjs:149-167`).
  - s54's plan lists the cookie as out of scope and puts it on its owner list (item 9). s55 is
    the "candidate product fix" that item names.
- **Lint.** `@typescript-eslint` rejects `any`. Follow the existing embed tests and use
  `window as unknown as { ReCopyFast: … }`.
- **Evidence at ship.** The working-tree `AGENTS.md` (uncommitted on `main`) requires
  before/after evidence of a real page still rendering for any `public/embed/` change.

## Open questions

1. **Should the embed clear `rcf_vid` cookies it has already set?** Recommendation: **no**.
   Deleting is itself a cookie write, which AC1 forbids, and it costs bytes. `max-age` is never
   refreshed (`initVisitorId` returns early when the cookie exists), so each existing cookie
   expires one year after it was minted. The product has 0 users.
2. **Should `initVisitorId` be wrapped in `try` / `catch` for sandboxed frames?**
   Recommendation: **no**. It is out of scope, it costs bytes, it leaves the active-test path
   unchanged, and the socket-path residual is unreachable. The reviewer should see it named, not
   discover it.
3. **Should the per-load `GET /ab-tests/active` request stop as well?** Recommendation: **no, not
   here**. It carries no identifier, AC2 depends on it, and the s54 owner list can track it
   separately.
4. **Test file name.** `visitor-cookie.test.ts` is proposed; it is the planner's call.

## Real complexity

Scored **2** in `docs/stories.md`, and **2** after research. The change is a moved call and a
one-line guard, with no server, schema or UI work. Two things carry the weight:

- choosing the one placement that covers both call sites and fits in zero headroom (the obvious
  placement fails on both counts);
- the mandatory ratchet.

Both are measured above.

## Split proposal

None. The story closes in a single commit.
