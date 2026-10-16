# ADR 066 — Applied descendants own their text inside an edited ancestor

- Status: accepted (owner validation on 2026-10-12)
- Date: 2026-10-12
- Scope: story `s67b-nested-edit-composition`
- Amends: [ADR 049](./049-embed-observes-the-host-never-patches-it.md) — its route detection,
  host-node preservation and 10-write cap remain unchanged; this ADR closes the nested-edit gap
  that ADR 049 explicitly deferred after PR #69.

## Context

ADR 049 made an edited row resilient to a host re-render. The observer compares the live DOM with
the cached row and reapplies the row, up to 10 writes per mapped element per page view. Its
host-safe writer keeps every node but puts the copy in the element's first direct text node and
blanks its other descendant text nodes.

That rule did not compose when a parent and a mapped descendant both had edited copy:

```html
<h1>Buy <span>now</span></h1>
```

Writing the parent blanked the child; repairing the child changed the parent's aggregate
`textContent`; repairing the parent blanked the child again. Current main reproduced 10 parent
writes, 10 child writes and 30 mutation records during boot. Both entries exhausted the cap before
the host made a single later write.

Treating every mapped descendant as separate was not valid. Existing rows can hold one edit for
the parent's complete text, such as `Build faster with <span>AI</span>`. Excluding the merely
mapped span would render the authored `AI` beside the parent's complete edited row and duplicate
the words.

## Decision

1. A mapped element owns every text node beneath it except the subtree of a descendant whose own
   copy the widget **applied in the current page view**. Applied means the descendant has a
   recorded widget write: a published row, realtime update, A/B variant or editor save. Being
   stamped or mapped alone does not transfer ownership.
2. One ownership helper defines discovery reads, overwrite comparison, published/realtime/variant
   writes, Edit Board reads and inline-editor reads, saves, cancel and AI replacement. It prunes an
   applied descendant by exact element identity, so duplicate author-written ids cannot transfer
   ownership between nodes.
3. Writes retain ADR 049's host-node guarantee: no `textContent` assignment, replacement, removal
   or reordering. Copy stays in the parent's first direct owned text node; other owned text nodes
   are blanked; an applied descendant's nodes are untouched.
4. Owned whitespace is content. A parent row `"Shop "` plus a child row `"today"` renders
   `"Shop today"`. When the outer element is edited, its read and saved body keep that trailing
   space and exclude text typed inside the separately applied child.
5. Route restoration is the one whole-element exception. `originalContent` was captured before
   either edit and includes the child's authored words. Restoring only the parent's owned prefix
   produces duplicated authored text; therefore `dropEntry` writes the complete recorded parent,
   blanking the child until the host renders the new route's complete tree. Page-path reporting
   then reads the host-rendered tree under the new path.
6. The existing 10-write cap remains per mapped element. Twelve alternating host write-backs are
   six writes per element, so both edits are repaired without weakening the cap.

## Considered options

- **The outer edit wins.** Rejected. It is smaller, but the child edit disappears and the user sees
  `"Shop "` rather than `"Shop today"`.
- **Every mapped descendant owns its text.** Rejected. It duplicates authored descendant words for
  existing whole-parent rows that never applied separate child copy.
- **Remove or weaken discovery protections to fund composition.** Rejected. Discovery's 10-second
  spacing, trailing report, per-page report cap and open-shadow-root observation prevent live
  pages from flooding the fail-closed site limit. The implementation fits the unchanged ceilings.
- **Raise the embed ceiling.** Rejected. The permanent widget budget ratchets down only.

## Consequences

- Nested parent and child edits settle in three DOM writes, a rescan writes nothing, and host
  write-backs repair each entry independently.
- Realtime and A/B copy establish the same descendant ownership as load-time rows; navigation and
  editor saves cannot use a subtly different rule.
- A route change briefly shows the restored whole authored parent with the descendant blank until
  the host renders the new route, matching a full load without duplicating the child's words.
- The generated artifact remains at the permanent `/embed/recopyfast.js` URL and stays under the
  ceilings in force when this story began.
