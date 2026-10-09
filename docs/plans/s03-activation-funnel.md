---
validated: no
previously_validated: yes
validation_reopened: 2026-09-12
split_proposed: yes
---
# Plan — Story s03-activation-funnel (reopened and split)

Branch used for this amendment: `feature/s03-activation-funnel`
Research: `docs/research/s03-activation-funnel.md`
Design: `docs/designs/s03-activation-funnel.md`
Decision: proposed `docs/decisions/027-activation-milestones-and-edit-activity.md`

## Validation history

This plan was initially validated in August 2026. Execution preflight against `origin/main` at
`ee3942d` reopened it before any source edit:

- `s02-install-verified` is now shipped and exposes `sites.live_at`; the old conditional
  “s02 plan does not exist” task is obsolete.
- The account milestone decision is ADR 007. ADR 006 is the shipped site-status decision.
- Writing a milestone after its source route succeeds can permanently lose a one-time event.
- Four first-occurrence timestamps cannot answer `s14` recent edits or `s15` monthly edit
  counts. Rejoining live permissions to old history also reattributes events when admins change.
- The global operator view needs a server-provided capability; browser code cannot reproduce the
  server-only `ADMIN_EMAILS` gate.

The original plan remains recoverable from git history. It is removed from this canonical file so
`/ks-execute s03` cannot accidentally follow stale tasks beneath a warning.

## Full-scope split proposal

No requirement is dropped. The combined work is complexity 5 and becomes two independently
reviewable stories:

| Proposed story | Complexity | Owns | Dependencies | Design |
|---|---:|---|---|---|
| `s03a-activation-evidence` | 4 | Write-once milestone schema, append-only account edit activity, pinned atomic source triggers, reproducible legacy backfill, RLS and consumer query contract | shipped `s01`, shipped `s02`, proposed `s24`, proposed `s26` | None; data-only |
| `s03b-activation-funnel-surface` | 3 | Operator capability, UTC range read model, drop-off/p50/p90/attribution calculations and Activation dashboard tab | `s03a` | `docs/designs/s03-activation-funnel.md` |

Execution plans:

- [s03a activation evidence](./s03a-activation-evidence.md)
- [s03b activation funnel surface](./s03b-activation-funnel-surface.md)

Proposed ADR 027 keeps ADR 007's table-level first-write-wins rule, replaces post-write application
calls with source-transaction triggers, and separates first-occurrence milestones from ongoing
edit events.

## Human checkpoint required

Before either child executes:

1. Add both exact ids and their dependency edges to the accepted backlog.
2. Accept ADR 027 and the corrected AC8 contract:
   `account_milestones` is the sole funnel-timestamp source;
   `account_edit_activity` is the sole ongoing account-edit source consumed by `s14`/`s15`.
3. Land and review `s24` plus `s26`; `s03a` relies on their atomic history event and
   authoritative marked owner.
4. Validate each child plan separately. This parent remains `validated: no` permanently after the
   split.

No source code, database, migration, production service, push or deployment is authorized by this
amendment.
