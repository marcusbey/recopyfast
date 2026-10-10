-- s70b: one row per content element, with its change state derived once
-- (ADR 054, docs/decisions/054-content-change-state-is-a-security-invoker-view.md).
--
-- WHY A VIEW. There is no status column. "Changed" compares columns of the
-- same row, and PostgREST cannot filter one column against another, so every
-- read before this returned every row of a site and the old Content page
-- filtered in the browser, after downloading all of them and waiting on the
-- ~4 s GET /api/sites. Two places derived the state, and they disagreed:
-- `getContentStatus` (ContentElementCard, deleted by s70b) ignored
-- attribute-only drafts, while the staging GET's `has_staging_changes` counts
-- them. This view is now the only derivation: the Changes page filters,
-- counts, pages and badges on `change_state`. A third copy in a route would
-- drift the same way.
--
-- WHY SECURITY INVOKER. A view runs with its OWNER's privileges unless told
-- otherwise, and the owner of anything a migration creates is `postgres`,
-- which bypasses RLS. A plain view over content_elements would therefore hand
-- every signed-in user every tenant's copy: a cross-tenant read, not a bug.
-- `security_invoker = true` makes the base tables' policies apply to the
-- caller, through the lateral staging_history read too:
--   - a site member sees their sites' rows (content_elements SELECT policy);
--   - only a site admin sees `changed_by` / `last_action` (staging_history is
--     admin-only by RLS, 20251230000000), everyone else reads NULL there;
--   - nobody sees another tenant's rows.
-- Never remove the option, and never turn this into SECURITY DEFINER: ADR 054
-- rejected both outright. content-changes-view.test.ts proves the mode with
-- real JWTs through the real PostgREST, never with the `postgres` role.
--
-- THE STATES, as the writers write them:
--   pending   — a draft whose text differs from the live text, or a staged
--               attribute that differs from the live one. The attribute test
--               is the publish RPC's own (20260924060000, `changed_attributes`):
--               a key merely carried with its live value is not a change, so
--               the set of pending rows is exactly what Publish would publish.
--   published — the live text differs from the original, or the row was
--               published at least once (`published_at`): an attribute-only
--               publish, or a revert published back to the original text.
--               bulk/update, bulk/import and /api/v1/content write
--               published_content without published_at; the text comparison
--               still catches them.
--   original  — neither. A draft equal to the live text ("Discard draft") is
--               original again.
--   changed_at is the draft's time for pending, else the publish time, else
--   the row's own updated_at.
--
-- GRANTS. Supabase's default privileges give a new relation in `public` ALL to
-- anon, authenticated and service_role (scripts/db/bootstrap-supabase-fixtures.sql
-- reproduces that), and a simple view is auto-updatable. Everything is revoked,
-- then SELECT alone is granted to the two roles that read it: the signed-in
-- dashboard (through RLS) and the service role. Nothing to anon or PUBLIC.
--
-- WATCH. A future column on content_elements does not reach this view unless
-- named here, which is the intent: a widened view is a widened read for every
-- member of every site. The projection is pinned by the DB suite.
--
-- POSTGRESQL 15+ ONLY, AND THE ONE CONDITIONAL. `security_invoker` arrived in
-- PostgreSQL 15. Production and the local Supabase stack run 15+
-- (supabase/config.toml major_version), and that is where this view is created
-- and where content-changes-view.test.ts proves it. CI also replays every
-- migration on a bare PostgreSQL 14 (scripts/run-db-invariants.mjs, the s38
-- privilege suites), and a migration must apply there too (s48 research):
-- written plainly, `WITH (security_invoker = true)` fails that replay with
-- "unrecognized parameter". So the statement is EXECUTEd only on 15+, and on
-- 14 nothing is created, with a WARNING. Never fall back to a view without
-- the option: on any version, a definer view here is a cross-tenant read. A
-- database without the view refuses the Changes read (the page shows its error
-- state); it never leaks.

DO $migration$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE WARNING
      'content_changes not created: PostgreSQL % has no security_invoker views, and ADR 054 forbids a definer view',
      current_setting('server_version');
    RETURN;
  END IF;

  EXECUTE $view$
    CREATE OR REPLACE VIEW public.content_changes
    WITH (security_invoker = true)
    AS
    SELECT
      ce.id,
      ce.site_id,
      ce.element_id,
      ce.page_path,
      ce.selector,
      ce.language,
      ce.variant,
      ce.metadata ->> 'type' AS element_type,
      ce.original_content,
      ce.published_content,
      ce.staging_content,
      ce.created_at,
      CASE
        WHEN state.is_pending THEN 'pending'
        WHEN ce.published_content IS DISTINCT FROM ce.original_content
          OR ce.published_at IS NOT NULL THEN 'published'
        ELSE 'original'
      END AS change_state,
      CASE
        WHEN state.is_pending THEN ce.staging_updated_at
        ELSE COALESCE(ce.published_at, ce.updated_at)
      END AS changed_at,
      latest.user_email AS changed_by,
      latest.action AS last_action,
      concat_ws(
        ' ',
        ce.original_content,
        ce.published_content,
        ce.staging_content,
        ce.page_path
      ) AS search_text
    FROM public.content_elements ce
    CROSS JOIN LATERAL (
      SELECT
        (
          ce.staging_content IS NOT NULL
          AND ce.staging_content IS DISTINCT FROM ce.published_content
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(CASE
            WHEN jsonb_typeof(ce.metadata -> 'staging_attributes') = 'object'
              THEN ce.metadata -> 'staging_attributes'
            ELSE '{}'::jsonb
          END) AS attribute
          WHERE (COALESCE(ce.metadata, '{}'::jsonb) - 'staging_attributes') -> attribute.key
            IS DISTINCT FROM attribute.value
        ) AS is_pending
    ) state
    LEFT JOIN LATERAL (
      SELECT sh.user_email, sh.action
      FROM public.staging_history sh
      WHERE sh.content_element_id = ce.id
      ORDER BY sh.created_at DESC
      LIMIT 1
    ) latest ON true
  $view$;

  EXECUTE $comment$
    COMMENT ON VIEW public.content_changes IS
      'One row per content element with its change state (pending | published | original), derived once. security_invoker: the caller''s RLS applies. ADR 054.'
  $comment$;

  EXECUTE 'REVOKE ALL ON public.content_changes FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT SELECT ON public.content_changes TO authenticated, service_role';
END
$migration$;
