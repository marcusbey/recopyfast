---
validated: yes
---
# Plan — Story s06c-embed-shrink

Branch: `feature/s06c-embed-shrink`
Research: `docs/research/s06-embed-budget-gate.md` — read it first; this plan does not repeat it.

## Target story

`s06c-embed-shrink`, split out of `s06-embed-budget-gate` (`docs/stories.md` → *Revised after
research*, complexity 4). Carries **AC 4** of `stories.md:443` — widget code alone ≤ 24,000
gzipped, from 34,063 today.

**Blocked, and the plan says so rather than guessing.** Research open question 1 asks whether the
widget's editor-only UI may be deferred to a second chunk. It is the *only* measured path to
24,000 (deferring all editor-only UI leaves a **16,875 gz** core; nothing else comes close), and
[ADR 004:63-67](../decisions/004-embed-transport-split.md) rejects a second same-origin script for
the *transport* as "the trap" — it fails on exactly the customers running `script-src 'self'`.
Whether that ruling extends to editor UI, whose audience is an authenticated editor on a page they
control rather than every anonymous visitor, **is an architect's call and needs an ADR.**

Until that ADR exists, **AC 4 is out of scope for this plan.** What follows lands the measured-safe
levers and ratchets the ceiling down after each. That closes ≈1,602 gz of a 10,063 gz gap — a
sixth — and ≈2,471 with `s04`'s 869. This is a ratchet step, not the target, and it does not claim
otherwise.

No UI. **Success is that nothing looks different.** Every observable behaviour of the widget on
every customer site is identical afterwards; only the byte count moves.

## Tasks (ordered)

- [ ] **1. Preconditions, checked and recorded, before a byte moves.** (a) The ADR ruling on
  open question 1 exists — if it does not, this plan stops after task 7 and AC 4 stays open;
  (b) `s06a` is merged, so `npm run build:embed` prints gz figures and refuses past a ceiling;
  (c) `s06b`'s harness is **green against the current artifact** — `npm run test:embed:fixture`;
  (d) `s04` is merged, or its absence is recorded, since it deletes the Styles and Themes tabs
  (measured 869 gz) that this story would otherwise spend effort minifying.
- [ ] **2. Record the baseline.** Run `npm run build:embed` and write the printed bundle/widget gz
  figures into this plan's checkbox line. Every later claim is a delta from these two numbers, not
  from the research report's.
- [ ] **3. Mark the five static CSS blocks.** In `recopyfast.src.js`, put an explicit
  `/* @rcf-css */` marker on the five **static** template literals — `:1071-1111`, `:1697-1862`,
  `:2181-2314`, `:3451-3714`, `:5196-5425`. Not the sixth site (`:3915-3921`): it is assembled at
  runtime from `colors.selectionBackground` and is not minifiable. Verified by research: all five
  contain zero `${}` interpolations.
- [ ] **4. Minify them at build time.** In `build-embed.mjs`, before `buildWidget`, extract each
  marked block and run it through `esbuild.transform(css, { loader: "css", minify: true })` —
  esbuild's JS pass cannot touch them because `loader: "js"` makes template-literal contents
  opaque (`:143-152`), which is why the shipped artifact carries fully-indented CSS today. The
  extractor **throws if it does not find exactly five marked blocks**, mirroring `injectRules`'
  behaviour at `:127-135`: a lost marker must fail the build, not silently ship unminified CSS.
- [ ] **5. Measure the combined delta, then ratchet.** Rebuild, read the gz figures, run the full
  harness and `npm test -- src/__tests__/embed`. **Measure the five blocks together, never
  cherry-picked from the per-block table** — research measured individually −33 and −121 for two
  of them, yet 1,491 for all five combined; gzip's cross-block redundancy makes those numbers
  non-additive, and picking blocks on per-block arithmetic will underperform. Lower
  `MAX_WIDGET_GZ` and `MAX_BUNDLE_GZ` to the new measured figures **in the same commit as the
  lever**.
