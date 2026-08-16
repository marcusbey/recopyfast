# Research — Story s06-embed-budget-gate

> ⚠️ **Warning, recorded as instructed.** [`docs/reviews/stories.md`](../reviews/stories.md)
> ends **`Stories ready: no`** (max severity: **major**). The operator confirmed proceeding.
> This research is therefore built on a story set that its own review has not cleared.

> **Method.** Every number below is measured, not estimated. Regions were deleted from
> `public/embed/recopyfast.src.js`, re-run through the *real* build pipeline
> (`injectRules` → `esbuild.transform({minify:true, target:es2018})`, exactly as
> `scripts/build-embed.mjs:143-152` does it), then gzipped with `gzip -9c` — the command
> `stories.md:351` mandates. An identity-rewrite control reproduced the baseline byte-for-byte,
> so the harness is sound. Harness: `measure.mjs` / `css.mjs` / `levers.mjs` in the session
> scratchpad (not committed — they are throwaway instruments, not deliverables).

---

## The five structuring facts

1. **The story's headline figure is wrong and the table mixes two compressors.** `stories.md:91`
   claims widget code = 34,063 gz; the real figure by `gzip -9c` is **33,699**. 34,063 is what
   Node's `zlib.gzipSync({level:9})` returns for banner + widget — a different compressor, plus
   the banner. The 46,781 and 13,085 figures in the same table *are* `gzip -9c`.
2. **The five Edit Board tabs — the story's primary hypothesis — are worth 2,504 gz total**
   (`recopyfast.src.js:5541-6177`). Deleting the *entire* `EditBoardPanel` class, all 1,024
   lines (`:5155-6178`), yields only **4,084 gz** against a 9,699-byte gap.
3. **esbuild never minifies the CSS**, because it lives in template literals
   (`build-embed.mjs:143-152` runs `loader:"js"`); the artifact ships fully-indented CSS
   verbatim — confirmed in the shipped `recopyfast.js`. Minifying all five blocks strips
   14,275 raw chars but yields only **1,491 gz**.
4. **The `--rcf-*` token conversion is byte-POSITIVE, not byte-negative** —
   [`design-system.md:231-233`](../design-system.md) is wrong. Measured: **−250 gz** for a full
   conversion, **−40 gz** even when restricted to the only two values where `var()` is
   mathematically shorter than the literal.
5. **The only measured path to 24,000 is code-splitting, which
   [ADR 004](../decisions/004-embed-transport-split.md):63-67 explicitly rejects** as "the trap"
   — a second same-origin chunk fails on exactly the customers running `script-src 'self'`.

---

## Target story

`s06-embed-budget-gate` — *measure the widget, enforce a ceiling, shrink it*
([`stories.md:318-364`](../stories.md)). Scored **4**. Dependencies: none. **Gates `s08`, `s09`
and `s11`.**

Eight acceptance criteria (`stories.md:332-340`). They fall into three groups that behave very
differently, which matters for the split proposal:

| # | Criterion | Assessment |
|---|---|---|
| 1 | Build prints gz size of artifact **and** widget alone, excluding transport | Deterministic. Achievable today. |
| 2 | Build fails past a declared ceiling; ceiling is a committed constant | Deterministic. Achievable today. |
| 3 | Ceiling starts at today's size, then ratchets down, never regresses | Deterministic. Achievable today. |
| 4 | **Widget alone ≤ 24,000 gz** (from "34,063") | **Not reachable** — see *Real complexity*. Base figure also wrong. |
| 5 | `--check` stale detection still works | Low risk; the constraint is understood (below). |
| 6 | Full embed suite passes unchanged | Passes today (43 tests, 3 files) — but see trap 3: it does not cover the code AC 7 names. |
| 7 | Editing, publishing, staging, history, languages, image replacement each work against a real fixture page | **No such harness exists.** This is a story, not a criterion. |
| 8 | Widget contributes 0 to host-page CLS | **No CLS harness exists.** Also unstated: 0 against which baseline? |

---

## Current state of the code

### Measured, this revision

`gzip -9c`, reproduced independently:

| Component | gz | Note |
|---|---|---|
| `public/embed/recopyfast.js` as shipped | **46,781** | ✅ matches `stories.md:89` |
| — `socket.io-client` prefix | **13,085** | ✅ matches `stories.md:90` |
| — banner (5 lines + sha256 marker) | 258 | not previously accounted |
| — **widget code alone** | **33,699** | ❌ `stories.md:91` says 34,063 — **corrected, −364** |

