-- ========================================
-- The analytics alignment the 20260731005000/006000/007000 trio never applied
-- ========================================
-- Second and final instalment of the repair begun in
-- 20260818000000_repair_aborted_migrations.sql. That file recreated seventeen
-- absent TABLES. This one restores the absent COLUMNS and FUNCTIONS, which is a
-- quieter failure and a nastier one: the tables exist, so nothing 42P01s, and
-- the application simply writes to columns that are not there.
--
-- MEASURED, NOT INFERRED
-- ----------------------
-- 2026-08-17, live read-only pg_catalog / information_schema query against
-- production. The migration files in this directory have been wrong about this
-- database repeatedly; every claim below is from the probe.
--
--   57 tables in public, 0 unguarded (RLS on with >= 1 policy everywhere).
--
--   user_activity_logs   HAS  id, user_id, site_id, activity_type (NOT NULL +
--                             CHECK), element_id, metadata, ip_address,
--                             user_agent, referrer, created_at
--                        LACKS action_type, resource_type, resource_id,
--                             session_id, timestamp — and both indexes
--   site_analytics       HAS  page_views, unique_visitors, content_updates,
--                             avg_session_duration, bounce_rate, metadata,
--                             updated_at, UNIQUE(site_id, date)
--                        LACKS avg_load_time, conversion_rate, total_edits,
--                             active_editors
--   update_site_analytics()          ABSENT
--   update_translation_coverage()    ABSENT
--
-- WHAT THIS COSTS TODAY, at the application layer
-- -----------------------------------------------
--   • src/lib/analytics/tracker.ts:106 inserts action_type / resource_type /
--     resource_id / session_id / timestamp and never writes activity_type. Every
--     activity insert therefore fails twice over: unknown column, and a NOT NULL
--     violation on the legacy activity_type it does not supply.
--   • tracker.ts:213 selects `action_type, user_id, site_id, timestamp` — all
--     four are the new spelling; two of them do not exist.
--   • tracker.ts:222 selects * from site_analytics into `SiteAnalytics`
--     (src/types/index.ts:239-252), which declares avg_load_time,
--     conversion_rate, total_edits and active_editors required. All four are
--     absent, so the dashboard reads undefined for each.
--   • tracker.ts:395 calls rpc("update_site_analytics"), which does not exist.
--
-- WHY THE TRIO NEVER LANDED, AND WHAT IS LEFT OF IT
-- -------------------------------------------------
-- All three aborted in full and are marked applied, so none will re-run.
-- 20260801200000_missing_base_tables.sql:44-51 records the causes: each of them
-- touched a table that did not exist at the time. But that same file, and
-- 20260818000000, have since folded in most of what they intended. Re-checked
-- against the probe rather than assumed, here is what is actually left:
--
--   20260731006000_ab_testing_schema_alignment    NOTHING LEFT.
--     Fully satisfied. ab_tests carries traffic_split, success_metric and
--     created_by with ab_tests_created_by_fkey; ab_test_variants carries
--     content_element_id, variant_name and content, has name /
--     content_changes / variant_content all nullable with the right defaults,
--     and ab_test_variants_sync_trigger is attached. 20260801200000 folded the
--     whole file into its CREATE TABLEs. Nothing is emitted for it below —
--     restating satisfied DDL would misrepresent what is missing.
--
--   20260731005000_analytics_schema_alignment     PARTLY LEFT.
--     Its performance_metrics section is already satisfied: metadata present,
--     metric_name nullable, and performance_metrics_metric_type_check exists
--     carrying both vocabularies, plus idx_performance_metrics_site_recorded.
--     20260801200000:364-374 folded that in when it created the table.
--     Its user_activity_logs and site_analytics sections, and
--     update_site_analytics(), are what this file supplies.
--
--   20260731007000_rls_analytics_and_ab_tests     ONE POLICY LEFT.
--     Its RLS is otherwise live: performance_metrics, ab_tests and
--     ab_test_variants carry exactly its policy sets (via 20260801200000), and
--     site_analytics / user_activity_logs were given equivalent policies by
--     20260804130000. The single genuine gap is "Site members can view site
--     activity" on user_activity_logs — see section 4.
--
-- THE TRAP THIS FILE EXISTS TO AVOID
-- ----------------------------------
-- 20260809120000_lock_down_definer_functions cannot be applied until
-- update_site_analytics() and update_translation_coverage() exist, because
-- REVOKE has no IF EXISTS and it names both (at :138 and :143, ahead of the
-- three predicates 20260818000000 already supplied at :171-184).
--
-- It would therefore be very easy to "fix" this by creating the two functions
-- and nothing else. That would be worse than leaving it broken. A plpgsql body
-- is NOT name-resolved at CREATE time — only its syntax is checked — so a
-- function whose body writes site_analytics.total_edits or reads
-- user_activity_logs.timestamp creates perfectly cleanly against today's schema
-- and raises 42703 the first time the cron calls it. The REVOKE would succeed,
-- the migration would go green, and the defect would move from "function
-- missing" to "function raises in production", which is strictly harder to see.
--
-- So the columns their bodies touch are added in this same file, and section 7
-- does not take that on trust: it EXECUTES both functions inside a savepoint it
-- then rolls back. If either raises, this migration aborts and nothing lands.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------
--   • It does not drop activity_type or its CHECK. The column is redundant
--     (nothing writes it), but dropping a column is not reversible and the two
--     spellings coexist here exactly as `permission`/`role` do on
--     site_permissions. It is relaxed to nullable and backfilled from, never to.
--   • It adds no CHECK to action_type. src/types/index.ts:258 declares five
--     values ('page_view', 'content_edit', 'login', 'logout', 'api_call') and
--     the legacy activity_type CHECK admits a different five. Constraining the
--     new column to either list would reject writes the code makes today, and
--     20260731005000 deliberately added it unconstrained.
-- ========================================

