# RecopyFast Documentation

**Start here: [`prd.md`](./prd.md)** — the source of truth for scope. What we build, what
we sell, what is deliberately frozen. Everything else in this folder is subordinate to it.

If a document here contradicts the PRD, the PRD wins and the document is stale.

---

## Map

### [`prd.md`](./prd.md)
Product definition: target, perimeter, graveyard, angle, success criteria, SEO and GTM.

### [`stories.md`](./stories.md)
The delta backlog — **27 shippable stories** covering the gap between what is in production
today and what the PRD requires. Ordered by dependency. Ids name every pipeline file and story
branch. Read its **"Revised after research"** section first: five stories were re-scored to
complexity 5 and split (suffixed ids, never renumbered), and four open review majors were
settled against the code.

### `research/`, `designs/`, `plans/` — the per-story pipeline
| Folder | Contents |
|---|---|
| [`research/`](./research/) | 19 verified-context reports, one per original story. Split stories inherit their parent's report, whose `## Split proposal` defines them |
| [`designs/`](./designs/README.md) | 19 story designs (`<id>.md` + `<id>.html` mockup). Eight no-UI stories are recorded as deliberate skips in its README |
| [`plans/`](./plans/) | 27 plans, **26 `validated: yes`**. `s12-ab-results` was withdrawn on 2026-08-17 — it reads `ab_test_results`, which does not exist in the database. `/ks-execute` is fail-closed on `validated: no` |

### [`ship-order.md`](./ship-order.md)
The measured merge sequence for the reviewed branches, with the conflict surface and the byte-budget
constraint that is invisible from inside any single branch. Read before the first `/ks-ship`.

### [`reviews/stories.md`](./reviews/stories.md)
Fresh-context review of the backlog against the PRD. Its verdict was *critical / not ready*;
`stories.md` has since been revised to close every issue, and cites the old numbering — the
revised backlog carries an old→new id map for reading it.
[`reviews/stories-pass-1.md`](./reviews/stories-pass-1.md) is the first pass, kept for the
record. Both cite `docs/architecture/overview.md`, which is now
[`archive/2026-08-16-architecture-plan.md`](./archive/2026-08-16-architecture-plan.md).

### [`architecture.md`](./architecture.md)
**Canonical** description of the system as it is, verified against the code. Stack, repo
structure, conventions, data model, integration points. Supersedes the old
`architecture/overview.md`, which was an aspirational plan and wrong in seven places — see
its "Drift corrected" table.

### [`design-system.md`](./design-system.md)
The single visual reference, read by `/ks-design` at every story. Tokens, the 17-component
inventory, imposed UI patterns, Do/Don't — captured from the code, plus the surface-reach gaps
(email and the embed widget are off-system today, with evidence).

### [`decisions/`](./decisions/)
One ADR per structural decision, with the options considered and why they were rejected.
Immutable: a change means a new ADR superseding the old one.

**Framing decisions** (001–005) commit on `main`. **Story decisions** (006+) are scoped to a
story and travel with its branch.

| ADR | Decision | Scope |
|---|---|---|
| [001](./decisions/001-inherited-production-baseline.md) | The inherited production codebase is the architectural baseline | framing |
| [002](./decisions/002-rls-tenant-boundary.md) | RLS is the tenant boundary; service-role is a named exception | framing |
| [003](./decisions/003-no-schema-validation-library.md) | Boundary validation stays hand-rolled; no schema library | framing |
| [004](./decisions/004-embed-transport-split.md) | Native WebSocket for the embed, Socket.io for first-party | framing |
| [005](./decisions/005-client-state-context-and-fetch-hooks.md) | Client state is React Context plus custom fetch hooks | framing |
| [006](./decisions/006-site-status-persisted-state-machine.md) | Site status is a persisted state machine, not a derived count | `s02` |
| [007](./decisions/007-account-milestones-write-once.md) | Activation milestones are write-once rows, not a log scan | `s03` |
| [008](./decisions/008-bulk-import-write-path.md) | Bulk import writes through the human-edit path | `s05` |
| [009](./decisions/009-impression-history-change-timeline-source.md) | Which existing table is the true content-change timeline | `s10` |
| [010](./decisions/010-webhook-dispatch-out-of-band.md) | Webhook dispatch is out-of-band | `s16` |
| [011](./decisions/011-agency-digest-idempotent-send-ledger.md) | Digest sends are recorded before sending | `s15` |
| [012](./decisions/012-cluster-content-engine.md) | The SEO cluster engine is typed data plus one template | `s17` |
| [013](./decisions/013-lighthouse-ci-thresholds.md) | Lighthouse CI thresholds | `s17` |
| [014](./decisions/014-trial-as-expiring-plan-entitlement.md) | The trial is a time-boxed grant of `pro`, not a catalogue row | `s01` |
| [015](./decisions/015-impression-grain-and-anonymity.md) | Impressions are pre-aggregated and carry no visitor identifier | `s09` |
| [016](./decisions/016-ab-visitor-identity-and-dnt.md) | A/B visitor identity and Do-Not-Track behaviour | `s11c` |
| [017](./decisions/017-ab-conversion-is-per-visitor.md) | A/B conversion is defined over the per-visitor event stream (closes M2) | `s12` |
| [018](./decisions/018-tenant-scoped-serving-origin.md) | A tenant-scoped serving origin, and its irreversibility | `s20` |
| [019](./decisions/019-agency-billing-single-payer.md) | The agency is the only payer; payer and site owner are one identity | `s13` |
| [020](./decisions/020-seo-clusters-on-marketing-surface.md) | The SEO cluster pages render on the Marketing surface | `s17`–`s19` |
| [021](./decisions/021-wildcard-serving-origin-provisioning.md) | One wildcard domain and certificate; claiming is a database write | `s20` |
| [022](./decisions/022-realtime-parity-is-editors-only.md) | Real-time parity is defined over editors, not visitors | `s07b` |
| [023](./decisions/023-websocket-only-transport-no-sticky-routing.md) | WebSocket-only transport; the multi-instance answer is the adapter, never sticky routing | `s07b` |
| [024](./decisions/024-bulk-import-snapshot-change-type.md) | The bulk-import snapshot writes `bulk_edit` — supersedes [008](./decisions/008-bulk-import-write-path.md) on that value | `s05` |
| [025](./decisions/025-grant-on-the-content-write-path.md) | The device grant is a principal on the content write path, fail-closed on its origin pin | `s14a` |

