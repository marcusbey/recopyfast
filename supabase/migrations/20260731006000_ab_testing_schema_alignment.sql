-- ========================================
-- A/B Testing Schema Alignment
-- ========================================
-- ab_tests and ab_test_variants exist in migrations/, but two different
-- generations of application code write two different column sets, and neither
-- set is fully present:
--
--   ab_tests
--     writes traffic_split, success_metric, created_by
--       (src/app/api/ab-tests/route.ts:162, generate/route.ts:140)
--     migration has traffic_allocation and no success_metric/created_by
--     → every A/B test creation currently fails with "column does not exist"
--
--   ab_test_variants
--     dashboard writes content_element_id, variant_name, content
--       (src/app/api/ab-tests/route.ts:191)
--     embed reads name, variant_content, is_control
--       (src/app/api/ab-tests/active/[siteId]/route.ts:57)
--     migration declares name NOT NULL and content_changes JSONB NOT NULL,
--     neither of which the dashboard insert supplies
--     → variant creation currently fails on the NOT NULL violations
--
-- This migration adds the missing columns and relaxes the NOT NULLs so both
-- code paths work.  Nothing is dropped or renamed.
--
-- NOTE FOR FOLLOW-UP: (name, variant_content) and (variant_name, content) are
-- duplicate representations of the same variant; the two A/B test creation
-- routes should converge on one.
-- ========================================

-- ============================================================
-- ab_tests
-- ============================================================
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS traffic_split DECIMAL DEFAULT 0.5;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS success_metric TEXT;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS created_by UUID;

DO $$
BEGIN
  ALTER TABLE ab_tests
    ADD CONSTRAINT ab_tests_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Carry the legacy traffic_allocation value over so existing tests keep their
-- split when read through the new column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ab_tests'
      AND column_name = 'traffic_allocation'
  ) THEN
    EXECUTE 'UPDATE ab_tests SET traffic_split = traffic_allocation
             WHERE traffic_split IS NULL AND traffic_allocation IS NOT NULL';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ab_tests_site_status ON ab_tests(site_id, status);
CREATE INDEX IF NOT EXISTS idx_ab_tests_created_by ON ab_tests(created_by);

-- ============================================================
-- ab_test_variants
-- ============================================================
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS content_element_id UUID;
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS variant_name TEXT;
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS content TEXT;

DO $$
BEGIN
  ALTER TABLE ab_test_variants
    ADD CONSTRAINT ab_test_variants_content_element_id_fkey
      FOREIGN KEY (content_element_id) REFERENCES content_elements(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Relax the NOT NULLs the dashboard insert path does not satisfy, and give
-- content_changes a default so it can be omitted entirely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ab_test_variants'
      AND column_name = 'name'
  ) THEN
    EXECUTE 'ALTER TABLE ab_test_variants ALTER COLUMN name DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ab_test_variants'
      AND column_name = 'content_changes'
  ) THEN
    EXECUTE 'ALTER TABLE ab_test_variants ALTER COLUMN content_changes DROP NOT NULL';
    EXECUTE 'ALTER TABLE ab_test_variants ALTER COLUMN content_changes SET DEFAULT ''{}''::jsonb';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ab_test_variants'
      AND column_name = 'variant_content'
  ) THEN
    EXECUTE 'ALTER TABLE ab_test_variants ALTER COLUMN variant_content DROP NOT NULL';
  END IF;
END
$$;

-- Keep the two naming generations in sync for existing rows.
UPDATE ab_test_variants SET variant_name = name
WHERE variant_name IS NULL AND name IS NOT NULL;

UPDATE ab_test_variants SET name = variant_name
WHERE name IS NULL AND variant_name IS NOT NULL;

UPDATE ab_test_variants SET variant_content = content
WHERE (variant_content IS NULL OR variant_content = '') AND content IS NOT NULL;

UPDATE ab_test_variants SET content = variant_content
WHERE content IS NULL AND variant_content IS NOT NULL AND variant_content <> '';

-- COMPAT SHIM (remove once the two creation routes converge on one column pair).
-- /api/ab-tests/route.ts:191 writes (variant_name, content); the embed endpoint
-- /api/ab-tests/active/[siteId]/route.ts:57 reads (name, variant_content).
-- Without this, variants created from the dashboard render blank on the site.
CREATE OR REPLACE FUNCTION sync_ab_test_variant_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW.name            := COALESCE(NEW.name, NEW.variant_name);
  NEW.variant_name    := COALESCE(NEW.variant_name, NEW.name);
  NEW.variant_content := COALESCE(NULLIF(NEW.variant_content, ''), NEW.content);
  NEW.content         := COALESCE(NEW.content, NULLIF(NEW.variant_content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ab_test_variants_sync_trigger ON ab_test_variants;
CREATE TRIGGER ab_test_variants_sync_trigger
  BEFORE INSERT OR UPDATE ON ab_test_variants
  FOR EACH ROW EXECUTE FUNCTION sync_ab_test_variant_columns();

CREATE INDEX IF NOT EXISTS idx_ab_test_variants_test_id ON ab_test_variants(test_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_content_element_id
  ON ab_test_variants(content_element_id);