-- ============================================================
-- 0. Preflight
-- ============================================================
-- Two of these are not "does the table exist" but "does the thing a function
-- body depends on at RUNTIME exist" — precisely the class of failure this file
-- is written to prevent, and invisible at CREATE FUNCTION time:
--
--   • update_site_analytics() ends with ON CONFLICT (site_id, date). Without a
--     unique constraint on exactly that column pair it raises 42P10
--     ("there is no unique or exclusion constraint matching the ON CONFLICT
--     specification") on first call, not on creation.
--   • update_translation_coverage() reads site_languages.translations and
--     writes site_languages.translation_coverage.
--
-- The whole file is one transaction, so raising here leaves the database
-- exactly as it was.
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_table   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.sites',
    'public.site_analytics',
    'public.user_activity_logs',
    'public.performance_metrics',
    'public.site_languages',
    'public.content_elements'
  ] LOOP
    IF to_regclass(v_table) IS NULL THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot repair the analytics alignment: prerequisite table(s) absent: %',
      array_to_string(v_missing, ', ');
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.site_analytics'::regclass
       AND c.contype IN ('p', 'u')
       -- attname is `name`, not `text`; the cast is load-bearing or this
       -- comparison fails with "operator does not exist: name[] = text[]".
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM unnest(c.conkey) AS k(attnum)
           JOIN pg_attribute a
             ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       ) = ARRAY['date', 'site_id']
  ) THEN
    RAISE EXCEPTION
      'Cannot create update_site_analytics(): site_analytics has no UNIQUE constraint on (site_id, date), which its ON CONFLICT requires. It would create cleanly and raise 42P10 on first call.';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['translations', 'translation_coverage'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'site_languages'
         AND column_name = v_table
    ) THEN
      RAISE EXCEPTION
        'Cannot create update_translation_coverage(): site_languages.% is absent, and its body would only fail at call time.',
        v_table;
    END IF;
  END LOOP;
