---
validated: yes
---
# Plan — Story s96c-streamed-html

> Hotfix. The bug was found in production right after s96 shipped. The orchestrator's architect
> brief (2026-10-12) made the decisions below. The implementer wrote this plan from that brief,
> and the brief is its validation. Branch: `fix/s96c-streamed-html`, from `origin/main`
> `c905292`; the orchestrator named it.

Research: `docs/research/s96c-streamed-html.md`. Read it first: it has the React markup this
plan relies on. There is no Design step, because no screen changes. The change has no embed
impact (0 bytes), no migration, no new dependency and no e2e test, so the Playwright `--list`
count stays at 97. There is no ADR either: the change stays inside the extractor contract s96
froze (`ExtractedPage` keeps its shape).

## Decisions

1. **A React streaming segment is visible content.** A segment is an element that has a `hidden`
   attribute and an `id` matching `/^S:[0-9a-f]+$/`. The walk enters it where it sits, in
   document order. Its position in the page does not matter for finding typos; including it
   does.
   - **Hexadecimal, not `\d+`.** The brief said `/^S:\d+$/`, but React writes
     `id.toString(16)` (see the research). With `\d+`, the eleventh segment, `S:a`, would be
     dropped. The implementer declares this deviation, and a test pins it.
   - Only the `hidden` attribute is waived. `aria-hidden="true"` and an inline
     `display:none` or `visibility:hidden` still hide the element.
2. **The fallback of a pending boundary is excluded.** A pending boundary is a `<!--$?-->`
   comment directly followed by `<template id="B:<hex>">`. Its fallback is the template plus every
   next sibling up to the matching `<!--/$-->`. The walk skips it, counting depth the way React's
   `$RV` does: `$`, `$?`, `$!`, `$~` and `&` open a level; `/$` and `/&` close one. If the parent
   ends before the closer comes (malformed markup), the skip ends there.
   - The fallback is skipped **whether or not its segment arrived**. Fallback text is loading
     UI, not the page's copy, so it never counts toward "has text". A shell with only a fallback
     still reports "almost no text".
   - A `<!--$!-->` (client-rendered) boundary is not pending, and its content is read as before.
3. **Nothing else changes.** Ordinary `[hidden]` elements, `<template>`, `<script>`, `<style>`
   and `<noscript>` stay excluded. No JavaScript runs. Every size, depth, element and time cap
   stays as it is. The skip is O(1) per node, inside the existing iterative walk.

## Task 1 — fixture: a trimmed real streamed page

Create `src/lib/tools/extract/__tests__/next-streamed-page.html` from
`curl -s https://www.recopyfa.st/terms`. Keep the real head (charset, viewport, one stylesheet,
one script, title, `og:site_name`, the theme script). Keep the real body shell: the `<div hidden="">`
metadata outlet, `<!--$?--><template id="B:0">` with the `loading.tsx` fallback ("Loading…"),
`<!--/$-->`, and the shell scripts. Add one `<div hidden id="S:0">` segment holding the real
header, the real `<main>` intro and sections 1–2, and the real footer, trimmed. Put one deliberate
misspelling, "recieve", in a section paragraph. End with the real `$RC` script and a trimmed
`self.__next_f` flight chunk. Add `src/lib/tools/extract/__tests__/next-streamed-page.ts`, which
reads the file and exports it as `NEXT_STREAMED_PAGE`.

- [x] Task 1

## Task 2 — red: segments are read

In `src/lib/tools/extract/__tests__/extract-page.test.ts`, a `describe("React streaming (s96c)")`.
Run it and watch it fail before touching `extract-page.ts`:
1. The fixture's segment text is extracted: the h1 "Terms of Service", the "Acceptance of Terms"
   paragraph, and the "recieve" sentence.
2. Multiple and nested segments, `S:0` and `S:1`, are both included, with `S:1` inside `S:0`'s
   content, and a later `S:a` segment is included too (hex ids).
