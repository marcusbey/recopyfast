-- ============================================================
-- s69a: atomic conversion deduplication
-- ============================================================
-- `POST /api/ab-tests/track` used to prove "no prior conversion" with a
-- SELECT and insert the row later. Two beacons could finish that SELECT before
-- either INSERT committed, so both rows landed and the lifecycle code counted
-- both toward a winner. The read stays as a cheap optimization, but this
-- partial unique index is the arbiter that closes the race.
--
-- The production-repair path and a clean replay converge on the same
-- ab_test_results shape (20260818000000 section 3 and 20260127 respectively),
-- so this is one forward-only repair for both histories.
-- ============================================================

-- The cleanup and index creation must share one write-blocking transaction.
-- DELETE alone takes ROW EXCLUSIVE, which does not conflict with another
-- INSERT: without this lock a conversion could enter after cleanup but before
-- CREATE UNIQUE INDEX, making rollout fail halfway with 23505. SHARE ROW
-- EXCLUSIVE still permits ordinary reads while blocking every competing write
-- until the unique index exists. The DO block keeps that guarantee even in the
-- bare-psql replay runner, where statements in a migration file otherwise
-- autocommit one by one; Supabase's outer migration transaction is stricter.
DO $$
BEGIN
  LOCK TABLE public.ab_test_results IN SHARE ROW EXCLUSIVE MODE;

  -- The owner approved this survivor rule on 2026-10-12. `recorded_at` was not
  -- declared NOT NULL in either table-creation path, so NULL sorts last: a row
  -- with an actual timestamp is better evidence of which conversion arrived
  -- first. `id` makes equal timestamps deterministic rather than leaving the
  -- survivor to the planner's scan order.
  WITH ranked_conversions AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY test_id, visitor_id
        ORDER BY recorded_at ASC NULLS LAST, id ASC
      ) AS survivor_rank
    FROM public.ab_test_results
    WHERE event_type = 'conversion'
  )
  DELETE FROM public.ab_test_results AS result
  USING ranked_conversions AS ranked
  WHERE result.id = ranked.id
    AND ranked.survivor_rank > 1;

  IF to_regclass('public.ab_test_results_one_conversion_per_visitor') IS NULL THEN
    EXECUTE $index$
      CREATE UNIQUE INDEX ab_test_results_one_conversion_per_visitor
        ON public.ab_test_results (test_id, visitor_id)
        WHERE event_type = 'conversion'
    $index$;
  END IF;
END;
$$;

-- One statement inserts the route's already-authorized, tenant-checked and
-- exposure-checked batch. `ON CONFLICT DO NOTHING` is deliberately inside the
-- batch insert: a raced conversion disappears from RETURNING without aborting
-- a valid click, view or another visitor's conversion beside it. The caller
-- derives `recorded` and `deduplicated` from these returned rows, so a loser is
-- a truthful 200 dedupe rather than the 23505/500 this incident used to cause.
--
-- This is SECURITY INVOKER on purpose. The function is not an authorization
-- boundary and must inherit the existing service-role-only INSERT policy on
-- ab_test_results. A definer function here would turn any accidental EXECUTE
-- grant into a tenant-spanning write path. The route remains responsible for
-- body bounds, site-token authorization, rate limits, test/variant ownership
-- and exposure proof before it calls this function.
CREATE OR REPLACE FUNCTION public.insert_ab_test_events(p_events JSONB)
RETURNS TABLE (
  id UUID,
  test_id UUID,
  variant_id UUID,
  visitor_id TEXT,
  event_type TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The public route already enforces this same 1..50 bound. Keeping it here
  -- prevents a future service-role caller from silently turning the narrow RPC
  -- into an unbounded JSON expansion while preserving one canonical batch cap.
  IF p_events IS NULL
     OR jsonb_typeof(p_events) <> 'array'
     OR jsonb_array_length(p_events) < 1
     OR jsonb_array_length(p_events) > 50 THEN
    RAISE EXCEPTION 'A/B event batch must contain between 1 and 50 events'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.ab_test_results AS inserted (
    test_id,
    variant_id,
    visitor_id,
    session_id,
    event_type,
    value,
    metadata,
    geo_country,
    geo_region
  )
  SELECT
    event.test_id,
    event.variant_id,
    event.visitor_id,
    event.session_id,
    event.event_type,
    event.value,
    event.metadata,
    event.geo_country,
    event.geo_region
  FROM jsonb_to_recordset(p_events) AS event (
    test_id UUID,
    variant_id UUID,
    visitor_id TEXT,
    session_id TEXT,
    event_type TEXT,
    value NUMERIC,
    metadata JSONB,
    geo_country TEXT,
    geo_region TEXT
  )
  -- The only conflict expected from these generated ids and validated rows is
  -- the partial conversion key above. Leaving the target implicit also makes a
  -- retry tolerant of any independently generated UUID collision instead of
  -- aborting the rest of an otherwise valid batch.
  ON CONFLICT DO NOTHING
  RETURNING
    inserted.id,
    inserted.test_id,
    inserted.variant_id,
    inserted.visitor_id,
    inserted.event_type;
END;
$$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default. Revoke the wildcard
-- and both web roles explicitly, then opt in only the backend role that already
-- holds the table's INSERT policy. Repeating this migration converges because
-- CREATE OR REPLACE preserves ACLs and these statements restate the end state.
REVOKE ALL ON FUNCTION public.insert_ab_test_events(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_ab_test_events(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.insert_ab_test_events(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_ab_test_events(JSONB) TO service_role;

COMMENT ON FUNCTION public.insert_ab_test_events(JSONB) IS
  'Atomically inserts one bounded, pre-authorized A/B event batch and returns only rows that landed; service_role only.';
