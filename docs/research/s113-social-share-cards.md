# Research — s113-social-share-cards

Date: 2026-10-13. Source baseline: `29fbc9dfc66fe8fe91954fe07a5ed708db71ecaf`.

## Premise correction

The source already defines Open Graph and Twitter metadata and image routes. This is a creative refresh, not a missing-tag repair. Production HTML was not independently retrieved in this pass; source evidence must not be presented as a fresh live-crawler result.

## Verified source

- `src/app/layout.tsx` supplies metadataBase and default Open Graph/Twitter metadata.
- `src/app/page.tsx` restates homepage canonical/Open Graph metadata.
- `src/app/opengraph-image.tsx` produces a 1200×630 PNG with `ImageResponse`, a teal code mark, product name, and generic one-script-tag copy.
- `src/app/twitter-image.tsx` re-exports that image and its alt, size and content type.
- `src/lib/seo/site-identity.ts` centralizes product SEO identity.
- Try, compare, installation and comparison-detail metadata explicitly reference `/opengraph-image` and `/twitter-image`; preserve these URLs.
- `src/__tests__/app/site-metadata.test.tsx` mocks ImageResponse and expects the current generic copy in its React element. Its visual-copy expectation needs an intentional update, not silent removal, when the new image ships.
- The existing validated s88 plan covers the SEO baseline, not this new creative.

## Product and design constraints

Freelance web designers and small agencies are the ICP. The benefit is client independence for everyday wording, without the freelancer surrendering layout/code work. Do not invent savings, revenue, endorsements, universal compatibility or real customer outcomes. The source screen is an actual ReCopyFast preview; retain its preview qualification.

Follow the captured identity in `docs/design-system.md`: dark ink, warm/light readable text, one deep-teal accent, and the existing code mark. No new dependency, auth, billing, migration or embed behavior is needed.

## Verification still required during implementation

Inspect rendered production-build HTML and both fetched image bodies; source metadata declarations and mocked tests alone do not prove a crawler can obtain the intended card. Social-platform cache refresh is separate from application deployment.

## Official framework contract, checked 2026-10-13

The [Next metadata-image convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image#returns) explicitly permits a default function returning `Response`. Keep the existing code-based image handlers, serve one bundled local PNG as a binary response, and retain the named `alt`, `size`, and `contentType` exports. The [local-assets example](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image#using-nodejs-runtime-with-local-assets) uses Node `readFile` relative to the project root; read this request-independent asset once at module scope. Do not add request APIs or force-dynamic configuration.

[File-based metadata has precedence](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#good-to-know) over configuration metadata. Therefore preserve handler files instead of introducing another conflicting image convention. Exact existing public URLs remain a repository contract to smoke-test, not a promise inferred from the framework docs. `size` does not resize raw PNG bytes; inspect actual dimensions. Keep the shared file below the stricter documented Twitter image ceiling of 5 MB. Deployment tracing and CDN response behavior require actual production-build/live checks.

Complexity: 2. Embed allocation: 0 bytes. No source implementation made in this research pass.
