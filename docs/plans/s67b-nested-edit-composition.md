---
validated: yes
---

# Plan — s67b-nested-edit-composition

Human validated on 2026-10-12: **"Validate all four recommended plans"**.
Mechanically materialized from the approved deferred-findings proposal. Approval covers fresh
research, implementation and independent review within this plan. No production migration or merge
is authorized. Reopen a checkpoint only for a material premise or semantic change.

Branch: `feature/s67b-nested-edit-composition` from `origin/main` `bc6e503`.
Research must be verified and saved before source edits.

## Shared constraints

- One story, branch and PR per scope. None of the four fixes is bundled with another.
- Every story starts with fresh `/ks-research`; the paths below are the current surface, not a
  substitute for re-verifying it when the story begins.
- New migrations are forward-only and timestamp-prefixed. Applied migrations are never edited.
- No new dependency.
- The embed ceilings only go down. `s67b` may not raise a ceiling, remove discovery coalescing,
  remove the per-page discovery cap, or stop observing shadow roots to buy bytes.
- Existing authorization, rate limits, RLS and service-role boundaries remain unchanged unless the
  story explicitly tests an equivalent or stricter boundary.
- Each implementation is test-first, passes the repository Definition of Done, receives an
  independent review, and ends with the exact review footer required by `AGENTS.md`.

### User-visible outcome

When both a parent element and a mapped descendant have edited copy, both edits remain visible and
settle without an observer write loop. Navigation, rescans, realtime updates, variants and editor
saves preserve the same ownership rule.

### Current premise

PR #69 reproduced the defect: writing the parent replaces the descendant text; reapplying the
descendant changes the parent's aggregate text; observer repair alternates until the write caps,
leaving mixed or missing copy. The prior fix run designed and tested an owned-text rule but measured
it above the then-current bundle/widget ceilings. D2 and D3 shipped; D1 was deliberately deferred.

### Recommended safe approach

Use the recorded **applied-descendant ownership** rule from `docs/stories.md`: a parent owns text
nodes beneath it except those inside a descendant whose own copy was applied in this page view.
Discovery, reads, writes and reapply comparisons use the same owned text. Route restoration uses
the scope discovery captured: a complete original keeps the story's full-element behavior, while
a late parent's partial owned original preserves mapped descendants. Editor saves preserve
surrounding whitespace.

Fund the implementation only through behavior-preserving simplification or a smaller equivalent
encoding found during research. If it does not fit under the ceilings in force on the story branch,
stop. Do not raise a ceiling or trade away discovery spacing, its trailing report, its per-page cap,
or shadow-root coverage.

### Tasks

1. [x] **Re-measure and reproduce on current main.**
   - Record current generated hashes and all embed gzip measurements.
   - Add/restore the parent-plus-mapped-child red tests in
     `src/__tests__/embed/embed-spa.test.ts` and the direct-text coverage in the React write suite.
   - Pin: settles in at most three writes; a rescan adds zero writes; twelve host write-backs are
     each repaired without exhausting the cap; both edits remain visible.
2. [x] **Define one ownership helper.**
   - Implement the smallest shared source helper in `public/embed/recopyfast.src.js`; do not edit
     the generated artifact.
   - Use one definition for discovery/read, applied-copy write, overwrite comparison, realtime,
     variant and editor-save paths so two slightly different ownership rules cannot drift.
3. [x] **Preserve lifecycle behavior.**
   - Test route-change restoration, page-path reporting, A/B markers, variant application,
     realtime content and an outer editor save containing a separately edited child.
   - Preserve exact spaces around excluded descendant nodes.
4. [x] **Fund and build.**
   - First remove duplication or shorten equivalent code with mutation tests proving no behavior
     changed. No protection may be removed for size.
   - Run `npm run build:embed`, verify the generated artifact comes only from the source, and run
     `node scripts/build-embed.mjs --check` plus the size-gate tests. Ratchet a ceiling down if the
     final output is smaller; never up.
5. [x] **Repair the review-found late-ancestor restoration defect.**
   - Capture an explicit partial-original bit when discovery actually prunes an applied exact-
     identity descendant, including an applied empty child.
   - Snapshot all route-restore eligibility before writing, restore in descendant-first total
     document order while mappings remain present, then clean up entries.
   - Pin both record insertion orders, an unrelated interleaved entry, three-level nesting and a
     retained shared child with zero text mutations. Characterize ADR 066's existing complete-
     parent/shared-child result without broadening the snapshot model.
   - Record the amended lifecycle rule in ADR 068.
6. [x] **Verify the permanent widget contract.**
   - [x] Run targeted embed unit tests, built fixture, `e2e/embed-spa.spec.ts`, type-check, lint,
         full Jest and build.
   - [x] Run the independent `/ks-review` gate after the implementation commit.