END
$$;

-- ============================================================
-- 1. user_activity_logs   (from 20260731005000:36-70)
-- ============================================================
-- The migration shape and the code shape are two different tables wearing one
-- name. The code shape only ever existed in the loose
-- supabase/analytics-schema.sql, which `supabase db push` never runs.
--
-- created_at is NOT re-added: probed present. Everything else here is absent.
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS resource_type TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- activity_type is NOT NULL with a CHECK that admits
--   'page_view','content_edit','element_create','element_delete','site_access'
-- and tracker.ts:106 supplies none of them — it writes action_type instead. So
-- every insert fails the NOT NULL before it ever reaches the CHECK. Relaxing
-- the NOT NULL is what makes the table writable again; the CHECK can stay,
-- because a CHECK is satisfied by NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_activity_logs'
      AND column_name = 'activity_type'
  ) THEN
    EXECUTE 'ALTER TABLE user_activity_logs ALTER COLUMN activity_type DROP NOT NULL';

    -- Backfill the new column from the legacy one so historical rows still
    -- appear in the dashboard aggregations. Probed: 0 rows today, so this is a
    -- no-op in production and correct anywhere it is not.
    EXECUTE 'UPDATE user_activity_logs SET action_type = activity_type WHERE action_type IS NULL';
  END IF;
END
$$;

-- Historical rows written before `timestamp` existed keep their created_at.
UPDATE user_activity_logs SET timestamp = created_at
WHERE timestamp IS NULL AND created_at IS NOT NULL;

-- tracker.ts:213 filters on a timestamp range and by site_id; update_site_analytics()
-- below filters site_id + DATE(timestamp). Probed: user_activity_logs carries
-- only its primary key index today.
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_timestamp
  ON user_activity_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_site_timestamp
  ON user_activity_logs(site_id, timestamp DESC);

-- ============================================================
-- 2. site_analytics   (from 20260731005000:134-151)
-- ============================================================
-- All four are required by src/types/index.ts:239-252, which tracker.ts:222
-- casts a `select("*")` into, and total_edits / active_editors are written by
-- update_site_analytics() in section 5.
--
-- updated_at is NOT re-added: probed present. The UNIQUE(site_id, date) that
-- 20260731005000:143-151 guards for is probed present too
-- (site_analytics_site_id_date_key) and is asserted in the preflight rather
-- than re-created.
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS avg_load_time DECIMAL DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS conversion_rate DECIMAL DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS total_edits INTEGER DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS active_editors INTEGER DEFAULT 0;

-- ============================================================
-- 3. performance_metrics   —  NOTHING TO DO, and why
-- ============================================================
-- 20260731005000:75-129 adds metadata, drops the metric_name NOT NULL, replaces
-- the unnamed metric_type CHECK with a named one carrying both vocabularies,
-- and adds idx_performance_metrics_site_recorded.
--
-- Every one of those is already live. The table did not exist when that
-- migration ran, which is why it aborted; 20260801200000 later created it with
-- all of that intent already folded in (:364-374), and the probe confirms the
-- end state: metadata JSONB DEFAULT '{}', metric_name nullable,
-- performance_metrics_metric_type_check admitting
--   'load_time','api_response_time','edit_time','page_load','api_response',
--   'database_query','websocket_latency'
-- and both indexes present.
--
-- No statement is emitted. Restating satisfied DDL as IF NOT EXISTS no-ops
-- would read as "this was missing" to the next person and is exactly the
-- infer-from-the-file habit that produced this whole situation.

