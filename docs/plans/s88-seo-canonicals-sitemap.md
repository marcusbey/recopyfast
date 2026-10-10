---
validated: yes
---
# Plan — Story s88-seo-canonicals-sitemap

> CTO decision under the owner's 2026-10-09 directive.

Research: `docs/research/s88-seo-canonicals-sitemap.md` (verified on `c0c40bf`). No design doc: no
screen changes — the homepage renders the same markup, plus one invisible JSON-LD `<script>`. No
migration, no embed change, no new dependency, no Playwright count change.

## CTO decisions

1. **Published posts are read with a cookie-less anon client** (`src/lib/supabase/anon.ts`, new):
   role `anon`, RLS on, no session. It is the least-privileged role that can do the read — the
   `"Published blog posts are public"` policy grants it exactly the published rows — and the one a
   crawler already gets on `main` and `/blog/<slug>` already uses. The service role was rejected (RLS
   off; one missing filter publishes drafts; ADR 002 / AGENTS.md reserve it for `authorize*` paths
   and named exceptions). The cookie client was rejected (identity-dependent; forces per-request
   rendering). A named module rather than an inline client so the rule ("public, RLS-readable data
   in server code with no user") sits in one commented place. Follow-up for the architecture owner:
   the "Data access" table in AGENTS.md / `architecture.md` lists three clients; this is a fourth
   row to record there (I do not edit the rules). (Done in review, minor 1: ADR 058 and the two
   tables — R1.)
2. **`/login` and `/signup` are `noindex, follow`** and leave the sitemap. They are bare auth forms
   with no content of their own; brand searches land on `/`; every conversion path links to
   `/signup`. They stay crawlable so the `noindex` is read.
3. **No fabricated `lastModified`.** Static pages carry none (no page records when its content last
   changed, and `now` on every request is false). A post carries `updated_at ?? published_at`, and
   nothing when both are null. `changeFrequency`/`priority` stay as they are.
4. **The sitemap revalidates hourly** (`export const revalidate = 3600`). The blog cron only creates
   drafts (s89) and a platform admin publishes them (corrected in review, minor 5); an hour of lag
   is invisible to search engines and turns a per-request database read into one read an hour. On a database failure it logs and serves the static entries (the
   existing degrade contract, pinned by `comparison-discovery.test.tsx`).
5. **Dashboard `noindex` is a response header**, `X-Robots-Tag: noindex, nofollow` on
   `/dashboard/:path*` in `next.config.ts` — the segment is client-rendered and cannot export
   metadata. (Review minor 4 adds the matching `robots` metadata through a server layout: R4.) robots.txt keeps disallowing it (now `/dashboard`, covering the bare path) as the brief
   asks; the header covers any crawler that fetches it anyway.
6. **The homepage becomes a server wrapper** (`app/page.tsx`: metadata, `revalidate = 300`, JSON-LD)
   around its unchanged client body, moved verbatim to `src/components/landing/HomePage.tsx`. 300 s
   matches the comparison pages (ADR 032 §6) and `/api/pricing`.
7. **JSON-LD offers come from the `plans` catalogue** (`getPlanCatalogue`), the source of truth by
   Non-negotiable 7, with `/api/pricing`'s sellable rule (not `free`; Agency only while
   `isAgencyCheckoutEnabled()`), monthly price, USD. Not the Stripe overlay — same choice as the
   comparison pages; `check:stripe` guards drift. One-time products (Lifetime, Founding, credit
   packs) are not emitted: capacity-limited and availability-dependent, and the brief asks for the
   plan catalogue. No `aggregateRating`, no `review` (ADR 032 §5). On a catalogue failure the
   `offers` key is omitted — no fallback price.
8. **`/llms.txt` is a generated, force-static route** built from `comparisonList` and the site
   identity constants (ADR 012 §4: a new comparison is listed with no extra wiring), served as
   `text/plain; charset=utf-8`, sessionless in middleware like robots/sitemap.
