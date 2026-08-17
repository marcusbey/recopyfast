# Architecture — RecopyFast

> **Canonical.** This file describes the system as it is, verified against the code on
> 2026-08-16. It supersedes `archive/2026-08-16-architecture-plan.md`, which was an
> aspirational plan and is wrong on several points (see [Drift corrected](#drift-corrected)).
>
> Scope authority is [`prd.md`](./prd.md). Backlog is [`stories.md`](./stories.md).
> Structural decisions are in [`decisions/`](./decisions/).

**The baseline is not a boilerplate — it is a running production system.** 43 applied
migrations, a live Stripe catalogue, and an embed script whose public URL is already baked
into every issued snippet. Nothing here is chosen; it is inherited and load-bearing. Conform
to it. See [ADR 001](./decisions/001-inherited-production-baseline.md).

---

## Stack

| Layer | What | Version | Notes |
|---|---|---|---|
| Framework | Next.js App Router | `^16.1.1` | Turbopack in dev, webpack config still present for Node polyfill fallbacks |
| UI runtime | React | `19.1.0` | Pinned exact |
| Language | TypeScript | `^5` | `strict: true`, `noEmit`, `@/*` → `./src/*` |
| Styling | Tailwind CSS | `^4` | via `@tailwindcss/postcss`; no `tailwind.config` file |
| Primitives | Radix UI | — | 7 packages, wrapped in `src/components/ui/` |
| Variants | `class-variance-authority` + `clsx` + `tailwind-merge` | — | `cn()` in `src/lib/utils.ts` |
| Animation | `framer-motion` | `^12` | 18 files, landing/marketing surface only |
| 3D | `three` + `@react-three/fiber` + `drei` | — | 4 files, `src/components/three/` only — landing hero |
| Database | Supabase Postgres | `@supabase/supabase-js ^2.55` | RLS is the tenant boundary |
| Auth | Supabase Auth (GoTrue) | `@supabase/ssr ^0.6` | Cookie sessions, refreshed in middleware |
| Payments | Stripe | `^18.4` | DB-driven catalogue, price ids from env |
| AI | OpenAI | `^5.12` | `src/lib/ai/`, credit-metered |
| Email | Resend | `^6.14` | `src/lib/email/resend.ts` |
| Cache / limits | Redis | `^5.8` | rate limiting, sessions, intended pub/sub |
| Realtime | Socket.io | `^4.8` | **separate service in `server/`, not deployed** — see [ADR 004](./decisions/004-embed-transport-split.md) |
| Errors | Sentry | `@sentry/nextjs ^10.32` | Only wired when `NEXT_PUBLIC_SENTRY_DSN` is set |
| Tests | Jest 30 + Testing Library, Playwright `^1.58` | — | 374 test files, 1954 passing |
| Embed build | esbuild `^0.25` | — | `scripts/build-embed.mjs`, runs on `prebuild` |

### Declared but unused — do not start using them

`zustand`, `@tanstack/react-query` and `@tiptap/react` are in `package.json` and imported by
**zero** files in `src/`, `server/` or `scripts/`. The superseded architecture plan and the
root `CLAUDE.md` both name them as the stack; they never were. Client state is React Context
plus custom fetch hooks. See [ADR 005](./decisions/005-client-state-context-and-fetch-hooks.md).

### Two deploy targets

- **Vercel** — the Next.js app. One cron in `vercel.json` (`/api/cron/generate-blog-post`, daily 14:00).
- **Nowhere (yet)** — `server/index.js`, an Express + Socket.io process. `server/Dockerfile`
  and `server/fly.toml` exist but were never used; `fly.toml:22` still carries the
  placeholder app name. Vercel cannot host a long-lived process. Standing this up is `s07`.

---

## Repo structure

```
src/
  app/                    Next.js App Router
    api/                  77 route.ts handlers — the entire backend
    dashboard/            owner surface (8 pages)
      _ab-tests/          underscore = privately parked, not deleted
    edit/                 the invited-editor surface (no account required)
    blog/ demo/ login/ signup/ settings/ privacy/ terms/
    sitemap.ts robots.ts manifest.ts opengraph-image.tsx   SEO surface
  components/
    ui/                   17 Radix-wrapped primitives — the design system floor
    dashboard/ billing/ editor/ auth/ collaboration/ settings/
    landing/ sections/ three/                              marketing surface
    layout/ shared/ blog/
  lib/                    85 modules, one folder per domain (see below)
  hooks/                  7 cross-page React hooks
  contexts/               AuthContext.tsx — the only context
  types/                  billing.ts, editor.ts, index.ts
  middleware.ts           auth gate + entitlement gate + security headers + CSP
public/embed/
  recopyfast.src.js       SOURCE OF TRUTH, hand-edited, 5397 lines
  recopyfast.js           BUILD ARTIFACT — never hand-edit
  socket.io-client.min.js standalone fallback copy
server/                   Express + Socket.io service (own package.json, not deployed)
supabase/migrations/      43 SQL migrations, timestamp-prefixed
scripts/                  build-embed, sync-stripe-catalogue, qa-journey, check-redis, install-hooks
e2e/                      7 Playwright specs
docs/                     this documentation tree
```

### `src/lib/` — one folder per domain

`auth/` (12) is the largest and is **not** account auth — it is the non-account editor grant
system (the product's angle): request-code, submit-code, handoff create/redeem, device
binding, staging access. Account auth is Supabase's.

`stripe/` (8) catalogue, checkout, subscription, customer, payment-methods, mode ·
`security/` (7) site-auth, ingest-auth, discovered-text, content-sanitizer, domain
verification, rate-limiter · `billing/` (5) entitlements, effective-plan, checkout
reservation, credit revocations, user lock · `supabase/` (3) client / server / service ·
`api/` (3) rate-limit, rate-limiter, validation · plus one-to-two-file folders for
`ai/ analytics/ audit/ ab-testing/ collaboration/ config/ credits/ deployment/ email/
feature-gating/ hooks/ http/ images/ middleware/ monitoring/ sites/ storage/ utils/ webhooks/`.

`editingRules.core.ts` sits at the top of `lib/` deliberately: it is compiled by
`build-embed.mjs` and spliced into the widget, so the app and the widget cannot disagree
about what "readable" means.

---

## Patterns & conventions

These are extracted from the code, not proposed. What the code always does the same way is
law here, whether or not it is written anywhere else.

### API routes

- **Every route is `src/app/api/<path>/route.ts`.** There are no server actions and no
  `"use server"` files in the codebase. Do not introduce a second backend idiom.
- Named exports `GET` / `POST` / `PUT` / `DELETE` / `OPTIONS`. Dynamic params arrive as
  `{ params }: { params: Promise<{ … }> }` and must be awaited (Next 16).
- **Rate limit before authorization**, not after. Auth itself costs a `sites` lookup, so a
  limiter behind it never sees the flood it exists to stop. See the header comment on
  `shedUnauthenticatedLoad` in `src/app/api/content/[siteId]/route.ts`.
- Fail-open vs fail-closed is an explicit per-limiter choice (`onStoreFailure: "allow" | "deny"`),
  and the choice is justified in a comment. Public read paths fail open; service-role write
  paths fail closed.
- Errors: `NextResponse.json({ error: string }, { status })`. Never leak an exception message
  to a caller that has not authenticated. `console.error` the detail, return the shape.
- Two CORS helpers, and they are not interchangeable:
  - `src/lib/http/public-cors.ts` — `*`, for endpoints authenticated by a bearer site token
    and **never** by cookies. Must not be combined with `Allow-Credentials`.
  - Per-route `withCors(response, allowedOrigin)` — echoes one resolved origin with
    credentials, for endpoints that do use the session. Absence of the header is how "no
    grant" is expressed; `*` is never a fallback.
- `OPTIONS` returns `new NextResponse(null, { status: 204 })`. `NextResponse.json({}, { status: 204 })`
  throws — it has already broken preflight on this codebase twice.

### Validation

No schema library. `src/lib/api/validation.ts` provides `ValidationResult<T> = {ok:true,value} | {ok:false,error}`,
deliberately shaped like zod's `safeParse` so a later swap is mechanical. Use these validators
and add to them; do not add zod for one route. See [ADR 003](./decisions/003-no-schema-validation-library.md).

Untrusted input from a customer's DOM has its own module, `src/lib/security/discovered-text.ts`
— it is not markup and is not sanitized as markup. Redact control characters *before* echoing
any rejected value into a response or a log line.

### Data access

Three Supabase clients, and picking the wrong one is a security bug:

| Client | Use | RLS |
|---|---|---|
| `supabase/client.ts` `createClient()` | Browser, inside effects/handlers only | enforced |
| `supabase/server.ts` `createClient()` | Route handlers acting **as the signed-in user** | enforced |
| `supabase/service.ts` `createServiceRoleClient()` | Widget-facing paths where the caller is a site token, not a user | **bypassed** |

28 of 77 routes use the service-role client. Every one of them owes an explicit authorization
call before it touches data. See [ADR 002](./decisions/002-rls-tenant-boundary.md).

Site ownership is an `admin` row in `site_permissions`, **not** a column on `sites`. Counting
via `sites.user_id` silently returns 0 and passes every quota check — that bug already
shipped once; `countOwnedSites` in `feature-gating/permissions.ts` records it.

### Client components

- 121 of ~150 component files are `"use client"`. 8 of 19 pages are server components.
  Default to a server component; add the directive only when state, effects or handlers
  require it.
- **Data fetching is `useState` + `useEffect` + `fetch` inside a custom hook** returning
  `{ data, loading, error, refetch }`. `src/hooks/useSites.ts` is the reference shape,
  including its error handling: a non-ok response must produce an error state, never an
  empty list — "no sites found" reads as *your account is empty*, not *we failed*.
- Cross-cutting state is React Context. There is exactly one: `AuthContext`.

### The embed widget

The single most constrained surface in the product. It runs on domains we do not control.

- **`recopyfast.src.js` is the source. `recopyfast.js` is generated.** Editing the artifact is
  overwritten silently on the next build. The artifact carries a
  `// @generated-from-sha256 …` marker and `node scripts/build-embed.mjs --check` fails when
  it is stale.
- `/embed/recopyfast.js` is a **permanent public URL** — it is already baked into every
  snippet ever issued. It can never move or break for existing installs.
- Budget: **≤ 30,000 bytes gzipped.** Today it is **46,875** (widget 34,063 + socket.io
  13,141), measured 2026-08-16 by the build gate itself. **These three do not sum** — gzipping a
  concatenation is not the sum of gzipping its parts, because the compressor shares a dictionary
  across the whole stream. An earlier revision of this line printed a gzip figure for the bundle
  beside a Node-zlib figure for the widget and invited exactly that arithmetic; the numbers were
  from different compressors and never added up. The budget is currently breached; `s06a` makes
  it a build gate. The per-story allocation is in
  [`stories.md`](./stories.md#byte-budget) and is the only place it is allocated — do not
  restate a ceiling in a story.
- **Compressor, stated once — and this bit has already caused three wrong numbers.** The gate in
  `scripts/build-embed.mjs` measures in process with Node's `zlib.gzipSync({ level: 9 })`:
  **46,875** artifact, **34,063** widget alone, **13,141** socket.io. `MAX_BUNDLE_GZ` and
  `MAX_WIDGET_GZ` are seeded from those, and they are the only figures that mean anything about
  the gate, because the gate is what enforces them. In-process, so it cannot drift with whichever
  `gzip` a machine ships.

  GNU `gzip -9c` gives different, consistently lower numbers for the same bytes — **46,767**
  artifact, **33,891** widget alone. And `gzip -9c FILE` is 14 bytes larger than `gzip -9c < FILE`
  (46,781 vs 46,767) because the first form writes the filename into the gzip header. That
  filename confound is where the phantom third figure came from.

  So: **never compare a figure from one compressor against the other, and never quote a
  widget-alone number as though it held under both — it does not.** Re-measure, and say which
  tool produced it.
- Degrade, never break. The host page keeps its authored copy on any failure. No uncaught
  exception may reach the host `window`, and there is no error surface there by design — which
  means a broken branch presents as "editing stopped working on one site", not as an alert.
- Everything under `/embed/` skips session work in middleware (`isSessionlessPath`) but still
  gets security headers. It is executable JavaScript loaded cross-origin; `nosniff` is not
  optional on it.

### Naming

`PascalCase.tsx` for components (file matches the exported symbol) · `useCamelCase.ts` for
hooks · `kebab-case.ts` for lib modules · `route.ts` / `page.tsx` are Next's, not ours ·
`__tests__/` colocated beside the code, `*.test.ts(x)` · migrations
`YYYYMMDDHHMMSS_snake_case.sql`.

### Comments

The house style is **long comments that explain why, anchored to the incident that caused
them**, on anything non-obvious — especially security decisions and anything that has broken
before. See `src/app/api/content/[siteId]/route.ts` and `src/middleware.ts` for the standard.
This is unusual and it is deliberate: it is the only thing stopping a future agent from
"simplifying" a fix back into the bug. Match it. A comment that says *what* the line does is
noise; a comment that says *what broke last time* is the asset.

---

## Data model

57 tables across 43 migrations. Grouped by what they serve:

**Tenancy and content (the core loop)**
`sites` · `site_permissions` (ownership + roles; the real ownership record) · `content_elements`
(unique on `site_id, element_id, language, variant`; holds `original_content`, `current_content`,
`published_content` side by side) · `content_history` · `content_versions` · `site_languages` ·
`domain_verifications`

**Non-account editing (the angle)**
`edit_sessions` · `content_editing_sessions` · `site_editors` · `editor_verification_codes` ·
`editor_device_grants` · `editor_handoffs` · `staging_access` · `staging_history`

**Billing**
`plans` (catalogue, source of truth) · `plan_entitlements` · `billing_customers` ·
`billing_subscriptions` · `billing_invoices` · `billing_payment_methods` · `billing_events`
(Stripe idempotency) · `checkout_reservations` · `tickets` / `billing_tickets` /
`ticket_transactions` / `billing_ticket_usage` · `credit_purchases` · `credit_usage` · `usage_tracking`

**Measurement**
`site_analytics` · `performance_metrics` · `api_usage` · `user_activity_logs` · `audit_logs` ·
`security_events` · `rate_limits`

**A/B**
`ab_tests` · `ab_test_variants` · `ab_test_results` · `visitor_buckets` · `conversion_events`

**Integrations**
`webhooks` · `webhook_deliveries` · `api_keys` · `blog_posts` · `bulk_operations`

**Graveyard — frozen, not deleted** (PRD)
`teams` · `team_members` · `team_invitations` · `team_activity` · `team_activity_log` ·
`collaboration_sessions` · `collaboration_notifications` · `compliance_reports` ·
`site_themes` · `copy_styles`

### Rules

- **Every tenant-scoped table needs an RLS policy.** A missing one is a cross-tenant leak, not
  a bug. Twelve migrations exist purely to close RLS gaps found after the fact — treat that as
  evidence, not history.
- Migrations are forward-only and timestamp-ordered. Never edit an applied migration.
- The `plans` table is the catalogue; Stripe price ids come from env via `PRICE_ID_ENV_VARS`.
  **There is deliberately no hardcoded fallback catalogue** — one previously served drifted
  prices at checkout. A new plan means a migration *and* env vars in every environment, plus
  `npm run check:stripe`.
- Multi-step writes go through a Postgres function, not two round trips (see
  `20260617000000_publish_staging_transaction.sql`, `20260803020000_restore_atomic_publish.sql`).
  `SECURITY DEFINER` functions are locked down explicitly — two migrations do only that.

---

## Integration points

| Concern | Where | Notes |
|---|---|---|
| **Account auth** | Supabase Auth, cookie session, refreshed in `middleware.ts` | Protected: `/dashboard`, `/settings`. `/dashboard/billing` is deliberately never gated — it is Stripe's return URL on both success and cancel |
| **Entitlement gate** | `middleware.ts` → `billing/effective-plan.ts` | Page routes only; API routes resolve entitlement themselves. Fails **open** — a Supabase blip must not lock a paying customer out |
| **Non-account editing** | `src/lib/auth/editor-*.ts`, `/api/editor/*`, `/api/edit-sessions/*` | Scoped, expiring grants. The highest-consequence surface in the product: a leaked grant is a defacement of a customer's live site |
| **Payments** | `src/lib/stripe/*`, `/api/billing/*`, `/api/webhooks/stripe` | Checkout is serialized (`checkout-reservation.ts` + `user-lock.ts`); credit spend is compare-and-swap. Webhook replay must not double-grant — `billing_events` is the idempotency ledger |
| **AI** | `src/lib/ai/`, `/api/ai/suggest`, `/api/ai/translate` | OpenAI, credit-metered. Credits cover **AI only** — a wallet balance is never a quota |
| **Email** | `src/lib/email/resend.ts` | Resend |
| **Images** | `src/lib/images/`, `src/lib/storage/`, `/api/upload/image` | Supabase Storage, `20260801000000_storage_assets_bucket.sql`. Replace an existing `<img>` only |
| **Realtime** | `server/index.js` (Socket.io) — **not deployed** | `NEXT_PUBLIC_WS_URL` unset in production ⇒ `getPublicWebSocketUrl()` returns `""` ⇒ snippet omits `data-ws-url` ⇒ widget returns early at `recopyfast.src.js:2703`. Content persists over HTTP. See [ADR 004](./decisions/004-embed-transport-split.md) |
| **Rate limit / cache** | Redis via `src/lib/api/rate-limit.ts` | `npm run check:redis` |
| **Errors** | Sentry, 3 config files + `instrumentation.ts` | `next.config.ts` only wraps when the DSN is set, so CI builds without it |
| **Cron** | `vercel.json` → `/api/cron/generate-blog-post`; `/api/cron/ab-test-lifecycle` exists but is unscheduled | Cron platforms retry — every job must be idempotent |
| **Outbound webhooks** | `src/lib/webhooks/`, `/api/webhooks` | Distinct from Stripe's inbound `/api/webhooks/stripe`. SSRF check needs `ipaddr.js` at config **and** delivery time |

### CSP is a first-class constraint, in both directions

Ours (`middleware.ts:196-256`) derives `connect-src` from env rather than widening to
`https:`/`wss:`. Adding an outbound origin means adding it there or the browser blocks it
silently.

**Theirs matters more.** The widget runs under the customer's CSP. `script-src 'self'` on
their domain forbids fetching anything from our origin — which is why socket.io is compiled
*into* the artifact instead of lazy-loaded, and why lazy-loading it from our origin is the
obvious-and-wrong fix (`build-embed.mjs` header records this). `connect-src 'self'` forbids
our WebSocket and our API; the widget must degrade to read-only, loudly in the console and
silently on their page.

---

## Design / UX

Two audiences, two surfaces, and the PRD forbids confusing them.

- **Owner / agency → `/dashboard`.** Full surface: sites, content, billing, analytics,
  settings. Built from `src/components/ui/` (17 Radix-wrapped primitives) + `src/components/dashboard/`.
- **Invited editor → `/edit` and the widget on their own page.** No account, no dashboard, no
  settings, no modes. The PRD's constraint is that this must be re-learnable from zero every
  time, by someone using it four times a year. That disqualifies sidebars, settings and modes
  from this surface — it is a hard constraint, not a preference.
- **Marketing → `/`, `/blog`, and the SEO clusters `s17`–`s19` will add.** `framer-motion`,
  `three`/R3F and `lenis` live here and **only** here; none of them may reach the dashboard
  or the widget.

Component conventions and tokens are captured separately by `/ks-design-system` in
`docs/design-system.md`. Until it exists, `src/components/ui/` is the floor: compose from it,
do not invent a primitive beside it.

---

## Drift corrected

The superseded plan (`archive/2026-08-16-architecture-plan.md`) and the root `CLAUDE.md`
assert the following. None of it is true, and each was checked:

| Claim | Reality |
|---|---|
| Zustand for client state, `src/store/` | No `src/store/`. `zustand` imported by 0 files |
| React Query for server state | `@tanstack/react-query` imported by 0 files |
| TipTap for rich text | `@tiptap/react` imported by 0 files |
| Cloudflare Workers serve the embed at the edge | No Workers. Vercel static + Next middleware |
| Socket.io with Redis pub/sub, running | Service exists in `server/`, deployed nowhere |
| Script size < 30KB gz | 46,781 gz today |
| Test coverage ≥ 80% | Jest floor is 22% lines, ratcheted from measured reality |

Fixing the first three in `CLAUDE.md` and keeping this table honest is cheaper than the
alternative: an agent reads the stale claim, writes a Zustand store, and now the assertion is
half-true.
