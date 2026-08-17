---
validated: yes
---
# Plan — Story s02-install-verified

Branch: `feature/s02-install-verified`
Research: `docs/research/s02-install-verified.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s02-install-verified.md` — the Installation card, its four states, and
its reused components.
Decision: `docs/decisions/006-site-status-persisted-state-machine.md` — travels with this
branch.

## Target story

s02-install-verified — "the site turns green by itself when the script is live." Complexity 3.
Owns the install-recipe data `s18` consumes. No declared dependencies; `s03` depends on this
story's timestamps.

Acceptance criteria (verbatim from `docs/stories.md`):
- [ ] A registered site starts in an explicit `awaiting-install` state, visibly distinct from `live`.
- [ ] The first authenticated content report from the embed on the registered domain flips the site to `live` with no user action.
- [ ] The dashboard reflects the flip within 10 seconds while the page stays open — no manual refresh.
- [ ] A report from a domain other than the registered one does not verify the site and is recorded as a mismatch.
- [ ] The `awaiting-install` state shows the snippet, a copy control, and the install location for WordPress, Next.js and plain HTML.
- [ ] Install recipes are stored as typed data in one module, and both this state and `s18`'s public pages render from it — this story owns that module.
- [ ] A site that was live and has reported nothing for a configurable window shows as `stale`, and `stale` never blocks content delivery or editing.
- [ ] State and transition timestamps are readable via the sites API, so `s03` can consume them.

## Tasks (ordered)

**T1 — Migration: persisted status + transition timestamps on `sites`.**
New `supabase/migrations/20260816120000_sites_install_status.sql`. Adds `status TEXT NOT NULL
DEFAULT 'awaiting-install' CHECK (status IN ('awaiting-install','live'))`, `live_at
TIMESTAMPTZ`, `last_reported_at TIMESTAMPTZ`, `last_mismatch_domain TEXT`, `last_mismatch_at
TIMESTAMPTZ`. Backfills existing rows: any site with a `content_elements` row is set `live`,
`live_at`/`last_reported_at` taken from that site's earliest `content_elements.created_at` (see
ADR 006 for why). No new RLS policy — this is an `ALTER` on an already row-level-RLS'd table,
not a new table.
*Verify:* `npx supabase db reset` applies cleanly; the `CHECK` rejects a third value; a manual
query against seed data confirms the backfill sets `live` only for sites already holding
`content_elements` rows and leaves the rest `awaiting-install`.

**T2 — `src/lib/sites/site-status.ts`: the one place staleness and transitions are computed.**
Exports `resolveEffectiveSiteStatus(fields, now?)` (returns the display `SiteStatus`, imported
from `status-badge.tsx`), `getStaleAfterMs()` (env-overridable, default 14 days, documented
constant per the repo's "no magic numbers" rule), `markSiteLive(supabase, siteId, at?)` (guarded
`UPDATE ... WHERE status = 'awaiting-install'` — write-once, never re-flips or overwrites
`live_at`), `recordSiteReport(supabase, siteId, at?)` (unconditional `last_reported_at` bump).
*Verify:* new `src/lib/sites/__tests__/site-status.test.ts` — table-driven cases for
`resolveEffectiveSiteStatus` (awaiting-install regardless of timestamps; live + recent
`last_reported_at` → live; live + old → stale; live + null `last_reported_at` → live, not a
false stale; env override moves the boundary); `markSiteLive`/`recordSiteReport` asserted
against a mocked Supabase client for the exact `.update()` payload and the `.eq("status",
"awaiting-install")` guard on `markSiteLive`.

**T3 — `src/lib/sites/install-recipes.ts`: the module `s18` will extend.**
Typed `InstallRecipe { id, label, location, notes? }` and `installRecipes: readonly
InstallRecipe[]` with the three entries AC 5 requires: `wordpress`, `nextjs`, `html`. Plus
`getInstallRecipe(id)`. This story ships exactly these three; `s18` adds the remaining five
stacks to this same array — no second copy anywhere.
*Verify:* new `src/lib/sites/__tests__/install-recipes.test.ts` — all three required ids
present, each with a non-empty `label` and `location`; `getInstallRecipe` resolves a known id
and returns `undefined` for an unknown one.

