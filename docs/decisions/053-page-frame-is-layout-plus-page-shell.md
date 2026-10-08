# ADR 053 — The page frame is the dashboard layout plus one `PageShell` per page

- Status: accepted
- Date: 2026-10-08
- Scope: story s66b1-app-shell (split from s66b-app-page-layout); consumed by s66c-site-page-and-access
- Numbering: 050 and 051 are on `main` (s66a). s66c, planned in parallel, may take 052. 053 is the
  next number that cannot collide. Renumber at merge if another ADR lands first.

## Context

The owner asked for every app page to share one layout and one left edge (2026-10-07, quoted in
s66a). The shell values are already decided (`docs/design-system.md` § Shell): a 56 px header,
content up to 1180 px wide, gutters of 16 / 24 / 32 px, one h1 at 24/600 per page.

`src/app/dashboard/layout.tsx` already draws a frame: sidebar, sticky header, and
`max-w-[1180px] px-4 sm:px-6 lg:px-8`. Everything inside the frame is left to each page, and each
page has done it differently. Re-verified on `d4dae46`, after s66a merged:

| Page | How it titles itself |
|---|---|
| Overview, Sites | `PageHeader`, h1 `.text-display` (26–32 px clamp) |
| Billing | its own h1 `.text-display`, inside `container mx-auto px-4 py-8`: 16 px right of every other page |
| Content, Settings | a local h1 at 30/700 |
| Analytics | an h2 at 24/700 and no h1; during the sites fetch, a spinner and no title at all |
| Site detail | an h3 inside a card |

`PageHeader` existed the whole time. It was a convention, and a convention did not hold.

A second force arrived on 2026-10-08. The owner gave s66c everything under `/dashboard/sites`,
and the coordinator asked s66b for the shared page frame that s66c builds on. Two stories now
depend on one contract, so the contract has to be a component and a test, not a habit.

## Decision

The frame has two owners, and each one owns one thing.

1. **`src/app/dashboard/layout.tsx` owns width and gutters**, and nothing else may:
   - the sidebar (256 px), the 56 px header, `max-w-[1180px]`, and gutters of 16 / 24 / 32 px;
   - no page sets a page-level `container`, `max-w-*` + `mx-auto`, or horizontal padding.
2. **`src/components/ui/page-shell.tsx` owns the page.** Every routed page under
   `src/app/dashboard/` renders its content through exactly one `PageShell`, directly or
   through one listed delegate component. `PageShell`:
   - renders `PageHeader`, which holds the page's only h1, in a new `.text-page-title`
     (24/32, 600, −0.015em);
   - exposes the slots a page header needs: `eyebrow`, `meta` (beside the title), `description`,
     `actions`, and `nav` (a sub-navigation under the header, for s66c's site page);
   - sets the vertical rhythm: 24 px between the header and each section, 16 px below 640 px;
   - stamps `data-page-shell` on its root. Its direct children are the page's sections, and
     each of them starts at the content's left edge.
3. **Standalone app pages are outside the frame.** `/login`, `/signup`, `/auth/error` and the
   `/edit` hub keep their centred `max-w-md` column. Each renders exactly one h1 in
   `.text-page-title`.
4. **A test enforces it, not a reviewer.**
   - `src/__tests__/design/page-shell-guard.test.ts` scans the source:
     - every routed dashboard page (or its delegate) renders `<PageShell`;
     - `<PageHeader` is rendered nowhere except inside `ui/page-shell.tsx`;
     - no `<h1` exists on the app surface outside `ui/page-header.tsx` and the four
       standalone pages;
     - no `container` utility exists on the app surface.
   - `e2e/app-layout.spec.ts` measures the result at 375, 768, 1280 and 1920 px: one h1 per
     page, one h1 left x per width across pages, and every direct child of `[data-page-shell]`
     on that x.

`.text-display` is not repurposed. It stays byte-identical for `/blog`, as
`src/__tests__/design/globals-css.test.ts` requires since s66a.

## Considered options

- **Keep the convention: `PageHeader` exists, pages should use it.** Rejected. It existed while
  four title styles and Billing's second container grew. Nothing failed when a page skipped it.
  The harness also cannot find a page's root without a marker, so it cannot check the left edge.
- **Title from route data in a layout** (per-route-group layouts, or a title map keyed by
  pathname). Rejected. Titles depend on client state: the Overview greeting uses the user's
  name, and s66c's site page uses the site's name. Actions are page state too: Billing's
  "Change plan" opens a dialog that `BillingDashboard` owns. A layout would need all of that
  pushed up into it, or a context to carry it.
- **A `PageShell` that also sets width and gutters.** Rejected. Two components would then
  both set the content box, which is how Billing ended up 16 px off: a page container inside
  the layout's. One owner per concern is the point of this ADR.
- **Change `.text-display` to 24 px fixed** (the story's first wording). Rejected. `/blog` uses
  it, and s66a pins it byte-identical as a marketing-shared helper. A new utility repaints
  nothing outside the app.

## Consequences

- **Easier.**
  - A new page cannot ship without a title: the guard fails first.
  - s66c builds its site page on the same header, with the `meta` and `nav` slots, instead of
    hand-rolling one that s66b would later rewrite.
  - The harness has one selector (`[data-page-shell]`) for "this page's sections", so "one left
    edge" is measured rather than eyeballed.
- **Harder.**
  - Pages with several early returns (Content: 3, Analytics: 4, Billing: 5, plus its Suspense
    fallback) are restructured into one `PageShell` with a state-switched body. The diff is
    larger than a title swap.
  - Until s66c merges, `src/app/dashboard/sites/page.tsx` sits on the guard's pending list,
    which may only shrink. s66c empties it.
- **Watch.**
  - Never wrap `PageShell` in a page-level container. The guard's `container` rule catches the
    Tailwind utility only; `max-w-* mx-auto` on a page root is caught by the harness's left-edge
    check, not by the source scan.
  - A page that wraps its sections in one extra `div` passes the left-edge check vacuously:
    that div is the only direct child. The harness therefore also requires at least two direct
    children (the header and one section).
  - `PageHeader` is still exported, because `SectionHeader` lives in the same file and Overview
    uses it. Rendered outside `PageShell`, it would add a second h1 that the h1 rule cannot see
    (the h1 is written in `page-header.tsx`). That is why the guard also forbids `<PageHeader`
    outside `page-shell.tsx`, and why the harness counts h1s at runtime.
