# ADR 056 — AI blog posts are drafts; only a platform admin publishes, through the service role

- Status: accepted
- Date: 2026-10-09
- Scope: story `s89-blog-drafts-only` (CTO decision under the owner's 2026-10-09 directive)
- Amends: ADR 002 §3/§4, ADR 037 and AGENTS.md "Data access" — adds two principals that may reach
  the service role, for `blog_posts` only. Nothing else changes.

## Context

The PRD's SEO plan says the blog cron *"drafts, a human publishes"* (`docs/prd.md:320-322`). The
code did the opposite: the daily cron inserted `status: "published"`
(`src/app/api/blog/generate/route.ts:273-283`). It did so through the RLS client, which cannot work
for either caller that writes `blog_posts`:

- **the cron** has no session, so it runs as `anon`, which may only read published rows
  (`20260818000000_repair_aborted_migrations.sql:1160-1173`);
- **the owner** is made admin by the `ADMIN_EMAILS` env allow-list, which RLS cannot see — the write
  policy checks only the JWT's `app_metadata.role` (`:1174-1180`).

ADR 002 reserves the service role for widget principals, and ADR 037 adds the signed-in *site* admin.
Neither covers a platform-wide admin or a scheduled job writing a non-tenant table.

## Decision

1. **Every AI-generated `blog_posts` row is written as `status = 'draft'`, `published_at = NULL`.**
   The row is built field by field in `src/lib/blog/drafts.ts`; nothing from the request body or the
   model's output can set `status`, `published_at` or `generated_on`. Only the publish route sets
   `published`.
2. **The daily cron** may use the service role after the `CRON_SECRET` bearer check, to read and
   insert its own day's draft and nothing else. One cron row per UTC day is a database fact:
   `blog_posts.generated_on` with a unique index (NULLs distinct, so on-demand drafts and older rows
   are unconstrained). The day is checked before OpenAI is called, and a unique violation on insert
   returns the row that won.
3. **A platform admin** — an authenticated user whose email is in `ADMIN_EMAILS` (case-insensitive)
   or whose server-managed `app_metadata.role` is `"admin"`; `user_metadata` never counts — may use
   the service role on `blog_posts`, in this order, in `src/lib/auth/platform-admin.ts`:
   1. for a POST, an `Origin` header equal to the app's own origin (absent or different → 403);
   2. a fail-closed per-IP flood guard (`IP_GENERAL`);
   3. `supabase.auth.getUser()` on the RLS client (none → 401);
   4. a fail-closed per-user limiter;
   5. the platform-admin check (fail → 403);
   6. only then the service-role client, scoped by the validated post id.
4. **No web principal publishes by any other route.** The RLS policies are unchanged; the existing
   `app_metadata` write policy stays (it is narrower than the route and harmless), and no new
   policy is added.

## Options considered

- **Keep RLS writes for admins, service role only for the cron.** Rejected: an owner who is only in
  `ADMIN_EMAILS` passes the route and is refused by the database — exactly today's latent bug.
- **Mirror `ADMIN_EMAILS` into a database table so RLS can see it.** Rejected: a new table, a sync
  step and a second source of truth for one operator.
- **A `published_by` column with a CHECK that a cron row can only be published with a reviewer.**
  Rejected for now: the service role can write any value into it, so it guards against a naive
  regression only, and it fails on existing rows unless added `NOT VALID`. The application guard is
  pinned by tests at the lib, the cron route and the generate route.
- **A pre-check without a database key, or a Redis lock, for idempotency.** Rejected: a pre-check
  is racy across duplicate deliveries during the ~30 s model call (Vercel delivers crons
  at-least-once), and a Redis lock adds a failure mode and cannot return the day's draft.

## Consequences

- AGENTS.md "Data access" lists the principals that may reach the service role; it should name these
  two (follow-up for the rules owner — implementers do not edit AGENTS.md).
- The audit routes keep their own copies of the platform-admin check (graveyard, untouched).
- Deploy order: the migration first (nullable column + index), then the code.
