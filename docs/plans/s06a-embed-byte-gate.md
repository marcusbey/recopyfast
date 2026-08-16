---
validated: no
---
# Plan — Story s06a-embed-byte-gate

Branch: `feature/s06a-embed-byte-gate`
Research: `docs/research/s06-embed-budget-gate.md` — read it first; this plan does not repeat it.

## Target story

`s06a-embed-byte-gate`, split out of `s06-embed-budget-gate` (`docs/stories.md` → *Revised after
research*, complexity 2). Carries **AC 1, 2, 3, 5, 6** of `stories.md:440-445`. Not AC 4 (the
24,000 target), not AC 7/8 — those are `s06c` and `s06b`.

**This story alone unblocks `s08`, `s09` and `s11c`.** Each of them adds bytes to the widget and
each has a stated allowance in `stories.md` § Byte budget. What they need in order to write and
test an acceptance criterion is a *ceiling to measure against* — which a gate answers and a
shrink does not. None of them needs the widget to be smaller first; all three need to be able to
say "my change costs N and the build still passes".

No UI. Nothing a user can see changes. The widget source is not edited and the artifact's bytes
do not move: `s06a` adds measurement and refusal, nothing else.

## Tasks (ordered)

- [ ] **1. Pin the measurement, and prove the slice.** In `scripts/build-embed.mjs`, add
  `gzipSize(text)` (`node:zlib` `gzipSync`, `{ level: 9 }`) and
  `measureBundle(bundleText, transportText)` returning `{ bundleGz, transportGz, widgetGz }`,
  where **`widgetGz` is the artifact with the `socket.io-client.min.js` text excised** — the
  literal reading of AC 1's "widget code alone, excluding the concatenated transport library".
  If the transport text is not found inside the artifact, **throw**; do not fall back to a
  whole-file measurement. Test asserts the identity independently (see Test strategy).
- [ ] **2. Seed the two constants, with the tombstone.** `MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ` as
  module-level `UPPER_SNAKE_CASE` constants, seeded at **what task 1's function prints for
  today's artifact** — expected `46875` and `34063` (measured 2026-08-16 in this session; see
  *The point everything turns on* for why the bundle figure is not 46,781). House-style comment
  above them recording: they are seeded at today's size because seeding at the 30,000 budget
  makes the build red the moment the gate lands (the budget is breached by 16,875 today); they
  ratchet **downward only**; and **raising either one is a defect, not a fix**.
- [ ] **3. Print the three numbers.** Extend the existing `console.log` block
  (`build-embed.mjs:235-245`) with a gz line carrying `bundleGz`, `widgetGz`, `transportGz` and
  both ceilings. Keep the raw-KB lines — they are how a reader sees the 10× gap between raw and
  gzipped that trap 4 of the research is about.
- [ ] **4. Gate the build.** After the artifact is written, refuse: exit non-zero with a message
  naming the constant, the measured value and the overage. **Write first, then gate** — a failed
  build that left no artifact on disk also leaves `--check` reporting "stale", which is a second,
  misleading error for the same cause.
- [ ] **5. Gate `--check`, rebuild-free.** The `isCheck` branch (`:191-210`) reads
  `recopyfast.js` and `socket.io-client.min.js` from disk and runs the *same* `measureBundle`.
  No `loadEsbuild()`, no rebuild, no `node_modules` dependency beyond Node itself. Print the same
  line and apply the same refusal.
- [ ] **6. Make the failure path testable without a 47KB fixture.** Env var
  `RCF_EMBED_CEILING_OVERRIDE`, honoured **only when it is lower** than the constant; a higher
  value is ignored with a printed warning. An override that can only tighten cannot be used to
  escape the gate. Comment says exactly that.
- [ ] **7. Test suite** — `src/__tests__/embed/build-size-gate.test.ts`, per Test strategy below.
  Covers the measurement identity, the ratchet seed, both gate directions, the tighten-only
  override, `--check` green, `--check` stale, and the no-esbuild-in-`--check` invariant.
- [ ] **8. Reach CI in check mode.** Add `node scripts/build-embed.mjs --check` as a step in
  `.github/workflows/ci.yml`'s `ci` job **before** `npm run build`. Build mode is already gated
  in CI via `prebuild` → `build:embed`, but it *rebuilds*, so a stale committed artifact is
  invisible there. `--check` first is what catches it.
- [ ] **9. Record the compressor, once.** House-style comment in `build-embed.mjs` and one
  sentence in `docs/architecture.md` → The embed widget: 46,781 / 13,085 are **GNU `gzip -9c`**;
  the gate's canonical in-process figures for the same bytes are **46,875 / 34,063**, and the two
  must never be compared. Do **not** change any figure in `docs/stories.md` (its table is
  correct) and do **not** touch `docs/decisions/004-*.md` (ADRs are immutable).

## Run interdicts

- Never hand-edit `public/embed/recopyfast.js`; every artifact byte comes from `npm run build:embed`.
- Do not edit `public/embed/recopyfast.src.js` in this story — `s06a` adds no bytes and removes none.
- A ceiling constant may only move down; the ratchet-seed test fails any commit that raises one.
- `--check` gains no `import("esbuild")` and never rebuilds — two files off disk, nothing else.
- One measurement function serves both modes; a second gzip call path anywhere is a defect.
- Do not restate the 30,000 budget or any per-story allowance in code — `docs/stories.md` § Byte budget is the only place it is allocated.
- No existing embed test is modified; the 43 tests in `src/__tests__/embed/` pass unchanged.
- Do not edit `docs/stories.md` or `docs/decisions/004-embed-transport-split.md`.

