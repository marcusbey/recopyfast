# Research — Story s43-launch-polish

Date: 2026-09-25. Base: `fb28a8b` (origin/main). Scope prevalidated by the operator from a
Playwright audit of production (https://www.recopyfa.st, desktop + mobile). Next 16.2.12,
React 19.1.0, local Node v24.14.0 (CI main jobs: Node 20, `.github/workflows/ci.yml:89`).

## The five structuring facts

1. `/blog` is statically prerendered and `src/components/blog/BlogPostList.tsx:1` is a client
   component, so its HTML is produced at build time in the build machine's locale/zone and then
   hydrated in the visitor's. `:92` and `:144` call `toLocaleDateString()` with no locale and no
   `timeZone` — the text differs between the two, which is React error #418 in production.
2. The posts' dates are date-only ISO strings (`src/app/blog/page.tsx:16,27,38`, e.g.
   `"2024-01-15"`), which `new Date()` parses as **UTC midnight**. Any visitor west of Greenwich
   sees the previous day even before the locale mismatch: this machine (America/Toronto) renders
   `1/14/2024` for `2024-01-15`. The fix must format in `timeZone: "UTC"`, not merely pin a locale.
3. `src/app/blog/[slug]/page.tsx:75` is a server component (no hydration), pins `"en-US"` but not
   `timeZone`, so its printed day follows the server process zone. It is on the blog surface →
   it goes through the same formatter. It is the only other public/marketing call site.