-- ============================================================
-- 4. The one RLS policy 20260731007000 still owes
-- ============================================================
-- Probed policy state on the five tables that migration covers:
--
--   performance_metrics   2  exactly its pair            (via 20260801200000)
--   ab_tests              5  exactly its set             (via 20260801200000)
--   ab_test_variants      5  exactly its set             (via 20260801200000)
--   site_analytics        2  equivalent pair             (via 20260804130000)
--   user_activity_logs    2  "Users can view their own activity" +
--                            "Service role can manage activity logs"
--
-- site_analytics is deliberately left alone. 20260731007000:29 would add "Site
-- members can view site analytics", which is the same EXISTS-over-
-- site_permissions predicate as the live "Users can view analytics for their
-- sites" — except that 20260804130000 scoped its version `TO authenticated`
-- while 20260731007000 wrote no TO clause, i.e. PUBLIC, i.e. including `anon`.
-- Policies are OR'd, so adding the older one would strictly WIDEN access to a
-- table that is already correctly covered. The stricter live policy wins.
--
-- user_activity_logs is the real gap: it has the per-user read but not the
-- per-site one, so a site admin cannot see activity on their own site under
-- their own session. Added below.
--
-- ONE-WORD DEVIATION, DECLARED: 20260731007000:85 writes this policy with no TO
-- clause. It is created `TO authenticated` here, to match the two policies
-- already on this table. The effect is identical — the predicate compares
-- against auth.uid(), which is NULL for `anon`, so an anonymous caller matches
-- no row either way — but making it explicit means the table does not carry one
-- policy that reads as anon-visible next to two that do not.
DROP POLICY IF EXISTS "Site members can view site activity" ON user_activity_logs;
CREATE POLICY "Site members can view site activity"
  ON user_activity_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = user_activity_logs.site_id
        AND sp.user_id = auth.uid()
    )
  );

-- ============================================================
-- 5. update_site_analytics()   (from 20260731005000:159-187)
-- ============================================================
-- Called by src/lib/analytics/tracker.ts:395 via rpc("update_site_analytics"),
-- on a client built at :34-36 with SUPABASE_SERVICE_ROLE_KEY. That is the only
-- caller in src/, server/ or scripts/ — the same conclusion 20260809120000:57-60
-- reached independently.
--
-- Body reproduced from 20260731005000 with one addition, declared:
-- SET search_path = public, pg_temp. A SECURITY DEFINER function without a
-- pinned search_path executes unqualified names against whatever the caller's
-- search_path happens to be, which is a privilege-escalation vector precisely
-- because the function runs as its owner. Every definer function written in
-- this repository since 20260731008000 pins it; this one predates that habit.
-- pg_catalog is implicitly searched first regardless, so DATE() and the
-- aggregates are unaffected, and every relation it touches lives in public.
CREATE OR REPLACE FUNCTION public.update_site_analytics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  site_record RECORD;
  analytics_date DATE := CURRENT_DATE;
BEGIN
  FOR site_record IN SELECT id FROM sites LOOP
    INSERT INTO site_analytics (site_id, date, page_views, unique_visitors, total_edits, active_editors)
    SELECT
      site_record.id,
      analytics_date,
      COUNT(CASE WHEN ual.action_type = 'page_view' THEN 1 END),
      COUNT(DISTINCT CASE WHEN ual.action_type = 'page_view' THEN ual.user_id END),
      COUNT(CASE WHEN ual.action_type = 'content_edit' THEN 1 END),
      COUNT(DISTINCT CASE WHEN ual.action_type = 'content_edit' THEN ual.user_id END)
    FROM user_activity_logs ual
    WHERE ual.site_id = site_record.id
      AND DATE(ual.timestamp) = analytics_date
    ON CONFLICT (site_id, date) DO UPDATE SET
      page_views      = EXCLUDED.page_views,
      unique_visitors = EXCLUDED.unique_visitors,
      total_edits     = EXCLUDED.total_edits,
      active_editors  = EXCLUDED.active_editors,
      updated_at      = NOW();
  END LOOP;
END;
$$;

