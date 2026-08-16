# Research — Story s19-audience-pages

> Fresh-context research against the current code (2026-08-16), not against what the docs
> claim. `docs/reviews/stories.md` ends `Max severity: major` / `Stories ready: no`. Operator
> confirmed proceeding. `s19` itself is not named in any Major or Critical finding in that
> review — the one mention it gets is minor (`m6`, below).

## The five structuring facts

1. **No `/for` or `/agencies` route exists under `src/app/` today.** The directory contains
   exactly `api, auth, blog, dashboard, demo, edit, login, privacy, settings, signup, terms`
   plus the SEO/meta files (`sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.tsx`) —
   verified by listing `src/app/` directly. `s19` starts from zero, as its own notes say.
2. **`s17`'s engine — `s19`'s only declared dependency — also does not exist yet.** No
   `/alternatives` or `/cms-for` directory either, confirmed the same way. `s19` cannot be
   implemented, planned, or even meaningfully designed in isolation from `s17` landing first;
   any research or plan for `s19` is conditional on `s17`'s actual shape, not just its promise.
3. **The CTA destination "trial signup" resolves to an account with zero entitlements today.**
   `src/components/auth/SignupForm.tsx:43-49` sends a Supabase magic link and nothing else —
   no plan, no trial flag. `src/lib/feature-gating/permissions.ts:21-24`: *"An account with no
   plan is denied outright, before any quota arithmetic. There is no free tier to fall through
   to."* A visitor who completes `s19`'s CTA today gets an account that can create nothing.
4. **No JSON-LD / structured-data code exists anywhere in the repository.**
   `grep -rl "application/ld+json"` across `src/` returns zero files. `s19`'s "valid structured
   data" acceptance criterion (and `s17`'s `SoftwareApplication`/`FAQPage`/`BreadcrumbList`
   criteria it rides on) has no existing implementation to copy — this is new code however it
   lands, in `s17` or duplicated into `s19` if `s17` does not generalize the JSON-LD emitter.
5. **`design-system.md` and `architecture.md` disagree about which visual surface `s17`–`s19`
   belong to, and the one content-driven precedent in the code sides with `design-system.md`.**
   `design-system.md:17` places `blog` on the token-driven **App** surface ("✅ on-system").
   `architecture.md:307` groups *"Marketing → `/`, `/blog`, and the SEO clusters `s17`–`s19`
   will add"* under the WebGL **Marketing** surface, where `framer-motion`/Three.js/`lenis`
   "live here and only here." `src/app/blog/[slug]/page.tsx` — the actual code — uses plain app
   tokens (`bg-background`, `text-display`, `bg-surface-1`, `border-border`) and imports no
   `framer-motion`, no Three.js, no sky/slate palette. The code, not either doc, is the
   tiebreaker; see "Anchor points" for the resolution this implies for `s19`.

## Target story

**s19-audience-pages** — "pages for the people who actually buy." Complexity as scored in
`docs/stories.md:881-907`: **2**, "content pages on the existing engine."

Acceptance criteria (`stories.md:889-895`):
- [ ] `/for/<vertical>` renders for at least restaurants, dental-practices, law-firms and gyms.
- [ ] `/agencies/<use-case>` renders for at least client-content-updates and
      multi-site-management.
- [ ] Each vertical page names the content that actually changes for that business — hours,
      prices, menu, staff — not generic feature copy.
- [ ] Each page carries valid structured data and appears in the sitemap.
- [ ] Each page has one primary call to action leading to trial signup.
- [ ] No page duplicates another page's body content.

Dependencies (`stories.md:897-898`): **`s17-cluster-engine` only.**

Agentic notes (`stories.md:900-906`): runs on `s17`'s engine — needing new route code would
mean `s17` was built wrong; agency pages should use "the real arithmetic from `s13`'s
comparison against per-site pricing"; lowest complexity in the backlog and closest to revenue,
last only because it depends on the engine.

## Current state of the code

- **The engine (`s17`) is unbuilt.** No dynamic route under `/alternatives/<competitor>` or
  `/cms-for/<stack>`, no typed content-data module for either cluster, no JSON-LD emitter, no
  `llms.txt` route. Everything `s19` is supposed to "just ride" is presently a design intent in
  `docs/stories.md:811-846`, not code.
- **The one working precedent for a content-driven dynamic route + sitemap entry is the blog,**
  not a cluster page — `src/app/blog/[slug]/page.tsx` and `src/app/sitemap.ts`. This is the
  pattern `s17` is expected to generalize, per the team-lead brief, and it is the only real
  evidence of what "renders from typed/DB-backed content, appears in the sitemap automatically"
  looks like in this codebase today.
