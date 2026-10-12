-- ============================================================
-- tool_reports: free-tool scan reports — service role only (s96, ADR 062)
-- ============================================================
-- WHAT. One row per free-tool scan (the Website Typo Finder first, the s97–
-- s101 tools next): the normalised URL (no query string, ever), the report
-- JSON a public report page renders, and a 30-day expiry. The same table is
-- the 24 h scan cache (cache_key = SHA-256 of tool + URL).
--
-- WHY NO anon POLICY. A report is public to whoever holds its link, so
-- "USING (true) TO anon" looks right — and it would let anyone holding the
-- public anon key run GET /rest/v1/tool_reports?select=* and list every
-- scanned address (pre-launch staging hosts included). Unguessable ids only
-- protect anything if there is no listing. So no web principal gets a policy
-- or a grant; the report page reads ONE row by id through the service role,
-- with a fixed projection (ADR 062; a named exception like ADR 046). Shape
-- precedent: editor_verification_codes (20260801100000:183-189). Revokes are
-- enumerated, never REVOKE ALL (20261008100000's reasoning).
--
-- IMMUTABLE ROWS. A report never changes after it is written: the service
-- role reads, inserts and deletes (expiry), and holds no UPDATE.
--
-- SIZE. The app caps a report's compact JSON at 12 KB
-- (src/lib/tools/report/report-schema.ts); report::text prints ", " and ": ",
-- so 16 KB here is the ceiling with headroom, not the app's budget. With at
-- most 5,000 rows (prune_tool_reports below) the table stays under ~80 MB on
-- Supabase Free's 500 MB — going over makes the whole database read-only.
--
-- ROLLBACK. A new forward migration dropping the function and the table.
-- Either deploy order is harmless: no reader exists before the app ships, and
-- the app answers 503 to scans and 404 to reports while the table is absent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tool_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tool        text        NOT NULL CHECK (tool ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  cache_key   text        NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  url         text        NOT NULL CHECK (char_length(url) <= 2048 AND url ~ '^https?://'),
  report      jsonb       NOT NULL CHECK (
                jsonb_typeof(report) = 'object'
                AND octet_length(report::text) <= 16384),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT tool_reports_expiry_after_creation CHECK (expires_at > created_at)
);

COMMENT ON TABLE public.tool_reports IS
  'Free-tool scan reports and the 24 h scan cache. Service role only; the report page reads one row by id (s96, ADR 062).';

CREATE INDEX IF NOT EXISTS tool_reports_cache_lookup_idx
  ON public.tool_reports (cache_key, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_reports_expires_at_idx
  ON public.tool_reports (expires_at);
CREATE INDEX IF NOT EXISTS tool_reports_created_at_idx
  ON public.tool_reports (created_at DESC);

ALTER TABLE public.tool_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages tool reports" ON public.tool_reports;
CREATE POLICY "Service role manages tool reports"
  ON public.tool_reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Supabase's default privileges hand anon, authenticated and service_role
-- every table privilege on a new public table. Take them back by name.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.tool_reports FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER
  ON public.tool_reports FROM service_role;
GRANT SELECT, INSERT, DELETE ON public.tool_reports TO service_role;

-- Expired rows first, then the oldest beyond the ceiling. One function: two
-- deletes are a multi-step write (AGENTS.md). INVOKER — it runs as the
-- service role that calls it, so function-grants.test.ts (SECURITY DEFINER
-- only) is not involved, and it can do nothing the caller could not.
-- Called daily by GET /api/cron/tool-reports-cleanup.
CREATE OR REPLACE FUNCTION public.prune_tool_reports(p_max_rows integer DEFAULT 5000)
RETURNS TABLE (expired bigint, trimmed bigint)
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  WITH e AS (DELETE FROM public.tool_reports WHERE expires_at <= now() RETURNING 1),
       keep AS (SELECT id FROM public.tool_reports
                WHERE expires_at > now()
                ORDER BY created_at DESC LIMIT greatest(p_max_rows, 0)),
       t AS (DELETE FROM public.tool_reports r
             WHERE r.expires_at > now() AND NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = r.id)
             RETURNING 1)
  SELECT (SELECT count(*) FROM e), (SELECT count(*) FROM t);
$$;
REVOKE EXECUTE ON FUNCTION public.prune_tool_reports(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_tool_reports(integer) TO service_role;

-- Postcondition: the push aborts if any web principal kept anything. Read
-- through has_*_privilege — which counts PUBLIC and inherited grants — rather
-- than information_schema, whose rows depend on who runs the migration.
-- `public` is how has_*_privilege names the PUBLIC pseudo-role.
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(o.offender, ', ' ORDER BY o.offender) INTO v_offenders
    FROM (
      SELECT w.role || ' ' || p.priv AS offender
        FROM (VALUES ('public'), ('anon'), ('authenticated')) AS w(role)
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
       WHERE has_table_privilege(w.role, 'public.tool_reports', p.priv)
      UNION ALL
      SELECT w.role || ' ' || p.priv || ' (column)'
        FROM (VALUES ('public'), ('anon'), ('authenticated')) AS w(role)
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
       WHERE has_any_column_privilege(w.role, 'public.tool_reports', p.priv)
      UNION ALL
      SELECT 'policy ' || pol.polname
        FROM pg_policy pol
       WHERE pol.polrelid = 'public.tool_reports'::regclass
         AND pol.polroles <> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'service_role')]
      UNION ALL
      SELECT w.role || ' EXECUTE prune_tool_reports'
        FROM (VALUES ('public'), ('anon'), ('authenticated')) AS w(role)
       WHERE has_function_privilege(w.role, 'public.prune_tool_reports(integer)', 'EXECUTE')
    ) AS o;

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'tool_reports is reachable by a web principal: %', v_offenders;
  END IF;
END $$;
