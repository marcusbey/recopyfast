---
validated: yes
---
# Plan — Story s70-content-changes

> Owner decisions (2026-10-08): plan and split validated; **s70a first** (it closes the public
> editor-email leak), then s70b, then s70c, each its own branch, review and PR. Cleanup: the
> read-only count is run first and shown to the owner, who approves the delete migration
> separately before it reaches production. Statuses: **Pending + Published** ("Edited" dropped).
> Revert: both "Save as draft" (anyone who can edit) and "Revert and publish" (publishers only).
> URL: `/dashboard/changes`, `/dashboard/content` redirects.

Branch: `feature/s70-content-changes` (docs only). Each part, once validated, gets its own branch
from `main` and its own PR: `feature/s70a-embed-ui-not-content`, `feature/s70b-changes-page`,
`feature/s70c-site-content-tab`. Each part is copied verbatim to `docs/plans/<part id>.md` with the
shared sections below, as s66c did.

Research: `docs/research/s70-content-changes.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s70-content-changes.md` and `.html`. Decision: [ADR 054](../decisions/054-content-change-state-is-a-security-invoker-view.md).

## Target story

As a site owner, the Content page tells me what copy changed on my sites — pending and published —
grouped by site and page, in human-readable locations, so I can review, compare, revert or open it
on the page without scrolling through hundreds of untouched strings. The embed's own UI is never
recorded as site copy, and the rows it already recorded are removed.

Acceptance criteria (proposed; the owner validates them with this plan):

1. The embed maps and reports no node under any root it injected: editor bar, staging bar, every
   `createOverlay` modal, the Edit Board panel, the AI suggestions modal, the form-field popover,
   the text-edit toolbar, counter and field panel, the hover hint, the animation badge.
2. Embed bytes: the bundle and widget measure at or under 45,841 / 33,073 gz; the ceilings ratchet
   to the measured values.
3. Rows recorded from the embed's UI are deleted by one forward migration; no row anyone edited is
   deleted; ambiguous rows are listed for review, not deleted.
4. `/dashboard/changes` lists pending and published rows by default, grouped site → page, newest
   change first, 50 at a time; "All text" adds original rows. Filters: site, status (with counts),
   search (server-side).
5. A row shows status, a readable location (never an element id or a selector), the text that
   matters for its state, who (admins) and when, Open on page and ⋮ visible at rest.
6. Expanding a row shows Original / Live now (/ Draft), its history (admins see who), and the
   actions its state and the caller's grant allow: Publish, Discard draft, Revert to original
   (dialog: Save as draft · Revert and publish), Edit on page.
7. Writes go only through the existing `PUT /api/staging/content/<site>` and
   `POST /api/staging/publish`; reads through two new read-only routes on the RLS client.
8. `/dashboard/content` redirects (308) to `/dashboard/changes`; the sidebar says "Changes".
9. `/dashboard/sites/<id>/content` shows the same view for that site, as the subnav's second link.
10. Every state of the design exists: loading, no sites, no changes, no match, error (never empty),
    row-action error, success in place. No horizontal overflow at 375 and 1280.

---

## Part A — s70a-embed-ui-not-content (3 tasks, complexity 2)

