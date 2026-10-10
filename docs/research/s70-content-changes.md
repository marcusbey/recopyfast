# Research — Story s70-content-changes

Branch `feature/s70-content-changes`, from `origin/main` `828970c` (s66c1, s67, s68a/b/c merged;
s66c2 in flight). Every claim below was read in the current code; line numbers are on that commit.
No production data was read or changed.

## The five structuring facts

1. **The embed still records its own UI as site copy, from three surfaces, and the cause is a
   skip list with a wrong id and two unmarked roots.** `shouldSkipElement`
   (`public/embed/recopyfast.src.js:2704-2712`) skips `#rcf-edit-board`, an id no element has: the
   Edit Board panel is `#rcf-edit-board-panel` (`:6106`). The AI suggestions modal builds its own
   overlay with inline styles and no class, id or marker (`:5560-5561`, appended `:5649`). The
   form-field popover is `.rcf-form-popover` (`:5404`), and nothing skips that class. A jsdom
   probe that boots the real source and opens every embed surface shows all three mapped **and
   POSTed** to `/api/content/<site>`: "🪄", "Generate Suggestions", "Failed to generate
   suggestions. Please try again.", "AI Content Suggestions", "Optimization Goal", "Close"; the
   Edit Board's "Edit Board", tab labels, "Restore", "Save Current Version" and **"by
   <editor email>"**; the popover's "Edit Form Field", "Placeholder", "Default Value", "Cancel",
   "Save". The probe's AI-modal selector is `div:nth-child(5) > div > button:nth-child(3) >
   span:nth-child(1)`, the exact shape of the owner's production evidence (`div:nth-child(7) > …`).
   The editor bar (`#rcf-editor-banner`) is **no longer** reported: it gained `data-rcf-ignore` on
   2026-09-19 (`cdfaf44`, `:1481`); rows recorded before that date remain.
2. **The fix is byte-negative.** Marking the two unmarked roots `data-rcf-ignore`, correcting the
   id, and folding the six skip checks into one `closest()` selector measures **45,839 / 33,072**
   gz against the ceilings 45,841 / 33,073 (net −2 / −1; the additions alone are +5 / +7, the
   consolidation −7 / −8), measured with `scripts/build-embed.mjs` itself on a copy of the tree.
   All 271 behavioural embed tests pass on the fixed source. No ceiling moves up.
3. **Today's Content page cannot show what changed, by construction.** It reads
   `GET /api/content/<id>` per site (`src/app/dashboard/content/page.tsx:159-161`), the widget's
   read, whose select has no `staging_content` and no `updated_at`
   (`src/app/api/content/[siteId]/route.ts:393-396`). So "Pending" can never appear
   (`ContentElementCard.tsx:54-65` needs `stagingContent`), "Last edited" is "—" for every
   never-published row, and every row of every site is downloaded to render 10 cards a page. It
   first waits on `GET /api/sites` (`page.tsx:130`), the ~4 s route (fact 5). The "View" and
   "Edit" buttons open `?rcf_highlight=` and `?rcf_staging=1&rcf_edit=` on the homepage
   (`page.tsx:396-407`): the embed reads neither parameter (no match in `recopyfast.src.js`), and
   both ignore the row's page.
4. **The data holds two change states, not three, and everything a "Changes" view needs.**
   `content_elements` carries `original_content`, `published_content`, `staging_content`,
   `staging_updated_at/by`, `published_at/by`, `page_path`, `selector` and `metadata.type` (the
   tag name). "Pending" = a draft that differs from the live text; "published" = live text that
   differs from the original. Today's "Edited" badge already means the second ("Edited and live on
   your site", `src/components/ui/status-badge.tsx:166-170`). Who and when live in
   `staging_history` (`user_email`, `action`, `created_at`, one row per draft save and per
   publish). Postgres cannot be asked "published ≠ original" through PostgREST (no
   column-to-column filter), so server-side filtering needs a view or a function (ADR 054).
