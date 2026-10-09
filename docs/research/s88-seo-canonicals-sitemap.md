# Research — Story s88-seo-canonicals-sitemap

Verified on `c0c40bf` (`origin/main` when the branch was cut), 2026-10-09, Next.js 16.3.8. No
production system was touched: the build below ran with the Supabase URL pointed at a closed local
port, and every database fact comes from the migrations in this repo.

## 1. Every page without its own canonical claims to be the homepage

- Root metadata, `src/app/layout.tsx:68-70`: `alternates: { canonical: "/" }`; `:71-78`:
  `openGraph: { …, url: "/" }`.
- How Next merges metadata, `node_modules/next/dist/lib/metadata/resolve-metadata.js`:
  `mergeMetadata` starts from `structuredClone(resolvedMetadata)` (`:167`), the parent's result,
  and replaces `alternates` (`:177-180`) or `openGraph` (`:182-185`) only when the child's own
  export has that key. A child that sets neither inherits the parent's canonical and `og:url`.
  A child that sets `openGraph` replaces the parent's whole `openGraph` object, keeping only the
  title/description fill-in from `inheritFromMetadata` (`:603-612`).
- Reproduced with Next's own `accumulateMetadata` in Jest (node environment, `server-only` mocked):
  `[rootLayout.metadata, null]` resolved for `/privacy` gives
  `alternates.canonical.url = "https://recopyfa.st"` and `openGraph.url = "https://recopyfa.st"`.
  That helper is what the new tests use, so they check the merge Next performs, not a copy of it.
- Pages that set their own canonical today: `/try` (`try/page.tsx:14`), `/compare`
  (`compare/page.tsx:18`), the four `/compare/<slug>` pages (`createComparisonMetadata`,
  `lib/compare/comparisons.ts:454-478`), `/docs/install` (`docs/install/page.tsx:22`).
- Pages that inherit the homepage canonical: `/blog`, `/blog/[slug]`, `/privacy`, `/terms`, `/demo`,
  `/login`, `/signup`, `/edit`, `/auth/error`, every dashboard page, and the not-found page.
  `/edit` (`edit/page.tsx:9`) sends `noindex, nofollow` and a canonical to `/` at the same time.
- Which of those can export metadata: `"use client"` on line 1 of `app/page.tsx`, `demo/page.tsx`,
  `login/page.tsx`, `signup/page.tsx`, `dashboard/layout.tsx` and every dashboard page except
  `dashboard/sites/[siteId]/layout.tsx`. A client module cannot export `metadata`: those routes need
  a server `layout.tsx` beside them, a server wrapper, or (dashboard) a response header.
- A `page.tsx`/`layout.tsx` may only export the names Next knows (`default`, `metadata`,
  `generateMetadata`, `revalidate`, …); `next build` type-checks this. Constants shared with other
  modules must live in `src/lib/`.

## 2. The sitemap

- `src/app/sitemap.ts:49-67` reads `blog_posts` (`slug, published_at, updated_at`,
  `status = 'published'`) through `createClient()` from `@/lib/supabase/server`, which calls
  `cookies()` (`lib/supabase/server.ts:5`).
- **The brief's premise, checked.** "Likely empty for crawlers" is not what `main` does. `next build`
  lists `ƒ /sitemap.xml` (dynamic) and `.next/prerender-manifest.json` has no `/sitemap.xml` entry:
  `cookies()` opted the route out of static generation, so it runs on every request. A crawler
  sends no cookie, so the read runs as `anon`, and RLS lets `anon` read published posts (§3). The
  defects are different ones:
  1. a Supabase round trip and a full render on every crawler fetch, with nothing cached;
  2. the read runs as whoever's cookies arrive, so a public file depends on the caller's session
     (`server.ts:15-24` can write a refreshed session cookie through `setAll` on a route handler);
  3. `catch { return [] }` and `if (error || !data) return []` (`:59-66`) drop every post with no
     log line, so an outage or a revoked grant is invisible;
  4. `lastModified: now` on every static URL (`:75`) — every crawl says every page just changed,
     which teaches crawlers to ignore the file's dates, including the real ones on posts;
  5. `/docs/install` (public since s59, canonical, sessionless in middleware) is missing;
  6. `/login` and `/signup` are listed although they are bare auth forms (this story makes them
     `noindex`; a noindex URL in a sitemap is a Search Console error).
- Build evidence: the run was `next build` with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`,
  `NEXT_PUBLIC_APP_URL=https://recopyfa.st`, Sentry DSN unset. robots.txt prerendered as
  `Disallow: /api/`, `/dashboard/`, `/auth/`. Log kept outside the repo; `.next` deleted.
- **Trap — dropping `cookies()` makes the route static.** Without a segment `revalidate`, a
  cookie-less sitemap is generated once at build and never again until the next deploy, so a post
  published after the deploy never reaches it. It needs `export const revalidate`.
- At build time the database can be unreachable (CI, preview builds): the sitemap and the
  homepage must degrade (static entries, no offers) and recover on the first revalidation.
- `blog/page.tsx:7-42` is a hard-coded list of three posts from 2024 whose slugs are not known to
  exist in `blog_posts`. That is a content fault (already noted in s17's agentic notes), not a
  sitemap one; out of scope, recorded as a follow-up.

## 3. The least-privileged read path for published posts

- `blog_posts` has RLS on; `"Published blog posts are public"` is `FOR SELECT USING (status =
  'published')` with no `TO` clause, so it applies to `anon`
  (`supabase/migrations/20260818000000_repair_aborted_migrations.sql:1158-1166`; identical in
  `20260731004000`). Writes are limited to JWT admins and `service_role` (`:1174-1189`). The
  migration's own header names the intended reader: "`src/app/blog/[slug]/page.tsx:25` (public,
  anon key)". No migration revokes the table from `anon`
  (`20261008110000_converge_replay_privileges.sql` and `20260809120000` touch functions only).
