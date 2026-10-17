# Archive — historical reference only

Nothing in this folder is current. These are point-in-time snapshots and superseded
documents, kept because they record *why* decisions were made, not *what is true now*.

For what is true now, start at [`../prd.md`](../prd.md).

| File | What it was | Why it's here |
|---|---|---|
| `2026-08-16-architecture-plan.md` | `architecture/overview.md` — the original architecture plan and stack doc | Superseded by [`../architecture.md`](../architecture.md), which is verified against the code. This one asserted Zustand, React Query, TipTap and Cloudflare Workers, none of which exist. `reviews/stories*.md` cite it at its old path for the 30KB budget (line 326) |
| `2026-08-04-qa-user-journey.md` | QA pass over the live owner journey | Dated snapshot — findings were actioned |
| `2026-08-07-qa-production-audit.md` | Production readiness audit | Dated snapshot |
| `goal-audit-closeout.md` | Closeout report for a goal audit cycle | Completed, not maintained |
| `project-report.md` | Original build plan with day-by-day phases and inline code | Superseded by `prd.md` and the actual codebase |
| `project-index.md` | Hand-maintained file index | Superseded by `docs/README.md`; hand-maintained indexes drift |
| `comprehensive-feature-analysis.md` | Feature inventory | Superseded by the perimeter table in `prd.md` |
| `advanced-features-summary.md` | Implementation summary | Snapshot of a past sprint |
| `collaboration-summary.md` | Implementation summary | Snapshot of a past sprint |
| `test-review-summary.md` | Test review snapshot | Superseded by `quality/` |
| `user-journey-2025.md` | Earlier, shorter journey doc | Superseded by `product/user-journey.md` |
| `landing-page-prompt.md` | Generation prompt for the landing page | One-off artefact |
| `database-setup-instructions.md` | DB setup, underscore variant | Superseded by `operations/database-setup.md` |
| `database-setup-legacy.md` | DB setup, hyphen variant — a duplicate of the above | Three overlapping DB setup docs existed; this is the oldest |
| `execute-sql-commands.md` | Ad-hoc SQL execution notes | Folded into `operations/database-setup.md` scope |

## October 12 remaining-work audit sequence

These reports are historical, in the order below; “current”, “now” and pending statuses describe
that report's capture, not the repository today. The 15:59 UTC checkpoint (11:59 Toronto time)
predates the owner's later plan/release authorization and #81's 16:22:49 UTC squash merge
(`20f95f5`). The operator's active goal and release artifacts are local operational records, not
part of this archive publication. Use live PR/deployment evidence for current status.

| Snapshot | Scope and capture boundary |
| --- | --- |
| [Recent work and Devin audit](2026-10-12-recent-work-devin-audit.md) | Initial audit and repair follow-through; before the remaining-work goal and release authorization |
| [Embed budget feasibility](2026-10-12-embed-budget-feasibility.md) | Measured experiments on reviewed s67b, before any new transport implementation |
| [Release proposal review](2026-10-12-reviewed-fixes-release-review.md) | Independent readiness to request approval; the referenced executor and proposal were operator-local |
| [Preserved-work inventory](2026-10-12-preserved-work-inventory.md) | Read-only preservation census; later active-lane annotations are labeled |
| [15:59 UTC checkpoint](2026-10-12-remaining-work-checkpoint.md) | Latest pre-authorization summary; calculator retrospective docs opened in PR #100, not merged |

## Rule

Do not edit files in this folder. If something here is still needed, promote it: move it
out, rename it to kebab-case, update it, and link it from `docs/README.md`.
