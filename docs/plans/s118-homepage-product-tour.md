---
validated: yes
story: s118-homepage-product-tour
---
# Hero outline and screen-by-screen product tour

Goal: expose setup-to-history workflow before signup. Follow matching research/design docs.

- [x] Human validation: owner said “implement it” in this chat on October 19, 2026. New-story review remains part of independent review.
- [x] Add 10px block clearance to hero lines, adjusting min-height; retain scrolling and leave
      a comment explaining clipped outlines. Browser-verify both words/animation states at six
      widths, reduced motion, keyboard editing, long text and three-line layout.
- [x] Capture six fresh actual-component sample screens using Bella Vista and one hours change.
      Local Supabase was unavailable; use the bounded fixture-render fallback documented below.
      Auth/source unchanged; no production writes. Full backend journey proof is not claimed.
- [x] Implement ProductTour.tsx using existing primitives/scoped editorial styles: chapter buttons,
      image/caption, previous/next, full-image view, keyboard/failure states and responsive sizing.
- [x] Add hero “See how it works” anchor; compose tour directly before existing InteractiveHero.
      Preserve /demo, /product, pricing, signup and consent. No new backend/dependency/embed changes.
- [x] Verify selection/boundaries/keyboard/error and composition with targeted tests; use real
      browser checks for clipping and mobile readability. Preserve CI inventory requirements.
- [ ] Deferred, optional follow-up: recording only when actual video/poster/captions exist; native player,
      chapter seeking, no autoplay/download until requested, screenshot fallback.
- [x] Run lint, type-check, type-check:build, format:check, full tests, build and relevant existing
      browser gates; independent review before PR. Manual merge/deployment stays separate.

Files: landing EditableEditorialHero.tsx, EditorialHomePage.tsx, editorial-homepage.module.css,
new ProductTour.tsx and tests, public/brand/product-tour assets, matching docs.
Rollback: remove tour/anchor and restore spacing. No schema/API/permissions changes.

Status: hero/tour implemented. Actual production-build browser checks passed for initial and
final animated headline geometry at six widths, local editing/long-text scroll/reload reset,
all six chapter images, keyboard selection, dialog open/Escape and image-failure navigation.
Full Jest+coverage: 541 passed suites, 8074 passed tests, one existing skipped suite/two skipped
tests; lines 78.17%, statements 77.38%, branches 71.51%, functions 75.58%. Normal Node24
Turbopack production build passed. Full-image mobile readability corrected: native 1440px image pans within the dialog at 320/390px, without page overflow. Matching responsive image sizes requests sufficient resolution. Final fresh-browser check confirms native resolution, contained mobile scrolling and Escape focus restoration. Independent final review passed: Max severity none; Ship allowed yes.
No video or production deployment. Owner validation received October 19, 2026.

Capture adjustment: local Supabase was unavailable. The approved bounded fallback renders actual
product components with coherent sample data, identified as an Example walkthrough. These images
show the workflow states; they do not certify a real installation or backend publish/reload.
The screenshot release requires truthful sample-state provenance, not a new production write.
Optional owner recording and external backend journey proof remain distinct follow-ups.