- [ ] **6. `target: es2018 → es2022` — a decision, not a freebie.** Worth a measured 96 gz (0.28%
  of the widget). It also raises the browser floor for a script that runs on every visitor of
  every customer site, where we control neither the audience nor the error reporting. Record the
  floor es2022 implies, then either land it and ratchet, or skip it with a comment recording the
  measured 96 and why 96 bytes did not buy a reach reduction. Either outcome is acceptable; an
  unrecorded one is not.
- [ ] **7. `mangleProps: /^_/` — 15 gz, and a rename hazard.** Land it only if a test proves no
  `_`-prefixed property crosses a boundary the mangler cannot see: JSON from the API, `dataset`
  keys, anything read by string. Absent that proof, **skip it** and leave the tombstone: 15 gz is
  0.04% of the widget, and the failure it risks is a branch that only breaks on a customer's DOM.
- [ ] **8. Token conversion: record the refutation, do not implement.**
  `docs/design-system.md:231-233` states the `--rcf-*` conversion is byte-negative and instructs
  folding it into `s06`. Research measured it: a full conversion **costs 250 gz**, and even the
  two values where `var()` is mathematically shorter cost 40. Amend `design-system.md` items at
  `:231` and `:294` to record the measurement and point at the research. The design reasons
  (`:234-235` — a dark Edit Board, an agency accent) survive intact; they are simply not this
  story's to fund, and 57 of the 103 hex occurrences are in JavaScript where a custom property
  cannot reach anyway.
- [ ] **9. Close honestly.** Final rebuild, final ratchet, full harness plus suite green. State in
  the PR description the widget's final gz figure, the total closed, and the remaining gap to
  24,000 — and that **AC 4 remains open** pending the ADR. Do not restate or renegotiate the
  24,000 allocation here; `docs/stories.md` § Byte budget owns it.

## Run interdicts

- **No test may be modified to accommodate a size change.** If a test goes red, the change is wrong, not the test.
- Edit `public/embed/recopyfast.src.js`; never `public/embed/recopyfast.js` — the artifact is generated and hand edits vanish on the next build.
- Leave `// @rcf-inject:editing-rules` and `// @rcf-inject-end` byte-for-byte intact; `editor-auth.test.ts:42` asserts on them and the splice at `build-embed.mjs:123-140` depends on them.
- Every candidate is measured post-gzip through the real build; a raw-byte argument is not evidence (CSS minification: −14,275 raw buys 1,491 gz; `cssText` minification: −1,006 raw *costs* 370 gz).
- No lever lands while `npm run test:embed:fixture` is red.
- Do not lazy-load a second script, chunk, `blob:` URL or `fetch`+`eval` payload from our origin — ADR 004 rejects it and `recopyfast.src.js:64` already derives that URL, so the trap is reachable from inside the file.
- Ratchet both ceilings in the same commit as the lever that earned them; never raise either.
- No feature deletion in this story — `s04` owns the only sanctioned removal; deleting a shipped branch is a product decision.
- `/embed/recopyfast.js` keeps its URL, its filename and its behaviour for installs made before this story.

## The point everything turns on

**Everything safe closes about a quarter of the gap, so this story is a ratchet step and the plan
is built as one.** Measured: CSS-block minification 1,491, es2022 96, `mangleProps` 15 — 1,602
total, plus `s04`'s 869. Against 34,063 → 24,000 that is 2,471 of 10,063. The remaining ~7,600 is
only reachable by deleting live features (the entire `EditBoardPanel` is 4,084; `startTextEdit`
2,417; `showAISuggestions` 1,713) or by the code split ADR 004 rejects. The story's own three
predictions were all measured and all fail: the five tabs are 2,504 not the bulk; the 67 inline
`cssText` strings *cost* 370 gz to minify; the 214 `createElement` call sites are already
deduplicated by gzip. There is no fat region — the widget is 6,198 lines of uniformly dense
feature code.

