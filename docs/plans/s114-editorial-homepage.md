---
validated: yes
story: s114-editorial-homepage
---
# Implementation plan — editorial homepage

## Deliverable
New approved homepage at /, complete previous landing at /product, real working demo directly below editable hero, and canonical website design guide. Other subpage families are explicitly inventoried follow-ons rather than an unreviewed global restyle.

## Tasks
- [x] Add regression tests for root metadata/catalogue JSON-LD, /product metadata, existing anchor destinations and demo placement.
- [x] Preserve existing HomePage composition behind /product (self-canonical, Product overview title, sitemap entry); new homepage server wrapper retains SEO/catalogue behavior.
- [x] Add scoped editorial tokens/shell and optimized approved artwork. Reuse shared header/footer behavior without altering dashboard/widget styles.
- [x] Implement EditableEditorialHero: three stable lines, plaintext local editing, slow curved pointer site→website then stuck→done, small cursor, dashed hover, click/caret/typing; no hints/reset/replay or persistence. Stop on real interaction, reduced motion, visibility loss/unmount. No user copy in analytics.
- [x] Compose new landing with existing InteractiveHero immediately below; preserve pricing/catalogue/offer and signup behavior, features/pricing anchors and consent controls.
- [x] Test editing, paste/newlines, IME, focus, animation interruption, cleanup, reload reset; verify no requests/storage writes for hero edits and no competing offscreen demo animations.
- [x] Browser verification at desktop/mobile, reduced motion and keyboard: hero line count, no overflow, both demo edit flows, reset/reload, signup navigation, pricing, /product and /demo. Capture before/after evidence.
- [x] Run local lint, type-check, type-check:build, format:check, production build and full Jest suite; independent review completed.
- [ ] PR CI and its required security/migration replay gates remain pending the shipping phase; no remote CI success is claimed.

## Expected files
src/app/page.tsx; src/app/product/page.tsx; src/app/sitemap.ts; src/components/landing/EditorialHomePage.tsx, EditableEditorialHero.tsx and scoped style module; relevant header/footer variant files; approved optimized public/brand assets; colocated tests and e2e/landing specs; docs design/research/review.

## Constraints and rollback
No API, schema, billing or embed behavior changes; no new dependencies. Retain prior component for /product and straightforward homepage rollback. Hero experimental edits never persist. Reuse existing real demo rather than recreating it. Preserve existing legal text and pricing facts.

## Human validation
Approved explicitly by owner in chat October 15, 2026: s114 plan and /product route. Proceed with implementation.
