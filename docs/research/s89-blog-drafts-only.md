# Research — Story s89-blog-drafts-only

Verified against `origin/main` at `c0c40bf` on 2026-10-09. No production access was used: no
production SQL, no connector, no credentials. The only SQL ran on a throwaway local PostgreSQL 14
built by `scripts/run-db-invariants.mjs` (bootstrap + every migration), deleted after.

## The structuring facts

1. **The cron publishes.** `vercel.json:3-5` schedules `GET /api/cron/generate-blog-post` at
   `0 14 * * *`. The route checks the `CRON_SECRET` bearer
   (`src/app/api/cron/generate-blog-post/route.ts:6-10`), self-fetches
   `GET ${NEXT_PUBLIC_APP_URL}/api/blog/generate` for a random topic (`:13-24`), then
   `POST`s it back with the same bearer (`:27-41`). The generate route calls OpenAI (`gpt-4o-mini`,
   `src/app/api/blog/generate/route.ts:210-235`) and inserts the result with
   `status: "published"` and `published_at: new Date().toISOString()` (`:273-283`). Nothing between
   the model and the public page involves a person.

2. **…but in production the insert has almost certainly never succeeded.** The insert uses
   `createClient()` from `@/lib/supabase/server` (`generate/route.ts:270`), the cookie-bound RLS
   client. The cron request carries no session, so it runs as `anon`. `blog_posts` gives `anon`
   only `SELECT … USING (status = 'published')` and gives writes to `authenticated` with
   `app_metadata.role = 'admin'` and to `service_role`
   (`supabase/migrations/20260818000000_repair_aborted_migrations.sql:1160-1189`). The migration
   says so itself: *"the cron path … runs as `anon` and will be rejected here"* (`:1169-1173`,
   carried from `20260731004000:225-229`). Before `20260818000000` the table did not exist in
   production at all (its header, `:11-20`, lists `blog_posts` among the tables a 2026-08-17 production probe found
   absent). Consequences:
   - the daily run pays OpenAI and then throws the post away (`generate/route.ts:210-242` runs
     before the insert at `:273`);
   - *this is inference, not observation* — a manual `schema.sql` run or an admin-session call could
     have written rows. The orchestrator's read-only count (`status`, `created_at`, titles of
     published rows) settles it before ship.

3. **`ADMIN_EMAILS` cannot write through RLS.** The interactive path authorises an allow-listed
   email or `app_metadata.role === "admin"` (`generate/route.ts:35-50`), but the write policy checks
   only the JWT's `app_metadata.role` (`20260818000000…sql:1174-1180`). Postgres cannot read a Vercel
   env var, so an owner who is only in `ADMIN_EMAILS` passes the route and is refused by the database.
   The owner directive says `ADMIN_EMAILS` is how the owner is made admin, so any admin write has to
   go through the service role after the route's own check (ADR 057).

4. **There is no blog admin tooling.** `grep -rln blog_posts src` → `sitemap.ts`,
   `blog/[slug]/page.tsx`, `api/blog/generate/route.ts` and one test. No page, no publish route, no
   list of drafts. The only admin-gated blog surface is on-demand generation (`POST
   /api/blog/generate`).

