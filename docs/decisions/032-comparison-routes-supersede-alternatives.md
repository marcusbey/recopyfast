# ADR 032 — Comparison routes use `/compare`, superseding `/alternatives`

- Status: accepted
- Date: 2026-09-25
- Scope: s37-comparison-pages; comparison-cluster inheritance in s17-cluster-engine
- Authority: operator-prevalidated narrow fix mode 2 for PR #34
- Partially supersedes: [012](./012-cluster-content-engine.md),
  [013](./013-lighthouse-ci-thresholds.md), and
  [020](./020-seo-clusters-on-marketing-surface.md), as specified below

## Context

The operator selected `/compare` and `/compare/*` for s37. Earlier cluster ADRs
use `/alternatives` and `/alternatives/*`. Appending that change to accepted ADR
020 violated the immutable-decision rule; its original body is restored. This
new ADR records the decision without editing ADRs 012, 013 or 020.

Numbering was checked against fetched `origin/main`, all local branches and all
fetched remote branches. s34 already owns 031; 032 is the next unused number.

## Decision

1. `/compare` and `/compare/<competitor>` are the canonical comparison URLs.
   These replace the comparison-cluster `/alternatives` spelling in ADRs 012,
   013 and 020. Do not publish a duplicate `/alternatives` cluster. s37 currently
   provides webflow-editor, duda, tinacms and cloudcannon.
2. ADR 020's Marketing surface decision remains in force, including s37:
   pinned light, slate/sky palette, no mixing with App surface tokens.
3. s37's four explicit route wrappers are an interim delivery. s17 must replace
   them with `src/app/compare/[competitor]/page.tsx`, `generateStaticParams`
   from typed validated content, and `notFound()` for unresolved slugs, as ADR
   012 prescribes. Preserve the four existing URLs, metadata and distinct content
   while expanding coverage; do not keep explicit wrappers shadowing the new
   dynamic route. s17 also owns the shared JSON-LD builders and runtime content
   validator required by ADR 012. The current shared renderer and generated
   sitemap are inputs to that work, not proof that s17's engine is complete.
4. ADR 013's future Lighthouse CI gate moves to `/compare` and every seeded
   `/compare/*` URL, including the four s37 pages and s17 additions. Its numeric
   thresholds and shared-job requirements remain unchanged. s37 does not claim
   to implement or pass the still-outstanding s17 Lighthouse gate.
5. `SoftwareApplication` JSON-LD required by PRD Technical SEO is explicitly
   deferred to s17's `buildSoftwareApplicationLd()` and shared schema work.
   s37 retains FAQPage and BreadcrumbList. s17 must use only verified fields,
   omit invented reviews/ratings, and emit offers only when supported by the
   currently available catalogue. This deferral does not mark the PRD or s17
   structured-data acceptance criterion complete.
6. The four detail pages revalidate every 300 seconds. Their displayed database
   catalogue prices and Founding availability can lag by five minutes, matching
   the public pricing feed's cache interval. The Agency kill-switch rollback
   follows the existing redeploy procedure, which invalidates cached pages.

## Considered options

- Keep `/alternatives` or publish both names: rejected because it contradicts
  the selected route and creates duplicate comparison content.
- Edit accepted ADRs in place or disguise the decision as an erratum: rejected
  by AGENTS.md and the decision-versus-pointer boundary in `errata.md`.
- Build the full s17 cluster engine and schemas during this fix: rejected as
  scope expansion. The route, validator, schema and Lighthouse work stays
  explicit in s17 instead of being silently dropped.

## Consequences

Readers of ADRs 012, 013 and 020 apply this supersession only to the comparison
route spelling and the explicitly staged s17 work above. Other clusters and
all other decisions remain intact. s17 inherits stable public URLs; s37 remains
a narrow comparison-page delivery with the engine and schema gaps recorded.