5. **Revert and history are supported by composition, not as features.** Per-element revert =
   `PUT /api/staging/content/<site>` with the original text (first-party owner path,
   `route.ts:206-222`; plan gate `checkOwnerCanEdit`; atomic RPC `save_staging_content_atomic`),
   then `POST /api/staging/publish` with `elementIds: [id]` (`publish/route.ts:170-186`). Both are
   existing, audited, rate-limited write paths. Per-element history has data (`staging_history`)
   and no read route; RLS lets only site admins read it
   (`20251230000000_staging_workflow.sql:144-153`). Site-wide restore exists separately
   (`content_versions`, `edit-board/history/[versionId]` POST, stages the whole snapshot).

## Target story

As a site owner, the Content page tells me what copy changed on my sites — edited, pending and
published — grouped by site and page, in human-readable locations, so I can review, compare,
revert or open it on the page without scrolling through hundreds of untouched strings.
Accepted direction (owner, 2026-10-08): a "Changes" page; default edited/pending/published,
"all discovered text" a filter; grouped site → page; dense rows with a readable location, the
current text, expand-to-compare with the original, status, who/when, actions (open on the page,
history, revert where supported); the same view as a "Content" tab on the s66c site pages; junk
rows from the embed's own UI excluded and the discovery bug fixed at the source.

## Premise check

| Story assertion | Verdict |
|---|---|
| "No grouping by site or page, no pagination" | Grouping: true. Pagination: **exists** (10 cards/page, `page.tsx:56,278-282`) but is client-side, after downloading every row of every site. |
| Untouched "Original" rows dominate | True: the default filter is "All Status" (`page.tsx:115-117`) and discovery creates one row per element. |
| Default view "edited, pending and published" | **Two states exist**, not three (fact 4). "Edited" is today's word for "published". Design proposes Pending + Published; owner question 1. |
| The embed's own UI was recorded; does post-s67 still report it? | **Yes**, three surfaces (fact 1). The editor-bar rows are historical. |
| "revert where the product supports it" | No per-element revert operation; composable from two existing routes (fact 5). |
| "history" | Data exists; no read route; admin-only by RLS. |
| "open on the page" | Today's links are dead (fact 3). A plain link to `https://<domain><page_path>` works with no embed change; highlighting the element on arrival would need embed bytes. |

## Current state of the code

### The Content page (`src/app/dashboard/content/page.tsx`, 467 lines)

- `fetchSites` → `GET /api/sites` (`:129-149`), throws on non-list (good error semantics, kept).
- `fetchSiteContent` per site → `GET /api/content/<id>?token=` (`:152-192`), mapped into
  `ContentElement` with `currentContent = current_content || original_content` and
  `lastModified = updated_at || published_at` (`:176-191`). `Promise.allSettled` keeps per-site
  failures inline (`:207-241`, `SiteFailureNotice`).
- Filtering (search across id/original/current/domain, site, status) and pagination are all
  client-side (`:257-298`). Status options: All, Original, Edited, Pending (`ContentFilterBar.tsx:96-99`).
- Each element is a `ContentElementCard` (`src/components/dashboard/ContentElementCard.tsx`):
  header = element id in mono + domain + page path + selector (`:136-166`), body = Original / Live /
  Staging blocks (`:169-222`), footer = "Last edited" + View / Edit / History (`:225-273`).
  `onHistory` is never passed, so History never renders.
- `PageShell title="Content" description="Manage all editable content across your sites"`
  (`:460-463`), pinned by `e2e/app-layout.spec.ts:665-669`.
- Tests: `src/__tests__/app/dashboard/content-load-states.test.tsx`,
  `content-page-shell.test.tsx`, `content-partial-failure.test.tsx`,
  `src/components/dashboard/__tests__/ContentFilterBar.test.tsx`; the sidebar and breadcrumb
  tests name `/dashboard/content` (`DashboardNavigation.test.tsx:207,322`,
  `Breadcrumbs.test.tsx:54`); `page-shell-guard.test.ts:485`; `middleware.test.ts:186`.
- Other links: sidebar "Content" (`DashboardNavigation.tsx:46`); Overview "Total edits" metric
  (`src/app/dashboard/page.tsx:252`).

### The read routes

