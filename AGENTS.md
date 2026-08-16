# RecopyFast — Repo rules

RecopyFast is a **production system with 0 users**. Every rule below exists because the code
is deployed, the embed script is on customer domains, and the Stripe catalogue is live.

Scope: [`docs/prd.md`](./docs/prd.md) · Backlog: [`docs/stories.md`](./docs/stories.md) ·
Architecture: [`docs/architecture.md`](./docs/architecture.md) ·
Decisions: [`docs/decisions/`](./docs/decisions/)

## Absolute rule

No direct coding. Every feature goes through the killer-saas pipeline, in order:

PRD → User Stories → Architecture (+ Design System) → then, per story: Research → Design → Plan → Execute → Review → Ship

No code is written before the story has a validated plan (`/ks-plan`). No feature ships before
a passed review (`/ks-review`).

## Pipeline (commands)

- `/ks-prd` frames the kill: target SaaS, kill mode, perimeter (WHAT + WHY)
- `/ks-stories` breaks it into shippable user stories
- `/ks-stories-review` reviews the breakdown against the PRD perimeter (`stories-reviewer` subagent)
- `/ks-architect` sets the technical HOW + the conventions
- `/ks-design-system` captures the global design system (`docs/design-system.md`)
- `/ks-research` explores the story's real context (current code, APIs, traps)
- `/ks-design` derives a story's screen from the design system (UI stories)
- `/ks-plan` breaks a story into sequenced tasks
- `/ks-execute` implements the story in TDD (`implementer` subagent)
- `/ks-review` anti-hallucination review + gate (`reviewer` subagent)
- `/ks-ship` opens the PR; merge/deploy per the ship strategy (manual by default)

Utilities: `/ks-orchestrator` (full cycle with human checkpoints), `/ks-status` (derives
pipeline state from the files), `/ks-help`.

One feature = one Research → Design → Plan → Execute → Review → Ship cycle = one branch = one
PR (Design only when the story has UI).

## Story ids and branches

- Every story has an id `s<number>-<short-slug>`, assigned in `docs/stories.md` and reused
  verbatim: `docs/research/<id>.md`, `docs/plans/<id>.md`, `docs/reviews/<id>.md`, branch
  `feature/<id>`.
- All story work happens on `feature/<id>`, branched from `main`. Never commit story work to `main`.
- The story diff is `git diff main...feature/<id>`. That is what the review judges.
- A fuzzy story name resolves against `docs/stories.md`; no unambiguous match → list the
  stories and stop.

## Gate (mechanical)

- `docs/reviews/<id>.md` must end with the exact lines `Max severity: <critical|major|minor|none>`
  and `Ship allowed: <yes|no>`. A single critical = no.
- `/ks-ship` refuses to run unless that file exists and contains `Ship allowed: yes`. No
  exceptions.
- After a blocked review, `/ks-execute` runs in fix mode: findings are fixed before anything else.
- A plan executes only if its frontmatter says `validated: yes`, set by a human checkpoint —
  never by the file merely existing. `/ks-execute` is fail-closed on it.

## Ship strategy

Merge mode: **manual**. `/ks-ship` opens the PR and stops. Merging is a human decision
(GitHub review, protected branch, CI). After the merge, rerun `/ks-ship` to confirm the
deployment and clean up the branch.

---

# Technical conventions

Extracted from the code on 2026-08-16, not proposed for it. Full detail and file references
are in [`docs/architecture.md`](./docs/architecture.md). **Where these and a general best
practice disagree, these win** — see [ADR 001](./docs/decisions/001-inherited-production-baseline.md).

## Stack, actual

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind 4 · Radix UI wrapped in
`src/components/ui/` · Supabase (Postgres + Auth + Storage, RLS) · Stripe · OpenAI · Resend ·
Redis · Socket.io in `server/` (**not deployed**) · Sentry · Jest 30 + Playwright · esbuild
for the embed.

**Not in the stack, whatever older docs say:** Zustand, React Query, TipTap. Removed from
`package.json` — see [ADR 005](./docs/decisions/005-client-state-context-and-fetch-hooks.md).
No Cloudflare Workers. No Drizzle, no Prisma — Supabase's client is the data layer. No server
actions — the backend is 77 `route.ts` files.

