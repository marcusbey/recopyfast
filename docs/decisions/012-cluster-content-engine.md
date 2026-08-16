# ADR 012 — Cluster content engine: typed static data + one route per cluster type

- Status: accepted
- Date: 2026-08-16
- Scope: story s17-cluster-engine

## Context

`s17-cluster-engine` must satisfy: *"Page content lives in typed, validated data, so adding a
competitor requires no new route code"* and *"Every generated page appears in `sitemap.ts`
automatically."* It also explicitly gates `s18-stack-recipes` and `s19-audience-pages`, whose own
research and design docs state the same promise for stacks and verticals/agency use-cases — and
`s19`'s notes go further: *"If this needs new route code, `s17` was built wrong — fix `s17`
rather than special-casing."*

`docs/research/s17-cluster-engine.md` confirms no existing pattern satisfies this cleanly:
`blog/[slug]/page.tsx` is DB-backed, sanitized rich-text HTML (not compile-time typed);
`blog/page.tsx` is a hardcoded literal array already drifted from the DB. Neither is "typed and
validated" in the sense AC 8 needs, and using either as the template would either reopen the
drift bug or fail the typed-data requirement outright. A decision has to be made once, here,
because `s18` and `s19` inherit it without re-deciding.

## Decision

Each cluster (`alternatives`, `cms-for`, `for`, `agencies`) is:

1. **One typed TypeScript data module** (e.g. `src/content/alternatives.ts`) exporting a
   `readonly` array of a closed, per-cluster entry type, plus a runtime validator that throws at
   module load if an entry fails its structural rules (e.g. fewer than 3 "where they win" items).
   This is the same shape precedent as `src/lib/stripe/plan-types.ts` and the `CONTENT_TOPICS`
   array in `src/app/api/blog/generate/route.ts` — composed, not invented.
2. **One dynamic route per cluster type** — `src/app/alternatives/[competitor]/page.tsx`,
   `src/app/cms-for/[stack]/page.tsx`, `src/app/for/[vertical]/page.tsx`,
   `src/app/agencies/[useCase]/page.tsx` — each a server component using `generateStaticParams`
   sourced from its own data module's slugs, and `notFound()` on an unresolved slug (the same
   mechanism `blog/[slug]/page.tsx:47` already uses).
3. **Shared, generic JSON-LD builders** in `src/lib/seo/json-ld.ts` —
   `buildSoftwareApplicationLd()`, `buildBreadcrumbListLd(items)`, `buildFAQPageLd(faqEntries)` —
   parameterized over plain `{question, answer}[]` / `{label, href}[]` shapes with no
   cluster-specific typing, so every cluster calls the same three functions instead of
   reimplementing JSON-LD per page.
4. **One sitemap block per cluster**, added to `src/app/sitemap.ts`, mapping the same typed
   array's slugs into sitemap entries — the identical array that feeds `generateStaticParams`
   feeds the sitemap block, so a new entry in the data file is automatically routed, sitemapped,
   and (for `s17`) listed in `llms.txt` with zero additional wiring.

"Adding a competitor/stack/vertical/use-case requires no new route code" means: a new entry in
an existing cluster's data file. A *new cluster type* still needs its own `[slug]/page.tsx` +
data module + sitemap block — that is the "engine" being ridden, not a single shared page for
every cluster type.

## Considered options

- **DB-backed content, following `blog/[slug]/page.tsx`.** Rejected: fails AC 8's compile-time
  "typed, validated" requirement outright, and reintroduces exactly the two-sources-of-truth drift
  `blog/page.tsx` (hardcoded array) vs. `blog/[slug]/page.tsx` (DB query) already has in this repo.
- **One generic catch-all route, `src/app/[clusterType]/[slug]/page.tsx`.** Rejected: the four
  cluster types render meaningfully different sections (comparison table vs. install snippet vs.
  content checklist vs. cost arithmetic) and different JSON-LD needs (whether `SoftwareApplication`
  applies, whether a table exists). A single route with heavy per-type branching would blur into
  exactly the "swapped-noun" thin-content shape the Helpful Content trap warns about, and would
  make each cluster's design doc harder to trace onto real code.
- **A runtime content-registry API route serving cluster content as JSON.** Rejected as
  unnecessary indirection — static generation from a typed array is faster, simpler, and already
  satisfies every AC without a network round trip.

## Consequences

- Adding the 6th, 7th, ... competitor, stack, vertical or use-case is a data-file diff only —
  reviewable, testable in isolation, no route/JSON-LD/sitemap code to touch.
- `s18` and `s19` reuse `src/lib/seo/json-ld.ts` verbatim; if either story finds itself writing a
  new JSON-LD builder instead of calling the shared ones, that is a signal this ADR's genericity
  assumption broke and needs revisiting, not a reason to fork silently.
- The four cluster types remain four separate route trees. A future story wanting a unified
  cross-cluster index (e.g., "all programmatic pages") needs its own aggregation, since no shared
  registry object exists beyond the sitemap merge.
