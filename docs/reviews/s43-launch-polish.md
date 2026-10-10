# Review — s43-launch-polish

Reviewer: independent anti-hallucination pass, fresh context, 2026-09-25.
Diff judged: implementation `e8c8cde`. `80a08af` is a clean merge of `origin/main`.
`git diff e8c8cde HEAD` on every s43 file is empty, and `git diff origin/main...HEAD` is the same 11 files.

## Commands run (CI placeholder env sourced)

| Command | Result |
|---|---|
| `npm run type-check` | exit 0, no diagnostics |
| `eslint` on the 7 changed source/test files and `next.config.ts` | exit 0 |
| `prettier --check` on the 7 changed `src/` files | clean |
| targeted jest (4 new suites + `try/try-delivery.test.ts`) | 9/9 under `TZ=UTC`, machine-local `America/Toronto`, `Pacific/Kiritimati` and `America/Los_Angeles` |

Not run, as instructed: the full suite, `npm run build`, `next start` and curl.

## Verified against the code

- **Imports and APIs exist:**
  - `act` from `react` 19.1.0
  - `renderToString` from `react-dom/server`
  - `hydrateRoot` and `Root` from `react-dom/client`
  - `within`, `render` and `screen` from Testing Library
  - `createClient` (`src/lib/supabase/server.ts:4`)
  - named `Header` (`Header.tsx:14`)
  - exported `BlogPost` interface
  - default `BlogPostPage` with `params: Promise`
  - `nextConfig.redirects`
- **Blog render path:**
  - Both `BlogPostList.tsx:93,145` and `blog/[slug]/page.tsx:76` call `formatDate`.
  - I grepped `src/app` (minus api and dashboard), plus `landing`, `sections`, `blog`, `layout` and `compare`. No locale- or zone-dependent formatting is left. What remains is `ComparisonPage.tsx:55` (`NumberFormat("en-US")`, which is deterministic), `Footer.tsx:47` (runs in an effect) and `sitemap.ts` (not rendered).
- **Formatter:**
  - `format-date.ts:30` returns `""` on an Invalid Date.
  - The tests never touch `process.env.TZ` in-process. The zone matrix comes only from the shell.
- **Redirect:**
  - Next 16.2.12. `permanent: true` gives `getRedirectStatus` 308 (`redirects.md:30`).
  - The request query is merged and the hash is split from the destination (`resolve-routes.js:523-531`, `prepare-destination.js:260-265`), so `/pricing?x=1` goes to `/?x=1#pricing`.
  - Matching is case-insensitive: `path-match.js:16` defaults `sensitive: false` and `caseSensitiveRoutes` is unset.
  - Config redirects run before middleware (`proxy.md:208-210`).
  - `/api/pricing` is not matched, because the rule is exact-path.
  - `sitemap.ts` and `robots.ts` have no `pricing`, and `Pricing.tsx:112` carries `id="pricing"`.
- **Plan and interdicts:**
  - Tasks 1-5 are all present, with nothing extra.
  - There is no diff to middleware, sitemap, jest config, `package.json` or `public/embed`.
  - No ADR conflicts. ADR 018/021's "never a redirect target" concerns API/serving hosts, not `/pricing`.

## Mutations (each restored; `git diff --exit-code` clean)

| Neutralized | UTC (CI) | Toronto | Kiritimati |
|---|---|---|---|
| M1: delete `timeZone: "UTC"` (`format-date.ts:18`) | **0 red** | 3 | 3 |
| M2: both list call sites back to `toLocaleDateString()` | 1 (hydration mismatch) | 1 | 1 |
| M2b: grid call site only | 1 | — | — |
| M3a: redirect entry removed | 1 | — | — |
| M3b: `permanent: false` | 1 | — | — |
| M4: invalid-date guard removed | 1 (`RangeError`) | — | — |
| M5: article page back to its old `toLocaleDateString` | 1 | — | — |
| M5b: article page `en-US` medium with no `timeZone` | **0 red** | 1 | — |

## Findings

**M1 (major) — the timeZone guard this story turns on is untested in CI.**
- CI is `ubuntu-latest` with no `TZ` set (`.github/workflows/ci.yml:15,139`), so it runs in UTC.
- Under UTC, deleting `timeZone: "UTC"` leaves all 8 tests green.
- The hydration test cannot see it. `DISPLAY_DATE_FORMAT` is constructed when the module is imported (`format-date.ts:16`), which happens before `emulateEnvironment` spies `Intl.DateTimeFormat` (`BlogPostList.test.tsx:63`).
- The research Traps claim that the render test "guards regressions under CI's UTC too" holds only for call-site regressions (M2), not for the formatter.
- M5b shows the article-page test has the same blind spot.
- Suggested fix: in `format-date.test.ts`, install a non-UTC default-zone `Intl` spy and then load the module through `jest.isolateModules`.

**n1 (minor) — pre-existing, not introduced.**
- `blog_posts.published_at` is nullable, but `formatDate(value: string | Date)` does not type it that way.
- A null prints "Jan 1, 1970" (`page.tsx:76`) rather than `""`.

## Not verified

- **HTTP behaviour.** 308, `Location`, `/PRICING` and the query string were checked from source only. Run `curl -sI` against a preview and against production, which is Vercel routing rather than `next start`.
- **Real browsers.** There was no real-browser hydration. The tests use a single Node ICU, and Safari/Chrome CLDR output for "Jan 15, 2024" was never compared. Open `/blog` in a fr-FR or Asia/Tokyo browser and check the console.
- **Full suite and build.** The full `precommit` and `npm run build` claims were not checked.
- **Blog slugs.** Whether the three `/blog` slugs exist in production `blog_posts` is unknown.

Max severity: major
Ship allowed: yes
