-- ========================================
-- A/B TESTING V2: Full Pipeline Support
-- ========================================
-- Adds: ab_test_results table, visitor_buckets table,
-- new columns on ab_tests and ab_test_variants

-- 1A. Create ab_test_results table
CREATE TABLE IF NOT EXISTS ab_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'click', 'conversion')),
  value DECIMAL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  geo_country TEXT,
  geo_region TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atr_test_id ON ab_test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_atr_variant_id ON ab_test_results(variant_id);
CREATE INDEX IF NOT EXISTS idx_atr_visitor_event ON ab_test_results(visitor_id, test_id, event_type);
CREATE INDEX IF NOT EXISTS idx_atr_recorded_at ON ab_test_results(recorded_at);

-- 1B. Add columns to ab_tests
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS target_element_id TEXT;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS auto_complete BOOLEAN DEFAULT true;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS min_sample_size INTEGER DEFAULT 100;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS confidence_threshold DECIMAL(3,2) DEFAULT 0.95;

-- 1C. Add columns to ab_test_variants
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS variant_content TEXT NOT NULL DEFAULT '';
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS is_control BOOLEAN DEFAULT false;
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS geo_countries TEXT[];
ALTER TABLE ab_test_variants ADD COLUMN IF NOT EXISTS geo_regions TEXT[];

-- 1D. Create visitor_buckets table (persistent assignment)
CREATE TABLE IF NOT EXISTS visitor_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  geo_country TEXT,
  geo_region TEXT,
  bucketed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(visitor_id, test_id)
);

CREATE INDEX IF NOT EXISTS idx_vb_site_visitor ON visitor_buckets(site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_vb_test_id ON visitor_buckets(test_id);

-- Enable RLS on new tables
ALTER TABLE ab_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_buckets ENABLE ROW LEVEL SECURITY;

-- RLS policies for ab_test_results (service role can insert, authenticated can read via site permissions)
CREATE POLICY "Service role can manage ab_test_results" ON ab_test_results
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage visitor_buckets" ON visitor_buckets
  FOR ALL USING (true) WITH CHECK (true);
