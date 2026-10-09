---
validated: yes
---
# Plan — Story s70b-changes-page

> Part B of `docs/plans/s70-content-changes.md`, copied verbatim as that plan instructs ("Each
> part is copied verbatim to `docs/plans/<part id>.md` with the shared sections below, as s66c
> did"), with the shared sections that govern this part, also verbatim. The source stays the
> reference; its checkboxes and these move together.

> Owner decisions (2026-10-08): plan and split validated; **s70a first** (it closes the public
> editor-email leak), then s70b, then s70c, each its own branch, review and PR. Cleanup: the
> read-only count is run first and shown to the owner, who approves the delete migration
> separately before it reaches production. Statuses: **Pending + Published** ("Edited" dropped).
> Revert: both "Save as draft" (anyone who can edit) and "Revert and publish" (publishers only).
> URL: `/dashboard/changes`, `/dashboard/content` redirects.

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

1. [x] **The view.**
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
2. [x] **Readable locations.**
   - RED, new `src/lib/content/__tests__/describe-location.test.ts`: the table in the design
     (§ Human-readable location) row for row, plus: no output ever contains `rcf-`, `>`, `:nth`,
     `#`; an empty selector and an unknown type give "Text"; a 300-character path is shortened to
     its last two segments.
   - GREEN: `src/lib/content/describe-location.ts` exporting `describePage(pagePath)` and
     `describeElement({ selector, elementType, elementId, pageLabel })`. Pure, no DOM.
3. [x] **The list route.**
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
4. [x] **The history route.**
   - RED, `src/__tests__/api/content/changes-history-route.test.ts`: 401; a row the RLS client does
     not return → 404; an admin gets at most 20 events newest first plus `discoveredAt`; a non-admin
     gets `{ historyVisible: false, events: [], discoveredAt }`; `user_email` values without `@`
     are returned as `null`; a non-UUID `rowId` → 400.
   - GREEN: `src/app/api/content/changes/[rowId]/history/route.ts`.
5. [x] **The data hooks.**
   - RED, `src/hooks/__tests__/useContentChanges.test.ts` and `useChangeHistory.test.ts`: first
     load, then `loadMore()` appends and de-duplicates by `id`; changing a filter resets to offset 0
     and drops a stale response that arrives late; a non-ok response is an error state, never an
     empty list (`useSites.ts` rule); search is debounced 250 ms; history loads once per row and
     is cached.
   - GREEN: `src/hooks/useContentChanges.ts`, `src/hooks/useChangeHistory.ts`
     (`{ data, loading, error, refetch }` per AGENTS.md § React).
6. [x] **Row actions through the existing routes.**
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
7. [x] **The view component.**
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
8. [x] **The page, the move, the links.**
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
9. [x] **e2e and captures.**
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
10. [x] **Gates.** `lint`, `type-check`, `type-check:build`, `format:check`, `build`, `npm test`,
    the DB suites by name in CI, `npm run test:e2e` with `RUN_RECOPYFAST_CORE_E2E`. The radius and
    page-shell guards pass with no new entry. One story commit plus one migration commit.

---

## Deviations

Recorded at the s70b review (finding m2): where the code departs from this plan, and why, then
the choices the plan left open.

### From the plan

- **The view migration is gated on PostgreSQL 15+** (Task 1). The plan's migration is a plain
  `CREATE VIEW … WITH (security_invoker = true)`. CI's bare PostgreSQL 14 replay
  (`scripts/run-db-invariants.mjs`, the s38 privilege suites) rejects that option, and every
  migration must apply there too. So the DDL is `EXECUTE`d inside a `server_version_num >= 150000`
  check; on 14 nothing is created and a WARNING says why. There is no definer-view fallback on any
  version. Production (17.4) and the Supabase stack the DB suite runs on (15) create the view.
  Recorded as a consequence in ADR 054.
- **`SiteSelectorBar.tsx` is kept** (Task 8). The plan deletes it as having "no importer today",
  but `src/app/dashboard/_ab-tests/page.tsx` imports it, so deleting it breaks that page's build.
  The other deletions went ahead as planned.
- **Links styled with `buttonVariants`, not `<Button asChild>`** (Tasks 7–8: Open, Site page, Add
  site). `button.tsx:106-117` wraps `children` in a Fragment, so Radix `Slot` clones the Fragment
  and drops every class the link should get (grid area and justification included). That is a bug
  in a `src/components/ui/` primitive, which this story may not touch beyond the status registry.
  The same bug affects the 10 other files that use `<Button asChild>` today. It needs a follow-up
  story.
- **Search is a case-insensitive regex match, not `.ilike`** (review m1, re-review N1). The plan
  escapes `%`, `_`, `\` and applies `.ilike`. PostgREST rewrites every `*` in a like/ilike value to
  `%` and has no escape for it (measured on PostgREST 14.16: `\*` arrives as `\%`), so "5*" matched
  every row containing a 5. The first fix refused `*` with a 400, which the page showed as a
  failure. The route now applies `.filter("search_text", "imatch", escapeRegex(q))`. `imatch` is
  Postgres's `~*`, and PostgREST's `*` rewrite applies to like/ilike only (`Query/SqlFragment.hs`,
  read at v14.16 and at v16.2, the image CI's Supabase CLI 2.117.0 pins). Every POSIX ERE
  metacharacter is escaped, so typed text matches only itself, case-insensitively, as with
  `ilike`; `%` and `_` are left as typed. Proven on a scratch PostgreSQL 16 (every migration)
  and PostgREST 14.16 through postgrest-js: 12 searches (each metacharacter, `5*`, `50%_off`, a
  backslash, a case change) each returned exactly their literal rows, where the unescaped controls
  matched lookalikes. `escapeRegex` lives in `src/lib/content/search-pattern.ts` so it can be
  unit-tested (a route file may export only its handlers).
- **"N changes on M sites" counts the sites the list holds** (review m5), and only once every row
  is loaded. With more to load, the line reads "N changes" alone, because a site further down is
  not known yet. The design's example ("15 changes on 2 sites") counted every site.
- **`AuthContext` changes** (review m6), a file outside "Files touched". It clears the change
  history cache on `SIGNED_OUT`.

### Choices the plan left open

- `useContentChanges` returns more than `{ data, loading, error, refetch }`: `loadMore`,
  `isLoadingMore`, `appliedQuery`, and (review M1) `sites` and `counts`, which keep
  the last answer's values while the list reloads, so the filter row never unmounts. `updateRow`
  was replaced by `refreshAfterWrite` in the fix pass below.
- History is cached per row and per change: the key is the row id plus its `changedAt`, so a row
  reverted or published from this page reads its trail again.
- ~~"Success in place" mirrors the view's rules for one row.~~ Superseded by the fix pass below:
  after a write the rows are read again from the server, so a row published back to its original
  text reads Published as soon as the re-read lands.
- The list route sorts the caller's sites by name, with the domain standing in for a blank name.
  `changedBy` goes through the same `@`-only filter as the history route's `by`.
- Captures are opt-in: `e2e/changes.spec.ts` writes `docs/designs/s70-content-changes/after/` only
  with `RCF_LAYOUT_SCREENSHOTS=1`, so CI runs the spec as assertions only.

- **Who · when at 375 (re-review N2, orchestrator).** The who·when line is about 174 px at 375; a
  long address used to cut "when" ("sam@example.com · 25 minut…"). The address now truncates in its
  own span and the time never shrinks (`ChangeRow.tsx`, test "truncates a long address, never the
  time"); the design's full address is kept wherever it fits.

### Devin review (PR #77)

Five findings, fixed without a new route, RPC or migration. The view SQL is byte-identical, and
no existing route changed.

- **Discard sends staged attributes back** (Task 6). The plan's discard is "PUT with the live
  text". The save RPC (`20260924030000`, `save_staging_content_atomic`) *merges* the request's
  attribute patch into `staging_attributes`, so a staged `href`/`alt` survived the discard and
  Publish still pushed it. No existing route discards (the embed has none; `revert_staging_content`
  has no caller). The same RPC drops a staged key whose value equals the live one, so the discard
  PUT now also carries each staged attribute with its live value (`{ elementId, content, language,
  variant, href?, alt? }`). When one cannot go back that way (no live value: the RPC compares a JSON
  string with SQL NULL; a key the PUT does not know; a value its validation would trim or refuse),
  Discard draft is not offered, and the expanded row says "This draft changes a link or image
  attribute, which can't be discarded here. Change it on the page." The orchestrator's suggested
  wording was "This draft changes attributes — discard it on the page". It was changed because the
  page has no discard either (the embed's editor can only set a new value), and "attribute" alone
  means nothing to an owner. **Follow-up:** a draft staging an attribute with no live value can
  only be published or overwritten; truly discarding it needs a discard operation (a route over
  `revert_staging_content`, or a new RPC), which this story may not add.
- **The list route's rows carry `draftAttributes`** (Task 3 contract): `[{ name, live }]` for a
  pending row, `[]` otherwise. Read by one RLS select of `content_elements (id, metadata)` for the
  page's pending ids, as the history route already reads that table. Only names and live values
  leave, never a staged value. The state is still derived by the view alone.
- **Revert and publish, publish refused** (Tasks 6–7). The hook's actions now resolve
  `{ error, applied }` instead of `string | null` (the "returns the publish refusal" test became
  "says the revert landed as a draft"). When the PUT saved and the POST failed, the dialog closes,
  the row is drawn Pending with the original as its draft, and the row opens with "The revert was
  saved as a draft but not published. <reason>" under its actions, where Publish retries it.
- **No Revert when the live text is the original** (Task 7's actions table offered Revert on every
  published row). A row published back to its original stays Published (`published_at`); saving
  the same text "succeeded" with nothing pending. Revert is not offered there, the existing
  "Text is the same as the original." line explains, and the hook refuses it without a request.
- **`nextOffset` stops at the offset ceiling** (Task 3). From the last offset the route accepts
  (10,000) it offered 10,050, which it refuses with a 400. It is now null when the next offset would
  pass `MAX_OFFSET`, and the page says "Showing the first N of M — use the filters or search to see
  more." The limits moved to `src/lib/content/changes-paging.ts` (new file, outside "Files
  touched"), so the route and the page share one value.
- **Deep page labels keep their first segment** (Task 2 and the design's location table).
  `/products/alpha/setup` and `/services/alpha/setup` both read "… › Alpha › Setup". Paths of up to
  three segments are now shown whole ("Products › Alpha › Setup"); deeper ones keep the first and
  the last two ("Docs › … › B › C", was "… › B › C"; the 300-character case is now first + last
  two). First-and-last alone was rejected: it would merge `/blog/2024/launch` and
  `/blog/2025/launch`, which the old label told apart.

### Devin re-review (PR #77)

One critical and four minors, fixed without a new route, RPC, migration or change to an existing
route.

- **N1 (critical): Discard sent back a link Publish had made live.** (Superseded by the fix pass
  below: `rowAfter` and its file are deleted; the rows are read again after every write.) The row a write left on screen
  never updated `draftAttributes`. After Publish made a staged `href` live, the row still held the
  link's old live value; Revert → Save as draft, then Discard, sent it back, and the save RPC
  staged it (it now differed from the live link), so the next Publish silently restored the old
  link. `rowAfter` now sets the list per action, from the RPCs (`20260924030000`,
  `20260924060000`): after Publish and after Revert and publish, `[]` (the publish RPC drops
  `staging_attributes`); after Discard, `[]` (offered only when every staged key goes back to its
  live value, which the save RPC drops); after Revert → Save as draft, including a revert whose
  publish failed, a pending row keeps its list unchanged (a text-only PUT merges an empty patch, and
  the live values stand), any other row gets `[]` (nothing staged differs from live: the view's own
  pending test). Each case is exact from the row alone, so no row is re-read from the list route.
  `rowAfter` moved from `ChangesView.tsx` to `src/components/dashboard/changes/row-after.ts` (new
  file, inside "Files touched") so each rule is unit-tested: pending → Revert → Save as draft is not
  reachable from the page, where Revert is offered on published rows only.
- **N2: a pending row missing from the metadata read is not known.** The route gave it `[]`
  ("stages nothing"), so Discard was offered and could leave a staged link staged. The Task 3
  contract (as amended above) changes: `draftAttributes` is `null` for a pending row the metadata
  read did not return, and the page never offers Discard on `null`.
- **N3: the metadata read has its site fence.** `.in("site_id", <caller's sites>)` beside the ids,
  as the route header promises for every read. RLS stays the first fence.
- **N4: a row without `draftAttributes` no longer crashes the page.** The hook reads a missing or
  malformed list as `null` (not known, not discardable), and `discardAttributes` refuses anything
  that is not a list. Neither option the reviewer named was taken as such: rejecting the answer in
  `isChangesPage` would turn one odd row into a failed page, and `?? []` would offer a Discard that
  leaves a staged link staged.
- **A second note for a draft that cannot be discarded** (not in the design). The existing note says
  the draft "changes a link or image attribute", which is not known for an unread list. That case
  reads "This draft could not be read in full, so it can't be discarded here. Reload the page to try
  again." (`UNREAD_DRAFT_NOTE`, chosen by `discardRefusal`, used by the row and the hook's refusal).
- **N5: the design matches the code** (`docs/designs/s70-content-changes.md`): page labels of up to
  three segments are whole, deeper ones the first plus the last two; Discard's PUT carries each
  staged attribute's live value, and both notes are quoted.
- **One existing assertion changed** (`changes-route.test.ts`, "lists the attributes a pending draft
  stages…"): the metadata query's `in` calls were pinned with `toEqual([["id", …]])`; the new site
  fence adds a second `in`, so that line is now `toContainEqual`, and the new N3 test pins both calls
  exactly.
- **Database evidence** (`content-attributes-lifecycle.test.ts`, 4 new cases, run on a scratch
  PostgreSQL 16 with every case of the suite): a save carrying the live value un-stages a staged
  link and Publish then pushes nothing; a save carrying an old live value stages it and Publish puts
  it back live (the N1 effect); a text-only save stages nothing on a row with nothing staged; a
  text-only save keeps a pending row's staged link.

### Fix pass (verification of `403066e`)

One critical, one major and two minors, fixed without a migration, an RPC or a change to an
existing route. The only route change is an optional read-only filter on this story's own new
`GET /api/content/changes`.

> CTO decision under the owner's 2026-10-09 directive: stop deriving post-write state on the
> client; use the standard refetch-after-mutate pattern.

- **C1 (critical): Publish left the element's other language and variant rows stale.** Publish
  sends `elementIds: [elementId]`, and the publish RPC (`20260924060000:43-44`) promotes every
  pending row of that `element_id`, whatever its language or variant (translation creates such
  rows: `src/app/api/ai/translate/route.ts:313-335`). `ChangesView.tsx:194` redrew the one row
  acted on, so an fr sibling kept its old draft and its Discard; that Discard re-staged the old
  text and link, and the next Publish silently put them back live. Same with Revert and publish.
  Now every write that lands (publish, discard, revert to draft, revert and publish, and the
  partial revert whose publish was refused) is followed, inside the action, by
  `refreshAfterWrite(siteId, elementId)` (`useContentChanges.ts`): one read of every row of the
  element (`?site=<id>&element=<element id>&state=all`) and one read of the current filters' first
  page for the counts and total. Loaded rows are patched where they stand (place, open detail and
  focus kept; a row that no longer matches the filter stays, as before); a sibling the list does
  not hold is not added. The action stays busy (spinner, buttons disabled) until the re-read
  lands, and the announcement is set after it.
- **CTO decision: `rowAfter` is deleted, not kept as a placeholder** (`row-after.ts` and
  `row-after.test.ts` removed). A placeholder that can be wrong is what produced C1 and, before
  it, Devin's N1; the row's busy state already covers the one round trip.
- **CTO decision: the counts and total are read again too**, from the current filters' first page
  (its rows are not used). The old `moveCount` arithmetic was client-derived post-write state, and
  it could not see a sibling the list does not hold.
- **CTO decision: `element` is an optional filter on this story's own list route**, which could
  not narrow by element before. It needs `site` (an element id is unique only within a site),
  is capped at `MAX_ELEMENT_ID_LENGTH` (255, `src/lib/security/discovered-text.ts`), gives 400
  "Invalid element" otherwise, and applies to the list and the three counts alike (one filter
  set). The site is still checked against the caller's own (404). Read-only, RLS client, no
  service role.
- **M1 (major): Discard had no precondition.** It sent `row.live` and the live attribute values as
  loaded, so a stale view (second tab, an editor publishing from the live page) re-staged old copy.
  Discard now reads its row again (the same narrowing read) just before the PUT and builds the
  PUT from that read: its live text and its `draftAttributes` live values. If the row is gone, no
  longer pending, holds another draft text, or stages another set of attributes, nothing is sent:
  the dialog closes, the row is read again and opened, and its actions say "This change was
  updated elsewhere — review it again." A failed pre-read sends nothing either ("Could not check
  this draft before discarding it. Try again.", the dialog stays open). CTO decision: the live
  text and live attribute values are not part of the comparison, because they are not what the
  owner is discarding; when they moved (a bulk update writes the live text under a pending
  draft), the PUT sends the current ones, which is exactly what discarding means.
  **Residual:** a write from elsewhere landing between that read and the save RPC is not seen.
  (Corrected at the next verification, minor 2: this said "milliseconds". The window is the read's
  way back plus everything the staging PUT runs before its RPC — `authorizeFirstPartyEditorAccess`,
  `enforceRateLimit`, `checkOwnerCanEdit`, each a round trip — so hundreds of milliseconds or
  more.) Closing it needs a server-side compare-and-set in the staging PUT, an existing route this
  story does not change. **Follow-up: s81-version-restore-integrity** (the version/concurrency
  story).
- **m1 (minor): a filter changed while Publish was in flight dropped the row patch**, and the
  reload, read before the publish committed, drew the row Pending with Discard. Every read is now
  numbered as it starts, and a row is only replaced by a copy from a later-started read: a first
  page still in flight when a write lands is asked for again (its older answer dropped by the
  generation rule); a "Show 50 more" that left before the write and lands after the re-read draws
  the re-read row, and never takes its older counts; an older re-read never overwrites a row a
  newer read drew.
- **m3 (minor):** `describe-location.test.ts` no longer says its tables differ from the design
  "except deep paths"; the design was updated by N5.
- **A re-read that fails after a write that landed** (not in the findings): the row keeps what it
  last showed and its actions say "This went through, but the row could not be read again and may
  be out of date. Reload the page to see it as it is now." No announcement is made.
- **Focus after Publish** (CTO: keep focus): the Publish button leaves with the re-read row; focus
  goes to the row's expand button instead of the page (design, Accessibility).
- **Design** (`docs/designs/s70-content-changes.md`): the Success state and the Discard paragraph
  describe the re-read and the "updated elsewhere" refusal.
- **Tests changed** (AGENTS.md § Tests):
  - `ChangesView.test.tsx`: the API mock is now backed by an in-memory server that remembers writes
    (`__tests__/changes-server-fake.ts`, new, test support only: the save and publish RPCs' rules and
    the view's state), because a static list answers every re-read with the pre-write rows. Three
    write tests that seeded rows through a static `list` override now seed the fake
    ("discards a draft and the link it stages", both "never sends back a link it has published"
    tests); two `publish` overrides ("…after a revert whose publish failed", "shows a revert whose
    publish failed…") call the fake on success. Tests on the default mock run on the fake with
    their code unchanged. No assertion changed; every existing test also passes on the fake against
    `403066e`.
  - `useContentChanges.test.ts`: "updates one row in place and moves its count with it" removed with
    `updateRow`; replaced by five `refreshAfterWrite` cases.
  - `useChangeActions.test.ts`: the two "discards…" cases now answer Discard's re-read and expect it
    before the PUT (one renamed "…after reading its row again"); `fetchCalls` reads a plain GET.
  - `row-after.test.ts` deleted with `row-after.ts`.
  - `e2e/support/changes-fixtures.ts`: the list honours `element`, and the PUT and POST change the
    fixture, so the Save as draft spec reads the row back Pending. No spec changed; the contract count
    is unchanged.
- **New tests:** route (element narrowing, 3 × 400, 404); hook (siblings and counts re-read, failed
  re-read, the in-flight reload, the older "Show 50 more", the older re-read); actions (Discard built
  from the fresh row, four stale cases, unreadable attributes, failed pre-read, five re-read cases);
  view (Publish en → fr Published without Discard, Revert and publish → sibling published, two
  stale-tab Discards, the filter race, focus after Publish, failed re-read). Each new view test was
  run against `403066e` and failed there for the reason it names.

### Fix pass (verification of `63d7ba2`)

One major and six minors, fixed without a new route, an RPC, a migration or a change to an existing
route. The only route change is one field on this story's own `GET /api/content/changes` rows
(`hasLiveText`). Nothing under `src/components/ui`, `public/`, `server/` or `supabase/` changed.

> CTO decision under the owner's 2026-10-09 directive.

- [x] **Major: one write at a time per element.** The busy state was one slot
  (`useChangeActions.ts:211`, `pendingAction`), cleared by whichever write ended first (`:233`),
  and a row compared its own id with it (`ChangeSiteGroup.tsx:137`). So Discard on the fr row
  stayed enabled while Publish on the en row of the same element was in flight: its pre-read could
  land before the publish committed and its PUT after, staging the old text again under "Draft
  discarded.". And a second write replaced the first one's entry, so a row in flight was offered
  its buttons again. Now the hook keeps one entry per write (`inFlight`, each with its own id; a
  write that ends removes its own entry only), and every row whose site and element id match an
  entry has Publish, Discard and Revert disabled, in the panel and in ⋮. The spinner stays on the
  row whose action it is. The hook also refuses, sending nothing, a second write to an element
  that is being written ("A change to this text is still being saved. Try again once it has
  finished."), checked on a ref so it does not wait for a render.
  **CTO decision: the lock is the element (site + element id), not the page.** Publish promotes
  every language and variant row of the element ids it is given and nothing else
  (`20260924060000`), a draft save writes one row of it, and every read the actions make (Discard's
  pre-read, the re-read after a write) reads that element. Two writes to two elements cannot touch
  each other's rows, so they run side by side; locking the whole page would serialise them for
  nothing.
  **Deviation from the finding's wording:** the revert/discard dialog's confirm buttons are not
  given the lock. The dialog is modal and opens only from a Revert or Discard control, and those
  are disabled while the element is written, so a confirm can never be reached while another write
  to the element is in flight; a lock there could not be tested. The hook's refusal stands behind
  it either way.
- [x] **Minor 2: the residual race is not "milliseconds".** Corrected in `useChangeActions.ts` and
  in the M1 paragraph above. Follow-up unchanged: s81-version-restore-integrity (compare-and-set in
  the staging PUT).
- [x] **Minor 3: the frame-ordering guard is pinned.** Two tests where overlapping writes' count
  re-reads land out of order (two writes; a write and a filter change).
  **CTO decision: the `rereadFrame` generation check is removed.** Mutation showed it guards
  nothing `patchFrame`'s read order does not: removing it alone left every test green, removing the
  read order alone turned the "two writes" test red, removing both turned both red. A filter
  change's first page is a later-started read than any count read already out, and while it loads
  there is no list to patch. With the check gone, removing the read order turns both tests red.
- [x] **Minor 4: the element read pages.** `readElementChanges` read offset 0 alone, but an element
  has a row per language × variant and nothing caps that at 50: a sibling past the first page kept
  its old draft after Publish, and Discard on it said "updated elsewhere". It now follows
  `nextOffset`, which the route stops offering at its ceiling and refuses past it, so the loop is
  bounded there. A `nextOffset` that does not move forward is refused, and a read that does not end
  with exactly the rows the last page counted (offset paging can skip a row that moves between two
  pages) is a failure: the row is then said to be possibly out of date, or Discard sends nothing.
- [x] **Minor 5: failure paths.** A stale Discard whose re-read failed said "review it again" over
  a row that had not been refreshed: any message now gets "The row could not be read again and may
  be out of date. Reload the page to see it as it is now." when the re-read fails (a clean success
  keeps "This went through, but …"). A write that got no answer at all (the request threw: the
  connection dropped) was reported as refused and not read again, though it may have committed: it
  is now read again, the dialog closes onto the row as read, and the row says "The connection
  dropped before the server answered, so <the draft may or may not have been discarded | the revert
  may or may not have been saved | it may or may not have been published>. Check the row before
  trying again." Revert and publish never publishes after an unanswered save. A revert whose save
  landed and whose publish got no answer says "The revert was saved as a draft." first.
  **CTO decision:** only a request that throws is "uncertain". Any HTTP answer is the server's word,
  as before: the save and publish RPCs are atomic, so a 4xx/5xx from the route has written nothing.
  A 502/504 from a proxy is the one ambiguous answer left; it reads as a refusal, as it did.
  **Wording change, not pinned before:** a revert whose publish was refused and whose re-read then
  failed ended "… This went through, but the row could not be read again …"; it now ends "… The
  row could not be read again …", since the publish did not go through.
- [x] **Minor 6: a draft on text never published is not offered a discard.** A translation is
  written with no `published_content` (`src/app/api/ai/translate/route.ts:313-335`), "Live now"
  stands in the original, and Discard saved that original as the draft, which the view still reads
  as differing from NULL: the row stayed Pending under "Draft discarded." No existing route can
  clear a draft to NULL (the staging PUT stores `String(content)`), so such a draft is not offered
  Discard, and the row says "This text was never published, so its draft can't be discarded here.
  Edit or publish it on the page." The list route's rows carry `hasLiveText`
  (`published_content IS NOT NULL`, Task 3 contract amended); the hook reads anything but `true` as
  false (no Discard), like `draftAttributes`. Discard re-checks it on the row it reads just before
  the PUT. The test fake (`changes-server-fake.ts`) now models a NULL `published_content` the way
  the SQL does (`hasLiveText: false` in a seed).
- [x] **Minor 7: both focus branches after Publish are tested.** The immediate one (the re-read row
  is drawn and focus falls before the action settles: the counts read is still out) now has its
  test; each branch's test goes red when that branch is removed.
- **Tests changed** (AGENTS.md § Tests):
  - `useChangeActions.test.ts`: "reports which row is in flight while a write runs" and "re-reads
    the row's element after the write lands, and keeps the row busy until it has" asserted the
    removed `pendingAction` slot; they assert the same thing through `inFlight` (`busyActionOf`,
    `isElementWriting`). The `row()` fixture carries `hasLiveText: true`.
  - `changes-route.test.ts`: "maps rows to the contract…" pins the row's exact shape, which gains
    `hasLiveText: true`.
  - `ChangesView.test.tsx`: the `row()` fixture carries `hasLiveText: true` (the hook reads a
    missing field as false, which would withdraw Discard from every static-list test).
  - `e2e/support/changes-fixtures.ts`: every fixture row carries `hasLiveText: true`. No spec
    changed; the contract count is unchanged (85).
- **New tests:** hook actions (every write tracked, an end clears only its own, the element lock
  and its scope, the refusal of a second write; Discard past the first page; never-published,
  twice; stale + failed re-read; five unanswered-write cases); hook list (element read across two
  pages, two incomplete reads, two frame-ordering races, `hasLiveText` normalisation); route
  (`hasLiveText`); view (the probe: en Publish in flight → fr Discard and Publish disabled, ⋮
  Discard disabled, both settle consistent; two overlapping writes; stale + failed re-read; lost
  Discard answer; never-published Discard; immediate focus).
- **Mutations** (each guard neutralised alone, its test red, restored byte for byte):

  | Guard | Red |
  |---|---|
  | hook refuses a second write to an element | "refuses a second write…" |
  | a write's end clears only its own entry | "tracks every write…", view "keeps each write's row busy…" |
  | the lock matches site + element | 4 hook tests, both view lock tests |
  | panel Discard disabled by the element lock | view "disables every row…" |
  | ⋮ Discard disabled by the element lock | view "disables every row…" |
  | the group passes the element lock, not the row's own | view "disables every row…" |
  | `patchFrame` read order | both frame-ordering tests |
  | element read follows `nextOffset` | 3 list tests, the Discard past page one |
  | element read must be complete | "…pages missed a row" |
  | element read refuses a non-advancing offset | "…does not move forward" (the loop exhausts the worker's heap) |
  | re-read after an unanswered write | 5 hook tests, view "lost Discard answer" |
  | out-of-date said whatever the outcome | 2 hook tests, view "stale + failed re-read" |
  | a thrown request is uncertain, not refused | 6 hook tests, view "lost Discard answer" |
  | no publish after an unanswered save | "revertAndPublish reads the row again…" |
  | the dialog closes on an uncertain write | view "lost Discard answer" |
  | route `hasLiveText` | route test |
  | hook reads only `true` as live text | list normalisation test |
  | no Discard on text never published | hook and view tests |
  | the fresh row's live text re-checked | "…as read now has no live text…" |
  | the never-published note | hook and view tests |
  | immediate focus branch | view "moves focus … at once" |
  | deferred focus branch | view "keeps a published row open…" |

### Fix pass (verification of `d381b7b`)

Max severity minor, ship allowed; three minors fixed before merge. No route, RPC, migration or
`src/components/ui` change.

> CTO decision under the owner's 2026-10-09 directive.

- [x] **Minor 1: the Revert lock is tested.** `disabled={isLocked}` on the panel's Revert
  (`ChangeDetail.tsx`) and on ⋮ Revert (`ChangeRow.tsx`) could be removed with every test green:
  the lock test had no sibling that offers Revert. The view test "disables every row of an
  element…" gains a published de row of the same element; while the en Publish is in flight its
  panel Revert is disabled, its ⋮ Revert is `aria-disabled`, a click opens no dialog, and Revert
  comes back once the publish settles.
- [x] **Minor 2: the lock's scope is said as it is.** The lock lives in the mounted Changes page
  (`useChangeActions`' state and ref), not in the tab: leaving the page and coming back while a
  write is still out starts unlocked, so that write can land inside a new Discard's window. The
  comment above `discardDraft` said "This page's own writes cannot land there"; it now says
  "this page's writes, while it stays mounted", and names the case. Added to the
  s81-version-restore-integrity follow-up (the compare-and-set in the staging PUT closes it too),
  here and in `docs/stories.md` (s70b entry).
- [x] **Minor 3: a write that never answers ends.** `send` had no timeout, so a request that never
  settled locked every row of its element until reload. **CTO decision:** every write request
  carries `AbortSignal.timeout(WRITE_TIMEOUT_MS)`, 30 s, the repo's existing fetch-timeout form
  (`src/lib/webhooks/manager.ts` `DELIVERY_TIMEOUT_MS = 30_000`). An aborted request throws, so it
  takes the existing uncertain path: "… may or may not have …", the element is read again, the
  lock is released. The message is unchanged ("The connection dropped before the server
  answered"): the page drops it. **Residual:** the reads inside the lock (Discard's pre-read, the
  re-read after a write) carry no timeout; they are shared with the list's own reads, which this
  pass does not change.
  `readElementChanges` gets an explicit page cap, `CHANGES_LIST_CEILING / CHANGES_PAGE_SIZE`
  (201: every page the route serves), so an answer that keeps offering a next page ends in a
  failure, and the non-advancing-offset mutation fails by assertion instead of exhausting the
  worker's heap.
- **Tests changed** (AGENTS.md § Tests): `ChangesView.test.tsx` "disables every row of an element
  while a write to it is in flight, and both settle…" is renamed "…and each settles as the server
  holds it": it seeds a third row (`CTA_DE`, published, same element) and asserts its panel and ⋮
  Revert locked, then Revert back after the publish. No assertion removed or loosened.
- **New tests:** hook actions — publish (POST) and Save as draft (PUT) never answered: still in
  flight at 29.999 s, at 30 s uncertain, read again, the element free (fake timers drive jsdom's
  `AbortSignal.timeout`); hook list — an element read whose next offset never stops follows exactly
  201 pages and resolves false, the rows as they were.
- **Mutations** (each guard neutralised alone, its test red, restored):

  | Guard | Red |
  |---|---|
  | panel Revert disabled by the element lock (`ChangeDetail.tsx`) | view "disables every row…" (`deRevert` not disabled) |
  | ⋮ Revert disabled by the element lock (`ChangeRow.tsx`) | view "disables every row…" (menuitem not `aria-disabled`) |
  | write requests carry `AbortSignal.timeout` | both "…gives up after 30 s…" (outcome never settles) |
  | element read page cap | "follows no more pages than the route serves…" (resolves true after 401 pages) |
  | element read refuses a non-advancing offset | "…does not move forward" — now by assertion (201 reads, expected < 10), no longer a heap crash |

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
