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
   row to record there (I do not edit the rules).
2. **`/login` and `/signup` are `noindex, follow`** and leave the sitemap. They are bare auth forms
   with no content of their own; brand searches land on `/`; every conversion path links to
   `/signup`. They stay crawlable so the `noindex` is read.
3. **No fabricated `lastModified`.** Static pages carry none (no page records when its content last
   changed, and `now` on every request is false). A post carries `updated_at ?? published_at`, and
   nothing when both are null. `changeFrequency`/`priority` stay as they are.
4. **The sitemap revalidates hourly** (`export const revalidate = 3600`). The blog cron publishes at
   most daily; an hour of lag is invisible to search engines and turns a per-request database read
   into one read an hour. On a database failure it logs and serves the static entries (the
   existing degrade contract, pinned by `comparison-discovery.test.tsx`).
5. **Dashboard `noindex` is a response header**, `X-Robots-Tag: noindex, nofollow` on
   `/dashboard/:path*` in `next.config.ts` — the segment is client-rendered and cannot export
   metadata. robots.txt keeps disallowing it (now `/dashboard`, covering the bare path) as the brief
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
