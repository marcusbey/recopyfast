# Research — Story s17-cluster-engine

> **Gate warning (binding, per instructions):** `docs/reviews/stories.md` ends `Max severity:
> major` / `Stories ready: no`. Six majors are open against the current `stories.md`, none of
> them naming `s17` directly (the closest is m9/"not stories, deliberately" on SEO items, which
> is closed). Operator confirmed proceeding despite the gate. This research treats `s17`'s text
> in `stories.md` as current, but flags below where the *code* disagrees with what the story
> and its supporting docs assume.

## The five structuring facts

1. **The existing blog-generation cron already auto-publishes with zero human review** —
   `src/app/api/blog/generate/route.ts:275-282` inserts with `status: "published"` and
   `published_at: new Date().toISOString()` in the same call that creates the row. `s17`'s own
   agentic note ("the PRD is explicit: it drafts, a human publishes. Do not wire auto-publish")
   is written as if today's pipeline only drafts. It does not — it publishes immediately, daily,
   via `vercel.json`'s `0 14 * * *` cron. This is a false premise in the surrounding docs, not in
   `s17`'s ACs themselves (which don't touch blog), but it is exactly the trap a planner could
   walk into if `s17`'s content pipeline is built by copying this route's insert path.
2. **`sitemap.ts` is genuinely generated, not hand-maintained, and already has the exact shape
   `s17` AC 4 needs** — `src/app/sitemap.ts:34-42` is a static `STATIC_ROUTES` array,
   `:57-75` (`getBlogRoutes`) fetches dynamic entries and fails soft (`[]`) on any DB error,
   `:81-97` merges both into one `MetadataRoute.Sitemap`. Adding cluster entries is additive:
   one more typed array or one more merged list, no restructuring.
3. **Zero structured data exists anywhere in the codebase today.** Grepping the whole `src/`
   tree for `application/ld+json`, `SoftwareApplication`, `FAQPage`, `BreadcrumbList` returns no
   matches outside this research. AC 3 (`SoftwareApplication` + `FAQPage` + `BreadcrumbList`
   JSON-LD) is fully greenfield — there is no existing JSON-LD component or convention to reuse
   or diverge from.
4. **No cluster routes and no `llms.txt` exist.** `src/app/alternatives`, `cms-for`, `for`,
   `agencies` are all absent. `public/` contains only `demo-site/`, `demo.html`, `embed/` — no
   `llms.txt`, no static `robots.txt`/`sitemap.xml` (both are `.ts`-generated, confirmed no
   static override conflicts). AC 1, 5 and 6 have no prior art to conflict with.
5. **No Lighthouse/CWV tooling exists anywhere in the repo** — not in `package.json` scripts,
   not in `.github/workflows/ci.yml` (the only workflow file), no `lighthouserc*` file anywhere.
   AC 7 is not "add a check to an existing gate" — it is new CI infrastructure from zero.

## Target story

**s17-cluster-engine — comparison pages that rank** (`docs/stories.md:811-845`). Complexity as
written: **3** — "content-driven routes with structured data and generated sitemap entries."
Dependencies: none. **Gates `s18-stack-recipes` and `s19-audience-pages`.**

Acceptance criteria (verbatim):
- [ ] `/alternatives/<competitor>` renders from structured content for at least tinacms,
  cloudcannon, contentful, storyblok and decap-cms.
- [ ] Each page states what the competitor does better, not only what we do better.
- [ ] Each page carries `SoftwareApplication`, `FAQPage` and `BreadcrumbList` JSON-LD that
  validates.
- [ ] Every generated page appears in `sitemap.ts` automatically — the sitemap is never
  hand-maintained.
- [ ] An unknown competitor slug returns 404, not an empty page.
- [ ] `llms.txt` is served and lists the comparison pages.
- [ ] Each page passes Core Web Vitals thresholds in a Lighthouse run in CI.
- [ ] Page content lives in typed, validated data, so adding a competitor requires no new
  route code.

