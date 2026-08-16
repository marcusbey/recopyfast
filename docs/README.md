# RecopyFast Documentation

**Start here: [`prd.md`](./prd.md)** — the source of truth for scope. What we build, what
we sell, what is deliberately frozen. Everything else in this folder is subordinate to it.

If a document here contradicts the PRD, the PRD wins and the document is stale.

---

## Map

### [`prd.md`](./prd.md)
Product definition: target, perimeter, graveyard, angle, success criteria, SEO and GTM.

### `product/` — what it does and for whom
| File | Contents |
|---|---|
| [`user-journey.md`](./product/user-journey.md) | Full journey map, screen by screen |
| [`user-journey-secure.md`](./product/user-journey-secure.md) | The token/grant-based editing journey (email invite → scoped edit access) |
| [`user-workflow.md`](./product/user-workflow.md) | Operational workflow across roles |
| [`editing-system.md`](./product/editing-system.md) | How inline editing works — detection, selectors, persistence |
| [`ai-features.md`](./product/ai-features.md) | AI rewrite, suggestion and translation behaviour |

### `architecture/` — how it is built
| File | Contents |
|---|---|
| [`overview.md`](./architecture/overview.md) | System architecture and technology stack |
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
- **Root keeps exactly three markdown files**: `README.md` (project intro),
  `CHANGELOG.md`, `CLAUDE.md` (agent instructions). Everything else lives here.
- Co-located READMEs (`server/`, `supabase/`) stay where they are.
