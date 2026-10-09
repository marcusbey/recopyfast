# ADR 054 — A row's change state is derived in one security-invoker view

- Status: accepted (pending owner validation of the s70 plan)
- Date: 2026-10-08
- Scope: story s70-content-changes (lands in s70b-changes-page; s70c reads it)

## Context

The owner wants a "Changes" page: by default only the copy that differs from what ReCopyFast
first read, grouped by site and page, fast with thousands of discovered rows
(`docs/research/s70-content-changes.md`).

There is no status column. "Changed" is a comparison between columns of the same row:

- **pending**: `staging_content` is set and differs from `published_content`, or a staged
  attribute (`metadata.staging_attributes`) differs from the live one;
- **published**: `published_content` differs from `original_content`, or the row was published at
  least once (`published_at` set: an attribute-only publish, or a revert published back to the
  original text);
- **original**: neither.

Four forces:

1. **PostgREST cannot filter on one column against another.** Every existing read returns every
   row of a site (`GET /api/content/<id>`, `GET /api/staging/content/<id>`, both through
   `fetchPageScopedRows`), and the current page filters in the browser after downloading all of
   them.
2. **Today two places derive the state, and they disagree**: `getContentStatus`
   (`ContentElementCard.tsx:54-65`) ignores attribute drafts; the staging GET's
   `has_staging_changes` counts them. A third copy in a new route would drift too.
3. **Tenancy.** `content_elements` is readable by any member of the site under RLS; `staging_history`
   only by its admins. A new read must not need the service role (ADR 002, ADR 042).
4. **Who and when** live in `staging_history`, one row per draft save and per publish. The
   newest row per element is the "who".

## Decision

One view, `public.content_changes`, created `WITH (security_invoker = true)`:

- one row per `content_elements` row, with the columns the dashboard shows (ids, `site_id`,
  `element_id`, `page_path`, `selector`, `language`, `variant`, `metadata->>'type'` as
  `element_type`, the three texts, `created_at`);
- `change_state` (`'pending' | 'published' | 'original'`), computed once, with the definitions
  above, the attribute comparison written as the publish RPC writes it (`jsonb_each` over
  `staging_attributes`, `IS DISTINCT FROM` the live key);
- `changed_at`: `staging_updated_at` for pending, else `COALESCE(published_at, updated_at)`;
- `changed_by`, `last_action`: the newest `staging_history` row for the element, through a
  `LEFT JOIN LATERAL … ORDER BY created_at DESC LIMIT 1`.

Because the view runs as the caller, the base tables' RLS applies unchanged: a member sees their
sites' rows, and only an admin sees `changed_by`. `anon` gets no grant; `authenticated` gets
`SELECT`. The read routes (`GET /api/content/changes`, `…/[rowId]/history`) use the RLS server
client and never the service role.

The view is the only place the state is derived. `getContentStatus` is deleted with
`ContentElementCard` in s70b; the staging GET's `has_staging_changes` stays (the editor reads it)
and a DB test pins that both agree on the attribute case.

## Considered options

- **Filter in the browser (today).** Rejected: it downloads every row of every site and first
  waits on the ~4 s `GET /api/sites`.
- **Filter in a route, service role, in JavaScript.** Rejected: the route still reads every row
  from PostgREST per request, and it adds a service-role read path that has to earn its exception.
- **A stored generated column `change_state` on `content_elements`.** Rejected: it rewrites the
  table, makes every write pay for a dashboard concern, adds a column to the privilege decisions
  (AGENTS.md non-negotiable 9), and still cannot carry "who" (another table).
- **A `SECURITY INVOKER` SQL function with search and paging parameters.** Workable. Rejected for
  now: it puts paging, ordering and search in PL/pgSQL where PostgREST already does them on a
  view, and adds a function to the grant invariants. Reconsider if search needs ranking.
- **A `SECURITY DEFINER` view or function.** Rejected outright: it would bypass RLS, which is the
  tenant boundary.

## Consequences

- First view in the schema. The DB suites must prove, through the real PostgREST with real JWTs:
  member of site A sees no row of site B; `anon` is refused; an `edit` member gets
  `changed_by = NULL`; the three states and the attribute-only case.
- Filtering and paging run in Postgres: the default page reads only changed rows. At current scale
  (a plan allows at most 5 sites; thousands of rows per site) the per-row `CASE` is cheap. If it
  is not, the lever is a partial index on `content_elements (site_id, page_path)` whose predicate
  is the "changed" disjunction, queried through a boolean column of the view.
- Changing what "changed" means is a migration (`CREATE OR REPLACE VIEW`), reviewed like any.
- Writers that skip `published_at` (bulk update, bulk import, `/api/v1/content`) still land as
  "published" through the text comparison. A/B winners land as "pending" with no "who".
- Watch: a future column on `content_elements` does not reach the view unless named, which is the
  intent; a widened view is a widened read for every member.
