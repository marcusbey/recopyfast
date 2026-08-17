# ADR 024 — The bulk-import snapshot writes `change_type: "bulk_edit"`

- Status: accepted
- Date: 2026-08-17
- Scope: story `s05-bulk-content-portability`
- **Supersedes** [ADR 008](./008-bulk-import-write-path.md) **on one literal value only.** Every
  other part of ADR 008 — the direct write, the single post-batch snapshot, the zero-call rule when
  nothing was applied — stands unchanged.

## Context

ADR 008 specified that after a batch completes with at least one applied row, the import route
calls `create_content_version` once with **`change_type: "bulk_import"`**.

**That value does not exist and never has.** `content_versions.change_type` has carried a CHECK
constraint since `20251230100000_edit_board.sql:69` admitting exactly six values:

```
('manual', 'style_apply', 'language_switch', 'theme_apply', 'restore', 'bulk_edit')
```

Verified during the `s05` re-review by grepping every migration for `ALTER`/`DROP CONSTRAINT` on
`content_versions` — the only later churn is RLS policy work. Nothing relaxes it.

Writing `bulk_import` would fail the insert with a CHECK violation. The failure mode is the reason
this matters: the snapshot call exists *so that an imported state is reachable through the same
restore mechanism a human's manual snapshot uses.* A rejected insert leaves that history **silently
empty** — the precise outcome ADR 008 was written to prevent.

**The implementation was right and the document was wrong.** The route has always written
`bulk_edit`. The `s05` implementer flagged the discrepancy rather than conforming its code to the
document, and the reviewer confirmed the constraint independently against the migration.

## Decision

**`create_content_version` is called with `change_type: "bulk_edit"`.**

The dashboard's status registry needed the mirror-image correction:
`versionChangeTypes` (`src/components/ui/status-badge.tsx`) was keyed `bulk` — also not a value the
column can hold — so every bulk snapshot fell through to *"Manual edit — Saved by hand from the edit
board"*. Both sides now agree on `bulk_edit`, and a render test pins it.

## Considered options

- **(a) Widen the CHECK to admit `bulk_import`.** Rejected. It is a migration against a constraint
  that is doing its job, to accommodate a value chosen in a document rather than derived from the
  schema. It would also leave two spellings for one concept — `bulk_edit` for edit-board bulk
  operations, `bulk_import` for imports — with no consumer able to rely on either.
- **(b) Edit ADR 008 in place.** **This is what actually happened on the `s05` branch, and it is
  wrong** — see Consequences.

## Consequences

**This ADR exists because ADR 008 was edited in place, and it should not have been.** `AGENTS.md`
and `docs/README.md` both state the rule: *ADRs are immutable; a change means a new ADR superseding
the old one.* The `s05` branch modified ADR 008's Decision paragraph directly and appended a
correction note. Two things were wrong with that:

1. **Mechanism.** ADR 008 is committed on `main` (`45844fd`), where line 51 still reads
   `bulk_import`. An immutable record was rewritten rather than superseded, so the branch's copy
   and `main`'s copy disagree about what was decided.
2. **The inserted note made a false claim about its own history** — it said the value was corrected
   *"before this ADR ever reached `main`."* It did reach `main`, saying `bulk_import`. A correction
   notice that misstates the record is worse than the error it corrects, because it forecloses the
   audit that would find it.

The remedy: **ADR 008 is restored byte-for-byte to its `main` content on the `s05` branch**, and
this ADR carries the correction. Anyone reading ADR 008 finds the original decision and follows the
supersession link — which is the whole point of the immutability rule.

**Substance was never in dispute.** The implementer's finding was correct, the reviewer verified it
independently against the migration, and the code was right the entire time. Only the record-keeping
needed fixing.

**Watch — the same silent-fallback defect exists elsewhere and is now pinned by a test.** The `s05`
review found `VersionTimelineItem.test.tsx:47` asserting that `style_apply` renders as *"Manual
edit"* and describing it as *"a change type this build does not know"* — but
`edit-board/styles/apply/route.ts:176` writes exactly that value on every AI style application. It
is the identical mislabelling just fixed for `bulk_edit`, now certified as correct by a new test.
That is `s05`'s to fix before it ships; it is recorded here because the cause is the same registry.