Agentic notes point at `src/app/sitemap.ts`, `robots.ts`, `blog/[slug]`, `opengraph-image.tsx`,
`manifest.ts` as "existing SEO surface," state "no cluster routes exist" (confirmed), call this
story "the engine" that `s18`/`s19` ride on, name the thin-content trap explicitly, and repeat
the drafts-not-publishes constraint on `cron/generate-blog-post`.

## Current state of the code

- **`src/app/sitemap.ts`** — `resolveSiteUrl()` (`:12-22`) picks the canonical origin from env
  with a documented fallback chain; `STATIC_ROUTES` (`:34-42`) is a typed `readonly` array of
  `{ path, changeFrequency, priority }`; `getBlogRoutes()` (`:57-75`) queries
  `blog_posts` for `status = "published"` and returns `[]` on any error, explicitly so a
  Supabase outage degrades the sitemap rather than 500s it; `sitemap()` (`:77-98`) merges static
  and dynamic entries into one array. This is the pattern AC 4 needs to extend.
- **`src/app/robots.ts`** — same `resolveSiteUrl()` duplicated, static rules only
  (`disallow: ["/api/", "/dashboard/", "/auth/"]`), points at `sitemap.xml`. No change needed for
  `s17` unless new routes need explicit disallow (they don't — public marketing pages).
- **`src/app/manifest.ts`**, **`src/app/opengraph-image.tsx`**, **`src/app/twitter-image.tsx`** —
  one static OG/Twitter card at the app root (`twitter-image.tsx` just re-exports
  `opengraph-image.tsx`'s default/alt/size/contentType, `:1-4`). There is **no per-route
  `opengraph-image.tsx` anywhere in the app** (confirmed via `find`), so there is no existing
  dynamic-per-slug-OG-image precedent to follow or diverge from. `s17`'s ACs don't require one.
- **`src/app/blog/[slug]/page.tsx`** — fetches a single row from `blog_posts` via
  `createClient()` (Supabase, server, RLS-enforced) keyed on `slug` + `status = "published"`
  (`:21-36`), calls `notFound()` (`next/navigation`) when the row is missing (`:46-48`) — this
  is the exact working 404 precedent AC 5 needs. Content is rendered via
  `dangerouslySetInnerHTML` through `sanitizeHTML(..., "RICH_TEXT")`
  (`src/lib/security/content-sanitizer.ts`), because blog content is free-form HTML from an AI
  generation pipeline, not typed data.
- **`src/app/blog/page.tsx`** — **not** DB-backed. `blogPosts` (`:8-42`) is a hardcoded literal
  array with stale 2024 dates, `// This would typically come from a database` inline comment
  (`:7`). This directly contradicts `sitemap.ts`'s own `getBlogRoutes()`, which does query the
  DB — the blog list page and the blog sitemap entries are already two different sources of
  truth for the same content. **This means "the existing content-driven route pattern" is not
  one clean precedent to copy: the detail page is DB + sanitized-HTML, the list page is a
  hardcoded array, and neither is "typed, validated data" in the sense AC 8 means** (a closed,
  compile-time-checked shape, not a database row of arbitrary rich text). `s17` cannot copy the
  blog pattern verbatim and satisfy AC 8; it has to build the typed-data pattern from scratch.
- **`src/app/api/cron/generate-blog-post/route.ts`** + **`src/app/api/blog/generate/route.ts`**
  — the cron authenticates via `CRON_SECRET` bearer (fail-closed if unset), fetches a random
  topic suggestion, then POSTs to `/api/blog/generate`, which inserts the generated post with
  `status: "published"` **immediately** (`:275-282`) — see structuring fact 1. `vercel.json`
  schedules this daily at `14:00`. `s17` does not touch this route (it's blog, not clusters),
  but its own agentic notes assume a drafts-only behavior that isn't true of the analogous
  pipeline it's implicitly being compared against.
- **No typed content-data precedent for marketing pages exists.** No `src/data/` directory. No
  `install-recipe`/`InstallRecipe` module (owned by `s02`, which hasn't shipped — `s17` has no
  dependency on `s02`, so this is not a blocker, just confirmation the module doesn't exist
  yet). The closest **shape** precedents in the repo for "typed, validated, closed-set data" are
  `src/lib/stripe/plan-types.ts` (closed TS unions + `readonly` arrays +
  a runtime check that the DB actually contains the union's members) and the `CONTENT_TOPICS`
  array in `src/app/api/blog/generate/route.ts:62-142` (a large literal array of typed topic
  objects, no DB). Both are patterns to imitate, not modules to extend.
- **CI** (`.github/workflows/ci.yml`) — three jobs: `ci` (audit → lint → type-check:build →
  build → jest, all blocking), `e2e` (Playwright, self-skips without staging Supabase secrets,
  otherwise `npm run build` + `npm run start` + `wait-on` + `npm run test:e2e`, blocking when it
  runs), `type-check` (tsc incl. tests). No Lighthouse, no CWV, no perf budget anywhere. The
  `e2e` job's build-then-serve-then-drive-a-real-browser shape is the closest existing precedent
  for how a Lighthouse job would need to boot a real server in CI.
- **Design-system conflict for the new surface.** `docs/architecture.md:299-309` groups the new
  pages with marketing: *"Marketing → `/`, `/blog`, and the SEO clusters `s17`–`s19` will add.
  `framer-motion`, `three`/R3F and `lenis` live here and only here."* But
  `docs/design-system.md:17` classifies `/blog` under **App** (✅ on-system, token-driven), and
  its own "Scope exceptions — leave alone" list (`:276-280`) names only *"Landing / demo /
  privacy / terms"* for the legacy `sky-*`/`slate-*`/WebGL exception — blog is not in it, and
  neither (necessarily) are `s17`'s clusters. The actual code settles blog's own case: both
  `blog/page.tsx` and `blog/[slug]/page.tsx` use only app tokens (`bg-background`, `text-display`,
  `bg-primary`, `bg-surface-1`, `text-muted-foreground`, `border-border`) — zero `sky-*`/`slate-*`
  classes, zero WebGL. **`architecture.md`'s grouping and `design-system.md`'s evidence-based
  table disagree about the surface blog itself sits on, and neither document states which
  palette `/alternatives`, `/cms-for`, `/for`, `/agencies` should use.** See Open questions.

## Anchor points

- `src/app/sitemap.ts:34-42` (`STATIC_ROUTES`), `:57-75` (`getBlogRoutes`), `:77-98`
  (`sitemap()` merge) — the pattern to extend for AC 4.
- `src/app/robots.ts:23-39` — unaffected; new public routes need no `disallow` entry.
- `src/app/blog/[slug]/page.tsx:44-48` — `notFound()` 404 precedent for AC 5.
- `src/app/api/blog/generate/route.ts:275-282` — the auto-publish behavior `s17`'s content
  pipeline must not replicate.
- `src/lib/stripe/plan-types.ts:1-34` — closed-union + validated-against-source-of-truth pattern,
  the nearest existing shape precedent for AC 8's "typed, validated data."
- `.github/workflows/ci.yml` (`e2e` job) — nearest precedent for booting a real server in CI,
  needed for the Lighthouse job in AC 7.
- `src/middleware.ts` — only gates `/dashboard`, `/settings` for auth and derives CSP
  `connect-src` from env; new public marketing routes need no middleware change (confirmed by
  reading the file's route list in `docs/architecture.md:269-270`, not re-derived here).

## Verified APIs / functions

- `resolveSiteUrl()` — duplicated identically in `sitemap.ts:12-22` and `robots.ts:11-21`. No
  shared module. A third copy for a cluster-specific need (e.g., `llms.txt`) would be a third
  duplication — worth centralizing if `s17` adds a third consumer, though not an AC.
- `getBlogRoutes()` (`sitemap.ts:57-75`) — DB-backed, fails soft. **Not** the pattern to copy for
  clusters, since AC 8 wants static typed data, not a DB round trip.
- `notFound()` (`next/navigation`) — used once today (`blog/[slug]/page.tsx:47`), the direct
  precedent for AC 5.
- `sanitizeHTML(html, "RICH_TEXT")` (`src/lib/security/content-sanitizer.ts`) — used for blog's
  free-form AI content. Likely **not** needed for `s17` if content is authored as typed data
  (plain strings/JSX) rather than stored rich-text HTML — worth stating explicitly in the plan
  so an agent doesn't reach for it out of habit.
- No existing JSON-LD helper/component of any kind — confirmed by repo-wide grep. AC 3 has
  nothing to call, only Next.js's standard `<script type="application/ld+json">` convention to
  follow.
- No existing Lighthouse/CWV-budget script, npm script, or CI step — confirmed by
  `package.json` scripts list and `.github/workflows/ci.yml` grep. AC 7 has no scaffolding.

## Traps & constraints

- **Do not model the content pipeline on `/api/blog/generate`.** It auto-publishes on insert.
  `s17`'s own note says human publishes; the nearest analog in the codebase does the opposite.
  If `s17`'s plan proposes any AI-assisted drafting for comparison pages (the story doesn't
  require this — it only requires the data to be typed/validated, not AI-authored), it must not
  reuse that route's insert-then-live behavior.
- **AC 8 ("typed, validated data") is not satisfied by either existing content pattern.** Blog's
  detail page is a DB row of sanitized rich-text HTML; blog's list page is a hardcoded literal
  array that has already drifted from the DB-backed sitemap. Neither is "typed and validated" in
  a compile-time sense. `s17` is genuinely inventing this module, not extending one.
- **Byte budget (`≤ 30,000 bytes gzipped`, `s06`'s domain) does not apply here.** That ceiling is
  specifically `public/embed/recopyfast.js`, the customer-facing embed script. `s17`'s pages are
  ordinary server-rendered Next.js routes with no relationship to the embed bundle. Flagging
  this explicitly because `s06` "gates every embed change" language in `stories.md` could be
  misread as gating `s17` too — it does not.
- **Thin-content risk is real and is already named in the story.** Five competitor pages sharing
  one template with only nouns swapped is exactly what the Helpful Content system demotes,
  site-wide. The "what the competitor does better" AC exists specifically to force genuine
  per-page differentiation — treat it as a hard content requirement per competitor, not
  boilerplate.
- **AC 7 (Lighthouse in CI) is the one AC with no existing scaffolding at all.** Every other AC
  extends a pattern that already exists somewhere in the repo (sitemap merge, `notFound()`,
  typed-union data shapes). This one requires: a new CI job or step, a way to boot the built app
  and hit the five-plus new routes, a Lighthouch CI (or equivalent) invocation, and **numeric
  Core Web Vitals thresholds that are not stated anywhere in the PRD, architecture doc, or
  stories.md** — the story says "passes Core Web Vitals thresholds" without a number, the same
  class of defect the stories-review flagged elsewhere (m5: "four criteria deferred the number
  that would make them testable," about different stories, but the same gap pattern here).
- **Marketing-surface palette is unresolved** (see Current state, last bullet, and Open
  questions below). Building five-plus pages on the wrong palette is a full redo, not a
  polish pass, given `design-system.md`'s "Don't" list forbids mixing token-driven and pinned
  surfaces mid-page (the "auth-page bug").
- **`s17` has no declared dependency on `s02`,** which is correct per `stories.md`'s own graph —
  but it means `s17`'s own install/CTA copy cannot assume `s02`'s install-recipe module exists
  yet when this story executes; any cross-link to install instructions must degrade gracefully
  or point at what exists today.

## Open questions

- **Which palette do `/alternatives`, `/cms-for`, `/for`, `/agencies` use?**
  `architecture.md` groups them with "Marketing" (implying the legacy `sky-*`/`slate-*`/WebGL
  system used by `/`, `/demo`, `/privacy`, `/terms`). `design-system.md`'s evidence-based surface
  table and its own "Scope exceptions" list put the nearest actual precedent, `/blog`, under
  **App** (token-driven) — and the real blog code confirms that classification. Neither document
  states the cluster pages' palette directly. This needs a decision at `/ks-design`, not a
  default assumed here.
- **What are the numeric Core Web Vitals thresholds for AC 7?** Not stated anywhere in `prd.md`,
  `architecture.md`, or `stories.md`. "Passes... thresholds" needs a number (LCP/INP/CLS values,
  or a Lighthouse score floor) before it is testable.
- **Does `s17` need to anticipate `s18`/`s19`'s data shapes**, given the story frames itself as
  "the engine" they "ride on" ("if this needs new route code, `s17` was built wrong" —
  `s19`'s own notes)? The ACs only require the `/alternatives` cluster concretely; whether the
  typed-data/route abstraction must be generic enough for stacks (`s18`) and verticals (`s19`)
  from day one, or whether that generality is proven only when `s18`/`s19` actually land, is not
  stated.
- **Should the comparison table's claims (pricing, feature parity) be static copy or pull from
  live data** (e.g., `/api/pricing` for real Stripe amounts, given `s13`'s agency-plan work is
  itself unshipped and gated behind a "still open" PRD decision)? Not addressed by the ACs.
- **Could not verify:** whether any prior branch/commit already has partial cluster-page work in
  flight outside `main` — this research only inspected the current `main` tree, per the
  read-only, no-code scope of this command.

## Real complexity

**Stories.md score: 3** ("content-driven routes with structured data and generated sitemap
entries, no new integrations"). Having read the code, this holds, with one caveat.

Six of eight ACs are mechanically well-precedented extensions of patterns already proven in this
codebase: sitemap merge (AC 4, near-identical to `getBlogRoutes()`), 404-on-unknown-slug (AC 5,
identical to blog's `notFound()`), typed-data modules (AC 1/8, same shape as
`plan-types.ts`/`CONTENT_TOPICS`, just new content), `llms.txt` (AC 6, a static/generated text
response, no harder than `robots.ts`), the honesty/differentiation requirement (AC 2, content
work, not engineering), and JSON-LD (AC 3, genuinely new but a well-known, mechanically simple
Next.js pattern — inline `<script type="application/ld+json">` per page, no new dependency).

**AC 7 (Lighthouse CI) is the outlier.** Unlike `s06`'s byte-gate (which extends
`scripts/build-embed.mjs`, a script that already exists and already prints raw sizes), there is
*no* existing perf-budget mechanism anywhere in this repo to extend. It requires: a new CI job
that boots a real server (the `e2e` job is the only precedent for that shape), a Lighthouse
invocation across at least five new routes, and thresholds that don't exist yet in any doc. This
is bounded — it's one AC, not a cross-cutting concern — but it is a distinct, external-tooling
task riding inside an otherwise content-and-routing story.

**Verdict: keep at 3, flag AC 7 as the item most likely to consume the plan's time and risk
pushing execution into a 4-shaped afternoon even though the story doesn't need a full split.**
No split proposal — this is not a 5; AC 7 is boundable as a single task in `/ks-plan` (add
Lighthouse CI, define thresholds, wire it to the new routes) rather than a second story. Flag
that `/ks-plan` should either supply the numeric CWV thresholds itself or send the "what number"
question back up before task-breakdown, the same gap class stories-review already caught
elsewhere (m5, m8) but did not catch here since it doesn't name `s17`.
