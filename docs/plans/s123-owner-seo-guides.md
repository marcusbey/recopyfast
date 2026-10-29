---
validated: yes
story: s123-owner-seo-guides
---
# Owner guides cluster (/guides)

Validation source: Owner request 2026-10-25: 'Build owner-intent SEO pages (e.g. update website hours without a developer, edit WordPress text without Elementor) linking to /for/owners, with DataFast goals, reviewed and merged.'

Branch `feature/s123-owner-seo-guides` from `origin/main` `6eeedceb`. Embed allocation 0 bytes.
Research: `docs/research/s123-owner-seo-guides.md`. Surface: Marketing (ADR 020), same layout
language as `/compare`. Route base `/guides` (no collision; `/blog` is DB drafts, `/docs` is
product documentation).

- [x] `src/lib/guides/guide-registry.ts`: types (rich text with inline links), module-load
      validator (slugs, required fields, ≤160-char descriptions, ≥3 sections, ≥3 FAQs, HTTPS
      sources, external links only to listed sources, internal links only to known routes or
      other guides, related slugs exist, banned phrases, declared DataFast location), metadata,
      UTM + CTA helpers.
- [x] `src/lib/guides/guides.ts`: five guides, sources from the brief plus vendor help pages.
- [x] `datafast-goals.ts`: `guides_index` and `guide_<slug>` locations, `dataFastGuideLocation`.
      ADR 074 cta_click row + amendment.
- [x] `json-ld.ts`: `buildArticleLd` (organisation author/publisher, `dateModified` only).
- [x] `src/components/guides/`: `GuidePage`, `GuideCta`, `GuideRichText`; template-level
      "How it works, honestly" note on every guide.
- [x] Routes: `src/app/guides/page.tsx`, `src/app/guides/[slug]/page.tsx`
      (`generateStaticParams`, `dynamicParams = false`, no revalidate → SSG).
- [x] Wiring: sitemap, llms.txt, footer, `/for/owners` FAQ link, GA allowlist + privacy list,
      CSP boundary-file list.
- [x] Lighthouse: `buildGuideLighthouseUrls` (index + first guide) appended to the run plan;
      workflow job renamed to 10 routes; contract test updated (8 → 10 routes, 40 → 50 reports).
- [x] Tests: registry + validator negatives, CTA UTMs/locations, route static params and
      hostile slugs, page renders (heading order, caveat, sources rel, CTAs, JSON-LD, related),
      index, footer, sitemap, canonicals, llms.txt, GA routes, Article builder, goal taxonomy.
- [ ] Gates: lint, type-check, format:check, full Jest, production build; independent review.
