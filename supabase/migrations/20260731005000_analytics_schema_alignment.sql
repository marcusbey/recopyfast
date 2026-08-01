-- ========================================
-- Analytics Schema Alignment + update_site_analytics()
-- ========================================
-- user_activity_logs, performance_metrics and site_analytics exist in
-- migrations/ but with the column set from 20250817000000_complete_database_setup,
-- which is NOT the column set the application reads and writes.  The shape the
-- code uses only ever existed in the loose supabase/analytics-schema.sql.
--
--   user_activity_logs
--     migration : activity_type (NOT NULL + CHECK), element_id, created_at
--     code      : action_type, resource_type, resource_id, session_id, timestamp
--                 (src/lib/analytics/tracker.ts:64 insert, :145 select)
--     → inserts currently fail on the activity_type NOT NULL violation, and the
--       dashboard select on `timestamp` fails on an undefined column.
--
--   performance_metrics
--     migration : metric_name NOT NULL, unit, labels,
--                 metric_type CHECK ('page_load'|'api_response'|
--                 'database_query'|'websocket_latency')
--     code      : metadata, metric_type IN ('load_time'|'edit_time'|
--                 'api_response_time')  (tracker.ts:91)
--     → inserts currently fail on both the NOT NULL and the CHECK.
--
--   site_analytics
--     migration : content_updates, avg_session_duration
--     code/fn   : avg_load_time, conversion_rate, total_edits, active_editors
--
-- Every change here is additive or constraint-relaxing, and each step is guarded
-- so the migration is a no-op whether the database currently has the migration
-- shape, the loose-schema shape, or both.
-- ========================================

-- ============================================================
-- user_activity_logs
-- ============================================================
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS resource_type TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- The legacy activity_type column is NOT NULL with a CHECK the code never
-- satisfies (it writes action_type instead).  Relax it if it is present.
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
    -- appear in the dashboard aggregations.
    EXECUTE 'UPDATE user_activity_logs SET action_type = activity_type WHERE action_type IS NULL';
  END IF;
END
$$;

-- Historical rows written before `timestamp` existed keep their created_at.
UPDATE user_activity_logs SET timestamp = created_at
WHERE timestamp IS NULL AND created_at IS NOT NULL;

-- tracker.ts:145 filters on a timestamp range and groups by site_id/action_type.
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_timestamp
  ON user_activity_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_site_timestamp
  ON user_activity_logs(site_id, timestamp DESC);

-- ============================================================
-- performance_metrics
-- ============================================================
ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'performance_metrics'
      AND column_name = 'metric_name'
  ) THEN
    EXECUTE 'ALTER TABLE performance_metrics ALTER COLUMN metric_name DROP NOT NULL';
  END IF;
END
$$;

-- Replace the metric_type CHECK with one that accepts both vocabularies.
-- The original constraint is unnamed, so locate it by definition.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname
    INTO v_conname
    FROM pg_constraint c
    JOIN pg_class     t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'performance_metrics'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%metric_type%'
    LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE performance_metrics DROP CONSTRAINT %I', v_conname);
  END IF;
END
$$;

DO $$
BEGIN
  ALTER TABLE performance_metrics
    ADD CONSTRAINT performance_metrics_metric_type_check
      CHECK (metric_type IN (
        -- vocabulary used by src/lib/analytics/tracker.ts + /api/analytics/performance
        'load_time', 'edit_time', 'api_response_time',
        -- legacy vocabulary from 20250817000000_complete_database_setup.sql
        'page_load', 'api_response', 'database_query', 'websocket_latency'
      ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_performance_metrics_site_recorded
  ON performance_metrics(site_id, recorded_at DESC);

-- ============================================================
-- site_analytics
-- ============================================================
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS avg_load_time DECIMAL DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS conversion_rate DECIMAL DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS total_edits INTEGER DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS active_editors INTEGER DEFAULT 0;
ALTER TABLE site_analytics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- The ON CONFLICT (site_id, date) in update_site_analytics() needs this to be a
-- real unique constraint.  Both known shapes declare UNIQUE(site_id, date), but
-- guard in case a database was built without it.
DO $$
BEGIN
  ALTER TABLE site_analytics
    ADD CONSTRAINT site_analytics_site_id_date_key UNIQUE (site_id, date);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;  -- backing index already exists
END
$$;

-- ============================================================
-- update_site_analytics()
-- ============================================================
-- Called via supabase.rpc("update_site_analytics") from
-- src/lib/analytics/tracker.ts:324.  Defined only in the loose
-- supabase/analytics-schema.sql:404 until now.
CREATE OR REPLACE FUNCTION update_site_analytics()
RETURNS void AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_site_analytics() TO service_role;
