-- ========================================
-- Restore update_translation_coverage(UUID)
-- ========================================
-- `20251230100000_edit_board.sql` defines this function at :430 and grants EXECUTE
-- at :520. That migration is in the ledger, and parts of it demonstrably applied —
-- the `content_versions.change_type` CHECK it creates at :69 is live in production.
-- The function at :430 is NOT. Measured 2026-08-17 against pg_proc, not inferred.
--
-- So `20251230100000` is a PARTIAL application: an early statement succeeded and a
-- later one did not, with the ledger recording success either way. It joins the six
-- files already documented in `20260801200000_missing_base_tables.sql` and
-- `20260818000000_repair_aborted_migrations.sql` as marked-applied-but-not-applied.
--
-- WHY THIS FILE INSTEAD OF REPLAYING 20251230100000
-- -------------------------------------------------
-- Replaying it does not work, and the failure is instructive rather than incidental:
--
--     ERROR: cannot remove parameter defaults from existing function
--
-- A later migration redefined one of its functions with a default argument.
-- PostgreSQL will not let `CREATE OR REPLACE FUNCTION` drop a default that an
-- existing signature carries, so the whole file aborts — which is very likely how it
-- failed the first time, and would fail identically on every retry. Going forward
-- with exactly the missing object is the only route that terminates.
--
-- WHAT UNBLOCKS
-- -------------
-- `20260809120000_lock_down_definer_functions.sql:143-145` REVOKEs and re-GRANTs on
-- this exact signature. Without the function that migration cannot apply, and it is
-- security work — it removes PUBLIC EXECUTE from SECURITY DEFINER functions.
--
-- The body is reproduced VERBATIM from `20251230100000_edit_board.sql:430-459`. This
-- restores what was intended in 2025-12; it does not redesign it. The function is
-- SECURITY DEFINER, which is precisely why 20260809120000 exists to lock its grants
-- down — apply that migration immediately after this one.
-- ========================================

-- Preflight: fail with one legible error rather than a 42P01 from inside the body.
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_table   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.site_languages', 'public.content_elements'] LOOP
    IF to_regclass(v_table) IS NULL THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot restore update_translation_coverage — missing prerequisite table(s): %',
      array_to_string(v_missing, ', ');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_translation_coverage(p_language_id UUID)
RETURNS DECIMAL AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Matches 20251230100000:520. 20260809120000 tightens this immediately afterwards by
-- revoking PUBLIC; the GRANT is restored here so that migration has its expected
-- starting state rather than a surprising one.
GRANT EXECUTE ON FUNCTION update_translation_coverage(UUID) TO authenticated;

-- Postcondition: prove the function exists before this transaction commits.
DO $$
BEGIN
  IF to_regprocedure('public.update_translation_coverage(uuid)') IS NULL THEN
    RAISE EXCEPTION 'update_translation_coverage(uuid) was not created';
  END IF;
END $$;