3. A guard that is green from the start: a plain `<div hidden>`, or a `hidden` element with an id
   that is not a segment id (`S:x`, `B:0`, `S:0a-b`), is still excluded. A segment that is also
   `aria-hidden` or `display:none` stays excluded.
4. Links and images inside a segment are read: `sameHostLinks` and `images`.

In `src/lib/tools/lenses/typos/__tests__/typo-lens.test.ts`: the fixture, through the real
extractor and dictionary, is checked. The "almost no text" notice is not its headline or its
skipped reason, and the lens finds "recieve" → "receive". In
`src/lib/tools/scan/__tests__/run-scan.test.ts`: a loopback site serving the fixture as its
homepage yields a stored report with the page `checked` and a "recieve" finding.

- [x] Task 2

## Task 3 — make segments visible

In `extract-page.ts`, `isHidden` waives the `hidden` attribute for an element whose id matches
`STREAMED_SEGMENT_ID`. Leave a tombstone comment that names the incident (the s96 tool on
`/terms`) and the hex ids. Task 2's segment tests, the lens test and the run-scan test go green.

- [x] Task 3

## Task 4 — red, then green: the fallback is not read

Red first, in the same `describe`:
1. The fixture's blocks contain no "Loading…" text, and its `wordCount` counts no fallback word.
2. A pending boundary whose fallback holds 25 words, with no segment, gives `wordCount` 0, and the
   lens reports `NO_TEXT_MESSAGE`.
3. A fallback containing a nested completed boundary (`<!--$-->…<!--/$-->`) is skipped up to the
   *matching* closer. Text after it is read.
4. Text right after the boundary's closer is read, and words on both sides do not merge.
5. A `<!--$!-->` boundary's content is read. A `<template id="B:0">` with no `<!--$?-->` before it
   skips nothing else.
6. An unclosed fallback stops being skipped at its parent's end, so later content is still read.

Then implement the skip in the walk (decision 2), with a tombstone comment that quotes `$RV`.

- [x] Task 4

## Task 5 — story docs

Append the story entry at the **end** of `docs/stories.md`, and do not run prettier on that
file. Write `docs/reviews/s96c-streamed-html.md` with the verification numbers and the known
minor from the brief: a non-existent report id returns HTTP 200 with the not-found UI and
`noindex`, because the root `loading.tsx` streams the shell before `notFound()`. The minor is
recorded, not fixed. The doc ends with the gate lines `Max severity: pending` and
`Ship allowed: pending`, which the reviewer fills in.

- [x] Task 5

## Task 6 — gates and mutation

- Mutation 1: drop the segment waiver in `isHidden`. The segment tests, the lens test and the
  run-scan test must go red.
- Mutation 2: drop the fallback skip. The "Loading…" and fallback-only tests must go red.
- Full `npm test` with `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `type-check`,
  `type-check:build`, `lint`, `format:check`, `npm run build`, `npm run build:embed -- --check`,
  and `npx playwright test --list`, which must still count 97.

- [x] Task 6

## Execution notes (implementer)

- Task 4, item 5 (a `<!--$!-->` boundary, a lone `B:` template, a `<!--$?-->` with no template)
  was green before the skip existed. It is a guard, like Task 2's `hidden` guards. Mutation 8 in
  the review shows it is sensitive. The variant where `$!` also opens a skip survives as an
  equivalent mutant, because React's `$!` template carries no `B:` id.
- Two Task 4 tests were corrected after the skip landed. Both are test errors, not behaviour
  changes:
  - The fixture's first block is `{ tag: "div", text: "ReCopyFast" }`, not `span`: the block
    is the enclosing block element.
  - The fallback-only and `$!` fixtures are wrapped in `<body>`. Before `<body>` exists, parse5
    puts a bare `<template>` in `<head>`, away from its comment, which React's output never
    does.
  - Mutation 2 turns the fallback-only test red, so it still proves the skip.