-- 20260731005000:187 grants service_role and nothing else. That is not the same
-- as the function being private: Supabase ships
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
-- and PostgreSQL itself grants EXECUTE to PUBLIC on every new function, so a
-- bare CREATE leaves this reachable as a PostgREST RPC by any browser holding
-- the published anon key — and it is SECURITY DEFINER, so RLS would not stop it.
--
-- DECLARED DEVIATION: the REVOKE below is not in 20260731005000. It is lifted
-- from 20260809120000:138-141, which is the migration that would otherwise have
-- to close this the moment after this file opens it. Creating the function
-- already in its intended end state removes that window entirely; the REVOKE
-- there is idempotent and still applies cleanly afterwards.
REVOKE ALL ON FUNCTION public.update_site_analytics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_site_analytics() TO service_role;

-- ============================================================
-- 6. update_translation_coverage(UUID)   (from 20251230100000:430-460)
-- ============================================================
-- Not part of the trio: this one belongs to 20251230100000_edit_board.sql,
-- which is in the ledger while this function is absent — so that file, too,
-- did not fully apply. It is repaired here because it is the other name
-- 20260809120000 revokes on (:143), and because the file it belongs to is
-- eight months of migrations behind us and will never re-run either.
--
-- Body verbatim, with the same SET search_path addition and for the same reason
-- as section 5. site_languages and content_elements are both probed present,
-- and site_languages carries translations JSONB and translation_coverage
-- NUMERIC — asserted in the preflight, because both are call-time-only failures.
CREATE OR REPLACE FUNCTION public.update_translation_coverage(p_language_id UUID)
RETURNS DECIMAL
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site_id UUID;
  v_total_elements INT;
  v_translated_elements INT;
  v_coverage DECIMAL;
BEGIN
  SELECT site_id INTO v_site_id
  FROM site_languages WHERE id = p_language_id;

  SELECT COUNT(*) INTO v_total_elements
  FROM content_elements WHERE site_id = v_site_id;

  SELECT COUNT(*) INTO v_translated_elements
  FROM site_languages sl, jsonb_object_keys(sl.translations) k
  WHERE sl.id = p_language_id;

  IF v_total_elements > 0 THEN
    v_coverage := (v_translated_elements::DECIMAL / v_total_elements::DECIMAL) * 100;
  ELSE
    v_coverage := 0;
  END IF;

  UPDATE site_languages
  SET translation_coverage = v_coverage
  WHERE id = p_language_id;

  RETURN v_coverage;
END;
$$;

-- DECLARED DEVIATION, and this one is a narrowing rather than a restatement.
-- 20251230100000:520 grants EXECUTE to `authenticated`. That grant is exactly
-- what 20260809120000:143-146 exists to remove: the function is SECURITY
-- DEFINER, it takes a caller-supplied language id, it never compares that id to
-- anything the caller owns, and it WRITES (site_languages.translation_coverage).
-- Any holder of the anon key with a session could therefore rewrite the
-- coverage figure of any tenant's language row. There is no caller to break —
-- a search of src/, server/ and scripts/ finds none, which 20260809120000:60
-- also concluded. So the `authenticated` grant is not reproduced, and the
-- function is created directly in the state that migration wants it in.
REVOKE ALL ON FUNCTION public.update_translation_coverage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_translation_coverage(UUID) TO service_role;