## The point everything turns on

**Two compressors are in play and they disagree, so the gate is only as good as the definition of
the number it compares.** Measured this session on the shipped artifact:

| | GNU `gzip -9c` | Node `zlib.gzipSync({level:9})` |
|---|---:|---:|
| `recopyfast.js` | 46,781 | **46,875** |
| `socket.io-client.min.js` | 13,085 | 13,141 |
| artifact minus the transport text | 33,699 | **34,063** |

This plan makes the **in-process Node measurement canonical**, because it needs no subprocess and
is byte-identical on a macOS laptop and on the Ubuntu CI runner. Under that definition, "the
widget alone, excluding the transport" is exactly **34,063** — the figure `stories.md:91` and the
brief both carry, reproduced rather than asserted. The bundle figure, however, is **46,875, not
46,781**: seeding `MAX_BUNDLE_GZ` at 46,781 makes the build red on its first run, which is the
precise failure the "seed at today's measured size" rule exists to prevent. Task 2 therefore
seeds from what the gate's own function prints, and task 9 records why the documented figure
differs.

**Where this could be wrong.** If a reviewer rules that the documented `gzip -9c` figures are the
canon, the gate has to shell out to `gzip` — and then it inherits whatever `gzip` the runner
ships (GNU 1.14 here, unknown on the runner), so the ceiling moves with the machine and is not a
ceiling. Second exposure: the widget slice depends on `socket.io-client.min.js` on disk staying
byte-identical to the prefix inside the artifact. Both are written by the same build today
(`:227-230`), but if that ever stops being true the slice silently fails — which is why task 1
throws instead of degrading.

## Files touched

- `scripts/build-embed.mjs` — measurement, constants, printing, gate in both modes, override.
- `src/__tests__/embed/build-size-gate.test.ts` — new.
- `.github/workflows/ci.yml` — one `--check` step.
- `docs/architecture.md` — one sentence recording the compressor.
- `docs/plans/s06a-embed-byte-gate.md` — checkboxes, ticked as tasks land.

Not touched: `public/embed/recopyfast.src.js`, `public/embed/recopyfast.js`, `docs/stories.md`,
`docs/decisions/`, any file under `src/lib/`.

## Test strategy

New suite `src/__tests__/embed/build-size-gate.test.ts` (jest, existing runner). It shells out
with `child_process.execFileSync` and **never runs a build** — every test uses `--check`, which
writes nothing, so the suite cannot leave the repo dirty and stays fast.

- **Measurement identity.** The test re-implements the slice independently (read both files,
  excise the transport text, `zlib.gzipSync` level 9) and asserts it equals the number the script
  prints. Two implementations agreeing is the evidence; one implementation printing itself is not.
- **Sub-parts sum high.** `widgetGz + transportGz > bundleGz` — gzip's own arithmetic, and the
  sanity check that catches a slice that silently measured the whole file.
- **The gate holds.** `bundleGz <= MAX_BUNDLE_GZ` and `widgetGz <= MAX_WIDGET_GZ`.
- **The ratchet seed.** `MAX_BUNDLE_GZ <= 46875` and `MAX_WIDGET_GZ <= 34063`. This is AC 3 made
  mechanical: a commit raising a ceiling above today's size fails a test. It stays green through
  every `s06c` ratchet *downward*, so no test has to be edited when the widget shrinks.
- **Failure path.** With `RCF_EMBED_CEILING_OVERRIDE` set below the measured size, `--check` exits
  non-zero and the message names the measured value and the overage. With it set *above* the
  constant, `--check` exits 0 and the printed ceiling is still the constant.
- **`--check` still detects staleness (AC 5).** Back up `recopyfast.js` in memory, rewrite its
  `@generated-from-sha256` marker, assert exit 1, restore the exact bytes in `finally`.
- **`--check` stays rebuild-free.** Assert the script source's `isCheck` branch contains no
  `loadEsbuild` / `esbuild` reference — a source-string assertion, matching the existing
  house pattern in `editor-auth.test.ts:42`.
- **AC 6.** `npm test -- src/__tests__/embed` — 43 existing tests plus the new suite, all green,
  no existing test modified.

## Definition of Done

- All eight AC-bearing tasks ticked; `docs/plans/s06a-embed-byte-gate.md` checkboxes travel in
  the story commit.
- `npm run build:embed` prints the artifact, widget and transport gz figures and both ceilings.
- `node scripts/build-embed.mjs --check` exits 0, prints the same figures, and imports no esbuild.
- Seeding an over-tight ceiling fails the build with a message naming the constant and the overage.
- `lint`, `type-check`, `format:check`, `build`, `test` green; CI additionally green on
  `audit:prod` and `type-check:build`.
- `public/embed/recopyfast.js` is byte-identical to `main` — this story changes no shipped bytes.
- Single PR, `docs/reviews/s06a-embed-byte-gate.md` ending `Ship allowed: yes`.