1. [ ] **The embed's own UI is never content.**
   - RED, new `src/__tests__/embed/embed-ui-not-content.test.ts`, booting the real
     `recopyfast.src.js` the way `embed-spa.test.ts:150-160` does (stubbed `fetch`, `settle()`),
     with a host `<main id="host">` of three text elements. For each surface — `showEditorBanner`,
     `showStagingBanner` then a click on `#rcf-edit-board-btn` (Elements tab, then History tab with
     one version by `owner@example.com`), `showAISuggestions` then a click on "Generate
     Suggestions" answered 500, and again answered with two suggestions, `startFormEdit` on an
     author-declared `<input data-rcf-id>`, `showPublishConfirmation`, `startTextEdit`,
     `showContainerHint` — advance past the observer's rescan and assert:
     - every `ReCopyFast.elements` entry's element is inside `#host`;
     - no POST body to `/content/<site>` names an entry whose `content` is not host text (force the
       trailing report: `lastReport = 0`, `sendContentMap()`);
     - no node outside `#host` carries `data-rcf-id`;
     - "by owner@example.com" appears in no POST body (the public-snapshot leak).

     Today this fails on the Edit Board, the AI modal and the popover (the research probe's output,
     `docs/research/s70-content-changes.md` fact 1).
   - GREEN, `public/embed/recopyfast.src.js`, exactly:
     - `shouldSkipElement` (`:2707-2712`): the six checks become one
       `if (element.closest('[data-rcf-ignore],[contenteditable="true"],#rcf-staging-banner,#rcf-edit-board-panel,.rcf-overlay')) return true;`
       with a tombstone: `#rcf-edit-board` named no element, so the Edit Board was content; the
       AI modal and the popover had no marker; `closest()` matches the element itself, so the
       separate `hasAttribute` was redundant;
     - `showAISuggestions` (`:5560`): `overlay.setAttribute('data-rcf-ignore', '');`
     - `startFormEdit` (`:5404`): `popover.setAttribute('data-rcf-ignore', '');`
     - the rule, in the comment above `shouldSkipElement`: every root the embed appends to `body`
       carries `data-rcf-ignore` or matches this selector.
   - `npm run build:embed`. Ratchet `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` (`scripts/build-embed.mjs:261-262`)
     and `SEEDED_MAX_*` (`src/__tests__/embed/build-size-gate.test.ts:95-96`) **down** to the
     measured values, itemized as the s67 block is:
     `+5 / +7` (two markers, the corrected id) · `−7 / −8` (one `closest()` for six checks) ·
     `45839 / 33072 measured — the new ceilings` (measured at research on `828970c`; re-measure,
     record what the branch measures, and refuse anything above 45,841 / 33,073).
2. [ ] **Delete the rows the embed's UI left behind.**
   - Owner precondition, before merge (not run by the implementer unless the owner says so): the
     read-only count below, run through the `read-prod-database` skill (`agents_readonly`), its
     output pasted in the PR.
   - RED, new `src/__tests__/db/embed-ui-rows-cleanup.test.ts` (`describeDb`, the harness pattern of
     `site-delete-cascade.test.ts`), in a transaction rolled back at the end: seed one site and
     - deleted: `#rcf-edit-board-panel > div:nth-child(2) > button:nth-child(1)` "Elements";
       `#rcf-eb-content > div:nth-child(1) > div:nth-child(2) > div:nth-child(3) > span:nth-child(2)`
       "by owner@example.com"; `#rcf-editor-banner > button:nth-child(5)` "All sites";
       `div:nth-child(7) > div > button:nth-child(3) > span:nth-child(1)` "🪄";
       `div:nth-child(5) > div > div:nth-child(4) > p` "Failed to generate suggestions. Please try again.";
       `div:nth-child(5) > div > div:nth-child(5) > button` "Close";
       `div:nth-child(10) > div:nth-child(6) > button:nth-child(2)` "Save";
     - kept: `#site-nav > button` "Close"; `#hero > button` "Generate Suggestions";
       `div:nth-child(2) > div > p` "Close"; an `#rcf-edit-board-panel …` row whose
       `published_content` differs from its original; one whose `staging_content` is set; an AI
       suggestion paragraph `div:nth-child(5) > div > div:nth-child(4) > div:nth-child(1) > p`
       (review tier);

     then execute the migration file's SQL and assert exactly the seven are gone. Add the file to
     the named CI step (`.github/workflows/ci.yml:286-299`).
   - GREEN, `supabase/migrations/<timestamp>_delete_embed_ui_discovery_rows.sql`, one statement,
     the predicate below, with the incident in its header comment. The predicate and the count were
     run at research on a throwaway local Postgres against exactly this seed: 7 deleted, 2 edited
     kept, 1 review row kept, no lookalike touched. It fires the existing delete
     trigger and public-revision rotation; nothing else is needed.
3. [ ] **Gates and PR.** `lint`, `type-check`, `type-check:build`, `format:check`, `build`,
   `npm test`, `npm run build:embed -- --check`; the DB suite in CI by name. Playwright contract
   unchanged (+0: the jsdom suite drives the shipped source; no browser test is added). One story
   commit plus one migration commit.

### The cleanup predicate (s70a Task 2)

