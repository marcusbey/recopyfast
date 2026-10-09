---
validated: yes
---
# Plan — Story s70a-embed-ui-not-content

> Part A of `docs/plans/s70-content-changes.md`, copied verbatim as that plan instructs ("Each
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

## Part A — s70a-embed-ui-not-content (3 tasks, complexity 2)

1. [x] **The embed's own UI is never content.**
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
