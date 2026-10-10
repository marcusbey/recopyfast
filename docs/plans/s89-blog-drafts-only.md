---
validated: yes
---
# Plan — Story s89-blog-drafts-only

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s89-blog-drafts-only` (from `origin/main` `c0c40bf`).
Research: `docs/research/s89-blog-drafts-only.md` — read it first; this plan does not repeat it.
Decision record: [ADR 057](../decisions/057-ai-blog-posts-are-drafts-platform-admin-publishes.md).
Review-fix decision: [ADR 060](../decisions/060-daily-blog-generation-is-a-durable-claim.md),
which supersedes ADR 057 §2's insufficient concurrency mechanism only.
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
   body is validated (`topic` ≤ 200, `category` ≤ 50, `targetKeywords` ≤ 500 plain text; `topic` and
   `category` come together or not at all, either alone is a 400 — today a lone `topic` reaches a NOT
   NULL violation, and a lone `category` was silently replaced). Its unauthenticated `GET`
   (topic suggestion) is left as is.
4. **CTO decision: idempotency is a database key.** Migration
   `supabase/migrations/20261009150000_blog_posts_daily_draft_key.sql` adds
   `blog_posts.generated_on date` and a unique index on it (ADR 057 §2). Cron rows carry the UTC day;
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
10. **Review-fix decision: claim before spending.** The critical review proof showed that the
    pre-read plus unique post key still lets two overlapping deliveries call OpenAI. A separate
    service-role-only daily claim is acquired before generation. No pending or failed claim is
    stolen automatically; recovery is an explicit operator action (ADR 060).

## Tasks

- [x] 1. **Daily key in the database.** Write `src/__tests__/db/blog-daily-draft.test.ts` (in a
     rolled-back transaction): a second row with the same `generated_on` fails with 23505; two rows
     with NULL `generated_on` both insert; `anon` sees only the published row. Run it on the local
     PG 14 runner — red (column missing). Add the migration (header explaining why; `IF NOT EXISTS`
     so a retry converges; no new table, so no new RLS). Green. Name the suite in
     `scripts/run-db-invariants.mjs` (the CI "PostgreSQL 14" step runs that list).
- [x] 2. **Drafts library.** Tests first in `src/lib/blog/__tests__/drafts.test.ts`, against an
     in-memory `blog_posts` fake that enforces both unique keys and returns 23505:
     a draft row is `draft` / `published_at` null even when the model output carries
     `status: published` front matter; title, slug and excerpt as today; `createDailyDraft` creates
     one draft keyed by the UTC day and returns `created: true`; a second call the same day returns
     the same draft, `created: false`, without calling the generator; a run that loses the insert
     race returns the winner; the next UTC day creates a new one; a slug collision appends the day;
     a generator failure writes nothing. Red, then move topics/keywords to `src/lib/blog/topics.ts`
     and generation to `src/lib/blog/generate-post.ts`, write `src/lib/blog/drafts.ts`. Green.
- [x] 3. **Cron route.** Tests first in `src/__tests__/api/cron/generate-blog-post.test.ts`
     (service client faked, OpenAI via a mocked global `fetch`): 401 without/with a wrong bearer and
     when `CRON_SECRET` is unset, with no OpenAI call; with the bearer, 200
     `{ success, created: true, draft: { status: "draft", … } }` and exactly one draft row, even when
     the model returns publish-shaped front matter and the URL carries `?status=published`; a second
     run → `created: false`, OpenAI called once in total; an OpenAI failure → 500, generic error, no
     row; no self-fetch of `NEXT_PUBLIC_APP_URL`. Red, rewrite the route over `createDailyDraft`.
     Green.
- [x] 4. **Platform-admin guard and same-origin check.** Tests first:
     `src/lib/auth/__tests__/platform-admin.test.ts` (allow-list case/whitespace-insensitive, empty
     allow-list matches nobody, `app_metadata.role` admin passes, `user_metadata.role` admin does
     not; guard order: IP limiter refusal returns before `getUser`, no user → 401, user limiter
     refusal → 429/503 before the admin check, non-admin → 403) and
     `src/lib/http/__tests__/same-origin.test.ts` (same origin passes; other origin, `null` and absent
     fail). Red, implement `src/lib/auth/platform-admin.ts` and `src/lib/http/same-origin.ts`. Green.
- [x] 5. **On-demand generate route.** Tests first in `src/__tests__/api/blog/generate.test.ts`
     (user-scoped fake refuses `blog_posts` writes, like production RLS): the cron bearer alone → 401;
     a non-admin → 403; `user_metadata.role: "admin"` → 403; an `ADMIN_EMAILS` admin → 200 draft
     written through the service role, and a body with `status: "published"`, `published_at`,
     `generated_on` still yields `draft` / null / null; cross-origin or Origin-less POST → 403 and no
     OpenAI call; topic without category → 400. Red, rewrite POST over the guard and
     `createOnDemandDraft`. Green.
- [x] 6. **Admin list and publish routes.** Tests first in
     `src/__tests__/api/admin/blog-posts.test.ts`: `GET /api/admin/blog/posts` — 401/403 for
     anon/non-admin, drafts by default, `?status=published` for published, anything else 400,
     `Cache-Control: no-store`; `POST /api/admin/blog/posts/[id]` — publish turns a draft
     `published` with `published_at` set; unpublish returns it to `draft` with `published_at` null;
     publishing a published post or unpublishing a draft → 409; unknown id → 404; malformed id or
     action → 400; cross-origin / Origin-less / non-admin / `user_metadata` admin → 403 and the row is
     unchanged. Red, implement `src/app/api/admin/blog/posts/route.ts` and
     `src/app/api/admin/blog/posts/[id]/route.ts`. Green.
- [x] 7. **Published read path pinned.** Add to `src/app/blog/[slug]/__tests__/page.test.tsx` a case
     whose fake client applies `eq` filters over a draft and a published row (the view an
     `app_metadata` admin's RLS session has): the draft's slug → `notFound()`, the published slug
     renders. It passes on the current code — prove it bites by removing the page's
     `.eq("status", "published")` (red), then restore. `src/app/sitemap.ts` untouched (s88).
- [x] 8. **Runbook and doc touch-ups.** `docs/operations/blog.md` (how drafts are created, reviewed,
     published and unpublished; `ADMIN_EMAILS` in Vercel; migration-first; troubleshooting);
     `docs/README.md` operations row; `docs/operations/deployment-checklist.md`'s `CRON_SECRET` note
     (it no longer guards `/api/blog/generate`) and an `ADMIN_EMAILS` line; `.env.example`'s
     `ADMIN_EMAILS` comment (blog publishing).
- [x] 9. **Gates and mutations.** Full jest, type-check, type-check:build, lint, format:check,
     `build:embed --check`, Playwright `--list`, the current PostgreSQL17 DB runner. For each guard: neutralise,
     see its test go red, restore with `git checkout --`. One story commit.
- [x] 10. **Critical c1 — durable daily claim, test first.** Add a deterministic overlapping-call
     regression to the drafts library and cron API suites; prove it red on the reviewed source with
     two provider calls. Add ADR 060 and a new forward migration creating
     `blog_generation_claims` plus service-role-only acquire, fail and atomic finalize RPCs. Preserve
     the existing daily row, slug-collision and on-demand behavior.
- [x] 11. **Follower and failure behavior.** Only the acquired token calls the bounded provider.
     Followers poll for a bounded interval and return the finalized post with `created: false`;
     pending timeout and failed claims return a generic error without generation. A definite provider or
     database finalization failure marks the owned pending claim failed without a draft. An
     ambiguous response after a committed finalization preserves succeeded state and the existing
     draft; a retry reads it without another provider call. Extend the schema-strict
     fake so both the new table and exact migration-defined RPC names are enforced.
- [x] 12. **Real database proof.** Expand the named PostgreSQL suite with concurrent database
     sessions proving one owner during an in-flight claim, finalization transaction rollback, legacy
     daily-row reuse, service-role-only table/function grants, RLS, and no replay drift. Keep the
     suite in `scripts/run-db-invariants.mjs`.
- [x] 13. **Contract and operations repair.** Make the story AC explicitly require a concurrent
     duplicate to return the same draft without a second OpenAI call; record the review finding in
     research; add the cron/platform-admin service-role principals to AGENTS.md; and document manual
     pending/failed claim recovery in the blog runbook. Rerun focused checks, then hand the fix to an
     independent `/ks-review`; do not write the ship gate here.
- [x] 14. **Post-CI admin-list pagination.** Add a bounded opaque cursor over `created_at DESC,
     id DESC`, fetch one look-ahead row while returning at most 50 posts, and reject malformed
     cursors before creating the service-role client. Prove a 51st row is reachable and equal
     timestamps neither skip nor duplicate a post. Document repeated runbook navigation.
- [x] 15. **Post-CI on-demand slug collisions.** Preserve the paid model output when the plain and
     dated slugs are both occupied: retry a bounded number of UUID-suffixed slugs for on-demand
     drafts only. Prove a further collision and concurrent same-title calls produce distinct rows
     without another generation attempt or returning an unrelated draft. Leave the daily durable
     claim path unchanged.
- [x] 16. **Withdraw the stale review gate and triage the database claim.** Retain the 2026-10-10
     review text as historical evidence but remove its terminal ship authorization because tasks
     14-15 changed reviewed source. The PUBLIC-column-grant bot claim needs no migration change:
     `src/__tests__/db/blog-generation-claim.test.ts` injects that exact grant, replays the actual
     migration, and proves web roles cannot read `owner_token`; the retained PostgreSQL 17 run passed.
     Record focused red/green evidence and require a fresh independent review.

## Claim-fix verification checkpoint (2026-10-10)

The critical concurrency repair has47passing focused tests. The real PostgreSQL17 runner
executed15named suites/102tests with one expected PostgREST-only skip. The new realDB suite
drives the actual TypeScript generation function through two service-role sessions and realRPCs:
one generatorcall and one shared draft. It also proves completion rollback, owner-token checks,
no takeover of failed/old claims, private grants/RLS, replay preserving a completedclaim while
removing an injected PUBLIC column grant, and legacy-post reuse. Source migrations are unchanged
by those tests; the runner owns and removes its temporary cluster.

A subsequent stalled-read regression failed because the follower counted only sleeps. A separate
wall-clock deadline now covers reads too and stops late reads from restarting polling; the focused
suite passed afterward. RealDB verification repeated after the deadline fix: all15suites/102tests passed, plus the
expected PostgREST-only skip. An additional lost-completion-response regression also passed: the
already committed draft/claim stay succeeded and a retry does not call the generator again.
The operational runbook now names both migrations and the explicit manual-recovery boundary.
Full gates and independent review are still open; the existing blocked review is not a verdict
on this uncommitted repair.

## Post-CI fix checkpoint (2026-10-10)

The admin list now returns at most 50 rows plus an opaque continuation cursor derived from its
deterministic `created_at DESC, id DESC` order. Focused tests traverse a 51st row, preserve all rows
across an equal-timestamp boundary, and reject invalid encodings/timestamps/UUIDs before the
service-role client is created. On-demand generation now retries a bounded set of UUID-suffixed
slugs after the plain and dated candidates collide; the paid markdown is generated once per request
and the returned row is the row inserted by that request. The daily claim path is unchanged.

The previously passed review was withdrawn after these source changes. Fresh review found and
the implementer repaired strict calendar validation and test-fixture typing defects. Invalid
February dates and hour 24 now fail before service-role client creation; valid leap days and
PostgreSQL microseconds/offsets remain accepted. The independent repair rerun passed 79 focused
tests and both findings are resolved.

The orchestrator's fresh full gates passed: lint (0 errors, 34 inherited warnings), both type
checks, formatting, 421 Jest suites / 5,683 tests (38 existing database-gated skips), production
build, and coverage (72.84% lines, 65.50% branches). Disposable PostgreSQL 17.11 replay passed all
15 named suites / 102 tests, with one existing PostgREST-only skip. The strengthened grant test
proves the injected PUBLIC owner-token permission is effective before replay and absent afterward
for both web roles; no migration change is needed for that automated warning.

Evidence: primary checkout `.omx/ultragoal/evidence/s89/post-ci-fixes/` and
`post-ci-review/`. Final independent review, normal-hook commit/push, and exact-head hosted CI
remain the delivery gates; production and live provider acceptance stay separate.
