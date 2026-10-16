---
validated: yes
story: s115-editorial-demo-and-blog
---
# Implementation plan — editorial demo and blog

## Validation state

Approved explicitly by the owner in chat on October 16, 2026: “yes approve s115, go ahead and build the demo and blog pages.” Execute the concrete screen definition and plan below.

## Deliverable

Move `/demo`, `/blog` and `/blog/[slug]` into the approved cream/ink/teal editorial website without
changing their product or publication boundaries. The real in-memory demo stays real; the blog
continues to expose only deliberately published rows; one useful article remains a repository
draft until a human separately chooses to publish it.

## Tasks

- [x] **1. Lock the current behavioral boundaries before styling.** Extend the existing demo,
  blog-index, BlogPostList and blog-article suites so they explicitly pin editorial Header/Footer
  variants, one `InteractiveHero`, no credential/network/storage dependency, truthful “sample”
  wording, anonymous bounded published-only index reads, draft/archived exclusion, empty/error
  states, category keyboard behavior, article 404s for drafts, canonical URLs and Cookie settings.
  Run the focused suites red against each new expectation before implementation.
- [x] **2. Add the approved shared editorial content shell.** Implement only the reusable page
  frame, eyebrow/header rhythm, content widths, paper/ink/teal tokens, flat rules, buttons and
  readable article/card states defined by the s115 design. Reuse `Header`/`Footer`
  `variant="editorial"` and existing UI primitives; do not import homepage section composition,
  change global/dashboard/widget styles or add a dependency.
- [x] **3. Migrate `/demo` without recreating the product.** Apply the shell and approved copy to
  `src/app/demo/page.tsx`, call the designs samples rather than customers, preserve the three
  existing affordances and native signup document boundary, and mount the unchanged
  `InteractiveHero` exactly once at full usable width. Prove text/image editing, nested scrolling,
  attract-loop cancellation, focus, touch and no-token/no-API behavior with the focused tests.
- [x] **4. Migrate the blog index and its states.** Apply the editorial hierarchy to
  `src/app/blog/page.tsx` and `BlogPostList` while leaving `listPublishedPosts`, its anonymous
  projection/order/limit and `revalidate = 3600` unchanged. Style the category tablist, cards,
  dates, excerpts, empty state, read-error alert and real signup CTA; prove filtering and all three
  server states still work.
- [x] **5. Apply the approved article composition without changing content parsing.** Use a readable
  prose measure and responsive title
  scale, category/date/read-time metadata, back link and restrained demo/product action. Preserve
  the existing `RICH_TEXT` sanitization call, newline handling, explicit published-status query,
  deterministic dates, canonical generation, 404/noindex behavior and existing CTA destinations.
  Pin that script/event attributes remain inert. Long titles, links, code and allowed rich content
  must wrap without document overflow.
- [x] **6. Verify discovery, consent and responsive behavior.** Run canonical/sitemap, GA route,
  Footer consent and document-boundary tests. In a real browser check `/demo`, a populated/empty/error
  blog index fixture and a representative article at 320, 390, 768, 1280 and 1440 pixels, plus
  keyboard-only and reduced-motion modes. Capture proof that both the page and demo scroller remain
  usable and that no draft URL is discoverable.
- [x] **7. Complete repository gates and independent review.** Run focused Jest suites, full Jest,
  lint, type-check, type-check:build, format:check and production build. Keep the article file marked
  DRAFT; make no paid provider call or database/publication mutation. Submit the final story diff to
  `/ks-review s115-editorial-demo-and-blog`; shipping remains manual and requires its own passed
  review.

## Expected files

`src/app/demo/page.tsx`; `src/app/blog/page.tsx`; `src/app/blog/[slug]/page.tsx`;
`src/components/blog/BlogPostList.tsx`; one shared marketing-scoped editorial content module/style;
the colocated/integration/E2E tests named in research;
`docs/designs/s115-editorial-demo-and-blog.md`; story research/plan/review; and the existing
repository-only article draft under `docs/gtm/blog-drafts/`.

## Constraints and rollback

No new dependency, migration, API, auth, billing, embed or blog-admin change. Do not copy or fork
`InteractiveHero`. Preserve the anonymous index read, explicit article status filter, sanitizer,
human-publish workflow, canonical/sitemap source, analytics allowlist and Cookie settings. The
visual change is route-scoped, so rollback restores the three prior page compositions without
touching stored posts or publication state.

## Human validation

Owner validated this plan in chat on October 16, 2026 and requested a working preview. Publication and production deployment are not part of this approval.

## Execution evidence

Completed October 16, 2026. Focused s115 coverage passed 4 suites / 29 tests; preserved
demo/discovery/consent coverage passed 8 suites / 194 tests; the full repository run passed 537
suites and 8,025 tests (2 suites / 38 tests skipped). ESLint passed with 0 errors and 33 existing
warnings. `type-check`, `type-check:build`, `format:check` and the production build passed.

Playwright proved the real demo edit → save → reset path and measured no document overflow on the
demo or blog at 320, 390, 768, 1280 and 1440 CSS pixels. The configured preview had no published
blog row, so it truthfully showed the empty state. No representative article screenshot was taken:
the only prepared article remains a repository draft with publication explicitly unapproved, and
publishing it or adding a production-visible fixture was outside this story. The article's long
title, allowed rich content, wrapping, canonical metadata, published-only lookup and sanitizer
boundary were verified with repository fixtures. Full browser evidence and screenshot paths are in
`docs/verification/s115-browser-checklist.md`.
