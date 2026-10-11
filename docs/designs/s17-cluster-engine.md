# Design — Story s17-cluster-engine

Refreshed 2026-10-10. Implementation target is the shipped s37 `/compare` hub and
`src/components/compare/ComparisonPage.tsx`, under ADR020 and ADR032.

Reuse its pinned-light sky/slate Marketing frame, Header, Footer, breadcrumbs, comparison
rows, fit lists, integration note, native FAQ disclosure and attributed final signup CTA.
Preserve spacing, typography, Agency/Founding availability states and all four current URLs.
The three added comparisons use the same renderer with differentiated text and official
source links. No new component system, animation, decorative surface or route-specific layout.

The engine/schema migration should leave the existing four pages visually unchanged.
Verify before/after at mobile and desktop widths; new content must wrap without horizontal
page overflow and the comparison table must remain usable. Unknown slugs use the existing
marketing-compatible not-found behavior and a real HTTP404.

The adjacent HTML mockup is an archived design proposal for `/alternatives`; it is not a
source-of-truth override for today's renderer, theme pinning, routes or catalogue states.
All useful earlier work is preserved in the recovery snapshot linked by the plan.

When s79 integrates, keep native full-document signup/login links at Marketing→app policy
boundaries. Internal marketing navigation may keep Next links. Shared JSON-LD is nonvisual
and must describe the same content the user can read.

## Local browser evidence (2026-10-10)

Representative original viewport captures are preserved in
`docs/designs/s17-cluster-engine-evidence/`, with hashes and source boundaries in
`manifest.json`. The hub and existing Webflow comparison have desktop before/after
pairs; Contentful has a mobile after capture because that route is new. These are
local production-build observations using an unavailable catalogue fixture, not
deployment or live-price evidence. All seven routes were also checked at390×844
and1440×900 for links, breadcrumbs, four FAQs and document overflow; full captures
and navigation observations remain in the recovery evidence archive. Later review
repairs change shared JSON-LD wiring, registry validation and Lighthouse validation,
without changing the visible copy/layout represented by these captures.