```sql
-- certain: deleted. guard: never a row anyone touched.
WITH c AS (
  SELECT ce.id,
    ce.staging_content IS NULL
      AND ce.published_content IS NOT DISTINCT FROM ce.original_content
      AND ce.published_at IS NULL
      AND NOT (COALESCE(ce.metadata, '{}'::jsonb) ? 'staging_attributes') AS untouched,
    (
      ce.selector LIKE '#rcf-%'                       -- Edit Board, editor bar, staging bar
      OR (ce.selector ~ '^div(:nth-child\(\d+\))? > div > '
          AND ce.original_content IN ('🪄', 'Generate Suggestions', 'AI Content Suggestions',
            'Optimization Goal', 'Failed to generate suggestions. Please try again.',
            'Error connecting to AI service. Please check your connection.',
            '⚠️ Please enter some text first.', '✓ Use This', 'Generating...', '🔄'))
      OR (ce.selector ~ '^div(:nth-child\(\d+\))? > div > div:nth-child\(5\) > button$'
          AND ce.original_content = 'Close')       -- the AI modal's footer
      OR (ce.selector ~ '^div(:nth-child\(\d+\))? > (p:nth-child\(1\)|label:nth-child\([24]\)|div:nth-child\(6\) > button:nth-child\([12]\))$'
          AND ce.original_content IN ('Edit Form Field', 'Placeholder', 'Default Value', 'Cancel', 'Save'))
    ) AS embed_ui,
    ce.selector ~ '^div(:nth-child\(\d+\))? > div > div:nth-child\(4\) > (div(:nth-child\(\d+\))? > )?(p|button)$'
      AS ai_list_shape                                 -- review tier: AI suggestions, server errors
  FROM public.content_elements ce
)
DELETE FROM public.content_elements
WHERE id IN (SELECT id FROM c WHERE embed_ui AND untouched);
```

Read-only count for the owner (same CTE, no write):

```sql
SELECT s.domain,
  count(*) FILTER (WHERE c.embed_ui AND c.untouched)             AS will_delete,
  count(*) FILTER (WHERE c.embed_ui AND NOT c.untouched)         AS embed_ui_but_edited_kept,
  count(*) FILTER (WHERE c.ai_list_shape AND NOT c.embed_ui)     AS review_not_deleted
FROM c JOIN public.content_elements ce USING (id) JOIN public.sites s ON s.id = ce.site_id
GROUP BY s.domain ORDER BY s.domain;
-- and, for the review tier: SELECT s.domain, ce.page_path, ce.selector, left(ce.original_content, 80) …
```

---

## Part B — s70b-changes-page (10 tasks, complexity 4)

API and data changes, flagged:

- **New migration (view)**: `public.content_changes`, `security_invoker = true`, per ADR 054.
  `GRANT SELECT TO authenticated, service_role`; nothing to `anon`/`PUBLIC`.
- **New read route** `GET /api/content/changes` — needed because no existing route filters by
  change state or pages to the browser, and the page must not wait on `GET /api/sites`.
- **New read route** `GET /api/content/changes/[rowId]/history` — needed because no route reads
  `staging_history`. Read-only, RLS client.
- **No write route, no RPC, no change to any existing route.** Writes reuse
  `PUT /api/staging/content/<site>` and `POST /api/staging/publish`.

Contract of the list route:

```
GET /api/content/changes?site=<uuid>&state=changes|pending|published|all&q=<≤200>&offset=<0..10000>
200 { sites: [{ id, name, domain, permission }],
      rows: [{ id, siteId, elementId, pagePath, elementType, selector, language, variant,
               original, live, draft, state, changedAt, changedBy, createdAt }],
      total, counts: { pending, published, original }, nextOffset: number | null }
401 not signed in · 404 `site` is not one of the caller's · 400 bad `state`/`offset`/`q` · 500 generic
```