Sub-parts gzip separately, so they sum to more than the whole (46,781 < 13,085 + 33,699); the
widget's *marginal* contribution to the bundle is 33,464 and socket.io's is 12,874. The
33,699 figure is the widget as sliced from the artifact; rebuilding it from source gives
33,688 (an 11-byte block-boundary artefact of one trailing newline). **Use 33,699 as the AC-4
baseline and state the command.**

**The real gap is 9,699 gz, not 10,063.**

### Files

| File | State |
|---|---|
| `public/embed/recopyfast.src.js` | **6,198 lines** — source of truth. `stories.md:327` says "5,397-line widget"; that is stale by 801 lines. |
| `public/embed/recopyfast.js` | 174,420 raw / 46,781 gz. Generated. Never hand-edit. |
| `public/embed/socket.io-client.min.js` | 42,162 raw / 13,085 gz. Same-origin fallback, written by the same build. |
| `scripts/build-embed.mjs` | 251 lines. Reports **raw KB only** (`:232-245`) — no gzip anywhere, no ceiling, no gate. |
| `src/lib/editingRules.core.ts` | 873 lines → 8,987 raw inlined. **Marginal cost in the widget: 3,689 gz.** |
| `src/__tests__/embed/*.test.ts` | 3 files, **43 tests, all passing** (`npm test -- src/__tests__/embed`). |
| `public/embed/recopyfast.src.js` (hex) | **103 hex occurrences, 25 distinct** — ✅ `design-system.md:212` is exactly right on the count. |

### How the build composes the bundle

`build-embed.mjs:225`:

```
bundle = banner(sourceHash, socketVersion) + socketIo + "\n" + widget + "\n"
```

- `banner()` (`:154-164`) emits 5 comment lines plus `// @generated-from-sha256 <hex>`.
- `sourceHash = sha256(source + " " + rulesSource)` (`:189`) — **both** inputs, so editing the
  shared rules invalidates the artifact. Deliberate; comment at `:187-188`.
- `--check` (`:191-210`) reads the built file and asserts it *contains* the expected marker
  string. It reads the artifact only — it never rebuilds and never inspects size.
- socket.io goes **first**, so `window.__recopyfastSocketIO` exists before the widget runs
  (`:222-224`) — no second request, nothing for a nonce/hash CSP to reject.

### Structure of the widget, by measured gz weight

| Region (`recopyfast.src.js`) | lines | gz if deleted |
|---|---|---|
| `EditBoardPanel` class `:5155-6178` | 1,024 | 4,084 |
| injected `editingRules.core.ts` `:555-598` | — | 3,689 |
| `startTextEdit` `:3829-4350` | 522 | 2,417 |
| `showStagingBanner` `:1644-1979` | 336 | 2,137 |
| `injectStyles` `:3449-3716` | 268 | 1,870 |
| `showAISuggestions` `:4901-5105` | 205 | 1,713 |
| `openImageEditor` `:4358-4658` | 301 | 1,570 |
| `createEditorAuthClient` `:149-536` | 388 | 1,327 |
| `createOverlay` `:2173-2319` | 147 | 906 |
| `startFormEdit` `:4720-4866` | 147 | 644 |
| `showEditorBanner` `:1064-1147` | 84 | 509 |
| **everything else** (scan, observe, content-apply, tracking, selectors, upload, polling) | — | **≈12,800** |

No single region dominates. The widget is not fat in one place; it is 6,198 lines of
uniformly-dense feature code.

---

## Anchor points

| What | Where |
|---|---|
| Bundle composition — the concatenation to strip | `scripts/build-embed.mjs:225` |
| `--check` staleness logic — must keep working | `scripts/build-embed.mjs:191-210` |
| Raw-size reporting — where a gz gate would slot in | `scripts/build-embed.mjs:232-245` |
| `formatKb` helper to sit beside | `scripts/build-embed.mjs:175-177` |
| Widget minify call — `loader:"js"`, `target:es2018` | `scripts/build-embed.mjs:143-152` |
| Rules inject markers **(leave intact)** | `recopyfast.src.js:555` / `:598`; logic at `build-embed.mjs:123-140` |
| Marker constants | `build-embed.mjs:45-46` (`INJECT_BEGIN`/`INJECT_END`), `:54` (`STALE_MARKER`) |
| Five CSS template blocks (inner literal ranges) | `:1071-1111`, `:1697-1862`, `:2181-2314`, `:3451-3714`, `:5196-5425` |
| Sixth style site — **built by concatenation, not a template literal** | `:3915-3921` |
| Five tab renderers | `:5541`, `:5663`, `:5772`, `:5907`, `:6039` |
| Tab registry `s04` will edit | `:5454-5460` |
| Build wiring | `package.json:38-39` (`build:embed`, `prebuild`) |
| Embed tests | `src/__tests__/embed/{editor-auth,element-id-page-scope,handoff-roundtrip}.test.ts` |