4. `next.config.ts:102-106` `redirects()` returns `[]`; there is no `src/app/pricing`, so
   `/pricing` falls through to `not-found.tsx`. Next applies config redirects **before**
   middleware (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:204-215`:
   headers → redirects → proxy/middleware → rewrites → filesystem), so `src/middleware.ts`
   never sees `/pricing` once the redirect exists.
5. The landing anchor exists: `src/components/sections/Pricing.tsx:112` `id="pricing"`; Header
   (`src/components/layout/Header.tsx:102,204`), Footer (`Footer.tsx:10`) and ComparisonPage
   (`ComparisonPage.tsx:250`) already link to `/#pricing`. `src/app/sitemap.ts:16-32` does not list
   `/pricing` (verified) — nothing to remove.

## Target story

s43-launch-polish — public pages load without errors, and `/pricing` works.

- `/blog` hydrates without a text mismatch in any visitor locale/time zone; its dates show the
  published calendar day, identical on server and client.
- Blog dates (list + article) come from one shared deterministic formatter
  (`Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })`).
- `/pricing` answers with a permanent redirect to `/#pricing`.
- Tests: formatter unit test (fixed output under `TZ=Pacific/Kiritimati` and `TZ=UTC`), a render
  test proving BlogPostList output is stable, a config test asserting the redirect entry.

## Current state of the code

- `src/app/blog/page.tsx` — server component, hard-coded `blogPosts` array (3 posts), renders
  `<BlogPostList posts={blogPosts} />`. No `dynamic`/`revalidate` export → static.
- `src/components/blog/BlogPostList.tsx` — `"use client"` (category filter state). Featured card
  date at `:92`, grid card date at `:144`, both `new Date(post.publishedAt).toLocaleDateString()`.
- `src/app/blog/[slug]/page.tsx` — async server component; reads `blog_posts` by slug via
  `@/lib/supabase/server` `createClient`; `notFound()` when missing; date at `:75-79`
  (`"en-US"`, `year numeric / month long / day numeric` → `January 15, 2024`).
- `src/lib/utils/` holds only `cn.ts`. No date formatter exists anywhere in `src/`.
- `next.config.ts` — `headers()` (try runtime + global security headers), empty `redirects()`
  and `rewrites()`, wrapped in `withSentryConfig` only when `NEXT_PUBLIC_SENTRY_DSN` is set.
- `vercel.json` — crons only; no redirects/rewrites to conflict.

## Anchor points

- New `src/lib/utils/format-date.ts` (kebab-case lib module per AGENTS.md naming).
- `BlogPostList.tsx:92,144` and `blog/[slug]/page.tsx:75-79` → call the formatter.
- `next.config.ts` `redirects()` → one entry `{ source: "/pricing", destination: "/#pricing", permanent: true }`.

## Verified APIs / functions

- Redirect entry shape: `source`, `destination`, `permanent` (`true` → **308**, `false` → 307) —
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md:26-30`.
- Query strings pass through to the destination (`redirects.md:43`). Hash in destination is kept:
  `node_modules/next/dist/shared/lib/router/utils/prepare-destination.js:162-191` appends
  `parsedDestination.hash` after the path, so `/pricing?utm_source=x` → `/?utm_source=x#pricing`.
- Redirect `source` matching is case-insensitive unless `experimental.caseSensitiveRoutes`
  (`server/lib/router-utils/filesystem.js:94-109` → `shared/lib/router/utils/path-match.js:16`
  default `sensitive: false`); the repo does not set it.
- When `NEXT_PUBLIC_SENTRY_DSN` is set (production), `withSentryConfig` (@sentry/nextjs 10.58.0)
  spreads the user config — `build/cjs/config/withSentryConfig/getFinalConfigObject.js:50`
  `...incomingUserNextConfigObject` — and only touches rewrites for a `tunnelRoute`, which
  `next.config.ts` does not set. `redirects` reaches Next unchanged.
- Test precedent for config: `src/__tests__/try/try-delivery.test.ts:1` imports
  `../../../next.config` and awaits `nextConfig.headers?.()`. Same pattern for `redirects?.()`.
- `Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date("2024-01-15"))`
  → `Jan 15, 2024` (checked on Node 24; `dateStyle` is supported on Node 20).
- `react-dom/package.json` exports `./server` → `server.node.js` under Jest's
  `customExportConditions: [""]` (default condition); `./client` → `client.js` (`hydrateRoot`).
  `jest.setup.js:4-8` polyfills `TextEncoder`. No existing test uses `renderToString`/`hydrateRoot`.

## Traps & constraints

- **`Intl.DateTimeFormat#format` throws `RangeError` on an Invalid Date**, where
  `toLocaleDateString()` returned the string `"Invalid Date"`. `blog_posts.published_at` is
  nullable (`supabase/migrations/20260731004000_missing_tables_integrations.sql:197`); `null`
  becomes epoch (valid) but an unparseable string would turn a cosmetic glitch into a render
  crash. The formatter must not throw.
- **The process TZ cannot be switched inside a Jest test.** Jest hands the test a copied
  `process.env`, so assigning `TZ` there does not reach Node's ICU. The TZ matrix is therefore
  run from the shell (`TZ=Pacific/Kiritimati` and `TZ=UTC`). Under `TZ=UTC` a naive
  implementation is indistinguishable from the fix; the unit test's instants are chosen so any
  non-UTC zone exposes it (`2024-01-15` = 00:00Z → previous day west of UTC;
  `2024-01-15T23:30:00Z` → next day at ≥ UTC+0:30), and the render test emulates the visitor's
  default locale/zone in-process so it guards regressions under CI's UTC too.
- `src/__tests__/middleware.test.ts:169` and `middleware-matcher.test.ts:156,182` use `/pricing`
  as an "ordinary public page" fixture. They call `middleware()` directly, bypassing Next's
  routing, so they stay valid and must not be edited. After this story that path never reaches
  middleware in a real request — the fixture is a stand-in, not a claim.
- `src/components/dashboard/SiteRegistrationModal.tsx:417` shows `href="/pricing"` inside a
  customer-site code sample — unrelated to our route; leave it.
- Footer's year is already set in an effect (`Footer.tsx:47`) — hydration-safe; no other
  render-time `Date`/`Math.random` on the marketing or blog surfaces (`ErrorBoundary.tsx:45`
  runs only on error).
- Changing the article date to the shared format shortens `January 15, 2024` to `Jan 15, 2024`
  — a visible, deliberate harmonisation with the list.

### Other locale-dependent call sites in `src/` (listed, not changed)

None is on a public/SSR path with data present at first render; each renders after a
client-side fetch/effect or in an event handler, so none can cause a hydration mismatch.

| Site | Call | Why no hydration risk |
|---|---|---|
| `collaboration/InvitationManager.tsx:310`, `collaboration/NotificationCenter.tsx:171`, `dashboard/SecurityDashboard.tsx:389` | `toLocaleDateString()` / `toLocaleString()` | No importer in `src/` (unmounted code) |
| `dashboard/BulkOperations.tsx:935,939`, `dashboard/DomainVerification.tsx:478,485,492`, `dashboard/WebhooksPanel.tsx:96` | no locale, no zone | `SiteDetailView` children, data loaded in `useEffect` (auth-gated dashboard) |
| `dashboard/ContentElementCard.tsx:227` | `toLocaleDateString()` | `dashboard/content/page.tsx` ("use client"), client-fetched |
| `dashboard/EditWebsiteButton.tsx:128` | `toLocaleString()` | Built in an event handler, not rendered |
| `dashboard/TrialStatusBadge.tsx:32`, `billing/TrialStatusCard.tsx:62`, `billing/InvoiceHistoryCard.tsx:14`, `billing/CreditBalanceCard.tsx:54`, `billing/SubscriptionCard.tsx:98` | `"en-US"`, no `timeZone` | Client-fetched; shows the visitor-local day (can differ by one from Stripe's UTC day near midnight — cosmetic, out of scope) |
| `billing/useCheckout.ts:44` | `Intl.DateTimeFormat("en-CA", HH:MM)` | Deliberately the visitor's clock; built after a 429 |
| `dashboard/AnalyticsDashboard.tsx:340,354`, `ab-results/ABTestVariantCard.tsx:55,59`, `ab-results/ABTestOverviewStats.tsx:26` | number `toLocaleString()` | Client-fetched; digit grouping follows visitor locale |
| `billing/*` credit/amount formatting, `lib/stripe/checkout.ts:319`, `compare/ComparisonPage.tsx:55` | numbers with `"en-US"` | Deterministic (numbers have no zone) |

## Open questions

- **Blog "Read more" targets (not verified, out of scope).** `/blog` links to three hard-coded
  slugs (`ai-website-builders-revolutionizing-web-development`, `dynamic-content-management-for-marketers`,
  `freelancer-guide-client-website-management`). `/blog/[slug]` resolves them against
  `blog_posts`; nothing in the repo seeds those rows. If production lacks them, every "Read
  more" is a 404. Production was not queried (no production access in this run) — the operator
  should `curl -I` one of them after deploy.
- Resolved at planning: the article page (`blog/[slug]`) adopts the shared formatter (fact 3).

## Real complexity

Not scored in `docs/stories.md` before this research (operator-prevalidated). Verdict: **2** —
one 10-line pure module, two call-site swaps, one config entry. The only non-trivial part is
making the tests meaningful when CI runs in UTC (see Traps).

## Split proposal

None needed.