Order `changed_at desc, id desc`, 50 rows, `count: "exact"`. `q` is escaped for `%`, `_`, `\` and
applied with `.ilike("search_text", …)` (never inside an `.or()` string). An IP limiter
(`IP_GENERAL`, `onStoreFailure: "allow"`, justified as a signed-in read) runs before `getUser()`.

1. [ ] **The view.**
   - RED, new `src/__tests__/db/content-changes-view.test.ts`, run through the real PostgREST with
     real GoTrue JWTs (the `content-write-privileges.test.ts` pattern), named in the CI step:
     - `change_state` for: an untouched row (original); a draft ≠ live (pending); a draft equal to
       live (original); an attribute-only draft (pending; and the staging GET's
       `has_staging_changes` is true for the same row); published text ≠ original (published);
       published back to the original text, `published_at` set (published); a bulk-update row
       with `published_content` changed and `published_at` NULL (published); an A/B-staged row
       (pending, `changed_by` NULL);
     - `changed_at` = `staging_updated_at` for pending, else `published_at`, else `updated_at`;
     - an `edit` member of site A reads A's rows, `changed_by` NULL; an `admin` of A reads the
       newest `staging_history.user_email`; neither reads any row of site B; `anon` is refused;
     - the view's `reloptions` contain `security_invoker=true`.
   - GREEN: `supabase/migrations/<timestamp>_content_changes_view.sql` (ADR 054's definition plus
     `search_text = concat_ws(' ', original_content, published_content, staging_content, page_path)`).
     The body (the `CASE`, the attribute `EXISTS`, the lateral history row) was run at research on a
     throwaway local Postgres 14 against eight seeded states, all as listed above; PG 14 has no
     `security_invoker`, so that option is proven only by this task's tests on the CI stack (PG 15).
2. [ ] **Readable locations.**
   - RED, new `src/lib/content/__tests__/describe-location.test.ts`: the table in the design
     (§ Human-readable location) row for row, plus: no output ever contains `rcf-`, `>`, `:nth`,
     `#`; an empty selector and an unknown type give "Text"; a 300-character path is shortened to
     its last two segments.
   - GREEN: `src/lib/content/describe-location.ts` exporting `describePage(pagePath)` and
     `describeElement({ selector, elementType, elementId, pageLabel })`. Pure, no DOM.
3. [ ] **The list route.**
   - RED, new `src/__tests__/api/content/changes-route.test.ts` (mocked `@/lib/supabase/server` and
     rate limiter, as other route suites do): the limiter is called before `getUser`; 401 without a
     user; the sites come from `site_permissions` + `sites(id, name, domain)` for this user only;
     `site` not in them → 404 and no content query; `state=changes` → `.in("change_state",
     ["pending","published"])`; `q` `50%_off\` is escaped and reaches `.ilike` only; `offset`
     `-1`, `10001`, `abc` → 400; the three counts are head queries with the same filters;
     `nextOffset` null on the last page; a PostgREST error → 500 `{ error: "Failed to load
     changes" }` with no detail; `createServiceRoleClient` is never imported (assert by module
     mock).
   - GREEN: `src/app/api/content/changes/route.ts`.
4. [ ] **The history route.**
   - RED, `src/__tests__/api/content/changes-history-route.test.ts`: 401; a row the RLS client does
     not return → 404; an admin gets at most 20 events newest first plus `discoveredAt`; a non-admin
     gets `{ historyVisible: false, events: [], discoveredAt }`; `user_email` values without `@`
     are returned as `null`; a non-UUID `rowId` → 400.
   - GREEN: `src/app/api/content/changes/[rowId]/history/route.ts`.
5. [ ] **The data hooks.**
   - RED, `src/hooks/__tests__/useContentChanges.test.ts` and `useChangeHistory.test.ts`: first
     load, then `loadMore()` appends and de-duplicates by `id`; changing a filter resets to offset 0
     and drops a stale response that arrives late; a non-ok response is an error state, never an
     empty list (`useSites.ts` rule); search is debounced 250 ms; history loads once per row and
     is cached.
   - GREEN: `src/hooks/useContentChanges.ts`, `src/hooks/useChangeHistory.ts`
     (`{ data, loading, error, refetch }` per AGENTS.md § React).
6. [ ] **Row actions through the existing routes.**
   - RED, `src/hooks/__tests__/useChangeActions.test.ts`, asserting every `fetch` exactly:
     - revert as draft → one `PUT /api/staging/content/<site>` with
       `{ elementId, content: <original>, language, variant }`;
     - revert and publish → that PUT, then `POST /api/staging/publish` `{ siteId, elementIds: [elementId] }`,
       and no POST when the PUT fails;
     - discard draft → PUT with the live text; publish → the POST alone;
     - a 402 body's `error` is returned verbatim; nothing else is called;
     - ordinary copy with `&`, quotes, an em dash and an emoji is sent byte for byte.
   - RED, `src/hooks/__tests__/useEditSession.test.ts` (existing file, one new case): with `path`
     `/pricing`, the opened URL keeps the validated host and token and has pathname `/pricing`; a
     `path` that is not a same-origin absolute path (`//evil.example`, `https://…`) is ignored.
   - GREEN: `src/hooks/useChangeActions.ts`; `useEditSession` gains an optional `path` in
     `openEditSession` (applied with `new URL(path, editUrl)` after `validEditUrl`, host re-checked).