---

## Verified APIs / functions

Read and confirmed against source, not assumed:

- **`injectRules(source, rules)`** (`build-embed.mjs:123-140`) — `indexOf` on both markers;
  throws if either is missing or if `END` precedes `BEGIN`. Returns
  `source.slice(0,begin) + rules + "\n" + source.slice(end + INJECT_END.length)`. **The
  begin-marker line itself is consumed.** Any edit near `:555-598` must preserve both markers
  verbatim. `editor-auth.test.ts:42` asserts on their presence, so breaking them fails a test
  rather than shipping silently — a real safety net.
- **`buildWidget(esbuild, source)`** (`:143-152`) — `esbuild.transform`, **not** `build`. No
  bundling, no tree-shaking, no dead-code elimination across the file. `loader:"js"` means
  template-literal contents are opaque strings.
- **`buildRules(esbuild)`** (`:101-115`) — full `esbuild.build` with `bundle:true`,
  `format:"iife"`, `globalName:"__rcfRules"`. Assigns to a local `var` inside the widget's own
  IIFE, so nothing reaches the customer's `window`.
- **`sha256(text)`** (`:67-69`) and **`banner()`** (`:154-164`) — a gz ceiling constant added to
  this file does **not** feed `sourceHash` (which hashes only `source` + `rulesSource`), so
  changing the ceiling will not spuriously invalidate the artifact. Confirmed at `:189`.
- **`node scripts/build-embed.mjs --check`** — run: exits `0`, prints `embed artifact is up to
  date`. Green baseline.
- **`npm test -- src/__tests__/embed`** — run: **43 passed, 3 suites**. Green baseline. Runner
  is **jest**, not vitest.
- All five CSS template literals are **static**: zero `${}` interpolations (verified by scan).
  They are therefore safe to minify at build time. The sixth site (`:3915`) is assembled from
  runtime values (`colors.selectionBackground`) and is **not** minifiable.

---

## Traps & constraints

1. **`/embed/recopyfast.js` is a permanent public URL** baked into every snippet ever issued
   (`architecture.md:182-183`, `AGENTS.md:106-107`). It can never move, never 404, and must keep
   working for installs made before this story. This forecloses "ship a v2 file".

2. **ADR 004 already rejected the only approach that closes the gap.**
   [`004-embed-transport-split.md:63-67`](../decisions/004-embed-transport-split.md) rejects
   lazy-loading a second script from our origin and names it *"the trap"*: it "works in
   development and on our own domain, and fails on exactly the customers running `script-src
   'self'` — because our origin is not their `'self'`." The variants do not escape it: a
   `fetch()`+`eval` chunk needs `'unsafe-eval'` *and* `connect-src`; a `blob:` script URL is
   blocked by the same directive. **`recopyfast.src.js:64` already derives that URL, so the trap
   is live in the code today** — an agent optimising for bytes will find it and use it.

3. **The test suite does not cover what AC 7 names.** The 43 tests cover editor auth
   (`editor-auth.test.ts`), stable element ids (`element-id-page-scope.test.ts`) and the handoff
   round-trip (`handoff-roundtrip.test.ts`). They load `recopyfast.src.js` into JSDOM, so they
   are genuine — but **nothing** exercises the Edit Board, the five tabs, image replacement,
   staging or history. AC 6 ("full embed test suite passes unchanged") can therefore be
   satisfied while AC 7's six flows are all broken. This is the exact failure mode
   `stories.md:327-330` warns about: "a broken branch will not page us — it will present as
   *editing stopped working on one site*."

4. **Raw-byte reduction does not imply gz reduction, and on this file it sometimes reverses it.**
   Three independent measurements:
   - CSS block minification: −14,275 raw → only −1,491 gz (10.4% realisation).
   - `--rcf-*` tokenisation: fewer repeated literals → **+250 gz**.
   - Minifying the 67 inline `.style.cssText` strings: −1,006 raw → **+370 gz**.
   Any plan that reasons in raw bytes will overstate its result by roughly 10×. **Every
   candidate must be measured post-gzip or it is not evidence.**

