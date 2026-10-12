# Review — s96c-streamed-html

Pending: the reviewer has not run yet. This file holds the implementer's verification, the
mutation results, and the known minor that the brief asked to record. The diff to review is
`git diff origin/main...fix/s96c-streamed-html` (base `c905292`).

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

- **Table-mode segments stay hidden.** React writes a Suspense boundary directly inside a table
  as `<table hidden><tbody id="S:…">`. The `hidden` is on an element without a segment id, so it
  stays hidden. This is rare: a boundary must sit inside a `<table>`.
- **Inline links with no whitespace between them merge into one word** ("FeaturesPricingDemoTry
  your siteBlog" in the fixture's nav). This is s96 behaviour on every page, not only streamed
  ones. Capitalised words are never flagged, so it produces no finding.

Max severity: pending
Ship allowed: pending