### Implementation evidence (2026-10-12)

- Baseline source/artifact SHA-256:
  `15681873057b682dbbb9246d13e4903b33d1d8be3a9e3727b2fda3726f156c6f` /
  `9b604b94dfe37fe26bda7605ade8152aa9cf5d7e0e31c7b6be53563af5af5317`;
  final: `e012083864740b670b010b735c515e579d54bb6dbb1c56d63aa85b17312f096d` /
  `cefe75e9ba9ffde17ba4555f658a6b6c354f79d983617f48d3a5f826342bcf65`.
- Runtime correction: the first byte evidence came from Node 25.6.1 / zlib 1.2.12 and was
  invalid for this Node 24 repository. Node 24.14.0 / zlib 1.3.1-e00f703 measures baseline
  45,818 / 33,059, the first unfunded implementation 45,933 / 33,165 and final
  45,769 / 32,992.
  The already-lowered ceilings stay 45,801 / 33,044; transport is 13,141.
- Funding is behavior-equivalent: the feature itself is +115 / +106; shorter private helper
  naming is -4 / -4; existing `Element.remove()`, direct NodeList iteration and a lexical polling
  callback are -65 / -60; lexical collection/A-B callbacks and removal of redundant `self`
  aliases are -74 / -82; the first fresh-review whole-restore comparison and tombstone are
  +8 / +8. The PR #99 capture-scope and staged route repair then costs +136 / +132; equivalent
  `append` forms and four bounded lexical callback clusters recover -145 / -144; equivalent
  array membership checks recover -19 / -22; the final source tombstone's banner-hash movement
  recovers -1 / -1. Net against main: -49 / -67.
- Red phase: 30 boot mutations, failed realtime/variant repairs, partial navigation restore,
  aggregate `"Sell today"` outer save and the same 30-mutation loop in React. Green phase:
  targeted source/React/size/inventory suites 80/80.
- Mutation checks turned the targeted tests red when (1) applied-descendant exclusion was
  disabled, (2) every mapped descendant was excluded, (3) whole-element route restoration was
  removed, (4) exact element identity was removed from ownership, (5) partial originals were
  forced back through the whole writer and (6) the total document-order sort was replaced with a
  containment-only comparator around an unrelated interleaved entry.
- Fresh review regression: with only the child published, a later parent update equal to the
  parent's aggregate authored copy produced `"Buy nownow"` on navigation. The new Jest case and
  generated-artifact Chromium step both failed with that exact value before the mode-aware
  equality guard and pass with `"Buy now"` / blank child after it.
- PR #99 regression: a late parent around an already-applied child restored from a partial
  `originalContent`. Before the repair, the two insertion orders ended at `"Shop now"` and
  `"Buy "`; the interleaved complete-parent mutation ended at `"Buy nownow"`. The explicit scope,
  snapshot, descendant-first restore and delayed cleanup pass all new Jest cases, including empty
  child, three levels and zero retained shared-child mutations.
- Chromium: credential-free generated-artifact fixture 7/7 (strict inventory), including nested
  visible copy, zero rescan churn, 12 alternating repairs, both late-parent insertion orders and a
  retained shared child with zero text mutations; existing SPA E1–E5 5/5 on the owned local host.
  No production host or API was called.
- Repository gates: lint 0 errors / 34 inherited warnings; format, type-check and
  type-check:build green; full Jest 484 suites / 6,964 tests passed with 2 database-gated suites /
  38 tests skipped; the affected Node 24 embed scope passes 9 suites / 155 tests and the
  generated-artifact Chromium fixture passes 7/7; SPA/React E1-E5 pass 5/5; the Node 24
  production build is green with placeholder environment values. Independent repair review
  reproduced the 5/60 partial-mode mutation, restored the exact source hash, passed the same
  155-test scope, passed artifact check and passed Chromium 7/7.

### Expected files

- `public/embed/recopyfast.src.js`
- Generated `public/embed/recopyfast.js` via `npm run build:embed`
- `src/__tests__/embed/embed-spa.test.ts`
- The existing React-write/embed-size tests identified by research
- `e2e/embed-spa.spec.ts` and its fixture only if a new nested case is needed
- Canonical s67b research/plan/review docs after the checkpoint

### Human checkpoint

Approve the existing applied-descendant ownership semantics. This proposal rejects the cheaper
“outer edit wins” alternative because it hides the child's edit. Validation also accepts the hard
stop: if behavior-preserving funding cannot fit the current ceilings, the story returns for a new
product decision rather than weakening discovery or raising the budget.