-- ============================================================
-- 7. Prove the functions RUN, not merely that they exist
-- ============================================================
-- The whole point of this file. A plpgsql body is syntax-checked at CREATE time
-- and name-resolved at CALL time, so everything above could succeed while both
-- functions raise 42703 on the first cron tick.
--
-- 7a. Static check first: every column the two bodies touch. This is what
--     catches the case the smoke test below cannot — if `sites` were empty,
--     update_site_analytics()'s loop body would never execute and calling it
--     would prove nothing at all.
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_pair    TEXT;
BEGIN
  FOREACH v_pair IN ARRAY ARRAY[
    -- update_site_analytics()
    'site_analytics.site_id',        'site_analytics.date',
    'site_analytics.page_views',     'site_analytics.unique_visitors',
    'site_analytics.total_edits',    'site_analytics.active_editors',
    'site_analytics.updated_at',
    'user_activity_logs.site_id',    'user_activity_logs.action_type',
    'user_activity_logs.user_id',    'user_activity_logs.timestamp',
    'sites.id',
    -- update_translation_coverage()
    'site_languages.id',             'site_languages.site_id',
    'site_languages.translations',   'site_languages.translation_coverage',
    'content_elements.site_id'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = split_part(v_pair, '.', 1)
         AND column_name  = split_part(v_pair, '.', 2)
    ) THEN
      v_missing := array_append(v_missing, v_pair);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Repair is cosmetic: the function bodies reference column(s) that do not exist: %',
      array_to_string(v_missing, ', ');
  END IF;
END
$$;

-- 7b. Then actually call them, inside a savepoint that is rolled back so the
--     smoke test writes nothing.
--
--     The inner BEGIN ... EXCEPTION block IS a savepoint: when an exception
--     leaves it, every database change made inside is undone. PL/pgSQL variables
--     are not — they keep the values they had when the error hit — which is what
--     makes `v_ok` a reliable record of whether the call itself succeeded before
--     the deliberate abort. A genuine failure is re-raised and takes the whole
--     migration with it, which is the correct outcome: better no repair than a
--     function that is present and broken.
DO $$
DECLARE
  v_ok        BOOLEAN := false;
  v_sites     INTEGER;
BEGIN
  SELECT count(*) INTO v_sites FROM sites;

  BEGIN
    PERFORM public.update_site_analytics();
    PERFORM public.update_translation_coverage(gen_random_uuid());
    v_ok := true;
    -- Deliberate abort of this savepoint. Nothing the two calls wrote survives.
    RAISE EXCEPTION 'rcf: rolling back the smoke test';
  EXCEPTION
    WHEN OTHERS THEN
      IF NOT v_ok THEN
        RAISE;
      END IF;
  END;

  IF v_sites = 0 THEN
    RAISE WARNING
      'update_site_analytics() was called but sites is empty, so its loop body never executed and its column references went unverified. The static check in 7a is the only guarantee here.';
  ELSE
    RAISE NOTICE
      'Smoke test passed: update_site_analytics() ran over % site(s) and update_translation_coverage() ran; all writes rolled back.',
      v_sites;
  END IF;
END
$$;

-- ============================================================
-- 8. Postcondition — the RLS invariant, over the whole schema
-- ============================================================
-- Non-negotiable 6 of AGENTS.md. As measured on 2026-08-17 all 57 tables in
-- public have RLS on with at least one policy, and 20260818000000 was written
-- so as not to break that. This file adds a policy and no table, so it cannot
-- introduce a gap — but asserting the invariant globally rather than over its
-- own additions is nearly free and turns a silent regression anywhere in the
-- schema into a failed deploy.
--
-- If this fires, the offending table may well predate this migration; the error
-- names it either way. Runs in the same transaction as everything above, so a
-- failure rolls the entire repair back.
DO $$
DECLARE
  v_bad   TEXT[] := ARRAY[]::TEXT[];
  v_row   RECORD;
  v_total INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT c.relname AS name,
           c.relrowsecurity AS rls,
           (SELECT count(*)::int FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    v_total := v_total + 1;
    IF v_row.rls IS NOT TRUE OR v_row.policies = 0 THEN
      v_bad := array_append(
        v_bad,
        format('%s (rls=%s, policies=%s)', v_row.name, v_row.rls, v_row.policies)
      );
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION
      'Repair aborted: % of % table(s) in public lack RLS or have zero policies: %',
      array_length(v_bad, 1), v_total, array_to_string(v_bad, ', ');
  END IF;

  RAISE NOTICE
    'Analytics alignment complete: % tables in public, every one with RLS on and at least one policy.',
    v_total;
END
$$;
