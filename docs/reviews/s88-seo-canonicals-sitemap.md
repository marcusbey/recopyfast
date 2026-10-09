# Review — s88-seo-canonicals-sitemap

Reviewer: fresh-context `reviewer` subagent, 2026-10-09. Diff: `git diff origin/main...HEAD` at 1ec5a21 (36 files,
+2195 / −127; base c0c40bf). Rebased since onto fc5968b as 8de71bf docs, df988e4 story.

## Verdict summary

All seven plan tasks present; extras (`SITE_OPEN_GRAPH` export, `Home` → `HomePage` rename, crawler-caveat test, a
`console.error` spy the new logging needs) are in the plan's execution notes. The two changed tests
(`comparison-discovery`, `landing-founding-offer`) are declared in research and plan.

Gates: jest 390 suites / 5,036; type-check (both) 0; lint 0 errors; format:check clean; build:embed 45828;
Playwright `--list` 80. `next build` (CI env, Supabase unreachable): exit 0 — `/` ISR 300 s, `/sitemap.xml` 3600 s,
`/llms.txt` static; both failed reads logged; homepage JSON-LD without `offers`; sitemap lists the 12 static URLs, so
the page still builds when the catalogue can't be read. The `/dashboard/:path*` header rule matches `/dashboard`,
`/dashboard/`, `/dashboard/sites/x`, not `/dashboards` or `/`.

Anti-hallucination: `createClient` from `@supabase/supabase-js`, `getPlanCatalogue`, `isAgencyCheckoutEnabled`,
`SubscriptionPlan.name/price`, `resolveSiteUrl`, `comparisonList`, Next 16.3.8 `accumulateMetadata` / `getPathMatch`
all exist; the sellable-plan filter equals `/api/pricing`'s; every `/llms.txt` sentence matches `Benefits.tsx` or the
comparison pages' caveat; `HomePage.tsx` is a verbatim move; middleware only gains the exact `/llms.txt` sessionless
path — `config.matcher` unchanged, no auth bypass widened.

Security: `src/lib/supabase/anon.ts` reads only the public URL and anon key, no cookies, no session persistence /
refresh / URL detection. `blog_posts` RLS: `"Published blog posts are public" FOR SELECT USING (status =
'published')` with no `TO` clause applies to `anon` (`20260818000000_repair_aborted_migrations.sql`); no migration
revokes it; the sitemap still filters on `status`. JSON-LD escapes `<` as `\u003c` (round-trip test with
`</script>`); no rating/review/A-B claim, no fallback price. Catalogue read behind 300 s ISR = at most one `plans`
query per regeneration.

Canonicals in the prerendered HTML: `/`, `/privacy`, `/terms`, `/blog`, `/demo`, `/docs/install`, `/try`,
`/compare`, `/compare/duda` each carry exactly one self-canonical; `/login` and `/signup` `noindex, follow`, no
canonical; `/edit` and `/auth/error` `noindex, nofollow`; `/blog/[slug]` canonical from the slug (tested); no noindex
page in the sitemap; robots.txt disallows `/api/`, `/dashboard`, `/auth/`.

Mutations: 30 of 30 red (root canonical/og:url, sitemap status filter / revalidate / login / error log / date order /
install page / lastModified, anon key / persistSession, robots ×2, header source ×2, catalogue offers ×3, JSON-LD
escape / offers, middleware path, login / auth-error / demo / privacy / slug canonicals, homepage og:url /
revalidate, llms.txt ×2).

## Findings (first review)

1. minor — the new anon client (`src/lib/supabase/anon.ts`) wasn't written into the rules (client tables in AGENTS.md
   and architecture list three; reasoning only in the plan).
2. minor — the `/blog` index was a hard-coded list of three 2024 posts, now canonical and in the sitemap.
3. minor — JSON-LD price uses `plans.price`, cards overlay Stripe amounts (`check:stripe` guards drift) — accepted,
   same choice as the comparison pages.
4. minor — dashboard HTML inherited `<meta name="robots" content="index, follow">` while the header says
   `noindex, nofollow`.
5. minor — `src/app/sitemap.ts:12` comment goes stale once s89 makes the cron draft-only.
6. minor — `docs/stories.md` conflicted with main.

## Fix pass (88a82c4)

ADR 058 (cookie-less anon client for public reads) + rows in AGENTS.md and architecture; `/blog` reads published
posts through it (`src/lib/blog/published-posts.ts`, newest first, hourly, three states: list / "No posts yet" /
logged error banner — never the empty message on failure); dashboard gets a server `layout.tsx` with
`noindex, nofollow` and its old client body moved unchanged to `DashboardFrame.tsx`; ADR 053 errata; sitemap comment
and plan decision 4 corrected; rebased (stories.md append only). 11 mutations red.

## Verification of the fix pass — fresh-context `reviewer` (sonnet)

All addressed; no defect above minor. `DashboardFrame.tsx` is byte-identical to main's layout apart from the
signature and a doc comment; no other importer of the old layout default; `/blog/${slug}` links match `[slug]`'s
`.eq("slug", slug).eq("status","published")`; select list `id, title, slug, excerpt, category, published_at` (no
content, author or PII); missing env → named error → error state. Gates: jest 391 suites / 5,058; type-check (both),
lint 0 errors, format:check, build:embed, Playwright `--list` 80, offline `next build` exit 0 (`/blog` and sitemap
static 1 h). Mutations red: status filter (3), ascending order (1), error → empty (1), dashboard robots index (2),
revalidate 60 (1), cookie client (3).

Minors: (1) the hourly cache also holds a failed read for up to an hour — not in ADR 058's consequences; (2)
`listPublishedPosts` had no bound.

## Final fix — orchestrator

(1) ADR 058 consequences now say a failed read is cached as the error state until the next successful revalidation.
(2) `PUBLISHED_POSTS_LIMIT = 100` with `.limit()` on the read; test "lists at most the newest
PUBLISHED_POSTS_LIMIT posts" (101 published rows → 100 links, newest first, oldest dropped) red before the limit
("Expected length: 100, Received length: 101"). Blog + canonicals suites 43/43.

## Not verified

Real anon read through PostgREST: `curl "$SUPABASE_URL/rest/v1/blog_posts?select=slug&status=eq.published" -H
"apikey: <anon key>"` returns published slugs only. After deploy: canonical host on `/` and `/privacy` is
`https://www.recopyfa.st`; `curl -sI https://www.recopyfa.st/dashboard` carries `X-Robots-Tag` and the HTML
`noindex`; JSON-LD with real offers through the Rich Results Test; `x-vercel-cache` / `age` on `/` and
`/sitemap.xml`; submit the sitemap in Search Console. E2E landing spec on CI.

Max severity: minor
Ship allowed: yes
