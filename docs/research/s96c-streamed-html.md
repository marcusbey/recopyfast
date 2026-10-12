# Research — Story s96c-streamed-html

Verified against `origin/main` at `c905292` on 2026-10-12. Production was only read through public
`GET`s of `https://www.recopyfa.st` with `curl`. No credentials and no database were used.

## The bug, observed

1. `curl -s https://www.recopyfa.st/terms` returns 70,387 bytes. The visible `<body>` is the root
   `src/app/loading.tsx` skeleton inside a pending Suspense boundary:

   ```html
   <body class="font-sans"><div hidden=""><!--$--><!--/$--></div><!--$?--><template id="B:0"></template>
   <div … role="status" aria-label="Loading">…<span class="sr-only">Loading…</span></div><!--/$-->
   <script>…</script><script src="…" id="_R_" async=""></script>
   <div hidden id="S:0"> …the whole server-rendered page: header, <main>, footer… </div>
   <script>$RB=[];$RV=function(a){…};$RC=function(a,b){…};$RC("B:0","S:0")</script>
   <script>self.__next_f.push([1,"…"])</script> …
   ```

   The real page sits in `<div hidden id="S:0">`, which is 24,467 bytes, later in the same
   response.
2. `src/lib/tools/extract/extract-page.ts:198-207` (`isHidden`) treats any element with a `hidden`
   attribute as hidden, and the walk does not descend into it (`:545-549`). The only visible text
   left is "Loading…". That is one word, under `MIN_PAGE_WORDS = 20`
   (`src/lib/tools/lenses/typos/typo-lens.ts:74`). So `readPages` skips the page with
   `NO_TEXT_MESSAGE` (`:277-279`): "This page shows almost no text in its HTML — it may build its
   text with JavaScript".
3. The root `loading.tsx` wraps every route in the app, so any page whose render is slow enough
   to stream has this shape. Any Next.js App Router site with a root `loading.tsx` or a Suspense
   boundary can have it too.

## How React writes a streamed boundary (verified in the shipped code)

Next 16.3.8 renders with its own compiled React
(`node_modules/next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js`). React 19.1.0
(`node_modules/react-dom`) writes the same markup.

- **Pending boundary:** `startPendingSuspenseBoundary1 = '<!--$?--><template id="'` then the
  boundary prefix `B:`, the id and `'"></template>'` (`:2400-2403`). The fallback follows, then
  `endSuspenseBoundary = '<!--/$-->'`.
- **Segment:** `writeStartSegment` (`:2454-2465`) writes `'<div hidden id="'` + `S:` +
  **`id.toString(16)`** + `'">'` in HTML insertion modes. **Ids are hexadecimal.** The eleventh
  segment is `S:a`, so `/^S:\d+$/` would miss it. In table modes React writes
  `<table hidden id="S:…">` or `<table hidden><tbody id="S:…">`, and in SVG or MathML a
  `display:none` element.
- **Completion:** `$RC("B:" + i, "S:" + i)`. The boundary and its root segment share the same
  hex id. A segment with no boundary (`$RS`) replaces a `<template id="P:…">` placeholder and has
  no fallback.
- **The swap (`$RV`, read off the live page):** React starts at the `<template id="B:n">` and
  removes it and each next sibling. It keeps a depth count: `$`, `$?`, `$~`, `$!` and `&` open a
  level, and `/$` and `/&` close one. It stops at the closer at depth 0. Then it moves the
  segment's children in before that closer. The fallback is exactly that run of siblings.
- `<!--$!-->` marks a client-rendered (errored) boundary. Its fallback stays until the client
  renders. It is not a pending boundary.
- With no `identifierPrefix` the ids carry no prefix. The live page shows `B:0` and `S:0`.

## Traps

- **Ordinary `hidden` must stay hidden.** The live page also has Next's metadata outlet,
  `<div hidden=""><!--$--><!--/$--></div>`. The existing suite pins `<div hidden>` as excluded
  (`extract-page.test.ts:93-102`).
- **Walk order.** The walk uses an explicit stack (`extract-page.ts:491-570`). A comment has no
  children, so the frame on top of the stack after a comment is its next sibling, or its parent's
  exit frame. Siblings come off in document order, so the fallback can be skipped with a running
  depth counter in O(1) per node. Looking siblings up by index would be quadratic on an adversarial
  page of 100,000 templates.
- **Images and links inside a segment** were unreadable before this fix, because the walk never
  entered a hidden subtree. They are read now. On a streamed page this is what the Alt Text
  Checker and page sampling (`sameHostLinks`) should see.
- `format:check` covers only `src/**/*.{ts,tsx,js,jsx,json,css,md}`, so an `.html` fixture under
  `__tests__/` is not formatted, and `testMatch` (`jest.config.js`) does not collect it as a suite.

## Seen in passing, not fixed here

`curl https://www.recopyfa.st/tools/website-spell-checker/r/00000000-0000-4000-8000-000000000000`
returns **HTTP 200**, with the not-found UI (`NEXT_HTTP_ERROR_FALLBACK;404` in the payload) and
`<meta name="robots" content="noindex">`. The root `loading.tsx` streams the shell, and its
status, before `notFound()` runs (`src/app/tools/[slug]/r/[id]/page.tsx:51`). Recorded in the
review as a known minor, per the brief.