9. **Root metadata keeps its site-wide defaults but loses `alternates` and `openGraph.url`.** Only
   the homepage re-adds `og:url` (`/`). Pages that set no canonical get none, which is Google's own
   fallback, instead of a wrong one. No `openGraph` objects are added to pages that had none (a child
   `openGraph` replaces the parent's whole object — research §1). The title/description/site name
   move to `src/lib/seo/site-identity.ts` because the homepage, the JSON-LD and llms.txt reuse them
   and a layout may not export them.

## Task 1 — every indexable page resolves its own canonical

Failing tests first, `src/__tests__/app/seo-canonicals.test.ts` (node environment; resolves each
route's metadata chain with Next's own `accumulateMetadata`, `server-only` mocked):
1. root layout metadata has no `alternates` and no `openGraph.url`;
2. for `/`, `/demo`, `/try`, `/compare`, each `/compare/<slug>`, `/blog`, `/blog/<slug>`
   (via `generateMetadata`), `/privacy`, `/terms`, `/docs/install`: resolved canonical =
   `siteUrl + path` (the homepage: `siteUrl`);
3. no page but `/` resolves the homepage as canonical or as `og:url`; `/` resolves `og:url` = home.

Change: `src/lib/seo/site-identity.ts` (moved constants); `app/layout.tsx` (drop `alternates`,
`openGraph.url`); `app/page.tsx` → server wrapper + `components/landing/HomePage.tsx` (verbatim
body); `app/demo/layout.tsx` (new, metadata only); `app/blog/page.tsx` metadata;
`app/blog/[slug]/page.tsx` `generateMetadata` (canonical from the slug param, no extra read);
`app/privacy/page.tsx`, `app/terms/page.tsx` metadata. `landing-founding-offer.test.tsx` imports
the moved body (declared test move).

- [x] Task 1

## Task 2 — pages that must not be indexed say so

Failing tests first:
1. same file: `/login`, `/signup`, `/edit`, `/auth/error` resolve `robots` containing `noindex`
   and no canonical;
2. `src/__tests__/next-config-robots-headers.test.ts`: with Next's `getPathMatch`, `/dashboard`,
   `/dashboard/sites/<id>` and `/dashboard/billing` match a `headers()` rule setting
   `X-Robots-Tag: noindex, nofollow`; `/`, `/blog`, `/docs/install`, `/try`, `/login` match none.

Change: `app/login/layout.tsx`, `app/signup/layout.tsx` (new, metadata only); `app/auth/error/page.tsx`
metadata; `next.config.ts` header rule.

- [x] Task 2

## Task 3 — the sitemap lists what is really published, read as `anon`

Failing tests first, `src/__tests__/app/sitemap.test.ts`, with an in-memory fake of the anon client
that applies the query's `eq` filters to rows (so "published only" is the database contract the fake
enforces, not a call assertion):
1. a published post appears, a draft and an archived post do not;
2. neither `@/lib/supabase/server` nor `@/lib/supabase/service` is ever constructed;
3. every indexable page is listed, `/docs/install` included; `/login`, `/signup`, `/edit`,
   `/dashboard*`, `/api/*`, `/auth/*` are not; no URL repeats;
4. `lastModified`: post = `updated_at`, else `published_at`, else absent; static entries absent;
5. a query error and a thrown client both log (`console.error`) and return the static entries;
6. `revalidate` is exported, positive and at most a day.
`src/lib/supabase/__tests__/anon.test.ts`: the client is built from the public URL and anon key with
session persistence, refresh and URL detection off, and throws a named error when either env var is
missing.
Update `comparison-discovery.test.tsx`: mock target → `@/lib/supabase/anon`; `/login`, `/signup`
removed from the expected list (declared).

Change: `src/lib/supabase/anon.ts` (new); `src/app/sitemap.ts`.

- [x] Task 3

## Task 4 — robots.txt agrees with the sitemap and the noindex pages

Failing tests first, `src/__tests__/app/robots.test.ts` (prefix semantics of robots rules):
1. `/api/x`, `/dashboard`, `/dashboard/sites/x`, `/auth/confirm` are disallowed;
2. no URL the sitemap lists is disallowed; `/login`, `/signup`, `/edit` are not disallowed;
3. names `${siteUrl}/sitemap.xml`.

Change: `src/app/robots.ts` (`/dashboard/` → `/dashboard`, comment).

- [x] Task 4

## Task 5 — SoftwareApplication JSON-LD on the homepage

Failing tests first:
1. `src/lib/seo/__tests__/json-ld.test.ts`: `buildSoftwareApplicationLd` returns
   `@context`/`@type`/`name`/`description`/`url`/`applicationCategory`/`operatingSystem`, the
   offers it is given, no `offers` key for an empty list, and no `aggregateRating`/`review`;
   `serializeJsonLd` escapes `<`.