5. **The `--check` mode must not be made to rebuild.** It currently reads the artifact and
   string-matches the marker (`:191-210`) — no esbuild, no `node_modules` dependency beyond
   Node itself. A size gate implemented *inside* `--check` would be reasonable (it can gzip the
   artifact it already read), but a gate that requires a rebuild to know the size would make CI
   slower and couple staleness-checking to esbuild availability. Gate on the **artifact on
   disk**, not on a fresh build.

6. **Two ceilings are being conflated.** AC 2/3 gate "the artifact" (30,000, per
   `architecture.md:184`); AC 4 targets "widget code alone" (24,000, per `stories.md:98`). The
   artifact cannot pass 30,000 until `s08` removes socket.io — 33,699 + 13,085 = 46,781. **So
   the ratchet in AC 2/3 must start at 46,781 and the two numbers must be tracked as separate
   constants**, or the build is red the moment the gate lands.

7. **`design-system.md:294` instructs folding the token work into `s06`. Do not.** It is
   byte-positive (fact 4). It may still be worth doing for the *design* reasons
   (`design-system.md:234-235`: dark Edit Board, agency accent) — but it must not be justified
   by, or charged to, this story's byte budget. Also: only **46 of the 103** hex occurrences are
   in CSS blocks; the other **57 are in JavaScript** (`el.style.color = '#94a3b8'`), where a CSS
   custom property cannot reach without restructuring the assignment.

8. **`s04` first, as `stories.md:357-358` says — but it is worth less than implied.** Removing
   the Styles and Themes tabs measures **869 gz**, closing 9.0% of the gap, not a meaningful
   share of it. Sequence `s04` first anyway to avoid minifying code that is about to be deleted;
   just do not count on it.

9. **CLS (AC 8) has no harness and no stated baseline.** The widget injects fixed-position
   banners (`:1064`, `:1644`) and a fixed-position panel (`:5189`). `position:fixed` is
   out-of-flow and should score 0, and `injectStyles`' own comment (`:3452-3457`) records a past
   incident where `position:relative` + `transition:all` on every editable element *did* move
   layout — so the concern is real and has bitten before. But "contributes 0" is unmeasurable
   without a harness that does not exist.

---

## Open questions

1. **Does a lazily-fetched chunk count against the widget budget — and is it allowed at all?**
   This is the decisive question; the answer determines whether AC 4 is achievable. ADR 004
   rejects it for the *transport*. It does not explicitly rule on splitting *editor UI*, whose
   audience is different: an authenticated editor on a page they control, not every anonymous
   visitor. **Measured: deferring all editor-only UI leaves a 16,875 gz core — comfortably under
   24,000.** This is the only path found. It needs an explicit ADR ruling, not a story-level
   guess. *Owner: architect, before this story is planned.*
2. **If the answer to (1) is no, what gives — the 24,000 target, or shipped features?** Reaching
   24,000 in one file requires deleting ~7,200 gz beyond the safe levers: roughly the entire Edit
   Board *plus* `startTextEdit` *plus* `showAISuggestions`. That is a product decision this story
   does not own.
3. **Is 24,000 load-bearing, or was it derived from the wrong baseline?** The allocation table
   (`stories.md:96-103`) is arithmetic on 30,000 with 6,000 reserved for `s09`/`s11`/slack. If
   `s09` and `s11` land under budget, or the reserve is spent, 24,000 moves. Nothing measured
   says 24,000 specifically is the number.
4. **What is the CLS baseline for AC 8** — 0 absolute, or 0 *delta* against the host page
   without the widget? Only the second is measurable.
5. **Does the ratchet gate the artifact, the widget, or both?** See trap 6. Two constants.

---

## Real complexity

**Re-scored: 5** (up from **4** in `stories.md:323-325`).

The story is not a 4 because *it does not close*. `stories.md:356` predicts the bytes are in
"five Edit Board tab implementations, inline CSS strings, and duplicated DOM-building helpers".
All three were measured. All three fail:

| Predicted location | Measured gz | Verdict |
|---|---|---|
| Five Edit Board tab implementations | 2,504 | 26% of the gap |
| Inline CSS strings (67 `cssText`) | **−370** | minifying them *costs* bytes |
| Duplicated DOM helpers (214 `createElement`) | not separable; gzip already deduplicates | no measurable lever |

