# ADR 058 — Server code with no user reads public rows through a cookie-less anon client

- Status: accepted
- Date: 2026-10-09
- Scope: s88-seo-canonicals-sitemap (review minor 1)
- Amends: [ADR 002](./002-rls-tenant-boundary.md) and AGENTS.md "Data access" — adds a fourth
  Supabase client, `src/lib/supabase/anon.ts`. ADR 002's body is not edited; the "Data access"
  tables in AGENTS.md and `docs/architecture.md` carry its row and a pointer here. It is a
  client, not an auth path: it authorizes nothing, and AGENTS.md's "do not write a fourth auth
  path" is unchanged.

## Context

Until s88 there were three Supabase clients, and picking the wrong one is a security bug:

| Client | Acts as | RLS |
|---|---|---|
| `supabase/client.ts` | the browser's signed-in user | on |
| `supabase/server.ts` | whoever's cookies arrived with the request | on |
| `supabase/service.ts` | the service role | **off** |

Some server code has no user at all and reads only rows every stranger may read: the sitemap
(and, from s88's review, the `/blog` index) lists published blog posts, which the
`"Published blog posts are public"` policy (`FOR SELECT USING (status = 'published')`, migration
`20260818000000_repair_aborted_migrations`) already opens to `anon`. None of the three fits:

- **The cookie client** reads `cookies()`. The read then runs as whoever happened to request the
  page — a crawler as `anon`, a signed-in platform admin as someone who can see drafts — so the
  public output depended on the requester. And `cookies()` is a dynamic API: the sitemap rendered,
  and queried the database, on every crawler fetch (`ƒ /sitemap.xml` in `next build` before s88).
- **The service role** bypasses RLS. A published-only `.eq("status", "published")` would be the
  only thing standing between drafts and a public file, and ADR 002 reserves the role for
  `authorize*` paths and named exceptions (ADR 046). Public reads with no principal are not one.
- **The browser client** is for effects and handlers in the browser; on the server it is built
  from inert placeholder credentials.

## Decision

**Server code that has no user and reads only rows RLS already makes public uses
`createAnonClient()` from `src/lib/supabase/anon.ts`.** It is the public URL and anon key with no
session: nothing read from cookies, nothing persisted, nothing refreshed, no URL detection. The
database role is always `anon`, RLS is on, and the result is the same for every requester.

Use it when all of these hold:

1. there is no user — a crawler file (`sitemap.ts`), a public page (`/blog`), a public route;
2. every row read is meant for strangers, and an RLS policy already grants `anon` exactly those
   rows;
3. it only reads.

Never use it for anything a user owns, for writes, or to "get around" the cookie client: as `anon`
it sees what every stranger sees, which is the point. Keep the query's own filter (here
`status = 'published'`) even though RLS applies it too, so the code stays correct if it is ever
pointed at a broader role.

## Considered options

- **The cookie client (status quo before s88).** Rejected: identity-dependent output for a public
  file, and per-request rendering and database reads.
- **The service role with a published-only filter.** Rejected: RLS off — one dropped filter
  publishes drafts — and it is not an exception ADR 002 allows.
- **An inline `createClient(url, anonKey, …)` at each call site.** Rejected: the rule above would
  live in no one place, and each copy would choose its own `auth` options.
- **A `SECURITY DEFINER` function returning the published rows.** Rejected: more privilege than
  the read needs, and one more function in the grant invariants, to do what a policy already does.

## Consequences

- The sitemap and `/blog` are static with hourly revalidation (`revalidate = 3600`) instead of
  rendering per request; a newly published post appears within the hour.
- An `anon` read that RLS denies returns **zero rows, not an error**. A table whose policy does not
  grant `anon` will look empty through this client, so a new caller pins its expected rows in a
  test, and a failed read is logged and rendered as a failure, never as "empty".
- Its correctness rests on the table's `anon` grants and policies. Narrowing `blog_posts`' policy,
  or revoking `SELECT` from `anon`, empties the sitemap and `/blog` — such a migration names both.
- The client throws a named error when `NEXT_PUBLIC_SUPABASE_URL` or
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing; callers catch it, log, and degrade.
