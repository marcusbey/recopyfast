---
validated: yes
---
# Plan — s113-social-share-cards

Research: `docs/research/s113-social-share-cards.md`.
Design: `docs/designs/s113-social-share-cards.md` and its adjacent asset directory.
Baseline: `29fbc9dfc66fe8fe91954fe07a5ed708db71ecaf`.

## Outcome

A shared ReCopyFast URL shows approved concept C v2: **You built the site. Now you’re stuck updating it.** The payoff is **Let clients edit the words. Make time for the work that matters.** The editorial request loop makes the freelancer content-update bottleneck visible. Concepts A and B stay available as campaign assets. Existing OG/Twitter routes, canonical URLs and unrelated product behavior remain stable.

## Scope and decisions

Use one immutable local 1200×630 PNG (concept C v2) for both existing metadata image handlers. Deterministically package the owner-approved 1730×909 preview to the exact route contract without cropping or editing its creative. Retain `opengraph-image.tsx` and the Twitter re-export to preserve the established public paths. Return the bundled PNG bytes with a PNG content type, using the documented Node local-asset pattern; do not add an image-generation service, dependency, request-time network fetch or dynamic rendering requirement. Keep existing SEO titles/descriptions/robots unchanged. Update only the image alt text to match the actual visual.

No dashboard, customer embed, auth, billing or database change. Embed allocation: 0 bytes. Implementation and PR preparation are approved. Merge and deployment remain subject to the repository manual ship strategy.

## Tasks

- [x] **1. Lock the intended image contract with focused tests.** Intentionally replace the old generic-card text expectation in `src/__tests__/app/site-metadata.test.tsx` with behavior checks for the approved image/alt and both image handlers. Preserve the existing SEO identity assertions. Check nonempty PNG signature, actual 1200×630 dimensions, shared bytes and the <5 MB common ceiling; a mocked ImageResponse element alone is insufficient.
- [x] **2. Integrate the approved immutable asset.** Package concept C v2 from `docs/designs/s113-social-share-cards/concept-c-developer-bottleneck-preview-v2.png` as the exact 1200×630 `og-c-developer-bottleneck-1200x630.png`, then copy it to a versioned local asset path used by the handler. Update `src/app/opengraph-image.tsx` to return the local bytes with accurate alt, size and contentType; retain or adjust `src/app/twitter-image.tsx` only to preserve its complete export contract. Keep the original generic implementation recoverable in Git. Verify asset tracing in the production build.
- [x] **3. Verify the real share surface.** Against a production build, fetch `/opengraph-image` and `/twitter-image`, inspect actual response bytes/MIME/dimensions, and inspect rendered metadata for `/`, `/try`, `/compare`, `/docs/install`, plus one existing comparison detail. Resolve any conflicting manual image metadata without broad unrelated SEO edits. Review the returned image at full and thumbnail size. Run required lint, type checks, formatting, build and tests.
- [ ] **4. Independent review and ship handoff.** Run the repository review gate and open the single story PR. Preserve manual merge strategy. After owner merge/deployment, verify actual production HTML/image responses and record that third-party cached previews may need their normal refresh tools. Do not call an asset file or passing local test a live social-preview update.

## Anticipated files

- `src/app/opengraph-image.tsx`
- `src/app/twitter-image.tsx` only if required by the shared export contract
- One versioned PNG asset under a local production asset path
- `src/__tests__/app/site-metadata.test.tsx` and a focused response/build check as appropriate
- These story research/design/plan/review documents

## Acceptance evidence and rollback

Save production-build image hashes, actual dimensions/type, representative rendered meta tags and a thumbnail screenshot. Final live verification is separate from local checks. Rollback is the story commit or the previous default image handler/asset; no data migration is involved.

## Validation checkpoint

Owner explicitly approved Concept A and this plan on 2026-10-14: “Approve Concept A and plan”. This records the human validation required before implementation.

The owner then selected concept C's developer-bottleneck direction, requested the stronger payoff
“Let clients edit the words. Make time for the work that matters.”, and explicitly approved the
resulting v2 image on 2026-10-14 with “looking good.” This supersedes A/B visual selection only;
the validated route, packaging, metadata, verification, review, and ship boundaries are unchanged.

## Implementation evidence

- The approved v2 preview hashes to `530304c173f02780733dc825b6c30840abb3d1aeea9d239aa92a433757e4bde3`. Two independent deterministic exports produced the same 1200×630 RGB PNG hash: `1dabbbe9442e487dd905b03026b43e0fd5216099a750c4d0f1fd1ad114577741` (984,757 bytes).
- Both production trace manifests include `src/app/assets/recopyfast-social-card-developer-bottleneck-2026-10-14.png`.
- A production server returned both image routes as HTTP 200 `image/png`, 1200×630, with the approved v2 export hash. `/`, `/try`, `/compare`, `/docs/install`, and `/compare/webflow-editor` all returned HTTP 200 with the expected OG and Twitter image metadata.
- Full-size and 320×168 review preserved the approved headline, stronger payoff, request loop, and freelancer desk. The retained v2 thumbnail proof is `docs/designs/s113-social-share-cards/og-c-developer-bottleneck-thumbnail-320x168.png` (`12851f582bac7f5ff60bcbb114c32ff2195fccba1312888456070506338a3703`).
- Focused tests, type-check, format check, lint (0 errors; 33 existing warnings), and production build passed. The full Jest run passed 7,999 tests and failed one test outside this story: `src/__tests__/api/content/[siteId]/route.test.ts` expects a non-null CORS header for a first-party response. The same test fails identically on the clean baseline commit `29fbc9dfc66fe8fe91954fe07a5ed708db71ecaf`; s113 does not touch that route or test.