The complete set of safe, non-feature-deleting levers:

| Lever | gz |
|---|---|
| CSS-minify the 5 template blocks | 1,491 |
| Bump `target` es2018 → es2022 | 96 |
| `mangleProps: /^_/` | 15 |
| **Total safe** | **≈1,602** → 32,097 |
| plus `s04` (2 tabs) | 869 → ≈31,228 |

**Against a 9,699-byte gap, everything safe closes ~2,470 — a quarter.** The remaining ~7,200
can only come from deleting live features or from a code split that ADR 004 rejects. AC 4 is
therefore currently unachievable by the means the story names, and an agent handed this story
will either (a) discover the ADR-004 trap and reintroduce the CSP bug, or (b) start deleting
Edit Board branches with a 43-test suite that covers none of them. Both are the failure the
story's own risk paragraph predicts.

The complexity-5 signals, stated plainly: an acceptance criterion whose arithmetic does not
close; a blocking architectural question (open question 1) that must be answered *outside* the
story; and two ACs (7, 8) that each require building verification infrastructure that does not
exist. `stories.md:77-79` records that this story was *already* split out of a complexity-5
whose "arithmetic did not close". **The arithmetic still does not close.** The split was made on
the wrong axis — transport vs. size — when the real axis is *gate* vs. *verification* vs.
*shrink*.

---

## Split proposal

Three stories. The first two are unblocked and deliver the value that actually gates `s08`,
`s09` and `s11` — those stories need a *ceiling to test against*, not a smaller widget.

### `s06a-embed-byte-gate` — complexity 2

The gate, and nothing else. Carries AC 1, 2, 3, 5, 6.

- `build-embed.mjs` gzips and prints the artifact, the socket.io prefix and the widget alone.
- Two committed constants — `MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ` — seeded at **46,781** and
  **33,699** (trap 6: seeding the artifact ceiling at 30,000 makes the build red immediately).
- Build fails past either. Ratchet only downward; a comment records that raising one is a
  defect, per AC 3.
- Gate reads the artifact on disk; `--check` stays rebuild-free (trap 5).
- Correct `stories.md:89-91`, `architecture.md:184` and `ADR 004:22-23` to 33,699 and note the
  compressor, so the wrong figure stops propagating.

Deterministic, no product risk, no open question. **This alone unblocks `s08`, `s09` and `s11`** —
they need to know whether their 2,000-byte allowances fit, which a gate answers and a shrink
does not.

### `s06b-embed-fixture-harness` — complexity 3

The safety net AC 7 and AC 8 actually describe.

- A fixture page on a non-RecopyFast origin that drives editing, publishing, staging, history,
  languages and image replacement against the built artifact.
- CLS measured on that fixture, with the baseline defined as *delta vs. the same page without
  the widget* (open question 4).
- No shrinking. This story only builds the instrument that makes shrinking safe.

Sequence before `s06c`. Without it, `s06c` is unreviewable — trap 3 means the existing suite
cannot tell a successful shrink from a broken one.

### `s06c-embed-shrink` — complexity 4

The actual reduction, gated on `s06b` being green and on **open question 1 being answered by an
ADR**.

- Land the safe levers first: CSS-block minification (1,491), es2022 (96), `mangleProps` (15).
- Ratchet the constant down after each, per `s06a`'s mechanism.
- Then, and only then, pursue the remainder against whatever the ADR permits.
- **The 24,000 target moves into this story and must be re-derived** once the ADR rules. If
  splitting is forbidden, the honest ceiling is ≈31,200 (post-`s04`, post-safe-levers) and the
  30,000 artifact budget is only reachable *after* `s08` removes socket.io — at which point the
  artifact is ≈31,200, still 1,200 over, and the gap becomes a product conversation.

Sequence `s04` before `s06c` (`stories.md:357-358`), worth a measured 869 gz.

---

## Byte-accounting table

Baseline: **widget alone = 33,699 gz** (`gzip -9c`, artifact minus socket.io prefix minus
banner). Target 24,000. **Gap 9,699.**

All figures are *measured* deltas from deleting the region and rebuilding through the real
pipeline, unless the confidence column says otherwise.