| Route | Auth | Columns | Notes |
|---|---|---|---|
| `GET /api/content/[siteId]` | first-party session, else site token + Origin | public projection, no staging, no `updated_at` (`:393-396`) | Widget read. Pages 1,000 rows at a time (`paged-elements.ts`). `current_content` = published ?? original (`:441-444`). |
| `GET /api/sites/[siteId]/content-elements` | `authorizeSiteReadAccess` (RLS read of `site_permissions`) | same public projection | Used by the A/B element picker (`useContentElements.ts:34`). |
| `GET /api/staging/content/[siteId]` | first-party "view", else editor token | adds `staging_content`, `staging_updated_at/by` (`:107`) | All rows, no filter by state, no `published_by`, no history. |
| `GET /api/edit-board/history?siteId` | first-party "view", else staging token | `content_versions` list | Site-wide snapshots, not per element. |
| `POST /api/bulk/export` | session + permission | all rows, filters language/variant/element_ids/updated_since | PRD #19 export; lives in site Settings › Import & export. Out of scope here. |

No route returns rows filtered by change state, and none paginates to the browser.

### The write routes a Changes view can reuse

| Action | Route | Gate |
|---|---|---|
| Save a draft (revert to original, discard draft) | `PUT /api/staging/content/<site>` `{elementId, content, language, variant}` | first-party `edit` (`:206-222`), per-site fail-closed limiter, `checkOwnerCanEdit` (402), RPC writes the draft and a `staging_history` row atomically (`:306-318`) |
| Publish one element | `POST /api/staging/publish` `{siteId, elementIds}` | first-party `publish` (`:86-100`), plan gate, RPC `publish_staging_content_with_attributes_atomic` (`20260924060000:9-103`) sets `published_at/by`, clears the draft, writes a `publish` history row |
| Open edit mode | `POST /api/edit-sessions/create` via `useEditSession` | the edit URL is `https://<domain>?rcf_edit_token=…` (`edit-sessions/create/route.ts:143`), homepage only; `validEditUrl` keeps it on the registered host (`useEditSession.ts:92-104`) |

### Data model (verified in migrations)

- `content_elements` (`20250817000000:26-39`): `id, site_id, element_id, selector,
  original_content, current_content, language, variant, metadata, created_at, updated_at`,
  `UNIQUE(site_id, element_id, language, variant)`. Staging columns
  (`20251230000000:12-18`): `staging_content, published_content, staging_updated_at,
  staging_updated_by, published_at, published_by`. `page_path` (`20260924030000:8-12`), indexed
  `(site_id, page_path)`; also `(site_id, language, variant)` (`20260611050000:19`).
- `staging_history` (`20251230000000:77-93`, plus `previous_metadata/new_metadata`):
  `content_element_id, staging_access_id, previous_content, new_content, user_email, action
  ('create'|'update'|'publish'|'revert'), created_at`, indexed on `content_element_id`. Nothing
  writes `'revert'` today.
- `content_history` (`20250817000000:42-49`): written by the `log_content_change` trigger on
  **every insert** ('create') and every `current_content` change (`20260809130000:72-112`). So
  every discovered element adds a history row.
- `content_versions` (`20251230100000_edit_board.sql:53-75`): site snapshots for the Edit Board
  and the dashboard's Version history panel.
- Statuses: there is no status column. Derived today by `getContentStatus`
  (`ContentElementCard.tsx:54-65`) and, differently, by the staging GET's `has_staging_changes`
  (`staging/content/route.ts:145-149`, which also counts attribute-only drafts).
- Writers that skip `published_at`: `bulk/update` (`:311-317`), `bulk/import` (`:731-734`),
  `v1/content` (`:294-300`, `:318`) write `published_content` directly. The A/B winner stages
  `staging_content` with no history row (`src/lib/ab-testing/lifecycle.ts:186-194`).
- RLS and grants: `authenticated` SELECT on `content_elements` for any site member
  (`20250817000000:452-459`; SELECT untouched by `20260928140000:91-102`); `staging_history`
  SELECT for site **admins** only (`20251230000000:144-153`, `:273`; anon revoked
  `20260818010000:74`); `sites` columns `id, domain, name, …` granted to `authenticated`
  (`20260925120000:36-39`); `site_permissions` self-read (`20260731008000:93-96`). A
  security-invoker read therefore needs no service role.