- Options:
  - **Anon key, no cookies, no session** — role `anon`, RLS on, sees exactly the published rows.
    The same role a cookie-less crawler already gets on `main`, and the role `/blog/<slug>` uses.
  - Service role filtered to `status = 'published'` — RLS off; a missing filter would publish
    drafts. AGENTS.md "Data access" allows the service role only behind an `authorize*` call or a
    named ADR exception (ADR 046). Rejected.
  - Cookie client — what `main` does; identity-dependent and forces dynamic rendering. Rejected.
- `@/lib/supabase/client.ts` is `createBrowserClient` with inert prerender placeholders: wrong tool
  on the server. A cookie-less server client is `createClient(url, anonKey, { auth: {
  persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })` from
  `@supabase/supabase-js` (the same import `lib/supabase/service.ts:1` uses).

## 4. robots.txt and noindex

- `robots.ts:14`: `disallow: ["/api/", "/dashboard/", "/auth/"]`. Robots rules are prefix matches:
  `/dashboard/` does not match the bare `/dashboard`. `/dashboard` (no slash) covers both (no other
  route starts with that string).
- A page that is disallowed is never fetched, so its `noindex` is never read; Google can still list
  a disallowed URL it found linked. Pages whose protection is `noindex` (`/login`, `/signup`,
  `/edit`) must therefore stay crawlable. `/auth/*` stays disallowed: `/auth/confirm` consumes a
  one-time token from its query string, and a crawler following a leaked link must not.
- The dashboard is behind the middleware auth redirect (`middleware.ts:163-178`) and every page
  under it is client-rendered, so a `noindex` there is a response header:
  `X-Robots-Tag: noindex, nofollow` from `next.config.ts` `headers()` on `/dashboard/:path*`.
  `getPathMatch` (Next's own matcher, already used by `middleware-matcher.test.ts`) confirms the
  pattern matches `/dashboard` and nested paths.
- Next adds `noindex` to its own not-found response; nothing to do there.

## 5. SoftwareApplication JSON-LD

- PRD § Technical SEO asks for `SoftwareApplication` on product pages. ADR 032 §5 deferred it to
  s17's `buildSoftwareApplicationLd()` with three rules: verified fields only, no invented reviews
  or ratings, offers only when supported by the live catalogue. ADR 012 §3 puts the builders in
  `src/lib/seo/json-ld.ts`.
- What the homepage sells: `/api/pricing` (`route.ts:199-206`) shows every active subscription plan
  except `free`, and Agency only while `isAgencyCheckoutEnabled()`
  (`lib/stripe/plans.ts:102-104`, `AGENCY_CHECKOUT_ENABLED !== "false"`). Prices come from
  `plans.price_monthly` through `getPlanCatalogue()` (`plans.ts:438-527`, service role, 5-minute
  cache), the source of truth by Non-negotiable 7. The comparison pages read the same catalogue
  and revalidate every 300 s (ADR 032 §6); `/api/pricing` caches 300 s too.
- Currency: USD. `scripts/sync-stripe-catalogue.mjs:271,279` creates every Stripe price in `usd`;
  `/api/pricing` defaults `currency` to `usd`; the pricing cards print `$`.
- Google's Software App rich result needs `aggregateRating` or `review`. There are none, and
  inventing them is forbidden (ADR 032 §5). The markup is still valid schema.org and is read by
  knowledge-graph and AI-search consumers; the page will simply not get star snippets.
- JSON-LD in a `<script>` must escape `<` (a `</script>` inside a string would end the element).
  The comparison pages use `JSON.stringify(x).replace(/</g, "\\u003c")`
  (`components/compare/ComparisonPage.tsx:286`).
- The homepage is a client component (`app/page.tsx:1`) that `landing-founding-offer.test.tsx:32`
  imports and renders synchronously as `<Home />`. Making `page.tsx` an async server component
  means that test imports the client body from its new module instead.

## 6. llms.txt

- Format (llmstxt.org): Markdown — an H1 with the name, a `>` summary, then `##` sections of
  `- [title](url): note` links. Served as plain text.
- ADR 012 §4: a new cluster entry is "listed in `llms.txt` with zero additional wiring", so the file
  is generated from `comparisonList`, not hand-written.
- Route precedent for a dotted segment: `src/app/docs/install/agent-instructions.md/route.ts`.
- Middleware: `robots.txt` and `sitemap.xml` skip the session lookup (`middleware.ts:103-115`);
  `/llms.txt` would otherwise cost a GoTrue round trip per fetch. `middleware-matcher.test.ts:103`
  lists the crawler paths.
- Claims allowed: what `homepage-truth.test.tsx` pins (Benefits copy: invite by email with a
  one-time code, AI rewrite, edit in place, swap images, draft then publish, one script tag with the
  CSP caveat, save and restore, per-site tokens and keys). Not allowed: A/B testing, translation,
  "works everywhere", "any website", a money-back guarantee. The comparison data's delivery caveat
  (`comparisons.ts:47-48`: published edits are applied in the browser; crawlers that do not run
  JavaScript see the original HTML) is true and belongs in a file written for machine readers.

## Tests that change

- `src/__tests__/integration/comparison-discovery.test.tsx` mocks `@/lib/supabase/server` to feed
  the sitemap and expects `/login` and `/signup` in it. Both stop being true by design: the mock
  moves to the anon client and the two URLs leave the expected list.
- `src/__tests__/app/landing-founding-offer.test.tsx` imports `@/app/page`; it moves to the client
  body's new module. Assertions unchanged.