**Where this could be wrong.** If the ADR rules that deferring editor-only UI *is* permitted, the
measured core drops to 16,875 and 24,000 is comfortably reachable — at which point this plan is
scoped far too small and should be **re-planned, not stretched**, because a chunk-loading widget
is a different story with a different risk surface. If the ADR rules no, AC 4 is unachievable as
written and the 24,000 figure has to be re-derived by whoever owns the budget — it is arithmetic
on a 30,000 total with 6,000 reserved, not a measured requirement — and an implementer must not
quietly abandon it or quietly delete features to hit it.

**The subtler exposure is CSS minification itself.** The widget has no shadow DOM
(`design-system.md:221`), so its rules share a cascade with the host page. esbuild's CSS minifier
collapses longhands into shorthands, and a shorthand sets properties a longhand left alone — which
can change what a customer's own stylesheet is able to override. Nothing in the 43-test suite can
see that; only `s06b`'s harness can, and only on the DOM shapes the fixture happens to have. This
is the story's residual risk and it should be stated as such in the PR rather than assumed away.

## Files touched

- `public/embed/recopyfast.src.js` — five `/* @rcf-css */` markers, and nothing else.
- `scripts/build-embed.mjs` — CSS extraction and minification, `target`, ratcheted constants.
- `public/embed/recopyfast.js` — regenerated by `npm run build:embed`, never hand-edited.
- `src/__tests__/embed/` — one new assertion on the marked-block count; no existing test edited.
- `docs/design-system.md` — items at `:231` and `:294`, recording the measured refutation.
- `docs/plans/s06c-embed-shrink.md` — checkboxes.

Not touched: `docs/stories.md`, `docs/decisions/` (ADRs are immutable — a ruling on open question
1 is a *new* ADR, written by the architect, not an edit to 004).

## Test strategy

This story adds no behaviour, so it adds almost no behavioural tests. Its safety comes from
instruments that already exist when it starts.

- **`s06b`'s fixture harness is the gate.** Green before the first lever, green after each one,
  green at the end — against the built artifact, cross-origin. It is the only thing in the repo
  capable of failing on a build-level change, which is all this story makes.
- **The 43 existing embed tests pass unchanged.** They load the source, so they will not catch a
  minifier regression; they will catch a broken inject marker, which is the other way this story
  can go wrong.
- **New: the marked-block count.** A test asserting the extractor finds exactly the expected number
  of `/* @rcf-css */` blocks, so deleting or mistyping a marker fails loudly instead of silently
  shipping unminified CSS and a mysteriously stalled ratchet.
- **The byte assertions need no new test and no edited one.** `s06a`'s gate asserts
  `measured <= MAX_*`, and its ratchet-seed test asserts `MAX_* <= ` today's figures — both stay
  green as the constants come *down*. That is by construction, and it is what lets this story
  honour "no test modified to accommodate a size change" while changing sizes on purpose.
- **Per-lever, not per-story, verification.** Build → gz figures → harness → suite after *each*
  lever, so a regression is attributable to one change. A batch of three levers measured once
  tells you the total and nothing about which one broke a customer's DOM.

## Definition of Done

- Tasks 1-9 ticked, or explicitly recorded as skipped with the measured reason (tasks 6 and 7 may
  legitimately end in a skip; tasks 3-5 and 8-9 may not).
- Baseline and final widget/bundle gz figures both stated in the PR description, with the total
  closed and the remaining gap to 24,000.
- `MAX_WIDGET_GZ` and `MAX_BUNDLE_GZ` lowered to the final measured values; neither ever raised in
  the branch history.
- `npm run test:embed:fixture` green, `npm test -- src/__tests__/embed` green with no existing test
  modified, `node scripts/build-embed.mjs --check` green.
- `lint`, `type-check`, `format:check`, `build`, `test` green.
- `/embed/recopyfast.js` still served at the same URL and still boots on the fixture page.
- **AC 4 explicitly recorded as open** in the PR description, with the ADR it waits on named.
- Single PR, `docs/reviews/s06c-embed-shrink.md` ending `Ship allowed: yes`.
