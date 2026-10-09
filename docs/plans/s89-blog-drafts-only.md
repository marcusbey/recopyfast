---
validated: yes
---
# Plan — Story s89-blog-drafts-only

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s89-blog-drafts-only` (from `origin/main` `c0c40bf`).
Research: `docs/research/s89-blog-drafts-only.md` — read it first; this plan does not repeat it.
Decision record: [ADR 056](../decisions/056-ai-blog-posts-are-drafts-platform-admin-publishes.md).
No Design step: no new screen (recorded in `docs/designs/README.md`). No embed change (0 bytes), no
`server/` change, no new dependency, no e2e test (Playwright contract count unchanged).

## Decisions

1. **CTO decision: the human publish path is an admin-gated API plus a runbook, not a UI.** One
   operator (the owner), no customer surface. A page would need a design doc, the s66 design guards'
   scanned roots, ADR 053's page frame, and — under `/dashboard` — the middleware's entitlement gate
   (`src/middleware.ts:197-202`) would bounce an owner without a plan to checkout. The runbook
   (`docs/operations/blog.md`) makes it usable from the signed-in browser: open the list URL, run one
   `fetch` in the console. A page can come later on the same routes without changing them.
2. **CTO decision: the cron generates in-process.** It calls `createDailyDraft` from
   `src/lib/blog/drafts.ts` instead of self-fetching its own public URL twice
   (`NEXT_PUBLIC_APP_URL`). Generation code (topics, keyword map, prompt, OpenAI call) moves from the
   generate route to `src/lib/blog/`. The cron's duplicate keyword map is dropped; the generate
   route's map is the one kept (the cron's had one or two extra keywords per category — prompt
   wording only).
3. **CTO decision: `POST /api/blog/generate` stays, admin-only.** The cron bearer path is removed
   from it (nothing calls it any more; a leaked `CRON_SECRET` should not open an OpenAI-spending
   POST). It runs the shared platform-admin guard, so it gains the Origin check and limiters, and its
   body is validated (`topic` ≤ 200, `category` ≤ 50, `targetKeywords` ≤ 500 plain text; a `topic`
   without a `category` is a 400 — today it reaches a NOT NULL violation). Its unauthenticated `GET`
   (topic suggestion) is left as is.
4. **CTO decision: idempotency is a database key.** Migration
   `supabase/migrations/20261009150000_blog_posts_daily_draft_key.sql` adds
   `blog_posts.generated_on date` and a unique index on it (ADR 056 §2). Cron rows carry the UTC day;
   on-demand drafts carry NULL.
5. **CTO decision: a slug collision appends the UTC day** (`<slug>-YYYY-MM-DD`) and retries once
   (research, "slug is UNIQUE"). Without it the cron fails on the first repeated title.
6. **CTO decision: unpublish returns a post to `draft`** with `published_at` NULL (not `archived`),
   so it can be fixed and republished. Publish sets `published_at` to now.
7. **CTO decision: platform admin = `ADMIN_EMAILS` or `app_metadata.role === "admin"`**, one helper
   (`src/lib/auth/platform-admin.ts`) used by the blog routes only; the graveyard audit routes keep
   their copies. 401 unauthenticated, 403 signed in but not admin.
8. **CTO decision: POSTs require a same-origin `Origin`** (absent → 403), stricter than
   `editor/sign-out`, which lets an absent Origin through (research fact 8).
9. **Orchestrator task (not code): production review of existing posts.** Before ship, a read-only
   count of `blog_posts` by `status` and the titles/`created_at` of published rows. Research fact 2
   says the count is most likely 0; any published AI post is reviewed by the owner and unpublished
   through the new route if it fails. Then: apply the migration (migration-first), set
   `ADMIN_EMAILS` to the owner's address in Vercel, deploy.

## Tasks

- [ ] 1. **Daily key in the database.** Write `src/__tests__/db/blog-daily-draft.test.ts` (in a
     rolled-back transaction): a second row with the same `generated_on` fails with 23505; two rows
     with NULL `generated_on` both insert; `anon` sees only the published row. Run it on the local
     PG 14 runner — red (column missing). Add the migration (header explaining why; `IF NOT EXISTS`
     so a retry converges; no new table, so no new RLS). Green. Name the suite in
     `scripts/run-db-invariants.mjs` (the CI "PostgreSQL 14" step runs that list).
- [ ] 2. **Drafts library.** Tests first in `src/lib/blog/__tests__/drafts.test.ts`, against an
     in-memory `blog_posts` fake that enforces both unique keys and returns 23505:
     a draft row is `draft` / `published_at` null even when the model output carries
     `status: published` front matter; title, slug and excerpt as today; `createDailyDraft` creates
     one draft keyed by the UTC day and returns `created: true`; a second call the same day returns
     the same draft, `created: false`, without calling the generator; a run that loses the insert
     race returns the winner; the next UTC day creates a new one; a slug collision appends the day;
     a generator failure writes nothing. Red, then move topics/keywords to `src/lib/blog/topics.ts`
     and generation to `src/lib/blog/generate-post.ts`, write `src/lib/blog/drafts.ts`. Green.
- [ ] 3. **Cron route.** Tests first in `src/__tests__/api/cron/generate-blog-post.test.ts`
     (service client faked, OpenAI via a mocked global `fetch`): 401 without/with a wrong bearer and
     when `CRON_SECRET` is unset, with no OpenAI call; with the bearer, 200
     `{ success, created: true, draft: { status: "draft", … } }` and exactly one draft row, even when
     the model returns publish-shaped front matter and the URL carries `?status=published`; a second
     run → `created: false`, OpenAI called once in total; an OpenAI failure → 500, generic error, no
     row; no self-fetch of `NEXT_PUBLIC_APP_URL`. Red, rewrite the route over `createDailyDraft`.
     Green.
- [ ] 4. **Platform-admin guard and same-origin check.** Tests first:
     `src/lib/auth/__tests__/platform-admin.test.ts` (allow-list case/whitespace-insensitive, empty
     allow-list matches nobody, `app_metadata.role` admin passes, `user_metadata.role` admin does
     not; guard order: IP limiter refusal returns before `getUser`, no user → 401, user limiter
     refusal → 429/503 before the admin check, non-admin → 403) and
     `src/lib/http/__tests__/same-origin.test.ts` (same origin passes; other origin, `null` and absent
     fail). Red, implement `src/lib/auth/platform-admin.ts` and `src/lib/http/same-origin.ts`. Green.
- [ ] 5. **On-demand generate route.** Tests first in `src/__tests__/api/blog/generate.test.ts`
     (user-scoped fake refuses `blog_posts` writes, like production RLS): the cron bearer alone → 401;
     a non-admin → 403; `user_metadata.role: "admin"` → 403; an `ADMIN_EMAILS` admin → 200 draft
     written through the service role, and a body with `status: "published"`, `published_at`,
     `generated_on` still yields `draft` / null / null; cross-origin or Origin-less POST → 403 and no
     OpenAI call; topic without category → 400. Red, rewrite POST over the guard and
     `createOnDemandDraft`. Green.
- [ ] 6. **Admin list and publish routes.** Tests first in
     `src/__tests__/api/admin/blog-posts.test.ts`: `GET /api/admin/blog/posts` — 401/403 for
     anon/non-admin, drafts by default, `?status=published` for published, anything else 400,
     `Cache-Control: no-store`; `POST /api/admin/blog/posts/[id]` — publish turns a draft
     `published` with `published_at` set; unpublish returns it to `draft` with `published_at` null;
     publishing a published post or unpublishing a draft → 409; unknown id → 404; malformed id or
     action → 400; cross-origin / Origin-less / non-admin / `user_metadata` admin → 403 and the row is
     unchanged. Red, implement `src/app/api/admin/blog/posts/route.ts` and
     `src/app/api/admin/blog/posts/[id]/route.ts`. Green.
- [ ] 7. **Published read path pinned.** Add to `src/app/blog/[slug]/__tests__/page.test.tsx` a case
     whose fake client applies `eq` filters over a draft and a published row (the view an
     `app_metadata` admin's RLS session has): the draft's slug → `notFound()`, the published slug
     renders. It passes on the current code — prove it bites by removing the page's
     `.eq("status", "published")` (red), then restore. `src/app/sitemap.ts` untouched (s88).
- [ ] 8. **Runbook and doc touch-ups.** `docs/operations/blog.md` (how drafts are created, reviewed,
     published and unpublished; `ADMIN_EMAILS` in Vercel; migration-first; troubleshooting);
     `docs/README.md` operations row; `docs/operations/deployment-checklist.md`'s `CRON_SECRET` note
     (it no longer guards `/api/blog/generate`) and an `ADMIN_EMAILS` line; `.env.example`'s
     `ADMIN_EMAILS` comment (blog publishing).
- [ ] 9. **Gates and mutations.** Full jest, type-check, type-check:build, lint, format:check,
     `build:embed --check`, Playwright `--list`, the PG 14 DB runner. For each guard: neutralise,
     see its test go red, restore with `git checkout --`. One story commit.
