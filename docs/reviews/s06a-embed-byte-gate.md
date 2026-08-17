# Review — Story s06a-embed-byte-gate

> Fresh-context review by the `reviewer` subagent. Diff reviewed:
> `git diff main...feature/s06a-embed-byte-gate`.
> No UI in this story, so no design conformity check applies.

## Plan compliance
- [x] The code does what the plan specifies, nothing more — all 9 tasks present.
- [x] Run interdicts respected. `public/embed/recopyfast.js` is untouched: identical blob SHAs
      on both branches, and `npm run build:embed` reproduces it byte-for-byte.

## Anti-hallucination
- [x] No invented API, function or import — each opened and verified.
- [x] No plausible-but-wrong value: constants recomputed from disk rather than read from the
      commit message.
- [x] The code matches what it claims to do. One **document** does not — see F1.

## Rules compliance
- [x] AGENTS.md conventions followed.
- [x] No accepted ADR contradicted.
- n/a Design system — no UI.

## Tests
- [x] Suite run by the reviewer, not taken on trust. `main` baseline 140 suites / 1954 tests.
      Feature branch, on a quiet machine: **141 suites / 1963 passed / 0 failed** — the claimed
      figure is exact. lint 0 errors (44 pre-existing warnings, none new); `type-check`,
      `type-check:build`, `format:check` clean; `npm run build` exit 0.
- [x] Assertions pin the acceptance criteria.
- [x] **Bite proven by neutralization** — 8 mutations, 7 went red: removing the `--check` gate,
      letting the override loosen, slice→whole-file measurement (7 tests), raising
      `MAX_WIDGET_GZ`, disabling staleness detection, importing esbuild inside `--check`, and
      gzip level 9→6 (6 tests). All restored; `git diff --exit-code` clean. The 8th is F2.

Two earlier reviewer runs were red (27 then 20 failures) purely under machine load — all 5s
`userEvent` timeouts in `SiteRegistrationModal` / `SiteEditorsCard` / `SiteCard` / `LoginForm` /
`collaboration`, none touched by this diff. Ruled out as caused by the change (feature branch
with the new file 31s green vs. without it 33s green). **Pre-existing suite fragility under
load, not chargeable to this story — but worth its own ticket.**

## Verified empirically, not read
1. Constants recomputed: Node zlib L9 → 46875 / 34063 / 13141, exact. Also identical on Node
   20.11 (CI's pin), 22, 24 and 25. Node 16 differs (46757 / 33947 / 13122) but is **lower**, so
   it cannot cause a false failure.
2. The gate refuses: `RCF_EMBED_CEILING_OVERRIDE=1000 … --check` exits 1 and names both
   constants, both measured values and both overages.
3. The override cannot loosen: `99999` warns and exits 0 with constants intact; `40000` tightens
   the bundle only and warns for the widget; `abc` / `0` / `-5` are warned and ignored.
4. `--check` is rebuild-free, proven at **runtime** via a module-resolution hook: it resolves
   only `node:crypto`, `node:fs/promises`, `node:module`, `node:path`, `node:url`, `node:zlib`.
   Nothing from `node_modules`.
5. The shipped artifact did not move (see Plan compliance).
6. Ratchet-as-defect documented in three places.
7. The NUL escape is hash-neutral: both forms hash to `ef738cdfe572cd…`, equal to the committed
   `@generated-from-sha256` marker. Not critical.

## Findings

- **minor — F1 — `docs/architecture.md:189-194` and the commit message: "34,063 under both
  compressors" is false.** Removing the gzip filename-header confound: artifact 46,767 (gzip)
  vs 46,875 (node); artifact-minus-transport **33,891** (gzip) vs **34,063** (node);
  widget-without-banner 33,689 vs 33,866. **No `gzip -9c` measurement anywhere yields 34,063.**
  The constant is correct for what the code actually measures; the paragraph written to *stop*
  compressor confusion is itself wrong on one of its three numbers. Independently reproduced
  before accepting. Fixed in this commit.
- **minor — F2 — the build-mode gate is untested.** Deleting `enforceCeilings` at
  `scripts/build-embed.mjs:465` leaves all 52 embed tests green. CI's `--check` step
  compensates, so the gate cannot silently vanish in practice.
- **minor — F3 — zero headroom, and it inverts the story's own premise.** The artifact sits
  *exactly* at both ceilings. Combined with "raising a ceiling is a defect", any story that adds
  a widget byte is red on arrival — so `s09` (≤2,000 gz) and `s11c` (≤2,000 gz) are blocked, not
  unblocked. **`stories.md`'s claim that `s06a` alone unblocks `s08`/`s09`/`s11c` is
  mechanically the opposite.** Recorded against the backlog; the real prerequisite for the
  additive stories is `s06c` (the shrink), which is what creates headroom.
- **minor — F4 —** "byte-identical everywhere Node runs" is over-broad; Node 16 disagrees. Safe
  in practice because it differs downward.
- **minor — F5 —** the suite's "cannot leave `public/embed/` dirty" header claim is overstated:
  the staleness test does write the artifact, restoring it in a `finally`.
- **minor — F6 — scope.** The `\0` escape and `.gitattributes` are outside the plan's file list.
  Both were declared in the commit with rationale and proven neutral. Kept.

## Not verified
- **CI has never run on a real runner.** The `--check` step is new and unexercised there.
- **No Vercel deploy has passed through this gate.** Because the artifact sits *at* the ceiling,
  the first deploy that touches `recopyfast.src.js` and adds a byte fails the **deploy**, not
  just the PR. Someone should force that once, deliberately, before it happens by surprise.
- The widget was never loaded in a browser.
- A real (non-override) ceiling breach never occurred.
- `measureBundle`'s throw path and both `--check` missing-file branches are unexercised.
- Playwright was not run.

## Verdict
Max severity: minor
Ship allowed: yes