**T4 — `status-badge.tsx`: retire the old vocabulary, register the new one.**
`SiteStatus` becomes `"awaiting-install" | "live" | "stale"`. `siteStatuses` registry gets three
new entries (tones: `awaiting-install` → neutral, `live` → success, `stale` → warning, matching
the design's `IconTile` tone mapping — no `danger` tone anywhere on this feature).
`resolveSiteStatus`'s fallback becomes `awaiting-install`, not `inactive` — the same direction
the existing comment already argues ("a site the API said nothing about was drawn as healthy,
which is the one direction a default must never guess in"; `awaiting-install` is the never-claim
verified-early-that-isn't default, `stale`'s advisory tone is not the safe fallback either since
it implies a site once verified).
*Verify:* new `src/components/ui/__tests__/status-badge.test.tsx` pinning the three labels/tones
and the new fallback, since none of the three existing `ui/__tests__` files cover this registry
directly.

**T5 — `GET /api/sites`: read the persisted status instead of recomputing it.**
Select `status, live_at, last_reported_at, last_mismatch_domain, last_mismatch_at` alongside the
existing columns; replace `status: elementsCount && elementsCount > 0 ? "active" : "verifying"`
with `resolveEffectiveSiteStatus(...)` from T2; include the four new fields in each returned
site object (AC 8).
*Verify:* extend `src/app/api/sites/__tests__/route.test.ts` — a mocked `live` row with an old
`last_reported_at` resolves to `"stale"` in the response; an `awaiting-install` row resolves
unchanged; the timestamp fields pass through verbatim.

**T6 — `content/[siteId]/route.ts`: the transitions themselves.**
POST, after `authorizeSiteRequest` succeeds: call `markSiteLive` and `recordSiteReport` (both
best-effort, wrapped in `try/catch`, logged with `console.error`, never altering the response —
matching "the widget degrades, never breaks"). POST's catch block, only on
`authError.message === "Origin not allowed"`: write `last_mismatch_domain`/`last_mismatch_at`
using the request's resolved origin host, also best-effort. Requires exporting `parseOrigin`
from `site-auth.ts` (additive; no existing behavior changes). GET: call `recordSiteReport` only
on the widget-token branch (the `else` of the `authorizeFirstPartySiteRequest` check) — a
dashboard session loading the page is not "the site still receiving traffic."
*Verify:* extend `src/__tests__/api/content/[siteId]/route.test.ts` — first authorized POST
issues the `markSiteLive` update; a second authorized POST does not overwrite `live_at` (guard
clause present); GET via a widget token bumps `last_reported_at`, GET via a dashboard session
does not. Extend `src/__tests__/lib/security/site-auth-origin.test.ts`: add `update` to the
mocked service client (currently only `from/select/eq/single/upsert`) so the new call path is
exercised rather than silently swallowed; the pinned assertions at `:297` and `:392`
(`upsert` not called, `403` returned) must still pass unchanged.

**T7 — `dashboard/sites/page.tsx`: filter vocabulary and the 10-second flip (AC 3).**
`STATUS_FILTERS` and `statusCounts` move from `active`/`verifying`/`inactive` to
`awaiting-install`/`live`/`stale`. Add interval polling (re-running the existing `fetchSites`)
while `selectedSite` is displayed and its resolved status is `awaiting-install`; stop polling on
`live`/`stale` or on unmount/deselect. No new endpoint — reuses `GET /api/sites`.
*Verify:* update `src/app/dashboard/sites/__tests__/page.test.tsx`'s three mock sites and filter
assertions to the new vocabulary (documented in the PR). Add a fake-timers test: viewing an
`awaiting-install` site re-fetches within the poll window; once a poll response reports `live`,
no further fetch is scheduled.

**T8 — `SiteInstallationCard.tsx`: the screen (AC 1, 4, 5, 7).**
New `src/components/dashboard/SiteInstallationCard.tsx`, composed only from `Card`, `IconTile`,
`StatusBadge`, `Tabs`, `Alert`, `Button` per `docs/designs/s02-install-verified.md` — no new
primitive. Purely presentational: takes the already-resolved `site.status` (from T5) plus
`live_at`/`last_reported_at`/`last_mismatch_domain`/`domain`/`siteToken`/`embedScript`, and
renders the four states: `awaiting-install` (Tabs over T3's three recipes, snippet, copy
button using the existing copy-then-label-swap pattern already in `SiteDetailView.tsx` — no new
feedback primitive, matching the design doc's own resolution of that gap), `awaiting-install`
with a mismatch `Alert variant="warning"` when `last_mismatch_domain` is set, `live`, and
`stale` (`Alert variant="warning"`, explicitly non-blocking copy — nothing in this component
ever disables editing or content delivery, matching AC 7's trap). Wire into
`SiteDetailView.tsx`: remove the header `StatusBadge`, remove the "Status" description
paragraph and its `!hasReportedContent` branch, remove the entire "Integration Status" card,
render `<SiteInstallationCard site={site} />` in its place. Leave the separate "Embed Script"
and "Site Token" cards untouched — out of this story's design scope.
*Verify:* new `src/components/dashboard/__tests__/SiteInstallationCard.test.tsx` covering all
four states, the mismatch alert, and the copy-confirmation swap. Rewrite the five now-obsolete
assertions in `SiteDetailView.test.tsx` ("displays status badge...", "renders integration status
section", "handles different status types correctly", the two `hasReportedContent`-message
tests) against the new card, documented in the PR per `AGENTS.md`.

## Run interdicts

- `sites.status` in the database only ever holds `'awaiting-install'` or `'live'` — grep the
  migration and `site-status.ts` for a literal `'stale'` write; there must be none.
- The migration backfills `live`/`live_at` from `content_elements`' earliest row per site — no
  currently-reporting site regresses to `awaiting-install` after this ships.
- `markSiteLive` and `recordSiteReport` calls in the route handlers are wrapped in `try/catch`
  and never change the HTTP response on failure.
- The mismatch write fires only when `authorizeSiteRequest` throws exactly `"Origin not
  allowed"`, and only from POST's catch block — GET/PUT/OPTIONS are untouched.
- `site-auth.ts`'s three exported authorization functions keep their existing signatures and
  throw behavior; the only change is exporting `parseOrigin`. No fourth auth path is written.
- `GET /api/content/[siteId]` bumps `last_reported_at` only on the widget-token branch, never on
  the `authorizeFirstPartySiteRequest` branch.
- `site-auth-origin.test.ts:297` (`upsert` not called on an unauthenticated write) and `:392`
  (`403` + `upsert` not called on a wrong Origin) still pass unmodified in assertion, with only
  the service-client mock gaining an `update` stub.
- No file under `public/embed/` is touched — this story has no widget-side change.
- `src/lib/sites/install-recipes.ts` is the only place install-location copy exists; grep for a
  second WordPress/Next.js/HTML instruction string anywhere else in the diff finds none.
- Every rewritten assertion in `SiteDetailView.test.tsx` and `dashboard/sites/page.test.tsx` is
  named in the PR description as an intentional behavior change, per `AGENTS.md`.

## The point everything turns on

**The single decision:** persist only two states (`awaiting-install`, `live`) plus transition
timestamps, and compute `stale` at read time in one function (`resolveEffectiveSiteStatus`)
rather than storing it. Full rationale and rejected alternatives: ADR 006.

Where it could be wrong, and what to check each against:

1. **The backfill.** If it mis-assigns which existing sites are `live` vs `awaiting-install`,
   every already-reporting site either regresses (shows "awaiting install" to an owner whose
   script has run for weeks) or a never-installed site falsely reads as verified. Compare the
   migration's `UPDATE ... FROM (SELECT site_id, MIN(created_at) ...)` against a direct
   `SELECT DISTINCT site_id FROM content_elements` — the set of sites marked `live` after
   backfill must equal that set exactly, no more, no fewer.

2. **What counts as "the first authenticated content report."** T6 flips on any successful
   `authorizeSiteRequest` in POST, not on `discovered.rows.length > 0`. A page whose only
   elements are all skipped (oversized images, malformed selectors) would never flip if gated on
   rows written. Compare against a fixture POST with an empty `{}` content map: it must still
   flip the site to `live`, because AC 2 says "content report," and an authorized report with
   nothing storable is still proof the script ran.

3. **Read-time `stale` vs. a persisted value.** If some future consumer (a cron, a SQL report)
   needs `WHERE sites.status = 'stale'` directly, this design forces it to reimplement or call
   through the API. Compare against `s03`'s actual dependency: it reads `account_milestones`, a
   separate table (per `docs/stories.md`'s `s03` agentic notes), never `sites.status` directly —
   so this is confirmed to cost nothing today. Re-check this comparison if a later story adds a
   query that filters sites by staleness in SQL.

## Files touched

- `supabase/migrations/20260816120000_sites_install_status.sql` (new)
- `src/lib/sites/site-status.ts` (new), `src/lib/sites/__tests__/site-status.test.ts` (new)
- `src/lib/sites/install-recipes.ts` (new), `src/lib/sites/__tests__/install-recipes.test.ts` (new)
- `src/components/ui/status-badge.tsx`, `src/components/ui/__tests__/status-badge.test.tsx` (new)
- `src/app/api/sites/route.ts`, `src/app/api/sites/__tests__/route.test.ts`
- `src/app/api/content/[siteId]/route.ts`, `src/__tests__/api/content/[siteId]/route.test.ts`,
  `src/lib/security/site-auth.ts` (export `parseOrigin`),
  `src/__tests__/lib/security/site-auth-origin.test.ts` (mock gains `update`)
- `src/app/dashboard/sites/page.tsx`, `src/app/dashboard/sites/__tests__/page.test.tsx`
- `src/components/dashboard/SiteInstallationCard.tsx` (new),
  `src/components/dashboard/__tests__/SiteInstallationCard.test.tsx` (new)
- `src/components/dashboard/SiteDetailView.tsx`, `src/components/dashboard/__tests__/SiteDetailView.test.tsx`
- `docs/decisions/006-site-status-persisted-state-machine.md` (new, already written)

Not touched, confirmed by research: `public/embed/recopyfast.src.js`, `domain_verifications` /
`DomainVerification.tsx`, `SiteCard.tsx`, `dashboard/page.tsx` (both inherit the new vocabulary
through the shared registry with no code change).

## Test strategy

Unit: `site-status.ts` (pure resolver + guarded update calls against a mocked client),
`install-recipes.ts` (data shape). Integration (route handlers, mocked Supabase): `GET
/api/sites` status resolution, `content/[siteId]` POST transition + mismatch recording, GET
liveness bump, origin-refusal regression. Component: `SiteInstallationCard` four states +
mismatch alert + copy confirmation (RTL, query by role/text, no snapshot tests); `SiteDetailView`
rewritten around the new card; `dashboard/sites/page.tsx` filter vocabulary + fake-timers poll
test. No e2e/Playwright addition — the existing `e2e/` specs that touch site registration are
unaffected since registration itself is untouched (new `status` column merely defaults).

## Definition of Done

- `npm run lint` — 0 errors on all files touched above.
- `npm run type-check` — clean, including the new `SiteStatus` union, `InstallRecipe`, and the
  four new `sites` fields wherever `Site`/`SiteWithStats`/`SiteWithDetails` are extended.
- `npm run format:check` — clean.
- `npm run build` — green; `build:embed --check` unaffected (no widget file touched).
- `npm test` — full suite green, including every new/updated file listed under Files touched,
  and no regression in `src/__tests__/api/content/discovery-fidelity.test.ts`,
  `src/__tests__/api/content/rate-limit.test.ts`, `src/__tests__/api/content/auth-failure-cors.test.ts`
  (same route file, untouched behavior).
- `npx supabase db reset` applies the new migration cleanly (local/manual — not part of the
  automated four-command pre-commit gate, but required before this story is considered shippable
  per the migration non-negotiable).
- Every AC above has a passing test named against it in the PR description.
- PR description explicitly lists each rewritten pinned-test assertion and why, per `AGENTS.md`.
- ADR 006 merges with this branch, not separately.
