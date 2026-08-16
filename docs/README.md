# RecopyFast Documentation

**Start here: [`prd.md`](./prd.md)** — the source of truth for scope. What we build, what
we sell, what is deliberately frozen. Everything else in this folder is subordinate to it.

If a document here contradicts the PRD, the PRD wins and the document is stale.

---

## Map

### [`prd.md`](./prd.md)
Product definition: target, perimeter, graveyard, angle, success criteria, SEO and GTM.

### [`stories.md`](./stories.md)
The delta backlog — 19 shippable stories covering the gap between what is in production
today and what the PRD requires. Ordered by dependency. Ids (`s01`…`s19`) name every
pipeline file and story branch.

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

### [`decisions/`](./decisions/)
One ADR per structural decision, with the options considered and why they were rejected.
Immutable: a change means a new ADR superseding the old one.

| ADR | Decision |
|---|---|
| [001](./decisions/001-inherited-production-baseline.md) | The inherited production codebase is the architectural baseline |
| [002](./decisions/002-rls-tenant-boundary.md) | RLS is the tenant boundary; service-role is a named exception |
| [003](./decisions/003-no-schema-validation-library.md) | Boundary validation stays hand-rolled; no schema library |
| [004](./decisions/004-embed-transport-split.md) | Native WebSocket for the embed, Socket.io for first-party |
| [005](./decisions/005-client-state-context-and-fetch-hooks.md) | Client state is React Context plus custom fetch hooks |

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
| File | Contents |
|---|---|
| [`styleguide.md`](./design/styleguide.md) | Visual and UI conventions |

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
