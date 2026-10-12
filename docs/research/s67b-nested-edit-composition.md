# Research — Story s67b-nested-edit-composition

Verified in the story worktree on branch `feature/s67b-nested-edit-composition` at
`bc6e503` on 2026-10-12. This report used only local source, generated artifacts and a
jsdom reproduction. It made no production, provider or paid call and loaded no production
environment.

## Story and accepted outcome

The approved rule is composition by **applied-descendant ownership**. A mapped parent owns
the text nodes beneath it except the text beneath a descendant whose own copy the widget has
applied during the current page view. “Applied” is essential: excluding every stamped
descendant would duplicate ordinary whole-element rows saved before this feature. The parent
and child must both remain visible, settle without an observer loop, and keep the same rule
through rescans, host write-backs, realtime updates, A/B variants and editor saves.

The exceptions are also approved. A parent whose `originalContent` captured its complete
first-seen authored text restores in whole-element mode, because an ownership-aware restore would
append the authored child twice. Follow-up research found a second capture scope: a parent mapped
after its child applied records only its owned prefix, so that partial original must restore in
ownership mode. Whitespace around an applied descendant is data, so the parent editor must read
and save its owned text without trimming it. The feature changes no UI appearance and needs no
story design artifact.

## Baseline and generated-file identity

**Runtime correction, 2026-10-12.** The first research pass ran the gate with the managed
worktree's default Node 25.6.1 / zlib 1.2.12, while the repository and CI pin Node 24.14.0 /
zlib 1.3.1-e00f703. The artifact-staleness result was valid, but its gzip figures were not.
Every figure below was re-measured through the reviewed Node 24 environment.

`npm run build:embed -- --check` on current main reports:

| Measure                                    |  Current |  Ceiling | Headroom |
| ------------------------------------------ | -------: | -------: | -------: |
| Bundle, Node `zlib.gzipSync({ level: 9 })` | 45,818 B | 45,818 B |      0 B |
| Widget, same compressor                    | 33,059 B | 33,059 B |      0 B |
| Transport, same compressor                 | 13,141 B |        — |        — |

The relevant SHA-256 values before implementation are:

- `public/embed/recopyfast.src.js`: `15681873057b682dbbb9246d13e4903b33d1d8be3a9e3727b2fda3726f156c6f`
- `public/embed/recopyfast.js`: `9b604b94dfe37fe26bda7605ade8152aa9cf5d7e0e31c7b6be53563af5af5317`
- `public/embed/socket.io-client.min.js`: `a88a51aeb243227b7f1555435917fc268e423f3c68ef2252f5c27559e1ff321a`

The prior D1 prototype was measured at approximately +87 B bundle / +84 B widget over the
D2+D3 build. Current main has no Node 24 headroom. The first complete implementation measured
45,933 / 33,165 (+115 / +106), so it required behavior-equivalent funding; the source hash
embedded in the artifact can still move gzip by a few bytes. The ceilings may only stay fixed
or move down.

## Premise verification

The defect remains present on current main. A no-edit jsdom run booted the real source IIFE on:

```html
<h1 data-rcf-id="parent">Buy <span data-rcf-id="child">now</span></h1>
```

with edited rows `parent = "Shop "` and `child = "today"`. It ended visually at `Shop today`,
but only after both entries reached their 10-write limit: 10 parent writes, 10 child writes and
30 mutation records during boot. This matches the PR #69 D1 report rather than merely repeating
its claim.

The cause is current code:

- `writeText` walks all descendant text nodes, writes the parent’s first direct text node and
  blanks every other text node (`public/embed/recopyfast.src.js:786-798`). Applying the parent
  therefore erases the child.
- `getElementText` returns aggregate `element.textContent` (`:2805-2812`). Applying the child
  therefore makes the parent appear overwritten.
- `applyContentToElement` compares with that aggregate read, records `written`, and calls
  `writeText` (`:3686-3725`).
- `setupMutationObserver` calls `applyRow` for the mapped ancestor closest to every changed
  record (`:3999-4037`). The parent and child writes consequently invalidate one another until
  their caps.

The story premise is true and needs no plan change.

## Current implementation surface

`public/embed/recopyfast.src.js` is the only source of widget behavior. The generated
`public/embed/recopyfast.js` must come from `npm run build:embed`.

One shared ownership helper must serve these existing paths:

1. Discovery and reporting: `scanForContent` reads with `getElementText`, stores
   `originalContent`, and `sendContentMap` reports that value (`:2707-2749`, `:3162-3201`).
2. Published, realtime and variant writes: `applyRow`, `handleContentUpdate` and
   `applyVariants` all converge on `applyContentToElement` (`:3497-3527`, `:3657-3725`,
   `:3841-3879`).
3. Observer overwrite checks: `applyContentToElement` compares current text before writing,
   and the observer invokes `applyRow` for touched mapped elements (`:3705-3725`, `:4001-4013`).
4. Editor reads and saves: `startTextEdit` captures with `getFullElementText`, but its
   `sanitizeContent`, save, cancel and AI adapter currently use aggregate `textContent` or the
   old whole-element writer (`:4548-4573`, `:4820-4832`, `:4934-5030`).
5. Route restoration: `dropEntry` compares the recorded write, then calls the same normal
   writer with `originalContent` (`:3785-3809`). Complete captures need explicit whole-text mode;
   late parents whose discovery read pruned an applied child need owned-text mode instead.