## Commands

```
npm run dev            Next (turbopack) + the WS server, concurrently
npm run build          prebuild runs build:embed first
npm run lint           eslint src/
npm run type-check     tsc --noEmit (incl. tests)
npm run type-check:build   production code only (tsconfig.build.json)
npm run format         prettier --write "src/**/*.{ts,tsx,js,jsx,json,css,md}"
npm test               jest
npm run test:e2e       playwright
npm run build:embed    rebuild public/embed/recopyfast.js from .src.js
npm run check:stripe   verify the Stripe catalogue (add :live for live mode)
npm run check:redis
```

## Non-negotiables

1. **`public/embed/recopyfast.src.js` is the source. `recopyfast.js` is generated.** Editing the
   artifact is silently overwritten by the next build. Edit the source, then
   `npm run build:embed`. `--check` fails on a stale artifact.
2. **`/embed/recopyfast.js` is a permanent public URL**, baked into every snippet ever issued.
   It can never move or break for existing installs.
3. **Embed budget ≤ 30,000 bytes gzipped.** Currently breached at 46,781 — `s06` makes it a
   build gate. Per-story allocation lives in `docs/stories.md` and nowhere else.
4. **The widget degrades, never breaks.** No uncaught exception may reach the host page's
   `window`; on failure the page keeps its authored copy. There is no error surface on their
   domain, so a broken branch presents as "editing stopped working on one site".
5. **Never edit an applied migration.** Forward-only, timestamp-prefixed.
6. **Every tenant-scoped table gets an RLS policy in the same migration that creates it.** A
   missing policy is a cross-tenant leak, not a bug. Twelve migrations exist only to repair
   this after the fact.
7. **No hardcoded Stripe prices or fallback catalogue.** `plans` is the source of truth, price
   ids come from env. A previous fallback silently served drifted prices at checkout.
8. **No secrets in code.** Env vars only; validate presence at startup and fail loudly.

## API routes

- One `route.ts` per path under `src/app/api/`. Named `GET`/`POST`/`PUT`/`DELETE`/`OPTIONS`
  exports. Dynamic params are `Promise` and must be awaited (Next 16).
- **Rate limit before authorization.** Auth itself costs a `sites` lookup, so a limiter behind
  it never sees the flood. Choose `onStoreFailure` explicitly and justify it in a comment:
  public reads fail open, service-role writes fail closed.
- Errors are `NextResponse.json({ error }, { status })`. Log the detail with `console.error`;
  never return an exception message to an unauthenticated caller.
- `OPTIONS` returns `new NextResponse(null, { status: 204 })`. `NextResponse.json({}, {status:204})`
  **throws** — it has broken preflight on this codebase twice.
- CORS: `src/lib/http/public-cors.ts` (`*`, token-authenticated, never cookies) vs per-route
  `withCors(res, allowedOrigin)` (one echoed origin, with credentials). Absence of the header
  is how "no grant" is expressed. `*` is never a fallback and never pairs with credentials.

## Validation

No zod — see [ADR 003](./docs/decisions/003-no-schema-validation-library.md). Use
`src/lib/api/validation.ts` (`ValidationResult<T>`, `readJsonObject`) and extend it. Reject
`__proto__`/`constructor`/`prototype` keys, cap size and depth, and **redact control characters
before echoing a rejected value** into a response or a log line. Cap how many rejections a
response enumerates.

Text scraped off a customer's DOM goes through `src/lib/security/discovered-text.ts`. It is not
markup and is not sanitized as markup.

## Data access

| Client | Use | RLS |
|---|---|---|
| `supabase/client.ts` | browser, inside effects/handlers only | on |
| `supabase/server.ts` | route acting as the signed-in user | on |
| `supabase/service.ts` | widget paths where the caller is a site token | **off** |

Service-role is an exception that must be earned per route: an explicit
`authorizeSiteRequest` / `authorizeFirstPartySiteRequest` / `authorizeIngestRequest` call
before any data access, plus a fail-closed per-site rate limiter. Do not write a fourth auth
path. See [ADR 002](./docs/decisions/002-rls-tenant-boundary.md).