### The ~4 s `GET /api/sites` (`src/app/api/sites/route.ts`)

Per request: `getUser()` (Auth round trip), `site_permissions`, `sites`, then per site in
parallel: an exact count, **every element id** through `fetchPageScopedRows` (1,000-row pages
with no exact count, so ⌈N/1000⌉ + 1 sequential round trips, `:75-90`), then
⌈N/200⌉ batches × 2 `content_history` queries with 200 UUIDs in the URL (`:99-139`). For a
3,000-element site that is ~8 sequential round trips and 30 concurrent ~7 KB requests, for one
number (`edits_count`) that counts discovery inserts as edits (the trigger above) and one
`last_activity`. The Content page depends on it today (`page.tsx:130`). So does `SiteProvider`
(every s66c site page). The Changes design does not call it: its route reads the caller's sites
with one RLS select. Shrinking `/api/sites` itself is out of scope (follow-up: drop or defer the
history stats).

### Embed discovery, post-s67

- Scan selector `h1-h6, p, span, li, td, th, label, button, a.rcf-editable-link, img,
  div[data-rcf-content]` (`:2656-2657`); text shorter than 2 code units is skipped, so "🪄"
  (two UTF-16 units) passes and "✨" or "×" (one) do not.
- Any added node schedules a rescan within 200–1,000 ms (`setupMutationObserver`, `:3924-3960`),
  so opening a modal is enough. `postContentMap` reports ids the server does not hold, first
  report at once, then at most every 10 s and 10 per page view (`:3158-3245`, POST at `:3229`). Discovery upserts
  `ignoreDuplicates` (`content route :649-651`): a junk row, once written, stays.
- `generateSelector` stops at the first ancestor with an id and drops `rcf-` classes
  (`:2840-2873`), so embed roots without an id produce bare `div:nth-child(N) > …` selectors.
- Every root the embed appends, and whether discovery skips it:

| Root | Where | Skipped by | Discovered today |
|---|---|---|---|
| Editor bar `#rcf-editor-banner` | `:1478-1481` | `data-rcf-ignore` | No (yes before 2026-09-19) |
| `createOverlay()` modals: editor code, verification, publish confirm, staging error, image editor | `:2467-2469` | `.rcf-overlay` | No |
| Staging bar `#rcf-staging-banner` | `:2198` | its id | No |
| Hover hint, text-edit toolbar, counter, field panel, animation badge | `:4063-4066`, `:4605-4666`, `:5356` | `data-rcf-ignore` | No |
| Container hint `.rcf-container-hint` | `:5536` | none, but a text `div` is not in the scan selector | No |
| **Edit Board panel `#rcf-edit-board-panel`** | `:6105-6106`, `:6156` | **nothing**: the check names `#rcf-edit-board` | **Yes** |
| **AI suggestions modal** | `:5560-5649` | **nothing** | **Yes** |
| **Form-field popover `.rcf-form-popover`** | `:5403-5465` | **nothing** | **Yes** |

- Side effect of the same bug: a discovered embed node is stamped `data-rcf-id`, so in edit mode
  the document click handler (`setupEditMode`, `:4011-4030`) treats the modal's own label as an
  editable element. Inferred from the code path; not separately probed.
- Privacy: rows are public. `GET /api/published/<site>` serves every row of a page to anyone with
  the site id (ADR 046, `public-rows.ts`), so the Edit Board's "by <editor email>" span became a
  public string.