The element entry already has the required state signal: `data.written` is set by every
successful content application and by editor saves. Variants and realtime use the same writer,
so “descendant has applied copy in this page view” can be derived from the mapped descendant’s
entry without a second registry or marker. Route changes delete page-scoped entries and reset
shared write counters; the restoration path must also ensure the prior page’s applied state does
not affect the next scan.

## Existing tests and new proof points

- `src/__tests__/embed/embed-spa.test.ts` boots the real source IIFE and already controls rows,
  observer delivery, navigation, variants, realtime and editor saves. It is the right place for
  the nested parent/child convergence, rescan, 12 host write-backs, route restoration, realtime,
  variant and editor-save regressions.
- `src/__tests__/embed/embed-react-writes.test.tsx` boots the real source into React 19 and
  already proves direct-text-node identity. It must pin the new owned-text writer so preserving
  a separately applied child does not regress the s67 host-node guarantee.
- `src/__tests__/embed/build-size-gate.test.ts` and `scripts/build-embed.mjs` carry the paired
  ratchet. They change only if the final official output is below the current ceilings.
- `e2e/embed-fixture/nested-composition.spec.ts` exercises the generated artifact in Chromium.
  Its strict seven-test inventory now includes nested convergence, alternating write-backs and
  route restoration for both late-parent record orders and a retained shared child.

The red phase must prove at least: at most three widget writes at boot, zero writes on a rescan,
both edits visible, 12 alternating parent/child host write-backs repaired without exhausting the
cap, whitespace retained, complete route restoration, and outer editor save excluding the
separately applied child. Mutation checks should fail when either descendant exclusion or the
applied-state predicate is deliberately removed.

## Traps and invariants

- Exclude descendants only after their own copy was applied. Excluding every mapped child breaks
  a legacy whole-parent row such as `Build faster with <span>AI</span>` by leaving the child’s
  authored text beside the parent row.
- Preserve text-node identity. The s67 incident was a React 19 `NotFoundError` and root unmount
  caused by replacing host nodes; no solution may assign `textContent`, `innerHTML`, replace or
  remove a host node.
- Preserve exact owned whitespace. A parent row `Shop ` plus child row `today` must render
  `Shop today`, never `Shoptoday`; the outer editor save must send the trailing space.
- `dropEntry` must restore in the scope discovery captured. Complete originals use whole mode;
  partial originals use owned mode. Route eligibility must be snapshotted before any restore so
  one write cannot change another entry's decision.
- Discovery coalescing, its trailing report, the per-page report cap and open-shadow-root
  observation are protected funding lines. The feature cannot delete or weaken them.
- The current observer deliberately processes only the closest mapped ancestor per record. A
  working ownership helper must not depend on observer order; the rescan and direct application
  paths can invoke parent and child in document order.
- Comments change the generated banner hash and therefore gzip. The required tombstone should be
  concise and byte measurements must come after all source comments are final.

## Review repair research — late-discovered ancestors (PR #99)

The first implementation and re-review repaired the whole-mode equality check, but PR #99 exposed
a different premise error. The following local sequence uses only the real source IIFE:

1. map `<span>now</span>` and apply `today`;
2. let the host wrap it in a newly discoverable `<h1>Buy <span>today</span></h1>`;
3. discover the `h1`, whose ownership read records only `"Buy "` as `originalContent`;
4. apply `"Shop "` to the parent and navigate.

Sequential `dropEntry` cleanup treated `"Buy "` as a complete original. Child-first insertion
finished at `"Shop now"`; forcing parent-first insertion finished at `"Buy "`. A shared-id child
could remain visibly correct only after being blanked and rewritten twice, which still violated
the retained-child contract. An applied empty child reproduced the scope error even though owned
and aggregate text equality could not reveal it.

The smallest correct distinction is an explicit capture-scope bit set by the ownership walk when
it actually prunes an applied exact-identity descendant. Route cleanup must snapshot every page
entry's eligibility, restore entries in descendant-first total document order while all mappings
remain present, and remove entries only afterward. A containment-only comparator is insufficient:
`[parent, unrelated, child]` can remain in that order because the adjacent comparisons are equal.
Reverse document order supplies a total order and keeps every descendant before its ancestor.

The bounded repair preserves ADR 066 for a complete parent discovered before a shared child later
applies: whole restoration can still blank that retained child. The test suite characterizes that
existing result instead of claiming a broader authored-tree snapshot model. ADR 068 records this
scope distinction.

## Open questions

No product or architecture question blocks implementation. The corrected Node 24 build finishes at
45,769 B bundle / 32,992 B widget / 13,141 B transport under unchanged ceilings of 45,801 / 33,044.
Funding uses equivalent DOM insertion forms, bounded lexical callbacks and equivalent array
membership checks; discovery coalescing, its trailing report, the page cap and shadow observation
remain intact.

## Complexity re-score

`docs/stories.md` leaves this deferred stub unscored. Current evidence makes it **4/5**: the rule
is already approved and the production change is concentrated in one embed source, but it crosses
discovery, hydration, observer repair, realtime, variants, editing and navigation under a hard
gzip gate on a permanent public script. The work should remain one story because every path must
share one ownership definition; splitting them would create the drift the plan explicitly forbids.

Research ready in docs/research/s67b-nested-edit-composition.md. Next step: /ks-plan s67b-nested-edit-composition
