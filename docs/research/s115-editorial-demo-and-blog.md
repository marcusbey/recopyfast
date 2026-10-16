# s115 — editorial demo and blog research

Status: verified against `feature/s114-editorial-homepage` on 2026-10-16. The checkout contains
another agent's uncommitted s114 hero/CSS/E2E work; this report does not alter or interpret those
files as completed. Implementation belongs on `feature/s115-editorial-demo-and-blog`, based on the
reviewed s114 result. Scope is only `/demo`, `/blog` and `/blog/[slug]`.

## Design source and boundary

- `docs/design/editorial-website-guide.md` is the owner-approved website direction: cream paper
  `#f7f3e9`, ink `#142024`, teal `#287f7c`, subtle rule `#d9d3c6`, serif marketing headings,
  sans-serif controls and long prose, flat surfaces, 5–6% gutters, and 56px/88–96px mobile/desktop
  section rhythm.
- `Header` and `Footer` already accept `variant="editorial"`. Their behavior is more than styling:
  Header reads `AuthContext`, uses native document navigation at login/signup security boundaries,
  and resolves feature/pricing anchors; Footer conditionally exposes Cookie settings only when GA
  is configured and both the document and current route are eligible. Reuse them rather than
  introducing a second navigation or footer.
- The existing homepage CSS module is composition-specific. Reuse its documented tokens and
  rhythm, not its homepage section names. A small shared editorial content module is preferable to
  duplicating route-local hex values, but it must remain marketing-scoped and must not alter the
  dashboard or installed widget.
- `docs/designs/s115-editorial-demo-and-blog.md` and its low-fidelity HTML reference define the
  three responsive route compositions. The route behavior below is the non-visual contract that
  design cannot change.

## `/demo`: one real, local experience

- `src/app/demo/page.tsx` is a client page. It renders shared Header/Footer, introductory copy,
  `InteractiveHero`, three affordance explanations and a native `/signup` CTA.
- `src/components/landing/InteractiveHero.tsx` is the real demo used on the homepage. Its text and
  image edits live in React state. `src/__tests__/integration/demo-page.test.tsx` pins the incident
  that removed a hard-coded staging token: no embed script, site id, token, staging query or widget
  endpoints may return. It also asserts stable editable ids and more than five real editable
  elements.
- `InteractiveHero.attract.test.tsx` supplies its own controllable IntersectionObserver because the
  global Jest mock never intersects. It pins that the attract loop stops after the visitor scrolls
  or points at the demo. A restyle must not wrap or replace the component in a way that defeats
  those visibility and interaction boundaries.
- `src/app/demo/layout.tsx` owns the `/demo` canonical because a client component cannot export
  metadata. `src/app/sitemap.ts`, `src/lib/analytics/google-analytics/routes.ts`, canonical tests and
  GA tests already include `/demo`.
- Current page copy says “Three customer sites, three different designers.” These are sample
  layouts in an in-memory demo; calling them customers is not evidenced. The migration should say
  “three sample sites” (or the approved equivalent) and retain no-test-account/no-install clarity.

## `/blog`: public rows only, with three honest states

- `src/app/blog/page.tsx` is a server component with `revalidate = 3600`. It calls
  `listPublishedPosts`, then renders one of three states: list, empty, or read error. The old fake
  newsletter form is already gone; the current CTA goes to `/signup`.
- `src/lib/blog/published-posts.ts` uses the cookie-less anonymous client, explicitly filters
  `status = 'published'`, orders dated posts newest first with NULLs last, and limits the response
  to 100. `src/__tests__/app/blog-index.test.tsx` proves it never uses the cookie or service-role
  clients, never lists draft/archived rows, retains empty vs error semantics, and regenerates on the
  sitemap schedule.
- `src/components/blog/BlogPostList.tsx` owns client-side category filtering. Categories are derived
  from returned posts. The control is a `tablist`; the visual migration must preserve its accessible
  names, selected state, wrapping behavior and deterministic server/client date formatting.

## `/blog/[slug]`: publication and content-rendering boundaries

- `src/app/blog/[slug]/page.tsx` reads through the signed-in server client but adds an explicit
  `status = 'published'` filter. This second boundary matters because a platform admin's RLS session
  can read drafts. `src/app/blog/[slug]/__tests__/page.test.tsx` proves a draft slug returns 404 and
  a published row renders.
- The page computes read time, formats the date with the shared deterministic formatter, sets its
  own canonical, and passes article content through `sanitizeHTML(..., "RICH_TEXT")` before using
  `dangerouslySetInnerHTML`.
- The generation path returns Markdown (`src/lib/blog/generate-post.ts`), while the article page
  currently replaces newlines with `<br />` before sanitizing. That pre-existing format mismatch is
  real, but this story is the requested route design migration, not a content-parser change. s115
  preserves this flow and the `RICH_TEXT` sanitization boundary. The repository draft stays Markdown
  for human review; a separate content-pipeline story can resolve semantic Markdown rendering.
- Do not touch `src/app/api/cron/generate-blog-post`, `src/app/api/blog/generate`,
  `src/app/api/admin/blog/posts`, migrations or `docs/operations/blog.md`. s89's durable-claim and
  human-publish controls are the reason a model-generated draft cannot become public by itself.

## SEO, consent and responsive checks

- `/demo`, `/blog` and `/blog/[slug]` already have canonical coverage; the sitemap includes the
  fixed routes and only published blog slugs. Restyling must not introduce a second data source or
  manually add draft URLs.
- All three routes are on the GA marketing allowlist. Shared Footer owns Cookie settings; using the
  editorial variant must retain that control and its focus behavior.
- Browser verification should cover 320, 390, 768, 1280 and 1440 widths. `/demo` contains its own
  nested scrollable sample site, so both document overflow and inner demo usability must be checked.
  Blog cards must wrap without clipping; article prose, tables/code and long links must not force
  document overflow. Reduced motion and visible keyboard focus are part of the inherited guide.

## Draft content handoff

`docs/gtm/blog-drafts/who-owns-website-copy-after-launch.md` is a repository-only editorial draft.
It is intentionally outside the production database. Publishing still requires the s89 human
review flow; this planning work makes no provider call, database write or external publication.

## Expected implementation surface

Likely source files: `src/app/demo/page.tsx`, `src/app/blog/page.tsx`,
`src/app/blog/[slug]/page.tsx`, `src/components/blog/BlogPostList.tsx`, one marketing-scoped shared
editorial content stylesheet/component. Likely tests:
the existing demo integration/attract suites, blog index/article/List suites, canonical/sitemap and
analytics/footer regressions and public-page E2E.
No API, database, billing, embed or auth implementation file is in scope.
