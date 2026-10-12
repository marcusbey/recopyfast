# Review — s96c-streamed-html

Reviewed: see "Independent review of d513552" below. The first sections hold the implementer's
verification of d513552, its mutation results and the known minor the brief asked to record. The
fix pass that followed the review (Devin's table-mode segments, the reviewer's three missing
guards, the skipped-fallback note) is recorded in `docs/plans/s96c-streamed-html.md`, Task 7.
The diff is `git diff origin/main...fix/s96c-streamed-html` (base `c905292`).

## What changed

`src/lib/tools/extract/extract-page.ts` does two things, both explained in tombstone comments:

1. It reads a React streaming segment as visible content, where the segment sits. A segment is
   an element with `hidden` and an `id` matching `/^S:[0-9a-f]+$/`.
2. Inside the existing iterative walk, it skips the fallback of a pending boundary. That fallback
   runs from `<!--$?--><template id="B:<hex>">` to the matching `<!--/$-->`, with depth counted
   the way React's `$RV` counts it. Each node costs O(1), and every cap is unchanged.

Everything else is test code and story docs. There is no API, schema, embed, migration or
dependency change.

**Declared deviation from the brief:** the brief's id pattern was `/^S:\d+$/`, but React writes
segment ids with `id.toString(16)`. Both copies show it: `react-dom` 19.1.0 and Next 16.3.8's
compiled `react-dom-server.node.production.js:2454-2465`. So the pattern is hexadecimal, and a
test pins `S:a`. See `docs/research/s96c-streamed-html.md`.

## Before and after, on the full live page

The same 70,387-byte `curl -s https://www.recopyfa.st/terms`, through the real extractor and lens
(`tsx`, scratch script, not committed):

| | blocks | words | "Loading…" read | lens verdict |
|---|---|---|---|---|
| `origin/main` | 1 | 1 | yes | skipped: "This page shows almost no text in its HTML…" |
| this branch | 111 | 854 | no | "No likely typos on the 1 page we checked" |

## Mutations

Each mutation was applied to `extract-page.ts` alone. The extract, typo-lens and run-scan suites
were then run (220 tests).

| Mutation | Result |
|---|---|
| 1. Segment waiver removed from `isHidden` | killed, 7 red (both fixture tests, multi/nested/hex, links and images, React-shape, lens, run-scan) |
| 2. Fallback skip never starts | killed, 7 red (fixture "Loading…", React-shape, fallback-only word count, nested closer, inline separator, unclosed, lens "almost no text") |
| 3. Segment id `\d+` instead of hex | killed, 1 red (`S:a`) |
| 4. No depth counting (first closer ends the skip) | killed, 1 red |
| 5. No word separator where a fallback starts | killed, 1 red |
| 6. A parent's end does not stop an unclosed skip | killed, 1 red |
| 7. `<!--$!-->` also opens a skip | **survived: equivalent.** React writes `<!--$!--><template data-dgst="…">` with no `B:` id (`react-dom-server.node.production.js:6952-6965`), so the template check still refuses it |
| 8. Any next sibling opens a skip (template check removed) | killed, 1 red |
| 9. A segment also ignores `aria-hidden` and `display:none` | killed, 2 red |

The ordinary-`hidden` guards (9 cases) passed before the fix, as did the
"client-rendered boundary / lone `B:` template" test. That is by design: they guard what must
not change. Mutations 8 and 9 show they are sensitive.

## Verification

- **Jest** (`NEXT_PUBLIC_APP_URL=http://localhost:3000 npm test`): 484 suites passed and 2
  skipped. 6,929 tests passed and 38 skipped. That is 22 more tests than s96's 6,907: 19 in the
  extractor, 2 in the lens and 1 in run-scan.
- **Type-check:** `type-check` and `type-check:build` are clean.
- **`npm run lint`:** 0 errors and 34 warnings, the same as s96's baseline. None is in a changed
  file: `eslint --max-warnings=0` on the five changed TS files is clean.
- **`format:check`:** clean. `docs/stories.md` was appended by hand and never formatted.
- **`npm run build`:** passes.
- **Embed check (`npm run build:embed -- --check`):** up to date. The bundle is 45,818 B (max
  45,818) and the widget 33,059 B (max 33,059).
- **Playwright `--list`:** 97 tests in 19 files, unchanged.

## Known minor, recorded and not fixed (per the brief)

