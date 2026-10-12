# ADR 068 — Route restoration follows the text scope captured at discovery

- Status: accepted (s67b review repair on 2026-10-12)
- Date: 2026-10-12
- Scope: story `s67b-nested-edit-composition`
- Amends: [ADR 066](./066-applied-descendants-own-their-text.md), decision 5. Complete
  originals still use its whole-element restore. This ADR defines the distinct case where
  discovery captured only an ancestor's owned text.

## Context

ADR 066 treated `originalContent` as the complete first-seen text of an element. That is true when
the parent is discovered before any descendant copy applies. It is false when a host adds a new
ancestor around a descendant the widget already edited:

```html
<span>now</span>
<!-- widget applies "today" -->
<h1>Buy <span>today</span></h1>
<!-- host adds and discovery maps h1 -->
```

The ownership reader correctly records the new `h1` original as only `"Buy "`; the applied child
owns its subtree. Route cleanup nevertheless restored that partial original in whole-element mode.
It blanked the child and lost authored `"now"`. The result also depended on insertion order:
child-first records ended at `"Shop now"`, while parent-first records ended at `"Buy "`.

Comparing the owned read with aggregate `textContent` cannot identify this case. An applied child
may legitimately contain the empty string, so the two values can be equal even though discovery
pruned a descendant. Restoring entries one at a time is also insufficient: cleanup removes the
mapping that tells an ancestor which descendant owns its text, and a previous restore can change a
later entry's eligibility.

## Decision

1. Discovery records whether its ownership walk actually pruned an applied descendant of the
   exact mapped element identity. That explicit bit describes capture scope; it is not inferred
   from text inequality.
2. A complete original keeps ADR 066's whole-element restoration. A partial original is restored
   through the ownership writer, preserving mapped descendant subtrees.
3. On a route change, restoration eligibility for every departing page-scoped entry is snapshotted
   before the first DOM write. Eligible entries are then restored descendant-first while every
   mapping still exists. Only after all restores finish are route markers and map entries removed.
4. Descendant-first order is a total reverse document order. A containment-only comparator is not
   transitive across an interleaved unrelated entry such as `[parent, unrelated, child]` and can
   restore a complete parent too early.
5. A shared-id descendant is not a departing page entry. Restoring a late partial parent must not
   write, blank or remap that retained child.
6. Detached-node cleanup during discovery remains immediate. It uses the same captured scope to
   choose the writer, then forgets the detached entry as before.

## Bounded compatibility rule

This repair does not redefine a parent whose complete original was captured before a shared child
later applied. That parent still restores its complete authored text and can blank the retained
child, exactly as ADR 066 specifies. Solving that different lifetime model would require a broader
authored-DOM snapshot and a separate decision. The regression suite records the existing result so
the bounded repair cannot be mistaken for that expansion.

## Considered options

- **Infer partial capture from different text values.** Rejected. An applied empty child disproves
  the inference.
- **Restore and delete each entry in `Map` order.** Rejected. Eligibility and ownership then depend
  on writes and cleanup already performed for other entries.
- **Sort only ancestor/descendant pairs.** Rejected. An unrelated entry can separate a parent and
  child without the comparator ever ordering that pair.
- **Convert every original into a full authored-tree snapshot.** Deferred. It changes the complete
  parent/shared-child behavior beyond the reproduced late-parent defect.

## Consequences

- Late parents restore their authored owned prefix while page-scoped descendants independently
  restore their own authored copy, yielding `"Buy now"` in either record insertion order.
- Empty applied descendants and three-level late nesting use the same explicit capture rule.
- A retained shared child remains `"today"` with zero child text mutations when its late partial
  parent restores from `"Shop "` to `"Buy "`.
- Route cleanup performs two bounded passes over departing entries and retains ADR 049's host-node
  preservation and per-element write cap.
- The permanent generated widget remains below the unchanged gzip ceilings; no discovery spacing,
  trailing report, report cap or shadow-root coverage funds this decision.
