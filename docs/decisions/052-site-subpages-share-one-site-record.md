# ADR 052 — A site's subpages are nested routes that share one site record

- Status: accepted (pending owner validation of the s66c plan)
- Date: 2026-10-08
- Scope: story s66c (s66c1-site-pages; s66c2-quick-setup builds on it)

## Context

The owner, 2026-10-07: "/dashboard/sites is overwhelming. have multiple levels of settings." And
2026-10-08: "u need to have subpages to it. steps for user with advanced or quick setting."

Today a site has no URL. "View Details" swaps the Sites page for `SiteDetailView` in component
state (`src/app/dashboard/sites/page.tsx:303-319`): 11 stacked cards, about 4,400 px tall at 1280,
the install snippet three times. Back leaves the dashboard; nothing can be bookmarked or linked
from the activation checklist, the registration panel or the install guide.

Four forces shape the replacement:

1. **The owner asked for subpages**, deep-linkable, with Back and Forward working.
2. **An App Router layout cannot pass props to its pages.** The site header (name, status,
   "Edit website") and the subpages all need the same site.
3. **The site record carries install credentials** (`siteToken`, `embedScript`, minted per request
   by `GET /api/sites` for admins only, `src/app/api/sites/route.ts:169-181`). `SiteDetailView`
   keeps them in one state object on purpose (`:215-218`): after "Regenerate snippet" the old token
   is revoked, and a second copy left in a less visible surface would hand the owner a dead
   snippet. Its guards (site switch, permission loss on refresh, late rotation result) are pinned
   by `SiteDetailView.test.tsx:298-516`.
4. **The s66b page-shell contract** (ADR 053, on the s66b branch): every routed dashboard page
   renders `<PageShell>`; the site sub-navigation goes in its `nav` slot.

## Decision

Nested segment routes under one client provider:

```
src/app/dashboard/sites/[siteId]/
  layout.tsx            server: awaits params, renders <SiteProvider key={siteId} siteId>
  page.tsx              Overview   /dashboard/sites/<id>
  install/page.tsx      Install    /dashboard/sites/<id>/install
  people/page.tsx       People & access  /dashboard/sites/<id>/people
  settings/page.tsx     Settings (advanced)  /dashboard/sites/<id>/settings
```

- `SiteProvider` (client, `src/components/dashboard/site/SiteProvider.tsx`) fetches
  `GET /api/sites` once per visit to the site, selects the site by id, re-polls every 5 s while
  the site is awaiting install (moved from the Sites page), and owns the credential state and
  `regenerateSnippet()` with the guards `SiteDetailView` has today. It exposes them through
  `SiteContext` / `useSiteContext()`.
- The provider renders loading, error and not-found itself, each through `PageShell`, so a page
  never renders without a site.
- It is keyed by `siteId`. Moving from one site to another remounts it, so no credential can
  cross sites, whatever the router does with the segment.
- Each subpage is a client page that reads the context and renders
  `<PageShell title meta description actions nav={<SiteSubnav />}>`.
- `SiteSubnav` is a `<nav>` of four links with `aria-current="page"`. Links push history, so Back
  and Forward walk the subpages and Back from Overview returns to Sites.

The context is scoped to this route subtree. It is not app-wide state and is not mounted
anywhere else.

## Considered options

- **One page with `?tab=install|people|settings`** (the story's first wording). Rejected. The owner
  asked for subpages after that wording was written. One client component holding four panels is
  `SiteDetailView` again. And s66b's `PageShell` `nav` slot is designed for per-site subpages.
- **Each subpage fetches its own copy** (a `useSite(siteId)` hook per page, no context). Rejected:
  - every subpage switch would re-run `GET /api/sites`, which aggregates per-site stats in
    batches;
  - two copies of the install credentials can disagree after a rotation. That is exactly what
    `SiteDetailView`'s single credentials object exists to prevent.
- **A new `GET /api/sites/[siteId]`.** Rejected for this story: it is an API change, and the
  story is UI-only. A plan allows at most 5 sites, so selecting from the list costs nothing
  material. A single-site endpoint can replace the fetch later, behind the same provider, without
  touching a page.
- **Server components fetching on the server.** Rejected: dashboard server state is a client fetch
  hook (ADR 005), and credentials are minted by the route per request, so the client would refetch
  them anyway.
- **Keep the component-state swap.** Rejected: no URL, no Back, and the 4,400 px page the owner
  called overwhelming.

## Consequences

- This adds a second React Context. AGENTS.md § React requires a reason for that, and this is the
  reason: a layout cannot hand data to its pages, and the credentials must exist exactly once.
  Any future per-site page joins this subtree. It does not add a provider of its own.
- The install poll lives on as long as the owner stays on the site (any subpage). It stops when
  the site goes live and when they leave the site. That narrows today's rule ("only while the
  detail view is open") to the same intent.
- A rotated snippet updates the header, Overview, Install and Version history at once. The
  provider then refetches, so the list's next answer agrees with the server.
- Tests render subpages inside a test `SiteProvider` (or a stubbed `SiteContext`), not with props.
- Watch: if the router ever keeps the provider mounted across `siteId` changes, the `key` is the
  guard. The provider test pins it by re-rendering with a different `siteId` and asserting the
  first site's token is gone in the same render.

## Amendment (2026-10-08, PR #72 review D1)

The story stayed UI-only save one sanctioned API addition. `GET /api/sites`
(`src/app/api/sites/route.ts`) returns each site's `permission`: the caller's own `site_permissions`
grant, and only theirs. It is used only to choose what the "Edit website" request asks for
(`editPermissionsForGrant`, `src/hooks/useEditSession.ts`): admin → the owner set
(`["edit","admin"]`, unchanged), publish → `["edit","publish"]`, edit → `["edit"]`, view (or no
grant) → no button. The session route re-reads the live grant and refuses anything higher (s68a, ADR 047), so
the field grants nothing. Without it, every member asked for the owner set and an `edit` member
could never open a site; the list had no role field, and `siteToken` presence only tells admin from
non-admin.