- The embed is served `max-age=0, must-revalidate` (`next.config.ts:61-65` comment: "just like
  the production embed"), so the fix reaches every page view at deploy; no server-side filter is
  needed for stale copies.

## Anchor points

- Embed: `shouldSkipElement` (`:2704-2712`), `showAISuggestions` overlay (`:5560`),
  `startFormEdit` popover (`:5403-5404`). Byte gate: `scripts/build-embed.mjs:261-262`,
  `src/__tests__/embed/build-size-gate.test.ts:95-96`.
- Probe pattern for a regression test: `src/__tests__/embed/embed-spa.test.ts:1-160` (boot the
  real IIFE, stub `fetch`, settle) and `ai-suggest-credentials.test.ts` (drive the AI modal).
- Data: a new migration for the read view and one for the junk cleanup; DB suites in
  `src/__tests__/db/` must be **named** in the CI step at `.github/workflows/ci.yml:286-299`.
- Page: `src/app/dashboard/content/` (to be moved), `DashboardNavigation.tsx:46`,
  `Breadcrumbs.tsx:20-29`, `next.config.ts:103-113` (`redirects()`), Overview metric
  (`dashboard/page.tsx:252`).
- Site tab: `SITE_PAGES` (`src/components/dashboard/site/SiteSubnav.tsx:11-16`),
  `useSitePageShell` (`site/useSitePageShell.tsx`), `useSiteContext()` (site, permission, domain).
- Reusable UI: `PageShell`, `Card`, `StatusBadge` + `contentStatuses`, `Button`, `DropdownMenu`,
  `Input`, `NativeSelect`, `Skeleton`, `EmptyState`, `Alert`, `Dialog`, `ContentValue`
  (images and data URIs), `useEditSession`, `date-fns` `formatDistanceToNow` (as `SiteRow.tsx:5`).

## Verified APIs / functions

- `authorizeSiteReadAccess(siteId)` → RLS `site_permissions` read (`src/lib/security/ingest-auth.ts:126-150`).
- `authorizeFirstPartyEditorAccess(siteId, "view")` + `requireEditorPermission(access, level)`
  (`src/lib/auth/editor-access`), used by the staging and publish routes.
- `enforceRateLimit(request, { limit, endpoint, identifierType, onStoreFailure })`
  (`src/lib/api/rate-limit`).
- `fetchPageScopedRows` (`src/lib/content/paged-elements.ts:84-106`): not needed by the new route
  (it paginates to the browser instead).
- `useEditSession(domain).openEditSession({siteId, permissions, durationHours})`
  (`src/hooks/useEditSession.ts:106-152`); `editPermissionsForGrant(grant)`.
- `SiteContextValue` (`SiteProvider.tsx:88-113`): `site` (id, name, domain, status, permission),
  `isAdmin`.
- `sanitizeIncomingContent` = DOMPurify `BASIC_TEXT` (`site-auth.ts:319-321`): plain text without
  `<` round-trips byte for byte; `"a < b"` is stored as `"a &lt; b"` (measured with the repo's
  DOMPurify). Every editor save already has this property.

## What a human-readable location can use, with no new embed bytes

| Signal | Source | Gives |
|---|---|---|
| `page_path` | row (NULL = an author-declared id shared across pages) | "Homepage", "Pricing", "Blog › How we ship", "Every page" |
| `metadata.type` | discovery (`type: tagName`) | h1 "Main heading", h2 "Heading", p "Paragraph", button "Button", a "Link", img "Image", li "List item", label "Form label" |
| Selector segments | row | landmarks (`header`, `nav`, `footer`, `aside`, `form`), the anchoring `#id` (humanized, framework roots like `#root`/`#__next` skipped), semantic class words (`hero`, `pricing`, `faq`, …); a `span` inside `button`/`a` reads "Button label"/"Link text" |
| Author `data-rcf-id` | `element_id` not starting `rcf-` | "Hero title" from `hero-title` |
| The text itself | row | the primary identifier in the row; the label is secondary |

What a small embed addition would buy: the nearest preceding `h1`–`h3` text ("in the 'Plans'
section"), which the selector cannot recover once it stops at an id. Measured on top of the fix:
**+94 / +94 gz, unfunded** (0 headroom). Not proposed for s70; recorded as a follow-up option.

## Traps & constraints

- **Byte ceilings only go down.** The fix lands at 45,839 / 33,072; the ratchet comment in
  `build-embed.mjs` and `build-size-gate.test.ts` must itemize it. Rebuild the artifact
  (`npm run build:embed`), never edit `recopyfast.js`.
- **The six skip checks are order-insensitive** (each returns `true`), and `closest()` includes
  the element itself, so `hasAttribute('data-rcf-ignore')` is redundant with
  `closest('[data-rcf-ignore]')`. Folding them is behaviour-neutral (271/271 embed tests).
- **Cleanup must never delete an edited row.** Junk rows can be edited in principle (an owner
  clicking the modal's label in edit mode). Guard: `staging_content IS NULL AND
  published_content IS NOT DISTINCT FROM original_content` and no staged attributes.
- **Ambiguous strings** ("Close", "Save", "Cancel", "Placeholder") are real copy on many sites:
  match them only with the embed root's selector shape. The AI suggestion paragraphs have
  arbitrary text and a common shape: list them for review, do not delete by pattern.
- Deleting rows fires `content_change_delete_trigger` (BEFORE DELETE, `20260809130000`) and the
  public-revision statement trigger (`20261005000000`): both are designed for it.
- **A view is a first** in this schema (no `CREATE VIEW` in any migration). It must be
  `security_invoker = true` (PG 15, `supabase/config.toml:28`) or it would bypass RLS; `anon`
  revoked; DB tests must prove cross-tenant isolation through PostgREST.
- `staging_history` is admin-only by RLS: an `edit`/`view` member sees no "who". Fine, but the UI
  must not render that as "unknown editor" claims; it renders the time only.
- `user_email` can hold a user id or an access kind (`p_user_email: access.email ||
  access.userId || access.kind`, `staging/content/route.ts:316`). Render only values with `@`.
- `metadata.type` is the tag name (`img`), while `classifyContent` looks for `"image"`
  (`content-value.tsx:35`); images are still caught by URL shape. Use the tag for labels.
- Publishing by `elementIds` publishes every language/variant draft of that `element_id`.
- `PUT` sanitizes: an original containing `<` does not round-trip (above). Existing behaviour for
  every save; the revert test must pin ordinary copy (`&`, quotes, dashes, emoji) byte for byte.
- `page-shell-guard.test.ts:485` lists `src/app/dashboard/content/page.tsx`; moving the route
  moves that entry. `e2e/app-layout.spec.ts:665-669` pins the page's description and nav label.
- **Never run `next dev`** (it appends to AGENTS.md). Local captures use the build plus the
  in-memory Supabase stand-in, with every list fulfilled by `page.route`.
- Playwright contract: `expected: 78` at `828970c` (`playwright.config.ts:14`,
  `.github/workflows/ci.yml:215,398`); `feature/s66c2-quick-setup` raises it to 80. Each part
  raises it by exactly its own new tests, on whatever main holds when it branches.

## Open questions

1. Status words: two states (Pending, Published) — or does the owner mean something else by
   "Edited"? (design default: two; "Edited" retired.)
2. Junk cleanup: delete the certain rows by migration and list the uncertain ones? Needs a
   read-only count first; nobody has looked at production for this story.
3. Revert: draft only, or draft plus "Revert and publish" for publishers?
4. URL: move `/dashboard/content` to `/dashboard/changes` with a permanent redirect?

## Real complexity

The story is scored **TBD** in `docs/stories.md`. After reading the code: **5** as one story. It
spans the embed (byte-funded fix and its ratchet), production data (a cleanup migration), a new
database object with RLS proofs, two read routes, a page rebuild, a route move and a site tab, each
with its own test layer. Split into three, each shippable alone:

## Split proposal

- **s70a-embed-ui-not-content** (complexity 2). The skip fix and the junk cleanup migration.
  Closes the source of the junk and the public email leak on its own; no UI. Embed −2 / −1 gz.
- **s70b-changes-page** (complexity 4). The view (ADR 054), the list and history read routes, the
  location labeller, the global "Changes" page with grouping, compare, history and revert via the
  existing write routes, the route move. Depends on s70a only for clean data (not for code).
- **s70c-site-content-tab** (complexity 2). The "Content" tab under a site, reusing s70b's view
  component with the site fixed. Depends on s70b.