**A report id that does not exist returns HTTP 200.**
`curl https://www.recopyfa.st/tools/website-spell-checker/r/00000000-0000-4000-8000-000000000000`
returned `200` on 2026-10-12, with the not-found UI (`NEXT_HTTP_ERROR_FALLBACK;404` in the
payload) and `<meta name="robots" content="noindex">`. The root `src/app/loading.tsx` streams
the shell, and its status, before `notFound()` runs (`src/app/tools/[slug]/r/[id]/page.tsx:51`).
The page is not indexed and shows the right UI. The status code is the only thing wrong. The
brief accepts this for now.

## Seen in passing, not changed

- **Table-mode segments stayed hidden in d513552.** React writes a Suspense boundary directly
  inside a table as `<table hidden><tbody id="S:…">`. The `hidden` is on an element without a
  segment id, so it stayed hidden. Fixed in the fix pass (plan, Task 7).
- **Inline links with no whitespace between them merge into one word** ("FeaturesPricingDemoTry
  your siteBlog" in the fixture's nav). This is s96 behaviour on every page, not only streamed
  ones. Capitalised words are never flagged, so it produces no finding.

## Independent review of d513552

Fresh-context reviewer, 2026-10-12. Read-only on code. Diff judged:
`git diff origin/main...fix/s96c-streamed-html` (base `c905292`, head `d513552`).

### Re-run, not taken on trust

- `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx jest src/lib/tools --silent`: 20 suites and
  518 tests passed.
- `tsc --noEmit` and `tsc --noEmit -p tsconfig.build.json` both exited 0. `eslint
  --max-warnings=0` and `prettier --check` on the 5 changed TS files were clean.
- `gh pr checks 95` at review time: Lint, Test & Build passed, TypeScript Type-Check incl.
  tests passed, Built Embed Fixture passed, and the Realtime audit passed. **E2E (Playwright)
  and Comparison Lighthouse were still pending.**
- The before and after numbers hold. I ran a fresh `curl -s https://www.recopyfa.st/terms`
  (200, 70,387 B) through `origin/main`'s extractor: 1 block, 1 word, "Loading…". Through this
  branch: 111 blocks, 854 words, no "Loading…", 9 same-host links.
- The fixture's `<body>` shell, from `<body class="font-sans">` through the closer, matches the
  live page byte for byte. So do its markers: one `<!--$?-->`, `B:0`, `<div hidden="">`,
  `<div hidden id="S:0">` and `$RC("B:0","S:0")`.

### 1. Correctness against the shipped React and Next (Next 16.3.8, react-dom 19.1.0)

I checked these in `node_modules/next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js`:

- `startPendingSuspenseBoundary1` is `<!--$?--><template id="`, followed by `boundaryPrefix`
  and `id.toString(16)` (`:2400-2425`). `endSuspenseBoundary` is `<!--/$-->`, and
  `startClientRenderedSuspenseBoundary` is `<!--$!-->` (`:2399-2406`).
- `writeStartSegment` writes `<div hidden id="` + `segmentPrefix` + `id.toString(16)` in the
  HTML modes (`:2455-2470`). The prefixes are `idPrefix + "S:"` and `idPrefix + "B:"`
  (`:390-391`). Ids are hexadecimal, as claimed.
- The shipped `$RV` opens a level on `$`, `$?`, `$~`, `$!` and `&`. It closes one on `/$` and
  `/&`, and it breaks at depth 0. `depthAfter` mirrors it exactly.
- I probed the branch extractor directly:
  - A completed inline `<!--$-->…<!--/$-->` is read.
  - A `<!--$!-->` client-rendered boundary is read.
  - Activity `<!--&-->` nested in a fallback is skipped with it.
  - A stray `<!--/$-->` before a boundary is harmless.
  - `<table hidden id="S:0">` (table mode 6) is read.

### 2. Hostile input

- **Text injection via `<div hidden id="S:0">`.** A site can now get hidden text into its own
  report. It could already do that with visible text, so this adds nothing new. Finding text
  is rendered as React text. There is no `dangerouslySetInnerHTML` under `src/app/tools` or
  `src/components/tools` other than JSON-LD from constants, and `serializeJsonLd` escapes `<`.
  `tools-no-raw-html.test.ts` pins this. Reports are `noindex, nofollow`. **No XSS path.**
- **An unbalanced `<!--$?--><template id="B:0">`** skips the rest of its parent. At `<body>`
  level that is the whole page, segments included. Only that site's own check is affected, and
  "almost no text" is the honest result.
- **Cost is linear and the caps hold.** Peeking at the next frame is O(1), and skipped nodes
  push no children. Measured:
  - 60k unclosed boundaries: 185 ms.
  - 60k balanced boundaries: 215 ms.
  - 1 boundary followed by 300k nested `<!--$-->`: 141 ms.
  - 90k segments: 234 ms, capped at `MAX_BLOCKS` 2,000.

  `MAX_ELEMENTS`, `MAX_TREE_DEPTH`, the parse budget and `MAX_BODY_BYTES` (2 MB) are untouched.
  Nothing loops.

### 3. Links inside segments and page sampling

Segment links enter `rawLinks`. From there they pass the unchanged same-host filter in
`extractPage`, then `selectPages` (`normalizeScanUrl`, hostname equality, and an
`isAllowedPort` check). Each sampled URL is then fetched through the same `safeFetch` options:
the robots authorizer, the per-registrable-domain charge (`createTargetAuthorizer`), the
denylist, `MAX_REQUESTS_PER_SCAN` and the deadline. The s96 guards still apply in full, and the
run-scan test shows `/privacy` sampled from inside the segment.

### 4. Tests bite: my own neutralizations

Each mutation was applied alone to `extract-page.ts`. I then ran the extract, typo-lens and
run-scan suites (157 tests), restored the file, and confirmed `git diff --exit-code` was clean:

| Mutation | Red |
|---|---|
| M1. Segment waiver dropped from `isHidden` | 7 |
| M2. `opensPendingFallback` never fires | 7 |
| M3. Openers never deepen (no depth counting) | 1 |
| M4. A parent's exit does not end the skip | 1 |
| M5. No separator at the fallback's start | 1 |
| M6. Segment id `\d+` instead of hex | 1 |
| M7. `B:<hex>` id check removed (any `<template>` after `<!--$?-->` opens a skip) | **0** |
| M8. Openers reduced to `$`/`$?`, closers to `/$` | **0** |
| M9. `comment.data === "$?"` check removed | **0** |

M1 through M6 confirm the implementer's table. Note that their mutation 8 removed the whole
template check, which is a different mutant from M7. The tree was clean after every run.

### Findings

- **minor: three narrowing clauses are untested (M7, M8, M9).** A `<!--$?-->` before a
  non-`B:` template, a `$!` nested inside a fallback, and an arbitrary comment before
  `<template id="B:0">` change no test result. React never emits the first and third, so the
  real-world impact is small. A `<!--$!-->` inside a loading fallback is possible, though, and
  dropping `$!` from the openers would end the skip early and read the rest of the fallback.
  Add three one-line cases next cycle.
- **minor: table-body, row and colgroup segments stay hidden while their fallback is now
  skipped.** Devin flagged this on the PR too. It drops loading text only, not copy that was
  read before. It is documented above, so I accept it.
- **minor: a skipped fallback also bypasses `readHead` and `readImage`.** Script and stylesheet
  sources, meta tags and images inside a fallback are no longer recorded. So are those after an
  unclosed `<!--$?-->`. The Typo Finder is unaffected. s97 (CSP) and s101 (alt text) should
  know this before relying on `scriptSrcs` and `images` from streamed pages.
- **minor (process): branch `fix/s96c-streamed-html`.** AGENTS.md says `feature/<id>`. The plan
  records that the orchestrator chose the name.
- **nit: the fixture docblock overstates its fidelity.** It says "Head, shell, scripts and
  markup are copied byte for byte". The head was trimmed as the plan asked: 18 scripts became
  2 and 2 stylesheets became 1. The elements that were kept are byte-identical.
- **nit: React's `identifierPrefix` is not handled.** Ids such as `xS:0` stay hidden, as
  before, and the `xS:0` guard test pins this. Next sets no prefix.

Every plan task (1 to 6) is present in the diff, and the diff adds nothing the plan did not ask
for. No existing test was modified. No accepted ADR is touched: ADR 062 covers report reads,
not extraction.

### Not verified, and what a human should do instead

- **E2E (Playwright) and Lighthouse CI were pending at review time.** Confirm they are green.
- **Local gates.** I did not run the full `npm test`, `npm run build`,
  `build:embed -- --check` or `playwright --list` locally. CI's "Lint, Test & Build" and
  "Built Embed Fixture" cover them.
- **The deployed tool, end to end.** I never ran it, because that would mean a scan POST, the
  rate limiter and a stored report row. After deploy, run the Typo Finder on
  `https://www.recopyfa.st/terms` and on one third-party App Router site with nested Suspense.
  Confirm that real copy is checked and "Loading…" is absent. Then open the report and confirm
  that finding text renders as plain text.
- **Other renderers.** Not tested: React 18 output, other `renderToPipeableStream` frameworks
  that may set `identifierPrefix`, Next PPR / `cacheComponents` resume output, and a stream
  aborted after a partial-boundary flush. In that last case, hidden segments that are never
  revealed could be read.

Max severity: minor
Ship allowed: yes