| Candidate region | file:line | raw Δ | **gz Δ** | % of gap | Confidence |
|---|---|---:|---:|---:|---|
| **— The story's three predictions —** | | | | | |
| Five Edit Board tab impls | `:5541-6177` | 13,349 | **2,504** | 25.8% | **measured** |
| 67 inline `.style.cssText` strings | 67 sites | 1,006 | **−370** | **negative** | **measured** |
| Duplicated DOM helpers (214 `createElement`) | file-wide | — | **~0** | ~0% | measured indirectly — gzip already deduplicates |
| **— Safe levers —** | | | | | |
| CSS-minify all 5 template blocks | `:1071`,`:1697`,`:2181`,`:3451`,`:5196` | 14,275 | **1,491** | 15.4% | **measured** |
| — block `:3451` (edit-mode CSS, 12 CSS comments) | `:3451-3714` | 5,593 | 788 | 8.1% | **measured** |
| — block `:5196` (edit-board CSS) | `:5196-5425` | 3,411 | 81 | 0.8% | **measured** |
| — block `:1697` (staging banner) | `:1697-1862` | 2,553 | 34 | 0.4% | **measured** |
| — block `:2181` (modal) | `:2181-2314` | 2,079 | −33 | negative | **measured** |
| — block `:1071` (editor banner) | `:1071-1111` | 614 | −121 | negative | **measured** |
| `target` es2018 → es2022 | `build-embed.mjs:147` | — | **96** | 1.0% | **measured** |
| `mangleProps: /^_/` | `build-embed.mjs:143-152` | — | **15** | 0.2% | **measured** |
| **Safe subtotal** | | | **≈1,602** | **16.5%** | **measured** |
| **— Cross-story claim under test —** | | | | | |
| `--rcf-*` tokens, full (25 values ≥2×) | 5 CSS blocks | −671 | **−250** | **negative** | **measured** — refutes `design-system.md:231` |
| `--rcf-*` tokens, only where `var()` is shorter (2 values) | 5 CSS blocks | — | **−40** | **negative** | **measured** |
| **— Feature deletion (product decision, not refactoring) —** | | | | | |
| Entire `EditBoardPanel` class | `:5155-6178` | 23,087 | **4,084** | 42.1% | **measured** |
| — `createPanel` incl. its CSS | `:5189-5487` | 8,398 | 1,194 | 12.3% | **measured** |
| — Elements tab | `:5541-5647` | 2,419 | 465 | 4.8% | **measured** |
| — Languages tab | `:5758-5891` | 2,805 | 458 | 4.7% | **measured** |
| — Themes tab (`s04`) | `:6026-6177` | 3,024 | 453 | 4.7% | **measured** |
| — History tab | `:5894-6023` | 2,740 | 448 | 4.6% | **measured** |
| — Styles tab (`s04`) | `:5650-5755` | 2,361 | 405 | 4.2% | **measured** |
| **`s04` alone (Styles + Themes)** | `:5650-5755`,`:6026-6177` | 5,385 | **869** | **9.0%** | **measured** |
| `startTextEdit` | `:3829-4350` | 8,541 | 2,417 | 24.9% | **measured** |
| `showStagingBanner` | `:1644-1979` | 9,346 | 2,137 | 22.0% | **measured** |
| `injectStyles` (whole method) | `:3449-3716` | 10,354 | 1,870 | 19.3% | **measured** |
| `showAISuggestions` | `:4901-5105` | 8,264 | 1,713 | 17.7% | **measured** |
| `openImageEditor` | `:4358-4658` | 6,462 | 1,570 | 16.2% | **measured** |
| injected `editingRules.core.ts` | `:555-598` | 8,987 | 1,327→**3,689** | 38.0% | **measured** (marginal, vs. stubbed rules) |
| `createEditorAuthClient` | `:149-536` | 4,466 | 1,327 | 13.7% | **measured** |
| `createOverlay` | `:2173-2319` | 5,152 | 906 | 9.3% | **measured** |
| `startFormEdit` | `:4720-4866` | 3,799 | 644 | 6.6% | **measured** |
| `showEditorBanner` | `:1064-1147` | 2,766 | 509 | 5.2% | **measured** |
| **— Structural (blocked by ADR 004) —** | | | | | |
| **Defer ALL editor-only UI to a second chunk** | 9 regions, 3,082 lines | 78,588 | **16,813** | **173%** | **measured** — core drops to **16,875**. *Only* path to 24,000. **Rejected by ADR 004:63-67.** |
| Defer editor UI but keep auth inline | 2,619 lines | 63,629 | 13,592 | 140% | **measured** — core 20,096 |

**Reading it:** the safe levers plus `s04` reach ≈31,228. Every further row is either a
product deletion or an architectural decision that is not this story's to make.