> **Numbering.** 025 was authored as 019 on `s14a`'s branch and renumbered when it merged, because
> `019-agency-billing-single-payer` had taken that number on `main` in the meantime. Two branches
> cannot see each other's ADR numbers, so **check this table for the next free number when you
> write one, and expect to renumber if your branch sits unmerged for long.**

### `product/` — what it does and for whom
| File | Contents |
|---|---|
| [`user-journey.md`](./product/user-journey.md) | Full journey map, screen by screen |
| [`user-journey-secure.md`](./product/user-journey-secure.md) | The token/grant-based editing journey (email invite → scoped edit access) |
| [`user-workflow.md`](./product/user-workflow.md) | Operational workflow across roles |
| [`editing-system.md`](./product/editing-system.md) | How inline editing works — detection, selectors, persistence |
| [`ai-features.md`](./product/ai-features.md) | AI rewrite, suggestion and translation behaviour |

### `architecture/` — deep dives
Subordinate to [`architecture.md`](./architecture.md) above.

| File | Contents |
|---|---|
| [`embed-authentication.md`](./architecture/embed-authentication.md) | Secure embed auth design — site tokens, grants, revocation |
| [`script-consistency.md`](./architecture/script-consistency.md) | Embed script build and consistency guarantees |

### `operations/` — how to run it
| File | Contents |
|---|---|
| [`deployment-env.md`](./operations/deployment-env.md) | Environment variables, per-environment configuration |
| [`deployment-checklist.md`](./operations/deployment-checklist.md) | Pre-production verification steps |
| [`database-setup.md`](./operations/database-setup.md) | Supabase schema setup — **canonical** |
| [`stripe-setup.md`](./operations/stripe-setup.md) | Stripe products, prices and webhook configuration |

### `quality/` — how we keep it working
| File | Contents |
|---|---|
| [`testing-standards.md`](./quality/testing-standards.md) | Testing conventions and coverage expectations |
| [`test-quality-checklist.md`](./quality/test-quality-checklist.md) | Review checklist for test quality |
| [`auth-testing.md`](./quality/auth-testing.md) | Auth flow test procedures |
| [`qa-register.md`](./quality/qa-register.md) | Live QA findings register |

### `design/`
Subordinate to [`design-system.md`](./design-system.md) above.

| File | Contents |
|---|---|
| [`styleguide.md`](./design/styleguide.md) | The authored visual conventions — intent and rationale. `design-system.md` consumes it and adds the measured token values, component inventory and surface-reach gaps |

### [`archive/`](./archive/README.md)
Point-in-time reports and superseded documents. Historical reference only — **do not
treat as current**. See the archive README for why each file is there.

---

## Conventions

- **Lowercase-kebab filenames.** No `SCREAMING_SNAKE.md`.
- **One canonical document per topic.** If two files cover the same ground, one gets
  merged into the other or moved to `archive/`.
- **Dated reports go to `archive/`** with an ISO-date prefix, immediately. They are
  snapshots, not documentation — they are never updated in place.
- **Root keeps exactly four markdown files**: `README.md` (project intro), `CHANGELOG.md`,
  `CLAUDE.md` and `AGENTS.md` (agent instructions — `AGENTS.md` carries the pipeline rules and
  the technical conventions). Everything else lives here.
- Co-located READMEs (`server/`, `supabase/`) stay where they are.