5. **Read paths already filter, two layers deep.** `/blog/<slug>` queries
   `.eq("slug", slug).eq("status", "published")` (`src/app/blog/[slug]/page.tsx:25-30`); the sitemap
   does `.eq("status", "published")` (`src/app/sitemap.ts:53-57`, s88's file). For anonymous readers
   RLS also hides drafts. For a signed-in `app_metadata` admin it does not — the write policy is
   `FOR ALL`, which includes `SELECT` — so the page's own status filter is the only thing keeping a
   draft off `/blog/<slug>` for that session. It has no test today; this story pins it.
   `/blog` itself is a hardcoded array (`src/app/blog/page.tsx:8-42`), not a database read —
   out of scope, recorded as a follow-up.

6. **Vercel delivers crons at-least-once.** Vercel's cron docs ("Cron job delivery and
   idempotency", fetched 2026-10-09): *"Cron delivery can also occasionally invoke the same scheduled
   run more than once … Design your operations to be idempotent … Use unique IDs to track which
   events you've already processed. Check state before making changes."* `docs/architecture.md:380`
   already states the rule for this repo. A pre-check alone is racy (two deliveries both see "no
   draft yet" during the ~30 s OpenAI call), so the day needs a database key.

   **Independent-review correction (2026-10-10).** A unique key on the eventual `blog_posts` row is
   too late to protect the provider call. The deterministic overlapping-delivery proof at
   `.omx/ultragoal/evidence/s89/independent-review/concurrent-cron-proof.ts` produced two generation
   calls, one row, and one `created: true` / one `created: false` response. The day therefore needs a
   separate durable claim acquired before generation, and draft insertion plus claim completion
   must be one transaction (ADR 060).

7. **The platform-admin check exists four times, copied.** `generate/route.ts:35-50`,
   `api/audit/logs/route.ts:41-48`, `api/audit/compliance/route.ts:63-71` and `:158-166`. All trust
   `ADMIN_EMAILS` (case-insensitive) and `app_metadata.role`, never `user_metadata`. The audit routes
   are graveyard (`docs/prd.md:141-142`) and are not touched; the blog routes share one helper.

8. **Cookie-authenticated POSTs need an Origin check here.** Supabase SSR cookies default to
   `sameSite: "lax"` (`node_modules/@supabase/ssr/dist/main/utils/constants.js:4-6`), which keeps
   them off cross-*site* subrequests but not cross-*origin same-site* ones — and every branded
   `*.recopyfa.st` host is same-site with the app (ADR 021). The repo's precedent is
   `src/app/api/editor/sign-out/route.ts:35-43`: compare `normalizeOrigin(Origin)` with
   `normalizeOrigin(request.nextUrl.origin)`. That route lets an absent Origin through (a logout
   is a nuisance); a publish is not, so the blog routes refuse it — every current browser sends
   `Origin` on a `fetch` POST.

## Verified mechanics the plan relies on

- **PostgreSQL treats NULLs as distinct in a unique index** (default `NULLS DISTINCT`, PG 14 has
  no other mode). `CREATE UNIQUE INDEX … ON blog_posts (generated_on)` therefore allows one row per
  day for the cron and any number of rows with `generated_on` NULL (on-demand drafts, old rows).
  Verified on the local PG 14 by the DB test this story adds.
- **A unique violation reaches supabase-js as `error.code === "23505"`** (PostgREST passes the
  SQLSTATE through). The insert path handles it by re-reading the day's row; it does not use
  `upsert(…, { onConflict })`, which would also work on a full unique index but would hide which
  run created the row.
- **`slug` is `UNIQUE`** (`20260818000000…sql:1135`). The topic list is fixed (48 topics) and the
  model often titles a post with its topic verbatim, so a repeat title is expected within weeks;
  the same 23505 then means "slug taken", and the draft gets the day appended to its slug.
- **`createServiceRoleClient()`** (`src/lib/supabase/service.ts:12-24`) throws when its env is
  missing — the cron then answers 500, it does not fall back.
- **Rate-limit presets** (`src/lib/security/rate-limiter.ts:418-444`): `IP_GENERAL` 200/min,
  `API_UPLOAD` 10/min, `USER_GENERAL` 100/min. `enforceRateLimit` (`src/lib/api/rate-limit.ts`)
  defaults to fail-closed.
- **Validation helpers** (`src/lib/api/validation.ts`): `readBoundedJson`, `requireUuid`
  (canonicalises case), `requireEnum`, `optionalPlainText`.

## Traps

1. **Writing through the RLS client** — refused for the cron (`anon`) and for an
   `ADMIN_EMAILS`-only owner. Unit mocks that are permissive would stay green; the route tests use
   a user-scoped fake that refuses `blog_posts` writes, like `src/__tests__/api/api-keys/writes.test.ts`.
2. **OpenAI is billed before the insert.** The day's key must be checked *before* the model call,
   or every duplicate delivery pays for a post it then discards.
3. **Spreading the request body or parsed model output into the row** would let `status` /
   `published_at` through. The row is built field by field, `status` and `published_at` are
   literals.
4. **`src/app/sitemap.ts` belongs to s88** in this wave. It already filters; do not edit it.
5. **Deploy order.** The new code selects and writes `generated_on`. Apply the migration first —
   it only adds a nullable column and an index, so the current code is unaffected by it.
6. **`user_metadata.role`** is caller-writable (`PATCH /api/auth/profile`, `auth.updateUser`); a
   test must prove it grants nothing.
7. **Do not turn the claim into an expiring lease.** OpenAI does not accept a provider idempotency
   key for this call. A takeover after a local timeout can overlap a slow request that still charges
   and later completes. Pending and failed claims therefore require explicit operator recovery.