2. `src/lib/seo/__tests__/catalogue-offers.test.ts` (catalogue mocked at `getPlanCatalogue`): offers
   are exactly the non-free subscription plans' names and monthly prices in USD, per month; Agency
   only while the switch is on; a catalogue failure logs and yields none.
3. `src/__tests__/app/home-json-ld.test.tsx`: the homepage renders exactly one
   `application/ld+json` script; it parses; it is a `SoftwareApplication` whose offers equal the
   mocked catalogue's sellable plans.

Change: `src/lib/seo/json-ld.ts`, `src/lib/seo/catalogue-offers.ts` (new); `app/page.tsx`.

- [x] Task 5

## Task 6 — `/llms.txt`

Failing tests first:
1. `src/__tests__/app/llms-txt.test.ts`: `GET` → 200, `text/plain; charset=utf-8`; starts with
   `# ReCopyFast` and a `>` summary; links (absolute, on `resolveSiteUrl()`) to `/`, `/try`, `/demo`,
   `/docs/install`, `/docs/install/agent-instructions.md`, `/compare`, every `comparisonList` page,
   `/privacy`, `/terms`; every linked HTML page is in the sitemap; no A/B, split-test, translation,
   "works everywhere", "any website" or money-back claim.
2. `src/__tests__/middleware-matcher.test.ts`: `/llms.txt` joins `CRAWLER_ASSETS` (sessionless,
   still matched for headers).

Change: `src/lib/seo/llms-txt.ts`, `src/app/llms.txt/route.ts` (new); `src/middleware.ts`
(`isSessionlessPath` + comment).

- [x] Task 6

## Task 7 — gates, build check, mutations

- `next build` offline (Supabase URL on a closed port): `/` and `/sitemap.xml` are ISR (5 m / 1 h),
  `/llms.txt` static; delete `.next`.
- Mutation per guard (neutralize → red → restore with `git checkout --`).
- Full jest, type-check, type-check:build, lint, format:check, build:embed --check, Playwright list.

- [x] Task 7

## Execution notes

- Offline `next build` (Supabase URL on a closed port, `NEXT_PUBLIC_APP_URL=https://recopyfa.st`):
  `/` ISR 5 m, `/sitemap.xml` ISR 1 h (was `ƒ` on `main`), `/llms.txt` static. Prerendered HTML:
  `/privacy`, `/terms`, `/demo`, `/blog`, `/docs/install` each carry their own
  `<link rel="canonical">`; `/login`, `/signup` `noindex, follow`; `/edit`, `/auth/error`
  `noindex, nofollow` with no canonical; the homepage JSON-LD has no `offers` (catalogue unreachable,
  logged) and the sitemap lists the 12 static URLs (post read failed, logged). `.next` deleted.
- 35 mutations, each red, each restored (`git checkout --` from the index).
- Beyond the plan's letter: `site-identity.ts` also exports `SITE_OPEN_GRAPH` (the layout default
  and the homepage's restatement share it); the moved body's export is renamed `Home` →
  `HomePage` to match its file (AGENTS.md naming); the llms.txt suite also pins the crawler
  caveat.

## Review fixes (minors 1–5)

> CTO decision under the owner's 2026-10-09 directive. Rebased on `origin/main` `fc5968b` first
> (one `docs/stories.md` append conflict, resolved in id order: s73 then s88).

CTO decisions for this pass:

- **R1 (minor 1).** The anon client is recorded as
  [ADR 058](../decisions/058-cookie-less-anon-client-for-public-reads.md) and gets its row in the
  "Data access" tables of `AGENTS.md` and `docs/architecture.md`. 058 because 055 (s76), 056 (s77)
  and 057 (s89) are claimed on open branches. This replaces decision 1's "follow-up for the
  architecture owner": the reviewer asked for it in this story.