- **No vertical/industry data model exists anywhere.** `grep -rn "vertical|industry" src/lib
  src/types src/app` (case-insensitive) returns no hits relevant to business verticals — the
  closest matches are unrelated (`useFloatingPosition.ts`'s "vertical placement"). The four
  verticals in `s19`'s AC (restaurants, dental practices, law firms, gyms) and the two
  agency-use-cases (client-content-updates, multi-site-management) have zero code footprint:
  no copy, no data shape, no preset. This is pure content work once the engine exists.
- **No duplicate-content / similarity-checking tool exists.** `grep -rln "similarity|duplicate
  content|thin content"` across `src/lib` and `src/app` returns nothing. The "no page
  duplicates another page's body content" AC — the PRD's Helpful-Content thin-content guard,
  called out explicitly in the team-lead brief — has no mechanical assertion to inherit; see
  "Open questions."
- **The Agency plan (`s13`) does not exist in code.** `grep -n "agency" src/lib/stripe/plans.ts
  -i` returns nothing; the catalogue holds only `starter`, `pro`, `credits`, `lifetime_pro`
  (confirmed independently in `stories.md:671-673` and the PRD gap at `prd.md:392-393`). The
  branded-subdomain concept referenced by `s13` AC 8 has only a stub field,
  `src/types/index.ts:472` (`custom_domain?: string`), with no serving path — matches the
  stories-review's **M4** finding that this criterion was added to `s13` without a complexity
  bump and should split out.
- **The trial (`s01`) does not exist in code.** Confirmed above (fact 3) — `getEffectivePlan`
  denies any account with no plan, and nothing marks an account as trialling. `s19`'s "trial
  signup" CTA describes a product state that is not yet buildable.
- **`llms.txt` does not exist.** `find . -iname "llms.txt"` returns nothing. `s17` AC 6 owns
  standing this up; `s19` inherits it only if `s17` lists cluster pages there generically.

## Anchor points

- `src/app/blog/[slug]/page.tsx` — the dynamic-route precedent `s17`/`s19` will generalize:
  server component, `notFound()` on a missing slug, DB-backed lookup via
  `createClient()`/`supabase.from(...)`, plain `Header`/`Footer` composition, app-token classes
  throughout (`bg-background`, `text-display`, `bg-surface-1`, `border-border`), single CTA
  block at the bottom (`:108-133`, "Ready to transform your website?" → `/demo` and `/#features`
  — note it does *not* point at `/signup`, worth registering as the closest existing analog to
  `s19`'s "one primary CTA" requirement).
- `src/app/sitemap.ts` — `STATIC_ROUTES` constant array (`:34-42`) plus a DB-backed dynamic
  section (`getBlogRoutes()`, `:57-75`, mapped into sitemap entries at `:90-95`). A generalized
  `s17` engine implies `s19`'s vertical/agency slugs get a third block shaped like the blog one,
  reading from `s17`'s typed content module rather than a table — but that module does not
  exist yet, so this is a forward inference, not a verified fact.
- `src/app/robots.ts` — `disallow: ["/api/", "/dashboard/", "/auth/"]` only. `/for/*` and
  `/agencies/*` are not excluded, so they are crawlable by default once they exist — no
  robots-side blocker.
- `src/lib/feature-gating/permissions.ts:21-24` — the "no free tier" comment `s01`'s own
  agentic notes (`stories.md:142-143`) flag as stale once `s01` ships. Until then it is
  accurate and is why the CTA target is unresolved (fact 3).
- `src/components/auth/SignupForm.tsx` — magic-link-only signup (`:43-49`), no plan attached at
  any point. `src/app/signup/page.tsx` wraps it with no trial framing in the copy either
  ("Get started with ReCopyFast in just a few seconds").
- `src/components/layout/Header.tsx:147-153` — the sitewide "Get started" control opens an
  `AuthModal` rather than linking to `/signup` directly, and still carries the legacy
  `bg-sky-600`/`text-slate-600` classes even though `Header` is also rendered on the
  (on-system, per `design-system.md`) blog pages. Pre-existing condition, not something `s19`
  needs to fix, but relevant if `s19` reuses `Header` verbatim: the shared chrome is not fully
  surface-pure today.
- `src/components/landing/` (`HeroDemo.tsx`, `InteractiveHero.tsx`) and
  `src/components/landing/demo/*` (`BellaVistaSite.tsx`/`bellaVista.ts`,
  `PremiumAutoSpaSite.tsx`/`premiumAutoSpa.ts`, `SweetDreamsSite.tsx`/`sweetDreams.ts`) — three
  fictional demo businesses (a restaurant, a car-detailing shop, a bakery) used in the home
  page's "See It In Action" interactive demo. One of the three (Bella Vista, a restaurant)
  overlaps a vertical `s19` needs, but these components are `"use client"`,
  `framer-motion`-driven, parameterless, single-use, and imported only by
  `src/app/page.tsx`/`HeroDemo.tsx` — not composable content blocks. Do not reuse them for
  `s19`; they are evidence of what verticals look like as *interactive demo props*, not as
  reusable marketing sections.
- `src/components/sections/{Hero,Benefits,ValueProposition,HowItWorks,Pricing,FinalCTA}.tsx` —
  all six export a zero-argument default component (verified: `grep -n "export"` on all six
  shows `export default function X()` with no props in every case) and are imported only by
  `src/app/page.tsx`. They are the home page's narrative, not a component library — none is
  parametrized for "swap the vertical, keep the shape," and reusing them as-is would require
  either introducing props they do not have or forking them, which risks the exact thin-content
  problem (`s17`'s own trap, `stories.md:840-841`) `s19`'s last AC guards against.
- `src/components/ui/` (17 Radix-wrapped primitives, per `design-system.md:106-127`) — `Button`,
  `Card`, `Badge`, `IconTile`, `PageHeader` are the actual composable floor, and are what
  `blog/[slug]/page.tsx` draws from (`Badge` at `:70`). This, not `components/sections/`, is
  what `s19` should compose from if it lands on the App surface (see fact 5).

## Verified APIs / functions

- `resolveSiteUrl()` (`src/app/sitemap.ts:12-22`, duplicated identically in `robots.ts:12-22`)
  — canonical origin resolution. Any `s19` sitemap entries reuse this, not a new resolver.
- `getBlogPost(slug)` (`blog/[slug]/page.tsx:21-36`) / `getBlogRoutes()` (`sitemap.ts:57-75`) —
  the DB-backed pair `s17` is expected to generalize into a typed/static-content-backed pair for
  clusters. Neither has a cluster-shaped counterpart yet.
- `getEffectivePlan` (`src/lib/billing/entitlements.ts`, referenced from
  `permissions.ts:1-7`) — the chokepoint that currently denies every unplanned account. Not
  called from anywhere in the marketing surface today; would only become relevant to `s19` if a
  future revision makes the CTA display plan-aware copy (not required by the current AC set).
- `sanitizeHTML(html, "RICH_TEXT")` (`src/lib/security/content-sanitizer.ts`, used in
  `blog/[slug]/page.tsx:100`) — relevant only if `s19`'s content module stores raw HTML rather
  than typed/structured fields; `s17`'s AC 8 ("typed, validated data") suggests it should not
  need this, but the module does not exist yet to confirm.

## Traps & constraints

- **The dependency edge that matters most is not in the story text.** `s19` declares only
  `s17`. The CTA criterion ("leading to trial signup") depends on `s01-trial-signup`, which is
  on a structurally separate branch of the dependency graph (`stories.md:54-68`: `s01 ─┬─────>
  s03 ... └─> s13 ...`; `s17 ─┬─> s18 └─> s19` never touches it). This is the gap the team-lead
  brief anticipated and it is confirmed in code, not just in the graph: today's signup grants
  nothing, so a literal reading of the AC cannot be satisfied by a stranger clicking the CTA.
- **`m6` in `docs/reviews/stories.md:186`** already flags a second, softer gap: `s19`'s agentic
  notes ask agency pages to "use the real arithmetic from `s13`'s comparison against per-site
  pricing," but `s19` declares only `s17` — `s13` (Agency plan) may not exist when `s19` runs.
  Confirmed independently here: `s13` has zero code footprint (see "Current state").
- **Thin-content mechanics.** `s17`'s own trap (`stories.md:840-841`) says pages "differing only
  by a swapped noun get demoted under the Helpful Content system, and the demotion is
  site-wide." `s19` inherits this at higher risk than `s17`: four verticals × generic SaaS copy
  is a much easier trap to fall into than five named competitors, because competitor pages
  differ by definition (different product, different comparison table) while vertical pages
  share one product and only the vertical noun changes unless the copy genuinely varies by
  business type. The AC — "names the content that actually changes for that business — hours,
  prices, menu, staff" — is the guard, and it is a real content-authoring constraint, not a
  formality.
- **No mechanical test exists for "no page duplicates another page's body content."** This is
  the one AC in this story that is not obviously a `expect(response.status).toBe(200)`-shaped
  test. It needs either (a) a build-time or CI check that extracts each page's body text and
  asserts pairwise similarity below a threshold (e.g., word-shingle/Jaccard over the rendered
  text, excluding shared chrome), or (b) a narrower, cheaper proxy — e.g., asserting each page's
  typed content data has non-empty, distinct values in every vertical-specific field. Neither
  exists today; this is squarely a planning decision, not a research gap, but it is worth
  surfacing because the naive approach (eyeballing six pages) will not scale once `s18`'s eight
  stacks and `s17`'s ten-plus competitors are also live on the same site.
- **Surface choice is not free.** If `s19` follows `architecture.md`'s "Marketing" framing
  literally, it inherits `framer-motion`/Three.js/`lenis` eligibility — which directly threatens
  `s17`'s Lighthouse/Core Web Vitals AC (`stories.md:826`) that `s19` does not restate but
  clearly needs to keep meeting, since it is riding the same engine. The blog precedent shows
  the code has already resolved this in practice (no motion library, no WebGL, plain tokens);
  the story should follow the code, not the architecture doc's looser grouping. Flagged as a
  documentation drift for `/ks-architect` or `/ks-design`, not something to silently
  work around inside this story.
- **CTA copy risk, not just a broken link.** Even scoping the CTA to the existing `/signup`
  page (which does work, and produces a real account) rather than a not-yet-real "trial" flow,
  the AC's own word "trial" is currently false: there is no trial today, no framing of one in
  `SignupForm.tsx`/`signup/page.tsx`, and no time-boxing anywhere in entitlements. Shipping copy
  that says "start your 14-day trial" before `s01` ships would be a customer-facing lie the
  first person who reads it discovers immediately upon hitting the wall in
  `permissions.ts:21-24`.

## Open questions

- **Is `s19`'s CTA allowed to say "sign up" (accurate today) instead of "start your trial"
  (accurate only after `s01`), or must `s19` add a declared dependency on `s01` and wait?**
  Not resolvable from the code — this is a sequencing/copy decision for `/ks-plan` or the
  operator, not something the repository answers.
- **What will `s17`'s typed content module actually look like** (a TS const array, a JSON file,
  a DB table)? `s19`'s "no new route code" promise is only as strong as this module's design,
  which does not exist yet. Cannot be verified until `s17` is planned/built.
- **Does `s17` build a generic JSON-LD emitter `s19` can call, or only comparison-specific
  schema types (`SoftwareApplication`/`FAQPage`/`BreadcrumbList`)?** `s19`'s pages plausibly
  want `FAQPage` + `BreadcrumbList` but not `SoftwareApplication` per-vertical page (that schema
  describes the product, not the vertical) — possibly `LocalBusiness`-adjacent schema instead,
  which nothing in the story or the codebase specifies. Open.
- **Mechanical duplicate-content test approach** — flagged above under Traps as a real gap;
  which approach (similarity threshold vs. distinct-field assertion) is a planning call, not
  something the code currently answers either way.
- **Does the Agency plan (`s13`) need to exist before `/agencies/<use-case>` ships**, given the
  agentic note's request for "real arithmetic from `s13`'s comparison"? Or can the page ship
  with qualitative wedge copy only ("stop doing free copy changes for your clients," per
  `prd.md:355-357`) and add numbers later? Not resolvable from code; `s13` has zero footprint
  either way (see "Current state").

## Real complexity

**Re-scored: 2, unchanged from `docs/stories.md:887`.** The content-authoring and rendering
work itself — once `s17`'s engine exists — is genuinely a 2: typed data plus a template,
matching the story's own framing ("if this needs new route code, `s17` was built wrong").
Nothing found here contradicts that for the story's *own* scope.

What does not change the number, but must be resolved before `/ks-plan` treats this as
low-risk:

- The CTA's dependency on `s01` is real and undeclared. It does not make `s19` harder to build,
  but it does make one of its six acceptance criteria currently **unsatisfiable as literally
  worded** by any implementation, however simple. This is a scope/sequencing defect to raise at
  planning, not a complexity driver — the fix is either a copy change or a declared dependency,
  not more engineering.
- The duplicate-content AC needs a testing strategy invented from nothing, which is unusual for
  a 2 but is bounded (one small utility plus a threshold, not a subsystem).
- The entire story is blocked on `s17` shipping first in a way that matches its own promise
  (typed content, generic route, sitemap auto-inclusion) — confirmed unbuildable, not unbuilt by
  oversight.

No split proposal — the story is a 2, not a 5, and nothing found here changes its shape enough
to require one.