Site ownership is an `admin` row in `site_permissions`, **never** a column on `sites`. Counting
via `sites.user_id` returns 0 and passes every quota check — that bug already shipped.

Multi-step writes go through a Postgres function, not two round trips.

## React

- Default to a server component; add `"use client"` only for state, effects, handlers or
  browser APIs, on line 1.
- **Server state = a custom hook**: `useState` + `useEffect` + `fetch`, returning
  `{ data, loading, error, refetch }`. `src/hooks/useSites.ts` is the reference, error handling
  included — a non-ok response produces an error state, never an empty list.
- Cross-cutting state is Context. There is one (`AuthContext`). Adding a second needs a reason.
- Compose from `src/components/ui/`. Do not invent a primitive beside it.
- `framer-motion`, `three`/R3F and `lenis` are marketing-surface only. They may not reach the
  dashboard and may not reach the widget.

## Naming

`PascalCase.tsx` components (file matches the export) · `useCamelCase.ts` hooks ·
`kebab-case.ts` lib modules · `__tests__/` colocated, `*.test.ts(x)` ·
`YYYYMMDDHHMMSS_snake_case.sql` migrations · `UPPER_SNAKE_CASE` constants ·
booleans prefixed `is`/`has`/`should`/`can`.

## Comments

The house style is **long comments explaining why, anchored to the incident that caused them**,
on anything non-obvious — especially security decisions and anything that has broken before.
See `src/app/api/content/[siteId]/route.ts` and `src/middleware.ts` for the standard.

Match it. It is the only thing stopping a future agent from "simplifying" a fix back into the
bug. A comment saying *what* the line does is noise. A comment saying *what broke last time* is
the asset. When you fix something subtle, leave the tombstone.

## Tests

Jest + Testing Library, colocated in `__tests__/`. Playwright in `e2e/`.

- Coverage thresholds in `jest.config.js` are a **ratchet, not a target**: they are the floor
  measured today (22% lines). Raise them as tests are added; never lower them. 80% remains the
  goal and cannot be declared before it is earned.
- `jest.setup.js:177-182` mocks `IntersectionObserver` globally with a no-op `observe`. Any
  test that depends on intersection behaviour must supply its own controllable mock or it
  passes vacuously.
- Do not modify a test to accommodate a change in behaviour. Change the behaviour, or change
  the test *and say so in the PR*.

## Definition of Done (per feature)

- Single PR, structured description, readable diff
- `lint`, `type-check`, `format:check`, `build`, `test` all green (the pre-commit hook runs the
  first four and the full suite; CI additionally runs `audit:prod` and `type-check:build`)
- Passing tests on business logic; no regression on existing code
- Review passed, no open critical issue
- Deployed to production

## Data & docs lifecycle

All pipeline data is markdown under `docs/`, versioned by git. No database, no state file:
pipeline state is derived from the files.

- **Framing docs** — `docs/prd.md`, `stories.md`, `reviews/stories.md`, `architecture.md`,
  `design-system.md`: committed on `main` at the end of their phase.
- **Story docs** — `docs/research/<id>.md`, `designs/<id>*`, `plans/<id>.md`, `reviews/<id>.md`:
  committed on `feature/<id>`. The implementer's single story commit brings research, design and
  plan; `/ks-ship` commits the review.
- **Task progress** — the checkboxes in `docs/plans/<id>.md`, ticked as tasks land, travelling
  in the story's commit. Never a commit trigger.
- **Commits** — one commit per story, not per task. A second only for something you would want
  to revert on its own (typically a migration). Branch commits squash at merge.
- **Decisions** — `docs/decisions/NNN-<slug>.md`, one per structural decision, with the
  considered options and why they were rejected. Immutable: a change means a new ADR superseding
  the old one. Framing decisions commit on `main`; story decisions travel with `feature/<id>`.
- Docs conventions (lowercase-kebab, one canonical doc per topic, dated reports to `archive/`,
  exactly three markdown files at the repo root plus this one) are in
  [`docs/README.md`](./docs/README.md).

## Commit messages

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
Run `git status` and `git diff` before committing.