- **R2 (minor 2).** `/blog` lists what `blog_posts` publishes, read through the same anon client and
  the same `status = 'published'` filter as the sitemap, newest `published_at` first, regenerated
  hourly (`revalidate = 3600`, the sitemap's). The card shows only what the table holds — title,
  excerpt, category, publication date. The **"Featured" hero and the read time leave the list**:
  no column backs "featured" (it was a claim in the fake data), and a read time would mean hauling
  every article's full `content` into the index; `/blog/<slug>` keeps its own read time. Three
  states, distinct components (`docs/design-system.md` § States): the list; `EmptyState` when
  nothing is published; a destructive `Alert`, logged, when the read fails — never the empty state.
  A failed read renders (it does not throw), so ISR keeps that render until the next revalidation,
  at most an hour — the sitemap's degrade contract; throwing instead would fail every offline
  `next build` (CI builds with placeholder Supabase values).
  `src/app/blog/[slug]` and every blog API/admin route are left alone (s89 owns them). The
  states are recorded in `docs/designs/s88-seo-canonicals-sitemap.md` (no new screen, no mockup). A post an
  admin publishes reaches the index within the hour; an on-publish `revalidatePath("/blog")` is a
  follow-up for s89's admin route, not this story.
- **R3 (minor 3).** Accepted as is: the JSON-LD offers read `plans.price` (the catalogue, Non-
  negotiable 7) while `/api/pricing` overlays live Stripe prices. Decision 7 above stands;
  `check:stripe` guards drift between the two.
- **R4 (minor 4).** The dashboard's HTML said `index, follow` (inherited from the root) while its
  response header said `noindex, nofollow`. `src/app/dashboard/layout.tsx` becomes a minimal server
  layout that exports `robots: { index: false, follow: false }` and renders the unchanged client
  frame, moved verbatim (`git mv`) to `src/app/dashboard/DashboardFrame.tsx`. The guard's
  `FOCUS_SHADOW_FILE` follows the move (declared test change); ADR 053's path pointer gets an
  errata entry — the layout still owns width and gutters, through the frame it renders.
- **R5 (minor 5).** `src/app/sitemap.ts`'s comment and decision 4 above: the cron only creates
  drafts (s89); a platform admin publishes.

## Task R1 — ADR 058 and the client tables

- `docs/decisions/058-cookie-less-anon-client-for-public-reads.md` (new): why a fourth, cookie-less
  anon client exists (least privilege for public reads with no user, vs the cookie client and the
  service role), when to use it and when never to.
- `AGENTS.md` § Data access and `docs/architecture.md` § Data access: a fourth row.

- [x] Task R1

## Task R2 — `/blog` reads the published posts

Failing tests first, `src/__tests__/app/blog-index.test.tsx` (the anon client mocked with the
schema-strict `blog_posts` double, cookie and service clients throwing):
1. published posts render, newest first; a draft and an archived post do not; none of the three
   hard-coded 2024 titles renders;
2. no post published → the empty state, and no list; a failed read → the error alert, logged,
   and neither the list nor the empty state; a thrown client → the same;
3. `revalidate` equals the sitemap's;
4. neither the cookie client nor the service role is constructed.
`src/components/blog/__tests__/BlogPostList.test.tsx`: fixtures follow the new card type (string
ids, nullable excerpt and date, no `featured`/`readTime`) — declared test change.

Change: `src/lib/blog/published-posts.ts` (new); `src/app/blog/page.tsx`;
`src/components/blog/BlogPostList.tsx`.

- [x] Task R2

## Task R4 — the dashboard's robots meta agrees with its header

Failing test first, `src/__tests__/app/seo-canonicals.test.ts`: `/dashboard` resolved through the
root → dashboard layout chain gives `robots` `noindex, nofollow`, equal to the `X-Robots-Tag`
`next.config.ts` sends for `/dashboard`.

Change: `src/app/dashboard/layout.tsx` (server, metadata), `src/app/dashboard/DashboardFrame.tsx`
(moved client body); `src/__tests__/design/page-shell-guard.test.ts` `FOCUS_SHADOW_FILE`;
`docs/decisions/errata.md` (ADR 053 pointer).

- [x] Task R4

## Task R5 — the sitemap comment tells the truth about publishing

Change: `src/app/sitemap.ts` comment; decision 4 above.

- [x] Task R5

### Review-fix execution notes

- Offline `next build` (Supabase URL on a closed port, `NEXT_PUBLIC_APP_URL=https://recopyfa.st`):
  `/blog` is ISR 1 h; its prerendered HTML carries `<link rel="canonical" href=".../blog">`, the
  error state ("The blog could not be loaded", read failed, logged) and none of the 2024 titles;
  `/dashboard` and `/dashboard/sites` carry `<meta name="robots" content="noindex, nofollow"/>`.
  `.next` deleted.
- 11 mutations, each red, each restored (`git checkout --` from the index).
- Declared test changes: `BlogPostList.test.tsx` fixtures follow the card type (string ids, no
  `featured`/`readTime`); `page-shell-guard.test.ts` `FOCUS_SHADOW_FILE` follows the frame's move;
  `next-config-robots-headers.test.ts` docblock no longer says the dashboard cannot export
  metadata. No test deleted.
