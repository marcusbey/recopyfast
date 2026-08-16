# ADR 001 — The inherited production codebase is the architectural baseline

- Status: accepted
- Date: 2026-08-16
- Scope: framing

## Context

The killer-saas pipeline expects `/ks-architect` to derive conventions from a boilerplate —
the stack comes from the base rather than from scratch. RecopyFast has no boilerplate. It has
something stronger and less negotiable: a system already running in production.

What makes it non-negotiable:

- **43 applied migrations** in `supabase/migrations/`, twelve of which exist only to close RLS
  gaps found after the fact. That knowledge is encoded in SQL, not in anyone's head.
- **A live Stripe catalogue.** `plans` is the source of truth and price ids come from env. A
  rescaffold means re-deriving the catalogue and re-syncing Stripe in two modes.
- **`/embed/recopyfast.js` is a permanent public URL.** It is baked into every snippet ever
  issued. Any change of framework, host or routing that moves it breaks live customer sites.
- **1954 passing tests** and a CI gate that blocks on audit → lint → type-check → build → test.

There are 0 users today, which is genuinely a window to cut scope hard — the PRD uses it. It
is not a window to change stack: the constraints above bind at zero users exactly as they do
at a thousand, because they are about deployed artifacts, not about customers.

## Decision

Keep the inherited stack in full: Next.js 16 App Router + React 19 + TypeScript strict on
Vercel, Supabase Postgres with RLS, Supabase Auth, Stripe, Redis, Socket.io in a separate
service, Jest + Playwright.

Every convention in [`docs/architecture.md`](../architecture.md) is *extracted from this code*,
not proposed for it. Where the code and a general best practice disagree, the code wins unless
a later ADR supersedes this one. Conform to it; do not rewrite it.

## Considered options

- **ship-saas.now boilerplate (Drizzle, Better Auth)** — rejected. Replaces the ORM and the
  auth provider on a system with 43 migrations and RLS policies written against Supabase's
  `auth.uid()`. The entire tenant boundary would need re-deriving, and the failure mode of
  getting it wrong is a cross-tenant leak.
- **Rescaffold Next + Tailwind + shadcn/ui and port** — rejected. Same stack we already have,
  so the only thing gained is a cleaner component floor; the cost is re-porting 77 API routes,
  123 components and 374 test files. `src/components/ui/` already holds 17 Radix-wrapped
  primitives in the shadcn shape.
- **Blank-repo assumption: record a chosen stack as ADRs instead of extracting conventions** —
  rejected. That is the documented "loses the method's main speed lever" path, and it would
  be a lie here: the conventions exist and are enforced by a pre-commit hook.
- **Incremental strangler migration off Supabase** — rejected as premature. No constraint in
  the PRD is blocked by Supabase. Migrating a working tenant boundary to fix nothing is how
  0-user products stay 0-user.

## Consequences

**Easier.** Every story in `docs/stories.md` is a delta against working software rather than a
build from scratch. The delta backlog is 19 stories precisely because most of the PRD core
loop is already shipped.

**Harder.** We inherit the drift too. The previous architecture document asserted Zustand,
React Query, TipTap and Cloudflare Workers — none of which exist in the code — and the root
`CLAUDE.md` repeats it. Inheriting the code means owning the job of keeping its documentation
honest, which is why `docs/architecture.md` carries a "Drift corrected" table and why this
pass rewrites the root `AGENTS.md` from measurement rather than from the old doc.

**Watch.** The 0-user window closes with the first paying customer. Any stack decision worth
revisiting must be revisited before then or not at all.