7. [ ] **The view component.**
   - RED, `src/components/dashboard/changes/__tests__/ChangesView.test.tsx` (RTL, fetch mocked):
     - groups site → page with `h2`/`h3` headers, band counts and site counts;
     - a row shows the `StatusBadge`, `describeElement`'s label, the state's text, who for an
       admin only, when; **no element id and no selector anywhere in the row**;
     - Open links to `https://<domain><page_path>` (`/` for NULL) with `target="_blank"` and
       `rel` containing `noopener`; ⋮ has no `opacity-0` class;
     - expand: `aria-expanded`, Original / Live now / Draft, history fetched once, the non-admin
       line;
     - actions by state × grant (the design's table), Revert opens the dialog, Save as draft calls
       the hook, success updates the row in place and announces it, failure keeps the dialog open
       with the message;
     - loading skeleton, no sites, no changes ("Show all text" switches the filter), no match
       ("Clear search"), error with Try again (never the empty state);
     - with `siteId` fixed: no site select, no site header.
   - `src/components/ui/__tests__/status-badge` (or the existing registry test): `contentStatuses`
     has `pending` and `published` (success, "Live on your site, different from the original") and
     no `edited`.
   - GREEN: `src/components/dashboard/changes/{ChangesView,ChangeSiteGroup,ChangeRow,ChangeDetail,RevertDialog,ChangesFilterBar}.tsx`,
     the registry entry. `ChangesFilterBar` replaces `ContentFilterBar` (its 12rem/full-row
     behaviour and test carried over).
8. [ ] **The page, the move, the links.**
   - RED:
     - `src/__tests__/app/dashboard/changes-page-shell.test.tsx` (from
       `content-page-shell.test.tsx`, assertions kept): one `h1` "Changes" while loading, on error,
       and with rows;
     - `src/__tests__/next-config-redirects.test.ts` (new): `redirects()` contains
       `/dashboard/content` → `/dashboard/changes`, `permanent: true`;
     - `DashboardNavigation.test.tsx:207,322` and `Breadcrumbs.test.tsx:54`: "Changes",
       `/dashboard/changes`;
     - `middleware.test.ts:186`: `/dashboard/changes` is gated like `/dashboard/content` was;
     - Overview: the "Total edits" metric links to `/dashboard/changes`.
   - GREEN: `src/app/dashboard/changes/page.tsx` (`PageShell` "Changes" / "What changed on your
     sites, page by page." + `ChangesView`); the redirect in `next.config.ts`; the sidebar item;
     `dashboard/page.tsx:252`; `page-shell-guard.test.ts:485` points at the new path.
   - Delete, after `rg -n "ContentElementCard|ContentFilterBar|getContentStatus|dashboard/content/page" src e2e`
     shows no other importer: `src/app/dashboard/content/page.tsx`, `ContentElementCard.tsx`,
     `ContentFilterBar.tsx`, `SiteSelectorBar.tsx` (no importer today), and the tests
     `content-load-states.test.tsx` (its "refused read is a failure, not an empty account" cases
     are re-asserted in Task 7), `content-partial-failure.test.tsx` (per-site failure no longer
     exists: one query), `content-page-shell.test.tsx` (moved). The PR lists each with its reason.
9. [ ] **e2e and captures.**
   - New `e2e/changes.spec.ts` on the signed-in harness (`e2e/support/owner-session.ts`), every list
     fulfilled by `page.route` from `e2e/support/changes-fixtures.ts` (fixture data only:
     `.example` domains, `@example.com`):
     1. 1280: no page overflow, two site panels, page bands, no `rcf-` id and no `>` selector text
        in `#dashboard-main`;
     2. 375: no overflow, ⋮ visible at rest on every row, rows stacked;
     3. expand a row → Original / Live now visible, history requested once;
     4. Revert → Save as draft: the PUT body is exactly `{elementId, content, language, variant}`
        (asserted in the route handler) and the row shows Pending;
     5. `/dashboard/content` lands on `/dashboard/changes`.
   - `e2e/app-layout.spec.ts:665-669`: path `/dashboard/changes`, name `changes`, navLabel
     "Changes", the new description.
   - Raise `expected` by exactly the number of new tests (5 as listed) on main's value at branch
     time (78 at `828970c`; 80 once s66c2 merges) in `playwright.config.ts:14` and
     `.github/workflows/ci.yml:215,398`.
   - With the build and the in-memory Supabase stand-in (never `next dev`), captures at 1280 and
     375 to `docs/designs/s70-content-changes/after/`.
10. [ ] **Gates.** `lint`, `type-check`, `type-check:build`, `format:check`, `build`, `npm test`,
    the DB suites by name in CI, `npm run test:e2e` with `RUN_RECOPYFAST_CORE_E2E`. The radius and
    page-shell guards pass with no new entry. One story commit plus one migration commit.

---

## Part C — s70c-site-content-tab (3 tasks, complexity 2)

1. [ ] **The subnav gains Content.**
   - RED: `src/app/dashboard/sites/[siteId]/__tests__/layout.test.tsx`: the `nav` named "Site"
     has five links, in order Overview, Content, Install, People & access, Settings, with exact
     hrefs and `aria-current` on the current one only; `Breadcrumbs.test.tsx`: `…/<uuid>/content`
     reads "Site / Content".
   - GREEN: `SITE_PAGES` (`SiteSubnav.tsx:11-16`) gains `{ segment: "content", label: "Content" }`
     after Overview. (ADR 052: a per-site page joins the subtree; no new provider.)
2. [ ] **The page.**
   - RED, new `src/app/dashboard/sites/[siteId]/content/__tests__/page.test.tsx` with the provider
     stub (`site-context-fixture.tsx`): the request carries `site=<this id>`; no site select and no
     site header; the empty state offers Edit website for an `edit`/`admin` grant and only "Show all
     text" for `view`; the page renders through `useSitePageShell` (one `h1`, the site name); the
     page-shell guard covers the new file.
   - GREEN: `src/app/dashboard/sites/[siteId]/content/page.tsx` = `<PageShell {...shell}>` +
     `editWebsiteAlert` + `<ChangesView siteId={site.id} />`.
3. [ ] **e2e and gates.**
   - `e2e/site-pages.spec.ts`: at 375 and 1280 the Content tab has no overflow, the subnav wraps
     and clips nothing, only this site's rows are requested (`site=` asserted in the route), and
     Back from Content returns to Overview. Raise `expected` by exactly those new tests (2).
   - Captures to `docs/designs/s70-content-changes/after/` (`site-content-1280`, `-375`).
   - Gates as Part B.

---

## Run interdicts

- **Ceilings only go down.** `MAX_BUNDLE_GZ`/`MAX_WIDGET_GZ` and the seeded pair never rise;
  `recopyfast.js` is rebuilt, never edited. s70b and s70c leave `public/embed/` and `server/`
  untouched (`git diff main...HEAD -- public/embed server` empty).
- **No new write path.** `git diff main...HEAD -- src/app/api` adds only
  `src/app/api/content/changes/**` (s70b), and those files never import
  `@/lib/supabase/service`. No existing route file changes. No new RPC; the only migrations are
  the cleanup (s70a) and the view (s70b).
- **The cleanup deletes nothing anyone edited** (the `untouched` guard), and is not run against
  production by the implementer. The read-only count is the owner's precondition.
- **No `.or()` string built from request input** in the new routes.
- `src/components/ui/**` changes only by the `contentStatuses` registry entry in
  `status-badge.tsx`. No new primitive: no table, no toast, no diff.
- The view is `security_invoker = true`; nothing is granted to `anon` or `PUBLIC`.
- No zod, React Query or new dependency. `date-fns` is already a dependency.
- **Never run `next dev`** (it appends to AGENTS.md). e2e uses the harness's build and start.
- Never `--no-verify`. `radius-baseline.json` does not exist and is not recreated.
- No marketing file changes; no change to `GET /api/sites` (its cost is a follow-up, not this story).

## The point everything turns on

**The change state is derived once, in a security-invoker view, and everything (filtering,
counts, paging, the status badge) reads it.** If the view is wrong, the page hides changes or
shows untouched text; if its security mode is wrong, it is a cross-tenant read.

Where it could be wrong, and what to compare it against:

1. **Attribute-only drafts and published reverts.** The `CASE` must agree with the publish RPC's
   own "changed" test (`20260924060000:31-55`) and with the staging GET's `has_staging_changes`
   (`staging/content/route.ts:145-149`). Compare Task B1's attribute case against both, on the
   same seeded row.
2. **RLS through the view.** `security_invoker` must make the base tables' policies apply to the
   caller, through the lateral `staging_history` read too. Compare with a real JWT for an `edit`
   member (rows yes, `changed_by` NULL) and a member of another site (zero rows), not with the
   `postgres` role, which bypasses RLS.
3. **The skip rule in the embed.** One `closest()` must still skip everything the six checks did.
   Compare the full embed suite (271 tests at research) before and after, and the new surface test
   against the research probe's list.

## Files touched

- **s70a**: `public/embed/recopyfast.src.js`, `public/embed/recopyfast.js` (rebuilt),
  `scripts/build-embed.mjs`, `src/__tests__/embed/build-size-gate.test.ts`,
  `src/__tests__/embed/embed-ui-not-content.test.ts` (new),
  `supabase/migrations/<ts>_delete_embed_ui_discovery_rows.sql` (new),
  `src/__tests__/db/embed-ui-rows-cleanup.test.ts` (new), `.github/workflows/ci.yml` (step list).
- **s70b**: `supabase/migrations/<ts>_content_changes_view.sql`;
  `src/app/api/content/changes/route.ts`, `…/[rowId]/history/route.ts`;
  `src/lib/content/describe-location.ts`; `src/hooks/{useContentChanges,useChangeHistory,useChangeActions}.ts`,
  `useEditSession.ts`; `src/components/dashboard/changes/*`; `src/components/ui/status-badge.tsx`
  (registry); `src/app/dashboard/changes/page.tsx`; `next.config.ts`; `DashboardNavigation.tsx`;
  `src/app/dashboard/page.tsx` (one href); tests listed per task; `e2e/changes.spec.ts`,
  `e2e/support/changes-fixtures.ts`, `e2e/app-layout.spec.ts`; `playwright.config.ts`,
  `.github/workflows/ci.yml`. Deleted: `src/app/dashboard/content/page.tsx`,
  `ContentElementCard.tsx`, `ContentFilterBar.tsx`, `SiteSelectorBar.tsx` and the three content
  page tests.
- **s70c**: `SiteSubnav.tsx`, `src/app/dashboard/sites/[siteId]/content/page.tsx` and test,
  `layout.test.tsx`, `Breadcrumbs.test.tsx`, `e2e/site-pages.spec.ts`, `playwright.config.ts`,
  `.github/workflows/ci.yml`.

## Test strategy

- **Embed (Jest, jsdom, the shipped source):** every injected surface opened, the map and the
  POST bodies inspected. The byte gate measures the committed artifact.
- **Database (real Postgres + PostgREST + GoTrue, named in CI):** the cleanup's exact delete set
  with lookalikes; the view's states, timestamps, tenancy and security mode.
- **Routes (Jest, mocked server client):** auth order, filters, escaping, bounds, error shapes, no
  service role.
- **Pure logic:** `describe-location` table tests.
- **Hooks:** request bodies byte for byte; error is never empty; stale responses dropped.
- **Components (RTL):** grouping, row anatomy, actions by state × grant, every state, a11y names.
- **e2e (Playwright, signed-in harness, fixtures by `page.route`):** layout at 375/1280, the
  revert flow's request, the redirect, the site tab. Captures for the owner.

## Definition of Done

Per part:

- a single PR whose description lists every new, moved and deleted test with its reason, and (s70a)
  the owner's read-only count output;
- `lint`, `type-check`, `type-check:build`, `format:check`, `build`, the full Jest suite and the
  named DB suites green; `build:embed --check` green with the ratcheted ceilings (s70a);
- the Playwright contract equals main's value plus this part's new tests; the new specs pass in CI;
- the radius and page-shell guards pass with no new exception;
- captures in `docs/designs/s70-content-changes/after/` (s70b, s70c), fixture data only;
- the review passed with no open critical; deployed; for s70a, the migration applied and the
  count re-run to zero `will_delete`.
